-- migration-073-vt-schedulers.sql — THE SCHEDULERS DATA UPLOAD (Spec Kit 072, plan §DB, tasks B3; 2026-11-25)
--
-- WHY. The master VT report's "Schedulers Data" sheet becomes a proper upload with its own slot (owner decision D1),
-- superseding the 071 "Opening book (once)" slot, which read the SAME sheet for the sale date alone. It is the only
-- source of three facts no daily export carries: the SCHEDULER (col J), the GWP (col E) and the TRUE SALE DATE (col B).
-- It never decides a status: the daily exports and the engine's own rules do that, and the sheet's hand-typed `Result`
-- is counted as a disagreement and shown, never applied (spec FR-012; rule book disagree.resultApplied = false).
--
-- WHAT THIS ADDS (and nothing else — 071 and 072 are APPLIED IN PRODUCTION and are never edited):
--   DB-1  vt_uploads.kind    += 'schedulers_data'   ('opening_book' STAYS legal: the receipts already stored must read)
--   DB-2  vt_cases.sold_basis += 'schedulers_data'  ('opening_book' stays legal on the rows already dated by it)
--   DB-3  seven nullable columns on vt_cases: scheduler_name / scheduler_cb / gwp_rpt / referring_name / referring_cb /
--         campaign_rpt / result_rpt. The plan named four; the engine's dashboard() (072 Phase A) also reads the
--         referrer's NAME (the Agent & Scheduler Summary's person dimension), the campaign the report typed (the
--         channel map) and the Result (the "where the sources disagree" panel), so a book read back from here without
--         them would paint those three panels empty. ~60 bytes a case, ~180 KB over the whole book.
--   DB-4  vt_upload_commit and vt_book learn them. THE COMMIT USES coalesce(excluded.x, vt_cases.x) FOR THESE SEVEN
--         (plan risk 3): a BI or Scheduled & Missed commit sends them as null and must never blank what the Schedulers
--         Data upload set. Every other column keeps its 071 semantics byte for byte.
--         The 071 dating guard (`opening_book_before_first_day`) now covers the new kind too: a file that can only
--         date cases already in the book still has nothing to do on an empty book. The error NAME is unchanged, so no
--         client or suite has to learn a new code.
--         opening_book_on is stamped by a Schedulers Data commit EXACTLY as the opening book stamped it, and keeps its
--         first value (coalesce) — plan U-5. That is the whole reason the column is reused rather than replaced:
--         model()'s trackFrom, the working-day count and therefore every published SPD and Target Achievement figure
--         read exactly as they would have with the opening book. Nothing about the rating is touched.
--   DB-6  security: both functions stay `security invoker` with `set search_path = public`, and EXECUTE is revoked from
--         public / anon / authenticated and granted to service_role AFTER each definition (create or replace re-grants
--         EXECUTE — migration-049's lesson). RLS is already on for every vt_* table and no policy exists.
--   DB-7  no new index: every read is still the whole book by last_seen / status, which 071 settled (review D-H1).
--
-- IDEMPOTENT: every statement is `if not exists` / `create or replace` / drop-then-add of a named constraint, so the
-- file may be applied twice. No data is rewritten and no row is deleted.
--
-- Apply: node tools/apply-migration.mjs supabase/migration-073-vt-schedulers.sql   (the OWNER, at deploy — after 072;
-- order and rollback in specs/072-vt-report-dashboard/deploy-checklist.md. A builder never applies a migration.)
-- Guarded by nicks_code/diagnostics/verify-vt-db.mjs (D8a/D8b, the two CHECKs, the seven columns, the coalesce case).

set local lock_timeout = '3s';

-- ------------------------------------------------------------------------------------------------- DB-1 · the kind
alter table vt_uploads drop constraint if exists vt_uploads_kind_check;
alter table vt_uploads add constraint vt_uploads_kind_check
  check (kind in ('bi_fitted', 'sched_missed', 'opening_book', 'schedulers_data'));
comment on column vt_uploads.kind is 'bi_fitted | sched_missed | schedulers_data; opening_book is RETIRED (spec 072 U-1) and kept only so the receipts already stored still read.';

-- ------------------------------------------------------------------------------------------------- DB-2 · the basis
alter table vt_cases drop constraint if exists vt_cases_sold_basis_check;
alter table vt_cases add constraint vt_cases_sold_basis_check
  check (sold_basis in ('first_seen', 'opening_book', 'unknown', 'schedulers_data'));
comment on column vt_cases.sold_basis is 'Which source gave the sale day: schedulers_data > opening_book (retired) > first_seen; unknown = first seen on the go-live extract. The audit trail for "why did this case move months?".';

-- ------------------------------------------------------------------------------------------------- DB-3 · the columns
alter table vt_cases add column if not exists scheduler_name text;
alter table vt_cases add column if not exists scheduler_cb   text;
alter table vt_cases add column if not exists gwp_rpt        numeric(10,2);
alter table vt_cases add column if not exists referring_name text;
alter table vt_cases add column if not exists referring_cb   text;
alter table vt_cases add column if not exists campaign_rpt   text;
alter table vt_cases add column if not exists result_rpt     text;
alter table vt_cases drop constraint if exists vt_cases_scheduler_name_len;
alter table vt_cases drop constraint if exists vt_cases_scheduler_cb_fmt;
alter table vt_cases drop constraint if exists vt_cases_referring_name_len;
alter table vt_cases drop constraint if exists vt_cases_referring_cb_fmt;
alter table vt_cases drop constraint if exists vt_cases_campaign_rpt_len;
alter table vt_cases drop constraint if exists vt_cases_result_rpt_len;
alter table vt_cases add constraint vt_cases_scheduler_name_len check (scheduler_name is null or length(scheduler_name) <= 120);
alter table vt_cases add constraint vt_cases_scheduler_cb_fmt   check (scheduler_cb is null or scheduler_cb ~ '^CB[0-9]+$');
alter table vt_cases add constraint vt_cases_referring_name_len check (referring_name is null or length(referring_name) <= 120);
alter table vt_cases add constraint vt_cases_referring_cb_fmt   check (referring_cb is null or referring_cb ~ '^CB[0-9]+$');
alter table vt_cases add constraint vt_cases_campaign_rpt_len   check (campaign_rpt is null or length(campaign_rpt) <= 200);
alter table vt_cases add constraint vt_cases_result_rpt_len     check (result_rpt is null or length(result_rpt) <= 40);
comment on column vt_cases.scheduler_name is 'STAFF name as the master report types it, normalised by the engine. The scheduler is on the Agent List (sub-campaign Scheduling) and is never rated.';
comment on column vt_cases.gwp_rpt is 'GWP as the master report types it (Schedulers Data col E). NOT the engine''s `value` (BI charge ex VAT x vat): two different measures, both shown, neither adjusted to match the other (spec A7).';
comment on column vt_cases.result_rpt is 'The hand-typed Result of the master report, kept ONLY so the page can count and show where the sources disagree. It never decides a status (spec FR-012).';

-- ------------------------------------------------------------------------------------------------- DB-4 · the commit
-- A VERBATIM copy of migration-071's vt_upload_commit with four changes, all marked `072:` below. Everything else —
-- the ownership check, the receipt bounds, the compare-and-set, the duplicate and date checks, the bad_cancel proof,
-- the event upsert and the receipt write — is unchanged, line for line.
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
  -- 072 (1 of 4): the dating kinds. A file that only dates cases already in the book has nothing to do on an empty
  -- book, so the 071 guard now covers 'schedulers_data' too. The exception NAME is unchanged on purpose.
  if u.kind in ('opening_book', 'schedulers_data') and r.opened_on is null then
    raise exception 'opening_book_before_first_day: load the dating file after the first day''s two files';
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
  -- (A Schedulers Data upload writes no event at all, so it can never reach this check.)
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
  -- 072 (2 of 4): the seven Schedulers Data columns are read off the staged row …
  insert into vt_cases (case_number, status, status_on, sold_on, sold_basis, first_seen, last_seen, appt_on, fitted_on, sm_attempt, products,
                        bundle, charge_ex, partner_raw, lead_source, seller_name, seller_cb, seller_match, cancel_reason,
                        scheduler_name, scheduler_cb, gwp_rpt, referring_name, referring_cb, campaign_rpt, result_rpt, last_upload, rev, updated_at)
  select x.case_number, x.status, x.status_on, x.sold_on, x.sold_basis, x.first_seen, x.last_seen, x.appt_on, x.fitted_on, x.sm_attempt,
         coalesce(x.products, '{}'), x.bundle, x.charge_ex, x.partner_raw, x.lead_source, x.seller_name, x.seller_cb, x.seller_match, x.cancel_reason,
         x.scheduler_name, x.scheduler_cb, x.gwp_rpt, x.referring_name, x.referring_cb, x.campaign_rpt, x.result_rpt, p_id, v_rev, now()
    from vt_upload_stage s,
         jsonb_to_record(s.row) as x(case_number bigint, status text, status_on date, sold_on date, sold_basis text, first_seen date, last_seen date,
                                     appt_on date, fitted_on date, sm_attempt text, products text[], bundle text, charge_ex numeric, partner_raw text,
                                     lead_source text, seller_name text, seller_cb text, seller_match text, cancel_reason text,
                                     scheduler_name text, scheduler_cb text, gwp_rpt numeric, referring_name text, referring_cb text,
                                     campaign_rpt text, result_rpt text)
   where s.upload_id = p_id and s.kind = 'case'
  on conflict (case_number) do update set
    status = excluded.status, status_on = excluded.status_on, sold_on = excluded.sold_on, sold_basis = excluded.sold_basis,
    first_seen = excluded.first_seen, last_seen = excluded.last_seen, appt_on = excluded.appt_on, fitted_on = excluded.fitted_on,
    sm_attempt = excluded.sm_attempt, products = excluded.products, bundle = excluded.bundle, charge_ex = excluded.charge_ex,
    partner_raw = excluded.partner_raw, lead_source = excluded.lead_source, seller_name = excluded.seller_name, seller_cb = excluded.seller_cb,
    seller_match = excluded.seller_match, cancel_reason = excluded.cancel_reason,
    -- 072 (3 of 4): … and PRESERVED when the upload does not carry them (plan risk 3). A BI or Scheduled & Missed
    -- commit sends null for all seven, and a null must never blank what the Schedulers Data upload set.
    scheduler_name = coalesce(excluded.scheduler_name, vt_cases.scheduler_name),
    scheduler_cb   = coalesce(excluded.scheduler_cb,   vt_cases.scheduler_cb),
    gwp_rpt        = coalesce(excluded.gwp_rpt,        vt_cases.gwp_rpt),
    referring_name = coalesce(excluded.referring_name, vt_cases.referring_name),
    referring_cb   = coalesce(excluded.referring_cb,   vt_cases.referring_cb),
    campaign_rpt   = coalesce(excluded.campaign_rpt,   vt_cases.campaign_rpt),
    result_rpt     = coalesce(excluded.result_rpt,     vt_cases.result_rpt),
    last_upload = excluded.last_upload, rev = excluded.rev, updated_at = excluded.updated_at;
  insert into vt_case_events (case_number, on_date, from_status, to_status, appt_on, reason, upload_id)
  select x.case_number, x.on_date, x.from_status, x.to_status, x.appt_on, x.reason, p_id
    from vt_upload_stage s,
         jsonb_to_record(s.row) as x(case_number bigint, on_date date, from_status text, to_status text, appt_on date, reason text)
   where s.upload_id = p_id and s.kind = 'event'
  on conflict (case_number, on_date, to_status) do update set
    from_status = excluded.from_status, appt_on = excluded.appt_on, reason = excluded.reason, upload_id = excluded.upload_id
   where (vt_case_events.from_status, vt_case_events.appt_on, vt_case_events.reason) is distinct from (excluded.from_status, excluded.appt_on, excluded.reason);
  -- 072 (4 of 4): a Schedulers Data commit stamps opening_book_on exactly as the opening book did — same column, same
  -- meaning ("a sheet has supplied sale dates from before the first upload"), first value kept (plan U-5).
  update vt_book_rev set rev = v_rev,
         opened_on = coalesce(opened_on, case when u.kind not in ('opening_book', 'schedulers_data') then u.extract_on end),
         opening_book_on = coalesce(opening_book_on, case when u.kind in ('opening_book', 'schedulers_data') then u.extract_on end),
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

-- ------------------------------------------------------------------------------------------------- DB-4 · the book
-- 071's vt_book with the seven columns APPENDED to each case array, in VTEngine.BOOK_COLS order. Appending keeps every
-- earlier position where it was, so an older page reading a newer book is unaffected. Nothing else changes.
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
                                                          c.seller_match, c.sm_attempt, c.bundle, c.partner_raw, c.cancel_reason,
                                                          c.scheduler_name, c.scheduler_cb, c.gwp_rpt, c.referring_name, c.referring_cb,
                                                          c.campaign_rpt, c.result_rpt) order by c.case_number) from c), '[]'::json),
    'events', coalesce((select json_agg(json_build_array(e.case_number::text, e.on_date, e.from_status, e.to_status, e.appt_on, e.reason)
                                         order by e.case_number, e.on_date, e.to_status)
                          from vt_case_events e join c on c.case_number = e.case_number), '[]'::json))
  from vt_book_rev r where r.id = 1
$$;
revoke execute on function vt_book(date, bigint[]) from public, anon, authenticated;
grant execute on function vt_book(date, bigint[]) to service_role;

-- PostgREST caches the schema: ask it to see the changed functions now
notify pgrst, 'reload schema';
