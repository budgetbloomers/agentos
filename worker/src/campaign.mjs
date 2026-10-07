/**
 * THE CAMPAIGN MANAGER — the sales half of the third view.
 *
 * The rules here are Chatterbox_CampaignManager.json read as a SPECIFICATION,
 * not pasted in as source: that file's eight modules run on the prototype's own
 * AP.* engine over fourteen invented agents. This module computes the same
 * fourteen measures, the projection, the reconciliation, the nine-rung
 * diagnosis ladder and the Nikola brief — from the digest PULSE publishes,
 * which is the only place a campaign number may come from.
 *
 * "Not one formula lives here" (spec, rules.sales_kpis): every measure is the
 * team-leader measure summed over the agents on the campaign. A team is one
 * team leader AND one campaign — the intersection, never the whole team.
 *
 * CONVERSION IS sales ÷ CLOSED LEADS since 2026-10-01 (spec 001-cm-view-signoff, the
 * manager's sign-off list), never sales per call and no longer sales per unique lead.
 * PULSE publishes `closed` (every case closed in the period, any status) beside
 * `leads` (unique leads, still the attempts-per-lead and lead-volume basis) and the
 * dialler volume (`calls`, `ans`). `closed: null` / `leads: null` mean the Salesforce
 * case books are not loaded — which is NOT the same as an agent with none, so they
 * stay null, the figure is null with a stated reason (`convWhy`), and the page says so.
 *
 * Two measures remain genuinely unavailable: PITCHES (this suite has no pitch
 * count — answered calls are contacts, not pitches) and BOTH-CHECKS (an Ops
 * `twoCheck` concept the digest does not carry). They return null and the page
 * says "not published yet" — never a zero, because an absence is not a nought
 * (non-negotiable 6). Do not "fix" a null by inventing a number here.
 */

import { gwpFloorEx } from './rules.mjs';   // the floor at the cent Salesforce books — one number, one verdict

const norm = (v) => String(v == null ? '' : v).trim();
/* GWP A SALE AGAINST ITS FLOOR, LIKE FOR LIKE (scorecard audit, 2026-09-28). The campaign's aveG is
   EX VAT (the digest's display basis); gwp_ref is the R99 floor INCL VAT. Comparing the two raw put
   every campaign ~R13 under its reference. `ref` is now the ex-VAT floor the agents' Check 1 uses
   (R86,08), `refIncl` the incl figure for the label. */
const aveGKpi = (v, sla) => { const incl = Number(sla && sla.gwp_ref) || 99; return { v, ref: gwpFloorEx(incl), refIncl: incl }; };
export const campKey = (v) => norm(v).toLowerCase();

/* ---------------------------------------------------------------------------
   THE RULE BOOK — three rules-table rows, the spec's three workbook tabs.
   cm:sla         → the SLA targets and the KPI thresholds
   cm:blockages   → every blockage a team leader can raise, and where it routes
   cm:assignments → which campaigns each manager runs
   Defaults are the spec's own values, so the view works before the rows are
   seeded — but a seeded row always wins (a rule must be READ, not copied).
   --------------------------------------------------------------------------- */
/* THE TALK-TIME TARGETS (spec 001-cm-view-signoff, 2026-10-01 — "average talk time target 5 hours Courtesy, 4.5
   hours Cuddle"). The RECORD is specs/cm_rules.json; this is the operative copy the Worker reads — change both
   together, verify-cm-signoff-worker (section G) fails on drift. Minutes of talk per worked day. */
export const CM_RULES = {
  talk_target_min_by_campaign: { courtesy: 300, cuddle: 270 },
  talk_target_min_default: 210,
};
/** The talk target one campaign is judged against, and where it came from. Order (review fix 7b, 2026-10-01):
 *  1. cm:targets per-campaign talk_target (the Settings page)  — source 'settings'
 *  2. CM_RULES by campaign key (Courtesy 5 h, Cuddle 4.5 h)    — source 'default'
 *  3. the global cm:sla talk_target (live: 210, the default for every OTHER campaign) — 'settings' only when it
 *     differs from the rule book's default, else 'default'
 *  4. CM_RULES default (210).
 *  The rule book's own targets beat the global row; only an explicit per-campaign setting overrides them. */
export function talkTargetFor(ctx, key) {
  const k = String(key == null ? '' : key).trim().toLowerCase();
  const ov = ctx && ctx.targets && ctx.targets.sla && ctx.targets.sla[k] && Number(ctx.targets.sla[k].talk_target);
  if (ov > 0) return { targetMin: ov, source: 'settings' };
  const rule = CM_RULES.talk_target_min_by_campaign[k];
  if (rule != null) return { targetMin: rule, source: 'default' };
  const g = ctx && ctx.sla && Number(ctx.sla.talk_target);
  if (g > 0) return { targetMin: g, source: g === CM_RULES.talk_target_min_default ? 'default' : 'settings' };
  return { targetMin: CM_RULES.talk_target_min_default, source: 'default' };
}

export const CM_SLA_DEFAULTS = {
  p1_mins: 15, p2_mins: 30, p3_mins: 240, p4_mins: 1440,
  followup_hours: 48, near_breach_pct: 75, repeat_window_days: 30, repeat_min: 2,
  qa_target: 90, talk_target: CM_RULES.talk_target_min_default, att_target: 95, cancel_watch_pct: 10, gwp_ref: 99,
  /* Conversion is sales / UNIQUE LEADS and its target is the Lead Management tab's
     own dial (10%), NOT the tenure-group conversion target. The spec's open decision
     records why that matters: the 40% EXP-Cuddle tenure target made the weighted
     campaign target read 33.3%, which is a different measure wearing the same name. */
  conv_target: 10, attempts_low: 3, attempts_high: 5,
};

export const CM_BLOCKAGES_DEFAULTS = [
  { key: 'skill',      label: 'Skill or behaviour',             routes_to: 'Coaching Hub',                   owner: 'Team leader → Coaching Hub', restricted: false, baseline_metric: 'conv' },
  { key: 'knowledge',  label: 'Product or process knowledge',   routes_to: 'Training',                       owner: 'Team leader → Training',     restricted: false, baseline_metric: 'qa' },
  { key: 'qa',         label: 'QA or compliance',               routes_to: 'QA',                             owner: 'Jared · QA',                 restricted: false, baseline_metric: 'qa' },
  { key: 'leads',      label: 'Leads or data',                  routes_to: 'Campaign / Data',                owner: 'Campaign team · Ryan',       restricted: false, baseline_metric: 'leads' },
  { key: 'dialler',    label: 'Dialler',                        routes_to: 'Dialler administration',         owner: 'Aarav · Systems',            restricted: false, baseline_metric: 'calls' },
  { key: 'crm',        label: 'CRM or system',                  routes_to: 'Technical support',              owner: 'Aarav · Systems',            restricted: false, baseline_metric: 'calls' },
  { key: 'attendance', label: 'Attendance',                     routes_to: 'Team leader / People Operations', owner: 'Claudell · People',         restricted: false, baseline_metric: 'present' },
  { key: 'training',   label: 'Training',                       routes_to: 'Training',                       owner: 'Team leader → Training',     restricted: false, baseline_metric: 'qa' },
  { key: 'payroll',    label: 'Commission or payroll',          routes_to: 'Payroll',                        owner: 'Ryan · Data',                restricted: false, baseline_metric: null },
  { key: 'personal',   label: 'Personal or private',            routes_to: 'Restricted — People Operations', owner: 'Team leader (private)',      restricted: true,  baseline_metric: null },
  { key: 'other',      label: 'Other — requires classification', routes_to: 'Campaign manager investigation', owner: 'Team leader',               restricted: false, baseline_metric: 'sales' },
];

/* Until Nick settles D1 (which campaigns each manager runs), both hold all
   three VAS campaigns — narrowing later is a row edit, not a code change. */
export const CM_ASSIGN_DEFAULTS = {
  dalwin: { name: 'Dalwin Callaghan', campaigns: ['courtesy', 'cuddle', 'nesting'] },
  ryan:   { name: 'Ryan G',           campaigns: ['courtesy', 'cuddle', 'nesting'] },
  preshen: { name: 'Preshen Naidoo',  campaigns: ['courtesy', 'cuddle', 'nesting'] },   // Nick, 2026-09-07: same access as Dalwin; found unassigned 2026-09-08 ("not assigned to a campaign yet")
};

/**
 * Load the campaign-manager context into the isolate: assignments, the SLA/
 * threshold rules, the blockage table, and the team leaders' own CB codes.
 * authorise() in portal.mjs reads globalThis.__cmCtx — it must stay a sync
 * function for its dozen existing callers, so the async load happens once per
 * request here (cached CACHE_MIN) and the sync read never fetches.
 *
 * THE LEADER CODES COME FROM app_users, NOT THE DIGEST. The digest names a
 * leader (tl: "Renolan Pillay") but does not code them, and the assistance
 * pipeline is keyed on the leader's CB. app_users is the provisioning record —
 * a code that decides authorisation must not depend on whoever last had a
 * browser tab open (the same reasoning as the kv:agent-teams floor).
 */
const CACHE_MIN = 5;
/* ---------------------------------------------------------------------------
   CAMPAIGN TARGET SETTINGS (Nick, 2026-09-01: Dalwin "must have a setting page
   to change targets of different campaigns … this is the new targets that was
   set by him"). One rules row, cm:targets:

     { matrix:   { "Courtesy|Exp": 6, … }        — sales/agent/day overrides
       gwpMonth: { courtesy: 120000, … }         — campaign GWP target (month)
       sla:      { courtesy: { qa_target: 85 } } — per-campaign quality dials
       stamp:    ISO of the last change
       log:      [{at, by, kind, key, old, new}] — append-only, capped }

   The MATRIX overlays PULSE's salesTargetMatrix. The daily target became a
   RULE, not a cell, on 2026-08-20; this makes that rule live-editable per
   campaign. PULSE reads the same override at its one target choke point and
   republishes the digest, and /api/roster serves overridden per-agent targets
   to Ops — so agents, team leaders, both dashboards and this view read ONE
   number. The Agent List's Target column is never rewritten: clearing an
   override restores it exactly.

   SALES_TARGET_MATRIX_DEFAULTS mirrors specs/mtd_engine_rules.json
   reference_data.sales_target_matrix (drift-guarded by verify-cm-targets.mjs):
   the Worker needs the base so a settings screen can say what "inherited"
   means, and so /api/roster serves rule targets, not stale roster cells. */
export const SALES_TARGET_MATRIX_DEFAULTS =
  { 'Cuddle|Exp': 8, 'Courtesy|Exp': 5, 'Courtesy|M2': 4, 'Courtesy|M1': 3, 'Nesting|M0': 2, 'Nesting|*': 2 };

export const CM_TARGET_BOUNDS = {
  matrix:   { min: 0.5, max: 20 },          // sales per agent per day
  gwpMonth: { min: 1000, max: 5000000 },    // rand, inclusive of VAT as displayed
  sla: { qa_target: { min: 50, max: 100 }, talk_target: { min: 30, max: 480 },
         att_target: { min: 50, max: 100 }, conv_target: { min: 1, max: 100 } },
};

const emptyTargets = () => ({ matrix: {}, gwpMonth: {}, sla: {}, stamp: '', log: [] });

/* The one precedence everyone must share (PULSE mirrors this chain verbatim):
   override exact → override campaign-wide → rule-book exact → rule-book
   campaign-wide → the Agent List's own cell. */
export function effPerDay(ctx, campaign, tenure, listFallback) {
  const ov = (ctx && ctx.targets && ctx.targets.matrix) || {};
  const tm = SALES_TARGET_MATRIX_DEFAULTS;
  const c = norm(campaign), t = norm(tenure);
  return ov[c + '|' + t] ?? ov[c + '|*'] ?? tm[c + '|' + t] ?? tm[c + '|*'] ?? (Number(listFallback) || 0);
}
export const slaFor = (ctx, key) =>
  ({ ...((ctx && ctx.sla) || CM_SLA_DEFAULTS), ...((ctx && ctx.targets && ctx.targets.sla && ctx.targets.sla[key]) || {}) });

export async function loadCmContext(DB, { force = false } = {}) {
  const c = globalThis.__cmCtx;
  if (!force && c && Date.now() - c.t < CACHE_MIN * 60000) return c;

  const keys = ['cm:sla', 'cm:blockages', 'cm:assignments', 'cm:targets'].map(encodeURIComponent).join(',');
  const [rules, tls, camps] = await Promise.all([
    DB.select(`rules?key=in.(${keys})&select=key,value`).catch(() => []),
    DB.select('app_users?role=eq.team_leader&active=is.true&select=username,full_name,cb,team,hub_ids').catch(() => []),
    /* the campaigns the current Agent List names (migration-019) — the one list of
       "what campaigns exist"; the hardcoded assignment defaults below are only who
       RUNS them, and a campaign created by the list with no owner yet is exactly
       what `campaigns` lets the settings screen say out loud */
    DB.select('active_campaigns?select=key,label,agents,first_seen,last_seen').catch(() => []),
  ]);
  const byKey = {}; for (const r of rules || []) byKey[r.key] = r.value;

  const sla = { ...CM_SLA_DEFAULTS, ...(byKey['cm:sla'] || {}) };
  const blockages = Array.isArray(byKey['cm:blockages']) && byKey['cm:blockages'].length
    ? byKey['cm:blockages'] : CM_BLOCKAGES_DEFAULTS;
  const assign = byKey['cm:assignments'] && typeof byKey['cm:assignments'] === 'object'
    ? byKey['cm:assignments'] : CM_ASSIGN_DEFAULTS;
  const targets = byKey['cm:targets'] && typeof byKey['cm:targets'] === 'object'
    ? { ...emptyTargets(), ...byKey['cm:targets'] } : emptyTargets();

  /* team-name → {cb, name}. The team_leader row's `team` column is the exact
     Agent List spelling the digest's `tl` carries (provisioning writes both). */
  const leaders = {};
  for (const t of tls || []) {
    const team = norm(t.team); if (!team) continue;
    /* hubId = the leader's Coaching Hub id (app_users.hub_ids.coaching) — the cm-coaching page matches on it first */
    leaders[team] = { cb: norm(t.cb).toUpperCase(), name: t.full_name || t.username, username: t.username,
      hubId: norm(t.hub_ids && t.hub_ids.coaching) };
  }

  const ctx = { t: Date.now(), sla, blockages, assign, leaders, targets, campaigns: Array.isArray(camps) ? camps : [] };
  globalThis.__cmCtx = ctx;
  return ctx;
}

/* ---------------------------------------------------------------------------
   THE SETTINGS SCREEN'S TWO HALVES. GET builds what the page shows — effective
   value beside inherited value for every dial, so an adjusted target can never
   masquerade as the rule book's own — and POST applies exactly ONE change,
   validated, bounded, signed and logged. Both are gated to campaign managers
   (their assigned campaigns only) and admin (all campaigns).
   --------------------------------------------------------------------------- */
/* WHICH CAMPAIGNS A MANAGER RUNS: their assignment, PLUS every active campaign the Agent
   List has created (migration-019) that nobody is assigned to (Nick, 2026-09-03: a new
   campaign goes to every campaign manager until narrowed — narrowing is a cm:assignments
   row edit). VT never carries digest rows, so it never reaches a screen. An account with
   no assignment row at all is not a campaign manager and gets nothing. */
export function effectiveCamps(ctx, username) {
  const assign = (ctx && ctx.assign) || {};
  const a = assign[String(username || '').toLowerCase()] || null;
  if (!a) return [];
  const mine = Array.isArray(a.campaigns) ? a.campaigns.map((c) => campKey(c)).filter(Boolean) : [];
  const owned = new Set(Object.values(assign).flatMap((x) =>
    (x && Array.isArray(x.campaigns) ? x.campaigns : []).map((c) => campKey(c))));
  const unowned = ((ctx && ctx.campaigns) || []).map((c) => campKey(c.key || c.label))
    .filter((k) => k && k !== 'vt' && !owned.has(k) && !mine.includes(k));
  return mine.concat(unowned);
}
const cmCampsFor = (ctx, user) => {
  if (user.role === 'admin') return null;                       // null = every campaign
  return effectiveCamps(ctx, user.username);
};

export function cmSettingsBody(digest, user, ctx) {
  const allowed = cmCampsFor(ctx, user);
  if (allowed && !allowed.length) return { error: 'This account is not assigned to a campaign.', status: 403 };
  const t = ctx.targets || emptyTargets();
  /* campaigns come from the matrix keys (the rule book knows the floor), scoped
     to what this account runs; labels from the digest when it holds the campaign */
  const camps = {};
  for (const k of Object.keys(SALES_TARGET_MATRIX_DEFAULTS).concat(Object.keys(t.matrix || {}))) {
    const camp = k.split('|')[0]; const key = campKey(camp);
    if (allowed && !allowed.includes(key)) continue;
    (camps[key] = camps[key] || { key, label: camp, rows: {} }).rows[k] = true;
  }
  /* CAMPAIGNS THE LIST CREATED THAT THE RULE BOOK HAS NO ROW FOR (migration-019, Nick
     2026-09-03: created with NO targets). They appear with one campaign-wide row so a
     target can be set, and are flagged NEW until something is — the agent page shows
     "new — targets not set" so nobody mistakes an inherited blank for a decision. */
  const newKeys = new Set();
  for (const c of (ctx.campaigns || [])) {
    const key = campKey(c.key || c.label); if (!key || key === 'vt') continue;
    if (allowed && !allowed.includes(key)) continue;
    if (!camps[key]) { camps[key] = { key, label: c.label, rows: {} }; camps[key].rows[c.label + '|*'] = true; newKeys.add(key); }
  }
  /* a mover's earlier campaign is still worked this month (item 2, D4) — its segments count as present */
  const digestCamps = new Set(((digest && digest.agents && Object.values(digest.agents)) || [])
    .flatMap((a) => [a.campaign, ...((a && a.segments) || []).map((s) => s.campaign)]).map(norm).filter(Boolean));
  const out = Object.values(camps).map((c) => {
    const ov = t.matrix || {};
    const rows = Object.keys(c.rows).sort().map((k) => ({
      k, tenure: k.split('|')[1],
      base: SALES_TARGET_MATRIX_DEFAULTS[k] ?? null,
      set: ov[k] ?? null,
      eff: ov[k] ?? ov[c.label + '|*'] ?? SALES_TARGET_MATRIX_DEFAULTS[k] ?? SALES_TARGET_MATRIX_DEFAULTS[c.label + '|*'] ?? null,
    }));
    const slaC = slaFor(ctx, c.key), slaSet = (t.sla || {})[c.key] || {};
    const hasTargets = rows.some((r) => r.set != null) || ((t.gwpMonth || {})[c.key] != null) || Object.keys(slaSet).length > 0;
    return { key: c.key, label: c.label, inDigest: digestCamps.has(c.label), isNew: newKeys.has(c.key), hasTargets, rows,
      gwpMonth: { set: (t.gwpMonth || {})[c.key] ?? null },
      sla: Object.keys(CM_TARGET_BOUNDS.sla).map((k) => {
        /* the talk dial's inherited value is the rule book's per-campaign target (Courtesy 5 h, Cuddle 4.5 h) */
        const base = k === 'talk_target' ? CM_RULES.talk_target_min_by_campaign[c.key] ?? (Number((ctx.sla || CM_SLA_DEFAULTS).talk_target) || CM_RULES.talk_target_min_default) : (ctx.sla || CM_SLA_DEFAULTS)[k];
        return { k, base, set: slaSet[k] ?? null, eff: slaSet[k] ?? base }; }) };
  });
  /* the digest tells us which targets it was built WITH — until PULSE
     republishes, the numbers on the other tabs run on the previous set */
  const pending = !!(t.stamp && (digest && digest.cmTargetsStamp) !== t.stamp);
  return { status: 200, body: { campaigns: out, bounds: CM_TARGET_BOUNDS, stamp: t.stamp || '',
    pendingDigest: pending, log: (t.log || []).slice(-20).reverse() } };
}

export async function cmSettingsApply(DB, user, ctx, body) {
  const allowed = cmCampsFor(ctx, user);
  if (allowed && !allowed.length) return { status: 403, body: { error: 'This account is not assigned to a campaign.' } };
  const kind = String(body && body.kind || '');
  const rawKey = norm(body && body.key);
  const value = (body && body.value == null) ? null : Number(body.value);
  if (value != null && (isNaN(value) || !isFinite(value))) return { status: 400, body: { error: 'The value is not a number.' } };

  /* which campaign is being touched, and may this account touch it */
  let campPart = '';
  if (kind === 'matrix') campPart = campKey(rawKey.split('|')[0]);
  else campPart = campKey(rawKey.split(':')[0]);
  if (!campPart) return { status: 400, body: { error: 'No campaign in the key.' } };
  if (allowed && !allowed.includes(campPart))
    return { status: 403, body: { error: 'That campaign is not assigned to this account.' } };

  /* bounds — a fat-fingered value is refused with the range, never stored */
  const t = { ...emptyTargets(), ...(ctx.targets || {}) };
  t.matrix = { ...t.matrix }; t.gwpMonth = { ...t.gwpMonth }; t.sla = { ...t.sla };
  let old = null;
  if (kind === 'matrix') {
    if (!/^[A-Za-z ]+\|(\*|[A-Za-z0-9]+)$/.test(rawKey)) return { status: 400, body: { error: 'Bad matrix key.' } };
    const b = CM_TARGET_BOUNDS.matrix;
    if (value != null && (value < b.min || value > b.max))
      return { status: 400, body: { error: `Sales/agent/day must be between ${b.min} and ${b.max}.` } };
    old = t.matrix[rawKey] ?? null;
    if (value == null) delete t.matrix[rawKey]; else t.matrix[rawKey] = value;
  } else if (kind === 'gwpMonth') {
    const b = CM_TARGET_BOUNDS.gwpMonth;
    if (value != null && (value < b.min || value > b.max))
      return { status: 400, body: { error: `GWP/month must be between R${b.min} and R${b.max}.` } };
    old = t.gwpMonth[campPart] ?? null;
    if (value == null) delete t.gwpMonth[campPart]; else t.gwpMonth[campPart] = value;
  } else if (kind === 'sla') {
    const dial = rawKey.split(':')[1] || '';
    const b = CM_TARGET_BOUNDS.sla[dial];
    if (!b) return { status: 400, body: { error: 'Unknown quality dial: ' + dial } };
    if (value != null && (value < b.min || value > b.max))
      return { status: 400, body: { error: `${dial} must be between ${b.min} and ${b.max}.` } };
    const cur = { ...(t.sla[campPart] || {}) };
    old = cur[dial] ?? null;
    if (value == null) delete cur[dial]; else cur[dial] = value;
    if (Object.keys(cur).length) t.sla[campPart] = cur; else delete t.sla[campPart];
  } else return { status: 400, body: { error: 'Unknown setting kind.' } };

  if (old === value || (old == null && value == null))
    return { status: 200, body: { unchanged: true, stamp: t.stamp } };

  t.stamp = new Date().toISOString();
  t.log = [...(t.log || []), { at: t.stamp, by: user.username, kind, key: rawKey, old, new: value }].slice(-200);

  const w = await DB.insert('rules?on_conflict=key',
    [{ key: 'cm:targets', value: t, updated_by: user.username }], true).catch((e) => ({ error: String(e && e.message || e) }));
  if (w && w.error) return { status: 502, body: { error: 'The change did not save: ' + w.error } };
  await loadCmContext(DB, { force: true });
  return { status: 200, body: { saved: true, kind, key: rawKey, old, new: value, stamp: t.stamp } };
}

export const blockageOf = (ctx, key) =>
  (ctx.blockages || []).find((b) => b.key === String(key || '')) || null;

/* ---------------------------------------------------------------------------
   AGGREGATION. One function, used for a team and for the whole campaign, so
   the reconciliation rule — "the campaign total must equal the sum of the
   teams shown, or the screen is lying" — holds by construction AND is asserted.
   --------------------------------------------------------------------------- */
function agg(rows, digest) {
  const n = (v) => (v == null || isNaN(v) ? 0 : Number(v));
  const o = { agents: rows.length, sales: 0, target: 0, gwp: 0, gwpT: 0, canc: 0,
    talk: 0, act: 0, emp: 0, fails: 0, ref: 0, qaN: 0, qaSum: 0, productive: 0, noGwp: [],
    calls: 0, ans: 0, leads: 0, leadsKnown: false, closed: 0, closedKnown: false, convSales: 0 };
  for (const r of rows) {
    o.sales += n(r.sales); o.target += n(r.target);
    o.gwp += n(r.gwpEx); o.gwpT += n(r.gwpT); o.canc += n(r.canc);
    o.talk += n(r.talk); o.act += n(r.act); o.emp += n(r.emp); o.ref += n(r.ref);
    o.fails += n(r.composite && r.composite.r2a && r.composite.r2a.fails);
    if (r.qa != null && !isNaN(r.qa)) { o.qaN++; o.qaSum += Number(r.qa); }
    o.calls += n(r.calls); o.ans += n(r.ans);
    /* leads is null until the case books are uploaded; one agent with a real count
       is enough to make the campaign figure meaningful, so track that separately
       rather than letting nulls read as zeros. */
    if (r.leads != null) { o.leads += n(r.leads); o.leadsKnown = true; }
    /* CLOSED LEADS (contract C1): every case closed in the period, any status. null = no case book was loaded when
       the digest was built — NOT an agent who closed none. The conversion's numerator is summed over the SAME rows
       that supply a denominator, so a mover's earlier segment (closed null) cannot inflate it. */
    if (r.closed != null) { o.closed += n(r.closed); o.closedKnown = true; o.convSales += n(r.sales); }
    if (n(r.act) > 0) o.productive++;
    if (n(r.sales) > 0 && !n(r.gwpEx)) o.noGwp.push(r.name || r.code);
  }
  const dd = Number(digest.diallingDays) || 0, wd = Number(digest.workingDays) || 0;
  o.qa = o.qaN ? o.qaSum / o.qaN : null;                        // mean of agent means
  o.aveG = o.sales ? o.gwp / o.sales : null;
  o.att = o.emp ? o.act / o.emp : null;
  o.talkPerDay = o.act ? o.talk / o.act : null;                 // secs per productive day
  o.cancRate = (o.sales + o.canc) ? o.canc / (o.sales + o.canc) : null;
  /* THE LEAD MEASURES. Conversion is the Lead Management rule — sales ÷ unique
     leads — and every one of these is null rather than zero when its denominator
     was never supplied. */
  o.conv = (o.leadsKnown && o.leads) ? o.sales / o.leads : null;
  o.contactRate = o.calls ? o.ans / o.calls : null;
  o.attempts = (o.leadsKnown && o.leads) ? o.calls / o.leads : null;
  o.leadCover = (o.leadsKnown && o.sales) ? o.leads / o.sales : null;
  /* MTD comparison prorates the full-month target by days worked — the digest's
     target is the whole month's, and comparing month-to-date sales to it made
     every team read 40% behind on the 12th. */
  o.targetMtd = wd ? o.target * Math.min(1, dd / wd) : o.target;
  o.pct = o.targetMtd ? o.sales / o.targetMtd : null;
  o.behind = o.pct != null && o.pct < 1;
  /* Projection: avg GWP per completed dialling day × planned dialling days —
     MTD only, and diallingDays/workingDays must not be confused: sending days-
     elapsed as days-planned is the R2,012-a-day bug PULSE already documented. */
  o.projGwp = dd ? (o.gwp / dd) * wd : null;
  return o;
}

/* THE JOIN BETWEEN A REQUEST AND ITS TEAM ROW IS THE CB NUMBER, NOT THE NAME.
   A card carries the name the team leader's ACCOUNT holds (full_name); the team
   row is keyed on the name the AGENT LIST holds (the digest's `tl`, which is
   app_users.team). Those are the same string for all nine team leaders today —
   which is exactly why joining on them was a bug waiting for somebody to fix a
   spelling: the register would still list the request, the control table would
   silently read "0 open", and the ladder would call a blocked team a leadership
   problem. CB is the identity base (non-negotiable 7), so join on that and keep
   the name only as the fallback for a card whose CB did not parse. */
const teamKeyOf = (tl, camp) => campKey(camp) + '|n:' + norm(tl).toLowerCase();
const teamKeyCb = (cb, camp) => campKey(camp) + '|c:' + String(cb || '').toUpperCase();

/**
 * The nine-rung diagnosis ladder — walked in order, first match wins. Its job
 * is to tell a leadership problem from a blockage (spec, rules.control_table).
 * `as` is that team's assistance summary from assist.mjs (zeros when the
 * pipeline is unreachable — a missing queue must not paint the floor green,
 * so an assist error is carried separately and shown on the page).
 */
function ladder(t, as, sla) {
  const qaT = (Number(sla.qa_target) || 90) / 100;
  const guard = (Number(sla.cancel_watch_pct) || 10) / 100;
  if (t.agents === 0)
    return { rag: 'n', state: 'No agents on this campaign', next: 'Confirm the allocation — an empty team is a finding, not an absence.' };
  if (as.outside > 0)
    return { rag: 'r', state: 'Blocked — outside SLA', next: 'Start or finish the assistance that is outside SLA.' };
  if (t.behind && as.open > 0)
    return { rag: 'r', state: 'Blocked, waiting on me', next: 'Clear ' + (as.openLabels[0] || 'the blockage').toLowerCase() + ' before coaching the number.' };
  if (t.behind && as.repeats > 0)
    return { rag: 'r', state: 'Repeat blockage', next: 'Fix the cause — coaching it again will not hold.' };
  if (t.behind && as.measured > 0 && as.improved < as.measured)
    return { rag: 'a', state: 'Supported, no change', next: 'Re-diagnose before assisting again.' };
  if (t.behind)
    return { rag: 'a', state: 'Behind — leadership action', next: 'Work it with the team leader directly.' };
  if ((t.qa != null && t.qa < qaT) || (t.cancRate != null && t.cancRate > guard))
    return { rag: 'a', state: 'Selling with risk', next: 'Review before it reverses.' };
  if (as.measured > 0 && as.improved === as.measured)
    return { rag: 'g', state: 'Improved after support', next: 'Record what worked so the next team gets it.' };
  return { rag: 'g', state: 'On target', next: '' };
}

/* ---------------------------------------------------------------------------
   THE KPI SHAPES THE CAMPAIGN TAB PAINTS (contract C2). Conversion is sales ÷ CLOSED leads; null — with a reason
   in words — when no case book was loaded or nothing closed, never a 0%. Contact rate is answered ÷ dials, with
   the counts; null with a reason when the dialler gave no dials.
   --------------------------------------------------------------------------- */
const CONV_BASIS = 'sales \u00f7 closed leads';
const convOf = (c, slaC) => (c.closedKnown && c.closed > 0
  ? { v: c.convSales / c.closed, sales: c.convSales, closed: c.closed, target: (Number(slaC.conv_target) || 10) / 100, basis: CONV_BASIS } : null);
const CONV_WHY = { unknown: 'Closed leads are not available for this period \u2014 the Salesforce case book was not loaded when it was built.',
  none: 'No leads were closed in this period, so there is nothing to divide the sales by.' };
const talkKpi = (c, tt) => ({ v: c.talkPerDay, targetMin: tt.targetMin, targetSec: tt.targetMin * 60, source: tt.source });
/* the All campaigns entry mixes campaigns that have different targets, so it names none (review fix 7a) */
const talkMixed = (c) => ({ v: c.talkPerDay, targetMin: null, targetSec: null, source: 'mixed' });
const contactOf = (c) => (c.calls ? { v: c.ans / c.calls, contacts: c.ans, dials: c.calls } : null);
const CONTACT_WHY = 'No dialler data for this period \u2014 there are no dials to measure contact against.';
/* spread into a kpis / team object: the reasons exist only while the figure is null */
const whyOf = (c, slaC) => ({
  ...(convOf(c, slaC) ? {} : { convWhy: c.closedKnown ? CONV_WHY.none : CONV_WHY.unknown }),
  ...(contactOf(c) ? {} : { contactWhy: CONTACT_WHY }) });

/* TENURE (contract C2). The digest spells a tenure as the Agent List does ('M0', 'M1', 'M2', 'Experienced', or
   blank); the selector speaks M0 | M1 | M2 | Exp | unset. A no-activity agent (covered === false) carries no
   tenure at all in the digest — such a row belongs to "all" only, never to a tenure slice and never to the
   picker's counts. */
export const TENURE_KEYS = ['M0', 'M1', 'M2', 'Exp', 'unset'];
const TENURE_LABELS = { M0: 'M0', M1: 'M1', M2: 'M2', Exp: 'Experienced', unset: 'Not set' };
export function tenureKey(raw) {
  const t = norm(raw);
  if (!t) return 'unset';
  if (/^exp/i.test(t)) return 'Exp';
  const m = /^m\s*([012])$/i.exec(t);
  return m ? 'M' + m[1] : 'unset';
}
const tenureOfRow = (r) => (r && r.covered === false ? null : tenureKey(r && r.tenure));
/** Is this row inside the chosen tenure slice? 'all' keeps every row (a no-activity agent included). */
export const rowInTenure = (r, tenure) => !tenure || tenure === 'all' || tenureOfRow(r) === tenure;
const tenuresOf = (rows) => {
  const n = {}; for (const r of rows) { const k = tenureOfRow(r); if (k) n[k] = (n[k] || 0) + 1; }
  return TENURE_KEYS.filter((k) => n[k]).map((k) => ({ key: k, label: TENURE_LABELS[k], agents: n[k] }));
};

/** The "Where my team leaders need help" panel for ONE campaign's requests — the same sums assist.mjs builds for the
 *  whole register (open · raised · agents affected · oldest · avg resolution · comes back), over just those rows. */
export function blockPanelFor(requests, blockages, nowMs = Date.now()) {
  const rows = requests || [];
  return (blockages || []).map((b) => {
    const mineB = rows.filter((r) => r.blockage === b.key);
    if (!mineB.length) return null;
    const openB = mineB.filter((r) => !r.closed);
    const oldest = openB.length ? Math.max(...openB.map((r) => nowMs - (r.requested ? Date.parse(r.requested) : nowMs))) : null;
    const res = mineB.map((r) => r.resolutionMins).filter((v) => v != null);
    return { key: b.key, label: b.label, routes_to: b.routes_to,
      open: openB.length, raised: mineB.length,
      affected: mineB.reduce((s2, r) => s2 + (r.affected || 0), 0),
      oldestDays: oldest == null ? null : Math.floor(oldest / 86400000),
      avgResolution: res.length ? Math.round(res.reduce((a2, v) => a2 + v, 0) / res.length) : null,
      comesBack: mineB.some((r) => r.repeat) };
  }).filter(Boolean);
}

/**
 * The whole campaign-manager overview body. `assist` is assist.mjs's list body
 * ({requests:[...], kpis:{...}} ) or {error} — the sales half must render even
 * when HighLevel is down, with the assistance half saying so plainly.
 */
export function cmOverviewBody(digest, auth, assist, ctx, opts) {
  const sla = (ctx && ctx.sla) || CM_SLA_DEFAULTS;
  /* ?tenure= — rows are filtered BEFORE any aggregation, so every figure, team row and the roster are the slice's
     own (a sum of sums is never taken). "all" is exactly the unfiltered view. The picker's list of tenures is
     cut from the UNFILTERED rows, so choosing one never empties the choices. */
  const tenure = (opts && opts.tenure) || 'all';
  const inSlice = (r) => tenure === 'all' || tenureOfRow(r) === tenure;
  const reqs = (assist && !assist.error && assist.requests) || [];
  const assistErr = assist && assist.error ? String(assist.error) : null;

  /* Per-team assistance summaries, keyed campaign|tl. */
  const perTeam = {};
  const teamAs = (k) => perTeam[k] || (perTeam[k] =
    { open: 0, outside: 0, near: 0, top: null, repeats: 0, openLabels: [], last: '', measured: 0, improved: 0 });
  for (const r of reqs) {
    /* filed under BOTH keys, so a team row finds it by whichever it can offer */
    const s = teamAs(r.cb ? teamKeyCb(r.cb, r.campaign) : teamKeyOf(r.tl, r.campaign));
    if (!r.closed) {
      s.open++;
      if (r.sla && r.sla.state === 'breached') s.outside++;
      if (r.sla && r.sla.state === 'near') s.near++;
      if (!s.openLabels.includes(r.blockageLabel)) s.openLabels.push(r.blockageLabel);
      if (!s.top || r.priority < s.top) s.top = r.priority;      // 'P1' < 'P2' lexically
    }
    if (r.repeat) s.repeats++;
    if (r.sessionEnd && r.sessionEnd > s.last) s.last = r.sessionEnd;
    if (r.outcome && r.outcome !== 'Not measurable') { s.measured++; if (r.outcome === 'Improved') s.improved++; }
  }

  const campaigns = [];
  for (const key of auth.campaigns || []) {
    const allRows = (auth.rows || []).filter((a) => campKey(a.campaign) === key);
    const rows = allRows.filter(inSlice);
    const label = allRows.length ? norm(allRows[0].campaign) : key.charAt(0).toUpperCase() + key.slice(1);
    /* Per-campaign dials (cm:targets settings) sit over the global cm:sla row —
       Courtesy and Cuddle can run different QA/talk/attendance/conversion bars. */
    const slaC = slaFor(ctx, key);
    const gwpMonthOv = (ctx && ctx.targets && ctx.targets.gwpMonth && ctx.targets.gwpMonth[key]) ?? null;

    /* teams: one team leader AND one campaign — the intersection. */
    const byTl = {};
    for (const a of rows) { const tl = norm(a.tl) || '(no team leader)'; (byTl[tl] = byTl[tl] || []).push(a); }
    const teams = Object.keys(byTl).sort().map((tl) => {
      const t = agg(byTl[tl], digest);
      const leader = (ctx && ctx.leaders && ctx.leaders[tl]) || null;
      /* CB first, name only when this leader has no account/CB on record */
      const as = (leader && leader.cb && perTeam[teamKeyCb(leader.cb, label)])
        || teamAs(teamKeyOf(tl, label));
      const lad = ladder(t, as, slaC);
      return { tl, cb: leader ? leader.cb : '', team: label + ' · ' + (tl.split(/\s+/)[0] || tl),
        agents: t.agents, sales: t.sales, target: Math.round(t.targetMtd), targetMonth: t.target,
        pct: t.pct, gwp: Math.round(t.gwp), aveG: t.aveG, qa: t.qa, canc: t.canc, cancRate: t.cancRate,
        conv: convOf(t, slaC), leads: t.leadsKnown ? t.leads : null, contactRate: contactOf(t), ...whyOf(t, slaC),
        att: t.att, talkPerDay: t.talkPerDay, fails: t.fails,
        open: as.open, top: as.top, outside: as.outside, near: as.near, repeats: as.repeats,
        lastSession: as.last || null,
        after: as.measured ? (as.improved === as.measured ? 'Improved' : (as.improved ? 'Mixed' : 'Unchanged')) : null,
        rag: lad.rag, state: lad.state, next: lad.next,
        codes: byTl[tl].map((a) => a.code) };
    });

    const c = agg(rows, digest);

    /* RECONCILIATION — asserted, not assumed, even though both sides sum the
       same rows. If this ever fires the digest itself is inconsistent, and the
       page must say so rather than print two different totals. */
    const tSales = teams.reduce((n, t) => n + t.sales, 0);
    const tGwp = teams.reduce((n, t) => n + t.gwp, 0);
    const reconciled = tSales === c.sales && Math.abs(tGwp - Math.round(c.gwp)) <= teams.length; // ±1 rounding per team

    /* The fourteen measures. null = not published yet; never a zero. */
    const kpis = {
      sales: { v: c.sales, target: Math.round(c.targetMtd), month: c.target, pct: c.pct },
      gwp: { v: Math.round(c.gwp), target: gwpMonthOv != null ? Math.round(gwpMonthOv) : Math.round(c.gwpT),
        set: gwpMonthOv != null || undefined, projected: c.projGwp == null ? null : Math.round(c.projGwp) },
      aveG: aveGKpi(c.aveG, slaC),
      /* No pitch count exists anywhere in this suite — answered calls are contacts,
         not pitches — so this stays honestly empty rather than borrowing `ans`. */
      pitches: null,
      conv: convOf(c, slaC),
      talk: talkKpi(c, talkTargetFor(ctx, key)),
      attempts: c.attempts == null ? null : { v: c.attempts,
        low: Number(slaC.attempts_low) || 3, high: Number(slaC.attempts_high) || 5 },
      contactRate: contactOf(c),
      ...whyOf(c, slaC),
      leads: c.leadsKnown ? { v: c.leads, cover: c.leadCover } : null,
      qa: { v: c.qa, target: (Number(slaC.qa_target) || 90) / 100 },
      checks: null,
      crit: { fails: c.fails, p1Open: reqs.filter((r) => !r.closed && r.priority === 'P1' && campKey(r.campaign) === key).length },
      canc: { v: c.canc, rate: c.cancRate, guard: (Number(slaC.cancel_watch_pct) || 10) / 100 },
      att: { v: c.att, target: (Number(slaC.att_target) || 95) / 100, productive: c.productive, agents: c.agents },
    };

    const projection = c.projGwp == null ? null : {
      perDay: Math.round(c.gwp / (Number(digest.diallingDays) || 1)),
      diallingDays: digest.diallingDays, workingDays: digest.workingDays,
      result: Math.round(c.projGwp),
    };

    const unattributed = {
      agents: c.noGwp,
      notCovered: (digest.notCovered || []).filter((n) => campKey(n.campaign) === key).map((n) => n.name),
    };

    campaigns.push({ key, label, agents: rows.length, teamLeaders: teams.length, tenures: tenuresOf(allRows),
      /* the expanded team roster prints NAMES; without this the page fell back
         to printing bare CB codes at a manager who wanted to see people */
      agentIndex: rows.map((a) => ({ code: a.code, name: a.name })),
      teams, kpis, projection, unattributed, reconciled,
      brief: cmBrief({ key, label, c, teams }, reqs, ctx) });
  }

  /* ---- ALL CAMPAIGNS, as one more entry -------------------------------------
     A manager holding more than one campaign still runs ONE floor, and the
     question "who are all my team leaders and how are they doing" has no answer
     on a page that can only show one campaign at a time.

     It is built HERE, from the same agent rows, for the same reason every other
     figure is: the page computes nothing. Summing the per-campaign KPIs on the
     client would be wrong anyway — an average of averages is not an average, and
     a percentage of percentages is not a percentage.

     The teams are CONCATENATED, not merged: a team is one leader AND one campaign
     (the spec's intersection rule), so a leader running two campaigns is two rows
     here exactly as they are two rows there. Renolan on Cuddle and Renolan on
     Nesting are different teams with different rosters and different numbers. */
  if (campaigns.length > 1) {
    const allRows = auth.rows || [];
    const rows = allRows.filter(inSlice);
    const c = agg(rows, digest);
    const teams = campaigns.flatMap((x) => x.teams);
    const tSales = teams.reduce((n, t) => n + t.sales, 0);
    const tGwp = teams.reduce((n, t) => n + t.gwp, 0);
    const leadRows = rows.filter((r) => r.leads != null);
    campaigns.unshift({
      key: 'all',
      label: 'All campaigns',
      agents: rows.length,
      teamLeaders: teams.length,
      /* how many PEOPLE, as distinct from how many team rows */
      leaders: [...new Set(teams.map((t) => t.tl))].length,
      tenures: tenuresOf(allRows),
      agentIndex: rows.map((a) => ({ code: a.code, name: a.name })),
      teams,
      kpis: {
        sales: { v: c.sales, target: Math.round(c.targetMtd), month: c.target, pct: c.pct },
        gwp: { v: Math.round(c.gwp), target: Math.round(c.gwpT), projected: c.projGwp == null ? null : Math.round(c.projGwp) },
        aveG: aveGKpi(c.aveG, sla),
        pitches: null,
        conv: convOf(c, sla),
        talk: talkMixed(c),   // mixed campaigns: no single target — the page says "targets differ by campaign"
        attempts: c.attempts == null ? null : { v: c.attempts,
          low: Number(sla.attempts_low) || 3, high: Number(sla.attempts_high) || 5 },
        contactRate: contactOf(c),
        ...whyOf(c, sla),
        leads: c.leadsKnown ? { v: c.leads, cover: c.leadCover } : null,
        qa: { v: c.qa, target: (Number(sla.qa_target) || 90) / 100 },
        checks: null,
        crit: { fails: c.fails, p1Open: reqs.filter((r) => !r.closed && r.priority === 'P1').length },
        canc: { v: c.canc, rate: c.cancRate, guard: (Number(sla.cancel_watch_pct) || 10) / 100 },
        att: { v: c.att, target: (Number(sla.att_target) || 95) / 100, productive: c.productive, agents: c.agents },
      },
      projection: c.projGwp == null ? null : {
        perDay: Math.round(c.gwp / (Number(digest.diallingDays) || 1)),
        diallingDays: digest.diallingDays, workingDays: digest.workingDays,
        result: Math.round(c.projGwp),
      },
      unattributed: {
        agents: c.noGwp,
        notCovered: campaigns.flatMap((x) => x.unattributed.notCovered),
      },
      reconciled: tSales === c.sales && Math.abs(tGwp - Math.round(c.gwp)) <= teams.length,
      brief: cmBrief({ key: 'all', label: 'All campaigns', c, teams }, reqs, ctx),
    });
  }

  /* Freshness — the language rule is absolute: manually uploaded information is
     never described as live. "Latest operational position", never "real time". */
  /* THE AMBER "OLDER THAN A DAY" BAND IS FOR THE CURRENT PERIOD ONLY (review fix 6): a closed month or billing
     month is published once and is meant to be old — it must not say "Waiting on new data". A custom range that is
     still filling (spec 006: it ends within the last 2 days and is rebuilt on every engine run) is not closed. */
  const closedPeriod = !!(opts && opts.periodKind && opts.periodKind !== 'current' && !opts.periodOpen);
  const age = digest.updatedAt ? (Date.now() - Date.parse(digest.updatedAt)) / 3600000 : null;
  const freshness = {
    updatedAt: digest.updatedAt || null,
    ageHours: age == null ? null : Math.round(age * 10) / 10,
    label: age == null ? 'No upload loaded' : closedPeriod ? 'Closed period \u2014 figures as published'
      : age < 6 ? 'Latest operational position' : age < 26 ? 'Last uploaded earlier today' : 'Waiting on new data',
    stale: !closedPeriod && age != null && age >= 26,
  };

  return { campaigns, freshness, sla, tenure,
    blockages: (ctx && ctx.blockages) || CM_BLOCKAGES_DEFAULTS,
    assistError: assistErr,
    notPublished: ['pitches', 'checks'] };
}

/* ---------------------------------------------------------------------------
   NIKOLA — deterministic. The rules decide what matters, the owner and the
   deadline; this only orders and words it. Never a decision about a person;
   every action names a human owner. Three signals, at most three actions.
   --------------------------------------------------------------------------- */
function cmBrief(camp, reqs, ctx) {
  const { c, teams, label, key } = camp;
  const mine = reqs.filter((r) => campKey(r.campaign) === key);
  const open = mine.filter((r) => !r.closed);
  const outside = open.filter((r) => r.sla && r.sla.state === 'breached');
  const near = open.filter((r) => r.sla && r.sla.state === 'near');

  const gap = Math.max(0, Math.round(c.targetMtd - c.sales));
  const pctStr = c.pct == null ? null : Math.round(c.pct * 100) + '% of target';
  const worst = teams.filter((t) => t.agents > 0).slice().sort((a, b) => (a.pct == null ? 1 : a.pct) - (b.pct == null ? 1 : b.pct))[0] || null;
  const worstOpen = worst ? open.filter((r) => norm(r.tl) === worst.tl) : [];

  const signals = [
    gap > 0 && pctStr ? 'Sales are ' + gap + ' behind the month-to-date target (' + pctStr + ').'
      : 'Sales are at or past the month-to-date target' + (pctStr ? ' (' + pctStr + ')' : '') + '.',
    (outside.length + near.length) + ' assistance request' + (outside.length + near.length === 1 ? ' is' : 's are') + ' outside or close to SLA.',
    !worst ? 'No teams on this campaign yet.'
      : (worst.pct != null && worst.pct < 1)
        ? (worst.team + ' is the largest single sales gap at ' + Math.round(worst.pct * 100) + '% of target'
          + (worstOpen.length ? ' and is blocked on ' + worstOpen[0].blockageLabel.toLowerCase() : ' with no blockage raised') + '.')
        : 'No team on this campaign is behind its month-to-date target.',
  ];

  /* Action ladder (spec, rules.nikola.action_priority) — at most three. */
  const actions = [];
  const ownerOf = (bk) => { const b = blockageOf(ctx || { blockages: CM_BLOCKAGES_DEFAULTS }, bk); return b ? b.owner : 'Campaign manager'; };
  for (const r of outside.slice(0, 2)) actions.push({
    what: 'Start assistance on ' + r.blockageLabel.toLowerCase() + ' for ' + r.team,
    why: 'Outside its ' + r.sla.target + '-minute SLA by ' + r.sla.over + ' minutes',
    owner: r.owner || ownerOf(r.blockage), due: 'Now — already ' + r.sla.over + ' minutes over',
    priority: r.priority, links_to: { kind: 'req', id: r.id } });
  for (const r of near) { if (actions.length >= 3) break; actions.push({
    what: 'Start assistance on ' + r.blockageLabel.toLowerCase() + ' for ' + r.team,
    why: 'Inside SLA with ' + r.sla.left + ' minutes left',
    owner: r.owner || ownerOf(r.blockage), due: r.sla.left + ' minutes',
    priority: r.priority, links_to: { kind: 'req', id: r.id } }); }
  if (actions.length < 3 && worst && worst.behind !== false && worst.pct != null && worst.pct < 1 && !worstOpen.length) actions.push({
    what: 'Work the sales gap on ' + worst.team + ' with ' + worst.tl.split(/\s+/)[0],
    why: 'Largest gap on the campaign with no assistance request open — a leadership conversation, not a blockage',
    owner: 'Campaign manager', due: 'Today', priority: 'P3', links_to: { kind: 'team', id: worst.tl } });
  if (actions.length < 3) {
    const rep = open.find((r) => r.repeat);
    if (rep) actions.push({
      what: 'Fix the cause of ' + rep.blockageLabel.toLowerCase() + ' on ' + rep.team,
      why: 'The same blockage has come back inside 30 days — fixing the case again will not stop it',
      owner: rep.owner || ownerOf(rep.blockage), due: 'This week', priority: 'P3', links_to: { kind: 'team', id: rep.tl } });
  }
  if (actions.length < 3) {
    const risk = teams.find((t) => t.rag === 'a' && t.state === 'Selling with risk');
    if (risk) actions.push({
      what: 'Review quality and cancellations on ' + risk.team,
      why: 'At target but creating quality or cancellation risk',
      owner: 'Campaign manager', due: 'This week', priority: 'P4', links_to: { kind: 'team', id: risk.tl } });
  }
  return { signals, actions: actions.slice(0, 3) };
}

/* ---------------------------------------------------------------------------
   THE EOD PACK — export_eod. Plain markdown a manager pastes into the evening
   thread. Composed from the same body the screen renders, so it cannot say
   something the screen does not.
   --------------------------------------------------------------------------- */
export function eodMarkdown(body, assist, who) {
  const L = [];
  const day = new Date().toISOString().slice(0, 10);
  L.push('# Campaign end-of-day — ' + day, '', '_' + (who || 'Campaign Manager') + ' · '
    + body.freshness.label + (body.freshness.updatedAt ? ' · data last uploaded ' + body.freshness.updatedAt.slice(0, 16).replace('T', ' ') : '') + '_', '');
  for (const c of body.campaigns) {
    const k = c.kpis;
    L.push('## ' + c.label, '',
      '- Sales: **' + k.sales.v + ' of ' + k.sales.target + '** month-to-date target'
        + (k.sales.pct != null ? ' (' + Math.round(k.sales.pct * 100) + '%)' : ''),
      '- GWP: **R' + (k.gwp.v || 0).toLocaleString('en-ZA') + '**'
        + (k.gwp.projected != null ? ' · projected R' + k.gwp.projected.toLocaleString('en-ZA') + ' by month end' : ''),
      '- QA: ' + (k.qa.v == null ? 'not measured' : Math.round(k.qa.v * 100) + '%')
        + ' · Attendance: ' + (k.att.v == null ? 'not measured' : Math.round(k.att.v * 100) + '%'),
      '');
    L.push('| Team | Sales / target | GWP | Open | Status | Next action |', '|---|---|---|---|---|---|');
    for (const t of c.teams) L.push('| ' + t.team + ' | ' + t.sales + ' / ' + t.target + ' | R'
      + t.gwp.toLocaleString('en-ZA') + ' | ' + (t.open || 0) + (t.top ? ' (' + t.top + ')' : '') + ' | '
      + t.state + ' | ' + (t.next || '—') + ' |');
    L.push('');
    if (c.brief.actions.length) {
      L.push('**Next actions**');
      c.brief.actions.forEach((a, i) => L.push((i + 1) + '. ' + a.what + ' — ' + a.why + '. Owner: ' + a.owner + '. Due: ' + a.due + '.'));
      L.push('');
    }
  }
  if (assist && assist.kpis) {
    const a = assist.kpis;
    L.push('## Assistance', '',
      '- ' + a.received + ' received · ' + a.open + ' open · ' + a.withinSla + ' answered inside SLA'
        + (a.answered ? ' (' + Math.round((a.slaPct || 0)) + '% of answered)' : ''),
      '- Follow-ups due: ' + a.followUpsDue + ' · overdue: ' + a.followUpsOverdue,
      '');
  }
  return L.join('\n');
}
