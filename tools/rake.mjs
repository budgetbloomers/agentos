#!/usr/bin/env node
/**
 * rake.mjs — the Data Rake: large files from the Upload Station into the lake, streaming.
 *
 *   node tools/rake.mjs                       drain the ingest queue, then refresh agent_day
 *   node tools/rake.mjs --file <upload_files.id>   process one recorded file (queued or not)
 *   node tools/rake.mjs --register raw-uploads/<path> [--name <file name>] [--by <user>]
 *                                             record an object already in storage and process it
 *   node tools/rake.mjs --dry                 validate and transform (Parquet) but load nothing
 *
 * WHAT IT DOES, PER FILE (specs/data-pipeline-plan.md, Phase 1):
 *   1 receive   the Worker recorded the file (upload_files: received) and queued its id
 *   2 validate  stream the object from Storage to disk, hashing as it goes; recognise the source by
 *               its header (the Ops app's SOURCES contracts); a sha256 already loaded is a duplicate
 *   3 transform stream the file into one canonical CSV (lake column names, text values):
 *               CSV/TSV through csv-parse, Salesforce's HTML-table ".xls" through a streaming row
 *               parser, XLSX through SheetJS (whole-file; Power BI should export CSV past ~200 MB);
 *               DuckDB then writes the Parquet copy to processed/ and counts the rows
 *   4 load      session tuning; COPY the canonical CSV into the source's UNLOGGED staging table;
 *               merge into the partitioned parent 50 000 rows at a time through the SQL merge
 *               functions (migration-028), advancing upload_files.checkpoint after every slice so
 *               an interrupted load resumes where it stopped; rejected rows go to failed/
 *   5 refresh   agent_day, pipeline_runs, kv:jobs-status; the queue message is deleted; a file that
 *               fails three times moves to ingest_dlq and is marked failed with its error
 * Memory stays flat for CSV, TSV and HTML whatever the size. Nothing here ever holds a whole 500 MB
 * text file in memory; only XLSX is whole-file, because the format is.
 */
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os'; import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises'; import { Readable, Transform } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url'; import { createRequire } from 'node:module';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NM = path.join(ROOT, 'nicks_code', 'diagnostics', 'node_modules');
const req = createRequire(path.join(NM, 'x.js'));
const pg = req('pg'); const { parse: csvParse } = req('csv-parse'); const { from: copyFrom } = req('pg-copy-streams');
const XLSX = createRequire(import.meta.url)(path.join(ROOT, 'site', 'xlsx.full.min.js'));
const { DuckDBInstance } = await import(pathToFileURL(path.join(NM, '@duckdb', 'node-api', 'lib', 'index.js')).href);
const { SOURCES, detect, snapshotFrom, pickIndexes, sniff, canonWriter, csvQuote, readDelimited, readHtmlTable, readXlsx } = await import(pathToFileURL(path.join(ROOT, 'tools', 'rake-lib.mjs')).href);

const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, 'supabase.env'), 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^"|"$/g, '')]));
const SB = env.SUPABASE_URL; const H = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY };
const args = process.argv.slice(2); const flag = (n) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : null; }; const DRY = args.includes('--dry');
const SLICE = 50000; const MAX_ATTEMPTS = 3; const QUEUE_VT = 900;
const log = (m) => console.log(new Date().toISOString().slice(11, 19) + ' ' + m);

/* ---- storage ---- */
const objUrl = (bucket, p) => `${SB}/storage/v1/object/${bucket}/${p.split('/').map(encodeURIComponent).join('/')}`;
async function downloadHashing(bucket, p, dest) {
  const r = await fetch(objUrl(bucket, p), { headers: H }); if (!r.ok) throw new Error('storage GET ' + r.status + ' for ' + bucket + '/' + p);
  const hash = crypto.createHash('sha256'); let bytes = 0;
  const tap = new Transform({ transform(chunk, enc, cb) { hash.update(chunk); bytes += chunk.length; cb(null, chunk); } });
  await pipeline(Readable.fromWeb(r.body), tap, fs.createWriteStream(dest));
  return { sha256: hash.digest('hex'), bytes };
}
async function uploadFile(bucket, p, localPath, contentType) {
  const r = await fetch(objUrl(bucket, p), { method: 'POST', headers: { ...H, 'Content-Type': contentType, 'x-upsert': 'true' }, body: fs.readFileSync(localPath) });
  if (!r.ok) throw new Error('storage POST ' + r.status + ' ' + (await r.text()).slice(0, 120));
}

/* ---- database ---- */
const db = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 0 });
await db.connect();
const sql = async (s, a) => (await db.query(s, a)).rows;
/* --dry never writes the record: a rehearsal must leave a loaded file loaded */
const setFile = (id, patch) => { if (DRY) return Promise.resolve(); const keys = Object.keys(patch); return sql(`update upload_files set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} where id = $1`, [id, ...keys.map((k) => patch[k])]); };

async function processFile(f, msg) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rake-')); const raw = path.join(tmp, 'raw.bin'); const canon = path.join(tmp, 'canon.csv'); const parquet = path.join(tmp, 'file.parquet');
  const t0 = Date.now(); let stage = 'validate';
  try {
    await setFile(f.id, { attempts: f.attempts + 1, error: null });
    /* 2 · validate */
    const { sha256, bytes } = await downloadHashing(f.storage_bucket, f.storage_path, raw);
    log(`  ${f.file_name}: ${(bytes / 1048576).toFixed(1)} MB, sha256 ${sha256.slice(0, 12)}…`);
    const dup = (await sql(`select id from upload_files where sha256 = $1 and id <> $2 and status = 'loaded' limit 1`, [sha256, f.id]))[0];
    if (dup) throw Object.assign(new Error('duplicate of ' + dup.id + ' (same bytes already loaded)'), { final: true });
    const head = Buffer.alloc(8192); const fd = fs.openSync(raw, 'r'); fs.readSync(fd, head, 0, 8192, 0); fs.closeSync(fd);
    const kind = sniff(head); let src = null, contract = null, idx = null, writer = null, lakeCols = null;
    const onHeader = async (headers) => { src = detect(headers); if (!src) return false; contract = SOURCES[src]; idx = pickIndexes(headers, contract); lakeCols = [...Object.keys(contract.cols), ...(contract.extra || [])];
      await setFile(f.id, { status: 'validated', source: src, sha256, bytes, validated_at: new Date().toISOString() }); writer = canonWriter(canon, lakeCols); return true; };
    const snapshot = snapshotFrom(f.file_name, f.received_at);
    const onRow = (rec) => { const vals = Object.keys(contract.cols).map((c) => (idx[c] >= 0 ? rec[idx[c]] : '')); for (const e of contract.extra || []) vals.push(e === 'snapshot_date' ? snapshot : ''); return writer.row(vals); };
    stage = 'transform';
    if (kind === 'xlsx') await readXlsx(XLSX, raw, onHeader, onRow); else if (kind === 'html') await readHtmlTable(raw, onHeader, onRow); else await readDelimited(csvParse, raw, kind === 'tsv' ? '\t' : ',', onHeader, onRow);
    if (!src) throw Object.assign(new Error('unrecognised header — not one of ' + Object.keys(SOURCES).join(', ')), { final: true });
    const rowsIn = await writer.end();
    await setFile(f.id, { status: 'transforming', rows_in: rowsIn });
    /* 3 · Parquet through DuckDB (columnar copy + an independent row count) */
    const inst = await DuckDBInstance.create(':memory:'); const dk = await inst.connect();
    const dq = (p) => p.replace(/\\/g, '/').replace(/'/g, "''");
    await dk.run(`create table t as select * from read_csv('${dq(canon)}', header = true, all_varchar = true, sample_size = -1)`);
    const dkRows = Number((await dk.runAndReadAll('select count(*) n from t')).getRowObjects()[0].n);
    await dk.run(`copy t to '${dq(parquet)}' (format parquet, compression zstd)`);
    dk.closeSync(); inst.closeSync();
    if (dkRows !== rowsIn) throw new Error(`row count disagreement: canonical CSV ${rowsIn}, DuckDB read ${dkRows}`);
    const ym = new Date(f.received_at).toISOString().slice(0, 7).split('-'); const pqPath = `${src}/${ym[0]}/${ym[1]}/${f.id}.parquet`;
    await uploadFile('processed', pqPath, parquet, 'application/vnd.apache.parquet');
    await setFile(f.id, { parquet_path: pqPath });
    log(`  ${src}: ${rowsIn} rows → processed/${pqPath} (${(fs.statSync(parquet).size / 1048576).toFixed(1)} MB)`);
    if (DRY) { log('  --dry: not loading'); return { ok: true, rows: 0, dry: true }; }
    /* 4 · load — the importer's pattern: session tuning, COPY into unlogged staging, merge in slices with a checkpoint */
    stage = 'load';
    await setFile(f.id, { status: 'loading' });
    await db.query(`set statement_timeout to '30min'`);   /* the importer's pattern: the pooler's default timeout is for dashboards, not loads */
    await db.query(`set synchronous_commit to off`); await db.query(`set work_mem to '256MB'`); await db.query(`set maintenance_work_mem to '512MB'`);
    await db.query(`truncate ${contract.stage}`);
    const copyStream = db.query(copyFrom(`copy ${contract.stage} (_seq, ${lakeCols.join(', ')}) from stdin with (format csv, header true)`));
    await pipeline(fs.createReadStream(canon), copyStream);
    const batch = 'rake:' + f.id;
    await sql(`insert into batches (batch_id, source_type, source_system, uploaded_by, uploaded_at, file_name, file_hash, raw_rows, status, storage_path) values ($1, $2, 'rake', $3, now(), $4, $5, $6, 'loading', $7) on conflict (batch_id) do update set raw_rows = excluded.raw_rows, status = 'loading'`,
      [batch, src, f.uploaded_by || 'rake', f.file_name, sha256, rowsIn, f.storage_bucket + '/' + f.storage_path]);
    let from = Number((f.checkpoint && f.checkpoint.seq) || 0); if (from > rowsIn) from = 0;
    let merged = 0, rejected = 0;
    while (from < rowsIn) {
      const to = Math.min(from + SLICE, rowsIn);
      const r = (await sql(`select * from ${contract.merge}($1, $2, $3)`, [batch, from, to]))[0];
      merged += Number(r.merged); rejected += Number(r.rejected); from = to;
      await setFile(f.id, { rows_loaded: merged, rows_rejected: rejected, checkpoint: { seq: to } });
    }
    if (rejected > 0) {
      const rej = path.join(tmp, 'rejects.csv'); const rows = await sql(`select * from ${contract.rejects} order by _seq`);
      fs.writeFileSync(rej, [Object.keys(rows[0]).join(','), ...rows.map((r) => Object.values(r).map(csvQuote).join(','))].join('\n'));
      const rejPath = `${src}/${ym[0]}/${ym[1]}/${f.id}/rejects.csv`; await uploadFile('failed', rejPath, rej, 'text/csv');
      log(`  ${rejected} row(s) rejected → failed/${rejPath}`);
    }
    await sql(`update batches set loaded_rows = $2, rejected_rows = $3, status = 'loaded' where batch_id = $1`, [batch, merged, rejected]);
    await db.query(`truncate ${contract.stage}`);
    await setFile(f.id, { status: 'loaded', loaded_at: new Date().toISOString(), rows_loaded: merged, rows_rejected: rejected, checkpoint: null });
    log(`  loaded ${merged} rows into ${contract.stage.replace('rake_stage_', '')} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    return { ok: true, rows: merged };
  } catch (e) {
    const finalFail = e.final || f.attempts + 1 >= MAX_ATTEMPTS;
    log(`  FAILED at ${stage}: ${e.message}${finalFail ? ' — giving up' : ' — will retry'}`);
    await setFile(f.id, { error: (stage + ': ' + e.message).slice(0, 900), status: finalFail ? 'failed' : 'received', loaded_at: finalFail ? new Date().toISOString() : null }).catch(() => {});
    if (finalFail && msg) await sql(`select pgmq.send('ingest_dlq', $1::jsonb)`, [JSON.stringify({ file_id: f.id, error: e.message.slice(0, 300), at: new Date().toISOString() })]).catch(() => {});
    return { ok: false, final: finalFail, error: e.message };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

/* ---- the run ---- */
const run = (await sql(`insert into pipeline_runs default values returning run_id`))[0].run_id;
let seen = 0, loaded = 0, failed = 0, dupes = 0, rows = 0; const notes = [];
try {
  const reg = flag('register');
  if (reg) {   // record an object already in storage (manual or test) and queue it
    const [bucket, ...rest] = reg.split('/'); const p = rest.join('/');
    const row = (await sql(`insert into upload_files (file_name, storage_bucket, storage_path, uploaded_by) values ($1, $2, $3, $4) returning id`, [flag('name') || path.basename(p), bucket, p, flag('by') || 'rake --register']))[0];
    await sql(`select pgmq.send('ingest', $1::jsonb)`, [JSON.stringify({ file_id: row.id })]);
    log('registered ' + row.id + ' for ' + reg);
  }
  const only = flag('file');
  const work = [];
  if (only) { const f = (await sql(`select * from upload_files where id = $1`, [only]))[0]; if (!f) throw new Error('no upload_files row ' + only); work.push({ f, msg: null }); }
  else {
    const msgs = await sql(`select msg_id, read_ct, message from pgmq.read('ingest', $1, 20)`, [QUEUE_VT]);
    for (const m of msgs) {
      const f = (await sql(`select * from upload_files where id = $1`, [m.message.file_id]))[0];
      if (!f || f.status === 'loaded' || f.status === 'failed') { await sql(`select pgmq.delete('ingest', $1::bigint)`, [m.msg_id]); continue; }
      work.push({ f, msg: m });
    }
  }
  log(`run ${run}: ${work.length} file(s) to process`);
  for (const { f, msg } of work) {
    seen++; await setFile(f.id, { run_id: run }); log(`${f.file_name} (${String(f.id).slice(0, 8)}) attempt ${f.attempts + 1}`);
    const r = await processFile(f, msg);
    if (r.ok) { loaded++; rows += r.rows; if (msg) await sql(`select pgmq.delete('ingest', $1::bigint)`, [msg.msg_id]); }
    else if (r.final && /^duplicate of /.test(r.error || '')) { dupes++; notes.push(f.file_name + ': ' + r.error.slice(0, 120)); if (msg) await sql(`select pgmq.delete('ingest', $1::bigint)`, [msg.msg_id]); }   // refused, recorded on the file — but not a failed RUN (2026-09-10: it silenced the digests)
    else if (r.final) { failed++; notes.push(f.file_name + ': ' + r.error.slice(0, 120)); if (msg) await sql(`select pgmq.delete('ingest', $1::bigint)`, [msg.msg_id]); }
  }
  if (loaded && !DRY) { log('refreshing agent_day…'); await db.query('refresh materialized view concurrently agent_day'); }
  if (loaded && !DRY) { const dd = (await db.query(`select dedupe_lake(true, 'rake') r`)).rows[0].r; log('dedupe_lake: ' + dd.removed_total + ' duplicate row(s) removed'); }   // migration-032: the database removes twins, every run logged
  /* THE LEAD MANAGEMENT BOOK FOLLOWS THE LAKE (migration-035): rebuild the cached book after a load so PULSE adopts the
     newest open-cases snapshot within its next poll. A no-op (unchanged:true) when no SF_OPEN_CASES snapshot moved. */
  if (loaded && !DRY) { const lb = (await db.query(`select lm_open_book_refresh() r`)).rows[0].r; log(`lead book: ${lb.unchanged ? 'unchanged' : 'rebuilt'} — snapshot ${lb.snapshot_date || 'none'}, ${lb.agent_rows ?? 0} agent-held case(s)${lb.file ? ' from ' + lb.file : ''}`); }
  await sql(`update pipeline_runs set finished_at = now(), ok = $2, files_seen = $3, files_loaded = $4, files_failed = $5, rows_loaded = $6, seconds = extract(epoch from now() - started_at), note = $7 where run_id = $1`,
    [run, failed === 0, seen, loaded, failed, rows, notes.join(' | ').slice(0, 900) || null]);
  log(`done: ${loaded} loaded, ${failed} failed, ${dupes} duplicate(s) refused, ${rows} rows`);
  process.exitCode = failed ? 1 : 0;
} catch (e) {
  await sql(`update pipeline_runs set finished_at = now(), ok = false, note = $2 where run_id = $1`, [run, ('run: ' + e.message).slice(0, 900)]).catch(() => {});
  console.error('rake failed: ' + e.message); process.exitCode = 2;
} finally { await db.end(); }
