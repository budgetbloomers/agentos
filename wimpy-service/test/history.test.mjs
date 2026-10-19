#!/usr/bin/env node
/* history.test.mjs — WIMPY ORDER HISTORY: EACH PERSON SEES ONLY THEIR OWN ORDERS (Spec Kit 015, 2026-10-07; ported to the
 * Wimpy service, Spec Kit 018: the real service module in-process — app.mjs handle() in place of the Worker's fetch, the
 * retry through GET /api/wimpy/cron/retry in place of scheduled(); the health-alert checks stayed in the suite).
 *
 * Nick: "I gave you the private intergration key and location ID to shpw the users their order history, it must only
 * show their order history and no one elses".
 *
 * Drives the REAL Worker module in-process (worker/src/index.mjs) against stubs for everything it talks to — Supabase
 * PostgREST (app_sessions, wimpy_orders, wimpy_hl_contacts, rules), the Wimpy HighLevel sub-account (API v2) and the
 * n8n kitchen webhook — so nothing leaves this machine. Every value that looks like a credential is FAKE
 * ('pit-test-key' / 'loc-test'); the real key lives only in the git-ignored wimpy-highlevel.env and is never read here.
 *
 * Like the Cloudflare FREE plan, an invocation past 50 subrequests throws, and every invocation's count is measured
 * (ctx.waitUntil work included — it runs inside the same invocation's budget).
 *
 * Two people, "thandi" (CB901) and "sipho" (CB902), plus a manager with no CB ("mgr.lee").
 *
 *   node nicks_code/diagnostics/verify-wimpy-history.mjs
 *   WIMPY_HTML=site/wimpy/index.html node nicks_code/diagnostics/verify-wimpy-history.mjs   (the build copy)
 */
process.env.TZ = 'UTC';   // a Worker runs in UTC; this PC runs in SAST, which would hide a UTC/SAST slip

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SRC = (rel) => pathToFileURL(path.join(ROOT, 'src', rel)).href;
const WIMPY_PAGE = path.join(ROOT, 'public', 'index.html');
const CRON = 'cron-test-secret';   // fake, like every credential here

let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m + (d !== undefined ? ' — ' + d : '')); } };
const head = (t) => console.log('\n' + t);
const tryImport = async (rel) => { try { return await import(SRC(rel)); } catch (e) { return { __error: String((e && e.message) || e).slice(0, 200) }; } };

/* ── every log line the Worker writes is kept, so the suite can prove no secret or phone number reaches a log ── */
const LOGS = [];
for (const k of ['log', 'info', 'warn', 'error']) {
  const real = console[k].bind(console);
  console[k] = (...a) => { const line = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
    if (!/^ {2}(ok|FAIL) |^\n|^====/.test(line)) LOGS.push(line); real(...a); };
}

/* ── the clock: the Worker reads Date.now() / new Date(); the suite moves it on purpose ── */
const RealDate = Date;
let CLOCK = RealDate.parse('2026-10-08T05:00:00Z');            // Thursday 8 Oct 2026, 07:00 SAST — the window is open (07:00–09:00 since spec 020)
class FakeDate extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(CLOCK); }
  static now() { return CLOCK; }
}
const useFakeClock = () => { globalThis.Date = FakeDate; };
const useRealClock = () => { globalThis.Date = RealDate; };
useFakeClock();
const MIN = 60000;

const app = await import(SRC('app.mjs'));
const wimpy = await import(SRC('wimpy.mjs'));
const hl = await tryImport('wimpy-hl.mjs');

/* ── fake configuration only ── */
const KEY = 'pit-test-key', LOC = 'loc-test';
const N8N = 'https://n8n.test/webhook/wimpy';
const ENV = { SUPABASE_URL: 'http://stub.local', SUPABASE_SECRET_KEY: 'svc-test', WIMPY_HL_API_KEY: KEY, WIMPY_HL_LOCATION_ID: LOC, WIMPY_WEBHOOK_URL: N8N, CRON_SECRET: CRON };
const ENV_NOHL = { SUPABASE_URL: 'http://stub.local', SUPABASE_SECRET_KEY: 'svc-test', WIMPY_WEBHOOK_URL: N8N, CRON_SECRET: CRON };

/* ── the people ── */
const P = {
  thandi: { user_id: '11111111-1111-4111-8111-111111111111', username: 'cb901', cb: 'CB901', full_name: 'Thandi Mokoena', role: 'agent', apps: ['agent', 'wimpy'],
    first: 'Thandi', last: 'Mokoena', phone: '082 111 0901', phoneN: '0821110901' },
  sipho:  { user_id: '22222222-2222-4222-8222-222222222222', username: 'cb902', cb: 'CB902', full_name: 'Sipho Dlamini', role: 'agent', apps: ['agent', 'wimpy'],
    first: 'Sipho', last: 'Dlamini', phone: '083 222 0902', phoneN: '0832220902' },
  mgr:    { user_id: '33333333-3333-4333-8333-333333333333', username: 'mgr.lee', cb: null, full_name: 'Lee Manager', role: 'admin', apps: ['ops', 'vas', 'wimpy'],
    first: 'Lee', last: 'Manager', phone: '084 333 0903', phoneN: '0843330903' },
};
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const SESS = {};   // token hash → app_sessions row (with the embedded app_users)
const mkSession = (token, who, scope, expires = '2099-01-01T00:00:00Z') => {
  const u = P[who];
  SESS[sha(token)] = { user_id: u.user_id, expires_at: expires, scope,
    app_users: { username: u.username, full_name: u.full_name, role: u.role, apps: u.apps, tabs: null, pii_unmask: false, active: true,
      cb: u.cb, team: null, hub_ids: null, must_change_password: false, theme: null } };
};
mkSession('tok-thandi-w', 'thandi', 'wimpy'); mkSession('tok-thandi-f', 'thandi', 'full'); mkSession('tok-thandi-w2', 'thandi', 'wimpy');
mkSession('tok-sipho-w', 'sipho', 'wimpy'); mkSession('tok-sipho-f', 'sipho', 'full');
mkSession('tok-mgr-f', 'mgr', 'full'); mkSession('tok-mgr-w', 'mgr', 'wimpy');
mkSession('tok-ref', 'mgr', 'referrals');
mkSession('tok-expired', 'thandi', 'wimpy', '2020-01-01T00:00:00Z');

/* ════════════════════ the stubbed world ════════════════════ */
let sub = 0, subMax = 0, urls = [];
const DBT = { orders: [], links: [], rules: {} };
const HL = { contacts: [], notes: [], cards: [], calls: [], n: 0, searchExtra: [] };
const PATCHES = [];   // every wimpy_orders PATCH body, in order (review M2a)
const N8 = { bodies: [] };
const F = {};   // fault switches: n8nFail, ordersInsertFail, ordersPatchFail, hlDown, hlSlow, hl5xx:{path}, hlDup, hlEcho, searchDown, searchSlow, linkRace:{owner, contact}
const resetWorld = () => {
  DBT.orders = []; DBT.links = []; DBT.rules = {};
  HL.contacts = []; HL.notes = []; HL.cards = []; HL.calls = []; HL.n = 0; HL.searchExtra = []; HL.pipelineReads = 0; PATCHES.length = 0;
  N8.bodies = [];
  for (const k of Object.keys(F)) delete F[k];
  if (hl && typeof hl._resetHlCache === 'function') hl._resetHlCache();
};
const J = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
const uuid = () => crypto.randomUUID();
const tsCmp = (a, b) => { const x = Date.parse(a), y = Date.parse(b); return Number.isFinite(x) && Number.isFinite(y) ? x - y : String(a).localeCompare(String(b)); };
/* PostgREST horizontal filters: col=op.value (eq, neq, lt, lte, gt, gte, in, is) — every filter must match */
function pgFilter(rows, url) {
  let out = rows;
  for (const [col, raw] of url.searchParams.entries()) {
    if (['select', 'order', 'limit', 'offset'].includes(col)) continue;
    const i = raw.indexOf('.'); const op = raw.slice(0, i), v = raw.slice(i + 1);
    out = out.filter((r) => {
      const x = r[col];
      if (op === 'eq') return String(x) === v;
      if (op === 'neq') return String(x) !== v;
      if (op === 'in') return v.replace(/^\(|\)$/g, '').split(',').map((s) => s.replace(/^"|"$/g, '')).includes(String(x));
      if (op === 'is') return v === 'null' ? x == null : String(x) === v;
      if (op === 'lte') return x != null && tsCmp(x, v) <= 0;
      if (op === 'lt') return x != null && tsCmp(x, v) < 0;
      if (op === 'gte') return x != null && tsCmp(x, v) >= 0;
      if (op === 'gt') return x != null && tsCmp(x, v) > 0;
      return false;
    });
  }
  const ord = url.searchParams.get('order');
  if (ord) { const [c, dir] = ord.split('.'); out = out.slice().sort((a, b) => (dir === 'desc' ? -1 : 1) * tsCmp(a[c], b[c])); }
  const off = Number(url.searchParams.get('offset')) || 0, lim = Math.min(Number(url.searchParams.get('limit')) || 1000, 1000);
  return out.slice(off, off + lim);
}
const pick = (rows, url) => {
  const sel = url.searchParams.get('select');
  if (!sel || sel === '*') return rows.map((r) => ({ ...r }));
  const cols = sel.split(',');
  return rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c] === undefined ? null : r[c]])));
};
const ORDER_STATES = ['pending', 'written', 'failed', 'stuck'];
const nowIso = () => new RealDate(CLOCK).toISOString();

function stubPostgrest(url, method, o) {
  const p = url.pathname, prefer = String((o.headers && (o.headers.Prefer || o.headers.prefer)) || '');
  const body = o.body ? JSON.parse(o.body) : null;
  if (p === '/rest/v1/app_sessions') {
    const m = /^eq\.(.*)$/.exec(url.searchParams.get('token_hash') || '');
    const s = m && SESS[m[1]]; return J(s ? [s] : []);
  }
  if (p === '/rest/v1/wimpy_orders') {
    if (method === 'GET') {
      /* F.ordersIgnoreOwner: a broken database filter that answers EVERYONE's rows — the Worker must still show only the session's */
      if (F.ordersIgnoreOwner) { const u2 = new URL(url.href); u2.searchParams.delete('owner_user_id'); return J(pick(pgFilter(DBT.orders, u2), u2)); }
      /* F.ordersSelectFail: the ledger read fails with an error that quotes a secret and a phone number (review L5) */
      if (F.ordersSelectFail) return new Response('{"message":"stub: read refused for ' + KEY + ' / ' + P.thandi.phoneN + '"}', { status: 500 });
      return J(pick(pgFilter(DBT.orders, url), url));
    }
    if (method === 'POST') {
      if (F.ordersInsertFail) return new Response('{"message":"stub: insert refused"}', { status: 500 });
      /* F.ordersInsertHang: Supabase stalls this many ms before answering (review M1) */
      if (F.ordersInsertHang) { const ms = F.ordersInsertHang; delete F.ordersInsertHang; return new Promise((r) => setTimeout(r, ms)).then(() => stubPostgrest(url, method, o)); }
      const out = [];
      for (const r of (Array.isArray(body) ? body : [body])) {
        if (!r.owner_user_id || !r.cb || r.items == null || r.total == null) return new Response('{"code":"23502","message":"null value violates not-null constraint"}', { status: 400 });
        if (r.hl_state && !ORDER_STATES.includes(r.hl_state)) return new Response('{"code":"23514","message":"violates check constraint"}', { status: 400 });
        const row = { id: uuid(), placed_at: nowIso(), notes: null, hl_state: 'pending', hl_contact_id: null, hl_opportunity_id: null,
          hl_tries: 0, hl_error: null, hl_next_at: nowIso(), hl_contact_seed: null, ...r };
        DBT.orders.push(row); out.push({ ...row });
      }
      return /return=representation/.test(prefer) ? J(out, 201) : new Response('', { status: 201 });
    }
    if (method === 'PATCH') {
      PATCHES.push(body);
      /* F.ordersPatchFail: true = every PATCH fails; a function = only the bodies it picks (review M2/L1) */
      if (F.ordersPatchFail && (typeof F.ordersPatchFail !== 'function' || F.ordersPatchFail(body))) return new Response('{"message":"stub: patch refused"}', { status: 500 });
      if (body.hl_state && !ORDER_STATES.includes(body.hl_state)) return new Response('{"code":"23514","message":"violates check constraint"}', { status: 400 });
      const hit = pgFilter(DBT.orders, new URL(url.href.replace(/([?&])(limit|order)=[^&]*/g, '$1')));
      for (const r of hit) Object.assign(r, body);
      return /return=representation/.test(prefer) ? J(hit.map((r) => ({ ...r }))) : new Response(null, { status: 204 });
    }
  }
  if (p === '/rest/v1/wimpy_hl_contacts') {
    if (method === 'GET') return J(pick(pgFilter(DBT.links, url), url));
    if (method === 'POST') {
      for (const r of (Array.isArray(body) ? body : [body])) {
        const race = F.linkRace instanceof Map ? F.linkRace.get(r.owner_user_id) : null;
        if (race && !DBT.links.some((l) => l.owner_user_id === r.owner_user_id))
          DBT.links.push({ owner_user_id: r.owner_user_id, cb: r.cb, contact_id: race, created_at: nowIso() });   // another request got there first
        if (DBT.links.some((l) => l.owner_user_id === r.owner_user_id || l.contact_id === r.contact_id))
          return new Response('{"code":"23505","message":"duplicate key value violates unique constraint"}', { status: 409 });
        DBT.links.push({ created_at: nowIso(), ...r });
      }
      return new Response('', { status: 201 });
    }
  }
  if (p === '/rest/v1/rules') {
    const k = url.searchParams.get('key') || '';
    if (method === 'GET') {
      let keys = [];
      if (k.startsWith('eq.')) keys = [k.slice(3)];
      else if (k.startsWith('in.(')) keys = k.slice(4, -1).split(',');
      else if (k.startsWith('like.')) { const pre = k.slice(5).replace(/[%*]$/, ''); keys = Object.keys(DBT.rules).filter((x) => x.startsWith(pre)); }
      return J(keys.filter((x) => DBT.rules[x]).map((x) => ({ key: x, value: DBT.rules[x].value, updated_at: DBT.rules[x].updated_at })));
    }
    if (method === 'POST') { for (const r of (Array.isArray(body) ? body : [body])) DBT.rules[r.key] = { value: r.value, updated_at: r.updated_at || nowIso() }; return new Response('', { status: 201 }); }
    return J([]);
  }
  return J([]);   // every other table: empty (the tick and health read many; none matters here)
}

const hang = (o) => new Promise((_, rej) => {
  const sig = o && o.signal; if (!sig) return;
  if (sig.aborted) return rej(new DOMException('aborted', 'AbortError'));
  sig.addEventListener('abort', () => rej(new DOMException('The operation was aborted.', 'AbortError')));
});
function stubHighLevel(url, method, o) {
  const p = url.pathname, h = o.headers || {};
  const body = o.body ? JSON.parse(o.body) : null;
  HL.calls.push({ method, path: p, query: Object.fromEntries(url.searchParams.entries()), auth: h.Authorization || h.authorization || '', version: h.Version || h.version || '', body });
  if (F.hlDown) return Promise.reject(new TypeError('fetch failed'));
  if (F.hlSlow) return hang(o);
  if ((h.Authorization || h.authorization) !== 'Bearer ' + KEY) return J({ statusCode: 401, message: 'Invalid JWT' }, 401);
  if (F.hlEcho) return J({ statusCode: 401, message: 'The token ' + KEY + ' is not authorized for location ' + LOC + ' (contact phone ' + P.thandi.phoneN + ')' }, 401);
  if (F.hl5xx && p.startsWith(F.hl5xx)) return J({ statusCode: 500, message: 'Internal server error' }, 500);
  /* F.hlEchoName: a validation error that quotes the typed name back (review L4) */
  if (F.hlEchoName && p === '/contacts/') return J({ statusCode: 422, message: ['firstName ' + P.thandi.first + ' is not valid', 'lastName ' + P.thandi.last + ' is not valid'] }, 422);
  if (p === '/contacts/' && method === 'POST') {
    const id = 'hc-' + (++HL.n); HL.contacts.push({ id, ...body }); return J({ contact: { id, ...body } }, 201);
  }
  let m = /^\/contacts\/([^/]+)\/notes$/.exec(p);
  if (m && method === 'POST') { HL.notes.push({ contactId: m[1], body: body && body.body }); return J({ note: { id: 'nt-' + (++HL.n) } }, 201); }
  if (p === '/opportunities/pipelines' && method === 'GET') {
    if (url.searchParams.get('locationId') !== LOC) return J({ statusCode: 403, message: 'wrong location' }, 403);
    if (F.noPipeline) return J({ pipelines: [{ id: 'pl-other', name: 'Something Else', stages: [{ id: 'st-x', name: 'New Order' }] }] });
    HL.pipelineReads = (HL.pipelineReads || 0) + 1;
    return J({ pipelines: [
      { id: 'pl-other', name: 'Something Else', stages: [{ id: 'st-x', name: 'New Order' }] },
      { id: 'pl-wimpy', name: 'Wimpy Pipeline', stages: [{ id: 'st-new', name: 'New Order' }, { id: 'st-proc', name: 'Order Processing' },
        { id: 'st-ready', name: 'Ready for Collection' }, { id: 'st-done', name: 'Completed' }].concat(F.extraStage ? [F.extraStage] : []) }] });
  }
  if (p === '/opportunities/' && method === 'POST') {
    if (F.hlDup) return J({ statusCode: 400, message: 'Can not create duplicate opportunity for the contact.' }, 400);
    const id = 'op-' + (++HL.n);
    const card = { id, ...body }; HL.cards.push(card);
    /* F.cardTimeout: HighLevel MAKES the card, then never answers — the 8 s abort fires after it was processed (review M2) */
    if (F.cardTimeout) return hang(o);
    return J({ opportunity: card }, 201);
  }
  if (p === '/opportunities/search' && method === 'GET') {
    if (F.searchDown) return J({ statusCode: 503, message: 'unavailable' }, 503);
    if (F.searchSlow) return hang(o);
    const q = url.searchParams;
    const mine = HL.cards.filter((c) => c.contactId === q.get('contact_id') && c.pipelineId === q.get('pipeline_id'))
      .map((c, i) => (i % 2 ? { id: c.id, name: c.name, contact: { id: c.contactId, name: 'x' }, pipelineId: c.pipelineId, pipelineStageId: c.pipelineStageId, status: c.status }
        : { id: c.id, name: c.name, contactId: c.contactId, pipelineId: c.pipelineId, pipelineStageId: c.pipelineStageId, status: c.status }));
    /* like the real search: at most `limit` cards, injected ones first (review L2 needs a full page without hers) */
    const all = HL.searchExtra.concat(mine);
    return J({ opportunities: all.slice(0, Math.min(Number(q.get('limit')) || 100, 100)), meta: { total: all.length } });
  }
  return J({ statusCode: 404, message: 'not stubbed: ' + method + ' ' + p }, 404);
}

globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
globalThis.fetch = async (u, o = {}) => {
  ++sub;   // counted, not capped: the Worker's 50-call limit does not exist here; the budgets below are regression bounds
  subMax = Math.max(subMax, sub);
  const raw = String(u), method = String(o.method || 'GET').toUpperCase();
  urls.push(method + ' ' + raw);
  if (raw === N8N) {
    N8.bodies.push(o.body);
    return F.n8nFail ? new Response('kitchen down', { status: 500 }) : new Response('{"ok":true}', { status: 200 });
  }
  const url = new URL(raw);
  if (url.host === 'stub.local') return stubPostgrest(url, method, o);
  if (url.host === 'services.leadconnectorhq.com') return stubHighLevel(url, method, o);
  if (/convex\.cloud$/.test(url.host)) return J({ status: 'error', errorMessage: 'stub: no hub here' });
  return new Response('', { status: 404 });   // nothing ever reaches the network
};

const pending = [];
const ctx = { waitUntil: (p) => { pending.push(Promise.resolve(p).catch(() => {})); } };
const settle = async () => { while (pending.length) await Promise.all(pending.splice(0)); };
async function call(method, pathq, { token, body, env = ENV, headers = {} } = {}) {
  sub = 0; subMax = 0; urls = [];
  const h = { ...headers };
  if (token) h.Authorization = 'Bearer ' + token;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const req = new Request('https://api.local' + pathq, { method, headers: h, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
  const r = await app.handle(req, env, ctx);
  await settle();
  const t = await r.clone().text(); let j = null; try { j = JSON.parse(t); } catch (e) { j = null; }
  return { status: r.status, j, t, subs: subMax, urls: urls.slice() };
}
/* THE RETRY, as Vercel Cron calls it: GET /api/wimpy/cron/retry with the CRON_SECRET bearer (the container's timer calls
   retryDueOrders directly — the same function). The first argument is kept so the ported calls read unchanged. */
async function cron(_expr, env = ENV) {
  const r = await call('GET', '/api/wimpy/cron/retry', { env, headers: { Authorization: 'Bearer ' + CRON } });
  return { subs: r.subs, urls: r.urls, status: r.status, j: r.j, t: r.t };
}
const orderBody = (who, items = [{ id: 'cheese_burger', quantity: 2 }], notes = '', over = {}) => {
  const b = { who: { cb: P[who].cb || P[who].username, first_name: P[who].first, surname: P[who].last, phone: P[who].phone, ...over },
    total_price: 0, order: { items, additional_notes: notes } };
  b.total_price = wimpy.priceOrder(b, CLOCK).total;   // the page's own (right) figure — no price_mismatch
  return b;
};
const rowsOf = (who) => DBT.orders.filter((r) => r.owner_user_id === P[who].user_id);
const sastStamp = (ms) => new RealDate(ms + 2 * 3600000).toISOString().slice(0, 19) + '+02:00';
/* THE KITCHEN HAND-OFF, BYTE FOR BYTE: the n8n body this release must still send — built here from the documented shape
   (wimpy.mjs submitWimpyOrder before spec 015) and the module's own priceOrder/formatOrder */
function expectedN8n(who, body) {
  const u = P[who], priced = wimpy.priceOrder(body, CLOCK);
  const cb = u.cb ? u.cb.toUpperCase() : u.username.toLowerCase();
  const agentName = body.who.first_name + ' ' + body.who.surname, phone = wimpy.normPhone(body.who.phone);
  const notes = String(body.order.additional_notes || '').trim().slice(0, 1000);
  const p = { cb_number: cb, agent_name: agentName, first_name: body.who.first_name, surname: body.who.surname, phone_number: phone,
    list_name: u.full_name, timestamp: sastStamp(CLOCK), total_price: priced.total,
    order_formatted: wimpy.formatOrder({ agentName, cb, listName: u.full_name, phone, items: priced.items, total: priced.total, notes }),
    order: { items: priced.items, additional_notes: notes } };
  if (Math.round(Number(body.total_price) * 100) !== priced.totalCents) p.price_mismatch = { client_total: Number(body.total_price), server_total: priced.total };
  return JSON.stringify(p);
}
const SECRETS_AND_PHONES = [KEY, LOC, ...Object.values(P).flatMap((u) => [u.phone, u.phoneN])];
const placeOrder = (token, who, items, notes, env) => call('POST', '/api/wimpy/order', { token, body: orderBody(who, items, notes), env });
const myOrders = (token, q = '', opts = {}) => {
  if (!opts.keepThrottle && hl && typeof hl._resetStageCache === 'function') hl._resetStageCache();   // a fresh HighLevel read unless the test is about the throttle
  const { keepThrottle, ...rest } = opts;
  return call('GET', '/api/wimpy/orders' + q, { token, ...rest });
};

/* ════════════════════ T001 · the harness reaches the real Worker ════════════════════ */
head('T001 · the harness: the real service, stubbed Supabase / HighLevel / n8n, two people');
{
  resetWorld();
  const m = await call('GET', '/api/wimpy/menu', { token: 'tok-thandi-w' });
  ok(m.status === 200 && m.j && Array.isArray(m.j.items), 'a wimpy-scoped session reads the menu through the harness (sessions stub works)', m.status + ' ' + m.t.slice(0, 80));
  const none = await call('GET', '/api/wimpy/menu');
  ok(none.status === 401, 'no session → 401 through the harness', String(none.status));
  const h = await myOrders('tok-thandi-w');
  ok(h.status === 200 && h.j && Array.isArray(h.j.orders), 'GET /api/wimpy/orders answers a signed-in person with an orders list', h.status + ' ' + h.t.slice(0, 120));
}

/* ════════════════════ T002 · migration-055 (written, NOT applied) ════════════════════ */
head('T002 · supabase/migration-055-wimpy-order-history.sql — the ledger and the contact link, locked down');
{
  /* the migration is the suite's (applied 7 Oct 2026); it sits beside this folder in the monorepo and is checked when it is there */
  const f = path.join(ROOT, '..', 'supabase', 'migration-055-wimpy-order-history.sql');
  const raw = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
  if (!raw) console.log('  SKIP  the suite\'s supabase/migration-055 is not beside this checkout — its shape is proved there');
  else {
  const sql = raw.replace(/--.*$/gm, '').replace(/\s+/g, ' ').toLowerCase();
  ok(raw.length > 0, 'migration-055 exists');
  const tbl = (name) => { const m = new RegExp('create table if not exists ' + name + ' \\((.*?)\\);').exec(sql); return m ? m[1] : ''; };
  const o = tbl('wimpy_orders'), c = tbl('wimpy_hl_contacts');
  ok(/owner_user_id uuid not null references app_users\s*\(id\) on delete cascade/.test(o), 'wimpy_orders.owner_user_id → app_users(id) on delete cascade, not null (the ONLY key history reads by)');
  for (const [col, re] of [['id', /\bid uuid primary key default gen_random_uuid\(\)/], ['cb', /\bcb text not null/], ['placed_at', /placed_at timestamptz not null default now\(\)/],
    ['items', /items jsonb not null/], ['total', /total numeric\(10,\s?2\) not null/], ['notes', /notes text/],
    ['hl_state', /hl_state text not null default 'pending' check \(hl_state in \('pending',\s?'written',\s?'failed',\s?'stuck'\)\)/],
    ['hl_contact_id', /hl_contact_id text/], ['hl_opportunity_id', /hl_opportunity_id text/], ['hl_tries', /hl_tries int(eger)? not null default 0/],
    ['hl_error', /hl_error text/], ['hl_next_at', /hl_next_at timestamptz (not null )?default now\(\)/], ['hl_contact_seed', /hl_contact_seed jsonb/]])
    ok(re.test(o), 'wimpy_orders.' + col + ' as data-model.md says');
  ok(/char_length\(hl_error\) <= 300/.test(o), 'hl_error is held to 300 characters by the table itself');
  ok(/create index if not exists \w+ on wimpy_orders \(owner_user_id, placed_at desc\)/.test(sql), 'index (owner_user_id, placed_at desc) — "my newest 50" is one index read');
  ok(/create index if not exists \w+ on wimpy_orders \(hl_next_at\) where hl_state in \('pending',\s?'failed'\)/.test(sql), 'partial index on hl_next_at for the retry cron');
  ok(/owner_user_id uuid primary key references app_users\s*\(id\) on delete cascade/.test(c), 'wimpy_hl_contacts: one row per person (owner_user_id pk → app_users on delete cascade)');
  ok(/contact_id text not null unique/.test(c) && /\bcb text not null/.test(c), '…contact_id not null unique (one contact is never linked to two people), cb not null');
  for (const t of ['wimpy_orders', 'wimpy_hl_contacts']) {
    ok(new RegExp('alter table ' + t + ' enable row level security').test(sql), t + ': row level security ON');
    ok(new RegExp('revoke all on (table )?' + t + ' from public, anon, authenticated').test(sql), t + ': revoke all from public, anon, authenticated');
    ok(new RegExp('grant select, insert, update, delete on (table )?' + t + ' to service_role').test(sql), t + ': select/insert/update/delete granted to service_role only');
  }
  ok(!/create policy/.test(sql), 'no RLS policy at all — the Worker (service_role) is the only reader');
  ok(!/create (or replace )?function/.test(sql), 'no functions (nothing for anon to EXECUTE)');
  ok(/not applied/i.test(raw) || /apply only/i.test(raw), 'the header says it is applied only at release, with Nick\'s go-ahead');
  }
}

/* ════════════════════ T003 · worker/src/wimpy-hl.mjs — the HighLevel client ════════════════════ */
head('T003 · the HighLevel client: Bearer + Version, a timeout on every call, errors redacted, the pipeline found by NAME');
{
  ok(!hl.__error, 'worker/src/wimpy-hl.mjs imports', hl.__error);
  const fn = (n) => typeof hl[n] === 'function';
  const CLIENT = ['hlConfigured', 'hlRequest', 'resolvePipeline', 'redact', '_resetHlCache'];
  ok(CLIENT.every(fn), 'it exports the client: ' + CLIENT.join(', '), CLIENT.filter((n) => !fn(n)).join(', '));
  ok(hl.HL_BASE === 'https://services.leadconnectorhq.com' && hl.HL_VERSION === '2021-07-28' && hl.HL_TIMEOUT_MS === 8000,
    'base services.leadconnectorhq.com, Version 2021-07-28, 8 s per call', JSON.stringify([hl.HL_BASE, hl.HL_VERSION, hl.HL_TIMEOUT_MS]));
  ok(hl.PIPELINE_NAME === 'Wimpy Pipeline' && hl.STAGE_NEW === 'New Order', 'the pipeline and stage are NAMES ("Wimpy Pipeline" / "New Order") — no ids in the code');
  if (fn('hlConfigured')) {
    ok(hl.hlConfigured(ENV) === true && hl.hlConfigured(ENV_NOHL) === false && hl.hlConfigured({ WIMPY_HL_API_KEY: KEY }) === false && hl.hlConfigured({ WIMPY_HL_LOCATION_ID: LOC }) === false,
      'configured only when BOTH WIMPY_HL_API_KEY and WIMPY_HL_LOCATION_ID are set');
  }
  if (fn('hlRequest')) {
    resetWorld(); sub = 0;
    const r = await hl.hlRequest(ENV, 'GET', '/opportunities/pipelines', { query: { locationId: LOC } });
    const c = HL.calls[0] || {};
    ok(r && r.ok === true && r.status === 200 && r.json && Array.isArray(r.json.pipelines), 'a GET answers {ok, status, json}', JSON.stringify(r).slice(0, 120));
    ok(c.auth === 'Bearer ' + KEY && c.version === '2021-07-28', '…sent with Authorization: Bearer <key> and Version: 2021-07-28', JSON.stringify({ auth: c.auth ? 'Bearer …' : '', v: c.version }));
    resetWorld();
    const n = await hl.hlRequest(ENV_NOHL, 'GET', '/opportunities/pipelines', { query: { locationId: LOC } });
    ok(n && n.ok === false && /not configured/i.test(n.error || '') && HL.calls.length === 0, 'with no key/location it refuses WITHOUT calling HighLevel ("not configured")', JSON.stringify(n));
    resetWorld(); F.hlEcho = true;
    const e = await hl.hlRequest(ENV, 'POST', '/contacts/', { body: { locationId: LOC } });
    ok(e && e.ok === false && e.status === 401, 'a refusal is an answer, never a throw (401)', JSON.stringify(e).slice(0, 160));
    ok(e && typeof e.error === 'string' && !e.error.includes(KEY) && !e.error.includes(LOC) && !e.error.includes(P.thandi.phoneN) && e.error.length <= 300,
      '…and its error is redacted: no key, no location id, no phone number, ≤ 300 characters', e && e.error);
    resetWorld(); F.hlDown = true;
    const d = await hl.hlRequest(ENV, 'GET', '/opportunities/pipelines', { query: { locationId: LOC } });
    ok(d && d.ok === false && d.status === 0 && d.error, 'HighLevel unreachable → {ok:false, status:0, error}', JSON.stringify(d));
    resetWorld(); F.hlSlow = true;
    const t0 = RealDate.now();
    const s = await hl.hlRequest(ENV, 'GET', '/opportunities/pipelines', { query: { locationId: LOC } });
    const took = RealDate.now() - t0;
    ok(s && s.ok === false && /8 seconds/.test(s.error || '') && took >= 7500 && took < 10000, 'a call that hangs is abandoned at 8 s and says so (' + took + ' ms)', JSON.stringify(s));
  }
  if (fn('redact')) {
    const red = hl.redact(ENV, 'Bearer ' + KEY + ' at ' + LOC + ' for 0821110901 / +27 82 111 0901 ' + 'x'.repeat(400));
    ok(!red.includes(KEY) && !red.includes(LOC) && !/0821110901|82 111 0901/.test(red) && red.length <= 300, 'redact() strips the key, the location id and phone numbers and caps at 300', red.slice(0, 120));
  }
  if (fn('resolvePipeline')) {
    resetWorld(); sub = 0;
    const p1 = await hl.resolvePipeline(ENV);
    ok(p1 && p1.ok && p1.pipelineId === 'pl-wimpy' && p1.newStageId === 'st-new', '"Wimpy Pipeline" / "New Order" resolved by name — never another pipeline\'s "New Order"', JSON.stringify(p1));
    ok(p1 && p1.stages && p1.stages['st-ready'] === 'Ready for Collection' && p1.stages['st-done'] === 'Completed', '…with every stage id → name, for the history', JSON.stringify(p1 && p1.stages));
    ok((HL.calls[0] || {}).query && HL.calls[0].query.locationId === LOC, '…asked of the configured location');
    const before = HL.calls.length;
    const p2 = await hl.resolvePipeline(ENV);
    ok(p2 && p2.ok && p2.pipelineId === 'pl-wimpy' && HL.calls.length === before, 'a second ask is answered from the isolate cache (no call)', HL.calls.length + ' calls');
    const p3 = await hl.resolvePipeline(ENV, { force: true });
    ok(p3 && p3.ok && HL.calls.length === before + 1, '…and force: true re-reads it (a stage the cache does not know)', HL.calls.length + ' calls');
    resetWorld(); F.noPipeline = true;
    const p4 = await hl.resolvePipeline(ENV);
    ok(p4 && p4.ok === false && /Wimpy Pipeline/.test(p4.error || ''), 'no pipeline of that name → an error naming it, never a guess', JSON.stringify(p4));
  }
}

/* ════════════════════ T004 · the retry route ════════════════════ */
head('T004 · GET /api/wimpy/cron/retry: closed without CRON_SECRET, 401 on any other bearer, the retry with the right one');
{
  resetWorld();
  const none = await call('GET', '/api/wimpy/cron/retry', { env: { ...ENV, CRON_SECRET: '' } });
  ok(none.status === 503 && /CRON_SECRET/.test(none.t), 'no CRON_SECRET on the host → 503, the route is closed (never open)', none.status + ' ' + none.t.slice(0, 100));
  const wrong = await call('GET', '/api/wimpy/cron/retry', { headers: { Authorization: 'Bearer not-it' } });
  const bare = await call('GET', '/api/wimpy/cron/retry');
  const sess = await call('GET', '/api/wimpy/cron/retry', { token: 'tok-mgr-w' });
  ok(wrong.status === 401 && bare.status === 401 && sess.status === 401, 'a wrong bearer, no bearer, or a person\'s session token → 401', [wrong.status, bare.status, sess.status].join(' '));
  ok(![...wrong.urls, ...bare.urls, ...sess.urls].some((u) => /wimpy_orders|leadconnector/.test(u)), '…and nothing was read, written or sent to HighLevel');
  const right = await cron();
  ok(right.status === 200 && right.j && right.j.ok === true && right.j.counts && 'due' in right.j, 'the right bearer runs retryDueOrders and answers its summary', right.status + ' ' + JSON.stringify(right.j));
  ok(!!DBT.rules['kv:wimpy-hl-status'], '…which writes kv:wimpy-hl-status (the suite\'s health check reads it)');
  const vj = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  /* once a day at 05:07 SAST: the Hobby plan refuses anything more often (deploy 2026-10-09); the :07/:27/:47 cadence needs Pro.
     A person's own late cards catch up whenever they open My orders regardless (listMyOrders, spec 015). */
  ok(Array.isArray(vj.crons) && vj.crons.length === 1 && vj.crons[0].path === '/api/wimpy/cron/retry' && /^\d+ \d+ \* \* \*$/.test(vj.crons[0].schedule), 'vercel.json schedules exactly that route, once a day (the Hobby plan\'s limit)', JSON.stringify(vj.crons));
}

/* ════════════════════ T005 · every order reaches the kitchen board — and ordering never breaks because of it ════════════════════ */
head('T005 · POST /api/wimpy/order: the kitchen hand-off unchanged, then a ledger row and a card at "New Order"');
const BUDGET_ORDER = 11, BUDGET_HISTORY = 21, BUDGET_CRON = 42;
const measured = { order: [], history: [], cron: [] };
{
  CLOCK = RealDate.parse('2026-10-08T05:00:00Z');   // Thursday 07:00 SAST
  resetWorld();
  const items = [{ id: 'cheese_burger', quantity: 2 }, { id: 'toasted_chicken_mayo', quantity: 1 }];
  const body = orderBody('thandi', items, 'no onions please');
  const r = await call('POST', '/api/wimpy/order', { token: 'tok-thandi-w', body });
  measured.order.push(r.subs);
  ok(r.status === 200 && r.j && r.j.ok === true && r.j.total_price === 201.7, 'the order is accepted (200, the server total R201.70)', r.status + ' ' + r.t.slice(0, 120));
  ok(r.j && JSON.stringify(Object.keys(r.j).sort()) === '["ok","order_formatted","timestamp","total_price"]', 'the reply to the page is the same four fields as before — nothing added', r.j && Object.keys(r.j).join(','));
  ok(N8.bodies.length === 1 && N8.bodies[0] === expectedN8n('thandi', body), 'the n8n kitchen body is byte-for-byte what it was before this feature', N8.bodies[0] && N8.bodies[0].slice(0, 160));
  ok(r.urls[1] === 'POST ' + N8N, 'the kitchen is called FIRST — straight after the session check, before any ledger or HighLevel call', r.urls.slice(0, 3).join(' | '));
  const rows = rowsOf('thandi');
  ok(rows.length === 1, 'one ledger row', String(rows.length));
  const row = rows[0] || {};
  ok(row.owner_user_id === P.thandi.user_id && row.cb === 'CB901', '…owned by the SESSION\'s account (user_id), under CB901', JSON.stringify({ o: row.owner_user_id, cb: row.cb }));
  ok(Number(row.total) === 201.7 && row.notes === 'no onions please', '…with the server total and her notes', JSON.stringify({ t: row.total, n: row.notes }));
  ok(Array.isArray(row.items) && row.items.length === 2 && row.items.every((i) => JSON.stringify(Object.keys(i).sort()) === '["id","item","item_total","quantity"]')
    && row.items[0].item === 'Cheese Burger' && row.items[0].quantity === 2 && row.items[0].item_total === 147.8, '…and the items as {id, item, quantity, item_total}', JSON.stringify(row.items));
  ok(HL.contacts.length === 1, 'her HighLevel contact is created once', String(HL.contacts.length));
  const ct = HL.contacts[0] || {};
  ok(ct.locationId === LOC && ct.firstName === 'Thandi' && ct.lastName === 'Mokoena' && ct.phone === '0821110901'
    && JSON.stringify(ct.tags) === '["wimpy","cb901"]' && ct.source === 'Wimpy app', '…{locationId, firstName, lastName, phone (normalised), tags:[wimpy, cb901] (R10/L6), source:"Wimpy app"}', JSON.stringify({ ...ct, locationId: ct.locationId === LOC ? 'LOC' : ct.locationId }));
  ok(HL.notes.length === 1 && HL.notes[0].contactId === ct.id && /CB901/.test(HL.notes[0].body) && /CHEESE BURGER/.test(HL.notes[0].body) && /R201\.70/.test(HL.notes[0].body),
    'a note on her contact carries the order (CB, items, total)', String(JSON.stringify(HL.notes[0] && HL.notes[0].body)).slice(0, 160));
  const card = HL.cards[0] || {};
  ok(HL.cards.length === 1 && card.pipelineId === 'pl-wimpy' && card.pipelineStageId === 'st-new' && card.status === 'open' && card.contactId === ct.id
    && card.monetaryValue === 201.7 && card.locationId === LOC && /CB901/.test(card.name || ''), 'ONE card in "Wimpy Pipeline" at "New Order", open, on her contact, worth the total', JSON.stringify({ ...card, locationId: '…' }));
  ok(row.hl_state === 'written' && row.hl_opportunity_id === card.id && row.hl_contact_id === ct.id && !row.hl_error, 'the row is marked written with its card and contact', JSON.stringify({ s: row.hl_state, o: row.hl_opportunity_id, c: row.hl_contact_id, e: row.hl_error }));
  ok(row.hl_state === 'written' && row.hl_contact_seed == null, '…and the typed name/phone seed is cleared once the card exists', JSON.stringify(row.hl_contact_seed));
  ok(DBT.links.length === 1 && DBT.links[0].owner_user_id === P.thandi.user_id && DBT.links[0].contact_id === ct.id && DBT.links[0].cb === 'CB901', 'her contact is linked to HER account once', JSON.stringify(DBT.links));
  ok(r.subs <= BUDGET_ORDER, 'subrequests for the whole invocation (waitUntil included): ' + r.subs + ' ≤ ' + BUDGET_ORDER, String(r.subs));
  ok(!/hc-|op-|pl-wimpy|st-new/.test(r.t), 'the reply carries no HighLevel id', r.t.slice(0, 160));

  CLOCK += 30 * MIN;
  const full = await call('POST', '/api/wimpy/order', { token: 'tok-thandi-f', body: orderBody('thandi', [{ id: 'mzansi_brekkie', quantity: 1 }]) });
  ok(full.status === 403 && rowsOf('thandi').length === 1 && N8.bodies.length === 1, 'a FULL-scope session (the suite\'s sign-in) is refused here — the service accepts only the sessions it mints (FR-003)', full.status + ' ' + full.t.slice(0, 80));
  const r2 = await call('POST', '/api/wimpy/order', { token: 'tok-thandi-w', body: orderBody('thandi', [{ id: 'mzansi_brekkie', quantity: 1 }]) });
  measured.order.push(r2.subs);
  ok(r2.status === 200 && rowsOf('thandi').length === 2, 'her second order is accepted and recorded', r2.status + ' ' + rowsOf('thandi').length);
  ok(HL.contacts.length === 1 && HL.cards.length === 2 && HL.cards[1].contactId === ct.id, '…reusing her contact — no duplicate person — with a card of its own', JSON.stringify({ contacts: HL.contacts.length, cards: HL.cards.map((c) => c.contactId) }));
  ok(rowsOf('thandi').every((x) => x.hl_state === 'written') && new Set(rowsOf('thandi').map((x) => x.hl_opportunity_id)).size === 2, '…both rows written, each with its own card');
  ok(r2.subs <= BUDGET_ORDER, '…' + r2.subs + ' subrequests', String(r2.subs));

  const r3 = await call('POST', '/api/wimpy/order', { token: 'tok-sipho-w', body: orderBody('sipho', [{ id: 'big_cheese_burger', quantity: 1 }]) });
  measured.order.push(r3.subs);
  const sct = HL.contacts.find((c) => c.firstName === 'Sipho');
  ok(r3.status === 200 && rowsOf('sipho').length === 1 && sct && sct.id !== ct.id, 'sipho\'s order gets HIS OWN contact', JSON.stringify(HL.contacts.map((c) => c.id + ':' + c.firstName)));
  ok(rowsOf('sipho')[0] && rowsOf('sipho')[0].hl_contact_id === sct.id && HL.cards.filter((c) => c.contactId === sct.id).length === 1, '…and his card hangs on his contact, not hers');

  const r4 = await call('POST', '/api/wimpy/order', { token: 'tok-mgr-w', body: orderBody('mgr', [{ id: 'cheese_burger', quantity: 1 }]) });
  ok(r4.status === 200 && rowsOf('mgr').length === 1 && rowsOf('mgr')[0].cb === 'mgr.lee', 'a manager with no CB orders under their username — the row is keyed to their account', r4.status + ' ' + JSON.stringify(rowsOf('mgr').map((x) => x.cb)));
}
head('T005 · when HighLevel fails, the order still goes through — the row says why');
{
  const fresh = (f) => { resetWorld(); Object.assign(F, f); };
  const shapeOk = (r) => r.status === 200 && r.j && r.j.ok === true && JSON.stringify(Object.keys(r.j).sort()) === '["ok","order_formatted","timestamp","total_price"]';

  fresh({ hl5xx: '/contacts/' });
  const a = await placeOrder('tok-thandi-w', 'thandi');
  const ra = rowsOf('thandi')[0] || {};
  ok(shapeOk(a) && N8.bodies.length === 1, 'HighLevel 500 → the order is still accepted and sent to the kitchen, reply unchanged', a.status + ' ' + a.t.slice(0, 100));
  ok(ra.hl_state === 'failed' && ra.hl_tries === 1 && /500/.test(ra.hl_error || ''), '…the row is failed, 1 try, with the reason', JSON.stringify({ s: ra.hl_state, t: ra.hl_tries, e: ra.hl_error }));
  ok(Date.parse(ra.hl_next_at) === CLOCK + 2 * MIN, '…and is due again in 2 minutes (the first backoff step)', ra.hl_next_at);
  ok(ra.hl_contact_seed && ra.hl_contact_seed.first === 'Thandi' && ra.hl_contact_seed.phone === '0821110901', '…keeping the typed name/phone so a retry can create her contact', JSON.stringify(ra.hl_contact_seed));

  fresh({ hlDown: true });
  const b = await placeOrder('tok-thandi-w', 'thandi');
  const rb = rowsOf('thandi')[0] || {};
  ok(shapeOk(b) && rb.hl_state === 'failed' && /reached/i.test(rb.hl_error || ''), 'HighLevel unreachable → accepted; row failed "could not be reached"', JSON.stringify({ s: rb.hl_state, e: rb.hl_error }));

  fresh({ hlSlow: true });
  sub = 0; subMax = 0; urls = [];
  const req = new Request('https://api.local/api/wimpy/order', { method: 'POST', headers: { Authorization: 'Bearer tok-thandi-w', 'Content-Type': 'application/json', 'X-Cbx-Client': 'v5' }, body: JSON.stringify(orderBody('thandi')) });
  const t0 = RealDate.now(); const res = await app.handle(req, ENV, ctx); const replyMs = RealDate.now() - t0;
  await settle();
  const rc = rowsOf('thandi')[0] || {};
  ok(res.status === 200 && replyMs < 1500, 'HighLevel hanging → the person has the confirmation in ' + replyMs + ' ms (the card work runs after the reply)', res.status + ' ' + replyMs + ' ms');
  ok(rc.hl_state === 'failed' && /8 seconds/.test(rc.hl_error || ''), '…and the row says HighLevel did not answer within 8 seconds', JSON.stringify({ s: rc.hl_state, e: rc.hl_error }));

  fresh({ hlDup: true });
  const d = await placeOrder('tok-thandi-w', 'thandi');
  const rd = rowsOf('thandi')[0] || {};
  ok(shapeOk(d) && rd.hl_state === 'failed' && /duplicate/i.test(rd.hl_error || ''), '"Allow duplicate opportunities" still OFF → accepted; the refusal is recorded with its reason', JSON.stringify({ s: rd.hl_state, e: rd.hl_error }));

  fresh({});
  const e = await call('POST', '/api/wimpy/order', { token: 'tok-thandi-w', body: orderBody('thandi'), env: ENV_NOHL });
  const re = rowsOf('thandi')[0] || {};
  ok(shapeOk(e) && HL.calls.length === 0, 'no key/location on the server → accepted, and HighLevel is never called', e.status + ' calls=' + HL.calls.length);
  ok(re.hl_state === 'pending' && re.hl_tries === 0 && /not configured/i.test(re.hl_error || ''), '…the row waits as pending ("not configured"), no try spent', JSON.stringify({ s: re.hl_state, t: re.hl_tries, e: re.hl_error }));

  fresh({ n8nFail: true });
  const f = await placeOrder('tok-thandi-w', 'thandi');
  ok(f.status === 502 && /could not be sent/.test((f.j && f.j.error) || ''), 'the kitchen refuses → 502 exactly as before', f.status + ' ' + f.t.slice(0, 100));
  ok(DBT.orders.length === 0 && HL.calls.length === 0, '…and NO ledger row and no card — the order was not placed', 'rows=' + DBT.orders.length + ' hl=' + HL.calls.length);

  fresh({ ordersInsertFail: true });
  const g = await placeOrder('tok-thandi-w', 'thandi');
  ok(shapeOk(g) && N8.bodies.length === 1, 'the ledger insert fails → the order is still accepted with the same reply', g.status + ' ' + g.t.slice(0, 100));
  ok(HL.calls.length === 0, '…no card is attempted without a row', String(HL.calls.length));
  const lf = DBT.rules['kv:wimpy-ledger-failed'];
  const lfv = lf ? JSON.stringify(lf.value) : '';
  ok(!!lf && /insert refused|500/.test(lfv), '…and the failure is REPORTED (kv:wimpy-ledger-failed, read by the health check)', lfv.slice(0, 160));
  ok(lf && !SECRETS_AND_PHONES.some((s) => lfv.includes(s)) && !/Thandi|Mokoena|CB901/.test(lfv), '…carrying no name, CB, phone or secret', lfv.slice(0, 160));

  fresh({ hlEcho: true });
  await placeOrder('tok-thandi-w', 'thandi');
  const rh = rowsOf('thandi')[0] || {};
  ok(rh.hl_state === 'failed' && rh.hl_error && !SECRETS_AND_PHONES.some((s) => rh.hl_error.includes(s)), 'an error that echoes the key, the location and a phone number is stored redacted', rh.hl_error);

  fresh({});
  CLOCK = RealDate.parse('2026-10-08T15:30:00Z');   // 17:30 SAST — closed
  const h = await placeOrder('tok-thandi-w', 'thandi');
  ok(h.status === 403 && DBT.orders.length === 0 && N8.bodies.length === 0, 'outside the window → 403, nothing recorded, nothing sent (unchanged)', h.status + ' rows=' + DBT.orders.length);
  CLOCK = RealDate.parse('2026-10-08T05:00:00Z');
  const i = await call('POST', '/api/wimpy/order', { token: 'tok-thandi-w', body: orderBody('thandi', undefined, '', { cb: 'CB902' }) });
  ok(i.status === 400 && DBT.orders.length === 0 && N8.bodies.length === 0, 'an order in someone else\'s CB → 400, nothing recorded (unchanged)', i.status + ' rows=' + DBT.orders.length);
  const ref = await placeOrder('tok-ref', 'mgr');
  ok(ref.status === 403 && DBT.orders.length === 0, 'a referrals-scoped session cannot order (403)', String(ref.status));
}

/* ════════════════════ T008 · the Wimpy cron retries; stuck rows raise a health alert ════════════════════ */
head('T008 · the Wimpy cron ("7,27,47 * * * *"): ≤ 5 due rows a run, inside the budget; backoff; stuck → health alert');
const dbm = await import(SRC('db.mjs'));
const seedRow = (o) => { const r = { id: uuid(), owner_user_id: uuid(), cb: 'CB9' + (100 + DBT.orders.length), placed_at: iso0(CLOCK - 60 * MIN),
  items: [{ id: 'cheese_burger', item: 'Cheese Burger', quantity: 1, item_total: 54.9 }], total: 54.9, notes: null, hl_state: 'failed',
  hl_contact_id: null, hl_opportunity_id: null, hl_tries: 1, hl_error: 'earlier', hl_next_at: iso0(CLOCK - MIN),
  hl_contact_seed: { first: 'Zanele', last: 'Khumalo', phone: '0825550100' }, ...o }; DBT.orders.push(r); return r; };
function iso0(ms) { return new RealDate(ms).toISOString(); }
const status = () => { const v = DBT.rules['kv:wimpy-hl-status']; try { return v ? JSON.parse(v.value.data) : null; } catch (e) { return null; } };
{
  CLOCK = RealDate.parse('2026-10-08T09:00:00Z');
  resetWorld();
  const due = [];
  for (let k = 0; k < 7; k++) due.push(seedRow({ placed_at: iso0(CLOCK - (90 - k) * MIN) }));            // oldest first
  const stuck = seedRow({ hl_state: 'stuck', hl_tries: 8, hl_next_at: iso0(CLOCK - 500 * MIN) });
  const fresh = seedRow({ hl_state: 'pending', hl_tries: 0, hl_error: null, placed_at: iso0(CLOCK - MIN), hl_next_at: iso0(CLOCK + MIN) });
  const done = seedRow({ hl_state: 'written', hl_opportunity_id: 'op-old', hl_contact_seed: null });
  /* the WORST case for every row: no contact yet, and a racing request links one first (contact + insert + re-read) */
  F.linkRace = new Map(due.map((r, k) => [r.owner_user_id, 'hc-race-' + k]));
  const r = await cron('7,27,47 * * * *');
  measured.cron.push(r.subs);
  const firstFive = due.slice(0, 5), lastTwo = due.slice(5);
  ok(firstFive.every((x) => x.hl_state === 'written') && lastTwo.every((x) => x.hl_state === 'failed' && x.hl_tries === 1),
    '7 rows due → the 5 OLDEST are written this run, the other 2 wait untouched', JSON.stringify(due.map((x) => x.hl_state)));
  ok(r.subs <= BUDGET_CRON, 'worst case (cold pipeline, every row creating a contact and losing the link race): ' + r.subs + ' subrequests ≤ ' + BUDGET_CRON, String(r.subs));
  ok(stuck.hl_state === 'stuck' && stuck.hl_tries === 8 && fresh.hl_state === 'pending' && fresh.hl_tries === 0 && done.hl_opportunity_id === 'op-old',
    'a stuck row, a row inside its 2-minute grace and a written row are left alone');
  ok(firstFive.every((x, k) => x.hl_contact_id === 'hc-race-' + k && HL.cards.find((c) => c.id === x.hl_opportunity_id).contactId === 'hc-race-' + k),
    'the link race: each card goes on the contact LINKED to that person (the racer\'s), never the one this run created');
  ok(HL.contacts.length === 5 && !DBT.links.some((l) => HL.contacts.some((c) => c.id === l.contact_id)), '…the 5 contacts this run made are left orphaned in HighLevel, never linked');
  const st = status();
  ok(st && st.configured === true && st.counts && st.counts.failed === 2 && st.counts.stuck === 1 && st.counts.pending === 1 && st.processed && st.processed.written === 5,
    'kv:wimpy-hl-status: counts {pending 1, failed 2, stuck 1}, 5 written this run', JSON.stringify(st));
  const sv = JSON.stringify(DBT.rules['kv:wimpy-hl-status'] || {});
  ok(!/CB9\d{3}|Zanele|Khumalo|0825550100/.test(sv) && !SECRETS_AND_PHONES.some((s) => sv.includes(s)), '…and it names nobody: no CB, name, phone, key or location', sv.slice(0, 200));
  const r2 = await cron('7,27,47 * * * *');
  measured.cron.push(r2.subs);
  ok(lastTwo.every((x) => x.hl_state === 'written') && r2.subs <= BUDGET_CRON, 'the next run takes the remaining 2 (' + r2.subs + ' subrequests)', JSON.stringify(lastTwo.map((x) => x.hl_state)));
}
{
  CLOCK = RealDate.parse('2026-10-08T09:00:00Z');
  resetWorld();
  const row = seedRow({ hl_state: 'pending', hl_tries: 0, hl_error: null, hl_next_at: iso0(CLOCK - MIN) });
  F.hl5xx = '/opportunities/';
  const steps = [];
  for (let k = 0; k < 9; k++) {
    const before = Date.parse(row.hl_next_at);
    CLOCK = Math.max(CLOCK, before);
    await cron('7,27,47 * * * *');
    if (row.hl_state === 'stuck') break;
    steps.push(Math.round((Date.parse(row.hl_next_at) - CLOCK) / MIN));
  }
  ok(JSON.stringify(steps) === '[2,5,10,20,40,80,160]', 'a card that keeps failing backs off 2 · 5 · 10 · 20 · 40 · 80 · 160 minutes', JSON.stringify(steps));
  ok(row.hl_state === 'stuck' && row.hl_tries === 8 && /500/.test(row.hl_error || ''), '…and the 8th failure marks it stuck, with its reason', JSON.stringify({ s: row.hl_state, t: row.hl_tries, e: row.hl_error }));
  const calls = HL.calls.length;
  CLOCK += 1000 * MIN; await cron('7,27,47 * * * *');
  ok(HL.calls.length === calls && row.hl_state === 'stuck', '…a stuck row is never retried by the cron (re-queued by hand once the cause is fixed)');
  ok((status() || {}).counts && status().counts.stuck === 1, '…and the status counts it', JSON.stringify(status()));
}
{
  CLOCK = RealDate.parse('2026-10-08T09:00:00Z');
  resetWorld();
  const rows = [seedRow({}), seedRow({}), seedRow({})];
  const DB = dbm.db(ENV);
  sub = 0; subMax = 0;
  await Promise.all([hl.retryDueOrders(ENV, DB), hl.retryDueOrders(ENV, DB)]);
  const perRow = rows.map((x) => HL.cards.filter((c) => c.id === x.hl_opportunity_id).length);
  ok(rows.every((x) => x.hl_state === 'written') && HL.cards.length === 3, 'two runners at once: every due row is written exactly once (the claim is atomic) — ' + HL.cards.length + ' cards for 3 rows', JSON.stringify(perRow));
}
{
  CLOCK = RealDate.parse('2026-10-08T09:00:00Z');
  resetWorld();
  const row = seedRow({ hl_state: 'pending', hl_tries: 0, hl_next_at: iso0(CLOCK - 10 * MIN), hl_error: 'HighLevel is not configured yet' });
  const before = JSON.stringify(row);
  const r = await cron('7,27,47 * * * *', ENV_NOHL);
  ok(JSON.stringify(row) === before && HL.calls.length === 0 && !r.urls.some((u) => /^PATCH .*wimpy_orders/.test(u)), 'no key/location → the cron touches no row and calls no HighLevel', r.urls.join(' | '));
  ok((status() || {}).configured === false && status().counts.pending === 1, '…and says so in kv:wimpy-hl-status (configured: false, 1 waiting)', JSON.stringify(status()));
}
/* ════════════════════ T009 · My orders — mine, and nobody else's ════════════════════ */
head('T009 · GET /api/wimpy/orders — the signed-in person\'s own orders, newest first, with the kitchen stage');
const ords = (x) => (x && x.j && Array.isArray(x.j.orders) ? x.j.orders : []);
const at = (hhmm) => RealDate.parse('2026-10-08T' + hhmm + ':00+02:00');
const ORDER_KEYS = '["items","notes","placed_at","stage","stage_note","total"]';
const NOT_YET = 'Not on the kitchen board yet', UNREACHABLE = 'The kitchen board could not be reached — try again shortly', GONE = 'No longer on the kitchen board';
let T = {};   // the scenario's handles
async function scenario() {
  resetWorld();
  CLOCK = at('07:00'); await placeOrder('tok-thandi-w', 'thandi', [{ id: 'cheese_burger', quantity: 2 }], 'no onions please');      // R147.80
  CLOCK = at('07:30'); await placeOrder('tok-thandi-w', 'thandi', [{ id: 'mzansi_brekkie', quantity: 1 }]);                           // R45.90
  CLOCK = at('07:40'); await placeOrder('tok-sipho-w', 'sipho', [{ id: 'big_cheese_burger', quantity: 3 }], 'Sipho collects');       // R287.70
  CLOCK = at('07:50'); await placeOrder('tok-sipho-w', 'sipho', [{ id: 'farmhouse_breakfast', quantity: 2 }]);                        // R155.80
  F.hl5xx = '/opportunities/';
  CLOCK = at('08:15'); await placeOrder('tok-thandi-w', 'thandi', [{ id: 'bacon_cheese_burger', quantity: 1 }]);                      // R82.90, card FAILED
  delete F.hl5xx;
  const th = rowsOf('thandi').sort((a, b) => tsCmp(a.placed_at, b.placed_at)), si = rowsOf('sipho');
  T = { th, si, thContact: th[0].hl_contact_id, siContact: si[0].hl_contact_id };
  HL.cards.find((c) => c.id === th[1].hl_opportunity_id).pipelineStageId = 'st-ready';        // the kitchen moved her 07:30 order on
  CLOCK = at('08:16');                                                                         // her failed row is not due yet (08:17)
}
await scenario();
{
  const r = await myOrders('tok-thandi-w');
  measured.history.push(r.subs);
  const o = (r.j && r.j.orders) || [];
  ok(r.status === 200 && o.length === 3, 'thandi sees her 3 orders', r.status + ' ' + r.t.slice(0, 160));
  ok(r.j && r.j.since === '2026-10-07' && r.j.stages_available === true, '…with since: 2026-10-07 (WIMPY_HISTORY_SINCE) and stages_available: true', JSON.stringify(r.j && { since: r.j.since, s: r.j.stages_available }));
  ok(o.map((x) => x.placed_at).join(',') === '2026-10-08T08:15:00+02:00,2026-10-08T07:30:00+02:00,2026-10-08T07:00:00+02:00', 'newest first, each placed_at in SA time (+02:00)', o.map((x) => x.placed_at).join(','));
  ok(o.every((x) => JSON.stringify(Object.keys(x).sort()) === ORDER_KEYS), 'each order is exactly {placed_at, total, notes, items, stage, stage_note} — no id of any kind', o.map((x) => Object.keys(x).join('|')).join(' ; '));
  ok(o[2] && o[2].total === '147.80' && o[2].notes === 'no onions please' && JSON.stringify(o[2].items) === '[{"item":"Cheese Burger","quantity":2,"item_total":"147.80"}]',
    'items as {item, quantity, item_total}, money as "147.80", her notes', JSON.stringify(o[2]));
  ok(o[2] && o[2].stage === 'New Order' && o[2].stage_note === null, 'the 07:00 order reads its card\'s stage: New Order', JSON.stringify(o[2] && [o[2].stage, o[2].stage_note]));
  ok(o[1] && o[1].stage === 'Ready for Collection', 'the 07:30 order follows the kitchen: Ready for Collection', JSON.stringify(o[1] && o[1].stage));
  ok(o[0] && o[0].stage === null && o[0].stage_note === NOT_YET && o[0].total === '82.90', 'the 08:15 order (card failed) is still listed: "' + NOT_YET + '"', JSON.stringify(o[0]));
  ok(!/Sipho|Dlamini|CB902|287\.70|155\.80|farmhouse|Big Cheese/i.test(r.t) && !r.t.includes(P.sipho.user_id), 'NOTHING of sipho: no name, CB, total, item or account id', r.t.slice(0, 200));
  ok(!/hc-|op-|pl-wimpy|st-(new|ready|proc|done)/.test(r.t) && !r.t.includes(P.thandi.user_id) && !SECRETS_AND_PHONES.some((s) => r.t.includes(s)),
    'no HighLevel id, no account id, no phone, no key, no location id in the reply', r.t.slice(0, 200));
  const ledgerReads = r.urls.filter((u) => /\/rest\/v1\/wimpy_orders/.test(u) && /^GET/.test(u));
  ok(ledgerReads.length >= 1 && ledgerReads.every((u) => decodeURIComponent(u).includes('owner_user_id=eq.' + P.thandi.user_id)), 'the ledger is read by HER session user_id', ledgerReads.map(decodeURIComponent).join(' | '));
  const searches = HL.calls.filter((c) => c.path === '/opportunities/search');
  ok(searches.length === 1 && searches[0].query.contact_id === T.thContact && searches[0].query.location_id === LOC && searches[0].query.pipeline_id === 'pl-wimpy',
    'HighLevel is asked for HER contact\'s cards only (one search)', JSON.stringify(searches.map((s) => s.query.contact_id)));
  ok(r.subs <= BUDGET_HISTORY, 'subrequests: ' + r.subs + ' ≤ ' + BUDGET_HISTORY, String(r.subs));

  const s = await myOrders('tok-sipho-w');
  const so = (s.j && s.j.orders) || [];
  ok(s.status === 200 && so.length === 2 && so.every((x) => ['287.70', '155.80'].includes(x.total)), 'sipho sees his 2 — and only his', s.t.slice(0, 200));
  ok(!/Thandi|Mokoena|CB901|109\.80|45\.90|82\.90|no onions/i.test(s.t), '…nothing of thandi\'s in his answer', s.t.slice(0, 200));
  const f = await myOrders('tok-thandi-f');
  ok(f.status === 403 && !(f.j && f.j.orders), 'a FULL session (the suite\'s sign-in) is refused — only a Wimpy session reads history here (FR-003)', f.status + ' ' + f.t.slice(0, 100));
  const m = await myOrders('tok-mgr-w');
  ok(m.status === 200 && ords(m).length === 0 && !!(m.j && m.j.orders), 'a manager who has not ordered sees an empty list (not anyone else\'s)', m.t.slice(0, 120));
}
head('T009 · whatever the request names, the answer is the signed-in person\'s own');
{
  const base = await myOrders('tok-thandi-w');
  const forged = ['?cb=CB902', '?cb=cb902&user=cb902', '?user_id=' + P.sipho.user_id, '?owner=' + P.sipho.user_id, '?owner_user_id=' + P.sipho.user_id,
    '?contact=' + T.siContact, '?contact_id=' + T.siContact, '?id=' + T.si[0].id, '?order=' + T.si[0].hl_opportunity_id, '?opportunity_id=' + T.si[0].hl_opportunity_id,
    '?username=cb902', '?limit=1000&offset=0', '?owner_user_id=eq.' + P.sipho.user_id + '&or=(owner_user_id.neq.x)'];
  const differ = [];
  for (const q of forged) { const x = await myOrders('tok-thandi-w', q); if (x.status !== 200 || x.t !== base.t) differ.push(q + ' → ' + x.status + ' ' + x.t.slice(0, 80)); }
  ok(!differ.length, forged.length + ' forged query strings (sipho\'s CB, account id, contact, order, card…) change NOTHING', differ.join(' ;; '));
  const hdr = await call('GET', '/api/wimpy/orders', { token: 'tok-thandi-w', headers: { 'X-Cbx-User': 'cb902', 'X-Owner': P.sipho.user_id } });
  ok(hdr.t === base.t, 'headers naming sipho change nothing', hdr.t.slice(0, 80));
  const post = await call('POST', '/api/wimpy/orders', { token: 'tok-thandi-w', body: { cb: 'CB902', owner_user_id: P.sipho.user_id, contact_id: T.siContact } });
  ok(post.status !== 200 || post.t === base.t, 'a POST carrying a body that names sipho is refused or answers hers', post.status + ' ' + post.t.slice(0, 80));
  ok(!/Sipho|CB902|287\.70/.test(post.t), '…and never carries his orders', post.t.slice(0, 80));
}
head('T009 · a HighLevel card counts only if it is on HER contact AND recorded on that very row');
{
  /* a card in the search answer under her CB name but another contact (a search that ignores its filter) */
  HL.searchExtra = [{ id: 'op-evil', contactId: 'hc-evil', name: 'CB901 · Thandi Mokoena · R999.00', pipelineStageId: 'st-done', pipelineId: 'pl-wimpy' }];
  const a = await myOrders('tok-thandi-w');
  ok(ords(a).length === 3 && !/999/.test(a.t), 'a card under her CB but on another contact never appears', a.t.slice(0, 160));
  /* a card on HER contact whose id is on none of her rows */
  HL.searchExtra = [{ id: 'op-stray', contactId: T.thContact, pipelineStageId: 'st-done', pipelineId: 'pl-wimpy', name: 'CB901 · stray' }];
  const b = await myOrders('tok-thandi-w');
  ok(ords(b).length === 3 && !ords(b).some((x) => x.stage === 'Completed'), 'a card on her contact that is not recorded on any of her rows adds nothing', JSON.stringify(ords(b).map((x) => x.stage)));
  /* the kitchen deletes her 07:00 card; a forged card with THAT id but sipho's contact shows up */
  const real = HL.cards.find((c) => c.id === T.th[0].hl_opportunity_id);
  HL.cards = HL.cards.filter((c) => c !== real);
  HL.searchExtra = [{ id: real.id, contactId: T.siContact, pipelineStageId: 'st-done', pipelineId: 'pl-wimpy' }];
  const c = await myOrders('tok-thandi-w');
  const o10 = ords(c).find((x) => x.placed_at.endsWith('07:00:00+02:00'));
  ok(o10 && o10.stage === null && o10.stage_note === GONE, 'her card gone + a forged card with its id on another contact → "' + GONE + '", never the forged stage', JSON.stringify(o10));
  HL.cards.push(real); HL.searchExtra = [];
  /* a defensive check: a database filter that answers everyone's rows still shows her only hers */
  F.ordersIgnoreOwner = true;
  const d = await myOrders('tok-thandi-w');
  delete F.ordersIgnoreOwner;
  ok(ords(d).length === 3 && !/287\.70|155\.80/.test(d.t), 'even a database answer carrying sipho\'s rows is filtered back to hers by the Worker', d.t.slice(0, 160));
  /* a row under her CB but owned by another account is not hers */
  DBT.orders.push({ ...T.si[0], id: uuid(), cb: 'CB901', placed_at: iso0(at('08:30')), total: 311.1 });
  const e = await myOrders('tok-thandi-w');
  ok(ords(e).length === 3 && !/311\.10/.test(e.t), 'a row carrying her CB number but owned by another account is not shown (owner = the session, never the CB)', e.t.slice(0, 160));
  DBT.orders.pop();
}
head('T009 · when HighLevel is down or slow, the orders still come back');
{
  F.searchDown = true;
  const a = await myOrders('tok-thandi-w');
  delete F.searchDown;
  const ao = (a.j && a.j.orders) || [];
  ok(a.status === 200 && ao.length === 3 && a.j.stages_available === false, 'search answering 503 → all 3 orders, stages_available: false', a.t.slice(0, 160));
  ok(ao.filter((x) => x.stage_note === UNREACHABLE).length === 2 && ao[0].stage_note === NOT_YET && ao.every((x) => x.stage === null),
    '…the two with cards say "' + UNREACHABLE + '", the one without "' + NOT_YET + '"', JSON.stringify(ao.map((x) => x.stage_note)));
  F.searchSlow = true;
  const t0 = RealDate.now(); const b = await myOrders('tok-thandi-w'); const took = RealDate.now() - t0;
  delete F.searchSlow;
  ok(b.status === 200 && ords(b).length === 3 && b.j.stages_available === false && took >= 4500 && took < 7000,
    'search hanging → answered in ' + took + ' ms (5 s cap) with the orders and the same notes', b.status + ' ' + took);
  const n = await myOrders('tok-thandi-w', '', { env: ENV_NOHL });
  ok(n.status === 200 && ords(n).length === 3 && n.j.stages_available === false && ords(n).every((x) => x.stage === null), 'no key/location on the server → the orders, no stages, stages_available: false', n.t.slice(0, 160));
  HL.cards.find((c) => c.id === T.th[0].hl_opportunity_id).pipelineStageId = 'st-out';
  F.extraStage = { id: 'st-out', name: 'Out for Delivery' };
  const reads = HL.pipelineReads;
  const s = await myOrders('tok-thandi-w');
  ok(ords(s)[2] && ords(s)[2].stage === 'Out for Delivery' && HL.pipelineReads === reads + 1, 'a stage the kitchen added after the cache was filled → re-read once, shown by name', JSON.stringify(ords(s)[2] && ords(s)[2]) + ' reads+' + (HL.pipelineReads - reads));
  delete F.extraStage; HL.cards.find((c) => c.id === T.th[0].hl_opportunity_id).pipelineStageId = 'st-new';
}
head('T009 · no session, an expired one, or the wrong kind of session → refused');
{
  const a = await myOrders(null);
  ok(a.status === 401 && !/orders/.test(a.t), 'no session → 401', a.status + ' ' + a.t.slice(0, 80));
  const b = await myOrders('tok-expired');
  ok(b.status === 401, 'an expired session → 401', String(b.status));
  const c = await myOrders('tok-nobody');
  ok(c.status === 401, 'a token that is no session → 401', String(c.status));
  const d = await myOrders('tok-ref');
  ok(d.status === 403 && !(d.j && d.j.orders), 'a referrals-scoped session → 403', d.status + ' ' + d.t.slice(0, 80));
  const full = await myOrders('tok-thandi-f');
  ok(full.status === 403, 'a full-scope session → 403 (the service mints only wimpy sessions)', String(full.status));
}
head('T009 · her own late card catches up when she looks; the newest 50');
{
  const failed = T.th[2];
  const siRow = { ...T.si[0], id: uuid(), hl_state: 'failed', hl_opportunity_id: null, hl_tries: 1, hl_next_at: iso0(at('08:00')), hl_contact_seed: { first: 'Sipho', last: 'Dlamini', phone: '0832220902' } };
  DBT.orders.push(siRow);
  CLOCK = at('08:30');                                                         // her failed row (due 08:17) and sipho's are both due
  const cards = HL.cards.length;
  const r = await myOrders('tok-thandi-w');
  measured.history.push(r.subs);
  ok(ords(r)[0] && ords(r)[0].stage_note === NOT_YET, 'the answer is built first (her failed order still "' + NOT_YET + '")', JSON.stringify(ords(r)[0] && ords(r)[0]));
  ok(failed.hl_state === 'written' && HL.cards.length === cards + 1 && HL.cards[HL.cards.length - 1].contactId === T.thContact, '…then her due row is retried after the reply, onto HER contact', JSON.stringify({ s: failed.hl_state, n: HL.cards.length - cards }));
  ok(siRow.hl_state === 'failed' && siRow.hl_tries === 1, '…and sipho\'s due row is NOT touched by her request', JSON.stringify({ s: siRow.hl_state, t: siRow.hl_tries }));
  ok(r.subs <= BUDGET_HISTORY, '…all inside ' + r.subs + ' ≤ ' + BUDGET_HISTORY + ' subrequests', String(r.subs));
  const r2 = await myOrders('tok-thandi-w');
  ok(ords(r2)[0] && ords(r2)[0].stage === 'New Order', 'her next look shows it on the board: New Order', JSON.stringify(ords(r2)[0] && ords(r2)[0]));
  /* worst case for the history: two of her rows due, no contact yet (a cold link), the pipeline cold */
  resetWorld(); CLOCK = at('12:00');
  for (let k = 0; k < 3; k++) DBT.orders.push({ id: uuid(), owner_user_id: P.thandi.user_id, cb: 'CB901', placed_at: iso0(at('11:0' + k)), items: [{ id: 'cheese_burger', item: 'Cheese Burger', quantity: 1, item_total: 54.9 }],
    total: 54.9, notes: null, hl_state: 'failed', hl_contact_id: null, hl_opportunity_id: null, hl_tries: 1, hl_error: 'x', hl_next_at: iso0(at('08:30')), hl_contact_seed: { first: 'Thandi', last: 'Mokoena', phone: '0821110901' } });
  F.linkRace = new Map([[P.thandi.user_id, 'hc-race-th']]);
  const w = await myOrders('tok-thandi-w');
  measured.history.push(w.subs);
  ok(w.subs <= BUDGET_HISTORY && DBT.orders.filter((x) => x.hl_state === 'written').length === 2, 'worst case (3 due, cold link + race, cold pipeline): 2 retried, ' + w.subs + ' ≤ ' + BUDGET_HISTORY + ' subrequests', w.subs + ' written=' + DBT.orders.filter((x) => x.hl_state === 'written').length);
  resetWorld(); CLOCK = at('16:00');
  for (let k = 0; k < 60; k++) DBT.orders.push({ id: uuid(), owner_user_id: P.thandi.user_id, cb: 'CB901', placed_at: iso0(at('09:00') + k * MIN), items: [{ id: 'cheese_burger', item: 'Cheese Burger', quantity: 1, item_total: 54.9 }],
    total: 54.9, notes: null, hl_state: 'written', hl_contact_id: null, hl_opportunity_id: null, hl_tries: 0, hl_error: null, hl_next_at: iso0(at('09:00')), hl_contact_seed: null });
  const big = await myOrders('tok-thandi-w');
  const bo = (big.j && big.j.orders) || [];
  ok(bo.length === 50 && bo[0].placed_at === '2026-10-08T09:59:00+02:00' && bo[49].placed_at === '2026-10-08T09:10:00+02:00', '60 orders → the newest 50, newest first', bo.length + ' ' + (bo[0] && bo[0].placed_at) + ' … ' + (bo[49] && bo[49].placed_at));
}

/* ════════════════════ REVIEW (T014) · R1–R10, each shown RED first ════════════════════ */
const cardPosts = () => HL.calls.filter((c) => c.method === 'POST' && c.path === '/opportunities/').length;
head('R1 (M1) · a stalled ledger insert never delays the confirmation');
{
  CLOCK = at('07:00'); resetWorld();
  F.ordersInsertHang = 30000;
  sub = 0; subMax = 0; urls = [];
  const req = new Request('https://api.local/api/wimpy/order', { method: 'POST', headers: { Authorization: 'Bearer tok-thandi-w', 'Content-Type': 'application/json', 'X-Cbx-Client': 'v5' }, body: JSON.stringify(orderBody('thandi')) });
  const t0 = RealDate.now(); const res = await app.handle(req, ENV, ctx); const replyMs = RealDate.now() - t0;
  const j = await res.clone().json().catch(() => null);
  ok(res.status === 200 && replyMs < 1500, 'Supabase stalls 30 s on the ledger insert → the confirmation comes back in ' + replyMs + ' ms', res.status + ' ' + replyMs + ' ms');
  ok(j && j.ok === true && JSON.stringify(Object.keys(j).sort()) === '["ok","order_formatted","timestamp","total_price"]' && N8.bodies.length === 1, '…unchanged, and the kitchen has the order once', JSON.stringify(j).slice(0, 100));
  await settle();
  measured.order.push(subMax);
  const rows = rowsOf('thandi');
  ok(rows.length === 1 && rows[0].hl_state === 'written' && HL.cards.length === 1, '…and once Supabase answers, the row and its card still land (insert → card, one chain after the reply)', JSON.stringify(rows.map((r) => r.hl_state)) + ' cards=' + HL.cards.length);
}
head('R2 (M2) · one order, one card — whatever fails after the card is made');
{
  CLOCK = at('07:00'); resetWorld();
  const r = await placeOrder('tok-thandi-w', 'thandi');
  const pIdx = r.urls.findIndex((u) => /^PATCH .*\/rest\/v1\/wimpy_orders/.test(u)), nIdx = r.urls.findIndex((u) => /\/notes$/.test(u));
  const card = HL.cards[0] || {};
  ok(pIdx > 0 && nIdx > 0 && pIdx < nIdx && PATCHES[0] && PATCHES[0].hl_opportunity_id === card.id, '(a) the card id is written onto the row straight after the card is made — before the note', 'patch@' + pIdx + ' note@' + nIdx + ' ' + JSON.stringify(PATCHES[0] || {}).slice(0, 120));
  ok(card.name && !/Thandi|Mokoena/.test(card.name) && /CB901/.test(card.name), '…the card\'s name is stable across retries (CB, total, time, the order\'s tag — no typed name)', card.name);

  CLOCK = at('07:00'); resetWorld();
  F.cardTimeout = true;
  await placeOrder('tok-thandi-w', 'thandi');
  delete F.cardTimeout;
  const r1 = rowsOf('thandi')[0] || {};
  ok(HL.cards.length === 1 && r1.hl_state === 'failed' && !r1.hl_opportunity_id, '(b) setup: HighLevel made the card but the 8 s abort fired first — row failed, no card recorded', JSON.stringify({ c: HL.cards.length, s: r1.hl_state, o: r1.hl_opportunity_id }));
  CLOCK = at('07:03');
  const c1 = await cron('7,27,47 * * * *');
  measured.cron.push(c1.subs);
  ok(r1.hl_state === 'written' && r1.hl_opportunity_id === (HL.cards[0] || {}).id && HL.cards.length === 1, '(b) the retry finds that card by its name and records it — still ONE card', JSON.stringify({ s: r1.hl_state, o: r1.hl_opportunity_id, cards: HL.cards.length }));

  CLOCK = at('07:00'); resetWorld();
  let once = true;
  F.ordersPatchFail = (b) => { if (once && b.hl_state === 'written') { once = false; return true; } return false; };
  await placeOrder('tok-thandi-w', 'thandi');
  delete F.ordersPatchFail;
  const r2 = rowsOf('thandi')[0] || {};
  ok(HL.cards.length === 1 && r2.hl_state === 'failed' && !r2.hl_opportunity_id, '(b) setup: the card was made but recording it failed', JSON.stringify({ c: HL.cards.length, s: r2.hl_state }));
  CLOCK = at('07:03'); await cron('7,27,47 * * * *');
  ok(r2.hl_state === 'written' && r2.hl_opportunity_id === (HL.cards[0] || {}).id && HL.cards.length === 1, '(b) the retry reuses it — still ONE card', JSON.stringify({ s: r2.hl_state, cards: HL.cards.length }));

  CLOCK = at('07:00'); resetWorld();
  await placeOrder('tok-thandi-w', 'thandi');
  const thc = (DBT.links[0] || {}).contact_id;
  const R = seedRow({ owner_user_id: P.thandi.user_id, cb: 'CB901', hl_state: 'failed', hl_tries: 1, hl_next_at: iso0(CLOCK - MIN) });
  const nm = typeof hl.cardNameFor === 'function' ? hl.cardNameFor(R) : '(no cardNameFor)';
  HL.searchExtra = [{ id: 'op-taken', name: nm, contactId: thc, pipelineId: 'pl-wimpy', pipelineStageId: 'st-new' }];
  seedRow({ owner_user_id: P.thandi.user_id, cb: 'CB901', hl_state: 'written', hl_opportunity_id: 'op-taken', hl_contact_seed: null });
  await cron('7,27,47 * * * *');
  ok(typeof hl.cardNameFor === 'function' && R.hl_state === 'written' && R.hl_opportunity_id && R.hl_opportunity_id !== 'op-taken',
    '(b) a card with its name that is already recorded on ANOTHER row is never taken — a new card is made', JSON.stringify({ s: R.hl_state, o: R.hl_opportunity_id }));
}
head('R3 (M3) · stuck rows never starve the retry queue');
{
  CLOCK = at('12:00'); resetWorld();
  for (let k = 0; k < 250; k++) seedRow({ hl_state: 'stuck', hl_tries: 8, placed_at: iso0(at('08:00') + k * 1000), hl_next_at: iso0(at('08:00')), hl_contact_seed: null });
  const due = seedRow({ hl_state: 'failed', hl_tries: 1, placed_at: iso0(at('11:50')), hl_next_at: iso0(at('11:55')) });
  const r = await cron('7,27,47 * * * *');
  measured.cron.push(r.subs);
  ok(due.hl_state === 'written', '250 stuck rows (all older) + 1 due row → the due row is retried', due.hl_state);
  ok((status() || {}).counts && status().counts.stuck === 250 && status().counts.failed === 0, '…and the status counts the 250 stuck', JSON.stringify(status() && status().counts));
  ok(r.subs <= BUDGET_CRON, '…' + r.subs + ' subrequests', String(r.subs));
}
head('R4 (M4) · the typed name and phone are kept only while they can still be needed');
{
  CLOCK = at('08:00'); resetWorld();
  const a = seedRow({ hl_state: 'failed', hl_tries: 7, hl_next_at: iso0(CLOCK - MIN) });
  F.hl5xx = '/contacts/';
  await cron('7,27,47 * * * *');
  ok(a.hl_state === 'stuck' && a.hl_contact_seed == null, 'a row that goes stuck drops its typed name and phone', JSON.stringify({ s: a.hl_state, seed: a.hl_contact_seed }));
  resetWorld();
  await placeOrder('tok-thandi-w', 'thandi');
  const b = seedRow({ owner_user_id: P.thandi.user_id, cb: 'CB901', hl_state: 'failed', hl_tries: 1, hl_next_at: iso0(CLOCK - MIN), hl_contact_seed: { first: 'Thandi', last: 'Mokoena', phone: '0821110901' } });
  F.hl5xx = '/opportunities/';
  await cron('7,27,47 * * * *');
  ok(b.hl_state === 'failed' && b.hl_contact_seed == null, 'she already has a contact → the seed is dropped on the next attempt, even when the card fails', JSON.stringify({ s: b.hl_state, seed: b.hl_contact_seed }));
  resetWorld(); F.hl5xx = '/opportunities/';
  await placeOrder('tok-thandi-w', 'thandi');
  const c = rowsOf('thandi')[0] || {};
  ok(c.hl_state === 'failed' && DBT.links.length === 1 && c.hl_contact_seed == null, 'the order path too: contact made, card refused → no seed kept', JSON.stringify({ s: c.hl_state, seed: c.hl_contact_seed }));
  resetWorld(); F.hl5xx = '/contacts/';
  await placeOrder('tok-thandi-w', 'thandi');
  const d = rowsOf('thandi')[0] || {};
  ok(d.hl_state === 'failed' && d.hl_contact_seed && d.hl_contact_seed.phone === '0821110901', '…while a row whose person has no contact yet keeps it (the retry creates the contact from it)', JSON.stringify(d.hl_contact_seed));
  const dmPath = path.join(ROOT, '..', 'specs', '015-wimpy-order-history', 'data-model.md');   // the suite's spec, when it sits beside this folder
  if (!fs.existsSync(dmPath)) console.log('  SKIP  the suite\'s specs/015 data-model.md is not beside this checkout');
  else { const dm = fs.readFileSync(dmPath, 'utf8'); ok(/hl_contact_seed[^\n]*stuck/.test(dm) && /hl_contact_seed[^\n]*contact link/.test(dm), 'data-model.md says when the seed is cleared (written, stuck, or once the person has a contact link)'); }
}
head('R5 (L1) · a row that kills its runner every time still goes stuck — each claim is a try');
{
  CLOCK = at('08:00'); resetWorld();
  await placeOrder('tok-thandi-w', 'thandi');
  const row = seedRow({ owner_user_id: P.thandi.user_id, cb: 'CB901', hl_state: 'pending', hl_tries: 0, hl_next_at: iso0(CLOCK - MIN), hl_contact_seed: null });
  F.hl5xx = '/opportunities/';
  F.ordersPatchFail = (b) => 'hl_state' in b && b.hl_state !== 'stuck';   // the runner "dies": nothing after the claim is ever recorded
  const hlBefore = HL.calls.length, patchBefore = PATCHES.length;
  let runs = 0;
  for (; runs < 12 && row.hl_state !== 'stuck'; runs++) { CLOCK += 6 * MIN; await cron('7,27,47 * * * *'); }
  delete F.ordersPatchFail;
  ok(row.hl_state === 'stuck' && row.hl_tries === 8, 'after 8 claims that never finish, the next run marks it stuck (' + runs + ' runs)', JSON.stringify({ s: row.hl_state, t: row.hl_tries, runs }));
  const claims = PATCHES.slice(patchBefore).filter((b) => 'hl_tries' in b && !('hl_state' in b)).length;
  const attempts = HL.calls.slice(hlBefore).filter((c) => c.path === '/opportunities/search' || (c.method === 'POST' && c.path === '/opportunities/')).length;
  ok(claims === 8 && attempts === 8, '…having been claimed — and tried on HighLevel — exactly 8 times', JSON.stringify({ claims, attempts }));
}
head('R6 (L2) · a full page of search results without her card says "could not be read", never "gone"');
{
  await scenario();
  HL.searchExtra = Array.from({ length: 100 }, (_, k) => ({ id: 'op-other-' + k, name: 'x', contactId: T.thContact, pipelineId: 'pl-wimpy', pipelineStageId: 'st-done' }));
  const r = await myOrders('tok-thandi-w');
  const notes = ords(r).map((x) => x.stage_note);
  ok(JSON.stringify(notes) === JSON.stringify([NOT_YET, UNREACHABLE, UNREACHABLE]), 'search answered exactly 100 cards, hers not among them → "' + UNREACHABLE + '"', JSON.stringify(notes));
  ok(!ords(r).some((x) => x.stage === 'Completed'), '…and none of the 100 strays lends her a stage');
}
head('R7 (L3) · one HighLevel read per person per 10 s — never shared between people');
{
  await scenario();
  const searches = () => HL.calls.filter((c) => c.path === '/opportunities/search');
  const a = await myOrders('tok-thandi-w');
  const n1 = searches().length;
  const b = await myOrders('tok-thandi-w2', '', { keepThrottle: true });
  ok(searches().length === n1 && b.status === 200 && b.t === a.t, 'a second look within 10 s (even from her other session) reads no HighLevel — the same answer from her own cache', (searches().length - n1) + ' reads');
  const s = await myOrders('tok-sipho-w', '', { keepThrottle: true });
  const sq = searches().slice(n1);
  ok(sq.length === 1 && sq[0].query.contact_id === T.siContact && !/Thandi|109\.80|Ready for Collection|no onions/.test(s.t), 'sipho, inside the same 10 s, gets HIS own read — her cache is never his', JSON.stringify(sq.map((x) => x.query.contact_id)) + ' ' + s.t.slice(0, 80));
  const late = T.th[2]; late.hl_opportunity_id = 'op-late'; late.hl_state = 'written';
  const c = await myOrders('tok-thandi-w', '', { keepThrottle: true });
  const o0 = ords(c)[0];
  ok(o0 && o0.stage === null && /updated a moment ago/i.test(o0.stage_note || '') && searches().length === n1 + 1, 'within the window, a card her cache has not seen yet says "updated a moment ago" (no read)', JSON.stringify(o0));
  CLOCK += 11000;
  await myOrders('tok-thandi-w', '', { keepThrottle: true });
  ok(searches().length === n1 + 2, 'after 10 s she reads HighLevel again', String(searches().length - n1));
  late.hl_opportunity_id = null; late.hl_state = 'failed';
}
head('R8 (L4) · a HighLevel error that quotes her typed name is stored without it');
{
  CLOCK = at('07:00'); resetWorld(); F.hlEchoName = true;
  await placeOrder('tok-thandi-w', 'thandi');
  const r = rowsOf('thandi')[0] || {};
  ok(r.hl_state === 'failed' && r.hl_error && /firstName/.test(r.hl_error) && !/Thandi|Mokoena/i.test(r.hl_error), 'hl_error keeps the field names, never the typed first or last name', r.hl_error);
}
head('R9 (L5) · the Wimpy cron\'s failure log carries no secret and no phone number');
{
  CLOCK = at('07:00'); resetWorld(); F.ordersSelectFail = true;
  const before = LOGS.length;
  await cron('7,27,47 * * * *');
  const lines = LOGS.slice(before).filter((l) => /wimpy:cron/.test(l));
  ok(lines.length === 1 && /failed/.test(lines[0]) && !SECRETS_AND_PHONES.some((x) => lines[0].includes(x)), 'a failing ledger read is logged, redacted', lines.join(' | '));
}
head('R10 (L6) · the contact carries the CB number as a tag');
{
  CLOCK = at('07:00'); resetWorld();
  await placeOrder('tok-thandi-w', 'thandi');
  await placeOrder('tok-mgr-w', 'mgr');
  ok(HL.contacts.length === 2 && JSON.stringify(HL.contacts[0].tags) === '["wimpy","cb901"]' && JSON.stringify(HL.contacts[1].tags) === '["wimpy","mgr.lee"]',
    'tags ["wimpy","cb901"] — and a manager\'s username ("mgr.lee") — on contact creation', JSON.stringify(HL.contacts.map((c) => c.tags)));
}
console.log('  (measured subrequests — order: ' + measured.order.join(', ') + ' · history: ' + measured.history.join(', ') + ' · Wimpy cron: ' + measured.cron.join(', ') + ')');

head('SC-005 · no secret and no phone number in any log line the Worker wrote during this run');
{
  const leaked = LOGS.filter((l) => SECRETS_AND_PHONES.some((s) => l.includes(s)));
  ok(LOGS.length > 0 && !leaked.length, LOGS.length + ' log lines, none carries the key, the location id or a phone number', leaked.slice(0, 3).join(' | '));
  const src = ['src/wimpy.mjs', 'src/wimpy-hl.mjs', 'src/app.mjs', 'src/auth.mjs', 'src/server.mjs', 'src/net.mjs', 'api/index.mjs', 'vercel.json', 'Dockerfile', 'docker-compose.yml', 'package.json'].map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  ok(!/pit-[0-9a-f]{8}-/i.test(src) && !/(WIMPY_HL_(API_KEY|LOCATION_ID)|SUPABASE_SECRET_KEY|CRON_SECRET)\s*[=:]\s*["'][^"']+/.test(src), 'the service source, vercel.json, Dockerfile and compose hold no key, secret or location value — only the NAMES');
  ok(!fs.existsSync(path.join(ROOT, '.env')) || /^\.env$/m.test(fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8')), 'a filled .env, if one exists, is git-ignored');
}
useRealClock();

/* ════════════════════ T011 · the real page in Chromium ════════════════════ */
head('T011 · wimpy/index.html — "My orders", in a real Chromium against a stubbed Worker');
{
  const html = fs.readFileSync(WIMPY_PAGE, 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((x) => x[1]).join('\n');
  const code = scripts.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1').replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g, '""');
  const es6 = [];
  if (/=>/.test(code)) es6.push('=>'); if (/\b(let|const)\s+[A-Za-z_$]/.test(code)) es6.push('let/const'); if (/`/.test(code)) es6.push('template literal');
  if (/\.\.\.[A-Za-z_$[]/.test(code)) es6.push('spread'); if (/\bclass\s+[A-Z]/.test(code)) es6.push('class'); if (/\b(var|let|const)\s*[{[]/.test(code)) es6.push('destructuring');
  ok(!es6.length, 'the page script is plain ES5 (no arrows, let/const, template literals, spread, classes, destructuring)', es6.join(', '));
  ok(!/leadconnector|WIMPY_HL|pit-|loc-test/i.test(html), 'the page holds nothing of HighLevel — no host, no secret name, no key');
  ok(/\/api\/wimpy\/orders/.test(html), 'the page asks the Worker for /api/wimpy/orders');

  const W = SRC('wimpy.mjs');
  const { wimpyMenu } = await import(W);
  const { chromium } = await (await import('./_harness.mjs')).playwright();
  const srv = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html' }); r.end(html); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const OPEN = RealDate.parse('2026-10-08T08:00:00+02:00'), SHUT = RealDate.parse('2026-10-08T18:00:00+02:00');
  const PEOPLE = {
    'thandi-pass-1': { token: 'tokThandi', user: { username: 'cb901', full_name: 'Thandi Mokoena', cb: 'CB901', scope: 'wimpy' } },
    'sipho-pass-1': { token: 'tokSipho', user: { username: 'cb902', full_name: 'Sipho Dlamini', cb: 'CB902', scope: 'wimpy' } },
  };
  const HIST = {
    tokThandi: { since: '2026-10-08', stages_available: true, orders: [
      { placed_at: '2026-10-08T11:15:00+02:00', total: '82.90', notes: null, items: [{ item: 'Bacon & Cheese Burger', quantity: 1, item_total: '82.90' }], stage: null, stage_note: 'Not on the kitchen board yet' },
      { placed_at: '2026-10-08T10:30:00+02:00', total: '109.80', notes: '<b>no onions</b> please', items: [{ item: 'Cheese Burger', quantity: 2, item_total: '109.80' }], stage: 'Ready for Collection', stage_note: null }] },
    tokSipho: { since: '2026-10-08', stages_available: true, orders: [] },
  };
  /* what ONLY her history can put on a screen (item names and unit prices are on the menu itself, so they prove nothing) */
  const THANDI_BITS = ['no onions', 'Ready for Collection', 'Not on the kitchen board yet', '109.80', '11:15', 'Thu 8 Oct'];
  let menuAt = OPEN, ordersCalls = 0, ordersUrls = [], ordersStatus = 200, ordersDelay = 0;
  const b = await chromium.launch();
  const errs = [];
  async function fresh() {
    const pg = await b.newPage();
    pg.on('pageerror', (e) => errs.push(String(e)));
    await pg.route('**/api/**', async (route) => {   // same origin: the page calls /api/… on itself
      const u = new URL(route.request().url()), auth = route.request().headers().authorization || '';
      const J = (o, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) });
      const who = Object.values(PEOPLE).filter((x) => 'Bearer ' + x.token === auth)[0];
      if (u.pathname === '/api/wimpy/signin') { const p = PEOPLE[(JSON.parse(route.request().postData() || '{}')).password]; return p ? J(p) : J({ error: 'That CB number and password do not match.' }, 401); }
      if (u.pathname === '/api/wimpy/me') return who ? J({ user: who.user }) : J({ error: 'no session' }, 401);
      if (u.pathname === '/api/wimpy/menu') return J(wimpyMenu(menuAt));
      if (u.pathname === '/api/wimpy/orders') {
        ordersCalls++; ordersUrls.push(u.href);
        const tok = who && who.token, st = ordersStatus, body = tok ? HIST[tok] : { error: 'Sign in required.' };
        if (ordersDelay) await new Promise((r) => setTimeout(r, ordersDelay));
        return st !== 200 ? J({ error: 'Sign in required.' }, st) : who ? J(body) : J({ error: 'Sign in required.' }, 401);
      }
      if (u.pathname === '/api/wimpy/order') return J({ ok: true, total_price: 54.9, order_formatted: 'WIMPY ORDER' });
      return J({ ok: true });
    });
    await pg.goto('http://127.0.0.1:' + port + '/', { waitUntil: 'domcontentloaded' });
    await pg.waitForSelector('#cb', { timeout: 20000 });
    return pg;
  }
  const signIn = async (pg, cb, pw) => { await pg.fill('#cb', cb); await pg.fill('#pw', pw); await pg.click('#go'); await pg.waitForSelector('.wp-grid', { timeout: 20000 }); };
  const bodyText = (pg) => pg.evaluate(() => document.body.innerText);
  try {
    /* the menu (window open): the button is there, and nothing was fetched until it is pressed */
    {
      menuAt = OPEN; ordersCalls = 0; ordersUrls = [];
      const pg = await fresh();
      await signIn(pg, 'CB901', 'thandi-pass-1');
      ok(!!(await pg.$('#wpMine')), 'the menu (ordering open) has a "My orders" button (#wpMine)');
      ok(ordersCalls === 0, 'signing in and reading the menu never asks for the history on its own', String(ordersCalls));
      await pg.click('#wpMine');
      await pg.waitForSelector('.wp-hist', { timeout: 10000 });
      await pg.waitForSelector('.wp-order', { timeout: 10000 });
      const t = await bodyText(pg);
      ok(/My orders/.test(t) && /History starts 8 October 2026/.test(t), 'the view says "My orders" and "History starts 8 October 2026" (from the Worker\'s since)', t.replace(/\s+/g, ' ').slice(0, 200));
      const cards = await pg.evaluate(() => [...document.querySelectorAll('.wp-order')].map((e) => e.innerText.replace(/\s+/g, ' ').trim()));
      ok(cards.length === 2 && /Thu 8 Oct/.test(cards[0]) && /11:15/.test(cards[0]) && /10:30/.test(cards[1]), 'two orders, newest first, each with its SA date and time', JSON.stringify(cards));
      ok(/1 × Bacon & Cheese Burger/.test(cards[0]) && /R82\.90/.test(cards[0]) && /2 × Cheese Burger/.test(cards[1]) && /R109\.80/.test(cards[1]), '…each item with its quantity, and the total', JSON.stringify(cards));
      const chips = await pg.evaluate(() => [...document.querySelectorAll('.wp-order .wp-stage')].map((e) => e.innerText.trim()));
      ok(chips[0] === 'Not on the kitchen board yet' && chips[1] === 'Ready for Collection', 'a stage chip on each: the kitchen\'s stage, or the plain note', JSON.stringify(chips));
      const notesHtml = await pg.evaluate(() => (document.querySelectorAll('.wp-order')[1] || {}).innerHTML || '');
      ok(/&lt;b&gt;no onions&lt;\/b&gt; please/.test(notesHtml) && !/<b>no onions/.test(notesHtml), 'her typed notes are shown as text, never as markup', notesHtml.slice(0, 200));
      ok(ordersUrls.length === 1 && !ordersUrls[0].includes('?'), 'the request is GET /api/wimpy/orders with no query string — the session decides', ordersUrls.join(' '));
      HIST.tokThandi.orders[1].stage = 'Completed';
      await pg.click('#wpHistRefresh');
      await pg.waitForFunction(() => /Completed/.test(document.body.innerText), null, { timeout: 10000 }).catch(() => {});
      ok(ordersCalls === 2 && /Completed/.test(await bodyText(pg)), 'Refresh asks again and shows the stage the kitchen moved it to', ordersCalls + ' calls');
      HIST.tokThandi.orders[1].stage = 'Ready for Collection';
      await pg.click('#wpHistBack');
      await pg.waitForSelector('.wp-grid', { timeout: 10000 });
      ok(!(await pg.$('.wp-hist')), 'Back returns to the menu');
      await pg.close();
    }
    /* the closed-window screen has it too */
    {
      menuAt = SHUT;
      const pg = await fresh();
      await signIn(pg, 'CB901', 'thandi-pass-1');
      ok(/Ordering is closed/.test(await bodyText(pg)) && !!(await pg.$('#wpMine')), 'outside 07:00–09:00 the (closed) menu still has "My orders"');
      await pg.click('#wpMine');
      await pg.waitForSelector('.wp-order', { timeout: 10000 });
      ok((await pg.$$('.wp-order')).length === 2, '…and it opens the same history');
      await pg.close();
      menuAt = OPEN;
    }
    /* empty state */
    {
      const pg = await fresh();
      await signIn(pg, 'CB902', 'sipho-pass-1');
      await pg.click('#wpMine');
      await pg.waitForSelector('.wp-hist-empty', { timeout: 10000 });
      const t = await bodyText(pg);
      ok(/You have no orders yet/.test(t) && /History starts 8 October 2026/.test(t), 'no orders → "You have no orders yet" and when history starts', t.replace(/\s+/g, ' ').slice(0, 200));
      await pg.close();
    }
    /* A4: thandi signs out at a shared desk, sipho signs in — nothing of hers, at any point */
    {
      const pg = await fresh();
      await signIn(pg, 'CB901', 'thandi-pass-1');
      await pg.click('#wpMine'); await pg.waitForSelector('.wp-order', { timeout: 10000 });
      await pg.click('#out'); await pg.waitForSelector('#cb', { timeout: 10000 });
      const out = await bodyText(pg);
      const mem = await pg.evaluate(() => JSON.stringify({ h: typeof WHIST === 'undefined' ? 'absent' : WHIST }));
      ok(!THANDI_BITS.some((x) => out.includes(x)) && /Signed out/.test(out), 'sign-out: the screen holds nothing of her orders', out.slice(0, 160));
      ok(mem === '{"h":null}', '…and the page\'s memory of them is cleared (wReset)', mem.slice(0, 160));
      await signIn(pg, 'CB902', 'sipho-pass-1');
      const menuT = await bodyText(pg);
      await pg.click('#wpMine'); await pg.waitForSelector('.wp-hist-empty', { timeout: 10000 });
      const histT = await bodyText(pg);
      ok(!THANDI_BITS.some((x) => menuT.includes(x) || histT.includes(x)) && !(await pg.$('.wp-order')),'the next person (sipho) sees none of hers — on the menu or in My orders', histT.replace(/\s+/g, ' ').slice(0, 160));
      await pg.close();
    }
    /* a reply that arrives AFTER sign-out is never shown to the next person */
    {
      const pg = await fresh();
      await signIn(pg, 'CB901', 'thandi-pass-1');
      ordersDelay = 1500;
      await pg.click('#wpMine');
      await pg.click('#out'); await pg.waitForSelector('#cb', { timeout: 10000 });
      ordersDelay = 0;
      await signIn(pg, 'CB902', 'sipho-pass-1');
      await pg.waitForTimeout(2200);
      const t = await bodyText(pg);
      const mem = await pg.evaluate(() => JSON.stringify(typeof WHIST === 'undefined' ? 'absent' : WHIST));
      ok(!THANDI_BITS.some((x) => t.includes(x)) && !(await pg.$('.wp-order')), 'her slow history reply, landing after she signed out, never paints for sipho', t.replace(/\s+/g, ' ').slice(0, 160));
      ok(mem === 'null', '…and never even reaches the page\'s memory (the sign-out epoch drops it)', mem.slice(0, 160));
      await pg.close();
    }
    /* a 401 on the history (session expired) → back to sign-in, nothing kept */
    {
      const pg = await fresh();
      await signIn(pg, 'CB901', 'thandi-pass-1');
      ordersStatus = 401;
      await pg.click('#wpMine');
      await pg.waitForSelector('#cb', { timeout: 10000 });
      ordersStatus = 200;
      const t = await bodyText(pg);
      const mem = await pg.evaluate(() => JSON.stringify({ h: typeof WHIST === 'undefined' ? 'absent' : WHIST, t: (function () { try { return sessionStorage.getItem('cbx_wimpy_token'); } catch (e) { return 'err'; } })() }));
      ok(!THANDI_BITS.some((x) => t.includes(x)) && mem === '{"h":null,"t":null}', 'a 401 on My orders → the sign-in screen, history and token cleared', mem);
      await pg.close();
    }
    /* stages unavailable → a plain banner, the orders still listed */
    {
      const pg = await fresh();
      await signIn(pg, 'CB901', 'thandi-pass-1');
      HIST.tokThandi.stages_available = false;
      await pg.click('#wpMine'); await pg.waitForSelector('.wp-order', { timeout: 10000 });
      HIST.tokThandi.stages_available = true;
      const t = await bodyText(pg);
      ok(/kitchen stages are not available right now/i.test(t) && (await pg.$$('.wp-order')).length === 2, 'stages_available: false → a plain note above the list, the orders still shown', t.replace(/\s+/g, ' ').slice(0, 200));
      await pg.close();
    }
    ok(errs.length === 0, 'the page ran with no errors', errs[0]);
  } catch (e) {
    ok(false, 'the My orders flow ran to its end', String(e && e.message || e).slice(0, 300));
  } finally { await b.close(); srv.close(); }
}

/* ════════════════════ summary ════════════════════ */
console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
process.exit(fail ? 1 : 0);
