# Implementation Plan: Live month, scheduled referrals, fresh and complete coaching

**Branch**: `002-live-month-sync-coaching` | **Date**: 2026-10-01 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/002-live-month-sync-coaching/spec.md`

## Summary

(1) Publish the current month live even before its first data, as an honest empty payload, with the previous
month one click away as "(final)"; (2) refresh referrals at 08:00 and 14:00 SAST every day through the local
tick (headless sync tool → `kv:referrals-latest` → digest + every PULSE tab), logged and watched; (3) a forced
daily Coaching Hub pull from 05:30 SAST plus a freshness stamp on every coaching surface; (4) attribute coaching
to the agent's current team leader by CB, count lead-management coaching separately, show lead-management
themes, and say plainly when none was logged.

## Technical Context

**Language/Version**: ES5 pages (`agent/index.html`, `nicks_code/index.html`); ESM Worker (`worker/src`); Node 24 tools.

**Primary Dependencies**: Cloudflare Workers + Pages, Supabase (PostgREST + Storage), Convex Coaching Hub
(read-only), HighLevel via the Worker's existing `/api/referrals`, Playwright (headless engine + suites).

**Storage**: `rules` pointers + Storage `raw/kv/*`; new keys `kv:referrals-latest`, `kv:referrals-sync-log`.

**Testing**: `nicks_code/diagnostics/verify-*.mjs`, tests first; live checks after deploy.

**Target Platform**: Cloudflare FREE plan (10 ms CPU, 50 subrequests); the local tick (Task Scheduler, every 15 min).

**Project Type**: web application (engine page → Worker → give-out page) + local publisher.

**Constraints**: engines never in the Worker; absence ≠ nought; no older month on the live key; scoping in the Worker.

**Scale/Scope**: ~130 agents, 11 TLs, 3 CMs; ~1,400 coaching sessions; referrals ≥ 1,700 rows.

## Constitution Check

| Principle | Compliance | Status |
|---|---|---|
| I Engine decides | Empty payload, referral ingest and the digest are built by the PULSE engine (headless); the Worker only fences/serves; coaching attribution in Worker rule code | PASS |
| II Absence ≠ nought | Empty month = null figures + "No October figures yet"; no zero rows | PASS |
| III Agent List is the record | Coaching attributed to the agent's CURRENT TL from the list/digest; referrals matched by the existing `_refStore` | PASS |
| V Locked down | Minted admin session is short-lived and deleted; HighLevel secrets stay in the Worker; `/api/kv` GET allow-list extended for one key; CM coaching scope unchanged | PASS |
| VI Saves | Referrals adopted by PULSE through its normal compare-and-set save; newer manual sync wins; runs logged + `referrals-slot-missed` | PASS |
| VII Guards | New suites per WP, red first, registered in verify.yml; live checks | PASS |
| Platform | Rollover grace kept (an older month still never takes the live key); new fence `empty_over_data` | PASS — CLAUDE.md + constitution amended (live month rule) |

## Project Structure

```text
specs/002-live-month-sync-coaching/  spec.md · plan.md · research.md · contracts/interfaces.md · tasks.md · checklists/
nicks_code/index.html        # WP-A: emptyMonthPayload; adopt kv:referrals-latest (boot/focus/poll); headless ingest hook
tools/digest-republish.mjs   # WP-A: publish empty current month (no previous-month fallback) + previous month final; ingest referrals-latest
tools/sync-referrals.mjs     # WP-A (new): mint session → /api/referrals?fresh=1 → kv:referrals-latest + sync log
tools/tick-local.mjs         # WP-A: referrals step at 08:00/14:00 SAST every day, before agent-digest
worker/src/{rules,index,health,coaching,portal,hubs}.mjs   # WP-B: fence, kv allow-list, referrals-slot-missed, 05:30 pull, attribution, coachingAt, LM types/themes, hub 'others'
agent/index.html             # WP-C: empty-month states + (final) link; first-payout at 0 days; coaching stamps, LM counts/themes, 'others' block
```

**Structure Decision**: three disjoint work packages, built in parallel against contracts/interfaces.md.

## Complexity Tracking

None.
