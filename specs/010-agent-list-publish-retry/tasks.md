---

description: "Task list — 010 Agent List publish: retry a passing failure, record a standing one"
---

# Tasks: Agent List publish retry

**Input**: spec.md, plan.md (C1–C3). **Tests**: REQUIRED (Constitution VII), red first.

- [x] T001 Baseline green: verify-roster-of-record, verify-roster-autoupdate, verify-roster-changes
- [x] T002 [P] [US1] [US2] verify-roster-of-record: the publish rpc throws once → the list is accepted; throws every
  time → 200 accepted:false stage 'server' with the error text, kv:roster-refused stored with it, record unchanged; a
  database REFUSAL is not retried (one call) — RED
- [x] T003 [P] [US1] [US2] verify-roster-autoupdate: a hand upload whose POST fails once is retried and leaves no
  refusal; three failures → S.rosterRefused names 3 attempts; an adopted list still never posts — RED
- [x] T004 [US1] worker/src/index.mjs C1–C2
- [x] T005 [US1] nicks_code/index.html C3
- [x] T006 T002–T003 GREEN; verify-roster-changes, verify-publish relays, verify-agent-analytics green
- [x] T007 Release with 003/004/006/009 — LIVE 2026-10-07 (Worker 665a8f9a, Pages muxtsen8, smoke green)
- [x] T008 Commit (conventional), no push — 01f3fd2
- [x] T009 ROOT CAUSE (recorded by T004's retry): leader named twice on the TL sheet → 21000 in sync_team_leaders'
  map insert. verify-publish-agent-list D4 RED (exact live error) → supabase/migration-054-leader-twice-on-sheet.sql
  applied → GREEN 62/62 (rolled back)
- [x] T010 The 7 Oct list published (Nick: "Yes, publish it"): accepted, 128 agents, -5 agents, -3 leader logins,
  Training Gr 17 deleted; kv:roster-refused cleared
- [x] T011 Commit migration-054 + D4 + these notes (with spec 011)
