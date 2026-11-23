/* VT AGENT RATING (Spec Kit 071 §6). Fictional agents only (CB91xx).
 *
 *   - the spec's worked example to the decimal: 20.8 + 19.2 + 13.0 + 6.7 = 59.7, "Needs support",
 *     0.3 from Building, most points available in Target Achievement (14.2);
 *   - lower-is-better (Missed Rate), v = 0 → full marks;
 *   - renormalisation over the measured drivers, effective weights published so the card adds up;
 *   - minimum evidence (5 in-play cases, 5 tracked working days) → shown, not scored;
 *   - no target ("-") → Target Achievement and Fitted vs target unmeasured, never 0;
 *   - VAS bands; budget fallback to the latest earlier cycle (named on the card);
 *   - Scheduling agents and agents with no in-play case are not rated.
 *
 * Run:  node verify-vt-rating.mjs
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
const finish = () => { console.log(`\n${pass} passed, ${fail} failed`); failures.forEach(f => console.log('  · ' + f)); process.exit(fail ? 1 : 0); };

if (!fs.existsSync(ENGINE)) { ok('nicks_code/vt-engine.js exists', false, 'missing'); finish(); }
const E = require(ENGINE);

/* An agent row as the model builds it: counts + the rates the model derives (E.rates). */
function agent({ code = 'CB9101', sub = 'digital', tenure = 'Exp', role = 'Sales Agent', target = 6.5,
                 wd = 11, tracked = wd, sales, current, fitted, missed, scheduled = 0, fitDone }) {
  const mtd = E.rates({ sales, current, rollover: sales - current, fitted, missed, scheduled, fitDone }, wd);
  return { code, sub, tenure, role, target, workingDays: wd, trackedDays: tracked, mtd };
}
const part = (r, k) => r.parts.find(p => p.k === k);

console.log('\n== the spec §6 worked example (fixture vt-rating-example) ==');
{
  const a = agent({ sales: 66, current: 57, fitted: 46, missed: 4, scheduled: 16, fitDone: 44 });
  const r = E.rating(a, { cycleKey: 'cycle-2026-11' });
  eq('Target Achievement 20.8 / 35', part(r, 'targetAch').points, 20.8);
  eq('Fitment Rate 19.2 / 30', part(r, 'fitRate').points, 19.2);
  eq('Missed Rate 13.0 / 20', part(r, 'missRate').points, 13);
  eq('Fitted vs target 6.7 / 15', part(r, 'fitted').points, 6.7);
  eq('score 59.7', r.score, 59.7);
  eq('band Needs support', r.band, 'Needs support');
  eq('next band Building, 0.3 points away', [r.nextBand && r.nextBand.label, r.nextBand && r.nextBand.gap], ['Building', 0.3]);
  eq('weakest driver Target Achievement with 14.2 available', [r.weakest, part(r, 'targetAch').available], ['targetAch', 14.2]);
  eq('Fitted vs target target = 6.5 × 11 × 0.85 = 60.775', part(r, 'fitted').target, 60.775);
  eq('Fitment Rate target 85 % (Digital)', part(r, 'fitRate').target, 0.85);
  eq('Missed Rate target 5 %, lower is better', [part(r, 'missRate').target, part(r, 'missRate').dir], [0.05, 'lower']);
  eq('no driver is at target', r.parts.map(p => p.onTarget), [false, false, false, false]);
  eq('all four measured, weight scored 100', [r.parts.every(p => p.measured), r.weightScored], [true, 100]);
  eq('adj equals score (no penalties)', r.adj, r.score);
  eq('the budget cycle used is named', r.budgetCycle, 'cycle-2026-11');
  eq('window is the business month to date', r.window, { from: '2026-10-26', to: null });
}

console.log('\n== lower-is-better and full marks ==');
{
  const r = E.rating(agent({ sales: 20, current: 20, fitted: 20, missed: 0, fitDone: 20, wd: 2, tracked: 2, target: 6.5 }), { cycleKey: 'cycle-2026-11' });
  eq('Missed Rate 0 → att 1 → 20 points', [part(r, 'missRate').att, part(r, 'missRate').points], [1, 20]);
  eq('Missed Rate 0 is at target', part(r, 'missRate').onTarget, true);
  const r2 = E.rating(agent({ sales: 20, current: 20, fitted: 10, missed: 2, fitDone: 10 }), { cycleKey: 'cycle-2026-11' });
  eq('Missed Rate 10 % vs 5 % → att 0.5 → 0 points', [part(r2, 'missRate').att, part(r2, 'missRate').points], [0.5, 0]);
}

console.log('\n== renormalisation and minimum evidence ==');
{
  const r = E.rating(agent({ sales: 2, current: 2, fitted: 1, missed: 0, fitDone: 1, wd: 2, tracked: 2 }), { cycleKey: 'cycle-2026-11' });
  eq('2 tracked days + 2 cases → every driver shown, none scored', r.parts.map(p => [p.measured, p.shown]), [[false, true], [false, true], [false, true], [false, true]]);
  eq('…so there is no score (never a zero)', [r.score, r.band], [null, null]);
  const r2 = E.rating(agent({ sales: 4, current: 40, fitted: 4, missed: 0, fitDone: 30 }), { cycleKey: 'cycle-2026-11' });
  eq('4 in-play cases → rates shown, not scored', [part(r2, 'fitRate').measured, part(r2, 'missRate').measured], [false, false]);
  eq('…unmeasured reasons are published', r2.unmeasured.sort(), ['fitRate', 'missRate']);
  const ta = part(r2, 'targetAch'), ft = part(r2, 'fitted');
  eq('…and the score renormalises over TA + Fitted (50 points)', r2.weightScored, 50);
  eq('…score = (TA + Fitted) / 50 × 100', r2.score, Math.round(Math.min(100, (ta.points + ft.points) / 50 * 100) * 10) / 10);
  eq('effective weights published: TA 70, Fitted 30', [ta.weff, ft.weff], [70, 30]);
  ok('the effective points add up to the score (±0.1)', Math.abs(ta.pointsEff + ft.pointsEff - r2.score) <= 0.1, `${ta.pointsEff}+${ft.pointsEff} vs ${r2.score}`);
  const r3 = E.rating(agent({ sales: 30, current: 30, fitted: 20, missed: 1, fitDone: 20, wd: 4, tracked: 4 }), { cycleKey: 'cycle-2026-11' });
  eq('4 tracked working days → TA and Fitted vs target unmeasured', [part(r3, 'targetAch').measured, part(r3, 'fitted').measured], [false, false]);
}

console.log('\n== no target ==');
{
  const r = E.rating(agent({ target: null, sales: 20, current: 20, fitted: 15, missed: 1, fitDone: 15 }), { cycleKey: 'cycle-2026-11' });
  eq('no target → TA and Fitted vs target unmeasured, value still shown', [part(r, 'targetAch').measured, part(r, 'targetAch').value != null, part(r, 'fitted').measured], [false, true, false]);
  eq('…target reads null, never 0', [part(r, 'targetAch').target, part(r, 'fitted').target], [null, null]);
  eq('…scored over Fitment + Missed (50)', r.weightScored, 50);
  const r0 = E.rating(agent({ target: 0, sales: 20, current: 20, fitted: 15, missed: 1, fitDone: 15 }), { cycleKey: 'cycle-2026-11' });
  eq('target 0 is "no target" too', part(r0, 'targetAch').measured, false);
}

console.log('\n== tenure-aware budgets (Predictive) ==');
{
  const p = t => part(E.rating(agent({ sub: 'predictive', tenure: t, target: 1, sales: 10, current: 10, fitted: 7, missed: 0, fitDone: 7 }), { cycleKey: 'cycle-2026-11' }), 'fitRate').target;
  eq('Predictive Exp 80 / M2 75 / M1 70 %', [p('Exp'), p('M2'), p('M1')], [0.8, 0.75, 0.7]);
  eq('Referral 85 %', part(E.rating(agent({ sub: 'referral', target: 3, sales: 10, current: 10, fitted: 7, missed: 0, fitDone: 7 }), { cycleKey: 'cycle-2026-11' }), 'fitRate').target, 0.85);
}

console.log('\n== bands ==');
eq('90 → Elite', E.bandOf(90).label, 'Elite');
eq('89.9 → Strong', E.bandOf(89.9).label, 'Strong');
eq('70 → On track', E.bandOf(70).label, 'On track');
eq('60 → Building', E.bandOf(60).label, 'Building');
eq('59.9 → Needs support', E.bandOf(59.9).label, 'Needs support');
eq('Elite has no next band', E.rating(agent({ sales: 20, current: 72, fitted: 20, missed: 0, fitDone: 61 }), { cycleKey: 'cycle-2026-11' }).nextBand, null);

console.log('\n== budget fallback ==');
{
  const r = E.rating(agent({ sales: 20, current: 20, fitted: 15, missed: 1, fitDone: 15 }), { cycleKey: 'cycle-2027-02' });
  eq('a cycle with no budget block uses the latest earlier cycle and names it', r.budgetCycle, 'cycle-2026-11');
  const r0 = E.rating(agent({ sales: 20, current: 20, fitted: 15, missed: 1, fitDone: 15 }), { cycleKey: 'cycle-2026-10' });
  eq('a cycle before any budget → no budget, rates unmeasured (never an invented target)', [r0.budgetCycle, part(r0, 'fitRate').measured, part(r0, 'missRate').measured], [null, false, false]);
}

console.log('\n== who is rated ==');
{
  const s = E.rating(agent({ sub: 'scheduling', role: 'Scheduling Agent', target: null, sales: 0, current: 0, fitted: 0, missed: 0, fitDone: 0 }), { cycleKey: 'cycle-2026-11' });
  eq('a Scheduling agent is not rated (why scheduling)', [s.rated, s.why], [false, 'scheduling']);
  const n = E.rating(agent({ sales: 0, current: 0, fitted: 0, missed: 0, fitDone: 0 }), { cycleKey: 'cycle-2026-11' });
  eq('an agent with no in-play case is not rated (why nodata), never a zero score', [n.rated, n.why, n.score], [false, 'nodata', null]);
  const z = E.rating(agent({ sales: 6, current: 0, fitted: 6, missed: 0, fitDone: 6 }), { cycleKey: 'cycle-2026-11' });
  eq('an agent with rollover cases but no Current sale IS rated, TA scores a real 0', [z.rated, part(z, 'targetAch').points], [true, 0]);
}

finish();
