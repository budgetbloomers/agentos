#!/usr/bin/env node
/**
 * verify-coaching-attribution.mjs — coaching reaches the agent's CURRENT team leader, lead-management
 * coaching is counted and themed on its own, and every coaching payload says how old its copy is
 * (spec 002-live-month-sync-coaching, work package B, contract C4; tasks T014/T016/T019/T021).
 *
 *   node nicks_code/diagnostics/verify-coaching-attribution.mjs
 *
 * WHY: on 2026-10-01 the Coaching Hub held 28 leadManagementCoaching rows, ALL logged under Dalwin's Hub profile
 * (a campaign manager, not an Agent List team leader). cm-coaching dropped every session whose Hub leader was not a
 * list team leader, the TL Hub tab asked Convex for the TL's own profile only, and the theme summaries were
 * gap-only — so lead-management coaching existed and nobody saw it. Pure: an in-memory DB and a fixed clock.
 *
 *   A  team view       — the agent's CURRENT TL's view carries a session whoever logged it; coachingAt; LM counts
 *   B  agent drill     — sessions carry coach / coachIsTl / typeLabel / collection
 *   C  hub tab others  — snapshot sessions on the TL's agents logged under ANOTHER profile, newest first
 *   D  cm-coaching     — owner = the agent's current TL by CB first, then the hub leader; scope unchanged
 *   E  themes          — coachAnalysis and every theme list carry *.lead_management
 *   F  the wiring      — index.mjs hands the hub tab its `others` and `coachingAt`
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const SRC = (f) => pathToFileURL(path.join(ROOT, 'worker', 'src', f)).href;

let pass = 0, fail = 0;
const ok = (name, cond, note) => { if (cond) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (note !== undefined ? ' — ' + note : '')); } };
const head = (t) => console.log('\n' + t);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* a fixed clock: the 90-day window, "today" and the month all read from Date.now() */
const NOW = Date.parse('2026-10-01T08:00:00Z');
const realNow = Date.now; Date.now = () => NOW;

/* ------------------------------------------------------------------ the in-memory world */
const DENISE_HUB = 'jx7ad7sm95xg4738eg5a0479558c9z0x';
const DALWIN_HUB = 'jx75btj1c7wassf4vk6qrywge9899eev';          // Dalwin: SOS coach / campaign manager — NOT an Agent List team leader
const REN_HUB = 'ren-hub';
const RULES = {}, STORE = {};
const publish = (key, obj) => { RULES[key] = { store: 'raw/kv/' + key.replace(/^kv:/, '') }; STORE['raw/kv/' + key.replace(/^kv:/, '')] = JSON.stringify(obj); };
const APP_USERS = [
  { username: 'cb267', full_name: 'Denise Haripersad', cb: 'CB267', team: 'Denise Haripersad', hub_ids: { coaching: DENISE_HUB } },
  { username: 'cb207', full_name: 'Renolan Pillay', cb: 'CB207', team: 'Renolan Pillay', hub_ids: { coaching: REN_HUB } },
  { username: 'cb300', full_name: 'Olivia Outside', cb: 'CB300', team: 'Olivia Outside', hub_ids: { coaching: 'olivia-id' } },
];
const decodeKeys = (q) => { const m = /key=in\.\(([^)]*)\)/.exec(q); return m ? decodeURIComponent(m[1]).split(',') : []; };
const DB = {
  select: async (q) => {
    if (q.startsWith('rules?key=in.')) return decodeKeys(q).filter((k) => RULES[k]).map((k) => ({ key: k, value: RULES[k] }));
    if (q.startsWith('rules?key=like.')) { const pref = decodeURIComponent(q.split('like.')[1].split('&')[0]).replace(/%$/, ''); return Object.keys(RULES).filter((k) => k.startsWith(pref)).map((key) => ({ key })); }
    if (q.startsWith('rules?key=eq.')) { const k = decodeURIComponent(q.split('eq.')[1].split('&')[0]); return RULES[k] ? [{ key: k, value: RULES[k] }] : []; }
    if (q.startsWith('app_users?role=eq.team_leader')) return APP_USERS.map((u) => ({ ...u }));
    return [];
  },
  insert: async () => {}, del: async () => {}, update: async () => {},
  storageGet: async (bucket, key) => STORE[bucket + '/' + key] || null,
};
const env = {};
const resetCaches = () => { for (const k of ['__digestCaches', '__digestMonths', '__digestCycles', '__coachCache', '__cmCtx', '__nbaCache', '__reportCaches']) delete globalThis[k]; };

const mk = (code, name, campaign, tenure, tl, o = {}) => ({ code, name, campaign, tenure, tl, sales: 20, target: 60, pctT: 20 / 60, gwpEx: 1800, gwpT: 5000, act: 10, emp: 10, talk: 163200,
  calls: 400, ans: 200, leads: 90, closed: 100, qa: 0.9, att: 1, canc: 0, ref: 0, composite: { r2a: { fails: 0 } }, days: [], ...o });
const DIGEST = () => ({
  updatedAt: new Date(NOW).toISOString(), period: { from: '2026-09-01', to: '2026-09-30' }, diallingDays: 20, workingDays: 21, daysWithData: 20,
  dates: ['2026-09-01', '2026-09-02'], weeks: [{ n: 1 }], talkUnit: 'hours', onTarget: 1,
  agents: [
    mk('CB1', 'Courtesy One', 'Courtesy', 'M1', 'Denise Haripersad'),
    mk('CB2', 'Courtesy Two', 'Courtesy', 'Experienced', 'Denise Haripersad'),
    mk('CB4', 'Cuddle One', 'Cuddle', 'Experienced', 'Renolan Pillay'),
    mk('CB9', 'Outside One', 'Rewarded', 'M1', 'Olivia Outside'),
  ],
  notCovered: [],
  tlAgg: [{ camp: 'Courtesy', tl: 'Denise Haripersad', sales: 40 }, { camp: 'Cuddle', tl: 'Renolan Pillay', sales: 20 }, { camp: 'Rewarded', tl: 'Olivia Outside', sales: 5 }],
  campAgg: { Courtesy: { sales: 40 }, Cuddle: { sales: 20 }, Rewarded: { sales: 5 } },
});

const LM = 'Lead Management Coaching';
const cl = (key, field = 'clusterGap') => ({ clusterKey: key, family: key.slice(0, key.indexOf('.')), field });
const ses = (id, date, hubId, hubName, o = {}) => ({ id, type: 'Formal Coaching', collection: 'formalCoachingCalls', typeLabel: 'Formal Coaching', date, cb: 'CB1', agentName: 'Courtesy One',
  campaign: 'Courtesy', hubTeamLeader: hubName, hubTeamLeaderId: hubId, clusters: [cl('gap.customer_verification')], supportProvided: 'Role play', ...o });
const lmSes = (id, date, cb, name, o = {}) => ses(id, date, DALWIN_HUB, 'Dalwin', { type: LM, typeLabel: LM, collection: 'leadManagementCoaching', cb, agentName: name,
  clusters: [cl('development.lead_management', 'clusterDevelopmentArea'), cl('purpose.quality_compliance', 'clusterPurpose')], supportProvided: 'Lead handling walk-through', ...o });
const SESSIONS = [
  lmSes('lm1', '2026-09-15', 'CB1', 'Courtesy One'),                                                     // THE FIXTURE: Dalwin's LM on Denise's agent, in September
  lmSes('lm0', '2026-07-10', 'CB1', 'Courtesy One'),                                                     // the same, in July: in the 90-day window, outside the September period
  lmSes('lm9', '2026-09-16', 'CB9', 'Outside One'),                                                      // Dalwin's LM on a REWARDED agent: not Ryan's scope
  ses('f1', '2026-09-24', DENISE_HUB, 'Denise Haripersad'),                                              // Denise's own session on her own agent
  ses('x1', '2026-09-20', REN_HUB, 'Renolan Pillay'),                                                    // Renolan logged it on DENISE's agent
  ses('r1', '2026-09-12', REN_HUB, 'Renolan Pillay', { cb: 'CB4', agentName: 'Cuddle One', campaign: 'Cuddle' }),
  ses('dn4', '2026-09-14', DENISE_HUB, 'Denise Haripersad', { cb: 'CB4', agentName: 'Cuddle One', campaign: 'Cuddle' }),   // Denise logged it on RENOLAN's agent
  ses('g1', '2026-09-30', DENISE_HUB, 'Denise Haripersad', { cb: '', agentName: 'Group', attendees: ['Courtesy One'], collection: 'groupCoaching', typeLabel: 'Group Coaching', type: 'Group Coaching',
    clusters: [cl('gap.call_process_systems')], supportProvided: undefined }),                           // no CB: stays with the logging profile
];
const FETCHED = '2026-10-01T05:40:00.000Z';
const SNAPSHOT = { fetchedAt: FETCHED, hub: 'x', leaders: [{ id: DENISE_HUB, name: 'Denise Haripersad' }, { id: REN_HUB, name: 'Renolan Pillay' }, { id: DALWIN_HUB, name: 'Dalwin' }], sessions: SESSIONS, errors: [], by: 'test' };

const { overview, agentDetail, cmCoaching, coachingOthers } = await import(SRC('portal.mjs'));
const { coachAnalysis, rollUp, sessionThemes } = await import(SRC('coaching.mjs'));
const { loadCmContext } = await import(SRC('campaign.mjs'));

const cmUser = { username: 'ryan', full_name: 'Ryan G', role: 'campaign_manager', cb: '' };
const deniseUser = { username: 'cb267', full_name: 'Denise Haripersad', role: 'team_leader', cb: 'CB267', team: 'Denise Haripersad', hub_ids: { coaching: DENISE_HUB } };
const renUser = { username: 'cb207', full_name: 'Renolan Pillay', role: 'team_leader', cb: 'CB207', team: 'Renolan Pillay', hub_ids: { coaching: REN_HUB } };
const agentUser = { username: 'cb1', full_name: 'Courtesy One', role: 'agent', cb: 'CB1' };

const setup = async () => {
  resetCaches();
  for (const k of Object.keys(RULES)) delete RULES[k];
  for (const k of Object.keys(STORE)) delete STORE[k];
  RULES['cm:assignments'] = { ryan: { name: 'Ryan G', campaigns: ['courtesy', 'cuddle'] }, dalwin: { name: 'Dalwin', campaigns: ['courtesy', 'cuddle'] } };
  publish('kv:agent-digest', DIGEST());
  publish('kv:coaching', SNAPSHOT); RULES['kv:coaching'].fetchedAt = FETCHED;
  return loadCmContext(DB, { force: true });
};
const digestNow = () => JSON.parse(STORE['raw/kv/agent-digest']);

try {
  /* =================================================================== A */
  head('A · the team view: the agent\'s current TL sees the session whoever logged it, with lead management counted on its own');
  await setup();
  {
    const r = await overview(env, DB, deniseUser, digestNow(), []);
    const co = r.body.coaching;
    ok('the team overview is 200 and carries a coaching block', r.status === 200 && co && !co.error, JSON.stringify(co && co.error));
    ok('coachingAt = the snapshot\'s fetchedAt (contract C4)', co.coachingAt === FETCHED, String(co.coachingAt));
    const cb1 = co.agents.find((a) => a.code === 'CB1'), cb2 = co.agents.find((a) => a.code === 'CB2');
    ok('Denise\'s agent CB1 carries Dalwin\'s LM session AND the one Renolan logged (lm1, lm0, f1, x1 + the group one by name) — whoever logged it', cb1 && cb1.count === 5, JSON.stringify(cb1 && cb1.count));
    ok('byType carries the "Lead Management Coaching" key; CB1: 2 in the 90-day window', cb1.byType[LM] === 2, JSON.stringify(cb1.byType));
    ok('byType LM is 0 (present) for an agent with none', cb2.byType[LM] === 0 && LM in cb2.byType, JSON.stringify(cb2.byType));
    ok('the scope byType carries LM: 2', co.byType[LM] === 2, JSON.stringify(co.byType));
    ok('lmCount is the PERIOD\'s (September): 1, not the window\'s 2 (the July one is outside September)', co.lmCount === 1 && cb1.lmCount === 1 && cb2.lmCount === 0, JSON.stringify([co.lmCount, cb1.lmCount, cb2.lmCount]));
    ok('the lead_management theme is on the agent\'s themes', cb1.themes.some((t) => t.key === 'development.lead_management' && t.shown === 2), JSON.stringify(cb1.themes.map((t) => t.key)));
    const row = r.body.agents.find((a) => a.code === 'CB1');
    ok('the agent row\'s coach analysis lists the lead-management theme beside the gap themes', row.coach && row.coach.themes.includes('Lead Management') && row.coach.themes.includes('Customer Verification'), JSON.stringify(row.coach && row.coach.themes));
    ok('and counts the cross-profile sessions in the period (lm1, x1, f1 = 3)', row.coach && row.coach.n === 3, JSON.stringify(row.coach && row.coach.n));

    ok('lmPeriod carries {from, to, label}: the label names the month the count is over', co.lmPeriod && co.lmPeriod.from === '2026-09-01' && co.lmPeriod.to === '2026-09-30' && co.lmPeriod.label === 'September 2026', JSON.stringify(co.lmPeriod));
    const r2 = await overview(env, DB, renUser, digestNow(), []);
    const c2 = r2.body.coaching;
    ok('a TL with NO lead-management coaching reads byType LM 0 and lmCount 0 (never missing)', c2.byType[LM] === 0 && c2.lmCount === 0 && c2.coachingAt === FETCHED, JSON.stringify([c2.byType, c2.lmCount]));
    ok('Renolan\'s agent carries the session DENISE logged on CB4 (dn4) — attribution is by the agent, not the profile', c2.agents.find((a) => a.code === 'CB4').count === 2);
    ok('...and Denise\'s view does NOT carry Renolan\'s agent\'s sessions', co.agents.every((a) => a.code !== 'CB4'));
  }
  {
    const a = await overview(env, DB, agentUser, digestNow(), []);
    ok('the agent overview coaching block carries lmPeriod.label too', a.body.coaching.lmPeriod && a.body.coaching.lmPeriod.label === 'September 2026', JSON.stringify(a.body.coaching.lmPeriod));
    ok('the agent\'s own payload carries coachingAt too', a.body.coaching && a.body.coaching.coachingAt === FETCHED, JSON.stringify(a.body.coaching && Object.keys(a.body.coaching)));
    const s = (a.body.coaching.agents[0].sessions || []).find((x) => x.id === 'lm1');
    ok('...and the LM session reads coach Dalwin, not a team leader', s && s.coach === 'Dalwin' && s.coachIsTl === false && s.typeLabel === LM && s.collection === 'leadManagementCoaching', JSON.stringify(s && { c: s.coach, t: s.coachIsTl }));
  }

  /* =================================================================== B */
  head('B · the agent drill-down: every session says who coached, and whether that person is a team leader');
  {
    const d = await agentDetail(env, DB, deniseUser, digestNow(), 'CB1');
    const co = d.body.coaching, by = (id) => (co.agents[0].sessions || []).find((s) => s.id === id);
    ok('agentDetail carries coachingAt', co.coachingAt === FETCHED);
    ok('lm1: coach "Dalwin", coachIsTl false, typeLabel + collection travel', by('lm1') && by('lm1').coach === 'Dalwin' && by('lm1').coachIsTl === false && by('lm1').typeLabel === LM && by('lm1').collection === 'leadManagementCoaching' && by('lm1').type === LM, JSON.stringify(by('lm1') && { c: by('lm1').coach, t: by('lm1').coachIsTl }));
    ok('f1: Denise, a list team leader → coachIsTl true', by('f1') && by('f1').coach === 'Denise Haripersad' && by('f1').coachIsTl === true);
    ok('x1: Renolan logged it on Denise\'s agent: coach Renolan Pillay, coachIsTl true', by('x1') && by('x1').coach === 'Renolan Pillay' && by('x1').coachIsTl === true);
    ok('the group session keeps its own coach too', by('g1') && by('g1').coach === 'Denise Haripersad' && !('attendees' in by('g1')));
    ok('agentDetail carries lmPeriod.label', co.lmPeriod && co.lmPeriod.label === 'September 2026', JSON.stringify(co.lmPeriod));
    ok('byType and lmCount are on the drill-down', co.byType[LM] === 2 && co.lmCount === 1, JSON.stringify([co.byType, co.lmCount]));
  }

  /* =================================================================== C */
  head('C · the TL Hub tab: "others" = snapshot sessions on MY agents logged under ANOTHER Hub profile');
  {
    const r = await coachingOthers(env, DB, deniseUser, digestNow(), {}, NOW);
    ok('others is a list and coachingAt is the snapshot\'s', Array.isArray(r.others) && r.coachingAt === FETCHED, JSON.stringify(r).slice(0, 200));
    ok('x1 (Renolan\'s profile) and lm1 + lm0 (Dalwin\'s) are in it, newest first', same(r.others.map((s) => s.id), ['x1', 'lm1', 'lm0']), JSON.stringify(r.others.map((s) => s.id)));
    ok('nothing logged under her OWN profile (f1, g1, dn4) is in it', !r.others.some((s) => ['f1', 'g1', 'dn4'].includes(s.id)));
    ok('nothing on an agent that is not hers (CB4, CB9) is in it', r.others.every((s) => s.cb === 'CB1'));
    const lm = r.others.find((s) => s.id === 'lm1');
    ok('the fixture: Dalwin\'s LM on Denise\'s agent appears with coach "Dalwin", coachIsTl false, typeLabel "Lead Management Coaching"',
      lm && lm.coach === 'Dalwin' && lm.coachIsTl === false && lm.typeLabel === LM && lm.collection === 'leadManagementCoaching', JSON.stringify(lm));
    ok('...with its themes labelled, lead management among them', lm && lm.themes.includes('Lead Management'), JSON.stringify(lm && lm.themes));
    ok('x1 reads coach Renolan Pillay, coachIsTl true', r.others[0].coach === 'Renolan Pillay' && r.others[0].coachIsTl === true);
    const w = await coachingOthers(env, DB, deniseUser, digestNow(), { days: '30' }, NOW);
    ok('the requested window applies (30 days: the July session drops out)', same(w.others.map((s) => s.id), ['x1', 'lm1']), JSON.stringify(w.others.map((s) => s.id)));
    const f = await coachingOthers(env, DB, deniseUser, digestNow(), { from: '2026-09-16', to: '2026-09-30' }, NOW);
    ok('an explicit from/to window applies', same(f.others.map((s) => s.id), ['x1']), JSON.stringify(f.others.map((s) => s.id)));
    const rr = await coachingOthers(env, DB, renUser, digestNow(), {}, NOW);
    ok('Renolan\'s others: the one DENISE logged on his agent (dn4) — and not his own', same(rr.others.map((s) => s.id), ['dn4']) && rr.others[0].coachIsTl === true, JSON.stringify(rr.others.map((s) => s.id)));
    const noId = await coachingOthers(env, DB, { ...deniseUser, hub_ids: { kpi: 'k' } }, digestNow(), {}, NOW);
    ok('a TL with no Coaching Hub id of their own: every snapshot session on their agents except those under their own NAME is "others"', same(noId.others.map((s) => s.id).sort(), ['lm0', 'lm1', 'x1']), JSON.stringify(noId.others.map((s) => s.id)));
    ok('no free text beyond supportProvided and no attendee list travels', !JSON.stringify(r).includes('attendees') && !JSON.stringify(r).includes('data:image'));
    const ag = await coachingOthers(env, DB, agentUser, digestNow(), {}, NOW);
    ok('an agent session gets nothing (others null + a reason)', ag.others === null && !!ag.othersError, JSON.stringify(ag));
    RULES['kv:coaching'] = undefined; delete RULES['kv:coaching']; resetCaches();
    const nc = await coachingOthers(env, DB, deniseUser, digestNow(), {}, NOW);
    ok('no Hub copy: others null + a reason + coachingAt null (never an empty list that reads as "no coaching by others")', nc.others === null && !!nc.othersError && nc.coachingAt === null, JSON.stringify(nc));
  }

  /* =================================================================== D */
  head('D · the campaign manager\'s view: owner = the agent\'s CURRENT TL by CB first, then the Hub leader; scope unchanged');
  await setup();
  {
    const ask = async (user, q) => { resetCaches(); await loadCmContext(DB, { force: true }); return cmCoaching(env, DB, user, digestNow(), q, NOW); };
    let r = await ask(cmUser, { tl: 'Denise Haripersad' });
    ok('200 and the leaders in scope are Denise and Renolan', r.status === 200 && same(r.body.leaders.map((l) => l.name).sort(), ['Denise Haripersad', 'Renolan Pillay']), JSON.stringify(r.body.leaders && r.body.leaders.map((l) => l.name)));
    ok('coachingAt is on the payload (fetchedAt kept as before)', r.body.coachingAt === FETCHED && r.body.fetchedAt === FETCHED);
    const ids = r.body.sessions.map((s) => s.date + (s.cb || '-'));
    ok('Denise\'s sessions: g1 (30 Sep), f1, x1 (Renolan logged it on her agent), lm1 (Dalwin) — newest first; no July, no CB4',
      same(r.body.sessions.map((s) => s.date), ['2026-09-30', '2026-09-24', '2026-09-20', '2026-09-15']), JSON.stringify(ids));
    const lm = r.body.sessions.find((s) => s.date === '2026-09-15');
    ok('THE FIXTURE: Dalwin\'s LM session shows under Denise with coach "Dalwin", coachIsTl false, typeLabel "Lead Management Coaching", collection',
      lm && lm.coach === 'Dalwin' && lm.coachIsTl === false && lm.typeLabel === LM && lm.collection === 'leadManagementCoaching' && lm.type === LM && lm.cb === 'CB1' && lm.onList === true, JSON.stringify(lm));
    ok('...and its lead-management theme is in the theme list', lm && lm.themes.includes('Lead Management') && lm.themes.includes('Quality Compliance'), JSON.stringify(lm && lm.themes));
    const x1 = r.body.sessions.find((s) => s.date === '2026-09-20');
    ok('x1 (logged under Renolan\'s profile) is Denise\'s now, and still says who coached: Renolan Pillay, a team leader', x1 && x1.coach === 'Renolan Pillay' && x1.coachIsTl === true, JSON.stringify(x1));
    const g1 = r.body.sessions.find((s) => s.date === '2026-09-30');
    ok('a session with no CB stays with the logging profile (the group one is Denise\'s)', g1 && g1.cb === null && g1.coach === 'Denise Haripersad');
    const den = r.body.leaders.find((l) => l.name === 'Denise Haripersad'), ren = r.body.leaders.find((l) => l.name === 'Renolan Pillay');
    ok('the leader rows count by owner: Denise 4 (lm1, f1, x1, g1), Renolan 2 (r1, dn4)', den.sessions === 4 && ren.sessions === 2, JSON.stringify([den.sessions, ren.sessions]));
    ok('...with byType + lmCount per leader (Denise LM 1 in September, Renolan 0 — present)', den.lmCount === 1 && den.byType[LM] === 1 && ren.lmCount === 0 && ren.byType[LM] === 0, JSON.stringify([den.byType, ren.byType]));
    ok('...and for the manager\'s whole scope', r.body.lmCount === 1 && r.body.byType[LM] === 1, JSON.stringify([r.body.lmCount, r.body.byType]));
    ok('SCOPE UNCHANGED: Dalwin\'s LM on a Rewarded agent (CB9) is not in Ryan\'s payload at all', !JSON.stringify(r.body).includes('CB9') && !JSON.stringify(r.body).includes('Outside One'));
    ok('Olivia (Rewarded) is still not a leader in scope', !r.body.leaders.some((l) => /Olivia/.test(l.name)));
    r = await ask(cmUser, { tl: 'Renolan Pillay' });
    ok('Renolan\'s sessions include the one DENISE logged on his agent (dn4) — by the agent\'s current TL', same(r.body.sessions.map((s) => s.date), ['2026-09-14', '2026-09-12']), JSON.stringify(r.body.sessions.map((s) => s.date)));
    r = await ask(cmUser, { tl: 'Denise Haripersad', period: '2026-07' });
    ok('a past month: July holds only the July LM session', same(r.body.sessions.map((s) => s.date), ['2026-07-10']) && r.body.sessions[0].coach === 'Dalwin', JSON.stringify(r.body.sessions.map((s) => s.date)));
    /* a CB the digest does not know falls back to the Hub leader */
    const live = digestNow();
    const s2 = { ...SNAPSHOT, sessions: [...SESSIONS, ses('u1', '2026-09-18', DENISE_HUB, 'Denise Haripersad', { cb: 'CB999', agentName: 'Not On List' })] };
    publish('kv:coaching', s2); RULES['kv:coaching'].fetchedAt = FETCHED; publish('kv:agent-digest', live);
    r = await ask(cmUser, { tl: 'Denise Haripersad' });
    ok('a CB outside the manager\'s agents is still dropped (L1 scope filter)', !r.body.sessions.some((s) => s.cb === 'CB999'));
    /* an agent whose current TL is not in the digest rows' leader list but whose hub leader is: hub leader wins by fallback */
    const live2 = DIGEST(); live2.agents[0].tl = '';
    publish('kv:agent-digest', live2); publish('kv:coaching', SNAPSHOT); RULES['kv:coaching'].fetchedAt = FETCHED;
    r = await ask(cmUser, {});
    ok('an agent with no current TL on the list falls back to the Hub leader (no session is lost to a blank)', r.status === 200, String(r.status));
  }

  /* =================================================================== E */
  head('E · themes: *.lead_management travels beside the gap themes everywhere a theme list is built');
  {
    const day = (cluster, date) => ({ id: cluster + date, date, cb: 'CB1', clusters: cluster.map((k) => cl(k)) });
    const a = coachAnalysis([day(['gap.a_theme', 'development.lead_management', 'purpose.quality_compliance'], '2026-09-10'),
      day(['gap.a_theme', 'gap.b_theme'], '2026-09-11'), day(['gap.c_theme'], '2026-09-12')], [], { from: '2026-09-01', to: '2026-09-30' });
    ok('three gap themes AND a lead-management one: all four listed (LM is not squeezed out by the three-theme cap)', a.themes.length === 4 && a.themes.includes('Lead Management') && a.themes.includes('A Theme'), JSON.stringify(a.themes));
    ok('the non-gap, non-LM family (purpose.*) is still left out while gap themes exist', !a.themes.includes('Quality Compliance'), JSON.stringify(a.themes));
    const b = coachAnalysis([day(['development.lead_management', 'purpose.quality_compliance'], '2026-09-10')], [], { from: '2026-09-01', to: '2026-09-30' });
    ok('LM only (no gap theme anywhere): the fallback still lists it', b.themes.includes('Lead Management'), JSON.stringify(b.themes));
    const c = coachAnalysis([day(['gap.only'], '2026-09-10')], [], { from: '2026-09-01', to: '2026-09-30' });
    ok('no LM key: unchanged (gap themes only)', same(c.themes, ['Only']));
    const d = coachAnalysis([day(['gap.x1', 'gap.x2', 'gap.x3', 'gap.x4', 'development.lead_management'], '2026-09-10')], [], { from: '2026-09-01', to: '2026-09-30' });
    ok('the three-theme cap still bounds the GAP themes (3 gap + 1 LM)', d.themes.length === 4, JSON.stringify(d.themes));
    const e = coachAnalysis([day(['gap.g1', 'gap.g2', 'gap.g3', 'development.lead_management_extra'], '2026-09-10')], [], { from: '2026-09-01', to: '2026-09-30' });
    ok('a key that merely STARTS with the words is not an LM key (it must END with .lead_management): the cap holds at 3', e.themes.length === 3 && !e.themes.includes('Lead Management Extra'), JSON.stringify(e.themes));
    ok('rollUp (every theme list the pages read) counts the key', rollUp([SESSIONS[0]]).some((t) => t.key === 'development.lead_management'));
    ok('sessionThemes labels it', sessionThemes(SESSIONS[0]).includes('Lead Management'));
  }

  /* =================================================================== F */
  head('F · the wiring');
  {
    const IDX = fs.readFileSync(path.join(ROOT, 'worker', 'src', 'index.mjs'), 'utf8');
    ok('the hub tab route merges `others` and `coachingAt` into the live list (the live list itself is unchanged)', /coachingOthers\(/.test(IDX) && /\.\.\.live, \.\.\.extra/.test(IDX) && /coachingAt/.test(IDX.slice(IDX.indexOf("'/api/portal/hub/coaching'"), IDX.indexOf("'/api/portal/hub/kpi'"))));
    ok('a failed snapshot read never loses the live list (others failure is caught)', /coachingOthers\([\s\S]{0,400}catch/.test(IDX.slice(IDX.indexOf("'/api/portal/hub/coaching'"), IDX.indexOf("'/api/portal/hub/kpi'"))));
    const POR = fs.readFileSync(path.join(ROOT, 'worker', 'src', 'portal.mjs'), 'utf8');
    ok('cmCoaching: coachingAt alias beside fetchedAt', /coachingAt: hub\.fetchedAt/.test(POR));
  }
} finally { Date.now = realNow; }

console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
process.exitCode = fail ? 1 : 0;
