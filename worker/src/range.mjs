/**
 * range.mjs — THE CUSTOM DATE RANGE (spec 006-cm-custom-range, 2026-10-06).
 *
 * "For Dalwin, please add custom range for him to filter his reports." A campaign manager picks a from and a to date;
 * the period key is `range-YYYY-MM-DD-YYYY-MM-DD` (hyphens only, so the Worker's staff-only guard on
 * `agent-digest(-[a-z0-9-]+)?` covers its digest). Like a billing month (cycle.mjs), a range is BUILT BY THE ENGINE on
 * the laptop tick (tools/digest-republish.mjs: __mtd.setRange → agentDigestPayload + both report payloads) and
 * published under its own keys — kv:agent-digest-range-…, kv:agent-reports-variance-range-…,
 * kv:agent-reports-leads-range-… — and the Worker only serves it. Asking for one that is not built yet queues it in
 * kv:cm-range-requests.
 *
 * One definition for the Worker (portal.mjs), the tool and the suites: the validation, the label and the queue rules
 * below. Pure, no I/O. The page (agent/index.html cmRangeProblem) mirrors the validation for its own message only —
 * the Worker decides.
 */
import { cycleLabel } from './cycle.mjs';

export const RANGE_MIN_FROM = '2025-01-01';            // the floor has no figures before this
export const RANGE_MAX_DAYS = 93;                      // one engine build stays inside the tick's time budget
export const RANGE_QUEUE_KEY = 'kv:cm-range-requests';
export const RANGE_QUEUE_MAX = 20;                     // ranges WAITING at once — a 21st is refused until the tick catches up
export const RANGE_QUEUE_TTL_DAYS = 7;                 // a request older than this is dropped from the queue
export const RANGE_FILLING_DAYS = 2;                   // a range ending within this many days is rebuilt on every run
export const RANGE_REFUSED_RETRY_DAYS = 1;             // a refusal older than this is tried again when somebody asks (the days may have landed)

const KEY_RE = /^range-(\d{4}-\d{2}-\d{2})-(\d{4}-\d{2}-\d{2})$/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_MS = 86400000;

/** Today's date in SAST ('YYYY-MM-DD'). */
export const todaySast = (nowMs) => new Date(nowMs + 2 * 3600000).toISOString().slice(0, 10);
/** A real calendar day written YYYY-MM-DD (2026-02-30 is not one). */
const realDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s)) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
const addDays = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') + n * DAY_MS).toISOString().slice(0, 10);
/** Days in from..to, both ends counted (1 – 15 Sep = 15). */
export const rangeDays = (from, to) => Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / DAY_MS) + 1;
export const rangeKey = (from, to) => 'range-' + from + '-' + to;

/** '' when from..to is a range a manager may ask for, else what is wrong, in words. Same order as the page. */
export function rangeProblem(from, to, nowMs) {
  if (!realDay(from) || !realDay(to)) return 'Pick a from date and a to date.';
  if (from < RANGE_MIN_FROM) return 'The earliest date you can pick is 1 January 2025.';
  if (from > to) return 'The from date is after the to date.';
  if (to > todaySast(nowMs)) return 'The to date is after today.';
  const n = rangeDays(from, to);
  if (n > RANGE_MAX_DAYS) return 'A range can be at most ' + RANGE_MAX_DAYS + ' days — this one is ' + n + ' days.';
  return '';
}

/** '1 – 15 Sep 2026' · '26 Aug – 25 Sep 2026' · '15 Dec 2025 – 10 Jan 2026' · '1 Oct 2026' (one day). */
export function rangeLabel(from, to) {
  if (from === to) { const d = new Date(from + 'T00:00:00Z'); return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear(); }
  if (from.slice(0, 7) === to.slice(0, 7)) {
    const t = new Date(to + 'T00:00:00Z');
    return Number(from.slice(8, 10)) + ' – ' + t.getUTCDate() + ' ' + MONTHS[t.getUTCMonth()] + ' ' + t.getUTCFullYear();
  }
  return cycleLabel(from, to);
}

/** 'range-YYYY-MM-DD-YYYY-MM-DD' → {key, from, to, label, days} when it is a range a manager may ask for; null otherwise. */
export function rangeOf(key, nowMs) {
  const m = KEY_RE.exec(String(key == null ? '' : key));
  if (!m || rangeProblem(m[1], m[2], nowMs)) return null;
  return { key: rangeKey(m[1], m[2]), from: m[1], to: m[2], label: rangeLabel(m[1], m[2]), days: rangeDays(m[1], m[2]) };
}

/** A range still FILLING: its last day is within RANGE_FILLING_DAYS of today (SAST) — its figures can still move. */
export const rangeFilling = (to, nowMs) => String(to) >= addDays(todaySast(nowMs), -RANGE_FILLING_DAYS);

/* ---------------------------------------------------------------------------
   THE QUEUE — kv:cm-range-requests = { v:1, requests:[{key, from, to, by, at, status, reason?, statusAt?}] }.
   status: 'waiting' (the tool has not built it yet) | 'built' | 'refused' (reason says why, in words the page shows).
   `at` is when it was FIRST asked for; the 7-day drop counts from it. Pure: the Worker and the tool read, apply one of
   these and write back by compare-and-set on the row's updated_at.
   --------------------------------------------------------------------------- */
const statusOf = (e) => (e && e.status) || 'waiting';

/** The request list held by a rules value (anything malformed reads as an empty queue). */
export function queueList(value) {
  const v = value && typeof value === 'object' ? value : null;
  return v && Array.isArray(v.requests) ? v.requests.filter((e) => e && typeof e.key === 'string') : [];
}

/** Requests asked within the last RANGE_QUEUE_TTL_DAYS (an undated one is dropped). */
export function pruneQueue(list, nowMs) {
  const cut = nowMs - RANGE_QUEUE_TTL_DAYS * DAY_MS;
  return (list || []).filter((e) => { const t = Date.parse(e && e.at); return Number.isFinite(t) && t >= cut; });
}

/**
 * A manager asks for an unbuilt range. → {list, state, entry, changed}
 *   state 'queued'  — added (or a 'built' entry whose digest has gone missing, re-queued): write `list`
 *   state 'waiting' — already waiting: nothing to write
 *   state 'refused' — the tool refused it less than RANGE_REFUSED_RETRY_DAYS ago; `entry.reason` says why: nothing to
 *                     write. An OLDER refusal is queued again (state 'queued') — the missing days may have landed since.
 *   state 'full'    — RANGE_QUEUE_MAX ranges are already waiting: nothing to write
 */
export function enqueueRange(list, req, nowMs) {
  const live = pruneQueue(list, nowMs);
  const i = live.findIndex((e) => e.key === req.key);
  if (i >= 0) {
    const e = live[i], st = statusOf(e);
    if (st === 'waiting') return { list: live, state: 'waiting', entry: e, changed: false };
    const refusedAt = Date.parse(e.statusAt || e.at);
    if (st === 'refused' && Number.isFinite(refusedAt) && nowMs - refusedAt <= RANGE_REFUSED_RETRY_DAYS * DAY_MS)
      return { list: live, state: 'refused', entry: e, changed: false };
    const again = { key: e.key, from: e.from, to: e.to, by: e.by, at: new Date(nowMs).toISOString(), status: 'waiting' };
    return { list: live.map((x, j) => (j === i ? again : x)), state: 'queued', entry: again, changed: true };
  }
  if (live.filter((e) => statusOf(e) === 'waiting').length >= RANGE_QUEUE_MAX) return { list: live, state: 'full', entry: null, changed: false };
  const entry = { key: req.key, from: req.from, to: req.to, by: String(req.by || ''), at: new Date(nowMs).toISOString(), status: 'waiting' };
  return { list: [...live, entry], state: 'queued', entry, changed: true };
}

/** The tool's results back onto the queue: results = [{key, status:'built'|'refused', reason?}]. A request the queue no
 *  longer holds is not re-added (it was dropped meanwhile); expired entries go. Returns a NEW list. */
export function settleQueue(list, results, nowMs) {
  const by = new Map((results || []).filter((r) => r && r.key && (r.status === 'built' || r.status === 'refused')).map((r) => [r.key, r]));
  const at = new Date(nowMs).toISOString();
  return pruneQueue(list, nowMs).map((e) => {
    const r = by.get(e.key);
    if (!r) return e;
    const { reason: _drop, ...rest } = e;
    return r.status === 'refused'
      ? { ...rest, status: 'refused', reason: String(r.reason || 'The engine could not build this range.').slice(0, 300), statusAt: at }
      : { ...rest, status: 'built', statusAt: at };
  });
}
