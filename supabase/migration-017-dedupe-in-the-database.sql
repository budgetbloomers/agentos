-- ============================================================================
-- migration-017-dedupe-in-the-database.sql
--
-- DEDUPLICATION BECOMES THE DATABASE'S JOB, NOT THE BROWSER'S.
--
-- The upload stations already supersede by key at ingest, and specs/source_keys.json
-- records each source's identity rule with the counts it was measured against. Both
-- live in client code. This migration puts the same rules where they cannot be
-- bypassed: as constraints, so a second copy of a row is rejected by Postgres
-- whatever wrote it — the station, a tool, a backfill, or a future integration.
--
-- WHAT WAS ALREADY RIGHT. migration-010 gave eight of the source tables a natural
-- primary key that IS their identity rule: attendance (attendance_date,
-- employee_code), qa_evaluations (record_id), sf_closed_cases (case_number,
-- closed_at), sf_inactive (account_number, contract_number, deactivate_date),
-- sf_open_cases (snapshot_date, case_number), vici_calls (call_date — a TIMESTAMP,
-- see migration-016 — agent_login, lead_id, status), callx_calls (row_hash),
-- referrals (contact_id). Those need nothing.
--
-- THE ONE GAP: bi_active_cases. It is keyed on a synthetic `id`, so nothing stops
-- the same charge line loading twice. It is also the money, which makes it the one
-- table where a duplicate is not a tidiness problem.
--
-- THE KEY, AND WHY IT IS SIX COLUMNS. A first attempt keyed the money on
-- (case_number, account, charge_amount, date) and deleted four REAL rows worth
-- R128.69 in a backfill on 2026-08-31: case 21217153 carries three separate
-- contracts at the same charge, and case 21194675 carries Homedrive R49 beside
-- MyPanic Single R49 — two products, one price, one day. Every pair arrived in a
-- single batch, which is the tell: rows that appear together in one file are
-- distinct facts, never a re-upload. GWP is Sum of Charge Amount per account, so
-- each contract line is its own fact. contract_number and charge_code belong in
-- the key, and the store was restored from backup within the minute.
--
-- COALESCE, NOT RAW COLUMNS. contract_number and charge_code are nullable, and a
-- NULL never equals a NULL in a unique index — two rows that are identical apart
-- from a missing contract number would both be admitted, which is the hole this
-- index exists to close. The expression form makes the comparison total.
--
-- Verified before creation: 27 377 live rows, 0 duplicate groups on this key.
-- SAFE TO RUN TWICE (IF NOT EXISTS).
-- ============================================================================

create unique index if not exists bi_active_cases_natural_uq
  on bi_active_cases (
    case_number,
    account_no,
    coalesce(contract_number, ''),
    coalesce(charge_code, ''),
    charge_amount,
    contract_create_date
  );

comment on index bi_active_cases_natural_uq is
  'The money''s identity rule: one row per charge line. case + account + contract + charge code + amount + contract-create date. Six columns because a case can carry several contracts, and a contract several products at the same price — keyed any shorter, real premium is deleted as a duplicate (R128.69 of it, on 2026-08-31, restored from backup). Matches specs/source_keys.json BI_ACTIVE_CASES.';

-- ---------------------------------------------------------------------------
-- A queryable statement of what the lake holds and whether it is keyed cleanly.
-- `lake_audit` already reports row counts and date spans per source; this adds the
-- one thing an audit of deduplication actually needs — the distinct-key count
-- beside the row count, so "one row, one fact" is a query rather than a belief.
-- ---------------------------------------------------------------------------
create or replace view lake_duplicates as
select 'attendance'      as source, count(*)::bigint as rows,
       count(distinct (attendance_date, employee_code))::bigint as distinct_keys from attendance
union all select 'qa_evaluations',   count(*), count(distinct record_id) from qa_evaluations
union all select 'sf_closed_cases',  count(*), count(distinct (case_number, closed_at)) from sf_closed_cases
union all select 'sf_open_cases',    count(*), count(distinct (snapshot_date, case_number)) from sf_open_cases
union all select 'sf_inactive',      count(*), count(distinct (account_number, contract_number, deactivate_date)) from sf_inactive
union all select 'vici_calls',       count(*), count(distinct (call_date, agent_login, lead_id, status)) from vici_calls
union all select 'callx_calls',      count(*), count(distinct row_hash) from callx_calls
union all select 'referrals',        count(*), count(distinct contact_id) from referrals
union all select 'agent_list',       count(*), count(distinct (as_of, employee_code)) from agent_list
union all select 'bi_active_cases',  count(*), count(distinct (case_number, account_no, coalesce(contract_number,''),
                                                               coalesce(charge_code,''), charge_amount, contract_create_date))
  from bi_active_cases;

comment on view lake_duplicates is
  'Rows against distinct keys, per source. rows = distinct_keys is the whole contract: one row, one fact. Any gap means something wrote past the constraints.';
