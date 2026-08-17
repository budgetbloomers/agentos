// VARIANCE REPORT — deterministic verification of the buildVariance() engine against
// specs/vas_variance_report_rules.json (artefact A: daily system variance).
//
// Synthetic fixtures with hand-computed expectations for every DV formula:
//   DV01 sales = COUNT DISTINCT Account Number, BI Active ∪ Inactive, Contract Create Date
//   DV02 gwp   = ROUND(SUM(Charge Amount) × 1.15, 0)  — round ONCE after summing (the
//                Enoch case: 0.30 + 0.30 → 0.69 → 1; per-account rounding would give 0)
//   DV03 flags = sale-no-dialler (error) · talk>2h-no-sale (warn) · present-not-dialling (warn)
//   DV04       = BLOCKED, emits null never zero
// Plus: tolerance bands at the boundary (GWP ±1 pass, ±2 material), identity/unmapped,
// set-difference (VR04/RC5), test-row exclusion, multi-day isolation, duplicate-upload
// idempotency, board day-replace, snapshot skew (VR02/RC1), rule-book drift vs the spec.
//
// Run: node verify-variance.mjs      (PULSE_HTML=site/pulse/index.html for the build copy)
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

const REPO = String.raw`c:\Users\aarav\OneDrive\Desktop\Chatterbox Agent OS\agentos`;
const HTML = path.join(REPO, ...(process.env.PULSE_HTML || 'nicks_code/index.html').split('/'));
const SERVE = {
  '/': HTML, '/index.html': HTML,
  '/xlsx.full.min.js': path.join(REPO, 'site', 'xlsx.full.min.js'),
};
const server = http.createServer((req, res) => {
  const p = SERVE[req.url.split('?')[0]];
  if (!p || !fs.existsSync(p)) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' });
  fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(8133, '127.0.0.1', r));

let pass = 0, fail = 0; const failures = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  pass  ' + n); } else { fail++; failures.push(n + (d ? ' — ' + d : '')); console.log('  FAIL  ' + n + ' — ' + d); } };

/* ---------- rule-book drift: inline VARIANCE_RULES vs the spec JSON ---------- */
const SPEC = JSON.parse(fs.readFileSync(path.join(REPO, 'specs', 'vas_variance_report_rules.json'), 'utf8'));

/* ---------- fixtures (agents come from the app's built-in DEFAULTS roster) ---------- */
const BI_HDR = 'Account Number,Owner,Contract Create Date,Contract Deactivate Date,Charge Amount,Charge Code';
const ACTIVE = [BI_HDR,
  'A1,Theo Chetty - Panimax,2026-08-03,,30.43,R1',
  'A1,Theo Chetty - Panimax,2026-08-03,,33.91,R2',
  'A1,Theo Chetty - Panimax,2026-08-03,,21.74,R3',
  'A2,Theo Chetty - Panimax,2026-08-03,,100,R1',
  'TT,Theo Chetty - Panimax,2026-08-03,,50,TESTRR',            // test row — must be excluded
  'E1,Enoch Pillay - Panimax,2026-08-03,,0.30,R1',
  'E2,Enoch Pillay - Panimax,2026-08-03,,0.30,R1',
  'N1,Nosipho Shange - Panimax,2026-08-03,,86.96,R1',
  'S1,Sechaba Mlambo - Panimax,2026-08-04,,86.96,R1',
  'Z1,Zandile Chamane - Panimax,2026-08-04,,86.96,R1',   // sale dated 04, dialled 03 → adjacent-day case
].join('\n');
const INACTIVE = [BI_HDR.replace('Charge Code', 'Charge Code,Contract Number'),
  'A9,Theo Chetty - Panimax,2026-08-03,2026-08-10,10.00,R1,C9',   // cancelled in-period: still a gross sale
].join('\n');
const BOARD = [
  '### Sheet: 03.08 ###',
  'Agent Name,Sale 1,Sale 2,Sale 3,Total Sales,Total GWP,Average GWP,Referrals',
  'Theo Chetty,99,115,10,3,224,75,2',          // sales exact · GWP +1 → Rounding band
  'Enoch Pillay,,,,2,1,,0',                    // exact/exact — proves sum-then-round GWP=1
  'Nosipho Shange,100,,,1,100,100,0',          // exact/exact · DV03 error flag (sale, no dialling)
  'Anele Natacia Sibisi,50,,,1,50,50,0',       // board-only claim → −1 material, RC5
  'Nonexistent Person,10,,,1,10,10,0',         // unmapped — excluded, reported
  '### Sheet: 04.08 ###',
  'Agent Name,Sale 1,Sale 2,Sale 3,Total Sales,Total GWP,Average GWP,Referrals',
  'Sechaba Mlambo,90,,,2,102,51,1',            // stated 2 vs 1 cell → mismatch flag · −1/−2 material
].join('\n');
const CALLS = ['Date & Time,Agent,Duration,Billable Seconds,Lead Disposition,Bridge',
  '2026-08-03 09:00,Anele Natacia Sibisi CB-115,0:05:00,300,No Sale,ANSWERED',
  '2026-08-03 09:10,Thulani Mbonambi CB-142,2:20:00,8000,No Sale,ANSWERED',   // >2h, 0 sales
  '2026-08-03 11:00,Zandile Chamane CB-150,0:20:00,1200,No Sale,ANSWERED',    // dialled 03; her sale is dated 04
  '2026-08-04 10:00,Sechaba Mlambo CB-131,1:00:00,3000,VAS Sale No Insurance Opt In,ANSWERED',
].join('\n');
const ATT = ['Date,Employee Code,Employee Name,Employee Type,Status,Status Code',
  '2026-08-03,CB162,Nothando Mntungwa,Call Agent,Present,P',    // present, no dialling → warn
  '2026-08-03,CB129,Nosipho Shange,Call Agent,Present,P',
  '2026-08-04,CB131,Sechaba Mlambo,Call Agent,Present,P',
].join('\n');
// period-aggregated ViciDial (Agent Performance Detail): Theo 2h over 03–04 → 1h/day ESTIMATE
const VICI = 'Agent Performance Detail\ntime range: 2026-08-03 00:00:00 to 2026-08-04 23:59:59\n'
  + '"USER NAME","ID","CURRENT USER GROUP","CALLS","TALK","SALE","VASNP","VASKP"\n'
  + '"Theo Chetty","CB136","CBX","100","2:00:00","3","0","0"\n';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
page.on('dialog', d => d.accept());
await page.goto('http://127.0.0.1:8133/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__mtd && window.__mtd.state(), null, { timeout: 30000 });
await page.evaluate(() => { localStorage.clear(); });
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__mtd && window.__mtd.state(), null, { timeout: 30000 });

console.log('Ingesting synthetic fixtures…');
const loaded = await page.evaluate(async fx => {
  const r = [];
  r.push(await window.__mtd.ingest('Active.xlsx', fx.ACTIVE));
  r.push(await window.__mtd.ingest('Inactive.xlsx', fx.INACTIVE));
  r.push(await window.__mtd.ingest('Manual Stats August.xlsx', fx.BOARD));
  r.push(await window.__mtd.ingest('call_records.csv', fx.CALLS));
  r.push(await window.__mtd.ingest('attendance_2026-08-03_to_2026-08-04.csv', fx.ATT));
  r.push(await window.__mtd.ingest('Vici - Cuddle Agents - 3 - 4 Aug.csv', fx.VICI));
  window.__mtd.rebuild();
  return r;
}, { ACTIVE, INACTIVE, BOARD, CALLS, ATT, VICI });
ok('all six fixtures ingested', loaded.every(Boolean), JSON.stringify(loaded));

const types = await page.evaluate(() => window.__mtd.state().files.map(f => f.type));
ok('board sheets registered per day (2 board entries)', types.filter(t => t.startsWith('board')).length === 2, types.join(', '));
ok('BI + cancellations + calls + attendance registered',
  ['bi', 'cancellations', 'calls', 'attendance'].every(t => types.some(x => x.split(' ')[0] === t)), types.join(', '));

const VR = await page.evaluate(() => {
  const v = window.__mtd.variance('2026-08-03', '2026-08-04');
  return JSON.parse(JSON.stringify({
    rows: v.rows, days: v.days, summary: v.summary, unmapped: v.unmapped,
    header: v.header, checks: v.checks, rcCounts: v.rcCounts,
  }));
});
const row = (code, d) => VR.rows.find(r => r.code === code && r.d === d);

/* ---------- DV01 / DV02 — normal + boundary + formula proof ---------- */
const theo = row('CB136', '2026-08-03');
ok('DV01 Theo: SF sales = 3 (2 active accounts + 1 cancelled, TESTRR excluded)', theo && theo.sfSales === 3, JSON.stringify(theo));
ok('DV02 Theo: SF GWP = 225 (196.08 × 1.15 = 225.492 → 225)', theo && theo.sfGwp === 225, theo && String(theo.sfGwp));
ok('DV01 Theo: board 3 → variance 0 → exact', theo && theo.bdSales === 3 && theo.salesVar === 0 && theo.v.sales === 'exact');
ok('DV02 Theo: board 224 → variance +1 → Rounding band PASS', theo && theo.gwpVar === 1 && theo.v.gwp === 'rounding');
ok('DV04 Theo: board referrals carried (2), variance blocked not zero', theo && theo.bdRef === 2 && VR.header.metrics_blocked.length > 0);

const enoch = row('CB70', '2026-08-03');
ok('DV02 formula: round AFTER summing — Enoch GWP = 1 (0.60 × 1.15 = 0.69 → 1; per-account rounding would give 0)',
  enoch && enoch.sfGwp === 1, enoch && String(enoch.sfGwp));
ok('DV01/DV02 Enoch: exact / exact (zero-adjacent boundary)', enoch && enoch.v.sales === 'exact' && enoch.v.gwp === 'exact');

const sech = row('CB131', '2026-08-04');
ok('DV01 Sechaba: SF 1 vs board 2 → −1 → material (negative = agent claimed unrecorded sale)',
  sech && sech.salesVar === -1 && sech.v.sales === 'material', JSON.stringify(sech && sech.v));
ok('DV02 Sechaba: 100 vs 102 → −2 → outside ±1 → material (boundary above tolerance)',
  sech && sech.gwpVar === -2 && sech.v.gwp === 'material');
ok('board stated-total vs Sale-cells mismatch flagged', sech && sech.flags.some(f => /Board states 2/.test(f.f)));

/* ---------- DV03 flags ---------- */
const nosi = row('CB129', '2026-08-03');
ok('DV03 flag 1 (error): sale recorded, talk = 0', nosi && nosi.flags.some(f => f.sev === 'error' && /no dialler activity/.test(f.f)), JSON.stringify(nosi && nosi.flags));
const thul = row('CB142', '2026-08-03');
ok('DV03 flag 2 (warning): talk 8000s > 2h, 0 sales', thul && thul.flags.some(f => f.sev === 'warning' && /Talk > 2h/.test(f.f)), JSON.stringify(thul && thul.flags));
ok('DV03 Thulani sales variance still exact (0 vs 0)', thul && thul.salesVar === 0 && thul.v.sales === 'exact');
const noth = row('CB162', '2026-08-03');
ok('DV03 flag 3 (warning): present but not dialling', noth && noth.flags.some(f => f.sev === 'warning' && /Present but not dialling/.test(f.f)), JSON.stringify(noth && noth.flags));
ok('DV03 Cuddle talk unknown without day-level ViciDial (null, checks skipped)', theo && theo.talk === null && theo.flags.some(f => f.sev === 'info'));
ok('Cuddle talk ESTIMATE from period ViciDial: 2h over 03–04 → 3600s/day, flagged, never used for DV03',
  theo && theo.talkEst === 3600 && theo.flags.some(f => /estimated/i.test(f.f)) && !theo.flags.some(f => f.sev === 'error'),
  JSON.stringify(theo && [theo.talkEst, theo.flags]));
const zand = row('CB150', '2026-08-04');
ok('talk=0-with-sale names the ADJACENT dial day (sale dated to Contract Create Date, dialled 03)',
  zand && zand.talk === 0 && zand.flags.some(f => f.sev === 'warning' && /2026-08-03/.test(f.f) && /Contract Create Date/.test(f.f)), JSON.stringify(zand && zand.flags));
ok('no adjacent talk anywhere → flag stays an ERROR (Nosipho)', nosi && nosi.flags.some(f => f.sev === 'error'), JSON.stringify(nosi && nosi.flags));
ok('dialler sales column: Sechaba 1 disposition, Nosipho 0, Cuddle unknown (null)',
  sech && sech.dlSales === 1 && nosi && nosi.dlSales === 0 && theo && theo.dlSales === null,
  JSON.stringify([sech && sech.dlSales, nosi && nosi.dlSales, theo && theo.dlSales]));

/* ---------- identity / scope ---------- */
ok('unmapped board name reported, not guessed', Object.values(VR.unmapped).some(u => /Nonexistent/.test(u.key) && u.src === 'Manual Stats'), JSON.stringify(Object.keys(VR.unmapped)));
ok('unmapped excluded from rows', !VR.rows.some(r => /Nonexistent/i.test(r.agent)));
ok('VR03 fails while an identity is unresolved', VR.checks.some(c => c.id === 'VR03' && !c.ok));
const anele = row('CB115', '2026-08-03');
ok('VR04/RC5: board-only agent → material −1, auto RC5, listed source-b-only',
  anele && anele.salesVar === -1 && anele.rcSales === 'RC5' && VR.header.agents_source_b_only.includes('CB115'), JSON.stringify(anele && [anele.salesVar, anele.rcSales]));

/* ---------- aggregation / summary ---------- */
ok('9 agent-day rows (multi-agent, DV03-only agents included)', VR.rows.length === 9, 'rows=' + VR.rows.length);
ok('summary: 11 exact · 1 rounding · 6 material · 0 blocked · 0 indeterminate',
  VR.summary.exact === 11 && VR.summary.rounding === 1 && VR.summary.material === 6 && VR.summary.blocked === 0 && VR.summary.indeterminate === 0,
  JSON.stringify(VR.summary));
ok('VR02 passes — cut-offs aligned (both end 04)', VR.checks.some(c => c.id === 'VR02' && c.ok));
ok('VR05 fails while material variances are unclassified (Sechaba)', VR.checks.some(c => c.id === 'VR05' && !c.ok));

/* ---------- reporting-period isolation ---------- */
const VR3 = await page.evaluate(() => JSON.parse(JSON.stringify(window.__mtd.variance('2026-08-03', '2026-08-03').rows)));
ok('period 03-only: no day-04 rows leak', VR3.every(r => r.d === '2026-08-03') && !VR3.some(r => r.code === 'CB131'), 'rows=' + VR3.length);

/* ---------- duplicate upload idempotency ---------- */
const again = await page.evaluate(async fx => {
  await window.__mtd.ingest('Manual Stats August.xlsx', fx.BOARD);
  const v = window.__mtd.variance('2026-08-03', '2026-08-04');
  const t = v.rows.find(r => r.code === 'CB136' && r.d === '2026-08-03');
  return { n: v.rows.length, theo: [t.sfSales, t.bdSales, t.sfGwp, t.bdGwp] };
}, { BOARD });
ok('re-uploading the same board changes nothing (idempotent)', again.n === 9 && again.theo.join() === '3,3,225,224', JSON.stringify(again));

/* ---------- board day-replace ---------- */
const rep = await page.evaluate(async () => {
  const SHEET = '### Sheet: 03.08 ###\nAgent Name,Sale 1,Total Sales,Total GWP,Average GWP,Referrals\nTheo Chetty,99,4,300,75,1';
  await window.__mtd.ingest('Manual Stats corrected.xlsx', SHEET);
  const v = window.__mtd.variance('2026-08-03', '2026-08-04');
  const t = v.rows.find(r => r.code === 'CB136' && r.d === '2026-08-03');
  const gone = !v.rows.some(r => r.code === 'CB70' && r.bdSales === 2 && r.d === '2026-08-03');
  return { bd: t.bdSales, salesVar: t.salesVar, v: t.v.sales, enochReplaced: gone };
});
ok('re-uploading a day REPLACES that day (Theo board 4, var −1 material; old rows gone)',
  rep.bd === 4 && rep.salesVar === -1 && rep.v === 'material' && rep.enochReplaced, JSON.stringify(rep));

/* ---------- snapshot skew (VR02 / RC1) ---------- */
const skew = await page.evaluate(async () => {
  const SHEET = '### Sheet: 05.08 ###\nAgent Name,Sale 1,Total Sales,Total GWP,Average GWP,Referrals\nTheo Chetty,99,1,99,99,0';
  await window.__mtd.ingest('Manual Stats 05.xlsx', SHEET);
  const v = window.__mtd.variance('2026-08-03', '2026-08-05');
  const edge = v.rows.find(r => r.code === 'CB131' && r.d === '2026-08-04');   // last jointly-covered day
  const d5 = v.rows.find(r => r.code === 'CB136' && r.d === '2026-08-05');
  return JSON.parse(JSON.stringify({
    vr02: v.checks.find(c => c.id === 'VR02'), edge: edge && { v: edge.v, rc: edge.rcSales }, d5: d5 && d5.v,
  }));
});
ok('VR02 fails when cut-offs differ (board 05 vs BI 04)', skew.vr02 && !skew.vr02.ok, JSON.stringify(skew.vr02));
ok('edge day (04) material variances downgrade to indeterminate + RC1', skew.edge && skew.edge.v.sales === 'indeterminate' && skew.edge.rc === 'RC1', JSON.stringify(skew.edge));
ok('day past the edge is blocked (one-sided), null never zero', skew.d5 && skew.d5.sales === 'blocked', JSON.stringify(skew.d5));

/* ---------- manual root-cause classification persists ---------- */
const rc = await page.evaluate(() => {
  const S = window.__mtd.state();
  S.varRC['2026-08-04|CB131|sales'] = 'RC4';
  const v = window.__mtd.variance('2026-08-03', '2026-08-04');
  const r = v.rows.find(x => x.code === 'CB131' && x.d === '2026-08-04');
  delete S.varRC['2026-08-04|CB131|sales'];
  return { rc: r.rcSales, auto: r.rcSalesAuto };
});
ok('a saved human classification beats the auto-suggestion', rc.rc === 'RC4' && rc.auto === false, JSON.stringify(rc));

/* ---------- UI renders ---------- */
await page.evaluate(() => { window.__mtd.setRange('2026-08-03', '2026-08-04'); go('variance'); });
await page.waitForTimeout(1200);
const txt = await page.evaluate(() => document.getElementById('view')?.innerText || '');
ok('Variance page renders (Summary)', /Variance Report/.test(txt) && /Validation checks/.test(txt), txt.slice(0, 120));
await page.click('#view .chip:has-text("Daily")');   // the real chip, exactly as a user switches tabs
await page.waitForTimeout(1100);
const txt2 = await page.evaluate(() => document.getElementById('view')?.innerText || '');
// Column layout per Nick 2026-08-17: board first, then SF, differences displayed as
// Board−SF (sign-flipped DV01/DV02) plus the informational Board−Dialler.
ok('Daily Variance tab renders with variance columns', /board.?sf sales/i.test(txt2) && /board.?sf gwp/i.test(txt2) && /board.?dialler/i.test(txt2), txt2.slice(0, 200));
await page.evaluate(() => { const S = window.__mtd.state(); S.ui.varSub = 'unmapped'; renderPage(); });
await page.waitForTimeout(900);
const txt3 = await page.evaluate(() => document.getElementById('view')?.innerText || '');
ok('Unmapped tab renders (present even with content)', /Unmapped/.test(txt3), txt3.slice(0, 120));

/* ---------- filters recalculate consistently ---------- */
const filt = await page.evaluate(() => {
  const S = window.__mtd.state();
  S.ui.varSub = 'daily'; S.ui.camp = 'Courtesy'; renderPage();
  return new Promise(res => setTimeout(() => {
    const t = document.getElementById('view').innerText;
    const kpis = t.match(/Agents compared\s*\n?\s*(\d+)/);
    S.ui.camp = ''; renderPage();
    res({ hasCuddleAgent: /Theo Chetty/.test(t), agents: kpis && kpis[1] });
  }, 900));
});
ok('campaign filter removes other-campaign rows AND recomputes KPI cards', filt.hasCuddleAgent === false && filt.agents !== null, JSON.stringify(filt));

/* ---------- rule-book drift vs the spec JSON ---------- */
const RULES = await page.evaluate(() => {
  const R = window.__mtd.varianceRules();
  return { version: R.version, vat: R.vat, salesTol: R.salesTolerance, gwpTol: R.gwpTolerance,
    talkSecs: R.talkNoSaleSecs, rcs: Object.keys(R.rootCauses), sheetRe: String(R.boardSheetRe),
    dvIds: R.comparisons.map(c => c.id) };
});
const dv = Object.fromEntries(SPEC.daily_system_variance.comparisons.map(c => [c.id, c]));
ok('drift: version matches spec $schema_version', RULES.version === SPEC.$schema_version, RULES.version + ' vs ' + SPEC.$schema_version);
ok('drift: DV01 tolerance', RULES.salesTol === dv.DV01.tolerance, RULES.salesTol + ' vs ' + dv.DV01.tolerance);
ok('drift: DV02 tolerance (absolute)', RULES.gwpTol === dv.DV02.tolerance.absolute);
ok('drift: DV02 formula uses ×1.15 (VAT-inclusive)', RULES.vat === 1.15 && /1\.15/.test(dv.DV02.system_a.calc));
ok('drift: DV03 2-hour threshold', RULES.talkSecs === 7200 && /2 hours/.test(dv.DV03.flags[1].condition));
ok('drift: all four DV comparisons implemented', ['DV01', 'DV02', 'DV03', 'DV04'].every(id => RULES.dvIds.includes(id)), RULES.dvIds.join(','));
ok('drift: RC taxonomy complete RC1–RC7', SPEC.root_cause_taxonomy.classes.every(c => RULES.rcs.includes(c.code)), RULES.rcs.join(','));
ok('drift: board sheet grain DD.MM per day', /d\{1,2\}/.test(RULES.sheetRe) && /DD\.MM/.test(SPEC.required_files.missing_blocking[0].sheets));

ok('no page errors across the whole run', errors.length === 0, errors.slice(0, 4).join(' | '));

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
failures.forEach(f => console.log('FAIL: ' + f));
await browser.close(); server.close();
process.exit(fail || errors.length ? 1 : 0);
