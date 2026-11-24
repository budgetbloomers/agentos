/* VT ORACLE (Spec Kit 071 SC-001, SC-002, plan §T). Feeds the owner's real sample uploads through
 * VTEngine in Node and checks every figure that IS reproducible from them against the hand-built
 * answer key, November 2026 - VT Report.xlsx. Expected values are DERIVED here at run time from
 * that workbook (restricted to the rows the uploads can reproduce), plus the fixed aggregates the
 * spec states (1,756 / 1,104 / 153 / 499 / Hrs 136-83-99-181 / sellers 41 + CB342).
 *
 * The files live OUTSIDE git (../reference/zips/vt/). If they are absent the suite says so and
 * exits 0, so CI without them stays green. Output names people by CB only; sellers who resolve to
 * no CB are printed as U1, U2 … — never by name. No customer field is printed or written.
 *
 * Every figure that cannot be reproduced is listed under DOCUMENTED DIFFERENCES with its measured
 * count beside the count the spec predicts. Nothing is special-cased to pass.
 *
 * Run:  node verify-vt-oracle.mjs          (scratch summary → diagnostics/scratch/vt/oracle.json)
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const REPO = process.env.AGENTOS || decodeURIComponent(new URL('../..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1').replace(/\/$/, '');
const VT_DIR = process.env.VT_REFERENCE || path.join(path.dirname(REPO), 'reference', 'zips', 'vt');
const ENGINE = path.join(REPO, 'nicks_code', 'vt-engine.js');
const SCRATCH = path.join(REPO, 'nicks_code', 'diagnostics', 'scratch', 'vt');
let pass = 0, fail = 0; const failures = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; failures.push(n + (d ? ' — ' + d : '')); console.log('  FAIL ' + n + (d ? ' — ' + d : '')); } };
const eq = (n, got, exp) => ok(n, JSON.stringify(got) === JSON.stringify(exp), 'expected ' + JSON.stringify(exp) + ' got ' + JSON.stringify(got));
const documented = [];
const doc = (what, measured, predicted, why) => { documented.push({ what, measured, predicted, why }); };
const finish = () => {
  console.log('\n== DOCUMENTED DIFFERENCES (not reproducible from the three uploads — never special-cased) ==');
  documented.forEach(d => console.log(`  diff ${d.what}: measured ${JSON.stringify(d.measured)} · spec predicts ${JSON.stringify(d.predicted)} — ${d.why}`));
  console.log(`\n${pass} passed, ${fail} failed, ${documented.length} documented differences`);
  failures.forEach(f => console.log('  · ' + f));
  try { fs.mkdirSync(SCRATCH, { recursive: true }); fs.writeFileSync(path.join(SCRATCH, 'oracle.json'), JSON.stringify({ pass, fail, failures, documented }, null, 1)); } catch (e) { console.log('  note scratch not written: ' + e.message); }
  process.exit(fail ? 1 : 0);
};

const FILES = { bi: 'BI Active Fitted 101126.xlsx', sm: 'Scheduled & Missed 101126.xlsx', al: 'Matrix - Agent List.xlsx', rpt: 'November 2026 - VT Report.xlsx', sr: 'Sales_Review_YTD 2026.xlsx' };
const missingFiles = Object.values(FILES).filter(f => !fs.existsSync(path.join(VT_DIR, f)));
if (missingFiles.length) {
  console.log(`\nSKIP verify-vt-oracle: the owner's sample files are not on this machine (${VT_DIR}; missing ${missingFiles.join(', ')}).`);
  console.log('     They live outside git by design. Unit suites verify-vt-engine / -periods / -rating / -rules still run.');
  process.exit(0);
}
if (!fs.existsSync(ENGINE)) { ok('nicks_code/vt-engine.js exists', false, 'missing'); finish(); }
const E = require(ENGINE);
const XLSX = require('xlsx');
const wb = f => XLSX.readFile(path.join(VT_DIR, f));
const aoaOf = (w, s) => XLSX.utils.sheet_to_json(w.Sheets[s || w.SheetNames[0]], { header: 1, raw: true, defval: null });
const cnKey = v => { const s = String(v == null ? '' : v).trim(); return /^\d+$/.test(s) ? s.replace(/^0+(?=\d)/, '') : s; };

/* ---- load --------------------------------------------------------------------------------------- */
const biAoa = aoaOf(wb(FILES.bi)), smAoa = aoaOf(wb(FILES.sm));
const alWb = wb(FILES.al), rptWb = wb(FILES.rpt), srWb = wb(FILES.sr);
const rpt = aoaOf(rptWb, 'Schedulers Data');
const roster = E.parseRoster(aoaOf(alWb, 'VT'), aoaOf(alWb, 'TL'), '2026-11-10');
const ext = E.extractDate(FILES.bi, '2099-01-01');

console.log('\n== intake: detection, extract date, receipts ==');
eq('BI Active Fitted is detected as vtBiFitted (never VAS bi)', E.detect(biAoa[0], 'Export'), 'vtBiFitted');
eq('Scheduled & Missed is detected as vtSchedMissed', E.detect(smAoa[0], 'Export'), 'vtSchedMissed');
eq('the hand report\'s Schedulers Data is detected as vtOpeningBook', E.detect(rpt[0], 'Schedulers Data'), 'vtOpeningBook');
eq('the Agent List VT sheet is not a VT upload', E.detect(aoaOf(alWb, 'VT')[0], 'VT'), null);
eq('extract date from "101126" = 10 Nov 2026', ext, { date: '2026-11-10', assumed: false });
const pBi = E.parseBi(biAoa), pSm = E.parseSm(smAoa);
eq('BI receipt: 19,404 rows, 1,107 VT lines, 1,104 cases, 1 footer', [pBi.rows, pBi.vtLines, Object.keys(pBi.cases).length, pBi.skippedFooter], [19404, 1107, 1104, 1]);
eq('BI: no required column missing', pBi.missing, []);
eq('S&M receipt: 1,078 rows, 656 cases, 1 footer', [pSm.rows, Object.keys(pSm.cases).length, pSm.skippedFooter], [1078, 656, 1]);
eq('VT roster from the Agent List: 48 people (42 sales + 6 schedulers)', [roster.length, roster.filter(r => r.sub === 'scheduling').length], [48, 6]);
eq('VT team leaders resolve to CB194 / CB104 / CB360 / CB358', [...new Set(roster.map(r => r.tlCode))].sort(), ['CB104', 'CB194', 'CB358', 'CB360']);

let m1 = E.merge(E.emptyBook(), pBi, { extractOn: ext.date, roster, aliases: {} });
let m2 = E.merge(m1.book, pSm, { extractOn: ext.date, roster, aliases: {} });
const book = m2.book;
eq('book after both files: 1,756 cases', Object.keys(book.cases).length, 1756);
eq('BI merge: 1,104 new, 1,104 → fitted', [m1.counts.new, m1.counts.toFitted], [1104, 1104]);
eq('S&M merge: 652 new (4 already Fitted stay Fitted), 499 → scheduled, 153 → missed', [m2.counts.new, m2.counts.toScheduled, m2.counts.toMissed], [652, 499, 153]);
{ const again = E.merge(book, pSm, { extractOn: ext.date, roster, aliases: {} });
  eq('the same S&M file again changes nothing', [again.cases.length, again.events.length], [0, 0]); }

/* ---- the answer key, keyed by case ----------------------------------------------------------- */
const RES = { Fitted: 'fitted', Missed: 'missed', Scheduled: 'scheduled', Cancelled: 'cancelled' };
const report = new Map();
for (const r of rpt.slice(1)) { if (r[5] == null) continue;
  report.set(cnKey(r[5]), { month: r[0], date: r[1], agent: r[2], partner: r[7], result: RES[r[10]] || r[10], hrs: r[11] == null ? '' : String(r[11]) }); }
const repro = [...report.keys()].filter(k => book.cases[k]);

console.log('\n== SC-001: case status, 1,756 of 1,756 ==');
const statusMismatch = Object.keys(book.cases).filter(k => !report.has(k) || report.get(k).result !== book.cases[k].status);
statusMismatch.slice(0, 15).forEach(k => console.log(`    case …${k.slice(-3)} expected ${report.has(k) ? report.get(k).result : '(not in report)'} got ${book.cases[k].status}`));
eq('every case the uploads carry gets the report\'s Result', [Object.keys(book.cases).length - statusMismatch.length, Object.keys(book.cases).length], [1756, 1756]);
const byStatus = s => Object.values(book.cases).filter(c => c.status === s).length;
eq('Fitted 1,104 · Missed 153 · Scheduled 499', [byStatus('fitted'), byStatus('missed'), byStatus('scheduled')], [1104, 153, 499]);
{ const notExplained = [...report.entries()].filter(([k]) => !book.cases[k]);
  const br = {}; notExplained.forEach(([, v]) => { const kk = v.result + '/' + v.month; br[kk] = (br[kk] || 0) + 1; });
  doc('report rows no upload explains (status history + Cancelled)', { rows: notExplained.length, breakdown: br }, { rows: 178, note: 'spec/workbook-rules 3.1 say 178; the same table rows sum to 268 (204 Cancelled + 64 other)' },
    'Result is sticky and typed by hand; one day of uploads cannot rebuild earlier statuses (A7). Cancelled is DERIVED from absence on a complete day (A13), so one day of uploads alone cannot show it — see the R10 section.'); }

/* ---- sellers -------------------------------------------------------------------------------- */
console.log('\n== sellers (FR-016): 41 matched + CB342 by near-spelling; the rest unmatched ==');
const uName = new Map(); const uid = n => { if (!uName.has(n)) uName.set(n, 'U' + (uName.size + 1)); return uName.get(n); };
function sellerStats(chain) {
  const names = new Map();
  const add = (n, src, cn) => { const e = names.get(n) || { bi: new Set(), sm: new Set() }; e[src].add(cn); names.set(n, e); };
  for (const [cn, c] of Object.entries(pBi.cases)) add(c.seller, 'bi', cn);
  for (const [cn, c] of Object.entries(pSm.cases)) add(c.seller, 'sm', cn);
  const out = { methods: {}, unmatched: [], biCases: 0, smCases: 0, byName: new Map() };
  for (const [n, e] of names) { const r = E.resolveSeller(n, roster, {}, chain ? { chain } : undefined); out.byName.set(n, r);
    out.methods[r.method] = (out.methods[r.method] || 0) + 1;
    if (!r.code) { out.unmatched.push(n); out.biCases += e.bi.size; out.smCases += e.sm.size; } }
  return out;
}
const full = sellerStats(null), noNear = sellerStats(['exact', 'alias', 'first_last']);
eq('without near-spelling: 8 unmatched names, 49 BI + 17 S&M cases (workbook-rules 4.1)', [noNear.unmatched.length, noNear.biCases, noNear.smCases], [8, 49, 17]);
const nearHits = [...full.byName.values()].filter(r => r.method === 'near').map(r => r.code);
eq('the one-letter variant resolves to CB342 by near-spelling', nearHits, ['CB342']);
const fl = [...full.byName.values()].filter(r => r.method === 'first_last').map(r => r.code).sort();
eq('first + last token resolves CB14, CB346, CB354', fl, ['CB14', 'CB346', 'CB354']);
eq('41 sellers resolve exact or first+last, plus CB342 near', [[...full.byName.values()].filter(r => r.method === 'exact' || r.method === 'first_last').length, nearHits.length], [41, 1]);
eq('the 7 on no list sheet stay unmatched (46 BI + 15 S&M cases)', [full.unmatched.length, full.biCases, full.smCases], [7, 46, 15]);
ok('no unmatched name is forced onto a CB', full.unmatched.every(n => full.byName.get(n).code === null));
console.log('    unmatched: ' + full.unmatched.map(uid).join(', '));
doc('unmatched sellers (spec edge case says "7 sellers, 49 BI + 17 S&M cases")', { names: full.unmatched.length, bi: full.biCases, sm: full.smCases }, { names: 7, bi: 49, sm: 17 },
  'the 49/17 counts include CB342\'s variant (3 BI + 2 S&M), which near-spelling resolves; 7 names carry 46 BI + 15 S&M cases');

/* ---- attribution and lead source vs the hand report ----------------------------------------- */
const M = E.model(book, roster, { asOf: ext.date });
const sellerOf = k => { const c = book.cases[k]; return c.sellerCb || null; };
const repAgentCb = new Map(); const repCb = name => { const n = E.normSeller(name); if (!repAgentCb.has(n)) repAgentCb.set(n, E.resolveSeller(n, roster, {}).code); return repAgentCb.get(n); };
const credit = repro.filter(k => { const a = repCb(report.get(k).agent), b = sellerOf(k); return (a || b) ? a !== b : E.normSeller(report.get(k).agent) !== book.cases[k].sellerName; });
doc('manual credits (report Agent ≠ Salesforce Created By)', credit.length, 11, 'A10: the engine follows Salesforce Created By; creditOverrides is empty');
const REP_LEAD = { revx: 'revx', 'tracking empire': 'tracking_empire', jag: 'jag', afrilead: 'afrilead', predictive: 'predictive', 'referral agent': 'referral' };
const repLead = k => REP_LEAD[String(report.get(k).partner || '').trim().toLowerCase()] || 'other';
const engLead = k => { const c = book.cases[k]; const a = c.sellerCb && roster.find(r => r.code === c.sellerCb); return E.leadSourceOf(c.partnerRaw, a ? a.sub : null); };
const relabel = repro.filter(k => repLead(k) !== engLead(k));
const pairs = {}; relabel.forEach(k => { const p = engLead(k) + '→' + repLead(k); pairs[p] = (pairs[p] || 0) + 1; });
doc('lead source relabelled by hand (Salesforce partner vs report Campaign/Partner)', { cases: relabel.length, share: +(relabel.length / repro.length * 100).toFixed(1) + '%', pairs }, '~5 %',
  'A11: the engine folds the Salesforce Source Partner; the hand label is never imported');
const panimax = repro.filter(k => book.cases[k].partnerRaw === 'Panimax - New Sales' && repLead(k) === 'referral');
doc('report "Referral Agent" rows from Panimax - New Sales placed as Referral by the seller\'s team', { referral: panimax.filter(k => engLead(k) === 'referral').length, of: panimax.length }, '177 of 179 (whole report)', 'A11 split rule');

console.log('\n== per-agent Fitted / Scheduled / Missed (report rows restricted to the same cases) ==');
function tallyReport(keys) { const t = {}; for (const k of keys) { const cb = repCb(report.get(k).agent) || '(unmatched)'; const x = t[cb] || (t[cb] = { fitted: 0, scheduled: 0, missed: 0 }); x[report.get(k).result]++; } return t; }
function agentDiffs(model, expected) {
  const out = [];
  for (const [cb, x] of Object.entries(expected)) { if (cb === '(unmatched)') continue;
    const a = model.agents.find(r => r.code === cb); const g = a ? { fitted: a.mtd.fitted, scheduled: a.mtd.scheduled, missed: a.mtd.missed } : { fitted: 0, scheduled: 0, missed: 0 };
    if (JSON.stringify(g) !== JSON.stringify(x)) out.push(`${cb} expected F/S/M ${x.fitted}/${x.scheduled}/${x.missed} got ${g.fitted}/${g.scheduled}/${g.missed}`); }
  for (const a of model.agents) if (!expected[a.code] && (a.mtd.fitted || a.mtd.scheduled || a.mtd.missed)) out.push(`${a.code} expected none got ${a.mtd.fitted}/${a.mtd.scheduled}/${a.mtd.missed}`);
  return out;
}
{ const all = agentDiffs(M, tallyReport(repro));
  all.forEach(s => console.log('    (all reproducible rows) ' + s));
  const touched = new Set(credit.flatMap(k => [repCb(report.get(k).agent), sellerOf(k)]).filter(Boolean));
  ok('every per-agent difference on reproducible rows is an agent touched by a manual credit', all.every(s => touched.has(s.split(' ')[0])), all.filter(s => !touched.has(s.split(' ')[0])).join(' | '));
  doc('agents whose F/S/M differ on reproducible rows', all.length, 'only agents touched by the 11 manual credits', 'A10');
  const agree = repro.filter(k => !credit.includes(k));
  const subBook = Object.assign({}, book, { cases: Object.fromEntries(agree.map(k => [k, book.cases[k]])), events: book.events.filter(e => agree.includes(e.caseNumber)) });
  const Ms = E.model(subBook, roster, { asOf: ext.date });
  const d = agentDiffs(Ms, tallyReport(agree));
  d.forEach(s => console.log('    ' + s));
  eq('on rows the hand credit agrees with, every matched seller\'s F/S/M equals the report', d.length, 0);
  const tr = tallyReport(agree)['(unmatched)'] || { fitted: 0, scheduled: 0, missed: 0 };
  eq('…and the unmatched line holds the report rows of agents on no list', Ms.floor.unmatched.cases, tr.fitted + tr.scheduled + tr.missed);
}

console.log('\n== pivots restricted to reproducible rows (PD VT Campaign / Lead Gen / Predictive / Referral) ==');
{ const tot = { fitted: 0, scheduled: 0, missed: 0 }; repro.forEach(k => tot[report.get(k).result]++);
  eq('PD VT Campaign on reproducible rows = floor MTD F/S/M', [M.floor.mtd.fitted, M.floor.mtd.scheduled, M.floor.mtd.missed], [tot.fitted, tot.scheduled, tot.missed]);
  eq('floor MTD = 1,104 / 499 / 153 (spec US5-1)', [M.floor.mtd.fitted, M.floor.mtd.scheduled, M.floor.mtd.missed], [1104, 499, 153]);
  const agree = repro.filter(k => repLead(k) === engLead(k));
  const subBook = Object.assign({}, book, { cases: Object.fromEntries(agree.map(k => [k, book.cases[k]])), events: [] });
  const Ml = E.model(subBook, roster, { asOf: ext.date });
  for (const g of ['lead_gen', 'predictive', 'referral']) {
    const exp = { fitted: 0, scheduled: 0, missed: 0 }; agree.filter(k => E.leadGroupOf(repLead(k)) === g).forEach(k => exp[report.get(k).result]++);
    const got = Ml.leadAgg[g] ? Ml.leadAgg[g].mtd : { fitted: 0, scheduled: 0, missed: 0 };
    eq(`PD ${g} (rows where the label agrees) F/S/M`, [got.fitted, got.scheduled, got.missed], [exp.fitted, exp.scheduled, exp.missed]);
  }
  doc('PD VT Campaign grand totals F / M / S / C (whole report)', { report: [1113, 190, 517, 204], engine: [M.floor.mtd.fitted, M.floor.mtd.missed, M.floor.mtd.scheduled, M.floor.mtd.cancelled] },
    { fittedGap: 9, missedGap: 37, scheduledGap: 18, cancelled: 'derived (A13): 0 on a book opened by the 10 Nov files alone — the rule needs an earlier day; R10 measures it' }, 'status history (sticky hand statuses) + Cancelled is derived, never in a file (A7, A13)');
}

console.log('\n== SC-002: Hrs Ahead, 499 of 499 (as-at 11 Nov) ==');
{ const MAP = { '24': 'h24', '48': 'h48', '72': 'h72', '72+': 'h72p' };
  const open = Object.entries(book.cases).filter(([, c]) => c.status === 'scheduled');
  const bad = open.filter(([k, c]) => MAP[report.get(k).hrs] !== E.periods.hrsBucket(c.apptOn, M.period.hrsAsAt));
  bad.slice(0, 10).forEach(([k, c]) => console.log(`    case …${k.slice(-3)} expected ${report.get(k).hrs} got ${E.periods.hrsBucket(c.apptOn, M.period.hrsAsAt)}`));
  eq('every open Scheduled case gets the report\'s bucket', [open.length - bad.length, open.length], [499, 499]);
  const h = M.floor.hrsAhead; eq('floor Hrs Ahead 24/48/72/72+/past = 136/83/99/181/0', [h.h24, h.h48, h.h72, h.h72p, h.past], [136, 83, 99, 181, 0]);
  ok('Hrs Ahead shares are published beside the budget', h.share && Math.abs(h.share.h24 - 136 / 499) < 1e-9 && M.budgets.hrsShare.h24 === 0.8);
  doc('Hrs Ahead buckets (whole report 139/84/105/189)', [h.h24, h.h48, h.h72, h.h72p], [136, 83, 99, 181], '18 Scheduled rows carried from earlier days (3+1+6+8) are in no upload');
}

console.log('\n== Target = sales per working day, per the list (F1, A1) ==');
{ const vt = aoaOf(alWb, 'VT').slice(1).filter(r => r[0]);
  const bad = vt.filter(r => { const a = M.agents.find(x => x.code === E.normCB(r[0])); const exp = typeof r[8] === 'number' && r[8] > 0 ? r[8] : null; return !a || a.target !== exp; });
  eq('every VT row\'s Target = list column I ("-" → no target)', bad.map(r => E.normCB(r[0])), []);
  const b = E.VT_RULES.budgets['cycle-2026-11'].spd;
  const off = M.agents.filter(a => a.sub !== 'scheduling' && a.target !== (b[a.sub][a.tenure] != null ? b[a.sub][a.tenure] : b[a.sub]['*']));
  eq('every sales agent\'s Target equals the November SPD budget for their sub × tenure', off.map(a => a.code), []);
  const g = (s, c) => (srWb.Sheets[s][c] || {}).v;
  eq('rule-book SPD budgets = Sales Review cells N20 / N12 / N46:N48', [b.digital['*'], b.referral['*'], b.predictive.Exp, b.predictive.M2, b.predictive.M1],
    [g('VT Digital', 'N20'), g('VT Referrals', 'N12'), g('VT Predictive', 'N46'), g('VT Predictive', 'N47'), g('VT Predictive', 'N48')]);
  const f = E.VT_RULES.budgets['cycle-2026-11'].fitment;
  eq('rule-book fitment budgets = Sales Review N45 / N17 / N71:N73 / N16', [f.digital['*'], f.referral['*'], f.predictive.Exp, f.predictive.M2, f.predictive.M1, f.floor],
    [g('VT Digital', 'N45'), g('VT Referrals', 'N17'), g('VT Predictive', 'N71'), g('VT Predictive', 'N72'), g('VT Predictive', 'N73'), g('VT Scheduling', 'N16')]);
  const ms = E.VT_RULES.budgets['cycle-2026-11'].missed['*'];
  ok('missed budget 5 % = N22/N7, N24/N9, N25/N10', [['N22', 'N7'], ['N24', 'N9'], ['N25', 'N10']].every(([a, c]) => Math.abs(g('VT Scheduling', a) / g('VT Scheduling', c) - ms) < 1e-9));
}

console.log('\n== business month, weeks, working days ==');
eq('period cycle-2026-11, 26 Oct – 25 Nov, asOf 10 Nov, Hrs as-at 11 Nov', [M.period.key, M.period.from, M.period.to, M.period.asOf, M.period.hrsAsAt], ['cycle-2026-11', '2026-10-26', '2026-11-25', '2026-11-10', '2026-11-11']);
eq('the cycle\'s working days = Sales Review "Dialing Days" N4 (22)', M.workingDays, (srWb.Sheets['VT Digital'].N4 || {}).v);
eq('weeks Mon–Sat clipped: five, from 26 Oct', M.weeks.map(w => w.from), ['2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23']);
eq('report "Current" boundary = the cycle start (no Current row before 26 Oct, no Rollover on/after)',
  [...report.values()].filter(v => (v.month === 'Current') !== (E.serialToISO(v.date) >= M.period.from)).length, 0);
doc('working days elapsed on the go-live book (opening extract 10 Nov, no opening book)', M.workingDaysElapsed, 'n/a',
  'A6: a book opened by the 10 Nov files has no tracked working day yet; sale days need the opening book or later uploads');

console.log('\n== with the optional opening book (FR-003): Current / Rollover and the dated views ==');
{ const ob = E.parseOpeningBook(rpt);
  ok('the opening book takes only case → sale date', Object.values(ob.cases).every(c => Object.keys(c).join() === 'soldOn'));
  const m3 = E.merge(book, ob, { extractOn: ext.date, roster, aliases: {} });
  eq('every reproducible case gets its sale day; the other report rows are counted, not stored', [m3.counts.notInBook, Object.keys(m3.book.cases).length], [report.size - repro.length, 1756]);
  const Mo = E.model(m3.book, roster, { asOf: ext.date });
  const badMonth = repro.filter(k => { const c = m3.book.cases[k]; return (c.soldOn >= Mo.period.from ? 'Current' : 'Rollover') !== report.get(k).month; });
  eq('Current / Rollover equals the report\'s Month on every reproducible row', badMonth.length, 0);
  const cur = repro.filter(k => report.get(k).month === 'Current').length;
  eq('floor Current / Rollover = report Month split on reproducible rows', [Mo.floor.mtd.current, Mo.floor.mtd.rollover], [cur, repro.length - cur]);
  const byDay = {}; repro.forEach(k => { const d = E.serialToISO(report.get(k).date); byDay[d] = (byDay[d] || 0) + 1; });
  const dayBad = Mo.floor.days.filter(d => (byDay[d.d] || 0) !== d.sales).map(d => `${d.d} expected ${byDay[d.d] || 0} got ${d.sales}`);
  dayBad.forEach(s => console.log('    ' + s));
  eq('Daily: sales per sale day = report rows dated that day (reproducible rows)', dayBad.length, 0);
  const wkBad = Mo.floor.weeks.filter(w => { let n = 0; for (const [d, c] of Object.entries(byDay)) if (d >= w.from && d <= w.to) n += c; return n !== w.sales; });
  eq('Weekly: sales per Mon–Sat week = report rows dated in it', wkBad.map(w => w.k), []);
  eq('working days elapsed with the opening book = 11 (26 Oct – 10 Nov, 4 Nov a holiday)', Mo.workingDaysElapsed, 11);
  eq('no in-play case without a sale day once the book is dated', Mo.floor.mtd.noSaleDay, 0);
  const rated = Mo.agents.filter(a => a.rating.rated);
  ok('every rated agent has a score 0–100 and a VAS band', rated.length > 0 && rated.every(a => a.rating.score >= 0 && a.rating.score <= 100 && a.rating.band), `${rated.length} rated`);
  eq('Scheduling agents are listed not rated', Mo.notRated.filter(n => n.why === 'scheduling').length, 6);
  const rd = Mo.agents.filter(a => a.rating.rated).map(a => `${a.code}:${a.rating.score}`);
  console.log('    ratings (CB:score): ' + rd.join(' '));
  doc('Daily 10 Nov sales (whole report 127) and Weekly 2–7 Nov (500)', { day10: byDay['2026-11-10'] || 0, week2: Mo.floor.weeks[1].sales }, { day10: 127, week2: 500 },
    'the whole-report figures include Cancelled and earlier-status rows the uploads do not carry');
}

console.log('\n== R10 · derived cancellation against the hand report (prior state = Schedulers Data, then 10 Nov as a complete day) ==');
{ /* PRIOR STATE: every report row as a case with the status the report holds, last seen the day before (9 Nov). A row the
     report calls Cancelled has no earlier status on record, so it goes in as Scheduled (open) — the assumption that lets the
     rule meet it; the rule cannot cancel what was never open. Only the case, its sale date and the report's Result are read. */
  const PRIOR = '2026-11-09', TODAY = ext.date;
  const prior = E.emptyBook(); prior.openedOn = '2026-10-01'; prior.openingBookOn = '2026-10-01';
  for (const [k, v] of report) {
    const sold = E.serialToISO(v.date) || null, st = v.result === 'cancelled' ? 'scheduled' : v.result;
    if (!['fitted', 'scheduled', 'missed'].includes(st)) continue;
    prior.cases[k] = { caseNumber: k, status: st, statusOn: PRIOR, soldOn: sold, soldBasis: 'opening_book', firstSeen: sold && sold < PRIOR ? sold : PRIOR, lastSeen: PRIOR,
      apptOn: null, fittedOn: st === 'fitted' ? PRIOR : null, smAttempt: null, products: [], bundle: null, chargeEx: null, partnerRaw: null, leadSource: null,
      sellerName: null, sellerCb: null, sellerMatch: null, cancelReason: null };
    prior.events.push({ caseNumber: k, onDate: PRIOR, from: null, to: st, apptOn: null, reason: null });
  }
  const rc = [{ kind: 'bi_fitted', state: 'committed', extract_on: PRIOR }, { kind: 'sched_missed', state: 'committed', extract_on: PRIOR }];
  const a = E.merge(prior, pBi, { extractOn: TODAY, roster, aliases: {}, receipts: rc });
  eq('the 10 Nov BI file alone cancels nothing (the day is not complete yet)', [a.counts.toCancelled, a.counts.completeDay], [0, false]);
  const b = E.merge(a.book, pSm, { extractOn: TODAY, roster, aliases: {}, receipts: rc.concat([{ kind: 'bi_fitted', state: 'committed', extract_on: TODAY }]) });
  ok('the 10 Nov S&M file completes the day and evaluates it', b.counts.completeDay === true && b.cancel.evaluate === true, JSON.stringify(b.cancel));
  const inFile = new Set([...Object.keys(pBi.cases), ...Object.keys(pSm.cases)]);
  const ruleSet = Object.keys(b.book.cases).filter(k => b.book.cases[k].status === 'cancelled' && b.book.cases[k].cancelReason === 'dropped');
  const defined = [...report.keys()].filter(k => prior.cases[k] && ['scheduled', 'missed'].includes(prior.cases[k].status) && !inFile.has(k));
  eq('R1 cancels EXACTLY the prior open cases in neither 10 Nov file (no more, no fewer)', ruleSet.slice().sort(), defined.slice().sort());
  ok('every cancellation is dated 10 Nov with one dropped event', ruleSet.every(k => b.book.cases[k].statusOn === TODAY) && b.events.filter(e => e.to === 'cancelled' && e.reason === 'dropped').length === ruleSet.length);
  const absent = [...report.keys()].filter(k => !inFile.has(k));
  const tab = (keys) => { const t = {}; keys.forEach(k => { const v = report.get(k), kk = v.month + '/' + v.result; t[kk] = (t[kk] || 0) + 1; }); return t; };
  const T = tab(absent), n = (m, r) => T[m + '/' + r] || 0;
  eq('the owner\'s check: Current sales in neither file = 93, of which the report marks 90 Cancelled',
    [n('Current', 'cancelled') + n('Current', 'scheduled') + n('Current', 'missed') + n('Current', 'fitted'), n('Current', 'cancelled')], [93, 90]);
  eq('…Rollover sales in neither file = 175: 114 Cancelled, 54 Scheduled/Missed, 7 Fitted',
    [n('Rollover', 'cancelled') + n('Rollover', 'scheduled') + n('Rollover', 'missed') + n('Rollover', 'fitted'), n('Rollover', 'cancelled'), n('Rollover', 'scheduled') + n('Rollover', 'missed'), n('Rollover', 'fitted')], [175, 114, 54, 7]);
  const ruleT = tab(ruleSet), rn = (m, r) => ruleT[m + '/' + r] || 0;
  const tp = { current: rn('Current', 'cancelled'), rollover: rn('Rollover', 'cancelled') };
  const extra = { currentScheduled: rn('Current', 'scheduled'), currentMissed: rn('Current', 'missed'), rolloverScheduled: rn('Rollover', 'scheduled'), rolloverMissed: rn('Rollover', 'missed') };
  const repC = [...report.keys()].filter(k => report.get(k).result === 'cancelled');
  const unseen = repC.filter(k => !ruleSet.includes(k)), unseenT = tab(unseen);
  eq('true positives: every report-Cancelled sale in neither file is cancelled by the rule (90 Current + 114 Rollover)', [tp.current, tp.rollover], [90, 114]);
  eq('no report-Fitted case is cancelled by absence (R3: the 7 + Current Fitted absent stay Fitted)', ruleSet.filter(k => report.get(k).result === 'fitted').length, 0);
  eq('report Cancelled cases the rule cannot see = those still in a 10 Nov file', unseen.length, repC.filter(k => inFile.has(k)).length);
  console.log('    true positives: Current ' + tp.current + ' · Rollover ' + tp.rollover);
  console.log('    the rule cancels, the report still calls open: ' + JSON.stringify(extra));
  console.log('    report Cancelled the rule cannot see (in a 10 Nov file): ' + unseen.length + ' ' + JSON.stringify(unseenT));
  doc('Cancelled — DERIVED (was "absent"): the rule vs the report\'s Cancelled column',
    { truePositives: tp, ruleCancelsReportStillOpen: extra, reportCancelledRuleCannotSee: { n: unseen.length, by: unseenT }, precision: +((tp.current + tp.rollover) / ruleSet.length * 100).toFixed(1) + '%', recall: +((tp.current + tp.rollover) / repC.length * 100).toFixed(1) + '%' },
    { scheduledGap: 18, missedGap: 37, note: 'the report\'s sticky S/M rows in no upload (PD gaps) are what the rule cancels beyond the report' },
    'R1 is inferred from absence (reason dropped). The report keeps some old Scheduled/Missed rows the export no longer carries; the rule calls them Cancelled. A report-Cancelled sale still in a file cannot be seen: no file says cancelled.');
  const Mc = E.model(b.book, roster, { asOf: TODAY });
  ok('the model counts them: floor Cancelled = the rule\'s in-play cancellations, Cancellation % = cancelled ÷ sales', Mc.floor.mtd.cancelled > 0 && Math.abs(Mc.floor.mtd.canRate - Mc.floor.mtd.cancelled / Mc.floor.mtd.sales) < 1e-12,
    JSON.stringify({ cancelled: Mc.floor.mtd.cancelled, sales: Mc.floor.mtd.sales, canRate: Mc.floor.mtd.canRate }));
  console.log(`    floor: ${Mc.floor.mtd.sales} in play, ${Mc.floor.mtd.cancelled} cancelled (${(Mc.floor.mtd.canRate * 100).toFixed(1)} % against the ${(Mc.floor.mtd.canBudget * 100).toFixed(0)} % budget)`);
}

console.log('\n== PII never leaves the parse ==');
{ const pii = new Set();
  smAoa.slice(1).forEach(r => [3, 6, 7, 8].forEach(i => r[i] != null && String(r[i]).length > 5 && pii.add(String(r[i]))));
  biAoa.slice(1).forEach(r => [0, 4, 8, 19, 21, 27].forEach(i => r[i] != null && String(r[i]).length > 5 && pii.add(String(r[i]))));
  const out = JSON.stringify({ pBi, pSm, book, M });
  const strings = new Set(out.match(/"(?:[^"\\]|\\.)*"/g).map(s => JSON.parse(s)));
  /* a customer can also be a member of staff (an agent who bought a tracker): a value that is ALSO a name on
     the Agent List is staff data the roster carries anyway, not a customer field the parse let through */
  const staff = new Set(roster.flatMap(r => [r.name, r.sf]).filter(Boolean));
  const leaks = [...pii].filter(p => strings.has(p) && !staff.has(p));
  const staffToo = [...pii].filter(p => strings.has(p) && staff.has(p)).length;
  if (staffToo) console.log(`    note ${staffToo} customer-field value(s) equal a staff name on the Agent List (carried by the roster, not by the parse)`);
  eq('no customer name, phone, registration, chassis, box, account or contract number in any engine output', leaks.length, 0);
  const parseStrings = new Set(JSON.stringify({ pBi, pSm }).match(/"(?:[^"\\]|\\.)*"/g).map(s => JSON.parse(s)));
  ok('the parse outputs alone hold no customer-field value at all', ![...pii].some(p => parseStrings.has(p))); }

finish();
