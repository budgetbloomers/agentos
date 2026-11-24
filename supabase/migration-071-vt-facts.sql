-- migration-071-vt-facts.sql — THE VEHICLE TRACKING CASE BOOK (Spec Kit 071, plan §DB, 2026-11-23; review fixes same day)
--
-- WHY. Vehicle Tracking (VT) gets its own facts, apart from everything VAS: the daily BI Active Fitted and Scheduled &
-- Missed exports are merged per Case Number into ONE current row per sale plus one event per real status change. The
-- book is small, keyed and updated by case every day, so it is a table — not a KV blob (rewritten whole per upload, no
-- trim point, a race) and NEVER a daily snapshot (the open-cases lesson: a ~490k-row book stored per day became 14.1M
-- rows / 4.66 GB). The raw files are not stored either (they carry customer PII): the browser parses them, drops every
-- customer field (plan DB-4) and sends only changed case rows and events; the files' hashes and receipts are kept.
--
-- CANCELLED (owner-approved fix, 2026-11-23). No file carries a cancellation, so the engine DERIVES it: a Scheduled /
-- Missed case in neither file of a COMPLETE extract day (both a BI Active Fitted and a Scheduled & Missed of that date
-- committed) becomes cancelled with cancel_reason 'dropped'; a BI row with a deactivate date is 'deactivated'. The rule is
-- decided in VTEngine.merge; vt_upload_commit only REFUSES a 'dropped' event this upload cannot prove (bad_cancel, below),
-- under the same revision lock, so a single file can never cancel anything whatever a station sends.
--
-- NO MERGE LOGIC LIVES HERE. The status precedence, sale day, seller and lead source are decided ONCE, in
-- nicks_code/vt-engine.js (VTEngine.merge, oracle-tested). These functions apply the rows the engine computed and
-- enforce only keys, checks, bounds, ownership, idempotency and the book revision (compare-and-set). The two book-level
-- facts below are bookkeeping, derived from the upload rows themselves: opened_on (the first daily extract ever
-- committed = go-live; the rating's working days start the day after it) and opening_book_on (when the optional
-- opening book was loaded).
--
--   vt_upload_begin(sha, kind, file, extract_on, cycle_key, user)  claims the file; a committed hash → duplicate; a LIVE
--                                                                  staging one → {busy}; ≤ 4 uploads staging at once
--   vt_upload_stage(id, kind, from_ord, rows, user)                ≤ 1,000 rows per call, ≤ 60,000 rows per kind per
--                                                                  upload; a retried batch is a no-op; owner only
--   vt_upload_commit(id, base_rev, counts, unmatched, warnings, quiet_ack, n_cases, n_events, user)
--                                                                  ONE transaction: lock the revision, refuse a stale
--                                                                  base (version_conflict → the Worker answers 409), a
--                                                                  short stage, a duplicate case, an out-of-range date;
--                                                                  upsert cases, upsert events, rev + 1; owner only
--   vt_upload_abandon(id, user)                                    a station that gave up; owner only
--   vt_book(p_from, p_also)                                        the book as ONE json value (not paged — see its note)
--   vt_trim(keep_cycles, today, start_day)                         13 business months kept; weekly (health cron, F3)
--   vt_db_size()                                                   rows + bytes per table (tools/vt-db-size.mjs, db_health)
--
-- WHO. p_user is the uploader's username. The Worker (worker/src/vt.mjs) injects it from the SESSION on every one of
-- the four intake calls, after anything the client sent (Postgres reads the LAST of two equal keys), so an upload
-- belongs to the account that began it: no other account may stage into it, commit it or abandon it (review S-M3).
--
-- SIZE (plan DB-5, from the sample files): ~3,000 new cases and ~7,500 events per business month, ~2 MB/month;
-- steady state after the 13-cycle trim ~39k cases + ~98k events ≈ 27 MB. A daily upload re-sees every case in the file
-- (last_seen moves), so vt_cases carries NO secondary index and is filled to 70%: the daily rewrite is a HOT update that
-- writes no index entry (review D-H1). Measured in PGlite: see verify-vt-db.mjs R8.
-- No partitioning (revisit above 5M event rows), no dedupe_lake() extension (unique keys make twins impossible).
--
-- THE CLOCK. "Today" is SAST (Africa/Johannesburg). The setting vt.today, when set, stands in for it: the PGlite suite
-- pins it so its fixed fixture dates stay inside the window. PostgREST cannot set it (only SQL can), so it is no lever
-- for a client.
--
-- SECURITY (plan DB-6): RLS on every table with NO policy, every privilege revoked from public/anon/authenticated,
-- EXECUTE revoked on every function AFTER its definition (create or replace re-grants it — migration-049's lesson),
-- service_role (the Worker) granted explicitly. Functions are SECURITY INVOKER: they run with the caller's rights.
--
-- Apply: node tools/apply-migration.mjs supabase/migration-071-vt-facts.sql   (the OWNER, at deploy — before 072;
-- precautions and rollback in specs/071-vehicle-tracking-analytics/deploy-checklist.md)
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
  uploaded_by    text check (uploaded_by is null or length(uploaded_by) between 1 and 120),
  started_at     timestamptz not null default now(),
  committed_at   timestamptz,
  rev_after      bigint,
  result         jsonb                                   -- the commit's answer, returned again on a re-commit
);
create index if not exists vt_uploads_kind_extract_idx on vt_uploads (kind, extract_on desc) where state = 'committed';
comment on table vt_uploads is 'VT upload receipts and manifest (spec 071). One row per file hash; the raw file is never stored.';

-- ------------------------------------------------------------------------------------------------- vt_cases
-- No secondary index, on purpose (review D-H1): no RPC filters vt_cases by anything but its key (vt_book reads the
-- whole ~39k-row table and keeps a few; the trim is weekly), and an index on last_seen / last_upload — the columns every
-- daily upload rewrites — would turn every one of those updates into a non-HOT update touching every index.
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
  sm_attempt    text check (sm_attempt is null or length(sm_attempt) <= 60),
  products      text[] not null default '{}' check (cardinality(products) <= 32 and length(array_to_string(products, '')) <= 640),
  bundle        text check (bundle is null or length(bundle) <= 200),
  charge_ex     numeric(10,2),
  partner_raw   text check (partner_raw is null or length(partner_raw) <= 200),
  lead_source   text check (lead_source is null or lead_source ~ '^[a-z_]{1,40}$'),
  seller_name   text check (seller_name is null or length(seller_name) <= 120),   -- normalised Salesforce display name of the SELLER (staff)
  seller_cb     text check (seller_cb is null or seller_cb ~ '^CB[0-9]+$'),
  seller_match  text check (seller_match is null or seller_match in ('exact', 'alias', 'near', 'first_last', 'unmatched')),
  cancel_reason text check (cancel_reason is null or cancel_reason in ('dropped', 'deactivated')),   -- why a case is cancelled (2026-11-23 fix)
  last_upload   bigint not null references vt_uploads (id),
  rev           bigint not null,
  updated_at    timestamptz not null default now(),
  check (last_seen >= first_seen),
  check ((status = 'cancelled') = (cancel_reason is not null))   -- a cancelled case always says why; no other status carries a reason
) with (fillfactor = 70);
comment on table vt_cases is 'VT case book (spec 071): the CURRENT state of each sale. No customer field. Team leader and sub-campaign are NOT stored — they come from the Agent List in force each business month.';

-- ------------------------------------------------------------------------------------------------- vt_case_events
-- Insert-mostly: its indexes do not churn. on_date serves no RPC today but is kept for the history reads of Phase D/E;
-- upload_id serves the foreign-key check when vt_trim removes an old receipt.
create table if not exists vt_case_events (
  case_number  bigint not null references vt_cases (case_number) on delete cascade,
  on_date      date not null,
  from_status  text check (from_status is null or from_status in ('scheduled', 'missed', 'fitted', 'cancelled')),
  to_status    text not null check (to_status in ('scheduled', 'missed', 'fitted', 'cancelled')),
  appt_on      date,
  upload_id    bigint not null references vt_uploads (id),
  reason       text check (reason is null or reason in ('dropped', 'deactivated')),   -- last: why a cancelled event happened (2026-11-23 fix)
  primary key (case_number, on_date, to_status),
  check ((to_status = 'cancelled') = (reason is not null))
);
create index if not exists vt_case_events_on_idx on vt_case_events (on_date);
create index if not exists vt_case_events_upload_idx on vt_case_events (upload_id);
comment on table vt_case_events is 'VT status changes only (FR-013) — never a daily snapshot. An event goes only with its case (vt_trim), so a kept case keeps its whole history.';

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
-- Bounds (review S-M2, S-M4, S-L3): an uploader is required; the file name is 1–300 characters; the extract day lies
-- between today − 400 days and today + 1 (SAST); cycle_key is the extract's business month under the 26th–25th rule
-- (26 = VT_RULES.periods.periodStartDay, the same constant vt_trim defaults to — verify-vt-db checks both); at most FOUR
-- uploads may be staging at once (the floor has one Upload Station and two files a day; a staging upload untouched for
-- an hour is reclaimed first, so a crashed tab never locks the floor out). The cap is checked without a lock, so two
-- begins at the same instant may make it five — it bounds abuse, it is not an invariant.
-- The same bytes again (review D-H2): committed → duplicate; staging and LIVE (begun < 15 minutes ago) or begun by
-- another account → {busy:true, id} and nothing is touched; staging and stale, by the same account → started again;
-- abandoned → started again by whoever asks (it becomes theirs: an abandoned file must not be stuck for 13 months).
create or replace function vt_upload_begin(p_sha256 text, p_kind text, p_file_name text, p_extract_on date, p_cycle_key text, p_user text)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare u vt_uploads%rowtype; v_id bigint; v_n int;
        v_today date := coalesce(nullif(current_setting('vt.today', true), '')::date, (now() at time zone 'Africa/Johannesburg')::date);
begin
  if p_user is null or btrim(p_user) = '' or length(p_user) > 120 then raise exception 'bad_user: an upload needs the signed-in uploader'; end if;
  select * into u from vt_uploads where sha256 = p_sha256 for update;
  if found and u.state = 'committed' then
    return jsonb_build_object('duplicate', true, 'id', u.id, 'committed_at', u.committed_at, 'file_name', u.file_name);
  end if;
  if p_file_name is null or length(p_file_name) not between 1 and 300 then
    raise exception 'bad_file_name: the file name must be 1 to 300 characters (it is %)', coalesce(length(p_file_name), 0);
  end if;
  if p_extract_on is null or p_extract_on > v_today + 1 or p_extract_on < v_today - 400 then
    raise exception 'bad_extract_on: the extract date % is outside % to %', p_extract_on, v_today - 400, v_today + 1;
  end if;
  if p_cycle_key is distinct from to_char(case when extract(day from p_extract_on) >= 26 then p_extract_on + interval '1 month' else p_extract_on end, '"cycle-"YYYY-MM') then
    raise exception 'bad_cycle_key: % does not hold the extract date %', p_cycle_key, p_extract_on;
  end if;
  if found and u.state = 'staging' and (u.uploaded_by is distinct from p_user or u.started_at > now() - interval '15 minutes') then
    return jsonb_build_object('busy', true, 'id', u.id, 'since', u.started_at);
  end if;
  with r as (update vt_uploads set state = 'abandoned'
              where id in (select id from vt_uploads where state = 'staging' and started_at < now() - interval '1 hour' for update skip locked)
             returning id)
  delete from vt_upload_stage s using r where s.upload_id = r.id;
  select count(*) into v_n from vt_uploads where state = 'staging' and id is distinct from u.id;
  if v_n >= 4 then raise exception 'too_many_uploads: % uploads are being staged already; finish or abandon one first', v_n; end if;
  if u.id is not null then   -- a stale retry by its own account, or an abandoned file: start it again on the same row
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
-- 60,000 rows per kind per upload (review S-M2): the sample opening book has ~2,024 cases and the steady-state book
-- ~39k after the 13-cycle trim, so the largest legitimate file — a daily BI that re-sees every case — fits with 50%
-- headroom, while a runaway or hostile station cannot fill the database. Counted AFTER the insert (the insert rolls
-- back), so a retried batch near the cap is never refused for rows it already staged. Stage after commit/abandon is
-- refused by the state check.
create or replace function vt_upload_stage(p_id bigint, p_kind text, p_from_ord int, p_rows jsonb, p_user text)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare n int; v_total int; v_state text; v_by text;
begin
  select state, uploaded_by into v_state, v_by from vt_uploads where id = p_id;
  if not found or v_state <> 'staging' then raise exception 'not_staging: upload % is not being staged', p_id; end if;
  if v_by is distinct from p_user then raise exception 'not_owner: upload % was begun by another account', p_id; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'rows_not_array'; end if;
  if jsonb_array_length(p_rows) > 1000 then raise exception 'batch_too_large: % rows (at most 1000)', jsonb_array_length(p_rows); end if;
  insert into vt_upload_stage (upload_id, kind, ord, row)
  select p_id, p_kind, p_from_ord + (t.o - 1)::int, t.r from jsonb_array_elements(p_rows) with ordinality as t(r, o)
  on conflict (upload_id, kind, ord) do nothing;
  get diagnostics n = row_count;
  select count(*) into v_total from vt_upload_stage where upload_id = p_id and kind = p_kind;
  if v_total > 60000 then raise exception 'upload_too_large: % % rows staged (at most 60000 per upload)', v_total, p_kind; end if;
  return jsonb_build_object('staged', n, 'total', v_total);
end $$;
revoke execute on function vt_upload_stage(bigint, text, int, jsonb, text) from public, anon, authenticated;
grant execute on function vt_upload_stage(bigint, text, int, jsonb, text) to service_role;

-- ------------------------------------------------------------------------------------------------- vt_upload_commit
-- Refusals before any write: not_owner, not_staging, bad_cancel (a 'dropped' cancellation this upload cannot prove), bad_receipt (counts an object ≤ 4 KB; unmatched an array of ≤ 2,000
-- names, ≤ 48 KB; warnings an array of ≤ 200, ≤ 16 KB — review S-M2), version_conflict, commit_too_large (> 60,000 rows
-- of a kind: the per-commit cap, review D-H3), stage_incomplete, duplicate_case / duplicate_event (named, not
-- Postgres's "cannot affect row a second time"), bad_date (review S-M4: first_seen / last_seen / status_on and an
-- event's day never after today + 1; sold_on / appt_on / fitted_on never more than 400 days ahead; nothing before 2000).
-- A same-day event already in the book whose from_status or appt_on differ is UPDATED to this upload's (the newer file
-- on the same day knows better), never silently dropped (review D-LOW).
-- One commit carries the whole upload: R8 in verify-vt-db times a 20k-case + 20k-event first load in one call, so no
-- multi-part commit is needed below the 60,000 cap (deploy-checklist: check service_role's statement_timeout first).
create or replace function vt_upload_commit(p_id bigint, p_base_rev bigint, p_counts jsonb, p_unmatched jsonb, p_warnings jsonb,
                                            p_quiet_ack boolean, p_cases int, p_events int, p_user text)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare u vt_uploads%rowtype; r vt_book_rev%rowtype; nc int; ne int; v_rev bigint; res jsonb; v_bad text;
        v_today date := coalesce(nullif(current_setting('vt.today', true), '')::date, (now() at time zone 'Africa/Johannesburg')::date);
begin
  select * into u from vt_uploads where id = p_id for update;
  if not found then raise exception 'unknown_upload: %', p_id; end if;
  if u.uploaded_by is distinct from p_user then raise exception 'not_owner: upload % was begun by another account', p_id; end if;
  if u.state = 'committed' then return u.result || jsonb_build_object('already', true); end if;   -- idempotent re-commit
  if u.state <> 'staging' then raise exception 'not_staging: upload % is %', p_id, u.state; end if;
  if (p_counts is not null and (jsonb_typeof(p_counts) <> 'object' or octet_length(p_counts::text) > 4096))
     or (p_unmatched is not null and (jsonb_typeof(p_unmatched) <> 'array' or jsonb_array_length(p_unmatched) > 2000 or octet_length(p_unmatched::text) > 49152))
     or (p_warnings is not null and (jsonb_typeof(p_warnings) <> 'array' or jsonb_array_length(p_warnings) > 200 or octet_length(p_warnings::text) > 16384)) then
    raise exception 'bad_receipt: counts must be an object (<= 4 KB), unmatched an array (<= 2000, <= 48 KB), warnings an array (<= 200, <= 16 KB)';
  end if;
  select * into r from vt_book_rev where id = 1 for update;                                         -- the CAS lock
  if r.rev <> p_base_rev then raise exception 'version_conflict: the book is at rev %, this upload was merged on rev %', r.rev, p_base_rev; end if;
  if u.kind = 'opening_book' and r.opened_on is null then
    raise exception 'opening_book_before_first_day: load the opening book after the first day''s two files';
  end if;
  select count(*) filter (where kind = 'case'), count(*) filter (where kind = 'event') into nc, ne from vt_upload_stage where upload_id = p_id;
  if nc > 60000 or ne > 60000 then raise exception 'commit_too_large: % cases / % events (at most 60000 of each per commit)', nc, ne; end if;
  if nc <> coalesce(p_cases, -1) or ne <> coalesce(p_events, -1) then
    raise exception 'stage_incomplete: staged % cases / % events, the commit expects % / %', nc, ne, p_cases, p_events;
  end if;
  select (s.row->>'case_number')::bigint::text into v_bad from vt_upload_stage s where s.upload_id = p_id and s.kind = 'case'
   group by (s.row->>'case_number')::bigint having count(*) > 1 limit 1;
  if v_bad is not null then raise exception 'duplicate_case: case % appears more than once in this upload', v_bad; end if;
  select (s.row->>'case_number')::bigint::text into v_bad from vt_upload_stage s where s.upload_id = p_id and s.kind = 'event'
   group by (s.row->>'case_number')::bigint, (s.row->>'on_date')::date, s.row->>'to_status' having count(*) > 1 limit 1;
  if v_bad is not null then raise exception 'duplicate_event: case % has the same status change twice in this upload', v_bad; end if;
  select x.case_number::text into v_bad
    from vt_upload_stage s, jsonb_to_record(s.row) as x(case_number bigint, first_seen date, last_seen date, status_on date, sold_on date, appt_on date, fitted_on date)
   where s.upload_id = p_id and s.kind = 'case'
     and (greatest(x.first_seen, x.last_seen, x.status_on) > v_today + 1 or greatest(x.sold_on, x.appt_on, x.fitted_on) > v_today + 400
          or least(x.first_seen, x.last_seen, x.status_on, x.sold_on, x.appt_on, x.fitted_on) < date '2000-01-01')
   limit 1;
  if v_bad is null then
    select x.case_number::text into v_bad
      from vt_upload_stage s, jsonb_to_record(s.row) as x(case_number bigint, on_date date, appt_on date)
     where s.upload_id = p_id and s.kind = 'event'
       and (x.on_date > v_today + 1 or x.appt_on > v_today + 400 or least(x.on_date, x.appt_on) < date '2000-01-01')
     limit 1;
  end if;
  if v_bad is not null then raise exception 'bad_date: case % carries a date outside 2000-01-01 .. % (today + 1; + 400 for sale, appointment, fitment)', v_bad, v_today + 1; end if;
  -- A 'dropped' cancellation (2026-11-23 fix) is only ever written by the daily file that COMPLETES its extract day: dated
  -- that day, the other daily kind of the same date already committed, and no later day complete. Checked under the
  -- revision lock taken above, so two stations committing the day's two files are serialised and the second one decides.
  select x.case_number::text into v_bad
    from vt_upload_stage s, jsonb_to_record(s.row) as x(case_number bigint, to_status text, reason text, on_date date)
   where s.upload_id = p_id and s.kind = 'event' and x.to_status = 'cancelled' and x.reason = 'dropped'
     and (u.kind not in ('bi_fitted', 'sched_missed') or x.on_date is distinct from u.extract_on
          or not exists (select 1 from vt_uploads o where o.state = 'committed' and o.extract_on = u.extract_on
                          and o.kind = case u.kind when 'bi_fitted' then 'sched_missed' else 'bi_fitted' end)
          or exists (select 1 from vt_uploads a join vt_uploads b on b.extract_on = a.extract_on and b.kind = 'sched_missed' and b.state = 'committed'
                      where a.kind = 'bi_fitted' and a.state = 'committed' and a.extract_on > u.extract_on))
   limit 1;
  if v_bad is not null then raise exception 'bad_cancel: case % is marked dropped, but this upload does not complete the newest extract day (both files of %)', v_bad, u.extract_on; end if;
  v_rev := r.rev + 1;
  insert into vt_cases (case_number, status, status_on, sold_on, sold_basis, first_seen, last_seen, appt_on, fitted_on, sm_attempt, products,
                        bundle, charge_ex, partner_raw, lead_source, seller_name, seller_cb, seller_match, cancel_reason, last_upload, rev, updated_at)
  select x.case_number, x.status, x.status_on, x.sold_on, x.sold_basis, x.first_seen, x.last_seen, x.appt_on, x.fitted_on, x.sm_attempt,
         coalesce(x.products, '{}'), x.bundle, x.charge_ex, x.partner_raw, x.lead_source, x.seller_name, x.seller_cb, x.seller_match, x.cancel_reason, p_id, v_rev, now()
    from vt_upload_stage s,
         jsonb_to_record(s.row) as x(case_number bigint, status text, status_on date, sold_on date, sold_basis text, first_seen date, last_seen date,
                                     appt_on date, fitted_on date, sm_attempt text, products text[], bundle text, charge_ex numeric, partner_raw text,
                                     lead_source text, seller_name text, seller_cb text, seller_match text, cancel_reason text)
   where s.upload_id = p_id and s.kind = 'case'
  on conflict (case_number) do update set
    status = excluded.status, status_on = excluded.status_on, sold_on = excluded.sold_on, sold_basis = excluded.sold_basis,
    first_seen = excluded.first_seen, last_seen = excluded.last_seen, appt_on = excluded.appt_on, fitted_on = excluded.fitted_on,
    sm_attempt = excluded.sm_attempt, products = excluded.products, bundle = excluded.bundle, charge_ex = excluded.charge_ex,
    partner_raw = excluded.partner_raw, lead_source = excluded.lead_source, seller_name = excluded.seller_name, seller_cb = excluded.seller_cb,
    seller_match = excluded.seller_match, cancel_reason = excluded.cancel_reason, last_upload = excluded.last_upload, rev = excluded.rev, updated_at = excluded.updated_at;
  insert into vt_case_events (case_number, on_date, from_status, to_status, appt_on, reason, upload_id)
  select x.case_number, x.on_date, x.from_status, x.to_status, x.appt_on, x.reason, p_id
    from vt_upload_stage s,
         jsonb_to_record(s.row) as x(case_number bigint, on_date date, from_status text, to_status text, appt_on date, reason text)
   where s.upload_id = p_id and s.kind = 'event'
  on conflict (case_number, on_date, to_status) do update set
    from_status = excluded.from_status, appt_on = excluded.appt_on, reason = excluded.reason, upload_id = excluded.upload_id
   where (vt_case_events.from_status, vt_case_events.appt_on, vt_case_events.reason) is distinct from (excluded.from_status, excluded.appt_on, excluded.reason);
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
revoke execute on function vt_upload_commit(bigint, bigint, jsonb, jsonb, jsonb, boolean, int, int, text) from public, anon, authenticated;
grant execute on function vt_upload_commit(bigint, bigint, jsonb, jsonb, jsonb, boolean, int, int, text) to service_role;

-- ------------------------------------------------------------------------------------------------- vt_upload_abandon
-- Owner only. A finished (committed / abandoned) upload answers {ok:false, state} and is not touched.
create or replace function vt_upload_abandon(p_id bigint, p_user text)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare v_state text; v_by text;
begin
  select state, uploaded_by into v_state, v_by from vt_uploads where id = p_id for update;
  if not found then return jsonb_build_object('ok', false, 'state', null); end if;
  if v_by is distinct from p_user then raise exception 'not_owner: upload % was begun by another account', p_id; end if;
  if v_state <> 'staging' then return jsonb_build_object('ok', false, 'state', v_state); end if;
  update vt_uploads set state = 'abandoned' where id = p_id;
  delete from vt_upload_stage where upload_id = p_id;
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function vt_upload_abandon(bigint, text) from public, anon, authenticated;
grant execute on function vt_upload_abandon(bigint, text) to service_role;

-- ------------------------------------------------------------------------------------------------- vt_book
-- One value, positional arrays (VTEngine.bookFromRpc's BOOK_COLS / EVENT_COLS order), built as json (text) rather than jsonb:
-- the Worker streams it untouched and the browser parses it, so the binary form would only cost time (~2x at 20k cases). Cases last seen on or after
-- p_from, every open case, and every case named in p_also (the station names the cases its file carries, so the merge
-- always sees their previous row). p_from null = the whole book. Every event of a returned case comes with it.
-- COST (review D-M10): p_from / p_also NARROW THE RESULT, NOT THE SCAN — vt_cases has no secondary index (D-H1), so every
-- call reads the whole table, which is linear and cheap at this size (D11: < 300 ms at 20k cases in PGlite). The whole
-- book is ~4 MB of JSON at 20k cases and ~8 MB at the ~39k steady state; Cloudflare's edge compresses the Worker's
-- application/json 200 answer for any browser that accepts gzip/brotli, so nothing is added for that. Revisit with
-- paging (by case_number ranges) above ~60k cases.
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
                                                          c.seller_match, c.sm_attempt, c.bundle, c.partner_raw, c.cancel_reason) order by c.case_number) from c), '[]'::json),
    'events', coalesce((select json_agg(json_build_array(e.case_number::text, e.on_date, e.from_status, e.to_status, e.appt_on, e.reason)
                                         order by e.case_number, e.on_date, e.to_status)
                          from vt_case_events e join c on c.case_number = e.case_number), '[]'::json))
  from vt_book_rev r where r.id = 1
$$;
revoke execute on function vt_book(date, bigint[]) from public, anon, authenticated;
grant execute on function vt_book(date, bigint[]) to service_role;

-- ------------------------------------------------------------------------------------------------- vt_trim
-- Keeps p_keep_cycles business months (the current one included). p_start_day MUST equal VT_RULES.periods.periodStartDay
-- (verify-vt-db.mjs checks it). Weekly, from the health cron's Sunday slot (task F3). Review fixes:
--   · it takes the revision row lock FIRST (D-M4), the same lock every commit takes, so a trim and a commit run one
--     after the other and can never deadlock; the stuck-upload sweep skips rows a live call holds (skip locked);
--   · a CLOSED case (fitted / cancelled — dropped or deactivated) last seen before the cutoff goes, with its events; a still-OPEN case
--     (scheduled / missed) is never deleted however old — it is counted in skipped_open (D-M5);
--   · events go ONLY with their case (D-M6): a kept case keeps its whole history (a few events per case), so no report
--     inside the window ever sees a case whose earlier status changes were cut away;
--   · abandoned AND committed receipts older than the cutoff go once no case or event references them (D-M7);
--   · a staging upload untouched for a day is abandoned and every stage row older than a day is purged.
create or replace function vt_trim(p_keep_cycles int default 13, p_today date default (now() at time zone 'Africa/Johannesburg')::date, p_start_day int default 26)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare v_start date; v_cut date; n_cases int; n_events int; n_open int; n_uploads int; n_stage int; n_stuck int;
begin
  perform 1 from vt_book_rev where id = 1 for update;
  v_start := make_date(extract(year from p_today)::int, extract(month from p_today)::int, p_start_day);
  if extract(day from p_today) < p_start_day then v_start := (v_start - interval '1 month')::date; end if;
  v_cut := (v_start - make_interval(months => greatest(p_keep_cycles, 1) - 1))::date;
  select count(*) into n_open from vt_cases where last_seen < v_cut and status in ('scheduled', 'missed');
  select count(*) into n_events from vt_case_events e join vt_cases c on c.case_number = e.case_number
   where c.last_seen < v_cut and c.status not in ('scheduled', 'missed');
  delete from vt_cases where last_seen < v_cut and status not in ('scheduled', 'missed'); get diagnostics n_cases = row_count;
  with r as (update vt_uploads set state = 'abandoned'
              where id in (select id from vt_uploads where state = 'staging' and started_at < now() - interval '1 day' for update skip locked)
             returning 1)
  select count(*) into n_stuck from r;
  delete from vt_upload_stage s using vt_uploads u where u.id = s.upload_id and (u.state <> 'staging' or s.staged_at < now() - interval '1 day');
  get diagnostics n_stage = row_count;
  delete from vt_uploads u
   where ((u.state = 'abandoned' and u.started_at < v_cut) or (u.state = 'committed' and coalesce(u.committed_at, u.started_at) < v_cut))
     and not exists (select 1 from vt_cases c where c.last_upload = u.id) and not exists (select 1 from vt_case_events e where e.upload_id = u.id);
  get diagnostics n_uploads = row_count;
  return jsonb_build_object('cutoff', v_cut, 'cases', n_cases, 'events', n_events, 'skipped_open', n_open, 'uploads', n_uploads, 'stage', n_stage, 'stuck', n_stuck);
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

-- PostgREST caches the schema: ask it to see the new functions now (harmless if nothing listens; first in this project)
notify pgrst, 'reload schema';
