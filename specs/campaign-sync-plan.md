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
