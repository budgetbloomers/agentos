/* VT WORKBOOK ORACLE (Spec Kit 073) — the workbook tabs against the owner's own master workbook, cell by cell.
 *
 * The owner, 26 Nov 2026: "make the data analytics like how it is in the excel dashboard". The workbook
 * (Master November 2026 - VT Report.xlsx) is the EXAMPLE OUTPUT. This suite builds the case book out of its Schedulers
 * Data sheet, runs VTEngine.dashboard() + VTWorkbook, and compares every numeric cell of:
 *   Exco Summary      B7:K8 strip · B18:L22 channels · B26:L33 campaigns · B37:L41 rollovers · B67:H81 weeks ·
 *                     J67:L73 lead time · B85:D102 upcoming                                   (the sheet's View: All data)
 *   Agent & Scheduler Summary  scheduler / agent / referring-agent tables C:W (rows matched BY NAME — dynamic arrays) ·
 *                     the scheduler lead-time table C:I · the drill-down Y22:AE22 and its record rows
 *   Sales Review      A5:G7 strip · A29:G34 vs budget · A38:G43 outcome mix · B49:G122 the detailed table · K5:K14
 *
 * It lives OUTSIDE git (real staff and customer data), so without it the suite SKIPS, loudly. It prints cell addresses
 * and figures only — never a customer field.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const REPO = process.env.AGENTOS || decodeURIComponent(new URL('../..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1').replace(/\/$/, '');
const DIR = process.env.VT_MASTER || path.join(path.dirname(REPO), 'reference', 'zips', 'vt-master');
const FILE = 'Master November 2026 - VT Report.xlsx';
const SCRATCH = path.join(REPO, 'nicks_code', 'diagnostics', 'scratch', 'vt');

let pass = 0, fail = 0; const failures = [];
const ok = (n, c, d = '') => { if (c) { pass++; } else { fail++; failures.push(n + (d ? ' — ' + d : '')); console.log('  FAIL ' + n + (d ? ' — ' + d : '')); } };
const head = (s) => console.log('\n== ' + s + ' ==');
if (!fs.existsSync(path.join(DIR, FILE))) {
  console.log('SKIP verify-vt-workbook-oracle: the owner\'s master workbook is not on this machine (' + path.join(DIR, FILE) + ').');
  console.log('  It lives OUTSIDE git by design. Set VT_MASTER to its folder. Spec 073 is NOT proven without it.');
  process.exit(0);
}
const E = require(path.join(REPO, 'nicks_code', 'vt-engine.js'));
const W = require(path.join(REPO, 'nicks_code', 'vt-workbook.js'));
const XLSX = require('xlsx');
const wb = XLSX.readFile(path.join(DIR, FILE), { cellFormula: false });
const cell = (s, a) => { const c = wb.Sheets[s] && wb.Sheets[s][a]; return c == null ? null : c.v; };
const EXCO = 'Exco Summary', ASS = 'Agent & Scheduler Summary', SR = 'Sales Review';

/* a workbook cell against an engine figure: numbers to 1e-6, "" / null as blank, text as text */
const blank = (v) => v == null || v === '' || v === '-';
const same = (got, exp) => {
  if (blank(exp)) return blank(got);
  if (typeof exp === 'number') return typeof got === 'number' && Math.abs(got - exp) <= 1e-6 * Math.max(1, Math.abs(exp));
  return String(got).trim() === String(exp).trim();
};
const documented = [];
const chk = (sheet, addr, got, what, opts) => {
  const exp = cell(sheet, addr);
  /* AN ABSENCE IS NOT A NOUGHT. A rate over zero sales is undefined: AgentOS leaves it blank, the workbook's
     IFERROR(x/0, 0) writes 0%. Counted and listed below as a documented difference, never special-cased in the engine. */
  if (opts && opts.rate && exp === 0 && got == null) { documented.push(sheet + ' ' + addr + (what ? ' (' + what + ')' : '')); pass++; return; }
  ok(sheet + ' ' + addr + (what ? ' (' + what + ')' : ''), same(got, exp), 'workbook ' + JSON.stringify(exp) + ' · engine ' + JSON.stringify(got));
};
const R_ = { rate: true };
const nk = (v) => String(v).trim().replace(/\s+/g, ' ').toLowerCase();
const serial = (v) => (typeof v === 'number' && v > 0) ? E.serialToISO(v) : null;
const toSerial = (iso) => iso == null ? null : Math.round((Date.parse(iso + 'T00:00:00Z') - Date.UTC(1899, 11, 30)) / 86400000);

/* ---------------------------------------------------------------- the book, from Schedulers Data ---- */
const sd = XLSX.utils.sheet_to_json(wb.Sheets['Schedulers Data'], { header: 1, raw: true, defval: null });
const C = Object.assign({ saleDate: 'B', agent: 'C', gwp: 'E', caseNumber: 'F', campaignRaw: 'H', referringAgent: 'I', scheduler: 'J', result: 'K', apptOn: 'M' },
  E.VT_RULES.columns.schedulers || {});
const ci = (l) => { let n = 0; for (const ch of String(l)) n = n * 26 + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.indexOf(ch) + 1; return n - 1; };
const at = (r, f) => r[ci(C[f])];
const RES = { Fitted: 'fitted', Missed: 'missed', Scheduled: 'scheduled', Cancelled: 'cancelled' };
const recs = sd.slice(1).filter((r) => r && r[0] != null && r[0] !== '').map((r) => ({
  cn: String(at(r, 'caseNumber')).trim(), soldOn: serial(at(r, 'saleDate')), st: RES[String(at(r, 'result')).trim()] || null,
  gwp: +at(r, 'gwp') || 0, campaign: String(at(r, 'campaignRaw')).trim(), scheduler: String(at(r, 'scheduler')).trim(),
  agent: at(r, 'agent') == null ? null : String(at(r, 'agent')).trim(),
  referrer: at(r, 'referringAgent') == null || at(r, 'referringAgent') === 0 ? null : String(at(r, 'referringAgent')).trim(),
  apptOn: serial(at(r, 'apptOn')) }));
const CYCLE = 'cycle-2026-11';
const ASOF = recs.reduce((m, r) => r.soldOn && (!m || r.soldOn > m) ? r.soldOn : m, null);
const book = E.emptyBook(); book.openedOn = '2026-08-21'; book.openingBookOn = '2026-08-21'; book.rev = 1;
recs.forEach((r) => { book.cases[r.cn] = {
  caseNumber: r.cn, status: r.st, statusOn: r.soldOn, soldOn: r.soldOn, soldBasis: 'schedulers_data', firstSeen: r.soldOn, lastSeen: ASOF,
  apptOn: r.apptOn, fittedOn: r.st === 'fitted' ? r.soldOn : null, smAttempt: null, products: [], bundle: null, chargeEx: null, partnerRaw: null,
  leadSource: null, sellerName: r.agent, sellerCb: null, sellerMatch: null, cancelReason: null, campaignRpt: r.campaign, gwpRpt: r.gwp,
  schedulerName: r.scheduler, schedulerCb: null, referringName: r.referrer, referringCb: null, resultRpt: r.st }; });
const D = (view) => E.dashboard(book, [], { cycleKey: CYCLE, view: view, asOf: ASOF });
const Dall = D('all'), Dcyc = D('cycle');
ok('the model hands out its facts (non-enumerable, so no JSON changes)', Array.isArray(Dall.facts) && !Object.keys(Dall).includes('facts'));
ok('the workbook was saved on View "All data", which is what the Exco and A&SS checks run', cell(EXCO, 'C4') === 'All data' && cell(ASS, 'C4') === 'All data');

/* ================================================================ Exco Summary ==== */
head('Exco Summary (view: All data)');
const X = W.exco(Dall);
const sv = (k) => X.strip.filter((s) => s.k === k)[0];
chk(EXCO, 'B7', sv('sales').value); chk(EXCO, 'C7', sv('fitted').value); chk(EXCO, 'E7', sv('scheduled').value);
chk(EXCO, 'G7', sv('cancelled').value); chk(EXCO, 'I7', sv('missed').value); chk(EXCO, 'K7', sv('gwp').value);
const k8 = String(cell(EXCO, 'K8') || '').replace(/[^0-9]/g, '');
ok('Exco Summary K8 (total GWP in view)', +k8 === sv('gwp').of, 'workbook ' + k8 + ' · engine ' + sv('gwp').of);
const chRow = (r) => [r.share, r.sales, r.fitted, r.scheduled, r.cancelled, r.missed, r.fitRate, r.canRate, r.missRate, r.gwpFitted];
for (let rr = 18; rr <= 22; rr++) {
  const lab = cell(EXCO, 'B' + rr), r = lab === 'Total' ? X.channelTotal : X.channels.filter((c) => c.label === lab)[0];
  ok('Exco Summary B' + rr + ' "' + lab + '" is a channel the engine knows', !!r);
  if (r) chRow(r).forEach((v, i) => chk(EXCO, 'CDEFGHIJKL'[i] + rr, v, lab, 'CIJK'.indexOf('CDEFGHIJKL'[i]) > -1 ? R_ : null));
}
for (let rr = 26; rr <= 33; rr++) {
  const lab = cell(EXCO, 'B' + rr); if (lab == null) continue;
  const r = lab === 'Total' ? X.campaignTotal : X.campaigns.filter((c) => c.name === lab)[0];
  ok('Exco Summary B' + rr + ' "' + lab + '" is a campaign the engine knows', !!r);
  if (!r) continue;
  if (lab !== 'Total') chk(EXCO, 'C' + rr, r.channel, lab + ' channel');
  [r.sales, r.fitted, r.scheduled, r.cancelled, r.missed, r.fitRate, r.canRate, r.missRate, r.gwpFitted].forEach((v, i) => chk(EXCO, 'DEFGHIJKL'[i] + rr, v, lab, 'IJK'.indexOf('DEFGHIJKL'[i]) > -1 ? R_ : null));
}
for (let rr = 37; rr <= 41; rr++) {
  const lab = cell(EXCO, 'B' + rr), r = lab === 'Total' ? X.rollover.total : X.rollover.rows.filter((c) => c.label === lab)[0];
  if (!r) { ok('Exco Summary B' + rr + ' rollover "' + lab + '"', false); continue; }
  [r.sales, r.fitted, r.scheduled, r.cancelled, r.missed, r.open, r.fitRate, r.openRate, r.gwpFitted, r.gwpOpen].forEach((v, i) => chk(EXCO, 'CDEFGHIJKL'[i] + rr, v, 'rollover ' + lab, 'IJ'.indexOf('CDEFGHIJKL'[i]) > -1 ? R_ : null));
}
ok('Exco Summary: 14 weeks', X.weeks.length === 14, X.weeks.length);
X.weeks.forEach((w, i) => {
  const rr = 67 + i;
  chk(EXCO, 'B' + rr, toSerial(w.from), 'week commencing');
  [w.fitted, w.scheduled, w.cancelled, w.missed, w.sales, w.fitRate].forEach((v, j) => chk(EXCO, 'CDEFGH'[j] + rr, v, 'week ' + w.from, j === 5 ? R_ : null));
});
[X.weekTotal.fitted, X.weekTotal.scheduled, X.weekTotal.cancelled, X.weekTotal.missed, X.weekTotal.sales].forEach((v, j) => chk(EXCO, 'CDEFG'[j] + 81, v, 'weeks total'));
X.leadTime.rows.forEach((r, i) => { chk(EXCO, 'K' + (67 + i), r.count, 'lead time ' + r.label); chk(EXCO, 'L' + (67 + i), r.share, 'lead time ' + r.label, R_); });
chk(EXCO, 'K73', X.leadTime.total, 'lead time total');
X.upcoming.rows.forEach((r, i) => { const rr = 85 + i; chk(EXCO, 'B' + rr, toSerial(r.date)); chk(EXCO, 'C' + rr, r.count); chk(EXCO, 'D' + rr, r.share, null, R_); });
chk(EXCO, 'C101', X.upcoming.later, 'later / not shown'); chk(EXCO, 'C102', X.upcoming.total, 'total scheduled');

/* ================================================================ Agent & Scheduler Summary ==== */
head('Agent & Scheduler Summary (view: All data, no filters)');
const P = W.people(Dall, {});
const sheetCamps = []; for (let c = ci('Q'); c <= ci('W'); c++) sheetCamps.push(cell(ASS, XLSX.utils.encode_cell({ r: 37, c })));
const fullCamp = { 'Tracking Emp.': 'Tracking Empire', 'Referral Ag.': 'Referral Agent', 'Black Birch': 'Black Birch Projects' };
const personTable = (dimK, allRow, firstRow) => {
  const T = P.summaries.filter((s) => s.k === dimK)[0];
  /* schedulers and agents: C:L outcomes, M:P rollovers, Q:W sales by campaign. Referring agents (row 162): C:P the
     same, then Q "GWP / Fitted" (AVERAGE) and no campaign columns. */
  const tail = dimK === 'referrer' ? (r) => [r.gwpPerFitted]
    : (r) => sheetCamps.map((h) => { const c = r.byCampaign.filter((b) => b.campaign === (fullCamp[h] || h))[0]; return c ? c.sales : null; });
  const rowVals = (r) => [r.sales, r.fitted, r.scheduled, r.cancelled, r.missed, r.fitRate, r.canRate, r.missRate, r.gwpFitted, r.gwpLost,
    r.roll.sales, r.roll.fitted, r.roll.scheduled, r.roll.canMiss].concat(tail(r));
  const cols = 'CDEFGHIJKLMNOPQRSTUVW';
  const rateCol = (i) => 'HIJ'.indexOf(cols[i]) > -1 || (dimK === 'referrer' && cols[i] === 'Q');
  const put = (r, rr, what) => rowVals(r).forEach((v, i) => chk(ASS, cols[i] + rr, v, what, rateCol(i) ? R_ : null));
  put(T.total, allRow, T.total.name);
  let rr = firstRow, seen = 0;
  for (; ; rr++) {
    const name = cell(ASS, 'B' + rr); if (name == null || name === '' || /summary|pipeline|month cycle/i.test(String(name))) break;
    const r = T.rows.filter((x) => nk(x.name) === nk(name))[0];
    ok(ASS + ' B' + rr + ' ' + dimK + ' is in the engine table', !!r);
    if (r) { put(r, rr, dimK); seen++; }
  }
  ok(ASS + ' ' + dimK + ': the engine lists exactly the workbook\'s people', seen === T.rows.length, 'workbook ' + seen + ' · engine ' + T.rows.length);
  return T;
};
const findRow = (label) => { for (let r = 1; r < 400; r++) if (String(cell(ASS, 'B' + r) || '').trim() === label) return r; return null; };
personTable('scheduler', findRow('All schedulers'), findRow('All schedulers') + 1);
personTable('agent', findRow('All agents'), findRow('All agents') + 1);
personTable('referrer', findRow('All referring agents'), findRow('All referring agents') + 1);
/* the scheduler lead-time table: the SECOND "All schedulers" row */
let leadAll = null; { let n = 0; for (let r = 1; r < 400; r++) if (String(cell(ASS, 'B' + r) || '').trim() === 'All schedulers' && ++n === 2) { leadAll = r; break; } }
ok(ASS + ' has a second "All schedulers" row (the lead-time table)', !!leadAll);
if (leadAll) {
  const leadVals = (l) => l.rows.map((x) => x.count).concat([l.total]);
  leadVals(P.schedulerLead.all).forEach((v, i) => chk(ASS, 'CDEFGHI'[i] + leadAll, v, 'lead, all schedulers'));
  for (let rr = leadAll + 1; ; rr++) {
    const name = cell(ASS, 'B' + rr); if (name == null || name === '') break;
    const l = P.schedulerLead.rows.filter((x) => nk(x.name) === nk(name))[0];
    ok(ASS + ' B' + rr + ' lead-time scheduler is in the engine table', !!l);
    if (l) leadVals(l).forEach((v, i) => chk(ASS, 'CDEFGHI'[i] + rr, v, 'lead ' + name));
  }
}
/* the drill-down, as the workbook was saved (Z18 type, Z19 name) */
const dType = { Agent: 'agent', Scheduler: 'scheduler', 'Referring Agent': 'referrer' }[cell(ASS, 'Z18')];
const DR = W.drill(Dall, dType, String(cell(ASS, 'Z19')).trim(), {});
ok('drill-down picks the workbook\'s saved person', nk(DR.name) === nk(cell(ASS, 'Z19')), DR.name);
chk(ASS, 'Y22', DR.counts.records, 'records'); chk(ASS, 'Z22', DR.counts.fitted); chk(ASS, 'AA22', DR.counts.scheduled);
chk(ASS, 'AB22', DR.counts.cancelled); chk(ASS, 'AC22', DR.counts.missed); chk(ASS, 'AD22', DR.counts.gwpFitted); chk(ASS, 'AE22', DR.counts.gwpTotal);
{
  const sheetCases = []; for (let r = 25; r < 3000; r++) { const v = cell(ASS, 'AA' + r); if (v == null || v === '') break; sheetCases.push(String(v).trim()); }
  const mine = DR.rows.map((r) => r.caseNumber);
  ok('drill-down lists exactly the workbook\'s records (as a set)', sheetCases.length === mine.length && sheetCases.every((c) => mine.indexOf(c) > -1),
    'workbook ' + sheetCases.length + ' · engine ' + mine.length);
  ok('drill-down rows carry the seven workbook columns and no customer field',
    DR.rows.every((r) => Object.keys(r).sort().join() === 'agent,campaign,caseNumber,cycleTag,gwp,referrer,result,scheduler,soldOn'));
}

/* ================================================================ Sales Review ==== */
head('Sales Review (column C is the cycle view, G all data)');
const V = W.review(Dcyc);
const groupStart = { 'Total Sales': 51, 'Total Fitments': 57, 'Fitment Rate': 63, 'Missed': 69, 'Cancelled': 75, 'Cancelled %': 81, 'Total Scheduled': 87 };
let bucketRow = 93;
V.groups.forEach((g) => {
  let start;
  if (g.kpi === 'Dialing Days') start = 49; else if (g.kpi === 'HC') start = 50;
  else if (groupStart[g.kpi]) start = groupStart[g.kpi]; else { start = bucketRow; bucketRow += 6; }
  ok('Sales Review A' + start + ' is "' + g.kpi + '"', String(cell(SR, 'A' + start)).trim() === g.kpi, 'workbook "' + cell(SR, 'A' + start) + '"');
  g.rows.forEach((r, i) => {
    const rr = start + i;
    chk(SR, 'B' + rr, r.budget, g.kpi + ' · ' + r.label + ' budget');
    chk(SR, 'C' + rr, r.actual, g.kpi + ' · ' + r.label + ' actual');
    chk(SR, 'D' + rr, r.pctTgt, g.kpi + ' · ' + r.label + ' % tgt');
    chk(SR, 'E' + rr, r.deficit, g.kpi + ' · ' + r.label + ' deficit');
    chk(SR, 'F' + rr, r.forecastDash ? '-' : r.forecast, g.kpi + ' · ' + r.label + ' forecast');
    chk(SR, 'G' + rr, r.allData, g.kpi + ' · ' + r.label + ' all data');
  });
});
const st = (k) => V.strip.filter((s) => s.k === k)[0];
chk(SR, 'A5', st('dialing').value + ' of ' + st('dialing').of, 'dialing days');
chk(SR, 'A7', st('dialing').left + ' days left');
['sales', 'fitted', 'fitRate', 'canPct', 'scheduled', 'forecast'].forEach((k, i) => chk(SR, 'BCDEFG'[i] + 5, st(k).value, k));
V.vsBudget.forEach((r, i) => {
  const rr = 29 + i;
  ok('Sales Review A' + rr + ' row is ' + r.label, String(cell(SR, 'A' + rr)).trim().indexOf(r.label) === 0, cell(SR, 'A' + rr));
  [r.salesBudget, r.salesActual, r.salesForecast, r.fitBudget, r.fitActual, r.fitForecast].forEach((v, j) => chk(SR, 'BCDEFG'[j] + rr, v, 'vs budget ' + r.label));
});
V.outcomeMix.forEach((r, i) => {
  const rr = 38 + i;
  [r.fitted, r.scheduled, r.missed, r.cancelled, r.sales, r.fitRate].forEach((v, j) => chk(SR, 'BCDEFG'[j] + rr, v, 'outcome mix ' + r.label));
});
chk(SR, 'K5', toSerial(V.settings.from), 'cycle start'); chk(SR, 'K6', toSerial(V.settings.to), 'cycle end');
chk(SR, 'K7', toSerial(V.settings.dataThrough), 'data up to');
V.settings.holidays.forEach((h, i) => chk(SR, 'K' + (9 + i), toSerial(h.date), 'holiday ' + h.name));

console.log('\n== DOCUMENTED DIFFERENCES (' + documented.length + ', never special-cased) ==');
console.log('  A rate over zero sales: AgentOS shows it blank, the workbook\'s IFERROR(x/0, 0) writes 0%.');
documented.forEach((d) => console.log('    ' + d));
console.log('\n' + pass + ' passed, ' + fail + ' failed, ' + documented.length + ' documented differences');
try { fs.mkdirSync(SCRATCH, { recursive: true }); fs.writeFileSync(path.join(SCRATCH, 'workbook-oracle.json'), JSON.stringify({ pass, fail, failures }, null, 1)); } catch (e) { /* scratch only */ }
process.exit(fail ? 1 : 0);
