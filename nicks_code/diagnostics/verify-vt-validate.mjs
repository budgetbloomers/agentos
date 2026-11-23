#!/usr/bin/env node
/**
 * verify-vt-validate.mjs — the Upload Station validator knows the three Vehicle Tracking files (spec 071, F2).
 *
 *   node nicks_code/diagnostics/verify-vt-validate.mjs
 *
 *   V1  tools/vt-validate.mjs recognises BI Active Fitted / Scheduled & Missed / the opening book with the ENGINE's detection
 *       (a VAS Power BI file is never VT); extract date from the name; thin pull; one-of-two; duplicate extract date
 *   V2  the Agent List's VT sheet: Target vs the business month's Sales Review SPD budget (warn on mismatch), Scheduling "-"
 *       expected, a rated agent with no Target flagged, the budget fallback named
 *   V3  tools/upload-station-validate.mjs wires it, and the stale "the VT sheet has no Target column" finding is gone
 * Fictional data only (CB91xx). No network.
 */
import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { biFile, smFile, openFile, vasBiFile } from './vt-fixtures.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url)); const ROOT = path.resolve(HERE, '..', '..');
const V = await import(pathToFileURL(path.join(ROOT, 'tools', 'vt-validate.mjs')).href);
let pass = 0, fail = 0; const failures = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; failures.push(n + (d ? ' — ' + String(d).slice(0, 300) : '')); console.log('  FAIL ' + n + (d ? ' — ' + String(d).slice(0, 300) : '')); } };
const head = (t) => console.log('\n' + t);
const lines = (n, base = 91000000) => Array.from({ length: n }, (_, i) => ({ cn: base + i }));
const sev = (r, s, re) => r.findings.some((x) => x.sev === s && re.test(x.msg));

head('V1 · the files');
{ const r = V.validateVtPackage({ periodEnd: '2026-11-21', files: [
    { name: 'BI Active Fitted 211126.xlsx', sheets: { Export: biFile(lines(40)) } },
    { name: 'Scheduled & Missed 211126.xlsx', sheets: { Sheet1: smFile(lines(30, 92000000)) } },
    { name: 'Active.xlsx', sheets: { Export: vasBiFile(5) } }] });
  ok('both daily VT files are recognised by the engine\'s detection', r.sources.map((s) => s.kind).sort().join() === 'vtBiFitted,vtSchedMissed', JSON.stringify(r.sources));
  ok('a VAS Power BI file is NOT a VT file (it stays with the VAS checks)', !r.vtFiles.has('Active.xlsx'));
  ok('the extract date comes from the ddmmyy in the name', r.sources.every((s) => s.extractOn === '2026-11-21' && !s.assumed));
  ok('VT lines counted, no CRITICAL / HIGH on a good day', r.sources.every((s) => s.cases > 0) && !r.findings.some((x) => x.sev === 'CRITICAL' || x.sev === 'HIGH'), JSON.stringify(r.findings)); }
{ const r = V.validateVtPackage({ periodEnd: '2026-11-21', files: [{ name: 'BI Active Fitted.xlsx', sheets: { Export: biFile(lines(5)) } }] });
  ok('a name without ddmmyy is HIGH: the station would date it today', sev(r, 'HIGH', /no ddmmyy date/));
  ok('only one of the two daily files → MEDIUM, in words', sev(r, 'MEDIUM', /Only the BI Active Fitted file is here/)); }
{ const r = V.validateVtPackage({ periodEnd: '2026-11-21', files: [
    { name: 'BI Active Fitted 201126.xlsx', sheets: { Export: biFile(lines(100)) } }, { name: 'BI Active Fitted 211126.xlsx', sheets: { Export: biFile(lines(20)) } },
    { name: 'Scheduled & Missed 211126.xlsx', sheets: { Sheet1: smFile(lines(30, 92000000)) } }] });
  ok('a BI file with a fifth of the earlier one\'s cases is a thin pull (HIGH, engine guard)', sev(r, 'HIGH', /BI Active Fitted 211126\.xlsx: Refused as a thin pull: 20 cases against 100/), JSON.stringify(r.findings)); }
{ const r = V.validateVtPackage({ periodEnd: '2026-11-21', files: [{ name: 'BI Active Fitted 211126.xlsx', sheets: { Export: biFile([], true) } }, { name: 'Scheduled & Missed 211126.xlsx', sheets: { S: smFile(lines(3)) } }] });
  ok('a BI file with no VT lines is HIGH', sev(r, 'HIGH', /no Vehicle Tracking lines/), JSON.stringify(r.findings)); }
{ const r = V.validateVtPackage({ periodEnd: '2026-11-21', files: [{ name: 'November 2026 - VT Report.xlsx', sheets: { 'Schedulers Data': openFile(lines(4).map((x) => ({ ...x, sold: '2026-11-02' }))) } }] });
  ok('the opening book is recognised and told to wait for the first day\'s two files', r.sources[0] && r.sources[0].kind === 'vtOpeningBook' && sev(r, 'MEDIUM', /only after the first day/), JSON.stringify(r)); }
{ const r = V.validateVtPackage({ periodEnd: '2026-11-21', files: [{ name: 'BI Active Fitted 211126.xlsx', sheets: { E: biFile(lines(5)) } }, { name: 'BI Active Fitted 211126 (1).xlsx', sheets: { E: biFile(lines(5)) } }, { name: 'Scheduled & Missed 211126.xlsx', sheets: { S: smFile(lines(3)) } }] });
  ok('two BI files with the same extract date → MEDIUM', sev(r, 'MEDIUM', /same extract date 2026-11-21/), JSON.stringify(r.findings)); }

head('V2 · the VT sheet\'s Targets');
const HDR = ['Employee Code', 'Agent Name', 'Team Leader', 'Campaign', 'Tenure', 'Job Title', 'Sales Force', 'Target', 'Start Date'];
const row = (cb, sub, ten, t) => [cb, 'Person ' + cb, 'Leader One', 'Matrix Vehicle Tracking - ' + sub, ten, 'Agent', 'Person ' + cb, t, 46000];
{ const list = { VAS: [['Employee Code', 'Agent Name', 'Campaign'], ['CB9201', 'Vas Person', 'Courtesy']],
    VT: [HDR, row('CB9101', 'Digital', 'Exp', 6.5), row('CB9102', 'Referral', 'Exp', 3), row('CB9103', 'Predictive', 'M1', 1.5), row('CB9104', 'Scheduling', 'Exp', '-'), row('CB9105', 'Digital', 'Exp', '-')] };
  const f = V.vtTargetFindings(list, '2026-11-21');
  ok('a Target that differs from the SPD budget is a MEDIUM warning naming the agent, list and budget', f.some((x) => x.sev === 'MEDIUM' && /CB9103 \(predictive\/M1: list 1\.5, budget 1\)/.test(x.msg)), JSON.stringify(f));
  ok('matching Targets (Digital 6.5, Referral 3) are not named', !f.some((x) => /CB9101|CB9102/.test(x.msg)));
  ok('a Scheduling agent\'s "-" is expected — not a finding, counted in the summary', !f.some((x) => x.sev !== 'LOW' && /CB9104/.test(x.msg)) && f.some((x) => x.sev === 'LOW' && /1 Scheduling/.test(x.msg)), JSON.stringify(f));
  ok('a RATED agent with "-" is HIGH (Target Achievement not measured, never guessed)', f.some((x) => x.sev === 'HIGH' && /CB9105/.test(x.msg)));
  const f2 = V.vtTargetFindings(list, '2027-03-10');
  ok('a business month with no budgets says which earlier month the check fell back to', f2.some((x) => x.sev === 'MEDIUM' && /no Sales Review budgets for cycle-2027-03/.test(x.msg) && /cycle-2026-11/.test(x.msg)), JSON.stringify(f2)); }

head('V3 · wired into the validator');
const SRC = fs.readFileSync(path.join(ROOT, 'tools', 'upload-station-validate.mjs'), 'utf8');
ok('upload-station-validate imports tools/vt-validate.mjs', /from '\.\/vt-validate\.mjs'/.test(SRC));
ok('the stale "the VT sheet has no Target column" finding is gone', !/VT sheet has no Target column/.test(SRC));
ok('the VT findings join the report and the VT files get a row in "Sources ingested"', /VTV\.findings/.test(SRC) && /VTV\.sources/.test(SRC));

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
if (fail) { console.log('FAILURES:'); failures.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
