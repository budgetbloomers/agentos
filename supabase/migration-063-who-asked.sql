-- migration-063 · who asked — names, teams and leaders on every ask (Spec Kit 030-who-asked, 2026-10-11)
--
-- Nick (looking at most_asked_topics): "add agents team name, who asked and their team leader, do the same for team
-- leader and campaign manager".
--
-- Views only, on migration-062's usage_events_real, so test traffic stays hidden. Nothing is copied: names are read from
-- the accounts at the time of READING (a renamed person shows today's name; a leaver shows the username / CB kept on the
-- ask). Teams are named after their team leader (app_users.team); a team leader's campaign manager on record is
-- team_leader_cbs.manager.
--   · ask_events            + user_id, username, cb, cms (appended — every 029 column kept)
--   · ask_askers            one row per ask: who asked (person_key, person_name, person_cb, team, team_leader,
--                           campaign_manager, handled_by-free) and the readable `who`
--   · help_asks_detail      every agent → team leader ask (US1)
--   · cm_requests_detail    every team leader → campaign manager request (US2)
--   · most_asked_topics     askers = distinct PEOPLE; asked_by text[] appended (US3)
-- Locked down like 062: security_invoker, revoked from public/anon/authenticated, SELECT to service_role.
--
-- NOT APPLIED. Apply with Nick's go-ahead (no deploy needed):  node tools/apply-migration.mjs supabase/migration-063-who-asked.sql

create or replace view ask_events with (security_invoker = true) as
select e.id, e.at,
       (e.at at time zone 'Africa/Johannesburg')::date as day,
       date_trunc('week', e.at at time zone 'Africa/Johannesburg')::date as week,
       date_trunc('month', e.at at time zone 'Africa/Johannesburg')::date as month,
       case when e.event = 'help_ask' then 'help' else 'cm' end as source,
       case when e.event = 'help_ask' then coalesce(e.username, lower(e.detail->>'cb')) else coalesce(e.team_leader, e.username) end as asker,
       case when e.event = 'help_ask' then coalesce(e.detail->>'agent_name', e.username) else e.team_leader end as asker_name,
       e.team_leader, e.campaign, e.category,
       nullif(btrim(case when e.event = 'help_ask' then e.detail->>'note' else e.detail->>'text' end), '') as text,
       coalesce((e.detail->>'delivered')::boolean, true) as delivered,
       coalesce((e.detail->>'merged')::boolean, false) as merged,
       coalesce((e.detail->>'restricted')::boolean, false) as restricted,
       e.detail->>'opp_id' as opp_id,
       coalesce(t.effective_topic, e.topic) as topic,
       case when e.topic is null then 'Not labelled yet' else coalesce(t.effective_label, e.topic) end as topic_label,
       e.user_id, e.username,
       nullif(upper(btrim(e.detail->>'cb')), '') as cb,
       e.detail->'cms' as cms
  from usage_events_real e
  left join ask_topic_effective t on t.topic = e.topic
 where e.event in ('help_ask', 'cm_request');

create or replace view ask_event_periods with (security_invoker = true) as
select g.grain, g.period_start, a.*
  from ask_events a
  cross join lateral (values ('day', a.day), ('week', a.week), ('month', a.month)) g (grain, period_start);

-- WHO ASKED. The account: by user_id, else username, else CB (a HighLevel-backfilled ask carries the CB from the card's
-- note; a TL's CB is also on team_leader_cbs). Name: the account's, else the one recorded with the ask, else the
-- username. The campaign manager: the ONE named at raise time (detail.cms), else the TL's manager on record, else all
-- that detail.cms named (all three CMs run every campaign today, so cms alone rarely singles one out).
create or replace view ask_askers with (security_invoker = true) as
with base as (
  select a.*, tl.employee_code as tl_code, tl.manager as tl_manager,
         u.id as account_id, u.full_name as account_name, nullif(upper(btrim(u.cb)), '') as account_cb, nullif(btrim(u.team), '') as account_team,
         (select array_agg(coalesce(au.full_name, x) order by x)
            from jsonb_array_elements_text(case when jsonb_typeof(a.cms) = 'array' then a.cms else '[]'::jsonb end) x
            left join app_users au on au.username = x) as cms_names
    from ask_events a
    left join team_leader_cbs tl on a.source = 'cm' and btrim(tl.leader_name) = a.team_leader
    left join lateral (
      select x.id, x.full_name, x.cb, x.team
        from app_users x
       where (a.user_id is not null and x.id = a.user_id)
          or (a.username is not null and x.username = a.username)
          or (a.cb is not null and upper(btrim(x.cb)) = a.cb)
          or (a.source = 'cm' and nullif(btrim(tl.employee_code), '') is not null and upper(btrim(x.cb)) = upper(btrim(tl.employee_code)))
       order by (a.user_id is not null and x.id = a.user_id) desc, (a.username is not null and x.username = a.username) desc, x.username
       limit 1) u on true
),
who as (
  select b.*,
         case when b.source = 'help' then coalesce(b.account_name, b.asker_name, b.username, b.cb)
              else coalesce(b.account_name, b.team_leader, b.username) end as person_name,
         coalesce(b.account_cb, b.cb, case when b.source = 'cm' then nullif(upper(btrim(b.tl_code)), '') end,
                  case when b.username ~* '^cb[0-9]+$' then upper(b.username) end) as person_cb,
         coalesce(b.account_team, b.team_leader) as person_team,
         case when b.source = 'help' then coalesce(b.team_leader, b.account_team) else null end as person_team_leader,
         case when b.source = 'cm' then
           case when cardinality(b.cms_names) = 1 then b.cms_names[1]
                else coalesce(nullif(btrim(b.tl_manager), ''), array_to_string(b.cms_names, ', ')) end end as campaign_manager
    from base b
)
select w.id, w.at, w.day, w.week, w.month, w.source, w.team_leader, w.campaign, w.category, w.text, w.delivered, w.merged,
       w.restricted, w.opp_id, w.topic, w.topic_label, w.username,
       coalesce(w.account_id::text, w.person_cb, lower(w.username), w.asker) as person_key,
       w.person_name, w.person_cb, w.person_team as team, w.person_team_leader, w.campaign_manager,
       w.person_name || coalesce(' (' || w.person_cb || ')', '') || coalesce(' · Team ' || w.person_team, '')
         || case when w.source = 'help' then coalesce(' · TL ' || w.person_team_leader, '') else coalesce(' · CM ' || w.campaign_manager, '') end as who
  from who w;

-- US1 · every agent → team leader ask, with who asked and where it stands now (the card's last stage in this ask's round)
create or replace view help_asks_detail with (security_invoker = true) as
with k as (
  select a.*, lead(a.at) over (partition by a.opp_id order by a.at, a.id) as next_at
    from ask_askers a
   where a.source = 'help'
)
select k.id, (k.at at time zone 'Africa/Johannesburg') as at_sast, k.day, k.week, k.month,
       k.person_name as agent_name, k.person_cb as agent_cb, k.team, k.person_team_leader as team_leader, k.campaign,
       k.category, k.topic_label as topic, k.topic as topic_key, k.text as question, k.delivered,
       coalesce(s.category, case when k.delivered then 'New' else 'Not delivered' end) as current_stage,
       (s.at at time zone 'Africa/Johannesburg') as stage_at_sast, k.opp_id, k.username
  from k
  left join lateral (
    select x.category, x.at from usage_events_real x
     where k.opp_id is not null and x.event = 'help_stage' and x.detail->>'opp_id' = k.opp_id
       and x.at >= k.at and (k.next_at is null or x.at < k.next_at)
     order by x.at desc, x.id desc limit 1) s on true;

-- US2 · every team leader → campaign manager request (a merged duplicate is counted on its request, not listed again)
create or replace view cm_requests_detail with (security_invoker = true) as
with k as (
  select a.*, lead(a.at) over (partition by a.opp_id, a.delivered order by a.at, a.id) as next_at
    from ask_askers a
   where a.source = 'cm' and not a.merged
)
select k.id, (k.at at time zone 'Africa/Johannesburg') as at_sast, k.day, k.week, k.month,
       k.person_name as tl_name, k.person_cb as tl_cb, k.team as tl_team, k.campaign, k.campaign_manager, hb.handled_by,
       k.category as blockage, k.topic_label as topic, k.topic as topic_key, k.text as request, k.restricted, k.delivered,
       coalesce(c.status, case when k.delivered then 'New' else 'Not delivered' end) as status,
       coalesce(c.duplicates_merged, 0) as duplicates_merged, k.opp_id, k.username
  from k
  left join lateral (
    select coalesce(x.detail->>'actor', x.username) as handled_by from usage_events_real x
     where k.delivered and k.opp_id is not null and x.event = 'cm_action' and x.detail->>'opp_id' = k.opp_id
       and x.at >= k.at and (k.next_at is null or x.at < k.next_at)
       and coalesce(x.role, '') not in ('team_leader', 'agent')
       and coalesce(x.detail->>'actor', x.username) is not null
       and coalesce(x.detail->>'actor', x.username, '') <> coalesce(k.team_leader, '')
     order by x.at, x.id limit 1) hb on true
  left join lateral (
    select r.status, r.duplicates_merged from cm_requests r
     where r.requested_at = k.at and r.opp_id is not distinct from k.opp_id and r.blockage is not distinct from k.category
     limit 1) c on true;

-- US3 · the most-asked list says who asked: askers = distinct PEOPLE, asked_by = "Name (CB) · Team · TL|CM" (029's
-- columns unchanged, asked_by appended)
create or replace view most_asked_topics with (security_invoker = true) as
with base as (
  select p.grain, p.period_start, s.source, p.topic, p.topic_label, k.person_key, k.who, p.text, p.at, p.id, p.category
    from ask_event_periods p
    join ask_askers k on k.id = p.id
    cross join lateral (values (p.source), ('all')) s (source)
),
ex as (
  select b.*, row_number() over (partition by b.grain, b.period_start, b.source, b.topic order by (b.text is null), b.at desc, b.id desc) as rn
    from base b
)
select x.grain, x.period_start, x.source, x.topic, max(x.topic_label) as label,
       count(*)::int as asks, count(distinct x.person_key)::int as askers,
       coalesce(array_agg(left(x.text, 200) order by x.at desc, x.id desc) filter (where x.text is not null and x.rn <= 3), '{}'::text[]) as examples,
       array_agg(distinct x.category) filter (where x.category is not null) as categories,
       rank() over (partition by x.grain, x.period_start, x.source order by count(*) desc)::int as rank,
       coalesce(array_agg(distinct x.who order by x.who) filter (where x.who is not null), '{}'::text[]) as asked_by
  from ex x
 group by 1, 2, 3, 4;

revoke all on ask_events, ask_event_periods, ask_askers, help_asks_detail, cm_requests_detail, most_asked_topics from public, anon, authenticated;
grant select on ask_events, ask_event_periods, ask_askers, help_asks_detail, cm_requests_detail, most_asked_topics to service_role;

comment on view help_asks_detail is 'Spec Kit 030: every agent → team leader ask with who asked (name, CB, team, TL), topic, the question, delivered, current stage — select * from help_asks_detail where month = date_trunc(''month'', now() at time zone ''Africa/Johannesburg'')::date order by at_sast desc';
comment on view cm_requests_detail is 'Spec Kit 030: every team leader → campaign manager request with the TL (name, CB, team), the campaign manager, who handled it, topic, the request, status';
comment on view most_asked_topics is 'Spec Kit 029/030: the most asked questions by topic (source help / cm / all) — asks, askers (distinct people), up to 3 examples, asked_by (Name (CB) · Team · TL|CM) — order by rank';
