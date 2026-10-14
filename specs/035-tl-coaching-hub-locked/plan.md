# Implementation Plan: 035 — the team leader's Coaching Hub tab, locked to their own workspace

**Branch**: `035-tl-coaching-hub-locked` | **Date**: 2026-10-14 | **Spec**: [spec.md](spec.md) | **Status**: PLAN (not started)

## Summary

Two work packages. **WP-H (the Hub repo, `budgetbloomers/coaching-hub`)**: a leader mode (`?leader=<hubId>`) that pins
the app to one workspace and hides the directory controls; a `submitted` state on the six coaching tables with Save
draft / Submit semantics and a locked-line rendering for submitted documents in leader mode. **WP-A (this repo)**: the
team-leader tab becomes the embedded Hub (spec-033 machinery with a per-user URL), the Worker exposes the leader's Hub
id, a one-off tool carries existing Worker drafts into the Hub, the native forms retire in a follow-up once verified.

## Technical Context

Hub: Vite + React 19 + react-router 7 + Convex (schema in `convex/schema.ts`, ten tables, no status fields today) — live
source is GitHub branch `live-source-2026-10-13` (merge to main first). Agent Analytics: ES5 page + Worker ESM. Guards:
pure Node suites; the Hub repo gets a minimal vitest for the mode/redirect and submit rules.

## Constitution Check

| Principle | Status | Note |
|---|---|---|
| I Engine decides | PASS | No figures; coaching documents only. |
| III Agent List is the record | PASS | The leader's roster (for "by others") comes from the digest/Agent List, not the Hub's team-leader table. |
| V Locked down by default | **PASS with a named exception** | The lock is client-side in a public app — Nick's standing decision for the Hub (spec 004 note); Q1 records it. The Worker never proxies or weakens anything; the Agent Analytics session is never shared with the frame. |
| VI Saves acknowledged | PASS | Hub saves are its own; drafts in the Hub replace drafts in the Worker after a verified migration. |
| VII Guards | PASS | Hub vitest (new), verify-tl-hub (new), existing suites adjusted; real-browser walk as a leader is the acceptance. |

## Project Structure

```text
Hub repo (WP-H)
  src/main.tsx                         read ?leader=, remember for the session (like theme)
  src/lib/mode.ts (new)                leaderId(), isLeaderMode()
  src/App.tsx                          <Navigate> rules: '/' and foreign /workspace/:id → own dashboard in leader mode
  src/components/Sidebar.tsx           no back-to-home in leader mode
  src/pages/Home.tsx                   redirect in leader mode (never renders)
  convex/schema.ts                     submitted?: boolean, submittedAt?: string on the six coaching tables
  convex/<six products>.ts             create/update take submitted; submit(id); update/remove refuse submitted when leaderMode
  src/forms/*Form.tsx                  Save draft / Submit buttons; signature-clearing rule
  src/components/SessionList.tsx       drafts openable; submitted = locked line in leader mode
  src/views/*View.tsx                  redirect when submitted && leader mode
  tests/ (vitest, new)                 mode, redirects, submit guards (pure)

AgentOS (WP-A)
  worker/src/portal.mjs                team-leader overview: hubId from user.hub_ids.coaching
  agent/index.html                     coach_team → frame (generalise cmHubEnsure/Sync/Hide/Drop to take a URL + host id)
  tools/migrate-worker-drafts.mjs      coach-draft:* → Hub drafts (dry-run default)
  tools/map-hub-ids.mjs                exact-name match for Charlotte Govender
  nicks_code/diagnostics/verify-tl-hub.mjs (new) · verify-agent-analytics · verify-coaching-drafts (adjust)
```

## Sequencing

1. Merge `live-source-2026-10-13` into Hub main (the live code) — prerequisite for every Hub change.
2. WP-H part 1 (leader mode + redirects, no data change) → deploy → WP-A (frame on the TL tab behind a feature flag per
   account, so one leader can trial it while the others keep the native tab).
3. WP-H part 2 (submitted state, Save/Submit, locked lines) → deploy → migrate Worker drafts → flip all leaders → retire
   the native forms (follow-up spec).

## Risks

- Convex schema change on live tables: additive (optional fields), deployed with `npx convex deploy` from the Hub repo;
  existing rows read as submitted — a leader's old documents stay locked, as today.
- Storage partitioning: `leader` is remembered in the frame's own session storage; a refresh inside the tab keeps it.
- A leader without a Hub id (Charlotte) gets words, not a frame, until mapped.
- Effort: WP-H ≈ 1.5–2 days, WP-A ≈ 0.5 day, migration + verification ≈ 0.5 day.
