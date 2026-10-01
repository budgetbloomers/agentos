#!/usr/bin/env node
/**
 * verify-coaching-wave.mjs — the Coaching Hub copy refreshes again, and says so when it does not.
 *
 *   node nicks_code/diagnostics/verify-coaching-wave.mjs
 *
 * ROOT CAUSE (spec 001-cm-view-signoff, research R7, proven live 2026-10-01): kv:coaching was last written
 * 2026-09-21. The Hub grew to 23 leaders; a wave of 2 collections × 23 leaders = 46 Convex calls plus
 * teamLeaders:list, three Supabase reads and the cron-log write is more than the Free plan's 50 subrequests
 * per invocation, so every wave died before it saved anything — and the only trace was a console.warn.
 *
 * snapshotCoachingWave now walks (collection, leader) pairs in chunks of at most 35 Convex calls per
 * invocation, keeps a pointer in kv:coaching-waves, writes the snapshot only when EVERY pair is done, and
 * records every attempt in kv:coaching-wave-log. Health raises `coaching-stale` when the copy is over 26 h old
 * on a working day. Pure: an in-memory DB and a stub Convex — nothing leaves the machine.
 *
 *   1 the budget      — 30 leaders × 6 collections: every invocation ≤ 35 Convex calls and ≤ 45 subrequests
 *   2 the pointer     — resumes; the snapshot is written ONLY when every pair is in; same shape as before
 *   3 the wave log    — one entry per invocation, last 20 kept; a fresh copy is skipped without a log line
 *   4 failure         — an all-failed chunk does not advance the pointer and is logged; one bad pair is reported
 *   5 a stale pointer — a pull older than 3 h starts over
 *   6 health          — coaching-stale at > 26 h on a working day, clears itself, names the wave log
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = (f) => pathToFileURL(path.join(HERE, '..', '..', 'worker', 'src', f)).href;

let pass = 0, fail = 0;
const ok = (name, cond, note) => { if (cond) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (note !== undefined ? ' — ' + note : '')); } };
const head = (t) => console.log('\n' + t);

const { snapshotCoachingWave } = await import(SRC('coaching.mjs'));
const { evaluateFreshness, runHealthChecks } = await import(SRC('health.mjs'));

/* ------------------------------------------------------------------ the world */
const HUB = 'https://hub.test';
const COLLECTIONS = ['formalCoachingCalls', 'informalCoaching', 'qualityCoaching', 'leadManagementCoaching', 'groupCoaching', 'qualityAssuranceCoaching'];
const N_LEADERS = 30;
const leaders = Array.from({ length: N_LEADERS }, (_, i) => ({ _id: 'L' + (i + 1), name: 'Leader ' + (i + 1) }));

let SUB = 0;                 // subrequests this invocation (Convex + Storage + every DB call)
let CONVEX = 0;              // Convex calls this invocation
let FAIL_PAIR = () => false; // which (collection, leader) pairs the stub Hub refuses
let STORAGE_PUTS = 0;
let WRITES = 0;              // DB inserts + deletes + storage puts (a read failure must cause none)
let SELECT_FAILS = false;    // a transient PostgREST read failure
const RULES = {};            // key -> { value, updated_at }

globalThis.fetch = async (url, opts) => {
  SUB++;
  const u = String(url);
  if (u.startsWith(HUB + '/api/query')) {
    CONVEX++;
    const { path: p, args } = JSON.parse(opts.body);
    if (p === 'teamLeaders:list') return { ok: true, status: 200, json: async () => ({ status: 'success', value: leaders }) };
    const coll = p.split(':')[0];
    if (FAIL_PAIR(coll, args.teamLeaderId)) return { ok: false, status: 500, json: async () => ({}) };
    const li = Number(args.teamLeaderId.slice(1));
    const ci = COLLECTIONS.indexOf(coll);
    const rows = [0, 1].map((k) => ({ _id: coll + args.teamLeaderId + k, date: '2026-09-' + String(10 + ((li + ci + k) % 15)),
      employeeCode: 'CB' + (100 + li), agentName: 'Agent ' + li, teamLeaderName: 'Leader ' + li,
      supportProvided: 'Role play ' + k, clusterGap: 'gap.customer_verification' }));
    return { ok: true, status: 200, json: async () => ({ status: 'success', value: rows }) };
  }
  if (u.includes('/storage/v1/object/raw/kv/coaching')) { STORAGE_PUTS++; WRITES++; RULES.__lastPut = JSON.parse(opts.body); return { ok: true, status: 200 }; }
  throw new Error('unstubbed fetch ' + u);
};

const keysOf = (q) => { const m = /key=in\.\(([^)]*)\)/.exec(q); return m ? decodeURIComponent(m[1]).split(',') : null; };
const DB = {
  select: async (q) => {
    SUB++;
    if (SELECT_FAILS) throw new Error('supabase GET rules → 503');
    if (q.startsWith('rules?key=in.')) { const ks = keysOf(q) || []; return ks.filter((k) => RULES[k]).map((k) => ({ key: k, value: RULES[k].value, updated_at: RULES[k].updated_at })); }
    if (q.startsWith('rules?key=eq.')) { const k = decodeURIComponent(q.split('eq.')[1].split('&')[0]); return RULES[k] ? [{ key: k, value: RULES[k].value, updated_at: RULES[k].updated_at }] : []; }
    return [];
  },
  insert: async (table, rows) => { SUB++; WRITES++; for (const r of rows) RULES[r.key] = { value: r.value, updated_at: r.updated_at || new Date().toISOString() }; },
  del: async (q) => { SUB++; WRITES++; const k = decodeURIComponent(q.split('eq.')[1]); delete RULES[k]; },
  update: async () => { SUB++; }, rpc: async () => { SUB++; return null; }, storageGet: async () => { SUB++; return null; },
};
const env = { COACHING_HUB_URL: HUB, SUPABASE_URL: 'https://sb.test', SUPABASE_SECRET_KEY: 'k' };

const reset = () => { for (const k of Object.keys(RULES)) delete RULES[k]; STORAGE_PUTS = 0; WRITES = 0; SELECT_FAILS = false; FAIL_PAIR = () => false; globalThis.__coachCache = null; };
const run = async (nowMs) => { SUB = 0; CONVEX = 0; try { return { r: await snapshotCoachingWave(env, DB, nowMs), sub: SUB, convex: CONVEX }; } catch (e) { return { err: e, sub: SUB, convex: CONVEX }; } };
const logOf = () => { const v = RULES['kv:coaching-wave-log']; if (!v) return []; try { return JSON.parse(v.value.data).entries; } catch { return []; } };

const T0 = Date.parse('2026-10-01T08:00:00Z');
const STEP = 20 * 60000;     // the coaching cron runs every 20 minutes

/* ------------------------------------------------------------------ 1 budget + 2 pointer */
head('1 · the budget: 30 leaders × 6 collections never exceeds the Free plan, whatever the invocation');
reset();
const runs = [];
let now = T0, guard = 0;
for (;;) {
  const x = await run(now); runs.push(x); now += STEP;
  if (x.err || (x.r && x.r.written) || ++guard > 12) break;
}
ok('the pull finishes, in more than one invocation (it cannot fit in one)', runs.length > 1 && runs.length <= 7 && runs[runs.length - 1].r && runs[runs.length - 1].r.written, runs.map((x) => x.err ? 'ERR ' + x.err.message : JSON.stringify(x.r)).join(' | '));
ok('every invocation makes at most 35 Convex calls', runs.every((x) => x.convex <= 35), runs.map((x) => x.convex).join(','));
ok('every invocation makes at most 45 subrequests in all (Convex + Supabase + Storage)', runs.every((x) => x.sub <= 45), runs.map((x) => x.sub).join(','));
ok('the work is spread, not all in the last invocation', runs.slice(0, -1).every((x) => x.convex >= 30), runs.map((x) => x.convex).join(','));
ok('the snapshot is written exactly once — only when every pair is in', STORAGE_PUTS === 1, 'puts=' + STORAGE_PUTS);

head('2 · the pointer resumes, and the snapshot has the shape it always had');
{
  reset();
  const a = await run(T0);
  ok('step 1 reports its place (wave/of) and writes the pointer, not the snapshot',
    a.r && a.r.wave === 1 && a.r.of > 1 && !!RULES['kv:coaching-waves'] && !RULES['kv:coaching'] && STORAGE_PUTS === 0, JSON.stringify(a.r));
  const ptr1 = RULES['kv:coaching-waves'].value;
  const b = await run(T0 + STEP);
  const ptr2 = RULES['kv:coaching-waves'] && RULES['kv:coaching-waves'].value;
  ok('step 2 continues from the pointer (the next pair index moved on, same pull)',
    b.r && b.r.wave === 2 && ptr2 && ptr2.next > ptr1.next && ptr2.startedAt === ptr1.startedAt, JSON.stringify([ptr1.next, ptr2 && ptr2.next]));
  /* finish it */
  let t = T0 + 2 * STEP, last = b;
  for (let i = 0; i < 8 && !(last.r && last.r.written); i++, t += STEP) last = await run(t);
  const row = RULES['kv:coaching'] && RULES['kv:coaching'].value;
  const snap = RULES.__lastPut;
  ok('the kv:coaching pointer row is {store, bytes, sessions, fetchedAt}', row && row.store === 'raw/kv/coaching' && row.sessions === snap.sessions.length && !!row.fetchedAt && row.bytes > 0, JSON.stringify(row));
  ok('every pair is in the snapshot: 30 leaders × 6 collections × 2 records = 360 sessions', snap && snap.sessions.length === 360, snap && snap.sessions.length);
  ok('snapshot keys are fetchedAt, hub, leaders, sessions, errors, by', snap && ['fetchedAt', 'hub', 'leaders', 'sessions', 'errors', 'by'].every((k) => k in snap) && snap.by === 'coaching-cron' && snap.errors.length === 0);
  ok('leaders travel as {id, name} for all 30', snap && snap.leaders.length === 30 && snap.leaders[0].id === 'L1' && snap.leaders[0].name === 'Leader 1');
  ok('sessions are normalised (cb, date, label type, hubTeamLeaderId) and newest first',
    snap && snap.sessions[0].cb && snap.sessions[0].hubTeamLeaderId && snap.sessions[0].typeLabel && snap.sessions.every((s, i, a) => i === 0 || a[i - 1].date >= s.date));
  ok('the pointer is gone once the snapshot is in', !RULES['kv:coaching-waves']);
  ok('the next invocation inside two hours is a no-op', (await run(t)).r.skipped === 'fresh');
}

/* ------------------------------------------------------------------ 3 wave log */
head('3 · every invocation is written to kv:coaching-wave-log (last 20 kept)');
{
  reset();
  const a = await run(T0);
  let log = logOf();
  ok('the first invocation left one entry', log.length === 1, JSON.stringify(log));
  const e = log[0] || {};
  ok('entry = {at, step, of, pairs, sessions, error}', ['at', 'step', 'of', 'pairs', 'sessions', 'error'].every((k) => k in e) && e.step === 1 && e.of === a.r.of && e.pairs > 0 && e.sessions > 0 && e.error === null, JSON.stringify(e));
  /* a fresh copy is not an attempt */
  let t = T0 + STEP, last = a;
  for (let i = 0; i < 8 && !(last.r && last.r.written); i++, t += STEP) last = await run(t);
  const n = logOf().length;
  await run(t); await run(t + STEP);
  ok('skipping a fresh copy writes no log line (a quiet day must not push the real history out)', logOf().length === n, n + ' → ' + logOf().length);
  /* four full pulls = 24+ entries; the log keeps 20 */
  for (let cycle = 0; cycle < 3; cycle++) {
    t += 3 * 3600000;
    let l2 = { r: {} };
    for (let i = 0; i < 9 && !(l2.r && l2.r.written); i++, t += STEP) l2 = await run(t);
  }
  log = logOf();
  ok('only the last 20 entries are kept', log.length === 20, 'length ' + log.length);
  ok('and they are the newest, in time order', log.every((x, i, arr) => i === 0 || arr[i - 1].at <= x.at));
}

/* ------------------------------------------------------------------ 4 failure */
head('4 · a Hub that cannot be reached is logged, not silent — and does not eat the pull');
{
  reset();
  await run(T0);
  const before = RULES['kv:coaching-waves'].value.next;
  FAIL_PAIR = () => true;
  const x = await run(T0 + STEP);
  ok('an all-failed chunk throws (the caller can say so)', !!x.err, x.err ? '' : JSON.stringify(x.r));
  ok('the pointer did not advance past pairs that were never read', RULES['kv:coaching-waves'].value.next === before, RULES['kv:coaching-waves'].value.next + ' vs ' + before);
  const last = logOf().slice(-1)[0] || {};
  ok('the log records the failure: error set, no sessions', !!last.error && last.sessions === 0, JSON.stringify(last));
  FAIL_PAIR = () => false;
  const y = await run(T0 + 2 * STEP);
  ok('the next invocation retries the same place and succeeds', y.r && !y.err && y.r.wave === 2, JSON.stringify(y.r) + (y.err ? y.err.message : ''));
}
{
  reset();
  FAIL_PAIR = (coll, id) => coll === 'groupCoaching' && id === 'L7';
  let last = {}, t = T0;
  for (let i = 0; i < 9 && !(last.r && last.r.written); i++, t += STEP) last = await run(t);
  const snap = RULES.__lastPut;
  ok('one bad pair is reported in snapshot.errors and the rest still lands', snap && snap.errors.length === 1 && /groupCoaching\/Leader 7/.test(snap.errors[0]) && snap.sessions.length === 358, snap && JSON.stringify(snap.errors) + ' ' + snap.sessions.length);
}

/* ------------------------------------------------------------------ 5 stale pointer */
head('5 · a pull that never finished is abandoned after 3 hours');
{
  reset();
  await run(T0);
  const started = RULES['kv:coaching-waves'].value.startedAt;
  const x = await run(T0 + 4 * 3600000);
  ok('a 4-hour-old pointer starts over at step 1 with a new start time', x.r && x.r.wave === 1 && RULES['kv:coaching-waves'].value.startedAt !== started, JSON.stringify(x.r));
}
{
  reset();
  RULES['kv:coaching-waves'] = { value: { startedAt: new Date(T0).toISOString(), leaders: [{ _id: 'X', name: 'X' }], parts: [{ sessions: [], errors: [] }] }, updated_at: new Date(T0).toISOString() };   // the OLD wave format
  const x = await run(T0 + STEP);
  ok('a pointer left by the old three-wave code is ignored, not mis-read', x.r && x.r.wave === 1 && !x.err, JSON.stringify(x.r) + (x.err ? x.err.message : ''));
}

/* ------------------------------------------------------------------ 7 partial failure */
head('7 · a pair that fails is RETRIED (2 attempts), and an unresolved one makes the snapshot say it is incomplete');
{
  reset();
  let calls = 0;
  FAIL_PAIR = (coll, id) => { if (coll === 'informalCoaching' && id === 'L3') { calls++; return calls === 1; } return false; };   // fails once (a 429), then works
  const runs2 = []; let t = T0, last = {}, ptr1 = null;
  for (let i = 0; i < 12 && !(last.r && last.r.written); i++, t += STEP) { last = await run(t); runs2.push(last); if (i === 0) ptr1 = JSON.parse(JSON.stringify(RULES['kv:coaching-waves'].value)); }
  ok('after step 1 the failed pair is KEPT in the pointer with one attempt', ptr1 && Array.isArray(ptr1.failed) && ptr1.failed.length === 1 && ptr1.failed[0].tries === 1, JSON.stringify(ptr1 && ptr1.failed));
  const snap = RULES.__lastPut;
  ok('the retry succeeded: all 360 sessions, no errors, NOT incomplete', snap && snap.sessions.length === 360 && snap.errors.length === 0 && !snap.incomplete, snap && snap.sessions.length + ' ' + JSON.stringify(snap.errors));
  ok('the pair was called exactly twice (first attempt + one retry)', calls === 2, 'calls ' + calls);
  ok('every invocation, retries included, stays within the budget', runs2.every((x) => x.convex <= 35 && x.sub <= 45), runs2.map((x) => x.convex + '/' + x.sub).join(','));
  ok('the kv:coaching row carries no incomplete flag', !RULES['kv:coaching'].value.incomplete);
}
{
  reset();
  let calls = 0;
  FAIL_PAIR = (coll, id) => { if (coll === 'groupCoaching' && id === 'L7') { calls++; return true; } return false; };
  let last = {}, t = T0;
  for (let i = 0; i < 14 && !(last.r && last.r.written); i++, t += STEP) last = await run(t);
  const snap = RULES.__lastPut, row = RULES['kv:coaching'].value, entry = logOf().slice(-1)[0] || {};
  ok('a pair that keeps failing is tried twice and no more', calls === 2, 'calls ' + calls);
  ok('the snapshot says incomplete:true and names the leaders whose pairs failed', snap && snap.incomplete === true && snap.failedLeaders.length === 1 && snap.failedLeaders[0].name === 'Leader 7' && snap.failedLeaders[0].id === 'L7', JSON.stringify(snap && [snap.incomplete, snap.failedLeaders]));
  ok('the kv:coaching ROW carries the same (health reads the row, never Storage)', row.incomplete === true && row.failedLeaders[0].name === 'Leader 7', JSON.stringify(row));
  ok('the wave log final entry records it', entry.incomplete === true && entry.failedLeaders && entry.failedLeaders[0].name === 'Leader 7' && 'error' in entry, JSON.stringify(entry));
  ok('the failed pair is reported in snapshot.errors as well', snap.errors.length === 1 && /groupCoaching\/Leader 7/.test(snap.errors[0]));
  const again = await run(t + 70 * 60000);
  ok('an incomplete copy is re-pulled after an hour, not two', again.r && !again.r.skipped, JSON.stringify(again.r));
}
{
  reset(); let last = {}, t = T0;
  for (let i = 0; i < 9 && !(last.r && last.r.written); i++, t += STEP) last = await run(t);
  ok('a complete copy IS still skipped inside two hours', (await run(t + 70 * 60000)).r.skipped === 'fresh');
}

/* ------------------------------------------------------------------ 8 read failure */
head('8 · a failed read of the pointer is not "no pointer" — it writes nothing and restarts nothing');
{
  reset();
  await run(T0);
  const before = JSON.stringify(RULES['kv:coaching-waves']);
  WRITES = 0; SELECT_FAILS = true;
  const warn = console.warn; let warned = ''; console.warn = (...a) => { warned += a.join(' '); };
  const x = await run(T0 + STEP);
  console.warn = warn; SELECT_FAILS = false;
  ok('returns without throwing and says why', x.r && x.r.skipped === 'read-failed' && !x.err, JSON.stringify(x.r) + (x.err ? x.err.message : ''));
  ok('wrote NOTHING (no insert, no delete, no Storage put)', WRITES === 0, 'writes ' + WRITES);
  ok('and made no Convex call (it did not start a new pull)', x.convex === 0, 'convex ' + x.convex);
  ok('the pointer is exactly as it was', JSON.stringify(RULES['kv:coaching-waves']) === before);
  ok('the failure is logged (console), not swallowed', /read/i.test(warned), warned);
  const y = await run(T0 + 2 * STEP);
  ok('the next invocation resumes the SAME pull (step 2, not step 1)', y.r && y.r.wave === 2, JSON.stringify(y.r));
}

/* ------------------------------------------------------------------ 6 health */
head('6 · health: coaching-stale (warning, > 26 h, working day) — and it clears itself');
{
  const WED = Date.parse('2026-10-07T08:00:00Z');                       // Wednesday 10:00 SAST
  const ago = (h) => new Date(WED - h * 3600000).toISOString();
  const a = evaluateFreshness({ now: WED, coachingAt: ago(27) });
  const c = a.find((x) => x.id === 'coaching-stale');
  ok('27 h old on a Wednesday raises coaching-stale as a warning', !!c && c.severity === 'warning', JSON.stringify(a.map((x) => x.id)));
  ok('the message names the copy\'s age and the wave log', c && /26 hours|hours old|days/.test(c.message) && /coaching-wave-log/.test(c.message) && /SAST/.test(c.message), c && c.message);
  ok('the alert is stable across ticks (no per-tick rewrite): same message ten minutes later',
    c && evaluateFreshness({ now: WED + 600000, coachingAt: ago(27) }).find((x) => x.id === 'coaching-stale').message === c.message);
  ok('25 h old is still fine', !evaluateFreshness({ now: WED, coachingAt: ago(25) }).some((x) => x.id === 'coaching-stale'));
  ok('it clears itself the moment the copy is fresh', !evaluateFreshness({ now: WED, coachingAt: ago(0.1) }).some((x) => x.id === 'coaching-stale'));
  const SUN = Date.parse('2026-10-04T08:00:00Z');
  ok('on a Sunday nobody is working, so a 40-hour-old copy raises nothing', !evaluateFreshness({ now: SUN, coachingAt: new Date(SUN - 40 * 3600000).toISOString() }).some((x) => x.id === 'coaching-stale'));
  ok('a collector that does not pass coachingAt (older callers) raises nothing', !evaluateFreshness({ now: WED }).some((x) => x.id === 'coaching-stale'));
  { const inc = [{ id: 'L7', name: 'Leader 7' }, { id: 'L9', name: 'Leader 9' }];
    const c = evaluateFreshness({ now: WED, coachingAt: ago(0.5), coachingIncomplete: inc }).find((x) => x.id === 'coaching-incomplete');
    ok('an incomplete copy raises coaching-incomplete (warning) naming the leaders', !!c && c.severity === 'warning' && /Leader 7/.test(c.message) && /Leader 9/.test(c.message) && /coaching-wave-log/.test(c.message), c && c.message);
    ok('...even though the copy is fresh (coaching-stale stays quiet)', !evaluateFreshness({ now: WED, coachingAt: ago(0.5), coachingIncomplete: inc }).some((x) => x.id === 'coaching-stale'));
    ok('...and it clears when the list is empty or absent', !evaluateFreshness({ now: WED, coachingAt: ago(0.5), coachingIncomplete: [] }).some((x) => x.id === 'coaching-incomplete') && !evaluateFreshness({ now: WED, coachingAt: ago(0.5) }).some((x) => x.id === 'coaching-incomplete'));
    ok('the message is stable across ticks', c && evaluateFreshness({ now: WED + 600000, coachingAt: ago(0.5), coachingIncomplete: inc }).find((x) => x.id === 'coaching-incomplete').message === c.message); }
  ok('a copy that has NEVER been taken is stale too (absent is not fresh)', evaluateFreshness({ now: WED, coachingAt: null }).some((x) => x.id === 'coaching-stale'));
}
{
  /* the collector: runHealthChecks reads kv:coaching's fetchedAt from the rules ROW and passes it on */
  reset();
  const realNow = Date.now; const WED = Date.parse('2026-10-07T08:00:00Z'); Date.now = () => WED;
  try {
    RULES['kv:coaching'] = { value: { store: 'raw/kv/coaching', bytes: 1, sessions: 1, fetchedAt: new Date(WED - 30 * 3600000).toISOString() }, updated_at: new Date(WED - 30 * 3600000).toISOString() };
    let storageReads = 0;
    const DB2 = { ...DB, storageGet: async () => { storageReads++; return null; },
      select: async (q) => { SUB++; if (q.startsWith('rules?key=in.')) return (keysOf(q) || []).filter((k) => RULES[k]).map((k) => ({ key: k, value: RULES[k].value, updated_at: RULES[k].updated_at })); return []; } };
    const out = await runHealthChecks(DB2, { env: {} });
    ok('runHealthChecks raises coaching-stale from the rules row (30 h old)', out.alerts.some((x) => x.id === 'coaching-stale'), JSON.stringify(out.alerts.map((x) => x.id)));
    ok('and it did NOT read Storage for it (the 1.3 MB snapshot stays untouched)', storageReads === 0, 'storage reads ' + storageReads);
    RULES['kv:coaching'].value.fetchedAt = new Date(WED - 3600000).toISOString();
    RULES['kv:coaching'].value.failedLeaders = [{ id: 'L7', name: 'Leader 7' }];
    const out3 = await runHealthChecks(DB2, { env: {} });
    ok('runHealthChecks raises coaching-incomplete from the rules row', out3.alerts.some((x) => x.id === 'coaching-incomplete' && /Leader 7/.test(x.message)), JSON.stringify(out3.alerts.map((x) => x.id)));
    delete RULES['kv:coaching'].value.failedLeaders;
    const out2 = await runHealthChecks(DB2, { env: {} });
    ok('a fresh copy on the next tick clears it', !out2.alerts.some((x) => x.id === 'coaching-stale'));
  } finally { Date.now = realNow; }
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
