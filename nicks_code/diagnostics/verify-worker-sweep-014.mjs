#!/usr/bin/env node
/* verify-worker-sweep-014.mjs — THE WORKER HALF OF THE 014 BUG SWEEP (Spec Kit 014, Area W, 2026-10-07).
 *
 * Drives the REAL Worker module in-process against a stubbed Supabase (the verify-kv-large-store harness) that behaves
 * like the real one where it matters: Storage URLs are normalised the way fetch normalises them (so `..` resolves),
 * PostgREST answers at most 1000 rows per request, and an invocation past 50 subrequests throws "Too many subrequests"
 * exactly as the Cloudflare FREE plan does.
 *
 *   W1  /api/kv refuses a key that is not a plain name — `zzz/../agent-digest` must never reach Storage
 *   W2  /api/agent-signins and GET /api/bi page past PostgREST's 1000-row cap, inside the 50-subrequest budget
 *   W3  POST /api/bi: a failure after the batch row is written removes that row (and says so) — the re-upload loads
 *   W4  /api/agent-digest refuses a session whose scope is not 'full'
 *   W5  hubs.mjs: the default coaching date and the KPI form's month/year are the SAST day
 *   W-R1 the page budget fits the FREE plan's 10 ms CPU: 12 pages of sign-ins, 5 of BI rows a request
 *   W-R2 POST /api/bi's worst case (the last of 44 chunks fails) cleans up with a subrequest to spare
 *   W-R3 pins who writes nba-digest / ai-digest-* today (scoped sessions refused, staff roles write)
 *
 *   node nicks_code/diagnostics/verify-worker-sweep-014.mjs
 */
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

/* A Worker runs in UTC. This PC runs in SAST, where local-time getters (getFullYear, toLocaleString) happen to give the
   right answer and would hide W5 — so the suite runs in the Worker's zone. */
process.env.TZ = 'UTC';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const imp = (rel) => import(pathToFileURL(path.join(ROOT, 'worker', 'src', rel)).href);
const worker = (await imp('index.mjs')).default;
const rulesMod = await imp('rules.mjs');
const hubs = await imp('hubs.mjs');
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m + (d ? ' — ' + d : '')); } };
const head = (t) => console.log('\n' + t);

/* ── the stubbed Supabase ── */
const PG_MAX_ROWS = 1000, SUBREQ_CAP = 50;
const ENV = { SUPABASE_URL: 'http://stub.local', SUPABASE_SECRET_KEY: 'k' };
const rules = {}, store = {}, storageOps = [];
let authLog = [], appUsers = [], biRows = [], batches = [];
let biInsertFailOn = 0, biInsertCalls = 0, biSpanDeleteFails = false;   // fault injection for W3
let SESSION = null;                                                        // what app_sessions answers
let sub = 0, subMax = 0;                                                   // subrequests in the current invocation
const convexCalls = [];
const J = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
const param = (u, k) => u.searchParams.getAll(k);
/* PostgREST paging: limit (capped at max-rows) + offset, after the filters */
const page = (rows, u) => {
  const off = Number(u.searchParams.get('offset')) || 0;
  const lim = Math.min(Number(u.searchParams.get('limit')) || PG_MAX_ROWS, PG_MAX_ROWS);
  return rows.slice(off, off + lim);
};
const cmp = (op, a, b) => (op === 'gte' ? a >= b : op === 'lte' ? a <= b : op === 'eq' ? a === b : op === 'gt' ? a > b : true);
const filt = (rows, u, col) => {
  let out = rows;
  for (const f of param(u, col)) { const i = f.indexOf('.'); const op = f.slice(0, i), v = f.slice(i + 1); out = out.filter((r) => cmp(op, String(r[col]), v)); }
  return out;
};

globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
globalThis.fetch = async (u, o = {}) => {
  if (++sub > SUBREQ_CAP) throw new Error('Too many subrequests.');
  subMax = Math.max(subMax, sub);
  const raw = String(u), method = (o.method || 'GET').toUpperCase();
  if (/convex\.cloud/.test(raw)) { convexCalls.push({ url: raw, body: JSON.parse(o.body) }); return J({ status: 'success', value: 'id-' + convexCalls.length }); }
  const url = new URL(raw);   // exactly what the runtime does to the URL: `a/../b` → `b`
  const p = url.pathname;
  if (p === '/rest/v1/app_sessions') return J(SESSION ? [SESSION] : []);
  if (p === '/rest/v1/kv_write_log') return J([]);
  if (p === '/rest/v1/rules') {
    const m = /^eq\.(.*)$/.exec(url.searchParams.get('key') || ''); const k = m ? m[1] : '';
    if (method === 'GET') return J(rules[k] ? [{ key: k, value: rules[k].value, updated_at: rules[k].updated_at }] : []);
    if (method === 'POST') { for (const row of JSON.parse(o.body)) rules[row.key] = { value: row.value, updated_at: row.updated_at }; return J([]); }
    if (method === 'DELETE') { delete rules[k]; return J([]); }
    return J([]);
  }
  if (p === '/rest/v1/auth_log') {
    let rows = authLog.filter((r) => (url.searchParams.get('event') || 'eq.login_ok') === 'eq.' + r.event);
    for (const f of param(url, 'at')) { const i = f.indexOf('.'); const op = f.slice(0, i), v = f.slice(i + 1); rows = rows.filter((r) => cmp(op, r.at, v)); }
    return J(page(rows, url));
  }
  if (p === '/rest/v1/app_users') return J(page(appUsers, url));
  if (p === '/rest/v1/bi_active_cases') {
    if (method === 'GET') return J(page(filt(biRows, url, 'contract_create_date'), url));
    if (method === 'DELETE') {
      if (biSpanDeleteFails && param(url, 'contract_create_date').length) return new Response('span delete exploded', { status: 500 });
      let hit = biRows;   // every filter present must match (id=gt.0 is the wipe-all of DELETE /api/bi)
      for (const col of ['id', 'contract_create_date', 'batch_id']) hit = filt(hit, url, col);
      const drop = new Set(hit); biRows = biRows.filter((r) => !drop.has(r));
      return J([]);
    }
    if (method === 'POST') {
      biInsertCalls++;
      if (biInsertFailOn && biInsertCalls === biInsertFailOn) return new Response('{"message":"invalid input syntax for type numeric"}', { status: 400 });
      for (const r of JSON.parse(o.body)) biRows.push({ ...r, id: biRows.length + 1 });
      return J([]);
    }
  }
  if (p === '/rest/v1/batches') {
    if (method === 'GET') return J(filt(filt(batches, url, 'source_type'), url, 'file_hash').slice(0, 1));
    if (method === 'POST') {
      for (const row of JSON.parse(o.body)) {
        if (batches.some((b) => b.batch_id === row.batch_id || (row.file_hash && b.file_hash === row.file_hash)))
          return new Response('{"code":"23505","message":"duplicate key value violates unique constraint"}', { status: 409 });
        batches.push(row);
      }
      return J([]);
    }
    if (method === 'DELETE') {
      const keep = new Set(filt(filt(batches, url, 'batch_id'), url, 'source_type'));
      if (batches.some((b) => keep.has(b) && biRows.some((r) => r.batch_id === b.batch_id)))
        return new Response('{"code":"23503","message":"violates foreign key constraint bi_active_cases_batch_id_fkey"}', { status: 409 });
      batches = batches.filter((b) => !keep.has(b)); return J([]);
    }
  }
  if (p.startsWith('/storage/v1/object/list/')) return J([]);
  if (p.startsWith('/storage/v1/object/')) {
    const key = decodeURIComponent(p.replace('/storage/v1/object/', ''));
    storageOps.push(method + ' ' + key);
    if (method === 'GET') return store[key] ? new Response(store[key], { status: 200 }) : new Response('', { status: 404 });
    if (method === 'HEAD') return new Response(null, { status: store[key] ? 200 : 404 });
    if (method === 'POST' || method === 'PUT') { store[key] = typeof o.body === 'string' ? o.body : Buffer.from(o.body).toString('utf8'); return J({ Key: key }); }
    if (method === 'DELETE') { delete store[key]; return J({}); }
  }
  return new Response('', { status: 404 });
};

const user = (o = {}) => ({ user_id: 'u1', expires_at: '2099-01-01T00:00:00Z', scope: 'full',
  app_users: { username: 'nick', full_name: 'Nick', role: 'admin', apps: null, tabs: null, pii_unmask: true, active: true, cb: null, team: null, hub_ids: null, must_change_password: false },
  ...o });
const pending = [];
const ctx = { waitUntil: (p) => { pending.push(p); } };
const call = async (method, pathq, body, headers = {}) => {
  sub = 0; subMax = 0;
  const req = new Request('https://api.local' + pathq, { method, headers: { Authorization: 'Bearer t', 'X-Cbx-Client': 'v5', ...headers }, body });
  const r = await worker.fetch(req, ENV, ctx);
  await Promise.all(pending.splice(0).map((p) => Promise.resolve(p).catch(() => {})));
  let j = null; const t = await r.clone().text(); try { j = JSON.parse(t); } catch (e) { j = null; }
  return { status: r.status, j, t, subs: subMax };
};

/* ════════════════════════ W1 ════════════════════════ */
head('W1 · /api/kv refuses a key that is not a plain name — before any use');
SESSION = user();
{
  const digestBefore = 'LIVE-DIGEST-BYTES';
  store['raw/kv/agent-digest'] = digestBefore;
  rules['kv:agent-digest'] = { value: { store: 'raw/kv/agent-digest', period: '2026-10-01' }, updated_at: '2026-10-07T08:00:00Z' };
  storageOps.length = 0;
  const r = await call('POST', '/api/kv?key=' + encodeURIComponent('zzz/../agent-digest'), '{"period":{"from":"2025-01-01"},"agents":[]}');
  ok(r.status === 400, 'POST key=zzz/../agent-digest → 400', r.status + ' ' + r.t.slice(0, 120));
  ok(store['raw/kv/agent-digest'] === digestBefore, '…and the live digest blob is untouched (the traversal never reached Storage)', String(store['raw/kv/agent-digest']).slice(0, 60));
  ok(!storageOps.length, '…no Storage call was made at all', storageOps.join('; '));
  ok(!rules['kv:zzz/../agent-digest'], '…and no pointer row was written for it');

  storageOps.length = 0;
  store['bi-reports/keep.xlsx'] = 'ARCHIVE';
  const d = await call('DELETE', '/api/kv?key=' + encodeURIComponent('../../bi-reports/keep.xlsx'));
  ok(d.status === 400, 'DELETE key=../../bi-reports/keep.xlsx → 400', d.status + ' ' + d.t.slice(0, 120));
  ok(store['bi-reports/keep.xlsx'] === 'ARCHIVE' && !storageOps.length, '…the object outside raw/kv survives and no Storage call was made', storageOps.join('; '));

  const g = await call('GET', '/api/kv?key=' + encodeURIComponent('zzz/../agent-digest'));
  ok(g.status === 400, 'GET key=zzz/../agent-digest → 400', String(g.status));

  for (const bad of ['..', '.', 'a..b', 'zzz\\..\\agent-digest', 'a/b', 'vas state', '%2e%2e', 'x?y', 'a#b', ''])
    { const b = await call('POST', '/api/kv?key=' + encodeURIComponent(bad), '{}'); ok(b.status === 400, 'POST key=' + JSON.stringify(bad) + ' → 400', String(b.status)); }
  ok(!storageOps.some((s) => /^(POST|PUT|DELETE) /.test(s)), 'not one of them wrote or deleted anything in Storage', storageOps.join('; '));

  /* every key the apps, tools and probes use today still passes (grep of /api/kv?key= + window.storage + digest keys) */
  const LIVE_KEYS = ['vas-state', 'cb-config', 'cb-audit', 'cb-meta', 'cb-purged-activations', 'cb-facts-VICI_CALL_REPORT', 'cb-facts-SES_DIAL',
    'cb-facts-AGENT_LIST', 'nba-digest', 'ai-digest-ops', 'ai-digest-vas', 'health-alerts', 'jobs-status', 'coaching', 'referrals-latest', 'tracker-eod',
    'agent-digest', 'agent-digest-2026-09', 'agent-digest-cycle-2026-10', 'agent-digest-range-2026-09-01-2026-09-30', 'agent-reports-variance',
    'agent-reports-leads', 'agent-reports-leads-range-2026-09-01-2026-09-30', 'cm-range-requests', 'zz-live-save', 'zz-upload-test',
    'zz-cas-probe-1759831200000', 'zz-cors-probe', 'help-contact:CB12', 'cm-areq:CB287'];
  const v = rulesMod.kvKeyValid;
  ok(typeof v === 'function', 'rules.mjs exports kvKeyValid (one definition for the three verbs)');
  if (typeof v === 'function') ok(LIVE_KEYS.every((k) => v(k) === true), 'kvKeyValid accepts every live key', LIVE_KEYS.filter((k) => !v(k)).join(', '));
  const refusedLive = [];
  for (const k of LIVE_KEYS) { const x = await call('GET', '/api/kv?key=' + encodeURIComponent(k) + '&meta=1'); if (x.status === 400) refusedLive.push(k); }
  ok(!refusedLive.length, 'GET answers every live key (none refused as malformed)', refusedLive.join(', '));
  const w = await call('POST', '/api/kv?key=cb-facts-ATTENDANCE', '[{"a":1}]');
  ok(w.status === 200 && store['raw/kv/cb-facts-ATTENDANCE'] === '[{"a":1}]', 'a plain fact-store save still lands where it always did', w.status + ' ' + w.t.slice(0, 80));
  const c = await call('POST', '/api/kv?key=' + encodeURIComponent('help-contact:CB12'), '{"id":"x"}');
  ok(c.status === 200 && store['raw/kv/help-contact:CB12'] === '{"id":"x"}', 'a key with ":" still saves', c.status + ' ' + c.t.slice(0, 80));
  const del = await call('DELETE', '/api/kv?key=help-contact:CB12');
  ok(del.status === 200 && !store['raw/kv/help-contact:CB12'], 'and still deletes', String(del.status));
}

/* ════════════════════════ W2 ════════════════════════ */
head('W2 · /api/agent-signins pages past PostgREST\'s 1000-row cap');
{
  /* 120 agents sign in every weekday of October 2026 at 07:00 SAST (05:00Z) — 2,640 rows, so a single read sees ~8 days */
  appUsers = Array.from({ length: 120 }, (_, i) => ({ username: 'CB' + (i + 1) })).concat([{ username: 'nick' }]);
  authLog = [];
  for (let d = 1; d <= 31; d++) {
    const day = '2026-10-' + String(d).padStart(2, '0'); const dow = new Date(day + 'T00:00:00Z').getUTCDay();
    if (dow === 0 || dow === 6) continue;
    for (let a = 1; a <= 120; a++) authLog.push({ id: authLog.length + 1, username: 'CB' + a, event: 'login_ok', at: day + 'T05:00:' + String(a % 60).padStart(2, '0') + 'Z' });
  }
  const want = authLog.length;
  const r = await call('GET', '/api/agent-signins?from=2026-10-01&to=2026-10-31');
  const days = (r.j && r.j.days) || {};
  const got = Object.values(days).reduce((s, a) => s + a.length, 0);
  ok(r.status === 200 && got === want, 'every agent-day is counted (' + want + ' rows, 22 weekdays × 120)', r.status + ' got ' + got);
  ok((days.CB1 || []).includes('2026-10-30'), 'the LAST weekday reads as signed in (it used to read "no days" past row 1000)', JSON.stringify((days.CB1 || []).slice(-3)));
  ok(r.subs <= SUBREQ_CAP, 'inside the subrequest budget (' + r.subs + ' ≤ ' + SUBREQ_CAP + ')');
  ok(r.j && r.j.truncated !== true, '…and not marked truncated', JSON.stringify(r.j && r.j.truncated));

  /* a window far past the budget: answers, stays inside the cap, and SAYS it is incomplete */
  const big = [];
  for (let i = 0; i < 60000; i++) big.push({ id: i + 1, username: 'CB' + ((i % 120) + 1), event: 'login_ok', at: new Date(Date.parse('2026-01-05T05:00:00Z') + i * 60000).toISOString() });
  authLog = big;
  const b = await call('GET', '/api/agent-signins?from=2026-01-05&to=2026-03-31');
  ok(b.status === 200, 'a 60,000-row window still answers (no "Too many subrequests")', b.status + ' ' + b.t.slice(0, 120));
  ok(b.subs <= SUBREQ_CAP, '…inside the budget (' + b.subs + ' subrequests)');
  ok(b.j && b.j.truncated === true, '…and says it is truncated rather than passing a partial count off as whole', JSON.stringify(b.j && b.j.truncated));
  /* W-R1: the FREE plan also caps CPU at 10 ms — parsing 40 pages of sign-ins is past it. 12 pages (12,000 rows) is four
     times a real month (~3,000). Budget: the session, ≤ 12 auth_log pages, ≤ 3 app_users pages. */
  ok(b.subs <= 1 + 12 + 3, 'W-R1: …and reads at most 12 pages of sign-ins (' + b.subs + ' subrequests ≤ 16)', String(b.subs));
}

head('W2 · GET /api/bi pages past the cap too');
{
  biRows = [];
  for (let i = 0; i < 2500; i++) biRows.push({ id: i + 1, account_no: 'A' + i, contract_create_date: '2026-09-' + String((i % 30) + 1).padStart(2, '0'), charge_amount: 86.08, batch_id: 'B0' });
  biRows.sort((a, b) => a.contract_create_date.localeCompare(b.contract_create_date) || a.id - b.id);
  const r = await call('GET', '/api/bi?from=2026-09-01&to=2026-09-30');
  ok(r.status === 200 && r.j && r.j.rows && r.j.rows.length === 2500, 'all 2,500 September rows come back (default limit 20,000)', r.status + ' ' + (r.j && r.j.rows ? r.j.rows.length : r.t.slice(0, 80)));
  ok(r.j && r.j.rows && new Set(r.j.rows.map((x) => x.id)).size === r.j.rows.length, '…each row once');
  const l = await call('GET', '/api/bi?from=2026-09-01&to=2026-09-30&limit=1500');
  ok(l.j && l.j.rows && l.j.rows.length === 1500, 'limit=1500 → exactly 1,500', l.j && l.j.rows ? String(l.j.rows.length) : l.t.slice(0, 80));
  biRows = Array.from({ length: 60000 }, (_, i) => ({ id: i + 1, account_no: 'A' + i, contract_create_date: '2026-09-15', charge_amount: 1, batch_id: 'B0' }));
  const h = await call('GET', '/api/bi?limit=50000');
  ok(h.status === 200 && h.subs <= SUBREQ_CAP, 'limit=50,000 over 60,000 rows stays inside the budget (' + h.subs + ' subrequests)', h.status + ' ' + h.t.slice(0, 120));
  ok(h.j && h.j.truncated === true && Number.isFinite(h.j.next_offset), '…and says where to carry on (truncated + next_offset)', JSON.stringify(h.j && { truncated: h.j.truncated, next_offset: h.j.next_offset }));
  const n = h.j && Number.isFinite(h.j.next_offset) ? await call('GET', '/api/bi?limit=50000&offset=' + h.j.next_offset) : null;
  ok(n && n.j && n.j.rows && n.j.rows.length && n.j.rows[0].id === h.j.rows.length + 1, '…and offset= carries on from exactly the next row', n ? JSON.stringify(n.j && n.j.rows && n.j.rows[0]) : 'no next_offset');
  /* W-R1: select=* BI rows are wide — 5 pages (5,000 rows) per request on the 10 ms CPU plan; the rest by next_offset */
  ok(h.subs <= 1 + 5 && h.j && h.j.rows && h.j.rows.length === 5000, 'W-R1: GET /api/bi reads at most 5 pages per request (' + h.subs + ' subrequests, ' + (h.j && h.j.rows ? h.j.rows.length : '?') + ' rows)', String(h.subs));
  const dflt = await call('GET', '/api/bi');
  ok(dflt.subs <= 1 + 5 && dflt.j && dflt.j.truncated === true && dflt.j.next_offset === 5000, 'W-R1: …the default request too, and it says where to carry on', dflt.subs + ' ' + JSON.stringify(dflt.j && { truncated: dflt.j.truncated, next_offset: dflt.j.next_offset }));
}

/* ════════════════════════ W3 ════════════════════════ */
head('W3 · POST /api/bi — a failure after the batch row is written removes it, so the re-upload loads');
{
  const mk = (n, d0 = '2026-09') => Array.from({ length: n }, (_, i) => ({ account_no: 'X' + i, contract_create_date: d0 + '-' + String((i % 28) + 1).padStart(2, '0'), charge_amount: 99, batch_id: 'B1' }));
  const body = (rows, id = 'B1', hash = 'h-file-1') => JSON.stringify({ batch: { batch_id: id, file_hash: hash }, rows: rows.map((r) => ({ ...r, batch_id: id })) });
  biRows = [{ id: 1, account_no: 'OLD', contract_create_date: '2026-08-10', charge_amount: 50, batch_id: 'B0' }]; batches = [{ batch_id: 'B0', source_type: 'BI_ACTIVE_CASES', file_hash: 'h-old' }];
  biInsertCalls = 0; biInsertFailOn = 2;           // the SECOND 800-row chunk is refused by PostgREST
  const f = await call('POST', '/api/bi', body(mk(2000)), { 'Content-Type': 'application/json' });
  biInsertFailOn = 0;
  ok(f.status === 500 && f.j && f.j.error === 'bi_write_failed', 'a chunk refused mid-load → 500 bi_write_failed (unchanged)', f.status + ' ' + f.t.slice(0, 160));
  ok(!batches.some((b) => b.batch_id === 'B1'), 'the batch row for the failed load is GONE', JSON.stringify(batches.map((b) => b.batch_id)));
  ok(f.j && f.j.batch_removed === true && /upload.*again|again/i.test(String(f.j.detail || '') + ' ' + String(f.j.message || '')), '…and the answer says so (batch_removed + "upload it again")', JSON.stringify(f.j && { batch_removed: f.j.batch_removed, message: f.j.message }));
  ok(!biRows.some((r) => r.batch_id === 'B1'), '…with the partial rows of that batch (they reference it)', String(biRows.filter((r) => r.batch_id === 'B1').length));
  ok(biRows.some((r) => r.account_no === 'OLD'), 'other months are untouched');
  const again = await call('POST', '/api/bi', body(mk(2000)), { 'Content-Type': 'application/json' });
  ok(again.status === 200 && again.j && !again.j.skipped && again.j.inserted === 2000, 'the SAME file uploaded again loads (it used to be refused "already loaded")', again.status + ' ' + again.t.slice(0, 160));
  ok(batches.some((b) => b.batch_id === 'B1'), '…and its batch row is kept on success');
  const dup = await call('POST', '/api/bi', body(mk(2000)), { 'Content-Type': 'application/json' });
  ok(dup.j && dup.j.skipped === true, 'a real duplicate is still skipped (idempotency unchanged)', dup.t.slice(0, 120));

  biSpanDeleteFails = true;
  const s = await call('POST', '/api/bi', body(mk(100, '2026-07'), 'B2', 'h-file-2'), { 'Content-Type': 'application/json' });
  biSpanDeleteFails = false;
  ok(s.status === 500 && !batches.some((b) => b.batch_id === 'B2') && s.j && s.j.batch_removed === true, 'a failure at the span delete also removes the batch row', s.status + ' ' + JSON.stringify(batches.map((b) => b.batch_id)));

  /* a body too big for one invocation's budget is refused BEFORE anything is written — otherwise the cap kills the load
     mid-way AND the cleanup with it (every fetch after the 50th throws) */
  const before = JSON.stringify({ batches, n: biRows.length });
  const huge = await call('POST', '/api/bi', body(mk(40000, '2026-06'), 'B3', 'h-file-3'), { 'Content-Type': 'application/json' });
  ok(huge.status === 413, 'a 40,000-row body (more chunks than the budget holds) → 413 up front', huge.status + ' ' + huge.t.slice(0, 160));
  ok(JSON.stringify({ batches, n: biRows.length }) === before, '…and nothing was written or deleted', JSON.stringify(batches.map((b) => b.batch_id)) + ' rows ' + biRows.length);

  /* W-R2: the worst case the cap allows — the LAST of 44 chunks fails — must still clean up with a subrequest to spare.
     Count: session 1 · batch row 1 · span delete 1 · 44 chunks · cleanup 2 = 49 (the pre-check select is gone when the batch
     row carries the file hash: its unique index batches_source_filehash_uq is the check). */
  biRows = []; batches = [];
  biInsertCalls = 0; biInsertFailOn = 44;
  const w = await call('POST', '/api/bi', body(mk(44 * 800, '2026-05'), 'B4', 'h-file-4'), { 'Content-Type': 'application/json' });
  biInsertFailOn = 0;
  ok(w.status === 500 && w.j && w.j.batch_removed === true && !batches.some((b) => b.batch_id === 'B4'), 'W-R2: the last of 44 chunks failing still removes the batch row', w.status + ' ' + w.t.slice(0, 120));
  ok(w.subs <= SUBREQ_CAP - 1, 'W-R2: …with at least one subrequest to spare (' + w.subs + ' of ' + SUBREQ_CAP + ')', String(w.subs));
  const real = await call('POST', '/api/bi', body(mk(32924, '2026-05'), 'B5', 'h-file-5'), { 'Content-Type': 'application/json' });
  ok(real.status === 200 && real.j && real.j.inserted === 32924, 'W-R2: the largest real month-end file (32,924 rows = 42 chunks) loads (' + real.subs + ' subrequests)', real.status + ' ' + real.t.slice(0, 120));
  const again5 = await call('POST', '/api/bi', body(mk(32924, '2026-05'), 'B6', 'h-file-5'), { 'Content-Type': 'application/json' });
  ok(again5.j && again5.j.skipped === true && again5.j.batch_id === 'B5' && !batches.some((b) => b.batch_id === 'B6') && biRows.length === 32924,
    'W-R2: the same file under a NEW batch id is still skipped as already loaded (names B5, writes nothing)', again5.t.slice(0, 160));
  const noBatch = await call('POST', '/api/bi', JSON.stringify({ batch: { file_hash: 'h-file-5' }, rows: mk(10, '2026-05') }), { 'Content-Type': 'application/json' });
  ok(noBatch.j && noBatch.j.skipped === true && biRows.length === 32924, 'W-R2: a body with a file hash but no batch id is still checked up front', noBatch.t.slice(0, 120));
}

/* ════════════════════════ W4 ════════════════════════ */
head('W4 · /api/agent-digest answers only a full-scope session');
{
  rules['kv:agent-digest'] = { value: { data: '{"period":{"from":"2026-10-01"},"agents":[{"code":"CB1"}]}' }, updated_at: '2026-10-07T08:00:00Z' };
  for (const scope of ['wimpy', 'referrals', 'something-new']) {
    SESSION = user({ scope });
    const r = await call('GET', '/api/agent-digest');
    ok(r.status === 403 && !/CB1/.test(r.t), 'an admin account on a ' + scope + '-scoped session → 403, no digest', r.status + ' ' + r.t.slice(0, 80));
  }
  SESSION = user({ scope: 'full' });
  const f = await call('GET', '/api/agent-digest');
  ok(f.status === 200 && /CB1/.test(f.t), 'a full session still reads the digest', f.status + ' ' + f.t.slice(0, 80));
  SESSION = user({ scope: null });
  const n = await call('GET', '/api/agent-digest');
  ok(n.status === 200, 'a session row from before migration-037 (scope null = full) still reads it', String(n.status));
  SESSION = user({ scope: 'full', app_users: { ...user().app_users, username: 'CB7', role: 'agent', apps: ['agent'], cb: 'CB7' } });
  const a = await call('GET', '/api/agent-digest');
  ok(a.status === 403, 'an agent session is still refused (role lockdown unchanged)', String(a.status));
  SESSION = user();
}

/* ════════════════════════ W-R3 (pins) ════════════════════════ */
head('W-R3 · nba-digest and ai-digest-* — who writes them today (pins; the portal-role guard waits on Ops and the ask widget)');
{
  const KEYS = ['nba-digest', 'ai-digest-ops', 'ai-digest-vas', 'ai-digest-tracker'];
  const refused = [];
  for (const scope of ['wimpy', 'referrals']) {
    SESSION = user({ scope });
    for (const k of KEYS) for (const m of ['POST', 'DELETE']) { const r = await call(m, '/api/kv?key=' + k, m === 'POST' ? 'x' : undefined); if (r.status !== 403) refused.push(scope + ' ' + m + ' ' + k + ' → ' + r.status); }
  }
  ok(!refused.length, 'a wimpy- or referrals-scoped session (any role) is refused POST and DELETE of all four (the scope gate)', refused.join('; '));
  const failed = [];
  for (const role of ['admin', 'exec', 'tl', 'qa', 'viewer']) {
    SESSION = user({ app_users: { ...user().app_users, username: role + '1', role, apps: ['ops', 'vas', 'tracker'] } });
    for (const k of KEYS) { const r = await call('POST', '/api/kv?key=' + k, '{"v":"' + role + '"}'); if (r.status !== 200) failed.push(role + ' ' + k + ' → ' + r.status); }
  }
  ok(!failed.length, 'every staff role (admin, exec, tl, qa, viewer) on a full session still writes all four', failed.join('; '));
  SESSION = user();
}

/* ════════════════════════ W5 ════════════════════════ */
head('W5 · hubs.mjs dates the coaching and the KPI form on the SAST day');
{
  const RealDate = Date;
  const at = async (iso, fn) => {
    const t = RealDate.parse(iso);
    class FakeDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(t); } static now() { return t; } }
    globalThis.Date = FakeDate; sub = 0;
    try { return await fn(); } finally { globalThis.Date = RealDate; }
  };
  const ids = { coaching: 'leader-1', kpi: 'kpi-1' };
  const tl = { username: 'tl1', full_name: 'Team Leader' };
  const lastArgs = () => (convexCalls[convexCalls.length - 1] || { body: {} }).body.args || {};

  await at('2026-09-30T22:30:00Z', () => hubs.coachingCreate(ids, tl, { type: 'informalCoaching', agentName: 'Agent A', campaign: 'Courtesy' }));
  ok(lastArgs().date === '2026-10-01', '00:30 SAST on 1 Oct: an undated informal session is dated 2026-10-01 (UTC said 30 Sep)', lastArgs().date);
  await at('2026-09-30T22:30:00Z', () => hubs.coachingCreate(ids, tl, { type: 'qualityAssuranceCoaching', agentName: 'Agent A', employeeNumber: 'CB1' }));
  ok(lastArgs().dateOfCoaching === '2026-10-01', '…and a QA session\'s dateOfCoaching likewise', lastArgs().dateOfCoaching);
  await at('2026-10-07T10:00:00Z', () => hubs.coachingCreate(ids, tl, { type: 'informalCoaching', agentName: 'Agent A' }));
  ok(lastArgs().date === '2026-10-07', 'midday is unchanged (2026-10-07)', lastArgs().date);
  await at('2026-09-30T22:30:00Z', () => hubs.coachingCreate(ids, tl, { type: 'informalCoaching', agentName: 'Agent A', date: '2026-09-29' }));
  ok(lastArgs().date === '2026-09-29', 'a date the leader typed is kept as typed', lastArgs().date);

  await at('2026-09-30T22:30:00Z', () => hubs.kpiWrite(ids, { action: 'create', title: 'Monthly KPI Acknowledgement Form' }));
  ok(lastArgs().month === 'October' && lastArgs().year === 2026, 'a KPI form created at 00:30 SAST on 1 Oct is October 2026 (UTC said September)', lastArgs().month + ' ' + lastArgs().year);
  await at('2026-12-31T23:00:00Z', () => hubs.kpiWrite(ids, { action: 'create', title: 'Monthly KPI Acknowledgement Form' }));
  ok(lastArgs().month === 'January' && lastArgs().year === 2027, '01:00 SAST on 1 Jan 2027 is January 2027 (UTC said December 2026)', lastArgs().month + ' ' + lastArgs().year);
  await at('2026-10-15T09:00:00Z', () => hubs.kpiWrite(ids, { action: 'create', title: 'Monthly KPI Acknowledgement Form', month: 'March', year: 2025 }));
  ok(lastArgs().month === 'March' && lastArgs().year === 2025, 'a month and year the leader chose are kept', lastArgs().month + ' ' + lastArgs().year);
}

console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
process.exit(fail ? 1 : 0);
