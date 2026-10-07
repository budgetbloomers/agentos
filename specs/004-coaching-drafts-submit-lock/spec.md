# Feature Specification: Coaching drafts with a submit lock

**Feature Branch**: `004-coaching-drafts-submit-lock`

**Created**: 2026-10-05

**Status**: Draft

**Input**: UAT sheet: "Allow TL to create coaching doc, save the draft and edit, but when click submit, he must not be able view". Decided with the user 2026-10-05: after Submit the team leader keeps a line in their list (agent, type, date, Submitted) but can never open or read the document again; signatures may be drawn at any time on the draft and are saved with it, but editing the content after a signature clears the signatures. Builds on feature 003 (signatures actually save).

## Context

Today a team leader's coaching document goes straight into the Coaching Hub the moment they press Save, and they can
read it back afterwards (the session view, the Notes column, the agent drill-in). The Hub itself has no notion of a
draft or of a submitted document — it only creates, reads, changes and deletes records — and its own app lets anyone
with the address change any record without signing in. So a draft has to live in Agent Analytics, and the document
reaches the Hub only when the leader submits it. The lock this feature adds holds everywhere in Agent Analytics; it
cannot reach into the Hub's own app (see Assumptions).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Save a coaching document as a draft and come back to it (Priority: P1)

A team leader starts a coaching document, fills in part of it, and saves it as a draft. Later — the same day or another
day, on the same or another device — they reopen the draft from their list, carry on editing, and save again.

**Why this priority**: coaching conversations often span a call review and a sit-down; a document that must be
finished in one sitting is either rushed or kept on paper first.

**Independent Test**: save a draft, sign out, sign in on another browser, reopen it: every field typed (and any
signature drawn) is there; edit it and save again: the new content replaces the old.

**Acceptance Scenarios**:

1. **Given** a partly filled coaching form, **When** the leader presses Save draft, **Then** the draft is kept and
   appears in their Drafts list with the product, agent and when it was last saved — and nothing is written to the Hub.
2. **Given** a draft in the list, **When** the leader opens it, **Then** the form shows exactly what was saved,
   signatures included, and can be edited and saved again.
3. **Given** a draft, **When** the leader deletes it (and confirms), **Then** it is gone from the list and nothing
   reaches the Hub.
4. **Given** a draft belonging to one team leader, **When** any other user (another leader, an agent) asks for it,
   **Then** they cannot see or change it.
5. **Given** the same draft open in two tabs, **When** both save, **Then** the second save is refused with a message
   telling the leader the draft changed elsewhere — no silent overwrite.

---

### User Story 2 - Submit locks the document (Priority: P1)

When the document is complete the leader presses Submit. After confirming, the document goes to the Coaching Hub. From
then on the leader sees a line for it — agent, product, date, "Submitted" and whether it was signed — but cannot open,
read, edit or print it anywhere in Agent Analytics.

**Why this priority**: this is the requirement as written — a submitted coaching document is a record, and the leader
who wrote it must not be able to revisit it.

**Independent Test**: submit a draft; the Hub holds the document; the leader's lists show the line with no open/view
action and no comment text; every team-leader screen that summarises coaching carries no written content of it.

**Acceptance Scenarios**:

1. **Given** a draft, **When** the leader presses Submit and confirms, **Then** the document is created in the Hub, the
   draft disappears from Drafts, and a "Submitted" line appears in their sessions.
2. **Given** a submitted document, **When** the leader looks at their sessions or "All forms", **Then** the line shows
   agent, product, date, Submitted and the signature state — and there is no way to open it and no comment text.
3. **Given** a submitted document, **When** the leader opens the agent's page (drill-in), the help-center theme story,
   or the "coaching on your agents by others" block, **Then** no written content of any submitted coaching document
   is shown or delivered to their browser.
4. **Given** the leader presses Submit twice quickly, or on two tabs, **Then** exactly one document reaches the Hub.
5. **Given** the Hub refuses the document (or cannot be reached), **When** the leader submits, **Then** they are told,
   and the draft is still there, unchanged, to try again.
6. **Given** a document with a signature missing, **When** the leader presses Submit, **Then** the confirmation names
   the missing signature; they may still submit (the Hub accepts unsigned documents).

---

### User Story 3 - A signature always covers what was finally submitted (Priority: P2)

Signatures can be drawn at any point while drafting and are saved with the draft. If anything in the document is
changed after a signature was drawn, the signatures are cleared and the leader is told to sign again.

**Why this priority**: a signature attests to the wording beside it; without this rule a document could be signed,
then rewritten, then submitted under the old signatures.

**Independent Test**: sign a draft, change one comment: both signature boxes empty with a notice; save: the stored draft
holds no signatures. Sign again without changing anything: the signatures stay through save and submit.

**Acceptance Scenarios**:

1. **Given** a draft with signatures, **When** the leader changes any field of the document, **Then** every signature
   on it is cleared at once, with a visible notice.
2. **Given** a stored signed draft, **When** a save or submit arrives whose content differs from the stored draft but
   carries the stored signatures unchanged, **Then** those signatures are dropped before anything is kept or sent to
   the Hub, and the reply says so.
3. **Given** a signed draft that is reopened and submitted without changes, **Then** the Hub document carries the
   signatures.

### Edge Cases

- A brand-new form submitted without ever being saved as a draft: it goes straight to the Hub and is locked the same way.
- A draft whose Submit was interrupted after the Hub accepted it but before the draft was removed: it is shown as
  "Submitting — check your sessions before trying again" and cannot be submitted a second time without a deliberate
  choice to reopen it.
- A draft for an agent who has since left the Agent List: the draft stays the leader's to finish or delete.
- A very large draft (e.g. a group session with many signed attendees): saved if within the size bound, refused with a
  plain message beyond it — never truncated silently.
- More drafts than the per-leader limit: a new draft is refused with a message asking the leader to submit or delete one.
- Agents still read the content of their own submitted coaching on their own card; campaign managers' views are
  unchanged.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Team leaders MUST be able to save a coaching document of any of the six products as a draft without it
  reaching the Coaching Hub.
- **FR-002**: Team leaders MUST be able to list, reopen, edit, re-save and delete their own drafts; a draft MUST be
  visible and changeable only by the leader who created it.
- **FR-003**: Saving a draft MUST be refused, not overwrite, when the draft changed elsewhere since it was opened.
- **FR-004**: Submit MUST ask for confirmation, naming any missing signature, then create the document in the Hub and
  remove the draft; a failed submit MUST leave the draft unchanged.
- **FR-005**: A draft MUST reach the Hub at most once, whatever is double-clicked or opened twice.
- **FR-006**: After submit, every team-leader screen in Agent Analytics MUST show a submitted coaching document only as
  a line (agent, product, date, Submitted, signature state) with no way to open it, and the server MUST NOT deliver
  the document's written content to a team leader's browser on any route.
- **FR-007**: The Hub tab KEEPS its link to the Coaching Hub app (decided with the user, 2026-10-05) but MUST NOT describe it as the place to edit or print a submitted document.
- **FR-008**: Signatures drawn on a draft MUST be saved with it and shown again when it is reopened.
- **FR-009**: Changing any content of a document after a signature was drawn MUST clear all its signatures, with a
  notice, in the form; and the server MUST drop a stored signature that arrives unchanged beside changed content.
- **FR-010**: Drafts MUST NOT travel to any other user, to any report, or to the coaching copy.

### Key Entities

- **Coaching draft**: one unfinished coaching document owned by one team leader — the product, the document content,
  any signatures drawn, when it was created and last saved, and its state (draft, or submitting).
- **Submitted coaching document**: the record in the Coaching Hub; to its author it is a line in a list, never a
  document they can open.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A team leader can save, leave, and later resume a coaching document with 100% of what they entered
  (signatures included) restored.
- **SC-002**: 0 submitted coaching documents can be opened or read by a team leader anywhere in Agent Analytics, and
  0 team-leader responses carry their written content.
- **SC-003**: Every submit produces exactly one document in the Hub (0 duplicates under double-click or two tabs).
- **SC-004**: 0 documents reach the Hub carrying a signature that was drawn before the content last changed.

## Assumptions

- **The Hub's own app is outside this lock.** It needs no sign-in and lets any leader edit any record; Agent Analytics
  cannot stop a leader who goes there directly. Closing that is a decision for Nick (retire leaders' use of the Hub app,
  or ask its owner for logins). The Hub tab keeps its link to the app (the user's decision, 2026-10-05) without inviting edits of a submitted document.
- Classification themes (the dropdown labels such as "Objection Handling") are not the written document: team leaders
  keep seeing theme chips and coverage counts, which drive coaching analysis; only written text is withheld.
- Signature images in drafts are kept in Agent Analytics' own store only until the draft is submitted or deleted;
  there is no automatic expiry, so nothing a leader is part-way through is lost.
- Limits: at most 50 drafts per leader; a draft at most 1.5 MB (a drawn signature is 5–18 KB).
- KPI forms are unchanged (the KPI Hub already has its own draft/submit).
- Feature 003 is delivered with this one: its "session view" and "notes in the team leader's lists" requirements
  apply to drafts only, because a submitted document can no longer be opened by its author.
