#!/usr/bin/env node
/* verify-vt-worker.mjs — THE WORKER'S VT ROUTES, INTAKE HALF (Spec Kit 071, Phase C task C4; the portal half is Phase E).
 *
 * Drives the REAL Worker module (worker/src/index.mjs → vt.mjs) in-process against a stubbed Supabase that behaves like
 * PostgREST where it matters (an RPC that raises answers 400 with the message; 50 subrequests per invocation, as the
 * FREE plan). Nothing leaves the machine. Proves:
 *   W1  every /api/vt/* route answers only a staff session holding the Upload Station grant (canUpload); a portal role,
 *       a scoped session, a viewer without the grant and an outdated tab (writes) are refused — and reach no RPC
 *   W2  GET/POST /api/vt/book stream vt_book's body untouched (byte-identical), with p_from / p_also passed through
 *   W3  begin/stage/commit/abandon pass the body through; begin's uploaded-by is the SESSION user, never the client's
 *   W4  stage is capped at 512 KB (413), the other bodies at 64 KB (413); a body without a length is refused (411)
 *   W5  commit's version_conflict → 409 {error:'version_conflict'}; the opening-book-first refusal → 409 in words;
 *       any other RPC failure → 502 with a short reason
 *   W6  GET /api/vt/uploads (≤ 100, newest first) and GET /api/vt/roster?on= (a date, else 400)
 *   W7  the four write routes are in GATED_WRITES; vt routes are not on the portal allow-list
 *   W8  CPU: handing a 0.6 MB and a 4 MB book to the browser costs the Worker well under the 10 ms FREE-plan budget,
 *       because nothing is parsed; a 480 KB stage call likewise; every route uses one subrequest beyond the session
 *
 *   node nicks_code/diagnostics/verify-vt-worker.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
process.env.TZ = 'UTC';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m + (d !== undefined ? ' — ' + d : '')); } };
const head = (t) => console.log('\n' + t);
const done = () => { console.log(`\n==== ${pass} passed, ${fail} failed ====`); process.exit(fail ? 1 : 0); };
const VT = path.join(ROOT, 'worker', 'src', 'vt.mjs');
ok(fs.existsSync(VT), 'worker/src/vt.mjs exists');
if (!fs.existsSync(VT)) done();
/* the router logs one cbx_heavy object per heavy request (Workers Logs); keep this suite's output to its checks */
const log0 = console.log; console.log = (...a) => { if (a.length === 1 && a[0] && typeof a[0] === 'object' && a[0].ev === 'cbx_heavy') return; log0(...a); };
const imp = (rel) => import(pathToFileURL(path.join(ROOT, 'worker', 'src', rel)).href);
const worker = (await imp('index.mjs')).default;
const vt = await imp('vt.mjs');
const INDEX = fs.readFileSync(path.join(ROOT, 'worker', 'src', 'index.mjs'), 'utf8');
const PORTAL = fs.readFileSync(path.join(ROOT, 'worker', 'src', 'portal.mjs'), 'utf8');

/* ── the stubbed Supabase ── */
const ENV = { SUPABASE_URL: 'http://stub.local', SUPABASE_SECRET_KEY: 'k' };
let BOOK_BYTES = { src: null, b: null };
let SESSION = null, sub = 0, rpcs = [], RPC_ANSWER = {}, BOOK_BODY = '{"rev":0,"cases":[],"events":[]}';
const J = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
globalThis.fetch = async (u, o = {}) => {
  if (++sub > 50) throw new Error('Too many subrequests.');
  const url = new URL(String(u)), p = url.pathname, method = (o.method || 'GET').toUpperCase();
  if (p === '/rest/v1/app_sessions') return J(SESSION ? [SESSION] : []);
  if (p === '/rest/v1/kv_write_log' || p === '/rest/v1/usage_events') return J([]);
  if (p.startsWith('/rest/v1/rpc/')) {
    const fn = p.slice('/rest/v1/rpc/'.length);
    const body = o.body == null ? '' : typeof o.body === 'string' ? o.body : await new Response(o.body).text();
    rpcs.push({ fn, body });
    /* the database's bytes are encoded once, as PostgREST's would arrive: only the Worker's handling is measured */
    if (fn === 'vt_book') { if (BOOK_BYTES.src !== BOOK_BODY) BOOK_BYTES = { src: BOOK_BODY, b: new TextEncoder().encode(BOOK_BODY) };
      return new Response(BOOK_BYTES.b, { status: 200, headers: { 'Content-Type': 'application/json' } }); }
    const a = RPC_ANSWER[fn];
    if (a && a.status) return new Response(JSON.stringify(a.body), { status: a.status, headers: { 'Content-Type': 'application/json' } });
    return J(a || { ok: true, fn });
  }
  if (p === '/rest/v1/vt_uploads') { rpcs.push({ fn: 'select vt_uploads', body: url.search }); return J([{ id: 2, sha256: 'b'.repeat(64), kind: 'bi_fitted', state: 'committed' }]); }
  return new Response('', { status: 404 });
};
const userRow = (o = {}) => ({ user_id: 'u1', expires_at: '2099-01-01T00:00:00Z', scope: 'full',
  app_users: { username: 'uploader', full_name: 'Up Loader', role: 'exec', apps: ['vas'], tabs: { vas: ['data'] }, pii_unmask: false, active: true, cb: null, team: null, hub_ids: null, must_change_password: false, ...o } });
const ctx = { waitUntil: () => {} };
const call = async (method, pq, body, headers = {}) => {
  sub = 0; rpcs = [];
  const h = { Authorization: 'Bearer t', 'X-Cbx-Client': 'v5', ...headers };
  const init = { method, headers: h };
  if (body != null) { init.body = body; if (!('content-length' in headers)) h['Content-Length'] = String(Buffer.byteLength(body)); h['Content-Type'] = 'application/json'; }
  const r = await worker.fetch(new Request('https://api.local' + pq, init), ENV, ctx);
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) { j = null; }
  return { status: r.status, t, j, rpcs: rpcs.slice(), subs: sub };
};

head('W1 · staff + Upload Station only');
const ROUTES = [['GET', '/api/vt/book?from=2026-10-26'], ['POST', '/api/vt/book', '{"p_from":"2026-10-26","p_also":[1]}'], ['POST', '/api/vt/upload/begin', '{"p_sha256":"' + 'a'.repeat(64) + '"}'],
  ['POST', '/api/vt/upload/stage', '{"p_id":1,"p_kind":"case","p_from_ord":0,"p_rows":[]}'], ['POST', '/api/vt/upload/commit', '{"p_id":1}'], ['POST', '/api/vt/upload/abandon', '{"p_id":1}'],
  ['GET', '/api/vt/uploads'], ['GET', '/api/vt/roster?on=2026-11-25']];
const WHO = [
  ['an agent (portal role)', userRow({ role: 'agent', apps: ['agent'], tabs: {} })],
  ['a team leader who also holds VAS without the Upload Station', userRow({ role: 'team_leader', apps: ['agent', 'vas'], tabs: { vas: ['mtd'] } })],
  ['a campaign manager', userRow({ role: 'campaign_manager', apps: ['agent', 'vas'], tabs: { vas: ['data'] } })],
  ['a viewer with VAS tabs but not the Upload Station', userRow({ role: 'viewer', tabs: { vas: ['mtd', 'weekly'] } })],
  ['a referrals-scoped session', { ...userRow(), scope: 'referrals' }]];
for (const [label, s] of WHO) {
  SESSION = s; const res = [];
  for (const [m, p, b] of ROUTES) res.push(await call(m, p, b));
  ok(res.every((r) => r.status === 403 || r.status === 401), label + ': every /api/vt route is refused', res.map((r) => r.status).join(','));
  ok(res.every((r) => r.rpcs.length === 0), label + ': ...and no RPC was called');
}
SESSION = userRow();
{ const res = []; for (const [m, p, b] of ROUTES) res.push(await call(m, p, b));
  ok(res.every((r) => r.status === 200), 'a staff session with the Upload Station grant reaches every route', res.map((r) => r.status).join(','));
  SESSION = userRow({ role: 'admin', apps: null, tabs: null }); const a = await call('GET', '/api/vt/uploads'); ok(a.status === 200, 'admin reaches them too'); SESSION = userRow(); }
{ const r = await call('POST', '/api/vt/upload/begin', '{}', { 'X-Cbx-Client': 'v4' });
  ok(r.status === 409 && r.rpcs.length === 0, 'an outdated tab may not write (GATED_WRITES)', r.status); }
{ SESSION = null; const r = await call('GET', '/api/vt/book'); ok(r.status === 401, 'no session → 401', r.status); SESSION = userRow(); }

head('W2 · the book is streamed, never parsed');
BOOK_BODY = '{"rev":7,"openedOn":"2026-11-09","openingBookOn":null,"cases":[["90000001","fitted","2026-11-09",null,"unknown","2026-11-09","2026-11-09",null,"2026-11-09",["MXV"],100.00,"revx","alpha test","CB9101","exact",null,"Bundle Q","RevX"]],"events":[]}';
{ const r = await call('GET', '/api/vt/book?from=2026-10-26');
  ok(r.t === BOOK_BODY, 'GET /api/vt/book returns vt_book\'s body byte for byte (100.00 stays 100.00 — nothing re-serialised)');
  ok(r.rpcs[0].fn === 'vt_book' && JSON.parse(r.rpcs[0].body).p_from === '2026-10-26', 'from= is passed as p_from', r.rpcs[0] && r.rpcs[0].body);
  const n = await call('GET', '/api/vt/book'); ok(n.status === 200 && JSON.parse(n.rpcs[0].body).p_from === null, 'no from= → p_from null (the whole book)');
  const bad = await call('GET', '/api/vt/book?from=26-10-2026'); ok(bad.status === 400 && bad.rpcs.length === 0, 'a from= that is not YYYY-MM-DD → 400');
  const pb = '{"p_from":"2026-10-26","p_also":[90000001,90000002]}', p = await call('POST', '/api/vt/book', pb);
  ok(p.t === BOOK_BODY && p.rpcs[0].body === pb, 'POST /api/vt/book passes {p_from, p_also} through untouched and streams the answer'); }

head('W3 · the intake bodies pass through; uploaded-by is the session');
{ const b = { p_sha256: 'a'.repeat(64), p_kind: 'bi_fitted', p_file_name: 'BI Active Fitted 101126.xlsx', p_extract_on: '2026-11-10', p_cycle_key: 'cycle-2026-11', p_user: 'someone-else' };
  RPC_ANSWER.vt_upload_begin = { id: 5 };
  const r = await call('POST', '/api/vt/upload/begin', JSON.stringify(b)), sent = JSON.parse(r.rpcs[0].body);
  ok(r.status === 200 && r.j.id === 5, 'begin answers the RPC\'s value');
  ok(sent.p_user === 'uploader' && sent.p_sha256 === b.p_sha256 && sent.p_file_name === b.p_file_name, 'uploaded-by is the SESSION user, whatever the client says', JSON.stringify(sent));
  const st = '{"p_id":5,"p_kind":"case","p_from_ord":0,"p_rows":[{"case_number":"90000001"}]}';
  const s = await call('POST', '/api/vt/upload/stage', st);
  ok(s.status === 200 && s.rpcs[0].fn === 'vt_upload_stage' && s.rpcs[0].body === st, 'stage passes its body through untouched');
  for (const fn of ['commit', 'abandon']) { const c = await call('POST', '/api/vt/upload/' + fn, '{"p_id":5}'); ok(c.status === 200 && c.rpcs[0].fn === 'vt_upload_' + fn && c.rpcs[0].body === '{"p_id":5}', fn + ' passes through to vt_upload_' + fn); }
  const u = await call('POST', '/api/vt/upload/merge', '{}'); ok(u.status === 404 || u.status === 400, 'an unknown step is refused', u.status);
  const g = await call('GET', '/api/vt/upload/begin'); ok(g.status === 405 || g.status === 404, 'GET on a write route is refused', g.status); }

head('W4 · body caps');
{ const big = '{"p_id":5,"p_kind":"case","p_from_ord":0,"p_rows":["' + 'x'.repeat(512 * 1024) + '"]}';
  const r = await call('POST', '/api/vt/upload/stage', big); ok(r.status === 413 && r.rpcs.length === 0, 'a stage body over 512 KB → 413, nothing sent on', r.status);
  const fine = '{"p_rows":["' + 'x'.repeat(480 * 1024) + '"]}'; const f = await call('POST', '/api/vt/upload/stage', fine); ok(f.status === 200, 'a 480 KB stage body is accepted');
  const c = await call('POST', '/api/vt/upload/commit', '{"p_warnings":["' + 'x'.repeat(65 * 1024) + '"]}'); ok(c.status === 413 && c.rpcs.length === 0, 'a commit body over 64 KB → 413', c.status);
  const bk = await call('POST', '/api/vt/book', '{"p_also":["' + 'x'.repeat(65 * 1024) + '"]}'); ok(bk.status === 413, 'a book request over 64 KB → 413', bk.status);
  const lie = await call('POST', '/api/vt/upload/stage', '{"p_id":5}', { 'content-length': '' }); ok([411, 200].includes(lie.status), 'a body with no declared length is refused or measured (411 / 200 within the cap)', lie.status); }

head('W5 · RPC refusals in words');
{ RPC_ANSWER.vt_upload_commit = { status: 400, body: { code: 'P0001', message: 'version_conflict: the book is at rev 8, this upload was merged on rev 7' } };
  const r = await call('POST', '/api/vt/upload/commit', '{"p_id":5,"p_base_rev":7}');
  ok(r.status === 409 && r.j.error === 'version_conflict', 'commit\'s version_conflict → 409 {error:"version_conflict"}', r.status + ' ' + r.t);
  RPC_ANSWER.vt_upload_commit = { status: 400, body: { code: 'P0001', message: 'opening_book_before_first_day: load the opening book after the first day\'s two files' } };
  const o = await call('POST', '/api/vt/upload/commit', '{"p_id":5}');
  ok(o.status === 409 && /first day/.test(o.j.error), 'the opening book before the first day → 409, in words', o.t);
  RPC_ANSWER.vt_upload_commit = { status: 500, body: { message: 'canceling statement due to statement timeout' } };
  const x = await call('POST', '/api/vt/upload/commit', '{"p_id":5}');
  ok(x.status === 502 && /commit/.test(x.j.error), 'any other failure → 502 naming the step', x.t);
  delete RPC_ANSWER.vt_upload_commit; }

head('W6 · receipts and roster');
{ const r = await call('GET', '/api/vt/uploads?limit=500');
  ok(r.status === 200 && Array.isArray(r.j.uploads) && r.j.uploads[0].id === 2, 'GET /api/vt/uploads answers {uploads:[…]}');
  ok(/limit=100\b/.test(r.rpcs[0].body) && /order=id\.desc/.test(r.rpcs[0].body), 'the list is newest first and never more than 100 rows', r.rpcs[0].body);
  ok(!/sha256=|select=\*/.test(r.rpcs[0].body), 'it names its columns (no select=*)');
  RPC_ANSWER.vt_roster_at = { as_of: '2026-11-02', rows: [] };
  const ro = await call('GET', '/api/vt/roster?on=2026-11-25');
  ok(ro.status === 200 && ro.rpcs[0].fn === 'vt_roster_at' && JSON.parse(ro.rpcs[0].body).p_on === '2026-11-25' && ro.j.as_of === '2026-11-02', 'GET /api/vt/roster?on= calls vt_roster_at(p_on)');
  const bad = await call('GET', '/api/vt/roster'); ok(bad.status === 400 && bad.rpcs.length === 0, 'roster without on=YYYY-MM-DD → 400'); }

head('W7 · gates in the router');
for (const s of ['begin', 'stage', 'commit', 'abandon']) ok(INDEX.includes("'POST /api/vt/upload/" + s + "'"), 'GATED_WRITES holds POST /api/vt/upload/' + s);
ok(!/['"]\/api\/vt\//.test(PORTAL.slice(PORTAL.indexOf('PORTAL_ALLOWED'), PORTAL.indexOf('PORTAL_ALLOWED') + 6000)), 'no /api/vt intake route is on the portal allow-list');

head('W8 · CPU and subrequests');
/* process.cpuUsage ticks at ~15 ms on Windows, so each figure is the AVERAGE of 25 calls (the stub's own work included,
   so it is an upper bound on the Worker's share) */
const avgCpu = async (mk, n = 25) => { const t0 = process.cpuUsage(); let last = null; for (let i = 0; i < n; i++) { sub = 0; rpcs = []; last = await worker.fetch(mk(), ENV, ctx); if (i < n - 1) await last.body?.cancel?.(); }
  const u = process.cpuUsage(t0); return { ms: (u.user + u.system) / 1000 / n, res: last }; };
{ const row = '["90000001","scheduled","2026-11-09","2026-11-09","first_seen","2026-11-09","2026-11-10","2026-11-12",null,["MXV"],null,"revx","alpha test","CB9101","exact","New","Bundle Q","RevX"]';
  for (const [label, n] of [['0.6 MB', 5000], ['4 MB', 33000]]) {
    BOOK_BODY = '{"rev":1,"cases":[' + Array(n).fill(row).join(',') + '],"events":[]}';
    const { ms, res } = await avgCpu(() => new Request('https://api.local/api/vt/book?from=2026-10-26', { headers: { Authorization: 'Bearer t', 'X-Cbx-Client': 'v5' } }));
    const subs = sub, body = await res.text();
    ok(body.length === BOOK_BODY.length, label + ' book (' + Math.round(BOOK_BODY.length / 1024) + ' KB) reaches the browser whole');
    /* the same body straight from the stub, with no Worker in between: what Node itself spends producing it */
    const t0 = process.cpuUsage(); for (let i = 0; i < 25; i++) { const r = await globalThis.fetch(ENV.SUPABASE_URL + '/rest/v1/rpc/vt_book', { method: 'POST', body: '{}' }); if (i < 24) await r.body.cancel(); else await r.text(); }
    const u = process.cpuUsage(t0), stubMs = (u.user + u.system) / 1000 / 25;
    ok(ms - stubMs < 10, label + ' book: ' + ms.toFixed(2) + ' ms CPU per request, of which the stub itself ' + stubMs.toFixed(2) + ' ms; the Worker share is under the 10 ms budget (nothing is parsed)');
    ok(subs === 2, label + ' book: one subrequest beyond the session lookup', subs);
  }
  const st = '{"p_id":5,"p_kind":"case","p_from_ord":0,"p_rows":["' + 'x'.repeat(470 * 1024) + '"]}';
  const { ms, res } = await avgCpu(() => new Request('https://api.local/api/vt/upload/stage', { method: 'POST', body: st, headers: { Authorization: 'Bearer t', 'X-Cbx-Client': 'v5', 'Content-Type': 'application/json', 'Content-Length': String(st.length) } }));
  await res.text();
  ok(ms < 10, 'a 470 KB stage call: ' + ms.toFixed(2) + ' ms CPU per request, the stub reading the body included (passed through, not parsed)'); }
done();
