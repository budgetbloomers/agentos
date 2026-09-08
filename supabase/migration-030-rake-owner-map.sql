-- migration-030 — owners resolve through one join, not one lookup per row.
--
-- The first live run of the open-cases export (78 278 rows) hit the statement timeout: every merge
-- called rake_owner_cb(case_owner) per row, and that function scans agent_list_current each time.
-- rake_owner_map is the same rule as one relation — every normalised Sales Force and Agent Name
-- that exactly ONE CB claims — and the merges LEFT JOIN it. rake_owner_cb() stays for the Worker
-- and the suites; it is the single-row form of the same map.

create or replace view rake_owner_map as
with names as (
  select norm_owner(sales_force) as key, norm_cb(employee_code) as cb from agent_list_current where norm_owner(sales_force) is not null
  union
  select norm_owner(agent_name), norm_cb(employee_code) from agent_list_current where norm_owner(agent_name) is not null
)
select key, max(cb) as cb from names group by key having count(distinct cb) = 1;
grant select on rake_owner_map to service_role;

create or replace function rake_owner_cb(p_owner text) returns text
language sql stable as $$ select cb from rake_owner_map where key = norm_owner(p_owner); $$;

create or replace function rake_merge_sf_open(p_batch text, p_from bigint, p_to bigint) returns table (merged bigint, rejected bigint)
language plpgsql as $$
declare n bigint; r bigint;
begin
  with src as (
    select rake_date(snapshot_date) as snapshot_date, rake_idish(case_number) as case_number, nullif(trim(case_id), '') as case_id,
           nullif(trim(subject), '') as subject, rake_sf_ts_local(opened_at) as opened_at, rake_num(age_hours) as age_hours,
           rake_idish(account_number) as account_number, nullif(trim(account_name), '') as account_name,
           nullif(trim(case_owner), '') as case_owner, nullif(trim(status), '') as status, nullif(trim(record_type), '') as record_type
      from rake_stage_sf_open where _seq > p_from and _seq <= p_to),
  good as (select s.*, m.cb from src s left join rake_owner_map m on m.key = norm_owner(s.case_owner) where s.snapshot_date is not null and s.case_number is not null),
  ins as (
    insert into sf_open_cases (snapshot_date, case_number, case_id, subject, opened_at, age_hours, account_number, account_name, case_owner, employee_code, owner_kind, status, record_type, batch_id)
    select distinct on (snapshot_date, case_number) snapshot_date, case_number, case_id, subject, opened_at, age_hours, account_number, account_name, case_owner,
           cb, rake_owner_kind(case_owner), status, record_type, p_batch
      from good order by snapshot_date, case_number
    on conflict (snapshot_date, case_number) do update set case_id = excluded.case_id, subject = excluded.subject, opened_at = excluded.opened_at,
      age_hours = excluded.age_hours, account_number = excluded.account_number, account_name = excluded.account_name, case_owner = excluded.case_owner,
      employee_code = coalesce(excluded.employee_code, sf_open_cases.employee_code), owner_kind = excluded.owner_kind, status = excluded.status, record_type = excluded.record_type,
      batch_id = excluded.batch_id, loaded_at = now()
    returning 1)
  select (select count(*) from ins), (select count(*) from src) - (select count(*) from good) into n, r;
  return query select n, r;
end $$;

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
    select s.*, m.cb, (s.closed_ts at time zone 'Africa/Johannesburg')::date as closed_day,
           ((s.closed_ts at time zone 'Africa/Johannesburg')::date::timestamp at time zone 'UTC') as closed_at
      from src s left join rake_owner_map m on m.key = norm_owner(s.case_owner) where s.closed_ts is not null and s.case_number is not null),
  ins as (
    insert into sf_closed_cases (case_number, closed_at, closed_ts, closed_day, case_id, opened_at, disposition, status, age_hours, account_number, account_name, case_owner, employee_code, batch_id)
    select distinct on (case_number, closed_at) case_number, closed_at, closed_ts, closed_day, case_id, opened_at, disposition, status, age_hours,
           account_number, account_name, case_owner, cb, p_batch
      from good order by case_number, closed_at, closed_ts desc
    on conflict (case_number, closed_at) do update set closed_ts = excluded.closed_ts, closed_day = excluded.closed_day, case_id = excluded.case_id,
      opened_at = excluded.opened_at, disposition = excluded.disposition, status = excluded.status, age_hours = excluded.age_hours,
      account_number = excluded.account_number, account_name = excluded.account_name, case_owner = excluded.case_owner,
      employee_code = coalesce(excluded.employee_code, sf_closed_cases.employee_code), batch_id = excluded.batch_id, loaded_at = now()
    returning 1)
  select (select count(*) from ins), (select count(*) from src) - (select count(*) from good) into n, r;
  return query select n, r;
end $$;

create or replace function rake_merge_bi(p_batch text, p_from bigint, p_to bigint) returns table (merged bigint, rejected bigint)
language plpgsql as $$
declare n bigint; r bigint;
begin
  with src as (
    select rake_idish(account_no) as account_no, rake_date(contract_create_date) as contract_create_date, nullif(trim(owner), '') as owner,
           rake_num(charge_amount) as charge_amount, nullif(trim(charge_code), '') as charge_code, nullif(trim(contract_status), '') as contract_status,
           rake_idish(contract_number) as contract_number, rake_idish(case_number) as case_number, nullif(trim(account_name), '') as account_name,
           nullif(trim(consultant), '') as consultant, nullif(trim(product_bundle), '') as product_bundle, nullif(trim(merged_bundle), '') as merged_bundle,
           nullif(trim(sales_vertical), '') as sales_vertical
      from rake_stage_bi where _seq > p_from and _seq <= p_to),
  good as (select s.*, m.cb from src s left join rake_owner_map m on m.key = norm_owner(s.owner) where s.account_no is not null and s.contract_create_date is not null and s.charge_amount is not null),
  ins as (
    insert into bi_active_cases (account_no, contract_create_date, owner, cb, charge_amount, charge_code, contract_status, contract_number, case_number, account_name, consultant, product_bundle, merged_bundle, sales_vertical, batch_id)
    select distinct on (case_number, account_no, coalesce(contract_number, ''), coalesce(charge_code, ''), charge_amount, contract_create_date)
           account_no, contract_create_date, owner, cb, charge_amount, charge_code, contract_status, contract_number, case_number, account_name, consultant, product_bundle, merged_bundle, sales_vertical, p_batch
      from good order by case_number, account_no, coalesce(contract_number, ''), coalesce(charge_code, ''), charge_amount, contract_create_date
    on conflict (case_number, account_no, coalesce(contract_number, ''), coalesce(charge_code, ''), charge_amount, contract_create_date) do update set
      owner = excluded.owner, cb = coalesce(excluded.cb, bi_active_cases.cb), contract_status = excluded.contract_status, account_name = excluded.account_name, consultant = excluded.consultant,
      product_bundle = excluded.product_bundle, merged_bundle = excluded.merged_bundle, sales_vertical = excluded.sales_vertical, batch_id = excluded.batch_id
    returning 1)
  select (select count(*) from ins), (select count(*) from src) - (select count(*) from good) into n, r;
  return query select n, r;
end $$;
