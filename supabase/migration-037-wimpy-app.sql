-- migration-037-wimpy-app.sql
-- WIMPY ORDERING BECOMES ITS OWN APP (Nick, 2026-09-10; specs/wimpy-vas-apps-plan.md).
--
-- Three things the database has to hold for it:
--
--   1. A SESSION SCOPE. The Wimpy app signs people in with their CB number and NO password.
--      A session minted that way must buy lunch and nothing else, so app_sessions gains
--      `scope`: 'full' (every session that exists today, and every password login) or
--      'wimpy' (the CB-only sign-in). The Worker refuses a 'wimpy' session on every route
--      outside /api/wimpy/*, /api/me and /api/logout — see worker/src/index.mjs.
--
--   2. THE APP GRANT FOLLOWS THE AGENT LIST. "When the agent list is uploaded it must update
--      the logins for this app": an account is what the sign-in looks up, and accounts already
--      follow the list (sync_agent_list, sync_team_leaders — created on publish, deleted for
--      leavers). What is new is the `wimpy` entry in apps: a trigger adds it to every account
--      as it is created, and the backfill below adds it to every existing active account —
--      everyone orders, management included (Nick).
--
--   3. A SENTENCE-CHECK. agent_list_integrity gains a row: an active agent login without the
--      Wimpy app. Warning, not critical — lunch is not a POPIA incident.

-- ---- 1 · session scope ----------------------------------------------------------------------
alter table app_sessions add column if not exists scope text not null default 'full';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'app_sessions_scope_chk') then
    alter table app_sessions add constraint app_sessions_scope_chk check (scope in ('full', 'wimpy'));
  end if;
end $$;
comment on column app_sessions.scope is
  'full = a password login (reaches everything its role allows); wimpy = the CB-only Wimpy sign-in, refused by the Worker outside /api/wimpy/*.';

-- ---- 2 · the Wimpy grant ------------------------------------------------------------------
-- Every account gets it at birth. sync_agent_list / sync_team_leaders / provisioning tools
-- keep inserting apps ['agent'] as they always have; the trigger appends 'wimpy' so no
-- function has to be re-declared for a lunch menu.
create or replace function app_users_grant_wimpy() returns trigger
language plpgsql as $$
begin
  if new.apps is null then new.apps := array[]::text[]; end if;
  if not ('wimpy' = any (new.apps)) then new.apps := array_append(new.apps, 'wimpy'); end if;
  return new;
end $$;
drop trigger if exists app_users_grant_wimpy on app_users;
create trigger app_users_grant_wimpy before insert on app_users
  for each row execute function app_users_grant_wimpy();
comment on function app_users_grant_wimpy is 'Every new account is born with the Wimpy app (migration-037): the CB-only sign-in looks apps up, and everyone orders.';

-- The backfill: every active account that exists today.
update app_users set apps = array_append(coalesce(apps, array[]::text[]), 'wimpy')
where  active and not ('wimpy' = any (coalesce(apps, array[]::text[])));

-- ---- 3 · the integrity row ----------------------------------------------------------------
-- Restated whole (a view cannot grow a row in place); the six rows above the new one are
-- migration-020's, unchanged.
create or replace view agent_list_integrity as
with cur as (select * from agent_list_current),
     rec as (select value->>'fingerprint' as fp from rules where key = 'kv:roster-current'),
     last_ok as (select fingerprint from agent_sync_logs where status = 'SUCCESS' and fingerprint is not null
                 order by created_at desc limit 1)
select 'agent on the latest list with no active login'::text as check_name, 'critical'::text as severity,
       count(*)::int as failures,
       left(string_agg(list_code || ' ' || coalesce(agent_name, ''), ', ' order by list_code), 300) as detail
from   active_agents where not has_account or not coalesce(account_active, false)
union all
select 'agent login that is not on the latest list', 'critical', count(*)::int,
       left(string_agg(u.username, ', ' order by u.username), 300)
from   app_users u
where  u.role = 'agent' and norm_cb(u.cb) is not null
  and  not exists (select 1 from cur l where norm_cb(l.employee_code) = norm_cb(u.cb))
union all
select 'campaign on the latest list that does not exist', 'critical', count(*)::int,
       left(string_agg(c.label, ', ' order by c.label), 300)
from   (select campaign_key(campaign) as key, min(btrim(campaign)) as label from cur
        where campaign_key(campaign) is not null group by campaign_key(campaign)) c
where  not exists (select 1 from campaigns k where k.key = c.key and k.active)
union all
select 'campaign that the latest list does not carry', 'critical', count(*)::int,
       left(string_agg(k.label, ', ' order by k.label), 300)
from   campaigns k
where  not exists (select 1 from cur l where campaign_key(l.campaign) = k.key)
union all
select 'team leader on the latest list with no login', 'warning', count(*)::int,
       left(string_agg(t.leader, ', ' order by t.leader), 300)
from   (select distinct btrim(team_leader) as leader from cur where coalesce(btrim(team_leader), '') <> '') t
where  not exists (select 1 from app_users u where u.role = 'team_leader' and u.active
                     and (btrim(coalesce(u.team, '')) = t.leader or btrim(coalesce(u.full_name, '')) = t.leader))
union all
select 'roster of record is the last synchronised list', 'critical',
       case when (select fp from rec) is distinct from (select fingerprint from last_ok) then 1 else 0 end,
       'record ' || coalesce((select fp from rec), '(none)') || ' vs synced ' || coalesce((select fingerprint from last_ok), '(none)')
union all
select 'active agent login without the Wimpy app', 'warning', count(*)::int,
       left(string_agg(u.username, ', ' order by u.username), 300)
from   app_users u
where  u.active and u.role in ('agent', 'team_leader') and not ('wimpy' = any (coalesce(u.apps, array[]::text[])));
comment on view agent_list_integrity is
  'Does the latest Agent List agree with the logins, the campaigns and the roster of record? failures > 0 on any row = the agent-list-out-of-sync alert. Critical rows mean a person or campaign is missing or lingering; the leader row and the Wimpy row are warnings.';
