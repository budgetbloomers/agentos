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
  const parsed = kind === 'bi' ? E.parseBi(aoa) : kind === 'sm' ? E.parseSm(aoa) : E.parseOpeningBook(aoa);
  return E.merge(book, parsed, Object.assign({ extractOn: on, roster: ROSTER, aliases: {} }, extra));
};

console.log('\n== detection ==');
eq('BI Active Fitted header → vtBiFitted', E.detect(BI_HDR, 'Export'), 'vtBiFitted');
eq('Scheduled & Missed header → vtSchedMissed', E.detect(SM_HDR, 'Export'), 'vtSchedMissed');
eq('Schedulers Data header → vtOpeningBook', E.detect(['Month', 'Date', 'Agent', 'Sale Count', 'GWP', 'Case Number', 'Customer Contact', 'Campaign/Partner', 'Referring Agent', 'Scheduler', 'Result'], 'Schedulers Data'), 'vtOpeningBook');
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
  const ob = [['Month', 'Date', 'Agent', 'Sale Count', 'GWP', 'Case Number', 'Customer Contact', 'Campaign/Partner', 'Referring Agent', 'Scheduler', 'Result'],
    ['Rollover', S('2026-10-20'), 'Somebody', 1, 99, 90000051, '0820000001', 'Revx', null, 'Sched', 'Missed'],
    ['Current', S('2026-11-02'), 'Somebody', 1, 99, 90000052, '0820000001', 'Revx', null, 'Sched', 'Fitted'],
    ['Current', S('2026-11-03'), 'Somebody', 1, 99, 90000099, '0820000001', 'Revx', null, 'Sched', 'Cancelled']];
  const p = E.parseOpeningBook(ob);
  ok('the opening book keeps the sale date only (no Result, GWP, contact, agent)', !JSON.stringify(p).match(/Missed|Fitted|Cancelled|0820000001|Somebody|Sched/), JSON.stringify(p).slice(0, 200));
  const r2 = E.merge(r.book, p, { extractOn: '2026-11-10', roster: ROSTER, aliases: {} });
  eq('the opening book supplies the sale day (basis opening_book)', [r2.book.cases['90000051'].soldOn, r2.book.cases['90000051'].soldBasis], ['2026-10-20', 'opening_book']);
  eq('…never changes a status', r2.book.cases['90000051'].status, 'scheduled');
  eq('…counts the cases it could not place (not in the book)', r2.counts.notInBook, 1);
  eq('…and it marks the book as dated (rating counts every working day)', r2.book.openingBookOn, '2026-11-10');
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
  eq('receipt counts', r2.counts, { rows: 1, vtLines: 1, cases: 1, new: 0, toFitted: 1, toMissed: 0, toScheduled: 0, changed: 1, skippedFooter: 1, skippedBlank: 0, notInBook: 0 });
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
  eq('…Cancelled is absent (null), never 0', a1.mtd.cancelled, null);
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
  eq('digest: scorecard vt, drivers once, empty false', [D.scorecard, D.drivers.length, D.empty, 'drivers' in D.agents[0].rating], ['vt', 4, false, false]);
  const X = E.emptyCyclePayload('cycle-2026-12', { updatedAt: 'x' });
  eq('empty cycle payload: empty:true, no agents, null figures', [X.empty, X.agents.length, X.floor.mtd, X.period.from], [true, 0, null, '2026-11-26']);
}

finish();
