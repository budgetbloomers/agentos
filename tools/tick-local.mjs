#!/usr/bin/env node
/**
 * tick-local.mjs — the scheduled tick, run from THIS machine when GitHub does not.
 *
 *   node tools/tick-local.mjs            run the tick if GitHub's runner is silent (> 20 min in working hours)
 *   node tools/tick-local.mjs --force    run it now regardless
 *   node tools/tick-local.mjs --check    say whether it would run, run nothing
 *
 * WHY (Nick, 2026-09-15: "please go in and make sure these problems do not happen again"). Every
 * republish and relay ran on one GitHub Actions workflow, and on 15 Sep GitHub refused to start it
 * — "recent account payments have failed or your spending limit needs to be increased" — so for an
 * hour nothing moved and a red banner said "read its log" over a run that had no log. One account's
 * billing must never be the only thing between an upload and the dashboards. This is the second
 * runner: Windows Task Scheduler calls it every 15 minutes (tools/install-local-tick.ps1); it reads
 * kv:jobs-status, and when the GitHub tick has gone quiet it runs the same steps the workflow runs —
 * rake, agent digest, Ops relay, NBA digest — and stamps them with runner:"local:<host>" so the
 * Settings page and the sentinel can say WHO kept the data moving. When GitHub is healthy this does
 * nothing (one small read), so the two never race.
 *
 * Needs what the workflow needs: supabase.env, nicks_code/diagnostics/node_modules (Playwright +
 * Chromium), a built site/ (prepare-site.js is run first, like the workflow).
 *
 * SPEC KIT 014, AREA T (2026-10-07):
 *   T0  a failed step's note keeps the REAL error. It kept the last two lines of the output, which for a
 *       crashed node is always a blank line and "Node.js v24.18.0" — so nba-republish (since 21 Sep) and
 *       lake-load (since 6 Oct) failed every run with nothing to read. failureNote() keeps the crash
 *       message + where it was thrown, every FAILED/DEADLINE/REFUSING/Error line and stderr's first lines;
 *       the whole output goes to reports/tmp/tick-steps/<step>-<time>.log (gitignored — company data).
 *   T3  a step really stops at its timeout. spawnSync's timeout killed node.exe and then waited on the
 *       pipe its Chromium/grandchildren still held — runs of 2–15 h — while the 25-min lock expired and
 *       the next firing overlapped. runStep() kills the whole tree (taskkill /T /F on Windows, the
 *       process group elsewhere), stops waiting on a pipe that will not close, and the lock is refreshed
 *       before every step and once a minute while one runs.
 *   T5  a stamp can never abort the steps after it (stampJob never throws; runSteps guards it anyway) and
 *       it is a compare-and-set on kv:jobs-status (tools/job-status.mjs).
 *   T6  a prepare-site failure is stamped ('prepare-site'), not just logged here.
 * REVIEW (2026-10-07):
 *   T-R1 a step whose tree survives the kill (taskkill failed) or whose pipes outlive it no longer keeps THIS process
 *        alive: runStep lets go of the child (stdio destroyed, handle unref'd), the log line says the kill failed, and
 *        exitIfStuck() ends the tick after main() if anything still holds it open.
 *   T-R5 step output is redacted (redact()) before it reaches the step log, the notes or this log.
 */
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process'; import { fileURLToPath, pathToFileURL } from 'node:url';
import { referralsSlotDue } from './sync-referrals.mjs';   // the ONE definition of "which referrals slot is due" (spec 002, C3)
import { stampJob, NOTE_MAX } from './job-status.mjs';     // the ONE kv:jobs-status writer (compare-and-set, never throws) and its note cap (T-R4)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOG = path.join(ROOT, 'reports', 'tick-local.log');
const say = (s) => { const line = new Date().toISOString() + ' ' + redact(s); console.log(line); try { fs.mkdirSync(path.dirname(LOG), { recursive: true }); fs.appendFileSync(LOG, line + '\n'); } catch {} };

export const STEP_TIMEOUT_MS = 20 * 60000;                 // one step, at most
export const LOCK_STALE_MS = STEP_TIMEOUT_MS + 5 * 60000;  // a lock older than a whole step + slack belongs to a dead tick
const HEARTBEAT_MS = 60000;                                // the lock is re-stamped this often while a step runs
const STEP_LOG_KEEP = 60;                                  // failed-step output files kept
const EXIT_GRACE_MS = 10000;                               // after main(): how long a leftover handle may hold the process (T-R1)

/* ------------------------------------------------------------------ T-R5: the redactor ---- */
/* A STEP'S OUTPUT LEAVES THIS MACHINE (014 review T-R5): all of it into reports/tmp/tick-steps/*.log (a OneDrive-synced
   folder) and up to NOTE_MAX characters into kv:jobs-status, which every staff session reads. A tool that prints a URL
   with its key, an Authorization header or a connection string must not publish it. One redactor for the step log, both
   notes and this tick's own log. Known values: SUPABASE_SECRET_KEY from the environment and every value main() loads from
   supabase.env and highlevel.env (addSecrets) — only 16 characters or longer, so a short value never blanks ordinary words. */
const REDACTED = '[redacted]';
const SECRET_MIN = 16;
const secretValues = new Set();
/** remember values that must never be written out (≥ 16 characters; shorter ones are ignored) */
export function addSecrets(values) {
  for (const v of values || []) { const s = String(v == null ? '' : v).trim(); if (s.length >= SECRET_MIN) secretValues.add(s); }
}
const SECRET_PATTERNS = [
  [/\bBearer\s+\S+/gi, 'Bearer ' + REDACTED],
  [/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, REDACTED],                                    // a JWT
  [/\b(token|apikey|api_key|password|secret|key)=[^&\s]+/gi, '$1=' + REDACTED],
  [/\bpostgres(ql)?:\/\/[^@\s]+@/gi, (m, ql) => 'postgres' + (ql || '') + '://' + REDACTED + '@'],   // user:password, the host stays
  [/sb_secret_\w+/g, REDACTED],
];
/** text with every known secret value and secret-shaped token replaced by [redacted] */
export function redact(text) {
  let s = String(text == null ? '' : text);
  const vals = [...secretValues];
  const envKey = String(process.env.SUPABASE_SECRET_KEY || '').trim();
  if (envKey.length >= SECRET_MIN) vals.push(envKey);
  for (const v of vals.sort((a, b) => b.length - a.length)) s = s.split(v).join(REDACTED);
  for (const [re, to] of SECRET_PATTERNS) s = s.replace(re, to);
  return s;
}
/** KEY=value lines (supabase.env, highlevel.env) → an object */
function parseEnv(text) {
  return Object.fromEntries(String(text || '').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^"|"$/g, '')]));
}

/* ------------------------------------------------------------------ T0: the note ---- */
const squash = (l) => String(l || '').replace(/\s+/g, ' ').trim();
const CARET = /^\s*\^+\s*$/;
/* lines that are never the error: Node's footer and internals, stack frames, the crash header, the
   error object's closing braces */
const isNoise = (l) => {
  const t = String(l || '').trim();
  return !t || /^Node\.js v\d/.test(t) || /^node:[\w/]+:\d+$/.test(t) || /^node:internal\//.test(t) || CARET.test(l)
    || /^triggerUncaughtException\(/.test(t) || /^at\s/.test(t) || /^[{}[\]],?$/.test(t) || /^Error\.captureStackTrace\(/.test(t)
    || /^(file:\/\/\/|[A-Za-z]:[\\/]|\/)\S*:\d+$/.test(t) || /Unhandled 'error' event/.test(t) || /^Emitted 'error' event/.test(t);
};
const isProp = (l) => /^\s{2,}[\w$]+: /.test(String(l || ''));   // "  code: '21000'," inside a dumped error object
const MARK = /\b(Error|FAILED|DEADLINE|REFUSING)\b|^\s*error:/;

/** Node's uncaught-exception block → "message @ file.mjs:line" ('' when stderr holds no crash) */
export function crashMessage(stderr) {
  const L = String(stderr || '').split(/\r?\n/);
  const caret = L.findIndex((l) => CARET.test(l));
  if (caret < 0) return '';
  let i = caret + 1; while (i < L.length && !L[i].trim()) i++;
  if (i >= L.length) return '';
  const msg = squash(L[i]).replace(/\s*\{$/, '');
  const frame = L.slice(i + 1).find((l) => /^\s*at\s/.test(l) && !/node_modules|\(node:|at node:/.test(l) && /\.m?js:\d+/.test(l));
  const where = frame && /([\w.-]+\.m?js):(\d+)(?::\d+)?\)?\s*\{?\s*$/.exec(frame.trim());
  return msg + (where ? ' @ ' + where[1] + ':' + where[2] : '');
}

/** the note for a FAILED step: the real error, never the footer */
export function failureNote({ stdout = '', stderr = '', timedOut = false, killFailed = false, timeoutMs = STEP_TIMEOUT_MS, status = null, error = null } = {}) {
  const parts = [];
  const add = (s) => { const t = squash(s); if (t && !parts.some((p) => p.includes(t) || t.includes(p))) { parts.push(t); return true; } return false; };
  if (timedOut) add('timed out after ' + Math.round(timeoutMs / 60000) + ' min — ' + (killFailed ? 'the process tree could NOT be killed (left running)' : 'process tree killed'));
  if (error) add('could not start: ' + ((error && error.message) || error));
  add(crashMessage(stderr));
  const errLines = String(stderr || '').split(/\r?\n/), outLines = String(stdout || '').split(/\r?\n/);
  let marked = 0;
  for (const l of [...errLines, ...outLines]) { if (marked >= 3) break; if (!isNoise(l) && !isProp(l) && MARK.test(l) && add(l)) marked++; }
  /* stderr's first lines, up to where a crash block begins (its location line + echoed source line) */
  const caret = errLines.findIndex((l) => CARET.test(l));
  let taken = 0;
  for (const l of caret >= 0 ? errLines.slice(0, Math.max(0, caret - 2)) : errLines) { if (taken >= 2) break; if (!isNoise(l) && !isProp(l) && add(l)) taken++; }
  if (!parts.length) {
    outLines.filter((l) => !isNoise(l)).slice(-2).forEach(add);
    add('exit ' + status);
  }
  return redact(parts.join(' | ')).slice(0, NOTE_MAX);   // redacted BEFORE the cut, so no half-secret survives (T-R5)
}

/** the note for a step that worked: its last lines, as before */
export function successNote({ stdout = '', stderr = '' } = {}) {
  return redact((String(stdout || '') + '\n' + String(stderr || '')).split(/\r?\n/).filter((l) => l.trim()).slice(-2).map(squash).join(' | ')).slice(0, 160);
}

/** the tick log line for one step — a kill that failed is said out loud (T-R1) */
export function stepLogLine(label, r, note, logFile = '', root = ROOT) {
  const verdict = r.ok ? 'ok' : r.timedOut ? 'TIMED OUT' + (r.killFailed ? ' (process tree NOT killed — still running)' : '') : 'FAILED (' + r.status + ')';
  return label + ' → ' + verdict + ' in ' + Math.round((r.ms || 0) / 1000) + 's — ' + note
    + (logFile ? ' · full output: ' + path.relative(root, logFile).split(path.sep).join('/') : '');
}

/** a failed step's WHOLE output → reports/tmp/tick-steps/<step>-<time>.log; returns the path ('' if it could not be written) */
export function writeStepLog(root, label, r, when = new Date()) {
  try {
    const dir = path.join(root, 'reports', 'tmp', 'tick-steps');   // reports/tmp/ is in .gitignore: tool output names agents
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, String(label).replace(/[^\w.-]/g, '_') + '-' + when.toISOString().slice(0, 19).replace(/:/g, '-') + 'Z.log');
    const headLines = ['step:  ' + label, 'args:  ' + ((r && r.args) || []).join(' '), 'at:    ' + when.toISOString(),
      'exit:  ' + (r && r.status) + (r && r.signal ? ' (' + r.signal + ')' : '') + (r && r.timedOut ? ' — TIMED OUT, process tree ' + (r.killFailed ? 'NOT killed (left running)' : 'killed') : ''),
      'took:  ' + (r && r.ms != null ? Math.round(r.ms / 1000) + ' s' : '?')];
    fs.writeFileSync(f, redact(headLines.join('\n') + '\n\n--- stdout ---\n' + ((r && r.stdout) || '') + '\n--- stderr ---\n' + ((r && r.stderr) || '') + '\n'));   // T-R5
    pruneStepLogs(dir, STEP_LOG_KEEP);
    return f;
  } catch { return ''; }
}
function pruneStepLogs(dir, keep) {
  try {
    const files = fs.readdirSync(dir).filter((n) => n.endsWith('.log'))
      .map((n) => ({ n, t: fs.statSync(path.join(dir, n)).mtimeMs })).sort((a, b) => b.t - a.t || (a.n < b.n ? 1 : -1));
    for (const x of files.slice(keep)) { try { fs.unlinkSync(path.join(dir, x.n)); } catch {} }
  } catch { /* pruning is housekeeping */ }
}

/* ------------------------------------------------------------------ T3: the step ---- */
/** kill a process AND everything it started */
export function killProcessTree(pid, { platform = process.platform, spawnSyncImpl = spawnSync } = {}) {
  if (!pid) return false;
  if (platform === 'win32') {
    const r = spawnSyncImpl('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 30000 });
    return !!r && r.status === 0;
  }
  try { process.kill(-pid, 'SIGKILL'); return true; } catch { try { process.kill(pid, 'SIGKILL'); return true; } catch { return false; } }
}

/** re-stamp the tick lock with now */
export function touchLock(file) { try { fs.writeFileSync(file, String(Date.now())); return true; } catch { return false; } }

/**
 * Run `node <args>` with a timeout that really ends it. Resolves (never rejects) with
 * {ok, status, signal, timedOut, stdout, stderr, ms, args}. The output is collected as it arrives, so
 * a killed step still has what it printed. After the child exits the pipes get exitGraceMs to close (a
 * grandchild can hold them for ever); after a kill the tree gets killGraceMs to die.
 */
export function runStep(args, { cwd, env, timeoutMs = STEP_TIMEOUT_MS, heartbeatMs = HEARTBEAT_MS, onHeartbeat = null,
  exitGraceMs = 5000, killGraceMs = 15000, spawnImpl = spawn, killTree = killProcessTree, maxBuffer = 16 * 1048576 } = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now(); const timers = [];
    let out = '', err = '', timedOut = false, done = false, status = null, signal = null, hb = null, child = null;
    const keep = (s, d) => { const n = s + d; return n.length > maxBuffer ? n.slice(-maxBuffer) : n; };
    const finish = (extra) => {
      if (done) return; done = true;
      timers.forEach((t) => clearTimeout(t)); if (hb) clearInterval(hb);
      /* LET GO OF THE CHILD (014 review T-R1). After a failed kill the child is still running, and after the exit grace a
         grandchild can still hold the pipes: a referenced handle then kept THIS process alive for ever, and Task
         Scheduler's "do not start a new instance" skipped every later firing. Pipes destroyed, handles unref'd. */
      for (const s of [child && child.stdout, child && child.stderr]) { try { if (s) { if (typeof s.unref === 'function') s.unref(); s.destroy(); } } catch {} }
      try { if (child && typeof child.unref === 'function') child.unref(); } catch {}
      const r = { status, signal, timedOut, stdout: out, stderr: err, ms: Date.now() - t0, args, ...(extra || {}) };
      r.ok = !r.timedOut && !r.error && r.status === 0;
      resolve(r);
    };
    try {
      child = spawnImpl(process.execPath, args, { cwd, env, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) { finish({ error: e }); return; }
    if (child.stdout) { child.stdout.setEncoding('utf8'); child.stdout.on('data', (d) => { out = keep(out, d); }); child.stdout.on('error', () => {}); }
    if (child.stderr) { child.stderr.setEncoding('utf8'); child.stderr.on('data', (d) => { err = keep(err, d); }); child.stderr.on('error', () => {}); }
    child.on('error', (e) => finish({ error: e }));
    child.on('exit', (code, sig) => { status = code; signal = sig; if (!done) timers.push(setTimeout(() => finish(), exitGraceMs)); });
    child.on('close', (code, sig) => { if (status === null) status = code; if (!signal) signal = sig; finish(); });
    if (onHeartbeat && heartbeatMs > 0) hb = setInterval(() => { try { onHeartbeat(); } catch {} }, heartbeatMs);
    timers.push(setTimeout(() => {
      if (done) return;
      timedOut = true;
      try { killTree(child.pid); } catch { /* reported by the grace below */ }
      timers.push(setTimeout(() => finish({ killFailed: true }), killGraceMs));
    }, timeoutMs));
  });
}

/* ------------------------------------------------------------------ the tick ---- */
/**
 * The steps, in the workflow's order. `run(label, args)` → {ok, note}; `stamp(step, ok, note)` writes
 * kv:jobs-status. Returns false when the site could not be built (nothing else may run).
 */
export async function runSteps({ run, stamp: stampRaw, say: log = () => {}, full, slot }) {
  /* a stamp is bookkeeping: whatever it does, the next step still runs (T5) */
  const stamp = async (step, ok, note) => { try { await stampRaw(step, ok, note); } catch (e) { log('stamp ' + step + ' NOT written — ' + ((e && e.message) || e)); } };
  const build = await run('prepare-site', ['tools/prepare-site.js']);
  await stamp('prepare-site', build.ok, build.note);   // T6: a build failure is on the Settings page, not only in this machine's log
  if (!build.ok) { log('cannot build site/ — the digests would run the wrong engine; stopping'); return false; }
  /* the same order as the workflow: the rake first so a file that just landed is in the lake */
  if (full) { const rake = await run('rake', ['tools/rake.mjs']); await stamp('rake', rake.ok, rake.note); }
  /* referrals BEFORE the digest: the digest ingests kv:referrals-latest into its headless engine. A failed pull is logged
     by the tool and never stops the digest (the last good copy stands). */
  if (slot) { const ref = await run('referrals', ['tools/sync-referrals.mjs', '--apply', '--slot=' + slot]); await stamp('referrals', ref.ok, ref.note); }
  const dig = await run('agent-digest', ['tools/digest-republish.mjs', '--apply']); await stamp('agent-digest', dig.ok, dig.note);
  if (full) {
    const rel = await run('ops-relay', ['tools/ops-relay.mjs', '--wait', '600']); await stamp('ops-relay', rel.ok, rel.note);   // 600: the relay now waits for the page's busy flag, and a BI workbook + attendance can take minutes (2026-09-21)
    /* THE LAKE FOLLOWS THE RELAY (plan: "after every relay"). lake-load only ever ran from the GitHub
       workflow, so with Actions off the lake froze on 14 Sep while files arrived daily (2026-09-21). */
    const lake = await run('lake-load', ['tools/lake-load.mjs']); await stamp('lake-load', lake.ok, lake.note);
    const nba = await run('nba-republish', ['tools/nba-republish.mjs', '--apply']); await stamp('nba-digest', nba.ok, nba.note);
  }
  return true;
}

/* The body is a function so an early finish is a `return`, not an exit call: exiting straight
   after an awaited fetch races undici's socket close and node dies with a libuv assertion
   (0xC0000409) on Windows - Task Scheduler then logs a failed run for a tick that did nothing
   wrong (2026-09-18, found while hiding the tick's console window). */
async function main() {
const env = parseEnv(fs.readFileSync(path.join(ROOT, 'supabase.env'), 'utf8'));
/* the values no output may carry (T-R5): this tick's credentials, and HighLevel's — the referrals step loads highlevel.env */
addSecrets(Object.values(env));
try { addSecrets(Object.values(parseEnv(fs.readFileSync(path.join(ROOT, 'highlevel.env'), 'utf8')))); } catch { /* no highlevel.env on this machine */ }
const H ={ apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY, 'Content-Type': 'application/json' };
const REST = env.SUPABASE_URL + '/rest/v1/';
const FORCE = process.argv.includes('--force'), CHECK = process.argv.includes('--check');
/* --primary: THIS machine IS the runner (an always-on server, tools/install-server-tick.sh) — run every
   call in working hours, no waiting for GitHub to go quiet. GitHub's schedule can then be trimmed to the
   daily jobs its free minutes cover. Nick, 15 Sep: "the github and my pc cannot be always on". */
const PRIMARY = process.argv.includes('--primary');
const HOST = 'local:' + os.hostname();
const SILENT_MIN = 20;                       // the Worker's TICK_OVERDUE_MIN — cron cadence 15 + slack

/* SAST working hours, like the sentinel: outside them a quiet runner is not a problem to solve */
const sast = new Date(Date.now() + 2 * 3600000);
const working = sast.getUTCDay() >= 1 && sast.getUTCDay() <= 5 && sast.getUTCHours() >= 6 && sast.getUTCHours() < 20;

const cur = (await (await fetch(REST + 'rules?key=eq.kv:jobs-status&select=value', { headers: H })).json())[0];
let doc = { steps: {} };
try { const v = (cur && cur.value) || {}; doc = v.steps ? v : (v.data ? JSON.parse(v.data) : doc); } catch {}
const TICK = ['agent-digest', 'ops-relay', 'lake-load', 'nba-digest'];
const newest = TICK.map((k) => Date.parse(((doc.steps || {})[k] || {}).ranAt || 0) || 0).reduce((a, b) => Math.max(a, b), 0);
const silentMin = newest ? Math.round((Date.now() - newest) / 60000) : null;
/* THE REFERRALS SLOTS (spec 002, C3): 08:00 and 14:00 SAST, EVERY day — weekends included, so this is decided apart from
   the Mon-Fri working gate. A due, unserved slot runs the referrals step + the agent digest even on a Sunday or when
   GitHub's tick is healthy; the rest of the tick (rake, relay, lake, NBA) stays on the working-hours rule. */
let refLog = [];
try { const lr = (await (await fetch(REST + 'rules?key=eq.kv:referrals-sync-log&select=value', { headers: H })).json())[0];
  const d = JSON.parse(String(((lr && lr.value) || {}).data || '{}')); refLog = Array.isArray(d.entries) ? d.entries : []; } catch {}
const slot = referralsSlotDue(Date.now(), refLog);
const full = FORCE || (working && (PRIMARY || silentMin == null || silentMin > SILENT_MIN));
const due = FORCE || full || !!slot;
say('tick newest ' + (newest ? new Date(newest).toISOString() : 'never') + ' · silent ' + silentMin + ' min · working ' + working + ' · referrals slot ' + (slot || 'none due') + ' · ' + (full ? 'RUN' : slot ? 'RUN (referrals + digest only)' : 'nothing to do'));
if (CHECK || !due) return;

/* one at a time: a second Task Scheduler firing while a tick is still running must not overlap it. The lock
   is re-stamped before every step and once a minute while one runs, so a long tick keeps it (T3). */
const LOCK = path.join(os.tmpdir(), 'cbx-tick-local.lock');
try { const t = +fs.readFileSync(LOCK, 'utf8'); if (Date.now() - t < LOCK_STALE_MS) { say('another local tick is running (lock ' + Math.round((Date.now() - t) / 60000) + ' min old) — skipped'); return; } } catch {}
touchLock(LOCK);

const stamp = async (step, ok, note) => {
  const r = await stampJob({ rest: REST, headers: H, step, ok, note, runner: HOST, by: 'tick-local' });
  if (!r.ok) say('stamp ' + step + ' NOT written after ' + r.tries + ' tries — ' + r.error);
};
const run = async (label, args) => {
  touchLock(LOCK);   // a fresh lock for every step, and the heartbeat keeps it fresh while the step runs
  const r = await runStep(args, { cwd: ROOT, env: { ...process.env, CBX_RUNNER: HOST }, timeoutMs: STEP_TIMEOUT_MS, onHeartbeat: () => touchLock(LOCK) });
  const note = r.ok ? successNote(r) : failureNote({ ...r, timeoutMs: STEP_TIMEOUT_MS });
  let logFile = '';
  if (!r.ok) logFile = writeStepLog(ROOT, label, r);
  say(stepLogLine(label, r, note, logFile));
  return { ok: r.ok, note };
};

try {
  if (!(await runSteps({ run, stamp, say, full, slot }))) { process.exitCode = 1; return; }
  say('local tick done');
} finally { try { fs.unlinkSync(LOCK); } catch {} }
}

/* main only when run as the entry point — importing this file (verify-tick-014) runs nothing. The realpath
   comparison is the fallback for a launcher that spells the path differently (case, a junction). */
const isMain = () => {
  if (!process.argv[1]) return false;
  if (import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) return true;
  try { const a = fs.realpathSync.native(path.resolve(process.argv[1])), b = fs.realpathSync.native(fileURLToPath(import.meta.url));
    return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b; } catch { return false; }
};
/* THE TICK ALWAYS ENDS (014 review T-R1). main() returns rather than exiting (the libuv assertion above), so a handle left
   behind — a child that outlived a failed kill, a socket — would keep this node alive and Task Scheduler would skip every
   later firing. Once main() is done this arms an UNREF'D timer: a clean run ends at once without it ever firing; a stuck
   one is ended after the grace, with the exit code main() set, never straight after a fetch. */
export function exitIfStuck(graceMs = EXIT_GRACE_MS, onStuck = null) {
  const t = setTimeout(() => { try { if (onStuck) onStuck(); } catch {} process.exit(); }, graceMs);
  if (t && typeof t.unref === 'function') t.unref();
  return t;
}
if (isMain()) {
  await main().catch((e) => { say('tick crashed — ' + ((e && e.stack) || e)); process.exitCode = 1; });
  exitIfStuck(EXIT_GRACE_MS, () => say('tick done, but something still held the process open — ended after ' + EXIT_GRACE_MS / 1000 + ' s'));
}
