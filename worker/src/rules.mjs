/**
 * rules.mjs — the rule-book constants and derivations the Worker and the tools share.
 *
 * ONE NUMBER, ONE VERDICT (specs/agent-view-consistency-plan.md, 2026-09-07). The R99 floor's
 * ex-VAT twin had drifted in three copies (PULSE, Ops, the agent page: 86,08 vs 86,0869), so an
 * agent exactly at the floor read "At target" in one row and "to go" in the next. Every
 * comparison an agent sees is now DECIDED here or in the PULSE engine and travels as a verdict;
 * the pages paint it. Nothing in agent/index.html or portal.mjs divides by VAT any more —
 * verify-rule-constants fails on the literal.
 */
export const VAT = 1.15;                                   // mirror of specs/mtd_engine_rules.json vat_multiplier
export const DEFAULT_THRESHOLDS = { gwpFloor: 99, targetAch: 100 };   // NBA_THRESHOLDS: Check 1 floor (R incl), Check 2 line (%)

/** R99 incl → the cent Salesforce books ex VAT (86,08), never the raw quotient (86,0869). */
export function gwpFloorEx(floorIncl) {
  const f = floorIncl != null ? +floorIncl : DEFAULT_THRESHOLDS.gwpFloor;
  return Math.floor(f / VAT * 100) / 100;
}

/** thresholds as the pages receive them: the incl floor AND its floored ex-VAT twin. */
export function withFloorEx(th) {
  const t = Object.assign({}, DEFAULT_THRESHOLDS, th || {});
  t.gwpFloorEx = gwpFloorEx(t.gwpFloor);
  return t;
}

/** The two checks on every sale, decided once. row = a digest agent row (aveG ex VAT, pctT ratio). */
export function checksFor(row, th) {
  const t = withFloorEx(th);
  const aveG = row && row.aveG != null ? +row.aveG : null;
  const pct = row && row.pctT != null ? Math.round(+row.pctT * 10000) / 100 : null;
  const line = +t.targetAch;
  return {
    value: { aveG, floorEx: t.gwpFloorEx, floorIncl: +t.gwpFloor, pass: aveG != null ? aveG >= t.gwpFloorEx : null },
    volume: { pct, line, pass: pct != null ? pct >= line : null },
    basis: 'ex VAT vs ex VAT; floor floored to the cent Salesforce books',
  };
}

const HOUR = 3600000;
/** The day each source should reach right now (SAST): yesterday after 13:00, no Sunday; Saturday only for sources that dial. Mirror of expectedReach() in PULSE. */
export function expectedReachFor(nowMs, saturday = true) {
  const sast = new Date(nowMs + 2 * HOUR);
  const d = new Date(Date.UTC(sast.getUTCFullYear(), sast.getUTCMonth(), sast.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - (sast.getUTCHours() >= 13 ? 1 : 2));
  while (d.getUTCDay() === 0 || (!saturday && d.getUTCDay() === 6)) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
