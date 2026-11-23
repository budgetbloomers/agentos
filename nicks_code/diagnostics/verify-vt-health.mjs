#!/usr/bin/env node
/**
 * verify-vt-health.mjs — the sentinel watches Vehicle Tracking (spec 071, F3 + F4 + F6).
 *
 *   node nicks_code/diagnostics/verify-vt-health.mjs
 *
 *   H1  drift: the Worker module's calendar is PULSE's (@mirror:sa-holidays, byte-identical), its extra holidays and its
 *       gap threshold equal specs/vt_engine_rules.json
 *   H2  the calendar: weekends, SA public holidays and the 4 Nov election day are not working days; files are due at 13:00
 *   H3  the six alerts fire, stay quiet, and clear — pure evaluateVtHealth over fixtures
 *   H4  readVtDigestHead reads the fields the sentinel needs from a REAL VTEngine digest string without parsing it
 *   H5  the plumbing: no VT tables → one read, nothing else, no alert; the weekly trim runs once on a Sunday and is logged
 *   H6  runHealthChecks carries the VT alerts and the VAS alerts are unchanged by them
 *   H7  tools/vt-db-size.mjs: PASS/WARN against plan §DB-5, the agent_list_raw 250k line, and its SQL over migration-071 in
 *       PGlite (rolled back; read-only)
 * Fictional data only. No network.
 */
import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url)); const ROOT = path.resolve(HERE, '..', '..');
const H = await import(pathToFileURL(path.join(ROOT, 'worker', 'src', 'vt-health.mjs')).href);
const { runHealthChecks } = await import(pathToFileURL(path.join(ROOT, 'worker', 'src', 'health.mjs')).href);
const SZ = await import(pathToFileURL(path.join(ROOT, 'tools', 'vt-db-size.mjs')).href);
const { vtDigest } = await import(pathToFileURL(path.join(HERE, 'vt-digest-fixture.mjs')).href);
let pass = 0, fail = 0; const failures = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; failures.push(n + (d ? ' — ' + String(d).slice(0, 300) : '')); console.log('  FAIL ' + n + (d ? ' — ' + String(d).slice(0, 300) : '')); } };
const head = (t) => console.log('\n' + t);
const RULES = JSON.parse(fs.readFileSync(path.join(ROOT, 'specs', 'vt_engine_rules.json'), 'utf8'));
const at = (s) => Date.parse(s);                    // UTC instants; SAST = +2 h
const ids = (a) => a.map((x) => x.id).sort().join();

head('H1 · drift');
const block = (s) => { const m = s.match(/\/\* @mirror:sa-holidays start[\s\S]*?\/\* @mirror:sa-holidays end \*\//); return m && m[0]; };
const pulse = block(fs.readFileSync(path.join(ROOT, 'nicks_code', 'index.html'), 'utf8'));
const mine = block(fs.readFileSync(path.join(ROOT, 'worker', 'src', 'vt-health.mjs'), 'utf8'));
ok('worker/src/vt-health.mjs carries the @mirror:sa-holidays block, byte-identical to PULSE', !!pulse && pulse === mine);
ok('VT_EXTRA_HOLIDAYS equals the rule book periods.extraHolidays', JSON.stringify(H.VT_EXTRA_HOLIDAYS) === JSON.stringify(RULES.periods.extraHolidays), JSON.stringify(RULES.periods.extraHolidays));
ok('the gap threshold equals the rule book guards.uploadGapWorkingDays', H.VT_HEALTH.uploadGapWorkingDays === RULES.guards.uploadGapWorkingDays);
ok('health.mjs wires the VT checks in their own try', /gatherVt\(DB, rows\)/.test(fs.readFileSync(path.join(ROOT, 'worker', 'src', 'health.mjs'), 'utf8')));

head('H2 · the calendar');
ok('Mon 23 Nov 2026 is a working day', H.vtWorkingDay('2026-11-23'));
ok('Sat / Sun are not', !H.vtWorkingDay('2026-11-21') && !H.vtWorkingDay('2026-11-22'));
ok('Heritage Day (24 Sep) and the 4 Nov election day are not', !H.vtWorkingDay('2026-09-24') && !H.vtWorkingDay('2026-11-04'));
ok('Wed 16 Dec (Reconciliation Day) is not', !H.vtWorkingDay('2026-12-16'));
ok('a day\'s files are due from 13:00 SAST: at 12:00 SAST Tue nothing after Monday is due', H.overdueDays('2026-11-23', at('2026-11-24T10:00:00Z')).length === 0);
ok('…at 14:00 SAST Tue, Tuesday is due', H.overdueDays('2026-11-23', at('2026-11-24T12:00:00Z')).join() === '2026-11-24');
ok('a Friday file covers the weekend: Monday 10:00 SAST nothing is due', H.overdueDays('2026-11-20', at('2026-11-23T08:00:00Z')).length === 0);
ok('the election holiday never counts as missing', H.overdueDays('2026-11-03', at('2026-11-05T08:00:00Z')).length === 0);

head('H3 · the alerts');
const T0 = at('2026-11-24T12:30:00Z');                 // Tue 24 Nov 14:30 SAST — business month cycle-2026-12 (26 Nov →) not yet; cycle-2026-11
const up = (kind, day, o = {}) => ({ kind, state: 'committed', extract_on: day, committed_at: day + 'T07:00:00Z', started_at: day + 'T06:58:00Z', ...o });
const fresh = [up('bi_fitted', '2026-11-24'), up('sched_missed', '2026-11-24'), up('bi_fitted', '2026-11-23'), up('sched_missed', '2026-11-23')];
const dg = (o = {}) => ({ period: { key: 'cycle-2026-11', from: '2026-10-26', to: '2026-11-25', asOf: '2026-11-24' }, updatedAt: '2026-11-24T07:05:00Z', empty: false,
  budgetCycle: 'cycle-2026-11', noBudgets: false, unmatched: { sellers: 2, cases: 20 }, floorSales: 1700, gapDays: 0, ...o });
const quiet = H.evaluateVtHealth({ now: T0, uploads: fresh, digest: dg(), size: { vt_cases: { rows: 3000, bytes: 2e6 } } });
ok('a healthy VT pipeline raises nothing', quiet.length === 0, ids(quiet));
ok('uploads unreadable (migration 071 not applied) → no opinion at all', H.evaluateVtHealth({ now: T0, uploads: undefined, digest: null }).length === 0 && H.evaluateVtHealth({ now: T0, uploads: null }).length === 0);
ok('no VT upload ever → nothing (VT not started)', H.evaluateVtHealth({ now: T0, uploads: [], digest: null }).length === 0);
{ const a = H.evaluateVtHealth({ now: T0, uploads: fresh, digest: dg({ updatedAt: '2026-11-23T07:05:00Z' }) });
  const s = a.find((x) => x.id === 'vt-digest-stale');
  ok('an upload committed after the figures were published → vt-digest-stale', !!s && /published 2026-11-23 09:05 SAST, before the newest VT upload \(2026-11-24 09:00 SAST\)/.test(s.message), s && s.message);
  ok('…which says who can fix it (the Upload Station grant) and how', !!s && /Upload Station/.test(s.message) && /Vehicle Tracking/.test(s.message)); }
ok('an upload 10 minutes old is not stale yet', !H.evaluateVtHealth({ now: at('2026-11-24T07:10:00Z'), uploads: fresh, digest: dg({ updatedAt: '2026-11-23T07:05:00Z' }) }).some((x) => x.id === 'vt-digest-stale'));
ok('files loaded but nothing ever published → stale, in words', /never been published/.test((H.evaluateVtHealth({ now: T0, uploads: fresh, digest: null }).find((x) => x.id === 'vt-digest-stale') || {}).message || ''));
{ const T1 = at('2026-11-27T12:30:00Z');             // Fri 27 Nov: business month cycle-2026-12 has begun
  const u = [up('bi_fitted', '2026-11-27'), up('sched_missed', '2026-11-27')];
  const a = H.evaluateVtHealth({ now: T1, uploads: u, digest: dg({ updatedAt: '2026-11-27T07:30:00Z' }) });
  ok('figures still for last business month while this one has files → stale (names both months)', /still November 2026 while December 2026 files/.test((a.find((x) => x.id === 'vt-digest-stale') || {}).message || ''), ids(a)); }
{ const a = H.evaluateVtHealth({ now: T0, uploads: [up('bi_fitted', '2026-11-24'), up('sched_missed', '2026-11-20')], digest: dg() });
  const g = a.find((x) => x.id === 'vt-upload-gap');
  ok('two working days with no Scheduled & Missed → vt-upload-gap, critical, naming the days', !!g && g.severity === 'critical' && /Scheduled & Missed file since Fri 20 Nov \(missing: Mon 23 Nov, Tue 24 Nov\)/.test(g.message), g && g.message);
  ok('…the BI file that is up to date is not named', !!g && !/BI Active Fitted/.test(g.message)); }
{ const a = H.evaluateVtHealth({ now: T0, uploads: [up('bi_fitted', '2026-11-23'), up('sched_missed', '2026-11-24')], digest: dg() });
  const g = a.find((x) => x.id === 'vt-upload-gap');
  ok('one working day missing → warning', !!g && g.severity === 'warning' && /BI Active Fitted file since Mon 23 Nov/.test(g.message), g && g.message);
  ok('…and it clears the tick the file lands', !H.evaluateVtHealth({ now: T0, uploads: fresh, digest: dg() }).some((x) => x.id === 'vt-upload-gap')); }
{ const st = [...fresh, { kind: 'bi_fitted', state: 'staging', extract_on: '2026-11-24', started_at: '2026-11-24T09:00:00Z' }];
  ok('an upload half-loaded for over an hour → vt-staging-stuck', H.evaluateVtHealth({ now: T0, uploads: st, digest: dg() }).some((x) => x.id === 'vt-staging-stuck'));
  ok('…not while it is under an hour old', !H.evaluateVtHealth({ now: at('2026-11-24T09:30:00Z'), uploads: st, digest: dg() }).some((x) => x.id === 'vt-staging-stuck')); }
{ const b = H.evaluateVtHealth({ now: T0, uploads: fresh, digest: dg({ budgetCycle: 'cycle-2026-10' }) }).find((x) => x.id === 'vt-budget-missing');
  ok('no budgets for this business month → vt-budget-missing (warning) naming the fallback month and the file', !!b && b.severity === 'warning' && /November 2026/.test(b.message) && /October 2026/.test(b.message) && /vt_engine_rules\.json/.test(b.message), b && b.message);
  const n = H.evaluateVtHealth({ now: T0, uploads: fresh, digest: dg({ budgetCycle: null, noBudgets: true }) }).find((x) => x.id === 'vt-budget-missing');
  ok('no budget at all → critical', !!n && n.severity === 'critical'); }
ok('the tables past ~2× the plan → vt-db-size', H.evaluateVtHealth({ now: T0, uploads: fresh, digest: dg(), size: { vt_cases: { rows: 1, bytes: 50 * 1048576 }, vt_case_events: { rows: 1, bytes: 20 * 1048576 } } }).some((x) => x.id === 'vt-db-size'));
{ const u = H.evaluateVtHealth({ now: T0, uploads: fresh, digest: dg({ unmatched: { sellers: 9, cases: 120 }, floorSales: 1700 }) }).find((x) => x.id === 'vt-unmatched');
  ok('unmatched sellers above 5 % of the month\'s sales → vt-unmatched, no names in the alert', !!u && /120 of this business month/.test(u.message) && /9 sellers/.test(u.message), u && u.message);
  ok('the reference month\'s level (66 of ~1,756, 3.8 %) raises nothing', !H.evaluateVtHealth({ now: T0, uploads: fresh, digest: dg({ unmatched: { sellers: 8, cases: 66 }, floorSales: 1690 }) }).some((x) => x.id === 'vt-unmatched')); }
ok('every VT alert is plain words with an id, a severity and a since', [...H.evaluateVtHealth({ now: T0, uploads: [up('bi_fitted', '2026-11-20'), up('sched_missed', '2026-11-20'), { kind: 'bi_fitted', state: 'staging', started_at: '2026-11-24T08:00:00Z' }], digest: dg({ updatedAt: '2026-11-01T00:00:00Z', budgetCycle: 'cycle-2026-10', unmatched: { sellers: 9, cases: 400 } }), size: { vt_cases: { bytes: 9e7 } } })]
  .every((x) => /^vt-/.test(x.id) && /^(warning|critical)$/.test(x.severity) && x.since && x.message.length > 40 && !/undefined|NaN|null/.test(x.message)));

head('H4 · the digest head, without a parse');
{ const D = vtDigest(); const h = H.readVtDigestHead(JSON.stringify(D));
  ok('period, updatedAt and empty read from a real VTEngine digest', h && JSON.stringify(h.period) === JSON.stringify(D.period) && h.updatedAt === D.updatedAt && h.empty === D.empty, JSON.stringify(h));
  ok('the budget month', h.budgetCycle === D.budgets.cycle, h.budgetCycle);
  ok('the unmatched counts and the floor\'s sales', h.unmatched.sellers === D.floor.unmatched.sellers && h.unmatched.cases === D.floor.unmatched.cases && h.floorSales === D.floor.mtd.sales, JSON.stringify(h));
  ok('the engine\'s missing-day count', h.gapDays === (D.gaps || []).length, String(h.gapDays));
  ok('an empty string is no digest', H.readVtDigestHead('') === null); }

head('H5 · the plumbing');
{ const calls = [];
  const DB = { select: async (q) => { calls.push(q); throw new Error('relation "vt_uploads" does not exist'); }, rpc: async (n) => { calls.push('rpc:' + n); return {}; }, storageGet: async () => { calls.push('storage'); return ''; }, insert: async () => { calls.push('insert'); } };
  const g = await H.gatherVt(DB, [], at('2026-11-22T06:00:00Z'));
  ok('before migration 071: one read, nothing else (no size call, no trim even on a Sunday)', calls.length === 1 && g.uploads === undefined, calls.join()); }
{ const calls = []; let log = null;
  const DB = { select: async (q) => { calls.push(q); return []; }, rpc: async (n) => { calls.push('rpc:' + n); return n === 'vt_trim' ? { events: 0, cases: 0 } : { vt_cases: { rows: 0, bytes: 8192 } }; },
    storageGet: async () => { calls.push('storage'); return ''; }, insert: async (t, r) => { calls.push('insert'); log = r[0]; } };
  const SUN = at('2026-11-22T01:30:00Z');             // Sun 03:30 SAST
  await H.gatherVt(DB, [], SUN);
  ok('on a Sunday the weekly vt_trim runs and its counts are kept in kv:vt-trim-log', calls.includes('rpc:vt_trim') && log && log.key === H.VT_TRIM_KEY && /"result"/.test(log.value.data), calls.join());
  calls.length = 0;
  await H.gatherVt(DB, [{ key: H.VT_TRIM_KEY, value: log.value }], SUN + 600000);
  ok('…once: ten minutes later it does not run again', !calls.includes('rpc:vt_trim'), calls.join());
  ok('trimDue: Sunday + a week-old log → due; Monday → not', H.trimDue(SUN, '2026-11-15T01:30:00Z') && !H.trimDue(at('2026-11-23T08:00:00Z'), null));
  calls.length = 0;
  await H.gatherVt(DB, [{ key: 'kv:vt-digest', value: { store: 'raw/kv/vt-digest' } }], at('2026-11-24T10:00:00Z'));
  ok('a digest kept in Storage is read once; at most 3 subrequests on a weekday', calls.filter((c) => c === 'storage').length === 1 && calls.length <= 3, calls.join()); }

head('H6 · runHealthChecks');
{ const realNow = Date.now; Date.now = () => T0;
  try {
    const written = [];
    const mk = (vtReadable) => ({ select: async (q) => { if (q.startsWith('vt_uploads')) { if (!vtReadable) throw new Error('404'); return [up('bi_fitted', '2026-11-20'), up('sched_missed', '2026-11-24')]; } if (q.startsWith('rules?key=in.')) return []; return []; },
      rpc: async (n) => (n === 'db_health' ? { db_bytes: 1e9 } : n === 'vt_db_size' ? { vt_cases: { rows: 10, bytes: 1e5 } } : null), storageGet: async () => null,
      insert: async (t, rows) => { written.push(rows[0]); }, del: async () => {} });
    const off = await runHealthChecks(mk(false), { env: {} });
    const on = await runHealthChecks(mk(true), { env: {} });
    ok('with VT tables: the VT alerts reach kv:health-alerts', on.alerts.some((x) => x.id === 'vt-upload-gap') && on.alerts.some((x) => x.id === 'vt-digest-stale'), ids(on.alerts));
    ok('without them: no VT alert at all', !off.alerts.some((x) => /^vt-/.test(x.id)), ids(off.alerts));
    ok('the VAS alerts are the same either way', ids(off.alerts.filter((x) => !/^vt-/.test(x.id))) === ids(on.alerts.filter((x) => !/^vt-/.test(x.id))), ids(off.alerts) + ' | ' + ids(on.alerts));
    ok('they are written to kv:health-alerts like every other alert', written.some((r) => r.key === 'kv:health-alerts' && /vt-upload-gap/.test(r.value.data)));
  } finally { Date.now = realNow; } }

head('H7 · tools/vt-db-size.mjs');
{ const T = { vt_cases: { rows: 3000, bytes: 1.2e6 }, vt_case_events: { rows: 7500, bytes: 0.9e6 }, vt_uploads: { rows: 45, bytes: 5e4 }, vt_upload_stage: { rows: 0, bytes: 8192 }, vt_book_rev: { rows: 1, bytes: 8192 } };
  const r = SZ.assess({ tables: T, added: { vt_cases: { 'cycle-2026-11': 3000 }, vt_case_events: { 'cycle-2026-11': 7500 }, vt_uploads: { 'cycle-2026-11': 45 } }, lastComplete: 'cycle-2026-11' });
  ok('the plan\'s month (3k cases, 7.5k events) grows ≈ 2 MB → PASS', r.growthVerdict === 'PASS' && r.growthBytes > 1.5e6 && r.growthBytes < 3e6, String(r.growthBytes));
  const w = SZ.assess({ tables: { ...T, vt_case_events: { rows: 100000, bytes: 6e7 } }, added: { vt_case_events: { 'cycle-2026-11': 100000 } }, lastComplete: 'cycle-2026-11' });
  ok('a month that adds > 5 MB → WARN', w.growthVerdict === 'WARN');
  ok('no complete month yet says so', SZ.assess({ tables: T, added: {}, lastComplete: null }).growthVerdict === 'NO COMPLETE MONTH YET');
  const alr = SZ.assess({ tables: T, agentListRaw: [{ sheet: 'VAS', rows: 60000 }, { sheet: 'VT', rows: 4000 }, { sheet: 'Reg List', rows: 80000 }, { sheet: 'Sheet1', rows: 70000 }] });
  ok('agent_list_raw under 250k rows → "not needed yet", hidden sheets counted apart', alr.alrVerdict === 'not needed yet' && alr.alrHidden === 150000, JSON.stringify([alr.alrVerdict, alr.alrHidden]));
  ok('over 250k → propose migration-073', SZ.assess({ tables: T, agentListRaw: [{ sheet: 'Reg List', rows: 260000 }] }).alrVerdict === 'PROPOSE migration-073');
  ok('the report prints in words', /growth in the last complete business month/.test(SZ.render(r)) && /line 250000/.test(SZ.render(alr))); }
{ const { PGlite } = await import(pathToFileURL(path.join(HERE, 'node_modules', '@electric-sql', 'pglite', 'dist', 'index.js')).href);
  const db = new PGlite();
  await db.exec(`do $$ begin create role service_role bypassrls; exception when duplicate_object then null; end $$;
    do $$ begin create role anon; exception when duplicate_object then null; end $$; do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
    create table agent_list_raw (id bigserial primary key, as_of date not null, sheet text);`);
  await db.exec(fs.readFileSync(path.join(ROOT, 'supabase', 'migration-071-vt-facts.sql'), 'utf8').replace(/^\s*notify pgrst.*$/gim, ''));
  await db.exec(`insert into vt_uploads (sha256, kind, file_name, extract_on, cycle_key, state, uploaded_by) values (repeat('a', 64), 'bi_fitted', 'BI Active Fitted 101126.xlsx', '2026-11-10', 'cycle-2026-11', 'committed', 'tester');
    insert into vt_cases (case_number, status, status_on, sold_on, sold_basis, first_seen, last_seen, last_upload, rev) select 91000000 + g, 'scheduled', '2026-11-10', '2026-11-10', 'first_seen', '2026-11-10', '2026-11-10', 1, 1 from generate_series(1, 50) g;
    insert into agent_list_raw (as_of, sheet) select '2026-11-02', s from unnest(array['VAS','VT','Reg List','Reg List']) s;`);
  const before = (await db.query('select count(*)::int n from vt_cases')).rows[0].n;
  const m = await SZ.readFrom(db, true, '2026-12-01');
  ok('its SQL runs over migration-071 (PGlite): rows per table and bytes', m.tables.vt_cases.rows === 50 && m.tables.vt_cases.bytes > 0 && m.tables.vt_uploads.rows === 1, JSON.stringify(m.tables.vt_cases));
  ok('rows added per business month, and the last complete one', m.added.vt_cases['cycle-2026-11'] === 50 && m.lastComplete === 'cycle-2026-11', JSON.stringify([m.added.vt_cases, m.lastComplete]));
  ok('agent_list_raw by sheet with the oldest list day', m.agentListRaw.find((x) => x.sheet === 'Reg List').rows === 2 && m.agentListRaw[0].oldest === '2026-11-02', JSON.stringify(m.agentListRaw));
  let wrote = false; try { await db.query('begin read only'); await db.query(`delete from vt_cases`); } catch (e) { wrote = false; } finally { await db.query('rollback'); }
  ok('it reads inside a READ ONLY transaction (a write in one is refused) and changes nothing', (await db.query('select count(*)::int n from vt_cases')).rows[0].n === before && !wrote);
  await db.close(); }

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
if (fail) { console.log('FAILURES:'); failures.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
