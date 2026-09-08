/* ONE AGENT LIST FOR THE WHOLE SUITE, WHICHEVER STATION IT IS DROPPED INTO.
 *
 * Nick, 2026-08-28: "this problem is happening all the time, the list changes constantly
 * and is not updating sometimes leaving old team leaders and agents."
 *
 * The root cause was an asymmetry, not a flaky sync. /api/roster DERIVED the roster from
 * kv:vas-state, so only the VAS app could ever publish one. A list dropped into the Ops
 * station stayed private to Ops; a list dropped into VAS reached Ops; and whenever the two
 * disagreed, a guard in Ops refused the VAS list to protect its own hand-upload — leaving
 * the suite split, with one side showing last week's team leaders, until somebody happened
 * to re-upload in the right app.
 *
 * There is now a roster OF RECORD: kv:roster-current. Either station POSTs the list it
 * ingested, the server decides which one wins, and both apps read the winner. These tests
 * drive the REAL Worker module — the same code Cloudflare runs — against a stubbed store,
 * so the decision rules are exercised rather than described.
 *
 * Run: node verify-roster-of-record.mjs
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { publishAgentListStub } from './stub-publish-agent-list.mjs';   // the DB's publish, in memory (see that file)
const AGENTOS = process.env.AGENTOS || decodeURIComponent(new URL('../..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1').replace(/\/$/, '');   // repo-relative (2026-09-08): the laptop path failed every cloud run
const mod = await import(pathToFileURL(path.join(AGENTOS, 'worker', 'src', 'index.mjs')).href);
const worker = mod.default;

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + ' — ' + d); } };

/* ---- a stubbed Supabase: rules rows in memory, storage objects in a map ------------- */
let rules = {}, store = {};
const ENV = { SUPABASE_URL: 'http://stub.local', SUPABASE_SECRET_KEY: 'k' };
const realFetch = globalThis.fetch;
globalThis.fetch = async (u, o = {}) => {
  const url = String(u);
  const J = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
  if (url.startsWith('http://stub.local/rest/v1/rpc/publish_agent_list'))
    return J(publishAgentListStub(JSON.parse(o.body || '{}')));
  if (url.startsWith('http://stub.local/rest/v1/rules')) {
    if ((o.method || 'GET') === 'GET') {
      const m = /key=eq\.([^&]+)/.exec(url);
      const k = m ? decodeURIComponent(m[1]) : '';
      return J(rules[k] ? [{ key: k, value: rules[k].value, updated_at: rules[k].updated_at }] : []);
    }
    for (const row of JSON.parse(o.body)) rules[row.key] = { value: row.value, updated_at: row.updated_at };
    return J({ ok: true });
  }
  if (url.startsWith('http://stub.local/storage/v1/object/')) {
    const p = url.replace('http://stub.local/storage/v1/object/', '');
    if ((o.method || 'GET') === 'GET') return store[p] != null ? new Response(store[p], { status: 200 }) : new Response('', { status: 404 });
    store[p] = typeof o.body === 'string' ? o.body : Buffer.from(o.body).toString();
    return J({ ok: true });
  }
  return realFetch ? realFetch(u, o) : new Response('', { status: 404 });
};

/* a session the Worker will accept — the auth path reads app_sessions/app_users */
const TOKEN = 'test-token';
async function call(method, pathname, body) {
  const req = new Request('https://api.local' + pathname, {
    method, headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return worker.fetch(req, ENV, { waitUntil: (p) => { try { return p; } catch { /* noop */ } } });
}
/* The Worker authenticates against app_sessions, selecting the joined app_users row —
   session() reads s.app_users.active, so the stub must return that shape, not a flat one. */
const origFetch = globalThis.fetch;
globalThis.fetch = async (u, o) => {
  const url = String(u);
  if (url.includes('/rest/v1/app_sessions')) return new Response(JSON.stringify([{
    user_id: 'u1', expires_at: '2099-01-01T00:00:00Z',
    app_users: { username: 'nick', full_name: 'Nick', role: 'admin', apps: null, tabs: null,
      pii_unmask: true, active: true, cb: null, team: null, hub_ids: null, must_change_password: false },
  }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (url.includes('/rest/v1/app_users')) return new Response(JSON.stringify([{ id: 'u1', username: 'nick', full_name: 'Nick', role: 'admin', active: true }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
  return origFetch(u, o);
};

const mkRoster = (tl, extra = []) => ([
  { code: 'CB100', name: 'Alpha One', tl, campaign: 'Courtesy', tenure: 'M1', target: 3 },
  { code: 'CB101', name: 'Beta Two', tl, campaign: 'Cuddle', tenure: 'Exp', target: 8 },
].concat(extra));

const post = (body) => call('POST', '/api/roster', body).then(r => r.json());
const get = () => call('GET', '/api/roster').then(r => r.json());

console.log('  driving the real Worker module against a stubbed store\n');

/* 1 — a list uploaded in VAS becomes the roster of record */
let r = await post({ source: 'vas', file: 'Matrix - Agent List.xlsx', as_of: '2026-08-20', roster: mkRoster('Old Leader') });
ok('a list uploaded in VAS is accepted and published', r.accepted === true && r.n === 2, JSON.stringify(r));
let g = await get();
ok('...and /api/roster serves it back', g.n === 2 && g.roster[0].tl === 'Old Leader', JSON.stringify(g).slice(0, 120));

/* 2 — THE CASE THAT KEPT FAILING: a list uploaded in OPS reaches the suite */
r = await post({ source: 'ops', file: 'Matrix - Agent List.xlsx', as_of: '2026-08-28', roster: mkRoster('New Leader') });
ok('a list uploaded in OPS is accepted', r.accepted === true, JSON.stringify(r));
g = await get();
ok('...and the whole suite now reads the new team leader',
  g.roster.every(a => a.tl === 'New Leader'), JSON.stringify(g.roster.map(a => a.tl)));
ok('...and it records which list it replaced', !!(r.replaced && r.replaced.as_of === '2026-08-20'), JSON.stringify(r.replaced));

/* 3 — an OLDER list never undoes a newer one (the "old team leaders came back" failure) */
r = await post({ source: 'vas', file: 'yesterday.xlsx', as_of: '2026-08-27', roster: mkRoster('Stale Leader') });
ok('an older list is refused, not applied', r.accepted === false && /older list/.test(r.reason || ''), JSON.stringify(r));
g = await get();
ok('...and the newer leaders survive it', g.roster.every(a => a.tl === 'New Leader'), JSON.stringify(g.roster.map(a => a.tl)));

/* 4 — re-publishing the same list changes nothing (a reopened tab must be harmless) */
r = await post({ source: 'vas', as_of: '2026-08-28', roster: mkRoster('New Leader') });
ok('an identical re-publish is a no-op', r.accepted === false && /identical/.test(r.reason || ''), JSON.stringify(r));

/* 5 — a same-day CORRECTION is accepted (v2 of today's list must win) */
r = await post({ source: 'ops', file: 'v2.xlsx', as_of: '2026-08-28',
  roster: mkRoster('New Leader', [{ code: 'CB102', name: 'Gamma Three', tl: 'New Leader', campaign: 'Nesting', tenure: 'M0', target: 2 }]) });
ok('a same-day correction with different content is accepted', r.accepted === true && r.n === 3, JSON.stringify(r));

/* 6 — an empty list can never wipe the floor */
r = await post({ source: 'vas', as_of: '2026-08-29', roster: [] });
ok('an empty list is refused outright', r.accepted === false && /empty/.test(r.reason || ''), JSON.stringify(r));
r = await post({ source: 'vas', as_of: '2026-08-29', roster: [{ code: '', name: '' }, { code: 'CB1' }] });
ok('...and so is one whose rows have no code or name', r.accepted === false, JSON.stringify(r));
g = await get();
ok('...the roster is untouched by both', g.n === 3, String(g.n));

/* 7 — a mover changes campaign AND team leader together */
r = await post({ source: 'ops', as_of: '2026-08-29', roster: [
  { code: 'CB100', name: 'Alpha One', tl: 'Third Leader', campaign: 'Nesting', tenure: 'M0', target: 2 },
  { code: 'CB101', name: 'Beta Two', tl: 'New Leader', campaign: 'Cuddle', tenure: 'Exp', target: 8 },
] });
g = await get();
const moved = g.roster.find(a => a.code === 'CB100');
ok('a mover carries their new leader, campaign and tenure',
  moved.tl === 'Third Leader' && moved.campaign === 'Nesting' && moved.tenure === 'M0', JSON.stringify(moved));
ok('an agent dropped from the list is gone from the roster',
  !g.roster.some(a => a.code === 'CB102'), JSON.stringify(g.roster.map(a => a.code)));

/* 8 — the Ops boot mirror and the portal's authorisation floor follow the SAME list */
const mirrorFp = rules['kv:roster-mirror-fp'] && rules['kv:roster-mirror-fp'].value;
const teams = rules['kv:agent-teams'] && rules['kv:agent-teams'].value;
ok('the Ops boot mirror was rewritten for the winning list',
  !!mirrorFp && mirrorFp.fingerprint === g.fingerprint, JSON.stringify(mirrorFp));
ok('...and holds the new leaders, not the old ones',
  /Third Leader/.test(store['raw/kv/cb-facts-AGENT_LIST'] || ''), String(store['raw/kv/cb-facts-AGENT_LIST'] || '').slice(0, 90));
ok('the portal authorisation map follows the same list',
  !!teams && teams.teams && teams.teams.CB100 === 'Third Leader', JSON.stringify(teams && teams.teams));

/* 9 — the fingerprint is stable under row order, so a reordered export is not "a change" */
const shuffled = g.roster.slice().reverse();
r = await post({ source: 'vas', as_of: '2026-08-29', roster: shuffled });
ok('the same people in a different order is not a new list',
  r.accepted === false && /identical/.test(r.reason || ''), JSON.stringify(r));

/* 10 — provenance travels, so "which list are we on?" is answerable */
g = await get();
ok('the served roster says where it came from and when',
  !!g.as_of && !!g.uploaded_at && g.source === 'ops', JSON.stringify({ as_of: g.as_of, source: g.source, by: g.uploaded_by }));

globalThis.fetch = realFetch;
console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
process.exit(fail ? 1 : 0);
