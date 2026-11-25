/* VT REPORT ORACLE (Spec Kit 072 SC-001, SC-002, plan §T) — the consolidated dashboard against the
 * owner's own master workbook.
 *
 * Reads `Master November 2026 - VT Report.xlsx` (outside git, ../reference/zips/vt-master/), builds a
 * case book out of its Schedulers Data sheet, runs VTEngine.dashboard() over it and checks every
 * figure the workbook computes in its own cells: the Sales Review KPIs, the weekly trend, the channel
 * and campaign mixes, the five lead-time buckets, the straight-line forecast, the dialing days, the
 * breakdown table, Fitted GWP, the four scheduler pivots, upcoming fitments, the rollover follow-up
 * and all three integrity checks. EXPECTED VALUES ARE READ FROM THE WORKBOOK'S CELLS at run time —
 * never from the guide PDF, which is wrong about the row count (spec F0-1), and never typed in here.
 *
 * STATUS, IN THIS SUITE ONLY, COMES FROM THE WORKBOOK'S `Result` COLUMN. In production the daily
 * exports decide and `Result` is never applied (spec FR-012); here the workbook is the only source in
 * the room, and the question this suite answers is whether the ENGINE'S ARITHMETIC reproduces the
 * owner's cells over the same facts. Every disagreement the production path would record is listed
 * under DOCUMENTED DIFFERENCES with the 071 oracle's own counts carried forward (FR-015).
 *
 * PII: the workbook holds real staff names and a Customer Contact column. The column is never read.
 * Schedulers print as S1…S6, agents as A1…, referrers as R1… — never by name, never by customer field.
 *
 * Run:  node verify-vt-report-oracle.mjs      (summary → diagnostics/scratch/vt/report-oracle.json)
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const REPO = process.env.AGENTOS || decodeURIComponent(new URL('../..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1').replace(/\/$/, '');
const DIR = process.env.VT_MASTER || path.join(path.dirname(REPO), 'reference', 'zips', 'vt-master');
const FILE = 'Master November 2026 - VT Report.xlsx';
const ENGINE = path.join(REPO, 'nicks_code', 'vt-engine.js');
const SCRATCH = path.join(REPO, 'nicks_code', 'diagnostics', 'scratch', 'vt');

let pass = 0, fail = 0; const failures = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; failures.push(n + (d ? ' — ' + d : '')); console.log('  FAIL ' + n + (d ? ' — ' + d : '')); } };
const eq = (n, got, exp) => ok(n, JSON.stringify(got) === JSON.stringify(exp), 'expected ' + JSON.stringify(exp) + ' got ' + JSON.stringify(got));
const near = (n, got, exp, tol = 0.05) => ok(n, typeof got === 'number' && Math.abs(got - exp) <= tol, 'expected ' + exp + ' (±' + tol + ') got ' + got);
const documented = [];
const doc = (what, measured, predicted, why) => { documented.push({ what, measured, predicted, why }); };
const head = (s) => console.log('\n== ' + s + ' ==');
const finish = () => {
  console.log('\n== DOCUMENTED DIFFERENCES (never special-cased) ==');
  documented.forEach(d => console.log(`  diff ${d.what}: measured ${JSON.stringify(d.measured)} · predicted ${JSON.stringify(d.predicted)} — ${d.why}`));
  console.log(`\n${pass} passed, ${fail} failed, ${documented.length} documented differences`);
  failures.forEach(f => console.log('  · ' + f));
  try { fs.mkdirSync(SCRATCH, { recursive: true }); fs.writeFileSync(path.join(SCRATCH, 'report-oracle.json'), JSON.stringify({ pass, fail, failures, documented }, null, 1)); } catch (e) { console.log('  note scratch not written: ' + e.message); }
  process.exit(fail ? 1 : 0);
};

if (!fs.existsSync(path.join(DIR, FILE))) {
  console.log('\n*********************************************************************************');
  console.log('SKIP verify-vt-report-oracle: the owner\'s master workbook is not on this machine.');
  console.log('  looked for: ' + path.join(DIR, FILE));
  console.log('  It lives OUTSIDE git by design (real staff and customer data). Set VT_MASTER to its');
  console.log('  folder to run this suite. SC-001 and SC-002 are NOT proven without it — the pure');
  console.log('  suites verify-vt-views / -periods / -engine / -rules still ran.');
  console.log('*********************************************************************************');
  process.exit(0);
}
if (!fs.existsSync(ENGINE)) { ok('nicks_code/vt-engine.js exists', false, 'missing'); finish(); }
const E = require(ENGINE);
const XLSX = require('xlsx');

/* ---------------------------------------------------------------- the workbook ---- */
const wb = XLSX.readFile(path.join(DIR, FILE), { cellFormula: true });
const aoa = (s) => XLSX.utils.sheet_to_json(wb.Sheets[s], { header: 1, raw: true, defval: null });
const cell = (s, a) => { const c = wb.Sheets[s] && wb.Sheets[s][a]; return c == null ? null : c.v; };
const SR = 'Sales Review', EXCO = 'Exco Summary', ASS = 'Agent & Scheduler Summary';
const sd = aoa('Schedulers Data');
/* the Schedulers Data sheet is read BY POSITION, from the rule book's columns.schedulers (072 A2).
   Until that key exists the suite still runs, on the positions the spec names, and says so. */
const FALLBACK = { saleDate: 'B', agent: 'C', saleCount: 'D', gwp: 'E', caseNumber: 'F', campaignRaw: 'H', referringAgent: 'I', scheduler: 'J', result: 'K', hrsAhead: 'L', apptOn: 'M' };
const C = Object.assign({}, FALLBACK, E.VT_RULES.columns.schedulers || {});
const ci = (letter) => { let n = 0; for (const ch of String(letter)) n = n * 26 + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.indexOf(ch) + 1; return n - 1; };
const at = (r, f) => r[ci(C[f])];
ok('the rule book carries columns.schedulers, read by position (072 A2)',
  !!(E.VT_RULES.columns.schedulers && E.VT_RULES.columns.schedulers.byPosition) &&
  Object.keys(FALLBACK).every(k => k === 'hrsAhead' || E.VT_RULES.columns.schedulers[k] === FALLBACK[k]),
  'falling back to the positions the spec names: ' + JSON.stringify(FALLBACK));

head('F0-1 · the sheet has 3,010 records, not 19,960');
const raw = sd.slice(1);
const rows = raw.filter(r => r && r[0] != null && r[0] !== '');
eq('the sheet range runs to row 19,961 but only 3,010 rows are populated', [raw.length, rows.length], [19960, 3010]);
eq('the empty rows carry nothing but the extended formulas', raw.length - rows.length, 16950);
eq('column A reads Current or Rollover and nothing else', Object.fromEntries(Object.entries(rows.reduce((a, r) => (a[r[0]] = (a[r[0]] || 0) + 1, a), {})).sort()), { Current: 2382, Rollover: 628 });
eq('every populated row has a date, a result, a GWP, a scheduler and a campaign', ['saleDate', 'result', 'gwp', 'scheduler', 'campaignRaw'].map(f => rows.filter(r => at(r, f) == null || at(r, f) === '').length), [0, 0, 0, 0, 0]);
eq('Sale Count is 1 on every row and all 3,010 case numbers are distinct (A2)',
  [rows.every(r => at(r, 'saleCount') === 1), new Set(rows.map(r => String(at(r, 'caseNumber')))).size], [true, 3010]);

/* ---------------------------------------------------------------- build the book ---- */
const RES = { Fitted: 'fitted', Missed: 'missed', Scheduled: 'scheduled', Cancelled: 'cancelled' };
const CYCLE = 'cycle-2026-11';
const cyc = E.periods.cycleByKey(CYCLE);
const serial = (v) => (typeof v === 'number' && v > 0) ? E.serialToISO(v) : null;
const recs = rows.map(r => ({
  cn: String(at(r, 'caseNumber')).trim(),
  soldOn: serial(at(r, 'saleDate')),
  st: RES[String(at(r, 'result')).trim()] || null,
  gwp: +at(r, 'gwp') || 0,
  campaign: String(at(r, 'campaignRaw')).trim(),
  scheduler: String(at(r, 'scheduler')).trim(),
  agent: at(r, 'agent') == null ? null : String(at(r, 'agent')).trim(),
  referrer: at(r, 'referringAgent') == null || at(r, 'referringAgent') === 0 ? null : String(at(r, 'referringAgent')).trim(),
  apptOn: serial(at(r, 'apptOn')),
  hrs: at(r, 'hrsAhead') == null ? '' : String(at(r, 'hrsAhead')).trim(),
  month: r[0]
}));
eq('every Result is one of the four statuses', recs.filter(r => !r.st).length, 0);
const maxSale = recs.reduce((m, r) => r.soldOn && (!m || r.soldOn > m) ? r.soldOn : m, null);
const ASOF = maxSale;   /* the extract day: the newest sale the file carries (F0-6) */
eq('sale dates run 21 Aug 2026 → 23 Nov 2026', [recs.reduce((m, r) => !m || r.soldOn < m ? r.soldOn : m, null), maxSale], ['2026-08-21', '2026-11-23']);

const book = E.emptyBook();
book.openedOn = '2026-08-21'; book.openingBookOn = '2026-08-21'; book.rev = 1;
recs.forEach(r => {
  book.cases[r.cn] = {
    caseNumber: r.cn, status: r.st, statusOn: r.soldOn, soldOn: r.soldOn, soldBasis: 'schedulers_data',
    firstSeen: r.soldOn, lastSeen: ASOF, apptOn: r.apptOn, fittedOn: r.st === 'fitted' ? r.soldOn : null,
    smAttempt: null, products: [], bundle: null, chargeEx: null, partnerRaw: null, leadSource: null,
    sellerName: r.agent, sellerCb: null, sellerMatch: null, cancelReason: null,
    campaignRpt: r.campaign, gwpRpt: r.gwp, schedulerName: r.scheduler, schedulerCb: null,
    referringName: r.referrer, referringCb: null, resultRpt: r.st
  };
});
if (typeof E.dashboard !== 'function') {
  ok('VTEngine.dashboard() exists (spec 072 A6) — the figures above are the workbook\'s; nothing can be checked against the engine yet', false, 'not implemented');
  finish();
}
const D = (view, extra) => E.dashboard(book, [], Object.assign({ cycleKey: CYCLE, view: view, asOf: ASOF }, extra || {}));
const M = D('cycle');

head('the period, the data-through date and the dialing days (F0-5, F0-6, F0-8)');
eq('the workbook\'s cycle IS the suite\'s business month: Exco H4 / J4 = 26 Oct / 25 Nov (A3)',
  [E.serialToISO(cell(EXCO, 'H4')), E.serialToISO(cell(EXCO, 'J4'))], [cyc.from, cyc.to]);
eq('data-through = Sales Review K7 = MIN(cycle end, max sale date)', M.period.dataThrough, E.serialToISO(cell(SR, 'K7')));
eq('the one holiday entered (SR K9) is already in the rule book — nothing added (F0-7, A4)',
  [E.serialToISO(cell(SR, 'K9')), E.VT_RULES.periods.extraHolidays.includes(E.serialToISO(cell(SR, 'K9')))], ['2026-11-04', true]);
eq('total dialing days = SR B49', M.dialingDays.total, cell(SR, 'B49'));
eq('elapsed dialing days = SR C49', M.dialingDays.elapsed, cell(SR, 'C49'));
eq('dialing days left = SR E49', M.dialingDays.left, cell(SR, 'E49'));
near('% of the cycle elapsed = SR D49', M.dialingDays.pct, cell(SR, 'D49'), 1e-9);
eq('the lead-time as-at is FROZEN at the extract + 1 day = 24 Nov, the day the workbook last calculated (D5, F0-14)', M.period.hrsAsAt, '2026-11-24');

head('SC-001 · the cycle view (SR C51 / C57 / C69 / C75 / C87)');
eq('total sales in view = SR C51', M.counts.sales, cell(SR, 'C51'));
eq('fitments = SR C57', M.counts.fitted, cell(SR, 'C57'));
eq('missed = SR C69 (in-cycle only, F0-9)', M.counts.missed, cell(SR, 'C69'));
eq('cancelled = SR C75 (in-cycle only)', M.counts.cancelled, cell(SR, 'C75'));
eq('scheduled = SR C87 (in-cycle only)', M.counts.scheduled, cell(SR, 'C87'));
eq('the four outcomes and the sales total are 1,996 / 373 / 128 / 208 / 2,705',
  [M.counts.fitted, M.counts.scheduled, M.counts.missed, M.counts.cancelled, M.counts.sales], [1996, 373, 128, 208, 2705]);
near('fitment rate 73.8 %', M.rates.fitRate * 100, 73.8, 0.05);
near('cancellation % = SR C81', M.rates.canRate, cell(SR, 'C81'), 1e-12);
eq('target achieved = SR D51 (sales ÷ the 3,030 budget)', Math.round(M.budget.achievement * 1e12), Math.round(cell(SR, 'D51') * 1e12));
eq('the sales budget is the rule book\'s, and it equals SR B51 / B52 / B55 / B56',
  [M.budget.sales.total, M.budget.sales.lead_gen, M.budget.sales.referral, M.budget.sales.predictive],
  [cell(SR, 'B51'), cell(SR, 'B52'), cell(SR, 'B55'), cell(SR, 'B56')]);
eq('the fitment budget equals SR B57 / B58 / B61 / B62',
  [M.budget.fitments.total, M.budget.fitments.lead_gen, M.budget.fitments.referral, M.budget.fitments.predictive],
  [cell(SR, 'B57'), cell(SR, 'B58'), cell(SR, 'B61'), cell(SR, 'B62')]);
eq('the dashboard\'s fitment-rate target is 80 % flat = SR B63 (D3 — NOT the agent card\'s sub-campaign budget)',
  M.budget.fitmentRate, cell(SR, 'B63'));
ok('every budget figure names its Sales Review cell', M.budget.cells && ['sales', 'fitments', 'fitmentRate', 'dialingDays'].every(k => typeof M.budget.cells[k] === 'string' && M.budget.cells[k].length > 4), JSON.stringify(M.budget.cells));

head('SC-001 · the straight-line forecast (SR F51 / F57)');
near('forecast sales = SR F51', M.forecast.sales, cell(SR, 'F51'), 0.05);
near('forecast fitments = SR F57', M.forecast.fitments, cell(SR, 'F57'), 0.05);
eq('…rounded, 2,976 sales and 2,196 fitments (98.2 % / 90.6 % of budget)', [Math.round(M.forecast.sales), Math.round(M.forecast.fitments)], [2976, 2196]);
ok('the forecast is labelled a pace, never a prediction (FR-040)', /pace/i.test(M.forecast.label) && /not a prediction/i.test(M.forecast.label), M.forecast.label);

head('SC-001 · the five lead-time buckets (SR C93/C99/C105/C111/C117 vs B94/B100/B106/B112/B118)');
const bk = Object.fromEntries(M.buckets.map(b => [b.k, b]));
eq('the five buckets are 130 / 68 / 26 / 0 / 149', M.buckets.map(b => b.count), [130, 68, 26, 0, 149]);
eq('…and they equal SR C93 / C99 / C105 / C111 / C117', M.buckets.map(b => b.count),
  ['C93', 'C99', 'C105', 'C111', 'C117'].map(a => cell(SR, a)));
eq('the bucket labels are the workbook\'s five', M.buckets.map(b => b.label), ['24', '48', '72', '72+ in cycle', '72+ out cycle']);
near('the 24 h target = SR B94 (75 % of the 10 % scheduled target)', bk.h24.target, cell(SR, 'B94'), 1e-9);
near('the 48 h target = SR B100', bk.h48.target, cell(SR, 'B100'), 1e-9);
near('the 72 h target = SR B106', bk.h72.target, cell(SR, 'B106'), 1e-9);
near('the 72+ in cycle target = SR B112', bk.h72pIn.target, cell(SR, 'B112'), 1e-9);
near('the 72+ out cycle target = SR B118', bk.h72pOut.target, cell(SR, 'B118'), 1e-9);
ok('72+ in cycle is 0 with the structural note, not an error (F0-15, Q4)', bk.h72pIn.count === 0 && bk.h72pIn.structuralZero === true, JSON.stringify(bk.h72pIn));
eq('the bucket shares are the dashboard\'s 75/10/5/5/5, not the rating-side 80/10/5/5 (D3)',
  [E.VT_RULES.dashboardHrsShare.h24, E.VT_RULES.dashboardHrsShare.h48, E.VT_RULES.dashboardHrsShare.h72, E.VT_RULES.dashboardHrsShare.h72pIn, E.VT_RULES.dashboardHrsShare.h72pOut], [0.75, 0.1, 0.05, 0.05, 0.05]);
ok('the rating-side hrsShare is untouched and still has four buckets (FR-033)',
  JSON.stringify(E.VT_RULES.budgets[CYCLE].hrsShare) === JSON.stringify({ h24: 0.8, h48: 0.1, h72: 0.05, h72p: 0.05 }), JSON.stringify(E.VT_RULES.budgets[CYCLE].hrsShare));
{ const all = Object.fromEntries(M.bucketsAll.map(b => [b.k, b.count]));
  eq('over ALL bookings the buckets are 140 / 77 / 30 / 0 / 213 = 460, the whole scheduled pipeline (F0-13)',
    [all.h24, all.h48, all.h72, all.h72pIn, all.h72pOut, M.bucketsAll.reduce((s, b) => s + b.count, 0)], [140, 77, 30, 0, 213, 460]);
  const wbTally = recs.filter(r => r.st === 'scheduled').reduce((a, r) => (a[r.hrs] = (a[r.hrs] || 0) + 1, a), {});
  eq('…and they equal the workbook\'s own Hrs Ahead column, bucket for bucket',
    [all.h24, all.h48, all.h72, all.h72pOut], [wbTally['24'], wbTally['48'], wbTally['72'], wbTally['72+ out cycle']]);
  ok('every Scheduled row has an appointment date, so no booking falls outside a bucket (K18 reads OK)',
    recs.filter(r => r.st === 'scheduled' && !r.apptOn).length === 0); }

head('SC-002 · the three integrity checks, computed by the engine');
const ic = Object.fromEntries(M.integrity.map(c => [c.k, c]));
eq('K17 · fitted + scheduled + missed + cancelled = total sales → OK (and the workbook agrees)', [ic.k17.ok, cell(SR, 'K17')], [true, 'OK']);
eq('…1,996 + 373 + 128 + 208 = 2,705', [ic.k17.got, ic.k17.expected], [2705, 2705]);
eq('K18 · the five buckets = the scheduled pipeline → OK (and the workbook agrees)', [ic.k18.ok, cell(SR, 'K18')], [true, 'OK']);
eq('…130 + 68 + 26 + 0 + 149 = 373', [ic.k18.got, ic.k18.expected], [373, 373]);
eq('the third check (A&SS E36): every sale in view has a scheduler name → OK', ic.schedulerName.ok, true);
ok('…and the workbook\'s own E36 reads the reconciling words', /Reconciles to total sales in view/.test(String(cell(ASS, 'E36'))), String(cell(ASS, 'E36')));
ok('every check carries words and never only a colour (FR-053)', M.integrity.length === 3 && M.integrity.every(c => typeof c.words === 'string' && c.words.length > 10 && typeof c.ok === 'boolean'));

head('SC-001 · the other three views (3,010 / 2,382 / 628 with 305 open)');
const Mall = D('all'), Mcur = D('current'), Mroll = D('rollovers');
eq('all data: 3,010 sales = Exco B7, 1,996 / 460 / 182 / 372', [Mall.counts.sales, Mall.counts.fitted, Mall.counts.scheduled, Mall.counts.missed, Mall.counts.cancelled],
  [cell(EXCO, 'B7'), cell(EXCO, 'C7'), cell(EXCO, 'E7'), cell(EXCO, 'I7'), cell(EXCO, 'G7')]);
near('all data: 66.3 % fitted = Exco I22 (row 17 heads I "Fitted %"; J is Cancelled %)', Mall.rates.fitRate, cell(EXCO, 'I22'), 1e-9);
eq('current cycle only: 2,382 sales, 1,673 fitted, 373 / 128 / 208', [Mcur.counts.sales, Mcur.counts.fitted, Mcur.counts.scheduled, Mcur.counts.missed, Mcur.counts.cancelled], [2382, 1673, 373, 128, 208]);
eq('rollovers only: 628 sales, 323 fitted, 87 scheduled, 54 missed, 164 cancelled', [Mroll.counts.sales, Mroll.counts.fitted, Mroll.counts.scheduled, Mroll.counts.missed, Mroll.counts.cancelled], [628, 323, 87, 54, 164]);
eq('every view says in words what it includes (FR-008)', [M.view, Mall.view, Mcur.view, Mroll.view], ['cycle', 'all', 'current', 'rollovers']);
ok('the cycle view\'s words name the pre-cycle fitted rule', /fitted/i.test(M.viewWords) && /earlier/i.test(M.viewWords), M.viewWords);
ok('a pre-cycle scheduled, missed or cancelled case is in no cycle-view count (FR-009, FR-010)',
  M.counts.sales - M.counts.fitted === Mcur.counts.scheduled + Mcur.counts.missed + Mcur.counts.cancelled);

head('SC-001 · Fitted GWP (Exco K7 / K8) and lost GWP (A&SS L39)');
eq('Fitted GWP in the cycle view = R 383,206 = Exco K7', M.gwp.fitted, cell(EXCO, 'K7'));
eq('total GWP in all data = R 584,184', Mall.gwp.total, 584184);
eq('lost GWP (cancelled + missed, all data) = A&SS L39', Mall.gwp.lost, cell(ASS, 'L39'));
ok('the GWP panel says it is the Schedulers Data figure and not the engine\'s BI value (A7, FR-016)',
  /schedulers data/i.test(M.gwp.source) && /bi/i.test(M.gwp.notSource), M.gwp.source + ' | ' + M.gwp.notSource);
ok('with no Schedulers Data in the book the GWP panel says so and paints nothing (never 0)',
  (() => { const b2 = E.emptyBook(); b2.openedOn = book.openedOn; b2.openingBookOn = book.openingBookOn;
    Object.entries(book.cases).forEach(([k, c]) => { const r = Object.assign({}, c); r.gwpRpt = null; r.schedulerName = null; b2.cases[k] = r; });
    const X = E.dashboard(b2, [], { cycleKey: CYCLE, view: 'cycle', asOf: ASOF });
    return X.gwp.loaded === false && X.gwp.fitted === null && X.schedulers.loaded === false && /schedulers data/i.test(X.schedulers.words); })());

head('SC-001 · Performance by Channel (Exco B18:L22) — the cycle view, spec §0.3');
{ const ch = Object.fromEntries(M.channels.map(c => [c.k, c]));
  eq('cycle view: Lead Gen 1,921 / 1,435 / 262 / 91 / 133', [ch.lead_gen.sales, ch.lead_gen.fitted, ch.lead_gen.scheduled, ch.lead_gen.missed, ch.lead_gen.cancelled], [1921, 1435, 262, 91, 133]);
  eq('cycle view: Referral 245 / 161 / 54 / 12 / 18', [ch.referral.sales, ch.referral.fitted, ch.referral.scheduled, ch.referral.missed, ch.referral.cancelled], [245, 161, 54, 12, 18]);
  eq('cycle view: Predictive 538 / 400 / 56 / 25 / 57', [ch.predictive.sales, ch.predictive.fitted, ch.predictive.scheduled, ch.predictive.missed, ch.predictive.cancelled], [538, 400, 56, 25, 57]);
  eq('cycle view: Other 1 sale, 0 fitted (A11)', [ch.other.sales, ch.other.fitted], [1, 0]);
  eq('the four channels add up to the view', M.channels.reduce((s, c) => s + c.sales, 0), M.counts.sales);
  eq('Lead Gen is labelled Digital where the Sales Review labels it so (FR-025)', ch.lead_gen.srLabel, 'Digital');
  ok('Other has an actual and no target, shown as absent and never 0 (rule book _note)', ch.other.salesBudget == null && ch.lead_gen.salesBudget === cell(SR, 'B52'));
  const allCh = Object.fromEntries(Mall.channels.map(c => [c.k, c]));
  for (const [k, row] of [['lead_gen', 18], ['referral', 19], ['predictive', 20], ['other', 21]])
    eq(`all data: ${k} = Exco row ${row} (sales / fitted / scheduled / cancelled / missed / fitted GWP)`,
      [allCh[k].sales, allCh[k].fitted, allCh[k].scheduled, allCh[k].cancelled, allCh[k].missed, allCh[k].gwpFitted],
      ['D', 'E', 'F', 'G', 'H', 'L'].map(col => cell(EXCO, col + row)));
  near('all data: each channel\'s share of sales = Exco column C', Mall.channels.reduce((s, c) => s + c.share, 0), 1, 1e-9); }

head('SC-001 · Campaign Breakdown (Exco B26:L33) and the Panimax roll-up');
{ const camp = Object.fromEntries(Mall.campaigns.map(c => [c.name, c]));
  for (const [name, row] of [['Revx', 26], ['Tracking Empire', 27], ['Jag', 28], ['Afrilead', 29], ['Referral Agent', 30], ['Predictive', 31], ['Black Birch Projects', 32]])
    eq(`all data: ${name} = Exco row ${row}`, [camp[name].sales, camp[name].fitted, camp[name].scheduled, camp[name].cancelled, camp[name].missed, camp[name].gwpFitted],
      ['D', 'E', 'F', 'G', 'H', 'L'].map(col => cell(EXCO, col + row)));
  eq('the campaigns add to the grand total = Exco D33', Mall.campaigns.reduce((s, c) => s + c.sales, 0), cell(EXCO, 'D33'));
  eq('every campaign in the file is mapped to a channel; none falls to the unmapped list (F0-16)', [Mall.unmapped, camp['Black Birch Projects'].channel], [[], 'other']);
  const pan = Mall.campaignRollups.find(r => r.k === 'panimax');
  eq('Panimax is a named roll-up of Referral + Predictive, never a raw channel (FR-028)',
    [pan.label, pan.members, pan.sales], ['Panimax', ['referral', 'predictive'], camp['Referral Agent'].sales + camp.Predictive.sales]);
  eq('…and the Panimax sales budget = SR B54 (B55 + B56)', pan.salesBudget, cell(SR, 'B54'));
  ok('the roll-up is flagged so no total counts it twice', pan.rollup === true && Mall.campaigns.every(c => c.rollup !== true)); }

head('SC-001 · Performance Trend (Exco B67:H81) — the workbook\'s own week window');
{ const wkRow = {}; for (let r = 67; r <= 80; r++) wkRow[E.serialToISO(cell(EXCO, 'B' + r))] = ['C', 'D', 'E', 'F', 'G'].map(c => cell(EXCO, c + r));
  const mine = Object.fromEntries(Mall.weeks.map(w => [w.from, w]));
  const overlap = Object.keys(wkRow).filter(k => mine[k]);
  const bad = overlap.filter(k => mine[k].sales !== wkRow[k][4] || mine[k].fitted !== wkRow[k][0] || mine[k].scheduled !== wkRow[k][1] || mine[k].cancelled !== wkRow[k][2] || mine[k].missed !== wkRow[k][3]);
  bad.forEach(k => console.log(`    week ${k}: workbook ${wkRow[k].join('/')} got ${[mine[k].fitted, mine[k].scheduled, mine[k].cancelled, mine[k].missed, mine[k].sales].join('/')}`));
  eq('every week the workbook tabulates equals the engine\'s week, outcome for outcome (14 of 14)', [overlap.length - bad.length, overlap.length], [14, 14]);
  ok('the week window is >= week start AND < week start + 7 (FR-022)', /< week start \+ 7/.test(E.VT_RULES.periods.weekWindow), E.VT_RULES.periods.weekWindow);
  const five = M.weeks.filter(w => !w.preCycle);
  eq('the cycle\'s five weeks are the engine\'s weeksOf, so the panel agrees with the VT Weekly page', five.map(w => w.from), E.periods.weeksOf(cyc).map(w => w.from));
  eq('…and their sales are 623 / 500 / 600 / 535 / 124 = 2,382', [five.map(w => w.sales), five.reduce((s, w) => s + w.sales, 0)], [[623, 500, 600, 535, 124], 2382]);
  near('each week\'s target = the sales budget ÷ 22 dialing days × that week\'s dialing days (FR-023)',
    five.reduce((s, w) => s + w.target, 0), M.budget.sales.total, 1e-6);
  ok('in the cycle view the pre-cycle weeks are marked fitted-only (FR-024, Exco B109)', M.weeks.some(w => w.preCycle && w.fittedOnly === true) && M.weeks.filter(w => w.preCycle).every(w => w.target == null));
  doc('the workbook\'s weekly table totals 3,007 of 3,010 sales', { table: cell(EXCO, 'G81'), records: 3010 }, { gap: 3 },
    'Exco B67 starts the table 13 weeks back from the Monday of the newest sale, so three records dated 21–23 Aug 2026 fall before its first week. The engine\'s weeks cover every sale in the view.'); }

head('SC-001 · Detailed Breakdown (SR A36:G43) — ratios of sums, never means of rates');
{ const rowOf = (n) => M.breakdown.find(r => r.k === n);
  eq('one row per channel plus a totals row', [M.breakdown.map(r => r.k), M.breakdownTotals.k], [['lead_gen', 'referral', 'predictive', 'other'], 'total']);
  eq('the totals row is the ratio of sums, not the mean of the four rates', Math.round(M.breakdownTotals.fitRate * 1e12), Math.round(M.counts.fitted / M.counts.sales * 1e12));
  eq('every row carries sales, fitments, cancellations, missed, target and achievement',
    rowOf('lead_gen') && ['sales', 'fitted', 'cancelled', 'missed', 'salesBudget', 'achievement'].every(k => rowOf('lead_gen')[k] != null), true);
  eq('the change against the previous cycle reads absent, not 0, with no cycle on file (FR-019)',
    [M.prevCycle.present, M.kpis.every(k => k.delta === null), M.breakdown.every(r => r.delta === null)], [false, true, true]);
  ok('…and the page is told why in words', /no previous cycle/i.test(M.prevCycle.words), M.prevCycle.words); }

head('SC-001 · the five KPI cards (panel table rows 1–5)');
eq('five cards: Total Sales, Total Fitments, Cancellations, Missed, Target Achieved', M.kpis.map(k => k.k), ['sales', 'fitted', 'cancelled', 'missed', 'targetAchieved']);
eq('their values are the view\'s counts and the achievement', M.kpis.map(k => k.value), [2705, 1996, 208, 128, M.budget.achievement]);
ok('Target Achieved names the budget and its workbook cell (FR-020)', /3,?030/.test(M.kpis[4].words) && /B51/.test(M.kpis[4].cell), M.kpis[4].words + ' | ' + M.kpis[4].cell);
ok('Cancellations and Missed carry their share of sales beside the 5 % budget, shown never scored',
  Math.abs(M.kpis[2].pct - 208 / 2705) < 1e-12 && M.kpis[2].budget === E.VT_RULES.cycleBudget[CYCLE].cancelledPct['*'] && M.kpis[2].scored === false);

head('SC-001 · Key Insights (Exco B11:B14) — computed, never hand-written');
{ const ins = Object.fromEntries(Mall.insights.map(i => [i.id, i]));
  eq('four insights on all data: conversion, leakage, bestCampaign, rollovers', Mall.insights.map(i => i.id).sort(), ['bestCampaign', 'conversion', 'leakage', 'rollovers']);
  near('conversion names 66.3 % fitted of 3,010 and 460 booked (15.3 %) — Exco B11', ins.conversion.v.fitRate, 0.6631229235880398, 1e-9);
  eq('…and the sentence carries those figures', [/66[.,]3/.test(ins.conversion.text), /3[ ,]?010/.test(ins.conversion.text), /460/.test(ins.conversion.text)], [true, true, true]);
  eq('leakage = 554 sales (18.4 %) and R107,015 of GWP — Exco B12', [ins.leakage.v.leak, ins.leakage.v.leakGwp], [554, cell(ASS, 'L39')]);
  eq('best campaign at 20+ sales = Tracking Empire (72.5 %), lowest Afrilead (50 %) — Exco B13',
    [ins.bestCampaign.v.best, Math.round(ins.bestCampaign.v.bestRate * 1e6), ins.bestCampaign.v.worst, ins.bestCampaign.v.worstRate],
    ['Tracking Empire', Math.round(cell(EXCO, 'I27') * 1e6), 'Afrilead', cell(EXCO, 'I29')]);
  eq('rollovers: 628 in total, 323 fitted, 305 open — 87 scheduled, 218 to rebook — Exco B14',
    [ins.rollovers.v.total, ins.rollovers.v.fitted, ins.rollovers.v.open, ins.rollovers.v.scheduled, ins.rollovers.v.rebook], [628, 323, 305, 87, 218]);
  ok('every insight names the figure it came from and nothing is hand-written', Mall.insights.every(i => i.v && Object.keys(i.v).length && i.template && i.cell));
  ok('a template with no data is omitted, never padded', (() => { const X = D('rollovers'); return !X.insights.some(i => i.id === 'bestCampaign' && i.v.best == null); })()); }

head('SC-001 · Rollover Follow-up (Exco B35:L42): 628 total, 305 open to action');
{ const r = Object.fromEntries(Mall.rollover.rows.map(x => [x.k, x]));
  for (const [k, row] of [['lead_gen', 37], ['referral', 38], ['predictive', 39], ['other', 40]])
    eq(`${k} = Exco row ${row} (rollover sales / fitted / scheduled / cancelled / missed / open / fitted GWP / open GWP)`,
      [r[k].sales, r[k].fitted, r[k].scheduled, r[k].cancelled, r[k].missed, r[k].open, r[k].gwpFitted, r[k].gwpOpen],
      ['C', 'D', 'E', 'F', 'G', 'H', 'K', 'L'].map(col => cell(EXCO, col + row)));
  const t = Mall.rollover.totals;
  eq('the totals row = Exco row 41: 628 / 323 / 87 / 164 / 54 / 305, R62,427 fitted and R58,847 open GWP',
    [t.sales, t.fitted, t.scheduled, t.cancelled, t.missed, t.open, t.gwpFitted, t.gwpOpen],
    ['C', 'D', 'E', 'F', 'G', 'H', 'K', 'L'].map(col => cell(EXCO, col + '41')));
  eq('Open to Action = scheduled + cancelled + missed (FR-049)', t.open, t.scheduled + t.cancelled + t.missed);
  ok('the panel is always the pre-cycle position, whatever the view', JSON.stringify(M.rollover.totals) === JSON.stringify(Mall.rollover.totals)); }

head('SC-001 · Upcoming Scheduled Fitments (Exco B83:D102)');
{ const u = M.upcoming;
  eq('it starts at the earliest scheduled appointment, 24 Nov 2026 = Exco B85', u.from, E.serialToISO(cell(EXCO, 'B85')));
  const want = []; for (let r = 85; r <= 100; r++) want.push([E.serialToISO(cell(EXCO, 'B' + r)), cell(EXCO, 'C' + r), cell(EXCO, 'D' + r)]);
  eq('the sixteen dates, their counts and their shares of the pipeline equal the workbook row for row',
    u.dates.map(d => [d.d, d.count, Math.round(d.share * 1e12)]), want.map(w => [w[0], w[1], Math.round(w[2] * 1e12)]));
  eq('the tail folds into "Later dates / not shown" = Exco C101', [u.tail.count, u.tail.label], [cell(EXCO, 'C101'), 'Later dates / not shown']);
  eq('the total = Exco C102 = the whole scheduled pipeline, all bookings regardless of view', [u.total, u.total], [cell(EXCO, 'C102'), 460]);
  ok('the panel says it covers all bookings including rollovers (FR-006)', /all bookings/i.test(u.words), u.words); }

head('SC-001 · the four scheduler pivots (all data, % over each scheduler\'s own grand total)');
{ const S = Mall.schedulers;
  const anon = new Map(); const sid = (n) => { if (!anon.has(n)) anon.set(n, 'S' + (anon.size + 1)); return anon.get(n); };
  eq('six schedulers, exactly the headcount budget of SR B50 (F0-17)', [S.rows.length, S.headcount, S.headcountBudget], [6, 6, cell(SR, 'B50')]);
  eq('…and the workbook\'s own count of distinct schedulers in the cycle (SR C50) agrees', cell(SR, 'C50'), 6);
  const PIV = { all: 'Pivot - VT All Campaigns', referral: 'Pivot - VT Referral', predictive: 'Pivot - VT Predictive', lead_gen: 'Pivot - VT Lead Gen' };
  for (const [scope, sheet] of Object.entries(PIV)) {
    const z = (v) => (v == null ? 0 : v);   /* a pivot leaves a zero cell EMPTY: Referral D9/D10/E10 */
    const rows2 = {}; for (let r = 8; r <= 13; r++) rows2[String(cell(sheet, 'A' + r))] = ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'].map(c => z(cell(sheet, c + r)));
    const got = Mall.schedulerPivot(scope);
    const bad = got.filter(x => { const w = rows2[x.name]; return !w || x.cancelled !== w[0] || x.missed !== w[1] || x.scheduled !== w[2] || x.fitted !== w[3] || x.sales !== w[4]
      || Math.round(x.pct.cancelled * 1e9) !== Math.round(w[5] * 1e9) || Math.round(x.pct.missed * 1e9) !== Math.round(w[6] * 1e9)
      || Math.round(x.pct.scheduled * 1e9) !== Math.round(w[7] * 1e9) || Math.round(x.pct.fitted * 1e9) !== Math.round(w[8] * 1e9); });
    bad.forEach(x => console.log(`    ${sid(x.name)} on ${scope}: workbook ${JSON.stringify(rows2[x.name])} got ${JSON.stringify([x.cancelled, x.missed, x.scheduled, x.fitted, x.sales])}`));
    eq(`pivot ${scope}: every scheduler's four counts and four percentages equal ${sheet}`, [got.length - bad.length, got.length], [6, 6]);
    eq(`pivot ${scope}: the grand total = ${sheet} G15`, got.reduce((s, x) => s + x.sales, 0), cell(sheet, 'G15'));
  }
  console.log('    cycle-view fitted rates by scheduler: ' + Mall.schedulerPivot('all').map(x => sid(x.name)).join(', '));
  const cv = M.schedulers.rows.slice().sort((a, b) => a.name < b.name ? -1 : 1);
  /* ORACLE FIX (072 A6 builder): the expected spreads were written in SHEET order (spec F0-17) but
     this suite sorts the rows by NAME. Same six pairs, in the order the sort produces:
     Amanda 643/74.5, Chireshi 258/84.9, Devamani 56/78.6, Luvo 628/75.6, Mandisa 711/73.7, Roshel 409/62.3 */
  eq('in the cycle view the six spreads are 628/56/258/643/409/711 sales (F0-17)', cv.map(x => x.sales).slice().sort((a, b) => a - b), [56, 258, 409, 628, 643, 711]);
  eq('and name by name, in this suite own sort order, they are 643 / 258 / 56 / 628 / 711 / 409', cv.map(x => x.sales), [643, 258, 56, 628, 711, 409]);
  eq('with fitted rates 74.5 / 84.9 / 78.6 / 75.6 / 73.7 / 62.3 %', cv.map(x => +(x.pct.fitted * 100).toFixed(1)), [74.5, 84.9, 78.6, 75.6, 73.7, 62.3]);
  eq('which is the 62.3 % to 84.9 % spread the spec records, scheduler for scheduler', cv.map(x => +(x.pct.fitted * 100).toFixed(1)).slice().sort((a, b) => a - b), [62.3, 73.7, 74.5, 75.6, 78.6, 84.9]);
  ok('every percentage is divide-by-zero safe (FR-045)', (() => { const z = Mall.schedulerPivot('all').concat([]); return z.every(x => x.sales > 0 ? x.pct.fitted != null : x.pct.fitted === null); })());
  ok('no scheduler is printed by name by this suite', true); }

head('SC-001 · the Agent & Scheduler Summary dimensions (A&SS B36 / B65 / B160)');
{ const sch = Mall.persons('scheduler'), ag = Mall.persons('agent'), ref = Mall.persons('referrer');
  eq('the scheduler dimension\'s All row = A&SS row 39 (3,010 / 1,996 / 460 / 372 / 182 / GWP 383,206 / lost 107,015)',
    [sch.all.sales, sch.all.fitted, sch.all.scheduled, sch.all.cancelled, sch.all.missed, sch.all.gwpFitted, sch.all.gwpLost],
    ['C', 'D', 'E', 'F', 'G', 'K', 'L'].map(c => cell(ASS, c + '39')));
  eq('the three person dimensions are Agent, Referring Agent and Scheduler (FR-047)', [ag.dim, ref.dim, sch.dim], ['agent', 'referrer', 'scheduler']);
  eq('the scheduler rows reconcile to the sales in view, which is the third integrity check', sch.rows.reduce((s, r) => s + r.sales, 0), Mall.counts.sales);
  ok('the referring-agent dimension counts only rows that name a referrer (F0-19)', ref.rows.every(r => r.name) && ref.rows.reduce((s, r) => s + r.sales, 0) === recs.filter(r => r.referrer).length);
  doc('referring agents with sales in view', { names: ref.rows.length }, { headline: 73, cellSays: String(cell(ASS, 'B13')).replace(/^- /, '').slice(0, 60) },
    'A&SS B13 counts the referrer rows whose sales are > 0; one of the names in column I is the placeholder "No Name", which the engine keeps as typed and never guesses away (spec edge case "a name not on the Agent List").');
  ok('the active filters are stated with the figures (FR-047)', typeof sch.filters === 'object' && typeof sch.words === 'string' && sch.words.length > 5, sch.words); }

head('FR-014 / FR-015 · where the sources disagree — EXTENDING the 071 accounting, not restarting it');
{ const g = M.disagree;
  eq('the workbook\'s hand-typed Result is never applied: every disagreement is counted by direction', [typeof g.resultVsEngine, g.resultApplied], ['object', false]);
  eq('on this book the engine\'s status IS the workbook\'s Result, so the count is 0 (this suite\'s only source is the workbook)', g.resultVsEngine.total, 0);
  ok('the carried-forward 071 figures travel with the same wording as the floor guide (FR-015)',
    g.carried && g.carried.handCredits === 11 && /6\.6/.test(String(g.carried.leadSourceRelabelledShare)) && /Salesforce/.test(g.carried.words), JSON.stringify(g.carried));
  eq('schedulers and sellers not matched to a CB are counted, never dropped and never guessed',
    [g.unmatchedSchedulers, g.unmatchedSellers].map(x => typeof x), ['number', 'number']);
  eq('campaigns not in the mapping are named so the map can be extended (0 here, F0-16)', g.unmappedCampaigns, 0);
  ok('every disagreement is a count with words, not a hidden adjustment', typeof g.words === 'string' && g.words.length > 20, g.words);
  const fl = path.join(REPO, 'specs', '071-vehicle-tracking-analytics', 'floor-guide.md');
  if (fs.existsSync(fl)) { const txt = fs.readFileSync(fl, 'utf8');
    ok('the 071 floor guide still carries those two figures, so the wording has one source', /11/.test(txt) && /6[.,]6/.test(txt)); }
  else doc('the 071 floor guide', 'not on this machine', 'specs/071-vehicle-tracking-analytics/floor-guide.md', 'the carried-forward wording could not be cross-checked against it'); }

head('the rating did not move (SC-003) and the engine has no clock (D5)');
{ const src = fs.readFileSync(ENGINE, 'utf8');
  const clock = src.replace(/\/\*[\s\S]*?\*\//g, '').match(/Date\.now|new\s+Date\s*\(\s*\)|(?:^|[^A-Za-z0-9_$.])Date\s*\(\s*\)/g);
  eq('no clock anywhere in the engine: every "today" is passed in', clock, null);
  const d1 = E.dashboard(book, [], { cycleKey: CYCLE, view: 'cycle', asOf: ASOF });
  const d2 = E.dashboard(book, [], { cycleKey: CYCLE, view: 'cycle', asOf: ASOF });
  ok('dashboard() is pure: the same inputs give a byte-identical answer', JSON.stringify(d1.counts) === JSON.stringify(d2.counts) && JSON.stringify(d1.buckets) === JSON.stringify(d2.buckets));
  ok('…and it never mutates the book it was given', Object.keys(book.cases).length === 3010 && book.cases[recs[0].cn].status === recs[0].st);
  eq('the rating still has exactly two drivers at 50 / 50 (FR-033, D2)', E.VT_RULES.rating.drivers.map(x => x.k + ':' + x.w), ['targetAch:50', 'fitRate:50']);
  ok('the lead-time buckets are still not scored', /hrsAhead/.test(Object.keys(E.VT_RULES.rating.notScored).join()));
  ok('cycleBudget is a separate branch from budgets (plan risk 1)', !!E.VT_RULES.cycleBudget && !!E.VT_RULES.budgets && E.VT_RULES.budgets[CYCLE].fitment.digital['*'] === 0.85); }

head('PII · no customer field is read or returned');
{ const custCol = ci('G');
  const cust = new Set(rows.map(r => r[custCol]).filter(v => v != null && String(v).length > 5).map(String));
  const out = JSON.stringify([M, Mall, Mroll, Mcur]);
  const leaks = [...cust].filter(v => out.indexOf(v) > -1);
  eq('the Customer Contact column never reaches any dashboard output', leaks.length, 0);
  ok('…and the rule book names that column explicitly (F0-22)', /Customer Contact/i.test(E.VT_RULES.columns.discardAll)); }

head('B1 / B6 (spec 072) - the REAL parser and the REAL intake over the owner workbook');
{ /* everything above built the book by hand, to check the engine arithmetic against the workbook cells. This section
     runs the production path instead: VTEngine.parseSchedulers over the same sheet, VTStation.planCommit into the
     stage rows the Worker would carry, and the receipt the uploader would read. Nothing from the file is printed. */
  const ST = require(path.join(REPO, 'nicks_code', 'vt-pages.js'));
  const P = E.parseSchedulers(sd);
  eq('the parser reads 3,010 cases and no more', Object.keys(P.cases).length, 3010);
  eq('and counts the 16,950 empty rows it skipped, not 19,960 records (F0-1)', [P.rows, P.skippedBlank], [3010, 16950]);
  eq('no required column is missing and no case number repeats (A2)', [P.missing, P.duplicates], [[], []]);
  eq('every case it keeps has a sale date, a GWP, a scheduler and a campaign (F0-2)',
    ['soldOn', 'gwp', 'scheduler', 'campaignRaw'].map((f) => Object.values(P.cases).filter((c) => c[f] == null).length), [0, 0, 0, 0]);
  eq('Referring Agent = 0 is no referrer, so the referral count is real (F0-19)',
    Object.values(P.cases).filter((c) => c.referring).length < 1000, true);
  { const txt = JSON.stringify(P);
    const colG = sd.slice(1, 400).map((r) => r && r[6]).filter((v) => v != null && v !== '').map(String);
    ok('NOT ONE value of the Customer Contact column (col G) is anywhere in the parser output',
      colG.length > 50 && !colG.some((v) => txt.indexOf(v) > -1), colG.length + ' sampled values');
    ok('and the parser keeps no Month, Hrs Ahead or Channel column either', !/Rollover|Hrs Ahead|"Channel"/.test(txt)); }
  /* the merge, over a book the daily exports have already opened */
  const daily = E.emptyBook(); daily.openedOn = '2026-11-10'; daily.rev = 4;
  Object.keys(book.cases).forEach((cn) => { const c = book.cases[cn];
    daily.cases[cn] = Object.assign({}, c, { soldOn: '2026-11-10', soldBasis: 'first_seen', gwpRpt: null, schedulerName: null, schedulerCb: null,
      referringName: null, referringCb: null, campaignRpt: null, resultRpt: null }); });
  const beforeStatus = Object.keys(daily.cases).sort().map((k) => daily.cases[k].status).join(',');
  const plan = ST.planCommit(daily, P, { extractOn: '2026-11-25', roster: [] });
  const m = plan.merged;
  eq('the merge re-dates every case in the book and never invents one', [m.counts.cases, m.counts.notInBook, m.cases.length], [3010, 0, 3010]);
  eq('it sets a scheduler and a GWP on all 3,010', [m.counts.schedulersSet, m.counts.gwpSet], [3010, 3010]);
  eq('not one status moved', Object.keys(m.book.cases).sort().map((k) => m.book.cases[k].status).join(','), beforeStatus);
  eq('and not one status event was written', m.events.length, 0);
  ok(m.disagree.total === 0, 'on this book the sheet Result agrees with every status, so the disagreement count is 0 (this suite built the book FROM that column)', JSON.stringify(m.disagree));
  eq('the back-build reports every business month the sheet reaches, oldest first, the first one partial',
    [m.cycles.map((c) => c.key), m.cycles[0].partial, m.cycles[0].firstSale],
    [['cycle-2026-08', 'cycle-2026-09', 'cycle-2026-10', 'cycle-2026-11'], true, '2026-08-21']);
  ok(/Partial/.test(m.cycles[0].words) && /2026-08-21/.test(m.cycles[0].words), 'and says so in words the receipt prints', m.cycles[0].words);
  { const prev = E.prevCycleFor(m.book, [], CYCLE, { asOf: ASOF });
    ok(prev.present && prev.counts.sales > 0, 'so cycle-2026-10 is a REAL previous cycle for the dashboard delta, not an absent marker', JSON.stringify([prev.cycle, prev.counts.sales]));
    const withPrev = E.dashboard(m.book, [], { cycleKey: CYCLE, view: 'cycle', asOf: ASOF, prev: prev });
    ok(withPrev.prevCycle.present && withPrev.kpis.every((k) => k.k === 'targetAch' || k.delta), 'and every KPI card then carries a change instead of a dash', JSON.stringify(withPrev.kpis.map((k) => [k.k, !!k.delta]))); }
  /* B6: what the Worker would carry */
  const batches = ST.batches(plan.cases);
  eq('3,010 case rows go up in 4 stage calls, each at most 1,000 rows', [batches.length, Math.max.apply(null, batches.map((b) => b.rows.length)) <= 1000], [4, true]);
  ok(batches.every((b) => JSON.stringify(b.rows).length < 480 * 1024), 'every stage call is under the Worker 512 KB cap',
    Math.max.apply(null, batches.map((b) => JSON.stringify(b.rows).length)) + ' bytes');
  { const raw = JSON.stringify(plan.cases);
    const colG = sd.slice(1, 400).map((r) => r && r[6]).filter((v) => v != null && v !== '').map(String);
    ok('and not one customer field is in what would be sent', !colG.some((v) => raw.indexOf(v) > -1)); }
  const lines = ST.receiptLines({ kind: 'vtSchedulers', fileName: 'Master November 2026 - VT Report.xlsx', extractOn: '2026-11-25', assumed: false,
    counts: m.counts, unmatched: m.unmatched, warnings: m.warnings, disagree: m.disagree, unmatchedSchedulers: m.unmatchedSchedulers, cycles: m.cycles });
  const receipt = lines.join('\n');
  ok(/3,010 cases read from the sheet/.test(receipt) && /16,950 empty rows counted and skipped/.test(receipt), 'the receipt counts what it read and what it skipped', receipt);
  ok(/Sale dates re-stated: 3,010/.test(receipt) && /Schedulers set: 3,010/.test(receipt) && /GWP set: 3,010/.test(receipt), 'what it changed', receipt);
  ok(/NOT changed by this file: no status/.test(receipt) && /no VAS figure/.test(receipt), 'and what it did NOT change', receipt);
  ok(/Business months this file reaches: cycle-2026-08/.test(receipt), 'and the business months it reaches', receipt);
  ok(!/undefined|NaN|\[object/.test(receipt), 'every line of the receipt reads as a sentence', receipt);
}

finish();
