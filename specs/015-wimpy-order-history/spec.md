# Feature Specification: Wimpy order history — each person sees only their own orders

**Feature Branch**: `015-wimpy-order-history`
**Created**: 2026-10-07
**Status**: Draft
**Input**: Nick, 2026-10-07: "when logging into the wimpy users must log in with their cb and their password. I gave you the
private intergration key and location ID to shpw the users their order history, it must only show their order history and
no one elses"

## Decided with Nick (2026-10-07)

1. **Sign-in with CB number + password is already live** (Spec Kit 009, released 7 Oct). It is kept exactly as it is and
   is not rebuilt; its guard must stay green.
2. **Every accepted order is also written into the Wimpy HighLevel sub-account** (today empty: no contacts, no cards; one
   "Wimpy Pipeline" with the stages New Order → Order Processing → Ready for Collection → Completed): the person as a
   contact, and **one card per order** at "New Order". The existing kitchen hand-off (the n8n webhook) stays exactly as it is.
3. **Nick turns ON "Allow duplicate opportunities"** in the Wimpy sub-account (today OFF), so a person's second order gets
   its own card instead of being refused.
4. **History starts at go-live.** Orders placed before the release went only to the kitchen hand-off and are not shown;
   the page says so.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — I can see my own past Wimpy orders (Priority: P1)

An agent (or a manager) signs in to Wimpy with their CB number and password and opens "My orders". They see every order
they have placed since go-live, newest first: when it was placed (SA time), what was in it (each item and quantity), the
total, and where the kitchen has it (New Order, Order Processing, Ready for Collection, Completed).

**Why this priority**: it is the request — and it is only safe if it shows nobody else's orders.

**Independent Test**: two people each place an order; each signs in and opens "My orders" — each sees exactly their own
order and nothing of the other's.

**Acceptance Scenarios**:

1. **Given** Thandi has placed two orders since go-live, **When** she opens "My orders", **Then** she sees both, newest
   first, each with its date and time, items, total and kitchen stage.
2. **Given** Thandi and Sipho have both ordered, **When** Thandi opens "My orders", **Then** none of Sipho's orders, names,
   phone numbers or totals appear anywhere in her answer.
3. **Given** a person has placed no orders since go-live, **When** they open "My orders", **Then** they are told they have
   no orders yet and that history starts on the go-live date.
4. **Given** the kitchen moves an order to "Ready for Collection", **When** the person opens or refreshes "My orders",
   **Then** that order shows "Ready for Collection".

---

### User Story 2 — Nobody can see another person's orders, whatever they try (Priority: P1)

Whoever is signed in decides whose orders come back. Changing the page, the address, or anything sent with the request
can never return another person's orders.

**Why this priority**: Nick's words — "it must only show their order history and no one elses".

**Independent Test**: signed in as one person, ask for history while naming another person's CB number, another person's
customer record or another order's reference in every way the request can carry it — the answer is always only the
signed-in person's own orders (or a refusal), never anyone else's.

**Acceptance Scenarios**:

1. **Given** Thandi is signed in, **When** a request for history names Sipho's CB number, Sipho's customer record or one of
   Sipho's orders, **Then** the answer contains only Thandi's orders.
2. **Given** nobody is signed in (or the sign-in has expired), **When** history is requested, **Then** it is refused and
   the page returns to the sign-in screen.
3. **Given** Thandi signs out on a shared computer, **When** Sipho signs in on the same computer, **Then** nothing of
   Thandi's history is visible to him at any point.
4. **Given** the kitchen's system holds a card that is not linked to the signed-in person, **When** their history is
   built, **Then** that card is never included, even if it names their CB number.

---

### User Story 3 — Every order reaches the kitchen board, and ordering never breaks because of it (Priority: P2)

When a person places an order it goes to the kitchen exactly as today, and it also appears as a card in the Wimpy
Pipeline at "New Order", linked to that person. If the HighLevel side is slow or down, the order still goes through to the
kitchen and the person is told it was placed; the card is created as soon as HighLevel is back.

**Why this priority**: history depends on the cards existing, but lunch must never fail because of history.

**Independent Test**: place an order with HighLevel answering normally → a card appears at "New Order" for that person;
place one with HighLevel down → the order still succeeds, and the card appears after HighLevel recovers.

**Acceptance Scenarios**:

1. **Given** HighLevel is working, **When** a person places an order, **Then** the kitchen receives it as today **and** a
   card for it appears in the Wimpy Pipeline at "New Order", linked to that person's contact.
2. **Given** a person orders for the first time, **When** the card is created, **Then** a contact for them is created
   once; their later orders link to the same contact (no duplicate people).
3. **Given** HighLevel is down or refuses the card, **When** the person places an order, **Then** the order is still
   accepted and sent to the kitchen, the person sees the normal confirmation, and the card is retried automatically.
4. **Given** "Allow duplicate opportunities" is still off, **When** a person places a second order, **Then** ordering still
   succeeds, the refusal is recorded with its reason, and the release checks catch the setting before go-live.
5. **Given** an order was accepted but its card is not created yet, **When** the person opens "My orders", **Then** the
   order is listed with its items and total and a stage that says it has not reached the kitchen board yet.

### Edge Cases

- A person changes the phone number they type between orders → still the same person in history (identity is the
  sign-in, never the phone or the typed name).
- A manager without a CB number orders with their username → their history works the same way, keyed to their account.
- A person's account is removed (leaver) → they cannot sign in, so they cannot see history; their cards stay in HighLevel.
- The kitchen deletes a card or moves it to another pipeline → the order still shows from our record, with its stage
  shown as unknown rather than disappearing or showing someone else's.
- HighLevel answers slowly → "My orders" still shows the orders with a note that the kitchen stage could not be fetched,
  rather than an empty list.
- Many orders → newest first, at least the last 50 shown.
- Orders before go-live → not shown; the page says history starts on the go-live date.
- The key or location settings are missing or wrong on the server → ordering still works; history says it is not
  available yet; the problem is reported to the people who get alerts.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Wimpy sign-in MUST remain CB number (or username) + the account's password (spec 009), unchanged.
- **FR-002**: Every order the Worker accepts MUST still be sent to the kitchen hand-off exactly as today; nothing in this
  feature may delay, alter or fail that hand-off.
- **FR-003**: Every accepted order MUST also be kept in our own record, owned by the signed-in account that placed it, with
  its time, items, quantities, total and the CB number / username it was placed under.
- **FR-004**: Every accepted order MUST become one card in the Wimpy Pipeline at "New Order", linked to the person's
  contact in the Wimpy sub-account; the person's contact MUST be created once and reused.
- **FR-005**: A failure to create the contact or card MUST NOT fail the order; it MUST be recorded with its reason and
  retried automatically until it succeeds or is clearly reported as stuck.
- **FR-006**: "My orders" MUST return only orders owned by the signed-in account, decided on the server from the sign-in
  alone; no value in the request (CB number, customer record, order reference, page or address) may widen or change whose
  orders come back.
- **FR-007**: Each order in "My orders" MUST show the time placed (SA time), each item with its quantity, the total, and
  the current kitchen stage taken from the card — or a plain note when the stage is not available.
- **FR-008**: A card MUST only contribute a stage to an order it is recorded against for that same person; a card that is
  not linked to the signed-in person's contact MUST never appear.
- **FR-009**: The HighLevel key and location MUST be kept as server secrets only — never in the page, any response, the
  code repository or logs.
- **FR-010**: History MUST be refused without a valid sign-in, and signing out MUST clear everything shown (spec 014 A4).
- **FR-011**: The page MUST state that history starts on the go-live date and show a clear empty state.
- **FR-012**: The release MUST confirm, before go-live, that "Allow duplicate opportunities" is ON in the Wimpy sub-account
  and that the key can create contacts and cards there.

### Key Entities

- **Wimpy order (our record)**: owner (the signed-in account), CB number / username, time placed, items with quantities
  and prices, total, notes, and its link to the HighLevel card (or the reason it is not linked yet).
- **Wimpy customer link**: one per person — the person's CB number / username and their contact in the Wimpy sub-account.
- **Kitchen card**: the HighLevel card for one order in the Wimpy Pipeline; its stage is what the person sees.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In testing with at least two people, 100% of "My orders" answers contain only the signed-in person's own
  orders — including every attempt to name another person.
- **SC-002**: 100% of orders accepted while HighLevel is working appear as a card at "New Order" within a minute.
- **SC-003**: With HighLevel unavailable, 100% of orders are still accepted and sent to the kitchen, and their cards appear
  within 20 minutes of HighLevel recovering.
- **SC-004**: A person sees their history within 3 seconds of opening "My orders".
- **SC-005**: Zero occurrences of the HighLevel key in any page, response, repository file or log.
- **SC-006**: The existing Wimpy sign-in and ordering guards stay 100% green.

## Assumptions

- "Order history" means orders placed through the Wimpy app from go-live onward; there is no import of earlier orders.
- The kitchen continues to work from the n8n hand-off; the Wimpy Pipeline cards are an additional view for status and
  history. Who moves cards through the stages is up to the kitchen.
- History is viewable whenever the person can sign in (not only during the 08:00–17:00 ordering window).
- The last 50 orders are enough to show; older ones are not listed on the page.
- Contacts in the Wimpy sub-account carry the person's name (as typed on their first order), phone and CB number.
- Nick turns on "Allow duplicate opportunities" before go-live (decision 3).
