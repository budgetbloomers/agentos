#!/usr/bin/env node
/**
 * verify-campaign-split.mjs — an agent who changed campaign mid-month is reported per campaign, by
 * effective date, and never blended.
 *
 *   node nicks_code/diagnostics/verify-campaign-split.mjs
 *
 * POC feedback, 2026-09-29 ("2. Campaign Attribution"): "If an agent worked Download/Upsell for part
 * of the month and another campaign thereafter, AgentOS must not blend those results together
 * without clearly showing the campaign split. We should still have an overall view, but
 * campaign-level performance must be available."
 *
 * The Agent List wins its whole month (non-negotiable 11) — a snapshot cannot say WHEN someone moved —
 * so the September list's "Courtesy" used to claim the agent's Download & Test week too. An
 * effective-dated campaign assignment (CB | Campaign | Effective From | Effective To) now decides the
 * day's campaign on its own dates.
 *
 * A · the assignment sheet is detected, read and stored; a correction replaces, a removal is a
 *     tombstone that survives a merge with an older copy.
 * B · the engine: each day lands in its own campaign, both campaigns are reported, the agent's
 *     current campaign is the latest one, the rating window stays inside one campaign.
 * C · the digest: the top-level row is the CURRENT campaign's figures (not a blend), byCampaign
 *     carries each campaign with its dates and plan, overall is the whole period; an agent on one
 *     campaign carries neither.
 * D · without the assignment the same agent is one Courtesy row for the whole month — the blend
 *     this fixes — and removing the assignment restores exactly that.
 */
import fs from 'node:fs'; import path from 'node:path'; import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const { chromium } = await import(pathToFileURL(path.join(HERE, 'node_modules', 'playwright', 'index.mjs')).href);
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (d ? ' — ' + d : '')); } };

const PULSE = path.join(ROOT, 'nicks_code', 'index.html');
const SERVE = { '/pulse.html': PULSE, '/xlsx.full.min.js': path.join(ROOT, 'site', 'xlsx.full.min.js') };
const server = http.createServer((q, s) => { const p = SERVE[q.url.split('?')[0]];
  if (!p || !fs.existsSync(p)) { s.writeHead(404); s.end(); return; }
  s.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' }); fs.createReadStream(p).pipe(s); });
await new Promise((r) => server.listen(8294, '127.0.0.1', r));
const b = await chromium.launch();
try {
  const page = await b.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
  await page.goto('http://127.0.0.1:8294/pulse.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__mtd && window.__mtd.state(), null, { timeout: 30000 });

  const SHEET = 'CB,Campaign,Effective From,Effective To\nCB901,Download & Test,2026-09-01,2026-09-07\nCB901,Courtesy,2026-09-08,\nCB999,,2026-09-01,\n';
  const out = await page.evaluate(async ([sheet]) => {
    const msgs = []; window.toast = function (m) { msgs.push(String(m)); };
    const S = window.__mtd.state();
    S.roster = ['CB901', 'CB902', 'CB903'].map((code, i) => ({ code, name: 'Test Agent ' + (i + 1), sf: 'Test Agent ' + (i + 1), tl: 'Leader Alpha',
      campaign: i === 2 ? 'Cuddle' : 'Courtesy', tenure: 'Exp', callx: '', target: 0, start: '2026-01-01' }));
    S.att = {}; S.calls = {}; S.sales = {}; S.tracker = {}; S.orgHist = {}; S.vici = {}; S.cancRows = {}; S.files = []; S.viciDays = {}; S.campAssign = {};
    const DAYS = []; for (let d = 1; d <= 18; d++) { const w = new Date(Date.UTC(2026, 8, d)).getUTCDay(); if (w > 0 && w < 6) DAYS.push('2026-09-' + String(d).padStart(2, '0')); }
    for (const d of DAYS) { S.att[d] = {}; S.calls[d] = {}; S.sales[d] = {};
      for (const a of S.roster) { S.att[d][a.code] = 'P'; S.calls[d][a.code] = { talk: 3600, calls: 30, ans: 15, opt: 0, saleD: 0, v: 1 };
        /* CB901 sells 2 x R40 a day on Download & Test (1-7 Sep) and 3 x R89 a day on Courtesy after */
        const dt = a.code === 'CB901' && d <= '2026-09-07';
        const n = dt ? 2 : 3, unit = dt ? 40 : 89;
        S.sales[d][a.code] = { n, gwp: n * unit, gwpEx: Math.round(n * unit / 1.15 * 100) / 100, x: Math.round(n * unit / 1.15 * 100) / 100 }; } }
    const snap = () => { window.__mtd.rebuild(); window.__mtd.setPeriod('2026-09', 'month'); const m = window.__mtd.model();
      const facts = (m.facts || []).filter((f) => f.code === 'CB901');
      const byCamp = {}; for (const f of facts) (byCamp[f.campaign] = byCamp[f.campaign] || []).push(f.date);
      const dg = agentDigestPayload(); const row = (c) => (dg.agents || []).find((x) => x.code === c) || null;
      const r1 = row('CB901'), r2 = row('CB902');
      return { camps: CAMPS.slice(), byCamp, cur: m.curCamp && m.curCamp.CB901, window: compositeWindow('CB901').map((f) => f.campaign),
        dt: (m.mtdCC['Download & Test'] || {}).CB901 ? { emp: m.mtdCC['Download & Test'].CB901.emp, sales: m.mtdCC['Download & Test'].CB901.sales } : null,
        r1: r1 && { campaign: r1.campaign, plan: r1.plan, emp: r1.emp, sales: r1.sales, gwpEx: r1.gwpEx, byCampaign: r1.byCampaign, overall: r1.overall, dayCp: (r1.days || []).map((x) => x.cp) },
        r2: r2 && { campaign: r2.campaign, hasSplit: 'byCampaign' in r2 || 'overall' in r2, dayCp: (r2.days || []).some((x) => 'cp' in x) } }; };
    /* D (first) · no assignment: the whole month is Courtesy — the blend */
    const BEFORE = snap();
    /* A · the sheet through the real upload path */
    await handleFiles([new File([sheet], 'Campaign assignments Sep 2026.csv', { type: 'text/csv' })]);
    const stored = Object.values(S.campAssign).filter((x) => !x.deleted).map((x) => [x.code, x.campaign, x.from, x.until]);
    const AFTER = snap(); const DIGEST = JSON.parse(JSON.stringify(agentDigestPayload()));
    /* a correction on the same agent and start date replaces rather than competes */
    const fix = addCampAssign('CB901', 'Upsell', '2026-09-01', '2026-09-07', 'manual');
    const active = Object.values(S.campAssign).filter((x) => !x.deleted && x.code === 'CB901' && x.from === '2026-09-01');
    /* a removal is a tombstone that wins a merge against an older copy of the same id */
    const older = JSON.parse(JSON.stringify(S));
    removeCampAssign(fix.id);
    const merged = mergeStates(S, older);
    const survives = merged.campAssign[fix.id] && merged.campAssign[fix.id].deleted === true;
    const merged2 = mergeStates(older, S);   // either direction
    const survives2 = merged2.campAssign[fix.id] && merged2.campAssign[fix.id].deleted === true;
    /* removing both assignments restores the list's month exactly */
    for (const id in S.campAssign) if (!S.campAssign[id].deleted) removeCampAssign(id);
    const RESTORED = snap();
    return { msgs, files: (S.files || []).map((f) => f.type), stored, fixCampaign: fix && fix.campaign, activeSameStart: active.length, survives, survives2,
      BEFORE, AFTER, RESTORED, DIGEST, camp0: CAMPS.includes('Download & Test') };
  }, [SHEET]);

  console.log('\nA · the assignment sheet');
  ok('an assignment sheet is detected and registered through the real upload path', out.files.includes('campAssign'), JSON.stringify(out.files));
  ok('both CB901 assignments are stored with their dates', JSON.stringify(out.stored.filter((x) => x[0] === 'CB901').sort()) === JSON.stringify([['CB901', 'Courtesy', '2026-09-08', ''], ['CB901', 'Download & Test', '2026-09-01', '2026-09-07']]), JSON.stringify(out.stored));
  ok('a row it cannot read is named with the reason, never guessed', out.msgs.some((m) => /row 4 \(no campaign\)/.test(m)), out.msgs.join(' | '));
  ok('"Upsell" folds to the campaign the floor already calls Download & Test', out.fixCampaign === 'Download & Test', out.fixCampaign);
  ok('a correction with the same agent and start date replaces the first (one active, not two)', out.activeSameStart === 1, String(out.activeSameStart));
  ok('a removal survives a merge with an older copy, in either direction', out.survives && out.survives2);

  console.log('\nB · the engine attributes each day to its own campaign');
  const A = out.AFTER;
  ok('Download & Test becomes a reported campaign because an assignment names it', A.camps.includes('Download & Test'), JSON.stringify(A.camps));
  ok('1–7 Sep land in Download & Test (5 working days), 8–18 Sep in Courtesy (9)', (A.byCamp['Download & Test'] || []).length === 5 && (A.byCamp.Courtesy || []).length === 9
    && A.byCamp['Download & Test'].every((d) => d <= '2026-09-07') && A.byCamp.Courtesy.every((d) => d >= '2026-09-08'), JSON.stringify(A.byCamp));
  ok('the Download & Test week is its own aggregate: 5 shifts, 10 sales', A.dt && A.dt.emp === 5 && A.dt.sales === 10, JSON.stringify(A.dt));
  ok('the current campaign is the latest one worked (Courtesy)', A.cur === 'Courtesy', A.cur);
  ok('the rating window stays inside the current campaign', A.window.length > 0 && A.window.every((c) => c === 'Courtesy'), JSON.stringify(A.window));

  console.log('\nC · the digest shows the split and never blends it');
  const r = A.r1;
  ok('the top-level row is the CURRENT campaign only: Courtesy, 9 shifts, 27 sales, the Courtesy plan', r.campaign === 'Courtesy' && r.emp === 9 && r.sales === 27 && r.plan === 'EXP_COURTESY', JSON.stringify({ c: r.campaign, e: r.emp, s: r.sales, p: r.plan }));
  const bc = r.byCampaign || [];
  ok('byCampaign carries both campaigns in date order, each with its dates', bc.length === 2 && bc[0].campaign === 'Download & Test' && bc[0].from === '2026-09-01' && bc[0].to === '2026-09-07'
    && bc[1].campaign === 'Courtesy' && bc[1].from === '2026-09-08' && bc[1].to === '2026-09-18', JSON.stringify(bc.map((x) => [x.campaign, x.from, x.to])));
  ok('…each with its own figures and commission plan (Download & Test on EXP_DOWNUP), the current one marked', bc[0] && bc[0].sales === 10 && bc[0].plan === 'EXP_DOWNUP' && !bc[0].now && bc[1].now && bc[1].sales === 27,
    JSON.stringify(bc.map((x) => [x.campaign, x.sales, x.plan, x.now])));
  ok('overall is the whole period across both: 14 shifts, 37 sales', r.overall && r.overall.emp === 14 && r.overall.sales === 37, JSON.stringify(r.overall));
  ok('overall "% of target" is withheld while a campaign has no target (never a blended 37 ÷ Courtesy\'s target)', r.overall && r.overall.pctT === null && bc[1].pctT != null, JSON.stringify({ o: r.overall && r.overall.pctT, c: bc[1] && bc[1].pctT }));
  ok('the day rows name their campaign for a split agent', r.dayCp.length === 14 && r.dayCp.filter((x) => x === 'Download & Test').length === 5, JSON.stringify(r.dayCp));
  ok('an agent on one campaign carries no split and no per-day campaign', A.r2.campaign === 'Courtesy' && !A.r2.hasSplit && !A.r2.dayCp, JSON.stringify(A.r2));

  console.log('\nD · the blend this fixes, and the way back');
  const B0 = out.BEFORE;
  ok('without an assignment the list claims the whole month: one Courtesy row, 14 shifts, 37 sales blended', B0.r1.campaign === 'Courtesy' && B0.r1.emp === 14 && B0.r1.sales === 37 && !B0.r1.byCampaign,
    JSON.stringify({ c: B0.r1.campaign, e: B0.r1.emp, s: B0.r1.sales }));
  const R = out.RESTORED;
  ok('removing the assignments restores exactly that', R.r1.campaign === 'Courtesy' && R.r1.emp === 14 && R.r1.sales === 37 && !R.r1.byCampaign, JSON.stringify({ c: R.r1.campaign, e: R.r1.emp, s: R.r1.sales }));
  ok('no page errors', errs.length === 0, errs.join(' | '));

  /* ═══ E · Agent Analytics, rendered from the digest the engine just published ═══ */
  console.log('\nE · Agent Analytics shows the split — never a blend');
  const PAGE = fs.readFileSync(path.join(ROOT, 'agent', 'index.html'), 'utf8');
  const m = PAGE.match(/<script>\n"use strict";([\s\S]*?)<\/script>/); const src = m[1].replace(/\nboot\(\);\s*$/, '\n');
  const nodes = {}; const mkEl = () => ({ innerHTML: '', value: '', style: {}, classList: { add() {}, remove() {}, contains: () => false }, addEventListener() {}, setAttribute() {}, getAttribute: () => null, querySelectorAll: () => [], focus() {}, onclick: null });
  const doc = { getElementById: (id) => (nodes[id] = nodes[id] || mkEl()), querySelectorAll: () => [], createElement: mkEl };
  const store = {}; const win = { location: { search: '?k=testkey' }, localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; }, removeItem: (k) => { delete store[k]; } }, scrollTo() {} };
  const P = new Function('document', 'window', 'localStorage', 'location', 'fetch', 'URLSearchParams', 'setTimeout', 'Intl', 'console',
    src + '\nreturn {show,teamView,setD:function(d){D=d},setMe:function(x){ME=x},setTeam:function(t){TEAM=t},setView:function(v){VIEW=v}};')(
    doc, win, win.localStorage, win.location, () => Promise.reject(new Error('no network')), URLSearchParams, (f) => f, Intl, { log() {}, error() {} });
  const text = () => (nodes.root ? nodes.root.innerHTML : '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ');
  const D = out.DIGEST, mover = D.agents.find((a) => a.code === 'CB901'), single = D.agents.find((a) => a.code === 'CB902');
  P.setTeam(null); P.setD({ ...D, role: 'agent', agents: [mover] }); P.setMe(mover); P.setView('month'); P.show(mover);
  let t = text();
  ok('the header names the current campaign and the other one with its dates', /Courtesy since 8 Sep · also Download & Test 1 Sep – 7 Sep/.test(t), (t.match(/Courtesy since.{0,80}/) || ['not found'])[0]);
  ok('…and counts only the current campaign\'s days ("… working days worked on Courtesy")', /working days worked on Courtesy/.test(t));
  ok('"Your month by campaign" lists both campaigns, the current one marked, and the whole month', /Your month by campaign/.test(t) && /Download & Test 1 Sep – 7 Sep/.test(t)
    && /Courtesy now 8 Sep – 18 Sep/.test(t) && /All campaigns the whole month so far 14 37 R ?[\d,\s]+ — /.test(t), (t.match(/Your month by campaign.{0,420}/) || ['not found'])[0]);
  ok('the target sentence is the Courtesy target, not a blended month', /To reach your Courtesy target for September of \d+ sales/.test(t), (t.match(/To reach your.{0,80}/) || ['not found'])[0]);
  ok('no placeholder leaked', !/undefined|NaN/.test(t));
  P.setView('calc'); P.show(mover); t = text();
  ok('Projected Commission carries the split card and projects Courtesy only (its own GWP, its own plan)', /Your month by campaign/.test(t) && /Experienced — Courtesy/.test(t) && !/Download & Test — /.test(t.replace(/Your month by campaign.*?All campaigns/, '')),
    (t.match(/Plan.{0,60}/) || ['not found'])[0]);
  P.setView('month'); P.setD({ ...D, role: 'agent', agents: [single] }); P.setMe(single); P.show(single); t = text();
  ok('an agent who worked one campaign sees no split card', !/Your month by campaign/.test(t) && !/ since /.test((t.match(/Test Agent 2.{0,120}/) || [''])[0]));
  const TL = { ...D, role: 'team_leader', name: 'Leader Alpha', agents: D.agents.map((a) => ({ ...a, covered: true })) };
  P.setD(TL); P.setTeam(TL); P.setView('mtd_team'); P.teamView(); t = text();
  ok('the team leader\'s Month to Date marks the mover under their name and says their row is one campaign', /Courtesy since 8 Sep · also Download & Test/.test(t) && /1 agent\(s\) worked more than one campaign this month/.test(t),
    (t.match(/worked more than one campaign.{0,80}/) || ['not found'])[0]);
} finally {
  await b.close(); server.close();
}
console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
process.exitCode = fail ? 1 : 0;
