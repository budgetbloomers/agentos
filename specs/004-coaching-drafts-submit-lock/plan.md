# Implementation Plan: Coaching drafts with a submit lock

**Branch**: `004-coaching-drafts-submit-lock` | **Date**: 2026-10-05 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/004-coaching-drafts-submit-lock/spec.md`

## Summary

Coaching documents become drafts first: a team leader saves, reopens, edits and deletes drafts kept by the Worker
(one `rules` row per draft, owner = the session's user id, compare-and-set on `updated_at`). Submit sends the draft to
the Coaching Hub through the existing create exactly once (state `submitting` claimed by compare-and-set, row deleted on
success, restored on failure). After submit the document is a line, never a document, for team leaders: the Worker
strips written content from every team-leader coaching payload (live list, agent drill-in, "by others", help-center
theme story) and the page drops View/Notes and the "edit in the Hub app" invitation. Signatures may be drawn on a
draft and are saved with it; any content change clears them (page) and a stale signature beside changed content is
dropped (Worker). Delivered together with feature 003, whose signature fix it depends on.

## Technical Context

**Language/Version**: ES5 page (`agent/index.html`); ESM Worker (`worker/src`).

**Primary Dependencies**: Cloudflare Workers + Pages; Supabase PostgREST (`rules` table); Convex Coaching Hub (create).

**Storage**: `rules` rows `coach-draft:<user_id>:<uuid>` — `value {v:1, meta, data}`, `updated_at` = version. No DDL.

**Testing**: new `nicks_code/diagnostics/verify-coaching-drafts.mjs` — drafts.mjs against an in-memory PostgREST fake,
hubs/portal/help leader stripping with stubbed fetch, the page in a stubbed DOM; red first; registered in verify.yml.

**Target Platform**: Cloudflare FREE plan — per request ≤ 4 Supabase calls + 1 Convex call (submit); no fan-out.

**Project Type**: web application (page → Worker → Supabase / Convex).

**Constraints**: drafts readable only by their owner; no team-leader payload carries submitted written content;
signatures never in a list payload; exactly-once submit.

**Scale/Scope**: ~10 team leaders, ≤ 50 drafts each, ≤ 1.5 MB per draft.

## Constitution Check

| Principle | Compliance | Status |
|---|---|---|
| I Engine decides, page paints | No figures; the lock is decided in the Worker, the page only paints what it is sent | PASS |
| II Absence ≠ nought | A missing signature reads "Not signed by …"; a draft with no agent reads "(no agent yet)" | PASS |
| III Agent List is the record | Agent chosen from the leader's roster as today; no identity change | PASS |
| V Locked down | Drafts keyed by the SESSION's user id, outside `kv:`; team_leader-only route added to the portal allow-list; written content stripped server-side on every leader route; all text through `esc()` | PASS |
| VI Saves acknowledged | Draft saves compare-and-set (409, never overwrite); dirty state + Save draft message; submit failure keeps the draft | PASS |
| VII Every rule has a guard | `verify-coaching-drafts.mjs` red first, in CI | PASS |
| Platform | No migration, no new subrequest fan-out, `site/` via prepare-site | PASS |

Re-checked after design: PASS. Deviation recorded in research R6 — the Hub app stays reachable (outside our control).

## Project Structure

```text
specs/004-coaching-drafts-submit-lock/  spec · plan · research · contracts/interfaces · quickstart · tasks · checklists
worker/src/drafts.mjs     # NEW: list/open/save/delete/submit/reopen (D1–D6), signature rule R5
worker/src/coaching.mjs   # COACH_TEXT_FIELDS + withoutText() (R4); callNotes (003)
worker/src/hubs.mjs       # leaderRow() allow-list for the live list (L1); 003 _sigs + refusal; export SIG fields per table
worker/src/portal.mjs     # route allow-list + agentDetail/coachingOthers leader stripping (L2)
worker/src/help.mjs       # failDetail note '' for team leaders (L2)
worker/src/index.mjs      # /api/portal/hub/coaching/drafts route
agent/index.html          # 003 sigPad fix; drafts card, Save draft/Submit/Delete, locked rows, signature clearing, footer
nicks_code/diagnostics/verify-coaching-drafts.mjs     # NEW (004)
nicks_code/diagnostics/verify-coaching-signature.mjs  # NEW (003)
.github/workflows/verify.yml
```

**Structure Decision**: Worker first (contracts are the interface), then the page; both suites written before code.

## Complexity Tracking

None.
