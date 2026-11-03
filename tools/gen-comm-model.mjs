#!/usr/bin/env node
/**
 * gen-comm-model.mjs — a month's commission brackets, generated FROM the workbooks (never retyped).
 *
 *   node tools/gen-comm-model.mjs November26          # reads reference/docs/*_November26.xlsx
 *
 * Prints the bracket tables in the two shapes they are pasted into:
 *   · PULSE   nicks_code/index.html  COMM_RULES.brackets   ({gwp,comm} — 4 to a line)
 *   · the app agent/reference/original-index.tsx BRACKETS (one bracket a line, SPD noted) — the SAME file is the
 *             Vercel calculator's src/routes/index.tsx (spec 040)
 * and the facts the code records beside them (dialling days, average premiums, Motor Warranty FTC%).
 *
 * Matrix VAS sheet:      SPD | Total Premium | Total Premium ex vat | Comm        → gwp = ex-VAT premium
 * Motor Warranty sheet:  SPD | Gross Sales | Collected Policies | Net Premium Collected | Comm
 *                        → gwp = Net Premium Collected (collected × R425; the sheet adds no VAT), so one gross sale
 *                          is worth FTC% × 425 and pro-rata on premium is pro-rata on sales (spec 040 §3).
 * nicks_code/diagnostics/verify-comm-model.mjs re-reads the same workbooks and fails on any cent of drift.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = path.join(ROOT, '..', 'reference', 'docs');
const XLSX = createRequire(path.join(ROOT, 'nicks_code', 'diagnostics', 'package.json'))('xlsx');
const cents = (x) => Math.round(x * 100) / 100;

const VAS_PLAN = (t) => /download|upsell/i.test(t) ? 'EXP_DOWNUP' : /cuddle/i.test(t) ? 'EXP_CUDDLE'
  : /exp/i.test(t) ? 'EXP_COURTESY' : /m2|month 2/i.test(t) ? 'M2' : /m1|month 1/i.test(t) ? 'M1' : null;
const MOW_PLAN = (t) => /exp/i.test(t) ? 'MOW_EXP' : /month 2/i.test(t) ? 'MOW_M2' : /month 1/i.test(t) ? 'MOW_M1' : null;

const sheetRows = (wb, s) => XLSX.utils.sheet_to_json(wb.Sheets[s], { header: 1, blankrows: false, raw: true })
  .map((r) => r.filter((c) => c !== '' && c != null)).filter((r) => r.length);
const fact = (rows, label) => (rows.find((r) => r[0] === label) || [])[1];

export function readVas(file) {
  const wb = XLSX.readFile(file), out = { plans: {}, dd: {}, avg: {} };
  for (const s of wb.SheetNames) {
    const rows = sheetRows(wb, s), plan = VAS_PLAN(String(rows[0] && rows[0][0]) + ' ' + s);
    if (!plan) continue;
    out.dd[plan] = fact(rows, 'DD'); out.avg[plan] = fact(rows, 'Average Premium');
    out.plans[plan] = rows.filter((r) => typeof r[0] === 'number' && r.length >= 4)
      .map((r) => ({ spd: r[0], gwp: cents(r[2]), comm: cents(r[3]) }));
  }
  return out;
}

export function readMotorWarranty(file) {
  const wb = XLSX.readFile(file), out = { plans: {}, dd: {}, ftc: {}, premium: {} };
  for (const s of wb.SheetNames) {
    const plan = MOW_PLAN(s); if (!plan) continue;
    const rows = sheetRows(wb, s);
    out.dd[plan] = fact(rows, 'DD'); out.ftc[plan] = fact(rows, 'FTC%');
    const brk = rows.filter((r) => typeof r[0] === 'number' && r.length >= 5);
    out.plans[plan] = brk.map((r) => ({ spd: r[0], gross: r[1], gwp: cents(r[3]), comm: cents(r[4]) }));
    out.premium[plan] = brk.length ? cents(brk[0][3] / brk[0][2]) : null;   // net premium ÷ collected policies = R425
  }
  return out;
}

const pulseLines = (key, list) => {
  const cells = list.map((b) => `{gwp:${b.gwp},comm:${b.comm}}`), lines = [];
  for (let i = 0; i < cells.length; i += 4) lines.push(cells.slice(i, i + 4).join(','));
  return `    ${key}:[${lines.join(',\n        ')}]`;
};
const tsxBlock = (key, list) => `  ${key}: [\n` + list.map((b) => `    { gwp: ${b.gwp}, comm: ${b.comm} }, // SPD ${b.spd}`).join('\n') + '\n  ],';

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const tag = process.argv[2];
  if (!tag) { console.error('usage: node tools/gen-comm-model.mjs <MonthYY, e.g. November26>'); process.exit(2); }
  const vasFile = path.join(DOCS, `Matrix Vas Comm Model_${tag}.xlsx`);
  const mowFile = path.join(DOCS, `Motor Warranty Comm Model_${tag}.xlsx`);
  if (!fs.existsSync(vasFile)) { console.error('not found: ' + vasFile); process.exit(1); }
  const vas = readVas(vasFile), mow = fs.existsSync(mowFile) ? readMotorWarranty(mowFile) : null;
  const ORDER = ['EXP_DOWNUP', 'M1', 'M2', 'EXP_COURTESY', 'EXP_CUDDLE'];
  console.log('// facts — VAS dialling days ' + JSON.stringify(vas.dd) + ', average premiums ' + JSON.stringify(vas.avg));
  if (mow) console.log('// facts — Motor Warranty dialling days ' + JSON.stringify(mow.dd) + ', FTC% ' + JSON.stringify(mow.ftc) + ', premium per collected policy ' + JSON.stringify(mow.premium));
  const all = [...ORDER.filter((k) => vas.plans[k]).map((k) => [k, vas.plans[k]]), ...(mow ? Object.entries(mow.plans) : [])];
  console.log('\n// ---- PULSE COMM_RULES.brackets ----');
  console.log(all.map(([k, l]) => pulseLines(k, l)).join(',\n'));
  console.log('\n// ---- app BRACKETS ----');
  console.log(all.map(([k, l]) => tsxBlock(k, l)).join('\n'));
}
