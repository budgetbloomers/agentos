#!/usr/bin/env node
/**
 * verify-rake.mjs — the Data Rake recognises, converts and merges correctly.
 *
 *   node nicks_code/diagnostics/verify-rake.mjs
 *
 * Two halves. THE LIBRARY (tools/rake-lib.mjs) on fixtures written to a temp folder: source detection
 * for all four contracts and their negatives, the snapshot-date rule, byte sniffing, entity decoding,
 * the streaming HTML-table parser (latin1 charset, entities, rows straddling chunk boundaries), the
 * delimited reader with the canonical CSV writer. THE DATABASE (migrations 028–030) inside ONE
 * transaction that always rolls back: staging rows go in, each merge is called, the lake is read back —
 * keyed merge, rejected rows and the rejects views, owner resolution through rake_owner_map, the
 * closed-cases midnight-UTC key convention, idempotency (a second merge updates, never duplicates), the
 * health function's shape. Fixture identities (cases 9000xx, CB900077) cannot collide with real data.
 */
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url'; import { createRequire } from 'node:module';
const HERE = path.dirname(fileURLToPath(import.meta.url)); const ROOT = path.resolve(HERE, '..', '..');
const req = createRequire(path.join(HERE, 'node_modules', 'x.js'));
const pg = req('pg'); const { parse: csvParse } = req('csv-parse');
const lib = await import(pathToFileURL(path.join(ROOT, 'tools', 'rake-lib.mjs')).href);
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, 'supabase.env'), 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^"|"$/g, '')]));
let pass = 0, fail = 0; const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (d ? ' — ' + d : '')); } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-rake-'));

console.log('\nA · THE LIBRARY');
ok('open cases header → SF_OPEN_CASES', lib.detect(['Case ID', 'Case Number', 'Subject', 'Date/Time Opened', 'Age (Hours)', 'Open', 'Account Name', 'Account Number', 'Case Record Type', 'Case Owner', 'Status']) === 'SF_OPEN_CASES');
ok('the same header WITH Date/Time Closed → SF_CLOSED_CASES, never open', lib.detect(['Case ID', 'Case Number', 'Date/Time Opened', 'Date/Time Closed', 'Closed', 'Disposition', 'Case Owner', 'Status']) === 'SF_CLOSED_CASES');
ok('Power BI header (duplicate columns) → BI_ACTIVE_CASES', lib.detect(['Account Number', 'Contract Status', 'Owner', 'Contract Create Date', 'Contract Status', 'Charge Amount', 'Charge Code', 'Charge Amount', 'Case Number']) === 'BI_ACTIVE_CASES');
ok('ViciDial header → VICI_CALL_REPORT', lib.detect(['call_date', 'phone_number_dialed', 'status', 'user', 'full_name', 'length_in_sec', 'lead_id', 'status_name']) === 'VICI_CALL_REPORT');
ok('an unrelated header is refused', lib.detect(['Employee Code', 'Agent Name', 'Campaign']) === null);
ok('header matching ignores case and spacing', lib.detect(['case  number', 'DATE/TIME OPENED', 'Case owner']) === 'SF_OPEN_CASES');
ok('duplicate header: the FIRST occurrence wins', lib.pickIndexes(['Account Number', 'Charge Amount', 'X', 'Charge Amount'], lib.SOURCES.BI_ACTIVE_CASES).charge_amount === 1);
ok('snapshot date from ddmmyy in the file name', lib.snapshotFrom('sf closed 070926.xls', '2026-09-08T05:20:00Z') === '2026-09-07');
ok('snapshot date falls back to the received day', lib.snapshotFrom('SF Open.csv', '2026-09-08T05:20:00Z') === '2026-09-08');
ok('a report id (report1787767624322) is not mistaken for a date', lib.snapshotFrom('report1787767624322.xls', '2026-09-08T05:20:00Z') === '2026-09-08');
ok('sniff: xlsx by PK magic', lib.sniff(Buffer.from('PKrest')) === 'xlsx');
ok('sniff: Salesforce HTML export', lib.sniff(Buffer.from('<head><META http-equiv="Content-Type"></head><table><tr><th>Case ID</th></tr>')) === 'html');
ok('sniff: tab-separated vs comma', lib.sniff(Buffer.from('call_date\tuser\tlength_in_sec\n')) === 'tsv' && lib.sniff(Buffer.from('"Case ID","Case Number"\n')) === 'csv');
ok('entities decode', lib.decodeEntities('Sm&amp;th &lt;b&gt; &quot;x&quot; &#39;y&#39;&nbsp;') === 'Sm&th <b> "x" \'y\' ');
ok('CSV quoting escapes commas, quotes and newlines', lib.csvQuote('a,b') === '"a,b"' && lib.csvQuote('say "hi"') === '"say ""hi"""' && lib.csvQuote('plain') === 'plain' && lib.csvQuote(null) === '');

/* the streaming HTML parser on a latin1 fixture with an accented byte, entities, and rows across chunk boundaries */
{ const rows = []; const html = '<head><META http-equiv="Content-Type" content="text/html; charset=ISO-8859-1"></head><table><tr><th filter=all>Case ID</th><th>Case Number</th><th>Date/Time Closed</th><th>Case Owner</th></tr>'
    + Array.from({ length: 3000 }, (_, i) => `<tr><td style="x">500Sl${i}</td><td align=right>${900000 + i}</td><td>2026/09/0${(i % 7) + 1}, 1${i % 10}:2${i % 6}</td><td><b>René</b> &amp; Co - Panimax</td></tr>`).join('') + '</table>';
    const p = path.join(tmp, 'fixture.xls'); fs.writeFileSync(p, Buffer.from(html, 'latin1'));
    const headers = await lib.readHtmlTable(p, async (h) => lib.detect(h) === 'SF_CLOSED_CASES', async (cells) => { rows.push(cells); });
    ok('HTML parser: header recognised and every row emitted (file spans many 64 KB chunks)', headers.length === 4 && rows.length === 3000, headers.length + ' cols, ' + rows.length + ' rows');
    ok('HTML parser: tags stripped, entities decoded, latin1 byte read as é', rows[0][0] === '500Sl0' && rows[0][3] === 'René & Co - Panimax', JSON.stringify(rows[0]));
    ok('HTML parser: the last row is intact (chunk boundaries do not split rows)', rows[2999][1] === '902999', JSON.stringify(rows[2999]));
    ok('HTML parser: an unrecognised header is refused', await lib.readHtmlTable(p, async () => false, async () => {}).then(() => false, (e) => /unrecognised/.test(e.message))); }
/* the delimited reader and the canonical writer together */
{ const p = path.join(tmp, 'vici.txt'); fs.writeFileSync(p, 'call_date\tuser\tlength_in_sec\tlead_id\tstatus\n2026-09-04 06:48:08\tCB188\t23\t223363\tA\n2026-09-04 06:49:00\tcb 7\t0\t\tN\n');
  const c = lib.SOURCES.VICI_CALL_REPORT; let idx; const w = lib.canonWriter(path.join(tmp, 'canon.csv'), Object.keys(c.cols));
  await lib.readDelimited(csvParse, p, '\t', async (h) => { idx = lib.pickIndexes(h, c); return lib.detect(h) === 'VICI_CALL_REPORT'; }, (rec) => w.row(Object.keys(c.cols).map((k) => (idx[k] >= 0 ? rec[idx[k]] : ''))));
  const n = await w.end(); const out = fs.readFileSync(path.join(tmp, 'canon.csv'), 'utf8').split('\n');
  ok('delimited reader + writer: two rows, _seq first, absent columns blank', n === 2 && out[0].startsWith('_seq,call_date,agent_login') && out[1].startsWith('1,2026-09-04 06:48:08,CB188,223363,A') && out[2].includes(',cb 7,'), out.slice(0, 3).join(' | ')); }

console.log(String.fromCharCode(10) + 'C · STORAGE');
/* the project upload limit caps every bucket; while it sits at the 50 MB default the Rake cannot receive the files it exists for */
{ const H = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY };
  const b = await fetch(env.SUPABASE_URL + '/storage/v1/bucket/raw-uploads', { headers: H }).then((r) => r.json()).catch(() => null);
  const lim = b && b.file_size_limit; const GB = 1024 ** 3;
  ok('raw-uploads bucket accepts at least 1 GB per file (raise Storage → Settings → Upload file size limit, then set the bucket limit)', lim >= GB, 'bucket limit is ' + (lim == null ? 'unset — project default 50 MB applies' : (lim / 1048576).toFixed(0) + ' MB')); }

console.log('\nB · THE DATABASE (one transaction, rolled back)');
const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 120000 }); await c.connect();
const q = async (s, a) => (await c.query(s, a)).rows; const one = async (s, a) => (await q(s, a))[0];
try {
  await c.query('BEGIN');
  await c.query(`insert into agent_list (as_of, employee_code, agent_name, sales_force, campaign, tenure, team_leader, batch_id) values ((select max(as_of) from agent_list), 'CB900077', 'Fixture Owner', 'Fixture Owner - Panimax', 'Courtesy', 'Exp', 'Test Leader', 'verify-rake')`);
  await c.query(`insert into batches (batch_id, source_type, source_system, uploaded_by, file_name, status) values ('verify-rake', 'BI_ACTIVE_CASES', 'rake', 'verify-rake', 'fixture', 'loading'), ('verify-rake-2', 'SF_CLOSED_CASES', 'rake', 'verify-rake', 'fixture', 'loading')`);
  ok('owner resolution: a Salesforce display name maps to the CB (queue suffix stripped)', (await one(`select rake_owner_cb('Fixture Owner - EC3') cb`)).cb === 'CB900077');
  ok('owner resolution: an unknown name resolves to nothing, never a guess', (await one(`select rake_owner_cb('Nobody At All') cb`)).cb === null);
  const k = await one(`select rake_owner_kind('Courtesy Call') q, rake_owner_kind('Fixture Owner') a, rake_owner_kind('') e`);
  ok('owner kind: a holding queue is a queue, a person is an agent, blank is null', k.q === 'queue' && k.a === 'agent' && k.e === null, JSON.stringify(k));
  /* closed cases: two good rows, one without a case number, one without a date */
  await c.query(`truncate rake_stage_sf_closed`);
  await c.query(`insert into rake_stage_sf_closed (_seq, case_id, case_number, opened_at, closed_at, disposition, status, age_hours, account_number, account_name, case_owner) values
    (1, 'X1', '900001', '2026/02/25, 13:52', '2026/09/03, 13:36', 'Sale', 'Closed', '629,0000000000', '10000164.0', 'A', 'Fixture Owner - Panimax'),
    (2, 'X2', '900002', '2026/03/01, 09:00', '2026/09/03, 09:22', 'No Sale', 'Closed', '12', '10000165', 'B', 'Courtesy Call'),
    (3, 'X3', '', '2026/03/01, 09:00', '2026/09/03, 09:22', 'No Sale', 'Closed', '12', '10000166', 'C', 'Nobody'),
    (4, 'X4', '900004', '2026/03/01, 09:00', 'not a date', 'No Sale', 'Closed', '12', '10000167', 'D', 'Nobody')`);
  const m1 = await one(`select * from rake_merge_sf_closed('verify-rake', 0, 10)`);
  ok('closed merge: 2 merged, 2 rejected (no case number; no date)', +m1.merged === 2 && +m1.rejected === 2, JSON.stringify(m1));
  const r1 = await one(`select closed_at, closed_ts, closed_day::text, employee_code, age_hours, account_number from sf_closed_cases where case_number = '900001'`);
  ok('closed merge: key is the closure DAY at midnight UTC; the true time lives in closed_ts', r1 && r1.closed_at.toISOString() === '2026-09-03T00:00:00.000Z' && r1.closed_ts.toISOString() === '2026-09-03T11:36:00.000Z' && r1.closed_day === '2026-09-03', JSON.stringify(r1));
  ok('closed merge: owner resolved, comma decimal parsed, ".0" stripped from the account', r1 && r1.employee_code === 'CB900077' && Number(r1.age_hours) === 629 && r1.account_number === '10000164', JSON.stringify(r1));
  const rej = await q(`select _seq from rake_rejects_sf_closed order by _seq`);
  ok('rejects view names exactly the unkeyable rows', rej.map((x) => +x._seq).join(',') === '3,4', JSON.stringify(rej));
  const m2 = await one(`select * from rake_merge_sf_closed('verify-rake-2', 0, 10)`);
  const cnt = await one(`select count(*) n, min(batch_id) b from sf_closed_cases where case_number in ('900001','900002')`);
  ok('closed merge is idempotent: a second pass updates in place, never duplicates', +m2.merged === 2 && +cnt.n === 2 && cnt.b === 'verify-rake-2', JSON.stringify(m2) + ' ' + JSON.stringify(cnt));
  /* open cases: an agent-owned and a queue-owned row */
  await c.query(`truncate rake_stage_sf_open`);
  await c.query(`insert into rake_stage_sf_open (_seq, case_id, case_number, subject, opened_at, age_hours, account_name, account_number, case_owner, status, record_type, snapshot_date) values
    (1, 'Y1', '900011', 'Courtesy Call', '2025/11/19, 09:43', '6817,0000000000', 'S', '10381446', 'Fixture Owner - EC3', '1st attempt', 'Welcome Call', '2026-09-08'),
    (2, 'Y2', '900012', 'Courtesy Call', '2025/11/19, 09:43', '1', 'S', '10381447', 'Cuddle Call', 'New', 'Welcome Call', '2026-09-08')`);
  const m3 = await one(`select * from rake_merge_sf_open('verify-rake', 0, 10)`);
  const o1 = await q(`select case_number, employee_code, owner_kind, snapshot_date::text from sf_open_cases where snapshot_date = '2026-09-08' and case_number in ('900011','900012') order by case_number`);
  ok('open merge: both rows land; the agent-owned one resolves, the queue-owned one is marked queue', +m3.merged === 2 && o1.length === 2 && o1[0].employee_code === 'CB900077' && o1[0].owner_kind === 'agent' && o1[1].employee_code === null && o1[1].owner_kind === 'queue', JSON.stringify(o1));
  /* Power BI: Excel serial date, duplicate charge lines, an unkeyable row */
  await c.query(`truncate rake_stage_bi`);
  await c.query(`insert into rake_stage_bi (_seq, account_no, contract_status, account_name, contract_number, owner, contract_create_date, charge_amount, charge_code, product_bundle, merged_bundle, consultant, sales_vertical, case_number) values
    (1, '90000164', 'Active', 'N', '16148772', 'Fixture Owner - Panimax', '46260', '30.43', 'MYP C35', 'Titanium', 'Titanium', 'G', 'Direct', '900021'),
    (2, '90000164', 'Active', 'N', '16148772', 'Fixture Owner - Panimax', '46260', '30.43', 'MYP C35', 'Titanium', 'Titanium', 'G', 'Direct', '900021'),
    (3, '', 'Active', 'N', '', 'Nobody', '46260', '1', '', '', '', '', '', '900022')`);
  const m4 = await one(`select * from rake_merge_bi('verify-rake', 0, 10)`);
  const b1 = await one(`select contract_create_date::text d, cb, charge_amount from bi_active_cases where case_number = '900021'`);
  ok('BI merge: duplicate charge lines collapse to one; Excel serial 46260 = 2026-08-26; owner → CB', +m4.merged === 1 && +m4.rejected === 1 && b1 && b1.d === '2026-08-26' && b1.cb === 'CB900077' && Number(b1.charge_amount) === 30.43, JSON.stringify(m4) + ' ' + JSON.stringify(b1));
  /* ViciDial: a CB login and a system login */
  await c.query(`truncate rake_stage_vici`);
  await c.query(`insert into rake_stage_vici (_seq, call_date, agent_login, lead_id, status, full_name, user_group, campaign_id, length_in_sec, status_name) values
    (1, '2026-09-04 06:48:08', 'CB900077', '223363', 'A', 'Fixture Owner', 'Fabian_Digital', '3001', '23', 'Answering Machine'),
    (2, '2026-09-04 06:49:08', 'VDCL', '', 'N', 'Inbound No Agent', 'MAIN', '3001', '0', 'No Answer'),
    (3, '', 'CB900077', '1', 'A', 'Fixture Owner', 'Fabian_Digital', '3001', '5', 'x')`);
  const m5 = await one(`select * from rake_merge_vici('verify-rake', 0, 10)`);
  const v1 = await q(`select agent_login, employee_code, call_day::text, length_in_sec from vici_calls where batch_id = 'verify-rake' order by agent_login`);
  ok('Vici merge: CB login becomes employee_code, a system login does not; SAST day derived; dateless row rejected', +m5.merged === 2 && +m5.rejected === 1 && v1.length === 2 && v1[0].employee_code === 'CB900077' && v1[1].employee_code === null && v1[0].call_day === '2026-09-04' && v1[0].length_in_sec === 23, JSON.stringify(v1));
  /* migration-031: same bytes load once, but a failed attempt may share its hash with the retry that succeeds */
  await c.query(`insert into upload_files (file_name, sha256, storage_path, status, uploaded_by) values ('fx-a', 'deadbeef-verify-rake', 'test/a', 'failed', 'verify-rake'), ('fx-b', 'deadbeef-verify-rake', 'test/b', 'loaded', 'verify-rake')`);
  await c.query('savepoint twin');
  const twin = await c.query(`insert into upload_files (file_name, sha256, storage_path, status, uploaded_by) values ('fx-c', 'deadbeef-verify-rake', 'test/c', 'loaded', 'verify-rake')`).then(() => 'accepted', (e) => e.code);
  await c.query('rollback to savepoint twin');
  ok('upload_files: a failed attempt may repeat a loaded hash, a second LOADED copy is refused (23505)', twin === '23505', String(twin));
  /* migration-032: dedupe_lake() removes semantic twins and keeps real re-closures */
  await c.query(`insert into sf_closed_cases (case_number, closed_at, closed_ts, closed_day, disposition, batch_id) values
    ('900091', '2026-09-02 00:00+00', '2026-09-03 11:00+00', '2026-09-03', 'Sale', 'verify-rake'),
    ('900091', '2026-09-03 00:00+00', '2026-09-03 11:00+00', '2026-09-03', 'Sale', 'verify-rake-2'),
    ('900092', '2026-09-01 00:00+00', '2026-09-01 09:00+00', '2026-09-01', 'No Answer', 'verify-rake'),
    ('900092', '2026-09-05 00:00+00', '2026-09-05 09:00+00', '2026-09-05', 'No Answer', 'verify-rake')`);
  await c.query(`insert into agent_list (as_of, employee_code, agent_name, batch_id) values ((select max(as_of) from agent_list), 'CB-900077', 'Fixture Owner', 'verify-rake')`);
  const dry = (await one(`select dedupe_lake(false, 'verify-rake dry') r`)).r;
  ok('dedupe_lake(dry): finds the keyed twin and the spelt-twice CB, touches nothing', dry.sf_closed_cases.found === 1 && dry.agent_list.found === 1 && dry.removed_total === 0 && +(await one(`select count(*) n from sf_closed_cases where case_number = '900091'`)).n === 2, JSON.stringify({ c: dry.sf_closed_cases, l: dry.agent_list }));
  const live = (await one(`select dedupe_lake(true, 'verify-rake') r`)).r;
  const left = await q(`select case_number, closed_at, batch_id from sf_closed_cases where case_number in ('900091','900092') order by 1, 2`);
  ok('dedupe_lake(apply): the twin goes (latest load kept), the re-closed case keeps both days', live.removed_total === 2 && left.length === 3 && left[0].batch_id === 'verify-rake-2' && left.filter((x) => x.case_number === '900092').length === 2, JSON.stringify(left));
  ok('dedupe_lake: the canonical CB row survives, the spelt variant goes', +(await one(`select count(*) n from agent_list where as_of = (select max(as_of) from agent_list) and norm_cb(employee_code) = 'CB900077'`)).n === 1 && +(await one(`select count(*) n from agent_list where employee_code = 'CB-900077'`)).n === 0);
  ok('dedupe_lake: both runs are logged', +(await one(`select count(*) n from dedupe_log where actor like 'verify-rake%'`)).n === 2);
  const h = await one(`select rake_health() h`);
  ok('rake_health() has the shape the Worker reads', ['received_stuck', 'in_flight', 'failed_24h', 'failed_names', 'queue_depth', 'dlq_depth', 'last_run'].every((key) => key in h.h), JSON.stringify(h.h).slice(0, 160));
} catch (e) { ok('database half ran without an exception', false, e.message); }
finally { await c.query('ROLLBACK'); await c.end(); fs.rmSync(tmp, { recursive: true, force: true }); }

console.log('\n==== ' + pass + ' passed, ' + fail + ' failed  (transaction rolled back — nothing was written) ====');
process.exit(fail ? 1 : 0);
