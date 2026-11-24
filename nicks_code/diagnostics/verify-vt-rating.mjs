/* VT AGENT RATING (Spec Kit 071 §6, rule book vt-1.2). Fictional agents only (CB91xx).
 *
 *   - TWO scored drivers: Target Achievement 50 + Fitment Rate 50 (weights total 100). Missed Rate and Fitted vs
 *     target were removed (vt-1.2, 2026-11-24): they double-counted Fitment Rate, so one missed fitment cost about 12 points;
 *   - the spec's worked example to the decimal: 29.7 + 32.0 = 61.7, "Building", 8.3 from On track, most points
 *     available in Target Achievement (20.3);
 *   - every outcome counts once: a missed or cancelled sale moves the score ONLY through Fitment Rate;
 *   - missed / cancelled / fitments done are shown unscored (rating.info), never in parts[];
 *   - the lower-is-better code path is kept (no live driver uses it) and tested through ctx.drivers;
 *   - renormalisation: one driver unmeasured -> the other alone is out of 100;
 *   - minimum evidence (5 in-play cases, 5 tracked working days) -> shown, not scored;
 *   - no target ("-") -> Target Achievement unmeasured, never 0;
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
                 wd = 11, tracked = wd, sales, current, fitted, missed, scheduled = 0, cancelled = 0, fitDone }) {
  const mtd = E.rates({ sales, current, rollover: sales - current, fitted, missed, scheduled, cancelled, fitDone }, wd);
  return { code, sub, tenure, role, target, workingDays: wd, trackedDays: tracked, mtd };
}
const part = (r, k) => r.parts.find(p => p.k === k);

const C11 = { cycleKey: 'cycle-2026-11' };
const keys = (r) => r.parts.map(p => p.k);

console.log('\n== the rule book: two scored drivers, 50 / 50 ==');
eq('drivers are Target Achievement 50 + Fitment Rate 50, both higher-is-better', E.VT_RULES.rating.drivers.map(d => [d.k, d.w, d.dir]), [['targetAch', 50, 'higher'], ['fitRate', 50, 'higher']]);
eq('weights total 100', E.VT_RULES.rating.drivers.reduce((s, d) => s + d.w, 0), 100);
ok('Missed Rate, Fitted vs target and Cancellation are NOT drivers', !E.VT_RULES.rating.drivers.some(d => /miss|cancel/i.test(d.k + d.label) || d.k === 'fitted' || /vs target/i.test(d.label)));
ok('no live driver is lower-is-better', E.VT_RULES.rating.drivers.every(d => d.dir === 'higher'));

console.log('\n== the spec §6 worked example (fixture vt-rating-example) ==');
{
  const a = agent({ sales: 66, current: 57, fitted: 46, missed: 4, scheduled: 16, fitDone: 44 });
  const r = E.rating(a, C11);
  eq('exactly two parts: targetAch, fitRate', keys(r), ['targetAch', 'fitRate']);
  eq('Target Achievement att 0.797 → 29.7 / 50', [Math.round(part(r, 'targetAch').att * 1000) / 1000, part(r, 'targetAch').points], [0.797, 29.7]);
  eq('Fitment Rate att 0.820 → 32.0 / 50', [Math.round(part(r, 'fitRate').att * 1000) / 1000, part(r, 'fitRate').points], [0.82, 32]);
  eq('score 61.7', r.score, 61.7);
  eq('band Building', r.band, 'Building');
  eq('next band On track, 8.3 points away', [r.nextBand && r.nextBand.label, r.nextBand && r.nextBand.gap], ['On track', 8.3]);
  eq('weakest driver Target Achievement with 20.3 available', [r.weakest, part(r, 'targetAch').available], ['targetAch', 20.3]);
  eq('Fitment Rate target 85 % (Digital)', part(r, 'fitRate').target, 0.85);
  eq('no driver is at target; 0 of 2 measured', [r.parts.map(p => p.onTarget), r.onTarget, r.measuredCount], [[false, false], 0, 2]);
  eq('both measured, weight scored 100, effective weights 50 / 50', [r.parts.every(p => p.measured), r.weightScored, r.parts.map(p => p.weff)], [true, 100, [50, 50]]);
  eq('adj equals score (no penalties)', r.adj, r.score);
  eq('the budget cycle used is named', r.budgetCycle, 'cycle-2026-11');
  eq('window is the business month to date', r.window, { from: '2026-10-26', to: null });
  eq('shown unscored (rating.info): missed 4 (6.06 %) vs 5 %, cancelled 0 vs 5 %, fitments done 44',
    [r.info.missed, Math.round(r.info.missRate * 10000) / 10000, r.info.missBudget, r.info.cancelled, r.info.canRate, r.info.canBudget, r.info.fitDone], [4, 0.0606, 0.05, 0, 0, 0.05, 44]);
}

console.log('\n== every outcome counts once: a missed sale moves the score ONLY through Fitment Rate ==');
{
  /* the executive's case: 60 sales. Moving sales between Scheduled and Missed (fitted unchanged) must not move the score
     at all; moving one sale from Fitted to Missed moves it by exactly the Fitment Rate points, and Target Achievement holds. */
  const base = { sales: 60, current: 60, wd: 11, target: 6.5 };
  const s3 = E.rating(agent({ ...base, fitted: 45, missed: 3, scheduled: 12, fitDone: 45 }), C11);
  const s6 = E.rating(agent({ ...base, fitted: 45, missed: 6, scheduled: 9, fitDone: 45 }), C11);
  eq('3 missed vs 6 missed, same fitted → the identical score (missed is not scored)', [s3.score, s3.parts.map(p => p.points)], [s6.score, s6.parts.map(p => p.points)]);
  const f45 = s3, f44 = E.rating(agent({ ...base, fitted: 44, missed: 4, scheduled: 12, fitDone: 44 }), C11);
  eq('one fitted sale turned missed → Target Achievement unchanged', part(f44, 'targetAch').points, part(f45, 'targetAch').points);
  ok('…and the score drops by exactly the Fitment Rate points (one driver, counted once)',
    Math.abs((f45.score - f44.score) - (part(f45, 'fitRate').pointsEff - part(f44, 'fitRate').pointsEff)) < 0.051, `${f45.score} → ${f44.score}`);
  ok('…which is under 2 points for 1 sale in 60 (it was ≈ 12 under vt-1.1)', f45.score - f44.score > 0 && f45.score - f44.score < 2, String(f45.score - f44.score));
  const c0 = E.rating(agent({ ...base, fitted: 45, missed: 3, scheduled: 12, fitDone: 45 }), C11);
  const c1 = E.rating(agent({ ...base, fitted: 45, missed: 2, scheduled: 12, cancelled: 1, fitDone: 45 }), C11);
  eq('a Missed sale that is cancelled (still a sale, not fitted) → the identical score', c1.score, c0.score);
  eq('…its info line counts it: cancelled 1 of 60', [c1.info.cancelled, Math.round(c1.info.canRate * 10000) / 10000, c1.info.missed], [1, 0.0167, 2]);
  for (const r of [s3, s6, f44, c1]) ok('parts[] never carries missRate, fitted or a cancellation (' + r.score + ')', !r.parts.some(p => /miss|cancel|^can|^fitted$/i.test(p.k)), keys(r).join(','));
}

console.log('\n== lower-is-better code path (kept for future use; no live driver uses it) ==');
{
  const LOWER = { cycleKey: 'cycle-2026-11', drivers: [{ k: 'missRate', label: 'Missed Rate', w: 100, dir: 'lower', note: '' }] };
  const r = E.rating(agent({ sales: 20, current: 20, fitted: 20, missed: 0, fitDone: 20 }), LOWER);
  eq('v = 0 → att 1 → full points, at target', [part(r, 'missRate').att, part(r, 'missRate').points, part(r, 'missRate').onTarget], [1, 100, true]);
  const r2 = E.rating(agent({ sales: 20, current: 20, fitted: 10, missed: 2, fitDone: 10 }), LOWER);
  eq('10 % vs a 5 % ceiling → att 0.5 → 0 points, not at target', [part(r2, 'missRate').att, part(r2, 'missRate').points, part(r2, 'missRate').onTarget], [0.5, 0, false]);
  eq('the live rating is untouched by the override', keys(E.rating(agent({ sales: 20, current: 20, fitted: 10, missed: 2, fitDone: 10 }), C11)), ['targetAch', 'fitRate']);
}

console.log('\n== renormalisation and minimum evidence ==');
{
  const r = E.rating(agent({ sales: 2, current: 2, fitted: 1, missed: 0, fitDone: 1, wd: 2, tracked: 2 }), C11);
  eq('2 tracked days + 2 cases → both drivers shown, none scored', r.parts.map(p => [p.measured, p.shown]), [[false, true], [false, true]]);
  eq('…so there is no score (never a zero)', [r.score, r.band], [null, null]);
  const r2 = E.rating(agent({ sales: 4, current: 40, fitted: 4, missed: 0, fitDone: 30 }), C11);
  eq('4 in-play cases → Fitment Rate shown, not scored', part(r2, 'fitRate').measured, false);
  eq('…unmeasured reasons are published', r2.unmeasured, ['fitRate']);
  const ta = part(r2, 'targetAch');
  eq('…Target Achievement alone is out of 100: weight scored 50, effective weight 100', [r2.weightScored, ta.weff], [50, 100]);
  eq('…score = TA points / 50 × 100', r2.score, Math.round(Math.min(100, ta.points / 50 * 100) * 10) / 10);
  ok('the effective points equal the score (±0.1)', Math.abs(ta.pointsEff - r2.score) <= 0.1, `${ta.pointsEff} vs ${r2.score}`);
  eq('…1 of 1 measured driver', r2.measuredCount, 1);
  const r3 = E.rating(agent({ sales: 30, current: 30, fitted: 20, missed: 1, fitDone: 20, wd: 4, tracked: 4 }), C11);
  const fr = part(r3, 'fitRate');
  eq('4 tracked working days → TA unmeasured, Fitment Rate alone out of 100', [part(r3, 'targetAch').measured, fr.measured, fr.weff, r3.score], [false, true, 100, Math.round(fr.points / 50 * 1000) / 10]);
}

console.log('\n== no target ==');
{
  const r = E.rating(agent({ target: null, sales: 20, current: 20, fitted: 15, missed: 1, fitDone: 15 }), C11);
  eq('no target → TA unmeasured, value still shown', [part(r, 'targetAch').measured, part(r, 'targetAch').value != null], [false, true]);
  eq('…target reads null, never 0', part(r, 'targetAch').target, null);
  eq('…scored over Fitment Rate alone (50 → out of 100)', [r.weightScored, part(r, 'fitRate').weff], [50, 100]);
  const r0 = E.rating(agent({ target: 0, sales: 20, current: 20, fitted: 15, missed: 1, fitDone: 15 }), C11);
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
eq('Elite has no next band', E.rating(agent({ sales: 20, current: 72, fitted: 20, missed: 0, fitDone: 61 }), C11).nextBand, null);

console.log('\n== budget fallback ==');
{
  const r = E.rating(agent({ sales: 20, current: 20, fitted: 15, missed: 1, fitDone: 15 }), { cycleKey: 'cycle-2027-02' });
  eq('a cycle with no budget block uses the latest earlier cycle and names it', r.budgetCycle, 'cycle-2026-11');
  const r0 = E.rating(agent({ sales: 20, current: 20, fitted: 15, missed: 1, fitDone: 15 }), { cycleKey: 'cycle-2026-10' });
  eq('a cycle before any budget → no budget, Fitment Rate unmeasured (never an invented target)', [r0.budgetCycle, part(r0, 'fitRate').measured], [null, false]);
  eq('…and the unscored budgets read null, never invented', [r0.info.missBudget, r0.info.canBudget], [null, null]);
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
