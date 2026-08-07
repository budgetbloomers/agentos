/* August-tracker reconciliation rules — regression tests.
 *
 * Each case is a defect proven by diffing the manual workbook
 * "VAS - August 2026 MTD Tracker 1 - 4 Aug" against the software export
 * "VAS - August 2026 MTD Tracker 01.08 - 05.08" on their two shared days
 * (Mon 03.08, Tue 04.08). Synthetic inputs, so it runs without the real exports.
 *
 *   node nicks_code/diagnostics/august-rules.mjs
 */
import { chromium } from 'playwright';

// APP_HTML lets the suite run against an older build to confirm it really fails there.
const APP = process.env.APP_HTML
  ? 'file://' + process.env.APP_HTML
  : 'file://' + new URL('../index.html', import.meta.url).pathname;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  .catch(() => chromium.launch());
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));
await page.goto(APP);

// --- synthetic sources -------------------------------------------------------
// 1 Aug 2026 is a Saturday, 2 Aug a Sunday, 3/4 Aug Mon/Tue.
const roster = [
  'Employee Code,Team Leader,Agent Name,Sales Force,Call x,Campaign,Tenure,Target,Start Date',
  'CB900,Test TL,Alpha Agent,Alpha Agent,Alpha Agent CB-900,Courtesy,Exp,5,2026-01-01',
  'CB901,Test TL,Bravo Agent,Bravo Agent,Bravo Agent CB-901,Cuddle,Exp,8,2026-01-01',
  'CB902,TBC,Charlie Agent,Charlie Agent,Charlie Agent CB-902,Nesting,M1,4,2026-01-01',
].join('\n');

// Titanium Single bundle: 30,43 + 33,91 + 21,74 = 86,08 ex-VAT = R99 incl.
const bi = [
  'Account Number,Contract Create Date,Owner,Charge Amount',
  'A1,2026-08-03,Alpha Agent,30.43',
  'A1,2026-08-03,Alpha Agent,33.91',
  'A1,2026-08-03,Alpha Agent,21.74',
  'A2,2026-08-03,Charlie Agent,86.08',
].join('\n');

// Saturday rows exist in the export but nobody worked: zero duration, no sale.
const calls = [
  'Date & Time,Agent,Lead Disposition,Duration',
  '2026-08-01 09:00,Alpha Agent CB-900,No Answer,00:00:00',
  '2026-08-01 09:05,Bravo Agent CB-901,No Answer,00:00:00',
  '2026-08-03 09:00,Alpha Agent CB-900,Sale Made,01:00:00',
  '2026-08-03 09:30,Charlie Agent CB-902,Sale Made,00:30:00',
].join('\n');

// Bravo is marked Present on the Monday but logged no talk and made no sale.
const attendance = [
  'Date,Employee Code,Status',
  '2026-08-01,CB900,Present',
  '2026-08-01,CB901,Present',
  '2026-08-03,CB900,Present',
  '2026-08-03,CB901,Present',
  '2026-08-03,CB902,Present',
].join('\n');

const evals = [
  'Date of Call,Sales Agent CB,Score %,QA Agent',
  '2026-08-03,CB900,80,Assessor',
  '2026-08-03,CB900,90,Assessor',
].join('\n');

for (const [name, text] of [
  ['Matrix_Agent_List.csv', roster],
  ['bi_active_cases.csv', bi],
  ['call_records.csv', calls],
  ['attendance.csv', attendance],
  ['evaluationsfullexport.csv', evals],
]) {
  const ok = await page.evaluate(([n, t]) => window.__mtd.ingest(n, t), [name, text]);
  if (!ok) throw new Error(`ingest returned falsy for ${name} — header contract changed?`);
}

await page.evaluate(() => window.__mtd.setRange('2026-08-01', '2026-08-05'));

const M = await page.evaluate(() => {
  const m = window.__mtd.model();
  const fact = (code, date) => m.facts.find(f => f.code === code && f.date === date) || null;
  return {
    dates: m.dates,
    dropped: m.droppedDates,
    alphaMon: fact('CB900', '2026-08-03'),
    bravoMon: fact('CB901', '2026-08-03'),
    satFacts: m.facts.filter(f => f.date === '2026-08-01').length,
    courtesyCodes: Object.keys(m.mtdCC.Courtesy),
    nestingCodes: Object.keys(m.mtdCC.Nesting || {}),
    grandSales: m.grand.sales,
    grandGwp: m.grand.gwp,
    tlQa: (m.tlAgg['Courtesy|Test TL'] || {}).qa,
    tlDays: (m.tlAgg['Courtesy|Test TL'] || {}).days,
  };
});

// --- assertions --------------------------------------------------------------
let pass = 0; const fails = [];
const check = (name, cond, detail) => cond ? pass++ : fails.push(`${name} — ${detail}`);

check('Saturday is not a dialing day',
  !M.dates.includes('2026-08-01'),
  `dates=${JSON.stringify(M.dates)}`);

check('Saturday books no shifts at all',
  M.satFacts === 0,
  `${M.satFacts} fact rows survived on 2026-08-01`);

check('dropped non-dialing days are reported',
  Array.isArray(M.dropped) && M.dropped.includes('2026-08-01'),
  `droppedDates=${JSON.stringify(M.dropped)}`);

check('GWP grosses up to a whole rand (R99, not R98.99)',
  M.alphaMon && M.alphaMon.gwp === 99,
  `got ${M.alphaMon && M.alphaMon.gwp}`);

check('one account with three charge lines is one sale',
  M.alphaMon && M.alphaMon.sales === 1,
  `got ${M.alphaMon && M.alphaMon.sales}`);

check('"Present" with no talk and no sale books no actual shift',
  M.bravoMon && M.bravoMon.act === 0,
  `act=${M.bravoMon && M.bravoMon.act} (register said Present)`);

check('an agent who worked still books the shift',
  M.alphaMon && M.alphaMon.act === 1,
  `act=${M.alphaMon && M.alphaMon.act}`);

check('Nesting is its own campaign, not folded into Courtesy',
  !M.courtesyCodes.includes('CB902') && M.nestingCodes.includes('CB902'),
  `courtesy=${JSON.stringify(M.courtesyCodes)} nesting=${JSON.stringify(M.nestingCodes)}`);

check('Nesting stays out of the VAS grand total',
  M.grandSales === 1 && M.grandGwp === 99,
  `grand sales=${M.grandSales} gwp=${M.grandGwp} (should exclude CB902)`);

check('TL MTD carries a QA figure',
  M.tlQa && Math.abs(M.tlQa.avg - 0.85) < 1e-9,
  `tlAgg.qa=${JSON.stringify(M.tlQa)}`);

check('Dialing Days counts only live days',
  M.tlDays === 1,
  `tlAgg.days=${M.tlDays} (only 2026-08-03 has activity)`);

check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));

await browser.close();

console.log(`\n  august-rules: ${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log('   FAIL  ' + f);
process.exit(fails.length ? 1 : 0);
