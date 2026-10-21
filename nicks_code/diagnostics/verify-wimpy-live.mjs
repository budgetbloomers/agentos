#!/usr/bin/env node
/* verify-wimpy-live.mjs — THE LIVE WIMPY SERVICE, PROVED END TO END (Spec Kit 019, 2026-10-09).
 *
 * Nick: "test the entire wimpy and make sure everything is working". Drives the REAL deployment
 * (WIMPY_URL, default https://phoenix-wimpy.vercel.app) against the REAL database with the credentials in the
 * git-ignored agentos/supabase.env and wimpy-service/.env. Nothing secret is printed.
 *
 * Side effects, deliberate and labelled: ONE order under a throwaway account, notes "TEST - please ignore" — the kitchen
 * gets a slip and the Wimpy HighLevel sub-account a contact + card named for it; the account's audit-log rows. The
 * account, its ledger rows and its contact link are removed in `finally`, whatever happened.
 *
 *   node nicks_code/diagnostics/verify-wimpy-live.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const BASE = (process.env.WIMPY_URL || 'https://phoenix-wimpy.vercel.app').replace(/\/$/, '');
const WORKER = 'https://chatterbox-agentos-api.chatterbox-agentos.workers.dev';
const PAGES = 'https://chatterbox-agentos.pages.dev';

const parseEnv = (p) => { const o = {}; if (!fs.existsSync(p)) return o; for (const l of fs.readFileSync(p, 'utf8').split(/\r?\n/)) { const m = /^([A-Z_]+)=(.*)$/.exec(l.trim()); if (m) o[m[1]] = m[2]; } return o; };
const SUPA = parseEnv(path.join(ROOT, 'supabase.env'));
const SVC = parseEnv(path.join(ROOT, 'wimpy-service', '.env'));
const CRON = SVC.CRON_SECRET || '';

let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m + (d !== undefined ? ' — ' + d : '')); } };
const head = (t) => console.log('\n' + t);
const SECRETS = [SUPA.SUPABASE_SECRET_KEY, SUPA.SUPABASE_DB_URL, CRON, SVC.WIMPY_HL_API_KEY].filter(Boolean);
const safe = (s) => { let t = String(s == null ? '' : s); for (const x of SECRETS) t = t.split(x).join('[secret]'); return t.slice(0, 160); };

async function call(url, { method = 'GET', token, headers = {}, body, raw = false } = {}) {
  const h = { ...headers }; if (token) h.Authorization = 'Bearer ' + token; if (body !== undefined && !raw) h['Content-Type'] = 'application/json';
  const r = await fetch(url, { method, headers: h, body: body === undefined ? undefined : raw ? body : JSON.stringify(body), redirect: 'manual' });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) { j = null; }
  return { status: r.status, t, j, h: r.headers };
}
/* PostgREST with the service key — only for the throwaway account and the integrity view */
const PG = SUPA.SUPABASE_URL + '/rest/v1/';
const pgH = { apikey: SUPA.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + SUPA.SUPABASE_SECRET_KEY, 'Content-Type': 'application/json' };
const pg = async (method, q, body, prefer) => { const r = await fetch(PG + q, { method, headers: { ...pgH, ...(prefer ? { Prefer: prefer } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }); const t = await r.text(); if (!r.ok) throw new Error('postgrest ' + method + ' ' + q.split('?')[0] + ' → ' + r.status + ': ' + safe(t)); return t ? JSON.parse(t) : null; };

head('A · THE SERVICE ANSWERS AND IS LOCKED DOWN (no credentials)');
{
  const h = await call(BASE + '/api/health');
  ok(h.status === 200 && h.j && h.j.ok === true && h.j.service === 'wimpy', 'GET /api/health → 200 ok', h.status + ' ' + safe(h.t));
  ok(h.j && h.j.db_configured === true && h.j.hl_configured === true && h.j.cron_configured === true, '…database, HighLevel and cron all configured', safe(h.t));
  const pg0 = await call(BASE + '/');
  ok(pg0.status === 200 && /text\/html/.test(pg0.h.get('content-type') || '') && /Wimpy Order/.test(pg0.t) && pg0.t.includes("var API=''"), 'GET / → the page, same-origin API', pg0.status + ' ' + (pg0.h.get('content-type') || ''));
  const prices = ['45.90', '65.90', '77.90', '54.90', '82.90', '95.90', '53.90', '55.90', '97.90', '103.90', '115.90', '127.90'];
  ok(!prices.some((p) => pg0.t.includes(p)), 'the live page holds no price');
  for (const [k, v] of [['content-security-policy', "connect-src 'self'"], ['strict-transport-security', 'max-age='], ['x-frame-options', 'DENY'], ['x-content-type-options', 'nosniff'], ['cache-control', 'no-store']])
    ok((pg0.h.get(k) || '').includes(v), 'the page carries ' + k, pg0.h.get(k) || '(none)');
  const m = await call(BASE + '/api/wimpy/menu');
  ok(m.status === 401 && m.j && /Sign in required/.test(m.j.error || ''), 'the menu without a session → 401', m.status + ' ' + safe(m.t));
  const o = await call(BASE + '/api/wimpy/orders');
  ok(o.status === 401, 'My orders without a session → 401', String(o.status));
  const c = await call(BASE + '/api/wimpy/cron/retry');
  ok(c.status === 401 && /Not permitted/.test((c.j || {}).error || ''), 'the retry without its secret → 401', c.status + ' ' + safe(c.t));
  const c2 = await call(BASE + '/api/wimpy/cron/retry', { headers: { Authorization: 'Bearer not-the-secret' } });
  ok(c2.status === 401, '…and with a wrong one → 401', String(c2.status));
  const nj = await call(BASE + '/api/wimpy/signin', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{"cb":"x","password":"y"}', raw: true });
  ok(nj.status === 415, 'a POST that is not JSON → 415', String(nj.status));
  const nf = await call(BASE + '/nothing-here');
  ok(nf.status === 404 && /Not found/.test((nf.j || {}).error || ''), 'an unknown path → 404 JSON', nf.status + ' ' + safe(nf.t));
  const opt = await call(BASE + '/api/wimpy/order', { method: 'OPTIONS' });
  ok(opt.status === 204 && !opt.h.get('access-control-allow-origin'), 'OPTIONS → 204, no CORS header (one origin)', String(opt.status));
}

head('B · THE SUITE SIDE HOLDS');
{
  for (const [method, p] of [['GET', '/api/wimpy/menu'], ['POST', '/api/wimpy/order'], ['GET', '/api/wimpy/orders'], ['POST', '/api/wimpy/signin'], ['GET', '/api/portal/wimpy/menu']]) {
    const r = await call(WORKER + p, { method, body: method === 'POST' ? {} : undefined, headers: { 'X-Cbx-Client': 'v5' } });
    ok(r.status === 410 && (r.j || {}).error && r.j.error.includes(BASE), 'Worker ' + method + ' ' + p + ' → 410 naming ' + BASE, r.status + ' ' + safe(r.t));
  }
  const red = await call(PAGES + '/wimpy/');
  ok(red.status === 302 && (red.h.get('location') || '').startsWith(BASE), 'Pages /wimpy/ → 302 to ' + BASE, red.status + ' ' + (red.h.get('location') || ''));
  const red2 = await call(PAGES + '/wimpy/index.html');
  ok(red2.status === 302 && (red2.h.get('location') || '').startsWith(BASE), 'Pages /wimpy/index.html → 302 too', red2.status + ' ' + (red2.h.get('location') || ''));
}

head('C · THE AGENT LIST STILL FEEDS WIMPY (database)');
{
  const integ = await pg('GET', 'agent_list_integrity?select=check_name,severity,failures,detail');
  const row = (integ || []).find((r) => /Wimpy/i.test(r.check_name));
  ok(!!row, 'agent_list_integrity has the Wimpy row ("' + (row && row.check_name) + '")');
  ok(row && Number(row.failures) === 0, 'no active agent or team leader lacks the Wimpy app', row && (row.failures + ' ' + safe(row.detail)));
  const crit = (integ || []).filter((r) => r.severity === 'critical' && Number(r.failures) > 0);
  ok(!crit.length, 'and the latest Agent List is in step with the logins (no critical integrity failure)', crit.map((r) => r.check_name + ':' + r.failures).join('; '));
  /* the migration-037 trigger, over Postgres (pg from the diagnostics node_modules, as tools/apply-migration.mjs does) */
  try {
    const pgmod = (await import(pathToFileURL(path.join(HERE, 'node_modules', 'pg', 'lib', 'index.js')).href)).default;
    const client = new pgmod.Client({ connectionString: SUPA.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 30000 });
    await client.connect();
    try {
      const t = await client.query("select tgname, tgenabled from pg_trigger where tgname = 'app_users_grant_wimpy'");
      ok(t.rows.length === 1 && t.rows[0].tgenabled !== 'D', 'the trigger app_users_grant_wimpy (migration-037) exists and is enabled — every account the Agent List creates gets the Wimpy app', JSON.stringify(t.rows));
      const s = await client.query("select count(*)::int as n from app_sessions where scope = 'wimpy'");
      ok(true, 'wimpy-scoped sessions in the database right now: ' + s.rows[0].n + ' (migration-058 ended the pre-move ones)');
      const w = await client.query("select count(*)::int as n, max(placed_at) as last from wimpy_orders");
      ok(true, 'wimpy_orders holds ' + w.rows[0].n + ' order(s); last ' + (w.rows[0].last ? new Date(w.rows[0].last).toISOString() : 'none'));
    } finally { await client.end(); }
  } catch (e) { ok(false, 'Postgres checks ran', safe(e.message)); }
}

head('D · A PERSON DOES EVERYTHING A PERSON DOES (a throwaway account on the live database)');
const USER = 'wimpy.livecheck', USER2 = 'wimpy.livecheck2';
const PASSWORD = 'Lc-' + crypto.randomBytes(12).toString('base64url'), PASSWORD2 = 'Lc-' + crypto.randomBytes(12).toString('base64url');
let uid = null, token = null, uid2 = null, token2 = null;
try {
  const svcAuth = await import(pathToFileURL(path.join(ROOT, 'wimpy-service', 'src', 'auth.mjs')).href);
  const hash = await svcAuth.hashPassword(PASSWORD);
  const WD = svcAuth.WIMPY_DEFAULT_PASSWORD;   // Spec Kit 025: every account starts on wimpy123 for lunch; PASSWORD is its AgentOS one
  await pg('DELETE', 'app_users?username=eq.' + USER);   // a leftover from an earlier run
  const ins = await pg('POST', 'app_users', [{ username: USER, full_name: 'Wimpy Livecheck', role: 'viewer', active: true, apps: ['wimpy'], password_hash: hash, must_change_password: false, password_is_default: false }], 'return=representation');
  uid = ins && ins[0] && ins[0].id;
  ok(!!uid, 'the throwaway account exists (role viewer, apps [wimpy], a random password hashed by the service\'s own hashPassword)');
  const wrong = await call(BASE + '/api/wimpy/signin', { method: 'POST', body: { cb: USER, password: WD + 'x' } });
  ok(wrong.status === 401 && (wrong.j || {}).error === 'That CB number and password do not match.', 'a wrong password → 401 in the usual words', wrong.status + ' ' + safe(wrong.t));
  const agentPw = await call(BASE + '/api/wimpy/signin', { method: 'POST', body: { cb: USER, password: PASSWORD } });
  ok(agentPw.status === 401, 'the AgentOS password → 401 on Wimpy (Spec Kit 025: lunch has its own password)', String(agentPw.status));
  const right = await call(BASE + '/api/wimpy/signin', { method: 'POST', body: { cb: USER, password: WD } });
  token = right.j && right.j.token;
  ok(right.status === 200 && token && right.j.user && right.j.user.scope === 'wimpy' && right.j.user.username === USER, 'the start password wimpy123 → a lunch-only session', right.status + ' ' + safe(right.t).replace(/"token":"[^"]+"/, '"token":"…"'));
  ok(!right.t.includes(PASSWORD) && !right.t.includes(WD) && !/password_hash|token_hash/.test(right.t), '…the answer carries no password, no hash');
  ok(right.j && right.j.user && right.j.user.wimpy_password_is_default === true, '…and says the person is still on the start password');
  const me = await call(BASE + '/api/wimpy/me', { token });
  ok(me.status === 200 && me.j && me.j.user && me.j.user.username === USER && !('token_hash' in me.j.user), 'GET /api/wimpy/me → the person, no token hash', me.status + ' ' + safe(me.t));
  const menu = await call(BASE + '/api/wimpy/menu', { token });
  const mj = menu.j || {};
  ok(menu.status === 200 && Array.isArray(mj.items) && mj.items.length >= 8 && mj.title === 'Weekday Value Menu', 'the menu: ' + (mj.items || []).length + ' items, "' + mj.title + '", ' + mj.dayName, menu.status);
  const sast = new Date(Date.now() + 2 * 3600000), dow = sast.getUTCDay(), hr = sast.getUTCHours();
  const mins = hr * 60 + sast.getUTCMinutes();
  const expectOpen = dow >= 1 && dow <= 5 && mins >= 420 && mins < 600;   // 07:00–10:00 since 2026-10-21
  ok(mj.window && mj.window.open === expectOpen, 'the window says ' + (mj.window && mj.window.open ? 'OPEN' : 'closed') + ' — right for ' + sast.toISOString().slice(0, 16) + ' SAST', JSON.stringify(mj.window));
  ok(dow >= 1 && dow <= 5 ? (mj.bigOne && mj.bigOne.day === dow) : mj.bigOne === null, 'today\'s Big One: ' + (mj.bigOne ? mj.bigOne.name : '(weekend: none)'));
  const hist0 = await call(BASE + '/api/wimpy/orders', { token });
  ok(hist0.status === 200 && hist0.j && Array.isArray(hist0.j.orders) && hist0.j.orders.length === 0 && hist0.j.since === '2026-10-07', 'My orders for a new person: empty, history since 2026-10-07', hist0.status + ' ' + safe(hist0.t));
  const cheapest = (mj.items || []).filter((i) => i.basePrice != null).sort((a, b) => a.basePrice - b.basePrice)[0];
  if (expectOpen && cheapest) {
    const body = { who: { cb: USER, first_name: 'Wimpy', surname: 'Livecheck', phone: '082 000 0000' }, total_price: cheapest.basePrice,
      order: { items: [{ id: cheapest.id, quantity: 1 }], additional_notes: 'TEST - please ignore (Wimpy service live check, ' + sast.toISOString().slice(0, 16) + ' SAST)' } };
    const bad = await call(BASE + '/api/wimpy/order', { method: 'POST', token, body: { ...body, who: { ...body.who, cb: 'CB999999' } } });
    ok(bad.status === 400 && /not the one you signed in with|username/.test((bad.j || {}).error || ''), 'an order in somebody else\'s name → 400', bad.status + ' ' + safe(bad.t));
    const order = await call(BASE + '/api/wimpy/order', { method: 'POST', token, body });
    ok(order.status === 200 && order.j && order.j.ok === true && order.j.total_price === cheapest.basePrice, 'ONE TEST ORDER placed: 1 × ' + cheapest.name + ' — the kitchen said yes (R' + (order.j || {}).total_price + ')', order.status + ' ' + safe(order.t));
    ok(order.j && /TEST - please ignore/.test(order.j.order_formatted || '') && /Wimpy Livecheck/.test(order.j.order_formatted || ''), '…the slip is marked TEST and names the throwaway person');
    await new Promise((r) => setTimeout(r, 6000));   // the ledger row and the HighLevel card land after the reply
    const hist1 = await call(BASE + '/api/wimpy/orders', { token });
    const first = hist1.j && hist1.j.orders && hist1.j.orders[0];
    ok(hist1.status === 200 && first && first.total === cheapest.basePrice.toFixed(2) && first.items && first.items[0].item === cheapest.name, 'My orders now shows it, with its items and total', hist1.status + ' ' + safe(hist1.t));
    ok(first && (first.stage === 'New Order' || first.stage_note), '…and its kitchen stage: ' + (first ? (first.stage || first.stage_note) : '?') + (hist1.j && hist1.j.stages_available ? ' (HighLevel reachable)' : ' (stages not available)'));
    ok(!/082 000 0000|0820000000/.test(hist1.t) && !/hc-|op-|"id"/.test(hist1.t), '…the history reply carries no phone number and no id');
  } else ok(true, 'ordering window closed or no priced item — the order step is skipped (window open: ' + expectOpen + ')');

  /* ── F · TWICE, AND TWO PEOPLE (Spec Kit 021, 2026-10-09: "order from a candidate twice, make sure the history is working") ── */
  head('F · THE SAME PERSON ORDERS TWICE; A SECOND PERSON SEES NONE OF IT');
  if (expectOpen && cheapest) {
    const second = (mj.items || []).filter((i) => i.basePrice != null && i.id !== cheapest.id).sort((a, b) => a.basePrice - b.basePrice)[0];
    const total2 = Math.round((second.basePrice * 2 + cheapest.basePrice) * 100) / 100;
    const who = { cb: USER, first_name: 'Wimpy', surname: 'Livecheck', phone: '082 000 0000' };
    const body2 = { who, total_price: total2, order: { items: [{ id: second.id, quantity: 2 }, { id: cheapest.id, quantity: 1 }], additional_notes: 'TEST - please ignore (second order, Wimpy live check)' } };
    const o2 = await call(BASE + '/api/wimpy/order', { method: 'POST', token, body: body2 });
    ok(o2.status === 200 && o2.j && o2.j.ok === true && o2.j.total_price === total2, 'a SECOND TEST order by the same person: 2 × ' + second.name + ' + 1 × ' + cheapest.name + ' — the kitchen said yes (R' + (o2.j || {}).total_price + ')', o2.status + ' ' + safe(o2.t));
    const q11 = await call(BASE + '/api/wimpy/order', { method: 'POST', token, body: { who, total_price: 1, order: { items: [{ id: cheapest.id, quantity: 11 }] } } });
    ok(q11.status === 400 && /between 1 and 10/.test((q11.j || {}).error || ''), 'quantity 11 → 400 (the cap)', q11.status + ' ' + safe(q11.t));
    const offDay = ['mega_breakfast', 'dagwood', 'big_bacon_cheese', 'big_champion', 'fully_loaded_dagwood'].find((id) => !(mj.items || []).some((i) => i.id === id));
    const od = await call(BASE + '/api/wimpy/order', { method: 'POST', token, body: { who, total_price: 1, order: { items: [{ id: offDay, quantity: 1 }] } } });
    ok(od.status === 400 && /Big One/.test((od.j || {}).error || ''), 'another day\'s Big One → 400, refused by name', od.status + ' ' + safe(od.t));
    const ad = await call(BASE + '/api/wimpy/order', { method: 'POST', token, body: { who, total_price: 1, order: { items: [{ id: cheapest.id, quantity: 1, added: ['extra_cheese'] }] } } });
    ok(ad.status === 400 && /as it is/.test((ad.j || {}).error || ''), 'an add-on → 400 ("comes as it is")', ad.status + ' ' + safe(ad.t));
    await new Promise((r) => setTimeout(r, 6000));
    const h2 = await call(BASE + '/api/wimpy/orders', { token });
    const os = (h2.j && h2.j.orders) || [];
    ok(h2.status === 200 && os.length === 2, 'My orders shows BOTH orders (' + os.length + ')', h2.status + ' ' + safe(h2.t));
    ok(os[0] && os[0].total === total2.toFixed(2) && os[0].items.length === 2 && os[0].items[0].quantity === 2 && os[0].items[0].item === second.name && os[1] && os[1].total === cheapest.basePrice.toFixed(2),
      'newest first, each with its own items, quantities and total', safe(JSON.stringify(os.map((o) => [o.total, o.items.map((i) => i.quantity + 'x' + i.item)]))));
    ok(os[0] && os[1] && Date.parse(os[0].placed_at) > Date.parse(os[1].placed_at) && /\+02:00$/.test(os[0].placed_at), 'times in SA time, the second after the first', os.map((o) => o.placed_at).join(' > '));
    ok(os[1] && os[1].stage === 'New Order', 'the FIRST order is still on the kitchen board at New Order', os[1] && (os[1].stage || os[1].stage_note));
    const onBoard = os[0] && os[0].stage === 'New Order';
    ok(onBoard || (os[0] && os[0].stage_note === 'Not on the kitchen board yet'), 'the SECOND order: ' + (os[0] && (os[0].stage || os[0].stage_note)) + (onBoard ? '' : ' — HighLevel still refuses a second card per person ("Allow duplicate opportunities" is OFF in the Wimpy sub-account); the retry keeps trying; the kitchen HAS the order'), os[0] && safe(JSON.stringify(os[0])));
    /* a second person */
    const hash2 = await svcAuth.hashPassword(PASSWORD2);
    await pg('DELETE', 'app_users?username=eq.' + USER2);
    const ins2 = await pg('POST', 'app_users', [{ username: USER2, full_name: 'Second Livecheck', role: 'viewer', active: true, apps: ['wimpy'], password_hash: hash2, must_change_password: false, password_is_default: false }], 'return=representation');
    uid2 = ins2 && ins2[0] && ins2[0].id;
    const s2 = await call(BASE + '/api/wimpy/signin', { method: 'POST', body: { cb: USER2, password: WD } });
    token2 = s2.j && s2.j.token;
    ok(!!uid2 && !!token2, 'a SECOND throwaway person exists and signs in', s2.status);
    const e2 = await call(BASE + '/api/wimpy/orders', { token: token2 });
    ok(e2.status === 200 && e2.j && e2.j.orders && e2.j.orders.length === 0, 'their My orders is empty', safe(e2.t));
    ok(!e2.t.includes(total2.toFixed(2)) && !e2.t.includes(cheapest.basePrice.toFixed(2)) && !/Livecheck/.test(e2.t), '…and carries nothing of the first person');
    const o3 = await call(BASE + '/api/wimpy/order', { method: 'POST', token: token2, body: { who: { cb: USER2, first_name: 'Second', surname: 'Livecheck', phone: '083 000 0000' }, total_price: cheapest.basePrice, order: { items: [{ id: cheapest.id, quantity: 1 }], additional_notes: 'TEST - please ignore (second person, Wimpy live check)' } } });
    ok(o3.status === 200 && (o3.j || {}).ok === true, 'the second person orders once — the kitchen said yes', o3.status + ' ' + safe(o3.t));
    const x = await call(BASE + '/api/wimpy/order', { method: 'POST', token: token2, body: { who: { cb: USER, first_name: 'Wimpy', surname: 'Livecheck', phone: '083 000 0000' }, total_price: cheapest.basePrice, order: { items: [{ id: cheapest.id, quantity: 1 }] } } });
    ok(x.status === 400, '…and cannot order in the FIRST person\'s name (400)', x.status + ' ' + safe(x.t));
    await new Promise((r) => setTimeout(r, 4000));
    const h3 = await call(BASE + '/api/wimpy/orders', { token: token2 });
    ok(h3.status === 200 && h3.j && h3.j.orders && h3.j.orders.length === 1, 'the second person sees exactly ONE order', safe(h3.t));
    const h4 = await call(BASE + '/api/wimpy/orders', { token });
    ok(h4.status === 200 && h4.j && h4.j.orders && h4.j.orders.length === 2 && !h4.t.includes('Second'), 'the first person still sees exactly TWO, nothing of the second person');
    const out2 = await call(BASE + '/api/wimpy/logout', { method: 'POST', token: token2, body: {} });
    ok(out2.status === 200, 'the second person signs out', String(out2.status));
  } else ok(true, 'window closed — the twice/two-people checks need the window (weekday 07:00–10:00 SAST)');

  /* ── G · THE WIMPY-ONLY PASSWORD (Spec Kit 025: wimpy123 to start, then the person's own) ── */
  head('G · THE PERSON CHANGES THEIR WIMPY PASSWORD; AGENT ANALYTICS KEEPS ITS OWN');
  {
    const before = (await pg('GET', 'app_users?id=eq.' + uid + '&select=password_hash,wimpy_password_hash'))[0] || {};
    ok(before.password_hash && !before.wimpy_password_hash, 'before: an Agent Analytics hash, no Wimpy hash (= the start password)');
    const me1 = await call(BASE + '/api/wimpy/me', { token });
    ok(me1.status === 200 && me1.j.user.wimpy_password_is_default === true, 'GET /api/wimpy/me says: still on the start password', safe(me1.t));
    const PW2 = 'Lc2-' + crypto.randomBytes(12).toString('base64url');
    const bad = await call(BASE + '/api/wimpy/password', { method: 'POST', token, body: { current: 'not-my-password-1', new: PW2 } });
    ok(bad.status === 401 && /current Wimpy password/.test((bad.j || {}).error || ''), 'a wrong current password → 401 in words', bad.status + ' ' + safe(bad.t));
    const agentCur = await call(BASE + '/api/wimpy/password', { method: 'POST', token, body: { current: PASSWORD, new: PW2 } });
    ok(agentCur.status === 401, 'the AgentOS password is not the current Wimpy password → 401', String(agentCur.status));
    const shrt = await call(BASE + '/api/wimpy/password', { method: 'POST', token, body: { current: WD, new: 'short' } });
    ok(shrt.status === 400, 'a short new password → 400', String(shrt.status));
    const same = await call(BASE + '/api/wimpy/password', { method: 'POST', token, body: { current: WD, new: WD } });
    ok(same.status === 400, 'the start password as the new one → 400', String(same.status));
    const chg = await call(BASE + '/api/wimpy/password', { method: 'POST', token, body: { current: WD, new: PW2 } });
    ok(chg.status === 200 && (chg.j || {}).ok === true, 'the change (start password → own) → 200', chg.status + ' ' + safe(chg.t));
    const after = (await pg('GET', 'app_users?id=eq.' + uid + '&select=password_hash,wimpy_password_hash'))[0] || {};
    ok(after.password_hash === before.password_hash && !!after.wimpy_password_hash, 'after: the Agent Analytics hash is unchanged and a Wimpy hash exists');
    const me2 = await call(BASE + '/api/wimpy/me', { token });
    ok(me2.status === 200 && me2.j.user.wimpy_password_is_default === false, 'the session that changed it is still signed in, and is no longer "on the start password"', safe(me2.t));
    const old = await call(BASE + '/api/wimpy/signin', { method: 'POST', body: { cb: USER, password: WD } });
    ok(old.status === 401, 'the start password no longer signs this account in', old.status + ' ' + safe(old.t));
    const old2 = await call(BASE + '/api/wimpy/signin', { method: 'POST', body: { cb: USER, password: PASSWORD } });
    ok(old2.status === 401, '…nor does the AgentOS password', String(old2.status));
    const nw = await call(BASE + '/api/wimpy/signin', { method: 'POST', body: { cb: USER, password: PW2 } });
    ok(nw.status === 200 && nw.j && nw.j.token, 'the new Wimpy password does', nw.status + ' ' + safe(nw.t).replace(/"token":"[^"]+"/, '"token":"…"'));
    if (nw.j && nw.j.token) await call(BASE + '/api/wimpy/logout', { method: 'POST', token: nw.j.token, body: {} });
    /* the way back: a reset to the AgentOS start password (password_is_default → true) clears the Wimpy hash (migration-060 trigger) */
    await pg('PATCH', 'app_users?id=eq.' + uid, { password_is_default: true });
    const reset = (await pg('GET', 'app_users?id=eq.' + uid + '&select=wimpy_password_hash,password_is_default'))[0] || {};
    ok(reset.password_is_default === true && reset.wimpy_password_hash === null, 'a team-leader reset clears the Wimpy password (the trigger)', safe(JSON.stringify(reset)));
    const back = await call(BASE + '/api/wimpy/signin', { method: 'POST', body: { cb: USER, password: WD } });
    ok(back.status === 200, '…and wimpy123 opens Wimpy again', String(back.status));
    if (back.j && back.j.token) await call(BASE + '/api/wimpy/logout', { method: 'POST', token: back.j.token, body: {} });
    const page2 = await call(BASE + '/');
    ok(/Change your Wimpy password|wpPw/.test(page2.t) && /start password/.test(page2.t) && /wpPwNudge/.test(page2.t), 'the live page carries the Change password screen, the start-password hint and the nudge');
  }

  if (CRON) {
    const cron = await call(BASE + '/api/wimpy/cron/retry', { headers: { Authorization: 'Bearer ' + CRON } });
    ok(cron.status === 200 && cron.j && cron.j.ok === true && cron.j.configured === true && cron.j.counts, 'the retry with its secret runs and reports: ' + safe(JSON.stringify((cron.j || {}).counts)), cron.status + ' ' + safe(cron.t));
    const st = await pg('GET', "rules?key=eq.kv:wimpy-hl-status&select=updated_at,updated_by");
    ok(st && st[0] && Date.now() - Date.parse(st[0].updated_at) < 120000 && st[0].updated_by === 'wimpy-cron', 'kv:wimpy-hl-status was just written (' + (st && st[0] && st[0].updated_at) + ') — the suite\'s health check reads it');
  } else ok(false, 'CRON_SECRET found in wimpy-service/.env');
  const out = await call(BASE + '/api/wimpy/logout', { method: 'POST', token, body: {} });
  ok(out.status === 200 && (out.j || {}).ok === true, 'sign out → 200', String(out.status));
  const after = await call(BASE + '/api/wimpy/me', { token });
  ok(after.status === 401, '…and the token is dead afterwards (401)', String(after.status));
  token = null;
} catch (e) {
  ok(false, 'section D ran to its end', safe(e && e.stack || e));
} finally {
  head('E · CLEANUP');
  try {
    let slips = 0;
    for (const [id, name] of [[uid, USER], [uid2, USER2]]) {
      if (!id) continue;
      const rows = await pg('DELETE', 'wimpy_orders?owner_user_id=eq.' + id, undefined, 'return=representation');
      slips += (rows || []).length;
      await pg('DELETE', 'wimpy_hl_contacts?owner_user_id=eq.' + id);
      await pg('DELETE', 'app_users?id=eq.' + id);
      const left = await pg('GET', 'app_users?username=eq.' + name + '&select=id');
      ok(!left.length, 'the throwaway account ' + name + ' is gone (with ' + (rows || []).length + ' ledger row(s), its contact link and its sessions)');
    }
    if (uid) ok(true, 'left behind, labelled TEST: ' + slips + ' kitchen slip(s) and the HighLevel contact(s) "… Livecheck" with their cards — delete them in the Wimpy sub-account at leisure');
    else ok(true, 'no account was created');
  } catch (e) { ok(false, 'cleanup', safe(e.message)); }
}

console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
process.exit(fail ? 1 : 0);
