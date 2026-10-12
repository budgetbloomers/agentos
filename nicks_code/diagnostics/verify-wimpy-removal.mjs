#!/usr/bin/env node
/* verify-wimpy-removal.mjs — NOTHING OF WIMPY REMAINS IN THE SUITE, AND WHAT MUST STAY, STAYS (Spec Kit 018, 2026-10-09).
 *
 * Nick: "I want to remove it from vas analytics and put that on vercel". The lunch app is wimpy-service/ now. This guard
 * proves the suite side of the move:
 *   A · the files, routes, cron, allow-list entries, build steps and old guards are gone; WIMPY_URL is one address in the
 *       three places that name it (the Worker's refusal, the Pages redirect, the VAS Apps card); migration-058 exists
 *   B · through the REAL Worker with stubs: every former Wimpy route answers 410 naming the new address; a wimpy-scoped
 *       session is refused on EVERY route (including /api/me and /api/logout); a full session still works; the cron
 *       routes only the tick and the coaching wave, never a Wimpy retry
 *   C · what stays: the health alerts for the keys the SERVICE writes (kv:wimpy-hl-status, kv:wimpy-ledger-failed) still
 *       raise, and no longer tell anyone to run wrangler
 *   D · the agent app carries no Wimpy tab (the old verify-wimpy section L)
 *
 *   node nicks_code/diagnostics/verify-wimpy-removal.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const R = (rel) => path.join(ROOT, ...rel.split('/'));
const read = (rel) => (fs.existsSync(R(rel)) ? fs.readFileSync(R(rel), 'utf8').replace(/\r\n/g, '\n') : '');
const WIMPY_URL = 'https://phoenix-wimpy.vercel.app';

let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m + (d !== undefined ? ' — ' + d : '')); } };
const head = (t) => console.log('\n' + t);

head('A · GONE FROM THE SUITE; ONE ADDRESS IN THREE PLACES');
{
  for (const f of ['worker/src/wimpy.mjs', 'worker/src/wimpy-hl.mjs', 'wimpy/index.html', 'site/wimpy/index.html',
    'nicks_code/diagnostics/verify-wimpy.mjs', 'nicks_code/diagnostics/verify-wimpy-signin.mjs', 'nicks_code/diagnostics/verify-wimpy-history.mjs'])
    ok(!fs.existsSync(R(f)), f + ' no longer exists');
  for (const f of ['wimpy-service/src/app.mjs', 'wimpy-service/src/wimpy.mjs', 'wimpy-service/src/wimpy-hl.mjs', 'wimpy-service/src/auth.mjs', 'wimpy-service/public/index.html', 'wimpy-service/Dockerfile', 'wimpy-service/vercel.json'])
    ok(fs.existsSync(R(f)), f + ' exists (the move landed)');
  const idx = read('worker/src/index.mjs'), auth = read('worker/src/auth.mjs'), portal = read('worker/src/portal.mjs'), toml = read('worker/wrangler.toml');
  ok(!/from '\.\/wimpy(-hl)?\.mjs'/.test(idx) && !/signinWimpy/.test(idx), 'index.mjs imports nothing of Wimpy and no Wimpy sign-in');
  ok(!/WIMPY_CRON|WIMPY_MINUTES|retryDueOrders|wimpyMenu|submitWimpyOrder|listMyOrders/.test(idx), 'index.mjs has no Wimpy route handler and no Wimpy cron branch');
  ok(idx.includes("const WIMPY_URL = '" + WIMPY_URL + "'"), 'index.mjs names WIMPY_URL = ' + WIMPY_URL);
  ok(!/function signinWimpy|WIMPY_NET_MAX|WIMPY_SESSION_HOURS/.test(auth), 'auth.mjs no longer carries signinWimpy');
  ok(auth.includes("const WIMPY_NO_MATCH = 'That CB number and password do not match.'") && /SHARED-AUTH:lock BEGIN/.test(auth), '…but keeps WIMPY_NO_MATCH inside the shared lock block (checkPassword is shared with the service)');
  ok(!/\/api\/wimpy\//.test(portal), 'portal.mjs: no /api/wimpy entry on the agent allow-list');
  const crons = ((/^crons\s*=\s*\[([^\]]*)\]/m.exec(toml) || [])[1] || '').match(/"[^"]*"/g) || [];
  ok(crons.length === 2 && crons.includes('"*/10 * * * *"') && crons.includes('"3,23,43 * * * *"'), 'wrangler.toml: exactly the tick and the coaching trigger', crons.join(' '));
  ok(!/WIMPY_HL/.test(toml.replace(/^#.*$/gm, '')) && !/wrangler secret put WIMPY/.test(toml), 'wrangler.toml no longer tells anyone to set a Wimpy secret on the Worker');
  ok(idx.includes('const COACHING_CRON = "3,23,43 * * * *"') && !/SHARED_CRON/.test(idx), 'index.mjs names COACHING_CRON = "3,23,43 * * * *" and no shared trigger');
  const prep = read('tools/prepare-site.js');
  ok(!/\['wimpy', 'wimpy'/.test(prep) && !/'wimpy\/index\.html'/.test(prep), 'prepare-site.js builds no /wimpy/ and expects no wimpy shell');
  const redirects = read('site/_redirects');
  ok(new RegExp('^/wimpy/\\*\\s+' + WIMPY_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/:splat\\s+302', 'm').test(redirects), 'site/_redirects forwards /wimpy/* to ' + WIMPY_URL + ' (302)');
  const pulse = read('nicks_code/index.html');
  ok(!/\{name:'Wimpy Order'/.test(pulse), 'the VAS Apps page carries NO Wimpy card any more (Nick, 2026-10-09: the floor gets the Vercel link directly)');
  const mig = read('supabase/migration-058-wimpy-service.sql');
  ok(/delete\s+from\s+app_sessions\s+where\s+scope\s*=\s*'wimpy'/i.test(mig), 'migration-058 ends every Wimpy session the old Worker minted');
  const yml = read('.github/workflows/verify.yml');
  ok(!/verify-wimpy(-signin|-history)? /.test(yml) && /verify-wimpy-removal/.test(yml) && /verify-wimpy-service-drift/.test(yml), 'verify.yml runs the two new guards and none of the three ported ones');
  ok(/wimpy-service/.test(yml) && /npm test/.test(yml), '…and the service\'s own tests');
  ok(/wimpy-service/.test(read('CLAUDE.md')), 'CLAUDE.md knows wimpy-service/');
  const sweep = read('nicks_code/diagnostics/verify-agent-sweep-014.mjs');
  ok(!/WIMPY_PAGE|A3 · A4 · A5/.test(sweep), 'verify-agent-sweep-014 no longer drives the Wimpy page (ported to wimpy-service/test/page-sweep.test.mjs)');
}

/* ════════════════════ the real Worker, stubbed ════════════════════ */
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const SESS = {};
const mk = (token, scope, role = 'admin') => { SESS[sha(token)] = { user_id: 'u-' + token, expires_at: '2099-01-01T00:00:00Z', scope,
  app_users: { username: 'person-' + token, full_name: 'P ' + token, role, apps: ['ops', 'vas', 'wimpy'], tabs: null, pii_unmask: false, active: true, cb: null, team: null, hub_ids: null, must_change_password: false, theme: null } }; };
mk('tok-w', 'wimpy'); mk('tok-f', 'full'); mk('tok-r', 'referrals');
let urls = [];
const J = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
globalThis.fetch = async (u, o = {}) => {
  const raw = String(u), method = String(o.method || 'GET').toUpperCase(); urls.push(method + ' ' + raw);
  const url = new URL(raw);
  if (url.host === 'stub.local') {
    if (url.pathname === '/rest/v1/app_sessions') { const m = /^eq\.(.*)$/.exec(url.searchParams.get('token_hash') || ''); const s = m && SESS[m[1]]; return J(s ? [s] : []); }
    if (method === 'POST' || method === 'PATCH' || method === 'DELETE') return new Response('', { status: 201 });
    return J([]);
  }
  if (/convex\.cloud$/.test(url.host)) return J({ status: 'error', errorMessage: 'stub' });
  return new Response('', { status: 404 });
};
const ENV = { SUPABASE_URL: 'http://stub.local', SUPABASE_SECRET_KEY: 'svc-test' };
const pending = []; const ctx = { waitUntil: (p) => { pending.push(Promise.resolve(p).catch(() => {})); } }; const settle = async () => { while (pending.length) await Promise.all(pending.splice(0)); };
const worker = (await import(pathToFileURL(R('worker/src/index.mjs')).href).catch((e) => ({ default: null, __error: String(e.message || e) })));
async function call(method, p, { token, body } = {}) {
  urls = [];
  const h = { 'X-Cbx-Client': 'v5' }; if (token) h.Authorization = 'Bearer ' + token; if (body !== undefined) h['Content-Type'] = 'application/json';
  const r = await worker.default.fetch(new Request('https://api.local' + p, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), ENV, ctx);
  await settle();
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) { j = null; }
  return { status: r.status, t, j };
}

head('B · THROUGH THE WORKER: 410 ON EVERY FORMER ROUTE, 403 FOR A WIMPY SESSION EVERYWHERE, THE CRON WITHOUT WIMPY');
if (!worker.default) ok(false, 'the Worker imports', worker.__error);
else {
  for (const [method, p] of [['GET', '/api/wimpy/menu'], ['POST', '/api/wimpy/order'], ['GET', '/api/wimpy/orders'], ['POST', '/api/wimpy/signin'], ['GET', '/api/wimpy/cron/retry'], ['GET', '/api/portal/wimpy/menu'], ['POST', '/api/portal/wimpy/order']]) {
    for (const token of [null, 'tok-w', 'tok-f']) {
      const r = await call(method, p, { token, body: method === 'POST' ? {} : undefined });
      ok(r.status === 410 && r.j && r.j.error && r.j.error.includes(WIMPY_URL), method + ' ' + p + (token ? ' (' + token + ')' : ' (no session)') + ' → 410 naming ' + WIMPY_URL, r.status + ' ' + r.t.slice(0, 120));
    }
  }
  for (const [method, p] of [['GET', '/api/me'], ['POST', '/api/logout'], ['GET', '/api/kv?key=vas-state'], ['GET', '/api/agent-digest'], ['GET', '/api/portal/me'], ['GET', '/api/roster'], ['GET', '/api/health']]) {
    const r = await call(method, p, { token: 'tok-w' });
    ok(r.status === 403 && r.j && /Wimpy orders only/.test(r.j.error || '') && (r.j.error || '').includes(WIMPY_URL), 'a wimpy-scoped session on ' + method + ' ' + p + ' → 403 naming the new address', r.status + ' ' + r.t.slice(0, 120));
  }
  const me = await call('GET', '/api/me', { token: 'tok-f' });
  ok(me.status === 200 && me.j && me.j.user && me.j.user.username === 'person-tok-f', 'a full session still reads /api/me', me.status + ' ' + me.t.slice(0, 80));
  const ref = await call('GET', '/api/me', { token: 'tok-r' });
  ok(ref.status === 200, '…and the referrals fence is unchanged (/api/me still answers it above the gate)', String(ref.status));
  /* the cron: the tick, the coaching wave, and nothing for :07/:27/:47 but the pre-015 fallback */
  const cron = async (expr) => { urls = []; await worker.default.scheduled({ cron: expr, scheduledTime: Date.parse('2026-10-09T08:07:00Z') }, ENV, ctx); await settle(); return urls.slice(); };
  const ran = (u) => ({ tick: u.some((x) => /upload-manifest/.test(x)), coaching: u.some((x) => /coaching-waves|convex/.test(x)), wimpy: u.some((x) => /wimpy_orders|leadconnector/.test(x)) });
  const t = ran(await cron('*/10 * * * *')), c = ran(await cron('3,23,43 * * * *')), w = ran(await cron('7,27,47 * * * *')), s = ran(await cron('3,7,23,27,43,47 * * * *'));
  ok(t.tick && !t.wimpy, 'the tick runs the tick and touches no Wimpy table', JSON.stringify(t));
  ok(c.coaching && !c.tick && !c.wimpy, '"3,23,43" runs the coaching wave only', JSON.stringify(c));
  ok(!w.wimpy && !w.tick && !s.wimpy && !s.tick, 'the old Wimpy minutes and the old shared trigger never touch a Wimpy table (unknown → the coaching fallback)', JSON.stringify({ w, s }));
}

head('C · WHAT STAYS: THE HEALTH ALERTS FOR THE KEYS THE SERVICE WRITES');
{
  const health = await import(pathToFileURL(R('worker/src/health.mjs')).href).catch((e) => ({ __error: String(e.message || e) }));
  ok(!health.__error, 'health.mjs imports', health.__error);
  if (!health.__error) {
    const NOW = Date.parse('2026-10-09T09:00:00Z');
    const ev = (extra) => health.evaluateFreshness({ now: NOW, manifestAt: null, vasAt: null, opsAt: null, staffLoginRecent: false, ...extra });
    const s = ev({ wimpyHl: { at: '2026-10-09T08:47:00Z', configured: true, counts: { pending: 0, failed: 1, stuck: 2 }, last_error: 'card: HighLevel answered 401' } }).find((x) => x.id === 'wimpy-hl-stuck');
    ok(!!s && /2 Wimpy order/.test(s.message) && /re-queue|pending/i.test(s.message), 'stuck rows (written by the service) → "wimpy-hl-stuck", naming how many and how to re-queue', s && s.message);
    const nc = ev({ wimpyHl: { configured: false, counts: { pending: 4, failed: 0, stuck: 0 } } }).find((x) => x.id === 'wimpy-hl-not-configured');
    ok(!!nc && /4/.test(nc.message) && /WIMPY_HL_API_KEY/.test(nc.message), 'HighLevel not configured with orders waiting → "wimpy-hl-not-configured" naming the variables', nc && nc.message);
    ok(nc && !/wrangler|on the Worker/i.test(nc.message) && /service|Vercel|container/i.test(nc.message), '…and it says where to set them now (the service), never wrangler', nc && nc.message);
    ok(!ev({ wimpyHl: { configured: true, counts: { pending: 3, failed: 2, stuck: 0 } } }).some((x) => /^wimpy-/.test(x.id)), 'pending and failed rows alone raise nothing');
    const lf = ev({ wimpyLedgerFailed: { at: '2026-10-09T07:00:00Z', error: '500 stub' } }).find((x) => x.id === 'wimpy-ledger-failed');
    ok(!!lf && !/Worker log/.test(lf.message), 'a lost ledger row in the last 24 h → "wimpy-ledger-failed", pointing at the service log', lf && lf.message);
    ok(!ev({}).some((x) => /^wimpy-/.test(x.id)), 'no status row → no opinion');
    ok(/kv:wimpy-hl-status,kv:wimpy-ledger-failed/.test(read('worker/src/health.mjs')), 'runHealthChecks still reads both keys inside the sentinel\'s first select');
  }
}

head('D · THE AGENT APP CARRIES NO WIMPY TAB (the old verify-wimpy section L)');
{
  const agentPage = read('agent/index.html');
  for (const gone of ['wimpyPage', 'wireWimpy', 'wimpyOpenNow', 'WCART', 'WMENU', 'wp-hero', 'ICON.wimpy']) ok(agentPage.indexOf(gone) < 0, 'the agent app no longer carries ' + gone);
  ok(!/\['wimpy','Wimpy Order'/.test(agentPage), 'and the nav has no Wimpy tab');
}

console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
process.exit(fail ? 1 : 0);
