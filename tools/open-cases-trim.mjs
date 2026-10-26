/* OPEN CASES TRIM — the old snapshots get what migration-064 gives every new day (stability plan, 2026-10-26).
 *
 * Until 26 Oct every morning's Open Cases book (~490k rows) was stored whole; ~80% of it is the unallocated
 * "Courtesy Call" / "Cuddle Call" queues, which nothing reads row by row. migration-064 makes each NEW load store agent
 * rows + a queue count. This tool does the same to the snapshots already stored, one day at a time:
 *   1. COUNT   that day's queue rows into sf_open_queue_daily (chunk_from = -1, the "trimmed" marker), per batch/owner/status
 *   2. ARCHIVE that day's queue rows as gzipped CSV in Storage: raw/archive/sf_open_cases/YYYY/MM/<date>.queue.csv.gz,
 *              then download it again and check the row count before anything is deleted
 *   3. DELETE  that day's queue rows (agent rows are never touched)
 * and finally VACUUM FULL each trimmed partition so the disk space actually comes back, then rebuilds the lead book.
 *
 *   node tools/open-cases-trim.mjs              # DRY RUN: what each day would count / archive / delete, and the space
 *   node tools/open-cases-trim.mjs --apply      # do it (needs Nick's approval of the dry run)
 *
 * Never touches: agent-owned rows, the newest snapshot's agent rows, anything outside sf_open_cases. Re-runnable: a day
 * with no queue rows left is skipped. Every day is its own transaction — a failure stops the run and leaves that day whole.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = {}; for (const l of fs.readFileSync(path.join(ROOT, 'supabase.env'), 'utf8').split(/\r?\n/)) { const m = /^([A-Z_]+)=(.*)$/.exec(l.trim()); if (m) env[m[1]] = m[2]; }
const pg = (await import(pathToFileURL(path.join(ROOT, 'nicks_code', 'diagnostics', 'node_modules', 'pg', 'lib', 'index.js')).href)).default;
const APPLY = process.argv.includes('--apply');
const MB = (n) => (Number(n) / 1048576).toFixed(0) + ' MB';
const H = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY };
const COLS = ['snapshot_date', 'case_number', 'case_id', 'subject', 'opened_at', 'age_hours', 'account_number', 'account_name', 'case_owner', 'employee_code', 'owner_kind', 'status', 'record_type', 'batch_id', 'loaded_at'];
const csvCell = (v) => { if (v == null) return ''; const s = v instanceof Date ? v.toISOString() : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };

const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 0 });
await c.connect();

/* the snapshots that still hold queue rows, per day */
const days = (await c.query(`
  select snapshot_date::text d, count(*)::bigint total, count(*) filter (where owner_kind = 'queue')::bigint queue,
         count(*) filter (where owner_kind is distinct from 'queue')::bigint agent, array_agg(distinct batch_id) batches
    from sf_open_cases group by 1 having count(*) filter (where owner_kind = 'queue') > 0 order by 1`)).rows;
const parts = (await c.query(`
  select c.relname part, pg_total_relation_size(c.oid) bytes
    from pg_inherits i join pg_class c on c.oid = i.inhrelid join pg_class p on p.oid = i.inhparent where p.relname = 'sf_open_cases'`)).rows;
const partOf = (d) => 'sf_open_cases_p' + d.slice(0, 7).replace('-', '') + '01';
const files = (await (await fetch(env.SUPABASE_URL + '/rest/v1/upload_files?source=eq.SF_OPEN_CASES&status=eq.loaded&select=file_name,storage_path,span_from,span_to', { headers: H })).json()) || [];
const rawFor = (d) => files.filter((f) => f.span_from && f.span_from <= d && (f.span_to || f.span_from) >= d).length;

console.log((APPLY ? 'APPLY' : 'DRY RUN') + ' — Open Cases snapshots still holding queue rows: ' + days.length + '\n');
console.log('  day          total      queue     agent   raw upload kept');
let qAll = 0;
for (const d of days) { qAll += Number(d.queue); console.log('  ' + d.d + ' ' + String(d.total).padStart(9) + ' ' + String(d.queue).padStart(9) + ' ' + String(d.agent).padStart(9) + '   ' + (rawFor(d.d) ? 'yes' : 'no')); }
const touched = [...new Set(days.map((d) => partOf(d.d)))];
let reclaim = 0;
for (const p of touched) {
  const size = Number((parts.find((x) => x.part === p) || {}).bytes || 0);
  const inP = days.filter((d) => partOf(d.d) === p);
  const share = inP.reduce((s, d) => s + Number(d.queue), 0) / Math.max(1, inP.reduce((s, d) => s + Number(d.total), 0));
  reclaim += size * share;
  console.log('\n  ' + p + ': ' + MB(size) + ' now, ~' + MB(size * (1 - share)) + ' after (' + Math.round(share * 100) + '% of its rows are queue rows)');
}
console.log('\n  queue rows to count, archive and delete: ' + qAll.toLocaleString('en-ZA') + ' · space expected back: ~' + MB(reclaim));
if (!APPLY) { console.log('\nDRY RUN — nothing written. Re-run with --apply once approved.'); await c.end(); process.exit(0); }

/* ---------------------------------------------------------------- apply, one day at a time */
for (const d of days) {
  const day = d.d;
  /* 2 · archive first, outside the transaction: a file that cannot be written or read back stops the run */
  const rows = (await c.query(`select ${COLS.join(',')} from sf_open_cases where snapshot_date = $1 and owner_kind = 'queue' order by case_number`, [day])).rows;
  const csv = COLS.join(',') + '\n' + rows.map((r) => COLS.map((k) => csvCell(r[k])).join(',')).join('\n') + '\n';
  const gz = zlib.gzipSync(Buffer.from(csv, 'utf8'));
  const obj = `archive/sf_open_cases/${day.slice(0, 4)}/${day.slice(5, 7)}/${day}.queue.csv.gz`;
  const put = await fetch(`${env.SUPABASE_URL}/storage/v1/object/raw/${obj}`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/gzip', 'x-upsert': 'true' }, body: gz });
  if (!put.ok) throw new Error(day + ': archive upload failed ' + put.status + ' ' + (await put.text()).slice(0, 120));
  const back = await fetch(`${env.SUPABASE_URL}/storage/v1/object/raw/${obj}`, { headers: H });
  const backRows = back.ok ? zlib.gunzipSync(Buffer.from(await back.arrayBuffer())).toString('utf8').trim().split('\n').length - 1 : -1;
  if (backRows !== rows.length) throw new Error(day + ': archive read back ' + backRows + ' rows, expected ' + rows.length + ' — nothing deleted');
  /* 1 + 3 · count and delete in ONE transaction: the counts exist exactly when the rows are gone */
  await c.query('begin');
  try {
    await c.query(`insert into sf_open_queue_daily (snapshot_date, batch_id, chunk_from, case_owner, status, n)
      select snapshot_date, coalesce(batch_id, ''), -1, coalesce(case_owner, ''), coalesce(status, ''), count(*)
        from sf_open_cases where snapshot_date = $1 and owner_kind = 'queue' group by 1, 2, 4, 5
      on conflict (snapshot_date, batch_id, chunk_from, case_owner, status) do update set n = excluded.n`, [day]);
    const del = await c.query(`delete from sf_open_cases where snapshot_date = $1 and owner_kind = 'queue'`, [day]);
    if (del.rowCount !== rows.length) throw new Error(day + ': deleted ' + del.rowCount + ' but archived ' + rows.length);
    await c.query('commit');
    console.log('  ' + day + ': ' + rows.length + ' queue rows counted, archived (' + MB(gz.length) + ' → ' + obj + ') and removed');
  } catch (e) { await c.query('rollback').catch(() => {}); throw e; }
}
/* the space comes back only when each trimmed partition is rewritten */
for (const p of touched) {
  const before = Number((await c.query('select pg_total_relation_size($1::regclass) b', [p])).rows[0].b);
  await c.query(`vacuum (full, analyze) ${p}`);
  const after = Number((await c.query('select pg_total_relation_size($1::regclass) b', [p])).rows[0].b);
  console.log('  ' + p + ': ' + MB(before) + ' → ' + MB(after));
}
const book = (await c.query('select lm_open_book_refresh() j')).rows[0].j;
const db = (await c.query('select pg_size_pretty(pg_database_size(current_database())) s')).rows[0].s;
console.log('\nlead book: ' + JSON.stringify({ snapshot_date: book.snapshot_date, total: book.total, agent_rows: book.agent_rows, queue_rows: book.queue_rows }));
console.log('database now: ' + db);
await c.end();
