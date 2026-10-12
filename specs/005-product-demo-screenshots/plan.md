# Implementation Plan: Product demo screenshots

**Branch**: `005-product-demo-screenshots` | **Date**: 2026-10-06 | **Spec**: [spec.md](spec.md)

## Summary

One fictional floor (34 people: 1 campaign manager, 4 team leaders, 29 agents on Courtesy, Cuddle and Nesting; August
and September 2026) is loaded into the REAL VAS Analytics engine (`nicks_code/index.html`, `window.__mtd`), which renders
every page and also builds the agent digest and the team-leader report payloads. The REAL Worker functions
(`worker/src/portal.mjs`, `hubs.mjs`, `drafts.mjs`, `campaign.mjs`, `coaching.mjs`) turn that digest into Agent
Analytics' answers over an in-memory database; Playwright serves both pages locally, answers every API call from those
functions, and captures each page in demo order to `C:\Users\aarav\Downloads\Chatterbox Demo Screenshots`. Outside
services the Worker would call (HighLevel, Convex, Workers AI) get fictional answers in-process; nothing leaves the
machine.

## Technical Context

**Language/Version**: Node 24 ESM tool; the two pages are unchanged.
**Primary Dependencies**: Playwright 1.62 (`nicks_code/diagnostics/node_modules`), `page.clock` pinned to Tue 29 Sep 2026 09:30 SAST.
**Storage**: none — an in-memory `rules` table per run; PNGs to the Downloads folder.
**Testing**: the run itself asserts each shot (no page error, no spinner/empty/error card, no live-roster name or CB);
a leak check against the real Agent List on disk (read locally, never printed).
**Target Platform**: this laptop (Windows), headless Chromium 1440×900, full-page PNG.
**Constraints**: no network except Google Fonts; no live data; no deploy; the generated `site/` is not used (its stale-
version banner would show).
**Scale/Scope**: ~15 VAS pages (+ sub-tabs) and ~30 Agent Analytics views → roughly 60–70 screenshots.

## Constitution Check

| Principle | Compliance | Status |
|---|---|---|
| I Engine decides | Every figure on every shot is computed by the real PULSE engine and Worker code from the fictional floor | PASS |
| II Absence ≠ nought | The floor is complete for the month, so no page shows an empty state | PASS |
| III Agent List is the record | The fictional roster is the identity base for both apps | PASS |
| V Locked down / PII | No live data is read or shown; fictional names checked against the real list; output stays local | PASS |
| VII Guards | The run fails loudly on any page error, empty state or name leak | PASS |

## Project Structure

```text
specs/005-product-demo-screenshots/   spec · plan · research · tasks · checklists
tools/demo-screenshots.mjs            the one command (orchestrator: folder, numbering, both apps)
tools/demo/floor.mjs                  the fictional floor (deterministic) → PULSE state
tools/demo/pulse.mjs                  VAS Analytics: serve, inject, walk every page and sub-tab, export digest + reports
tools/demo/agent.mjs                  Agent Analytics: Worker functions over an in-memory DB + fake HighLevel/Convex, walk
                                      the team leader, agent and campaign manager views and the coaching flow
```

## Complexity Tracking

None.
