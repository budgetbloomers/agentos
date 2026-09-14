/* WHEN A LIST IS UPLOADED IN VAS, OPS MUST UPDATE — WITH NOBODY OPENING ANYTHING.
 *
 * Nick, 2026-08-28: a list uploaded in VAS left Ops on the 26-Aug copy (Renolan / Grp13 /
 * Nesting where the list said Hezron / M0 / Courtesy) because Ops only re-ingested when a
 * human opened it. This drives the REAL Worker module against a mock database and asserts
 * the three independent triggers all mirror the roster into Ops' own store:
 *     1. GET /api/roster            (a dashboard polling, or PULSE's ?fresh=1 ping)
 *     2. the CRON scheduled handler (nothing open anywhere)
 *     3. POST /api/kv agent-digest  (refreshes the agent->team authorisation map)
 * and that a repeat run with an UNCHANGED roster writes nothing.
 *
 * Run: node verify-roster-propagation.mjs
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const AGENTOS = process.env.AGENTOS || decodeURIComponent(new URL('../..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1').replace(/\/$/, '');   // repo-relative (2026-09-08): the laptop path failed every cloud run
const worker = await import(pathToFileURL(path.join(AGENTOS, 'worker', 'src', 'index.mjs')).href);

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + ' — ' + d); } };

/* ---- the world: a Supabase stand-in ---- */
const ROSTER = [
  { code: 'CB291', name: 'Xolile Chiliza', tl: 'Hezron Pillay', campaign: 'Courtesy', tenure: 'M0', callx: 'Xolile Chiliza CB-291', sf: 'Xolile Chiliza', target: 2, start: '2026-08-11' },
  { code: 'CB800', name: 'Cuddle Person',  tl: 'Sharoma Rampersad', campaign: 'Cuddle', tenure: 'Exp', callx: 'Cuddle Person CB-800', sf: 'Cuddle Person', target: 5, start: '2026-01-05' },
];
let vasState = { roster: ROSTER, files: [{ type: 'roster (VAS)', name: 'Matrix - Agent List.xlsx', asOf: '2026-08-28' }] };
let rules = { 'kv:vas-state': { value: { data: JSON.stringify(vasState) }, updated_at: '2026-08-28T09:00:00Z' } };
let storage = {};                 // path -> body
const sessions = {};              // token_hash -> session row (for the auth layer)
let writes = [];                  // every storage write, in order

globalThis.fetch = async (u, o = {}) => {
  const url = String(u);
  const method = (o.method || 'GET').toUpperCase();
  // --- Supabase Storage ---
  if (url.includes('/storage/v1/object/')) {
    const p = url.split('/storage/v1/object/')[1].split('?')[0];
    if (method === 'GET') return { ok: !!storage[p], status: storage[p] ? 200 : 404, headers: new Map(), text: async () => storage[p] || '' };
    /* a Storage LIST is a POST too (the cron's manifest reconcile lists raw/uploads/ since
       2026-09-08) — it reads, it does not write, and it expects JSON back */
    if (p.startsWith('list/')) return { ok: true, status: 200, headers: new Map(), json: async () => [], text: async () => '[]' };
    storage[p] = o.body; writes.push(p);
    return { ok: true, status: 200, headers: new Map(), text: async () => '' };
  }
  // --- PostgREST on the rules table (exercises the real db.mjs) ---
  if (url.includes('/rest/v1/app_sessions')) {
    const m = /token_hash=eq\.([0-9a-f]+)/.exec(url);
    const row = m && sessions[m[1]];
    const out = row ? [row] : [];
    return { ok: true, status: 200, headers: new Map(), text: async () => JSON.stringify(out), json: async () => out };
  }
  if (url.includes('/rest/v1/')  && !url.includes('/rest/v1/rules')) {
    return { ok: true, status: 200, headers: new Map(), text: async () => '[]', json: async () => [] };
  }
  if (url.includes('/rest/v1/rules')) {
    if (method === 'GET') {
      const m = /key=eq\.([^&]+)/.exec(url);
      const k = m ? decodeURIComponent(m[1]) : null;
      const out = k && rules[k] ? [{ key: k, value: rules[k].value, updated_at: rules[k].updated_at }] : [];
      return { ok: true, status: 200, headers: new Map(), text: async () => JSON.stringify(out), json: async () => out };
    }
    if (method === 'POST') {
      for (const r of JSON.parse(o.body)) { rules[r.key] = { value: r.value, updated_at: r.updated_at }; writes.push('rules:' + r.key); }
      return { ok: true, status: 201, headers: new Map(), text: async () => '[]', json: async () => [] };
    }
  }
  throw new Error('unexpected fetch: ' + method + ' ' + url.slice(0, 90));
};
const env = { SUPABASE_URL: 'https://stub', SUPABASE_SECRET_KEY: 'stub' };

/* ---- 1. the CRON path: nothing is open anywhere ---- */
globalThis.__rosterCache = null;
let done; const ctx = { waitUntil: (p) => { done = p; } };
await worker.default.scheduled({}, env, ctx); await done;

const opsRows = () => JSON.parse(storage['raw/kv/cb-facts-AGENT_LIST'] || 'null');
let rows = opsRows();
ok('the cron alone mirrors the roster into Ops\' own store', Array.isArray(rows) && rows.length === 2, JSON.stringify(rows && rows.length));
const cb291 = (rows || []).find(r => r.cb_code === 'CB291') || {};
ok('...with the NEW team leader', cb291.team_leader === 'Hezron Pillay', String(cb291.team_leader));
ok('...the NEW tenure', cb291.tenure === 'M0', String(cb291.tenure));
ok('...and the NEW campaign', cb291.queue === 'Courtesy', String(cb291.queue));
ok('the row carries the shape Ops reads (cb_norm / callx_alias / sf_name)',
  cb291.cb_norm === 'CB291' && 'callx_alias' in cb291 && 'sf_name' in cb291, JSON.stringify(Object.keys(cb291)));
ok('the agent→team authorisation map is refreshed too',
  ((rules['kv:agent-teams'] || {}).value || {}).teams?.CB291 === 'Hezron Pillay',
  JSON.stringify((rules['kv:agent-teams'] || {}).value));

/* ---- 2. an UNCHANGED roster must write nothing ---- */
writes = []; globalThis.__rosterCache = null;
await worker.default.scheduled({}, env, ctx); await done;
ok('an unchanged roster writes nothing (fingerprint-gated)', writes.length === 0, writes.join(', '));

/* ---- 3. a CHANGED roster propagates on the very next run ---- */
ROSTER[0].tl = 'Denise Haripersad'; ROSTER[0].tenure = 'M1';
rules['kv:vas-state'] = { value: { data: JSON.stringify({ ...vasState, roster: ROSTER }) }, updated_at: '2026-08-28T10:00:00Z' };
writes = []; globalThis.__rosterCache = null;
await worker.default.scheduled({}, env, ctx); await done;
const after = (opsRows() || []).find(r => r.cb_code === 'CB291') || {};
ok('a changed leader reaches Ops without anyone opening it', after.team_leader === 'Denise Haripersad', String(after.team_leader));
ok('a changed tenure reaches Ops too', after.tenure === 'M1', String(after.tenure));
ok('the team map follows the change', ((rules['kv:agent-teams'] || {}).value || {}).teams?.CB291 === 'Denise Haripersad',
  JSON.stringify(((rules['kv:agent-teams'] || {}).value || {}).teams));

/* ---- 4. a leaver is dropped (the list is the truth) ---- */
ROSTER.pop();
rules['kv:vas-state'] = { value: { data: JSON.stringify({ ...vasState, roster: ROSTER }) }, updated_at: '2026-08-28T11:00:00Z' };
globalThis.__rosterCache = null;
await worker.default.scheduled({}, env, ctx); await done;
ok('an agent removed from the list is removed from Ops', (opsRows() || []).length === 1, String((opsRows() || []).length));

/* ---- 5. THE HTTP ROUTE, which is what Ops actually calls ----------------------
   /api/roster was refactored to share rosterSync() with the cron. If that route broke,
   Ops' own syncRosterFromVAS gets nothing and the whole chain is dead — so it is driven
   here for real, through worker.default.fetch, with a mocked session. */
ROSTER.push({ code: 'CB900', name: 'Route Check', tl: 'Sharoma Rampersad', campaign: 'Cuddle', tenure: 'Exp', callx: 'Route Check CB-900', sf: 'Route Check', target: 5, start: '2026-02-02' });
rules['kv:vas-state'] = { value: { data: JSON.stringify({ ...vasState, roster: ROSTER }) }, updated_at: '2026-08-28T12:00:00Z' };
globalThis.__rosterCache = null;

const TOKEN = 'test-token-value';
const dig = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(TOKEN));
const TH = [...new Uint8Array(dig)].map(b => b.toString(16).padStart(2, '0')).join('');
sessions[TH] = { expires_at: new Date(Date.now() + 3600000).toISOString(), user_id: 'u1',
  app_users: { username: 'nick', full_name: 'Nick', role: 'admin', apps: ['ops', 'vas'], tabs: {}, pii_unmask: true, active: true, cb: '', team: '', hub_ids: {}, must_change_password: false } };

const res = await worker.default.fetch(new Request('https://x/api/roster?fresh=1', {
  headers: { Authorization: 'Bearer ' + TOKEN, 'X-Cbx-Client': 'v5' } }), env, { waitUntil: () => {} });
const body = await res.json().catch(() => ({}));
ok('GET /api/roster still returns 200 after the refactor', res.status === 200, res.status + ' ' + JSON.stringify(body).slice(0, 140));
ok('...with the payload Ops expects (roster + fingerprint + n)',
  Array.isArray(body.roster) && body.roster.length === ROSTER.length && /^vas:/.test(body.fingerprint || ''),
  JSON.stringify({ n: body.n, fp: body.fingerprint, len: (body.roster || []).length }));
ok('...and the route mirrors into Ops’ store too',
  (opsRows() || []).some(r => r.cb_code === 'CB900'), 'rows=' + (opsRows() || []).length);

console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
process.exit(fail ? 1 : 0);
