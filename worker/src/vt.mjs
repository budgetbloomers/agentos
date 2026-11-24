/* VEHICLE TRACKING ROUTES (Spec Kit 071, specs/071-vehicle-tracking-analytics/plan.md §DB, §P).
 *
 * INTAKE HALF (Phase C). The browser parses the VT files, the engine (nicks_code/vt-engine.js) merges them, and these
 * routes only CARRY: the request body IS the SQL function's arguments and the answer IS its value, streamed both ways
 * without a parse — the Cloudflare FREE plan gives a request 10 ms of CPU, and a 0.6–4 MB book or a 480 KB stage batch
 * would spend it all in JSON.parse. Every route costs one subrequest beyond the session lookup.
 *
 *   GET  /api/vt/book?from=YYYY-MM-DD        → vt_book(p_from)               the book, streamed (any from = whole book)
 *   POST /api/vt/book   {p_from, p_also}     → vt_book(p_from, p_also)       the station's merge read (≤ 256 KB body ≈ 20k
 *                                                                             case numbers; the station chunks above ~15k)
 *   POST /api/vt/upload/begin                → vt_upload_begin(…, p_user)    a LIVE upload of the same bytes → 409 busy
 *   POST /api/vt/upload/stage                → vt_upload_stage(…, p_user)    ≤ 512 KB per call, else 413
 *   POST /api/vt/upload/commit               → vt_upload_commit(…, p_user)   version_conflict → 409 (the station retries)
 *   POST /api/vt/upload/abandon              → vt_upload_abandon(…, p_user)
 *   GET  /api/vt/uploads?limit=n             → the newest n (≤ 100) receipts
 *   GET  /api/vt/roster?on=YYYY-MM-DD        → vt_roster_at(p_on)            the VT Agent List in force (migration-072)
 *
 * WHO: a full-scope staff session holding the Upload Station (rules.mjs canUpload) — the same grant as every other load
 * route. Portal roles never reach here (index.mjs PORTAL_ALLOWED is an allow-list and names no /api/vt route) and the
 * four writes are in GATED_WRITES (an outdated tab may not write). p_user on all four writes is the SESSION's username,
 * appended as the body's LAST key (Postgres reads the last of two equal keys), so whatever the client sends, an upload
 * belongs to the account that began it and no other may stage, commit or abandon it (review S-M3). The receipts carry
 * SELLER names (staff), never a customer field — the browser dropped those before anything was sent (FR-007).
 *
 * BODIES (review S-M1): a POST must declare a numeric Content-Length (else 411 — every browser fetch with a string body
 * does); the declared length decides 413 before a byte is read, and the bytes are COUNTED while read (the house
 * countCap pattern of index.mjs, repeated here because index.mjs imports this module), so a body longer than it
 * declared stops at the cap.
 * ERRORS (review S-L1): a refusal the database raised by name → 409 {error:<code>, detail}; a check violation → 409
 * {error:'bad_row', detail:<constraint>}; anything else → 502 {error:'vt_<step>_failed'} with the database's words in
 * the Worker log (console.error, as the portal routes do), never in the answer.
 * The book answer is application/json with status 200, which Cloudflare's edge compresses (gzip / brotli) for any browser
 * that accepts it, so nothing is added here for that (review D-M10).
 * The portal half (Phase E: scoped digest slices, unmatched seller names stripped for non-staff) is added below.
 */
import { canUpload, isFullScope, VT_DIGEST_MAX, vtPointerView } from './rules.mjs';
import { cycleRange } from './cycle.mjs';
import { vtInScope } from './campaign.mjs';   // VT in a manager's scope — for the VT cards only (E6)

export const VT_STAGE_MAX = 512 * 1024;
export const VT_BODY_MAX = 64 * 1024;
export const VT_BOOK_MAX = 256 * 1024;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const STEPS = new Set(['begin', 'stage', 'commit', 'abandon']);
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
const NO_UPLOAD = () => json({ error: 'Not permitted — this needs Upload Station access.' }, 403);
const REFUSALS = /^(stage_incomplete|not_staging|batch_too_large|unknown_upload|rows_not_array|not_owner|upload_too_large|too_many_uploads|bad_extract_on|bad_cycle_key|bad_date|bad_file_name|bad_user|duplicate_case|duplicate_event|bad_receipt|commit_too_large|bad_cancel)\b/;

/* what PostgREST answered for a failed function call → a status and a short reason the station can show */
function refusal(step, status, text) {
  const msg = (() => { try { return String(JSON.parse(text).message || ''); } catch (e) { return String(text || ''); } })();
  if (/version_conflict/.test(msg)) return json({ error: 'version_conflict' }, 409);
  if (/opening_book_before_first_day/.test(msg)) return json({ error: 'Load the opening book after the first day\'s two files (BI Active Fitted and Scheduled & Missed): it only dates cases already in the book.' }, 409);
  const code = (REFUSALS.exec(msg) || [])[1];
  if (code) return json({ error: code, detail: msg.slice(0, 200) }, 409);
  const ck = /violates check constraint "(\w{1,80})"/.exec(msg);
  if (ck) return json({ error: 'bad_row', detail: ck[1] }, 409);
  console.error('vt ' + step + ' failed: ' + status + ' ' + msg.slice(0, 300));
  return json({ error: 'vt_' + step + '_failed' }, 502);
}
const rpcFetch = (env, fn, body) => fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
  method: 'POST', body,
  headers: { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY, 'Content-Type': 'application/json' },
});
async function rpcStream(env, fn, body, step) {
  const r = await rpcFetch(env, fn, body);
  if (!r.ok) return refusal(step, r.status, await r.text());
  return new Response(r.body, { status: 200, headers: { 'Content-Type': 'application/json' } });   // CORS is added on the way out (index.mjs)
}
/* begin's answer is a few bytes, so it is read: {busy:true} (a LIVE upload of the same bytes, review D-H2) is a refusal,
   so no station can mistake the other upload's id for its own and stage into it */
async function rpcBegin(env, body) {
  const r = await rpcFetch(env, 'vt_upload_begin', body);
  const t = await r.text();
  if (!r.ok) return refusal('begin', r.status, t);
  let a = null; try { a = JSON.parse(t); } catch (e) { a = null; }
  if (a && a.busy === true) return json({ error: 'busy', id: a.id, since: a.since || null }, 409);
  return new Response(t, { status: 200, headers: { 'Content-Type': 'application/json' } });
}
function countCap(cap) {
  let n = 0;
  return new TransformStream({ transform(c, k) { n += c.byteLength; if (n > cap) k.error(new Error('too_large')); else k.enqueue(c); } });
}
/* the declared length decides before a byte is read; the bytes are counted while read; no declared length → 411 */
async function cappedBody(req, max) {
  const cl = req.headers.get('content-length');
  if (cl == null || !/^\s*\d+\s*$/.test(cl)) return { status: 411 };
  const n = Number(cl);
  if (n > max) return { status: 413 };
  if (n === 0 || !req.body) return { body: '{}' };
  try { return { body: (await new Response(req.body.pipeThrough(countCap(max))).text()) || '{}' }; }
  catch (e) { return /too_large/.test(String((e && e.message) || e)) ? { status: 413 } : { status: 400 }; }
}
/* the session's uploader as the LAST key of the body's JSON object, without parsing it (a 480 KB stage batch would cost
   the 10 ms CPU budget in JSON.parse). null when the body is not an object. */
function withUser(text, user) {
  const s = String(text).trim();
  if (s[0] !== '{' || s[s.length - 1] !== '}') return null;
  const empty = s.length < 64 && /^\{\s*\}$/.test(s);
  return s.slice(0, -1) + (empty ? '' : ',') + '"p_user":' + JSON.stringify(String(user)) + '}';
}
const bodyRefusal = (b, max) => b.status === 411 ? json({ error: 'length_required: declare a Content-Length' }, 411)
  : b.status === 400 ? json({ error: 'unreadable body' }, 400)
  : json({ error: 'Body too large: at most ' + Math.round(max / 1024) + ' KB per call.' }, 413);

/** The intake routes. Returns a Response for an /api/vt/* path it owns, else null (the router carries on). */
export async function vtIntakeRoute(req, url, env, user) {
  const path = url.pathname;
  if (!path.startsWith('/api/vt/')) return null;
  const isBook = path === '/api/vt/book', step = path.startsWith('/api/vt/upload/') ? path.slice('/api/vt/upload/'.length) : null;
  if (!isBook && !step && path !== '/api/vt/uploads' && path !== '/api/vt/roster') return null;
  if (!user) return json({ error: 'not signed in' }, 401);
  if (!canUpload(user)) return NO_UPLOAD();

  if (isBook && req.method === 'GET') {
    const from = url.searchParams.get('from');
    if (from && !DAY.test(from)) return json({ error: 'from must be YYYY-MM-DD' }, 400);
    return rpcStream(env, 'vt_book', JSON.stringify({ p_from: from || null }), 'book');
  }
  if (isBook && req.method === 'POST') {
    const b = await cappedBody(req, VT_BOOK_MAX); if (b.status) return bodyRefusal(b, VT_BOOK_MAX);
    return rpcStream(env, 'vt_book', b.body, 'book');
  }
  if (step) {
    if (!STEPS.has(step)) return json({ error: 'unknown step' }, 404);
    if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
    const max = step === 'stage' ? VT_STAGE_MAX : VT_BODY_MAX;
    const b = await cappedBody(req, max); if (b.status) return bodyRefusal(b, max);
    const body = withUser(b.body, user.username);
    if (!body) return json({ error: 'bad arguments: the body must be a JSON object' }, 400);
    return step === 'begin' ? rpcBegin(env, body) : rpcStream(env, 'vt_upload_' + step, body, step);
  }
  if (req.method !== 'GET') return json({ error: 'GET only' }, 405);
  if (path === '/api/vt/uploads') {
    const lim = Math.min(Math.max(Number(url.searchParams.get('limit')) || 20, 1), 100);
    const cols = 'id,sha256,kind,file_name,extract_on,cycle_key,state,counts,unmatched,warnings,quiet_day_ack,uploaded_by,started_at,committed_at,rev_after';
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/vt_uploads?select=${cols}&order=id.desc&limit=${lim}`, {
      headers: { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY } });
    const t = await r.text();
    if (!r.ok) { console.error('vt uploads failed: ' + r.status + ' ' + t.slice(0, 300)); return json({ error: 'vt_uploads_failed' }, 502); }
    return new Response('{"uploads":' + (t || '[]') + '}', { status: 200, headers: { 'Content-Type': 'application/json' } });   // wrapped, not parsed
  }
  const on = url.searchParams.get('on');
  if (!on || !DAY.test(on)) return json({ error: 'on must be YYYY-MM-DD' }, 400);
  return rpcStream(env, 'vt_roster_at', JSON.stringify({ p_on: on }), 'roster');
}
/* ================= portal half (Phase E) below this line ================= */
/* PORTAL HALF (Phase E). Agent Analytics reads the PUBLISHED VT digest (kv:vt-digest, kv:vt-digest-cycle-YYYY-MM — written
 * by PULSE / tools/digest-republish.mjs, staff only, fenced in rules.mjs vtDigestFence) and the Worker only SLICES it: one
 * parse per key per minute per isolate (the 60 s cache, value.store path), never the case book, never a recomputation —
 * the FREE plan's 10 ms CPU and 50 subrequests (FR-051). Every scope comes from the SESSION, never from the request:
 *   agent            → their own row only (session CB)
 *   team_leader      → the rows whose team leader is them on the Agent List (the list's leader CB = session CB, or the
 *                      leader's name = the session's team, the VAS rule), plus their own team block
 *   campaign_manager → the whole VT floor, only when VT is in their scope (campaign.mjs vtInScope)
 *   admin / exec     → everything (staff); every other role → 403; a scoped (wimpy, referrals) session → 403
 * floor.unmatched.names (Salesforce spellings of people not on the list) is STAFF material and is stripped for every
 * portal scope. WHICH CARD an agent gets is decided here too (vtAgentOverview): a CB on the published VT digest is a VT
 * agent and gets scorecard:'vt'; anyone else falls through to the VAS answer, untouched. */

const VT_CACHE_MS = 60000;
const CYCLE_RE = /^cycle-\d{4}-(0[1-9]|1[0-2])$/;
const normCode = (v) => { const d = String(v == null ? '' : v).toUpperCase().replace(/[^0-9]/g, ''); return d ? 'CB' + String(parseInt(d, 10)) : ''; };
const trim = (v) => String(v == null ? '' : v).trim();

/* THE READER'S LIMITS (security review H2c/d, LOW-1, 2026-11-23). A stored digest over VT_DIGEST_MAX — by the size its pointer
   carries, or by its own length for a pointer without one — is never parsed; it and a digest that does not parse are cached as
   "no VT digest" (the 60 s negative cache), so a bad digest costs one read a minute per isolate, never one per request, and every
   reader degrades to "nothing published" (a VAS agent gets the VAS answer, a VT agent the honest notice). At most VT_CACHE_KEYS
   keys are kept per isolate (the live key and the history months asked for; the oldest entry goes first). */
const VT_CACHE_KEYS = 8;
function cachePut(cc, key, d) {
  cc[key] = { t: Date.now(), d };
  const ks = Object.keys(cc);
  if (ks.length > VT_CACHE_KEYS) ks.sort((a, b) => cc[a].t - cc[b].t).slice(0, ks.length - VT_CACHE_KEYS).forEach((k) => { delete cc[k]; });
}
/** The live key's POINTER row value (small: {store, period, size, agents, asOf, updatedAt, codes}), {} when nothing is published,
 *  cached 60 s per isolate like the digest. A failed read throws (the caller decides). */
export async function loadVtPointer(DB) {
  const c = globalThis.__vtPointerCache;
  if (c && Date.now() - c.t < VT_CACHE_MS) return c.v;
  const r = await DB.select('rules?key=eq.' + encodeURIComponent('kv:vt-digest') + '&select=value');
  const v = (r && r[0] && r[0].value) || {};
  globalThis.__vtPointerCache = { t: Date.now(), v };
  return v;
}
/** The published VT digest: live (no cycle) or one business month's history. null when nothing is published — or when what is
 *  stored is over the cap or is not a VT digest. ptr: the live key's pointer value when the caller already read it. */
export async function loadVtDigest(DB, cycleKey, ptr) {
  if (cycleKey != null && cycleKey !== '' && !CYCLE_RE.test(String(cycleKey))) return null;
  const key = cycleKey ? 'kv:vt-digest-' + cycleKey : 'kv:vt-digest';
  const cc = (globalThis.__vtDigestCaches = globalThis.__vtDigestCaches || {});
  const c = cc[key];
  if (c && Date.now() - c.t < VT_CACHE_MS) return c.d;
  let v = !cycleKey && ptr ? ptr : null;
  if (!v) { const r = await DB.select('rules?key=eq.' + encodeURIComponent(key) + '&select=value'); v = (r && r[0] && r[0].value) || {}; }
  if (Number(v.size) > VT_DIGEST_MAX) { console.warn(key + ' is ' + v.size + ' bytes, over the ' + VT_DIGEST_MAX + ' the portal reads — served as not published'); cachePut(cc, key, null); return null; }
  let payload = String(v.data || '');
  if (!payload && v.store) payload = (await DB.storageGet('raw', String(v.store).replace(/^raw\//, ''))) || '';
  let d = null;
  if (payload.length > VT_DIGEST_MAX) console.warn(key + ' reads ' + payload.length + ' bytes, over the cap — served as not published');
  else if (payload) { try { d = JSON.parse(payload); } catch (e) { console.warn(key + ' does not parse — served as not published'); d = null; } }
  if (d && (typeof d !== 'object' || d.scorecard !== 'vt' || !Array.isArray(d.agents))) d = null;
  cachePut(cc, key, d);
  return d;
}
/** The business months with a published history key, newest first (found by key prefix, like the VAS months). */
export async function listVtCycles(DB) {
  const c = globalThis.__vtCycles;
  if (c && Date.now() - c.t < VT_CACHE_MS) return c.s;
  let s = [];
  try {
    const rows = await DB.select('rules?key=like.' + encodeURIComponent('kv:vt-digest-cycle-%') + '&select=key');
    s = (rows || []).map((x) => String(x.key).slice('kv:vt-digest-'.length)).filter((k) => CYCLE_RE.test(k)).sort().reverse();
  } catch (e) { s = []; }
  globalThis.__vtCycles = { t: Date.now(), s };
  return s;
}

/** Who this session may see on the VT digest: {scope, rows, codes, staff?, tlCodes?} | {none:true} | {error, status}. */
export function vtScope(user, d, cmCtx) {
  if (!user || !isFullScope(user)) return { error: 'Not permitted.', status: 403 };
  const agents = (d && Array.isArray(d.agents)) ? d.agents : [];
  if (user.role === 'agent') {
    const cb = normCode(user.cb);
    if (!cb) return { error: 'This account is not linked to a CB number yet. Ask your team leader.', status: 403 };
    const me = agents.find((a) => a && normCode(a.code) === cb);
    return me ? { scope: 'agent', cb, rows: [me], codes: new Set([cb]) } : { none: true };
  }
  if (user.role === 'team_leader') {
    const cb = normCode(user.cb), team = trim(user.team);
    if (!cb && !team) return { error: 'This team leader account is not linked to a team yet.', status: 403 };
    const rows = agents.filter((a) => a && ((cb && normCode(a.tlCode) === cb) || (team && trim(a.tl) === team)));
    if (!rows.length) return { none: true };
    return { scope: 'team', cb, team, rows, codes: new Set(rows.map((a) => normCode(a.code))), tlCodes: new Set(rows.map((a) => normCode(a.tlCode)).filter(Boolean)) };
  }
  if (user.role === 'campaign_manager') {
    if (!cmCtx) return { error: 'Campaign assignments are not loaded — try again in a moment.', status: 503 };
    if (!vtInScope(cmCtx, user.username)) return { none: true };
    return { scope: 'campaign', rows: agents, codes: new Set(agents.map((a) => normCode(a.code))) };
  }
  if (user.role === 'admin' || user.role === 'exec') return { scope: 'all', rows: agents, codes: new Set(agents.map((a) => normCode(a.code))), staff: true };
  return { error: 'Agent Analytics is for agents and team leaders. Sign in with your CB number.', status: 403 };
}

/* the frame every VT answer carries: the business month, the dictionary, the minima, the missing days — nobody named */
const frame = (d) => ({ scorecard: 'vt', period: d.period, updatedAt: d.updatedAt || null, empty: d.empty === true || undefined,
  version: d.version, workingDays: d.workingDays, workingDaysElapsed: d.workingDaysElapsed, trackFrom: d.trackFrom || null,
  weeks: d.weeks || [], dates: d.dates || [], dayCols: d.dayCols || null, drivers: d.drivers || [], minima: d.minima || null,
  gaps: d.gaps || null, budgets: d.budgets ? { cycle: d.budgets.cycle, fitment: d.budgets.fitment, missed: d.budgets.missed, hrsShare: d.budgets.hrsShare } : null });
const portalFloor = (fl, staff) => {
  if (!fl) return null;
  if (staff || !fl.unmatched) return fl;
  const { names: _n, ...un } = fl.unmatched;   // the Salesforce spellings are staff material (plan §P)
  return { ...fl, unmatched: un };
};
/* one agent's page: their row, their team leader's name, and for a scheduler the team's scheduling speed as context */
function agentBody(d, row, extra) {
  const tl = (d.tlAgg || []).find((t) => t && row && normCode(t.tlCode) === normCode(row.tlCode)) || null;
  const sched = !!(row && row.rating && row.rating.why === 'scheduling');
  const teamHrs = sched && tl ? { tl: tl.tl, hrsAhead: tl.hrsAhead || null } : null;
  return { ...frame(d), ...extra, scope: extra.scope || 'agent', me: row, team: row ? row.tl || '' : '', teamHrs };
}
function teamBody(d, s, user) {
  const staff = !!s.staff, codes = s.codes, wide = staff || s.scope === 'campaign';
  const tlAgg = (d.tlAgg || []).filter((t) => t && (wide || (s.tlCodes && s.tlCodes.has(normCode(t.tlCode)))));
  const notRated = (d.notRated || []).filter((n) => n && codes.has(normCode(n.code)));
  return { ...frame(d), scope: s.scope, staff, role: user.role, team: s.team || (wide ? 'Vehicle Tracking' : ''), agents: s.rows, notRated, tlAgg,
    subAgg: wide ? d.subAgg || {} : null, leadAgg: wide ? d.leadAgg || {} : null, floor: wide ? portalFloor(d.floor, staff) : null };
}

/** /api/portal/overview's question for an AGENT: is this CB on the published VT digest? → the VT answer, else null (VAS). */
/* A VAS AGENT NEVER READS THE VT DIGEST (security review H2, 2026-11-23). The live pointer row carries the VT roster index
   (`codes`, stamped by the fence from the published digest); a CB not on it is decided from that small row alone — one
   primary-key read a minute per isolate, no Storage read, no parse — so nothing about the VT digest (its size, a bad copy, a
   slow Storage) can touch a VAS agent's answer. A pointer without the index (written before this fix) falls back to the digest.
   Any failure → null → the VAS answer. */
export async function vtAgentOverview(DB, user) {
  if (!user || user.role !== 'agent' || !isFullScope(user)) return null;
  const cb = normCode(user.cb);
  if (!cb) return null;
  let d = null;
  try {
    const ptr = await loadVtPointer(DB);
    if (!ptr || (!ptr.store && !ptr.data)) return null;                     // nothing published
    if (Array.isArray(ptr.codes) && !ptr.codes.includes(cb)) return null;   // not a VT agent: decided from the pointer
    d = await loadVtDigest(DB, null, ptr);
  } catch (e) { console.warn('vt-digest read failed — the VAS answer is served', String((e && e.message) || e)); return null; }
  if (!d) return null;
  const s = vtScope(user, d, null);
  if (s.none || s.error) return null;
  const cycles = await listVtCycles(DB).catch(() => []);
  return { status: 200, body: agentBody(d, s.rows[0], { role: 'agent', name: user.full_name || user.username, cb: s.cb, cycles, months: [] }) };
}

/** GET /api/portal/vt/overview[?cycle=cycle-YYYY-MM] — the caller's VT slice; {none:true} when they have none. */
export async function vtOverview(DB, user, q, cmCtx) {
  const cyc = trim(q && q.cycle);
  if (cyc && !CYCLE_RE.test(cyc)) return { status: 400, body: { error: 'bad_cycle' } };
  /* LOW-1: a history month is looked up only when it is one of the published months (the 60 s list) — any other well-formed
     cycle answers "not published" without a database read or a cache entry */
  const cycles = await listVtCycles(DB);
  const d = cyc && !cycles.includes(cyc) ? null : await loadVtDigest(DB, cyc || null);
  if (!d) return { status: 200, body: { scorecard: null, none: true, published: false, cycles, period: cyc ? cycleRange(cyc) : null } };
  const s = vtScope(user, d, cmCtx);
  if (s.error) return { status: s.status, body: { error: s.error } };
  if (s.none) return { status: 200, body: { scorecard: null, none: true, published: true, cycles } };
  if (s.scope === 'agent') return { status: 200, body: agentBody(d, s.rows[0], { role: 'agent', name: user.full_name || user.username, cb: s.cb, cycles }) };
  return { status: 200, body: { ...teamBody(d, s, user), cycles } };
}

/** GET /api/portal/vt/agent?cb= — a team leader / manager / staff drilling into ONE VT agent. A set-membership test on the
 *  session's own scope, first: a CB outside it is 403, with nothing said about whether it exists. */
export async function vtAgentDetail(DB, user, wantCb, q, cmCtx) {
  const cyc = trim(q && q.cycle);
  if (cyc && !CYCLE_RE.test(cyc)) return { status: 400, body: { error: 'bad_cycle' } };
  const cb = normCode(wantCb);
  if (!cb) return { status: 400, body: { error: 'No agent specified.' } };
  if (!user || user.role === 'agent') return { status: 403, body: { error: 'That agent is not on your team.' } };
  const d = cyc && !(await listVtCycles(DB)).includes(cyc) ? null : await loadVtDigest(DB, cyc || null);   // LOW-1, as vtOverview
  if (!d) return { status: 404, body: { error: 'No Vehicle Tracking figures have been published yet.' } };
  const s = vtScope(user, d, cmCtx);
  if (s.error) return { status: s.status, body: { error: s.error } };
  if (s.none || !s.codes.has(cb)) return { status: 403, body: { error: 'That agent is not on your team.' } };
  const row = s.rows.find((a) => normCode(a.code) === cb);
  return { status: 200, body: agentBody(d, row, { role: user.role, scope: 'agent-detail', name: user.full_name || user.username }) };
}

/** GET /api/portal/tl/reports?kind=vt-mtd|vt-weekly|vt-daily[&cycle=] — the Reports tab's VT slice: the same scoped team
 *  rows and blocks as the overview, labelled with the report it feeds. An agent has no team: 403. */
export async function vtReports(DB, user, q, cmCtx) {
  const kind = trim(q && q.kind);
  if (!/^vt-(mtd|weekly|daily)$/.test(kind)) return { status: 400, body: { error: 'kind must be vt-mtd, vt-weekly or vt-daily' } };
  if (!user || user.role === 'agent') return { status: 403, body: { error: 'The Vehicle Tracking reports are a team leader page.' } };
  const r = await vtOverview(DB, user, q, cmCtx);
  if (r.status !== 200) return r;
  return { status: 200, body: { ...r.body, kind } };
}

/** The portal routes this module serves (index.mjs mounts them below the session gate; both paths are on PORTAL_ALLOWED,
 *  and the reports kinds ride the existing /api/portal/tl/reports). null = not a VT portal request. */
export const VT_PORTAL_PATHS = ['/api/portal/vt/overview', '/api/portal/vt/agent'];
export async function vtPortalRoute(req, url, DB, user, cmCtx) {
  const p = url.pathname;
  if (req.method !== 'GET') return null;
  const q = { cycle: url.searchParams.get('cycle') || '', kind: url.searchParams.get('kind') || '' };
  if (p === '/api/portal/vt/overview') return vtOverview(DB, user, q, cmCtx);
  if (p === '/api/portal/vt/agent') return vtAgentDetail(DB, user, url.searchParams.get('cb') || '', q, cmCtx);
  if (p === '/api/portal/tl/reports' && /^vt-/.test(q.kind)) return vtReports(DB, user, q, cmCtx);
  return null;
}

/* ---- the VT digest write fence, as POST /api/kv applies it (rules.mjs vtDigestFence is the rule) ---- */
/** {status, error} to refuse, or {pointer} for the row. Reads the key's own pointer row FRESH (never the 60 s cache) — a
 *  failed read refuses ("could not tell" is never "nothing is live"). */
export async function vtKvFence(DB, key, body, nowMs, fence) {
  let pj = null;
  try { pj = JSON.parse(body); } catch (e) { return { status: 400, error: 'the Vehicle Tracking digest is not JSON' }; }
  let live = null, liveKey = '';
  const pointerOf = async (k) => vtPointerView(((((await DB.select('rules?key=eq.' + encodeURIComponent('kv:' + k) + '&select=value')) || [])[0]) || {}).value || null);
  try {
    live = await pointerOf(key);   // a row written before the stamp reads as holding data (the safe side) — vtPointerView
    /* a history key of a CLOSED month asks what the live key holds (the rollover grace, review M1) */
    if (key !== 'vt-digest') { const lv = await pointerOf('vt-digest'); liveKey = lv ? lv.period : ''; }
  } catch (e) { return { status: 503, error: 'the ' + key + ' pointer could not be read — refused until it can (' + String((e && e.message) || e).slice(0, 100) + ')' }; }
  const f = fence(key, pj, live, nowMs, { liveKey });
  if (f.error) return f;
  if (globalThis.__vtDigestCaches) delete globalThis.__vtDigestCaches['kv:' + key];
  if (key === 'vt-digest') globalThis.__vtPointerCache = null;
  globalThis.__vtCycles = null;
  return f;
}

/* A VT-ONLY TEAM LEADER (review, 2026-11-23). /api/portal/overview answers a team leader from the VAS digest, and one whose team
   is on NO VAS row (not even a notCovered row) got the VAS 409 "No agents are currently assigned…" before VT was ever asked —
   reproduced in verify-vt-portal (Leader Three). When that is the only reason, and the published VT digest has their team, the
   VAS page is built over the VAS digest plus their VT agents as notCovered rows ({why:'campaign', campaign:'VT'}) — exactly the
   shape a team leader whose VT agents the VAS digest already lists gets today — so the page opens on their team and the VT rows,
   card and report tabs load beside it (agent/vt-view.js). Names and CBs only, no VT figure enters the VAS answer; a VAS team
   leader never reaches here (only after their own 409). null = no VT team either (the 409 stands). */
export async function vtTeamFallback(DB, user, digest) {
  if (!user || user.role !== 'team_leader' || !digest) return null;
  let d = null;
  try { d = await loadVtDigest(DB, null); } catch (e) { return null; }
  if (!d) return null;
  const s = vtScope(user, d, null);
  if (s.none || s.error || !s.rows.length) return null;
  const team = trim(user.team), have = new Set((digest.notCovered || []).map((n) => n && n.code));
  const add = s.rows.filter((a) => a && !have.has(normCode(a.code))).map((a) => ({ code: normCode(a.code), name: a.name || '', tl: team, why: 'campaign', campaign: 'VT' }));
  return { ...digest, notCovered: [...(digest.notCovered || []), ...add] };
}
