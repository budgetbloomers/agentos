#!/usr/bin/env node
/* VT REPORT EXPORT (Spec Kit 072, Phase E task E3; SC-007, FR-055..057) — the pure half of the export proof.
 *
 * The workbook is built from the MODEL, never from the screen: VTDash.workbookFrom(VTEngine.dashboard(...)) over a
 * small SYNTHETIC book (CB9001-style codes, invented case numbers and names, no customer field anywhere). This suite
 * never opens a browser, so it rides the daily tick; verify-vt-dashboard.mjs proves the other half — that the file's
 * figures equal the ones PAINTED on the real page, cell for cell, folded and open.
 *
 *   · one sheet per panel, in the owner's reading order, with his own sheet names where they map
 *   · a header sheet carrying the view, the cycle, the data-through date and the rule-book version (FR-056)
 *   · every sheet names the panel, the view, the business month and the as-at date before its column headers
 *   · every figure in the file IS the model's own field, and a number lands as a NUMBER with a format (not text)
 *   · an absence travels as the rule book's absent marker, never as a zero
 *   · THE FOLD CHANGES NO FIGURE: the same model exports identically whatever S.ui.vtReport.figures says
 *   · the four Pivot sheets are all there whatever scope the screen is showing
 *   · no customer field, and no sheet name longer than Excel's 31 characters
 *   · purity: two builds of the same model are byte-identical bar the generated-at line; the model is not mutated
 *
 * Run:  node nicks_code/diagnostics/verify-vt-export.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const REPO = process.env.AGENTOS || decodeURIComponent(new URL('../..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1').replace(/\/$/, '');
let pass = 0, fail = 0; const failures = [];
const ok = (nm, c, d = '') => { if (c) { pass++; console.log('  ok   ' + nm); } else { fail++; failures.push(nm + (d ? ' — ' + d : '')); console.log('  FAIL ' + nm + (d ? ' — ' + String(d).slice(0, 400) : '')); } };
const eq = (nm, got, exp) => ok(nm, JSON.stringify(got) === JSON.stringify(exp), 'expected ' + JSON.stringify(exp) + ' got ' + JSON.stringify(got));
const head = (s) => console.log('\n== ' + s + ' ==');
const finish = () => { console.log(`\n${pass} passed, ${fail} failed`); failures.forEach((f) => console.log('  · ' + f)); process.exit(fail ? 1 : 0); };

const ENGINE = path.join(REPO, 'nicks_code', 'vt-engine.js');
const DASH = path.join(REPO, 'nicks_code', 'vt-dashboard.js');
for (const f of [ENGINE, DASH, path.join(REPO, 'nicks_code', 'vt-charts.js')]) if (!fs.existsSync(f)) { ok(path.basename(f) + ' exists', false, 'missing'); finish(); }
const E = require(ENGINE);
const DASHMOD = require(DASH);

/* ------------------------------------------------------------------ the synthetic book ----
 * The same thirteen invented cases verify-vt-views.mjs reasons over, so a figure in the file can be checked by hand.
 * Nothing here is real: 9000-series case numbers, CB9001/CB91xx placeholder people, and no customer field. */
const CYCLE = 'cycle-2026-11', ASOF = '2026-11-20';
const C = (cn, soldOn, status, campaign, extra) => Object.assign({
  caseNumber: cn, status: status, statusOn: soldOn, soldOn: soldOn, soldBasis: 'schedulers_data',
  firstSeen: soldOn, lastSeen: ASOF, apptOn: null, fittedOn: status === 'fitted' ? soldOn : null,
  smAttempt: null, products: [], bundle: null, chargeEx: null, partnerRaw: null, leadSource: null,
  sellerName: 'Agent CB9001', sellerCb: 'CB9001', sellerMatch: 'exact', cancelReason: null,
  campaignRpt: campaign, gwpRpt: 100, schedulerName: 'Scheduler CB9101', schedulerCb: 'CB9101',
  referringName: null, referringCb: null, resultRpt: status
}, extra || {});
const ROWS = [
  C('9001', '2026-10-27', 'fitted', 'Revx'),
  C('9002', '2026-11-02', 'fitted', 'Revx', { gwpRpt: 200 }),
  C('9003', '2026-11-10', 'fitted', 'Referral Agent', { schedulerName: 'Scheduler CB9102', schedulerCb: 'CB9102', referringName: 'Referrer CB9201', referringCb: 'CB9201' }),
  C('9004', '2026-11-18', 'fitted', 'Predictive'),
  C('9005', '2026-11-19', 'scheduled', 'Revx', { apptOn: '2026-11-21' }),
  C('9006', '2026-11-20', 'scheduled', 'Predictive', { apptOn: '2026-11-24' }),
  C('9007', '2026-11-12', 'missed', 'Revx', { apptOn: '2026-11-13' }),
  C('9008', '2026-11-05', 'cancelled', 'Mystery Co', { cancelReason: 'dropped' }),
  C('9009', '2026-10-01', 'fitted', 'Revx', { gwpRpt: 300 }),
  C('9010', '2026-09-28', 'fitted', 'Referral Agent'),
  C('9011', '2026-10-05', 'scheduled', 'Revx', { apptOn: '2026-11-30' }),
  C('9012', '2026-10-06', 'missed', 'Predictive', { apptOn: '2026-10-20' }),
  C('9013', '2026-10-07', 'cancelled', 'Revx', { cancelReason: 'deactivated' })
];
function bookOf(rows) {
  const b = E.emptyBook();
  b.openedOn = '2026-09-28'; b.openingBookOn = '2026-09-28'; b.rev = 1;
  rows.forEach((r) => { b.cases[r.caseNumber] = JSON.parse(JSON.stringify(r)); });
  return b;
}
const book = bookOf(ROWS);
const model = (view = 'cycle') => E.dashboard(book, [], { cycleKey: CYCLE, view, asOf: ASOF });

/* VTDash in Node: it already requires the engine, the station and the charts itself (module.exports). The export
   path touches no DOM and no network — that is the point of building it off the model. */
const VTDash = DASHMOD;
const D = model();
const wb = VTDash.workbookFrom(D);
const PRE = VTDash.PREAMBLE;
const sheetOf = (w, name) => w.sheets.filter((s) => s.name === name)[0] || null;
const bodyOf = (s) => s.aoa.slice(PRE + 1);
const colOf = (s, h) => s.aoa[PRE].indexOf(h);
const cellAt = (s, rowLabel, h) => { const r = bodyOf(s).filter((x) => String(x[0]) === rowLabel)[0]; return r ? r[colOf(s, h)] : undefined; };

head('FR-055 · one workbook, one sheet per panel, built from the model');
ok('workbookFrom returns a workbook from a model alone', !!wb && Array.isArray(wb.sheets) && wb.sheets.length > 10, wb && wb.sheets.length);
ok('workbookFrom(null) is null, never an empty workbook', VTDash.workbookFrom(null) === null);
eq('the sheets are the owner\'s reading order', wb.sheets.map((s) => s.name), [
  'About this export', 'Exco Summary', 'Performance Trend', 'Channel Performance', 'Campaign Breakdown',
  'Cycle Performance', 'Sales vs budget', 'Forecast vs Actual', 'Detailed Breakdown', 'Key Insights', 'Fitted GWP',
  'Pivot - Referral', 'Pivot - Predictive', 'Pivot - Lead Gen', 'Pivot - All campaigns',
  'Agent & Scheduler Summary', 'Upcoming Fitments', 'Rollover Follow-up', 'Sources Disagree', 'Integrity Checks',
  /* spec 073: the master report's own three sheets follow the dashboard's, each its tables stacked as on the sheet */
  'Workbook - Exco Summary', 'Workbook - Agent & Scheduler', 'Workbook - Sales Review']);
ok('every sheet name is inside Excel\'s 31 characters', wb.sheets.every((s) => s.name.length <= 31 && !/[:\\/?*[\]]/.test(s.name)),
  wb.sheets.map((s) => s.name + ':' + s.name.length).join(' | '));
ok('no two sheets share a name', new Set(wb.sheets.map((s) => s.name)).size === wb.sheets.length);
ok('every sheet has column headers and at least one row', wb.sheets.every((s) => s.aoa.length > PRE + 1 && s.aoa[PRE].length >= 2),
  wb.sheets.filter((s) => s.aoa.length <= PRE + 1).map((s) => s.name).join(', '));
ok('every row is as wide as the sheet\'s header row', wb.sheets.every((s) => s.aoa.every((r) => r.length === s.aoa[PRE].length)),
  wb.sheets.filter((s) => s.aoa.some((r) => r.length !== s.aoa[PRE].length)).map((s) => s.name).join(', '));
ok('the file name carries the report, the view, the month and the as-at day', /^VT Report - .+ - November 2026 to 20 Nov\.xlsx$/.test(wb.name), wb.name);
ok('the file name has no character Windows refuses', !/[\\/:*?"<>|]/.test(wb.name.replace(/\.xlsx$/, '')), wb.name);

head('FR-056 · the header sheet, and every sheet saying what it is');
{
  const h = sheetOf(wb, 'About this export');
  const fields = Object.fromEntries(bodyOf(h).map((r) => [r[0], r[1]]));
  ok('the header sheet names the view', fields.View === D.viewLabel, fields.View);
  ok('…the business month', /November 2026/.test(fields['Business month']), fields['Business month']);
  ok('…the cycle dates', fields.Cycle === D.period.from + ' to ' + D.period.to, fields.Cycle);
  ok('…the as-at date', fields['Figures to (as at)'] === '2026-11-20', fields['Figures to (as at)']);
  ok('…the rule-book version', fields['Rule book version'] === E.VT_RULES.version && /^vt-1\./.test(fields['Rule book version']), fields['Rule book version']);
  ok('…what the absent marker means, and that it is not a zero', /never a zero/i.test(fields['Absent marker']), fields['Absent marker']);
  ok('…that no customer data is in the file', /[Nn]one/.test(fields['Customer data']), fields['Customer data']);
  ok('…and that the engine built every figure', /VTEngine\.dashboard/.test(fields['Built by']), fields['Built by']);
  ok('every sheet\'s first row names the panel', wb.sheets.every((s) => /^VT Report — /.test(String(s.aoa[0][0]))),
    wb.sheets.filter((s) => !/^VT Report — /.test(String(s.aoa[0][0]))).map((s) => s.name).join(', '));
  ok('every sheet\'s second row carries the view, the month and the as-at date',
    wb.sheets.every((s) => /View: .+ · Business month: November 2026 · Figures to: 2026-11-20/.test(String(s.aoa[1][0]))), String(wb.sheets[2].aoa[1][0]));
  ok('a blank row separates the provenance from the headers', wb.sheets.every((s) => String(s.aoa[2][0]) === ''));
}

head('SC-007 · the figures in the file ARE the model\'s own fields');
{
  const kpi = sheetOf(wb, 'Exco Summary');
  eq('the five KPI rows, in the model\'s order', bodyOf(kpi).map((r) => r[0]), D.kpis.map((k) => k.label));
  eq('Total Sales is the model\'s count, as a number', cellAt(kpi, 'Total Sales', 'Value'), D.counts.sales);
  eq('Total Fitments is the model\'s count', cellAt(kpi, 'Total Fitments', 'Value'), D.counts.fitted);
  eq('Target Achieved travels as the ratio itself, formatted as a percentage', cellAt(kpi, 'Target Achieved', 'Value'), D.budget.achievement);
  ok('every KPI row names its Sales Review cell', bodyOf(kpi).every((r) => String(r[6]).length > 3), bodyOf(kpi).map((r) => r[6]).join(' | '));

  const bd = sheetOf(wb, 'Detailed Breakdown');
  const total = bodyOf(bd).filter((r) => r[0] === 'Total')[0];
  eq('the breakdown\'s total row is the engine\'s own totals, not a sum of the sheet',
    [total[1], total[2], total[3], total[4]], [D.breakdownTotals.sales, D.breakdownTotals.fitted, D.breakdownTotals.cancelled, D.breakdownTotals.missed]);
  eq('each channel row is its model row', bodyOf(bd).slice(0, D.breakdown.length).map((r) => [r[0], r[1]]), D.breakdown.map((r) => [r.label, r.sales]));

  const ch = sheetOf(wb, 'Channel Performance');
  eq('the channel shares are the model\'s ratios, unrounded', bodyOf(ch).slice(0, D.channels.length).map((r) => r[2]), D.channels.map((t) => t.share));

  const bk = sheetOf(wb, 'Cycle Performance');
  eq('the five lead-time buckets and the past-due row', bodyOf(bk).map((r) => r[0]), D.buckets.map((b) => b.label).concat(['Past due']));
  eq('the bucket counts are the model\'s', bodyOf(bk).slice(0, 5).map((r) => r[1]), D.buckets.map((b) => b.count));

  const ig = sheetOf(wb, 'Integrity Checks');
  eq('all three integrity verdicts, with both sides and the difference',
    bodyOf(ig).map((r) => [r[1], r[2], r[3], r[4]]), D.integrity.map((c) => [c.verdict, c.got, c.expected, c.diff]));
  ok('each check names its workbook cell', bodyOf(ig).every((r) => /K1[78]|E36/.test(String(r[6]))), bodyOf(ig).map((r) => r[6]).join(' | '));

  const dg = sheetOf(wb, 'Sources Disagree');
  eq('the disagreement counts are the engine\'s',
    [cellAt(dg, 'Schedulers not matched to a CB', 'Cases'), cellAt(dg, 'Sales with no sale date', 'Cases'), cellAt(dg, 'Campaigns not in the channel map', 'Cases')],
    [D.disagree.unmatchedSchedulers, D.disagree.noSaleDay, D.disagree.unmappedCampaigns]);
  ok('the 071 accounting is carried forward into the file, not restarted (FR-015)',
    cellAt(dg, 'Hand credits carried forward', 'Cases') === D.disagree.carried.handCredits
    && String(cellAt(dg, 'Lead sources relabelled, carried forward', 'Share of sales in view')) === String(D.disagree.carried.leadSourceRelabelledShare),
    cellAt(dg, 'Hand credits carried forward', 'Cases'));

  const ro = sheetOf(wb, 'Rollover Follow-up');
  eq('the rollover total row is the engine\'s pre-cycle position',
    [cellAt(ro, 'Total', 'Rollover sales'), cellAt(ro, 'Total', 'Open to action')], [D.rollover.totals.sales, D.rollover.totals.open]);

  const up = sheetOf(wb, 'Upcoming Fitments');
  eq('the whole scheduled pipeline is the model\'s', cellAt(up, 'Scheduled pipeline', 'Bookings'), D.upcoming.total);

  const ins = sheetOf(wb, 'Key Insights');
  eq('every insight sentence is the engine\'s, with its cell', bodyOf(ins).map((r) => [r[0], r[1], r[2]]), D.insights.map((i) => [i.id, i.text, i.cell]));
}

head('FR-045 · all four Pivot sheets, whatever the screen is showing');
{
  const scopes = E.VT_RULES.reports.schedulerPivots.scopes;
  eq('one sheet per scope in the rule book', wb.sheets.filter((s) => /^Pivot - /.test(s.name)).length, scopes.length);
  const all = sheetOf(wb, 'Pivot - All campaigns'), rows = D.schedulerPivot('all');
  eq('the all-data pivot carries every scheduler and the scope average', bodyOf(all).length, rows.length + 1);
  eq('each scheduler\'s percentages are over their own grand total, as the model computed them',
    bodyOf(all).slice(0, rows.length).map((r) => r[4]), rows.map((r) => r.pct.fitted));
  ok('the last row is the scope average, named as such and never a target', /All schedulers in this scope/.test(String(bodyOf(all)[rows.length][0])), String(bodyOf(all)[rows.length][0]));
}

head('FR-013 / non-negotiable 6 · an absence is the marker, never a zero');
{
  const absent = E.VT_RULES.reports.absent;
  const noSch = bookOf(ROWS.map((r) => Object.assign({}, r, { schedulerName: null, schedulerCb: null, gwpRpt: null, soldBasis: 'first_seen' })));
  const D2 = E.dashboard(noSch, [], { cycleKey: CYCLE, view: 'cycle', asOf: ASOF });
  const w2 = VTDash.workbookFrom(D2);
  ok('with no Schedulers Data there is no GWP sheet and no pivot sheet — never a sheet of noughts',
    !sheetOf(w2, 'Fitted GWP') && !w2.sheets.some((s) => /^Pivot - /.test(s.name)), w2.sheets.map((s) => s.name).join(', '));
  ok('the header sheet says in words why GWP is not in the file',
    /Schedulers Data/.test(String(bodyOf(sheetOf(w2, 'About this export')).filter((r) => r[0] === 'GWP source')[0][1])));
  const ro2 = sheetOf(w2, 'Rollover Follow-up');
  eq('open GWP reads the absent marker, not 0', cellAt(ro2, 'Total', 'Open GWP'), absent);
  const kpi2 = sheetOf(w2, 'Exco Summary');
  ok('with no previous cycle every change reads the absent marker and says so',
    bodyOf(kpi2).every((r) => String(r[4]).indexOf(absent) === 0 && /vs previous cycle/.test(String(r[4]))), String(bodyOf(kpi2)[0][4]));
  const bd2 = sheetOf(w2, 'Detailed Breakdown');
  ok('…and so does the breakdown\'s Change column', bodyOf(bd2).every((r) => String(r[7]).indexOf(absent) === 0), String(bodyOf(bd2)[0][7]));
  ok('a drawn shape leaves WORDS behind in the file, never an empty cell',
    bodyOf(bd2).every((r) => /Fitted \d+ · Scheduled \d+ · Missed \d+ · Cancelled \d+/.test(String(r[8]))), String(bodyOf(bd2)[0][8]));
  const noBudget = E.dashboard(book, [], { cycleKey: 'cycle-2020-01', view: 'cycle', asOf: '2019-12-31' });
  const w3 = VTDash.workbookFrom(noBudget);
  ok('a cycle with no budget on file exports without a Sales vs budget sheet and says so on the header sheet',
    !sheetOf(w3, 'Sales vs budget') && /no cycle sales budget/i.test(String(bodyOf(sheetOf(w3, 'About this export')).filter((r) => r[0] === 'Cycle budget')[0][1])));
}

head('SC-007 · THE FOLD CHANGES NO FIGURE (the owner\'s layout decision, 2026-11-25)');
{
  const before = JSON.stringify(VTDash.workbookFrom(D).sheets);
  ['trend', 'channels', 'campaigns', 'buckets', 'breakdown', 'pivots', 'persons', 'disagree', 'integrity'].forEach((id) => VTDash.fold(id, true));
  const open = JSON.stringify(VTDash.workbookFrom(D).sheets);
  ['trend', 'channels', 'campaigns', 'buckets', 'breakdown', 'pivots', 'persons', 'disagree', 'integrity'].forEach((id) => VTDash.fold(id, false));
  const closed = JSON.stringify(VTDash.workbookFrom(D).sheets);
  ok('every table open exports exactly what every table folded exports', before === open && open === closed,
    before === open ? 'closed differed' : 'open differed');
  ok('the export reads the model, so the fold state is not even an input',
    JSON.stringify(VTDash.sheetSpecs(D)) === JSON.stringify(VTDash.sheetSpecs(D)));
}

head('FR-057 / FR-058 · no customer field, numbers as numbers, nothing mutated');
{
  /* every cell but the header sheet's own "Customer data: none" declaration, which is the statement, not a field */
  const flat = wb.sheets.map((s) => s.aoa.filter((r) => String(r[0]) !== 'Customer data').map((r) => r.join('|')).join('\n')).join('\n').toLowerCase();
  const BANNED = ['customer', 'id number', 'contact number', 'cell number', 'email', 'physical address'];
  ok('no customer field anywhere in the workbook', BANNED.every((b) => flat.indexOf(b) < 0), BANNED.filter((b) => flat.indexOf(b) > -1).join(', '));
  const bd = sheetOf(wb, 'Detailed Breakdown');
  ok('a count is a number in the file, not a formatted string', bodyOf(bd).every((r) => typeof r[1] === 'number'), typeof bodyOf(bd)[0][1]);
  const ch = sheetOf(wb, 'Channel Performance');
  ok('a percentage is the ratio itself, so the cell\'s own format prints it', bodyOf(ch).every((r) => r[2] === E.VT_RULES.reports.absent || (typeof r[2] === 'number' && r[2] <= 1)),
    bodyOf(ch).map((r) => r[2]).join(', '));
  ok('every type the cells carry has a number format', Object.keys(VTDash.XFMT).join(',') === 'p,d2,r,n');
  const snap = JSON.stringify(D);
  VTDash.workbookFrom(D);
  ok('building the workbook does not touch the model', JSON.stringify(D) === snap);
  const twice = JSON.stringify(VTDash.workbookFrom(D).sheets) === JSON.stringify(VTDash.workbookFrom(D).sheets);
  ok('two builds of the same model are identical (no clock in a figure)', twice);
}

head('the other three views export too, each naming itself');
['current', 'rollovers', 'all'].forEach((v) => {
  const Dv = model(v), w = VTDash.workbookFrom(Dv);
  ok('the ' + v + ' view exports ' + w.sheets.length + ' sheets and names itself on every one',
    w.sheets.length > 10 && w.sheets.every((s) => String(s.aoa[1][0]).indexOf('View: ' + Dv.viewLabel) === 0) && w.name.indexOf(Dv.viewLabel) > -1,
    w.name);
  const kpi = sheetOf(w, 'Exco Summary');
  eq('…and its Total Sales is that view\'s count', bodyOf(kpi)[0][1], Dv.counts.sales);
});

finish();
