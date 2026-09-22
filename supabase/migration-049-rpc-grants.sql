-- migration-049 · the publish and password RPCs are the Worker's alone (2026-09-22, second ECC pass)
--
-- ecc:security-reviewer: every function in public was EXECUTE-able by the anon and authenticated
-- roles — Supabase's default privileges grant it on creation, and `create or replace` re-grants it,
-- so the `revoke … from public` in migrations 014/019/020 was undone the next time each function
-- was redefined. publish_agent_list, sync_team_leaders, sync_campaigns, set_password and
-- reset_password_to_default were all callable with the project's anon key (verified live).
--
-- Nothing in the suite uses the anon key: every page talks to the Worker, and the Worker calls
-- PostgREST with the service_role key. So: revoke from public/anon/authenticated on every
-- function in public, and change the DEFAULT privileges so a redefined or new function stays
-- revoked. service_role and postgres keep EXECUTE.
--
-- Apply: node tools/apply-migration.mjs supabase/migration-049-rpc-grants.sql

revoke execute on all functions in schema public from public, anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;
