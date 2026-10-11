# Implementation Plan: Who asked — names, teams and leaders on every ask

**Branch**: `feat/029-asks` (030 on top of 029's tip) | **Date**: 2026-10-11 | **Spec**: [spec.md](spec.md)

## Summary
SQL only — migration-063, on `usage_events_real` (test traffic stays hidden, FR-004). No Worker, page or tool change.
1. `ask_events` gains `user_id, username, cb, cms` (appended — `create or replace view` keeps every existing column).
2. `ask_askers` — ONE row per ask saying who asked, resolved at READ time (FR-003):
   - the account: `app_users` by `user_id`, else by `username`, else by CB (`detail.cb` — what a HighLevel-backfilled ask
     carries from the card's note); TLs also by `team_leader_cbs.leader_name` for the CB;
   - name = account full name, else the name recorded with the ask, else the username — a leaver still shows;
   - CB = account CB, else `detail.cb`, else the TL's `team_leader_cbs.employee_code`, else a `cbNNN` username;
   - team = `app_users.team` (named after the TL), else the TL recorded with the ask; team leader = the TL recorded with
     the ask, else the team;
   - campaign manager (CM requests): the ONE CM named in `detail.cms` when the raise named exactly one; else the TL's
     manager on record (`team_leader_cbs.manager`); else everyone `detail.cms` named. (All three CMs are assigned to
     every campaign today, so `detail.cms` alone would read "Dalwin Callaghan, Preshen Naidoo, Ryan G" on every request —
     the brief's order with that one refinement.) `handled_by` (first non-TL actor) is shown beside it.
   - `who` — "Name (CB) · Team X · TL Y" (help) / "Name (CB) · Team X · CM Z" (CM).
3. `help_asks_detail` (US1) and `cm_requests_detail` (US2) — one row per ask with `at_sast`, `day/week/month`, the
   person, topic (after merges), the words, delivered, current stage / status.
4. `most_asked_topics` — `askers` now counts distinct PEOPLE (`ask_askers.person_key`), and `asked_by text[]` is appended.

## Constitution Check
I/II: SQL decides, nothing invented — a missing name shows the username, a missing CB is NULL. III: names from the
accounts the Agent List provisions; TL ↔ CM from `team_leader_cbs`. V: RLS/revokes/grants like 062, security_invoker.
VII: `verify-usage-030` first (RED), registered in verify.yml.

## Release
`node tools/apply-migration.mjs supabase/migration-063-who-asked.sql` — no deploy.
