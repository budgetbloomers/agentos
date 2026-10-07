# Research: Coaching drafts with a submit lock

## R1 — Where a draft lives

- **Decision**: the Worker's `rules` table, one row per draft, key `coach-draft:<app_user id>:<uuid>`, written only by a
  new `worker/src/drafts.mjs`. No migration.
- **Why not the Hub**: the Convex Coaching Hub has create / get / list / update / remove and NO status field (checked in
  its deployed bundle, 2026-10-05); its create validates arguments strictly, so a `status` cannot be added; and every
  Hub record is visible and editable in its app with no sign-in. A draft written there is not a draft.
- **Why outside `kv:`**: `/api/kv` and `/api/kv-meta` only ever address `kv:`-prefixed keys, so a `coach-draft:` row is
  unreachable through any generic store route; only drafts.mjs reads it, always under the SESSION's own user id — there
  is no request shape that names another leader's draft (same rule as hubs.mjs).
- **Why per-draft rows**: two drafts never contend; one draft's version is its row's `updated_at`, used as a
  compare-and-set filter exactly like `/api/kv` (`updated_at=eq.<encoded base>` + `updateReturning`; empty result =
  somebody else got there first).
- **Alternatives**: a new `coaching_drafts` table (cleaner DDL, but a production migration for a key/value need the
  existing store already meets); browser storage (lost on another device — fails SC-001).

## R2 — Listing without shipping signatures

- **Decision**: every save also writes `value.meta` = {type, state, agentName, employeeNumber, date, sigs[], createdAt};
  the list reads `select=key,updated_at,meta:value->meta` so neither content nor images leave the database for a list.
  Only "open one draft" returns `value.data`, to its owner.

## R3 — Submit exactly once

- **Decision**: submit = (1) compare-and-set the row to `state:'submitting'` on the caller's base version (a second
  click or tab loses the race → 409); (2) the existing `coachingCreate` (all of feature 003's validation); (3) on success
  delete the row (fallback: mark `state:'submitted'`, which the list hides); on failure put the row back to
  `state:'draft'` and return the error. A row left `submitting` (Worker died between Hub accept and delete) lists as
  "Submitting — check your sessions"; `reopen` returns it to draft only after 2 minutes, on a deliberate click.
- **Alternatives**: idempotency key in the Hub — impossible, the Hub's create takes no such argument.

## R4 — "Must not be able to view" enforced on the server

- **Decision**: one helper, `withoutText(session)` in `worker/src/coaching.mjs`, removes every written-content field
  (the normalise TEXT list + `callNotes`, + the live record's free-text fields) and is applied on EVERY route that gives
  a team leader coaching sessions:
  - `hubs.coachingList` (the leader's live list) → rows reduced to an ALLOW-list of metadata + `_sigs`;
  - `portal.agentDetail` when the caller is a team leader (drill-in into an agent);
  - `portal.coachingOthers` (team-leader only) → `supportProvided` dropped;
  - `help.failDetail` when the caller is a team leader → `note` empty.
  Agents' own overview and campaign managers' coaching are unchanged.
- **Why the server**: Constitution V — role scoping is enforced in the Worker, never by hiding UI. A hidden button with
  the text still in the payload is not "cannot view".
- **Kept**: classification theme labels and counts (they drive the coaching analysis; they are dropdown choices, not the
  written document) — spec Assumptions.

## R5 — Signatures cover the final wording

- **Decision**: page — `cSet` on any non-signature path clears every signature on the form (incl. group attendee rows)
  and shows a notice; server — on save and submit, when a stored draft exists, compare the content (data minus every
  signature, canonical JSON) with the stored content; if it differs, any incoming signature byte-identical to the stored
  one is dropped and named in `cleared[]`. A freshly drawn signature (different bytes) is kept.
- **Alternatives**: hash-stamp each signature with the content hash — equivalent guarantee, more state.

## R6 — The way round the lock

- The Hub app (coaching-hub-psi.vercel.app) needs no sign-in and edits any record. Agent Analytics cannot close it.
  The Hub tab keeps its link to the app (decided with the user, 2026-10-05); only the sentence inviting leaders to "edit a session you already saved, or to print one" there is reworded;
  closing the app to leaders is Nick's decision (reported, not built).
