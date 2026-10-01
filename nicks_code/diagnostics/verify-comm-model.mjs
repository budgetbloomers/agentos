/* verify-comm-model.mjs — the commission model is the WORKBOOK, month by month (2026-10-01).
 *
 * Nick's monthly "Matrix Vas Comm Model_<Month>.xlsx" is the record. PULSE publishes it to the agent page
 * as COMM_RULES (the current month) and COMM_RULES_BY_MONTH (each past month pinned to the model that
 * was in force — a new workbook must never re-price a month already paid). This suite opens the workbooks
 * themselves (reference/docs/) and proves, for every plan and every row:
 *   1 the published bracket = the workbook's "Total Premium ex vat" and "Comm", to the cent
 *   2 the plan has exactly the workbook's number of rows
 *   3 each month is published under its own workbook: September → COMM_RULES_BY_MONTH['2026-09'],
 *     October (current) → COMM_RULES
 *   4 the dialling days the thresholds were built on match the workbook's DD
 *   5 the per-plan sale value (Download / Upsell R40 ÷ 1.15) matches its sheet's average premium
 *
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

function readModel(file) {
  const wb = XLSX.readFile(path.join(DOCS, file));
  const out = { plans: {}, dd: {}, avg: {} };
  for (const s of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[s], { header: 1, blankrows: false, raw: true })
      .map((r) => r.filter((c) => c !== '' && c != null)).filter((r) => r.length);
    const plan = PLAN_OF(String(rows[0] && rows[0][0]) + ' ' + s);
    if (!plan) continue;
    out.dd[plan] = (rows.find((r) => r[0] === 'DD') || [])[1];
    out.avg[plan] = (rows.find((r) => r[0] === 'Average Premium') || [])[1];
    out.plans[plan] = rows.filter((r) => typeof r[0] === 'number' && r.length >= 4)
      .map((r) => ({ spd: r[0], gwp: cents(r[2]), comm: cents(r[3]) }));
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
const CURRENT = eval('(' + objAfter('const COMM_RULES=') + ')');
const SEPT_SRC = objAfter('const COMM_RULES_2026_09=');
// eslint-disable-next-line no-eval
const SEPT = SEPT_SRC ? eval('(' + SEPT_SRC + ')') : null;
const BY_MONTH_SRC = (PULSE.match(/const COMM_RULES_BY_MONTH=\{([^}]*)\}/) || [])[1] || '';

function compare(label, wbModel, published) {
  for (const plan of Object.keys(wbModel.plans)) {
    const want = wbModel.plans[plan], got = (published && published.brackets && published.brackets[plan]) || [];
    ok(label + ' ' + plan + ': ' + want.length + ' brackets, as the workbook', got.length === want.length, got.length + ' vs ' + want.length);
    const bad = want.filter((w, i) => !got[i] || Math.abs(got[i].gwp - w.gwp) > 0.005 || Math.abs(got[i].comm - w.comm) > 0.005)
      .map((w) => 'SPD ' + w.spd + ': want ' + w.gwp + '/' + w.comm);
    ok(label + ' ' + plan + ': every row to the cent', !bad.length, bad.slice(0, 3).join('; '));
  }
}

console.log('\n1–2 · September (Matrix Vas Comm Model_September26.xlsx) is pinned to September');
const sep = readModel('Matrix Vas Comm Model_September26.xlsx');
ok('the September model is kept as COMM_RULES_2026_09', !!SEPT && SEPT.version === '2026-09', SEPT && SEPT.version);
ok('COMM_RULES_BY_MONTH pins 2026-09 to it', /'2026-09'\s*:\s*COMM_RULES_2026_09/.test(BY_MONTH_SRC), BY_MONTH_SRC);
compare('Sept', sep, SEPT);

console.log('\n3 · October (Matrix Vas Comm Model_October26.xlsx) is the current model');
const oct = readModel('Matrix Vas Comm Model_October26.xlsx');
ok('COMM_RULES is the October model', CURRENT && CURRENT.version === '2026-10', CURRENT && CURRENT.version);
compare('Oct', oct, CURRENT);

console.log('\n4 · dialling days');
ok('October sheets are built on 22 dialling days', Object.values(oct.dd).every((d) => d === 22), JSON.stringify(oct.dd));
ok('September sheets on 21', Object.values(sep.dd).every((d) => d === 21), JSON.stringify(sep.dd));
ok('COMM_RULES records its dialling days', CURRENT && CURRENT.dd === 22, CURRENT && CURRENT.dd);

console.log('\n5 · sale values');
ok('R89 plans: saleValue = 89 ÷ 1.15', CURRENT && Math.abs(CURRENT.saleValue - 89 / 1.15) < 1e-9 && oct.avg.M1 === 89);
ok('Download / Upsell: 40 ÷ 1.15, as its sheet', CURRENT && CURRENT.saleValues && Math.abs(CURRENT.saleValues.EXP_DOWNUP - oct.avg.EXP_DOWNUP / 1.15) < 1e-9, JSON.stringify(oct.avg));

console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
process.exitCode = fail ? 1 : 0;
