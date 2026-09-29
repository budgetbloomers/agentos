/**
 * Chatterbox AgentOS — API Worker
 * Auth + shared app state (kv) + Tracker EOD rows + BI money rows + /api/ask.
 * Data: Supabase (service key as secret). AI: Workers AI (see DEFAULT_MODEL below).
 * IRON RULE: the LLM explains numbers, it never computes them.
 */
import { db } from './db.mjs';
import { login, logout, session, hashPassword, changePassword, signinByCb } from './auth.mjs';
import { retrieveKB } from './kb.mjs';
import { getCoaching, rollUp, sessionsForAgent, withinWindow, snapshotCoachingWave } from './coaching.mjs';
import { PORTAL_ROLES, PORTAL_ALLOWED, loadDigest, loadReports, tlReports, listDigestMonths, overview, agentDetail, normCb } from './portal.mjs';
import { helpRequest, helpList, helpDetail, helpStage, actionsList, actionSet, failsList, failSet, failDetail, syncCoaching, helpMine, helpCloseOwn, helpConfirm, helpPulse } from './help.mjs';
import { campaignMoves, setCampaignMove } from './moves.mjs';
import { hubIdsOf, coachingList, coachingCreate, kpiList, kpiWrite, COACH_TABLES, KPI_TITLES } from './hubs.mjs';
import { loadCmContext, eodMarkdown, cmOverviewBody, cmSettingsBody, cmSettingsApply, effPerDay } from './campaign.mjs';
import { wimpyMenu, submitWimpyOrder } from './wimpy.mjs';
import { syncAgentLogins, syncTeamLeaders, syncCampaigns, publishAgentList } from './provision.mjs';
import { runHealthChecks, dailySnapshots, hygiene, logKvWrite } from './health.mjs';
import { kickRunner } from './runner.mjs';
import { manifestAdd, reconcileManifest } from './manifest.mjs';
import { assistCreate, assistList, assistDetail, assistAct } from './assist.mjs';

// Hermes 2 Pro was deprecated 2026-05-30. Default: Llama 4 Scout (131k context —
// fits the entire software's digests without truncation). Fallback: Llama 3.3 70B.
// Swap without redeploy by setting rule 'ai_model' -> {"value":"@cf/..."}.
const DEFAULT_MODEL = '@cf/meta/llama-4-scout-17b-16e-instruct';
const FALLBACK_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

// The framework the assistant actually knows (NBA Scoring Framework v3.0).
const KB = `THE CHATTERBOX — NBA SCORING FRAMEWORK v3.0 (reference knowledge).

TWO-CHECK SALES RULE (VALUE is checked before VOLUME):
- Check 1 VALUE: GWP per sale >= R99. Check 2 VOLUME: daily sales vs the agent's tenure target.
- PASS/PASS = On Target. FAIL/PASS = Value Issue (coach product mix & upselling). PASS/FAIL = Volume Issue (coach activity, pipeline, closing). FAIL/FAIL = Both Issues (value coaching takes priority).

TENURE DAILY SALES TARGETS: M1=3, M2=4, EXP-Courtesy=5, EXP-Cuddle=8. GWP/sale target is R99 for everyone.

DECISION LADDER — exactly ONE primary NBA per agent, checked top to bottom, first trigger wins:
LEVEL 1 Protect the Business (P1): R1 Zero Attendance (attended no scheduled days); R2 Critical QA Failure (QA < 80%); R2A-3 Critical Compliance Fail (>=4 critical fails OR CFR >= 30%); R3 Attendance Risk (attendance < 80%).
LEVEL 2 Protect the Revenue (P2): R2A-2 Compliance Risk (2-3 fails OR CFR 10-<30%); R4 GWP Value Failure (GWP/sale < R99); R4A Critical Sales-Volume Failure (value clears R99 but sales < 70% of target); R5 Moderate QA Risk (QA 80-89%); R6 Low Sales Achievement (sales 70-89% of target).
LEVEL 3 Improve the Skill (P3): R7 Critical Conversion Failure (conversion below tenure target); R8 Talk Time Below Target (< 150 min/day); R2A-1 Compliance Note (exactly 1 fail AND CFR < 10% — a logged coaching note, NEVER surfaced as a primary NBA).
LEVEL 4 Develop & Recognise (P4): R9 Developing Performer (90-99% of target, all other metrics in range); R10 Strong/Elite Performer (meeting or exceeding all key targets).

GRADUATED CRITICAL-FAIL RULE (R2A): CFR = critical fails / audited calls x 100. The tier is the HIGHER of the count band and the rate band.
- R2A-3: >=4 fails OR CFR >= 30%  ->  -10 composite, Elite BLOCKED, P1 48h compliance review, audit each fail, daily monitoring 10 days.
- R2A-2: 2-3 fails OR CFR 10-<30%  ->  -5 composite, Elite BLOCKED, P2 structured compliance coaching within 5 days, root-cause review, raised audit cadence.
- R2A-1: exactly 1 fail AND CFR < 10%  ->  -2 composite, Elite RETAINED, logged coaching note only.
- Tier 0: 0 fails. The penalty is CAPPED at -10 (never per-fail multipliers; a fail already auto-zeros its call inside QA).
HOW AN R2A FLAG CLEARS: R2A is re-evaluated every period. An R2A-2 flag clears when the agent's critical-fail position drops below the R2A-2 trigger in the next audit window — i.e. back to 0-1 fails AND CFR < 10% (Tier 0 or R2A-1). In practice: take no new critical fails, complete the 5-day structured compliance coaching and root-cause review, and pass the raised-cadence re-audits so CFR falls under 10%. If fails instead reach 4+ or CFR 30%+, it ESCALATES to R2A-3 (Elite stays blocked until cleared).

COMPOSITE SCORE (max 100). Weights: Avg GWP/Sale (Value) 25, Target Achievement (Volume) 20, QA 20, Total GWP peer-percentile 15, Conversion 10, Talk Time 5, Attendance 5. The critical-fail penalty is applied AFTER the weighted sum and reported as 'Adj'. Cancellations and Avg Attempts per Unique Lead are diagnostics only — never scored. All comparisons are within the agent's own tenure group.`;
// The software itself — apps, tabs, and the Manual tab's content — so the
// assistant can answer "how do I use this" and "what does X tab / colour mean".
const SOFTWARE_GUIDE = `THE CHATTERBOX AGENTOS — THE SOFTWARE ITSELF.
The AgentOS is one suite with three apps, switched with the [Ops Analytics | VAS Analytics | Tracker Analytics] toggle at the top. Users log in each time a tab opens; each user sees only the tabs they have permission for. All three apps share: the same logo, a Data Trust bar (source freshness — read it before trusting any number), an Upload Station, clickable agent names that open a full agent card with AI coaching, and this Ask AgentOS chat widget (bottom-right).

OPS ANALYTICS TABS:
- Command: Executive (command centre: production, quality, people, one controlled view) · Visual Brain (the floor as a living graph — agents, teams, campaigns, NBA rules coloured by priority; hover for info, it cannot be clicked).
- Sales Ops: Sales Production (dialler activity, activations, case pipeline) · Lead Management (per-agent funnel: open attempts, closures, conversion, cancellations — the daily lead report, live) · Session Dashboard (intraday snapshots per session).
- Quality & Risk: QA & Compliance (clean-sale control: pass rates, critical fails, coaching) · QA Agent Performance (the assessors' own output) · Agent Discipline (offenses, stage ladder, SLA breaches).
- People: Team Leader View (TL leaderboard, dual-check fleet, coaching tables — NBA v3.0) · Workforce (attendance/availability) · Agent Performance (per-agent scorecard: productivity × quality × attendance) · Manual (how to read the analytics — content below).
- Data: Upload Station (manual source uploads, validation, batch audit, exceptions) · Session Uploads (intraday snapshot slots 08:00/10:00/12:00/15:00/16:30) · Dictionary, Rules & Thresholds (every KPI definition, RAG threshold and rule — live-editable) · Training Guide (run the system in 20 min/week).

VAS ANALYTICS TABS: Dashboard · Month to Date · Weekly Reports · Daily Reports · Workforce · Agent Performance · Leaderboards · Coaching · Manual · Open Cases · Upload Station · Adjustments · Settings.

TRACKER ANALYTICS (Matrix EOD Daily Tracker): manual end-of-day capture, one row per date — Employed HC, Present HC, Afrilead/JAG/VT Sales, Avg GWP, Agents-to-Target; Attendance % (present÷employed) and SPD (VT sales÷present) calculate automatically, with day-on-day movement columns. Entries are stored in the shared database and visible to every user. Tabs: Input · Daily Tracker.

THE MANUAL TAB (both apps carry this content):
1. READ THE COLOURS FIRST — one traffic-light system everywhere: GREEN = on target (metric at or better than goal). AMBER = watch (slipping toward a problem). RED = act (below target; needs an owner and an action today). GREY = informational, no target set. Every KPI card shows value, target (e.g. "target >= 90%"), a trend arrow vs the previous period and a mini-sparkline; click a KPI for its full definition.
2. THE RULES BEHIND THE SCORES — the NBA v3.0 framework (two-check rule, decision ladder, R2A, composite — full detail in the framework section of this prompt).
3. HOW TO USE THE SOFTWARE — (a) check the Data Trust bar first: green fresh, amber/red stale — a chart on stale data is a confident wrong answer; (b) upload exports in the Upload Station — type auto-detected from headers, rejected rows logged with reasons, never silently dropped; (c) set filters and date range in the top bar — everything re-windows; (d) click any agent's name to open their full card: framework score, primary NBA, composite breakdown, graphs, peer comparison, AI coaching; (e) Ask AgentOS (this chat) answers about the numbers, the framework and the business — it never invents figures.
4. THE WEEKLY RHYTHM — daily: the system assigns one NBA per agent. Monday: the Team Leader confirms data, sets owners and due dates. During the week: coaching happens. Next review: clear the NBA if resolved, escalate if not. If a red number has no owned action, the system has failed.`;

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });
/* How long a compare-and-set writer's claim on a kv pointer stands before readers and other
   writers treat it as abandoned (the /api/kv CAS path, 2026-09-14). A fact-store upload is
   seconds; two minutes is a dead Worker, not a slow one. */
const KV_WRITING_TTL_MS = 120000;
const REVIEW_REMOVALS = 5;
const COACHING_CRON = "3,23,43 * * * *";                 // the coaching-wave trigger (wrangler.toml crons) — its own invocation, its own subrequest budget
/* who sees the health banner (Nick, 2026-09-15) — `nick` is Nicholas's second admin login */
const HEALTH_RECIPIENTS = new Set(['aarav', 'nicholas', 'nick', 'barry']);                              // a publish removing this many agents gets a review note (never a refusal)

/* WHAT TRAVELS WITH THE ROSTER (2026-09-15). The Agent List names agents; two other things
   belong to the same record and are served beside it on every /api/roster answer:
     · leaders — team_leader_cbs (migration-018/040): the leaders' CB numbers, campaign, manager,
       so a leader dialling under their code is classed as a leader, never as a missing agent;
     · leavers — agent_list_leavers() (migration-041): everyone on a list in the last 90 days who
       is NOT on the current one, with the date of the first list that stopped naming them. The
       apps keep a leaver's facts attributed up to that date (Nick, 15 Sep: the 17 agents the
       14 Sep list removed had 49 sales and 205 h of talk credited to nobody). The archive says
       who left and when; no browser derives it. */
async function rosterExtras(DB) {
  /* A FAILED LOOKUP IS NOT AN EMPTY ANSWER (review, 2026-09-21). `.catch(() => null) || []` made a
     broken function indistinguishable from "nobody left / no aliases" — the exact silent shape the
     aliases exist to end. Each failure is logged and named in `degraded[]`, which travels with the
     payload so PULSE can say "the archive did not answer" instead of quietly resolving nothing. */
  const degraded = [];
  const ask = async (what, p) => { try { return (await p) || []; } catch (e) { degraded.push(what); console.error('rosterExtras ' + what + ' failed: ' + (e && e.message || e)); return []; } };
  const leaders = (await ask('leaders', DB.select('team_leader_cbs?select=leader_name,employee_code,campaign,manager,on_list_as_of')))
    .filter((l) => l && l.employee_code).map((l) => ({ name: l.leader_name, cb: normCb(l.employee_code), campaign: l.campaign || '', manager: l.manager || '', on_list_as_of: l.on_list_as_of || '' }));
  const leavers = (await ask('leavers', DB.rpc('agent_list_leavers', { p_days: 90 })))
    .filter((r) => r && r.code && r.left_on).map((r) => ({ code: String(r.code).toUpperCase(), name: r.name || '', sf: r.sf || '', callx: r.callx || '',
      tl: r.tl || '', campaign: r.campaign || '', tenure: r.tenure || '', target: r.target, start: r.start_date || '', last_on: r.last_on, left: r.left_on }));
  /* · aliases — agent_list_aliases() (migration-044, 2026-09-21): every earlier spelling of a code
       on the current list. The 18 Sep list re-typed twelve names and Salesforce kept the old ones,
       so ~206 September sales were credited to nobody; PULSE resolves an Owner through these when
       no live name matches. Reported, never invented: only spellings a list actually carried. */
  const aliases = (await ask('aliases', DB.rpc('agent_list_aliases', { p_days: 180 })))
    .filter((r) => r && r.code && r.name).map((r) => ({ code: normCb(r.code) || String(r.code).toUpperCase(), name: String(r.name), last_on: r.last_on || '' }));
  return { leaders, leavers, aliases, degraded };
}


/* ============ ONE ROSTER, EVERY STORE — the sync spine ============================
   Nick, 2026-08-28: "when I upload in the upload station in vas, ops must automatically
   update — make this never happen again." It had happened because Ops keeps its own copy
   of the Agent List and only re-ingested when a HUMAN OPENED OPS, so a list uploaded in
   VAS could sit unseen there for days (26-Aug list still showing Renolan/Grp13 on 28-Aug).

   This function is the single place that: builds the roster payload, refreshes the
   agent->team authorisation map, and MIRRORS the roster into Ops' own fact store. It is
   called from THREE independent triggers so no single hop can lose an update:
     1. GET /api/roster        — any dashboard polling (and PULSE's ?fresh=1 ping on upload)
     2. the CRON schedule      — every 10 minutes, whether or not anything is open
     3. POST /api/kv agent-digest — the digest push that follows every roster ingest
   Each write is fingerprint-gated, so repeat calls cost one small select and nothing else. */
/* THE MIRROR AND THE AUTHORISATION FLOOR, shared by both roster paths. Extracted
   2026-08-28 when the roster gained a second publisher: whichever app's list wins,
   Ops' boot copy and kv:agent-teams must follow the SAME payload, or the app that
   did not upload keeps painting yesterday's leaders. `roster` is payload.roster. */
async function mirrorRoster(env, DB, payload, who) {
  const roster = (payload && payload.roster) || [];
  /* AGENT-TEAMS SELF-REFRESH (Nick, 2026-08-27: "everytime the agent list is uploaded
     data must change"). kv:agent-teams is the portal's authorisation floor — merged in
     wherever the digest lacks a tl (portal.mjs loadDigest). It used to be written only
     by tools/provision-agent-logins.mjs, a hand-run tool, so a reorganised floor kept
     an old map until someone remembered to run it. Now the map follows the roster:
     whenever the fingerprint moves, it is rewritten from the same rows this payload
     serves. The provisioning tool's remaining job is LOGINS only. Best-effort — a
     failed write must never break /api/roster itself. */
  /* Compared against the STORED row's fingerprint, not isolate memory (adversarial
     review, 2026-08-27): a long-lived isolate whose memory matched could skip a
     needed write after an A→B→A roster revert. This path already paid for a
     multi-MB state download; one tiny select per uncached build (≤ every 120s)
     is noise, and the DB is the only truth worth trusting. */
  try {
    const cur = await DB.select(`rules?key=eq.${encodeURIComponent('kv:agent-teams')}&select=value`).catch(() => null);
    const dbFp = cur && cur[0] && cur[0].value && cur[0].value.fingerprint;
    /* `&& roster.length` matters as much here as it does on the mirror below: an empty
       or failed roster parse would otherwise write teams:{} and flatten the portal's
       authorisation floor (audit round 6, second pass). */
    if (dbFp !== payload.fingerprint && roster.length) {
      const teams = {}; for (const a of roster) if (a.code && a.tl) teams[a.code] = a.tl;
      await DB.insert('rules', [{ key: 'kv:agent-teams',
        value: { teams, fingerprint: payload.fingerprint, source: 'roster-sync', updated_at: new Date().toISOString() },
        updated_by: who || 'roster-sync', updated_at: new Date().toISOString() }], true);
    }
  } catch (e) {}

  /* ---- MIRROR THE ROSTER INTO OPS' OWN STORE (Nick, 2026-08-28) ----------------
     "this morning a new agent list was uploaded — agents were still in renolan and
     still grp13 when they had a new team leader and in m0."  Root cause: Ops keeps
     its own Agent List and only re-ingests when a HUMAN OPENS OPS. Nick uploads in
     VAS, so Ops sat on the 26-Aug list for two days — showing the old leader and the
     old tenure — and everything Ops publishes went with it. Its sync is correct when
     it runs (proven); it simply was not running.
     So the stored copy Ops PAINTS FROM on boot is kept current here, from the very
     roster this endpoint already serves. This is a mirror, not a second parser: the
     fields are copied across, nothing is derived. Ops still re-ingests through its
     own applyLoad on boot (non-negotiable 11) and that remains the authority for
     identity — this only guarantees the first frame is not two days old.
     Written only when the roster actually changed, and best-effort: a failure here
     must never break /api/roster itself. */
  try {
    const mirRow = await DB.select(`rules?key=eq.${encodeURIComponent('kv:roster-mirror-fp')}&select=value`).catch(() => null);
    const mirFp = mirRow && mirRow[0] && mirRow[0].value && mirRow[0].value.fingerprint;
    if (mirFp !== payload.fingerprint && roster.length) {
      const norm = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const rows = roster.map((a) => ({
        cb_code: a.code, cb_norm: norm(a.code), agent_name: a.name,
        team_leader: a.tl, queue: a.campaign, tenure: a.tenure,
        callx_alias: a.callx || '-', sf_name: a.sf || a.name,
        target: a.target, start_date: a.start || null,
        _d: null, _batch: 'VASMIRROR',
      }));
      const objPath = 'raw/kv/cb-facts-AGENT_LIST';
      const put = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${objPath}`, {
        method: 'POST',
        headers: { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY, 'Content-Type': 'text/plain', 'x-upsert': 'true' },
        body: JSON.stringify(rows),
      });
      if (put.ok) {
        await DB.insert('rules', [
          { key: 'kv:cb-facts-AGENT_LIST', value: { store: objPath }, updated_by: 'roster-mirror', updated_at: new Date().toISOString() },
          { key: 'kv:roster-mirror-fp', value: { fingerprint: payload.fingerprint, n: rows.length, as_of: payload.as_of, updated_at: new Date().toISOString() }, updated_by: 'roster-mirror', updated_at: new Date().toISOString() },
        ], true);
      }
    }
  } catch (e) {}
}

async function rosterSync(env, DB, { fresh = false, who = 'roster-sync' } = {}) {
        /* short per-isolate cache (review, 2026-08-26): every open dashboard polls this
           every 10 min, and each uncached hit downloads + parses the multi-MB vas-state
           blob. Two minutes of staleness is invisible at a 10-minute poll cadence. */
        /* ?fresh=1 bypasses the isolate cache — PULSE pings this immediately after a roster
           ingest so the mirror below is written at once rather than up to two minutes later. */
        const rc = globalThis.__rosterCache;
        if (rc && Date.now() - rc.t < 120000 && !fresh) return rc.payload;
        /* THE ROSTER OF RECORD COMES FIRST (2026-08-28). This function also writes the Ops
           boot mirror and the portal's authorisation floor, so if it kept deriving from
           kv:vas-state it would quietly overwrite a list published from Ops with VAS's
           older one — the exact drift this whole change exists to end. When a record
           exists it IS the roster; the derivation below remains for the period before the
           first list is posted. */
        /* A SEEDED RECORD IS NOT A PUBLISHED ONE (audit, 2026-08-28). The cron seeds
           kv:roster-current from this very derivation so the record path is live before
           anyone uploads — but that seed is a COPY of kv:vas-state, not a list somebody
           published, and it was outranking the thing it was copied from: once seeded, a
           roster change in PULSE could never reach Ops again until a POST happened to
           succeed. A failed publish pinned the whole suite on a stale list with no way
           back, which is the exact fault this design exists to end. So a record wins only
           when it was PUBLISHED; a seed keeps tracking the derivation below and is
           rewritten whenever that moves. Guarded by verify-roster-propagation.mjs. */
        let seeded = null;
        {
          /* A READ THAT FAILS IS NOT "NO RECORD" (2026-09-21). Swallowing it here fell through to
             the vas-state derivation below, which carries a different fingerprint and so re-mirrored
             Ops' Agent List and the portal's agent-teams floor from VAS state instead of the
             published record — silently, for up to the cache's two minutes. Keep the cached roster
             if there is one, else answer with the error; never derive. */
          let cr = null;
          try { cr = await DB.select(`rules?key=eq.${encodeURIComponent('kv:roster-current')}&select=value,updated_at`); }
          catch (e) {
            console.warn('rosterSync: roster-current read failed — not deriving from vas-state', String(e && e.message || e));
            return rc ? rc.payload : { error: 'roster of record unreadable: ' + String(e && e.message || e), status: 503 };
          }
          const rec = cr && cr[0] && cr[0].value;
          if (rec && Array.isArray(rec.roster) && rec.roster.length && rec.source === 'seed') seeded = { rec, at: cr[0].updated_at || '' };
          else if (rec && Array.isArray(rec.roster) && rec.roster.length) {
            const payload = { fingerprint: rec.fingerprint, n: rec.roster.length, as_of: rec.as_of || '',
              file: rec.file || '', source: rec.source || '', uploaded_by: rec.uploaded_by || '',
              uploaded_at: rec.uploaded_at || '', state_updated_at: cr[0].updated_at || '', roster: rec.roster };
            globalThis.__rosterCache = { t: Date.now(), payload };
            await mirrorRoster(env, DB, payload, who);
            return payload;
          }
        }
        const r = await DB.select(`rules?key=eq.${encodeURIComponent('kv:vas-state')}&select=value,updated_at`);
        if (!r || !r.length) return { error: 'no vas-state uploaded yet', status: 404 };
        const v = r[0].value || {};
        let S;
        if (v.store) {
          const sr = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${v.store}`, { headers: { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY } });
          if (!sr.ok) return { error: 'state blob unreadable: ' + sr.status, status: 500 };
          S = JSON.parse(await sr.text());
        } else S = JSON.parse(String(v.data || '{}'));
        const roster = (S.roster || []).map(a => ({ code: a.code, name: a.name || '', tl: a.tl || '', campaign: a.campaign || '',
          tenure: a.tenure || '', callx: a.callx || '', sf: a.sf || '', target: a.target || null, start: a.start || '' }));
        let h = 0x811c9dc5;   // FNV-1a over sorted rows: stable across roster order
        for (const s of roster.map(a => [a.code, a.name, a.tl, a.campaign, a.tenure, a.callx, a.sf, a.target, a.start].join('|')).sort())
          for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
        const files = (S.files || []).filter(f => /^roster/.test(f.type || ''));
        const asOf = files.map(f => f.asOf || '').filter(Boolean).sort().pop() || '';
        const payload = { fingerprint: 'vas:' + h.toString(16), n: roster.length, as_of: asOf,
          file: (files[0] && files[0].name) || '', state_updated_at: r[0].updated_at || '', roster };
        globalThis.__rosterCache = { t: Date.now(), payload };
        /* Keep a stale SEED in step with what it was seeded from. Without this the record
           would still be serving the old roster to anything that reads it directly (the
           GET route's own record branch, PULSE's adoptRosterFromRecord), while the mirror
           below carried the new one — two answers to "who is on the list". */
        if (seeded && seeded.rec.fingerprint !== payload.fingerprint && roster.length) {
          const now = new Date().toISOString();
          await DB.insert('rules', [{ key: 'kv:roster-current', updated_by: 'seed-refresh', updated_at: now,
            value: { v: 1, fingerprint: payload.fingerprint, as_of: asOf, n: roster.length, roster,
              file: payload.file, source: 'seed', uploaded_by: 'seed-refresh', uploaded_at: now,
              replaced: { fingerprint: seeded.rec.fingerprint, as_of: seeded.rec.as_of || '', at: seeded.at } } }], true);
        }
  await mirrorRoster(env, DB, payload, who);
  return payload;
}

/* WHICH DASHBOARD WAS ACTUALLY OPENED, AND WHEN (2026-09-04). The freshness sentinel used to
   infer "somebody used Ops" from any staff sign-in, so a VAS-only day raised "AgentOS
   Analytics has not saved its config despite staff signing in" — a red banner over a
   dashboard nobody had opened. A boot is unmistakable (PULSE pulls vas-state; Ops asks
   kv-meta for its cb-facts- stores), so each is stamped here into ONE small row,
   kv:app-opened {vas, ops}, at most once per ten minutes per app, off the request path.
   The sentinel then asks the right question: opened since its last save, and still not
   saved 26 hours on. */
const OPEN_STAMP_MS = 10 * 60000;
function stampAppOpen(DB, ctx, app) {
  const mem = (globalThis.__appOpened = globalThis.__appOpened || {});
  const now = Date.now();
  if (mem[app] && now - mem[app] < OPEN_STAMP_MS) return;
  mem[app] = now;
  const work = (async () => {
    const cur = await DB.select(`rules?key=eq.${encodeURIComponent('kv:app-opened')}&select=value`).catch(() => null);
    const v = Object.assign({}, (cur && cur[0] && cur[0].value) || {});
    v[app] = new Date(now).toISOString();
    await DB.insert('rules', [{ key: 'kv:app-opened', value: v, updated_by: 'open-stamp', updated_at: v[app] }], true);
  })().catch(() => {});
  if (ctx && ctx.waitUntil) ctx.waitUntil(work);
}

/* WHO IS LOCKED TO THE PORTAL (2026-09-07). The lockdown used to key on the role name alone,
   so a campaign manager — a PORTAL role, because the Campaign Manager view lives in Agent
   Analytics — was refused /api/kv, /api/roster and every other management route even when
   Nick had granted them Ops and VAS Analytics: Dalwin signed in and PULSE sat on "Loading
   your data from Supabase…" forever (the 403s never reach the screen). The lock now follows
   the GRANT: a portal role with no management app is locked exactly as before (every agent,
   every team leader), while one that has been given 'ops', 'vas' or 'tracker' is a manager
   who also has a portal view. Deny-by-default is unchanged — the allow-list still decides
   which routes a locked user may call. */
const MANAGEMENT_APPS = new Set(['ops', 'vas', 'tracker']);
function portalOnly(user) {
  if (!user || !PORTAL_ROLES.has(user.role)) return false;
  const apps = Array.isArray(user.apps) ? user.apps : [];
  return !apps.some((a) => MANAGEMENT_APPS.has(String(a)));
}

export default {
  /* THE SAFETY NET (Nick, 2026-08-28: "make this never happen again"). Every ten minutes,
     with nothing open anywhere, the roster is re-synced into Ops' store and the agent->team
     map. The browser triggers stay — this exists so that a missed ping, a closed laptop or a
     failed request can never again leave one app running on a different Agent List from the
     others. Fingerprint-gated: when nothing changed it is one small select and no writes. */
  async scheduled(event, env, ctx) {
    const DB = db(env);
    /* THE COACHING WAVE HAS ITS OWN TRIGGER (2026-09-16). Inside the ten-minute tick it failed every
       time: the roster sync and the health checks had already spent most of the Free plan's 50
       subrequests, and the wave's 29 Convex calls tipped it over — silently, because the tick
       caught the error and `wrangler tail` redacts the message. Run by hand it works (three waves,
       1,022 sessions). A second cron expression gets a second invocation with its own budget. */
    /* WHICH TRIGGER IS THIS? The tick is the only "every ten minutes" expression; anything else that
       fires this handler is the coaching wave — compared loosely (2026-09-17: the snapshot sat 31 h old
       while the wave ran by hand, so the strict string compare was not matching what Cloudflare hands
       over). Every scheduled event is also stamped to kv:cron-log so the next such question is a read. */
    const cronStr = String(event.cron || '').replace(/\s+/g, ' ').trim();
    const isTick = cronStr === '*/10 * * * *' || cronStr === '';
    ctx.waitUntil(DB.insert('rules', [{ key: 'kv:cron-log', value: { last: cronStr, at: new Date().toISOString(), tick: isTick }, updated_by: 'cron', updated_at: new Date().toISOString() }], true).catch(() => {}));
    if (!isTick) {
      ctx.waitUntil((async () => {
        try { const cw = await snapshotCoachingWave(env, DB); console.info('[cron:coaching] ' + JSON.stringify(cw)); }
        catch (e) { console.warn('[cron:coaching] failed: ' + (e && e.message || e)); }
      })());
      return;
    }
    ctx.waitUntil((async () => {
      try {
        const p = await rosterSync(env, DB, { fresh: true, who: 'cron' });
        if (p && p.error) console.warn('[cron] roster sync: ' + p.error);
        else console.info('[cron] roster synced — ' + (p && p.n) + ' agents, fingerprint ' + (p && p.fingerprint));
        /* SEED THE ROSTER OF RECORD, ONCE, WITH NOBODY PRESENT (2026-08-28).
           kv:roster-current is created by whichever station next publishes a list — which
           means the new single-source path stays dormant until somebody happens to upload.
           That is the same "waiting for a human" weakness the whole change exists to
           remove, so the cron adopts what is already being served: the roster this sync
           just built, unchanged, moved into the record where both apps read it. Written
           ONLY when no record exists — a published list is never overwritten by a
           derivation — and a later list still supersedes it by date, as normal. */
        if (p && !p.error && Array.isArray(p.roster) && p.roster.length && !/^list:/.test(String(p.fingerprint || ''))) {
          const have = await DB.select(`rules?key=eq.${encodeURIComponent('kv:roster-current')}&select=value`).catch(() => null);
          if (!(have && have[0] && have[0].value && (have[0].value.roster || []).length)) {
            /* KEEP THE FINGERPRINT THE SYNC JUST PRODUCED. Re-hashing the same rows under a
               different prefix gave the record `list:e0f9e8b3` while the mirror carried
               `vas:e0f9e8b3` — the same hash, judged unequal, so the mirror rewrote itself
               on every cron tick for ever. The seed IS the derived roster; it should say so.
               A genuine publish still arrives as `list:` and correctly forces a rewrite. */
            const now = new Date().toISOString();
            await DB.insert('rules', [{ key: 'kv:roster-current', updated_by: 'cron-seed', updated_at: now,
              value: { v: 1, fingerprint: p.fingerprint, as_of: p.as_of || '', n: p.roster.length,
                roster: p.roster, file: p.file || '', source: 'seed', uploaded_by: 'cron-seed',
                uploaded_at: now, replaced: null } }], true);
            globalThis.__rosterCache = null;
            console.info('[cron] roster of record seeded — ' + p.roster.length + ' agents, as of ' + (p.as_of || 'unknown'));
          }
        }
        /* LOGINS FOLLOW THE LIST (Nick, 2026-08-30). Anyone new on the Agent List
           gets an account they can sign in with; anyone no longer on it has theirs
           removed, so nothing accumulates. Gated on the roster FINGERPRINT, so a
           stable list costs one small select and this does nothing 143 ticks out of
           144. Every guard inside fails closed — see provision.mjs. */
        if (p && !p.error && Array.isArray(p.roster) && p.roster.length) {
          try {
            const g = await syncAgentLogins(DB, p.roster, p.fingerprint, { asOf: p.as_of, actor: 'cron' });
            if (g.skipped === 'unchanged') { /* the ordinary case: say nothing */ }
            else if (g.skipped) console.warn('[cron] agent logins NOT synced — ' + g.skipped + ' ' + JSON.stringify(g));
            else if (g.status === 'SUCCESS') {
              const n = (k) => (g[k] || []).length;
              console.info('[cron] agent list synced — +' + n('created') + ' created, ' + n('updated')
                + ' updated, -' + n('removed') + ' removed (' + g.agents_before + ' → ' + g.agents_after
                + ' accounts, ' + g.on_list + ' on the list)'
                + (n('created') ? ' new: ' + g.created.map((c) => c.cb).join(',') : '')
                + (n('removed') ? ' gone: ' + g.removed.map((c) => c.cb).join(',') : ''));
              /* Team leaders cannot be provisioned from a list that has no leader
                 rows and no leader CB numbers, so they are REPORTED rather than
                 invented. Silence here would let a leader with no login stay
                 unnoticed for weeks, which is exactly what happened to Hezron. */
              const L = g.leaders || {};
              if ((L.unrepresented || []).length)
                console.warn('[cron] team leaders on the list with NO account: ' + L.unrepresented.join(', '));
              if ((L.orphaned || []).length)
                console.warn('[cron] team leader accounts leading nobody on the list: '
                  + L.orphaned.map((o) => o.username + ' (' + o.name + ')').join(', '));
            }
            /* Never silently: a refusal or a validation failure is the whole point
               of having guards, and it must be visible in the log with its reason. */
            else console.warn('[cron] agent list NOT synced — ' + g.status + ': '
              + (g.detail || '') + ' ' + JSON.stringify(g.errors || g.reason || ''));
          } catch (e) { console.warn('[cron] agent login sync failed: ' + (e && e.message || e)); }

          /* CAMPAIGNS FOLLOW THE SAME LIST (Nick, 2026-09-03). A campaign named on the
             list for the first time is CREATED and named here so somebody sets its
             targets and owner; one no agent carries is DELETED (Nick, 2026-09-03). */
          try {
            const k = await syncCampaigns(DB, { actor: 'cron' });
            const n = (x) => (k[x] || []).length;
            if (k.status === 'SUCCESS' && (n('created') || n('deleted')))
              console.info('[cron] campaigns synced — +' + n('created') + ' created, -' + n('deleted') + ' deleted'
                + (n('created') ? ' NEW (needs targets + owner): ' + k.created.map((c) => c.label + ' (' + c.agents + ')').join(', ') : '')
                + (n('deleted') ? ' gone: ' + k.deleted.map((c) => c.label).join(', ') : ''));
            else if (k.status && k.status !== 'SUCCESS')
              console.warn('[cron] campaigns NOT synced — ' + k.status + ': ' + (k.detail || ''));
          } catch (e) { console.warn('[cron] campaign sync failed: ' + (e && e.message || e)); }

          /* LEADERS FOLLOW THE SAME LIST. Cheap when nothing has moved: one query over
             the current list and the leader accounts, no writes. */
          try {
            const t = await syncTeamLeaders(DB, { actor: 'cron' });
            const n = (k) => (t[k] || []).length;
            if (t.status === 'SUCCESS' && (n('created') || n('removed')))
              console.info('[cron] team leaders synced — +' + n('created') + ' created, -' + n('removed') + ' removed'
                + (n('created') ? ' new: ' + t.created.map((c) => c.username).join(',') : '')
                + (n('removed') ? ' gone: ' + t.removed.map((c) => c.username).join(',') : ''));
            else if (t.status && t.status !== 'SUCCESS')
              console.warn('[cron] team leaders NOT synced — ' + t.status + ': ' + (t.detail || ''));
            /* A leader on the list with no CB on file cannot be provisioned and must not
               vanish into a log nobody reads — this is how Hezron Pillay stayed invisible. */
            if ((t.unrepresented || []).length)
              console.warn('[cron] team leaders on the list with NO CB on file: ' + t.unrepresented.join(', '));
          } catch (e) { console.warn('[cron] team leader sync failed: ' + (e && e.message || e)); }
        }
      } catch (e) { console.warn('[cron] roster sync failed: ' + (e && e.message || e)); }

      /* PERSISTENCE HEALTH (save-reliability-plan P2/P4, after the 28–31 Aug silent
         save loss). Three independent jobs, each in its own try so one failure can
         never take the others — or the roster sync above — down with it:
           · the freshness sentinel: uploads arriving while neither state saves is
             the incident's signature, and it becomes an admin banner in both apps
             within one tick of starting;
           · daily gzipped snapshots of the two state blobs — the recovery point the
             incident never had (its data survived only because the raw-file relay
             happens to archive uploads);
           · hygiene: orphaned zz-* probe keys and write-log rows past 90 days. */
      try { await runHealthChecks(DB, { runnerExpected: env.GITHUB_RUNNER === 'on', env }); }
      catch (e) { console.warn('[cron] health checks failed: ' + (e && e.message || e)); }
      /* THE GITHUB KICK IS OFF (Nick, 2026-09-16: "my email keeps getting github emails saying failed …
         I dont want to be on any paid plans"). Every ask produced a billing-refused run and an email
         to Nick — nine on the morning of the 16th alone. kickRunner stays in runner.mjs for the day
         the account is unblocked; until then nothing here asks GitHub for anything. */
      if (env.GITHUB_RUNNER === 'on') {
        try { await kickRunner(env, DB); }
        catch (e) { console.warn('[cron] runner kick failed: ' + (e && e.message || e)); }
      }
      /* the coaching snapshot runs on its own cron trigger (COACHING_CRON above) — see scheduled() */
      try {
        const snaps = await dailySnapshots(env, DB);
        if (snaps.length) console.info('[cron] state snapshots: ' + snaps.join('; '));
      } catch (e) { console.warn('[cron] snapshots failed: ' + (e && e.message || e)); }
      try { await hygiene(env, DB); }
      catch (e) { console.warn('[cron] hygiene failed: ' + (e && e.message || e)); }
      /* a blob in raw/uploads/ the manifest does not know is re-added (2026-09-08: the lost ViciDial report) */
      try { const m = await reconcileManifest(env, DB); if (m.repaired.length) console.info('[cron] manifest repaired: ' + m.repaired.join('; ')); }
      catch (e) { console.warn('[cron] manifest reconcile failed: ' + (e && e.message || e)); }
    })());
  },
  async fetch(req, env, ctx) {
    // CORS: the suite (pages.dev + preview subdomains) may call this API.
    const origin = req.headers.get('origin') || '';
    const okOrigin = origin === 'https://chatterbox-agentos.pages.dev' || /^https:\/\/[a-z0-9-]+\.chatterbox-agentos\.pages\.dev$/.test(origin);
    /* X-Cbx-Version is EXPOSED so a page can read the version stamp off a /api/kv response —
       a response header not named here is invisible to the page, the read-side twin of the
       Content-Encoding lesson below (2026-09-14, the fact-store lost-update fix). */
    const cors = okOrigin ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true', 'Vary': 'Origin', 'Access-Control-Expose-Headers': 'X-Cbx-Version' } : {};
    /* EVERY HEADER A CLIENT SENDS MUST BE NAMED HERE. Content-Encoding was not, and
       PULSE's gzipped state save (28 Aug) set it — so for four days the browser refused
       to send the request at all and the whole floor's uploads stopped reaching the
       database, with "Cloud save failed (network)" as the only symptom. Content-Encoding
       is not CORS-safelisted; nor are most custom headers. Anything a client adds to a
       write belongs in this list, and diagnostics/verify-cors-headers.mjs fails if a
       client starts sending one that is missing.
       Note the cache: Access-Control-Max-Age keeps a browser on the previous answer for
       24 hours, so widening this list cannot rescue a client already being refused —
       the client must also stop sending the header. Both were done. */
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Cbx-Client,Content-Encoding,X-Cbx-Base', 'Access-Control-Max-Age': '86400' } });
    const res = await this.handle(req, env, ctx);
    const h = new Headers(res.headers); for (const [k, v] of Object.entries(cors)) h.set(k, v);
    return new Response(res.body, { status: res.status, headers: h });
  },

  async handle(req, env, ctx) {
    const url = new URL(req.url);
    const path = url.pathname;
    const DB = db(env);
    try {
      // ---------- version gate (ONE check; was copy-pasted 8×) ----------
      // Outdated app copies (old tabs / bookmarked preview URLs) show stale ghost
      // data, and used to bulk-repush stale caches and resurrect wiped data. Refuse
      // to authenticate them, and refuse their writes — read-only until refreshed.
      const stale = req.headers.get('x-cbx-client') !== 'v5';
      const OUTDATED = { error: 'This tab is an OUTDATED copy of AgentOS. Close it, go to https://chatterbox-agentos.pages.dev and press Ctrl+Shift+R.' };
      const GATED_WRITES = ['POST /api/kv', 'DELETE /api/kv', 'POST /api/eod', 'POST /api/bi', 'DELETE /api/bi', 'POST /api/bi/raw'];

      // ---------- auth ----------
      if (stale && (path === '/api/me' || (path === '/api/login' && req.method === 'POST'))) return json(OUTDATED, 426);
      if (path === '/api/login' && req.method === 'POST') {
        const r = await login(DB, req, await req.json(), ctx);   // ctx lets the audit writes finish after the response
        if (!r.ok) return json({ error: r.error }, r.status);
        // token also in body: cross-origin pages use Bearer (cookie is same-origin only)
        return json({ user: r.user, token: r.token });
      }
      /* THE WIMPY SIGN-IN (2026-09-10): a CB number, no password, a session scoped to
         /api/wimpy/* — auth.mjs signinByCb has the rules and the rate limit. */
      if (path === '/api/wimpy/signin' && req.method === 'POST') {
        const r = await signinByCb(DB, req, await req.json().catch(() => ({})), ctx);
        if (!r.ok) return json({ error: r.error }, r.status);
        return json({ user: r.user, token: r.token });
      }

      // Referrals-pipe health: NO auth and NO data — booleans and counts only, so the
      // route/secrets/HighLevel legs can each be verified when the column reads 0.
      if (path === '/api/referrals/health') {
        const out = { route: true, hl_key: !!env.HL_API_KEY, hl_location: !!env.HL_LOCATION_ID };
        if (out.hl_key && out.hl_location) {
          try {
            const H = { Authorization: 'Bearer ' + env.HL_API_KEY, Version: '2021-07-28', Accept: 'application/json' };
            const r = await fetch(`https://services.leadconnectorhq.com/contacts/?locationId=${env.HL_LOCATION_ID}&limit=1`, { headers: H });
            out.hl_status = r.status;
            if (r.ok) { const d = await r.json(); out.hl_total = (d.meta && d.meta.total) || (d.contacts || []).length; }
            const cf = await fetch(`https://services.leadconnectorhq.com/locations/${env.HL_LOCATION_ID}/customFields`, { headers: H });
            out.hl_fields_status = cf.status;
            if (cf.ok) out.hl_fields = ((await cf.json()).customFields || []).length;
          } catch (e) { out.hl_error = String(e.message || e).slice(0, 200); }
        }
        out.cache = globalThis.__hlCache ? { age_s: Math.round((Date.now() - globalThis.__hlCache.t) / 1000), rows: (globalThis.__hlCache.d.rows || []).length } : null;
        return json(out);
      }

      const user = await session(DB, req);
      /* token_hash is the exact value stored in app_sessions — it identifies the live
         session and has no use in a browser, so it is stripped here rather than shipped
         into window.CBX_USER (audit round 4, 2026-08-28). */
      if (path === '/api/me') { if (!user) return json({ error: 'not signed in' }, 401);
        const { token_hash, ...safe } = user; return json({ user: safe }); }
      if (path === '/api/logout' && req.method === 'POST') { await logout(DB, user); return json({ ok: true }); }

      /* ---------- Agent Analytics: the ONE route the share link can reach ----------
         /agent/ is sent to the whole floor as a single link. Agents do not have accounts
         and are never asked for a password — Nick's call: a password is the thing that
         stops people looking, and a page nobody opens motivates nobody. So this route
         authorises on the LINK KEY, and sits above the session gate. Staff already signed
         in reach it on their session instead, which is how the app switcher works.

         THE BOUNDARY IS THIS HANDLER. The key unlocks nothing else: every route below
         still demands a session, so a link holder gets 401 from /api/kv, /api/bi,
         /api/eod, /api/ask and the rest. What it returns is not the dataset — it is the
         agent-safe digest PULSE publishes (see "AGENT ANALYTICS — THE DIGEST" in
         nicks_code/index.html): no case rows, no contact details, no coaching, nothing
         from Ops or Tracker.

         KNOWN AND ACCEPTED: anyone holding the link can look up any colleague on the
         roster. That is the trade for zero-friction access. Rotating the key in `rules`
         (tools/agent-link.mjs --rotate) kills every outstanding link at once. */
      if (path === '/api/agent-digest' && req.method === 'GET') {
        /* THE PASSWORDLESS SHARE LINK IS RETIRED (Nick, 2026-08-24).
           This route used to authorise on `?k=<agent_link_key>` so the whole floor
           could open /agent/ with no password. Agent Analytics now signs people in
           with a CB number, and the security model that requires — an agent sees
           only their own figures — cannot hold while a single shared link still
           returns the entire 130-agent digest to anyone holding it.
           So the key no longer authorises anything, and `?k=` is ignored. Staff
           sessions keep working (that is what the app switcher uses); a link
           holder now gets the 401 below and the page shows the sign-in screen.
           tools/agent-link.mjs --rotate was run at the same time, so no
           outstanding link resolves either. */
        if (!user) return json({ error: 'Please sign in with your CB number.' }, 401);
        /* AND THE ROLE LOCKDOWN, RESTATED HERE ON PURPOSE.
           This handler sits ABOVE the session gate — it has to, because it used to
           authorise link holders who had no session — which means the central
           lockdown further down never sees it. Without this line an agent's own
           valid session walks straight into the whole 130-agent digest: every
           colleague's name, premium and commission. Caught by the live section of
           verify-agent-portal.mjs, which is exactly why that section exists.
           Any future route placed above the gate needs this same line. */
        if (portalOnly(user)) return json({ error: 'Not permitted.' }, 403);

        // Edge-cached: hundreds of agents share one 5-minute copy, so Supabase sees
        // ~1 read per 5 minutes however many people open the link at once.
        const cache = caches.default;
        const ck = new Request(new URL('/__agent-digest', url.origin).toString(), { method: 'GET' });
        const hit = await cache.match(ck);
        if (hit) return hit;

        const r = await DB.select(`rules?key=eq.${encodeURIComponent('kv:agent-digest')}&select=value`);
        const v = r?.[0]?.value || {};
        let payload = String(v.data || '');
        if (!payload && v.store) payload = (await DB.storageGet('raw', v.store.replace(/^raw\//, ''))) || '';
        if (!payload) return json({ error: 'Nothing has been published yet. Check again a little later.' }, 404);
        const out = new Response(payload, { status: 200, headers: {
          'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=300' } });
        ctx.waitUntil(cache.put(ck, out.clone()));
        return out;
      }

      // Everything below requires a session.
      if (!user) return json({ error: 'Sign in required.' }, 401);

      /* ---------- WIMPY SESSION SCOPE (2026-09-10) ----------
         A session minted by the CB-only sign-in (scope 'wimpy') buys lunch and reaches
         NOTHING else — not /api/kv, not the portal, not the roster — whatever the role
         on the account. Above the role lockdown so it applies to every role alike;
         /api/me and /api/logout sit above the gate and still answer, which is what the
         Wimpy page needs to show a name and to sign out. */
      if (user.scope === 'wimpy' && !path.startsWith('/api/wimpy/'))
        return json({ error: 'This sign-in is for Wimpy orders only.' }, 403);

      /* ---------- AGENT ANALYTICS ROLE LOCKDOWN ----------
         THIS MUST STAY THE FIRST THING AFTER THE SESSION CHECK. Before agents
         had logins, every route below this line answered ANY valid session —
         which was safe only because the only sessions that existed belonged to
         management. Issuing ~130 agent logins without this block would hand
         every agent /api/kv, and /api/kv alone returns the entire 16.6 MB
         vas-state: every colleague's money, case rows and contact details.

         It is an ALLOW-LIST, deliberately. Deny-by-default means a route added
         to this Worker next month is closed to agents until somebody opens it
         on purpose — the opposite polarity (a deny-list) fails open, silently,
         exactly once, and that once is a POPIA incident. */
      if (portalOnly(user) && !PORTAL_ALLOWED.has(path))
        return json({ error: 'Not permitted.' }, 403);

      /* The campaign-manager context (assignments, SLA rules, blockage table,
         team-leader codes) — loaded once per request, read synchronously by
         authorise(). Team leaders need it too: their raise/confirm routes read
         the blockage table and SLA targets. */
      if ((user.role === 'campaign_manager' || user.role === 'team_leader' || user.role === 'admin' || user.role === 'exec')
          && (path.startsWith('/api/portal/cm/') || path === '/api/portal/overview' || path === '/api/portal/agent')) {
        try { await loadCmContext(DB); }
        catch (e) { if (user.role === 'campaign_manager') return json({ error: 'Could not load campaign assignments: ' + String(e.message || e).slice(0, 160) }, 503); }
      }

      // Write gate stays BELOW the session check — exactly where the six copies sat,
      // so a signed-out stale tab still gets 401 first, as it does today.
      if (stale && GATED_WRITES.includes(req.method + ' ' + path))
        return json({ error: 'Outdated app version — press Ctrl+Shift+R to refresh, then retry.' }, 409);

      /* ---------- PER-ACCOUNT THEME (Nick, 2026-08-30) ----------
         The suite still wears one skin; this is a personal override of it, stored
         on the account so it follows the person to whatever machine they sign in
         on. Two values only — the two the stylesheets actually define — because a
         value the apps cannot render is worse than no value at all.

         It is deliberately NOT on PORTAL_ALLOWED: Agent Analytics has no dark
         palette, so an agent saving 'dark' would get a light page and a stored
         lie. The lockdown refuses them here, which is the honest answer until
         that app has a dark skin of its own. */
      if (path === '/api/theme' && req.method === 'POST') {
        const b = await req.json().catch(() => ({}));
        const t = String(b.theme || '');
        if (t !== 'light' && t !== 'dark') return json({ error: 'Theme must be light or dark.' }, 400);
        await DB.update(`app_users?username=eq.${encodeURIComponent(user.username)}`, { theme: t });
        return json({ ok: true, theme: t });
      }

      /* ---------- Agent Analytics portal ---------- */
      /* RUN ONE COACHING WAVE BY HAND AND SAY WHAT HAPPENED (2026-09-16) — the cron's warnings are
         redacted in `wrangler tail`, so a failing wave was invisible. Admin only. */
      if (path === '/api/coaching/wave' && user && user.role === 'admin') {
        try { const r = await snapshotCoachingWave(env, DB); return json({ ok: true, result: r }); }
        catch (e) { return json({ ok: false, error: String(e && e.message || e), stack: String(e && e.stack || '').split('\n').slice(0, 4) }, 200); }
      }
      if (path === '/api/portal/me' && req.method === 'GET') {
        return json({ user: { username: user.username, name: user.full_name || user.username,
          role: user.role, cb: normCb(user.cb), team: user.team || '' } });
      }
      if (path === '/api/portal/overview' && req.method === 'GET') {
        /* ?month=YYYY-MM opens a published past month; anything else is the live digest. */
        const mq = url.searchParams.get('month') || '';
        const month = /^\d{4}-\d{2}$/.test(mq) ? mq : null;
        const digest = await loadDigest(DB, month);
        if (!digest) return json({ error: month
          ? 'No figures were published for ' + month + '.'
          : 'Nothing has been published yet. Check again a little later.' }, 404);
        /* For a campaign manager the assistance half is fetched here and handed
           in — overview() must not import assist.mjs (assist imports authorise
           from portal.mjs; a cycle fails at parse). HighLevel down → the sales
           half still renders and the page says the register is unreachable. */
        let extra;
        if (user.role === 'campaign_manager') {
          try { const a = await assistList(env, DB, user, digest, globalThis.__cmCtx || {});
            extra = { assist: a.status === 200 ? a.body : { error: (a.body && a.body.error) || 'Assistance unreachable.' } }; }
          catch (e) { extra = { assist: { error: String(e.message || e).slice(0, 200) } }; }
        }
        const r = await overview(env, DB, user, digest, await listDigestMonths(DB), extra);
        return json(r.body, r.status);
      }
      /* ---------- NIKOLA — the assistant, scoped to the caller ----------
         One fact, one explanation, one next action, about the caller's own
         results only. It is built on the SAME payload /api/portal/overview
         returns, so it cannot discuss a colleague for the simple reason that it
         is never shown one — the scoping is the existing authorise(), not a
         sentence in a prompt asking the model to behave.

         THE IRON RULE: the model explains numbers, it never computes them. It is
         told to quote only the figures it is given and to refuse rather than
         estimate, and the page prints those same figures beside the answer so a
         wrong sentence cannot become a wrong number. */
      if (path === '/api/portal/ask' && req.method === 'POST') {
        const ks = await DB.select('rules?key=eq.ai_kill_switch&select=value');
        if (!ks?.[0]?.value?.enabled) return json({ answer: 'Nikola is switched off at the moment. Everything else on this page still works.' });
        const digest = await loadDigest(DB);
        if (!digest) return json({ error: 'Nothing has been published yet.' }, 404);
        const r = await overview(env, DB, user, digest);
        if (r.status !== 200) return json(r.body, r.status);

        const b = await req.json().catch(() => ({}));
        const q = String(b.q || b.question || '').slice(0, 500);
        if (!q) return json({ error: 'Ask a question first.' }, 400);

        /* Only the figures — never the coaching free text, which carries customer
           detail and belongs on the page that already shows it, not in a prompt. */
        const slim = JSON.stringify({
          period: r.body.period, workingDays: r.body.workingDays,
          me: r.body.me || null, peers: r.body.peers || null,
          team: r.body.team || null, totals: r.body.totals || null,
          agents: (r.body.agents || []).map((a) => ({ name: a.name, code: a.code, sales: a.sales,
            target: a.target, pctT: a.pctT, gwpEx: a.gwpEx, qa: a.qa, att: a.att, ref: a.ref })),
          coaching: r.body.coaching ? { sessions: r.body.coaching.totals?.sessions,
            agentsWithCoaching: r.body.coaching.totals?.agents, byType: r.body.coaching.byType } : null,
        }).slice(0, 24000);

        const who = user.role === 'team_leader' ? 'a team leader, about their own team'
          : (user.role === 'agent' ? 'an agent, about their own results' : 'a manager previewing the page');
        const sys = 'You are Nikola, the assistant inside Chatterbox Agent Analytics. You are speaking to '
          + who + '.\n'
          + 'ANSWER IN THIS SHAPE: one fact, one short explanation, one next action. Three or four sentences, no more.\n'
          + 'THE IRON RULE: you EXPLAIN numbers, you never CALCULATE them. Quote only figures that appear in the DATA below, '
          + 'verbatim. Never add, average, project or estimate. If the answer needs a figure that is not there, say plainly '
          + 'which figure is missing instead of working one out.\n'
          + 'You can only see this person\'s own data. If asked about anyone outside it, say that you can only see their own '
          + 'results and stop — do not speculate.\n'
          + 'Money is South African rand. Write plainly, no jargon, no acronym they have not been taught: "GWP" is fine, '
          + '"pctT", "composite" and "R2A" are not. Never frame anything as failure; say what would move it.\n'
          + 'DATA (this is everything you can see):\n' + slim;

        const mrow = await DB.select('rules?key=eq.ai_model&select=value');
        let model = (mrow?.[0]?.value?.value) || DEFAULT_MODEL;
        let ai;
        try {
          ai = await env.AI.run(model, { messages: [{ role: 'system', content: sys }, { role: 'user', content: q }], max_tokens: 320 });
        } catch (e) {
          /* THE DAILY AI ALLOWANCE IS A REAL, RECURRING STATE, NOT A CRASH.
             Workers AI on the free plan stops at 10,000 neurons a day and throws
             4006. Letting that fall through to the generic 500 tells the agent
             "server error", which reads as the whole page being broken when the
             figures above it are perfectly fine. Say what happened. */
          const msg = String(e && (e.message || e));
          if (/4006|neurons|daily free allocation/i.test(msg))
            return json({ answer: 'Nikola has used up today’s question allowance and will be back tomorrow. '
              + 'Every figure on your other tabs is unaffected.', basis: 'Daily AI allowance reached' });
          try {
            model = FALLBACK_MODEL;
            ai = await env.AI.run(model, { messages: [{ role: 'system', content: sys }, { role: 'user', content: q }], max_tokens: 320 });
          } catch (e2) {
            const m2 = String(e2 && (e2.message || e2));
            if (/4006|neurons|daily free allocation/i.test(m2))
              return json({ answer: 'Nikola has used up today’s question allowance and will be back tomorrow. '
                + 'Every figure on your other tabs is unaffected.', basis: 'Daily AI allowance reached' });
            return json({ error: 'Nikola could not answer just now. Everything else on this page is unaffected.' }, 502);
          }
        }
        const answer = (ai && (ai.response || ai.result || '')) || '';
        if (!answer) return json({ error: 'Nikola could not answer that just now.' }, 502);
        ctx.waitUntil(DB.insert('ask_log', [{ asked_by: user.username, question: q, answer, model }]).catch(() => {}));
        return json({ answer, basis: 'From your own published figures · ' + (r.body.period?.from || '') + ' to ' + (r.body.period?.to || '') });
      }

      /* ---------- THE TWO HUBS, PROXIED ----------
         The browser never reaches Convex. Neither hub authenticates: every one of
         their functions takes the leader's id as an argument, so a caller who
         supplies a different id reads and writes a different leader's records.
         The id here comes from app_users.hub_ids on the SESSION, so there is no
         request shape in which a team leader could ask for someone else's. */
      if (path === '/api/portal/hub/coaching') {
        const h = hubIdsOf(user);
        if (h.error) return json({ error: h.error }, h.status);
        try {
          if (req.method === 'GET') return json(await coachingList(h.ids));
          if (req.method === 'POST') {
            const r = await coachingCreate(h.ids, user, await req.json().catch(() => ({})));
            return json(r, r.error ? (r.status || 400) : 200);
          }
        } catch (e) {
          return json({ error: 'The Coaching Hub could not be reached: ' + String(e.message || e).slice(0, 200) }, 502);
        }
        return json({ error: 'Method not allowed.' }, 405);
      }
      if (path === '/api/portal/hub/kpi') {
        const h = hubIdsOf(user);
        if (h.error) return json({ error: h.error }, h.status);
        try {
          if (req.method === 'GET') return json({ ...(await kpiList(h.ids)), titles: KPI_TITLES });
          if (req.method === 'POST') {
            const r = await kpiWrite(h.ids, await req.json().catch(() => ({})));
            return json(r, r.error ? (r.status || 400) : 200);
          }
        } catch (e) {
          return json({ error: 'The KPI Hub could not be reached: ' + String(e.message || e).slice(0, 200) }, 502);
        }
        return json({ error: 'Method not allowed.' }, 405);
      }

      /* ---------- Agent Help Center — HighLevel-backed (help.mjs) ---------- */
      if (path.startsWith('/api/portal/help/')) {
        const digest = await loadDigest(DB);
        if (!digest) return json({ error: 'Nothing has been published yet.' }, 404);
        let r;
        try {
          if (path === '/api/portal/help/request' && req.method === 'POST') r = await helpRequest(env, DB, user, digest, await req.json().catch(() => ({})));
          else if (path === '/api/portal/help/list' && req.method === 'GET') r = await helpList(env, DB, user, digest);
          else if (path === '/api/portal/help/detail' && req.method === 'GET') r = await helpDetail(env, DB, user, digest, url.searchParams.get('id') || '');
          else if (path === '/api/portal/help/stage' && req.method === 'POST') r = await helpStage(env, DB, user, digest, await req.json().catch(() => ({})));
          else if (path === '/api/portal/help/actions' && req.method === 'GET') r = await actionsList(env, DB, user, digest);
          else if (path === '/api/portal/help/action' && req.method === 'POST') r = await actionSet(env, DB, user, digest, await req.json().catch(() => ({})));
          else if (path === '/api/portal/help/fails' && req.method === 'GET') r = await failsList(env, DB, user, digest);
          else if (path === '/api/portal/help/fail-detail' && req.method === 'GET') r = await failDetail(env, DB, user, digest, { cb: url.searchParams.get('cb') || '', theme: url.searchParams.get('theme') || '' });
          else if (path === '/api/portal/help/fail' && req.method === 'POST') r = await failSet(env, DB, user, digest, await req.json().catch(() => ({})));
          else if (path === '/api/portal/help/sync-coaching' && req.method === 'POST') r = await syncCoaching(env, DB, user, digest, await req.json().catch(() => ({})));
          else if (path === '/api/portal/help/mine' && req.method === 'GET') r = await helpMine(env, DB, user, digest);
          else if (path === '/api/portal/help/close' && req.method === 'POST') r = await helpCloseOwn(env, DB, user, digest, await req.json().catch(() => ({})));
          else if (path === '/api/portal/help/confirm' && req.method === 'POST') r = await helpConfirm(env, DB, user, digest, await req.json().catch(() => ({})));
          else if (path === '/api/portal/help/pulse' && req.method === 'GET') r = await helpPulse(env, DB, user, digest);
          else r = { status: 404, body: { error: 'Unknown help route.' } };
        } catch (e) { r = { status: 502, body: { error: 'HighLevel did not answer: ' + String(e.message || e).slice(0, 160) } }; }
        return json(r.body, r.status);
      }

      /* ---------- WIMPY ORDERING — its own app since 2026-09-10 ----------
         The menu is served from the Worker so a price lives in exactly one file,
         and the order is POSTed from here because the page's CSP allows it to
         reach this Worker and nothing else. Reachable by a wimpy-scoped session
         (the app's own sign-in), by a full agent session (on PORTAL_ALLOWED) and
         by any management session. The old /api/portal/wimpy/* paths answer 410
         for one release so a cached Agent Analytics tab fails in words. */
      if (path === '/api/wimpy/menu' && req.method === 'GET') return json(wimpyMenu());
      if (path === '/api/wimpy/order' && req.method === 'POST') {
        const r = await submitWimpyOrder(env, user, await req.json().catch(() => ({})));
        return json(r.body, r.status);
      }
      if (path.startsWith('/api/portal/wimpy/'))
        return json({ error: 'Wimpy ordering has moved to its own app — open Wimpy Order from the VAS Analytics Apps page and sign in with your CB number.' }, 410);

      /* ---------- CAMPAIGN ASSISTANCE — team leader → campaign manager ---------- */
      if (path.startsWith('/api/portal/cm/')) {
        const digest = await loadDigest(DB);
        if (!digest) return json({ error: 'Nothing has been published yet.' }, 404);
        const ctx = globalThis.__cmCtx || await loadCmContext(DB);
        try {
          let r = { status: 404, body: { error: 'Unknown route.' } };
          /* THE TARGET SETTINGS — campaign managers for their own campaigns, admin
             for all. Everyone else is refused before a byte of settings leaves. */
          if (path === '/api/portal/cm/settings') {
            if (user.role !== 'campaign_manager' && user.role !== 'admin')
              return json({ error: 'Target settings are a campaign manager page.' }, 403);
            const auth2 = { role: user.role, username: user.username };
            if (req.method === 'GET') r = cmSettingsBody(digest, auth2, ctx);
            else if (req.method === 'POST') r = await cmSettingsApply(DB, auth2, ctx, await req.json().catch(() => ({})));
            if (r && r.error && r.status) r = { status: r.status, body: { error: r.error } };
            return json(r.body, r.status);
          }
          if (path === '/api/portal/cm/request' && req.method === 'POST') r = await assistCreate(env, DB, user, digest, ctx, await req.json().catch(() => ({})));
          else if (path === '/api/portal/cm/assist' && req.method === 'GET') r = await assistList(env, DB, user, digest, ctx);
          else if (path === '/api/portal/cm/detail' && req.method === 'GET') r = await assistDetail(env, DB, user, digest, ctx, url.searchParams.get('id') || '');
          else if (path === '/api/portal/cm/act' && req.method === 'POST') r = await assistAct(env, DB, user, digest, ctx, await req.json().catch(() => ({})));
          else if (path === '/api/portal/cm/eod' && req.method === 'GET') {
            if (user.role !== 'campaign_manager' && user.role !== 'admin' && user.role !== 'exec')
              return json({ error: 'The end-of-day pack is a campaign manager export.' }, 403);
            const a = await assistList(env, DB, user, digest, ctx).catch(() => null);
            const assist = a && a.status === 200 ? a.body : { error: 'unreachable' };
            const ov = await overview(env, DB, user, digest, null, { assist });
            if (ov.status !== 200 || !ov.body.cm) return json({ error: 'Could not build the pack.' }, 500);
            r = { status: 200, body: { markdown: eodMarkdown(ov.body.cm, assist, user.full_name || user.username) } };
          }
          return json(r.body, r.status);
        } catch (e) {
          /* NEVER THE RAW BODY (review, 2026-09-21): an hl() error message carries up to 160 chars of
             HighLevel's response — contact ids, duplicate-contact details — and it went to whichever
             browser asked. A client-shaped HighLevel answer (4xx) is named in plain words; anything
             else is logged here and summarised there. */
          const msg = String(e && e.message || e);
          console.error('portal/cm ' + path + ' failed: ' + msg.slice(0, 300));
          const st = e && e.status;
          if (st >= 400 && st < 500) return json({ error: 'HighLevel refused that (' + st + ') — refresh your requests and try again; if it keeps happening tell Aarav.' }, 409);
          return json({ error: /HighLevel/.test(msg) ? 'HighLevel did not answer in time — try again in a moment.' : msg.slice(0, 200) }, 502);
        }
      }

      /* THE TEAM LEADER'S VARIANCE / LEAD MANAGEMENT SLICE (2026-09-21). authorise() needs the digest
         (that is where the team's codes live); the report key is loaded lazily, never on the overview. */
      if (path === '/api/portal/tl/reports' && req.method === 'GET') {
        const kind = String(url.searchParams.get('kind') || '');
        if (!/^(variance|leads)$/.test(kind)) return json({ error: 'kind must be variance or leads' }, 400);
        const digest = await loadDigest(DB, null);
        if (!digest) return json({ error: 'Nothing has been published yet. Check again a little later.' }, 404);
        const report = await loadReports(DB, kind).catch((e) => { console.error('loadReports ' + kind + ' failed: ' + (e && e.message || e)); return null; });
        const r = tlReports(user, digest, report, kind);
        return json(r.body, r.status);
      }

      if (path === '/api/portal/agent' && req.method === 'GET') {
        const digest = await loadDigest(DB, /^\d{4}-\d{2}$/.test(url.searchParams.get('month') || '') ? url.searchParams.get('month') : null);
        if (!digest) return json({ error: 'Nothing has been published yet. Check again a little later.' }, 404);
        const r = await agentDetail(env, DB, user, digest, url.searchParams.get('cb'));
        return json(r.body, r.status);
      }

      /* ---------- COACHING HUB (management) ----------
         The two routes PULSE and Ops have been calling since the coaching layer
         shipped. They did not exist: an unknown path fell through to the session
         gate above and answered {"error":"Sign in required."} with 401 —
         identical to a genuine auth failure, which is why this read as an
         expired token for weeks. Both apps catch it and print "Coaching Hub
         unavailable right now."

         Staff only. Portal roles never reach here (the lockdown above), which is
         intentional: /api/coaching/summary is the whole floor. An agent's own
         coaching arrives already scoped inside /api/portal/overview. */
      if (path === '/api/coaching' && req.method === 'GET') {
        const cb = normCb(url.searchParams.get('cb'));
        if (!cb) return json({ error: 'No agent specified.' }, 400);
        try {
          const hub = await getCoaching(env, DB);
          const { sessions, matchedBy } = sessionsForAgent(hub.sessions, cb, url.searchParams.get('name') || '');
          /* `unresolved` (Ops reads it) says the sessions were found by NAME, not
             by CB number — the join is a guess and the drill-down should say so
             rather than present it as certain. */
          return json({ cb, sessions, matchedBy, unresolved: matchedBy === 'name',
            fetchedAt: hub.fetchedAt, stale: !!hub.stale });
        } catch (e) {
          /* 502, not an empty list. "No coaching for this agent" and "the Hub is
             unreachable" must never look the same to a team leader. */
          return json({ error: 'Coaching Hub unreachable: ' + String(e.message || e).slice(0, 200) }, 502);
        }
      }
      if (path === '/api/coaching/summary' && req.method === 'GET') {
        try {
          const hub = await getCoaching(env, DB);
          const hubWindowed = withinWindow(hub.sessions, 90);   // "last 90 days" must actually mean it
          const digest = await loadDigest(DB);
          const roster = digest
            ? [...(digest.agents || []).map(a => ({ code: a.code, name: a.name, tl: a.tl || '' })),
               ...(digest.notCovered || []).map(a => ({ code: a.code, name: a.name, tl: a.tl || '' }))]
            : [];
          /* Roll up per ROSTER agent, so the org-wide view is the org chart's
             view. Hub records whose CB is not on the current roster are leavers
             and historical rows: counted in `offRoster` so the number is
             honest, never folded into a named agent. */
          const onRoster = new Set(roster.map(r => r.code));
          const agents = roster.map(r => {
            const { sessions, matchedBy } = sessionsForAgent(hub.sessions, r.code, r.name);
            return { code: r.code, name: r.name, tl: r.tl, sessions: sessions.length,
              last: sessions.length ? sessions[0].date : '', themes: rollUp(sessions), matchedBy };
          }).filter(a => a.sessions);
          const offRoster = hubWindowed.filter(s => !s.cb || !onRoster.has(s.cb)).length;
          return json({
            totals: {
              sessions: hubWindowed.length,
              scored: agents.reduce((n, a) => n + a.themes.reduce((m, t) => m + t.scored, 0), 0),
              agents: agents.length,
              offRoster,
            },
            agents, themes: rollUp(hubWindowed),
            leaders: hub.leaders, fetchedAt: hub.fetchedAt, stale: !!hub.stale, hubErrors: hub.errors || [],
          });
        } catch (e) {
          return json({ error: 'Coaching Hub unreachable: ' + String(e.message || e).slice(0, 200) }, 502);
        }
      }

      if (path === '/api/password' && req.method === 'POST') {
        /* the rule lives in auth.mjs (changePassword) so verify-login-lockout can drive it against a mocked DB */
        const out = await changePassword(DB, user, await req.json().catch(() => ({})), req, ctx);
        return json(out.body, out.status);
      }

      /* The shareable link, for staff to copy out of Agent Analytics. Below the session
         gate, so only signed-in staff ever see the key — an agent arriving on the link
         has no session and never gets this far. Mints one on first ask so the feature
         cannot sit silently broken waiting for someone to run a script. */
      if (path === '/api/agent-link' && req.method === 'GET') {
        const r = await DB.select(`rules?key=eq.agent_link_key&select=value`);
        let key = String(r?.[0]?.value?.key || '');
        if (!key || url.searchParams.get('rotate')) {
          const b = new Uint8Array(24); crypto.getRandomValues(b);
          key = btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
          await DB.insert('rules', [{ key: 'agent_link_key', value: { key, issued: new Date().toISOString() },
            updated_by: user.username, updated_at: new Date().toISOString() }], true);
        }
        return json({ key });
      }

      // ---------- campaign stats: Agent List (CB number) → Cuddle/Courtesy attribution ----------
      // Nick, 2026-08-17: "create me a tool on the backend where when you upload the agent
      // list it identifies who is in cuddle and courtesy, and then it shows the correct
      // stats". The Worker JOINS, it never invents: classification is the roster campaign
      // (Agent List Que column) keyed on CB number; dialler logins resolve exactly like the
      // app (manual map override → CB code, zero-padding stripped → roster name). Reads the
      // SAME vas-state blob the app persists, so this can never disagree with the screen.
      // Per campaign it also names the roster CBs the dialler has NEVER seen — when Cuddle
      // reads zero, this is the list that proves the export was pulled without that floor.
      if (path === '/api/campaign-stats' && req.method === 'GET') {
        const r = await DB.select(`rules?key=eq.${encodeURIComponent('kv:vas-state')}&select=value,updated_at`);
        if (!r || !r.length) return json({ error: 'no vas-state uploaded yet' }, 404);
        const v = r[0].value || {};
        let S;
        if (v.store) {
          const sr = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${v.store}`, { headers: { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY } });
          if (!sr.ok) return json({ error: 'state blob unreadable: ' + sr.status }, 500);
          S = JSON.parse(await sr.text());
        } else S = JSON.parse(String(v.data || '{}'));
        const normName = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
        const cbOf = s => { const m = String(s || '').toUpperCase().match(/CB\s*-?\s*0*(\d+)/); return m ? 'CB' + parseInt(m[1], 10) : null; };
        const byCode = {}, byName = {};
        for (const a of (S.roster || [])) { byCode[a.code] = a; for (const n of [a.name, a.callx, a.sf]) { const k = normName(n); if (k) byName[k] = a; } }
        const resolve = k => {
          if (S.map && S.map[k] !== undefined) return S.map[k] === '__ignore__' ? null : (byCode[S.map[k]] || null);
          if (byCode[k]) return byCode[k];
          const z = cbOf(k); if (z && byCode[z]) return byCode[z];
          return byName[normName(k)] || null;
        };
        const days = {}, seenByCamp = {};
        for (const d of Object.keys(S.calls || {}).sort()) {
          const day = days[d] = {};
          for (const k in S.calls[d]) {
            const b = S.calls[d][k];
            const a = resolve(k);
            const camp = a ? (a.campaign || '?') : 'unmatched';
            const c = day[camp] = day[camp] || { agents: 0, talk_secs: 0, calls: 0, dialler_sales: 0 };
            c.agents++; c.talk_secs += b.talk || 0; c.calls += b.calls || 0; c.dialler_sales += b.saleD || 0;
            if (a) (seenByCamp[camp] = seenByCamp[camp] || new Set()).add(a.code);
          }
        }
        const nDays = Object.keys(days).length;
        const campaigns = {};
        for (const a of (S.roster || [])) {
          const c = campaigns[a.campaign] = campaigns[a.campaign] || { agents_on_roster: 0, agents_seen_in_dialler: 0, covered_days: 0, talk_secs: 0, dialler_sales: 0, missing_cbs: [] };
          c.agents_on_roster++;
          if (seenByCamp[a.campaign] && seenByCamp[a.campaign].has(a.code)) c.agents_seen_in_dialler++;
          else c.missing_cbs.push(a.code + ' ' + (a.name || ''));
        }
        for (const d in days) for (const camp in days[d]) {
          if (!campaigns[camp]) continue;
          campaigns[camp].covered_days++;
          campaigns[camp].talk_secs += days[d][camp].talk_secs;
          campaigns[camp].dialler_sales += days[d][camp].dialler_sales;
        }
        for (const camp of ['Cuddle', 'Courtesy']) if (campaigns[camp])
          campaigns[camp].verdict = campaigns[camp].covered_days * 2 >= nDays
            ? 'OK — day-level dialler coverage on at least half the days'
            : 'FAIL (VR16) — ' + campaigns[camp].covered_days + '/' + nDays + ' dialler days. ' + (camp === 'Cuddle'
              ? 'Pull EXPORT_CALL_REPORT with user groups Renolan_Matrix_WC + Sharoma_Matrix_WC ticked (or all groups); a single-day "Vici - Cuddle Agents" export per past day also counts.'
              : 'Upload the day\'s CallX call_records export.');
        return json({ state_updated_at: r[0].updated_at || '', dialler_days: nDays, campaigns, days });
      }

      // ---------- roster: the Agent List as PULSE holds it — the sync spine for AgentOS ----------
      // The two dashboards keep separate stores, and the Agent List arrives through the VAS
      // Upload Station — which left AgentOS on a 13 Aug list while PULSE held 26 Aug (Nikita's
      // dissolved team, four Nesting→Courtesy movers, 52 joiners never appearing). This serves
      // PULSE's live roster in a payload small enough for AgentOS to check on every boot. The
      // fingerprint is order-independent and moves ONLY when a roster field changes — never on
      // the constant vas-state saves — so the client can compare cheaply and skip re-ingesting.
      /* THE CAMPAIGNS THE LIST CURRENTLY NAMES (migration-019). Read from the table the
         sync maintains, never from a hardcoded set — any app that needs "which campaigns
         exist" asks here. */
      /* CAMPAIGN MOVES BY EFFECTIVE DATE (sprint 2026-09-29, item 2; D4) — the movers of a month and the
         day each move took effect, from the dated Agent List snapshots (moves.mjs). PULSE reads it to
         split a mover's month; an admin can set the true day. Management apps only (not in PORTAL_ALLOWED). */
      if (path === '/api/campaign-moves' && req.method === 'GET') {
        const m = url.searchParams.get('month') || new Date(Date.now() + 2 * 3600000).toISOString().slice(0, 7);
        if (!/^\d{4}-\d{2}$/.test(m)) return json({ error: 'month must be YYYY-MM' }, 400);
        try { return json(await campaignMoves(DB, m)); }
        catch (e) { return json({ error: 'campaign moves unavailable: ' + String(e.message || e).slice(0, 160) }, 502); }
      }
      if (path === '/api/campaign-moves' && req.method === 'POST') {
        const r = await setCampaignMove(DB, user, await req.json().catch(() => ({})));
        return json(r.body, r.status);
      }
      if (path === '/api/campaigns' && req.method === 'GET') {
        const rows = await DB.select('active_campaigns?select=key,label,agents,first_seen,last_seen').catch(() => null);
        if (!rows) return json({ error: 'campaigns unavailable' }, 502);
        return json({ campaigns: rows, n: rows.length });
      }
      if (path === '/api/roster' && req.method === 'GET') {
        /* THE ROSTER OF RECORD WINS IF THERE IS ONE. Until 2026-08-28 this route derived
           the roster from kv:vas-state, which meant only the VAS app could ever publish
           one: an Agent List uploaded in Ops had no way to tell anybody, and the two
           dashboards drifted apart until someone happened to re-upload in VAS. Either app
           now POSTs the list it ingests to kv:roster-current, and this serves that. The
           old derivation stays as the fallback so nothing breaks before the first POST. */
        /* ...but a SEEDED record is skipped here for the same reason rosterSync skips it:
           it is a copy of the derivation, not a published list, so serving it would answer
           this route from a snapshot that can no longer move. Falling through re-derives
           and refreshes the seed in one go. */
        /* THE TARGET SERVED IS THE RULE'S, NOT THE CELL'S (Nick, 2026-09-01: a target
           Dalwin sets "must change on the dashboard as well"). Every row's Target is
           resolved through the same chain PULSE's engine uses — cm:targets override,
           then the salesTargetMatrix, then the list's own cell — so Ops scores against
           the campaign manager's number the moment it next syncs. The stored list is
           untouched; this is applied at serve time and clearing the override restores
           the list's value on the next sync. */
        const tctx = globalThis.__cmCtx || await loadCmContext(DB).catch(() => null);
        const applyTargets = (rows) => (rows || []).map((r2) =>
          ({ ...r2, target: effPerDay(tctx, r2.campaign, r2.tenure, r2.target) }));
        const tstamp = (tctx && tctx.targets && tctx.targets.stamp) || '';
        const cur = await DB.select(`rules?key=eq.${encodeURIComponent('kv:roster-current')}&select=value,updated_at`).catch(() => null);
        const rec = cur && cur[0] && cur[0].value;
        /* THE LEADERS' CB NUMBERS TRAVEL WITH THE ROSTER (2026-09-15). The Agent List names a
           leader and never carries their code; team_leader_cbs (migration-018) does. ViciDial
           logs a leader who dials under that code, so a page that only knows leaders by NAME
           filed six of them under "dialler logins the Agent List does not know" — the one bucket
           that tells a person to act. Served here so both apps can class a leader's login as a
           leader, never as a missing agent. */
        const { leaders, leavers, aliases, degraded } = await rosterExtras(DB);
        if (rec && Array.isArray(rec.roster) && rec.roster.length && rec.source !== 'seed') {
          return json({ fingerprint: rec.fingerprint, n: rec.roster.length, as_of: rec.as_of || '',
            file: rec.file || '', source: rec.source || '', uploaded_by: rec.uploaded_by || '',
            uploaded_at: rec.uploaded_at || '', state_updated_at: (cur[0].updated_at || ''),
            targets_stamp: tstamp, roster: applyTargets(rec.roster), leaders, leavers, aliases, extras_degraded: degraded, renamed: rec.renamed || [], review: rec.review || null });
        }
        const payload = await rosterSync(env, DB, { fresh: !!url.searchParams.get('fresh'), who: user && user.username });
        if (payload && payload.error) return json({ error: payload.error }, payload.status || 500);
        if (payload && Array.isArray(payload.roster)) { payload.roster = applyTargets(payload.roster); payload.targets_stamp = tstamp; payload.leaders = leaders; payload.leavers = leavers; payload.aliases = aliases; payload.extras_degraded = degraded; }
        return json(payload);
      }

      /* THE CAMPAIGN TARGET OVERRIDES, for the apps' engines (PULSE overlays them on
         its salesTargetMatrix at its one target choke point). Override map only —
         each engine keeps its own rule-book base, so this can never smuggle in a
         different default. Any signed-in session may read it: targets are printed
         on every agent's own card, they are not a secret. */
      if (path === '/api/cm-targets' && req.method === 'GET') {
        const c2 = globalThis.__cmCtx || await loadCmContext(DB).catch(() => null);
        const t2 = (c2 && c2.targets) || {};
        return json({ matrix: t2.matrix || {}, gwpMonth: t2.gwpMonth || {}, stamp: t2.stamp || '' });
      }

      /* PUBLISH AN AGENT LIST FROM EITHER APP (Nick, 2026-08-28: "the list changes
         constantly and is not updating, sometimes leaving old team leaders and agents").

         The Agent List is the source of truth for every cross-source join, and it had
         exactly one publisher. Whichever station a list is dropped into now posts it
         here, and this decides — once, on the server — which list the whole suite is on.

         THE RULES, in order, and all of them refusals rather than overwrites:
           · a list with no rows is never stored (it would flatten the floor)
           · a LATER as_of always wins
           · the SAME as_of wins only if it is genuinely different and newer by upload
             time — so re-opening a tab cannot re-publish an old list over a new one
           · an EARLIER as_of is refused and says so, rather than silently losing
         The caller is told which happened, so the station can say it out loud instead of
         leaving two dashboards quietly disagreeing. */
      if (path === '/api/roster' && req.method === 'POST') {
        /* PUBLISHING THE LIST IS A MANAGEMENT ACTION (security review, 2026-09-22). The Upload
           Station is hidden from campaign managers in the UI, but a manager holding the vas app
           passed the portal gate and could post a list straight at the API — creating and
           removing logins, and re-pointing a leader's team. The role decides here, not the page. */
        if (user && PORTAL_ROLES.has(user.role))
          return json({ error: 'Publishing the Agent List is a management action — it belongs to the Upload Station accounts.' }, 403);
        let body = null;
        try { body = await req.json(); } catch { return json({ error: 'json body required' }, 400); }
        /* THE FILE IS THE RECORD (Nick, 2026-09-03: "so this never happens again"). The
           station used to post the roster IT had derived — and PULSE's off-campaign guard
           had been dropping the "Download & Test" rows before they ever got here, for weeks,
           with nothing downstream able to know. Now the station posts EVERY row of EVERY
           sheet, unclassified (`rows`), and Postgres derives the roster, creates the logins,
           the leader views and the campaigns and removes the ones that are gone — in ONE
           transaction (publish_agent_list, migration-020). What comes back is the roster the
           whole suite adopts; what the browser thought no longer matters. The legacy
           `roster` shape (older tabs, tools) is accepted as already-classified rows. */
        const raw = Array.isArray(body && body.rows) ? body.rows
          : Array.isArray(body && body.roster) ? body.roster.map((a) => Object.assign({ sheet: '' }, a)) : null;
        if (!raw) return json({ error: 'rows[] required' }, 400);
        if (!raw.length) return json({ accepted: false, reason: 'empty file — never stored' }, 200);
        const asOf = /^\d{4}-\d{2}-\d{2}$/.test(String(body.as_of || '')) ? String(body.as_of) : '';
        const actor = (user && user.username) || 'roster-post';
        const now = new Date().toISOString();
        const prevR = await DB.select(`rules?key=eq.${encodeURIComponent('kv:roster-current')}&select=value`).catch(() => null);
        const prev = prevR && prevR[0] && prevR[0].value;
        /* an EARLIER as_of is refused BEFORE anything is derived or written — an older list
           must never reconcile anyone's login, even for a moment */
        if (prev && prev.as_of && asOf && asOf < prev.as_of)
          return json({ accepted: false, reason: 'an older list never replaces a newer one',
            fingerprint: prev.fingerprint, as_of: prev.as_of, yours: asOf });
        /* PLAN: derive the roster, nothing written */
        /* A REFUSAL IS RECORDED, NOT JUST ANSWERED (2026-09-15). Five daily lists were refused in
           a row and nobody knew: the reply went to one tab as a toast. kv:roster-refused holds the
           last refusal — file, uploader, stage, the named errors — until a publish is accepted;
           the health cron turns it into the agent-list-not-published alert in both apps. */
        const namedErrors = (p) => { const out = []; const walk = (v) => { if (!v) return; if (typeof v === 'string') out.push(v);
            else if (Array.isArray(v)) v.forEach(walk); else if (typeof v === 'object') { if (v.cb && v.names) out.push(v.cb + ' appears ' + (v.n || v.names.length) + ' times as ' + v.names.map((s) => '"' + s + '"').join(' and ')); else if (v.errors) walk(v.errors); } };
          walk(p && p.agents && p.agents.errors); walk(p && p.errors); return out.slice(0, 6); };
        const recordRefusal = async (p, reason) => {
          const rec = { at: now, file: String(body.file || '').slice(0, 120), actor, stage: (p && p.stage) || 'agents', reason,
            detail: (p && p.detail) || '', errors: namedErrors(p) };
          await DB.insert('rules', [{ key: 'kv:roster-refused', value: { data: JSON.stringify(rec) }, updated_by: actor, updated_at: now }], true).catch(() => {});
          return rec;
        };
        const plan = await publishAgentList(DB, raw, { asOf, actor, planOnly: true });
        if (!plan || (plan.status !== 'PLAN' && plan.status !== 'NEEDS_HASHES')) {
          const reason = (plan && (plan.reason || plan.status)) || 'the publish returned nothing';
          const refusal = await recordRefusal(plan, reason);
          return json({ accepted: false, reason, stage: plan && plan.stage, detail: plan && plan.detail, errors: refusal.errors, publish: plan }, 200);
        }
        const clean = Array.isArray(plan.roster) ? plan.roster : [];
        if (!clean.length) return json({ accepted: false, reason: 'no agent rows in the file — never stored', publish: plan }, 200);
        const fnv = (strs) => { let h = 0x811c9dc5; for (const s of strs.slice().sort()) for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16); };
        const fp = 'list:' + fnv(clean.map((a) => [a.code, a.name, a.tl, a.campaign, a.tenure, a.callx, a.sf, a.target, a.start].join('|')));   // same FNV-1a the GET fingerprint uses
        /* THE LEADERS' SHEET IS PART OF THE LIST (migration-040) BUT NOT OF THE AGENT FINGERPRINT
           (2026-09-15). Folding leader rows into fp made every post that carried NO sheet — Ops,
           a tab posting its classified roster — a "different" list from the same file with the
           sheet, and the record flip-flopped between two fingerprints on every post, re-running
           the syncs each time. The agents' fingerprint is the list's identity; the leaders travel
           as their own signature, and a post is identical only when the agents match AND it either
           brought no sheet or brought the same sheet as the record holds. */
        const leaderRows = raw.filter((r) => r && r.role === 'leader').map((r) => ['L', normCb(r.code), r.name, r.campaign, r.manager, r.callx].join('|'));
        const leadersSig = leaderRows.length ? 'tl:' + fnv(leaderRows) : '';
        if (prev && prev.fingerprint === fp && (!leadersSig || leadersSig === (prev.leaders_sig || '')))
          return json({ accepted: false, reason: 'identical list already published', fingerprint: fp, as_of: prev.as_of || '',
            on_file: plan.on_file, dropped: plan.dropped || [] });
        /* APPLY: logins, leader views, campaigns — all or nothing */
        const out = await publishAgentList(DB, raw, { asOf, actor, fingerprint: fp });
        if (!out || out.status !== 'SUCCESS') {
          const reason = (out && (out.reason || out.status)) || 'the publish returned nothing';
          const refusal = await recordRefusal(out, reason);
          return json({ accepted: false, reason, stage: out && out.stage, detail: out && out.detail, errors: refusal.errors,
            on_file: out && out.on_file, dropped: (out && out.dropped) || [], publish: out }, 200);
        }
        await DB.del('rules?key=eq.' + encodeURIComponent('kv:roster-refused')).catch(() => {});   // accepted: the refusal is over
        /* A BIG REMOVAL IS PUBLISHED AND THEN QUESTIONED (2026-09-15). The list is the record and
           it always wins — but a list that drops many people, or a whole campaign, deserves a second
           look by a person: the only guard before this was the 25 % cap on login removals, which a
           17-agent drop on a 146-agent list sails under. The review is a NOTE on the record — who
           left, which campaigns went — that the health cron shows as a banner for three days and
           the next publish replaces. Nothing is refused by it. */
        let review = null;
        /* A RENAMED CODE IS NAMED (2026-09-21). The 18 Sep list re-spelt twelve agents and nobody knew
           until their sales read 0 four days later. Same code, different name → listed on the record
           and in the reply so both stations can say so at upload time. Never a refusal: the list is
           the record; the archive keeps the old spelling (agent_list_aliases) so nothing is lost. */
        const renamed = [];
        if (prev && Array.isArray(prev.roster) && prev.roster.length) {
          const norm = (v) => String(v == null ? '' : v).toLowerCase().replace(/[^a-z]/g, '');
          const was = new Map(prev.roster.filter((a) => a && a.code).map((a) => [normCb(a.code), a]));
          for (const a of clean) { const p = was.get(normCb(a.code)); if (!p) continue;
            if (norm(p.name) !== norm(a.name) || norm(p.sf || p.name) !== norm(a.sf || a.name)) renamed.push({ code: normCb(a.code), from: p.name || '', to: a.name || '' }); }
        }
        if (prev && Array.isArray(prev.roster) && prev.roster.length) {
          const nowCodes = new Set(clean.map((a) => normCb(a.code)));
          const removed = prev.roster.filter((a) => a && !nowCodes.has(normCb(a.code))).map((a) => ({ code: a.code, name: a.name || '', tl: a.tl || '', campaign: a.campaign || '' }));
          const nowCamps = new Set(clean.map((a) => a.campaign).filter(Boolean));
          const campaignsGone = [...new Set(prev.roster.map((a) => a && a.campaign).filter(Boolean))].filter((c) => !nowCamps.has(c));
          if (removed.length >= REVIEW_REMOVALS || campaignsGone.length)
            review = { at: now, as_of: asOf, file: String(body.file || '').slice(0, 120), by: actor, removed: removed.slice(0, 60), removed_n: removed.length, campaigns_gone: campaignsGone };
        }
        const rec = { v: 1, fingerprint: fp, leaders_sig: leadersSig || (prev && prev.fingerprint === fp ? (prev.leaders_sig || '') : ''), as_of: asOf, n: clean.length, roster: clean,
          on_file: out.on_file, dropped: (out.dropped || []).length,
          file: String(body.file || '').slice(0, 120), source: String(body.source || '').slice(0, 16),
          uploaded_by: actor, uploaded_at: now, review, renamed: renamed.slice(0, 60),
          replaced: prev ? { fingerprint: prev.fingerprint, as_of: prev.as_of || '', at: prev.uploaded_at || '' } : null };
        await DB.insert('rules', [{ key: 'kv:roster-current', value: rec, updated_by: actor, updated_at: now }], true);
        globalThis.__rosterCache = null;                      // the GET must not serve the previous list
        globalThis.__cmCtx = null;                            // campaigns may have come or gone; the CM context must see it now
        /* MIRROR BEFORE ANSWERING (see the GET): the Ops boot copy and the portal's
           authorisation map are current when this returns. Reported, never fatal. */
        let mirrored = true;
        try { await rosterSync(env, DB, { fresh: true, who: 'roster-post' }); }
        catch (e) { mirrored = false; }
        /* THE ANSWER IS THE RECORD (one classifier, 2026-09-15): the station that posted the raw rows
           adopts the roster, the leaders and the leavers exactly as served to everyone else. */
        const extras = await rosterExtras(DB).catch((e) => { console.error('rosterExtras failed: ' + (e && e.message || e)); return { leaders: [], leavers: [], aliases: [], degraded: ['leaders', 'leavers', 'aliases'] }; });
        return json({ accepted: true, fingerprint: fp, as_of: asOf, n: clean.length, on_file: out.on_file, roster: clean,
          dropped: out.dropped || [], blank_campaign: out.blank_campaign || [], campaigns_on_list: out.campaigns_on_list || [],
          mirrored, replaced: rec.replaced, sync: out.agents, leaders: out.leaders, campaigns: out.campaigns,
          review, renamed, record_leaders: extras.leaders, leavers: extras.leavers, aliases: extras.aliases || [], extras_degraded: extras.degraded || [] });
      }

      // ---------- upload relay: one Upload Station feeds BOTH dashboards ----------
      // The VAS Upload Station archives every raw file it successfully ingests (POST
      // below); AgentOS Analytics pulls unseen files from the manifest and runs them
      // through ITS OWN detect/parse/load pipeline. The raw bytes travel, never derived
      // rows — PULSE aggregates at ingest (per-day call buckets, QA subsets), so a
      // state-derived sync would silently strip columns the other app needs (QA coaching
      // categories, per-call rows, BI charge detail). Each app keeps its own parser;
      // nothing is implemented twice; an upload happens once.
      if (path === '/api/upload-archive' && req.method === 'POST') {
        const name = String(url.searchParams.get('name') || '').replace(/[^\w .()\-\[\]]/g, '_').slice(0, 120);
        const hash = String(url.searchParams.get('hash') || '');
        if (!name || !/^[0-9a-f]{8,64}$/i.test(hash)) return json({ error: 'name and hash required' }, 400);
        const buf = await req.arrayBuffer();
        if (!buf.byteLength) return json({ error: 'empty body' }, 400);
        if (buf.byteLength > 30 * 1048576) return json({ error: 'file exceeds the 30 MB relay cap — upload it in the other dashboard by hand' }, 413);
        /* THE MANIFEST IS APPENDED ATOMICALLY (2026-09-08, migration-024). The old read-modify-write
           here lost the ViciDial call report when five files landed in the same five seconds, and
           its own comment had called that a "KNOWN LIMIT" since August. upload_manifest_add() runs
           as one statement under the row lock; the cron's reconcileManifest() re-adds any blob the
           manifest is ever found not to know. The stations read the manifest before posting, so a
           re-upload of archived bytes never sends its body; a race that slips past that check
           is answered with 'dupe' here. */
        const store = 'raw/uploads/' + hash.slice(0, 16) + '-' + name;
        const put = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${store}`, {
          method: 'POST', headers: { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY, 'Content-Type': 'application/octet-stream', 'x-upsert': 'true' }, body: buf })
        if (!put.ok) return json({ error: 'archive write failed: ' + put.status }, 500);
        const added = await manifestAdd(DB, { name, hash, size: buf.byteLength, actor: user.username });
        if (added === 'dupe') return json({ ok: true, dupe: true });
        return json({ ok: true, archived: store });
      }
      /* THE LARGE-FILE PATH (Data Rake, Phase 1 — Nick, 2026-09-08). A 500 MB export cannot pass
         through this Worker (100 MB body cap) or through a browser's parser at all. So the station
         asks for a SIGNED UPLOAD URL scoped to one object path, PUTs the bytes straight to Storage,
         and tells us when it is done; we record the file and put one message on the ingest queue.
         The runner (tools/rake.mjs) does everything after that. The service key never leaves here:
         the signed URL is the only thing the browser holds, it names one path, and it expires. */
      if (path === '/api/upload/large/start' && req.method === 'POST') {
        if (portalOnly(user)) return json({ error: 'Not permitted.' }, 403);
        const b = await req.json().catch(() => ({}));
        const name = String(b.name || '').replace(/[^\w .()\-\[\]]/g, '_').slice(0, 120);
        const size = Number(b.size || 0);
        if (!name) return json({ error: 'name required' }, 400);
        if (!(size > 0) || size > 5 * 1024 * 1024 * 1024) return json({ error: 'size must be between 1 byte and 5 GB' }, 400);
        const d = new Date(); const day = d.toISOString().slice(0, 10).split('-');
        const rows = await DB.insert('upload_files', [{ file_name: name, bytes: size, storage_bucket: 'raw-uploads', storage_path: 'pending', uploaded_by: user.username }], false, true).catch(() => null);
        const id = rows && rows[0] && rows[0].id; if (!id) return json({ error: 'could not record the file' }, 500);
        const objectPath = `${day[0]}/${day[1]}/${day[2]}/${id}-${name}`;
        await DB.update(`upload_files?id=eq.${id}`, { storage_path: objectPath });
        const sign = await fetch(`${env.SUPABASE_URL}/storage/v1/object/upload/sign/raw-uploads/${objectPath.split('/').map(encodeURIComponent).join('/')}`, {
          method: 'POST', headers: { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY, 'Content-Type': 'application/json' }, body: '{}' });
        if (!sign.ok) return json({ error: 'could not sign an upload: ' + sign.status + ' ' + (await sign.text()).slice(0, 120) }, 502);
        const sj = await sign.json();
        return json({ id, upload_url: `${env.SUPABASE_URL}/storage/v1${sj.url}`, token: sj.token, path: objectPath, expires_in: 7200 });
      }
      if (path === '/api/upload/large/complete' && req.method === 'POST') {
        if (portalOnly(user)) return json({ error: 'Not permitted.' }, 403);
        const b = await req.json().catch(() => ({}));
        const id = String(b.id || ''); if (!/^[0-9a-f-]{36}$/.test(id)) return json({ error: 'id required' }, 400);
        const rows = await DB.select(`upload_files?id=eq.${id}&select=id,storage_path,status,uploaded_by`);
        const f = rows && rows[0]; if (!f) return json({ error: 'unknown upload' }, 404);
        if (f.uploaded_by !== user.username && user.role !== 'admin') return json({ error: 'Not your upload.' }, 403);
        /* the object must exist before it is queued — a cancelled PUT leaves a row that says so */
        const info = await fetch(`${env.SUPABASE_URL}/storage/v1/object/info/raw-uploads/${f.storage_path.split('/').map(encodeURIComponent).join('/')}`, { headers: { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY } });
        if (!info.ok) { await DB.update(`upload_files?id=eq.${id}`, { status: 'failed', error: 'upload never completed (object not found in storage)' }); return json({ error: 'The file did not finish uploading. Try again.' }, 409); }
        const meta = await info.json().catch(() => ({}));
        await DB.update(`upload_files?id=eq.${id}`, { bytes: Number(meta.size || (meta.metadata && meta.metadata.size) || b.size || 0) || null, status: 'received' });
        const msg = await DB.rpc('rake_enqueue', { p_file_id: id }).catch((e) => ({ error: String(e && e.message || e) }));
        return json({ ok: true, id, queued: msg && !msg.error, message: 'Received. The runner picks it up within fifteen minutes; progress shows below and in Settings → Scheduled jobs.' });
      }
      /* THE IN-PAGE RAKE (migration-042, 2026-09-15 — Nick: "i am not going to pay for github so make
         sure it works"). The uploading browser parses the large file and loads it through five SQL
         functions; this route is a pass-through — the request body IS the function's parameters, and
         it is streamed to PostgREST untouched, so a 10 MB slice of rows costs this Worker no CPU. */
      if (path === '/api/rake/page' && req.method === 'POST') {
        if (portalOnly(user)) return json({ error: 'Not permitted.' }, 403);
        const fn = String(url.searchParams.get('fn') || '');
        if (!/^(begin|stage|merge|finish|abandon)$/.test(fn)) return json({ error: 'unknown step' }, 400);
        const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/rake_page_${fn}`, {
          method: 'POST', body: req.body,
          headers: { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY, 'Content-Type': 'application/json' },
        });
        const t = await r.text();
        if (!r.ok) return json({ error: 'load step ' + fn + ' failed: ' + r.status + ' ' + t.slice(0, 200) }, 502);
        return new Response(t, { status: 200, headers: { 'Content-Type': 'application/json' } });   // CORS is applied to every response on the way out
      }
      /* LOAD A STORED FILE FROM ANY TAB (2026-09-15). A tab that closes mid-load, or an upload made
         while the page could not load, leaves the bytes in storage and the record waiting. Any
         management tab can now pull the object through a short-lived signed URL and run the same
         in-page loader — nothing waits for a runner. */
      if (path === '/api/upload/large/retry' && req.method === 'POST') {
        if (portalOnly(user)) return json({ error: 'Not permitted.' }, 403);
        const b = await req.json().catch(() => ({}));
        const id = String(b.id || ''); if (!/^[0-9a-f-]{36}$/.test(id)) return json({ error: 'id required' }, 400);
        const rows = await DB.select(`upload_files?id=eq.${id}&select=id,file_name,storage_bucket,storage_path,status,bytes,validated_at,received_at`);
        const f = rows && rows[0]; if (!f) return json({ error: 'unknown upload' }, 404);
        if (f.status === 'loaded') return json({ error: 'already loaded' }, 409);
        const busySince = Date.parse(f.validated_at || f.received_at || 0);
        if (f.status === 'loading' && Date.now() - busySince < 30 * 60000) return json({ error: 'a tab is still loading this file — wait a few minutes' }, 409);
        /* a stale 'loading' claim is released so begin can claim it again */
        if (f.status === 'loading') await DB.rpc('rake_page_abandon', { p_file: id, p_error: 'reloaded from another tab' }).catch(() => {});
        const sign = await fetch(`${env.SUPABASE_URL}/storage/v1/object/sign/${f.storage_bucket}/${f.storage_path.split('/').map(encodeURIComponent).join('/')}`, {
          method: 'POST', headers: { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: 3600 }) });
        if (!sign.ok) return json({ error: 'could not sign a download: ' + sign.status }, 502);
        const sj = await sign.json();
        return json({ id, name: f.file_name, bytes: f.bytes, download_url: `${env.SUPABASE_URL}/storage/v1${sj.signedURL || sj.signedUrl || ''}` });
      }
      if (path === '/api/upload/large/status' && req.method === 'GET') {
        if (portalOnly(user)) return json({ error: 'Not permitted.' }, 403);
        const rows = await DB.select(`upload_files?select=id,file_name,source,status,bytes,rows_in,rows_loaded,rows_rejected,error,received_at,validated_at,loaded_at,uploaded_by&order=received_at.desc&limit=25`).catch(() => []);
        const health = await DB.rpc('rake_health', {}).catch(() => null);
        return json({ files: rows || [], health });
      }
      /* ---------- THE LEAD MANAGEMENT BOOK, FROM THE LAKE (2026-09-10; migration-035) ----------
         The Salesforce Open Cases export is ~94 MB / 487,000 rows since 8 Sep, so it takes the
         large-file path and never reaches the in-page parser that used to fill PULSE's
         S.opencasesLM — the Lead Management tab sat on the 6 Sep pull while the lake moved every
         morning. tools/rake.mjs rebuilds lm_open_book_cache after each load; this serves it.
         ?meta=1 is the cheap freshness poll (no rows); the full call is ~8 MB of agent-owned
         rows {k,o,s,d} which the page resolves through its own Agent List, as it did the file.
         Management only: the book is every agent's case list. */
      if (path === '/api/lead-book' && req.method === 'GET') {
        if (portalOnly(user)) return json({ error: 'Not permitted.' }, 403);
        const fn = url.searchParams.get('meta') ? 'lm_open_book_meta' : 'lm_open_book';
        const out = await DB.rpc(fn, {}).catch((e) => ({ error: String((e && e.message) || e).slice(0, 200) }));
        if (!out || out.error) return json({ error: (out && out.error) || 'lead book unavailable' }, 502);
        return json(out, 200, { 'Cache-Control': 'no-store' });
      }
      if (path === '/api/upload-manifest' && req.method === 'GET') {
        const mr = await DB.select(`rules?key=eq.${encodeURIComponent('kv:upload-manifest')}&select=value,updated_at`);
        return json({ files: (mr && mr[0] && mr[0].value && mr[0].value.files) || [], updated_at: (mr && mr[0] && mr[0].updated_at) || '' });
      }
      if (path === '/api/upload-file' && req.method === 'GET') {
        const hash = String(url.searchParams.get('hash') || '');
        const mr = await DB.select(`rules?key=eq.${encodeURIComponent('kv:upload-manifest')}&select=value`);
        const f = ((mr && mr[0] && mr[0].value && mr[0].value.files) || []).find(x => x.h === hash);
        if (!f) return json({ error: 'not in the manifest' }, 404);
        const store = 'raw/uploads/' + f.h.slice(0, 16) + '-' + f.n;
        const sr = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${store}`, { headers: { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY } });
        if (!sr.ok) return json({ error: 'file unreadable: ' + sr.status }, 404);
        return new Response(sr.body, { status: 200, headers: { 'Content-Type': 'application/octet-stream', 'X-Cbx-Name': encodeURIComponent(f.n) } });
      }

      // ---------- referrals: live pull from HighLevel (LeadConnector v2) ----------
      // The HL key is a Worker secret (HL_API_KEY + HL_LOCATION_ID) — it must never reach
      // the browser. One contact = one referrer; the referred people sit in the base block
      // plus "Referral 2..5", so each row's count = filled blocks (totals exceed rows by
      // design). Both dashboards ingest these rows through their normal upload pipeline —
      // the Worker only fetches and shapes, it never computes report numbers.
      if (path === '/api/referrals' && req.method === 'GET') {
        if (!env.HL_API_KEY || !env.HL_LOCATION_ID) return json({ error: 'HighLevel is not configured — set Worker secrets HL_API_KEY and HL_LOCATION_ID.' }, 503);
        const now = Date.now();
        if (!url.searchParams.get('fresh') && globalThis.__hlCache && now - globalThis.__hlCache.t < 600000)
          return json(globalThis.__hlCache.d, 200, { 'X-Cbx-Cache': 'hit' });
        const H = { Authorization: 'Bearer ' + env.HL_API_KEY, Version: '2021-07-28', Accept: 'application/json' };
        const base = 'https://services.leadconnectorhq.com';
        const hl = async (q) => { const r = await fetch(base + q, { headers: H }); if (!r.ok) throw new Error('HighLevel ' + q.split('?')[0] + ' → ' + r.status); return r.json(); };
        const cf = await hl(`/locations/${env.HL_LOCATION_ID}/customFields`);
        const fieldName = {}; (cf.customFields || []).forEach(f => fieldName[f.id] = f.name);
        const fids = n => Object.keys(fieldName).filter(id => fieldName[id] === n);
        const AGENT = fids('Agent Name');
        const BLOCKS = [
          ['Full Name and Surname', 'Referral Contact Number'],
          ['Referral 2 Full Name', 'Referral 2 Contact Number'],
          ['Referral 3 Full Name', 'Referral 3 Contact Number'],
          ['Referral 4 Full Name', 'Referral 4 Contact Number'],
          ['Referral 5 Full Name', 'Referral 5 Contact Number'],
        ].map(pair => pair.flatMap(fids));
        const contacts = []; let said = null, sa = null, guard = 0;
        for (;;) {
          let q = `/contacts/?locationId=${env.HL_LOCATION_ID}&limit=100`;
          if (said) q += `&startAfterId=${said}&startAfter=${sa}`;
          const r = await hl(q);
          const batch = r.contacts || [];
          contacts.push(...batch);
          if (batch.length < 100 || ++guard > 300) break;
          said = (r.meta && r.meta.startAfterId) || batch[batch.length - 1].id;
          sa = (r.meta && r.meta.startAfter) || new Date(batch[batch.length - 1].dateAdded || 0).getTime();
        }
        const fval = (c, ids) => { for (const f of (c.customFields || [])) if (ids.includes(f.id) && String(f.value ?? '').trim() !== '') return String(f.value).trim(); return ''; };
        const rows = [];
        for (const c of contacts) {
          let n = BLOCKS.filter(ids => fval(c, ids) !== '').length;
          if (!n && (c.tags || []).some(t => /referral/i.test(t))) n = 1;   // tagged referral with empty blocks still counts once
          if (!n) continue;
          rows.push({ id: c.id, created: String(c.dateAdded || '').slice(0, 10), agent: fval(c, AGENT), referrer: c.contactName || '', count: n });
        }
        const d = { rows, contacts: contacts.length, pulled_at: new Date().toISOString() };
        globalThis.__hlCache = { t: now, d };
        return json(d, 200, { 'X-Cbx-Cache': 'miss' });
      }

      // ---------- shared app state (multi-user persistence for both dashboards) ----------
      // Stored in the rules table under 'kv:' keys (no DDL needed). Last write wins.
      // kv v2 — big-data safe. Payloads live in Supabase STORAGE (streamed
      // through, no JSON parsing — a multi-MB upload costs ~zero Worker CPU);
      // the rules row holds only a pointer + updated_at for newest-wins sync.
      /* BULK FRESHNESS (perf audit, 2026-08-27): every source's updated_at in ONE
         request, so the Ops boot can skip re-downloading the ~154 MB of fact blobs
         that have not changed since its local snapshot. Same data the per-key
         ?meta beacon serves, without 15 round-trips. Staff only — the deny-by-default
         portal lockdown already refuses agent/team_leader here. */
      if (path === '/api/kv-meta' && req.method === 'GET') {
        const prefix = String(url.searchParams.get('prefix') || '').replace(/[^\w:.-]/g, '').slice(0, 40);
        if (!prefix) return json({ error: 'prefix required' }, 400);
        if (/^cb-/.test(prefix)) stampAppOpen(DB, ctx, 'ops');           // the Ops boot
        else if (/^vas/.test(prefix)) stampAppOpen(DB, ctx, 'vas');
        const rows = await DB.select(`rules?key=like.${encodeURIComponent('kv:' + prefix + '%')}&select=key,updated_at`);
        const keys = {}; for (const r of rows || []) keys[String(r.key).slice(3)] = r.updated_at || '';
        return json({ keys });
      }
      /* WEEKDAY SIGN-INS PER AGENT (Nick, 2026-08-28) — the source for the composite
         score's 5-point sign-in bonus. Nothing new is tracked: every successful login
         already writes a `login_ok` row to auth_log, and agents sign in with their CB
         number, so agent sign-ins are already distinguishable from staff ones.

         THE WEEKDAY IS DECIDED IN JOHANNESBURG, NOT IN UTC. auth_log.at is stored UTC;
         an agent signing in at 01:00 on Monday in Durban is 23:00 Sunday in UTC, and
         reading the weekday off the raw timestamp would pay them nothing for it. The
         window is widened by a day at each end for the same reason, then trimmed after
         the shift so a sign-in on the boundary is not lost.

         Staff only, like every other analytics route — the portal lockdown refuses
         agent and team_leader tokens here, so one agent can never enumerate another's
         sign-in history. */
      if (path === '/api/agent-signins' && req.method === 'GET') {
        const clean = (s) => String(s || '').slice(0, 10).replace(/[^\d-]/g, '');
        const from = clean(url.searchParams.get('from')), to = clean(url.searchParams.get('to'));
        if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to))
          return json({ error: 'from and to required as YYYY-MM-DD' }, 400);
        const TZ = 2;                                        // Africa/Johannesburg, no DST
        const shift = (iso, days) => new Date(Date.parse(iso + 'T00:00:00Z') + days * 86400000)
          .toISOString().slice(0, 10);
        const rows = await DB.select(
          `auth_log?event=eq.login_ok&at=gte.${shift(from, -1)}T00:00:00Z&at=lte.${shift(to, 1)}T23:59:59Z` +
          `&select=username,at&order=at.asc&limit=20000`);
        const days = {}, seen = new Set();
        for (const r of rows || []) {
          const u = String(r.username || '').trim().toUpperCase();
          if (!/^CB\d{1,5}$/.test(u)) continue;              // agents only; staff logins are not scored
          const local = new Date(Date.parse(r.at) + TZ * 3600000);
          const d = local.toISOString().slice(0, 10);
          if (d < from || d > to) continue;                  // trim the widened edges
          const dow = local.getUTCDay();                     // already shifted, so this is the SAST weekday
          if (dow === 0 || dow === 6) continue;              // weekdays only
          const k = u + '|' + d; if (seen.has(k)) continue;  // one day pays once, however many sign-ins
          seen.add(k);
          (days[u] = days[u] || []).push(d);
        }
        /* WHO EVEN HAS A LOGIN. "Signed in on no days" and "has no account to sign in
           with" are different facts and the score must not confuse them: an agent we
           have never provisioned — Hezron today — has to read as UNMEASURED, not as
           five points lost for our own backlog. Only app_users can answer that, so it
           travels with the counts. */
        const users = await DB.select(`app_users?select=username&limit=2000`);
        const provisioned = [];
        for (const u of users || []) {
          const n = String(u.username || '').trim().toUpperCase();
          if (/^CB\d{1,5}$/.test(n)) provisioned.push(n);
        }
        return json({ from, to, tz: 'Africa/Johannesburg', weekdaysOnly: true, days, provisioned });
      }
      /* A REFUSED SAVE REPORTS ITSELF (2026-09-07). Nick's Ops tab said "2 items NOT saved"
         all morning and the server had no trace: a refused or failed request is not a write,
         so kv_write_log — the record of what ARRIVED — could not see it, and the toast with
         the status code lived twelve seconds. Both dashboards now post the key, the status
         and the build here from their failure branch; the health cron alerts on a cluster. */
      if (path === '/api/save-fail' && req.method === 'POST') {
        let b = null; try { b = await req.json(); } catch { return json({ error: 'json body required' }, 400); }
        const row = { username: (user && user.username) || '', app: String(b.app || '').slice(0, 8), key: String(b.key || '').slice(0, 80),
          status: String(b.status || '').slice(0, 300), detail: String(b.detail || '').slice(0, 300), build: String(b.build || '').slice(0, 16),
          ua: String(req.headers.get('user-agent') || '').slice(0, 200) };
        console.warn('[save-fail] ' + row.username + ' ' + row.app + ' ' + row.key + ' → ' + row.status);
        try { await DB.insert('save_failures', [row]); } catch (e) { /* the report must never fail the client's retry loop */ }
        return json({ ok: true });
      }
      if (path === '/api/kv' && req.method === 'GET') {
        const key = url.searchParams.get('key') || '';
        /* THE HEALTH BANNER HAS THREE READERS (Nick, 2026-09-15: "all these notifications must only be
           sent to aarav, nicholas and barry"). Every open PULSE and Ops tab polls this key; anyone else
           now receives an empty alert list — the cadence still travels, since the Upload Station's
           "expected by" strip is not a notification. The sentinel itself keeps writing for everyone. */
        if (key === 'health-alerts' && !HEALTH_RECIPIENTS.has(String((user && user.username) || '').toLowerCase())) {
          const hr = await DB.select(`rules?key=eq.${encodeURIComponent('kv:health-alerts')}&select=value,updated_at`).catch(() => null);
          let cad = [], at = '';
          try { const v = JSON.parse((hr && hr[0] && hr[0].value && hr[0].value.data) || '{}'); cad = v.cadence || []; at = v.checked_at || ''; } catch (e) {}
          return new Response(JSON.stringify({ alerts: [], checked_at: at, cadence: cad, recipients_only: true }),
            { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Cbx-Version': (hr && hr[0] && hr[0].updated_at) || '' } });
        }
        if (key === 'vas-state' && !url.searchParams.get('meta')) stampAppOpen(DB, ctx, 'vas');   // the PULSE boot
        else if (key === 'cb-config' && !url.searchParams.get('meta')) stampAppOpen(DB, ctx, 'ops');
        const r = await DB.select(`rules?key=eq.${encodeURIComponent('kv:' + key)}&select=value,updated_at`);
        if (!r || !r.length) return json({ found: false }, 404, { 'X-Cbx-Version': 'none' });
        // meta mode: freshness beacon only — lets open tabs poll for other users'
        // uploads cheaply (no payload streamed) and re-pull when it changes.
        if (url.searchParams.get('meta')) return json({ found: true, updated_at: r[0].updated_at || '' });
        const v = r[0].value || {};
        /* A WRITE IN FLIGHT IS NOT READABLE (2026-09-14). A compare-and-set writer (below) marks the
           pointer `writing` before it uploads the blob, and clears it — with the new version — only
           once the blob is in place. Serving the blob in between would hand a reader the OLD bytes
           under whatever stamp it sees, and a writer working from that copy would later win a
           compare-and-set it should have lost. So the reader is asked to come back in a moment.
           A mark older than the TTL is a writer that died mid-way and is ignored. */
        if (v.writing && Date.now() - Date.parse(v.writing) < KV_WRITING_TTL_MS)
          return json({ error: 'write_in_progress', retry_in_ms: 1500 }, 425, { 'Retry-After': '2' });
        const hs = { 'Content-Type': 'text/plain; charset=utf-8', 'X-Cbx-Version': r[0].updated_at || '' };
        if (v.store) { // payload in Storage — stream it straight through
          const sr = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${v.store}`, { headers: { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY } });
          if (!sr.ok) return json({ found: false }, 404);
          return new Response(sr.body, { status: 200, headers: hs });
        }
        return new Response(String(v.data ?? ''), { status: 200, headers: hs }); // legacy small row
      }
      if (path === '/api/kv' && req.method === 'POST') {
        const qk = url.searchParams.get('key');
        if (!qk) return json({ error: 'key required' }, 400);
        // raw mode: body is the payload itself, streamed into Storage. A Storage
        // refusal (e.g. bucket missing) fails loudly — that is a misconfiguration
        // to fix, not to paper over with an inline-row fallback.
        const objPath = 'raw/kv/' + qk;
        /* SERVER-SIDE WIPE GUARD (17 Aug incident, twice in one hour). A tab running an old
           build and holding an empty state pushed 20KB of nothing over 1.08MB of uploads —
           and re-pushed it minutes after the blob was restored, because client-side guards
           cannot reach a zombie tab that never reloads. The server is the one place every
           tab must pass through: a drastic shrink of the state blob (new body under a tenth
           of the stored copy, and small in absolute terms) is refused with 409 unless the
           client explicitly declares the clear (?force=1, sent by the Danger-zone action in
           current builds). Old tabs surface the 409 through their existing "Cloud save
           failed" toast — loud, and harmless. */
        /* GZIPPED UPLOADS (perf, 2026-08-28). Browsers compress downloads but never request
           BODIES, so every save pushed the whole state uncompressed — 8.8 MB of VAS state
           over a South African upload link after every change, and PULSE state is ~90%
           repetitive case rows, so it compresses about ten to one. The client may now send
           `Content-Encoding: gzip`; it is decompressed HERE, so what lands in Storage is
           exactly the same plain JSON as before and every other reader (the roster mirror,
           the other dashboards, the maintenance scripts) is untouched. A client that cannot
           compress simply omits the header and takes the old path. */
        let body;
        {
          /* Decided by the BYTES, not by the header. Some edges decompress a gzipped request
             body before it reaches the Worker and some pass it through, so trusting
             Content-Encoding would corrupt the store in whichever case guessed wrong — and a
             corrupted vas-state is the whole floor's data. The gzip magic number (1f 8b) is
             unambiguous, and plain JSON can never start with it. */
          const buf = await req.arrayBuffer();
          const u8 = new Uint8Array(buf);
          if (u8.length > 2 && u8[0] === 0x1f && u8[1] === 0x8b) {
            try {
              body = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
            } catch (e) {
              return json({ error: 'could not decompress the upload: ' + (e && e.message || e) }, 400);
            }
          } else body = new TextDecoder().decode(buf);
        }
        /* THE LIVE AGENT DIGEST MUST BE THE CURRENT MONTH (Nick, 2026-09-03). A PULSE tab
           reviewing a past month republished it as kv:agent-digest, and every agent's
           Today page read August on 3 September. The publisher now fences itself, but a
           tab on an older build cannot be fixed from here — so the server refuses the
           write too: a live-key payload whose period is not the current SAST month is
           409'd. History keys (agent-digest-YYYY-MM) are untouched; the republish tool
           writes Storage directly and is unaffected. */
        if (qk === 'agent-digest' || /^agent-reports-(variance|leads)$/.test(qk)) {   // the report keys are fenced to the live month too (2026-09-21)
          try {
            const from = String((JSON.parse(body).period || {}).from || '');
            const cur = new Date(Date.now() + 2 * 3600000).toISOString().slice(0, 7);
            if (from.slice(0, 7) !== cur)
              return json({ error: 'stale_month: the live agent digest must be the current month (' + cur + '), got ' + (from || 'no period') + '. Publish it under its own agent-digest-YYYY-MM key instead.' }, 409);
          } catch (e) { return json({ error: 'agent-digest body is not JSON with a period' }, 400); }
        }
        if (qk === 'vas-state' && body.length < 120000 && !url.searchParams.get('force')) {
          const head = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${objPath}`, {
            method: 'HEAD', headers: { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY },
          });
          const cur = parseInt(head.headers.get('content-length') || '0', 10);
          if (head.ok && cur > body.length * 10) {
            return json({ error: 'wipe_blocked: refusing to replace ' + cur + 'B of stored data with ' + body.length + 'B. If this clear is deliberate, use the app\'s Danger zone.' }, 409);
          }
        }
        /* COMPARE-AND-SET (2026-09-14 — the Ops fact-store lost update). Every Ops session — a
           browser tab, the headless relay in GitHub Actions — merges a file into the copy of a
           store it loaded at boot and writes the WHOLE store back. Two sessions, two boots, one
           key: the second save silently dropped whatever the first had loaded. Found in the audit:
           ViciDial lost 27–29 Aug and 3 Sep (19,121 rows the batch audit says were loaded) that way.
           A client that sends `X-Cbx-Base: <version it last read>` now gets the write only if that
           is still the current version, and 409 version_conflict otherwise — it then reloads and
           replays its own batches on top. `none` means "I read that there was no row".
           Atomicity: the pointer row is CLAIMED first — one PATCH whose filter is the base version
           and "not already being written" — so of two writers with the same base exactly one
           proceeds; the blob is uploaded second; the claim is turned into the new version third.
           Readers of a claimed pointer are told to retry (GET above), so the blob is never served
           under a stamp it does not belong to. A dead writer's claim expires after KV_WRITING_TTL_MS.
           Clients that send no base — PULSE, the tools — keep the plain upsert path below. */
        const base = req.headers.get('X-Cbx-Base');
        const pk = 'rules?key=eq.' + encodeURIComponent('kv:' + qk);
        let claimed = null;
        if (base != null) {
          const cur = await DB.select(pk + '&select=value,updated_at');
          const row = cur && cur[0];
          const curAt = row ? String(row.updated_at || '') : '';
          if ((base === 'none') !== !row || (row && base !== curAt))
            return json({ error: 'version_conflict', current: curAt || 'none' }, 409);
          const mark = new Date().toISOString();
          if (row) {
            const busy = row.value && row.value.writing && Date.now() - Date.parse(row.value.writing) < KV_WRITING_TTL_MS;
            if (busy) return json({ error: 'version_conflict', current: curAt, reason: 'write_in_progress' }, 409);
            /* the claim does not move the version, so the filter must ALSO say "nobody holds a
               live claim" — or two writers that read the same base would both match it (proved
               live on the probe key, 2026-09-14: 200/200). A claim past the TTL counts as free. */
            const cutoff = new Date(Date.now() - KV_WRITING_TTL_MS).toISOString();
            const won = await DB.updateReturning(pk + '&updated_at=eq.' + encodeURIComponent(curAt)
                + '&or=' + encodeURIComponent('(value->>writing.is.null,value->>writing.lt.' + cutoff + ')'),
              { value: { ...(row.value || {}), writing: mark } });
            if (!won || !won.length) return json({ error: 'version_conflict', current: 'changed' }, 409);
          } else {
            try { await DB.insert('rules', [{ key: 'kv:' + qk, value: { writing: mark }, updated_by: user.username, updated_at: mark }], false); }
            catch (e) { return json({ error: 'version_conflict', current: 'created' }, 409); }   // somebody created it first
          }
          claimed = mark;
        }
        const sr = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${objPath}`, {
          method: 'POST',
          headers: { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY, 'Content-Type': 'text/plain', 'x-upsert': 'true' },
          body: body,
        });
        if (!sr.ok) {
          if (claimed) { try { const cur = await DB.select(pk + '&select=value'); const v = { ...((cur && cur[0] && cur[0].value) || {}) }; delete v.writing; await DB.update(pk, { value: v }); } catch (e) {} }
          return json({ error: 'store failed: ' + sr.status + ' ' + (await sr.text()).slice(0, 150) }, 500);
        }
        const newAt = new Date().toISOString();
        await DB.insert('rules', [{ key: 'kv:' + qk, value: { store: objPath }, updated_by: user.username, updated_at: newAt }], true);
        /* the version the client should hold from now on — as the database renders it, which is
           what every later compare is made against */
        let newVer = newAt;
        if (claimed) { try { const vr = await DB.select(pk + '&select=updated_at'); newVer = (vr && vr[0] && vr[0].updated_at) || newAt; } catch (e) {} }
        /* THE PORTAL'S COPY IS DROPPED THE MOMENT A NEW DIGEST LANDS (2026-09-11). loadDigest() keeps a
           60 s copy per isolate so a floor of agents does not read Storage on every open; a team
           leader's Refresh a few seconds after a VAS upload used to get the old copy from it. Only
           this isolate's copy can be dropped — another isolate's ages out inside the minute. */
        if (/^agent-digest(-\d{4}-\d{2})?$/.test(qk) && globalThis.__digestCaches) delete globalThis.__digestCaches['kv:' + qk];
        if (/^agent-reports-(variance|leads)$/.test(qk) && globalThis.__reportCaches) delete globalThis.__reportCaches['kv:' + qk];
        /* THE AGENT→TEAM MAP FOLLOWS THE DIGEST (audit round 3, 2026-08-27). It is the
           authorisation FLOOR for team-leader scoping, and refreshing it only from
           /api/roster left it stale whenever nobody happened to open Ops — measured: it
           still named the previous leader for seven agents a day after they moved. The
           digest is pushed by PULSE on every roster upload and carries the period-correct
           `tl` per agent, so rebuilding the map here refreshes it at the exact moment the
           roster changes. Only rows that actually carry a tl are written — a digest that
           omits one must never blank an existing mapping. Best-effort: a failure here can
           never fail the upload the user is waiting on. */
        if (qk === 'agent-digest') {
          try {
            const d = JSON.parse(body);
            const teams = {};
            for (const a of [...(d.agents || []), ...(d.notCovered || [])])
              if (a && a.code && a.tl) teams[a.code] = a.tl;
            if (Object.keys(teams).length) {
              const cur = await DB.select(`rules?key=eq.${encodeURIComponent('kv:agent-teams')}&select=value`).catch(() => null);
              const prev = (cur && cur[0] && cur[0].value && cur[0].value.teams) || {};
              const merged = { ...prev, ...teams };
              if (JSON.stringify(merged) !== JSON.stringify(prev))
                await DB.insert('rules', [{ key: 'kv:agent-teams',
                  value: { teams: merged, source: 'agent-digest', updated_at: new Date().toISOString() },
                  updated_by: user.username, updated_at: new Date().toISOString() }], true);
            }
          } catch (e) {}
        }
        /* THE WRITE LOG (save-reliability-plan P2a). The rules pointer holds only the
           LATEST write; this row is the history, so "when exactly did saves stop" is a
           query rather than an archaeology dig through Storage timestamps. Deferred and
           best-effort — logging must never slow or fail the save it records. */
        ctx.waitUntil(logKvWrite(DB, qk, body.length, user && user.username));
        return json({ ok: true, version: newVer }, 200, { 'X-Cbx-Version': newVer });
      }
      // Real delete (Upload Station "Delete file"): remove BOTH the Storage object and the
      // pointer row, so the source is gone from the database — not just cleared to empty.
      if (path === '/api/kv' && req.method === 'DELETE') {
        const qk = url.searchParams.get('key');
        if (!qk) return json({ error: 'key required' }, 400);
        await fetch(`${env.SUPABASE_URL}/storage/v1/object/raw/kv/${qk}`, {
          method: 'DELETE', headers: { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY },
        }).catch(() => {});                                    // ignore if there was no Storage object
        await DB.del(`rules?key=eq.${encodeURIComponent('kv:' + qk)}`);
        return json({ ok: true, deleted: qk });
      }

      // ---------- Tracker Analytics: daily_eod rows (one row per date) ----------
      // Row-level storage: per-date upserts mean two users editing DIFFERENT
      // dates can never clobber each other.
      // LOAD-BEARING 503 — do not simplify to the top-level 500. tracker/index.html
      // hydrate() branches on `r.status === 503` to fall back to the kv blob.
      if (path === '/api/eod' && req.method === 'GET') {
        try {
          const rows = await DB.select('daily_eod?select=*&order=eod_date.asc');
          return json({ rows: rows || [] });
        } catch (e) { return json({ error: 'no_table', detail: String(e.message || e).slice(0, 120) }, 503); }
      }
      if (path === '/api/eod' && req.method === 'POST') {
        const b = await req.json(); // {date, employed, present, afrilead, jag, vt, gwp, target} or {date, delete:true}
        if (!b.date || !/^\d{4}-\d{2}-\d{2}$/.test(b.date)) return json({ error: 'valid date required' }, 400);
        if (b.delete) { await DB.del(`daily_eod?eod_date=eq.${b.date}`); return json({ ok: true, deleted: b.date }); }
        await DB.insert('daily_eod', [{
          eod_date: b.date,
          employed: b.employed ?? null, present: b.present ?? null,
          afrilead: b.afrilead ?? null, jag: b.jag ?? null, vt: b.vt ?? null,
          gwp: b.gwp ?? null, target: b.target ?? null,
          updated_by: user.username, updated_at: new Date().toISOString(),
        }], true);
        return json({ ok: true, date: b.date });
      }

      // ---------- Power BI - Active Cases: THE money rows (migration-005) ----------
      // Row-level storage, not the kv JSON blob: a blob cannot be filtered in SQL,
      // and this file is the money. The app keeps its own copy either way, so
      // figures never depend on this.
      if (path === '/api/bi' && req.method === 'GET') {
        const from = url.searchParams.get('from'), to = url.searchParams.get('to');
        const lim = Math.min(Number(url.searchParams.get('limit')) || 20000, 50000);
        let q = 'bi_active_cases?select=*';
        if (/^\d{4}-\d{2}-\d{2}$/.test(from || '')) q += `&contract_create_date=gte.${from}`;
        if (/^\d{4}-\d{2}-\d{2}$/.test(to || '')) q += `&contract_create_date=lte.${to}`;
        q += `&order=contract_create_date.asc&limit=${lim}`;
        return json({ rows: (await DB.select(q)) || [] });
      }
      // Deleting the Power BI source also clears its queryable rows (the kv blob is
      // removed separately via DELETE /api/kv). The raw monthly archive in the
      // bi-reports bucket is kept as the audit trail (R-FMT-06 traceability).
      if (path === '/api/bi' && req.method === 'DELETE') {
        // rows first (FK), then the batch records — so a later re-upload of the same
        // file is allowed again (its file_hash is no longer on record).
        await DB.del('bi_active_cases?id=gt.0');
        await DB.del('batches?source_type=eq.BI_ACTIVE_CASES');
        return json({ ok: true });
      }
      if (path === '/api/bi' && req.method === 'POST') {
        const b = await req.json();                       // {batch, rows:[ table-shaped ]}
        const rows = Array.isArray(b.rows) ? b.rows : [];
        if (!rows.length) return json({ error: 'rows required' }, 400);

        // IDEMPOTENCY — the same file must never load twice, no matter who uploads it or
        // how many times (a colleague re-uploading, a double-click, or two uploads
        // racing). file_hash identifies the file; a partial unique index on
        // (source_type, file_hash) enforces it even under concurrency (migration-007).
        // This fast check catches the common case; the unique-index catch below closes
        // the race. Months still ACCUMULATE — a genuinely new file (different hash, e.g.
        // next month or a correction) is not skipped; it loads and replaces its own span.
        const fileHash = String(b.batch?.file_hash ?? '').trim();
        if (fileHash) {
          const dup = await DB.select(`batches?source_type=eq.BI_ACTIVE_CASES&file_hash=eq.${encodeURIComponent(fileHash)}&select=batch_id&limit=1`);
          if (dup && dup.length) return json({ ok: true, skipped: true, reason: 'This exact file is already loaded — skipped to avoid duplication.', batch_id: dup[0].batch_id });
        }

        // The file is authoritative ONLY for the span of sale dates it actually
        // carries. Months accumulate — see migration-005 header (deviates from
        // pack R-ING-BI-06 by decision, because this file is uploaded monthly).
        let mn = null, mx = null;
        for (const r of rows) {
          const d = r.contract_create_date;
          if (!/^\d{4}-\d{2}-\d{2}$/.test(d || '')) continue;
          if (!mn || d < mn) mn = d;
          if (!mx || d > mx) mx = d;
        }
        if (!mn || !mx) return json({ error: 'no valid contract_create_date in rows' }, 400);

        // Whitelist columns: never let a client key reach the table verbatim.
        const COLS = ['account_no', 'contract_create_date', 'owner', 'cb', 'charge_amount',
          'charge_code', 'contract_status', 'contract_number', 'case_number', 'account_name',
          'consultant', 'product_bundle', 'merged_bundle', 'sales_vertical', 'batch_id'];
        const pick = (r) => { const o = {}; for (const c of COLS) if (r[c] !== undefined) o[c] = r[c]; return o; };

        try {
          // batch first — bi_active_cases.batch_id is a FK into batches. Plain insert
          // (not upsert): if two same-file uploads race past the check above, the
          // (source_type, file_hash) unique index makes the loser's insert conflict —
          // caught here and skipped, so its rows never insert. That is the race-safe half.
          if (b.batch?.batch_id) {
            try {
              await DB.insert('batches', [{
                batch_id: b.batch.batch_id, source_type: 'BI_ACTIVE_CASES', source_system: 'Power BI',
                uploaded_by: user.username, uploaded_at: b.batch.uploaded_at || new Date().toISOString(),
                period_start: mn, period_end: mx,
                file_name: b.batch.original_file_name || null, file_hash: fileHash || null,
                raw_rows: b.batch.raw_row_count ?? null, loaded_rows: b.batch.loaded_row_count ?? null,
                rejected_rows: b.batch.rejected_row_count ?? null, status: b.batch.validation_status || null,
                notes: b.batch.notes || null, storage_path: b.batch.storage_path || null,
              }]);
            } catch (e) {
              if (/duplicate key|already exists|23505|conflict/i.test(String(e.message || e)))
                return json({ ok: true, skipped: true, reason: 'This exact file is already loaded (race) — skipped.' });
              throw e;
            }
          }
          // replace this month only, then append
          await DB.del(`bi_active_cases?contract_create_date=gte.${mn}&contract_create_date=lte.${mx}`);
          const CHUNK = 800;                              // PostgREST payload + Worker CPU headroom
          let ins = 0;
          for (let i = 0; i < rows.length; i += CHUNK) {
            const part = rows.slice(i, i + CHUNK).map(pick);
            await DB.insert('bi_active_cases', part);
            ins += part.length;
          }
          return json({ ok: true, inserted: ins, replaced_range: mn + ' → ' + mx });
        } catch (e) {
          const m = String(e.message || e);
          if (/bi_active_cases/.test(m) && /does not exist|schema cache|relation/i.test(m)) {
            return json({ error: 'no_table', detail: m.slice(0, 140) }, 503);
          }
          return json({ error: 'bi_write_failed', detail: m.slice(0, 200) }, 500);
        }
      }
      // Immutable archive of the exact monthly export, so any figure can be
      // re-derived from the bytes that produced it (R-FMT-06 traceability).
      if (path === '/api/bi/raw' && req.method === 'POST') {
        const name = (url.searchParams.get('name') || '').replace(/[^A-Za-z0-9._-]/g, '_');
        if (!name) return json({ error: 'name required' }, 400);
        const objPath = 'bi-reports/' + name;
        const sr = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${objPath}`, {
          method: 'POST',
          headers: {
            apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY,
            'Content-Type': req.headers.get('content-type') || 'application/octet-stream', 'x-upsert': 'true',
          },
          body: req.body,
        });
        if (!sr.ok) return json({ error: 'archive failed: ' + sr.status + ' ' + (await sr.text()).slice(0, 150) }, 500);
        return json({ ok: true, path: objPath });
      }

      // ---------- ask (Phase 3: Hermes with guardrails) ----------
      if (path === '/api/ask' && req.method === 'POST') {
        const ks = await DB.select('rules?key=eq.ai_kill_switch&select=value');
        if (!ks?.[0]?.value?.enabled) return json({ answer: 'The AI assistant is currently switched off by an administrator.' });
        const b = await req.json();
        const question = String(b.question || '').slice(0, 2000);
        const context = String(b.context || '').slice(0, 40000);
        const kb = retrieveKB(question);
        let sys = 'You are Ask AgentOS, the DATA ANALYST for The Chatterbox call centre. You have the entire software in front of you: all three analytics apps (Ops Analytics, VAS Analytics, Tracker Analytics), their full stored datasets, the live daily-EOD table, the live rules Dictionary, the operator notes, the NBA scoring framework and the company knowledge base. ANY question about agents, teams, sales, GWP, QA, attendance, leads, cancellations, campaigns, uploads, trends, or any tab of any app is IN SCOPE.\n'
          + 'WORK LIKE AN ANALYST: (1) answer with the number first, then the insight — compare against targets, previous days and peers when the data is present; compute differences and percentages from figures given in context; (2) cite where each figure comes from (which app/section of the context and the date window) so the reader can verify it; (3) name metric twins explicitly — "conversion" has two definitions (Card = sales ÷ total leads; Lead-Mgmt = sales ÷ total closed) — say which one you are using; (4) if a figure is not in the context, do not refuse: answer what you can and name exactly which tab or upload would hold the missing figure; (5) never invent a number — every figure you state must appear in, or be arithmetically derived from, the context below; (6) flag data-quality caveats you can see (stale digests, missing uploads, unmapped agents) like an analyst would. Only decline questions clearly unrelated to The Chatterbox or its operations (general trivia, news, personal advice, coding help). Be direct and executive; use short paragraphs or tight bullet lists.\n\n'
          + '=== THE SOFTWARE (apps, tabs, manual) ===\n' + SOFTWARE_GUIDE + '\n\n'
          + '=== NBA SCORING FRAMEWORK ===\n' + KB + '\n\n'
          + '=== COMPANY KNOWLEDGE BASE (TCB-KB-V3) ===\n' + kb + '\n=== end knowledge base ===\n\n'
          + 'RULES when using the knowledge base: state facts with their status where shown (confirmed / model / proposed / historical / conflict / input_required); never present a model or proposed figure as an actual. If two figures conflict (e.g. 330 vs 370 agents, R42,500 vs R34,762 revenue/agent), say both and note it is a recorded conflict — do not silently pick one. Name corrections are absolute: Nicholas Pillay is CTTO (never "Chief Growth..."); Claudell Panday spelling; Abigail owns recruitment execution; the COO is unresolved. If a fact is not in the knowledge above, say [INPUT REQUIRED] rather than inventing it.';
        if (context) {
          sys += '\n\n=== LIVE DASHBOARD DIGEST (all tabs of the app the user is in) ===\n' + context
            + '\n=== end live dashboard digest ===\nFor questions about dashboard numbers — any tab, any agent, any team — use the figures above directly. Only [INPUT REQUIRED] if a specific figure is genuinely absent from both the digest and the knowledge base.';
        }
        // Cloud data access: BOTH apps' full stored digests + upload history from
        // Supabase, injected on every question so the AI sees the entire software,
        // whichever widget the user asks from.
        let cloud = '';
        try {
          for (const [k, label] of [['ai-digest-ops', 'OPS ANALYTICS'], ['ai-digest-vas', 'VAS ANALYTICS'], ['ai-digest-tracker', 'TRACKER ANALYTICS']]) {
            try {
              const r = await DB.select(`rules?key=eq.${encodeURIComponent('kv:' + k)}&select=value,updated_at`);
              const v = r?.[0]?.value || {};
              let d = String(v.data || '');
              if (!d && v.store) d = (await DB.storageGet('raw', v.store.replace(/^raw\//, ''))) || '';
              d = d.slice(0, 25000);
              if (d) cloud += '\n--- ' + label + ' — full stored digest (saved ' + (r[0].updated_at || 'unknown') + ') ---\n' + d + '\n';
            } catch (e) {}
          }
          // Tracker Analytics — live daily_eod rows straight from the database
          // (never stale, independent of any open tab). Att%/SPD computed here in
          // code — the model explains numbers, it never computes the canon.
          try {
            const eod = await DB.select('daily_eod?select=*&order=eod_date.desc&limit=60');
            if (eod?.length) cloud += '\n--- TRACKER ANALYTICS — Matrix EOD daily table (LIVE from the database, newest first) ---\n'
              + eod.map(r => {
                  const att = (r.employed > 0 && r.present != null) ? Math.round(r.present / r.employed * 100) + '%' : '-';
                  const spd = (r.present > 0 && r.vt != null) ? Math.round(r.vt / r.present * 100) / 100 : '-';
                  return '- ' + r.eod_date + ': employed ' + (r.employed ?? '-') + ' · present ' + (r.present ?? '-')
                    + ' · attendance ' + att + ' · Afrilead ' + (r.afrilead ?? '-') + ' · JAG ' + (r.jag ?? '-') + ' · VT ' + (r.vt ?? '-')
                    + ' · SPD ' + spd + ' · avg GWP ' + (r.gwp != null ? 'R' + r.gwp : '-') + ' · agents-to-target ' + (r.target ?? '-')
                    + ' (entered by ' + (r.updated_by || '?') + ')';
                }).join('\n') + '\n';
          } catch (e) {}
          // BI - Active Cases — THE money source, aggregated LIVE from the row table
          // (migration-008 views). Never depends on any app being open. GWP incl =
          // Σ charge_amount per account × 1.15; sales = distinct accounts.
          try {
            const N = x => Number(x) || 0;
            const tot = (await DB.select('bi_money_total?select=*'))?.[0];
            const bm = await DB.select('bi_money_by_month?select=*&order=ym.asc');
            if (tot || bm?.length) {
              cloud += '\n--- BI ACTIVE CASES — THE money model, LIVE from the database ---\n';
              if (tot) cloud += 'TOTAL (all months loaded): ' + N(tot.sales) + ' sales · GWP incl R' + Math.round(N(tot.gwp_incl))
                + ' (ex R' + Math.round(N(tot.gwp_ex)) + ') · ' + N(tot.charge_lines) + ' charge lines'
                + (N(tot.unattributed_lines) ? ' · ' + N(tot.unattributed_lines) + ' unattributed' : '')
                + ' · span ' + (tot.first_sale || '?') + ' → ' + (tot.last_sale || '?') + '\n';
              if (bm?.length) cloud += 'By month:\n' + bm.map(r => '- ' + r.ym + ': ' + N(r.sales) + ' sales · GWP incl R'
                + Math.round(N(r.gwp_incl)) + ' (ex R' + Math.round(N(r.gwp_ex)) + ') · ' + N(r.charge_lines) + ' lines'
                + (N(r.unattributed_lines) ? ' · ' + N(r.unattributed_lines) + ' unattributed' : '')).join('\n') + '\n';
            }
          } catch (e) {}
          // BI money by agent — top per recent month, so "top agent in June" or a
          // specific CB's GWP resolve from live data.
          try {
            const N = x => Number(x) || 0;
            const ba = await DB.select('bi_money_by_agent?select=*&order=ym.desc,gwp_incl.desc&limit=240');
            if (ba?.length) {
              const byM = {};
              for (const r of ba) (byM[r.ym] = byM[r.ym] || []).push(r);
              let s = '';
              for (const ym of Object.keys(byM).sort().reverse().slice(0, 3))
                s += ym + ': ' + byM[ym].slice(0, 15).map(r => (r.owner || r.cb) + ' ' + N(r.sales) + '/R' + Math.round(N(r.gwp_incl))).join(' · ') + '\n';
              if (s) cloud += 'By agent (top 15 per recent month, GWP incl):\n' + s;
            }
          } catch (e) {}
          // VAS ANALYTICS — sales/GWP by month summarised LIVE from its cloud blob,
          // so VAS figures answer even when nobody has the VAS app open.
          try {
            const vr = await DB.select(`rules?key=eq.${encodeURIComponent('kv:vas-state')}&select=value`);
            const vv = vr?.[0]?.value || {};
            let vraw = String(vv.data || '');
            if (!vraw && vv.store) vraw = (await DB.storageGet('raw', vv.store.replace(/^raw\//, ''))) || '';
            if (vraw) {
              const V = JSON.parse(vraw);
              const perM = {};
              const addM = (d, s, g) => { const m = String(d).slice(0, 7); const o = perM[m] = perM[m] || { sales: 0, gwp: 0 }; o.sales += (Number(s) || 0); o.gwp += (Number(g) || 0); };
              for (const d in (V.sales || {})) for (const k in V.sales[d]) { const x = V.sales[d][k] || {}; addM(d, x.n, x.gwp); }
              for (const d in (V.tracker || {})) { if (V.sales && V.sales[d]) continue; for (const k in V.tracker[d]) { const x = V.tracker[d][k] || {}; addM(d, x.sales, x.gwp); } }
              const months = Object.keys(perM).sort();
              if (months.length) cloud += '\n--- VAS ANALYTICS — sales/GWP by month (LIVE from the vas-state blob) ---\n'
                + months.map(m => '- ' + m + ': ' + Math.round(perM[m].sales) + ' sales · GWP R' + Math.round(perM[m].gwp)).join('\n')
                + '\nRoster: ' + ((V.roster || []).length) + ' agents · uploads: ' + ((V.files || []).map(f => f.type).join(', ') || 'none') + '\n';
            }
          } catch (e) {}
          // Live rules Dictionary (kv:cb-config) — the ACTUAL thresholds in force,
          // visible from every app's widget, not just when asked from Ops.
          try {
            const rc = await DB.select(`rules?key=eq.${encodeURIComponent('kv:cb-config')}&select=value`);
            const v = rc?.[0]?.value || {};
            let raw = String(v.data || '');
            if (!raw && v.store) raw = (await DB.storageGet('raw', v.store.replace(/^raw\//, ''))) || '';
            if (raw) {
              const cfg = JSON.parse(raw);
              const rl = cfg && cfg.rules ? cfg.rules : {};
              const buf = Object.keys(rl).map(k2 => {
                const vals = rl[k2] && rl[k2].vals;
                return vals != null ? k2 + '=' + (Array.isArray(vals) ? vals.join('/') : vals) : null;
              }).filter(Boolean).join(' · ');
              if (buf) cloud += '\n--- LIVE RULES DICTIONARY (current thresholds in force — user-editable in Ops → Data → Dictionary) ---\n' + buf.slice(0, 4000) + '\n';
            }
          } catch (e) {}
          // Operator notes — the brain vault's hot cache (state of play).
          try {
            const hot = (await DB.storageGet('brain', 'hot.md')) || (await DB.storageGet('brain', 'brain/hot.md'));
            if (hot) cloud += '\n--- OPERATOR NOTES (brain vault — state of play) ---\n' + String(hot).slice(0, 4000) + '\n';
          } catch (e) {}
          try {
            const bt = await DB.select('batches?select=source_type,file_name,loaded_rows,rejected_rows,uploaded_by,uploaded_at&order=uploaded_at.desc&limit=10');
            if (bt?.length) cloud += '\n--- Upload history (latest batches) ---\n'
              + bt.map(x => '- ' + (x.uploaded_at || '?') + ': ' + (x.source_type || '?') + ' "' + (x.file_name || '') + '" (' + (x.loaded_rows ?? '?') + ' rows loaded, ' + (x.rejected_rows ?? 0) + ' rejected) by ' + (x.uploaded_by || '?')).join('\n') + '\n';
          } catch (e) {}
        } catch (e) {}
        if (cloud) {
          sys += '\n\n=== CLOUD DATA (the entire software: all three apps’ stored datasets, the live daily-EOD table, the live rules Dictionary, upload history, operator notes) ===' + cloud
            + '=== end cloud data ===\nThe data above covers the FULL datasets of all three apps — Ops Analytics, VAS Analytics and Tracker Analytics — whichever app the user is currently in. Use them for any question about the other app, past uploads, or data not on the current screen. The blocks marked "LIVE from the database" (BI Active Cases money by month/agent/total, VAS sales & GWP by month, the Matrix EOD table) are read straight from Supabase on THIS request — they are always current and AUTHORITATIVE: prefer them over any stored digest figure for money, sales or GWP. IMPORTANT: if a stored digest conflicts with a LIVE block or the LIVE DASHBOARD DIGEST (e.g. the stored one shows zeros or is missing an agent the live one lists), the LIVE figure is the truth — a stored digest may simply be stale.';
        }
        const mrow = await DB.select("rules?key=eq.ai_model&select=value");
        let model = (mrow?.[0]?.value?.value) || DEFAULT_MODEL;
        let ai;
        try {
          ai = await env.AI.run(model, { messages: [{ role: 'system', content: sys }, { role: 'user', content: question }], max_tokens: 900 });
        } catch (e) {
          // model unavailable / context error → fall back to the smaller model with tighter context
          model = FALLBACK_MODEL;
          ai = await env.AI.run(model, { messages: [{ role: 'system', content: sys.slice(0, 90000) }, { role: 'user', content: question }], max_tokens: 900 });
        }
        const answer = (ai && (ai.response || ai.result || '')) || '[no response]';
        ctx.waitUntil(DB.insert('ask_log', [{ asked_by: user.username, question, answer, model }]));
        return json({ answer });
      }

      return json({ error: 'not found' }, 404);
    } catch (e) {
      return json({ error: 'server error', detail: String(e.message || e).slice(0, 300) }, 500);
    }
  },
};
