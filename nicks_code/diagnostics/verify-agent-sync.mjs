#!/usr/bin/env node
/**
 * verify-agent-sync.mjs — the Agent List is the source of truth, proven.
 *
 *   node nicks_code/diagnostics/verify-agent-sync.mjs
 *
 * Covers the eight scenarios in the synchronisation brief plus every guard, and
 * runs them against the REAL sync_agent_list() in the REAL database — because
 * the logic now lives in Postgres and a stub of it would only prove that the
 * stub agrees with itself. The previous suite (verify-auto-provision.mjs) stubbed
 * a JavaScript reconciliation that no longer exists.
 *
 * NOTHING IS EVER COMMITTED. The whole run is one transaction opened with BEGIN
 * and closed with ROLLBACK in a finally block, with a SAVEPOINT per scenario so
 * one failure cannot contaminate the next. That is what makes it safe to do the
 * violent thing each scenario needs — delete every agent account and replace the
 * floor with fixtures — against production data: the transaction never lands.
 * If this process is killed mid-run, Postgres rolls the transaction back for us.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const pg = (await import(pathToFileURL(path.join(HERE, 'node_modules', 'pg', 'lib', 'index.js')).href)).default;
const { hashPassword } = await import(pathToFileURL(path.join(ROOT, 'worker', 'src', 'auth.mjs')).href);

const env = {};
for (const line of fs.readFileSync(path.join(ROOT, 'supabase.env'), 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z_]+)=(.*)$/.exec(line.trim()); if (m) env[m[1]] = m[2];
}

let pass = 0, fail = 0;
const ok = (c, n, extra) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (extra !== undefined ? ' — ' + extra : '')); } };
const head = (t) => console.log('\n' + t);

const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 120000 });
await c.connect();

const q = async (sql, args) => (await c.query(sql, args)).rows;
const one = async (sql, args) => (await q(sql, args))[0];

/* Fixtures. CB numbers start at 900001 so they can never collide with a real
   agent even if something went wrong and this did commit. */
const CB = (i) => 'CB' + (900000 + i);
const listRows = (n, from = 1, tl = 'Test Leader One') =>
  Array.from({ length: n }, (_, k) => ({ code: CB(from + k), name: 'Test Agent ' + (from + k), tl,
    campaign: 'Courtesy', tenure: 'Exp', callx: '', sf: 'Test Agent ' + (from + k), target: 5, start: '2026-01-01' }));

const HASH = await hashPassword('agentos123');
const hashesFor = (rows) => Object.fromEntries(rows.map((r) => [r.code, HASH]));

/** Wipe the agent floor and install `n` fixture accounts. Inside the transaction. */
async function floor(n, from = 1, tl = 'Test Leader One') {
  await c.query(`delete from app_users where role = 'agent'`);
  for (const r of listRows(n, from, tl))
    await c.query(
      `insert into app_users (username, full_name, role, cb, team, apps, tabs, active, password_hash, must_change_password)
       values (lower($1), $2, 'agent', $1, $3, array['agent']::text[], '{}'::jsonb, true, $4, false)`,
      [r.code, r.name, tl, HASH]);
}

/* THE FIXTURE LIST MUST BE THE NEWEST SNAPSHOT. agent_list_current is max(as_of), and
   the integrity view compares accounts against THAT — so a hardcoded fixture date
   silently became "older than the real list" the day a newer real list landed, and
   every scenario failed with "107 agents on the list with no account" (seen 3 Sep).
   One day past the newest real snapshot, computed at run time. Rolled back anyway. */
const ASOF = (await one(`select to_char(coalesce(max(as_of), current_date) + 1, 'YYYY-MM-DD') d from agent_list`)).d;
const sync = async (rows, opts = {}) => (await one(
  `select sync_agent_list($1::date, $2::jsonb, $3, $4, $5, $6::jsonb, $7, $8, $9) as out`,
  [ASOF, JSON.stringify(rows), opts.batch || ('test-' + Math.random().toString(36).slice(2, 9)),
   'test-fp', 'verify-agent-sync', JSON.stringify(opts.hashes ?? hashesFor(rows)),
   opts.apply !== false, opts.min ?? 25, opts.cap ?? 0.25])).out;

const agentCount = async () => +(await one(`select count(*)::int n from app_users where role = 'agent'`)).n;
const nOf = (o, k) => (o && Array.isArray(o[k]) ? o[k].length : -1);

try {
  await c.query('begin');
  console.log('transaction open — every change below is rolled back at the end\n'
    + 'database: ' + env.SUPABASE_DB_URL.replace(/:[^:@]*@/, ':****@'));

  const scenario = async (title, fn) => {
    head(title);
    await c.query('savepoint s');
    try { await fn(); }
    catch (e) { fail++; console.log('  FAIL threw — ' + (e.message || e).split('\n')[0]); }
    await c.query('rollback to savepoint s');
  };

  // ---------------------------------------------------------------- TEST 1
  await scenario('TEST 1 · a new agent is created automatically', async () => {
    await floor(30);
    const rows = listRows(32);
    const r = await sync(rows);
    ok(r.status === 'SUCCESS', 'the synchronisation succeeds', JSON.stringify(r).slice(0, 160));
    ok(nOf(r, 'created') === 2, 'two names new on the list → two accounts created', nOf(r, 'created'));
    ok(nOf(r, 'removed') === 0, 'nobody else is disturbed');
    const u = await one(`select * from app_users where cb = $1`, [CB(31)]);
    ok(!!u, 'the account exists');
    ok(u && u.username === CB(31).toLowerCase(), 'username IS the CB number, lower case', u && u.username);
    ok(u && u.role === 'agent' && u.active, 'created as an active agent');
    ok(u && /^pbkdf2h\$100000\$/.test(u.password_hash), 'the password is stored hashed, never in clear');
    ok(u && u.must_change_password === false, 'they can sign in with the handout password as asked');
    ok(u && u.apps.join() === 'agent' && JSON.stringify(u.tabs) === '{}', 'granted NO management app — the portal only');
    ok(u && u.team === 'Test Leader One', 'the team leader relationship is set from the list', u && u.team);
    const v = await one(`select * from active_agents where cb = $1`, [CB(31)]);
    ok(v && v.has_account, 'they appear in active_agents WITH an account — the Agent View exists');
  });

  // ---------------------------------------------------------------- TEST 2
  await scenario('TEST 2 · an agent off the list loses their access', async () => {
    await floor(30);
    const gone = await one(`select id from app_users where cb = $1`, [CB(30)]);
    await c.query(`insert into app_sessions (token_hash, user_id, expires_at) values ($1, $2, now() + interval '1 day')`,
      ['test-token-hash-' + Date.now(), gone.id]);
    const before = +(await one(`select count(*)::int n from app_sessions where user_id = $1`, [gone.id])).n;
    ok(before === 1, 'the leaver has a live session before the sync');

    const r = await sync(listRows(28));
    ok(r.status === 'SUCCESS' && nOf(r, 'removed') === 2, 'two names gone from the list → two accounts removed', JSON.stringify(r.removed));
    ok(await agentCount() === 28, 'the floor is 28 accounts');
    ok(!(await one(`select id from app_users where cb = $1`, [CB(30)])), 'the row is really gone, not just flagged');
    const sess = +(await one(`select count(*)::int n from app_sessions where user_id = $1`, [gone.id])).n;
    ok(sess === 0, 'their live session died with the account — they cannot keep using the app');
    ok(!(await one(`select cb from active_agents where cb = $1`, [CB(30)])), 'they no longer appear as an active agent');
    const log = await one(`select * from agent_sync_logs order by id desc limit 1`);
    ok(log && log.status === 'SUCCESS' && log.removed.length === 2, 'the sync log records who left and when');
    ok(log && log.removed.some((x) => x.cb === CB(30)), 'by CB number and name', JSON.stringify(log && log.removed));
  });

  await scenario('TEST 2b · history survives the account (rule 5)', async () => {
    await floor(30);
    const u = await one(`select id, username from app_users where cb = $1`, [CB(30)]);
    await c.query(`insert into auth_log (user_id, username, event) values ($1, $2, 'login')`, [u.id, u.username]);
    await sync(listRows(29));
    const kept = +(await one(`select count(*)::int n from auth_log where user_id = $1`, [u.id])).n;
    ok(kept === 1, 'their sign-in history is still readable — auth_log has no foreign key');
    const named = await one(`select agent_name from agent_list where employee_code = $1 and as_of = '${ASOF}'`, [CB(30)]);
    ok(!named, 'and they are correctly absent from the current dated snapshot');
    await c.query(`delete from auth_log where user_id = $1`, [u.id]);
  });

  // ---------------------------------------------------------------- TEST 3
  await scenario('TEST 3 · an agent moves to another team leader', async () => {
    await floor(30, 1, 'Team Leader One');
    const rows = listRows(30, 1, 'Team Leader One');
    rows[4].tl = 'Team Leader Two';                       // one mover
    const r = await sync(rows);
    ok(r.status === 'SUCCESS', 'the synchronisation succeeds');
    /* ONE update, not thirty: the other 29 already match the list, and an update
       that rewrites rows which have not changed is how a sync stops being able to
       tell you what actually moved. */
    ok(nOf(r, 'updated') === 1, 'exactly ONE agent is updated — the mover, and nobody else', nOf(r, 'updated'));
    const moved = await one(`select team from app_users where cb = $1`, [CB(5)]);
    ok(moved.team === 'Team Leader Two', 'the mover now belongs to the new leader', moved.team);
    const stayed = await one(`select team from app_users where cb = $1`, [CB(6)]);
    ok(stayed.team === 'Team Leader One', 'everybody else is untouched');
    const dup = await one(`select count(*)::int n from app_users where cb = $1`, [CB(5)]);
    ok(+dup.n === 1, 'ONE relationship, not two — the old one is replaced, never duplicated');
    const r2 = await sync(rows);
    ok(nOf(r2, 'updated') === 0, 're-running the same list moves nobody again');
  });

  // ---------------------------------------------------------------- TEST 4
  await scenario('TEST 4 · team leaders on the list', async () => {
    await floor(30, 1, 'Nobody Has This Login');
    const r = await sync(listRows(30, 1, 'Nobody Has This Login'));
    ok((r.leaders.unrepresented || []).includes('Nobody Has This Login'),
      'a leader on the list with no account is REPORTED, never invented',
      JSON.stringify(r.leaders.unrepresented));
    ok(nOf(r.leaders, 'unrepresented') >= 1, 'so a human can create their login with a real CB number');
    /* the repair: a leader whose team string drifted from their own name */
    await c.query(`insert into app_users (username, full_name, role, cb, team, apps, tabs, active, password_hash)
                   values ('tl-test-x', 'Drifted Leader', 'team_leader', 'CB900999', 'Old Team Name',
                           array['agent']::text[], '{}'::jsonb, true, $1)`, [HASH]);
    const r2 = await sync(listRows(30, 1, 'Drifted Leader'));
    const tl = await one(`select team from app_users where username = 'tl-test-x'`);
    ok(tl.team === 'Drifted Leader', 'a leader whose team string drifted is relinked to their own name', tl.team);
    ok((r2.leaders.repaired || []).some((x) => x.username === 'tl-test-x'), 'and the repair is reported');
    ok(!!(await one(`select 1 from app_users where username = 'tl-test-x'`)),
      'a team leader is NEVER deleted for being absent from a list that has no leader rows');
  });

  // ---------------------------------------------------------------- TEST 5
  await scenario('TEST 5 · the same list ten times (idempotency)', async () => {
    await floor(30);
    const rows = listRows(33);
    const first = await sync(rows);
    ok(first.status === 'SUCCESS' && nOf(first, 'created') === 3, 'the first run creates three');
    const n1 = await agentCount();
    for (let i = 0; i < 9; i++) await sync(rows);
    const n2 = await agentCount();
    ok(n1 === n2 && n2 === 33, 'nine more runs leave exactly 33 accounts — no copies', n1 + ' → ' + n2);
    const dup = await one(`select count(*)::int n from (select cb from app_users where role='agent' group by cb having count(*) > 1) d`);
    ok(+dup.n === 0, 'no duplicate CB number exists');
    const snap = await one(`select count(*)::int n from agent_list where as_of = '${ASOF}'`);
    ok(+snap.n === 33, 'and one dated snapshot row per agent, not ten', snap.n);
  });

  await scenario('TEST 5b · the database itself refuses a second account for one CB', async () => {
    await floor(30);
    let threw = null;
    try {
      await c.query('savepoint dup');
      await c.query(`insert into app_users (username, full_name, role, cb, apps, tabs, active, password_hash)
                     values ('someone-else', 'Impostor', 'agent', $1, array['agent']::text[], '{}'::jsonb, true, $2)`,
        ['cb 900001', HASH]);   // same CB, different punctuation
    } catch (e) { threw = e.message; }
    await c.query('rollback to savepoint dup');
    ok(!!threw, 'a second account for CB900001 written as "cb 900001" is rejected by the unique index', threw);
    ok(threw && /app_users_norm_cb_uniq/.test(threw), '...by app_users_norm_cb_uniq specifically');
  });

  // ---------------------------------------------------------------- TEST 6
  await scenario('TEST 6 · a duplicate CB number inside the list', async () => {
    await floor(30);
    const rows = listRows(30);
    rows.push({ ...rows[0], name: 'Somebody Else Entirely' });     // same CB twice
    const before = await agentCount();
    const r = await sync(rows);
    ok(r.status === 'FAILED', 'the synchronisation FAILS rather than letting the last row win', r.status);
    ok(JSON.stringify(r.errors).includes('duplicate CB numbers'), 'and says so', JSON.stringify(r.errors).slice(0, 160));
    ok(await agentCount() === before, 'not one account changed — no partial application');
    const nm = await one(`select full_name from app_users where cb = $1`, [CB(1)]);
    ok(nm.full_name === 'Test Agent 1', 'the contested agent keeps the name they had');
    const log = await one(`select * from agent_sync_logs order by id desc limit 1`);
    ok(log && log.status === 'FAILED', 'the failure is logged, never silent');
  });

  // ---------------------------------------------------------------- TEST 7
  await scenario('TEST 7 · invalid data leaves the previous list in force', async () => {
    await floor(30);
    const before = await agentCount();
    for (const [label, rows] of [
      ['a row with no CB number at all', [...listRows(29), { code: '', name: 'No Code', tl: 'Test Leader One' }]],
      ['a row with a CB but no name', [...listRows(29), { code: 'CB900500', name: '', tl: 'Test Leader One' }]],
    ]) {
      const r = await sync(rows);
      ok(r.status === 'FAILED', label + ' → FAILED', JSON.stringify(r).slice(0, 140));
      ok(await agentCount() === before, '...and the floor is untouched');
    }
    /* ITS OWN rows: the function deliberately keeps the last five real batches for
       inspection, so the table is never empty in production — count the test batches. */
    const staged = await one(`select count(*)::int n from agent_list_import where batch_id like 'test-%'`);
    ok(+staged.n === 0, 'a failed sync clears its own staging rows', staged.n);
  });

  // ---------------------------------------------------------------- TEST 8
  await scenario('TEST 8 · a large list completes in one transaction', async () => {
    await floor(400);
    const t0 = Date.now();
    const r = await sync(listRows(500));
    const ms = Date.now() - t0;
    ok(r.status === 'SUCCESS' && nOf(r, 'created') === 100, '500 rows against 400 accounts → 100 created', JSON.stringify(r).slice(0, 120));
    ok(await agentCount() === 500, 'all 500 exist');
    ok(ms < 30000, 'and it finished in ' + (ms / 1000).toFixed(1) + 's, well inside any timeout');
    const orphan = await one(`select count(*)::int n from active_agents where not has_account`);
    ok(+orphan.n === 0, 'no agent on the list is left without an account');
  });

  // ---------------------------------------------------------------- guards
  await scenario('GUARDS · a bad list must change NOTHING', async () => {
    await floor(30);
    const before = await agentCount();

    let r = await sync([]);
    ok(r.status === 'REFUSED' && r.reason === 'roster too small', 'an EMPTY list is refused outright', JSON.stringify(r).slice(0, 120));
    ok(await agentCount() === before, '...and nothing changed');

    r = await sync(listRows(10));
    ok(r.status === 'REFUSED' && r.reason === 'roster too small', 'a list of 10 is refused — a broken pull, not a walkout');
    ok(await agentCount() === before, '...and nothing changed');

    r = await sync(listRows(26, 500));            // shares nothing with the floor
    ok(r.status === 'REFUSED' && r.reason === 'too many deletions', 'a list that would clear the floor is refused', JSON.stringify(r).slice(0, 140));
    ok(await agentCount() === before, '...refused WHOLE — not applied halfway');
    ok(r.cap === '25%' && r.would_delete > 0, '...and it says how many, against what cap', r.would_delete + ' of ' + r.of);
  });

  await scenario('GUARDS · only agents are ever deleted', async () => {
    await floor(30);
    await c.query(`insert into app_users (username, full_name, role, cb, apps, tabs, active, password_hash) values
      ('tl-guard',  'Guard Leader',  'team_leader',     'CB900901', array['agent']::text[], '{}'::jsonb, true, $1),
      ('cm-guard',  'Guard Manager', 'campaign_manager','CB900902', array['agent']::text[], '{}'::jsonb, true, $1),
      ('adm-guard', 'Guard Admin',   'admin',           'CB900903', array['ops']::text[],   '{}'::jsonb, true, $1),
      ('qa-guard',  'Guard QA',      'qa',              'CB900904', array['ops']::text[],   '{}'::jsonb, true, $1)`, [HASH]);
    const r = await sync(listRows(30));
    ok(r.status === 'SUCCESS' && nOf(r, 'removed') === 0, 'the sync succeeds and removes nobody');
    const kept = +(await one(`select count(*)::int n from app_users where username like '%-guard'`)).n;
    ok(kept === 4, 'the leader, manager, admin and QA accounts all survive — they are not roster rows', kept);
  });

  await scenario('GUARDS · an agent with no CB is never deleted on a technicality', async () => {
    await floor(30);
    await c.query(`insert into app_users (username, full_name, role, cb, apps, tabs, active, password_hash)
                   values ('ghost-agent', 'No Code At All', 'agent', null, array['agent']::text[], '{}'::jsonb, true, $1)`, [HASH]);
    const r = await sync(listRows(30));
    ok(r.status === 'SUCCESS' && nOf(r, 'removed') === 0, 'unmatchable is not the same as absent');
    ok(!!(await one(`select 1 from app_users where username = 'ghost-agent'`)), 'the account is left alone');
    const chk = await one(`select failures from agent_sync_integrity where check_name = 'agent account with no CB number at all'`);
    ok(+chk.failures === 1, '...but the integrity view names it so it can be fixed', chk.failures);
  });

  await scenario('GUARDS · a username held by a manager is never taken over', async () => {
    await floor(30);
    await c.query(`insert into app_users (username, full_name, role, cb, apps, tabs, active, password_hash)
                   values ($1, 'Someone Important', 'exec', null, array['ops']::text[], '{}'::jsonb, true, $2)`,
      [CB(31).toLowerCase(), HASH]);
    const before = await agentCount();
    const r = await sync(listRows(31));
    ok(r.status === 'FAILED', 'the sync refuses rather than overwrite them', r.status);
    ok(JSON.stringify(r.errors).includes('already held by a non-agent'), 'and names the clash', JSON.stringify(r.errors).slice(0, 200));
    ok(await agentCount() === before, 'nothing was written');
    const ex = await one(`select role, full_name from app_users where username = $1`, [CB(31).toLowerCase()]);
    ok(ex.role === 'exec' && ex.full_name === 'Someone Important', 'their account is exactly as it was');
  });

  await scenario('GUARDS · a plan and a hash-less apply write nothing', async () => {
    await floor(30);
    const before = await agentCount();
    const plan = await sync(listRows(32), { apply: false });
    ok(plan.status === 'PLAN', 'a dry run returns a PLAN', plan.status);
    ok(nOf(plan, 'create') === 2 && nOf(plan, 'remove') === 0, 'it says what WOULD happen', nOf(plan, 'create'));
    ok(await agentCount() === before, '...having created nobody');
    ok(+(await one(`select count(*)::int n from agent_list_import where batch_id like 'test-%'`)).n === 0, '...and having cleared its own staging rows');

    const nh = await sync(listRows(32), { hashes: {} });
    ok(nh.status === 'NEEDS_HASHES', 'applying without a password hash returns NEEDS_HASHES', nh.status);
    ok((nh.needs_hashes || []).length === 2, '...naming exactly the CB numbers it needs', JSON.stringify(nh.needs_hashes));
    ok(await agentCount() === before, '...and writes nothing at all');
  });

  await scenario('CB NORMALISATION · one agent, however it is written', async () => {
    await floor(30);
    const rows = listRows(30);
    rows[0].code = 'cb 900001';                   // same person, punctuated differently
    rows[1].code = 'CB-900002';
    const r = await sync(rows);
    ok(r.status === 'SUCCESS', 'the list still synchronises', JSON.stringify(r).slice(0, 120));
    ok(nOf(r, 'created') === 0 && nOf(r, 'removed') === 0, 'no second account, no deletion — they matched',
      nOf(r, 'created') + '/' + nOf(r, 'removed'));
    ok(await agentCount() === 30, 'still 30 accounts');
    const n = await one(`select norm_cb('cb 900001') a, norm_cb('CB-900001') b, norm_cb('CB900001') c, norm_cb('') d`);
    ok(n.a === n.b && n.b === n.c && n.c === 'CB900001', 'norm_cb agrees with the apps: CB-15 = cb 15 = CB15', JSON.stringify(n));
    ok(n.d === null, 'and a value with no digits normalises to nothing rather than to "CB"');
  });
} finally {
  await c.query('rollback');
  console.log('\n(transaction rolled back — the database is exactly as it was)');
  const live = +(await one(`select count(*)::int n from app_users where role = 'agent'`)).n;
  console.log('live agent accounts: ' + live);
  await c.end();
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
