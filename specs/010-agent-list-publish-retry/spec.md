# Feature Specification: An Agent List upload that the server fails on is retried, and the failure is recorded

**Feature Branch**: `010-agent-list-publish-retry`

**Created**: 2026-10-07

**Status**: Draft

**Input**: User description: "the new agent list is being uploaded but hezron etc is still there"

## What happened (2026-10-07, from the live record — read-only)

- 07:27 SAST Ashton uploaded the 7 Oct Agent List in VAS. It was archived (manifest), ingested on his page, and its
  publish was sent to the Worker. The answer was not a reply at all (an error status), so his page saved
  "the server did not accept the list (no reply)" — in his tab's state only.
- The Worker records a refusal (`kv:roster-refused`) only when the database ANSWERS with a refusal. An error thrown
  on the way (a database error, a timeout) returns an error status before anything is recorded — so no refusal was
  kept, and nothing retried.
- 07:32 the page's routine re-sync adopted the published record (6 Oct) back over the upload: 35 moves undone,
  Hezron Pillay's team back under him, Training Gr 17 back. The health cron raised "an Agent List archived at 07:27
  has not been published" — correct, but it could not say why.
- The same file, replayed today through the database's plan step, PLANS cleanly in ~0.5 s: 128 agents, no new logins,
  3 team leaders to remove (Renolan Pillay, Hezron Pillay, Kubenderan Govender), Training Gr 17 closed. The file is
  good; the failure was in the attempt.

## Root cause, found once the retry recorded it (2026-10-07 10:38 SAST)

The first diagnosis ("a passing error") was WRONG. With spec 010 live, the next attempt was stored with the database's
own words: `ON CONFLICT DO UPDATE command cannot affect row a second time` (SQLSTATE 21000). The 7 Oct "TL" sheet names
Fabian Chetty (CB194) twice — Matrix Vehicle Tracking - Digital and - Referral — and sync_team_leaders wrote the leader
map with one insert … on conflict (leader_name), which Postgres refuses when one row would be touched twice. The plan
step never writes the map (so every dry run passed); every apply threw. Fixed by migration-054 (one map row per leader,
campaigns joined); guarded by verify-publish-agent-list D4 (live, rolled back: red with the exact live error, then
green 62/62). The 7 Oct list was then published with Nick's approval: 128 agents, 34 updated, 5 removed, 3 leader
logins removed (Hezron, Renolan, Kubenderan), Training Gr 17 deleted.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A passing server error does not lose the upload (Priority: P1)

The person uploading the Agent List gets it published even when the first attempt hits a passing server or database
error, without having to notice and upload again.

**Independent Test**: Make the database fail once on a publish; the list is still published and nothing says it was
refused.

**Acceptance Scenarios**:

1. **Given** the database errors once during a publish, **When** a list is posted, **Then** the server tries again
   once and the list is accepted.
2. **Given** the page's publish gets no reply (an error status or a network failure), **When** it happened on a hand
   upload, **Then** the page tries again twice more (after about 20 seconds and a minute) before reporting a failure.
3. **Given** a retry succeeds, **Then** no "NOT published" notice remains.

### User Story 2 - A failure that stands is recorded with its reason (Priority: P1)

When a publish fails for good, everyone sees that it failed and why — not only the uploader's tab.

**Independent Test**: Make the database fail on every attempt; the server's answer and the stored refusal both name
the database's error, and the record is unchanged.

**Acceptance Scenarios**:

1. **Given** the database fails on both server attempts, **When** a list is posted, **Then** the answer is a normal
   reply saying the list was not published, naming the stage ("server") and the database's own words.
2. **Given** that failure, **Then** the stored refusal (read by the health alert and by every app's banner) carries
   the same reason and the file name, and the roster of record is unchanged.
3. **Given** the page's three attempts all get no reply, **Then** the page's notice says how many times it tried.

### Edge Cases

- A refusal the database gives deliberately (a duplicate CB, too many removals) is not retried — retrying cannot
  change the answer.
- A publish that committed in the database but whose reply was lost is safe to retry: the database's publish is one
  all-or-nothing step and a second run of the same list changes nothing.
- An older list, an identical list and an empty file keep their existing answers (not failures).

## Requirements *(mandatory)*

- **FR-001**: When the database errors (throws) during a publish, the server MUST try the whole publish once more
  before answering.
- **FR-002**: When the second attempt also errors, the server MUST answer with a normal reply (not an error status)
  saying the list was not published, with stage "server" and the error's text, and MUST store the refusal exactly as
  a database refusal is stored.
- **FR-003**: A deliberate database refusal MUST NOT be retried.
- **FR-004**: The page MUST retry a publish that got no reply up to two more times (≈20 s, ≈60 s) before reporting
  the failure; a reply of any kind (accepted or refused) ends the retries.
- **FR-005**: The page's failure notice MUST say how many attempts were made.
- **FR-006**: Retries MUST NOT publish a list the page adopted from the record (the existing no-ping-pong rule).

## Success Criteria *(mandatory)*

- **SC-001**: A single passing database error during a publish no longer stops a list from being published.
- **SC-002**: When a publish fails for good, the health alert and every app's banner name the reason within one
  health check, instead of "has not been published" with no reason.

## Assumptions

- Today's unpublished 7 Oct list still has to be published once (re-upload in the Upload Station, or the
  command-line tool) — this change prevents the next one, it does not reach back.
- The underlying error of 07:28 cannot be recovered after the fact (the Worker keeps no request log); the plan step
  succeeds today, so it was a passing error (a heavy open-cases clean-up ran on the database at 07:31).
