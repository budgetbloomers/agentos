-- migration-027 — Phase 0 of the Data Rake: the lake is partitioned; the rake's tables and queue exist.
--
-- Nick, 2026-09-08 (design: specs/data-pipeline-plan.md, artifact "Chatterbox Data Rake"): the files
-- that reach 500 MB are the Salesforce and Power BI case exports (open, closed, BI active), rarely a
-- ViciDial report. Those four tables become monthly range-partitioned parents so a load touches one
-- or two partitions, an old month is never rewritten, and dropping a month is one statement. The
-- other lake tables (attendance, QA, referrals, inactive, CallX) stay as they are — they are small.
--
-- RULES POSTGRES IMPOSES, AND HOW THEY ARE MET
--   · Every unique key on a partitioned table must include the partition column. vici_calls,
--     sf_closed_cases and sf_open_cases already key on their event timestamp/date, so they are
--     partitioned on that column and keep their keys verbatim. bi_active_cases keyed on a surrogate
--     `id`; its key becomes (id, contract_create_date) and its natural unique key (which already
--     carries the date) is kept, so a re-upload still lands once.
--   · A view that reads a table blocks its rename. The seven dependent views are saved by
--     definition, dropped, and re-created verbatim at the end.
--   · The identity column on bi_active_cases is carried over (LIKE … INCLUDING IDENTITY), existing
--     ids are inserted OVERRIDING SYSTEM VALUE, and the new sequence is set past the maximum.
--
-- Partitions are managed by pg_partman (monthly, two ahead, a default partition for strays) and a
-- daily pg_cron job keeps making them. Everything runs in ONE transaction: row counts are compared
-- before any legacy table is dropped, and a mismatch raises, which rolls the whole file back.

create schema if not exists partman;
create extension if not exists pg_partman schema partman;
create extension if not exists pgmq;
create extension if not exists pg_cron;

-- ---- 0. save the dependent views, then drop them ------------------------------------------------
create table if not exists _view_backup_027 (name text primary key, def text not null, saved_at timestamptz default now());
insert into _view_backup_027 (name, def)
select viewname, pg_get_viewdef(('public.' || viewname)::regclass, true)
  from pg_views where schemaname = 'public'
   and viewname in ('lake_unmatched', 'lake_duplicates', 'lake_audit', 'data_reach', 'bi_money_by_agent', 'bi_money_by_month', 'bi_money_total')
on conflict (name) do nothing;
drop view if exists lake_unmatched, lake_duplicates, lake_audit, data_reach, bi_money_by_agent, bi_money_by_month, bi_money_total cascade;

-- ---- 1. vici_calls — partition on call_date (the PK's first column) --------------------------------
alter table vici_calls rename to vici_calls_legacy;
alter index vici_calls_pkey rename to vici_calls_pkey_legacy;
alter index vici_day_idx rename to vici_day_idx_legacy;
alter index vici_group_idx rename to vici_group_idx_legacy;
create table vici_calls (like vici_calls_legacy including defaults including comments) partition by range (call_date);
alter table vici_calls add primary key (call_date, agent_login, lead_id, status);
create index vici_calls_brin_idx  on vici_calls using brin (call_date);
create index vici_day_idx         on vici_calls (call_day, employee_code);
create index vici_group_idx       on vici_calls (call_day, user_group);
select partman.create_parent(p_parent_table => 'public.vici_calls', p_control => 'call_date', p_interval => '1 month', p_premake => 2, p_start_partition => '2026-08-01', p_jobmon => false);
insert into vici_calls select * from vici_calls_legacy;

-- ---- 2. sf_closed_cases — partition on closed_at -------------------------------------------------
alter table sf_closed_cases rename to sf_closed_cases_legacy;
alter index sf_closed_cases_pkey rename to sf_closed_cases_pkey_legacy;
alter index sfclosed_day_idx rename to sfclosed_day_idx_legacy;
create table sf_closed_cases (like sf_closed_cases_legacy including defaults including comments) partition by range (closed_at);
alter table sf_closed_cases add primary key (case_number, closed_at);
create index sfclosed_brin_idx on sf_closed_cases using brin (closed_at);
create index sfclosed_day_idx  on sf_closed_cases (closed_day, employee_code);
select partman.create_parent(p_parent_table => 'public.sf_closed_cases', p_control => 'closed_at', p_interval => '1 month', p_premake => 2, p_start_partition => '2026-07-01', p_jobmon => false);
insert into sf_closed_cases select * from sf_closed_cases_legacy;

-- ---- 3. sf_open_cases — partition on snapshot_date -----------------------------------------------
alter table sf_open_cases rename to sf_open_cases_legacy;
alter index sf_open_cases_pkey rename to sf_open_cases_pkey_legacy;
alter index sfopen_owner_idx rename to sfopen_owner_idx_legacy;
alter index sfopen_status_idx rename to sfopen_status_idx_legacy;
create table sf_open_cases (like sf_open_cases_legacy including defaults including comments) partition by range (snapshot_date);
alter table sf_open_cases add primary key (snapshot_date, case_number);
create index sfopen_owner_idx  on sf_open_cases (snapshot_date, employee_code);
create index sfopen_status_idx on sf_open_cases (snapshot_date, status);
select partman.create_parent(p_parent_table => 'public.sf_open_cases', p_control => 'snapshot_date', p_interval => '1 month', p_premake => 2, p_start_partition => '2025-10-01', p_jobmon => false);
insert into sf_open_cases select * from sf_open_cases_legacy;

-- ---- 4. bi_active_cases — partition on contract_create_date; identity carried over ----------------
alter table bi_active_cases rename to bi_active_cases_legacy;
alter index bi_active_cases_pkey rename to bi_active_cases_pkey_legacy;
alter index bi_active_cases_natural_uq rename to bi_active_cases_natural_uq_legacy;
alter index bi_active_cases_date_idx rename to bi_active_cases_date_idx_legacy;
alter index bi_active_cases_cb_date_idx rename to bi_active_cases_cb_date_idx_legacy;
alter index bi_active_cases_acct_idx rename to bi_active_cases_acct_idx_legacy;
alter index bi_active_cases_batch_idx rename to bi_active_cases_batch_idx_legacy;
create table bi_active_cases (like bi_active_cases_legacy including defaults including identity including comments) partition by range (contract_create_date);
alter table bi_active_cases add primary key (id, contract_create_date);
alter table bi_active_cases add constraint bi_active_cases_batch_id_fkey foreign key (batch_id) references batches(batch_id);
create unique index bi_active_cases_natural_uq on bi_active_cases (case_number, account_no, coalesce(contract_number, ''), coalesce(charge_code, ''), charge_amount, contract_create_date);
create index bi_active_cases_date_idx    on bi_active_cases (contract_create_date);
create index bi_active_cases_cb_date_idx on bi_active_cases (cb, contract_create_date);
create index bi_active_cases_acct_idx    on bi_active_cases (account_no, contract_create_date);
create index bi_active_cases_batch_idx   on bi_active_cases (batch_id);
select partman.create_parent(p_parent_table => 'public.bi_active_cases', p_control => 'contract_create_date', p_interval => '1 month', p_premake => 2, p_start_partition => '2026-06-01', p_jobmon => false);
insert into bi_active_cases overriding system value select * from bi_active_cases_legacy;
select setval(pg_get_serial_sequence('public.bi_active_cases', 'id'), coalesce((select max(id) from bi_active_cases), 1));

-- ---- 5. every row must have crossed, or nothing happened -----------------------------------------
do $$
declare t text; a bigint; b bigint;
begin
  foreach t in array array['vici_calls', 'sf_closed_cases', 'sf_open_cases', 'bi_active_cases'] loop
    execute format('select count(*) from %I', t) into a;
    execute format('select count(*) from %I', t || '_legacy') into b;
    if a <> b then raise exception 'migration-027: % has % rows but its legacy table has % — rolled back', t, a, b; end if;
  end loop;
end $$;
drop table vici_calls_legacy, sf_closed_cases_legacy, sf_open_cases_legacy, bi_active_cases_legacy;

-- ---- 6. the dependent views, verbatim ---------------------------------------------------------------
do $$
declare r record;
begin
  for r in select name, def from _view_backup_027 order by case name when 'lake_unmatched' then 1 when 'lake_duplicates' then 2 when 'lake_audit' then 3 else 4 end, name loop
    execute format('create view %I as %s', r.name, r.def);
  end loop;
end $$;

-- ---- 7. row-level security and grants, as on every lake table ------------------------------------
alter table vici_calls enable row level security;
alter table sf_closed_cases enable row level security;
alter table sf_open_cases enable row level security;
alter table bi_active_cases enable row level security;
grant all on vici_calls, sf_closed_cases, sf_open_cases, bi_active_cases to service_role;
grant select on data_reach, lake_audit, lake_duplicates, lake_unmatched, bi_money_by_agent, bi_money_by_month, bi_money_total to service_role;

-- ---- 8. partitions keep being made without a person -------------------------------------------------
select cron.unschedule(jobid) from cron.job where jobname = 'partman-maintenance';
select cron.schedule('partman-maintenance', '17 2 * * *', $cron$call partman.run_maintenance_proc()$cron$);

-- ---- 9. the rake's bookkeeping ----------------------------------------------------------------------
-- upload_files: one row per file the large-file path receives — the state machine (Supabase ETL's
-- idea) and the lineage row (dlt's load_id) in one place. The small-file relay keeps kv:upload-manifest
-- for now; upload_manifest_files is the compatibility view for whoever reads both.
create table if not exists upload_files (
  id            uuid primary key default gen_random_uuid(),
  source        text,                                   -- VICI_CALL_REPORT | SF_OPEN_CASES | SF_CLOSED_CASES | BI_ACTIVE_CASES | … | null until validated
  file_name     text not null,
  bytes         bigint,
  sha256        text unique,                            -- computed by the runner while streaming; null until validated
  storage_bucket text not null default 'raw-uploads',
  storage_path  text not null,
  status        text not null default 'received' check (status in ('received', 'validated', 'transforming', 'loading', 'loaded', 'failed')),
  rows_in       bigint,
  rows_loaded   bigint not null default 0,
  rows_rejected bigint not null default 0,
  checkpoint    jsonb,                                  -- {chunk: n} — the merge resumes here
  parquet_path  text,
  error         text,
  attempts      integer not null default 0,
  uploaded_by   text,
  received_at   timestamptz not null default now(),
  validated_at  timestamptz,
  loaded_at     timestamptz,
  run_id        uuid
);
create index if not exists upload_files_source_idx on upload_files (source, received_at desc);
create index if not exists upload_files_status_idx on upload_files (status) where status <> 'loaded';
alter table upload_files enable row level security;
grant all on upload_files to service_role;
comment on table upload_files is 'Every file the large-file path received: state machine received→validated→transforming→loading→loaded|failed, sha256, rows, checkpoint, error. Written by the Worker (received) and the runner (the rest).';

create or replace view upload_manifest_files as
select file_name as n, sha256 as h, bytes as s, received_at as at, source, status, storage_bucket || '/' || storage_path as path
  from upload_files order by received_at desc;
grant select on upload_manifest_files to service_role;

create table if not exists pipeline_runs (
  run_id       uuid primary key default gen_random_uuid(),
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  ok           boolean,
  files_seen   integer not null default 0,
  files_loaded integer not null default 0,
  files_failed integer not null default 0,
  rows_loaded  bigint  not null default 0,
  seconds      numeric,
  note         text
);
create index if not exists pipeline_runs_started_idx on pipeline_runs (started_at desc);
alter table pipeline_runs enable row level security;
grant all on pipeline_runs to service_role;

-- the hand-off: one message per received file; three failed reads move it to the dead-letter queue
select pgmq.create('ingest');
select pgmq.create('ingest_dlq');

-- ---- 10. agent_day — one row per agent per day from the lake (the feature store) -------------------
-- Deliberately plain: counts and sums straight off the lake tables, no scoring rules. The scoring
-- engine stays PULSE's; this is the table analysis and ML read. Refreshed after every load and by
-- the runner's tick; unique (employee_code, day) so REFRESH … CONCURRENTLY works.
create materialized view if not exists agent_day as
with days as (
  select cb as employee_code, contract_create_date as day from bi_active_cases where cb is not null
  union select employee_code, call_day from vici_calls where employee_code is not null
  union select employee_code, date_of_call from qa_evaluations where employee_code is not null and date_of_call is not null
  union select employee_code, attendance_date from attendance
  union select employee_code, snapshot_date from sf_open_cases where employee_code is not null
  union select employee_code, closed_day from sf_closed_cases where employee_code is not null
),
sales as (select cb as employee_code, contract_create_date as day, count(distinct case_number) as sales, sum(charge_amount) as gwp_ex from bi_active_cases where cb is not null group by 1, 2),
calls as (select employee_code, call_day as day, count(*) as calls, sum(length_in_sec) as talk_sec from vici_calls where employee_code is not null group by 1, 2),
qa as (select employee_code, date_of_call as day, avg(score_pct) as qa_mean, count(*) as qa_n from qa_evaluations where employee_code is not null and date_of_call is not null group by 1, 2),
att as (select employee_code, attendance_date as day, max(status_code) as att_status from attendance group by 1, 2),
leads as (select employee_code, snapshot_date as day, count(distinct case_number) as open_leads from sf_open_cases where employee_code is not null group by 1, 2),
closed as (select employee_code, closed_day as day, count(*) as closed_cases from sf_closed_cases where employee_code is not null group by 1, 2)
select d.employee_code, d.day,
       s.sales, s.gwp_ex, c.calls, c.talk_sec, q.qa_mean, q.qa_n, a.att_status, l.open_leads, x.closed_cases
  from days d
  left join sales  s on s.employee_code = d.employee_code and s.day = d.day
  left join calls  c on c.employee_code = d.employee_code and c.day = d.day
  left join qa     q on q.employee_code = d.employee_code and q.day = d.day
  left join att    a on a.employee_code = d.employee_code and a.day = d.day
  left join leads  l on l.employee_code = d.employee_code and l.day = d.day
  left join closed x on x.employee_code = d.employee_code and x.day = d.day
with no data;
create unique index if not exists agent_day_uq on agent_day (employee_code, day);
create index if not exists agent_day_day_idx on agent_day (day);
refresh materialized view agent_day;
grant select on agent_day to service_role;

drop table _view_backup_027;
