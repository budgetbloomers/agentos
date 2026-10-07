# Feature Specification: Coaching comments show, signatures save

**Feature Branch**: `003-coaching-comments-signature`

**Created**: 2026-10-05

**Status**: In build with feature 004 (2026-10-05). **Superseded in part by `specs/004-coaching-drafts-submit-lock/`**:
a team leader can no longer open or read a SUBMITTED document, so FR-006 (session view names a missing signature) and
FR-007 (comment in the team leader's "Your sessions"/"All forms" notes) no longer apply to submitted sessions — the
signature state stays on the row (FR-005), and drafts are opened in full. FR-008/FR-009 (the agent's own card) stand.

**Input**: User description: "Investigate why comments are not displaying after doing formal coaching. Also investigate why when team leader is signing doc it does not save signature — have to go back to old view to find out no signature."

## Investigation findings (2026-10-05)

The "new view" is the team leader's Coaching Hub tab in Agent Analytics, which writes into the Coaching Hub through the
Worker. The "old view" is the Coaching Hub's own app. Both read and write the same Hub records.

### F1 — Signatures drawn in the new view are thrown away before the save (CONFIRMED)

- The coaching form wires every signature box with **four** arguments — box, path, *reader*, *writer* — but the
  signature pad takes **three** (box, path, setter). The reader lands in the setter's place, so when a signature is
  finished the pad calls the reader, which returns the current (empty) value and stores nothing.
  `agent/index.html` line 3071 (`sigPad(box, …, cGet, cSet)`) against line 3807 (`function sigPad(box,path,set)`).
- The drawing stays visible on the canvas, so the team leader believes it is signed; the saved document has no
  signature. Every coaching product is affected — agent, team-leader, SOS and group-attendee signatures alike.
  The KPI forms use the same pad with the correct setter and are not affected.
- Live evidence (read-only Hub query, 2026-10-05). The new view stores the CB number as the roster writes it ("CB123");
  the Hub's own form stores it hyphenated ("CB-123"), which tells the two writers apart:

  | Product | Written from the new view | …with any signature | Written in the Hub app | …with any signature |
  |---|---|---|---|---|
  | Formal Coaching | 2 | **0** | 290 | 277 |
  | Informal Coaching | 1 | **0** | 106 | 102 |

  The two new-view Formal Coaching sessions (Denise Haripersad, 30 Sep 09:53 and 13:31 UTC) carry full comments and
  no signature at all. Only Denise has used the new view to record coaching so far.
- The new view then **hides** the loss: the list it reads deliberately strips signature images (they are large), so
  nothing on the new view can say whether a document is signed. The team leader has to open the old Hub app to find out.

### F2 — Formal Coaching comments are saved but not shown (CONFIRMED)

The comments reach the Hub intact (the same two sessions hold 207/130 characters of support provided, 228/286 of agreed
plan, three call notes each). They are not shown because every summary reads fields Formal Coaching does not have:

- Team leader's "Your sessions" Notes column and the "All forms" list read *development areas / team leader feedback /
  coaching details* (`agent/index.html` 3299 and 3183). Formal Coaching's comments are *support provided*, *agreed plan
  · agent feedback* and the per-call *development areas* — so every formal row shows a blank note.
- The agent's own coaching card (also what a team leader sees drilling into an agent) builds "What was discussed" from
  *team leader comments / development areas / team leader feedback* (`agent/index.html` 5527). For a formal session
  none exist, so only "What you agreed" appears and the discussion is missing.
- The coaching copy the agent page reads keeps support provided and agreed plan but **drops the calls entirely**
  (`worker/src/coaching.mjs` normalise, line 154), so the per-call development areas — the main body of a formal
  session — never reach the agent page at all.
- Contributing, by design: the agent page reads the coaching copy, refreshed every 2 hours and forced daily at 05:30
  SAST, so a session saved now reaches the agent's page at the next refresh, not instantly. The page already prints the
  copy's age.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A signed document is saved signed (Priority: P1)

A team leader records a coaching session in Agent Analytics. The agent signs, the team leader signs, and the leader
saves. The document in the Coaching Hub carries both signatures, exactly as if it had been captured in the Hub app.

**Why this priority**: an unsigned coaching document is a compliance gap — formal coaching without the agent's
acknowledgement does not stand up in a performance or disciplinary process — and today every document saved from the
new view is unsigned without anyone knowing.

**Independent Test**: draw both signatures on a Formal Coaching form in a browser against a stubbed Worker; the request
the page sends carries both signatures as images, and the Worker forwards both to the Hub's create.

**Acceptance Scenarios**:

1. **Given** a Formal Coaching form with agent and team leader signatures drawn, **When** the leader saves, **Then** the
   save request carries both signatures and the Hub record holds both.
2. **Given** any of the six coaching products, **When** a signature box on it is drawn in, **Then** that signature is
   part of what is saved (agent, team leader, SOS, and every group attendee row).
3. **Given** a signature has been drawn, **When** the leader presses Clear, **Then** the signature is removed from what
   will be saved and the box is ready to sign again.
4. **Given** the leader has drawn a signature and nothing else, **When** they try to leave the form, **Then** they are
   warned that the session is not saved (a signature is unsaved work like any typed field).

---

### User Story 2 - The new view says whether a document is signed (Priority: P1)

After saving, and whenever they look at their sessions later, the team leader can see which signatures each document
holds without opening the Hub app.

**Why this priority**: the reason the signature bug went unnoticed is that the new view could not show it. A missing
signature must be visible where the leader works.

**Independent Test**: the leader's session list, served by the Worker, states for each session which signatures are
present — without carrying the signature images — and the page shows "Signed" / "Not signed" per signatory.

**Acceptance Scenarios**:

1. **Given** a session with both signatures, **When** the leader views their sessions, **Then** it reads as signed by
   both.
2. **Given** a session missing the team leader's or the agent's signature, **When** the leader views their sessions,
   **Then** the missing signature is named on the row and in the session view.
3. **Given** a save just completed, **When** the list refreshes, **Then** the confirmation states what the Hub now
   holds for that session's signatures.

---

### User Story 3 - Formal coaching comments appear wherever a session is summarised (Priority: P2)

A team leader saves a Formal Coaching session; its comments show in their session list and "All forms". The agent opens
their coaching card and sees what was discussed (the call-by-call development areas and the support provided) and what
they agreed.

**Why this priority**: the comments are the part of a coaching record the agent recognises as their conversation;
showing a blank note makes a recorded session look empty.

**Independent Test**: render the session list, the All forms list and the agent coaching card from a Formal Coaching
record that has only support provided, agreed plan and call notes; each shows the comment text.

**Acceptance Scenarios**:

1. **Given** a Formal Coaching session with call notes and support provided, **When** the leader views "Your sessions"
   or "All forms", **Then** the Notes column shows the session's comment, not a blank.
2. **Given** the same session in the coaching copy, **When** the agent opens their coaching card, **Then** "What was
   discussed" shows the call development areas and the support provided, and "What you agreed" shows the agreed plan.
3. **Given** a session of any other product, **When** it is summarised, **Then** its note is unchanged from today
   (informal: team leader feedback; QA: development areas; lead management: development areas; group: coaching
   details; scorecard: call notes).
4. **Given** a formal session's calls, **When** they reach the agent's page, **Then** the customer contact numbers do
   not.

### Edge Cases

- A signature box is drawn in, then the agent changes on the form: the signature stays with the form until cleared (the
  leader decides; the form does not silently discard drawn work).
- A signature larger than the Worker's size bound or not an image: refused with a message naming the signature, never
  dropped silently while the rest saves.
- A Formal Coaching session with no comments at all (the Hub allows saving blanks): the Notes column shows a dash, not
  an error.
- Very long call notes: the agent card and lists cap the text as they do today; the full text stays in the Hub.
- Sessions already saved unsigned from the new view (2 formal, 1 informal, plus any further QA/lead-management ones):
  they cannot be repaired by this fix — the drawings were never sent. They are listed for the team leader to re-sign in
  the Hub app.
- The coaching copy is up to 2 hours old: the agent card keeps saying when the copy was taken.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Every signature drawn on a coaching form in the new view MUST be stored with the form and sent on save, for
  all six coaching products and every signatory on them.
- **FR-002**: Drawing a signature MUST mark the form as having unsaved changes, exactly as typing does.
- **FR-003**: Clearing a signature MUST remove it from what will be saved.
- **FR-004**: The Worker MUST refuse a save — with a message naming the field — when a signature was supplied but is not
  an acceptable image, instead of silently dropping it and saving the rest.
- **FR-005**: The leader's session list MUST state, per session, which of its signatures are present, without sending
  the signature images to the browser.
- **FR-006**: The session list row and the session view MUST name any missing signature.
- **FR-007**: The Notes column of "Your sessions" and "All forms" MUST show a comment for every product, using that
  product's own comment fields; for Formal Coaching: support provided, else the call development areas, else the agreed
  plan.
- **FR-008**: The coaching copy MUST carry each formal session's call development areas (capped like the other comment
  text) and MUST NOT carry the customer contact numbers.
- **FR-009**: The agent coaching card MUST show, for a Formal Coaching session, "What was discussed" from the call
  development areas and support provided, and "What you agreed" from the agreed plan.
- **FR-010**: The sessions already saved unsigned from the new view MUST be identified (by date, product and team
  leader, read-only) so they can be re-signed in the Hub app.

### Key Entities

- **Coaching session (Hub record)**: one document of one of six products, owned by a team leader's Hub profile; carries
  the agent, date, campaign, product-specific comment fields, classification themes and zero or more signature images.
- **Signature**: a drawn image for one signatory (agent, team leader, SOS, or a group attendee); its presence is a fact
  the new view must be able to state without carrying the image.
- **Coaching copy**: the periodic snapshot of every Hub session the agent and campaign-manager pages read; signatures
  never travel in it.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of signatures drawn in the new view are present on the saved Hub record (from 0% today).
- **SC-002**: A team leader can tell whether a saved session is fully signed from the new view alone, in one look at
  their session list — no visit to the Hub app.
- **SC-003**: 100% of Formal Coaching sessions with any comment show a non-blank note in "Your sessions" and "All forms"
  (from 0% today).
- **SC-004**: An agent's Formal Coaching session shows what was discussed on their card whenever the session has call
  notes or support provided.
- **SC-005**: No customer contact number appears in any agent-facing payload.

## Assumptions

- The Hub app stays the system of record and is not changed; the fix is entirely in Agent Analytics and the Worker.
- The new view keeps creating sessions only; editing or re-signing an existing session in the new view is out of scope —
  the Hub app already does it, and only a handful of sessions need it.
- Saving without a signature stays allowed (the Hub app allows it, and 13 of 290 Hub-written formal sessions are
  unsigned); the fix makes the state visible rather than blocking the save.
- The coaching copy's refresh cadence (2 hours, daily 05:30 SAST) is unchanged; the agent card keeps stating the copy's
  age.
- Signature images keep their current size bound (250 KB); a drawn signature measures 5–18 KB on live records.
