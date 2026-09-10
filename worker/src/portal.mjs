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

import { getCoaching, rollUp, sessionsForAgent, withinWindow, CX_RULES } from './coaching.mjs';
import { campKey, cmOverviewBody, effectiveCamps } from './campaign.mjs';
import { withFloorEx, checksFor } from './rules.mjs';   // one number, one verdict (2026-09-07): the floor and the two checks are decided once

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
    DB.select(`rules?key=eq.${encodeURIComponent('kv:agent-teams')}&select=value`).catch(() => null),
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
  const r = await DB.select(`rules?key=eq.${encodeURIComponent('kv:nba-digest')}&select=value`).catch(() => null);
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
    const present = new Set(all.map((r) => campKey(r.campaign)));
    const camps = camps0.filter((k) => present.has(k));
    const rows = all.filter((r) => camps.includes(campKey(r.campaign)));
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
  /* THE COMPOSITE'S DRIVER LABELS. They travel once per digest rather than once per
     agent, so they live out here — and this envelope hand-picks its fields, so leaving
     them out meant the page had no names for the rows and printed the raw keys
     ("gwpSale", "targetAch") to every agent. */
  compositeDrivers: digest.compositeDrivers || null,
});

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
    const out = { fetchedAt: hub.fetchedAt, stale: !!hub.stale, windowDays: WINDOW_DAYS, cx: CX_RULES };
    const windowed = withinWindow(hub.sessions, WINDOW_DAYS);
    if (hub.stale) out.staleSince = hub.staleSince;
    /* A PARTIAL PULL MUST NOT READ AS A QUIET MONTH. If some of the Hub's
       collections failed, the counts below are understated — say so in the
       payload rather than letting a team leader believe their team had less
       coaching than it did. */
    if (hub.errors && hub.errors.length) { out.partial = true; out.errors = hub.errors.slice(0, 5); out.errorCount = hub.errors.length; }

    const per = [];
    let unmatchedByName = 0;
    for (const r of rows) {
      const { sessions, matchedBy } = sessionsForAgent(windowed, r.code, r.name);
      if (matchedBy === 'name' && sessions.length) unmatchedByName++;
      /* Per PRODUCT, not just a total. The Coaching Hub keeps six separate
         coaching products and counts them separately on its own dashboard;
         collapsing them into one number loses what a team leader is actually
         asked — whether the FORMAL coaching happened, not whether some coaching
         did. Cheap to send (six integers) and it means the page never has to
         hold every session just to count them. */
      const byType = {};
      for (const s of sessions) byType[s.type] = (byType[s.type] || 0) + 1;

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
        last: sessions.length ? sessions[0].date : '',
        themes: rollUp(sessions),
        matchedBy,
      });
    }
    out.agents = per;
    /* The same product split across the whole scope, so a team leader's coaching
       page can lead with it without adding up six columns by hand. */
    out.byType = {};
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
    const coaching = await coachingFor(env, DB, me ? [me] : [{ code: auth.cb, name: base.name }], { withSessions: true });
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
    return {
      status: 200,
      body: {
        ...base,
        me,
        /* Not in this period's data — say which of the two reasons it is. */
        notReported: auth.missing ? (digest.notCovered || []).find((n) => n.code === auth.cb) || { why: 'nodata' } : null,
        peers: peersFor(digest, me),
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
    const body = cmOverviewBody(digest, auth, assist, globalThis.__cmCtx);
    return { status: 200, body: { ...base, scope: 'campaign', staff: false,
      campaigns: auth.campaigns, cm: body,
      assist: assist.error ? { error: assist.error } : { stages: assist.stages, requests: assist.requests,
        kpis: assist.kpis, blockPanel: assist.blockPanel, truncated: assist.truncated } } };
  }

  const rows = auth.rows.slice().sort((a, b) => (b.gwpEx || 0) - (a.gwpEx || 0));
  const coaching = await coachingFor(env, DB, rows);

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

  const row = auth.rows.find((r) => r.code === cb) || null;
  const coaching = await coachingFor(env, DB, [row || { code: cb, name: cb }], { withSessions: true });

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
  return {
    status: 200,
    body: { ...envelope(digest), role: user.role, scope: 'agent-detail', me: row,
      peers: peersFor(digest, row), team: auth.team, coaching, nba },
  };
}
