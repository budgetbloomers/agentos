-- migration-071-vt-facts.sql — THE VEHICLE TRACKING CASE BOOK (Spec Kit 071, plan §DB, 2026-11-23)
--
-- WHY. Vehicle Tracking (VT) gets its own facts, apart from everything VAS: the daily BI Active Fitted and Scheduled &
-- Missed exports are merged per Case Number into ONE current row per sale plus one event per real status change. The
-- book is small, keyed and updated by case every day, so it is a table — not a KV blob (rewritten whole per upload, no
-- trim point, a race) and NEVER a daily snapshot (the open-cases lesson: a ~490k-row book stored per day became 14.1M
-- rows / 4.66 GB). The raw files are not stored either (they carry customer PII): the browser parses them, drops every
-- customer field (plan DB-4) and sends only changed case rows and events; the files' hashes and receipts are kept.
--
-- NO MERGE LOGIC LIVES HERE. The status precedence, sale day, seller and lead source are decided ONCE, in
-- nicks_code/vt-engine.js (VTEngine.merge, oracle-tested). These functions apply the rows the engine computed and
-- enforce only keys, checks, idempotency and the book revision (compare-and-set). The two book-level facts below are
-- bookkeeping, derived from the upload rows themselves: opened_on (the first daily extract ever committed = go-live; the
-- rating's working days start the day after it) and opening_book_on (when the optional opening book was loaded).
--
--   vt_upload_begin(sha, kind, file, extract_on, cycle_key, user)  claims the file; a committed hash → duplicate
--   vt_upload_stage(id, kind, from_ord, rows)                      ≤ 1,000 rows per call, a retried batch is a no-op
--   vt_upload_commit(id, base_rev, counts, unmatched, warnings, quiet_ack, n_cases, n_events)
--                                                                  ONE transaction: lock the revision, refuse a stale
--                                                                  base (version_conflict → the Worker answers 409) or a
--                                                                  short stage, upsert cases, insert events, rev + 1
--   vt_upload_abandon(id)                                          a station that gave up
--   vt_book(p_from, p_also)                                        the book as ONE json value (not paged)  
--   vt_trim(keep_cycles, today, start_day)                         13 business months kept; weekly (health cron, F3)
--   vt_db_size()                                                   rows + bytes per table (tools/vt-db-size.mjs, db_health)
--
-- SIZE (plan DB-5, from the sample files): ~3,000 new cases and ~7,500 events per business month, ~2 MB/month;
-- steady state after the 13-cycle trim ~39k cases + ~98k events ≈ 27 MB. A typical day writes a few hundred rows.
-- No partitioning (revisit above 5M event rows), no dedupe_lake() extension (unique keys make twins impossible).
--
-- SECURITY (plan DB-6): RLS on every table with NO policy, every privilege revoked from public/anon/authenticated,
-- EXECUTE revoked on every function AFTER its definition (create or replace re-grants it — migration-049's lesson),
-- service_role (the Worker) granted explicitly. Functions are SECURITY INVOKER: they run with the caller's rights.
--
-- Apply: node tools/apply-migration.mjs supabase/migration-071-vt-facts.sql   (the OWNER, at deploy — before 072)
-- Guarded by nicks_code/diagnostics/verify-vt-db.mjs (PGlite, in-process; never a live database).

-- ------------------------------------------------------------------------------------------------- vt_uploads
create table if not exists vt_uploads (
  id             bigserial primary key,
  sha256         text not null unique check (sha256 ~ '^[0-9a-f]{64}$'),
  kind           text not null check (kind in ('bi_fitted', 'sched_missed', 'opening_book')),
  file_name      text not null check (length(file_name) between 1 and 300),
  extract_on     date not null,
  cycle_key      text not null check (cycle_key ~ '^cycle-[0-9]{4}-(0[1-9]|1[0-2])$'),
  state          text not null default 'staging' check (state in ('staging', 'committed', 'abandoned')),
  counts         jsonb,
  unmatched      jsonb,
  warnings       jsonb,
  quiet_day_ack  boolean not null default false,
  uploaded_by    text,
  started_at     timestamptz not null default now(),
  committed_at   timestamptz,
  rev_after      bigint,
  result         jsonb                                   -- the commit's answer, returned again on a re-commit
);
create index if not exists vt_uploads_kind_extract_idx on vt_uploads (kind, extract_on desc) where state = 'committed';
comment on table vt_uploads is 'VT upload receipts and manifest (spec 071). One row per file hash; the raw file is never stored.';

-- ------------------------------------------------------------------------------------------------- vt_cases
create table if not exists vt_cases (
  case_number   bigint primary key check (case_number between 1 and 999999999999),
  status        text not null check (status in ('scheduled', 'missed', 'fitted', 'cancelled')),
  status_on     date not null,
  sold_on       date,
  sold_basis    text not null check (sold_basis in ('first_seen', 'opening_book', 'unknown')),
  first_seen    date not null,
  last_seen     date not null,
  appt_on       date,
  fitted_on     date,
  sm_attempt    text,
  products      text[] not null default '{}',
  bundle        text,
  charge_ex     numeric(10,2),
  partner_raw   text,
  lead_source   text check (lead_source is null or lead_source ~ '^[a-z_]{1,40}$'),
  seller_name   text,                                    -- normalised Salesforce display name of the SELLER (staff)
  seller_cb     text check (seller_cb is null or seller_cb ~ '^CB[0-9]+$'),
  seller_match  text check (seller_match is null or seller_match in ('exact', 'alias', 'near', 'first_last', 'unmatched')),
  last_upload   bigint not null references vt_uploads (id),
  rev           bigint not null,
  updated_at    timestamptz not null default now(),
  check (last_seen >= first_seen)
);
create index if not exists vt_cases_open_idx on vt_cases (appt_on) where status in ('scheduled', 'missed');
create index if not exists vt_cases_last_seen_idx on vt_cases (last_seen);
create index if not exists vt_cases_sold_idx on vt_cases (sold_on);
create index if not exists vt_cases_fitted_idx on vt_cases (fitted_on) where fitted_on is not null;
create index if not exists vt_cases_seller_idx on vt_cases (seller_cb, sold_on);
create index if not exists vt_cases_last_upload_idx on vt_cases (last_upload);
comment on table vt_cases is 'VT case book (spec 071): the CURRENT state of each sale. No customer field. Team leader and sub-campaign are NOT stored — they come from the Agent List in force each business month.';

-- ------------------------------------------------------------------------------------------------- vt_case_events
create table if not exists vt_case_events (
  case_number  bigint not null references vt_cases (case_number) on delete cascade,
  on_date      date not null,
  from_status  text check (from_status is null or from_status in ('scheduled', 'missed', 'fitted', 'cancelled')),
  to_status    text not null check (to_status in ('scheduled', 'missed', 'fitted', 'cancelled')),
  appt_on      date,
  upload_id    bigint not null references vt_uploads (id),
  primary key (case_number, on_date, to_status)
);
create index if not exists vt_case_events_on_idx on vt_case_events (on_date);
create index if not exists vt_case_events_upload_idx on vt_case_events (upload_id);
comment on table vt_case_events is 'VT status changes only (FR-013) — never a daily snapshot.';

-- ------------------------------------------------------------------------------------------------- vt_upload_stage
create table if not exists vt_upload_stage (
  upload_id  bigint not null references vt_uploads (id) on delete cascade,
  kind       text not null check (kind in ('case', 'event')),
  ord        int not null check (ord >= 0),
  row        jsonb not null,
  staged_at  timestamptz not null default now(),
  primary key (upload_id, kind, ord)
);
comment on table vt_upload_stage is 'Transient rows of a VT upload being staged; deleted at commit/abandon, purged after a day by vt_trim().';

-- ------------------------------------------------------------------------------------------------- vt_book_rev
create table if not exists vt_book_rev (
  id               smallint primary key check (id = 1),
  rev              bigint not null default 0,
  opened_on        date,                                 -- first daily extract committed (go-live)
  opening_book_on  date,                                 -- when the optional opening book was loaded
  updated_at       timestamptz not null default now()
);
insert into vt_book_rev (id, rev) values (1, 0) on conflict (id) do nothing;
comment on table vt_book_rev is 'The VT book revision: the compare-and-set base of every commit (single row).';

-- ------------------------------------------------------------------------------------------------- lock down
alter table vt_uploads enable row level security;
alter table vt_cases enable row level security;
alter table vt_case_events enable row level security;
alter table vt_upload_stage enable row level security;
alter table vt_book_rev enable row level security;
revoke all on table vt_uploads, vt_cases, vt_case_events, vt_upload_stage, vt_book_rev from public, anon, authenticated;
revoke all on sequence vt_uploads_id_seq from public, anon, authenticated;
grant select, insert, update, delete on table vt_uploads, vt_cases, vt_case_events, vt_upload_stage, vt_book_rev to service_role;
grant usage, select on sequence vt_uploads_id_seq to service_role;

-- ------------------------------------------------------------------------------------------------- vt_upload_begin
create or replace function vt_upload_begin(p_sha256 text, p_kind text, p_file_name text, p_extract_on date, p_cycle_key text, p_user text default null)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare u vt_uploads%rowtype; v_id bigint;
begin
  select * into u from vt_uploads where sha256 = p_sha256 for update;
  if found and u.state = 'committed' then
    return jsonb_build_object('duplicate', true, 'id', u.id, 'committed_at', u.committed_at, 'file_name', u.file_name);
  end if;
  if found then   -- a retry of the same bytes (an earlier attempt staged or gave up): start it again on the same row
    delete from vt_upload_stage where upload_id = u.id;
    update vt_uploads set state = 'staging', kind = p_kind, file_name = p_file_name, extract_on = p_extract_on, cycle_key = p_cycle_key,
           uploaded_by = p_user, started_at = now(), counts = null, unmatched = null, warnings = null, result = null
     where id = u.id;
    return jsonb_build_object('id', u.id, 'reused', true);
  end if;
  begin
    insert into vt_uploads (sha256, kind, file_name, extract_on, cycle_key, uploaded_by)
    values (p_sha256, p_kind, p_file_name, p_extract_on, p_cycle_key, p_user) returning id into v_id;
  exception when unique_violation then   -- two stations began the same bytes at once: the other one owns it
    select * into u from vt_uploads where sha256 = p_sha256;
    return jsonb_build_object('duplicate', u.state = 'committed', 'busy', u.state <> 'committed', 'id', u.id);
  end;
  return jsonb_build_object('id', v_id);
end $$;
revoke execute on function vt_upload_begin(text, text, text, date, text, text) from public, anon, authenticated;
grant execute on function vt_upload_begin(text, text, text, date, text, text) to service_role;

-- ------------------------------------------------------------------------------------------------- vt_upload_stage
create or replace function vt_upload_stage(p_id bigint, p_kind text, p_from_ord int, p_rows jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare n int;
begin
  perform 1 from vt_uploads where id = p_id and state = 'staging';
  if not found then raise exception 'not_staging: upload % is not being staged', p_id; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'rows_not_array'; end if;
  if jsonb_array_length(p_rows) > 1000 then raise exception 'batch_too_large: % rows (at most 1000)', jsonb_array_length(p_rows); end if;
  insert into vt_upload_stage (upload_id, kind, ord, row)
  select p_id, p_kind, p_from_ord + (t.o - 1)::int, t.r from jsonb_array_elements(p_rows) with ordinality as t(r, o)
  on conflict (upload_id, kind, ord) do nothing;
  get diagnostics n = row_count;
  return jsonb_build_object('staged', n, 'total', (select count(*) from vt_upload_stage where upload_id = p_id and kind = p_kind));
end $$;
revoke execute on function vt_upload_stage(bigint, text, int, jsonb) from public, anon, authenticated;
grant execute on function vt_upload_stage(bigint, text, int, jsonb) to service_role;

-- ------------------------------------------------------------------------------------------------- vt_upload_commit
create or replace function vt_upload_commit(p_id bigint, p_base_rev bigint, p_counts jsonb, p_unmatched jsonb, p_warnings jsonb,
                                            p_quiet_ack boolean, p_cases int, p_events int)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare u vt_uploads%rowtype; r vt_book_rev%rowtype; nc int; ne int; v_rev bigint; res jsonb;
begin
  select * into u from vt_uploads where id = p_id for update;
  if not found then raise exception 'unknown_upload: %', p_id; end if;
  if u.state = 'committed' then return u.result || jsonb_build_object('already', true); end if;   -- idempotent re-commit
  if u.state <> 'staging' then raise exception 'not_staging: upload % is %', p_id, u.state; end if;
  select * into r from vt_book_rev where id = 1 for update;                                         -- the CAS lock
  if r.rev <> p_base_rev then raise exception 'version_conflict: the book is at rev %, this upload was merged on rev %', r.rev, p_base_rev; end if;
  if u.kind = 'opening_book' and r.opened_on is null then
    raise exception 'opening_book_before_first_day: load the opening book after the first day''s two files';
  end if;
  select count(*) filter (where kind = 'case'), count(*) filter (where kind = 'event') into nc, ne from vt_upload_stage where upload_id = p_id;
  if nc <> coalesce(p_cases, -1) or ne <> coalesce(p_events, -1) then
    raise exception 'stage_incomplete: staged % cases / % events, the commit expects % / %', nc, ne, p_cases, p_events;
  end if;
  v_rev := r.rev + 1;
  insert into vt_cases (case_number, status, status_on, sold_on, sold_basis, first_seen, last_seen, appt_on, fitted_on, sm_attempt, products,
                        bundle, charge_ex, partner_raw, lead_source, seller_name, seller_cb, seller_match, last_upload, rev, updated_at)
  select x.case_number, x.status, x.status_on, x.sold_on, x.sold_basis, x.first_seen, x.last_seen, x.appt_on, x.fitted_on, x.sm_attempt,
         coalesce(x.products, '{}'), x.bundle, x.charge_ex, x.partner_raw, x.lead_source, x.seller_name, x.seller_cb, x.seller_match, p_id, v_rev, now()
    from vt_upload_stage s,
         jsonb_to_record(s.row) as x(case_number bigint, status text, status_on date, sold_on date, sold_basis text, first_seen date, last_seen date,
                                     appt_on date, fitted_on date, sm_attempt text, products text[], bundle text, charge_ex numeric, partner_raw text,
                                     lead_source text, seller_name text, seller_cb text, seller_match text)
   where s.upload_id = p_id and s.kind = 'case'
  on conflict (case_number) do update set
    status = excluded.status, status_on = excluded.status_on, sold_on = excluded.sold_on, sold_basis = excluded.sold_basis,
    first_seen = excluded.first_seen, last_seen = excluded.last_seen, appt_on = excluded.appt_on, fitted_on = excluded.fitted_on,
    sm_attempt = excluded.sm_attempt, products = excluded.products, bundle = excluded.bundle, charge_ex = excluded.charge_ex,
    partner_raw = excluded.partner_raw, lead_source = excluded.lead_source, seller_name = excluded.seller_name, seller_cb = excluded.seller_cb,
    seller_match = excluded.seller_match, last_upload = excluded.last_upload, rev = excluded.rev, updated_at = excluded.updated_at;
  insert into vt_case_events (case_number, on_date, from_status, to_status, appt_on, upload_id)
  select x.case_number, x.on_date, x.from_status, x.to_status, x.appt_on, p_id
    from vt_upload_stage s,
         jsonb_to_record(s.row) as x(case_number bigint, on_date date, from_status text, to_status text, appt_on date)
   where s.upload_id = p_id and s.kind = 'event'
  on conflict (case_number, on_date, to_status) do nothing;
  update vt_book_rev set rev = v_rev,
         opened_on = coalesce(opened_on, case when u.kind <> 'opening_book' then u.extract_on end),
         opening_book_on = coalesce(opening_book_on, case when u.kind = 'opening_book' then u.extract_on end),
         updated_at = now()
   where id = 1;
  res := jsonb_build_object('rev', v_rev, 'cases', nc, 'events', ne, 'upload', p_id);
  update vt_uploads set state = 'committed', committed_at = now(), counts = p_counts, unmatched = coalesce(p_unmatched, '[]'::jsonb),
         warnings = coalesce(p_warnings, '[]'::jsonb), quiet_day_ack = coalesce(p_quiet_ack, false), rev_after = v_rev, result = res
   where id = p_id;
  delete from vt_upload_stage where upload_id = p_id;
  return res;
end $$;
revoke execute on function vt_upload_commit(bigint, bigint, jsonb, jsonb, jsonb, boolean, int, int) from public, anon, authenticated;
grant execute on function vt_upload_commit(bigint, bigint, jsonb, jsonb, jsonb, boolean, int, int) to service_role;

-- ------------------------------------------------------------------------------------------------- vt_upload_abandon
create or replace function vt_upload_abandon(p_id bigint)
returns jsonb language plpgsql security invoker set search_path = public as $$
begin
  update vt_uploads set state = 'abandoned' where id = p_id and state = 'staging';
  delete from vt_upload_stage where upload_id = p_id;
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function vt_upload_abandon(bigint) from public, anon, authenticated;
grant execute on function vt_upload_abandon(bigint) to service_role;

-- ------------------------------------------------------------------------------------------------- vt_book
-- One value, positional arrays (VTEngine.bookFromRpc's BOOK_COLS / EVENT_COLS order), built as json (text) rather than jsonb:
-- the Worker streams it untouched and the browser parses it, so the binary form would only cost time (~2x at 20k cases). Cases last seen on or after
-- p_from, every open case, and every case named in p_also (the station names the cases its file carries, so the merge
-- always sees their previous row). p_from null = the whole book. Every event of a returned case comes with it.
create or replace function vt_book(p_from date default null, p_also bigint[] default null)
returns json language sql stable security invoker set search_path = public as $$
  with c as (
    select * from vt_cases
     where p_from is null or last_seen >= p_from or status in ('scheduled', 'missed') or case_number = any (coalesce(p_also, '{}'::bigint[]))
  )
  select json_build_object(
    'rev', r.rev, 'openedOn', r.opened_on, 'openingBookOn', r.opening_book_on,
    'cases', coalesce((select json_agg(json_build_array(c.case_number::text, c.status, c.status_on, c.sold_on, c.sold_basis, c.first_seen, c.last_seen,
                                                          c.appt_on, c.fitted_on, to_json(c.products), c.charge_ex, c.lead_source, c.seller_name, c.seller_cb,
                                                          c.seller_match, c.sm_attempt, c.bundle, c.partner_raw) order by c.case_number) from c), '[]'::json),
    'events', coalesce((select json_agg(json_build_array(e.case_number::text, e.on_date, e.from_status, e.to_status, e.appt_on)
                                         order by e.case_number, e.on_date, e.to_status)
                          from vt_case_events e join c on c.case_number = e.case_number), '[]'::json))
  from vt_book_rev r where r.id = 1
$$;
revoke execute on function vt_book(date, bigint[]) from public, anon, authenticated;
grant execute on function vt_book(date, bigint[]) to service_role;

-- ------------------------------------------------------------------------------------------------- vt_trim
-- Keeps p_keep_cycles business months (the current one included). p_start_day MUST equal VT_RULES.periods.periodStartDay
-- (verify-vt-db.mjs checks it). Cases last seen before the cutoff go with their events; older events and abandoned uploads
-- go; a staging upload untouched for a day is abandoned and every stage row older than a day is purged. Weekly, from the
-- health cron's Sunday slot (task F3).
create or replace function vt_trim(p_keep_cycles int default 13, p_today date default (now() at time zone 'Africa/Johannesburg')::date, p_start_day int default 26)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare v_start date; v_cut date; n_cases int; n_events int; n_uploads int; n_stage int; n_stuck int;
begin
  v_start := make_date(extract(year from p_today)::int, extract(month from p_today)::int, p_start_day);
  if extract(day from p_today) < p_start_day then v_start := (v_start - interval '1 month')::date; end if;
  v_cut := (v_start - make_interval(months => greatest(p_keep_cycles, 1) - 1))::date;
  delete from vt_cases where last_seen < v_cut; get diagnostics n_cases = row_count;
  delete from vt_case_events where on_date < v_cut; get diagnostics n_events = row_count;
  update vt_uploads set state = 'abandoned' where state = 'staging' and started_at < now() - interval '1 day'; get diagnostics n_stuck = row_count;
  delete from vt_upload_stage s using vt_uploads u where u.id = s.upload_id and (u.state <> 'staging' or s.staged_at < now() - interval '1 day');
  get diagnostics n_stage = row_count;
  delete from vt_uploads u where u.state = 'abandoned' and u.started_at < v_cut
     and not exists (select 1 from vt_cases c where c.last_upload = u.id) and not exists (select 1 from vt_case_events e where e.upload_id = u.id);
  get diagnostics n_uploads = row_count;
  return jsonb_build_object('cutoff', v_cut, 'cases', n_cases, 'events', n_events, 'uploads', n_uploads, 'stage', n_stage, 'stuck', n_stuck);
end $$;
revoke execute on function vt_trim(int, date, int) from public, anon, authenticated;
grant execute on function vt_trim(int, date, int) to service_role;

-- ------------------------------------------------------------------------------------------------- vt_db_size
create or replace function vt_db_size()
returns jsonb language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'vt_cases',        jsonb_build_object('rows', (select count(*) from vt_cases),        'bytes', pg_total_relation_size('vt_cases')),
    'vt_case_events',  jsonb_build_object('rows', (select count(*) from vt_case_events),  'bytes', pg_total_relation_size('vt_case_events')),
    'vt_uploads',      jsonb_build_object('rows', (select count(*) from vt_uploads),      'bytes', pg_total_relation_size('vt_uploads')),
    'vt_upload_stage', jsonb_build_object('rows', (select count(*) from vt_upload_stage), 'bytes', pg_total_relation_size('vt_upload_stage')),
    'vt_book_rev',     jsonb_build_object('rows', (select count(*) from vt_book_rev),     'bytes', pg_total_relation_size('vt_book_rev')))
$$;
revoke execute on function vt_db_size() from public, anon, authenticated;
grant execute on function vt_db_size() to service_role;
