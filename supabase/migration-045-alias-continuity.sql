-- migration-045-alias-continuity.sql
-- THE SAME PERSON, OR A RE-ISSUED CODE? (review of migration-044, 2026-09-21)
--
-- agent_list_aliases() handed every earlier spelling on a code to whoever holds that code today,
-- keyed on the employee code alone. A code given to a NEW hire (or mistyped against the wrong row on
-- one upload) would therefore alias the previous holder's every spelling to the new person — and
-- their Salesforce sales with it, for as long as the window lasts. An alias now requires continuity:
-- the earlier spelling and the current one must share a word of four letters or more (the apps'
-- sameHuman rule; a one-typo fit is the browser's job, the archive keeps to what it can prove).
-- "Surprise Lucky Cwele" / "Surprize Cwele" share CWELE; "Nolulamo Mazaka" / "Mazeka" share NOLULAMO.

create or replace function agent_list_aliases(p_days int default 180)
returns table (code text, name text, last_on date)
language sql stable security definer set search_path = public as $$
  with cur as (select max(as_of) as as_of from agent_list),
  today as (
    select norm_cb(a.employee_code) as cb,
           coalesce(nullif(btrim(a.sales_force), ''), a.agent_name) as cur_name,
           lower(regexp_replace(coalesce(a.agent_name, ''),  '[^A-Za-z]', '', 'g')) as n1,
           lower(regexp_replace(coalesce(a.sales_force, ''), '[^A-Za-z]', '', 'g')) as n2
    from   agent_list a, cur
    where  a.as_of = cur.as_of and norm_cb(a.employee_code) is not null
  ),
  live_names as (select n1 as n from today where n1 <> '' union select n2 from today where n2 <> ''),
  carried as (
    select norm_cb(a.employee_code) as cb, s.raw,
           lower(regexp_replace(s.raw, '[^A-Za-z]', '', 'g')) as n, max(a.as_of) as last_on
    from   agent_list a
    cross  join lateral (values (a.agent_name), (a.sales_force)) as s(raw)
    where  a.as_of >= current_date - make_interval(days => p_days)
      and  norm_cb(a.employee_code) is not null
      and  s.raw is not null and btrim(s.raw) <> '' and btrim(s.raw) <> '-'
    group  by 1, 2, 3
  ),
  -- continuity: a word of 4+ letters the earlier spelling shares with the current one
  same_human as (
    select c.cb, c.n
    from   carried c join today t on t.cb = c.cb
    where  exists (
      select 1
      from   regexp_split_to_table(lower(regexp_replace(c.raw,      '[^A-Za-z ]', ' ', 'g')), '\s+') w1
      join   regexp_split_to_table(lower(regexp_replace(t.cur_name, '[^A-Za-z ]', ' ', 'g')), '\s+') w2 on w1 = w2
      where  length(w1) >= 4)
  )
  select distinct on (c.cb, c.n) c.cb, btrim(c.raw), c.last_on
  from   carried c
  join   today t on t.cb = c.cb
  join   same_human h on h.cb = c.cb and h.n = c.n
  where  c.n <> '' and c.n <> t.n1 and c.n <> t.n2
    and  not exists (select 1 from live_names l where l.n = c.n)
  order  by c.cb, c.n, c.last_on desc;
$$;
grant execute on function agent_list_aliases(int) to service_role;
comment on function agent_list_aliases(int) is
  'For every code on the current Agent List, every earlier spelling of its name in the last p_days that shares a word (4+ letters) with the current spelling and that nobody on the current list carries today, with the last list that carried it. Served on /api/roster as aliases[].';
