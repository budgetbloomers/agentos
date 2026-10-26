-- migration-064 — OPEN CASES KEEPS AGENT ROWS; THE QUEUES BECOME A DAILY COUNT (stability plan, 2026-10-26)
--
-- Every morning's Salesforce Open Cases export (~490k rows) was stored whole as a new snapshot_date in sf_open_cases. About
-- 400k of each day's rows are the unallocated "Courtesy Call" / "Cuddle Call" queues (owner_kind = 'queue'), which nothing
-- reads row by row: the lead book ships only agent-owned rows and only COUNTS the queues (lm_open_book_refresh, migration-035).
-- By 26 Oct the table held ~14.1M rows and the database was 4.66 GB of an 8 GB disk, growing by a full book a day.
--
-- From this migration on, a load stores the agent-owned (and unclassified) rows exactly as before, and each queue row becomes
-- one count in sf_open_queue_daily instead. Each day's load is then ~80% smaller. NOTHING IS DELETED HERE: the snapshots
-- already in the table stay until the retention step (archive, verify, then drop whole months) is approved and run.
--
-- The counts are keyed by (snapshot_date, batch_id, chunk_from, case_owner, status) and REPLACED on conflict, so a chunk the
-- loader merges twice (a retry, a re-run tab) never double-counts, and a re-upload of the same day (a new batch) is counted
-- on its own. The lead book counts the queues of the batch it shows.
--
-- Safe to run twice: create … if not exists / create or replace only.

create table if not exists sf_open_queue_daily (
  snapshot_date date   not null,
  batch_id      text   not null,
  chunk_from    bigint not null,           -- the loader's chunk (p_from) — makes a re-merged chunk replace, not add
  case_owner    text   not null,
  status        text   not null default '',
  n             bigint not null check (n >= 0),
  primary key (snapshot_date, batch_id, chunk_from, case_owner, status)
);
create index if not exists sfqueue_day_batch_idx on sf_open_queue_daily (snapshot_date, batch_id);
alter table sf_open_queue_daily enable row level security;
grant select, insert, update, delete on sf_open_queue_daily to service_role;
comment on table sf_open_queue_daily is 'Open Cases queue rows (owner_kind = queue) as counts per day, batch, loader chunk, queue owner and status — the rows themselves are no longer stored in sf_open_cases (migration-064).';

create or replace function rake_merge_sf_open(p_batch text, p_from bigint, p_to bigint) returns table (merged bigint, rejected bigint)
language plpgsql as $$
declare v_merged bigint; v_rejected bigint;   -- not `n`: sf_open_queue_daily has a column n, and plpgsql would not know which is meant
begin
  with src as (
    select rake_date(snapshot_date) as snapshot_date, rake_idish(case_number) as case_number, nullif(trim(case_id), '') as case_id,
           nullif(trim(subject), '') as subject, rake_sf_ts_local(opened_at) as opened_at, rake_num(age_hours) as age_hours,
           rake_idish(account_number) as account_number, nullif(trim(account_name), '') as account_name,
           nullif(trim(case_owner), '') as case_owner, nullif(trim(status), '') as status, nullif(trim(record_type), '') as record_type
      from rake_stage_sf_open where _seq > p_from and _seq <= p_to),
  good as (select s.*, m.cb, rake_owner_kind(s.case_owner) as kind
             from src s left join rake_owner_map m on m.key = norm_owner(s.case_owner)
            where s.snapshot_date is not null and s.case_number is not null),
  one as (select distinct on (snapshot_date, case_number) * from good order by snapshot_date, case_number),
  -- agent-owned and unclassified rows: stored exactly as migration-030 stored them
  ins as (
    insert into sf_open_cases (snapshot_date, case_number, case_id, subject, opened_at, age_hours, account_number, account_name, case_owner, employee_code, owner_kind, status, record_type, batch_id)
    select snapshot_date, case_number, case_id, subject, opened_at, age_hours, account_number, account_name, case_owner,
           cb, kind, status, record_type, p_batch
      from one where kind is distinct from 'queue'
    on conflict (snapshot_date, case_number) do update set case_id = excluded.case_id, subject = excluded.subject, opened_at = excluded.opened_at,
      age_hours = excluded.age_hours, account_number = excluded.account_number, account_name = excluded.account_name, case_owner = excluded.case_owner,
      employee_code = coalesce(excluded.employee_code, sf_open_cases.employee_code), owner_kind = excluded.owner_kind, status = excluded.status, record_type = excluded.record_type,
      batch_id = excluded.batch_id, loaded_at = now()
    returning 1),
  -- queue rows: one count per (day, owner, status) for this chunk — replaced, never added, if the chunk is merged again
  q as (
    insert into sf_open_queue_daily (snapshot_date, batch_id, chunk_from, case_owner, status, n)
    select snapshot_date, p_batch, p_from, case_owner, coalesce(status, ''), count(*)
      from one where kind = 'queue' group by snapshot_date, case_owner, coalesce(status, '')
    on conflict (snapshot_date, batch_id, chunk_from, case_owner, status) do update set n = excluded.n
    returning sf_open_queue_daily.n as qn)
  select (select count(*) from ins) + coalesce((select sum(q.qn) from q), 0), (select count(*) from src) - (select count(*) from good) into v_merged, v_rejected;
  return query select v_merged, v_rejected;
end $$;
comment on function rake_merge_sf_open is 'Open Cases chunk → sf_open_cases (agent-owned and unclassified rows) + sf_open_queue_daily (queue rows as counts). merged counts both; rejected = rows without a date or case number (migration-064).';

create or replace function lm_open_book_refresh() returns jsonb
language plpgsql as $$
declare
  d      date;
  l      timestamptz;
  b      text;
  qn     bigint;
  meta   jsonb;
begin
  select max(snapshot_date) into d from sf_open_cases;
  if d is null then return jsonb_build_object('empty', true); end if;
  select max(loaded_at) into l from sf_open_cases where snapshot_date = d;
  -- nothing new since the last build: say so and leave the row alone
  if exists (select 1 from lm_open_book_cache c where c.snapshot_date = d and c.loaded_at = l) then
    select jsonb_build_object('snapshot_date', c.snapshot_date, 'loaded_at', c.loaded_at, 'unchanged', true,
                              'agent_rows', c.agent_rows, 'file', c.file)
      into meta from lm_open_book_cache c;
    return meta;
  end if;
  select batch_id into b from sf_open_cases where snapshot_date = d order by loaded_at desc limit 1;
  -- the queues of the batch on show: counted rows (migration-064) plus any queue rows stored before it
  select coalesce(sum(q.n), 0) into qn from sf_open_queue_daily q where q.snapshot_date = d and q.batch_id = b;
  insert into lm_open_book_cache as c (id, snapshot_date, loaded_at, batch, file, total, agent_rows, queue_rows, rows, built_at)
  select 1, d, l, b, (select file_name from batches where batch_id = b),
         count(*) + qn, count(*) filter (where owner_kind = 'agent'), count(*) filter (where owner_kind = 'queue') + qn,
         coalesce(jsonb_agg(jsonb_build_object('k', case_number, 'o', case_owner, 's', status, 'd', opened_at)
                            order by case_owner, case_number) filter (where owner_kind = 'agent'), '[]'::jsonb),
         now()
    from sf_open_cases where snapshot_date = d
  on conflict (id) do update set
    snapshot_date = excluded.snapshot_date, loaded_at = excluded.loaded_at, batch = excluded.batch, file = excluded.file,
    total = excluded.total, agent_rows = excluded.agent_rows, queue_rows = excluded.queue_rows, rows = excluded.rows, built_at = excluded.built_at;
  select jsonb_build_object('snapshot_date', c.snapshot_date, 'loaded_at', c.loaded_at, 'unchanged', false,
                            'total', c.total, 'agent_rows', c.agent_rows, 'queue_rows', c.queue_rows, 'file', c.file)
    into meta from lm_open_book_cache c;
  return meta;
end $$;
comment on function lm_open_book_refresh is 'Rebuild lm_open_book_cache from the newest sf_open_cases snapshot; queue_rows = stored queue rows + the sf_open_queue_daily counts of the batch shown (migration-064). A no-op (unchanged:true) when nothing loaded since the last build.';
