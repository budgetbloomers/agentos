---
description: "Tasks — 016 the refresh runs on a server, not on Nick's PC"
---

# Tasks: The refresh runs on a server (016)

**Tests**: required; each RED first. Tests stub every network call (no live writes). The server is touched only after
Nick sends its IP and says go. Never print, log or commit a credential.

## Phase 1: Setup

- [ ] T001 Create nicks_code/diagnostics/verify-runner-016.mjs (stubbed PostgREST for `rules` rows kv:runner-lease and
  kv:jobs-status) and register it in .github/workflows/verify.yml

## Phase 2: User Story 2 — never two runners at once (P1)

- [ ] T002 [US2] Tests + tools/runner-lease.mjs: acquire when absent; refuse while held and unexpired; take over an
  expired lease by compare-and-set; renew; release; two racing acquirers → exactly one wins
- [ ] T003 [US2] tools/tick-local.mjs acquires the lease after deciding to run; a held lease → one logged stand-down,
  no steps, no stamps; renew on the heartbeat; release in finally

## Phase 3: User Story 1 — fresh with the PC off (P1)

- [ ] T004 [US1] [US2] Tests + roles in tools/tick-local.mjs: `--role server` runs on the FR-001 rules; `--role pc`
  (Windows default) runs only when the newest stamp is > 20 min old or a referrals slot is due and unserved; stamps
  carry `server:<host>` / `local:<host>`
- [ ] T005 [US1] Linux kill path in runStep (process group); unit-test what can run on Windows; the real check is on the server

## Phase 4: User Story 3 — release and hand-over (P2)

- [ ] T006 [US3] tools/runner/setup.sh + tools/runner/agentos-tick.service + agentos-tick.timer (idempotent)
- [ ] T007 [US3] tools/runner-deploy.mjs with `--dry-run` (testable offline: the file list, credentials excluded
  unless `--secrets`, never prints a secret value), atomic release-directory swap
- [ ] T008 [US3] specs/016-server-refresh-runner/runbook.md: restart, re-send credentials, read logs, remove from the PC

## Phase 5: Polish and release

- [ ] T009 Run verify-runner-016, verify-tick-014 and every suite that imports tick-local.mjs / job-status.mjs
- [ ] T010 Code + security review; fix findings test-first
- [ ] T011 (Nick's IP + go-ahead) setup.sh on the server → deploy code + credentials → one `--force` run on the server →
  watch a working morning side by side
- [ ] T012 (Nick's OK after a clean day) remove the PC task: `tools/install-local-tick.ps1 -Remove`
