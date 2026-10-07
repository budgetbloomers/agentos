#!/usr/bin/env node
/**
 * verify-publish-agent-list.mjs — the file is the record, proven.
 *
 *   node nicks_code/diagnostics/verify-publish-agent-list.mjs
 *
 * Runs the REAL publish_agent_list() (migration-020) against the REAL database inside
 * one transaction that is always rolled back — the posture of verify-agent-sync.mjs.
 * It feeds the function a whole FILE (every row of every sheet, unclassified, the way
 * both Upload Stations now post it) and checks that:
 *   · the roster is derived here — a campaign the browser has never heard of lands
 *     under its own name (the "Download & Test" failure of 2026-09-03 cannot recur);
 *   · the VT sheet's queue labels fold to VT; blank campaigns are Courtesy and NAMED;
 *   · rows that do not become agents are returned with the reason, never lost;
 *   · agents, team leaders and campaigns are reconciled in ONE transaction — a refusal
 *     at the leaders stage rolls the agents' writes back too;
 *   · a campaign nobody carries is deleted, and agent_list_integrity says when the
 *     list, the logins and the campaigns disagree.
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
const publish = async (rows, { apply = false, hashes = {}, asOf, fp = 'list:test', actor = 'verify' } = {}) =>
  (await one(`select publish_agent_list($1::date, $2::jsonb, $3, $4, $5::jsonb, $6, 25) as r`,
    [asOf, JSON.stringify(rows), fp, actor, JSON.stringify(hashes), apply])).r;
const HASH = await hashPassword('agentos123');
const hashesFor = (cbs) => Object.fromEntries(cbs.map((cb) => [cb, HASH]));
const CB = (i) => 'CB' + (900000 + i);

try {
  await c.query('begin');
  /* the fixture list must be the NEWEST snapshot (agent_list_current = max(as_of)) */
  const ASOF = (await one(`select to_char(coalesce(max(as_of), current_date) + 1, 'YYYY-MM-DD') d from agent_list`)).d;
  /* real leader names, so the leaders sync has nobody to remove (its cap is 3) */
  const leaders = (await q(`select distinct btrim(team_leader) as l from agent_list_current where coalesce(btrim(team_leader), '') <> '' order by 1`)).map((r) => r.l);
  ok(leaders.length >= 2, 'the live list names at least two team leaders (' + leaders.length + ')');
  const TL = (i) => leaders[i % leaders.length];

  /* THE FILE: a VAS sheet with Courtesy, Cuddle (spelled loosely), a campaign nobody
     has heard of, a blank cell, two rows that are not agents, an exact duplicate — and a
     VT sheet whose Campaign cells are queue names. */
  const row = (i, campaign, sheet = 'VAS', extra = {}) => Object.assign({ sheet, code: CB(i), name: 'Test Agent ' + i, sf: 'Test Agent ' + i,
    tl: TL(i), campaign, tenure: 'Exp', callx: '', target: 5, start: '2026-01-01' }, extra);
  const file = [];
  for (let i = 1; i <= 20; i++) file.push(row(i, 'Courtesy'));
  for (let i = 21; i <= 24; i++) file.push(row(i, 'Download & Test'));
  for (let i = 25; i <= 26; i++) file.push(row(i, 'cuddle campaign'));
  file.push(row(27, ''));                                                  // blank campaign cell
  file.push({ sheet: 'VAS', code: '', name: 'Nobody Withacode', sf: '', tl: TL(1), campaign: 'Courtesy' });   // not an agent
  file.push({ sheet: 'VAS', code: 'CB999999', name: '', sf: '-', tl: TL(1), campaign: 'Courtesy' });         // no name
  file.push(row(1, 'Courtesy'));                                           // exact duplicate of row 1
  for (let i = 28; i <= 31; i++) file.push(row(i, ['Scheduling', 'Matrix Digital', 'Panimax Referrals', 'Panimax Predictive'][i - 28], 'VT'));
  const fileAgents = 31;

  head('A · CLASSIFICATION IS THE DATABASE\'S, ONCE (campaign_label)');
  const k = await one(`select campaign_label('Scheduling', 'VT') a, campaign_label('Matrix Digital', ' vt ') b, campaign_label('', 'VAS') c,
                        campaign_label('cuddle campaign', 'VAS') d, campaign_label('Download & Test', 'VAS') e, campaign_label('  Download  &  Test ', null) f,
                        campaign_label('Vehicle Tracking', 'VAS') g, campaign_label('Nesting Pod', 'VAS') h, campaign_label('courtesy calls', 'VAS') i`);
  ok(k.a === 'VT' && k.b === 'VT', 'a row on the VT sheet is VT whatever its cell says');
  ok(k.c === 'Courtesy', 'a blank cell is Courtesy');
  ok(k.d === 'Cuddle' && k.g === 'VT' && k.h === 'Nesting' && k.i === 'Courtesy', 'the loose spellings fold as PULSE folds them');
  ok(k.e === 'Download & Test' && k.f === 'Download & Test', 'an unknown campaign is kept under its own (space-collapsed) name');

  /* AN EMPTY FLOOR FIRST, as verify-agent-sync does: against the live 109 accounts a 31-agent
     fixture is a 100% deletion, which the agents' sync rightly refuses. Rolled back anyway. */
  await c.query(`delete from app_users where role = 'agent'`);

  head('B · PLAN: THE ROSTER IS DERIVED FROM THE WHOLE FILE, NOTHING WRITTEN');
  const before = (await one(`select count(*)::int n from app_users where role = 'agent'`)).n;
  const plan = await publish(file, { asOf: ASOF });
  ok(plan.status === 'PLAN', 'a plan comes back as PLAN', JSON.stringify(plan).slice(0, 300));
  ok(plan.on_file === file.length && plan.on_roster === fileAgents, 'on_file ' + plan.on_file + ' / on_roster ' + plan.on_roster, JSON.stringify([plan.on_file, plan.on_roster]));
  const camps = Object.fromEntries((plan.campaigns_on_list || []).map((x) => [x.label, x.agents]));
  ok(camps['Download & Test'] === 4, 'the campaign the browser never heard of is on the roster with 4 agents', JSON.stringify(camps));
  ok(camps.VT === 4 && !camps.Scheduling && !camps['Matrix Digital'], 'the VT sheet\'s four queue labels are 4 VT agents, not four campaigns');
  ok(camps.Cuddle === 2 && camps.Courtesy === 21, 'Cuddle 2 (loose spelling), Courtesy 21 (20 + the blank cell)');
  ok((plan.blank_campaign || []).length === 1 && plan.blank_campaign[0] === CB(27), 'the blank campaign cell is NAMED');
  const why = Object.fromEntries((plan.dropped || []).map((d) => [d.code || d.name, d.why]));
  ok(plan.dropped.length === 3 && why['Nobody Withacode'] === 'no CB number' && why.CB999999 === 'no name' && why[CB(1)] === 'duplicate row',
    'the three rows that did not become agents are returned, each with its reason', JSON.stringify(plan.dropped));
  ok(Array.isArray(plan.roster) && plan.roster.length === fileAgents && plan.roster.every((a) => /^CB\d+$/.test(a.code) && a.name && a.campaign),
    'the derived roster is what the Worker stores as the record');
  ok((plan.needs_hashes || []).length === fileAgents, 'the plan names every hash the apply will need (' + (plan.needs_hashes || []).length + ')');
  ok((await one(`select count(*)::int n from app_users where role = 'agent'`)).n === before, 'nothing was written');

  head('C · APPLY WITHOUT HASHES WRITES NOTHING');
  const nh = await publish(file, { apply: true, asOf: ASOF });
  ok(nh.status === 'NEEDS_HASHES' && nh.stage === 'agents', 'NEEDS_HASHES at the agents stage', nh.status + '/' + nh.stage);
  ok((await one(`select count(*)::int n from app_users where role = 'agent'`)).n === 0, 'no account was created');
  ok((await one(`select count(*)::int n from agent_list_raw where as_of = $1`, [ASOF])).n === 0, 'the file was not stored either');

  head('D · APPLY: LOGINS, LEADER VIEWS, CAMPAIGNS — ONE TRANSACTION');
  const campsBefore = (await q(`select key from campaigns order by key`)).map((r) => r.key);
  const s = await publish(file, { apply: true, asOf: ASOF, hashes: hashesFor(plan.needs_hashes) });
  ok(s.status === 'SUCCESS', 'SUCCESS', JSON.stringify(s).slice(0, 400));
  ok(s.agents && s.agents.status === 'SUCCESS' && s.agents.created.length === fileAgents, 'every agent row became a login (' + (s.agents && s.agents.created.length) + ')');
  ok((await one(`select count(*)::int n from app_users where role = 'agent' and username like 'cb9000%'`)).n === fileAgents, '…and they are in app_users');
  ok(s.leaders && s.leaders.status === 'SUCCESS' && s.leaders.removed.length === 0, 'the leaders sync ran and removed nobody (real leader names)', JSON.stringify(s.leaders).slice(0, 200));
  ok(s.campaigns && s.campaigns.status === 'SUCCESS', 'the campaigns sync ran');
  const campsAfter = (await q(`select key, agents from campaigns order by key`));
  const keys = campsAfter.map((r) => r.key);
  ok(keys.includes('download & test') && keys.includes('vt') && keys.includes('cuddle') && keys.includes('courtesy'), 'the four campaigns on the file exist', keys.join(','));
  ok(campsAfter.find((r) => r.key === 'download & test').agents === 4, 'Download & Test carries its 4 agents');
  const gone = campsBefore.filter((x) => !keys.includes(x));
  ok(gone.every((x) => (s.campaigns.deleted || []).some((d) => d.key === x)), 'any campaign the file does not carry was deleted and named (' + gone.join(', ') + ')');
  ok((await one(`select count(*)::int n from agent_list_raw where as_of = $1`, [ASOF])).n === file.length, 'the whole file is stored in agent_list_raw');
  const rawDropped = await q(`select code_raw, why from agent_list_raw where as_of = $1 and not accepted order by ord`, [ASOF]);
  ok(rawDropped.length === 3 && rawDropped.every((r) => r.why), '…with the dropped rows marked and their reasons', JSON.stringify(rawDropped));
  ok((await one(`select count(*)::int n from agent_list_raw where as_of = $1 and sheet = 'VT' and campaign = 'VT'`, [ASOF])).n === 4, '…and the VT rows classified VT');

  head('D2 · A LEGACY SHEET IS NOT THE RECORD (migration-039)');
  {
    /* The workbook's frozen "May" tab spells CB156 differently from the live "VAS" tab. Posted
       together (which PULSE does — every row of every sheet), the duplicate rule refused five
       daily lists in a row (10–14 Sep 2026). The legacy tab must lose to the live one, named. */
    const live = file.slice(0, 26).map((r) => ({ ...r, sheet: 'VAS' }));
    const legacy = [{ ...file[0], sheet: 'May', name: 'Test Agent 1 Misspelt', sf: 'Test Agent 1 Misspelt', campaign: 'Courtesy Calls' },
      { ...file[1], sheet: 'Sheet1' }, { ...row(900, 'Courtesy'), sheet: 'May' }];   // one duplicate spelt differently, one exact twin, one May-only leaver
    const p = await publish([...legacy, ...live], { asOf: ASOF });
    ok(p.status === 'PLAN', 'a live sheet plus a legacy month-named sheet PLANS instead of being refused as a duplicate', p.status + ' ' + JSON.stringify(p.detail || p.reason || '').slice(0, 120));
    ok((p.roster || []).length === 26, 'the roster is the live sheet alone (26)', String((p.roster || []).length));
    const dropped = (p.dropped || []).filter((d) => /legacy sheet/.test(d.why));
    ok(dropped.length === 3 && dropped.every((d) => /^(May|Sheet1)$/.test(d.sheet)), 'all three legacy rows are dropped with the reason named', JSON.stringify(dropped.map((d) => d.sheet + ':' + d.code + ':' + d.why)));
    ok(!(p.roster || []).some((a) => a.code === 'CB900900'), 'a person on the legacy tab only is NOT resurrected onto the roster');
    ok((p.roster || []).find((a) => a.code === 'CB900001').name === file[0].sf, 'the live tab’s spelling is the one kept');
    const only = await publish(legacy.slice(0, 1).concat([{ ...row(2, 'Courtesy'), sheet: 'May' }]).concat(Array.from({ length: 24 }, (_, i) => ({ ...row(10 + i, 'Courtesy'), sheet: 'May' }))), { asOf: ASOF });
    ok(only.status === 'PLAN' && (only.roster || []).length === 26, 'a file that is ONLY a legacy-format sheet is still taken whole (an old-format list)', only.status + ' ' + (only.roster || []).length);
  }

  head('D3 · THE LEADERS COME ON THE LIST (migration-040, the "VAS TL" sheet)');
  {
    /* Nick, 2026-09-15: the workbook now carries the leaders with their CB numbers — "put them in
       their respected campaigns". A leader on the sheet gets a login even with no agents this month;
       the map is written from the sheet with campaign and manager; the agent derive never sees them. */
    /* the WHOLE fixture file (as D published it), so the applies below leave the floor exactly as D left it for F */
    const live = file.map((r) => ({ ...r, sheet: r.sheet || 'VAS' }));
    const nLive = (await publish(live, { asOf: ASOF })).roster.length;
    const sheet = [
      { sheet: 'VAS TL', role: 'leader', code: 'CB900801', name: 'Test Leader One', campaign: 'Courtesy', manager: 'Test Manager', callx: 'CB900801' },   // leads people on the list
      { sheet: 'VAS TL', role: 'leader', code: 'CB900809', name: 'Test Leader Nine', campaign: 'Nesting', manager: 'Test Manager', callx: 'CB900809' },   // leads nobody this month
    ];
    const p = await publish([...sheet, ...live], { asOf: ASOF });
    ok(['PLAN', 'NEEDS_HASHES'].includes(p.status), 'a list with a "VAS TL" sheet plans', p.status + ' ' + JSON.stringify(p.detail || p.reason || '').slice(0, 120));
    ok((p.roster || []).length === nLive && !(p.roster || []).some((a) => /^CB90080/.test(a.code)), 'leader rows never become agents', (p.roster || []).length + ' vs ' + nLive);
    const need = new Set(p.needs_hashes || []);
    ok(need.has('CB900809'), 'a leader with NO agents on the list still gets a login from the sheet (hash requested for CB900809)', JSON.stringify([...need]));
    const hashes = Object.fromEntries([...need].map((cb) => [cb, HASH]));
    const out = await publish([...sheet, ...live], { asOf: ASOF, apply: true, hashes });
    ok(out.status === 'SUCCESS', 'applies', out.status + ' ' + JSON.stringify(out.detail || out.reason || '').slice(0, 120));
    const map = await q(`select leader_name, employee_code, campaign, manager, on_list_as_of::text d from team_leader_cbs where leader_name like 'Test Leader %' order by leader_name`);
    ok(map.length === 2 && map.every((m) => m.d === ASOF && m.manager === 'Test Manager'), 'the map is written from the sheet, stamped with the list date', JSON.stringify(map));
    ok(map.find((m) => m.leader_name === 'Test Leader Nine').campaign === 'Nesting' && map.find((m) => m.leader_name === 'Test Leader One').campaign === 'Courtesy', '…with each leader in their respected campaign');
    const acct = await q(`select username, role, team, active from app_users where username in ('cb900801','cb900809') order by username`);
    ok(acct.length === 2 && acct.every((a) => a.role === 'team_leader' && a.active), 'both leaders have active team_leader logins, agents or none', JSON.stringify(acct));
    /* the next publish WITHOUT the sheet (an older-format upload) must not remove the no-agent leader: the map remembers */
    const again = await publish(live, { asOf: ASOF, apply: true });
    ok(again.status === 'SUCCESS' && !((again.leaders || {}).removed || []).some((r) => r.username === 'cb900809'), 'a later publish without the sheet keeps the no-agent leader (on_list_as_of remembers)', JSON.stringify((again.leaders || {}).removed));
  }

  head('D4 · ONE LEADER, TWO CAMPAIGNS ON THE SHEET (2026-10-07, spec 010)');
  {
    /* The 7 Oct list named Fabian Chetty (CB194) TWICE on the "TL" sheet — Digital and Referral. The leaders sync wrote
       the map with ONE insert … on conflict (leader_name) do update, and Postgres refuses to touch a row twice in one
       command (21000) — so every publish of that list THREW at the apply, and Hezron & co. stayed on for a day. A leader
       who heads two campaigns is one row in the map, holding both. Savepoint: the failure must not poison the rest. */
    await c.query('savepoint d4');
    const live = file.map((r) => ({ ...r, sheet: r.sheet || 'VAS' }));
    /* Fabian's two (Digital, Referral) both fold to VT before this step, so the fixture uses two campaigns that fold
       apart — Courtesy and Cuddle — to prove a leader's campaigns are all kept, not just that the throw is gone */
    const twice = [
      { sheet: 'TL', role: 'leader', code: 'CB900801', name: 'Test Leader One', campaign: 'Matrix VAS - Courtesy', manager: 'Test Manager', callx: 'CB900801' },
      { sheet: 'TL', role: 'leader', code: 'CB900801', name: 'Test Leader One', campaign: 'Matrix VAS - Cuddle', manager: 'Test Manager', callx: 'CB900801' },
    ];
    let out = null, err = '';
    try { out = await publish([...twice, ...live], { asOf: ASOF, apply: true, hashes: hashesFor(['CB900801']) }); }
    catch (e) { err = String(e.message || e); }
    ok(!err && out && out.status === 'SUCCESS', 'a leader named twice on the sheet (two campaigns) publishes instead of throwing', err || (out && out.status + ' ' + JSON.stringify(out.detail || out.reason || '').slice(0, 120)));
    if (!err) {
      const m = await q(`select campaign from team_leader_cbs where leader_name = 'Test Leader One'`);
      ok(m.length === 1 && /Courtesy/.test(m[0].campaign) && /Cuddle/.test(m[0].campaign), '…as ONE map row holding both campaigns', JSON.stringify(m));
    }
    await c.query('rollback to savepoint d4');
  }

  head('E · INTEGRITY: THE LIST, THE LOGINS AND THE CAMPAIGNS AGREE');
  const integ = async () => Object.fromEntries((await q(`select check_name, failures, severity from agent_list_integrity`)).map((r) => [r.check_name, r]));
  let I = await integ();
  /* seven since migration-037 (2026-09-10): the Wimpy app grant is the seventh sentence. */
  ok(Object.keys(I).length === 7, 'seven sentence-checks', Object.keys(I).join(' | '));
  ok(I['active agent login without the Wimpy app'] && I['active agent login without the Wimpy app'].severity === 'warning',
    'the Wimpy grant check exists and is a warning, not critical');
  ok(I['agent on the latest list with no active login'].failures === 0, 'every agent on the list has a login');
  ok(I['agent login that is not on the latest list'].failures === 0, 'no login is off the list');
  ok(I['campaign on the latest list that does not exist'].failures === 0 && I['campaign that the latest list does not carry'].failures === 0, 'campaigns agree both ways');
  ok(I['team leader on the latest list with no login'].severity === 'warning', 'the leader check is a warning, not critical');

  head('F · A SECOND LIST: A CAMPAIGN NOBODY CARRIES IS DELETED, ITS AGENTS MOVE');
  const file2 = file.filter((r) => r.campaign !== 'cuddle campaign').concat([row(25, 'Courtesy'), row(26, 'Courtesy')]);
  const s2 = await publish(file2, { apply: true, asOf: ASOF, fp: 'list:test2' });
  ok(s2.status === 'SUCCESS' && (s2.campaigns.deleted || []).some((d) => d.key === 'cuddle'), 'Cuddle, carried by nobody, is deleted', JSON.stringify(s2.campaigns).slice(0, 200));
  ok((await one(`select count(*)::int n from campaigns where key = 'cuddle'`)).n === 0, '…and is gone from campaigns');
  ok(s2.agents.created.length === 0 && s2.agents.removed.length === 0, 'no login came or went — the two agents just moved campaign');

  head('G · ALL OR NOTHING: A REFUSAL AT THE LEADERS STAGE UNDOES THE AGENTS\' WRITES');
  await c.query('savepoint g');
  const agentsNow = (await one(`select count(*)::int n from app_users where role = 'agent'`)).n;
  const file3 = file2.map((r) => Object.assign({}, r, { tl: 'Nobody Real Atall' }));   // every real leader would be removed → over the cap of 3
  const r3 = await publish(file3, { apply: true, asOf: ASOF, fp: 'list:test3' });
  ok(r3.status === 'REFUSED' && r3.stage === 'leaders' && r3.reason === 'too_many_removals', 'refused at the leaders stage', r3.status + '/' + r3.stage + '/' + r3.reason);
  ok((await one(`select count(*)::int n from app_users where role = 'agent'`)).n === agentsNow, 'the agent floor is exactly as before');
  ok((await one(`select count(*)::int n from app_users where role = 'agent' and team = 'Nobody Real Atall'`)).n === 0, 'no agent was moved to the phantom leader — the agents\' updates rolled back too');
  ok((await one(`select count(*)::int n from app_users where role = 'team_leader'`)).n > 0, 'no team leader account was removed');
  ok(/leaders stage/.test((await one(`select detail from agent_sync_logs where status = 'REFUSED' order by created_at desc limit 1`)).detail), 'the refusal is on the sync log with its stage');
  ok(/Nothing was changed/.test(r3.detail || ''), 'and the caller is told nothing changed');
  await c.query('rollback to savepoint g');

  head('H · INTEGRITY CATCHES A DRIFT WITHIN ONE QUERY');
  await c.query('savepoint h');
  await c.query(`delete from app_users where username = lower($1)`, [CB(5)]);
  I = await integ();
  ok(I['agent on the latest list with no active login'].failures === 1, 'an agent whose login vanished is one failure');
  await c.query(`insert into campaigns (key, label, active) values ('phantom', 'Phantom', true)`);
  I = await integ();
  ok(I['campaign that the latest list does not carry'].failures === 1, 'a campaign the list does not carry is one failure');
  await c.query('rollback to savepoint h');
} finally {
  await c.query('rollback');
  await c.end();
}
console.log('\n' + pass + ' passed, ' + fail + ' failed  (transaction rolled back — nothing was written)');
process.exitCode = fail ? 1 : 0;
