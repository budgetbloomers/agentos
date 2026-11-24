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
 *       returned case comes with it; at 20k cases < 4× a plain serialisation of the same rows (measured in the run)
 *   D12 vt_trim: 13 business months kept, older events / stale cases / abandoned uploads go, stage rows > 1 day purged;
 *       its start day equals VT_RULES.periods.periodStartDay
 *   D13 vt_db_size names every vt_* table
 *   D14 vt_roster_at (072): the latest accepted VT snapshot dated on or before the day, TL code joined, "-" target null;
 *       nothing for a day before any list; the partial index exists; 072 never touches publish_agent_list or sync_*
 *
 *   R1–R10 the Phase C review fixes: vt_cases has only its PK + fillfactor 70 and a re-see is a HOT update (D-H1);
 *       begin never wipes a live staging upload (D-H2); uploads belong to their uploader (S-M3); staged-row, concurrent
 *       and receipt caps (S-M2); the date window and cycle key (S-M4); free-text lengths (S-L3); stage after finish,
 *       duplicate case/event, same-day event update (D-LOW); a 20k-row commit TIMED (D-H3); trim locks first, keeps
 *       open cases and whole histories, drops old receipts (D-M4..D-M7, in D12); roster CB join + list_as_of
 *       (D-M8, D-M9); every signature's EXECUTE grants; 072's lock timeout and both migrations' schema reload
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
  ...pick('migration-018-team-leader-accounts.sql', /^create table if not exists team_leader_cbs/i),
  ...pick('migration-014-agent-list-sync.sql', /^create or replace function norm_cb/i)]) await db.exec(st);
/* as in production after migration-049: norm_cb is not PUBLIC-executable, service_role keeps it (072 relies on that) */
await db.exec(`revoke execute on function norm_cb(text) from public; grant execute on function norm_cb(text) to service_role;`);
for (const [f, text] of [['071', M71], ['072', M72]]) {
  let bad = 0;
  for (const st of splitSql(text)) { try { await db.exec(st); } catch (e) { bad++; ok(false, 'migration-' + f + ' statement applies: ' + strip(st).slice(0, 80), e.message); } }
  ok(bad === 0, 'migration-' + f + ' applies statement by statement');
}
const one = async (q, p = []) => (await db.query(q, p)).rows[0];
const all = async (q, p = []) => (await db.query(q, p)).rows;
/* stage / commit / abandon take the uploader (S-M3); the Worker injects it from the session. The suite's uploader is 'tester'. */
const NEEDS_USER = { vt_upload_stage: 4, vt_upload_commit: 8, vt_upload_abandon: 1 };
const rpc = async (fn, args) => (args = NEEDS_USER[fn] === args.length ? [...args, 'tester'] : args, await one(`select ${fn}(${args.map((_, i) => '$' + (i + 1)).join(',')}) v`, args)).v;
const err = async (fn) => { try { await fn(); return null; } catch (e) { return String(e.message || e); } };
await db.exec(`set vt.today = '2026-11-23'`);   // the suite's clock: begin's date window (S-M4) is judged against it
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
/* THE SPEED GUARD IS RELATIVE, NOT A WALL-CLOCK NUMBER. An absolute "< 300 ms" read ~150 ms normally and 314 ms on a
   busy laptop, so the daily tick went red from load alone. What the guard is FOR is a structural regression — an
   accidental O(n²) (a correlated per-case events subquery, a nested loop over the join) or a lost primary-key path —
   and those cost 100× or more at 20k cases, not 2×. So vt_book is timed against a REFERENCE built in this run on the
   same rows: the plainest possible serialisation of both tables (json_agg of every row, no filter, join or sort).
   Load slows both alike, so the ratio holds; the queries are INTERLEAVED and each takes its best of 7 so a burst of load
   cannot land on one side only. vt_book does the reference's work plus a filter, a hash join and two sorts, which
   measures ~1–1.5× here; the bound is 4×. A loose absolute ceiling (2 s, ~13× the normal time) stays as a backstop. */
const REF_SQL = `select (select json_agg(to_json(c)) from vt_cases c)::text a, (select json_agg(to_json(e)) from vt_case_events e)::text b`;
await one(REF_SQL);
let big = null, ms = Infinity, refMs = Infinity;
for (let i = 0; i < 7; i++) {
  let t0 = performance.now(); big = await rpc('vt_book', [null, null]); ms = Math.min(ms, performance.now() - t0);
  t0 = performance.now(); await one(REF_SQL); refMs = Math.min(refMs, performance.now() - t0); }
ok(big.cases.length > 20000 && big.events.length > 20000, 'vt_book returns the 20k-case book as one value (' + big.cases.length + ' cases, ' + big.events.length + ' events, ' + Math.round(JSON.stringify(big).length / 1024) + ' KB)');
ok(ms < 4 * refMs && ms < 2000, 'vt_book at 20k cases costs ' + (ms / refMs).toFixed(2) + '× a plain serialisation of the same rows (bound 4×): ' + Math.round(ms) + ' ms against ' + Math.round(refMs) + ' ms (PGlite/WASM, an upper bound for Postgres)', Math.round(ms) + ' / ' + Math.round(refMs));

head('D12 · vt_trim keeps 13 business months');
await db.exec('reset role');
await db.exec(`insert into vt_uploads (sha256, kind, file_name, extract_on, cycle_key, state, started_at) values ('${'ab'.repeat(32)}', 'bi_fitted', 'old abandoned.xlsx', '2025-08-01', 'cycle-2025-08', 'abandoned', '2025-08-01');
  insert into vt_uploads (sha256, kind, file_name, extract_on, cycle_key, state, started_at) values ('${'cd'.repeat(32)}', 'bi_fitted', 'stuck.xlsx', '2026-11-01', 'cycle-2026-11', 'staging', now() - interval '2 days');
  insert into vt_upload_stage (upload_id, kind, ord, row, staged_at) select id, 'case', 0, '{}'::jsonb, now() - interval '2 days' from vt_uploads where file_name = 'stuck.xlsx';
  update vt_cases set first_seen = '2025-09-01', sold_on = '2025-09-01', last_seen = '2025-09-01', status_on = '2025-09-01' where case_number = 80000002;
  insert into vt_cases (case_number, status, status_on, sold_on, sold_basis, first_seen, last_seen, products, last_upload, rev)
    values (80000003, 'fitted', '2025-09-02', '2025-09-01', 'first_seen', '2025-09-01', '2025-09-02', '{MXV}', ${u1.b.id}, 1);
  insert into vt_case_events values (80000003, '2025-09-01', null, 'scheduled', null, ${u1.b.id}), (80000003, '2025-09-02', 'scheduled', 'fitted', null, ${u1.b.id});
  insert into vt_uploads (sha256, kind, file_name, extract_on, cycle_key, state, started_at, committed_at, uploaded_by) values
    ('${'ef'.repeat(32)}', 'bi_fitted', 'old committed unreferenced.xlsx', '2025-08-02', 'cycle-2025-08', 'committed', '2025-08-02', '2025-08-02', 'tester'),
    ('${'fa'.repeat(32)}', 'bi_fitted', 'old committed referenced.xlsx', '2025-08-03', 'cycle-2025-08', 'committed', '2025-08-03', '2025-08-03', 'tester');
  insert into vt_cases (case_number, status, status_on, sold_on, sold_basis, first_seen, last_seen, products, last_upload, rev)
    select 80000004, 'fitted', '2026-11-01', '2026-11-01', 'first_seen', '2026-11-01', '2026-11-01', '{MXV}', id, 1 from vt_uploads where file_name = 'old committed referenced.xlsx';
  update vt_case_events set on_date = '2025-09-20' where case_number = 80000001 and to_status = 'scheduled';`);
await db.exec('set role service_role');
const tr = await rpc('vt_trim', [13, '2026-11-23']);
ok(tr && tr.cutoff === '2025-10-26', 'the cutoff keeps 13 business months: cycle-2025-11 (from 26 Oct 2025) through cycle-2026-11', JSON.stringify(tr));
ok(!(await one('select 1 x from vt_cases where case_number = 80000003')), 'a CLOSED case last seen before the cutoff is trimmed');
eq('...with its events', (await one('select count(*)::int n from vt_case_events where case_number = 80000003')).n, 0);
ok(!!(await one('select 1 x from vt_cases where case_number = 80000002')), 'D-M5: a still-OPEN (scheduled) case last seen before the cutoff is NOT trimmed');
eq('D-M5: ...and vt_trim says how many open cases it skipped', tr.skipped_open, 1);
ok(!!(await one('select 1 x from vt_cases where case_number = 80000001')), 'a case seen inside the window stays');
eq('D-M6: a retained case keeps its WHOLE history (an event older than the cutoff stays with it: no partial history)',
  (await all('select on_date::text d from vt_case_events where case_number = 80000001 order by on_date')).map((x) => x.d), ['2025-09-20', '2026-06-01']);
eq('vt_trim counts the events it removed (those of trimmed cases)', tr.events, 2);
ok(!(await one(`select 1 x from vt_uploads where file_name = 'old committed unreferenced.xlsx'`)), 'D-M7: a COMMITTED receipt older than the cutoff that nothing references is removed');
ok(!!(await one(`select 1 x from vt_uploads where file_name = 'old committed referenced.xlsx'`)), 'D-M7: ...one a case still references is kept');
{ const body = strip(M71).replace(/\s+/g, ' ');
  const tb = body.slice(body.search(/create or replace function vt_trim/i));
  const afterBegin = tb.slice(tb.search(/\bbegin\b/i) + 5).trim();
  ok(/^perform 1 from vt_book_rev where id = 1 for update;/i.test(afterBegin), 'D-M4: vt_trim takes the revision row lock FIRST (cannot race or deadlock a commit)', afterBegin.slice(0, 80)); }
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
/* ===================================================================================================== review fixes */
head('R0 · review fixes (Phase C security + database review) — helpers');
await db.exec('set role service_role');
const H = (n) => n.toString(16).padStart(4, '0').repeat(16);
const cyc = (on) => E.periods.cycleOf(on).key;
const curRev = async () => (await one('select rev::int r from vt_book_rev')).r;
const crow = (cn, on, o = {}) => ({ case_number: String(cn), status: 'fitted', status_on: on, sold_on: on, sold_basis: 'first_seen', first_seen: on, last_seen: on,
  appt_on: null, fitted_on: on, sm_attempt: null, products: ['MXV'], bundle: null, charge_ex: 100, partner_raw: null, lead_source: 'revx',
  seller_name: 'alpha test', seller_cb: 'CB9101', seller_match: 'exact', ...o });
const erow = (cn, on, o = {}) => ({ case_number: String(cn), on_date: on, from_status: null, to_status: 'fitted', appt_on: null, ...o });
const beginAs = (sha, on, user = 'tester', o = {}) => rpc('vt_upload_begin', [sha, o.kind || 'bi_fitted', o.name || 'review.xlsx', on, o.cycle || cyc(on), user]);
const stageAll = async (id, cases, events, user = 'tester') => {
  for (const [k, rows] of [['case', cases], ['event', events]]) for (let i = 0; i < rows.length; i += 1000) await rpc('vt_upload_stage', [id, k, i, JSON.stringify(rows.slice(i, i + 1000)), user]); };
const commitAs = async (id, nc, ne, user = 'tester', o = {}) => rpc('vt_upload_commit', [id, o.base == null ? await curRev() : o.base, JSON.stringify(o.counts || {}),
  JSON.stringify(o.unmatched || []), JSON.stringify(o.warnings || []), false, nc, ne, user]);
async function load(sha, on, cases, events = [], user = 'tester', o = {}) {
  const b = await beginAs(sha, on, user, o); await stageAll(b.id, cases, events, user);
  const t0 = performance.now(); const res = await commitAs(b.id, cases.length, events.length, user, o); return { b, res, ms: performance.now() - t0 }; }
/* best-of-N wall time of an async call (the commit-speed reference in R8) */
const bestOf = async (n, f) => { let m = Infinity; for (let i = 0; i < n; i++) { const t0 = performance.now(); await f(); m = Math.min(m, performance.now() - t0); } return m; };
const asOwner = async (sql) => { await db.exec('reset role'); await db.exec(sql); await db.exec('set role service_role'); };
const sweep = () => asOwner(`update vt_uploads set state = 'abandoned' where state = 'staging'; delete from vt_upload_stage;`);
ok(true, 'helpers ready (uploader "tester"; a second account "barry")');

head('R1 · D-H1 vt_cases has only its primary key, fillfactor 70, and a re-seen case is a HOT update');
eq('vt_cases carries ONLY its primary key (no index a daily re-see would churn)', (await all(`select indexname from pg_indexes where tablename = 'vt_cases' order by 1`)).map((x) => x.indexname), ['vt_cases_pkey']);
eq('vt_case_events keeps its insert-only indexes (trim by day, FK by upload)', (await all(`select indexname from pg_indexes where tablename = 'vt_case_events' order by 1`)).map((x) => x.indexname),
  ['vt_case_events_on_idx', 'vt_case_events_pkey', 'vt_case_events_upload_idx']);
ok(((await one(`select array_to_string(reloptions, ',') o from pg_class where relname = 'vt_cases'`)).o || '').includes('fillfactor=70'), 'vt_cases is created with fillfactor = 70');
{ const cs = Array.from({ length: 50 }, (_, i) => crow(61500000 + i, '2026-11-20'));
  await load(H(0x150), '2026-11-20', cs);
  const b = await beginAs(H(0x151), '2026-11-21'); await stageAll(b.id, cs.map((c) => ({ ...c, last_seen: '2026-11-21' })), []);
  const rv = await curRev();
  await db.exec('begin');
  await rpc('vt_upload_commit', [b.id, rv, '{}', '[]', '[]', false, 50, 0]);
  const st = await one(`select pg_stat_get_xact_tuples_updated('vt_cases'::regclass)::int u, pg_stat_get_xact_tuples_hot_updated('vt_cases'::regclass)::int h`);
  await db.exec('commit');
  /* a HOT update needs room on the SAME page: these 50 rows were just packed onto one page at 70%, so only some fit in
     this one-shot test (in production each page is pruned between days). With the old last_seen / last_upload indexes
     the count was 0 whatever the room: any HOT update at all proves no index blocks it. */
  ok(st.u >= 50 && st.h >= 25, 'an upload that only moves last_seen updates its 50 cases as HOT updates (' + st.h + ' of ' + st.u + ' HOT; with the old indexes 0)', JSON.stringify(st)); }

head('R2 · D-H2 begin never wipes a live staging upload');
{ const s = H(0x200);
  const a1 = await beginAs(s, '2026-11-21');
  await rpc('vt_upload_stage', [a1.id, 'case', 0, JSON.stringify([crow(61000001, '2026-11-21')])]);
  const a2 = await beginAs(s, '2026-11-21');
  ok(a2.busy === true && a2.id === a1.id, 'the same bytes begun again while staging (< 15 min) answer {busy:true, id}', JSON.stringify(a2));
  eq('...and its staged rows are untouched', (await one('select count(*)::int n from vt_upload_stage where upload_id = $1', [a1.id])).n, 1);
  ok((await beginAs(s, '2026-11-21', 'barry')).busy === true, 'another account beginning the same bytes is busy too');
  await asOwner(`update vt_uploads set started_at = now() - interval '20 minutes' where id = ${a1.id}`);
  ok((await beginAs(s, '2026-11-21', 'barry')).busy === true, 'a STALE staging upload is never reset for ANOTHER account (S-M3)');
  const a5 = await beginAs(s, '2026-11-21');
  ok(a5.reused === true && a5.id === a1.id, 'its own account may reset a stale (> 15 min) staging upload', JSON.stringify(a5));
  eq('...which clears its stage rows', (await one('select count(*)::int n from vt_upload_stage where upload_id = $1', [a1.id])).n, 0);
  await rpc('vt_upload_abandon', [a1.id]);
  const a6 = await beginAs(s, '2026-11-21', 'barry');
  ok(a6.reused === true && (await one('select uploaded_by u from vt_uploads where id = $1', [a1.id])).u === 'barry', 'an ABANDONED upload may be started again by anyone (it becomes theirs)', JSON.stringify(a6));
  await rpc('vt_upload_abandon', [a1.id, 'barry']); }

head('R3 · S-M3 stage / commit / abandon belong to the account that began the upload');
{ const b = await beginAs(H(0x300), '2026-11-21');
  ok(/not_owner/.test(await err(() => rpc('vt_upload_stage', [b.id, 'case', 0, JSON.stringify([crow(61000002, '2026-11-21')]), 'barry'])) || ''), 'another account may not stage into it');
  await rpc('vt_upload_stage', [b.id, 'case', 0, JSON.stringify([crow(61000002, '2026-11-21')])]);
  ok(/not_owner/.test(await err(async () => commitAs(b.id, 1, 0, 'barry')) || ''), 'another account may not commit it');
  ok(/not_owner/.test(await err(() => rpc('vt_upload_abandon', [b.id, 'barry'])) || ''), 'another account may not abandon it');
  eq('...it is still staging with its row', [(await one('select state from vt_uploads where id = $1', [b.id])).state, (await one('select count(*)::int n from vt_upload_stage where upload_id = $1', [b.id])).n], ['staging', 1]);
  ok(/bad_user/.test(await err(() => rpc('vt_upload_begin', [H(0x301), 'bi_fitted', 'x.xlsx', '2026-11-21', cyc('2026-11-21'), null])) || ''), 'begin without an uploader is refused (bad_user)');
  await rpc('vt_upload_abandon', [b.id]); }

head('R4 · S-M2 totals: concurrent uploads, staged rows, receipts');
await sweep();   // the earlier sections leave nothing they need staging
{ const ids = [];
  for (let i = 0; i < 4; i++) ids.push((await beginAs(H(0x400 + i), '2026-11-21')).id);
  ok(/too_many_uploads/.test(await err(() => beginAs(H(0x404), '2026-11-21')) || ''), 'a fifth upload staging at once is refused (too_many_uploads)');
  await asOwner(`update vt_uploads set started_at = now() - interval '2 hours' where id = ${ids[0]}`);
  const b5 = await beginAs(H(0x404), '2026-11-21');
  ok(b5.id && (await one('select state from vt_uploads where id = $1', [ids[0]])).state === 'abandoned', 'a staging upload untouched for an hour is reclaimed (abandoned) so the floor is never locked out', JSON.stringify(b5));
  for (const id of [...ids.slice(1), b5.id]) await rpc('vt_upload_abandon', [id]); }
{ const b = await beginAs(H(0x410), '2026-11-21');
  await asOwner(`insert into vt_upload_stage (upload_id, kind, ord, row) select ${b.id}, 'case', g, '{}'::jsonb from generate_series(0, 59999) g`);
  ok(/upload_too_large/.test(await err(() => rpc('vt_upload_stage', [b.id, 'case', 60000, JSON.stringify([crow(61000003, '2026-11-21')])])) || ''), 'staging past 60,000 case rows in one upload is refused (upload_too_large)');
  await asOwner(`insert into vt_upload_stage (upload_id, kind, ord, row) values (${b.id}, 'case', 60000, '{}'::jsonb)`);
  ok(/commit_too_large/.test(await err(() => commitAs(b.id, 60001, 0)) || ''), 'a commit over 60,000 case rows is refused before any write (commit_too_large)');
  await rpc('vt_upload_abandon', [b.id]); }
{ const big = Array.from({ length: 2001 }, (_, i) => ({ name: 's' + i, cases: 1 }));
  const b = await beginAs(H(0x420), '2026-11-21'); await stageAll(b.id, [crow(61000004, '2026-11-21')], []);
  ok(/bad_receipt/.test(await err(() => commitAs(b.id, 1, 0, 'tester', { unmatched: big })) || ''), 'an unmatched list over 2,000 names is refused (bad_receipt)');
  ok(/bad_receipt/.test(await err(() => commitAs(b.id, 1, 0, 'tester', { warnings: ['x'.repeat(20000)] })) || ''), 'warnings over 16 KB are refused (bad_receipt)');
  ok(/bad_receipt/.test(await err(() => commitAs(b.id, 1, 0, 'tester', { counts: ['not', 'an', 'object'] })) || ''), 'counts that are not an object are refused (bad_receipt)');
  ok(!(await one('select 1 x from vt_cases where case_number = 61000004')), '...and nothing was written');
  await rpc('vt_upload_abandon', [b.id]); }

head('R5 · S-M4 dates are bounded');
ok(/bad_extract_on/.test(await err(() => beginAs(H(0x500), '2026-11-25')) || ''), 'an extract dated after tomorrow (SAST) is refused');
ok(/bad_extract_on/.test(await err(() => beginAs(H(0x501), '2025-10-01')) || ''), 'an extract older than 400 days is refused');
{ const t = await beginAs(H(0x502), '2026-11-24'); ok(t.id && !t.busy, 'tomorrow is allowed (a late-evening pull)'); await rpc('vt_upload_abandon', [t.id]); }
ok(/bad_cycle_key/.test(await err(() => beginAs(H(0x503), '2026-11-21', 'tester', { cycle: 'cycle-2026-12' })) || ''), 'a cycle_key that disagrees with the extract (26th to 25th) is refused');
{ const t = await beginAs(H(0x504), '2026-10-26', 'tester', { cycle: 'cycle-2026-11' }); ok(t.id, 'the 26th opens the next business month (cycle-2026-11 from 26 Oct)'); await rpc('vt_upload_abandon', [t.id]); }
ok(/bad_date/.test(await err(() => load(H(0x505), '2026-11-21', [crow(61000005, '2026-11-21', { last_seen: '2027-06-01' })])) || ''), 'a far-future last_seen is refused at commit (bad_date)');
ok(/bad_date/.test(await err(() => load(H(0x506), '2026-11-21', [crow(61000006, '2026-11-21')], [erow(61000006, '2030-01-01')])) || ''), 'a far-future event day is refused at commit (bad_date)');
ok(/bad_date/.test(await err(() => load(H(0x507), '2026-11-21', [crow(61000007, '2026-11-21', { appt_on: '2031-01-01' })])) || ''), 'an appointment years ahead is refused (bad_date)');
ok(!(await one('select 1 x from vt_cases where case_number in (61000005, 61000006, 61000007)')), '...and none of them was written');
await sweep();

head('R6 · S-L3 free-text lengths');
ok(/check|violat/i.test(await err(() => load(H(0x600), '2026-11-21', [crow(61000008, '2026-11-21', { seller_name: 'x'.repeat(500) })])) || ''), 'a 500-character seller name is refused');
await sweep();
ok(/check|violat/i.test(await err(() => load(H(0x601), '2026-11-21', [crow(61000009, '2026-11-21', { products: Array.from({ length: 40 }, (_, i) => 'P' + i) })])) || ''), 'more than 32 products is refused');
await sweep();
{ let k0 = 0x602;
  for (const [k, n] of [['bundle', 201], ['partner_raw', 201], ['sm_attempt', 61]]) {
    ok(/check|violat/i.test(await err(() => load(H(k0++), '2026-11-21', [crow(61000010, '2026-11-21', { [k]: 'y'.repeat(n) })])) || ''), 'an over-long ' + k + ' (' + n + ' characters) is refused');
    await sweep(); } }
{ const e = await err(() => rpc('vt_upload_begin', [H(0x610), 'bi_fitted', 'f'.repeat(301), '2026-11-21', cyc('2026-11-21'), 'tester']));
  ok(e && /^bad_file_name/.test(e), 'a 301-character file name is a clear refusal (bad_file_name), not a raw check violation', e); }

head('R7 · D-LOW lifecycle, duplicates, same-day events');
{ const r = await load(H(0x700), '2026-11-21', [crow(61000011, '2026-11-21')]);
  ok(/not_staging/.test(await err(() => rpc('vt_upload_stage', [r.b.id, 'case', 1, JSON.stringify([crow(61000012, '2026-11-21')])])) || ''), 'a stage call after commit is refused (not_staging)');
  const b = await beginAs(H(0x701), '2026-11-21'); await rpc('vt_upload_abandon', [b.id]);
  ok(/not_staging/.test(await err(() => rpc('vt_upload_stage', [b.id, 'case', 0, '[]'])) || ''), 'a stage call after abandon is refused (not_staging)'); }
{ const e = await err(() => load(H(0x702), '2026-11-21', [crow(61000100, '2026-11-21'), crow(61000100, '2026-11-21', { status: 'missed' })]));
  ok(e && /^duplicate_case/.test(e) && e.includes('61000100'), 'a case twice in one upload is refused, naming the case', e);
  await sweep();
  const e2 = await err(() => load(H(0x703), '2026-11-21', [crow(61000101, '2026-11-21')], [erow(61000101, '2026-11-21'), erow(61000101, '2026-11-21', { from_status: 'scheduled' })]));
  ok(e2 && /^duplicate_event/.test(e2) && e2.includes('61000101'), 'an event twice in one upload is refused, naming the case', e2);
  await sweep(); }
{ await load(H(0x704), '2026-11-21', [crow(61000102, '2026-11-21', { status: 'scheduled', appt_on: '2026-11-25' })], [erow(61000102, '2026-11-21', { to_status: 'scheduled', appt_on: '2026-11-25' })]);
  const r2 = await load(H(0x705), '2026-11-21', [crow(61000102, '2026-11-21', { status: 'scheduled', appt_on: '2026-11-27' })], [erow(61000102, '2026-11-21', { to_status: 'scheduled', from_status: 'missed', appt_on: '2026-11-27' })]);
  const ev = await one(`select appt_on::text a, from_status f, upload_id::int u from vt_case_events where case_number = 61000102`);
  eq('a same-day event whose appt_on / from_status differ UPDATES the row (never silently dropped)', [ev.a, ev.f, ev.u], ['2026-11-27', 'missed', Number(r2.b.id)]); }

head('R8 · D-H3 a 20k-row first load commits in one call, timed');
{ const cs = Array.from({ length: 20000 }, (_, i) => crow(62000000 + i, '2026-11-20', { status: i % 3 ? 'fitted' : 'scheduled' }));
  const ev = cs.map((c) => erow(c.case_number, '2026-11-20', { to_status: c.status }));
  /* RELATIVE, like D11: a single commit's wall time is at the mercy of machine load, so each commit is judged against a
     REFERENCE measured in this run, before and after it — the same rows written the plainest way (one insert … select
     from a jsonb array into column copies of vt_cases (keyed on case_number) / vt_case_events, best of 3, taken just before
     and just after the commit; the LARGER of the two is the reference, so a burst of load during the one-shot commit
     is most likely in its bracket too). The commit does that write plus the
     stage read, the merge, the events upsert and the bookkeeping, measured at ~2–5× here; an O(n²) merge or a lost
     primary-key path costs orders of magnitude at 20k. Bound 15×, plus a 60 s absolute backstop. */
  await asOwner(`create temp table ref_cases as select * from vt_cases limit 0; alter table ref_cases add primary key (case_number); create temp table ref_events as select * from vt_case_events limit 0; grant all on ref_cases, ref_events to service_role;`);
  const CJ = JSON.stringify(cs), EJ = JSON.stringify(ev);
  const refWrite = () => bestOf(3, async () => { await db.query(`delete from ref_cases`); await db.query(`delete from ref_events`);
    await db.query(`insert into ref_cases select * from jsonb_populate_recordset(null::ref_cases, $1::jsonb)`, [CJ]);
    await db.query(`insert into ref_events select * from jsonb_populate_recordset(null::ref_events, $1::jsonb)`, [EJ]); });
  const ref1 = await refWrite();
  const r = await load(H(0x800), '2026-11-20', cs, ev);
  const ref = Math.max(ref1, await refWrite());
  ok(r.res.cases === 20000 && r.res.events === 20000, 'a 20,000-case + 20,000-event first load commits');
  ok(r.ms < 15 * ref && r.ms < 60000, 'MEASURED: the 20k + 20k first-load commit took ' + Math.round(r.ms) + ' ms, ' + (r.ms / ref).toFixed(1) + '× a plain 20k + 20k insert (' + Math.round(ref) + ' ms; bound 15×) in PGlite (WASM; an upper bound for Postgres)', Math.round(r.ms) + ' / ' + Math.round(ref));
  const r2 = await load(H(0x801), '2026-11-21', cs.map((c) => ({ ...c, last_seen: '2026-11-21' })), []);
  const refB = Math.max(ref1, await refWrite());
  ok(r2.res.cases === 20000 && r2.ms < 15 * refB && r2.ms < 60000, 'MEASURED: the steady-state daily re-see of 20,000 cases took ' + Math.round(r2.ms) + ' ms, ' + (r2.ms / refB).toFixed(1) + '× the same plain insert (bound 15×) in PGlite', Math.round(r2.ms) + ' / ' + Math.round(refB)); }

head('R9 · D-M8 / D-M9 vt_roster_at: one row per agent, house CB join, list_as_of');
await asOwner(`insert into team_leader_cbs (leader_name, employee_code) values ('leader one ', 'CB9999'), ('Leader Three', 'cb-77');
  insert into agent_list_raw (as_of, ord, sheet, code, name, sf, tl, campaign_raw, campaign, tenure, target, start_date, accepted) values
  ('2026-11-02', 5, 'VT', 'CB9105', 'Golf Hotel', null, 'Leader Three', 'Matrix Vehicle Tracking - Digital', 'VT', 'Exp', 2, '2026-01-05', true),
  ('2026-11-20', 1, 'VAS', 'CB9150', 'Vas Person', null, 'Leader One', 'Courtesy', 'Courtesy', 'Exp', 3, null, true);`);
{ const ro = await rpc('vt_roster_at', ['2026-11-25']);
  eq('two spellings of a leader in team_leader_cbs never duplicate a roster row', ro.rows.map((r) => r.code), ['CB9101', 'CB9104', 'CB9105']);
  eq('...the exact (btrim) spelling wins and the code goes through norm_cb', ro.rows.map((r) => r.tl_code), ['CB9190', null, 'CB77']);
  eq('D-M9: list_as_of names the newest accepted list of ANY campaign on or before the day (the page can warn)', [ro.as_of, ro.list_as_of], ['2026-11-02', '2026-11-20']); }

head('R11 · derived cancellation (2026-11-23 fix): storage, atomic with its upload, proven by the database, trimmed as closed');
/* a fresh book for this section (the uploads stay; their days are all before the dates used here), and a later clock */
await asOwner(`delete from vt_case_events; delete from vt_cases; update vt_uploads set state = 'abandoned' where state = 'staging'; delete from vt_upload_stage;`);
await db.exec(`set vt.today = '2027-03-10'`);
const committed = async () => (await all(`select kind, state, extract_on::text extract_on from vt_uploads where state = 'committed'`));
async function uploadRc(sha, kind, aoa, on, name) {   // the station's order: book first, then the receipts, then merge
  const parsed = kind === 'bi_fitted' ? E.parseBi(aoa) : E.parseSm(aoa);
  const bk = await book(null, null), rc = await committed();
  const plan = ST.planCommit(bk, parsed, { extractOn: on, roster: ROSTER, receipts: rc });
  const b = await beginAs(sha, on, 'tester', { kind, name });
  await stageAll(b.id, plan.cases, plan.events);
  const c = plan.commit;
  const res = await rpc('vt_upload_commit', [b.id, c.p_base_rev, JSON.stringify(c.p_counts), JSON.stringify(c.p_unmatched), JSON.stringify(c.p_warnings), c.p_quiet_ack, c.p_cases, c.p_events]);
  return { plan, res, b };
}
const CA = '2027-03-01', CB = '2027-03-02', CC = '2027-03-03';
await uploadRc(H(9101), 'bi_fitted', biFile([{ cn: 93000001, inst: CA }]), CA, 'BI Active Fitted 010327.xlsx');
await uploadRc(H(9102), 'sched_missed', smFile([{ cn: 93000002 }, { cn: 93000003, outcome: 'Missed Fitment', appt: CA }]), CA, 'Scheduled & Missed 010327.xlsx');
const cB1 = await uploadRc(H(9103), 'bi_fitted', biFile([{ cn: 93000001, inst: CA }]), CB, 'BI Active Fitted 020327.xlsx');
eq('one file of a day writes no cancellation', [cB1.plan.merged.counts.toCancelled, (await one(`select count(*)::int n from vt_cases where status = 'cancelled'`)).n], [0, 0]);
const cB2 = await uploadRc(H(9104), 'sched_missed', smFile([{ cn: 93000004 }]), CB, 'Scheduled & Missed 020327.xlsx');
eq('the file that completes the day commits its cancellations in the same call', [cB2.plan.merged.counts.cancelledDropped, cB2.res.events], [2, cB2.plan.events.length]);
eq('vt_cases: status cancelled, cancel_reason dropped, as at the day', await all(`select case_number::text cn, status, cancel_reason, status_on::text as son from vt_cases where status = 'cancelled' order by 1`),
  [{ cn: '93000002', status: 'cancelled', cancel_reason: 'dropped', son: CB }, { cn: '93000003', status: 'cancelled', cancel_reason: 'dropped', son: CB }]);
eq('vt_case_events: one cancelled event each, with its reason and the upload that wrote it', await all(`select case_number::text cn, from_status, reason, upload_id::int u from vt_case_events where to_status = 'cancelled' order by 1`),
  [{ cn: '93000002', from_status: 'scheduled', reason: 'dropped', u: cB2.b.id }, { cn: '93000003', from_status: 'missed', reason: 'dropped', u: cB2.b.id }]);
{ const bk = await book(null, null), canon = (o) => JSON.stringify(o, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((x) => [x, v[x]])) : v));
  const want = cB2.plan.merged.book, diff = Object.keys(want.cases).filter((cn) => canon(want.cases[cn]) !== canon(bk.cases[cn]));
  ok(diff.length === 0, 'vt_book reads the cancelled cases back equal to the merged book (cancelReason included)', diff.join(','));
  const ev = (x) => x.map((e) => [e.caseNumber, e.onDate, e.from, e.to, e.reason].join('|')).sort();
  eq('...and every event with its reason', ev(bk.events), ev(want.events)); }
/* the database refuses a 'dropped' cancellation the upload cannot prove — whatever a station sends */
const dropEv = (cn, on) => erow(cn, on, { from_status: 'scheduled', to_status: 'cancelled', reason: 'dropped' });
const dropRow = (cn, on) => crow(cn, on, { status: 'cancelled', cancel_reason: 'dropped', fitted_on: null, first_seen: CA, sold_on: CA });
{ const e1 = await err(() => load(H(9105), CC, [dropRow(93000004, CC)], [dropEv(93000004, CC)], 'tester', { kind: 'sched_missed', name: 'S&M alone 030327.xlsx' }));
  ok(e1 && /bad_cancel/.test(e1), 'a single file of a day (its other file not committed) cannot cancel: bad_cancel', e1);
  eq('...and nothing was written', (await one(`select status from vt_cases where case_number = 93000004`)).status, 'scheduled');
  await sweep();
  const e2 = await err(() => load(H(9106), CB, [dropRow(93000004, CA)], [dropEv(93000004, CA)], 'tester', { kind: 'sched_missed', name: 'S&M misdated 020327.xlsx' }));
  ok(e2 && /bad_cancel/.test(e2), 'a dropped event dated another day than the upload\'s extract: bad_cancel', e2);
  await sweep();
  const e3 = await err(() => load(H(9107), CA, [dropRow(93000004, CA)], [dropEv(93000004, CA)], 'tester', { kind: 'bi_fitted', name: 'BI late 010327.xlsx' }));
  ok(e3 && /bad_cancel/.test(e3), 'an OLDER day completing late (a newer day is complete) cannot cancel: bad_cancel', e3);
  await sweep();
  const e4 = await err(() => load(H(9108), CB, [dropRow(93000004, CB)], [dropEv(93000004, CB)], 'tester', { kind: 'opening_book', name: 'Opening.xlsx' }));
  ok(e4 && /bad_cancel/.test(e4), 'the opening book can never cancel: bad_cancel', e4);
  await sweep();
  const e5 = await err(() => load(H(9109), CC, [crow(93000005, CC, { status: 'cancelled', cancel_reason: null })], [], 'tester', { kind: 'bi_fitted' }));
  ok(e5 && /check constraint/.test(e5), 'a cancelled case without a reason breaks a check', e5);
  await sweep();
  const e6 = await err(() => load(H(9110), CC, [crow(93000005, CC, { cancel_reason: 'dropped' })], [], 'tester', { kind: 'bi_fitted' }));
  ok(e6 && /check constraint/.test(e6), 'a reason on a case that is not cancelled breaks a check', e6);
  await sweep();
  const e7 = await err(() => load(H(9111), CC, [crow(93000005, CC)], [erow(93000005, CC, { to_status: 'cancelled' })], 'tester', { kind: 'bi_fitted' }));
  ok(e7 && /check constraint/.test(e7), 'a cancelled event without a reason breaks a check', e7);
  await sweep();
  const e8 = await err(() => load(H(9112), CC, [crow(93000005, CC, { status: 'cancelled', cancel_reason: 'gone' })], [], 'tester', { kind: 'bi_fitted' }));
  ok(e8 && /check constraint/.test(e8), 'an unknown reason breaks a check', e8);
  await sweep();
  const dv = await load(H(9113), CC, [crow(93000006, CC, { status: 'cancelled', cancel_reason: 'deactivated' })], [erow(93000006, CC, { to_status: 'cancelled', reason: 'deactivated' })], 'tester', { kind: 'bi_fitted', name: 'BI 030327.xlsx' });
  ok(dv.res && dv.res.events === 1, 'an explicit deactivation needs no complete day: one BI file may write it', JSON.stringify(dv.res)); }
{ const tr2 = await rpc('vt_trim', [13, '2028-06-01']);
  ok(!(await one('select 1 x from vt_cases where case_number = 93000002')) && !(await one('select 1 x from vt_case_events where case_number = 93000002')),
    'vt_trim treats a cancelled case as CLOSED: last seen before the cutoff, it goes with its events', JSON.stringify(tr2));
  ok(!!(await one('select 1 x from vt_cases where case_number = 93000004')), '...while an open (scheduled) case is never trimmed', JSON.stringify(tr2)); }
await db.exec(`set vt.today = '2026-11-23'`);

head('R10 · signatures, grants, applying');
{ const sigs = (await all(`select p.oid::regprocedure::text sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'vt\\_%' order by 1`)).map((x) => x.sig);
  eq('the VT function signatures, exactly (no stale overload left behind)', sigs, ['vt_book(date,bigint[])', 'vt_db_size()', 'vt_roster_at(date)', 'vt_trim(integer,date,integer)',
    'vt_upload_abandon(bigint,text)', 'vt_upload_begin(text,text,text,date,text,text)', 'vt_upload_commit(bigint,bigint,jsonb,jsonb,jsonb,boolean,integer,integer,text)',
    'vt_upload_stage(bigint,text,integer,jsonb,text)']);
  for (const r of ['public', 'anon', 'authenticated']) {
    const can = [];
    for (const sg of sigs) if (r === 'public' ? (await one(`select coalesce(array_to_string(proacl, ','), '') ~ '(^|,)=X' x from pg_proc where oid = $1::regprocedure`, [sg])).x
      : (await one(`select has_function_privilege('${r}', $1::regprocedure, 'execute') e`, [sg])).e) can.push(sg);
    ok(can.length === 0, r + ' may EXECUTE none of the ' + sigs.length + ' VT signatures (p_user ones included)', can.join(', '));
  }
  for (const sg of sigs) ok((await one(`select has_function_privilege('service_role', $1::regprocedure, 'execute') e`, [sg])).e, 'service_role may EXECUTE ' + sg); }
{ const first = splitSql(M72).map(strip).filter(Boolean)[0];
  ok(/^set local lock_timeout = '3s';?$/i.test(first), 'migration-072 starts with set local lock_timeout = 3s', first);
  for (const [f, t] of [['071', M71], ['072', M72]]) { const l = splitSql(t).map(strip).filter(Boolean).pop();
    ok(/^notify pgrst, 'reload schema';?$/i.test(l), 'migration-' + f + ' ends by asking PostgREST to reload its schema', l); } }
done();
