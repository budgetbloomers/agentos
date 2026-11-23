/* vt-digest-fixture.mjs — a FICTIONAL Vehicle Tracking floor for the Phase E suites (spec 071): the case book built through
 * the real engine (VTEngine.merge over fixture files, one extract per working day 19 Oct → 10 Nov 2026, Thu 5 Nov missing),
 * the VT roster as vt_roster_at returns it, the published digest (VTEngine.digest of the same model the pages paint), and a
 * small VAS digest for the "VAS is unchanged" proofs. Invented people (CB91xx VT, CB92xx VAS), invented case numbers.
 *
 *   import { ENG, ST, ROSTER_RPC, ROSTER, FX, bookRpc, vtDigest, vasDigest, CYCLE } from './vt-digest-fixture.mjs';
 */
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { biFile, smFile } from './vt-fixtures.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const require = createRequire(import.meta.url);
export const ENG = require(path.join(ROOT, 'nicks_code', 'vt-engine.js'));
export const ST = require(path.join(ROOT, 'nicks_code', 'vt-pages.js'));
export const CYCLE = 'cycle-2026-11';

/* the VT sheet of a fictional Agent List; CB9106 is listed and sold nothing (the "not rated yet" state); CB9107 started on
   6 Nov (two drivers not measured yet, renormalised) */
export const ROSTER_RPC = { as_of: '2026-11-02', list_as_of: '2026-11-02', rows: [
  { code: 'CB9101', name: 'Alpha Test', sf: 'Alpha Test', tl: 'Leader One', tl_code: 'CB9190', campaign_raw: 'Matrix Vehicle Tracking - Digital', tenure: 'Exp', target: 6.5, start_date: '2026-01-05' },
  { code: 'CB9105', name: 'Golf Hotel', sf: 'Golf Hotel', tl: 'Leader One', tl_code: 'CB9190', campaign_raw: 'Matrix Vehicle Tracking - Digital', tenure: 'Exp', target: 6.5, start_date: '2026-01-05' },
  { code: 'CB9106', name: 'India Juliet', sf: null, tl: 'Leader One', tl_code: 'CB9190', campaign_raw: 'Matrix Vehicle Tracking - Digital', tenure: 'M1', target: 1, start_date: '2026-11-02' },
  { code: 'CB9107', name: 'Lima Two', sf: 'Lima Two', tl: 'Leader One', tl_code: 'CB9190', campaign_raw: 'Matrix Vehicle Tracking - Digital', tenure: 'M2', target: 2, start_date: '2026-11-06' },
  { code: 'CB9102', name: 'Bravo Middle Tester', sf: null, tl: 'Leader Two', tl_code: 'CB9191', campaign_raw: 'Matrix Vehicle Tracking - Referral', tenure: 'Exp', target: 3, start_date: '2026-01-05' },
  { code: 'CB9104', name: 'Echo Foxtrot', sf: null, tl: 'Leader Two', tl_code: 'CB9191', campaign_raw: 'Matrix Vehicle Tracking - Scheduling', tenure: 'Exp', target: null, start_date: '2026-01-05' },
  { code: 'CB9103', name: 'Charlie Delta', sf: null, tl: 'Leader Three', tl_code: 'CB9192', campaign_raw: 'Matrix Vehicle Tracking - Predictive', tenure: 'M1', target: 1, start_date: '2026-10-01' }] };
export const ROSTER = ST.rosterFromRpc(ROSTER_RPC);
const SELLERS = ['Alpha Test - Panimax', 'Golf Hotel', 'Bravo Middle Tester', 'Charlie Delta', 'Nobody On The List', 'Lima Two'];   // Lima Two joined 6 Nov: < 5 tracked days (the not-measured state)
const PARTNERS = ['RevX', 'Jag Web Marketing- Panimax', 'Panimax - New Sales', 'Sales Enablement'];
const add = (d, n) => ENG.periods.addDays(d, n);

function buildFixture() {
  const cases = [];
  let book = ENG.emptyBook(), counter = 0, id = 0;
  const receipts = [], days = [];
  for (let d = '2026-10-19'; d <= '2026-11-10'; d = add(d, 1)) if (ENG.periods.isWorkingDay(d) && d !== '2026-11-05') days.push(d);
  days.forEach((e, di) => {
    SELLERS.forEach((seller) => { for (let k = 0; k < 2 + (di % 2); k++) { const i = counter++;
      const outcome = i % 10 < 7 ? 'fit' : i % 10 < 9 ? 'miss' : 'open';
      cases.push({ cn: 90100000 + i, seller, partner: PARTNERS[i % 4], born: e, appt: add(e, outcome === 'open' ? 20 : 1 + (i % 3)), outcome, charge: 100 + (i % 5) * 20 }); } });
    const born = cases.filter((c) => c.born <= e);
    const bi = born.filter((c) => c.outcome === 'fit' && c.appt <= e).map((c) => ({ cn: c.cn, charge: c.charge, inst: c.appt, seller: c.seller, partner: c.partner, unit: c.cn % 2 ? 'MXV' : 'BEAME' }));
    const sm = born.filter((c) => !(c.outcome === 'fit' && c.appt <= e)).map((c) => ({ cn: c.cn, appt: c.appt, seller: c.seller, partner: c.partner,
      outcome: c.outcome === 'miss' && c.appt <= e ? 'Missed Fitment' : 'Scheduled Fitment' }));
    for (const [kind, aoa] of [['bi_fitted', biFile(bi)], ['sched_missed', smFile(sm)]]) {
      const parsed = kind === 'bi_fitted' ? ENG.parseBi(aoa) : ENG.parseSm(aoa);
      if (!Object.keys(parsed.cases).length) continue;
      const m = ENG.merge(book, parsed, { extractOn: e, roster: ROSTER, aliases: {} }); book = m.book; book.rev = ++id;
      receipts.push({ id, sha256: String(id).padStart(64, '0'), kind, file_name: (kind === 'bi_fitted' ? 'BI Active Fitted ' : 'Scheduled & Missed ') + e.slice(8, 10) + e.slice(5, 7) + e.slice(2, 4) + '.xlsx',
        extract_on: e, cycle_key: ENG.periods.cycleOf(e).key, state: 'committed', counts: m.counts, unmatched: m.unmatched, warnings: [], quiet_day_ack: false, committed_at: e + 'T06:15:00Z', rev_after: id });
    }
  });
  return { book, receipts };
}
export const FX = buildFixture();
const COLS = ['caseNumber', 'status', 'statusOn', 'soldOn', 'soldBasis', 'firstSeen', 'lastSeen', 'apptOn', 'fittedOn', 'products', 'chargeEx', 'leadSource', 'sellerName', 'sellerCb', 'sellerMatch', 'smAttempt', 'bundle', 'partnerRaw'];
/* what vt_book(p_from) returns (migration-071) */
export function bookRpc(from) {
  const cs = Object.values(FX.book.cases).filter((c) => !from || c.lastSeen >= from || ['scheduled', 'missed'].includes(c.status));
  const keep = new Set(cs.map((c) => String(c.caseNumber)));
  return { rev: FX.book.rev, openedOn: FX.book.openedOn, openingBookOn: FX.book.openingBookOn, cases: cs.map((c) => COLS.map((k) => (c[k] === undefined ? null : c[k]))),
    events: FX.book.events.filter((e) => keep.has(String(e.caseNumber))).map((e) => [e.caseNumber, e.onDate, e.from, e.to, e.apptOn]) };
}
/* the published VT digest of a business month — the engine's own digest of the engine's own model (Node calendar) */
export function vtDigest(cycleKey = CYCLE, o = {}) {
  const book = ENG.bookFromRpc(bookRpc(ENG.periods.cycleByKey(cycleKey).from));
  const M = ENG.model(book, ROSTER, { cycleKey, aliases: {}, receipts: FX.receipts });
  return ENG.digest(M, { updatedAt: o.updatedAt || '2026-11-10T06:20:00Z' });
}

/* ---- a small VAS digest (the shape PULSE's agentDigestPayload publishes, the fields the portal reads) ---- */
const part = (k, label, w, v, t, pts) => ({ k, label, w, v, t, att: t ? Math.min(100, v / t * 100) : null, measured: true, points: pts, onTarget: v >= t, available: Math.round((w - pts) * 10) / 10 });
const vasRow = (code, name, sales, adj) => ({ code, name, tl: 'Leader Vas', campaign: 'Courtesy', tenure: 'Exp', plan: 'EXP', target: 120, sales, gwpEx: sales * 86.5,
  pctT: sales / 120, spd: sales / 15, att: 0.95, qa: 0.88, aveG: 86.5, ref: 2, closed: 40, leads: 60, calls: 900, ans: 400, talk: 5400, aveTalk: 300, act: 15, emp: 16,
  spark: [3, 4, 5], days: [{ d: '2026-11-02', s: 3, g: 259.5 }, { d: '2026-11-03', s: 4, g: 346 }],
  composite: { rated: true, score: adj, adj, band: adj >= 80 ? 'Strong' : 'On track', window: 5, onTarget: 3, floor: 50,
    parts: [part('gwpSale', 'Avg GWP per Sale', 30, 86.5, 86.08, 30), part('targetAch', 'Target Achievement', 25, 90, 100, 20), part('qa', 'QA Score', 15, 88, 85, 15)],
    nextBand: adj >= 80 ? { label: 'Elite', pointsAway: 90 - adj } : { label: 'Strong', pointsAway: 80 - adj } } });
export function vasDigest() {
  return { v: 1, updatedAt: '2026-11-10T06:30:00Z', period: { from: '2026-11-01', to: '2026-11-30' }, daysWithData: 7, dates: ['2026-11-02', '2026-11-03'],
    weeks: [{ from: '2026-11-02', to: '2026-11-08' }], diallingDays: 7, workingDays: 20, talkUnit: 'minutes',
    comm: { saleValue: 89 / 1.15, brackets: { EXP: [{ gwp: 9751.3, comm: 4000 }] } },
    compositeDrivers: [{ k: 'gwpSale', label: 'Avg GWP per Sale', w: 30 }, { k: 'targetAch', label: 'Target Achievement', w: 25 }, { k: 'qa', label: 'QA Score', w: 15 }],
    groups: { 'Courtesy|Exp': { sales: 80, n: 2 } }, onTarget: 1,
    tlAgg: [{ tl: 'Leader Vas', camp: 'Courtesy', sales: 160 }], campAgg: { Courtesy: { sales: 160 } },
    agents: [vasRow('CB9201', 'Kilo Lima', 90, 84.2), vasRow('CB9202', 'Mike November', 70, 71.5)],
    notCovered: [
      { code: 'CB9101', name: 'Alpha Test', tl: 'Leader One', why: 'campaign', campaign: 'VT' },
      { code: 'CB9104', name: 'Echo Foxtrot', tl: 'Leader Two', why: 'campaign', campaign: 'VT' },
      { code: 'CB9106', name: 'India Juliet', tl: 'Leader One', why: 'campaign', campaign: 'VT' },
      { code: 'CB9203', name: 'Oscar Papa', tl: 'Leader Vas', why: 'nodata', campaign: 'Courtesy' }] };
}
