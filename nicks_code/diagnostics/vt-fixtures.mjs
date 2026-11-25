/* vt-fixtures.mjs — FICTIONAL Vehicle Tracking files for the Phase C suites (spec 071).
 *
 * Invented case numbers (9xxxxxxx), sellers CB91xx, customer "Customer Zed" etc. The header rows are the real
 * export's column ORDER (the engine reads BI by position), every value is made up. The PII strings are listed so a
 * suite can prove none of them ever leaves the browser.
 *
 *   import { BI_HDR, SM_HDR, OPEN_HDR, biFile, smFile, openFile, ROSTER, PII, xlsxBytes, vasBiFile } from './vt-fixtures.mjs';
 */
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const req = createRequire(path.join(HERE, 'node_modules', 'x.js'));

export const BI_HDR = ['Account Number', 'Contract Status', 'Installation Status', 'Account Create Date', 'Account Name', 'Account Record Type', 'Account_Status',
  'Third Party Billing', 'Contract Number', 'Subscriber Type ', 'Owner', 'Created By', 'Fitment_Case_Created_By', 'LastModifiedBy', 'Contract Create Date',
  'Contract Deactivate Date', 'Installation Date', 'Contract Status', 'Asset Make', 'Vehicle Reg Number', 'Asset Model', 'Box Number', 'Case Type',
  'Charge Amount', 'Unit Type', 'Product Bundle', 'Merged Product Bundle', 'Chassis Number', 'Charge Code', 'Charge Amount', 'FleetNumber', 'Device_Status',
  'Consultant', 'Group', 'Sales Vertical', 'Region', 'Unit Type', 'Area Manager', 'Account Region', 'Fitment Partner Account Number', 'Fitment Centre Name',
  'Source Partner', 'Source Partner Account Number', 'Previous_Source_Partner', 'Case Number'];
export const SM_HDR = ['Opportunity Source Partner', 'CaseID', 'Case Number', 'Account Name', 'Duplicates Flag', 'Count of Case Number', 'Mobile', 'Registration',
  'Vehicle Chassis', 'Product Type', 'Type', 'Status', 'Bundle Name', 'Subscriber Type', 'Internal Consultant', 'External Consultant', 'Fitment Partner',
  'Fitment Date', 'Created By', 'Last Modified By', 'MissedAndScheduledFitment'];
/* The master VT report's Schedulers Data sheet (spec 072): the header row as the owner's file carries it. It REPLACES
   the 071 "opening book" fixture, which was the same sheet cut short at Result — OPEN_HDR / openFile stay as aliases so
   the suites that only need "a VT report workbook" are untouched. */
export const SCH_HDR = ['Month', 'Date', 'Agent', 'Sale Count', 'GWP', 'Case Number', 'Customer Contact', 'Campaign/Partner', 'Referring Agent',
  'Scheduler', 'Result', 'Hrs Ahead', 'Date Scheduled', null, 'Scheduled', 'Missed', 'Fitted', 'Channel'];
export const OPEN_HDR = SCH_HDR;
export const PII = ['Customer Zed', '0820000001', 'ZZ 99 ZZ GP', 'CHASSISZZ001', 'BOXZZ01', 'ACCZZ001', 'CONZZ001', '0839999999'];

export const serial = (iso) => Math.round(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 864e5) + 25569;   // ISO → Excel serial

export function biLine({ cn, unit = 'MXV', charge = 100, inst = '2026-11-09', seller = 'Alpha Test - Panimax', partner = 'RevX', bundle = 'Bundle Q' }) {
  const r = new Array(45).fill(null);
  Object.assign(r, { 0: 'ACCZZ001', 1: 'Active', 2: 'Installed', 4: 'Customer Zed', 8: 'CONZZ001', 10: seller, 11: seller, 14: serial(inst), 16: serial(inst),
    19: 'ZZ 99 ZZ GP', 21: 'BOXZZ01', 23: charge, 24: unit, 25: bundle, 27: 'CHASSISZZ001', 29: charge, 36: unit, 41: partner, 44: String(cn) });
  return r;
}
export function smLine({ cn, outcome = 'Scheduled Fitment', appt = '2026-11-12', seller = 'Alpha Test - Panimax', partner = 'RevX', product = 'MXV', attempt = 'New' }) {
  const r = new Array(21).fill(null);
  Object.assign(r, { 0: partner, 1: 'CASEIDZZ', 2: String(cn), 3: 'Customer Zed', 6: '0820000001', 7: 'ZZ 99 ZZ GP', 8: 'CHASSISZZ001', 9: product,
    10: 'Installation', 11: attempt, 12: 'Bundle Q', 17: serial(appt), 18: seller, 20: outcome });
  return r;
}
export function schLine({ cn, sold = '2026-11-03', month = 'Current', gwp = 199, campaign = 'RevX', ref = 0, scheduler = 'Echo Foxtrot', result = 'Fitted', appt = null }) {
  const r = new Array(18).fill(null);
  Object.assign(r, { 0: month, 1: serial(sold), 2: 'Alpha Test', 3: 1, 4: gwp, 5: String(cn), 6: '0839999999', 7: campaign, 8: ref, 9: scheduler,
    10: result, 11: '24', 12: appt ? serial(appt) : 0, 14: 'Scheduled', 15: 'Missed', 16: 'Fitted', 17: 'Lead Gen' });
  return r;
}
export const openLine = schLine;
export const biFile = (lines, footer = true) => [BI_HDR, ...lines.map(biLine), ...(footer ? [['Applied filters:\nContract Status is Active']] : [])];
export const smFile = (lines, footer = true) => [SM_HDR, ...lines.map(smLine), ...(footer ? [['No filters applied']] : [])];
export const schFile = (lines, blanks = 2) => [SCH_HDR, ...lines.map(schLine),
  ...Array.from({ length: blanks }, () => new Array(18).fill(null).map((v, i) => (i === 11 || i === 17 ? '' : null)))];
export const openFile = schFile;

/* A VAS Power BI Active Cases export: the money source. Shares Account Number / Charge Amount / Contract Create Date with
   BI Active Fitted, carries none of the VT-only columns. */
export const VAS_BI_HDR = ['Account Number', 'Contract Status', 'Account Name', 'Contract Number', 'Owner', 'Created By', 'Contract Create Date',
  'Contract Deactivate Date', 'Charge Amount', 'Charge Code', 'Product Bundle', 'Merged Product Bundle', 'Consultant', 'Sales Vertical', 'Case Number'];
export const vasBiFile = (n = 3) => [VAS_BI_HDR, ...Array.from({ length: n }, (_, i) => ['ACC' + (100 + i), 'Active', 'Client ' + i, 'CON' + (100 + i),
  'Alpha Test', 'Alpha Test', '2026-11-0' + (3 + i), '', 86.08, 'VAS01', 'Courtesy Bundle', 'Courtesy Bundle', 'Alpha Test', 'Courtesy', String(5000000 + i)])];

/* The engine's roster shape (vt_roster_at → VTStation.rosterFromRpc). Fictional people, CB91xx. */
export const ROSTER = [
  { code: 'CB9101', name: 'Alpha Test', tl: 'Leader One', tlCode: 'CB9190', sub: 'digital', tenure: 'Exp', role: null, target: 6.5, startDate: '2026-01-05' },
  { code: 'CB9102', name: 'Bravo Middle Tester', tl: 'Leader Two', tlCode: 'CB9191', sub: 'referral', tenure: 'Exp', role: null, target: 3, startDate: '2026-01-05' },
  { code: 'CB9103', name: 'Charlie Delta', tl: 'Leader Three', tlCode: 'CB9192', sub: 'predictive', tenure: 'M1', role: null, target: 1, startDate: '2026-11-02' },
  { code: 'CB9104', name: 'Echo Foxtrot', tl: 'Leader Two', tlCode: 'CB9191', sub: 'scheduling', tenure: 'Exp', role: null, target: null, startDate: '2026-01-05' }
];

/* aoa (or {sheetName: aoa}) → .xlsx bytes, through the repo's own SheetJS copy */
export function xlsxBytes(sheets, sheetName = 'Export') {
  const XLSX = req('xlsx');
  const wb = XLSX.utils.book_new();
  const map = Array.isArray(sheets) ? { [sheetName]: sheets } : sheets;
  for (const [n, aoa] of Object.entries(map)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), n);
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}
