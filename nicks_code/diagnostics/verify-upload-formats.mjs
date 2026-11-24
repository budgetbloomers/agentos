#!/usr/bin/env node
/**
 * verify-upload-formats.mjs — the slot label names every format the parser really accepts.
 *
 *   node nicks_code/diagnostics/verify-upload-formats.mjs
 *
 * Nick, 2026-09-09: "in the upload station, files must be allowed for csv as well". CSV always WAS
 * accepted — `readUpload` decides by the file's bytes, not its name, and a CSV of every source parses
 * and is recognised. What refused it was the writing on the card: the two Salesforce case slots
 * advertised "HTML .xls" and three more said ".xlsx", so a person holding a CSV export believed the
 * station would not take it. A label that under-promises costs a day exactly like a bug does.
 *
 * This suite drives the DEPLOYED Ops build and, for every upload source, builds a real CSV File from
 * that source's own header contract, reads it through the app's own `readUpload`, and asserts:
 *   1. the CSV is read — headers and a row come back
 *   2. `detectSource` recognises it (the Power BI pair is header-identical by design, so either of the
 *      two counts; REFERRALS is pulled by fetch-referrals.mjs and has no upload contract)
 *   3. the slot's `fmt` label names .csv
 * and, in PULSE, that neither file picker hides a format the app can read.
 */
import fs from 'node:fs'; import path from 'node:path'; import http from 'node:http';
import { fileURLToPath } from 'node:url'; import { createRequire } from 'node:module';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.AGENTOS || path.resolve(HERE, '..', '..');
const req = createRequire(path.join(HERE, 'node_modules', 'x.js')); const { chromium } = req('playwright');
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (d ? ' — ' + d : '')); } };

/* the Power BI exports share one header set on purpose; the tie-break is content, not columns */
const TWINS = new Set(['BI_ACTIVE_CASES', 'SF_INACTIVE']);
/* pulled from HighLevel by tools/fetch-referrals.mjs — never uploaded, so it has no upload contract */
const NOT_UPLOADED = new Set(['REFERRALS']);
/* retired 2026-09-01; its slot only loads pre-cutover history, so its label stays as it was */
const RETIRED = new Set(['CALLX_CALL_RECORDS']);

const OPS = path.join(ROOT, 'site', 'index.html');
if (!fs.existsSync(OPS)) { console.log('(skipping — site/index.html is not built; run node tools/prepare-site.js)'); process.exit(1); }
const SERVE = { '/': OPS, '/index.html': OPS, '/xlsx.full.min.js': path.join(ROOT, 'site', 'xlsx.full.min.js') };
const server = http.createServer((q, s) => { const p = SERVE[q.url.split('?')[0]];
  if (!p || !fs.existsSync(p)) { s.writeHead(404); s.end('nf'); return; }
  s.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' }); fs.createReadStream(p).pipe(s); });
await new Promise((r) => server.listen(8183, '127.0.0.1', r));
const browser = await chromium.launch();
try {
  console.log('\nA · OPS — a CSV of every source is read, recognised, and advertised');
  const page = await browser.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message.slice(0, 120)));
  await page.goto('http://127.0.0.1:8183/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof SOURCES !== 'undefined' && typeof readUpload === 'function' && typeof detectSource === 'function', null, { timeout: 60000 });
  const out = await page.evaluate(async () => {
    const keys = (typeof SRC_KEYS !== 'undefined' ? SRC_KEYS : Object.keys(SOURCES)).filter((k) => !/^SES_/.test(k));
    const res = [];
    for (const k of keys) {
      const s = SOURCES[k]; if (!s) continue;
      const cols = Array.from(new Set([...(s.required || []), ...(s.headers || [])]));
      if (!cols.length) continue;
      const q = (v) => (/[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v);
      const csv = cols.map(q).join(',') + '\n' + cols.map((_, i) => 'v' + i).join(',') + '\n';
      const file = new File([csv], 'probe ' + k + '.csv', { type: 'text/csv' });
      try {
        const parsed = await readUpload(file);
        res.push({ k, fmt: s.fmt || '', headers: (parsed.headers || []).length, rows: (parsed.data || parsed.rows || []).length, got: detectSource(parsed) });
      } catch (e) { res.push({ k, fmt: s.fmt || '', err: String((e && e.message) || e).slice(0, 90) }); }
    }
    return res; });
  ok('the deployed Ops build loaded without a page error', errs.length === 0, errs.join(' ; '));
  for (const r of out) {
    ok(r.k + ': a CSV file is read (headers and a row come back)', !r.err && r.headers > 0 && r.rows > 0, r.err || ('headers=' + r.headers + ' rows=' + r.rows));
    if (NOT_UPLOADED.has(r.k)) continue;
    const good = TWINS.has(r.k) ? TWINS.has(r.got) : r.got === r.k;
    ok(r.k + ': the CSV is recognised as its own source', good, 'detected ' + r.got);
  }
  console.log('\nB · THE LABEL MATCHES THE PARSER');
  for (const r of out) {
    if (NOT_UPLOADED.has(r.k) || RETIRED.has(r.k)) continue;
    const reads = !r.err && r.headers > 0;
    ok(r.k + ': the slot label names .csv, because a CSV parses', !reads || /\.csv/i.test(r.fmt), 'label says "' + r.fmt + '"');
  }
  console.log('\nC · PULSE — no picker hides a format the app can read');
  const pulse = fs.readFileSync(path.join(ROOT, 'nicks_code', 'index.html'), 'utf8');
  for (const id of ['fileInput', 'largeInput']) {
    const m = new RegExp('id="' + id + '"[^>]*').exec(pulse);
    const tag = m ? m[0] : '';
    const acc = /accept="([^"]*)"/.exec(tag);
    ok('#' + id + ' accepts .csv', !acc || /\.csv/i.test(acc[1]), acc ? acc[1] : '(no accept attribute)');
    if (acc) ok('#' + id + ' also accepts the spreadsheet formats', /\.xlsx/i.test(acc[1]) && /\.txt/i.test(acc[1]), acc[1]);
  }
  /* D · VEHICLE TRACKING (spec 071, C5): BI Active Fitted carries every column the money source keys on, so it must be
     recognised as VT FIRST and never as VAS BI — in PULSE (the VT rule runs before 'bi') and in Ops (refused). A VAS
     Power BI export is still VAS BI in both. verify-vt-isolation.mjs proves the full drop in a real station.
     THE BI HEADER IS SHARED (incident 2026-11-24, rule book vt-1.3): the VAS "BI Active" export has the same columns as
     "BI Active Fitted", so Ops decides by the NAME — "Fitted" is VT (refused), anything else is BI_ACTIVE_CASES. */
  console.log('\nD · VEHICLE TRACKING IS NEVER VAS BI, VAS BI IS STILL VAS BI');
  {
    const { BI_HDR, SM_HDR, VAS_BI_HDR } = await import('./vt-fixtures.mjs');
    const E = req(path.join(ROOT, 'nicks_code', 'vt-engine.js'));
    ok('VTEngine.detect: BI Active Fitted → vtBiFitted, Scheduled & Missed → vtSchedMissed', E.detect(BI_HDR, 'Export') === 'vtBiFitted' && E.detect(SM_HDR, 'Export') === 'vtSchedMissed');
    ok('VTEngine.detect: a VAS Power BI header is not VT', E.detect(VAS_BI_HDR, 'Export') === null);
    ok('PULSE detectType asks VTEngine.detect FIRST, before the bi rule', (() => { const i = pulse.indexOf('function detectType('); const b = pulse.slice(i, i + 2000);
      return i > 0 && b.indexOf('VTEngine.detect(') > 0 && b.indexOf('VTEngine.detect(') < b.indexOf("has('charge amount','contract create date')"); })());
    const q = (v) => (/[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v);
    const d = await page.evaluate(async ([vt, sm, vas]) => {
      const rd = async (cols, n) => detectSource(await readUpload(new File([cols + '\n' + cols.split(',').map((_, i) => 'v' + i).join(',') + '\n'], n, { type: 'text/csv' })));
      return { vt: await rd(vt, 'BI Active Fitted 101126.csv'), vasNamed: await rd(vt, 'BI Active 101126.csv'), sm: await rd(sm, 'Scheduled & Missed 101126.csv'), vas: await rd(vas, 'Power BI 101126.csv') }; },
      [BI_HDR.map(q).join(','), SM_HDR.map(q).join(','), VAS_BI_HDR.map(q).join(',')]);
    ok('Ops: a BI-columned CSV named "BI Active Fitted …" is NOT read as BI_ACTIVE_CASES (refused as VT, by its name)', d.vt === null, 'detected ' + d.vt);
    ok('Ops: the SAME columns named "BI Active 101126.csv" (the VAS export) ARE BI_ACTIVE_CASES (or its header twin)', TWINS.has(d.vasNamed), 'detected ' + d.vasNamed);
    ok('Ops: a Scheduled & Missed CSV names no source', d.sm === null, 'detected ' + d.sm);
    ok('Ops: a VAS Power BI CSV is still BI_ACTIVE_CASES (or its header twin)', TWINS.has(d.vas), 'detected ' + d.vas);
  }
} catch (e) { ok('the suite ran', false, String((e && e.message) || e).slice(0, 200)); }
finally { await browser.close(); server.close(); }

console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
process.exit(fail ? 1 : 0);
