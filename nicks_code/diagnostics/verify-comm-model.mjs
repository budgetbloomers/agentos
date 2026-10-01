/* verify-comm-model.mjs — the commission model is the WORKBOOK, month by month (2026-10-01).
 *
 * Nick's monthly "Matrix Vas Comm Model_<Month>.xlsx" is the record. PULSE publishes it to the agent page
 * as COMM_RULES (the current month) and COMM_RULES_BY_MONTH (each past month pinned to the model that
 * was in force — a new workbook must never re-price a month already paid). This suite opens the workbooks
 * themselves (reference/docs/) and proves, for every plan and every row:
 *   1 the published bracket = the workbook's "Total Premium ex vat" and "Comm", to the cent
 *   2 the plan has exactly the workbook's number of rows
 *   3 October (current) → COMM_RULES; September's model was RETIRED on 2026-10-01 ("we just removing
 *     september commission model and updating to october now"), so September rides COMM_RULES too
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

console.log('\n1–2 · September\'s model is RETIRED — September rides the October model (2026-10-01)');
ok('no COMM_RULES_2026_09 object is left in PULSE', !SEPT_SRC);
ok('COMM_RULES_BY_MONTH has no 2026-09 entry (so a September digest publishes COMM_RULES)', !/'2026-09'\s*:/.test(BY_MONTH_SRC), BY_MONTH_SRC);
ok('July and August still keep August\'s model', /'2026-07'\s*:\s*COMM_RULES_2026_08/.test(BY_MONTH_SRC) && /'2026-08'\s*:\s*COMM_RULES_2026_08/.test(BY_MONTH_SRC), BY_MONTH_SRC);
{
  // eslint-disable-next-line no-new-func
  const BY = new Function('COMM_RULES_2026_08', 'return {' + BY_MONTH_SRC + '};')({ version: '2026-08' });
  ok('a September period\'s comm resolves to the October model', (BY['2026-09'] || CURRENT).version === '2026-10');
}

console.log('\n3 · October (Matrix Vas Comm Model_October26.xlsx) is the current model');
const oct = readModel('Matrix Vas Comm Model_October26.xlsx');
ok('COMM_RULES is the October model', CURRENT && CURRENT.version === '2026-10', CURRENT && CURRENT.version);
compare('Oct', oct, CURRENT);

console.log('\n4 · dialling days');
ok('October sheets are built on 22 dialling days', Object.values(oct.dd).every((d) => d === 22), JSON.stringify(oct.dd));
ok('COMM_RULES records its dialling days', CURRENT && CURRENT.dd === 22, CURRENT && CURRENT.dd);

console.log('\n5 · sale values');
ok('R89 plans: saleValue = 89 ÷ 1.15', CURRENT && Math.abs(CURRENT.saleValue - 89 / 1.15) < 1e-9 && oct.avg.M1 === 89);
ok('Download / Upsell: 40 ÷ 1.15, as its sheet', CURRENT && CURRENT.saleValues && Math.abs(CURRENT.saleValues.EXP_DOWNUP - oct.avg.EXP_DOWNUP / 1.15) < 1e-9, JSON.stringify(oct.avg));

console.log('\n6 · commNow — the calculator is for the NEW month while the digest is still the closed one (2026-10-01)');
{
  const fm = PULSE.match(/function commNowFor\([^)]*\)\{[\s\S]*?\n\}/);
  ok('PULSE carries commNowFor(periodFrom, nowMs)', !!fm);
  ok('agentDigestPayload publishes commNow through it', /commNow\s*:\s*[^,\n]*commNowFor\(|\.\.\.\s*\(?\s*commNowFor\(|commNowFor\([^)]*\)[\s\S]{0,80}commNow/.test(PULSE));
  if (fm) {
    // eslint-disable-next-line no-new-func
    const commNowFor = new Function('COMM_RULES', 'COMM_RULES_BY_MONTH', fm[0] + '\nreturn commNowFor;')(CURRENT, {});
    const OCT1 = Date.parse('2026-10-01T06:00:00Z'), SEP20 = Date.parse('2026-09-20T10:00:00Z');
    const a = commNowFor('2026-09-01', OCT1);
    ok('a September period built in October carries commNow for 2026-10', a && a.month === '2026-10', JSON.stringify(a && a.month));
    ok('…with the October model (version 2026-10, 22 dialling days, the whole bracket table)', a && a.version === '2026-10' && a.dd === 22 && a.brackets && a.brackets.EXP_CUDDLE.length === CURRENT.brackets.EXP_CUDDLE.length, a && a.version);
    ok('an October period built in October carries NO commNow (normal months stay byte-identical)', commNowFor('2026-10-01', OCT1) === undefined);
    ok('a September period built in September carries none', commNowFor('2026-09-01', SEP20) === undefined);
    ok('the month is SAST, not UTC (23:30 UTC on 30 Sep is already 1 Oct)', (commNowFor('2026-09-01', Date.parse('2026-09-30T23:30:00Z')) || {}).month === '2026-10');
    ok('a month with a pinned model publishes the pinned one (November has none → the current model)', (commNowFor('2026-10-01', Date.parse('2026-11-02T08:00:00Z')) || {}).version === '2026-10');
  }
}

console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
process.exitCode = fail ? 1 : 0;
