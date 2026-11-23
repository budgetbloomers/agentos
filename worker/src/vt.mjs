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
import { canUpload } from './rules.mjs';

export const VT_STAGE_MAX = 512 * 1024;
export const VT_BODY_MAX = 64 * 1024;
export const VT_BOOK_MAX = 256 * 1024;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const STEPS = new Set(['begin', 'stage', 'commit', 'abandon']);
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
const NO_UPLOAD = () => json({ error: 'Not permitted — this needs Upload Station access.' }, 403);
const REFUSALS = /^(stage_incomplete|not_staging|batch_too_large|unknown_upload|rows_not_array|not_owner|upload_too_large|too_many_uploads|bad_extract_on|bad_cycle_key|bad_date|bad_file_name|bad_user|duplicate_case|duplicate_event|bad_receipt|commit_too_large)\b/;

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
