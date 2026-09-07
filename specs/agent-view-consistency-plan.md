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

## Phase 0 — build now (1 day)

| Function | Where | What it does |
|---|---|---|
| Verdicts in the digest | `agentDigestPayload` (PULSE) | Each agent row gains `checks: { value: {aveG, floorEx, pass}, volume: {pct, line, pass} }`; composite parts already carry `onTarget`, `measured`, `shown`, `shownNote`. The page reads `pass` and stops computing `aveG >= floor` |
| `gwpFloorEx` removed from clients | `agent/index.html`, Ops | The ex-VAT floor is published once (`thresholds.gwpFloorEx`, floored to the cent) and read everywhere; the two client copies are deleted |
| `verify-agent-card.mjs` | diagnostics | Renders EVERY agent in the live digest headlessly and asserts: the score on screen equals the digest score; every rating-row verdict equals its part's `onTarget`; the two-checks verdicts equal `checks.*.pass`; a figure shown in two places carries the same value and target in both; Conversion shows a value whenever `leads > 0`; sessions rows equal `days`. Added to the nightly verify job |
| No client arithmetic | `verify-rule-constants.mjs` | Fails on any `/1.15`, `*1.15` or `99` literal in `agent/index.html` and `worker/src/portal.mjs` outside a rules block — the rule PULSE already lives under |

## Phase 1 — one source for every constant (2 days)

| Function | Where | What it does |
|---|---|---|
| Generic drift check | `verify-engine-rules.mjs`, `verify-composite-score.mjs` | Iterate every key of `specs/mtd_engine_rules.json` and `specs/composite_rules.json` against the inline mirrors instead of a hand-kept list — a key present in one copy and not the other fails |
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
