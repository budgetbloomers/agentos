#!/usr/bin/env node
/**
 * verify-tl-hub.mjs — spec 035-tl-coaching-hub-locked (2026-10-15).
 *
 *   node nicks_code/diagnostics/verify-tl-hub.mjs
 *
 * WHY: Nick, 2026-10-15 — "change the team leader view to this only, where they see their forms; once they click submit
 * they cannot edit; once they click save they can go back and edit". The team leader's Coaching Hub tab is the embedded
 * Hub (the spec-033 frame) pinned to the leader's OWN workspace; the lock lives in the Hub's data. What can fail quietly
 * here: the Worker not sending the leader's Hub id, the page sending the wrong one (or none) in the frame's address, the
 * native forms coming back on the tab, or the Hub losing its leader mode / submit rule. Pure: files + a stubbed DOM.
 *
 *   A  Worker     the team overview carries hubId — from the SESSION, team scope only
 *   B  page       static: the address per role, one frame outside #root, dropped on sign-out, native page unrouted
 *   C  page       rendered: linked leader → host + &leader=<id>; unlinked → words, no frame; manager → leader= empty
 *   D  archive    a Worker draft is no longer opened from "All forms"
 *   E  the Hub    leader mode + submit lock sources present in the clone and its own tests green (skipped if absent)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const rd = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const PAGE = rd('agent', 'index.html');
const PORTAL = rd('worker', 'src', 'portal.mjs');
const HUBS = rd('worker', 'src', 'hubs.mjs');

let pass = 0, fail = 0;
const ok = (name, cond, note) => { if (cond) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (note !== undefined ? ' — ' + note : '')); } };
const head = (t) => console.log('\n' + t);
const text = (h) => String(h).replace(/<[^>]*>/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const HUB_URL = 'https://coaching-hub-psi.vercel.app/';

try {
  /* =================================================================== A */
  head('A · Worker: the team overview carries the leader\'s Coaching Hub id, from the session');
  const hubLine = PORTAL.match(/^\s*hubId: (.+)$/m);
  ok('portal.mjs team body has a hubId line', !!hubLine, 'no hubId: in portal.mjs');
  if (hubLine) {
    ok('…read from the SESSION (user.hub_ids.coaching), team scope only', /auth\.scope === 'team'/.test(hubLine[1]) && /user\.hub_ids\.coaching/.test(hubLine[1]), hubLine[1]);
    ok('…never from the request', !/req\b|url\.|searchParams|query/.test(hubLine[1]), hubLine[1]);
    ok("…'' when unlinked (the page says so in words)", /: ''/.test(hubLine[1]));
  }
  ok('hubs.coachingCreate takes opts.asDraft → submitted:false (the migration tool), nothing else sets it',
    /export async function coachingCreate\(ids, user, body, opts\)/.test(HUBS) && /if \(opts && opts\.asDraft === true\) args\.submitted = false;/.test(HUBS)
    && (HUBS.match(/args\.submitted/g) || []).length === 1);
  ok('the Worker\'s own routes never pass asDraft', !/asDraft/.test(rd('worker', 'src', 'index.mjs')) && !/asDraft/.test(rd('worker', 'src', 'drafts.mjs')));

  /* =================================================================== B */
  head('B · page, static: the frame\'s address per role; one frame; the native page is off the tab');
  ok('hubTabUrl() = HUB_APP_URL + ?theme=agentos&leader=<encoded id>', /function hubTabUrl\(\)\{[\s\S]{0,400}?'\?theme=agentos&leader='\+encodeURIComponent\(leader\)/.test(PAGE));
  ok('…the id comes from D.hubId on a TEAM scope only', /var leader=\(D&&D\.scope==='team'&&D\.hubId\)\?String\(D\.hubId\):'';/.test(PAGE));
  ok('the frame\'s src is assigned from hubTabUrl() and nowhere else', (PAGE.match(/\.src=hubTabUrl\(\)/g) || []).length === 2 && !/\.src=HUB_TAB_URL/.test(PAGE) && !/var HUB_TAB_URL=/.test(PAGE));
  ok('one frame outside #root (document.body.appendChild), dropped on sign-out (cmHubDrop in resetClientState)',
    /document\.body\.appendChild\(el\)/.test(PAGE) && /function resetClientState\(\)\{[\s\S]{0,600}?cmHubDrop\(\);/.test(PAGE));
  const sandbox = /setAttribute\('sandbox','([^']*)'\)/.exec(PAGE);
  ok('the sandbox still has no allow-top-navigation', !!sandbox && /allow-scripts/.test(sandbox[1]) && !/allow-top-navigation/.test(sandbox[1]), sandbox && sandbox[1]);
  ok('render() hides the frame off BOTH hub views (isHubView), never over the password form', /if\(!isHubView\(\)\|\|PW_OPEN\) cmHubHide\(\);/.test(PAGE));
  ok('coach_team renders tlHubBody(), not the native forms', /VIEW==='coach_team' \? tlHubBody\(\)/.test(PAGE) && !/VIEW==='coach_team' \? \(CFORM\.type\?coachFormPage\(\):coachHubPage\(\)\)/.test(PAGE));
  ok('coach_team no longer loads the Worker drafts or the native sessions list', !/if\(VIEW==='coach_team'\)\{ if\(!HUB\.drafts\) draftsLoad\(\)/.test(PAGE) && /if\(VIEW==='coach_team'&&tlHubLinked\(\)\)\{ cmHubEnsure\(\); cmHubSync\(\);/.test(PAGE));
  ok('the manager\'s tab is unchanged: cm_hub still the coaching entry, cmHubBody still the host + Retry', /\['cm_hub','Coaching Hub',ICON\.coaching\]/.test(PAGE) && /id="cmHubHost"/.test(PAGE) && /id="cmHubRetry"/.test(PAGE));

  /* =================================================================== C / D (rendered) */
  head('C · D · page, rendered in a stubbed DOM');
  {
    const m = PAGE.match(/<script>\n"use strict";([\s\S]*?)<\/script>/);
    if (!m) throw new Error('could not find the page script');
    const src = m[1].replace(/\nboot\(\);\s*$/, '\n');
    const nodes = {}, sel = {}, body = [];
    const mkEl = () => ({ innerHTML: '', value: '', textContent: '', className: '', style: {}, classList: { add() {}, remove() {}, contains: () => false },
      addEventListener() {}, setAttribute() {}, getAttribute: () => null, querySelectorAll: () => [], querySelector: () => null, focus() {}, onclick: null, onchange: null,
      remove() { const i = body.indexOf(this); if (i >= 0) body.splice(i, 1); }, appendChild() {}, getBoundingClientRect: () => ({ top: 10, left: 20, width: 800, height: 600 }) });
    const doc = { getElementById: (id) => (nodes[id] = nodes[id] || mkEl()), querySelectorAll: (s) => sel[s] || [], createElement: () => mkEl(),
      body: { ...mkEl(), appendChild: (el) => body.push(el), classList: { add() {}, remove() {} } }, addEventListener() {}, removeEventListener() {} };
    const win = { location: { search: '' }, scrollTo() {}, addEventListener() {}, removeEventListener() {}, confirm: () => true, innerHeight: 900,
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} } };
    const session = { getItem: () => 'tok', setItem() {}, removeItem() {} };
    const fetchImpl = () => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ error: 'no route' }) });
    const names = ['hubTabUrl', 'tlHubLinked', 'isHubView', 'tlHubBody', 'cmHubBody', 'cmHubEnsure', 'cmHubDrop', 'cmHubHide', 'allFormsPage', 'HUB_APP_URL'];
    const fn = new Function('document', 'window', 'localStorage', 'sessionStorage', 'location', 'fetch', 'URLSearchParams', 'setTimeout', 'setInterval', 'clearInterval', 'Intl', 'console',
      src + '\nvar __o={};' + JSON.stringify(names) + '.forEach(function(n){ try{ __o[n]=eval(n); }catch(e){ __o[n]=undefined; } });'
      + 'render=function(){};'
      + '__o.setD=function(d){D=d}; __o.setView=function(v){VIEW=v}; __o.getView=function(){return VIEW}; __o.setHub=function(h){ for(var k in h) HUB[k]=h[k]; }; __o.frame=function(){ return CMHUB.el; };'
      + 'return __o;');
    const P = fn(doc, win, win.localStorage, session, win.location, fetchImpl, URLSearchParams, () => 0, () => 0, () => {}, Intl, { log() {}, error() {}, warn() {} });
    const missing = names.filter((n) => P[n] === undefined);
    ok('the page defines ' + names.join(', '), missing.length === 0, 'missing ' + missing.join(', '));
    ok('HUB_APP_URL is the one framed origin', P.HUB_APP_URL === HUB_URL, P.HUB_APP_URL);

    /* a linked leader */
    P.setD({ scope: 'team', hubId: 'L1xyz', name: 'Denise Haripersad' }); P.setView('coach_team');
    ok('linked leader: hubTabUrl() pins the Hub to their workspace', P.hubTabUrl() === HUB_URL + '?theme=agentos&leader=L1xyz', P.hubTabUrl());
    ok('…tlHubLinked() and isHubView() are true on coach_team', P.tlHubLinked() === true && P.isHubView() === true);
    const linked = P.tlHubBody();
    ok('…the tab draws the frame host, no native Record / Drafts / sessions markup', linked.includes('id="cmHubHost"') && !linked.includes('data-coach-new') && !/Record a session|Drafts|Your sessions/.test(text(linked)), text(linked).slice(0, 200));
    ok('…and no link out to the Hub (the frame IS the Hub)', !/href="https:\/\/coaching-hub-psi/.test(linked));
    P.cmHubEnsure(); P.cmHubEnsure();
    ok('cmHubEnsure() appends ONE frame to body, src = hubTabUrl()', body.length === 1 && body[0].src === HUB_URL + '?theme=agentos&leader=L1xyz', JSON.stringify({ n: body.length, src: body[0] && body[0].src }));
    P.setD({ scope: 'team', hubId: 'a b&c' });
    ok('an id is URL-encoded, never spliced raw', P.hubTabUrl().endsWith('&leader=a%20b%26c'), P.hubTabUrl());
    P.cmHubDrop();
    ok('cmHubDrop() removes the frame', body.length === 0 && P.frame() === null, body.length);

    /* an unlinked leader */
    P.setD({ scope: 'team', hubId: '', name: 'Charlotte Govender' }); P.setView('coach_team');
    const un = P.tlHubBody();
    ok('unlinked leader: words, no frame host, no link', /not linked to the Coaching Hub yet/.test(text(un)) && !un.includes('id="cmHubHost"') && !/href=/.test(un), text(un).slice(0, 200));
    ok('…isHubView() is false, so render() keeps the frame hidden', P.isHubView() === false && P.tlHubLinked() === false);
    ok('…hubTabUrl() would carry leader= EMPTY (never another leader\'s id)', P.hubTabUrl() === HUB_URL + '?theme=agentos&leader=');

    /* the campaign manager */
    P.setD({ scope: 'campaign', campaigns: ['courtesy'] }); P.setView('cm_hub');
    ok('manager: hubTabUrl() is the whole Hub with leader= EMPTY (clears a leader mode left in the tab\'s session storage)', P.hubTabUrl() === HUB_URL + '?theme=agentos&leader=', P.hubTabUrl());
    ok('…isHubView() true on cm_hub, false on coach_team', P.isHubView() === true && (P.setView('coach_team'), P.isHubView() === false));
    P.setD({ scope: 'campaign', hubId: 'SHOULD_BE_IGNORED' });
    ok('…a hubId on a non-team payload is ignored', P.hubTabUrl().endsWith('&leader='), P.hubTabUrl());
    P.setD({ scope: 'all', staff: true, hubId: 'X' }); P.setView('coach_team');
    ok('staff preview (scope all): no frame either', P.tlHubLinked() === false && P.isHubView() === false);

    /* D · the archive */
    P.setD({ scope: 'team', hubId: 'L1xyz' });
    P.setHub({ coaching: { linked: true, byType: {}, sessions: [] }, kpi: { linked: true, forms: [] },
      drafts: { drafts: [{ id: 'd1', type: 'formalCoachingCalls', label: 'Formal Coaching', state: 'draft', agentName: 'Bea Buyer', employeeNumber: 'CB2', updatedAt: '2026-10-05T08:30:00Z', sigs: [] }], max: 50 } });
    const all = P.allFormsPage();
    ok('"All forms": a Worker draft is listed as DRAFT, says it is moving to the Coaching Hub tab, and has no Open', /DRAFT/.test(text(all)) && /Moving to your Coaching Hub tab/.test(text(all)) && !all.includes('data-draft-open'), text(all).slice(0, 300));
  }

  /* =================================================================== E */
  head('E · the Hub clone: leader mode + the submit lock, and its own tests');
  const HUB_DIR = process.env.COACHING_HUB_DIR || 'C:/Users/aarav/repos/coaching-hub';
  if (!fs.existsSync(path.join(HUB_DIR, 'package.json'))) {
    console.log('  skip the Hub clone is not on this machine (' + HUB_DIR + ') — set COACHING_HUB_DIR');
  } else {
    const h = (...p) => fs.readFileSync(path.join(HUB_DIR, ...p), 'utf8');
    const schema = h('convex', 'schema.ts');
    ok('schema: submitted/submittedAt (optional) on the six coaching tables and none of the KPI tables', (schema.match(/\.\.\.submitState,/g) || []).length === 6 && /submitted: v\.optional\(v\.boolean\(\)\)/.test(schema));
    const tables = ['informalCoaching', 'formalCoachingCalls', 'groupCoaching', 'qualityCoaching', 'qualityAssuranceCoaching', 'leadManagementCoaching'];
    const guarded = tables.filter((t) => { const s = h('convex', t + '.ts'); return /assertLeaderMayWrite\(doc, leaderMode\)/.test(s) && /assertLeaderMayWrite\(doc, args\.leaderMode\)/.test(s) && /export const submit = mutation/.test(s) && /submitted: v\.optional\(v\.boolean\(\)\)/.test(s); });
    ok('every product module: update/remove refuse a submitted document in leader mode; create takes submitted; submit exists', guarded.length === 6, 'guarded: ' + guarded.join(','));
    const mode = h('src', 'lib', 'mode.ts');
    ok('src/lib/mode.ts: readLeaderMode, leaderRedirect, isLeaderMode, submitConfirmText', /export function readLeaderMode/.test(mode) && /export function leaderRedirect/.test(mode) && /isLeaderMode/.test(mode) && /submitConfirmText/.test(mode));
    ok('App.tsx gates every route through leaderRedirect', /LeaderGate/.test(h('src', 'App.tsx')) && /leaderRedirect\(pathname, leaderId\(\)\)/.test(h('src', 'App.tsx')));
    ok('Sidebar: no back-to-home in leader mode', /\{!isLeaderMode\(\) && \(/.test(h('src', 'components', 'Sidebar.tsx')));
    const list = h('src', 'components', 'SessionList.tsx');
    ok('SessionList: a submitted document is view-only in leader mode (no Edit / Delete, still opens); a draft opens its form', /const locked = isLeaderMode\(\) && isSubmitted\(session\)/.test(list) && (list.match(/\{!locked && <button/g) || []).length === 2 && /isLeaderMode\(\) && draft \? editUrl : viewUrl/.test(list));
    ok('no Lead Management Coaching in a leader\'s workspace: hidden from the sidebar and the dashboard, routes land on the dashboard', /isHiddenInLeaderMode/.test(h('src', 'components', 'Sidebar.tsx')) && /isHiddenInLeaderMode/.test(h('src', 'pages', 'Dashboard.tsx')) && /HIDDEN_IN_LEADER_MODE = \["lead-management"\]/.test(mode) && /isHiddenInLeaderMode\(m\[2\]/.test(mode));
    const forms = ['FormalCoachingForm', 'InformalCoachingForm', 'GroupCoachingForm', 'QualityAssuranceForm', 'QualityCoachingForm', 'LeadManagementForm'];
    const flowed = forms.filter((f) => { const s = h('src', 'forms', f + '.tsx'); return /useDraftFlow\(/.test(s) && /onSubmit=\{flow\.leaderMode \? \(\) => handleSave\(true\) : undefined\}/.test(s) && /isLeaderMode\(\) && isSubmitted\(existing \?\? null\)/.test(s); });
    ok('every form: Save draft / Submit through useDraftFlow and a submitted document redirects away in leader mode', flowed.length === 6, 'flowed: ' + flowed.join(','));
    const lists = ['FormalCoachingList', 'InformalCoachingList', 'GroupCoachingList', 'QualityAssuranceList', 'QualityCoachingList', 'LeadManagementList'];
    const passing = lists.filter((l) => /leaderMode: isLeaderMode\(\) \|\| undefined/.test(h('src', 'pages', 'sessions', l + '.tsx')));
    ok('every list page passes leaderMode to remove (the server refuses a submitted document even off a stale list)', passing.length === 6, 'passing: ' + passing.join(','));
    ok('a cleared signature is an explicit removal in every product module (withClearedSignatures), and the forms send "" in leader mode',
      tables.every((t) => (h('convex', t + '.ts').match(/withClearedSignatures\(fields\)/g) || []).length === 2) && /const sig = \(v: string \| undefined\)/.test(h('src', 'lib', 'useDraftFlow.ts'))
      && ['FormalCoachingForm', 'InformalCoachingForm', 'QualityAssuranceForm', 'LeadManagementForm'].every((f) => /flow\.sig\(/.test(h('src', 'forms', f + '.tsx'))));
    const views = ['FormalCoachingView', 'InformalCoachingView', 'GroupCoachingView', 'QualityAssuranceView', 'QualityCoachingView', 'LeadManagementView'];
    const viewOnly = views.filter((v) => { const s = h('src', 'views', v + '.tsx'); return /const editable = !\(isLeaderMode\(\) && isSubmitted\(session/.test(s) && /editUrl=\{editable \?/.test(s) && !/<Navigate/.test(s); });
    ok('every view: a submitted document opens in leader mode with no Edit (view-only, Nick 2026-10-15)', viewOnly.length === 6, 'viewOnly: ' + viewOnly.join(','));
    const t = spawnSync(process.execPath, ['--test', 'tests/**/*.test.mjs'], { cwd: HUB_DIR, encoding: 'utf8', shell: false });
    const passed = /# pass (\d+)/.exec(t.stdout + t.stderr) || /pass (\d+)/.exec(t.stdout + t.stderr);
    ok('the Hub\'s own tests are green (node --test)', t.status === 0 && passed && +passed[1] >= 10, (t.stdout + t.stderr).slice(-300));
  }
} catch (e) {
  fail++; console.log('  FAIL the suite threw: ' + (e && e.stack || e));
}

console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
process.exit(fail ? 1 : 0);
