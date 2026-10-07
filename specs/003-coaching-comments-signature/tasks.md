---

description: "Task list — 003 coaching comments show, signatures save"
---

# Tasks: Coaching comments show, signatures save

**Input**: `/specs/003-coaching-comments-signature/` — spec.md, plan.md, research.md, data-model.md, contracts/interfaces.md, quickstart.md

**Tests**: REQUIRED (Constitution VII) — written first, seen red. One new suite,
`nicks_code/diagnostics/verify-coaching-signature.mjs`, sections A–F below. It never calls the live Hub: the page runs
in a stubbed DOM (pattern: `verify-live-month-page.mjs` `loadPage`) and the Worker modules run with a stubbed `fetch`
that records the Convex `{path, args}` it was asked for.

**Superseded in part by 004 (2026-10-05)**: T009/T011 drop the `coachView` "Signatures" row (004 removes the session
view) and keep the row's signature line; T013/T015 keep `coachSaid`/`coachAgreed` for the agent card but drop `coachNote`
on the team leader's lists (004 shows no written content of a submitted session to a team leader).

**Owners**: **WP-P** page (`agent/index.html`); **WP-W** Worker (`worker/src/hubs.mjs`, `worker/src/coaching.mjs`);
**WP-T** tool (`tools/audit-hub-signatures.mjs`). No WP edits another WP's files.

## Phase 1: Setup

- [x] T001 Baseline the related suites green before any change: `verify-agent-analytics`, `verify-live-month-page`, `verify-coaching-attribution`, `verify-coaching-wave`, `verify-agent-portal` (nicks_code/diagnostics/)

## Phase 2: Foundational

- [x] T002 Create nicks_code/diagnostics/verify-coaching-signature.mjs with: a page loader exposing `wireCoachForm`, `coachOpen`, `coachSave`, `coachHubPage`, `allFormsPage`, `coachView`, `coachHTML`, `sigPad`, `cGet`, `CFORM`/`HUB` setters; a stub `document` whose `querySelectorAll('.sig')` returns fake boxes and whose `createElement('canvas')` returns a fake canvas recording its listeners, with `toDataURL()` → `'data:image/png;base64,TEST'`; a Worker harness importing `worker/src/hubs.mjs` and `worker/src/coaching.mjs` with `globalThis.fetch` stubbed per Convex path

## Phase 3: User Story 1 — A signed document is saved signed (P1) 🎯 MVP

**Goal**: every signature drawn on any coaching form reaches the Hub create; a malformed one refuses the save.
**Independent test**: section A + B of the suite.

- [x] T003 [P] [US1] WP-P — suite section A: for each of the six products (`coachOpen(type)`), every `.sig` box drawn (mousedown → mousemove → window mouseup, and touchstart → touchmove → touchend) leaves `data:image/png;base64,TEST` at that box's path in `CFORM.data` (agentSignature, teamLeaderSignature, sosSignature, employeeSignoffs.N.signature); drawing sets `CFORM.dirty === true`; the Clear button empties the path; `coachSave` posts a body carrying the signatures; static guard — every `sigPad(` call site in agent/index.html passes at most 3 arguments — RED
- [x] T004 [P] [US1] WP-W — suite section B: `coachingCreate` forwards a valid `data:image/…` signature unchanged to `<table>:create`; a SUPPLIED signature that is not `data:image/…` or is longer than 250,000 characters returns `400` with an error naming the signatory ("The team leader signature could not be read — clear it and sign again.") and makes NO Convex call; `''`/absent still creates unsigned; same rules for each `employeeSignoffs[i].signature` — RED
- [x] T005 [US1] WP-P — agent/index.html `wireCoachForm` (line ~3071): `sigPad(box, box.getAttribute('data-sig'), cSet)` — the writer, not the reader (research R1)
- [x] T006 [US1] WP-W — worker/src/hubs.mjs `coachingCreate`: refuse a supplied-but-unacceptable signature (top-level and signoff rows) per contracts C2, before any Convex call (research R2)
- [x] T007 [US1] Sections A + B GREEN

## Phase 4: User Story 2 — The new view says whether a document is signed (P1)

**Goal**: the leader sees, per session, which signatures the Hub holds — without any image reaching the browser.
**Independent test**: sections C + D.

- [x] T008 [P] [US2] WP-W — suite section C: `coachingList` rows carry `_sigs` = one `{field, label, signed}` per signatory the product declares (formal/informal/QA → Agent, Team leader; lead management → Agent, SOS; group and scorecard → `[]`), `signed` true only for a non-empty image, false when the key is ABSENT from the record; group `employeeSignoffs[i]` keep `employeeName`/`date`, gain `signed`, lose `signature`; a deep scan of the whole payload finds no `data:image` string — RED
- [x] T009 [P] [US2] WP-P — suite section D: `coachSigLine(s)` → "Signed by agent and team leader" / "Not signed by team leader" / "Not signed by agent or team leader" / `''` for `_sigs: []`; the "Your sessions" row and `coachView` drawer print it; after `coachSave` succeeds the refreshed page names the new session's signature state; all through `esc()` — RED
- [x] T010 [US2] WP-W — worker/src/hubs.mjs `strip` → presence facts per contracts C1; declared signatories derived from `CREATE_SPEC[table].fields` ending in `Signature`; nested `employeeSignoffs[].signature` removed (research R3)
- [x] T011 [US2] WP-P — agent/index.html `coachSigLine`; signature line on the "Your sessions" row (coachHubPage, line ~3293) and a "Signatures" row in `coachView`; post-save confirmation in `coachSave` naming what the Hub holds
- [x] T012 [US2] Sections C + D GREEN

## Phase 5: User Story 3 — Formal coaching comments appear wherever a session is summarised (P2)

**Goal**: formal sessions show their comment in both TL lists and "What was discussed" on the agent card; no contact
number reaches an agent.
**Independent test**: section E.

- [x] T013 [P] [US3] WP-P + WP-W — suite section E: `coachNote(s)` per product (formal → supportProvided, else call developmentAreas joined, else agreedPlanAgentFeedback; informal → teamLeaderFeedback, else wayForward; QA → developmentAreas, else teamLeaderComments; lead management → developmentAreas, else sosComments; group → coachingDetails; scorecard → call1Notes/call2Notes/call3Notes); "Your sessions" and "All forms" show a formal session's note, a dash when it has none; `coachHTML` for a formal copy session prints "What was discussed" with the call notes and support provided and "What you agreed" with the agreed plan; other products' cards unchanged; `normalise()` gives formal sessions `callNotes` ("each ≤ 600 chars, empties dropped", ≤ 3) and the copy contains no `contactNumber` — RED
- [x] T014 [US3] WP-W — worker/src/coaching.mjs `normalise`: add `callNotes` from `rec.calls[].developmentAreas`, never `contactNumber` (contracts C3, research R5)
- [x] T015 [US3] WP-P — agent/index.html `coachNote`, `coachSaid`, `coachAgreed`; use `coachNote` at "All forms" (line ~3183) and "Your sessions" (line ~3299); use `coachSaid`/`coachAgreed` in `coachHTML` (lines ~5527–5528), listing call notes one per line
- [x] T016 [US3] Section E GREEN

## Phase 6: Remediation — sessions already saved unsigned (FR-010)

- [x] T017 [P] WP-T — new tools/audit-hub-signatures.mjs, READ-ONLY (Convex `query` only, never `mutation`): `--since YYYY-MM-DD`; lists sessions written by the new view (CB in roster shape `CB123`, not the Hub form's `CB-123`; the shape judged by is printed) that lack a declared signature — date, product, team leader, CB; no signature bytes; suite section F asserts the tool source contains no `/api/mutation`
- [x] T018 Run the tool; hand the list (expected: Denise Haripersad — formal 30 Sep ×2, informal ×1, plus any QA/LM) to Nick for re-signing in the Hub app

## Phase 7: Polish

- [x] T019 Reviews: ecc:code-reviewer (page + Worker), ecc:security-reviewer (proxy payloads: no images, no contact numbers to agents, refusal path); fix CRITICAL/HIGH/MEDIUM
- [x] T020 Register `verify-coaching-signature` in .github/workflows/verify.yml; full credential-free suite run green
- [ ] T021 `node tools/prepare-site.js`; deploy Worker → Pages; mandatory post-deploy smoke (`verify-cors-headers --live`, `verify-live-save --live`) — needs Nick's go-ahead
- [ ] T022 Live check per quickstart.md (record + sign one session with a TL account, confirm both signatures in the Hub app; audit tool shows no new unsigned new-view sessions)
- [ ] T023 Commit (conventional), no push

## Dependencies

- T001 → T002 → each story's tests (T003/T004, T008/T009, T013) → that story's implementation → its GREEN task.
- US1, US2 and US3 are independent of each other; US2's list check is most useful once US1 makes new sessions signed.
- T017 depends only on T002 (section F); T018 on T017. T019–T023 after all GREEN tasks.

## Parallel execution

- WP-P: T003, T005, T009, T011, T013 (page half), T015
- WP-W: T004, T006, T008, T010, T013 (Worker half), T014
- WP-T: T017

## Implementation strategy

MVP = User Story 1 alone (T001–T007): a one-line page fix plus the Worker refusal — every signature drawn from then on
is saved. Ship US2 with it if possible (the leader can then SEE the fix working), US3 next. The three already-unsigned
sessions are repaired by re-signing in the Hub app (T018), not by this code.
