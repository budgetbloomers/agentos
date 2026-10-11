# Implementation Plan: Daily sales targets follow the Agent List

**Branch**: `feat/027-targets` (worktree `agentos-027`) | **Date**: 2026-10-11 | **Spec**: [spec.md](./spec.md)

## Summary

The engine's per-day target chain puts the rule-book table (`MTD_RULES.salesTargetMatrix`) BEFORE the Agent List
row's own Target, so Courtesy M1/M2/Exp read 3/4/5 while the 9 Oct list says 4/5/6. Fix: the list row's Target IN
FORCE THAT DAY is recorded in the effective-dated org history (`S.orgHist`, whole-month rule) and sits between the
campaign manager's override and the rule book, in PULSE, the Worker's `/api/roster`, Ops and the CM settings screen.
Months with no recorded list target (everything before October) keep the rule book exactly.

## Technical Context

PULSE (`nicks_code/index.html`, ES5-ish single file, engine in-browser) · Worker ESM (`worker/src/campaign.mjs`,
`index.mjs`) · Ops (`Chatterbox_AgentOS_Analytics.html`) · Agent Analytics (`agent/index.html`, paints the digest) ·
rule book `specs/mtd_engine_rules.json`. Tests: `nicks_code/diagnostics/verify-*.mjs` (Node + Playwright).

## Constitution Check

| Principle | How this plan holds it |
|---|---|
| I Engine decides | Targets are chosen in PULSE's engine (one function) and the Worker's `effPerDay`; pages paint. The rule book JSON and both mirrors carry the same precedence; drift guard extended. `_changes[]` entry dated 2026-10-11. |
| II Absence ≠ nought | A blank / text Target cell is "no list target" → the rule book, never 0. |
| III Agent List is the record | The list's Target becomes part of the org of record, at MONTH grain (recordOrgList), movers split by campaign (D4). |
| IV Like for like | Tenure groups unchanged. |
| V Locked down | No new route; `/api/roster` gains fields on an already-authenticated route; CM settings read stays role-gated. |
| VI Saves | The orgHist merge prefers the copy that carries list targets when segment counts tie, so a backfill is not lost to a race. |
| VII Guard | `verify-targets-027.mjs` written first (RED on the base), registered in verify.yml; existing guards updated. |

## Design

### D1 · The precedence (one chain, every engine)
`override exact → override campaign-wide → LIST (row in force that day, same campaign) → rule book exact → rule book
campaign-wide → current roster cell (legacy last resort, unchanged)`. Encoded as `TARGET_PRECEDENCE` /
`MTD_RULES.salesTargetPrecedence` / `reference_data.sales_target_matrix._precedence`, compared by the drift guard.

### D2 · Recording the list target (PULSE)
- `listTargetOf(v)`: a positive finite number (number or a plain numeric string, comma decimal allowed) else `null`
  (blank, `TBC`, `0`, text). Mirrored verbatim in the Worker; the guard runs both over the same inputs.
- `recordOrgList(code, asOf, {tl,campaign,tenure,target})` stores `target` (or omits it) on the month segment.
  Comparisons that decide whether a LIST segment is new (`prev`/`post` in recordOrgList, the dedupe loop in recordOrg)
  use `sameOrgT` = `sameOrg` + equal target, so October's segment survives beside an identical-org September one.
  recordOrg's own "nothing changed" check stays org-only (the tracker never speaks to targets).
- `listTargetAt(code, d)`: the last `agent-list` segment with `d ≤ day`; before the first list segment, the first one
  only when it is in the same month (a mid-month intake's whole month). Returns `{target, campaign}` or null.
- `perDayTarget(code, camp, tenure, d, a)`: the chain; the list value is used only when
  `campOf(seg.campaign) === camp` (a mover's days under another campaign never take this row's cell).
  Used by buildModel (per fact) and emptyMonthPayload (day = month start) — the two old copies of the chain go.

### D3 · Already-published lists (backfill)
The 9 Oct list is already in every state without targets. `adoptRosterFromRecord` on an UNCHANGED fingerprint
compares each record row's `list_target` with `listTargetAt(code, as_of)` and, where they differ, re-records the row
for the record's month (`recordOrgList` with the S.roster org) → rebuild. Runs only when the Worker serves
`list_target` (new Worker). The changed-fingerprint path maps `'Target': list_target ?? target` into the ingest.

### D4 · Worker
- `effPerDay(ctx, campaign, tenure, listFallback, listTarget)`; 5th arg = the list row's target IN FORCE (null = none).
- `rosterTargets(ctx, rows)` (exported, unit-tested) serves per row: `target` (current list month: override → list →
  book), `list_target` (raw cell, normalised), `rule_target` (old chain, what months BEFORE the list's month read).
  Payload: `targets_from` = the record's month, `targets_rev` = `'l1|' + cm:targets stamp` (moves when served
  targets move without a new list).
- What the Worker can and cannot do: it holds ONLY the current list. For the current list's month it serves the list
  target; for earlier months it serves `rule_target`. It cannot know an older list's cells for an older month — past
  months' figures come from PULSE's published period digests (`kv:agent-digest-YYYY-MM`), which the CM view serves
  unchanged. The CM view never computes a target: its figures are the digest's, so they equal PULSE's by construction.
- `cmSettingsBody(digest, user, ctx, listGroups)`: each row shows the list's value(s) for that campaign|tenure and
  `eff` = override ?? the single list value ?? rule book; list-only groups of a shown campaign get rows (e.g. Courtesy|M0).
  The settings GET reads `kv:roster-current` once to build `listGroups`.

### D5 · Ops
`syncRosterFromVAS` maps `Rule Target` and `Target From`, and re-syncs when `targets_rev` moves (hash =
fingerprint + rev). `acStats` uses `rule_target` for a window that ends before `targets_from`, else the served target.

### D6 · Upload Station warning (FR-004)
`listTargetWarnings(rows)` (pure): groups by campaign|tenure; flags a group with >1 distinct numeric value (values with
counts, blanks counted) and every non-numeric non-blank cell. INGEST.roster accumulates it on `S.rosterEffect.targets`
(per file, across sheets), the Agent List slot shows it as a neutral amber note, and a hand upload toasts it.
Wording: "Targets differ within a group — check this is intended: VT|M2 1.5 ×9, 2.5 ×2, 7 ×5 (2 blank → rule book)".
Never a refusal.

## Project Structure

```
specs/027-targets-follow-agent-list/{spec,plan,tasks}.md
specs/mtd_engine_rules.json                 # _precedence, _source, Sales Target note, _changes[]
nicks_code/index.html                       # MTD_RULES.salesTargetPrecedence, listTargetOf, sameOrgT, recordOrgList,
                                            # listTargetAt, perDayTarget, buildModel, emptyMonthPayload, INGEST.roster
                                            # warning, adoptRosterFromRecord backfill, orgHist merge, slot note
worker/src/campaign.mjs                     # TARGET_PRECEDENCE, listTargetOf, effPerDay, rosterTargets, cmSettingsBody
worker/src/index.mjs                        # /api/roster fields, settings GET list groups
Chatterbox_AgentOS_Analytics.html           # Ops: rule_target / targets_from / targets_rev
agent/index.html                            # CM settings: show the list value beside the rule book
nicks_code/diagnostics/verify-targets-027.mjs  # NEW guard (registered in verify.yml)
nicks_code/diagnostics/verify-cm-targets.mjs   # chain assertions updated to the new precedence
```

## Complexity Tracking

| Deviation | Why | Simpler alternative rejected because |
|---|---|---|
| Ops gets a per-window choice of two served targets | Ops has no org history; without it a September Ops window would read October's 4 | Serving one target changes Ops' past months (SC-002) |
| A backfill on the unchanged-fingerprint poll | The live list was ingested before this build; without it October stays on 3 until the next upload | Asking Nick to re-upload is a manual step the release would depend on |

## Known limits (review, 2026-10-11)

- **A re-loaded past list reprices its month.** "September unchanged" holds because the September list was recorded
  without targets. Re-uploading a September-dated list (or one with "effective from" in September) after this build
  records its Target cells for September — the same whole-month rule as campaigns and leaders.
- **Ops windows that straddle the list's month** (e.g. 15 Sep – 15 Oct) read the list's target for the whole window;
  Ops keeps one target per agent per window. A past month after a LATER list (October once November's lands) reads
  the served target too — PULSE's period digests carry the exact figure.
- **Old-build tabs** open across the deploy can win a state merge with a longer, target-less history; the next roster
  poll re-records the targets (a few extra saves, converging once old tabs reload).
- **The Data tab's inline Target edit** changes only the roster cell (the legacy last resort), not the month's list
  target — a target change goes through a list upload.
