/**
 * cycle.mjs — THE BILLING MONTH (spec 001-cm-view-signoff, 2026-10-01).
 *
 * A billing month runs from the 26th of the previous month to the 25th, and is keyed by the month it ENDS in:
 * `cycle-2026-09` = 26 Aug – 25 Sep 2026. This is PULSE's own "Cycle (26th–25th)" period
 * (periodRangeRaw('cycle'), nicks_code/index.html) — the engine builds it, tools/digest-republish.mjs publishes
 * it under kv:agent-digest-cycle-YYYY-MM, and the Worker serves it. One definition for both; pure, no I/O.
 */
const KEY_RE = /^cycle-(\d{4})-(\d{2})$/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const iso = (d) => d.toISOString().slice(0, 10);

/** 'cycle-YYYY-MM' → {key, from, to, label}; null for anything else. */
export function cycleRange(key) {
  const m = KEY_RE.exec(String(key || ''));
  if (!m) return null;
  const y = +m[1], mo = +m[2];
  if (mo < 1 || mo > 12) return null;
  const from = iso(new Date(Date.UTC(y, mo - 2, 26)));
  const to = iso(new Date(Date.UTC(y, mo - 1, 25)));
  return { key: 'cycle-' + m[1] + '-' + m[2], from, to, label: cycleLabel(from, to) };
}

/** '26 Aug – 25 Sep 2026' (the year of the end day; both years when they differ). */
export function cycleLabel(from, to) {
  const f = new Date(from + 'T00:00:00Z'), t = new Date(to + 'T00:00:00Z');
  const fy = f.getUTCFullYear(), ty = t.getUTCFullYear();
  return f.getUTCDate() + ' ' + MONTHS[f.getUTCMonth()] + (fy !== ty ? ' ' + fy : '') + ' – '
    + t.getUTCDate() + ' ' + MONTHS[t.getUTCMonth()] + ' ' + ty;
}

/** The key of the cycle a day ('YYYY-MM-DD') belongs to: the 26th onward belongs to the NEXT month's cycle. */
export function cycleKeyOf(dayIso) {
  const d = new Date(String(dayIso).slice(0, 10) + 'T00:00:00Z');
  if (isNaN(d)) return null;
  if (d.getUTCDate() >= 26) d.setUTCMonth(d.getUTCMonth() + 1, 1);
  return 'cycle-' + iso(d).slice(0, 7);
}

/** The two cycles a manager can open today (SAST): the one in progress and the last complete one. */
export function cyclesNow(nowMs) {
  const today = new Date(nowMs + 2 * 3600000).toISOString().slice(0, 10);
  const cur = cycleRange(cycleKeyOf(today));
  const d = new Date(cur.from + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 1);   // the 25th before it
  const last = cycleRange(cycleKeyOf(iso(d)));
  return { current: { ...cur, complete: false }, last: { ...last, complete: true } };
}
