-- migration-061 · the usage report — one table you can query in Supabase (Spec Kit 028-usage-report, 2026-10-11)
--
-- Nick: "I need you to create me a table in supabase so we can see how many times users ask for request, how many times
-- users login in to the software, basically we want to query supabase and make a usage report, see what users ask their
-- team leader most of the time etc".
--
-- usage_events is APPEND-ONLY: one row per thing a person did. Three writers, one shape:
--   · source 'auth_log'  — every auth_log row (sign-in ok/fail, sign-out, password change, account admin) is mirrored by
--                          the AFTER INSERT trigger below — the suite's sign-ins AND the Wimpy service's. ONE mapping
--                          (usage_auth_event) serves the trigger and the backfill, so the two can never disagree with
--                          auth_log (SC-003). auth_log itself is unchanged and stays the audit + lockout record.
--   · source 'worker'    — what only the Worker sees (worker/src/usage.mjs): app opens, help asks (topic + the agent's
--                          note + their team leader + campaign, delivered or not), help stage moves, campaign-manager
--                          requests/actions (never the request text), AI questions.
--   · source 'backfill'  — tools/usage-backfill.mjs (dry run by default): CM mirror rows, ask_log, the HighLevel Help
--                          pipeline. Live and backfilled rows share deterministic source_keys → ON CONFLICT DO NOTHING.
--
-- Locked down like every table here: RLS ON with NO policies; everything revoked from public/anon/authenticated;
-- service_role may SELECT and INSERT only (append-only — no UPDATE/DELETE). Views are security_invoker with the same
-- grants. Every function: search_path pinned, EXECUTE revoked from public/anon/authenticated (migration-049's rule).
-- Days in every view are SAST (Africa/Johannesburg) — the weekday is decided in Johannesburg, not UTC.
--
-- NOT APPLIED. Apply at release, with Nick's go-ahead, BEFORE the Worker that writes to it is deployed:
--   node tools/apply-migration.mjs supabase/migration-061-usage-events.sql
-- then: node tools/usage-backfill.mjs  (dry)  →  node tools/usage-backfill.mjs --apply
-- Safe to re-run. Creating it copies nothing: history arrives only through the backfill.

create table if not exists usage_events (
  id           bigserial primary key,
  at           timestamptz not null default now(),
  user_id      uuid,                                   -- app_users.id at the time; NO foreign key: a leaver's history stays
  username     text check (username is null or char_length(username) <= 80),
  role         text check (role is null or char_length(role) <= 40),
  app          text check (app is null or app in ('vas', 'ops', 'agent', 'tracker', 'wimpy', 'worker')),
  event        text not null check (char_length(event) <= 40),
  category     text check (category is null or char_length(category) <= 120),
  team_leader  text check (team_leader is null or char_length(team_leader) <= 120),
  campaign     text check (campaign is null or char_length(campaign) <= 120),
  detail       jsonb,
  source       text not null default 'worker' check (source in ('worker', 'auth_log', 'backfill')),
  source_key   text unique                             -- the idempotency key shared by the live write and the backfill
);
create index if not exists usage_events_at_idx on usage_events (at);
create index if not exists usage_events_event_at_idx on usage_events (event, at);
create index if not exists usage_events_username_at_idx on usage_events (username, at);
create index if not exists usage_events_tl_at_idx on usage_events (team_leader, at) where team_leader is not null;
create index if not exists usage_events_opp_idx on usage_events ((detail->>'opp_id'), at) where event in ('help_ask', 'help_stage', 'cm_request', 'cm_action');

alter table usage_events enable row level security;
revoke all on table usage_events from public, anon, authenticated;
revoke all on sequence usage_events_id_seq from public, anon, authenticated;
grant select, insert on table usage_events to service_role;
grant usage, select on sequence usage_events_id_seq to service_role;

comment on table usage_events is
  'Spec Kit 028: one row per thing a person did (sign-in, app open, help ask, help stage move, campaign-manager request/action, AI question). Append-only. source auth_log = mirrored by trigger; worker = worker/src/usage.mjs; backfill = tools/usage-backfill.mjs. Query the usage_* / logins_* / help_* / cm_* / ai_* views.';

-- ---------- the ONE auth_log mapping ----------
create or replace function usage_auth_event(p_event text, out event text, out category text, out app text)
language sql immutable set search_path = public as $$
  select
    case
      when p_event = 'login_ok' or starts_with(p_event, 'login_ok:') or p_event = 'wimpy_signin_ok' then 'login_ok'
      when starts_with(p_event, 'login_fail') or p_event = 'locked' or starts_with(p_event, 'locked:')
        or starts_with(p_event, 'wimpy_signin_fail') or starts_with(p_event, 'wimpy_signin_refused') then 'login_fail'
      when p_event = 'logout' or starts_with(p_event, 'logout:') then 'logout'
      when starts_with(p_event, 'password_change') or starts_with(p_event, 'wimpy_password_change')
        or starts_with(p_event, 'pw_change') or starts_with(p_event, 'password_reset') then 'password_change'
      else 'account_admin'
    end,
    case
      when starts_with(p_event, 'login_fail:wimpy:') then nullif(left(substr(p_event, 18), 120), '')   -- clamped: a long reason must not trip the check
      when starts_with(p_event, 'login_fail:') then nullif(left(substr(p_event, 12), 120), '')
      when p_event = 'locked' or starts_with(p_event, 'locked:') then 'locked'
      when starts_with(p_event, 'wimpy_signin_refused:') then nullif(left(substr(p_event, 22), 120), '')
      when starts_with(p_event, 'wimpy_signin_fail') or starts_with(p_event, 'wimpy_signin_refused') or p_event = 'login_fail' then 'failed'
      when starts_with(p_event, 'password_reset') or starts_with(p_event, 'pw_change:bulk_reset') then 'reset'
      when starts_with(p_event, 'password_change') or starts_with(p_event, 'wimpy_password_change') or starts_with(p_event, 'pw_change') then 'change'
      when p_event = 'login_ok' or starts_with(p_event, 'login_ok:') or p_event = 'wimpy_signin_ok' or p_event = 'logout' or starts_with(p_event, 'logout:') then null
      else left(split_part(p_event, ':', 1), 120)
    end,
    case when position('wimpy' in p_event) > 0 then 'wimpy' else 'worker' end
$$;

-- mirrors auth_log rows p_min_id..p_max_id that are not yet mirrored → how many it added. The trigger calls it for one
-- id; the backfill (tools/usage-backfill.mjs --apply) for all of them.
create or replace function usage_mirror_auth_log(p_min_id bigint, p_max_id bigint) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  insert into usage_events (at, user_id, username, role, app, event, category, detail, source, source_key)
  select coalesce(a.at, now()), a.user_id, left(a.username, 80), u.role, m.app, m.event, m.category,
         jsonb_build_object('auth_event', a.event), 'auth_log', 'auth_log:' || a.id
    from auth_log a
    cross join lateral usage_auth_event(a.event) m
    left join app_users u on u.id = a.user_id
   where a.id between p_min_id and p_max_id
  on conflict (source_key) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- THE REPORT NEVER FAILS A SIGN-IN: any error here is swallowed with a WARNING, so the auth_log insert — which the
-- lockout counts failures from (worker/src/auth.mjs checkPassword) — always lands.
create or replace function usage_from_auth_log() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    perform usage_mirror_auth_log(new.id, new.id);
  exception when others then
    raise warning 'usage_from_auth_log: % (auth_log id %)', sqlerrm, new.id;
  end;
  return null;
end $$;

drop trigger if exists auth_log_to_usage on auth_log;
create trigger auth_log_to_usage after insert on auth_log for each row execute function usage_from_auth_log();

revoke execute on function usage_auth_event(text) from public, anon, authenticated;
revoke execute on function usage_mirror_auth_log(bigint, bigint) from public, anon, authenticated;
revoke execute on function usage_from_auth_log() from public, anon, authenticated;
grant execute on function usage_mirror_auth_log(bigint, bigint) to service_role;

-- ---------- the report views (day / month are SAST) ----------
create or replace view usage_daily with (security_invoker = true) as
select (e.at at time zone 'Africa/Johannesburg')::date as day,
       date_trunc('month', e.at at time zone 'Africa/Johannesburg')::date as month,
       e.app, e.event, count(*)::int as events, count(distinct e.username)::int as people
  from usage_events e
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
  from usage_events e
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
  from usage_events e
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
  from usage_events e
 where e.event = 'help_ask'
 group by 1, 2, 3;

create or replace view help_by_team_leader with (security_invoker = true) as
select (e.at at time zone 'Africa/Johannesburg')::date as day,
       date_trunc('month', e.at at time zone 'Africa/Johannesburg')::date as month,
       e.team_leader, e.category,
       count(*)::int as asks,
       count(*) filter (where coalesce((e.detail->>'delivered')::boolean, true))::int as delivered,
       count(distinct e.username)::int as agents
  from usage_events e
 where e.event = 'help_ask'
 group by 1, 2, 3, 4;

create or replace view help_by_campaign with (security_invoker = true) as
select (e.at at time zone 'Africa/Johannesburg')::date as day,
       date_trunc('month', e.at at time zone 'Africa/Johannesburg')::date as month,
       e.campaign, e.category,
       count(*)::int as asks,
       count(*) filter (where coalesce((e.detail->>'delivered')::boolean, true))::int as delivered,
       count(distinct e.username)::int as agents
  from usage_events e
 where e.event = 'help_ask'
 group by 1, 2, 3, 4;

create or replace view help_by_agent with (security_invoker = true) as
select (e.at at time zone 'Africa/Johannesburg')::date as day,
       date_trunc('month', e.at at time zone 'Africa/Johannesburg')::date as month,
       e.username, max(e.detail->>'agent_name') as agent_name, max(e.team_leader) as team_leader, max(e.campaign) as campaign,
       e.category,
       count(*)::int as asks,
       count(*) filter (where coalesce((e.detail->>'delivered')::boolean, true))::int as delivered
  from usage_events e
 where e.event = 'help_ask'
 group by 1, 2, 3, 7;

-- one row per ask, newest first; each ask's stage is read from ITS OWN round (until the next ask on the same card)
create or replace view help_notes with (security_invoker = true) as
with asks as (
  select e.*, e.detail->>'opp_id' as opp_id,
         lead(e.at) over (partition by e.detail->>'opp_id' order by e.at, e.id) as next_at
    from usage_events e
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
    select x.category, x.at from usage_events x
     where a.opp_id is not null and x.event = 'help_stage' and x.detail->>'opp_id' = a.opp_id
       and x.at >= a.at and (a.next_at is null or x.at < a.next_at)
     order by x.at desc, x.id desc limit 1) s on true
 order by a.at desc;

create or replace view help_answer_times with (security_invoker = true) as
with asks as (
  select e.*, e.detail->>'opp_id' as opp_id,
         lead(e.at) over (partition by e.detail->>'opp_id' order by e.at, e.id) as next_at
    from usage_events e
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
    select x.at, x.detail->>'by' as by from usage_events x
     where x.event = 'help_stage' and x.detail->>'opp_id' = a.opp_id and coalesce(x.detail->>'by', '') not in ('agent', 'backfill')   -- a backfilled reading never claims who answered
       and x.at >= a.at and (a.next_at is null or x.at < a.next_at)
     order by x.at, x.id limit 1) r on true
  left join lateral (
    select x.at from usage_events x
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
    from usage_events e
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
    select count(*) as n from usage_events m
     where r.ok and m.event = 'cm_request' and coalesce((m.detail->>'merged')::boolean, false) and m.detail->>'opp_id' = r.opp_id
       and m.at >= r.at and (r.next_at is null or m.at < r.next_at)) d on true
  left join lateral (
    select count(*) as actions, min(y.at) as first_action_at,
           min(y.at) filter (where y.category = 'start') as started_at,
           (array_agg(y.category order by y.at desc, y.id desc))[1] as last_action,
           max(y.at) as last_action_at,
           (array_agg(coalesce((y.detail->>'resolved')::boolean, false) order by y.at desc, y.id desc))[1] as last_resolved,
           (array_agg(coalesce((y.detail->>'started')::boolean, false) order by y.at desc, y.id desc))[1] as last_started
      from usage_events y
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
  from usage_events e
 where e.event = 'ai_question'
 group by 1, 2, 3, 5;

create or replace view ai_questions with (security_invoker = true) as
select e.at, (e.at at time zone 'Africa/Johannesburg')::date as day, e.username, e.role, e.app,
       e.detail->>'question' as question, e.detail->>'model' as model
  from usage_events e
 where e.event = 'ai_question'
 order by e.at desc;

revoke all on usage_daily, logins_by_user, logins_by_user_month, app_opens_by_user_app, help_by_category, help_by_team_leader,
  help_by_campaign, help_by_agent, help_notes, help_answer_times, cm_requests, cm_request_summary, ask_ai_by_user, ai_questions
  from public, anon, authenticated;
grant select on usage_daily, logins_by_user, logins_by_user_month, app_opens_by_user_app, help_by_category, help_by_team_leader,
  help_by_campaign, help_by_agent, help_notes, help_answer_times, cm_requests, cm_request_summary, ask_ai_by_user, ai_questions
  to service_role;

comment on view logins_by_user_month is 'Spec Kit 028: sign-ins per person per SAST month — select * from logins_by_user_month where month = date_trunc(''month'', now() at time zone ''Africa/Johannesburg'')::date order by sign_ins desc';
comment on view help_by_team_leader is 'Spec Kit 028: what agents ask their team leader — help asks per SAST day × team leader × topic';
comment on view help_notes is 'Spec Kit 028: every help ask newest first with the agent''s note, team leader, campaign, delivered or not, and the card''s stage in that ask''s round';
