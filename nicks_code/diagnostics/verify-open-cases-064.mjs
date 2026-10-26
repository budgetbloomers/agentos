#!/usr/bin/env node
/* verify-open-cases-064.mjs — OPEN CASES KEEPS AGENT ROWS; THE QUEUES BECOME A DAILY COUNT (stability plan, 2026-10-26).
 *
 * migration-064 runs VERBATIM in PGlite (in-process PostgreSQL, no network, no connection string) on top of the real
 * table definitions it builds on (sf_open_cases from migration-010, lm_open_book_cache from migration-035, the real queue
 * classifier rake_owner_kind from migration-038) and simple stand-ins for the loader's text-cleaning helpers. Proves:
 *   O1  a day's load stores only agent-owned and unclassified rows; every queue row becomes a count
 *   O2  merging the same chunk again replaces its counts — never doubles them; the stored rows do not change
 *   O3  the lead book's total / agent_rows / queue_rows / rows are exactly what the old whole-book storage gave
 *   O4  a re-upload of the same day (a new batch) counts only that batch's queues
 *   O5  a snapshot stored before 064 (queue rows in the table) is still counted right
 *   O6  rows without a date or case number are still rejected, and `merged` still counts every good row
 *
 *   node nicks_code/diagnostics/verify-open-cases-064.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { splitSql, strip } from './usage-028-harness.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const SQL = (f) => fs.readFileSync(path.join(ROOT, 'supabase', f), 'utf8').replace(/\r\n/g, '\n');
const { PGlite } = await import(pathToFileURL(path.join(HERE, 'node_modules', '@electric-sql', 'pglite', 'dist', 'index.js')).href);
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m + (d !== undefined ? ' — ' + d : '')); } };
const head = (t) => console.log('\n' + t);
const pick = (file, re) => { const s = splitSql(SQL(file)).find((x) => re.test(strip(x))); if (!s) throw new Error(file + ': no statement matching ' + re); return s; };

const db = new PGlite();
await db.exec(`do $$ begin create role service_role bypassrls; exception when duplicate_object then null; end $$;`);
/* the real tables the migration builds on */
await db.exec(pick('migration-010-source-tables.sql', /^create table if not exists sf_open_cases/i));
await db.exec(pick('migration-035-lead-book.sql', /^create table if not exists lm_open_book_cache/i));
await db.exec(`create table batches (batch_id text primary key, file_name text);
  create table rake_owner_map (key text primary key, cb text);
  create table rake_stage_sf_open (_seq bigserial primary key, snapshot_date text, case_number text, case_id text, subject text, opened_at text,
    age_hours text, account_number text, account_name text, case_owner text, status text, record_type text);
  create or replace function rake_date(p text) returns date language sql immutable as $$ select nullif(trim(p), '')::date $$;
  create or replace function rake_idish(p text) returns text language sql immutable as $$ select nullif(trim(p), '') $$;
  create or replace function rake_sf_ts_local(p text) returns timestamptz language sql immutable as $$ select nullif(trim(p), '')::timestamptz $$;
  create or replace function rake_num(p text) returns numeric language sql immutable as $$ select nullif(trim(p), '')::numeric $$;
  create or replace function norm_owner(p text) returns text language sql immutable as $$ select lower(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g')) $$;`);
await db.exec(pick('migration-038-queue-owners.sql', /^create or replace function rake_owner_kind/i));
/* migration-064 itself, statement by statement */
for (const st of splitSql(SQL('migration-064-open-cases-agent-rows.sql'))) {
  try { await db.exec(st); } catch (e) { ok(false, 'migration-064 statement applies: ' + strip(st).slice(0, 70), e.message); }
}
ok(true, 'migration-064 applies on top of the real tables');
await db.exec(`insert into rake_owner_map values ('thandimokoena', 'CB901'), ('siphodlamini', 'CB902'), ('leemanager', 'CB903')`);

const stage = async (day, rows) => {
  await db.exec('truncate rake_stage_sf_open restart identity');
  for (const [cn, owner, status] of rows)
    await db.query('insert into rake_stage_sf_open (snapshot_date, case_number, case_owner, status, opened_at) values ($1,$2,$3,$4,$5)', [day, cn, owner, status, '2026-10-01T08:00:00Z']);
};
const merge = async (batch, from, to) => (await db.query('select * from rake_merge_sf_open($1,$2,$3)', [batch, from, to])).rows[0];
const one = async (q, p = []) => (await db.query(q, p)).rows[0];
const DAY = [
  ['C1', 'Thandi Mokoena', 'Open'], ['C2', 'Sipho Dlamini', 'Open'], ['C3', 'Lee Manager', 'New'],
  ['C4', '', 'Open'],                                                        // no owner: unclassified, kept as a row
  ['Q1', 'Courtesy Call', 'Open'], ['Q2', 'Courtesy Call', 'Open'], ['Q3', 'Courtesy call- Panimax', 'Open'],
  ['Q4', 'Cuddle Call', 'New'], ['Q5', 'Cuddle Call', 'New'], ['Q6', 'Cuddle Call', 'Open'],
];

head('O1 · a day\'s load stores agent rows; the queues become counts');
await db.exec(`insert into batches values ('B1', 'SF Open 241026.csv')`);
await stage('2026-10-24', DAY);
const m1 = await merge('B1', 0, DAY.length);
const stored = await one(`select count(*)::int n, count(*) filter (where owner_kind = 'queue')::int q from sf_open_cases where snapshot_date = '2026-10-24'`);
ok(stored.n === 4 && stored.q === 0, 'stored: the 3 agent rows + the 1 unowned row, no queue rows', JSON.stringify(stored));
const qsum = await one(`select coalesce(sum(n),0)::int n, count(*)::int k from sf_open_queue_daily where snapshot_date = '2026-10-24' and batch_id = 'B1'`);
ok(qsum.n === 6, 'counted: 6 queue rows', JSON.stringify(qsum));
const byOwner = (await db.query(`select case_owner, status, n::int from sf_open_queue_daily order by 1, 2`)).rows;
ok(byOwner.length === 4 && byOwner.some((r) => r.case_owner === 'Courtesy call- Panimax' && r.n === 1), 'one count per queue owner and status (the Panimax pseudo-queue is a queue — migration-038)', JSON.stringify(byOwner));
ok(Number(m1.merged) === 10 && Number(m1.rejected) === 0, 'merged still counts every good row (10), so the upload record matches the file', JSON.stringify(m1));

head('O2 · merging the same chunk again replaces, never doubles');
const m2 = await merge('B1', 0, DAY.length);
const stored2 = await one(`select count(*)::int n from sf_open_cases where snapshot_date = '2026-10-24'`);
const qsum2 = await one(`select coalesce(sum(n),0)::int n from sf_open_queue_daily where snapshot_date = '2026-10-24' and batch_id = 'B1'`);
ok(stored2.n === 4 && qsum2.n === 6 && Number(m2.merged) === 10, 'a re-run chunk: still 4 rows and 6 counted', JSON.stringify({ stored2, qsum2, m2 }));
/* two chunks of one file: the counts add across chunks */
await db.exec(`truncate sf_open_queue_daily; delete from sf_open_cases;`);
await merge('B1', 0, 5); await merge('B1', 5, DAY.length);
const split = await one(`select coalesce(sum(n),0)::int n from sf_open_queue_daily where batch_id = 'B1'`);
ok(split.n === 6, 'two chunks of one file: their counts add up to the whole file\'s queues', JSON.stringify(split));

head('O3 · the lead book is what the whole-book storage gave');
const book = (await db.query('select lm_open_book_refresh() j')).rows[0].j;
ok(book.total === 10 && book.agent_rows === 3 && book.queue_rows === 6, 'total 10, agent_rows 3, queue_rows 6 — as when every row was stored', JSON.stringify(book));
const rows = (await one('select jsonb_array_length(rows) n from lm_open_book_cache')).n;
ok(rows === 3, 'the shipped rows are the 3 agent-owned cases', String(rows));

head('O4 · a re-upload of the same day counts only its own queues');
await db.exec(`insert into batches values ('B2', 'SF Open - 24.10.2026.csv')`);
const DAY2 = [['C1', 'Thandi Mokoena', 'Open'], ['C2', 'Sipho Dlamini', 'Closed'], ['Q1', 'Courtesy Call', 'Open'], ['Q7', 'Cuddle Call', 'New']];
await stage('2026-10-24', DAY2);
await new Promise((r) => setTimeout(r, 15));
await merge('B2', 0, DAY2.length);
const book2 = (await db.query('select lm_open_book_refresh() j')).rows[0].j;
ok(book2.queue_rows === 2, 'the lead book shows the newest batch\'s 2 queue rows, not B1\'s 6 on top', JSON.stringify(book2));

head('O5 · a snapshot stored before 064 is still counted right');
await db.exec(`insert into batches values ('OLD', 'SF Open 251026.csv');
  insert into sf_open_cases (snapshot_date, case_number, case_owner, owner_kind, status, batch_id) values
    ('2026-10-25', 'A1', 'Thandi Mokoena', 'agent', 'Open', 'OLD'), ('2026-10-25', 'A2', 'Courtesy Call', 'queue', 'Open', 'OLD'),
    ('2026-10-25', 'A3', 'Cuddle Call', 'queue', 'New', 'OLD')`);
const book3 = (await db.query('select lm_open_book_refresh() j')).rows[0].j;
ok(book3.snapshot_date === '2026-10-25' && book3.agent_rows === 1 && book3.queue_rows === 2 && book3.total === 3, 'queue rows stored the old way still count (1 agent, 2 queue, total 3)', JSON.stringify(book3));

head('O6 · bad rows are still rejected');
await stage('2026-10-26', [['B1x', 'Thandi Mokoena', 'Open'], ['', 'Thandi Mokoena', 'Open'], ['Q9', 'Courtesy Call', 'Open']]);
await db.exec(`update rake_stage_sf_open set snapshot_date = '' where case_number = 'Q9'`);
const m6 = await merge('B6', 0, 3);
ok(Number(m6.merged) === 1 && Number(m6.rejected) === 2, 'no case number / no date → rejected; the good row merges', JSON.stringify(m6));

console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
process.exit(fail ? 1 : 0);
