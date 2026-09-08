-- migration-029 — closed cases: the key keeps the lake's convention; the true time gets its own column.
--
-- Found by the rake's first live test (2026-09-08): sf_closed_cases is keyed on (case_number,
-- closed_at), and every row the Ops path ever loaded carries closed_at as MIDNIGHT UTC of the
-- closure day — the browser transform only kept the date. The rake read the real "2026/09/03, 13:36"
-- from the export, so none of its 7 002 rows matched and all of them landed as new rows beside their
-- twins (deleted again by batch id). Changing the key is not possible on a partitioned table without
-- re-partitioning, and the day IS the identity of a closure; so:
--   · closed_at (the key) stays the closure day at midnight UTC — exactly what the legacy rows hold;
--   · closed_ts (new) holds the true closure time; opened_at gets the true opening time as before;
--   · a merge therefore UPDATES the existing row, back-filling closed_ts and employee_code on data
--     the Ops path could not resolve.

alter table sf_closed_cases add column if not exists closed_ts timestamptz;
comment on column sf_closed_cases.closed_ts is 'the true closure time from the export; closed_at (the key) is the closure day at midnight UTC, the convention the Ops loader set';

create or replace function rake_merge_sf_closed(p_batch text, p_from bigint, p_to bigint) returns table (merged bigint, rejected bigint)
language plpgsql as $$
declare n bigint; r bigint;
begin
  with src as (
    select rake_idish(case_number) as case_number, rake_sf_ts_local(closed_at) as closed_ts, nullif(trim(case_id), '') as case_id,
           rake_sf_ts_local(opened_at) as opened_at, nullif(trim(disposition), '') as disposition, nullif(trim(status), '') as status,
           rake_num(age_hours) as age_hours, rake_idish(account_number) as account_number, nullif(trim(account_name), '') as account_name,
           nullif(trim(case_owner), '') as case_owner
      from rake_stage_sf_closed where _seq > p_from and _seq <= p_to),
  good as (
    select *, (closed_ts at time zone 'Africa/Johannesburg')::date as closed_day,
           ((closed_ts at time zone 'Africa/Johannesburg')::date::timestamp at time zone 'UTC') as closed_at   -- the key: that day at midnight UTC
      from src where closed_ts is not null and case_number is not null),
  ins as (
    insert into sf_closed_cases (case_number, closed_at, closed_ts, closed_day, case_id, opened_at, disposition, status, age_hours, account_number, account_name, case_owner, employee_code, batch_id)
    select distinct on (case_number, closed_at) case_number, closed_at, closed_ts, closed_day, case_id, opened_at, disposition, status, age_hours,
           account_number, account_name, case_owner, rake_owner_cb(case_owner), p_batch
      from good order by case_number, closed_at, closed_ts desc
    on conflict (case_number, closed_at) do update set closed_ts = excluded.closed_ts, closed_day = excluded.closed_day, case_id = excluded.case_id,
      opened_at = excluded.opened_at, disposition = excluded.disposition, status = excluded.status, age_hours = excluded.age_hours,
      account_number = excluded.account_number, account_name = excluded.account_name, case_owner = excluded.case_owner,
      employee_code = coalesce(excluded.employee_code, sf_closed_cases.employee_code), batch_id = excluded.batch_id, loaded_at = now()
    returning 1)
  select (select count(*) from ins), (select count(*) from src) - (select count(*) from good) into n, r;
  return query select n, r;
end $$;
grant execute on function rake_merge_sf_closed(text, bigint, bigint) to service_role;
