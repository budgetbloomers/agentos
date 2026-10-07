# Implementation Plan: Custom date range for campaign managers' reports

**Branch**: `006-cm-custom-range` | **Date**: 2026-10-06 | **Spec**: [spec.md](spec.md)

## Summary

A range is a new kind of published period, built exactly like a billing month. The period key is
`range-YYYY-MM-DD-YYYY-MM-DD` (hyphens only, so the Worker's staff-only guard on `agent-digest(-[a-z0-9-]+)?` covers it).
Asking the Worker for an unbuilt range queues it in `kv:cm-range-requests` and answers 404 `range_building`; the laptop
tick (`tools/digest-republish.mjs`) builds every queued range through the engine's existing range mode
(`__mtd.setRange(from,to)` → `agentDigestPayload()`, `__mtd.reports('variance'|'leads')`) and publishes the digest and
both report payloads under the range's own keys; the Worker serves them. The page gets a "Custom range…" picker, a
"being built" state that re-checks every minute, and the Variance/Lead management reports follow the period.

## Technical Context

**Language/Version**: ES5 page; ESM Worker; Node tool (headless PULSE). **Storage**: `rules` + Storage, new keys
`kv:agent-digest-range-…`, `kv:agent-reports-variance-range-…`, `kv:agent-reports-leads-range-…`, `kv:cm-range-requests`.
**Testing**: extend `verify-cm-signoff-worker` (periods), `verify-digest-fence` (guard), `verify-cm-view` (picker),
`verify-cm-digest` (tool + engine range payload). **Platform**: Worker serves only (no sums); engine on the tick.

## Research (from the code map, 2026-10-06)

- R1 The engine already has a range mode: `__mtd.setRange(from,to)` (preset 'custom'); the payload's period is
  `{from,to}`, and the report payloads follow `M.range`. The tool adds `kind:'range'`, `key`, `label`.
- R2 Cycles publish straight to Supabase (Storage object + `rules` pointer `{store, period, kind}`); ranges do the same.
- R3 Guard: `GUARDED_KV` already matches `agent-digest-range-2026-09-01-2026-09-15`; the report keys need the regex widened
  to `agent-reports-(variance|leads)(-range-[0-9-]+)?`. (An underscore key would have been unguarded.)
- R4 The page's `cmValidPeriod`, `cmPeriodOptions` and the `tl/reports` route all reject or ignore a range today.

## Contracts

- **C1 period key** `range-<from>-<to>` (both `YYYY-MM-DD`): valid when from ≤ to, span ≤ 93 days, to ≤ today SAST,
  from ≥ 2025-01-01. `resolvePeriod` → `{kind:'range', key, from, to, label:'1 – 15 Sep 2026'}`; invalid → `bad_period`.
- **C2 unbuilt range** `GET /api/portal/overview?period=range-…` (campaign manager) → records `{key, from, to, by, at}`
  in `kv:cm-range-requests` (deduped by key, ≤ 20 waiting, > 7 days dropped) → 404
  `{error:'range_building', period, message}`; a refused build → 404 `{error:'range_refused', period, reason}`.
- **C3 built range** → the same 200 body as any period; `D.periods.ranges` lists built ranges `{key, from, to, label}`.
- **C4 reports** `GET /api/portal/tl/reports?kind=variance|leads&period=range-…` (campaign manager) → that range's report.
- **C5 tool** builds each waiting range (and rebuilds one whose `to` is within the last 2 days), publishes digest +
  reports + pointer `{store, period, kind:'range'}`, and writes back `{status:'built'|'refused', reason?, at}` per request.
- **C6 page** "Custom range…" → two date inputs + Apply (validated in the page with the same rules) → `cmAsk(key)`;
  `range_building` card re-asks every 60 s while shown; Variance/Lead management call `tl/reports` with the period.

## Constitution Check

| Principle | Status |
|---|---|
| I Engine decides | PASS — every range figure is built by the engine; the Worker serves |
| II Absence ≠ nought | PASS — an unbuilt range says "being built"; a refused one says why; never zeros |
| V Locked down | PASS — CM-only request; staff-only writes on range keys (guard widened for report keys) |
| VII Guards | PASS — four suites extended, red first |
| Platform constraints | AMEND — "Other periods are published under their own keys" gains `kv:agent-digest-range-…` (constitution MINOR + CLAUDE.md NN12) |

## Project Structure

```text
worker/src/portal.mjs     resolvePeriod (range), periodOf label, overviewRequest (queue + 404s), D.periods.ranges, loadReports(period)
worker/src/rules.mjs      GUARDED_KV widened for range report keys
worker/src/index.mjs      tl/reports ?period= for campaign managers
tools/digest-republish.mjs  RANGE-JOBS: read queue → setRange → publish digest + reports → write status
agent/index.html          cmValidPeriod, picker + date inputs, building card + retry, repLoad period
```

## Complexity Tracking

None.
