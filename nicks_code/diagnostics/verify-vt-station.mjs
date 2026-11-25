#!/usr/bin/env node
/* verify-vt-station.mjs — THE VT UPLOAD STATION, INTAKE HALF (Spec Kit 071, Phase C tasks C5–C7, C10; the pages half is D).
 *
 * The real PULSE page (nicks_code/index.html + its companion vt-engine.js / vt-pages.js) in a real Chromium; the Worker
 * is a stub inside the test (Playwright route) that keeps a case book the way vt_book / vt_upload_* do. Fictional
 * files (CB91xx, invented case numbers); the real sample files are read at run time ONLY for the receipt check and are
 * skipped cleanly when ../reference/zips/vt/ is absent — no value from them is printed or written.
 *   S1  a BI Active Fitted drop: GET receipts → roster → book → begin → stage → commit; the receipt card says file,
 *       extract date, VT lines of rows, cases, changes, unmatched sellers by name, and "VAS money unchanged"
 *   S2  no customer field (name, phone, registration, chassis, box, account / contract number) is in ANY request
 *   S3  the same bytes again (renamed, still "Fitted" — a BI-columned name without it is the VAS BI Active export since the
 *       2026-11-24 incident) → "already uploaded", nothing begun
 *   S4  thin BI pull (< 90 % of the cycle's last BI) → refused in words with both counts, nothing begun
 *   S5  thin S&M (< 40 %) → refused unless "genuine quiet day" is clicked; then it loads and the receipt says so
 *   S6  a version conflict re-reads, re-merges and commits ONCE (one receipt); three conflicts → a persistent red
 *       banner, no receipt
 *   S7  the server unreachable → a persistent banner, nothing saved
 *   S8  the opening book on an empty book → refused in plain words (after the first day's files it applies sale dates)
 *   S9  roster (C7): read from /api/vt/roster; when that fails, PULSE's own VT roster rows are used and the receipt says so
 *   S10 the Upload Station shows the three VT slots in their own group; the ten VAS slot cards are untouched; a "Fitted"
 *       file dropped on the VAS BI slot is refused in words (rule book vt-1.3), nothing committed
 *   S11 stage batches stay ≤ 1,000 rows and under the 512 KB cap (unit)
 *   S13 Vehicle Tracking as its own app (VT mode, 2026-11-24): the Upload Station inside it takes a VT file and the commit
 *       still publishes the VT digest
 *   S12 the real BI Active Fitted 101126: 1,107 VT lines of 19,404 rows, 1,104 cases (spec US1-1), no reg / chassis /
 *       box value in any request
 *
 *   node nicks_code/diagnostics/verify-vt-station.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { biFile, smFile, schFile, xlsxBytes, PII } from './vt-fixtures.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const require = createRequire(import.meta.url);
const req = createRequire(path.join(HERE, 'node_modules', 'x.js'));
const { chromium } = await import(pathToFileURL(path.join(HERE, 'node_modules', 'playwright', 'index.mjs')).href);
const ST = require(path.join(ROOT, 'nicks_code', 'vt-pages.js'));
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m + (d !== undefined ? ' — ' + String(d).slice(0, 400) : '')); } };
const head = (t) => console.log('\n' + t);
const API = 'https://chatterbox-agentos-api.chatterbox-agentos.workers.dev';
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

/* ---- the stub Worker: a case book kept the way migration-071 keeps it ---- */
const COLS = ['case_number', 'status', 'status_on', 'sold_on', 'sold_basis', 'first_seen', 'last_seen', 'appt_on', 'fitted_on', 'products', 'charge_ex', 'lead_source', 'seller_name', 'seller_cb', 'seller_match', 'sm_attempt', 'bundle', 'partner_raw', 'cancel_reason',
  /* spec 072 DB-3: appended, in VTEngine.BOOK_COLS order */ 'scheduler_name', 'scheduler_cb', 'gwp_rpt', 'referring_name', 'referring_cb', 'campaign_rpt', 'result_rpt'];
const ROSTER_RPC = { as_of: '2026-11-02', rows: [
  { code: 'CB9101', name: 'Alpha Test', sf: 'Alpha Test', tl: 'Leader One', tl_code: 'CB9190', campaign_raw: 'Matrix Vehicle Tracking - Digital', tenure: 'Exp', target: 6.5, start_date: '2026-01-05' },
  { code: 'CB9102', name: 'Bravo Middle Tester', sf: null, tl: 'Leader Two', tl_code: 'CB9191', campaign_raw: 'Matrix Vehicle Tracking - Referral', tenure: 'Exp', target: 3, start_date: '2026-01-05' }] };
let W;
function resetWorker(o = {}) { W = { rev: 0, openedOn: null, openingBookOn: null, cases: {}, events: [], uploads: [], stage: {}, log: [], conflicts: 0, rosterFails: false, down: false, kv: [], ...o }; }
function answer(method, p, body) {
  const J = (b, s = 200) => ({ status: s, body: JSON.stringify(b) });
  if (p.startsWith('/api/vt/uploads')) return J({ uploads: W.uploads.slice().reverse() });
  if (p.startsWith('/api/vt/roster')) return W.rosterFails ? J({ error: 'boom' }, 502) : J(ROSTER_RPC);
  if (p === '/api/vt/book') {
    const also = new Set((body.p_also || []).map(String)), from = body.p_from;
    const cs = Object.values(W.cases).filter((c) => !from || c.last_seen >= from || ['scheduled', 'missed'].includes(c.status) || also.has(String(c.case_number)));
    const keep = new Set(cs.map((c) => String(c.case_number)));
    return J({ rev: W.rev, openedOn: W.openedOn, openingBookOn: W.openingBookOn, cases: cs.map((c) => COLS.map((k) => (c[k] === undefined ? null : c[k]))),
      events: W.events.filter((e) => keep.has(String(e.case_number))).map((e) => [e.case_number, e.on_date, e.from_status, e.to_status, e.appt_on]) });
  }
  if (p === '/api/vt/upload/begin') {
    const hit = W.uploads.find((u) => u.sha256 === body.p_sha256);
    if (hit && hit.state === 'committed') return J({ duplicate: true, id: hit.id });
    const u = hit || { id: W.uploads.length + 1, sha256: body.p_sha256 }; Object.assign(u, { kind: body.p_kind, file_name: body.p_file_name, extract_on: body.p_extract_on, cycle_key: body.p_cycle_key, state: 'staging' });
    if (!hit) W.uploads.push(u); W.stage[u.id] = { case: [], event: [] }; return J({ id: u.id });
  }
  if (p === '/api/vt/upload/stage') { W.stage[body.p_id][body.p_kind].push(...body.p_rows); return J({ staged: body.p_rows.length }); }
  if (p === '/api/vt/upload/abandon') { const u = W.uploads.find((x) => x.id === body.p_id); if (u && u.state === 'staging') u.state = 'abandoned'; return J({ ok: true }); }
  if (p === '/api/vt/upload/commit') {
    if (W.conflicts > 0) { W.conflicts--; W.rev++; return J({ error: 'version_conflict' }, 409); }
    if (body.p_base_rev !== W.rev) return J({ error: 'version_conflict' }, 409);
    const u = W.uploads.find((x) => x.id === body.p_id), s = W.stage[body.p_id];
    if (s.case.length !== body.p_cases || s.event.length !== body.p_events) return J({ error: 'stage_incomplete' }, 409);
    if ((u.kind === 'opening_book' || u.kind === 'schedulers_data') && !W.openedOn) return J({ error: 'Load the opening book after the first day\'s two files' }, 409);
    for (const c of s.case) W.cases[c.case_number] = { ...c };
    for (const e of s.event) if (!W.events.some((x) => x.case_number === e.case_number && x.on_date === e.on_date && x.to_status === e.to_status)) W.events.push(e);
    const dating = u.kind === 'opening_book' || u.kind === 'schedulers_data';   /* spec 072: both dating kinds stamp opening_book_on */
    W.rev++; if (!dating) W.openedOn = W.openedOn || u.extract_on; else W.openingBookOn = W.openingBookOn || u.extract_on;
    Object.assign(u, { state: 'committed', counts: body.p_counts, unmatched: body.p_unmatched, warnings: body.p_warnings, quiet_day_ack: body.p_quiet_ack, rev_after: W.rev });
    return J({ rev: W.rev, cases: s.case.length, events: s.event.length });
  }
  return J({ error: 'not found' }, 404);
}

/* ---- PULSE, served from the source folder ---- */
const SERVE = { '/': 'nicks_code/index.html', '/index.html': 'nicks_code/index.html', '/vt-engine.js': 'nicks_code/vt-engine.js', '/vt-pages.js': 'nicks_code/vt-pages.js', '/vt-publish.js': 'nicks_code/vt-publish.js', '/vt-app.js': 'nicks_code/vt-app.js', '/xlsx.full.min.js': 'site/xlsx.full.min.js' };
const server = http.createServer((q, s) => { const rel = SERVE[q.url.split('?')[0]]; const p = rel && path.join(ROOT, rel);
  if (!p || !fs.existsSync(p)) { s.writeHead(404); s.end(); return; }
  s.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' }); fs.createReadStream(p).pipe(s); });
await new Promise((r) => server.listen(8271, '127.0.0.1', r));
const browser = await chromium.launch();
const page = await browser.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
await page.route(API + '/**', async (route) => {
  const r = route.request(), u = new URL(r.url()), p = u.pathname + (u.search || '');
  if (W.down && p.startsWith('/api/vt/')) return route.abort('connectionrefused');
  let body = {}; try { body = r.postData() ? JSON.parse(r.postData()) : {}; } catch (e) { body = {}; }
  if (u.pathname.startsWith('/api/vt/')) W.log.push({ m: r.method(), p: u.pathname, raw: r.postData() || '', body });
  /* the VT digest publish (Phase E, vt-publish.js): POST /api/kv?key=vt-digest… is recorded and acknowledged */
  if (u.pathname === '/api/kv') {
    if (r.method() === 'POST') { W.kv.push({ key: u.searchParams.get('key'), body: r.postData() || '' }); return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); }
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{"found":false}' });
  }
  const a = u.pathname.startsWith('/api/vt/') ? answer(r.method(), u.pathname, body) : { status: 404, body: '{}' };
  return route.fulfill({ status: a.status, contentType: 'application/json', body: a.body });
});
await page.goto('http://127.0.0.1:8271/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__mtd && window.__mtd.state() && window.VTStation && window.XLSX, null, { timeout: 60000 });
await page.evaluate(() => { try { sessionStorage.setItem('cbx_token', 'station-test'); } catch (e) {} });   // a signed-in station (the VT digest publish needs a session)
await page.evaluate(() => { window.__toasts = []; const t = window.toast; window.toast = function (m) { window.__toasts.push(String(m)); try { return t.apply(this, arguments); } catch (e) { return null; } }; });

const drop = async (name, bytes, slot = null) => {
  await page.evaluate(async ([n, b64, s]) => {
    const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    window.__toasts = []; await window.handleFiles([new File([u], n)], s);
  }, [name, Buffer.from(bytes).toString('base64'), slot]);
  return page.evaluate(() => ({ toasts: window.__toasts.slice(), banner: (document.getElementById('vtBanner') || {}).innerText || '',
    receipt: (document.getElementById('vtReceiptCard') || {}).innerText || '', last: (window.__vtReceipts || [])[0] || null }));
};
const calls = (p) => W.log.filter((x) => x.p === p).length;
const dismiss = () => page.evaluate(() => { const b = document.getElementById('vtBanner'); if (b) b.remove(); const r = document.getElementById('vtReceiptCard'); if (r) r.remove(); window.__vtReceipts = []; });

try {
  const BI1 = xlsxBytes(biFile([{ cn: 90000001 }, { cn: 90000002, unit: 'BEAME', seller: 'Bravo Middle Tester' }, { cn: 90000009, unit: 'NOTVT' }, { cn: 90000010, seller: 'Nobody On The List' }]));
  head('S1 · a BI Active Fitted drop');
  resetWorker();
  const r1 = await drop('BI Active Fitted 091126.xlsx', BI1);
  ok(['/api/vt/uploads', '/api/vt/roster', '/api/vt/book', '/api/vt/upload/begin', '/api/vt/upload/stage', '/api/vt/upload/commit'].every((p) => calls(p) >= 1), 'receipts → roster → book → begin → stage → commit', W.log.map((x) => x.p).join(' '));
  ok(W.rev === 1 && Object.keys(W.cases).length === 3, 'the book holds the three VT cases at rev 1 (the non-VT line is not a case)', Object.keys(W.cases).join(','));
  ok(/VT · BI Active Fitted · BI Active Fitted 091126\.xlsx/.test(r1.receipt) && /Extract date 2026-11-09/.test(r1.receipt), 'the receipt names the kind, the file and the extract date', r1.receipt);
  ok(/VT lines 3 of 4 rows · cases 3/.test(r1.receipt) && /New 3 · to Fitted 3/.test(r1.receipt), 'the receipt counts VT lines of rows, cases and changes', r1.receipt);
  ok(/Sellers unmatched: nobody on the list \(1\)/.test(r1.receipt) && /VAS money unchanged/.test(r1.receipt), 'unmatched sellers by name, and "VAS money unchanged"', r1.receipt);
  ok(r1.toasts.some((t) => /loaded: 3 cases/.test(t)), 'a toast confirms it', r1.toasts.join(' | '));
  ok(W.log.find((x) => x.p === '/api/vt/book').body.p_also.length === 3, 'the merge read names the file\'s cases (p_also)');

  head('S1b · the commit publishes the VT digest (Phase E, E2)');
  await page.waitForFunction(() => window.VTPublish && window.VTPublish.state().last, null, { timeout: 30000 }).catch(() => {});
  const keys = W.kv.map((x) => x.key);
  ok(keys.includes('vt-digest') && keys.includes('vt-digest-cycle-2026-11') && !keys.some((k) => /^agent-/.test(k)), 'after the commit: kv:vt-digest and kv:vt-digest-cycle-2026-11 are posted — never a VAS key', keys.join(','));
  const pub = W.kv.length ? JSON.parse(W.kv[0].body) : {};
  ok(pub.scorecard === 'vt' && pub.period && pub.period.key === 'cycle-2026-11' && pub.period.from === '2026-10-26' && pub.period.to === '2026-11-25', 'the payload is the whole business month 26 Oct → 25 Nov', JSON.stringify(pub.period));
  ok(Array.isArray(pub.agents) && pub.agents.length === ROSTER_RPC.rows.length, 'one row per VT agent on the list in force', pub.agents && pub.agents.length);
  ok(await page.evaluate(() => !window.__vtDigestDirtySince && !!window.__vtDigestOk), 'acknowledged: the dirty flag is clear and the ack is stamped');

  head('S2 · no customer field leaves the browser');
  const sent = W.log.map((x) => x.raw).join('\n');
  ok(!PII.some((p) => sent.includes(p)), 'none of the fictional customer values appears in any request (' + W.log.length + ' requests)', PII.filter((p) => sent.includes(p)).join(','));

  head('S3 · the same bytes again');
  W.log = [];
  const r3 = await drop('copy of BI Active Fitted 091126.xlsx', BI1);   // the name keeps "Fitted": with no slot, the NAME says which BI file it is
  ok(r3.toasts.some((t) => /already uploaded/.test(t)) && calls('/api/vt/upload/begin') === 0, '"already uploaded", nothing begun', r3.toasts.join(' | '));

  head('S4 · thin BI pull');
  await dismiss(); W.log = [];
  W.uploads[0].counts.cases = 100;   // the last BI of this business month had 100 cases
  const r4 = await drop('BI Active Fitted 101126.xlsx', xlsxBytes(biFile([{ cn: 90000011 }, { cn: 90000012 }])));
  ok(/thin pull: 2 cases against 100/.test(r4.banner) && calls('/api/vt/upload/begin') === 0, 'refused as a thin pull with both counts, nothing begun', r4.banner);
  W.uploads[0].counts.cases = 3;

  head('S5 · thin S&M and the quiet-day tick');
  await dismiss(); resetWorker(); W.log = [];
  await drop('Scheduled & Missed 091126.xlsx', xlsxBytes(smFile(Array.from({ length: 10 }, (_, i) => ({ cn: 90000100 + i })))));
  const r5 = await drop('Scheduled & Missed 101126.xlsx', xlsxBytes(smFile([{ cn: 90000200 }, { cn: 90000201 }])));
  ok(/thin pull: 2 cases against 10/.test(r5.banner) && /genuine quiet day/.test(r5.banner), 'a thin S&M is refused, with the quiet-day button', r5.banner);
  const before = W.rev;
  await page.evaluate(() => window.VTStation.retryQuiet());
  await page.waitForFunction(() => (window.__vtReceipts || [])[0] && window.__vtReceipts[0].quietDay, null, { timeout: 20000 }).catch(() => {});
  const q = await page.evaluate(() => ({ r: (window.__vtReceipts || [])[0], t: (document.getElementById('vtReceiptCard') || {}).innerText || '' }));
  ok(W.rev === before + 1 && W.log.filter((x) => x.p === '/api/vt/upload/commit').pop().body.p_quiet_ack === true, 'after the tick it commits, and the tick is sent (logged on the receipt row)');
  ok(/genuine quiet day/.test(q.t), 'the receipt says it was accepted as a quiet day', q.t);

  head('S6 · version conflicts');
  await dismiss(); resetWorker({ conflicts: 1 }); W.log = [];
  const r6 = await drop('BI Active Fitted 091126.xlsx', BI1);
  ok(calls('/api/vt/book') === 2 && calls('/api/vt/upload/commit') === 2 && W.rev === 2, 'one conflict: re-read, re-merge, commit once', W.log.map((x) => x.p).join(' '));
  ok(r6.last && r6.last.attempts === 2 && (await page.evaluate(() => (window.__vtReceipts || []).length)) === 1, 'the user sees ONE receipt');
  await dismiss(); resetWorker({ conflicts: 3 }); W.log = [];
  const r6b = await drop('BI Active Fitted 091126.xlsx', BI1);
  ok(/kept changing/.test(r6b.banner) && !r6b.receipt && calls('/api/vt/upload/commit') === 3, 'three conflicts: a persistent red banner, no receipt', r6b.banner);
  ok(await page.evaluate(() => { const b = document.getElementById('vtBanner'); return !!b && getComputedStyle(b).position === 'fixed'; }), 'the banner stays on screen (not a toast)');

  head('S7 · the server unreachable');
  await dismiss(); resetWorker({ down: true });
  const r7 = await drop('BI Active Fitted 091126.xlsx', BI1);
  ok(/could not be reached, so nothing was saved/.test(r7.banner), 'a persistent banner says nothing was saved', r7.banner);

  head('S8 · the Schedulers Data upload (spec 072 B5)');
  await dismiss(); resetWorker(); W.log = [];
  const SCHROWS = [{ cn: 90000001, sold: '2026-11-03', gwp: 149, scheduler: 'Echo Foxtrot', campaign: 'Referral Agent', result: 'Cancelled' },
    { cn: 90000777, sold: '2026-09-15', gwp: 99, scheduler: 'Nobody On The List', result: 'Fitted' }];
  const OB = xlsxBytes({ 'Team Split': [['Team Leader', 'Agent Name', 'Sales Force'], ['Leader One', 'Alpha Test', 'Alpha Test']], 'Schedulers Data': schFile(SCHROWS) });
  const r8 = await drop('Master November 2026 - VT Report.xlsx', OB);
  ok(r8.banner.includes(ST.REFUSE_DATING_FIRST.slice(0, 60)) && calls('/api/vt/upload/begin') === 0, 'on an empty book it is refused in plain words', r8.banner);
  ok(ST.REFUSE_OPENING_FIRST === ST.REFUSE_DATING_FIRST, 'the retired slot name still answers (nothing that asked for it breaks)');
  ok(await page.evaluate(() => !(window.__mtd.state().roster || []).some((a) => a.code === 'CB9101')), 'its other sheets were not read as a VAS Agent List');
  await dismiss();
  await drop('BI Active Fitted 091126.xlsx', BI1);
  const statusBefore = W.cases['90000001'].status;
  const r8b = await drop('Master November 2026 - VT Report.xlsx', OB);
  const c1 = W.cases['90000001'];
  ok(c1.sold_on === '2026-11-03' && c1.sold_basis === 'schedulers_data' && W.openingBookOn, 'after the first day it applies the sheet sale date and stamps the book as dated', JSON.stringify(c1));
  ok(c1.scheduler_name === 'echo foxtrot' && Number(c1.gwp_rpt) === 149 && c1.campaign_rpt === 'Referral Agent' && c1.result_rpt === 'cancelled',
    'the scheduler, the GWP, the campaign and the typed Result are carried to the server', JSON.stringify(c1));
  ok(c1.scheduler_cb === null, 'this stub Agent List carries no Scheduling row, so the CB stays null and the name travels as typed', String(c1.scheduler_cb));
  ok(c1.status === statusBefore, 'the status did NOT move, though the sheet says Cancelled', c1.status + ' vs ' + statusBefore);
  ok(/Sale dates re-stated: 1/.test(r8b.receipt) && /Schedulers set: 1/.test(r8b.receipt) && /GWP set: 1/.test(r8b.receipt),
    'the receipt says in plain words what it changed: dates, schedulers, GWP', r8b.receipt);
  ok(/disagrees with the daily exports: 1/.test(r8b.receipt) && /never applied/.test(r8b.receipt), 'and that the disagreement was counted, never applied', r8b.receipt);
  ok(/not in the book yet: 1/.test(r8b.receipt) && /never invented/.test(r8b.receipt), 'and that the case it could not place was counted, never invented', r8b.receipt);
  ok(/Business months this file reaches: cycle-2026-11/.test(r8b.receipt), 'and which business months the file reaches (the back-build)', r8b.receipt);
  ok(/NOT changed by this file: no status/.test(r8b.receipt) && /no VAS figure/.test(r8b.receipt), 'and what it did NOT change', r8b.receipt);
  ok(/Schedulers not on the Agent List: echo foxtrot \(1\)/.test(r8b.receipt) && /never guessed/.test(r8b.receipt),
    'a scheduler the Agent List does not carry is named on the receipt with its case count, never guessed', r8b.receipt);
  ok(!W.log.map((x) => x.raw).join('\n').includes('0839999999'), 'the customer contact never leaves the browser');
  { /* re-uploadable (U-6): the same sheet with one more case lands again, and nothing else moves */
    const OB2 = xlsxBytes({ 'Schedulers Data': schFile(SCHROWS.concat([{ cn: 90000002, sold: '2026-11-04', gwp: 199, scheduler: 'Echo Foxtrot' }])) });
    const r8c = await drop('Master November 2026 - VT Report 251126.xlsx', OB2);
    ok(!r8c.banner && /Sale dates re-stated: 1/.test(r8c.receipt) && /unchanged 1/.test(r8c.receipt), 'the same file again is accepted and says what was unchanged', r8c.banner || r8c.receipt);
    const dup = xlsxBytes({ 'Schedulers Data': schFile(SCHROWS.concat([{ cn: 90000001, sold: '2026-11-05' }])) });
    const before = calls('/api/vt/upload/begin');
    const r8d = await drop('Master dup 251126.xlsx', dup);
    ok(/more than once/.test(r8d.banner) && calls('/api/vt/upload/begin') === before, 'a duplicate case number inside one file is refused in words and nothing is sent (A2)', r8d.banner);
    await dismiss(); }

  head('S9 · the roster (C7)');
  ok(!/read from this page/.test(r1.receipt), 'with /api/vt/roster answering, the receipt carries no fallback note');
  await dismiss(); resetWorker({ rosterFails: true });
  await page.evaluate(() => { window.__mtd.state().roster = [{ code: 'CB9101', name: 'Alpha Test', sf: 'Alpha Test', tl: 'Leader One', campaign: 'VT', tenure: 'Exp', target: 6.5, start: '2026-01-05' },
    { code: 'CB9150', name: 'Vas Person', tl: 'Leader One', campaign: 'Courtesy', tenure: 'Exp', target: 3 }]; });
  const r9 = await drop('BI Active Fitted 091126.xlsx', BI1);
  ok(/Agent List read from this page/.test(r9.receipt) && W.cases['90000001'].seller_cb === 'CB9101', 'the Worker roster failing → PULSE\'s VT rows are used and the receipt says so', r9.receipt);
  const fb = ST.rosterFromPulse([{ code: 'cb-9101', campaign: 'VT', target: '-' }, { code: 'CB9150', campaign: 'Courtesy' }]);
  ok(fb.length === 1 && fb[0].code === 'CB9101' && fb[0].sub === null && fb[0].target === null, 'rosterFromPulse: VT rows only, sub unknown, "-" target is no target', JSON.stringify(fb));
  const rr = ST.rosterFromRpc(ROSTER_RPC);
  ok(rr.map((r) => r.sub).join() === 'digital,referral' && rr[0].tlCode === 'CB9190', 'rosterFromRpc: the sub-campaign from the list\'s own cell, the TL\'s CB carried', JSON.stringify(rr[0]));

  head('S10 · the Upload Station');
  /* WAIT FOR THE SETTLED PAGE, NOT A FIXED PAUSE. The station's first paint starts the VT receipts read
     (VTPages.receiptsCardHtml) and, when it lands, re-renders the whole page — which puts renderPage's skeleton back for
     two frames. A fixed "two frames + 80 ms" read caught that skeleton whenever the read landed inside the window
     (~1 run in 3; proven by logging #view: the skeleton, and a second renderPage from vt-pages.js repaint). So wait for
     the state the check is about: the slot cards painted AND the receipts card past "Reading the receipts…" (after
     which nothing re-renders the page), then read in that same frame. */
  await page.evaluate(() => go('data'));
  const slots = await (await page.waitForFunction(() => {
    const vas = [...document.querySelectorAll('#view .slot[data-slot]')], vt = [...document.querySelectorAll('#view .slot[data-vtslot]')], rc = document.getElementById('vtReceipts');
    if (!vas.length || !vt.length || !rc || /Reading the receipts/.test(rc.innerText)) return false;
    return { vas: vas.map((c) => c.dataset.slot), vt: vt.map((c) => c.dataset.vtslot + ':' + c.querySelector('b').innerText) };
  }, null, { timeout: 30000 })).jsonValue();
  ok(slots.vas.join(',') === 'bi,attendance,evals,roster,inactive,vici,board,opencasesLM,closedcases,referrals', 'the ten VAS slot cards are unchanged, in order', slots.vas.join(','));
  ok(slots.vt.join(' | ') === 'vtBiFitted:VT · BI Active Fitted | vtSchedMissed:VT · Scheduled & Missed | vtSchedulers:VT · Schedulers Data', 'the three VT slots, in their own group, with Schedulers Data in place of the retired opening book', slots.vt.join(' | '));
  ok(!/Opening book \(once\)/.test(await page.evaluate(() => document.getElementById('view').innerText)), 'the retired Opening book slot is gone from the station');
  await dismiss(); resetWorker();
  const r10 = await drop('BI Active Fitted 091126.xlsx', BI1, 'bi');
  ok(r10.toasts.some((t) => /is the Vehicle Tracking file \(BI Active Fitted\)/.test(t) && /Nothing was loaded into VAS/.test(t)) && W.rev === 0 && calls('/api/vt/upload/begin') === 0,
    'a "Fitted" file dropped on the VAS BI slot is refused in words: neither VAS money nor a VT commit (rule book vt-1.3)', W.rev + ' ' + calls('/api/vt/upload/begin') + ' ' + r10.toasts.join(' | '));

  head('S11 · stage batches (unit)');
  const rows = Array.from({ length: 2500 }, (_, i) => ({ case_number: String(90000000 + i), seller_name: 'x'.repeat(i % 7 ? 20 : 400) }));
  const bs = ST.batches(rows);
  ok(bs.length >= 3 && bs.every((b) => b.rows.length <= 1000 && JSON.stringify(b.rows).length < 512 * 1024) && bs.reduce((n, b) => n + b.rows.length, 0) === 2500 && bs.every((b, i) => i === 0 || b.from === bs[i - 1].from + bs[i - 1].rows.length), '2,500 rows → batches of ≤ 1,000 rows under 512 KB, ords contiguous', bs.map((b) => b.rows.length).join(','));
  const fat = ST.batches(Array.from({ length: 900 }, () => ({ s: 'y'.repeat(1000) })));
  ok(fat.length >= 2 && fat.every((b) => JSON.stringify(b.rows).length < 512 * 1024), 'wide rows split by bytes before 1,000 rows', fat.map((b) => b.rows.length).join(','));

  head('S12 · the real BI Active Fitted (skipped when absent)');
  const REAL = path.join(ROOT, '..', 'reference', 'zips', 'vt', 'BI Active Fitted 101126.xlsx');
  if (!fs.existsSync(REAL)) console.log('  (skip) ../reference/zips/vt/BI Active Fitted 101126.xlsx is not here');
  else {
    await dismiss(); resetWorker(); W.log = [];
    const bytes = fs.readFileSync(REAL);
    const r12 = await drop('BI Active Fitted 101126.xlsx', bytes);
    ok(/VT lines 1,107 of 19,404 rows · cases 1,104/.test(r12.receipt.replace(/ /g, ',').replace(/(\d) (\d{3})/g, '$1,$2')), 'the receipt: VT lines 1,107 of 19,404 rows, cases 1,104 (spec US1-1)', r12.receipt.split('\n').slice(0, 3).join(' / '));
    ok(/Extract date 2026-11-10/.test(r12.receipt), 'extract date 10 Nov 2026 from the file name');
    const XLSX = req('xlsx'); const wb = XLSX.read(bytes); const aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null });
    const H = aoa[0].map((h) => String(h || '').trim().toLowerCase()), pii = new Set();
    for (const col of ['vehicle reg number', 'chassis number', 'box number', 'account name', 'account number', 'contract number']) { const i = H.indexOf(col);
      if (i > -1) for (const r of aoa.slice(1, 400)) if (r[i] != null && String(r[i]).trim().length >= 5) pii.add(String(r[i]).trim()); }
    const all = W.log.map((x) => x.raw).join('\n'), leaked = [...pii].filter((v) => all.includes(v)).length;
    ok(pii.size > 50 && leaked === 0, 'none of ' + pii.size + ' sampled registration / chassis / box / account / contract values is in any request (values not printed)', leaked + ' leaked');
  }
  head('S13 · the Upload Station inside Vehicle Tracking (VT mode)');
  await dismiss(); resetWorker();
  await page.evaluate(() => { window.__vtDigestOk = null; });
  await page.evaluate(() => { window.VTApp.go(true); go('data'); });
  const mode = await page.evaluate(() => ({ vt: window.VTApp.on(), tab: window.__mtd.state().ui.tab, search: location.search }));
  ok(mode.vt && mode.tab === 'data' && mode.search === '?app=vt&page=data', 'VT mode, on the Upload Station', JSON.stringify(mode));
  const r13 = await drop('BI Active Fitted 091126.xlsx', BI1);
  ok(W.rev === 1 && /VT · BI Active Fitted/.test(r13.receipt), 'the VT file is committed from VT mode, with its receipt', r13.receipt.split(String.fromCharCode(10))[0]);
  await page.waitForFunction(() => !!window.__vtDigestOk, null, { timeout: 30000 }).catch(() => {});
  ok(W.kv.some((x) => x.key === 'vt-digest') && !W.kv.some((x) => /^agent-/.test(x.key)), 'the commit publishes kv:vt-digest from VT mode — never a VAS key', W.kv.map((x) => x.key).join(','));
  ok(await page.evaluate(() => window.VTApp.on() && window.__mtd.state().ui.tab === 'data'), 'and the page stays in Vehicle Tracking');
  ok(!errs.length, 'no page errors', errs.join(' ; '));
} catch (e) { ok(false, 'the suite ran', String((e && e.stack) || e).slice(0, 400)); }
finally { await browser.close(); server.close(); }
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
