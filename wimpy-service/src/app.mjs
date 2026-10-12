/**
 * WIMPY ORDER — THE SERVICE (Spec Kit 018, 2026-10-09).
 *
 * Nick: "extract wimpy as a docker with the highlevel api keys and all its functionality because I want to remove it
 * from vas analytics and put that on vercel". This is the lunch app's API, lifted out of the Cloudflare Worker with its
 * modules unchanged (wimpy.mjs, wimpy-hl.mjs, db.mjs; the shared sign-in blocks of auth.mjs copied verbatim under a
 * drift guard). It speaks Web-standard Request/Response — the same shape the Worker spoke — so one `handle()` serves
 * both hosts: src/server.mjs (Node, the container) and api/index.mjs (Vercel). Nothing in here knows which host it is
 * on; the adapters pass `env` (the process environment) and `ctx.waitUntil` (work that may finish after the reply).
 *
 * ROUTES (specs/018-wimpy-standalone-service/contracts/service-api.md):
 *   GET  /api/health              no auth; booleans only, no network call
 *   POST /api/wimpy/signin        CB number (or username) + password → a wimpy-scoped session (auth.mjs signinWimpy)
 *   GET  /api/wimpy/me            the session's person (no token hash)
 *   POST /api/wimpy/logout        ends the session
 *   POST /api/wimpy/password      {current, new} → the person's own Wimpy password (starts as wimpy123; Spec Kit 025)
 *   GET  /api/wimpy/menu          wimpyMenu()
 *   POST /api/wimpy/order         submitWimpyOrder() — kitchen webhook, then the ledger + HighLevel card after the reply
 *   GET  /api/wimpy/orders        listMyOrders() — the session's own orders, nothing a request sends can widen it
 *   GET  /api/wimpy/cron/retry    Bearer CRON_SECRET → retryDueOrders() (Vercel Cron; the container uses its own timer)
 *
 * THE SESSION GATE: this service mints only `scope = 'wimpy'` sessions and ACCEPTS only those. A token from the suite's
 * main sign-in is useless here, and (since Spec Kit 018) a Wimpy token is useless on the suite's Worker. Two doors,
 * one password, one lock (auth.mjs checkPassword, shared).
 *
 * THE CLIENT ADDRESS (the per-network sign-in limit): clientIp() trusts a proxy's x-forwarded-for only when the
 * adapter says so (TRUST_PROXY — Vercel always; the container only when told). Otherwise the address is the one the Node
 * adapter writes into x-wimpy-socket-ip from the socket on EVERY request — a client cannot supply it.
 */
import fs from 'node:fs';
import { db } from './db.mjs';
import { session, signinWimpy, logout, changeWimpyPassword } from './auth.mjs';
import { wimpyMenu, submitWimpyOrder, WIMPY_HISTORY_SINCE } from './wimpy.mjs';
import { retryDueOrders, listMyOrders, dbWhy, hlConfigured } from './wimpy-hl.mjs';
import { SECURITY_HEADERS } from './headers.mjs';
import { clientIp, SOCKET_IP_HEADER } from './net.mjs';
export { clientIp, SOCKET_IP_HEADER };

export const VERSION = '018.1';
export const NOT_CONFIGURED = 'The Wimpy service is not configured (SUPABASE_URL / SUPABASE_SECRET_KEY).';
export const WIMPY_ONLY = 'This sign-in is for Wimpy orders only.';
const CRON_NOT_CONFIGURED = 'The retry is not configured (CRON_SECRET is not set).';
export const MAX_JSON_BYTES = 256 * 1024;

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...SECURITY_HEADERS, ...headers } });

/** The database settings, both present. One without the other is as good as none. */
export function dbConfigured(env) {
  return !!(env && env.SUPABASE_URL && env.SUPABASE_SECRET_KEY);
}

/* The cron bearer is compared in constant time — a secret is never compared with ===. */
function sameSecret(a, b) {
  const x = String(a || ''), y = String(b || '');
  if (x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return d === 0;
}

/**
 * One request in, one Response out. `env` = the process environment (names in data-model.md); `ctx.waitUntil(p)` keeps
 * `p` alive after the reply (the Worker's contract, kept so wimpy.mjs / wimpy-hl.mjs run unchanged).
 */
/* THE PAGE, served by the core itself (deploy 2026-10-09: Vercel routes EVERY request of this project through the one
   function, the static folder included, so the page must come from here). Read once per process; 40 KB. */
const PAGE_URL = new URL('../public/index.html', import.meta.url);
let pageBytes = null;
export function page() { if (!pageBytes) pageBytes = fs.readFileSync(PAGE_URL); return pageBytes; }

export async function handle(req, env, ctx) {
  const url = new URL(req.url);
  const path = url.pathname;
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: SECURITY_HEADERS });
  if ((req.method === 'GET' || req.method === 'HEAD') && (path === '/' || path === '/index.html'))
    return new Response(req.method === 'HEAD' ? null : page(), { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', ...SECURITY_HEADERS } });
  if (path === '/api/health') {
    return json({ ok: true, service: 'wimpy', version: VERSION, db_configured: dbConfigured(env), hl_configured: hlConfigured(env), cron_configured: !!(env && env.CRON_SECRET) });
  }
  if (!path.startsWith('/api/')) return json({ error: 'Not found.' }, 404);   // the page itself is the adapter's business
  if (!dbConfigured(env)) return json({ error: NOT_CONFIGURED }, 503);
  /* THE SAME LIMITS ON BOTH HOSTS (security review 018 L3/L6): a POST is JSON or nothing, and no body over 256 KB is read
     (the Node adapter caps the stream too; Vercel would otherwise read up to 4.5 MB). An order is a few hundred bytes. */
  if (req.method === 'POST' && !/^application\/json\b/i.test(req.headers.get('content-type') || '')) return json({ error: 'Send JSON (Content-Type: application/json).' }, 415);
  if (Number(req.headers.get('content-length')) > MAX_JSON_BYTES) return json({ error: 'That request is too large.' }, 413);
  const DB = db(env);
  try {
    if (path === '/api/wimpy/signin' && req.method === 'POST') {
      const r = await signinWimpy(DB, req, await req.json().catch(() => ({})), ctx, env);
      if (!r.ok) return json({ error: r.error }, r.status);
      return json({ user: r.user, token: r.token });
    }
    /* THE RETRY (Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` when the variable exists). Unset = the route
       is closed, never open; a wrong bearer gets the same 401 as none. */
    if (path === '/api/wimpy/cron/retry') {
      if (req.method !== 'GET' && req.method !== 'POST') return json({ error: 'Not found.' }, 404);
      if (!env.CRON_SECRET) return json({ error: CRON_NOT_CONFIGURED }, 503);
      const bearer = String(req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
      if (!bearer || !sameSecret(bearer, env.CRON_SECRET)) return json({ error: 'Not permitted.' }, 401);
      try {
        const w = await retryDueOrders(env, DB);
        console.info('[wimpy:cron] ' + JSON.stringify(w));
        return json({ ok: true, ...w });
      } catch (e) {
        console.warn('[wimpy:cron] failed: ' + dbWhy(env, e));   // redacted: a PostgREST error can quote a row
        return json({ ok: false, error: 'The retry failed — see the service log.' }, 500);
      }
    }

    /* SESSIONS TRAVEL AS A BEARER ONLY. The shared session() also reads a cbx_session cookie (the suite's); this service never
       sets one and never honours one, so a cookie can never ride a cross-site request here (security review 018 L3). */
    if (!/^Bearer\s+\S+/i.test(req.headers.get('authorization') || '')) return json({ error: 'Sign in required.' }, 401);
    const user = await session(DB, req);
    if (!user) return json({ error: 'Sign in required.' }, 401);
    if (user.scope !== 'wimpy') return json({ error: WIMPY_ONLY }, 403);

    if (path === '/api/wimpy/me' && req.method === 'GET') {
      const { token_hash, ...safe } = user;
      /* still on the start password? (Spec Kit 025) — the shared session() does not select the Wimpy hash, so one small read */
      const rows = await DB.select(`app_users?id=eq.${encodeURIComponent(user.user_id)}&select=wimpy_password_hash&limit=1`);
      return json({ user: { ...safe, wimpy_password_is_default: !(rows && rows[0] && rows[0].wimpy_password_hash) } });
    }
    if (path === '/api/wimpy/logout' && req.method === 'POST') { await logout(DB, user); return json({ ok: true }); }
    /* the Wimpy-only password (Spec Kit 025): current + new, for the session's account alone */
    if (path === '/api/wimpy/password' && req.method === 'POST') {
      const r = await changeWimpyPassword(DB, user, await req.json().catch(() => ({})), req, ctx, env);
      return json(r.body, r.status);
    }
    if (path === '/api/wimpy/menu' && req.method === 'GET') return json(wimpyMenu());
    if (path === '/api/wimpy/order' && req.method === 'POST') {
      const r = await submitWimpyOrder(env, user, await req.json().catch(() => ({})), Date.now(), ctx);
      return json(r.body, r.status);
    }
    if (path === '/api/wimpy/orders' && req.method === 'GET') {
      const r = await listMyOrders(env, DB, user, ctx, { since: WIMPY_HISTORY_SINCE });
      return json(r.body, r.status);
    }
    return json({ error: 'Not found.' }, 404);
  } catch (e) {
    console.error('[wimpy] ' + req.method + ' ' + path + ' failed: ' + dbWhy(env, e));
    return json({ error: 'Something went wrong on the server — try again in a minute.' }, 500);
  }
}

/* VERCEL'S ENTRYPOINT (deploy 2026-10-09). Vercel's zero-config build names this file the project's root entrypoint
   ("Using src/app.mjs as the root entrypoint") and requires its DEFAULT export to be a request handler — the api/ folder
   convention is not what it uses. The handler is the Vercel adapter (api/index.mjs: Vercel's env, waitUntil, a trusted
   proxy), loaded lazily so the container — which never calls this — needs no @vercel/functions. */
export const maxDuration = 30;
let vercelEntry = null;
export default async function (req, res) {
  if (!vercelEntry) vercelEntry = (await import('../api/index.mjs')).default;
  return vercelEntry(req, res);
}
