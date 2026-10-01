---

description: "Task list — 002 live month, scheduled referrals, coaching"
---

# Tasks: Live month, scheduled referrals, fresh and complete coaching

**Input**: `/specs/002-live-month-sync-coaching/` — spec.md, plan.md, research.md, contracts/interfaces.md

**Tests**: REQUIRED (Constitution VII) — written first, seen red.

**Owners**: **WP-A** engine + tools (`nicks_code/index.html`, `tools/digest-republish.mjs`, `tools/tick-local.mjs`,
`tools/sync-referrals.mjs`); **WP-B** Worker (`worker/src/*.mjs`); **WP-C** page (`agent/index.html`). No WP edits
another WP's files.

## Phase 1: Setup
- [x] T001 Baseline the related suites green (verify-agent-analytics, verify-cm-view, verify-cm-signoff-worker, verify-cm-digest, verify-coaching-wave, verify-digest-fence, verify-store-freshness, verify-campaign-manager, verify-agent-portal, verify-help-repeat)

## Phase 2: User Story 1 — Live month (P1) 🎯 MVP
- [x] T002 [P] [US1] WP-A — new nicks_code/diagnostics/verify-empty-month.mjs: an empty current month builds the C1 payload (empty:true, null figures, list agents, month target, comm = current model); never zeros; the tool publishes it live instead of the previous month, rewrites the previous month's history key, and refuses (mirrors C2) an empty payload over a non-empty live month — RED
- [x] T003 [P] [US1] WP-B — extend verify-digest-fence.mjs: `empty_over_data` 409 (pointer `empty` stamp), current month always allowed otherwise, older months never; health quiet for the empty current month — RED
- [x] T004 [P] [US1] WP-C — new nicks_code/diagnostics/verify-live-month-page.mjs: agent Today / My Progress, TL My Team + Reports, CM Campaign tab render the empty state ("No October figures yet — the first day lands after tomorrow morning's uploads"), no figures, a "September (final)" link that re-asks ?month=2026-09 and a way back; CM also offers the billing month in progress; Projected Commission shows the first payout at 0 worked days of the current month — RED
- [x] T005 [US1] WP-A — nicks_code/index.html emptyMonthPayload + agentDigestPayload fallback; tools/digest-republish.mjs: publish the empty current month, rewrite previous month final, fence mirror
- [x] T006 [US1] WP-B — worker/src/rules.mjs + index.mjs fence (`empty_over_data`, pointer `empty` stamp); health.mjs wrong-month logic accepts the empty current month
- [x] T007 [US1] WP-C — agent/index.html empty states, (final) link + back, first-payout at 0 days in the current month, CM empty current month offers
- [x] T008 [US1] T002–T004 GREEN

## Phase 3: User Story 2 — Referrals at 08:00 and 14:00 (P1)
- [x] T009 [P] [US2] WP-A — new nicks_code/diagnostics/verify-referrals-schedule.mjs: tick slot gating (08:00/14:00 SAST, every day incl. weekends, once per slot, before agent-digest), sync-referrals writes C3 shapes and deletes its session, digest-republish ingests kv:referrals-latest when newer, PULSE adopts it on boot/focus/poll only when newer than S.refs.at — RED
- [x] T010 [P] [US2] WP-B — extend verify-store-freshness.mjs: `referrals-slot-missed` warning (> 2 h past slot, no ok entry) and self-clearing; `/api/kv` GET allows referrals-latest for staff only — RED
- [x] T011 [US2] WP-A — tools/sync-referrals.mjs (new), tools/tick-local.mjs slot step, tools/digest-republish.mjs ingest, nicks_code/index.html adoption
- [x] T012 [US2] WP-B — worker/src/health.mjs (+ collector) referrals-slot-missed; index.mjs kv GET allow-list
- [x] T013 [US2] T009–T010 GREEN

## Phase 4: User Story 4 — Lead-management coaching visible (P1)
- [x] T014 [P] [US4] WP-B — new nicks_code/diagnostics/verify-coaching-attribution.mjs: sessions with a CB attributed to the agent's current TL with `coach`/`coachIsTl`; hub tab `others` = snapshot sessions on the TL's agents under another profile; cmCoaching owner by agent TL (scope unchanged); byType incl. 'Lead Management Coaching' + lmCount; coachAnalysis/themes include `*.lead_management`; a Dalwin-LM fixture reaches the right TL — RED
- [x] T015 [P] [US4] WP-C — verify-live-month-page.mjs (part B): TL coaching views show type counts with LM separate, "No lead-management coaching logged in <period>" when 0, the "Coaching on your agents by others" block with coach names, LM themes in theme chips (drawer, agent coaching card, team card) — RED
- [x] T016 [US4] WP-B — worker/src/coaching.mjs, portal.mjs, hubs.mjs attribution, others, types, themes
- [x] T017 [US4] WP-C — agent/index.html coaching views
- [x] T018 [US4] T014–T015 GREEN

## Phase 5: User Story 3 — Coaching fresh daily (P2)
- [x] T019 [P] [US3] WP-B — extend verify-coaching-wave.mjs: a pull starts when the copy predates today's 05:30 SAST and now ≥ 05:30 SAST regardless of REFRESH_HOURS; `coachingAt` on every coaching payload — RED
- [x] T020 [P] [US3] WP-C — verify-live-month-page.mjs (part C): every coaching surface prints "Coaching Hub copy from <day time>"; the TL Hub tab says its own sessions are live from the Hub — RED
- [x] T021 [US3] WP-B — coaching.mjs daily force + coachingAt plumbing
- [x] T022 [US3] WP-C — stamps on every surface
- [x] T023 [US3] T019–T020 GREEN

## Phase 6: Polish
- [x] T024 Reviews: ecc:code-reviewer, ecc:security-reviewer (minted session, kv allow-list, coaching scope), ecc:typescript-reviewer; fix CRITICAL/HIGH/MEDIUM
- [x] T025 Full credential-free suite run; register new suites in verify.yml
- [x] T026 CLAUDE.md + constitution: the live month is always the current month (amend together)
- [x] T027 Deploy Worker → Pages → smoke; the tick republishes (empty October live, September final); live checks (agent/TL/CM empty state, (final) link, CM live check, verify-agent-card --live adapted to empty month); next referrals slot logged; coaching attribution live
- [x] T028 Commit (conventional), no push

## Parallel execution
- WP-A: T002, T005, T009, T011 · WP-B: T003, T006, T010, T012, T014, T016, T019, T021 · WP-C: T004, T007, T015, T017, T020, T022
