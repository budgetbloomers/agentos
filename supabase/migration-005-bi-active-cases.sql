-- ============================================================
-- migration-005: Power BI - Active Cases — THE money source.
-- Run once in: Supabase Dashboard → SQL Editor → New query → paste → Run
--
-- Replaces the legacy Activated-Services + GWP-table pricing. Sales and GWP
-- now come from this table and nowhere else.
--
--   GWP incl = Σ charge_amount per account_no × (1 + vat_rate)
--   charge_amount is EX-VAT   (30.43 + 33.91 + 21.74 = 86.08 = 99.00 ÷ 1.15)
--   sale date  = contract_create_date, per row
--   agent      = cb_of_owner(owner)
--
-- GRAIN: one row per CHARGE LINE, not per account. Aggregating at ingest would
-- destroy the per-line detail the money model is audited on (V-03 tolerance,
-- charge-code mix, rows/account mode 3 max 20). Aggregate at read time.
--
-- STORAGE: months ACCUMULATE. This deviates from pack rule R-ING-BI-06
-- ("re-upload replaces all prior BI rows") by explicit decision, because the
-- file is uploaded monthly and wholesale replacement would destroy last month's
-- sales on the next upload. The new file is authoritative ONLY for the span of
-- contract_create_date it covers — see the delete-then-insert note below.
-- Pack §8 amendment required.
--
-- Security: RLS ON, ZERO policies → the publishable/anon key can touch nothing.
-- Only the Worker's secret key (which bypasses RLS) reads/writes. Same pattern
-- as every other table in this schema.
-- ============================================================

create table if not exists bi_active_cases (
  id                   bigint generated always as identity primary key,
  account_no           text not null,          -- Account Number — the sale identity
  contract_create_date date not null,          -- THE date of the sale (per row)
  owner                text,                   -- raw Owner string — matched via sfOwnerMap
  cb                   text,                   -- resolved CB code; NULL = unattributed (never spread)
  charge_amount        numeric not null,       -- EX-VAT. Never grossed up at rest.
  charge_code          text,
  contract_status      text,                   -- first duplicate header wins (R-ING-00c)
  contract_number      text,
  case_number          text,
  account_name         text,
  consultant           text,
  product_bundle       text,
  merged_bundle        text,
  sales_vertical       text,
  batch_id             text references batches(batch_id),
  loaded_at            timestamptz default now()
);

-- The filters you will actually use: by month/range, by agent, by account.
create index if not exists bi_active_cases_date_idx    on bi_active_cases(contract_create_date);
create index if not exists bi_active_cases_cb_date_idx on bi_active_cases(cb, contract_create_date);
create index if not exists bi_active_cases_acct_idx    on bi_active_cases(account_no, contract_create_date);
create index if not exists bi_active_cases_batch_idx   on bi_active_cases(batch_id);

alter table bi_active_cases enable row level security;

-- ---------- monthly upload contract (the Worker performs this in one transaction) ----------
-- The new file wins for its own period only; every other month survives:
--
--   begin;
--     delete from bi_active_cases
--      where contract_create_date between :file_min_date and :file_max_date;
--     insert into bi_active_cases (...) values ...;   -- the file's rows
--   commit;
--
-- Re-uploading July replaces July alone. Uploading August leaves July intact.
-- Never `truncate` this table on upload — that is the R-ING-BI-06 behaviour we
-- deliberately do not want here.

-- ---------- raw file archive ----------
-- Every monthly export is kept as an immutable file, so any figure can be
-- re-derived from the exact bytes that produced it (R-FMT-06 traceability).
-- Private: served only via Worker-signed URLs.
insert into storage.buckets (id, name, public)
values ('bi-reports', 'bi-reports', false)
on conflict (id) do nothing;

-- (The legacy `sales` table this migration once truncated is dropped outright in
--  migration-006, together with the other never-written schema tables.)

comment on table bi_active_cases is
  'THE money source. One row per Power BI charge line. GWP incl = sum(charge_amount) per account_no x (1+vat_rate); charge_amount is ex-VAT. Sale dated by contract_create_date per row. Agent via cb_of_owner(owner); cb NULL = unattributed, reported never spread. Months accumulate: a new file replaces only its own contract_create_date span (deviation from pack R-ING-BI-06, see migration header).';

-- ---------- verify ----------
-- select count(*) from bi_active_cases;                       -- rows
-- select count(distinct account_no) from bi_active_cases;     -- = sales (F-MONEY-04)
-- select round(sum(charge_amount),2) from bi_active_cases;    -- = GWP ex  (V-02)
-- select count(*) from bi_active_cases where cb is null;      -- unattributed lines
-- select id from storage.buckets;                             -- raw, brain, bi-reports
-- (the bi_account_gwp view this migration once created was never queried — dropped in migration-006)
