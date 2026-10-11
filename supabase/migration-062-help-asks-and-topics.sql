-- migration-062 · who asks for help, and what they ask most (Spec Kit 029-help-asks-and-topics, 2026-10-11)
--
-- Nick: "we also want to monitor, how many agents ask their team leader for help, how many team leaders asked their cm
-- for help, what was the most asked question".
--
-- Builds on migration-061 (usage_events). Nothing there is redefined. This adds:
--   · usage_events.topic — ONE topic per help ask / CM request, a slug from ask_topics, set after the ask by the Worker
--     (worker/src/topics.mjs, Workers AI, in waitUntil) or by tools/usage-topics.mjs. NULL = not labelled yet.
--     service_role may UPDATE this column and no other: the table stays append-only for everything else.
--   · ask_topics — the curated list Nick owns. Rename = edit label. Merge = set merged_into (+ active = false); every
--     past count follows, because every view reads topics through ask_topic_effective.
--   · usage_attach_cm_text — fills a CM request row's words ONCE (rows the 028 backfill wrote before 029 kept words).
--   · the report views (day / week / month, SAST) for the three questions.
--   · TEST TRAFFIC IS NOT IN THE REPORT (Nick, 2026-10-11: "Exclude test traffic from the report"): usage_test_markers names
--     test accounts / cards / key prefixes in ONE place; usage_events_real is usage_events without them and without any ask
--     whose topic resolves to 'test' (Test message). EVERY report view — 029's and 028's, re-issued below unchanged but for
--     their source — reads usage_events_real. The rows stay in usage_events; add a marker row to hide more.
--
-- Locked down like 061: RLS on with NO policies; everything revoked from public/anon/authenticated; service_role only.
-- Views are security_invoker. Every function: search_path pinned, EXECUTE revoked from public/anon/authenticated.
--
-- NOT APPLIED. Apply at release, with Nick's go-ahead, BEFORE the Worker that labels asks is deployed:
--   node tools/apply-migration.mjs supabase/migration-062-help-asks-and-topics.sql
-- Safe to re-run: the seed is ON CONFLICT DO NOTHING (a rename or merge Nick made is never undone).

-- ---------- the topic on every ask ----------
alter table usage_events add column if not exists topic text check (topic is null or char_length(topic) <= 60);
create index if not exists usage_events_topic_at_idx on usage_events (topic, at) where topic is not null;
create index if not exists usage_events_unlabelled_idx on usage_events (event, at) where topic is null and event in ('help_ask', 'cm_request');
grant update (topic) on usage_events to service_role;
comment on column usage_events.topic is
  'Spec Kit 029: the ask''s topic (a slug from ask_topics) for help_ask / cm_request rows; NULL = not labelled yet. Set by the Worker after the ask (Workers AI, checked against the active list) or by tools/usage-topics.mjs. Read through ask_topic_effective so merges apply.';

-- ---------- the curated list ----------
create table if not exists ask_topics (
  topic        text primary key check (topic ~ '^[a-z][a-z0-9_]{1,39}$'),
  label        text not null check (char_length(label) between 1 and 60),
  hint         text check (hint is null or char_length(hint) <= 300),
  merged_into  text references ask_topics (topic) on update cascade,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  constraint ask_topics_not_into_itself check (merged_into is null or merged_into <> topic)
);
alter table ask_topics enable row level security;
revoke all on table ask_topics from public, anon, authenticated;
grant select, insert, update on table ask_topics to service_role;
comment on table ask_topics is
  'Spec Kit 029: the topics asks are grouped into. Rename: update label. Merge: set merged_into to the surviving topic and active = false — every past count follows (ask_topic_effective). Only active topics are offered to the AI.';

-- seeded from the real asks (11 Help cards / 18 ask notes, 2 Campaign Assistance cards, 2026-10-11), the six help
-- categories, the eleven CM blockages and the floor's standing themes — see specs/029-help-asks-and-topics/data-model.md
insert into ask_topics (topic, label, hint) values
  ('call_review',        'Review my call',             'asks the team leader to listen to a call, check a sale before it is put through, or give feedback on a call'),
  ('what_to_say',        'What to say on calls',       'scripts, openings, getting past the introduction, how to word something to a customer'),
  ('closing_objections', 'Closing and objections',     'closing the sale, handling a customer''s objection or a "no", rebuttals'),
  ('product',            'Product questions',          'what a product or cover includes, benefits, upgrades, pricing, process knowledge'),
  ('quality_score',      'Quality score (QA)',         'explaining or disputing a QA / quality result, compliance on calls'),
  ('sale_value',         'Sale value (GWP floor)',     'the value of a sale, GWP per sale, the R99 floor, value issues'),
  ('targets_sales',      'Targets and sales count',    'daily or monthly targets, how many sales were counted, missing or cancelled sales'),
  ('attendance_days',    'Attendance and days worked', 'attendance, leave, shifts, the days worked shown in the app'),
  ('commission_pay',     'Commission and pay',         'commission, payroll, incentives, money owed'),
  ('signin_password',    'Sign-in and passwords',      'cannot sign in, locked out, password resets, access to an app'),
  ('app_figures',        'App or figures wrong',       'the app, report or dashboard shows something wrong or out of date, a system that does not work'),
  ('dialler',            'Dialler problems',           'the dialler, dropped calls, call quality, ViciDial'),
  ('leads_data',         'Leads and data',             'no leads, bad leads, lead allocation, data quality'),
  ('training_coaching',  'Training and coaching',      'asking for training, a coaching session, skills or behaviour help for the team'),
  ('personal',           'Personal matter',            'a personal or private matter (restricted requests)'),
  ('test',               'Test message',               'a test, a greeting with no question, or a message that says to ignore it'),
  ('other',              'Other',                      'anything that fits none of the topics above')
on conflict (topic) do nothing;

-- every topic → the topic it finally counts under (merge chains followed, cycle-safe, at most 10 hops)
create or replace view ask_topic_effective with (security_invoker = true) as
with recursive walk as (
  select t.topic, t.topic as cur, 0 as hops, array[t.topic] as path from ask_topics t
  union all
  select w.topic, n.merged_into, w.hops + 1, w.path || n.merged_into
    from walk w join ask_topics n on n.topic = w.cur
   where n.merged_into is not null and w.hops < 10 and not (n.merged_into = any (w.path))
)
select distinct on (w.topic) w.topic, b.label, b.active, w.cur as effective_topic, e.label as effective_label, w.hops
  from walk w
  join ask_topics b on b.topic = w.topic
  join ask_topics e on e.topic = w.cur
 order by w.topic, w.hops desc;

-- ---------- test traffic: named in ONE place (Nick, 2026-10-11: "Exclude test traffic from the report") ----------
create table if not exists usage_test_markers (
  kind        text not null check (kind in ('username', 'card', 'source_key_prefix')),
  value       text not null check (char_length(value) between 1 and 200),
  note        text check (note is null or char_length(note) <= 300),
  created_at  timestamptz not null default now(),
  primary key (kind, value)
);
alter table usage_test_markers enable row level security;
revoke all on table usage_test_markers from public, anon, authenticated;
grant select, insert, update, delete on table usage_test_markers to service_role;
comment on table usage_test_markers is
  'Spec Kit 029: test traffic, hidden from every usage report view (usage_events_real). kind username = an account (any letter case), card = a HighLevel card id (detail->>opp_id), source_key_prefix = rows whose source_key starts with it. The rows stay in usage_events. Add a row to hide more; delete it to bring them back.';

-- seeded from what the live data shows (read-only, 2026-10-11) — see specs/029-help-asks-and-topics/data-model.md
insert into usage_test_markers (kind, value, note) values
  ('username', 'wimpy.livecheck',            'live check account (verify-wimpy-live)'),
  ('username', 'wimpy.livecheck2',           'live check account'),
  ('username', 'testbot',                    'test account'),
  ('username', '__healthcheck__',            'health-check probe'),
  ('username', '__ping__',                   'probe'),
  ('username', '__probe__',                  'probe'),
  ('username', '__no_such_user_probe__',     'sign-in probe for an unknown user'),
  ('username', 'cb999999',                   'synthetic CB used by checks'),
  ('username', 'wimpy:cb99999',              'synthetic CB used by checks'),
  ('card',     'Hlynw1DovYIRh7I01Tt6',       'Campaign Assistance card used only by verify-cm-assist-e2e (automated test)'),
  ('card',     '3exXcUCLzJWgs9l1rAPo',       'Help card: "TEST from the system check … please ignore"'),
  ('card',     'CEnKfGApqADMBae129zy',       'Help card: "Hi / Test"'),
  ('card',     'Aghp6repsMyK5UUsUeEv',       'Help card: "testing"')
on conflict (kind, value) do nothing;

-- usage_events without test traffic — what every report view reads
create or replace view usage_events_real with (security_invoker = true) as
select e.*
  from usage_events e
  left join ask_topic_effective t on t.topic = e.topic
 where coalesce(t.effective_topic, e.topic, '') <> 'test'
   and not exists (
     select 1 from usage_test_markers m
      where (m.kind = 'username' and lower(e.username) = lower(m.value))
         or (m.kind = 'card' and e.detail->>'opp_id' = m.value)
         or (m.kind = 'source_key_prefix' and starts_with(e.source_key, m.value)));
revoke all on usage_events_real from public, anon, authenticated;
grant select on usage_events_real to service_role;
comment on view usage_events_real is 'Spec Kit 029: usage_events minus test traffic (usage_test_markers + asks whose topic resolves to test). Every report view reads this.';

-- ---------- the words of a CM request written before 029 (once, never restricted) ----------
create or replace function usage_attach_cm_text(p_source_key text, p_text text, p_impact text) returns boolean
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if p_source_key is null or coalesce(btrim(p_text), '') = '' then return false; end if;
  update usage_events
     set detail = coalesce(detail, '{}'::jsonb) || jsonb_build_object('text', left(p_text, 2000))
                  || case when coalesce(btrim(p_impact), '') = '' then '{}'::jsonb else jsonb_build_object('impact', left(p_impact, 600)) end
   where source_key = p_source_key and event = 'cm_request'
     and not coalesce((detail->>'restricted')::boolean, false)
     and coalesce(detail->>'text', '') = '';
  get diagnostics n = row_count;
  return n > 0;
end $$;
revoke execute on function usage_attach_cm_text(text, text, text) from public, anon, authenticated;
grant execute on function usage_attach_cm_text(text, text, text) to service_role;

-- ---------- one row per ask (help ask = agent → team leader; CM request = team leader → campaign manager) ----------
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
       case when e.topic is null then 'Not labelled yet' else coalesce(t.effective_label, e.topic) end as topic_label
  from usage_events_real e
  left join ask_topic_effective t on t.topic = e.topic
 where e.event in ('help_ask', 'cm_request');

-- every ask once per grain: day, week (Monday), month — all SAST
create or replace view ask_event_periods with (security_invoker = true) as
select g.grain, g.period_start, a.*
  from ask_events a
  cross join lateral (values ('day', a.day), ('week', a.week), ('month', a.month)) g (grain, period_start);

-- ---------- 1 · how many agents ask their team leader ----------
create or replace view help_askers_by_period with (security_invoker = true) as
select p.grain, p.period_start,
       count(distinct p.asker)::int as askers, count(*)::int as asks,
       count(*) filter (where p.delivered)::int as delivered, count(*) filter (where not p.delivered)::int as not_delivered,
       count(distinct p.team_leader)::int as team_leaders
  from ask_event_periods p
 where p.source = 'help'
 group by 1, 2;

create or replace view help_askers_by_tl with (security_invoker = true) as
select p.grain, p.period_start, p.team_leader,
       count(distinct p.asker)::int as askers, count(*)::int as asks,
       count(*) filter (where p.delivered)::int as delivered, count(*) filter (where not p.delivered)::int as not_delivered,
       array_agg(distinct p.campaign) filter (where p.campaign is not null) as campaigns
  from ask_event_periods p
 where p.source = 'help'
 group by 1, 2, 3;

create or replace view help_askers_by_campaign with (security_invoker = true) as
select p.grain, p.period_start, p.campaign,
       count(distinct p.asker)::int as askers, count(*)::int as asks,
       count(*) filter (where p.delivered)::int as delivered, count(*) filter (where not p.delivered)::int as not_delivered
  from ask_event_periods p
 where p.source = 'help'
 group by 1, 2, 3;

-- the agents who ask most (their latest name / team leader / campaign in the period)
create or replace view help_top_askers with (security_invoker = true) as
select p.grain, p.period_start, p.asker,
       (array_agg(p.asker_name order by p.at desc, p.id desc))[1] as agent_name,
       (array_agg(p.team_leader order by p.at desc, p.id desc))[1] as team_leader,
       (array_agg(p.campaign order by p.at desc, p.id desc))[1] as campaign,
       count(*)::int as asks, count(*) filter (where p.delivered)::int as delivered,
       rank() over (partition by p.grain, p.period_start order by count(*) desc)::int as rank
  from ask_event_periods p
 where p.source = 'help'
 group by 1, 2, 3;

-- ---------- 2 · how many team leaders ask their campaign manager ----------
-- a merged duplicate is not a second request (it is counted as duplicates_merged); a request that failed to send is
create or replace view cm_askers_by_period with (security_invoker = true) as
select p.grain, p.period_start,
       count(distinct p.asker)::int as team_leaders,
       count(*) filter (where not p.merged)::int as requests,
       count(*) filter (where not p.merged and p.delivered)::int as delivered,
       count(*) filter (where not p.merged and not p.delivered)::int as not_delivered,
       count(*) filter (where p.merged)::int as duplicates_merged
  from ask_event_periods p
 where p.source = 'cm'
 group by 1, 2;

-- per campaign × the campaign manager who HANDLED it: the first action in the request's own round (until the card's next
-- request) by someone who is not the asking team leader. All three campaign managers are assigned to every campaign
-- today, so "responsible" alone would count each request three times; detail->'cms' keeps who was responsible.
create or replace view cm_askers_by_cm with (security_invoker = true) as
with req as (
  select a.id, a.at, a.opp_id, a.team_leader,
         lead(a.at) over (partition by a.opp_id order by a.at, a.id) as next_at
    from ask_events a
   where a.source = 'cm' and not a.merged and a.delivered and a.opp_id is not null
),
handled as (
  select r.id, h.handler
    from req r
    left join lateral (
      select coalesce(x.detail->>'actor', x.username) as handler
        from usage_events_real x
       where x.event = 'cm_action' and x.detail->>'opp_id' = r.opp_id
         and x.at >= r.at and (r.next_at is null or x.at < r.next_at)
         and coalesce(x.role, '') not in ('team_leader', 'agent')
         and coalesce(x.detail->>'actor', x.username) is not null           -- a backfilled note that names nobody is not a handler
         and coalesce(x.detail->>'actor', x.username, '') <> coalesce(r.team_leader, '')
       order by x.at, x.id
       limit 1) h on true
),
reqs as (
  select a.*, case when not a.delivered then 'Not delivered' else coalesce(h.handler, 'Not picked up yet') end as campaign_manager
    from ask_events a
    left join handled h on h.id = a.id
   where a.source = 'cm' and not a.merged
)
select g.grain, g.period_start, r.campaign, r.campaign_manager,
       count(distinct r.asker)::int as team_leaders, count(*)::int as requests,
       count(*) filter (where r.delivered)::int as delivered, count(*) filter (where not r.delivered)::int as not_delivered
  from reqs r
  cross join lateral (values ('day', r.day), ('week', r.week), ('month', r.month)) g (grain, period_start)
 group by 1, 2, 3, 4;

-- ---------- 3 · what is asked most ----------
-- source help · cm · all (both); topics after merges; up to 3 example questions, newest first. A merged CM duplicate is
-- still an ask (the TL asked again); an unlabelled ask is its own row, "Not labelled yet".
create or replace view most_asked_topics with (security_invoker = true) as
with base as (
  select p.grain, p.period_start, s.source, p.topic, p.topic_label, p.asker, p.text, p.at, p.id, p.category
    from ask_event_periods p
    cross join lateral (values (p.source), ('all')) s (source)
),
ex as (
  select b.*, row_number() over (partition by b.grain, b.period_start, b.source, b.topic order by (b.text is null), b.at desc, b.id desc) as rn
    from base b
)
select x.grain, x.period_start, x.source, x.topic, max(x.topic_label) as label,
       count(*)::int as asks, count(distinct x.asker)::int as askers,
       coalesce(array_agg(left(x.text, 200) order by x.at desc, x.id desc) filter (where x.text is not null and x.rn <= 3), '{}'::text[]) as examples,
       array_agg(distinct x.category) filter (where x.category is not null) as categories,
       rank() over (partition by x.grain, x.period_start, x.source order by count(*) desc)::int as rank
  from ex x
 group by 1, 2, 3, 4;

-- the categories agents chose (HELP_CATEGORIES) and the blockages team leaders chose (with cm:blockages' label)
create or replace view most_asked_categories with (security_invoker = true) as
select p.grain, p.period_start, s.source, p.category,
       coalesce(max(b.label), p.category) as label,
       count(*)::int as asks, count(distinct p.asker)::int as askers
  from ask_event_periods p
  cross join lateral (values (p.source), ('all')) s (source)
  left join lateral (
    select bl->>'label' as label
      from rules r
      cross join lateral jsonb_array_elements(case when jsonb_typeof(r.value) = 'array' then r.value else '[]'::jsonb end) bl
     where p.source = 'cm' and r.key = 'cm:blockages' and bl->>'key' = p.category
     limit 1) b on true
 group by 1, 2, 3, 4;

revoke all on ask_topic_effective, ask_events, ask_event_periods, help_askers_by_period, help_askers_by_tl, help_askers_by_campaign,
  help_top_askers, cm_askers_by_period, cm_askers_by_cm, most_asked_topics, most_asked_categories
  from public, anon, authenticated;
grant select on ask_topic_effective, ask_events, ask_event_periods, help_askers_by_period, help_askers_by_tl, help_askers_by_campaign,
  help_top_askers, cm_askers_by_period, cm_askers_by_cm, most_asked_topics, most_asked_categories
  to service_role;

comment on view help_askers_by_period is 'Spec Kit 029: how many agents asked their team leader for help — select * from help_askers_by_period where grain = ''month'' and period_start = date_trunc(''month'', now() at time zone ''Africa/Johannesburg'')::date';
comment on view cm_askers_by_period is 'Spec Kit 029: how many team leaders asked a campaign manager — grain day / week / month';
comment on view most_asked_topics is 'Spec Kit 029: the most asked questions by topic (source help / cm / all) with up to 3 examples — order by rank';

-- ---------- 028's report views, re-issued: identical to migration-061 except that they read usage_events_real ----------
create or replace view usage_daily with (security_invoker = true) as
select (e.at at time zone 'Africa/Johannesburg')::date as day,
       date_trunc('month', e.at at time zone 'Africa/Johannesburg')::date as month,
       e.app, e.event, count(*)::int as events, count(distinct e.username)::int as people
  from usage_events_real e
 group by 1, 2, 3, 4;

create or replace view logins_by_user with (security_invoker = true) as
select (e.at at time zone 'Africa/Johannesburg')::date as day,
       date_trunc('month', e.at at time zone 'Africa/Johannesburg')::date as month,
       e.username, max(e.role) as role,
       count(*) filter (where e.event = 'login_ok')::int as sign_ins,
       count(*) filter (where e.event = 'login_fail')::int as failed_sign_ins,
       count(*) filter (where e.event = 'login_ok' and e.app = 'wimpy')::int as wimpy_sign_ins,
       min(e.at) filter (where e.event = 'login_ok') as first_sign_in,
       max(e.at) filter (where e.event = 'login_ok') as last_sign_in
  from usage_events_real e
 where e.event in ('login_ok', 'login_fail') and e.username is not null
 group by 1, 2, 3;

create or replace view logins_by_user_month with (security_invoker = true) as
select l.month, l.username, max(l.role) as role,
       sum(l.sign_ins)::int as sign_ins, sum(l.failed_sign_ins)::int as failed_sign_ins,
       count(*) filter (where l.sign_ins > 0)::int as days_active,
       min(l.first_sign_in) as first_sign_in, max(l.last_sign_in) as last_sign_in
  from logins_by_user l
 group by 1, 2;

create or replace view app_opens_by_user_app with (security_invoker = true) as
select (e.at at time zone 'Africa/Johannesburg')::date as day,
       date_trunc('month', e.at at time zone 'Africa/Johannesburg')::date as month,
       e.username, max(e.role) as role, e.app,
       count(*)::int as opens,
       count(*) filter (where e.detail->>'via' = 'login')::int as via_login,
       min(e.at) as first_at, max(e.at) as last_at
  from usage_events_real e
 where e.event = 'app_open'
 group by 1, 2, 3, 5;

create or replace view help_by_category with (security_invoker = true) as
select (e.at at time zone 'Africa/Johannesburg')::date as day,
       date_trunc('month', e.at at time zone 'Africa/Johannesburg')::date as month,
       e.category,
       count(*)::int as asks,
       count(*) filter (where coalesce((e.detail->>'delivered')::boolean, true))::int as delivered,
       count(*) filter (where not coalesce((e.detail->>'delivered')::boolean, true))::int as not_delivered,
       count(distinct e.username)::int as agents
  from usage_events_real e
 where e.event = 'help_ask'
 group by 1, 2, 3;

create or replace view help_by_team_leader with (security_invoker = true) as
select (e.at at time zone 'Africa/Johannesburg')::date as day,
       date_trunc('month', e.at at time zone 'Africa/Johannesburg')::date as month,
       e.team_leader, e.category,
       count(*)::int as asks,
       count(*) filter (where coalesce((e.detail->>'delivered')::boolean, true))::int as delivered,
       count(distinct e.username)::int as agents
  from usage_events_real e
 where e.event = 'help_ask'
 group by 1, 2, 3, 4;

create or replace view help_by_campaign with (security_invoker = true) as
select (e.at at time zone 'Africa/Johannesburg')::date as day,
       date_trunc('month', e.at at time zone 'Africa/Johannesburg')::date as month,
       e.campaign, e.category,
       count(*)::int as asks,
       count(*) filter (where coalesce((e.detail->>'delivered')::boolean, true))::int as delivered,
       count(distinct e.username)::int as agents
  from usage_events_real e
 where e.event = 'help_ask'
 group by 1, 2, 3, 4;

create or replace view help_by_agent with (security_invoker = true) as
select (e.at at time zone 'Africa/Johannesburg')::date as day,
       date_trunc('month', e.at at time zone 'Africa/Johannesburg')::date as month,
       e.username, max(e.detail->>'agent_name') as agent_name, max(e.team_leader) as team_leader, max(e.campaign) as campaign,
       e.category,
       count(*)::int as asks,
       count(*) filter (where coalesce((e.detail->>'delivered')::boolean, true))::int as delivered
  from usage_events_real e
 where e.event = 'help_ask'
 group by 1, 2, 3, 7;

-- one row per ask, newest first; each ask's stage is read from ITS OWN round (until the next ask on the same card)
create or replace view help_notes with (security_invoker = true) as
with asks as (
  select e.*, e.detail->>'opp_id' as opp_id,
         lead(e.at) over (partition by e.detail->>'opp_id' order by e.at, e.id) as next_at
    from usage_events_real e
   where e.event = 'help_ask'
)
select a.at, (a.at at time zone 'Africa/Johannesburg')::date as day,
       date_trunc('month', a.at at time zone 'Africa/Johannesburg')::date as month,
       a.username as agent, a.detail->>'agent_name' as agent_name, a.detail->>'cb' as cb,
       a.team_leader, a.campaign, a.category, a.detail->>'note' as note,
       coalesce((a.detail->>'delivered')::boolean, true) as delivered, a.detail->>'error' as error, a.opp_id,
       s.category as last_stage, s.at as last_stage_at
  from asks a
  left join lateral (
    select x.category, x.at from usage_events_real x
     where a.opp_id is not null and x.event = 'help_stage' and x.detail->>'opp_id' = a.opp_id
       and x.at >= a.at and (a.next_at is null or x.at < a.next_at)
     order by x.at desc, x.id desc limit 1) s on true
 order by a.at desc;

create or replace view help_answer_times with (security_invoker = true) as
with asks as (
  select e.*, e.detail->>'opp_id' as opp_id,
         lead(e.at) over (partition by e.detail->>'opp_id' order by e.at, e.id) as next_at
    from usage_events_real e
   where e.event = 'help_ask' and e.detail->>'opp_id' is not null
     and coalesce((e.detail->>'delivered')::boolean, true)
)
select a.at, (a.at at time zone 'Africa/Johannesburg')::date as day,
       date_trunc('month', a.at at time zone 'Africa/Johannesburg')::date as month,
       a.opp_id, a.username as agent, a.team_leader, a.campaign, a.category,
       r.at as first_response_at, r.by as first_response_by,
       round(extract(epoch from (r.at - a.at)) / 60.0, 1) as minutes_to_first_response,
       c.at as closed_at,
       round(extract(epoch from (c.at - a.at)) / 60.0, 1) as minutes_to_close,
       (r.at is not null) as answered
  from asks a
  left join lateral (
    select x.at, x.detail->>'by' as by from usage_events_real x
     where x.event = 'help_stage' and x.detail->>'opp_id' = a.opp_id and coalesce(x.detail->>'by', '') not in ('agent', 'backfill')   -- a backfilled reading never claims who answered
       and x.at >= a.at and (a.next_at is null or x.at < a.next_at)
     order by x.at, x.id limit 1) r on true
  left join lateral (
    select x.at from usage_events_real x
     where x.event = 'help_stage' and x.detail->>'opp_id' = a.opp_id and coalesce((x.detail->>'closed')::boolean, false)
       and x.at >= a.at and (a.next_at is null or x.at < a.next_at)
     order by x.at, x.id limit 1) c on true;

-- one row per campaign-manager request (a merged duplicate is counted on it, not as a second request). A request that
-- failed to send is a row of its own, status 'Not delivered' with the reason (Nick, 2026-10-11: "Yes, record them as
-- not delivered"); it never cuts the round of the card it was refused against.
create or replace view cm_requests with (security_invoker = true) as
with req as (
  select e.*, e.detail->>'opp_id' as opp_id,
         coalesce((e.detail->>'delivered')::boolean, true) as ok,
         lead(e.at) over (partition by e.detail->>'opp_id', coalesce((e.detail->>'delivered')::boolean, true) order by e.at, e.id) as next_at
    from usage_events_real e
   where e.event = 'cm_request' and not coalesce((e.detail->>'merged')::boolean, false)
)
select r.at as requested_at, (r.at at time zone 'Africa/Johannesburg')::date as day,
       date_trunc('month', r.at at time zone 'Africa/Johannesburg')::date as month,
       r.opp_id, r.username, r.team_leader, r.campaign, r.category as blockage,
       r.detail->>'priority' as priority, coalesce((r.detail->>'restricted')::boolean, false) as restricted,
       coalesce(d.n, 0)::int as duplicates_merged,
       coalesce(x.actions, 0)::int as actions, x.first_action_at, x.started_at, x.last_action, x.last_action_at,
       case when not r.ok then 'Not delivered'
            when x.last_resolved then 'Resolved'
            when x.started_at is not null or x.last_started then 'Assisting'
            when coalesce(x.actions, 0) > 0 then 'Triaged'
            else 'New' end as status,
       r.ok as delivered, left(r.detail->>'error', 120) as error
  from req r
  left join lateral (
    select count(*) as n from usage_events_real m
     where r.ok and m.event = 'cm_request' and coalesce((m.detail->>'merged')::boolean, false) and m.detail->>'opp_id' = r.opp_id
       and m.at >= r.at and (r.next_at is null or m.at < r.next_at)) d on true
  left join lateral (
    select count(*) as actions, min(y.at) as first_action_at,
           min(y.at) filter (where y.category = 'start') as started_at,
           (array_agg(y.category order by y.at desc, y.id desc))[1] as last_action,
           max(y.at) as last_action_at,
           (array_agg(coalesce((y.detail->>'resolved')::boolean, false) order by y.at desc, y.id desc))[1] as last_resolved,
           (array_agg(coalesce((y.detail->>'started')::boolean, false) order by y.at desc, y.id desc))[1] as last_started
      from usage_events_real y
     where r.ok and y.event = 'cm_action' and y.detail->>'opp_id' = r.opp_id
       and y.at >= r.at and (r.next_at is null or y.at < r.next_at)) x on true;

-- campaign-manager requests per SAST day × blockage: how many, how many reached the campaign manager, how many did not
create or replace view cm_request_summary with (security_invoker = true) as
select c.day, c.month, c.blockage,
       count(*)::int as requests,
       count(*) filter (where c.delivered)::int as delivered,
       count(*) filter (where not c.delivered)::int as not_delivered
  from cm_requests c
 group by 1, 2, 3;

create or replace view ask_ai_by_user with (security_invoker = true) as
select (e.at at time zone 'Africa/Johannesburg')::date as day,
       date_trunc('month', e.at at time zone 'Africa/Johannesburg')::date as month,
       e.username, max(e.role) as role, e.app,
       count(*)::int as questions, min(e.at) as first_at, max(e.at) as last_at
  from usage_events_real e
 where e.event = 'ai_question'
 group by 1, 2, 3, 5;

create or replace view ai_questions with (security_invoker = true) as
select e.at, (e.at at time zone 'Africa/Johannesburg')::date as day, e.username, e.role, e.app,
       e.detail->>'question' as question, e.detail->>'model' as model
  from usage_events_real e
 where e.event = 'ai_question'
 order by e.at desc;

revoke all on usage_daily, logins_by_user, logins_by_user_month, app_opens_by_user_app, help_by_category, help_by_team_leader,
  help_by_campaign, help_by_agent, help_notes, help_answer_times, cm_requests, cm_request_summary, ask_ai_by_user, ai_questions
  from public, anon, authenticated;
grant select on usage_daily, logins_by_user, logins_by_user_month, app_opens_by_user_app, help_by_category, help_by_team_leader,
  help_by_campaign, help_by_agent, help_notes, help_answer_times, cm_requests, cm_request_summary, ask_ai_by_user, ai_questions
  to service_role;
