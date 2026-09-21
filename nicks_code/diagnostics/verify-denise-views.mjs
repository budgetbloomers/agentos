/* THE DENISE PILOT — PART 2: THE TWO VIEWS.
 *
 * The agent view and the team-leader view are not a second calculation — the doctrine is
 * "the engine decides, the page paints" (non-negotiable 12). So this suite takes the digest
 * PULSE built during verify-denise-pilot.mjs and pushes it through the Worker's OWN
 * authorise() and checksFor(), the real modules, unmodified. No credentials are needed:
 * both are pure functions over a digest.
 *
 * What it proves before go-live:
 *   · an agent sees themselves and nobody else
 *   · a team leader sees their team and nobody else's
 *   · the two checks on an agent's card agree with the engine's own numbers
 *   · an agent on the payroll but absent from the period is an honest empty month,
 *     not "no match"
 *   · and what the ragged money file does to the pass/fail verdict the agent reads
 *
 * Run verify-denise-pilot.mjs first; this reads scratch/denise/evidence.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authorise } from '../../worker/src/portal.mjs';
import { checksFor, withFloorEx, gwpFloorEx, VAT } from '../../worker/src/rules.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EV = path.join(HERE, 'scratch', 'denise', 'evidence.json');
if (!fs.existsSync(EV)) { console.log('run verify-denise-pilot.mjs first — no evidence.json'); process.exit(2); }
const E = JSON.parse(fs.readFileSync(EV, 'utf8'));
const digest = E.round1.digest;
const TL = 'Denise Haripersad', TL_OTHER = 'Sharoma Pillay';

let pass = 0, fail = 0; const failures = [], notes = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ' + n); }
  else { fail++; failures.push(n + (d ? ' — ' + d : '')); console.log('  FAIL ' + n + (d ? ' — ' + d : '')); } };

console.log('\n================ THE TWO VIEWS — over the pilot digest ================');
console.log('digest: ' + digest.agents.length + ' agents · period ' + JSON.stringify(digest.period) +
  ' · published ' + digest.updatedAt);

/* ---------- the rule-book constants the pages are forbidden to re-derive ---------- */
console.log('\n-- THE FLOOR, DERIVED ONCE');
const th = withFloorEx(null);
console.log('   gwpFloor R' + th.gwpFloor + ' incl · gwpFloorEx R' + th.gwpFloorEx + ' ex · VAT ' + VAT);
ok('the ex-VAT floor is FLOORED to the cent Salesforce books, not the raw quotient',
  th.gwpFloorEx === 86.08 && 99 / VAT > 86.08, 'R' + th.gwpFloorEx + ' (raw quotient ' + (99 / VAT).toFixed(4) + ')');
ok('gwpFloorEx is a pure function of the incl floor', gwpFloorEx(99) === 86.08 && gwpFloorEx(120) === Math.floor(120 / VAT * 100) / 100);

/* ---------- AGENT SCOPE ---------- */
console.log('\n-- AGENT VIEW · scope');
for (const a of digest.agents) {
  const auth = authorise({ role: 'agent', cb: a.code }, digest);
  ok('[' + a.code + '] sees exactly one row — their own',
    !auth.error && auth.scope === 'agent' && auth.rows.length === 1 && auth.rows[0].code === a.code,
    auth.error || (auth.rows || []).map(r => r.code).join(','));
}
{ const auth = authorise({ role: 'agent', cb: 'CB999' }, digest);
  ok('an agent with no row in the period gets an honest empty month, not an error',
    !auth.error && auth.missing === true && auth.rows.length === 0, JSON.stringify(auth.error || auth.missing)); }
{ const auth = authorise({ role: 'agent', cb: '' }, digest);
  ok('an account with no CB is refused loudly', !!auth.error && auth.status === 403, JSON.stringify(auth.error)); }
/* the padded spelling an agent might be provisioned under */
{ const auth = authorise({ role: 'agent', cb: 'CB095' }, digest);
  ok('a login provisioned with a PADDED CB still finds the agent',
    !auth.error && !auth.missing && auth.rows[0]?.code === 'CB95',
    'CB095 -> ' + (auth.rows?.[0]?.code || (auth.missing ? 'missing' : auth.error)));
  if (auth.missing) notes.push('PADDED LOGIN: an agent account provisioned as CB095 resolves to an empty month — ' +
    'normCb in portal.mjs must strip the padding the same way cbCode() does in the engine.'); }

/* ---------- TEAM LEADER SCOPE ---------- */
console.log('\n-- TEAM LEADER VIEW · scope');
const den = authorise({ role: 'team_leader', team: TL, cb: 'CB902' }, digest);
const sha = authorise({ role: 'team_leader', team: TL_OTHER, cb: 'CB903' }, digest);
console.log('   ' + TL + ': ' + (den.rows || []).map(r => r.code).join(', '));
console.log('   ' + TL_OTHER + ': ' + (sha.rows || []).map(r => r.code).join(', '));
ok('Denise sees a team', !den.error && den.rows.length > 0, den.error || '');
ok('every row Denise sees is hers', !den.error && den.rows.every(r => String(r.tl).trim() === TL),
  (den.rows || []).map(r => r.code + ':' + r.tl).join(' '));
ok('no agent appears in both leaders’ lists',
  !den.error && !sha.error ? den.rows.every(r => !sha.rows.some(x => x.code === r.code)) : true,
  'the digest carries the PERIOD-CORRECT leader, one per agent');
ok('a team leader with no team linked is refused loudly, never shown an empty team',
  (() => { const a = authorise({ role: 'team_leader', team: '', cb: 'CB902' }, digest); return !!a.error && a.status === 403; })(), '');
ok('a team leader whose team name no longer matches the list is told so',
  (() => { const a = authorise({ role: 'team_leader', team: 'Denise Haripersaad', cb: 'CB902' }, digest); return !!a.error && a.status === 409; })(),
  'a renamed team must fail with 409, not an empty screen');
/* the movement: the digest carries ONE leader per agent for the period */
{ const mover = digest.agents.find(a => a.code === 'CB918');
  console.log('   the mover CB918 is filed under: ' + mover.tl);
  ok('the mover appears under exactly one leader in the agent-facing digest',
    [den, sha].filter(x => !x.error && x.rows.some(r => r.code === 'CB918')).length === 1,
    'digest tl = ' + mover.tl + ' (tlAgg still splits the SALES across both — two questions, two answers)'); }

/* ---------- THE TWO CHECKS ---------- */
console.log('\n-- THE TWO CHECKS ON EVERY CARD (value · volume)');
const prov = E.provisional || { gwp: {}, sales: {} };
const meas = E.source || { gwp: {}, sales: {} };
const rows = [];
for (const a of digest.agents) {
  const c = checksFor(a, null);
  const measuredAveG = meas.gwp[a.code] && meas.sales[a.code]
    ? (meas.gwp[a.code] / VAT) / meas.sales[a.code] : null;     // ex-VAT average over the MEASURED sales only
  rows.push({ code: a.code, name: a.name, aveG: a.aveG, measuredAveG, valuePass: c.value.pass,
    pct: c.volume.pct, volumePass: c.volume.pass, provSales: prov.sales[a.code] || 0 });
  ok('[' + a.code + '] the value check is decided by the engine, not the page',
    c.value.floorEx === th.gwpFloorEx && c.value.pass === (a.aveG >= th.gwpFloorEx),
    'aveG R' + a.aveG + ' vs floor R' + c.value.floorEx + ' -> ' + c.value.pass);
  ok('[' + a.code + '] the volume check compares %-to-target against the rule-book line',
    c.volume.line === 100 && (a.pctT == null ? c.volume.pass === null : c.volume.pass === (Math.round(a.pctT * 10000) / 100 >= 100)),
    'pctT ' + c.volume.pct + '% vs ' + c.volume.line + '% -> ' + c.volume.pass);
}
console.log('\n   code    name                    aveG(shown)  aveG(measured)  value   prov.sales');
for (const r of rows) console.log('   ' + r.code.padEnd(7) + ' ' + String(r.name).padEnd(23) +
  String(r.aveG).padStart(8) + String(r.measuredAveG == null ? '—' : r.measuredAveG.toFixed(2)).padStart(15) +
  '   ' + (r.valuePass ? 'PASS' : 'FAIL').padEnd(6) + String(r.provSales).padStart(8));

/* THE FINDING THIS TABLE EXISTS FOR. */
{ const flipped = rows.filter(r => r.measuredAveG != null && r.provSales > 0 &&
    (r.measuredAveG >= th.gwpFloorEx) !== !!r.valuePass);
  ok('the value check does not flip on days the money file has not reached yet',
    flipped.length === 0,
    flipped.map(r => r.code + ': measured R' + r.measuredAveG.toFixed(2) + ' PASS -> shown R' + r.aveG + ' FAIL').join(' · '));
  if (flipped.length) notes.push('CHECK 1 FLIPS ON A LAGGING MONEY FILE: ' + flipped.length + ' of ' + rows.length +
    ' pilot agents read FAIL on the value check only because the four dialling days the Power BI export has not ' +
    'reached are priced at a flat R89 incl (R' + (89 / VAT).toFixed(2) + ' ex), below the R' + th.gwpFloorEx +
    ' floor. On the measured sales alone every one of them is at or above the floor. ' +
    flipped.map(r => r.code + ' R' + r.measuredAveG.toFixed(2) + ' → R' + r.aveG).join('; ') + '.'); }

/* ---------- WHAT THE TEAM LEADER'S TABLE ADDS UP TO ---------- */
console.log('\n-- TEAM LEADER TOTALS reconcile against the agent rows');
if (!den.error) {
  const sum = den.rows.reduce((o, r) => ({ sales: o.sales + (r.sales || 0), gwpEx: o.gwpEx + (r.gwpEx || 0),
    target: o.target + (r.target || 0), emp: o.emp + (r.emp || 0), act: o.act + (r.act || 0) }),
    { sales: 0, gwpEx: 0, target: 0, emp: 0, act: 0 });
  const tlRows = (digest.tlAgg || []).filter(r => r.tl === TL);
  const agg = tlRows.reduce((o, r) => ({ sales: o.sales + r.sales, target: o.target + r.target,
    emp: o.emp + r.emp, act: o.act + r.act, hc: o.hc + r.hc }), { sales: 0, target: 0, emp: 0, act: 0, hc: 0 });
  console.log('   agent rows: ' + den.rows.length + ' agents, ' + sum.sales + ' sales, target ' + sum.target +
    ', emp ' + sum.emp + ' · tlAgg: ' + agg.hc + ' headcount, ' + agg.sales + ' sales, target ' + agg.target + ', emp ' + agg.emp);
  ok('the leader’s campaign roll-up and their agent rows report the same sales',
    agg.sales === sum.sales, 'tlAgg ' + agg.sales + ' vs agents ' + sum.sales);
  ok('…the same sales target', Math.abs(agg.target - sum.target) < 1, 'tlAgg ' + agg.target + ' vs agents ' + sum.target);
  ok('…the same employed shifts', Math.abs(agg.emp - sum.emp) < 0.01, 'tlAgg ' + agg.emp + ' vs agents ' + sum.emp);
  ok('…and the same head count', agg.hc === den.rows.length, 'tlAgg ' + agg.hc + ' vs ' + den.rows.length + ' agent rows');
}

/* ---------- ABSENCE IS NOT A NOUGHT, on the card the agent reads ---------- */
console.log('\n-- ABSENCE IS NOT A NOUGHT (non-negotiable 6)');
for (const a of digest.agents) {
  const comp = E.round1.composites[a.code];
  if (!comp) continue;
  const unmeasured = (comp.parts || []).filter(p => !p.measured);
  const scored = (comp.parts || []).filter(p => p.measured).reduce((n, p) => n + p.w, 0);
  ok('[' + a.code + '] the composite renormalises over the drivers this agent actually has',
    comp.weightScored === scored, 'weightScored=' + comp.weightScored + ' sum of measured weights=' + scored +
    ' · unmeasured: ' + (comp.unmeasured || []).join(', '));
  ok('[' + a.code + '] an unmeasured driver scores no points and claims no availability',
    unmeasured.every(p => p.points === 0 && p.available === 0),
    unmeasured.map(p => p.k + ':' + p.points + '/' + p.available).join(' '));
}
{ const z = digest.agents.find(a => a.qa === 0);
  ok('a real 0% QA is an OUTCOME — scored, not renormalised away',
    !!z && E.round1.composites[z.code].parts.find(p => p.k === 'qa').measured === true,
    z ? z.code + ' qa=0 measured=' + E.round1.composites[z.code].parts.find(p => p.k === 'qa').measured : 'no 0% agent'); }
{ const n = digest.agents.find(a => a.qa == null);
  if (n) { const p = E.round1.composites[n.code].parts.find(x => x.k === 'qa');
    ok('a MISSING QA is left out of the denominator — never imputed, never zeroed',
      p.measured === false && p.value === null && E.round1.composites[n.code].weightScored < 90,
      n.code + ' qa part=' + JSON.stringify({ measured: p.measured, value: p.value, points: p.points }) +
      ' weightScored=' + E.round1.composites[n.code].weightScored); } }

/* ---------- A MISSING TARGET IS NOT A MISSING MEASUREMENT ---------- */
console.log('\n-- WHAT A ZERO TARGET DOES TO A RATING');
{ const board = digest.agents.map(a => ({ code: a.code, name: a.name, campaign: a.campaign, score: a.score,
    w: E.round1.composites[a.code]?.weightScored, sales: a.sales, target: a.target }))
    .sort((x, y) => (y.score || 0) - (x.score || 0));
  console.log('   rank  code    campaign          score   framework scored   sales/target');
  board.forEach((b, i) => console.log('   ' + String(i + 1).padStart(4) + '  ' + b.code.padEnd(7) + ' ' +
    String(b.campaign).padEnd(17) + String((b.score * 100).toFixed(1)).padStart(6) + String(b.w + '%').padStart(15) +
    '     ' + b.sales + '/' + b.target));
  const noTarget = board.filter(b => !b.target);
  ok('no agent is rated over a smaller framework than their peers because of a missing target',
    noTarget.length === 0 || noTarget.every(b => b.w >= 90),
    noTarget.map(b => b.code + ' (' + b.campaign + ') scored over ' + b.w + '% of the framework').join(', '));
  if (noTarget.length && board[0].code === noTarget[0].code)
    notes.push('ZERO TARGET \u2192 TOP OF THE LEADERBOARD: ' + noTarget[0].code + ' on "' + noTarget[0].campaign +
      '" has no sales target, so Target Achievement (20) and Total GWP (15) are dropped from the denominator as ' +
      '"not measured" rather than scored. The agent is rated over ' + noTarget[0].w + '% of the framework where ' +
      'everyone else is rated over 90%, and lands FIRST on the team leaderboard at ' + (board[0].score * 100).toFixed(1) +
      ' while selling ' + noTarget[0].sales + ' in the period. The doctrine (an absence is not a nought) is right; ' +
      'the absence should never have existed.'); }

/* ---------- THE MOVER: two panels, two answers ---------- */
console.log('\n-- THE MOVER, ON THE TEAM LEADER\u2019S SCREEN');
{ const mover = digest.agents.find(a => a.code === 'CB918');
  const facts = E.round1.perAgent.CB918.tls;
  const denRow = (digest.tlAgg || []).filter(r => r.tl === TL).reduce((n2, r) => n2 + r.sales, 0);
  const denAgents = den.error ? 0 : den.rows.reduce((n2, r) => n2 + (r.sales || 0), 0);
  console.log('   the facts split CB918: ' + JSON.stringify(facts));
  console.log('   the digest row files all ' + mover.sales + ' under ' + mover.tl);
  console.log('   Denise\u2019s campaign roll-up: ' + denRow + ' sales · Denise\u2019s agent rows: ' + denAgents + ' sales');
  ok('the team-leader screen\u2019s two panels agree on the team\u2019s sales',
    denRow === denAgents, 'roll-up ' + denRow + ' vs agent rows ' + denAgents +
    ' \u2014 difference ' + (denAgents - denRow) + ', exactly the ' + (facts[TL_OTHER] || 0) + ' sales CB918 made under ' + TL_OTHER);
  if (denRow !== denAgents) notes.push('MOVER ATTRIBUTION IN THE DIGEST: the fact table splits CB918\u2019s period correctly (' +
    JSON.stringify(facts) + '), and the campaign roll-up (tlAgg) carries that split. The per-agent digest row cannot \u2014 it has ' +
    'one `tl` field \u2014 so all ' + mover.sales + ' of the mover\u2019s sales are filed under ' + mover.tl + '. On one ' +
    'team-leader screen the roll-up says ' + denRow + ' and the agent rows say ' + denAgents + '.');
  ok('the previous leader can still see the month they actually led',
    !sha.error, sha.error ? String(sha.error) + ' (status ' + sha.status + ') \u2014 ' + (facts[TL_OTHER] || 0) +
    ' sales were made under ' + TL_OTHER + ' in this period' : '');
  if (sha.error) notes.push('A LEADER WITH NO CURRENT AGENTS IS LOCKED OUT OF THEIR OWN HISTORY: ' + TL_OTHER +
    ' led ' + (facts[TL_OTHER] || 0) + ' of the pilot\u2019s sales, but because no agent on today\u2019s list names her, ' +
    'authorise() returns ' + sha.status + ' \u2014 "No agents are currently assigned". Correct as written; wrong for a ' +
    'month-end review.'); }

/* ---------- report ---------- */
fs.writeFileSync(path.join(HERE, 'scratch', 'denise', 'views.json'), JSON.stringify(
  { generated: new Date().toISOString(), thresholds: th, checkTable: rows,
    denise: den.error ? { error: den.error } : den.rows.map(r => ({ code: r.code, name: r.name, tl: r.tl, campaign: r.campaign })),
    sharoma: sha.error ? { error: sha.error } : sha.rows.map(r => ({ code: r.code, name: r.name, tl: r.tl })),
    tlAgg: digest.tlAgg, notes, result: { pass, fail, failures } }, null, 2));

console.log('\n================================================================');
console.log('  ' + pass + ' passed · ' + fail + ' failed');
if (failures.length) { console.log('\n  FAILURES:'); failures.forEach(f => console.log('   · ' + f)); }
if (notes.length) { console.log('\n  FINDINGS:'); notes.forEach(n => console.log('   · ' + n)); }
process.exit(fail ? 1 : 0);
