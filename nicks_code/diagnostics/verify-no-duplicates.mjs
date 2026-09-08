#!/usr/bin/env node
/**
 * verify-no-duplicates.mjs — nothing is counted twice, in any store, today.
 *
 *   node nicks_code/diagnostics/verify-no-duplicates.mjs
 *
 * Every upload path already refuses duplicates in its own way (specs/duplicates-policy.md): PULSE by
 * file hash and per-key supersede, Ops by file hash → update-in-place and record-key supersede, the
 * Rake by sha256 and keyed merges, the lake by primary keys. This suite is the PROOF, over the LIVE
 * data, that those rules held — a nightly answer to "if I upload files, are there duplicates?".
 *
 *   A · THE LAKE (Postgres, read-only): natural-key twins in every partitioned table, one agent twice
 *       on one list, the same bytes loaded twice (batches, upload_files), two active logins on one CB.
 *       Closed cases on two closure days are REPORTED (a re-closed case is real) and fail only past 1%.
 *   B · PULSE (kv:vas-state): the same file hash registered twice; then the deployed build is driven
 *       headlessly over the blob and V01 is applied to the model — one row per agent per day
 *       (rangeAgg rows exempt, as in the app).
 *   C · OPS (kv:cb-audit): the legacy in-browser registry, reported only — Ops rows live in the lake.
 *   The database removes twins itself (dedupe_lake, migration-032); A also proves it ran.
 * Nothing here writes anywhere.
 */
import fs from 'node:fs'; import path from 'node:path'; import http from 'node:http';
import { fileURLToPath } from 'node:url'; import { createRequire } from 'node:module';
const HERE = path.dirname(fileURLToPath(import.meta.url)); const ROOT = process.env.AGENTOS || path.resolve(HERE, '..', '..');
const req = createRequire(path.join(HERE, 'node_modules', 'x.js')); const pg = req('pg'); const { chromium } = req('playwright');
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, 'supabase.env'), 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^"|"$/g, '')]));
const H = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY };
let pass = 0, fail = 0; const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ' + n + (d ? '  (' + d + ')' : '')); } else { fail++; console.log('  FAIL ' + n + (d ? ' — ' + d : '')); } };
const kv = async (k) => { const r = await fetch(env.SUPABASE_URL + '/storage/v1/object/raw/kv/' + k, { headers: H, signal: AbortSignal.timeout(90000) }); return r.ok ? r.text() : null; };

console.log('\nA · THE LAKE');
const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 110000 }); await c.connect();
const n = async (s) => +(await c.query(s)).rows[0].n;
try {
  ok('sf_closed_cases: one row per case per closure day', (await n(`select count(*) n from (select case_number, closed_at from sf_closed_cases group by 1,2 having count(*) > 1) x`)) === 0);
  const twoDays = await n(`select count(*) n from (select case_number from sf_closed_cases group by 1 having count(distinct closed_at) > 1) x`);
  const cases = await n(`select count(distinct case_number) n from sf_closed_cases`);
  ok('sf_closed_cases: cases closed on two days stay under 1% (a re-closed case is real; a flood is a keying bug)', twoDays <= Math.max(1, cases * 0.01), twoDays + ' of ' + cases);
  ok('sf_open_cases: one row per case per snapshot', (await n(`select count(*) n from (select snapshot_date, case_number from sf_open_cases group by 1,2 having count(*) > 1) x`)) === 0);
  ok('bi_active_cases: no natural-key twins (case, account, contract, charge code, amount, date)', (await n(`select count(*) n from (select case_number, account_no, coalesce(contract_number,''), coalesce(charge_code,''), charge_amount, contract_create_date from bi_active_cases group by 1,2,3,4,5,6 having count(*) > 1) x`)) === 0);
  ok('vici_calls: one row per call (date, login, lead, status)', (await n(`select count(*) n from (select call_date, agent_login, lead_id, status from vici_calls group by 1,2,3,4 having count(*) > 1) x`)) === 0);
  ok('agent_list: an agent appears once per dated list', (await n(`select count(*) n from (select as_of, norm_cb(employee_code) from agent_list group by 1,2 having count(*) > 1) x`)) === 0);
  ok('batches: the same bytes are never loaded twice', (await n(`select count(*) n from (select file_hash from batches where status = 'loaded' and file_hash is not null group by 1 having count(*) > 1) x`)) === 0);
  ok('upload_files: the same bytes are never loaded twice by the Rake', (await n(`select count(*) n from (select sha256 from upload_files where status = 'loaded' group by 1 having count(*) > 1) x`)) === 0);
  ok('app_users: one active login per CB number', (await n(`select count(*) n from (select norm_cb(cb) from app_users where active and cb is not null group by 1 having count(*) > 1) x`)) === 0);
  const last = (await c.query(`select ran_at, applied, removed from dedupe_log where applied order by ran_at desc limit 1`)).rows[0];
  ok('dedupe_lake() has run and applied within the last 26 hours (rake + nightly pg_cron)', !!last && Date.now() - new Date(last.ran_at).getTime() < 26 * 3600e3, last ? 'last ' + last.ran_at.toISOString() + ', removed ' + last.removed : 'never ran');
  ok('app_users: one active login per username', (await n(`select count(*) n from (select lower(username) from app_users where active group by 1 having count(*) > 1) x`)) === 0);
} catch (e) { ok('lake queries ran', false, e.message); } finally { await c.end(); }

console.log('\nB · PULSE');
const blob = await kv('vas-state');
if (!blob) console.log('  (skipping — cannot read kv:vas-state)');
else {
  const S = JSON.parse(blob); const files = Array.isArray(S.files) ? S.files : [];
  const byHash = new Map(); for (const f of files) if (f.hash) byHash.set(f.hash, (byHash.get(f.hash) || 0) + 1);
  const twice = [...byHash.entries()].filter(([, k]) => k > 1);
  ok('file registry: no file hash registered twice (' + files.length + ' files)', twice.length === 0, twice.map(([h]) => h.slice(0, 10)).join(','));
  const HTML = path.join(ROOT, 'site', 'pulse', 'index.html');
  const SERVE = { '/': HTML, '/index.html': HTML, '/xlsx.full.min.js': path.join(ROOT, 'site', 'xlsx.full.min.js') };
  const server = http.createServer((q, s) => { const p = SERVE[q.url.split('?')[0]]; if (!p || !fs.existsSync(p)) { s.writeHead(404); s.end('nf'); return; } s.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' }); fs.createReadStream(p).pipe(s); });
  await new Promise((r) => server.listen(8179, '127.0.0.1', r));
  const browser = await chromium.launch({ args: ['--js-flags=--max-old-space-size=8192'] });
  try {
    const page = await browser.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.message.slice(0, 120)));
    await page.goto('http://127.0.0.1:8179/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__mtd && window.__mtd.state(), null, { timeout: 30000 });
    const r = await page.evaluate((b) => { const S = window.__mtd.state(); const blob = JSON.parse(b); for (const k of Object.keys(blob)) S[k] = blob[k]; window.__mtd.rebuild();
      const F = window.__mtd.model().facts || []; const seen = new Set(), dup = []; for (const f of F) { if (f.rangeAgg) continue; const k = f.date + '|' + f.code; if (seen.has(k)) dup.push(k); seen.add(k); }
      return { rows: F.length, dup: dup.slice(0, 5), ndup: dup.length }; }, blob);
    ok('V01 on the live model: one row per agent per day (' + r.rows + ' rows)', r.ndup === 0, r.ndup + ' duplicate(s) e.g. ' + r.dup.join(', '));
    ok('the build rendered the live state without a page error', errs.length === 0, errs.join(' ; '));
  } catch (e) { ok('headless PULSE ran', false, e.message.slice(0, 200)); } finally { await browser.close(); server.close(); }
}

console.log('\nC · OPS');
const audit = await kv('cb-audit');
if (!audit) console.log('  (skipping — cannot read kv:cb-audit)');
else {
  const B = (JSON.parse(audit).batches || []).filter((b) => b.file_hash && b.validation_status !== 'failed');
  const key = new Map(); for (const b of B) { const k = b.source_type + '|' + b.file_hash; key.set(k, (key.get(k) || 0) + 1); }
  const twice = [...key.entries()].filter(([, k]) => k > 1);
  /* the cb-audit blob is Ops' legacy in-browser registry (July 2026 ghosts predate the Worker path); the rows themselves live in the lake, checked in A — so this is a report, not a verdict */
  console.log('  info ' + twice.length + ' legacy registry twin(s) in kv:cb-audit (' + B.length + ' batches)' + (twice.length ? ': ' + twice.map(([k]) => k.split('|')[0]).join(',') : ''));
}

console.log('\n==== ' + pass + ' passed, ' + fail + ' failed  (read-only — nothing was written) ====');
process.exit(fail ? 1 : 0);
