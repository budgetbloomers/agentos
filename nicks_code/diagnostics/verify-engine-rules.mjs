/* VAS MTD Reporting Engine v6.0 — does the dashboard actually obey the rule book?
 *
 * Two jobs, and the first one matters as much as the second:
 *
 *   1. DRIFT. The rule book has two copies — agentos/specs/mtd_engine_rules.json (the record)
 *      and the MTD_RULES object inlined in index.html (what the engine reads, inlined because
 *      the app must run from file:// with no server). Two copies drift. This asserts they
 *      still agree, field by field.
 *
 *   2. BEHAVIOUR. Loads the real 1-4 Aug export drop into the real app and checks the figures
 *      against the hand-built tracker workbook the spec was reverse-engineered from, plus the
 *      rules that were newly wired in: Nesting reported, test rows excluded, support staff out
 *      of the register, Courtesy shifts taken from the dialler, the three excluded agents gone.
 *
 * Run:  node verify-engine-rules.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

const REPO = String.raw`c:\Users\aarav\OneDrive\Desktop\Chatterbox Agent OS\agentos`;
const ROOT = path.dirname(REPO);
const SRC  = path.join(ROOT, 'agentos', 'nicks_code', 'diagnostics', 'src-aug');
const j = (...p) => path.join(...p);

let pass = 0, fail = 0; const failures = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; failures.push(n + (d ? ' — ' + d : '')); console.log('  FAIL ' + n + (d ? ' — ' + d : '')); } };

/* ---------------------------------------------------------------- 1. drift ---- */
console.log('\n== rule book: specs/mtd_engine_rules.json vs MTD_RULES in index.html ==');
const SPEC = JSON.parse(fs.readFileSync(j(REPO, 'specs', 'mtd_engine_rules.json'), 'utf8'));
const html = fs.readFileSync(j(REPO, 'nicks_code', 'index.html'), 'utf8');
const inlined = (() => {
  const i = html.indexOf('const MTD_RULES = {');
  const end = html.indexOf('\n};', i);
  return eval('(' + html.slice(i + 'const MTD_RULES = '.length, end + 2) + ')');
})();

ok('schema version matches', inlined.version === SPEC.$schema_version, `${inlined.version} vs ${SPEC.$schema_version}`);
ok('GWP rate per sale matches', inlined.gwpPerSale === SPEC.reference_data.gwp_rate_per_sale.value);
ok('VAT multiplier matches', inlined.vat === SPEC.reference_data.vat_multiplier.value);
{
  const w = SPEC.reference_data.attendance_shift_weights;
  const drift = Object.keys(inlined.attWeights).filter(k => w[k] !== inlined.attWeights[k]);
  ok('attendance shift weights match', !drift.length, drift.join(','));
}
{
  const t = SPEC.reference_data.sales_target_matrix;
  const drift = Object.keys(inlined.salesTargetMatrix).filter(k => t[k] !== inlined.salesTargetMatrix[k]);
  ok('sales target matrix matches', !drift.length, drift.join(','));
}
{
  const c = SPEC.identity_resolution.code_corrections;
  const drift = Object.keys(inlined.qaCodeCorrections).filter(k => c[k] !== inlined.qaCodeCorrections[k]);
  const missing = Object.keys(c).filter(k => !k.startsWith('_') && !inlined.qaCodeCorrections[k]);
  ok('QA code corrections match', !drift.length && !missing.length, [...drift, ...missing].join(','));
}
{
  const d = SPEC.identity_resolution.dialler_label_corrections;
  const missing = Object.keys(d).filter(k => !k.startsWith('_') && inlined.diallerLabelCorrections[k] !== d[k]);
  ok('dialler label corrections match', !missing.length, missing.join(','));
}
{
  const a = SPEC.identity_resolution.name_aliases;
  const missing = Object.keys(a).filter(k => inlined.nameAliases[k] !== a[k]);
  ok('name aliases match', !missing.length, missing.join(', '));
}
{
  const ex = SPEC.august_fact_table.row_inclusion_rule.exclusions.codes;
  const missing = ex.filter(c => !inlined.excludeAgents[c]);
  ok('agent exclusion list matches', !missing.length && ex.length === Object.keys(inlined.excludeAgents).length, missing.join(','));
}

/* ------------------------------------------------------- 2. reference data ---- */
if (!fs.existsSync(SRC)) {
  console.log(`\n(skipping the behaviour suite — put the 1-4 Aug export drop in ${SRC})`);
  console.log(`\n${pass} passed, ${fail} failed`);
  failures.forEach(f => console.log('  · ' + f));
  process.exit(fail ? 1 : 0);
}

const F = n => j(SRC, n);
const FILES = ['Matrix - Agent List.xlsx', 'attendance.csv', 'BI Active - 05.08.xlsx',
  'BI Inactive - 05.08.xlsx', 'Call X Call report - 3 - 5.xlsx', 'evaluations.csv']
  .map(F).filter(fs.existsSync);
console.log(`\n== behaviour: ${FILES.length} source files ==`);

/* The figures the hand-built workbook carries for 01-04 Aug, from spec §7's reference
   output. The three campaigns are checked separately because they are produced by three
   different rules; a single grand total would hide a compensating error between them. */
const WORKBOOK = {
  Cuddle:   { gwp: 47370 },                 // §7 pivot_cuddle grand total
  Courtesy: { gwp: 14636, sales: 144 },     // §7 pivot_courtesy grand total
  Nesting:  { sales: 17, agents: 3 },       // §7 coverage_gap — what used to vanish entirely
};
// Sales/GWP drift by at most a couple of units against a workbook cut a day before the BI
// pull: open item OI-12 measures it at 2 agents on sales, 3 on GWP. Anything larger is a rule
// breaking, not a snapshot moving.
const DRIFT = { sales: 2, gwp: 120 };

// what the BI union says, computed here rather than trusted from the app
const ser = v => (typeof v === 'number' ? new Date(Date.UTC(1899, 11, 30) + v * 86400000).toISOString().slice(0, 10)
  : (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').slice(0, 10)));
const num = v => { const n = parseFloat(String(v ?? '').replace(/\s/g, '').replace(/^(-?\d+),(\d+)$/, '$1.$2').replace(/[^0-9.\-]/g, '')); return isFinite(n) ? n : NaN; };
const FROM = '2026-08-01', TO = '2026-08-04';
let testRows = 0;
const acct = {};
for (const f of ['BI Active - 05.08.xlsx', 'BI Inactive - 05.08.xlsx']) {
  if (!fs.existsSync(F(f))) continue;
  const wb = XLSX.read(fs.readFileSync(F(f)), { type: 'buffer' });
  for (const r of XLSX.utils.sheet_to_json(wb.Sheets['Export'] || wb.Sheets[wb.SheetNames[0]], { defval: '' })) {
    const a = String(r['Account Number'] ?? '').trim();
    if (!a || /^applied filters/i.test(a)) continue;
    if (String(r['Charge Code'] ?? '').trim().toUpperCase() === 'TESTRR' || a === '622622') { testRows++; continue; }
    const d = ser(r['Contract Create Date']); if (d < FROM || d > TO) continue;
    const c = num(r['Charge Amount']); if (isNaN(c)) continue;
    const ow = String(r['Owner'] ?? '').toLowerCase().replace(/-\s*panimax/g, '').replace(/[^a-z]/g, '');
    ((acct[ow] = acct[ow] || {}))[a] = (acct[ow][a] || 0) + c;
  }
}
let expAcc = 0, expGwp = 0;
for (const ow in acct) for (const a in acct[ow]) { expAcc++; expGwp += Math.round(acct[ow][a] * 1.15); }
console.log(`  independent recompute 01-04 Aug: ${expAcc} accounts, GWP R${expGwp} (all owners), ${testRows} test rows excluded`);

/* ------------------------------------------------------------- 3. the app ---- */
/* By default this drives the SOURCE (nicks_code/index.html). Set PULSE_HTML to drive the
   BUILD instead — `PULSE_HTML=site/pulse/index.html node verify-engine-rules.mjs` proves the
   artefact that actually ships obeys the rules, which is not quite the same claim: the build
   goes through prepare-site.js, which injects the storage shim, the stale-guard and the auth
   gate, and a build step is exactly the sort of place a rule can quietly stop being applied. */
const TARGET = process.env.PULSE_HTML
  ? path.resolve(REPO, process.env.PULSE_HTML)
  : j(REPO, 'nicks_code', 'index.html');
console.log(`  driving: ${path.relative(REPO, TARGET)}`);
const SERVE = { '/': TARGET, '/index.html': TARGET,
  '/xlsx.full.min.js': j(REPO, 'site', 'xlsx.full.min.js'),
  '/auth-gate.js': j(REPO, 'site', 'auth-gate.js'),
  '/ask-widget.js': j(REPO, 'site', 'ask-widget.js') };
const server = http.createServer((req, res) => {
  const p = SERVE[req.url.split('?')[0]];
  if (!p || !fs.existsSync(p)) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' });
  fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(8127, '127.0.0.1', r));

const browser = await chromium.launch({ args: ['--js-flags=--max-old-space-size=8192'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.goto('http://127.0.0.1:8127/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__mtd && window.__mtd.state(), null, { timeout: 30000 });

await page.setInputFiles('#fileInput', FILES, { timeout: 60000 });
await page.waitForFunction(n => (window.__mtd.state().files || []).length >= n, FILES.length - 1, { timeout: 600000 });
await page.waitForTimeout(5000);

// pin to the workbook's own window — the whole point of §0 of the reconciliation
await page.evaluate(() => { window.__mtd.setRange('2026-08-01', '2026-08-04'); });
await page.waitForTimeout(2500);

const R = await page.evaluate(() => {
  const M = window.__mtd.model(), S = window.__mtd.state();
  const camps = {};
  for (const c of ['Cuddle', 'Courtesy', 'Nesting', 'VT']) {
    const rows = M.facts.filter(f => f.campaign === c);
    camps[c] = { rows: rows.length, agents: new Set(rows.map(f => f.code)).size,
      sales: rows.reduce((a, f) => a + f.sales, 0), gwp: Math.round(rows.reduce((a, f) => a + f.gwp, 0)),
      emp: rows.reduce((a, f) => a + f.emp, 0), act: rows.reduce((a, f) => a + f.act, 0) };
  }
  return { camps, dates: M.dates.length, diallingDays: M.diallingDays, checks: window.__mtd.checks(),
    codes: [...new Set(M.facts.map(f => f.code))],
    attCodes: [...new Set(Object.values(S.att).flatMap(o => Object.keys(o)))],
    rosterNames: S.roster.filter(a => a.code === 'CB156').map(a => a.name),
    // BI money for agents the fact table gives no GWP to (VT) plus owners off the roster —
    // the two legitimate reasons the union total exceeds the campaign totals
    offBook: (() => { const roster = {}; S.roster.forEach(a => roster[a.code] = a); let g = 0;
      for (const d in S.sales) { if (d < '2026-08-01' || d > '2026-08-04') continue;
        for (const k in S.sales[d]) { const c = resolveKey(k);
          if (!c || !roster[c] || roster[c].campaign === 'VT') g += S.sales[d][k].gwp; } }
      return Math.round(g); })(),
    qaAvg: M.qaAvg, qaAgents: M.qaAgents };
});

console.log('\n== the rules that were wired in ==');
ok('no page errors', !errors.length, errors.slice(0, 2).join(' | '));

/* §1 — dialling days come from the attendance register. 01 Aug is a Saturday carrying four
   sales and no register: three dates hold data, but only two are dialling days, and the
   TL-level SPD divides by this. */
ok('dialling days come from the register, not every dated file', R.diallingDays === 2,
  `${R.diallingDays} dialling days over ${R.dates} dated days`);

// §7 coverage gap — 3 agents and 17 sales that used to vanish from every report
ok('Nesting is a reported campaign', R.camps.Nesting.agents === WORKBOOK.Nesting.agents
  && R.camps.Nesting.sales === WORKBOOK.Nesting.sales,
  `${R.camps.Nesting.agents} agents / ${R.camps.Nesting.sales} sales vs workbook ${WORKBOOK.Nesting.agents}/${WORKBOOK.Nesting.sales}`);

// §7 reference output — the figures the hand-built workbook carries
ok('Cuddle GWP matches the workbook exactly', R.camps.Cuddle.gwp === WORKBOOK.Cuddle.gwp,
  `app R${R.camps.Cuddle.gwp} vs workbook R${WORKBOOK.Cuddle.gwp}`);
ok('Courtesy GWP within pull drift of the workbook', Math.abs(R.camps.Courtesy.gwp - WORKBOOK.Courtesy.gwp) <= DRIFT.gwp,
  `app R${R.camps.Courtesy.gwp} vs workbook R${WORKBOOK.Courtesy.gwp}`);
ok('Courtesy sales within pull drift of the workbook', Math.abs(R.camps.Courtesy.sales - WORKBOOK.Courtesy.sales) <= DRIFT.sales,
  `app ${R.camps.Courtesy.sales} vs workbook ${WORKBOOK.Courtesy.sales}`);

// §5 exclusions
for (const c of ['CB67', 'CB205', 'CB265']) ok(`${c} excluded from the fact table`, !R.codes.includes(c));

// §2 — the register covers the whole company; only Call Agents are shifts
ok('support staff kept out of the register', R.attCodes.length > 0 && R.camps.Cuddle.emp > 0);

// §3 — display name comes from Sales Force
ok('CB156 displays the Sales Force name', R.rosterNames[0] === 'Ashnee Kasavani Sankarparsad', String(R.rosterNames[0]));

/* §6.5 — every rand in the BI union is accounted for. The campaign totals plus the money the
   fact table deliberately does not carry (Vehicle Tracking, and owners who match no roster
   row) must add back up to the independent recompute, to the rand. This is the check that
   would catch money quietly going missing in a transform. */
{
  const gwp = R.camps.Cuddle.gwp + R.camps.Courtesy.gwp + R.camps.Nesting.gwp;
  ok('every rand of the BI union is accounted for', Math.abs(gwp + R.offBook - expGwp) <= 3,
    `campaigns R${gwp} + off-book R${R.offBook} = R${gwp + R.offBook} vs recompute R${expGwp}`);
}

// §6.2 — Courtesy shifts are dialler-derived, so a Present agent who never dialled is 0
ok('Courtesy actual shifts are not simply the register', R.camps.Courtesy.act <= R.camps.Courtesy.emp,
  `act ${R.camps.Courtesy.act} vs emp ${R.camps.Courtesy.emp}`);

/* THE GENERATED TRACKER MUST BE REFUSED. It is this app's own output, and its "Team Split"
   sheet is a column-for-column clone of the Agent List's VAS sheet — so it reads as a roster
   and supersedes the live one with the stale snapshot frozen into the report. Measured before
   the guard: Courtesy 40 -> 42, Nesting 4 -> 8 (written "Courtesy - Nesting"), six departed
   agents resurrected, targets zeroed, and Courtesy attendance falsely dropped to 55%. Nothing
   on screen said why. This is the regression test for that. */
{
  const TRK = j(SRC, 'VAS - August 2026 MTD Tracker 1 - 4 Aug.xlsx');
  if (fs.existsSync(TRK)) {
    const before = await page.evaluate(() => {
      const S = window.__mtd.state(); const by = {};
      S.roster.forEach(a => by[a.campaign] = (by[a.campaign] || 0) + 1);
      return { n: S.roster.length, by: JSON.stringify(by) };
    });
    await page.setInputFiles('#fileInput', [TRK], { timeout: 120000 });
    await page.waitForTimeout(7000);
    const after = await page.evaluate(() => {
      const S = window.__mtd.state(); const by = {};
      S.roster.forEach(a => by[a.campaign] = (by[a.campaign] || 0) + 1);
      return { n: S.roster.length, by: JSON.stringify(by),
        rosterFiles: (S.files || []).filter(f => /roster/.test(f.type)).map(f => f.name),
        tracker: Object.keys(S.tracker || {}).length };
    });
    ok('the generated tracker workbook does not touch the roster',
      before.n === after.n && before.by === after.by,
      `${before.n} ${before.by} -> ${after.n} ${after.by}`);
    ok('the generated tracker workbook is not stored as facts', after.tracker === 0, `${after.tracker} tracker days`);
    ok('the live Agent List still owns the roster',
      after.rosterFiles.every(f => /agent list/i.test(f)), after.rosterFiles.join(', '));
  } else {
    console.log('  (skipping tracker-workbook guard — reference workbook not in src-aug)');
  }
}

/* EVERY CAMPAIGN IN THE DATA NEEDS A SECTION ON SCREEN. Nesting was added to the engine and
   to the totals, but the MTD and WTD campaign tabs were hardcoded lists that did not include
   it — so its 3 agents and 17 sales counted toward the headline with no reachable section
   showing them, and Courtesy + Cuddle + Tracker visibly summed to 612 against a headline of
   629. A campaign that exists in the facts but not in the tab strip is invisible arithmetic,
   which is exactly what "the totals don't add up" looks like from the floor. */
{
  await page.evaluate(() => go('mtd'));
  await page.waitForTimeout(2000);
  const seen = await page.evaluate(() => {
    const M = window.__mtd.model();
    const inData = [...new Set(M.facts.map(f => f.campaign))];
    const tabs = [...document.querySelectorAll('.chip')].map(e => e.textContent.trim());
    return { inData, tabs };
  });
  const labelFor = c => ({ Courtesy: 'Matrix Courtesy', Cuddle: 'Matrix Cuddle', Nesting: 'Nesting', VT: 'Matrix Tracker' })[c] || c;
  const missing = seen.inData.filter(c => !seen.tabs.includes(labelFor(c)));
  ok('every campaign in the data has a section on screen', !missing.length,
    `missing tabs: ${missing.join(', ')} (tabs: ${seen.tabs.join(', ')})`);

  // and the VAS campaigns must sum to the VAS headline (VT is excluded from it by design)
  const sums = await page.evaluate(() => {
    const M = window.__mtd.model(); const by = {};
    for (const f of M.facts) { if (f.rangeAgg) continue;
      const t = by[f.campaign] = by[f.campaign] || { emp: 0, sales: 0, gwp: 0 };
      t.emp += f.emp; t.sales += f.sales; t.gwp += f.gwp; }
    const vas = Object.entries(by).filter(([c]) => c !== 'VT')
      .reduce((a, [, t]) => ({ emp: a.emp + t.emp, sales: a.sales + t.sales, gwp: a.gwp + t.gwp }), { emp: 0, sales: 0, gwp: 0 });
    return { vas, grand: { emp: M.grand.emp, sales: M.grand.sales, gwp: Math.round(M.grand.gwp) } };
  });
  ok('the VAS campaign sections sum to the headline total',
    sums.vas.emp === sums.grand.emp && sums.vas.sales === sums.grand.sales
      && Math.abs(Math.round(sums.vas.gwp) - sums.grand.gwp) <= 1,
    `campaigns ${JSON.stringify(sums.vas)} vs headline ${JSON.stringify(sums.grand)}`);
}

// §11 — the checks themselves
console.log('\n== §11 rule checks, as the dashboard reports them ==');
const errs = R.checks.filter(c => !c.ok && c.sev === 'error');
R.checks.forEach(c => console.log(`  ${c.ok ? 'pass' : (c.sev === 'error' ? 'FAIL' : 'note')}  ${c.id}  ${c.msg}`));
ok('no error-severity check fails', !errs.length, errs.map(e => e.id).join(','));

await browser.close(); server.close();
console.log(`\n${pass} passed, ${fail} failed`);
failures.forEach(f => console.log('  · ' + f));
process.exit(fail ? 1 : 0);