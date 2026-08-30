/* Behavioural check for the Ops Analytics formula fixes (26 Aug 2026).
   Loads the dashboard's own inline script into a VM with a stub DOM, then drives the real
   functions with synthetic facts. Every case asserts the NEW behaviour and, where the old
   behaviour produced a specific wrong number, names it. Run: node tools/verify-ops-formulas.mjs      */
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HTML = process.env.OPS_HTML ||
  fileURLToPath(new URL('../Chatterbox_AgentOS_Analytics.html', import.meta.url));

const src = fs.readFileSync(HTML, 'utf8');
const blocks = [...src.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);

/* --- the thinnest DOM that lets the definitions run --- */
const el = () => new Proxy(function () {}, {
  get: (t, k) => {
    if (k === 'style' || k === 'dataset' || k === 'classList') return el();
    if (k === 'children' || k === 'childNodes') return [];
    if (k === 'innerHTML' || k === 'textContent' || k === 'value') return '';
    if (k === Symbol.toPrimitive) return () => '';
    return el();
  },
  set: () => true,
  apply: () => el(),
});
const doc = {
  querySelector: () => el(), querySelectorAll: () => [], getElementById: () => null,
  createElement: () => el(), addEventListener: () => {}, body: el(), documentElement: el(),
  head: el(), readyState: 'complete',
};
const sandbox = {
  document: doc, console, setTimeout: () => 0, clearTimeout: () => {}, requestAnimationFrame: () => 0,
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  sessionStorage: { getItem: () => null, setItem: () => {} },
  indexedDB: { open: () => ({}) }, fetch: () => Promise.reject(new Error('no net')),
  location: { href: '', search: '' }, navigator: { userAgent: 'node' },
  Chart: function () {}, XLSX: {}, Papa: {}, structuredClone,
  Date, Math, JSON, Set, Map, Promise, Object, Array, String, Number, Boolean, RegExp, isNaN, parseFloat, parseInt,
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

/* One script, not three: const/let declarations are script-scoped in a VM, so the blocks must
   share a scope and the tail line is what lifts the lexical consts out where the tests can
   reach them. Function declarations land on the global object by themselves. */
sandbox.setInterval = () => 0;
let loaded = 0;
try {
  const EXPORT = ';window.__T={DEFAULT_RULES,DEFAULT_KPIS,SOURCES,SRC_KEYS,COACH_TH,TRANSFORM};';
  vm.runInContext(blocks.join('\n;\n') + '\n' + EXPORT, sandbox, { filename: 'ops-inline.js' });
  loaded = blocks.length;
} catch (e) { console.error('load error:', e.message); }

const G = sandbox;
Object.assign(G, G.__T || {});
if (typeof G.acStats !== 'function') {
  console.error('FATAL: the dashboard functions did not load (script blocks run: ' + loaded + ')');
  process.exit(2);
}

/* --- harness --- */
let pass = 0, fail = 0;
const results = [];
function check(name, got, want, note) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  results.push({ ok, name, got, want, note });
}
function near(name, got, want, tol, note) {
  const ok = got != null && Math.abs(got - want) <= tol;
  ok ? pass++ : fail++;
  results.push({ ok, name, got, want: `${want} ±${tol}`, note });
}

/* --- put the app into a known state --- */
G.state.rules = structuredClone(G.DEFAULT_RULES);
G.state.kpis = structuredClone(G.DEFAULT_KPIS);
G.state.filters = { campaign: '', team: '', agent: '', dept: '', tenure: '' };
G.state.range = { mode: 'all', from: null, to: null };
G.state.facts = {};
G.state.batches = [];
G.state.cbInfo = {
  CB1: { code: 'CB-1', name: 'Alpha Agent', tl: 'Tee Leader', queue: 'Cuddle', tenure: 'M2', target: 1 },
  CB2: { code: 'CB-2', name: 'Beta Agent', tl: 'Tee Leader', queue: 'Courtesy', tenure: 'M2', target: 1 },
  CB3: { code: 'CB-3', name: 'Gamma Agent', tl: 'Tee Leader', queue: 'Nesting', tenure: 'M2', target: 1 },
};
G.state.sfOwnerMap = { 'alpha agent': 'CB1', 'beta agent': 'CB2', 'gamma agent': 'CB3' };
G.state.agentMap = {};
const WIN = { from: '2026-08-01', to: '2026-08-31' };

/* ===================================================================
   D1 — the weakest driver must be able to be any of the six
   =================================================================== */
{
  const st = { sc: { 'GWP/Sale': 10, 'Target Ach': 95, 'QA': 96, 'Conversion': 40, 'Talk': 90, 'Attendance': 99 } };
  const w = G.acWeakestDriver(st);
  check('D1 weakest driver is GWP/Sale (25% weight, 10/100)', w && w.driver, 'gwpSale',
    'before the fix this returned "conv" — 6 points beating 22.5, because four names never matched');
  check('D1 it is labelled for a human', w && w.label, 'GWP / Sale');
  near('D1 points available are the unearned weight', w && w.points, 22.5, 0.001);  // 90% of weight 25

  const st2 = { sc: { 'GWP/Sale': 100, 'Target Ach': 20, 'QA': 99, 'Conversion': 99, 'Talk': 99, 'Attendance': 99 } };
  check('D1 Target Ach can now win', G.acWeakestDriver(st2).driver, 'targetAch');
  const st3 = { sc: { 'GWP/Sale': 100, 'Target Ach': 100, 'QA': 30, 'Conversion': 99, 'Talk': 99, 'Attendance': 99 } };
  check('D1 QA can now win', G.acWeakestDriver(st3).driver, 'qa');
  const st4 = { sc: { 'GWP/Sale': 100, 'Target Ach': 100, 'QA': 100, 'Conversion': 100, 'Talk': 0, 'Attendance': 100 } };
  check('D1 Talk can now win', G.acWeakestDriver(st4).driver, 'talk');
  check('D1 every driver name in the rule resolves', G.compWeights()
    .map(([n]) => n).filter(n => n !== 'GWP %ile')
    .every(n => G.acWeakestDriver({ sc: { [n]: 50 } }) !== null), true,
    'GWP %ile has no per-agent score and is correctly not a coachable driver');
}

/* ===================================================================
   D2 — Disputed reads qa_status, and survives the vocabulary rename
   =================================================================== */
{
  check('D2 legacy code matches', G.statusIn('closed_retracted', G.state.rules.qaDisputeStatuses.vals), true);
  check('D2 current export wording matches', G.statusIn('Closed \u2014 Retracted', G.state.rules.qaDisputeStatuses.vals), true,
    'em dash, as shipped in the 2026-08-06 export');
  check('D2 hyphen variant matches', G.statusIn('Closed - Retracted', G.state.rules.qaDisputeStatuses.vals), true);
  check('D2 the 95% terminal state is NOT a dispute', G.statusIn('Closed \u2014 Risk Mitigated', G.state.rules.qaDisputeStatuses.vals), false);
  check('D2 a blank status is not a dispute', G.statusIn('', G.state.rules.qaDisputeStatuses.vals), false);
  check('D2 undefined (the old bug: QA rows have no .status) is not a dispute',
    G.statusIn(undefined, G.state.rules.qaDisputeStatuses.vals), false);
}

/* ===================================================================
   D3 — QA score denominator: scored evals + unscored criticals
   =================================================================== */
function qaCase(rows) {
  G.state.facts = { QA_EVALUATIONS: rows.map((r, i) => ({
    record_id: 'R' + i, sales_agent_code: 'CB-1', sales_agent: 'Alpha Agent',
    score_percent: r.s, escalation_decision: r.c ? 'Critical Fail' : 'Pass',
    qa_status: 'Closed \u2014 Risk Mitigated', team_leader: 'Tee Leader', campaign: 'Cuddle',
    call_date: '2026-08-10', _d: '2026-08-10' })) };
  G.bumpDataVer();
  return G.acStats('CB1', WIN, G.acCtx(WIN));
}
{
  const a = qaCase([{ s: 90 }, { s: 90 }, { s: 90 }, { s: 90 }, { s: 90 }, { s: 90 }, { s: 90 }, { s: 90 }, { s: null }, { s: null }]);
  near('D3 8 scored at 90% + 2 blank-score evals = 90%', a.qaS, 90, 0.001,
    'before the fix: 720/10 = 72% — the two admin rows scored the agent zero');
  check('D3 the blank rows still count as coverage (n)', a.qaN, 10);

  const b = qaCase([{ s: 90 }, { s: 90 }, { s: 90 }, { s: null, c: true }]);
  near('D3 a critical fail with no score still counts as a zero', b.qaS, 67.5, 0.001,
    '270 / 4 — v3.0 rule preserved');
  const c = qaCase([{ s: 100 }, { s: 80, c: true }]);
  near('D3 a critical fail WITH a score also scores zero', c.qaS, 50, 0.001, '100 / 2');
  const d = qaCase([{ s: null }, { s: null }]);
  check('D3 nothing scoreable reads null, never 0%', d.qaS, null);
}

/* ===================================================================
   D4 — attendance denominators exclude roster exits
   =================================================================== */
{
  const att = [];
  for (let i = 1; i <= 9; i++) att.push({ employee_code: 'CB-1', reports_to: 'Tee Leader', department: 'Sales', status_code: 'P', status: 'Present', _d: '2026-08-0' + i });
  att.push({ employee_code: 'CB-2', reports_to: 'Tee Leader', department: 'Sales', status_code: 'Terminated', status: 'Terminated', _d: '2026-08-05' });
  G.state.facts = { ATTENDANCE: att };
  G.bumpDataVer();
  const rows = G.rowsFor('ATTENDANCE', WIN);
  const kept = rows.filter(r => !r.excluded_flag);
  check('D4 the exit row is flagged', rows.filter(r => r.excluded_flag).length, 1);
  near('D4 team rate over non-exit rows only', kept.filter(r => r.present_flag).length / kept.length * 100, 100, 0.001,
    'before the fix the team read 9/10 = 90% and sorted to the top of a worst-first table');
  const k = G.state.kpis.find(x => x.id === 'attendance_rate');
  near('D4 and it now equals the Attendance Rate KPI', G.evalKPI(k, WIN), 100, 0.001);
}

/* ===================================================================
   M1 — no present days means no per-day rate
   =================================================================== */
{
  G.state.facts = {
    BI_ACTIVE_CASES: [1, 2, 3].map(n => ({ account_number: 'A' + n, owner: 'Alpha Agent', charge_amount: 86.08, case_number: 'C' + n, product_bundle: 'MYP', _d: '2026-08-0' + n })),
    CALLX_CALL_RECORDS: [{ agent: 'Alpha Agent CB-1', destination_number: '0821', billable_seconds: 36000, call_type: 'outbound', lead_disposition: 'Sale', _d: '2026-08-01' }],
    ATTENDANCE: [],
  };
  G.bumpDataVer();
  const noAtt = G.acStats('CB1', WIN, G.acCtx(WIN));
  check('M1 sales/day is null with no present days', noAtt.spd, null, 'was 3 — the period TOTAL wearing a per-day label');
  check('M1 Target Achievement is null, not 300%', noAtt.ta, null);
  check('M1 talk/day is null, not 600 minutes', noAtt.talkDay, null);
  check('M1 unique calls/day is null', noAtt.uniqPerDay, null);
  check('M1 the totals themselves are untouched', [noAtt.sales, noAtt.talkMin, noAtt.uniqCalls], [3, 600, 1]);

  const nba = G.acNBA(noAtt);
  check('M1 the ladder does not fire a volume rule on a data gap',
    ['R4A', 'R6', 'R9', 'R8'].includes(nba.code), false, 'it fired R6/R9 off the inflated figure before');

  G.state.facts.ATTENDANCE = [1, 2, 3, 4, 5].map(n => ({ employee_code: 'CB-1', reports_to: 'Tee Leader', department: 'Sales', status_code: 'P', status: 'Present', _d: '2026-08-0' + n }));
  G.bumpDataVer();
  const withAtt = G.acStats('CB1', WIN, G.acCtx(WIN));
  near('M1 with 5 present days it computes normally', withAtt.spd, 0.6, 0.001);
  near('M1 target achievement against a target of 1/day', withAtt.ta, 60, 0.001);
  near('M1 talk/day = 600 min / 5 days', withAtt.talkDay, 120, 0.001);
}

/* ===================================================================
   M2 — closed per sale is a ratio
   =================================================================== */
{
  G.state.facts = {
    BI_ACTIVE_CASES: [{ account_number: 'A1', owner: 'Alpha Agent', charge_amount: 86.08, case_number: 'C1', _d: '2026-08-01' }],
    SF_CLOSED_CASES: [1, 2, 3, 4, 5, 6, 7, 8].map(n => ({ case_number: 'K' + n, case_owner: 'Alpha Agent', status: 'Closed', _d: '2026-08-0' + n, closed_at: '2026-08-0' + n })),
  };
  G.bumpDataVer();
  const st = G.acStats('CB1', WIN, G.acCtx(WIN));
  near('M2 8 closed / 1 sale reads 8, not 800', st.closedPerSale, 8, 0.001);
  check('M2 the old percentage field is gone', 'convClosed' in st, false);
  check('M2 the funnel rate is a separate, unchanged number', st.conv != null && st.conv <= 100, true);
}

/* ===================================================================
   M4 — Cancellations and GWP Lost read one row set
   =================================================================== */
{
  G.state.facts = {
    BI_ACTIVE_CASES: [{ account_number: 'A1', owner: 'Alpha Agent', charge_amount: 100, case_number: 'C1', _d: '2026-08-01' }],
    SF_INACTIVE: [
      { account_number: 'X1', owner: 'Alpha Agent', contract_status: 'Inactive', charge_amount: 100, create_date: '2026-08-02', _d: '2026-08-02' },
      { account_number: 'X2', owner: 'Alpha Agent', contract_status: 'Active', charge_amount: 900, create_date: '2026-08-03', _d: '2026-08-03' },
    ],
  };
  G.bumpDataVer();
  const cancelKpi = G.state.kpis.find(k => k.id === 'cancellations');
  const lostKpi = G.state.kpis.find(k => k.id === 'gwp_lost');
  check('M4 the count sees one cancellation', G.evalKPI(cancelKpi, WIN), 1);
  near('M4 GWP Lost prices that same one', G.evalKPI(lostKpi, WIN), 115, 0.01,
    'before the fix it priced both rows: R1,150 against a count of 1');
  check('M4 both read the cancelStatuses rule', G.resolveRule('$cancelStatuses'), ['Inactive']);
}

/* ===================================================================
   M6 — campaign folding and off-panel money
   =================================================================== */
{
  check('M6 the Que-format spelling folds to the target key', G.campBucket('Cuddle Calls'), 'Cuddle');
  check('M6 so does the Campaign-format spelling', G.campBucket('Cuddle'), 'Cuddle');
  check('M6 the tracker folds to VT', G.campBucket('Matrix Vehicle Tracking'), 'VT');
  check('M6 Nesting is not silently pooled', G.campBucket('Nesting'), '');

  G.state.rules.cycleStart.vals = ['2026-08-01'];
  G.state.rules.cycleDialingDays.vals = ['21'];
  G.state.rules.cycleTargets.vals = ['Cuddle:1000', 'Courtesy:1000'];
  G.state.facts = {
    BI_ACTIVE_CASES: [
      { account_number: 'A1', owner: 'Alpha Agent', charge_amount: 100, case_number: 'C1', _d: '2026-08-04' },
      { account_number: 'A2', owner: 'Beta Agent', charge_amount: 100, case_number: 'C2', _d: '2026-08-04' },
      { account_number: 'A3', owner: 'Gamma Agent', charge_amount: 200, case_number: 'C3', _d: '2026-08-04' },
    ],
  };
  G.bumpDataVer();
  const CC = G.cycleCalc('cycle');
  near('M6 Cuddle money reaches the Cuddle panel', CC.byCamp['Cuddle'], 115, 0.01,
    'keyed on the raw queue this was byCamp["Cuddle Calls"] on a Que-format roster — panel R0.00');
  near('M6 Courtesy likewise', CC.byCamp['Courtesy'], 115, 0.01);
  near('M6 Nesting money is kept under its own key, not lost', CC.byCamp['Nesting'], 230, 0.01);
  check('M6 and Nesting has no target panel, so it must be reported', CC.targets.some(t => t[0] === 'Nesting'), false);
  check('M6 nothing is unattributed here', CC.unatt, 0);
  const panelled = CC.targets.reduce((s, t) => s + (CC.byCamp[t[0]] || 0), 0);
  const total = Object.values(CC.byCamp).reduce((s, v) => s + v, 0);
  near('M6 the off-panel remainder the banner now names', total - panelled, 230, 0.01);
}

/* ===================================================================
   Hygiene
   =================================================================== */
{
  /* F1 — Answer Rate follows the disposition, not the band label */
  G.state.facts = { CALLX_CALL_RECORDS: [
    { agent: 'Alpha Agent CB-1', billable_seconds: 5, call_type: 'outbound', lead_disposition: 'Sale', destination_number: '0821', _d: '2026-08-01' },
    { agent: 'Alpha Agent CB-1', billable_seconds: 400, call_type: 'outbound', lead_disposition: 'No Answer', destination_number: '0822', _d: '2026-08-01' },
  ] };
  G.bumpDataVer();
  const ansKpi = G.state.kpis.find(k => k.id === 'answer_rate');
  near('F1 answer rate is 50% on the shipped band names', G.evalKPI(ansKpi, WIN), 50, 0.001);
  G.state.rules.callTypes.vals = ['0:Unreached', '30:Customer Service', '180:Pitch', '360:Closing'];
  G.bumpDataVer();
  near('F1 and stays 50% after the first band is renamed', G.evalKPI(ansKpi, WIN), 50, 0.001,
    'the hardcoded "No Answer" comparison used to send this to 100%');
  G.state.rules.callTypes.vals = structuredClone(G.DEFAULT_RULES.callTypes.vals);

  /* F3 — head-count KPIs normalise the CB code */
  G.state.facts = { QA_EVALUATIONS: [
    { record_id: '1', sales_agent_code: 'CB-15', sales_agent: 'Alpha Agent', offense_number: 2, score_percent: 80, escalation_decision: 'Pass', qa_status: 'Pending TL Action', _d: '2026-08-01', call_date: '2026-08-01' },
    { record_id: '2', sales_agent_code: 'CB15', sales_agent: 'Alpha Agent', offense_number: 3, score_percent: 80, escalation_decision: 'Pass', qa_status: 'Pending TL Action', _d: '2026-08-02', call_date: '2026-08-02' },
    { record_id: '3', sales_agent_code: 'cb 15', sales_agent: 'Alpha Agent', offense_number: 4, score_percent: 80, escalation_decision: 'Pass', qa_status: 'Pending TL Action', _d: '2026-08-03', call_date: '2026-08-03' },
  ] };
  G.bumpDataVer();
  check('F3 three spellings of one code are one agent in process',
    G.evalKPI(G.state.kpis.find(k => k.id === 'agents_in_process'), WIN), 1, 'read 3 before');
  check('F3 and one repeat offender', G.evalKPI(G.state.kpis.find(k => k.id === 'repeat_offenders'), WIN), 1);

  /* F6 — the MTD projection reaches month end */
  G.state.facts = { CALLX_CALL_RECORDS: [1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => (
    { agent: 'Alpha Agent CB-1', billable_seconds: 60, call_type: 'outbound', lead_disposition: 'Sale', destination_number: '08' + n, _d: '2026-08-0' + n })) };
  G.bumpDataVer();
  G.state.range = { mode: 'mtd', from: null, to: null };
  const w = G.periodWindow();
  check('F6 the MTD window still ends on the newest data day', [w.from, w.to], ['2026-08-01', '2026-08-09']);
  const calls = G.state.kpis.find(k => k.id === 'total_calls');
  const foot = G.kpiTargetFoot(Object.assign({}, calls, { green: 100 }), 9, w, false);
  const pct = [...foot.matchAll(/([\d.,]+)% of tgt|proj ([\d.,]+)%/g)];
  const projTxt = /proj ([\d.,]+)%/.exec(foot);
  check('F6 the projection no longer equals the current value',
    projTxt != null && parseFloat(projTxt[1].replace(/,/g, '')) > 9, true,
    '9 calls over 7 elapsed workdays projects across 21 August workdays, not 9');
  G.state.range = { mode: 'all', from: null, to: null };
}

/* ===================================================================
   QA dates on Date of Assessment (Nick 2026-08-26) — suite-wide with PULSE
   =================================================================== */
{
  const t = G.TRANSFORM.QA_EVALUATIONS;
  const base = { 'Record ID': 'X1', 'Sales Agent': 'A', 'Score %': '90%', 'Status': 's' };
  const f1 = t({ ...base, 'Date of Call': '2026-08-20', 'Date of Assessment': '2026-08-24', 'Submitted At': '2026-08-24 09:00' });
  check('QA rows date on Date of Assessment, not Date of Call', f1._d, '2026-08-24',
    'assessments lag calls by days; call-dating made fresh uploads look missing');
  check('the call date itself is still kept for reference', f1.call_date, '2026-08-20');
  const f2 = t({ ...base, 'Date of Call': '2026-08-20', 'Date of Assessment': '', 'Submitted At': '2026-08-25 10:00' });
  check('blank assessment falls back to Submitted At', f2._d, '2026-08-25');
  const f3 = t({ ...base, 'Date of Call': '2026-08-20', 'Date of Assessment': '', 'Submitted At': '' });
  check('and to Date of Call as the last resort (old-format exports)', f3._d, '2026-08-20');
}

/* --- report --- */
const W = Math.max(...results.map(r => r.name.length));
for (const r of results) {
  const line = (r.ok ? '  ok   ' : '  FAIL ') + r.name.padEnd(W);
  console.log(r.ok ? line : line + `\n         got ${JSON.stringify(r.got)}  want ${JSON.stringify(r.want)}`);
  if (!r.ok && r.note) console.log('         ' + r.note);
}
console.log(`\n${pass} passed, ${fail} failed  (${path.basename(HTML)})`);
process.exit(fail ? 1 : 0);
