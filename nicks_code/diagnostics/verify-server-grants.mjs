#!/usr/bin/env node
/* verify-server-grants.mjs — THE UPLOAD STATION IS A SERVER-SIDE GRANT (stability plan, 2026-10-26).
 *
 * Until 26 Oct the routes that load, replace or delete data only refused the portal roles: any other session — a viewer
 * with three VAS tabs, HR with Ops' Workforce — could wipe every BI money row (DELETE /api/bi had no check at all), delete
 * any stored file including the whole VAS state (DELETE /api/kv), publish an Agent List, or overwrite the health banner.
 * Drives the REAL Worker module in-process against a stubbed Supabase and proves, per account shape:
 *   G1  rules.mjs canUpload mirrors the browser's tab rule (admin = all; else the app + '*' or an Upload Station tab)
 *   G2  every load / replace / delete route refuses a session without the Upload Station (403, nothing written)
 *   G3  the same routes still let the uploaders through (admin, exec '*', a viewer holding vas 'data', ashton's shape)
 *   G4  health-alerts is written only by the Worker: POST and DELETE through /api/kv are refused for everyone
 *
 *   node nicks_code/diagnostics/verify-server-grants.mjs
 */
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
process.env.TZ = 'UTC';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const imp = (rel) => import(pathToFileURL(path.join(ROOT, 'worker', 'src', rel)).href);
const worker = (await imp('index.mjs')).default;
const { canUpload, kvWriteAllowed } = await imp('rules.mjs');
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m + (d ? ' — ' + d : '')); } };
const head = (t) => console.log('\n' + t);

/* ── a stubbed Supabase: sessions answer the account under test; every write is recorded ── */
const ENV = { SUPABASE_URL: 'http://stub.local', SUPABASE_SECRET_KEY: 'k' };
let SESSION = null;
const writes = [];
let biRows = [{ id: 1, contract_create_date: '2026-10-01' }, { id: 2, contract_create_date: '2026-10-02' }];
const J = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
globalThis.fetch = async (u, o = {}) => {
  const url = new URL(String(u)), p = url.pathname, method = (o.method || 'GET').toUpperCase();
  if (p === '/rest/v1/app_sessions') return J(SESSION ? [SESSION] : []);
  if (method !== 'GET' && method !== 'HEAD') writes.push(method + ' ' + p);
  if (p === '/rest/v1/bi_active_cases' && method === 'DELETE') { biRows = []; return J([]); }
  if (p.startsWith('/rest/v1/')) return J([]);
  if (p.startsWith('/storage/v1/')) return J({});
  return new Response('', { status: 404 });
};
const pending = [];
const ctx = { waitUntil: (pr) => { pending.push(pr); } };
const call = async (method, pathq, body, headers = {}) => {
  const req = new Request('https://api.local' + pathq, { method, headers: { Authorization: 'Bearer t', 'X-Cbx-Client': 'v5', 'Content-Type': 'application/json', ...headers }, body });
  const r = await worker.fetch(req, ENV, ctx);
  await Promise.all(pending.splice(0).map((x) => Promise.resolve(x).catch(() => {})));
  return { status: r.status, t: await r.text() };
};
const as = (u) => ({ user_id: 'u-' + u.username, expires_at: '2099-01-01T00:00:00Z', scope: 'full',
  app_users: { full_name: u.username, pii_unmask: false, active: true, cb: null, team: null, hub_ids: null, must_change_password: false, apps: null, tabs: null, ...u } });

/* the account shapes the database holds today (26 Oct): who may upload, who may not */
const NO = {
  'viewer with three VAS tabs': { username: 'shameem', role: 'viewer', apps: ['vas', 'wimpy'], tabs: { vas: ['dashboard', 'mtd', 'leads'] } },
  'HR with Ops Workforce only': { username: 'keshree', role: 'hr', apps: ['ops', 'wimpy'], tabs: { ops: ['workforce'] } },
  'vas data tab but no vas app': { username: 'odd', role: 'viewer', apps: ['wimpy'], tabs: { vas: ['data'] } },
  'Wimpy-only support staff': { username: 'cb99', role: 'viewer', apps: ['wimpy'], tabs: {} },
};
const YES = {
  'admin (every tab)': { username: 'nicholas', role: 'admin', apps: ['ops', 'vas', 'wimpy'], tabs: null },
  'exec with *': { username: 'barry', role: 'exec', apps: ['ops', 'vas', 'tracker', 'wimpy'], tabs: { ops: ['*'], vas: ['*'], tracker: ['*'] } },
  'viewer holding vas data': { username: 'abigail', role: 'viewer', apps: ['vas', 'wimpy'], tabs: { vas: ['dashboard', 'data'] } },
  "ashton's shape (vas:*, ops uploads)": { username: 'ashton', role: 'viewer', apps: ['ops', 'vas', 'tracker', 'wimpy'], tabs: { ops: ['session', 'uploads'], vas: ['*'], tracker: ['vt'] } },
};

head('G1 · canUpload mirrors the browser tab rule');
for (const [k, u] of Object.entries(NO)) ok(canUpload({ ...u, scope: 'full' }) === false, 'no upload: ' + k);
for (const [k, u] of Object.entries(YES)) ok(canUpload({ ...u, scope: 'full' }) === true, 'upload: ' + k);
ok(canUpload({ role: 'campaign_manager', apps: ['vas'], tabs: { vas: ['*'] }, scope: 'full' }) === false, 'a portal role never uploads, whatever it holds');
ok(canUpload({ role: 'admin', scope: 'wimpy' }) === false, 'a Wimpy-scope session never uploads, even an admin\'s');
ok(canUpload(null) === false, 'no session, no upload');

/* every route that loads, replaces or deletes data */
const ROUTES = [
  ['DELETE', '/api/bi', undefined],
  ['POST', '/api/bi', JSON.stringify({ rows: [] })],
  ['POST', '/api/bi/raw?name=x.csv', 'x'],
  ['DELETE', '/api/kv?key=vas-state', undefined],
  ['POST', '/api/roster', JSON.stringify({})],
  ['POST', '/api/upload-archive/start', JSON.stringify({})],
  ['POST', '/api/upload-archive/complete', JSON.stringify({})],
  ['POST', '/api/upload-archive?name=a.csv&hash=abcdef0123456789', 'x'],
  ['POST', '/api/upload/large/start', JSON.stringify({})],
  ['POST', '/api/upload/large/complete', JSON.stringify({})],
  ['POST', '/api/upload/large/retry', JSON.stringify({})],
  ['POST', '/api/rake/page?fn=begin', JSON.stringify({})],
];

head('G2 · a session without the Upload Station is refused on every load / replace / delete route — nothing written');
for (const [k, u] of Object.entries(NO)) {
  SESSION = as(u);
  for (const [m, pq, b] of ROUTES) {
    writes.length = 0;
    const r = await call(m, pq, b);
    ok(r.status === 403 && writes.length === 0, `${k}: ${m} ${pq.split('?')[0]} → 403, no write`, r.status + ' writes=' + writes.join(','));
  }
}
ok(biRows.length === 2, 'the BI money rows survived every refused wipe', String(biRows.length));

head('G3 · the uploaders still get through (the request reaches the route, not the grant check)');
for (const [k, u] of Object.entries(YES)) {
  SESSION = as(u);
  for (const [m, pq, b] of ROUTES) {
    if (m === 'DELETE' && pq === '/api/bi') continue;   // proven once below, so the rows are not wiped for every account
    const r = await call(m, pq, b);
    ok(!/needs Upload Station access/.test(r.t) && r.status !== 403, `${k}: ${m} ${pq.split('?')[0]} passes the grant`, r.status + ' ' + r.t.slice(0, 80));
  }
}
SESSION = as(YES['viewer holding vas data']);
const wipe = await call('DELETE', '/api/bi');
ok(wipe.status === 200 && biRows.length === 0, 'a granted uploader can still delete the Power BI source (the Upload Station action)', wipe.status + ' rows=' + biRows.length);

head('G4 · health-alerts is the Worker\'s own record — no session writes or clears it through /api/kv');
ok(kvWriteAllowed('health-alerts', { role: 'admin', scope: 'full' }) === false, 'rules.mjs: not even an admin may write it');
for (const [k, u] of [['admin', YES['admin (every tab)']], ['exec', YES['exec with *']]]) {
  SESSION = as(u);
  writes.length = 0;
  const post = await call('POST', '/api/kv?key=health-alerts', JSON.stringify({ data: '[]' }));
  const del = await call('DELETE', '/api/kv?key=health-alerts');
  ok(post.status === 403 && del.status === 403 && writes.length === 0, k + ': POST and DELETE health-alerts → 403, nothing written', post.status + '/' + del.status + ' writes=' + writes.join(','));
}

console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
process.exit(fail ? 1 : 0);
