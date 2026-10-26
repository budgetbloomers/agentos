#!/usr/bin/env node
/* verify-health-loud.mjs — FAILURES ARE SAID OUT LOUD (stability plan, 2026-10-26).
 *
 * The lake loader failed on every tick from 12 Oct to 26 Oct (a changed database password) and no banner said so; the
 * database-size banner told people to run VACUUM, which frees nothing when the bytes are live rows; and when the size check
 * could not be read the alert simply disappeared. Proves:
 *   L1  job-status withStep counts a failing run (fails, failingSince) and a success clears it
 *   L2  a non-verify step failing 3 times running, or for 2 hours, raises scheduled-step-failing; once does not
 *   L3  a password failure names SUPABASE_DB_URL in agentos/supabase.env; the rake / lake steps are critical
 *   L4  dbForecast: growth per day and the date the 6 GB line is reached, from one sample a day
 *   L5  the database-size alert names the growth and the fix, mentions VACUUM only for dead rows, and fires early
 *   L6  an unreadable size check is an alert, not silence
 *   L7  runHealthChecks stores one size sample per SAST day and no more
 *
 *   node nicks_code/diagnostics/verify-health-loud.mjs
 */
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
process.env.TZ = 'UTC';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const health = await import(pathToFileURL(path.join(ROOT, 'worker', 'src', 'health.mjs')).href);
const { withStep } = await import(pathToFileURL(path.join(ROOT, 'tools', 'job-status.mjs')).href);
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m + (d ? ' — ' + d : '')); } };
const head = (t) => console.log('\n' + t);
const H = 3600000, GB = 1073741824;
const NOW = Date.parse('2026-10-26T09:30:00Z');   // Monday 11:30 SAST
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();
const byId = (alerts, id) => alerts.find((a) => a.id === id);

head('L1 · a failing step remembers how long it has been failing');
let d = { steps: {} };
d = withStep(d, 'lake-load', { ranAt: iso(3 * H), ok: false, note: 'x' }, iso(3 * H));
ok(d.steps['lake-load'].fails === 1 && d.steps['lake-load'].failingSince === iso(3 * H), 'first failure: fails 1, since that run');
d = withStep(d, 'lake-load', { ranAt: iso(2 * H), ok: false, note: 'x' }, iso(2 * H));
d = withStep(d, 'lake-load', { ranAt: iso(1 * H), ok: false, note: 'x' }, iso(1 * H));
ok(d.steps['lake-load'].fails === 3 && d.steps['lake-load'].failingSince === iso(3 * H), 'third failure: fails 3, since the FIRST of the run', JSON.stringify(d.steps['lake-load']));
const healed = withStep(d, 'lake-load', { ranAt: iso(0), ok: true, note: 'loaded' }, iso(0));
ok(healed.steps['lake-load'].ok === true && healed.steps['lake-load'].fails === undefined && healed.steps['lake-load'].failingSince === undefined, 'a success clears the run');
const legacy = withStep({ steps: { rake: { ranAt: iso(5 * H), ok: false } } }, 'rake', { ranAt: iso(0), ok: false }, iso(0));
ok(legacy.steps.rake.fails === 2 && legacy.steps.rake.failingSince === iso(5 * H), 'an old stamp without counters counts as one failure, since its own run');

head('L2 · a step that keeps failing raises an alert; one failure does not');
const jobsWith = (steps) => ({ jobs: { steps }, now: NOW });
const PW = 'FAILED: password authentication failed for user "postgres" [28P01]';
let a = health.evaluateFreshness(jobsWith({ 'lake-load': { ranAt: iso(10 * 60000), ok: false, note: PW, fails: 1, failingSince: iso(10 * 60000) } }));
ok(!byId(a, 'scheduled-step-failing'), 'one failure ten minutes ago → no alert yet');
a = health.evaluateFreshness(jobsWith({ 'lake-load': { ranAt: iso(10 * 60000), ok: false, note: PW, fails: 3, failingSince: iso(40 * 60000) } }));
ok(!!byId(a, 'scheduled-step-failing'), 'three in a row → alert');
a = health.evaluateFreshness(jobsWith({ 'ops-relay': { ranAt: iso(5 * 60000), ok: false, note: 'DEADLINE', fails: 2, failingSince: iso(2.5 * H) } }));
ok(!!byId(a, 'scheduled-step-failing') && byId(a, 'scheduled-step-failing').severity === 'warning', 'failing for over 2 hours → alert (warning for a non-lake step)');
a = health.evaluateFreshness(jobsWith({ 'lake-load': { ranAt: iso(30 * H), ok: false, note: PW, fails: 9, failingSince: iso(40 * H) } }));
ok(!byId(a, 'scheduled-step-failing'), 'a step that has not run for over a day is not reported as failing now (runner-silent covers that)');
a = health.evaluateFreshness(jobsWith({ 'verify-nightly': { ranAt: iso(H), ok: false, note: 'red', fails: 5, failingSince: iso(9 * H) } }));
ok(!byId(a, 'scheduled-step-failing') && !!byId(a, 'verification-failed'), 'a verify step keeps its own alert and is not reported twice');

head('L3 · the password failure says where the fix goes');
a = health.evaluateFreshness(jobsWith({
  rake: { ranAt: iso(H), ok: false, note: 'error: password authentication failed for user "postgres"', fails: 133, failingSince: '2026-10-12T09:15:16.922Z' },
  'lake-load': { ranAt: iso(20 * 60000), ok: false, note: PW, fails: 133, failingSince: '2026-10-12T09:45:00.000Z' } }));
const s = byId(a, 'scheduled-step-failing');
ok(s && s.severity === 'critical', 'the lake loaders failing → critical');
ok(s && /SUPABASE_DB_URL/.test(s.message) && /agentos\/supabase\.env/.test(s.message), 'the message names SUPABASE_DB_URL in agentos/supabase.env', s && s.message.slice(0, 200));
ok(s && /133 in a row since 2026-10-12 11:15 SAST/.test(s.message), 'the message says how long: 133 in a row since 12 Oct 11:15 SAST', s && s.message.slice(0, 160));
ok(s && s.since === '2026-10-12T09:15:16.922Z', 'since = the start of the oldest failing run (the banner changes only when that does)');

head('L4 · dbForecast — growth per day and when 6 GB is reached');
const hist = [{ d: '2026-10-19', b: 4.2 * GB }, { d: '2026-10-22', b: 4.45 * GB }, { d: '2026-10-25', b: 4.62 * GB }];
const f = health.dbForecast(hist, 4.66 * GB, NOW);
ok(f && f.perDay > 0, 'growth from the oldest sample of the last 14 days', JSON.stringify(f));
const expectPerDay = (4.66 - 4.2) * GB / ((NOW - Date.parse('2026-10-19T12:00:00+02:00')) / 86400000);
ok(f && Math.abs(f.perDay - expectPerDay) < 1, 'perDay = (now − oldest) / days', Math.round(f && f.perDay) + ' vs ' + Math.round(expectPerDay));
ok(f && f.daysToCritical > 0 && /^\d{1,2} (Oct|Nov|Dec)$/.test(f.criticalDate), 'a date for the 6 GB line, e.g. "' + (f && f.criticalDate) + '"');
ok(health.dbForecast([{ d: '2026-10-26', b: 4 * GB }], 4.66 * GB, NOW) === null, 'only today\'s sample → no forecast yet');
ok(health.dbForecast([], 4.66 * GB, NOW) === null, 'no history → no forecast');
const shrink = health.dbForecast([{ d: '2026-10-20', b: 5 * GB }], 4.66 * GB, NOW);
ok(shrink && shrink.daysToCritical === null && shrink.criticalDate === null, 'shrinking → no danger date');

head('L5 · the database-size alert names the growth and the fix — VACUUM only for dead rows');
a = health.evaluateFreshness({ now: NOW, db: { db_bytes: 4.66 * GB, wal_bytes: 134217728, dead_heavy: [{ table: 'sf_open_cases_p20261001', dead: 465219 }] }, dbHistory: hist });
let ds = byId(a, 'database-size');
ok(ds && /4\.66 GB of its 8 GB disk/.test(ds.message) && /a day/.test(ds.message) && /6 GB danger line around/.test(ds.message), 'size, growth per day and the danger date', ds && ds.message.slice(0, 220));
ok(ds && !/run VACUUM/.test(ds.message) && /VACUUM will not free it/.test(ds.message) && /Open Cases retention/.test(ds.message), 'no "run VACUUM" when the bytes are live rows; it names the Open Cases retention', ds && ds.message);
a = health.evaluateFreshness({ now: NOW, db: { db_bytes: 4.1 * GB, dead_heavy: [{ table: 'sf_open_cases_p20260901', dead: 2600000 }] }, dbHistory: [] });
ds = byId(a, 'database-size');
ok(ds && /sf_open_cases_p20260901 carries 3M dead rows — run VACUUM \(ANALYZE\)/.test(ds.message), 'dead rows → VACUUM is named for that table', ds && ds.message);
a = health.evaluateFreshness({ now: NOW, db: { db_bytes: 3.6 * GB }, dbHistory: [{ d: '2026-10-19', b: 1.0 * GB }] });
ds = byId(a, 'database-size');
ok(ds && ds.severity === 'critical', 'under 4 GB but reaching 6 GB within a week → raised early, critical', ds && ds.message);
a = health.evaluateFreshness({ now: NOW, db: { db_bytes: 3.0 * GB }, dbHistory: [{ d: '2026-10-19', b: 2.99 * GB }] });
ok(!byId(a, 'database-size'), 'small and slow → no alert');
a = health.evaluateFreshness({ now: NOW, db: { db_bytes: 6.2 * GB }, dbHistory: hist });
ok(byId(a, 'database-size') && byId(a, 'database-size').severity === 'critical' && !/danger line around/.test(byId(a, 'database-size').message), 'past 6 GB → critical, no "reaches it around"');

head('L6 · an unreadable size check is an alert');
a = health.evaluateFreshness({ now: NOW, dbUnreadable: true });
ok(!!byId(a, 'database-health-unreadable'), 'dbUnreadable → database-health-unreadable');
ok(!byId(health.evaluateFreshness({ now: NOW }), 'database-health-unreadable'), 'older callers that pass nothing raise nothing');

head('L7 · runHealthChecks stores one size sample per SAST day');
const store = {};
const inserts = [];
const DB = {
  select: async (q) => {
    if (q.startsWith('rules?key=in.')) return Object.entries(store).filter(([k]) => decodeURIComponent(q).includes(k)).map(([key, value]) => ({ key, value, updated_at: new Date().toISOString() }));
    const m = /^rules\?key=eq\.([^&]+)/.exec(q);
    if (m) { const k = decodeURIComponent(m[1]); return store[k] ? [{ key: k, value: store[k] }] : []; }
    return [];
  },
  rpc: async (fn) => (fn === 'db_health' ? { db_bytes: 4.66 * GB, wal_bytes: 134217728, dead_heavy: [] } : null),
  insert: async (table, rows) => { for (const r of rows) { store[r.key] = r.value; inserts.push(r.key); } },
  storageGet: async () => '',
};
const realFetch = globalThis.fetch;
globalThis.fetch = async () => new Response('{}', { status: 404 });
await health.runHealthChecks(DB, { env: {} });
const after1 = JSON.parse(store[health.SIZE_KEY].data).samples;
const today = new Date(Date.now() + 2 * H).toISOString().slice(0, 10);
ok(after1.length === 1 && after1[0].d === today && after1[0].b === 4.66 * GB, 'first run: one sample for today', JSON.stringify(after1));
inserts.length = 0;
await health.runHealthChecks(DB, { env: {} });
ok(!inserts.includes(health.SIZE_KEY), 'second run the same day: the sample is not written again');
DB.rpc = async () => { throw new Error('function db_health() does not exist'); };
const r3 = await health.runHealthChecks(DB, { env: {} });
ok(r3.alerts.some((x) => x.id === 'database-health-unreadable'), 'db_health() failing → the unreadable alert reaches the banner');
globalThis.fetch = realFetch;

console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
process.exit(fail ? 1 : 0);
