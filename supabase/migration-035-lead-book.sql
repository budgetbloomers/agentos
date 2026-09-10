-- migration-035-lead-book.sql
-- THE LEAD MANAGEMENT BOOK IS SERVED FROM THE LAKE (2026-09-10).
--
-- WHY: the Salesforce Open Cases export outgrew the browser on 8 Sep — 94 MB as CSV, 342 MB as
-- the .xls frameset, ~487,000 rows — so the Upload Station routes it to storage and the Rake
-- loads it into sf_open_cases. The Lead Management page in PULSE reads S.opencasesLM, which only
-- the in-page parse ever filled, so it stayed on the 6 Sep pull while the lake moved on every
-- morning and nothing on screen said so.
--
-- BUILT ONCE, READ MANY. Aggregating the agent-owned rows of a snapshot into JSON takes ~10 s on
-- this instance and PostgREST cancels at 8 s, so the book is not computed on request: the Rake
-- calls lm_open_book_refresh() after every SF_OPEN_CASES load (and the nightly lake step calls it
-- again), which writes ONE row into lm_open_book_cache. The Worker serves that row from
-- /api/lead-book — meta without the rows for the freshness poll, the whole book on adoption.
--
-- Agent-owned rows only. ~400,000 of the rows are the "Courtesy Call" / "Cuddle Call" queues —
-- the unallocated pool, which matches nobody on the Agent List and never did. They are counted
-- (queue_rows) so the page can still say how many cases sit outside the funnel, but not shipped.
-- Owners travel as the Salesforce string: the browser resolves them through the Agent List
-- (resolveKey), exactly as it did for the file, so attribution never grows a second definition.

-- the first cut of this migration took a p_snapshot argument; the cache makes it moot
drop function if exists lm_open_book_meta(date);
drop function if exists lm_open_book(date);

-- THE NO-OP MUST BE CHEAP: the refresh's freshness test is max(loaded_at) over the newest snapshot
-- (~490,000 rows; 6 s as a heap scan). With this index it is a backward index scan in milliseconds,
-- which is what lets pg_cron ask every ten minutes as the backstop for a dropped runner.
create index if not exists sfopen_snap_loaded_idx on sf_open_cases (snapshot_date, loaded_at desc);

create table if not exists lm_open_book_cache (
  id            int          primary key default 1 check (id = 1),   -- one row: the newest snapshot
  snapshot_date date         not null,
  loaded_at     timestamptz  not null,        -- max(loaded_at) of that snapshot: the freshness stamp
  batch         text,
  file          text,                         -- the upload that last touched the snapshot
  total         bigint       not null,
  agent_rows    bigint       not null,
  queue_rows    bigint       not null,
  rows          jsonb        not null,        -- [{k: case_number, o: case_owner, s: status, d: opened_at}]
  built_at      timestamptz  not null default now()
);
comment on table lm_open_book_cache is 'The Lead Management open-case book (agent-owned rows of the newest sf_open_cases snapshot), rebuilt by lm_open_book_refresh() after each Rake load and served by the Worker at /api/lead-book.';

create or replace function lm_open_book_refresh() returns jsonb
language plpgsql as $$
declare
  d      date;
  l      timestamptz;
  b      text;
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
  insert into lm_open_book_cache as c (id, snapshot_date, loaded_at, batch, file, total, agent_rows, queue_rows, rows, built_at)
  select 1, d, l, b, (select file_name from batches where batch_id = b),
         count(*), count(*) filter (where owner_kind = 'agent'), count(*) filter (where owner_kind = 'queue'),
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

-- the freshness poll: everything but the rows
create or replace function lm_open_book_meta() returns jsonb
language sql stable as $$
  select coalesce((select jsonb_build_object('snapshot_date', snapshot_date, 'loaded_at', loaded_at, 'batch', batch, 'file', file,
                                             'total', total, 'agent_rows', agent_rows, 'queue_rows', queue_rows, 'built_at', built_at)
                     from lm_open_book_cache), jsonb_build_object('empty', true));
$$;

-- the book: meta plus rows
create or replace function lm_open_book() returns jsonb
language sql stable as $$
  select coalesce((select lm_open_book_meta() || jsonb_build_object('rows', rows) from lm_open_book_cache),
                  jsonb_build_object('empty', true));
$$;

comment on function lm_open_book_refresh is 'Rebuild lm_open_book_cache from the newest sf_open_cases snapshot; a no-op (unchanged:true) when nothing loaded since the last build. Called by tools/rake.mjs after each SF_OPEN_CASES load.';
comment on function lm_open_book is 'Lead Management open-case book from the lake cache: meta + agent-owned rows as {k,o,s,d}. Served by the Worker at /api/lead-book.';
comment on function lm_open_book_meta is 'Freshness of the Lead Management book without the rows: snapshot_date, loaded_at, counts, source file.';

-- THE BACKSTOP. tools/rake.mjs is the driver (it calls the refresh right after a load), but the runner
-- is GitHub's and GitHub drops schedules (2026-09-08, and again 2026-09-10 06:36–10:07 SAST). The
-- database asks itself every ten minutes; unchanged is a millisecond no-op with the index above.
select cron.unschedule('lead-book-refresh') where exists (select 1 from cron.job where jobname = 'lead-book-refresh');
select cron.schedule('lead-book-refresh', '*/10 * * * *', $cron$select lm_open_book_refresh()$cron$);
