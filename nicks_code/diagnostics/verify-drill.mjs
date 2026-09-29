/* verify-drill.mjs — the KPI drill-down verdicts (sprint 2026-09-29, item 3; decision D3).
 *
 * Nick: an agent clicks a KPI needing attention and is told what is below target, their result, the
 * target, what is driving it, the action, and whether to ask their team leader. The Worker decides all
 * of it (worker/src/drill.mjs → me.drill); the page paints. This suite proves:
 *   1 the rule book (specs/kpi_drilldown_rules.json) and DRILL_RULES agree — change both together
 *   2 every help topic is a real Help Center category
 *   3–6 each KPI's status, action and TL-help verdict (sessions / pace / QA focus)
 *   7 leave days and still-landing days are never counted as sessions
 *   8 no data → no verdict, never a zero
 *   9 the Worker attaches the verdicts to the agent's own payload and the leader's drilldown
 *
 * Run: node verify-drill.mjs   (no network, no credentials)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const { DRILL_RULES, drillFor } = await import(pathToFileURL(path.join(ROOT, 'worker', 'src', 'drill.mjs')).href);
const { HELP_CATEGORIES } = await import(pathToFileURL(path.join(ROOT, 'worker', 'src', 'help.mjs')).href);

let pass = 0, fail = 0;
const ok = (name, cond, note) => { if (cond) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (note ? ' — ' + note : '')); } };
const strip = (o) => JSON.parse(JSON.stringify(o, (k, v) => (k === '_note' ? undefined : v)));

console.log('\n1 · the rule book and the Worker agree');
{ const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'specs', 'kpi_drilldown_rules.json'), 'utf8'));
  ok('bands', JSON.stringify(strip(spec.bands)) === JSON.stringify(DRILL_RULES.bands), JSON.stringify(strip(spec.bands)));
  ok('TL-help rule', JSON.stringify(strip(spec.tl_help)) === JSON.stringify(DRILL_RULES.tlHelp));
  ok('topics', JSON.stringify(spec.topics) === JSON.stringify(DRILL_RULES.topics));
  ok('actions', JSON.stringify(spec.actions) === JSON.stringify(DRILL_RULES.actions));
  ok('the change is dated', Array.isArray(spec._changes) && spec._changes.every((c) => /^\d{4}-\d{2}-\d{2}$/.test(c.date))); }

console.log('\n2 · every help topic is a Help Center category');
ok('topics ∈ HELP_CATEGORIES', Object.values(DRILL_RULES.topics).every((t) => HELP_CATEGORIES.includes(t)), JSON.stringify(DRILL_RULES.topics));

const ctx = { floorEx: 86.08, workingDays: 21, dates: ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-07'], period: { from: '2026-09-01', to: '2026-09-30' } };
const day = (d, s, t, x, act, extra) => ({ d, s, t, x, act, ...(extra || {}) });
const good5 = [day('2026-09-01', 8, 8, 800, 1), day('2026-09-02', 9, 8, 900, 1), day('2026-09-03', 8, 8, 800, 1), day('2026-09-04', 10, 8, 1000, 1), day('2026-09-07', 8, 8, 800, 1)];

console.log('\n3 · target achieved');
{ let v = drillFor({ pctT: 1.05, target: 168, sales: 176, spd: 8, days: good5 }, ctx).ta;
  ok('at target → pass, no action, no TL help', v.status === 'pass' && !v.action && !v.tlHelp, JSON.stringify(v));
  v = drillFor({ pctT: 0.8, target: 168, sales: 40, spd: 8, days: good5 }, ctx).ta;
  ok('80% → watch, with the action sentence', v.status === 'watch' && v.action === DRILL_RULES.actions.ta, JSON.stringify(v));
  const weak = [day('2026-09-01', 5, 8, 500, 1), day('2026-09-02', 9, 8, 900, 1), day('2026-09-03', 4, 8, 400, 1), day('2026-09-04', 6, 8, 600, 1), day('2026-09-07', 9, 8, 900, 1)];
  v = drillFor({ pctT: 0.8, target: 168, sales: 40, spd: 8, days: weak }, ctx).ta;
  ok('below in 3 of the last 5 sessions → TL help (sessions)', v.tlHelp && v.why.rule === 'sessions' && v.why.below === 3 && v.why.of === 5, JSON.stringify(v));
  v = drillFor({ pctT: 0.6, target: 400, sales: 40, spd: 4, days: good5 }, ctx).ta;
  ok('a gap that needs > 1.5× the current pace → TL help (pace)', v.status === 'focus' && v.tlHelp && v.why.rule === 'pace', JSON.stringify(v));
  v = drillFor({ pctT: 0.8, target: 168, sales: 130, spd: 8, days: good5 }, ctx).ta;
  ok('below target but on pace and sessions fine → no TL help', v.status === 'watch' && !v.tlHelp, JSON.stringify(v));
  ok('the help topic travels', v.topic === 'Review my call'); }

console.log('\n4 · average sale (ex VAT) against the floor');
{ let v = drillFor({ aveG: 90, days: good5 }, ctx).aveG;
  ok('above the floor → pass', v.status === 'pass' && v.target === 86.08, JSON.stringify(v));
  v = drillFor({ aveG: 80, days: good5 }, ctx).aveG;
  ok('93% of the floor → watch, no TL help when sessions are above it', v.status === 'watch' && !v.tlHelp, JSON.stringify(v));
  const cheap = [day('2026-09-01', 8, 8, 600, 1), day('2026-09-02', 8, 8, 600, 1), day('2026-09-03', 8, 8, 900, 1), day('2026-09-04', 8, 8, 600, 1), day('2026-09-07', 8, 8, 900, 1)];
  v = drillFor({ aveG: 70, days: cheap }, ctx).aveG;
  ok('below the floor in 3 of 5 sessions → focus + TL help', v.status === 'focus' && v.tlHelp && v.why.below === 3, JSON.stringify(v)); }

console.log('\n5 · QA');
{ ok('95% → pass', drillFor({ qa: 0.95 }, ctx).qa.status === 'pass');
  const w = drillFor({ qa: 0.85 }, ctx).qa;
  ok('85% → watch, no TL help', w.status === 'watch' && !w.tlHelp, JSON.stringify(w));
  const f = drillFor({ qa: 0.7 }, ctx).qa;
  ok('70% → focus, TL help (qa)', f.status === 'focus' && f.tlHelp && f.why.rule === 'qa' && f.topic === 'Explain my quality result', JSON.stringify(f)); }

console.log('\n6 · attendance');
{ const missed = [day('2026-09-01', 0, 8, 0, 0), day('2026-09-02', 9, 8, 900, 1), day('2026-09-03', 0, 8, 0, 0), day('2026-09-04', 0, 8, 0, 0), day('2026-09-07', 8, 8, 800, 1)];
  const v = drillFor({ att: 0.6, days: missed }, ctx).att;
  ok('absent 3 of the last 5 → focus + TL help', v.status === 'focus' && v.tlHelp && v.why.below === 3, JSON.stringify(v));
  ok('96% → pass', drillFor({ att: 0.96, days: good5 }, ctx).att.status === 'pass'); }

console.log('\n7 · leave and still-landing days are not sessions');
{ const withLeave = [day('2026-09-01', 5, 8, 500, 1), day('2026-09-02', 0, 0, 0, 0, { lv: 1 }), day('2026-09-03', 4, 8, 400, 1), day('2026-09-04', 0, 0, 0, 0, { lv: 1 }), day('2026-09-07', 9, 8, 900, 1), day('2026-09-08', 0, 8, 0, 1, { p: true })];
  const v = drillFor({ pctT: 0.8, target: 168, sales: 130, spd: 8, att: 1, days: withLeave }, ctx);
  ok('leave and provisional days are skipped (3 sessions judged, 2 below)', v.ta.of === 3 && v.ta.below === 2, JSON.stringify(v.ta));
  ok('a leave day is not an absence', v.att.below === 0, JSON.stringify(v.att)); }

console.log('\n8 · no data → no verdict');
{ const v = drillFor({}, ctx);
  ok('every KPI reads none, with no TL help', ['ta', 'aveG', 'qa', 'att'].every((k) => v[k].status === 'none' && !v[k].tlHelp && !v[k].action), JSON.stringify(v)); }

console.log('\n9 · the Worker attaches the verdicts');
{ const src = fs.readFileSync(path.join(ROOT, 'worker', 'src', 'portal.mjs'), 'utf8');
  ok('the agent\'s own payload carries me.drill', /me\.drill\s*=\s*drillFor\(/.test(src));
  ok('the leader\'s drilldown row carries row.drill', /row\.drill\s*=\s*drillFor\(/.test(src)); }

console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
process.exitCode = fail ? 1 : 0;
