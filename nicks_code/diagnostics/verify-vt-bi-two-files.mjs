#!/usr/bin/env node
/* verify-vt-bi-two-files.mjs — TWO DIFFERENT BI FILES WITH THE SAME COLUMNS (incident 2026-11-24, rule book vt-1.3).
 *
 * The VAS "BI Active <ddmmyy>.xlsx" (VAS money: PULSE type bi, Ops BI_ACTIVE_CASES) and the Vehicle Tracking
 * "BI Active Fitted <ddmmyy>.xlsx" are two exports with the SAME header. Spec 071 decided "Vehicle Tracking" from the
 * columns alone, so on 24 Nov the VAS file was taken by the VT intake. The rule now: the SLOT is the uploader's
 * declaration, the NAME ("Fitted" = detection.vtBiFitted.nameHint) the fallback. Real PULSE + Ops pages in Chromium, a
 * stubbed Worker, fictional rows with the real column set (CB91xx, invented values):
 *   A  "BI Active 231126.xlsx" on the VAS BI slot and in a VAS bulk drop → VAS bi (S.files, save, regFile,
 *      archiveUpload, rebuild), the VT intake never called, no /api/vt/upload/*
 *   B  the SAME bytes named "BI Active Fitted 231126.xlsx" on the VT BI slot, in a bulk drop, and with no slot inside the
 *      Vehicle Tracking app → the VT intake once each; VAS state / S.files / save / relay untouched
 *   C  "BI Active Fitted …" on the VAS BI slot → refused in words, nothing loaded anywhere
 *   D  a name without "Fitted" on the VT BI slot (and with no slot inside the VT app) → VT, with the heads-up
 *   E  the VAS result of A is IDENTICAL to the pre-071 page (git show 55a452c:nicks_code/index.html, written to a temp dir
 *      OUTSIDE the repo): S.files, the stored BI rows (S.sales and every other store), the model M, the composite and the
 *      Agent Analytics digest. Ignored, by name (printed at run): S._rev, S.files[].at and digest.updatedAt (wall-clock
 *      stamps of the save / upload / publish) and S.ui.vasTab (vt-app's remembered VAS tab — view state, not data); any
 *      top-level state key the pre-071 page does not have would be named too (none today). In B–D the VAS state is
 *      compared whole less S.ui.vt (the VT pages' own filter view state, created when they first paint)
 *   F  Ops: "BI Active 231126.xlsx" → BI_ACTIVE_CASES on the slot and in bulk; "BI Active Fitted 231126.xlsx" refused with
 *      the sentence; Scheduled & Missed and the opening book still refused
 *   G  rakeDetect: a BI header passes (VAS); the two VT-only headers throw
 *   R  the real ../reference/zips/vt/BI Active Fitted 101126.xlsx (skipped loudly when absent): its header is vtBiFitted,
 *      its bytes renamed "BI Active 101126.xlsx" on the VAS BI slot are VAS bi, its own name on the VT slot is VT
 *
 *   node nicks_code/diagnostics/verify-vt-bi-two-files.mjs        (builds site/ first unless --no-build)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { biFile, smFile, openFile, xlsxBytes, BI_HDR, SM_HDR, OPEN_HDR } from './vt-fixtures.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const require = createRequire(import.meta.url);
const { chromium } = await import(pathToFileURL(path.join(HERE, 'node_modules', 'playwright', 'index.mjs')).href);
const E = require(path.join(ROOT, 'nicks_code', 'vt-engine.js'));
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m + (d !== undefined ? ' — ' + String(d).slice(0, 400) : '')); } };
const head = (t) => console.log('\n' + t);
const API = 'https://chatterbox-agentos-api.chatterbox-agentos.workers.dev';
const REFUSAL = 'This is a Vehicle Tracking file. Load it in the VAS Upload Station';
const PRE071 = '55a452c';
if (!process.argv.includes('--no-build')) spawnSync(process.execPath, [path.join(ROOT, 'tools', 'prepare-site.js')], { cwd: ROOT, encoding: 'utf8' });

/* the pre-071 page, from git, into a temp dir OUTSIDE the repo (no checkout, no stash) */
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vt-bi-two-files-'));
const OLD = path.join(TMP, 'pulse-pre071.html');
{ const r = spawnSync('git', ['show', PRE071 + ':nicks_code/index.html'], { cwd: ROOT, encoding: 'buffer', maxBuffer: 64 * 1048576 });
  /* a shallow clone (CI) has no ${PRE071}: E is then SKIPPED LOUDLY, every other check still runs */
  if (r.status === 0) fs.writeFileSync(OLD, r.stdout); else console.log('  (SKIP — LOUDLY) ' + PRE071 + ':nicks_code/index.html is not in this clone — the pre-071 comparison (E) did NOT run: ' + String(r.stderr).trim().slice(0, 120)); }
const HAVE_OLD = fs.existsSync(OLD);

const SERVE = { '/pulse.html': path.join(ROOT, 'nicks_code/index.html'), '/pulse-old.html': OLD, '/vt-engine.js': path.join(ROOT, 'nicks_code/vt-engine.js'),
  '/vt-pages.js': path.join(ROOT, 'nicks_code/vt-pages.js'), '/vt-publish.js': path.join(ROOT, 'nicks_code/vt-publish.js'), '/vt-app.js': path.join(ROOT, 'nicks_code/vt-app.js'),
  '/xlsx.full.min.js': path.join(ROOT, 'site/xlsx.full.min.js'), '/ops.html': path.join(ROOT, 'site/index.html') };
const server = http.createServer((q, s) => { const p = SERVE[q.url.split('?')[0]];
  if (!p || !fs.existsSync(p)) { s.writeHead(404); s.end(); return; }
  s.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' }); fs.createReadStream(p).pipe(s); });
await new Promise((r) => server.listen(8273, '127.0.0.1', r));
const browser = await chromium.launch();

/* a minimal VT Worker (an empty book that accepts the upload) + a relay manifest; every request is logged */
const net = [];
let rev = 0;
async function stub(route) {
  const r = route.request(), u = new URL(r.url()); net.push(r.method() + ' ' + u.pathname + (u.searchParams.get('key') ? '?key=' + u.searchParams.get('key') : ''));
  const J = (b, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });
  if (u.pathname === '/api/vt/uploads') return J({ uploads: [] });
  if (u.pathname === '/api/vt/roster') return J({ as_of: null, rows: [] });
  if (u.pathname === '/api/vt/book') return J({ rev, openedOn: null, cases: [], events: [] });
  if (u.pathname === '/api/vt/upload/begin') return J({ id: rev + 1 });
  if (u.pathname === '/api/vt/upload/stage') return J({ staged: 1 });
  if (u.pathname === '/api/vt/upload/commit') { rev++; return J({ rev }); }
  if (u.pathname === '/api/upload-manifest') return J({ files: [] });
  return J({}, 404);
}
const b64 = (b) => Buffer.from(b).toString('base64');
/* the real BI column set, fictional rows: three VAS lines and two VT lines, sold in November, one seller on the roster */
const LINES = [{ cn: 93000001, unit: 'VAS1', charge: 86.08, inst: '2026-11-17', seller: 'Vas Person' }, { cn: 93000002, unit: 'VAS1', charge: 99, inst: '2026-11-18', seller: 'Vas Person' },
  { cn: 93000003, unit: 'VAS2', charge: 150, inst: '2026-11-20', seller: 'Vas Other' }, { cn: 93000004, unit: 'MXV', charge: 120, inst: '2026-11-20', seller: 'Alpha Test - Panimax' },
  { cn: 93000005, unit: 'BEAME', charge: 110, inst: '2026-11-21', seller: 'Alpha Test - Panimax' }];
const BI = xlsxBytes(biFile(LINES));
const SM = xlsxBytes(smFile([{ cn: 93000010 }]));
const OB = xlsxBytes({ 'Schedulers Data': openFile([{ cn: 93000004 }]) });

async function station(url) {
  const page = await browser.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
  await page.route(API + '/**', stub);
  await page.goto('http://127.0.0.1:8273' + url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__mtd && window.__mtd.state() && window.XLSX && typeof window.handleFiles === 'function', null, { timeout: 60000 });
  /* signed in only AFTER boot: hydrate() (the cloud vas-state read, which would replace the seeded state with the stub's empty
     answer at a moment of its own choosing) never runs, while archiveUpload — which needs a session — does */
  await page.evaluate(() => { try { sessionStorage.setItem('cbx_token', 'two-files-test'); } catch (e) {} });
  await page.evaluate(() => { const S = window.__mtd.state();
    S.roster = [{ code: 'CB9150', name: 'Vas Person', sf: 'Vas Person', tl: 'Leader One', campaign: 'Courtesy', tenure: 'Exp', callx: '', target: 3, start: '2026-01-01' },
      { code: 'CB9151', name: 'Vas Other', sf: 'Vas Other', tl: 'Leader One', campaign: 'Cuddle', tenure: 'M2', callx: '', target: 2, start: '2026-09-01' }];
    S.sales = {}; S.files = []; S.ui.month = '2026-11'; S.ui.preset = 'month';
    window.__mtd.rebuild();
    window.__spy = {}; for (const fn of ['save', 'regFile', 'archiveUpload', 'rebuild', 'largeUpload', 'kickAgentDigest']) {
      if (typeof window[fn] !== 'function') continue; const f0 = window[fn]; window.__spy[fn] = 0;
      window[fn] = function () { window.__spy[fn]++; return f0.apply(this, arguments); }; }
    window.__toasts = []; const t0 = window.toast; window.toast = function (m) { window.__toasts.push(String(m)); try { return t0.apply(this, arguments); } catch (e) { return null; } };
    window.__vtCalls = 0;
    if (window.VTStation) { const vi = window.VTStation.ingest; window.VTStation.ingest = function () { window.__vtCalls++; return vi.apply(this, arguments); }; } });
  /* settle = the ingest queue itself: handleFiles resolves when its files are read, ingested and saved */
  const drop = (files, slot) => page.evaluate(async ([fs0, s]) => {
    const mk = ([n, b]) => { const bin = atob(b), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new File([u], n); };
    window.__toasts = []; await window.handleFiles(fs0.map(mk), s || null); if (typeof window.ingestIdle === 'function') await window.ingestIdle(); }, [files.map(([n, b]) => [n, b64(b)]), slot]);
  const read = () => page.evaluate(() => ({ spy: Object.assign({}, window.__spy), vt: window.__vtCalls, toasts: window.__toasts.slice(), files: window.__mtd.state().files.map((f) => f.type + '|' + f.name) }));
  const reset = () => page.evaluate(() => { for (const k in window.__spy) window.__spy[k] = 0; window.__vtCalls = 0; window.__toasts = []; });
  /* the VAS answer, for E: the whole state, the model, the composite and the digest */
  const vasAnswer = () => page.evaluate(() => { const S = window.__mtd.state();
    let digest = null, comp = null; try { digest = window.__mtd.digest(); } catch (e) { digest = 'threw: ' + e.message; } try { comp = ['CB9150', 'CB9151'].map((c) => window.__mtd.composite(c)); } catch (e) { comp = 'threw: ' + e.message; }
    return JSON.stringify({ S, M: window.__mtd.model(), comp, digest }); });
  return { page, errs, drop, read, reset, vasAnswer, /* the VAS state, whole — less S.ui.vt, the Vehicle Tracking pages' own filter view state (tl / sub / lead), which the VT
     pages create when they first paint after a commit: it is VT view state, never VAS data */
    snap: () => page.evaluate(() => { const c = JSON.parse(JSON.stringify(window.__mtd.state())); if (c.ui) delete c.ui.vt; return JSON.stringify(c); }) };
}
const vtUp = () => net.filter((x) => /\/api\/vt\/upload\//.test(x));
/* the VT commit publishes kv:vt-digest (spec 071 E2) — its own key; every other /api/kv write is VAS */
const vasWrites = () => net.filter((x) => (/^POST \/api\/kv/.test(x) && !/key=vt-digest/.test(x)) || /\/api\/upload-archive|\/api\/upload\/large|\/api\/rake\/page|\/api\/upload-file/.test(x));

/* E: a structural diff that names every path that differs (wall-clock stamps are dropped first, by name) */
function diffPaths(a, b, at = '', out = []) {
  if (out.length > 20) return out;
  if (a && b && typeof a === 'object' && typeof b === 'object') { for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diffPaths(a[k], b[k], at + '.' + k, out); return out; }
  if (JSON.stringify(a) !== JSON.stringify(b)) out.push(at + ': ' + String(JSON.stringify(a)).slice(0, 80) + ' vs ' + String(JSON.stringify(b)).slice(0, 80));
  return out;
}
const STAMPS = /^(_rev|at|updatedAt)$/;
const ignored = new Set();
function scrub(v, at = '') {
  if (Array.isArray(v)) return v.map((x, i) => scrub(x, at + '[]'));
  if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) { if (STAMPS.test(k)) { ignored.add(at + '.' + k); continue; } o[k] = scrub(x, at + '.' + k); } return o; }
  return v;
}

try {
  /* ================= A + E: the VAS BI Active file is VAS, exactly as before spec 071 ================= */
  const answers = {};
  for (const [label, url] of [['now', '/pulse.html'], ...(HAVE_OLD ? [['pre071', '/pulse-old.html']] : [])]) {
    for (const mode of ['slot', 'bulk']) {
      const st = await station(url); net.length = 0;
      if (mode === 'slot') await st.drop([['BI Active 231126.xlsx', BI]], 'bi');
      else await st.drop([['BI Active 231126.xlsx', BI]], null);
      const r = await st.read();
      answers[label + ':' + mode] = await st.vasAnswer();
      if (label === 'now') {
        head('A · "BI Active 231126.xlsx" ' + (mode === 'slot' ? 'on the VAS BI slot' : 'in a VAS bulk drop (no slot)'));
        ok(r.files.includes('bi|BI Active 231126.xlsx'), 'registered in S.files as VAS bi', r.files.join(', '));
        ok(r.spy.save > 0 && r.spy.regFile > 0 && r.spy.archiveUpload > 0 && r.spy.rebuild > 0, 'save, regFile, archiveUpload and rebuild ran, as for any VAS BI file', JSON.stringify(r.spy));
        ok(r.vt === 0 && vtUp().length === 0, 'the VT intake was never called, no /api/vt/upload/*', r.vt + ' ' + vtUp().join(','));
        ok(net.includes('GET /api/upload-manifest'), 'the relay to Ops was asked (archiveUpload → /api/upload-manifest)', net.join(', '));
        ok(!r.toasts.some((t) => /Vehicle Tracking|Heads up/.test(t)), 'no Vehicle Tracking toast or heads-up', r.toasts.join(' | '));
        const S = JSON.parse(answers[label + ':' + mode]).S;
        ok(S.sales && Object.keys(S.sales).length > 0, 'the BI rows are stored as VAS sales (' + Object.keys(S.sales || {}).length + ' day(s))', JSON.stringify(S.sales).slice(0, 200));
      }
      ok(!st.errs.length, label + ' ' + mode + ': no page errors', st.errs.join(' ; '));
      await st.page.close();
    }
  }
  head('E · the VAS result is IDENTICAL to the pre-071 page (' + PRE071 + ')');
  for (const mode of HAVE_OLD ? ['slot', 'bulk'] : []) {
    const a = JSON.parse(answers['now:' + mode]), b = JSON.parse(answers['pre071:' + mode]);
    /* S.ui.vasTab: the VAS tab remembered while the Vehicle Tracking app is open (vt-app.js, spec 071) — view state, no data */
    if (a.S.ui && 'vasTab' in a.S.ui && !(b.S.ui && 'vasTab' in b.S.ui)) { delete a.S.ui.vasTab; ignored.add('S.ui.vasTab (vt-app view state, absent on the pre-071 page)'); }
    const extra = Object.keys(a.S).filter((k) => !(k in b.S)); extra.forEach((k) => { ignored.add('S.' + k + ' (absent on the pre-071 page)'); delete a.S[k]; });
    const A = scrub(a), B = scrub(b);
    for (const part of ['S', 'M', 'comp', 'digest']) {
      const d = diffPaths(A[part], B[part], part);
      ok(d.length === 0, mode + ': ' + (part === 'S' ? 'the whole VAS state (S.files, S.sales and every store)' : part === 'M' ? 'the model M (every VAS figure on the pages)' : part === 'comp' ? 'the composite rating of both agents' : 'the Agent Analytics digest') + ' equals the pre-071 page', d.slice(0, 6).join(' | '));
    }
    ok(JSON.stringify(A.S.files) === JSON.stringify(B.S.files) && A.S.files.length === 1, mode + ': S.files is the same one bi entry (name, type, dates, rows, hash)', JSON.stringify(A.S.files));
  }
  console.log('  (ignored: ' + ([...ignored].join(', ') || 'none') + ')');

  /* ================= B, C, D: the Vehicle Tracking file ================= */
  {
    const st = await station('/pulse.html');
    await st.page.waitForFunction(() => window.VTStation && window.VTApp, null, { timeout: 30000 });
    const vtDrop = async (title, files, slot, want) => {
      await st.reset(); const before = await st.snap(); net.length = 0; await st.drop(files, slot); const r = await st.read();
      head(title);
      ok(r.vt === want.vt, 'the VT intake was called ' + want.vt + ' time(s)', r.vt);
      ok(net.filter((x) => x === 'POST /api/vt/upload/commit').length === want.vt, want.vt + ' VT commit(s)', vtUp().join(','));
      { const now = await st.snap(); ok(now === before, 'the VAS state is byte-identical', diffPaths(JSON.parse(before), JSON.parse(now), 'S').slice(0, 5).join(' | ')); }
      ok(Object.values(r.spy).every((n) => n === 0), 'save / regFile / archiveUpload / rebuild / largeUpload / kickAgentDigest never ran', JSON.stringify(r.spy));
      ok(vasWrites().length === 0 && !net.includes('GET /api/upload-manifest'), 'no POST to /api/kv, no relay, no Rake', vasWrites().join(','));
      if (want.toast) ok(r.toasts.some((t) => want.toast.test(t)), 'the toast says so in words', r.toasts.join(' | '));
      if (want.noHeadsUp) ok(!r.toasts.some((t) => /does not say "Fitted"/.test(t)), 'no "Fitted" heads-up (the name says it)', r.toasts.join(' | '));
      return r;
    };
    await vtDrop('B1 · the same bytes as "BI Active Fitted 231126.xlsx" on the VT BI slot', [['BI Active Fitted 231126.xlsx', BI]], 'vtBiFitted', { vt: 1, noHeadsUp: true });
    await vtDrop('B2 · "BI Active Fitted 231126.xlsx" in a bulk drop (no slot, VAS app)', [['BI Active Fitted 231126.xlsx', BI]], null, { vt: 1, noHeadsUp: true });
    await vtDrop('C  · "BI Active Fitted 231126.xlsx" on the VAS BI slot → refused', [['BI Active Fitted 231126.xlsx', BI]], 'bi',
      { vt: 0, toast: /"BI Active Fitted 231126\.xlsx" is the Vehicle Tracking file \(BI Active Fitted\)\. Load it in Vehicle Tracking → Upload Station\. Nothing was loaded into VAS\./ });
    await vtDrop('D1 · "VT export 231126.xlsx" (no "Fitted") on the VT BI slot → VT, with the heads-up', [['VT export 231126.xlsx', BI]], 'vtBiFitted',
      { vt: 1, toast: /Heads up: "VT export 231126\.xlsx" does not say "Fitted" in its name\. It is being loaded as the Vehicle Tracking file because of where it was dropped/ });
    await st.page.evaluate(() => { window.VTApp.go(true); });
    ok(await st.page.evaluate(() => window.VTApp.on()), 'inside the Vehicle Tracking app');
    await vtDrop('B3 · "BI Active Fitted 231126.xlsx" with no slot inside the Vehicle Tracking app', [['BI Active Fitted 231126.xlsx', BI]], null, { vt: 1, noHeadsUp: true });
    await vtDrop('D2 · "BI Active 231126.xlsx" with no slot inside the Vehicle Tracking app → VT, with the heads-up', [['BI Active 231126.xlsx', BI]], null, { vt: 1, toast: /does not say "Fitted"/ });
    ok(!st.errs.length, 'no page errors', st.errs.join(' ; '));
    await st.page.close();
  }

  /* ================= G: the Rake ================= */
  {
    head('G · rakeDetect');
    const st = await station('/pulse.html');
    const rk = await st.page.evaluate(([bi, sm, ob]) => { const t = (h, n) => { try { return { src: window.rakeDetect(h, n) }; } catch (x) { return { e: String(x.message) }; } };
      return { bi: t(bi, 'BI Active 231126.xlsx'), biNoName: t(bi), fitted: t(bi, 'BI Active Fitted 231126.xlsx'), sm: t(sm, 'Scheduled & Missed 231126.xlsx'), ob: t(ob, 'November 2026 - VT Report.xlsx') }; }, [BI_HDR, SM_HDR, OPEN_HDR]);
    ok(!rk.bi.e && !rk.biNoName.e, 'a BI header passes the Rake as the VAS BI Active export (named or not)', JSON.stringify([rk.bi, rk.biNoName]));
    ok(rk.sm.e && rk.sm.e.startsWith(REFUSAL) && rk.ob.e && rk.ob.e.startsWith(REFUSAL), 'the two VT-only headers (Scheduled & Missed, the opening book) still throw the sentence', JSON.stringify([rk.sm, rk.ob]));
    ok(rk.fitted.e && rk.fitted.e.startsWith(REFUSAL), 'a BI header whose name says Fitted is refused by the Rake (never VAS money)', JSON.stringify(rk.fitted));
    await st.page.close();
  }

  /* ================= R: the real sample ================= */
  {
    head('R · the real BI Active Fitted 101126 (header + bytes; no value printed)');
    const REAL = path.join(ROOT, '..', 'reference', 'zips', 'vt', 'BI Active Fitted 101126.xlsx');
    if (!fs.existsSync(REAL)) console.log('  (SKIP — LOUDLY) ../reference/zips/vt/BI Active Fitted 101126.xlsx is not here: the real-file checks did NOT run');
    else {
      const bytes = fs.readFileSync(REAL); const XLSX = createRequire(path.join(HERE, 'node_modules', 'x.js'))('xlsx');
      const wb = XLSX.read(bytes, { sheetRows: 2 }); const h = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 })[0].map(String);
      ok(E.detect(h, wb.SheetNames[0]) === 'vtBiFitted' && E.isBiFittedName('BI Active Fitted 101126.xlsx') && !E.isBiFittedName('BI Active 101126.xlsx'), 'its header is vtBiFitted; only the "Fitted" name makes it Vehicle Tracking');
      let st = await station('/pulse.html'); net.length = 0;
      await st.drop([['BI Active 101126.xlsx', bytes]], 'bi'); let r = await st.read();
      ok(r.files.includes('bi|BI Active 101126.xlsx') && r.vt === 0 && vtUp().length === 0, 'its bytes named "BI Active 101126.xlsx" on the VAS BI slot load as VAS bi, never the VT intake', r.files.join(',') + ' vt=' + r.vt);
      await st.page.close();
      st = await station('/pulse.html'); net.length = 0; const before = await st.snap();
      await st.drop([['BI Active Fitted 101126.xlsx', bytes]], 'vtBiFitted'); r = await st.read();
      ok(r.vt === 1 && (await st.snap()) === before && vasWrites().length === 0, 'its own name on the VT BI slot goes to the VT intake, VAS untouched', 'vt=' + r.vt);
      await st.page.close();
    }
  }

  /* ================= F: Ops ================= */
  {
    head('F · Ops');
    const ops = await browser.newPage(); const oerr = []; ops.on('pageerror', (e) => oerr.push(String(e.message).slice(0, 160)));
    await ops.route(API + '/**', (r) => r.fulfill({ status: 404, contentType: 'application/json', body: '{}' }));
    await ops.goto('http://127.0.0.1:8273/ops.html', { waitUntil: 'domcontentloaded' });
    await ops.waitForFunction(() => typeof detectSource === 'function' && typeof readUpload === 'function' && typeof handleFile === 'function', null, { timeout: 60000 });
    const o = await ops.evaluate(async ([bi, sm, ob]) => {
      const file = (b, n) => { const bin = atob(b), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new File([u], n); };
      const toasts = []; const t0 = window.toast; window.toast = function (m) { toasts.push(String(m)); try { return t0.apply(this, arguments); } catch (e) { return null; } };
      let modal = 0; const om = window.openUploadModal; window.openUploadModal = function () { modal++; return om.apply(this, arguments); };
      const res = {};
      res.detVas = detectSource(await readUpload(file(bi, 'BI Active 231126.xlsx'), null));
      res.detFit = detectSource(await readUpload(file(bi, 'BI Active Fitted 231126.xlsx'), null));
      await handleFile('BI_ACTIVE_CASES', file(bi, 'BI Active 231126.xlsx'));
      res.slotVas = { modal, src: typeof pendingUpload !== 'undefined' && pendingUpload ? pendingUpload.srcKey : null, ok: pendingUpload && pendingUpload.hv ? pendingUpload.hv.ok : null, toasts: toasts.splice(0) };
      modal = 0; pendingUpload = null;
      await handleFile('BI_ACTIVE_CASES', file(bi, 'BI Active Fitted 231126.xlsx'));
      res.slotFit = { modal, toasts: toasts.splice(0), pending: !!pendingUpload };
      await handleBulkFiles([file(bi, 'BI Active 231126.xlsx'), file(bi, 'BI Active Fitted 231126.xlsx'), file(sm, 'Scheduled & Missed 231126.xlsx'), file(ob, 'November 2026 - VT Report.xlsx')]);
      res.bulk = typeof pendingBulk !== 'undefined' && pendingBulk ? pendingBulk.map((i) => ({ n: i.file.name, src: i.src || null, err: i.error || null })) : null;
      return res; }, [b64(BI), b64(SM), b64(OB)]);
    ok(o.detVas === 'BI_ACTIVE_CASES', 'detectSource: "BI Active 231126.xlsx" → BI_ACTIVE_CASES (as on ' + PRE071 + ')', o.detVas);
    ok(o.detFit === null, 'detectSource: the same columns named "BI Active Fitted 231126.xlsx" → no source', o.detFit);
    ok(o.slotVas.modal === 1 && o.slotVas.src === 'BI_ACTIVE_CASES' && !o.slotVas.toasts.some((t) => t.startsWith(REFUSAL)), 'on the Power BI slot "BI Active 231126.xlsx" opens the load dialog as BI_ACTIVE_CASES, no refusal', JSON.stringify(o.slotVas));
    ok(o.slotFit.modal === 0 && !o.slotFit.pending && o.slotFit.toasts.some((t) => t.startsWith(REFUSAL)), 'on the Power BI slot "BI Active Fitted 231126.xlsx" is refused with the sentence, nothing pending', JSON.stringify(o.slotFit));
    const by = Object.fromEntries((o.bulk || []).map((i) => [i.n, i]));
    ok(by['BI Active 231126.xlsx'] && by['BI Active 231126.xlsx'].src === 'BI_ACTIVE_CASES' && !by['BI Active 231126.xlsx'].err, 'bulk: "BI Active 231126.xlsx" → BI_ACTIVE_CASES', JSON.stringify(by['BI Active 231126.xlsx']));
    ok(['BI Active Fitted 231126.xlsx', 'Scheduled & Missed 231126.xlsx', 'November 2026 - VT Report.xlsx'].every((n) => by[n] && !by[n].src && by[n].err && by[n].err.startsWith(REFUSAL)),
      'bulk: BI Active Fitted, Scheduled & Missed and the opening book are all refused with the sentence', JSON.stringify(o.bulk));
    ok(!oerr.length, 'Ops: no page errors', oerr.join(' ; '));
    await ops.close();
    const OPS = fs.readFileSync(path.join(ROOT, 'Chatterbox_AgentOS_Analytics.html'), 'utf8'); const hm = /const VT_BI_NAME_HINT="([^"]*)";/.exec(OPS);
    ok(hm && hm[1] === E.VT_RULES.detection.vtBiFitted.nameHint, 'Ops reads the same name hint as the rule book (detection.vtBiFitted.nameHint)', hm && hm[1]);
  }
} catch (e) { ok(false, 'the suite ran', String((e && e.stack) || e).slice(0, 500)); }
finally { await browser.close(); server.close(); try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {} }
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
