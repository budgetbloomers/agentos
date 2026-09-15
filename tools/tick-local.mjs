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
 */
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import { spawnSync } from 'node:child_process'; import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, 'supabase.env'), 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#'))
  .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^"|"$/g, '')]));
const H = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY, 'Content-Type': 'application/json' };
const REST = env.SUPABASE_URL + '/rest/v1/';
const FORCE = process.argv.includes('--force'), CHECK = process.argv.includes('--check');
const HOST = 'local:' + os.hostname();
const SILENT_MIN = 20;                       // the Worker's TICK_OVERDUE_MIN — cron cadence 15 + slack
const LOG = path.join(ROOT, 'reports', 'tick-local.log');
const say = (s) => { const line = new Date().toISOString() + ' ' + s; console.log(line); try { fs.mkdirSync(path.dirname(LOG), { recursive: true }); fs.appendFileSync(LOG, line + '\n'); } catch {} };

/* SAST working hours, like the sentinel: outside them a quiet runner is not a problem to solve */
const sast = new Date(Date.now() + 2 * 3600000);
const working = sast.getUTCDay() >= 1 && sast.getUTCDay() <= 5 && sast.getUTCHours() >= 6 && sast.getUTCHours() < 20;

const cur = (await (await fetch(REST + 'rules?key=eq.kv:jobs-status&select=value', { headers: H })).json())[0];
let doc = { steps: {} };
try { const v = (cur && cur.value) || {}; doc = v.steps ? v : (v.data ? JSON.parse(v.data) : doc); } catch {}
const TICK = ['agent-digest', 'ops-relay', 'nba-digest'];
const newest = TICK.map((k) => Date.parse((doc.steps[k] || {}).ranAt || 0) || 0).reduce((a, b) => Math.max(a, b), 0);
const silentMin = newest ? Math.round((Date.now() - newest) / 60000) : null;
const due = FORCE || (working && (silentMin == null || silentMin > SILENT_MIN));
say('tick newest ' + (newest ? new Date(newest).toISOString() : 'never') + ' · silent ' + silentMin + ' min · working ' + working + ' · ' + (due ? 'RUN' : 'nothing to do'));
if (CHECK || !due) process.exit(0);

/* one at a time: a second Task Scheduler firing while a tick is still running must not overlap it */
const LOCK = path.join(os.tmpdir(), 'cbx-tick-local.lock');
try { const t = +fs.readFileSync(LOCK, 'utf8'); if (Date.now() - t < 25 * 60000) { say('another local tick is running (lock ' + Math.round((Date.now() - t) / 60000) + ' min old) — skipped'); process.exit(0); } } catch {}
fs.writeFileSync(LOCK, String(Date.now()));

const stamp = async (step, ok, note) => {
  const c2 = (await (await fetch(REST + 'rules?key=eq.kv:jobs-status&select=value', { headers: H })).json())[0];
  let d = { steps: {} }; try { const v = (c2 && c2.value) || {}; d = v.steps ? v : (v.data ? JSON.parse(v.data) : d); } catch {}
  d.steps = d.steps || {};
  d.steps[step] = { ranAt: new Date().toISOString(), ok, note: String(note || '').slice(0, 200), runner: HOST };
  d.updatedAt = new Date().toISOString(); d.lastRunner = HOST;
  await fetch(REST + 'rules?on_conflict=key', { method: 'POST', headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([{ key: 'kv:jobs-status', value: { data: JSON.stringify(d) }, updated_by: 'tick-local', updated_at: d.updatedAt }]) });
};
const run = (label, args) => {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', timeout: 20 * 60000, env: { ...process.env, CBX_RUNNER: HOST } });
  const ok = r.status === 0;
  const tail = String((r.stdout || '') + (r.stderr || '')).trim().split('\n').slice(-2).join(' | ').slice(0, 160);
  say(label + ' → ' + (ok ? 'ok' : 'FAILED (' + r.status + ')') + ' in ' + Math.round((Date.now() - t0) / 1000) + 's — ' + tail);
  return { ok, tail };
};

try {
  const build = run('prepare-site', ['tools/prepare-site.js']);
  if (!build.ok) { say('cannot build site/ — the digests would run the wrong engine; stopping'); process.exit(1); }
  /* the same order as the workflow: the rake first so a file that just landed is in the lake */
  const rake = run('rake', ['tools/rake.mjs']); await stamp('rake', rake.ok, rake.tail);
  const dig = run('agent-digest', ['tools/digest-republish.mjs', '--apply']); await stamp('agent-digest', dig.ok, dig.tail);
  const rel = run('ops-relay', ['tools/ops-relay.mjs', '--wait', '300']); await stamp('ops-relay', rel.ok, rel.tail);
  const nba = run('nba-republish', ['tools/nba-republish.mjs', '--apply']); await stamp('nba-digest', nba.ok, nba.tail);
  say('local tick done');
} finally { try { fs.unlinkSync(LOCK); } catch {} }
