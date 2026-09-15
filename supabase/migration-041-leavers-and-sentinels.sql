-- migration-041-leavers-and-sentinels.sql
-- THREE THINGS THE 15 SEP AUDIT FOUND MISSING (Nick: "I agree with your plan").
--
--   1. agent_list_leavers() — WHO LEFT, AND WHEN. The 14 Sep list removed 17 agents and, under
--      "the list wins its whole month", their September (49 sales, R4,311 GWP, 205.8 h of talk)
--      was credited to nobody. The archive already knows the answer: an agent on an earlier list
--      and not on the current one LEFT on the date of the first list that stopped naming them.
--      This function states it, from the archive, so both apps take departures from the record
--      instead of deriving them in a browser. A leaver keeps their attribution up to that date.
--
--   2. A WEEKLY VACUUM. The September open-cases partition had never been autovacuumed; the
--      Supabase disk filled on 15 Sep and Postgres restarted for three minutes. Vacuuming a
--      partitioned parent processes every partition (Postgres 14+); the old ones are already
--      clean and cost nothing.
--
--   3. db_health() — THE DISK, SAID OUT LOUD. Database size, WAL size when readable, and the
--      dead-tuple load on the lake tables, for the health cron to turn into a banner before the
--      disk fills rather than after.

-- ------------------------------------------------------------------ 1. leavers
create or replace function agent_list_leavers(p_days int default 90)
returns table (
  code       text,
  name       text,
  sf         text,
  callx      text,
  tl         text,
  campaign   text,
  tenure     text,
  target     numeric,
  start_date date,
  last_on    date,   -- the last list that named them
  left_on    date    -- the first list after that which did not (the day they left, as the list tells it)
)
language sql stable security definer set search_path = public as $$
  with lists as (
    select distinct as_of from agent_list
    where  as_of >= current_date - make_interval(days => p_days)
  ),
  cur as (select max(as_of) as as_of from agent_list),
  seen as (
    select norm_cb(a.employee_code) as cb, max(a.as_of) as last_on
    from   agent_list a
    where  a.as_of >= current_date - make_interval(days => p_days)
      and  norm_cb(a.employee_code) is not null
    group  by norm_cb(a.employee_code)
  ),
  gone as (
    select s.cb, s.last_on,
           (select min(l.as_of) from lists l where l.as_of > s.last_on) as left_on
    from   seen s, cur
    where  s.last_on < cur.as_of
  )
  select r.employee_code, r.agent_name, r.sales_force, r.callx_alias, r.team_leader, r.campaign, r.tenure,
         r.target, r.start_date, g.last_on, g.left_on
  from   gone g
  join   lateral (
           select * from agent_list a
           where  norm_cb(a.employee_code) = g.cb and a.as_of = g.last_on
           order  by a.loaded_at desc limit 1
         ) r on true
  where  g.left_on is not null
  order  by g.left_on desc, r.agent_name;
$$;
grant execute on function agent_list_leavers(int) to service_role;
comment on function agent_list_leavers(int) is
  'Agents on a list in the last p_days who are not on the current list: their last row, the last list that named them, and the first list that did not (left_on). Served on /api/roster as leavers[]; PULSE keeps their facts attributed up to left_on.';

-- ------------------------------------------------------------------ 2. weekly vacuum
select cron.unschedule(jobid) from cron.job where jobname = 'vacuum-lake-weekly';
select cron.schedule('vacuum-lake-weekly', '30 1 * * 0',
  $cron$VACUUM (ANALYZE) public.sf_open_cases, public.sf_closed_cases, public.vici_calls, public.bi_active_cases, public.rules, public.upload_files$cron$);

-- ------------------------------------------------------------------ 3. disk sentinel
create or replace function db_health() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_wal   bigint := null;
  v_dead  jsonb;
begin
  begin
    select sum(size) into v_wal from pg_ls_waldir();
  exception when others then
    v_wal := null;                                   -- not readable on this role: say nothing rather than guess
  end;
  select coalesce(jsonb_agg(jsonb_build_object('table', relname, 'dead', n_dead_tup, 'live', n_live_tup,
                    'last_vacuum', greatest(last_vacuum, last_autovacuum)) order by n_dead_tup desc), '[]'::jsonb)
    into v_dead
  from (select relname, n_dead_tup, n_live_tup, last_vacuum, last_autovacuum
        from   pg_stat_user_tables
        where  n_dead_tup > 50000
        order  by n_dead_tup desc limit 5) t;
  return jsonb_build_object(
    'db_bytes',   pg_database_size(current_database()),
    'wal_bytes',  v_wal,
    'dead_heavy', v_dead,
    'checked_at', now());
end $$;
grant execute on function db_health() to service_role;
comment on function db_health() is 'Database size, WAL size (when readable) and the tables carrying the most dead tuples — for the health cron''s disk sentinel (alert database-size).';
