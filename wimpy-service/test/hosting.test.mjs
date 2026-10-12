/* hosting.test.mjs — what the two hosts share and what each adds (Spec Kit 018): /api/health; the cron route's bearer
 * rules; the scope gate; the security headers (one definition — vercel.json must agree); the client address
 * (TRUST_PROXY); the container refuses to start unconfigured; Dockerfile / compose / vercel.json / package.json sanity;
 * and the REAL Node server booted on a free port against stubs and smoked over HTTP. No credentials, nothing leaves
 * this machine: every value that looks like one is fake.
 *
 *   node test/hosting.test.mjs   (or npm test)
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SRC = (rel) => pathToFileURL(path.join(ROOT, 'src', rel)).href;
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m + (d !== undefined ? ' — ' + d : '')); } };
const head = (t) => console.log('\n' + t);

const app = await import(SRC('app.mjs'));
const srv = await import(SRC('server.mjs'));
const hdr = await import(SRC('headers.mjs'));
const net = await import(SRC('net.mjs'));

/* ── the stubbed database: sessions by token hash, an auth_log that records every insert, nobody in app_users ── */
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const row = (scope) => ({ user_id: 'u-1', expires_at: '2099-01-01T00:00:00Z', scope, app_users: { username: 'cb9101', full_name: 'Sam Agent', role: 'agent', apps: ['agent', 'wimpy'], active: true, cb: 'CB9101' } });
const SESS = { [sha('tok-full')]: row('full'), [sha('tok-wimpy')]: row('wimpy') };
const LOG = [];
let fetches = 0;
const J = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
globalThis.fetch = async (u, o = {}) => {
  fetches++;
  const url = new URL(String(u)); const method = String(o.method || 'GET').toUpperCase();
  if (url.host !== 'stub.local') return new Response('', { status: 404 });
  if (url.pathname === '/rest/v1/app_sessions') { const m = /^eq\.(.*)$/.exec(url.searchParams.get('token_hash') || ''); const s = m && SESS[m[1]]; return J(s ? [s] : []); }
  if (url.pathname === '/rest/v1/auth_log') { if (method === 'POST') { LOG.push(...JSON.parse(o.body)); return new Response('', { status: 201 }); } return J([]); }
  if (url.pathname === '/rest/v1/rules' && method === 'POST') return new Response('', { status: 201 });
  return J([]);
};
const ENV = { SUPABASE_URL: 'http://stub.local', SUPABASE_SECRET_KEY: 'svc-test', CRON_SECRET: 'cron-test' };
const ctx = { waitUntil() {} };
const ask = (p, { env = ENV, method = 'GET', headers = {}, body } = {}) =>
  app.handle(new Request('http://wimpy.local' + p, { method, headers: body ? { 'Content-Type': 'application/json', ...headers } : headers, body: body ? JSON.stringify(body) : undefined }), env, ctx);

head('A · /api/health: booleans only, no network call');
{
  fetches = 0;
  const r = await ask('/api/health'); const j = await r.json();
  ok(r.status === 200 && j.ok === true && j.service === 'wimpy' && typeof j.version === 'string', '200 {ok, service: wimpy, version}', JSON.stringify(j));
  ok(j.db_configured === true && j.hl_configured === false && j.cron_configured === true, 'says what is configured — db yes, HighLevel no, cron yes — as booleans', JSON.stringify(j));
  ok(fetches === 0, 'without touching the database', String(fetches));
  const bare = await (await ask('/api/health', { env: {} })).json();
  ok(bare.ok === true && bare.db_configured === false, 'answers even when nothing is configured (db_configured: false)', JSON.stringify(bare));
  ok(!JSON.stringify(j).includes('svc-test') && !JSON.stringify(j).includes('cron-test'), 'and carries no value, only booleans');
}

head('B · an unconfigured database → 503 on every API route, in words');
{
  for (const [p, method] of [['/api/wimpy/menu', 'GET'], ['/api/wimpy/signin', 'POST'], ['/api/wimpy/orders', 'GET'], ['/api/wimpy/cron/retry', 'GET']]) {
    const r = await ask(p, { env: { CRON_SECRET: 'x' }, method, body: method === 'POST' ? {} : undefined });
    ok(r.status === 503 && /SUPABASE_URL/.test(await r.text()), method + ' ' + p + ' → 503 naming the missing settings', String(r.status));
  }
}

head('C · the security headers on every answer — and vercel.json repeats them exactly');
{
  const want = hdr.SECURITY_HEADERS;
  for (const [p, status] of [['/api/health', 200], ['/api/nothing', 401], ['/api/wimpy/menu', 401], ['/nothing', 404]]) {   // an unknown /api path is behind the session gate, like the Worker's
    const r = await ask(p);
    const missing = Object.entries(want).filter(([k, v]) => r.headers.get(k) !== v).map(([k]) => k);
    ok(r.status === status && !missing.length, p + ' (' + status + ') carries all ' + Object.keys(want).length + ' security headers', missing.join(','));
  }
  const opt = await ask('/api/wimpy/menu', { method: 'OPTIONS' });
  ok(opt.status === 204 && !opt.headers.get('access-control-allow-origin'), 'OPTIONS → 204 and NO CORS header (one origin)', String(opt.status));
  const vj = JSON.parse(read('vercel.json'));
  const vh = Object.fromEntries(((vj.headers || [])[0] || {}).headers.map((h) => [h.key, h.value]));
  const diff = Object.entries(want).filter(([k, v]) => vh[k] !== v).map(([k]) => k).concat(Object.keys(vh).filter((k) => !(k in want)));
  ok(vj.headers && vj.headers[0].source === '/(.*)' && !diff.length, 'vercel.json headers for /(.*) equal SECURITY_HEADERS key for key', diff.join(','));
  ok(/connect-src 'self'/.test(hdr.CSP) && !/workers\.dev|supabase\.co/.test(hdr.CSP), "the CSP's connect-src is 'self' alone — the page reaches nothing but its own origin");
}

head('D · the client address: the socket unless a proxy is trusted');
{
  const req = (h) => ({ headers: new Headers(h) });
  const both = { 'x-forwarded-for': '1.2.3.4, 10.0.0.1', 'x-real-ip': '2.2.2.2', 'x-wimpy-socket-ip': '9.9.9.9' };
  ok(net.clientIp(req(both), {}) === '9.9.9.9', 'no TRUST_PROXY → the socket address, whatever x-forwarded-for says');
  ok(net.clientIp(req(both), { TRUST_PROXY: '0' }) === '9.9.9.9' && net.clientIp(req(both), { TRUST_PROXY: 'false' }) === '9.9.9.9', 'TRUST_PROXY=0 / false → still the socket');
  ok(net.clientIp(req(both), { TRUST_PROXY: '1' }) === '10.0.0.1', 'TRUST_PROXY=1 → the RIGHTMOST x-forwarded-for entry (what OUR proxy appended; a client-sent left entry is ignored)');
  ok(net.clientIp(req({ 'x-forwarded-for': 'junk, <script>', 'x-real-ip': '2.2.2.2', 'x-wimpy-socket-ip': '9.9.9.9' }), { TRUST_PROXY: '1' }) === '2.2.2.2', '…a malformed entry is not an address: x-real-ip is used instead');
  ok(net.clientIp(req({ 'x-wimpy-socket-ip': '9.9.9.9' }), { TRUST_PROXY: '1' }) === '', '…and NEVER the socket header under a trusted proxy (on Vercel nobody overwrites it) → ""');
  ok(net.clientIp(req({ 'x-wimpy-socket-ip': 'not-an-ip' }), {}) === '', 'a socket header that is not an address → ""');
  ok(net.clientIp(req({}), {}) === '', 'nothing known → "" (the per-account lock still applies; the network limit simply does not)');
}

head('E · the cron route: closed, refused, open');
{
  const closed = await ask('/api/wimpy/cron/retry', { env: { ...ENV, CRON_SECRET: '' } });
  ok(closed.status === 503, 'no CRON_SECRET → 503 (closed, never open)', String(closed.status));
  const wrong = await ask('/api/wimpy/cron/retry', { headers: { Authorization: 'Bearer cron-tesT' } });
  const none = await ask('/api/wimpy/cron/retry');
  ok(wrong.status === 401 && none.status === 401, 'a near-miss bearer or none → 401', wrong.status + ' ' + none.status);
  const right = await ask('/api/wimpy/cron/retry', { headers: { Authorization: 'Bearer cron-test' } });
  const j = await right.json();
  ok(right.status === 200 && j.ok === true && j.configured === false && j.counts, 'the right bearer → 200 with the retry summary (HighLevel not configured here: nothing touched)', JSON.stringify(j));
  const del = await ask('/api/wimpy/cron/retry', { method: 'DELETE', headers: { Authorization: 'Bearer cron-test' } });
  ok(del.status === 404, 'only GET/POST reach it', String(del.status));
}

head('F · the container refuses to start unconfigured');
{
  ok(JSON.stringify(srv.missingConfig({})) === '["SUPABASE_URL","SUPABASE_SECRET_KEY"]', 'nothing set → both names reported');
  ok(JSON.stringify(srv.missingConfig({ SUPABASE_URL: 'x' })) === '["SUPABASE_SECRET_KEY"]', 'one set → the other named');
  ok(srv.missingConfig(ENV).length === 0, 'both set → may start');
  const src = read('src/server.mjs');
  ok(/missingConfig\(env\)[\s\S]{0,300}process\.exit\(1\)/.test(src), 'main() exits 1 naming the variable, before listening');
}

head('G · the real Node server, booted on a free port, over HTTP');
{
  const boot = async (env) => { const s = srv.createServer(env); await new Promise((r) => s.listen(0, '127.0.0.1', r)); return s; };
  const get = (port, p, { method = 'GET', headers = {}, body } = {}) => new Promise((resolve, reject) => {
    const rq = http.request({ host: '127.0.0.1', port, path: p, method, headers }, (rs) => { const c = []; rs.on('data', (d) => c.push(d)); rs.on('end', () => resolve({ status: rs.statusCode, headers: rs.headers, text: Buffer.concat(c).toString('utf8') })); });
    rq.on('error', reject); if (body) rq.write(body); rq.end();
  });
  const s = await boot(ENV); const port = s.address().port;
  try {
    const page = await get(port, '/');
    ok(page.status === 200 && /text\/html/.test(page.headers['content-type']) && /Wimpy Order/.test(page.text) && page.text.includes("var API=''"), 'GET / serves the page (same-origin API constant)', page.status + ' ' + page.headers['content-type']);
    ok(page.headers['content-security-policy'] === hdr.CSP && page.headers['cache-control'] === 'no-store, must-revalidate' && page.headers['x-content-type-options'] === 'nosniff', '…with the security headers');
    const idx = await get(port, '/index.html'); ok(idx.status === 200 && idx.text === page.text, '/index.html is the same page');
    const hd = await get(port, '/', { method: 'HEAD' }); ok(hd.status === 200 && hd.text === '', 'HEAD / → 200, no body');
    const health = await get(port, '/api/health'); ok(health.status === 200 && JSON.parse(health.text).service === 'wimpy', '/api/health answers through the adapter');
    const menu = await get(port, '/api/wimpy/menu'); ok(menu.status === 401, 'the menu without a session → 401');
    const m2 = await get(port, '/api/wimpy/menu', { headers: { Authorization: 'Bearer tok-wimpy' } }); ok(m2.status === 200 && Array.isArray(JSON.parse(m2.text).items), '…and with a wimpy session → the menu');
    const m3 = await get(port, '/api/wimpy/menu', { headers: { Authorization: 'Bearer tok-full' } }); ok(m3.status === 403, '…a full session → 403 (the gate holds over HTTP too)');
    const nf = await get(port, '/anything/else'); ok(nf.status === 404 && /Not found/.test(nf.text), 'an unknown path → 404 JSON');
    const opt = await get(port, '/api/wimpy/order', { method: 'OPTIONS' }); ok(opt.status === 204, 'OPTIONS → 204');
    /* a FORGED address: without TRUST_PROXY the adapter drops x-forwarded-for and overwrites x-wimpy-socket-ip */
    LOG.length = 0;
    const forged = await get(port, '/api/wimpy/signin', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '1.2.3.4', 'x-wimpy-socket-ip': '5.5.5.5' }, body: JSON.stringify({ cb: 'CB9', password: 'x' }) });
    ok(forged.status === 401, 'a wrong sign-in over HTTP → 401', forged.status + ' ' + forged.text.slice(0, 80));
    ok(LOG.length >= 1 && LOG.every((l) => l.ip === '127.0.0.1'), 'the audit row carries the SOCKET address (127.0.0.1), not the forged x-forwarded-for or x-wimpy-socket-ip', JSON.stringify(LOG.map((l) => l.ip)));
    const big = await get(port, '/api/wimpy/order', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok-wimpy' }, body: '{"x":"' + 'a'.repeat(300 * 1024) + '"}' });
    ok(big.status === 413, 'a 300 KB body → 413', String(big.status));
    await s.drain();
    ok(true, 'drain() resolves with nothing in flight');
  } finally { s.close(); }
  const t = await boot({ ...ENV, TRUST_PROXY: '1' }); const tp = t.address().port;
  try {
    LOG.length = 0;
    await get(tp, '/api/wimpy/signin', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '1.2.3.4, 10.0.0.1' }, body: JSON.stringify({ cb: 'CB9', password: 'x' }) });
    ok(LOG.length >= 1 && LOG.every((l) => l.ip === '10.0.0.1'), 'with TRUST_PROXY=1 the audit row carries the RIGHTMOST x-forwarded-for entry (10.0.0.1 — the proxy\'s client), not the forged left one', JSON.stringify(LOG.map((l) => l.ip)));
    LOG.length = 0;
    const noJson = await get(tp, '/api/wimpy/signin', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ cb: 'CB9', password: 'x' }) });
    ok(noJson.status === 415 && LOG.length === 0, 'a POST that is not JSON → 415 before anything is looked up', String(noJson.status));
    const cookie = await get(tp, '/api/wimpy/menu', { headers: { Cookie: 'cbx_session=tok-wimpy' } });
    ok(cookie.status === 401, 'a session offered as the suite\'s cookie is never honoured — bearer only', String(cookie.status));
  } finally { t.close(); }
}

head('H · Dockerfile, compose, .dockerignore, vercel.json, package.json, .env.example, the Vercel entry');
{
  const df = read('Dockerfile');
  const dfCode = df.replace(/^#.*$/gm, '');   // the instructions, not the comments that explain them
  ok(/^FROM node:24-alpine/m.test(df) && !/npm (install|ci)/.test(dfCode) && /PORT:-8080/.test(df), 'FROM node:24-alpine and NO npm install (zero runtime dependencies)');
  ok(/^USER node/m.test(df) && /^HEALTHCHECK/m.test(df) && /\/api\/health/.test(df) && /CMD \["node", "src\/server\.mjs"\]/.test(df), 'runs as node, HEALTHCHECK on /api/health, CMD node src/server.mjs');
  ok(!/COPY \.(\s|$)|COPY \. /m.test(df) && !/\.env|SECRET|API_KEY/.test(df.replace(/^#.*$/gm, '')), 'copies src/, public/ and package.json only — never the tree, never an env file');
  const di = read('.dockerignore');
  ok(/^\*$/m.test(di) && /^!src\/$/m.test(di) && /^!public\/$/m.test(di) && /^!package\.json$/m.test(di) && !/^!api/m.test(di) && !/^!test/m.test(di) && !/^!\.env/m.test(di), '.dockerignore: everything out but src/, public/, package.json');
  const dc = read('docker-compose.yml');
  ok(/env_file:\s*\n\s*- \.env/.test(dc) && /RETRY_EVERY_MIN/.test(dc) && !/(API_KEY|SECRET_KEY)\s*[:=]\s*\S/.test(dc.replace(/^\s*#.*$/gm, '')), 'compose reads .env, sets the retry period, holds no value');
  const vj = JSON.parse(read('vercel.json'));
  ok(!vj.rewrites && !vj.functions && /omit=dev/.test(vj.installCommand || ''), 'vercel.json: no rewrites or per-function settings (the root entrypoint handles every path); dev dependencies are not installed');
  const appSrc = read('src/app.mjs');
  ok(/export default async function \(req, res\)/.test(appSrc) && /import\('\.\.\/api\/index\.mjs'\)/.test(appSrc) && /export const maxDuration = 30/.test(appSrc), 'src/app.mjs default-exports the Vercel entry (lazy — the container never loads @vercel/functions), Node (req, res) shape, and asks for 30 s');
  ok(typeof app.default === 'function' && typeof app.page === 'function' && app.page().length > 10000, '…and the core serves the page itself (page())');
  const pj = JSON.parse(read('package.json'));
  ok(pj.type === 'module' && pj.main === 'src/app.mjs' && /22/.test(pj.engines.node) && JSON.stringify(Object.keys(pj.dependencies)) === '["@vercel/functions"]', 'package.json: ESM, main = src/app.mjs, node>=22, the one dependency');
  const api = read('api/index.mjs');
  ok(/from '@vercel\/functions'/.test(api) && /TRUST_PROXY: '1'/.test(api) && /export default function vercelEntry\(req, res\)/.test(api) && /nodeRequestHandler\(ENV, ctx, \{ trust: true \}\)/.test(api) && ['GET', 'POST', 'DELETE', 'OPTIONS'].every((m) => new RegExp('export const ' + m + ' = run').test(api)), 'api/index.mjs: waitUntil from @vercel/functions, TRUST_PROXY on, a default entry that takes Node (req, res) or a Request, and one Web handler per method');
  /* the Node shape Vercel's root entrypoint actually uses — proved through a real http server wired to the Vercel entry */
  {
    const vmod = await import(pathToFileURL(path.join(ROOT, 'api', 'index.mjs')).href).catch((e) => ({ __error: String(e.message || e) }));
    if (vmod.__error) ok(/@vercel\/functions/.test(vmod.__error), 'api/index.mjs needs @vercel/functions (not installed here — skipped: ' + vmod.__error.slice(0, 60) + ')');
    else {
      const s = http.createServer((req, res) => vmod.default(req, res));
      await new Promise((r) => s.listen(0, '127.0.0.1', r));
      try {
        const port = s.address().port;
        const h = await new Promise((resolve, reject) => { http.get({ host: '127.0.0.1', port, path: '/api/health' }, (rs) => { const c = []; rs.on('data', (d) => c.push(d)); rs.on('end', () => resolve({ status: rs.statusCode, text: Buffer.concat(c).toString() })); }).on('error', reject); });
        ok(h.status === 200 && /"service":"wimpy"/.test(h.text), 'the Vercel entry answers a Node (req, res) call: GET /api/health → 200', h.status + ' ' + h.text.slice(0, 80));
      } finally { s.close(); }
    }
  }
  const names = new Set();
  for (const f of ['src/app.mjs', 'src/server.mjs', 'src/auth.mjs', 'src/wimpy.mjs', 'src/wimpy-hl.mjs', 'src/db.mjs', 'src/net.mjs']) for (const m of read(f).matchAll(/\benv\.([A-Z][A-Z0-9_]+)/g)) names.add(m[1]);
  const ex = read('.env.example');
  const undocumented = [...names].filter((n) => !new RegExp('^#? ?' + n + '=', 'm').test(ex));
  ok(names.size >= 8 && !undocumented.length, '.env.example documents every env.NAME the service reads (' + [...names].sort().join(', ') + ')', undocumented.join(','));
  ok(/^\.env$/m.test(read('.gitignore')) && /^!\.env\.example$/m.test(read('.gitignore')), '.gitignore ignores .env and keeps .env.example');
  const pageSrc = read('public/index.html');
  ok(/<link rel="icon" type="image\/svg\+xml" href="data:image\/svg\+xml,/.test(pageSrc) && !/<link[^>]+href="https?:/.test(pageSrc), 'the page carries an inline data-URI favicon and no external link (Spec Kit 023)');
}

console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
process.exit(fail ? 1 : 0);
