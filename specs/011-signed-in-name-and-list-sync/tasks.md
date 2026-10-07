---

description: "Task list — 011 signed-in name from the session; list publish answers with its integrity"
---

# Tasks: Signed-in name and list sync proof

**Input**: spec.md, plan.md (C1–C6). **Tests**: REQUIRED (Constitution VII), red first.

- [x] T001 Baseline: verify-ops-cas, verify-roster-of-record, verify-roster-autoupdate, verify-save-acks
- [x] T002 [P] [US1] [US2] NEW verify-session-name.mjs (Ops page in a VM): CBX_USER Aarav + cloud config user 'Nick'
  → header name Aarav; applyCfg with user 'Nick' leaves it; cfgPayload has no user; a config save conflict keeps
  Aarav; applyLoad batch.uploaded_by = Aarav, uploaded_by_username = aarav; the page listens for cbx-authed — RED
- [x] T003 [P] [US3] verify-roster-of-record §12: accepted publish answers integrity {in_step:true} when the view reads
  0; names the failing check + count when not; {in_step:null} when the view cannot be read — RED
- [x] T004 [US1] [US2] Ops: C1–C3
- [x] T005 [US3] Worker C5; VAS + Ops C6
- [x] T006 [US2] tools/publish-agent-list.mjs C4 (--as required, operator's own session)
- [x] T007 GREEN + related suites (verify-ops-cas, save-acks, roster-*, agent-analytics, wimpy)
- [x] T008 Release + commit — LIVE 2026-10-07 (Worker bfe7aa49, Pages muxwxyf3, smoke cors 13/13 + live-save 5/5)
