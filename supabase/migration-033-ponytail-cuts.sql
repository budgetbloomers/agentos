-- migration-033 — ponytail audit, 2026-09-09: drop what nothing reads.
--
-- NOT YET APPLIED. Nick decides. Every object below was checked three ways: no reference in any
-- source file outside supabase/*.sql (265 files scanned: apps, worker, tools, diagnostics, specs,
-- workflows), no reference from another function body, view definition, trigger or cron job, and
-- no rows ever written where it is a table. The 2026-07-15 audit did the same for 17 tables
-- (migration-006). Each drop is reversible: the original definition stays in its own migration file.
--
--   upload_coverage        table, declared 2026-07 as "THE COVERAGE LAW as a queryable fact",
--                          never written once (0 inserts, 0 rows). The law itself IS enforced —
--                          by V01–V22 in PULSE and the verify suites — so this table is a second
--                          home for a rule that already has one. Drop, or implement it and delete
--                          this migration; do not leave it empty.
--   agent_list_asof        view, migration-010. Superseded by agent_list_current, which every
--                          caller uses. Nothing has ever selected from it.
--   lake_unmatched         view, migration-010. "Unattributed rows per source", made queryable —
--                          but the answer is now delivered by verify-live-integrity and the Agent
--                          List audit tool, and it still unions callx_calls, a source retired on
--                          2026-09-01. Nothing reads it.
--   upload_manifest_files  view, migration-027. Written for the Phase 2 manifest compatibility
--                          layer that was never built. Recreate it with Phase 2, from that spec.
--   upload_manifest_remove function, migration-024, commented "test cleanup only". No suite or
--                          tool calls it; the suites clean up by rewriting the blob.
--
-- Kept deliberately, though they looked dead to a code-only scan:
--   norm_owner, rake_sf_ts_local        — called from inside the rake merge functions and views
--   app_users_password_birth/_turn      — trigger functions on app_users
--   rls_auto_enable                     — the ensure_rls event trigger
--   callx_calls (70,161 rows)           — the retired dialler is history, not dead weight

begin;

drop view if exists lake_unmatched;
drop view if exists agent_list_asof;
drop view if exists upload_manifest_files;
drop function if exists upload_manifest_remove(text);
drop table if exists upload_coverage;

-- probe rows left by this session's live tests of the large-file path
delete from batches      where batch_id like 'rake:%' and uploaded_by = 'test';
delete from upload_files where uploaded_by = 'test' and storage_path like 'test/%';

commit;
