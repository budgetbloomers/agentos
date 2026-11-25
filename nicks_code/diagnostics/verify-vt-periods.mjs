/* VT PERIODS (Spec Kit 071 FR-020..FR-023): the business month (26th → 25th, keyed by the month it
 * ends in), Monday–Saturday weeks clipped to the business month with Sunday joining the week of the
 * Monday before, working days (Mon–Fri, no SA public holiday, no one-off holiday), and the Hrs Ahead
 * buckets (appointment day − (latest extract + 1)). Synthetic dates only.
 *
 * Also proves the engine's copy of saHolidaysFor is BYTE-IDENTICAL to PULSE's @mirror:sa-holidays
 * block (CLAUDE.md 12: the calendar is computed, never a second table).
 *
 * Run:  node verify-vt-periods.mjs
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
const P = E.periods;

console.log('\n== business month (cycle) ==');
eq('10 Nov 2026 → cycle-2026-11, 26 Oct – 25 Nov', P.cycleOf('2026-11-10'), { key: 'cycle-2026-11', from: '2026-10-26', to: '2026-11-25' });
eq('26 Oct 2026 (first day) → cycle-2026-11', P.cycleOf('2026-10-26').key, 'cycle-2026-11');
eq('25 Nov 2026 (last day) → cycle-2026-11', P.cycleOf('2026-11-25').key, 'cycle-2026-11');
eq('26 Nov 2026 → cycle-2026-12', P.cycleOf('2026-11-26'), { key: 'cycle-2026-12', from: '2026-11-26', to: '2026-12-25' });
eq('26 Dec 2026 rolls the year → cycle-2027-01', P.cycleOf('2026-12-26'), { key: 'cycle-2027-01', from: '2026-12-26', to: '2027-01-25' });
eq('10 Jan 2027 → cycle-2027-01', P.cycleOf('2027-01-10').key, 'cycle-2027-01');
eq('leap February: 1 Feb 2028 → cycle-2028-02 26 Jan – 25 Feb', P.cycleOf('2028-02-01'), { key: 'cycle-2028-02', from: '2028-01-26', to: '2028-02-25' });
eq('cycleByKey inverts cycleOf', P.cycleByKey('cycle-2027-01'), { key: 'cycle-2027-01', from: '2026-12-26', to: '2027-01-25' });

console.log('\n== weeks: Mon–Sat, clipped, Sunday joins the Monday before ==');
const wk = P.weeksOf(P.cycleOf('2026-11-10'));
eq('cycle-2026-11 has five weeks', wk.map(w => [w.from, w.to]),
  [['2026-10-26', '2026-11-01'], ['2026-11-02', '2026-11-08'], ['2026-11-09', '2026-11-15'], ['2026-11-16', '2026-11-22'], ['2026-11-23', '2026-11-25']]);
eq('week labels read Mon–Sat (clipped)', wk.map(w => w.label), ['26 Oct – 31 Oct', '2 Nov – 7 Nov', '9 Nov – 14 Nov', '16 Nov – 21 Nov', '23 Nov – 25 Nov']);
eq('Sunday 1 Nov joins the week of Monday 26 Oct', P.weekKeyOf('2026-11-01', P.cycleOf('2026-11-01')), '2026-10-26');
eq('Saturday 7 Nov is in the week of Monday 2 Nov', P.weekKeyOf('2026-11-07', P.cycleOf('2026-11-07')), '2026-11-02');
{ // a cycle starting mid-week (26 Feb 2027 is a Friday): the first week is clipped to start on the 26th
  const c = P.cycleOf('2027-03-01'); const w = P.weeksOf(c);
  eq('cycle-2027-03 starts Fri 26 Feb; first week clipped to 26 Feb – 28 Feb', [w[0].from, w[0].to, w[0].k], ['2027-02-26', '2027-02-28', '2027-02-26']);
  eq('…and a Sunday 26th joins a clipped week of its own Monday-before (key = the 26th)', P.weekKeyOf('2027-02-28', c), '2027-02-26');
}

console.log('\n== working days (Mon–Fri, not an SA public holiday, not a one-off holiday) ==');
const wd = (a, b) => P.workingDaysBetween(a, b);
eq('cycle-2026-09 (26 Aug – 25 Sep, Heritage Day) = 22 (Sales Review dialing days)', wd('2026-08-26', '2026-09-25'), 22);
eq('cycle-2026-10 (26 Sep – 25 Oct) = 20 (Sales Review dialing days)', wd('2026-09-26', '2026-10-25'), 20);
eq('cycle-2026-11 (26 Oct – 25 Nov, 4 Nov election holiday) = 22 (Sales Review budget)', wd('2026-10-26', '2026-11-25'), 22);
eq('26 Oct – 10 Nov 2026 = 11 working days', wd('2026-10-26', '2026-11-10'), 11);
eq('26 Oct – 9 Nov 2026 = 10 working days (4 Nov is a holiday)', wd('2026-10-26', '2026-11-09'), 10);
ok('a Saturday is never a working day', !P.isWorkingDay('2026-11-07'));
ok('a Sunday is never a working day', !P.isWorkingDay('2026-11-08'));
ok('Christmas 2026 is not a working day', !P.isWorkingDay('2026-12-25'));
ok('Day of Goodwill observed rule: 26 Dec 2027 is a Sunday → Mon 27 Dec 2027 is a holiday', !P.isWorkingDay('2027-12-27'));
ok('Good Friday 2027 (26 Mar) is not a working day', !P.isWorkingDay('2027-03-26'));
ok('an ordinary Tuesday is a working day', P.isWorkingDay('2026-11-10'));
{ const custom = d => d === '2026-11-10';
  ok('an injected isDataOnlyDay is honoured (PULSE hands its own dataOnlyDay in)', !P.isWorkingDay('2026-11-10', custom) && P.isWorkingDay('2026-11-04', custom)); }

console.log('\n== Hrs Ahead buckets (as-at = latest extract + 1 day) ==');
eq('as-at of extract 10 Nov = 11 Nov', P.hrsAsAt('2026-11-10'), '2026-11-11');
const CYC = P.cycleByKey('cycle-2026-11');
const B = a => P.hrsBucket(a, '2026-11-11', CYC.to);
eq('appointment on the as-at day → 24', B('2026-11-11'), 'h24');
eq('+1 day → 48', B('2026-11-12'), 'h48');
eq('+2 days → 72', B('2026-11-13'), 'h72');
eq('+3 days, on or before the cycle end → 72+ in cycle (072 D6)', B('2026-11-14'), 'h72pIn');
eq('the cycle end itself is still in cycle', B(CYC.to), 'h72pIn');
eq('the day after the cycle end → 72+ out cycle', B(P.addDays(CYC.to, 1)), 'h72pOut');
eq('+23 days → 72+ out cycle', B('2026-12-04'), 'h72pOut');
eq('−1 day → Past due', B('2026-11-10'), 'past');
eq('no appointment day → null', B(null), null);
eq('the rule book carries five buckets ahead plus Past due, not four (FR-029)',
  E.VT_RULES.periods.leadTimeBuckets.map(b => b.k), ['h24', 'h48', 'h72', 'h72pIn', 'h72pOut', 'past']);
eq('the in/out cutoff is the cycle end from periods.cycleByKey, not TODAY() (FR-032)',
  [E.VT_RULES.periods.leadTimeBuckets[3].cutoff, E.VT_RULES.periods.leadTimeBuckets[3].cutoffOp, E.VT_RULES.periods.leadTimeBuckets[4].cutoffOp], ['cycle.to', '<=', '>']);
eq('a different cycle end moves the same booking between the two 72+ buckets, and nothing else',
  ['2026-11-14', '2026-12-04'].map(a => P.hrsBucket(a, '2026-11-11', '2026-12-25')), ['h72pIn', 'h72pIn']);
eq('the as-at is frozen at the extract + the rule book\'s offset, so the bucket cannot drift (D5)',
  [E.VT_RULES.periods.hrsAheadAsAtOffsetDays, P.hrsAsAt('2026-11-23')], [1, '2026-11-24']);
{ const src = fs.readFileSync(ENGINE, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  eq('no clock anywhere in the engine: every "today" is passed in (D5)', src.match(/Date\.now|new\s+Date\s*\(\s*\)|(?:^|[^A-Za-z0-9_$.])Date\s*\(\s*\)/g), null); }

console.log('\n== the holiday calendar is PULSE\'s, byte for byte ==');
const block = s => { const m = s.match(/\/\* @mirror:sa-holidays start[\s\S]*?\/\* @mirror:sa-holidays end \*\//); return m && m[0]; };
const pulse = block(fs.readFileSync(path.join(REPO, 'nicks_code', 'index.html'), 'latin1'));
const mine = block(fs.readFileSync(ENGINE, 'latin1'));
ok('PULSE carries the @mirror:sa-holidays block', !!pulse);
ok('vt-engine.js carries the @mirror:sa-holidays block', !!mine);
ok('the two blocks are byte-identical', !!pulse && pulse === mine, pulse && mine ? `lengths ${pulse.length} vs ${mine.length}` : 'missing');
eq('saHolidaysFor(2026) holds Heritage Day and the observed Freedom Day', ['2026-09-24', '2026-04-27'].map(d => E.saHolidaysFor(2026).includes(d)), [true, true]);

finish();
