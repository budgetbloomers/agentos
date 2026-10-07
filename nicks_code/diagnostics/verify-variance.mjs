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

const REPO = process.env.AGENTOS || decodeURIComponent(new URL('../..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1').replace(/\/$/, '');   // repo-relative (2026-09-08): the laptop path failed every cloud run
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
/* THE UNIT IS THE CASE (MTD_RULES.saleUnit) and sales are counted NET of cancellation
   (owner directive 2026-08-18) — the cancelled case below is NOT restored, which is what
   makes Theo 2 sales / R214 rather than 3 / R225. The regrain is proved in isolation further
   down, and the net switch is exercised in both positions on its own. */
const BI_HDR = 'Account Number,Case Number,Owner,Contract Create Date,Contract Deactivate Date,Charge Amount,Charge Code';
const ACTIVE = [BI_HDR,
  'A1,21000001,Theo Chetty - Panimax,2026-08-03,,30.43,R1',    // one case …
  'A1,21000001,Theo Chetty - Panimax,2026-08-03,,33.91,R2',    // … three charge lines,
  'A1,21000001,Theo Chetty - Panimax,2026-08-03,,21.74,R3',    // … 86.08 → R99
  'A2,21000002,Theo Chetty - Panimax,2026-08-03,,100,R1',
  'TT,21000099,Theo Chetty - Panimax,2026-08-03,,50,TESTRR',   // test row — must be excluded
  'E1,21000011,Enoch Pillay - Panimax,2026-08-03,,0.30,R1',
  'E2,21000012,Enoch Pillay - Panimax,2026-08-03,,0.30,R1',
  'N1,21000021,Nosipho Shange - Panimax,2026-08-03,,86.96,R1',
  'S1,21000031,Sechaba Mlambo - Panimax,2026-08-04,,86.96,R1',
  'Z1,21000041,Zandile Chamane - Panimax,2026-08-04,,86.96,R1', // sale dated 04, dialled 03 → adjacent-day case
].join('\n');
// Cancelled in-period. Sales are NET, so this case is NOT restored — the assertions below
// prove it stays out of both the count and the GWP.
const INACTIVE = [BI_HDR.replace('Charge Code', 'Charge Code,Contract Number'),
  'A9,21000009,Theo Chetty - Panimax,2026-08-03,2026-08-10,10.00,R1,C9',
].join('\n');
const BOARD = [
  '### Sheet: 03.08 ###',
  'Agent Name,Sale 1,Sale 2,Sale 3,Total Sales,Total GWP,Average GWP,Referrals',
  'Theo Chetty,99,115,,2,213,107,2',           // sales exact · GWP +1 → Rounding band
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

/* THE CALLX CUTOVER IS SWITCHED OFF FOR THIS FIXTURE (spec 014 V10, 2026-10-07). Since fe21aff (15 Sep,
   Nick: "remove all records because it all comes from vici dial now not call x") the intake refuses a
   Call Records file WHOLE, whatever its dates (MTD_RULES.callxRetired, nicks_code/index.html; spec
   sources[call_x_call].retired_note) — so this August CallX fixture stored nothing and every DV03 check
   read "Dialler coverage missing". This suite proves the Variance ENGINE on August-shaped data, not the
   cutover (verify-vici-cutover does that), so it loads the CallX file as August loaded it — the same
   switch verify-mtd-values and verify-dialler-warning already make. */
await page.evaluate(() => { MTD_RULES.callxRetired = null; });
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
ok('DV01 Theo: SF sales = 2 DISTINCT CASES — active only, the cancelled case excluded (NET); TESTRR excluded', theo && theo.sfSales === 2, JSON.stringify(theo));
ok('DV02 Theo: SF GWP = 214 (186.08 × 1.15 = 213.99 → 214; the cancelled R10 stays out)', theo && theo.sfGwp === 214, theo && String(theo.sfGwp));
ok('DV01 Theo: board 2 → variance 0 → exact', theo && theo.bdSales === 2 && theo.salesVar === 0 && theo.v.sales === 'exact');
ok('DV02 Theo: board 213 → variance +1 → Rounding band PASS', theo && theo.gwpVar === 1 && theo.v.gwp === 'rounding');
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
/* ROSTER-SEEDED (Nick, 2026-08-20): every non-VT Agent-List agent gets a row on each covered
   day, so absence and zero stop being the same answer. Row count = roster(non-VT) x days. */
const nonVT = await page.evaluate(() => window.__mtd.state().roster.filter(a => a.campaign !== 'VT').length);
ok('every Agent-List agent appears on both covered days', VR.rows.length === nonVT * 2,
  'rows=' + VR.rows.length + ' expected=' + (nonVT * 2));
ok('the original data rows are all still present', ['CB136','CB70','CB129','CB131','CB115','CB150','CB142','CB162'].every(c => VR.rows.some(r => r.code === c)));
/* zero-zero seeded rows are exact-exact, so material and rounding must NOT move — that is
   the proof the seeding adds silence, never variance. Exact absorbs the rest (2 verdicts/row). */
ok('summary: material 6 · rounding 1 unchanged; exact = everything else',
  VR.summary.material === 6 && VR.summary.rounding === 1 && VR.summary.blocked === 0 && VR.summary.indeterminate === 0
  && VR.summary.exact === VR.rows.length * 2 - 7,
  JSON.stringify(VR.summary) + ' rows=' + VR.rows.length);
ok('VR02 passes — cut-offs aligned (both end 04)', VR.checks.some(c => c.id === 'VR02' && c.ok));
ok('VR05 fails while material variances are unclassified (Sechaba)', VR.checks.some(c => c.id === 'VR05' && !c.ok));
ok('VR16 fails while Cuddle has NO day-level dialler rows — names the export and the user groups to tick',
  VR.checks.some(c => c.id === 'VR16' && !c.ok && /Cuddle/.test(c.msg) && /EXPORT_CALL_REPORT/.test(c.msg) && /Renolan_Matrix_WC \+ Sharoma_Matrix_WC/.test(c.msg)),
  JSON.stringify(VR.checks.find(c => c.id === 'VR16')));

/* ---------- reporting-period isolation ---------- */
const VR3 = await page.evaluate(() => JSON.parse(JSON.stringify(window.__mtd.variance('2026-08-03', '2026-08-03').rows)));
ok('period 03-only: no day-04 rows leak', VR3.every(r => r.d === '2026-08-03'), 'rows=' + VR3.length);
{ const s131 = VR3.find(r => r.code === 'CB131');   // Sechaba sold on the 04th only
  ok('a roster agent with no data on the day shows TRUE ZEROS, not his other-day figures',
    !!s131 && s131.sfSales === 0 && s131.bdSales === 0, JSON.stringify(s131 && [s131.sfSales, s131.bdSales])); }

/* ---------- duplicate upload idempotency ---------- */
const again = await page.evaluate(async fx => {
  await window.__mtd.ingest('Manual Stats August.xlsx', fx.BOARD);
  const v = window.__mtd.variance('2026-08-03', '2026-08-04');
  const t = v.rows.find(r => r.code === 'CB136' && r.d === '2026-08-03');
  return { n: v.rows.length, theo: [t.sfSales, t.bdSales, t.sfGwp, t.bdGwp] };
}, { BOARD });
ok('re-uploading the same board changes nothing (idempotent)', again.n === VR.rows.length && again.theo.join() === '2,2,214,213', JSON.stringify(again) + ' want n=' + VR.rows.length);

/* ---------- board day-replace ---------- */
const rep = await page.evaluate(async () => {
  const SHEET = '### Sheet: 03.08 ###\nAgent Name,Sale 1,Total Sales,Total GWP,Average GWP,Referrals\nTheo Chetty,99,3,300,75,1';
  await window.__mtd.ingest('Manual Stats corrected.xlsx', SHEET);
  const v = window.__mtd.variance('2026-08-03', '2026-08-04');
  const t = v.rows.find(r => r.code === 'CB136' && r.d === '2026-08-03');
  const gone = !v.rows.some(r => r.code === 'CB70' && r.bdSales === 2 && r.d === '2026-08-03');
  return { bd: t.bdSales, salesVar: t.salesVar, v: t.v.sales, enochReplaced: gone };
});
ok('re-uploading a day REPLACES that day (Theo board 3, var −1 material; old rows gone)',
  rep.bd === 3 && rep.salesVar === -1 && rep.v === 'material' && rep.enochReplaced, JSON.stringify(rep));

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

/* ---------- Cuddle with DAY-LEVEL ViciDial (EXPORT_CALL_REPORT) — works like Courtesy ----------
   The real 13/17-Aug pulls were user-group filtered and held no Cuddle agent, so Cuddle talk
   read null and DV03 was skipped (the test above). The fix is at the pull: an export that DOES
   include the Cuddle floor must flow day-level into DV03 exactly like Courtesy's CallX file —
   talk KNOWN, dialler sales counted, the period-aggregate estimate no longer used. The login is
   zero-padded (CB0136) on purpose: the export writes codes that way and resolveKey must strip it. */
const VICITXT = ['call_date\tphone_number_dialed\tstatus\tuser\tfull_name\tcampaign_id\tlead_id\tlength_in_sec\tuser_group\tstatus_name',
  '2026-08-03 09:00:00\t0821111111\tA\tCB0136\tTheo Chetty\t3005\tL1\t1200\tRenolan_Matrix_WC\tAnswering Machine',
  '2026-08-03 09:30:00\t0822222222\tSALE\tCB0136\tTheo Chetty\t3005\tL2\t600\tRenolan_Matrix_WC\tSale Insurance Opt-In',
].join('\n');
const cud = await page.evaluate(async fx => {
  const loaded = await window.__mtd.ingest('EXPORT_CALL_REPORT_20260803-120000.txt', fx.VICITXT);
  const v = window.__mtd.variance('2026-08-03', '2026-08-04');
  const t = v.rows.find(r => r.code === 'CB136' && r.d === '2026-08-03');
  return JSON.parse(JSON.stringify({ loaded: !!loaded, talk: t && t.talk, est: t && t.talkEst, dl: t && t.dlSales, flags: (t && t.flags) || [],
    vr16: v.checks.find(c => c.id === 'VR16') }));
}, { VICITXT });
ok('Cuddle day-level ViciDial ingests (zero-padded login resolves via Agent List)', cud.loaded, JSON.stringify(cud));
ok('Cuddle DV03 talk is KNOWN from day-level rows (1800s), not null', cud.talk === 1800, String(cud.talk));
ok('day-level rows beat the period-aggregate estimate (talkEst no longer shown)', cud.est == null, String(cud.est));
ok('Cuddle dialler sales counted from Sale dispositions (1)', cud.dl === 1, String(cud.dl));
ok('Cuddle DV03 activity checks RUN — no "estimated / coverage missing" info flag left', !cud.flags.some(f => f.sev === 'info'), JSON.stringify(cud.flags));
ok('VR16 passes once Cuddle has day-level dialler rows in the period', cud.vr16 && cud.vr16.ok === true, JSON.stringify(cud.vr16));

/* ---------- UI renders ---------- */
await page.evaluate(() => { window.__mtd.setRange('2026-08-03', '2026-08-04'); go('variance'); });
await page.waitForTimeout(1200);
const txt = await page.evaluate(() => document.getElementById('view')?.innerText || '');
ok('Variance page renders (Summary)', /Variance Report/.test(txt) && /Validation checks/.test(txt), txt.slice(0, 120));
await page.click('#view .chip:has-text("Daily")');   // the real chip, exactly as a user switches tabs
await page.waitForTimeout(1100);
const txt2 = await page.evaluate(() => [...document.querySelectorAll('#view table.data thead th')].map(h => h.textContent).join(' | ') + ' :: ' + (document.getElementById('view')?.innerText || '').slice(0, 400));
// Column layout per Nick 2026-08-17: board first, then SF, differences displayed as
// Board−SF (sign-flipped DV01/DV02) plus the informational Board−Dialler.
/* Renamed 2026-08-20 (Nick): "Total Dialer Sales" — the column merges BOTH diallers,
   ViciDial for Cuddle and CallX call recordings for Courtesy, so naming it VICCI misread
   Courtesy's source. */
ok('Daily Variance tab renders with variance columns', /total dialer sales/i.test(txt2) && /vas tracker/i.test(txt2) && /variance \(sf vs dialer\)/i.test(txt2) && txt2.split(' :: ')[0].toLowerCase().indexOf('talk time')<0, txt2.slice(0, 200));
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

/* ---------- the regrain itself, isolated -----------------------------------------------
   ONE account, ONE agent, ONE day, TWO cases. Account grain reports a single R198 sale;
   case grain reports two at R99. This is the whole point of the change, asserted on its own
   so it cannot pass by coincidence the way a combined fixture can. */
const multi = await page.evaluate(async () => {
  const HDR = 'Account Number,Case Number,Owner,Contract Create Date,Contract Deactivate Date,Charge Amount,Charge Code';
  const FX = [HDR,
    'M1,21000061,Jolene Chetty - Panimax,2026-08-04,,86.09,BERR99',
    'M1,21000062,Jolene Chetty - Panimax,2026-08-04,,86.09,BERR99',
  ].join('\n');
  await window.__mtd.ingest('Active multicase.xlsx', FX);
  const v = window.__mtd.variance('2026-08-04', '2026-08-04');
  const r = v.rows.find(x => x.code === 'CB19' && x.d === '2026-08-04');
  return JSON.parse(JSON.stringify({ sales: r && r.sfSales, gwp: r && r.sfGwp }));
});
ok('REGRAIN: one account with two cases on one agent-day = 2 sales, not 1 (account grain would merge them)',
  multi.sales === 2, JSON.stringify(multi));
ok('REGRAIN: total GWP is unchanged by the split — R198 either way (172.18 × 1.15)',
  multi.gwp === 198, JSON.stringify(multi));

/* ---------- the net-of-cancellation switch, both ways -----------------------------------
   Default is GROSS, which is what the reference workbook reconciles to (ER04/ER05). Flipping
   salesNetOfCancellation to true drops cancelled sales from the count — the rule that makes
   an agent's MTD read lower. Asserted in both positions and restored, so the switch is
   proven to work without changing what ships. */
const netSwitch = await page.evaluate(async fx => {
  const R = window.__mtd.rules();
  const shipped = R.salesNetOfCancellation;                     // whatever the build ships with
  const read = () => {
    const v = window.__mtd.variance('2026-08-03', '2026-08-04');
    const t = v.rows.find(x => x.code === 'CB136' && x.d === '2026-08-03');
    return [t.sfSales, t.sfGwp];
  };
  const set = async v => { R.salesNetOfCancellation = v;
    await window.__mtd.ingest('Active.xlsx', fx.ACTIVE); return read(); };  // re-ingest re-runs the gross-up
  const gross = await set(false);
  const net = await set(true);
  const back = await set(shipped);                              // restore the SHIPPED default, never a literal
  return JSON.parse(JSON.stringify({ gross, net, back, shipped }));
}, { ACTIVE });
ok('GROSS: the cancelled case returns as a whole sale — 3 sales, R225',
  netSwitch.gross.join() === '3,225', JSON.stringify(netSwitch.gross));
ok('NET: the cancelled case leaves both the count and the GWP — 2 sales, R214',
  netSwitch.net.join() === '2,214', JSON.stringify(netSwitch.net));
ok('the switch restores the shipped default cleanly — no state left behind',
  netSwitch.back.join() === (netSwitch.shipped ? '2,214' : '3,225'), JSON.stringify(netSwitch));

/* ---------- reversed cancellations: a save must leave the record --------------------------
   The Inactive export owns the deact-window it covers. A stored cancellation inside that
   window that is absent from a newer pull was REVERSED (customer saved) and must be removed;
   one outside the window must survive a narrow pull. Born from acct 10485558 (2026-08-18):
   reinstated in Salesforce, immortal in the store. */
const rev = await page.evaluate(async () => {
  const HDR = 'Account Number,Case Number,Owner,Contract Create Date,Contract Deactivate Date,Charge Amount,Charge Code,Contract Number';
  const S = window.__mtd.state();
  const count = () => Object.keys(S.cancRows).length;
  // two cancellations in one window + one in an older month
  await window.__mtd.ingest('Inactive rev1.xlsx', [HDR,
    'R1,21000071,Jolene Chetty - Panimax,2026-08-04,2026-08-10,86.09,BERR99,CT1',
    'R2,21000072,Jolene Chetty - Panimax,2026-08-05,2026-08-11,86.09,BERR99,CT2',
    'R3,21000073,Jolene Chetty - Panimax,2026-07-02,2026-07-06,86.09,BERR99,CT3',
  ].join('\n'));
  const afterFirst = count();
  // newer pull, SAME window (10–11 Aug): R2 is gone -> reversed; July row untouched (outside window)
  await window.__mtd.ingest('Inactive rev2.xlsx', [HDR,
    'R1,21000071,Jolene Chetty - Panimax,2026-08-04,2026-08-10,86.09,BERR99,CT1',
    'R4,21000074,Jolene Chetty - Panimax,2026-08-06,2026-08-11,86.09,BERR99,CT4',
  ].join('\n'));
  const afterRev = { n: count(), r2gone: !S.cancRows['R2|CT2|2026-08-11'], julySurvives: !!S.cancRows['R3|CT3|2026-07-06'] };
  // idempotent: same file again changes nothing
  await window.__mtd.ingest('Inactive rev2.xlsx', [HDR,
    'R1,21000071,Jolene Chetty - Panimax,2026-08-04,2026-08-10,86.09,BERR99,CT1',
    'R4,21000074,Jolene Chetty - Panimax,2026-08-06,2026-08-11,86.09,BERR99,CT4',
  ].join('\n'));
  const afterAgain = count();
  // cleanup so later sections are untouched
  for (const k of Object.keys(S.cancRows)) if (/^R\d\|/.test(k)) delete S.cancRows[k];
  grossUpSales();
  return { afterFirst, afterRev, afterAgain };
});
ok('a cancellation absent from a newer pull covering its window is REVERSED and removed',
  rev.afterRev.r2gone, JSON.stringify(rev.afterRev));
ok('a cancellation OUTSIDE the new pull\'s window survives (narrow pulls cannot wipe history)',
  rev.afterRev.julySurvives, JSON.stringify(rev.afterRev));
ok('re-uploading the same Inactive file changes nothing (idempotent)',
  rev.afterAgain === rev.afterRev.n, rev.afterAgain + ' vs ' + rev.afterRev.n);

/* ---------- an export that LOSES the Case Number column -----------------------------------
   A blank Case Number on a row is a recurring line and correctly counts no sale. A FILE with
   no Case Number column at all is a different animal: every row would look uncased and the
   day would report ZERO sales while still carrying its money — quiet, and shaped like real
   data. Salesforce has changed this export's columns before, so the shape is checked and the
   file falls back to the ACCOUNT grain with a loud warning rather than silently zeroing. */
const noCase = await page.evaluate(async () => {
  const OLD = ['Account Number,Owner,Contract Create Date,Contract Deactivate Date,Charge Amount,Charge Code',
    'NC1,Nothando Mntungwa - Panimax,2026-08-05,,86.96,R1',
    'NC2,Nothando Mntungwa - Panimax,2026-08-05,,86.96,R1'].join('\n');
  await window.__mtd.ingest('Active no-case-column.xlsx', OLD);
  const S = window.__mtd.state();
  const day = S.sales['2026-08-05'] || {};
  let rec = null; for (const ow in day) if (/nothando/i.test(ow)) rec = day[ow];
  const v = window.__mtd.variance('2026-08-05', '2026-08-05');
  const row = v.rows.find(r => r.code === 'CB162' && r.d === '2026-08-05');
  return { units: rec ? Object.keys(rec.a) : [], stamp: rec && rec.u, n: rec && rec.n,
    sfSales: row && row.sfSales, stale: staleGrainDays().includes('2026-08-05') };
});
ok('an export with NO Case Number column still counts its sales (falls back to account grain)',
  noCase.n === 2 && noCase.sfSales === 2, JSON.stringify(noCase));
ok('it is keyed on the account, not pooled into the uncased residual',
  noCase.units.length === 2 && !noCase.units.includes('~uncased'), JSON.stringify(noCase.units));
ok('the day is stamped account-grain so the stale-grain banner names it',
  noCase.stamp === 'account' && noCase.stale === true, JSON.stringify([noCase.stamp, noCase.stale]));

/* ---------- uncased rows: money without a sale ----------------------------------------
   Recurring feature lines carry no Case Number. They must add their charge to GWP and add
   NOTHING to the sale count — the rule that keeps GWP conserved by the regrain. */
const unc = await page.evaluate(async () => {
  const HDR = 'Account Number,Case Number,Owner,Contract Create Date,Contract Deactivate Date,Charge Amount,Charge Code';
  const FX = [HDR,
    'U1,21000051,Nothando Mntungwa - Panimax,2026-08-03,,86.96,R1',   // a real case → 1 sale, R100
    'U1,,Nothando Mntungwa - Panimax,2026-08-03,,8.70,POSITION',      // recurring, no case
    'U1,,Nothando Mntungwa - Panimax,2026-08-03,,8.69,TRIPSR10',      // recurring, no case
  ].join('\n');
  await window.__mtd.ingest('Active uncased.xlsx', FX);
  const v = window.__mtd.variance('2026-08-03', '2026-08-04');
  const r = v.rows.find(x => x.code === 'CB162' && x.d === '2026-08-03');
  return JSON.parse(JSON.stringify({ sales: r && r.sfSales, gwp: r && r.sfGwp }));
});
ok('uncased rows add GWP but never a sale (1 case = 1 sale; R17.39 of recurring lines still counted)',
  unc.sales === 1 && unc.gwp === Math.round((86.96 + 8.70 + 8.69) * 1.15), JSON.stringify(unc));

/* ---------- "no pull" marker — a coverage gap is named in the cell, never a bare dash ---------- */
const noPull = await page.evaluate(() => {
  const S = window.__mtd.state();
  delete S.calls['2026-08-03']['CB0136'];      // remove Theo's day-level rows…
  S.vici = {};                                  // …and the period aggregate: Cuddle now has NOTHING
  S.ui.varSub = 'daily'; renderPage();
  return new Promise(res => setTimeout(() => {
    const t = document.getElementById('view').innerText;
    res({ marker: /no pull/.test(t), note: /no day-level dialler rows for Cuddle/i.test(t) });
  }, 1100));
});
ok('Vicci cell shows "no pull" (not a dash) when a Cuddle agent-day has no dialler evidence', noPull.marker, JSON.stringify(noPull));
ok('day note names the Cuddle gap and the remedy', noPull.note, JSON.stringify(noPull));

/* ---------- rule-book drift vs the spec JSON ---------- */
const RULES = await page.evaluate(() => {
  const R = window.__mtd.varianceRules();
  return { version: R.version, vat: R.vat, salesTol: R.salesTolerance, gwpTol: R.gwpTolerance,
    talkSecs: R.talkNoSaleSecs, rcs: Object.keys(R.rootCauses), sheetRe: String(R.boardSheetRe),
    dvIds: R.comparisons.map(c => c.id), dcov: R.diallerCoverage,
    dvFormulaA: R.comparisons.find(c => c.id === 'DV01').formulaA,
    saleUnit: window.__mtd.rules().saleUnit,
    netOfCancellation: window.__mtd.rules().salesNetOfCancellation };
});
const MSPEC = JSON.parse(fs.readFileSync(path.join(REPO, 'specs', 'mtd_engine_rules.json'), 'utf8'));
const dv = Object.fromEntries(SPEC.daily_system_variance.comparisons.map(c => [c.id, c]));
ok('drift: version matches spec $schema_version', RULES.version === SPEC.$schema_version, RULES.version + ' vs ' + SPEC.$schema_version);
ok('drift: DV01 tolerance', RULES.salesTol === dv.DV01.tolerance, RULES.salesTol + ' vs ' + dv.DV01.tolerance);
ok('drift: DV02 tolerance (absolute)', RULES.gwpTol === dv.DV02.tolerance.absolute);
ok('drift: DV02 formula uses ×1.15 (VAT-inclusive)', RULES.vat === 1.15 && /1\.15/.test(dv.DV02.system_a.calc));
ok('drift: DV03 2-hour threshold', RULES.talkSecs === 7200 && /2 hours/.test(dv.DV03.flags[1].condition));
ok('drift: all four DV comparisons implemented', ['DV01', 'DV02', 'DV03', 'DV04'].every(id => RULES.dvIds.includes(id)), RULES.dvIds.join(','));
ok('drift: RC taxonomy complete RC1–RC7', SPEC.root_cause_taxonomy.classes.every(c => RULES.rcs.includes(c.code)), RULES.rcs.join(','));
ok('drift: board sheet grain DD.MM per day', /d\{1,2\}/.test(RULES.sheetRe) && /DD\.MM/.test(SPEC.required_files.missing_blocking[0].sheets));
ok('drift: dialler_coverage campaigns match the spec (VR16 contract)',
  SPEC.dialler_coverage && RULES.dcov && RULES.dcov.campaigns
  && Object.keys(SPEC.dialler_coverage.campaigns).sort().join() === Object.keys(RULES.dcov.campaigns).sort().join()
  && JSON.stringify(SPEC.dialler_coverage.campaigns.Cuddle.user_groups) === JSON.stringify(RULES.dcov.campaigns.Cuddle.groups)
  && SPEC.dialler_coverage.min_day_share === RULES.dcov.minDayShare,
  JSON.stringify([SPEC.dialler_coverage && Object.keys(SPEC.dialler_coverage.campaigns), RULES.dcov && Object.keys(RULES.dcov.campaigns || {}), SPEC.dialler_coverage && SPEC.dialler_coverage.min_day_share, RULES.dcov && RULES.dcov.minDayShare]));
ok('drift: VR16 present in spec validation_checks (severity error)',
  SPEC.validation_checks.some(c => c.id === 'VR16' && c.severity === 'error'));
ok('drift: DV01 counts DISTINCT Case Number in both copies',
  /DISTINCT Case Number/i.test(SPEC.daily_system_variance.comparisons.find(c => c.id === 'DV01').system_a.calc)
  && /DISTINCT Case Number/i.test(RULES.dvFormulaA), RULES.dvFormulaA);
ok('drift: variance spec records the case sale-unit, and its cancellation setting matches the engine',
  SPEC.sale_unit && SPEC.sale_unit.unit === 'Case Number'
  && SPEC.sale_unit.net_of_cancellation === RULES.netOfCancellation,
  JSON.stringify([SPEC.sale_unit && SPEC.sale_unit.net_of_cancellation, RULES.netOfCancellation]));
ok('drift: MTD rule book agrees on the unit and the net rule',
  MSPEC.money_model_unit && MSPEC.money_model_unit.unit === RULES.saleUnit
  && MSPEC.money_model_unit.net_of_cancellation === RULES.netOfCancellation,
  JSON.stringify([MSPEC.money_model_unit && MSPEC.money_model_unit.unit, RULES.saleUnit,
    MSPEC.money_model_unit && MSPEC.money_model_unit.net_of_cancellation, RULES.netOfCancellation]));

ok('no page errors across the whole run', errors.length === 0, errors.slice(0, 4).join(' | '));

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
failures.forEach(f => console.log('FAIL: ' + f));
await browser.close(); server.close();
process.exit(fail || errors.length ? 1 : 0);
