# Implementation Plan: 034 — drop the coaching shortcut; count people, not rows

**Branch**: `034-cm-data-audit` | **Date**: 2026-10-13 | **Spec**: [spec.md](spec.md)

## Summary

Four small changes and one decision. Page: the campaign manager's "Team leaders' coaching" button goes (the view and
route stay). Worker: headcounts become distinct-by-CB in `campaign.mjs`; "Training…" campaigns are phases in
`moves.mjs`. Tool: `verify-cm-numbers.mjs` on the closed-leads basis with distinct counts. Data: the stale 8 Oct Agent
List batch — Nick decides (quickstart has the command).

## Technical Context

ES5 page (`agent/index.html`); Worker ESM (`campaign.mjs`, `moves.mjs`); Node tool; guards pure Node. No schema change.
The digest's segment rows (D4) are correct by design for movers; the defect is counting them as people, and a phase
treated as a campaign.

## Constitution Check

| Principle | Status | Note |
|---|---|---|
| I Engine decides | PASS | No figure recomputed on the page; the Worker counts, the engine publishes. |
| II Absence not nought | PASS | Nothing imputed; counts drop to the true number. |
| III Agent List is the record | PASS | This feature makes the view agree with the list; the stale upload is named, not papered over (D4 kept). |
| V Locked down | PASS | No route or role change. |
| VII Guards | PASS | Three suites extended red-first; live tool corrected. |

## Project Structure

```text
agent/index.html                         cmCoachNavHTML() → ''
worker/src/campaign.mjs                  distinct(): agg.agents, campaigns[].agents, all.agents, tenuresOf, agentIndex
worker/src/moves.mjs                     isPhase(camp): PHASE_CAMPAIGNS or /^training/i
tools/verify-cm-numbers.mjs              distinct agent counts; conversion on closed leads
nicks_code/diagnostics/verify-cm-view.mjs            C: no button; page by deep link
nicks_code/diagnostics/verify-cm-signoff-worker.mjs  new section N: counts over segment rows
nicks_code/diagnostics/verify-campaign-moves.mjs     Training is a phase
specs/034-cm-data-audit/                 spec · plan · tasks · quickstart
```

## Risks

- A manager may notice the headline drop from 98 to 76 — it is the list's number; the spec explains why.
- The 8 Oct correction changes attributed days for three agents (one Courtesy day each becomes Cuddle); sales totals
  per campaign move by those few sales — the true picture.
