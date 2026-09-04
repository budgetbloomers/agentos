/* WHEN THE LIST CHANGES, EVERYTHING CHANGES — AND THE OLD ONE GOES.
 *
 * Nick, 2026-08-28: "add new team leaders and agents, see if it removes the old ones and
 * adds the new ones."
 *
 * The Agent List is a SNAPSHOT, not a ledger: whatever it says is the floor, and anyone
 * missing from it has left. The failure this guards against is the half-update — a new
 * leader appearing while the old one lingers, an agent showing under both, or a leaver
 * still visible to their old team leader in the portal.
 *
 * So every scenario is checked in all THREE places a stale name could survive:
 *   1. kv:roster-current      — the roster of record both apps read
 *   2. cb-facts-AGENT_LIST    — the store Ops paints its first frame from
 *   3. kv:agent-teams         — the portal's authorisation floor: who a TL may SEE
 *
 * Driven against the real Worker module, the same code Cloudflare runs.
 *
 * Run: node verify-roster-changes.mjs
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { publishAgentListStub } from './stub-publish-agent-list.mjs';   // the DB's publish, in memory (see that file)
const AGENTOS = 'C:/Users/aarav/OneDrive/Desktop/Chatterbox Agent OS/agentos';
const worker = (await import(pathToFileURL(path.join(AGENTOS, 'worker', 'src', 'index.mjs')).href)).default;

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + ' — ' + d); } };

let rules = {}, store = {};
const ENV = { SUPABASE_URL: 'http://stub.local', SUPABASE_SECRET_KEY: 'k' };
const realFetch = globalThis.fetch;
globalThis.fetch = async (u, o = {}) => {
  const url = String(u);
  const J = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
  if (url.includes('/rest/v1/app_sessions')) return J([{ user_id: 'u1', expires_at: '2099-01-01T00:00:00Z',
    app_users: { username: 'nick', full_name: 'Nick', role: 'admin', apps: null, tabs: null, pii_unmask: true,
      active: true, cb: null, team: null, hub_ids: null, must_change_password: false } }]);
  if (url.startsWith('http://stub.local/rest/v1/rpc/publish_agent_list'))
    return J(publishAgentListStub(JSON.parse(o.body || '{}')));
  if (url.startsWith('http://stub.local/rest/v1/rules')) {
    if ((o.method || 'GET') === 'GET') {
      const m = /key=eq\.([^&]+)/.exec(url); const k = m ? decodeURIComponent(m[1]) : '';
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

const call = (method, p, body) => worker.fetch(
  new Request('https://api.local' + p, { method, headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body) }), ENV, { waitUntil: (x) => x });
const post = (b) => call('POST', '/api/roster', b).then(r => r.json());
const get = () => call('GET', '/api/roster').then(r => r.json());

/* the three downstream views, read the way each consumer reads them */
const mirror = () => { try { return JSON.parse(store['raw/kv/cb-facts-AGENT_LIST'] || '[]'); } catch { return []; } };
const teams = () => (rules['kv:agent-teams'] && rules['kv:agent-teams'].value && rules['kv:agent-teams'].value.teams) || {};
const teamOf = (cb) => teams()[cb];
const mirrorOf = (cb) => mirror().find(r => r.cb_code === cb) || null;
const leadersIn = (o) => [...new Set(Object.values(o))].sort();

const A = (code, name, tl, campaign = 'Courtesy', tenure = 'M1') => ({ code, name, tl, campaign, tenure, target: 3 });

console.log('  every scenario checked in the record, the Ops mirror and the portal map\n');

/* ---- DAY ONE: two leaders, four agents --------------------------------------------- */
let r = await post({ source: 'vas', as_of: '2026-08-01', file: 'day1.xlsx', roster: [
  A('CB100', 'Alpha One', 'Renolan Pillay'),
  A('CB101', 'Beta Two', 'Renolan Pillay'),
  A('CB102', 'Gamma Three', 'Sharoma Rampersad', 'Cuddle', 'Exp'),
  A('CB103', 'Delta Four', 'Sharoma Rampersad', 'Cuddle', 'Exp'),
] });
ok('day one: the list is published', r.accepted === true && r.n === 4, JSON.stringify(r));
ok('the portal map carries both leaders', leadersIn(teams()).join(', ') === 'Renolan Pillay, Sharoma Rampersad', leadersIn(teams()).join(', '));
ok('the Ops mirror carries all four agents', mirror().length === 4, String(mirror().length));

/* ---- A BRAND NEW TEAM LEADER, with a new agent and one moved across ----------------- */
r = await post({ source: 'ops', as_of: '2026-08-10', file: 'day2.xlsx', roster: [
  A('CB100', 'Alpha One', 'Renolan Pillay'),
  A('CB101', 'Beta Two', 'Fabian Chetty'),                       // MOVED to the new leader
  A('CB102', 'Gamma Three', 'Sharoma Rampersad', 'Cuddle', 'Exp'),
  A('CB103', 'Delta Four', 'Sharoma Rampersad', 'Cuddle', 'Exp'),
  A('CB104', 'Epsilon Five', 'Fabian Chetty'),                   // BRAND NEW agent
] });
ok('a new leader and a new agent are accepted', r.accepted === true && r.n === 5, JSON.stringify(r));
let g = await get();
ok('the NEW agent is on the roster', g.roster.some(a => a.code === 'CB104'), g.roster.map(a => a.code).join(','));
ok('the NEW leader appears in the portal map', leadersIn(teams()).includes('Fabian Chetty'), leadersIn(teams()).join(', '));
ok('the MOVED agent reads their NEW leader', teamOf('CB101') === 'Fabian Chetty', String(teamOf('CB101')));
ok('...and no longer their old one', teamOf('CB101') !== 'Renolan Pillay');
ok('the moved agent moved in the Ops mirror too', (mirrorOf('CB101') || {}).team_leader === 'Fabian Chetty',
  JSON.stringify(mirrorOf('CB101')));
ok('the new agent reached the Ops mirror', !!mirrorOf('CB104'), 'CB104 missing from the mirror');

/* ---- A LEAVER: dropped from the list means gone everywhere -------------------------- */
r = await post({ source: 'vas', as_of: '2026-08-20', file: 'day3.xlsx', roster: [
  A('CB100', 'Alpha One', 'Renolan Pillay'),
  A('CB101', 'Beta Two', 'Fabian Chetty'),
  A('CB104', 'Epsilon Five', 'Fabian Chetty'),
  /* CB102 and CB103 have left — and with them, their whole team */
] });
ok('a shorter list is accepted', r.accepted === true && r.n === 3, JSON.stringify(r));
g = await get();
ok('the leavers are off the roster', !g.roster.some(a => a.code === 'CB102' || a.code === 'CB103'),
  g.roster.map(a => a.code).join(','));
ok('the leavers are out of the portal map', !teamOf('CB102') && !teamOf('CB103'), JSON.stringify(teams()));
ok('the leavers are out of the Ops mirror', !mirrorOf('CB102') && !mirrorOf('CB103'),
  mirror().map(x => x.cb_code).join(','));
ok('a leader who lost every agent is gone entirely', !leadersIn(teams()).includes('Sharoma Rampersad'),
  leadersIn(teams()).join(', '));

/* ---- A RENAMED LEADER: every one of their agents follows --------------------------- */
r = await post({ source: 'ops', as_of: '2026-08-21', file: 'day4.xlsx', roster: [
  A('CB100', 'Alpha One', 'Renolan Pillay'),
  A('CB101', 'Beta Two', 'Fabian Chetty-Naidoo'),                // renamed
  A('CB104', 'Epsilon Five', 'Fabian Chetty-Naidoo'),
] });
ok('a leader rename is accepted', r.accepted === true, JSON.stringify(r));
ok('both of their agents follow the new name',
  teamOf('CB101') === 'Fabian Chetty-Naidoo' && teamOf('CB104') === 'Fabian Chetty-Naidoo',
  JSON.stringify(teams()));
ok('the old spelling survives nowhere', !leadersIn(teams()).includes('Fabian Chetty'), leadersIn(teams()).join(', '));

/* ---- A WHOLE-FLOOR REORGANISATION -------------------------------------------------- */
r = await post({ source: 'vas', as_of: '2026-08-25', file: 'reorg.xlsx', roster: [
  A('CB100', 'Alpha One', 'Nikita Baijnath', 'Nesting', 'M0'),
  A('CB101', 'Beta Two', 'Nikita Baijnath', 'Nesting', 'M0'),
  A('CB104', 'Epsilon Five', 'Nikita Baijnath', 'Nesting', 'M0'),
] });
g = await get();
ok('a whole-floor move puts every agent under the new leader',
  Object.values(teams()).every(t => t === 'Nikita Baijnath'), JSON.stringify(teams()));
ok('no previous leader survives anywhere in the map', leadersIn(teams()).length === 1, leadersIn(teams()).join(', '));
ok('campaign and tenure moved with them in the record',
  g.roster.every(a => a.campaign === 'Nesting' && a.tenure === 'M0'),
  JSON.stringify(g.roster.map(a => a.campaign + '/' + a.tenure)));
ok('...and in the Ops mirror, which is what Ops paints first',
  mirror().every(x => x.queue === 'Nesting' && x.tenure === 'M0'),
  JSON.stringify(mirror().map(x => x.queue + '/' + x.tenure)));

/* ---- THE MIRROR IS A REPLACEMENT, NOT AN ACCUMULATION ------------------------------ */
ok('the mirror holds exactly the current roster, with nothing left over',
  mirror().length === 3 && mirror().every(x => ['CB100', 'CB101', 'CB104'].includes(x.cb_code)),
  mirror().length + ' rows: ' + mirror().map(x => x.cb_code).join(','));
ok('the portal map holds exactly the current roster too',
  Object.keys(teams()).sort().join(',') === 'CB100,CB101,CB104', Object.keys(teams()).sort().join(','));

/* ---- AND THE THREE VIEWS AGREE WITH EACH OTHER ------------------------------------- */
g = await get();
const disagree = g.roster.filter(a => {
  const m = mirrorOf(a.code);
  return !m || m.team_leader !== a.tl || m.queue !== a.campaign || teamOf(a.code) !== a.tl;
});
ok('record, Ops mirror and portal map agree on every agent', disagree.length === 0,
  JSON.stringify(disagree.map(a => a.code)));
ok('the mirror fingerprint matches the list being served',
  (rules['kv:roster-mirror-fp'] || {}).value?.fingerprint === g.fingerprint,
  JSON.stringify((rules['kv:roster-mirror-fp'] || {}).value));

/* ---- THE CRON SEEDS THE RECORD, AND NEVER OVERWRITES A PUBLISHED ONE --------------- */
{
  const published = rules['kv:roster-current'].value;          // the reorg list, from a real publish
  await worker.scheduled({}, ENV, { waitUntil: (p) => p });
  await new Promise(r => setTimeout(r, 40));
  ok('the cron leaves a published list alone',
    rules['kv:roster-current'].value.fingerprint === published.fingerprint,
    rules['kv:roster-current'].value.source + ' / ' + rules['kv:roster-current'].value.fingerprint);

  /* the state the live system is in right now: a roster derived from VAS, no record yet */
  delete rules['kv:roster-current'];
  rules['kv:vas-state'] = { updated_at: '2026-08-28T08:00:00Z', value: { data: JSON.stringify({
    roster: [A('CB200', 'Seeded One', 'Denise Haripersad'), A('CB201', 'Seeded Two', 'Denise Haripersad')],
    files: [{ type: 'roster (VAS)', name: 'Matrix - Agent List.xlsx', asOf: '2026-08-27' }] }) } };
  globalThis.__rosterCache = null;
  await worker.scheduled({}, ENV, { waitUntil: (p) => p });
  await new Promise(r => setTimeout(r, 40));
  const seeded = rules['kv:roster-current'] && rules['kv:roster-current'].value;
  ok('with no record, the cron seeds one from what is already being served',
    !!seeded && seeded.n === 2 && seeded.source === 'seed',
    JSON.stringify(seeded && { n: seeded.n, src: seeded.source, as_of: seeded.as_of }));
  ok('...carrying the date the list describes', !!seeded && seeded.as_of === '2026-08-27', String(seeded && seeded.as_of));

  /* and a genuine upload still supersedes the seed */
  const up = await post({ source: 'ops', as_of: '2026-08-29', roster: [A('CB200', 'Seeded One', 'A New Leader')] });
  ok('a real upload supersedes the seeded record', up.accepted === true, JSON.stringify(up));
  ok('...and the portal map follows it', teamOf('CB200') === 'A New Leader', JSON.stringify(teams()));
}

globalThis.fetch = realFetch;
console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
process.exit(fail ? 1 : 0);
