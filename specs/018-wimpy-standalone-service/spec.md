# Feature Specification: Wimpy Order as its own service — out of VAS analytics, onto Vercel (and Docker)

**Feature Branch**: `018-wimpy-standalone-service`

**Created**: 2026-10-09

**Status**: Draft

**Input**: User description: "I need you to extract wimpy as a docker with the highlevel api keys and all its functionality
because I want to remove it from vas analytics and put that on vercel"

## Decided up front (assumptions the user can overturn)

1. **Vercel does not run containers.** "Docker" and "Vercel" are read as two ways to host the SAME lunch app: a container
   image for any machine (the Oracle box, Railway, a laptop) and a Vercel project for the public address. One codebase,
   two deploy targets, identical behaviour.
2. **The lunch app keeps the suite's accounts.** People sign in with the CB number and password the Agent List provisions;
   the Agent List keeps granting and removing the Wimpy app. The order ledger and the person's HighLevel link stay in the
   same database. Nothing is copied; the service reads and writes the same tables the Worker did.
3. **"Remove it from VAS analytics" means**: the VAS site no longer serves the Wimpy page, the Worker no longer answers
   any Wimpy route or runs the Wimpy retry, and a Wimpy sign-in can no longer reach anything of the suite. The link on the
   VAS Apps page points at the new address; the old `/wimpy/` address forwards there so bookmarks keep working.
4. **The HighLevel key travels as configuration, never as code**: it is set on the hosting platform (Vercel environment
   variables; the container's environment) from the git-ignored file that already holds it. It is never in the image, the
   repository, a reply or a log.
5. **Nick deploys.** This feature delivers the service, its tests, the removal, and step-by-step release instructions;
   creating the Vercel project, setting its secrets and running the removal release are Nick's actions.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Lunch works exactly as before, at a new address (Priority: P1)

An agent or manager opens the Wimpy address, signs in with their CB number (managers: username) and their Agent Analytics
password, sees today's Weekday Value Menu with today's Big One, adds items (quantity only), types CB number, name, surname
and phone, confirms, and the order reaches the kitchen. "My orders" shows their own history with the kitchen stage. Outside
08:00–17:00 SAST on weekdays the menu reads and nothing can be ordered.

**Why this priority**: it is the whole point — the floor's lunch must not change in any way the person can notice except
the address.

**Independent Test**: run the service on its own (container or Vercel preview) against the live database with a test
account; sign in, order, open My orders; the kitchen receives the same order sheet as before.

**Acceptance Scenarios**:

1. **Given** an active account with the Wimpy app, **When** the person signs in with the right CB number and password,
   **Then** they reach the menu, and the session they hold opens nothing but the lunch app.
2. **Given** a wrong password, **When** they try five times in fifteen minutes, **Then** the account locks exactly as it
   would on the Agent Analytics sign-in (one lock, shared), and the words are the same as today.
3. **Given** the menu on a Thursday, **When** the person tries to order Monday's Big One, **Then** it is refused by name
   with today's hero named — unchanged.
4. **Given** a confirmed order, **When** it is sent, **Then** the kitchen receives the same fields and the same order sheet
   as the Worker sent, and the reply to the page is the same four fields.
5. **Given** an accepted order, **When** the person opens My orders, **Then** their own orders appear, newest first, with
   the kitchen stage, and nobody else's — every isolation rule of spec 015 holds unchanged.
6. **Given** HighLevel is down, **When** a person orders, **Then** the order still reaches the kitchen and the card is
   written later by the retry — unchanged.

---

### User Story 2 — The lunch app is gone from VAS analytics (Priority: P1)

A manager opening VAS sees the Wimpy card on the Apps page pointing at the new address. The old `/wimpy/` address forwards
there. The suite's API answers no Wimpy request any more, a Wimpy sign-in reaches nothing of the suite, and the suite's
scheduled jobs no longer include the Wimpy retry.

**Why this priority**: Nick's request is to take it out; a half-removed feature leaves dead routes, a live cron and an
allow-list entry that nobody maintains.

**Independent Test**: after the release, request every former Wimpy route on the suite's API → each is refused with a
message naming the new address; a wimpy-scoped session is refused everywhere; the Worker's cron list has no Wimpy entry;
`/wimpy/` on the Pages site forwards to the new address.

**Acceptance Scenarios**:

1. **Given** the suite after the release, **When** any former Wimpy API route is called, **Then** it is refused (410) with
   the new address in the message.
2. **Given** a session minted by the old Wimpy sign-in, **When** it calls any suite route, **Then** it is refused.
3. **Given** the VAS Apps page, **When** the Wimpy card is clicked, **Then** the new address opens in a new tab.
4. **Given** a bookmark to the old `/wimpy/` address, **When** it is opened, **Then** it forwards to the new address.
5. **Given** the suite's health banner, **When** Wimpy orders are stuck on the HighLevel board, **Then** the alert still
   raises (the alerts read the status the service writes; nothing changes for the people who get alerts).

---

### User Story 3 — One codebase, two ways to host it (Priority: P2)

Nick can run the lunch app as a container on any machine with a single command and an environment file, or deploy it to
Vercel with the project's standard flow. Both read the same configuration names; both behave identically; the retry of
failed HighLevel cards runs on a schedule in both.

**Why this priority**: the user asked for both; the value of the extraction is being able to host it anywhere.

**Independent Test**: build the image and run it with the env file → the health address answers and a sign-in works;
deploy to Vercel with the same variables → the same.

**Acceptance Scenarios**:

1. **Given** the env file, **When** the container starts, **Then** it refuses to start without the database settings and
   says which name is missing; with them, it serves the page and the API on one port.
2. **Given** the Vercel project with the variables set, **When** it deploys, **Then** the page and the API answer on the
   same origin and the scheduled retry runs with Vercel's cron, authenticated by a secret.
3. **Given** either host, **When** the HighLevel key and location are absent, **Then** ordering works, cards wait as
   pending, My orders says stages are not available, and the health status says "not configured" — unchanged behaviour.
4. **Given** either host, **When** an error from HighLevel or the database is logged or stored, **Then** it carries no
   key, location id, phone number or typed name.

---

### User Story 4 — The rules cannot drift between the two copies (Priority: P2)

The password check, lock and session rules the service uses are the Worker's, byte for byte; a change to one without the
other fails the suite's own checks.

**Why this priority**: the one real regression risk of a second copy of the sign-in is that the lock rules diverge and
one door becomes the weaker.

**Independent Test**: edit the lock threshold in one copy only → the drift guard fails.

**Acceptance Scenarios**:

1. **Given** the Worker's and the service's shared sign-in functions, **When** the guard compares them, **Then** they are
   identical; any difference names the function.
2. **Given** the service's own test suites (menu, sign-in, history, page), **When** they run, **Then** every check that
   passed in the suite's guards passes here — ported, not weakened.

### Edge Cases

- A person signed in to the old `/wimpy/` page at release time → their session is ended by the release; they open the new
  address and sign in again (their cart is lost; orders already sent are unaffected).
- A cached old page keeps calling the Worker → every call is refused with the new address in words.
- Vercel's free plan runs scheduled jobs less often than every twenty minutes → failed cards still catch up when the
  person opens My orders (unchanged self-heal), and the container host runs the retry on its own timer.
- The service is reached through a proxy → the per-network sign-in limit must count the real client address, never the
  proxy's; where no proxy is declared, a client cannot forge its address.
- Two people order at once on either host → one contact per person, one card per order — unchanged.
- The database is unreachable → sign-in and every signed-in request say so plainly (500 with a plain message); nothing is silently empty.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The service MUST serve the Wimpy page and its API from one origin, with no cross-origin call from the page.
- **FR-002**: Sign-in MUST take a CB number (or username) and the account's password, checked by the SAME rules as the
  suite's main sign-in (shared per-account lock of five failures in fifteen minutes, the per-network limit of a hundred
  Wimpy failures in ten minutes, one generic answer for unknown/disabled/wrong, the app grant check, the 12-hour
  wimpy-scoped session, the same audit events).
- **FR-003**: The service MUST accept only sessions it minted (scope `wimpy`); the suite's Worker MUST refuse a
  wimpy-scoped session on every route.
- **FR-004**: The menu, prices, Big One rotation, window, pricing, identity check, kitchen payload, ledger write, HighLevel
  contact/card/note, backoff and stuck rules, redaction, My orders ownership and stage rules MUST be unchanged — the same
  module code, moved.
- **FR-005**: The HighLevel key and location, the database settings, the kitchen webhook address and the cron secret MUST
  be read from the environment only; the service MUST start (container) or answer (Vercel) with a clear "not configured"
  when the database settings are missing, and MUST treat a missing HighLevel key/location as "not configured" exactly as
  today.
- **FR-006**: The service MUST ship a container definition (image + compose file reading the existing env files) and a
  Vercel definition (function, static page, headers, cron) from the same source tree, with no code path that differs
  between hosts except the adapter that receives the request and the scheduler that fires the retry.
- **FR-007**: The scheduled retry MUST run on both hosts: an in-process timer in the container; Vercel Cron on Vercel,
  authenticated by a secret so nobody else can trigger it. The retry endpoint MUST refuse when no secret is configured.
- **FR-008**: The service MUST keep writing `kv:wimpy-hl-status` and `kv:wimpy-ledger-failed` so the suite's health alerts
  keep working unchanged.
- **FR-009**: The suite MUST stop serving the Wimpy page, MUST answer every former Wimpy API route with a refusal naming
  the new address, MUST drop the Wimpy sign-in and the Wimpy retry from its Worker and cron list, MUST drop the Wimpy
  routes from the agent allow-list, MUST point the Apps card at the new address, and MUST forward the old `/wimpy/` page
  address to the new one.
- **FR-010**: The release MUST end every existing wimpy-scoped session in the database (a migration), after the Worker
  that refuses them is deployed.
- **FR-011**: The service MUST carry its own test suites, ported from the suite's three Wimpy guards and the sweep-014
  page checks, runnable with one command and needing no live credentials; the suite MUST carry a drift guard (shared
  sign-in code identical in both places) and a removal guard (no Wimpy route, cron, allow-list entry or page remains).
- **FR-012**: Secrets MUST never appear in the repository, the image, a reply, a stored error or a log line.
- **FR-013**: The service MUST send the same security headers the Pages site sends (no-store, nosniff, frame-ancestors
  self, a CSP allowing only itself) on both hosts.
- **FR-014**: The per-network sign-in limit MUST use the real client address: the proxy's forwarded address only when a
  proxy is declared by configuration (Vercel always; the container only when told), else the socket's address.

### Key Entities

- **Wimpy session**: an `app_sessions` row with scope `wimpy`, minted by the service, 12 hours, read by the service alone.
- **Order ledger row** (`wimpy_orders`) and **HighLevel link** (`wimpy_hl_contacts`): unchanged (migration-055).
- **Retry status** (`kv:wimpy-hl-status`) and **lost ledger row** (`kv:wimpy-ledger-failed`): unchanged keys in `rules`,
  now written by the service, still read by the Worker's health check.
- **Configuration**: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `WIMPY_HL_API_KEY`, `WIMPY_HL_LOCATION_ID`,
  `WIMPY_WEBHOOK_URL` (optional; the kitchen webhook, defaulting to today's), `CRON_SECRET` (Vercel retry), `PORT`,
  `RETRY_EVERY_MIN` (container timer), `TRUST_PROXY` (container behind a proxy).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every check of the suite's three Wimpy guards and the sweep-014 Wimpy page checks passes against the service
  (ported one for one; zero weakened or removed checks).
- **SC-002**: After the release, 0 Wimpy routes answer on the suite's API; 100% of former routes answer with the new
  address; 0 wimpy-scoped sessions remain in the database.
- **SC-003**: A person can sign in, order and see My orders at the new address within the same number of steps as today
  (sign-in, add, details, confirm).
- **SC-004**: The container starts in under 5 seconds and answers its health address; the Vercel deployment answers the
  page and the API on one origin.
- **SC-005**: No secret, location id, phone number or typed name appears in any log line, stored error or reply produced
  during the full test run.
- **SC-006**: The drift guard fails when any shared sign-in function differs by one character between the two copies.

## Assumptions

- The Vercel project name is `chatterbox-wimpy` (address `https://chatterbox-wimpy.vercel.app`) until Nick chooses
  another; the one place the address is written in the suite (the Apps card, the Pages redirect, the Worker's refusal
  message) is a single constant so renaming is one edit.
- The service lives at `agentos/wimpy-service/` inside the repository (Vercel's "Root Directory" setting) so one commit
  carries both the extraction and the removal; it imports nothing from outside its folder, so it can be moved to its own
  repository with one command later.
- Vercel's free plan may run the scheduled retry only once a day; the self-heal on My orders and the container's own
  timer cover the gap. Nick decides whether the plan is upgraded.
- Docker is not installed on this machine; the image definition is written and reviewed but built by Nick (or the Oracle
  box). The Node server it runs is exercised locally.
- The suite's health alert wording that says "set on the Worker" is updated to say "set on the Wimpy service".
