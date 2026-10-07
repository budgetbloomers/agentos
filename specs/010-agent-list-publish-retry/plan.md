# Implementation Plan: Agent List publish — retry a passing failure, record a standing one

**Branch**: `010-agent-list-publish-retry` | **Date**: 2026-10-07 | **Spec**: [spec.md](spec.md)

## Summary

Two small changes on the existing path, no new store. The Worker's `POST /api/roster` wraps each
`publishAgentList()` call (plan and apply) in one retry on a THROWN error and, if the retry also throws, turns it into
the same `{status:'FAILED', stage:'server', reason, detail}` object the database's own refusals use — so the existing
refusal path records `kv:roster-refused` and answers 200 `{accepted:false, ...}`. The page's delayed publish becomes a
function that re-posts the same body up to two more times when the answer is no reply (non-2xx or network), and only
then calls `reportListRefused` with the attempt count.

## Contracts

- **C1 Worker** `publishOrFailed(opts)` → `publishAgentList(DB, raw, opts)`; on throw wait ~1.5 s and call once more;
  on a second throw return `{status:'FAILED', stage:'server', reason:'the database did not answer the publish',
  detail:<error text ≤ 300>}`. A returned (non-thrown) refusal is passed through untouched (FR-003).
- **C2 Worker answers** unchanged in shape: plan failure / apply failure → `recordRefusal` → 200 `{accepted:false,
  reason, stage:'server', detail, errors}`.
- **C3 page** `publishList(body, attempt)`; no reply → `setTimeout(publishList, LIST_RETRY_MS[attempt-1])` while
  attempt ≤ 2 (`window.__listRetryMs` overrides `[20000, 60000]` for tests); after the third → `reportListRefused({...,
  reason: '… (no reply after 3 attempts)'})`. The `adopted` / `S.rosterFp` / token guards are checked once, before the
  first attempt (FR-006).

## Constitution Check

| Principle | Status |
|---|---|
| III The Agent List is the record | PASS — the list still publishes only through publish_agent_list in one transaction; a retry re-runs that whole step |
| VI Saves acknowledged, noticed, recoverable | PASS — this is that principle applied to the list: a failure is retried, then recorded server-side, not only in one tab |
| VII Guards | PASS — verify-roster-of-record (Worker) and verify-roster-autoupdate (page) extended, red first |

## Project Structure

```text
worker/src/index.mjs                         POST /api/roster: publishOrFailed around both publishAgentList calls
nicks_code/index.html                        INGEST.roster's delayed publish → publishList with retries
nicks_code/diagnostics/verify-roster-of-record.mjs   database throws once → accepted; always → recorded refusal
nicks_code/diagnostics/verify-roster-autoupdate.mjs  POST fails once → retried, no notice; three times → notice with count
```
