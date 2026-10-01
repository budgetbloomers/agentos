# Implementation Plan: Campaign Manager view — sign-off list

**Branch**: `001-cm-view-signoff` | **Date**: 2026-10-01 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/001-cm-view-signoff/spec.md`

## Summary

Make the campaign-manager (CM) view of Agent OS sign-off ready for Ryan and Dalwin (QA capture tool excluded):
tenure + campaign + period (current / billing 26th–25th / past month) selection on the Campaign tab;
conversion on closed leads; talk time in hours against Courtesy 5 h / Cuddle 4.5 h; contact rate everywhere;
"Where my team leaders need help"; an in-app Team leaders' coaching page linked above Sign out (and the
coaching copy, frozen since 21 Sep by a subrequest overflow, refreshing again); all five analytics reports for
the CM with Courtesy out of Lead management; and agent-view KPI verdicts plus a rules-based coaching analysis
on the team leader's Month to date. The engine (PULSE) computes every new figure, the Worker scopes and serves
it, the page paints it.

## Technical Context

**Language/Version**: JavaScript — ES5 in the single-file pages (`agent/index.html`, `nicks_code/index.html`),
ESM (`.mjs`) in the Cloudflare Worker (`worker/src/`) and Node 24 tools.

**Primary Dependencies**: Cloudflare Workers + Pages (wrangler 4), Supabase (PostgREST + Storage), the Convex
Coaching Hub (read-only `/api/query`), Playwright (diagnostics + the headless republish tool).

**Storage**: Supabase `rules` rows (`kv:*` pointers) + Storage `raw/kv/*` blobs; no schema migration needed.

**Testing**: `nicks_code/diagnostics/verify-*.mjs` suites (Node; pages driven in a stubbed DOM or Playwright);
live suites with `--live`; tests written first.

**Target Platform**: Chrome/Edge on the floor; Cloudflare Worker FREE plan (10 ms CPU, 50 subrequests).

**Project Type**: web application (static pages + Worker API + headless engine publisher).

**Performance Goals**: CM selection change → figures on screen < 3 s (SC-002); Worker request within FREE plan
CPU (one digest parse per request, no re-aggregation from per-day rows).

**Constraints**: engines never run in the Worker; the live digest stays calendar-month; role scoping is
server-side; `site/` is generated.

**Scale/Scope**: ~130 agents, 11 team leaders, 4 active campaigns; 3 campaign managers; ~1,200 coaching
sessions in the snapshot.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | How this plan complies | Status |
|---|---|---|
| I Engine decides, page paints | Closed leads, billing-cycle figures and LM exclusion computed by PULSE; drill verdicts and coaching analysis computed in Worker rule modules (drill.mjs + a pure coaching-analysis function); talk targets in `specs/cm_rules.json` with `_changes[]` + drift guard; the page renders only. Nikola explains only. | PASS |
| II Absence ≠ nought | `closed: null` when case books are missing; conversion/contact blank with a reason; tenure "unset" shown, not dropped. | PASS |
| III Agent List is the record | Tenure and TL come from the digest rows (list-attributed); D4 segments unchanged; no new identity paths. | PASS |
| IV Like for like | Tenure selector is exactly the tenure-relative view. | PASS |
| V Locked down | New params/route honoured for `campaign_manager` only; scope from `effectiveCamps`; cm-coaching filtered server-side; no Supabase from the browser; all strings through `esc()`. | PASS |
| VI Saves | No new save path. Coaching refresh outcomes recorded + `coaching-stale` health warning. | PASS |
| VII Guards | New/extended suites per work package, red first; registered in verify.yml; live check after deploy. | PASS |

Post-design re-check (after contracts): PASS — no violations, Complexity Tracking empty.

## Project Structure

### Documentation (this feature)

```text
specs/001-cm-view-signoff/
├── spec.md · plan.md · research.md · data-model.md · quickstart.md
├── contracts/interfaces.md      # C1–C5, binding field names
├── checklists/requirements.md
└── tasks.md                     # /speckit-tasks output
```

### Source Code (repository root)

```text
nicks_code/index.html            # WP1 — PULSE engine: digest `closed`, cycle-safe payload, LM report rule
tools/digest-republish.mjs       # WP1 — publish kv:agent-digest-cycle-YYYY-MM (last complete + in progress)
specs/mtd_engine_rules.json      # WP1 — leadReportExcludeCampaigns + _changes[]
worker/src/campaign.mjs          # WP2 — tenure filter, conv on closed, talk targets, contact per team, blockPanelByCamp
worker/src/portal.mjs            # WP2 — period/tenure params, CM report rows, TL drill + coach per agent, cm-coaching body
worker/src/coaching.mjs          # WP2 — budgeted wave chunks + wave log
worker/src/health.mjs            # WP2 — coaching-stale warning
worker/src/index.mjs             # WP2 — routes / param validation
specs/cm_rules.json              # WP2 — talk_target_min_by_campaign (new, dated)
agent/index.html                 # WP3 — CM selectors/period, tiles, wording, coaching link + page, CM reports, TL MTD
nicks_code/diagnostics/verify-*  # each WP owns its suites (see tasks.md)
```

**Structure Decision**: the existing three-part layout (engine page → Worker → give-out page). Work packages
are split by FILE so three agents can build in parallel without touching each other's files; they meet only
at contracts/interfaces.md.

## Complexity Tracking

None.
