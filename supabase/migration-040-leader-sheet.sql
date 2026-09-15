-- migration-040-leader-sheet.sql
-- THE LEADERS COME ON THE LIST (Nick, 2026-09-15: "I gave you the upload matrix list with their cb
-- number, from now this is how it will come — put them in their respected campaigns").
-- The workbook's new "VAS TL" sheet — Employee Code | Team Leader Name | Sales Manager | Campaign |
-- VICCI Dial — is the record of who leads, under which campaign, with which CB. Three changes:
--   1. team_leader_cbs gains campaign, manager and on_list_as_of (the list date that last named
--      the leader), so the map is written BY the list and read by /api/roster and the health view.
--   2. publish_agent_list stages rows posted with role = 'leader' in _tl_sheet and keeps them out
--      of the agent derive.
--   3. sync_team_leaders counts a leader on the sheet as on the list (login kept with zero agents),
--      takes the CB from the sheet before the map, and on apply writes the map from the sheet.
-- Both functions are restated whole from the live bodies + these edits, so the repo carries exactly
-- what runs.

alter table team_leader_cbs add column if not exists campaign      text;
alter table team_leader_cbs add column if not exists manager       text;
alter table team_leader_cbs add column if not exists on_list_as_of date;
comment on column team_leader_cbs.campaign      is 'The campaign the "VAS TL" sheet places this leader under (Courtesy / Cuddle / Nesting …).';
comment on column team_leader_cbs.manager       is 'The sales manager named beside the leader on the "VAS TL" sheet.';
comment on column team_leader_cbs.on_list_as_of is 'The Agent List date whose "VAS TL" sheet last named this leader; null = only ever in the hand-kept map.';

CREATE OR REPLACE FUNCTION public.publish_agent_list(p_as_of date, p_rows jsonb, p_fingerprint text DEFAULT NULL::text, p_actor text DEFAULT 'system'::text, p_hashes jsonb DEFAULT '{}'::jsonb, p_apply boolean DEFAULT false, p_min_roster integer DEFAULT 25)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_asof     date  := coalesce(p_as_of, current_date);
  v_batch    text  := 'pub-' || to_char(clock_timestamp(), 'YYYYMMDD-HH24MISSMS');
  v_nraw     int;
  v_nok      int;
  v_roster   jsonb;
  v_dropped  jsonb;
  v_blank    jsonb;
  v_camps    jsonb;
  v_agents   jsonb := '{}'::jsonb;
  v_leaders  jsonb := '{}'::jsonb;
  v_camp     jsonb := '{}'::jsonb;
  v_need     jsonb := '[]'::jsonb;
  v_det      text;
  v_stage    text;
  v_inner    jsonb;
begin
  if jsonb_typeof(coalesce(p_rows, 'null'::jsonb)) is distinct from 'array' then
    return jsonb_build_object('status', 'FAILED', 'reason', 'rows_not_array', 'detail', 'the list is not an array of rows');
  end if;

  -- ------------------------------------------------------------ derive
  drop table if exists _pub_rows;
  create temp table _pub_rows on commit drop as
  with raw as (
    select t.ord::int                                                  as ord,
           btrim(coalesce(t.r->>'sheet', ''))                          as sheet,
           btrim(coalesce(t.r->>'code', ''))                           as code_raw,
           btrim(coalesce(t.r->>'name', ''))                           as name_raw,
           nullif(nullif(btrim(coalesce(t.r->>'sf', '')), '-'), '')    as sf,
           nullif(btrim(coalesce(t.r->>'tl', '')), '')                 as tl,
           btrim(coalesce(t.r->>'campaign', ''))                       as campaign_raw,
           nullif(btrim(coalesce(t.r->>'tenure', '')), '')             as tenure,
           nullif(btrim(coalesce(t.r->>'callx', '')), '')              as callx,
           case when (t.r->>'target') ~ '^[0-9]+(\.[0-9]+)?$' then (t.r->>'target')::numeric end as target,
           case when (t.r->>'start')  ~ '^\d{4}-\d{2}-\d{2}$'  then (t.r->>'start')::date    end as start_date
    from   jsonb_array_elements(p_rows) with ordinality as t(r, ord)
    where  coalesce(t.r->>'role', '') <> 'leader'                      -- the "VAS TL" sheet's rows are leaders, not agents (migration-040)
  )
  select ord, sheet, code_raw, name_raw, sf, tl, campaign_raw, tenure, callx, target, start_date,
         upper(regexp_replace(code_raw, '[^A-Za-z0-9]', '', 'g'))     as code,
         norm_cb(code_raw)                                             as cb,
         coalesce(sf, nullif(name_raw, ''))                            as name,   -- Sales Force is the join key (spec §3); Agent Name is the fallback
         campaign_label(campaign_raw, sheet)                           as campaign,
         false                                                         as accepted,
         null::text                                                    as why
  from   raw
  where  code_raw <> '' or name_raw <> '' or sf is not null;          -- an empty line is not a row

  update _pub_rows set why = case
      when cb is null or code !~ '^CB[0-9]+$' then 'no CB number'
      when name is null                        then 'no name'
    end
   where ord is not null;
  -- A LEGACY SHEET IS NOT THE RECORD (migration-039, 2026-09-15). The Agent List workbook
  -- carries frozen month-named tabs ("May", a Que-column snapshot) beside the live "VAS"/"VT"
  -- tabs, and PULSE posts every row of every sheet — the 3 Sep principle that stopped the
  -- "Download & Test" rows being dropped in the browser. But a legacy tab can spell a CB
  -- differently from the live tab (CB156: "Kasavani Snakarparsad" vs "Ashnee Kasavani
  -- Sankarparsad"), and the duplicate rule below then refused the WHOLE list — every upload
  -- from 10 to 14 Sep, five days on an 8 Sep roster, with a 20-second toast as the only sign.
  -- PULSE already ranks a month-named sheet below a live one and skips it; the server now
  -- applies the same judgement: when the post carries at least one live sheet, every row from
  -- a month-named or "SheetN" tab is dropped with its reason. A file that is ONLY a legacy
  -- sheet (an old-format list) is still taken whole.
  if exists (select 1 from _pub_rows where why is null
               and sheet !~* '^(january|february|march|april|may|june|july|august|september|october|november|december)$'
               and sheet !~* '^sheet\s*[0-9]+$') then
    update _pub_rows set why = 'legacy sheet (superseded by the live sheet)'
     where why is null
       and (sheet ~* '^(january|february|march|april|may|june|july|august|september|october|november|december)$'
            or sheet ~* '^sheet\s*[0-9]+$');
  end if;
  -- The same person listed twice with the same name collapses to the first row; the same
  -- CB with two different names is left in, and sync_agent_list refuses the list, named.
  update _pub_rows p set why = 'duplicate row'
   where p.why is null
     and exists (select 1 from _pub_rows o where o.why is null and o.cb = p.cb and o.name = p.name and o.ord < p.ord);
  update _pub_rows set accepted = (why is null) where ord is not null;

  select count(*), count(*) filter (where accepted) into v_nraw, v_nok from _pub_rows;

  select coalesce(jsonb_agg(jsonb_build_object('code', code, 'name', name, 'tl', coalesce(tl, ''), 'campaign', campaign,
           'tenure', coalesce(tenure, ''), 'callx', coalesce(callx, ''), 'sf', coalesce(sf, ''),
           'target', target, 'start', coalesce(to_char(start_date, 'YYYY-MM-DD'), '')) order by ord), '[]'::jsonb)
    into v_roster from _pub_rows where accepted;
  select coalesce(jsonb_agg(jsonb_build_object('sheet', sheet, 'row', ord, 'code', code_raw, 'name', coalesce(name, name_raw), 'why', why) order by ord), '[]'::jsonb)
    into v_dropped from _pub_rows where not accepted;
  select coalesce(jsonb_agg(code order by code), '[]'::jsonb)
    into v_blank from _pub_rows where accepted and campaign_raw = '';
  select coalesce(jsonb_agg(jsonb_build_object('label', c.campaign, 'agents', c.n) order by c.campaign), '[]'::jsonb)
    into v_camps from (select campaign, count(*)::int as n from _pub_rows where accepted group by campaign) c;

  if v_nok < p_min_roster then
    return jsonb_build_object('status', 'REFUSED', 'reason', 'roster too small', 'stage', 'derive',
      'on_file', v_nraw, 'on_roster', v_nok, 'min', p_min_roster, 'dropped', v_dropped,
      'detail', format('%s usable agent rows in a file of %s is below the floor of %s. Nothing was changed.', v_nok, v_nraw, p_min_roster));
  end if;

  -- The inner syncs create temp tables without drop-if-exists; a second publish inside one
  -- transaction (the verifier, a retry) must not trip over the first one's.
  drop table if exists _tl_on_list; drop table if exists _tl_create; drop table if exists _tl_remove; drop table if exists _camp_on_list; drop table if exists _tl_sheet; drop table if exists _tl_cb;
  -- THE LEADERS' OWN SHEET (migration-040, Nick 2026-09-15: "the upload matrix list with their cb
  -- number — from now this is how it will come — put them in their respected campaigns"). The
  -- workbook now carries a "VAS TL" tab: Employee Code | Team Leader Name | Sales Manager |
  -- Campaign | VICCI Dial. PULSE posts those rows with role = 'leader'; they are staged here for
  -- sync_team_leaders, which counts a leader on this sheet as ON THE LIST (a login even with no
  -- agents this month) and, on apply, writes the map (team_leader_cbs) from it — so a new leader
  -- needs no hand-kept JSON and a leader's campaign is the sheet's word, not a guess from agents.
  create temp table _tl_sheet on commit drop as
  select btrim(t.r->>'name')                                   as leader_name,
         norm_cb(t.r->>'code')                                 as cb,
         campaign_label(btrim(coalesce(t.r->>'campaign', '')), null) as campaign,
         nullif(btrim(coalesce(t.r->>'manager', '')), '')      as manager,
         nullif(btrim(coalesce(t.r->>'callx', '')), '')        as callx
  from   jsonb_array_elements(p_rows) as t(r)
  where  coalesce(t.r->>'role', '') = 'leader'
    and  coalesce(btrim(t.r->>'name'), '') <> ''
    and  norm_cb(t.r->>'code') is not null;

  -- ------------------------------------------------------------ the three syncs, one transaction
  begin
    v_agents := sync_agent_list(v_asof, v_roster, v_batch, p_fingerprint, p_actor, p_hashes, p_apply, p_min_roster);
    if v_agents->>'status' not in ('SUCCESS', 'PLAN') then
      -- It wrote nothing (it clears its own staging; its own log row stands). NEEDS_HASHES
      -- in apply mode lands here too: the caller hashes and calls again.
      return jsonb_build_object('status', v_agents->>'status', 'stage', 'agents', 'as_of', v_asof,
        'on_file', v_nraw, 'on_roster', v_nok, 'roster', v_roster, 'dropped', v_dropped, 'campaigns_on_list', v_camps,
        'needs_hashes', coalesce(v_agents->'needs_hashes', '[]'::jsonb),
        'reason', coalesce(v_agents->>'reason', v_agents->>'status'), 'detail', v_agents->>'detail', 'agents', v_agents);
    end if;

    v_leaders := sync_team_leaders(p_hashes, p_actor, p_apply, p_min_roster);
    if v_leaders->>'status' = 'NEEDS_HASHES' and not p_apply then
      null;                                                -- a plan: the hashes it names are reported below
    elsif v_leaders->>'status' not in ('SUCCESS', 'PLAN') then
      raise exception using errcode = 'P0002', message = 'leaders', detail = v_leaders::text;
    end if;

    v_camp := sync_campaigns(p_actor, p_apply, p_min_roster);
    if v_camp->>'status' not in ('SUCCESS', 'PLAN') then
      raise exception using errcode = 'P0002', message = 'campaigns', detail = v_camp::text;
    end if;
  exception when sqlstate 'P0002' then
    -- EVERYTHING in the block is undone — the agents' creates, updates and removals too.
    get stacked diagnostics v_stage = message_text, v_det = pg_exception_detail;
    v_inner := v_det::jsonb;
    if p_apply then
      insert into agent_sync_logs (batch_id, as_of, fingerprint, status, initiated_by, errors, detail)
      values (v_batch, v_asof, p_fingerprint, 'REFUSED', p_actor, jsonb_build_array(v_stage || ': ' || coalesce(v_inner->>'reason', v_inner->>'status', '')),
              'Refused at the ' || v_stage || ' stage: ' || coalesce(v_inner->>'detail', v_inner->>'reason', '')
              || ' Nothing was changed — the previous list is still in force.');
    end if;
    return jsonb_build_object('status', v_inner->>'status', 'stage', v_stage, 'as_of', v_asof,
      'on_file', v_nraw, 'on_roster', v_nok, 'roster', v_roster, 'dropped', v_dropped, 'campaigns_on_list', v_camps,
      'needs_hashes', coalesce(v_inner->'needs_hashes', '[]'::jsonb),
      'reason', coalesce(v_inner->>'reason', v_inner->>'status'),
      'detail', coalesce(v_inner->>'detail', '') || ' Nothing was changed — the previous list is still in force.',
      v_stage, v_inner);
  end;

  -- ------------------------------------------------------------ the file, kept
  if p_apply then
    delete from agent_list_raw where as_of = v_asof;
    insert into agent_list_raw (as_of, batch_id, fingerprint, ord, sheet, code_raw, cb, code, name, sf, tl,
                                campaign_raw, campaign, tenure, callx, target, start_date, accepted, why)
    select v_asof, v_batch, p_fingerprint, ord, sheet, code_raw, cb, code, name, sf, tl,
           campaign_raw, campaign, tenure, callx, target, start_date, accepted, why
    from   _pub_rows;
  end if;

  v_need := coalesce(v_agents->'needs_hashes', '[]'::jsonb) || coalesce(v_leaders->'needs_hashes', '[]'::jsonb);

  return jsonb_build_object('status', case when p_apply then 'SUCCESS' else 'PLAN' end, 'as_of', v_asof, 'batch', v_batch,
    'on_file', v_nraw, 'on_roster', v_nok, 'roster', v_roster, 'dropped', v_dropped, 'blank_campaign', v_blank,
    'campaigns_on_list', v_camps, 'needs_hashes', v_need,
    'agents', v_agents, 'leaders', v_leaders, 'campaigns', v_camp, 'applied', p_apply);
end;
$function$
;
;

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
  -- Called outside a publish (the ten-minute cron): no sheet came, so an EMPTY stage stands in
  -- and the map's on_list_as_of remembers the last sheet (migration-040).
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
  create temp table _tl_on_list on commit drop as
  select distinct btrim(team_leader) as leader_name
  from   agent_list_current
  where  coalesce(btrim(team_leader), '') <> ''
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

  -- THE MAP FOLLOWS THE SHEET (migration-040): every leader the "VAS TL" sheet names is written to
  -- team_leader_cbs with their CB, campaign and sales manager, stamped with the list's date. A
  -- leader the sheet stopped naming keeps their row (history) but loses the stamp next publish.
  if exists (select 1 from _tl_sheet) then
    insert into team_leader_cbs (leader_name, employee_code, campaign, manager, on_list_as_of, updated_by, updated_at)
    select s.leader_name, s.cb, s.campaign, s.manager, (select max(as_of) from agent_list), p_actor, now()
    from   _tl_sheet s
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
    'unrepresented', v_unrep, 'applied', true, 'actor', p_actor);
end;
$tl$;
