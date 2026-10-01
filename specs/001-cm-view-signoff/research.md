# Research — 001 CM view sign-off (2026-10-01)

Evidence gathered by two ecc:code-explorer passes over the repo and live read-only probes of Supabase and the
Coaching Hub. File refs are as of commit 2bcdd64.

## R1 Billing month
- **Decision**: billing month = 26th of the previous month → 25th, keyed by the month it ENDS in
  (`cycle-2026-09` = 26 Aug – 25 Sep). Built by the PULSE engine (`window.__mtd.setPeriod(m,'cycle')` +
  `agentDigestPayload()`), published by `tools/digest-republish.mjs` (the local tick) under
  `kv:agent-digest-cycle-YYYY-MM` for the last complete cycle and the cycle in progress. The Worker only serves
  it (`loadDigest(DB,'cycle-YYYY-MM')`).
- **Rationale**: PULSE already has `periodRangeRaw('cycle')` (P:3843) and the "Cycle (26th–25th)" preset; the
  live digest and the Worker 409 fence are calendar-month only by design (P:10017-10028, index.mjs fence) and
  must stay so; the Worker is on the FREE plan (10 ms CPU) so it cannot re-aggregate from per-day rows.
- **Alternatives rejected**: per-day aggregation in the Worker (CPU, and closed leads / QA are not per day);
  loosening the live-digest guard (re-opens the 3 Sep failure); browser-side cycle publishing (every PULSE
  tab would have to rebuild a second period).
- **Risk to verify in tests**: `agentDigestPayload` over a period that spans two months — campaign moves are
  keyed by month (`S.campaignMoves[YYYY-MM]`), the comm block keys on the period's month, `weeks`/`workingDays`
  must follow the range. The cycle payload must pass the same field checks as a month payload.

## R2 Custom month
- **Decision**: any published calendar month (`/api/portal/overview?month=YYYY-MM` and `listDigestMonths`
  already exist, index.mjs:690-708). The page's "NO MONTH FILTER" stance (agent/index.html:3958) stays for
  agents and team leaders; only the campaign-manager view gets the period picker.

## R3 Conversion = sales ÷ closed leads
- **Decision**: PULSE adds `closed` per agent to the digest = `leadBook().A[cb].tc` for the period (every case
  closed in the period, any status incl. "no feedback"); `null` when no case book is loaded. The Worker sums it
  per slice: `conv = Σsales ÷ Σclosed` when Σclosed is known and > 0.
- **Rationale**: `tc` is already computed (P:7055-7096) and already published per agent in
  `agent-reports-leads` (`convC`); the digest's `leads` (unique leads) feeds the composite and must not change
  meaning (Principle I).
- Target: keep the per-campaign Settings value (`conv_target`, default 10%).

## R4 Talk time in hours, per-campaign targets
- **Decision**: keep the campaign view's measure (Σtalk ÷ actual shifts, campaign.mjs:342). Defaults:
  Courtesy 300 min, Cuddle 270 min, all others 210 min, recorded in a new spec `specs/cm_rules.json` with a
  dated `_changes[]` entry; `campaign.mjs` carries the operative copy (drift-checked). A live per-campaign
  override in `cm:targets` still wins (none exists today — probed 2026-10-01). Display "4 h 32 m".

## R5 Contact rate
- **Decision**: unchanged definition `ans ÷ calls` where `ans` = calls whose status is NOT in
  `MTD_RULES.viciCallReport.noContactStatuses` (P:796; rule book specs/mtd_engine_rules.json:174-192) —
  exactly "speaking to a person". Always rendered (with reason when no dialler data), per team row too.

## R6 Help-request card
- **Decision**: heading "Where my team leaders need help"; filter `D.assist.blockPanel` to the selected
  campaign (today it is rendered unfiltered, agent/index.html:4293).

## R7 Denise / coaching (root cause, proven live)
- The CM payload carries no Coaching Hub data (`overview()` campaign scope, portal.mjs:607-613; `hubIdsOf`
  refuses non-TLs, hubs.mjs:131-137).
- `kv:coaching` was last written 2026-09-21 14:43 (22 leaders, 1,163 sessions). The Hub now lists 23 leaders.
  `snapshotCoachingWave` (coaching.mjs:247) runs WAVES `[[0,1],[2,3],[4,5]]`: 2 collections × 23 leaders = 46
  Convex calls + `teamLeaders:list` + 3 Supabase calls in the wave + the cron-log write = 51 subrequests > the
  Free plan's 50 → every wave dies before writing `kv:coaching-waves`; the error goes only to `console.warn`.
- **Decision**: chunk the wave by a subrequest budget (≤ 35 Convex calls per invocation, pointer over
  (collection, leader) pairs), record every attempt in `kv:coaching-wave-log` (last 20), and raise a
  `coaching-stale` health warning when the copy is older than 26 h on a working day.
- Denise Haripersad: `app_users` cb267, team_leader, team "Denise Haripersad", hub_ids.coaching
  `jx7ad7sm95xg4738eg5a0479558c9z0x`; 1 Oct list: Courtesy, 7 agents. Nothing special-cased.

## R8 Reports
- CM Reports today: Variance + Lead management only (`CM_REPORT_TABS`, agent/index.html:3688). TL has Month to
  date, Daily, Weekly too (`REPORT_TABS`:1269), all rendered from digest agent rows + `tlAgg`/`campAgg`.
- **Decision**: the CM payload carries the digest agent rows for the CM's campaigns plus their `tlAgg` and
  `campAgg` blocks, and the CM gets the same five renderers.
- Lead management: Courtesy is excluded at the REPORT layer only (PULSE `PAGES.leads` + the published
  `agent-reports-leads` rows/blocks), by a dated rule in MTD_RULES + specs/mtd_engine_rules.json. `leadRoster`
  / `leadBook` are untouched so `leads` and `closed` still cover Courtesy.

## R9 Team-leader Month to date
- Agent-view tiles come from `me.drill` (drill.mjs) for ta/aveG/qa/att and simple presence states for premium
  and referrals (agent/index.html:5440-5453). **Decision**: the Worker attaches the same drill verdicts to every
  agent row in the TL overview; the page renders them with the SAME `drillState` path the agent page uses.
- Coaching analysis per agent, from the snapshot: sessions in the period, last session date, themes (cluster
  labels), and "after coaching" = sales per worked day after the last session vs before it within the period
  (from `days[]`), labelled as such. Deterministic; Nikola may explain it, never computes it.
