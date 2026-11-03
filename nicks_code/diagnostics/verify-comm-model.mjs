/* verify-comm-model.mjs — the commission model is the WORKBOOK, month by month (2026-10-01; November + Motor Warranty 2026-11-03).
 *
 * Nick's monthly "Matrix Vas Comm Model_<Month>.xlsx" (and, from November, "Motor Warranty Comm Model_<Month>.xlsx") is the
 * record. PULSE publishes it to the agent page as COMM_RULES (the current month) and COMM_RULES_BY_MONTH (each past month
 * pinned to the model that was in force — a new workbook must never re-price a month already paid). This suite opens the
 * workbooks themselves (reference/docs/) and proves, for every plan and every row:
 *   1 the published bracket = the workbook's ex-VAT premium (VAS) / Net Premium Collected (Motor Warranty) and "Comm", to the cent
 *   2 the plan has exactly the workbook's number of rows
 *   3 November (current) → COMM_RULES; October → COMM_RULES_2026_10, pinned for September AND October (September has ridden
 *     the October model since its own was retired on 2026-10-01); July/August keep August's
 *   4 the dialling days the thresholds were built on match the workbook's DD (November = 20: 4 Nov is the elections holiday)
 *   5 per-plan sale values: Download / Upsell R40 ÷ 1.15; Motor Warranty FTC% × R425 per gross sale; and the R425 floor
 *
 * Its workbook readers are its OWN (not tools/gen-comm-model.mjs's) so a generator bug cannot pass its own check.
 * Run: node verify-comm-model.mjs   (no network)
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const DOCS = path.join(ROOT, '..', 'reference', 'docs');
const XLSX = createRequire(import.meta.url)('xlsx');

let pass = 0, fail = 0;
const ok = (name, cond, note) => { if (cond) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (note ? ' — ' + note : '')); } };
const cents = (x) => Math.round(x * 100) / 100;

/* sheet title → plan key (the five "Matrix VAS" sheets) */
const PLAN_OF = (title) => /download|upsell/i.test(title) ? 'EXP_DOWNUP'
  : /cuddle/i.test(title) ? 'EXP_CUDDLE'
  : /exp/i.test(title) ? 'EXP_COURTESY'
  : /m2|month 2/i.test(title) ? 'M2'
  : /m1|month 1/i.test(title) ? 'M1' : null;
/* sheet name → plan key (the three Motor Warranty sheets: MOW_Month 1 / MOW_Month 2 / MOW_Exp) */
const MOW_OF = (name) => /exp/i.test(name) ? 'MOW_EXP' : /month 2/i.test(name) ? 'MOW_M2' : /month 1/i.test(name) ? 'MOW_M1' : null;

const rowsOf = (wb, s) => XLSX.utils.sheet_to_json(wb.Sheets[s], { header: 1, blankrows: false, raw: true })
  .map((r) => r.filter((c) => c !== '' && c != null)).filter((r) => r.length);

function readModel(file) {
  const wb = XLSX.readFile(path.join(DOCS, file));
  const out = { plans: {}, dd: {}, avg: {} };
  for (const s of wb.SheetNames) {
    const rows = rowsOf(wb, s);
    const plan = PLAN_OF(String(rows[0] && rows[0][0]) + ' ' + s);
    if (!plan) continue;
    out.dd[plan] = (rows.find((r) => r[0] === 'DD') || [])[1];
    out.avg[plan] = (rows.find((r) => r[0] === 'Average Premium') || [])[1];
    out.plans[plan] = rows.filter((r) => typeof r[0] === 'number' && r.length >= 4)
      .map((r) => ({ spd: r[0], gwp: cents(r[2]), comm: cents(r[3]) }));
  }
  return out;
}

/* Motor Warranty: SPD | Gross Sales | Collected Policies | Net Premium Collected | Comm — gwp is Net Premium Collected */
function readMotorWarranty(file) {
  const wb = XLSX.readFile(path.join(DOCS, file));
  const out = { plans: {}, dd: {}, ftc: {}, perPolicy: {}, rule: {} };
  for (const s of wb.SheetNames) {
    const plan = MOW_OF(s); if (!plan) continue;
    const rows = rowsOf(wb, s);
    const ddRow = rows.find((r) => r[0] === 'DD') || [];
    out.dd[plan] = ddRow[1];
    out.rule[plan] = ddRow.slice(2).join(' ');                 // the rule sentence sits on the DD row
    out.ftc[plan] = (rows.find((r) => r[0] === 'FTC%') || [])[1];
    const brk = rows.filter((r) => typeof r[0] === 'number' && r.length >= 5);
    out.plans[plan] = brk.map((r) => ({ spd: r[0], gross: r[1], gwp: cents(r[3]), comm: cents(r[4]) }));
    out.perPolicy[plan] = brk.length ? brk[0][3] / brk[0][2] : null;
  }
  return out;
}

/* the PULSE objects, evaluated straight out of the page source */
const PULSE = fs.readFileSync(path.join(ROOT, 'nicks_code', 'index.html'), 'utf8');
function objAfter(marker) {
  const i = PULSE.indexOf(marker); if (i < 0) return null;
  const open = PULSE.indexOf('{', i); let d = 0, end = -1;
  for (let j = open; j < PULSE.length; j++) { if (PULSE[j] === '{') d++; else if (PULSE[j] === '}') { d--; if (d === 0) { end = j; break; } } }
  return PULSE.slice(open, end + 1);
}
// eslint-disable-next-line no-eval
const evalObj = (marker) => { const src = objAfter(marker); return src ? eval('(' + src + ')') : null; };
const CURRENT = evalObj('const COMM_RULES=');
const OCT = evalObj('const COMM_RULES_2026_10=');
const AUG = evalObj('const COMM_RULES_2026_08=');
const SEPT_SRC = objAfter('const COMM_RULES_2026_09=');
const BY_MONTH_SRC = (PULSE.match(/const COMM_RULES_BY_MONTH=\{([^}]*)\}/) || [])[1] || '';
// eslint-disable-next-line no-new-func
const BY = new Function('COMM_RULES_2026_08', 'COMM_RULES_2026_10', 'return {' + BY_MONTH_SRC + '};')(AUG, OCT);
const modelFor = (month) => BY[month] || CURRENT;

function compare(label, wbModel, published) {
  for (const plan of Object.keys(wbModel.plans)) {
    const want = wbModel.plans[plan], got = (published && published.brackets && published.brackets[plan]) || [];
    ok(label + ' ' + plan + ': ' + want.length + ' brackets, as the workbook', got.length === want.length, got.length + ' vs ' + want.length);
    const bad = want.filter((w, i) => !got[i] || Math.abs(got[i].gwp - w.gwp) > 0.005 || Math.abs(got[i].comm - w.comm) > 0.005)
      .map((w) => 'SPD ' + w.spd + ': want ' + w.gwp + '/' + w.comm);
    ok(label + ' ' + plan + ': every row to the cent', !bad.length, bad.slice(0, 3).join('; '));
  }
}

console.log('\n1–2 · a month keeps its own model — October pinned for September and October (2026-11-03)');
ok('no COMM_RULES_2026_09 object is left in PULSE (September\'s own model stays retired)', !SEPT_SRC);
ok('COMM_RULES_2026_10 exists and is the October model', OCT && OCT.version === '2026-10' && OCT.dd === 22, OCT && OCT.version);
ok('July and August still keep August\'s model', modelFor('2026-07') === AUG && modelFor('2026-08') === AUG && AUG.version === '2026-08', BY_MONTH_SRC);
ok('a September period resolves to the October model (as it has since 2026-10-01)', modelFor('2026-09').version === '2026-10');
ok('an October period resolves to the October model — November never re-prices it', modelFor('2026-10').version === '2026-10');
ok('a November period resolves to the current (November) model', modelFor('2026-11') === CURRENT);
compare('Oct (pinned)', readModel('Matrix Vas Comm Model_October26.xlsx'), OCT);

console.log('\n3 · November (Matrix Vas + Motor Warranty Comm Model_November26.xlsx) is the current model');
const nov = readModel('Matrix Vas Comm Model_November26.xlsx');
const mow = readMotorWarranty('Motor Warranty Comm Model_November26.xlsx');
ok('COMM_RULES is the November model', CURRENT && CURRENT.version === '2026-11', CURRENT && CURRENT.version);
compare('Nov', nov, CURRENT);
ok('the Motor Warranty workbook has its three plans (Month 1, Month 2, Exp)', ['MOW_M1', 'MOW_M2', 'MOW_EXP'].every((p) => (mow.plans[p] || []).length), Object.keys(mow.plans).join(','));
compare('Nov Motor Warranty', mow, CURRENT);
/* SPOT CELLS BY COORDINATE (review 2026-11-03): the row readers above share the generator's column choices, so a
   systematic misread (a wrong column) would pass both. These cells are read by ADDRESS, not by the row logic. */
{
  const cell = (file, sheet, addr) => { const ws = XLSX.readFile(path.join(DOCS, file)).Sheets[sheet]; return ws && ws[addr] ? ws[addr].v : undefined; };
  const V = 'Matrix Vas Comm Model_November26.xlsx', M = 'Motor Warranty Comm Model_November26.xlsx';
  const spots = [
    ['VAS M1 Courtesy row 6 (SPD 3)', cell(V, 'MatrixVAS Nov26_ M1 Courtesy', 'C6'), cell(V, 'MatrixVAS Nov26_ M1 Courtesy', 'D6'), CURRENT.brackets.M1[0]],
    ['VAS Exp Cuddle row 15 (SPD 15)', cell(V, 'MatrixVAS Nov26_ Exp Cuddle', 'C15'), cell(V, 'MatrixVAS Nov26_ Exp Cuddle', 'D15'), CURRENT.brackets.EXP_CUDDLE[9]],
    ['Motor Warranty Month 1 row 7 (SPD 1.5)', cell(M, 'MOW_Month 1', 'D7'), cell(M, 'MOW_Month 1', 'E7'), CURRENT.brackets.MOW_M1[1]],
    ['Motor Warranty Exp row 13 (SPD 5)', cell(M, 'MOW_Exp', 'D13'), cell(M, 'MOW_Exp', 'E13'), CURRENT.brackets.MOW_EXP[7]],
  ];
  for (const [label, gwp, comm, pub] of spots)
    ok('spot cell — ' + label + ': ' + cents(gwp) + ' / ' + cents(comm), typeof gwp === 'number' && typeof comm === 'number' && pub
      && Math.abs(pub.gwp - cents(gwp)) < 0.005 && Math.abs(pub.comm - cents(comm)) < 0.005, JSON.stringify(pub));
}

console.log('\n4 · dialling days');
ok('November VAS sheets are built on 20 dialling days', Object.values(nov.dd).every((d) => d === 20), JSON.stringify(nov.dd));
ok('November Motor Warranty sheets are built on 20 dialling days', Object.values(mow.dd).every((d) => d === 20), JSON.stringify(mow.dd));
ok('every Motor Warranty bracket\'s gross sales = SPD × 20', Object.values(mow.plans).every((l) => l.every((b) => Math.abs(b.gross - b.spd * 20) < 1e-9)));
ok('COMM_RULES records its dialling days (20)', CURRENT && CURRENT.dd === 20, CURRENT && CURRENT.dd);
ok('4 Nov 2026 (elections) is in MTD_RULES.extraHolidays — November\'s 21 weekdays less one = 20', /extraHolidays:\s*\[[^\]]*'2026-11-04'/.test(PULSE));

console.log('\n5 · sale values and the R425 rule');
ok('R89 plans: saleValue = 89 ÷ 1.15', CURRENT && Math.abs(CURRENT.saleValue - 89 / 1.15) < 1e-9 && nov.avg.M1 === 89);
ok('Download / Upsell: 40 ÷ 1.15, as its sheet', CURRENT && CURRENT.saleValues && Math.abs(CURRENT.saleValues.EXP_DOWNUP - nov.avg.EXP_DOWNUP / 1.15) < 1e-9, JSON.stringify(nov.avg));
for (const p of ['MOW_M1', 'MOW_M2', 'MOW_EXP']) {
  const want = mow.ftc[p] * mow.perPolicy[p];
  ok(p + ': one gross sale = FTC ' + mow.ftc[p] + ' × R' + mow.perPolicy[p] + ' = R' + want + ' of net premium', CURRENT.saleValues && Math.abs(CURRENT.saleValues[p] - want) < 1e-9, CURRENT.saleValues && CURRENT.saleValues[p]);
  const f = CURRENT.premiumFloor && CURRENT.premiumFloor[p];
  const m = /under\s*R\s*([\d.]+)\D+([\d.]+)\s*%/i.exec(mow.rule[p] || '');
  ok(p + ': premiumFloor matches the sheet\'s rule ("' + (mow.rule[p] || '').trim().slice(0, 60) + '") as a 20% deduction',
    !!f && !!m && f.under === parseFloat(m[1]) && Math.abs(f.keep - (1 - parseFloat(m[2]) / 100)) < 1e-9, JSON.stringify(f));
}
ok('no VAS plan carries a premium floor', !Object.keys(CURRENT.premiumFloor || {}).some((k) => !k.startsWith('MOW_')));

console.log('\n6 · commNow — the calculator is for the NEW month while the digest is still the closed one (2026-10-01)');
{
  const fm = PULSE.match(/function commNowFor\([^)]*\)\{[\s\S]*?\n\}/);
  ok('PULSE carries commNowFor(periodFrom, nowMs)', !!fm);
  ok('agentDigestPayload publishes commNow through it', /commNow\s*:\s*[^,\n]*commNowFor\(|\.\.\.\s*\(?\s*commNowFor\(|commNowFor\([^)]*\)[\s\S]{0,80}commNow/.test(PULSE));
  if (fm) {
    // eslint-disable-next-line no-new-func
    const commNowFor = new Function('COMM_RULES', 'COMM_RULES_BY_MONTH', fm[0] + '\nreturn commNowFor;')(CURRENT, BY);
    const NOV2 = Date.parse('2026-11-02T08:00:00Z'), OCT1 = Date.parse('2026-10-01T06:00:00Z'), OCT20 = Date.parse('2026-10-20T10:00:00Z');
    const a = commNowFor('2026-10-01', NOV2);
    ok('an October period built in November carries commNow for 2026-11', a && a.month === '2026-11', JSON.stringify(a && a.month));
    ok('…with the November model (version 2026-11, 20 dialling days, Motor Warranty included)', a && a.version === '2026-11' && a.dd === 20 && a.brackets && a.brackets.MOW_EXP && a.brackets.MOW_EXP.length === CURRENT.brackets.MOW_EXP.length, a && a.version);
    ok('a September period built in October carries the PINNED October model', (commNowFor('2026-09-01', OCT1) || {}).version === '2026-10');
    ok('a November period built in November carries NO commNow (normal months stay byte-identical)', commNowFor('2026-11-01', NOV2) === undefined);
    ok('an October period built in October carries none', commNowFor('2026-10-01', OCT20) === undefined);
    ok('the month is SAST, not UTC (23:30 UTC on 31 Oct is already 1 Nov)', (commNowFor('2026-10-01', Date.parse('2026-10-31T23:30:00Z')) || {}).month === '2026-11');
  }
}

console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
process.exitCode = fail ? 1 : 0;
