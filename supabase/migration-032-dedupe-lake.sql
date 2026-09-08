-- migration-032 — duplicates are REMOVED by the database, not reported to a human.
--
-- Nick, 2026-09-08: "I want a function in the database to remove the duplicates if there are any."
-- Primary keys already make exact twins impossible in every lake table. What CAN still exist is the
-- semantic twin — the same fact keyed two ways — and this function finds and removes those, logging
-- every run so the removal is auditable. It is called by tools/rake.mjs after each load, by pg_cron
-- nightly, and with p_apply=false by diagnostics/verify-no-duplicates.mjs as a dry report.
--
-- WHAT IS A DUPLICATE (and what is not):
--   sf_closed_cases  same case_number stored under two closure-day keys with the SAME true closure
--                    time (closed_ts) — the keying twin that once wrote 7,002 rows. Legacy rows with
--                    no closed_ts are twins when opened_at and disposition also match. A case with
--                    two DIFFERENT closure times is a re-closed case: real, kept.
--                    Keeps: the row with a closed_ts, then the most recently loaded.
--   agent_list       one dated list carrying the same CB spelt two ways (CB-15 / CB15 / cb 15).
--                    Keeps: the row already in canonical form, then the most recently loaded.
--   batches          the same bytes (file_hash) loaded twice for one source. Not deleted (rows may
--                    reference the batch): the older ones are marked 'superseded'.
--   upload_files     the same sha256 loaded twice by the Rake (the partial index forbids it; belt and
--                    braces): the older ones are marked failed with 'duplicate of <id>'.
--   app_users        two ACTIVE logins on one CB number. Reported, never touched: deactivating a
--                    sign-in is a human decision (there are none today).
-- Nothing else is a duplicate. sf_open_cases is one row per case per snapshot by key; vici_calls is
-- one row per (call_date, login, lead, status) by key; bi_active_cases has its natural unique index.

create table if not exists dedupe_log (
  run_id   uuid primary key default gen_random_uuid(),
  ran_at   timestamptz not null default now(),
  actor    text,
  applied  boolean not null,
  removed  integer not null default 0,
  report   jsonb not null
);
alter table dedupe_log enable row level security;
grant select, insert on dedupe_log to service_role;
comment on table dedupe_log is 'Every dedupe_lake() run: who, when, dry or applied, how many rows removed, and the per-class report.';

create or replace function dedupe_lake(p_apply boolean default true, p_actor text default 'system') returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v jsonb := '{}'::jsonb; n int; total int := 0; sample jsonb;
begin
  -- ---- 1 · closed cases: one fact under two keys ------------------------------------------------
  drop table if exists _dd_closed; create temp table _dd_closed on commit drop as
  with keyed as (
    select case_number, closed_at, closed_ts, loaded_at,
           row_number() over (partition by case_number, coalesce(closed_ts::text, coalesce(opened_at::text, '') || '|' || coalesce(disposition, ''))
                              order by (closed_ts is not null) desc, loaded_at desc, closed_at desc) as rn
      from sf_closed_cases)
  select case_number, closed_at from keyed where rn > 1;
  select count(*), coalesce(jsonb_agg(case_number) filter (where rn <= 5), '[]'::jsonb) into n, sample
    from (select case_number, row_number() over () rn from _dd_closed) s;
  if p_apply and n > 0 then
    delete from sf_closed_cases c using _dd_closed d where c.case_number = d.case_number and c.closed_at = d.closed_at;
  end if;
  v := v || jsonb_build_object('sf_closed_cases', jsonb_build_object('found', n, 'removed', case when p_apply then n else 0 end, 'sample', sample));
  total := total + case when p_apply then n else 0 end;

  -- ---- 2 · agent list: one CB spelt two ways on one dated list ----------------------------------
  drop table if exists _dd_list; create temp table _dd_list on commit drop as
  with keyed as (
    select as_of, employee_code,
           row_number() over (partition by as_of, norm_cb(employee_code) order by (employee_code = norm_cb(employee_code)) desc, loaded_at desc) as rn
      from agent_list where norm_cb(employee_code) is not null)
  select as_of, employee_code from keyed where rn > 1;
  select count(*), coalesce(jsonb_agg(as_of::text || ' ' || employee_code) filter (where rn <= 5), '[]'::jsonb) into n, sample
    from (select as_of, employee_code, row_number() over () rn from _dd_list) s;
  if p_apply and n > 0 then
    delete from agent_list a using _dd_list d where a.as_of = d.as_of and a.employee_code = d.employee_code;
  end if;
  v := v || jsonb_build_object('agent_list', jsonb_build_object('found', n, 'removed', case when p_apply then n else 0 end, 'sample', sample));
  total := total + case when p_apply then n else 0 end;

  -- ---- 3 · batches: same bytes loaded twice for one source → older ones superseded ------------
  drop table if exists _dd_batches; create temp table _dd_batches on commit drop as
  with keyed as (
    select batch_id, row_number() over (partition by source_type, file_hash order by uploaded_at desc nulls last, batch_id desc) as rn
      from batches where status = 'loaded' and file_hash is not null)
  select batch_id from keyed where rn > 1;
  select count(*), coalesce(jsonb_agg(batch_id) filter (where rn <= 5), '[]'::jsonb) into n, sample
    from (select batch_id, row_number() over () rn from _dd_batches) s;
  if p_apply and n > 0 then
    update batches b set status = 'superseded' from _dd_batches d where b.batch_id = d.batch_id;
  end if;
  v := v || jsonb_build_object('batches', jsonb_build_object('found', n, 'superseded', case when p_apply then n else 0 end, 'sample', sample));
  total := total + case when p_apply then n else 0 end;

  -- ---- 4 · upload_files: same sha256 loaded twice by the Rake → older ones failed as duplicates -
  drop table if exists _dd_files; create temp table _dd_files on commit drop as
  with keyed as (
    select id, first_value(id) over (partition by sha256 order by loaded_at desc nulls last, received_at desc) as keep,
           row_number() over (partition by sha256 order by loaded_at desc nulls last, received_at desc) as rn
      from upload_files where status = 'loaded' and sha256 is not null)
  select id, keep from keyed where rn > 1;
  select count(*), coalesce(jsonb_agg(id::text) filter (where rn <= 5), '[]'::jsonb) into n, sample
    from (select id, row_number() over () rn from _dd_files) s;
  if p_apply and n > 0 then
    update upload_files u set status = 'failed', error = 'duplicate of ' || d.keep::text || ' (same bytes loaded twice; dedupe_lake)' from _dd_files d where u.id = d.id;
  end if;
  v := v || jsonb_build_object('upload_files', jsonb_build_object('found', n, 'failed_as_duplicate', case when p_apply then n else 0 end, 'sample', sample));
  total := total + case when p_apply then n else 0 end;

  -- ---- 5 · accounts: two active logins on one CB — reported only ----------------------------------
  select count(*), coalesce(jsonb_agg(cb) filter (where rn <= 5), '[]'::jsonb) into n, sample
    from (select cb, row_number() over () rn from (select norm_cb(cb) as cb from app_users where active and cb is not null group by 1 having count(*) > 1) g) s;
  v := v || jsonb_build_object('app_users', jsonb_build_object('found', n, 'removed', 0, 'note', 'reported only — deactivating a login is a human decision', 'sample', sample));

  v := v || jsonb_build_object('applied', p_apply, 'removed_total', total, 'ran_at', now(), 'actor', p_actor);
  insert into dedupe_log (actor, applied, removed, report) values (p_actor, p_apply, total, v);
  return v;
end $$;
grant execute on function dedupe_lake(boolean, text) to service_role;
comment on function dedupe_lake(boolean, text) is 'Find and remove semantic duplicates across the lake (see the header of migration-032). p_apply=false reports without touching anything. Every run is logged in dedupe_log.';

-- nightly, after partman maintenance, before the morning uploads (00:40 UTC = 02:40 SAST)
select cron.unschedule('dedupe-lake') where exists (select 1 from cron.job where jobname = 'dedupe-lake');
select cron.schedule('dedupe-lake', '40 0 * * *', $cron$select dedupe_lake(true, 'pg_cron')$cron$);
