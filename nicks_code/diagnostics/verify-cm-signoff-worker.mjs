#!/usr/bin/env node
/**
 * verify-cm-signoff-worker.mjs — the Worker half of the campaign manager's sign-off list
 * (spec 001-cm-view-signoff, work package 2; contracts C2, C3, C4 in specs/001-cm-view-signoff/contracts).
 *
 *   node nicks_code/diagnostics/verify-cm-signoff-worker.mjs
 *
 * Pure: an in-memory DB, fixture digests, nothing leaves the machine. The engine publishes every figure;
 * the Worker only scopes, sums the rows of ONE already-built digest, and serves it.
 *
 *   A  campaign overview  — conversion on CLOSED leads, talk against its target, contact rate everywhere,
 *                           the blockage panel per campaign
 *   B  tenure             — ?tenure= filters rows BEFORE aggregation; ignored for other roles
 *   C  team leaders'      — GET /api/portal/cm-coaching: manager only, server-scoped, newest first
 *      coaching
 *   D  period             — ?period= current | YYYY-MM | cycle-YYYY-MM, 400 / 404 as contracted
 *   R  custom range       — ?period=range-YYYY-MM-DD-YYYY-MM-DD (spec 006-cm-custom-range, contracts C1–C4): validated,
 *                           queued once in kv:cm-range-requests while unbuilt (404 range_building / range_refused),
 *                           served when built, listed in periods.ranges, and the range's report keys on tl/reports
 *   E  CM report data     — agents, tlAgg, campAgg + the envelope
 *   F  team-leader rows   — every agent row carries `drill` and `coach`
 *   G  the rule book      — specs/cm_rules.json and the operative copy cannot drift
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
const close = (a, b, eps = 1e-9) => a != null && b != null && Math.abs(a - b) < eps;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* ------------------------------------------------------------------ the in-memory world */
const RULES = {};     // 'kv:…' / 'cm:…' -> value
const STORE = {};     // 'raw/kv/…'   -> text
const publish = (key, obj) => { RULES[key] = { store: 'raw/kv/' + key.replace(/^kv:/, '') }; STORE['raw/kv/' + key.replace(/^kv:/, '')] = JSON.stringify(obj); };

const APP_USERS = [
  { username: 'cb267', full_name: 'Denise Haripersad', cb: 'CB267', team: 'Denise Haripersad', hub_ids: { coaching: 'jx7ad7sm95xg4738eg5a0479558c9z0x' } },
  { username: 'cb207', full_name: 'Renolan Pillay', cb: 'CB207', team: 'Renolan Pillay', hub_ids: null },          // matched by NAME
  { username: 'cb300', full_name: 'Olivia Outside', cb: 'CB300', team: 'Olivia Outside', hub_ids: { coaching: 'olivia-id' } },   // another campaign
];
const decodeKeys = (q) => { const m = /key=in\.\(([^)]*)\)/.exec(q); return m ? decodeURIComponent(m[1]).split(',') : []; };
/* spec 006: the custom-range queue is a real rules row here — insert (create-only unless upsert) and a compare-and-set
   PATCH on updated_at, exactly the PostgREST semantics the Worker relies on. Every OTHER key keeps the old no-op insert. */
const STAMP = {};     // 'kv:cm-range…' -> updated_at
const QUEUED = (k) => /^kv:cm-range/.test(k);
let QUEUE_WRITES = 0;
const DB = {
  select: async (q) => {
    if (q.startsWith('rules?key=in.')) return decodeKeys(q).filter((k) => RULES[k]).map((k) => ({ key: k, value: RULES[k] }));
    if (q.startsWith('rules?key=like.')) {
      const pref = decodeURIComponent(q.split('like.')[1].split('&')[0]).replace(/%$/, '');
      return Object.keys(RULES).filter((k) => k.startsWith(pref)).map((key) => ({ key }));
    }
    if (q.startsWith('rules?key=eq.')) { const k = decodeURIComponent(q.split('eq.')[1].split('&')[0]); return RULES[k] ? [{ key: k, value: RULES[k], updated_at: STAMP[k] }] : []; }
    if (q.startsWith('app_users?role=eq.team_leader')) return APP_USERS.map((u) => ({ ...u, ...(q.includes('hub_ids') ? {} : { hub_ids: undefined }) }));
    return [];
  },
  insert: async (table, rows, upsert) => {
    if (!String(table).startsWith('rules')) return;
    for (const r of rows || []) {
      if (!QUEUED(r.key)) continue;
      if (!upsert && RULES[r.key]) throw new Error('supabase POST rules → 409: duplicate key');
      RULES[r.key] = r.value; STAMP[r.key] = r.updated_at; QUEUE_WRITES++;
    }
  },
  updateReturning: async (q, patch) => {
    const m = /^rules\?key=eq\.([^&]+)(?:&updated_at=eq\.([^&]+))?/.exec(q);
    if (!m) return [];
    const k = decodeURIComponent(m[1]);
    if (!QUEUED(k) || !(k in RULES)) return [];
    if (m[2] !== undefined && decodeURIComponent(m[2]) !== STAMP[k]) return [];     // somebody else got there first
    RULES[k] = patch.value; STAMP[k] = patch.updated_at; QUEUE_WRITES++;
    return [{ key: k, value: RULES[k], updated_at: STAMP[k] }];
  },
  del: async () => {}, update: async () => {},
  storageGet: async (bucket, key) => STORE[bucket + '/' + key] || null,
};
const env = {};
const resetCaches = () => { for (const k of ['__digestCaches', '__digestMonths', '__digestCycles', '__digestRanges', '__coachCache', '__cmCtx', '__nbaCache', '__reportCaches']) delete globalThis[k]; };

/* ------------------------------------------------------------------ fixture digest */
const DAYS = (n, sales, from = 1) => Array.from({ length: n }, (_, i) => ({ d: '2026-09-' + String(from + i).padStart(2, '0'), s: sales, t: 3, x: sales * 90, act: 1, emp: 1, tk: 16000 }));
const mk = (code, name, campaign, tenure, tl, o = {}) => ({ code, name, campaign, tenure, tl, sales: 20, target: 60, pctT: 20 / 60, gwpEx: 1800, gwpT: 5000, act: 10, emp: 10, talk: 163200,
  calls: 400, ans: 200, leads: 90, closed: 100, qa: 0.9, att: 1, canc: 0, ref: 0, composite: { r2a: { fails: 0 } }, days: [], ...o });
const DIGEST = () => ({
  updatedAt: new Date().toISOString(),
  period: { from: '2026-09-01', to: '2026-09-30' }, diallingDays: 20, workingDays: 21, daysWithData: 20,
  dates: ['2026-09-01', '2026-09-02'], weeks: [{ n: 1 }], talkUnit: 'hours', onTarget: 1,
  agents: [
    mk('CB1', 'Courtesy One', 'Courtesy', 'M1', 'Denise Haripersad', { sales: 20, closed: 100, calls: 400, ans: 200, talk: 163200 }),
    mk('CB2', 'Courtesy Two', 'Courtesy', 'Experienced', 'Denise Haripersad', { sales: 30, closed: 150, calls: 600, ans: 240, talk: 163200 }),
    mk('CB3', 'Courtesy Three', 'Courtesy', '', 'Denise Haripersad', { sales: 10, closed: 50, calls: 200, ans: 100, talk: 100000 }),
    mk('CB4', 'Cuddle One', 'Cuddle', 'Experienced', 'Renolan Pillay', { sales: 80, target: 160, closed: 200, calls: 500, ans: 250, talk: 162000 }),
    mk('CB5', 'Cuddle Two', 'Cuddle', 'M2', 'Renolan Pillay', { sales: 20, closed: 100, calls: 300, ans: 90, talk: 150000 }),
    mk('CB9', 'Outside One', 'Rewarded', 'M1', 'Olivia Outside', { sales: 5 }),          // not a campaign the manager holds
  ],
  notCovered: [{ code: 'CB77', name: 'No Activity', tl: 'Denise Haripersad', campaign: 'Courtesy', why: 'nodata' }],
  tlAgg: [{ camp: 'Courtesy', tl: 'Denise Haripersad', sales: 60 }, { camp: 'Cuddle', tl: 'Renolan Pillay', sales: 100 }, { camp: 'Rewarded', tl: 'Olivia Outside', sales: 5 }],
  campAgg: { Courtesy: { sales: 60 }, Cuddle: { sales: 100 }, Rewarded: { sales: 5 } },
});
const noClosed = (d) => { const c = JSON.parse(JSON.stringify(d)); c.agents.forEach((a) => { a.closed = null; a.calls = 0; a.ans = 0; }); return c; };

const { authorise, overview, agentDetail, overviewRequest, cmCoaching, resolvePeriod, parseTenure, PORTAL_ALLOWED, bySegment, SEGMENT_ROW_KEYS } = await import(SRC('portal.mjs'));
const CM = await import(SRC('campaign.mjs'));
const { coachAnalysis, themeLabel } = await import(SRC('coaching.mjs'));
const { cyclesNow } = await import(SRC('cycle.mjs'));
const { loadCmContext, cmOverviewBody } = CM;

const cmUser = { username: 'ryan', full_name: 'Ryan G', role: 'campaign_manager', cb: '' };
const tlUser = { username: 'cb267', full_name: 'Denise Haripersad', role: 'team_leader', cb: 'CB267', team: 'Denise Haripersad' };
const agentUser = { username: 'cb1', full_name: 'Courtesy One', role: 'agent', cb: 'CB1' };
const adminUser = { username: 'aarav', full_name: 'Aarav', role: 'admin', cb: '' };

const setup = async () => {
  resetCaches();
  for (const k of Object.keys(RULES)) delete RULES[k];
  for (const k of Object.keys(STORE)) delete STORE[k];
  for (const k of Object.keys(STAMP)) delete STAMP[k];
  RULES['cm:assignments'] = { ryan: { name: 'Ryan G', campaigns: ['courtesy', 'cuddle'] }, dalwin: { name: 'Dalwin', campaigns: ['courtesy', 'cuddle'] } };
  return loadCmContext(DB, { force: true });
};
let ctx = await setup();
const body = (d, opts, user = cmUser) => { const a = authorise(user, d); return cmOverviewBody(d, a, { requests: [] }, globalThis.__cmCtx, opts); };
const camp = (b, key) => b.campaigns.find((c) => c.key === key);

/* =================================================================== A */
head('A · campaign overview: conversion on closed leads, talk target, contact rate, blockage panel');
{
  const b = body(DIGEST());
  const cou = camp(b, 'courtesy'), cud = camp(b, 'cuddle'), all = camp(b, 'all');
  ok('conversion = Σ sales ÷ Σ closed leads (60 ÷ 300)', cou.kpis.conv && close(cou.kpis.conv.v, 60 / 300) && cou.kpis.conv.sales === 60 && cou.kpis.conv.closed === 300, JSON.stringify(cou.kpis.conv));
  ok('and says which basis: "sales ÷ closed leads"', cou.kpis.conv.basis === 'sales ÷ closed leads');
  ok('conversion carries the target (the 10% Lead Management dial)', close(cou.kpis.conv.target, 0.10));
  ok('Cuddle: (80 + 20) ÷ (200 + 100)', cud.kpis.conv && close(cud.kpis.conv.v, 100 / 300), JSON.stringify(cud.kpis.conv));
  ok('the All campaigns entry sums the same rows (160 ÷ 600)', all && close(all.kpis.conv.v, 160 / 600) && all.kpis.conv.closed === 600);
  ok('a team row carries its own closed-lead conversion in the same shape', cou.teams.every((t) => t.conv && t.conv.basis === 'sales ÷ closed leads' && t.conv.closed === 300), JSON.stringify(cou.teams[0].conv));
  ok('no convWhy while conversion is known', !('convWhy' in cou.kpis));

  const n = body(noClosed(DIGEST()));
  const c0 = camp(n, 'courtesy');
  ok('closed unknown (no case book): conversion is null, never 0%', c0.kpis.conv === null);
  ok('...with a reason in words (convWhy)', typeof c0.kpis.convWhy === 'string' && /closed/i.test(c0.kpis.convWhy), c0.kpis.convWhy);
  ok('...and the team rows say null too', c0.teams.every((t) => t.conv === null && typeof t.convWhy === 'string'));
  const z = DIGEST(); z.agents.forEach((a) => { a.closed = 0; });
  ok('a REAL zero closed leads is also null (nothing to divide by) with its own reason', camp(body(z), 'courtesy').kpis.conv === null && /no leads|nothing to divide/i.test(camp(body(z), 'courtesy').kpis.convWhy));

  /* a mover's earlier segment carries no whole-month closed — its sales must not inflate the numerator */
  const mv = DIGEST(); mv.agents[0].closed = null;
  const cm2 = camp(body(mv), 'courtesy').kpis.conv;
  ok('an agent with closed unknown leaves BOTH sides (numerator and denominator stay like for like)', cm2 && cm2.sales === 40 && cm2.closed === 200 && close(cm2.v, 0.2), JSON.stringify(cm2));
}
{
  const b = body(DIGEST());
  const cou = camp(b, 'courtesy'), cud = camp(b, 'cuddle');
  ok('talk: v is seconds per worked day (Σ talk ÷ Σ act)', close(cou.kpis.talk.v, (163200 + 163200 + 100000) / 30), JSON.stringify(cou.kpis.talk));
  ok('Courtesy target is 300 minutes (5 h)', cou.kpis.talk.targetMin === 300 && cou.kpis.talk.targetSec === 18000 && cou.kpis.talk.source === 'default', JSON.stringify(cou.kpis.talk));
  ok('Cuddle target is 270 minutes (4 h 30 m)', cud.kpis.talk.targetMin === 270 && cud.kpis.talk.targetSec === 16200 && cud.kpis.talk.source === 'default', JSON.stringify(cud.kpis.talk));
  const other = DIGEST(); other.agents.push(mk('CB20', 'Nest One', 'Nesting', 'M0', 'Renolan Pillay'));
  globalThis.__cmCtx.assign.ryan.campaigns = ['courtesy', 'cuddle', 'nesting'];
  ok('any other campaign falls to the 210-minute default', camp(body(other), 'nesting').kpis.talk.targetMin === 210);
  globalThis.__cmCtx.assign.ryan.campaigns = ['courtesy', 'cuddle'];
  /* the live override wins */
  globalThis.__cmCtx.targets = { ...globalThis.__cmCtx.targets, sla: { courtesy: { talk_target: 240 } } };
  const ov = camp(body(DIGEST()), 'courtesy').kpis.talk;
  ok('a cm:targets per-campaign talk_target OVERRIDES the rule book (source "settings")', ov.targetMin === 240 && ov.targetSec === 14400 && ov.source === 'settings', JSON.stringify(ov));
  ok('...and only for that campaign', camp(body(DIGEST()), 'cuddle').kpis.talk.targetMin === 270);
  globalThis.__cmCtx.targets = { ...globalThis.__cmCtx.targets, sla: {} };
  /* review fix 7a: the All entry mixes campaigns with different targets — it names none */
  const allT = camp(b, 'all').kpis.talk;
  ok('All campaigns: talk.targetMin and targetSec are null and source is "mixed" (the targets differ by campaign)', allT.targetMin === null && allT.targetSec === null && allT.source === 'mixed' && close(allT.v, (163200 * 2 + 100000 + 162000 + 150000) / 50), JSON.stringify(allT));
  /* review fix 7b: the global cm:sla talk_target is the default for OTHER campaigns; the rule book's own targets beat it */
  const keepSla = globalThis.__cmCtx.sla;
  globalThis.__cmCtx.sla = { ...keepSla, talk_target: 210 };
  ok('with the live global cm:sla talk_target = 210, Courtesy is STILL 300 and Cuddle 270 (rule book beats the global)', camp(body(DIGEST()), 'courtesy').kpis.talk.targetMin === 300 && camp(body(DIGEST()), 'cuddle').kpis.talk.targetMin === 270);
  globalThis.__cmCtx.sla = { ...keepSla, talk_target: 180 };
  const nest = DIGEST(); nest.agents.push(mk('CB20', 'Nest One', 'Nesting', 'M0', 'Renolan Pillay'));
  globalThis.__cmCtx.assign.ryan.campaigns = ['courtesy', 'cuddle', 'nesting'];
  const t180 = camp(body(nest), 'nesting').kpis.talk;
  ok('a campaign with no rule-book target takes the global cm:sla talk_target (180, a setting)', t180.targetMin === 180 && t180.source === 'settings', JSON.stringify(t180));
  ok('...while Courtesy keeps 300', camp(body(nest), 'courtesy').kpis.talk.targetMin === 300);
  globalThis.__cmCtx.sla = { ...keepSla, talk_target: 210 };
  ok('the global at its 210 default reads as source "default"', camp(body(nest), 'nesting').kpis.talk.source === 'default');
  globalThis.__cmCtx.sla = keepSla; globalThis.__cmCtx.assign.ryan.campaigns = ['courtesy', 'cuddle'];
  const tt = CM.talkTargetFor({ sla: { talk_target: 180 }, targets: { sla: { nesting: { talk_target: 200 } } } }, 'nesting');
  ok('a per-campaign cm:targets setting still beats the global (200)', tt.targetMin === 200 && tt.source === 'settings');
}
{
  /* review fix 8: a request with no timestamp must not poison the panel with NaN */
  const panel = CM.blockPanelFor([{ blockage: 'dialler', closed: false, affected: 1 }, { blockage: 'dialler', closed: false, requested: new Date(Date.now() - 2 * 86400000).toISOString(), affected: 1 }], [{ key: 'dialler', label: 'Dialler' }], Date.now());
  ok('blockPanelFor: a missing "requested" is treated as now, not NaN (oldestDays is a number)', panel.length === 1 && Number.isFinite(panel[0].oldestDays) && panel[0].oldestDays === 2, JSON.stringify(panel));
  const p0 = CM.blockPanelFor([{ blockage: 'dialler', closed: false, affected: 1 }], [{ key: 'dialler', label: 'Dialler' }], Date.now());
  ok('...and a lone undated open request is 0 days old', p0[0].oldestDays === 0);
}
{
  const b = body(DIGEST());
  const cou = camp(b, 'courtesy');
  ok('contact rate = answered ÷ dials, with the counts (540 ÷ 1200)', cou.kpis.contactRate && close(cou.kpis.contactRate.v, 540 / 1200) && cou.kpis.contactRate.contacts === 540 && cou.kpis.contactRate.dials === 1200, JSON.stringify(cou.kpis.contactRate));
  ok('every team row carries contactRate {v, contacts, dials}', cou.teams.every((t) => t.contactRate && t.contactRate.dials === 1200 && close(t.contactRate.v, 0.45)), JSON.stringify(cou.teams[0].contactRate));
  const n = body(noClosed(DIGEST()));
  ok('no dials: contactRate null with contactWhy, on the KPI and on every team row',
    camp(n, 'courtesy').kpis.contactRate === null && /dial/i.test(camp(n, 'courtesy').kpis.contactWhy || '') && camp(n, 'courtesy').teams.every((t) => t.contactRate === null && typeof t.contactWhy === 'string'));
  ok('contact rate is on the All campaigns entry too', camp(b, 'all').kpis.contactRate.dials === 2000);
}
{
  /* the blockage panel, per campaign */
  const reqs = [
    { id: 'r1', campaign: 'Courtesy', blockage: 'dialler', blockageLabel: 'Dialler', closed: false, requested: new Date(Date.now() - 3 * 86400000).toISOString(), affected: 4, resolutionMins: null, repeat: false, priority: 'P1', tl: 'Denise Haripersad', cb: 'CB267', sla: { state: 'breached' } },
    { id: 'r2', campaign: 'Cuddle', blockage: 'leads', blockageLabel: 'Leads', closed: false, requested: new Date().toISOString(), affected: 2, resolutionMins: null, repeat: true, priority: 'P2', tl: 'Renolan Pillay', cb: 'CB207', sla: { state: 'within' } },
    { id: 'r3', campaign: 'Cuddle', blockage: 'leads', blockageLabel: 'Leads', closed: true, requested: new Date().toISOString(), affected: 1, resolutionMins: 60, repeat: true, priority: 'P3', tl: 'Renolan Pillay', cb: 'CB207', sla: { state: 'met' } },
  ];
  const blockPanel = [{ key: 'dialler', label: 'Dialler' }, { key: 'leads', label: 'Leads' }];
  const d = DIGEST(); const a = authorise(cmUser, d);
  const r = await overview(env, DB, cmUser, d, [], { assist: { stages: [], requests: reqs, kpis: {}, blockPanel, truncated: false } });
  const by = r.body.assist && r.body.assist.blockPanelByCamp;
  ok('assist.blockPanelByCamp exists, keyed by campaign key', by && Array.isArray(by.courtesy) && Array.isArray(by.cuddle), JSON.stringify(Object.keys(by || {})));
  ok('Courtesy holds only Courtesy\'s dialler row', by.courtesy.length === 1 && by.courtesy[0].key === 'dialler' && by.courtesy[0].open === 1 && by.courtesy[0].raised === 1 && by.courtesy[0].affected === 4, JSON.stringify(by.courtesy));
  ok('Cuddle holds only its leads row (open 1, raised 2, comes back)', by.cuddle.length === 1 && by.cuddle[0].key === 'leads' && by.cuddle[0].open === 1 && by.cuddle[0].raised === 2 && by.cuddle[0].comesBack === true && by.cuddle[0].avgResolution === 60, JSON.stringify(by.cuddle));
  ok('the old all-campaigns blockPanel is still there for the All view', Array.isArray(r.body.assist.blockPanel));
  const e = await overview(env, DB, cmUser, d, [], { assist: { error: 'HighLevel down' } });
  ok('with the register unreachable the sales half still renders and the panel is simply absent', e.status === 200 && e.body.assist.error && !e.body.assist.blockPanelByCamp && e.body.cm.campaigns.length === 3);
}

/* =================================================================== B */
head('B · tenure: ?tenure= filters the rows BEFORE aggregation');
{
  const all = body(DIGEST(), { tenure: 'all' });
  const none = body(DIGEST());
  ok('"all" equals today\'s figures exactly (same as no option)', same(all.campaigns.map((c) => c.kpis), none.campaigns.map((c) => c.kpis)));
  ok('cm.tenure echoes the selection', all.tenure === 'all' && body(DIGEST(), { tenure: 'M1' }).tenure === 'M1');
  const m1 = body(DIGEST(), { tenure: 'M1' });
  ok('M1: Courtesy is just CB1 — 1 agent, conversion 20 ÷ 100', camp(m1, 'courtesy').agents === 1 && close(camp(m1, 'courtesy').kpis.conv.v, 0.2) && camp(m1, 'courtesy').kpis.sales.v === 20, JSON.stringify(camp(m1, 'courtesy').kpis.sales));
  ok('M1: Cuddle has nobody on M1 — still listed, 0 agents, never silently dropped', camp(m1, 'cuddle') && camp(m1, 'cuddle').agents === 0 && camp(m1, 'cuddle').teams.length === 0);
  const ex = body(DIGEST(), { tenure: 'Exp' });
  ok('Exp reads the digest\'s "Experienced" (CB2 on Courtesy, CB4 on Cuddle)', camp(ex, 'courtesy').agents === 1 && camp(ex, 'cuddle').agents === 1 && camp(ex, 'courtesy').kpis.sales.v === 30);
  const un = body(DIGEST(), { tenure: 'unset' });
  ok('unset covers the blank tenure (CB3 only) — never dropped', camp(un, 'courtesy').agents === 1 && camp(un, 'courtesy').kpis.sales.v === 10 && camp(un, 'cuddle').agents === 0);
  ok('the roster drill-down follows the filter', same(camp(m1, 'courtesy').agentIndex.map((a) => a.code), ['CB1']));
  const tn = camp(m1, 'courtesy').tenures, tc = camp(m1, 'cuddle').tenures;
  ok('campaigns[i].tenures lists the tenures PRESENT on the campaign, from the unfiltered rows (so the picker never empties itself)',
    same(tn.map((x) => x.key), ['M1', 'Exp', 'unset']) && same(tc.map((x) => x.key), ['M2', 'Exp']), JSON.stringify([tn, tc]));
  ok('each entry is {key, label, agents}', tn.every((x) => x.key && x.label && typeof x.agents === 'number') && tn.find((x) => x.key === 'Exp').agents === 1);
  ok('the All entry\'s tenures count across campaigns', camp(m1, 'all').tenures.find((x) => x.key === 'Exp').agents === 2);
  const withNC = body(DIGEST(), { tenure: 'all' });
  ok('a no-activity agent (no tenure on file) stays in "all" and in no tenure slice', camp(withNC, 'courtesy').agents === 4 && camp(un, 'courtesy').agents === 1);

  ok('parseTenure accepts all|M0|M1|M2|Exp|unset and defaults to all', ['all', 'M0', 'M1', 'M2', 'Exp', 'unset'].every((t) => parseTenure(t) === t) && parseTenure('') === 'all' && parseTenure(undefined) === 'all' && parseTenure(null) === 'all');
  ok('parseTenure refuses anything else', parseTenure('exp') === null && parseTenure('M3') === null && parseTenure('<script>') === null && parseTenure('all,M1') === null);
}
{
  await setup();
  publish('kv:agent-digest', DIGEST());
  const call = (user, q) => overviewRequest(env, DB, user, q, { getAssist: async () => ({ requests: [] }), nowMs: Date.parse('2026-10-01T08:00:00Z') });
  let r = await call(cmUser, { tenure: 'Exp' });
  ok('overviewRequest: a manager\'s ?tenure=Exp is honoured end to end', r.status === 200 && r.body.cm.tenure === 'Exp' && camp(r.body.cm, 'courtesy').agents === 1, r.status + ' ' + JSON.stringify(r.body).slice(0, 120));
  r = await call(cmUser, { tenure: 'nonsense' });
  ok('a bad tenure is a 400 {error:"bad_tenure"}', r.status === 400 && r.body.error === 'bad_tenure', r.status + JSON.stringify(r.body));
  r = await call(tlUser, { tenure: 'nonsense', period: 'garbage' });
  ok('...but for a team leader the params are ignored (no 400, normal overview)', r.status === 200 && r.body.scope === 'team', r.status + JSON.stringify(r.body).slice(0, 100));
  r = await call(agentUser, { tenure: 'M1', period: 'cycle-2026-09' });
  ok('...and for an agent', r.status === 200 && r.body.me && r.body.me.code === 'CB1');
  r = await call(tlUser, { tenure: 'M1' });
  ok('a team leader\'s team is not filtered by tenure', r.body.agents.length === 4);
}

/* =================================================================== D (period) */
head('D · period: current | YYYY-MM | cycle-YYYY-MM');
{
  await setup();
  const NOW = Date.parse('2026-10-01T08:00:00Z');                         // 1 Oct: cycle-2026-10 is in progress (26 Sep – 25 Oct); cycle-2026-09 just closed
  const live = DIGEST(); live.period = { from: '2026-10-01', to: '2026-10-31' }; live.marker = 'live';
  const sept = DIGEST(); sept.marker = 'month';
  const cyc = DIGEST(); cyc.marker = 'cycle'; cyc.period = { from: '2026-08-26', to: '2026-09-25', kind: 'cycle' };
  publish('kv:agent-digest', live); publish('kv:agent-digest-2026-09', sept); publish('kv:agent-digest-cycle-2026-09', cyc);
  const call = (q, user = cmUser) => { resetCaches(); return loadCmContext(DB, { force: true }).then(() => overviewRequest(env, DB, user, q, { getAssist: async () => ({ requests: [] }), nowMs: NOW })); };
  const dg = (r) => r.body && r.body.sla !== undefined ? null : null;

  let r = await call({});
  ok('no period = the live digest, period {kind:"current"}', r.status === 200 && r.body.period.kind === 'current' && r.body.period.key === 'current' && r.body.period.from === '2026-10-01' && r.body.period.to === '2026-10-31', JSON.stringify(r.body.period));
  ok('period carries a label', typeof r.body.period.label === 'string' && /2026/.test(r.body.period.label), r.body.period.label);
  r = await call({ period: 'current' });
  ok('"current" is the same', r.status === 200 && r.body.period.kind === 'current');
  r = await call({ period: '2026-09' });
  ok('YYYY-MM loads that month\'s digest (kv:agent-digest-2026-09)', r.status === 200 && r.body.period.kind === 'month' && r.body.period.key === '2026-09' && r.body.period.from === '2026-09-01' && r.body.period.to === '2026-09-30' && /September 2026/.test(r.body.period.label), JSON.stringify(r.body.period));
  r = await call({ period: 'cycle-2026-09' });
  ok('cycle-YYYY-MM loads kv:agent-digest-cycle-YYYY-MM, 26 Aug – 25 Sep 2026', r.status === 200 && r.body.period.kind === 'cycle' && r.body.period.key === 'cycle-2026-09' && r.body.period.from === '2026-08-26' && r.body.period.to === '2026-09-25' && r.body.period.label === '26 Aug – 25 Sep 2026', JSON.stringify(r.body.period));
  ok('the figures come from THAT digest (an unmistakable period on the envelope)', r.body.period.from === '2026-08-26');
  for (const bad of ['2026-13', '2026-9', 'cycle-2026-13', 'cycle-26-09', 'latest', '2026-09-01', "2026-09'; drop", 'cycle-2026-09 ']) {
    r = await call({ period: bad });
    ok('bad period "' + bad + '" → 400 bad_period', r.status === 400 && r.body.error === 'bad_period', r.status + JSON.stringify(r.body));
  }
  r = await call({ period: '2026-07' });
  ok('an unpublished month → 404 period_not_published with the period and a message', r.status === 404 && r.body.error === 'period_not_published' && r.body.period.key === '2026-07' && r.body.period.from === '2026-07-01' && r.body.period.to === '2026-07-31' && /15-minute/.test(r.body.message), JSON.stringify(r.body));
  r = await call({ period: 'cycle-2026-10' });
  ok('an unpublished cycle → 404 period_not_published (25 Sep → 25 Oct named)', r.status === 404 && r.body.error === 'period_not_published' && r.body.period.key === 'cycle-2026-10' && r.body.period.from === '2026-09-26' && r.body.period.to === '2026-10-25' && /refresh/.test(r.body.message), JSON.stringify(r.body));
  ok('and no other period\'s numbers travel with that 404', !('cm' in r.body) && !('agents' in r.body));

  r = await call({});
  const p = r.body.periods;
  ok('periods.months lists the published months, newest first', p && same(p.months, ['2026-09']), JSON.stringify(p && p.months));
  ok('periods.cycles = the current and the last complete cycle', p.cycles.length === 2 && same(p.cycles.map((c) => c.key), ['cycle-2026-10', 'cycle-2026-09']), JSON.stringify(p.cycles));
  const cur = p.cycles.find((c) => c.key === 'cycle-2026-10'), last = p.cycles.find((c) => c.key === 'cycle-2026-09');
  ok('each cycle has {key, from, to, label, complete, published}', cur && last && cur.from === '2026-09-26' && cur.complete === false && last.complete === true && last.label === '26 Aug – 25 Sep 2026');
  ok('published says whether the key exists (the page offers only what exists)', last.published === true && cur.published === false, JSON.stringify([last.published, cur.published]));
  ok('cyclesNow agrees with the contract (cycle.mjs unchanged)', cyclesNow(NOW).current.key === 'cycle-2026-10' && cyclesNow(NOW).last.key === 'cycle-2026-09');

  r = await call({ period: 'cycle-2026-09', tenure: 'M1' });
  ok('period and tenure compose', r.status === 200 && r.body.cm.tenure === 'M1' && camp(r.body.cm, 'courtesy').agents === 1);
  r = await call({ period: '2026-07' }, tlUser);
  ok('a team leader asking for an unpublished period is NOT refused — params ignored, live digest served', r.status === 200 && r.body.scope === 'team');
  r = await call({ period: 'cycle-2026-09' }, agentUser);
  ok('an agent keeps the "no month filter" stance: live digest', r.status === 200 && r.body.me && r.body.me.code === 'CB1');
  r = await call({ month: '2026-09' }, tlUser);
  ok('the old ?month= still works for a team leader', r.status === 200 && r.body.scope === 'team');
  ok('resolvePeriod: pure and total', resolvePeriod({ period: '2026-02' }, NOW).to === '2026-02-28' && resolvePeriod({ period: '2028-02' }, NOW).to === '2028-02-29' && resolvePeriod({ period: 'zzz' }, NOW).error === 'bad_period');
}

/* =================================================================== R (custom range, spec 006) */
head('R · custom range: range-YYYY-MM-DD-YYYY-MM-DD (spec 006-cm-custom-range, C1–C4)');
{
  const NOW = Date.parse('2026-10-01T08:00:00Z');                         // 10:00 SAST, 1 October 2026
  const KEY = 'range-2026-09-01-2026-09-15';
  const QKEY = 'kv:cm-range-requests';
  let RG = {};
  try { RG = await import(SRC('range.mjs')); } catch (e) { ok('worker/src/range.mjs exists (the one definition of a range)', false, String(e.message).slice(0, 120)); }
  const P = await import(SRC('portal.mjs'));
  const queue = () => ((RULES[QKEY] || {}).requests || []);
  const call = async (q, user = cmUser) => {
    resetCaches(); await loadCmContext(DB, { force: true });
    try { return await overviewRequest(env, DB, user, q, { getAssist: async () => ({ requests: [] }), nowMs: NOW }); }
    catch (e) { return { status: 'threw', body: { error: String(e && e.message || e) } }; }
  };

  /* C1 — the key, its validation and its label */
  const rp = resolvePeriod({ period: KEY }, NOW);
  ok('resolvePeriod(' + KEY + ') → {kind:"range", key, from, to, label "1 – 15 Sep 2026"}',
    rp.kind === 'range' && rp.key === KEY && rp.from === '2026-09-01' && rp.to === '2026-09-15' && rp.label === '1 – 15 Sep 2026', JSON.stringify(rp));
  const lab = (k) => (resolvePeriod({ period: k }, NOW) || {}).label;
  ok('a range across a month boundary is labelled "26 Aug – 25 Sep 2026"', lab('range-2026-08-26-2026-09-25') === '26 Aug – 25 Sep 2026', lab('range-2026-08-26-2026-09-25'));
  ok('across a year boundary both years are named ("15 Dec 2025 – 10 Jan 2026")', lab('range-2025-12-15-2026-01-10') === '15 Dec 2025 – 10 Jan 2026', lab('range-2025-12-15-2026-01-10'));
  ok('a single day is one date ("1 Oct 2026")', lab('range-2026-10-01-2026-10-01') === '1 Oct 2026', lab('range-2026-10-01-2026-10-01'));
  ok('93 days exactly is allowed (30 Jun – 30 Sep)', resolvePeriod({ period: 'range-2026-06-30-2026-09-30' }, NOW).kind === 'range');
  ok('to = today (SAST) is allowed', resolvePeriod({ period: 'range-2026-09-20-2026-10-01' }, NOW).kind === 'range');
  ok('today is the SAST day: 23:30 UTC on 30 Sep is already 1 Oct', resolvePeriod({ period: 'range-2026-09-20-2026-10-01' }, Date.parse('2026-09-30T23:30:00Z')).kind === 'range'
    && resolvePeriod({ period: 'range-2026-09-20-2026-10-01' }, Date.parse('2026-09-30T21:30:00Z')).error === 'bad_period');
  ok('from = 1 January 2025 is the earliest allowed', resolvePeriod({ period: 'range-2025-01-01-2025-01-31' }, NOW).kind === 'range');
  for (const [why, bad] of [['from after to', 'range-2026-09-15-2026-09-01'], ['94 days', 'range-2026-06-29-2026-09-30'], ['to after today', 'range-2026-09-20-2026-10-02'],
    ['before 2025', 'range-2024-12-31-2025-01-10'], ['one-digit month', 'range-2026-9-01-2026-09-15'], ['one date only', 'range-2026-09-01'], ['31 September', 'range-2026-09-01-2026-09-31'],
    ['30 February', 'range-2026-02-30-2026-03-01'], ['trailing space', KEY + ' '], ['underscore', 'range-2026-09-01_2026-09-15'], ['upper case', 'RANGE-2026-09-01-2026-09-15'],
    ['injection', "range-2026-09-01-2026-09-15'; drop"]]) {
    const r = await call({ period: bad });
    ok('bad range (' + why + ') → 400 bad_period, nothing queued', r.status === 400 && r.body.error === 'bad_period' && !RULES[QKEY], r.status + JSON.stringify(r.body));
  }
  if (RG.rangeProblem) {
    ok('range.mjs rangeProblem names what is wrong in words ("" when fine)', RG.rangeProblem('2026-09-01', '2026-09-15', NOW) === ''
      && /after/i.test(RG.rangeProblem('2026-09-15', '2026-09-01', NOW)) && /93/.test(RG.rangeProblem('2026-06-29', '2026-09-30', NOW))
      && /today/i.test(RG.rangeProblem('2026-09-20', '2026-10-02', NOW)) && /2025/.test(RG.rangeProblem('2024-12-31', '2025-01-10', NOW)));
    ok('the limits are named constants (93 days, from 2025-01-01, 20 waiting, 7 days)', RG.RANGE_MAX_DAYS === 93 && RG.RANGE_MIN_FROM === '2025-01-01' && RG.RANGE_QUEUE_MAX === 20 && RG.RANGE_QUEUE_TTL_DAYS === 7 && RG.RANGE_QUEUE_KEY === QKEY);
    /* settleQueue — what the tool writes back (pure; shared with tools/digest-republish.mjs) */
    const T0 = new Date(NOW - 86400000).toISOString();
    const L = [{ key: 'range-2026-09-01-2026-09-15', from: '2026-09-01', to: '2026-09-15', by: 'ryan', at: T0, status: 'waiting' },
      { key: 'range-2026-09-16-2026-09-20', from: '2026-09-16', to: '2026-09-20', by: 'ryan', at: T0, status: 'refused', reason: 'old reason', statusAt: T0 },
      { key: 'range-2026-08-01-2026-08-02', from: '2026-08-01', to: '2026-08-02', by: 'ryan', at: new Date(NOW - 9 * 86400000).toISOString(), status: 'waiting' },
      { key: 'range-2026-09-21-2026-09-22', from: '2026-09-21', to: '2026-09-22', by: 'dalwin', at: T0, status: 'waiting' }];
    const S2 = RG.settleQueue(L, [{ key: 'range-2026-09-01-2026-09-15', status: 'built' }, { key: 'range-2026-09-16-2026-09-20', status: 'built' },
      { key: 'range-2026-09-21-2026-09-22', status: 'refused', reason: 'x'.repeat(500) }, { key: 'range-2026-01-01-2026-01-02', status: 'built' }], NOW);
    const g = (k) => S2.find((e) => e.key === k);
    ok('settleQueue: built → status "built" + statusAt, the request (by, at) kept', g('range-2026-09-01-2026-09-15').status === 'built' && g('range-2026-09-01-2026-09-15').statusAt === new Date(NOW).toISOString() && g('range-2026-09-01-2026-09-15').by === 'ryan' && g('range-2026-09-01-2026-09-15').at === T0);
    ok('settleQueue: a refused range that now builds loses its old reason', g('range-2026-09-16-2026-09-20').status === 'built' && !('reason' in g('range-2026-09-16-2026-09-20')));
    ok('settleQueue: refused → status "refused" + the reason (capped at 300 characters)', g('range-2026-09-21-2026-09-22').status === 'refused' && g('range-2026-09-21-2026-09-22').reason.length === 300);
    ok('settleQueue: an expired request is dropped, and a result for a request no longer queued is not re-added', !g('range-2026-08-01-2026-08-02') && !g('range-2026-01-01-2026-01-02') && S2.length === 3);
    ok('settleQueue does not change the list it was given (a new list back)', L[0].status === 'waiting' && L[1].reason === 'old reason');
    const rq = RG.enqueueRange([{ key: KEY, from: '2026-09-01', to: '2026-09-15', by: 'ryan', at: T0, status: 'built', statusAt: T0 }], { key: KEY, from: '2026-09-01', to: '2026-09-15', by: 'dalwin' }, NOW);
    ok('enqueueRange: a "built" range whose digest is missing is queued again (waiting, asked now)', rq.state === 'queued' && rq.changed && rq.list.length === 1 && rq.list[0].status === 'waiting' && rq.list[0].at === new Date(NOW).toISOString());
    /* review finding 3: a refusal is not for ever — the missing days may land later */
    const refusedAt = (ms) => [{ key: KEY, from: '2026-09-01', to: '2026-09-15', by: 'ryan', at: new Date(NOW - 3 * 86400000).toISOString(), status: 'refused', reason: 'no rows', statusAt: new Date(NOW - ms).toISOString() }];
    const old1 = RG.enqueueRange(refusedAt(25 * 3600000), { key: KEY, from: '2026-09-01', to: '2026-09-15', by: 'dalwin' }, NOW);
    ok('enqueueRange: a range refused MORE than a day ago is queued again when asked (waiting, asked now, reason dropped, still one entry)', RG.RANGE_REFUSED_RETRY_DAYS === 1 && old1.state === 'queued' && old1.changed
      && old1.list.length === 1 && old1.list[0].status === 'waiting' && old1.list[0].at === new Date(NOW).toISOString() && !('reason' in old1.list[0]), JSON.stringify(old1));
    const new1 = RG.enqueueRange(refusedAt(12 * 3600000), { key: KEY, from: '2026-09-01', to: '2026-09-15', by: 'dalwin' }, NOW);
    ok('…a range refused LESS than a day ago still answers refused (no write)', new1.state === 'refused' && !new1.changed && new1.entry.reason === 'no rows');
    ok('queueList reads anything malformed as an empty queue', RG.queueList(null).length === 0 && RG.queueList({ requests: 'x' }).length === 0 && RG.queueList({ requests: [null, { key: 1 }, { key: KEY }] }).length === 1);
  }

  /* C2 — an unbuilt range is queued once and says so */
  await setup();
  publish('kv:agent-digest', { ...DIGEST(), period: { from: '2026-10-01', to: '2026-10-31' }, marker: 'live' });
  let r = await call({ period: KEY });
  ok('an unbuilt range → 404 range_building with the period and a "being built … 15 minutes" message', r.status === 404 && r.body.error === 'range_building'
    && same(r.body.period, { key: KEY, from: '2026-09-01', to: '2026-09-15', label: '1 – 15 Sep 2026' }) && /being built/.test(r.body.message || '') && /15 minutes/.test(r.body.message || ''), r.status + JSON.stringify(r.body));
  ok('…and no numbers travel with it', !('cm' in r.body) && !('agents' in r.body));
  ok('the request is queued in kv:cm-range-requests: {key, from, to, by, at, status:"waiting"}', queue().length === 1 && queue()[0].key === KEY && queue()[0].from === '2026-09-01' && queue()[0].to === '2026-09-15'
    && queue()[0].by === 'ryan' && queue()[0].at === new Date(NOW).toISOString() && queue()[0].status === 'waiting', JSON.stringify(RULES[QKEY]));
  r = await call({ period: KEY });
  ok('asking again → still building, still ONE entry (deduped by key)', r.status === 404 && r.body.error === 'range_building' && queue().length === 1, JSON.stringify(queue()));
  r = await call({ period: KEY }, { username: 'dalwin', full_name: 'Dalwin', role: 'campaign_manager', cb: '' });
  ok('a second manager asking the same range → still ONE entry (the first asker kept)', r.status === 404 && queue().length === 1 && queue()[0].by === 'ryan', JSON.stringify(queue()));
  r = await call({ period: 'range-2026-09-16-2026-09-30' });
  ok('a different range is its own entry', queue().length === 2 && queue()[1].key === 'range-2026-09-16-2026-09-30');
  /* a refused build says why */
  RULES[QKEY] = { v: 1, requests: queue().map((e) => (e.key === KEY ? { ...e, status: 'refused', reason: 'There are no figures for 1 – 15 Sep 2026 — nothing was uploaded for those days.', statusAt: new Date(NOW).toISOString() } : e)) };
  STAMP[QKEY] = '2026-10-01T08:00:00.500Z';
  const writesBefore = QUEUE_WRITES;
  r = await call({ period: KEY });
  ok('a range the engine refused → 404 range_refused with the period and the reason', r.status === 404 && r.body.error === 'range_refused' && r.body.period && r.body.period.key === KEY
    && /no figures/.test(r.body.reason || ''), r.status + JSON.stringify(r.body));
  ok('…and it is not queued again (no write)', QUEUE_WRITES === writesBefore && queue().filter((e) => e.key === KEY).length === 1);
  /* review finding 3, end to end: refused two days ago → asking again re-queues it (still one entry) */
  RULES[QKEY] = { v: 1, requests: queue().map((e) => (e.key === KEY ? { ...e, statusAt: new Date(NOW - 2 * 86400000).toISOString() } : e)) };
  STAMP[QKEY] = '2026-10-01T08:00:00.600Z';
  r = await call({ period: KEY });
  ok('a range refused more than a day ago, asked again → 404 range_building and its ONE entry is waiting again', r.status === 404 && r.body.error === 'range_building'
    && queue().filter((e) => e.key === KEY).length === 1 && queue().find((e) => e.key === KEY).status === 'waiting', r.status + JSON.stringify(queue()));
  /* bounded: entries older than 7 days are dropped, at most 20 waiting */
  await setup(); publish('kv:agent-digest', { ...DIGEST(), period: { from: '2026-10-01', to: '2026-10-31' } });
  const old = new Date(NOW - 8 * 86400000).toISOString(), recent = new Date(NOW - 86400000).toISOString();
  RULES[QKEY] = { v: 1, requests: [{ key: 'range-2026-08-01-2026-08-10', from: '2026-08-01', to: '2026-08-10', by: 'ryan', at: old, status: 'waiting' },
    { key: 'range-2026-08-11-2026-08-20', from: '2026-08-11', to: '2026-08-20', by: 'ryan', at: recent, status: 'built', statusAt: recent }] };
  STAMP[QKEY] = '2026-09-30T08:00:00.000Z';
  r = await call({ period: KEY });
  ok('a request older than 7 days is dropped when the queue is next written; a recent one is kept', r.status === 404 && same(queue().map((e) => e.key), ['range-2026-08-11-2026-08-20', KEY]), JSON.stringify(queue().map((e) => e.key)));
  ok('the write is a compare-and-set on updated_at (the stamp moved on)', STAMP[QKEY] !== '2026-09-30T08:00:00.000Z');
  await setup(); publish('kv:agent-digest', { ...DIGEST(), period: { from: '2026-10-01', to: '2026-10-31' } });
  const twenty = Array.from({ length: 20 }, (_, i) => { const d = String(i + 1).padStart(2, '0'); return { key: 'range-2026-08-' + d + '-2026-08-' + d, from: '2026-08-' + d, to: '2026-08-' + d, by: 'ryan', at: recent, status: 'waiting' }; });
  RULES[QKEY] = { v: 1, requests: twenty }; STAMP[QKEY] = '2026-09-30T08:00:00.000Z';
  r = await call({ period: KEY });
  ok('with 20 ranges already waiting a 21st is refused (429 range_queue_full, with a message) and not queued', r.status === 429 && r.body.error === 'range_queue_full' && /try again/i.test(r.body.message || '') && queue().length === 20, r.status + JSON.stringify(r.body));
  r = await call({ period: twenty[0].key });
  ok('…but a range already waiting still answers "being built"', r.status === 404 && r.body.error === 'range_building');
  /* a write race: somebody else moved the row between the read and the write — the request is not lost */
  await setup(); publish('kv:agent-digest', { ...DIGEST(), period: { from: '2026-10-01', to: '2026-10-31' } });
  RULES[QKEY] = { v: 1, requests: [] }; STAMP[QKEY] = 'v1';
  const realUR = DB.updateReturning; let raced = false;
  DB.updateReturning = async (q, patch) => { if (!raced) { raced = true; RULES[QKEY] = { v: 1, requests: [{ key: 'range-2026-08-01-2026-08-02', from: '2026-08-01', to: '2026-08-02', by: 'dalwin', at: recent, status: 'waiting' }] }; STAMP[QKEY] = 'v2'; return []; } return realUR(q, patch); };
  r = await call({ period: KEY });
  DB.updateReturning = realUR;
  ok('a lost compare-and-set re-reads and retries: BOTH the other writer\'s entry and this one survive', r.status === 404 && same(queue().map((e) => e.key), ['range-2026-08-01-2026-08-02', KEY]), JSON.stringify(queue()));

  /* C3 — a built range is served, labelled, and listed */
  await setup();
  publish('kv:agent-digest', { ...DIGEST(), period: { from: '2026-10-01', to: '2026-10-31' }, marker: 'live' });
  publish('kv:agent-digest-2026-09', { ...DIGEST(), marker: 'month' });
  const built = { ...DIGEST(), marker: 'range', period: { from: '2026-09-01', to: '2026-09-15', kind: 'range', key: KEY, label: '1 – 15 Sep 2026' }, updatedAt: new Date(NOW - 30 * 3600000).toISOString() };
  built.agents = built.agents.map((a) => ({ ...a, sales: a.sales + 1000 }));      // unmistakable range figures
  publish('kv:agent-digest-' + KEY, built);
  publish('kv:agent-digest-range-2026-09-20-2026-10-01', { ...DIGEST(), marker: 'filling', period: { from: '2026-09-20', to: '2026-10-01', kind: 'range' }, updatedAt: new Date(NOW - 30 * 3600000).toISOString() });
  r = await call({ period: KEY });
  ok('a built range → 200, period {kind:"range", key, from, to, label}', r.status === 200 && r.body.period && r.body.period.kind === 'range' && r.body.period.key === KEY && r.body.period.from === '2026-09-01' && r.body.period.to === '2026-09-15' && r.body.period.label === '1 – 15 Sep 2026', r.status + JSON.stringify(r.body.period || r.body));
  ok('…the figures are THAT digest\'s (the engine\'s, served — Courtesy sales 3060)', r.status === 200 && camp(r.body.cm, 'courtesy').kpis.sales.v === 3060, r.status === 200 ? JSON.stringify(camp(r.body.cm, 'courtesy').kpis.sales) : '');
  ok('…and asking for a built range writes nothing to the queue', !RULES[QKEY]);
  const pr = r.body.periods || {};
  ok('periods.ranges lists the built ranges {key, from, to, label}, newest end first', Array.isArray(pr.ranges) && same(pr.ranges, [
    { key: 'range-2026-09-20-2026-10-01', from: '2026-09-20', to: '2026-10-01', label: '20 Sep – 1 Oct 2026' }, { key: KEY, from: '2026-09-01', to: '2026-09-15', label: '1 – 15 Sep 2026' }]), JSON.stringify(pr.ranges));
  ok('periods.months still lists months only (no range key leaks in), cycles unchanged', same(pr.months, ['2026-09']) && Array.isArray(pr.cycles) && pr.cycles.length === 2, JSON.stringify(pr));
  ok('a closed range published 30 h ago is a closed period (not "Waiting on new data")', r.status === 200 && r.body.cm.freshness.stale === false && /Closed period/.test(r.body.cm.freshness.label), r.status === 200 ? JSON.stringify(r.body.cm.freshness) : '');
  r = await call({ period: 'range-2026-09-20-2026-10-01' });
  ok('a range still FILLING (ends today) is rebuilt each run, so its band is age-based like the live month (30 h → "Waiting on new data")', r.status === 200 && r.body.cm.freshness.stale === true && !/Closed period/.test(r.body.cm.freshness.label), r.status === 200 ? JSON.stringify(r.body.cm.freshness) : JSON.stringify(r.body));
  r = await call({ period: KEY, tenure: 'M1' });
  ok('range and tenure compose', r.status === 200 && r.body.cm.tenure === 'M1' && camp(r.body.cm, 'courtesy').agents === 1);

  /* only campaign managers */
  await setup(); publish('kv:agent-digest', { ...DIGEST(), period: { from: '2026-10-01', to: '2026-10-31' }, marker: 'live' });
  r = await call({ period: KEY }, tlUser);
  ok('a team leader asking for a range: param ignored, live digest served, NOTHING queued', r.status === 200 && r.body.scope === 'team' && !RULES[QKEY], r.status + JSON.stringify(r.body).slice(0, 100));
  r = await call({ period: KEY }, agentUser);
  ok('an agent asking for a range: live digest, nothing queued', r.status === 200 && r.body.me && r.body.me.code === 'CB1' && !RULES[QKEY]);

  /* C4 — the range's Variance and Lead management reports */
  await setup();
  publish('kv:agent-digest', { ...DIGEST(), period: { from: '2026-10-01', to: '2026-10-31' } });
  const rep = (marker, period) => ({ v: 1, kind: 'variance', updatedAt: new Date(NOW).toISOString(), period, marker,
    agents: { CB1: { rows: 1 }, CB4: { rows: 2 }, CB9: { rows: 9 } }, teams: { 'Denise Haripersad': { agents: 3 } },
    teamsByCamp: { 'Courtesy|Denise Haripersad': { camp: 'Courtesy', tl: 'Denise Haripersad', agents: 3 }, 'Rewarded|Olivia Outside': { camp: 'Rewarded', tl: 'Olivia Outside', agents: 1 } },
    campaigns: { Courtesy: { camp: 'Courtesy', agents: 3 }, Rewarded: { camp: 'Rewarded', agents: 1 } } });
  publish('kv:agent-reports-variance', rep('live', { from: '2026-10-01', to: '2026-10-01' }));
  publish('kv:agent-digest-' + KEY, { ...DIGEST(), period: { from: '2026-09-01', to: '2026-09-15', kind: 'range' } });
  publish('kv:agent-reports-variance-' + KEY, rep('range', { from: '2026-09-01', to: '2026-09-15' }));
  const ask = async (user, q) => { resetCaches(); await loadCmContext(DB, { force: true });
    if (typeof P.reportsRequest !== 'function') return { status: 'missing', body: { error: 'portal.mjs has no reportsRequest' } };
    try { return await P.reportsRequest(DB, user, q, NOW); } catch (e) { return { status: 'threw', body: { error: String(e && e.message || e) } }; } };
  r = await ask(cmUser, { kind: 'variance', period: KEY });
  ok('tl/reports?kind=variance&period=range-… → the RANGE\'s report (kv:agent-reports-variance-range-…), sliced to the manager', r.status === 200 && r.body.marker === 'range' && r.body.period.from === '2026-09-01'
    && r.body.scope === 'campaign' && same(Object.keys(r.body.campaigns), ['Courtesy']) && !('Rewarded|Olivia Outside' in r.body.teamsByCamp), r.status + JSON.stringify(r.body).slice(0, 200));
  r = await ask(cmUser, { kind: 'variance' });
  ok('…no period = the live report, as before', r.status === 200 && r.body.marker === 'live', r.status + JSON.stringify(r.body).slice(0, 120));
  r = await ask(cmUser, { kind: 'variance', period: 'current' });
  ok('…"current" = the live report too', r.status === 200 && r.body.marker === 'live');
  r = await ask(cmUser, { kind: 'leads', period: KEY });
  ok('a built range with no Lead management report → 404 that says the engine built none for those days', r.status === 404 && /Lead management/.test(r.body.message || r.body.error || '') && /1 – 15 Sep 2026/.test(r.body.message || r.body.error || ''), r.status + JSON.stringify(r.body));
  r = await ask(cmUser, { kind: 'variance', period: 'range-2026-09-16-2026-09-30' });
  ok('an unbuilt range → 404 range_building (the overview is what queues it)', r.status === 404 && r.body.error === 'range_building' && r.body.period && r.body.period.key === 'range-2026-09-16-2026-09-30' && !RULES[QKEY], r.status + JSON.stringify(r.body));
  r = await ask(cmUser, { kind: 'variance', period: 'range-2026-09-15-2026-09-01' });
  ok('a bad range → 400 bad_period', r.status === 400 && r.body.error === 'bad_period', r.status + JSON.stringify(r.body));
  r = await ask(cmUser, { kind: 'nonsense', period: KEY });
  ok('a bad kind → 400', r.status === 400, String(r.status));
  r = await ask(tlUser, { kind: 'variance', period: KEY });
  ok('a team leader asking for a range report → 403 (custom ranges are the campaign manager\'s)', r.status === 403, r.status + JSON.stringify(r.body));
  r = await ask(agentUser, { kind: 'variance', period: KEY });
  ok('an agent → 403', r.status === 403, String(r.status));
  r = await ask(tlUser, { kind: 'variance' });
  ok('a team leader\'s own live report is unchanged (200, their team)', r.status === 200 && r.body.scope === 'team' && r.body.marker === 'live', r.status + JSON.stringify(r.body).slice(0, 120));
  if (typeof P.loadReports === 'function') {
    resetCaches();
    ok('loadReports(DB, kind, rangeKey) reads kv:agent-reports-<kind>-<rangeKey>', ((await P.loadReports(DB, 'variance', KEY)) || {}).marker === 'range');
    ok('…and refuses anything that is not a range key (no path games)', (await P.loadReports(DB, 'variance', '../vas-state')) === null && (await P.loadReports(DB, 'variance', 'cycle-2026-09')) === null);
  }
  const IDX = fs.readFileSync(path.join(ROOT, 'worker', 'src', 'index.mjs'), 'utf8');
  ok('index.mjs: the tl/reports route hands ?period= to reportsRequest', /\/api\/portal\/tl\/reports[\s\S]{0,600}reportsRequest\(DB, user, \{[^}]*period:\s*url\.searchParams\.get\('period'\)/.test(IDX));
}

/* =================================================================== E */
head('E · CM report data: agents, tlAgg, campAgg + the envelope');
{
  await setup();
  const d = DIGEST();
  const r = await overview(env, DB, cmUser, d, [], { assist: { requests: [] }, tenure: 'all' });
  const B = r.body;
  ok('agents = the digest rows of the manager\'s campaigns only (no Rewarded)', B.agents && B.agents.every((a) => ['Courtesy', 'Cuddle'].includes(a.campaign)) && !B.agents.some((a) => a.code === 'CB9') && B.agents.filter((a) => a.covered).length === 5, JSON.stringify((B.agents || []).map((a) => a.code)));
  ok('the row shape is the team-scope shape: whole digest rows, covered flag, days[]', B.agents[0].covered === true && 'days' in B.agents[0] && 'composite' in B.agents[0] && 'closed' in B.agents[0]);
  ok('sorted like the team overview (premium written, biggest first)', B.agents.filter((a) => a.covered).every((a, i, arr) => i === 0 || (arr[i - 1].gwpEx || 0) >= (a.gwpEx || 0)));
  ok('tlAgg = the leaders\' blocks of the manager\'s campaigns', Array.isArray(B.tlAgg) && same(B.tlAgg.map((t) => t.camp).sort(), ['Courtesy', 'Cuddle']), JSON.stringify(B.tlAgg));
  ok('campAgg = the digest\'s own campaign blocks, only the manager\'s campaigns', B.campAgg && same(Object.keys(B.campAgg).sort(), ['Courtesy', 'Cuddle']), JSON.stringify(B.campAgg && Object.keys(B.campAgg)));
  ok('summary is the team-scope shape over the same blocks ({onTarget, talkUnit, teams, campaigns}) so the same renderers read it', B.summary && B.summary.teams.length === 2 && Object.keys(B.summary.campaigns).length === 2 && B.summary.talkUnit === 'hours');
  ok('the envelope travels: weeks, dates, workingDays, diallingDays, talkUnit', Array.isArray(B.weeks) && B.dates.length === 2 && B.workingDays === 21 && B.diallingDays === 20 && B.talkUnit === 'hours');
  const t = await overview(env, DB, cmUser, d, [], { assist: { requests: [] }, tenure: 'Exp' });
  ok('agents follow the tenure (Exp: CB2 and CB4) — rows filtered before anything else', same(t.body.agents.filter((a) => a.covered).map((a) => a.code).sort(), ['CB2', 'CB4']), JSON.stringify(t.body.agents.map((a) => a.code)));
  ok('tlAgg and campAgg are the engine\'s whole-period blocks and are not re-cut by tenure (nothing is summed in the Worker)', t.body.tlAgg.length === 2);
  const old = DIGEST(); delete old.tlAgg; delete old.campAgg;
  const o = await overview(env, DB, cmUser, old, [], { assist: { requests: [] } });
  ok('a digest older than the blocks → tlAgg/campAgg are null (absent is not empty)', o.body.tlAgg === null && o.body.campAgg === null && o.body.summary === null);
  const ag = await overview(env, DB, agentUser, d, []);
  ok('an agent\'s payload carries none of it', !('tlAgg' in ag.body) && !('campAgg' in ag.body) && !('cm' in ag.body));
}

/* =================================================================== C */
head('C · team leaders\' coaching: GET /api/portal/cm-coaching');
{
  await setup();
  const live = DIGEST();
  live.agents.push(mk('CB11', 'Mixed Courtesy', 'Courtesy', 'M1', 'Mixed Leader'), mk('CB12', 'Mixed Out', 'Rewarded', 'M1', 'Mixed Leader'));   // a leader on TWO campaigns, one of them not the manager's
  const DENISE_HUB = 'jx7ad7sm95xg4738eg5a0479558c9z0x';
  const ses = (id, date, tlId, tlName, o = {}) => ({ id, type: 'Formal Coaching', collection: 'formalCoachingCalls', typeLabel: 'Formal Coaching', date, cb: 'CB1', agentName: 'Courtesy One',
    campaign: 'Courtesy', hubTeamLeader: tlName, hubTeamLeaderId: tlId, clusters: [{ clusterKey: 'gap.customer_verification', family: 'gap', field: 'clusterGap' }], supportProvided: 'Role play the verification', ...o });
  const sessions = [
    ses('d1', '2026-09-24', DENISE_HUB, 'Denise Haripersad'),
    ses('d2', '2026-09-10', DENISE_HUB, 'Denise Haripersad', { cb: 'CB999', agentName: 'Not On List' }),                       // a CB outside the manager's agents: DROPPED (review L1)
    ses('d6', '2026-09-05', DENISE_HUB, 'Denise Haripersad', { cb: '', agentName: 'Courtesy Two' }),                            // no CB: kept only because EVERY agent of Denise is in the manager's campaigns
    ses('m1', '2026-09-11', 'mix-hub', 'Mixed Leader', { cb: 'CB11', agentName: 'Mixed Courtesy' }),
    ses('m2', '2026-09-12', 'mix-hub', 'Mixed Leader', { cb: 'CB12', agentName: 'Mixed Out', supportProvided: 'LEAK-NOTE', campaign: 'Rewarded' }),
    ses('m3', '2026-09-13', 'mix-hub', 'Mixed Leader', { cb: '', agentName: 'Whoever', supportProvided: 'LEAK-NOTE-2' }),
    ses('m4', '2026-09-14', 'mix-hub', 'Mixed Leader', { cb: '', agentName: 'Mixed Out', attendees: ['Mixed Out'], supportProvided: 'LEAK-NOTE-3' }),
    ses('d3', '2026-09-30', DENISE_HUB, 'Denise Haripersad', { cb: '', agentName: 'Group Session', attendees: ['Courtesy One', 'Outside One'], clusters: [{ clusterKey: 'purpose.process_refresher', family: 'purpose', field: 'clusterPurpose' }, { clusterKey: 'gap.call_process_systems', family: 'gap', field: 'clusterGap' }], supportProvided: undefined }),
    ses('d4', '2026-08-20', DENISE_HUB, 'Denise Haripersad'),                                                                     // before September
    ses('r1', '2026-09-12', 'ren-hub', 'Renolan Pillay', { cb: 'CB4', agentName: 'Cuddle One', campaign: 'Cuddle' }),            // Renolan has no hub id on his account: matched by NAME
    ses('o1', '2026-09-12', 'olivia-id', 'Olivia Outside', { cb: 'CB9', agentName: 'Outside One' }),
  ];
  const snapshot = { fetchedAt: '2026-10-01T06:00:00.000Z', hub: 'x', leaders: [{ id: DENISE_HUB, name: 'Denise Haripersad' }, { id: 'ren-hub', name: 'Renolan Pillay' }, { id: 'olivia-id', name: 'Olivia Outside' }, { id: 'mix-hub', name: 'Mixed Leader' }], sessions, errors: [], by: 'test' };
  publish('kv:coaching', snapshot); RULES['kv:coaching'].fetchedAt = snapshot.fetchedAt;
  publish('kv:agent-digest', live);
  const NOW = Date.parse('2026-10-01T08:00:00Z');
  const ask = async (user, q) => { resetCaches(); await loadCmContext(DB, { force: true }); const dg = JSON.parse(STORE['raw/kv/agent-digest']); return cmCoaching(env, DB, user, dg, q, NOW); };
  /* the live digest above is September; "current" = the digest's own month */

  let r = await ask(cmUser, { tl: 'Denise Haripersad', period: 'current' });
  ok('the manager gets 200', r.status === 200, r.status + JSON.stringify(r.body).slice(0, 160));
  const B = r.body;
  ok('contract fields: fetchedAt, stale, ageHours, hubUrl, period, leaders, tl, sessions', ['fetchedAt', 'stale', 'ageHours', 'hubUrl', 'period', 'leaders', 'tl', 'sessions'].every((k) => k in B));
  ok('hubUrl is the Coaching Hub', B.hubUrl === 'https://coaching-hub-psi.vercel.app/');
  ok('copy age: fetchedAt echoed, ageHours 2, not stale', B.fetchedAt === snapshot.fetchedAt && B.ageHours === 2 && B.stale === false, JSON.stringify([B.fetchedAt, B.ageHours, B.stale]));
  ok('period {from,to,label} is September 2026', B.period.from === '2026-09-01' && B.period.to === '2026-09-30' && /September 2026/.test(B.period.label), JSON.stringify(B.period));
  ok('Denise (Courtesy, hub id jx7ad…) is in scope and her sessions come back: 3 inside September (the out-of-scope CB dropped), newest first',
    B.tl === 'Denise Haripersad' && B.sessions.length === 3 && same(B.sessions.map((s) => s.date), ['2026-09-30', '2026-09-24', '2026-09-05']), JSON.stringify(B.sessions.map((s) => s.date)));
  const s1 = B.sessions.find((s) => s.date === '2026-09-24');
  ok('session fields: date, agentName, cb, onList, type, themes[], supportProvided', s1 && s1.agentName === 'Courtesy One' && s1.cb === 'CB1' && s1.onList === true && s1.type === 'Formal Coaching' && same(s1.themes, ['Customer Verification']) && s1.supportProvided === 'Role play the verification', JSON.stringify(s1));
  const s3 = B.sessions.find((s) => s.date === '2026-09-30');
  ok('L1: a session whose CB is not one of the manager\'s agents is DROPPED (CB999)', !B.sessions.some((s) => s.cb === 'CB999') && !JSON.stringify(B).includes('Not On List'));
  ok('every CB session that remains is onList', B.sessions.filter((s) => s.cb).every((s) => s.onList === true));
  ok('a session with no CB is kept when every agent of that leader is in the manager\'s campaigns', B.sessions.some((s) => s.date === '2026-09-05' && s.cb === null && s.agentName === 'Courtesy Two'));
  ok('a group session: cb null, no support text → null, every theme labelled', s3 && s3.cb === null && s3.onList === false && s3.supportProvided === null && same(s3.themes, ['Process Refresher', 'Call Process Systems']) && s3.agentName === 'Courtesy One', JSON.stringify(s3));
  ok('L1: a group session shows only its IN-SCOPE attendees (the Rewarded attendee never travels)', !JSON.stringify(B).includes('Outside One'));
  ok('no attendee list or signature travels', !JSON.stringify(B).includes('attendees') && !JSON.stringify(B).includes('data:image'));

  ok('leaders = every in-scope team leader with campaign, sessions, agentsCoached, last',
    B.leaders.length === 3 && same(B.leaders.map((l) => l.name).sort(), ['Denise Haripersad', 'Mixed Leader', 'Renolan Pillay']), JSON.stringify(B.leaders));
  const den = B.leaders.find((l) => l.name === 'Denise Haripersad'), ren = B.leaders.find((l) => l.name === 'Renolan Pillay');
  ok('Denise: campaign Courtesy, 3 sessions, 2 agents coached (CB1, CB2 — names resolved to codes), last 2026-09-30', den.campaign === 'Courtesy' && den.sessions === 3 && den.agentsCoached === 2 && den.last === '2026-09-30', JSON.stringify(den));
  ok('Renolan (no hub id on his account) is matched by the hub\'s team-leader NAME: Cuddle, 1 session', ren.campaign === 'Cuddle' && ren.sessions === 1 && ren.last === '2026-09-12', JSON.stringify(ren));
  ok('Olivia (Rewarded — not this manager\'s campaign) is NOT a leader in scope', !B.leaders.some((l) => /Olivia/.test(l.name)));

  /* L1: a leader on two campaigns must not leak the other campaign's notes */
  r = await ask(cmUser, { tl: 'Mixed Leader' });
  ok('L1: the cross-campaign leader returns ONLY the session of an agent in the manager\'s campaigns', r.status === 200 && same(r.body.sessions.map((x) => x.date), ['2026-09-11']) && r.body.sessions[0].cb === 'CB11', JSON.stringify(r.body.sessions));
  ok('L1: no note, name or CB from the other campaign (or from an unattributable session) travels', !/LEAK-NOTE|Mixed Out|CB12|Whoever/.test(JSON.stringify(r.body)), JSON.stringify(r.body).slice(0, 300));
  const mixRow = r.body.leaders.find((l) => l.name === 'Mixed Leader');
  ok('L1: the leaders[] counts follow the same filter (1 session, 1 agent, last 2026-09-11)', mixRow.sessions === 1 && mixRow.agentsCoached === 1 && mixRow.last === '2026-09-11', JSON.stringify(mixRow));
  ok('L1: Denise\'s row counts only what the manager may see too (no CB999)', r.body.leaders.find((l) => l.name === 'Denise Haripersad').sessions === 3);

  /* review 1: a leader whose pairs failed is not "0 sessions, fresh" */
  publish('kv:coaching', { ...snapshot, incomplete: true, failedLeaders: [{ id: DENISE_HUB, name: 'Denise Haripersad' }] }); RULES['kv:coaching'].fetchedAt = snapshot.fetchedAt;
  r = await ask(cmUser, { tl: 'Denise Haripersad' });
  ok('an incomplete copy: stale TRUE for the leader whose pairs failed, and incomplete names them', r.body.stale === true && same(r.body.incomplete, ['Denise Haripersad']), JSON.stringify([r.body.stale, r.body.incomplete]));
  ok('...flagged on her row, not on the others', r.body.leaders.find((l) => l.name === 'Denise Haripersad').incomplete === true && r.body.leaders.find((l) => l.name === 'Renolan Pillay').incomplete === false);
  r = await ask(cmUser, { tl: 'Renolan Pillay' });
  ok('a leader whose pairs did NOT fail keeps stale:false on the same copy', r.body.stale === false && same(r.body.incomplete, ['Denise Haripersad']));
  publish('kv:coaching', snapshot); RULES['kv:coaching'].fetchedAt = snapshot.fetchedAt;
  r = await ask(cmUser, { tl: 'Denise Haripersad' });
  ok('a complete copy: incomplete is an empty list', same(r.body.incomplete, []) && r.body.stale === false);

  r = await ask(cmUser, { tl: 'Olivia Outside' });
  ok('an out-of-scope team leader → 404, server-enforced', r.status === 404, r.status + JSON.stringify(r.body));
  r = await ask(cmUser, { tl: 'Nobody Atall' });
  ok('an unknown name → 404 as well (no existence oracle)', r.status === 404);
  r = await ask(cmUser, { tl: 'renolan   pillay' });
  ok('the name is matched on its normalised form (case, spaces)', r.status === 200 && r.body.tl === 'Renolan Pillay' && r.body.sessions.length === 1);
  r = await ask(cmUser, {});
  ok('no tl: the leader table only — tl null, no sessions', r.status === 200 && r.body.tl === null && same(r.body.sessions, []) && r.body.leaders.length === 3);
  r = await ask(cmUser, { tl: 'Denise Haripersad', period: '2026-08' });
  ok('a past month: August has only the 20 Aug session', r.status === 200 && same(r.body.sessions.map((s) => s.date), ['2026-08-20']) && r.body.period.from === '2026-08-01' && r.body.period.to === '2026-08-31', JSON.stringify(r.body.sessions.map((s) => s.date)));
  r = await ask(cmUser, { tl: 'Denise Haripersad', period: 'cycle-2026-09' });
  ok('a billing month: 26 Aug – 25 Sep takes the 5th and the 24th, not the 30th', same(r.body.sessions.map((s) => s.date), ['2026-09-24', '2026-09-05']) && r.body.period.label === '26 Aug – 25 Sep 2026', JSON.stringify(r.body.sessions.map((s) => s.date)));
  r = await ask(cmUser, { tl: 'Denise Haripersad', period: 'bogus' });
  ok('a bad period → 400 bad_period', r.status === 400 && r.body.error === 'bad_period');
  /* spec 006: coaching follows a custom range — the sessions inside it, labelled with its dates */
  r = await ask(cmUser, { tl: 'Denise Haripersad', period: 'range-2026-09-05-2026-09-24' });
  ok('a custom range (5 – 24 Sep): the 5th and the 24th, not the 30th, labelled "5 – 24 Sep 2026"', r.status === 200 && same(r.body.sessions.map((s) => s.date), ['2026-09-24', '2026-09-05']) && r.body.period.label === '5 – 24 Sep 2026' && r.body.period.from === '2026-09-05' && r.body.period.to === '2026-09-24', r.status + ' ' + JSON.stringify(r.body.period || r.body));
  r = await ask(cmUser, { tl: 'Denise Haripersad', period: 'range-2026-09-24-2026-09-05' });
  ok('a backwards custom range → 400 bad_period', r.status === 400 && r.body.error === 'bad_period', r.status + JSON.stringify(r.body));

  for (const [who, u] of [['an agent', agentUser], ['a team leader', tlUser], ['an admin', adminUser]]) {
    r = await ask(u, { tl: 'Denise Haripersad' });
    ok(who + ' is refused (403)', r.status === 403, String(r.status));
  }
  /* a manager with a narrower assignment only sees those campaigns' leaders */
  await setup(); publish('kv:agent-digest', live); publish('kv:coaching', snapshot); RULES['kv:coaching'].fetchedAt = snapshot.fetchedAt;
  RULES['cm:assignments'] = { ryan: { name: 'Ryan G', campaigns: ['cuddle'] } };
  r = await ask(cmUser, { tl: 'Denise Haripersad' });
  ok('narrow the assignment to Cuddle and Denise (Courtesy) is out of scope → 404', r.status === 404);
  r = await ask(cmUser, {});
  ok('...and only Renolan is a leader', same(r.body.leaders.map((l) => l.name), ['Renolan Pillay']));

  /* more than 300 sessions: capped, newest first */
  await setup(); publish('kv:agent-digest', live);
  const many = Array.from({ length: 350 }, (_, i) => ses('m' + i, '2026-09-' + String(1 + (i % 28)).padStart(2, '0'), DENISE_HUB, 'Denise Haripersad'));
  publish('kv:coaching', { ...snapshot, sessions: many }); RULES['kv:coaching'].fetchedAt = snapshot.fetchedAt;
  r = await ask(cmUser, { tl: 'Denise Haripersad' });
  ok('at most 300 sessions, newest first', r.body.sessions.length === 300 && r.body.sessions[0].date >= r.body.sessions[299].date);
  ok('...while the leader row still counts all 350', r.body.leaders.find((l) => l.name === 'Denise Haripersad').sessions === 350);
  /* stale copy */
  await setup(); publish('kv:agent-digest', live); publish('kv:coaching', { ...snapshot, fetchedAt: '2026-09-21T14:43:00.000Z' });
  r = await ask(cmUser, { tl: 'Denise Haripersad' });
  ok('a copy from 21 Sep is stale with its real age (≈ 233 h)', r.body.stale === true && r.body.ageHours > 200, JSON.stringify([r.body.stale, r.body.ageHours]));
  /* no snapshot */
  await setup(); publish('kv:agent-digest', live);
  r = await ask(cmUser, { tl: 'Denise Haripersad' });
  ok('no Hub copy at all: a 503 that says so — never an empty list that reads as "no coaching"', r.status === 503 && /coaching/i.test(r.body.error || ''), r.status + JSON.stringify(r.body));
  ok('the route is in the portal allow-list (a campaign manager is a portal role)', PORTAL_ALLOWED.has('/api/portal/cm-coaching'));
  ok('themeLabel is the page\'s own label (family dropped, underscores spaced, title-cased)', themeLabel('gap.customer_verification') === 'Customer Verification' && themeLabel('') === '');
}

/* =================================================================== F */
head('F · team-leader rows: drill + coach on every agent');
{
  await setup();
  const d = DIGEST();
  const run = (n, sales, from) => DAYS(n, sales, from);
  /* CB1: 10 worked days at 2 sales/day (1–10 Sep), then the LAST session on 18 Sep, then 4 days at 3 a day (21–24) */
  d.agents[0].days = [...run(10, 2, 1), { d: '2026-09-11', s: 0, act: 0, emp: 1, t: 3 }, ...run(4, 3, 21)];
  d.agents[1].days = [...run(2, 2, 1)];                                   // CB2: a session on the 3rd, but nothing worked AFTER it
  d.agents[2].days = [...run(5, 2, 1)];                                   // CB3: no sessions at all
  const ses = (id, date, cb, name, o = {}) => ({ id, type: 'Formal Coaching', typeLabel: 'Formal Coaching', date, cb, agentName: name, hubTeamLeader: 'Denise Haripersad', hubTeamLeaderId: 'hub-d',
    clusters: [{ clusterKey: 'gap.customer_verification', family: 'gap' }, { clusterKey: 'gap.pitch_value_creation', family: 'gap' }, { clusterKey: 'support.role_play_practice', family: 'support' }], ...o });
  const snapshot = { fetchedAt: new Date().toISOString(), hub: 'x', leaders: [], errors: [], sessions: [
    ses('a', '2026-09-05', 'CB1', 'Courtesy One'), ses('b', '2026-09-18', 'CB1', 'Courtesy One', { clusters: [{ clusterKey: 'gap.customer_verification', family: 'gap' }] }),
    ses('c', '2026-08-28', 'CB1', 'Courtesy One'),                                          // before the period: not counted
    ses('e', '2026-09-03', 'CB2', 'Courtesy Two'),
  ] };
  publish('kv:coaching', snapshot);
  const r = await overview(env, DB, tlUser, d, []);
  ok('the team overview is 200 and carries the team', r.status === 200 && r.body.scope === 'team' && r.body.agents.length === 4);
  const row = (code) => r.body.agents.find((a) => a.code === code);
  ok('every covered agent row carries drill {ta, aveG, qa, att}', r.body.agents.filter((a) => a.covered).every((a) => a.drill && ['ta', 'aveG', 'qa', 'att'].every((k) => a.drill[k] && a.drill[k].status)), JSON.stringify(row('CB1').drill).slice(0, 120));
  const det = await agentDetail(env, DB, tlUser, d, 'CB1');
  ok('drill is the SAME object agentDetail publishes as me.drill (one number, one verdict)', same(row('CB1').drill, det.body.me.drill));
  const det2 = await agentDetail(env, DB, tlUser, d, 'CB2');
  ok('...for every agent, not just the first', same(row('CB2').drill, det2.body.me.drill));
  ok('an agent with no figures (not covered) has no drill — nothing invented', row('CB77').drill === null);

  const c1 = row('CB1').coach;
  ok('coach.n counts sessions INSIDE the period only (2, not 3)', c1.n === 2, JSON.stringify(c1));
  ok('coach.last is the newest session in the period', c1.last === '2026-09-18');
  ok('coach.themes are the development-area labels, most frequent first', same(c1.themes, ['Customer Verification', 'Pitch Value Creation']), JSON.stringify(c1.themes));
  ok('after = sales per worked day before the last session vs after it: 2.00 → 3.00, up', c1.after && c1.after.basis === 'sales per worked day' && c1.after.before === 2 && c1.after.after === 3 && c1.after.dir === 'up', JSON.stringify(c1.after));
  ok('CB2 has a session but no worked day after it → after is null (never a zero)', row('CB2').coach.n === 1 && row('CB2').coach.after === null);
  ok('CB3 has no session: {n:0, last:null, themes:[], after:null}', same(row('CB3').coach, { n: 0, last: null, themes: [], after: null }), JSON.stringify(row('CB3').coach));
  ok('an agent not on the figures still gets a coach block', row('CB77').coach && row('CB77').coach.n === 0);

  /* the snapshot being unavailable must not lose the page */
  resetCaches(); delete RULES['kv:coaching']; await loadCmContext(DB, { force: true });
  const r2 = await overview(env, DB, tlUser, d, []);
  ok('no Hub copy: the overview still answers, coach is null (unknown), and coaching.error says why', r2.status === 200 && r2.body.agents.every((a) => a.coach === null) && r2.body.coaching && r2.body.coaching.error);
  const ag = await overview(env, DB, agentUser, d, []);
  ok('an agent\'s own payload is unchanged (me.drill from the agent path, no coach block on a colleague)', ag.body.me.drill && !('agents' in ag.body && ag.body.agents && ag.body.agents.length));
}
{
  /* coachAnalysis — the pure function */
  const P = { from: '2026-09-01', to: '2026-09-30' };
  const s = (date, o = {}) => ({ date, clusters: [{ clusterKey: 'gap.a_theme', family: 'gap' }], ...o });
  const dys = (...x) => x.map(([d, sales, o]) => ({ d: '2026-09-' + d, s: sales, act: 1, ...(o || {}) }));
  let a = coachAnalysis([s('2026-09-10')], dys(['03', 4], ['04', 4], ['15', 4], ['16', 4]), P);
  ok('flat: same pace before and after', a.after && a.after.dir === 'flat' && a.after.before === 4 && a.after.after === 4);
  a = coachAnalysis([s('2026-09-10')], dys(['03', 4], ['04', 4], ['15', 2], ['16', 2]), P);
  ok('down: 4.00 → 2.00', a.after.dir === 'down' && a.after.before === 4 && a.after.after === 2);
  a = coachAnalysis([s('2026-09-10')], dys(['03', 0], ['04', 0], ['15', 2]), P);
  ok('up from nothing: 0.00 → 2.00 is up (a real zero before is data)', a.after.dir === 'up' && a.after.before === 0);
  a = coachAnalysis([s('2026-09-10')], [{ d: '2026-09-03', s: 4, act: 1 }, { d: '2026-09-15', s: 4, act: 1, p: 1 }, { d: '2026-09-16', s: 4, act: 1, lv: 1 }, { d: '2026-09-17', s: 4, act: 0 }], P);
  ok('provisional, leave and not-worked days are not worked days → no "after" side → null', a.after === null);
  a = coachAnalysis([s('2026-09-10')], dys(['15', 4]), P);
  ok('no worked day before → null', a.after === null);
  a = coachAnalysis([], dys(['03', 4]), P);
  ok('no session → {n:0,last:null,themes:[],after:null}', same(a, { n: 0, last: null, themes: [], after: null }));
  a = coachAnalysis([s('2026-09-10'), s('2026-08-30')], dys(['03', 4], ['15', 4]), P);
  ok('a session before the period is ignored', a.n === 1);
  a = coachAnalysis([s('2026-09-10')], dys(['10', 9], ['03', 4], ['15', 4]), P);
  ok('the session day itself is neither before nor after', a.after.before === 4 && a.after.after === 4);
  ok('null/undefined inputs are survivable', coachAnalysis(null, null, P).n === 0 && coachAnalysis([s('2026-09-10')], undefined, P).after === null);
}

/* =================================================================== F2 */
head('F2 · coach: a CB row matches on CB only (review L2)');
{
  await setup();
  const d = DIGEST();
  d.agents.push(mk('CB40', 'Same Name', 'Courtesy', 'M1', 'Denise Haripersad', { days: DAYS(5, 2, 1) }), mk('CB41', 'Same Name', 'Courtesy', 'M1', 'Denise Haripersad', { days: DAYS(5, 2, 1) }));
  const ses = (id, date, cb, o = {}) => ({ id, type: 'Formal Coaching', typeLabel: 'Formal Coaching', date, cb, agentName: 'Same Name', hubTeamLeader: 'Denise Haripersad', hubTeamLeaderId: 'hub-d', clusters: [{ clusterKey: 'gap.customer_verification', family: 'gap' }], ...o });
  publish('kv:coaching', { fetchedAt: new Date().toISOString(), hub: 'x', leaders: [], errors: [], sessions: [ses('x1', '2026-09-05', 'CB40'), ses('x2', '2026-09-06', '')] });
  const r = await overview(env, DB, tlUser, d, []);
  const row = (c) => r.body.agents.find((a) => a.code === c);
  ok('the agent whose CB is on the session gets it (1)', row('CB40').coach.n === 1, JSON.stringify(row('CB40').coach));
  ok('the same-name colleague with another CB gets NOTHING from a CB-less session carrying the shared name', row('CB41').coach.n === 0, JSON.stringify(row('CB41').coach));
  ok('and the CB-less session is not attributed to the CB row either (n stays 1)', row('CB40').coach.n === 1);
}

/* =================================================================== M (movers) */
head('M · a mover\'s EARLIER-campaign segment row carries only that segment (review 5)');
{
  await setup();
  const days = [...DAYS(14, 1, 1), ...DAYS(16, 2, 15)];
  const mover = { ...mk('CB30', 'Mover One', 'Courtesy', 'M1', 'Denise Haripersad', { days, sales: 20, talk: 99999, aveTalk: 5.5, talkPerWorked: 3, wk: [{ n: 1 }], rating: { secret: 1 }, calls: 777, ans: 55, qa: 0.5,
      zzUnknown: 'WHOLE-MONTH-SECRET', composite: { r2a: { fails: 3 } }, score: 70, checks: { x: 1 }, leads: 12, closed: 40 }),
    segments: [
      { campaign: 'Cuddle', from: '2026-09-01', to: '2026-09-14', sales: 5, gwpEx: 450, target: 20, pctT: 0.25, act: 14, emp: 14, spd: 0.36, aveG: 90, plan: 'p1' },
      { campaign: 'Courtesy', from: '2026-09-15', to: '2026-09-30', sales: 15, gwpEx: 1350, target: 40, pctT: 0.375, act: 16, emp: 16, spd: 0.94, aveG: 90, plan: 'p2' }] };
  const rows = bySegment([mover]);
  const early = rows.find((r) => r.campaign === 'Cuddle'), cur = rows.find((r) => r.campaign === 'Courtesy');
  ok('one row per campaign segment', rows.length === 2 && early && cur);
  ok('the earlier row\'s days[] are only that segment\'s (1–14 Sep)', early.days.length === 14 && early.days.every((x) => x.d <= '2026-09-14'), early.days.length);
  ok('the earlier row\'s figures are the segment\'s own (sales 5, target 20)', early.sales === 5 && early.target === 20 && early.act === 14 && early.emp === 14);
  ok('it carries ONLY allow-listed keys — nothing unknown rides along (an allowlist, not a denylist)', Object.keys(early).every((k) => SEGMENT_ROW_KEYS.includes(k)), JSON.stringify(Object.keys(early).filter((k) => !SEGMENT_ROW_KEYS.includes(k))));
  ok('every whole-month-only field is absent or null on the earlier row (talk, calls, qa, composite, aveTalk, wk, rating, closed, leads…)', ['talk', 'calls', 'ans', 'qa', 'composite', 'aveTalk', 'talkPerWorked', 'wk', 'rating', 'closed', 'leads', 'score', 'checks', 'zzUnknown', 'ref', 'canc', 'gwpT'].every((k) => early[k] == null), JSON.stringify(['talk', 'calls', 'aveTalk', 'zzUnknown', 'rating', 'closed'].map((k) => early[k])));
  ok('the earlier row keeps its identity (code, name, tl, tenure) for the report renderers', early.code === 'CB30' && early.name === 'Mover One' && early.tl === 'Denise Haripersad' && early.tenure === 'M1');
  ok('the CURRENT segment\'s row has its own days only and carries the whole-period figures once', cur.days.length === 16 && cur.days.every((x) => x.d >= '2026-09-15') && cur.talk === 99999 && cur.closed === 40 && cur.segments === undefined);
  ok('the segment-cut figures on the current row are its own (sales 15)', cur.sales === 15 && cur.target === 40);
  ok('the source row is not mutated (the digest cache is shared)', mover.talk === 99999 && mover.days.length === 30 && Array.isArray(mover.segments));

  /* end to end: a manager who holds ONLY the earlier campaign */
  const d = DIGEST(); d.agents.push(mover);
  globalThis.__cmCtx.assign = { ryan: { campaigns: ['cuddle'] } };
  const r = await overview(env, DB, cmUser, d, [], { assist: { requests: [] } });
  const mine = r.body.agents.find((a) => a.code === 'CB30');
  ok('the Cuddle manager receives the mover\'s Cuddle segment only', mine && mine.campaign === 'Cuddle' && mine.sales === 5 && mine.days.length === 14);
  ok('...and nothing of the Courtesy segment or the whole month travels in the payload (no 99999, no secret, no rating)', !/99999|WHOLE-MONTH-SECRET|"secret"|"calls":777/.test(JSON.stringify(r.body.agents.filter((a) => a.code === 'CB30'))), JSON.stringify(mine).slice(0, 200));
  globalThis.__cmCtx.assign = { ryan: { campaigns: ['courtesy', 'cuddle'] } };
}

/* =================================================================== H (freshness) */
head('H · the amber "older than a day" band is for the CURRENT period only (review 6)');
{
  await setup();
  const old = (m) => ({ ...DIGEST(), updatedAt: new Date(Date.now() - 30 * 3600000).toISOString(), marker: m });
  publish('kv:agent-digest', { ...old('live'), period: { from: '2026-10-01', to: '2026-10-31' } }); publish('kv:agent-digest-2026-09', old('month'));
  publish('kv:agent-digest-cycle-2026-09', { ...old('cycle'), period: { from: '2026-08-26', to: '2026-09-25', kind: 'cycle' } });
  const call = (q) => { resetCaches(); return loadCmContext(DB, { force: true }).then(() => overviewRequest(env, DB, cmUser, q, { getAssist: async () => ({ requests: [] }), nowMs: Date.parse('2026-10-01T08:00:00Z') })); };
  let r = await call({});
  ok('the live digest 30 h old: stale (the amber band is right)', r.body.cm.freshness.stale === true && r.body.cm.freshness.label === 'Waiting on new data', JSON.stringify(r.body.cm.freshness));
  r = await call({ period: '2026-09' });
  ok('a closed month published 30 h ago is NOT stale', r.body.cm.freshness.stale === false && r.body.cm.freshness.label !== 'Waiting on new data', JSON.stringify(r.body.cm.freshness));
  r = await call({ period: 'cycle-2026-09' });
  ok('nor is a closed billing month', r.body.cm.freshness.stale === false);
  ok('the closed period still says when it was built', !!r.body.cm.freshness.updatedAt);
}

/* =================================================================== G */
head('G · the rule book: specs/cm_rules.json and the operative copy');
{
  const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'specs', 'cm_rules.json'), 'utf8'));
  ok('talk_target_min_by_campaign = {courtesy: 300, cuddle: 270}', same(spec.talk_target_min_by_campaign, { courtesy: 300, cuddle: 270 }), JSON.stringify(spec.talk_target_min_by_campaign));
  ok('talk_target_min_default = 210', spec.talk_target_min_default === 210);
  ok('the operative copy in campaign.mjs equals the spec (change both together)', CM.CM_RULES && same(CM.CM_RULES.talk_target_min_by_campaign, spec.talk_target_min_by_campaign) && CM.CM_RULES.talk_target_min_default === spec.talk_target_min_default);
  ok('the legacy SLA default for talk follows the rule book\'s default', CM.CM_SLA_DEFAULTS.talk_target === spec.talk_target_min_default);
  const ch = spec._changes && spec._changes[0];
  ok('the change is dated with its reason (_changes[])', Array.isArray(spec._changes) && ch && ch.date === '2026-10-01' && /5 hours Courtesy, 4\.5 hours Cuddle/.test(ch.why) && !!ch.what, JSON.stringify(ch));
  ok('every _changes[] entry is dated', spec._changes.every((c) => /^\d{4}-\d{2}-\d{2}$/.test(c.date)));
  ok('talkTargetFor reads the one rule: courtesy 300 / cuddle 270 / nesting 210', CM.talkTargetFor(null, 'courtesy').targetMin === 300 && CM.talkTargetFor(null, 'cuddle').targetMin === 270 && CM.talkTargetFor(null, 'nesting').targetMin === 210);
  const src = fs.readFileSync(path.join(ROOT, 'worker', 'src', 'campaign.mjs'), 'utf8');
  ok('no literal 300 / 270 target outside the rule copy (a rule is read, not copied)', (src.match(/\b(300|270)\b/g) || []).length <= 3, String((src.match(/\b(300|270)\b/g) || []).length));
}

/* =================================================================== N */
head('N · headcounts count PEOPLE, not digest rows (spec 034, 2026-10-13: Dalwin read "98 agents" for a 76-agent list)');
{
  /* The digest publishes a mover as one row per dated campaign segment (D4), and — after a stale list upload — an agent
     can even carry two segment rows under the SAME leader and campaign. Those rows are right for the figures (each
     carries its own days once) and wrong for a headcount. Every count the manager reads is distinct by CB. */
  await setup();
  const d = DIGEST();
  const seg = (code, name, camp, tl, from, to, over) => Object.assign(mk(code, name, camp, 'M1', tl, over), { segment: { from, to } });
  d.agents.push(
    seg('CB7', 'Twice Listed', 'Courtesy', 'Denise Haripersad', '2026-09-07', '2026-09-07', { sales: 3 }),
    seg('CB7', 'Twice Listed', 'Courtesy', 'Denise Haripersad', '2026-09-09', '2026-09-12', { sales: 8 }),
    seg('CB8', 'Real Mover', 'Courtesy', 'Denise Haripersad', '2026-09-01', '2026-09-06', { sales: 4 }),
    seg('CB8', 'Real Mover', 'Cuddle', 'Renolan Pillay', '2026-09-07', '2026-09-30', { sales: 6 }),
  );
  const r = await overview(env, DB, cmUser, d, [], { assist: { requests: [] }, tenure: 'all' });
  const cms = r.body.cm.campaigns, all = cms.find((c) => c.key === 'all'), co = cms.find((c) => c.key === 'courtesy'), cu = cms.find((c) => c.key === 'cuddle');
  /* the fixture's no-activity agent CB77 (notCovered, Courtesy/Denise) is a person too and has always counted */
  ok('All campaigns: 8 people (CB1-5, CB7, CB8, CB77), not 10 rows', all.agents === 8, String(all.agents));
  ok('Courtesy: 6 people (CB1-3, CB7 once, CB8 once, CB77)', co.agents === 6, String(co.agents));
  ok('Cuddle: 3 people (CB4, CB5, CB8)', cu.agents === 3, String(cu.agents));
  const denise = co.teams.find((t) => t.tl === 'Denise Haripersad');
  ok('the team row counts CB7 once and CB8 once: Denise 6', denise && denise.agents === 6, JSON.stringify(denise && denise.agents));
  ok('…while the team\'s sales still sum every row (60 + 3 + 8 + 4 = 75)', denise && denise.sales === 75, String(denise && denise.sales));
  ok('Courtesy sales sum every row too (75)', co.kpis.sales.v === 75, String(co.kpis.sales.v));
  ok('agentIndex lists each code once', all.agentIndex.length === 8 && new Set(all.agentIndex.map((a) => a.code)).size === 8, String(all.agentIndex.length));
  const m1 = all.tenures.find((t) => t.key === 'M1');
  ok('the tenure picker counts people (M1 = CB1, CB7, CB8 → 3)', m1 && m1.agents === 3, JSON.stringify(all.tenures));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
