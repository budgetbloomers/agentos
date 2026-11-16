-- AgentOS usage export — READ-ONLY. Paste into the Supabase SQL editor and run.
-- Returns ONE row, ONE column (usage_export): a JSON document. Save that cell as
-- reports/usage/usage-export.json (gitignored) and run
--   node tools/usage-report.mjs --export reports/usage/usage-export.json
-- to get the PDF in reports/usage/out/ (or hand the file to Claude).
--
-- Nothing here writes, and password hashes / session tokens are never selected.
-- Dates are bucketed in Africa/Johannesburg (SAST), not UTC.
-- Window: 1 Sep 2026 to now — change the date on the `params` line to widen/narrow it.
with params as (select timestamptz '2026-09-01 00:00:00+02' as since),

users as (
  select id, username, full_name, role, team, apps, active, cb,
         password_is_default, password_changed_at, last_login, created_at
  from app_users
),

logins as (                          -- every auth event, per user per SAST day
  select coalesce(u.username, a.username) as username,
         a.event,
         (a.at at time zone 'Africa/Johannesburg')::date as day,
         count(*) as n,
         min((a.at at time zone 'Africa/Johannesburg')::time) as first_at,
         max((a.at at time zone 'Africa/Johannesburg')::time) as last_at
  from auth_log a left join app_users u on u.id = a.user_id, params p
  where a.at >= p.since
  group by 1, 2, 3
),

saves as (                           -- acknowledged state saves, per user per key per day
  select username, key,
         (at at time zone 'Africa/Johannesburg')::date as day,
         count(*) as n, sum(bytes) as bytes
  from kv_write_log, params p
  where at >= p.since
  group by 1, 2, 3
),

live_sessions as (                   -- who holds an unexpired session right now
  select u.username, s.scope, count(*) as n, max(s.created_at) as newest
  from app_sessions s join app_users u on u.id = s.user_id
  where s.expires_at > now()
  group by 1, 2
)

select json_build_object(
  'generated_at', now(),
  'since',        (select since from params),
  'users',        (select coalesce(json_agg(u order by u.role, u.username), '[]') from users u),
  'logins',       (select coalesce(json_agg(l order by l.day, l.username), '[]') from logins l),
  'saves',        (select coalesce(json_agg(s order by s.day, s.username), '[]') from saves s),
  'live_sessions',(select coalesce(json_agg(x), '[]') from live_sessions x),
  'app_opened',   (select value from rules where key = 'kv:app-opened'),
  'roster',       (select coalesce(json_agg(json_build_object(          -- the adoption denominator
                     'cb', cb, 'name', agent_name, 'campaign', campaign, 'tenure', tenure,
                     'team_leader', team_leader, 'username', username, 'has_account', has_account,
                     'list_as_of', list_as_of) order by team_leader, cb), '[]') from active_agents)
) as usage_export;
