-- ============================================================
-- migration-006: drop the speculative schema (2026-07 ponytail audit).
-- Run once in: Supabase Dashboard → SQL Editor → New query → paste → Run
--
-- Every table below was declared by the original schema.sql / migration-002
-- but NEVER written or read by any code — the app persists uploads as kv
-- blobs via /api/kv, and the only row-level writers are migration-003 (auth),
-- migration-004 (daily_eod) and migration-005 (bi_active_cases). All were
-- verified 0 rows before this migration was written; the guard clauses below
-- re-verify at run time and abort if any table has grown rows since.
-- (Applied 2026-07-15. The guard caught exactly one row: a closed synthetic
--  P1-R2 action for demo agent CB-097 — a Phase-2 route test — deleted first.)
-- ============================================================

do $$
declare t text; n bigint;
begin
  foreach t in array array[
    'agents','exceptions','sales','calls','attendance','evals',
    'monthly_snapshots','open_cases','cancellations','agents_history',
    'gwp_prices','actions','nba_results',
    'closed_cases','referrals','session_snapshots','adjustments'
  ] loop
    if to_regclass('public.'||t) is not null then
      execute format('select count(*) from %I', t) into n;
      if n > 0 then
        raise exception 'ABORT: table % has % row(s) — not dead after all. Investigate before dropping.', t, n;
      end if;
      execute format('drop table %I cascade', t);
      raise notice 'dropped %', t;
    end if;
  end loop;
end $$;

-- the account-grain view migration-005 once created; never queried by anything
drop view if exists bi_account_gwp;

-- ---------- verify ----------
-- select table_name from information_schema.tables where table_schema='public' order by 1;
-- Expect: app_sessions, app_users, ask_log, auth_log, batches, bi_active_cases, daily_eod, rules
