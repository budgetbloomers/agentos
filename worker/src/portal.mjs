/**
 * AGENT ANALYTICS PORTAL — authorisation and data slicing.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE: an agent sees their own figures and
 * nothing else; a team leader sees their own team and nothing else. Not "the UI
 * only renders their own" — the bytes that leave the Worker never contain anyone
 * else's numbers. Nothing here trusts a code, id or name supplied by the caller:
 * every scope is derived from the SESSION, and a caller-supplied CB number is
 * only ever used to pick from a set that was already computed from the session.
 *
 * WHY IT SLICES THE DIGEST RATHER THAN THE STATE: `kv:vas-state` is 16.6 MB of
 * case rows, contact details and every agent's money. `kv:agent-digest` is the
 * 36 KB agent-safe extract PULSE already publishes from the same model that
 * renders the Agent Performance tab — no case rows, no contact details, no QA
 * critical fails, no risk tiers, nothing from Ops or Tracker. Reusing it means
 * the portal reconciles with management analytics by construction (a difference
 * means the digest is stale, not that a second formula drifted) and means no MTD
 * calculation is written twice.
 */

import { getCoaching, rollUp, sessionsForAgent, withinWindow, CX_RULES, coachAnalysis, sessionThemes, STALE_HOURS, LM_TYPE_LABEL } from './coaching.mjs';
import { campKey, cmOverviewBody, effectiveCamps, blockPanelFor, rowInTenure, TENURE_KEYS } from './campaign.mjs';
import { cycleRange, cyclesNow } from './cycle.mjs';   // the billing month (26th–25th), spec 001-cm-view-signoff
import { withFloorEx, checksFor, VAT } from './rules.mjs';
import { drillFor } from './drill.mjs';   // the KPI drill-down verdicts (sprint 2026-09-29, item 3)
/* what drillFor needs beyond the agent row: the floor's ex-VAT twin and how far the month has run */
const drillCtx = (digest, nba) => ({ floorEx: withFloorEx(nba && nba.thresholds).gwpFloorEx,
  workingDays: digest.workingDays, daysWithData: digest.daysWithData, dates: digest.dates, period: digest.period });   // one number, one verdict (2026-09-07): the floor and the two checks are decided once

export const PORTAL_ROLES = new Set(['agent', 'team_leader', 'campaign_manager']);

/* THE ALLOW-LIST. Deny by default: a portal session may reach these paths and
   nothing else, so every route added to this Worker in future is closed to
   agents until somebody deliberately opens it. /api/me and /api/logout are here
   because auth-gate needs them; /api/password because a first-login password
   change must work. Note what is NOT here: /api/kv (the entire 16.6 MB
   vas-state), /api/bi, /api/eod, /api/ask, /api/agent-link, /api/campaign-stats,
   /api/referrals, /api/coaching (the management org-wide view). */
export const PORTAL_ALLOWED = new Set([
  '/api/me',
  '/api/logout',
  '/api/password',
  /* The Wimpy app (2026-09-10). Its own sign-in mints a wimpy-scoped session that index.mjs
     confines to these two; a FULL agent session (Agent Analytics) may reach them as well. They
     answer for the caller alone: the menu, and the caller's own order. */
  '/api/wimpy/menu',
  '/api/wimpy/order',
  '/api/portal/me',
  '/api/portal/overview',
  '/api/portal/agent',
  /* The team leader's Variance and Lead management tabs (2026-09-21): a slice of two report keys
     PULSE publishes, cut by the same authorise() as the overview — nothing computed here. */
  '/api/portal/tl/reports',
  /* Nikola. Scoped by the same authorise() as the overview it is built from, so it
     can only ever discuss the caller's own results. */
  '/api/portal/ask',
  /* The two hubs. Proxied — the browser never reaches Convex, and the leader id
     comes from the session, never the request. */
  '/api/portal/hub/coaching',
  '/api/portal/hub/kpi',
  /* The Help Center (help.mjs). Proxied to HighLevel — the browser never holds the
     key. request = agents only; list/detail/stage = team leaders, scoped to their
     own team by the same authorise() as everything above. */
  '/api/portal/help/request',
  '/api/portal/help/list',
  '/api/portal/help/detail',
  '/api/portal/help/stage',
  /* The ladder's coaching-action status (help.mjs actionsList/actionSet) — team
     leaders only, one status per agent+rule+weekly review. */
  '/api/portal/help/actions',
  '/api/portal/help/action',
  /* Coaching fails — recurring Hub themes flagged into their own pipeline. */
  '/api/portal/help/fails',
  '/api/portal/help/fail',
  '/api/portal/help/fail-detail',
  /* Coaching Hub backup into the "Coaching Sessions" pipeline. */
  '/api/portal/help/sync-coaching',
  /* An agent's own requests: see where each stands, close their own off. */
  '/api/portal/help/mine',
  '/api/portal/help/close',
  /* Nick's six steps + the leader's icon (sprint 2026-09-29): confirm = the agent's own request only
     ("Yes, I was helped" / "Not yet"); pulse = the Help Center icon's count, team leaders only. */
  '/api/portal/help/confirm',
  '/api/portal/help/pulse',
  /* CAMPAIGN ASSISTANCE (assist.mjs) — the team-leader → campaign-manager
     pipeline. request = team leaders only; the register, actions and EOD pack
     are role-gated in the handlers, exactly as the help routes are. */
  /* CAMPAIGN TARGET SETTINGS — Dalwin's dials (campaign.mjs cmSettingsBody/Apply). */
  '/api/portal/cm/settings',
  '/api/portal/cm/request',
  '/api/portal/cm/assist',
  '/api/portal/cm/detail',
  '/api/portal/cm/act',
  '/api/portal/cm/eod',
  /* THE CAMPAIGN MANAGER'S VIEW OF HIS TEAM LEADERS' COACHING (spec 001-cm-view-signoff, C3). Manager only — the
     handler 403s everyone else — and scoped server-side to the leaders of the manager's own campaigns. */
  '/api/portal/cm-coaching',
  /* Wimpy ordering moved to /api/wimpy/* (listed above) when it became its own app on
     2026-09-10; the old /api/portal/wimpy/* paths answer 410 in index.mjs and are no longer
     declared here — verify-agent-portal F5 fails on a declared route the Worker does not serve. */
]);

export const normCb = (v) => {
  const d = String(v == null ? '' : v).toUpperCase().replace(/[^0-9]/g, '');
  return d ? 'CB' + String(parseInt(d, 10)) : '';
};

/**
 * The agent-safe digest PULSE publishes, with the team map applied.
 *
 * WHY THERE IS A SECOND SOURCE FOR `tl`. The digest is published by a BROWSER —
 * whichever PULSE tab is open pushes it every 90 seconds. That is fine for
 * figures, which only need to be fresh, but `tl` is not a figure: it is the
 * input to a team leader's AUTHORISATION. Making it depend on someone having the
 * newest build open means a colleague on a stale tab can silently empty a team
 * leader's page, which is exactly what happened while this was built. So the
 * roster's agent→team-leader map is also kept as its own small key, written by
 * tools/provision-agent-logins.mjs straight from the Agent List, and merged in
 * wherever the digest does not carry it. The digest still wins when it has a
 * value — it is the period-correct leader, and this map is only a floor.
 */
/* THE TEAM-LEADER REPORT KEYS (2026-09-21): kv:agent-reports-variance / kv:agent-reports-leads,
   published by PULSE beside the digest. Same load path as loadDigest — the pointer row's data, else
   the storage object — one parse per key per minute per isolate. Never merged into the digest: the
   digest travels to every agent's own page, these travel only to a team leader's slice. */
export async function loadReports(DB, kind) {
  if (!/^(variance|leads)$/.test(String(kind || ''))) return null;
  const key = 'kv:agent-reports-' + kind;
  const cc = (globalThis.__reportCaches = globalThis.__reportCaches || {});
  const c = cc[key];
  if (c && Date.now() - c.t < 60000) return c.d;
  const r = await DB.select(`rules?key=eq.${encodeURIComponent(key)}&select=value`);
  const v = r?.[0]?.value || {};
  let payload = String(v.data || '');
  if (!payload && v.store) payload = (await DB.storageGet('raw', v.store.replace(/^raw\//, ''))) || '';
  if (!payload) return null;
  const d = JSON.parse(payload);
  cc[key] = { t: Date.now(), d };
  return d;
}

/** GET /api/portal/tl/reports?kind=variance|leads — the team leader's slice of a report key.
 *  Only a TEAM scope (or staff preview) may read it: an agent has no team, a campaign manager has
 *  the campaign view. The slice is by the digest's authorise(): agents keyed by the caller's own
 *  codes, the team block for the caller's own team string — never the whole team map (its keys
 *  are leaders' names). Nothing is summed or derived here; PULSE published every figure. */
export function tlReports(user, digest, report, kind) {
  const auth = authorise(user, digest);
  if (auth.error) return { status: auth.status, body: { error: auth.error } };
  if (auth.scope === 'agent') return { status: 403, body: { error: 'The Variance and Lead management reports are a team leader page.' } };
  if (!report) return { status: 404, body: { error: 'This report has not been published yet — it follows PULSE within a couple of minutes of the next upload.' } };
  const agents = {};
  for (const code of auth.codes) if (report.agents && report.agents[code] != null) agents[code] = report.agents[code];
  const teams = {}, teamsByCamp = {}, campaigns = {};
  let campBlocks;   // campaign managers only: 'ok' | 'none' (published, nothing under their campaigns) | 'absent' (published before the blocks existed)
  if (auth.staff) { Object.assign(teams, report.teams || {}); Object.assign(teamsByCamp, report.teamsByCamp || {}); Object.assign(campaigns, report.campaigns || {}); }
  else if (auth.scope === 'campaign') {
    /* THE CAMPAIGN MANAGER (2026-09-21): a team is one leader AND one campaign (campaign.mjs), so the
       leader-only blocks never travel here — a leader running two campaigns would carry a campaign
       this manager does not hold. Only the leader × campaign blocks and the campaign totals of the
       campaigns the account is ASSIGNED, matched on campKey like everything else on this view. */
    const mine = new Set((auth.campaigns || []).map(campKey));
    /* the block NAMES its campaign (review 2026-09-21 PM) — the "<campaign>|<leader>" key is only
       read for a report published before it did, and a campaign spelt with a "|" must never leak
       another leader's block through the split. */
    const campOfBlock = (k, b) => campKey(b && b.camp != null ? b.camp : k.split('|')[0]);
    const tbc = report.teamsByCamp || {}, cps = report.campaigns || {};
    for (const k in tbc) if (mine.has(campOfBlock(k, tbc[k]))) teamsByCamp[k] = tbc[k];
    for (const k in cps) if (mine.has(campOfBlock(k, cps[k]))) campaigns[k] = cps[k];
    campBlocks = !report.teamsByCamp ? 'absent' : Object.keys(teamsByCamp).length ? 'ok' : 'none';
  }
  else if (report.teams && report.teams[auth.team] != null) teams[auth.team] = report.teams[auth.team];
  const { agents: _a, teams: _t, teamsByCamp: _tc, campaigns: _c, ...floor } = report;   // rules, days, checks, statuses, book … — nobody named
  return { status: 200, body: { ...floor, kind, agents, teams, teamsByCamp, campaigns, team: auth.team || '', scope: auth.scope, missing: Math.max(0, auth.codes.size - Object.keys(agents).length), ...(campBlocks ? { campBlocks } : {}) } };
}

export async function loadDigest(DB, month) {
  /* month ('YYYY-MM', optional) selects a HISTORY digest - kv:agent-digest-2026-07 -
     published per month so people can look back (Nick 2026-08-26). No month = the live
     digest, exactly as before. One cache per key, same 60s. */
  const key = month ? 'kv:agent-digest-' + month : 'kv:agent-digest';
  const cc = (globalThis.__digestCaches = globalThis.__digestCaches || {});
  const c = cc[key];
  if (c && Date.now() - c.t < 60000) return c.d;
  const [r, tr] = await Promise.all([
    DB.select(`rules?key=eq.${encodeURIComponent(key)}&select=value`),
    DB.select(`rules?key=eq.${encodeURIComponent('kv:agent-teams')}&select=value`).catch((e) => { console.warn('agent-teams read failed — tl merge skipped', String(e && e.message || e)); return null; }),
  ]);
  const v = r?.[0]?.value || {};
  let payload = String(v.data || '');
  if (!payload && v.store) payload = (await DB.storageGet('raw', v.store.replace(/^raw\//, ''))) || '';
  if (!payload) return null;
  const d = JSON.parse(payload);
  const teams = tr?.[0]?.value?.teams || null;
  if (teams) for (const list of [d.agents || [], d.notCovered || []])
    for (const a of list) if (!a.tl && teams[a.code]) a.tl = teams[a.code];
  cc[key] = { t: Date.now(), d };
  return d;
}

/* The months a user may filter to: every published history digest, newest first, found by
   key prefix so publishing a month IS listing it - no second registry to forget. Cached
   like the digests themselves. */
export async function listDigestMonths(DB) {
  const c = globalThis.__digestMonths;
  if (c && Date.now() - c.t < 60000) return c.m;
  let m = [];
  try {
    const rows = await DB.select(`rules?key=like.${encodeURIComponent('kv:agent-digest-%')}&select=key`);
    m = (rows || []).map((r) => String(r.key).slice('kv:agent-digest-'.length))
      .filter((k) => /^\d{4}-\d{2}$/.test(k)).sort().reverse();
  } catch (e) { m = []; }
  globalThis.__digestMonths = { t: Date.now(), m };
  return m;
}

/* The billing-cycle digests that exist (kv:agent-digest-cycle-YYYY-MM, written by tools/digest-republish.mjs): found
   by key prefix like the months, so publishing one IS listing it. Cached like the digests themselves. */
export async function listDigestCycles(DB) {
  const c = globalThis.__digestCycles;
  if (c && Date.now() - c.t < 60000) return c.s;
  let s = new Set();
  try {
    const rows = await DB.select(`rules?key=like.${encodeURIComponent('kv:agent-digest-cycle-%')}&select=key`);
    s = new Set((rows || []).map((r) => String(r.key).slice('kv:agent-digest-'.length)).filter((k) => /^cycle-\d{4}-\d{2}$/.test(k)));
  } catch (e) { s = new Set(); }
  globalThis.__digestCycles = { t: Date.now(), s };
  return s;
}

/* ---------------------------------------------------------------------------
   THE CAMPAIGN MANAGER'S TWO SELECTORS (spec 001-cm-view-signoff, contract C2): ?period= and ?tenure=. Both are
   validated here and both apply to role campaign_manager ONLY — agents and team leaders keep the "no month filter"
   stance (a team leader's page always reads the live digest).
   --------------------------------------------------------------------------- */
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthLabelOf = (ym) => MONTH_NAMES[Number(String(ym).slice(5, 7)) - 1] + ' ' + String(ym).slice(0, 4);
const lastDayOf = (ym) => new Date(Date.UTC(Number(String(ym).slice(0, 4)), Number(String(ym).slice(5, 7)), 0)).toISOString().slice(0, 10);
const sastMonth = (nowMs) => new Date(nowMs + 2 * 3600000).toISOString().slice(0, 7);

/** 'all' (also for blank) | M0 | M1 | M2 | Exp | unset; null for anything else (the caller answers 400 bad_tenure). */
export function parseTenure(v) {
  if (v == null || v === '') return 'all';
  const t = String(v);
  return t === 'all' || TENURE_KEYS.includes(t) ? t : null;
}

/** ?period= → {kind:'current'|'month'|'cycle', key, from?, to?, label?} | {error:'bad_period'}. 'current' (the default)
 *  takes its dates from the live digest, so it carries none here. The retired ?month=YYYY-MM is read when no period is given. */
export function resolvePeriod(q, nowMs = Date.now()) {
  const given = q && q.period != null && q.period !== '' ? String(q.period) : null;
  const raw = given != null ? given : (q && /^\d{4}-\d{2}$/.test(String(q.month || '')) ? String(q.month) : 'current');
  if (raw === 'current') return { kind: 'current', key: 'current' };
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(raw)) return { kind: 'month', key: raw, from: raw + '-01', to: lastDayOf(raw), label: monthLabelOf(raw) };
  const cy = /^cycle-\d{4}-(0[1-9]|1[0-2])$/.test(raw) ? cycleRange(raw) : null;
  if (cy) return { kind: 'cycle', key: cy.key, from: cy.from, to: cy.to, label: cy.label };
  return { error: 'bad_period' };
}

/* the period object the page prints: {kind, key, from, to, label} — 'current' reads the live digest's own dates */
function periodOf(per, digest, nowMs) {
  if (per.kind !== 'current') return { kind: per.kind, key: per.key, from: per.from, to: per.to, label: per.label };
  const dp = (digest && digest.period) || {};
  const from = dp.from || sastMonth(nowMs) + '-01';
  return { kind: 'current', key: 'current', from, to: dp.to || lastDayOf(from.slice(0, 7)), label: monthLabelOf(from.slice(0, 7)) };
}

/**
 * GET /api/portal/overview, whole: the period/tenure rules for a campaign manager, the unchanged live-or-?month=
 * behaviour for everyone else. index.mjs hands in `getAssist(digest)` (assist.mjs must not be imported here — it
 * imports authorise from this file, and a cycle fails at parse); it answers the register body or {error}.
 */
export async function overviewRequest(env, DB, user, q, opts) {
  const { getAssist, nowMs = Date.now() } = opts || {};
  q = q || {};
  if (user.role !== 'campaign_manager') {
    const mq = String(q.month || '');
    const month = /^\d{4}-\d{2}$/.test(mq) ? mq : null;
    const digest = await loadDigest(DB, month);
    if (!digest) return { status: 404, body: { error: month ? 'No figures were published for ' + month + '.' : 'Nothing has been published yet. Check again a little later.' } };
    return overview(env, DB, user, digest, await listDigestMonths(DB), undefined);
  }
  const per = resolvePeriod(q, nowMs);
  if (per.error) return { status: 400, body: { error: 'bad_period' } };
  const tenure = parseTenure(q.tenure);
  if (tenure === null) return { status: 400, body: { error: 'bad_tenure' } };

  const digest = await loadDigest(DB, per.kind === 'current' ? null : per.key);
  if (!digest) {
    if (per.kind === 'current') return { status: 404, body: { error: 'Nothing has been published yet. Check again a little later.' } };
    return { status: 404, body: { error: 'period_not_published', period: { key: per.key, from: per.from, to: per.to, label: per.label },
      message: 'The figures for ' + per.label + ' have not been published yet. The 15-minute refresh builds them \u2014 check again shortly.' } };
  }
  const [months, cycles] = await Promise.all([listDigestMonths(DB), listDigestCycles(DB)]);
  const assist = getAssist ? await Promise.resolve(getAssist(digest)).catch((e) => ({ error: String((e && e.message) || e).slice(0, 200) }))
    : { error: 'Assistance data was not loaded.' };
  const r = await overview(env, DB, user, digest, months, { assist, tenure, periodKind: per.kind });
  if (r.status !== 200) return r;
  const cn = cyclesNow(nowMs);
  r.body.period = periodOf(per, digest, nowMs);
  r.body.periods = { months, cycles: [cn.current, cn.last].map((c) => ({ key: c.key, from: c.from, to: c.to, label: c.label, complete: c.complete, published: cycles.has(c.key) })) };
  return r;
}

/**
 * The NBA digest Ops publishes — decision-ladder answer, composite, R2A tier and
 * two-check status per agent. Read exactly like the agent digest. Absent is a
 * normal state (nobody has opened Ops since the publisher shipped) and the page
 * says so, rather than drawing an empty table that reads as "nobody needs an
 * action".
 *
 * THIS IS TEAM LEADER MATERIAL AND NOTHING ELSE. It carries critical-fail counts
 * and R2A tiers — the very things the agent-facing digest bans. `overview()`
 * attaches it only for a team scope, so an agent's payload never contains it and
 * no route serves it raw.
 */
export async function loadNba(DB) {
  const c = globalThis.__nbaCache;
  if (c && Date.now() - c.t < 60000) return c.d;
  /* a failed read is said, and the last good copy is kept — "not published" was shown for both (2026-09-21) */
  const r = await DB.select(`rules?key=eq.${encodeURIComponent('kv:nba-digest')}&select=value`).catch((e) => { console.warn('nba-digest read failed', String(e && e.message || e)); return c ? [{ value: null, __cached: true }] : null; });
  if (r && r[0] && r[0].__cached) return c.d;
  const v = r?.[0]?.value || {};
  let payload = String(v.data || '');
  if (!payload && v.store) payload = (await DB.storageGet('raw', v.store.replace(/^raw\//, ''))) || '';
  if (!payload) return null;
  let d = null;
  try { d = JSON.parse(payload); } catch { return null; }
  globalThis.__nbaCache = { t: Date.now(), d };
  return d;
}

/* Everyone the digest knows about: the 84 agents with figures, plus the
   `notCovered` roster entries (Vehicle Tracking and no-activity agents) who have
   a name and a team but deliberately no numbers. Both carry `tl`, so both can be
   scoped — a VT agent on a team leader's list must still be listed as theirs
   rather than vanishing. */
/* One row per (agent, campaign) for a mover — every other agent passes through unchanged. Only the
   campaign-manager scope reads rows this way (item 2, D4). Each segment row carries ITS campaign's figures
   and ITS days only (security review, 2026-09-29: a spread of the whole row leaked the other campaign's day
   rows and totals). Figures the digest only has for the whole month (talk, calls, QA, cancellations,
   referrals, ranks, the rating) travel once, on the CURRENT campaign's row — never on the earlier one, and
   never twice — the same attribution tools/verify-cm-numbers.mjs reconciles against. */
/* WHAT AN EARLIER-CAMPAIGN SEGMENT ROW MAY CARRY (review fix, 2026-10-01 — an ALLOWLIST; the earlier denylist
   (WHOLE_MONTH_ONLY) let any field the digest grew later ride along to the manager of the mover's OLD campaign).
   Identity the report renderers need, plus the figures that PULSE cut by campaign segment (S.moves) and the days of
   that segment. Everything else — talk, calls, QA, composite, aveTalk, the weekly rows, the rating, closed leads,
   whatever the engine adds next — exists only on the CURRENT campaign's row, once. */
export const SEGMENT_ROW_KEYS = ['code', 'name', 'tl', 'tenure', 'covered', 'why',
  'campaign', 'sales', 'gwpEx', 'target', 'pctT', 'act', 'emp', 'spd', 'aveG', 'plan', 'att', 'gwp', 'days', 'segment'];
export function bySegment(rows) {
  const out = [];
  for (const r of rows || []) {
    if (!r || !Array.isArray(r.segments) || r.segments.length < 2) { out.push(r); continue; }
    r.segments.forEach((s, i) => {
      const cur = i === r.segments.length - 1, to = s.to || '9999-12-31';
      const cut = { campaign: s.campaign, sales: s.sales, gwpEx: s.gwpEx, target: s.target, pctT: s.pctT,
        act: s.act, emp: s.emp, spd: s.spd, aveG: s.aveG, plan: s.plan,
        att: s.emp ? s.act / s.emp : null,
        gwp: s.gwpEx != null ? Math.round(s.gwpEx * VAT * 100) / 100 : null,
        days: (r.days || []).filter((d) => d && d.d >= s.from && d.d <= to),
        segment: { from: s.from, to: s.to } };
      if (cur) { const { segments: _drop, ...whole } = r; out.push({ ...whole, ...cut }); return; }   // the current campaign: the whole row, its own segment figures over it
      const row = {};
      for (const k of SEGMENT_ROW_KEYS) if (k in r) row[k] = r[k];
      out.push(Object.assign(row, cut));
    });
  }
  return out;
}

function everyone(digest) {
  const rows = (digest.agents || []).map((a) => ({ ...a, covered: true }));
  for (const n of digest.notCovered || [])
    rows.push({ code: n.code, name: n.name, tl: n.tl || '', campaign: n.campaign || '', covered: false, why: n.why });
  return rows;
}

/**
 * Resolve the signed-in user to the exact set of agent codes they may see.
 * Returns { scope, cb, team, codes:Set, rows:[] } or { error, status }.
 */
export function authorise(user, digest) {
  const all = everyone(digest);
  const byCode = new Map(all.map((a) => [a.code, a]));

  if (user.role === 'agent') {
    const cb = normCb(user.cb);
    if (!cb) return { error: 'This account is not linked to a CB number yet. Ask your team leader.', status: 403 };
    const me = byCode.get(cb);
    /* An agent who is on the payroll but not in this period's data is a real
       state, not an error — they get their identity and an honest empty month
       rather than "no match", which reads as "the company has lost me". */
    if (!me) return { scope: 'agent', cb, team: '', codes: new Set([cb]), rows: [], missing: true };
    return { scope: 'agent', cb, team: me.tl || '', codes: new Set([cb]), rows: [me] };
  }

  if (user.role === 'team_leader') {
    const team = String(user.team || '').trim();
    /* Fail LOUDLY, never to an empty team. An empty list and "we cannot tell
       which team is yours" look identical on screen and mean opposite things —
       one is a quiet month, the other is a broken account. */
    if (!team) return { error: 'This team leader account is not linked to a team yet. Ask Nick to re-run the provisioning tool.', status: 403 };
    const rows = all.filter((a) => String(a.tl || '').trim() === team);
    if (!rows.length) return { error: `No agents are currently assigned to "${team}" on the Agent List. If your team has been renamed there, the link needs re-syncing.`, status: 409 };
    return { scope: 'team', cb: normCb(user.cb), team, codes: new Set(rows.map((r) => r.code)), rows };
  }

  /* THE CAMPAIGN MANAGER — the third view. Scope is the campaigns this account
     is ASSIGNED (cm:assignments via loadCmContext), never anything the request
     says: there is no request shape in which a manager can name a campaign they
     do not hold. The context is loaded per-request by index.mjs before any
     dispatch; authorise() itself must stay sync for its dozen callers, so a
     missing context fails loudly rather than quietly scoping to nothing. */
  if (user.role === 'campaign_manager') {
    const ctx = globalThis.__cmCtx;
    if (!ctx) return { error: 'Campaign assignments are not loaded — try again in a moment.', status: 503 };
    /* assignment + every unowned campaign the list created (migration-019) — see
       effectiveCamps. Only campaigns the digest actually carries make a screen: VT and
       a campaign with no agents yet fall away here rather than as an empty card. */
    const camps0 = effectiveCamps(ctx, user.username);
    if (!camps0.length) return { error: 'This campaign manager account is not assigned to a campaign yet. Ask Nick to update cm:assignments.', status: 403 };
    /* A MOVER COUNTS ONCE PER CAMPAIGN (sprint 2026-09-29, item 2; D4): a campaign manager sees only the
       days an agent worked on THEIR campaign — the Download & Test manager keeps a mover's first fortnight,
       the Courtesy manager gets the rest, and neither sees the other's figures. */
    const allC = bySegment(all);
    const present = new Set(allC.map((r) => campKey(r.campaign)));
    const camps = camps0.filter((k) => present.has(k));
    const rows = allC.filter((r) => camps.includes(campKey(r.campaign)));
    if (!rows.length) return { error: 'No agents are currently on ' + camps0.join(', ') + ' in the published digest.', status: 409 };
    return { scope: 'campaign', cb: normCb(user.cb), team: '', campaigns: camps,
      codes: new Set(rows.map((r) => r.code)), rows, leaders: ctx.leaders || {} };
  }

  /* Management. admin and exec already see every agent's figures in PULSE's Agent
     Performance tab, so letting them open the portal over the whole roster leaks
     nothing they do not already have — and it is the only way to check what an
     agent actually sees without borrowing someone's password. Every other role
     (viewer, qa, and the management `tl` used by Ops) is refused: their access is
     defined by their own app's tab permissions, not by this portal. */
  if (user.role === 'admin' || user.role === 'exec') {
    return { scope: 'all', cb: normCb(user.cb), team: '', codes: new Set(all.map((a) => a.code)), rows: all, staff: true };
  }

  return { error: 'Agent Analytics is for agents and team leaders. Sign in with your CB number.', status: 403 };
}

/* Peer context, anonymous — the same campaign|tenure cut the digest already
   publishes. Never a named colleague; only the group average travels. */
const peersFor = (digest, row) =>
  (row && digest.groups && digest.groups[row.campaign + '|' + row.tenure]) || null;

/* THE TOP PERFORMERS (Nick, 2026-09-15: "the top performers … add that to the agent view in
   agent analytics"). This deliberately opens the one window the agent view kept shut — colleagues
   are NAMED here, with their sales and premium — because Nick asked for exactly that. Bounded:
   the floor's top TOP_N by premium written (the same basis as the rank boxes), from the digest's
   reported agents only. Nobody below the cut travels — and NO team list (Nick, the same day:
   "only the top 10 performers, not in their team"); the leader's name does not travel either. */
const TOP_N = 10;
export const topPerformers = (digest, cb) => {
  const all = (digest.agents || []).filter((a) => a && a.code && ((a.gwpEx || 0) > 0 || (a.sales || 0) > 0))
    .sort((a, b) => (b.gwpEx || 0) - (a.gwpEx || 0) || (b.sales || 0) - (a.sales || 0));
  /* THEIR OWN CAMPAIGN'S TOP TEN (Nick, 2026-09-21: "if we are looking at a Courtesy view agent they
     need to see the top 10 in their campaign"). Courtesy and Cuddle sell different products at
     different premiums, so a floor-wide ladder was a Cuddle ladder with Courtesy nowhere on it.
     The agent's campaign comes from their own digest row; an agent with no campaign (or none on
     record with sales) sees the floor, and the card says which it is. */
  const me = (digest.agents || []).find((a) => a && normCb(a.code) === cb) || null;
  const camp = me && String(me.campaign || '').trim();
  const rows = camp ? all.filter((a) => String(a.campaign || '').trim().toLowerCase() === camp.toLowerCase()) : all;
  const pick = (a, i) => ({ pos: i + 1, name: a.name || a.code, campaign: a.campaign || '', tenure: a.tenure || '',
    sales: a.sales || 0, gwpEx: a.gwpEx || 0, me: normCb(a.code) === cb });
  const mine = rows.find((a) => normCb(a.code) === cb) || null;
  return { floor: rows.slice(0, TOP_N).map(pick), myPos: mine ? rows.indexOf(mine) + 1 : null, n: rows.length,
    campaign: camp || null, basis: 'premium written (ex-VAT), month to date' };
};

/** The bits of the digest that are not about any particular person. */
const envelope = (digest) => ({
  period: digest.period,
  updatedAt: digest.updatedAt,
  diallingDays: digest.diallingDays,
  workingDays: digest.workingDays,
  dates: digest.dates,
  weeks: digest.weeks || [],   // Monday-anchored weeks, for the portal's Weekly view
  /* how PULSE prints talk averages (MTD_RULES.aveTalkUnit) — the mirrored tables print them
     the same way, so "152,0" on one screen is never "2h 32m" on the other (2026-09-10) */
  talkUnit: digest.talkUnit || 'minutes',
  comm: digest.comm,
  /* the model in force for the CURRENT month while the digest is still the closed one (2026-10-01) — the
     calculator projects the new month from it. This envelope hand-picks its fields, so it must be named. */
  commNow: digest.commNow || null,
  /* THE MONTH BEFORE ITS FIRST DATA (spec 002 C1, 2026-10-01): an empty-month payload says so, and every page shows
     "No <Month> figures yet" from this flag — the live check found it missing here, so pages painted blanks. */
  empty: digest.empty === true || undefined,
  /* THE COMPOSITE'S DRIVER LABELS. They travel once per digest rather than once per
     agent, so they live out here — and this envelope hand-picks its fields, so leaving
     them out meant the page had no names for the rows and printed the raw keys
     ("gwpSale", "targetAch") to every agent. */
  compositeDrivers: digest.compositeDrivers || null,
});

/* ---------------------------------------------------------------------------
   COACHING ATTRIBUTION (spec 002-live-month-sync-coaching, contract C4, 2026-10-01).
   A session with an agent CB belongs to that agent's CURRENT team leader (the digest row / Agent List), whoever
   logged it — on the live Hub all 28 lead-management sessions sit under Dalwin's Hub profile, a campaign manager
   who is not on the list, and a profile-keyed view dropped every one. A session without a CB (a group session)
   stays with the logging profile. Every session shown to a view says who coached (`coach`, the Hub leader's name)
   and whether that person is a list team leader or has a team-leader account (`coachIsTl`), beside the
   type / typeLabel / collection the Hub gave it. Pure helpers; nothing here reads the Hub.
   --------------------------------------------------------------------------- */
const LM_LABEL = LM_TYPE_LABEL;
const LM_COLLECTION = 'leadManagementCoaching';
const isLmSession = (s) => !!s && (s.collection === LM_COLLECTION || s.typeLabel === LM_LABEL || s.type === LM_LABEL);
const nrm = (v) => String(v == null ? '' : v).toLowerCase().replace(/\s+/g, ' ').trim();

/** Who counts as a team leader: every `tl` the digest names, plus the team-leader accounts the request already loaded. */
export function tlContext(digest) {
  const names = new Set(), ids = new Set();
  for (const r of [...((digest && digest.agents) || []), ...((digest && digest.notCovered) || [])]) { const t = nrm(r && r.tl); if (t) names.add(t); }
  const accts = (globalThis.__cmCtx && globalThis.__cmCtx.leaders) || {};
  for (const team of Object.keys(accts)) {
    const a = accts[team]; if (!a) continue;
    if (a.hubId) ids.add(a.hubId);
    for (const n of [team, a.name]) if (n) names.add(nrm(n));
  }
  return { names, ids };
}

/** A session as the views receive it: the Hub's own fields plus who coached and whether they lead a team. */
export function withCoach(s, tctx) {
  const coach = String((s && s.hubTeamLeader) || '').trim();
  const isTl = !!(tctx && s && ((s.hubTeamLeaderId && tctx.ids.has(s.hubTeamLeaderId)) || (coach && tctx.names.has(nrm(coach)))));
  return { ...s, coach, coachIsTl: isTl };
}

/** {from, to} of a digest period, its end stretched to the month's last day (a session logged today is this month's). */
function coachPeriod(period) {
  const from = (period && period.from) || '';
  if (!from) return null;
  const monthEnd = lastDayOf(from.slice(0, 7));
  return { from, to: period.to && period.to > monthEnd ? period.to : monthEnd, label: monthLabelOf(from.slice(0, 7)) };   // the label names the month lmCount is over ("October 2026")
}
const inRange = (s, w) => !w || (s.date && s.date >= w.from && s.date <= w.to);

/**
 * Coaching for an authorised scope. Never throws the request away on a Hub
 * failure: the rest of the page is unaffected and must still render, so the
 * failure travels as `coaching.error` and the UI says so plainly.
 */
export async function coachingFor(env, DB, rows, opts = {}) {
  try {
    const hub = await getCoaching(env, DB);
    /* THE WINDOW IS NOW ACTUALLY APPLIED (audit, 2026-08-28). `windowDays: 90` was a label
       on lifetime counts: an agent with 23 sessions since February was told "23 sessions in
       the last 90 days", and the persistent-theme tier that escalates to a Level 1
       compliance review was computed over that lifetime set — while the agent's own drawer
       DID apply the window and quietly disagreed. One window, applied once, here. */
    const WINDOW_DAYS = 90;
    /* The coaching layer's own thresholds travel with the payload — the escalation window
       (30 days), the repeat and persistent bands, and the staleness line (14 days) — so the
       pages read the rule book instead of each keeping a copy of the numbers. */
    const out = { fetchedAt: hub.fetchedAt, coachingAt: hub.fetchedAt || null, stale: !!hub.stale, windowDays: WINDOW_DAYS, cx: CX_RULES };
    const tctx = tlContext(opts.digest), lmWin = coachPeriod(opts.period);
    if (lmWin) out.lmPeriod = lmWin;   // lmCount counts inside this period; byType stays the 90-day window
    const windowed = withinWindow(hub.sessions, WINDOW_DAYS);
    if (hub.stale) out.staleSince = hub.staleSince;
    /* A PARTIAL PULL MUST NOT READ AS A QUIET MONTH. If some of the Hub's
       collections failed, the counts below are understated — say so in the
       payload rather than letting a team leader believe their team had less
       coaching than it did. */
    if (hub.errors && hub.errors.length) { out.partial = true; out.errors = hub.errors.slice(0, 5); out.errorCount = hub.errors.length; }

    const per = [];
    let unmatchedByName = 0;
    const lmIds = new Set();
    for (const r of rows) {
      const found = sessionsForAgent(windowed, r.code, r.name);
      const matchedBy = found.matchedBy;
      const sessions = found.sessions.map((x) => withCoach(x, tctx));
      if (matchedBy === 'name' && sessions.length) unmatchedByName++;
      /* Per PRODUCT, not just a total. The Coaching Hub keeps six separate
         coaching products and counts them separately on its own dashboard;
         collapsing them into one number loses what a team leader is actually
         asked — whether the FORMAL coaching happened, not whether some coaching
         did. Cheap to send (six integers) and it means the page never has to
         hold every session just to count them. */
      const byType = { [LM_LABEL]: 0 };   // always present: "no lead-management coaching" is a 0, never a missing key
      for (const s of sessions) byType[s.type] = (byType[s.type] || 0) + 1;
      const lmHere = sessions.filter((s) => isLmSession(s) && inRange(s, lmWin || { from: '', to: '9999-12-31' }));
      for (const s of lmHere) lmIds.add(s.id || (s.date + '|' + s.cb));

      /* A GROUP SESSION NAMES EVERYONE WHO WAS THERE — and those names must not travel
         (audit, 2026-08-28). Unioning group coaching in was right, but the raw record
         carries `attendees` and, for a group record, an `agentName` belonging to whoever
         the Hub filed it under. Shipping that put colleagues' names into an agent's own
         payload, which the portal's isolation rule forbids and its own test caught. The
         attendance is kept; the roll-call is dropped. */
      const safe = sessions.map((s) => {
        if (!s.attendees && (!s.agentName || s.cb)) return s;      // an ordinary coded session
        const { attendees, ...rest } = s;
        return { ...rest, agentName: r.name, groupSession: !s.cb || undefined };
      });
      per.push({
        code: r.code,
        name: r.name,
        sessions: opts.withSessions ? safe : undefined,
        count: sessions.length,
        byType,
        lmCount: lmHere.length,
        last: sessions.length ? sessions[0].date : '',
        themes: rollUp(sessions),
        matchedBy,
      });
    }
    out.agents = per;
    /* The same product split across the whole scope, so a team leader's coaching
       page can lead with it without adding up six columns by hand. */
    out.byType = { [LM_LABEL]: 0 };
    out.lmCount = lmIds.size;
    for (const a of per) for (const k of Object.keys(a.byType)) out.byType[k] = (out.byType[k] || 0) + a.byType[k];
    /* DISTINCT sessions, not the sum of per-agent counts (audit, 2026-08-28). One group
       session attended by five people was counted five times in the team total, so a leader
       read "40 sessions with 9 of your people" for 22 actual sessions. */
    const distinct = new Set();
    for (const a of per) for (const s of (opts.withSessions ? (a.sessions || []) : []))
      distinct.add(s.id || (String(s.date || '') + '|' + String(s.type || '')));
    out.totals = {
      sessions: opts.withSessions ? distinct.size : per.reduce((n, a) => n + a.count, 0),
      attendances: per.reduce((n, a) => n + a.count, 0),   // seats coached — a group session counts per attendee
      agents: per.filter((a) => a.count).length,
      /* Coach-CHOSEN themes across the scope. On the live Hub this is 0 for
         everyone because every classified session is `inferred` — read the note
         in coaching.mjs before treating that as a bug. */
      scored: per.reduce((n, a) => n + a.themes.reduce((m, t) => m + t.scored, 0), 0),
      matchedByName: unmatchedByName,
    };
    return out;
  } catch (e) {
    return { error: String(e.message || e).slice(0, 300) };
  }
}

/* THE COACHING ANALYSIS PER AGENT (contract C4). One read of the Hub copy (getCoaching's isolate cache — the 1.3 MB
   snapshot is parsed at most once per ten minutes), the period's sessions cut ONCE, then one pure coachAnalysis per
   row. Null when the copy cannot be read: the page says so rather than reading "no coaching". The period's end is the
   month's last day — a session logged today is this month's even though the data lands tomorrow. */
async function coachByAgent(env, DB, rows, period) {
  let hub;
  try { hub = await getCoaching(env, DB); } catch (e) { return null; }
  const p = period || {};
  const from = p.from || '';
  const monthEnd = from ? lastDayOf(from.slice(0, 7)) : '9999-12-31';
  const to = p.to && p.to > monthEnd ? p.to : monthEnd;
  const inPeriod = (hub.sessions || []).filter((s) => s.date && s.date >= from && s.date <= to);
  const out = new Map();
  for (const r of rows) out.set(r.code, coachAnalysis(sessionsForAgent(inPeriod, r.code, r.code ? '' : r.name).sessions, r.days, { from, to }));   // review L2: a row WITH a CB matches on the CB alone — two agents can share a name
  return out;
}

/* ---------------------------------------------------------------------------
   GET /api/portal/cm-coaching?tl=&period= — THE CAMPAIGN MANAGER'S VIEW OF HIS TEAM LEADERS' COACHING (contract C3).

   Manager only (403 for every other role, admin included — the page is the manager's). SCOPE IS SERVER-SIDE: the
   leaders offered are the team leaders of the manager's EFFECTIVE campaigns, found from the digest rows (a leader's
   campaign = the one most of their agents are on), so `?tl=` can only ever pick from that set — anything else is a
   404 and never says whether such a leader exists. Sessions come from the kv:coaching snapshot, matched to the
   leader by app_users.hub_ids.coaching first, then by the Hub's team-leader name; only the chosen leader's, inside
   the period, newest first, at most 300 (the leader table still counts them all). A missing copy is a 503, never an
   empty list that would read as "nobody was coached". A group session names its attendees instead of one agent.
   --------------------------------------------------------------------------- */
const CM_COACH_MAX = 300;
const COACHING_HUB_URL = 'https://coaching-hub-psi.vercel.app/';
const normName = (v) => String(v == null ? '' : v).toLowerCase().replace(/\s+/g, ' ').trim();

export async function cmCoaching(env, DB, user, digest, q, nowMs = Date.now()) {
  if (user.role !== 'campaign_manager') return { status: 403, body: { error: 'Team leaders\u2019 coaching is a campaign manager page.' } };
  const auth = authorise(user, digest);
  if (auth.error) return { status: auth.status, body: { error: auth.error } };
  q = q || {};
  const per = resolvePeriod(q, nowMs);
  if (per.error) return { status: 400, body: { error: 'bad_period' } };
  const pd = periodOf(per, digest, nowMs);
  const from = pd.from, to = per.kind === 'current' ? lastDayOf(pd.from.slice(0, 7)) : pd.to;

  /* the leaders in scope, and the campaign each leads (the one most of their agents are on) */
  const seen = new Map();
  for (const r of auth.rows) {
    const name = String(r.tl || '').trim(); if (!name) continue;
    const slot = seen.get(name) || seen.set(name, { name, camps: {} }).get(name);
    const c = String(r.campaign || '').trim(); slot.camps[c] = (slot.camps[c] || 0) + 1;
  }
  const leaders = [...seen.values()].map((l) => ({ name: l.name,
    campaign: Object.keys(l.camps).sort((a, b) => l.camps[b] - l.camps[a] || a.localeCompare(b))[0] || '' }))
    .sort((a, b) => campKey(a.campaign).localeCompare(campKey(b.campaign)) || a.name.localeCompare(b.name));

  let hub;
  try { hub = await getCoaching(env, DB); }
  catch (e) { return { status: 503, body: { error: 'The Coaching Hub copy is not available: ' + String((e && e.message) || e).slice(0, 160) } }; }

  /* who is whose: hub id from the leader's account, name as the fallback (the account's name and the Agent List's) */
  const accounts = (globalThis.__cmCtx && globalThis.__cmCtx.leaders) || {};
  const byId = new Map(), byNm = new Map();
  for (const l of leaders) {
    const acct = accounts[l.name] || null;
    if (acct && acct.hubId) byId.set(acct.hubId, l.name);
    for (const nm of [l.name, acct && acct.name]) if (nm) byNm.set(normName(nm), l.name);
  }
  /* REVIEW L1: a leader is in scope when ANY of their agents is on the manager's campaigns, but their coaching notes
     about the OTHER campaign's agents are not the manager's to read. A session is kept only when it is about an agent
     the manager's scope holds: its CB in auth.codes; a group session by its attendees (names — the Hub records no CB for
     them) matched to the scope's agents, and shown with only those attendees; a session with neither is attributable
     only to the leader's whole team, so it is kept only when EVERY agent of that leader is on the manager's campaigns.
     The leader table's counts follow the same filter. */
  const scopeCodes = new Set([...auth.codes].map(normCb));
  const scopeByName = new Map();
  for (const r of auth.rows) if (r.name && r.code) scopeByName.set(normName(r.name), r.code);
  const mineCamps = new Set((auth.campaigns || []).map(campKey));
  const wholeTeamIn = new Map();
  for (const r of [...(digest.agents || []), ...(digest.notCovered || [])]) {
    const tl = String(r.tl || '').trim(); if (!tl) continue;
    if (!mineCamps.has(campKey(r.campaign))) wholeTeamIn.set(tl, false); else if (!wholeTeamIn.has(tl)) wholeTeamIn.set(tl, true);
  }
  const attribute = (s, owner) => {
    if (s.cb) { const cb = normCb(s.cb); return scopeCodes.has(cb) ? { name: String(s.agentName || ''), keys: [cb] } : null; }
    if (s.attendees && s.attendees.length) {
      const inn = s.attendees.filter((n) => scopeByName.has(normName(n)));
      return inn.length ? { name: inn.join(', ').slice(0, 200), keys: inn.map((n) => scopeByName.get(normName(n))) } : null;
    }
    if (!wholeTeamIn.get(owner)) return null;
    const nm = normName(s.agentName);
    return { name: String(s.agentName || ''), keys: nm ? [scopeByName.get(nm) || nm] : [] };
  };
  /* OWNER = THE AGENT'S CURRENT TEAM LEADER BY CB FIRST, THEN THE HUB LEADER (spec 002 C4, 2026-10-01). A session with an
     agent CB belongs to whoever leads that agent now on the Agent List, whichever Hub profile logged it — Dalwin's 28
     lead-management sessions sit under a profile that is no list team leader, and were dropped here before. A session
     with no CB (a group one) stays with the logging profile. The scope filter below (CB in the manager's codes) is
     untouched, and so are the incomplete flags. */
  const leaderByName = new Map(leaders.map((l) => [normName(l.name), l.name]));
  const tlByCb = new Map();
  for (const r of [...(digest.agents || []), ...(digest.notCovered || [])]) if (r && r.code && r.tl) tlByCb.set(normCb(r.code), normName(r.tl));
  const tctx = tlContext(digest);
  const slots = new Map(leaders.map((l) => [l.name, { sessions: [], agents: new Set(), last: null }]));
  for (const s of hub.sessions || []) {
    if (!s.date || s.date < from || s.date > to) continue;
    const owner = (s.cb && leaderByName.get(tlByCb.get(normCb(s.cb)))) || byId.get(s.hubTeamLeaderId) || byNm.get(normName(s.hubTeamLeader));
    if (!owner) continue;
    const who = attribute(s, owner);
    if (!who) continue;
    const slot = slots.get(owner);
    slot.sessions.push({ s, name: who.name });
    for (const k of who.keys) if (k) slot.agents.add(k);
    if (!slot.last || s.date > slot.last) slot.last = s.date;
  }
  /* an incomplete copy (pairs that failed even after their retries): the leaders it names are NOT "0 sessions, fresh" */
  const incompleteSet = new Set();
  for (const f of hub.failedLeaders || []) { const n = byId.get(f && f.id) || byNm.get(normName(f && f.name)); if (n) incompleteSet.add(n); }

  const want = normName(q.tl);
  let chosen = null;
  if (want) {
    chosen = leaders.find((l) => normName(l.name) === want) || null;
    if (!chosen) return { status: 404, body: { error: 'That team leader is not on your campaigns.' } };
  }
  const onList = new Set([...(digest.agents || []), ...(digest.notCovered || [])].map((a) => normCb(a.code)));
  const sessions = !chosen ? [] : slots.get(chosen.name).sessions.slice()
    .sort((a, b) => String(b.s.date).localeCompare(String(a.s.date))).slice(0, CM_COACH_MAX)
    .map(({ s, name }) => { const w = withCoach(s, tctx); return { date: s.date,
      agentName: name,
      cb: s.cb || null, onList: !!s.cb && onList.has(normCb(s.cb)), type: s.type || s.typeLabel || '',
      typeLabel: s.typeLabel || s.type || '', collection: s.collection || '', coach: w.coach, coachIsTl: w.coachIsTl,
      themes: sessionThemes(s), supportProvided: s.supportProvided ? String(s.supportProvided) : null }; });

  const ageHours = hub.fetchedAt ? Math.round(((nowMs - Date.parse(hub.fetchedAt)) / 3600000) * 10) / 10 : null;
  const behind = chosen ? incompleteSet.has(chosen.name) : incompleteSet.size > 0;
  /* type counts per leader and for the whole scope — the period's (this payload only ever holds the period's sessions);
     'Lead Management Coaching' is always a key, 0 when none, and lmCount is the same number for the headline */
  const typesOf = (list) => { const t = { [LM_LABEL]: 0 }; for (const { s } of list) { const k = s.type || s.typeLabel || ''; if (k) t[k] = (t[k] || 0) + 1; } return t; };
  const lmOf = (list) => list.filter(({ s }) => isLmSession(s)).length;
  const scopeTypes = { [LM_LABEL]: 0 }; let scopeLm = 0;
  for (const sl of slots.values()) { for (const [k, n] of Object.entries(typesOf(sl.sessions))) scopeTypes[k] = (scopeTypes[k] || 0) + n; scopeLm += lmOf(sl.sessions); }
  return { status: 200, body: { fetchedAt: hub.fetchedAt || null, coachingAt: hub.fetchedAt || null, byType: scopeTypes, lmCount: scopeLm, stale: ageHours == null || ageHours > STALE_HOURS || behind, ageHours,
    incomplete: [...incompleteSet].sort(),
    hubUrl: COACHING_HUB_URL, period: { from, to, label: pd.label },
    leaders: leaders.map((l) => { const sl = slots.get(l.name); return { name: l.name, campaign: l.campaign, sessions: sl.sessions.length, agentsCoached: sl.agents.size, last: sl.last, incomplete: incompleteSet.has(l.name), byType: typesOf(sl.sessions), lmCount: lmOf(sl.sessions) }; }),
    tl: chosen ? chosen.name : null, sessions } };
}

/* ---------------------------------------------------------------------------
   THE TL HUB TAB'S "COACHING ON YOUR AGENTS BY OTHERS" (spec 002 C4, 2026-10-01). The tab's own list is read LIVE from
   Convex under the TL's own Hub profile only (hubs.mjs coachingList), so a session another profile logged on this
   leader's agents — Dalwin's lead-management coaching above all — never appeared. `others` is that list, from the
   kv:coaching snapshot: sessions in the requested window (?days=N, default 90, or ?from=&to=) whose agent CB is one of
   the leader's own agents (the digest's team, the same set authorise() scoped) and that were logged under ANOTHER Hub
   profile, newest first, at most 300, each with `coach` / `coachIsTl`. A leader with no Coaching Hub id of their own
   has no live list to avoid duplicating: their own name is the only thing excluded. `coachingAt` is the snapshot's
   age stamp. A missing copy or a refused scope is `others: null` plus `othersError` — never an empty list that would
   read as "nobody else coached your people". Pure of the Hub: one getCoaching read (the isolate cache).
   --------------------------------------------------------------------------- */
const OTHERS_MAX = 300, OTHERS_DAYS_DEFAULT = 90, OTHERS_DAYS_MAX = 366;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
export async function coachingOthers(env, DB, user, digest, q, nowMs = Date.now()) {
  const none = (why, at = null) => ({ others: null, coachingAt: at, othersError: why });
  if (!user || user.role !== 'team_leader') return none('Only a team leader has a Hub tab.');
  const auth = authorise(user, digest);
  if (auth.error) return none(auth.error);
  let hub;
  try { hub = await getCoaching(env, DB); }
  catch (e) { return none('The Coaching Hub copy is not available: ' + String((e && e.message) || e).slice(0, 160)); }
  q = q || {};
  const days = Math.min(OTHERS_DAYS_MAX, Math.max(1, parseInt(q.days, 10) || OTHERS_DAYS_DEFAULT));
  const from = ISO_DAY.test(String(q.from || '')) ? String(q.from) : new Date(nowMs - days * 86400000).toISOString().slice(0, 10);
  const to = ISO_DAY.test(String(q.to || '')) ? String(q.to) : '9999-12-31';
  const mine = new Set([...auth.codes].map(normCb));
  const ownId = user.hub_ids && user.hub_ids.coaching ? String(user.hub_ids.coaching) : '';
  const ownName = normName(user.full_name || user.team);
  const tctx = tlContext(digest);
  const others = (hub.sessions || [])
    .filter((s) => s.cb && mine.has(normCb(s.cb)) && s.date && s.date >= from && s.date <= to
      && (ownId ? s.hubTeamLeaderId !== ownId : normName(s.hubTeamLeader) !== ownName))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .slice(0, OTHERS_MAX)
    .map((s) => { const w = withCoach(s, tctx); return { id: s.id || null, date: s.date, cb: s.cb, agentName: String(s.agentName || ''),
      type: s.type || s.typeLabel || '', typeLabel: s.typeLabel || s.type || '', collection: s.collection || '',
      coach: w.coach, coachIsTl: w.coachIsTl, themes: sessionThemes(s), supportProvided: s.supportProvided ? String(s.supportProvided) : null }; });
  return { others, coachingAt: hub.fetchedAt || null, othersWindow: { from, to: to === '9999-12-31' ? null : to } };
}

/** Team totals — summed from the same per-agent figures the digest publishes. */
function teamTotals(rows) {
  const cov = rows.filter((r) => r.covered);
  const sum = (f) => cov.reduce((n, r) => n + (Number(r[f]) || 0), 0);
  const avgOf = (f) => { const v = cov.filter((r) => r[f] != null); return v.length ? v.reduce((n, r) => n + Number(r[f]), 0) / v.length : null; };
  const gwpEx = sum('gwpEx'), sales = sum('sales'), target = sum('target');
  return {
    agents: rows.length,
    reporting: cov.length,
    gwpEx: Math.round(gwpEx * 100) / 100,
    sales: Math.round(sales * 100) / 100,
    target: Math.round(target * 100) / 100,
    /* Percent to target on the TEAM's totals, not the average of each agent's
       percentage — averaging percentages weights a quiet M0 the same as a full
       Exp desk and flatters or punishes a team for its mix. */
    pctT: target ? Math.round((sales / target) * 10000) / 10000 : null,
    aveG: sales ? Math.round((gwpEx / sales) * 100) / 100 : null,
    /* ATTENDANCE IS SHIFTS OVER SHIFTS, NOT A MEAN OF PERCENTAGES — specs/mtd_engine_rules
       .json, tl_mtd_construction: "% Of Attendance = Total Actual Shifts / Total Employed
       Shifts". Averaging each agent's own percentage weights a two-day starter the same as
       a full-month desk, and it disagreed with the Grand Total row on this app's own Month
       to date tab, which has always summed. QA below stays a mean of agent means because
       the same rule book says so ("AVERAGE of agent QA scores, excluding No QA %"). */
    att: (() => { const emp = sum('emp'), act = sum('act');
      return emp ? Math.round((act / emp) * 10000) / 10000 : null; })(),
    qa: avgOf('qa') == null ? null : Math.round(avgOf('qa') * 10000) / 10000,
    ref: sum('ref'),
    onTarget: cov.filter((r) => (r.pctT || 0) >= 1).length,
  };
}

/**
 * The MTD "Team Leaders" block for a team scope (Nick, 2026-09-10) — this leader's own
 * column(s) and the total of each campaign they sit in, exactly as PULSE published them
 * (digest.tlAgg / digest.campAgg). Sliced by the SAME team string authorise() scoped the
 * rows on, so a leader gets their own column and never a colleague's; the campaign total is
 * an aggregate with nobody named in it, the same footing as the anonymous peer groups an
 * agent already receives. A staff scope ('all') gets every column. Null when the digest
 * predates the block, and the page says so instead of drawing an empty table.
 */
function teamSummary(digest, auth) {
  if (!Array.isArray(digest.tlAgg) || !digest.campAgg) return null;
  const team = String(auth.team || '').trim();
  const teams = auth.staff ? digest.tlAgg.slice()
    : digest.tlAgg.filter((t) => String(t.tl || '').trim() === team);
  const camps = [...new Set(teams.map((t) => t.camp))];
  const campaigns = {};
  for (const c of camps) if (digest.campAgg[c]) campaigns[c] = digest.campAgg[c];
  return { onTarget: digest.onTarget == null ? 1 : digest.onTarget, talkUnit: digest.talkUnit || 'minutes', teams, campaigns };
}

/** Daily team sales — element-wise sum of the per-agent sparklines already published. */
function teamSpark(rows, dates) {
  const out = new Array((dates || []).length).fill(0);
  for (const r of rows) (r.spark || []).forEach((v, i) => { if (i < out.length) out[i] += Number(v) || 0; });
  return out.map((v) => Math.round(v * 100) / 100);
}

/** GET /api/portal/overview — the signed-in user's whole dashboard, already scoped. */
export async function overview(env, DB, user, digest, months, extra) {
  const auth = authorise(user, digest);
  if (auth.error) return { status: auth.status, body: { error: auth.error } };

  const base = { ...envelope(digest), months: months || [], role: user.role, name: user.full_name || user.username, cb: auth.cb };

  if (auth.scope === 'agent') {
    const me = auth.rows[0] || null;
    /* THE LINKS TAB (Nick, 2026-09-08: "add a tab that says links … a screenshot of each one" —
       agent view only). kv:agent-links is written by tools/agent-links.mjs; each item carries its
       address and a JPEG data-URI screenshot. Agents only — the team and campaign bodies do not carry it. */
    let links = [];
    try { const lr = await DB.select('rules?key=eq.' + encodeURIComponent('kv:agent-links') + '&select=value'); links = (lr && lr[0] && lr[0].value && lr[0].value.items) || []; } catch (e) { links = []; }
    const coaching = await coachingFor(env, DB, me ? [me] : [{ code: auth.cb, name: base.name }], { withSessions: true, digest, period: digest.period });
    /* THE AGENT'S OWN LADDER ROW (Nick, 2026-08-26: the My Progress redesign shows an
       agent their rating, next best action and the two checks — the same things a team
       leader reads to them in a one-to-one). This DELIBERATELY narrows the earlier
       team-only rule rather than reversing it: exactly one row travels — their own —
       never a colleague's figures and never the team ladder. Same {agents:[…]} shape
       as the team payload so the page's nbaBy() reads both. */
    let nba = null;
    try {
      const nd = await loadNba(DB);
      if (nd && Array.isArray(nd.agents)) {
        const hit = nd.agents.find((x) => normCb(x.cb) === auth.cb) || null;
        if (hit) nba = { updatedAt: nd.updatedAt, period: nd.period, workDays: nd.workDays,
          thresholds: withFloorEx(nd.thresholds), agents: [hit] };
      }
    } catch { nba = null; }
    /* THE TWO CHECKS, DECIDED HERE (one number, one verdict — 2026-09-07). The page used to
       compare aveG against a floor it derived itself and disagreed with the rating row. */
    if (me) me.checks = checksFor(me, nba && nba.thresholds);
    /* THE KPI DRILL-DOWN, DECIDED HERE (sprint 2026-09-29, item 3): each Today tile's status, what
       drives it, the action and whether to ask the team leader — the page paints, never judges */
    if (me) me.drill = drillFor(me, drillCtx(digest, nba));
    return {
      status: 200,
      body: {
        ...base,
        me,
        /* Not in this period's data — say which of the two reasons it is. */
        notReported: auth.missing ? (digest.notCovered || []).find((n) => n.code === auth.cb) || { why: 'nodata' } : null,
        peers: peersFor(digest, me),
        top: topPerformers(digest, auth.cb),
        team: auth.team,
        coaching,
        nba,
        links,
      },
    };
  }

  /* THE CAMPAIGN MANAGER'S OVERVIEW. The sales half is computed here from the
     digest; the assistance half arrived via `extra` (index.mjs fetched it so
     this module never imports assist.mjs — assist imports authorise from here,
     and a cycle is how a Worker fails to even parse). HighLevel being down
     must not blank the sales screen: assist travels as {error} and the page
     says so beside numbers that still render. */
  if (auth.scope === 'campaign') {
    const assist = (extra && extra.assist) || { error: 'Assistance data was not loaded.' };
    const cmCtx = globalThis.__cmCtx;
    const tenure = (extra && extra.tenure) || 'all';
    const body = cmOverviewBody(digest, auth, assist, cmCtx, { tenure, periodKind: (extra && extra.periodKind) || 'current' });
    /* THE CM'S REPORT DATA (contract C2): the SAME agent rows the team overview returns, for the manager's campaigns
       inside the chosen tenure, plus the engine's own leader and campaign blocks cut to those campaigns — nothing is
       summed here (the blocks are whole-period aggregates PULSE built, so a tenure slice does not re-cut them).
       `summary` is the team-scope shape over the same blocks so the team renderers read it unchanged. null when the
       digest predates the blocks — absent, not empty. */
    const agents = auth.rows.filter((r) => rowInTenure(r, tenure)).sort((a, b) => (b.gwpEx || 0) - (a.gwpEx || 0));
    const mine = new Set((auth.campaigns || []).map(campKey));
    const hasBlocks = Array.isArray(digest.tlAgg) && !!digest.campAgg;
    const tlAgg = hasBlocks ? digest.tlAgg.filter((t) => mine.has(campKey(t.camp))) : null;
    const campAgg = hasBlocks ? Object.fromEntries(Object.entries(digest.campAgg).filter(([k]) => mine.has(campKey(k)))) : null;
    const summary = hasBlocks ? { onTarget: digest.onTarget == null ? 1 : digest.onTarget, talkUnit: digest.talkUnit || 'minutes', teams: tlAgg, campaigns: campAgg } : null;
    /* the help panel per campaign (assist.blockPanelByCamp): the register's own rows, one campaign at a time */
    const reqs = assist.error ? [] : (assist.requests || []);
    const blockPanelByCamp = {};
    for (const key of auth.campaigns || []) blockPanelByCamp[key] = blockPanelFor(reqs.filter((r) => campKey(r.campaign) === key), (cmCtx && cmCtx.blockages) || [], Date.now());
    return { status: 200, body: { ...base, scope: 'campaign', staff: false,
      campaigns: auth.campaigns, cm: body, agents, tlAgg, campAgg, summary,
      assist: assist.error ? { error: assist.error } : { stages: assist.stages, requests: assist.requests,
        kpis: assist.kpis, blockPanel: assist.blockPanel, truncated: assist.truncated, blockPanelByCamp } } };
  }

  const rows = auth.rows.slice().sort((a, b) => (b.gwpEx || 0) - (a.gwpEx || 0));
  const coaching = await coachingFor(env, DB, rows, { digest, period: digest.period });

  /* THE NBA LAYER — team scope only. Sliced to the codes this session already
     authorised, so a leader gets the ladder for their own people and nobody
     else's. `nba:null` means Ops has not published yet, which the page states
     plainly instead of drawing an empty ladder. */
  let nba = null;
  try {
    const nd = await loadNba(DB);
    if (nd && Array.isArray(nd.agents)) {
      const mine = nd.agents.filter((a) => auth.codes.has(normCb(a.cb)));
      nba = { updatedAt: nd.updatedAt, period: nd.period, workDays: nd.workDays,
        thresholds: withFloorEx(nd.thresholds), agents: mine, missing: auth.codes.size - mine.length };
    }
  } catch (e) { nba = { error: String(e.message || e).slice(0, 200) }; }
  /* EVERY AGENT ROW CARRIES ITS VERDICTS (spec 001-cm-view-signoff, US6, contract C4) — a team leader's Month to date
     reads the same six states an agent reads on their own card. `drill` is the exact object agentDetail publishes as
     me.drill (the same drillFor, the same ctx); `coach` is the rules-based coaching analysis (coachAnalysis). A team
     scope only: the staff preview (scope 'all', ~130 rows) does not pay for it. The rows are copies of the digest's. */
  if (auth.scope === 'team') {
    const dctx = drillCtx(digest, nba);
    const coachBy = await coachByAgent(env, DB, rows, digest.period);
    for (const r of rows) {
      r.drill = r.covered ? drillFor(r, dctx) : null;                       // a not-covered agent has no figures to judge
      r.coach = coachBy ? coachBy.get(r.code) || null : null;               // null = the Hub copy could not be read, not "no coaching"
    }
  }
  return {
    status: 200,
    body: {
      ...base,
      scope: auth.scope,
      staff: !!auth.staff,
      team: auth.team || (auth.staff ? 'All teams' : ''),
      totals: teamTotals(rows),
      spark: teamSpark(rows, digest.dates),
      summary: teamSummary(digest, auth),   // the MTD "Team Leaders" block, this team's column + campaign total
      nba,
      /* The team list. Each row is the same agent-safe shape the agent sees of
         themselves — a team leader is entitled to their own team's figures. */
      agents: rows,
      coaching,
    },
  };
}

/**
 * GET /api/portal/agent?cb=… — a team leader drilling into one of their agents.
 *
 * THE AUTHORISATION IS THE FIRST THING THAT HAPPENS AND IT IS A SET MEMBERSHIP
 * TEST, not a filter applied afterwards. `codes` was built from the session's
 * team; a CB number that is not in it never reaches a data lookup, so changing
 * ?cb= to a colleague on another team returns 403 with no information about
 * whether that agent exists.
 */
export async function agentDetail(env, DB, user, digest, wantCb) {
  const auth = authorise(user, digest);
  if (auth.error) return { status: auth.status, body: { error: auth.error } };
  const cb = normCb(wantCb);
  if (!cb) return { status: 400, body: { error: 'No agent specified.' } };
  if (!auth.codes.has(cb)) return { status: 403, body: { error: 'That agent is not on your team.' } };

  let row = auth.rows.find((r) => r.code === cb) || null;
  /* A MOVER OPENED BY A CAMPAIGN MANAGER (review, 2026-09-29): their scope holds one row per campaign
     segment, so .find() landed on the FIRST campaign's days. The manager who holds the agent's CURRENT
     campaign sees the whole month (with its split card); any other manager keeps their own campaign's days. */
  if (auth.scope === 'campaign') {
    const whole = (digest.agents || []).find((r) => r && normCb(r.code) === cb) || null;
    if (whole && Array.isArray(whole.segments) && (auth.campaigns || []).includes(campKey(whole.campaign))) row = whole;
  }
  const coaching = await coachingFor(env, DB, [row || { code: cb, name: cb }], { withSessions: true, digest, period: digest.period });

  /* THE LADDER TRAVELS WITH THE DRILL-DOWN, for a team scope only. Clicking a
     name in Team Results must open everything that name was listed for — the rule
     that fired, why, what to do, and what came off the score — not just the
     month. An AGENT drilling into themselves never gets here (their scope holds
     one code and this is the same authorise()), and even if it did, `nba` is
     attached only when the scope is a team. */
  let nba = null;
  if (auth.scope === 'team' || auth.scope === 'all' || auth.scope === 'campaign') {
    try {
      const nd = await loadNba(DB);
      if (nd && Array.isArray(nd.agents)) {
        const hit = nd.agents.find((x) => normCb(x.cb) === cb) || null;
        if (hit) nba = { updatedAt: nd.updatedAt, period: nd.period, workDays: nd.workDays,
          thresholds: withFloorEx(nd.thresholds), agent: hit };
      }
    } catch { nba = null; }
  }

  if (row) row.checks = checksFor(row, nba && nba.thresholds);   // decided once, painted by the page
  if (row) row.drill = drillFor(row, drillCtx(digest, nba));      // the same drill-down the agent sees (item 3)
  return {
    status: 200,
    body: { ...envelope(digest), role: user.role, scope: 'agent-detail', me: row,
      peers: peersFor(digest, row), team: auth.team, coaching, nba },
  };
}
