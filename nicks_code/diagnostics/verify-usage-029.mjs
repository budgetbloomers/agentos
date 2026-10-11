#!/usr/bin/env node
/* verify-usage-029.mjs — WHO ASKS FOR HELP, AND WHAT THEY ASK MOST (Spec Kit 029, 2026-10-11).
 *
 * Nick: "we also want to monitor, how many agents ask their team leader for help, how many team leaders asked their cm
 * for help, what was the most asked question".
 *
 *   A · migration-062 VERBATIM in PGlite on top of 061: topic column, ask_topics seed, merges + renames move every count,
 *       every report view's distinct counts per day / week / month, TL, campaign, campaign manager; lockdown
 *   B · worker/src/topics.mjs: pre-labels, the prompt, the answer checked against the list, timeout, NULL on failure, cache
 *   C · the REAL Worker in-process: a CM request keeps the TL's words (never a restricted one's); the label runs in
 *       waitUntil, never changes the answer, junk → other, AI throwing / hanging → NULL; ≤ 2 extra subrequests
 *   D · tools/usage-topics.mjs: dry writes nothing, apply labels everything unlabelled, idempotent, the REST shim
 *   E · tools/usage-backfill.mjs + the Campaign Assistance pipeline: the TL's words attach once, note-only rounds come
 *       back, a second run adds 0, HighLevel only read
 *   F · registered in verify.yml
 *
 *   node nicks_code/diagnostics/verify-usage-029.mjs      (no network, no credentials)
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { ROOT, newDb, restFetch, readSql, applyMigration } from './usage-028-harness.mjs';

const M062 = 'migration-062-help-asks-and-topics.sql';
const R = (rel) => path.join(ROOT, ...rel.split('/'));
const read = (rel) => (fs.existsSync(R(rel)) ? fs.readFileSync(R(rel), 'utf8').replace(/\r\n/g, '\n') : '');
const imp = async (rel) => import(pathToFileURL(R(rel)).href).catch((e) => ({ __error: String(e && e.message || e) }));
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m + (d !== undefined ? ' — ' + (typeof d === 'string' ? d : JSON.stringify(d)) : '')); } };
const head = (t) => console.log('\n' + t);
const q = async (db, sql, args) => (await db.query(sql, args || [])).rows;
const denied = async (db, role, sql) => { try { await db.exec(`set role ${role}`); await db.query(sql); return false; } catch (e) { return /permission denied/.test(String(e.message)); } finally { await db.exec('reset role'); } };
const J = (b, s = 200) => new Response(b === undefined ? '' : JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

const U = { nick: '00000000-0000-4000-8000-000000000001', cb162: '00000000-0000-4000-8000-000000000162', cb245: '00000000-0000-4000-8000-000000000245',
  cb90: '00000000-0000-4000-8000-000000000090', cb267: '00000000-0000-4000-8000-000000000267', cb207: '00000000-0000-4000-8000-000000000207',
  dalwin: '00000000-0000-4000-8000-000000000145', ryan: '00000000-0000-4000-8000-000000000146' };
const PEOPLE = [['nick', 'admin', null, 'Nick', null], ['cb162', 'agent', 'CB162', 'Nothando Mntungwa', null], ['cb245', 'agent', 'CB245', 'Jamie Lee Chetty', null],
  ['cb90', 'agent', 'CB90', 'Thalente Xaba', null], ['cb267', 'team_leader', 'CB267', 'Denise Haripersad', 'Denise Haripersad'],
  ['cb207', 'team_leader', 'CB207', 'Renolan Pillay', 'Renolan Pillay'], ['dalwin', 'campaign_manager', 'CB145', 'Dalwin Callaghan', null], ['ryan', 'campaign_manager', 'CB146', 'Ryan G', null]];
const seedUsers = async (db) => { for (const [u, role, cb, name, team] of PEOPLE)
  await db.query('insert into app_users (id, username, full_name, password_hash, role, cb, team) values ($1,$2,$3,$4,$5,$6,$7)', [U[u], u, name, 'x', role, cb, team]); };
/* Supabase's default privileges give service_role every table in public (the Worker reads rules with the service key);
   the bare PGlite baseline does not, and most_asked_categories reads cm:blockages from rules as its invoker. */
const newDb62 = async (opts = {}) => { const db = await newDb({ before: seedUsers, ...opts }); await db.exec('grant select on rules to service_role'); await applyMigration(db, M062); return db; };
const ins = async (db, rows) => { for (const r of rows) await db.query(
  'insert into usage_events (at, user_id, username, role, app, event, category, team_leader, campaign, detail, source, source_key, topic) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
  [r.at, r.user_id || null, r.username || null, r.role || null, r.app || 'agent', r.event, r.category || null, r.team_leader || null, r.campaign || null,
    r.detail ? JSON.stringify(r.detail) : null, r.source || 'worker', r.source_key || null, r.topic || null]); };
const MONTH = "period_start = '2026-10-01' and grain = 'month'";

/* ═══════════════════════ A · THE MIGRATION, FOR REAL ═══════════════════════ */
head('A · migration-062 in PGlite — topics, merges, the report views, lockdown');
const sql62 = readSql(M062);
ok(!!sql62, 'supabase/' + M062 + ' exists');
let A = null;
if (sql62) {
  try { A = await newDb62(); ok(true, 'migration-062 applies on top of migration-061'); } catch (e) { ok(false, 'migration-062 applies', String(e.message)); }
  if (A) {
    try { await applyMigration(A, M062); ok(true, 'and applies a SECOND time (re-runnable)'); } catch (e) { ok(false, 're-runnable', String(e.message)); }
    const cols = (await q(A, "select column_name from information_schema.columns where table_name = 'usage_events'")).map((r) => r.column_name);
    ok(cols.includes('topic'), 'usage_events has a topic column');
    const tcols = (await q(A, "select column_name from information_schema.columns where table_name = 'ask_topics'")).map((r) => r.column_name);
    ok(['topic', 'label', 'hint', 'merged_into', 'active', 'created_at'].every((c) => tcols.includes(c)), 'ask_topics has topic, label, hint, merged_into, active, created_at', tcols);
    const seed = await q(A, 'select topic, label, active from ask_topics order by topic');
    ok(seed.length >= 10 && seed.length <= 20 && seed.every((s) => s.active), 'the seed holds 10–20 active topics (' + seed.length + ')', seed.map((s) => s.topic));
    for (const t of ['other', 'test', 'personal', 'call_review', 'quality_score', 'product', 'what_to_say', 'dialler', 'leads_data'])
      ok(seed.some((s) => s.topic === t), 'seed topic ' + t);
    ok(seed.every((s) => s.label.split(/\s+/).length <= 5), 'every label is short (≤ 5 words)', seed.filter((s) => s.label.split(/\s+/).length > 5));
    // a rename survives a re-run of the migration
    await A.query("update ask_topics set label = 'Renamed for the test' where topic = 'dialler'");
    await applyMigration(A, M062);
    ok((await q(A, "select label from ask_topics where topic = 'dialler'")).at(0).label === 'Renamed for the test', 're-running the migration never undoes Nick\'s rename (seed is ON CONFLICT DO NOTHING)');
    await A.query("update ask_topics set label = 'Dialler problems' where topic = 'dialler'");
    let selfMerge = false; try { await A.query("update ask_topics set merged_into = 'other' where topic = 'other'"); } catch (e) { selfMerge = true; }
    ok(selfMerge, 'a topic cannot be merged into itself');
    let badMerge = false; try { await A.query("update ask_topics set merged_into = 'no_such_topic' where topic = 'test'"); } catch (e) { badMerge = true; }
    ok(badMerge, 'merged_into must name a topic that exists');

    await A.query("insert into rules (key, value) values ('cm:blockages', $1)", [JSON.stringify([{ key: 'dialler', label: 'Dialler' }, { key: 'leads', label: 'Leads or data' }, { key: 'personal', label: 'Personal or private' }])]);
    const ag = (u, tl, camp) => ({ user_id: U[u], username: u, role: 'agent', team_leader: tl, campaign: camp });
    const tl = (u, name, camp) => ({ user_id: U[u], username: u, role: 'team_leader', team_leader: name, campaign: camp });
    const D = 'Denise Haripersad', S = 'Sharoma Rampersad', RP = 'Renolan Pillay';
    await ins(A, [
      { at: '2026-10-05T08:00:00Z', ...ag('cb162', D, 'Courtesy'), event: 'help_ask', category: 'Review my call', detail: { note: 'please listen to my call', delivered: true, opp_id: 'H1', cb: 'CB162', agent_name: 'Nothando Mntungwa' }, topic: 'call_review' },
      { at: '2026-10-06T08:00:00Z', ...ag('cb162', D, 'Courtesy'), event: 'help_ask', category: 'Review my call', detail: { note: 'listen to the 10am call', delivered: true, opp_id: 'H1', cb: 'CB162', agent_name: 'Nothando Mntungwa' }, topic: 'call_review' },
      { at: '2026-10-06T09:00:00Z', ...ag('cb162', D, 'Courtesy'), event: 'help_ask', category: 'Explain my quality result', detail: { note: 'why is my QA 60', delivered: false, error: 'HighLevel down', cb: 'CB162', agent_name: 'Nothando Mntungwa' }, topic: 'quality_score' },
      { at: '2026-10-06T10:00:00Z', ...ag('cb245', D, 'Courtesy'), event: 'help_ask', category: 'Review my call', detail: { note: 'can I put this call through', delivered: true, opp_id: 'H2', cb: 'CB245', agent_name: 'Jamie Lee Chetty' }, topic: 'call_review' },
      { at: '2026-10-11T22:30:00Z', ...ag('cb90', S, 'Cuddle'), event: 'help_ask', category: 'Explain what to say', detail: { note: 'help me close', delivered: true, opp_id: 'H3', cb: 'CB90', agent_name: 'Thalente Xaba' }, topic: 'closing_objections' },
      { at: '2026-10-13T08:00:00Z', ...ag('cb90', S, 'Cuddle'), event: 'help_ask', category: 'Something else', detail: { note: 'xyz', delivered: true, opp_id: 'H3', cb: 'CB90', agent_name: 'Thalente Xaba' } },
      { at: '2026-09-30T08:00:00Z', ...ag('cb162', D, 'Courtesy'), event: 'help_ask', category: 'Explain my quality result', detail: { note: 'qa again', delivered: true, opp_id: 'H0', cb: 'CB162' }, topic: 'quality_score' },
      // TL → CM
      { at: '2026-10-05T09:00:00Z', ...tl('cb207', RP, 'Cuddle'), event: 'cm_request', category: 'dialler', detail: { opp_id: 'C1', priority: 'P1', restricted: false, delivered: true, text: 'dialler drops calls' }, topic: 'dialler', source_key: 'cm-req:C1:1' },
      { at: '2026-10-05T09:10:00Z', user_id: U.dalwin, username: 'dalwin', role: 'campaign_manager', event: 'cm_action', category: 'acknowledge', team_leader: RP, campaign: 'Cuddle', detail: { opp_id: 'C1', actor: 'Dalwin Callaghan' } },
      { at: '2026-10-05T09:30:00Z', ...tl('cb207', RP, 'Cuddle'), event: 'cm_request', category: 'dialler', detail: { opp_id: 'C1', merged: true, delivered: true, text: 'still dropping' }, topic: 'dialler' },
      { at: '2026-10-06T09:00:00Z', ...tl('cb267', D, 'Courtesy'), event: 'cm_request', category: 'leads', detail: { opp_id: 'C2', priority: 'P2', delivered: true, text: 'no leads loaded' }, topic: 'leads_data' },
      { at: '2026-10-06T09:05:00Z', ...tl('cb267', D, 'Courtesy'), event: 'cm_action', category: 'acknowledge', detail: { opp_id: 'C2', actor: D } },
      { at: '2026-10-06T09:20:00Z', user_id: U.ryan, username: 'ryan', role: 'campaign_manager', event: 'cm_action', category: 'start', team_leader: D, campaign: 'Courtesy', detail: { opp_id: 'C2', actor: 'Ryan G', started: true } },
      { at: '2026-10-07T09:00:00Z', ...tl('cb267', D, 'Courtesy'), event: 'cm_request', category: 'leads', detail: { priority: 'P3', delivered: false, error: 'HighLevel /opportunities/ → 500', text: 'leads again' }, topic: 'leads_data' },
      { at: '2026-10-08T09:00:00Z', ...tl('cb207', RP, 'Cuddle'), event: 'cm_request', category: 'personal', detail: { opp_id: 'C4', priority: 'P3', restricted: true, delivered: true }, topic: 'personal' },
    ]);
    const hp = await q(A, `select askers, asks, delivered, not_delivered from help_askers_by_period where ${MONTH}`);
    ok(hp.length === 1 && hp[0].askers === 3 && hp[0].asks === 6 && hp[0].delivered === 5 && hp[0].not_delivered === 1,
      'help_askers_by_period (month): 3 distinct agents asked, 6 asks, 5 delivered, 1 not — "how many agents asked their TL this month" is one SELECT', hp);
    const hw = await q(A, "select period_start::text p, askers, asks from help_askers_by_period where grain = 'week' and period_start between '2026-10-01' and '2026-10-31' order by 1");
    ok(JSON.stringify(hw) === JSON.stringify([{ p: '2026-10-05', askers: 2, asks: 4 }, { p: '2026-10-12', askers: 1, asks: 2 }]),
      'weeks start on Monday (SAST): 22:30Z on Sunday 11 Oct is Monday 12 Oct in Johannesburg', hw);
    const hd = await q(A, "select askers, asks from help_askers_by_period where grain = 'day' and period_start = '2026-10-06'");
    ok(hd.length === 1 && hd[0].askers === 2 && hd[0].asks === 3, 'day grain: 6 Oct — 2 agents, 3 asks', hd);
    const htl = await q(A, `select team_leader, askers, asks from help_askers_by_tl where ${MONTH} order by asks desc`);
    ok(JSON.stringify(htl) === JSON.stringify([{ team_leader: D, askers: 2, asks: 4 }, { team_leader: S, askers: 1, asks: 2 }]), 'help_askers_by_tl: distinct agents and asks per team leader', htl);
    const hc = await q(A, `select campaign, askers, asks from help_askers_by_campaign where ${MONTH} order by campaign`);
    ok(JSON.stringify(hc) === JSON.stringify([{ campaign: 'Courtesy', askers: 2, asks: 4 }, { campaign: 'Cuddle', askers: 1, asks: 2 }]), 'help_askers_by_campaign', hc);
    const top = await q(A, `select asker, agent_name, asks, rank from help_top_askers where ${MONTH} order by rank, asker`);
    ok(top.length === 3 && top[0].asker === 'cb162' && top[0].asks === 3 && top[0].rank === 1 && top[0].agent_name === 'Nothando Mntungwa' && top[1].asker === 'cb90' && top[2].asks === 1,
      'help_top_askers: the agents who ask most, ranked', top);
    const cp = await q(A, `select team_leaders, requests, delivered, not_delivered, duplicates_merged from cm_askers_by_period where ${MONTH}`);
    ok(cp.length === 1 && cp[0].team_leaders === 2 && cp[0].requests === 4 && cp[0].delivered === 3 && cp[0].not_delivered === 1 && cp[0].duplicates_merged === 1,
      'cm_askers_by_period (month): 2 TLs asked, 4 requests (3 delivered, 1 not), 1 merged duplicate — "how many TLs asked a CM this month" is one SELECT', cp);
    const cm = await q(A, `select campaign, campaign_manager, team_leaders, requests from cm_askers_by_cm where ${MONTH} order by campaign, campaign_manager`);
    ok(JSON.stringify(cm) === JSON.stringify([
      { campaign: 'Courtesy', campaign_manager: 'Not delivered', team_leaders: 1, requests: 1 },
      { campaign: 'Courtesy', campaign_manager: 'Ryan G', team_leaders: 1, requests: 1 },
      { campaign: 'Cuddle', campaign_manager: 'Dalwin Callaghan', team_leaders: 1, requests: 1 },
      { campaign: 'Cuddle', campaign_manager: 'Not picked up yet', team_leaders: 1, requests: 1 }]),
      'cm_askers_by_cm: the CM is whoever first acted on it who is not the asking TL; never picked up / not delivered are named', cm);
    const mt = await q(A, `select topic, label, asks, askers, examples, rank from most_asked_topics where ${MONTH} and source = 'all' order by rank, topic`);
    const byT = Object.fromEntries(mt.map((r) => [r.topic === null ? '∅' : r.topic, r]));
    ok(mt[0] && mt[0].topic === 'call_review' && mt[0].asks === 3 && mt[0].askers === 2 && mt[0].rank === 1, 'most_asked_topics: Review my call is the most asked this month (3 asks, 2 people)', mt[0]);
    ok(byT.call_review && JSON.stringify(byT.call_review.examples) === JSON.stringify(['can I put this call through', 'listen to the 10am call', 'please listen to my call']),
      'up to 3 example questions, newest first', byT.call_review && byT.call_review.examples);
    ok(byT.dialler && byT.dialler.asks === 2 && byT.leads_data && byT.leads_data.asks === 2 && byT.personal && byT.personal.asks === 1 && (byT.personal.examples || []).length === 0,
      'TL → CM requests count in the same ranking (a merged duplicate is still an ask); a restricted request has no example', [byT.dialler, byT.personal]);
    ok(byT['∅'] && byT['∅'].label === 'Not labelled yet' && byT['∅'].asks === 1, 'an unlabelled ask reads "Not labelled yet", never "Other" (absence is not a value)', byT['∅']);
    const src = await q(A, `select source, sum(asks)::int n from most_asked_topics where ${MONTH} group by 1 order by 1`);
    ok(JSON.stringify(src) === JSON.stringify([{ source: 'all', n: 11 }, { source: 'cm', n: 5 }, { source: 'help', n: 6 }]), 'help and CM are ranked separately AND combined', src);
    // merges + renames move every past count
    await A.query("update ask_topics set merged_into = 'what_to_say', active = false where topic = 'closing_objections'");
    await A.query("update ask_topics set merged_into = 'call_review', active = false where topic = 'what_to_say'");
    await A.query("update ask_topics set label = 'Listen to my call' where topic = 'call_review'");
    const eff = (await q(A, "select effective_topic, effective_label, hops from ask_topic_effective where topic = 'closing_objections'")).at(0) || {};
    ok(eff.effective_topic === 'call_review' && eff.hops === 2 && eff.effective_label === 'Listen to my call', 'ask_topic_effective follows a merge chain (closing → what to say → call review)', eff);
    const mt2 = (await q(A, `select label, asks, askers from most_asked_topics where ${MONTH} and source = 'all' and topic = 'call_review'`)).at(0) || {};
    ok(mt2.asks === 4 && mt2.askers === 3 && mt2.label === 'Listen to my call', 'after the merge + rename, the merged ask counts under the surviving topic with its new name', mt2);
    ok((await q(A, `select count(*)::int n from most_asked_topics where ${MONTH} and topic in ('closing_objections', 'what_to_say')`)).at(0).n === 0, 'merged topics no longer appear as rows of their own');
    await A.query("insert into ask_topics (topic, label) values ('loop_a', 'Loop A'), ('loop_b', 'Loop B')");
    await A.query("update ask_topics set merged_into = 'loop_b' where topic = 'loop_a'"); await A.query("update ask_topics set merged_into = 'loop_a' where topic = 'loop_b'");
    let loopOk = true; try { await q(A, 'select * from ask_topic_effective'); } catch (e) { loopOk = String(e.message); }
    ok(loopOk === true, 'a merge cycle does not hang or break the view', loopOk);
    await A.query("update ask_topics set merged_into = null where topic in ('loop_a', 'loop_b')"); await A.query("delete from ask_topics where topic in ('loop_a', 'loop_b')");
    const cats = await q(A, `select source, category, label, asks, askers from most_asked_categories where ${MONTH} and source in ('help', 'cm') order by source, asks desc, category`);
    const rc = cats.find((c) => c.source === 'help' && c.category === 'Review my call');
    const dc = cats.find((c) => c.source === 'cm' && c.category === 'dialler');
    ok(rc && rc.asks === 3 && rc.askers === 2 && dc && dc.asks === 2 && dc.label === 'Dialler', 'most_asked_categories: help categories and CM blockages (with the blockage label from cm:blockages)', cats);
    const ae = await q(A, "select source, text, topic_label from ask_events where month = '2026-10-01' and source = 'cm' and not merged order by at");
    ok(ae.length === 4 && ae[0].text === 'dialler drops calls' && ae[3].text === null, 'ask_events: one row per ask, the CM request\'s words readable', ae);
    // service_role may set a topic, and nothing else
    await A.exec('set role service_role');
    let topicUpd = true; try { await A.query("update usage_events set topic = 'other' where topic is null and event = 'help_ask'"); } catch (e) { topicUpd = String(e.message); }
    let otherUpd = false; try { await A.query("update usage_events set category = 'x'"); } catch (e) { otherUpd = /permission denied/.test(e.message); }
    let del = false; try { await A.query('delete from usage_events'); } catch (e) { del = /permission denied/.test(e.message); }
    const VIEWS = ['ask_topic_effective', 'ask_events', 'help_askers_by_period', 'help_askers_by_tl', 'help_askers_by_campaign', 'help_top_askers', 'cm_askers_by_period',
      'cm_askers_by_cm', 'most_asked_topics', 'most_asked_categories'];
    let svc = true; try { for (const v of VIEWS) await A.query('select * from ' + v + ' limit 1'); await A.query('select * from ask_topics'); } catch (e) { svc = String(e.message); }
    await A.exec('reset role');
    ok(topicUpd === true && otherUpd && del, 'service_role may set a topic — and still may not change any other column, or delete', { topicUpd, otherUpd, del });
    ok(svc === true, 'service_role reads every 029 view and ask_topics', svc);
    for (const role of ['anon', 'authenticated']) {
      ok(await denied(A, role, 'select * from ask_topics'), role + ' cannot read ask_topics');
      ok(await denied(A, role, "update ask_topics set label = 'x'"), role + ' cannot rename a topic');
      ok(await denied(A, role, "update usage_events set topic = 'x'"), role + ' cannot label an ask');
      ok(await denied(A, role, "select usage_attach_cm_text('k', 't', null)"), role + ' cannot run usage_attach_cm_text');
      let all = true; for (const v of VIEWS) if (!(await denied(A, role, 'select * from ' + v))) { all = false; ok(false, role + ' reads ' + v); }
      ok(all, role + ' reads none of the ' + VIEWS.length + ' new views');
    }
    ok((await q(A, "select relrowsecurity from pg_class where relname = 'ask_topics'")).at(0).relrowsecurity === true, 'RLS is on for ask_topics');
    const vopt = await q(A, "select relname, reloptions from pg_class where relkind = 'v' and relname = any($1)", [VIEWS]);
    ok(vopt.length === VIEWS.length && vopt.every((v) => (v.reloptions || []).includes('security_invoker=true')), 'every 029 view is security_invoker', vopt.map((v) => v.relname));
    const fn = await q(A, "select p.proconfig, has_function_privilege('anon', p.oid, 'execute') a, has_function_privilege('authenticated', p.oid, 'execute') au, has_function_privilege('service_role', p.oid, 'execute') s from pg_proc p where p.proname = 'usage_attach_cm_text'");
    ok(fn.length === 1 && !fn[0].a && !fn[0].au && fn[0].s && (fn[0].proconfig || []).some((c) => /^search_path=public/.test(c)), 'usage_attach_cm_text: service_role only, search_path pinned', fn);
    // the attach function: fills once, never restricted
    await ins(A, [{ at: '2026-10-09T09:00:00Z', event: 'cm_request', category: 'leads', detail: { opp_id: 'C9', delivered: true }, source_key: 'cm-req:C9:1' },
      { at: '2026-10-09T09:00:00Z', event: 'cm_request', category: 'personal', detail: { opp_id: 'C8', delivered: true, restricted: true }, source_key: 'cm-req:C8:1' }]);
    const a1 = (await q(A, "select usage_attach_cm_text('cm-req:C9:1', 'first words', 'impact') r")).at(0).r;
    const a2 = (await q(A, "select usage_attach_cm_text('cm-req:C9:1', 'second words', null) r")).at(0).r;
    const a3 = (await q(A, "select usage_attach_cm_text('cm-req:C8:1', 'never', null) r")).at(0).r;
    const c9 = (await q(A, "select detail from usage_events where source_key = 'cm-req:C9:1'")).at(0).detail;
    ok(a1 === true && a2 === false && a3 === false && c9.text === 'first words' && c9.impact === 'impact' && c9.opp_id === 'C9', 'usage_attach_cm_text fills the words ONCE and never on a restricted request', { a1, a2, a3, c9 });
  }
}

/* ═══════════════════════ B · worker/src/topics.mjs ═══════════════════════ */
head('B · topics.mjs — pre-labels, prompt, validation, failure');
const T = await imp('worker/src/topics.mjs');
ok(!T.__error, 'worker/src/topics.mjs imports', T.__error);
const TOPICS = [['call_review', 'Review my call'], ['quality_score', 'Quality score (QA)'], ['product', 'Product questions'], ['personal', 'Personal matter'],
  ['test', 'Test message'], ['other', 'Other']].map(([topic, label]) => ({ topic, label, hint: 'hint for ' + label }));
if (!T.__error) {
  ok(T.TOPIC_CACHE_MS === 600000, 'the topic list is cached per isolate for 10 minutes');
  const pl = (text, o = {}) => T.preLabel({ text, ...o }, TOPICS);
  ok(pl('anything', { restricted: true }) === 'personal', 'a restricted CM request → personal, without the AI');
  ok(pl('') === 'other' && pl('  ') === 'other' && pl('hi') === 'other' && pl('??') === 'other', 'empty / under 3 letters → other');
  for (const t of ['test', 'testing', 'TEST from the system check on 2026-09-15T08:35 — please ignore', 'AUTOMATED TEST 1 of 2 — please ignore, it closes itself', 'Hi \n\nTest', 'testing with throughballs'])
    ok(pl(t) === 'test', 'an obvious test → test: ' + JSON.stringify(t.slice(0, 40)));
  ok(pl('please listen to my call') === null && pl('help me move past my introduction') === null && pl('my latest test score is wrong') === null, 'a real question goes to the AI (no pre-label)');
  const p = T.buildPrompt('why is my QA 60 ' + 'x'.repeat(2000), 'Explain my quality result', TOPICS.concat([{ topic: 'gone', label: 'Inactive One', active: false }]).filter((t) => t.active !== false));
  ok(p && TOPICS.every((t) => p.system.includes(t.label) || p.user.includes(t.label)) && !(p.system + p.user).includes('Inactive One'), 'the prompt lists every active topic (and no inactive one)');
  ok(p && /exactly|only/i.test(p.system) && /Other/.test(p.system), 'the prompt demands exactly one topic from the list, or Other');
  ok(p && p.user.includes('Explain my quality result') && p.user.length < 1600, 'the prompt carries the category and at most ~600 characters of the question', p && p.user.length);
  const v = (a) => T.validateTopic(a, TOPICS);
  ok(v('Review my call') === 'call_review' && v('"review my call."') === 'call_review' && v('Topic: Quality score (QA)') === 'quality_score' && v('product') === 'product',
    'the answer is matched to the list (case, quotes, full stop and a "Topic:" prefix ignored; a slug is accepted)');
  ok(v('I think it is about calls') === 'other' && v('') === 'other' && v(null) === 'other' && v('Sales strategy') === 'other', 'anything not on the list → other');
  const mk = (fn) => { const calls = []; return { calls, env: { AI: { run: async (model, input) => { calls.push({ model, input }); return fn(model, input, calls.length); } } } }; };
  let s = mk(() => ({ response: 'Quality score (QA)' }));
  ok(await T.labelAsk(s.env, 'why is my QA 60', 'Explain my quality result', TOPICS, { models: ['m1', 'm2'] }) === 'quality_score' && s.calls.length === 1 && s.calls[0].model === 'm1',
    'labelAsk: the AI picks one topic from the list (first model)', s.calls.map((c) => c.model));
  ok(s.calls[0] && s.calls[0].input.max_tokens <= 16 && Array.isArray(s.calls[0].input.messages), 'the AI call is small (max_tokens ≤ 16)');
  s = mk(() => ({ response: 'Weather and sport' }));
  ok(await T.labelAsk(s.env, 'something odd', 'Something else', TOPICS, { models: ['m1', 'm2'] }) === 'other', 'junk from the AI → other');
  s = mk((m, i, n) => { if (n === 1) throw new Error('model unavailable'); return { response: 'Product questions' }; });
  ok(await T.labelAsk(s.env, 'how do I pitch the upgrade', 'Explain the product', TOPICS, { models: ['m1', 'm2'] }) === 'product' && s.calls.length === 2 && s.calls[1].model === 'm2',
    'the first model failing → the fallback model, as /api/ask does');
  s = mk(() => { throw new Error('boom'); });
  ok(await T.labelAsk(s.env, 'how do I pitch the upgrade', 'x', TOPICS, { models: ['m1', 'm2'] }) === null && s.calls.length === 2, 'both models failing → null (left for the label tool), never "other"');
  s = mk(() => { throw new Error('4006: you have used up your daily free allocation of 10,000 neurons'); });
  ok(await T.labelAsk(s.env, 'how do I pitch the upgrade', 'x', TOPICS, { models: ['m1', 'm2'] }) === null && s.calls.length === 1, 'the daily allowance (4006) → null after ONE call (the fallback shares the allowance)');
  s = mk(() => new Promise(() => {}));
  const t0 = Date.now();
  const hung = await T.labelAsk(s.env, 'how do I pitch the upgrade', 'x', TOPICS, { models: ['m1', 'm2'], timeoutMs: 40 });
  ok(hung === null && Date.now() - t0 < 1000, 'a hanging AI times out → null', { hung, ms: Date.now() - t0 });
  ok(await T.labelAsk({}, 'how do I pitch the upgrade', 'x', TOPICS, {}) === null, 'no AI binding → null');
  s = mk(() => ({ response: 'Product questions' }));
  ok(await T.labelAsk(s.env, '', 'x', TOPICS, {}) === 'other' && s.calls.length === 0, 'a pre-labelled ask never calls the AI');
  // the cached topic list
  T.resetTopicCache();
  let reads = 0; const DBt = { select: async (p) => { reads++; return TOPICS.map((t) => ({ ...t })); } };
  const l1 = await T.activeTopics(DBt, 1_000_000); const l2 = await T.activeTopics(DBt, 1_000_000 + 599_000); const l3 = await T.activeTopics(DBt, 1_000_000 + 601_000);
  ok(l1 && l1.length === 6 && l2 && reads === 2, 'activeTopics: one read per isolate per 10 minutes', reads);
  T.resetTopicCache();
  const bad = await T.activeTopics({ select: async () => { throw new Error('down'); } }, 2_000_000);
  ok(bad === null, 'a failed topic read → null (no label), never a stale or invented list');
  // the labeller: PATCH by id, else by source_key, always topic=is.null; never rejects
  T.resetTopicCache();
  const patches = []; const DBl = { select: async () => TOPICS, update: async (p, b) => { patches.push([p, b]); } };
  const lab = T.askLabeller({ AI: { run: async () => ({ response: 'Review my call' }) } }, DBl, { models: ['m1'] });
  await lab({ id: 7, row: { event: 'help_ask', category: 'Review my call', detail: { note: 'listen to my call' } } });
  await lab({ id: null, row: { event: 'help_ask', category: 'Review my call', source_key: 'hl-help:X:1', detail: { note: 'listen to my call' } } });
  await lab({ id: null, row: { event: 'help_ask', category: 'Review my call', source_key: null, detail: { note: 'listen to my call' } } });
  ok(patches.length === 2 && patches[0][0] === 'usage_events?id=eq.7&topic=is.null' && patches[0][1].topic === 'call_review'
    && patches[1][0] === 'usage_events?source_key=eq.' + encodeURIComponent('hl-help:X:1') + '&topic=is.null', 'askLabeller: PATCH by id, else by source_key, only where topic is still NULL; no handle → no PATCH', patches);
  const cmPatch = []; const lab2 = T.askLabeller({ AI: { run: async () => { throw new Error('should not be called'); } } }, { select: async () => TOPICS, update: async (p, b) => cmPatch.push(b) }, { models: ['m1'] });
  await lab2({ id: 9, row: { event: 'cm_request', category: 'personal', detail: { restricted: true } } });
  ok(cmPatch.length === 1 && cmPatch[0].topic === 'personal', 'a restricted CM request is labelled personal with no AI call');
  let rejected = false;
  await T.askLabeller({ AI: { run: async () => ({ response: 'Other' }) } }, { select: async () => TOPICS, update: async () => { throw new Error('patch boom'); } }, {})({ id: 1, row: { event: 'help_ask', detail: { note: 'a real question here' } } }).catch(() => { rejected = true; });
  ok(!rejected, 'askLabeller never rejects (a failed PATCH is dropped)');
}

/* ═══════════════════════ C · THE REAL WORKER ═══════════════════════ */
head('C · the Worker in-process — CM words kept, the label after the answer, never in the way');
const UM = await imp('worker/src/usage.mjs');
const AUTH = await imp('worker/src/auth.mjs');
const worker = await imp('worker/src/index.mjs');
ok(!worker.__error && worker.default, 'worker/src/index.mjs imports', worker.__error);
if (worker.default && sql62 && !T.__error && !UM.__error) {
  const C = await newDb62(); const pg = restFetch(C);
  const sha = (x) => crypto.createHash('sha256').update(x).digest('hex');
  const DIGEST = { updatedAt: '2026-10-11T06:00:00Z', period: { from: '2026-10-01', to: '2026-10-31' }, diallingDays: 8, workingDays: 22, dates: [], weeks: [],
    agents: [
      { code: 'CB162', name: 'Nothando Mntungwa', tl: 'Denise Haripersad', campaign: 'Courtesy', sales: 10, target: 20, gwpEx: 990, gwpT: 1980, qa: 0.9, att: 1, act: 8, emp: 8, canc: 0, talk: 1000, ref: 0, composite: { r2a: { fails: 0 } } },
      { code: 'CB1', name: 'A One', tl: 'Renolan Pillay', campaign: 'Cuddle', sales: 10, target: 20, gwpEx: 990, gwpT: 1980, qa: 0.9, att: 1, act: 8, emp: 8, canc: 0, talk: 1000, ref: 0, composite: { r2a: { fails: 0 } } }],
    notCovered: [] };
  const PROFILE = { cb162: { role: 'agent', full_name: 'Nothando Mntungwa', cb: 'CB162', team: null }, cb267: { role: 'team_leader', full_name: 'Denise Haripersad', cb: 'CB267', team: 'Denise Haripersad' },
    cb207: { role: 'team_leader', full_name: 'Renolan Pillay', cb: 'CB207', team: 'Renolan Pillay' } };
  const appUser = (u) => ({ username: u, apps: ['ops', 'vas', 'tracker', 'agent'], tabs: null, pii_unmask: false, active: true, hub_ids: null, must_change_password: false, theme: null, ...PROFILE[u] });
  const SESS = {}; for (const u of Object.keys(PROFILE)) SESS[sha('tok-' + u)] = { user_id: U[u], expires_at: '2099-01-01T00:00:00Z', scope: 'full', app_users: appUser(u) };
  const RULES = { 'kv:agent-digest': { data: JSON.stringify(DIGEST) } };
  let CALLS = []; let USAGE_MODE = 'ok';
  const sb = async (u, method, opts) => {
    const t = u.pathname.replace('/rest/v1/', ''); const prm = u.searchParams; const body = opts.body ? JSON.parse(opts.body) : null;
    if (t === 'usage_events' || t === 'ask_topics') {
      if (t === 'usage_events' && method === 'POST' && USAGE_MODE === 'hang') return new Promise(() => {});
      return pg(u.href, opts);
    }
    if (t === 'app_sessions' && method === 'GET') { const m = /^eq\.(.*)$/.exec(prm.get('token_hash') || ''); const s = m && SESS[m[1]]; return J(s ? [s] : []); }
    if (t === 'rules' && method === 'GET') {
      const eq = /^eq\.(.*)$/.exec(prm.get('key') || ''); if (eq) return J(RULES[eq[1]] !== undefined ? [{ key: eq[1], value: RULES[eq[1]] }] : []);
      const lk = /^like\.(.*)\*$/.exec(prm.get('key') || ''); if (lk) return J(Object.keys(RULES).filter((k) => k.startsWith(lk[1])).map((k) => ({ key: k, value: RULES[k] })));
      return J([]);
    }
    if (t === 'rules' && method === 'POST') { for (const r of body) RULES[r.key] = r.value; return J(undefined, 201); }
    if (t === 'rules' && method === 'DELETE') { const eq = /^eq\.(.*)$/.exec(prm.get('key') || ''); if (eq) delete RULES[eq[1]]; return J(undefined, 204); }
    if (method === 'GET') return J([]);
    return J(undefined, method === 'POST' ? 201 : 204);
  };
  const HST = ['New', 'In progress', 'Waiting on agent', 'Closed'].map((name, i) => ({ id: 'h' + i, name, position: i }));
  const CST = ['New', 'Triaged', 'Assisting', 'Awaiting confirmation', 'Follow-up due', 'Closed'].map((name, i) => ({ id: 'c' + i, name, position: i }));
  const HL = { opps: [], notes: {}, n: 0, seq: 0, failCreate: false };
  const hl = async (u, method, opts) => {
    const p = u.pathname; const body = opts.body ? JSON.parse(opts.body) : null; const stamp = () => new Date(Date.now() + (HL.n++)).toISOString();
    if (p === '/opportunities/pipelines') return J({ pipelines: [{ id: 'pH', name: 'Agent Help Center', stages: HST }, { id: 'pC', name: 'Campaign Assistance', stages: CST }] });
    if (p === '/opportunities/search') { const ops = HL.opps.filter((o) => o.pipelineId === u.searchParams.get('pipeline_id')); return J({ opportunities: ops, meta: { total: ops.length } }); }
    if (p === '/opportunities/' && method === 'POST') {
      if (HL.failCreate) return J({ message: 'Internal error' }, 500);
      const t = stamp(); const o = { id: 'opp' + (++HL.seq), ...body, createdAt: t, updatedAt: t }; HL.opps.push(o); return J({ opportunity: o }, 201);
    }
    const m = /^\/contacts\/([^/]+)\/notes$/.exec(p);
    if (m) { const c = m[1]; HL.notes[c] = HL.notes[c] || []; if (method === 'POST') { const nt = { id: 'n' + (HL.n++), body: body.body, dateAdded: stamp() }; HL.notes[c].push(nt); return J({ note: nt }, 201); } return J({ notes: HL.notes[c] }); }
    if (p === '/contacts/' && method === 'POST') return J({ contact: { id: 'ct-' + body.firstName } }, 201);
    return J({ message: 'unhandled ' + method + ' ' + p }, 404);
  };
  globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
  globalThis.fetch = async (input, opts = {}) => {
    const u = new URL(String(input)); const method = String(opts.method || 'GET').toUpperCase();
    CALLS.push({ host: u.host, method, path: u.pathname, query: u.search });
    if (u.host === 'sb.test') return sb(u, method, opts);
    if (u.host === 'services.leadconnectorhq.com') return hl(u, method, opts);
    return new Response('', { status: 404 });
  };
  let AI_MODE = 'ok'; let AI_ANSWER = 'Product questions'; const AI_CALLS = [];
  const AI = { run: async (model, input) => { AI_CALLS.push({ model, input }); if (AI_MODE === 'throw') throw new Error('AI down'); if (AI_MODE === 'hang') return new Promise(() => {}); return { response: AI_ANSWER }; } };
  const ENV = { SUPABASE_URL: 'https://sb.test', SUPABASE_SECRET_KEY: 'svc', HL_HELP_API_KEY: 'k', HL_HELP_LOCATION_ID: 'locH', AI };
  const ENV_NOAI = { ...ENV, AI: undefined };
  const pending = []; const ctx = { waitUntil: (p) => { pending.push(Promise.resolve(p).catch(() => {})); } };
  const settle = async () => { while (pending.length) await Promise.all(pending.splice(0)); };
  const clearCaches = () => { globalThis.__helpPipe = null; globalThis.__cmPipe = null; globalThis.__cmMir = null; globalThis.__cmArch = null; globalThis.__digestCaches = {}; globalThis.__cmCtx = null; };
  async function call(method, p, { token, body, env = ENV, c = ctx, wait = true } = {}) {
    CALLS = []; AI_CALLS.length = 0;
    const h = { 'X-Cbx-Client': 'v5', 'Content-Type': 'application/json' }; if (token) h.Authorization = 'Bearer ' + token;
    const res = await worker.default.fetch(new Request('https://api.test' + p, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env, c);
    const aiBefore = AI_CALLS.length;
    const t = await res.text(); let j = null; try { j = JSON.parse(t); } catch (e) { j = null; }
    if (wait && c === ctx) await settle();
    return { status: res.status, t, j, aiBefore, calls: CALLS.slice(), ai: AI_CALLS.length };
  }
  const last = async (ev) => (await q(C, 'select id, topic, detail, source_key from usage_events where event = $1 order by id desc limit 1', [ev])).at(0) || {};
  UM.resetUsageSeen && UM.resetUsageSeen(); T.resetTopicCache();

  // C1 · the TL's words on a CM request (FR-002), labelled after the answer
  clearCaches(); AI_ANSWER = 'Dialler problems';
  let r = await call('POST', '/api/portal/cm/request', { token: 'tok-cb207', body: { blockage: 'dialler', description: 'the dialler drops every second call', impact: 'lost 20 sales', priority: 'P1', campaign: 'Cuddle', affected: 4 } });
  let row = await last('cm_request');
  ok(r.status === 200 && row.detail && row.detail.text === 'the dialler drops every second call' && row.detail.impact === 'lost 20 sales', 'a CM request keeps the TL\'s words (detail.text) and the business impact', { status: r.status, t: r.t.slice(0, 120), d: row.detail });
  ok(Array.isArray(row.detail && row.detail.cms) && ['dalwin', 'ryan', 'preshen'].every((x) => row.detail.cms.includes(x)), 'and who was responsible at raise time (cm:assignments → detail.cms)', row.detail && row.detail.cms);
  ok(row.topic === 'dialler' && r.ai === 1, 'labelled after the answer: the AI\'s pick (Dialler problems → dialler) is PATCHed onto that row', { topic: row.topic, ai: r.ai });
  ok(r.aiBefore === 0 || r.status === 200, 'the label never runs before the answer is built');
  // a restricted request: no words exist, nothing goes to the AI
  clearCaches(); HL.opps = HL.opps.filter((o) => o.pipelineId !== 'pC');
  r = await call('POST', '/api/portal/cm/request', { token: 'tok-cb267', body: { blockage: 'personal', priority: 'P3', campaign: 'Courtesy', description: 'SECRET family matter' } });
  row = await last('cm_request');
  ok(r.status === 200 && !('text' in (row.detail || {})) && !JSON.stringify(row.detail || {}).includes('SECRET') && row.topic === 'personal' && r.ai === 0,
    'a restricted request: no text stored, labelled personal, the AI never sees it', { status: r.status, t: r.t.slice(0, 100), d: row.detail, topic: row.topic, ai: r.ai });
  // a CM request that fails to send keeps its words too (like a failed help ask)
  clearCaches(); HL.opps = HL.opps.filter((o) => o.pipelineId !== 'pC'); HL.failCreate = true;
  r = await call('POST', '/api/portal/cm/request', { token: 'tok-cb207', body: { blockage: 'leads', description: 'no leads since Monday', priority: 'P2', campaign: 'Cuddle' } });
  HL.failCreate = false; row = await last('cm_request');
  ok(r.status === 502 && row.detail && row.detail.delivered === false && row.detail.text === 'no leads since Monday' && row.source_key === null && row.topic != null,
    'a CM request that failed to send: words kept, delivered=false, labelled by row id (it has no key)', { status: r.status, row });

  // C2 · a help ask — the answer is identical whatever the AI does
  const ask = async (mode, answer, env = ENV) => { clearCaches(); AI_MODE = mode; AI_ANSWER = answer;
    const x = await call('POST', '/api/portal/help/request', { token: 'tok-cb162', body: { category: 'Explain the product', note: 'how do I pitch the upgrade to a customer?' }, env });
    return { ...x, row: await last('help_ask') }; };
  T.resetTopicCache();
  const base = await ask('ok', 'Product questions', ENV_NOAI);
  ok(base.status === 200 && base.row.topic === null && base.ai === 0, 'no AI binding: the ask is recorded unlabelled (topic NULL) — left for the label tool', base.row);
  const shape = (x) => x.status + ' ' + JSON.stringify(Object.keys(x.j || {}).sort());
  T.resetTopicCache();
  const okA = await ask('ok', 'Product questions');
  ok(okA.status === 200 && shape(okA) === shape(base) && okA.row.topic === 'product', 'AI answers a listed topic → that topic; the response is the same as without AI', { s: shape(okA), topic: okA.row.topic });
  const junk = await ask('ok', 'Customer relations and synergy');
  ok(shape(junk) === shape(base) && junk.row.topic === 'other', 'AI answers junk → other', junk.row.topic);
  const thr = await ask('throw', '');
  ok(shape(thr) === shape(base) && thr.row.topic === null && thr.ai === 2, 'AI throws (both models) → topic NULL, the response unchanged', { topic: thr.row.topic, ai: thr.ai });
  const hangCtx = { waitUntil: () => {} }; clearCaches(); AI_MODE = 'hang';
  const raced = await Promise.race([call('POST', '/api/portal/help/request', { token: 'tok-cb162', body: { category: 'Explain the product', note: 'hanging AI question' }, c: hangCtx }).then((x) => x.status), new Promise((res) => setTimeout(() => res('timeout'), 3000))]);
  ok(raced === 200, 'a hanging AI never holds the response (the label lives in waitUntil)', raced);
  clearCaches(); USAGE_MODE = 'hang'; AI_MODE = 'ok';
  const raced2 = await Promise.race([call('POST', '/api/portal/help/request', { token: 'tok-cb162', body: { category: 'Explain the product', note: 'hanging insert' }, c: hangCtx }).then((x) => x.status), new Promise((res) => setTimeout(() => res('timeout'), 3000))]);
  USAGE_MODE = 'ok';
  ok(raced2 === 200, 'a hanging usage insert never holds the response either', raced2);
  const idx = read('worker/src/index.mjs');
  ok(!/await\s+(labelAsk|askLabeller)\(/.test(idx) && /askLabeller\(/.test(idx), 'index.mjs wires the labeller and never awaits it on the request path');
  ok(/DEFAULT_MODEL/.test((/askLabeller\([^)]*\)/.exec(idx) || [''])[0] + (/const\s+LABEL_MODELS[^;]*;/.exec(idx) || [''])[0]), 'the labeller uses /api/ask\'s own models (DEFAULT_MODEL → FALLBACK_MODEL)');

  // C3 · the subrequest budget: ≤ +2 on a cold isolate, ≤ +1 warm (env.AI is a binding, not a fetch)
  const subs = (x) => x.calls.filter((c) => c.host === 'sb.test' || c.host === 'services.leadconnectorhq.com').length;
  T.resetTopicCache(); const noai = await ask('ok', 'Product questions', ENV_NOAI);
  T.resetTopicCache(); const cold = await ask('ok', 'Product questions');
  const warm = await ask('ok', 'Product questions');
  ok(subs(cold) - subs(noai) <= 2 && subs(cold) - subs(noai) >= 1, 'cold isolate: the label costs ≤ 2 extra subrequests (topics read + PATCH)', { noai: subs(noai), cold: subs(cold) });
  ok(subs(warm) - subs(noai) <= 1, 'warm isolate: ≤ 1 extra (the PATCH; the topic list is cached)', { noai: subs(noai), warm: subs(warm) });
  ok(cold.calls.filter((c) => c.path === '/rest/v1/usage_events' && c.method === 'POST').length === 1, 'still ONE usage insert per ask');
  const patch = cold.calls.find((c) => c.path === '/rest/v1/usage_events' && c.method === 'PATCH');
  ok(patch && /topic=is\.null/.test(decodeURIComponent(patch.query)), 'the PATCH only ever fills an empty topic', patch);
}

/* ═══════════════════════ D · tools/usage-topics.mjs ═══════════════════════ */
head('D · tools/usage-topics.mjs — dry, apply, idempotent, the REST shim');
const UT = await imp('tools/usage-topics.mjs');
ok(!UT.__error && typeof UT.runLabel === 'function' && typeof UT.restAi === 'function', 'tools/usage-topics.mjs exports runLabel and restAi', UT.__error);
if (!UT.__error && UT.runLabel && sql62) {
  const Dd = await newDb62(); const dr = restFetch(Dd);
  await ins(Dd, [
    { at: '2026-10-05T08:00:00Z', username: 'cb162', event: 'help_ask', category: 'Review my call', detail: { note: 'please listen to my last call' } },
    { at: '2026-10-05T08:01:00Z', username: 'cb162', event: 'help_ask', category: 'Something else', detail: { note: 'testing' } },
    { at: '2026-10-05T08:02:00Z', username: 'cb207', event: 'cm_request', category: 'personal', detail: { restricted: true } },
    { at: '2026-10-05T08:03:00Z', username: 'cb207', event: 'cm_request', category: 'dialler', detail: { text: 'dialler keeps dropping' } },
    { at: '2026-10-05T08:04:00Z', username: 'cb162', event: 'help_ask', category: 'Explain the product', detail: { note: 'already done' }, topic: 'product' },
    { at: '2026-10-05T08:05:00Z', username: 'cb162', event: 'app_open', detail: { via: 'boot' } }]);
  globalThis.fetch = async (input, opts = {}) => { const u = new URL(String(input)); return u.host === 'sb.label' ? dr(u.href, opts) : new Response('{}', { status: 404 }); };
  const answers = { 'please listen': 'Review my call', dialler: 'Sales and stuff' }; let aiCalls = 0; let AIMODE = 'ok';
  const ai = { run: async (model, input) => { aiCalls++; if (AIMODE === 'throw') throw new Error('down'); const u = JSON.stringify(input.messages); return { response: Object.entries(answers).find(([k]) => u.includes(k))?.[1] || 'Other' }; } };
  const OPT = { supabaseUrl: 'https://sb.label', serviceKey: 'svc', ai, log: () => {} };
  const nullCount = async () => (await q(Dd, "select count(*)::int n from usage_events where topic is null and event in ('help_ask','cm_request')")).at(0).n;
  AIMODE = 'throw';
  const failed = await UT.runLabel({ ...OPT, apply: true });
  ok(failed.failed === 2 && (await nullCount()) === 2, 'AI down: the two that need the AI stay NULL (counted failed); the pre-labelled two are set', { failed: failed.failed, left: await nullCount() });
  await Dd.exec("update usage_events set topic = null where event in ('help_ask','cm_request') and topic is distinct from 'product'"); AIMODE = 'ok'; aiCalls = 0;
  const dry = await UT.runLabel({ ...OPT, apply: false });
  ok(dry.unlabelled === 4 && (await nullCount()) === 4, 'dry run (the default): sizes the 4 unlabelled asks, writes nothing', dry);
  const app = await UT.runLabel({ ...OPT, apply: true });
  const got = Object.fromEntries((await q(Dd, "select coalesce(detail->>'note', detail->>'text', category) k, topic from usage_events where event in ('help_ask','cm_request')")).map((x) => [x.k, x.topic]));
  ok(app.labelled === 4 && got['please listen to my last call'] === 'call_review' && got.testing === 'test' && got.personal === 'personal' && got['dialler keeps dropping'] === 'other' && got['already done'] === 'product',
    'apply: every unlabelled ask gets one topic (AI pick, pre-labels, junk → other); an existing label is untouched', { app, got });
  ok((await q(Dd, "select topic from usage_events where event = 'app_open'")).at(0).topic === null, 'only help asks and CM requests are labelled');
  const again = await UT.runLabel({ ...OPT, apply: true });
  ok(again.unlabelled === 0 && again.labelled === 0, 'a second run finds nothing to label', again);
  // the REST shim: Workers AI over api.cloudflare.com, the token never printed
  const seen = []; const logs = [];
  globalThis.fetch = async (input, opts = {}) => { seen.push({ url: String(input), opts }); return J({ success: true, result: { response: 'Review my call' } }); };
  const shim = UT.restAi({ accountId: 'acct1', token: 'tok-SECRET-123' });
  const out = await shim.run('@cf/meta/llama-4-scout-17b-16e-instruct', { messages: [{ role: 'user', content: 'x' }], max_tokens: 12 });
  ok(out && out.response === 'Review my call' && seen[0] && seen[0].url === 'https://api.cloudflare.com/client/v4/accounts/acct1/ai/run/@cf/meta/llama-4-scout-17b-16e-instruct'
    && new Headers(seen[0].opts.headers).get('authorization') === 'Bearer tok-SECRET-123' && seen[0].opts.method === 'POST', 'restAi posts to /accounts/<acct>/ai/run/<model> with the bearer token and returns {response}', seen[0] && seen[0].url);
  globalThis.fetch = async () => J({ success: false, errors: [{ code: 4006, message: 'daily free allocation' }] }, 429);
  let threw = ''; try { await shim.run('m', {}); } catch (e) { threw = String(e.message); }
  ok(/4006|429/.test(threw) && !threw.includes('tok-SECRET'), 'a refused REST call throws (so labelAsk treats it as an AI failure) without the token in the message', threw);
  const src = read('tools/usage-topics.mjs');
  ok(!/console\.log\([^)]*token/i.test(src) && /--apply/.test(src) && /wrangler/.test(src), 'the tool never logs the token; --apply is explicit; it can use the wrangler OAuth token');
}

/* ═══════════════════════ E · THE BACKFILL: CAMPAIGN ASSISTANCE ═══════════════════════ */
head('E · tools/usage-backfill.mjs — the TL\'s words from the Campaign Assistance pipeline');
const BF = await imp('tools/usage-backfill.mjs');
ok(!BF.__error && typeof BF.runBackfill === 'function', 'tools/usage-backfill.mjs imports', BF.__error);
if (!BF.__error && BF.runBackfill && sql62) {
  const E = await newDb62();
  const mirA = { requested_at: '2026-10-01T08:00:00.000Z', blockage: 'dialler', cb: 'CB207', tl: 'Renolan Pillay', campaign: 'Cuddle', priority: 'P1', restricted: false, affected: 3,
    history: [{ at: '2026-10-01T08:00:00.010Z', actor: 'Renolan Pillay', what: 'raised · P1 · dialler' }, { at: '2026-10-01T08:05:00.000Z', actor: 'Dalwin Callaghan', what: 'acknowledged' },
      { at: '2026-10-01T08:30:02.000Z', actor: 'Renolan Pillay', what: 'duplicate merged' }] };
  await E.query('insert into rules (key, value) values ($1, $2)', ['kv:cm-areq:oppA', JSON.stringify(mirA)]);
  // the mirror backfill already ran before 029 (live, 11 Oct): oppA's request row exists WITHOUT the words
  await ins(E, [{ at: '2026-10-01T08:00:00Z', event: 'cm_request', category: 'dialler', source: 'backfill', source_key: 'cm-req:oppA:20261001080000', detail: { opp_id: 'oppA', delivered: true, restricted: false } }]);
  const CNOTES = { ctA: [
      { id: 'a1', dateAdded: '2026-10-01T08:00:00.600Z', body: 'Assist oppA\nRequest raised · Dialler · P1 · 3 agents affected\n\ndialler drops calls\n\nBusiness impact: lost sales' },
      { id: 'a2', dateAdded: '2026-10-01T08:05:00.400Z', body: 'Assist oppA\nAcknowledged by Dalwin Callaghan' },
      { id: 'a3', dateAdded: '2026-10-01T08:30:01.500Z', body: 'Assist oppA\nDuplicate request merged into this one\n\nstill dropping' }],
    ctZ: [
      { id: 'z1', dateAdded: '2026-09-21T12:08:17.839Z', body: 'Assist oppZ\nRequest raised · Leads or data · P2\n\nno leads loaded today' },
      { id: 'z2', dateAdded: '2026-09-21T12:08:24.121Z', body: 'Assist oppZ\nAssistance started by Ryan G' },
      { id: 'z3', dateAdded: '2026-09-21T12:20:00.000Z', body: 'Assist oppZ\nDuplicate request merged into this one\n\nstill no leads' },
      { id: 'z5', dateAdded: '2026-09-21T12:31:00.000Z', body: 'Assist oppZ\nRestricted — personal matter. Details held with the team leader.' }] };
  const COPPS = [{ id: 'oppA', pipelineId: 'pC', contactId: 'ctA', name: '[dialler] CB207 Renolan Pillay · Cuddle', pipelineStageId: 'c1', status: 'open', createdAt: '2026-10-01T08:00:00.300Z' },
    { id: 'oppZ', pipelineId: 'pC', contactId: 'ctZ', name: '[leads] CB267 Denise Haripersad · Courtesy', pipelineStageId: 'c5', status: 'won', createdAt: '2026-09-21T12:08:16.869Z' }];
  const CST = ['New', 'Triaged', 'Assisting', 'Awaiting confirmation', 'Follow-up due', 'Closed'].map((name, i) => ({ id: 'c' + i, name, position: i }));
  const er = restFetch(E); const hlCalls = [];
  globalThis.fetch = async (input, opts = {}) => {
    const u = new URL(String(input)); const method = String(opts.method || 'GET').toUpperCase();
    if (u.host === 'sb.backfill') return er(u.href, opts);
    if (u.host === 'services.leadconnectorhq.com') {
      hlCalls.push(method + ' ' + u.pathname);
      if (method !== 'GET') return J({}, 405);
      if (u.pathname === '/opportunities/pipelines') return J({ pipelines: [{ id: 'pH', name: 'Agent Help Center', stages: [] }, { id: 'pC', name: 'Campaign Assistance', stages: CST }] });
      if (u.pathname === '/opportunities/search') { const ops = u.searchParams.get('pipeline_id') === 'pC' ? COPPS : []; return J({ opportunities: ops, meta: { total: ops.length } }); }
      const m = /^\/contacts\/([^/]+)\/notes$/.exec(u.pathname); if (m) return J({ notes: CNOTES[m[1]] || [] });
    }
    return J({}, 404);
  };
  const OPT = { supabaseUrl: 'https://sb.backfill', serviceKey: 'svc', hl: { key: 'k', location: 'locH' }, log: () => {}, sources: ['cm', 'hl_cm'] };
  const count = async () => (await q(E, 'select count(*)::int n from usage_events')).at(0).n;
  const before = await count();
  const dry = await BF.runBackfill({ ...OPT, apply: false });
  const S = dry.sources || {};
  ok((await count()) === before, 'the dry run writes nothing');
  ok(S.cm && S.cm.textAttach === 1 && S.cm.toInsert === 2, 'dry cm: the existing request row will get its words (1); the merged duplicate + the acknowledge are new (2) and carry theirs', S.cm);
  ok(S.hl_cm && S.hl_cm.byEvent.cm_request === 3 && S.hl_cm.byEvent.cm_action === 1, 'dry hl_cm: a card with no mirror row comes back from its notes — 3 requests (1 merged, 1 restricted) + 1 action', S.hl_cm);
  ok(hlCalls.every((c) => c.startsWith('GET ')), 'HighLevel is only ever READ (GETs)', hlCalls);
  const app = await BF.runBackfill({ ...OPT, apply: true });
  ok(app.sources.cm.textAttached === 1 && app.sources.cm.inserted === 2 && app.sources.hl_cm.inserted === 4, 'apply: attaches 1, inserts what the dry run counted', app.sources);
  const a = (await q(E, "select detail from usage_events where source_key = 'cm-req:oppA:20261001080000'")).at(0).detail;
  ok(a.text === 'dialler drops calls' && a.impact === 'lost sales', 'the pre-029 row now carries the TL\'s words and impact', a);
  const am = (await q(E, "select detail from usage_events where source_key = 'cm-hist:oppA:2026-10-01T08:30:02.000Z'")).at(0);
  ok(am && am.detail.merged === true && am.detail.text === 'still dropping', 'a merged duplicate from the mirror carries ITS words (the note nearest its history line)', am);
  const z = await q(E, "select event, category, team_leader, campaign, username, detail, source_key from usage_events where source_key like 'hl-cm:oppZ:%' order by at");
  ok(z.length === 4 && z[0].event === 'cm_request' && z[0].category === 'leads' && z[0].team_leader === 'Denise Haripersad' && z[0].campaign === 'Courtesy' && z[0].username === 'cb267'
    && z[0].detail.text === 'no leads loaded today' && z[0].detail.priority === 'P2' && z[0].source_key === 'hl-cm:oppZ:z1', 'a note-only request: blockage from the label, TL + campaign from the card, the TL account, the words', z[0]);
  ok(z[1] && z[1].event === 'cm_action' && z[1].category === 'start' && z[1].username === 'ryan' && z[1].detail.actor === 'Ryan G', 'its "Assistance started by Ryan G" note is a start action by Ryan', z[1]);
  ok(z[2] && z[2].detail.merged === true && z[2].detail.text === 'still no leads', 'its merged duplicate', z[2]);
  ok(z[3] && z[3].category === 'personal' && z[3].detail.restricted === true && !('text' in z[3].detail), 'a restricted round: personal, no words', z[3]);
  const byCm = await q(E, "select campaign, campaign_manager, requests from cm_askers_by_cm where grain = 'month' and period_start = '2026-09-01' order by campaign_manager");
  ok(byCm.some((x) => x.campaign_manager === 'Ryan G' && x.requests === 1), 'the backfilled round shows Ryan G as the campaign manager who handled it', byCm);
  const again = await BF.runBackfill({ ...OPT, apply: true });
  ok(again.sources.cm.inserted === 0 && again.sources.cm.textAttached === 0 && again.sources.hl_cm.inserted === 0, 'a second apply adds 0 and attaches 0', again.sources);
  const nokey = await BF.runBackfill({ ...OPT, hl: null, apply: false });
  ok(nokey.sources.cm && !nokey.sources.hl_cm && (nokey.skipped || []).some((s) => /hl_cm/.test(s)), 'without the Help key, hl_cm is skipped and says so; cm still runs (no words)', nokey);
}

/* ═══════════════════════ G · TEST TRAFFIC IS NOT IN THE REPORT ═══════════════════════ */
head('G · Nick: "Exclude test traffic from the report" — usage_test_markers + usage_events_real behind every view');
if (sql62) {
  const G = await newDb62();
  const VIEWS28 = ['usage_daily', 'logins_by_user', 'logins_by_user_month', 'app_opens_by_user_app', 'help_by_category', 'help_by_team_leader', 'help_by_campaign',
    'help_by_agent', 'help_notes', 'help_answer_times', 'cm_requests', 'cm_request_summary', 'ask_ai_by_user', 'ai_questions'];
  const VIEWS29 = ['ask_events', 'ask_event_periods', 'help_askers_by_period', 'help_askers_by_tl', 'help_askers_by_campaign', 'help_top_askers', 'cm_askers_by_period',
    'cm_askers_by_cm', 'most_asked_topics', 'most_asked_categories'];
  const mk = (await q(G, "select kind, value from usage_test_markers order by kind, value").catch((e) => ({ err: String(e.message) })));
  ok(Array.isArray(mk), 'usage_test_markers exists', mk.err);
  if (Array.isArray(mk)) {
    const has = (k, v) => mk.some((m) => m.kind === k && m.value === v);
    ok(has('username', 'wimpy.livecheck') && has('username', 'testbot') && has('card', 'Hlynw1DovYIRh7I01Tt6'), 'seeded with the known test accounts and the automated Campaign Assistance card', mk);
    let badKind = false; try { await G.query("insert into usage_test_markers (kind, value) values ('ip', '1.2.3.4')"); } catch (e) { badKind = true; }
    ok(badKind, "a marker's kind is username | card | source_key_prefix");
    const defs = await q(G, "select viewname, definition from pg_views where schemaname = 'public' and viewname = any($1)", [VIEWS28.concat(VIEWS29)]);
    const direct = defs.filter((d) => /\busage_events\b(?!_real)/.test(d.definition)).map((d) => d.viewname);
    ok(defs.length === VIEWS28.length + VIEWS29.length && direct.length === 0, 'EVERY report view (028 and 029) reads usage_events_real, none reads usage_events directly', direct);
    const D = 'Denise Haripersad';
    await ins(G, [
      { at: '2026-10-06T07:00:00Z', username: 'cb162', role: 'agent', app: 'worker', event: 'login_ok', source: 'auth_log', source_key: 'auth_log:1' },
      { at: '2026-10-06T07:01:00Z', username: 'wimpy.livecheck', app: 'wimpy', event: 'login_ok', source: 'auth_log', source_key: 'auth_log:2' },
      { at: '2026-10-06T07:02:00Z', username: 'WIMPY.LIVECHECK', app: 'wimpy', event: 'login_fail', category: 'bad_password', source: 'auth_log', source_key: 'auth_log:3' },
      { at: '2026-10-06T07:03:00Z', username: 'testbot', event: 'app_open', app: 'ops', detail: { via: 'boot' } },
      { at: '2026-10-06T07:04:00Z', username: 'testbot', event: 'ai_question', app: 'vas', detail: { question: 'probe?' }, source_key: 'ask_log:9' },
      { at: '2026-10-06T07:05:00Z', username: 'cb162', event: 'ai_question', app: 'agent', detail: { question: 'real?' }, source_key: 'ask_log:10' },
      { at: '2026-10-06T08:00:00Z', username: 'cb162', role: 'agent', event: 'help_ask', category: 'Review my call', team_leader: D, campaign: 'Courtesy', detail: { note: 'listen to my call', delivered: true, opp_id: 'H1' }, topic: 'call_review' },
      { at: '2026-10-06T08:10:00Z', username: 'cb162', role: 'agent', event: 'help_ask', category: 'Something else', team_leader: D, campaign: 'Courtesy', detail: { note: 'testing', delivered: true, opp_id: 'H9' }, topic: 'test' },
      { at: '2026-10-06T08:20:00Z', username: 'cb245', role: 'agent', event: 'help_ask', category: 'Explain what to say', team_leader: D, campaign: 'Courtesy', detail: { note: 'help me close', delivered: true, opp_id: 'H8' }, topic: 'closing_objections' },
      { at: '2026-10-06T09:00:00Z', username: 'cb267', role: 'team_leader', event: 'cm_request', category: 'leads', team_leader: D, campaign: 'Courtesy', detail: { opp_id: 'C1', delivered: true, text: 'no leads' }, topic: 'leads_data' },
      { at: '2026-10-06T09:05:00Z', username: 'cb207', role: 'team_leader', event: 'cm_request', category: 'other', team_leader: 'Dhamendra Budhu', campaign: 'Courtesy', detail: { opp_id: 'Hlynw1DovYIRh7I01Tt6', delivered: true, text: 'TEST automated check' }, topic: 'other' },
      { at: '2026-10-06T09:06:00Z', username: 'dalwin', role: 'campaign_manager', event: 'cm_action', category: 'start', team_leader: 'Dhamendra Budhu', campaign: 'Courtesy', detail: { opp_id: 'Hlynw1DovYIRh7I01Tt6', actor: 'Dalwin Callaghan', started: true } }]);
    const n = async (sql) => (await q(G, sql)).at(0).n;
    const DAY = "day = '2026-10-06'";
    const views = async () => ({
      logins: (await q(G, `select username from logins_by_user where ${DAY} order by username`)).map((r) => r.username),
      daily: (await q(G, `select event, events from usage_daily where ${DAY} order by event`)),
      opens: await n(`select count(*)::int n from app_opens_by_user_app where ${DAY}`),
      ai: (await q(G, `select username from ask_ai_by_user where ${DAY}`)).map((r) => r.username),
      aiq: await n("select count(*)::int n from ai_questions"),
      helpCat: await n(`select coalesce(sum(asks), 0)::int n from help_by_category where ${DAY}`),
      helpNotes: (await q(G, 'select note from help_notes order by at')).map((r) => r.note),
      helpAns: await n('select count(*)::int n from help_answer_times'),
      cmReq: (await q(G, 'select opp_id from cm_requests order by requested_at')).map((r) => r.opp_id),
      cmSum: await n(`select coalesce(sum(requests), 0)::int n from cm_request_summary where ${DAY}`),
      askers: (await q(G, "select asks from help_askers_by_period where grain = 'day' and period_start = '2026-10-06'")).map((r) => r.asks),
      cmAskers: (await q(G, "select requests from cm_askers_by_period where grain = 'day' and period_start = '2026-10-06'")).map((r) => r.requests),
      byCm: (await q(G, "select campaign_manager from cm_askers_by_cm where grain = 'day' and period_start = '2026-10-06'")).map((r) => r.campaign_manager),
      topics: (await q(G, "select topic from most_asked_topics where grain = 'day' and period_start = '2026-10-06' and source = 'all' order by topic")).map((r) => r.topic),
    });
    const v = await views();
    ok(JSON.stringify(v.logins) === '["cb162"]' && JSON.stringify(v.daily.filter((d) => /^login/.test(d.event))) === '[{"event":"login_ok","events":1}]',
      'a test account\'s sign-ins (and a failed one, any letter case) are gone from logins_by_user and usage_daily; the real one stays', { logins: v.logins, daily: v.daily });
    ok(v.opens === 0 && JSON.stringify(v.ai) === '["cb162"]' && v.aiq === 1, 'a test account\'s app opens and AI questions are gone', v);
    ok(v.helpCat === 2 && JSON.stringify(v.helpNotes) === '["listen to my call","help me close"]' && v.helpAns === 2, 'a "Test message" help ask is gone from help_by_* / help_notes / help_answer_times; real asks stay', v);
    ok(JSON.stringify(v.cmReq) === '["C1"]' && v.cmSum === 1 && JSON.stringify(v.cmAskers) === '[1]' && !v.byCm.includes('Dalwin Callaghan'),
      'the automated test card\'s CM request (and its action) is gone from cm_requests, cm_request_summary, cm_askers_by_*', v);
    ok(JSON.stringify(v.askers) === '[2]' && !v.topics.includes('test') && v.topics.includes('call_review'), 'the 029 views drop it too: 2 real help asks, no "test" topic', v);
    ok((await n('select count(*)::int n from usage_events')) === 12, 'the raw table keeps every row (12)');
    // a merge INTO the test topic hides those asks too ("resolves to Test message")
    await G.query("update ask_topics set merged_into = 'test' where topic = 'closing_objections'");
    ok(JSON.stringify((await q(G, 'select note from help_notes')).map((r) => r.note)) === '["listen to my call"]', 'a topic merged into Test message is test traffic too');
    await G.query("update ask_topics set merged_into = null where topic = 'closing_objections'");
    // Nick adds a marker → rows vanish; removes it → back
    await G.query("insert into usage_test_markers (kind, value, note) values ('username', 'cb162', 'test of the test')");
    ok((await n(`select count(*)::int n from logins_by_user where ${DAY}`)) === 0 && (await n('select count(*)::int n from help_notes')) === 1, 'adding a username marker removes that account from every view at once');
    await G.query("delete from usage_test_markers where value = 'cb162'");
    await G.query("insert into usage_test_markers (kind, value, note) values ('source_key_prefix', 'ask_log:1', 'prefix test')");
    ok((await n('select count(*)::int n from ai_questions')) === 0, 'a source_key_prefix marker removes the rows whose key starts with it');
    await G.query("delete from usage_test_markers where kind = 'source_key_prefix' and value = 'ask_log:1'");
    ok((await n('select count(*)::int n from ai_questions')) === 1, 'and removing the marker brings them back');
    // lockdown
    for (const role of ['anon', 'authenticated']) {
      ok(await denied(G, role, 'select * from usage_test_markers'), role + ' cannot read usage_test_markers');
      ok(await denied(G, role, "insert into usage_test_markers (kind, value) values ('username', 'x')"), role + ' cannot add a marker');
      ok(await denied(G, role, 'select * from usage_events_real'), role + ' cannot read usage_events_real');
    }
    await G.exec('set role service_role');
    let svc = true; try { await G.query('select * from usage_events_real limit 1'); await G.query("insert into usage_test_markers (kind, value) values ('username', 'svc.probe')"); await G.query("delete from usage_test_markers where value = 'svc.probe'"); for (const x of VIEWS28.concat(VIEWS29)) await G.query('select * from ' + x + ' limit 1'); } catch (e) { svc = String(e.message); }
    await G.exec('reset role');
    ok(svc === true, 'service_role reads usage_events_real and every view, and may add / remove markers', svc);
    ok((await q(G, "select relrowsecurity from pg_class where relname = 'usage_test_markers'")).at(0).relrowsecurity === true, 'RLS is on for usage_test_markers');
    ok(((await q(G, "select reloptions from pg_class where relname = 'usage_events_real'")).at(0).reloptions || []).includes('security_invoker=true'), 'usage_events_real is security_invoker');
  }
}

/* ═══════════════════════ F · REGISTERED ═══════════════════════ */
head('F · registered in verify.yml');
{
  const yml = read('.github/workflows/verify.yml');
  ok(/verify-usage-029/.test(yml), 'verify.yml runs verify-usage-029');
}

console.log('\n' + (fail ? 'FAIL' : 'PASS') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
