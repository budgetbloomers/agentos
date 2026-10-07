# Research: Coaching comments show, signatures save

All findings below were confirmed on 2026-10-05 from the code and from a READ-ONLY query of the live Coaching Hub
(`teamLeaders:list` + `<product>:list`, printing presence/lengths only — no names, no images).

## R1 — Why a drawn signature never saves

- **Decision**: call the signature pad with the coaching form's WRITER: `sigPad(box, path, cSet)`.
- **Evidence**: `agent/index.html:3071` calls `sigPad(box, box.getAttribute('data-sig'), cGet, cSet)`;
  `agent/index.html:3807` declares `function sigPad(box, path, set)`. The third argument (`cGet`, the reader) becomes
  `set`; the pad's `end` handler calls `set(path, canvas.toDataURL())` → `cGet(path, …)` returns the current value and
  writes nothing. `CFORM.data.<x>Signature` stays `''`; `coachSave` posts `''`; `hubs.mjs sig('')` is `''`; the field is
  omitted from the Convex create; the record has no signature.
- **Why it hid**: the canvas keeps the ink (nothing re-renders), and the session list the new view reads strips every
  signature (`hubs.mjs strip`), so no surface in the new view could show the gap.
- **Live proof**: the Hub's own form hyphenates the CB number (`CB-123`); the new view posts the roster code (`CB123`).
  Formal + informal sessions since 2026-08-20: new view 3 written, 0 signed; Hub app 396 written, 379 signed. The KPI
  forms call `sigPad(box, path)` (default setter `fSet`) and are unaffected.
- **Alternatives considered**: make `sigPad` take `(box, path, get, set)` — rejected, the pad never reads; one writer
  argument is the honest signature. A guard test pins every call site to ≤ 3 arguments.

## R2 — A signature the Worker cannot accept is dropped silently

- **Decision**: `coachingCreate` refuses (400, naming the signatory) when a signature value is SUPPLIED (non-empty) but
  is not a `data:image/` URL within `MAX_SIG`; an empty value still means "not signed".
- **Rationale**: Principle VI — a save that silently loses part of a document is the bug class this feature is about.
  The page keeps the form open on any error, so nothing typed is lost.
- **Alternatives**: keep dropping and add a warning field — rejected, the page would have to remember to read it.

## R3 — Showing whether a session is signed without shipping images

- **Decision**: the list proxy replaces signature images with presence facts: each row gets `_sigs` — one entry per
  signatory the PRODUCT declares (derived from `CREATE_SPEC[table].fields` ending in `Signature`), `signed: true|false`.
  An unsigned record omits the key entirely, so presence must be judged against the product's declared signatories,
  never against the keys a record happens to carry. Group attendee rows keep `employeeName`/`date` and gain `signed`;
  their `signature` image is removed.
- **Side finding fixed by the same change**: `strip()` only looks at top-level keys, so group-coaching attendee
  signatures (`employeeSignoffs[].signature`, base64 PNG) currently DO travel to the team leader's browser — the
  POPIA/bandwidth rule the snapshot already follows is broken on the live list.
- **Alternatives**: fetch each record's images on demand to render them — rejected (images are POPIA material and the
  Hub app already renders the signed document; presence is what the leader needs).

## R4 — Which text is a session's "comment"

- **Decision**: one page helper per purpose, keyed on the product (`_table` on the live list, `collection` on the copy):
  - Note (lists): formal → support provided, else the call development areas, else the agreed plan; informal → team
    leader feedback, else way forward; QA → development areas, else team leader comments; lead management →
    development areas, else SOS comments; group → coaching details; scorecard → call 1/2/3 notes.
  - Agent card "What was discussed": formal → call development areas + support provided; others as today
    (team leader comments / development areas / team leader feedback).
  - "What you agreed": unchanged (agent feedback / agreed plan / way forward).
- **Rationale**: the existing chain was written for informal/QA field names; formal has none of them. Keying on the
  product makes each mapping explicit and testable.

## R5 — The copy drops the calls

- **Decision**: `normalise()` in `worker/src/coaching.mjs` adds `callNotes: string[]` — each call's
  `developmentAreas`, trimmed, empties dropped, each capped at 600 characters — and never the `contactNumber` (a
  customer's phone number; it must not reach an agent-facing payload).
- **Size**: ~300 formal sessions × ≤ 3 notes × ~300 chars ≈ 0.3 MB more in the copy; the copy is read once per
  10-minute Worker cache and is already several MB of sessions. The wave budget (Convex calls per invocation) is
  unaffected — the same records are fetched; only what is kept changes.
- **Alternative**: concatenate into one capped string — rejected; the agent card lists calls one per line.

## R6 — Sessions already saved unsigned

- **Decision**: a read-only tool lists new-view-written sessions with a missing declared signature (date, product, team
  leader, CB) so the leader can re-sign them in the Hub app, which supports editing. Re-signing inside the new view is
  out of scope (spec Assumptions).
- **Caveat**: the CB-shape test is exact for formal/informal (the Hub form always hyphenates); for QA the Hub accepts a
  typed CB, so a QA record in `CB123` shape may be Hub-written. The tool reports the shape it judged by.
