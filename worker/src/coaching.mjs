/**
 * COACHING HUB INTEGRATION — the missing backend.
 *
 * WHY THIS FILE EXISTS (the root cause, written down so it is never re-diagnosed):
 * PULSE and Ops both ship a Coaching layer that calls `GET /api/coaching?cb=` and
 * `GET /api/coaching/summary`. Those two routes were never implemented in the Worker.
 * An unknown path falls through to the session gate and answers
 * `{"error":"Sign in required."}` with 401 — byte-identical to a genuine auth
 * failure, which is exactly why this looked like an expired-token problem for weeks.
 * The frontend catches it and prints "Coaching Hub unavailable right now." So the
 * data was never broken; the pipe was never laid.
 *
 * WHERE THE DATA ACTUALLY LIVES: not Supabase. The Coaching Hub is an external app
 * (ThroughBalls Coaching Hub, served at coaching-hub-psi.vercel.app) backed by a
 * CONVEX deployment. Its queries are plain HTTP POSTs to {deployment}/api/query with
 * {path, args}. Six collections, keyed per team leader:
 *     formalCoachingCalls · informalCoaching · qualityCoaching
 *     leadManagementCoaching · groupCoaching · qualityAssuranceCoaching
 * `teamLeaders:list` enumerates the leaders; every `<collection>:list` REQUIRES a
 * teamLeaderId (calling it with {} is a server error), so a full pull is
 * types × leaders requests. That is why this module caches hard.
 *
 * IT NEVER WRITES. `teamLeaders:create` and `:remove` mutations exist on that
 * deployment; nothing here may ever call them. Read-only, always.
 *
 * IDENTITY — CB NUMBER FIRST, NAME ONLY AS A FALLBACK. Most Hub records carry
 * `employeeCode` ("CB93") and `employeeNumber` ("CB-93"). That is the reliable join
 * and it is used first. Name matching is a last resort and is reported, never
 * silently guessed: `unmatched` travels in the payload so a gap is visible instead
 * of looking like an agent with no coaching.
 *
 * THE HUB'S OWN TEAM LEADERS ARE NOT THE ORG CHART. `teamLeaders:list` disagrees
 * with the Agent List (it spells Dhamendra "Dharmendra", omits Hloniphile Jojo, and
 * carries people who lead no VAS agents). Per the standing rule that the Agent List
 * is the identity and campaign base, team scoping ANYWHERE in this suite comes from
 * the roster's `tl` column. The Hub's teamLeaderId is used only as the query key it
 * is, and its name is carried through as `hubTeamLeader` for display/provenance.
 */

const DEFAULT_HUB = 'https://acrobatic-setter-212.eu-west-1.convex.cloud';

/* Collection → the label a human reads. Order matters only for tidy output. */
const COLLECTIONS = [
  ['formalCoachingCalls', 'Formal Coaching'],
  ['informalCoaching', 'Informal Coaching'],
  ['qualityCoaching', 'Coaching Scorecard'],
  ['leadManagementCoaching', 'Lead Management Coaching'],
  ['groupCoaching', 'Group Coaching'],
  ['qualityAssuranceCoaching', 'Quality Assurance Coaching'],
];

/* A cluster key looks like "gap.customer_verification" — family, dot, theme. The
   Hub spreads them over a dozen differently-named columns (clusterGap,
   clusterDevelopmentArea, clusterTeamLeaderFeedback, clusterPurpose, …) and adds
   two METADATA columns with the same prefix that are not keys at all
   (clusterSource, clusterConfidence). Rather than hardcode a column list that
   silently drops the next one the Hub adds, take every cluster* column whose value
   is shaped like a key. */
const KEY_RE = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;
const CLUSTER_META = new Set(['clusterSource', 'clusterConfidence']);

const cbOf = (...vals) => {
  for (const v of vals) {
    const digits = String(v == null ? '' : v).toUpperCase().replace(/[^0-9]/g, '');
    if (digits) return 'CB' + String(parseInt(digits, 10));   // CB-093 / cb93 / 93 → CB93
  }
  return '';
};

const isoDay = (v) => {
  if (!v) return '';
  const s = String(v);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return m[0];
  const n = Number(v);
  if (Number.isFinite(n) && n > 1e11) return new Date(n).toISOString().slice(0, 10);
  return '';
};

/* Signatures are base64 PNGs of a real person's handwriting — 5–15 KB each, POPIA
   material, and on 621 sessions they alone are several megabytes. They are never
   needed by any consumer here, so they are dropped at the boundary rather than
   filtered downstream where one forgotten path would leak them. */
const isSignature = (k, v) =>
  /signature/i.test(k) || (typeof v === 'string' && v.startsWith('data:image'));

async function convexQuery(hub, path, args, signal) {
  const r = await fetch(hub + '/api/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, args }),
    signal,
  });
  if (!r.ok) throw new Error(`coaching hub ${path} → HTTP ${r.status}`);
  const j = await r.json();
  if (j.status !== 'success') throw new Error(`coaching hub ${path} → ${j.errorMessage || 'query failed'}`);
  return j.value;
}

/** One Hub record → one normalised session. Returns null for a row with no usable date. */
function normalise(type, label, rec, hubTeamLeader) {
  const clusters = [];
  for (const k of Object.keys(rec)) {
    if (!k.startsWith('cluster') || CLUSTER_META.has(k)) continue;
    const v = rec[k];
    if (typeof v !== 'string' || !KEY_RE.test(v)) continue;
    if (clusters.some((c) => c.clusterKey === v)) continue;          // one occurrence per session
    clusters.push({ clusterKey: v, family: v.slice(0, v.indexOf('.')), field: k });
  }

  /* Each collection dates itself differently: `date` on formal/informal/lead
     management/group, `dateOfCoaching` on QA coaching (which also carries callDate
     — the date of the CALL, not of the coaching, and using it would file a session
     in the wrong month). createdAt is the last resort so a row is never dropped
     merely for a blank date field. */
  const date = isoDay(rec.date) || isoDay(rec.dateOfCoaching) || isoDay(rec.createdAt);
  if (!date) return null;

  const cb = cbOf(rec.employeeCode, rec.employeeNumber);
  const out = {
    id: rec._id,
    /* `type` carries the HUMAN label because both dashboards print it straight
       onto the screen (PULSE files it into each theme's session list, Ops shows
       it in the drill-down). Printing "qualityAssuranceCoaching" at a team leader
       would be a bug that no test catches. The raw collection stays as
       `collection` for anything that needs to group by source. */
    type: label,
    collection: type,
    typeLabel: label,
    date,
    cb,
    agentName: String(rec.agentName || '').trim(),
    campaign: String(rec.campaign || '').trim(),
    hubTeamLeader: String(rec.teamLeaderName || rec.teamLeader || hubTeamLeader || '').trim(),
    clusters,
    clusterSource: rec.clusterSource || null,
    clusterConfidence: rec.clusterConfidence == null ? null : Number(rec.clusterConfidence),
  };
  if (rec.qaScore) out.qaScore = String(rec.qaScore);
  if (rec.callDate) out.callDate = isoDay(rec.callDate);

  /* Group coaching names its attendees instead of carrying one agent. Each signoff
     becomes an attendee so the session can be attributed to everyone who was there. */
  if (Array.isArray(rec.employeeSignoffs)) {
    out.attendees = rec.employeeSignoffs
      .map((s) => String((s && s.employeeName) || '').trim())
      .filter(Boolean);
  }

  /* Free text a team leader or agent actually wrote. Kept because it is the only
     part of a coaching record an agent recognises as their own conversation —
     but capped, because a Hub textarea has no length limit and this payload is
     read by phones. */
  const TEXT = ['developmentAreas', 'teamLeaderComments', 'teamLeaderFeedback', 'agentFeedback',
    'wayForward', 'supportProvided', 'agreedPlanAgentFeedback', 'coachingDetails', 'sosComments'];
  for (const k of TEXT) {
    const v = rec[k];
    if (typeof v === 'string' && v.trim() && !isSignature(k, v)) out[k] = v.trim().slice(0, 1200);
  }
  return out;
}

/**
 * Pull every coaching session from the Hub, normalised.
 * Throws on failure — callers must surface that, never substitute an empty list:
 * "no sessions" and "the Hub is down" mean opposite things to a team leader.
 */
export async function fetchCoaching(env) {
  const hub = String(env.COACHING_HUB_URL || DEFAULT_HUB).replace(/\/+$/, '');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const leaders = await convexQuery(hub, 'teamLeaders:list', {}, ctrl.signal);
    if (!Array.isArray(leaders) || !leaders.length) throw new Error('coaching hub returned no team leaders');

    /* types × leaders requests. Fired in one wave — Convex serves these in a few
       hundred ms and the result is cached for CACHE_MIN, so this runs a handful of
       times an hour however many people are looking. A single collection failing
       must not lose the other five, so each is settled independently and the
       failures are reported in the payload. */
    const jobs = [];
    for (const [type, label] of COLLECTIONS)
      for (const tl of leaders)
        jobs.push(
          convexQuery(hub, `${type}:list`, { teamLeaderId: tl._id }, ctrl.signal)
            .then((rows) => ({ type, label, tl, rows: Array.isArray(rows) ? rows : [] }))
            .catch((e) => ({ type, label, tl, rows: [], error: String(e.message || e) }))
        );
    const settled = await Promise.all(jobs);

    const sessions = [];
    const errors = [];
    for (const s of settled) {
      if (s.error) { errors.push(`${s.type}/${s.tl.name}: ${s.error}`); continue; }
      for (const rec of s.rows) {
        const n = normalise(s.type, s.label, rec, s.tl.name);
        if (n) { n.hubTeamLeaderId = s.tl._id; sessions.push(n); }
      }
    }
    /* Every collection failing is an outage, not an empty Hub. Say so. */
    if (!sessions.length && errors.length) throw new Error(errors[0]);

    sessions.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    return {
      fetchedAt: new Date().toISOString(),
      hub,
      leaders: leaders.map((l) => ({ id: l._id, name: l.name })),
      sessions,
      errors,
    };
  } finally {
    clearTimeout(timer);
  }
}

/* ---------------------------------------------------------------------------
   THE WORKER READS A SNAPSHOT, IT DOES NOT PULL THE HUB.

   A full pull is 6 collections × 14 leaders = 84 upstream requests, and
   Cloudflare caps a single Worker invocation at 50 subrequests. Doing it inline
   did not fail loudly — it failed PARTIALLY: 39 of the 84 came back "Too many
   subrequests", the rest succeeded, and a team leader with 139 coaching sessions
   was shown 23. A quiet undercount on a coaching record is worse than an outage,
   because nobody goes looking for it.

   So the pull happens in Node, where there is no such cap
   (tools/sync-coaching-hub.mjs), and lands in Supabase as `kv:coaching` — the
   same store-a-blob shape PULSE uses for the agent digest. The Worker reads that
   one object: ONE subrequest, no fan-out, and the Hub is hit once per sync
   instead of once per reader.

   The cost is that coaching is as fresh as the last sync, so freshness travels
   with the data (`fetchedAt`, and `stale` past STALE_HOURS) and the page says so.
   --------------------------------------------------------------------------- */
const CACHE_MIN = 10;
const STALE_HOURS = 26;          // a daily sync that missed one run is stale, not broken

export async function getCoaching(env, DB, { force = false } = {}) {
  const c = globalThis.__coachCache;
  if (!force && c && Date.now() - c.t < CACHE_MIN * 60000) return c.d;

  const r = await DB.select(`rules?key=eq.${encodeURIComponent('kv:coaching')}&select=value`);
  const v = r?.[0]?.value;
  if (!v) throw new Error('No Coaching Hub snapshot has been taken yet — run tools/sync-coaching-hub.mjs');
  let payload = String(v.data || '');
  if (!payload && v.store) payload = (await DB.storageGet('raw', v.store.replace(/^raw\//, ''))) || '';
  if (!payload) throw new Error('The Coaching Hub snapshot is empty — re-run tools/sync-coaching-hub.mjs');

  const d = JSON.parse(payload);
  const age = Date.now() - Date.parse(d.fetchedAt || 0);
  if (age > STALE_HOURS * 3600000) { d.stale = true; d.staleSince = d.fetchedAt; }
  globalThis.__coachCache = { t: Date.now(), d };
  return d;
}

/* ---------------------------------------------------------------------------
   THEME ROLL-UP — the shape both dashboards already expect.

   The scoring rules themselves live in the apps (window.__COACH_TH), deliberately:
   the thresholds sit beside the rest of the framework so there is one place to
   change them. This function only counts, and counts the way those rules read:

     shown  — the theme appeared on a session
     scored — a COACH chose it on the form, rather than a back-classifier reading it
              out of the notes. `clusterSource:'inferred'` is never scored.

   READ THIS BEFORE CALLING THE RESULT A BUG: on the live Hub today every single
   classified session carries clusterSource:'inferred' — 442 of 442. Nothing is
   coach-chosen, so `scored` is legitimately 0 across the board, no theme ever
   reaches Repeat or Persistent, and R2B cannot fire for anybody. That is the data
   telling the truth about itself: themes are being inferred from notes, not picked
   on the coaching form. Do not "fix" it by scoring inferred rows — that would fire
   a Level 1 compliance review at a named person on the strength of a regex.
   --------------------------------------------------------------------------- */
/* THE COACHING LAYER'S OWN THRESHOLDS — Chatterbox_Coaching_Rules.json (schema
   chatterbox.coaching-rules 1.0), the file the Coaching Hub's framework ships with.
   The escalation window is THIRTY days, not the ninety the session record covers, and a
   theme not raised for fourteen days is history rather than a live pattern — the rule
   book says so in as many words: "Sessions older than this stay in the record but stop
   escalating", "A theme not raised for longer than this is history, not a live pattern."
   Both numbers were being ignored by the agent's own page, which counted over ninety days
   and chipped anything seen three times as "Persistent". */
const CX = { windowDays: 30, repeatMin: 2, persistentMin: 5, staleDays: 14, minConf: 0.6 };

export function rollUp(sessions, minConf = CX.minConf, today = null) {
  /* THE CONFIDENCE FLOOR IS READ FROM THE RULE BOOK, NOT COPIED BESIDE IT. This defaulted
     to a literal 0.6 while CX.minConf sat next to it holding the same number and governing
     nothing: raising the rule book's floor would have changed no behaviour and passed every
     test. Same trap as MTD_VAT (non-negotiable 12) — one value, read once. */
  const isScored = (s) =>
    s.clusterSource && s.clusterSource !== 'inferred' &&
    (s.clusterConfidence == null || s.clusterConfidence >= minConf);

  const now = today || new Date().toISOString().slice(0, 10);
  const dayDiff = (d) => (!d ? null : Math.round((Date.parse(now) - Date.parse(d)) / 86400000));
  const winFrom = new Date(Date.parse(now) - CX.windowDays * 86400000).toISOString().slice(0, 10);

  const themes = {};
  for (const s of sessions) {
    const scored = isScored(s);
    const inWin = !s.date || String(s.date) >= winFrom;
    for (const c of s.clusters) {
      const t = themes[c.clusterKey] || (themes[c.clusterKey] =
        { key: c.clusterKey, family: c.family, shown: 0, scored: 0, win: 0, scoredWin: 0, last: '' });
      t.shown++;
      if (scored) t.scored++;
      /* The window figures are what the tier is allowed to read. Everything else on the
         row is the record, which is longer on purpose — an agent should be able to see a
         theme they were coached on two months ago without it counting against them. */
      if (inWin) { t.win++; if (scored) t.scoredWin++; }
      if (s.date > t.last) t.last = s.date;
    }
  }
  for (const t of Object.values(themes)) {
    t.daysSince = dayDiff(t.last);
    /* STALE IS A STATE, NOT A DELETION. The theme keeps its place in the record; what it
       loses is the right to be presented as something the agent is currently working on. */
    t.stale = t.daysSince != null && t.daysSince > CX.staleDays;
    /* THE TIER READS SCORED OCCURRENCES IN THE WINDOW, AND NOTHING ELSE. On this Hub every
       classification is inferred, so scoredWin is 0 for everyone and no tier is earned —
       which is the correct answer, not a gap. Chipping an inferred count as "Persistent"
       told 97 agents they had a persistent problem that no rule in the book supports. */
    t.tier = t.scoredWin >= CX.persistentMin ? 'Persistent'
           : t.scoredWin >= CX.repeatMin ? 'Repeat' : '';
  }
  return Object.values(themes).sort((a, b) =>
    b.scoredWin - a.scoredWin || b.win - a.win || b.scored - a.scored || b.shown - a.shown);
}

/** The thresholds, published so a page never hardcodes its own copy of them. */
export const CX_RULES = CX;

/** Only the sessions inside the stated window. The payload has always ADVERTISED
 *  "last 90 days" while every count behind it was lifetime (audit, 2026-08-28): an agent
 *  with 23 sessions since February read "23 sessions in the last 90 days", and — worse —
 *  the persistent-theme tier that escalates to a Level 1 compliance review was computed
 *  over that lifetime set, while the agent's own drawer applied the window and disagreed. */
export function withinWindow(sessions, days) {
  const n = Number(days) || 90;
  const from = new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  return (sessions || []).filter((s) => !s.date || String(s.date) >= from);
}

/** Sessions for one agent, CB-first with a name fallback that is reported, not hidden.
 *  The name fallback matches on EXACT normalised equality only (audit, 2026-08-27):
 *  the old bidirectional .includes() let "Anna Smith" collect the uncoded sessions of
 *  "Anna Smithers" — and those flow, free text and all, into the AGENT-scope overview,
 *  i.e. one person's coaching notes shown to another. Exact-match may miss a session a
 *  fuzzy match would have found; that is the right trade — a session the page cannot
 *  attribute with certainty must not be shown to an individual. */
export function sessionsForAgent(all, cb, name) {
  const want = cbOf(cb);
  const byCb = want ? all.filter((s) => s.cb === want) : [];
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
  const n = norm(name);
  /* THE TWO SETS ARE UNIONED, NOT ALTERNATIVES (audit, 2026-08-28). Group coaching carries
     no employee code by design — it names attendees — so it can ONLY be found by name. This
     used to return early whenever the agent had a single coded session, which made group
     attendance invisible to exactly the people who get coached most: an agent with one
     formal session and five group sessions counted 1, while a colleague with the same five
     and no formal session counted 5. Exact-name matching is kept (a fuzzy match once put one
     person's coaching notes in another's payload). */
  const byName = n ? all.filter((s) => {
    if (s.cb) return false;                       // a record WITH a code belongs to that code, full stop
    if (norm(s.agentName) === n) return true;
    return (s.attendees || []).some((x) => norm(x) === n);
  }) : [];
  if (!byCb.length && !byName.length) return { sessions: [], matchedBy: 'none' };
  const seen = new Set(); const sessions = [];
  for (const s of [...byCb, ...byName]) {
    const k = s.id || (String(s.date || '') + '|' + String(s.type || '') + '|' + String(s.agentName || ''));
    if (seen.has(k)) continue;
    seen.add(k); sessions.push(s);
  }
  sessions.sort((x, y) => String(y.date || '').localeCompare(String(x.date || '')));   // newest first, as `last` assumes
  return { sessions, matchedBy: byCb.length ? (byName.length ? 'cb+name' : 'cb') : 'name' };
}
