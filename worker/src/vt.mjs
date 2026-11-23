/* VEHICLE TRACKING ROUTES (Spec Kit 071, specs/071-vehicle-tracking-analytics/plan.md §DB, §P).
 *
 * INTAKE HALF (Phase C). The browser parses the VT files, the engine (nicks_code/vt-engine.js) merges them, and these
 * routes only CARRY: the request body IS the SQL function's arguments and the answer IS its value, streamed both ways
 * without a parse — the Cloudflare FREE plan gives a request 10 ms of CPU, and a 0.6–4 MB book or a 480 KB stage batch
 * would spend it all in JSON.parse. Every route costs one subrequest beyond the session lookup.
 *
 *   GET  /api/vt/book?from=YYYY-MM-DD        → vt_book(p_from)               the book, streamed (any from = whole book)
 *   POST /api/vt/book   {p_from, p_also}     → vt_book(p_from, p_also)       the station's merge read (≤ 64 KB body)
 *   POST /api/vt/upload/begin                → vt_upload_begin(…, p_user = the SESSION's username)
 *   POST /api/vt/upload/stage                → vt_upload_stage(…)            ≤ 512 KB per call, else 413
 *   POST /api/vt/upload/commit               → vt_upload_commit(…)           version_conflict → 409 (the station retries)
 *   POST /api/vt/upload/abandon              → vt_upload_abandon(…)
 *   GET  /api/vt/uploads?limit=n             → the newest n (≤ 100) receipts
 *   GET  /api/vt/roster?on=YYYY-MM-DD        → vt_roster_at(p_on)            the VT Agent List in force (migration-072)
 *
 * WHO: a full-scope staff session holding the Upload Station (rules.mjs canUpload) — the same grant as every other load
 * route. Portal roles never reach here (index.mjs PORTAL_ALLOWED is an allow-list and names no /api/vt route) and the
 * four writes are in GATED_WRITES (an outdated tab may not write). The receipts carry SELLER names (staff), never a
 * customer field — the browser dropped those before anything was sent (FR-007).
 * The portal half (Phase E: scoped digest slices, unmatched seller names stripped for non-staff) is added below.
 */
import { canUpload } from './rules.mjs';

export const VT_STAGE_MAX = 512 * 1024;
export const VT_BODY_MAX = 64 * 1024;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const STEPS = new Set(['begin', 'stage', 'commit', 'abandon']);
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
const NO_UPLOAD = () => json({ error: 'Not permitted — this needs Upload Station access.' }, 403);

/* what PostgREST answered for a failed function call → a status and a short reason the station can show */
function refusal(step, status, text) {
  const msg = (() => { try { return String(JSON.parse(text).message || ''); } catch (e) { return String(text || ''); } })();
  if (/version_conflict/.test(msg)) return json({ error: 'version_conflict' }, 409);
  if (/opening_book_before_first_day/.test(msg)) return json({ error: 'Load the opening book after the first day\'s two files (BI Active Fitted and Scheduled & Missed): it only dates cases already in the book.' }, 409);
  const code = (/^(stage_incomplete|not_staging|batch_too_large|unknown_upload|rows_not_array)/.exec(msg) || [])[1];
  if (code) return json({ error: code, detail: msg.slice(0, 200) }, 409);
  return json({ error: 'VT ' + step + ' failed: ' + status + ' ' + msg.slice(0, 160) }, 502);
}
async function rpcStream(env, fn, body, step) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST', body,
    headers: { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY, 'Content-Type': 'application/json' },
  });
  if (!r.ok) return refusal(step, r.status, await r.text());
  return new Response(r.body, { status: 200, headers: { 'Content-Type': 'application/json' } });   // CORS is added on the way out (index.mjs)
}
/* the declared length decides, before a byte is read; a body with no length is measured (it is small by then) */
async function cappedBody(req, max) {
  const n = Number(req.headers.get('content-length'));
  if (Number.isFinite(n) && n > 0) return n > max ? { status: 413 } : { body: req.body };
  if (req.headers.get('content-length') === '0') return { body: '{}' };
  const t = await req.text();
  return t.length > max ? { status: 413 } : { body: t || '{}' };
}
const tooBig = (max) => json({ error: 'Body too large: at most ' + Math.round(max / 1024) + ' KB per call.' }, 413);

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
    const b = await cappedBody(req, VT_BODY_MAX); if (b.status) return tooBig(VT_BODY_MAX);
    return rpcStream(env, 'vt_book', b.body, 'book');
  }
  if (step) {
    if (!STEPS.has(step)) return json({ error: 'unknown step' }, 404);
    if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
    if (step === 'begin') {   // small, and the ONE body read here: who uploaded is the session, never the client's say-so
      const b = await cappedBody(req, VT_BODY_MAX); if (b.status) return tooBig(VT_BODY_MAX);
      let a; try { a = JSON.parse(typeof b.body === 'string' ? b.body : await new Response(b.body).text()); } catch (e) { return json({ error: 'bad JSON' }, 400); }
      if (!a || typeof a !== 'object' || Array.isArray(a)) return json({ error: 'bad arguments' }, 400);
      return rpcStream(env, 'vt_upload_begin', JSON.stringify({ ...a, p_user: user.username }), 'begin');
    }
    const max = step === 'stage' ? VT_STAGE_MAX : VT_BODY_MAX;
    const b = await cappedBody(req, max); if (b.status) return tooBig(max);
    return rpcStream(env, 'vt_upload_' + step, b.body, step);
  }
  if (req.method !== 'GET') return json({ error: 'GET only' }, 405);
  if (path === '/api/vt/uploads') {
    const lim = Math.min(Math.max(Number(url.searchParams.get('limit')) || 20, 1), 100);
    const cols = 'id,sha256,kind,file_name,extract_on,cycle_key,state,counts,unmatched,warnings,quiet_day_ack,uploaded_by,started_at,committed_at,rev_after';
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/vt_uploads?select=${cols}&order=id.desc&limit=${lim}`, {
      headers: { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY } });
    const t = await r.text();
    if (!r.ok) return json({ error: 'VT receipts failed: ' + r.status + ' ' + t.slice(0, 160) }, 502);
    return new Response('{"uploads":' + (t || '[]') + '}', { status: 200, headers: { 'Content-Type': 'application/json' } });   // wrapped, not parsed
  }
  const on = url.searchParams.get('on');
  if (!on || !DAY.test(on)) return json({ error: 'on must be YYYY-MM-DD' }, 400);
  return rpcStream(env, 'vt_roster_at', JSON.stringify({ p_on: on }), 'roster');
}
/* ================= portal half (Phase E) below this line ================= */
