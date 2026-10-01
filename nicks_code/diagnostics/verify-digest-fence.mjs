/* verify-digest-fence.mjs — the live agent digest at month rollover (2026-10-01).
 *
 * Agents read the LIVE digest key. It is fenced to the current SAST month (3 Sep: an August browser
 * overwrote September). But at midnight on the 1st the new month has no data, so the fence froze agents
 * on the last copy of the closed month — "1–29 September" on 1 October, the final day never shown.
 * ROLLOVER GRACE: the live key also takes the PREVIOUS month, but only while it is not already on the
 * current month; never anything older; the current month always wins once it publishes. One rule
 * (worker/src/rules.mjs liveDigestAllowed) — the Worker's 409, PULSE's publisher (inline mirror) and the
 * republish tool all ask it. Run: node verify-digest-fence.mjs (no network)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const { liveDigestAllowed, emptyOverData, referralsReadAllowed } = await import(pathToFileURL(path.join(ROOT, 'worker', 'src', 'rules.mjs')).href);

let pass = 0, fail = 0;
const ok = (name, cond, note) => { if (cond) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (note ? ' — ' + note : '')); } };
const OCT1 = Date.parse('2026-10-01T06:00:00Z');   // 08:00 SAST, 1 October

console.log('\n1 · the rule');
ok('the current month is always allowed', liveDigestAllowed('2026-10-01', '2026-09-01', OCT1) === true);
ok('the closed month is allowed while the live key still holds it (rollover grace)', liveDigestAllowed('2026-09-01', '2026-09-01', OCT1) === true);
ok('…or holds something older', liveDigestAllowed('2026-09-01', '2026-08-01', OCT1) === true);
ok('…or nothing yet', liveDigestAllowed('2026-09-01', '', OCT1) === true);
ok('the closed month is REFUSED once the current month has published', liveDigestAllowed('2026-09-01', '2026-10-01', OCT1) === false);
ok('an older month is never allowed (the 3 Sep protection)', liveDigestAllowed('2026-08-01', '2026-08-01', OCT1) === false);
ok('a future month is never allowed', liveDigestAllowed('2026-11-01', '2026-09-01', OCT1) === false);
ok('the month is SAST, not UTC (23:30 UTC on 30 Sep is already 1 Oct)', liveDigestAllowed('2026-10-01', '', Date.parse('2026-09-30T23:30:00Z')) === true);
ok('no period → refused', liveDigestAllowed('', '', OCT1) === false);

console.log('\n2 · every writer asks it');
const W = fs.readFileSync(path.join(ROOT, 'worker', 'src', 'index.mjs'), 'utf8');
ok('the Worker\'s live-key 409 uses liveDigestAllowed', /liveDigestAllowed\(/.test(W));
ok('the Worker REFUSES when it cannot read what is live (fail closed, never "nothing live")', /live digest not readable[\s\S]{0,200}503/.test(W) && !/loadDigest\(DB\)\.catch\(\(\) => null\)/.test(W));
ok('the Worker stamps the live pointer row with its period (the cheap read)', /period: digestFrom/.test(W));
const T = fs.readFileSync(path.join(ROOT, 'tools', 'digest-republish.mjs'), 'utf8');
ok('the republish tool uses liveDigestAllowed', /liveDigestAllowed\(/.test(T));
ok('the tool stamps the live pointer too, and fails closed on an unreadable live digest', /store, period: /.test(T) && /throw new Error\('the live digest has a row but its object did not read'\)/.test(T));
/* spec 002 (C1/C2): since 2026-10-01 the tool no longer falls back to the month just closed — it publishes the honest EMPTY current month
   (the closed month is filed as its (final)) and mirrors the Worker's empty_over_data refusal. */
ok('the tool publishes the EMPTY current month when the live month has no rows (no previous-month fallback)', /publishing it EMPTY/.test(T));
ok('the tool mirrors the Worker\'s empty_over_data refusal', /empty_over_data/.test(T));
const HL = fs.readFileSync(path.join(ROOT, 'worker', 'src', 'health.mjs'), 'utf8');
ok('the health sentinel knows the grace (no false "wrong month" on the 1st)', /closedMonthInGrace/.test(HL));
const P = fs.readFileSync(path.join(ROOT, 'nicks_code', 'index.html'), 'utf8');
const m = P.match(/function liveDigestMonthOk\([^)]*\)\{[\s\S]*?\n\}/);
ok('PULSE carries the inline mirror liveDigestMonthOk', !!m);
if (m) {
  // eslint-disable-next-line no-new-func
  const f = new Function(m[0] + '\nreturn liveDigestMonthOk;')();
  ok('PULSE: the current month publishes live', f('2026-10', OCT1) === true);
  ok('PULSE: the closed month offers itself live (the Worker decides against what the key holds)', f('2026-09', OCT1) === true);
  ok('PULSE: anything older never does', f('2026-08', OCT1) === false);
}

console.log('\n3 · the calculator\'s new-month model reaches the page (commNow)');
const PORTAL = fs.readFileSync(path.join(ROOT, 'worker', 'src', 'portal.mjs'), 'utf8');
ok('the portal envelope passes commNow (a field the envelope does not name never reaches the page)', /commNow:\s*digest\.commNow\s*\|\|\s*null/.test(PORTAL));
/* spec 002 live check (2026-10-01): the empty October was published, but the envelope did not name `empty`, so every
   page rendered a normal month of blanks instead of "No October figures yet" */
ok('the portal envelope passes empty (spec 002 C1 — the page decides the empty state from it)', /empty:\s*digest\.empty\s*===\s*true/.test(PORTAL));
ok('the agent page decides the calculator\'s month in ONE helper (calcMonth) from commNow', /function calcMonth\(\)/.test(fs.readFileSync(path.join(ROOT, 'agent', 'index.html'), 'utf8')) && /D\.commNow/.test(fs.readFileSync(path.join(ROOT, 'agent', 'index.html'), 'utf8')));

console.log('\n4 · spec 002 C2 — an EMPTY payload never replaces a non-empty live month');
{
  /* emptyOverData(payloadEmpty, periodFrom, liveFrom, liveEmpty): true = refuse (409 empty_over_data) */
  ok('empty October over NON-empty October live: refused', emptyOverData(true, '2026-10-01', '2026-10-01', false) === true);
  ok('empty October over EMPTY October live (the tool re-publishing): allowed', emptyOverData(true, '2026-10-01', '2026-10-01', true) === false);
  ok('empty October over September live (the rollover itself): allowed', emptyOverData(true, '2026-10-01', '2026-09-01', false) === false);
  ok('empty October over nothing live: allowed', emptyOverData(true, '2026-10-01', '', false) === false);
  ok('a non-empty October over anything: never refused by this rule', emptyOverData(false, '2026-10-01', '2026-10-01', false) === false && emptyOverData(false, '2026-10-01', '2026-10-01', true) === false);
  ok('the current month is otherwise always allowed (the first real day replaces the empty month)', liveDigestAllowed('2026-10-01', '2026-10-01', OCT1) === true);
  ok('an older month is still never allowed, empty or not', liveDigestAllowed('2026-08-01', '2026-10-01', OCT1) === false);
  ok('the comparison is by MONTH (an empty 2 Oct-dated period is still October)', emptyOverData(true, '2026-10-02', '2026-10-01', false) === true);
  ok('an unstamped pointer (legacy) reads as not empty', emptyOverData(true, '2026-10-01', '2026-10-01', undefined) === true);
  ok('the Worker refuses with 409 empty_over_data', /empty_over_data/.test(W) && /emptyOverData\(/.test(W));
  ok('the Worker stamps empty:true on the pointer row beside period', /period: digestFrom, empty: true|\.\.\.\(digestEmpty \? \{ empty: true \} : \{\}\)/.test(W), 'pointer value must carry empty');
  ok('the Worker reads the live key for an empty payload even when it is the current month', /payloadEmpty/.test(W));
}

console.log('\n5 · spec 002 C3 — referrals-latest is staff-only on GET /api/kv');
{
  ok('an admin may read it', referralsReadAllowed({ role: 'admin', username: 'aarav' }) === true);
  ok('an exec may read it', referralsReadAllowed({ role: 'exec', username: 'x' }) === true);
  ok('a PULSE staff login (viewer) may read it', referralsReadAllowed({ role: 'viewer', username: 'v' }) === true);
  ok('an agent may NOT', referralsReadAllowed({ role: 'agent', username: 'cb1' }) === false);
  ok('a team leader may NOT, even with a management app', referralsReadAllowed({ role: 'team_leader', username: 'cb267', apps: ['vas'] }) === false);
  ok('a campaign manager may NOT', referralsReadAllowed({ role: 'campaign_manager', username: 'ryan' }) === false);
  ok('no user is not allowed', referralsReadAllowed(null) === false);
  ok('a wimpy-scoped session may NOT', referralsReadAllowed({ role: 'admin', scope: 'wimpy' }) === false);
  ok('the GET handler asks it for that key', /referrals-latest[\s\S]{0,300}referralsReadAllowed\(user\)/.test(W));
}

console.log('\n6 · spec 002 — health: the empty current month is the CURRENT month');
{
  const { evaluateFreshness } = await import(pathToFileURL(path.join(ROOT, 'worker', 'src', 'health.mjs')).href);
  const base = { manifestAt: null, vasAt: null, opsAt: null, staffLoginRecent: false, opened: {}, now: Date.parse('2026-10-01T06:00:00Z'), curMonth: '2026-10', digestAt: '2026-10-01T05:50:00Z' };
  const wm = (o) => evaluateFreshness({ ...base, ...o }).some((x) => x.id === 'agent-digest-wrong-month');
  ok('an EMPTY October digest on 1 Oct is not a wrong-month alert', !wm({ digestMonth: '2026-10' }));
  ok('...nor on 20 Oct (still the right month, just no data yet)', !wm({ now: Date.parse('2026-10-20T06:00:00Z'), digestMonth: '2026-10' }));
  ok('...and September live on 20 Oct is still critical', wm({ now: Date.parse('2026-10-20T06:00:00Z'), digestMonth: '2026-09' }));
  ok('...and September live while October is EMPTY and old (20 Oct) is critical too', wm({ now: Date.parse('2026-10-20T06:00:00Z'), digestMonth: '2026-09' }));
  ok('health carries no dead digestEmpty input (the month rule alone decides)', !/digestEmpty/.test(fs.readFileSync(path.join(ROOT, 'worker', 'src', 'health.mjs'), 'utf8')));
}

console.log('\n7 · review fixes — who may WRITE the digest/referral keys, and emptiness is derived server-side');
{
  const { kvWriteAllowed, isGuardedKvKey, digestEmptiness } = await import(pathToFileURL(path.join(ROOT, 'worker', 'src', 'rules.mjs')).href);
  for (const k of ['agent-digest', 'agent-digest-2026-09', 'agent-digest-cycle-2026-09', 'agent-reports-variance', 'agent-reports-leads', 'referrals-latest', 'referrals-sync-log'])
    ok('guarded key: ' + k, isGuardedKvKey(k) === true);
  for (const k of ['vas-state', 'cb-config', 'coaching', 'health-alerts', 'agent-teams']) ok('not guarded: ' + k, isGuardedKvKey(k) === false);
  const G = 'agent-digest';
  for (const role of ['agent', 'team_leader', 'campaign_manager'])
    ok(role + ' may NOT write a guarded key, even holding a management app', kvWriteAllowed(G, { role, apps: ['vas', 'ops'] }) === false && kvWriteAllowed('referrals-latest', { role, apps: ['vas'] }) === false);
  for (const role of ['admin', 'exec', 'tl', 'qa', 'viewer']) ok('staff role ' + role + ' keeps writing as today', kvWriteAllowed(G, { role }) === true);
  ok('a wimpy-scoped session may not', kvWriteAllowed(G, { role: 'admin', scope: 'wimpy' }) === false);
  ok('a referrals-scoped session may not', kvWriteAllowed(G, { role: 'admin', scope: 'referrals' }) === false);
  ok('an explicit full scope is fine', kvWriteAllowed(G, { role: 'admin', scope: 'full' }) === true);
  ok('an unguarded key is open to any non-refused caller (unchanged)', kvWriteAllowed('vas-state', { role: 'team_leader' }) === true);
  ok('no user: refused', kvWriteAllowed(G, null) === false);

  const ag = (o) => ({ code: 'CB1', sales: null, gwpEx: null, pctT: null, act: null, ...o });
  ok('no agents → empty_digest', digestEmptiness({ period: { from: '2026-10-01' }, agents: [] }).error === 'empty_digest');
  ok('agents missing → empty_digest', digestEmptiness({ period: { from: '2026-10-01' } }).error === 'empty_digest');
  ok('flagged empty but an agent carries sales → bad_empty', digestEmptiness({ empty: true, agents: [ag({}), ag({ sales: 3 })] }).error === 'bad_empty');
  for (const f of ['gwpEx', 'pctT', 'act']) ok('flagged empty but ' + f + ' set → bad_empty', digestEmptiness({ empty: true, agents: [ag({ [f]: 0 })] }).error === 'bad_empty');
  ok('a real zero is a figure (sales 0 is not null)', digestEmptiness({ agents: [ag({ sales: 0 })] }).empty === false);
  ok('flagged empty with every figure null → empty', (() => { const r = digestEmptiness({ empty: true, agents: [ag({}), ag({ code: 'CB2' })] }); return r.empty === true && !r.error; })());
  ok('NOT flagged but every agent figure null → derived empty (the fence cannot be dodged by omitting the flag)', digestEmptiness({ agents: [ag({}), ag({ code: 'CB2' })] }).empty === true);
  ok('not flagged with figures → not empty', digestEmptiness({ agents: [ag({ sales: 5 })] }).empty === false);
  ok('an empty:false flag over null figures is still derived empty', digestEmptiness({ empty: false, agents: [ag({})] }).empty === true);
  const W2 = fs.readFileSync(path.join(ROOT, 'worker', 'src', 'index.mjs'), 'utf8');
  ok('POST /api/kv asks kvWriteAllowed', /req\.method === 'POST'[\s\S]{0,400}kvWriteAllowed\(qk, user\)/.test(W2));
  ok('DELETE /api/kv asks kvWriteAllowed', /req\.method === 'DELETE'[\s\S]{0,400}kvWriteAllowed\(qk, user\)/.test(W2));
  ok('the Worker uses digestEmptiness and answers its 400s', /digestEmptiness\(/.test(W2) && /error: em\.error|em\.error/.test(W2));
  ok('the pointer stamp comes from the derived value (payloadEmpty = em.empty)', /payloadEmpty = em\.empty/.test(W2));
  ok('a referrals-scoped session may call ONLY GET /api/referrals (mirrors the wimpy block)', /user\.scope === 'referrals'[\s\S]{0,200}\/api\/referrals/.test(W2) && /referrals-scoped|This sign-in is for the referrals pull only/.test(W2));
  ok('referralsReadAllowed is an ALLOW-list: unknown role refused', referralsReadAllowed({ role: 'mystery' }) === false && referralsReadAllowed({ role: 'tl' }) === true && referralsReadAllowed({ role: 'qa' }) === true);
  ok('...and a referrals/wimpy scope is refused, full allowed', referralsReadAllowed({ role: 'admin', scope: 'referrals' }) === false && referralsReadAllowed({ role: 'admin', scope: 'full' }) === true);
}

console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
process.exitCode = fail ? 1 : 0;
