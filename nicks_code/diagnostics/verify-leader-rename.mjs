/* verify-leader-rename.mjs — the leader sync never guesses and never goes quiet (migrations 047 + 048).
 *
 *   node nicks_code/diagnostics/verify-leader-rename.mjs
 *
 * Runs the REAL publish_agent_list() / sync_team_leaders() against the REAL list inside ONE
 * transaction that is always rolled back — nothing in the database changes. Proves, against
 * the live functions (ecc:pr-test-analyzer, 22 Sep: the real-DB suite never exercised an actual
 * removal):
 *   A · a leader re-spelt on the "VAS TL" sheet (same CB) keeps the SAME login (047);
 *   B · an agent dropped from the list loses their login and their sessions in the same publish;
 *   C · a leader dropped from the sheet who leads nobody loses their login; one who still leads
 *       listed agents is kept;
 *   D · a leader whose CB is already held by another kind of account is reported as blocked[] (048);
 *   E · two spellings resolving to one CB are reported as ambiguous[] and the account is left alone (048).
 */
import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const pg = (await import(pathToFileURL(path.join(HERE, 'node_modules', 'pg', 'lib', 'index.js')).href)).default;
const { hashPassword } = await import(pathToFileURL(path.join(ROOT, 'worker', 'src', 'auth.mjs')).href);
const env = {}; for (const line of fs.readFileSync(path.join(ROOT, 'supabase.env'), 'utf8').split(/\r?\n/)) { const m = /^([A-Z_]+)=(.*)$/.exec(line.trim()); if (m) env[m[1]] = m[2]; }
const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 120000 });
await c.connect();
let fails = 0, passes = 0;
const ok = (n, v, note) => { console.log((v ? '  ok   ' : '  FAIL ') + n + (v ? '' : '   ' + (note || ''))); if (v) passes++; else fails++; };
const head = (t) => console.log('\n' + t);
const q = async (sql, args) => (await c.query(sql, args)).rows;
const one = async (sql, args) => (await q(sql, args))[0];
const HASH = await hashPassword('agentos123');
const publish = async (rows, { apply = false, asOf, actor = 'verify-leader' } = {}) => {
  let r = await one(`select publish_agent_list($1::date, $2::jsonb, $3, $4, $5::jsonb, $6, 25) as r`, [asOf, JSON.stringify(rows), 'list:verify-leader', actor, '{}', apply]);
  r = r.r;
  if (r.status === 'NEEDS_HASHES') {   // hand the hashes the plan asks for, as the Worker does
    const hashes = Object.fromEntries((r.needs_hashes || []).map((cb) => [cb, HASH]));
    r = (await one(`select publish_agent_list($1::date, $2::jsonb, $3, $4, $5::jsonb, $6, 25) as r`, [asOf, JSON.stringify(rows), 'list:verify-leader', actor, JSON.stringify(hashes), apply])).r;
  }
  return r;
};
const btrim = (s) => String(s == null ? '' : s).trim();
const norm = (s) => String(s == null ? '' : s).toUpperCase().replace(/^CB0*/, 'CB');
const restart = async () => { await c.query('rollback'); await c.query('begin'); };   // every section starts from the live state

try {
  await c.query('begin');
  const ASOF = (await one(`select to_char(max(as_of) + 1, 'YYYY-MM-DD') d from agent_list`)).d;
  /* THE LIVE LIST AS ROWS: the accepted rows of the current batch, in the shape the station posts */
  const live = await q(`select sheet, code_raw as code, name, sf, tl, campaign_raw as campaign, tenure, callx, target, to_char(start_date, 'YYYY-MM-DD') as start
                        from agent_list_raw where as_of = (select max(as_of) from agent_list_raw) and accepted order by ord`);
  const sheet = await q(`select 'VAS TL' as sheet, 'leader' as role, norm_cb(employee_code) as code, btrim(leader_name) as name, campaign, manager, norm_cb(employee_code) as callx
                         from team_leader_cbs where on_list_as_of is not null and coalesce(btrim(employee_code), '') <> '' order by leader_name`);
  ok('the live list reads back as rows (' + live.length + ' agents, ' + sheet.length + ' leaders on the sheet)', live.length >= 25 && sheet.length >= 2);
  const nLeaders = (await one(`select count(*)::int n from app_users where role = 'team_leader'`)).n;
  const nAgents = (await one(`select count(*)::int n from app_users where role = 'agent'`)).n;

  head('A · A RENAME IS NOT A DEPARTURE (migration-047)');
  {
    const who = sheet[0];
    const renamed = who.name + ' X';
    const rows = [...sheet.map((s) => s.code === who.code ? { ...s, name: renamed } : s),
                  ...live.map((a) => btrim(a.tl) === who.name ? { ...a, tl: renamed } : a)];   // the workbook re-spells the leader everywhere
    const plan = await publish(rows, { asOf: ASOF });
    const L = plan.leaders || {};
    ok('the plan RENAMES ' + who.code + ' (' + who.name + ' → ' + renamed + ') instead of removing the account', plan.status === 'PLAN' && (L.renamed || []).length === 1 && norm(L.renamed[0].cb) === norm(who.code) && L.renamed[0].now === renamed, plan.status + ' ' + JSON.stringify(L).slice(0, 300));
    ok('…nothing removed, nothing created, nothing ambiguous', (L.would_remove || []).length === 0 && (L.would_create || []).length === 0 && (L.ambiguous || []).length === 0, JSON.stringify(L).slice(0, 300));
    const out = await publish(rows, { asOf: ASOF, apply: true });
    const row = await one(`select username, team, full_name from app_users where role = 'team_leader' and norm_cb(cb) = $1`, [who.code]);
    ok('applied: the SAME login carries the new spelling as team + name', out.status === 'SUCCESS' && row && row.username === who.code.toLowerCase() && row.team === renamed && row.full_name === renamed, out.status + ' ' + JSON.stringify(row));
    ok('…leader count unchanged (' + nLeaders + ')', (await one(`select count(*)::int n from app_users where role = 'team_leader'`)).n === nLeaders);
    await restart();
  }

  head('B · AN AGENT OFF THE LIST LOSES THEIR LOGIN — AND THEIR SESSIONS — IN THE SAME PUBLISH');
  {
    const gone = live.find((a) => /^CB\d+$/i.test(btrim(a.code)) && btrim(a.sheet).toUpperCase() !== 'VT') || live[0];
    const cb = btrim(gone.code);
    const u = await one(`select id from app_users where role = 'agent' and norm_cb(cb) = norm_cb($1)`, [cb]);
    ok(cb + ' (' + gone.name + ') has an agent login today', !!u);
    await c.query(`insert into app_sessions (token_hash, user_id, expires_at, user_agent) values ($1, $2, now() + interval '1 hour', 'verify-leader')`, ['verify-' + Date.now(), u.id]);
    const before = (await one(`select count(*)::int n from app_sessions where user_id = $1`, [u.id])).n;
    const out = await publish([...sheet, ...live.filter((a) => btrim(a.code) !== cb)], { asOf: ASOF, apply: true });
    const A = out.agents || {};
    ok('the publish applies and names the leaver in agents.removed', out.status === 'SUCCESS' && (A.removed || []).some((r) => norm(r.cb) === norm(cb)), out.status + ' ' + JSON.stringify(A.removed || out.detail || out.reason || '').slice(0, 200));
    ok('…the login is gone (deleted, not merely inactive)', !(await one(`select 1 from app_users where id = $1`, [u.id])));
    ok('…and so are their sessions (' + before + ' → 0, FK cascade)', (await one(`select count(*)::int n from app_sessions where user_id = $1`, [u.id])).n === 0);
    ok('…everyone else keeps theirs (' + (nAgents - 1) + ' agent logins)', (await one(`select count(*)::int n from app_users where role = 'agent'`)).n === nAgents - 1);
    await restart();
  }

  head('C · A LEADER OFF THE SHEET: GONE WHEN THEY LEAD NOBODY, KEPT WHILE THEIR AGENTS ARE LISTED');
  {
    const who = sheet[sheet.length - 1];
    const leads = live.filter((a) => btrim(a.tl) === who.name).length;
    const keep = await publish([...sheet.filter((s) => s.code !== who.code), ...live], { asOf: ASOF });
    const K = keep.leaders || {};
    if (leads > 0) ok(who.name + ' off the sheet but still leading ' + leads + ' listed agents is KEPT (would_remove excludes ' + who.code + ')', keep.status === 'PLAN' && !(K.would_remove || []).some((r) => r.username === who.code.toLowerCase()), keep.status + ' ' + JSON.stringify(K.would_remove));
    else ok(who.name + ' leads nobody on the list this month (the keep case has no subject here)', true);
    const drop = await publish([...sheet.filter((s) => s.code !== who.code), ...live.map((a) => btrim(a.tl) === who.name ? { ...a, tl: sheet[0].name } : a)], { asOf: ASOF, apply: true });
    const D = drop.leaders || {};
    ok(who.name + ' off the sheet, leading nobody → the leader login is removed', drop.status === 'SUCCESS' && (D.removed || []).some((r) => r.username === who.code.toLowerCase()), drop.status + ' ' + JSON.stringify(D.removed || drop.detail || drop.reason || '').slice(0, 200));
    ok('…and no agent lost a login over it (' + nAgents + ')', (await one(`select count(*)::int n from app_users where role = 'agent'`)).n === nAgents);
    await restart();
  }

  head('D · A CB ALREADY HELD BY ANOTHER KIND OF ACCOUNT IS REPORTED, NOT DROPPED (migration-048)');
  {
    const agent = live.find((a) => /^CB\d+$/i.test(btrim(a.code)));
    const code = norm(btrim(agent.code));
    const rows = [...sheet, { sheet: 'VAS TL', role: 'leader', code, name: 'Leader Wearing An Agent Code', campaign: 'Courtesy', manager: 'Test', callx: code }, ...live];
    const plan = await publish(rows, { asOf: ASOF });
    const L = plan.leaders || {};
    ok('the sheet leader whose CB is ' + code + ' (an agent login) lands in blocked[] naming the holder', (L.blocked || []).some((b) => norm(b.cb) === code && b.role === 'agent'), plan.status + ' ' + JSON.stringify(L.blocked || L).slice(0, 300));
    ok('…not created, not unrepresented', !(L.would_create || []).some((x) => norm(x.cb) === code) && !(L.unrepresented || []).includes('Leader Wearing An Agent Code'), JSON.stringify({ c: L.would_create, u: L.unrepresented }));
    await restart();
  }

  head('E · TWO SPELLINGS, ONE CB: NOTHING GUESSED, BOTH REPORTED (migration-048)');
  {
    const who = sheet[0];
    const rows = [...sheet.map((s) => s.code === who.code ? { ...s, name: who.name + ' Y' } : s), ...live];   // sheet re-spelt, agents' rows NOT
    const out = await publish(rows, { asOf: ASOF, apply: true });
    const L = out.leaders || {};
    ok('the CB is reported as ambiguous[] with both spellings', (L.ambiguous || []).some((a) => norm(a.cb) === norm(who.code) && (a.names || []).length === 2), out.status + ' ' + JSON.stringify(L.ambiguous || L).slice(0, 300));
    const row = await one(`select team from app_users where role = 'team_leader' and norm_cb(cb) = $1`, [who.code]);
    ok('…the account is left exactly as it was (team still "' + who.name + '"), not renamed, not removed', out.status === 'SUCCESS' && row && row.team === who.name && (L.renamed || []).length === 0 && (L.removed || []).length === 0, JSON.stringify({ row, renamed: L.renamed, removed: L.removed }));
  }
} finally {
  await c.query('rollback').catch(() => {});
  await c.end();
}
console.log('\n' + passes + ' passed, ' + fails + ' failed  (transaction rolled back — nothing was written)');
process.exit(fails ? 1 : 0);
