# Tasks — 030 who asked (test-first)

Guard: `node nicks_code/diagnostics/verify-usage-030.mjs`.

- [x] **T001** Plan + tasks.
- [x] **T002** RED — `verify-usage-030.mjs`: live-recorded and HighLevel-backfilled asks resolve name / CB / team / TL;
  CM requests show the TL, CB, team and CM (single `cms`, else manager on record); a leaver shows the username; test rows
  absent; `most_asked_topics.askers` / `asked_by`; lockdown; registered in verify.yml.
- [x] **T003** GREEN — `supabase/migration-063-who-asked.sql`; 028 + 029 suites stay green.
- [x] **T004** Read-only live check (view bodies as CTEs in `begin read only … rollback`, 2026-10-11): 8 real help asks Sep+Oct, every one with name, CB, team and TL; cm_requests_detail 0 rows (the one real-looking request "testing with throughballs" is labelled Test message, the e2e card is marked).
