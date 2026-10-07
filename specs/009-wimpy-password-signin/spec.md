# Feature Specification: Wimpy sign-in needs the person's password

**Feature Branch**: `009-wimpy-password-signin`

**Created**: 2026-10-06

**Status**: Draft

**Input**: User description: "for the wimpy app users must put this password as well, for example dalwin cb number and his password to login"

## Context

Wimpy Order (the lunch app) signs people in today with a CB number alone — no password (decided 2026-09-10). The
session it gives can only order lunch, but anyone who knows a colleague's CB number can order in that colleague's
name. The requirement now: a person signs in with their CB number **and** their password — the same password they
already use for Agent Analytics and VAS Analytics (e.g. Dalwin: CB145 + his own password). Managers without a CB
number keep signing in with their username, now with their password too.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Sign in with CB number and password (Priority: P1)

An agent, team leader or campaign manager opens Wimpy Order, types their CB number and their password, and reaches
the menu. Without the right password they do not get in.

**Why this priority**: It is the whole request — nobody can order in someone else's name just by knowing their CB.

**Independent Test**: Sign in as a test account with the right password (menu opens), then with a wrong or empty
password (refused, menu never shown).

**Acceptance Scenarios**:

1. **Given** Dalwin's account (CB145, username `dalwin`) holds the Wimpy app, **When** he types `CB145` and his
   password, **Then** he reaches the menu signed in as himself.
2. **Given** the same account, **When** he types `dalwin` (his username) and his password, **Then** he is signed in
   exactly as with the CB number.
3. **Given** any account, **When** the CB number is typed in any of the usual spellings (`CB-145`, `cb 145`, `145`)
   with the right password, **Then** sign-in succeeds.
4. **Given** any account, **When** the password is wrong, **Then** sign-in is refused with one plain message ("That CB
   number and password do not match") that does not say which of the two was wrong. An empty field is refused before
   anything is looked up, with "Type your CB number and your password."
5. **Given** a CB number that belongs to nobody, or to a disabled account, **When** any password is typed, **Then**
   the answer is the same plain message as a wrong password.
6. **Given** a person signed in, **When** they order, **Then** everything after sign-in (menu, cart, order form,
   hours, prices) behaves exactly as before.

---

### User Story 2 - Guessing is stopped (Priority: P1)

Someone trying password after password for a colleague's CB number on the Wimpy page is stopped, the same way they
would be on the main sign-in.

**Why this priority**: The Wimpy password is the person's real password. If Wimpy allowed unlimited guesses it would
be a weaker back door to every app that password opens.

**Independent Test**: Make five wrong attempts for one account on the Wimpy page and check that the account is locked
on the Wimpy page and on the main sign-in alike; make ten failed attempts from one network across different CB
numbers (a hundred) and check that further tries from it are refused for ten minutes.

**Acceptance Scenarios**:

1. **Given** an account, **When** five wrong passwords are typed for it within fifteen minutes (on the Wimpy page, the
   main sign-in, or both together), **Then** the account is locked for fifteen minutes everywhere and the Wimpy page
   says so in words.
2. **Given** a locked account, **When** the right password is typed on the Wimpy page, **Then** it is still refused
   until the lock expires.
3. **Given** one network (IP), **When** a hundred failed Wimpy sign-ins come from it within ten minutes, whatever CB
   numbers were typed, **Then** further Wimpy sign-ins from it are refused for the rest of the ten minutes.
4. **Given** a successful Wimpy sign-in, **When** the person later mistypes once, **Then** earlier failures before the
   success do not count toward the lock.

---

### User Story 3 - The page asks for the password plainly (Priority: P2)

The sign-in card has a CB number field and a password field, says which password it means, and tells a person who
has forgotten it what to do.

**Why this priority**: Without it people will not know that "password" means their Agent Analytics password.

**Independent Test**: Open the Wimpy page signed out and read the card.

**Acceptance Scenarios**:

1. **Given** the Wimpy page signed out, **Then** it shows a CB number field, a password field (characters hidden), and
   the words "the password you use for Agent Analytics", with a line for managers to use their username.
2. **Given** the card, **When** the person presses the button with either field empty, **Then** the empty field is
   marked and nothing is sent.
3. **Given** the card, **Then** it tells a person who has forgotten their password to ask their team leader or manager.
4. **Given** the card, **Then** the old line "Your CB number is your sign-in — no password" appears nowhere.

---

### User Story 4 - Old password-less sessions end (Priority: P3)

Anyone still signed in to Wimpy from before the change is asked to sign in again with a password.

**Why this priority**: Wimpy sessions last at most twelve hours and live only in the browser tab, so the exposure is
small, but the change should be complete on the day it ships.

**Independent Test**: After release, a Wimpy session issued before the release no longer opens the menu; the page
shows the sign-in card.

**Acceptance Scenarios**:

1. **Given** a Wimpy session issued before the release, **When** the page is opened or reloaded, **Then** the sign-in
   card is shown.

---

### Edge Cases

- A person whose account does not hold the Wimpy app types the right password: they are told plainly that their
  account cannot order from Wimpy yet and to ask their team leader (they have proved who they are, so saying so
  reveals nothing to a stranger). A wrong password for such an account gets the ordinary plain refusal.
- A password with leading or trailing spaces is used exactly as typed (as on the main sign-in) — no trimming.
- A very long CB/username field (over 40 characters) or password (over 200 characters) is refused before any lookup.
- Someone signed in to Wimpy can still reach nothing but Wimpy — knowing the password does not widen the lunch session.
- Signing in to Wimpy does not sign the person in to Agent Analytics or VAS, and does not sign them out of them.
- An account flagged to change its password at its next main sign-in can still order lunch with its current password;
  the Wimpy page does not change passwords.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Wimpy sign-in MUST require the person's password together with their CB number (or, for accounts with no
  CB number, their username); the CB number alone MUST no longer sign anyone in.
- **FR-002**: The password MUST be the account's existing password — the same one checked by the main sign-in, held
  only as a hash, never stored or logged by the Wimpy sign-in.
- **FR-003**: The CB number MUST be accepted in the same spellings as the main sign-in, and an account that has both a
  username and a CB number MUST be reachable by either.
- **FR-004**: A wrong password, an unknown CB number and a disabled account MUST all get the same message and status, so
  the page cannot be used to learn which CB numbers exist.
- **FR-005**: A wrong password on the Wimpy page MUST count toward the account's existing lockout (five failures in
  fifteen minutes → locked fifteen minutes), shared with the main sign-in; a locked account MUST be refused on the
  Wimpy page with a message saying it is locked.
- **FR-006**: A successful Wimpy sign-in MUST settle earlier failures the same way a successful main sign-in does.
- **FR-007**: A per-network limit MUST stay in force as a flood guard, raised from ten to a hundred failed Wimpy sign-ins per ten minutes (thirty in the first draft; the security review of 2026-10-06 judged thirty still able to close lunch for the floor):
  typed passwords fail far more often than CB numbers did, and the whole floor may reach the service from one network
  address, so a low limit would lock everyone out of lunch after a few typos. The per-account lock (FR-005) is the main
  guard; the main sign-in checks the same password with no network limit at all.
- **FR-008**: An account that proves its password but does not hold the Wimpy app MUST be refused with a message that
  says so, and that refusal MUST NOT count as a wrong password.
- **FR-009**: The session a Wimpy sign-in creates MUST remain confined to Wimpy ordering exactly as today.
- **FR-010**: Every Wimpy sign-in, success or failure, MUST be written to the sign-in audit log with the account (when
  known), the outcome and the network address — never the password.
- **FR-011**: The sign-in card MUST show a CB number field and a hidden-characters password field, name which password
  is meant, tell managers to use their username, and tell a person who has forgotten the password to ask their team
  leader or manager.
- **FR-012**: Wimpy sessions issued before the release MUST stop working when the release ships.
- **FR-013**: Every place in the product and its documentation that tells people the Wimpy sign-in needs no password
  MUST be corrected.

### Key Entities

- **Account**: the person's existing sign-in (username, CB number, password hash, active flag, apps granted, lockout
  state). Unchanged in shape.
- **Wimpy session**: a session limited to Wimpy ordering, twelve hours long. Unchanged in shape; now issued only after
  the password is proved.
- **Sign-in audit entry**: one row per attempt — account, outcome, network address, time.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of Wimpy sign-in attempts without the account's correct password are refused (verified across right,
  wrong, empty and unknown-account cases).
- **SC-002**: Dalwin (and every other account holding the Wimpy app) reaches the menu with CB number + password in one
  attempt, in under 5 seconds on a normal connection.
- **SC-003**: After five wrong passwords for one account on the Wimpy page, the sixth attempt with the right password is
  refused on both the Wimpy page and the main sign-in until fifteen minutes pass.
- **SC-004**: Nothing after sign-in changes: the existing Wimpy ordering checks all still pass.
- **SC-005**: On release day, zero Wimpy sessions issued before the release still open the menu.

## Assumptions

- "His password" means the person's existing suite password (Agent Analytics / VAS Analytics). No separate Wimpy
  password is created. Agents and team leaders who never changed theirs are still on the start password everyone was
  given (Nick, 18 Sep) — the Wimpy page inherits that; changing it remains optional and is done in Agent Analytics.
- Managers who have no CB number keep using their username, now with their password.
- The per-network limit counts FAILURES, so it does not stop someone trying the shared start password across CB numbers
  (those tries succeed). That exposure comes from the start password itself; the remedy is people changing it in Agent
  Analytics, which stays Nick's call (18 Sep: agents and team leaders stay on it).
- A page still open from before the release sends no password at all; it is told to reload to get the new sign-in.
- Ending the old sessions on release day signs out anyone mid-order; they sign in again (the cart is in the page and
  is lost, which is acceptable for a release that happens once).
- The order form after sign-in (CB number, name, surname, phone) is unchanged.
