---

description: "Task list — 001 CM view sign-off"
---

# Tasks: Campaign Manager view — sign-off list

**Input**: Design documents from `/specs/001-cm-view-signoff/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/interfaces.md

**Tests**: REQUIRED (Constitution VII — every rule has a guard, written first and seen red).

**Organization**: by user story; every task names its work package owner — **WP1** (PULSE engine + tools:
`nicks_code/index.html`, `tools/digest-republish.mjs`, `specs/mtd_engine_rules.json`), **WP2** (Worker:
`worker/src/*.mjs`, `specs/cm_rules.json`), **WP3** (page: `agent/index.html`). A WP never edits another WP's
files; they meet at `contracts/interfaces.md`.

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup

- [x] T001 Confirm suites green on the baseline before any change: verify-agent-analytics, verify-campaign-manager, verify-cm-targets, verify-engine-rules, verify-comm-model, verify-store-freshness (nicks_code/diagnostics/)

---

## Phase 2: Foundational (blocking)

**⚠️ No user-story UI work ships before T002–T011 are green.**

### Tests first
- [x] T002 [P] WP1 — new nicks_code/diagnostics/verify-cm-digest.mjs: digest rows carry `closed` (= leadBook tc for the period, null without case books, never 0-for-unknown); a cycle build (26 Aug–25 Sep) returns a whole, well-formed payload (`period.kind:'cycle'`, workingDays/weeks/dates within range, movers' segments per month); `MTD_RULES.leadReportExcludeCampaigns` = ['Courtesy'] and PAGES.leads + agentReportsLeadsPayload omit Courtesy rows/blocks while `leads`/`closed` still count Courtesy; the tool publishes `agent-digest-cycle-YYYY-MM` for the last complete and in-progress cycles and never the live key — RED
- [x] T003 [P] WP2 — new nicks_code/diagnostics/verify-coaching-wave.mjs: wave chunks ≤ 35 Convex calls per invocation for 23+ leaders × 6 collections; pointer resumes; snapshot written only when all pairs done; every invocation appends to kv:coaching-wave-log (≤ 20 kept); evaluateFreshness raises `coaching-stale` (warning) > 26 h on a working day and clears — RED

### Implementation
- [x] T004 WP1 — nicks_code/index.html agentDigestPayload: add `closed` per agent from leadBook (tc), null when no case book (contract C1)
- [x] T005 WP1 — nicks_code/index.html: make agentDigestPayload correct for a cycle period (`period.kind:'cycle'` when the range is 26th→25th; campaign moves for both months; comm block keyed on the cycle's END month); the browser push guards stay calendar-month (no cycle from browsers)
- [x] T006 WP1 — nicks_code/index.html + specs/mtd_engine_rules.json: `leadReportExcludeCampaigns:['Courtesy']` with a dated `_changes[]` entry; apply in PAGES.leads and agentReportsLeadsPayload (add `excludedCampaigns`), NOT in leadRoster/leadBook
- [x] T007 WP1 — tools/digest-republish.mjs: after the live jobs, build + publish `kv:agent-digest-cycle-YYYY-MM` (last complete cycle, cycle in progress) via setPeriod(m,'cycle'); skip a cycle with no rows; never touches the live key
- [x] T008 WP2 — worker/src/coaching.mjs: budgeted (collection, leader) chunks ≤ 35 calls, pointer in kv:coaching-waves, kv:coaching-wave-log entries (contract C5)
- [x] T009 WP2 — worker/src/health.mjs (+ the cron collector in index.mjs): `coaching-stale` warning from kv:coaching.fetchedAt
- [x] T010 WP2 — new specs/cm_rules.json `{talk_target_min_by_campaign:{courtesy:300,cuddle:270}, talk_target_min_default:210, _changes:[{date:'2026-10-01',…}]}` + operative copy in worker/src/campaign.mjs + drift check in the WP2 suite
- [x] T011 Run T002/T003 → GREEN

**Checkpoint**: engine publishes `closed` + cycle digests; coaching refresh works and is observable.

---

## Phase 3: User Story 1 — Campaign tab shows the right numbers (P1) 🎯 MVP

### Tests first
- [x] T012 [P] [US1] WP2 — new nicks_code/diagnostics/verify-cm-signoff-worker.mjs (part A): cmOverviewBody conv = Σsales ÷ Σclosed with basis 'sales ÷ closed leads' and null+`convWhy` when closed unknown; talk {v sec/worked day, targetMin 300 Courtesy / 270 Cuddle / 210 other, settings override wins}; contactRate {v,contacts,dials} on kpis AND every team row, null+`contactWhy` without dials; `assist.blockPanelByCamp` holds only that campaign's rows — RED
- [x] T013 [P] [US1] WP3 — new nicks_code/diagnostics/verify-cm-view.mjs (part A): Campaign tab renders conversion "sales ÷ N closed leads", talk "4 h 32 m a day · target 5 h" (Courtesy) / "4 h 30 m" (Cuddle), contact rate with counts (and "—" + reason), the card heading "Where my team leaders need help" + its sub-line, and only the selected campaign's help rows — RED

### Implementation
- [x] T014 [US1] WP2 — worker/src/campaign.mjs agg(): Σclosed/closedKnown, conv on closed, talk target resolution (C2), contact per team, blockPanelByCamp
- [x] T015 [US1] WP3 — agent/index.html cmCmdPage/cmTeamsPage: tiles + team columns per C2 (hours formatter, contact column), new heading/sub-line, page subtitle "Sales, team leaders and where they need help", help card filtered to the selected campaign
- [x] T016 [US1] Run T012/T013 → GREEN

---

## Phase 4: User Story 2 — Select tenure and campaign (P1)

- [x] T017 [P] [US2] WP2 — verify-cm-signoff-worker.mjs (part B): `?tenure=` filters rows before aggregation; `cm.campaigns[i].tenures` lists present tenures; `unset` covers blank tenure; `all` equals today's figures; bad value → 400; ignored for non-CM roles — RED
- [x] T018 [P] [US2] WP3 — verify-cm-view.mjs (part B): campaign + tenure selectors render, a change re-asks the overview with the param, the selection is stated on screen, an empty slice says so — RED
- [x] T019 [US2] WP2 — worker/src/portal.mjs + worker/src/index.mjs: tenure param validation + pass-through to cmOverviewBody; worker/src/campaign.mjs tenure filtering + tenures list
- [x] T020 [US2] WP3 — agent/index.html: tenure select beside the campaign select (shown even with one campaign), re-fetch, empty-slice message
- [x] T021 [US2] Run T017/T018 → GREEN

---

## Phase 5: User Story 4 — Team leaders' coaching (P1)

- [x] T022 [P] [US4] WP2 — verify-cm-signoff-worker.mjs (part C): GET /api/portal/cm-coaching per C3 — CM only (403 others), leaders limited to the CM's effective campaigns, out-of-scope tl → 404, sessions newest first ≤ 300 inside the period, matched by hub_ids.coaching then name, `stale`/`ageHours`; Denise-shaped fixture (Courtesy TL with hub id) returns her sessions — RED
- [x] T023 [P] [US4] WP3 — verify-cm-view.mjs (part C): CM sidebar shows "Team leaders' coaching" directly above the user card / Sign out; it opens the in-app page (leader table, picker, sessions list, copy age, "Open the Coaching Hub ↗" with rel=noopener) — RED
- [x] T024 [US4] WP2 — worker/src/portal.mjs (cmCoachingBody) + worker/src/index.mjs route
- [x] T025 [US4] WP3 — agent/index.html: sidebar link + `cm_coach` view + page
- [x] T026 [US4] Run T022/T023 → GREEN

---

## Phase 6: User Story 3 — Period: current, billing, past month (P2)

- [x] T027 [P] [US3] WP2 — verify-cm-signoff-worker.mjs (part D): `?period=` current/YYYY-MM/cycle-YYYY-MM loads the right key; `period` + `periods{months,cycles}` in the response; bad → 400; unpublished → 404 period_not_published; ignored for non-CM roles — RED
- [x] T028 [P] [US3] WP3 — verify-cm-view.mjs (part D): period picker (Current month · Billing month last complete / in progress · past months), label on screen, period_not_published message instead of other numbers — RED
- [x] T029 [US3] WP2 — worker/src/portal.mjs + index.mjs: period param → loadDigest(DB, key); cycle list (listDigestCycles)
- [x] T030 [US3] WP3 — agent/index.html: period picker, re-fetch, labels
- [x] T031 [US3] Run T027/T028 → GREEN

---

## Phase 7: User Story 5 — All reports, Lead management without Courtesy (P2)

- [x] T032 [P] [US5] WP2 — verify-cm-signoff-worker.mjs (part E): CM overview carries `agents` (CM campaigns ∩ tenure, TL-overview row shape), `tlAgg` (in-scope TLs), `campAgg` (CM campaigns) — RED
- [x] T033 [P] [US5] WP3 — verify-cm-view.mjs (part E): CM Reports offers Month to date, Daily, Weekly, Variance, Lead management (same renderers as the TL view); Lead management shows no Courtesy rows and a Courtesy-only TL is not offered the tab (uses `excludedCampaigns`) — RED
- [x] T034 [US5] WP2 — worker/src/portal.mjs: CM report rows/blocks
- [x] T035 [US5] WP3 — agent/index.html: CM_REPORT_TABS ×5 wired to the TL renderers over the CM rows; LM Courtesy handling in both views
- [x] T036 [US5] Run T032/T033 → GREEN (T002 already proves the engine-side exclusion)

---

## Phase 8: User Story 6 — TL Month to date: KPI verdicts + coaching analysis (P3)

- [x] T037 [P] [US6] WP2 — verify-cm-signoff-worker.mjs (part F): team-scope rows carry `drill` (same object as agentDetail me.drill) and `coach` {n,last,themes,after} per C4; `after` uses sales per worked day before/after the last session; null when no session — RED
- [x] T038 [P] [US6] WP3 — verify-cm-view.mjs (part F): TL Month to date shows per agent the six KPI states (identical to the agent's own tiles via the same drillState path) and the coaching analysis line ("No coaching logged this month" when none) — RED
- [x] T039 [US6] WP2 — worker/src/portal.mjs (+ a pure coachAnalysis() in worker/src/coaching.mjs)
- [x] T040 [US6] WP3 — agent/index.html pageMTD: KPI chips + coaching analysis
- [x] T041 [US6] Run T037/T038 → GREEN

---

## Phase 9: Polish & cross-cutting

- [x] T042 Independent review: ecc:code-reviewer + ecc:security-reviewer (new route, role scoping, params) + ecc:typescript-reviewer (ES5 page / ESM worker); fix CRITICAL/HIGH
- [x] T043 Full credential-free suite run (every suite in .github/workflows/verify.yml + the new ones); register verify-cm-digest, verify-coaching-wave, verify-cm-signoff-worker, verify-cm-view in verify.yml
- [x] T044 CLAUDE.md + constitution: record the LM exclusion, the billing-cycle keys and the coaching-wave budget (amend together, Governance)
- [x] T045 prepare-site → deploy Worker → deploy Pages → smoke (verify-cors-headers --live, verify-live-save --live)
- [x] T046 Republish (tick) → confirm cycle keys + `closed`; coaching snapshot fresh; quickstart.md §3 live checks as ryan and dalwin; verify-agent-card --live
- [x] T047 Commit (conventional message); do not push

---

## Dependencies & Execution Order

- Phase 2 blocks everything (WP1 `closed` feeds US1 conversion; cycle keys feed US3; coaching fix feeds US4/US6).
- Within a story: WP2 and WP3 tests can be written in parallel ([P]); WP3 implementation consumes WP2's
  contract, so WP3 builds against fixtures shaped exactly like contracts/interfaces.md.
- Story order for delivery: US1 → US2 → US4 → US3 → US5 → US6.

## Parallel execution

Three agents run concurrently, one per work package, each owning its files and suites:
- WP1 agent: T002, T004–T007 (+ its share of T011)
- WP2 agent: T003, T008–T010, T012, T014, T017, T019, T022, T024, T027, T029, T032, T034, T037, T039
- WP3 agent: T013, T015, T018, T020, T023, T025, T028, T030, T033, T035, T038, T040

## Implementation Strategy

MVP = Phase 2 + US1 + US2 + US4 (the figures and the coaching visibility the sign-off hinges on); US3, US5, US6
complete the list. Everything is deployed together once all suites are green, because go-live depends on the
whole CM view.
