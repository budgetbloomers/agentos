# Research — 002 live month, scheduled referrals, coaching (2026-10-01)

Evidence: two ecc:code-explorer passes + live read-only probes (Supabase, Convex Coaching Hub) on 2026-10-01.

## R1 Live month before its first data
- Today: PULSE `agentDigestPayload()` returns null for a month with no rows; `tools/digest-republish.mjs` then
  builds the previous month (rollover grace, shipped this morning) and the live key stays September.
- **Decision**: an EMPTY-MONTH payload for the current month (list agents, every figure null, `empty:true`,
  `daysWithData:0`, October model, working days) is published live; the previous month keeps its history key
  `agent-digest-YYYY-MM` (rebuilt once more so its last day is in). The rollover-grace rule stays for safety but
  never applies once the current month (even empty) is live.
- **Guard**: an empty payload must never replace a NON-empty live payload of the same month (a stale tab or the
  tool on an old state) — the Worker refuses it; the tool checks before writing.
- Pages: empty state + "<Previous month> (final)" via the existing `?month=YYYY-MM` overview route.

## R2 Referrals on a schedule
- Today: PULSE `__hlSyncVAS` (nicks_code/index.html:10228-10255) pulls `GET /api/referrals` (Worker, HighLevel
  secrets HL_API_KEY/HL_LOCATION_ID, paged contacts) → `INGEST.referrals` → `S.refs` → save → digest kick; its
  watchdog only fires when `S.refs.by` is empty. `tools/digest-republish.mjs` never syncs referrals. The GitHub
  step is dead (Actions off). `tools/fetch-referrals.mjs` only writes CSVs.
- The Worker cannot run the whole sync on the FREE plan (≥ 18 HighLevel pages + parsing > 10 ms CPU; the agent
  matcher `_refStore` lives in PULSE).
- **Decision**: a new `tools/sync-referrals.mjs`, run by the local tick at the 08:00 and 14:00 SAST slots (every
  day — the tick's weekday gate is bypassed for these slots only): mint a short-lived admin session (the verify
  suites' pattern), call `GET /api/referrals?fresh=1` (one counting implementation — the Worker's), delete the
  session, write `kv:referrals-latest` + append `kv:referrals-sync-log`. Then the same tick's digest republish
  ingests `kv:referrals-latest` into the headless engine before building, and every PULSE tab adopts it on
  boot/focus/poll when it is newer than its own `S.refs.at` (a newer manual sync wins).
- Health: `referrals-slot-missed` (warning) when a slot is > 2 h past with no successful run since it.

## R3 Coaching freshness
- Since today's fix the copy refreshes in budgeted waves whenever it is older than `REFRESH_HOURS` (2 h); cron
  `3,23,43 * * * *` runs every day. First full pull after the fix: 16:23 SAST, 1,427 sessions.
- **Decision**: make the daily guarantee explicit — a pull is forced when the copy predates today's 05:30 SAST
  (4 invocations ≈ 1 h, done by ~06:45 SAST); every coaching payload carries `coachingAt` and every surface prints
  it. The TL Coaching Hub tab reads Convex LIVE for the TL's own sessions — say so.

## R4 "Only compliance"
- Live: the Hub has 28 `leadManagementCoaching` rows, ALL under Dalwin's Hub profile (`…899eev`), ALL July 2026;
  17 carry an agent CB; zero since 1 Sep; no other LM collection exists (probed 17 candidate names).
  Sep–Oct: 711 sessions (QA 348, formal 259, informal 90, group 14); top themes purpose.quality_compliance 335,
  gap.compliance_required_wording 200; no lead-management theme in the top 14.
- Code: TL Hub tab = Convex rows under the TL's own id only (hubs.mjs:152-170); cmCoaching drops sessions whose
  hub leader is not a list TL (portal.mjs ~682); gap-only theme filters at agent/index.html:2679, 5439, 5476 and
  coachAnalysis (coaching.mjs ~551); LM `purpose` field is not a cluster key.
- **Decision**: attribute sessions with a CB to the agent's CURRENT TL (digest/list), keep the coach's name;
  the TL Hub tab adds "Coaching on your agents by others" from the snapshot; type counts show LM separately with
  "No lead-management coaching logged in <period>" when zero; theme summaries include any `*.lead_management`
  key alongside gap themes. Agent OS cannot show coaching that was never logged — the message says so.
