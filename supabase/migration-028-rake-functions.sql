-- migration-028 — the Data Rake's functions: queue hand-off, agent resolution, staging and merges.
--
-- Phase 1 of specs/data-pipeline-plan.md. The runner (tools/rake.mjs) streams a large file into a
-- canonical text CSV, COPYs it into an UNLOGGED staging table here, and calls the source's merge in
-- 50 000-row slices. Every cast, guard and natural-key merge lives in this file, so the transform is
-- readable in one place and testable in a rolled-back transaction — the rake moves bytes, Postgres
-- decides what a row is. The Worker cannot reach the pgmq schema through PostgREST, so the two
-- calls it needs (enqueue, health) are wrapped here in public.
--
-- AGENT RESOLUTION IS THE OPS APP'S RULE, IN SQL. A Salesforce owner or a Power BI owner is a
-- display name ("Smangele Nzama - Panimax"); the Ops app lowercases it, strips " - suffix", collapses
-- whitespace, and maps it through the Agent List's Sales Force and Agent Name columns — and only
-- when exactly one CB claims that name (an ambiguous name resolves to nobody rather than to the wrong
-- person). rake_owner_cb() is that rule, verbatim.

-- ---- queue hand-off ------------------------------------------------------------------------------
create or replace function rake_enqueue(p_file_id uuid) returns bigint
language sql security definer set search_path = public, pgmq as $$
  select pgmq.send('ingest', jsonb_build_object('file_id', p_file_id));
$$;

create or replace function rake_health() returns jsonb
language sql security definer set search_path = public, pgmq as $$
  select jsonb_build_object(
    'received_stuck', (select count(*) from upload_files where status = 'received' and received_at < now() - interval '1 hour'),
    'in_flight',      (select count(*) from upload_files where status in ('validated', 'transforming', 'loading')),
    'failed_24h',     (select count(*) from upload_files where status = 'failed' and coalesce(loaded_at, received_at) > now() - interval '24 hours'),
    'failed_names',   (select coalesce(jsonb_agg(file_name order by received_at desc), '[]'::jsonb) from (select file_name, received_at from upload_files where status = 'failed' and received_at > now() - interval '24 hours' limit 5) f),
    'queue_depth',    (select coalesce(count(*), 0) from pgmq.q_ingest),
    'dlq_depth',      (select coalesce(count(*), 0) from pgmq.q_ingest_dlq),
    'last_run',       (select to_jsonb(r) from (select started_at, finished_at, ok, files_loaded, files_failed, rows_loaded, note from pipeline_runs order by started_at desc limit 1) r)
  );
$$;
grant execute on function rake_enqueue(uuid) to service_role;
grant execute on function rake_health() to service_role;

-- ---- agent resolution (the Ops app's normName + sfOwnerMap) -------------------------------------
create or replace function norm_owner(v text) returns text
language sql immutable as $$
  select nullif(trim(regexp_replace(regexp_replace(lower(coalesce(v, '')), '\s+-\s*.*$|\s*-\s+.*$', ''), '\s+', ' ', 'g')), '');
$$;

create or replace function rake_owner_cb(p_owner text) returns text
language sql stable as $$
  with claims as (
    select distinct norm_cb(employee_code) as cb
      from agent_list_current
     where norm_owner(sales_force) = norm_owner(p_owner)
        or norm_owner(agent_name) = norm_owner(p_owner)
  )
  select case when count(*) = 1 then max(cb) else null end from claims;
$$;

-- the Salesforce owners that are holding queues, not people (the Ops rule leadQueueOwners)
create or replace function rake_owner_kind(p_owner text) returns text
language sql immutable as $$
  select case when lower(trim(coalesce(p_owner, ''))) in ('cuddle call', 'courtesy call', 'vip welcome calls', 'ec3 welcome call') then 'queue'
              when coalesce(p_owner, '') = '' then null else 'agent' end;
$$;

-- ---- text → typed, never raising ------------------------------------------------------------------
-- Salesforce exports "2026/07/30, 15:20" (SAST wall clock); ViciDial "2026-09-04 06:48:08"; Power BI an
-- Excel serial (46260) or a date. All arrive as text; a value that is not a date becomes null and the
-- row is rejected by the merge's guard rather than raising and losing the slice.
create or replace function rake_sf_ts_local(v text) returns timestamptz
language plpgsql immutable as $$
declare t text := nullif(trim(coalesce(v, '')), '');
begin
  if t is null then return null; end if;
  if t ~ '^\d{4}/\d{2}/\d{2},? \d{1,2}:\d{2}' then return (to_timestamp(replace(t, ',', ''), 'YYYY/MM/DD HH24:MI')::timestamp) at time zone 'Africa/Johannesburg'; end if;
  if t ~ '^\d{4}-\d{2}-\d{2}' then return (left(t, 19)::timestamp) at time zone 'Africa/Johannesburg'; end if;
  if t ~ '^\d{4}/\d{2}/\d{2}$' then return (replace(t, '/', '-')::timestamp) at time zone 'Africa/Johannesburg'; end if;
  return null;
exception when others then return null;
end $$;

create or replace function rake_date(v text) returns date
language plpgsql immutable as $$
declare t text := nullif(trim(coalesce(v, '')), '');
begin
  if t is null then return null; end if;
  if t ~ '^\d+(\.\d+)?$' then return date '1899-12-30' + floor(t::numeric)::int; end if;   -- Excel serial
  if t ~ '^\d{4}-\d{2}-\d{2}' then return left(t, 10)::date; end if;
  if t ~ '^\d{4}/\d{2}/\d{2}' then return replace(left(t, 10), '/', '-')::date; end if;
  if t ~ '^\d{2}/\d{2}/\d{4}' then return to_date(left(t, 10), 'DD/MM/YYYY'); end if;
  return null;
exception when others then return null;
end $$;

create or replace function rake_num(v text) returns numeric
language plpgsql immutable as $$
declare t text := nullif(trim(coalesce(v, '')), '');
begin
  if t is null then return null; end if;
  t := replace(replace(t, ' ', ''), ',', '.');         -- "629,0000000000" is a comma decimal
  if t ~ '^-?\d+(\.\d+)?$' then return t::numeric; end if;
  return null;
exception when others then return null;
end $$;

create or replace function rake_idish(v text) returns text
language sql immutable as $$ select nullif(regexp_replace(trim(coalesce(v, '')), '\.0+$', ''), ''); $$;

-- ---- staging tables: one per source, all text, the rake's own line number for checkpoints --------
create unlogged table if not exists rake_stage_sf_open (
  _seq bigint, case_id text, case_number text, subject text, opened_at text, age_hours text, account_name text,
  account_number text, case_owner text, status text, record_type text, snapshot_date text);
create unlogged table if not exists rake_stage_sf_closed (
  _seq bigint, case_id text, case_number text, subject text, opened_at text, closed_at text, disposition text,
  age_hours text, account_name text, account_number text, case_owner text, status text, record_type text);
create unlogged table if not exists rake_stage_bi (
  _seq bigint, account_no text, contract_status text, account_name text, contract_number text, owner text,
  contract_create_date text, charge_amount text, charge_code text, product_bundle text, merged_bundle text,
  consultant text, sales_vertical text, case_number text);
create unlogged table if not exists rake_stage_vici (
  _seq bigint, call_date text, agent_login text, lead_id text, status text, full_name text, user_group text,
  campaign_id text, length_in_sec text, status_name text);
create index if not exists rake_stage_sf_open_seq on rake_stage_sf_open (_seq);
create index if not exists rake_stage_sf_closed_seq on rake_stage_sf_closed (_seq);
create index if not exists rake_stage_bi_seq on rake_stage_bi (_seq);
create index if not exists rake_stage_vici_seq on rake_stage_vici (_seq);
grant all on rake_stage_sf_open, rake_stage_sf_closed, rake_stage_bi, rake_stage_vici to service_role;

-- ---- merges: one slice of staging → the partitioned parent, natural key wins ---------------------
-- Each returns (merged, rejected). A row is rejected when its key columns cannot be made: no case
-- number, no parseable date. Rejected rows are read back by the rake (rake_rejects_*) into failed/.
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
  good as (select * from src where snapshot_date is not null and case_number is not null),
  ins as (
    insert into sf_open_cases (snapshot_date, case_number, case_id, subject, opened_at, age_hours, account_number, account_name, case_owner, employee_code, owner_kind, status, record_type, batch_id)
    select distinct on (snapshot_date, case_number) snapshot_date, case_number, case_id, subject, opened_at, age_hours, account_number, account_name, case_owner,
           rake_owner_cb(case_owner), rake_owner_kind(case_owner), status, record_type, p_batch
      from good order by snapshot_date, case_number
    on conflict (snapshot_date, case_number) do update set case_id = excluded.case_id, subject = excluded.subject, opened_at = excluded.opened_at,
      age_hours = excluded.age_hours, account_number = excluded.account_number, account_name = excluded.account_name, case_owner = excluded.case_owner,
      employee_code = excluded.employee_code, owner_kind = excluded.owner_kind, status = excluded.status, record_type = excluded.record_type,
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
    select rake_idish(case_number) as case_number, rake_sf_ts_local(closed_at) as closed_at, nullif(trim(case_id), '') as case_id,
           rake_sf_ts_local(opened_at) as opened_at, nullif(trim(disposition), '') as disposition, nullif(trim(status), '') as status,
           rake_num(age_hours) as age_hours, rake_idish(account_number) as account_number, nullif(trim(account_name), '') as account_name,
           nullif(trim(case_owner), '') as case_owner
      from rake_stage_sf_closed where _seq > p_from and _seq <= p_to),
  good as (select * from src where closed_at is not null and case_number is not null),
  ins as (
    insert into sf_closed_cases (case_number, closed_at, closed_day, case_id, opened_at, disposition, status, age_hours, account_number, account_name, case_owner, employee_code, batch_id)
    select distinct on (case_number, closed_at) case_number, closed_at, (closed_at at time zone 'Africa/Johannesburg')::date, case_id, opened_at, disposition, status, age_hours,
           account_number, account_name, case_owner, rake_owner_cb(case_owner), p_batch
      from good order by case_number, closed_at
    on conflict (case_number, closed_at) do update set closed_day = excluded.closed_day, case_id = excluded.case_id, opened_at = excluded.opened_at,
      disposition = excluded.disposition, status = excluded.status, age_hours = excluded.age_hours, account_number = excluded.account_number,
      account_name = excluded.account_name, case_owner = excluded.case_owner, employee_code = excluded.employee_code, batch_id = excluded.batch_id, loaded_at = now()
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
  good as (select * from src where account_no is not null and contract_create_date is not null and charge_amount is not null),
  ins as (
    insert into bi_active_cases (account_no, contract_create_date, owner, cb, charge_amount, charge_code, contract_status, contract_number, case_number, account_name, consultant, product_bundle, merged_bundle, sales_vertical, batch_id)
    select distinct on (case_number, account_no, coalesce(contract_number, ''), coalesce(charge_code, ''), charge_amount, contract_create_date)
           account_no, contract_create_date, owner, rake_owner_cb(owner), charge_amount, charge_code, contract_status, contract_number, case_number, account_name, consultant, product_bundle, merged_bundle, sales_vertical, p_batch
      from good order by case_number, account_no, coalesce(contract_number, ''), coalesce(charge_code, ''), charge_amount, contract_create_date
    on conflict (case_number, account_no, coalesce(contract_number, ''), coalesce(charge_code, ''), charge_amount, contract_create_date) do update set
      owner = excluded.owner, cb = excluded.cb, contract_status = excluded.contract_status, account_name = excluded.account_name, consultant = excluded.consultant,
      product_bundle = excluded.product_bundle, merged_bundle = excluded.merged_bundle, sales_vertical = excluded.sales_vertical, batch_id = excluded.batch_id
    returning 1)
  select (select count(*) from ins), (select count(*) from src) - (select count(*) from good) into n, r;
  return query select n, r;
end $$;

create or replace function rake_merge_vici(p_batch text, p_from bigint, p_to bigint) returns table (merged bigint, rejected bigint)
language plpgsql as $$
declare n bigint; r bigint;
begin
  with src as (
    select rake_sf_ts_local(call_date) as call_date, coalesce(nullif(trim(agent_login), ''), '') as agent_login, coalesce(nullif(trim(lead_id), ''), '') as lead_id,
           coalesce(nullif(trim(status), ''), '') as status, nullif(trim(full_name), '') as full_name, nullif(trim(user_group), '') as user_group,
           nullif(trim(campaign_id), '') as campaign_id, coalesce(rake_num(length_in_sec), 0)::int as length_in_sec, nullif(trim(status_name), '') as status_name
      from rake_stage_vici where _seq > p_from and _seq <= p_to),
  good as (select * from src where call_date is not null),
  ins as (
    insert into vici_calls (call_date, call_day, agent_login, lead_id, status, full_name, user_group, campaign_id, length_in_sec, status_name, employee_code, batch_id)
    select distinct on (call_date, agent_login, lead_id, status) call_date, (call_date at time zone 'Africa/Johannesburg')::date, agent_login, lead_id, status, full_name, user_group, campaign_id, length_in_sec, status_name,
           case when upper(regexp_replace(agent_login, '[^A-Za-z0-9]', '', 'g')) ~ '^CB\d+$' then upper(regexp_replace(agent_login, '[^A-Za-z0-9]', '', 'g')) else null end, p_batch
      from good order by call_date, agent_login, lead_id, status
    on conflict (call_date, agent_login, lead_id, status) do update set call_day = excluded.call_day, full_name = excluded.full_name, user_group = excluded.user_group,
      campaign_id = excluded.campaign_id, length_in_sec = excluded.length_in_sec, status_name = excluded.status_name, employee_code = excluded.employee_code, batch_id = excluded.batch_id
    returning 1)
  select (select count(*) from ins), (select count(*) from src) - (select count(*) from good) into n, r;
  return query select n, r;
end $$;

-- the rows a merge could not key, for failed/<…>/rejects.csv
create or replace view rake_rejects_sf_open   as select * from rake_stage_sf_open   where rake_date(snapshot_date) is null or rake_idish(case_number) is null;
create or replace view rake_rejects_sf_closed as select * from rake_stage_sf_closed where rake_sf_ts_local(closed_at) is null or rake_idish(case_number) is null;
create or replace view rake_rejects_bi        as select * from rake_stage_bi        where rake_idish(account_no) is null or rake_date(contract_create_date) is null or rake_num(charge_amount) is null;
create or replace view rake_rejects_vici      as select * from rake_stage_vici      where rake_sf_ts_local(call_date) is null;
grant select on rake_rejects_sf_open, rake_rejects_sf_closed, rake_rejects_bi, rake_rejects_vici to service_role;
grant execute on function rake_merge_sf_open(text, bigint, bigint), rake_merge_sf_closed(text, bigint, bigint), rake_merge_bi(text, bigint, bigint), rake_merge_vici(text, bigint, bigint) to service_role;
grant execute on function rake_owner_cb(text), rake_owner_kind(text), norm_owner(text), rake_sf_ts_local(text), rake_date(text), rake_num(text), rake_idish(text) to service_role;
