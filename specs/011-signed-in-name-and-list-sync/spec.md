# Feature Specification: The signed-in person's own name, and a list publish that proves it left everyone in step

**Feature Branch**: `011-signed-in-name-and-list-sync`

**Created**: 2026-10-07

**Status**: Draft

**Input**: "I need you get the naming convention correct when users logged in, I logged in with aarav it must now
showing correct" — "its showing nick". "secondly when the agent list is uploaded make sure it correctly creates, or
deletes tl and campaigns and agents".

## What is happening (2026-10-07, read from the code and the live data)

- **"Showing nick".** The Ops dashboard (Agent OS Analytics) paints the name in its header from `state.user`, and
  `state.user` is SAVED INSIDE THE SHARED Ops config (`cb-config`, used by everybody) and ADOPTED from it on every
  load and every save conflict (`applyCfg`: `if(cfg.user) state.user = cfg.user`). Whoever saved the config last —
  Nick at 10:08 today — is the name every other person sees, and the same field is stamped on every Ops upload as
  `uploaded_by`. Signing in as `aarav` (role exec, name "Aarav") therefore shows "Nick" and credits uploads to Nick.
- **"Uploaded by nicholas".** The command-line publish tool signs in as the FIRST admin account it finds, so a list
  published from the tool is recorded as nicholas's whoever ran it.
- **The list sync.** After today's publish the live data is in step: 128 agents on the list = 128 active agent
  logins; the 9 leaders who lead someone each have their login; the campaigns table = the list's (Courtesy 48, Cuddle
  29, VT 51); the database's own integrity view reads 0 failures. What failed today was the publish itself (a leader
  named twice on the sheet — fixed by migration-054) and that nobody was told why (spec 010). What is missing is the
  PROOF at upload time: the uploader is told what changed, never whether the result now matches the list.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Each person sees their own name (Priority: P1)

Whoever signs in sees their own name in the Ops header and avatar — never the last person who saved something.

**Independent Test**: Sign in as aarav after Nick has saved the Ops config: the header reads "Aarav".

**Acceptance Scenarios**:

1. **Given** the shared config was last saved by Nick, **When** Aarav signs in to Ops, **Then** the header and avatar
   show Aarav.
2. **Given** Aarav's Ops session saves the config and another session's copy is merged in (a save conflict),
   **Then** the header still shows Aarav.
3. **Given** any session saves the Ops config, **Then** no person's name is stored in the shared config.

### User Story 2 - Work is credited to the person who did it (Priority: P1)

An upload or a published list is recorded under the person who did it.

**Acceptance Scenarios**:

1. **Given** Aarav uploads a file in Ops, **Then** the batch's "uploaded by" is Aarav, whatever any other session saved.
2. **Given** the publish tool is run, **Then** it must be told which account is running it and records that account;
   without it, it refuses to publish (it never picks an account for you).

### User Story 3 - Every list publish proves the floor matches the list (Priority: P1)

After a list is published, the uploader is told whether agents, team leader logins and campaigns now match the list
exactly — or which check does not.

**Independent Test**: Publish a list; the answer carries the database's integrity result; with everything in step it
says so, and with a mismatch it names the check and how many.

**Acceptance Scenarios**:

1. **Given** a publish is accepted and the database's integrity checks all read 0, **Then** the station says the
   list is in step (agents, leader logins and campaigns match).
2. **Given** a publish is accepted but a check fails (e.g. a leader on the list with no login), **Then** the station
   shows a red message naming the check and the count; the health alert does the same, as today.
3. **Given** the integrity checks cannot be read, **Then** the station says they could not be confirmed — never "in
   step".

### Edge Cases

- A page opened before sign-in completes shows a neutral placeholder, then the person's name once the session is known.
- An old shared config that still carries a name is ignored, not shown.
- The integrity read is one extra database call after an accepted publish; a refused publish skips it.

## Requirements *(mandatory)*

- **FR-001**: The Ops header name and avatar MUST come from the signed-in session (display name, else username) and
  MUST update when the session becomes known.
- **FR-002**: The shared Ops config MUST NOT store a person's name, and loading a config (including one saved before
  this change, and during a save conflict) MUST NOT change the name shown.
- **FR-003**: An Ops upload's "uploaded by" MUST be the signed-in person.
- **FR-004**: The publish tool MUST require the operator's account (`--as <username>`) to publish and MUST sign in as
  that account; it MUST refuse an account that cannot publish (portal roles, inactive).
- **FR-005**: An accepted list publish MUST answer with the database's integrity result: in step (all checks 0) or
  the failing checks with counts; unreadable → "could not be confirmed".
- **FR-006**: Both upload stations MUST show that result to the uploader (green in step, red otherwise).

## Success Criteria *(mandatory)*

- **SC-001**: Signed in as aarav, the Ops header reads "Aarav" regardless of who saved last.
- **SC-002**: Every list publish from now on tells the uploader, at upload time, whether agents, leader logins and
  campaigns match the list.

## Assumptions

- "Naming convention" means showing the signed-in person's own name (the account's full name, e.g. "Aarav");
  renaming accounts' full names into a different format is not part of this change.
- The database integrity view (`agent_list_integrity`) is the authority for "in step"; no new rule is invented.
