---

description: "Task list — 034 drop the coaching shortcut; count people, not rows"
---

# Tasks: 034

**Tests**: REQUIRED, red first (Constitution VII).

**Status 2026-10-13**: T001–T008 done (verify-cm-view 165/165, verify-cm-signoff-worker 261, verify-campaign-moves 26,
verify-cm-digest 139, verify-campaign-split 153, verify-agent-analytics 174, verify-live-month-page 75, verify-empty-month
44, verify-targets-027 82); committed 5ffaf37; T009–T011 open (deploy, the 8 Oct batch, final live run of the tool).

## Phase 1 — Tests (RED)
- [x] T001 verify-cm-view C: the CM sidebar has NO `data-view="cm_coach"` button and no "Team leaders' coaching" text;
  `setView('cm_coach')` still renders the page (deep link); other roles unchanged
- [ ] T002 verify-cm-signoff-worker new section N: a digest where CB7 has two Courtesy segment rows (same tl) and CB8 has
  a Courtesy row + a Cuddle row (mover) → all.agents counts each once; Courtesy.agents counts CB7 once; CB8 once in
  Courtesy and once in Cuddle; the team row counts CB7 once; tenures count people; agentIndex has unique codes; sales
  sums unchanged
- [ ] T003 verify-campaign-moves: rows Training Gr 17 (1 Oct) → Courtesy (7 Oct) → Training Gr 17 (8 Oct) → Courtesy
  (9 Oct) derive NO mover; Nesting still a phase; a real Courtesy→Cuddle move still derives

## Phase 2 — Build (GREEN)
- [ ] T004 agent/index.html `cmCoachNavHTML()` returns ''
- [ ] T005 worker/src/campaign.mjs distinct headcounts (FR-002)
- [ ] T006 worker/src/moves.mjs `isPhase()` (FR-003)
- [ ] T007 tools/verify-cm-numbers.mjs: distinct counts + closed-leads conversion (FR-005)
- [ ] T008 Suites green: verify-cm-view, verify-cm-signoff-worker, verify-campaign-moves, verify-cm-digest,
  verify-agent-analytics, verify-live-month-page

## Phase 3 — Release + data (Nick)
- [ ] T009 Deploy Worker (`cd worker && npx wrangler deploy`) and Pages (`prepare-site` + `wrangler pages deploy`);
  smoke; `tools/verify-cm-numbers.mjs` live
- [ ] T010 Nick decides the 8 Oct batch (spec US4). If (a): run the quickstart command, then `tools/digest-republish.mjs`
  (or wait for the tick) and re-run `tools/verify-cm-numbers.mjs`
- [ ] T011 Commit; memory note
- [ ] T012 FOLLOW-UP (tool only): `tools/verify-cm-numbers.mjs` rebuilds a mover's segment rows with its own `campView()`,
  written before the Worker's `bySegment()` splitter (portal.mjs); on live data the Worker's conversion equals its own
  closed-row sales ÷ closed leads exactly (checked 13 Oct: all 3430/8920, Courtesy 1431/3647, Cuddle 1999/5273) while
  the tool's reconstruction gives different closed-row sales. Make the tool import `bySegment` and walk the Worker's
  rows; until then its conversion lines are the tool disagreeing with itself, not with the data
