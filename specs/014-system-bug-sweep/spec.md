# Feature Specification: System bug sweep (VAS · Ops · Agent Analytics · Wimpy · Worker · tools/tick)

**Feature Branch**: `014-system-bug-sweep`

**Created**: 2026-10-07

**Status**: Evidence gathering

**Input**: "go through the entire agent os system and fix all the bugs — use spec kit and /ecc:prompt-optimizer"

## Method

1. Evidence, read-only: every credential-free suite; the live health signals (alerts, every tick step, save failures,
   integrity); five independent code audits (Worker · VAS/PULSE · Ops · Agent Analytics + Wimpy · tools/tick), each
   finding with file:line, a concrete failure scenario and a confidence. Behaviour CLAUDE.md documents as intentional
   is not a bug.
2. Triage: CRITICAL and HIGH fixed now, each with a test that fails first; MEDIUM fixed where safe; LOW listed.
3. Independent review of the fixes; every suite green; release and commit only with Nick's go-ahead.

Out of scope: redesigns, rule changes Nick has decided, live data writes.

## Live evidence (2026-10-07 10:42 UTC, read-only)

- E1 `nba-digest` tick step FAILS every run; its note is only " | Node.js v24.18.0" — the real error is lost.
- E2 `lake-load` tick step FAILS the same way — the database's call history (`vici_calls`) stops at 26 Sep.
- E3 `ops-relay` FAILED while Ops' ViciDial store could not save (400 "Memory limit") — fixed by spec 013 (live
  10:37); to be confirmed on the next relay.
- E4 6 × "vas vas-state → replay 425" + 1 × 409 write_in_progress in 24 h (aarav, avesh): two tabs saving at once;
  the reload during the other tab's write gets 425 and is reported as a failure.
- E5 Integrity view all 0; no locked accounts; custom ranges building (range-2026-10-01-2026-10-07 built).

## Findings

(filled from the suite run and the five audits — see tasks.md)

## Requirements *(mandatory)*

- **FR-001**: Every confirmed CRITICAL/HIGH defect MUST be fixed with a test that fails before the fix and passes after.
- **FR-002**: No fix may change a rule or a figure CLAUDE.md fixes as intentional.
- **FR-003**: Every credential-free suite MUST pass after the sweep (known pre-existing failures named, not hidden).

## Success Criteria *(mandatory)*

- **SC-001**: The tick's failing steps run green (or fail with their real error recorded).
- **SC-002**: No save failure class in the last 24 h remains unexplained.
