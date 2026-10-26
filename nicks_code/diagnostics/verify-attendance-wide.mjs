#!/usr/bin/env node
/**
 * verify-attendance-wide.mjs — the MONTHLY attendance register (HR's new format, October 2026) loads in both apps and
 * matches people on their CB, exactly as the daily export did (2026-10-26).
 *
 *   node nicks_code/diagnostics/verify-attendance-wide.mjs
 *
 * THE REPORT (Nick, 26 Oct): "for the attendance upload in the upload station, I gave you the new format … its called
 * attendance register october, please match the agents correctly". The file is one row per person and one column per
 * day ("Thu 1" … "Sat 31", Sundays absent), the month only in the file name, and no Date / Status Code / Employee Type
 * column. PULSE sent it to the attendance parser (its "Start Date" satisfies the date sniff), which read no Date and
 * stored nothing; Ops required a Date column and refused it.
 *
 * Runs the REAL apps headlessly over synthetic fixtures (fake CBs and names — no real data):
 *   A. one WIDE-REGISTER block, byte-identical in PULSE and Ops
 *   B. the block on its own: month from the name, weekdays must agree, inferred month, blanks skipped, the
 *      Call Agent / Support Staff split reproduces the daily export's (every title the real register uses)
 *   C. PULSE stores every agent-day by CB with its Status Code, excludes support staff, refuses a mis-named month loudly
 *   D. Ops detects it as ATTENDANCE and loads every captured cell, refuses a mis-named month loudly
 *   E. the old daily export is untouched (verify-attendance-format.mjs still runs green — run it alongside)
 */
import fs from 'node:fs'; import path from 'node:path'; import http from 'node:http'; import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const PULSE_HTML = path.join(ROOT, 'nicks_code', 'index.html');
const OPS_HTML = path.join(ROOT, 'Chatterbox_AgentOS_Analytics.html');
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (d ? ' — ' + d : '')); } };
const J = JSON.stringify;

/* ------------------------------------------------------------------ fixtures ---- */
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYS = []; for (let d = 1; d <= 31; d++) { const wd = new Date(Date.UTC(2026, 9, d)).getUTCDay(); if (wd) DAYS.push({ d, h: WD[wd] + ' ' + d }); }
const HEAD = ['Department', 'Division', 'Employee Title', 'Employee Name', 'Employee Code', 'Reports To', 'Start Date', 'Employee Status', 'Email Address', ...DAYS.map((x) => x.h)];
/* titles and departments are the real register's vocabulary; people and CBs are invented */
const PEOPLE = [
  ['Sales', 'Matrix VAS', 'Matrix VAS Courtesy - Sales Agent', 'CB9901', 'agent'],
  ['Sales', 'Matrix VAS', 'Matrix VAS Cuddles - Sales Agent', 'CB9902', 'agent'],
  ['Sales', 'Matrix VAS', 'Matrix VAS Cuddle Sales Agent', 'CB9903', 'agent'],
  ['Sales', 'Matrix Vehicle Tracking', 'Matrix Vehicle Tracking Predictive - Sales Agent', 'CB9904', 'agent'],
  ['Sales', 'Matrix Vehicle Tracking', 'Matrix Vehicle Tracking - Scheduling Agent', 'CB9905', 'agent'],
  ['Training', 'Matrix Vehicle Tracking - Training Gr 7', 'Trainee', 'CB9906', 'agent'],
  ['Sales', 'Matrix VAS', 'Matrix VAS Courtesy - Sales Agent', 'CB9907', 'agent'],   // a new starter HR has not filled in: every cell blank
  ['Sales', 'Matrix VAS', 'Matrix VAS Team Leader', 'CB9951', 'support'],
  ['Sales', 'Sales Support', 'Campaign Manager', 'CB9952', 'support'],
  ['QA', 'QA', 'QA Agent', 'CB9953', 'support'],
  ['L&D', 'L&D', 'Assistant Sales Coach', 'CB9954', 'support'],
  ['IT', 'IT', 'Dialler Administrator', 'CB9955', 'support'],
];
const cellFor = (cb, d) => {   // captured to Fri 23 Oct; one leave row filed ahead; Saturdays mostly blank
  const wd = new Date(Date.UTC(2026, 9, d)).getUTCDay();
  if (cb === 'CB9907') return '';
  if (cb === 'CB9902' && d === 28) return 'AL';
  if (cb === 'CB9903' && d === 26) return 'AL';   // filed ahead ON the upload day, like the real 26 Oct file
  if (d > 23) return '';
  if (wd === 6) return cb === 'CB9901' ? 'P' : '';
  if (cb === 'CB9903' && d === 7) return 'SL';
  if (cb === 'CB9904' && d === 12) return 'UCA';
  if (cb === 'CB9905' && d >= 19) return 'SUSP';
  if (cb === 'CB9906' && d === 2) return 'HDCA';
  return 'P';
};
const q = (v) => '"' + String(v).replace(/"/g, '""') + '"';
const ROWS = PEOPLE.map(([dep, div, title, cb]) => [dep, div, title, 'Test Person ' + cb.slice(2), cb, 'Leader Alpha', '2025-01-06', 'Active', 'test' + cb.slice(2) + '@example.invalid', ...DAYS.map((x) => cellFor(cb, x.d))]);
const TEXT = '﻿' + [HEAD, ...ROWS].map((r) => r.map(q).join(',')).join('\r\n') + '\r\n';
const NAME = 'Attendance Register October 2026.csv', NAME_BAD = 'Attendance Register November 2026.csv', NAME_NONE = 'register.csv';
const expected = {}; for (const [, , , cb, kind] of PEOPLE) for (const x of DAYS) { const v = cellFor(cb, x.d); if (v) expected['2026-10-' + String(x.d).padStart(2, '0') + '|' + cb] = { v, kind }; }
const agentKeys = Object.keys(expected).filter((k) => expected[k].kind === 'agent');
const supportCells = Object.keys(expected).length - agentKeys.length;

/* ------------------------------------------------------------------ A. one block ---- */
console.log('\nA · ONE WIDE-REGISTER BLOCK, IDENTICAL IN PULSE AND OPS');
/* line endings are not code: a git checkout on Windows writes CRLF into one copy and not the other */
const block = (t) => { const a = t.indexOf('/* WIDE-REGISTER:BEGIN'), e = t.indexOf('/* WIDE-REGISTER:END */'); return a >= 0 && e > a ? t.slice(a, e).replace(/\r\n/g, '\n') : null; };
const P_SRC = fs.readFileSync(PULSE_HTML, 'utf8'), O_SRC = fs.readFileSync(OPS_HTML, 'utf8');
const bP = block(P_SRC), bO = block(O_SRC);
ok('PULSE carries the block', !!bP);
ok('Ops carries the block', !!bO);
ok('the two are byte-identical', bP && bP === bO, bP && bO ? 'lengths ' + bP.length + ' / ' + bO.length : '');
ok('PULSE converts before detectType, Ops at the end of readUpload',
  /isWideRegister\(header\)[\s\S]{0,1200}let type=detectType\(header/.test(P_SRC) && /isWideRegister\(headers\)[\s\S]{0,1200}resolve\(\{headers,data/.test(O_SRC));

/* ------------------------------------------------------------------ B. the block alone ---- */
console.log('\nB · THE BLOCK ON ITS OWN');
const ctx = {}; vm.createContext(ctx); vm.runInContext(bP + '\nthis.W={isWideRegister,wideRegisterToLong,wideRegisterMonth,wideRegisterDays};', ctx);
const W = ctx.W, TODAY = new Date(Date.UTC(2026, 9, 26));
const recs = ROWS.map((r) => Object.fromEntries(HEAD.map((h, i) => [h, r[i]])));
ok('the real header is recognised as the wide register (27 day columns)', W.isWideRegister(HEAD) && W.wideRegisterDays(HEAD).length === 27);
ok('the daily export is NOT (it has a Date column)', !W.isWideRegister(['Date', 'Employee Code', 'Employee Name', 'Title', 'Employee Type', 'Department', 'Reports To', 'Status Code', 'Status']));
const w = W.wideRegisterToLong(HEAD, recs, NAME, TODAY);
ok('the month comes from the name: 2026-10, not inferred', w.month === '2026-10' && w.inferred === false, J([w.month, w.inferred, w.error]));
ok('one long row per CAPTURED cell — blanks skipped (' + Object.keys(expected).length + ')', w.rows && w.rows.length === Object.keys(expected).length, w.rows && w.rows.length);
ok('dates and codes are the cells\' own (Thu 1 → 2026-10-01, Sat 3 → 2026-10-03, the forward-filed AL on the 28th)',
  w.rows.every((r) => expected[r['Date'] + '|' + r['Employee Code']] && expected[r['Date'] + '|' + r['Employee Code']].v === r['Status Code'])
    && w.rows.some((r) => r['Date'] === '2026-10-03' && r['Employee Code'] === 'CB9901') && w.rows.some((r) => r['Date'] === '2026-10-28' && r['Status Code'] === 'AL'));
const typeOf = Object.fromEntries(w.rows.map((r) => [r['Employee Code'], r['Employee Type']]));
ok('agents and trainees are Call Agents; TLs, CMs, QA agents, coaches, IT are Support Staff',
  PEOPLE.filter(([, , , cb]) => cb !== 'CB9907').every(([, , , cb, kind]) => typeOf[cb] ===(kind === 'agent' ? 'Call Agent' : 'Support Staff')), J(typeOf));
ok('people / agents counted (12 / 7)', w.people === 12 && w.agents === 7, J([w.people, w.agents]));
ok('an agent with no day captured is NAMED (the new starters of Oct 2026), support staff never', J(w.blank) === J(['CB9907']), J(w.blank));
/* every title the live register carries, with the type the daily export gave it (lake, Sep 2026) */
const VOCAB = [['Sales', 'Matrix VAS Courtesy - Sales Agent', 1], ['Sales', 'Matrix VAS Cuddles - Sales Agent', 1], ['Sales', 'Matrix VAS Cuddle Sales Agent', 1],
  ['Sales', 'Matrix Vehicle Tracking - Scheduling Agent', 1], ['Sales', 'Matrix Vehicle Tracking Digital - Sales Agent', 1], ['Sales', 'Matrix Vehicle Tracking Predictive - Sales Agent', 1],
  ['Sales', 'Matrix Vehicle Tracking Referral - Sales Agent', 1], ['Training', 'Trainee', 1], ['Sales - VAS 14', 'VAS Trainee', 1],
  ['Sales', 'Matrix VAS Team Leader', 0], ['Sales', 'Matrix VT Junior Team Leader', 0], ['Sales', 'Matrix VT Team Leader', 0], ['Sales', 'Campaign Manager', 0],
  ['Sales', 'Sales Optimization Specialist', 0], ['QA', 'QA Agent', 0], ['QA', 'QA Team Leader', 0], ['L&D', 'Assistant Sales Coach', 0], ['L&D', 'Sales & Product Facilitator', 0],
  ['IT', 'Dialler Administrator', 0], ['Recruitment', 'Dialler Administrator', 0], ['Exco', 'Sales Director', 0], ['Facilities', 'Facilities Cleaner', 0], ['HR', 'HR Business Partner', 0]];
const vocabWrong = VOCAB.filter(([dep, title, isAgent]) => {
  const r = W.wideRegisterToLong(HEAD.slice(0, 9).concat(['Thu 1', 'Fri 2', 'Sat 3', 'Mon 5', 'Tue 6']), [{ 'Department': dep, 'Employee Title': title, 'Employee Code': 'CB1', 'Thu 1': 'P' }], NAME, TODAY);
  return (r.rows[0]['Employee Type'] === 'Call Agent') !== !!isAgent; });
ok('the split reproduces the daily export for all ' + VOCAB.length + ' titles the register uses', vocabWrong.length === 0, J(vocabWrong));
const bad = W.wideRegisterToLong(HEAD, recs, NAME_BAD, TODAY);
ok('a name that contradicts the weekdays refuses the file and says why', !!bad.error && /November 2026/.test(bad.error) && /Nothing was loaded/.test(bad.error), bad.error);
const none = W.wideRegisterToLong(HEAD, recs, NAME_NONE, TODAY);
ok('no month in the name: the latest month the weekdays fit (2026-10), flagged as inferred', none.month === '2026-10' && none.inferred === true, J([none.month, none.inferred]));
ok('"October" with no year resolves to this year', W.wideRegisterToLong(HEAD, recs, 'Attendance Register October.csv', TODAY).month === '2026-10');
ok('a month word inside another word is not a month ("Mayur" is not May)', W.wideRegisterMonth(W.wideRegisterDays(HEAD), 'register mayur.csv', TODAY).inferred === true);

/* ------------------------------------------------------------------ browser harness ---- */
const SIDE = { '/xlsx.full.min.js': path.join(ROOT, 'site', 'xlsx.full.min.js') };
const serve = (html, port) => { const s = http.createServer((qq, r) => { const u = qq.url.split('?')[0];
  const p = SIDE[u] || ((u === '/' || u === '/index.html') ? html : null);
  if (!p || !fs.existsSync(p)) { r.writeHead(404); r.end(); return; }
  r.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' }); fs.createReadStream(p).pipe(r); });
  return new Promise((res) => s.listen(port, '127.0.0.1', () => res(s))); };
const sPulse = await serve(PULSE_HTML, 8286), sOps = await serve(OPS_HTML, 8287);
const { chromium } = await import(pathToFileURL(path.join(HERE, 'node_modules', 'playwright', 'index.mjs')).href);
const b = await chromium.launch();
try {
  /* ------------------------------------------------------------------ C. PULSE ---- */
  console.log('\nC · PULSE STORES EVERY AGENT-DAY BY CB');
  const page = await b.newPage();
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  const errs = []; page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
  await page.goto('http://127.0.0.1:8286/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__mtd && window.__mtd.state(), null, { timeout: 30000 });
  const P = await page.evaluate(async ({ TEXT, NAME, NAME_BAD }) => {
    const S = window.__mtd.state(); window.__cloudPush = function () {};
    const toasts = []; const tEl = document.getElementById('toast');
    new MutationObserver(() => { if (tEl.textContent) toasts.push(tEl.textContent); }).observe(tEl, { childList: true, characterData: true, subtree: true });
    const reset = () => { S.att = {}; S.files = []; };
    const snap = () => { const o = {}; for (const d in S.att) for (const c in S.att[d]) o[d + '|' + c] = S.att[d][c]; return o; };
    const out = {};
    reset(); out.ok = await window.__mtd.ingest(NAME, TEXT, 'attendance', 'h-wide'); out.att = snap();
    const e = S.files.find((f) => f.name === NAME); out.entry = e ? { type: e.type, rows: e.rows, nonAgent: e.nonAgent } : null;
    reset(); toasts.length = 0; await handleFiles([new File([TEXT], NAME, { type: 'text/csv' })], 'attendance'); out.toastsStation = toasts.slice();
    reset(); toasts.length = 0; out.okBad = await window.__mtd.ingest(NAME_BAD, TEXT, 'attendance', 'h-wide-bad'); out.attBad = snap(); out.toastsBad = toasts.slice();
    return out;
  }, { TEXT, NAME, NAME_BAD });
  ok('the register loads as attendance', P.ok === true && P.entry && P.entry.type === 'attendance', J(P.entry));
  ok('every agent-day is stored under its CB (' + agentKeys.length + ')', Object.keys(P.att).length === agentKeys.length && agentKeys.every((k) => k in P.att), Object.keys(P.att).length + ' stored');
  ok('each with the cell\'s Status Code (SL, UCA, SUSP, HDCA, the filed-ahead AL)', agentKeys.every((k) => P.att[k] === expected[k].v)
    && P.att['2026-10-07|CB9903'] === 'SL' && P.att['2026-10-02|CB9906'] === 'HDCA' && P.att['2026-10-28|CB9902'] === 'AL');
  ok('support staff never stored, and counted as excluded (' + supportCells + ' cells)', P.entry && P.entry.nonAgent === supportCells
    && !Object.keys(P.att).some((k) => /CB995/.test(k)), J(P.entry));
  ok('the upload\'s closing toast names the agent with a blank row', P.toastsStation.some((t) => /1 agent\(s\) are on the register with NO day captured/.test(t) && t.includes('CB9907')), J(P.toastsStation.map((t) => t.slice(0, 200))));
  ok('a mis-named month stores nothing and the reason is on screen', P.okBad === false && Object.keys(P.attBad).length === 0
    && P.toastsBad.some((t) => /November 2026/.test(t) && /Nothing was loaded/.test(t)), J(P.toastsBad.map((t) => t.slice(0, 140))));
  ok('no page errors in PULSE', errs.length === 0, errs.join(' | '));

  /* ------------------------------------------------------------------ D. Ops ---- */
  console.log('\nD · OPS DETECTS AND LOADS IT');
  const op = await b.newPage();
  await op.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
    const u = r.request().url();
    if (/cdnjs\.cloudflare\.com\/ajax\/libs\/xlsx\//.test(u)) return r.fulfill({ path: SIDE['/xlsx.full.min.js'], contentType: 'text/javascript' });
    if (/cdnjs\.cloudflare\.com\/ajax\/libs\/PapaParse\//.test(u)) return r.continue();
    return r.abort();
  });
  const oerrs = []; op.on('pageerror', (e) => oerrs.push(String(e.message).slice(0, 160)));
  await op.goto('http://127.0.0.1:8287/', { waitUntil: 'domcontentloaded' });
  await op.waitForFunction(() => typeof readUpload === 'function' && typeof applyLoad === 'function' && typeof state === 'object', null, { timeout: 30000 });
  const O = await op.evaluate(async ({ TEXT, NAME, NAME_BAD }) => {
    state.facts.ATTENDANCE = []; state.batches = []; bumpDataVer();
    const f = new File([TEXT], NAME, { type: 'text/csv' });
    const first = await readUpload(f, null); const src = detectSource(first);
    const parsed = await readUpload(f, 'ATTENDANCE'); const res = applyLoad('ATTENDANCE', f, parsed);
    const rows = state.facts.ATTENDANCE.map((r) => ({ k: r._d + '|' + normCB(r.employee_code), v: r.status_code, t: r.employee_type }));
    let badErr = null; try { await readUpload(new File([TEXT], NAME_BAD, { type: 'text/csv' }), null); } catch (e) { badErr = e.message; }
    return { src, loaded: res.loaded, rejects: res.rejects, rows, badErr };
  }, { TEXT, NAME, NAME_BAD });
  ok('Ops detects the register as ATTENDANCE', O.src === 'ATTENDANCE', O.src);
  ok('Ops loads every captured cell, no rejects (' + Object.keys(expected).length + ')', O.loaded === Object.keys(expected).length && O.rejects === 0, J([O.loaded, O.rejects]));
  ok('Ops keys each row by date and CB with the cell\'s code', O.rows.every((r) => expected[r.k] && expected[r.k].v === r.v), J(O.rows.slice(0, 3)));
  ok('Ops carries the derived Employee Type (Call Agent / Support Staff)', O.rows.every((r) => r.t === (expected[r.k].kind === 'agent' ? 'Call Agent' : 'Support Staff')));
  ok('Ops refuses a mis-named month with the reason', !!O.badErr && /November 2026/.test(O.badErr), O.badErr);
  ok('no page errors in Ops', oerrs.length === 0, oerrs.join(' | '));

  /* ------------------------------------------------------------------ E. today is never a gap ---- */
  /* 26 Oct 2026, Monday morning: the register complete through Friday 23rd read "HR has not captured 2026-10-26 yet"
     in red. A day HR can be asked for is a day that has ended; the same file one day later IS short of Monday. */
  console.log('\nE · TODAY IS NEVER A GAP — ONLY A DAY THAT HAS ENDED');
  const MON = new Date('2026-10-26T08:00:00+02:00'), TUE = new Date('2026-10-27T08:00:00+02:00');
  const pulseWarn = async (when) => { const pg = await b.newPage(); await pg.clock.setFixedTime(when);
    await pg.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    await pg.goto('http://127.0.0.1:8286/index.html', { waitUntil: 'domcontentloaded' });
    await pg.waitForFunction(() => window.__mtd && window.__mtd.state(), null, { timeout: 30000 });
    const r = await pg.evaluate(async ({ TEXT, NAME }) => { const S = window.__mtd.state(); window.__cloudPush = function () {}; S.att = {}; S.files = [];
      await window.__mtd.ingest(NAME, TEXT, 'attendance', 'h-clock'); const e = S.files.find((f) => f.name === NAME) || {}; return { warn: e.warn || null, sev: e.warnSev || null }; }, { TEXT, NAME });
    await pg.close(); return r; };
  const opsNote = async (when) => { const pg = await b.newPage(); await pg.clock.setFixedTime(when);
    await pg.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => { const u = r.request().url();
      if (/cdnjs\.cloudflare\.com\/ajax\/libs\/xlsx\//.test(u)) return r.fulfill({ path: SIDE['/xlsx.full.min.js'], contentType: 'text/javascript' });
      if (/cdnjs\.cloudflare\.com\/ajax\/libs\/PapaParse\//.test(u)) return r.continue(); return r.abort(); });
    await pg.goto('http://127.0.0.1:8287/', { waitUntil: 'domcontentloaded' });
    await pg.waitForFunction(() => typeof readUpload === 'function' && typeof applyLoad === 'function' && typeof state === 'object', null, { timeout: 30000 });
    const r = await pg.evaluate(async ({ TEXT, NAME }) => { state.facts.ATTENDANCE = []; state.batches = []; bumpDataVer();
      const f = new File([TEXT], NAME, { type: 'text/csv' }); const res = applyLoad('ATTENDANCE', f, await readUpload(f, 'ATTENDANCE')); return res.batch.register_note || null; }, { TEXT, NAME });
    await pg.close(); return r; };
  const pMon = await pulseWarn(MON), pTue = await pulseWarn(TUE);
  ok('PULSE, Monday 08:00: a register complete through Friday raises no warning (the filed-ahead Monday row is not a gap)', !pMon.warn, J(pMon));
  ok('PULSE, Tuesday 08:00: the same file is short of Monday — said, naming 2026-10-26', !!pTue.warn && /HR has not captured 2026-10-26/.test(pTue.warn), J(pTue));
  const oMon = await opsNote(MON), oTue = await opsNote(TUE);
  ok('Ops, Monday 08:00: no register note', !oMon, oMon);
  ok('Ops, Tuesday 08:00: the note names the register end (2026-10-23) and Monday', !!oTue && /stops at 2026-10-23/.test(oTue) && /2026-10-26/.test(oTue), oTue);
} finally { await b.close(); sPulse.close(); sOps.close(); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
