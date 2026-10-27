#!/usr/bin/env node
/**
 * verify-tick-014.mjs — Spec Kit 014, Area T: the local tick and the tools it runs.
 *
 *   node nicks_code/diagnostics/verify-tick-014.mjs
 *
 * No credentials, nothing reaches production. Every tool is imported only after its source proves it
 * has a main guard (importing an unguarded tool would RUN it: mint a session, publish, write the lake);
 * child processes are real but local (a node script that crashes, a process tree that will not die) or
 * stubbed; Supabase is a fake fetch.
 *   T0  the failure note keeps the REAL error (a Node crash, a pg error, FAILED/DEADLINE/REFUSING lines),
 *       never the "Node.js v24" footer; a failed step's full output lands in a gitignored file
 *   T1  nba-republish loads a store in bounded chunks (the 126.5 MB ViciDial store killed the page in one
 *       page.evaluate) and closes Chromium + the server in finally
 *   T2  lake-load collapses rows sharing a conflict key before the upsert (SF_INACTIVE carried one twin,
 *       and Postgres refuses "ON CONFLICT DO UPDATE command cannot affect row a second time"), listens for
 *       pg 'error', and one failing source no longer stops the rest
 *   T3  a step really stops at its timeout — the whole process tree is killed — and the lock is refreshed
 *   T4  ops-relay leaves when the page's relay found nothing to do, and names its failure cause last
 *   T5  a stamp re-reads just before writing (compare-and-set) and can never abort the steps after it
 *   T6  a prepare-site failure is stamped
 * Review follow-ups:
 *   T-R1 a step whose tree survives a failed kill (or whose pipes outlive it) never keeps the tick process alive
 *   T-R2 lake-load stops after a client-side query timeout and reports the rest "not attempted"
 *   T-R3 every kv:jobs-status fetch has a timeout   T-R4 one note cap (300) in both tools
 *   T-R5 secrets are redacted from the step log, both notes and the tick log
 */
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events'; import { PassThrough } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (d ? ' — ' + d : '')); } };
const head = (s) => console.log('\n' + s);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-tick-014-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const src = (t) => fs.readFileSync(path.join(ROOT, 'tools', t), 'utf8');

/* An unguarded tool runs on import — never import one. The guard is the repo's own pattern
   (tools/sync-referrals.mjs): main() only when the file is the process's entry point. */
const GUARD = /import\.meta\.url === pathToFileURL\(path\.resolve\(process\.argv\[1\]\)\)\.href/;
async function safeImport(tool, names) {
  const s = src(tool);
  if (!GUARD.test(s)) return { mod: null, why: tool + ' has no main guard — importing it would run it' };
  const missing = names.filter((n) => !new RegExp('export (async )?(function\\*? |const |let )' + n + '\\b').test(s));
  if (missing.length) return { mod: null, why: tool + ' does not export ' + missing.join(', ') };
  try { return { mod: await import(pathToFileURL(path.join(ROOT, 'tools', tool)).href), why: '' }; }
  catch (e) { return { mod: null, why: 'import failed: ' + String(e.message).slice(0, 160) }; }
}

/* run a throwaway node script and return its real stdout/stderr (the crash text of THIS Node) */
function crashOf(name, body) {
  const dir = path.join(TMP, 'tools'); fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, name); fs.writeFileSync(f, body);
  const r = spawnSync(process.execPath, [f], { encoding: 'utf8', timeout: 30000 });
  return { stdout: r.stdout || '', stderr: r.stderr || '', status: r.status };
}

/* ======================================================================== T0 */
head('T0 · the failure note keeps the real error');
const tick = await safeImport('tick-local.mjs', ['failureNote', 'successNote', 'writeStepLog', 'runStep', 'killProcessTree', 'runSteps', 'touchLock']);
ok('tick-local.mjs exports its helpers without running the tick', !!tick.mod, tick.why);
const T = tick.mod || {};

/* The REAL crash nba-republish has printed on every run since 21 Sep (captured from a no-publish copy of
   the tool on 2026-10-07; paths shortened). The old note kept only its last two lines. */
const NBA_CRASH = {
  stdout: '  VICI_CALL_REPORT       126.5 MB\nlive stores: 238.5 MB\n\n  loaded AGENT_LIST\n  loaded ATTENDANCE\n  loaded QA_EVALUATIONS\n  loaded BI_ACTIVE_CASES\n  loaded CALLX_CALL_RECORDS\n',
  stderr: 'node:internal/modules/run_main:107\n    triggerUncaughtException(\n    ^\n\npage.evaluate: Target page, context or browser has been closed\n'
    + '    at file:///C:/Users/x/agentos/tools/nba-republish.mjs:77:14 {\n  log: []\n}\n\nNode.js v24.18.0\n',
};
const oldTail = (r) => String((r.stdout || '') + (r.stderr || '')).trim().split('\n').slice(-2).join(' | ').slice(0, 160);
console.log('  (the old note on that crash: "' + oldTail(NBA_CRASH) + '")');
const note = (r) => (typeof T.failureNote === 'function' ? String(T.failureNote(r)) : '');
{
  const n = note(NBA_CRASH);
  ok('a Playwright crash: the note carries the message', /Target page, context or browser has been closed/.test(n), n);
  ok('a Playwright crash: the note says where (nba-republish.mjs:77)', /nba-republish\.mjs:77/.test(n), n);
  ok('a Playwright crash: never the "Node.js v24" footer, never the internal frame', !!n && !/Node\.js v\d/.test(n) && !/run_main|triggerUncaught/.test(n), n);
}
{ /* a real pg DatabaseError thrown at top level, as lake-load did on every run since 6 Oct */
  const pgProto = pathToFileURL(path.join(HERE, 'node_modules', 'pg-protocol', 'dist', 'messages.js')).href;
  const r = crashOf('lake-load.mjs', `import m from '${pgProto}';
console.log('LOADING\\n');
console.log('  SF_CLOSED_CASES         68815 blob rows →   68815 mapped   table  68823 →  68823   new      0');
const e = new m.DatabaseError('ON CONFLICT DO UPDATE command cannot affect row a second time', 233, 'error');
Object.assign(e, { severity: 'ERROR', code: '21000', hint: 'Ensure that no rows proposed for insertion within the same command have duplicate constrained values.' });
async function upsert() { throw e; }
await upsert();
`);
  ok('(fixture) the pg crash really crashed node', r.status === 1 && /Node\.js v\d/.test(r.stderr), r.stderr.slice(-200));
  const n = note(r);
  ok('a pg error: the note carries the Postgres message', /ON CONFLICT DO UPDATE command cannot affect row a second time/.test(n), n);
  ok('a pg error: never the footer', !!n && !/Node\.js v\d/.test(n), n);
}
{ /* an unhandled 'error' event — what a dropped pg connection does with no listener */
  const r = crashOf('emit.mjs', `import { EventEmitter } from 'node:events';\nconsole.log('LOADING');\nnew EventEmitter().emit('error', new Error('Connection terminated unexpectedly'));\n`);
  const n = note(r);
  ok("an unhandled 'error' event: the note carries the error", /Connection terminated unexpectedly/.test(n), n);
}
{ /* ops-relay: the cause is mid-output and the last lines are the row counts */
  const r = { status: 1, stderr: '', stdout: 'Ops booted as nicholas — waiting for the upload relay\narchive files pulled: 1 (1 ok) · files already decided: 412\n'
    + '  saved   cb-facts-QA_EVALUATIONS        200\n  FAILED  cb-facts-VICI_CALL_REPORT      400  {"error":"could not decompress the upload: Memory limit exceeded before EOF."}\n'
    + 'rows now: AGENT_LIST 128 · ATTENDANCE 20723 · VICI_CALL_REPORT 588106\nstores that moved: QA_EVALUATIONS\n' };
  const n = note(r);
  ok('a FAILED line in the middle of stdout is kept', /FAILED\s+cb-facts-VICI_CALL_REPORT/.test(n) && /Memory limit exceeded/.test(n), n);
}
{
  const r = { status: 1, stderr: '', stdout: 'Ops booted\nDEADLINE: the relay was still loading at 600 s — files left undecided for the next run (raise --wait)\nrows now: X 1\n' };
  ok('a DEADLINE line is kept', /DEADLINE: the relay was still loading/.test(note(r)), note(r));
  const q = { status: 1, stdout: 'built by the deployed engine: 0 agents\n', stderr: 'REFUSING: the window is not a single reporting month — {"from":"2026-09-28","to":"2026-10-03"}\n' };
  ok('a REFUSING line (console.error, no crash) is kept', /REFUSING: the window is not a single reporting month/.test(note(q)), note(q));
  const s = { status: 1, stdout: 'step one\n', stderr: 'the publisher produced nothing — is the roster loaded? cbInfo=0\n' };
  ok("stderr's first non-blank line is kept when nothing matches", /the publisher produced nothing/.test(note(s)), note(s));
  const t = { status: null, timedOut: true, timeoutMs: 20 * 60000, stdout: 'loading\n', stderr: '' };
  ok('a timed-out step says so first', /^timed out after 20 min/.test(note(t)), note(t));
}
ok('a successful step keeps its last lines', typeof T.successNote === 'function'
  && /published kv:nba-digest/.test(T.successNote({ stdout: 'x\npublished kv:nba-digest — 128 agents\nThe Worker caches it for 60s\n', stderr: '' })));

head("T0 · a failed step's full output is written to a gitignored file");
if (typeof T.writeStepLog === 'function') {
  const root = path.join(TMP, 'root');
  const f = T.writeStepLog(root, 'nba-republish', { ...NBA_CRASH, status: 1, ms: 1234, args: ['tools/nba-republish.mjs', '--apply'] }, new Date('2026-10-07T10:34:33.791Z'));
  ok('the file exists, named <step>-<time>.log', !!f && fs.existsSync(f) && /nba-republish-2026-10-07T10-34-33Z\.log$/.test(f), f);
  const body = f && fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
  ok('it holds the WHOLE output (stdout and stderr)', body.includes('loaded CALLX_CALL_RECORDS') && body.includes('Target page, context or browser has been closed') && body.includes('Node.js v24.18.0'));
  const rel = f ? path.relative(root, f).split(path.sep).join('/') : '';
  const gi = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  ok('it lands under reports/tmp/ — which .gitignore excludes (tool output holds company data)', rel.startsWith('reports/tmp/tick-steps/') && /^reports\/tmp\/$/m.test(gi), rel);
  for (let i = 0; i < 70; i++) T.writeStepLog(root, 'lake-load', { stdout: 'x', stderr: 'y', status: 1 }, new Date(Date.UTC(2026, 9, 7, 8, 0, i)));
  const n = fs.readdirSync(path.dirname(f)).length;
  ok('old step logs are pruned (the folder never grows without bound)', n <= 60, n + ' files');
} else ok('writeStepLog exists', false, tick.why);
ok('the tick writes a failed step\'s output to the file and names it in the log', /if \(!r\.ok\)[^\n]*writeStepLog\(/.test(src('tick-local.mjs')));

/* ======================================================================== T3 */
head('T3 · a step stops at its timeout — the whole process tree');
if (typeof T.runStep === 'function') {
  /* the real thing: a child that starts a grandchild sharing its stdout, then both hang. spawnSync's
     timeout killed only the child and then waited on the pipe the grandchild still held — for hours. */
  const pidFile = path.join(TMP, 'grandchild.pid');
  const child = path.join(TMP, 'hang-tree.mjs');
  fs.writeFileSync(child, `import { spawn } from 'node:child_process'; import fs from 'node:fs';
const g = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: ['ignore', 'inherit', 'inherit'] });
fs.writeFileSync(${JSON.stringify(pidFile)}, String(g.pid));
console.log('started grandchild ' + g.pid);
setInterval(() => {}, 1000);
`);
  const t0 = Date.now();
  const r = await Promise.race([T.runStep([child], { cwd: TMP, timeoutMs: 2500, heartbeatMs: 60000 }), sleep(45000).then(() => 'HUNG')]);
  const took = Date.now() - t0;
  ok('runStep returns soon after the timeout (not when the tree dies of old age)', r !== 'HUNG' && took < 30000, took + ' ms');
  ok('the result says it timed out and failed', r && r !== 'HUNG' && r.timedOut === true && r.ok === false);
  ok('the output before the kill is kept', r && r !== 'HUNG' && /started grandchild/.test(r.stdout || ''));
  await sleep(1500);
  let gpid = 0; try { gpid = +fs.readFileSync(pidFile, 'utf8'); } catch {}
  let alive = false; if (gpid) { try { process.kill(gpid, 0); alive = true; } catch { alive = false; } }
  ok('the GRANDCHILD is dead too (taskkill /T /F on Windows, the process group elsewhere)', gpid > 0 && !alive, 'pid ' + gpid + (alive ? ' still running' : ''));
  if (alive) try { process.kill(gpid); } catch {}

  /* stubbed: a child whose pipes never close after the kill must still let the tick go on */
  const fake = () => { const c = new EventEmitter(); c.pid = 4242; c.stdout = new PassThrough(); c.stderr = new PassThrough(); c.kill = () => {}; return c; };
  let killed = null, kc = null;
  const r2 = await Promise.race([T.runStep(['x.mjs'], { timeoutMs: 100, exitGraceMs: 150, heartbeatMs: 60000,
    spawnImpl: () => (kc = fake()), killTree: (pid) => { killed = pid; setTimeout(() => kc.emit('exit', null, 'SIGKILL'), 20); } }), sleep(5000).then(() => 'HUNG')]);
  ok('the kill goes to the child\'s pid (the tree root)', killed === 4242, String(killed));
  ok('a child whose pipes never close cannot hang the tick (exit + grace)', r2 !== 'HUNG' && r2.timedOut === true);
  const r3 = await Promise.race([T.runStep(['x.mjs'], { timeoutMs: 100, exitGraceMs: 100, killGraceMs: 200, heartbeatMs: 60000,
    spawnImpl: () => fake(), killTree: () => {} }), sleep(5000).then(() => 'HUNG')]);
  ok('a tree that will not die cannot hang the tick either (kill + grace)', r3 !== 'HUNG' && r3.timedOut === true && r3.ok === false);

  let beats = 0; let c4;
  const r4 = await T.runStep(['x.mjs'], { timeoutMs: 60000, heartbeatMs: 40, onHeartbeat: () => { beats++; },
    spawnImpl: () => { c4 = fake(); setTimeout(() => { c4.stdout.end('done\n'); c4.stderr.end();
      setTimeout(() => { c4.emit('exit', 0, null); c4.emit('close', 0, null); }, 30); }, 300); return c4; } });
  ok('the lock heartbeat runs while a step runs', beats >= 3, beats + ' beats');
  ok('a clean exit is ok with its output', r4.ok === true && r4.status === 0 && /done/.test(r4.stdout));
} else ok('runStep exists', false, tick.why);
if (typeof T.killProcessTree === 'function') {
  const calls = [];
  T.killProcessTree(777, { platform: 'win32', spawnSyncImpl: (cmd, args) => { calls.push([cmd, ...args]); return { status: 0 }; } });
  ok('on Windows the tree is killed with taskkill /PID <pid> /T /F', calls.length === 1 && /taskkill/i.test(calls[0][0]) && calls[0].slice(1).join(' ') === '/PID 777 /T /F', JSON.stringify(calls));
} else ok('killProcessTree exists', false, tick.why);
ok('the lock outlives a step: stale only after the step timeout plus slack', T.LOCK_STALE_MS > T.STEP_TIMEOUT_MS, T.LOCK_STALE_MS + ' vs ' + T.STEP_TIMEOUT_MS);
if (typeof T.touchLock === 'function') {
  const lf = path.join(TMP, 'lock'); fs.writeFileSync(lf, '1');
  T.touchLock(lf); const v = +fs.readFileSync(lf, 'utf8');
  ok('touchLock() rewrites the lock with now', Math.abs(Date.now() - v) < 5000, String(v));
}
ok('every step refreshes the lock before it starts and while it runs', /touchLock\(LOCK\)[\s\S]{0,200}runStep\(/.test(src('tick-local.mjs')) && /onHeartbeat: \(\) => touchLock\(LOCK\)/.test(src('tick-local.mjs')));
ok('spawnSync is gone from the step runner', !/spawnSync\(process\.execPath/.test(src('tick-local.mjs')));

/* ================================================================== T5 + T6 */
head('T5 · T6 · stamps never stop the tick; a prepare-site failure is stamped');
if (typeof T.runSteps === 'function') {
  const mk = (fails = {}, throwOn = {}) => {
    const ran = [], stamped = [];
    return { ran, stamped,
      run: async (label) => { ran.push(label); return { ok: !fails[label], note: fails[label] ? 'boom in ' + label : 'fine' }; },
      stamp: async (step, okk, n) => { stamped.push([step, okk, n]); if (throwOn[step]) throw new Error('kv:jobs-status unreachable'); },
      say: () => {} };
  };
  const a = mk({ 'prepare-site': true });
  const ra = await T.runSteps({ ...a, full: true, slot: '08:00' });
  ok('a prepare-site failure stops the tick', ra === false && a.ran.join() === 'prepare-site', a.ran.join());
  ok('…and is STAMPED with its cause', a.stamped.some(([s, k, n]) => s === 'prepare-site' && k === false && /boom/.test(n)), JSON.stringify(a.stamped));
  const b = mk({}, { rake: true, 'agent-digest': true });
  const rb = await T.runSteps({ ...b, full: true, slot: null });
  ok('a stamp that throws never skips the steps after it', rb === true && b.ran.join() === 'prepare-site,rake,agent-digest,ops-relay,lake-load,nba-republish', b.ran.join());
  ok('every step that ran was stamped (nba-republish as nba-digest)', ['rake', 'agent-digest', 'ops-relay', 'lake-load', 'nba-digest'].every((s) => b.stamped.some((x) => x[0] === s)), b.stamped.map((x) => x[0]).join());
  const c = mk();
  await T.runSteps({ ...c, full: false, slot: '14:00' });
  ok('outside a full tick only referrals + agent-digest run', c.ran.join() === 'prepare-site,referrals,agent-digest', c.ran.join());
} else ok('runSteps exists', false, tick.why);

const js = await safeImport('job-status.mjs', ['stampJob', 'withStep', 'parseJobsDoc']);
ok('job-status.mjs exports stampJob without writing anything on import', !!js.mod, js.why);
if (js.mod) {
  const { stampJob, withStep } = js.mod;
  const res = (status, body) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
  /* a fake rules table with an updated_at, PATCH only lands when updated_at still matches */
  const table = (initial) => {
    const st = { row: initial, calls: [], interloper: null };
    st.fetch = async (url, o = {}) => {
      const m = (o.method || 'GET').toUpperCase(); st.calls.push(m + ' ' + url);
      if (m === 'GET') { const r = st.row ? [{ value: st.row.value, updated_at: st.row.updated_at }] : []; if (st.interloper) { st.interloper(); st.interloper = null; } return res(200, r); }
      if (m === 'PATCH') { const want = decodeURIComponent((/updated_at=eq\.([^&]+)/.exec(url) || [])[1] || '');
        if (!st.row || st.row.updated_at !== want) return res(200, []);
        const b = JSON.parse(o.body); st.row = { value: b.value, updated_at: b.updated_at }; return res(200, [st.row]); }
      if (m === 'POST') { const b = JSON.parse(o.body)[0]; st.row = { value: b.value, updated_at: b.updated_at }; return res(201, null); }
      return res(405, null);
    };
    return st;
  };
  const doc = (steps) => ({ value: { data: JSON.stringify({ steps, updatedAt: '2026-10-07T10:00:00.000Z' }) }, updated_at: '2026-10-07T10:00:00.123456+00:00' });
  const steps = (st) => JSON.parse(st.row.value.data).steps;
  {
    const st = table(doc({ rake: { ranAt: '2026-10-07T09:00:00Z', ok: true } }));
    const r = await stampJob({ rest: 'https://x/rest/v1/', headers: {}, step: 'lake-load', ok: false, note: 'n'.repeat(500), runner: 'local:BOX', fetchImpl: st.fetch });
    ok('a stamp writes its step and keeps the others', r.ok && steps(st)['lake-load'] && steps(st).rake, JSON.stringify(r));
    ok('the note is capped at 300 (T-R4: the cap failureNote writes) and the runner recorded', steps(st)['lake-load'].note.length === 300 && steps(st)['lake-load'].runner === 'local:BOX' && JSON.parse(st.row.value.data).lastRunner === 'local:BOX', String(steps(st)['lake-load'].note.length));
    ok('the write is conditional on the row it read (compare-and-set on updated_at)', st.calls.some((c) => /^PATCH .*updated_at=eq\./.test(c)), st.calls.join(' | '));
  }
  {
    const st = table(doc({ rake: { ranAt: '2026-10-07T09:00:00Z', ok: true } }));
    let first = true;
    const f0 = st.fetch;
    st.fetch = async (url, o = {}) => {   // another writer lands between our read and our write, once
      if ((o.method || '') === 'PATCH' && first) { first = false;
        const d = JSON.parse(st.row.value.data); d.steps['agent-digest'] = { ranAt: 'now', ok: true };
        st.row = { value: { data: JSON.stringify(d) }, updated_at: '2026-10-07T10:00:05.000001+00:00' }; }
      return f0(url, o);
    };
    const r = await stampJob({ rest: 'https://x/rest/v1/', headers: {}, step: 'nba-digest', ok: true, note: 'x', fetchImpl: st.fetch });
    ok('a race re-reads and retries — the other writer\'s step survives', r.ok && steps(st)['agent-digest'] && steps(st)['nba-digest'], JSON.stringify(steps(st)));
  }
  {
    const st = table(null);
    const r = await stampJob({ rest: 'https://x/rest/v1/', headers: {}, step: 'ops-relay', ok: true, note: 'x', fetchImpl: st.fetch });
    ok('no row yet: the first stamp creates it', r.ok && steps(st)['ops-relay'], JSON.stringify(r));
  }
  {
    let threw = false, r = null;
    try { r = await stampJob({ rest: 'https://x/rest/v1/', headers: {}, step: 'rake', ok: true, note: '', fetchImpl: async () => { throw new TypeError('fetch failed'); } }); } catch { threw = true; }
    ok('a network failure never throws out of a stamp — it reports', !threw && r && r.ok === false && /fetch failed/.test(r.error), JSON.stringify(r));
  }
  const d0 = { steps: { a: { ok: true } } }; const d1 = withStep(d0, 'b', { ok: false }, '2026-10-07T00:00:00Z');
  ok('withStep() returns a new document and leaves the input alone', !d0.steps.b && d1.steps.b && d1.steps.a && d1 !== d0);
}
ok('the tick stamps through stampJob (one implementation)', /stampJob\(/.test(src('tick-local.mjs')) && /from '\.\/job-status\.mjs'/.test(src('tick-local.mjs')));

/* ======================================================================== T1 */
head('T1 · nba-republish loads a store in chunks and always closes Chromium');
const nba = await safeImport('nba-republish.mjs', ['chunkJsonRows', 'loadStores']);
ok('nba-republish.mjs exports its loader without launching anything', !!nba.mod, nba.why);
if (nba.mod) {
  const rows = Array.from({ length: 5000 }, (_, i) => ({ _d: '2026-10-0' + (1 + (i % 6)), user_raw: 'CB' + i, length_in_sec: String(i % 300), note: 'é"\\' + 'x'.repeat(i % 50) }));
  const MAX = 32 * 1024;
  const chunks = nba.mod.chunkJsonRows(rows, MAX);
  ok('every chunk stays under the byte budget', chunks.every((c) => Buffer.byteLength(c) <= MAX), Math.max(...chunks.map((c) => Buffer.byteLength(c))) + ' bytes');
  ok('the chunks put back together are the store, in order', JSON.stringify(chunks.flatMap((c) => JSON.parse(c))) === JSON.stringify(rows));
  const big = [{ a: 'y'.repeat(MAX * 2) }, { a: 1 }];
  const bc = nba.mod.chunkJsonRows(big, MAX);
  ok('a single row bigger than the budget travels alone (never dropped)', bc.length === 2 && JSON.parse(bc[0])[0].a.length === MAX * 2);
  /* the loader against a page stand-in: evaluate(fn, arg) runs fn here, where `state` is a global */
  globalThis.state = { facts: {} };
  const sent = [];
  const page = { evaluate: async (fn, arg) => { sent.push(Buffer.byteLength(JSON.stringify(arg === undefined ? null : arg))); return fn(arg); } };
  const vici = JSON.stringify(rows);
  await nba.mod.loadStores(page, { VICI_CALL_REPORT: vici, AGENT_LIST: JSON.stringify(rows.slice(0, 3)) }, { maxBytes: MAX, log: () => {} });
  ok('the page ends up with every row of every store', JSON.stringify(globalThis.state.facts.VICI_CALL_REPORT) === vici && globalThis.state.facts.AGENT_LIST.length === 3);
  ok('no single page.evaluate carries more than the budget (+ envelope)', Math.max(...sent) <= MAX + 256, Math.max(...sent) + ' bytes vs ' + vici.length + ' for the whole store');
  delete globalThis.state;
}
{
  const s = src('nba-republish.mjs');
  ok('Chromium and the local server are closed in a finally', /finally\s*\{[^}]*b\.close\(\)[^}]*server\.close\(/.test(s.replace(/\n/g, ' ')) || /finally\s*\{[^}]*server\.close\([^}]*b\.close\(\)/.test(s.replace(/\n/g, ' ')));
  ok('a crashed page is named, not reported as a generic closed target', /page\.on\('crash'/.test(s));
  ok('the whole-store evaluate is gone', !/state\.facts\[s\] = JSON\.parse\(t\)/.test(s));
  ok('it still reads stores through storeText() (spec 013)', /storeText\(/.test(s) && /kv-store\.mjs/.test(s));
}

/* ======================================================================== T2 */
head('T2 · lake-load: twins collapse before the upsert; errors are caught per source');
const lake = await safeImport('lake-load.mjs', ['dedupeByKey', 'upsertStatements', 'loadAll']);
ok('lake-load.mjs exports its loader without connecting to anything', !!lake.mod, lake.why);
if (lake.mod) {
  const { dedupeByKey, upsertStatements, loadAll, MAP } = lake.mod;
  /* the real shape: SF_INACTIVE, 8 017 mapped rows, one identical twin at 7954/7955 (batch B0473) */
  const keyCols = ['account_number', 'contract_number', 'deactivate_date'];
  const mapped = Array.from({ length: 8017 }, (_, i) => ({ account_number: String(10000000 + i), contract_number: String(i), deactivate_date: '2026-10-05', owner: 'o', batch_id: 'B0473' }));
  mapped[7955] = { ...mapped[7954] };
  const d = dedupeByKey(mapped, keyCols);
  ok('the identical twin collapses to one row', d.rows.length === 8016 && d.dropped === 1, d.rows.length + ' / dropped ' + d.dropped);
  const lw = dedupeByKey([{ k: 1, v: 'first' }, { k: 2, v: 'x' }, { k: 1, v: 'last' }], ['k']);
  ok('two rows with one key: the LAST wins (as a sequential upsert would)', lw.rows.length === 2 && lw.rows.find((r) => r.k === 1).v === 'last');
  const m = MAP && MAP.SF_INACTIVE;
  ok('MAP is exported and SF_INACTIVE keys on account/contract/deactivate date', !!m && /account_number, contract_number, deactivate_date/.test(m.conflict));
  if (m) {
    const stm = upsertStatements(m, mapped, 500);
    const dupInChunk = stm.some((st) => { const seen = new Set(); return st.rows.some((o) => { const k = keyCols.map((c) => o[c]).join('|'); if (seen.has(k)) return true; seen.add(k); return false; }); });
    ok('no upsert statement carries one conflict key twice (what Postgres refuses)', !dupInChunk);
    ok('every distinct row is still sent', stm.reduce((a, s) => a + s.rows.length, 0) === 8016);
    ok('the statement is an ON CONFLICT upsert on the identity key', /on conflict \(account_number, contract_number, deactivate_date\) do update set/.test(stm[0].text) && stm[0].params.length === stm[0].rows.length * Object.keys(mapped[0]).length);
  }
  /* a fake client that refuses exactly what Postgres refuses */
  const queries = [];
  const client = { query: async (text, params) => { queries.push(text.slice(0, 40));
    if (/^select count/.test(text)) return { rows: [{ n: 0 }] };
    if (/^insert into sf_inactive/.test(text)) throw Object.assign(new Error('relation "sf_inactive" is locked'), { code: '55P03' });
    return { rows: [] }; } };
  const logs = [];
  const sources = { SF_INACTIVE: [{ account_number: '1', contract_number: '2', deactivate_date: '2026-10-05' }],
    VICI_CALL_REPORT: [{ call_dt: '2026-10-06 09:00:00', _d: '2026-10-06', user_raw: 'cb1', lead_id: '9', status: 'SALE', length_in_sec: '30' }] };
  const out = await loadAll({ client, map: MAP, readRows: async (s) => sources[s] || null, log: (x) => logs.push(x), only: '' });
  ok('a source that fails is reported FAILED…', out.failed.includes('SF_INACTIVE') && logs.some((l) => /SF_INACTIVE.*FAILED.*locked/.test(l)), logs.join(' | '));
  ok('…and the sources after it still load (ViciDial was starved behind SF_INACTIVE since 6 Oct)', queries.some((q) => /^insert into vici_calls/.test(q)), queries.join(' | '));
}
{
  const s = src('lake-load.mjs');
  ok("the pg client has an 'error' listener (a dropped connection is reported, not a crash)", /client\.on\('error'/.test(s));
  ok('the client is closed in a finally', /finally\s*\{[^}]*client\.end\(/.test(s.replace(/\n/g, ' ')));
  ok('the s()/ts()/tsSast() block verify-vici-tz lifts is still intact', s.indexOf('const s = (v) =>') > 0 && s.indexOf('const idish') > s.indexOf('const tsSast'));
}

/* ======================================================================== T4 */
head('T4 · ops-relay: leaves when there is nothing to do, names the cause last');
const relay = await safeImport('ops-relay.mjs', ['relayDone', 'relayVerdict']);
ok('ops-relay.mjs exports its decisions without minting a session', !!relay.mod, relay.why);
if (relay.mod) {
  const { relayDone, relayVerdict } = relay.mod;
  ok('before the page has asked for the manifest: keep waiting', relayDone({ manifestSeen: false, busy: false, pulls: 0, quietMs: 999999 }) === false);
  ok('manifest read, relay idle, nothing pulled: leave now (not after the whole --wait)', relayDone({ manifestSeen: true, busy: false, pulls: 0, quietMs: 15000 }) === true);
  ok('the relay still busy: keep waiting', relayDone({ manifestSeen: true, busy: true, pulls: 0, quietMs: 60000 }) === false);
  ok('files pulled: leave only after 30 s of quiet', relayDone({ manifestSeen: true, busy: false, pulls: 2, quietMs: 20000 }) === false && relayDone({ manifestSeen: true, busy: false, pulls: 2, quietMs: 31000 }) === true);
  const v1 = relayVerdict({ writes: [{ key: 'cb-facts-QA_EVALUATIONS', status: 200, body: '' }, { key: 'cb-facts-VICI_CALL_REPORT', status: 400, body: '{"error":"could not decompress the upload: Memory limit exceeded before EOF."}' }], busyAtDeadline: false, manifestSeen: true, manifestStatus: 200, maxWaitS: 600 });
  ok('a refused save fails the run and the cause names the store, status and reason', v1.failed && /FAILED/.test(v1.line) && /VICI_CALL_REPORT/.test(v1.line) && /400/.test(v1.line) && /Memory limit exceeded/.test(v1.line), v1.line);
  const v2 = relayVerdict({ writes: [], busyAtDeadline: true, manifestSeen: true, manifestStatus: 200, maxWaitS: 600 });
  ok('a deadline fails the run and says so', v2.failed && /DEADLINE|still loading/.test(v2.line), v2.line);
  const v3 = relayVerdict({ writes: [], busyAtDeadline: false, manifestSeen: true, manifestStatus: 401, maxWaitS: 600 });
  ok('an unreadable manifest fails the run with its status', v3.failed && /manifest/.test(v3.line) && /401/.test(v3.line), v3.line);
  const v4 = relayVerdict({ writes: [], busyAtDeadline: false, manifestSeen: false, manifestStatus: 0, maxWaitS: 600 });
  ok('a page that never asked for the manifest is a failed relay, not a quiet day', v4.failed && /never/.test(v4.line), v4.line);
  const v5 = relayVerdict({ writes: [{ key: 'cb-facts-X', status: 200 }], busyAtDeadline: false, manifestSeen: true, manifestStatus: 200, maxWaitS: 600 });
  ok('a clean run is not failed', !v5.failed, v5.line);
}
{
  const s = src('ops-relay.mjs');
  const iMoved = s.indexOf('stores that moved'), iLine = s.lastIndexOf('verdict.line');
  ok('the cause line is printed LAST (after "stores that moved"), so any tail shows it', iMoved > 0 && iLine > iMoved);
  ok('the wait loop asks relayDone()', /relayDone\(\{/.test(s));
  ok('the session is still deleted in finally', /finally\s*\{[\s\S]{0,200}app_sessions\?token_hash=eq\./.test(s));
}

/* ================================================================ REVIEW (T-R1..T-R5) */
head('T-R1 · a step whose tree will not die, or whose pipes outlive it, never keeps the tick process alive');
if (typeof T.runStep === 'function') {
  const fakeR = () => { const c = new EventEmitter(); c.pid = 4343; c.stdout = new PassThrough(); c.stderr = new PassThrough(); c.kill = () => {};
    c.unrefs = 0; c.unref = () => { c.unrefs++; }; return c; };
  let c1 = null;
  const r1 = await Promise.race([T.runStep(['x.mjs'], { timeoutMs: 80, killGraceMs: 120, heartbeatMs: 60000,
    spawnImpl: () => (c1 = fakeR()), killTree: () => false }), sleep(5000).then(() => 'HUNG')]);
  ok('a kill that fails: the result says killFailed', r1 !== 'HUNG' && r1.killFailed === true && r1.timedOut === true, JSON.stringify(r1 === 'HUNG' ? r1 : { killFailed: r1.killFailed }));
  ok('…the child handle is unref\'d (a live child can no longer hold the tick open)', !!c1 && c1.unrefs > 0, c1 ? c1.unrefs + ' unref calls' : 'no child');
  ok('…and its stdio streams are destroyed', !!c1 && c1.stdout.destroyed && c1.stderr.destroyed);
  let c2 = null;
  const r2 = await Promise.race([T.runStep(['x.mjs'], { timeoutMs: 60000, exitGraceMs: 100, heartbeatMs: 60000,
    spawnImpl: () => { c2 = fakeR(); setTimeout(() => c2.emit('exit', 0, null), 30); return c2; } }), sleep(5000).then(() => 'HUNG')]);
  ok('pipes held past the exit (the grace path): the child handle is unref\'d there too', r2 !== 'HUNG' && !!c2 && c2.unrefs > 0, c2 ? c2.unrefs + ' unref calls' : 'no child');

  /* the real thing: a tick process whose step's child survives a failed taskkill must still EXIT — before, its node
     stayed up for ever and Task Scheduler's "do not start a new instance" skipped every later firing */
  const pidF = path.join(TMP, 'stubborn.pid');
  const stub = path.join(TMP, 'stubborn.mjs');
  fs.writeFileSync(stub, `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(pidF)}, String(process.pid)); console.log('stubborn child'); setInterval(() => {}, 1000);\n`);
  const sim = path.join(TMP, 'tick-sim.mjs');
  fs.writeFileSync(sim, `const T = await import(${JSON.stringify(pathToFileURL(path.join(ROOT, 'tools', 'tick-local.mjs')).href)});
const r = await T.runStep([${JSON.stringify(stub)}], { timeoutMs: 1500, killGraceMs: 500, heartbeatMs: 60000, killTree: () => false });
console.log('STEP ' + JSON.stringify({ timedOut: r.timedOut, killFailed: !!r.killFailed }));
`);
  const t0 = Date.now(); let simProc = null;
  const res = await new Promise((resolve) => {
    simProc = spawn(process.execPath, [sim], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = ''; simProc.stdout.on('data', (d) => { out += d; });
    const t = setTimeout(() => resolve({ hung: true, out }), 15000);
    simProc.on('exit', (code) => { clearTimeout(t); resolve({ hung: false, code, out }); });
  });
  if (res.hung) { try { simProc.kill(); } catch {} }
  let spid = 0; try { spid = +fs.readFileSync(pidF, 'utf8'); } catch {}
  ok('(fixture) the step really timed out with a failed kill', /"killFailed":true/.test(res.out), res.out.trim());
  ok('the tick process exits on its own once the step is given up on', !res.hung && Date.now() - t0 < 15000, res.hung ? 'still running after 15 s' : (Date.now() - t0) + ' ms');
  if (spid) { try { process.kill(spid); } catch {} }

  /* main() arms a last-resort exit once the tick is done: an unref'd timer, so a clean run ends at once and a run with
     a handle left behind ends after the grace (never straight after a fetch — the libuv assertion, 2026-09-18) */
  const ex = path.join(TMP, 'exit-sim.mjs');
  fs.writeFileSync(ex, `const T = await import(${JSON.stringify(pathToFileURL(path.join(ROOT, 'tools', 'tick-local.mjs')).href)});
setInterval(() => {}, 1000);   // a handle that never lets go (a leaked child, a socket)
process.exitCode = 3;
if (typeof T.exitIfStuck === 'function') T.exitIfStuck(300);
console.log('armed');
`);
  const e0 = Date.now();
  const er = await new Promise((resolve) => {
    const p = spawn(process.execPath, [ex], { stdio: 'ignore', windowsHide: true });
    const t = setTimeout(() => { try { p.kill(); } catch {} resolve({ hung: true }); }, 10000);
    p.on('exit', (code) => { clearTimeout(t); resolve({ hung: false, code }); });
  });
  ok('exitIfStuck(): a process holding a handle still ends, keeping its exit code', !er.hung && er.code === 3 && Date.now() - e0 < 10000, JSON.stringify(er));
  ok('the entry point arms it after main()', /isMain\(\)\)[\s\S]{0,300}exitIfStuck\(/.test(src('tick-local.mjs')));
} else ok('runStep exists', false, tick.why);
{
  const n = note({ status: null, timedOut: true, killFailed: true, timeoutMs: 20 * 60000, stdout: 'loading\n', stderr: '' });
  ok('a failed kill is in the note — not "process tree killed"', /could NOT be killed/.test(n) && !/process tree killed/.test(n), n);
  const line = typeof T.stepLogLine === 'function' ? T.stepLogLine('nba-republish', { ok: false, timedOut: true, killFailed: true, status: null, ms: 1200000 }, 'x', '', ROOT) : '';
  ok('…and in the tick log line', /TIMED OUT/.test(line) && /NOT killed/.test(line), line || 'stepLogLine is not exported');
  const okLine = typeof T.stepLogLine === 'function' ? T.stepLogLine('rake', { ok: true, status: 0, ms: 4000 }, 'fine', '', ROOT) : '';
  ok('a clean step\'s log line is unchanged', /^rake → ok in 4s — fine$/.test(okLine), okLine);
  if (typeof T.writeStepLog === 'function') {
    const f = T.writeStepLog(path.join(TMP, 'root-kf'), 'nba-republish', { status: null, timedOut: true, killFailed: true, stdout: '', stderr: '', ms: 1 });
    ok('…and in the step log file header', !!f && /process tree NOT killed/.test(fs.readFileSync(f, 'utf8')));
  }
}

head('T-R2 · lake-load stops after a client-side query timeout (the connection stays busy)');
if (lake.mod) {
  const { loadAll, MAP } = lake.mod;
  const qs = [], readFor = [], logs = [];
  const client = { query: async (text) => { qs.push(text.slice(0, 40));
    if (/^select count/.test(text)) return { rows: [{ n: 0 }] };
    if (/^insert into sf_inactive/.test(text)) throw new Error('Query read timeout');
    return { rows: [] }; } };
  const sources = { ATTENDANCE: [{ _d: '2026-10-06', employee_code: 'CB1' }], SF_INACTIVE: [{ account_number: '1', contract_number: '2', deactivate_date: '2026-10-05' }],
    VICI_CALL_REPORT: [{ call_dt: '2026-10-06 09:00:00', _d: '2026-10-06', user_raw: 'cb1', lead_id: '9', status: 'SALE', length_in_sec: '30' }],
    REFERRALS: [{ contact_id: 'c1', ref_date: '2026-10-06' }] };
  const out = await loadAll({ client, map: MAP, readRows: async (s) => { readFor.push(s); return sources[s] || null; }, log: (x) => logs.push(x) });
  const iT = qs.findIndex((q) => /^insert into sf_inactive/.test(q));
  ok('nothing else is sent on the connection after the timeout', iT >= 0 && qs.length === iT + 1, qs.join(' | '));
  ok('…the sources after it are not even read', iT >= 0 && !['VICI_CALL_REPORT', 'REFERRALS', 'CALLX_CALL_RECORDS'].some((s) => readFor.includes(s)), readFor.join());
  ok('…the timed-out source and every remaining one are FAILED', ['SF_INACTIVE', 'VICI_CALL_REPORT', 'REFERRALS', 'CALLX_CALL_RECORDS'].every((s) => (out.failed || []).includes(s))
    && /not attempted/i.test((out.reasons || {}).VICI_CALL_REPORT || ''), JSON.stringify(out.failed) + ' ' + JSON.stringify((out.reasons || {}).VICI_CALL_REPORT));
  ok('…the sources before it are unaffected, and the loader says why it stopped', !(out.failed || []).includes('ATTENDANCE') && /timeout/i.test(String(out.aborted || '')), JSON.stringify(out.aborted));
  const s = src('lake-load.mjs');
  /* behaviour, not source text: since 2026-10-09 the post-load steps live in afterLoad() (tested below with a fake client);
     here: main() hands it `aborted`, and afterLoad returns before any query when aborted */
  ok('main skips the lake audit and the agent_day refresh after a timeout (both would queue behind the stuck query)',
    /await afterLoad\(\{[^}]*aborted/.test(s) && /if \(aborted\)[^\n]*return/.test(s), 'main must pass aborted to afterLoad, and afterLoad must return early on it');
}

head('T-R3 · T-R4 · a stamp has a timeout, and keeps the whole note');
if (js.mod) {
  const { stampJob } = js.mod;
  const res = (status, body) => ({ ok: status < 400, status, json: async () => body });
  const seen = [];
  const spy = async (u, o = {}) => { seen.push(o.signal); return /PATCH/.test(o.method || '') ? res(200, [{}]) : res(200, [{ value: { data: '{"steps":{}}' }, updated_at: 'x' }]); };
  await stampJob({ rest: 'https://x/rest/v1/', headers: {}, step: 'rake', ok: true, note: 'n', fetchImpl: spy });
  ok('every stamp fetch carries a timeout signal (undici would wait 300 s)', seen.length >= 2 && seen.every((sg) => sg && typeof sg.aborted === 'boolean'), seen.length + ' calls, signals: ' + seen.map((sg) => !!sg).join());
  const hang = (u, o = {}) => new Promise((resolve, reject) => { if (o.signal) o.signal.addEventListener('abort', () => reject(o.signal.reason || new Error('aborted'))); });
  const t0 = Date.now();
  const r = await Promise.race([stampJob({ rest: 'https://x/rest/v1/', headers: {}, step: 'rake', ok: true, fetchImpl: hang, timeoutMs: 100 }), sleep(8000).then(() => 'HUNG')]);
  ok('a read that never answers is abandoned at the timeout — the stamp reports and the tick goes on', r !== 'HUNG' && r.ok === false && Date.now() - t0 < 5000, r === 'HUNG' ? 'HUNG' : JSON.stringify(r));
  ok('tools/job-status.mjs uses AbortSignal.timeout on its fetches', (src('job-status.mjs').match(/AbortSignal\.timeout\(/g) || []).length >= 1 && /signal:/.test(src('job-status.mjs')));

  /* T-R4: failureNote may write 300 chars and its "@ file:line" sits at the end — the stamp kept 200 */
  const long = { status: 1, stdout: '', stderr: 'node:internal/modules/run_main:107\n    triggerUncaughtException(\n    ^\n\npage.evaluate: ' + 'the page ran out of memory while parsing '.repeat(5)
    + '\n    at file:///C:/Users/x/agentos/tools/nba-republish.mjs:77:14 {\n  log: []\n}\n\nNode.js v24.18.0\n' };
  const ln = note(long);
  const table1 = { row: { value: { data: '{"steps":{}}' }, updated_at: 'a' } };
  const f1 = async (u, o = {}) => { if ((o.method || 'GET') === 'GET') return res(200, [table1.row]);
    const b = JSON.parse(o.body); table1.row = { value: b.value, updated_at: b.updated_at }; return res(200, [table1.row]); };
  await stampJob({ rest: 'https://x/rest/v1/', headers: {}, step: 'nba-digest', ok: false, note: ln, fetchImpl: f1 });
  const stored = JSON.parse(table1.row.value.data).steps['nba-digest'].note;
  ok('(fixture) the note is longer than 200 and ends with where it was thrown', ln.length > 200 && /@ nba-republish\.mjs:77$/.test(ln), ln.length + ' chars');
  ok('the stamped note keeps the "@ file:line" suffix (one cap, 300, in both)', /@ nba-republish\.mjs:77$/.test(stored) && js.mod.NOTE_MAX === 300, stored.length + ' chars stored, NOTE_MAX ' + js.mod.NOTE_MAX);
}

head('T-R5 · secrets never reach the step log (OneDrive) or kv:jobs-status (every staff session)');
{
  const SVC = 'sb_secret_' + 'Q7'.repeat(16);
  const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2lnbmF0dXJlLXZhbHVlLXg';
  const LOADED = 'pit-' + 'a1b2c3d4'.repeat(4);            // a value from highlevel.env / supabase.env
  const ENVKEY = 'env-' + 'k9'.repeat(12);                  // process.env.SUPABASE_SECRET_KEY
  const prevKey = process.env.SUPABASE_SECRET_KEY; process.env.SUPABASE_SECRET_KEY = ENVKEY;
  if (typeof T.addSecrets === 'function') T.addSecrets([LOADED, 'short-value']);
  const DB = 'postgres://postgres.abcdefgh:Pa55-w0rd!@aws-0-eu-central-1.pooler.supabase.com:6543/postgres';
  const leaky = { status: 1,
    stdout: 'GET https://x.supabase.co/rest/v1/rules?apikey=' + SVC + '&select=v\nFAILED to stamp: password=hunter2hunter2 token=abc123\n',
    stderr: 'Error: request refused — Authorization: Bearer ' + JWT + ' (' + ENVKEY + ')\nFAILED connecting ' + DB + '\nError: HL said no to ' + LOADED + ' (short-value)\n' };
  const SECRETS = [SVC, JWT, 'hunter2hunter2', 'abc123', 'Pa55-w0rd!', LOADED, ENVKEY];
  const red = typeof T.redact === 'function' ? T.redact(leaky.stdout + leaky.stderr) : '';
  ok('redact() removes Bearer tokens, JWTs, key=/token=/password= values, sb_secret_ keys, db passwords, loaded env values',
    !!red && !SECRETS.some((x) => red.includes(x)), red ? SECRETS.filter((x) => red.includes(x)).join(', ') : 'redact is not exported');
  ok('…keeps the database host, the error words and short values', /@aws-0-eu-central-1\.pooler\.supabase\.com:6543/.test(red) && /request refused/.test(red) && /\(short-value\)/.test(red) && /\[redacted\]/.test(red), red);
  const n = note(leaky);
  ok('the failure note (→ kv:jobs-status) carries no secret', !!n && !SECRETS.some((x) => n.includes(x)), SECRETS.filter((x) => n.includes(x)).join(', ') + ' in: ' + n);
  const sn = typeof T.successNote === 'function' ? T.successNote({ stdout: 'ok\nposted with apikey=' + SVC + '\n', stderr: '' }) : '';
  ok('the success note carries none either', !sn.includes(SVC), sn);
  if (typeof T.writeStepLog === 'function') {
    const f = T.writeStepLog(path.join(TMP, 'root-red'), 'referrals', { ...leaky, args: ['tools/sync-referrals.mjs', '--key=' + SVC], ms: 10 });
    const body = f ? fs.readFileSync(f, 'utf8') : '';
    ok('the step log file carries no secret (args included) but keeps the output around them', !!body && !SECRETS.some((x) => body.includes(x)) && /pooler\.supabase\.com/.test(body) && /HL said no/.test(body),
      SECRETS.filter((x) => body.includes(x)).join(', '));
  }
  ok('the tick loads supabase.env AND highlevel.env values into the redactor', /addSecrets\(/.test(src('tick-local.mjs')) && /highlevel\.env/.test(src('tick-local.mjs')));
  if (prevKey === undefined) delete process.env.SUPABASE_SECRET_KEY; else process.env.SUPABASE_SECRET_KEY = prevKey;
}

head('lake-load after the load (2026-10-09): the duplicate report never fails the step, and never blocks the agent_day refresh');
{
  /* every source loaded ("new 0") and the step still said FAILED: `select * from lake_duplicates` (a report over a
     10.2M-row sf_open_cases) passed its 5-minute statement timeout — and agent_day's refresh came AFTER it */
  const lkr = await safeImport('lake-load.mjs', ['afterLoad']); const lk = lkr.mod;
  if (lk && typeof lk.afterLoad === 'function') {
    const fake = (auditThrows) => { const q = []; return { q, client: { query: async (s) => { q.push(s); if (/lake_duplicates/.test(s) && auditThrows) { const e = new Error('canceling statement due to statement timeout'); e.code = '57014'; throw e; } return { rows: [] }; } } }; };
    const a = fake(true); const ra = await lk.afterLoad({ client: a.client, grandOut: 12, aborted: null, dry: false, log: () => {} });
    ok('new rows + a timed-out duplicate report → agent_day is still refreshed', a.q.some((s) => /refresh materialized view concurrently agent_day/.test(s)), a.q.join(' | '));
    ok('…the refresh runs BEFORE the report (data first, report second)', a.q.findIndex((s) => /agent_day/.test(s)) < a.q.findIndex((s) => /lake_duplicates/.test(s)), a.q.join(' | '));
    ok('…and the step is not failed by the report (a warning, not an error)', ra && ra.failed === false && /skipped|timed out|warning/i.test(ra.auditNote || ''), JSON.stringify(ra));
    const b = fake(true); const rb = await lk.afterLoad({ client: b.client, grandOut: 0, aborted: null, dry: false, log: () => {} });
    ok('nothing new loaded → no duplicate report and no refresh (nothing could have changed)', b.q.length === 0 && rb.failed === false, b.q.join(' | '));
    const c = fake(false); await lk.afterLoad({ client: c.client, grandOut: 0, aborted: 'timeout', dry: false, log: () => {} });
    ok('after a query timeout neither runs (the connection may still be busy — T-R2)', c.q.length === 0, c.q.join(' | '));
  } else ok('lake-load exports afterLoad(): the post-load steps as one testable function', false, lkr.why);
}

head('lake-load sends only the days that moved (2026-10-27: "VICI_CALL_REPORT FAILED — chunk 2137/2381: Query read timeout")');
if (lake.mod && lake.mod.changedDays) {
  const { changedDays, loadAll, MAP } = lake.mod;
  const D = { day: 'call_day', sum: 'length_in_sec' };
  const rows = (d, n, sec) => Array.from({ length: n }, () => ({ call_day: d, length_in_sec: sec }));
  const mapped = [...rows('2026-10-20', 3, 10), ...rows('2026-10-21', 2, 10), ...rows('2026-10-22', 4, 10), ...rows('2026-10-23', 2, 10), ...rows('2026-10-24', 1, 10)];
  const lakeSig = [{ d: '2026-10-20', n: 3, s: 30 },   // unchanged
    { d: '2026-10-21', n: 1, s: 10 },                   // the store re-pulled a fuller day
    { d: '2026-10-22', n: 4, s: 35 },                   // same count, seconds corrected
    { d: '2026-10-23', n: 4, s: 40 }];                  // the lake holds twins the store does not have
  const { send, surplus } = changedDays(mapped, lakeSig, D);   // 2026-10-24 is new
  ok('an unchanged day is not sent', !send.has('2026-10-20'));
  ok('a new day, a fuller re-pull and a same-count correction are sent', ['2026-10-24', '2026-10-21', '2026-10-22'].every((d) => send.has(d)), [...send].join());
  ok('a day the lake holds MORE rows for is not sent but named', !send.has('2026-10-23') && JSON.stringify(surplus) === '["2026-10-23"]', JSON.stringify(surplus));
  /* through loadAll with a fake lake: ViciDial sends only the moved day's rows; the log says so */
  const sent = [], logs = [];
  const client = { query: async (text, params) => {
    if (/^select count/.test(text)) return { rows: [{ n: 0 }] };
    if (/^select call_day::text d/.test(text)) return { rows: [{ d: '2026-10-20', n: 1, s: 30 }] };
    if (/^insert into vici_calls/.test(text)) sent.push(params.length);
    return { rows: [] }; } };
  const vici = (d, lead) => ({ call_dt: d + ' 09:00:00', _d: d, user_raw: 'cb1', lead_id: lead, status: 'SALE', length_in_sec: '30' });
  await loadAll({ client, map: { VICI_CALL_REPORT: MAP.VICI_CALL_REPORT }, readRows: async () => [vici('2026-10-20', '1'), vici('2026-10-21', '2'), vici('2026-10-21', '3')], log: (x) => logs.push(x) });
  const cols = Object.keys(MAP.VICI_CALL_REPORT.row(vici('2026-10-20', '1'))).length;
  ok('loadAll sends the moved day only (2 of 3 rows; the unchanged day stays put)', sent.length === 1 && sent[0] === 2 * cols, JSON.stringify(sent));
  ok('…and the log line says how many days were sent', logs.some((l) => /days sent 1 of 2/.test(l)), logs.join(' | '));
  const s = src('lake-load.mjs');
  ok('the session sets its own statement_timeout (the pooler drops the client option)', /set statement_timeout to '300s'/.test(s));
} else ok('lake-load exports changedDays', false);

head('node --check on every Area T tool');
for (const t of ['tick-local.mjs', 'nba-republish.mjs', 'lake-load.mjs', 'ops-relay.mjs', 'job-status.mjs']) {
  const r = spawnSync(process.execPath, ['--check', path.join(ROOT, 'tools', t)], { encoding: 'utf8' });
  ok(t + ' parses', r.status === 0, (r.stderr || '').slice(0, 200));
}

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
process.exit(fail ? 1 : 0);
