/* VT DASHBOARD VIEWS (Spec Kit 072 task A6, plan §T) — the pure half of the VT Report proof.
 *
 * The oracle (verify-vt-report-oracle.mjs) measures VTEngine.dashboard() against the owner's real
 * workbook and only runs where that file is. THIS suite is pure and always runs: a small SYNTHETIC
 * book (CB9001-style codes, invented case numbers, no real person and no customer field) over which
 * every rule can be read off by hand:
 *
 *   · the four views and the in-cycle-only asymmetry (FR-009, FR-010, spec F0-9)
 *   · the three integrity checks, on both the OK and the CHECK path (FR-050..FR-054)
 *   · the dialing days and the straight-line forecast (FR-036..FR-040)
 *   · the five lead-time buckets, frozen, split on the cycle end (FR-029..FR-032)
 *   · the insight templates, computed and omitted-when-absent (FR-042, FR-043)
 *   · the channel map, the Panimax roll-up and the unmapped list (FR-025..FR-028)
 *   · absence: no previous cycle, no Schedulers Data — words, never a zero (FR-013, FR-019)
 *   · purity: no clock, no mutation, the same inputs give the same answer (FR-058)
 *
 * Run:  node verify-vt-views.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const REPO = process.env.AGENTOS || decodeURIComponent(new URL('../..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1').replace(/\/$/, '');
const ENGINE = path.join(REPO, 'nicks_code', 'vt-engine.js');
let pass = 0, fail = 0; const failures = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; failures.push(n + (d ? ' — ' + d : '')); console.log('  FAIL ' + n + (d ? ' — ' + d : '')); } };
const eq = (n, got, exp) => ok(n, JSON.stringify(got) === JSON.stringify(exp), 'expected ' + JSON.stringify(exp) + ' got ' + JSON.stringify(got));
const near = (n, got, exp, tol = 1e-9) => ok(n, typeof got === 'number' && Math.abs(got - exp) <= tol, 'expected ' + exp + ' (±' + tol + ') got ' + got);
const head = (s) => console.log('\n== ' + s + ' ==');
const finish = () => { console.log(`\n${pass} passed, ${fail} failed`); failures.forEach(f => console.log('  · ' + f)); process.exit(fail ? 1 : 0); };

if (!fs.existsSync(ENGINE)) { ok('nicks_code/vt-engine.js exists', false, 'missing'); finish(); }
const E = require(ENGINE);
const CYCLE = 'cycle-2026-11';
const cyc = E.periods.cycleByKey(CYCLE);
const ASOF = '2026-11-20';

/* ------------------------------------------------------------------ the synthetic book ----
 * Thirteen invented cases. Sale dates, statuses, campaigns, appointment dates and GWP are chosen so
 * every figure below can be counted on one hand. Nothing here is real: case numbers are 9000-series,
 * schedulers and agents are CB9001-style placeholders, and there is no customer field anywhere. */
const C = (cn, soldOn, status, campaign, extra) => Object.assign({
  caseNumber: cn, status: status, statusOn: soldOn, soldOn: soldOn, soldBasis: 'schedulers_data',
  firstSeen: soldOn, lastSeen: ASOF, apptOn: null, fittedOn: status === 'fitted' ? soldOn : null,
  smAttempt: null, products: [], bundle: null, chargeEx: null, partnerRaw: null, leadSource: null,
  sellerName: 'Agent CB9001', sellerCb: 'CB9001', sellerMatch: 'exact', cancelReason: null,
  campaignRpt: campaign, gwpRpt: 100, schedulerName: 'Scheduler CB9101', schedulerCb: 'CB9101',
  referringName: null, referringCb: null, resultRpt: status
}, extra || {});

const ROWS = [
  /* in the cycle: 4 fitted, 2 scheduled, 1 missed, 1 cancelled = 8 sales */
  C('9001', '2026-10-27', 'fitted', 'Revx'),
  C('9002', '2026-11-02', 'fitted', 'Revx', { gwpRpt: 200 }),
  C('9003', '2026-11-10', 'fitted', 'Referral Agent', { schedulerName: 'Scheduler CB9102', schedulerCb: 'CB9102', referringName: 'Referrer CB9201', referringCb: 'CB9201' }),
  C('9004', '2026-11-18', 'fitted', 'Predictive'),
  C('9005', '2026-11-19', 'scheduled', 'Revx', { apptOn: '2026-11-21' }),                 /* 24 h */
  C('9006', '2026-11-20', 'scheduled', 'Predictive', { apptOn: '2026-11-24' }),           /* 72+ in cycle */
  C('9007', '2026-11-12', 'missed', 'Revx', { apptOn: '2026-11-13' }),
  C('9008', '2026-11-05', 'cancelled', 'Mystery Co', { cancelReason: 'dropped' }),        /* unmapped campaign */
  /* before the cycle: 2 fitted, 1 scheduled, 1 missed, 1 cancelled = 5 sales */
  C('9009', '2026-10-01', 'fitted', 'Revx', { gwpRpt: 300 }),
  C('9010', '2026-09-28', 'fitted', 'Referral Agent'),
  C('9011', '2026-10-05', 'scheduled', 'Revx', { apptOn: '2026-11-30' }),                 /* 72+ out of cycle */
  C('9012', '2026-10-06', 'missed', 'Predictive', { apptOn: '2026-10-20' }),
  C('9013', '2026-10-07', 'cancelled', 'Revx', { cancelReason: 'deactivated' })
];
function bookOf(rows) {
  const b = E.emptyBook();
  b.openedOn = '2026-09-28'; b.openingBookOn = '2026-09-28'; b.rev = 1;
  rows.forEach(r => { b.cases[r.caseNumber] = JSON.parse(JSON.stringify(r)); });
  return b;
}
const book = bookOf(ROWS);
const D = (view, extra) => E.dashboard(book, [], Object.assign({ cycleKey: CYCLE, view: view, asOf: ASOF }, extra || {}));
const M = D('cycle'), Mall = D('all'), Mcur = D('current'), Mroll = D('rollovers');

head('FR-007 / FR-008 · four views and nothing else, cycle by default');
eq('the rule book offers exactly the workbook\'s four views', E.VT_RULES.views.list.map(v => v.k), ['cycle', 'current', 'rollovers', 'all']);
eq('the default view is the cycle view', [E.VT_RULES.views.default, E.dashboard(book, [], { cycleKey: CYCLE, asOf: ASOF }).view], ['cycle', 'cycle']);
eq('an unknown view name falls back to the default rather than painting nothing', D('nonsense').view, 'cycle');
eq('each view reports which one it is', [M.view, Mcur.view, Mroll.view, Mall.view], ['cycle', 'current', 'rollovers', 'all']);
ok('every view carries its label and its words', [M, Mcur, Mroll, Mall].every(x => x.viewLabel.length > 5 && x.viewWords.length > 10));
ok('the cycle view\'s words name the pre-cycle fitted rule', /fitted/i.test(M.viewWords) && /earlier/i.test(M.viewWords), M.viewWords);

head('FR-009 / FR-010 · the counts, and the in-cycle-only asymmetry (spec F0-9)');
eq('all data: 13 sales, 6 fitted, 3 scheduled, 2 missed, 2 cancelled',
  [Mall.counts.sales, Mall.counts.fitted, Mall.counts.scheduled, Mall.counts.missed, Mall.counts.cancelled], [13, 6, 3, 2, 2]);
eq('current cycle only: 8 / 4 / 2 / 1 / 1',
  [Mcur.counts.sales, Mcur.counts.fitted, Mcur.counts.scheduled, Mcur.counts.missed, Mcur.counts.cancelled], [8, 4, 2, 1, 1]);
eq('rollovers only: 5 / 2 / 1 / 1 / 1',
  [Mroll.counts.sales, Mroll.counts.fitted, Mroll.counts.scheduled, Mroll.counts.missed, Mroll.counts.cancelled], [5, 2, 1, 1, 1]);
eq('cycle view: 10 sales (8 in cycle + 2 fitted rollovers), 6 fitted, and the open outcomes in-cycle only',
  [M.counts.sales, M.counts.fitted, M.counts.scheduled, M.counts.missed, M.counts.cancelled], [10, 6, 2, 1, 1]);
ok('a pre-cycle scheduled, missed or cancelled case is in no cycle-view count',
  M.counts.scheduled === Mcur.counts.scheduled && M.counts.missed === Mcur.counts.missed && M.counts.cancelled === Mcur.counts.cancelled);
eq('only the two cycle views restrict the open outcomes', [M.openOutcomesInCycleOnly, Mcur.openOutcomesInCycleOnly, Mroll.openOutcomesInCycleOnly, Mall.openOutcomesInCycleOnly], [true, true, false, false]);
near('the cycle view\'s fitment rate is 6 / 10', M.rates.fitRate, 0.6);
near('the cancellation rate is over ALL the view\'s sales, a cancelled sale still being a sale', M.rates.canRate, 0.1);
eq('a case with no sale day is never counted as a sale on any day, and is reported instead',
  (() => { const b = bookOf(ROWS); const r = C('9014', '2026-11-04', 'scheduled', 'Revx'); r.soldOn = null; r.soldBasis = 'unknown'; b.cases['9014'] = r;
    const X = E.dashboard(b, [], { cycleKey: CYCLE, view: 'all', asOf: ASOF }); return [X.counts.sales, X.disagree.noSaleDay]; })(), [13, 1]);

head('SC-002 / FR-050..054 · the three integrity checks, OK and CHECK');
{ const ic = Object.fromEntries(M.integrity.map(c => [c.k, c]));
  eq('three checks, in the rule book\'s order', M.integrity.map(c => c.k), ['k17', 'k18', 'schedulerName']);
  eq('K17 · 6 + 2 + 1 + 1 = 10 → OK', [ic.k17.ok, ic.k17.verdict, ic.k17.got, ic.k17.expected], [true, 'OK', 10, 10]);
  eq('K18 · the five buckets add to the view\'s scheduled pipeline → OK', [ic.k18.ok, ic.k18.verdict, ic.k18.got, ic.k18.expected], [true, 'OK', 2, 2]);
  eq('the scheduler check reconciles to the sales in view → OK', [ic.schedulerName.ok, ic.schedulerName.got, ic.schedulerName.expected], [true, 10, 10]);
  ok('every check carries words and a verdict, never a colour alone', M.integrity.every(c => c.words.length > 10 && (c.verdict === 'OK' || c.verdict === 'CHECK') && typeof c.ok === 'boolean'));
  ok('every check names its workbook cell', M.integrity.every(c => /K1[78]|E36/.test(c.cell)), M.integrity.map(c => c.cell).join(' | '));
  /* CHECK path: a scheduled case with no appointment date falls in no bucket, so K18 cannot balance */
  const b2 = bookOf(ROWS); b2.cases['9005'].apptOn = null;
  const X = E.dashboard(b2, [], { cycleKey: CYCLE, view: 'cycle', asOf: ASOF });
  const x18 = X.integrity.filter(c => c.k === 'k18')[0];
  eq('K18 · a scheduled case with no appointment date → CHECK, with both sides and the difference', [x18.ok, x18.verdict, x18.got, x18.expected, x18.diff], [false, 'CHECK', 1, 2, -1]);
  ok('…and the CHECK words print both numbers', /1/.test(x18.words) && /2/.test(x18.words) && /appointment date/.test(x18.words), x18.words);
  ok('a failing check never blocks the page: every panel is still there', X.counts.sales === 10 && X.kpis.length === 5 && X.channels.length === 4);
  /* CHECK path: a sale with no scheduler name cannot reconcile to the scheduler rows */
  const b3 = bookOf(ROWS); b3.cases['9001'].schedulerName = null; b3.cases['9001'].schedulerCb = null;
  const Y = E.dashboard(b3, [], { cycleKey: CYCLE, view: 'cycle', asOf: ASOF });
  const y = Y.integrity.filter(c => c.k === 'schedulerName')[0];
  eq('the scheduler check · one sale with no scheduler → CHECK', [y.ok, y.got, y.expected, y.diff], [false, 9, 10, -1]);
  ok('…and it says how many have no scheduler name', /1/.test(y.words) && /scheduler/i.test(y.words), y.words); }

head('FR-036..FR-040 · dialing days and the straight-line forecast');
eq('data-through is the latest sale date, never past the cycle end', [M.period.dataThrough, M.dataThrough], ['2026-11-20', '2026-11-20']);
eq('22 dialing days in the cycle, 19 elapsed to 20 Nov, 3 left (4 Nov is the rule book\'s holiday)',
  [M.dialingDays.total, M.dialingDays.elapsed, M.dialingDays.left], [22, 19, 3]);
near('the elapsed share is elapsed ÷ total', M.dialingDays.pct, 19 / 22);
ok('the dialing-day line says which day of which', /19/.test(M.dialingDays.words) && /22/.test(M.dialingDays.words), M.dialingDays.words);
near('forecast sales = actual ÷ elapsed × total', M.forecast.sales, 10 / 19 * 22);
near('forecast fitments the same way', M.forecast.fitments, 6 / 19 * 22);
ok('the forecast is labelled a pace, never a prediction', /pace/i.test(M.forecast.label) && /not a prediction/i.test(M.forecast.label), M.forecast.label);
eq('the forecast is never applied to the open outcomes', [M.forecast.missed, M.forecast.cancelled, M.forecast.scheduled], [undefined, undefined, undefined]);
eq('with no elapsed dialing day the forecast is absent, never 0',
  E.dashboard(book, [], { cycleKey: CYCLE, view: 'cycle', asOf: '2026-10-25' }).forecast.sales, null);

head('FR-017..FR-020 · the five KPI cards, and absence that reads in words');
eq('five cards in the mockup\'s order', M.kpis.map(k => k.k), ['sales', 'fitted', 'cancelled', 'missed', 'targetAchieved']);
eq('their values are the view\'s counts and the achievement', M.kpis.slice(0, 4).map(k => k.value), [10, 6, 1, 1]);
near('Target Achieved is sales ÷ the cycle sales budget', M.kpis[4].value, 10 / 3030);
ok('Target Achieved names the budget and its workbook cell', /3,030/.test(M.kpis[4].words) && /B51/.test(M.kpis[4].cell), M.kpis[4].words + ' | ' + M.kpis[4].cell);
ok('Cancellations and Missed carry their share beside their budget and are never scored',
  M.kpis[2].scored === false && M.kpis[3].scored === false && M.kpis[2].budget === E.VT_RULES.cycleBudget[CYCLE].cancelledPct['*']);
eq('with no previous cycle every change is absent, never 0', [M.prevCycle.present, M.kpis.every(k => k.delta === null), M.breakdown.every(r => r.delta === null)], [false, true, true]);
ok('…and the page is told why in words', /no previous cycle/i.test(M.prevCycle.words), M.prevCycle.words);
{ const P = D('cycle', { prev: { cycle: 'cycle-2026-10', sales: 8, fitted: 4, cancelled: 2, missed: 0, achievement: 8 / 3030 } });
  eq('with a previous cycle the change is an absolute and a percentage', [P.prevCycle.present, P.kpis[0].delta.abs, Math.round(P.kpis[0].delta.pct * 1e6)], [true, 2, Math.round(2 / 8 * 1e6)]);
  eq('a previous figure of 0 gives an absolute change and no percentage of nothing', P.kpis[3].delta, { abs: 1, pct: null }); }

head('FR-029..FR-032 · the five lead-time buckets, frozen and split on the cycle end');
eq('the lead-time as-at is frozen at the data-through date plus one day, never a clock', M.period.hrsAsAt, '2026-11-21');
eq('five buckets, the workbook\'s own labels, Past due carried apart', M.buckets.map(b => b.label), ['24', '48', '72', '72+ in cycle', '72+ out cycle']);
eq('the cycle view\'s scheduled pipeline is 1 at 24 h and 1 at 72+ in cycle', M.buckets.map(b => b.count), [1, 0, 0, 1, 0]);
eq('over ALL bookings the pre-cycle booking lands in 72+ out of cycle', Mall.bucketsAll.map(b => b.count), [1, 0, 0, 1, 1]);
ok('the buckets cover every booking whatever the view, and say so', JSON.stringify(M.bucketsAll.map(b => b.count)) === JSON.stringify(Mroll.bucketsAll.map(b => b.count)) && /all bookings|whatever the view|frozen/i.test(M.bucketWords), M.bucketWords);
near('the 24 h target is 75 % of the scheduled target (SR B94 = 0.75 × B88)', M.buckets[0].target, 0.75 * (0.1 * 2066));
ok('every bucket target comes from the rule book\'s dashboard share, not the rating share',
  M.buckets.map(b => b.k).join(',') === 'h24,h48,h72,h72pIn,h72pOut' && Object.keys(E.VT_RULES.budgets[CYCLE].hrsShare).join(',') === 'h24,h48,h72,h72p');
eq('a past-due booking is carried apart so K18 still adds the five',
  (() => { const b = bookOf(ROWS); b.cases['9005'].apptOn = '2026-11-01';
    const X = E.dashboard(b, [], { cycleKey: CYCLE, view: 'cycle', asOf: ASOF });
    return [X.bucketsPastDue, X.buckets.reduce((s, x) => s + x.count, 0), X.integrity.filter(c => c.k === 'k18')[0].ok]; })(), [1, 1, false]);
ok('a 72+ in cycle bucket that cannot be reached late in the cycle says so, rather than reading as missing data',
  (() => { const b = bookOf(ROWS); b.cases['9015'] = C('9015', '2026-11-24', 'scheduled', 'Revx', { apptOn: '2026-12-02' });
    const X = E.dashboard(b, [], { cycleKey: CYCLE, view: 'cycle', asOf: '2026-11-24' });
    const bk = X.buckets.filter(x => x.k === 'h72pIn')[0];
    return X.period.hrsAsAt === '2026-11-25' && bk.count === 0 && bk.structuralZero === true && /unreachable|cannot be hit/i.test(bk.words); })());
ok('earlier in the cycle the same bucket is reachable and is NOT flagged structural', M.buckets[3].structuralZero === false, JSON.stringify(M.buckets[3]));

head('FR-025..FR-028 · channels, the unmapped campaign and the Panimax roll-up');
{ const ch = Object.fromEntries(Mall.channels.map(c => [c.k, c]));
  eq('exactly four channels, in the rule book\'s order', Mall.channels.map(c => c.k), ['lead_gen', 'referral', 'predictive', 'other']);
  eq('all data: Lead Gen 7, Referral 2, Predictive 3, Other 1', Mall.channels.map(c => c.sales), [7, 2, 3, 1]);
  eq('the channels add up to the view', Mall.channels.reduce((s, c) => s + c.sales, 0), Mall.counts.sales);
  near('each channel\'s share is of the view\'s sales', Mall.channels.reduce((s, c) => s + c.share, 0), 1);
  eq('Lead Gen is labelled Digital where the Sales Review labels it so', ch.lead_gen.srLabel, 'Digital');
  eq('an unmapped campaign falls to Other and is NAMED so the map can be extended', [Mall.unmapped, ch.other.sales], [['Mystery Co'], 1]);
  ok('Other has an actual and no target, shown as absent and never 0', ch.other.salesBudget === null && ch.lead_gen.salesBudget === 2066 && /no target/i.test(ch.other.targetWords));
  const pan = Mall.campaignRollups.filter(r => r.k === 'panimax')[0];
  eq('Panimax is a named roll-up of Referral + Predictive, never a raw channel', [pan.label, pan.members, pan.sales, pan.rollup], ['Panimax', ['referral', 'predictive'], 5, true]);
  eq('…and its budget is the sum of its members\', so no total counts it twice', [pan.salesBudget, Mall.campaigns.every(c => c.rollup === false)], [179 + 785, true]);
  ok('panimax is not one of the four channels', E.VT_RULES.channels.keys.indexOf('panimax') < 0); }
{ const camp = Mall.campaigns;
  eq('campaigns are ranked largest first, which is the shape the panel draws', camp.map(c => c.name), ['Revx', 'Predictive', 'Referral Agent', 'Mystery Co']);
  eq('…and they carry their channel, so the ranked bars and the donut agree', camp.map(c => c.channel), ['lead_gen', 'predictive', 'referral', 'other']);
  eq('the campaigns add to the view\'s sales', camp.reduce((s, c) => s + c.sales, 0), Mall.counts.sales); }

head('FR-021..FR-024 · the weekly trend uses the engine\'s own cycle weeks');
{ const five = M.weeks.filter(w => !w.preCycle && !w.postCycle);
  eq('the cycle\'s weeks are the engine\'s weeksOf, so the panel agrees with the VT Weekly page', five.map(w => w.from), E.periods.weeksOf(cyc).map(w => w.from));
  eq('the cycle weeks hold every in-cycle sale', five.reduce((s, w) => s + w.sales, 0), Mcur.counts.sales);
  near('each week\'s target is the budget over the cycle\'s dialing days times that week\'s', five.reduce((s, w) => s + w.target, 0), 3030, 1e-6);
  eq('a week\'s dialing days come off the rule book\'s calendar (4 Nov is a holiday)', five.map(w => w.dialingDays), [5, 4, 5, 5, 3]);
  ok('the week window is the workbook\'s half-open window, stated in the rule book', /< week start \+ 7/.test(E.VT_RULES.periods.weekWindow) && /week start/.test(M.weekWords));
  ok('in the cycle view the pre-cycle weeks are marked fitted-only and carry no target',
    M.weeks.some(w => w.preCycle && w.fittedOnly === true) && M.weeks.filter(w => w.preCycle).every(w => w.target === null && w.sales === w.fitted));
  ok('in the all-data view a pre-cycle week is a real week, not fitted-only', Mall.weeks.filter(w => w.preCycle).every(w => w.fittedOnly === false));
  eq('every sale in the view falls in exactly one week', Mall.weeks.reduce((s, w) => s + w.sales, 0), Mall.counts.sales); }

head('FR-041 · the Detailed Breakdown: ratios of sums, never means of rates');
eq('one row per channel plus a totals row', [M.breakdown.map(r => r.k), M.breakdownTotals.k], [['lead_gen', 'referral', 'predictive', 'other'], 'total']);
eq('the totals row is the ratio of sums', Math.round(M.breakdownTotals.fitRate * 1e12), Math.round(M.counts.fitted / M.counts.sales * 1e12));
ok('the totals row says so, from the rule book', /ratio of sums/.test(M.breakdownTotals.words), M.breakdownTotals.words);
ok('every row carries sales, fitments, cancellations, missed, target and achievement',
  ['sales', 'fitted', 'cancelled', 'missed', 'salesBudget', 'achievement'].every(k => M.breakdown[0][k] != null));

head('FR-042 / FR-043 · Key Insights are computed, named, and omitted when absent');
{ const ins = Object.fromEntries(Mall.insights.map(i => [i.id, i]));
  eq('three insights here: the best-campaign line is OMITTED because no campaign clears the 20-sale minimum in the rule book', Mall.insights.map(i => i.id).sort(), ['conversion', 'leakage', 'rollovers']);
  ok('every insight names its figures and its cell, and none is hand-written', Mall.insights.every(i => i.v && Object.keys(i.v).length && i.template && /Exco Summary B1\d/.test(i.cell)));
  ok('the conversion sentence carries the rate, the sales and the bookings it came from',
    /46[.,]2/.test(ins.conversion.text) && /13/.test(ins.conversion.text) && /3/.test(ins.conversion.text), ins.conversion.text);
  eq('leakage is cancelled + missed, with the GWP behind it', [ins.leakage.v.leak, ins.leakage.v.leakGwp], [4, 400]);
  eq('rollovers: 5 in total, 2 fitted, 3 open — 1 scheduled, 2 to rebook', [ins.rollovers.v.total, ins.rollovers.v.fitted, ins.rollovers.v.open, ins.rollovers.v.scheduled, ins.rollovers.v.rebook], [5, 2, 3, 1, 2]);
  { /* a book big enough for the best-campaign line: two campaigns past the minimum, one clearly better */
    const MIN = E.VT_RULES.insights.templates.filter(t => t.id === 'bestCampaign')[0].minSales;
    const b = E.emptyBook(); b.openedOn = '2026-10-26'; b.openingBookOn = '2026-10-26';
    let n = 9200;
    for (let i = 0; i <= MIN; i++) { const st = i < MIN - 5 ? 'fitted' : 'scheduled';
      b.cases[String(n)] = C(String(n), '2026-11-03', st, 'Revx', { apptOn: st === 'scheduled' ? '2026-11-22' : null }); n++; }
    for (let i = 0; i <= MIN; i++) { const st = i < 7 ? 'fitted' : 'missed';
      b.cases[String(n)] = C(String(n), '2026-11-04', st, 'Jag', { apptOn: st === 'missed' ? '2026-11-05' : null }); n++; }
    const X = E.dashboard(b, [], { cycleKey: CYCLE, view: 'all', asOf: ASOF });
    const bc = X.insights.filter(i => i.id === 'bestCampaign')[0];
    eq('the best-campaign line names the best and the worst of the campaigns that clear the minimum',
      [bc.v.best, bc.v.worst, bc.v.eligible, bc.v.minSales], ['Revx', 'Jag', 2, MIN]);
    near('each rate is the ratio of that campaign own sums', bc.v.bestRate, (MIN - 5) / (MIN + 1));
    ok('the sentence carries the figures it came from', /Revx/.test(bc.text) && /Jag/.test(bc.text) && /%/.test(bc.text), bc.text);
    eq('a campaign one sale short of the minimum is not eligible',
      (() => { const b2 = E.emptyBook(); b2.openedOn = '2026-10-26'; let m = 9400;
        for (let i = 0; i < MIN - 1; i++) { b2.cases[String(m)] = C(String(m), '2026-11-03', 'fitted', 'Revx'); m++; }
        return E.dashboard(b2, [], { cycleKey: CYCLE, view: 'all', asOf: ASOF }).insights.some(i => i.id === 'bestCampaign'); })(), false); }
  ok('a template whose data is absent is omitted, never padded with a zero',
    (() => { const b = E.emptyBook(); b.openedOn = '2026-10-26'; b.cases['9099'] = C('9099', '2026-11-02', 'fitted', 'Revx');
      const X = E.dashboard(b, [], { cycleKey: CYCLE, view: 'cycle', asOf: ASOF });
      return !X.insights.some(i => i.id === 'bestCampaign') && !X.insights.some(i => i.id === 'rollovers') && X.insights.some(i => i.id === 'conversion'); })()); }

head('FR-044 / FR-013 · GWP, the scheduler dimension, and honest absence');
near('Fitted GWP in the cycle view is the Schedulers Data figure for the fitted cases', M.gwp.fitted, 100 + 200 + 100 + 100 + 300 + 100);
eq('total GWP in view and lost GWP (cancelled + missed)', [Mall.gwp.total, Mall.gwp.lost], [1600, 400]);
ok('the GWP panel names its source and says it is not the engine\'s BI value', /schedulers data/i.test(M.gwp.source) && /BI/.test(M.gwp.notSource));
ok('with no Schedulers Data the GWP and scheduler panels say so and paint nothing — never 0',
  (() => { const b = bookOf(ROWS);
    Object.keys(b.cases).forEach(k => { b.cases[k].gwpRpt = null; b.cases[k].schedulerName = null; b.cases[k].schedulerCb = null; });
    const X = E.dashboard(b, [], { cycleKey: CYCLE, view: 'cycle', asOf: ASOF });
    return X.gwp.loaded === false && X.gwp.fitted === null && X.gwp.total === null && X.schedulers.loaded === false
      && X.schedulers.rows.length === 0 && /schedulers data/i.test(X.schedulers.words) && /schedulers data/i.test(X.gwp.words); })());
eq('two schedulers in the book, counted against the headcount budget', [M.schedulers.rows.length, M.schedulers.headcount, M.schedulers.headcountBudget], [2, 2, 6]);
ok('every scheduler percentage is over that scheduler\'s own sales, and divide-by-zero safe',
  M.schedulers.rows.every(r => r.sales > 0 ? Math.abs(r.pct.fitted - r.fitted / r.sales) < 1e-12 : r.pct.fitted === null));
eq('the four pivot scopes are all data, so the grand total is every record', E.VT_RULES.reports.schedulerPivots.scopes.map(s => Mall.schedulerPivot(s).reduce((t, r) => t + r.sales, 0)), [2, 3, 7, 13]);
eq('a scheduler name not on the Agent List is counted as typed and listed as unmatched, never guessed',
  (() => { const b = bookOf(ROWS); b.cases['9001'].schedulerName = 'Scheduler Not On The List'; b.cases['9001'].schedulerCb = null;
    const X = E.dashboard(b, [], { cycleKey: CYCLE, view: 'cycle', asOf: ASOF });
    return [X.schedulers.unmatched, X.disagree.unmatchedSchedulers]; })(), [['Scheduler Not On The List'], 1]);

head('FR-047..FR-049 · the person dimensions, upcoming fitments and the rollover panel');
{ const sch = Mall.persons('scheduler'), ag = Mall.persons('agent'), ref = Mall.persons('referrer');
  eq('the three person dimensions are Agent, Referring Agent and Scheduler', [ag.dim, ref.dim, sch.dim], ['agent', 'referrer', 'scheduler']);
  eq('the scheduler rows reconcile to the sales in view, which is the third integrity check', sch.rows.reduce((s, r) => s + r.sales, 0), Mall.counts.sales);
  eq('the referring-agent dimension counts only the rows that name a referrer', [ref.rows.length, ref.rows.reduce((s, r) => s + r.sales, 0)], [1, 1]);
  ok('the active filters are stated with the figures', /none/.test(sch.words) && typeof sch.filters === 'object', sch.words);
  const f = Mall.persons('scheduler', { channel: 'lead_gen' });
  eq('a channel filter narrows the rows and is named in the words', [f.rows.reduce((s, r) => s + r.sales, 0), /channel = lead_gen/.test(f.words)], [7, true]);
  const dt = Mall.persons('scheduler', { from: '2026-11-01', to: '2026-11-30' });
  eq('a date filter is applied to the sale date', dt.all.sales, 7); }
{ const u = M.upcoming;
  eq('it starts at the earliest booking and runs the rule book\'s horizon', [u.from, u.dates.length], ['2026-11-21', E.VT_RULES.reports.upcomingFitments.horizonDays]);
  eq('the counts per date are the bookings on that date', u.dates.filter(d => d.count > 0).map(d => [d.d, d.count]), [['2026-11-21', 1], ['2026-11-24', 1], ['2026-11-30', 1]]);
  near('each date\'s share is of the whole scheduled pipeline', u.dates[0].share, 1 / 3);
  eq('the tail folds into the rule book\'s label, and the total is every booking', [u.tail.label, u.tail.count, u.total], ['Later dates / not shown', 0, 3]);
  ok('the panel says it covers all bookings including rollovers', /all bookings/i.test(u.words), u.words);
  eq('it is the same panel whatever the view is set to', JSON.stringify(Mroll.upcoming), JSON.stringify(M.upcoming)); }
{ const t = Mall.rollover.totals;
  eq('the rollover panel is the pre-cycle position: 5 / 2 / 1 / 1 / 1 with 3 open to action',
    [t.sales, t.fitted, t.scheduled, t.cancelled, t.missed, t.open], [5, 2, 1, 1, 1, 3]);
  eq('Open to Action is scheduled + cancelled + missed', t.open, t.scheduled + t.cancelled + t.missed);
  eq('Open GWP is the GWP still to be won back', t.gwpOpen, 300);
  ok('the panel is the pre-cycle position whatever the view', JSON.stringify(M.rollover.totals) === JSON.stringify(Mall.rollover.totals) && JSON.stringify(Mcur.rollover.totals) === JSON.stringify(Mall.rollover.totals));
  eq('one row per channel, adding to the totals row', [Mall.rollover.rows.map(r => r.k), Mall.rollover.rows.reduce((s, r) => s + r.sales, 0)], [['lead_gen', 'referral', 'predictive', 'other'], 5]); }

head('FR-012 / FR-014 / FR-015 · the Result column is never applied, and every disagreement is counted');
{ const b = bookOf(ROWS);
  b.cases['9005'].resultRpt = 'fitted';            /* the hand-typed Result says fitted, the engine says scheduled */
  b.cases['9007'].resultRpt = 'cancelled';
  const X = E.dashboard(b, [], { cycleKey: CYCLE, view: 'cycle', asOf: ASOF });
  eq('the engine\'s status stands: the counts do not move', [X.counts.fitted, X.counts.scheduled, X.counts.missed, X.counts.cancelled], [6, 2, 1, 1]);
  eq('…and the disagreement is counted by direction, never applied', [X.disagree.resultApplied, X.disagree.resultVsEngine.total, X.disagree.resultVsEngine.byDirection], [false, 2, { 'fitted -> scheduled': 1, 'cancelled -> missed': 1 }]);
  near('the disagreement carries its share of the view', X.disagree.resultVsEngine.share, 2 / 10);
  eq('on a book where the two agree the count is 0, not absent', M.disagree.resultVsEngine.total, 0);
  ok('the 071 figures are carried forward with the floor guide\'s wording, not restarted',
    X.disagree.carried.handCredits === 11 && /6\.6/.test(String(X.disagree.carried.leadSourceRelabelledShare)) && /Salesforce/.test(X.disagree.carried.words), JSON.stringify(X.disagree.carried));
  eq('unmatched schedulers, unmatched sellers and unmapped campaigns are counts, never silent drops',
    [typeof X.disagree.unmatchedSchedulers, typeof X.disagree.unmatchedSellers, X.disagree.unmappedCampaigns, X.disagree.unmappedNames], ['number', 'number', 1, ['Mystery Co']]);
  ok('the panel is words and counts, never a hidden adjustment', X.disagree.words.length > 20, X.disagree.words); }

head('FR-058 / SC-003 · pure, no clock, no mutation, and the rating untouched');
{ const src = fs.readFileSync(ENGINE, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  eq('no clock anywhere in the engine: every "today" is passed in', src.match(/Date\.now|new\s+Date\s*\(\s*\)|(?:^|[^A-Za-z0-9_$.])Date\s*\(\s*\)/g), null);
  const a = E.dashboard(book, [], { cycleKey: CYCLE, view: 'cycle', asOf: ASOF });
  const b = E.dashboard(book, [], { cycleKey: CYCLE, view: 'cycle', asOf: ASOF });
  ok('the same inputs give a byte-identical answer', JSON.stringify(a) === JSON.stringify(b));
  eq('the book it was given is never mutated', [Object.keys(book.cases).length, book.cases['9001'].status, book.cases['9005'].apptOn], [13, 'fitted', '2026-11-21']);
  eq('the rating still has exactly two drivers at 50 / 50', E.VT_RULES.rating.drivers.map(x => x.k + ':' + x.w), ['targetAch:50', 'fitRate:50']);
  ok('the lead-time buckets are still not scored', /hrsAhead/.test(Object.keys(E.VT_RULES.rating.notScored).join()));
  ok('cycleBudget is a separate branch from budgets, so the rating cannot be reached from here',
    !!E.VT_RULES.cycleBudget && E.VT_RULES.budgets[CYCLE].fitment.digital['*'] === 0.85 && E.VT_RULES.cycleBudget[CYCLE].fitment === undefined);
  eq('the dashboard names the rule-book version it computed with', a.rulesVersion, E.VT_RULES.version); }

head('the budget accessor and its named fallback');
eq('the cycle on file is used and named', [E.cycleBudgetFor(CYCLE).cycle, E.cycleBudgetFor(CYCLE).fallback], [CYCLE, false]);
{ const fb = E.cycleBudgetFor('cycle-2027-03');
  eq('a cycle with no targets falls back to the latest earlier cycle, and says which', [fb.cycle, fb.fallback], [CYCLE, true]);
  ok('…in words the panel can print', /no targets are on file/i.test(fb.words) && /cycle-2026-11/.test(fb.words), fb.words);
  eq('a cycle before every budget on file has none, rather than a guess', E.cycleBudgetFor('cycle-2020-01'), null);
  const X = E.dashboard(book, [], { cycleKey: 'cycle-2027-03', view: 'all', asOf: '2027-02-20' });
  ok('a fallback cycle still paints, and names the cycle its targets came from', X.budget.cycle === CYCLE && X.budget.fallback === true, X.budget.words); }
eq('the channel classifier is exported for the page\'s filters and folds the unknown to Other',
  ['Revx', 'Referral Agent', 'Predictive', 'Mystery Co', null].map(c => E.channelOf(c, null)), ['lead_gen', 'referral', 'predictive', 'other', 'other']);
eq('a campaign\'s case differs, the map still finds it', E.channelOf('  tracking empire ', null), 'lead_gen');

head('B2 - a Schedulers Data commit over this book: status stands, the rating window does not move (risk 2)');
{ /* the same book, dated by the daily files (basis first_seen) and already carrying openingBookOn */
  const daily = bookOf(ROWS.map(r => Object.assign({}, r, { soldBasis: 'first_seen', gwpRpt: null, schedulerName: null, schedulerCb: null, resultRpt: null })));
  const before = E.model(daily, [], { asOf: ASOF, cycleKey: CYCLE });
  const beforeStatuses = Object.keys(daily.cases).sort().map(k => daily.cases[k].status);
  const HDR = ['Month', 'Date', 'Agent', 'Sale Count', 'GWP', 'Case Number', 'Customer Contact', 'Campaign/Partner', 'Referring Agent',
    'Scheduler', 'Result', 'Hrs Ahead', 'Date Scheduled', null, 'Scheduled', 'Missed', 'Fitted', 'Channel'];
  const ser = (d) => Math.round(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 864e5) + 25569;
  /* every Result says Cancelled - the most hostile file possible: not one status may move */
  const aoa = [HDR].concat(Object.keys(daily.cases).sort().map((k) => {
    const r = new Array(18).fill(null), c = daily.cases[k];
    r[0] = 'Current'; r[1] = ser(c.soldOn); r[2] = 'Some Agent'; r[3] = 1; r[4] = 149; r[5] = k; r[6] = '0820000001';
    r[7] = c.campaignRpt || 'Revx'; r[8] = 0; r[9] = 'Scheduler CB9102'; r[10] = 'Cancelled'; r[12] = 0;
    return r;
  }));
  const parsed = E.parseSchedulers(aoa);
  const m = E.merge(daily, parsed, { extractOn: ASOF, roster: [], aliases: {} });
  const after = E.model(m.book, [], { asOf: ASOF, cycleKey: CYCLE });
  eq('not one status moved, whatever the Result column said', Object.keys(m.book.cases).sort().map(k => m.book.cases[k].status), beforeStatuses);
  eq('and no status event was written', m.events, []);
  eq('trackFrom, the working days elapsed and the floor SPD are identical before and after (U-5, risk 2)',
    [after.trackFrom, after.workingDaysElapsed, after.floor.mtd.spd], [before.trackFrom, before.workingDaysElapsed, before.floor.mtd.spd]);
  eq('every disagreement is counted by direction instead (the two already cancelled agree)', m.disagree.total, 11);
  const dash = E.dashboard(m.book, [], { cycleKey: CYCLE, view: 'cycle', asOf: ASOF });
  eq('the dashboard own counts are unmoved by the commit, and the disagreement panel now has figures',
    [dash.counts.sales, dash.counts.fitted, dash.disagree.resultVsEngine.total > 0], [M.counts.sales, M.counts.fitted, true]);

  head('B4 - back-build: the cycles the file covers, and a real previous cycle from the book');
  const cov = E.cyclesInBook(m.book);
  eq('every business cycle the sale dates reach is reported, oldest first', cov.map(c => [c.key, c.cases]), [['cycle-2026-10', 5], ['cycle-2026-11', 8]]);
  eq('the earliest cycle is labelled partial, with the first sale date, in words',
    [cov[0].partial, cov[0].firstSale, /Partial/.test(cov[0].words)], [true, '2026-09-28', true]);
  ok('and a cycle the file covers in full says so', /in full/.test(cov[1].words), cov[1].words);
  const prev = E.prevCycleFor(m.book, [], CYCLE, { asOf: ASOF });
  eq('the previous cycle is computed from the back-built book: its own sales and fitments',
    [prev.cycle, prev.present, prev.partial, prev.counts.sales, prev.counts.fitted], ['cycle-2026-10', true, true, 5, 2]);
  const withPrev = E.dashboard(m.book, [], { cycleKey: CYCLE, view: 'cycle', asOf: ASOF, prev: prev });
  ok('and dashboard({prev}) then paints a real delta instead of the absent marker',
    withPrev.prevCycle.present === true && withPrev.kpis[0].delta && withPrev.kpis[0].delta.abs === withPrev.counts.sales - prev.counts.sales,
    JSON.stringify(withPrev.kpis[0].delta));
  ok('a book with nothing in the previous cycle still reads "no previous cycle on file"',
    E.dashboard(book, [], { cycleKey: CYCLE, view: 'cycle', asOf: ASOF, prev: E.prevCycleFor(bookOf([ROWS[0]]), [], CYCLE, { asOf: ASOF }) }).prevCycle.present === false);
}

finish();
