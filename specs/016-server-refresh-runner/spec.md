# Feature Specification: The refresh runs on a server, not on Nick's PC

**Feature Branch**: `016-server-refresh-runner` | **Created**: 2026-10-08 | **Status**: Draft
**Input**: Nick, 2026-10-08: "I dont want this to run when my pc is on, it must run of the server"

## Decided with Nick (2026-10-08)

1. The 15-minute refresh (rake, referrals 08:00/14:00, agent digest, Ops relay, call-history lake load, weekly NBA
   review) moves to an **Oracle Cloud "Always Free"** machine (Ubuntu 24.04, Ampere A1, Johannesburg region) — no paid plan.
2. **The PC keeps running it until the server takes over** — after a clean day side by side, it is removed from the PC.
3. Nick creates the account and the machine; access is by an SSH key generated on this PC (public half pasted into
   Oracle; the private half never leaves this PC). Code reaches the server from this PC — nothing is pushed to GitHub.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — The dashboards stay fresh with Nick's PC off (Priority: P1)

**Independent Test**: with the PC asleep for a working morning, every step of the refresh runs on schedule from the
server, the run-status stamps name the server, and no freshness alert fires that the PC would have prevented.

1. **Given** the PC is off, **When** a working-hours quarter-hour passes, **Then** the server runs the refresh and its
   stamps say `server:<name>`.
2. **Given** a referrals slot (08:00 / 14:00 SAST, any day), **When** it is due, **Then** the server serves it.
3. **Given** a step on the server hangs, **When** 20 minutes pass, **Then** it is killed and the next run is not blocked.

### User Story 2 — Never two runners at once (Priority: P1)

**Independent Test**: start a run on the PC and on the server in the same minute — exactly one runs, the other says so
and exits.

1. **Given** both machines are on, **When** both wake at once, **Then** one holds the shared lease and the other stands down.
2. **Given** a runner dies mid-run, **When** its lease expires, **Then** the other may run.
3. **Given** the server has run within the last 20 minutes, **When** the PC wakes, **Then** the PC does nothing (fallback only).

### User Story 3 — Release, and remove it from the PC (Priority: P2)

1. **Given** a code release, **When** it is sent to the server, **Then** the server runs the new code from its next run
   and the credentials stay readable only by the runner account.
2. **Given** a clean day on the server, **When** Nick agrees, **Then** the PC's scheduled task is removed.

### Edge Cases

- Oracle stops or reclaims the machine → the run stamps go quiet; the existing freshness alerts (and the PC fallback
  while it still exists) cover it; the runbook says how to restart it.
- The server reboots → the timer resumes by itself; a missed run is caught up once, not many times.
- Logs grow → they rotate; failed-step logs keep the newest 60.
- Credentials are rotated → one command re-sends them; nothing is baked into the machine image.

## Requirements *(mandatory)*

- **FR-001** The refresh MUST run on the server every 15 minutes on the same rules as today (working hours Mon–Fri
  06–20 SAST for the full tick; referrals slots every day).
- **FR-002** Only one runner may run the tick at a time across all machines (a shared lease with expiry).
- **FR-003** The PC MUST act only as a fallback (runs only when no runner has stamped for > 20 min) until removed.
- **FR-004** Every stamp, note and log MUST name the machine; notes and logs stay redacted (spec 014 T-R5).
- **FR-005** Credentials on the server MUST be readable only by the runner account; never in the image, git or logs.
- **FR-006** A release MUST copy the code from this PC (no GitHub push) and take effect from the next run.
- **FR-007** A hung step MUST be killed with its whole process tree on Linux, as it is on Windows.

## Success Criteria *(mandatory)*

- **SC-001** On a working day with the PC off, ≥ 95% of quarter-hours show a server run (none missed for > 30 min).
- **SC-002** Zero overlapping runs across machines over a week.
- **SC-003** Zero credentials in any log, note or repository file.
- **SC-004** Nick's PC runs nothing after removal.

## Assumptions

- Oracle Always Free A1 capacity is available in Johannesburg (else another region); the machine is never billed.
- Supabase, HighLevel and the Cloudflare endpoints accept connections from the server's address (no IP allow-lists today).
