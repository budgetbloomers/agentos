-- migration-051 -- the 2026-09 ViciDial machine-timezone bug: 228k duplicate calls, doubled talk time
--
-- FINDING (audit, corroborated live 2026-09-28): tools/lake-load.mjs's shared ts() parsed ViciDial's
-- NAIVE SAST call_date ("2026-09-10 08:00:00", no offset) with new Date(t.replace(' ','T')). Per
-- ECMA-262, a date-time string with no timezone is interpreted as the RUNNING PROCESS's local time --
-- so the stored instant depended on the loading machine's clock, not on the data. Every per-day batch
-- (B0143, B0152, B0160, B0168, B0180, B0192, B0202, B0220, B0241, B0247, B0261, ...) was loaded from a
-- machine already on Africa/Johannesburg and landed correctly (proved below: first calls ~07:50-08:35
-- SAST, a plausible opening). Three bulk re-loads -- B0351 (31 Aug-4 Sep), B0355 (5-9 Sep), B0356
-- (10-14 Sep) -- ran from a machine 4h ahead of UTC (not SAST's 2h), so every one of their 259,079 rows
-- landed exactly 2 HOURS EARLIER than the true instant. vici_calls' primary key is (call_date,
-- agent_login, lead_id, status) (migration-016) -- call_date is part of the key, so a row stored 2h
-- off is a DIFFERENT key, not a conflict, and dedupe_lake() (migration-032) never saw it: it only
-- knows the twin classes named in its own header, and a timestamp-shifted call was not one of them.
--
-- THE SQL PATH WAS ALREADY SAFE. tools/rake.mjs and the in-page Rake (migration-042) both load Vici
-- through rake_merge_vici -> rake_sf_ts_local (migration-028), which casts the naive text with
-- (left(t,19)::timestamp) at time zone 'Africa/Johannesburg' -- an explicit named-zone cast that is
-- correct regardless of the session's TimeZone GUC (confirmed live: show timezone = UTC on this
-- connection, and rake_sf_ts_local still returns the correct instant). No SQL merge function needed a
-- timezone fix; only the Node-side loader did, and it depended on machine state a database function
-- never sees. rake_sf_ts_local is intentionally NOT touched here.
--
-- THE FIX:
--   1. tools/lake-load.mjs: VICI_CALL_REPORT.call_date now goes through a new tsSast() that computes
--      the UTC instant with Date.UTC(...) minus a hard-coded 2h SAST offset -- never new Date() on a
--      naive string, so no machine's local clock can move a call's stored instant again. Every OTHER
--      source's ts() is untouched (SF_OPEN_CASES/SF_CLOSED_CASES pass day-only strings through it --
--      no time component, no ambiguity; QA/REFERRALS/CALLX were not audited here and keep the
--      existing shared ts()).
--   2. dedupe_lake() (migration-032) gets one more step: the wrong copy of every 2h-shifted twin is
--      removed (true-SAST side kept -- confirmed by agent_login+lead_id+status+length_in_sec match);
--      the 14 Sep rows that exist ONLY in the wrong bulk batch (no other load ever covered that day)
--      are corrected in place, +2h, rather than deleted. vici_tz_fix_batches records which of the
--      three known-bad batches have been processed, so the step is a permanent no-op once run --
--      dedupe_lake() stays idempotent and nightly runs after this one change nothing further.
--
-- Apply: node tools/apply-migration.mjs supabase/migration-051-vici-tz-fix.sql

create table if not exists vici_tz_fix_batches (
  batch_id  text primary key,
  fixed_at  timestamptz not null default now()
);
grant select, insert on vici_tz_fix_batches to service_role;
revoke all on vici_tz_fix_batches from public, anon, authenticated;
comment on table vici_tz_fix_batches is $c$One-time fix log for the 2026-09 lake-load.mjs machine-timezone bug (migration-051): B0351/B0355/B0356 were loaded from a machine off true SAST and landed 2h early. Marks a batch once dedupe_lake() has removed its duplicate twins and corrected its orphan rows, so the fix never re-applies.$c$;

create or replace function dedupe_lake(p_apply boolean default true, p_actor text default 'system') returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v jsonb := '{}'::jsonb; n int; total int := 0; sample jsonb; wrong_dup int; wrong_orphan int;
begin
  -- ---- 1 . closed cases: one fact under two keys ------------------------------------------------
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

  -- ---- 2 . agent list: one CB spelt two ways on one dated list ----------------------------------
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

  -- ---- 3 . batches: same bytes loaded twice for one source -> older ones superseded ------------
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

  -- ---- 4 . upload_files: same sha256 loaded twice by the Rake -> older ones failed as duplicates -
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

  -- ---- 5 . accounts: two active logins on one CB -- reported only ----------------------------------
  select count(*), coalesce(jsonb_agg(cb) filter (where rn <= 5), '[]'::jsonb) into n, sample
    from (select cb, row_number() over () rn from (select norm_cb(cb) as cb from app_users where active and cb is not null group by 1 having count(*) > 1) g) s;
  v := v || jsonb_build_object('app_users', jsonb_build_object('found', n, 'removed', 0, 'note', 'reported only -- deactivating a login is a human decision', 'sample', sample));

  -- ---- 6 . vici_calls: 2026-09 lake-load.mjs machine-timezone bug (migration-051) ----------------
  -- B0351/B0355/B0356 stored every call 2h earlier than true SAST (see the migration header). A
  -- wrong row's true twin -- loaded correctly by any OTHER batch -- shares (agent_login, lead_id,
  -- status, length_in_sec) with call_date exactly +2h; that confirms it is the same call, so the
  -- wrong copy is removed. A wrong row with no such twin (14 Sep, never loaded any other way) is
  -- corrected in place. vici_tz_fix_batches makes this permanent: a batch already recorded there is
  -- skipped, so a second run (tonight's cron, or a re-apply of this migration) finds nothing to do.
  drop table if exists _dd_vici_wrong; create temp table _dd_vici_wrong on commit drop as
    select w.call_date, w.agent_login, w.lead_id, w.status, w.length_in_sec, w.batch_id,
           t.call_date is not null as has_target, t.length_in_sec as t_len
      from vici_calls w
      left join lateral (
        select b.call_date, b.length_in_sec from vici_calls b
         where b.batch_id not in ('B0351', 'B0355', 'B0356')
           and b.agent_login = w.agent_login and b.lead_id = w.lead_id and b.status = w.status
           and b.call_date = w.call_date + interval '2 hours'
         limit 1
      ) t on true
     where w.batch_id in ('B0351', 'B0355', 'B0356')
       and w.batch_id not in (select batch_id from vici_tz_fix_batches);
  select count(*) filter (where has_target and t_len = length_in_sec),
         count(*) filter (where not has_target)
    into wrong_dup, wrong_orphan
    from _dd_vici_wrong;
  -- rows where a target key exists but length_in_sec disagrees are a coincidental key collision, not
  -- a proven twin -- left untouched and not counted, same doctrine as app_users above (reported only).
  if p_apply and (coalesce(wrong_dup, 0) > 0 or coalesce(wrong_orphan, 0) > 0) then
    delete from vici_calls c using _dd_vici_wrong d
     where d.has_target and d.t_len = d.length_in_sec
       and c.call_date = d.call_date and c.agent_login = d.agent_login and c.lead_id = d.lead_id and c.status = d.status;
    update vici_calls c set call_date = c.call_date + interval '2 hours',
           call_day = ((c.call_date + interval '2 hours') at time zone 'Africa/Johannesburg')::date
      from _dd_vici_wrong d
     where not d.has_target
       and c.call_date = d.call_date and c.agent_login = d.agent_login and c.lead_id = d.lead_id and c.status = d.status;
    insert into vici_tz_fix_batches (batch_id)
      select distinct batch_id from _dd_vici_wrong
      on conflict (batch_id) do nothing;
    refresh materialized view agent_day;
  end if;
  v := v || jsonb_build_object('vici_calls_tz', jsonb_build_object(
        'found_duplicate', coalesce(wrong_dup, 0), 'removed', case when p_apply then coalesce(wrong_dup, 0) else 0 end,
        'found_orphan_wrong_instant', coalesce(wrong_orphan, 0), 'corrected', case when p_apply then coalesce(wrong_orphan, 0) else 0 end));
  total := total + case when p_apply then coalesce(wrong_dup, 0) + coalesce(wrong_orphan, 0) else 0 end;

  v := v || jsonb_build_object('applied', p_apply, 'removed_total', total, 'ran_at', now(), 'actor', p_actor);
  insert into dedupe_log (actor, applied, removed, report) values (p_actor, p_apply, total, v);
  return v;
end $$;
grant execute on function dedupe_lake(boolean, text) to service_role;
revoke execute on function dedupe_lake(boolean, text) from public, anon, authenticated;
comment on function dedupe_lake(boolean, text) is $c$Find and remove semantic duplicates across the lake (see migration-032's header, extended by migration-051 with the vici_calls machine-timezone class). p_apply=false reports without touching anything. Every run is logged in dedupe_log.$c$;
