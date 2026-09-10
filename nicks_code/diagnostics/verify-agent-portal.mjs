/* VERIFY AGENT ANALYTICS PORTAL — authorisation, scoping and the Coaching Hub join.
 *
 * The claim this file has to keep true is the one the whole portal exists for:
 *   an agent can reach their own figures and NOBODY else's;
 *   a team leader can reach their own team and NO other team;
 *   and neither can reach the management API at all.
 *
 * Everything here runs against the LIVE published digest and the LIVE Coaching
 * Hub, because both are the actual sources of truth and a test against fixtures
 * would keep passing after either of them changed shape. No browser, pure Node.
 *
 *   node nicks_code/diagnostics/verify-agent-portal.mjs
 *   node nicks_code/diagnostics/verify-agent-portal.mjs --live   (also hit the deployed Worker)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const SRC = (f) => 'file:///' + path.join(ROOT, 'worker', 'src', f).replace(/\\/g, '/').replace(/ /g, '%20');
const { authorise, overview, agentDetail, normCb, loadDigest, PORTAL_ROLES, PORTAL_ALLOWED } = await import(SRC('portal.mjs'));
const { rollUp, sessionsForAgent, getCoaching } = await import(SRC('coaching.mjs'));

const LIVE = process.argv.includes('--live');
const API = 'https://chatterbox-agentos-api.chatterbox-agentos.workers.dev';

let pass = 0; const fails = [];
const ok = (name, cond, detail) => { if (cond) { pass++; } else { fails.push(name + (detail ? ' — ' + detail : '')); } };
const section = (s) => console.log('\n' + s);

/* ---------- load the real digest ---------- */
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, 'supabase.env'), 'utf8')
  .split(/\r?\n/).filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const H = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY };
/* Loaded through the WORKER'S OWN loadDigest(), not by reading Supabase here —
   so this exercises the real code path including the kv:agent-teams fallback.
   A test that hand-rolls its own loader proves nothing about the thing that
   runs in production. */
const DB = {
  select: async (p) => (await fetch(`${env.SUPABASE_URL}/rest/v1/${p}`, { headers: H, signal: AbortSignal.timeout(90000) })).json(),
  storageGet: async (bucket, key) => {
    const r = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${bucket}/${key}`, { headers: H, signal: AbortSignal.timeout(90000) });
    return r.ok ? r.text() : null;
  },
};
const digest = await loadDigest(DB);
if (!digest) { console.error('FATAL: no agent digest published.'); process.exit(2); }

section('A · the digest can scope a team');
const all = [...digest.agents, ...digest.notCovered];
ok('A1 digest has agents', digest.agents.length > 0, digest.agents.length + '');
ok('A2 every covered agent carries a team leader', digest.agents.every(a => a.tl),
  digest.agents.filter(a => !a.tl).length + ' without tl');
ok('A3 not-covered rows carry a team leader too', digest.notCovered.every(a => a.tl),
  digest.notCovered.filter(a => !a.tl).length + ' without tl');
const teams = [...new Set(all.map(a => a.tl).filter(Boolean))];
ok('A4 more than one team exists', teams.length > 1, teams.length + ' teams');
ok('A5 no money in the not-covered list', digest.notCovered.every(a => a.gwpEx === undefined && a.sales === undefined));

section('B · identity normalisation');
ok('B1 CB-93 / cb 93 / 093 / 93 all resolve to CB93',
  ['CB-93', 'cb 93', '093', '93', 'CB93', 'cb-0093'].every(v => normCb(v) === 'CB93'));
ok('B2 a blank never becomes an identity', normCb('') === '' && normCb(null) === '' && normCb('abc') === '');

/* A digest with no `tl` cannot scope anybody, so stop here with the actual reason
   rather than throwing further down. It means PULSE republished from a build that
   predates the tl change — deploy the Pages apps, then run
   tools/digest-backfill-tl.mjs --apply to bridge the gap. */
if (!digest.agents.some(a => a.tl)) {
  console.log('\n' + '='.repeat(60));
  console.log(`${pass} passed · ${fails.length + 1} failed`);
  console.log('\nFAILURES:\n  ✗ A2 the published digest carries no team leader on any agent.');
  console.log('    PULSE has republished from a build without the `tl` field. Deploy the');
  console.log('    Pages apps, then: node tools/digest-backfill-tl.mjs --apply');
  process.exit(1);
}

section('C · an AGENT sees only themselves');
const target = digest.agents.find(a => a.tl) || digest.agents[0];
const foreign = digest.agents.find(a => a.code !== target.code && a.tl && a.tl !== target.tl)
  || digest.agents.find(a => a.code !== target.code);
const agentUser = { role: 'agent', cb: target.code, full_name: target.name, username: target.code.toLowerCase() };
const aAuth = authorise(agentUser, digest);
ok('C1 scope is a single code', aAuth.scope === 'agent' && aAuth.codes.size === 1 && aAuth.codes.has(target.code));
const aOv = await overview({}, DB, agentUser, digest);
ok('C2 overview returns 200', aOv.status === 200, String(aOv.status));
ok('C3 overview carries their own row', aOv.body.me && aOv.body.me.code === target.code);
ok('C4 overview carries no `agents` list at all', aOv.body.agents === undefined);
const aJson = JSON.stringify(aOv.body);
const leaked = digest.agents.filter(x => x.code !== target.code)
  .filter(x => aJson.includes('"' + x.code + '"') || aJson.includes('"' + x.name + '"'));
ok('C5 no other agent is named anywhere in the payload', leaked.length === 0, leaked.slice(0, 3).map(x => x.code).join(','));
ok('C6 peer context is anonymous (a group average, no names)',
  !aOv.body.peers || Object.keys(aOv.body.peers).every(k => ['n', 'gwpEx', 'sales', 'pctT'].includes(k)));
const aOther = await agentDetail({}, DB, agentUser, digest, foreign.code);
ok('C7 asking for another agent by ?cb= is refused', aOther.status === 403, `${foreign.code} → ${aOther.status}`);
ok('C8 the refusal reveals nothing about that agent',
  !JSON.stringify(aOther.body).includes(foreign.name));
const aOddFmt = await agentDetail({}, DB, agentUser, digest, foreign.code.replace('CB', 'cb-0'));
ok('C9 a reformatted foreign CB is still refused', aOddFmt.status === 403, String(aOddFmt.status));
const aSelf = await agentDetail({}, DB, agentUser, digest, target.code);
ok('C10 their own record is still reachable', aSelf.status === 200);

section('D · a TEAM LEADER sees only their team');
/* Largest team by COVERED agents with a target — not by head count. The head-count
   winner can be a VT-heavy team (VT is not a reported campaign), where zero covered
   agents turn D6's weighted %-to-target into 0/0 and the check fails on NaN instead
   of testing the formula (seen 2026-08-27 when Preston's 28-strong VT team topped
   the list). */
const team = teams.map(t => ({ t, n: all.filter(a => a.tl === t && a.covered && (a.target || 0) > 0).length }))
  .sort((a, b) => b.n - a.n)[0].t;
const tlUser = { role: 'team_leader', cb: 'CB6', team, full_name: team, username: 'cb6' };
const tAuth = authorise(tlUser, digest);
ok('D1 scope is the team', tAuth.scope === 'team' && tAuth.codes.size === all.filter(a => a.tl === team).length);
const tOv = await overview({}, DB, tlUser, digest);
ok('D2 overview returns 200', tOv.status === 200, String(tOv.status));
ok('D3 every agent listed is on their team', tOv.body.agents.every(a => a.tl === team),
  tOv.body.agents.filter(a => a.tl !== team).map(a => a.code).join(','));
const tJson = JSON.stringify(tOv.body);
const outsiders = all.filter(x => x.tl !== team).filter(x => tJson.includes('"' + x.code + '"'));
ok('D4 nobody outside the team appears in the payload', outsiders.length === 0, outsiders.slice(0, 3).map(x => x.code).join(','));
/* Month to date, Weekly and Daily (2026-08-26) all render from these same scoped rows —
   the day-level detail travels INSIDE each agent's record, so proving no outsider's row is
   present proves no outsider's days are either. These pins make that explicit. */
ok("D4b the day-level rows ride only on the team's own agents",
  tOv.body.agents.every(a => !a.days || a.tl === team));
{
  const inTeam = tOv.body.agents.reduce((n, a) => n + ((a.days || []).length), 0);
  const covered = tOv.body.agents.filter(a => a.covered).length;
  ok('D4c the scoped payload actually carries day rows (Weekly/Daily have data to draw)',
    covered === 0 || inTeam > 0, covered + ' covered agents, ' + inTeam + ' day rows');
  ok('D4d and the scores are per team member, no stray floor list',
    tOv.body.agents.every(a => a.score == null || a.tl === team));
}
ok('D5 team totals are present', tOv.body.totals && tOv.body.totals.agents === tOv.body.agents.length);
/* Percent-to-target must be the team's sales over the team's target, not the mean
   of each agent's percentage — averaging percentages weights a quiet M0 desk the
   same as a full Exp desk. */
const cov = tOv.body.agents.filter(a => a.covered);
const wantPct = cov.reduce((n, a) => n + (a.sales || 0), 0) / cov.reduce((n, a) => n + (a.target || 0), 0);
/* Tolerance is 1e-4 because pctT is PUBLISHED rounded to four places — the same
   precision the digest uses for every rate. A tighter bound tests the rounding,
   not the formula. The average-of-averages it must not be is well outside this. */
const avgOfAvgs = cov.reduce((n, a) => n + (a.pctT || 0), 0) / cov.length;
ok('D6 team %-to-target is weighted, not an average of averages',
  Math.abs(tOv.body.totals.pctT - wantPct) <= 1e-4, `${tOv.body.totals.pctT} vs ${wantPct.toFixed(6)}`);
ok('D6b and the two are actually distinguishable on this team',
  Math.abs(wantPct - avgOfAvgs) > 1e-4, `weighted ${wantPct.toFixed(4)} vs mean-of-means ${avgOfAvgs.toFixed(4)}`);
const tOwn = await agentDetail({}, DB, tlUser, digest, tOv.body.agents[0].code);
ok('D7 drilldown into their own agent works', tOwn.status === 200, String(tOwn.status));
const notMine = all.find(a => a.tl && a.tl !== team);
const tOther = await agentDetail({}, DB, tlUser, digest, notMine.code);
ok('D8 drilldown into another team is refused', tOther.status === 403, `${notMine.code} → ${tOther.status}`);
ok('D9 that refusal reveals nothing', !JSON.stringify(tOther.body).includes(notMine.name));

section('E · broken accounts fail loudly, never to an empty screen');
ok('E1 agent with no CB number is told so', authorise({ role: 'agent', cb: '' }, digest).status === 403);
ok('E2 team leader with no team is told so', authorise({ role: 'team_leader', cb: 'CB6', team: '' }, digest).status === 403);
const renamed = authorise({ role: 'team_leader', cb: 'CB6', team: 'A Team That Does Not Exist' }, digest);
ok('E3 a renamed team is an error, not an empty list', renamed.status === 409 && /Agent List/.test(renamed.error));
ok('E4 other roles are refused the portal', authorise({ role: 'viewer' }, digest).status === 403
  && authorise({ role: 'qa' }, digest).status === 403 && authorise({ role: 'tl' }, digest).status === 403);
ok('E5 admin/exec may preview the whole roster', authorise({ role: 'admin' }, digest).scope === 'all'
  && authorise({ role: 'exec' }, digest).codes.size === all.length);
const ghost = authorise({ role: 'agent', cb: 'CB999999' }, digest);
ok('E6 an agent with no data still gets their identity', ghost.scope === 'agent' && ghost.missing === true && !ghost.error);

section('F · the Worker lockdown is an allow-list');
const idx = fs.readFileSync(path.join(ROOT, 'worker', 'src', 'index.mjs'), 'utf8');
ok('F1 the lockdown sits immediately after the session check',
  /if \(!user\) return json\(\{ error: 'Sign in required\.' \}, 401\);[\s\S]{0,2000}?if \((?:PORTAL_ROLES\.has\(user\.role\)|portalOnly\(user\)) && !PORTAL_ALLOWED\.has\(path\)\)/.test(idx));
/* campaign_manager joined 2026-08-30 — the third view. It is INSIDE the
   lockdown by role; since 2026-09-07 the lock follows the GRANT (portalOnly): a CM with no
   management app reaches only PORTAL_ALLOWED, one granted ops/vas is a manager too. */
ok('F2 portal roles are agent + team_leader + campaign_manager',
  PORTAL_ROLES.has('agent') && PORTAL_ROLES.has('team_leader') && PORTAL_ROLES.has('campaign_manager') && PORTAL_ROLES.size === 3);
for (const shut of ['/api/kv', '/api/bi', '/api/eod', '/api/ask', '/api/agent-link', '/api/campaign-stats', '/api/referrals', '/api/coaching', '/api/coaching/summary', '/api/bi/raw', '/api/agent-digest'])
  ok('F3 ' + shut + ' is closed to portal roles', !PORTAL_ALLOWED.has(shut));
for (const open of ['/api/me', '/api/logout', '/api/password', '/api/portal/me', '/api/portal/overview', '/api/portal/agent'])
  ok('F4 ' + open + ' is open to portal roles', PORTAL_ALLOWED.has(open));
ok('F5 every route the Worker serves a portal role is one it declares',
  [...PORTAL_ALLOWED].every(p => idx.includes(`'${p}'`)));

/* ROUTES THAT SIT ABOVE THE SESSION GATE ARE INVISIBLE TO THE LOCKDOWN.
   The central check runs after `if (!user)`, so anything handled before that line
   is NOT covered by it — /api/agent-digest was, and served an agent's own valid
   session the entire 130-agent digest until the live test caught it. Any route up
   there must either be safe for an anonymous caller or refuse portal roles itself.
   This pins the list, so adding a fourth one fails here and forces the decision. */
{
  const gateAt = idx.indexOf("if (!user) return json({ error: 'Sign in required.' }, 401)");
  const above = [...idx.slice(0, gateAt).matchAll(/path === '(\/api\/[a-z/-]+)'/g)].map(m => m[1]);
  /* /api/wimpy/signin reviewed 2026-09-11: the Wimpy app's CB-only sign-in (auth.mjs signinByCb —
     rate-limited, mints a session SCOPED to /api/wimpy/*). It has to sit above the gate because
     it IS a sign-in; a wimpy-scoped session reaches nothing else (F-checks below the gate). */
  const known = ['/api/login', '/api/referrals/health', '/api/me', '/api/logout', '/api/agent-digest', '/api/wimpy/signin'];
  const surprise = [...new Set(above)].filter(p => !known.includes(p));
  ok('F6 no unreviewed route sits above the session gate', surprise.length === 0, surprise.join(','));
  /* The two that return real data up there must refuse portal roles by hand. */
  const dBody = idx.slice(idx.indexOf("path === '/api/agent-digest'"), gateAt);
  ok('F7 /api/agent-digest refuses portal roles itself',
    /(?:PORTAL_ROLES\.has\(user\.role\)|portalOnly\(user\))\) return json\(\{ error: 'Not permitted\.' \}, 403\)/.test(dBody));   // portalOnly(): the lock follows the GRANT since 2026-09-07
}
ok('F6 the retired share key no longer authorises the digest',
  !/agent_link_key[\s\S]{0,400}?allowed = diff === 0/.test(idx));

/* A CB NUMBER MUST RESOLVE THE ACCOUNT THAT HOLDS IT (Nick, 2026-08-30 — reported as
   "logging into CB145, the campaign view is not showing"). login() normalises "CB145"
   to the USERNAME cb145, which is right for every account provision-agent-logins made
   and wrong for anyone given a CB after they already had a management username. Dalwin
   is that case: username `dalwin`, cb CB145 — so the number he was handed answered
   "Invalid username or password", which reads as a broken page rather than a bad login. */
{
  const a = fs.readFileSync(path.join(ROOT, 'worker', 'src', 'auth.mjs'), 'utf8');
  ok('H1 login falls back to the cb COLUMN when no username matches',
    /rows = await DB\.select\(`app_users\?cb=ilike\./.test(a));
  ok('H2 the username is still tried FIRST',
    a.indexOf('app_users?username=eq.') < a.indexOf('app_users?cb=ilike.'));
  ok('H3 the fallback only fires for a CB-shaped input',
    /\/\^cb\[0-9\]\+\$\/\.test\(username\)/.test(a));
  ok('H4 it is a single-row lookup on a uniquely-indexed column',
    /app_users\?cb=ilike\.\$\{encodeURIComponent\(username\)\}&limit=1/.test(a));
}

section('G · Coaching Hub actually returns data');
let hub = null;
try { hub = await getCoaching(env, DB); } catch (e) { fails.push('G0 the Coaching Hub snapshot could not be read — ' + e.message); }

/* THE SUBREQUEST TRAP. A full Hub pull is 6 collections × 14 leaders = 84
   requests and Cloudflare caps one invocation at 50. It does not error, it
   PARTIALLY succeeds — 45 of 84 came back and a team leader with 139 coaching
   sessions was shown 23. So the Worker must read a stored snapshot, never fan
   out, and the sync tool must refuse to write a partial one over a good one. */
{
  const co = fs.readFileSync(path.join(ROOT, 'worker', 'src', 'coaching.mjs'), 'utf8');
  const sync = fs.readFileSync(path.join(ROOT, 'tools', 'sync-coaching-hub.mjs'), 'utf8');
  const body = co.slice(co.indexOf('export async function getCoaching'));
  ok('G0a the Worker reads the kv:coaching snapshot', /rules\?key=eq\.\$\{encodeURIComponent\('kv:coaching'\)\}/.test(body));
  ok('G0b the Worker never fans out to the Hub itself',
    !/fetchCoaching\(/.test(body) && !/convexQuery\(/.test(body));
  ok('G0c a stale snapshot is marked, not passed off as fresh', /STALE_HOURS/.test(body) && /d\.stale = true/.test(body));
  ok('G0d the sync tool refuses to write a partial snapshot',
    /if \(hub\.errors\.length\)/.test(sync) && /REFUSING to write a partial snapshot/.test(sync));
  ok('G0e the sync tool imports the Worker\'s own normaliser rather than repeating it',
    /await import\(SRC\)/.test(sync) && /fetchCoaching, rollUp/.test(sync));
}
if (hub) {
  ok('G1 sessions come back', hub.sessions.length > 0, hub.sessions.length + ' sessions');
  ok('G2 no collection errored', (hub.errors || []).length === 0, (hub.errors || []).slice(0, 2).join(' | '));
  const hj = JSON.stringify(hub.sessions.slice(0, 200));
  ok('G3 no signature blobs travel', !hj.includes('data:image'));
  ok('G4 every session has an ISO date', hub.sessions.every(s => /^\d{4}-\d{2}-\d{2}$/.test(s.date)));
  ok('G5 most sessions resolve to a CB number', hub.sessions.filter(s => s.cb).length / hub.sessions.length > 0.8,
    `${hub.sessions.filter(s => s.cb).length}/${hub.sessions.length}`);
  ok('G6 cluster keys are family-qualified', hub.sessions.flatMap(s => s.clusters)
    .every(c => /^[a-z_]+\.[a-z_]+$/.test(c.clusterKey) && c.clusterKey.startsWith(c.family + '.')));
  /* The roll-up must never score an inferred classification: a back-classifier
     reading a theme out of a coaching note is not a coach choosing it, and
     scoring it would fire a Level 1 compliance review at a named person on the
     strength of a regex. Today EVERY classified session on the Hub is inferred,
     so this also pins `scored` at 0 — see the note in coaching.mjs. */
  const inferredOnly = hub.sessions.filter(s => s.clusterSource === 'inferred');
  ok('G7 inferred sessions are never scored', rollUp(inferredOnly).every(t => t.scored === 0));
  ok('G8 themes are still SHOWN when inferred', rollUp(inferredOnly).some(t => t.shown > 0));
  const onRoster = new Set(all.map(a => a.code));
  const matched = all.map(a => sessionsForAgent(hub.sessions, a.code, a.name)).filter(r => r.sessions.length);
  ok('G9 coaching reaches real roster agents', matched.length > 10, matched.length + ' agents have sessions');
  ok('G10 a record carrying a CB number is never name-matched to someone else',
    hub.sessions.filter(s => s.cb && !onRoster.has(s.cb)).every(s =>
      all.every(a => !sessionsForAgent([s], a.code, a.name).sessions.length)));
  const withCb = hub.sessions.filter(s => s.cb);
  ok('G11 CB-matched sessions land on the agent that CB belongs to',
    withCb.slice(0, 50).every(s => sessionsForAgent([s], s.cb, 'zzz').sessions.length === 1));
  ok('G12 MTD filtering works on the published period',
    hub.sessions.some(s => s.date >= digest.period.from && s.date <= digest.period.to));
}

section('H · agent + team leader payloads carry coaching');
ok('H1 agent payload has a coaching block', !!aOv.body.coaching);
ok('H2 agent coaching is only their own',
  !aOv.body.coaching.error ? (aOv.body.coaching.agents || []).every(x => x.code === target.code) : true);
ok('H3 team leader coaching covers the team only',
  !tOv.body.coaching.error ? (tOv.body.coaching.agents || []).every(x => tAuth.codes.has(x.code)) : true);
ok('H4 a Hub outage does not take the page down (error travels as a field)',
  aOv.body.coaching.error === undefined || typeof aOv.body.coaching.error === 'string');
ok('H5 team leader list carries no coaching free text (counts and themes only)',
  !tOv.body.coaching.error ? (tOv.body.coaching.agents || []).every(x => x.sessions === undefined) : true);

if (LIVE) {
  section('I · the deployed Worker enforces it');
  const post = (p, b) => fetch(API + p, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Cbx-Client': 'v5' }, body: JSON.stringify(b) });
  const get = (p, t) => fetch(API + p, { headers: { 'X-Cbx-Client': 'v5', ...(t ? { Authorization: 'Bearer ' + t } : {}) } });
  const lr = await post('/api/login', { username: target.code, password: 'agentos123' });
  const lj = await lr.json();
  ok('I1 an agent can sign in with their CB number', lr.status === 200 && !!lj.token, `${lr.status} ${lj.error || ''}`);
  if (lj.token) {
    ok('I2 the session reports role agent', lj.user.role === 'agent', lj.user.role);
    for (const shut of ['/api/kv?key=vas-state', '/api/bi', '/api/eod', '/api/coaching/summary', '/api/agent-link', '/api/agent-digest', '/api/campaign-stats']) {
      const r = await get(shut, lj.token);
      ok('I3 ' + shut.split('?')[0] + ' is refused', r.status === 403, String(r.status));
    }
    const own = await get('/api/portal/overview', lj.token);
    ok('I4 their own overview is served', own.status === 200, String(own.status));
    const other = await get('/api/portal/agent?cb=' + encodeURIComponent(foreign.code), lj.token);
    ok('I5 another agent over the API is refused', other.status === 403, String(other.status));
    const badPw = await post('/api/login', { username: target.code, password: 'wrong-password' });
    ok('I6 a wrong password is refused', badPw.status === 401, String(badPw.status));
    const noUser = await post('/api/login', { username: 'CB999999', password: 'agentos123' });
    ok('I7 an unknown CB number is refused', noUser.status === 401, String(noUser.status));
    await fetch(API + '/api/logout', { method: 'POST', headers: { 'X-Cbx-Client': 'v5', Authorization: 'Bearer ' + lj.token } });
    const after = await get('/api/portal/overview', lj.token);
    ok('I8 the session dies on sign-out', after.status === 401, String(after.status));
  }
}

console.log(`\n${'='.repeat(60)}`);
console.log(`${pass} passed · ${fails.length} failed`);
if (fails.length) { console.log('\nFAILURES:'); fails.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
console.log('Agent Analytics portal: authorisation, scoping and the Coaching Hub join all hold.');
