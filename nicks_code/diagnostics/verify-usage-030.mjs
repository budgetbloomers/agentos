#!/usr/bin/env node
/* verify-usage-030.mjs — WHO ASKED: names, teams and leaders on every ask (Spec Kit 030, 2026-10-11).
 *
 * Nick (looking at most_asked_topics): "add agents team name, who asked and their team leader, do the same for team
 * leader and campaign manager".
 *
 *   A · migration-063 VERBATIM in PGlite on top of 061 + 062: help_asks_detail, cm_requests_detail, ask_askers,
 *       most_asked_topics.askers / asked_by — live-recorded and HighLevel-backfilled asks, leavers, test traffic, lockdown
 *   B · registered in verify.yml
 *
 *   node nicks_code/diagnostics/verify-usage-030.mjs      (no network, no credentials)
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, newDb, readSql, applyMigration } from './usage-028-harness.mjs';

const M062 = 'migration-062-help-asks-and-topics.sql', M063 = 'migration-063-who-asked.sql';
const read = (rel) => { const f = path.join(ROOT, ...rel.split('/')); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n') : ''; };
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m + (d !== undefined ? ' — ' + (typeof d === 'string' ? d : JSON.stringify(d)) : '')); } };
const head = (t) => console.log('\n' + t);
const q = async (db, sql, args) => (await db.query(sql, args || [])).rows;
const denied = async (db, role, sql) => { try { await db.exec(`set role ${role}`); await db.query(sql); return false; } catch (e) { return /permission denied/.test(String(e.message)); } finally { await db.exec('reset role'); } };

const U = { cb162: '00000000-0000-4000-8000-000000000162', cb245: '00000000-0000-4000-8000-000000000245', cb267: '00000000-0000-4000-8000-000000000267',
  cb207: '00000000-0000-4000-8000-000000000207', dalwin: '00000000-0000-4000-8000-000000000145', ryan: '00000000-0000-4000-8000-000000000146', preshen: '00000000-0000-4000-8000-000000000147' };
const D = 'Denise Haripersad', RP = 'Renolan Pillay';
const PEOPLE = [['cb162', 'agent', 'CB162', 'Nothando Mntungwa', D], ['cb245', 'agent', 'CB245', 'Jamie Lee Chetty', D],
  ['cb267', 'team_leader', 'CB267', D, D], ['cb207', 'team_leader', 'CB207', RP, RP],
  ['dalwin', 'campaign_manager', 'CB145', 'Dalwin Callaghan', null], ['ryan', 'campaign_manager', 'CB146', 'Ryan G', null], ['preshen', 'campaign_manager', 'CB147', 'Preshen Naidoo', null]];

head('A · migration-063 in PGlite — who asked, on every ask');
const sql63 = readSql(M063);
ok(!!sql63, 'supabase/' + M063 + ' exists');
let A = null;
if (sql63) {
  try {
    A = await newDb({ before: async (db) => {
      for (const [u, role, cb, name, team] of PEOPLE)
        await db.query('insert into app_users (id, username, full_name, password_hash, role, cb, team) values ($1,$2,$3,$4,$5,$6,$7)', [U[u], u, name, 'x', role, cb, team]);
      /* team_leader_cbs as migrations 018 + 040 build it; Supabase's default privileges give service_role every table */
      await db.exec('create table if not exists team_leader_cbs (leader_name text primary key, employee_code text, updated_by text, updated_at timestamptz not null default now(), campaign text, manager text)');
      await db.exec('alter table team_leader_cbs enable row level security');
      await db.exec('grant select on rules, app_users, team_leader_cbs to service_role');
      await db.query("insert into team_leader_cbs (leader_name, employee_code, campaign, manager) values ($1,'CB267','Courtesy','Dalwin Callaghan'), ($2,'CB207','Cuddle','Ryan G'), ('Old Leader','CB999','Courtesy','Ryan G')", [D, RP]);
    } });
    await applyMigration(A, M062); await applyMigration(A, M063);
    ok(true, 'migration-063 applies on top of 061 + 062');
    await applyMigration(A, M063); ok(true, 'and a second time (re-runnable)');
  } catch (e) { ok(false, 'migration-063 applies', String(e.message)); A = null; }
}
if (A) {
  const ins = async (rows) => { for (const r of rows) await A.query(
    'insert into usage_events (at, user_id, username, role, app, event, category, team_leader, campaign, detail, source, source_key, topic) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
    [r.at, r.user_id || null, r.username || null, r.role || null, 'agent', r.event, r.category || null, r.team_leader || null, r.campaign || null,
      r.detail ? JSON.stringify(r.detail) : null, r.source || 'worker', r.source_key || null, r.topic || null]); };
  await ins([
    // 1 live-recorded help ask (account by user_id) + its card moving
    { at: '2026-10-06T08:00:00Z', user_id: U.cb162, username: 'cb162', role: 'agent', event: 'help_ask', category: 'Review my call', team_leader: D, campaign: 'Courtesy', topic: 'call_review',
      detail: { note: 'please listen to my 10am call', delivered: true, opp_id: 'H1', cb: 'CB162', agent_name: 'Nothando Mntungwa' }, source_key: 'hl-help:H1:a' },
    { at: '2026-10-06T08:30:00Z', user_id: U.cb267, username: 'cb267', role: 'team_leader', event: 'help_stage', category: 'In progress', team_leader: D, detail: { opp_id: 'H1', by: 'team_leader', closed: false } },
    // 2 HighLevel-backfilled ask: no account fields, the CB from the card's note, an old spelling of the name
    { at: '2026-09-28T13:33:28Z', event: 'help_ask', category: 'Review my call', team_leader: D, campaign: 'Courtesy', topic: 'call_review', source: 'backfill', source_key: 'hl-help:H2:note:n1',
      detail: { note: 'can I put this call through', delivered: true, opp_id: 'H2', cb: 'CB245', agent_name: 'Jamie L. Chetty' } },
    // 3 a leaver: the account is gone — the username (and the CB it implies) still show
    { at: '2026-10-07T09:00:00Z', user_id: '00000000-0000-4000-8000-000000000500', username: 'cb500', role: 'agent', event: 'help_ask', category: 'Explain the product', team_leader: 'Sharoma Rampersad', campaign: 'Cuddle', topic: 'product',
      detail: { note: 'what does the upgrade cover', delivered: false, error: 'HighLevel down' } },
    // 4 test traffic: a Test message ask and a test account
    { at: '2026-10-07T10:00:00Z', user_id: U.cb162, username: 'cb162', role: 'agent', event: 'help_ask', category: 'Something else', team_leader: D, campaign: 'Courtesy', topic: 'test', detail: { note: 'testing', delivered: true, opp_id: 'H9' } },
    { at: '2026-10-07T10:05:00Z', username: 'testbot', event: 'help_ask', category: 'Review my call', topic: 'call_review', detail: { note: 'probe', delivered: true } },
    // CM: 5 live, cms names all three → the TL's manager on record; Dalwin handles it
    { at: '2026-10-06T09:00:00Z', user_id: U.cb207, username: 'cb207', role: 'team_leader', event: 'cm_request', category: 'dialler', team_leader: RP, campaign: 'Cuddle', topic: 'dialler',
      detail: { opp_id: 'C1', priority: 'P1', delivered: true, text: 'the dialler drops calls', cms: ['dalwin', 'preshen', 'ryan'] }, source_key: 'cm-req:C1:1' },
    { at: '2026-10-06T09:10:00Z', user_id: U.dalwin, username: 'dalwin', role: 'campaign_manager', event: 'cm_action', category: 'start', team_leader: RP, campaign: 'Cuddle', detail: { opp_id: 'C1', actor: 'Dalwin Callaghan', started: true } },
    // 6 cms names exactly one → that one
    { at: '2026-10-08T09:00:00Z', user_id: U.cb267, username: 'cb267', role: 'team_leader', event: 'cm_request', category: 'leads', team_leader: D, campaign: 'Courtesy', topic: 'leads_data',
      detail: { opp_id: 'C2', delivered: true, text: 'no leads loaded', cms: ['preshen'] }, source_key: 'cm-req:C2:1' },
    // 7 backfilled from the card notes, the TL has no account any more → name + CB from team_leader_cbs
    { at: '2026-09-21T12:08:17Z', event: 'cm_request', category: 'leads', team_leader: 'Old Leader', campaign: 'Courtesy', topic: 'leads_data', source: 'backfill', source_key: 'hl-cm:C3:z1',
      detail: { opp_id: 'C3', priority: 'P2', delivered: true, text: 'leads ran out' } },
    // 8 the automated test card → hidden
    { at: '2026-10-06T09:30:00Z', user_id: U.cb207, username: 'cb207', role: 'team_leader', event: 'cm_request', category: 'other', team_leader: RP, campaign: 'Cuddle', topic: 'other',
      detail: { opp_id: 'Hlynw1DovYIRh7I01Tt6', delivered: true, text: 'TEST' } }]);

  const h = await q(A, 'select at_sast::text, day::text, week::text, month::text, agent_name, agent_cb, team, team_leader, campaign, category, topic, question, delivered, current_stage from help_asks_detail order by at_sast');
  ok(h.length === 3, 'help_asks_detail: one row per real help ask (the Test message ask and the test account are not there)', h.map((r) => r.question));
  const h1 = h.find((r) => r.question === 'please listen to my 10am call') || {};
  ok(h1.agent_name === 'Nothando Mntungwa' && h1.agent_cb === 'CB162' && h1.team === D && h1.team_leader === D && h1.campaign === 'Courtesy' && h1.topic === 'Review my call'
    && h1.delivered === true && h1.current_stage === 'In progress' && h1.at_sast.startsWith('2026-10-06 10:00') && h1.day === '2026-10-06' && h1.week === '2026-10-05' && h1.month === '2026-10-01',
    'a live ask: name, CB, team, TL, campaign, topic label, the question, SA time, periods, the card\'s current stage', h1);
  const h2 = h.find((r) => r.question === 'can I put this call through') || {};
  ok(h2.agent_name === 'Jamie Lee Chetty' && h2.agent_cb === 'CB245' && h2.team === D && h2.team_leader === D && h2.current_stage === 'New',
    'a HighLevel-backfilled ask: the account found by the CB on the card → today\'s name and team', h2);
  const h3 = h.find((r) => r.question === 'what does the upgrade cover') || {};
  ok(h3.agent_name === 'cb500' && h3.agent_cb === 'CB500' && h3.team === 'Sharoma Rampersad' && h3.team_leader === 'Sharoma Rampersad' && h3.delivered === false && h3.current_stage === 'Not delivered',
    'a leaver (no account): the username and its CB still show, the TL recorded with the ask', h3);
  const sel = await q(A, "select agent_name, team_leader from help_asks_detail where month = '2026-10-01' and topic = 'Review my call'");
  ok(sel.length === 1 && sel[0].agent_name === 'Nothando Mntungwa', 'SC-001: "who asked about Review my call this month, and their TL" is one SELECT', sel);

  const c = await q(A, 'select at_sast::text, month::text, tl_name, tl_cb, tl_team, campaign, campaign_manager, handled_by, blockage, topic, request, delivered, status from cm_requests_detail order by at_sast');
  ok(c.length === 3 && !c.some((r) => r.request === 'TEST'), 'cm_requests_detail: one row per real request (the test card is not there)', c.map((r) => r.request));
  const c1 = c.find((r) => r.request === 'the dialler drops calls') || {};
  ok(c1.tl_name === RP && c1.tl_cb === 'CB207' && c1.tl_team === RP && c1.campaign === 'Cuddle' && c1.campaign_manager === 'Ryan G' && c1.handled_by === 'Dalwin Callaghan'
    && c1.blockage === 'dialler' && c1.topic === 'Dialler problems' && c1.status === 'Assisting' && c1.delivered === true,
    'a live request: the TL\'s name, CB, team; cms named all three CMs → the TL\'s manager on record; who handled it; status', c1);
  const c2 = c.find((r) => r.request === 'no leads loaded') || {};
  ok(c2.campaign_manager === 'Preshen Naidoo' && c2.tl_cb === 'CB267' && c2.status === 'New', 'cms named exactly one campaign manager → that one (by full name)', c2);
  const c3 = c.find((r) => r.request === 'leads ran out') || {};
  ok(c3.tl_name === 'Old Leader' && c3.tl_cb === 'CB999' && c3.campaign_manager === 'Ryan G' && c3.month === '2026-09-01', 'a backfilled request whose TL has no account: name, CB and CM from team_leader_cbs', c3);

  const mt = await q(A, "select topic, label, asks, askers, asked_by, rank from most_asked_topics where grain = 'month' and period_start = '2026-10-01' and source = 'all' order by rank, topic");
  const rc = mt.find((r) => r.topic === 'call_review') || {};
  ok(rc.asks === 1 && rc.askers === 1 && JSON.stringify(rc.asked_by) === JSON.stringify(['Nothando Mntungwa (CB162) · Team Denise Haripersad · TL Denise Haripersad']),
    'most_asked_topics.asked_by: "Name (CB) · Team · TL" for help asks; the test account is not among them', rc);
  const dl = mt.find((r) => r.topic === 'dialler') || {};
  ok(JSON.stringify(dl.asked_by) === JSON.stringify(['Renolan Pillay (CB207) · Team Renolan Pillay · CM Ryan G']), '…and "Name (CB) · Team · CM" for CM requests', dl);
  const pr = mt.find((r) => r.topic === 'product') || {};
  ok(JSON.stringify(pr.asked_by) === JSON.stringify(['cb500 (CB500) · Team Sharoma Rampersad · TL Sharoma Rampersad']), 'a leaver still shows in asked_by', pr);
  const cols = (await q(A, "select column_name from information_schema.columns where table_name = 'most_asked_topics' order by ordinal_position")).map((r) => r.column_name);
  ok(JSON.stringify(cols) === JSON.stringify(['grain', 'period_start', 'source', 'topic', 'label', 'asks', 'askers', 'examples', 'categories', 'rank', 'asked_by']), 'most_asked_topics keeps every 029 column, asked_by appended', cols);
  await A.query("insert into usage_events (at, user_id, username, role, event, category, team_leader, campaign, detail, topic) values ('2026-10-09T08:00:00Z', $1, 'cb162', 'agent', 'help_ask', 'Review my call', $2, 'Courtesy', '{\"note\":\"again\",\"delivered\":true}', 'call_review')", [U.cb162, D]);
  const rc2 = (await q(A, "select asks, askers, asked_by from most_asked_topics where grain = 'month' and period_start = '2026-10-01' and source = 'help' and topic = 'call_review'")).at(0) || {};
  ok(rc2.asks === 2 && rc2.askers === 1 && rc2.asked_by.length === 1, 'the same person asking twice: 2 asks, 1 asker, listed once', rc2);

  const VIEWS = ['ask_askers', 'help_asks_detail', 'cm_requests_detail'];
  for (const role of ['anon', 'authenticated']) {
    let all = true; for (const v of VIEWS.concat(['most_asked_topics'])) if (!(await denied(A, role, 'select * from ' + v))) { all = false; ok(false, role + ' reads ' + v); }
    ok(all, role + ' reads none of the 030 views');
  }
  await A.exec('set role service_role');
  let svc = true; try { for (const v of VIEWS.concat(['most_asked_topics', 'ask_event_periods'])) await A.query('select * from ' + v + ' limit 1'); } catch (e) { svc = String(e.message); }
  await A.exec('reset role');
  ok(svc === true, 'service_role reads them', svc);
  const vopt = await q(A, "select relname, reloptions from pg_class where relkind = 'v' and relname = any($1)", [VIEWS]);
  ok(vopt.length === VIEWS.length && vopt.every((v) => (v.reloptions || []).includes('security_invoker=true')), 'every 030 view is security_invoker', vopt);
  const defs = await q(A, "select viewname, definition from pg_views where viewname = any($1)", [VIEWS.concat(['ask_events'])]);
  ok(defs.every((d) => !/\busage_events\b(?!_real)/.test(d.definition)), 'built on usage_events_real (test traffic stays hidden)', defs.filter((d) => /\busage_events\b(?!_real)/.test(d.definition)).map((d) => d.viewname));
}

head('B · registered in verify.yml');
ok(/verify-usage-030/.test(read('.github/workflows/verify.yml')), 'verify.yml runs verify-usage-030');

console.log('\n' + (fail ? 'FAIL' : 'PASS') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
