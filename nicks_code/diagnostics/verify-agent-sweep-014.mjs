#!/usr/bin/env node
/**
 * verify-agent-sweep-014.mjs — Spec Kit 014 (system bug sweep), Area A: Agent Analytics + Wimpy.
 *
 * Run:  node nicks_code/diagnostics/verify-agent-sweep-014.mjs
 *
 *   A1  sign-out and every 401 / session-expired path leave NO previous person's data in memory
 *       (agent/index.html: coaching hub, drafts, help, reports, half-typed forms, the held refresh, VIEW, the CM
 *       state, the drawer and overlays) — and a reply to a request asked before the sign-out is never let in
 *       (review R2) api() ends the session on ANY 401 but sign-in / sign-out — once, never under the next person
 *   A2  a campaign manager's Variance / Lead management never show the LIVE month under a past month's or a
 *       billing month's label: the Worker publishes those two reports for the live month and custom ranges only
 *   A3  Wimpy: a cart line whose item left the menu (yesterday's Big One after the day flips) is dropped and said
 *       (review R1) …and when that empties the cart on the Confirm / form step, the page goes back to the menu
 *   A4  Wimpy: sign-out never hands the previous person's name / surname / phone / notes to the next one
 *   A5  Wimpy: the window-flip re-render keeps what is being typed in the order form
 *   A6  KPI form dates are the SAST day, never the UTC one
 *
 * The agent page runs in the stubbed DOM of verify-cm-view.mjs (the page script evaluated with a fake fetch);
 * Wimpy runs in a real Chromium (the Playwright harness of verify-wimpy.mjs) against a stubbed Worker, with the
 * page's clock driven so the 30-second window check really flips.
 *
 * Exit code 0 = safe to ship. Non-zero = do not deploy.
 */
process.env.TZ = 'UTC';   // A6: a machine in SAST would hide a UTC-day slip — run the page as a browser in UTC sees it

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
/* AGENT_HTML / WIMPY_HTML (repo-relative) point the suite at another copy — the build output, or a pre-fix copy to show RED */
const AGENT_PAGE = path.resolve(ROOT, ...(process.env.AGENT_HTML || 'agent/index.html').split('/'));
const PAGE = fs.readFileSync(AGENT_PAGE, 'utf8');
const WIMPY_PAGE = path.resolve(ROOT, ...(process.env.WIMPY_HTML || 'wimpy/index.html').split('/'));

let fails = 0, checks = 0;
const ok = (m) => { checks++; console.log('  \x1b[32m✓\x1b[0m ' + m); };
const bad = (m, d) => { checks++; fails++; console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '\n      ' + d : '')); };
const head = (m) => console.log('\n\x1b[1m' + m + '\x1b[0m');
const check = (label, fn) => { try { const r = fn(); r === false ? bad(label) : ok(label); } catch (e) { bad(label, e.message); } };
const text = (h) => String(h).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&rsquo;/g, "'").replace(/\s+/g, ' ');
const must = (h, s, why) => { if (String(h).indexOf(s) < 0) throw new Error((why || 'missing') + ': ' + JSON.stringify(s)); };
const mustText = (h, s, why) => { if (text(h).indexOf(s) < 0) throw new Error((why || 'missing') + ': ' + JSON.stringify(s) + '\n      in: ' + text(h).slice(0, 400)); };
const mustNotText = (h, s, why) => { if (text(h).indexOf(s) >= 0) throw new Error((why || 'must not appear') + ': ' + JSON.stringify(s)); };
const clean = (h) => { if (/undefined|NaN|\[object Object\]/.test(h)) throw new Error('placeholder leaked: ' + (h.match(/.{0,40}(undefined|NaN|\[object Object\]).{0,40}/) || [])[0]); };

/* ------------------------------------------------------------------ the agent page, in a stubbed DOM */
function classList() {
  const s = new Set();
  return { add: (...c) => c.forEach((x) => s.add(x)), remove: (...c) => c.forEach((x) => s.delete(x)), contains: (c) => s.has(c), toggle: (c, on) => { (on === undefined ? !s.has(c) : on) ? s.add(c) : s.delete(c); }, _s: s };
}
function loadPage(routes, opts) {
  opts = opts || {};
  const m = PAGE.match(/<script>\n"use strict";([\s\S]*?)<\/script>/);
  if (!m) throw new Error('could not find the page script');
  const src = m[1].replace(/\nboot\(\);\s*$/, '\n');
  const nodes = {}, removed = [], cmovs = [];
  const mkEl = (id) => {
    const el = {
      id: id || '', innerHTML: '', textContent: '', value: '', style: {}, classList: classList(), disabled: false,
      addEventListener() {}, setAttribute() {}, getAttribute: () => null, querySelectorAll: () => [], querySelector: () => null,
      insertAdjacentHTML() {}, focus() {}, onclick: null, onchange: null, appendChild() {},
      remove() { removed.push(el.id || el.className || '(anon)'); if (el.id && nodes[el.id] === el) delete nodes[el.id]; const i = cmovs.indexOf(el); if (i >= 0) cmovs.splice(i, 1); },
    };
    return el;
  };
  const body = mkEl('body');
  body.appendChild = (el) => { if (el.className === 'cmov') cmovs.push(el); if (el.id) nodes[el.id] = el; };
  const doc = {
    getElementById: (id) => (nodes[id] = nodes[id] || mkEl(id)),
    querySelectorAll: (sel) => (sel === '.cmov' ? cmovs.slice() : []),
    createElement: () => mkEl(''), body, hidden: false,
    addEventListener() {}, removeEventListener() {},
  };
  const store = {}, sess = {};
  const win = {
    location: { search: '' },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; }, removeItem: (k) => { delete store[k]; } },
    scrollTo() {}, addEventListener() {}, confirm: () => true,
  };
  const session = { getItem: (k) => (k in sess ? sess[k] : null), setItem: (k, v) => { sess[k] = String(v); }, removeItem: (k) => { delete sess[k]; } };
  const calls = [], held = [];
  const timers = [];
  const setT = (f, ms) => { timers.push({ f, ms, cleared: false }); return timers.length; };
  const clearT = (id) => { const t = timers[id - 1]; if (t) t.cleared = true; };
  const fetchImpl = (url, o) => {
    const u = String(url).replace(/^https?:\/\/[^/]+/, '');
    const auth = (o && o.headers && o.headers.Authorization) || '';
    calls.push({ u, auth, body: o && o.body ? JSON.parse(o.body) : null });
    const path0 = u.split('?')[0];
    const r = routes && routes[path0] ? routes[path0](u, auth) : { status: 404, body: { error: 'no route in test' } };
    const answer = () => ({ ok: r.status < 400, status: r.status, json: () => Promise.resolve(r.body) });
    if (r && r.hold) return new Promise((res) => held.push(() => res(answer())));
    return Promise.resolve(answer());
  };
  /* a fixed "now" for A6 — new Date() / Date.now() inside the page read it; new Date(x) is the real thing */
  const RealDate = Date;
  const NOW = opts.now != null ? opts.now : null;
  const FakeDate = NOW == null ? RealDate : class extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(NOW); }
    static now() { return NOW; }
  };
  const fn = new Function(
    'document', 'window', 'localStorage', 'sessionStorage', 'location', 'fetch', 'URLSearchParams', 'setTimeout', 'setInterval', 'clearInterval', 'Intl', 'console', 'clearTimeout', 'Date',
    src + '\nreturn { get: function(n){ return eval(n); }, set: function(n, v){ var __v = v; eval(n + " = __v"); } };',
  );
  const P = fn(doc, win, win.localStorage, session, win.location, fetchImpl, URLSearchParams, setT, () => 0, () => {}, Intl, { log() {}, error() {} }, clearT, FakeDate);
  const call = (name, ...a) => P.get(name)(...a);
  return { P, call, N: nodes, calls, held, sess, W: win, removed, cmovs, body, timers };
}
/* the browser's next task: run the page's zero-delay timers (and any they queue), then let the promises settle */
const nextTask = async (T) => {
  for (let guard = 0; guard < 20; guard++) {
    const due = T.timers.filter((t) => !t.cleared && !t.ran && !t.ms); if (!due.length) break;
    due.forEach((t) => { t.ran = true; t.f(); }); await settle();
  }
};
const tick = () => new Promise((r) => setImmediate(r));
const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };

/* ------------------------------------------------------------------ fixtures, shaped like the Worker's */
function agentRow(code, name, tl, campaignName, over) {
  const days = [
    { d: '2026-09-29', w: 40, emp: 1, act: 1, t: 5, s: 3, x: 900, tk: 14000, c: 80, r: 1 },
    { d: '2026-09-30', w: 40, emp: 1, act: 1, t: 5, s: 4, x: 1200, tk: 15000, c: 90, r: 0 },
  ];
  return Object.assign({ code, name, tl, campaign: campaignName, tenure: 'M1', plan: 'M1', covered: true, emp: 20, act: 18, att: 0.9, target: 100, sales: 70, pctT: 0.7, spd: 3.9,
    canc: 1, talk: 90000, aveTalk: 4500, talkPerWorked: 5000, gwpT: 8000, gwpEx: 6000, aveG: 400, ref: 2, qa: 0.9, score: 0.8, days,
    wk: [{ n: 40, emp: 2, act: 2, sales: 7, target: 10, pctT: 0.7, spd: 3.5, gwpEx: 2100, gwpT: 1600, aveG: 300, att: 1, qa: 0.9, ref: 1, talk: 29000, aveTalk: 14500, talkPerWorked: 14500 }] }, over || {});
}
const tlPayload = (name, agents, over) => Object.assign({
  v: 1, role: 'team_leader', scope: 'team', name, team: name, updatedAt: '2026-10-01T06:00:00Z', period: { from: '2026-10-01', to: '2026-10-31' },
  diallingDays: 1, workingDays: 21, dates: ['2026-10-01'], agents, totals: { agents: agents.length, reporting: agents.length, gwpEx: 6000, sales: 70, target: 100, pctT: 0.7, aveG: 400, att: 0.9, qa: 0.9, ref: 2, onTarget: 0 },
  spark: [1], coaching: { windowDays: 90, totals: { sessions: 0, agents: 0, scored: 0 }, agents: [] },
}, over || {});
const TL_A = () => tlPayload('Denise Haripersad', [agentRow('CB1', 'Ann Agent', 'Denise Haripersad', 'Courtesy')]);
const TL_A_FRESH = () => tlPayload('Denise Haripersad', [agentRow('CB1', 'Ann Agent', 'Denise Haripersad', 'Courtesy', { sales: 99 })], { updatedAt: '2026-10-01T09:00:00Z' });
const TL_B = () => tlPayload('Bongani Leader', [agentRow('CB2', 'Bea Buyer', 'Bongani Leader', 'Cuddle')]);
const USER_A = { username: 'cb267', full_name: 'Denise Haripersad', role: 'team_leader', cb: 'CB267' };
const USER_B = { username: 'cb300', full_name: 'Bongani Leader', role: 'team_leader', cb: 'CB300' };
const AGENT_A = () => ({ v: 1, role: 'agent', name: 'Ann Agent', updatedAt: '2026-10-01T06:00:00Z', period: { from: '2026-10-01', to: '2026-10-31' },
  diallingDays: 1, workingDays: 21, dates: ['2026-10-01'], me: agentRow('CB1', 'Ann Agent', 'Denise Haripersad', 'Courtesy'), agents: [agentRow('CB1', 'Ann Agent', 'Denise Haripersad', 'Courtesy')],
  coaching: { windowDays: 90, agents: [{ code: 'CB1', count: 0, sessions: [], themes: [] }] } });

function tenures(list) { return list.map((k) => ({ key: k, label: k, agents: 5 })); }
function teamRow(tl, over) {
  return Object.assign({ tl, team: tl + ' team', agents: 6, sales: 60, target: 80, pct: 0.75, gwp: 20000, aveG: 410, qa: 0.88, cancRate: 0.02, att: 0.94,
    conv: { v: 0.125, sales: 60, closed: 480, target: 0.1, basis: 'sales ÷ closed leads' }, contactRate: { v: 0.375, contacts: 300, dials: 800 },
    open: 0, top: null, outside: 0, repeats: 0, lastSession: null, after: null, rag: 'g', state: 'On track', next: 'Keep going', codes: [] }, over || {});
}
function campaign(key, label, over) {
  return Object.assign({
    key, label, agents: 12, teamLeaders: 2, leaders: 2, reconciled: true, projection: null, brief: { signals: [], actions: [] },
    unattributed: { agents: [], notCovered: [] }, agentIndex: [{ code: 'CB1', name: 'Ann Agent' }], tenures: tenures(['M0', 'M1']),
    kpis: {
      sales: { v: 120, target: 150, month: 300, pct: 0.8 }, gwp: { v: 50000, target: 80000, projected: 90000 }, aveG: { v: 400, ref: 86.08, refIncl: 99 }, pitches: null,
      conv: { v: 0.125, sales: 60, closed: 480, target: 0.1, basis: 'sales ÷ closed leads' }, convWhy: '', talk: { v: 16320, targetMin: 300, targetSec: 18000, source: 'default' },
      attempts: null, contactRate: { v: 0.375, contacts: 300, dials: 800 }, contactWhy: '', leads: null, qa: { v: 0.9, target: 0.9 }, checks: null,
      crit: { fails: 0, p1Open: 0 }, canc: { v: 3, rate: 0.02, guard: 0.1 }, att: { v: 0.95, target: 0.95, productive: 10, agents: 12 },
    },
    teams: [teamRow('Denise Haripersad')],
  }, over || {});
}
const AGG = (over) => Object.assign({ hc: 6, emp: 120, act: 108, att: 0.9, target: 600, sales: 420, pctT: 0.7, spd: 3.9, canc: 6, cancPct: 0.014, gwpT: 48000, gwp: 36000, pctG: 0.75, aveG: 400, aveTalk: 4500, ref: 12, refPct: 0.03, onT: 2 }, over || {});
const PER_CUR = { kind: 'current', key: 'current', from: '2026-10-01', to: '2026-10-31', label: '1 – 31 October 2026' };
const PER_AUG = { kind: 'month', key: '2026-08', from: '2026-08-01', to: '2026-08-31', label: '1 – 31 August 2026' };
const PER_CYC = { kind: 'cycle', key: 'cycle-2026-09', from: '2026-08-26', to: '2026-09-25', label: '26 Aug – 25 Sep 2026' };
const PERIODS = { months: ['2026-09', '2026-08'], cycles: [{ key: 'cycle-2026-09', from: '2026-08-26', to: '2026-09-25', label: '26 Aug – 25 Sep 2026', complete: true, published: true }] };
function cmPayload(period, over) {
  return Object.assign({
    scope: 'campaign', role: 'campaign_manager', name: 'Ryan Manager', updatedAt: '2026-10-01T06:00:00Z',
    period, periods: PERIODS, diallingDays: 20, workingDays: 21, talkUnit: 'minutes', dates: ['2026-09-29', '2026-09-30'], weeks: [{ num: 40, from: '2026-09-28', to: '2026-10-04' }],
    cm: { name: 'Ryan Manager', tenure: 'all', freshness: { label: 'Data uploaded', updatedAt: '2026-10-01T06:00:00Z', stale: false }, campaigns: [campaign('courtesy', 'Courtesy')] },
    assist: { kpis: null, requests: [], blockages: [], blockPanel: [], blockPanelByCamp: { courtesy: [] } },
    agents: [agentRow('CB1', 'Ann Agent', 'Denise Haripersad', 'Courtesy')],
    tlAgg: [Object.assign({ tl: 'Denise Haripersad', camp: 'Courtesy' }, AGG())], campAgg: { Courtesy: AGG({ hc: 12 }) },
  }, over || {});
}
/* the LIVE month's Variance report, as the Worker slices it for a campaign manager */
const LIVE_VARIANCE = () => ({
  updatedAt: '2026-10-07T08:00:00Z', kind: 'variance', campBlocks: 'ok', rules: { statusLabels: {}, rootCauses: {}, gwpTolerance: 1 }, days: [{ d: '2026-10-06', board: true, bi: true }],
  cols: ['d', 'camp', 'bs', 'ss', 'vs', 'vsv', 'st'], agents: { CB1: [['2026-10-06', 'Courtesy', 7, 9, 2, 'material', 'material']] },
  teamsByCamp: { 'Courtesy|Denise Haripersad': { camp: 'Courtesy', tl: 'Denise Haripersad', agents: 1, rows: 1, exact: 0, rounding: 0, material: 1, blocked: 0, indeterminate: 0, flags: 0, rc: {} } },
  campaigns: { Courtesy: { camp: 'Courtesy', agents: 1, rows: 1, exact: 0, rounding: 0, material: 1, blocked: 0, indeterminate: 0, flags: 0, rc: {} } }, teams: {},
});
const LIVE_LEADS = () => ({
  updatedAt: '2026-10-07T08:00:00Z', kind: 'leads', campBlocks: 'ok', cols: [], statuses: [], wd: 5, rules: { convTarget: 10 }, book: {},
  agents: { CB1: { open: 31, tc: 41, nofb: 1, sales: 17, pSpd: 1, convL: 12, convC: 20 } },
  teamsByCamp: { 'Cuddle|Denise Haripersad': { camp: 'Cuddle', tl: 'Denise Haripersad', agents: 1, open: 31, tc: 41, sales: 17 } },
  campaigns: { Cuddle: { camp: 'Cuddle', open: 31, tc: 41, sales: 17 } }, teams: {},
});

/* ------------------------------------------------------------------ A1: what a previous person may leave behind */
/* everything A had in memory on a working afternoon: their coaching hub copy, a half-typed coaching document and KPI form,
   the help center, their own help requests, both reports, a refresh held behind the form, an open drawer and overlays */
function populate(T) {
  const S = T.P.set;
  S('HUB', { coaching: { sessions: [{ _id: 's1', agentName: 'Ann Agent', employeeCode: 'CB1' }] }, kpi: { forms: [{ _id: 'k1', agentName: 'Ann Agent' }] }, drafts: { drafts: [{ id: 'd1', agentName: 'Ann Agent' }] }, flash: 'Saved Ann', busy: false });
  S('CFORM', { type: 'formal', data: { agentName: 'Ann Agent', notes: 'half-typed about Ann' }, dirty: true, saving: false, draftId: 'd1', base: 'v1' });
  S('FORM', { id: 'k1', kind: 'monthly', meta: { _id: 'k1' }, data: { agentFullName: 'Ann Agent' }, page: 2, dirty: true, saving: false });
  S('FILT', { q: 'ann', kind: 'kpi' });
  S('HELPD', { requests: [{ id: 'h1', agent: 'Ann Agent', note: 'call me' }] }); S('FAILS', { fails: [{ agent: 'Ann Agent' }] }); S('SYNCS', { rows: [{ agent: 'Ann Agent' }] });
  S('MYHELP', { requests: [{ id: 'm1', note: 'Ann asked' }] });
  const rep = T.P.get('REP'); rep.variance.d = LIVE_VARIANCE(); rep.leads.d = LIVE_LEADS();
  T.P.get('LIVE').pending = TL_A_FRESH();
  S('TLA', { requests: [{ id: 'r1', agent: 'Ann Agent' }] }); S('ACTS', { stages: [], actions: { CB1: { stage: 'open' } } }); S('EXPANDED', { CB1: true });
  S('DRAWER_ME', agentRow('CB1', 'Ann Agent', 'Denise Haripersad', 'Courtesy')); S('DRAWER_CB', 'CB1');
  S('DAY_FILTER', '2026-10-01'); S('VAR_DAY', '2026-10-06'); S('HELP_UNREAD', 3); S('EXTRA', 3);
  S('VIEW', 'help'); S('LAST_REPORT', 'variance_team'); S('LAST_CM_REPORT', 'cm_leads');
  S('CMSEL', 'courtesy'); S('CMEXP', { 'Denise Haripersad': true }); S('CMF', { team: 'Denise Haripersad', pri: 'P1', blk: '', sla: '', st: '' });
  T.P.get('CMC').d = { leaders: [{ tl: 'Denise Haripersad' }] }; T.P.get('CMC').tl = 'Denise Haripersad';
  S('VIEWMONTH', '2026-09'); S('LIVE_MONTH_NAME', 'October');
  /* overlays outside #root */
  const dr = T.call('$', 'cbxDrawer'); dr.innerHTML = '<div class="dk-nm">Ann Agent</div>'; dr.classList.add('open');
  T.call('$', 'cbxScrim').classList.add('open');
  const jm = T.call('$', 'cbxJourney'); jm.innerHTML = 'How Ann\'s score works'; jm.classList.add('open');
  T.call('$', 'helpOv').innerHTML = 'Tell Denise what happened'; T.call('$', 'drillOv').innerHTML = 'Ann: what is driving it';
  const cm = { className: 'cmov', id: '', innerHTML: 'request about Ann', classList: classList(), remove() { T.removed.push('cmov'); const i = T.cmovs.indexOf(cm); if (i >= 0) T.cmovs.splice(i, 1); } };
  T.cmovs.push(cm);
  const t = T.call('$', 'toast'); t.textContent = 'Saved Ann\'s form'; t.classList.add('show');
  T.body.classList.add('dk-locked');
}
/* what is still there afterwards, by name — an empty list is the pass */
function leftovers(T) {
  const g = T.P.get, out = [];
  const hub = g('HUB'); if (hub.coaching || hub.kpi || hub.drafts || hub.flash) out.push('HUB (coaching hub / KPI hub / drafts)');
  const cf = g('CFORM'); if (cf.type || cf.data || cf.dirty || cf.draftId || cf.base) out.push('CFORM (the half-typed coaching document)');
  const f = g('FORM'); if (f.id || f.data || f.meta || f.dirty) out.push('FORM (the half-typed KPI form)');
  if (g('FILT').q || g('FILT').kind !== 'all') out.push('FILT (the forms search)');
  if (g('HELPD') || g('FAILS') || g('SYNCS')) out.push('HELPD/FAILS/SYNCS (help center)');
  if (g('MYHELP')) out.push('MYHELP (own help requests)');
  const rep = g('REP'); if (rep.variance.d || rep.leads.d) out.push('REP.*.d (Variance / Lead management)');
  if (g('LIVE').pending) out.push('LIVE.pending (a refresh held behind a form)');
  if (g('TLA') || g('ACTS') || Object.keys(g('EXPANDED')).length) out.push('TLA/ACTS/EXPANDED');
  if (g('DRAWER_ME') || g('DRAWER_CB')) out.push('DRAWER_ME/DRAWER_CB');
  if (g('DAY_FILTER') || g('VAR_DAY')) out.push('DAY_FILTER/VAR_DAY');
  if (g('HELP_UNREAD')) out.push('HELP_UNREAD');
  if (g('EXTRA') !== 1) out.push('EXTRA (the what-if pill)');
  if (g('VIEW') !== 'month' || g('LAST_REPORT') !== 'mtd_team' || g('LAST_CM_REPORT') !== 'cm_mtd') out.push('VIEW/LAST_REPORT (' + g('VIEW') + ')');
  if (g('D') || g('U') || g('ME') || g('TEAM')) out.push('D/U/ME/TEAM');
  if (g('CMSEL') || Object.keys(g('CMEXP')).length || g('CMF').team || g('CMF').pri) out.push('CMSEL/CMEXP/CMF (campaign manager)');
  if (g('CMC').d || g('CMC').tl || g('CMPER') !== 'current' || g('CMTEN') !== 'all') out.push('CMC/CMPER/CMTEN (campaign manager)');
  if (g('VIEWMONTH') || g('LIVE_MONTH_NAME')) out.push('VIEWMONTH/LIVE_MONTH_NAME');
  if (T.sess.cbx_agent_token) out.push('the session token');
  /* the overlays live outside #root, so the sign-in screen does not paint over them */
  const dr = T.N.cbxDrawer; if (dr && (dr.classList.contains('open') || /Ann/.test(dr.innerHTML))) out.push('the agent drawer (#cbxDrawer)');
  const jm = T.N.cbxJourney; if (jm && (jm.classList.contains('open') || /Ann/.test(jm.innerHTML))) out.push('the score journey (#cbxJourney)');
  if (T.removed.indexOf('helpOv') < 0) out.push('the help overlay (#helpOv)');
  if (T.removed.indexOf('drillOv') < 0) out.push('the KPI drill-down (#drillOv)');
  if (T.cmovs.length) out.push('a campaign-manager request panel (.cmov)');
  const t = T.N.toast; if (t && t.classList.contains('show') && /Ann/.test(t.textContent)) out.push('the toast');
  if (T.body.classList.contains('dk-locked')) out.push('the body scroll lock');
  return out;
}
const nothingLeft = (T) => { const l = leftovers(T); if (l.length) throw new Error('still in memory: ' + l.join(' · ')); };

/* ═════════════════════════ A1 · sign-out ═════════════════════════ */
head('A1 · Sign-out leaves nothing of the previous person (agent/index.html)');
{
  const routes = {
    '/api/portal/overview': (u, auth) => ({ status: 200, body: auth === 'Bearer tokB' ? TL_B() : TL_A() }),
    '/api/logout': () => ({ status: 200, body: { ok: true } }),
    '/api/login': () => ({ status: 200, body: { token: 'tokB', user: USER_B } }),
  };
  const T = loadPage(routes);
  T.sess.cbx_agent_token = 'tokA'; T.P.set('U', USER_A); T.call('loadPortal'); await settle();
  check('(setup) team leader A\'s page is on screen', () => {
    const D = T.P.get('D'); if (!D || D.name !== 'Denise Haripersad') throw new Error('D is ' + (D && D.name)); mustText(T.N.root.innerHTML, 'Denise');
  });
  populate(T);
  T.call('signOut'); await settle();
  check('sign-out: nothing of A is left in memory or on screen (every store, form, report, overlay)', () => nothingLeft(T));
  check('sign-out still tells the Worker (/api/logout with A\'s token) and shows the sign-in screen', () => {
    const lo = T.calls.filter((c) => c.u === '/api/logout'); if (lo.length !== 1 || lo[0].auth !== 'Bearer tokA') throw new Error(JSON.stringify(lo));
    mustText(T.N.root.innerHTML, 'CB number'); mustNotText(T.N.root.innerHTML, 'Ann');
  });
  /* the next person, on the same page */
  T.N.cb.value = 'CB300'; T.N.pw.value = 'b-password-1'; T.N.go.onclick(); await settle();
  check('the next person signs in on the same page (the sign-in reply is let in), lands on their own My Team, and sees only their team', () => {
    const D = T.P.get('D'); if (!D || D.name !== 'Bongani Leader') throw new Error('D is ' + (D && D.name));
    if (T.P.get('VIEW') !== 'team') throw new Error('landed on A\'s last tab: ' + T.P.get('VIEW'));
    mustText(T.N.root.innerHTML, 'Bongani'); mustNotText(T.N.root.innerHTML, 'Denise'); mustNotText(T.N.root.innerHTML, 'Ann Agent');
  });
}
{
  /* a refresh that arrived while A had a form open is held in LIVE.pending and lands on the next safe render — which,
     after a sign-out, must never be the next person's */
  const routes = {
    '/api/portal/overview': (u, auth) => ({ status: 200, body: auth === 'Bearer tokB' ? TL_B() : TL_A() }),
    '/api/logout': () => ({ status: 200, body: { ok: true } }),
    '/api/login': () => ({ status: 200, body: { token: 'tokB', user: USER_B } }),
  };
  const T = loadPage(routes);
  T.sess.cbx_agent_token = 'tokA'; T.P.set('U', USER_A); T.call('loadPortal'); await settle();
  T.P.set('VIEW', 'team'); T.P.get('LIVE').pending = TL_A_FRESH();
  T.call('signOut'); await settle();
  T.N.cb.value = 'CB300'; T.N.pw.value = 'b-password-1'; T.N.go.onclick(); await settle();
  T.call('render');
  check('B\'s next render never swaps in the refresh held for A (LIVE.pending)', () => {
    const D = T.P.get('D'); if (!D || D.name !== 'Bongani Leader') throw new Error('the page now holds ' + (D && D.name) + '\'s payload');
    mustNotText(T.N.root.innerHTML, 'Ann Agent');
  });
}
{
  /* replies to requests A made before signing out arrive after it: none may be let in */
  const routes = {
    '/api/portal/overview': (u, auth) => ({ status: 200, body: TL_A() }),
    '/api/logout': () => ({ status: 200, body: { ok: true } }),
    '/api/portal/help/list': () => ({ hold: true, status: 200, body: { requests: [{ id: 'h1', agent: 'Ann Agent' }] } }),
    '/api/portal/help/fails': () => ({ hold: true, status: 200, body: { fails: [{ agent: 'Ann Agent' }] } }),
    '/api/portal/help/sync-coaching': () => ({ hold: true, status: 200, body: { rows: [] } }),
    '/api/portal/hub/coaching': () => ({ hold: true, status: 200, body: { sessions: [{ agentName: 'Ann Agent' }] } }),
    '/api/portal/hub/coaching/drafts': () => ({ hold: true, status: 200, body: { drafts: [{ id: 'd1', agentName: 'Ann Agent' }] } }),
    '/api/portal/help/mine': () => ({ hold: true, status: 200, body: { requests: [{ id: 'm1' }] } }),
    '/api/portal/tl/reports': () => ({ hold: true, status: 200, body: LIVE_VARIANCE() }),
  };
  const T = loadPage(routes);
  T.sess.cbx_agent_token = 'tokA'; T.P.set('U', USER_A); T.call('loadPortal'); await settle();
  T.call('helpLoad'); T.call('hubLoad', 'coaching'); T.call('myHelpLoad'); T.P.set('VIEW', 'variance_team'); T.call('repLoad', 'variance', false);
  const n = T.held.length;
  T.call('signOut'); await settle();
  T.held.forEach((r) => r()); await settle();
  check('(setup) ' + n + ' of A\'s requests were still on their way at sign-out', () => n >= 6);
  check('…and none of their replies lands after it (help center, hub, drafts, my help, reports)', () => {
    const g = T.P.get, l = [];
    if (g('HELPD') || g('FAILS') || g('SYNCS')) l.push('HELPD/FAILS/SYNCS'); if (g('HUB').coaching || g('HUB').drafts) l.push('HUB');
    if (g('MYHELP')) l.push('MYHELP'); if (g('REP').variance.d) l.push('REP.variance.d');
    if (l.length) throw new Error('let in after sign-out: ' + l.join(', '));
    mustNotText(T.N.root.innerHTML, 'Ann');
  });
}

/* ═════════════════════════ A1 · every 401 ═════════════════════════ */
head('A1 · Every 401 / session-expired path leaves nothing behind');
{
  const EXPIRED = 'Your session has expired. Please sign in again.';
  const r401 = () => ({ status: 401, body: { error: 'Session expired' } });
  const cases = [
    ['loadPortal (any re-open of the page)', { '/api/portal/overview': r401 }, (T) => { T.P.set('D', TL_A()); T.P.set('TEAM', T.P.get('D')); }, (T) => T.call('loadPortal')],
    ['refreshPortal (the team leader\'s two-minute refresh)', { '/api/portal/overview': r401 }, (T) => { T.P.set('D', TL_A()); T.P.set('VIEW', 'team'); }, (T) => T.call('refreshPortal', true)],
    ['refreshAgent (the agent\'s five-minute refresh)', { '/api/portal/overview': r401 }, (T) => { T.P.set('D', AGENT_A()); T.P.set('ME', T.P.get('D').me); T.P.set('TEAM', null); }, (T) => T.call('refreshAgent')],
    ['askMonth (the closed month)', { '/api/portal/overview': r401 }, (T) => { T.P.set('D', AGENT_A()); }, (T) => T.call('askMonth', '2026-09')],
    ['cmAsk (the campaign manager\'s period / tenure)', { '/api/portal/overview': r401 }, (T) => { T.P.set('D', cmPayload(PER_CUR)); T.P.set('VIEW', 'cm'); }, (T) => T.call('cmAsk', '2026-08', 'all')],
    ['cmCoachLoad (team leaders\' coaching)', { '/api/portal/cm-coaching': r401 }, (T) => { T.P.set('D', cmPayload(PER_CUR)); T.P.set('VIEW', 'cm_coach'); }, (T) => T.call('cmCoachLoad', true)],
  ];
  for (const [name, routes, setup, go] of cases) {
    const T = loadPage(routes);
    T.sess.cbx_agent_token = 'tokA'; T.P.set('U', USER_A);
    populate(T); setup(T);
    go(T); await settle(); await nextTask(T);
    check('401 on ' + name + ': the sign-in screen says the session expired and nothing is left', () => {
      mustText(T.N.root.innerHTML, EXPIRED); nothingLeft(T);
    });
  }
}
{
  /* review R2: these callers painted an error on a 401 ("session") and never signed out, so the previous person's data
     stayed on screen until someone pressed Sign out — api() itself now ends the session on any 401 but sign-in/out */
  const EXPIRED = 'Your session has expired. Please sign in again.';
  const r401 = () => ({ status: 401, body: { error: 'Session expired' } });
  const asTL = (T) => { T.P.set('D', TL_A()); T.P.set('TEAM', T.P.get('D')); T.P.set('VIEWMONTH', ''); };
  /* counts the sign-in screen being painted — one 401 (or three at once) must paint it exactly once */
  const countPaints = (T) => { const root = T.call('$', 'root'); let h = root.innerHTML; const n = { v: 0 };
    Object.defineProperty(root, 'innerHTML', { get: () => h, set: (v) => { h = v; if (/id="cb"/.test(v)) n.v++; }, configurable: true }); return n; };
  const cases = [
    ['hubLoad (the coaching hub + drafts)', { '/api/portal/hub/coaching': r401, '/api/portal/hub/coaching/drafts': r401 },
      (T) => { const H = T.P.get('HUB'); H.coaching = null; H.drafts = null; }, (T) => T.call('hubLoad', 'coaching')],
    ['helpLoad (the Help Center: list, fails, sync — three 401s at once)', { '/api/portal/help/list': r401, '/api/portal/help/fails': r401, '/api/portal/help/sync-coaching': r401 },
      () => {}, (T) => T.call('helpLoad')],
    ['myHelpLoad (my own help requests)', { '/api/portal/help/mine': r401 }, () => {}, (T) => T.call('myHelpLoad')],
    ['repLoad (Variance — the report that painted "session")', { '/api/portal/tl/reports': r401 },
      (T) => { asTL(T); T.P.set('VIEW', 'variance_team'); }, (T) => T.call('repLoad', 'variance', true)],
    ['helpPulse (the Help Center badge beat)', { '/api/portal/help/pulse': r401 },
      (T) => { asTL(T); T.P.get('HELP_PULSE').busy = false; }, (T) => T.call('helpPulse')],
  ];
  for (const [name, routes, setup, go] of cases) {
    const T = loadPage(routes);
    T.sess.cbx_agent_token = 'tokA'; T.P.set('U', USER_A);
    populate(T); setup(T);
    const paints = countPaints(T);
    go(T); await settle(); await nextTask(T);
    check('R2 · 401 on ' + name + ': back to the sign-in screen ("session expired"), nothing of A left', () => {
      mustText(T.N.root.innerHTML, EXPIRED); nothingLeft(T);
    });
    check('R2 · …and the sign-in screen is painted once, not once per 401 reply', () => { if (paints.v !== 1) throw new Error('painted ' + paints.v + ' times'); });
  }
  {
    /* a caller that already ended the session itself (loadPortal) is not handled twice */
    const T = loadPage({ '/api/portal/overview': r401 });
    T.sess.cbx_agent_token = 'tokA'; T.P.set('U', USER_A); populate(T);
    const paints = countPaints(T);
    T.call('loadPortal'); await settle(); await nextTask(T);
    check('R2 · a caller with its own 401 handling (loadPortal) still lands on one sign-in screen, painted once (control)', () => {
      mustText(T.N.root.innerHTML, EXPIRED); nothingLeft(T); if (paints.v !== 1) throw new Error('painted ' + paints.v + ' times');
    });
    /* the next person is typing; a timer's request (no session now) answers 401 — the screen is not repainted under them */
    T.N.cb.value = 'CB300'; const before = paints.v;
    T.call('api', '/api/portal/overview'); await settle(); await nextTask(T);
    check('R2 · a 401 after the session already ended does not repaint the sign-in screen under the next person\'s typing', () => {
      if (paints.v !== before) throw new Error('repainted ' + (paints.v - before) + ' time(s)'); if (T.N.cb.value !== 'CB300') throw new Error('typing lost');
    });
  }
  {
    /* the sign-in call's own 401 is a wrong password, never "session expired" — and never a loop */
    const T = loadPage({ '/api/login': () => ({ status: 401, body: { error: 'That CB number and password do not match.' } }) });
    T.call('loginScreen'); const paints = countPaints(T);
    T.N.cb.value = 'CB300'; T.N.pw.value = 'wrong-password'; T.N.go.onclick(); await settle(); await nextTask(T);
    check('R2 · a 401 on sign-in shows the wrong-password message and gives the button back — no "session expired", no second sign-in screen', () => {
      const lerr = T.N.lerr; if (!lerr || !/do not match/.test(lerr.textContent)) throw new Error('lerr: ' + (lerr && lerr.textContent));
      if (T.N.go.disabled) throw new Error('the Sign in button stays disabled'); if (paints.v !== 0) throw new Error('repainted ' + paints.v + ' time(s)');
      if (T.calls.filter((c) => c.u === '/api/login').length !== 1) throw new Error('sign-in asked ' + T.calls.filter((c) => c.u === '/api/login').length + ' times');
    });
  }
}

/* ═════════════════════════ A2 · CM reports under a past period ═════════════════════════ */
head('A2 · A campaign manager on a past month or billing month never reads the live Variance / Lead management under it');
{
  const routes = {
    '/api/portal/overview': (u) => {
      const per = new URLSearchParams(u.split('?')[1] || '').get('period') || 'current';
      return { status: 200, body: cmPayload(per === '2026-08' ? PER_AUG : per === 'cycle-2026-09' ? PER_CYC : PER_CUR) };
    },
    '/api/portal/tl/reports': (u) => ({ status: 200, body: u.indexOf('kind=leads') >= 0 ? LIVE_LEADS() : LIVE_VARIANCE() }),
  };
  const T = loadPage(routes);
  const repCalls = () => T.calls.filter((c) => c.u.indexOf('/api/portal/tl/reports') === 0).map((c) => c.u);
  T.sess.cbx_agent_token = 'tokC'; T.P.set('U', { username: 'ryan', role: 'campaign_manager' });
  T.P.set('D', cmPayload(PER_CUR)); T.P.set('VIEW', 'cm'); T.P.set('CMSEL', 'courtesy'); T.call('render');
  /* the live month first: the report loads and is labelled as it always was */
  T.P.set('VIEW', 'cm_variance'); T.call('render'); await settle(); T.call('render');
  check('(regression) on the current month Variance asks the live report and shows it', () => {
    if (repCalls().slice(-1)[0] !== '/api/portal/tl/reports?kind=variance') throw new Error(repCalls().join(' | '));
    mustText(T.N.root.innerHTML, 'Campaign reconciliation'); mustText(T.N.root.innerHTML, '1 – 31 October 2026');
  });
  for (const [key, per] of [['2026-08', PER_AUG], ['cycle-2026-09', PER_CYC]]) {
    T.P.set('VIEW', 'cm'); T.call('render');
    await T.call('cmAsk', key, 'all'); await settle();
    for (const [view, title, figure] of [['cm_variance', 'Campaign reconciliation', 'Material'], ['cm_leads', 'Campaign funnel', 'Open leads']]) {
      const n0 = repCalls().length;
      T.P.set('VIEW', view); T.call('render'); await settle(); T.call('render');
      const h = T.N.root.innerHTML;
      check(per.label + ' · ' + (view === 'cm_leads' ? 'Lead management' : 'Variance') + ': no live figures under the period\'s label', () => {
        clean(h); mustNotText(h, title, 'the live report painted'); mustNotText(h, figure);
      });
      check(per.label + ' · ' + (view === 'cm_leads' ? 'Lead management' : 'Variance') + ': the page says the report covers the live month only', () => {
        mustText(h, 'live month'); mustText(h, per.label);
      });
      check(per.label + ' · ' + (view === 'cm_leads' ? 'Lead management' : 'Variance') + ': no live report is asked for under it', () => {
        if (repCalls().length !== n0) throw new Error('asked: ' + repCalls().slice(n0).join(' | '));
      });
    }
    check(per.label + ' · Export on Variance writes no live sheet under the period\'s name', () => {
      const sheets = [], files = []; let toastMsg = '';
      globalThis.XLSX = { utils: { book_new: () => ({}), aoa_to_sheet: (a) => ({ aoa: a }), book_append_sheet: (wb, ws, nm) => sheets.push(nm) }, writeFile: (wb, f) => files.push(f) };
      try { T.P.set('VIEW', 'cm_variance'); T.call('exportReports', 'cm_variance'); toastMsg = T.N.toast ? T.N.toast.textContent : ''; } finally { delete globalThis.XLSX; }
      if (files.length || sheets.indexOf('Variance') >= 0) throw new Error('wrote ' + JSON.stringify(files) + ' sheets ' + sheets.join(','));
      if (!/live month/i.test(toastMsg)) throw new Error('the toast does not say why: ' + toastMsg);
    });
  }
  await T.call('cmAsk', 'current', 'all'); await settle();
  T.P.set('VIEW', 'cm_variance'); T.call('render'); await settle(); T.call('render');
  check('(regression) back on the current month the live Variance shows again', () => { mustText(T.N.root.innerHTML, 'Campaign reconciliation'); });
}
{
  /* the same report keys under a team leader's "September (final)" (spec 002): the live month's report is all there is */
  const SEPT = tlPayload('Denise Haripersad', [agentRow('CB1', 'Ann Agent', 'Denise Haripersad', 'Courtesy')], { period: { from: '2026-09-01', to: '2026-09-30' } });
  const routes = {
    '/api/portal/overview': (u) => ({ status: 200, body: /month=2026-09/.test(u) ? SEPT : TL_A() }),
    '/api/portal/tl/reports': (u) => ({ status: 200, body: u.indexOf('kind=leads') >= 0 ? LIVE_LEADS() : LIVE_VARIANCE() }),
  };
  const T = loadPage(routes);
  const repCalls = () => T.calls.filter((c) => c.u.indexOf('/api/portal/tl/reports') === 0).length;
  T.sess.cbx_agent_token = 'tokA'; T.P.set('U', USER_A); T.P.set('D', TL_A()); T.P.set('TEAM', T.P.get('D')); T.P.set('VIEW', 'team'); T.call('render');
  await T.call('askMonth', '2026-09'); await settle();
  for (const [view, title] of [['variance_team', 'My team\'s reconciliation'], ['leads_team', 'My team\'s funnel']]) {
    const n0 = repCalls();
    T.P.set('VIEW', view); T.call('render'); await settle(); T.call('render');
    const h = T.N.root.innerHTML;
    check('team leader on "September (final)" · ' + (view === 'leads_team' ? 'Lead management' : 'Variance') + ': says live month only, paints and asks nothing', () => {
      clean(h); mustNotText(h, title); mustText(h, 'live month'); if (repCalls() !== n0) throw new Error('asked the live report');
    });
  }
  await T.call('askMonth', ''); await settle();
  T.P.set('VIEW', 'variance_team'); T.call('render'); await settle(); T.call('render');
  check('(regression) back on the live month the team leader\'s Variance loads and shows', () => { mustText(T.N.root.innerHTML, 'My team\'s reconciliation'); });
}

/* ═════════════════════════ A6 · KPI form dates are the SAST day ═════════════════════════ */
head('A6 · KPI form dates are the SAST day (a browser in UTC, 00:30 SAST on 1 October)');
{
  const NOW = Date.parse('2026-09-30T22:30:00Z');   // 00:30 SAST, Thursday 1 October 2026
  const T = loadPage({}, { now: NOW });
  T.P.set('D', TL_A()); T.P.set('TEAM', T.P.get('D')); T.P.set('U', USER_A);
  T.P.set('HUB', { coaching: { sessions: [] }, drafts: { drafts: [{ id: 'd1', label: 'Formal Coaching', agentName: 'Ann Agent', updatedAt: '2026-09-30T22:45:00Z' }] },
    kpi: { linked: true, titles: ['Monthly KPI Review'], forms: [{ _id: 'k1', title: 'Monthly KPI Review', agentName: 'Ann Agent', status: 'draft', createdAt: '2026-09-30T22:15:00Z', weekLabel: 'Week 1 / 5', month: 'October', year: 2026 }] }, flash: null, busy: false });
  const kh = T.call('kpiHubPage');
  check('the KPI Hub list stamps a form created at 00:15 SAST on 1 October as 2026-10-01', () => { must(kh, '2026-10-01'); if (kh.indexOf('2026-09-30') >= 0) throw new Error('printed the UTC day 2026-09-30'); });
  check('a new KPI form defaults to the SAST month and year (October 2026), not the browser\'s', () => {
    const sel = kh.slice(kh.indexOf('id="hkMonth"')); const opts = sel.slice(0, sel.indexOf('</select>'));
    must(opts, '<option selected>October</option>', 'October is not the selected month'); must(kh, 'id="hkYear" type="number" value="2026"');
  });
  const rows = T.call('allFormsRows');
  check('All forms: the KPI form\'s date is the SAST day', () => { const r = rows.filter((x) => x.src === 'kpi')[0]; if (!r || r.date !== '2026-10-01') throw new Error(JSON.stringify(r && r.date)); });
  check('All forms: a draft with no session date falls back to its SAST save day', () => { const r = rows.filter((x) => x.src === 'draft')[0]; if (!r || r.date !== '2026-10-01') throw new Error(JSON.stringify(r && r.date)); });
  check('a missing or unreadable createdAt prints nothing, never throws', () => {
    T.P.get('HUB').kpi.forms = [{ _id: 'k2', title: 'X', status: 'draft' }, { _id: 'k3', title: 'Y', status: 'draft', createdAt: 'not a date' }];
    const h = T.call('kpiHubPage'); clean(h); T.call('allFormsRows');
  });
}

/* ═════════════════════════ ES5 + escaping in the touched pages ═════════════════════════ */
head('ES5 — what this sweep touched stays plain ES5');
const nonEs5 = (code) => {
  code = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1').replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g, '""');
  const hits = [];
  if (/=>/.test(code)) hits.push('=>'); if (/\b(let|const)\s+[A-Za-z_$]/.test(code)) hits.push('let/const'); if (/`/.test(code)) hits.push('template literal'); if (/\.\.\.[A-Za-z_$[]/.test(code)) hits.push('spread');
  return hits;
};
{
  /* the agent page carries four older `[...new Set()]` spreads; the functions this sweep adds or edits are held to ES5 */
  const html = PAGE;
  const body = (name) => { const i = html.indexOf('function ' + name + '('); if (i < 0) return ''; let d = 0, j = html.indexOf('{', i); const s = j; for (; j < html.length; j++) { if (html[j] === '{') d++; else if (html[j] === '}') { d--; if (!d) break; } } return html.slice(s, j + 1); };
  const touched = ['api', 'resetClientState', 'clearOverlays', 'signOut', 'sessionExpired', 'loginScreen', 'repBlank', 'repLiveOnly', 'repLiveOnlyCard', 'repSync', 'repStamp', 'repLoad',
    'pageCmReport', 'pageVarianceTeam', 'pageLeadsTeam', 'exportReports', 'formBlank', 'kpiClose', 'sastDay', 'kpiHubPage', 'allFormsRows'];
  check('agent/index.html: ' + touched.length + ' touched functions use no arrow functions, let/const, template literals or spread', () => {
    const bad2 = []; for (const n of touched) { const b = body(n); if (!b) bad2.push(n + ' (not found)'); else if (nonEs5(b).length) bad2.push(n + ': ' + nonEs5(b).join(',')); }
    if (bad2.length) throw new Error(bad2.join(' · '));
  });
  const vm = await import('node:vm');
  check('agent/index.html: the inline script still parses', () => { new vm.Script(html.match(/<script>\n"use strict";([\s\S]*?)<\/script>/)[1]); });
}
{
  const html = fs.readFileSync(WIMPY_PAGE, 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((x) => x[1]).join('\n');
  check('wimpy/index.html: the whole script uses no arrow functions, let/const, template literals or spread', () => { const h = nonEs5(scripts); if (h.length) throw new Error(h.join(', ')); });
}

/* ═════════════════════════ Wimpy (A3 · A4 · A5) — a real Chromium ═════════════════════════ */
head('A3 · A4 · A5 — Wimpy, in a real browser against a stubbed Worker');
{
  const W = pathToFileURL(path.resolve(ROOT, 'worker', 'src', 'wimpy.mjs')).href;
  const { wimpyMenu } = await import(W);
  const { chromium } = await import(pathToFileURL(path.join(HERE, 'node_modules', 'playwright', 'index.mjs')).href);
  const pageSrc = fs.readFileSync(WIMPY_PAGE, 'utf8');
  const srv = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html' }); r.end(pageSrc); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));   // any free port: other suites may hold the fixed ones
  const port = srv.address().port;
  /* SAST wall-clock → UTC ms. Wednesday 2 September 2026 → Thursday 3 September 2026. */
  const sast = (iso) => Date.parse(iso + '+02:00');
  const WED_OPEN = sast('2026-09-02T10:00:00'), WED_SHUT = sast('2026-09-02T17:00:05'), THU_OPEN = sast('2026-09-03T08:00:05');
  const PEOPLE = {
    'ann-pass-1': { token: 'tokAnn', user: { username: 'cb999', full_name: 'Ann Smith', cb: 'CB999', scope: 'wimpy' } },
    'bob-pass-1': { token: 'tokBob', user: { username: 'cb111', full_name: 'Bob Jones', cb: 'CB111', scope: 'wimpy' } },
  };
  const b = await chromium.launch();
  let menuAt = WED_OPEN;   // which instant the stub's menu is built for — the Worker decides the window, never the page
  let menuN = 0;
  const menuCalls = () => menuN;
  const errs = [];
  async function fresh() {
    const pg = await b.newPage();
    pg.on('pageerror', (e) => errs.push(String(e)));
    await pg.clock.install({ time: WED_OPEN });
    await pg.route('**/chatterbox-agentos-api.chatterbox-agentos.workers.dev/**', async (route) => {
      const u = route.request().url(), auth = route.request().headers().authorization || '';
      const J = (o, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) });
      if (u.includes('/api/wimpy/signin')) { const p = PEOPLE[(JSON.parse(route.request().postData() || '{}')).password]; return p ? J(p) : J({ error: 'That CB number and password do not match.' }, 401); }
      if (u.endsWith('/api/me')) { const p = Object.values(PEOPLE).filter((x) => 'Bearer ' + x.token === auth)[0]; return p ? J({ user: p.user }) : J({ error: 'no session' }, 401); }
      if (u.includes('/api/wimpy/menu')) { menuN++; return J(wimpyMenu(menuAt)); }
      if (u.includes('/api/wimpy/order')) return J({ ok: true, total_price: 54.9, order_formatted: 'WIMPY ORDER' });
      return J({ ok: true });
    });
    await pg.goto('http://127.0.0.1:' + port + '/', { waitUntil: 'domcontentloaded' });
    await pg.waitForSelector('#cb', { timeout: 20000 });
    return pg;
  }
  async function signIn(pg, cb, pw) {
    await pg.fill('#cb', cb); await pg.fill('#pw', pw); await pg.click('#go');
    await pg.waitForSelector('.wp-grid', { timeout: 20000 });
  }
  /* the page's own 30-second check, run on the page's clock: one beat to learn the state, one after the jump to flip */
  async function flipTo(pg, at) {
    await pg.clock.runFor(30000);
    menuAt = at; await pg.clock.setSystemTime(at); await pg.clock.runFor(30000);
    await pg.waitForTimeout(400);
  }
  const formVals = (pg) => pg.evaluate(() => ['fcb', 'ffn', 'fln', 'fph', 'fnt'].map((id) => (document.getElementById(id) || {}).value));
  try {
    /* A3 — yesterday's Big One in the cart after the day flips */
    {
      menuAt = WED_OPEN;
      const pg = await fresh();
      await signIn(pg, 'CB999', 'ann-pass-1');
      const big = wimpyMenu(WED_OPEN).bigOne;
      await pg.click('[data-wadd="' + big.id + '"]'); await pg.click('[data-wcat="burgers"]'); await pg.click('[data-wadd="cheese_burger"]');
      await pg.waitForSelector('#wpReview');
      await flipTo(pg, WED_SHUT); await flipTo(pg, THU_OPEN);
      await pg.waitForSelector('#wpReview', { timeout: 10000 });
      const cart = await pg.evaluate(() => (document.querySelector('#wpPull') || {}).textContent || '');   // the count lives on the pull bar (hidden on a wide screen, so textContent)
      const page = await pg.evaluate(() => document.body.innerText);
      check('A3 (setup) the window flipped twice and Thursday\'s menu no longer carries Wednesday\'s ' + big.name, () => {
        if (wimpyMenu(THU_OPEN).items.some((i) => i.id === big.id)) throw new Error('fixture: still on the menu');
        if (!/Ordering is open/.test(page)) throw new Error('the reopened menu is not on screen: ' + page.slice(0, 200));
      });
      check('A3 the cart no longer holds the line nobody can see: it counts 1 item, not 2', () => { if (!/· 1 item(?!s)/.test(cart)) throw new Error(cart.replace(/\s+/g, ' ')); });
      check('A3 the page says ' + big.name + ' left the menu and was taken out of the order', () => {
        if (page.indexOf(big.name) < 0 || !/no longer on the menu/i.test(page)) throw new Error(page.replace(/\s+/g, ' ').slice(0, 400));
      });
      await pg.click('#wpReview'); await pg.waitForSelector('#fcb');
      await pg.fill('#fph', '082 123 4567'); await pg.click('#of button[type=submit]');
      await pg.waitForTimeout(400);
      const err = await pg.evaluate(() => (document.querySelector('.msg.bad') || {}).innerText || '');
      const confirmed = !!(await pg.$('#wpSend'));
      check('A3 the order is no longer blocked: no "remove it and add it again" refusal for a line nobody can remove', () => {
        if (/no longer on the menu/i.test(err)) throw new Error(err);
      });
      check('A3 …the remaining line goes on to the confirm step (#wpSend)', () => { if (!confirmed) throw new Error('still on the form: ' + err); });
      await pg.close();
    }
    /* A3 · R1 — EVERY cart line leaves the menu while the person is on the confirm (or the form) step */
    for (const step of ['confirm', 'form']) {
      menuAt = WED_OPEN;
      const pg = await fresh();
      await signIn(pg, 'CB999', 'ann-pass-1');
      const big = wimpyMenu(WED_OPEN).bigOne;
      await pg.click('[data-wadd="' + big.id + '"]'); await pg.waitForSelector('#wpReview');
      await pg.click('#wpReview'); await pg.waitForSelector('#fcb'); await pg.fill('#fph', '082 123 4567');
      if (step === 'confirm') { await pg.click('#of button[type=submit]'); await pg.waitForSelector('#wpSend'); }
      await flipTo(pg, WED_SHUT); await flipTo(pg, THU_OPEN);
      const st = await pg.evaluate(() => ({ send: !!document.getElementById('wpSend'), form: !!document.getElementById('of'), grid: !!document.querySelector('.wp-grid'), text: document.body.innerText }));
      check('A3·R1 on the ' + step + ' step, a cart the menu change emptied goes back to the order screen', () => {
        if (!st.grid || st.form || st.send) throw new Error('still on the ' + (st.send ? 'confirm' : st.form ? 'form' : '?') + ' step: ' + st.text.replace(/\s+/g, ' ').slice(0, 240));
      });
      check('A3·R1 …says ' + big.name + ' left the menu, and offers no "Confirm & send" of an empty R0.00 order', () => {
        if (st.text.indexOf(big.name) < 0 || !/no longer on the menu/i.test(st.text)) throw new Error(st.text.replace(/\s+/g, ' ').slice(0, 300));
        if (/Confirm & send/i.test(st.text) || /Total\s*R0\.00/.test(st.text)) throw new Error('an empty order is offered for sending');
      });
      if (step === 'form' && st.grid) {                  // only from the order screen (else the checks above already failed)
        await pg.click('[data-wcat="burgers"]'); await pg.click('[data-wadd="cheese_burger"]'); await pg.click('#wpReview'); await pg.waitForSelector('#fcb');
        const ph = await pg.evaluate(() => document.getElementById('fph').value);
        check('A3·R1 …and what was typed on the form is still there when the person comes back to it', () => { if (ph !== '082 123 4567') throw new Error(JSON.stringify(ph)); });
      }
      await pg.close();
    }
    /* A5 — the window flips while the person is typing the order form */
    {
      menuAt = WED_OPEN; menuN = 0;
      const pg = await fresh();
      await signIn(pg, 'CB999', 'ann-pass-1');
      await pg.click('[data-wcat="burgers"]'); await pg.click('[data-wadd="cheese_burger"]'); await pg.click('#wpReview'); await pg.waitForSelector('#fcb');
      await pg.fill('#ffn', 'Annie'); await pg.fill('#fph', '082 555 1234'); await pg.fill('#fnt', 'collect at reception');
      await pg.focus('#fnt');
      await flipTo(pg, WED_SHUT);
      const v = await formVals(pg);
      const page = await pg.evaluate(() => document.body.innerText);
      check('A5 (setup) the 17:00 flip re-asked for the menu (' + menuCalls() + ' menu requests) and the form is still the page', () => {
        if (menuCalls() < 2) throw new Error('the flip never re-asked'); if (v[0] == null) throw new Error('the form is gone: ' + page.slice(0, 200));
      });
      check('A5 the form still holds what was typed (name, phone, notes) after the flip re-render', () => {
        if (v[1] !== 'Annie' || v[3] !== '082 555 1234' || v[4] !== 'collect at reception') throw new Error(JSON.stringify(v));
      });
      const focused = await pg.evaluate(() => (document.activeElement || {}).id || '');
      check('A5 …and the cursor is still in the field being typed in (#fnt)', () => { if (focused !== 'fnt') throw new Error('focus on ' + JSON.stringify(focused)); });
      await pg.close();
    }
    /* A4 — Ann signs out, Bob signs in on the same tab */
    {
      menuAt = WED_OPEN;
      const pg = await fresh();
      await signIn(pg, 'CB999', 'ann-pass-1');
      await pg.click('[data-wcat="burgers"]'); await pg.click('[data-wadd="cheese_burger"]'); await pg.click('#wpReview'); await pg.waitForSelector('#fcb');
      await pg.fill('#fph', '082 555 1234'); await pg.fill('#fnt', 'Ann collects at reception'); await pg.click('#of button[type=submit]');
      await pg.waitForSelector('#wpSend'); await pg.click('#wpSend'); await pg.waitForSelector('.wp-ok');
      await pg.click('#out'); await pg.waitForSelector('#cb');
      const signedOut = await pg.evaluate(() => document.body.innerText);
      await signIn(pg, 'CB111', 'bob-pass-1');
      await pg.click('[data-wcat="burgers"]'); await pg.click('[data-wadd="cheese_burger"]'); await pg.click('#wpReview'); await pg.waitForSelector('#fcb');
      const v = await formVals(pg);
      check('A4 sign-out says so ("Signed out")', () => { if (!/Signed out/.test(signedOut)) throw new Error(signedOut.slice(0, 200)); });
      check('A4 the next person\'s form carries THEIR CB number, name and surname — not Ann\'s', () => { if (v[0] !== 'CB111' || v[1] !== 'Bob' || v[2] !== 'Jones') throw new Error(JSON.stringify(v)); });
      check('A4 …and none of Ann\'s phone number or kitchen notes', () => { if (v[3] !== '' || v[4] !== '') throw new Error(JSON.stringify(v)); });
      const left = await pg.evaluate(() => JSON.stringify({ done: typeof WDONE === 'undefined' ? null : WDONE }));
      check('A4 …and Ann\'s order slip is gone from memory', () => { if (/Ann|WIMPY ORDER/.test(left)) throw new Error(left); });
      await pg.close();
    }
    check('Wimpy: the page ran with no errors', () => { if (errs.length) throw new Error(errs[0]); });
  } catch (e) {
    bad('the Wimpy flow ran to its end', e.message);
  } finally { await b.close(); srv.close(); }
}

console.log('\n' + (checks - fails) + '/' + checks + ' checks passed' + (fails ? ' — ' + fails + ' FAILED' : ''));
process.exitCode = fails ? 1 : 0;
