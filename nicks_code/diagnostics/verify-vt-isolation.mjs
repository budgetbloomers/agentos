#!/usr/bin/env node
/* verify-vt-isolation.mjs — A VEHICLE TRACKING FILE NEVER TOUCHES VAS (Spec Kit 071, Phase C task C8, FR-004, plan
 * "How VAS isolation is guaranteed"). BI Active Fitted carries every column the VAS money rule keys on — loaded as VAS
 * BI it would supersede a month of VAS sales. Real Chromium, fictional files, a stubbed Worker; the real sample files are
 * read at run time only for detection and skipped when absent.
 *   I1  PULSE: the three VT files dropped on a station holding a VAS state → the state is BYTE-IDENTICAL, S.files holds no
 *       VT entry, and save / regFile / archiveUpload / rebuild / largeUpload were never called; no POST to /api/kv, the
 *       relay (/api/upload-archive) or the Rake (/api/upload/large/*, /api/rake/page)
 *   I2  a real-shaped VAS Power BI file still lands as VAS BI (S.files type bi), and never reaches the VT intake
 *   I3  detectType: VT signatures win BEFORE the bi rule; a VAS BI header is still 'bi'; the real samples (when present)
 *       are vtBiFitted / vtSchedMissed, never bi / inactive
 *   I4  PULSE rakeDetect refuses a VT header in words; a VAS BI header is still BI_ACTIVE_CASES
 *   I5  Ops: detectSource never names a source for a VT file; the slot upload and the bulk upload both refuse it with
 *       "This is a Vehicle Tracking file. Load it in the VAS Upload Station" and store nothing; a VAS BI CSV is still
 *       BI_ACTIVE_CASES; Ops' signatures are exactly the VT rule book's
 *
 *   node nicks_code/diagnostics/verify-vt-isolation.mjs        (builds site/ first unless --no-build)
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { biFile, smFile, openFile, xlsxBytes, BI_HDR, SM_HDR, VAS_BI_HDR, vasBiFile } from './vt-fixtures.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const require = createRequire(import.meta.url);
const req = createRequire(path.join(HERE, 'node_modules', 'x.js'));
const { chromium } = await import(pathToFileURL(path.join(HERE, 'node_modules', 'playwright', 'index.mjs')).href);
const E = require(path.join(ROOT, 'nicks_code', 'vt-engine.js'));
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m + (d !== undefined ? ' — ' + String(d).slice(0, 300) : '')); } };
const head = (t) => console.log('\n' + t);
const API = 'https://chatterbox-agentos-api.chatterbox-agentos.workers.dev';
const REFUSAL = 'This is a Vehicle Tracking file. Load it in the VAS Upload Station';
if (!process.argv.includes('--no-build')) spawnSync(process.execPath, [path.join(ROOT, 'tools', 'prepare-site.js')], { cwd: ROOT, encoding: 'utf8' });

const SERVE = { '/pulse.html': 'nicks_code/index.html', '/vt-engine.js': 'nicks_code/vt-engine.js', '/vt-pages.js': 'nicks_code/vt-pages.js', '/vt-publish.js': 'nicks_code/vt-publish.js', '/vt-app.js': 'nicks_code/vt-app.js', '/xlsx.full.min.js': 'site/xlsx.full.min.js', '/ops.html': 'site/index.html' };
const server = http.createServer((q, s) => { const rel = SERVE[q.url.split('?')[0]]; const p = rel && path.join(ROOT, rel);
  if (!p || !fs.existsSync(p)) { s.writeHead(404); s.end(); return; }
  s.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' }); fs.createReadStream(p).pipe(s); });
await new Promise((r) => server.listen(8272, '127.0.0.1', r));
const browser = await chromium.launch();
const net = [];
/* a minimal VT Worker: an empty book that accepts the upload — enough for the intake to run to its commit */
let rev = 0, opened = null;
async function stub(route) {
  const r = route.request(), u = new URL(r.url()); net.push(r.method() + ' ' + u.pathname);
  const J = (b, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });
  const body = (() => { try { return JSON.parse(r.postData() || '{}'); } catch (e) { return {}; } })();
  if (u.pathname === '/api/vt/uploads') return J({ uploads: [] });
  if (u.pathname === '/api/vt/roster') return J({ as_of: null, rows: [] });
  if (u.pathname === '/api/vt/book') return J({ rev, openedOn: opened, cases: [], events: [] });
  if (u.pathname === '/api/vt/upload/begin') return J({ id: rev + 1 });
  if (u.pathname === '/api/vt/upload/stage') return J({ staged: 1 });
  if (u.pathname === '/api/vt/upload/commit') { rev++; opened = opened || '2026-11-09'; return J({ rev }); }
  return J({}, 404);
}
const b64 = (b) => Buffer.from(b).toString('base64');
const BI = xlsxBytes(biFile([{ cn: 90000001 }, { cn: 90000002 }])), SM = xlsxBytes(smFile([{ cn: 90000003 }]));
const OB = xlsxBytes({ 'Agent List': [['Team Leader', 'Agent Name', 'Sales Force'], ['Leader One', 'Alpha Test', 'Alpha Test']], 'Schedulers Data': openFile([{ cn: 90000001 }]) });

try {
  /* ================= PULSE ================= */
  const page = await browser.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
  await page.route(API + '/**', stub);
  await page.goto('http://127.0.0.1:8272/pulse.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__mtd && window.__mtd.state() && window.VTStation && window.XLSX, null, { timeout: 60000 });
  /* a fixed VAS state on the station */
  await page.evaluate(() => { const S = window.__mtd.state();
    S.roster = [{ code: 'CB9150', name: 'Vas Person', sf: 'Vas Person', tl: 'Leader One', campaign: 'Courtesy', tenure: 'Exp', callx: '', target: 3, start: '2026-01-01' }];
    S.sales = { '2026-11-03': { CB9150: { n: 2, gwp: 198, x: 172.17 } } };
    S.files = [{ name: 'Power BI fixture.xlsx', type: 'bi', dates: ['2026-11-03'], rows: 2, hash: 'f'.repeat(64), at: '2026-11-03T08:00:00Z' }];
    window.__mtd.rebuild();
    window.__spy = {}; for (const fn of ['save', 'regFile', 'archiveUpload', 'rebuild', 'largeUpload', 'rakeInPage', 'kickAgentDigest']) {
      if (typeof window[fn] !== 'function') continue; const f0 = window[fn]; window.__spy[fn] = 0;
      window[fn] = function () { window.__spy[fn]++; return f0.apply(this, arguments); }; }
    const vi = window.VTStation.ingest; window.__vtCalls = 0; window.VTStation.ingest = function () { window.__vtCalls++; return vi.apply(this, arguments); }; });
  const snap = () => page.evaluate(() => JSON.stringify(window.__mtd.state()));
  const before = await snap(), filesBefore = await page.evaluate(() => JSON.stringify(window.__mtd.state().files));
  const drop = (name, bytes, slot) => page.evaluate(async ([n, b, s]) => { const bin = atob(b), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    await window.handleFiles([new File([u], n)], s || null); }, [name, b64(bytes), slot]);

  head('I1 · three VT files, VAS state byte-identical');
  net.length = 0;
  await drop('BI Active Fitted 091126.xlsx', BI); await drop('Scheduled & Missed 091126.xlsx', SM, 'vtSchedMissed'); await drop('November 2026 - VT Report.xlsx', OB, 'vtOpeningBook');
  await drop('BI Active Fitted 101126.xlsx', xlsxBytes(biFile([{ cn: 90000001 }, { cn: 90000002 }, { cn: 90000004 }])), 'bi');   // on the VAS BI slot, too
  const after = await snap(), filesAfter = await page.evaluate(() => JSON.stringify(window.__mtd.state().files));
  const spy = await page.evaluate(() => ({ spy: window.__spy, vt: window.__vtCalls }));
  ok(spy.vt === 4, 'all four drops went to the VT intake', spy.vt);
  ok(before === after, 'the whole VAS state (vas-state) is byte-identical (' + before.length + ' chars)');
  ok(filesBefore === filesAfter && !/vt|Fitted|Scheduled/i.test(filesAfter.replace('Power BI fixture', '')), 'S.files holds no VT entry');
  ok(Object.values(spy.spy).every((n) => n === 0), 'save / regFile / archiveUpload / rebuild / largeUpload / rakeInPage / kickAgentDigest never ran', JSON.stringify(spy.spy));
  const bad = net.filter((x) => /^POST \/api\/kv|\/api\/upload-archive|\/api\/upload\/large|\/api\/rake\/page|\/api\/upload-file/.test(x));
  ok(bad.length === 0, 'no POST to /api/kv, the relay (/api/upload-archive) or the Rake', bad.join(', '));
  ok(net.filter((x) => x === 'POST /api/vt/upload/commit').length === 4, 'the four files were committed to the VT store instead', net.filter((x) => /commit/.test(x)).length);

  head('I2 · a real-shaped VAS Power BI file still lands as VAS BI');
  await page.evaluate(() => { window.__vtCalls = 0; for (const k in window.__spy) window.__spy[k] = 0; });
  const csv = vasBiFile(3).map((r) => r.map((v) => (/[",]/.test(String(v)) ? '"' + v + '"' : v)).join(',')).join('\n');
  await drop('Power BI - Active Cases 041126.csv', Buffer.from(csv));
  const vas = await page.evaluate(() => ({ files: window.__mtd.state().files.map((f) => f.type + '|' + f.name), vt: window.__vtCalls, spy: window.__spy }));
  ok(vas.files.some((f) => /^bi\|Power BI - Active Cases 041126\.csv$/.test(f)), 'the VAS BI file is registered as bi', vas.files.join(', '));
  ok(vas.vt === 0 && vas.spy.save > 0, 'it never reached the VT intake, and VAS saved as it always does', JSON.stringify(vas));

  head('I3 · detection order');
  const det = await page.evaluate(([bi, sm, vb]) => ({ vt: window.detectType(bi, 'Export', []), sm: window.detectType(sm, 'Export', []), vas: window.detectType(vb, 'Export', [{ 'Contract Deactivate Date': '' }]) }), [BI_HDR, SM_HDR, VAS_BI_HDR]);
  ok(det.vt === 'vtBiFitted' && det.sm === 'vtSchedMissed' && det.vas === 'bi', 'detectType: VT first, VAS BI still bi', JSON.stringify(det));
  const XLSX = req('xlsx');
  for (const [f, want] of [['BI Active Fitted 101126.xlsx', 'vtBiFitted'], ['Scheduled & Missed 101126.xlsx', 'vtSchedMissed']]) {
    const p = path.join(ROOT, '..', 'reference', 'zips', 'vt', f);
    if (!fs.existsSync(p)) { console.log('  (skip) ' + f + ' is not in ../reference/zips/vt/'); continue; }
    const wb = XLSX.read(fs.readFileSync(p), { sheetRows: 2 }); const h = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 })[0];
    const got = await page.evaluate(([hh, sn]) => window.detectType(hh, sn, []), [h.map(String), wb.SheetNames[0]]);
    ok(got === want, 'the real ' + f + ' header → ' + want + ' (never bi / inactive)', got);
  }

  head('I4 · the Rake refuses VT');
  const rk = await page.evaluate(([bi, vb]) => { let e = null; try { window.rakeDetect(bi); } catch (x) { e = String(x.message); } return { e, vas: window.rakeDetect(vb) }; }, [BI_HDR, ['Account Number', 'Owner', 'Charge Amount', 'Contract Create Date', 'Case Number']]);
  ok(rk.e && rk.e.startsWith(REFUSAL), 'rakeDetect refuses a VT header with the sentence', rk.e);
  ok(rk.vas === 'BI_ACTIVE_CASES', 'rakeDetect still names a VAS BI header BI_ACTIVE_CASES', rk.vas);
  ok(!errs.length, 'PULSE: no page errors', errs.join(' ; '));
  await page.close();

  /* ================= OPS ================= */
  head('I5 · Ops refuses VT files');
  const ops = await browser.newPage(); const oerr = []; ops.on('pageerror', (e) => oerr.push(String(e.message).slice(0, 160)));
  await ops.route(API + '/**', (r) => r.fulfill({ status: 404, contentType: 'application/json', body: '{}' }));
  await ops.goto('http://127.0.0.1:8272/ops.html', { waitUntil: 'domcontentloaded' });
  await ops.waitForFunction(() => typeof detectSource === 'function' && typeof readUpload === 'function' && typeof handleFile === 'function', null, { timeout: 60000 });
  const o = await ops.evaluate(async ([bi, sm, csv]) => {
    const file = (b, n) => { const bin = atob(b), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new File([u], n); };
    const toasts = []; const t0 = window.toast; window.toast = function (m) { toasts.push(String(m)); try { return t0.apply(this, arguments); } catch (e) { return null; } };
    let modal = 0; const om = window.openUploadModal; window.openUploadModal = function () { modal++; return om.apply(this, arguments); };
    const pBi = await readUpload(file(bi, 'BI Active Fitted 091126.xlsx'), null), pSm = await readUpload(file(sm, 'Scheduled & Missed 091126.xlsx'), null);
    const res = { biSrc: detectSource(pBi), smSrc: detectSource(pSm) };
    await handleFile('BI_ACTIVE_CASES', file(bi, 'BI Active Fitted 091126.xlsx'));
    res.slotToast = toasts.slice(); res.modal = modal;
    toasts.length = 0; await handleBulkFiles([file(bi, 'BI Active Fitted 091126.xlsx'), file(sm, 'Scheduled & Missed 091126.xlsx'), new File([csv], 'Power BI - Active Cases 041126.csv')]);
    res.bulk = typeof pendingBulk !== 'undefined' && pendingBulk ? pendingBulk.map((i) => ({ n: i.file.name, src: i.src || null, err: i.error || null })) : null;
    res.bulkHtml = (document.querySelector('.modal') || document.body).innerText.slice(0, 4000);
    const pv = await readUpload(new File([csv], 'vas.csv'), null); res.vasSrc = detectSource(pv);
    return res; }, [b64(BI), b64(SM), csv]);
  ok(o.biSrc === null && o.smSrc === null, 'detectSource names no source for BI Active Fitted or Scheduled & Missed', JSON.stringify([o.biSrc, o.smSrc]));
  ok(o.slotToast.some((t) => t.startsWith(REFUSAL)) && o.modal === 0, 'dropped on the Power BI slot: refused with the sentence, no load dialog', o.slotToast.join(' | '));
  const bulkVt = (o.bulk || []).filter((i) => /Fitted|Scheduled/.test(i.n));
  ok(bulkVt.length === 2 && bulkVt.every((i) => !i.src && i.err && i.err.startsWith(REFUSAL)), 'the bulk upload refuses both VT files with the sentence (nothing to load)', JSON.stringify(o.bulk));
  ok(/This is a Vehicle Tracking file/.test(o.bulkHtml) && !/could not read: This is a Vehicle/.test(o.bulkHtml), 'the bulk dialog shows the sentence as it is');
  ok((o.bulk || []).some((i) => /Power BI/.test(i.n) && i.src === 'BI_ACTIVE_CASES') && o.vasSrc === 'BI_ACTIVE_CASES', 'a VAS Power BI CSV is still BI_ACTIVE_CASES in Ops', JSON.stringify([o.vasSrc, o.bulk]));
  ok(!oerr.length, 'Ops: no page errors', oerr.join(' ; '));
  await ops.close();
  { const OPS = fs.readFileSync(path.join(ROOT, 'Chatterbox_AgentOS_Analytics.html'), 'utf8');
    const m = /const VT_SIGNATURES=(\[[^\n]*\]);/.exec(OPS); let sig = null; try { sig = m && JSON.parse(m[1]); } catch (e) { sig = null; }
    const D = E.VT_RULES.detection, want = [D.vtBiFitted.requireHeaders, D.vtSchedMissed.requireHeaders, D.vtOpeningBook.requireHeaders];
    ok(JSON.stringify(sig) === JSON.stringify(want), 'Ops\' VT_SIGNATURES are exactly the rule book\'s detection.*.requireHeaders', m && m[1]);
    ok(OPS.includes("const VT_REFUSAL='" + REFUSAL), 'Ops carries the spec US1-7 sentence'); }
} catch (e) { ok(false, 'the suite ran', String((e && e.stack) || e).slice(0, 400)); }
finally { await browser.close(); server.close(); }
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
