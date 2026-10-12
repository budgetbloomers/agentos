---

description: "Task list — 008 AgentOS video 1, The Agent Experience"
---

# Tasks: AgentOS video 1 — The Agent Experience

**Input**: `/specs/008-agent-experience-video/` — spec.md, plan.md

**Tests**: the capture fails on any shot with Chatterbox text or logo, Wimpy, an error/spinner, an unpainted table, or a
real name, and on any story step the product did not reach; the video is checked on rendered Raylight frames (review.md).

## Phase 1: Setup

- [x] T001 tools/demo/brand/: the official logo (downscaled copy), a white-wordmark copy made from the same file, the hex
  mark alone — all transparent PNG, proportions kept (1600×285, 1600×285, 494×525; viewed on black)

## Phase 2: User Story 1 — The agent's day, captured through the product (P1) 🎯 MVP

- [x] T002 [US1] tools/demo/story.mjs `brandServe()`: serve agent/index.html rewritten for the demo only — palette
  (navy→black, blue→#007338, light blues→greens), LOGO → ThroughBalls (black wordmark on light, white on the black
  sidebar), "The Chatterbox" → "AgentOS"; guard: every shot fails on /chatterbox/i text or the old logo bytes
- [x] T003 [US1] story walk: s01 sign-in · s02 Today · s03 behind-target tile panel · s04 My Progress · s05 help dialog
  (topic + note) · s06 request sent · s07–s09 Tumi's Help Center (new → seen → Waiting on agent) · s10 "Did Tumi sort it
  out?" · s11 after "Yes, I was helped" · s12 Tumi's My Team; assert each state through the product's own routes
- [x] T004 [US1] tools/demo-agent-experience.mjs: the one command — floor → VAS digest (no VAS shots) → backend → walk →
  checks → `Downloads\AgentOS Agent Experience` (1440×900 @2×); 005's folder untouched
- [x] T005 [US1] run; view every screen; fill "[the measure shown]" in plan.md from s02/s03 — 2026-10-06: 14/14 ok,
  leak check clean; measure = "Target achieved: 52%" (target 100%); s13 was stale (pinned clock froze the Help Center's
  refetch) → forced reload + assertion, recaptured; final text in raylight-build.md

## Phase 3: User Story 2 — The video (P1)

- [x] T006 [US2] editor tab connected — 2026-10-06: the user opened a NEW project "Agent Os " (e9e3f3b7-…); the build
  runs through the bundled CLI headless (this session predates the Raylight server); the first run stopped safely on the
  old id (cbd1a943 no longer in the account), the brief was re-pointed and the build resumed
- [x] T007 [US2] not needed — the old "Agent OS" project (stopped 007 build) no longer exists; the new project must be
  clean, and the build stops rather than delete anything it did not make
> 2026-10-07: the from-scratch build in "Agent Os " ran ~1 beat/hour and was stopped (user's choice: rebuild from a
> template). Templates researched read-only (50 free; linear-agent etc. are reference-only); **Limelight** (`T89DiaWb`)
> chosen — built for dark desktop screenshots. New brief: raylight-template-build.md (18 shots, ≈104 s, same captions).

- [x] T008 [US2] Phase A: start_from_template Limelight → new project; upload the 17 PNGs into it — 2026-10-07: project
  `90e8c1dd-dbe2-450d-a5d7-e4ac7d7af3b5` "AgentOS — The Agent Experience"; 17/17 uploads ok
- [ ] T009 [US2] Phase B: the user opens the new project; build shots 1–18 per raylight-template-build.md
- [ ] T010 [US2] remove every unused template scene/sample image/text
- [ ] T011 [US2] (merged into T009)
- [ ] T012 [US2] (merged into T009)

## Phase 4: User Story 3 — Checked, exported, ready to share (P2)

- [ ] T013 [US3] review every scene on rendered frames (captions character for character, logo, crop, overlap, real
  names, Chatterbox branding, loading); review.md; 0 open findings; 90–120 s
- [ ] T014 [US3] user exports; share page: title "AgentOS: Know Exactly What to Do Next", one-line description, private
- [x] T015 code review of tools/demo/story.mjs + tools/demo-agent-experience.mjs (ecc:code-reviewer) — 0 CRITICAL/HIGH;
  MEDIUM (colour rewrites unasserted) + 2 LOW (idle could give up silently; brand check skipped title/aria/placeholder)
  fixed; story recaptured 14/14 ok; 005 set re-run 59/59 ok after the checks.mjs extraction
