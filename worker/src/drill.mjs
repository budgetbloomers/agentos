/**
 * drill.mjs — THE KPI DRILL-DOWN VERDICTS (sprint 2026-09-29, item 3; decision D3).
 *
 * Nick: "allow an agent to click on a KPI requiring attention. The next screen should explain what
 * KPI is below target, their current result, the target, what is driving the issue, what action the
 * agent should take, and whether TL assistance is recommended."
 *
 * ONE NUMBER, ONE VERDICT (CLAUDE.md non-negotiable 12). Every judgement below is made ONCE, here, and
 * travels on the payload as `me.drill`; agent/index.html paints it and decides nothing. The Today tiles'
 * ON TRACK / WATCH / FOCUS bands used to be literals in the page (tileState) — they live here now, and
 * the record is specs/kpi_drilldown_rules.json: change BOTH together, verify-drill fails on drift.
 *
 * WINDOWS (architect review, 2026-09-29): the tile, its status and its result are MONTH-TO-DATE — the
 * same window the tile shows. The "last five sessions" count is a separate, named driver, never a
 * second number for the same KPI.
 */

export const DRILL_RULES = {
  /* ratio bands: pass at or above `pass`, watch at or above `watch`, focus below. aveG is judged as a
     multiple of the R99 floor's ex-VAT twin (withFloorEx), so 1 = at the floor. */
  bands: {
    ta: { pass: 1, watch: 0.75 },
    aveG: { pass: 1, watch: 0.9 },
    qa: { pass: 0.9, watch: 0.8 },
    att: { pass: 0.95, watch: 0.85 },
  },
  /* D3: TL help is recommended when the KPI is below target month-to-date AND either it was below
     target in ≥ sessionsBelow of the last ofLast sessions, or closing the gap needs more than
     paceMultiple × the agent's current daily pace. QA in the focus band always recommends it. */
  tlHelp: { sessionsBelow: 3, ofLast: 5, paceMultiple: 1.5, qaFocus: true },
  /* the Help Center topic the "Ask … for help with this" button opens on (help.mjs HELP_CATEGORIES) */
  topics: { ta: 'Review my call', aveG: 'Explain the product', qa: 'Explain my quality result', att: 'Something else' },
  /* what to do — one sentence per KPI, shown when the KPI needs attention */
  actions: {
    ta: 'Every session at your daily target from here keeps the month on track — plan each shift around that number.',
    aveG: 'Hold every sale at the floor or better — the value of each sale is what this measures, so lead with the full product.',
    qa: 'One clean week of calls moves this — ask for your last evaluated call to be reviewed with you.',
    att: 'Every day on the floor protects the rest of your card — tell your team leader early if something is keeping you away.',
  },
};

const LABELS = { ta: 'Target achieved', aveG: 'Average sale (ex VAT)', qa: 'QA score', att: 'Attendance' };

function band(ratio, b) {
  if (ratio == null || !isFinite(ratio)) return 'none';
  return ratio >= b.pass ? 'pass' : ratio >= b.watch ? 'watch' : 'focus';
}

/* The agent's last sessions that count: landed (not provisional), not leave, attended. Oldest → newest. */
function lastSessions(row, n) {
  return (row.days || []).filter((f) => f && !f.p && !f.lv && (f.act == null || f.act > 0)).slice(-n);
}

/* Weekdays in the digest's data dates — how far the month has run, for the pace driver only. */
function dataWeekdays(dates, period) {
  let n = 0;
  for (const d of dates || []) {
    if (period && period.to && d > period.to) continue;
    const w = new Date(d + 'T00:00:00Z').getUTCDay();
    if (w > 0 && w < 6) n++;
  }
  return n;
}

/**
 * The verdict for each Today tile that can need attention.
 * row: a digest agent row (pctT ratio, aveG ex VAT, qa ratio, att ratio, target, sales, spd, days[]).
 * ctx: { floorEx, workingDays, dates, period }.
 * Returns { ta, aveG, qa, att }, each { k, label, status, result, target, below, of, tlHelp, why, topic, action }.
 */
export function drillFor(row, ctx) {
  const R = DRILL_RULES, T = R.tlHelp;
  const c = ctx || {};
  const out = {};
  const sess = lastSessions(row || {}, T.ofLast);
  const mk = (k, status, result, target, below, of, tlHelp, why) => ({
    k, label: LABELS[k], status, result, target, below, of,
    tlHelp: !!tlHelp, why: tlHelp ? why : null, topic: R.topics[k],
    action: status === 'watch' || status === 'focus' ? R.actions[k] : null,
  });
  const attention = (s) => s === 'watch' || s === 'focus';

  /* TARGET ACHIEVED — month-to-date sales against the month's target */
  {
    const pct = row && row.pctT != null ? +row.pctT : null;
    const st = band(pct, R.bands.ta);
    const judged = sess.filter((f) => f.t > 0);
    const below = judged.filter((f) => (f.s || 0) < f.t).length;
    const short = row && row.target != null && row.sales != null ? Math.max(0, Math.ceil(row.target - row.sales)) : null;
    /* PULSE's own holiday-aware count of days with data first (review, 2026-09-29: counting Mon–Fri data
       dates took Heritage Day as a worked day and made the gap look one day harder); weekdays only as the
       fallback for an older digest */
    const done = c.daysWithData > 0 ? +c.daysWithData : dataWeekdays(c.dates, c.period);
    const left = c.workingDays ? Math.max(0, c.workingDays - done) : 0;
    const need = short > 0 && left > 0 ? short / left : null;
    const spd = row && row.spd != null ? +row.spd : null;
    const paceHard = need != null && (spd > 0 ? need > T.paceMultiple * spd : true);
    const why = below >= T.sessionsBelow ? { rule: 'sessions', below, of: judged.length } : paceHard ? { rule: 'pace' } : null;
    out.ta = mk('ta', st, pct, 1, below, judged.length, attention(st) && !!why, why);
  }

  /* AVERAGE SALE — ex VAT, against the floor's ex-VAT twin */
  {
    const aveG = row && row.aveG != null ? +row.aveG : null;
    const floor = c.floorEx != null ? +c.floorEx : null;
    const st = aveG != null && floor ? band(aveG / floor, R.bands.aveG) : 'none';
    const judged = sess.filter((f) => (f.s || 0) > 0);
    const below = floor ? judged.filter((f) => (f.x || 0) / f.s < floor).length : 0;
    const why = below >= T.sessionsBelow ? { rule: 'sessions', below, of: judged.length } : null;
    out.aveG = mk('aveG', st, aveG, floor, below, judged.length, attention(st) && !!why, why);
  }

  /* QA — the month's average call quality; the focus band always asks for the leader */
  {
    const qa = row && row.qa != null ? +row.qa : null;
    const st = band(qa, R.bands.qa);
    const why = T.qaFocus && st === 'focus' ? { rule: 'qa' } : null;
    out.qa = mk('qa', st, qa, R.bands.qa.pass, null, null, !!why, why);
  }

  /* ATTENDANCE — actual over employed shifts (leave is already out of both, D1) */
  {
    const att = row && row.att != null ? +row.att : null;
    const st = band(att, R.bands.att);
    const judged = (row && row.days || []).filter((f) => f && !f.p && !f.lv && f.act != null).slice(-T.ofLast);
    const below = judged.filter((f) => +f.act < 1).length;
    const why = below >= T.sessionsBelow ? { rule: 'sessions', below, of: judged.length } : null;
    out.att = mk('att', st, att, R.bands.att.pass, below, judged.length, attention(st) && !!why, why);
  }
  return out;
}
