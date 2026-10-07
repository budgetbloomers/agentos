-- migration-054 · a leader named twice on the leaders' sheet no longer breaks the publish (2026-10-07, Spec Kit 010)
--
-- Nick: "the new agent list is being uploaded but hezron etc is still there" / "I uploaded the new sheet but it not
-- going through". The 7 Oct Agent List's "TL" sheet names Fabian Chetty (CB194) twice — Matrix Vehicle Tracking -
-- Digital AND - Referral. sync_team_leaders wrote the leader map with ONE
--   insert into team_leader_cbs … select from _tl_sheet … on conflict (leader_name) do update
-- and Postgres refuses to affect one row twice in a single command (SQLSTATE 21000, "ON CONFLICT DO UPDATE command
-- cannot affect row a second time"). The plan step never writes the map, so every dry run passed; every APPLY threw,
-- the Worker answered with an error status, and the suite stayed on the 6 Oct list (Hezron, Renolan and Kubenderan
-- still leaders, 35 moves undone). The Worker's new retry-and-record (spec 010) is what finally named the error.
--
-- Fix: the insert groups the sheet by leader name — one map row per leader, every campaign they head kept, joined
-- with ' / ' (the map's campaign is only served back as information; nothing keys on it). Nothing else changes:
-- body identical to migration-048. CREATE OR REPLACE with the same signature keeps migration-049's grants.
-- Guard: verify-publish-agent-list section D4 (live database, rolled back).
--
-- Apply: node tools/apply-migration.mjs supabase/migration-054-leader-twice-on-sheet.sql

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
  v_renamed   jsonb := '[]'::jsonb;
  v_blocked   jsonb := '[]'::jsonb;
  v_ambig     jsonb := '[]'::jsonb;
  v_need      jsonb := '[]'::jsonb;
  v_ndel      int;
begin
  -- Called outside a publish (the ten-minute cron): no sheet came, so an EMPTY stage stands in
  -- and the map's on_list_as_of remembers the last sheet (migration-040).
  -- Its own temps are dropped up front (migration-048): the function is safe to call twice in one
  -- transaction on its own, not only through publish_agent_list's wrapper.
  drop table if exists _tl_on_list; drop table if exists _tl_cb; drop table if exists _tl_rename; drop table if exists _tl_create; drop table if exists _tl_remove; drop table if exists _tl_ambig;
  if to_regclass('pg_temp._tl_sheet') is null then
    create temp table _tl_sheet (leader_name text, cb text, campaign text, manager text, callx text) on commit drop;
  end if;

  -- The list has to be real before it is allowed to remove anyone's sign-in.
  select count(*) into v_roster from agent_list_current;
  if v_roster < p_min_roster then
    return jsonb_build_object('status', 'REFUSED', 'reason', 'roster_too_small',
      'roster', v_roster, 'min', p_min_roster,
      'detail', format('the current list holds %s rows, under the floor of %s — a broken pull, not a floor that emptied', v_roster, p_min_roster));
  end if;

  -- Who leads somebody on the list as it stands.
  -- Who leads somebody on the list as it stands — PLUS every leader the list's own "VAS TL"
  -- sheet names (migration-040): staged in _tl_sheet by publish_agent_list when the sheet came
  -- with this publish, else remembered in team_leader_cbs.on_list_as_of from the last sheet. A
  -- leader with no agents this month keeps their login; the sheet, not the head-count, decides.
  -- WHO LEADS SOMEBODY comes from the FILE BEING PUBLISHED when one is staged (_pub_rows, migration-048):
  -- in plan-only mode agent_list_current is still the OLD list, so a leader re-spelt in the workbook
  -- read as two spellings (ambiguous) in the plan and as a rename in the apply. One answer, both runs.
  create temp table _tl_on_list on commit drop as
  select distinct btrim(tl) as leader_name
  from   _pub_rows
  where  to_regclass('pg_temp._pub_rows') is not null and accepted and coalesce(btrim(tl), '') <> ''
  union
  select distinct btrim(team_leader) as leader_name
  from   agent_list_current
  where  to_regclass('pg_temp._pub_rows') is null and coalesce(btrim(team_leader), '') <> ''
  union
  select leader_name from _tl_sheet
  union
  select btrim(m.leader_name) from team_leader_cbs m
  where  not exists (select 1 from _tl_sheet)
    and  m.on_list_as_of is not null;   -- remembered until a later sheet stops naming them

  -- Leaders on the list with a CB on file and no account yet.
  -- the CB comes from the sheet when it came, else from the map
  create temp table _tl_cb on commit drop as
  select l.leader_name,
         coalesce((select s.cb from _tl_sheet s where s.leader_name = l.leader_name limit 1),
                  (select norm_cb(m.employee_code) from team_leader_cbs m where btrim(m.leader_name) = l.leader_name and coalesce(btrim(m.employee_code), '') <> '' limit 1)) as cb
  from   _tl_on_list l;
  -- TWO SPELLINGS, ONE CB (migration-048): the sheet says one name, the agents' rows (or the
  -- remembered map) another, and both resolve to the same CB. Nothing is guessed for that CB —
  -- no rename, no creation, no removal — and both spellings are reported as ambiguous[].
  create temp table _tl_ambig on commit drop as
  select cb, jsonb_agg(leader_name order by leader_name) as names
  from   _tl_cb where cb is not null
  group by cb having count(distinct leader_name) > 1;
  select coalesce(jsonb_agg(jsonb_build_object('cb', cb, 'names', names) order by cb), '[]'::jsonb) into v_ambig from _tl_ambig;
  delete from _tl_cb c using _tl_ambig a where c.cb = a.cb;

  -- A CB ALREADY HELD BY ANOTHER KIND OF ACCOUNT (migration-048): the agent path reports this as
  -- blocked; the leader path used to drop the person silently — not created, not unrepresented.
  select coalesce(jsonb_agg(jsonb_build_object('cb', l.cb, 'name', l.leader_name, 'held_by', u.username, 'role', u.role) order by l.cb), '[]'::jsonb)
    into v_blocked
  from   _tl_cb l join app_users u on norm_cb(u.cb) = l.cb
  where  l.cb is not null and u.role <> 'team_leader';

  -- A RENAME IS NOT A DEPARTURE (migration-047, 2026-09-22): the sheet carries the CB, so a leader
  -- whose spelling changed (same CB, new name) keeps the SAME login — the account's team and name
  -- follow the sheet. Without this the old account was removed (its team no longer on the list) and
  -- no new one created (its CB already had an account): the leader lost their sign-in in one publish.
  -- Only when the old spelling is itself no longer on the list — two spellings both live is a list
  -- problem reported as unrepresented, never guessed here.
  drop table if exists _tl_rename;   -- a second publish in one transaction (the verifier, a retry) — publish_agent_list drops the others
  create temp table _tl_rename on commit drop as
  select distinct on (u.id) u.id, u.username, u.full_name as old_name, btrim(coalesce(u.team, '')) as old_team, l.leader_name as new_name, l.cb
  from   app_users u
  join   _tl_cb l on l.cb is not null and norm_cb(u.cb) = l.cb
  where  u.role = 'team_leader'
    and  btrim(coalesce(u.team, '')) <> l.leader_name
    and  not exists (select 1 from _tl_on_list o where o.leader_name = btrim(coalesce(u.team, '')))
  order by u.id, l.leader_name;
  select coalesce(jsonb_agg(jsonb_build_object('cb', cb, 'username', username, 'was', old_team, 'now', new_name) order by cb), '[]'::jsonb)
    into v_renamed from _tl_rename;
  if p_apply then
    update app_users u set team = r.new_name, full_name = r.new_name
    from   _tl_rename r where u.id = r.id;
  end if;

  create temp table _tl_create on commit drop as
  select l.leader_name, l.cb
  from   _tl_cb l
  where  l.cb is not null
    and  not exists (select 1 from app_users u where norm_cb(u.cb) = l.cb)
    and  not exists (select 1 from app_users u where u.role = 'team_leader'
                       and btrim(coalesce(u.team, '')) = l.leader_name);

  -- Leaders on the list we cannot provision: no row in the map, or no CB in it.
  select coalesce(jsonb_agg(l.leader_name order by l.leader_name), '[]'::jsonb) into v_unrep
  from   _tl_cb l
  where  l.cb is null
    and  not exists (select 1 from app_users u where u.role = 'team_leader'
                       and btrim(coalesce(u.team, '')) = l.leader_name);

  -- Accounts to remove: a team leader who leads nobody on the current list.
  create temp table _tl_remove on commit drop as
  select u.id, u.username, u.full_name, btrim(coalesce(u.team, '')) as team
  from   app_users u
  where  u.role = 'team_leader'
    and  not exists (select 1 from _tl_on_list l where l.leader_name = btrim(coalesce(u.team, '')))
    and  not exists (select 1 from _tl_rename r where r.id = u.id);   -- renamed, not gone

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
      'unrepresented', v_unrep, 'renamed', v_renamed, 'blocked', v_blocked, 'ambiguous', v_ambig, 'applied', false);
  end if;

  -- PLAN ONLY unless asked. Same posture as sync_agent_list.
  if not p_apply then
    return jsonb_build_object('status', 'PLAN',
      'on_list', (select count(*) from _tl_on_list),
      'would_create', (select coalesce(jsonb_agg(jsonb_build_object('cb', cb, 'name', leader_name) order by cb), '[]'::jsonb) from _tl_create),
      'would_remove', (select coalesce(jsonb_agg(jsonb_build_object('username', username, 'name', full_name, 'team', team) order by username), '[]'::jsonb) from _tl_remove),
      'unrepresented', v_unrep, 'renamed', v_renamed, 'blocked', v_blocked, 'ambiguous', v_ambig, 'applied', false);
  end if;

  -- THE MAP FOLLOWS THE SHEET (migration-040): every leader the "VAS TL" sheet names is written to
  -- team_leader_cbs with their CB, campaign and sales manager, stamped with the list's date. A
  -- leader the sheet stopped naming keeps their row (history) but loses the stamp next publish.
  if exists (select 1 from _tl_sheet) then
    -- ONE ROW PER LEADER (migration-054): a leader the sheet names twice — Fabian Chetty on 7 Oct, once for
    -- Digital and once for Referral — used to reach this insert twice, and Postgres refuses to touch one row
    -- twice in one command (21000), so the whole publish threw. Grouped by name; the campaigns are kept, joined.
    insert into team_leader_cbs (leader_name, employee_code, campaign, manager, on_list_as_of, updated_by, updated_at)
    select s.leader_name, min(s.cb),
           nullif(string_agg(distinct nullif(btrim(s.campaign), ''), ' / ' order by nullif(btrim(s.campaign), '')), ''),
           min(nullif(btrim(s.manager), '')),
           (select max(as_of) from agent_list), p_actor, now()
    from   _tl_sheet s
    group  by s.leader_name
    on conflict (leader_name) do update
      set employee_code = excluded.employee_code, campaign = excluded.campaign, manager = excluded.manager,
          on_list_as_of = excluded.on_list_as_of, updated_by = excluded.updated_by, updated_at = now();
    -- a leader this sheet no longer names is forgotten as a sheet leader (their agents, if any, still count)
    update team_leader_cbs set on_list_as_of = null, updated_by = p_actor, updated_at = now()
     where on_list_as_of is not null and btrim(leader_name) not in (select leader_name from _tl_sheet);
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
    'unrepresented', v_unrep, 'renamed', v_renamed, 'blocked', v_blocked, 'ambiguous', v_ambig, 'applied', true, 'actor', p_actor);
end;
$tl$;
