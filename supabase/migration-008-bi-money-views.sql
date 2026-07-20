-- ============================================================
-- migration-008: LIVE money views for the Ask AgentOS chatbot.
-- Run once in: Supabase Dashboard → SQL Editor → New query → paste → Run
--
-- Why: the chatbot must answer any money question from LIVE database data, not
-- from an app-pushed digest that is only fresh while someone has the app open.
-- bi_active_cases is one row per CHARGE LINE (thousands of rows) — far too large
-- to hand an LLM raw. These views aggregate it to the money model at read time
-- (GWP incl = Σ charge_amount per account × 1.15; sales = distinct accounts),
-- so the Worker can inject a small, always-current money snapshot on every ask.
--
-- Security: SECURITY INVOKER — the views inherit bi_active_cases' RLS (which has
-- ZERO policies), so the anon/publishable key sees NOTHING through them. Only the
-- Worker's service key (RLS-bypass) reads them. We also revoke explicitly.
--
-- Safe to run repeatedly (create or replace / revoke are idempotent).
-- ============================================================

-- 1) money by month — the headline series (sales, GWP ex + incl, line counts)
create or replace view bi_money_by_month
  with (security_invoker = on) as
  select to_char(contract_create_date, 'YYYY-MM')   as ym,
         count(distinct account_no)                 as sales,
         round(sum(charge_amount), 2)               as gwp_ex,
         round(sum(charge_amount) * 1.15, 2)        as gwp_incl,
         count(*)                                   as charge_lines,
         count(*) filter (where cb is null)         as unattributed_lines
  from bi_active_cases
  group by 1
  order by 1;

-- 2) money by agent × month — so "top agent in June", "CB-15's GWP" resolve live
create or replace view bi_money_by_agent
  with (security_invoker = on) as
  select to_char(contract_create_date, 'YYYY-MM')   as ym,
         cb,
         max(owner)                                 as owner,
         count(distinct account_no)                 as sales,
         round(sum(charge_amount) * 1.15, 2)        as gwp_incl
  from bi_active_cases
  where cb is not null
  group by 1, 2
  order by 1 desc, 5 desc;

-- 3) grand total — the canonical V-01 (distinct accounts) / V-02 (GWP ex) figures,
--    computed globally so a multi-month account is counted once, not once per month
create or replace view bi_money_total
  with (security_invoker = on) as
  select count(distinct account_no)                 as sales,
         round(sum(charge_amount), 2)               as gwp_ex,
         round(sum(charge_amount) * 1.15, 2)        as gwp_incl,
         count(*)                                   as charge_lines,
         count(*) filter (where cb is null)         as unattributed_lines,
         min(contract_create_date)                  as first_sale,
         max(contract_create_date)                  as last_sale
  from bi_active_cases;

-- lock the views to the Worker (service key) only — never the browser's anon key
revoke all on bi_money_by_month, bi_money_by_agent, bi_money_total from anon, authenticated;
grant  select on bi_money_by_month, bi_money_by_agent, bi_money_total to service_role;

-- verify:
-- select * from bi_money_total;                 -- sales = V-01 (3,484), gwp_ex = V-02 (R318,140.91)
-- select * from bi_money_by_month order by ym;  -- one row per month loaded
