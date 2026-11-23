#!/usr/bin/env node
/* verify-vt-db.mjs — THE VT FACTS STORE (Spec Kit 071, Phase C: migrations 071 + 072, plan §DB).
 *
 * Both migrations run VERBATIM in PGlite (in-process PostgreSQL 16, no network, no connection string — nothing here
 * can reach Supabase), on top of the real agent_list_raw (migration-020) and team_leader_cbs (migration-018) tables,
 * with Supabase's three API roles created as stand-ins. The database is thrown away at exit. Proves:
 *   D1  five vt_* tables, RLS on every one, NO policy on any (deny by default to anon/authenticated)
 *   D2  anon / authenticated hold no privilege on any vt_* table or sequence and no EXECUTE on any new function —
 *       checked in the catalogue AND by actually trying as those roles; service_role can do the whole intake
 *   D3  every `create or replace function` in 071/072 is followed by its revoke + service_role grant (create or replace
 *       re-grants EXECUTE — migration-049's lesson), and the floor-wide audit: no loaded function is anon-executable
 *   D4  begin → stage → commit with the REAL engine's merge: vt_book read back through bookFromRpc equals the merged
 *       book field for field (openedOn persisted; partnerRaw/bundle/smAttempt survive the round trip)
 *   D5  the same bytes again: begin answers duplicate; a re-stage is idempotent; a re-commit returns the stored result
 *   D6  compare-and-set: a commit on a stale base revision is refused version_conflict and writes nothing
 *   D7  an incomplete stage (row count differs from the commit's) is refused and writes nothing
 *   D8  the opening book is refused on an empty book (before the first day's files); afterwards it commits and stamps
 *       openingBookOn
 *   D9  abandon clears the stage rows; the same hash may begin again (reuses the row)
 *   D10 checks: bad status, bad sha, case number out of range, batch over 1,000 rows
 *   D11 vt_book(p_from, p_also): old fitted cases out, open cases in, p_also brings a named old case, every event of a
 *       returned case comes with it; < 300 ms at 20k cases
 *   D12 vt_trim: 13 business months kept, older events / stale cases / abandoned uploads go, stage rows > 1 day purged;
 *       its start day equals VT_RULES.periods.periodStartDay
 *   D13 vt_db_size names every vt_* table
 *   D14 vt_roster_at (072): the latest accepted VT snapshot dated on or before the day, TL code joined, "-" target null;
 *       nothing for a day before any list; the partial index exists; 072 never touches publish_agent_list or sync_*
 *
 *   node nicks_code/diagnostics/verify-vt-db.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { splitSql, strip } from './usage-028-harness.mjs';
import { biFile, smFile, openFile, ROSTER } from './vt-fixtures.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const require = createRequire(import.meta.url);
const SQLF = (f) => { const p = path.join(ROOT, 'supabase', f); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n') : null; };
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m + (d !== undefined ? ' — ' + d : '')); } };
const eq = (m, a, b) => ok(JSON.stringify(a) === JSON.stringify(b), m, 'expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a));
const head = (t) => console.log('\n' + t);
const done = () => { console.log(`\n==== ${pass} passed, ${fail} failed ====`); process.exit(fail ? 1 : 0); };

const M71 = SQLF('migration-071-vt-facts.sql'), M72 = SQLF('migration-072-vt-roster-read.sql');
ok(!!M71, 'supabase/migration-071-vt-facts.sql exists');
ok(!!M72, 'supabase/migration-072-vt-roster-read.sql exists');
if (!M71 || !M72) done();
const E = require(path.join(ROOT, 'nicks_code', 'vt-engine.js'));
const ST = require(path.join(ROOT, 'nicks_code', 'vt-pages.js'));
const { PGlite } = await import(pathToFileURL(path.join(HERE, 'node_modules', '@electric-sql', 'pglite', 'dist', 'index.js')).href);
const db = new PGlite();
const pick = (file, re) => splitSql(SQLF(file)).filter((x) => re.test(strip(x)));
await db.exec(`do $$ begin create role service_role bypassrls; exception when duplicate_object then null; end $$;
  do $$ begin create role anon; exception when duplicate_object then null; end $$;
  do $$ begin create role authenticated; exception when duplicate_object then null; end $$;`);
for (const st of [...pick('migration-020-publish-agent-list.sql', /^create table if not exists agent_list_raw|^create index if not exists agent_list_raw_asof_idx/i),
  ...pick('migration-018-team-leader-accounts.sql', /^create table if not exists team_leader_cbs/i)]) await db.exec(st);
for (const [f, text] of [['071', M71], ['072', M72]]) {
  let bad = 0;
  for (const st of splitSql(text)) { try { await db.exec(st); } catch (e) { bad++; ok(false, 'migration-' + f + ' statement applies: ' + strip(st).slice(0, 80), e.message); } }
  ok(bad === 0, 'migration-' + f + ' applies statement by statement');
}
const one = async (q, p = []) => (await db.query(q, p)).rows[0];
const all = async (q, p = []) => (await db.query(q, p)).rows;
const rpc = async (fn, args) => (await one(`select ${fn}(${args.map((_, i) => '$' + (i + 1)).join(',')}) v`, args)).v;
const err = async (fn) => { try { await fn(); return null; } catch (e) { return String(e.message || e); } };
const TABLES = ['vt_cases', 'vt_case_events', 'vt_uploads', 'vt_upload_stage', 'vt_book_rev'];

head('D1 · tables, RLS, no policies');
const tabs = await all(`select relname, relrowsecurity from pg_class where relkind = 'r' and relname like 'vt\\_%' order by 1`);
eq('the five vt_* tables exist', tabs.map((t) => t.relname).sort(), [...TABLES].sort());
ok(tabs.every((t) => t.relrowsecurity), 'row level security is on for every vt_* table', JSON.stringify(tabs));
eq('no policy exists on any vt_* table', (await one(`select count(*)::int n from pg_policies where tablename like 'vt\\_%'`)).n, 0);

head('D2 · anon / authenticated get nothing; service_role does the intake');
const fns = await all(`select p.oid::regprocedure::text sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and (p.proname like 'vt\\_%')`);
eq('the eight VT functions exist', fns.map((f) => f.proname).sort(), ['vt_book', 'vt_db_size', 'vt_roster_at', 'vt_trim', 'vt_upload_abandon', 'vt_upload_begin', 'vt_upload_commit', 'vt_upload_stage']);
for (const r of ['anon', 'authenticated']) {
  const t = await all(`select c.relname from pg_class c where c.relname like 'vt\\_%' and c.relkind in ('r','S')
    and (has_table_privilege('${r}', c.oid, 'select') or has_table_privilege('${r}', c.oid, 'insert') or has_table_privilege('${r}', c.oid, 'update') or has_table_privilege('${r}', c.oid, 'delete'))`).catch(() => null);
  const s = await all(`select c.relname from pg_class c where c.relname like 'vt\\_%' and c.relkind = 'S' and case when c.relkind = 'S' then has_sequence_privilege('${r}', c.oid, 'usage') else false end`);
  ok(t && t.length === 0, r + ' holds no privilege on any vt_* table', JSON.stringify(t));
  ok(s.length === 0, r + ' holds no privilege on any vt_* sequence', JSON.stringify(s));
  const f = fns.filter((x) => false);
  for (const x of fns) if ((await one(`select has_function_privilege('${r}', $1::regprocedure, 'execute') e`, [x.sig])).e) f.push(x.sig);
  ok(f.length === 0, r + ' may EXECUTE no VT function', f.join(', '));
}
ok(fns.every((x) => true) && (await all(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'vt\\_%' and array_to_string(p.proacl, ',') ~ '(^|,)=X'`)).length === 0,
  'PUBLIC holds no EXECUTE on any VT function');
for (const x of fns) ok((await one(`select has_function_privilege('service_role', $1::regprocedure, 'execute') e`, [x.sig])).e, 'service_role may EXECUTE ' + x.sig);
for (const r of ['anon', 'authenticated']) {
  await db.exec(`set role ${r}`);
  const a = await err(() => db.query('select vt_book(null)'));
  const b = await err(() => db.query('select * from vt_cases'));
  await db.exec('reset role');
  ok(a && /permission denied/i.test(a), r + ': calling vt_book() is denied', a);
  ok(b && /permission denied/i.test(b), r + ': reading vt_cases is denied', b);
}

head('D3 · every function in 071/072 is revoked after it is (re)defined');
for (const [f, text] of [['071', M71], ['072', M72]]) {
  const body = strip(text.replace(/\$\$[\s\S]*?\$\$/g, '$$$$'));
  const defs = [...body.matchAll(/create\s+or\s+replace\s+function\s+(\w+)\s*\(/gi)].map((m) => ({ fn: m[1].toLowerCase(), at: m.index }));
  ok(defs.length > 0, 'migration-' + f + ' defines functions', defs.length);
  for (const d of defs) {
    const rv = new RegExp('revoke\\s+(all|execute)\\s+on\\s+function\\s+' + d.fn + '\\s*\\([^)]*\\)\\s+from\\s+public\\s*,\\s*anon\\s*,\\s*authenticated', 'ig');
    const gr = new RegExp('grant\\s+execute\\s+on\\s+function\\s+' + d.fn + '\\s*\\([^)]*\\)\\s+to\\s+service_role', 'ig');
    const rvs = [...body.matchAll(rv)].map((m) => m.index), grs = [...body.matchAll(gr)].map((m) => m.index);
    ok(rvs.some((i) => i > d.at), 'migration-' + f + ': ' + d.fn + ' is revoked from public, anon, authenticated AFTER its definition');
    ok(grs.some((i) => i > d.at), 'migration-' + f + ': ' + d.fn + ' is granted to service_role after its definition');
  }
  ok(!/grant[^;]*\bto\s+(anon|authenticated|public)\b/i.test(body), 'migration-' + f + ' grants nothing to anon / authenticated / public');
  ok(/apply:\s*node tools\/apply-migration\.mjs/i.test(text) && /owner/i.test(text.slice(0, 4000)), 'migration-' + f + ' header says how the OWNER applies it, at deploy');
}
const anyAnon = await all(`select p.oid::regprocedure::text sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute') and p.proname not like 'pg\\_%'`);
ok(anyAnon.length === 0 || anyAnon.every((x) => !/^vt_/.test(x.sig)), 'floor-wide audit: no VT function is anon-executable (others loaded here: ' + anyAnon.map((x) => x.sig).join(', ') + ')');

/* ---- the intake, as service_role, with the real engine ---- */
const SHA = (n) => String(n).padStart(2, '0').repeat(32);
await db.exec('set role service_role');
const begin = (sha, kind, name, on) => rpc('vt_upload_begin', [sha, kind, name, on, E.periods.cycleOf(on).key, 'tester']);
const book = async (from = null, also = null) => E.bookFromRpc(await rpc('vt_book', [from, also]));
async function upload(sha, kind, aoa, on, name, base) {
  const parsed = kind === 'bi_fitted' ? E.parseBi(aoa) : kind === 'sched_missed' ? E.parseSm(aoa) : E.parseOpeningBook(aoa);
  const bk = await book(null, null);
  const plan = ST.planCommit(bk, parsed, { extractOn: on, roster: ROSTER });
  const b = await begin(sha, kind, name, on);
  for (const [k, rows] of [['case', plan.cases], ['event', plan.events]])
    for (const bt of ST.batches(rows, 2)) await rpc('vt_upload_stage', [b.id, k, bt.from, JSON.stringify(bt.rows)]);
  const c = plan.commit;
  const res = await rpc('vt_upload_commit', [b.id, base == null ? c.p_base_rev : base, JSON.stringify(c.p_counts), JSON.stringify(c.p_unmatched), JSON.stringify(c.p_warnings), c.p_quiet_ack, c.p_cases, c.p_events]);
  return { plan, b, res };
}
const DAY1 = '2026-11-09', DAY2 = '2026-11-10';
const BI1 = biFile([{ cn: 90000001, partner: 'RevX' }, { cn: 90000002, unit: 'BEAME', charge: 150.5, seller: 'Bravo Middle Tester' }, { cn: 90000009, unit: 'NOTVT' }]);
const SM1 = smFile([{ cn: 90000003, outcome: 'Scheduled Fitment', partner: 'Panimax - New Sales', seller: 'Bravo Middle Tester' }, { cn: 90000004, outcome: 'Missed Fitment', appt: '2026-11-08' },
  { cn: 90000001, outcome: 'Missed Fitment' }, { cn: 90000005, seller: 'Nobody On The List' }]);

head('D8a · the opening book is refused on an empty book');
const o0 = await err(() => upload(SHA(70), 'opening_book', openFile([{ cn: 90000003 }]), DAY1, 'Opening.xlsx'));
ok(o0 && /opening_book_before_first_day/.test(o0), 'an opening book before the first day\'s files is refused', o0);
eq('...and nothing was written', (await one('select count(*)::int n from vt_cases')).n, 0);

head('D4 · begin → stage → commit, read back through the engine');
const u1 = await upload(SHA(1), 'bi_fitted', BI1, DAY1, 'BI Active Fitted 091126.xlsx');
eq('the commit answers the new revision and the counts', [u1.res.rev, u1.res.cases, u1.res.events], [1, 2, 2]);
const u2 = await upload(SHA(2), 'sched_missed', SM1, DAY1, 'Scheduled & Missed 091126.xlsx');
const b2 = await book(null, null);
{ const canon = (o) => JSON.stringify(o, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((x) => [x, v[x]])) : v));
  const want = u2.plan.merged.book.cases, got = b2.cases, diff = [];
  for (const cn of new Set([...Object.keys(want), ...Object.keys(got)])) if (canon(want[cn]) !== canon(got[cn])) diff.push(cn + ': ' + canon(want[cn]) + ' vs ' + canon(got[cn]));
  ok(diff.length === 0, 'vt_book: cases read back equal the merged book, field for field (' + Object.keys(want).length + ' cases)', diff.join(' | ').slice(0, 600)); }
eq('vt_book: events read back equal every event merged so far', [...b2.events].sort((a, b) => (a.caseNumber + a.to).localeCompare(b.caseNumber + b.to)),
  [...u2.plan.merged.book.events].sort((a, b) => (a.caseNumber + a.to).localeCompare(b.caseNumber + b.to)));
eq('book.openedOn is persisted = the first extract (go-live)', b2.openedOn, DAY1);
eq('book.rev is the revision counter', b2.rev, 2);
ok(b2.cases['90000003'].partnerRaw === 'Panimax - New Sales' && b2.cases['90000003'].leadSource === 'referral', 'partnerRaw survives the round trip, so the lead source is not re-folded', JSON.stringify(b2.cases['90000003']));
eq('the fitted case stays fitted although S&M says missed (same extract)', b2.cases['90000001'].status, 'fitted');
ok(!b2.cases['90000009'], 'a non-VT BI line never became a case');
{ const raw = JSON.stringify(await all('select * from vt_cases')) + JSON.stringify(await all('select * from vt_case_events')) + JSON.stringify(await all('select counts, unmatched, warnings from vt_uploads'));
  ok(!['Customer Zed', '0820000001', 'ZZ 99 ZZ GP', 'CHASSISZZ001', 'BOXZZ01', 'ACCZZ001', 'CONZZ001'].some((p) => raw.includes(p)), 'no customer field reached any vt_* table'); }
const u3 = await upload(SHA(3), 'sched_missed', smFile([{ cn: 90000004, outcome: 'Scheduled Fitment', attempt: '2nd attempt', appt: '2026-11-13' }]), DAY2, 'Scheduled & Missed 101126.xlsx');
const b3 = await book(null, null);
eq('the newer extract re-books the missed case; the missed event stays in its history', [b3.cases['90000004'].status, b3.events.filter((e) => e.caseNumber === '90000004').map((e) => e.to)], ['scheduled', ['missed', 'scheduled']]);
eq('openedOn does not move on later uploads', b3.openedOn, DAY1);
eq('the uploads table records every committed file with its rev', (await all(`select rev_after::int r from vt_uploads where state = 'committed' order by id`)).map((x) => x.r), [1, 2, 3]);

head('D5 · the same bytes again');
const dup = await begin(SHA(1), 'bi_fitted', 'renamed copy.xlsx', DAY1);
ok(dup.duplicate === true && dup.id === u1.b.id, 'begin on a committed hash answers duplicate with the first upload\'s id', JSON.stringify(dup));
const rc = await rpc('vt_upload_commit', [u1.b.id, 0, '{}', '[]', '[]', false, 0, 0]);
ok(rc.rev === 1 && rc.already === true, 're-committing a committed id returns its stored result and changes nothing', JSON.stringify(rc));
eq('...the book revision did not move', (await one('select rev::int r from vt_book_rev')).r, 3);

head('D6 · compare-and-set on the book revision');
{ const parsed = E.parseSm(smFile([{ cn: 90000006 }])); const plan = ST.planCommit(await book(), parsed, { extractOn: DAY2, roster: ROSTER });
  const b = await begin(SHA(6), 'sched_missed', 'S&M late.xlsx', DAY2);
  await rpc('vt_upload_stage', [b.id, 'case', 0, JSON.stringify(plan.cases)]);
  await rpc('vt_upload_stage', [b.id, 'case', 0, JSON.stringify(plan.cases)]);
  eq('a retried stage batch is idempotent (no second copy of its rows)', (await one('select count(*)::int n from vt_upload_stage where upload_id = $1', [b.id])).n, plan.cases.length);
  const e6 = await err(() => rpc('vt_upload_commit', [b.id, 2, '{}', '[]', '[]', false, plan.cases.length, 0]));
  ok(e6 && /version_conflict/.test(e6), 'a commit on a stale base revision is refused version_conflict', e6);
  ok(!(await one('select 1 x from vt_cases where case_number = 90000006')), '...and no case was written');
  eq('...and the upload is still staging (the station re-reads and retries)', (await one('select state from vt_uploads where id = $1', [b.id])).state, 'staging');
  head('D7 · an incomplete stage is refused');
  const e7 = await err(() => rpc('vt_upload_commit', [b.id, 3, '{}', '[]', '[]', false, plan.cases.length + 5, 0]));
  ok(e7 && /stage_incomplete/.test(e7), 'a commit whose row count differs from the staged rows is refused', e7);
  const okc = await rpc('vt_upload_commit', [b.id, 3, '{}', '[]', '[]', false, plan.cases.length, 0]);
  eq('with the right base and count it commits', okc.rev, 4);
  eq('the stage rows are gone after the commit', (await one('select count(*)::int n from vt_upload_stage where upload_id = $1', [b.id])).n, 0);
}

head('D8b · the opening book after the first day');
const o1 = await upload(SHA(71), 'opening_book', openFile([{ cn: 90000003, sold: '2026-11-03' }, { cn: 90000099 }]), DAY2, 'November 2026 - VT Report.xlsx');
const b8 = await book();
eq('it dates the case already in the book and stamps openingBookOn', [b8.cases['90000003'].soldOn, b8.cases['90000003'].soldBasis, b8.openingBookOn], ['2026-11-03', 'opening_book', DAY2]);
ok(o1.plan.merged.counts.notInBook === 1, 'a case not in the book is counted on the receipt, not invented');

head('D9 · abandon');
{ const b = await begin(SHA(9), 'bi_fitted', 'abandoned.xlsx', DAY2);
  await rpc('vt_upload_stage', [b.id, 'case', 0, JSON.stringify([ST.caseRowToDb(b8.cases['90000001'])])]);
  await rpc('vt_upload_abandon', [b.id]);
  eq('abandon marks it abandoned and clears its stage rows', [(await one('select state from vt_uploads where id = $1', [b.id])).state, (await one('select count(*)::int n from vt_upload_stage where upload_id = $1', [b.id])).n], ['abandoned', 0]);
  const again = await begin(SHA(9), 'bi_fitted', 'abandoned.xlsx', DAY2);
  ok(again.id === b.id && !again.duplicate, 'the same hash may begin again and reuses the row', JSON.stringify(again));
  const e = await err(() => rpc('vt_upload_stage', [99999, 'case', 0, '[]']));
  ok(e && /not_staging/.test(e), 'staging into an unknown or finished upload is refused', e); }

head('D10 · checks');
ok(/check|violat/i.test(await err(() => begin('nothex', 'bi_fitted', 'x.xlsx', DAY2)) || ''), 'a sha256 that is not 64 hex characters is refused');
ok(/check|violat|invalid/i.test(await err(() => begin(SHA(11), 'vas_bi', 'x.xlsx', DAY2)) || ''), 'an unknown kind is refused');
{ const b = await begin(SHA(12), 'bi_fitted', 'checks.xlsx', DAY2);
  const bad = ST.caseRowToDb(b8.cases['90000001']);
  await rpc('vt_upload_stage', [b.id, 'case', 0, JSON.stringify([{ ...bad, status: 'lost' }])]);
  const e1 = await err(() => rpc('vt_upload_commit', [b.id, 5, '{}', '[]', '[]', false, 1, 0]));
  ok(e1 && /check|violat/i.test(e1), 'a status outside scheduled/missed/fitted/cancelled is refused at commit (whole commit)', e1);
  await rpc('vt_upload_abandon', [b.id]);
  const b2x = await begin(SHA(13), 'bi_fitted', 'checks2.xlsx', DAY2);
  await rpc('vt_upload_stage', [b2x.id, 'case', 0, JSON.stringify([{ ...bad, case_number: '1000000000000' }])]);
  ok(/check|violat/i.test(await err(() => rpc('vt_upload_commit', [b2x.id, 5, '{}', '[]', '[]', false, 1, 0])) || ''), 'a case number above 999,999,999,999 is refused');
  const big = Array.from({ length: 1001 }, () => bad);
  ok(/batch_too_large/.test(await err(() => rpc('vt_upload_stage', [b2x.id, 'case', 0, JSON.stringify(big)])) || ''), 'a stage batch over 1,000 rows is refused');
  await rpc('vt_upload_abandon', [b2x.id]); }
eq('none of the refused commits moved the revision', (await one('select rev::int r from vt_book_rev')).r, 5);

head('D11 · vt_book(p_from, p_also) and its speed');
await db.exec('reset role');
await db.exec(`insert into vt_cases (case_number, status, status_on, sold_on, sold_basis, first_seen, last_seen, products, seller_name, seller_match, last_upload, rev)
  values (80000001, 'fitted', '2026-06-01', '2026-05-30', 'first_seen', '2026-05-30', '2026-06-01', '{MXV}', 'alpha test', 'exact', ${u1.b.id}, 1),
         (80000002, 'scheduled', '2026-06-01', '2026-05-30', 'first_seen', '2026-05-30', '2026-06-01', '{MXV}', 'alpha test', 'exact', ${u1.b.id}, 1);
  insert into vt_case_events values (80000001, '2026-05-30', null, 'scheduled', null, ${u1.b.id}), (80000001, '2026-06-01', 'scheduled', 'fitted', null, ${u1.b.id});`);
await db.exec('set role service_role');
{ const b = await book('2026-10-26', null);
  ok(!b.cases['80000001'] && !!b.cases['80000002'] && !!b.cases['90000001'], 'an old fitted case is out of the cycle read; an old OPEN case and this cycle\'s cases are in');
  const b2 = await book('2026-10-26', ['80000001']);
  ok(!!b2.cases['80000001'], 'p_also brings back a named old case (the merge must see every case the file carries)');
  eq('...with every one of its events, however old', b2.events.filter((e) => e.caseNumber === '80000001').map((e) => e.onDate), ['2026-05-30', '2026-06-01']); }
await db.exec('reset role');
await db.exec(`insert into vt_cases (case_number, status, status_on, sold_on, sold_basis, first_seen, last_seen, appt_on, products, charge_ex, lead_source, seller_name, seller_cb, seller_match, last_upload, rev)
  select 70000000 + g, (array['scheduled','missed','fitted'])[1 + g % 3], date '2026-10-01' + (g % 50), date '2026-10-01' + (g % 50), 'first_seen', date '2026-10-01' + (g % 50),
         date '2026-10-01' + (g % 50), date '2026-10-05' + (g % 50), '{MXV}', 100, 'revx', 'alpha test', 'CB9101', 'exact', ${u1.b.id}, 1 from generate_series(1, 20000) g;
  insert into vt_case_events select 70000000 + g, date '2026-10-01' + (g % 50), null, 'scheduled', null, ${u1.b.id} from generate_series(1, 20000) g;
  analyze;`);
await db.exec('set role service_role');
await rpc('vt_book', [null, null]);
let big = null, ms = Infinity; for (let i = 0; i < 3; i++) { const t0 = performance.now(); big = await rpc('vt_book', [null, null]); ms = Math.min(ms, performance.now() - t0); }
ok(big.cases.length > 20000 && big.events.length > 20000, 'vt_book returns the 20k-case book as one value (' + big.cases.length + ' cases, ' + big.events.length + ' events, ' + Math.round(JSON.stringify(big).length / 1024) + ' KB)');
ok(ms < 300, 'vt_book at 20k cases answers in < 300 ms (PGlite/WASM, an upper bound for Postgres): ' + Math.round(ms) + ' ms');

head('D12 · vt_trim keeps 13 business months');
await db.exec('reset role');
await db.exec(`insert into vt_uploads (sha256, kind, file_name, extract_on, cycle_key, state, started_at) values ('${'ab'.repeat(32)}', 'bi_fitted', 'old abandoned.xlsx', '2025-08-01', 'cycle-2025-08', 'abandoned', '2025-08-01');
  insert into vt_uploads (sha256, kind, file_name, extract_on, cycle_key, state, started_at) values ('${'cd'.repeat(32)}', 'bi_fitted', 'stuck.xlsx', '2026-11-01', 'cycle-2026-11', 'staging', now() - interval '2 days');
  insert into vt_upload_stage (upload_id, kind, ord, row, staged_at) select id, 'case', 0, '{}'::jsonb, now() - interval '2 days' from vt_uploads where file_name = 'stuck.xlsx';
  update vt_cases set first_seen = '2025-09-01', sold_on = '2025-09-01', last_seen = '2025-09-01', status_on = '2025-09-01' where case_number = 80000002;
  update vt_case_events set on_date = '2025-09-20' where case_number = 80000001 and to_status = 'scheduled';`);
await db.exec('set role service_role');
const tr = await rpc('vt_trim', [13, '2026-11-23']);
ok(tr && tr.cutoff === '2025-10-26', 'the cutoff keeps 13 business months: cycle-2025-11 (from 26 Oct 2025) through cycle-2026-11', JSON.stringify(tr));
ok(!(await one('select 1 x from vt_cases where case_number = 80000002')), 'a case last seen before the cutoff is trimmed (with its events)');
ok(!!(await one('select 1 x from vt_cases where case_number = 80000001')), 'a case seen inside the window stays');
ok(!(await one(`select 1 x from vt_case_events where case_number = 80000001 and on_date < '2025-10-26'`)), 'events older than the cutoff are trimmed');
ok(!(await one(`select 1 x from vt_uploads where file_name = 'old abandoned.xlsx'`)), 'an abandoned upload older than the cutoff is removed');
eq('a staging upload untouched for a day is abandoned and its stage rows purged', [(await one(`select state from vt_uploads where file_name = 'stuck.xlsx'`)).state,
  (await one(`select count(*)::int n from vt_upload_stage s join vt_uploads u on u.id = s.upload_id where u.file_name = 'stuck.xlsx'`)).n], ['abandoned', 0]);
ok(typeof tr.cases === 'number' && typeof tr.events === 'number' && typeof tr.uploads === 'number' && typeof tr.stage === 'number', 'vt_trim returns its counts', JSON.stringify(tr));
{ const m = /p_start_day\s+int\s+default\s+(\d+)/i.exec(M71); eq('vt_trim\'s start day equals VT_RULES.periods.periodStartDay', m && +m[1], E.VT_RULES.periods.periodStartDay); }

head('D13 · vt_db_size');
const sz = await rpc('vt_db_size', []);
ok(TABLES.every((t) => sz[t] && typeof sz[t].rows === 'number' && sz[t].bytes > 0), 'vt_db_size gives rows and bytes for every vt_* table', JSON.stringify(sz).slice(0, 200));

head('D14 · vt_roster_at (migration-072)');
await db.exec('reset role');
await db.exec(`insert into team_leader_cbs (leader_name, employee_code) values ('Leader One', 'CB9190'), ('Leader Two', '');
  insert into agent_list_raw (as_of, ord, sheet, code, name, sf, tl, campaign_raw, campaign, tenure, target, start_date, accepted) values
  ('2026-10-20', 1, 'VT', 'CB9101', 'Alpha Test', 'Alpha Test', 'Leader One', 'Matrix Vehicle Tracking - Digital', 'VT', 'Exp', 7, '2026-01-05', true),
  ('2026-11-02', 1, 'VT', 'CB9101', 'Alpha Test', 'Alpha Test', 'Leader One', 'Matrix Vehicle Tracking - Digital', 'VT', 'Exp', 6.5, '2026-01-05', true),
  ('2026-11-02', 2, 'VT', 'CB9104', 'Echo Foxtrot', null, 'leader two', 'Matrix Vehicle Tracking - Scheduling', 'VT', 'Exp', 0, '2026-01-05', true),
  ('2026-11-02', 3, 'VT', 'CB9188', 'Dropped Row', null, 'Leader One', 'Matrix Vehicle Tracking - Digital', 'VT', 'Exp', 1, null, false),
  ('2026-11-02', 4, 'VAS', 'CB9150', 'Vas Person', null, 'Leader One', 'Courtesy', 'Courtesy', 'Exp', 3, null, true),
  ('2026-11-30', 1, 'VT', 'CB9101', 'Alpha Test', 'Alpha Test', 'Leader One', 'Matrix Vehicle Tracking - Referral', 'VT', 'Exp', 3, '2026-01-05', true);`);
await db.exec('set role service_role');
const ro = await rpc('vt_roster_at', ['2026-11-25']);
eq('the latest accepted VT snapshot on or before the day', ro.as_of, '2026-11-02');
eq('...VT rows only, accepted only', ro.rows.map((r) => r.code), ['CB9101', 'CB9104']);
eq('...the team leader\'s CB joined from team_leader_cbs (case-insensitive; a blank code stays null)', ro.rows.map((r) => r.tl_code), ['CB9190', null]);
eq('...a target of 0 / "-" is null (no target), a real one kept', ro.rows.map((r) => r.target), [6.5, null]);
eq('...the engine reads the sub-campaign from the list\'s own cell', ST.rosterFromRpc(ro).map((r) => r.sub), ['digital', 'scheduling']);
eq('nothing for a day before any list', (await rpc('vt_roster_at', ['2026-01-01'])).rows, []);
ok(!!(await one(`select 1 x from pg_indexes where indexname = 'agent_list_raw_vt_idx'`)), 'the partial index agent_list_raw_vt_idx exists');
ok(!/publish_agent_list|sync_agent_list|sync_team_leaders|sync_campaigns/i.test(strip(M72)), 'migration-072 never touches publish_agent_list or any sync_* function');
ok(!/\b(insert|update|delete)\b/i.test(strip(M72).replace(/\$\$[\s\S]*?\$\$/g, (b) => b.replace(/\bupdate[d]?_/g, ''))), 'migration-072 writes nothing (read-only)');
done();
