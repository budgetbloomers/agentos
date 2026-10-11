/**
 * THE USAGE REPORT — what people did, written for Supabase to query (Spec Kit 028, 2026-10-11).
 *
 * Nick: "I need you to create me a table in supabase so we can see how many times users ask for request, how many
 * times users login in to the software … see what users ask their team leader most of the time etc".
 *
 * The table is usage_events (supabase/migration-061). Sign-ins are NOT written here: every auth_log row is mirrored
 * into it by a database trigger, so the report and the lockout's own log can never disagree. This module records what
 * only the Worker sees — app opens, help asks, help stage moves, campaign-manager requests and actions, AI questions.
 *
 * THE RULE (FR-006): recording never fails or slows the request it describes.
 *   · ONE subrequest per recorded event, handed to ctx.waitUntil — never awaited on the request path;
 *   · every failure (a 500, a network throw, a missing table before the migration lands) is caught and dropped;
 *   · nothing here retries — the Cloudflare FREE plan's 50-subrequest budget belongs to the request.
 * Telemetry is deliberately fire-and-forget (constitution VI's banner/retry is for saves people make, not for this).
 */

export const USAGE_APPS = ['vas', 'ops', 'agent', 'tracker', 'wimpy', 'worker'];
export const OPEN_DEDUPE_MS = 60000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TEXT = 2000;

/* WHICH APP. The page says where it is (`?page=<location.pathname>` on /api/me, /api/portal/me and /api/ask; `page` in
   the sign-in body) because the Worker cannot see it: site/_headers sets Referrer-Policy strict-origin-when-cross-origin,
   so a cross-origin Referer is the ORIGIN alone — every page would read as "/" (Ops). Unknown → null, never a guess. */
export function appFromPage(page) {
  let p = String(page || '').trim();
  if (!p) return null;
  if (/^https?:\/\//i.test(p)) { try { p = new URL(p).pathname; } catch (e) { return null; } }
  p = p.split(/[?#]/)[0].toLowerCase();
  if (/^\/pulse(\/|\.|$)/.test(p)) return 'vas';
  if (/^\/tracker(\/|\.|$)/.test(p)) return 'tracker';
  if (/^\/agent(\/|\.|$)/.test(p)) return 'agent';                  // never /agent-preview/ (the prototype)
  if (p === '/' || p === '/index.html') return 'ops';
  return null;
}

/** the page a request came from: the explicit `page` param, else a Referer that carries a real path (same-origin). */
export function pageOf(req, url) {
  const q = url && url.searchParams && url.searchParams.get('page');
  if (q) return q;
  try {
    const ref = req && req.headers && req.headers.get('referer');
    if (ref) { const p = new URL(ref).pathname; if (p && p !== '/') return p; }
  } catch (e) { /* unparseable Referer — no page */ }
  return null;
}

const clip = (v, n) => (v == null || v === '' ? null : String(v).slice(0, n));
function clipDetail(d) {
  if (!d || typeof d !== 'object') return null;
  const out = {};
  for (const [k, v] of Object.entries(d)) {
    if (v === undefined) continue;
    out[k] = typeof v === 'string' ? v.slice(0, MAX_TEXT) : v;
  }
  return out;
}

/** the row as usage_events takes it, or null when there is no event. Never throws on odd input. */
export function usageRow(ev) {
  if (!ev || typeof ev !== 'object' || !ev.event) return null;
  const row = {
    user_id: UUID.test(String(ev.user_id || '')) ? String(ev.user_id) : null,
    username: clip(ev.username, 80),
    role: clip(ev.role, 40),
    app: USAGE_APPS.includes(ev.app) ? ev.app : null,
    event: String(ev.event).slice(0, 40),
    category: clip(ev.category, 120),
    team_leader: clip(ev.team_leader, 120),
    campaign: clip(ev.campaign, 120),
    detail: clipDetail(ev.detail),
    source: 'worker',
    source_key: clip(ev.source_key, 300),
  };
  if (ev.at && !isNaN(Date.parse(ev.at))) row.at = new Date(Date.parse(ev.at)).toISOString();   // else the database clock
  return row;
}

/** ONE insert, ON CONFLICT (source_key) DO NOTHING. Resolves whatever happens — callers may chain, never need to catch. */
export function usageInsert(DB, ev) {
  try {
    const row = usageRow(ev);
    if (!row || !DB || typeof DB.insert !== 'function') return Promise.resolve(null);
    return Promise.resolve(DB.insert('usage_events?on_conflict=source_key', [row], 'ignore')).then(() => row, () => null);
  } catch (e) { return Promise.resolve(null); }
}

/** fire-and-forget: hands the insert to ctx.waitUntil and returns NOTHING, so no caller can await it on the request path. */
export function recordUsage(DB, ctx, ev) {
  try {
    const p = usageInsert(DB, ev);
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(p);
  } catch (e) { /* never in the way */ }
}

/* ONE OPEN PER PERSON × APP PER MINUTE (in this isolate). A reload storm, or the /api/me that follows a sign-in, is not a
   second open. Per isolate on purpose: no subrequest is spent on de-duplication; a rare second isolate counts twice. */
export function firstOpen(userKey, app, now = Date.now()) {
  const seen = (globalThis.__usageSeen = globalThis.__usageSeen || new Map());
  const k = String(userKey || '') + '|' + String(app || '');
  const last = seen.get(k);
  if (last != null && now - last < OPEN_DEDUPE_MS) return false;
  seen.set(k, now);
  if (seen.size > 2000) for (const [key, t] of seen) if (now - t >= OPEN_DEDUPE_MS) seen.delete(key);
  return true;
}
export function resetUsageSeen() { globalThis.__usageSeen = new Map(); }

/* AN ASK AND ITS TOPIC (Spec Kit 029). A help ask or a CM request is inserted asking for its row id back (still ONE
   insert, still ON CONFLICT DO NOTHING — a row already there comes back empty and is then found by its source_key), and
   `label` (topics.mjs askLabeller) runs AFTER it, inside the same waitUntil: the response has long gone by then. */
export const ASK_EVENTS = ['help_ask', 'cm_request'];
export function usageInsertReturning(DB, ev) {
  try {
    const row = usageRow(ev);
    if (!row || !DB || typeof DB.insert !== 'function') return Promise.resolve(null);
    return Promise.resolve(DB.insert('usage_events?on_conflict=source_key&select=id', [row], 'ignore', true))
      .then((got) => ({ row, id: Array.isArray(got) && got[0] && got[0].id != null ? got[0].id : null }), () => null);
  } catch (e) { return Promise.resolve(null); }
}
export function recordAskEvent(DB, ctx, ev, label) {
  try {
    const p = usageInsertReturning(DB, ev).then((res) => (res && typeof label === 'function' ? label(res) : null)).catch(() => null);
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(p);
  } catch (e) { /* never in the way */ }
}

/** the request's recorder: track(user, ev) → recordUsage with who did it. Built once per request, before any block
    shadows `ctx` (the campaign-manager route names its CM context `ctx`). opts.label (029): the ask labeller. */
export function usageTracker(DB, ctx, opts) {
  const label = opts && typeof opts.label === 'function' ? opts.label : null;
  return (user, ev) => {
    const full = { user_id: user && user.user_id, username: user && user.username, role: user && user.role, ...(ev || {}) };
    if (label && ASK_EVENTS.includes(full.event)) return recordAskEvent(DB, ctx, full, label);
    return recordUsage(DB, ctx, full);
  };
}

/** an app open, de-duplicated; `via` is 'login' or 'boot'. TLs carry their own team as the team leader. */
export function recordOpen(track, user, page, via) {
  if (!user) return;
  const app = appFromPage(page);
  if (!firstOpen(user.user_id || user.username, app)) return;
  track(user, { event: 'app_open', app, team_leader: user.role === 'team_leader' ? (user.team || null) : null, detail: { via } });
}

/* AN AI QUESTION. The ask_log row is written exactly as before (asked_by, question, answer, model) but asked to return
   its id, so the usage row is keyed ask_log:<id> — the key tools/usage-backfill.mjs gives the same question, so a
   backfill after release never counts it twice. Both writes run in ONE waitUntil, after the answer has gone; ask_log is
   the existing subrequest, the usage row the one extra. */
export function recordAsk(DB, ctx, user, { question, answer, model, app }) {
  try {
    const p = (async () => {
      let id = null;
      try {
        const rows = await DB.insert('ask_log', [{ asked_by: user && user.username, question, answer, model }], false, true);
        id = rows && rows[0] && rows[0].id != null ? rows[0].id : null;
      } catch (e) { /* the audit row failed — the usage row still says a question was asked */ }
      await usageInsert(DB, { user_id: user && user.user_id, username: user && user.username, role: user && user.role, app,
        event: 'ai_question', detail: { question, model, ask_id: id }, source_key: id != null ? 'ask_log:' + id : null });
    })();
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(p);
  } catch (e) { /* never in the way */ }
}
