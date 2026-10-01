#!/usr/bin/env node
/**
 * verify-attendance-format.mjs — the HR attendance export in BOTH of its shapes, and an upload that
 * moves nothing is SAID, never silent (2026-10-01).
 *
 *   node nicks_code/diagnostics/verify-attendance-format.mjs
 *
 * THE REPORT (1 Oct): PULSE's Attendance slot read "behind — covers 2026-09-18, expected 2026-09-29
 * (11d short)" while a file was dropped every morning; the daily export grew from ~1.95 MB to ~2.10 MB
 * around 20–21 Sep, so it looked as if the file changed shape and PULSE stopped reading it.
 * WHAT THE ARCHIVED BYTES SAY: the header row, column order, delimiter, quoting, BOM, CRLF, ISO date
 * format, CB-code shape, Employee Type vocabulary and every Status CODE are unchanged. Two things did
 * change: (1) the 20 Sep export BACK-FILLED ~1,330 older employee-days (mostly T/P, Jun–Sep) — the
 * size jump; (2) from the 21 Sep evening export the long Status TEXT is reworded ("Comm Absence" →
 * "Communicated absence", "Resigned" → "Terminated — Resigned", "SUSP" → "Suspended", …). Neither
 * loses a row: PULSE keys on Status Code (spec §4), Ops keys on status_code. The register itself
 * ENDS on 18 Sep — after it the export carries only 1–2 leave rows a day filed ahead (one agent's
 * maternity leave), which since 2026-09-28 are rightly not register days. HR has not captured
 * 21–30 Sep. The defect was that nothing SAID so: the slot showed "behind" and no reason.
 *
 * Runs the REAL apps headlessly over synthetic fixtures (fake CBs and names — no real data):
 *   A. the fixtures and the source contract (header, BOM, CRLF, quoting are the real export's)
 *   B. PULSE reads both shapes: no row lost, codes not labels, new file wins per employee-day,
 *      forward-filed leave is not a register day
 *   C. NEVER SILENT (PULSE): the registry receipt, the slot, a toast that STAYS, rule check V27
 *   D. Ops reads both shapes; its Workforce anchor is the last REGISTER day; its load message says why
 *   E. the docs that describe the source (spec S8, upload-check skill) carry the same contract
 */
import fs from 'node:fs'; import path from 'node:path'; import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const PULSE_HTML = process.env.PULSE_HTML ? path.resolve(process.env.PULSE_HTML) : path.join(ROOT, 'nicks_code', 'index.html');
const OPS_HTML = process.env.OPS_HTML ? path.resolve(process.env.OPS_HTML) : path.join(ROOT, 'Chatterbox_AgentOS_Analytics.html');
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (d ? ' — ' + d : '')); } };
const J = JSON.stringify;

/* ------------------------------------------------------------------ fixtures ---- */
const HEAD = ['Date', 'Employee Code', 'Employee Name', 'Title', 'Employee Type', 'Department', 'Reports To', 'Status Code', 'Status'];
/* the long Status text, before and after the 21 Sep rewording — codes identical */
const LABEL_OLD = { P: 'Present', T: 'Training', AL: 'Annual Leave', SL: 'Sick Leave', CA: 'Comm Absence', UCA: 'Uncomm Absence', L: 'Running Late',
  SUSP: 'SUSP', Resigned: 'Resigned', ML: 'ML', Exit: 'Exit', WFH: 'Work From Home' };
const LABEL_NEW = { P: 'Present', T: 'Training', AL: 'Annual leave', SL: 'Sick leave', CA: 'Communicated absence', UCA: 'Uncommunicated absence', L: 'Late',
  SUSP: 'Suspended', Resigned: 'Terminated — Resigned', ML: 'Maternity Leave', Exit: 'Training exit', WFH: 'Work From Home' };
const AG = Array.from({ length: 20 }, (_, i) => 'CB99' + String(i + 1).padStart(2, '0'));   // CB9901..CB9920 — nobody real
const SS = ['CB9951', 'CB9952', 'CB9953'];                                                     // support staff — never stored by PULSE
const pad = (n) => String(n).padStart(2, '0');
const sep = (d) => '2026-09-' + pad(d), aug = (d) => '2026-08-' + pad(d);
const AUGW = [24, 25, 26, 27, 28].map(aug);
const SEPW_TO16 = [1, 2, 3, 4, 7, 8, 9, 10, 11, 14, 15, 16].map(sep);
const GAP_WORKING = ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-25', '2026-09-28', '2026-09-29', '2026-09-30'];   // 24 Sep is Heritage Day
const TAIL = [['2026-09-19', 'CB9910', 'ML'], ...['21', '22', '23', '24', '25', '26', '28', '29', '30'].map((d) => [sep(+d), 'CB9910', 'ML']),
  ['2026-09-21', 'CB9911', 'SL'], ['2026-09-22', 'CB9912', 'UCA']];   // 12 rows filed ahead, like the real export
function baseRows() {   // [date, code, statusCode, type]
  const rows = [];
  for (const d of [...AUGW, ...SEPW_TO16]) {
    for (const c of AG) {
      const n = +c.slice(-2);
      if ((n === 19 || n === 20) && d < sep(7)) continue;            // two late starters
      if (n === 4 && d > sep(10)) continue;                          // terminated on the 10th
      let st = 'P';
      if (n === 3 && d === sep(9)) st = 'AL';
      if (n === 4 && d === sep(10)) st = 'Resigned';
      if (n === 5 && d === sep(8)) st = 'CA';
      if (n === 6 && d >= sep(14)) st = 'SUSP';
      if (n === 7 && d === sep(2)) st = 'L';
      rows.push([d, c, st, 'Call Agent']);
    }
    for (const c of SS) rows.push([d, c, 'P', 'Support Staff']);
  }
  rows.push([sep(17), 'CB9908', 'AL', 'Call Agent'], [sep(18), 'CB9908', 'AL', 'Call Agent']);   // the 18 Sep export: one row each
  return rows;
}
function shapeB() {   // the 30 Sep export: back-fill + late fill-in + one correction + the forward-filed tail
  const rows = baseRows().map((r) => (r[1] === 'CB9905' && r[0] === sep(8) ? [r[0], r[1], 'SL', r[3]]
    : r[1] === 'CB9952' && r[0] === aug(26) ? [r[0], r[1], 'WFH', r[3]] : r));   // one row per employee-day, like the real export
  const has = new Set(rows.map((r) => r[0] + '|' + r[1]));
  for (const d of [sep(17), sep(18)]) for (const c of AG) { const n = +c.slice(-2); if (n === 4) continue;
    if (!has.has(d + '|' + c)) rows.push([d, c, n === 6 ? 'SUSP' : 'P', 'Call Agent']); }
  for (const c of ['CB9919', 'CB9920']) for (const d of [...AUGW, sep(1), sep(2), sep(3), sep(4)]) rows.push([d, c, 'T', 'Call Agent']);   // the back-fill
  for (const [d, c, st] of TAIL) rows.push([d, c, st, 'Call Agent']);
  return rows;
}
const csvCell = (v) => (/[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v);
function toCSV(rows, labels) {
  rows = [...rows].sort((a, b) => (a[0] + a[1] < b[0] + b[1] ? -1 : 1));
  const lines = [HEAD.join(',')];
  for (const [d, c, st, type] of rows) {
    const call = type === 'Call Agent';
    lines.push([d, c, 'Test Person ' + c.slice(2), call ? 'Matrix VAS Courtesy - Sales Agent' : 'QA Assessor', type,
      call ? 'Sales, VAS' : 'Quality', 'Leader Alpha', st, labels[st] || st].map(csvCell).join(','));
  }
  return '﻿' + lines.join('\r\n');   // BOM, CRLF, no trailing newline — exactly the real export
}
const ROWS_A = baseRows(), ROWS_B = shapeB();
const TEXT_A = toCSV(ROWS_A, LABEL_OLD), TEXT_B = toCSV(ROWS_B, LABEL_NEW);
/* C: the register completed through the 30th (the file HR still owes); D: a partial pull over the same span */
const ROWS_C = [...ROWS_B.filter((r) => !TAIL.some((t) => t[0] === r[0] && t[1] === r[1]))];
for (const d of GAP_WORKING) for (const c of AG) { const n = +c.slice(-2); if (n === 4) continue;
  ROWS_C.push([d, c, n === 10 ? 'ML' : n === 6 ? 'SUSP' : 'P', 'Call Agent']); }
ROWS_C.push(['2026-09-19', 'CB9910', 'ML', 'Call Agent'], ['2026-09-26', 'CB9910', 'ML', 'Call Agent'], ['2026-09-24', 'CB9910', 'ML', 'Call Agent']);
const TEXT_C = toCSV(ROWS_C, LABEL_NEW);
const ROWS_D = ROWS_C.filter((r) => ['CB9901', 'CB9902', 'CB9903'].includes(r[1])).map((r) => (r[1] === 'CB9901' && r[0] === sep(1) ? [r[0], r[1], 'L', r[3]] : r));
const TEXT_D = toCSV(ROWS_D, LABEL_NEW);
const NAME_A = 'attendance_2025-10-01_to_2026-09-18.csv', NAME_B = 'attendance_2025-10-01_to_2026-09-30.csv';
const NAME_C = 'attendance_2025-10-01_to_2026-09-30 complete.csv', NAME_C2 = 'attendance_2025-10-01_to_2026-09-30 (1).csv', NAME_D = 'attendance_2025-10-01_to_2026-09-30 (2).csv';
const callAgentKeys = (rows) => new Set(rows.filter((r) => r[3] === 'Call Agent').map((r) => r[0] + '|' + r[1]));
const codeOf = (rows) => Object.fromEntries(rows.filter((r) => r[3] === 'Call Agent').map((r) => [r[0] + '|' + r[1], r[2]]));

/* ------------------------------------------------------------------ A. fixtures + contract ---- */
console.log('\nA · THE FIXTURES ARE THE REAL EXPORT\'S SHAPE; THE CONTRACT IS ONE HEADER');
const firstLine = (t) => t.replace(/^﻿/, '').split('\r\n')[0];
ok('both shapes carry the identical 9-column header', firstLine(TEXT_A) === HEAD.join(',') && firstLine(TEXT_B) === HEAD.join(','), J([firstLine(TEXT_A), firstLine(TEXT_B)]));
ok('both start with a UTF-8 BOM, use CRLF, quote the Department, end without a newline',
  [TEXT_A, TEXT_B].every((t) => t.charCodeAt(0) === 0xfeff && t.includes('\r\n') && t.includes('"Sales, VAS"') && !/\r?\n$/.test(t)));
ok('the shapes differ in the Status TEXT only — codes, columns and dates are the same vocabulary',
  TEXT_A.includes(',Resigned,Resigned') && TEXT_B.includes(',Resigned,Terminated — Resigned') && TEXT_A.includes(',CA,Comm Absence')
    && TEXT_B.includes(',SL,Sick leave') && TEXT_B.includes(',SUSP,Suspended') && TEXT_A.includes(',SUSP,SUSP'));
ok('shape B carries the forward-filed tail (12 rows on 19–30 Sep, nobody at work)', ROWS_B.filter((r) => r[0] > sep(18)).length === 12);
ok('one row per employee-day in every fixture, like the real export (19,569 keys for 19,569 rows)',
  [ROWS_A, ROWS_B, ROWS_C, ROWS_D].every((rs) => new Set(rs.map((r) => r[0] + '|' + r[1])).size === rs.length));
const OPS = fs.readFileSync(OPS_HTML, 'utf8');
const opsAtt = (() => { const i = OPS.indexOf('ATTENDANCE:{label:'); return OPS.slice(i, OPS.indexOf('purpose:', i)); })();
ok('Ops SOURCES.ATTENDANCE names exactly the export\'s 9 columns', opsAtt.includes("headers:['" + HEAD.join("','") + "']"), opsAtt.slice(0, 260));
ok('Ops requires Date, Employee Code, Status Code (the label text is never required)', opsAtt.includes("required:['Date','Employee Code','Status Code']"));

/* ------------------------------------------------------------------ browser harness ---- */
const SIDE = { '/xlsx.full.min.js': path.join(ROOT, 'site', 'xlsx.full.min.js') };
const serve = (html, port) => { const s = http.createServer((q, r) => { const u = q.url.split('?')[0];
  const p = SIDE[u] || ((u === '/' || u === '/index.html') ? html : null);
  if (!p || !fs.existsSync(p)) { r.writeHead(404); r.end(); return; }
  r.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' }); fs.createReadStream(p).pipe(r); });
  return new Promise((res) => s.listen(port, '127.0.0.1', () => res(s))); };
const sPulse = await serve(PULSE_HTML, 8276), sOps = await serve(OPS_HTML, 8277);
const { chromium } = await import(pathToFileURL(path.join(HERE, 'node_modules', 'playwright', 'index.mjs')).href);
const b = await chromium.launch();
try {
  /* ------------------------------------------------------------------ B. PULSE reads both ---- */
  console.log('\nB · PULSE READS BOTH SHAPES — NO ROW LOST, CODES NOT LABELS');
  const page = await b.newPage();
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());   // never the Worker, never the cloud
  const errs = []; page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
  await page.goto('http://127.0.0.1:8276/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__mtd && window.__mtd.state(), null, { timeout: 30000 });
  const P = await page.evaluate(async ({ AG, TEXT_A, TEXT_B, TEXT_C, TEXT_D, NAME_A, NAME_B, NAME_C, NAME_C2, NAME_D, GAP_WORKING }) => {
    const S = window.__mtd.state();
    const reset = () => { S.att = {}; S.files = []; S.sales = {}; S.calls = {}; S.callsMeta = {}; S.tracker = {}; S.orgHist = {};
      S.roster = AG.map((c) => ({ code: c, name: 'Test Person ' + c.slice(2), sf: 'Test Person ' + c.slice(2), tl: 'Leader Alpha', campaign: 'Cuddle', tenure: 'Exp', target: 8, start: '2026-01-01' })); };
    /* hermetic: no cloud save from this page (a tab with no session toasts "Not signed in" over
       everything — the save path has its own suites: verify-save-acks, verify-live-save) */
    window.__cloudPush = function () {};
    const toasts = []; const tEl = document.getElementById('toast');
    new MutationObserver(() => { if (tEl.textContent) toasts.push(tEl.textContent); }).observe(tEl, { childList: true, characterData: true, subtree: true });
    const ingest = async (name, text) => { const ok = await window.__mtd.ingest(name, text, 'attendance', 'h-' + name); return ok; };
    const paint = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 0))));   // renderPage paints two frames later
    const slotNow = async () => { S.ui.tab = 'data'; renderAll(); await paint(); return document.querySelector('.slot[data-slot="attendance"]'); };
    const snap = () => { const o = {}; for (const d in S.att) for (const c in S.att[d]) o[d + '|' + c] = S.att[d][c]; return o; };
    const entry = (name) => { const e = S.files.find((f) => f.name === name && f.type === 'attendance'); return e ? { rows: e.rows, nonAgent: e.nonAgent, warn: e.warn || null, warnSev: e.warnSev || null, att: e.att || null } : null; };
    const maxDay = () => { const ks = Object.keys(S.att).sort(); return ks[ks.length - 1] || null; };
    const out = {};
    reset(); out.okA = await ingest(NAME_A, TEXT_A); out.attA = snap(); out.maxA = maxDay(); out.lastA = attLastDay(); out.entA = entry(NAME_A);
    reset(); out.okB = await ingest(NAME_B, TEXT_B); out.attB = snap(); out.maxB = maxDay(); out.lastB = attLastDay(); out.entB = entry(NAME_B);
    reset(); await ingest(NAME_A, TEXT_A); toasts.length = 0;
    /* B arrives the way a person drops it: through handleFiles, whose closing "1 file loaded" toast
       used to paint over every per-file warning a moment after it was raised */
    await handleFiles([new File([TEXT_B], NAME_B, { type: 'text/csv' })], 'attendance');
    out.attAB = snap(); out.entAB = entry(NAME_B); out.lastAB = attLastDay();
    out.toastsAB = toasts.slice();
    /* a warning toast must still be on screen seconds later (a toast(msg,'err',ms) call used to vanish at once) */
    await new Promise((r) => setTimeout(r, 3200));
    out.toastStillShown = tEl.classList.contains('show') && /loaded/.test(tEl.textContent) && /register stops at 2026-09-18/.test(tEl.textContent);
    /* the slot, rendered the way a person sees it */
    const slot = await slotNow();
    out.slotAB = slot ? { text: slot.innerText, crit: !!slot.querySelector('.pcrit'), warnPill: !!slot.querySelector('.att-upload-warn') } : null;
    /* rule check V27: the dialler reaches the 30th, the register the 18th */
    const days = []; for (let d = 1; d <= 30; d++) { const k = '2026-09-' + String(d).padStart(2, '0'); const wd = new Date(k + 'T00:00:00Z').getUTCDay(); if (wd !== 0) days.push(k); }
    for (const d of days) { S.calls[d] = {}; for (const c of AG) S.calls[d][c] = { talk: 3600, calls: 30, ans: 15, opt: 0, saleD: 0, v: 1 }; S.callsMeta[d] = { n: 600, f: 'vici-test.txt' }; }
    window.__mtd.setPeriod('2026-09', 'month');
    out.v27gap = (window.__mtd.checks() || []).find((c) => c.id === 'V27') || null;
    /* the register completed: no warning, the slot clears, V27 passes */
    toasts.length = 0; await ingest(NAME_C, TEXT_C); out.entC = entry(NAME_C); out.lastC = attLastDay();
    window.__mtd.setPeriod('2026-09', 'month');
    out.v27full = (window.__mtd.checks() || []).find((c) => c.id === 'V27') || null;
    { const s2 = await slotNow(); out.slotC = s2 ? { text: s2.innerText, warnPill: !!s2.querySelector('.att-upload-warn') } : null; }
    /* the same register again under a new name: nothing new — said, in red */
    await ingest(NAME_C2, TEXT_C); out.entC2 = entry(NAME_C2);
    { const s3 = await slotNow(); out.slotC2 = s3 ? { text: s3.innerText, crit: !!s3.querySelector('.att-upload-warn.pcrit') } : null; }
    /* a partial pull over the same span: far fewer rows than the file before it */
    await ingest(NAME_D, TEXT_D); out.entD = entry(NAME_D);
    out.attAfterD = snap();
    /* every surviving warning toast this build raises passes a kind AND a duration — the toast must honour both */
    toast('probe', 'err', 20000); await new Promise((r) => setTimeout(r, 1500)); out.errToastStays = tEl.classList.contains('show') && tEl.textContent === 'probe';
    return out;
  }, { AG, TEXT_A, TEXT_B, TEXT_C, TEXT_D, NAME_A, NAME_B, NAME_C, NAME_C2, NAME_D, GAP_WORKING });

  const keysA = callAgentKeys(ROWS_A), keysB = callAgentKeys(ROWS_B), codesA = codeOf(ROWS_A), codesB = codeOf(ROWS_B);
  ok('the old shape loads as attendance', P.okA === true && !!P.entA, J(P.entA));
  ok('the new shape loads as attendance', P.okB === true && !!P.entB, J(P.entB));
  ok('old shape: every Call Agent employee-day is stored (' + keysA.size + ')', Object.keys(P.attA).length === keysA.size && [...keysA].every((k) => k in P.attA), Object.keys(P.attA).length + ' stored');
  ok('new shape: every Call Agent employee-day is stored (' + keysB.size + ')', Object.keys(P.attB).length === keysB.size && [...keysB].every((k) => k in P.attB), Object.keys(P.attB).length + ' stored');
  ok('support staff are excluded and counted, both shapes', P.entA && P.entA.nonAgent === ROWS_A.filter((r) => r[3] !== 'Call Agent').length
    && P.entB && P.entB.nonAgent === ROWS_B.filter((r) => r[3] !== 'Call Agent').length, J([P.entA && P.entA.nonAgent, P.entB && P.entB.nonAgent]));
  ok('old shape stores the Status CODE, never the label', Object.entries(codesA).every(([k, v]) => P.attA[k] === v));
  ok('new shape stores the Status CODE, never the reworded label ("Terminated — Resigned" is stored as Resigned)', Object.entries(codesB).every(([k, v]) => P.attB[k] === v) && P.attB['2026-09-10|CB9904'] === 'Resigned');
  ok('the dates read are the file\'s own: old to 18 Sep, new to 30 Sep', P.maxA === '2026-09-18' && P.maxB === '2026-09-30', J([P.maxA, P.maxB]));
  ok('forward-filed leave is not a register day: old reaches 16 Sep, new 18 Sep (the 28 Sep rule)', P.lastA === '2026-09-16' && P.lastB === '2026-09-18', J([P.lastA, P.lastB]));
  ok('old then new: the new file wins per employee-day (CA corrected to SL) and nothing is lost',
    P.attAB['2026-09-08|CB9905'] === 'SL' && Object.keys(P.attAB).length === new Set([...keysA, ...keysB]).size, J([P.attAB['2026-09-08|CB9905'], Object.keys(P.attAB).length]));

  /* ------------------------------------------------------------------ C. never silent ---- */
  console.log('\nC · NEVER SILENT — AN UPLOAD THAT DOES NOT MOVE THE REGISTER SAYS WHY');
  const w = P.entAB || {};
  ok('the receipt carries what the upload did (new employee-days, corrections, register end)', !!w.att && w.att.added > 0 && w.att.changed === 1 && w.att.regEnd === '2026-09-18', J(w.att));
  ok('the receipt counts the 7 working days after the register end and the 12 rows filed ahead', !!w.att && w.att.gapDays === 7 && w.att.gapRows === 12, J(w.att));
  ok('the receipt carries a warning that names the register end and the gap', !!w.warn && /2026-09-18/.test(w.warn) && /7 working day/.test(w.warn) && /12 row/.test(w.warn), w.warn);
  ok('the warning says it is the REGISTER (HR) that has not captured the days, not the parser', !!w.warn && /HR/.test(w.warn) && /not .*captured|has not captured/i.test(w.warn), w.warn);
  ok('a toast named the file and the register end at upload time', P.toastsAB.some((t) => t.includes(NAME_B) && /2026-09-18/.test(t)), J(P.toastsAB.map((t) => t.slice(0, 120))));
  ok('that toast is still on screen 3 s later', P.toastStillShown === true);
  ok('toast(msg,\'err\',ms) honours the duration (the thin-dialler and lake warnings used to vanish at once)', P.errToastStays === true);
  ok('the Attendance slot shows the warning, naming the file', !!P.slotAB && P.slotAB.warnPill && P.slotAB.text.includes(NAME_B) && /2026-09-18/.test(P.slotAB.text), P.slotAB && P.slotAB.text.slice(0, 400));
  ok('rule check V27 is a WARNING and fails while the dialler reaches past the register', !!P.v27gap && P.v27gap.sev === 'warn' && P.v27gap.ok === false
    && /2026-09-18/.test(P.v27gap.msg) && /7 working day/.test(P.v27gap.msg), J(P.v27gap));
  ok('a register completed through its own end raises nothing', !!P.entC && !P.entC.warn && P.lastC === '2026-09-30', J([P.entC, P.lastC]));
  ok('…the slot clears its warning', !!P.slotC && !P.slotC.warnPill, P.slotC && P.slotC.text.slice(0, 300));
  ok('…and V27 passes', !!P.v27full && P.v27full.ok === true, J(P.v27full));
  ok('the same register under a new name: "added nothing" in red', !!P.entC2 && P.entC2.att && P.entC2.att.added === 0 && P.entC2.att.changed === 0
    && P.entC2.warnSev === 'crit' && /added no new employee-day/i.test(P.entC2.warn || ''), J(P.entC2));
  ok('…and the slot shows it in red, naming that file', !!P.slotC2 && P.slotC2.crit && P.slotC2.text.includes(NAME_C2), P.slotC2 && P.slotC2.text.slice(0, 300));
  ok('a partial pull over the same span: "far fewer rows" than the file before it, in red', !!P.entD && P.entD.warnSev === 'crit' && /far fewer rows/i.test(P.entD.warn || '')
    && (P.entD.warn || '').includes(NAME_C2), J(P.entD));
  ok('the partial pull still never deletes a stored day (new file wins only where it speaks)', Object.keys(P.attAfterD).length >= callAgentKeys(ROWS_C).size, Object.keys(P.attAfterD).length + '');
  ok('no page errors in PULSE', errs.length === 0, errs.join(' | '));

  /* ------------------------------------------------------------------ D. Ops ---- */
  console.log('\nD · OPS READS BOTH SHAPES; ITS WORKFORCE ANCHOR IS THE LAST REGISTER DAY');
  const op = await b.newPage();
  /* Ops lazy-loads its readers from cdnjs: XLSX is served from the local copy, PapaParse may pass
     (public library, as verify-upload-formats does); nothing else leaves the machine */
  await op.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
    const u = r.request().url();
    if (/cdnjs\.cloudflare\.com\/ajax\/libs\/xlsx\//.test(u)) return r.fulfill({ path: SIDE['/xlsx.full.min.js'], contentType: 'text/javascript' });
    if (/cdnjs\.cloudflare\.com\/ajax\/libs\/PapaParse\//.test(u)) return r.continue();
    return r.abort();
  });
  const oerrs = []; op.on('pageerror', (e) => oerrs.push(String(e.message).slice(0, 160)));
  await op.goto('http://127.0.0.1:8277/', { waitUntil: 'domcontentloaded' });
  await op.waitForFunction(() => typeof readUpload === 'function' && typeof applyLoad === 'function' && typeof state === 'object', null, { timeout: 30000 });
  const O = await op.evaluate(async ({ AG, TEXT_A, TEXT_B, NAME_A, NAME_B }) => {
    const reset = () => { state.facts.ATTENDANCE = []; state.batches = []; state.cbInfo = {};
      for (const c of AG) state.cbInfo[c] = { name: 'Test Person ' + c.slice(2), code: c, tl: 'Leader Alpha', queue: 'Cuddle', tenure: 'Exp', target: 8 };
      bumpDataVer(); };
    const load = async (name, text) => { const f = new File([text], name, { type: 'text/csv' }); const parsed = await readUpload(f, 'ATTENDANCE');
      const src = detectSource(parsed); const res = applyLoad('ATTENDANCE', f, parsed); return { src, res, msg: loadMsg('ATTENDANCE', res), parsed: parsed.data.length }; };
    const keyed = () => { const o = {}; for (const r of state.facts.ATTENDANCE) o[r._d + '|' + normCB(r.employee_code)] = r.status_code; return o; };
    const anchor = () => (typeof attAnchorDay === 'function' ? attAnchorDay() : null);
    const maxRow = () => state.facts.ATTENDANCE.reduce((m, r) => (r._d > m ? r._d : m), '');
    const out = {};
    reset(); { const a = await load(NAME_A, TEXT_A); out.A = { src: a.src, loaded: a.res.loaded, rejects: a.res.rejects, parsed: a.parsed }; out.keyA = keyed(); }
    reset(); { const bb = await load(NAME_B, TEXT_B); out.B = { src: bb.src, loaded: bb.res.loaded, rejects: bb.res.rejects, parsed: bb.parsed }; out.keyB = keyed(); }
    reset(); await load(NAME_A, TEXT_A); out.anchorA = anchor();
    { const bb = await load(NAME_B, TEXT_B); out.msgAB = bb.msg; out.noteAB = bb.res.batch.register_note || null; }
    out.keyAB = keyed(); out.anchorAB = anchor(); out.maxRowAB = maxRow();
    /* the Workforce page renders with the register's own week, not a week of one leave row */
    let html = ''; try { html = pageWF({ from: '2026-09-01', to: '2026-09-30' }); } catch (e) { html = 'ERR ' + e.message; }
    out.wfOk = !/^ERR/.test(html);
    return out;
  }, { AG, TEXT_A, TEXT_B, NAME_A, NAME_B });
  ok('Ops detects both shapes as ATTENDANCE', O.A.src === 'ATTENDANCE' && O.B.src === 'ATTENDANCE', J([O.A.src, O.B.src]));
  ok('Ops loads every row of both shapes, no rejects', O.A.loaded === ROWS_A.length && O.A.rejects === 0 && O.B.loaded === ROWS_B.length && O.B.rejects === 0, J([O.A, O.B]));
  ok('Ops stores the Status CODE in both shapes (classification never reads the reworded label)',
    Object.entries(codeOf(ROWS_A)).every(([k, v]) => O.keyA[k] === v) && Object.entries(codeOf(ROWS_B)).every(([k, v]) => O.keyB[k] === v));
  ok('Ops: old then new — the new file wins per employee-day', O.keyAB['2026-09-08|CB9905'] === 'SL', O.keyAB['2026-09-08|CB9905']);
  ok('Ops reads the forward-filed rows (its newest row is the 30th)…', O.maxRowAB === '2026-09-30', O.maxRowAB);
  ok('…but anchors Workforce weeks on the last REGISTER day (18 Sep), not on a leave row filed ahead', O.anchorAB === '2026-09-18' && O.anchorA === '2026-09-16', J([O.anchorA, O.anchorAB]));
  /* Ops has no holiday calendar (PULSE and Agent Analytics own the computed one), so its note names
     the dates and the rows filed ahead rather than a count of working days */
  ok('Ops\' load message says the register stops at 18 Sep, the file runs to the 30th, and 12 rows after are filed ahead',
    !!O.noteAB && /2026-09-18/.test(O.noteAB) && /2026-09-30/.test(O.noteAB) && /12 row/.test(O.noteAB) && O.msgAB.includes(O.noteAB), J([O.noteAB, O.msgAB]));
  ok('the Workforce page still renders', O.wfOk === true);
  ok('no page errors in Ops', oerrs.length === 0, oerrs.join(' | '));
} finally { await b.close(); sPulse.close(); sOps.close(); }

/* ------------------------------------------------------------------ E. the docs ---- */
console.log('\nE · THE SOURCE CONTRACT IS WRITTEN DOWN WHERE THE NEXT PERSON LOOKS');
const SPEC = fs.readFileSync(path.join(ROOT, 'specs', 'AgentOS-v3.8-upload-frameworks.md'), 'utf8');
const s8 = SPEC.split('\n').find((l) => l.startsWith('| S8 | ATTENDANCE')) || '';
ok('spec S8 says Status Code is canonical and the label text was reworded on 21 Sep 2026', /Status Code/.test(s8) && /canonical/i.test(s8) && /2026-09-21/.test(s8), s8.slice(0, 200));
ok('spec S8 says forward-filed leave rows are not register days and an upload that does not move the register is said (V27)', /filed ahead/i.test(s8) && /V27/.test(s8), s8.slice(0, 300));
const SKILL = fs.readFileSync(path.join(ROOT, '.claude', 'skills', 'upload-check', 'SKILL.md'), 'utf8');
ok('the upload-check skill checks the register end against the file\'s own end', /ATTENDANCE[^\n]*register/i.test(SKILL) && /filed ahead/i.test(SKILL), '');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
