# Implementation Plan: 037 — the campaign manager's Referrals card

**Branch**: `feature/campaign-manager-theme-wimpy` (the live branch) | **Date**: 2026-10-15 | **Spec**: [spec.md](spec.md)

## Summary

Two files and two guards. `worker/src/campaign.mjs` `agg()` already sums `ref`; it gains a distinct-people set and
`cmOverviewBody` adds `kpis.referrals` to each campaign and to All campaigns. `agent/index.html` `cmCmdPage` paints one
more `kpi()` card after Attendance. No new data, no new route, no schema change.

## Constitution Check

| Principle | Status | Note |
|---|---|---|
| I Engine decides, page paints | PASS | The figure is the Worker's; the page only formats it. |
| III Agent List is the record | PASS | Rows are the digest's; headcount is `peopleIn` (distinct CBs). |
| V Locked down | PASS | Same `authorise()` scope; nothing new is served. |
| VII Guards | PASS | `verify-cm-signoff-worker` + `verify-cm-view`, red first. |

## Sequencing

1. Guards red (`--guards` run of the edit script) → 2. Worker + page → guards green → 3. full CM suites, `/ecc:code-review`
→ 4. `wrangler deploy` (worker/) + `prepare-site` + `pages deploy` → 5. live check on the deployed page.

## Risks

- A digest built before the referrals feed existed carries `ref: 0` on every row — the card reads 0 with "0 of M agents",
  which is the truth of that digest. Distinguishing "feed never ran" would need a digest-level stamp the digest does not
  carry today; noted, not built.
