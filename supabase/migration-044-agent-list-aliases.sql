-- migration-044-agent-list-aliases.sql
-- EVERY NAME A CODE HAS CARRIED (2026-09-21; specs/identity-aliases-plan.md).
--
-- The 18 Sep Agent List re-spelt twelve agents ("Surprise Lucky Cwele" -> "Surprize Cwele",
-- "Lindokuhle" -> "Lindokhule Phakathi", "Nolulamo Mazaka" -> "Mazeka", ...) and the Sales Force
-- column with them. Salesforce kept the old spelling on every case, and PULSE joins the Power BI
-- Owner to the roster by name, so ~206 September sales fell to "Unmatched" and four of Dhamendra
-- Budhu's agents read 0 sales / 0 GWP on the Daily view. The archive knew the answer all along:
-- CB242 had carried "Surprise Lucky Cwele" on every list from 28 Aug to 16 Sep.
--
-- agent_list_aliases() states it: for every code on the CURRENT list, every earlier spelling of its
-- Agent Name / Sales Force in the last p_days, with the last list that carried it. Served on
-- /api/roster (and the publish reply) as aliases[] beside leavers[]; PULSE adopts them into
-- S.aliases and resolves through them SOFTLY. Two spellings are the same when they agree letter for
-- letter ignoring case, spaces and punctuation (the apps' normName). A spelling some OTHER code on
-- the current list carries today is never an alias — that name belongs to whoever carries it now.

create or replace function agent_list_aliases(p_days int default 180)
returns table (
  code     text,   -- the code on the current list
  name     text,   -- an earlier spelling of that code's name, as the list typed it
  last_on  date    -- the last list that carried this spelling
)
language sql stable security definer set search_path = public as $$
  with cur as (select max(as_of) as as_of from agent_list),
  -- one row per code on the current list: the spelling(s) it carries today
  today as (
    select norm_cb(a.employee_code) as cb,
           lower(regexp_replace(coalesce(a.agent_name, ''),  '[^A-Za-z]', '', 'g')) as n1,
           lower(regexp_replace(coalesce(a.sales_force, ''), '[^A-Za-z]', '', 'g')) as n2
    from   agent_list a, cur
    where  a.as_of = cur.as_of and norm_cb(a.employee_code) is not null
  ),
  live_names as (                       -- every spelling anybody on the current list carries today
    select n1 as n from today where n1 <> '' union select n2 from today where n2 <> ''
  ),
  -- every spelling every current code has carried on any list in the window
  carried as (
    select norm_cb(a.employee_code) as cb, s.raw,
           lower(regexp_replace(s.raw, '[^A-Za-z]', '', 'g')) as n, max(a.as_of) as last_on
    from   agent_list a
    cross  join lateral (values (a.agent_name), (a.sales_force)) as s(raw)
    where  a.as_of >= current_date - make_interval(days => p_days)
      and  norm_cb(a.employee_code) is not null
      and  s.raw is not null and btrim(s.raw) <> '' and btrim(s.raw) <> '-'
    group  by 1, 2, 3
  )
  select distinct on (c.cb, c.n) c.cb, btrim(c.raw), c.last_on
  from   carried c
  join   today t on t.cb = c.cb
  where  c.n <> '' and c.n <> t.n1 and c.n <> t.n2
    and  not exists (select 1 from live_names l where l.n = c.n)
  order  by c.cb, c.n, c.last_on desc;
$$;
grant execute on function agent_list_aliases(int) to service_role;
comment on function agent_list_aliases(int) is
  'For every code on the current Agent List, every earlier spelling of its name (Agent Name / Sales Force) in the last p_days that nobody on the current list carries today, with the last list that carried it. Served on /api/roster as aliases[]; PULSE resolves Salesforce owners through them so a re-spelt agent never loses their sales.';
