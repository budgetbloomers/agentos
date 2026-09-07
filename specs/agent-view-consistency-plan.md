# One number, one verdict — the agent view can never contradict itself

Nick, 2026-09-07, after Jolene's card read "At target" in the rating row and "R 0,01 to go —
VALUE ISSUE" in the panel beneath it, and Conversion read "shown, not scored" for 75 agents:
"create me an implementation plan for this problem not to happen again."

## What went wrong, precisely

| Symptom on the card | Cause | Class |
|---|---|---|
| Rating row: Avg GWP R 86,08 of R 86,08, at target. Two-checks panel: R 86,08 against R 86,09, to go | The page computed the ex-VAT floor itself (99 ÷ 1.15 = 86,0869) while the engine floors to the cent Salesforce books (86,08). Third copy of the same constant to drift | **Re-derivation** — a client recomputing what the engine already decided |
| Conversion "shown, not scored" for every agent | A rule-book gate (score from the 5th data day) that the card explained but the reader did not expect | **Policy invisible at the point of change** |
| 3 Sep: "To go" at 25/25 for 30 agents | The same floor constant, second copy, in the Ops engine | Re-derivation |
| 2 Sep: September commission model rewrote August | A constant table without a date on it | Policy invisible |

Every case is one of two things: **a number derived in more than one place**, or **a rule that
changed without a visible trace**. The plan makes both impossible by construction, then proves it
nightly for every agent.

## The principle

1. **The engine decides, the page paints.** Every figure, target, pass/fail verdict and explanatory sentence an agent sees travels in the digest. The agent page and the Worker portal render fields; they never divide, round, compare or gate.
2. **One constant, one source, one drift check.** Every rule-book value lives in a spec file with an inline mirror, and a generic drift test iterates every key — a constant cannot be added to one copy only.
3. **A rule change is a dated event, not an edit.** Every change carries who, when and why, and the apps show it.
4. **Prove every card, every night.** A suite renders every agent's card from the live digest and asserts it agrees with itself and with the engine.

## Phase 0 — BUILT 7 Sep (Worker version ab6ee327, site build mtr92q4s)

| Function | Where | What it does |
|---|---|---|
| Verdicts in the payload — built in the Worker, not the digest publisher: `checksFor()` in `worker/src/rules.mjs`, attached by `portal.mjs` to `me` (agent scope) and `me` (agent-detail) | Each agent row gains `checks: { value: {aveG, floorEx, pass}, volume: {pct, line, pass} }`; composite parts already carry `onTarget`, `measured`, `shown`, `shownNote`. The page reads `pass` and stops computing `aveG >= floor` |
| `gwpFloorEx` removed from clients | `agent/index.html` | The ex-VAT floor is published once (`thresholds.gwpFloorEx`, floored to the cent) and read from the payload; the agent page no longer divides. Ops keeps its copy because Ops is an ENGINE (it scores its own composite), not a page painting someone else's verdict — its copy is drift-checked, not deleted |
| `verify-agent-card.mjs` — 1 014 checks green on 7 Sep over all 84 rated agents on the deployed page | diagnostics | Renders EVERY agent in the live digest headlessly and asserts: the score on screen equals the digest score; every rating-row verdict equals its part's `onTarget`; the two-checks verdicts equal `checks.*.pass`; a figure shown in two places carries the same value and target in both; Conversion shows a value whenever `leads > 0`; sessions rows equal `days`. Added to the nightly verify job |
| No client arithmetic — live | `verify-rule-constants.mjs` | Fails on any `/1.15`, `*1.15` or `99` literal in `agent/index.html` and `worker/src/portal.mjs` outside a rules block — the rule PULSE already lives under |

## Phase 1 — BUILT 7 Sep (generic drift over every scalar key of composite_rules.json; rules.mjs holds VAT, the floor, checksFor and expectedReachFor; _changes[] in both spec files, refused when empty)

| Function | Where | What it does |
|---|---|---|
| Generic drift check — composite done; the engine spec is nested so its suite still walks named sections | `verify-composite-score.mjs` | Iterate every key of `specs/mtd_engine_rules.json` and `specs/composite_rules.json` against the inline mirrors instead of a hand-kept list — a key present in one copy and not the other fails |
| `rules.mjs` shared module | `worker/src/rules.mjs` | `expectedReachFor`, `gwpFloorEx`, `saturdayDataOnly`, `workingDays` live once for the Worker and the tools; PULSE's inlined copies are drift-checked against it by text |
| Rule-book `_changes[]` | both spec files | Every change appends `{date, by, key, from, to, why}`; the drift check refuses a value change without an entry |

## Phase 2 — the change is visible where it bites (2 days)

| Function | Where | What it does |
|---|---|---|
| "Rules changed" strip | Agent Analytics, VAS Manual page | Reads `_changes[]` from the digest and shows the last three within 14 days: "Since 7 Sep, Conversion counts from the first day of the month" — a moved score has its reason next to it |
| `shownNote` everywhere | engine | Every part that is not measured, or measured under a special rule, carries the engine's one-sentence reason; the page never invents one |
| "Is this right?" | Agent Analytics card | One button posts the rendered card and its digest row to `card_reports`; team leaders and Nick see them in Settings. The people who look at these numbers all day become the last test |

## Phase 3 — the port that cannot drift (later)

| Function | What it does |
|---|---|
| Commission calculator reference | Already equivalence-tested against the original on 15 444 cases — the model for everything else |
| Ops ↔ PULSE reconciliation register | Extend `verify-vas-mtd` to assert the same agent-day reads the same in both engines wherever the two models are meant to agree, and to name the deliberate differences (§9b) so a new one cannot hide among them |

## Acceptance — what "cannot happen again" means

| Condition | Guard |
|---|---|
| Two verdicts for one figure on one card | `verify-agent-card` fails nightly; the page has no arithmetic to disagree with |
| A constant with a second definition | `verify-rule-constants` fails on the literal; the generic drift check fails on a missing key |
| A rule changed silently | The drift check refuses a change without a `_changes[]` entry; the strip shows it within the day |
| A card wrong for one agent only | Every agent is rendered every night, not a fixture of one |

## What Nick decides

1. Whether the "Is this right?" button belongs on the agent card (it invites reports; it also invites noise).
2. Whether the "Rules changed" strip shows to agents, or only to team leaders and managers.

## One thing the suite deliberately does NOT assert

The rating row (last five worked sessions) and the two checks (the whole month) are two windows, both true — the card says so in words. The first draft of `verify-agent-card` compared them and failed 2 of 3 agents; the comparison was wrong, not the card. A future suite must never "fix" that by making the two windows agree.
