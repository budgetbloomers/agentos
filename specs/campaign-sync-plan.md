# Campaigns follow the Agent List — implementation plan

Nick, 3 Sep 2026: "when a new agent list is uploaded it already automatically creates
agent view and team leader view, and when they're not on the new list their account is
deleted. Now add: when a new agent list is uploaded, new campaigns are created — make
the changes in Supabase if you have to."

## Where we stood

The 2 Sep list names four campaigns (Courtesy 31 · VT 45 · Cuddle 30 · Nesting 1), but a
campaign was not an entity anywhere:

| Place | Behaviour before |
|---|---|
| Supabase | No campaigns table. A campaign existed only as a string on agent_list rows. |
| Worker (campaign manager) | The set of campaigns and who runs them hardcoded (`CM_ASSIGN_DEFAULTS`: courtesy, cuddle, nesting). |
| PULSE | `campOf()` folds any unknown spelling into Courtesy; `reportedCampaigns` fixed at Cuddle/Courtesy/Nesting; the roster ingest names off-campaign rows in a warning and keeps them off its roster. |
| Ops | Campaign buckets Courtesy/Cuddle/VT; "anything new keeps its roster label". |

So a brand-new campaign on a list would be invisible to the CM view, folded or warned
in PULSE, and never recorded as having started.

## Phase 1 — shipped 3 Sep 2026 (this round)

Same pattern as agents (migration-014) and team leaders (migration-018): the list is the
evidence, the database enforces it, one call per publish, fail-closed guards.

1. **`supabase/migration-019-campaigns.sql`**
   - `campaigns` table (key, label, active, first_seen, last_seen, agents, source, audit).
   - `campaign_key(text)` — trimmed, spaces collapsed, lower-cased; the join between a
     list cell and a row. Label keeps the list's own most-common spelling.
   - `sync_campaigns(p_actor, p_apply, p_min_roster=25, p_max_deactivate=2)` reads
     `agent_list_current`: **creates** a campaign named for the first time, **reactivates**
     a returning one (first_seen kept), **deactivates — never deletes** — one no agent
     carries. Refuses whole on a short list, a campaign-less list (a dropped column, not
     an empty floor), or more than two campaigns going quiet at once. Plans by default.
   - `active_campaigns` view — the one list of "what campaigns exist".
   - `campaign_sync_logs` — who created/deactivated what, when.
   - Seeds from the current list on apply.
2. **Worker** — `syncCampaigns()` runs on every list publish (`POST /api/roster`, result
   returned to the uploader as `campaigns`) and every ten-minute cron tick; a created
   campaign is logged as *NEW (needs targets + owner)*. `GET /api/campaigns` serves the
   active list. The campaign-manager context now carries `campaigns` from the table.
3. **Guard** — `nicks_code/diagnostics/verify-campaign-sync.mjs` (real function, real
   database, transaction always rolled back): seed, idempotence, create, deactivate-
   not-delete, reactivate with first_seen kept, key normalisation, all three refusals.

## Phase 2 — shipped 3 Sep 2026 on the proposed defaults (Nick: "ok build it out")

| Decision | What was built |
|---|---|
| **Targets** | A list-created campaign has **no targets**. The CM settings page lists it (one campaign-wide row) badged **"new — targets not set"** until a target, GWP month or quality dial is set. Its agents' daily target falls back to the Agent List's own Target cell (the list's number, not a guess). |
| **Owner** | `effectiveCamps()` (Worker): a CM sees their assigned campaigns **plus every active campaign nobody is assigned to**. Narrowing is a `cm:assignments` row edit. VT never reaches a screen (no digest rows). |
| **Reporting** | PULSE `campOf()` returns an unknown campaign's **own label** (never Courtesy); the roster ingest puts its agents ON the roster and names the campaign in a toast; `CAMPS` = rule book + roster extras (own section, tab, pivot, export); Actual Shifts follow the Courtesy rule (dialler-derived); the composite uses the Courtesy tenure group; **V23** on the Data tab flags every such campaign as "reported under the Courtesy rules until the rule book names it". Commission stays "not set up yet" for it — honest, the comm workbook has no sheet for it. |

Guards updated: `verify-agent-list.mjs` (a new campaign lands, is named, is in CAMPS, V23 fires),
`verify-all-tabs.mjs` (four rule-book campaigns + any the list created). Ops keeps its
existing behaviour (new labels survive `campBucket`; the filter dropdown is unchanged).

## Phase 2 — the decisions as originally posed

A created campaign is a named fact with a head count. Three things about it are human
decisions the sync deliberately does not make:

| Decision | Why it can't be automatic | Proposed default if Nick says "just do it" |
|---|---|---|
| **Targets** (daily sales matrix, GWP month target, SLA dials) | The rule book defines them per campaign; inventing them scores real people against a guess. | Create the campaign with **no** targets; the CM settings page shows it as *"new — targets not set"*, and its agents' target rows read "not measured" until set. |
| **Owner** (which campaign manager) | `cm:assignments` is who runs what. | Add it to **every** campaign manager's list until narrowed. |
| **Reporting** (PULSE tabs, exports, digest) | PULSE's MTD engine writes exactly Courtesy \| Cuddle \| Nesting to its fact table by rule-book §5; a new campaign needs its Actual-Shift rule (dialler-derived vs HR register), its talk source and its tenure matrix. | Report it under its own name with the Courtesy rules until the rule book says otherwise, **flagged** on the Data tab. |

Phase 2 work once decided: PULSE `campOf()` returns the list's own label for an unknown
campaign (never Courtesy), `CAMPS` derives from `/api/campaigns` + the rule book, the CM
settings page lists new campaigns from the table with "set targets" prompts, and Ops'
`CAMP_OPTS` reads the same endpoint.

## Verification

`node nicks_code/diagnostics/verify-campaign-sync.mjs` · `verify-agent-sync.mjs` (unchanged,
80) · Worker deploy · a plan-only call against live (`sync_campaigns('audit', false)`).

## Phase 1b — the file is the record (built 2026-09-03, migration-020)

Nick, after the "Download & Test" campaign (five agents) turned out to have been dropped
from every publish for weeks: "to make sure this problem never happens again — when the
agent list is uploaded I want agent view, team leader view created, new campaigns
automatically created, and if it's not in the next one it must be deleted; build this
logic in Supabase."

**Assessment.** The Supabase side (014 agents, 018 leaders, 019 campaigns) had done its job
on every publish. The rows never reached it: PULSE classified rows in the browser and
posted only the ones it recognised. A client that classifies before it publishes can drop
anything, and nothing downstream can know. So the fix is not more logic in the browser —
it is to stop trusting the browser's roster at all.

**What was built.**

| Piece | Where | What it does |
|---|---|---|
| `campaign_label(raw, sheet)` | SQL | The one place a row is classified: campOf's vocabulary + "a row on the VT sheet is VT". |
| `publish_agent_list(as_of, rows, …)` | SQL | Takes EVERY row of EVERY sheet, unclassified; derives the roster; runs sync_agent_list → sync_team_leaders → sync_campaigns in ONE transaction. PLAN names every hash the apply needs; APPLY is all-or-nothing (a refusal at the leaders stage rolls back the agents' writes — proven). Returns the roster, `dropped[]` with reasons, `blank_campaign[]`, and each sync's result. |
| `agent_list_raw` | SQL | The whole file per as_of with accepted/why — the audit trail that would have shown five rows with accepted=false. |
| `sync_campaigns` | SQL | DELETE semantics (Nick): a campaign nobody on the list carries is removed; `campaign_sync_logs.deleted` is the history; cap `p_max_delete` 2 per run. |
| `agent_list_integrity` | SQL view | Six sentence-checks: list ↔ logins (both ways) ↔ campaigns (both ways) ↔ leaders ↔ roster of record. |
| `/api/roster` POST | Worker | Accepts `rows` (raw, with `sheet`); PLAN → fingerprint over the SQL-derived roster → APPLY; the record only moves on SUCCESS; legacy `roster` payloads are treated as already-classified rows. |
| health cron | Worker | Reads the integrity view every ten minutes → `agent-list-out-of-sync` alert (critical / warning) in both apps while any row fails; clears itself. |
| PULSE / Ops stations | clients | Post every raw row alongside their own roster; report campaigns created/deleted, leader logins created/removed and dropped rows; PULSE adopts the returned record so its screen equals the suite's. |
| `tools/publish-agent-list.mjs` | tool | Headless publish of an xlsx through the same path. |

**Proof.** `verify-publish-agent-list.mjs` (45 checks, rolled back): unknown campaign lands
under its own name with its head count; VT queue labels fold to VT; blank cell → Courtesy
and named; three non-agent rows returned with reasons; NEEDS_HASHES writes nothing; apply
creates every login and the campaigns; a second list deletes an uncarried campaign; a
phantom leader on every row is REFUSED at the leaders stage with the agent floor untouched;
the integrity view counts a vanished login and a phantom campaign. `verify-campaign-sync`
(22) and `verify-agent-sync` (80) still pass.

**Still Nick's.** Leaders are created only from `team_leader_cbs` (the list carries no
leader CB); an unrepresented leader is now an ALERT, but the CB still has to come from a
human. Phase 2 (targets, owner, PULSE reporting of a new campaign) unchanged.

## Phase 3 — the list decides what is reported (built 2026-09-27)

Nick: "if I upload an agent list and there are new campaigns it must be automatically created in
VAS month to date, weekly, daily etc, and the correct data must be showing … the campaign must be
taken from the agent list … if the old ones are not in the new one it must be removed … always
place the agents in the correct campaigns as well as their team leaders."

| Rule | Where |
|---|---|
| A new campaign is named as the list names it, minus a leading `Matrix VAS -` ("Matrix VAS - Download & Test" → "Download & Test"). PULSE and SQL strip the same prefix in the same order. | `campOf()` + `CAMP_PREFIX` (PULSE) · `campaign_label()` in **migration-050** |
| `CAMPS` = the campaigns the Agent List carries **for the period on screen** (roster agents' org history), rule-book campaigns included only when carried. The current month follows the latest list alone, so a dropped campaign disappears and its movers' whole month goes to their new campaign; a past month shows what that month's lists assigned. No roster at all → the rule book's list. Excluded agents (spec §5) never keep a campaign on screen. | `refreshCamps(range)` |
| The comparison period (MP) keeps its own campaigns plus the ones on screen, so "vs last month" still counts a campaign the list has since dropped. | `rebuild()` → `buildModel(…, {withCamps})` |
| Campaign **and team leader** come from the list's own segments (`src:'agent-list'`) ahead of the tracker daily sheet; a tracker row can no longer overwrite the list's same-day segment. Days before the first list keep the old order. | `listSegAt()` · `recordOrg()` guard |
| A campaign with facts in the period but not on the list is a **warning** (`campaign-dropped`), not a green info row; VT stays information. A header filter left on a dropped campaign is cleared with a toast. MTD/Weekly default to the first carried campaign, never a literal "Cuddle". | `validateMTD` · `rebuild()` · `PAGES.mtd/weekly` |
| Dashboard "Daily sales by campaign" stacks every reported campaign; a list-created campaign gets a stable colour from its name. | `stackChart()` · `campColor()` |

Guard: `nicks_code/diagnostics/verify-new-campaign.mjs` (52 checks: a real-format list with a new
campaign → label, CAMPS, dropdown, MTD/Weekly/Daily/digest figures equal to independently computed
sums; ViciDial/SF campaign hints ignored; a mover's whole month moves; a second list without the
campaign removes it everywhere; uncarried Nesting not reported; tracker sheet cannot outvote the list's
campaign or TL; no-Cuddle list still opens MTD/Weekly on rows; last month keeps its Nesting sale).
Honours `AGENTOS=<checkout>`. `verify-agent-list.mjs` updated to the carried-only rule.

**To go live (Nick):** `node tools/apply-migration.mjs supabase/migration-050-campaign-label-prefix.sql`
(no live campaign re-keys: every current list row labels Courtesy/Cuddle/VT before the prefix rule is
reached), then the normal PULSE deploy + post-deploy smoke.
