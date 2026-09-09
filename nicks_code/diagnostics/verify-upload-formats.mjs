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
} catch (e) { ok('the suite ran', false, String((e && e.message) || e).slice(0, 200)); }
finally { await browser.close(); server.close(); }

console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
process.exit(fail ? 1 : 0);
