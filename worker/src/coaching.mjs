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
export const STALE_HOURS = 26;          // a daily sync that missed one run is stale, not broken

/* THE SNAPSHOT, TAKEN BY THE CRON IN BUDGETED CHUNKS (rewritten 2026-10-01, spec 001-cm-view-signoff, R7).
   The 84-request pull that the subrequest cap broke inline was split on 2026-09-15 into three waves of
   two collections. That held while the Hub had 14 leaders (2 x 14 + 1 = 29); at 23 leaders a wave is
   46 Convex calls + teamLeaders:list + the Supabase reads/writes + the cron-log write > the Free plan's
   50 subrequests, so EVERY wave died before saving anything, the only trace a console.warn, and kv:coaching
   sat on 21 September for ten days.

   The pull is now measured in the unit that is actually capped: (collection, leader) pairs, each one Convex
   call. One invocation takes at most CHUNK_CALLS (35) Convex calls - teamLeaders:list included - whatever the
   Hub's size, so it can never again outgrow the cap by the Hub growing. The place is kept in kv:coaching-waves
   (collection-major order, `next` = the next pair); each chunk's sessions are kept as ONE pre-stringified
   part so an intermediate invocation never parses the accumulated pile (the Free plan's other cap is 10 ms of
   CPU); the snapshot is written exactly as tools/sync-coaching-hub.mjs wrote it (Storage raw/kv/coaching + the
   kv:coaching pointer) ONLY when every pair is in. Every invocation that tried to pull appends
   {at, step, of, pairs, sessions, error} to kv:coaching-wave-log (last 20) - failures were invisible before.
   Budget per invocation: 1 select (the three rows at once) + <= 35 Convex + 1 write (pointer + log in one
   request); the final chunk swaps that write for Storage + one two-row insert + one delete. The cron-log write
   in index.mjs makes it <= 40. Guarded by diagnostics/verify-coaching-wave.mjs. */
const REFRESH_HOURS = 2;
const CHUNK_CALLS = 35;                    // Convex calls per invocation, teamLeaders:list included
const PULL_RESTART_HOURS = 3;              // a pull that never finished is abandoned
const WAVE_LOG_KEEP = 20;
const WAVE_V = 2;                          // the pointer format; the old {parts:[{sessions}]} pointer is ignored
export const COACH_WAVE_KEYS = { snapshot: 'kv:coaching', pointer: 'kv:coaching-waves', log: 'kv:coaching-wave-log' };
const cmpDateDesc = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0);

/* RETRY AND HONESTY (review fixes, 2026-10-01). A pair that fails (a 429, the shared 20 s abort) is NOT stepped past:
   it stays in the pointer as {i, tries, err} and is retried in the next invocation(s), at most MAX_TRIES attempts in
   all, taking its place in the 35-call budget ahead of new pairs. If a pair is still unresolved when the last pair is
   in, the snapshot is written (the rest is worth having) but says so — `incomplete: true` and `failedLeaders`
   [{id, name}] in the snapshot, in the kv:coaching row (health reads the row, never Storage) and in the wave log —
   so coaching-incomplete can name them and cm-coaching can refuse to call those leaders "0 sessions, fresh". An
   incomplete copy is re-pulled after INCOMPLETE_REFRESH_HOURS, not REFRESH_HOURS. A FAILED READ of the pointer is not
   an absent pointer: it is logged and nothing is written, so a transient PostgREST error cannot restart a pull. */
const MAX_TRIES = 2;
const INCOMPLETE_REFRESH_HOURS = 1;

/* THE DAILY GUARANTEE (spec 002-live-month-sync-coaching, contract C4, 2026-10-01). Whatever REFRESH_HOURS says, a copy
   that predates TODAY's 05:30 SAST is refreshed as soon as it is 05:30 SAST or later (the four waves land by ~06:45), so
   every morning's coaching pages read a copy taken since the previous evening's sessions were logged. Pure: the line is
   today's 05:30 SAST (03:30Z) as UTC ms; true = a pull is due. A copy taken at or after the line is today's. */
export const DAILY_PULL_SAST = { hour: 5, minute: 30 };
export function dailyPullDue(fetchedAt, nowMs) {
  const sast = new Date(nowMs + 2 * 3600000);
  const line = Date.UTC(sast.getUTCFullYear(), sast.getUTCMonth(), sast.getUTCDate(), DAILY_PULL_SAST.hour - 2, DAILY_PULL_SAST.minute);
  const fetched = Date.parse(fetchedAt || '');
  return nowMs >= line && !(fetched >= line);
}

export async function snapshotCoachingWave(env, DB, nowMs = Date.now()) {
  const keys = Object.values(COACH_WAVE_KEYS).map(encodeURIComponent).join(',');
  let rows;
  try { rows = await DB.select(`rules?key=in.(${keys})&select=key,value`); }
  catch (e) {
    const msg = String((e && e.message) || e).slice(0, 200);
    console.warn('[coaching] could not read the wave pointer — doing nothing this invocation: ' + msg);
    return { skipped: 'read-failed', error: msg };
  }
  const byKey = {}; for (const r of rows || []) byKey[r.key] = r.value;
  const snapRow = byKey[COACH_WAVE_KEYS.snapshot] || null;
  const fetchedAt = snapRow && snapRow.fetchedAt;
  let w = byKey[COACH_WAVE_KEYS.pointer] || null;
  if (w && (w.v !== WAVE_V || !Array.isArray(w.leaders) || !Array.isArray(w.parts))) w = null;                  // the old three-wave pointer
  if (w && w.startedAt && nowMs - Date.parse(w.startedAt) > PULL_RESTART_HOURS * 3600000) w = null;            // a pull that never finished: start over
  const refreshH = snapRow && snapRow.incomplete ? INCOMPLETE_REFRESH_HOURS : REFRESH_HOURS;
  if (!w && fetchedAt && nowMs - Date.parse(fetchedAt) < refreshH * 3600000 && !dailyPullDue(fetchedAt, nowMs)) return { skipped: 'fresh' };

  let entries = [];
  try { entries = JSON.parse((byKey[COACH_WAVE_KEYS.log] && byKey[COACH_WAVE_KEYS.log].data) || '{}').entries || []; } catch { entries = []; }
  const at = new Date(nowMs).toISOString();
  const logRow = (e) => ({ key: COACH_WAVE_KEYS.log, updated_by: 'coaching-cron', updated_at: at,
    value: { data: JSON.stringify({ entries: [...entries, { at, ...e }].slice(-WAVE_LOG_KEEP) }) } });

  const hub = String(env.COACHING_HUB_URL || DEFAULT_HUB).replace(/\/+$/, '');
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 20000);
  const step = (w ? w.step : 0) + 1;
  let of = step;
  try {
    const listed = !w;
    const leaders = w ? w.leaders : await convexQuery(hub, 'teamLeaders:list', {}, ctrl.signal);
    if (!Array.isArray(leaders) || !leaders.length) throw new Error('coaching hub returned no team leaders');
    const total = COLLECTIONS.length * leaders.length;
    of = Math.max(step, Math.ceil((total + 1) / CHUNK_CALLS));
    const from = w ? w.next : 0;
    const failedBefore = (w && w.failed) || [];
    const budget = CHUNK_CALLS - (listed ? 1 : 0);
    const retry = failedBefore.filter((f) => f.tries < MAX_TRIES).slice(0, budget);
    const newTake = Math.min(total - from, budget - retry.length);
    const idxs = [...retry.map((f) => f.i), ...Array.from({ length: newTake }, (_, k) => from + k)];
    const tries = new Map(failedBefore.map((f) => [f.i, f.tries]));
    const settled = await Promise.all(idxs.map((i) => {
      const [type, label] = COLLECTIONS[Math.floor(i / leaders.length)], tl = leaders[i % leaders.length];
      return convexQuery(hub, `${type}:list`, { teamLeaderId: tl._id }, ctrl.signal)
        .then((r) => ({ i, type, label, tl, rows: Array.isArray(r) ? r : [] }))
        .catch((e) => ({ i, type, label, tl, rows: [], error: String(e.message || e) }));
    }));
    const sessions = [], failedNow = [];
    for (const r of settled) {
      if (r.error) { failedNow.push({ i: r.i, tries: (tries.get(r.i) || 0) + 1, err: `${r.type}/${r.tl.name}: ${r.error}`.slice(0, 300) }); continue; }
      for (const rec of r.rows) { const n = normalise(r.type, r.label, rec, r.tl.name); if (n) { n.hubTeamLeaderId = r.tl._id; sessions.push(n); } }
    }
    /* A chunk in which EVERY call failed is the Hub being down, not a quiet Hub: spend no attempts and step past
       nothing — leave the pointer, log it, say so. */
    if (settled.length && failedNow.length === settled.length) throw new Error(failedNow[0].err);

    const done = new Set(idxs);
    const failed = [...failedBefore.filter((f) => !done.has(f.i)), ...failedNow];
    const nextIdx = from + newTake;
    const pending = failed.some((f) => f.tries < MAX_TRIES);
    const next = { v: WAVE_V, step, startedAt: (w && w.startedAt) || at, leaders, total, next: nextIdx, failed,
      parts: [...(w ? w.parts : []), JSON.stringify(sessions)] };
    if (nextIdx < total || pending) {
      await DB.insert('rules', [{ key: COACH_WAVE_KEYS.pointer, value: next, updated_by: 'coaching-cron', updated_at: at },
        logRow({ step, of, pairs: settled.length, sessions: sessions.length, error: null })], true);
      return { wave: step, of, pairs: settled.length, sessions: sessions.length };
    }

    const all = next.parts.flatMap((x) => JSON.parse(x)), errs = failed.map((f) => f.err);
    if (!all.length && errs.length) throw new Error(errs[0]);
    all.sort(cmpDateDesc);
    const failedLeaders = []; for (const f of failed) { const tl = leaders[f.i % leaders.length]; if (!failedLeaders.some((x) => x.id === tl._id)) failedLeaders.push({ id: tl._id, name: tl.name }); }
    const flag = failedLeaders.length ? { incomplete: true, failedLeaders } : {};
    const snap = { fetchedAt: at, hub, leaders: leaders.map((l) => ({ id: l._id, name: l.name })), sessions: all, errors: errs, ...flag, by: 'coaching-cron' };
    const payload = JSON.stringify(snap);
    const put = await fetch(`${env.SUPABASE_URL}/storage/v1/object/raw/kv/coaching`, { method: 'POST',
      headers: { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY, 'Content-Type': 'application/json', 'x-upsert': 'true' }, body: payload });
    if (!put.ok) throw new Error('storage write failed: ' + put.status);
    await DB.insert('rules', [{ key: COACH_WAVE_KEYS.snapshot, value: { store: 'raw/kv/coaching', bytes: payload.length, sessions: all.length, fetchedAt: snap.fetchedAt, ...flag },
      updated_by: 'coaching-cron', updated_at: snap.fetchedAt },
      logRow({ step, of, pairs: settled.length, sessions: all.length, error: null, ...flag })], true);
    await DB.del('rules?key=eq.' + encodeURIComponent(COACH_WAVE_KEYS.pointer)).catch(() => {});
    globalThis.__coachCache = null;
    return { written: true, wave: step, of, pairs: settled.length, sessions: all.length, errors: errs.length, ...(failedLeaders.length ? { incomplete: true } : {}) };
  } catch (e) {
    await DB.insert('rules', [logRow({ step, of, pairs: 0, sessions: 0, error: String((e && e.message) || e).slice(0, 300) })], true).catch(() => {});
    throw e;
  } finally { clearTimeout(timer); }
}

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

/* ---------------------------------------------------------------------------
   THE COACHING ANALYSIS (spec 001-cm-view-signoff, US6 + the campaign manager's coaching page).
   Deterministic and rules-based — the engine decides, Nikola may only explain. Pure: sessions and days in,
   a plain object out; nothing here reads the Hub or the digest.
   --------------------------------------------------------------------------- */

/** A cluster key as a person reads it: family dropped, underscores spaced, title-cased — the label the agent
 *  page prints (agent/index.html coachLabel), so one theme is never two spellings. */
export function themeLabel(key) {
  return String(key || '').replace(/^[a-z]+\./, '').replace(/_/g, ' ').replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/* LEAD MANAGEMENT (spec 002, contract C4). A cluster key ending in `.lead_management` is the Hub's lead-management theme
   (whatever family prefix the form field gave it). The coaching summaries were gap-only, so lead-management coaching —
   28 rows on the live Hub on 2026-10-01 — never showed in a theme list; every list the Worker builds now carries it
   alongside the gap themes. The collection / type label a session of that kind carries: */
export const LM_THEME_RE = /[.]lead_management$/;
export const LM_TYPE_LABEL = 'Lead Management Coaching';
export const isLmKey = (key) => LM_THEME_RE.test(String(key || ''));

/** The unique theme labels of one session, in the order the Hub wrote them. */
export const sessionThemes = (s) => {
  const out = [];
  for (const c of (s && s.clusters) || []) { const l = themeLabel(c.clusterKey); if (l && !out.includes(l)) out.push(l); }
  return out;
};

/* "after coaching" reads flat when the pace moved by less than this share of the "before" pace (a day's noise is
   not an improvement). Whole-number sales per day, so 5% of a 4-a-day pace is a fifth of a sale. */
export const COACH_FLAT_PCT = 0.05;
const MAX_COACH_THEMES = 3;
const round2 = (v) => Math.round(v * 100) / 100;

/**
 * One agent's coaching inside a period.
 * sessions: that agent's sessions (any order); days: the digest row's days[] ({d, s, act, p, lv}); period: {from, to}.
 * → {n, last, themes[], after:{basis, before, after, dir} | null}
 *   n      sessions dated inside the period
 *   last   the newest of them ('YYYY-MM-DD'), or null
 *   themes up to three development-area labels (family 'gap'; every family when none carries one), most frequent first
 *   after  sales per WORKED day after the last session vs before it, inside the period. A worked day is a landed
 *          (not provisional), non-leave day the agent attended (act > 0); the session day itself is neither side.
 *          null — never a zero — with no session, or no worked day on either side.
 */
export function coachAnalysis(sessions, days, period) {
  const from = (period && period.from) || '', to = (period && period.to) || '9999-12-31';
  const mine = (sessions || []).filter((s) => s && s.date && String(s.date) >= from && String(s.date) <= to)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  if (!mine.length) return { n: 0, last: null, themes: [], after: null };
  const last = String(mine[0].date);

  const count = {}, lmCount = {};
  const tally = (onlyGap) => { for (const s of mine) for (const c of s.clusters || []) {
    if (isLmKey(c.clusterKey)) continue;                                  // lead-management themes are listed on their own below
    if (onlyGap && c.family !== 'gap') continue;
    const l = themeLabel(c.clusterKey); if (l) count[l] = (count[l] || 0) + 1; } };
  tally(true);
  if (!Object.keys(count).length) tally(false);
  /* the cap bounds the GAP themes; a lead-management theme is added beside them, never squeezed out by them (spec 002 C4) */
  for (const s of mine) for (const c of s.clusters || []) if (isLmKey(c.clusterKey)) { const l = themeLabel(c.clusterKey); if (l) lmCount[l] = (lmCount[l] || 0) + 1; }
  const byCount = (m) => (a, b) => m[b] - m[a] || a.localeCompare(b);
  const themes = [...Object.keys(count).sort(byCount(count)).slice(0, MAX_COACH_THEMES), ...Object.keys(lmCount).sort(byCount(lmCount))];

  const side = (pick) => {
    let sales = 0, n = 0;
    for (const f of days || []) {
      if (!f || !f.d || f.d < from || f.d > to || !pick(String(f.d)) || f.p || f.lv || !(f.act > 0)) continue;
      sales += Number(f.s) || 0; n++;
    }
    return n ? sales / n : null;
  };
  const before = side((d) => d < last), after = side((d) => d > last);
  let verdict = null;
  if (before != null && after != null) {
    const delta = after - before;
    verdict = { basis: 'sales per worked day', before: round2(before), after: round2(after),
      dir: Math.abs(delta) <= COACH_FLAT_PCT * before ? 'flat' : delta > 0 ? 'up' : 'down' };
  }
  return { n: mine.length, last, themes, after: verdict };
}
