-- ============================================================================
-- migration-018-team-leader-accounts.sql
--
-- ACCOUNTS FOLLOW THE AGENT LIST — FOR LEADERS TOO.
--
-- migration-014 made this true for agents: on the latest valid list ⇒ an active
-- account with current details; off it ⇒ no account, in one transaction, with
-- four fail-closed guards. It deliberately stopped at leaders, and said why:
-- "the list carries a leader's NAME and no CB, so an account for a leader cannot
-- be created from it without making up a login." That was the right call then.
-- It left a real gap now (Nick, 2026-08-31): a leader who stops leading anyone
-- keeps their sign-in for ever, because nothing was allowed to remove it.
--
-- Live proof, on the list as it stands: 8 leaders are named on it, 9 leader
-- accounts exist. Nikita Baijnath (cb230) and Hloniphile Jojo (cb100) lead
-- nobody and can still sign in. Hezron Pillay leads a team and has no account.
--
-- WHAT MAKES THIS SAFE NOW: THE NAME→CB MAP IS A TABLE, NOT A GUESS.
-- specs/team_leader_cbs.json has carried the mapping for months; it becomes
-- team_leader_cbs here, seeded by tools/sync-team-leaders.mjs. A leader is only
-- ever created from a CB somebody wrote down. A leader with no CB on file
-- (Hezron today) is REPORTED, never invented — the same doctrine as 014.
--
-- EVIDENCE FOR EACH DIRECTION, AND THEY ARE DIFFERENT:
--   create  — named as team_leader on the current list AND has a CB in the map.
--   remove  — holds role 'team_leader' and leads NOBODY on the current list.
--             That is derivable from the list alone and needs no map, which is
--             why an empty map can never cause a deletion.
--
-- GUARDS, ALL FAIL-CLOSED, MIRRORING 014:
--   * a list under p_min_roster rows is a broken pull, not a walkout — refuse whole
--   * more than p_max_delete leader removals in one run is refused whole
--   * only role = 'team_leader' is ever touched; admins, execs, QA, campaign
--     managers and agents are never in scope, even if they lead a team
--   * p_apply defaults to FALSE: the function plans by default and writes only
--     when asked, so the tool can show the plan before anything happens
--   * NEEDS_HASHES: Postgres cannot do WebCrypto PBKDF2, so a creation returns
--     the CB numbers needing hashes and writes NOTHING; the caller hashes and
--     calls again. Never teach pgcrypto a second password scheme (014's rule).
--
-- A removed account destroys no history: app_sessions cascades (a leaver must be
-- signed out) and auth_log has no FK, so their sign-in trail survives.
--
-- SAFE TO RUN TWICE.
-- ============================================================================

-- ------------------------------------------------------- team_leader_cbs
-- The mapping that makes a leader account possible at all. One row per leader,
-- keyed on the NAME exactly as the Agent List spells it in its team_leader
-- column — that string is the only join the list gives us.
create table if not exists team_leader_cbs (
  leader_name    text primary key,
  employee_code  text,                       -- null/'' = known leader, no CB yet (Hezron)
  updated_by     text,
  updated_at     timestamptz not null default now()
);

comment on table team_leader_cbs is
  'Team leader name → CB number, seeded from specs/team_leader_cbs.json by tools/sync-team-leaders.mjs. The Agent List names a leader but never carries their code, so this is the only thing that makes a leader login creatable rather than invented. A row with no employee_code is a leader we know about and cannot provision — reported, never guessed.';

alter table team_leader_cbs enable row level security;

-- ------------------------------------------------------ sync_team_leaders
create or replace function sync_team_leaders(
  p_hashes        jsonb   default '{}'::jsonb,   -- {"CB6": "pbkdf2h$100000$..."}
  p_actor         text    default 'system',
  p_apply         boolean default false,
  p_min_roster    int     default 25,
  p_max_delete    int     default 3
) returns jsonb
language plpgsql
security definer
set search_path = public
as $tl$
declare
  v_roster    int;
  v_created   jsonb := '[]'::jsonb;
  v_removed   jsonb := '[]'::jsonb;
  v_unrep     jsonb := '[]'::jsonb;
  v_need      jsonb := '[]'::jsonb;
  v_ndel      int;
begin
  -- The list has to be real before it is allowed to remove anyone's sign-in.
  select count(*) into v_roster from agent_list_current;
  if v_roster < p_min_roster then
    return jsonb_build_object('status', 'REFUSED', 'reason', 'roster_too_small',
      'roster', v_roster, 'min', p_min_roster,
      'detail', format('the current list holds %s rows, under the floor of %s — a broken pull, not a floor that emptied', v_roster, p_min_roster));
  end if;

  -- Who leads somebody on the list as it stands.
  create temp table _tl_on_list on commit drop as
  select distinct btrim(team_leader) as leader_name
  from   agent_list_current
  where  coalesce(btrim(team_leader), '') <> '';

  -- Leaders on the list with a CB on file and no account yet.
  create temp table _tl_create on commit drop as
  select l.leader_name, norm_cb(m.employee_code) as cb
  from   _tl_on_list l
  join   team_leader_cbs m on btrim(m.leader_name) = l.leader_name
  where  coalesce(btrim(m.employee_code), '') <> ''
    and  norm_cb(m.employee_code) is not null
    and  not exists (select 1 from app_users u where norm_cb(u.cb) = norm_cb(m.employee_code))
    and  not exists (select 1 from app_users u where u.role = 'team_leader'
                       and btrim(coalesce(u.team, '')) = l.leader_name);

  -- Leaders on the list we cannot provision: no row in the map, or no CB in it.
  select coalesce(jsonb_agg(l.leader_name order by l.leader_name), '[]'::jsonb) into v_unrep
  from   _tl_on_list l
  left   join team_leader_cbs m on btrim(m.leader_name) = l.leader_name
  where  coalesce(btrim(m.employee_code), '') = ''
    and  not exists (select 1 from app_users u where u.role = 'team_leader'
                       and btrim(coalesce(u.team, '')) = l.leader_name);

  -- Accounts to remove: a team leader who leads nobody on the current list.
  create temp table _tl_remove on commit drop as
  select u.id, u.username, u.full_name, btrim(coalesce(u.team, '')) as team
  from   app_users u
  where  u.role = 'team_leader'
    and  not exists (select 1 from _tl_on_list l where l.leader_name = btrim(coalesce(u.team, '')));

  select count(*) into v_ndel from _tl_remove;
  if v_ndel > p_max_delete then
    return jsonb_build_object('status', 'REFUSED', 'reason', 'too_many_removals',
      'would_remove', v_ndel, 'max', p_max_delete,
      'detail', format('%s leader accounts would be removed in one run, over the cap of %s — check the list before letting this through', v_ndel, p_max_delete),
      'removals', (select coalesce(jsonb_agg(jsonb_build_object('username', username, 'name', full_name, 'team', team) order by username), '[]'::jsonb) from _tl_remove));
  end if;

  -- Creations need a hash each, and Postgres cannot make one.
  select coalesce(jsonb_agg(c.cb order by c.cb), '[]'::jsonb) into v_need
  from   _tl_create c
  where  not (p_hashes ? c.cb);

  if jsonb_array_length(v_need) > 0 then
    return jsonb_build_object('status', 'NEEDS_HASHES', 'needs_hashes', v_need,
      'would_create', (select coalesce(jsonb_agg(jsonb_build_object('cb', cb, 'name', leader_name) order by cb), '[]'::jsonb) from _tl_create),
      'would_remove', (select coalesce(jsonb_agg(jsonb_build_object('username', username, 'name', full_name, 'team', team) order by username), '[]'::jsonb) from _tl_remove),
      'unrepresented', v_unrep, 'applied', false);
  end if;

  -- PLAN ONLY unless asked. Same posture as sync_agent_list.
  if not p_apply then
    return jsonb_build_object('status', 'PLAN',
      'on_list', (select count(*) from _tl_on_list),
      'would_create', (select coalesce(jsonb_agg(jsonb_build_object('cb', cb, 'name', leader_name) order by cb), '[]'::jsonb) from _tl_create),
      'would_remove', (select coalesce(jsonb_agg(jsonb_build_object('username', username, 'name', full_name, 'team', team) order by username), '[]'::jsonb) from _tl_remove),
      'unrepresented', v_unrep, 'applied', false);
  end if;

  -- CREATE. Username IS the CB number, lower-cased like every other login here;
  -- apps ['agent'] is what opens Agent Analytics, where the team leader view lives.
  with ins as (
    insert into app_users (username, password_hash, full_name, role, team, cb, apps, tabs, active)
    select lower(c.cb), p_hashes ->> c.cb, c.leader_name, 'team_leader', c.leader_name, c.cb,
           array['agent']::text[], '{}'::jsonb, true   -- apps is text[], tabs is jsonb
    from   _tl_create c
    on conflict (username) do nothing
    returning username, full_name
  )
  select coalesce(jsonb_agg(jsonb_build_object('username', username, 'name', full_name) order by username), '[]'::jsonb)
    into v_created from ins;

  -- REMOVE. app_sessions cascades so the leaver is signed out; auth_log survives.
  with del as (
    delete from app_users u using _tl_remove r where u.id = r.id
    returning r.username, r.full_name, r.team
  )
  select coalesce(jsonb_agg(jsonb_build_object('username', username, 'name', full_name, 'team', team) order by username), '[]'::jsonb)
    into v_removed from del;

  return jsonb_build_object('status', 'SUCCESS',
    'on_list', (select count(*) from _tl_on_list),
    'created', v_created, 'removed', v_removed,
    'unrepresented', v_unrep, 'applied', true, 'actor', p_actor);
end;
$tl$;

comment on function sync_team_leaders is
  'Reconciles team leader logins against the current Agent List, the way sync_agent_list does for agents. Creates from team_leader_cbs (never from a guess), removes any team_leader account leading nobody on the list, reports leaders with no CB on file. Plans by default; p_apply writes. Refuses whole on a short list or more than p_max_delete removals.';
