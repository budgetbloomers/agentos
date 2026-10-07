---

description: "Task list — 004 coaching drafts with a submit lock (delivered with 003)"
---

# Tasks: Coaching drafts with a submit lock

**Input**: `/specs/004-coaching-drafts-submit-lock/` — spec.md, plan.md, research.md, contracts/interfaces.md, quickstart.md

**Tests**: REQUIRED (Constitution VII) — `nicks_code/diagnostics/verify-coaching-drafts.mjs`, written first, seen red.
Never touches the live Hub or the live database: drafts.mjs runs against an in-memory PostgREST fake; Convex is a stubbed
`fetch`; the page runs in a stubbed DOM.

**Depends on**: feature 003 (`specs/003-coaching-comments-signature/tasks.md` T001–T016), built in the same change.

## Phase 1: Setup

- [x] T001 Baseline green: verify-agent-analytics, verify-live-month-page, verify-coaching-attribution, verify-coaching-wave, verify-agent-portal, verify-help-repeat (nicks_code/diagnostics/)

## Phase 2: Foundational

- [x] T002 nicks_code/diagnostics/verify-coaching-drafts.mjs harness: in-memory `rules` store implementing the DB interface used by drafts.mjs (`select` with `key=eq.` / `key=like.<prefix>*` / `select=key,updated_at,meta:value->meta`, `insert`, `updateReturning` with `updated_at=eq.`, `update`, `del`); stubbed Convex fetch recording `{path,args}`; page loader (pattern of verify-live-month-page.mjs)

## Phase 3: User Story 1 — Drafts (P1) 🎯 MVP

- [x] T003 [P] [US1] Suite section A (Worker): save new → row `coach-draft:<uid>:<uuid>` with `meta` + `data`, NO Convex call; list (D1) returns meta only — no `data`, no `data:image` anywhere; open (D2) returns data to the owner and 404 to another uid; save with stale `base` → 409 `conflict:true`, row unchanged; delete; 51st draft → 409; > 1.5 MB → 413; a team leader without hub ids → the hubIdsOf refusal — RED
- [x] T004 [P] [US1] Suite section B (page): Save draft posts `{action:'save', type, data}` (and `id`,`base` once saved); Drafts card lists product, agent, last saved, signature line, Open, Delete; Open fills the form (signatures shown as images); a 409 shows "changed elsewhere" and keeps the form — RED
- [x] T005 [US1] worker/src/drafts.mjs: list/open/save/delete per contracts D1–D4 ("at most 50 drafts", "a draft at most 1.5 MB"); key always built from `user.user_id`
- [x] T006 [US1] worker/src/index.mjs `/api/portal/hub/coaching/drafts` (GET list|open, POST action) behind `hubIdsOf`; worker/src/portal.mjs adds the path to the portal route allow-list
- [x] T007 [US1] agent/index.html: `CFORM.draftId/base`, Save draft / Delete draft buttons, Drafts card in coachHubPage, `HUB.drafts` loaded with the Hub tab, open-a-draft flow
- [x] T008 [US1] Sections A + B GREEN

## Phase 4: User Story 2 — Submit locks (P1)

- [x] T009 [P] [US2] Suite section C (Worker): submit (D5) claims `submitting` by compare-and-set then calls `<table>:create` ONCE and deletes the row; a second submit on the same base → 409 and no second Convex call; Convex failure → row back to `draft`, error returned with the new `updatedAt`; reopen (D6) only after 2 minutes; `coachingList` rows carry ONLY the L1 allow-list (+`_sigs`, `attendees` count) — deep scan finds no comment field, no `calls`, no `data:image`; `coachingOthers` rows have no `supportProvided`; `agentDetail` for a team leader: sessions carry no `COACH_TEXT_FIELDS` / `callNotes`, while for a campaign manager they do; `failDetail` for a team leader: every `note` is `''` — RED
- [x] T010 [P] [US2] Suite section D (page): Submit asks for confirmation naming missing signatures, posts `{action:'submit', id, base, data}` (or the plain create for a never-saved form), closes the form and refreshes; "Your sessions" rows show agent · product · date · SUBMITTED · signature line with NO View button and NO Notes column; "All forms" coaching rows: drafts → DRAFT + Open, submitted → SUBMITTED, no action; no `data-coach-view` anywhere; the footer no longer contains "edit a session you already saved"; a `submitting` draft shows "check your sessions" + Reopen — RED
- [x] T011 [US2] worker/src/drafts.mjs submit + reopen (D5, D6), reusing hubs.mjs `coachingCreate`
- [x] T012 [US2] worker/src/coaching.mjs `COACH_TEXT_FIELDS` + `withoutText()`; worker/src/hubs.mjs `leaderRow()` (L1) applied in `coachingList`; worker/src/portal.mjs `agentDetail` (team leader) + `coachingOthers`; worker/src/help.mjs `failDetail` (team leader) (L2)
- [x] T013 [US2] agent/index.html: Submit button + confirm; locked session rows; All forms rows; remove `coachView`/`coachRows`/`CO_HIDE` and every `data-coach-view` handler; footer text; agent card renders a session with no text as a plain line (no empty expander)
- [x] T014 [US2] Sections C + D GREEN

## Phase 5: User Story 3 — Signatures cover the final wording (P2)

- [x] T015 [P] [US3] Suite section E: page — with a signature present, `cSet` on any non-signature path empties every signature path (incl. `employeeSignoffs.N.signature`) and shows "The document changed after it was signed — signatures cleared, please sign again."; a signature path itself never clears the others; Worker — stored signed draft + changed content + identical signature bytes → signature dropped and named in `cleared`; changed content + NEW signature bytes → kept; unchanged content → kept; same rule on submit (the Hub create receives no stale signature) — RED
- [x] T016 [US3] agent/index.html `cSet` clearing + targeted re-init of the cleared signature boxes; worker/src/drafts.mjs `staleSigs()` applied on save and submit
- [x] T017 [US3] Section E GREEN

## Phase 6: Polish

- [x] T018 Reviews: ecc:code-reviewer + ecc:security-reviewer over drafts.mjs, the leader stripping, the route and the page; fix CRITICAL/HIGH/MEDIUM
- [x] T019 Register verify-coaching-drafts + verify-coaching-signature in .github/workflows/verify.yml; full credential-free suite green
- [x] T020 CLAUDE.md (+ constitution if a principle moves): "a submitted coaching document is never shown to a team leader" — one line beside the Coaching Hub rules
- [ ] T021 `node tools/prepare-site.js`; deploy Worker → Pages; post-deploy smoke — needs Nick's go-ahead
- [ ] T022 Live check per quickstart.md
- [ ] T023 Commit (conventional), no push

## Dependencies

- 003 T005 (sigPad fix) before T016; 003 T010 (`_sigs`) before T009's list checks.
- T002 → tests → implementation → GREEN per story; US1 before US2 (submit acts on a draft).

## Parallel execution

- Worker: T003, T005, T006, T009, T011, T012 · Page: T004, T007, T010, T013, T015 (page half), T016
