---
description: "Task list — 036 the demo starts empty and fills from the Upload Station (work in agentos-demo)"
---

# Tasks: 036

**Repo**: `C:\Users\aarav\repos\agentos-demo` on a feature branch. Tests red first where a test exists.

## Phase 1 — Setup
- [x] T001 Branch `036-upload-gated` in the demo repo; `src/identity.local.mjs` recreated locally (gitignored)
- [x] T002 Build against the current upstream; repair stale patches until the build completes

## Phase 2 — Files (US2)
- [x] T003 `src/files.mjs`: writers for the ten exports + sample manifest + stored zip (CRC-32), from `buildModel`
- [x] T004 `tools/check-samples.mjs`: read every file back with SheetJS and assert the detectType header rules and
  row counts (RED before T003 lands, GREEN after)

## Phase 3 — Empty start (US1)
- [x] T005 `build.mjs`: no dataset emission except `hub-titles` / `help-stages`; `samples` in `TB_DEMO_CONFIG`;
  Brain removed; `tb-cm.mjs` emitted; `vercel.json` cache rule for `sample-data`
- [x] T006 `tb-demo.js`: wipe on new build id; remove FROZEN and lazy facts; digest-derived TL/CM logins; CM body
  via `tb-cm.mjs`; "nothing published yet" copy

## Phase 4 — Station card (US3)
- [x] T007 `src/runtime/pulse-samples.js`: the demo card on `PAGES.data`; launch page copy; agent sign-in card copy

## Phase 5 — Verify
- [x] T008 `tools/verify-demo.mjs` (Playwright): empty start → upload all → tabs filled → digest → TL1/CM1/agent
- [x] T009 Build clean (leak audit), README updated, commit on the branch, push; report deploy steps to Nick
