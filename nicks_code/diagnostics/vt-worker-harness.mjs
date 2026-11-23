/* vt-worker-harness.mjs — the REAL Worker (worker/src/index.mjs) in-process over a stubbed Supabase, for the Phase E
 * portal suites (spec 071). Rules rows are a map {key: value}; a value given as an object is stored as {data: JSON}
 * (the pointer row's inline copy), exactly as /api/kv writes a small value. HighLevel, Convex and every other host
 * answer 503, so a route that reaches one degrades the way it does when that service is down. Nothing leaves the machine.
 *
 *   const W = await workerHarness(); W.rules['kv:agent-digest'] = digest; const r = await W.call(user, 'GET', '/api/portal/overview');
 */
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const userRow = (o = {}) => ({ user_id: 'u-' + (o.username || 'x'), expires_at: '2099-01-01T00:00:00Z', scope: o.scope || 'full',
  app_users: { username: 'someone', full_name: 'Some One', role: 'agent', apps: ['agent'], tabs: {}, pii_unmask: false, active: true, cb: null, team: null,
    hub_ids: null, must_change_password: false, ...o, scope: undefined } });

export async function workerHarness() {
  const worker = (await import(pathToFileURL(path.join(ROOT, 'worker', 'src', 'index.mjs')).href)).default;
  const S = { rules: {}, tables: {}, storage: {}, session: null, subs: 0, writes: [], log: [] };
  const J = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
  globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
  globalThis.fetch = async (u, o = {}) => {
    if (++S.subs > 50) throw new Error('Too many subrequests.');
    const url = new URL(String(u)), p = url.pathname, method = (o.method || 'GET').toUpperCase();
    S.log.push(method + ' ' + p + url.search);
    if (url.host !== 'stub.local') return new Response('{"error":"offline"}', { status: 503 });
    if (p === '/rest/v1/app_sessions') return J(S.session ? [S.session] : []);
    if (p === '/rest/v1/rules') {
      if (method !== 'GET') { S.writes.push({ method, search: url.search, body: o.body }); return J([]); }
      const eq = url.searchParams.get('key');
      if (eq && eq.startsWith('eq.')) { const k = eq.slice(3), v = S.rules[k];
        if (v === undefined) return J([]);
        const value = v && v.__raw ? v.__raw : { data: JSON.stringify(v) };
        return J([{ key: k, value, updated_at: '2026-11-10T06:30:00.000Z' }]); }
      if (eq && eq.startsWith('in.(')) { const ks = decodeURIComponent(eq.slice(4, -1)).split(',');
        return J(ks.filter((k) => S.rules[k] !== undefined).map((key) => ({ key, value: S.rules[key] }))); }
      if (eq && eq.startsWith('like.')) { const pre = eq.slice(5).replace(/%$/, '');
        return J(Object.keys(S.rules).filter((k) => k.startsWith(pre)).map((key) => ({ key }))); }
      return J([]);
    }
    if (p.startsWith('/storage/')) {
      if (method === 'POST' || method === 'PUT') { S.storage[p] = typeof o.body === 'string' ? o.body : '[bytes]'; return J({ Key: p }); }
      return S.storage[p] != null ? new Response(S.storage[p], { status: 200 }) : new Response('', { status: 404 });
    }
    if (method !== 'GET') { S.writes.push({ method, p, body: o.body }); return J([]); }
    const tb = S.tables[p.slice('/rest/v1/'.length)];
    return J(tb || []);
  };
  S.call = async (user, method, pq, body) => {
    S.subs = 0; S.session = user;
    const h = { Authorization: 'Bearer t', 'X-Cbx-Client': 'v5' };
    const init = { method, headers: h };
    if (body != null) { init.body = typeof body === 'string' ? body : JSON.stringify(body); h['Content-Type'] = 'application/json'; h['Content-Length'] = String(Buffer.byteLength(init.body)); }
    const r = await worker.fetch(new Request('https://api.local' + pq, init), { SUPABASE_URL: 'http://stub.local', SUPABASE_SECRET_KEY: 'k' }, { waitUntil: () => {} });
    const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) { j = null; }
    return { status: r.status, t, j, subs: S.subs };
  };
  return S;
}
