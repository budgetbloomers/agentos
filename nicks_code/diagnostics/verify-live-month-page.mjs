#!/usr/bin/env node
/**
 * verify-live-month-page.mjs — the proof for the Agent Analytics page of spec 002-live-month-sync-coaching
 * (work package C: agent/index.html).
 *
 * Run:  node nicks_code/diagnostics/verify-live-month-page.mjs
 *
 * The page script is evaluated in a stubbed DOM and driven with fixtures shaped EXACTLY like the 002 contracts
 * (specs/002-live-month-sync-coaching/contracts/interfaces.md C1 empty-month digest, C4 coaching). The page only
 * PAINTS: every figure and verdict arrives computed; these checks prove the wording and placement.
 *
 *   A  Empty month      agent Today / My Progress / Projected Commission, TL My Team + five Reports, CM Campaign
 *                       tab: the month is named, no invented figures, "<Month> (final)" re-asks ?month=, way back
 *   B  Coaching views   Lead Management Coaching counted apart, "none logged" line, "by others" block,
 *                       lead-management themes, "coached by <coach>"
 *   C  Coaching age     every coaching surface prints "Coaching Hub copy from <day time>"
 *   D  ES5 + escaping   the new code is plain ES5 and never prints raw data
 *
 * Exit code 0 = safe to ship. Non-zero = do not deploy.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const PAGE = fs.readFileSync(path.join(ROOT, 'agent', 'index.html'), 'utf8');

let fails = 0, checks = 0;
const ok = (m) => { checks++; console.log('  \x1b[32m✓\x1b[0m ' + m); };
const bad = (m, d) => { checks++; fails++; console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '\n      ' + d : '')); };
const head = (m) => console.log('\n\x1b[1m' + m + '\x1b[0m');
const check = (label, fn) => { try { const r = fn(); r === false ? bad(label) : ok(label); } catch (e) { bad(label, e.message); } };
const text = (h) => String(h).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&rsquo;/g, "'").replace(/&#39;/g, "'").replace(/&quot;/g, '"')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const mustText = (h, s, why) => { if (text(h).indexOf(s) < 0) throw new Error((why || 'missing') + ': ' + JSON.stringify(s) + '\n      in: ' + text(h).slice(0, 500)); };
const mustNotText = (h, s, why) => { if (text(h).indexOf(s) >= 0) throw new Error((why || 'must not appear') + ': ' + JSON.stringify(s)); };
const mustNot = (h, s, why) => { if (String(h).indexOf(s) >= 0) throw new Error((why || 'must not appear') + ': ' + JSON.stringify(s)); };
const must = (h, s, why) => { if (String(h).indexOf(s) < 0) throw new Error((why || 'missing') + ': ' + JSON.stringify(s)); };
const clean = (h) => { if (/undefined|NaN|\[object Object\]/.test(h)) throw new Error('placeholder leaked: ' + (h.match(/.{0,40}(undefined|NaN|\[object Object\]).{0,40}/) || [])[0]); };
/* nothing an empty month must never print: a rand, a percentage, "n of m" claims, a rank */
const noFigures = (h) => {
  const t = text(h);
  if (/\bR\s?\d/.test(t)) throw new Error('a rand figure on an empty month: ' + (t.match(/.{0,30}\bR\s?\d.{0,30}/) || [])[0]);
  if (/\d\s?%/.test(t)) throw new Error('a percentage on an empty month: ' + (t.match(/.{0,30}\d\s?%.{0,30}/) || [])[0]);
  if (/\b\d+ of \d+\b/.test(t)) throw new Error('an "n of m" claim on an empty month: ' + (t.match(/.{0,30}\b\d+ of \d+\b.{0,30}/) || [])[0]);
  if (/(^|\s)#\d+|of \d+ (in team|on floor)/i.test(t)) throw new Error('a rank on an empty month');
};

/* ------------------------------------------------------------------ the page, in a stubbed DOM */
function loadPage(routes) {
  const m = PAGE.match(/<script>\n"use strict";([\s\S]*?)<\/script>/);
  if (!m) throw new Error('could not find the page script');
  const src = m[1].replace(/\nboot\(\);\s*$/, '\n');
  const nodes = {};
  const mkEl = () => ({
    innerHTML: '', value: '', style: {}, classList: { add() {}, remove() {}, contains: () => false },
    addEventListener() {}, setAttribute() {}, getAttribute: () => null, querySelectorAll: () => [], querySelector: () => null,
    focus() {}, onclick: null, onchange: null, remove() {}, appendChild() {},
  });
  const doc = { getElementById: (id) => (nodes[id] = nodes[id] || mkEl()), querySelectorAll: () => [], createElement: mkEl, body: mkEl() };
  const store = {}, sess = {};
  const win = {
    location: { search: '' },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; }, removeItem: (k) => { delete store[k]; } },
    scrollTo() {}, addEventListener() {}, confirm: () => true,
  };
  const session = { getItem: (k) => (k in sess ? sess[k] : null), setItem: (k, v) => { sess[k] = String(v); }, removeItem: (k) => { delete sess[k]; } };
  const calls = [];
  const fetchImpl = (url) => {
    const u = String(url).replace(/^https?:\/\/[^/]+/, '');
    calls.push(u);
    const path0 = u.split('?')[0];
    const r = routes && routes[path0] ? routes[path0](u) : { status: 404, body: { error: 'no route in test' } };
    if (r && r.network) return Promise.reject(new Error('offline'));
    return Promise.resolve({ ok: r.status < 400, status: r.status, json: () => Promise.resolve(r.body) });
  };
  const fn = new Function(
    'document', 'window', 'localStorage', 'sessionStorage', 'location', 'fetch', 'URLSearchParams', 'setTimeout', 'setInterval', 'clearInterval', 'Intl', 'console',
    src + '\nvar __o={};'
    + '["render","show","teamView","cmView","coachHTML","coachTeamHTML","coachPageTeam","coachPageAgent","coachHubPage","coachingAnalysisCard","drawerHTML","pageMTD","cmAsk","cmCoachPage","cmCoachPick",'
    + '"askMonth","agentFreshLine","calcMonth","calcNowInitial","comsPage","todayHTML","emptyMonthCard","loadPortal","refreshAgent","refreshPortal","pgCoaching","loginScreen","openAgent"]'
    + '.forEach(function(n){ try{ __o[n]=eval(n); }catch(e){ __o[n]=function(){ throw new Error("the page has no "+n+"()"); }; } });'
    + '__o.setD=function(d){D=d}; __o.getD=function(){return D}; __o.setView=function(v){VIEW=v}; __o.getView=function(){return VIEW}; __o.setMe=function(x){ME=x}; __o.setTeam=function(t){TEAM=t};'
    + '__o.setHub=function(h){HUB.coaching=h}; __o.setSel=function(s){CMSEL=s}; __o.getViewMonth=function(){return VIEWMONTH}; __o.getLiveMonthName=function(){return LIVE_MONTH_NAME};'
    + 'return __o;',
  );
  const api = fn(doc, win, win.localStorage, session, win.location, fetchImpl, URLSearchParams, () => 0, () => 0, () => {}, Intl, { log() {}, error() {} });
  return { P: api, N: nodes, calls, sess, W: win };
}
const tick = () => new Promise((r) => setImmediate(r));
const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };

/* ------------------------------------------------------------------ fixtures, shaped like C1 / C4 */
const SALE = 89 / 1.15;
const OCT_COMM = { month: '2026-10', saleValue: SALE, brackets: { M1: [{ gwp: 9751.3, comm: 4000 }, { gwp: 11000, comm: 6000 }, { gwp: 14000, comm: 9000 }] } };
const OCT = { from: '2026-10-01', to: '2026-10-31' };
const SEP = { from: '2026-09-01', to: '2026-09-30' };
const NULLS = { sales: null, gwpEx: null, pctT: null, spd: null, att: null, qa: null, aveG: null, ref: null, closed: null, leads: null, calls: null, ans: null, talk: null, aveTalk: null, act: null, emp: null, composite: null, days: [], wk: [] };
const emptyRow = (code, name, tl, campaign) => Object.assign({ code, name, tl, campaign, tenure: 'M1', plan: 'M1', target: 100, covered: false }, NULLS);
function emptyBase(over) {
  return Object.assign({
    v: 1, updatedAt: '2026-10-01T06:00:00Z', empty: true, period: OCT, daysWithData: 0, dates: [], weeks: [], diallingDays: 0, workingDays: 22,
    comm: OCT_COMM, tlAgg: [], campAgg: {}, dataReach: { sales: null },
  }, over || {});
}
const EMPTY_COACH = { windowDays: 90, coachingAt: '2026-10-01T14:23:00Z', byType: {}, lmCount: 0, totals: { sessions: 0, agents: 0 }, agents: [] };
const emptyAgent = () => emptyBase({
  role: 'agent', name: 'Ann Agent', me: emptyRow('CB1', 'Ann Agent', 'Denise Haripersad', 'Courtesy'),
  agents: [emptyRow('CB1', 'Ann Agent', 'Denise Haripersad', 'Courtesy')], coaching: { windowDays: 90, coachingAt: '2026-10-01T14:23:00Z', agents: [{ code: 'CB1', count: 0, sessions: [], themes: [] }] },
});
const emptyTeam = () => emptyBase({
  role: 'team_leader', scope: 'team', name: 'Denise Haripersad', team: 'Denise team', totals: {},
  agents: [emptyRow('CB1', 'Ann Agent', 'Denise Haripersad', 'Courtesy'), emptyRow('CB2', 'Bea Buyer', 'Denise Haripersad', 'Courtesy')],
  coaching: EMPTY_COACH,
});
const NULL_KPIS = { sales: null, gwp: null, aveG: null, pitches: null, conv: null, convWhy: 'No October figures yet', talk: null, attempts: null, contactRate: null, contactWhy: '', leads: null, qa: null, checks: null, crit: null, canc: null, att: null };
const emptyCm = () => emptyBase({
  scope: 'campaign', role: 'campaign_manager', name: 'Ryan Manager',
  periods: { months: ['2026-09', '2026-08'], cycles: [
    { key: 'cycle-2026-10', from: '2026-09-26', to: '2026-10-25', label: '26 Sep – 25 Oct 2026', complete: false, published: true },
    { key: 'cycle-2026-09', from: '2026-08-26', to: '2026-09-25', label: '26 Aug – 25 Sep 2026', complete: true, published: true } ] },
  cm: { name: 'Ryan Manager', tenure: 'all', freshness: { label: 'Data uploaded', updatedAt: '2026-10-01T06:00:00Z', stale: false },
    campaigns: [{ key: 'courtesy', label: 'Courtesy', agents: 12, teamLeaders: 2, leaders: 2, tenures: [], kpis: NULL_KPIS, teams: [], brief: { signals: [], actions: [] }, agentIndex: [], unattributed: { agents: [], notCovered: [] } }] },
  assist: { kpis: null, requests: [], blockages: [], blockPanel: [], blockPanelByCamp: {} },
  agents: [emptyRow('CB1', 'Ann Agent', 'Denise Haripersad', 'Courtesy')],
});

const NO_FINAL = (h) => { mustNotText(h, 'No September figures'); };
const EMPTY_MSG = "No October figures yet — the first day lands after tomorrow morning's uploads";

/* ═════════════════════════ A · The empty month ═════════════════════════ */
head('A · Empty month (US1) — October named, no figures, "September (final)" and the way back');
{
  const { P, N, W } = loadPage({});
  W.__agentToday = '2026-10-01';

  P.setTeam(null); P.setD(emptyAgent()); P.setMe(P.getD().me); P.setView('month'); P.show(P.getD().me);
  const today = N.root.innerHTML;
  check('agent Today: headed with October and says the agreed sentence', () => { clean(today); mustText(today, 'October'); mustText(today, EMPTY_MSG); });
  check('agent Today: offers "September (final)" as a button that asks for 2026-09', () => { mustText(today, 'September (final)'); must(today, 'data-askmonth="2026-09"'); });
  check('agent Today: no sales, premium, percentage, "n of m" or rank figures', () => noFigures(today));
  check('agent Today: no "Your number for today" / target claim', () => { mustNotText(today, 'Your number for today'); mustNotText(today, 'target of'); });
  check('agent Today: the fresh line does not claim a reach date for an empty month', () => {
    const fl = (today.match(/<div class="fresh-line">[\s\S]*?<\/div>/) || [''])[0];
    mustNotText(fl, 'Figures to'); mustNotText(fl, 'figures to'); mustNotText(today, 'Figures to');
  });

  P.setView('progress'); P.show(P.getD().me);
  const prog = N.root.innerHTML;
  check('agent My Progress: the same empty card, no figures', () => { clean(prog); mustText(prog, EMPTY_MSG); mustText(prog, 'September (final)'); noFigures(prog); });

  check('Projected Commission at 0 worked days: the first October payout (amount, premium needed, sales, per-day ask)', () => {
    P.setView('calc'); P.show(P.getD().me); const h = N.root.innerHTML; clean(h);
    mustText(h, 'Projected commission — October'); mustText(h, 'your first payout in October');
    mustText(h, 'R 4 000');
  });
  check('Projected Commission names 22 working days from the digest', () => { mustText(N.root.innerHTML, '22 working days'); });
  check('the first-payout mode needs only D.comm — never commNow', () => {
    const d = emptyAgent(); if (d.commNow) throw new Error('fixture has commNow');
    const m = P.calcMonth(); if (!m.fresh || m.total !== 22 || m.worked !== 0 || m.label !== 'October') throw new Error(JSON.stringify({ f: m.fresh, t: m.total, w: m.worked, l: m.label }));
  });
  check('a live month with data and worked days keeps the normal calculator (not the first-payout mode)', () => {
    const d = emptyAgent(); delete d.empty; d.daysWithData = 3; d.dates = ['2026-10-01', '2026-10-02', '2026-10-03'];
    const me = Object.assign({}, d.me, { gwpEx: 5000, sales: 8, act: 3, emp: 3, covered: true }); d.me = me;
    P.setD(d); P.setMe(me); const m = P.calcMonth(); if (m.fresh) throw new Error('fresh mode on a month with worked days');
  });
  check('worked days = 0 in a live (not closed) month with data also shows the first payout', () => {
    const d = emptyAgent(); delete d.empty; d.daysWithData = 3; d.dates = ['2026-10-01', '2026-10-02', '2026-10-03'];
    const me = Object.assign({}, d.me, { gwpEx: 0, sales: 0, act: 0, emp: 0, covered: true }); d.me = me;
    P.setD(d); P.setMe(me); const m = P.calcMonth(); if (!m.fresh) throw new Error('not fresh at 0 worked days');
  });
  check('a CLOSED month at 0 worked days does not pretend to be a new month', () => {
    const d = emptyAgent(); delete d.empty; d.period = SEP; d.daysWithData = 3; d.dates = ['2026-09-01'];
    const me = Object.assign({}, d.me, { gwpEx: 0, sales: 0, act: 0, emp: 0, covered: true }); d.me = me;
    P.setD(d); P.setMe(me); const m = P.calcMonth(); if (m.fresh) throw new Error('fresh mode on a closed month');
  });
}
{
  /* the way to September (final) and back — the agent has no month filter; this exists only in the empty state */
  const SEP_DIGEST = { v: 1, updatedAt: '2026-10-01T06:00:00Z', role: 'agent', name: 'Ann Agent', period: SEP, daysWithData: 21, dates: ['2026-09-29', '2026-09-30'], workingDays: 21,
    comm: { saleValue: SALE, brackets: OCT_COMM.brackets }, agents: [],
    me: Object.assign(emptyRow('CB1', 'Ann Agent', 'Denise Haripersad', 'Courtesy'), { covered: true, sales: 70, gwpEx: 6000, act: 20, emp: 20, pctT: 0.7, spd: 3.5, att: 0.9, qa: 0.9, aveG: 90, ref: 1, days: [] }),
    coaching: { windowDays: 90, coachingAt: '2026-10-01T14:23:00Z', agents: [] } };
  const live = emptyAgent();
  const { P, N, calls, W } = loadPage({ '/api/portal/overview': (u) => (/month=2026-09/.test(u) ? { status: 200, body: SEP_DIGEST } : { status: 200, body: live }) });
  W.__agentToday = '2026-10-01';
  P.setTeam(null); P.setD(live); P.setMe(live.me); P.setView('month'); P.show(live.me);
  await P.askMonth('2026-09'); await settle();
  const h = N.root.innerHTML;
  check('"September (final)" re-asks the overview with ?month=2026-09', () => { if (!calls.some((c) => c === '/api/portal/overview?month=2026-09')) throw new Error(calls.join(' | ')); });
  check('while viewing it: September figures, labelled (final), and a "Back to October" control', () => { clean(h); mustText(h, 'September (final)'); mustText(h, 'Back to October'); must(h, 'data-askmonth=""'); mustNotText(h, EMPTY_MSG); });
  check('the page remembers the month being viewed', () => { if (P.getViewMonth() !== '2026-09') throw new Error(String(P.getViewMonth())); });
  await P.askMonth(''); await settle();
  check('"Back to October" asks the plain overview and shows the empty state again', () => {
    if (calls[calls.length - 1] !== '/api/portal/overview') throw new Error(calls[calls.length - 1]);
    mustText(N.root.innerHTML, EMPTY_MSG); mustNotText(N.root.innerHTML, 'Back to October'); if (P.getViewMonth() !== '') throw new Error('still pinned');
  });
  check('a malformed month is never asked for', () => { const n = calls.length; P.askMonth('2026-9; drop'); if (calls.length !== n) throw new Error('asked'); });
  const bad404 = loadPage({ '/api/portal/overview': (u) => (/month=/.test(u) ? { status: 404, body: { error: 'period_not_published' } } : { status: 200, body: live }) });
  bad404.W.__agentToday = '2026-10-01';
  bad404.P.setTeam(null); bad404.P.setD(live); bad404.P.setMe(live.me); bad404.P.setView('month'); bad404.P.show(live.me);
  await bad404.P.askMonth('2026-09'); await settle();
  check('a refused month leaves the empty state on screen and the live view un-pinned', () => { mustText(bad404.N.root.innerHTML, EMPTY_MSG); if (bad404.P.getViewMonth() !== '') throw new Error('pinned to a month that failed'); });
}
{
  /* review fixes: 401 forgets the pinned month; openAgent honours it; a payload without `me` still opens and returns */
  const noMe = (d) => { const c = Object.assign({}, d); delete c.me; return c; };
  const live = noMe(emptyAgent());
  const SEPD = { v: 1, updatedAt: '2026-10-01T06:00:00Z', role: 'agent', name: 'Ann Agent', period: SEP, daysWithData: 21, dates: ['2026-09-30'], workingDays: 21, comm: OCT_COMM, agents: [],
    me: Object.assign(emptyRow('CB1', 'Ann Agent', 'Denise', 'Courtesy'), { covered: true, sales: 70, gwpEx: 6000, act: 20, emp: 20 }), coaching: { windowDays: 90, agents: [] } };
  const { P, N, calls, W } = loadPage({ '/api/portal/overview': (u) => ({ status: 200, body: /month=2026-09/.test(u) ? SEPD : live }), '/api/portal/agent': () => ({ status: 200, body: SEPD }) });
  W.__agentToday = '2026-10-01';
  P.setTeam(null); P.setD(live); P.setView('month'); P.render();
  check('an empty agent payload with no `me` still renders the empty card (synthesised like loadPortal)', () => { mustText(N.root.innerHTML, EMPTY_MSG); });
  await P.askMonth('2026-09'); await settle();
  check('"September (final)" opens for an agent whose live payload has no `me`', () => { if (P.getViewMonth() !== '2026-09') throw new Error('not pinned'); mustText(N.root.innerHTML, 'Back to October'); });
  P.openAgent('CB1'); await settle();
  check('openAgent asks for the pinned month: /api/portal/agent?cb=CB1&month=2026-09', () => { if (!calls.some((c) => c === '/api/portal/agent?cb=CB1&month=2026-09')) throw new Error(calls.join(' | ')); });
  await P.askMonth(''); await settle();
  check('"Back to October" works when the live payload has no `me`', () => { if (P.getViewMonth() !== '') throw new Error('still pinned'); mustText(N.root.innerHTML, EMPTY_MSG); });
  P.openAgent('CB1'); await settle();
  check('openAgent is plain when no month is pinned', () => { if (calls[calls.length - 1] !== '/api/portal/agent?cb=CB1') throw new Error(calls[calls.length - 1]); });
  await P.askMonth('2026-09'); await settle();
  P.loginScreen('Your session has expired. Please sign in again.');
  check('the sign-in screen forgets the pinned month and the live month name (a 401 never leaks it to the next person)', () => { if (P.getViewMonth() !== '') throw new Error('VIEWMONTH survived: ' + P.getViewMonth()); if (P.getLiveMonthName() !== '') throw new Error('LIVE_MONTH_NAME survived'); });
}
{
  const live = emptyTeam();
  const { P, N, W } = loadPage({});
  W.__agentToday = '2026-10-01';
  const VIEWS = [['team', 'My Team'], ['results', 'Team Results'], ['mtd_team', 'Month to date'], ['daily_team', 'Daily'], ['weekly_team', 'Weekly'], ['variance_team', 'Variance'], ['leads_team', 'Lead management']];
  for (const [v, label] of VIEWS) {
    P.setTeam(null); P.setD(live); P.setView(v); P.render();
    const h = N.root.innerHTML;
    check('TL ' + label + ': the empty card, a September (final) link, no empty tables or figures', () => {
      clean(h); mustText(h, EMPTY_MSG); mustText(h, 'September (final)'); must(h, 'data-askmonth="2026-09"');
      mustNot(h, '<tbody>', 'an empty table'); mustNotText(h, 'Nobody on your team has figures'); mustNotText(h, 'Not reported on this page');
      const body = h.replace(/<aside[\s\S]*?<\/aside>/, '').replace(/<div class="foot">[\s\S]*$/, ''); noFigures(body);
    });
  }
  check('TL Reports keep their sub-tabs so the five reports stay reachable', () => {
    P.setD(live); P.setView('mtd_team'); P.render(); const h = N.root.innerHTML;
    for (const l of ['Month to date', 'Daily', 'Weekly', 'Variance', 'Lead management']) mustText(h, l);
  });
  check('the leader agent drawer in an empty month: the empty sentence, no tiles, no rank', () => {
    P.setD(live);
    const h = P.drawerHTML({ me: emptyRow('CB1', 'Ann Agent', 'Denise Haripersad', 'Courtesy'), nba: null, coaching: EMPTY_COACH });
    clean(h); mustText(h, EMPTY_MSG); mustNot(h, 'dk-tiles'); noFigures(h);
  });
  check('a leader drill-down into an agent in an empty month shows the empty card with no way out of it', () => {
    const a = emptyAgent(); a.__back = emptyTeam(); P.setTeam(emptyTeam()); P.setD(a); P.setMe(a.me); P.setView('month'); P.show(a.me);
    const h = N.root.innerHTML; mustText(h, EMPTY_MSG); mustNot(h, 'data-askmonth'); P.setTeam(null);
  });
  check('the empty month is never described by a data range ("1 – 31 October")', () => { P.setD(live); P.setView('team'); P.render(); mustNotText(N.root.innerHTML, '1 – 31 October'); });
}
{
  const live = emptyCm();
  const { P, N, calls, W } = loadPage({ '/api/portal/overview': () => ({ status: 404, body: { error: 'period_not_published', period: { key: '2026-09', label: 'September 2026' }, message: 'not built yet' } }) });
  W.__agentToday = '2026-10-01';
  for (const v of ['cm', 'cm_teams', 'cm_mtd', 'cm_daily', 'cm_weekly', 'cm_variance', 'cm_leads']) {
    P.setTeam(null); P.setD(live); P.setView(v); P.render();
    const h = N.root.innerHTML;
    check('CM ' + v + ': the October empty state offers September (final) and the billing month in progress', () => {
      clean(h); mustText(h, EMPTY_MSG); mustText(h, 'September (final)'); mustText(h, 'Billing month 26 Sep – 25 Oct'); mustText(h, '(in progress)');
      must(h, 'data-cmask="2026-09"'); must(h, 'data-cmask="cycle-2026-10"');
    });
  }
  check('CM Assistance and Settings are not blanked by the empty month', () => {
    P.setD(live); P.setView('cm_assist'); P.render(); mustNotText(N.root.innerHTML, EMPTY_MSG);
  });
  P.setD(live); P.setView('cm'); P.render();
  await P.cmAsk('2026-09', 'all'); await settle();
  check('September (final) asks /api/portal/overview?period=2026-09&tenure=all', () => { if (!calls.some((c) => c === '/api/portal/overview?period=2026-09&tenure=all')) throw new Error(calls.join(' | ')); });
  await P.cmAsk('cycle-2026-10', 'all'); await settle();
  check('the billing month asks period=cycle-2026-10', () => { if (!calls.some((c) => c.indexOf('period=cycle-2026-10') >= 0)) throw new Error(calls.join(' | ')); });
}

/* ═════════════════════════ B · Coaching views ═════════════════════════ */
head('B · Coaching views (US4) — Lead Management Coaching apart, none-logged line, others block, themes, coach');
const T = (key, family, shown, extra) => Object.assign({ key, family, shown, scored: 0, last: '2026-07-20' }, extra || {});
const LM_SESSION = { date: '2026-07-20', agentName: 'Ann Agent', cb: 'CB1', type: 'Lead Management Coaching', typeLabel: 'Lead Management Coaching', collection: 'leadManagementCoaching', coach: 'Dalwin (SOS)', coachIsTl: false, themes: ['Lead Management'] };
const OWN_SESSION = { date: '2026-09-20', agentName: 'Ann Agent', cb: 'CB1', type: 'Formal Coaching', typeLabel: 'Formal Coaching', collection: 'formalCoachingCalls', coach: 'Denise Haripersad', coachIsTl: true, themes: ['Compliance Required Wording'] };
const liveTeam = (over) => Object.assign(emptyTeam(), { empty: undefined, period: SEP, daysWithData: 2, dates: ['2026-09-01'], agents: [Object.assign(emptyRow('CB1', 'Ann Agent', 'Denise Haripersad', 'Courtesy'), { covered: true, sales: 5 })] }, over || {});
{
  const { P, N } = loadPage({});
  const COACH = {
    windowDays: 90, coachingAt: '2026-10-01T14:23:00Z', stale: false, lmCount: 0,
    byType: { 'Formal Coaching': 3, 'Informal Coaching': 1, 'Quality Assurance Coaching': 5, 'Lead Management Coaching': 0 },
    totals: { sessions: 9, agents: 1, scored: 0 },
    agents: [{ code: 'CB1', name: 'Ann Agent', count: 9, last: '2026-09-20', byType: { 'Formal Coaching': 3 }, themes: [T('gap.compliance_required_wording', 'gap', 3), T('purpose.lead_management', 'purpose', 2), T('purpose.quality_compliance', 'purpose', 4)], sessions: [OWN_SESSION] }],
  };
  P.setTeam(null); P.setD(liveTeam({ coaching: COACH }));
  const page = P.coachPageTeam();
  check('type counts show Lead Management Coaching as its own count beside the others', () => { clean(page); mustText(page, 'Lead Management Coaching'); mustText(page, 'Quality Assurance Coaching'); mustText(page, 'Formal Coaching'); });
  check('0 lead-management sessions: "No lead-management coaching logged in <period>"', () => { mustText(page, 'No lead-management coaching logged in'); });
  check('the lead-management line is labelled with lmPeriod.label (the period lmCount covers)', () => {
    P.setD(liveTeam({ coaching: Object.assign({}, COACH, { lmPeriod: { label: 'July – October 2026' }, period: { label: 'September 2026' } }) }));
    const h = P.coachPageTeam(); mustText(h, 'No lead-management coaching logged in July – October 2026'); mustNotText(h, 'in September 2026');
  });
  check('"the last 90 days" is used ONLY when the count is the 90-day byType figure (no lmCount)', () => {
    const c = Object.assign({}, COACH); delete c.lmCount; P.setD(liveTeam({ coaching: c })); mustText(P.coachPageTeam(), 'No lead-management coaching logged in the last 90 days');
  });
  check('an lmCount with no label never claims "the last 90 days"', () => { P.setD(liveTeam({ coaching: COACH })); const h = P.coachPageTeam(); mustNotText(h, 'lead-management coaching logged in the last 90 days'); mustText(h, 'No lead-management coaching logged in this period'); });
  check('the count line also uses lmPeriod.label', () => {
    P.setD(liveTeam({ coaching: Object.assign({}, COACH, { lmCount: 4, lmPeriod: { label: 'July 2026' } }) })); mustText(P.coachPageTeam(), 'in July 2026');
  });
  check('with lead-management sessions the none-logged line is gone and the count is said', () => {
    const c2 = Object.assign({}, COACH, { lmCount: 4, byType: Object.assign({}, COACH.byType, { 'Lead Management Coaching': 4 }) });
    P.setD(liveTeam({ coaching: c2 })); const h = P.coachPageTeam(); mustNotText(h, 'No lead-management coaching logged'); mustText(h, '4');
  });
  check('a team with NO sessions at all still says no lead-management coaching was logged', () => {
    P.setD(liveTeam({ coaching: Object.assign({}, COACH, { totals: { sessions: 0, agents: 0 }, agents: [] }) })); mustText(P.coachPageTeam(), 'No lead-management coaching logged in');
  });
  check('team card theme bars include the lead-management purpose theme, beside the gap themes', () => {
    P.setD(liveTeam({ coaching: COACH })); const h = P.coachTeamHTML(COACH); mustText(h, 'Compliance Required Wording'); mustText(h, 'Lead Management');
    mustNotText(h, 'Quality Compliance', 'a non-gap, non-LM purpose theme crept in');
  });
  check('agent coaching card theme chips include the lead-management theme', () => {
    const c = { windowDays: 90, coachingAt: '2026-10-01T14:23:00Z', agents: [COACH.agents[0]] };
    const h = P.coachHTML(c); mustText(h, 'Compliance Required Wording'); mustText(h, 'Lead Management'); mustNotText(h, 'Quality Compliance');
  });
  check('the agent drawer lists lead-management themes and keeps the COMPLIANCE flag on compliance ones', () => {
    const h = P.drawerHTML({ me: Object.assign(emptyRow('CB1', 'Ann Agent', 'Denise', 'Courtesy'), { covered: true }), nba: null, coaching: { windowDays: 90, coachingAt: '2026-10-01T14:23:00Z', agents: [COACH.agents[0]] } });
    mustText(h, 'Lead Management'); mustText(h, 'Compliance Required Wording'); mustText(h, 'COMPLIANCE');
    const i = h.indexOf('Lead Management'); if (/COMPLIANCE/.test(h.slice(i, i + 160).split('dk-th')[0])) throw new Error('the compliance badge sits on the lead-management theme');
  });
  check('a coach who is not the team leader is named on the agent session rows: "coached by Dalwin (SOS)"', () => {
    const c = { windowDays: 90, coachingAt: '2026-10-01T14:23:00Z', agents: [Object.assign({}, COACH.agents[0], { sessions: [LM_SESSION, OWN_SESSION], count: 2, last: '2026-09-20' })] };
    const h = P.coachHTML(c); mustText(h, 'coached by Dalwin (SOS)'); mustNotText(h, 'coached by Denise Haripersad', 'a team leader\'s own session is not "coached by"');
  });
}
{
  const DAYTIME = new Intl.DateTimeFormat('en-ZA', { timeZone: 'Africa/Johannesburg', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date('2026-10-01T14:23:00Z'));
  /* the TL Coaching Hub tab: live list + "Coaching on your agents by others" */
  const { P, N } = loadPage({});
  const COACH = { windowDays: 90, coachingAt: '2026-10-01T14:23:00Z', stale: false, lmCount: 1, byType: { 'Lead Management Coaching': 1 }, totals: { sessions: 1, agents: 1 }, agents: [{ code: 'CB1', name: 'Ann Agent', count: 1, last: '2026-07-20', byType: { 'Lead Management Coaching': 1 }, themes: [], sessions: [LM_SESSION] }] };
  P.setTeam(null); P.setD(liveTeam({ coaching: COACH }));
  const HUB = { linked: true, byType: { 'Informal Coaching': 2 }, coachingAt: '2026-10-01T14:23:00Z', sessions: [{ _id: 's1', agentName: 'Ann Agent', employeeCode: 'CB1', _label: 'Informal Coaching', date: '2026-09-22', developmentAreas: 'Greeting' }],
    others: [{ date: '2026-07-20', agentName: 'Ann Agent', cb: 'CB1', type: 'Lead Management Coaching', typeLabel: 'Lead Management Coaching', coach: 'Dalwin (SOS)', coachIsTl: false, themes: ['Lead Management'] }] };
  P.setHub(HUB);
  const h = P.coachHubPage();
  check('the Hub tab keeps the live list of the leader\'s own sessions', () => { clean(h); mustText(h, 'Your sessions'); mustText(h, 'Greeting'); });
  check('the Hub tab adds "Coaching on your agents by others" with date, agent, type, coach, themes', () => {
    mustText(h, 'Coaching on your agents by others'); mustText(h, '20 Jul'); mustText(h, 'Ann Agent'); mustText(h, 'Lead Management Coaching'); mustText(h, 'Dalwin (SOS)');
    const blk = h.slice(h.indexOf('Coaching on your agents by others')); mustText(blk.slice(0, 1500), 'Lead Management');
  });
  check('the Hub tab says own sessions are live and others\' come from the copy of <day time>', () => {
    mustText(h, "Your own sessions are live from the Coaching Hub; others' sessions on your agents are from the copy of " + DAYTIME);
  });
  check('no coachingAt anywhere: the Hub line drops the "copy of" clause instead of printing "copy of ."', () => {
    const h2 = Object.assign({}, HUB); delete h2.coachingAt; P.setHub(h2); P.setD(liveTeam({ coaching: Object.assign({}, COACH, { coachingAt: undefined }) }));
    const x = P.coachHubPage(); mustText(x, 'Your own sessions are live from the Coaching Hub'); mustNotText(x, 'copy of'); mustNotText(x, 'copy of .');
    P.setD(liveTeam({ coaching: COACH }));
  });
  check('an empty others block is hidden', () => { P.setHub(Object.assign({}, HUB, { others: [] })); mustNotText(P.coachHubPage(), 'Coaching on your agents by others'); });
  check('a payload without others (older Worker) is hidden too', () => { const h2 = Object.assign({}, HUB); delete h2.others; P.setHub(h2); mustNotText(P.coachHubPage(), 'Coaching on your agents by others'); });
  check('theme entries given as objects are painted by label, not as [object Object]', () => {
    P.setHub(Object.assign({}, HUB, { others: [Object.assign({}, HUB.others[0], { themes: [{ key: 'purpose.lead_management', label: 'Lead Management' }] })] })); const x = P.coachHubPage(); clean(x); mustText(x, 'Lead Management');
  });
}
{
  /* CM: sessions by a non-TL coach name the coach too */
  const route = () => ({ status: 200, body: { fetchedAt: '2026-10-01T14:23:00Z', stale: false, ageHours: 1, hubUrl: 'https://coaching-hub-psi.vercel.app/', period: { label: 'September 2026' },
    leaders: [{ name: 'Denise Haripersad', campaign: 'Courtesy', sessions: 2, agentsCoached: 1, last: '2026-09-20' }], tl: 'Denise Haripersad',
    sessions: [{ date: '2026-09-20', agentName: 'Ann Agent', cb: 'CB1', onList: true, type: 'Lead Management Coaching', themes: ['Lead Management'], supportProvided: null, coach: 'Dalwin (SOS)', coachIsTl: false },
               { date: '2026-09-19', agentName: 'Bea Buyer', cb: 'CB2', onList: true, type: 'Formal Coaching', themes: [], supportProvided: null, coach: 'Denise Haripersad', coachIsTl: true }] } });
  const { P, N } = loadPage({ '/api/portal/cm-coaching': route });
  P.setTeam(null); P.setD(emptyCm()); P.setView('cm_coach'); P.cmCoachPick('Denise Haripersad'); await settle();
  check('CM coaching page: "coached by Dalwin (SOS)" on the non-TL session only', () => { const h = N.root.innerHTML; mustText(h, 'coached by Dalwin (SOS)'); mustNotText(h, 'coached by Denise Haripersad'); });
  check('CM coaching page: still prints the copy age', () => mustText(N.root.innerHTML, 'Coaching Hub copy from'));
}

/* ═════════════════════════ C · Coaching age ═════════════════════════ */
head('C · Every coaching surface prints "Coaching Hub copy from <day time>"');
{
  const { P, N } = loadPage({});
  const AT = '2026-10-01T14:23:00Z';
  /* the page prints the Intl en-ZA "day month hh:mm" in SAST — the same formatter, so the check holds on any ICU */
  const DAYTIME = new Intl.DateTimeFormat('en-ZA', { timeZone: 'Africa/Johannesburg', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(AT));
  const WHEN = 'Coaching Hub copy from ' + DAYTIME;
  P.setTeam(null); P.setD(liveTeam({}));
  const co = { windowDays: 90, coachingAt: AT, stale: false, lmCount: 0, byType: {}, totals: { sessions: 1, agents: 1 },
    agents: [{ code: 'CB1', name: 'Ann Agent', count: 1, last: '2026-09-20', byType: {}, themes: [T('gap.compliance_required_wording', 'gap', 1)], sessions: [OWN_SESSION] }] };
  check('agent drawer coaching history', () => {
    const h = P.drawerHTML({ me: Object.assign(emptyRow('CB1', 'Ann Agent', 'Denise', 'Courtesy'), { covered: true }), nba: null, coaching: co }); mustText(h, WHEN);
  });
  check('agent coaching card', () => mustText(P.coachHTML(co), WHEN));
  check('agent coaching card with no sessions', () => mustText(P.coachHTML(Object.assign({}, co, { agents: [{ code: 'CB1', count: 0, sessions: [], themes: [] }] })), WHEN));
  check('TL team coaching card', () => mustText(P.coachTeamHTML(co), WHEN));
  check('TL team coaching card with no sessions', () => mustText(P.coachTeamHTML(Object.assign({}, co, { totals: { sessions: 0 } })), WHEN));
  check('TL Month to date coaching analysis card', () => {
    P.setTeam(null); P.setD(liveTeam({ coaching: co }));
    const rows = [Object.assign(emptyRow('CB1', 'Ann Agent', 'Denise', 'Courtesy'), { covered: true, coach: { n: 1, last: '2026-09-20', themes: ['Lead Management'], after: null } })];
    mustText(P.coachingAnalysisCard(rows), WHEN);
  });
  check('a payload without coachingAt prints no stamp and no placeholder', () => { const h = P.coachHTML(Object.assign({}, co, { coachingAt: undefined })); clean(h); mustNotText(h, 'Coaching Hub copy from'); });
  check('the page escapes a hostile coach name and theme', () => {
    const evil = '<img src=x onerror=alert(1)>';
    const c = Object.assign({}, co, { agents: [Object.assign({}, co.agents[0], { sessions: [Object.assign({}, LM_SESSION, { coach: evil })] })] });
    mustNot(P.coachHTML(c), evil); P.setHub({ linked: true, sessions: [], byType: {}, coachingAt: AT, others: [Object.assign({}, LM_SESSION, { coach: evil, agentName: evil, themes: [evil] })] });
    mustNot(P.coachHubPage(), evil);
  });
}

/* ═════════════════════════ D · ES5 ═════════════════════════ */
head('D · ES5 — the new code is plain ES5');
{
  const body = (name) => { const i = PAGE.indexOf('function ' + name + '('); if (i < 0) return ''; let d = 0, j = PAGE.indexOf('{', i); for (; j < PAGE.length; j++) { if (PAGE[j] === '{') d++; else if (PAGE[j] === '}') { d--; if (!d) break; } } return PAGE.slice(i, j + 1); };
  check('the new functions use no arrow functions, let/const, template literals or spread', () => {
    for (const n of ['emptyMonthCard', 'cmBillingOffer', 'tlEmptyView', 'tlEmptyBody', 'cmEmptyView', 'cmEmptyBody', 'finalBarHTML', 'themeText', 'lmPeriodLabel', 'ensureEmptyMe', 'askMonth', 'ovPath', 'prevMonthKey', 'monthNameOf', 'coachCopyLine', 'coachByLine', 'lmLine', 'othersBlock', 'isLmTheme']) {
      const b = body(n); if (!b) throw new Error(n + ' not found'); if (/=>|\blet\s|\bconst\s|`|\.\.\.[A-Za-z_\[]/.test(b)) throw new Error(n + ' uses non-ES5 syntax');
    }
  });
}

console.log(`\n${checks - fails}/${checks} checks passed`);
process.exit(fails ? 1 : 0);
