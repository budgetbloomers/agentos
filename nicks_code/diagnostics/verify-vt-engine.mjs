/* VT ENGINE UNITS (Spec Kit 071 FR-001..FR-017, A5–A9). Fictional fixtures only: invented case
 * numbers (9xxxxxxx), sellers CB91xx, customers "Customer Zed" etc. — so the PII test can look for
 * those strings in every output.
 *
 *   detection (VAS BI is never VT and VT is never VAS BI), footer skip, filename date,
 *   parse by POSITION, PII columns never in any output, status precedence within one extract,
 *   across extracts (newer decides M/S, Fitted terminal, sticky, older extract never changes a
 *   status but may fill a blank), first-seen sale day, go-live (opening extract) and the opening
 *   book, events, pure/deterministic (input never mutated), idempotent re-merge, thin-pull guards,
 *   seller resolution chain, lead source fold, sub-campaign parse, model wiring.
 *
 * Run:  node verify-vt-engine.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const REPO = process.env.AGENTOS || decodeURIComponent(new URL('../..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1').replace(/\/$/, '');
const ENGINE = path.join(REPO, 'nicks_code', 'vt-engine.js');
let pass = 0, fail = 0; const failures = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; failures.push(n + (d ? ' — ' + d : '')); console.log('  FAIL ' + n + (d ? ' — ' + d : '')); } };
const eq = (n, got, exp) => ok(n, JSON.stringify(got) === JSON.stringify(exp), 'expected ' + JSON.stringify(exp) + ' got ' + JSON.stringify(got));
const finish = () => { console.log(`\n${pass} passed, ${fail} failed`); failures.forEach(f => console.log('  · ' + f)); process.exit(fail ? 1 : 0); };

if (!fs.existsSync(ENGINE)) { ok('nicks_code/vt-engine.js exists', false, 'missing'); finish(); }
const E = require(ENGINE);

/* ---- fixtures -------------------------------------------------------------------------------- */
const BI_HDR = ['Account Number', 'Contract Status', 'Installation Status', 'Account Create Date', 'Account Name', 'Account Record Type', 'Account_Status',
  'Third Party Billing', 'Contract Number', 'Subscriber Type ', 'Owner', 'Created By', 'Fitment_Case_Created_By', 'LastModifiedBy', 'Contract Create Date',
  'Contract Deactivate Date', 'Installation Date', 'Contract Status', 'Asset Make', 'Vehicle Reg Number', 'Asset Model', 'Box Number', 'Case Type',
  'Charge Amount', 'Unit Type', 'Product Bundle', 'Merged Product Bundle', 'Chassis Number', 'Charge Code', 'Charge Amount', 'FleetNumber', 'Device_Status',
  'Consultant', 'Group', 'Sales Vertical', 'Region', 'Unit Type', 'Area Manager', 'Account Region', 'Fitment Partner Account Number', 'Fitment Centre Name',
  'Source Partner', 'Source Partner Account Number', 'Previous_Source_Partner', 'Case Number'];
const SM_HDR = ['Opportunity Source Partner', 'CaseID', 'Case Number', 'Account Name', 'Duplicates Flag', 'Count of Case Number', 'Mobile', 'Registration',
  'Vehicle Chassis', 'Product Type', 'Type', 'Status', 'Bundle Name', 'Subscriber Type', 'Internal Consultant', 'External Consultant', 'Fitment Partner',
  'Fitment Date', 'Created By', 'Last Modified By', 'MissedAndScheduledFitment'];
const S = iso => Math.round(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 864e5) + 25569;   // ISO → Excel serial
const PII = ['Customer Zed', '0820000001', 'ZZ 99 ZZ GP', 'CHASSISZZ001', 'BOXZZ01', 'ACCZZ001', 'CONZZ001'];
function biLine({ cn, unit = 'MXV', charge = 100, inst = '2026-11-09', seller = 'Alpha Test - Panimax', partner = 'RevX', bundle = 'Bundle Q' }) {
  const r = new Array(45).fill(null);
  Object.assign(r, { 0: 'ACCZZ001', 1: 'Active', 2: 'Installed', 4: 'Customer Zed', 8: 'CONZZ001', 10: seller, 11: seller, 14: S(inst), 16: S(inst),
    19: 'ZZ 99 ZZ GP', 21: 'BOXZZ01', 23: charge, 24: unit, 25: bundle, 27: 'CHASSISZZ001', 29: charge, 36: unit, 41: partner, 44: String(cn) });
  return r;
}
function smLine({ cn, outcome = 'Scheduled Fitment', appt = '2026-11-12', seller = 'Alpha Test - Panimax', partner = 'RevX', product = 'MXV', attempt = 'New' }) {
  const r = new Array(21).fill(null);
  Object.assign(r, { 0: partner, 1: 'CASEIDZZ', 2: String(cn), 3: 'Customer Zed', 6: '0820000001', 7: 'ZZ 99 ZZ GP', 8: 'CHASSISZZ001', 9: product,
    10: 'Installation', 11: attempt, 12: 'Bundle Q', 17: S(appt), 18: seller, 20: outcome });
  return r;
}
const biFile = (lines, footer = true) => [BI_HDR, ...lines.map(biLine), ...(footer ? [['Applied filters:\nContract Status is Active']] : [])];
const smFile = (lines, footer = true) => [SM_HDR, ...lines.map(smLine), ...(footer ? [['No filters applied']] : [])];
const ROSTER = [
  { code: 'CB9101', name: 'Alpha Test', tl: 'Leader One', tlCode: 'CB9190', sub: 'digital', tenure: 'Exp', role: 'Sales Agent', target: 6.5, startDate: '2026-01-05' },
  { code: 'CB9102', name: 'Bravo Middle Tester', tl: 'Leader Two', tlCode: 'CB9191', sub: 'referral', tenure: 'Exp', role: 'Sales Agent', target: 3, startDate: '2026-01-05' },
  { code: 'CB9103', name: 'Charlie Delta', tl: 'Leader Three', tlCode: 'CB9192', sub: 'predictive', tenure: 'M1', role: 'Sales Agent', target: 1, startDate: '2026-11-02' },
  { code: 'CB9104', name: 'Echo Foxtrot', tl: 'Leader Two', tlCode: 'CB9191', sub: 'scheduling', tenure: 'Exp', role: 'Scheduling Agent', target: null, startDate: '2026-01-05' },
  { code: 'CB9105', name: 'Golf Ann Hotel', tl: 'Leader Three', tlCode: 'CB9192', sub: 'predictive', tenure: 'M2', role: 'Sales Agent', target: 1.5, startDate: '2026-01-05' },
  { code: 'CB9106', name: 'Golf Bea Hotel', tl: 'Leader Three', tlCode: 'CB9192', sub: 'predictive', tenure: 'M2', role: 'Sales Agent', target: 1.5, startDate: '2026-01-05' }
];
const deepFreeze = o => { if (o && typeof o === 'object') { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };
const merge = (book, kind, aoa, on, extra = {}) => {
  const parsed = kind === 'bi' ? E.parseBi(aoa) : kind === 'sm' ? E.parseSm(aoa) : E.parseSchedulers(aoa);
  return E.merge(book, parsed, Object.assign({ extractOn: on, roster: ROSTER, aliases: {} }, extra));
};
/* the Schedulers Data sheet of the master VT report (spec 072 D1): the header row as the owner's file
   carries it, and a row builder that always fills the Customer Contact column so the PII test bites. */
const SCH_HDR = ['Month', 'Date', 'Agent', 'Sale Count', 'GWP', 'Case Number', 'Customer Contact', 'Campaign/Partner', 'Referring Agent',
  'Scheduler', 'Result', 'Hrs Ahead', 'Date Scheduled', null, 'Scheduled', 'Missed', 'Fitted', 'Channel'];
const schRow = ({ cn, month = 'Current', sold = '2026-11-12', agent = 'Alpha Test', gwp = 99, campaign = 'Revx', ref = 0,
  sched = 'Echo Foxtrot', result = 'Fitted', appt = null }) => {
  const r = new Array(18).fill(null);
  Object.assign(r, { 0: month, 1: S(sold), 2: agent, 3: 1, 4: gwp, 5: String(cn), 6: '0820000001', 7: campaign, 8: ref, 9: sched,
    10: result, 11: '24', 12: appt ? S(appt) : 0, 14: 'Scheduled', 15: 'Missed', 16: 'Fitted', 17: 'Lead Gen' });
  return r;
};
const schFile = (rows, blanks = 3) => [SCH_HDR, ...rows.map(schRow),
  ...Array.from({ length: blanks }, () => new Array(18).fill(null).map((v, i) => (i === 11 || i === 17 ? '' : null)))];

console.log('\n== detection ==');
eq('BI Active Fitted header → vtBiFitted', E.detect(BI_HDR, 'Export'), 'vtBiFitted');
eq('Scheduled & Missed header → vtSchedMissed', E.detect(SM_HDR, 'Export'), 'vtSchedMissed');
eq('Schedulers Data header → vtSchedulers (the retired "opening book" kind is gone — spec 072 U-1)', E.detect(SCH_HDR, 'Schedulers Data'), 'vtSchedulers');
eq('…and the rule book no longer carries detection.vtOpeningBook', E.VT_RULES.detection.vtOpeningBook, undefined);
eq('…the same columns under another sheet name are not a VT upload', E.detect(SCH_HDR, 'Sheet1'), null);
eq('…and with no sheet name at all they are (the Rake and Ops refuse it by columns alone)', E.detect(SCH_HDR), 'vtSchedulers');
{ const VAS_BI = ['Account Number', 'Contract Status', 'Account Create Date', 'Owner', 'Created By', 'Contract Create Date', 'Contract Deactivate Date', 'Charge Amount', 'Product Bundle', 'Source Partner', 'Case Number'];
  eq('a VAS BI header is NEVER VT', E.detect(VAS_BI, 'Export'), null); }
eq('a header missing one required VT column is not VT', E.detect(BI_HDR.filter(h => h !== 'Box Number'), 'Export'), null);
eq('header matching is case- and space-insensitive', E.detect(BI_HDR.map(h => '  ' + h.toUpperCase() + ' '), 'Export'), 'vtBiFitted');
eq('an unrelated header → null', E.detect(['Agent', 'Talk Time', 'Calls'], 'Sheet1'), null);

console.log('\n== filename date ==');
eq('"BI Active Fitted 101126.xlsx" → 2026-11-10', E.extractDate('BI Active Fitted 101126.xlsx', '2026-11-23'), { date: '2026-11-10', assumed: false });
eq('"Scheduled & Missed 311226.xls" → 2026-12-31', E.extractDate('Scheduled & Missed 311226.xls', '2026-11-23'), { date: '2026-12-31', assumed: false });
eq('no ddmmyy → today SAST, assumed', E.extractDate('Scheduled & Missed.xlsx', '2026-11-23'), { date: '2026-11-23', assumed: true });
eq('an impossible ddmmyy (32/13) → today, assumed', E.extractDate('BI 321326.xlsx', '2026-11-23'), { date: '2026-11-23', assumed: true });

console.log('\n== parse BI (by position, VT lines only, footer, PII) ==');
const bi1 = E.parseBi(biFile([{ cn: 90000001, charge: 100 }, { cn: 90000001, unit: 'BEAME', charge: 50.5 }, { cn: 90000002, unit: 'Matrix Vision' },
  { cn: 90000003, unit: 'Recovery Service' }, { cn: 90000004, unit: 'Service' }, { cn: '', unit: 'MXV' }]));
eq('kind bi, rows counted (footer excluded)', [bi1.kind, bi1.rows], ['bi', 6]);
eq('VT lines = BEAME / MXV / Matrix Vision only (Recovery Service and Service out)', bi1.vtLines, 3);
eq('cases from VT lines', Object.keys(bi1.cases).sort(), ['90000001', '90000002']);
eq('footer row skipped and counted', bi1.skippedFooter, 1);
eq('blank case number skipped and counted', bi1.skippedBlank, 1);
eq('charge ex VAT summed per case over its VT lines', bi1.cases['90000001'].chargeEx, 150.5);
eq('products set per case', bi1.cases['90000001'].products, ['BEAME', 'MXV']);
eq('fitted day = Installation Date', bi1.cases['90000001'].fittedOn, '2026-11-09');
eq('seller kept as the normalised Salesforce name', bi1.cases['90000001'].seller, 'alpha test');
ok('no customer field reaches the parse output', !PII.some(p => JSON.stringify(bi1).includes(p)), PII.filter(p => JSON.stringify(bi1).includes(p)).join(','));
{ const noInst = biFile([{ cn: 90000005 }]); noInst[1][16] = null;
  eq('Installation Date blank → Contract Create Date', E.parseBi(noInst).cases['90000005'].fittedOn, '2026-11-09'); }
{ const moved = biFile([{ cn: 90000006 }]).map(r => r.slice()); moved[0] = moved[0].slice(); moved[0][44] = 'Case No';
  const p = E.parseBi(moved); ok('a column not where the position rule expects it is named as missing', p.missing.length > 0 && Object.keys(p.cases).length === 0, JSON.stringify(p.missing)); }
{ const p = E.parseBi(biFile([{ cn: 90000007, charge: 100 }])); const r = biFile([{ cn: 90000007, charge: 100 }]); r[1][29] = 99;
  const q = E.parseBi(r); ok('charge X ≠ AD is warned, never silently chosen', q.warnings.length > p.warnings.length, JSON.stringify(q.warnings)); }

console.log('\n== parse S&M ==');
const sm1 = E.parseSm(smFile([{ cn: 90000011, outcome: 'Scheduled Fitment', product: 'MXV' }, { cn: 90000011, outcome: 'Scheduled Fitment', product: 'BEAME' },
  { cn: 90000012, outcome: 'Missed Fitment', appt: '2026-11-05' }]));
eq('cases + status map', [sm1.cases['90000011'].status, sm1.cases['90000012'].status], ['scheduled', 'missed']);
eq('appointment day from Fitment Date', sm1.cases['90000012'].apptOn, '2026-11-05');
eq('products per case', sm1.cases['90000011'].products, ['BEAME', 'MXV']);
eq('footer skipped', sm1.skippedFooter, 1);
ok('no customer field (mobile, registration, chassis, name) in the parse output', !PII.some(p => JSON.stringify(sm1).includes(p)));

console.log('\n== merge: status precedence within one extract ==');
let b0 = E.emptyBook();
{ let r = merge(b0, 'sm', smFile([{ cn: 90000021, outcome: 'Missed Fitment' }, { cn: 90000022, outcome: 'Scheduled Fitment' }, { cn: 90000023, outcome: 'Missed Fitment' }]), '2026-11-10');
  r = merge(r.book, 'bi', biFile([{ cn: 90000021 }, { cn: 90000022 }, { cn: 90000024 }, { cn: 90000023, unit: 'Recovery Service' }]), '2026-11-10');
  const c = r.book.cases;
  eq('S&M Missed + BI same extract → Fitted', c['90000021'].status, 'fitted');
  eq('S&M Scheduled + BI same extract → Fitted', c['90000022'].status, 'fitted');
  eq('BI only → Fitted', c['90000024'].status, 'fitted');
  eq('S&M Missed + a BI Recovery-Service-only line → stays Missed', c['90000023'].status, 'missed');
  const r2 = merge(merge(b0, 'bi', biFile([{ cn: 90000025 }]), '2026-11-10').book, 'sm', smFile([{ cn: 90000025, outcome: 'Missed Fitment' }]), '2026-11-10');
  eq('BI first, then S&M Missed on the same extract → still Fitted', r2.book.cases['90000025'].status, 'fitted'); }

console.log('\n== merge: across extracts ==');
{ let r = merge(b0, 'sm', smFile([{ cn: 90000031, outcome: 'Missed Fitment', appt: '2026-11-09' }, { cn: 90000032, outcome: 'Scheduled Fitment' }, { cn: 90000033 }]), '2026-11-10');
  r = merge(r.book, 'sm', smFile([{ cn: 90000031, outcome: 'Scheduled Fitment', appt: '2026-11-16', attempt: '2nd attempt' }, { cn: 90000032, outcome: 'Missed Fitment', appt: '2026-11-11' }]), '2026-11-11');
  const c = r.book.cases;
  eq('Missed then Scheduled on a newer extract → Scheduled (re-booked)', [c['90000031'].status, c['90000031'].apptOn], ['scheduled', '2026-11-16']);
  eq('Scheduled then Missed on a newer extract → Missed', c['90000032'].status, 'missed');
  eq('a case absent from the newer extract keeps its status (sticky)', [c['90000033'].status, c['90000033'].lastSeen], ['scheduled', '2026-11-10']);
  eq('events: one per change — 31: missed → scheduled', r.events.map(e => [e.caseNumber, e.from, e.to, e.onDate, e.apptOn]),
    [['90000031', 'missed', 'scheduled', '2026-11-11', '2026-11-16'], ['90000032', 'scheduled', 'missed', '2026-11-11', '2026-11-11']]);
  const all = r.book.events.filter(e => e.caseNumber === '90000031').map(e => e.to);
  eq('the Missed event stays in the case history', all, ['missed', 'scheduled']);
  const r3 = merge(r.book, 'bi', biFile([{ cn: 90000031 }]), '2026-11-12');
  const r4 = merge(r3.book, 'sm', smFile([{ cn: 90000031, outcome: 'Scheduled Fitment' }]), '2026-11-13');
  eq('Fitted is terminal: a newer S&M Scheduled never reopens it', r4.book.cases['90000031'].status, 'fitted');
  eq('…and writes no event', r4.events.length, 0);
  const r5 = merge(r4.book, 'sm', smFile([{ cn: 90000032, outcome: 'Scheduled Fitment', appt: '2026-11-20' }, { cn: 90000034, outcome: 'Scheduled Fitment' }]), '2026-11-09');
  eq('an OLDER extract never changes a status decided by a newer one', r5.book.cases['90000032'].status, 'missed');
  eq('…but it may add a case it carries for the first time (first seen on its date)', [r5.book.cases['90000034'].status, r5.book.cases['90000034'].firstSeen], ['scheduled', '2026-11-09']);
  eq('…and it moves first_seen earlier for a case it also carries', r5.book.cases['90000032'].firstSeen, '2026-11-09');
}
{ let r = merge(b0, 'sm', smFile([{ cn: 90000041 }]), '2026-11-11');
  const sm = smFile([{ cn: 90000041 }]); sm[1][12] = null;          // bundle blank on the newer extract
  r = merge(merge(b0, 'sm', sm, '2026-11-11').book, 'sm', smFile([{ cn: 90000041 }]), '2026-11-10');
  eq('an older extract fills a field that is still blank', r.book.cases['90000041'].bundle, 'Bundle Q'); }

console.log('\n== sale day ==');
{ let r = merge(b0, 'sm', smFile([{ cn: 90000051 }]), '2026-11-09');                 // go-live: the opening extract
  r = merge(r.book, 'bi', biFile([{ cn: 90000052 }]), '2026-11-09');
  r = merge(r.book, 'sm', smFile([{ cn: 90000051 }, { cn: 90000053 }]), '2026-11-10');
  const c = r.book.cases;
  eq('the book remembers its opening extract', r.book.openedOn, '2026-11-09');
  eq('a case on the opening extract has no sale day (A6)', [c['90000051'].soldOn, c['90000051'].soldBasis], [null, 'unknown']);
  eq('…both files of the opening day', [c['90000052'].soldOn, c['90000052'].soldBasis], [null, 'unknown']);
  eq('a case first seen on a later extract is sold that day (first_seen)', [c['90000053'].soldOn, c['90000053'].soldBasis], ['2026-11-10', 'first_seen']);
  const p = E.parseSchedulers(schFile([
    { cn: 90000051, month: 'Rollover', sold: '2026-10-20', result: 'Missed' },
    { cn: 90000052, sold: '2026-11-02', result: 'Fitted' },
    { cn: 90000099, sold: '2026-11-03', result: 'Cancelled' }]));
  ok('Schedulers Data never carries a customer field out of the parser (col G is discarded)',
    JSON.stringify(p).indexOf('0820000001') < 0, JSON.stringify(p).slice(0, 300));
  const r2 = E.merge(r.book, p, { extractOn: '2026-11-10', roster: ROSTER, aliases: {} });
  eq('Schedulers Data supplies the sale day (basis schedulers_data)', [r2.book.cases['90000051'].soldOn, r2.book.cases['90000051'].soldBasis], ['2026-10-20', 'schedulers_data']);
  eq('…never changes a status, whatever its Result column says', r2.book.cases['90000051'].status, 'scheduled');
  eq('…counts the cases it names that are not in the book (never invents one)', [r2.counts.notInBook, Object.keys(r2.book.cases).length], [1, 3]);
  eq('…and it marks the book as dated, with the opening book\'s own semantics (U-5)', r2.book.openingBookOn, '2026-11-10');
}

console.log('\n== Schedulers Data: the parser (spec 072 B1) ==');
{ const aoa = schFile([
    { cn: 90000201, sold: '2026-11-12', gwp: 149, campaign: 'Referral Agent', ref: 'Bravo Middle Tester', sched: 'Echo Foxtrot', result: 'Fitted' },
    { cn: 90000202, sold: '2026-11-13', gwp: 0, campaign: 'Predictive', ref: 0, sched: 'Golf Ann Hotel', result: 'Scheduled', appt: '2026-11-26' },
    { cn: 90000203, month: 'Rollover', sold: '2026-10-02', gwp: 99, campaign: 'Black Birch Projects', result: 'Missed' }], 4);
  const p = E.parseSchedulers(aoa);
  eq('kind, cases, populated rows and the blank rows counted and skipped', [p.kind, Object.keys(p.cases).length, p.rows, p.skippedBlank], ['schedulers_data', 3, 3, 4]);
  eq('no required column is missing', p.missing, []);
  eq('it reads by position: sale date, GWP, campaign, scheduler, Result, appointment',
    [p.cases['90000201'].soldOn, p.cases['90000201'].gwp, p.cases['90000201'].campaignRaw, p.cases['90000201'].scheduler, p.cases['90000201'].result, p.cases['90000202'].apptOn],
    ['2026-11-12', 149, 'Referral Agent', 'echo foxtrot', 'fitted', '2026-11-26']);
  eq('Referring Agent = 0 is no referrer, a name is one (F0-19)', [p.cases['90000202'].referring, p.cases['90000201'].referring], [null, 'bravo middle tester']);
  eq('an appointment serial of 0 is no appointment, not 1899-12-29 (F0-20)', p.cases['90000201'].apptOn, null);
  eq('GWP 0 is a real nought, never a missing value', p.cases['90000202'].gwp, 0);
  ok('every unlisted column is discarded: no Hrs Ahead, no Channel, no helper column, no Month',
    !/Hrs Ahead|Channel|Lead Gen|Rollover/.test(JSON.stringify(p)), JSON.stringify(p.cases['90000203']));
  const dup = E.parseSchedulers(schFile([{ cn: 90000301 }, { cn: 90000302 }, { cn: 90000301 }]));
  eq('a duplicate case number inside one file is refused, and the duplicates are named (A2)', [dup.duplicates, Object.keys(dup.cases).length], [['90000301'], 0]);
  const short = E.parseSchedulers([SCH_HDR.map(h => (h === 'Scheduler' ? 'Who Booked It' : h)), schRow({ cn: 90000401 })]);
  eq('a sheet whose columns moved is refused by name, never read by position anyway', short.missing, ['scheduler (column J)']);
}

console.log('\n== Schedulers Data: the merge (spec 072 B2) ==');
{ let r = merge(b0, 'sm', smFile([{ cn: 90000501 }, { cn: 90000502, outcome: 'Missed Fitment' }]), '2026-11-09');
  r = merge(r.book, 'bi', biFile([{ cn: 90000503 }]), '2026-11-10');
  const before = E.model(r.book, ROSTER, { asOf: '2026-11-10' });
  const p = E.parseSchedulers(schFile([
    { cn: 90000501, month: 'Rollover', sold: '2026-09-15', gwp: 199, sched: 'Echo Foxtrot', result: 'Fitted' },     // disagrees: engine says scheduled
    { cn: 90000502, sold: '2026-11-03', gwp: 149, sched: 'Echo Foxtrot', result: 'Missed' },                        // agrees
    { cn: 90000503, sold: '2026-10-28', gwp: 0, sched: 'Nobody On The List', result: 'Fitted' },                    // agrees; scheduler unmatched
    { cn: 90000599, sold: '2026-11-04', result: 'Fitted' }]));                                                      // not in the book
  const m = E.merge(r.book, p, { extractOn: '2026-11-10', roster: ROSTER, aliases: {} });
  const c = m.book.cases;
  eq('it sets the sale date, the basis, the scheduler (resolved to a CB) and the GWP',
    [c['90000501'].soldOn, c['90000501'].soldBasis, c['90000501'].schedulerCb, c['90000501'].schedulerName, c['90000501'].gwpRpt],
    ['2026-09-15', 'schedulers_data', 'CB9104', 'echo foxtrot', 199]);
  eq('…the campaign the report typed, and the Result it typed (kept for the disagreement count, never applied)',
    [c['90000501'].campaignRpt, c['90000501'].resultRpt, c['90000501'].status], ['Revx', 'fitted', 'scheduled']);
  eq('a scheduler not on the Agent List is kept as typed and named, never guessed',
    [c['90000503'].schedulerName, c['90000503'].schedulerCb, m.unmatchedSchedulers], ['nobody on the list', null, [{ name: 'nobody on the list', cases: 1 }]]);
  eq('the Result disagreements are counted BY DIRECTION', m.disagree, { total: 1, byDirection: { 'fitted -> scheduled': 1 } });
  eq('the cases it re-dated are tallied by the basis they came from', m.counts.redated,
    { from_schedulers_data: 0, from_opening_book: 0, from_first_seen: 1, from_unknown: 2, unchanged: 0 });
  eq('…and so are the schedulers and the GWP it set', [m.counts.schedulersSet, m.counts.gwpSet, m.counts.notInBook], [3, 3, 1]);
  eq('no status event is ever written by a Schedulers Data merge', m.events, []);
  /* U-5 / risk 2: the rating's working-day window. `opening_book_on` keeps EXACTLY the meaning it has had since 071 —
     "a sheet has supplied sale dates from before the first upload" — so the rule that reads it is untouched: a book that
     already carries it does not move at all, and one that does not takes the cycle start, which is what the retired
     opening book did on its own first load. Nothing about the rating's own code, drivers or budgets is involved. */
  const after = E.model(m.book, ROSTER, { asOf: '2026-11-10' });
  eq('a first dating takes the window to the cycle start, the retired opening book semantics unchanged (U-5)',
    [before.trackFrom, after.trackFrom], ['2026-11-10', after.period.from]);
  eq('opening_book_on is stamped once and keeps its first value', [r.book.openingBookOn, m.book.openingBookOn], [null, '2026-11-10']);
  { const m2 = E.merge(m.book, p, { extractOn: '2026-11-12', roster: ROSTER, aliases: {} });
    const after2 = E.model(m2.book, ROSTER, { asOf: '2026-11-10' });
    eq('a SECOND Schedulers Data commit moves nothing: trackFrom, working days, SPD and the stamp are identical (risk 2)',
      [after2.trackFrom, after2.workingDaysElapsed, after2.floor.mtd.spd, m2.book.openingBookOn],
      [after.trackFrom, after.workingDaysElapsed, after.floor.mtd.spd, m.book.openingBookOn]); }
  { /* and on a book already dated (every book once this file has landed), the first commit moves nothing either */
    const dated = JSON.parse(JSON.stringify(r.book)); dated.openingBookOn = '2026-11-09';
    const b4 = E.model(dated, ROSTER, { asOf: '2026-11-10' });
    const m3 = E.merge(dated, p, { extractOn: '2026-11-10', roster: ROSTER, aliases: {} });
    const a4 = E.model(m3.book, ROSTER, { asOf: '2026-11-10' });
    eq('on an already-dated book nothing in the rating window moves at all',
      [a4.trackFrom, a4.workingDaysElapsed, m3.book.openingBookOn], [b4.trackFrom, b4.workingDaysElapsed, '2026-11-09']); }
  /* back-build: the file reaches into earlier business months, so every cycle it covers is populated */
  eq('the merge reports every business cycle the file\'s sale dates reach', m.cycles.map(x => [x.key, x.cases]),
    [['cycle-2026-09', 1], ['cycle-2026-11', 2]]);
  eq('…the earliest cycle is labelled partial, with the first sale date in the book',
    [m.cycles[0].partial, m.cycles[0].firstSale, /partial/i.test(m.cycles[0].words)], [true, '2026-09-15', true]);
  { const prev = E.prevCycleFor(m.book, ROSTER, 'cycle-2026-11', { asOf: '2026-11-10' });
    eq('a previous cycle the file does not reach says so, and its counts stay 0 — the page reads "—" (FR-019)',
      [prev.cycle, prev.present, prev.counts], ['cycle-2026-10', false, null]);
    const p9 = E.prevCycleFor(m.book, ROSTER, 'cycle-2026-10', { asOf: '2026-11-10' });
    eq('…and the cycle the back-build DID populate is a real comparison, labelled partial',
      [p9.cycle, p9.present, p9.partial, p9.counts.sales, p9.counts.fitted], ['cycle-2026-09', true, true, 1, 0]); }
  const again = E.merge(m.book, p, { extractOn: '2026-11-11', roster: ROSTER, aliases: {} });
  eq('re-uploading the same file changes nothing (idempotent, U-6)', [again.cases.length, again.counts.redated.unchanged], [0, 3]);
  const sm2 = merge(m.book, 'sm', smFile([{ cn: 90000501, outcome: 'Missed Fitment' }]), '2026-11-11');
  eq('a later daily file never takes the sale date back off the Schedulers Data basis (precedence U-4)',
    [sm2.book.cases['90000501'].soldOn, sm2.book.cases['90000501'].soldBasis, sm2.book.cases['90000501'].gwpRpt],
    ['2026-09-15', 'schedulers_data', 199]);
  const rpc = E.bookFromRpc({ rev: 3, openedOn: '2026-11-09', openingBookOn: '2026-11-10',
    cases: [E.BOOK_COLS.map(k => (c['90000501'][k] === undefined ? null : c['90000501'][k]))], events: [] });
  eq('a book read back from the database carries the scheduler, the GWP, the referrer, the campaign and the Result',
    [rpc.cases['90000501'].schedulerName, rpc.cases['90000501'].gwpRpt, rpc.cases['90000501'].campaignRpt, rpc.cases['90000501'].resultRpt],
    ['echo foxtrot', 199, 'Revx', 'fitted']);
}

console.log('\n== pure, deterministic, idempotent ==');
{ const r = merge(b0, 'sm', smFile([{ cn: 90000061 }, { cn: 90000062, outcome: 'Missed Fitment' }]), '2026-11-10');
  const frozen = deepFreeze(JSON.parse(JSON.stringify(r.book)));
  let threw = null; let r2;
  try { r2 = merge(frozen, 'bi', biFile([{ cn: 90000061 }]), '2026-11-11'); } catch (e) { threw = e; }
  ok('merging into a frozen book never mutates it', !threw, threw && threw.message);
  eq('the input book is unchanged', frozen.cases['90000061'].status, 'scheduled');
  eq('the new book carries the change', r2 && r2.book.cases['90000061'].status, 'fitted');
  eq('changed rows returned = the cases that changed only', r2 && r2.cases.map(c => c.caseNumber), ['90000061']);
  const again = merge(r2.book, 'bi', biFile([{ cn: 90000061 }]), '2026-11-11');
  eq('the same file again → no changed rows, no events', [again.cases.length, again.events.length], [0, 0]);
  const x = merge(b0, 'sm', smFile([{ cn: 90000061 }, { cn: 90000062, outcome: 'Missed Fitment' }]), '2026-11-10');
  eq('deterministic: same inputs, same output', JSON.stringify(x), JSON.stringify(r));
  ok('no customer field anywhere in the merge result', !PII.some(p => JSON.stringify(r2).includes(p)));
  eq('receipt counts', r2.counts, { rows: 1, vtLines: 1, cases: 1, new: 0, toFitted: 1, toMissed: 0, toScheduled: 0, toCancelled: 0, cancelledDropped: 0, cancelledDeactivated: 0, reappeared: 0, completeDay: false, changed: 1, skippedFooter: 1, skippedBlank: 0, notInBook: 0 });
  ok('book revision is the caller\'s (merge never invents one)', r2.book.rev === r.book.rev); }

console.log('\n== thin-pull guards (FR-006) ==');
eq('BI VT cases 89 vs last 100 in the cycle → refused', E.guardUpload('bi', 89, 100, false).ok, false);
eq('BI 90 vs 100 → accepted', E.guardUpload('bi', 90, 100, false).ok, true);
eq('BI with no earlier file this cycle → accepted', E.guardUpload('bi', 5, null, false).ok, true);
eq('S&M 39 vs 100 → refused unless the quiet-day box is ticked', [E.guardUpload('sm', 39, 100, false).ok, E.guardUpload('sm', 39, 100, true).ok], [false, true]);
ok('the refusal names both counts in words', /89.*100|100.*89/.test(E.guardUpload('bi', 89, 100, false).reason));
eq('a file with no VT line is refused', E.guardUpload('bi', 0, null, false).ok, false);

console.log('\n== seller resolution ==');
const res = n => { const r = E.resolveSeller(n, ROSTER, { 'india juliet': 'CB9101' }); return [r.code, r.method]; };
eq('normSeller strips " - Panimax", collapses spaces, case-folds', E.normSeller('  ALPHA   Test  - Panimax '), 'alpha test');
eq('exact', res('Alpha Test - Panimax'), ['CB9101', 'exact']);
eq('alias', res('India Juliet'), ['CB9101', 'alias']);
eq('one-typo near-spelling (one letter in the first name)', res('Charlee Delta'), ['CB9103', 'near']);
eq('first + last token, unique in VT (list name has a middle name)', res('Bravo Tester'), ['CB9102', 'first_last']);
eq('first + last token shared by two VT agents → unmatched (unique or nothing)', res('Golf Hotel'), [null, 'unmatched']);
eq('a name on no list → unmatched', res('Zulu Unknown'), [null, 'unmatched']);
eq('two typos → unmatched', res('Charlee Deltx'), [null, 'unmatched']);

console.log('\n== lead source and sub-campaign ==');
eq('RevX → revx', E.leadSourceOf('RevX', 'digital'), 'revx');
eq('Tracking Empire / Shawn Langley → tracking_empire', E.leadSourceOf('Tracking Empire / Shawn Langley', 'predictive'), 'tracking_empire');
eq('Panimax - New Sales by a Referral seller → referral', E.leadSourceOf('Panimax - New Sales', 'referral'), 'referral');
eq('Panimax - New Sales by anyone else → predictive', [E.leadSourceOf('Panimax - New Sales', 'digital'), E.leadSourceOf('Panimax - New Sales', null)], ['predictive', 'predictive']);
eq('Sales Enablement stays its own line', E.leadSourceOf('Sales Enablement', 'digital'), 'sales_enablement');
eq('an unknown partner → other', E.leadSourceOf('Somebody New', 'digital'), 'other');
eq('lead group of revx = lead_gen', E.leadGroupOf('revx'), 'lead_gen');
eq('subOf("Matrix Vehicle Tracking - Digital") → digital', E.subOf('Matrix Vehicle Tracking - Digital'), 'digital');
eq('subOf with trailing space → scheduling', E.subOf('Matrix Vehicle Tracking - Scheduling '), 'scheduling');
eq('subOf a VAS campaign → null', E.subOf('Matrix VAS - Courtesy'), null);

console.log('\n== model wiring (small book) ==');
{ let r = merge(b0, 'sm', smFile([{ cn: 90000071 }]), '2026-11-02');                                   // opening extract
  r = merge(r.book, 'sm', smFile([{ cn: 90000072, appt: '2026-11-11' }, { cn: 90000073, outcome: 'Missed Fitment', appt: '2026-11-09', seller: 'Charlie Delta' },
    { cn: 90000074, seller: 'Zulu Unknown', partner: 'Panimax - New Sales' }, { cn: 90000075, seller: 'Bravo Middle Tester', partner: 'Panimax - New Sales' }]), '2026-11-09');
  r = merge(r.book, 'bi', biFile([{ cn: 90000076, inst: '2026-11-10', charge: 100 }]), '2026-11-10');
  const M = E.model(r.book, ROSTER, { asOf: '2026-11-10' });
  eq('period = cycle-2026-11, asOf 10 Nov, Hrs as-at 11 Nov', [M.period.key, M.period.asOf, M.period.hrsAsAt], ['cycle-2026-11', '2026-11-10', '2026-11-11']);
  const a1 = M.agents.find(a => a.code === 'CB9101');
  eq('CB9101 MTD: 3 in play (1 opening, 2 current), 1 fitted, 2 scheduled', [a1.mtd.sales, a1.mtd.current, a1.mtd.rollover, a1.mtd.fitted, a1.mtd.scheduled], [3, 2, 1, 1, 2]);
  eq('…sales without a sale day = 1 (the opening case)', a1.mtd.noSaleDay, 1);
  eq('…Cancelled is a real count: 0 when nothing dropped out of a complete day (derived cancellation, 2026-11-23)', [a1.mtd.cancelled, a1.mtd.canRate], [0, 0]);
  eq('…fitted value = charge × VAT', a1.mtd.value, 115);
  eq('…fitments done on 10 Nov in the daily row', a1.days.find(d => d.d === '2026-11-10').fitDone, 1);
  eq('…working days run from the day after the opening extract (3 Nov – 10 Nov, no 4 Nov) = 5', a1.workingDays, 5);
  const a3 = M.agents.find(a => a.code === 'CB9103');
  eq('CB9103 (started 2 Nov) Missed 1, missed appointment on 9 Nov', [a3.mtd.missed, a3.mtd.missAppt], [1, 1]);
  eq('the Referral seller\'s Panimax sale folds to referral', Object.keys(M.agents.find(a => a.code === 'CB9102').leads), ['referral']);
  eq('the unmatched seller is one floor line, never an agent row', [M.floor.unmatched.sellers, M.floor.unmatched.cases, M.agents.some(a => a.name === 'zulu unknown')], [1, 1, false]);
  eq('floor counts include the unmatched case', M.floor.mtd.sales, 6);
  eq('Scheduling agent listed as not rated', M.notRated.filter(n => n.code === 'CB9104').map(n => n.why), ['scheduling']);
  eq('Hrs Ahead over open Scheduled (as-at 11 Nov)', M.floor.hrsAhead.h24, 1);
  eq('TL aggregate exists per team leader code', M.tlAgg.map(t => t.tlCode).sort(), ['CB9190', 'CB9191', 'CB9192']);
  eq('team totals are sums of counts', M.tlAgg.find(t => t.tlCode === 'CB9190').mtd.sales, a1.mtd.sales);
  ok('rates are ratios of sums (floor fitRate = fitted / sales)', M.floor.mtd.fitRate === M.floor.mtd.fitted / M.floor.mtd.sales);
  const D = E.digest(M, { updatedAt: '2026-11-10T08:00:00Z' });
  eq('digest: scorecard vt, drivers once (two), empty false', [D.scorecard, D.drivers.length, D.empty, 'drivers' in D.agents[0].rating], ['vt', 2, false, false]);
  const X = E.emptyCyclePayload('cycle-2026-12', { updatedAt: 'x' });
  eq('empty cycle payload: empty:true, no agents, null figures', [X.empty, X.agents.length, X.floor.mtd, X.period.from], [true, 0, null, '2026-11-26']);
}

/* ---- DERIVED CANCELLATION (owner-approved fix, 2026-11-23: R1–R7). A case that is Scheduled or Missed and is in NEITHER
   file of a COMPLETE extract day (both BI Active Fitted and Scheduled & Missed committed for that date) becomes Cancelled,
   reason 'dropped', as at that day — evaluated when the day's second file commits, against the newest complete day only.
   A BI row with a Contract Deactivate Date (or a Contract Status other than Active) is Cancelled, reason 'deactivated'. */
console.log('\n== derived cancellation: completeness, order, idempotency (R1) ==');
const RC = (...xs) => xs.map(([kind, on]) => ({ kind: kind === 'bi' ? 'bi_fitted' : 'sched_missed', state: 'committed', extract_on: on }));
const day = (book, files, on, receipts) => {   // files: [['bi'|'sm', aoa], …] in upload order; receipts = what is committed BEFORE this day
  let r = { book }, got = receipts.slice(), all = [];
  for (const [k, aoa] of files) { r = merge(r.book, k, aoa, on, { receipts: got }); all.push(r); got = got.concat(RC([k, on])); }
  return { book: r.book, steps: all, receipts: got };
};
const D1 = '2026-11-02', D2 = '2026-11-03', D3 = '2026-11-05', D4 = '2026-11-06', D5 = '2026-11-09';
const start = day(E.emptyBook(), [['bi', biFile([{ cn: 91000001, inst: '2026-11-02' }])], ['sm', smFile([{ cn: 91000002 }, { cn: 91000003, outcome: 'Missed Fitment', appt: '2026-11-02' }, { cn: 91000004 }])]], D1, []);
{ const st = (b, cn) => b.cases[cn].status;
  eq('day 1 (both files): nothing to cancel on a new book', start.steps.map(s => s.counts.toCancelled), [0, 0]);
  /* day 2, BI first: one file alone never cancels — a case absent from BI may be in that day's S&M */
  const biOnly = merge(start.book, 'bi', biFile([{ cn: 91000001, inst: '2026-11-02' }]), D2, { receipts: start.receipts });
  eq('one file of a day alone cancels nothing (BI only, S&M not in yet)', [biOnly.counts.toCancelled, st(biOnly.book, 91000002), st(biOnly.book, 91000003)], [0, 'scheduled', 'missed']);
  ok('…and its receipt says the day is waiting for its other file', biOnly.counts.completeDay === false && /Scheduled & Missed/.test(biOnly.cancel.note), JSON.stringify(biOnly.cancel));
  const smOnly = merge(start.book, 'sm', smFile([{ cn: 91000004 }]), D2, { receipts: start.receipts });
  eq('one file of a day alone cancels nothing (S&M only, BI not in yet)', [smOnly.counts.toCancelled, st(smOnly.book, 91000002)], [0, 'scheduled']);
  /* the second file completes day 2: 91000002 (scheduled) and 91000003 (missed) are in neither file → cancelled, dropped */
  const biThenSm = day(start.book, [['bi', biFile([{ cn: 91000001, inst: '2026-11-02' }])], ['sm', smFile([{ cn: 91000004 }])]], D2, start.receipts);
  const smThenBi = day(start.book, [['sm', smFile([{ cn: 91000004 }])], ['bi', biFile([{ cn: 91000001, inst: '2026-11-02' }])]], D2, start.receipts);
  const B = biThenSm.book;
  eq('the second file of a complete day cancels the open cases in neither file', [st(B, 91000002), st(B, 91000003), st(B, 91000004), st(B, 91000001)], ['cancelled', 'cancelled', 'scheduled', 'fitted']);
  eq('…reason dropped, as at that extract day', [B.cases[91000002].cancelReason, B.cases[91000002].statusOn, B.cases[91000003].cancelReason], ['dropped', D2, 'dropped']);
  eq('…one event each, from the last known status, reason dropped', biThenSm.steps[1].events.filter(e => e.to === 'cancelled').map(e => [e.caseNumber, e.from, e.onDate, e.reason]),
    [['91000002', 'scheduled', D2, 'dropped'], ['91000003', 'missed', D2, 'dropped']]);
  eq('…counted on the receipt (toCancelled 2, dropped 2, deactivated 0)', [biThenSm.steps[1].counts.toCancelled, biThenSm.steps[1].counts.cancelledDropped, biThenSm.steps[1].counts.cancelledDeactivated], [2, 2, 0]);
  eq('…and only the triggering (second) file wrote them', biThenSm.steps[0].counts.toCancelled, 0);
  const canon = b => JSON.stringify(Object.keys(b.cases).sort().map(k => [k, b.cases[k].status, b.cases[k].statusOn, b.cases[k].cancelReason]))
    + JSON.stringify(b.events.map(e => [e.caseNumber, e.from, e.to, e.onDate, e.reason]).sort());
  eq('upload order does not matter: S&M first then BI gives the same book and events', canon(smThenBi.book), canon(B));
  const again = merge(B, 'sm', smFile([{ cn: 91000004 }]), D2, { receipts: biThenSm.receipts });
  eq('re-merging the second file (the day already complete) changes nothing', [again.cases.length, again.events.length], [0, 0]);
  const againBi = merge(B, 'bi', biFile([{ cn: 91000001, inst: '2026-11-02' }]), D2, { receipts: biThenSm.receipts });
  eq('…nor does the first file again', [againBi.cases.length, againBi.events.length], [0, 0]);
  const noRc = merge(biOnly.book, 'sm', smFile([{ cn: 91000004 }]), D2, {});
  eq('without the receipts the day cannot be proved complete: nothing is cancelled (safe default)', [noRc.counts.toCancelled, st(noRc.book, 91000002)], [0, 'scheduled']);

  console.log('\n== derived cancellation: gaps, out-of-order days, reappearance (R1, R2) ==');
  /* a skipped day: day 2 has no files at all; day 3 complete → cancelled as at day 3, never day 2 */
  const skip = day(start.book, [['bi', biFile([{ cn: 91000001, inst: '2026-11-02' }])], ['sm', smFile([{ cn: 91000004 }])]], D3, start.receipts);
  eq('a skipped day cancels nothing by itself: the next complete day does, dated that day', [st(skip.book, 91000002), skip.book.cases[91000002].statusOn], ['cancelled', D3]);
  const halfDay = merge(start.book, 'bi', biFile([{ cn: 91000001, inst: '2026-11-02' }]), D2, { receipts: start.receipts });
  const afterHalf = day(halfDay.book, [['sm', smFile([{ cn: 91000004 }])], ['bi', biFile([{ cn: 91000001, inst: '2026-11-02' }])]], D3, start.receipts.concat(RC(['bi', D2])));
  eq('a day with only one file never completes; the next complete day decides', [halfDay.counts.toCancelled, afterHalf.book.cases[91000002].statusOn], [0, D3]);
  /* an older day arriving late: day 2's two files after day 3 is complete. 91000002 is in day 2's S&M: it stays cancelled
     (as at day 3), last_seen moves to day 2; and day 2 completing evaluates nothing (a newer complete day exists). */
  const late = day(skip.book, [['sm', smFile([{ cn: 91000002 }, { cn: 91000004 }])], ['bi', biFile([{ cn: 91000001, inst: '2026-11-02' }])]], D2, skip.receipts);
  eq('a late file for an OLDER day never un-cancels: the case stays cancelled as at the newer complete day', [st(late.book, 91000002), late.book.cases[91000002].statusOn, late.book.cases[91000002].lastSeen], ['cancelled', D3, D2]);
  eq('…and completing the older day cancels nothing (only the newest complete day is evaluated)', late.steps.map(s => s.counts.toCancelled), [0, 0]);
  ok('…its receipt says why', /newer complete day/.test(late.steps[1].cancel.note), late.steps[1].cancel.note);
  const lateOpen = day(start.book, [['bi', biFile([{ cn: 91000001, inst: '2026-11-02' }])], ['sm', smFile([{ cn: 91000002 }, { cn: 91000003, outcome: 'Missed Fitment', appt: '2026-11-02' }, { cn: 91000004 }])]], D3, start.receipts);
  const lateOld = day(lateOpen.book, [['bi', biFile([{ cn: 91000001, inst: '2026-11-02' }])], ['sm', smFile([{ cn: 91000004 }])]], D2, lateOpen.receipts);
  eq('…nor does it cancel an open case that a newer day still carries', [st(lateOld.book, 91000002), st(lateOld.book, 91000003)], ['scheduled', 'missed']);
  /* reappearance: cancelled on day 2, the case is back in day 4's S&M as Missed → Missed, one event cancelled → missed */
  const back = merge(B, 'sm', smFile([{ cn: 91000002, outcome: 'Missed Fitment', appt: '2026-11-05', attempt: '2nd attempt' }, { cn: 91000004 }]), D4, { receipts: biThenSm.receipts });
  eq('a dropped case seen again in a later file takes that file\'s status (R2)', [st(back.book, 91000002), back.book.cases[91000002].cancelReason, back.book.cases[91000002].statusOn], ['missed', null, D4]);
  eq('…with one event cancelled → missed, counted as a return', [back.events.filter(e => e.caseNumber === '91000002').map(e => [e.from, e.to, e.onDate, e.reason]), back.counts.reappeared], [[['cancelled', 'missed', D4, null]], 1]);
  const backBi = merge(B, 'bi', biFile([{ cn: 91000003, inst: '2026-11-06' }]), D4, { receipts: biThenSm.receipts });
  eq('…a dropped case later fitted is Fitted (Fitted > Missed > Scheduled as before)', [st(backBi.book, 91000003), backBi.book.cases[91000003].fittedOn], ['fitted', '2026-11-06']);
  { const M0 = E.model(B, ROSTER, { asOf: D2 }), M1 = E.model(back.book, ROSTER, { asOf: D4 });
    const a0 = M0.agents.find(a => a.code === 'CB9101'), a1 = M1.agents.find(a => a.code === 'CB9101');
    eq('nothing is double counted: the returning case is still one sale (sales unchanged, cancelled → missed)', [a0.mtd.sales, a1.mtd.sales, a0.mtd.cancelled, a1.mtd.cancelled, a1.mtd.missed], [a0.mtd.sales, a0.mtd.sales, 2, 1, 1]); }

  console.log('\n== derived cancellation: Fitted and the business-month rollover (R3, R5) ==');
  eq('a Fitted case absent from both files of a complete day stays Fitted (R3)', [st(skip.book, 91000001)], ['fitted']);
  { const oct = day(E.emptyBook(), [['bi', biFile([{ cn: 91000011, inst: '2026-10-20' }])], ['sm', smFile([{ cn: 91000012, appt: '2026-10-28' }, { cn: 91000013, appt: '2026-10-28' }])]], '2026-10-20', []);
    const nov = day(oct.book, [['bi', biFile([{ cn: 91000021, inst: '2026-10-27' }])], ['sm', smFile([{ cn: 91000013, appt: '2026-10-30' }, { cn: 91000022 }])]], '2026-10-27', oct.receipts);
    eq('month rollover: last month\'s fitted contract leaves the BI file and stays Fitted', st(nov.book, 91000011), 'fitted');
    eq('…an OLD (rollover) open case in neither file is cancelled too, reason dropped (R5: any age)', [st(nov.book, 91000012), nov.book.cases[91000012].cancelReason, nov.book.cases[91000012].statusOn], ['cancelled', 'dropped', '2026-10-27']);
    eq('…a rollover case still in S&M stays open', st(nov.book, 91000013), 'scheduled');
    const M = E.model(nov.book, ROSTER, { asOf: '2026-10-27', cycleKey: 'cycle-2026-11' });
    const a = M.agents.find(x => x.code === 'CB9101');
    eq('…in the new business month the cancelled rollover case is in play (open at the start) and counts as Cancelled', [a.mtd.rollover, a.mtd.cancelled, a.mtd.scheduled], [2, 1, 2]);
  }

  console.log('\n== explicit deactivation (R4, synthetic rows — the real files never fill it) ==');
  { const deact = (lines) => { const f = biFile(lines); lines.forEach((l, i) => { if (l.deact) f[i + 1][15] = S(l.deact); if (l.cstatus) f[i + 1][1] = l.cstatus; }); return f; };
    const p = E.parseBi(deact([{ cn: 91000031, inst: '2026-11-03', deact: '2026-11-04' }, { cn: 91000032, inst: '2026-11-03', cstatus: 'Inactive' }, { cn: 91000033, inst: '2026-11-03' }]));
    eq('parseBi reads Contract Deactivate Date (P) and Contract Status (B) of a VT line', [p.cases[91000031].deactivated, p.cases[91000031].deactivatedOn, p.cases[91000032].deactivated, p.cases[91000032].deactivatedOn, p.cases[91000033].deactivated],
      [true, '2026-11-04', true, null, false]);
    ok('…and never carries the Contract Status text out of the parse', !JSON.stringify(p).includes('Inactive'));
    const fitted = merge(E.emptyBook(), 'bi', biFile([{ cn: 91000031, inst: '2026-11-03' }, { cn: 91000032, inst: '2026-11-03' }]), D2, {});
    const later = merge(fitted.book, 'bi', deact([{ cn: 91000031, inst: '2026-11-03', deact: '2026-11-04' }, { cn: 91000032, inst: '2026-11-03', cstatus: 'Inactive' }]), D4, {});
    eq('a deactivated contract is Cancelled, reason deactivated — it wins over Fitted', [later.book.cases[91000031].status, later.book.cases[91000031].cancelReason, later.book.cases[91000032].status], ['cancelled', 'deactivated', 'cancelled']);
    eq('…as at the deactivate date (no date: the extract day)', [later.book.cases[91000031].statusOn, later.book.cases[91000032].statusOn], ['2026-11-04', D4]);
    eq('…one event fitted → cancelled each, reason deactivated', later.events.map(e => [e.caseNumber, e.from, e.to, e.onDate, e.reason]), [['91000031', 'fitted', 'cancelled', '2026-11-04', 'deactivated'], ['91000032', 'fitted', 'cancelled', D4, 'deactivated']]);
    eq('…counted as deactivated on the receipt', [later.counts.toCancelled, later.counts.cancelledDeactivated, later.counts.cancelledDropped], [2, 2, 0]);
    const same = merge(E.emptyBook(), 'bi', deact([{ cn: 91000034, inst: '2026-11-03', deact: '2026-11-03' }]), D2, {});
    const sameSm = merge(same.book, 'sm', smFile([{ cn: 91000034 }]), D2, {});
    eq('a new case deactivated on its first file: Cancelled; the same day\'s S&M Scheduled does not override it', [same.book.cases[91000034].status, sameSm.book.cases[91000034].status], ['cancelled', 'cancelled']);
    const reAct = merge(later.book, 'bi', biFile([{ cn: 91000031, inst: '2026-11-03' }]), D5, {});
    eq('a NEWER BI row that is Active again (no deactivate date) → Fitted, one event', [reAct.book.cases[91000031].status, reAct.events.map(e => [e.from, e.to])], ['fitted', [['cancelled', 'fitted']]]);
    const oldAct = merge(later.book, 'bi', biFile([{ cn: 91000031, inst: '2026-11-03' }]), D3, {});
    eq('…an OLDER Active row never undoes the deactivation', oldAct.book.cases[91000031].status, 'cancelled');
    const smAfter = merge(later.book, 'sm', smFile([{ cn: 91000031 }]), D5, {});
    eq('…nor does a later S&M booking (only Salesforce\'s contract can reactivate it)', smAfter.book.cases[91000031].status, 'cancelled');
    /* the same day twice: fitted on 3 Nov, then a deactivation dated on or before it → both events on 3 Nov. Read back from
       vt_book (events in to_status order: cancelled before fitted) the model must still end on Cancelled */
    { const f3 = merge(E.emptyBook(), 'bi', biFile([{ cn: 91000036, inst: '2026-11-03' }]), D3, {});
      const d3 = merge(f3.book, 'bi', deact([{ cn: 91000036, inst: '2026-11-03', deact: '2026-11-01' }]), D4, {});
      const evs = d3.book.events.filter(e => e.caseNumber === '91000036');
      eq('a deactivation dated before the last status day counts from that day (never earlier)', evs.map(e => [e.to, e.onDate]), [['fitted', D3], ['cancelled', D3]]);
      const dbOrder = Object.assign({}, d3.book, { events: evs.slice().sort((x, y) => x.to.localeCompare(y.to)) });
      eq('…and the model ends on Cancelled whatever order the two same-day events come back in', E.model(dbOrder, ROSTER, { asOf: D4 }).floor.mtd.cancelled, 1); }
    const noCols = biFile([{ cn: 91000035, inst: '2026-11-03' }]); noCols[0] = noCols[0].slice(); noCols[0][1] = 'Account Type'; noCols[0][15] = 'Something Else';
    const pn = E.parseBi(noCols);
    eq('a BI file without the two columns still parses (tolerant): nothing deactivated, nothing missing', [pn.missing, pn.cases[91000035] && pn.cases[91000035].deactivated], [[], false]);
    const M = E.model(later.book, ROSTER, { asOf: D4 }), a = M.agents.find(x => x.code === 'CB9101');
    eq('the deactivated unit leaves Fitted (status) but its install still counts as a fitment done on its day', [a.mtd.fitted, a.mtd.cancelled, a.mtd.fitDone], [0, 2, 2]);
  }

  console.log('\n== a cancelled sale leaves the Missed count; Cancellation % on every period view (R6, R7); the score counts it once, in Fitment Rate (vt-1.2) ==');
  { const open = day(E.emptyBook(), [['bi', biFile([{ cn: 91000040, inst: '2026-11-02', seller: 'Bravo Middle Tester' }])], ['sm', smFile([])]], D1, []);   // the opening extract (no sale day)
    const five = day(open.book, [['bi', biFile([{ cn: 91000041, inst: '2026-11-03' }, { cn: 91000042, inst: '2026-11-03' }, { cn: 91000043, inst: '2026-11-03' }])],
      ['sm', smFile([{ cn: 91000044, outcome: 'Missed Fitment', appt: '2026-11-03' }, { cn: 91000045, outcome: 'Missed Fitment', appt: '2026-11-03' }])]], D2, open.receipts);
    const gone = day(five.book, [['bi', biFile([{ cn: 91000041, inst: '2026-11-03' }])], ['sm', smFile([{ cn: 91000044, outcome: 'Missed Fitment', appt: '2026-11-03' }])]], D3, five.receipts);
    const M0 = E.model(five.book, ROSTER, { asOf: D3 }), M1 = E.model(gone.book, ROSTER, { asOf: D3 });
    const a0 = M0.agents.find(x => x.code === 'CB9101').mtd, a1 = M1.agents.find(x => x.code === 'CB9101').mtd;
    eq('before: 5 sales, 2 missed, Missed Rate 40 %, Cancelled 0 (a real nought, not "—")', [a0.sales, a0.missed, a0.missRate, a0.cancelled, a0.canRate], [5, 2, 0.4, 0, 0]);
    eq('after one Missed case drops out: still 5 sales (cancelled sales stay in Sales), 1 missed, Missed Rate 20 %', [a1.sales, a1.missed, a1.missRate, a1.cancelled], [5, 1, 0.2, 1]);
    eq('…Cancellation % = cancelled ÷ sales = 20 %, beside the 5 % budget', [a1.canRate, a1.canBudget], [0.2, 0.05]);
    eq('…Fitment Rate unchanged (fitted ÷ all sales)', [a0.fitRate, a1.fitRate], [0.6, 0.6]);
    const r0 = M0.agents.find(x => x.code === 'CB9101').rating, r1 = M1.agents.find(x => x.code === 'CB9101').rating;
    const part = (r, k) => r.parts.find(p => p.k === k);
    eq('the rating has its two drivers and weights (50/50) — no Missed, Fitted vs target or Cancellation driver', r1.parts.map(p => [p.k, p.w]), [['targetAch', 50], ['fitRate', 50]]);
    eq('…a Missed sale turning Cancelled does not move the score (it was not fitted either way)', [r1.score, part(r1, 'fitRate').value], [r0.score, part(r0, 'fitRate').value]);
    eq('…the unscored info line reads the change: missed 2 → 1, cancelled 0 → 1', [r0.info.missed, r1.info.missed, r0.info.cancelled, r1.info.cancelled, r1.info.canBudget], [2, 1, 0, 1, 0.05]);
    const ag1 = M1.agents.find(x => x.code === 'CB9101');
    const wk = ag1.weeks.find(w => w.from <= D2 && w.to >= D2), dd = ag1.days.find(x => x.d === D2);
    eq('Weekly: the week the sales were made shows Cancelled 1 and Cancellation % 20 %', [wk.sales, wk.cancelled, wk.canRate], [5, 1, 0.2]);
    eq('Daily: the sale day shows Cancelled 1 of 5', [dd.sales, dd.cancelled, dd.canRate], [5, 1, 0.2]);
    eq('…a day with no sales: Cancelled 0, Cancellation % "—" (no sales to divide)', [ag1.days.find(x => x.d === D3).cancelled, ag1.days.find(x => x.d === D3).canRate], [0, null]);
    const tl = M1.tlAgg.find(t => t.tlCode === 'CB9190'), sub = M1.subAgg.digital, lead = M1.leadAgg.revx;
    eq('team leader, sub-campaign, lead source and floor carry Cancelled and Cancellation %', [tl.mtd.cancelled, sub.mtd.cancelled, lead.mtd.cancelled, M1.floor.mtd.cancelled, M1.floor.mtd.canRate], [1, 1, 1, 1, 1 / 6]);
    eq('…and the cancellation budget at sub-campaign and floor level', [sub.mtd.canBudget, M1.floor.mtd.canBudget], [0.05, 0.05]);
    eq('the model publishes the cancellation budget', M1.budgets.cancelled, { '*': 0.05 });
    const D = E.digest(M1, { updatedAt: 'x' });
    ok('digest day rows carry cancelled and canRate by name (dayCols)', D.dayCols.includes('cancelled') && D.dayCols.includes('canRate')
      && D.agents.find(x => x.code === 'CB9101').days.find(c => c[0] === D2)[D.dayCols.indexOf('cancelled')] === 1, JSON.stringify(D.dayCols));
  }
  eq('the rule book defines Cancelled (cancelledFrom no longer null)', E.VT_RULES.status.cancelledFrom, ['dropped', 'deactivated']);
}

finish();
