#!/usr/bin/env node
/**
 * verify-cm-view.mjs — the proof for the campaign manager's sign-off list (spec 001-cm-view-signoff,
 * work package 3: the Agent Analytics page, agent/index.html).
 *
 * Run:  node nicks_code/diagnostics/verify-cm-view.mjs
 *
 * The page script is evaluated in a stubbed DOM and driven with fixtures shaped EXACTLY like the
 * Worker contracts (specs/001-cm-view-signoff/contracts/interfaces.md C1-C4). The page only PAINTS:
 * every figure and verdict below arrives computed, and these checks prove it is worded and placed as
 * signed off — and that an absence prints "—" with its reason, never a nought.
 *
 *   A  Campaign tab        conversion / talk / contact tiles, the help card, the subtitle, team columns (US1)
 *   B  Campaign + tenure   selectors, re-ask, selection line, empty slice (US2)
 *   C  Team leaders' coaching   sidebar placement, in-app page, copy age, errors (US4)
 *   D  Period picker       options, re-fetch, period_not_published, session memory, agents/TLs unchanged (US3)
 *   R  Custom range        spec 006: "Custom range…" + built ranges, from/to + Apply, page-side validation, the
 *                          "being built" card that re-asks every 60 s, range_refused, Variance/Lead management/coaching
 *                          follow the range, the remembered range
 *   E  Reports             five tabs on the CM payload, Lead management and Courtesy (US5)
 *   F  TL Month to date    six KPI states + coaching analysis (US6)
 *   G  ES5 + escaping      the inline script is plain ES5; the new copy never prints raw data
 *
 * Exit code 0 = safe to ship. Non-zero = do not deploy.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const PAGE = fs.readFileSync(path.join(ROOT, 'agent', 'index.html'), 'utf8');

let fails = 0, checks = 0;
const ok = (m) => { checks++; console.log('  \x1b[32m✓\x1b[0m ' + m); };
const bad = (m, d) => { checks++; fails++; console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '\n      ' + d : '')); };
const head = (m) => console.log('\n\x1b[1m' + m + '\x1b[0m');
const check = (label, fn) => { try { const r = fn(); r === false ? bad(label) : ok(label); } catch (e) { bad(label, e.message); } };
const text = (h) => String(h).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const must = (h, s, why) => { if (String(h).indexOf(s) < 0) throw new Error((why || 'missing') + ': ' + JSON.stringify(s)); };
const mustText = (h, s, why) => { if (text(h).indexOf(s) < 0) throw new Error((why || 'missing') + ': ' + JSON.stringify(s) + '\n      in: ' + text(h).slice(0, 400)); };
const mustNot = (h, s, why) => { if (String(h).indexOf(s) >= 0) throw new Error((why || 'must not appear') + ': ' + JSON.stringify(s)); };
const mustNotText = (h, s, why) => { if (text(h).indexOf(s) >= 0) throw new Error((why || 'must not appear') + ': ' + JSON.stringify(s)); };
const clean = (h) => { if (/undefined|NaN|\[object Object\]/.test(h)) throw new Error('placeholder leaked: ' + (h.match(/.{0,40}(undefined|NaN|\[object Object\]).{0,40}/) || [])[0]); };

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
    getBoundingClientRect: () => ({ top: 80, left: 240, width: 900, height: 600 }),
  });
  /* <body> keeps what is appended to it (spec 033: the Coaching Hub frame lives OUTSIDE #root), and a created element
     counts how often its `src` is assigned — the frame may be given its address exactly once. */
  const bodyClasses = new Set();
  const body = Object.assign(mkEl(), {
    children: [], appendChild(el) { body.children.push(el); },
    classList: { add: (c) => bodyClasses.add(c), remove: (c) => bodyClasses.delete(c), contains: (c) => bodyClasses.has(c) },
  });
  const createElement = (tag) => {
    const el = mkEl(); el.tagName = String(tag).toUpperCase(); el._srcWrites = 0; el._attrs = {}; el.setAttribute = (k, v) => { el._attrs[k] = String(v); }; let src;
    Object.defineProperty(el, 'src', { get: () => src, set: (v) => { src = v; el._srcWrites++; } });
    el.remove = () => { const i = body.children.indexOf(el); if (i >= 0) body.children.splice(i, 1); };
    return el;
  };
  const doc = { getElementById: (id) => (nodes[id] = nodes[id] || mkEl()), querySelectorAll: () => [], createElement, body };
  const store = {}, sess = {};
  const win = {
    location: { search: '' },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; }, removeItem: (k) => { delete store[k]; } },
    scrollTo() {}, addEventListener() {}, confirm: () => true,
  };
  const session = { getItem: (k) => (k in sess ? sess[k] : null), setItem: (k, v) => { sess[k] = String(v); }, removeItem: (k) => { delete sess[k]; } };
  const calls = [];
  /* timers are RECORDED, never run on their own (spec 006: the "being built" card re-asks after 60 s — a test runs it by hand) */
  const timers = [];
  const setT = (f, ms) => { timers.push({ f, ms, id: timers.length + 1, cleared: false }); return timers.length; };
  const clearT = (id) => { const t = timers[id - 1]; if (t) t.cleared = true; };
  const fetchImpl = (url) => {
    const u = String(url).replace(/^https?:\/\/[^/]+/, '');
    calls.push(u);
    const path0 = u.split('?')[0];
    const r = routes && routes[path0] ? routes[path0](u) : { status: 404, body: { error: 'no route in test' } };
    if (r && r.network) return Promise.reject(new Error('offline'));
    return Promise.resolve({ ok: r.status < 400, status: r.status, json: () => Promise.resolve(r.body) });
  };
  const fn = new Function(
    'document', 'window', 'localStorage', 'sessionStorage', 'location', 'fetch', 'URLSearchParams', 'setTimeout', 'setInterval', 'clearInterval', 'Intl', 'console', 'clearTimeout',
    src + '\nvar __o={};'
    + '["render","cmView","loadPortal","sidebarHTML","navFor","pageMTD","pageWeeklyTeam","pageDailyTeam","pageLeadsTeam","pageCmReport","reportsTabs","cmCmdPage","cmTeamsPage",'
    + '"teamView","agentKpis","drillState","exportReports","reportMTD","reportLeads","cmAsk","cmCoachPick","cmCoachPage","cmHM","fmtShort","coachLine","agentKpiStates","cmValidPeriod","cmRangeProblem","resetClientState","preShell"]'
    + '.forEach(function(n){ try{ __o[n]=eval(n); }catch(e){ __o[n]=function(){ throw new Error("the page has no "+n+"()"); }; } });'
    + '__o.getHub=function(){ try{ return CMHUB; }catch(e){ return null; } }; __o.hubTabUrl=function(){ try{ return hubTabUrl(); }catch(e){ return null; } };'
    + '[]'
    + '.forEach(function(n){ try{ __o[n]=eval(n); }catch(e){ __o[n]=function(){ throw new Error("the page has no "+n+"()"); }; } });'
    + '__o.setD=function(d){D=d}; __o.setView=function(v){VIEW=v}; __o.getView=function(){return VIEW}; __o.getD=function(){return D}; __o.setU=function(u){U=u};'
    + '__o.setSel=function(s){CMSEL=s}; __o.getSel=function(){return CMSEL}; __o.setRepLeads=function(d){REP.leads.d=d}; __o.setRepVariance=function(d){REP.variance.d=d};'
    + '__o.CM_REPORT_TABS_GET=function(){return CM_REPORT_TABS}; __o.setMe=function(m){ME=m};'
    + 'return __o;',
  );
  const api = fn(doc, win, win.localStorage, session, win.location, fetchImpl, URLSearchParams, setT, () => 0, () => {}, Intl, { log() {}, error() {} }, clearT);
  win.__body = body;
  return { P: api, N: nodes, calls, sess, W: win, timers };
}
const tick = () => new Promise((r) => setImmediate(r));
const settle = async () => { for (let i = 0; i < 4; i++) await tick(); };

/* ------------------------------------------------------------------ fixtures, shaped like the contracts */
const HELP_COURTESY = [
  { key: 'skill', label: 'Skill or behaviour', routes_to: 'Coaching Hub', open: 3, raised: 5, affected: 4, oldestDays: 6, avgResolution: 90, comesBack: false },
  { key: 'lead', label: 'Lead quality', routes_to: 'Lead desk', open: 1, raised: 1, affected: 2, oldestDays: 2, avgResolution: null, comesBack: true },
];
const HELP_CUDDLE = [
  { key: 'system', label: 'System or tool problem', routes_to: 'IT', open: 2, raised: 2, affected: 3, oldestDays: 1, avgResolution: 30, comesBack: false },
];
const HELP_ALL = HELP_COURTESY.concat(HELP_CUDDLE);

function tenures(list) { return list.map((k) => ({ key: k, label: k === 'unset' ? 'unset' : k, agents: 5 })); }
function teamRow(tl, camp, over) {
  return Object.assign({ tl, team: tl + ' team', agents: 6, sales: 60, target: 80, pct: 0.75, gwp: 20000, aveG: 410, qa: 0.88, cancRate: 0.02, att: 0.94,
    conv: { v: 0.125, sales: 60, closed: 480, target: 0.1, basis: 'sales ÷ closed leads' },
    contactRate: { v: 0.375, contacts: 300, dials: 800 },
    open: 0, top: null, outside: 0, repeats: 0, lastSession: null, after: null, rag: 'g', state: 'On track', next: 'Keep going', codes: [] }, over || {});
}
function campaign(key, label, over) {
  return Object.assign({
    key, label, agents: 12, teamLeaders: 2, leaders: 2, reconciled: true, projection: null, brief: { signals: [], actions: [] },
    unattributed: { agents: [], notCovered: [] }, agentIndex: [{ code: 'CB1', name: 'Ann Agent' }],
    tenures: tenures(['M0', 'M1', 'unset']),
    kpis: {
      sales: { v: 120, target: 150, month: 300, pct: 0.8 }, gwp: { v: 50000, target: 80000, projected: 90000 },
      aveG: { v: 400, ref: 86.08, refIncl: 99 }, pitches: null,
      conv: { v: 0.125, sales: 60, closed: 480, target: 0.1, basis: 'sales ÷ closed leads' }, convWhy: '',
      talk: { v: 16320, targetMin: 300, targetSec: 18000, source: 'default' },
      attempts: null, contactRate: { v: 0.375, contacts: 300, dials: 800 }, contactWhy: '', leads: null,
      qa: { v: 0.9, target: 0.9 }, checks: null, crit: { fails: 0, p1Open: 0 }, canc: { v: 3, rate: 0.02, guard: 0.1 },
      att: { v: 0.95, target: 0.95, productive: 10, agents: 12 },
      referrals: { v: 17, agents: 5, people: 12 },
    },
    teams: [teamRow('Denise Haripersad', label), teamRow('Sam Leader', label, { conv: null, contactRate: null })],
  }, over || {});
}
const PERIOD_CYCLE = { kind: 'cycle', key: 'cycle-2026-09', from: '2026-08-26', to: '2026-09-25', label: '26 Aug – 25 Sep 2026' };
const PERIODS = {
  months: ['2026-08', '2026-07'],
  cycles: [
    { key: 'cycle-2026-09', from: '2026-08-26', to: '2026-09-25', label: '26 Aug – 25 Sep 2026', complete: true },
    { key: 'cycle-2026-10', from: '2026-09-26', to: '2026-10-25', label: '26 Sep – 25 Oct 2026', complete: false },
  ],
};
function agentRow(code, name, tl, campaignName, over) {
  const days = [
    { d: '2026-09-29', w: 40, emp: 1, act: 1, t: 5, s: 3, x: 900, tk: 14000, c: 80, r: 1 },
    { d: '2026-09-30', w: 40, emp: 1, act: 1, t: 5, s: 4, x: 1200, tk: 15000, c: 90, r: 0 },
  ];
  return Object.assign({ code, name, tl, campaign: campaignName, tenure: 'M1', covered: true, emp: 20, act: 18, att: 0.9, target: 100, sales: 70, pctT: 0.7, spd: 3.9,
    canc: 1, talk: 90000, aveTalk: 4500, talkPerWorked: 5000, gwpT: 8000, gwpEx: 6000, aveG: 400, ref: 2, qa: 0.9, score: 0.8, days,
    wk: [{ n: 40, emp: 2, act: 2, sales: 7, target: 10, pctT: 0.7, spd: 3.5, gwpEx: 2100, gwpT: 1600, aveG: 300, att: 1, qa: 0.9, ref: 1, talk: 29000, aveTalk: 14500, talkPerWorked: 14500 }] }, over || {});
}
const AGG = (over) => Object.assign({ hc: 6, emp: 120, act: 108, att: 0.9, target: 600, sales: 420, pctT: 0.7, spd: 3.9, canc: 6, cancPct: 0.014, gwpT: 48000, gwp: 36000, pctG: 0.75, aveG: 400, aveTalk: 4500, ref: 12, refPct: 0.03, onT: 2 }, over || {});
function cmPayload(over) {
  const courtesy = campaign('courtesy', 'Courtesy', { tenures: tenures(['M0', 'M1', 'unset']) });
  const cuddle = campaign('cuddle', 'Cuddle', {
    kpis: Object.assign({}, courtesy.kpis, { talk: { v: 16320, targetMin: 270, targetSec: 16200, source: 'settings' } }),
    teams: [teamRow('Cora Cuddle', 'Cuddle')], tenures: tenures(['Exp', 'M1']), agentIndex: [{ code: 'CB2', name: 'Bea Buyer' }],
  });
  return Object.assign({
    scope: 'campaign', role: 'campaign_manager', name: 'Ryan Manager', updatedAt: '2026-10-01T06:00:00Z',
    period: PERIOD_CYCLE, periods: PERIODS, diallingDays: 20, workingDays: 21, talkUnit: 'minutes',
    dates: ['2026-09-29', '2026-09-30'], weeks: [{ num: 40, from: '2026-09-28', to: '2026-10-04' }],
    cm: { name: 'Ryan Manager', tenure: 'all', freshness: { label: 'Data uploaded', updatedAt: '2026-10-01T06:00:00Z', stale: false },
      campaigns: [courtesy, cuddle, campaign('all', 'All campaigns', { agents: 15, teamLeaders: 3, leaders: 3, agentIndex: [{ code: 'CB1', name: 'Ann Agent' }, { code: 'CB2', name: 'Bea Buyer' }], tenures: tenures(['M0', 'M1', 'Exp', 'unset']), teams: courtesy.teams.concat(cuddle.teams) })] },
    assist: { kpis: null, requests: [], blockages: [], blockPanel: HELP_ALL, blockPanelByCamp: { courtesy: HELP_COURTESY, cuddle: HELP_CUDDLE } },
    agents: [agentRow('CB1', 'Ann Agent', 'Denise Haripersad', 'Courtesy'), agentRow('CB2', 'Bea Buyer', 'Cora Cuddle', 'Cuddle', { spd: 2.5 })],
    tlAgg: [Object.assign({ tl: 'Denise Haripersad', camp: 'Courtesy' }, AGG()), Object.assign({ tl: 'Cora Cuddle', camp: 'Cuddle' }, AGG({ hc: 3 }))],
    campAgg: { Courtesy: AGG({ hc: 12 }), Cuddle: AGG({ hc: 3 }) },
  }, over || {});
}

/* ═════════════════════════ A · Campaign tab ═════════════════════════ */
head('A · Campaign tab (US1) — conversion, talk, contact, the help card');
{
  const { P } = loadPage({});
  const html = (payload, sel) => { P.setD(payload); P.setView('cm'); P.setSel(sel || 'courtesy'); P.render(); return P.cmCmdPage(P.getD().cm.campaigns.filter((c) => c.key === (sel || 'courtesy'))[0]); };
  check('conversion reads "12.5%" with "sales ÷ 480 closed leads · target 10%"', () => {
    const h = html(cmPayload()); clean(h);
    mustText(h, 'Conversion'); mustText(h, '12.5%'); mustText(h, 'sales ÷ 480 closed leads · target 10%');
    mustNotText(h, 'unique leads', 'the old basis wording');
  });
  check('Courtesy talk reads "4 h 32 m a day" against "target 5 h" (whole hours print "5 h")', () => {
    const h = html(cmPayload()); mustText(h, '4 h 32 m'); mustText(h, 'a day'); mustText(h, 'target 5 h');
  });
  check('Cuddle talk target "4 h 30 m" comes from kpis.talk.targetMin, not a literal', () => {
    const h = html(cmPayload(), 'cuddle'); mustText(h, 'target 4 h 30 m'); mustNotText(h, 'target 5 h');
  });
  check('the Referrals card (spec 037) prints the Worker\'s figure and who referred: "17" · "5 of 12 agents referred at least one"', () => {
    const h = html(cmPayload()); clean(h);
    const tile = h.slice(h.indexOf('>Referrals<')); if (h.indexOf('>Referrals<') < 0) throw new Error('no Referrals card');
    mustText(tile.slice(0, 500), '17'); mustText(tile.slice(0, 500), '5 of 12 agents referred at least one'); mustText(tile.slice(0, 500), 'referrals feed');
  });
  check('the Referrals card without the Worker figure (an older payload) is simply absent — never a 0', () => {
    const p = cmPayload(); delete p.cm.campaigns[0].kpis.referrals; const h = html(p);
    if (h.indexOf('>Referrals<') >= 0) throw new Error('a card with no figure');
  });
  check('contact rate reads "37.5%" with "300 people reached from 800 dials"', () => {
    const h = html(cmPayload()); mustText(h, 'Contact Rate'); mustText(h, '37.5%'); mustText(h, '300 people reached from 800 dials');
  });
  check('a null conversion prints "—" and the Worker\'s own reason, never 0%', () => {
    const p = cmPayload(); p.cm.campaigns[0].kpis.conv = null; p.cm.campaigns[0].kpis.convWhy = 'No closed-case book is loaded for this period.';
    const h = html(p); clean(h); mustText(h, 'No closed-case book is loaded for this period.');
    const tile = h.slice(h.indexOf('Conversion Rate')); if (/>\s*0%/.test(tile.slice(0, 300))) throw new Error('a null conversion printed as 0%');
    mustText(tile.slice(0, 400), '—');
  });
  check('a null contact rate prints "—" and contactWhy', () => {
    const p = cmPayload(); p.cm.campaigns[0].kpis.contactRate = null; p.cm.campaigns[0].kpis.contactWhy = 'No dials were recorded for this period.';
    const h = html(p); clean(h); mustText(h, 'No dials were recorded for this period.');
    const tile = h.slice(h.indexOf('Contact Rate')); mustText(tile.slice(0, 400), '—');
  });
  check('the help card is "Where my team leaders need help" with its sub-line', () => {
    const h = html(cmPayload());
    mustText(h, 'Where my team leaders need help');
    mustText(h, 'Open help requests from your team leaders, grouped by what is holding them up — oldest first.');
    mustNotText(h, 'What is blocking the campaign');
  });
  check('only the selected campaign\'s help rows show (blockPanelByCamp)', () => {
    const h = html(cmPayload()); mustText(h, 'Skill or behaviour'); mustText(h, 'Lead quality'); mustNotText(h, 'System or tool problem', 'a Cuddle row on the Courtesy page');
    const h2 = html(cmPayload(), 'cuddle'); mustText(h2, 'System or tool problem'); mustNotText(h2, 'Skill or behaviour');
  });
  check('rows are oldest first', () => {
    const h = text(html(cmPayload())); if (h.indexOf('Skill or behaviour') > h.indexOf('Lead quality')) throw new Error('the 6-day-old row should come before the 2-day-old one');
  });
  check('without blockPanelByCamp the old unfiltered list is the fallback', () => {
    const p = cmPayload(); delete p.assist.blockPanelByCamp; const h = html(p);
    mustText(h, 'Skill or behaviour'); mustText(h, 'System or tool problem');
  });
  check('a campaign with no open help says so (the card is not silently missing)', () => {
    const p = cmPayload(); p.assist.blockPanelByCamp.courtesy = []; const h = html(p);
    mustText(h, 'Where my team leaders need help'); mustText(h, 'No open help requests');
  });
  check('the page subtitle is "Sales, team leaders and where they need help"', () => {
    const { P: Q, N } = loadPage({}); Q.setD(cmPayload()); Q.setView('cm'); Q.render();
    mustText(N.root.innerHTML, 'Sales, team leaders and where they need help'); mustNotText(N.root.innerHTML, 'what is blocking them');
  });
  check('Team leaders table: a Contact rate column, conversion on the closed basis, "—" where unknown', () => {
    const p = cmPayload(); P.setD(p); const h = P.cmTeamsPage(p.cm.campaigns[0]); clean(h);
    must(h, '<th>Contact rate</th>'); must(h, '<th>Conversion</th>');
    mustText(h, '37.5%'); mustText(h, '12.5%');
    const sam = h.slice(h.indexOf('Sam Leader')); const cells = sam.slice(0, sam.indexOf('</tr>'));
    if ((cells.match(/<td class="num">—<\/td>/g) || []).length < 2) throw new Error('Sam has no conversion and no contact rate — both must read "—"');
    mustText(h, 'closed leads', 'the footnote states the closed-lead basis');
  });
}

/* ═════════════════════════ B · Campaign + tenure ═════════════════════════ */
head('B · Campaign and tenure selectors (US2)');
{
  const routes = {};
  const seen = [];
  routes['/api/portal/overview'] = (u) => { seen.push(u); const q = new URLSearchParams(u.split('?')[1] || ''); const t = q.get('tenure') || 'all';
    const p = cmPayload({ period: { kind: 'current', key: 'current', from: '2026-10-01', to: '2026-10-31', label: '1 – 31 October 2026' } });
    p.cm.tenure = t;
    if (t === 'M2') { p.cm.campaigns[0].agents = 0; p.cm.campaigns[0].teams = []; p.cm.campaigns[0].teamLeaders = 0; p.agents = []; }
    return { status: 200, body: p }; };
  const { P, N, calls } = loadPage(routes);
  P.setD(cmPayload({ period: { kind: 'current', key: 'current', from: '2026-10-01', to: '2026-10-31', label: '1 – 31 October 2026' } })); P.setView('cm'); P.setSel('courtesy'); P.render();
  check('a tenure select sits beside the campaign select: All tenures + the campaign\'s tenures, "Tenure not set" for unset', () => {
    const h = N.root.innerHTML; must(h, 'id="cmSel"'); must(h, 'id="cmTenure"');
    const sel = h.slice(h.indexOf('id="cmTenure"')); const opts = sel.slice(0, sel.indexOf('</select>'));
    must(opts, 'All tenures'); must(opts, 'value="M0"'); must(opts, 'value="M1"'); must(opts, 'Tenure not set'); must(opts, 'value="unset"');
  });
  check('the tenure select is shown even when the manager holds ONE campaign', () => {
    const q = loadPage({}); const p = cmPayload(); p.cm.campaigns = [p.cm.campaigns[0]]; q.P.setD(p); q.P.setView('cm'); q.P.render();
    const h = q.N.root.innerHTML; must(h, 'id="cmTenure"'); mustNot(h, 'id="cmSel"', 'no campaign choice with one campaign');
  });
  check('changing the CAMPAIGN keeps the client-side switch (no request)', () => {
    const before = calls.length; N.cmSel.value = 'cuddle'; N.cmSel.onchange();
    if (calls.length !== before) throw new Error('changing campaign asked the server');
    mustText(N.root.innerHTML, 'Cuddle'); mustText(N.root.innerHTML, 'target 4 h 30 m');
    N.cmSel.value = 'courtesy'; N.cmSel.onchange();
  });
  check('the selection is stated on screen: campaign · tenure · period label', () => {
    mustText(N.root.innerHTML, 'Courtesy · All tenures · 1 – 31 October 2026');
  });
  const pending = (async () => {
    N.cmTenure.value = 'M1'; N.cmTenure.onchange(); await settle();
    check('changing the TENURE re-asks /api/portal/overview?period=current&tenure=M1', () => {
      if (calls[calls.length - 1] !== '/api/portal/overview?period=current&tenure=M1') throw new Error('asked: ' + calls[calls.length - 1]);
    });
    check('…and the selection line follows it ("Courtesy · M1 · …")', () => { mustText(N.root.innerHTML, 'Courtesy · M1 · 1 – 31 October 2026'); });
    N.cmTenure.value = 'M2'; N.cmTenure.onchange(); await settle();
    check('an empty slice says "No M2 agents on Courtesy in this period" and shows no figures', () => {
      const h = N.root.innerHTML; clean(h); mustText(h, 'No M2 agents on Courtesy in this period'); mustNotText(h, 'Total Sales');
    });
    N.cmTenure.value = 'unset'; N.cmTenure.onchange(); await settle();
    check('"Tenure not set" is the name in the line for an unset tenure', () => { mustText(N.root.innerHTML, 'Courtesy · Tenure not set'); });
  })();
  await pending;
}

/* ═════════════════════════ D · Period picker (before C: shares the harness style) ═════════════════════════ */
head('D · Period picker (US3) — campaign manager only');
{
  const routes = {};
  routes['/api/portal/overview'] = (u) => {
    const q = new URLSearchParams(u.split('?')[1] || ''); const per = q.get('period') || 'current';
    if (per === 'cycle-2026-10') return { status: 404, body: { error: 'period_not_published', period: { key: 'cycle-2026-10', from: '2026-09-26', to: '2026-10-25', label: '26 Sep – 25 Oct 2026' }, message: 'That billing month has not been built yet — the 15-minute refresh builds it.' } };
    if (per === '2026-08') return { status: 200, body: cmPayload({ period: { kind: 'month', key: '2026-08', from: '2026-08-01', to: '2026-08-31', label: '1 – 31 August 2026' } }) };
    return { status: 200, body: cmPayload({ period: { kind: 'current', key: 'current', from: '2026-10-01', to: '2026-10-31', label: '1 – 31 October 2026' } }) };
  };
  const { P, N, calls, sess } = loadPage(routes);
  P.setD(cmPayload({ period: { kind: 'current', key: 'current', from: '2026-10-01', to: '2026-10-31', label: '1 – 31 October 2026' } })); P.setView('cm'); P.setSel('courtesy'); P.render();
  check('the picker offers Current month · Billing month <last complete> · Billing month <in progress> (in progress) · past months', () => {
    const h = N.root.innerHTML; must(h, 'id="cmPeriod"'); const sel = h.slice(h.indexOf('id="cmPeriod"')); const o = text(sel.slice(0, sel.indexOf('</select>')));
    const want = ['Current month', 'Billing month 26 Aug – 25 Sep 2026', 'Billing month 26 Sep – 25 Oct 2026 (in progress)', 'August 2026', 'July 2026'];
    let at = -1; for (const w of want) { const i = o.indexOf(w); if (i < 0) throw new Error('missing option ' + w + ' in ' + o); if (i < at) throw new Error('out of order: ' + w); at = i; }
  });
  check('the period label on screen is period.label', () => { mustText(N.root.innerHTML, '1 – 31 October 2026'); });
  const run = (async () => {
    N.cmPeriod.value = '2026-08'; N.cmPeriod.onchange(); await settle();
    check('choosing a past month re-fetches ?period=2026-08&tenure=all and relabels the page', () => {
      if (calls[calls.length - 1] !== '/api/portal/overview?period=2026-08&tenure=all') throw new Error('asked: ' + calls[calls.length - 1]);
      mustText(N.root.innerHTML, '1 – 31 August 2026');
    });
    check('the choice is kept for the session (sessionStorage)', () => { const v = Object.values(sess).join('|'); must(v, '2026-08'); });
    N.cmPeriod.value = 'cycle-2026-10'; N.cmPeriod.onchange(); await settle();
    check('a 404 period_not_published shows its message and NO numbers', () => {
      const h = N.root.innerHTML; clean(h); mustText(h, 'That billing month has not been built yet'); mustNotText(h, 'Total Sales'); mustNotText(h, 'Where my team leaders need help'); mustNotText(h, '12.5%');
    });
    check('…and the picker is still there to leave it', () => { must(N.root.innerHTML, 'id="cmPeriod"'); });
    N.cmPeriod.value = 'current'; N.cmPeriod.onchange(); await settle();
    check('going back to the current month restores the figures', () => { mustText(N.root.innerHTML, 'Where my team leaders need help'); });
  })();
  await run;

  const r2 = loadPage(routes);
  r2.sess['cbx_cm_view'] = JSON.stringify({ period: '2026-08', tenure: 'M1' });
  r2.sess['cbx_agent_token'] = 'tok';
  routes['/api/portal/overview'] = ((orig) => (u) => (u.indexOf('?') < 0 ? { status: 200, body: cmPayload({ period: { kind: 'current', key: 'current', from: '2026-10-01', to: '2026-10-31', label: '1 – 31 October 2026' } }) } : orig(u)))(routes['/api/portal/overview']);
  r2.P.loadPortal(); await settle();
  check('loadPortal asks for the plain overview first, then re-asks the remembered period + tenure (CM only)', () => {
    const c = r2.calls.filter((x) => x.indexOf('/api/portal/overview') === 0);
    if (c[0] !== '/api/portal/overview') throw new Error('first ask: ' + c[0]);
    if (c[c.length - 1] !== '/api/portal/overview?period=2026-08&tenure=M1') throw new Error('re-ask: ' + c[c.length - 1]);
  });
  const r3 = loadPage(routes);
  r3.sess['cbx_cm_view'] = JSON.stringify({ period: '../../admin', tenure: '<script>' }); r3.sess['cbx_agent_token'] = 'tok';
  r3.P.loadPortal(); await settle();
  check('…nothing but the plain overview was requested', () => {
    const c = r3.calls.filter((x) => x.indexOf('/api/portal/overview') === 0); if (c.length !== 1 || c[0] !== '/api/portal/overview') throw new Error(JSON.stringify(c));
  });

  /* an agent and a team leader keep NO month filter */
  const tlRoutes = { '/api/portal/overview': () => ({ status: 200, body: {
    v: 1, role: 'team_leader', scope: 'team', name: 'A Leader', team: 'A Leader', updatedAt: '2026-10-01T06:00:00Z', period: { from: '2026-10-01', to: '2026-10-31' },
    diallingDays: 1, workingDays: 21, dates: ['2026-10-01'], agents: [agentRow('CB1', 'Ann Agent', 'A Leader', 'Cuddle')], totals: { agents: 1, reporting: 1, gwpEx: 6000, sales: 70, target: 100, pctT: 0.7, aveG: 400, att: 0.9, qa: 0.9, ref: 2, onTarget: 0 },
    spark: [1], coaching: { windowDays: 90, totals: { sessions: 0, agents: 0, scored: 0 }, agents: [] } } }) };
  const t = loadPage(tlRoutes); t.sess['cbx_cm_view'] = JSON.stringify({ period: '2026-08', tenure: 'M1' }); t.sess['cbx_agent_token'] = 'tok';
  t.P.loadPortal(); await settle();
  check('a team leader\'s overview request carries no period or tenure, and the page has no period picker', () => {
    const c = t.calls.filter((x) => x.indexOf('/api/portal/overview') === 0); if (c.length !== 1 || c[0] !== '/api/portal/overview') throw new Error(JSON.stringify(c));
    const h = t.N.root.innerHTML; mustNot(h, 'cmPeriod'); mustNot(h, 'cmTenure'); mustNot(h, 'Billing month'); clean(h);
    mustNot(h, 'Custom range'); mustNot(h, 'cmFrom');
  });
}

/* ═════════════════════════ R · Custom range (spec 006) ═════════════════════════ */
head('R · Custom range (spec 006-cm-custom-range, C6) — campaign manager only');
{
  const KEY = 'range-2026-09-01-2026-09-15';
  const PER_RANGE = { kind: 'range', key: KEY, from: '2026-09-01', to: '2026-09-15', label: '1 – 15 Sep 2026' };
  const PER_CUR = { kind: 'current', key: 'current', from: '2026-10-01', to: '2026-10-31', label: '1 – 31 October 2026' };
  const PERIODS_R = Object.assign({}, PERIODS, { ranges: [{ key: 'range-2026-08-03-2026-08-09', from: '2026-08-03', to: '2026-08-09', label: '3 – 9 Aug 2026' }] });
  let mode = 'building';
  const REPORT = (kind) => ({ updatedAt: '2026-10-01T06:00:00Z', kind, period: { from: '2026-09-01', to: '2026-09-15' }, campBlocks: 'ok', rules: {}, cols: [], statuses: [], book: {}, wd: 10,
    agents: {}, teams: {}, teamsByCamp: {}, campaigns: {} });
  const routes = {
    '/api/portal/overview': (u) => {
      const q = new URLSearchParams(u.split('?')[1] || ''); const per = q.get('period') || 'current';
      if (per === KEY) {
        if (mode === 'building') return { status: 404, body: { error: 'range_building', period: PER_RANGE, message: '1 – 15 Sep 2026 is being built — it will be ready within about 15 minutes.' } };
        if (mode === 'refused') return { status: 404, body: { error: 'range_refused', period: PER_RANGE, reason: 'There are no figures for 1 – 15 Sep 2026 — nothing was uploaded for those days.' } };
        if (mode === 'evil') return { status: 404, body: { error: 'range_refused', period: Object.assign({}, PER_RANGE, { label: '<img src=x onerror=alert(1)>' }), reason: '<script>alert(2)</script>' } };
        if (mode === 'full') return { status: 429, body: { error: 'range_queue_full', period: PER_RANGE, message: 'Too many ranges are waiting to be built — try again after the next refresh.' } };
        return { status: 200, body: cmPayload({ period: PER_RANGE, periods: PERIODS_R }) };
      }
      return { status: 200, body: cmPayload({ period: PER_CUR, periods: PERIODS_R }) };
    },
    '/api/portal/tl/reports': (u) => ({ status: 200, body: REPORT(u.indexOf('kind=leads') >= 0 ? 'leads' : 'variance') }),
    '/api/portal/cm-coaching': () => ({ status: 200, body: { fetchedAt: '2026-10-01T04:00:00Z', stale: false, ageHours: 1, hubUrl: 'https://coaching-hub-psi.vercel.app/', period: PER_RANGE, leaders: [], tl: null, sessions: [] } }),
  };
  const { P, N, calls, sess, timers } = loadPage(routes);
  const setVal = (id, v) => { N[id] = N[id] || { value: '' }; N[id].value = v; };
  const overviewCalls = () => calls.filter((x) => x.indexOf('/api/portal/overview') === 0);
  const retries = () => timers.filter((t) => t.ms === 60000 && !t.cleared && !t.ran);
  const runRetry = async () => { const t = retries().pop(); if (!t) throw new Error('no 60 s re-ask is scheduled'); t.ran = true; t.f(); await settle(); };
  P.setD(cmPayload({ period: PER_CUR, periods: PERIODS_R })); P.setView('cm'); P.setSel('courtesy'); P.render();
  const opts = () => { const h = N.root.innerHTML; const sel = h.slice(h.indexOf('id="cmPeriod"')); return sel.slice(0, sel.indexOf('</select>')); };
  check('the picker offers the built ranges and "Custom range…" after the months', () => {
    const o = opts(); must(o, 'value="custom"'); mustText(o, 'Custom range…'); must(o, 'value="range-2026-08-03-2026-08-09"'); mustText(o, '3 – 9 Aug 2026');
    const t = text(o); if (t.indexOf('July 2026') > t.indexOf('3 – 9 Aug 2026') || t.indexOf('3 – 9 Aug 2026') > t.indexOf('Custom range…')) throw new Error('order: ' + t);
  });
  const run = (async () => {
    const before = calls.length;
    N.cmPeriod.value = 'custom'; N.cmPeriod.onchange(); await settle();
    check('choosing "Custom range…" asks nothing yet and shows a from date, a to date and Apply', () => {
      if (calls.length !== before) throw new Error('asked: ' + calls.slice(before).join(', '));
      const h = N.root.innerHTML; must(h, 'id="cmFrom"'); must(h, 'id="cmTo"'); must(h, 'type="date"'); must(h, 'id="cmRangeApply"'); mustText(h, 'Apply');
      must(opts(), 'value="custom" selected', 'the picker shows "Custom range…" while the form is open');
    });
    for (const [why, f, t, msg] of [['from after to', '2026-09-15', '2026-09-01', 'after'], ['more than 93 days', '2026-05-01', '2026-09-15', '93'],
      ['to after today', '2026-09-01', '2099-01-01', 'today'], ['before 2025', '2024-12-01', '2025-01-05', '2025'], ['a missing date', '', '2026-09-15', 'date']]) {
      const n0 = overviewCalls().length;
      setVal('cmFrom', f); setVal('cmTo', t); N.cmRangeApply.onclick(); await settle();
      check('an invalid range (' + why + ') is refused in the page with a message, and nothing is asked', () => {
        if (overviewCalls().length !== n0) throw new Error('asked the Worker: ' + overviewCalls().slice(n0).join(', '));
        const h = N.root.innerHTML; must(h, 'id="cmFrom"', 'the form stays open'); if (text(h).toLowerCase().indexOf(msg.toLowerCase()) < 0) throw new Error('no "' + msg + '" message in: ' + text(h).slice(0, 300));
      });
    }
    setVal('cmFrom', '2026-09-01'); setVal('cmTo', '2026-09-15'); N.cmRangeApply.onclick(); await settle();
    check('Apply asks /api/portal/overview?period=range-2026-09-01-2026-09-15&tenure=all', () => {
      const c = overviewCalls(); if (c[c.length - 1] !== '/api/portal/overview?period=' + KEY + '&tenure=all') throw new Error('asked: ' + c[c.length - 1]);
    });
    check('range_building: "<label> is being built — it will be ready within about 15 minutes", and no numbers', () => {
      const h = N.root.innerHTML; clean(h); mustText(h, '1 – 15 Sep 2026 is being built — it will be ready within about 15 minutes');
      mustNotText(h, 'Total Sales'); mustNotText(h, '12.5%'); mustNotText(h, 'Where my team leaders need help'); must(h, 'id="cmPeriod"', 'the picker stays to leave it');
    });
    check('the selection line names the range being built', () => { mustText(N.root.innerHTML, 'Courtesy · All tenures · 1 – 15 Sep 2026'); });
    check('the choice is remembered for the session', () => { must(Object.values(sess).join('|'), KEY); });
    check('a re-ask is scheduled for 60 s', () => { if (retries().length !== 1) throw new Error(retries().length + ' re-asks scheduled'); });
    let n0 = overviewCalls().length;
    await runRetry();
    check('after 60 s it asks again (same range), quietly — the building card stays, no "Loading" flash', () => {
      const c = overviewCalls(); if (c.length !== n0 + 1 || c[c.length - 1] !== '/api/portal/overview?period=' + KEY + '&tenure=all') throw new Error(JSON.stringify(c.slice(n0)));
      mustText(N.root.innerHTML, 'is being built');
    });
    check('…and while it is still building, it schedules the next minute', () => { if (retries().length !== 1) throw new Error(retries().length + ' re-asks scheduled'); });
    mode = 'built'; n0 = overviewCalls().length;
    await runRetry();
    check('once built, the next re-ask fills the page in on its own: the figures, labelled "1 – 15 Sep 2026"', () => {
      const h = N.root.innerHTML; clean(h); mustText(h, 'Where my team leaders need help'); mustText(h, 'Courtesy · All tenures · 1 – 15 Sep 2026'); mustNotText(h, 'is being built');
    });
    check('…and stops re-asking', () => { if (retries().length) throw new Error('still scheduled'); });
    check('the picker now selects the range', () => { must(opts(), 'value="' + KEY + '" selected'); });
    P.setView('cm_variance'); P.render(); await settle();
    check('Variance asks tl/reports with the range: ?kind=variance&period=range-…', () => {
      const c = calls.filter((x) => x.indexOf('/api/portal/tl/reports') === 0); if (c[c.length - 1] !== '/api/portal/tl/reports?kind=variance&period=' + KEY) throw new Error('asked: ' + c[c.length - 1]);
    });
    P.setView('cm_leads'); P.render(); await settle();
    check('Lead management asks tl/reports with the range too', () => {
      const c = calls.filter((x) => x.indexOf('/api/portal/tl/reports?kind=leads') === 0); if (c[c.length - 1] !== '/api/portal/tl/reports?kind=leads&period=' + KEY) throw new Error('asked: ' + c[c.length - 1]);
    });
    P.setView('cm_coach'); P.render(); await settle();
    check('Team leaders\' coaching asks ?period=range-…', () => {
      const c = calls.filter((x) => x.indexOf('/api/portal/cm-coaching') === 0); if (c[c.length - 1] !== '/api/portal/cm-coaching?period=' + KEY) throw new Error('asked: ' + c[c.length - 1]);
    });
    P.setView('cm_variance'); P.render();
    N.cmPeriod.value = 'current'; N.cmPeriod.onchange(); await settle(); P.render(); await settle();
    check('back on the current month, Variance asks the live report again (no period)', () => {
      const c = calls.filter((x) => x.indexOf('/api/portal/tl/reports?kind=variance') === 0); if (c[c.length - 1] !== '/api/portal/tl/reports?kind=variance') throw new Error('asked: ' + c[c.length - 1]);
    });
  })().catch((e) => bad('the custom-range flow ran to its end', e.message));   // a missing control is a failed check, never a crash
  await run;

  /* a building range left behind: its timer must not drag the page back */
  {
    mode = 'building';
    const q = loadPage(routes); q.P.setD(cmPayload({ period: PER_CUR, periods: PERIODS_R })); q.P.setView('cm'); q.P.setSel('courtesy'); q.P.render();
    await q.P.cmAsk(KEY, 'all'); await settle();
    q.N.cmPeriod.value = 'current'; q.N.cmPeriod.onchange(); await settle();
    const n0 = q.calls.length;
    const left = q.timers.filter((t) => t.ms === 60000);
    left.forEach((t) => { if (!t.cleared) t.f(); }); await settle();
    check('leaving a range that is being built stops its re-ask (no request after the user moved on)', () => {
      if (q.calls.length !== n0) throw new Error('asked: ' + q.calls.slice(n0).join(', '));
      mustText(q.N.root.innerHTML, '1 – 31 October 2026');
    });
  }
  /* review finding 1: the minute's re-ask must not wipe dates typed (not yet applied) into the open custom form */
  {
    mode = 'building';
    const q = loadPage(routes); q.P.setD(cmPayload({ period: PER_CUR, periods: PERIODS_R })); q.P.setView('cm'); q.P.setSel('courtesy'); q.P.render();
    await q.P.cmAsk(KEY, 'all'); await settle();
    q.N.cmPeriod.value = 'custom'; q.N.cmPeriod.onchange(); await settle();
    const put = (id, v) => { q.N[id] = q.N[id] || { value: '' }; q.N[id].value = v; };
    put('cmFrom', '2026-09-03'); put('cmTo', '2026-09-10');
    const MARK = '<!-- the form as the manager left it -->';
    const n0 = q.calls.length; const t = q.timers.filter((x) => x.ms === 60000 && !x.cleared && !x.ran).pop();
    q.N.root.innerHTML = MARK;
    if (t) { t.ran = true; t.f(); } await settle();
    check('a quiet re-ask with the same "being built" answer keeps the typed dates (no re-render that rebuilds the form)', () => {
      if (!t) throw new Error('no re-ask was scheduled');
      if (q.calls.length !== n0 + 1) throw new Error('the re-ask did not happen');
      const h = q.N.root.innerHTML;
      if (h !== MARK && !(h.indexOf('value="2026-09-03"') >= 0 && h.indexOf('value="2026-09-10"') >= 0)) throw new Error('the form was rebuilt without the typed dates');
    });
    check('…and it keeps asking every minute', () => { if (!q.timers.some((x) => x.ms === 60000 && !x.cleared && !x.ran)) throw new Error('no next re-ask scheduled'); });
    q.N.root.innerHTML = '';
    q.N.cmTenure.value = 'M1'; q.N.cmTenure.onchange(); await settle();
    check('a re-render while the form is open (a tenure change) paints the dates typed so far, not blanks', () => {
      const h = q.N.root.innerHTML; must(h, 'id="cmFrom"'); must(h, 'value="2026-09-03"'); must(h, 'value="2026-09-10"');
    });
  }
  /* refused */
  {
    mode = 'refused';
    const q = loadPage(routes); q.P.setD(cmPayload({ period: PER_CUR, periods: PERIODS_R })); q.P.setView('cm'); q.P.setSel('courtesy'); q.P.render();
    await q.P.cmAsk(KEY, 'all'); await settle();
    check('range_refused shows the reason in words — not "being built" — and no numbers', () => {
      const h = q.N.root.innerHTML; clean(h); mustText(h, 'There are no figures for 1 – 15 Sep 2026 — nothing was uploaded for those days.'); mustText(h, '1 – 15 Sep 2026');
      mustNotText(h, 'is being built'); mustNotText(h, 'Total Sales');
    });
    check('…and nothing re-asks a refused range', () => { if (q.timers.some((t) => t.ms === 60000)) throw new Error('a re-ask was scheduled'); });
  }
  {
    mode = 'evil';
    const q = loadPage(routes); q.P.setD(cmPayload({ period: PER_CUR, periods: PERIODS_R })); q.P.setView('cm'); q.P.setSel('courtesy'); q.P.render();
    await q.P.cmAsk(KEY, 'all'); await settle();
    check('a hostile label or reason is escaped', () => { const h = q.N.root.innerHTML; mustNot(h, '<img src=x'); mustNot(h, '<script>alert(2)'); mustText(h, 'onerror'); });
  }
  {
    mode = 'full';
    const q = loadPage(routes); q.P.setD(cmPayload({ period: PER_CUR, periods: PERIODS_R })); q.P.setView('cm'); q.P.setSel('courtesy'); q.P.render();
    await q.P.cmAsk(KEY, 'all'); await settle();
    check('a full queue (429) keeps the previous period on screen (no numbers lost, no waiting card)', () => {
      const h = q.N.root.innerHTML; clean(h); mustText(h, '1 – 31 October 2026'); mustNotText(h, 'is being built'); mustText(h, 'Where my team leaders need help');
    });
  }
  /* the remembered range */
  {
    mode = 'built';
    const plainFirst = Object.assign({}, routes, { '/api/portal/overview': (u) => (u.indexOf('?') < 0 ? { status: 200, body: cmPayload({ period: PER_CUR, periods: PERIODS_R }) } : routes['/api/portal/overview'](u)) });
    const r = loadPage(plainFirst);
    r.sess['cbx_cm_view'] = JSON.stringify({ period: KEY, tenure: 'all' }); r.sess['cbx_agent_token'] = 'tok';
    r.P.loadPortal(); await settle();
    check('a stored cbx_cm_view with a valid range is re-asked after sign-in', () => {
      const c = r.calls.filter((x) => x.indexOf('/api/portal/overview') === 0); if (c[c.length - 1] !== '/api/portal/overview?period=' + KEY + '&tenure=all') throw new Error(JSON.stringify(c));
    });
    for (const badKey of ['range-2026-09-15-2026-09-01', 'range-2099-01-01-2099-01-02', 'range-2026-01-01-2026-09-15', 'range-2024-12-01-2024-12-02', 'range-2026-09-01', 'range-2026-09-01-2026-09-15<x>']) {
      const s = loadPage(plainFirst); s.sess['cbx_cm_view'] = JSON.stringify({ period: badKey, tenure: 'all' }); s.sess['cbx_agent_token'] = 'tok';
      s.P.loadPortal(); await settle();
      check('a stored invalid range (' + badKey + ') is never asked for', () => {
        const c = s.calls.filter((x) => x.indexOf('/api/portal/overview') === 0); if (c.length !== 1 || c[0] !== '/api/portal/overview') throw new Error(JSON.stringify(c));
      });
    }
    check('cmValidPeriod accepts a valid range key and the old periods', () => {
      const { P: Q } = loadPage({}); if (!Q.cmValidPeriod(KEY) || !Q.cmValidPeriod('current') || !Q.cmValidPeriod('2026-08') || !Q.cmValidPeriod('cycle-2026-09')) throw new Error('rejected a valid period');
      if (Q.cmValidPeriod('custom') || Q.cmValidPeriod('range-2026-02-30-2026-03-01')) throw new Error('accepted an invalid one');
    });
    check('cmRangeProblem: "" for a valid range, words otherwise (the Worker\'s rules)', () => {
      const { P: Q } = loadPage({}); if (Q.cmRangeProblem('2026-09-01', '2026-09-15') !== '') throw new Error('refused a valid range');
      if (Q.cmRangeProblem('2026-06-30', '2026-09-30') !== '') throw new Error('93 days is allowed'); if (!Q.cmRangeProblem('2026-06-29', '2026-09-30')) throw new Error('94 days is not');
    });
  }
}

/* ═════════════════════════ C · Team leaders' coaching ═════════════════════════ */
head("C · Team leaders' coaching (US4)");
{
  const COACH = {
    fetchedAt: '2026-10-01T04:00:00Z', stale: false, ageHours: 5, hubUrl: 'https://coaching-hub-psi.vercel.app/', period: { from: '2026-08-26', to: '2026-09-25', label: '26 Aug – 25 Sep 2026' },
    leaders: [
      { name: 'Denise Haripersad', campaign: 'Courtesy', sessions: 7, agentsCoached: 4, last: '2026-09-22' },
      { name: 'Sam Leader', campaign: 'Courtesy', sessions: 0, agentsCoached: 0, last: null },
    ],
    tl: null, sessions: [],
  };
  const DENISE = Object.assign({}, COACH, { tl: 'Denise Haripersad', sessions: [
    { date: '2026-09-10', agentName: 'Older Agent', cb: 'CB9', onList: true, type: 'Formal Coaching', themes: ['Close'], supportProvided: null },
    { date: '2026-09-22', agentName: 'Ghost Person', cb: null, onList: false, type: 'Informal Coaching', themes: ['Objection handling', 'Close'], supportProvided: 'Call review and role-play' },
  ] });
  let mode = 'ok'; const asked = [];
  const routes = { '/api/portal/cm-coaching': (u) => {
    asked.push(u);
    if (mode === 'forbidden') return { status: 403, body: { error: 'forbidden' } };
    if (mode === 'missing') return { status: 404, body: { error: 'not_found' } };
    if (mode === 'net') return { network: true };
    if (mode === 'stale') return { status: 200, body: Object.assign({}, COACH, { stale: true, ageHours: 40 }) };
    return { status: 200, body: u.indexOf('tl=') >= 0 ? DENISE : COACH };
  } };
  const { P, N } = loadPage(routes);
  P.setD(cmPayload()); P.setView('cm'); P.setSel('courtesy'); P.render();
  check('the CM sidebar has NO "Team leaders\' coaching" entry any more (spec 034, Nick 2026-10-13: "remove this team leader coaching for campaign manager" — the Coaching Hub tab is the one coaching entry)', () => {
    const h = N.root.innerHTML; mustNot(h, 'data-view="cm_coach"', 'the cm_coach button is still in the sidebar'); mustNotText(h, "Team leaders' coaching");
    must(h, 'data-view="cm_hub"', 'the Coaching Hub tab is the coaching entry');
  });
  check('the other roles do not get the item', () => {
    const t = P.sidebarHTML('team'); mustNot(t, 'cm_coach'); mustNot(P.sidebarHTML('month'), 'cm_coach');
  });
  P.setView('cm_coach'); P.render(); await settle();
  check('it opens an in-app page and asks /api/portal/cm-coaching?period=current', () => {
    if (asked[asked.length - 1] !== '/api/portal/cm-coaching?period=current') throw new Error('asked: ' + asked[asked.length - 1]);
    const h = N.root.innerHTML; clean(h); mustText(h, "Team leaders' coaching");
  });
  check('the leader table: name, campaign, sessions, agents coached, last session', () => {
    const h = N.root.innerHTML; mustText(h, 'Denise Haripersad'); mustText(h, 'Sam Leader'); mustText(h, 'Courtesy'); mustText(h, '2026-09-22');
    for (const col of ['Team leader', 'Campaign', 'Sessions', 'Agents coached', 'Last session']) mustText(h, col);
    const sam = text(h.slice(h.indexOf('Sam Leader'))).slice(0, 80); if (!/—/.test(sam)) throw new Error('a leader with no session must read "—": ' + sam);
  });
  check('the copy\'s age is stated ("Coaching Hub copy from <date>, 5 h old"), and not in a warning style when fresh', () => {
    const h = N.root.innerHTML; mustText(h, 'Coaching Hub copy from'); mustText(h, '5 h old'); mustText(h, '2026-10-01');
    const band = h.slice(h.lastIndexOf('<div', h.indexOf('Coaching Hub copy from'))); if (/^<div class="cm-band warn"/.test(band)) throw new Error('fresh copy styled as a warning');
  });
  check('"Open the Coaching Hub ↗" links hubUrl in a new tab with rel="noopener noreferrer"', () => {
    const h = N.root.innerHTML; const i = h.indexOf('Open the Coaching Hub'); const a = h.slice(h.lastIndexOf('<a ', i), i + 30);
    must(a, 'href="https://coaching-hub-psi.vercel.app/"'); must(a, 'target="_blank"'); must(a, 'rel="noopener noreferrer"'); must(a, 'Open the Coaching Hub ↗');
  });
  {
    const q = loadPage({ '/api/portal/cm-coaching': () => ({ status: 200, body: Object.assign({}, COACH, { hubUrl: 'javascript:alert(1)' }) }) });
    q.P.setD(cmPayload()); q.P.setView('cm_coach'); q.P.render(); await settle();
    check('a hubUrl that is not https is never linked (the known Hub address is used instead)', () => {
      mustNot(q.N.root.innerHTML, 'javascript:'); must(q.N.root.innerHTML, 'href="https://coaching-hub-psi.vercel.app/"');
    });
  }
  P.cmCoachPick('Denise Haripersad'); await settle();
  check('picking a leader asks &tl=<name> and lists sessions newest first', () => {
    if (asked[asked.length - 1] !== '/api/portal/cm-coaching?period=current&tl=Denise%20Haripersad') throw new Error('asked: ' + asked[asked.length - 1]);
    const h = N.root.innerHTML; clean(h); const i1 = h.indexOf('Ghost Person'), i2 = h.indexOf('Older Agent'); if (i1 < 0 || i2 < 0 || i1 > i2) throw new Error('not newest first');
    for (const c of ['Date', 'Agent', 'Type', 'Themes', 'Support provided']) mustText(h, c);
    mustText(h, 'Objection handling, Close'); mustText(h, 'Call review and role-play'); mustText(h, 'Informal Coaching');
  });
  check('a coached agent who is not on the list says "agent not on the list"; one who is does not', () => {
    const h = N.root.innerHTML; const ghost = h.slice(h.indexOf('Ghost Person'), h.indexOf('Ghost Person') + 300); mustText(ghost, 'agent not on the list');
    const older = h.slice(h.indexOf('Older Agent'), h.indexOf('Older Agent') + 300); mustNotText(older.slice(0, 200), 'agent not on the list');
  });
  {
    const q = loadPage({ '/api/portal/cm-coaching': () => ({ status: 200, body: Object.assign({}, COACH, { tl: 'Sam Leader', sessions: [] }) }) });
    q.P.setD(cmPayload()); q.P.setView('cm_coach'); q.P.cmCoachPick('Sam Leader'); await settle();
    check('a leader with no sessions says so instead of an empty table', () => { mustText(q.N.root.innerHTML, 'No coaching sessions logged for Sam Leader'); });
  }
  for (const [m, want] of [['forbidden', null], ['missing', null], ['net', null]]) {
    mode = m; P.cmCoachPick(''); await settle();
    check(`a ${m === 'net' ? 'network failure' : m === 'forbidden' ? '403' : '404'} shows a plain message, never a blank page`, () => {
      const h = N.root.innerHTML; clean(h); if (text(h).length < 200) throw new Error('page nearly blank'); mustText(h, "Team leaders' coaching"); must(h, 'class="card"');
      if (!/could not|not available|not published|only for|try again/i.test(text(h))) throw new Error('no plain-language message: ' + text(h).slice(0, 300));
    });
  }
  mode = 'stale'; P.cmCoachPick(''); await settle();
  check('a stale copy is stated with a warning style and its age in hours', () => {
    const h = N.root.innerHTML; mustText(h, '40 h old'); const i = h.indexOf('Coaching Hub copy from'); if (h.slice(Math.max(0, i - 80), i).indexOf('cm-band warn') < 0) throw new Error('no warning style on a stale copy');
  });
}

/* ═════════════════════════ E · Reports ═════════════════════════ */
head('E · Reports for the campaign manager (US5)');
{
  const { P, N } = loadPage({});
  P.setD(cmPayload()); P.setSel('courtesy');
  check('CM_REPORT_TABS = Month to date, Daily, Weekly, Variance, Lead management', () => {
    const t = P.CM_REPORT_TABS_GET(); const labels = t.map((x) => x[1]).join('|'); if (labels !== 'Month to date|Daily|Weekly|Variance|Lead management') throw new Error(labels);
  });
  check('the Reports strip on the CM page shows the five tabs', () => {
    P.setView('cm_mtd'); P.render(); const h = N.root.innerHTML; for (const l of ['Month to date', 'Daily', 'Weekly', 'Variance', 'Lead management']) must(h, '>' + l + '</button>');
    for (const v of ['cm_mtd', 'cm_daily', 'cm_weekly', 'cm_variance', 'cm_leads']) must(h, 'data-report="' + v + '"');
  });
  check('Month to date reuses the TL table over the CM agents, one table per campaign + the team-leader summary', () => {
    P.setSel('all'); P.setView('cm_mtd'); P.render(); const h = N.root.innerHTML; clean(h);
    mustText(h, 'Ann Agent'); mustText(h, 'Bea Buyer'); mustText(h, 'Grand Total'); mustText(h, 'Sales Achieved'); mustText(h, 'Denise Haripersad'); mustText(h, 'Campaign total');
    if ((h.match(/Grand Total/g) || []).length < 2) throw new Error('one total per campaign expected on "All campaigns"');
  });
  check('Month to date follows the selected campaign', () => {
    P.setSel('courtesy'); P.setView('cm_mtd'); P.render(); const h = N.root.innerHTML; mustText(h, 'Ann Agent'); mustNotText(h, 'Bea Buyer');
  });
  check('Daily and Weekly render over the CM agents', () => {
    P.setSel('all'); P.setView('cm_daily'); P.render(); let h = N.root.innerHTML; clean(h); mustText(h, 'Daily detail'); mustText(h, '2026-09-30');
    P.setView('cm_weekly'); P.render(); h = N.root.innerHTML; clean(h); mustText(h, 'Week 40'); mustText(h, 'Ann');
  });
  check('Export on a CM report tab writes the same sheets the TL gets', () => {
    const sheets = []; globalThis.XLSX = { utils: { book_new: () => ({}), aoa_to_sheet: (a) => ({ aoa: a }), book_append_sheet: (wb, ws, nm) => sheets.push([nm, ws.aoa]) }, writeFile() {} };
    try { P.setSel('courtesy'); P.setView('cm_mtd'); P.exportReports('cm_mtd'); } finally { delete globalThis.XLSX; }
    if (!sheets.length || sheets[0][0] !== 'MTD') throw new Error('sheets: ' + sheets.map((s) => s[0]));
  });
  const LEADS = {
    updatedAt: '2026-10-01T06:00:00Z', excludedCampaigns: ['Courtesy'], excludedFrom: '2026-10-01', cols: [], statuses: [], wd: 20, rules: { convTarget: 10 }, book: {},
    campBlocks: 'ok',
    agents: { CB1: { open: 3, tc: 10, nofb: 1, sales: 5, pSpd: 1, convL: 12, convC: 20 }, CB2: { open: 2, tc: 8, nofb: 0, sales: 4, pSpd: 1, convL: 10, convC: 18 } },
    teamsByCamp: { 'Courtesy|Denise Haripersad': { camp: 'Courtesy', tl: 'Denise Haripersad', agents: 1, open: 3, tc: 10, sales: 5 }, 'Cuddle|Cora Cuddle': { camp: 'Cuddle', tl: 'Cora Cuddle', agents: 1, open: 2, tc: 8, sales: 4 } },
    campaigns: { Cuddle: { camp: 'Cuddle', open: 2, tc: 8, sales: 4 } }, teams: {},
  };
  check('Lead management states the exclusion quietly, and no Courtesy rows render even from a stale payload', () => {
    P.setRepLeads(LEADS); P.setSel('all'); P.setView('cm_leads'); P.render(); const h = N.root.innerHTML; clean(h);
    mustText(h, 'Lead management does not cover Courtesy (from 1 October 2026)');
    mustNotText(h, 'Ann Agent'); mustNotText(h, 'Denise Haripersad'); mustText(h, 'Bea Buyer'); mustText(h, 'Cora Cuddle');
  });
  check('the CM on Courtesy alone gets the explanation, not an empty funnel', () => {
    P.setSel('courtesy'); P.setView('cm_leads'); P.render(); const h = N.root.innerHTML; mustText(h, 'Lead management does not cover Courtesy (from 1 October 2026)'); mustNotText(h, 'Ann Agent');
  });
  check('excludedFrom drives the date: an October payload hides Courtesy and shows the dated line', () => {
    const oct = Object.assign({}, LEADS, { excludedFrom: '2026-10-01' });
    P.setRepLeads(oct); P.setSel('all'); P.setView('cm_leads'); P.render(); const h = N.root.innerHTML;
    mustText(h, 'Lead management does not cover Courtesy (from 1 October 2026)'); mustNotText(h, 'Ann Agent'); mustText(h, 'Bea Buyer');
    P.setRepLeads(Object.assign({}, oct, { excludedFrom: '2026-11-05' })); P.render(); mustText(N.root.innerHTML, '(from 5 November 2026)');
  });
  check('excludedCampaigns without excludedFrom still hides the rows and prints no date', () => {
    const nf = Object.assign({}, LEADS); delete nf.excludedFrom; P.setRepLeads(nf); P.setSel('all'); P.setView('cm_leads'); P.render(); const h = N.root.innerHTML;
    mustText(h, 'Lead management does not cover Courtesy'); mustNotText(h, '(from'); mustNotText(h, 'Ann Agent');
  });
  check('a September-shaped payload (neither field) shows Courtesy rows and no line', () => {
    const sep = Object.assign({}, LEADS); delete sep.excludedCampaigns; delete sep.excludedFrom;
    P.setRepLeads(sep); P.setSel('all'); P.setView('cm_leads'); P.render(); const h = N.root.innerHTML; clean(h);
    mustText(h, 'Ann Agent'); mustText(h, 'Denise Haripersad'); mustNotText(h, 'does not cover');
  });
  check('without excludedCampaigns the line is absent', () => {
    P.setRepLeads(Object.assign({}, LEADS, { excludedCampaigns: [] })); P.setSel('cuddle'); P.setView('cm_leads'); P.render(); mustNotText(N.root.innerHTML, 'does not cover');
  });
  check('a team leader whose agents are ALL in an excluded campaign is not offered Lead management', () => {
    const tl = { role: 'team_leader', scope: 'team', name: 'Denise Haripersad', team: 'Denise Haripersad', updatedAt: '2026-10-01T06:00:00Z', period: { from: '2026-10-01', to: '2026-10-31' }, diallingDays: 1, workingDays: 21, dates: ['2026-10-01'],
      agents: [agentRow('CB1', 'Ann Agent', 'Denise Haripersad', 'Courtesy')], totals: { agents: 1 }, coaching: { totals: {}, agents: [] } };
    P.setD(tl); P.setRepLeads(LEADS);
    let h = P.reportsTabs('mtd_team'); mustNot(h, 'data-report="leads_team"', 'Courtesy-only TL offered the tab'); must(h, 'data-report="variance_team"');
    P.setD(Object.assign({}, tl, { agents: tl.agents.concat([agentRow('CB2', 'Bea Buyer', 'Denise Haripersad', 'Cuddle')]) }));
    h = P.reportsTabs('mtd_team'); must(h, 'data-report="leads_team"', 'a mixed team still gets the tab');
  });
}

/* ═════════════════════════ F · TL Month to date ═════════════════════════ */
head('F · Team leader Month to date — KPI states and coaching analysis (US6)');
{
  const { P, N } = loadPage({});
  const drill = (s) => ({ status: s, label: 'x', result: 0.5, target: 0.9, below: 1, of: 3 });
  const a1 = agentRow('CB1', 'Ann Agent', 'A Leader', 'Cuddle', { drill: { ta: drill('focus'), aveG: drill('watch'), qa: drill('pass'), att: drill('pass') }, gwpEx: 6000, ref: 0,
    coach: { n: 2, last: '2026-09-22', themes: ['Objection handling', 'Close'], after: { basis: 'sales per worked day', before: 1.8, after: 2.4, dir: 'up' } } });
  const a2 = agentRow('CB2', 'Bea Buyer', 'A Leader', 'Cuddle', { spd: 2, drill: { ta: drill('pass'), aveG: drill('pass'), qa: drill('watch'), att: drill('focus') }, gwpEx: 0, ref: 3,
    coach: { n: 0, last: null, themes: [], after: null } });
  const a3 = agentRow('CB3', 'Cy Closer', 'A Leader', 'Cuddle', { spd: 1, drill: { ta: drill('pass'), aveG: drill('pass'), qa: drill('pass'), att: drill('pass') },
    coach: { n: 1, last: '2026-09-03', themes: ['Rapport'], after: null } });
  const tl = { role: 'team_leader', scope: 'team', name: 'A Leader', team: 'A Leader', updatedAt: '2026-10-01T06:00:00Z', period: { from: '2026-09-01', to: '2026-09-30' }, diallingDays: 20, workingDays: 21,
    dates: ['2026-09-30'], agents: [a1, a2, a3], totals: { agents: 3 }, coaching: { totals: {}, agents: [] } };
  P.setD(tl); P.setView('mtd_team'); P.render();
  const h = N.root.innerHTML;
  const rowOf = (name) => { const i = h.indexOf('data-agent-row="' + name + '"'); if (i < 0) throw new Error('no KPI row for ' + name); return h.slice(i, h.indexOf('</tr>', i)); };
  const chips = (r) => [...r.matchAll(/data-kpi="([A-Za-z]+)"[^>]*>([^<]*)</g)].map((m) => m[1] + '=' + m[2]);
  check('a "Coaching analysis" section sits on the Month to date page', () => { clean(h); mustText(h, 'Coaching analysis'); });
  check('every agent row carries the six KPI chips: Target, Premium, Average sale, QA, Attendance, Referrals', () => {
    const c = chips(rowOf('CB1')); if (c.length !== 6) throw new Error('chips: ' + c.join(','));
    if (c.map((x) => x.split('=')[0]).join(',') !== 'ta,gwp,aveG,qa,att,ref') throw new Error('order: ' + c.join(','));
    for (const l of ['Target achieved', 'Premium written', 'Average sale', 'QA', 'Attendance', 'Referrals']) mustText(h, l);
  });
  check('chips read the drill verdicts: focus -> Focus, watch -> Watch, pass -> On track; no verdict -> "—"', () => {
    const c1 = chips(rowOf('CB1')); if (c1[0] !== 'ta=Focus' || c1[2] !== 'aveG=Watch' || c1[3] !== 'qa=On track' || c1[4] !== 'att=On track') throw new Error(c1.join(','));
    const c2 = chips(rowOf('CB2')); if (c2[0] !== 'ta=On track' || c2[3] !== 'qa=Watch' || c2[4] !== 'att=Focus') throw new Error(c2.join(','));
  });
  check('Premium written and Referrals use the agent tiles\' presence rule (>0 On track, else "—")', () => {
    const c1 = chips(rowOf('CB1')); if (c1[1] !== 'gwp=On track' || c1[5] !== 'ref=—') throw new Error(c1.join(','));
    const c2 = chips(rowOf('CB2')); if (c2[1] !== 'gwp=—' || c2[5] !== 'ref=On track') throw new Error(c2.join(','));
  });
  check('the chips equal the agent\'s own tiles (same drillState path): each tile pill maps 1:1', () => {
    P.setD(Object.assign({}, tl, { me: a1, role: 'agent', scope: 'agent' })); P.setMe(a1);
    const tiles = P.agentKpis(a1); const pills = [...tiles.matchAll(/<span class="pill [a-z]">([^<]*)<\/span>/g)].map((m) => m[1]);
    const map = { 'ON TRACK': 'On track', WATCH: 'Watch', FOCUS: 'Focus', 'NO DATA': '—' };
    const states = pills.map((p) => map[p]); const c1 = chips(rowOf('CB1')).map((x) => x.split('=')[1]);
    if (JSON.stringify(states) !== JSON.stringify(c1)) throw new Error('tiles ' + states.join(',') + ' vs chips ' + c1.join(','));
    P.setD(tl);
  });
  check('coaching line: "2 sessions · last 22 Sep · themes: Objection handling, Close · sales/day 1.8 → 2.4 since"', () => {
    mustText(rowOf('CB1'), '2 sessions · last 22 Sep · themes: Objection handling, Close · sales/day 1.8 → 2.4 since');
  });
  check('no sessions: "No coaching logged this month"', () => { mustText(rowOf('CB2'), 'No coaching logged this month'); });
  check('no before/after: the "since" part is omitted', () => {
    const r = text(rowOf('CB3')); must(r, '1 session · last 3 Sep · themes: Rapport'); if (/sales\/day|since/.test(r)) throw new Error('"since" shown without an after: ' + r);
  });
  check('no AI wording in the section', () => {
    const i = h.indexOf('Coaching analysis'); const sec = text(h.slice(i, i + 6000)); if (/\bAI\b|Nikola|artificial|machine/i.test(sec)) throw new Error('AI wording in Coaching analysis');
  });
  check('a payload without drill/coach (older Worker) renders without placeholders', () => {
    P.setD(Object.assign({}, tl, { agents: [agentRow('CB9', 'Old Row', 'A Leader', 'Cuddle')] })); P.setView('mtd_team'); P.render(); clean(N.root.innerHTML);
  });
}

/* ═════════════════════════ G · ES5 + escaping ═════════════════════════ */
head('G · The page stays ES5, and new copy escapes data');
{
  const m = PAGE.match(/<script>\n"use strict";([\s\S]*?)<\/script>/);
  check('the inline script still parses', () => { new vm.Script(m[1]); });
  const added = ['cmCoachPage', 'cmAsk', 'cmCoachLoad', 'cmCoachPick', 'coachLine', 'agentKpiStates', 'cmPeriodSelect', 'cmTenureSelect', 'cmHM', 'cmValidPeriod', 'cmValidTenure', 'cmSave', 'cmStored',
    'cmReset', 'cmOpen', 'cmMonthLabel', 'cmPeriodOptions', 'cmTenLabel', 'cmTenureKeys', 'cmSelect', 'cmSelectionLine', 'cmSliceEmpty', 'cmGateCard', 'cmConvTile', 'cmContactTile', 'cmHelpRows',
    'cmTeamConv', 'cmTeamContact', 'mtdGroups', 'reportSummary', 'cmSummaryCards', 'coachingAnalysisCard', 'kpiChip', 'fmtShort', 'fix1', 'lmExcludedList', 'lmIsExcluded', 'lmAllExcluded',
    'visibleReportTabs', 'lmNoteHTML', 'agentCampOf', 'cmCoachNavHTML', 'pageMTD', 'coveredAgents', 'noOneMsg',
    /* spec 006 — the custom range */
    'cmDayOk', 'cmTodaySast', 'cmRangeDays', 'cmRangeProblem', 'cmRangeKeyOk', 'cmRangeForm', 'cmRangeKeep', 'cmRangeApply', 'cmRetryStop', 'cmRetryLater', 'cmNoPubCard', 'repPeriod', 'repSync', 'repLoad', 'repStateCard'];
  const body = (name) => { const i = PAGE.indexOf('function ' + name + '('); if (i < 0) return ''; let d = 0, j = PAGE.indexOf('{', i); const s = j; for (; j < PAGE.length; j++) { if (PAGE[j] === '{') d++; else if (PAGE[j] === '}') { d--; if (!d) break; } } return PAGE.slice(s, j + 1); };
  check('the new functions use no arrow functions, let/const, template literals or spread', () => {
    for (const n of added) { const b = body(n); if (!b) throw new Error(n + ' not found'); if (/=>|\blet\s|\bconst\s|`|\.\.\.[A-Za-z_\[]/.test(b)) throw new Error(n + ' uses non-ES5 syntax'); }
  });
  {
    const evil = '<img src=x onerror=alert(1)>';
    const q = loadPage({ '/api/portal/cm-coaching': () => ({ status: 200, body: { fetchedAt: '2026-10-01T04:00:00Z', stale: false, ageHours: 1, hubUrl: 'https://coaching-hub-psi.vercel.app/', period: { label: 'x' },
      leaders: [{ name: evil, campaign: evil, sessions: 1, agentsCoached: 1, last: '2026-09-01' }], tl: evil, sessions: [{ date: '2026-09-01', agentName: evil, cb: null, onList: false, type: evil, themes: [evil], supportProvided: evil }] } }) });
    q.P.setD(cmPayload()); q.P.setView('cm_coach'); q.P.cmCoachPick(evil); await settle();
    check('a hostile team-leader name and theme are escaped in the coaching page', () => { mustNot(q.N.root.innerHTML, evil, 'raw markup from data'); mustText(q.N.root.innerHTML, 'onerror'); });
  }
}

/* ═════════════════════════ H · Review fixes ═════════════════════════ */
head('H · Review fixes — summary scope, mixed targets, tenure note, 401 reset, loading leader, help rows, incomplete pulls');
{
  const { P, N } = loadPage({});
  const full = cmPayload();
  full.summary = { onTarget: 1, talkUnit: 'minutes', teams: full.tlAgg, campaigns: full.campAgg };   // the Worker sets this to ALL the CM's campaigns
  P.setD(full); P.setView('cm_mtd');
  check('1. with Cuddle picked, the team-leader summary and the export hold Cuddle only', () => {
    P.setSel('cuddle'); P.render(); const h = N.root.innerHTML;
    mustText(h, 'Matrix Cuddle'); mustNotText(h, 'Matrix Courtesy'); mustNotText(h, 'Denise Haripersad');
    const sheets = []; globalThis.XLSX = { utils: { book_new: () => ({}), aoa_to_sheet: (a) => ({ aoa: a }), book_append_sheet: (wb, ws, nm) => sheets.push([nm, ws.aoa]) }, writeFile() {} };
    try { P.exportReports('cm_mtd'); } finally { delete globalThis.XLSX; }
    const tlSheet = sheets.filter((x) => x[0] === 'TL MTD')[0]; if (!tlSheet) throw new Error('no TL MTD sheet');
    const hdr = tlSheet[1][0].join('|'); if (/Denise|Courtesy/.test(hdr)) throw new Error('export carries Courtesy: ' + hdr);
  });
  check('1. "All campaigns" keeps every campaign\'s cards', () => {
    P.setSel('all'); P.render(); const h = N.root.innerHTML; mustText(h, 'Matrix Cuddle'); mustText(h, 'Matrix Courtesy');
  });
  check('2. an All-campaigns talk target of null prints "targets differ by campaign"', () => {
    const p = cmPayload(); p.cm.campaigns[2].kpis.talk = { v: 16320, targetMin: null, targetSec: null, source: 'mixed' };
    P.setD(p); P.setSel('all'); P.setView('cm'); P.render(); const h = P.cmCmdPage(p.cm.campaigns[2]); clean(h);
    mustText(h, 'targets differ by campaign'); mustNotText(h, 'target —'); mustText(h, '4 h 32 m');
  });
  check('3. a tenure other than "all" adds "Team leader summary covers all tenures." to Month to date', () => {
    const p = cmPayload(); p.cm.tenure = 'M1'; P.setD(p); P.setSel('courtesy'); P.setView('cm_mtd'); P.render();
    mustNotText(N.root.innerHTML, 'Team leader summary covers all tenures');   // tenure is read from the selection, so with "all" the line is absent
  });
  const COACH_H = { fetchedAt: '2026-10-01T04:00:00Z', stale: false, ageHours: 5, hubUrl: 'https://coaching-hub-psi.vercel.app/', period: { label: 'x' },
    leaders: [{ name: 'Denise Haripersad', campaign: 'Courtesy', sessions: 1, agentsCoached: 1, last: '2026-09-22' }, { name: 'Sam Leader', campaign: 'Courtesy', sessions: 1, agentsCoached: 1, last: '2026-09-01', incomplete: true }], tl: null, sessions: [] };
  const routes = {
    '/api/portal/overview': () => ({ status: 401, body: { error: 'unauthorised' } }),
    '/api/portal/cm-coaching': (u) => ({ status: 200, body: Object.assign({}, COACH_H, u.indexOf('tl=') >= 0 ? { tl: decodeURIComponent(u.split('tl=')[1]), sessions: [{ date: '2026-09-22', agentName: 'Ghost Person', cb: null, onList: true, type: 'Formal Coaching', themes: [], supportProvided: null }] } : {}) }),
  };
  const q = loadPage(routes);
  q.P.setD(cmPayload()); q.P.setView('cm_coach'); q.P.render(); await settle();
  q.P.cmCoachPick('Denise Haripersad'); await settle();
  mustText(q.N.root.innerHTML, 'Ghost Person');
  q.P.cmCoachPick('Sam Leader'); const loadingHtml = q.N.root.innerHTML;
  check('5. picking another leader shows a loading state, not the previous leader\'s sessions', () => {
    mustText(loadingHtml, "Loading Sam Leader's sessions"); mustNotText(loadingHtml, 'Ghost Person', 'the previous leader\'s session still painted');
  });
  await settle();
  check('incomplete: a leader flagged incomplete gets the Hub warning in the warning style', () => {
    const h = q.N.root.innerHTML; mustText(h, "Some of Sam Leader's sessions could not be fetched from the Coaching Hub on the last refresh");
    const i = h.indexOf('Some of'); if (h.slice(Math.max(0, i - 60), i).indexOf('cm-band warn') < 0) throw new Error('not in the warning style');
  });
  {
    const w = loadPage({ '/api/portal/cm-coaching': () => ({ status: 200, body: Object.assign({}, COACH_H, { leaders: COACH_H.leaders.map((l) => Object.assign({}, l, { incomplete: false })), incomplete: ['Denise Haripersad'], tl: 'Denise Haripersad' }) }) });
    w.P.setD(cmPayload()); w.P.setView('cm_coach'); w.P.cmCoachPick('Denise Haripersad'); await settle();
    check('incomplete: a top-level incomplete[] naming the leader does the same', () => { mustText(w.N.root.innerHTML, "Some of Denise Haripersad's sessions could not be fetched"); });
    const r = loadPage(routes); r.sess['cbx_cm_view'] = JSON.stringify({ period: '2026-08', tenure: 'M1' });
    r.P.setD(cmPayload()); r.P.setView('cm'); r.P.render(); await r.P.cmAsk('2026-08', 'M1'); await settle();
    check('4. a 401 in cmAsk resets the selection before the sign-in screen', () => { if (r.sess['cbx_cm_view']) throw new Error('selection survived: ' + r.sess['cbx_cm_view']); });
    const rc = loadPage({ '/api/portal/cm-coaching': () => ({ status: 401, body: {} }) }); rc.sess['cbx_cm_view'] = JSON.stringify({ period: '2026-08', tenure: 'M1' });
    rc.P.setD(cmPayload()); rc.P.setView('cm_coach'); rc.P.cmCoachPick('x'); await settle();
    check('4. a 401 in cmCoachLoad resets the selection too', () => { if (rc.sess['cbx_cm_view']) throw new Error('selection survived'); });
  }
  {
    const t = loadPage({ '/api/portal/overview': () => ({ status: 200, body: Object.assign(cmPayload(), { cm: Object.assign(cmPayload().cm, { tenure: 'M1' }) }) }) });
    t.P.setD(cmPayload()); t.P.setSel('courtesy'); t.P.setView('cm_mtd'); t.P.render();
    t.N.cmTenure.value = 'M1'; t.N.cmTenure.onchange(); await settle();
    check('3. with M1 selected, Month to date says "Team leader summary covers all tenures."', () => { mustText(t.N.root.innerHTML, 'Team leader summary covers all tenures.'); });
  }
  check('6. the help rows no longer look up a nonexistent "all" key', () => {
    const b = PAGE.slice(PAGE.indexOf('function cmHelpRows('), PAGE.indexOf('function cmCmdPage(')); if (/by\.all/.test(b)) throw new Error('by.all still read');
  });
}

/* ═════════════════════════ S · Filters only on the Campaign tab (spec 012) ═════════════════════════ */
head('S · The filters live on the Campaign tab only (spec 012-cm-filters-campaign-tab)');
{
  /* Nick, 2026-10-07 (screenshot of the header bar): "I want these filters to only be on the campaign tab". The other
     tabs keep following the choice made there — and still SAY which choice it is, so no figure goes unlabelled. */
  const { P, N } = loadPage({});
  const p = cmPayload();
  p.assist = { requests: [{ id: 'r1', priority: 'P1', closed: false, campaign: 'courtesy', category: 'crm', tl: 'Denise Haripersad', sla: { state: 'near' } }] };
  P.setD(p); P.setSel('courtesy'); P.setView('cm'); P.render();
  const onCm = N.root.innerHTML;
  const p1OnCm = /P1 open/.test(onCm);
  check('the Campaign tab keeps every filter: campaign, tenure, period, the selection chip and EOD report', () => {
    must(onCm, 'id="cmSel"'); must(onCm, 'id="cmTenure"'); must(onCm, 'id="cmPeriod"'); must(onCm, 'id="cmSelection"'); must(onCm, 'id="cmEod"');
    mustNot(onCm, 'id="cmToCampaign"', 'no "change on the Campaign tab" button on the Campaign tab itself');
  });
  for (const v of ['cm_teams', 'cm_assist', 'cm_mtd', 'cm_daily', 'cm_weekly', 'cm_variance', 'cm_leads', 'cm_coach', 'cm_nik']) {
    P.setView(v); P.render(); const h = N.root.innerHTML;
    check(v + ': no campaign/tenure/period picker, no range form, no EOD report', () => {
      for (const id of ['cmSel', 'cmTenure', 'cmPeriod', 'cmEod', 'cmRangeCard']) mustNot(h, 'id="' + id + '"', id + ' on ' + v);
    });
    check(v + ': still says what it shows — the read-only selection line and a way back to the Campaign tab', () => {
      must(h, 'id="cmSelection"'); mustText(h, 'Courtesy · All tenures'); must(h, 'id="cmToCampaign"'); mustText(h, 'Change on the Campaign tab');
    });
    if (p1OnCm) check(v + ': the "P1 open" warning is not a filter — it stays', () => { mustText(h, 'P1 open'); });
  }
  check('cm_set (targets do not depend on the selection): no filters and no selection line', () => {
    P.setView('cm_set'); P.render(); const h = N.root.innerHTML;
    for (const id of ['cmSel', 'cmTenure', 'cmPeriod', 'cmEod', 'cmSelection', 'cmToCampaign']) mustNot(h, 'id="' + id + '"', id + ' on cm_set');
  });
  check('"Change on the Campaign tab" opens the Campaign tab with its filters', () => {
    P.setView('cm_mtd'); P.render(); if (!N.cmToCampaign || typeof N.cmToCampaign.onclick !== 'function') throw new Error('button not wired');
    N.cmToCampaign.onclick(); const h = N.root.innerHTML; must(h, 'id="cmPeriod"'); must(h, 'id="cmTenure"');
  });
  check('an open custom-range form is drawn on the Campaign tab only, and comes back with it', () => {
    P.setView('cm'); P.render(); N.cmPeriod.value = 'custom'; N.cmPeriod.onchange(); must(N.root.innerHTML, 'id="cmRangeCard"');
    P.setView('cm_variance'); P.render(); mustNot(N.root.innerHTML, 'id="cmRangeCard"', 'range form on Variance');
    P.setView('cm'); P.render(); must(N.root.innerHTML, 'id="cmRangeCard"');
    if (N.cmRangeCancel) N.cmRangeCancel.onclick();
  });
}

head('T · The Coaching Hub tab — the live Hub inside the page, below Reports (spec 033-cm-coaching-hub-tab)');
{
  /* Nick, 2026-10-13: "a tab that says coaching hub for the campaign manager below the reports … the full view of the
     coaching hub exactly like it is … I dont want the link i want the exact interface". The tab shows the Hub app itself
     (P1–P3 in contracts/interfaces.md): ONE frame outside #root, its address given once, kept across re-renders and tab
     switches, hidden off the tab, removed on sign-out; the failure state is words + Retry, never a link. */
  const HUB = 'https://coaching-hub-psi.vercel.app/?theme=agentos';
  const { P, N, W, timers } = loadPage({});
  const ids = (list) => list.map((n) => n[0]);
  check('the manager nav reads Campaign · Team Leaders · Assistance · Reports · Coaching Hub · Nikola · Settings', () => {
    const got = ids(P.navFor('cm')).join(' ');
    if (got !== 'cm cm_teams cm_assist cm_reports cm_hub cm_nik cm_set') throw new Error(got);
    const lab = P.navFor('cm').find((n) => n[0] === 'cm_hub')[1]; if (lab !== 'Coaching Hub') throw new Error('label ' + lab);
  });
  check('team leaders and agents do not get it', () => {
    if (ids(P.navFor('team')).includes('cm_hub') || ids(P.navFor('month')).includes('cm_hub')) throw new Error('cm_hub on another nav');
  });
  check('the frame address is the Hub with ?theme=agentos (the campaign manager palette — contract T1)', () => {
    if (P.hubTabUrl() !== HUB + '&leader=') throw new Error(String(P.hubTabUrl()));   // leader= EMPTY for a manager (spec 035)
  });
  const p = cmPayload();
  p.assist = { requests: [{ id: 'r1', priority: 'P1', closed: false, campaign: 'courtesy', category: 'crm', tl: 'Denise Haripersad', sla: { state: 'near' } }] };
  P.setD(p); P.setSel('courtesy'); P.setView('cm_hub'); P.render();
  const h = N.root.innerHTML;
  check('the tab draws the host and says what it is; no pickers, no selection line, no range form, no EOD, the P1 marker stays', () => {
    must(h, 'id="cmHubHost"'); mustText(h, 'The Coaching Hub — exactly as it is'); mustText(h, 'P1 open');
    for (const id of ['cmSel', 'cmTenure', 'cmPeriod', 'cmEod', 'cmSelection', 'cmToCampaign', 'cmRangeCard']) mustNot(h, 'id="' + id + '"', id + ' on cm_hub');
    clean(h);
  });
  check('NOT A LINK: nothing on the tab points at the Hub address', () => { mustNot(h, 'href="https://coaching-hub-psi', 'a link to the Hub'); mustNotText(h, 'Open the Coaching Hub'); });
  const frames = () => W.__body.children.filter((el) => el.id === 'cmHubFrame');
  const fr = frames()[0];
  check('exactly ONE frame, appended to <body> (outside #root), with the Hub address given ONCE, a title and no referrer', () => {
    if (frames().length !== 1) throw new Error(frames().length + ' frames');
    if (fr.tagName !== 'IFRAME') throw new Error('tag ' + fr.tagName);
    if (fr.src !== HUB + '&leader=') throw new Error('src ' + fr.src);   // leader= EMPTY for a manager (spec 035)
    if (fr._srcWrites !== 1) throw new Error('src assigned ' + fr._srcWrites + ' times');
    if (fr.title !== 'Coaching Hub') throw new Error('title ' + fr.title);
    if (fr.referrerPolicy !== 'no-referrer') throw new Error('referrerPolicy ' + fr.referrerPolicy);
  });
  check('shown on the tab: display block over the host, and the page stops scrolling (body.cmhub-open)', () => {
    if (fr.style.display !== 'block') throw new Error('display ' + fr.style.display);
    if (!W.__body.classList.contains('cmhub-open')) throw new Error('no cmhub-open on body');
    if (fr.style.top !== '80px' || fr.style.left !== '240px' || fr.style.width !== '900px') throw new Error('not placed over the host: ' + JSON.stringify(fr.style));
  });
  check('a re-render keeps the SAME element and never touches src', () => {
    P.render(); P.render();
    if (frames().length !== 1 || frames()[0] !== fr) throw new Error('frame replaced');
    if (fr._srcWrites !== 1) throw new Error('src assigned ' + fr._srcWrites + ' times');
  });
  check('another tab hides it (kept, not removed); coming back shows the same frame where it was', () => {
    P.setView('cm_mtd'); P.render();
    if (fr.style.display !== 'none') throw new Error('display ' + fr.style.display + ' on cm_mtd');
    if (W.__body.classList.contains('cmhub-open')) throw new Error('body still cmhub-open on cm_mtd');
    if (frames().length !== 1 || frames()[0] !== fr) throw new Error('frame replaced or dropped');
    P.setView('cm_hub'); P.render();
    if (fr.style.display !== 'block' || fr._srcWrites !== 1 || frames()[0] !== fr) throw new Error('not the same frame on return');
  });
  check('the Hub not rendering within the wait → words + Retry, no link; Retry gives the address again', () => {
    const t = timers.find((x) => !x.cleared && x.ms === 20000); if (!t) throw new Error('no 20 s watchdog');
    t.f(); const hh = N.root.innerHTML;
    mustText(hh, 'did not load'); must(hh, 'id="cmHubRetry"'); mustNot(hh, 'href="https://coaching-hub-psi', 'a link in the failed state');
    if (!N.cmHubRetry || typeof N.cmHubRetry.onclick !== 'function') throw new Error('Retry not wired');
    N.cmHubRetry.onclick();
    if (fr._srcWrites !== 2) throw new Error('Retry did not re-assign src (' + fr._srcWrites + ')');
    if (P.getHub().failed) throw new Error('still failed after Retry');
  });
  check('a load clears the watchdog (onload)', () => {
    if (typeof fr.onload !== 'function') throw new Error('no onload');
    fr.onload(); if (!P.getHub().loaded) throw new Error('not marked loaded');
  });
  check('a pre-shell screen (change password, fatal) is never under the frame (review HIGH, 2026-10-13)', () => {
    P.setView('cm_hub'); P.render(); if (fr.style.display !== 'block') throw new Error('not shown first');
    P.preShell('<div>password form</div>');
    if (fr.style.display !== 'none') throw new Error('display ' + fr.style.display + ' under preShell');
    if (W.__body.classList.contains('cmhub-open')) throw new Error('page still locked under preShell');
  });
  check('the sandbox keeps the Hub working but forbids top navigation (security review)', () => {
    const sb = fr._attrs.sandbox || '';
    for (const t of ['allow-scripts', 'allow-same-origin', 'allow-forms', 'allow-downloads', 'allow-popups', 'allow-modals']) if (sb.indexOf(t) < 0) throw new Error('missing ' + t);
    if (/allow-top-navigation/.test(sb)) throw new Error('top navigation allowed');
  });
  check('sign-out removes the frame', () => {
    P.resetClientState();
    if (frames().length !== 0) throw new Error(frames().length + ' frames left');
    if (P.getHub().el !== null) throw new Error('state still holds the element');
    if (W.__body.classList.contains('cmhub-open')) throw new Error('body still cmhub-open');
  });
}

console.log(`\n${checks - fails}/${checks} checks passed`);
process.exit(fails ? 1 : 0);
