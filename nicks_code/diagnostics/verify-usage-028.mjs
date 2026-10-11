#!/usr/bin/env node
/* verify-usage-028.mjs — A USAGE REPORT YOU CAN QUERY IN SUPABASE (Spec Kit 028, 2026-10-11).
 *
 * Nick: "I need you to create me a table in supabase so we can see how many times users ask for request, how many times
 * users login in to the software, basically we want to query supabase and make a usage report, see what users ask their
 * team leader most of the time etc".
 *
 *   A · migration-061 runs VERBATIM in PGlite: the table, the auth_log trigger (exact parity, never fails a sign-in),
 *       the views answer the headline questions on fixtures (SAST days), anon/authenticated reach nothing (SC-004)
 *   B · worker/src/usage.mjs: the app from the page, the row it writes, fire-and-forget with ONE subrequest, 60 s de-dup
 *   C · the REAL Worker in-process (stub PostgREST forwarding usage rows into PGlite + fake HighLevel): every event type
 *       with the right fields; a failing / throwing / hanging usage write never changes the answer; ≤ 1 usage subrequest
 *   D · the pages send the page path (Referrer-Policy hides it from the Worker) and no new CORS header
 *   E · tools/usage-backfill.mjs: dry run writes nothing, apply inserts the dry counts, a second run inserts 0, auth_log
 *       parity, and the keys it computes equal the keys the live Worker wrote (so release + backfill never double-count)
 *   F · registered in verify.yml; PGlite is a diagnostics devDependency
 *
 *   node nicks_code/diagnostics/verify-usage-028.mjs      (no network, no credentials)
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { ROOT, newDb, restFetch, readSql, MIGRATION, applyMigration } from './usage-028-harness.mjs';

const R = (rel) => path.join(ROOT, ...rel.split('/'));
const read = (rel) => (fs.existsSync(R(rel)) ? fs.readFileSync(R(rel), 'utf8').replace(/\r\n/g, '\n') : '');
const imp = async (rel) => import(pathToFileURL(R(rel)).href).catch((e) => ({ __error: String(e && e.message || e) }));
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m + (d !== undefined ? ' — ' + (typeof d === 'string' ? d : JSON.stringify(d)) : '')); } };
const head = (t) => console.log('\n' + t);
const q = async (db, sql, args) => (await db.query(sql, args || [])).rows;
const denied = async (db, role, sql) => { try { await db.exec(`set role ${role}`); await db.query(sql); return false; } catch (e) { return /permission denied/.test(String(e.message)); } finally { await db.exec('reset role'); } };

const U = { nick: '00000000-0000-4000-8000-000000000001', cb162: '00000000-0000-4000-8000-000000000162', cb267: '00000000-0000-4000-8000-000000000267',
  cb207: '00000000-0000-4000-8000-000000000207', dalwin: '00000000-0000-4000-8000-000000000145' };
const seedUsers = async (db) => {
  for (const [u, role, cb, name, team] of [['nick', 'admin', null, 'Nick', null], ['cb162', 'agent', 'CB162', 'Nothando Mntungwa', null],
    ['cb267', 'team_leader', 'CB267', 'Denise Haripersad', 'Denise Haripersad'], ['cb207', 'team_leader', 'CB207', 'Renolan Pillay', 'Renolan Pillay'],
    ['dalwin', 'campaign_manager', 'CB145', 'Dalwin Callaghan', null]])
    await db.query('insert into app_users (id, username, full_name, password_hash, role, cb, team) values ($1,$2,$3,$4,$5,$6,$7)', [U[u], u, name, 'x', role, cb, team]);
};

/* ═══════════════════════ A · THE MIGRATION, FOR REAL ═══════════════════════ */
head('A · migration-061 in PGlite — table, trigger, views, lockdown');
const sqlText = readSql(MIGRATION);
ok(!!sqlText, 'supabase/' + MIGRATION + ' exists');
let A = null;
if (sqlText) {
  const LEGACY = ['login_ok', 'login_fail:bad_password', 'login_fail:no_user', 'login_fail:disabled', 'locked', 'logout', 'password_change',
    'password_reset', 'pw_change:bulk_reset_by_admin_2026-08-18', 'login_ok:wimpy', 'login_fail:wimpy:bad_password', 'wimpy_signin_ok',
    'wimpy_signin_fail', 'wimpy_signin_refused:no_app', 'wimpy_password_change', 'created:bootstrap', 'unlock:admin', 'username_changed:a->b'];
  try {
    A = await newDb({ before: async (db) => { await seedUsers(db);
      for (const ev of LEGACY) await db.query("insert into auth_log (user_id, username, event, ip, at) values ($1, 'cb162', $2, '', '2026-09-30T10:00:00Z')", [U.cb162, ev]); } });
    ok(true, 'the migration applies on top of the tables it builds on');
  } catch (e) { ok(false, 'the migration applies', String(e.message)); }
  if (A) {
    try { await applyMigration(A, MIGRATION); ok(true, 'and applies a SECOND time (re-runnable)'); } catch (e) { ok(false, 're-runnable', String(e.message)); }
    const cols = (await q(A, "select column_name, is_nullable from information_schema.columns where table_name = 'usage_events'")).map((r) => r.column_name);
    for (const c of ['id', 'at', 'user_id', 'username', 'role', 'app', 'event', 'category', 'team_leader', 'campaign', 'detail', 'source', 'source_key'])
      ok(cols.includes(c), 'usage_events has ' + c);
    ok((await q(A, "select count(*)::int n from usage_events")).at(0).n === 0, 'creating the table copies nothing by itself (the backfill is a separate, dry-run-first step)');
    // the trigger mirrors new auth_log rows
    await A.query("insert into auth_log (user_id, username, event, ip) values ($1, 'nick', 'login_ok', '1.2.3.4'), ($1, 'nick', 'login_fail:bad_password', '1.2.3.4'), ($1, 'nick', 'logout', '')", [U.nick]);
    const live = await q(A, "select event, category, app, role, username, user_id::text, detail, source, source_key from usage_events order by id");
    ok(live.length === 3, 'every new auth_log row lands in usage_events (3 → 3)', live.length);
    ok(live[0] && live[0].event === 'login_ok' && live[0].app === 'worker' && live[0].role === 'admin' && live[0].user_id === U.nick && live[0].source === 'auth_log' && /^auth_log:\d+$/.test(live[0].source_key),
      'login_ok → event login_ok, app worker, role looked up, source auth_log, key auth_log:<id>', live[0]);
    ok(live[1] && live[1].event === 'login_fail' && live[1].category === 'bad_password' && live[1].detail.auth_event === 'login_fail:bad_password', 'login_fail:bad_password → login_fail / bad_password (the raw event kept in detail)', live[1]);
    ok(!JSON.stringify(live).includes('1.2.3.4'), 'the IP address is not copied (auth_log keeps it)');
    await A.query("insert into auth_log (user_id, username, event) values ($1, 'nick', $2)", [U.nick, 'login_fail:' + 'x'.repeat(300)]);
    const longCat = (await q(A, "select category from usage_events where detail->>'auth_event' like 'login_fail:xxx%'")).at(0);
    ok(longCat && longCat.category.length === 120, 'a 300-character failure reason is clamped to 120, not dropped by the check constraint (review M2)', longCat && longCat.category.length);
    await A.exec("delete from usage_events where detail->>'auth_event' like 'login_fail:xxx%'"); await A.exec("delete from auth_log where event like 'login_fail:xxx%'");
    // a broken usage table never fails a sign-in
    await A.exec('alter table usage_events rename to usage_events_hidden');
    let signinOk = true; try { await A.query("insert into auth_log (user_id, username, event) values ($1, 'nick', 'login_ok')", [U.nick]); } catch (e) { signinOk = false; }
    await A.exec('alter table usage_events_hidden rename to usage_events');
    ok(signinOk, 'with usage_events unusable, the auth_log insert (the sign-in and its lockout count) still succeeds');
    // backfill RPC: exact parity, idempotent
    const maxId = (await q(A, 'select max(id)::int m from auth_log')).at(0).m;
    const n1 = (await q(A, 'select usage_mirror_auth_log(0, $1) as n', [maxId])).at(0).n;
    ok(n1 === LEGACY.length + 1, 'usage_mirror_auth_log backfills exactly the rows not yet mirrored (' + (LEGACY.length + 1) + ')', n1);
    const n2 = (await q(A, 'select usage_mirror_auth_log(0, $1) as n', [maxId])).at(0).n;
    ok(n2 === 0, 'a second run adds 0 (SC-003)', n2);
    const al = await q(A, 'select event, count(*)::int n from auth_log group by event order by event');
    const ue = await q(A, "select detail->>'auth_event' as event, count(*)::int n from usage_events where source = 'auth_log' group by 1 order by 1");
    ok(JSON.stringify(al) === JSON.stringify(ue), 'auth_log parity: per-event counts identical (' + al.length + ' kinds)', { al, ue });
    const map = Object.fromEntries((await q(A, "select detail->>'auth_event' a, event, category, app from usage_events where source = 'auth_log'")).map((r) => [r.a, r]));
    const expect = { locked: ['login_fail', 'locked', 'worker'], 'login_ok:wimpy': ['login_ok', null, 'wimpy'], wimpy_signin_ok: ['login_ok', null, 'wimpy'],
      'login_fail:wimpy:bad_password': ['login_fail', 'bad_password', 'wimpy'], wimpy_signin_fail: ['login_fail', 'failed', 'wimpy'], 'wimpy_signin_refused:no_app': ['login_fail', 'no_app', 'wimpy'],
      'login_fail:disabled': ['login_fail', 'disabled', 'worker'], password_reset: ['password_change', 'reset', 'worker'], 'pw_change:bulk_reset_by_admin_2026-08-18': ['password_change', 'reset', 'worker'],
      password_change: ['password_change', 'change', 'worker'], wimpy_password_change: ['password_change', 'change', 'wimpy'], 'created:bootstrap': ['account_admin', 'created', 'worker'],
      'unlock:admin': ['account_admin', 'unlock', 'worker'], logout: ['logout', null, 'worker'] };
    for (const [a, [ev, cat, app]] of Object.entries(expect)) { const r = map[a] || {};
      ok(r.event === ev && (r.category ?? null) === cat && r.app === app, `auth event ${a} → ${ev} / ${cat} / ${app}`, r); }

    // views on fixtures
    const ins = async (rows) => { for (const r of rows) await A.query(
      'insert into usage_events (at, user_id, username, role, app, event, category, team_leader, campaign, detail, source, source_key) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
      [r.at, r.user_id || null, r.username || null, r.role || null, r.app || null, r.event, r.category || null, r.team_leader || null, r.campaign || null, r.detail ? JSON.stringify(r.detail) : null, r.source || 'worker', r.source_key || null]); };
    await A.exec("delete from usage_events");
    const agent = { user_id: U.cb162, username: 'cb162', role: 'agent' };
    await ins([
      // sign-ins: 22:30Z on 10 Oct is 00:30 on 11 Oct in Johannesburg
      { at: '2026-10-10T22:30:00Z', ...agent, app: 'worker', event: 'login_ok', source: 'auth_log', source_key: 'auth_log:901' },
      { at: '2026-10-11T07:00:00Z', ...agent, app: 'worker', event: 'login_ok', source: 'auth_log', source_key: 'auth_log:902' },
      { at: '2026-10-11T06:59:00Z', ...agent, app: 'worker', event: 'login_fail', category: 'bad_password', source: 'auth_log', source_key: 'auth_log:903' },
      { at: '2026-10-12T07:00:00Z', ...agent, app: 'worker', event: 'login_ok', source: 'auth_log', source_key: 'auth_log:904' },
      { at: '2026-09-30T07:00:00Z', ...agent, app: 'worker', event: 'login_ok', source: 'auth_log', source_key: 'auth_log:905' },
      { at: '2026-10-11T07:00:01Z', ...agent, app: 'agent', event: 'app_open', detail: { via: 'login' } },
      { at: '2026-10-11T09:00:00Z', ...agent, app: 'agent', event: 'app_open', detail: { via: 'boot' } },
      // help asks: two on one card (merged), one failed
      { at: '2026-10-11T08:00:00Z', ...agent, app: 'agent', event: 'help_ask', category: 'Explain the product', team_leader: 'Denise Haripersad', campaign: 'Courtesy', detail: { note: 'first', delivered: true, opp_id: 'H1', cb: 'CB162', agent_name: 'Nothando Mntungwa' } },
      { at: '2026-10-11T08:30:00Z', user_id: U.cb267, username: 'cb267', role: 'team_leader', app: 'agent', event: 'help_stage', category: 'In progress', team_leader: 'Denise Haripersad', detail: { opp_id: 'H1', closed: false, by: 'team_leader' } },
      { at: '2026-10-11T10:00:00Z', user_id: U.cb267, username: 'cb267', role: 'team_leader', app: 'agent', event: 'help_stage', category: 'Closed', team_leader: 'Denise Haripersad', detail: { opp_id: 'H1', closed: true, by: 'team_leader' } },
      { at: '2026-10-11T11:00:00Z', ...agent, app: 'agent', event: 'help_ask', category: 'Explain the product', team_leader: 'Denise Haripersad', campaign: 'Courtesy', detail: { note: 'second, latest', delivered: true, opp_id: 'H1', cb: 'CB162' } },
      { at: '2026-10-11T12:00:00Z', ...agent, app: 'agent', event: 'help_ask', category: 'Review my call', team_leader: 'Denise Haripersad', campaign: 'Courtesy', detail: { note: 'HL was down', delivered: false, error: 'HighLevel unreachable' } },
      // campaign manager
      { at: '2026-10-11T08:00:00Z', user_id: U.cb207, username: 'cb207', role: 'team_leader', app: 'agent', event: 'cm_request', category: 'dialler', team_leader: 'Renolan Pillay', campaign: 'Cuddle', detail: { opp_id: 'C1', priority: 'P1', restricted: false } },
      { at: '2026-10-11T08:05:00Z', user_id: U.dalwin, username: 'dalwin', role: 'campaign_manager', app: 'agent', event: 'cm_action', category: 'acknowledge', team_leader: 'Renolan Pillay', campaign: 'Cuddle', detail: { opp_id: 'C1', started: false, resolved: false } },
      { at: '2026-10-11T08:20:00Z', user_id: U.dalwin, username: 'dalwin', role: 'campaign_manager', app: 'agent', event: 'cm_action', category: 'start', team_leader: 'Renolan Pillay', campaign: 'Cuddle', detail: { opp_id: 'C1', started: true, resolved: false } },
      { at: '2026-10-11T08:40:00Z', user_id: U.cb207, username: 'cb207', role: 'team_leader', app: 'agent', event: 'cm_request', category: 'dialler', team_leader: 'Renolan Pillay', campaign: 'Cuddle', detail: { opp_id: 'C1', merged: true } },
      // failed CM requests (Nick, 2026-10-11: "Yes, record them as not delivered") — one refused against the open card C1, one that never reached HighLevel
      { at: '2026-10-11T08:10:00Z', user_id: U.cb207, username: 'cb207', role: 'team_leader', app: 'agent', event: 'cm_request', category: 'leads', team_leader: 'Renolan Pillay', campaign: 'Cuddle', detail: { opp_id: 'C1', priority: 'P2', delivered: false, error: 'Your team already has an open request' } },
      { at: '2026-10-11T09:30:00Z', user_id: U.cb267, username: 'cb267', role: 'team_leader', app: 'agent', event: 'cm_request', category: 'leads', team_leader: 'Denise Haripersad', campaign: 'Courtesy', detail: { priority: 'P3', delivered: false, error: 'HighLevel /opportunities/ → 500' } },
      // AI
      { at: '2026-10-11T09:00:00Z', ...agent, app: 'agent', event: 'ai_question', detail: { question: 'how do I lift my GWP?', model: 'm' }, source_key: 'ask_log:1' },
      { at: '2026-10-11T09:05:00Z', user_id: U.nick, username: 'nick', role: 'admin', app: 'vas', event: 'ai_question', detail: { question: 'top agent?', model: 'm' }, source_key: 'ask_log:2' },
    ]);
    const lu = await q(A, "select day::text, sign_ins, failed_sign_ins from logins_by_user where username = 'cb162' order by day");
    ok(JSON.stringify(lu) === JSON.stringify([{ day: '2026-09-30', sign_ins: 1, failed_sign_ins: 0 }, { day: '2026-10-11', sign_ins: 2, failed_sign_ins: 1 }, { day: '2026-10-12', sign_ins: 1, failed_sign_ins: 0 }]),
      'logins_by_user: one row per person × SAST day (22:30Z on the 10th counts on the 11th)', lu);
    const lm = await q(A, "select month::text, sign_ins, failed_sign_ins, days_active from logins_by_user_month where username = 'cb162' order by month");
    ok(lm.length === 2 && lm[1].month === '2026-10-01' && lm[1].sign_ins === 3 && lm[1].days_active === 2 && lm[1].failed_sign_ins === 1 && lm[0].sign_ins === 1,
      'logins_by_user_month: "sign-ins per person this month" is one SELECT (Oct: 3 sign-ins on 2 days, 1 failure)', lm);
    const ud = await q(A, "select app, event, events from usage_daily where day = '2026-10-11' and event = 'help_ask'");
    ok(ud.length === 1 && ud[0].events === 3 && ud[0].app === 'agent', 'usage_daily: day × app × event', ud);
    const ao = await q(A, "select app, opens, via_login from app_opens_by_user_app where username = 'cb162' and day = '2026-10-11'");
    ok(ao.length === 1 && ao[0].opens === 2 && ao[0].via_login === 1, 'app_opens_by_user_app: opens and the ones that came with a sign-in', ao);
    const hc = await q(A, "select category, asks, delivered, not_delivered from help_by_category where month = '2026-10-01' order by asks desc");
    ok(hc.length === 2 && hc[0].category === 'Explain the product' && hc[0].asks === 2 && hc[0].delivered === 2 && hc[1].not_delivered === 1,
      'help_by_category: "top help categories this month" is one SELECT; a failed ask is counted, as not delivered', hc);
    const ht = await q(A, "select team_leader, category, asks from help_by_team_leader where day = '2026-10-11' order by asks desc, category");
    ok(ht.length === 2 && ht[0].team_leader === 'Denise Haripersad' && ht[0].asks === 2, 'help_by_team_leader: what agents ask their team leader', ht);
    const hcp = await q(A, "select campaign, asks from help_by_campaign where day = '2026-10-11' and category = 'Review my call'");
    ok(hcp.length === 1 && hcp[0].campaign === 'Courtesy', 'help_by_campaign', hcp);
    const hag = await q(A, "select username, asks, agent_name from help_by_agent where day = '2026-10-11' and category = 'Explain the product'");
    ok(hag.length === 1 && hag[0].asks === 2 && hag[0].username === 'cb162', 'help_by_agent', hag);
    const hn = await q(A, 'select note, delivered, last_stage, team_leader, campaign, category from help_notes order by at desc');
    ok(hn.length === 3 && hn[0].note === 'HL was down' && hn[0].delivered === false && hn[1].note === 'second, latest' && hn[1].last_stage === null && hn[2].note === 'first' && hn[2].last_stage === 'Closed',
      'help_notes: newest first, the note readable, each ask shows only ITS OWN round\'s stage', hn);
    const hat = await q(A, "select minutes_to_first_response, minutes_to_close, answered from help_answer_times order by at");
    ok(hat.length === 2 && Number(hat[0].minutes_to_first_response) === 30 && Number(hat[0].minutes_to_close) === 120 && hat[0].answered === true && hat[1].answered === false,
      'help_answer_times: ask → first team-leader move (30 min) and → closed (120 min); the later ask is unanswered', hat);
    const cr = await q(A, 'select blockage, team_leader, status, actions, duplicates_merged, priority from cm_requests where delivered');
    ok(cr.length === 1 && cr[0].blockage === 'dialler' && cr[0].status === 'Assisting' && cr[0].actions === 2 && cr[0].duplicates_merged === 1 && cr[0].priority === 'P1',
      'cm_requests: one row per request, by blockage / TL / status (a merged duplicate is not a second request; a refused attempt on the same card does not cut its round)', cr);
    const cnd = await q(A, 'select blockage, team_leader, status, delivered, error from cm_requests where not delivered order by requested_at');
    ok(cnd.length === 2 && cnd.every((x) => x.status === 'Not delivered' && x.delivered === false && x.blockage === 'leads') && /open request/.test(cnd[0].error) && cnd[1].team_leader === 'Denise Haripersad',
      'cm_requests: a request that failed to send is a row of its own — status Not delivered, with the reason', cnd);
    const cs = await q(A, "select blockage, requests, delivered, not_delivered from cm_request_summary where day = '2026-10-11' order by blockage");
    ok(cs.length === 2 && cs[0].blockage === 'dialler' && cs[0].requests === 1 && cs[0].delivered === 1 && cs[0].not_delivered === 0
      && cs[1].blockage === 'leads' && cs[1].requests === 2 && cs[1].delivered === 0 && cs[1].not_delivered === 2,
      'cm_request_summary: requests counted delivered / not delivered per day × blockage (merged duplicates excluded)', cs);
    const ai = await q(A, "select username, app, questions from ask_ai_by_user where day = '2026-10-11' order by username");
    ok(ai.length === 2 && ai[0].username === 'cb162' && ai[0].app === 'agent' && ai[1].app === 'vas', 'ask_ai_by_user: per person and per app', ai);
    const aq = await q(A, "select question from ai_questions where username = 'nick'");
    ok(aq.length === 1 && aq[0].question === 'top agent?', 'ai_questions: the question text', aq);
    // constraints
    let badApp = false; try { await A.query("insert into usage_events (event, app) values ('app_open', 'pulse')"); } catch (e) { badApp = true; }
    ok(badApp, "an app outside ('vas','ops','agent','tracker','wimpy','worker') is refused");
    let dupKey = false; try { await A.query("insert into usage_events (event, source_key) values ('x', 'ask_log:1')"); } catch (e) { dupKey = /unique|duplicate/.test(e.message); }
    ok(dupKey, 'source_key is unique (the idempotency key)');
    // SC-004 lockdown
    const VIEWS = ['usage_daily', 'logins_by_user', 'logins_by_user_month', 'app_opens_by_user_app', 'help_by_category', 'help_by_team_leader', 'help_by_campaign',
      'help_by_agent', 'help_notes', 'help_answer_times', 'cm_requests', 'cm_request_summary', 'ask_ai_by_user', 'ai_questions'];
    for (const role of ['anon', 'authenticated']) {
      ok(await denied(A, role, 'select * from usage_events'), role + ' cannot read usage_events');
      ok(await denied(A, role, "insert into usage_events (event) values ('x')"), role + ' cannot write usage_events');
      ok(await denied(A, role, 'select usage_mirror_auth_log(0, 1)'), role + ' cannot run the backfill function');
      let all = true; for (const v of VIEWS) if (!(await denied(A, role, 'select * from ' + v))) { all = false; ok(false, role + ' reads ' + v); }
      ok(all, role + ' reads none of the ' + VIEWS.length + ' views');
    }
    await A.exec('set role service_role');
    let svc = true; try { for (const v of VIEWS) await A.query('select * from ' + v + ' limit 1'); await A.query("insert into usage_events (event) values ('probe')"); } catch (e) { svc = String(e.message); }
    ok(svc === true, 'service_role reads every view and inserts', svc);
    let upd = false; try { await A.query("update usage_events set event = 'x'"); } catch (e) { upd = /permission denied/.test(e.message); }
    let del = false; try { await A.query('delete from usage_events'); } catch (e) { del = /permission denied/.test(e.message); }
    await A.exec('reset role');
    ok(upd && del, 'append-only: service_role may not update or delete');
    ok((await q(A, "select relrowsecurity from pg_class where relname = 'usage_events'")).at(0).relrowsecurity === true, 'RLS is on');
    const fns = await q(A, "select p.proname, p.proconfig, has_function_privilege('anon', p.oid, 'execute') a, has_function_privilege('authenticated', p.oid, 'execute') au from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'usage%'");
    ok(fns.length >= 3, 'the migration defines its functions (' + fns.map((f) => f.proname).join(', ') + ')');
    ok(fns.every((f) => !f.a && !f.au), 'no usage function is executable by anon or authenticated (migration-049 rule)', fns.filter((f) => f.a || f.au).map((f) => f.proname));
    ok(fns.every((f) => (f.proconfig || []).some((c) => /^search_path=public/.test(c))), 'every usage function pins search_path', fns.map((f) => f.proname + ':' + f.proconfig));
    const vopt = await q(A, "select relname, reloptions from pg_class where relkind = 'v' and relname = any($1)", [VIEWS]);
    ok(vopt.length === VIEWS.length && vopt.every((v) => (v.reloptions || []).includes('security_invoker=true')), 'every view is security_invoker', vopt.filter((v) => !(v.reloptions || []).includes('security_invoker=true')).map((v) => v.relname));
  }
}

/* ═══════════════════════ B · worker/src/usage.mjs ═══════════════════════ */
head('B · usage.mjs — the app, the row, fire-and-forget');
const UM = await imp('worker/src/usage.mjs');
ok(!UM.__error, 'worker/src/usage.mjs imports', UM.__error);
if (!UM.__error) {
  const cases = { '/pulse/': 'vas', '/pulse/index.html': 'vas', '/': 'ops', '/index.html': 'ops', '/agent/': 'agent', '/agent': 'agent', '/tracker/': 'tracker',
    '/tracker/vt-mtd-report.html': 'tracker', '/agent-preview/': null, '': null, '/wimpy/': null, 'https://chatterbox-agentos.pages.dev/pulse/': 'vas' };
  for (const [p, want] of Object.entries(cases)) ok(UM.appFromPage(p) === want, `appFromPage(${JSON.stringify(p)}) → ${want}`, UM.appFromPage(p));
  const rq = (h) => new Request('https://api.test/api/me' + (h.q || ''), { headers: h.ref ? { referer: h.ref } : {} });
  const pg = (h) => UM.pageOf(rq(h), new URL('https://api.test/api/me' + (h.q || '')));
  ok(pg({ q: '?page=%2Fpulse%2F', ref: 'https://chatterbox-agentos.pages.dev/tracker/' }) === '/pulse/', 'pageOf: the page param wins');
  ok(pg({ ref: 'https://chatterbox-agentos.pages.dev/tracker/' }) === '/tracker/', 'pageOf: a Referer that carries a path is used');
  ok(pg({ ref: 'https://chatterbox-agentos.pages.dev/' }) === null, 'pageOf: an origin-only Referer (strict-origin-when-cross-origin) is NOT read as Ops');
  const row = UM.usageRow({ event: 'help_ask', user_id: 'u-not-a-uuid', username: 'x'.repeat(300), app: 'pulse', category: 'c', detail: { note: 'n'.repeat(5000) }, at: 'not a date' });
  ok(row && row.user_id === null && row.username.length <= 80 && row.app === null && row.detail.note.length <= 2000 && !('at' in row) && row.source === 'worker',
    'usageRow: a non-uuid id → null, long strings clamped, an unknown app → null, a bad time → the database clock', row && { ...row, detail: '…' });
  ok(UM.usageRow({}) === null && UM.usageRow(null) === null, 'usageRow: no event → no row');
  let waits = 0, inserts = 0;
  const rejecting = { insert: () => { inserts++; return Promise.reject(new Error('boom')); } };
  const out = UM.recordUsage(rejecting, { waitUntil: () => { waits++; } }, { event: 'app_open', app: 'ops' });
  ok(out === undefined && waits === 1 && inserts === 1, 'recordUsage: hands ONE insert to waitUntil and returns nothing to await');
  let threw = false; try { UM.recordUsage({ insert: () => { throw new Error('sync boom'); } }, null, { event: 'x' }); UM.recordUsage(null, null, { event: 'x' }); } catch (e) { threw = true; }
  ok(!threw, 'recordUsage: a synchronous throw or no DB / no ctx is swallowed');
  const settled = await Promise.race([UM.usageInsert(rejecting, { event: 'x' }).then(() => 'resolved', () => 'rejected'), new Promise((r) => setTimeout(() => r('timeout'), 500))]);
  ok(settled === 'resolved', 'usageInsert never rejects', settled);
  let cap = null; await UM.usageInsert({ insert: async (t, rows, mode) => { cap = { t, rows, mode }; } }, { event: 'x', source_key: 'k1' });
  ok(cap && cap.t === 'usage_events?on_conflict=source_key' && cap.mode === 'ignore' && cap.rows.length === 1, 'usageInsert: one row, ON CONFLICT (source_key) DO NOTHING', cap);
  UM.resetUsageSeen();
  const t0 = 1_000_000;
  ok(UM.firstOpen('u1', 'vas', t0) === true && UM.firstOpen('u1', 'vas', t0 + 30_000) === false && UM.firstOpen('u1', 'ops', t0 + 30_000) === true && UM.firstOpen('u1', 'vas', t0 + 61_000) === true,
    'firstOpen: one open per person × app per 60 s');
  const dbm = read('worker/src/db.mjs');
  ok(/resolution=ignore-duplicates/.test(dbm), "db.mjs: insert(…, 'ignore') sends Prefer resolution=ignore-duplicates");
}

/* ═══════════════════════ C · THE REAL WORKER ═══════════════════════ */
head('C · the Worker in-process — every event, never in the way');
const AUTH = await imp('worker/src/auth.mjs');
const worker = await imp('worker/src/index.mjs');
ok(!worker.__error && worker.default, 'worker/src/index.mjs imports', worker.__error);
const LIVE = {};   // what C captures, for E's key-equality checks
if (worker.default && A && UM.resetUsageSeen) {
  const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
  const DIGEST = { updatedAt: '2026-10-11T06:00:00Z', period: { from: '2026-10-01', to: '2026-10-31' }, diallingDays: 8, workingDays: 22, dates: [], weeks: [],
    agents: [
      { code: 'CB162', name: 'Nothando Mntungwa', tl: 'Denise Haripersad', campaign: 'Courtesy', sales: 10, target: 20, gwpEx: 990, gwpT: 1980, qa: 0.9, att: 1, act: 8, emp: 8, canc: 0, talk: 1000, ref: 0, composite: { r2a: { fails: 0 } } },
      { code: 'CB1', name: 'A One', tl: 'Renolan Pillay', campaign: 'Cuddle', sales: 10, target: 20, gwpEx: 990, gwpT: 1980, qa: 0.9, att: 1, act: 8, emp: 8, canc: 0, talk: 1000, ref: 0, composite: { r2a: { fails: 0 } } }],
    notCovered: [] };
  const PROFILE = { nick: { role: 'admin', full_name: 'Nick', cb: null, team: null }, cb162: { role: 'agent', full_name: 'Nothando Mntungwa', cb: 'CB162', team: null },
    cb267: { role: 'team_leader', full_name: 'Denise Haripersad', cb: 'CB267', team: 'Denise Haripersad' }, cb207: { role: 'team_leader', full_name: 'Renolan Pillay', cb: 'CB207', team: 'Renolan Pillay' },
    dalwin: { role: 'campaign_manager', full_name: 'Dalwin Callaghan', cb: 'CB145', team: null } };
  const appUser = (u) => ({ username: u, apps: ['ops', 'vas', 'tracker', 'agent'], tabs: null, pii_unmask: false, active: true, hub_ids: null, must_change_password: false, theme: null, ...PROFILE[u] });
  const SESS = {}; const mk = (tok, u) => { SESS[sha(tok)] = { user_id: U[u], expires_at: '2099-01-01T00:00:00Z', scope: 'full', app_users: appUser(u) }; };
  for (const u of Object.keys(PROFILE)) mk('tok-' + u, u);
  const PW = await AUTH.hashPassword('correct horse battery');
  const RULES = { 'kv:agent-digest': { data: JSON.stringify(DIGEST) }, ai_kill_switch: { enabled: true } };
  let MODE = 'ok'; let ASKID = 100; let USAGE = []; let CALLS = []; const FORWARD_ERR = [];
  const pgRest = restFetch(A);
  await A.exec('delete from usage_events');
  const J = (b, s = 200) => new Response(b === undefined ? '' : JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
  const sb = async (u, method, opts) => {
    const t = u.pathname.replace('/rest/v1/', ''); const prm = u.searchParams; const body = opts.body ? JSON.parse(opts.body) : null;
    if (t === 'usage_events') {
      USAGE.push(...(Array.isArray(body) ? body : [body]));
      if (MODE === 'fail') return J({ message: 'boom' }, 500);
      if (MODE === 'throw') throw new TypeError('fetch failed');
      if (MODE === 'hang') return new Promise(() => {});
      const r = await pgRest(u.href, opts); if (!r.ok) FORWARD_ERR.push(await r.text()); return r;
    }
    if (t === 'app_sessions' && method === 'GET') { const m = /^eq\.(.*)$/.exec(prm.get('token_hash') || ''); const s = m && SESS[m[1]]; return J(s ? [s] : []); }
    if (t === 'app_sessions' && method === 'POST') { for (const r of body) { const u2 = Object.keys(U).find((k) => U[k] === r.user_id); SESS[r.token_hash] = { user_id: r.user_id, expires_at: r.expires_at, scope: 'full', app_users: appUser(u2) }; } return J(undefined, 201); }
    if (t === 'app_users' && method === 'GET') {
      const m = /^eq\.(.*)$/.exec(prm.get('username') || '');
      if (m && m[1] === 'nick') return J([{ id: U.nick, ...appUser('nick'), password_hash: PW, failed_attempts: 0, locked_until: null }]);
      return J([]);
    }
    if (t === 'rules' && method === 'GET') {
      const eq = /^eq\.(.*)$/.exec(prm.get('key') || ''); if (eq) return J(RULES[eq[1]] !== undefined ? [{ key: eq[1], value: RULES[eq[1]] }] : []);
      const lk = /^like\.(.*)\*$/.exec(prm.get('key') || ''); if (lk) return J(Object.keys(RULES).filter((k) => k.startsWith(lk[1])).map((k) => ({ key: k, value: RULES[k] })));
      return J([]);
    }
    if (t === 'rules' && method === 'POST') { for (const r of body) RULES[r.key] = r.value; return J(undefined, 201); }
    if (t === 'rules' && method === 'DELETE') { const eq = /^eq\.(.*)$/.exec(prm.get('key') || ''); if (eq) delete RULES[eq[1]]; return J(undefined, 204); }
    if (t === 'ask_log' && method === 'POST') return /return=representation/.test(new Headers(opts.headers).get('prefer') || '') ? J([{ id: ++ASKID, ...body[0] }], 201) : J(undefined, 201);
    if (method === 'GET') return J([]);
    return J(undefined, method === 'POST' ? 201 : 204);
  };
  const HST = ['New', 'In progress', 'Waiting on agent', 'Closed'].map((name, i) => ({ id: 'h' + i, name, position: i }));
  const CST = ['New', 'Triaged', 'Assisting', 'Awaiting confirmation', 'Follow-up due', 'Closed'].map((name, i) => ({ id: 'c' + i, name, position: i }));
  const HL = { opps: [], notes: {}, n: 0, failCreate: false, failNote: false };
  const hl = async (u, method, opts) => {
    const p = u.pathname; const body = opts.body ? JSON.parse(opts.body) : null; const stamp = () => new Date(Date.now() + (HL.n++)).toISOString();
    if (p === '/opportunities/pipelines') return J({ pipelines: [{ id: 'pH', name: 'Agent Help Center', stages: HST }, { id: 'pC', name: 'Campaign Assistance', stages: CST }] });
    if (p === '/opportunities/search') { const ops = HL.opps.filter((o) => o.pipelineId === u.searchParams.get('pipeline_id')); return J({ opportunities: ops, meta: { total: ops.length } }); }
    if (p === '/opportunities/' && method === 'POST') {
      if (HL.failCreate) return J({ message: 'Internal error' }, 500);
      if (body.pipelineId === 'pC' && HL.opps.some((o) => o.pipelineId === 'pC' && o.contactId === body.contactId)) return J({ message: 'Can not create duplicate opportunity', code: 'OPPORTUNITY_NO_DUPLICATE' }, 400);
      const t = stamp(); const o = { id: 'opp' + (HL.opps.length + 1), ...body, createdAt: t, updatedAt: t }; HL.opps.push(o); return J({ opportunity: o }, 201);
    }
    let m = /^\/opportunities\/([^/]+)$/.exec(p);
    if (m) { const o = HL.opps.find((x) => x.id === decodeURIComponent(m[1])); if (!o) return J({ message: 'nf' }, 404);
      if (method === 'GET') return J({ opportunity: o }); if (method === 'PUT') { Object.assign(o, body, { updatedAt: stamp() }); return J({ opportunity: o }); } return J({}); }
    m = /^\/contacts\/([^/]+)\/notes$/.exec(p);
    if (m) { const c = m[1]; HL.notes[c] = HL.notes[c] || [];
      if (method === 'POST') { if (HL.failNote) return J({ message: 'note boom' }, 500); const nt = { id: 'n' + (HL.n++), body: body.body, dateAdded: stamp() }; HL.notes[c].push(nt); return J({ note: nt }, 201); }
      return J({ notes: HL.notes[c].slice().reverse() }); }
    if (p === '/contacts/' && method === 'POST') return J({ contact: { id: 'ct-' + body.firstName } }, 201);
    return J({ message: 'unhandled ' + method + ' ' + p }, 404);
  };
  globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
  globalThis.fetch = async (input, opts = {}) => {
    const u = new URL(String(input)); const method = String(opts.method || 'GET').toUpperCase();
    CALLS.push({ host: u.host, method, path: u.pathname });
    if (u.host === 'sb.test') return sb(u, method, opts);
    if (u.host === 'services.leadconnectorhq.com') return hl(u, method, opts);
    return new Response('', { status: 404 });
  };
  const ENV = { SUPABASE_URL: 'https://sb.test', SUPABASE_SECRET_KEY: 'svc', HL_HELP_API_KEY: 'k', HL_HELP_LOCATION_ID: 'locH', AI: { run: async () => ({ response: 'An answer.' }) } };
  const pending = []; const ctx = { waitUntil: (p) => { pending.push(Promise.resolve(p).catch(() => {})); } };
  const settle = async () => { while (pending.length) await Promise.all(pending.splice(0)); };
  const clearCaches = () => { globalThis.__helpPipe = null; globalThis.__cmPipe = null; globalThis.__cmMir = null; globalThis.__cmArch = null; globalThis.__digestCaches = {}; globalThis.__cmCtx = null; };
  async function call(method, p, { token, body, headers, c = ctx } = {}) {
    USAGE = []; CALLS = [];
    const h = { 'X-Cbx-Client': 'v5', ...(headers || {}) }; if (token) h.Authorization = 'Bearer ' + token; if (body !== undefined) h['Content-Type'] = 'application/json';
    const res = await worker.default.fetch(new Request('https://api.test' + p, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), ENV, c);
    if (c === ctx) await settle();
    const t = await res.text(); let j = null; try { j = JSON.parse(t); } catch (e) { j = null; }
    const usageCalls = CALLS.filter((x) => x.path === '/rest/v1/usage_events').length;
    return { status: res.status, t, j, usage: USAGE.slice(), usageCalls, others: CALLS.filter((x) => x.path !== '/rest/v1/usage_events').length };
  }
  const MAXSUB = []; const track = (name, r) => { MAXSUB.push([name, r.usageCalls]); return r; };

  // C1 sign-in → an app open (the sign-in itself is the auth_log trigger's)
  UM.resetUsageSeen(); clearCaches();
  let r = track('login', await call('POST', '/api/login', { body: { username: 'nick', password: 'correct horse battery', page: '/pulse/' } }));
  ok(r.status === 200 && r.j && r.j.token, 'sign-in answers 200 with a token', r.status + ' ' + r.t.slice(0, 120));
  ok(r.usage.length === 1 && r.usage[0].event === 'app_open' && r.usage[0].app === 'vas' && r.usage[0].user_id === U.nick && r.usage[0].username === 'nick' && r.usage[0].role === 'admin' && r.usage[0].detail.via === 'login',
    'a sign-in from /pulse/ records ONE app_open (app vas, via login) with the account id', r.usage);
  ok(!r.usage.some((x) => /^login/.test(x.event)), 'the Worker writes no login row of its own — auth_log + the trigger carry sign-ins (no double count)');
  ok(r.j && r.j.user && !('user_id' in r.j.user) && !('user_id' in r.j), 'the sign-in answer does not grow a user_id field', Object.keys(r.j || {}));
  const tok = r.j && r.j.token;
  r = track('me', await call('GET', '/api/me?page=%2Fpulse%2F', { token: tok }));
  ok(r.status === 200 && r.usage.length === 0, 'the same person opening VAS again within 60 s is not a second open', r.usage);
  r = track('me', await call('GET', '/api/me?page=%2F', { token: tok }));
  ok(r.usage.length === 1 && r.usage[0].app === 'ops' && r.usage[0].event === 'app_open' && r.usage[0].detail.via === 'boot', 'opening Ops (page "/") is an ops open', r.usage);
  r = track('me', await call('GET', '/api/me?page=%2Ftracker%2F', { token: 'tok-nick' }));
  ok(r.usage.length === 1 && r.usage[0].app === 'tracker', '/tracker/ → tracker', r.usage);
  UM.resetUsageSeen();
  r = track('me', await call('GET', '/api/me', { token: 'tok-nick', headers: { Referer: 'https://chatterbox-agentos.pages.dev/' } }));
  ok(r.status === 200 && r.usage.length === 1 && r.usage[0].app === null, 'no page and an origin-only Referer → the open is recorded with app NULL, never guessed as Ops', r.usage);
  r = track('portal-me', await call('GET', '/api/portal/me?page=%2Fagent%2F', { token: 'tok-cb162' }));
  ok(r.status === 200 && r.usage.length === 1 && r.usage[0].app === 'agent' && r.usage[0].role === 'agent' && r.usage[0].user_id === U.cb162, 'Agent Analytics boot (/api/portal/me) → an agent-app open', r.usage);
  r = track('me-401', await call('GET', '/api/me?page=%2F', { token: 'nobody' }));
  ok(r.status === 401 && r.usage.length === 0, 'no session → nothing recorded');

  // C2 help ask
  clearCaches();
  r = track('help', await call('POST', '/api/portal/help/request', { token: 'tok-cb162', body: { category: 'Explain the product', note: 'how do I pitch the upgrade?' } }));
  const ask = r.usage[0] || {};
  ok(r.status === 200 && r.usage.length === 1, 'a help ask answers 200 and records one row', r.status + ' ' + JSON.stringify(r.usage));
  ok(ask.event === 'help_ask' && ask.app === 'agent' && ask.category === 'Explain the product' && ask.team_leader === 'Denise Haripersad' && ask.campaign === 'Courtesy'
    && ask.detail && ask.detail.note === 'how do I pitch the upgrade?' && ask.detail.delivered === true && ask.detail.opp_id === (r.j && r.j.id) && ask.username === 'cb162' && ask.detail.cb === 'CB162',
    'help_ask: category + the agent\'s note + their TL + campaign (from the digest) + delivered=true + the card id', ask);
  const note = Object.values(HL.notes).flat().find((n) => n.body.startsWith('Help request ' + (r.j && r.j.id)));
  const asked = note && (/^Asked: (.+)$/m.exec(note.body) || [])[1];
  ok(asked && ask.source_key === 'hl-help:' + r.j.id + ':' + asked && ask.at === asked, 'its key is hl-help:<card>:<the note\'s Asked: time> — the same key the backfill reads back', { key: ask.source_key, asked });
  LIVE.helpNote = note; LIVE.helpRow = ask;
  HL.failCreate = true; clearCaches();
  r = track('help-fail', await call('POST', '/api/portal/help/request', { token: 'tok-cb162', body: { category: 'Review my call', note: 'please listen to my 10:00 call' } }));
  HL.failCreate = false;
  const f = r.usage[0] || {};
  ok(r.status === 502 && r.usage.length === 1 && f.event === 'help_ask' && f.detail.delivered === false && /HighLevel/.test(f.detail.error || '') && f.category === 'Review my call'
    && f.detail.note === 'please listen to my 10:00 call' && f.team_leader === 'Denise Haripersad' && f.campaign === 'Courtesy' && f.source_key == null,
    'HighLevel down: the ask is still recorded — category, note, TL, campaign — delivered=false with the error, no key', { status: r.status, f });
  HL.failNote = true; clearCaches();
  r = track('help-note-fail', await call('POST', '/api/portal/help/request', { token: 'tok-cb162', body: { category: 'Something else', note: 'note will not save' } }));
  HL.failNote = false;
  ok(r.status === 502 && r.usage.length === 1 && r.usage[0].detail.delivered === false && r.usage[0].detail.note_failed === true, 'the card landed but the note did not: delivered=false, note_failed', r.usage);
  r = track('help-empty', await call('POST', '/api/portal/help/request', { token: 'tok-cb162', body: { category: 'Something else', note: '   ' } }));
  ok(r.status === 400 && r.usage.length === 0, 'an empty note is refused (400) and is not an ask');
  r = track('help-tl', await call('POST', '/api/portal/help/request', { token: 'tok-cb267', body: { category: 'Something else', note: 'x' } }));
  ok(r.status === 403 && r.usage.length === 0, 'a team leader cannot ask (403) — nothing recorded');
  // stage moves
  const oppId = ask.detail && ask.detail.opp_id;
  r = track('stage', await call('POST', '/api/portal/help/stage', { token: 'tok-cb267', body: { id: oppId, stageId: 'h1' } }));
  const st = r.usage[0] || {};
  ok(r.status === 200 && r.usage.length === 1 && st.event === 'help_stage' && st.category === 'In progress' && st.detail.opp_id === oppId && st.detail.by === 'team_leader'
    && st.detail.closed === false && st.username === 'cb267' && st.team_leader === 'Denise Haripersad', 'a team leader moving the card records help_stage (stage, card, by team_leader)', { status: r.status, st });
  r = track('close', await call('POST', '/api/portal/help/close', { token: 'tok-cb162', body: { id: oppId } }));
  ok(r.status === 200 && r.usage.length === 1 && r.usage[0].event === 'help_stage' && r.usage[0].detail.by === 'agent' && r.usage[0].detail.closed === true && r.usage[0].detail.action === 'close',
    'the agent closing their own request records help_stage (by agent, closed)', r.usage);
  r = track('stage-bad', await call('POST', '/api/portal/help/stage', { token: 'tok-cb267', body: { id: oppId, stageId: 'nope' } }));
  ok(r.status === 400 && r.usage.length === 0, 'a refused move records nothing');

  // C3 campaign manager
  clearCaches();
  r = track('cm', await call('POST', '/api/portal/cm/request', { token: 'tok-cb207', body: { blockage: 'dialler', description: 'SECRET dialler drops every call', priority: 'P1', campaign: 'Cuddle', affected: 4 } }));
  const cm = r.usage[0] || {};
  ok(r.status === 200 && r.usage.length === 1 && cm.event === 'cm_request' && cm.category === 'dialler' && cm.campaign === 'Cuddle' && cm.team_leader === 'Renolan Pillay'
    && cm.detail.priority === 'P1' && cm.detail.opp_id === (r.j && r.j.id) && cm.detail.affected === 4, 'a CM request records blockage, campaign, TL, priority, card', { status: r.status, t: r.t.slice(0, 160), cm });
  /* Spec Kit 029 FR-002 (Nick, 2026-10-11) supersedes 028's "never the text": the TL's words ride in detail.text — there
     and nowhere else (verify-usage-029 holds the rest, incl. "never a restricted request's") */
  ok(cm.detail.text === 'SECRET dialler drops every call' && !JSON.stringify({ ...r.usage[0], detail: { ...cm.detail, text: null } }).includes('SECRET'),
    'the request text is kept in detail.text only (029 FR-002)', cm.detail);
  ok(cm.detail.delivered === true, 'a request that reached the campaign manager is delivered=true');
  const mir = RULES['kv:cm-areq:' + (r.j && r.j.id)] || {};
  ok(cm.source_key === 'cm-req:' + (r.j && r.j.id) + ':' + String(mir.requested_at || '').replace(/[^0-9]/g, '').slice(0, 14) && cm.at === mir.requested_at,
    'its key is cm-req:<card>:<requested_at digits> — what the backfill computes from the mirror row', { key: cm.source_key, req: mir.requested_at });
  const cmId = r.j && r.j.id;
  r = track('cm-act', await call('POST', '/api/portal/cm/act', { token: 'tok-dalwin', body: { id: cmId, action: 'acknowledge' } }));
  const act = r.usage[0] || {}; const mir2 = RULES['kv:cm-areq:' + cmId] || { history: [] }; const lastH = mir2.history[mir2.history.length - 1] || {};
  ok(r.status === 200 && r.usage.length === 1 && act.event === 'cm_action' && act.category === 'acknowledge' && act.username === 'dalwin' && act.team_leader === 'Renolan Pillay' && act.campaign === 'Cuddle'
    && act.source_key === 'cm-hist:' + cmId + ':' + lastH.at, 'a CM action records the action, the request\'s TL + campaign, keyed cm-hist:<card>:<history time>', { status: r.status, t: r.t.slice(0, 160), act, lastH });
  r = track('cm-act-bad', await call('POST', '/api/portal/cm/act', { token: 'tok-dalwin', body: { id: cmId, action: 'nonsense' } }));
  ok(r.status === 400 && r.usage.length === 0, 'an unknown action records nothing');
  LIVE.cmMirror = { key: 'kv:cm-areq:' + cmId, value: JSON.parse(JSON.stringify(RULES['kv:cm-areq:' + cmId])) }; LIVE.cmRows = [cm, act];
  // Nick, 2026-10-11: "Yes, record them as not delivered" — a CM request that fails to send is recorded like a failed help ask
  r = track('cm-409', await call('POST', '/api/portal/cm/request', { token: 'tok-cb207', body: { blockage: 'leads', description: 'SECRET no leads', priority: 'P2', campaign: 'Cuddle' } }));
  const c409 = r.usage[0] || {};
  ok(r.status === 409 && r.usage.length === 1 && c409.event === 'cm_request' && c409.detail.delivered === false && c409.category === 'leads' && c409.team_leader === 'Renolan Pillay'
    && c409.campaign === 'Cuddle' && c409.detail.priority === 'P2' && c409.detail.opp_id === cmId && c409.source_key == null && c409.detail.error && c409.detail.error.length <= 120,
    'refused (the team already has an open card): cm_request delivered=false, the reason (≤120), the card it hit, no key', { status: r.status, c409 });
  HL.failCreate = true; clearCaches();
  r = track('cm-fail', await call('POST', '/api/portal/cm/request', { token: 'tok-cb267', body: { blockage: 'leads', description: 'SECRET leads missing', priority: 'P3', campaign: 'Courtesy', affected: 2 } }));
  HL.failCreate = false;
  const cf = r.usage[0] || {};
  ok(r.status === 502 && r.usage.length === 1 && cf.event === 'cm_request' && cf.detail.delivered === false && /HighLevel/.test(cf.detail.error || '') && cf.detail.error.length <= 120
    && cf.category === 'leads' && cf.team_leader === 'Denise Haripersad' && cf.campaign === 'Courtesy' && cf.detail.priority === 'P3' && cf.detail.affected === 2 && cf.source_key == null,
    'HighLevel down: the CM request is still recorded — blockage, TL, campaign, priority — delivered=false with the reason clamped to 120', { status: r.status, cf });
  ok(c409.detail.text === 'SECRET no leads' && cf.detail.text === 'SECRET leads missing', 'a failed request keeps its words too, like a failed help ask (029 FR-002)', [c409.detail.text, cf.detail.text]);
  r = track('cm-invalid', await call('POST', '/api/portal/cm/request', { token: 'tok-cb207', body: { blockage: 'nonsense', description: 'x' } }));
  ok(r.status === 400 && r.usage.length === 0, 'an invalid request (unknown blockage) is refused before it is a request — nothing recorded');

  // C4 AI questions
  clearCaches();
  r = track('portal-ask', await call('POST', '/api/portal/ask', { token: 'tok-cb162', body: { q: 'how do I lift my GWP?' } }));
  ok(r.status === 200 && r.usage.length === 1 && r.usage[0].event === 'ai_question' && r.usage[0].app === 'agent' && r.usage[0].detail.question === 'how do I lift my GWP?' && r.usage[0].source_key === 'ask_log:' + ASKID,
    'Ask Nikola (Agent Analytics) → ai_question, app agent, the question, keyed ask_log:<id>', { status: r.status, t: r.t.slice(0, 120), u: r.usage });
  r = track('ask', await call('POST', '/api/ask?page=%2Fpulse%2F', { token: 'tok-nick', body: { question: 'who sold most?' } }));
  ok(r.status === 200 && r.usage.length === 1 && r.usage[0].app === 'vas' && r.usage[0].username === 'nick' && r.usage[0].source_key === 'ask_log:' + ASKID, 'Ask AgentOS from VAS → ai_question, app vas', r.usage);

  ok(FORWARD_ERR.length === 0, 'every row the Worker wrote is accepted by the real usage_events schema (PGlite)', FORWARD_ERR);
  ok(MAXSUB.every(([, n]) => n <= 1), 'no request spends more than ONE usage subrequest', MAXSUB.filter(([, n]) => n > 1));

  // C5 a failing usage write never changes the answer
  const scenario = async () => {
    UM.resetUsageSeen(); clearCaches();
    return [await call('GET', '/api/me?page=%2Fpulse%2F', { token: 'tok-nick' }), await call('GET', '/api/portal/me?page=%2Fagent%2F', { token: 'tok-cb162' }),
      await call('POST', '/api/portal/help/request', { token: 'tok-cb162', body: { category: 'Explain the product', note: 'again' } }),
      await call('POST', '/api/ask?page=%2F', { token: 'tok-nick', body: { question: 'q' } })];
  };
  MODE = 'ok'; const base = await scenario();
  for (const mode of ['fail', 'throw']) {
    MODE = mode; const got = await scenario();
    const same = got.every((g, i) => g.status === base[i].status && JSON.stringify(Object.keys(g.j || {}).sort()) === JSON.stringify(Object.keys(base[i].j || {}).sort()) && (i !== 0 || g.t === base[i].t));
    ok(same, `usage insert ${mode === 'fail' ? 'answering 500' : 'throwing'}: every status and body is unchanged`, got.map((g) => g.status + ' ' + g.t.slice(0, 60)));
    /* ≤, not =: a failed insert also skips the 029 topic label that follows it (one topics read fewer) */
    ok(got.every((g, i) => g.others <= base[i].others), `…and spends no extra subrequest retrying (${mode})`, got.map((g, i) => g.others + '/' + base[i].others));
  }
  MODE = 'hang'; UM.resetUsageSeen();
  const lost = []; const hangCtx = { waitUntil: (p) => lost.push(p) };
  const raced = await Promise.race([call('GET', '/api/me?page=%2Fpulse%2F', { token: 'tok-nick', c: hangCtx }).then((x) => x.status), new Promise((res) => setTimeout(() => res('timeout'), 3000))]);
  ok(raced === 200 && lost.length >= 1, 'a usage insert that never answers does not hold the response (it is only ever waitUntil\'d)', raced);
  MODE = 'ok';
  const idx = read('worker/src/index.mjs');
  ok(!/await\s+recordUsage|await\s+usageInsert\(/.test(idx), 'index.mjs never awaits a usage write on the request path');
}

/* ═══════════════════════ D · THE PAGES SAY WHERE THEY ARE ═══════════════════════ */
head('D · pages send their path; no new CORS header');
{
  const gate = read('site/auth-gate.js'), agent = read('agent/index.html'), widget = read('site/ask-widget.js'), idx = read('worker/src/index.mjs');
  ok(/api\('\/api\/me\?page=' \+ encodeURIComponent\(location\.pathname\)\)/.test(gate), "auth-gate.js boots with /api/me?page=<location.pathname>");
  ok(/api\('\/api\/login', \{ username: username, password: password, page: location\.pathname \}\)/.test(gate), 'auth-gate.js sends page with the sign-in');
  ok(/api\('\/api\/portal\/me\?page='\+encodeURIComponent\(location\.pathname\)\)/.test(agent), 'Agent Analytics boots with /api/portal/me?page=<location.pathname>');
  ok(/api\('\/api\/login',\{username:u,password:p,page:location\.pathname\}\)/.test(agent), 'Agent Analytics sends page with the sign-in');
  ok(/"\/api\/ask\?page=" \+ encodeURIComponent\(location\.pathname\)/.test(widget), 'the Ask AgentOS widget sends page');
  ok(idx.includes("'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Cbx-Client,Content-Encoding,X-Cbx-Base'"), 'the CORS header list is unchanged (a query param needs no preflight change)');
}

/* ═══════════════════════ E · THE BACKFILL ═══════════════════════ */
head('E · tools/usage-backfill.mjs — dry, apply, idempotent, same keys as live');
const BF = await imp('tools/usage-backfill.mjs');
ok(!BF.__error && typeof BF.runBackfill === 'function', 'tools/usage-backfill.mjs exports runBackfill', BF.__error);
if (!BF.__error && BF.runBackfill && sqlText) {
  // key equality with what the live Worker wrote in C
  if (LIVE.helpNote) {
    const ev = BF.helpNoteToEvent(LIVE.helpNote, { id: LIVE.helpRow.detail.opp_id }, {});
    ok(ev && ev.source_key === LIVE.helpRow.source_key && ev.category === LIVE.helpRow.category && ev.team_leader === LIVE.helpRow.team_leader && ev.campaign === LIVE.helpRow.campaign && ev.detail.note === LIVE.helpRow.detail.note,
      'the backfill reads the live ask\'s note back to the SAME key, category, TL, campaign and note', { ev, live: LIVE.helpRow });
  }
  const lines = [...read('worker/src/assist.mjs').matchAll(/hist\(m,\s*\w+,\s*'([^']*)'/g)].map((x) => x[1]);
  ok(lines.length >= 15 && lines.every((w) => BF.cmActionOf(w) !== 'other'), 'every history line assist.mjs writes (' + lines.length + ') maps to a known action in the backfill', lines.filter((w) => BF.cmActionOf(w) === 'other'));
  if (LIVE.cmMirror) {
    const evs = BF.cmMirrorToEvents(LIVE.cmMirror.key, LIVE.cmMirror.value, {});
    for (const lr of LIVE.cmRows) ok(evs.some((e) => e.source_key === lr.source_key && e.event === lr.event && e.category === lr.category), 'the backfill derives the live ' + lr.event + ' key ' + lr.source_key, evs.map((e) => e.source_key));
  }
  const E = await newDb({ before: async (db) => { await seedUsers(db);
    for (const ev of ['login_ok', 'login_fail:bad_password', 'logout', 'login_ok:wimpy']) await db.query("insert into auth_log (user_id, username, event) values ($1, 'cb162', $2)", [U.cb162, ev]); } });
  await E.query("insert into auth_log (user_id, username, event) values ($1, 'nick', 'login_ok')", [U.nick]);   // after release: mirrored by the trigger
  for (const [who, qn] of [['cb162', 'q1'], ['nick', 'q2'], ['cb267', 'q3']]) await E.query("insert into ask_log (asked_by, question, answer, model) values ($1, $2, 'a', 'm')", [who, qn]);
  await E.query("insert into usage_events (event, username, source, source_key, detail) values ('ai_question', 'cb267', 'worker', 'ask_log:3', '{}')");   // already live
  const mirA = { requested_at: '2026-10-01T08:00:00.000Z', blockage: 'dialler', cb: 'CB207', tl: 'Renolan Pillay', campaign: 'Cuddle', priority: 'P1', restricted: false, affected: 3,
    resolution_mins: null, assistance_started_at: '2026-10-01T08:20:00.000Z',
    history: [{ at: '2026-10-01T08:00:00.010Z', actor: 'Renolan Pillay', what: 'raised · P1 · dialler' }, { at: '2026-10-01T08:05:00.000Z', actor: 'Dalwin Callaghan', what: 'acknowledged' },
      { at: '2026-10-01T08:20:00.000Z', actor: 'Dalwin Callaghan', what: 'assistance started (20 min, inside SLA)' }] };
  const mirB = { requested_at: '2026-09-01T08:00:00.000Z', blockage: 'personal', cb: 'CB207', tl: 'Renolan Pillay', campaign: 'Cuddle', priority: 'P3', restricted: true, resolution_mins: 50,
    card: { id: 'oppB' }, history: [{ at: '2026-09-01T08:00:00.010Z', actor: 'Renolan Pillay', what: 'raised · P3 · personal' }, { at: '2026-09-01T08:10:00.000Z', actor: 'Renolan Pillay', what: 'duplicate merged' },
      { at: '2026-09-01T08:50:00.000Z', actor: 'Renolan Pillay', what: 'team leader confirmed' }] };
  await E.query("insert into usage_events (event, username, source, detail, at) values ('help_stage', 'cb267', 'worker', '{\"opp_id\":\"H2\",\"by\":\"team_leader\",\"closed\":false}', '2026-10-05T08:00:00Z')");   // H2 already tracked live
  await E.query('insert into rules (key, value) values ($1, $2), ($3, $4)', ['kv:cm-areq:oppA', JSON.stringify(mirA), 'kv:cm-areq-arch:oppB:20260901080000', JSON.stringify(mirB)]);
  const HN = { c162: [
    { id: 'nA', dateAdded: '2026-10-02T08:00:01.000Z', body: 'Help request H1\nAsked: 2026-10-02T08:00:00.000Z\nTopic: Explain the product\nFrom: Nothando Mntungwa (CB162) · Courtesy · Team Denise Haripersad\n\nplease help\nsecond line' },
    { id: 'nB', dateAdded: '2026-09-02T08:00:01.000Z', body: 'Help request H2\nTopic: Review my call\nFrom: Nothando Mntungwa (CB162)\n\nold ask' },
    { id: 'nC', dateAdded: '2026-09-03T08:00:01.000Z', body: 'Assist oppA\nAcknowledged by Dalwin' },
    { id: 'nD', dateAdded: '2026-09-04T08:00:01.000Z', body: 'Help request ZZZ\nTopic: Something else\nFrom: X (CB1)\n\nnot in this pipeline' }] };
  const HOPPS = [{ id: 'H1', pipelineId: 'pH', contactId: 'c162', name: '[Explain the product] CB162 Nothando Mntungwa', pipelineStageId: 'h3', status: 'won', createdAt: '2026-10-02T08:00:00.000Z', lastStageChangeAt: '2026-10-02T10:00:00.000Z' },
    { id: 'H2', pipelineId: 'pH', contactId: 'c162', name: '[Review my call] CB162 Nothando Mntungwa', pipelineStageId: 'h1', status: 'open', createdAt: '2026-09-02T08:00:00.000Z', lastStageChangeAt: '2026-09-02T09:00:00.000Z' }];
  const HST = ['New', 'In progress', 'Waiting on agent', 'Closed'].map((name, i) => ({ id: 'h' + i, name, position: i }));
  const er = restFetch(E); let hlCalls = [];
  globalThis.fetch = async (input, opts = {}) => {
    const u = new URL(String(input)); const method = String(opts.method || 'GET').toUpperCase();
    if (u.host === 'sb.backfill') return er(u.href, opts);
    if (u.host === 'services.leadconnectorhq.com') {
      hlCalls.push(method + ' ' + u.pathname);
      if (method !== 'GET') return new Response('{}', { status: 405 });
      if (u.pathname === '/opportunities/pipelines') return new Response(JSON.stringify({ pipelines: [{ id: 'pH', name: 'Agent Help Center', stages: HST }] }), { status: 200 });
      if (u.pathname === '/opportunities/search') return new Response(JSON.stringify({ opportunities: HOPPS, meta: { total: HOPPS.length } }), { status: 200 });
      const m = /^\/contacts\/([^/]+)\/notes$/.exec(u.pathname); if (m) return new Response(JSON.stringify({ notes: HN[m[1]] || [] }), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  };
  const OPT = { supabaseUrl: 'https://sb.backfill', serviceKey: 'svc', hl: { key: 'k', location: 'locH' }, log: () => {} };
  const count = async () => (await q(E, 'select count(*)::int n from usage_events')).at(0).n;
  const before = await count();
  const dry = await BF.runBackfill({ ...OPT, apply: false });
  ok((await count()) === before, 'the dry run (the default) writes nothing');
  const S = dry.sources || {};
  ok(S.auth_log && S.auth_log.toInsert === 4 && S.auth_log.byEvent['login_ok:wimpy'] === 1 && S.auth_log.byEvent.login_ok === 1, 'dry: auth_log — the 4 rows the trigger has not mirrored, counted per auth event', S.auth_log);
  ok(S.ask_log && S.ask_log.toInsert === 2, 'dry: ask_log — 3 questions, 1 already recorded live → 2', S.ask_log);
  ok(S.cm && S.cm.toInsert === 6 && S.cm.byEvent.cm_request === 3 && S.cm.byEvent.cm_action === 3, 'dry: CM — 2 requests + 1 merged duplicate + 3 actions (acknowledge, start, confirm_tl)', S.cm);
  ok(S.hl_help && S.hl_help.byEvent.help_ask === 2 && S.hl_help.byEvent.help_stage === 1, 'dry: Help pipeline — 2 asks (the CM note and the foreign card ignored) + 1 stage reading (H2 already has live stage rows — never a second, review M1)', S.hl_help);
  ok(hlCalls.every((c) => c.startsWith('GET ')), 'HighLevel is only ever READ (GETs)', hlCalls);
  const app = await BF.runBackfill({ ...OPT, apply: true });
  const A2 = app.sources || {};
  ok(['auth_log', 'ask_log', 'cm', 'hl_help'].every((k) => A2[k] && A2[k].inserted === S[k].toInsert), 'apply inserts exactly what the dry run counted', Object.fromEntries(Object.entries(A2).map(([k, v]) => [k, [v.inserted, S[k] && S[k].toInsert]])));
  const h1 = (await q(E, "select category, team_leader, campaign, username, user_id::text, detail, at from usage_events where source_key = 'hl-help:H1:2026-10-02T08:00:00.000Z'")).at(0) || {};
  ok(h1.category === 'Explain the product' && h1.team_leader === 'Denise Haripersad' && h1.campaign === 'Courtesy' && h1.username === 'cb162' && h1.user_id === U.cb162
    && h1.detail.note === 'please help\nsecond line' && h1.detail.delivered === true && h1.detail.opp_id === 'H1', 'a backfilled ask: topic, TL + campaign from the note, the agent account, the full note', h1);
  const h2 = (await q(E, "select team_leader, campaign, source_key from usage_events where event = 'help_ask' and detail->>'opp_id' = 'H2'")).at(0) || {};
  ok(h2.source_key === 'hl-help:H2:note:nB' && h2.team_leader === null && h2.campaign === null, 'an older note without Asked:/Team lines: keyed by the note id, TL and campaign left NULL (never invented)', h2);
  const restricted = (await q(E, "select detail from usage_events where event = 'cm_request' and category = 'personal' and not coalesce((detail->>'merged')::boolean, false)")).at(0) || {};
  ok(restricted.detail && restricted.detail.restricted === true && restricted.detail.opp_id === 'oppB' && restricted.detail.delivered === true,'an archived CM request comes back from its archive row (card id from value.card)', restricted);
  const bst = (await q(E, "select detail->>'by' by from usage_events where source = 'backfill' and event = 'help_stage'"));
  ok(bst.length === 1 && bst[0].by === 'backfill', 'a backfilled stage reading is marked by:backfill', bst);
  const hat = (await q(E, "select answered, closed_at from help_answer_times where opp_id = 'H1'")).at(0) || {};
  ok(hat.answered === false && hat.closed_at, 'help_answer_times: a backfilled reading shows the card closed but never claims a team leader answered (review M1)', hat);
  const views = await q(E, "select status from cm_requests order by requested_at");
  ok(views.length === 2 && views[0].status === 'Resolved' && views[1].status === 'Assisting', 'the backfilled CM requests read Resolved / Assisting in cm_requests', views);
  const again = await BF.runBackfill({ ...OPT, apply: true });
  ok(Object.values(again.sources || {}).every((v) => v.inserted === 0), 'a second apply inserts 0 everywhere (SC-003)', Object.fromEntries(Object.entries(again.sources || {}).map(([k, v]) => [k, v.inserted])));
  const al = await q(E, 'select event, count(*)::int n from auth_log group by 1 order by 1');
  const ue = await q(E, "select detail->>'auth_event' event, count(*)::int n from usage_events where source = 'auth_log' group by 1 order by 1");
  ok(JSON.stringify(al) === JSON.stringify(ue), 'auth_log parity after the backfill', { al, ue });
  const nokey = await BF.runBackfill({ ...OPT, hl: null, apply: false });
  ok(nokey.sources && !nokey.sources.hl_help && (nokey.skipped || []).some((s) => /HL_HELP/.test(s)) && nokey.sources.auth_log, 'without the Help location key the HighLevel source is skipped and SAYS so; the others still run', nokey.skipped);
  const noTable = await newDb({ migrate: false, before: seedUsers });
  const er2 = restFetch(noTable);
  globalThis.fetch = async (input, opts = {}) => { const u = new URL(String(input)); return u.host === 'sb.backfill' ? er2(u.href, opts) : new Response('{}', { status: 404 }); };
  const pre = await BF.runBackfill({ ...OPT, hl: null, apply: false });
  ok(pre.sources && pre.sources.auth_log && (pre.notes || []).some((s) => /migration-061/.test(s)), 'run before the migration: the dry run still sizes every source and names migration-061 as the missing step', pre.notes);
}

/* ═══════════════════════ F · REGISTERED ═══════════════════════ */
head('F · registered in verify.yml; PGlite a diagnostics devDependency');
{
  const yml = read('.github/workflows/verify.yml');
  ok(/verify-usage-028/.test(yml), 'verify.yml runs verify-usage-028');
  const pkg = JSON.parse(read('nicks_code/diagnostics/package.json') || '{}');
  ok(!!(pkg.devDependencies || {})['@electric-sql/pglite'], '@electric-sql/pglite is a diagnostics devDependency');
}

console.log('\n' + (fail ? 'FAIL' : 'PASS') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
