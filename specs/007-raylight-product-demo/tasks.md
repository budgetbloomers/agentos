---

description: "Task list — 007 Raylight product demo video"
---

# Tasks: Raylight product demo video

**Input**: `/specs/007-raylight-product-demo/` — spec.md, plan.md

**Tests**: the screenshot run checks every shot (now incl. Wimpy text and visible hub previews) and the leak check; the
video is checked on rendered Raylight stills, logged in review.md.

## Phase 1: User Story 1 — Demo material that is clean to show (P1) 🎯 MVP

- [x] T001 [US1] tools/demo-screenshots.mjs `shot()`: fail on "Wimpy" text or a visible hub/Wimpy preview image (red:
  005 shots 24 + 48)
- [x] T002 [P] [US1] tools/demo/backend.mjs: drop the fictional Wimpy link from `kv:agent-links`
- [x] T003 [P] [US1] tools/demo/pulse.mjs `apps` step: demo copy of `HUBS` without Wimpy, hub previews blanked
- [x] T004 [US1] regenerate the set (`node tools/demo-screenshots.mjs`): all shots ok, leak check clean; view Apps + Links
  — 2026-10-06: 59/59 ok incl. the new Wimpy + hub-preview checks; leak check clean; 24 + 48 viewed, no Wimpy, no previews
- [x] T004b [US1] found by eye on the crops: 02-vas-month-to-date-courtesy captured with its table BLANK (PULSE's
  `.tablewrap{content-visibility:auto}` not yet painted at capture; 005's run got lucky). Fix: tools/demo/pulse.mjs
  PAGE_CSS paints `.tablewrap,.cqcard`; guard: `shot()` fails on any element still at content-visibility:auto. Rerun +
  re-crop the 22 video frames (1440×840) and re-view

## Phase 2: User Story 2 — The video (P1)

> 2026-10-06 ~09:52 UTC: build STOPPED by the user at ~15% (Raylight project "Agent OS" cbd1a943-…: 23 assets uploaded,
> ~2 of 24 shots partly built, no review run). Partial edits left in place in that project.

- [ ] T005 [US2] Raylight: editor tab connected on a new 16:9 1920×1080 project "Chatterbox AgentOS — Product Demo"
- [ ] T006 [US2] upload the transparent logo + the 23 source screenshots (signed uploads, bulk)
- [ ] T007 [US2] logo intro + VAS Analytics section (shots 0–10)
- [ ] T008 [US2] Agent Analytics: team leader (11–13), agent (14–16), campaign manager (17–19), logo outro (20)

## Phase 3: User Story 3 — Checked, exported, ready to share (P2)

- [ ] T009 [US3] review every shot on rendered stills (logo, typos, crop, overlap, names, Wimpy, loading); log in
  review.md; fix and re-render until 0 open findings; running time 90–120 s
- [ ] T010 [US3] user exports in the editor; share page title + description set, visibility private
- [ ] T011 code review of the three tools/demo changes (ecc:code-reviewer)
