/**
 * THE DEMO FLOOR (spec 005-product-demo-screenshots, 2026-10-06) — a fictional call-centre month for product demos.
 *
 * Everything here is invented: 34 people (1 campaign manager, 4 team leaders, 29 agents), CB numbers from CB9101 (real
 * agents end at CB413), August and September 2026 of attendance, calls, sales, QA, cancellations, Manual Stats, lead
 * books and referrals. Names were checked against the real Agent List: no full-name match (research R3).
 *
 * DETERMINISTIC: one seeded generator, so every run produces the same floor and the same screenshots.
 * The output is the VAS Analytics (PULSE) state shape (research R1) — the real engine computes every figure from it.
 */

/* mulberry32 — small, fast, seeded */
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const R = rng(20261006);
const between = (lo, hi) => lo + (hi - lo) * R();
const pick = (arr) => arr[Math.floor(R() * arr.length)];
const round2 = (v) => Math.round(v * 100) / 100;

export const CLOCK = '2026-09-29T09:30:00+02:00';      // a Tuesday morning, September complete to Monday the 28th
export const TODAY = '2026-09-29';
export const MONTH = '2026-09';

export const CAMPAIGN_MANAGER = { username: 'imogen', name: 'Imogen Botha', campaigns: ['courtesy', 'cuddle', 'nesting'] };
export const TEAM_LEADERS = [
  { name: 'Leah Marais', cb: 'CB9001', username: 'cb9001', campaign: 'Courtesy' },
  { name: 'Tumi Khoza', cb: 'CB9002', username: 'cb9002', campaign: 'Courtesy' },
  { name: 'Ravin Chetty', cb: 'CB9003', username: 'cb9003', campaign: 'Cuddle' },
  { name: 'Noor Adams', cb: 'CB9004', username: 'cb9004', campaign: 'Nesting' },
];

/* name, campaign, team leader, tenure, skill (sales vs target), qa (mean QA score) — a believable spread: stars,
   steady performers, and a few who need coaching so the coaching queue and the risk filters have something to show */
const AGENTS = [
  ['Kabelo Mthembu', 'Courtesy', 'Leah Marais', 'Exp', 1.32, 0.95], ['Anika Reddy', 'Courtesy', 'Leah Marais', 'Exp', 1.18, 0.93],
  ['Lerato Sithole', 'Courtesy', 'Leah Marais', 'Exp', 1.02, 0.91], ['Jared Pillay', 'Courtesy', 'Leah Marais', 'M2', 0.94, 0.89],
  ['Zanele Mahlangu', 'Courtesy', 'Leah Marais', 'Exp', 0.62, 0.84], ['Ruan van Wyk', 'Courtesy', 'Leah Marais', 'M2', 0.88, 0.92],
  ['Ayesha Patel', 'Courtesy', 'Tumi Khoza', 'Exp', 1.25, 0.96], ['Sizwe Ngcobo', 'Courtesy', 'Tumi Khoza', 'Exp', 1.08, 0.9],
  ['Megan Fourie', 'Courtesy', 'Tumi Khoza', 'Exp', 0.97, 0.94], ['Thando Zulu', 'Courtesy', 'Tumi Khoza', 'M2', 0.79, 0.87],
  ['Kiran Moodley', 'Courtesy', 'Tumi Khoza', 'Exp', 1.12, 0.92], ['Nomvula Dube', 'Courtesy', 'Tumi Khoza', 'Exp', 0.58, 0.8],
  ['Ethan Jacobs', 'Cuddle', 'Ravin Chetty', 'Exp', 1.21, 0.93], ['Palesa Molefe', 'Cuddle', 'Ravin Chetty', 'Exp', 1.05, 0.95],
  ['Yusuf Ebrahim', 'Cuddle', 'Ravin Chetty', 'Exp', 0.99, 0.9], ['Carla Nel', 'Cuddle', 'Ravin Chetty', 'Exp', 0.91, 0.88],
  ['Bongani Shabalala', 'Cuddle', 'Ravin Chetty', 'M2', 0.83, 0.9], ['Shreya Singh', 'Cuddle', 'Ravin Chetty', 'Exp', 1.15, 0.94],
  ['Lwazi Mkhize', 'Cuddle', 'Ravin Chetty', 'Exp', 0.64, 0.82], ['Tegan Brink', 'Cuddle', 'Ravin Chetty', 'Exp', 1.01, 0.91],
  ['Mpho Radebe', 'Cuddle', 'Ravin Chetty', 'M2', 0.9, 0.89], ['Divya Naicker', 'Cuddle', 'Ravin Chetty', 'Exp', 1.09, 0.92],
  ['Sean Daniels', 'Nesting', 'Noor Adams', 'M1', 1.06, 0.9], ['Nandi Cele', 'Nesting', 'Noor Adams', 'M1', 0.97, 0.88],
  ['Keagan Smit', 'Nesting', 'Noor Adams', 'M1', 0.86, 0.91], ['Farah Hendricks', 'Nesting', 'Noor Adams', 'M1', 1.14, 0.93],
  ['Andile Gumede', 'Nesting', 'Noor Adams', 'M1', 0.71, 0.86], ['Chloe Pretorius', 'Nesting', 'Noor Adams', 'M1', 0.93, 0.9],
  ['Vusi Mabaso', 'Nesting', 'Noor Adams', 'M1', 0.6, 0.83],
];
const TARGET = { Courtesy: { Exp: 5, M2: 4 }, Cuddle: { Exp: 4, M2: 3 }, Nesting: { M1: 3 } };
const START = { Exp: ['2024-11-04', '2025-02-03', '2025-05-05', '2025-08-04'], M2: ['2026-06-01', '2026-06-15'], M1: ['2026-08-03'] };

export const PEOPLE = AGENTS.map((a, i) => ({ code: 'CB' + (9101 + i), name: a[0], campaign: a[1], tl: a[2], tenure: a[3], skill: a[4], qa: a[5],
  target: TARGET[a[1]][a[3]], start: pick(START[a[3]]) }));

/* working days: Monday–Friday, 3 Aug → 28 Sep 2026, without the public holidays (10 Aug Women's Day observed, 24 Sep Heritage Day) */
const HOLIDAYS = new Set(['2026-08-10', '2026-09-24']);
export const DAYS = (() => {
  const out = [];
  for (let d = new Date('2026-08-03T00:00:00Z'); d <= new Date('2026-09-28T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10), wd = d.getUTCDay();
    if (wd >= 1 && wd <= 5 && !HOLIDAYS.has(iso)) out.push(iso);
  }
  return out;
})();
const SEPT = DAYS.filter((d) => d.startsWith('2026-09'));
const STATUSES = ['1st attempt', '2nd attempt', '3rd attempt', '4th attempt', '5th attempt', 'New', 'In Progress', 'Escalated'];
const QA_CATS = ['Compliance & Required Wording', 'Customer Verification', 'Objection Handling', 'Pitch & Value Creation', 'Call Control'];

/** The whole PULSE state for the floor, plus the Manual Stats rows keyed by NAME (keyed through PULSE's normName in-page). */
/* VIDEO 2 (spec 026): Megan Fourie — busy on the phones, sales ~94% and slipping through September, conversion ~5% against
   the 10% target, so the ladder's own rule lands on R7. Opt-in; the same number of random draws, so nobody else moves. */
export const STORY2_AGENT = 'CB9109';
export function buildFloor({ story = null } = {}) {
  const v2 = (p) => story === 'v2' && p.code === STORY2_AGENT;
  const roster = PEOPLE.map((p) => ({ code: p.code, name: p.name, sf: p.name, callx: '', tl: p.tl, campaign: p.campaign, tenure: p.tenure, target: p.target, start: p.start }));
  const att = {}, calls = {}, sales = {}, evals = {}, cancRows = {}, boardRows = {}, refsBy = {}, refsByDay = {};
  let caseSeq = 400100, cancSeq = 1;
  for (const d of DAYS) {
    att[d] = {}; calls[d] = {}; sales[d] = {};
    for (const p of PEOPLE) {
      const r = R();
      /* mostly present; leave is excused (it does not dent attendance), an unexcused absence does — weaker performers a little more often */
      const ca = p.skill < 0.7 ? 0.04 : 0.012;
      const status = r < 0.94 - ca ? 'P' : r < 0.94 ? 'CA' : r < 0.97 ? 'AL' : 'SL';
      att[d][p.code] = status;
      if (status !== 'P') { calls[d][p.code] = { talk: 0, calls: 0, ans: 0, opt: 0, saleD: 0, v: 1 }; continue; }
      const nCalls = Math.round(between(95, 150) * (0.85 + p.skill * 0.15));
      calls[d][p.code] = { talk: Math.round(between(4.1, 5.9) * 3600 * (0.9 + p.skill * 0.1)), calls: nCalls, ans: Math.round(nCalls * between(0.38, 0.5)), opt: 0, saleD: 0, v: 1 };
      let lift = d < '2026-09-01' ? 0.94 : 1;               // September a little stronger than August, so "vs last period" has a story
      if (v2(p) && d >= '2026-09-01') lift = 1.12 - 0.3 * (SEPT.indexOf(d) / (SEPT.length - 1));   // strong start, then slipping
      const n = Math.max(0, Math.round(p.target * p.skill * lift * between(0.55, 1.45)));
      if (!n) continue;
      const a = {}; let x = 0;
      for (let k = 0; k < n; k++) { const v = round2(between(77.4, 121.7)); a['CS' + (caseSeq++)] = v; x += v; }
      x = round2(x);
      sales[d][p.code] = { n, gwp: round2(x * 1.15), x, canc: 0, u: 'case', a };
      if (R() < 0.035) {                                         // the odd cancellation, deactivated a week later
        const keys = Object.keys(a); const c = keys[0];
        const dd = new Date(Date.parse(d + 'T00:00:00Z') + 7 * 86400000).toISOString().slice(0, 10);
        cancRows['CX' + cancSeq] = { d, dd, owner: p.name, f: 'Inactive Cases 28.09.2026.xlsx', a: 'ACC' + (700000 + cancSeq), c, x: a[c] };
        cancSeq++;
      }
      const refs = R() < 0.18 ? (R() < 0.25 ? 2 : 1) : 0;
      if (refs) { refsBy[p.code] = (refsBy[p.code] || 0) + refs; (refsByDay[d] = refsByDay[d] || {})[p.code] = refs; }
    }
  }
  /* QA: 3–5 evaluations per agent per month, scored around their QA level; one critical fail for the weakest */
  let rid = 1;
  for (const month of ['2026-08', '2026-09']) {
    const md = DAYS.filter((d) => d.startsWith(month));
    for (const p of PEOPLE) {
      if (month === '2026-08' && p.tenure === 'M1') continue;
      const k = 3 + Math.floor(R() * 3);
      for (let i = 0; i < k; i++) {
        const d = md[Math.floor(R() * md.length)];
        const crit = month === '2026-09' && p.code === 'CB9129' && i === 0;
        const s = crit ? 0 : Math.max(55, Math.min(100, Math.round((p.qa + between(-0.07, 0.06)) * 100)));
        (evals[d] = evals[d] || {});
        (evals[d][p.code] = evals[d][p.code] || []).push({ s, rid: 'QA-' + (10000 + rid++), f: 'QA Evaluations ' + month + '.csv',
          dec: crit ? 'Critical Fail' : 'Pass', cat: crit ? 'Compliance & Required Wording' : (s < 88 ? pick(QA_CATS) : ''), pri: '', camp: p.campaign,
          dsp: 0, dspSt: '', st: 'Completed' });
      }
    }
  }
  /* Manual Stats (the team leaders' board) for the last 15 working days of September — mostly agreeing with the
     system, a handful of honest disagreements so the Variance report has something to reconcile */
  for (const d of SEPT.slice(-15)) {
    boardRows[d] = [];
    for (const p of PEOPLE) {
      if (att[d][p.code] !== 'P') continue;
      const s = sales[d][p.code];
      let n = s ? s.n : 0, gwp = s ? Math.round(s.gwp) : 0;
      if (R() < 0.06) { n += R() < 0.5 ? 1 : -1; n = Math.max(0, n); gwp = Math.round(n * 99.5); }
      boardRows[d].push({ name: p.name, sales: n, gwp, ref: (refsByDay[d] && refsByDay[d][p.code]) || 0, cells: n, cellGwp: gwp, ts: n, tg: gwp });
    }
  }
  /* lead books — EVERY agent works leads (conversion = sales ÷ closed leads, ~1 sale per 8 closed); Courtesy is left out
     of the Lead Management REPORT by the engine, not out of the book */
  const open = [], closed = {};
  let lk = 1;
  for (const p of PEOPLE) {
    const sold = SEPT.reduce((n, d) => n + ((sales[d][p.code] && sales[d][p.code].n) || 0), 0);
    const nOpen = 40 + Math.floor(R() * 60);
    for (let i = 0; i < nOpen; i++) {
      const age = 1 + Math.floor(R() * 30);
      const opened = new Date(Date.parse(TODAY + 'T00:00:00Z') - age * 86400000).toISOString().slice(0, 10);
      open.push({ k: 'LD' + (500000 + lk++), owner: p.code, status: pick(STATUSES), opened, age });
    }
    const nClosed = Math.round(sold * (v2(p) ? between(17, 20) : between(7, 9.5)));   // v2: ~5% conversion
    for (let i = 0; i < nClosed; i++) {
      const d = SEPT[Math.floor(R() * SEPT.length)];
      const opened = new Date(Date.parse(d + 'T00:00:00Z') - (2 + Math.floor(R() * 12)) * 86400000).toISOString().slice(0, 10);
      closed['LC' + (600000 + lk++)] = { owner: p.code, status: i < sold ? 'Closed - Sale' : (R() < 0.55 ? 'Closed - No feedback' : 'Closed'), opened, d };
    }
  }
  const at = (d, t) => d + ' ' + t;
  const f = (name, type, ds, rows, when) => ({ name, type, dates: ds, rows, at: when, hash: 'demo-' + name.replace(/\W+/g, '-').toLowerCase() });
  const files = [
    f('Power BI Active Cases 29.09.2026.xlsx', 'bi', DAYS, Object.values(sales).reduce((n, day) => n + Object.values(day).reduce((m, s) => m + s.n, 0), 0), at('2026-09-29', '07:42:00')),
    f('Attendance Register Sept 2026.xlsx', 'attendance', DAYS, DAYS.length * PEOPLE.length, at('2026-09-29', '07:44:00')),
    f('QA Evaluations 2026-09.csv', 'evals', Object.keys(evals).sort(), Object.values(evals).reduce((n, day) => n + Object.values(day).reduce((m, l) => m + l.length, 0), 0), at('2026-09-28', '16:05:00')),
    f('Inactive Cases 28.09.2026.xlsx', 'cancellations', DAYS, Object.keys(cancRows).length, at('2026-09-29', '07:46:00')),
    f('ViciDial Call Report 28.09.2026.txt', 'calls (ViciDial)', DAYS, DAYS.length * PEOPLE.length * 110, at('2026-09-29', '07:40:00')),
    f('Manual Stats Sept 2026.xlsx', 'board', Object.keys(boardRows).sort(), Object.values(boardRows).reduce((n, l) => n + l.length, 0), at('2026-09-28', '18:10:00')),
    f('Open Cases Lead Management 29.09.2026.csv', 'open cases (lead mgmt)', [TODAY], open.length, at('2026-09-29', '07:50:00')),
    f('Closed Cases Sept 2026.xls', 'closed cases', SEPT, Object.keys(closed).length, at('2026-09-29', '07:52:00')),
    f('HighLevel referrals (API)', 'referrals', DAYS, Object.values(refsBy).reduce((n, v) => n + v, 0), at('2026-09-29', '08:00:00')),
    f('Matrix - Agent List 28.09.2026.xlsx', 'roster', ['2026-09-28'], PEOPLE.length, at('2026-09-28', '08:05:00')),
  ];
  const coach = {};
  coach['2026-09-01|2026-09-30'] = {
    CB9105: { status: 'progress', due: '2026-10-02', notes: 'Call review booked — price objection and the close.' },
    CB9112: { status: 'progress', due: '2026-10-01', notes: 'Sitting with her on Thursday; attendance plan agreed.' },
    CB9119: { status: '', due: '2026-10-05', notes: '' },
  };
  const state = {
    roster, att, calls, sales, evals, cancRows,
    tracker: {}, vici: {}, viciDays: {}, adjust: {}, coach, campaignMoves: {}, leavers: {}, cmTargets: { matrix: {}, stamp: '' },
    opencasesLM: { rows: open, f: 'Open Cases Lead Management 29.09.2026.csv', at: '2026-09-29 07:50', total: open.length, snapshot: TODAY, queues: 0 },
    closedcases: { rows: closed, f: 'Closed Cases Sept 2026.xls', at: '2026-09-29 07:52', n: Object.keys(closed).length },
    refs: { by: refsBy, un: {}, noAgent: 0, total: Object.values(refsBy).reduce((n, v) => n + v, 0), f: 'HighLevel API', byDay: refsByDay, dated: true, at: '2026-09-29 08:00' },
    files,
    rosterEffect: { asOf: '2026-09-28', file: 'Matrix - Agent List 28.09.2026.xlsx', moved: 0, fresh: 0, left: 0, at: '2026-09-28 08:05' },
  };
  return { state, boardRows };
}
