# Feature Specification: Campaign manager view — drop the coaching shortcut, and count the agents the Agent List counts

**Feature Branch**: `034-cm-data-audit` · **Created**: 2026-10-13 · **Status**: Findings complete; build in progress

**Input**: Nick, 2026-10-13 (screenshot of the sidebar's "Team leaders' coaching" button): "remove this team leader
coaching for campaign manager secondly for the campaign manager there soem team leaders not showing, please go through all
the stats and data displaying, make sure it is the correct data pulling from vas analytics"

## Findings (2026-10-13, live data, read-only)

- **Headline and team headcounts are wrong; the sales are right.** Dalwin's view says 98 agents (Courtesy 66, Cuddle 32,
  Denise 15, Dhamendra 14, Emmilio 14, Shane 17, Sharoma 6 + 32). The current Agent List (13 Oct, 120 rows) has **76** VAS
  agents (Courtesy 47, Cuddle 29; Denise 11, Dhamendra 11, Emmilio 12, Shane 13, Sharoma 29). The digest holds 98 ROWS
  for 76 agents: 16 agents appear twice or four times as dated **segment rows**, and the Worker counts rows as agents.
- **Why the segments exist: a stale Agent List was uploaded on 8 October.** The dated snapshots (`agent_list`) alternate
  between two workbooks: 1, 3, 5, 6 and **8 Oct** are an older sheet (the 13 new agents CB415–CB429 still in "Training
  Gr 17" under Ntokozo Mdletshe; CB173/CB262/CB303 still on Courtesy; team leaders Hezron Pillay, Kubenderan Govender,
  Renolan Pillay, Preston Gounden still listed), while 7, 9, 12 and 13 Oct are the current sheet. The campaign-moves feed
  (D4) reads the 8 Oct revert as real moves: CB173 Courtesy→Cuddle→Courtesy→Cuddle, CB415 Training→Courtesy→Training→
  Courtesy. "Training Gr 17" is not on the phase list (only "Nesting" is), so a graduation counts as a campaign move.
- **"Team leaders not showing" — none is wrongly missing on the current list.** Charlotte Govender (19) and Fabian Chetty
  (25) lead **VT**, which VAS Analytics does not report (VT never enters the digest). Ntokozo Mdletshe leads "Training Gr
  17" (a phase, not a campaign). Hezron, Kubenderan, Renolan and Preston appear only on the stale sheet. Preston Gounden
  and Ntokozo have team-leader accounts but no agents on the 13 Oct list.
- **Every figure that is not a headcount reconciles** (sales, GWP, cancellations, talk, attendance, QA) — the digest
  rows sum exactly to what the Worker serves; the segment rows carry each agent's days once. The conversion checks in
  `tools/verify-cm-numbers.mjs` fail only because that tool still asserts the pre-spec-001 basis (sales ÷ unique leads)
  while the Worker serves sales ÷ CLOSED leads (spec 001, decided 1 Oct).

## User Stories

### US1 — No "Team leaders' coaching" shortcut for campaign managers (P1)
The sidebar entry above the user card is removed for campaign managers; the Coaching Hub tab (spec 033) is the one
coaching entry. The page itself (`cm_coach`) and its Worker route stay (deep links keep working; nothing else moves).

### US2 — Headcounts count people, not rows (P1)
"98 agents" reads 76; Courtesy 50 / Cuddle 29 (the digest's distinct agents on each campaign); each team row counts an
agent once; a genuine mover counts once in the headline and once in each team he actually worked in; the tenure
picker's counts are people. Sales and every other total are unchanged.

### US3 — A training group is a phase, not a campaign (P1)
"Training Gr 17" (any campaign whose name starts with "Training") joins Nesting on the phase list, so a graduation into
Courtesy is not a move and a new starter's month stays whole under the campaign they graduated into.

### US4 — The stale 8 October list (P1, Nick's decision)
The 8 Oct snapshot is an older workbook re-uploaded. Two ways to put October right; the second needs Nick:
(a) correct the record: remove the 8 Oct `agent_list` batch (it adds nothing true), then let the next digest publish;
(b) leave it and accept CB173/CB262/CB303 showing one Courtesy day on 8 Oct. Prevention (follow-up): the list publisher
refuses a workbook whose fingerprint matches a list OLDER than the one in force.

### US5 — The recomputation tool tells the truth (P2)
`tools/verify-cm-numbers.mjs` counts distinct agents and checks conversion on the closed-leads basis, so a real
mismatch is not hidden among stale assertions.

## Requirements

- **FR-001** `cmCoachNavHTML()` renders nothing; `cm_coach` view, `/api/portal/cm-coaching` and their guards for the page
  itself stay; the guard that asserted the button asserts its absence.
- **FR-002** In `worker/src/campaign.mjs` every headcount is DISTINCT by CB: `agg().agents`, `campaigns[].agents`, the
  "All campaigns" `agents`, `tenuresOf()`, and `agentIndex` (one entry per code). Sums are untouched.
- **FR-003** `worker/src/moves.mjs`: a campaign is a phase when it is on `PHASE_CAMPAIGNS` **or** its name starts with
  "Training" (case-insensitive); `deriveMoves` ignores phase rows exactly as it ignores Nesting.
- **FR-004** The 8 Oct correction is NOT applied without Nick's word; the exact command is in quickstart.
- **FR-005** `tools/verify-cm-numbers.mjs`: agent counts compare distinct codes; conversion = sales ÷ closed leads
  (digest `closed`), null when no closed leads.
- **FR-006** Guards red first: verify-cm-view C (button gone), verify-cm-signoff-worker (distinct counts over a digest
  with segment rows), verify-campaign-moves (Training is a phase).

## Success Criteria

- Dalwin's header reads **76 agents** and the team rows read the Agent List's counts (after the Worker deploy and the
  next digest).
- `tools/verify-cm-numbers.mjs` passes on live data once the Worker is deployed (and fully once 8 Oct is corrected).
- No sales/GWP/talk figure changes by one unit.

## Out of scope

Showing VT or Training leaders in the campaign manager view (a product decision for Nick); the list-publisher refusal
rule (follow-up spec).
