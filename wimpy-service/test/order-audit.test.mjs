#!/usr/bin/env node
/**
 * order-audit.test.mjs — every order that does not go through leaves a row; no screen is silent or misleading
 * (2026-11-24, after the kitchen-board investigation; Nick: "fix whatever is not working for the wimpy").
 *
 *   node test/order-audit.test.mjs   (or npm test)
 *
 *   A · submitWimpyOrder writes ONE auth_log row per outcome — wimpy_order_refused:<reason> at every early return,
 *       wimpy_order_ok on success — after the reply (waitUntil), never delaying or changing it, never throwing,
 *       never carrying a phone number or a typed name
 *   B · POST /api/wimpy/order with no valid session → wimpy_order_refused:no_session (+ the address); other routes write none
 *   C · the new events are invisible to every lockout / per-network limit / sign-in count (the real sign-in, and every
 *       auth_log event filter in the service, the Worker and tools/)
 *   D · cb NULL + a CB-shaped username can order ("CB436" vs "cb436")
 *   E · the kitchen timeout: 20 s, inside the function's 30 s
 *   F · the page, in Chromium against stubs: a dead session never silently signs out; the order is said NOT sent and is
 *       kept for the same person only; a password change returns to the menu; no "press Retry" without a Retry button
 * Nothing leaves this process: Supabase and the kitchen are stubs; HighLevel is never called.
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVICE = path.resolve(HERE, '..');
const REPO = path.resolve(SERVICE, '..');
const SRC = (rel) => pathToFileURL(path.join(SERVICE, 'src', rel)).href;

let pass = 0, fail = 0;
const ok = (c, n, extra) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (extra !== undefined ? ' — ' + String(extra).slice(0, 300) : '')); } };
const head = (t) => console.log('\n' + t);

const W = await import(SRC('wimpy.mjs'));
const APP = await import(SRC('app.mjs'));
const AUTH = await import(SRC('auth.mjs'));
const { submitWimpyOrder, whoIsOrdering, todaysBigOne, wimpyMenu, KITCHEN_TIMEOUT_MS, ORDER_OK_EVENT, ORDER_REFUSED_EVENT } = W;

/* a Wednesday, 08:00 SAST — inside the 07:00–10:30 window; and 11:00 SAST, outside it */
const IN = Date.parse('2026-11-25T06:00:00Z'), OUT = Date.parse('2026-11-25T09:00:00Z');

/* ── the stubbed world: PostgREST (auth_log, wimpy_orders, rules, app_users, app_sessions) and the kitchen ── */
const T = { auth_log: [], wimpy_orders: [], rules: [], app_users: [], app_sessions: [] };
let KITCHEN = { mode: 200 }, kitchenCalls = 0, authLogMode = 'ok', otherCalls = [];
const J = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
function match(row, sp) {
  for (const [col, raw] of sp.entries()) {
    if (['select', 'order', 'limit', 'offset'].includes(col)) continue;
    const i = raw.indexOf('.'), op = raw.slice(0, i), v = raw.slice(i + 1), x = row[col];
    if (op === 'eq' && String(x) !== v) return false;
    if (op === 'neq' && String(x) === v) return false;
    if (op === 'ilike' && String(x || '').toLowerCase() !== v.toLowerCase()) return false;
    if (op === 'gte' && !(Date.parse(x) >= Date.parse(v))) return false;
    if (op === 'like' && !String(x || '').startsWith(v.replace(/\*$/, ''))) return false;
  }
  return true;
}
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, o = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  const method = (o.method || 'GET').toUpperCase();
  if (url.host === 'kitchen.local') {
    kitchenCalls++;
    if (KITCHEN.mode === 'throw') throw new Error('getaddrinfo ENOTFOUND kitchen.local');
    if (KITCHEN.mode === 'hang') return new Promise((res, rej) => o.signal && o.signal.addEventListener('abort', () => rej(new Error('This operation was aborted'))));
    return new Response('{"ok":true}', { status: KITCHEN.mode });
  }
  if (url.host === 'stub.local') {
    const t = url.pathname.replace('/rest/v1/', '');
    if (t === 'auth_log' && method === 'POST') {
      if (authLogMode === 'hang') return new Promise(() => {});
      if (authLogMode === 'fail') return new Response('boom', { status: 500 });
    }
    const tab = T[t];
    if (!tab) { otherCalls.push(method + ' ' + t); return J([]); }
    if (method === 'GET') { let rows = tab.filter((r) => match(r, url.searchParams));
      if (t === 'app_sessions') rows = rows.map((s) => ({ ...s, app_users: T.app_users.find((u) => u.id === s.user_id) }));
      if (url.searchParams.get('order')) rows = rows.slice().sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
      return J(rows); }
    if (method === 'POST') { const rows = (JSON.parse(o.body)).map((r) => ({ id: 'id' + Math.random().toString(36).slice(2), at: new Date().toISOString(), ...r })); tab.push(...rows); return J(rows, 201); }
    if (method === 'PATCH') { tab.filter((r) => match(r, url.searchParams)).forEach((r) => Object.assign(r, JSON.parse(o.body))); return new Response(null, { status: 204 }); }
    if (method === 'DELETE') { T[t] = tab.filter((r) => !match(r, url.searchParams)); return J([]); }
    return J([]);
  }
  if (url.hostname === '127.0.0.1') return realFetch(input, o);
  throw new Error('BLOCKED outbound fetch to ' + url.host);
};
const ENV = { SUPABASE_URL: 'http://stub.local', SUPABASE_SECRET_KEY: 'svc', WIMPY_WEBHOOK_URL: 'http://kitchen.local/hook' };
let pending = [];
const ctx = { waitUntil: (p) => { pending.push(Promise.resolve(p)); } };
const settle = async () => { const p = pending; pending = []; await Promise.all(p); };
const USER = { user_id: 'u-1', username: 'cb999', cb: 'CB999', full_name: 'Ann Smith' };
const PHONE = '082 555 0199';
const BODY = (over = {}) => ({ who: { cb: 'CB999', first_name: 'Annabel', surname: 'Smithers', phone: PHONE, ...(over.who || {}) },
  total_price: 0, order: { items: over.items || [{ id: todaysBigOne(IN).id, quantity: 1 }], additional_notes: '' } });
const events = () => T.auth_log.map((r) => r.event);
const reset = () => { T.auth_log = []; T.wimpy_orders = []; kitchenCalls = 0; KITCHEN = { mode: 200 }; authLogMode = 'ok'; pending = []; };

/* the 20 s abort fires at once in the timeout case — every other timer is left alone */
async function withFastKitchenTimeout(fn) {
  const real = globalThis.setTimeout;
  globalThis.setTimeout = (f, ms, ...a) => real(f, ms === KITCHEN_TIMEOUT_MS ? 5 : ms, ...a);
  try { return await fn(); } finally { globalThis.setTimeout = real; }
}

head('A · one audit row per order outcome, after the reply, never in its way');
const CASES = [
  ['window closed', () => submitWimpyOrder(ENV, USER, BODY(), OUT, ctx, '10.0.0.7'), 'window_closed', 403],
  ['CB of somebody else', () => submitWimpyOrder(ENV, USER, BODY({ who: { cb: 'CB998' } }), IN, ctx, '10.0.0.7'), 'cb_mismatch', 400],
  ['no CB typed', () => submitWimpyOrder(ENV, USER, BODY({ who: { cb: '' } }), IN, ctx, '10.0.0.7'), 'cb_missing', 400],
  ['bad name', () => submitWimpyOrder(ENV, USER, BODY({ who: { first_name: 'A1' } }), IN, ctx, '10.0.0.7'), 'name', 400],
  ['bad surname', () => submitWimpyOrder(ENV, USER, BODY({ who: { surname: 'X' } }), IN, ctx, '10.0.0.7'), 'surname', 400],
  ['no phone', () => submitWimpyOrder(ENV, USER, BODY({ who: { phone: '' } }), IN, ctx, '10.0.0.7'), 'phone_missing', 400],
  ['bad phone', () => submitWimpyOrder(ENV, USER, BODY({ who: { phone: '12345' } }), IN, ctx, '10.0.0.7'), 'phone_invalid', 400],
  ['empty cart', () => submitWimpyOrder(ENV, USER, BODY({ items: [] }), IN, ctx, '10.0.0.7'), 'cart_empty', 400],
  ['unknown item', () => submitWimpyOrder(ENV, USER, BODY({ items: [{ id: 'nope', quantity: 1 }] }), IN, ctx, '10.0.0.7'), 'item_unknown', 400],
  ['quantity 99', () => submitWimpyOrder(ENV, USER, BODY({ items: [{ id: 'mzansi_brekkie', quantity: 99 }] }), IN, ctx, '10.0.0.7'), 'item_quantity', 400],
  ['kitchen answers 503', () => { KITCHEN.mode = 503; return submitWimpyOrder(ENV, USER, BODY(), IN, ctx, '10.0.0.7'); }, 'kitchen_status:503', 502],
  ['kitchen unreachable', () => { KITCHEN.mode = 'throw'; return submitWimpyOrder(ENV, USER, BODY(), IN, ctx, '10.0.0.7'); }, 'kitchen_unreachable', 502],
  ['kitchen times out', () => { KITCHEN.mode = 'hang'; return withFastKitchenTimeout(() => submitWimpyOrder(ENV, USER, BODY(), IN, ctx, '10.0.0.7')); }, 'kitchen_timeout', 502],
];
for (const [name, run, reason, status] of CASES) {
  reset();
  const r = await run();
  await settle();
  const ev = events();
  ok(r.status === status && ev.length === 1 && ev[0] === ORDER_REFUSED_EVENT + ':' + reason, name + ' → ' + status + ' and ONE row wimpy_order_refused:' + reason, r.status + ' ' + JSON.stringify(ev));
  const row = T.auth_log[0] || {};
  ok(row.user_id === 'u-1' && row.username === 'cb999' && row.ip === '10.0.0.7', '…with user_id, username and the address', JSON.stringify(row));
  const dump = JSON.stringify(T.auth_log.map(({ id, at, ...rest }) => rest));   // what was written (the stub's id/at are its own)
  ok(!/555|0199|Annabel|Smithers/.test(dump), '…and no phone number or typed name in it', dump);
}
reset();
{
  const r = await submitWimpyOrder(ENV, USER, BODY(), IN, ctx, '10.0.0.7');
  await settle();
  ok(r.status === 200 && JSON.stringify(events()) === JSON.stringify([ORDER_OK_EVENT]), 'a sent order → 200 and ONE row wimpy_order_ok', JSON.stringify(events()));
  ok(T.wimpy_orders.length === 1, '…and the ledger row as before');
}
{ reset(); KITCHEN.mode = 500; const r = await submitWimpyOrder(ENV, USER, BODY(), IN, ctx);
  ok(/press Confirm & send again/.test(r.body.error) && !/Retry/.test(r.body.error), 'a kitchen error says "press Confirm & send again" — there is no Retry button to press', r.body.error); }
{ reset(); KITCHEN.mode = 'hang'; const r = await withFastKitchenTimeout(() => submitWimpyOrder(ENV, USER, BODY(), IN, ctx));
  ok(/may already have it/.test(r.body.error) && /before you press Confirm & send again/.test(r.body.error) && /20 seconds/.test(r.body.error), 'a timeout says the kitchen may already have it and to check BEFORE sending again', r.body.error);
  ok(T.wimpy_orders.length === 0 && kitchenCalls === 1, '…one kitchen call, no ledger row, no automatic resend'); }
{ reset(); authLogMode = 'hang';
  const t0 = Date.now(); const r = await submitWimpyOrder(ENV, USER, BODY({ who: { cb: 'CB998' } }), IN, ctx);
  ok(r.status === 400 && Date.now() - t0 < 2000, 'an audit insert that never answers does not hold the reply', (Date.now() - t0) + ' ms');
  pending = []; }
{ reset(); authLogMode = 'fail';
  const r = await submitWimpyOrder(ENV, USER, BODY(), IN, ctx); let threw = false;
  try { await settle(); } catch (e) { threw = true; }
  ok(r.status === 200 && r.body.ok === true && !threw, 'an audit insert that fails changes nothing — the order still reads sent, nothing throws'); }
{ reset(); const r = await submitWimpyOrder({}, USER, BODY({ who: { cb: 'CB998' } }), IN, null);
  ok(r.status === 400 && T.auth_log.length === 0, 'no database configured (the pure suites) → nothing written, nothing thrown'); }
{ reset(); const r = await submitWimpyOrder(ENV, USER, BODY({ who: { cb: 'CB998' } }), IN, null, '');
  await new Promise((res) => setTimeout(res, 50));
  ok(r.status === 400 && events()[0] === 'wimpy_order_refused:cb_mismatch', 'no ctx (a direct call) → the row is still written, fire-and-forget'); }

head('B · POST /api/wimpy/order with no valid session → wimpy_order_refused:no_session');
async function call(p, { method = 'POST', bearer = null, body = {} } = {}) {
  const h = { 'Content-Type': 'application/json', 'x-forwarded-for': '41.1.2.3' };
  if (bearer) h.Authorization = 'Bearer ' + bearer;
  const r = await APP.handle(new Request('http://wimpy.test' + p, { method, headers: h, body: method === 'GET' ? undefined : JSON.stringify(body) }), { ...ENV, TRUST_PROXY: '1' }, ctx);
  await settle();
  return r;
}
reset();
{ const r = await call('/api/wimpy/order', { body: BODY() });
  ok(r.status === 401 && JSON.stringify(events()) === '["wimpy_order_refused:no_session"]' && T.auth_log[0].ip === '41.1.2.3' && T.auth_log[0].user_id == null, 'no bearer → 401 and one no_session row with the address', JSON.stringify(T.auth_log)); }
reset();
{ const r = await call('/api/wimpy/order', { bearer: 'not-a-real-token', body: BODY() });
  ok(r.status === 401 && JSON.stringify(events()) === '["wimpy_order_refused:no_session"]', 'an unknown or expired token → the same', JSON.stringify(events())); }
reset();
{ const r1 = await call('/api/wimpy/menu', { method: 'GET' }); const r2 = await call('/api/wimpy/orders', { method: 'GET' });
  ok(r1.status === 401 && r2.status === 401 && T.auth_log.length === 0, 'no session on the menu or My orders → no order row (those are not orders)'); }
ok(kitchenCalls === 0, 'no kitchen call was made for any refused request');

head('C · the new events are not sign-in failures — anywhere');
const NEW_EVENTS = [ORDER_OK_EVENT, ...CASES.map((c) => ORDER_REFUSED_EVENT + ':' + c[2]), ORDER_REFUSED_EVENT + ':no_session'];
ok(NEW_EVENTS.every((e) => !/^(login_|locked|wimpy_signin|human_check|logout|password_|pw_change)/.test(e)), 'no new event starts with a sign-in / lock / password prefix', NEW_EVENTS.join(','));
{
  /* every auth_log event filter in the code that reads auth_log — service, Worker, tools — and the shared lock tally */
  const files = [];
  const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name);
    if (f.isDirectory()) { if (!/node_modules|scratch/.test(f.name)) walk(p); } else if (/\.(mjs|js)$/.test(f.name)) files.push(p); } };
  for (const d of [path.join(SERVICE, 'src'), path.join(REPO, 'worker', 'src'), path.join(REPO, 'tools')]) if (fs.existsSync(d)) walk(d);
  const filters = [];
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/auth_log\?[^`'"]*/g)) for (const e of m[0].matchAll(/event[=.](?:eq|like)\.([A-Za-z_:*${}()'.+ ]+)/g)) filters.push([path.relative(REPO, f), e[1]]);
    for (const m of src.matchAll(/event\.like\.([a-z_:]+)\*/g)) filters.push([path.relative(REPO, f), m[1] + '*']);
    for (const line of src.split('\n').filter((l) => l.includes('auth_log?')))
      for (const m of line.matchAll(/event=(?:like|eq)\.\$\{encodeURIComponent\('([a-z_:*]+)'\)\}/g)) filters.push([path.relative(REPO, f), m[1]]);
  }
  const plain = filters.map(([f, x]) => [f, x.replace(/\$\{encodeURIComponent\('([^']+)'\)\}/, '$1')]).filter(([, x]) => /^[a-z_:]+\*?$/.test(x));
  ok(plain.length >= 4, 'found the auth_log event filters (' + plain.length + '): ' + [...new Set(plain.map((p) => p[1]))].join(' '), JSON.stringify(filters));
  const hits = [];
  for (const [f, x] of plain) for (const e of NEW_EVENTS) if (x.endsWith('*') ? e.startsWith(x.slice(0, -1)) : e === x) hits.push(f + ' ' + x + ' ← ' + e);
  ok(!hits.length, 'none of those filters matches a new event', hits.join(' | '));
}
{
  /* the real Wimpy sign-in: 60 order refusals in the last minutes neither lock the account nor close the network */
  T.auth_log = []; T.app_sessions = [];
  T.app_users = [{ id: 'u-1', username: 'cb999', cb: 'CB999', full_name: 'Ann Smith', role: 'agent', apps: ['wimpy'], active: true, password_hash: 'x', wimpy_password_hash: null, failed_attempts: 0, locked_until: null }];
  for (let i = 0; i < 150; i++) T.auth_log.push({ user_id: i < 50 ? 'u-1' : null, username: 'cb999', event: 'wimpy_order_refused:cb_mismatch', ip: '41.1.2.3', at: new Date(Date.now() - 60000).toISOString() });
  const req = (pw) => new Request('http://wimpy.test/api/wimpy/signin', { method: 'POST', headers: { 'x-forwarded-for': '41.1.2.3' } });
  const r1 = await AUTH.signinWimpy(APP.db ? APP.db(ENV) : (await import(SRC('db.mjs'))).db(ENV), req(), { cb: 'CB999', password: 'wrong-one' }, ctx, { TRUST_PROXY: '1' });
  await settle();
  ok(r1.status === 401, '150 order refusals from one network do not trip the 100-per-network sign-in limit (429)', r1.status + ' ' + r1.error);
  ok(!T.app_users[0].locked_until && T.app_users[0].failed_attempts === 1, '50 order refusals on the account do not count toward its lock — one wrong password is one failure', JSON.stringify({ l: T.app_users[0].locked_until, f: T.app_users[0].failed_attempts }));
  const r2 = await AUTH.signinWimpy((await import(SRC('db.mjs'))).db(ENV), req(), { cb: 'CB999', password: 'wimpy123' }, ctx, { TRUST_PROXY: '1' });
  await settle();
  ok(r2.ok === true, '…and the right password still signs in', JSON.stringify(r2).slice(0, 120));
}

head('D · an account with cb NULL and a CB-shaped username can order (2026-11-24 latent bug)');
{
  const noCb = { username: 'cb436', cb: null, full_name: 'Thabo Mokoena' };
  const base = { first_name: 'Thabo', surname: 'Mokoena', phone: '0821234567' };
  for (const typed of ['CB436', 'cb436', '436', 'CB 436', 'CB-0436'])
    ok(!whoIsOrdering(noCb, { ...base, cb: typed }).error && whoIsOrdering(noCb, { ...base, cb: typed }).cb === 'CB436', 'cb NULL, username cb436, typed "' + typed + '" → ordered as CB436', JSON.stringify(whoIsOrdering(noCb, { ...base, cb: typed })));
  ok(whoIsOrdering(noCb, { ...base, cb: 'CB437' }).code === 'cb_mismatch', '…another CB is still refused');
  const mgr = { username: 'dalwin', cb: null, full_name: 'Dalwin Naidoo' };
  ok(whoIsOrdering(mgr, { ...base, cb: 'DALWIN' }).cb === 'dalwin', 'a manager typing the username (the page upper-cases it) still orders as "dalwin"');
  ok(whoIsOrdering(mgr, { ...base, cb: 'CB1' }).code === 'cb_mismatch', '…and cannot invent a CB number');
  reset();
  const r = await submitWimpyOrder(ENV, { user_id: 'u-9', ...noCb }, { who: { ...base, cb: 'CB436' }, order: { items: [{ id: 'mzansi_brekkie', quantity: 1 }] } }, IN, ctx);
  await settle();
  ok(r.status === 200 && T.wimpy_orders[0] && T.wimpy_orders[0].cb === 'CB436', 'end to end: the order goes through and the ledger row says CB436', r.status + ' ' + JSON.stringify(T.wimpy_orders[0] && T.wimpy_orders[0].cb));
}

head('E · the kitchen wait fits inside the function');
ok(KITCHEN_TIMEOUT_MS === 20000, 'the kitchen timeout is 20 s (was 15 s; the slowest reply seen was 14 s)', KITCHEN_TIMEOUT_MS);
ok(APP.maxDuration === 30 && APP.config && APP.config.maxDuration === 30, 'the function asks for 30 s, in both forms Vercel reads');
ok(APP.maxDuration * 1000 - KITCHEN_TIMEOUT_MS >= 8000, '…leaving ≥ 8 s for the session read before and the ledger insert after (' + (APP.maxDuration - KITCHEN_TIMEOUT_MS / 1000) + ' s)');
{ const src = fs.readFileSync(path.join(SERVICE, 'src', 'wimpy.mjs'), 'utf8');
  ok(!/setTimeout\(\(\) => ctrl\.abort\(\), 15000\)/.test(src) && /ctrl\.abort\(\), KITCHEN_TIMEOUT_MS\)/.test(src), 'the abort uses KITCHEN_TIMEOUT_MS, not a typed 15000'); }

head('F · the page: no silent sign-out, no misleading screen (Chromium, stubbed service)');
{
  const { chromium } = await (await import('./_harness.mjs')).playwright();
  globalThis.fetch = realFetch;
  const PAGE_SRC = fs.readFileSync(path.join(SERVICE, 'public', 'index.html'), 'utf8');
  ok(!/press Retry/i.test(PAGE_SRC) && !/press Retry/i.test(fs.readFileSync(path.join(SERVICE, 'src', 'wimpy.mjs'), 'utf8')), 'no "press Retry" left in the page or the service (there is no Retry button)');
  const srv = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html' }); r.end(PAGE_SRC); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const BASE = 'http://127.0.0.1:' + srv.address().port + '/';
  const MENU = wimpyMenu(IN);   // window open
  const b = await chromium.launch();
  /* one scripted service per page: `orderReply` / `menuReply` / `histReply` / `pwReply` are swapped by each scenario */
  async function openPage(S) {
    const pg = await b.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(String(e)));
    await pg.route('**/api/**', async (route) => {
      const u = route.request().url(); const Jf = (o, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) });
      if (u.includes('/api/health')) return Jf({ ok: true, window: { hours: '07:00–10:30', days: 'Monday to Friday' } });
      if (u.includes('/api/wimpy/signin')) { const body = JSON.parse(route.request().postData() || '{}'); S.signins.push(body.cb);
        const who = S.accounts[String(body.cb).toUpperCase()]; return who ? Jf({ token: 'tok-' + body.cb, user: who }) : Jf({ error: 'That CB number and password do not match.' }, 401); }
      if (u.endsWith('/api/wimpy/me')) { const t = (route.request().headers().authorization || '').replace('Bearer tok-', ''); const who = S.accounts[String(t).toUpperCase()]; return who ? Jf({ user: who }) : Jf({ error: 'Sign in required.' }, 401); }
      if (u.includes('/api/wimpy/menu')) { const m = S.menuReply.shift(); return m ? Jf(m[0], m[1]) : Jf(MENU); }
      if (u.includes('/api/wimpy/orders')) { const m = S.histReply.shift(); return m ? Jf(m[0], m[1]) : Jf({ orders: [] }); }
      if (u.includes('/api/wimpy/password')) { const m = S.pwReply.shift(); return m ? Jf(m[0], m[1]) : Jf({ ok: true }); }
      if (u.includes('/api/wimpy/order')) { S.posted.push(JSON.parse(route.request().postData() || '{}')); const m = S.orderReply.shift(); return m ? Jf(m[0], m[1]) : Jf({ ok: true, total_price: 45.9, order_formatted: 'WIMPY ORDER' }); }
      if (u.includes('/api/wimpy/logout')) return Jf({ ok: true });
      return Jf({ ok: true });
    });
    await pg.goto(BASE, { waitUntil: 'domcontentloaded' });
    return { pg, errs };
  }
  const ANN = { username: 'cb999', full_name: 'Ann Smith', cb: 'CB999', role: 'agent', scope: 'wimpy', wimpy_password_is_default: true };
  const BOB = { username: 'cb555', full_name: 'Bob Jones', cb: 'CB555', role: 'agent', scope: 'wimpy' };
  const world = () => ({ accounts: { CB999: ANN, CB555: BOB }, signins: [], posted: [], orderReply: [], menuReply: [], histReply: [], pwReply: [] });
  const txt = (pg) => pg.evaluate(() => document.body.innerText);
  async function signIn(pg, cb) { await pg.waitForSelector('#cb'); await pg.fill('#cb', cb); await pg.fill('#pw', 'whatever-1'); await pg.click('#go'); }
  async function toConfirm(pg) {
    await pg.waitForSelector('[data-wadd="mzansi_brekkie"]'); await pg.click('[data-wadd="mzansi_brekkie"]'); await pg.click('[data-winc="0"]');
    await pg.click('#wpReview'); await pg.waitForSelector('#fph'); await pg.fill('#fph', '082 123 4567'); await pg.fill('#fnt', 'collect at reception');
    await pg.click('#of button[type=submit]'); await pg.waitForSelector('#wpSend');
  }
  try {
    /* F1 — the session ends exactly at Confirm & send */
    { const S = world(); S.orderReply.push([{ error: 'Sign in required.' }, 401]); const { pg, errs } = await openPage(S);
      await signIn(pg, 'CB999'); await toConfirm(pg); await pg.click('#wpSend'); await pg.waitForSelector('#cb');
      const t = await txt(pg);
      ok(/Your sign-in ended — your order was NOT sent\. Sign in again and press Confirm & send\./.test(t), 'order → 401: "Your sign-in ended — your order was NOT sent. Sign in again and press Confirm & send."', t.slice(0, 200));
      ok(!/See you tomorrow/.test(t), '…never "See you tomorrow" (the person did not sign out)');
      ok((await pg.inputValue('#cb')) === 'CB999', '…the sign-in is offered in place, CB number already typed');
      await pg.fill('#pw', 'whatever-1'); await pg.click('#go'); await pg.waitForSelector('#wpSend');
      const t2 = await txt(pg);
      ok(/2 × Mzansi Brekkie/.test(t2) && /collect at reception/.test(t2) && /has NOT been sent yet/.test(t2), 'signed in again → straight back on Confirm with the same cart and details, told it is not sent yet', t2.slice(0, 300));
      await pg.click('#wpSend'); await pg.waitForSelector('.wp-ok');
      const last = S.posted[S.posted.length - 1];
      ok(S.posted.length === 2 && last.order.items[0].quantity === 2 && last.who.phone === '082 123 4567' && last.order.additional_notes === 'collect at reception', '…and Confirm & send sends the very same order', JSON.stringify(last));
      ok(!errs.length, 'no page errors', errs[0]); await pg.close(); }
    /* F2 — a 403 "for Wimpy orders only" is a dead session too; a 403 "ordering is closed" is NOT */
    { const S = world(); S.orderReply.push([{ error: 'Wimpy orders are taken between 07:00 and 10:30, Monday to Friday (SA time). Ordering is closed now — the menu is back next working day.' }, 403]);
      S.orderReply.push([{ error: 'This sign-in is for Wimpy orders only.' }, 403]); const { pg } = await openPage(S);
      await signIn(pg, 'CB999'); await toConfirm(pg); await pg.click('#wpSend'); await pg.waitForSelector('.msg.bad');
      const t = await txt(pg);
      ok(/Ordering is closed now/.test(t) && !!(await pg.$('#wpSend')), 'order → 403 "closed": stays on Confirm with the reason — not signed out', t.slice(0, 160));
      await pg.click('#wpSend'); await pg.waitForSelector('#cb');
      ok(/your order was NOT sent/.test(await txt(pg)), 'order → 403 "for Wimpy orders only": the NOT-sent sign-in screen'); await pg.close(); }
    /* F3 — the session ends on My orders with a cart; a DIFFERENT person then signs in at that desk */
    { const S = world(); S.histReply.push([{ error: 'Sign in required.' }, 401]); const { pg } = await openPage(S);
      await signIn(pg, 'CB999'); await pg.waitForSelector('[data-wadd="mzansi_brekkie"]'); await pg.click('[data-wadd="mzansi_brekkie"]');
      await pg.click('#wpMine'); await pg.waitForSelector('#cb');
      const t = await txt(pg);
      ok(/Your sign-in ended — your order was NOT sent/.test(t) && !/See you tomorrow/.test(t), 'My orders → 401 with a cart: "your order was NOT sent", not "See you tomorrow"', t.slice(0, 160));
      await pg.fill('#cb', 'CB555'); await pg.fill('#pw', 'x-pass-1'); await pg.click('#go'); await pg.waitForSelector('.wp-grid');
      const t2 = await txt(pg);
      ok(!/Mzansi Brekkie ·|1 × Mzansi Brekkie/.test(await pg.evaluate(() => (document.querySelector('.wp-cart') || {}).innerText || '')) && !/NOT been sent/.test(t2), 'another person signing in at that desk gets none of it (A4)', t2.slice(0, 200)); await pg.close(); }
    /* F4 — the menu read fails 401 with an EMPTY cart: the plain words, no "See you tomorrow" */
    { const S = world(); S.menuReply.push([{ error: 'Sign in required.' }, 401]); const { pg } = await openPage(S);
      await signIn(pg, 'CB999'); await pg.waitForSelector('#cb'); await pg.waitForTimeout(200);
      const t = await txt(pg);
      ok(/Your sign-in has ended\. Sign in again to carry on\./.test(t) && !/See you tomorrow/.test(t) && !/NOT sent/.test(t), 'menu → 401, empty cart: "Your sign-in has ended. Sign in again to carry on."', t.slice(0, 160)); await pg.close(); }
    /* F5 — a successful password change returns to the menu, cart kept, and says you are still signed in */
    { const S = world(); const { pg } = await openPage(S);
      await signIn(pg, 'CB999'); await pg.waitForSelector('[data-wadd="mzansi_brekkie"]'); await pg.click('[data-wadd="mzansi_brekkie"]');
      await pg.click('#wpPwNow'); await pg.waitForSelector('#pcur'); await pg.fill('#pcur', 'wimpy123'); await pg.fill('#pnew', 'MyNewPass2026'); await pg.fill('#pagain', 'MyNewPass2026');
      await pg.click('#pf button[type=submit]'); await pg.waitForSelector('.wp-grid');
      const t = await txt(pg);
      ok(/Password changed — you’re still signed in\. Carry on with your order\./.test(t), 'password changed → back on the menu: "Password changed — you’re still signed in. Carry on with your order."', t.slice(0, 200));
      ok(!(await pg.$('#pcur')) && /1 × Mzansi Brekkie/.test(await pg.evaluate(() => document.querySelector('.wp-cart').innerText)), '…not left on the password screen, and the cart is still there');
      ok(!/still on the Wimpy start password/.test(t), '…and the start-password nudge is gone'); await pg.close(); }
    /* F6 — a wrong CURRENT password stays on the password screen (not a dead session) */
    { const S = world(); S.pwReply.push([{ error: 'That is not your current Wimpy password.' }, 401]); const { pg } = await openPage(S);
      await signIn(pg, 'CB999'); await pg.waitForSelector('#wpPwNow'); await pg.click('#wpPwNow'); await pg.waitForSelector('#pcur');
      await pg.fill('#pcur', 'nope-nope'); await pg.fill('#pnew', 'MyNewPass2026'); await pg.fill('#pagain', 'MyNewPass2026'); await pg.click('#pf button[type=submit]');
      await pg.waitForSelector('.msg.bad');
      ok(/not your current Wimpy password/.test(await txt(pg)) && !!(await pg.$('#pcur')), 'a wrong current password: told so on the password screen, still signed in'); await pg.close(); }
    /* F7 — the kitchen error is shown on Confirm, cart kept, with the words of the button that exists */
    { const S = world(); S.orderReply.push([{ error: 'The order could not be sent (the kitchen system answered 503). Your order has been kept — press Confirm & send again. If it fails again, tell your team leader.' }, 502]);
      const { pg } = await openPage(S); await signIn(pg, 'CB999'); await toConfirm(pg); await pg.click('#wpSend'); await pg.waitForSelector('.msg.bad');
      const t = await txt(pg);
      ok(/press Confirm & send again/.test(t) && /Confirm & send to Wimpy/.test(t) && /2 × Mzansi Brekkie/.test(t), 'kitchen 503: the message names the Confirm & send button that is on the screen, cart kept', t.slice(0, 220)); await pg.close(); }
  } finally { await b.close(); srv.close(); }
}

console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
process.exit(fail ? 1 : 0);
