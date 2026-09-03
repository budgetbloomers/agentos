-- ============================================================================
-- migration-020 — THE FILE IS THE RECORD.
--
-- Nick, 2026-09-03, after the "Download & Test" campaign (five agents) turned out
-- to have been dropped from every Agent List publish for weeks: "to make sure this
-- problem never happens again — when the agent list is uploaded I want agent view,
-- team leader view created, new campaigns automatically created, and if it's not
-- in the next one it must be deleted."
--
-- WHAT ACTUALLY WENT WRONG. The database side (sync_agent_list 014, sync_team_leaders
-- 018, sync_campaigns 019) did exactly what it was asked — it created the campaign
-- the moment a row carrying it arrived. The rows never arrived: PULSE decided in the
-- browser which rows were "real" campaigns and posted only those. A client that
-- classifies before it publishes can silently drop anything, and nothing downstream
-- can know. So:
--
--   1. publish_agent_list() takes EVERY row of EVERY sheet of the file, unclassified,
--      and derives the roster HERE (campaign_label: the same vocabulary PULSE uses,
--      plus the VT-sheet fold). What the browser thinks the roster is no longer
--      matters — both apps adopt the record this returns. Rows that do not become
--      agents are returned, with the reason, and stored in agent_list_raw, so "the
--      file had 112 rows and the roster 107" is visible in the receipt, not a
--      surprise weeks later.
--   2. The three syncs run inside ONE transaction. A refusal at the leaders or
--      campaigns stage rolls the agents' writes back too — all or nothing. There is
--      no state in which the logins follow the new list and the campaigns the old.
--   3. Campaigns nobody on the list carries are DELETED, not deactivated — the same
--      rule agents and leaders already live by (on the list ⇒ exists; off it ⇒ gone).
--      campaign_sync_logs is the history; past months' digests are frozen blobs that
--      never joined to this table. (Space was Nick's stated reason; the real gain is
--      one rule for all three kinds of thing.)
--   4. agent_list_integrity is the database's own sentence-checks — list vs logins vs
--      campaigns vs the roster of record — read by the Worker's ten-minute health
--      cron, which raises `agent-list-out-of-sync` in both apps while any fails. The
--      next drop anywhere in the chain becomes an alert within ten minutes.
--
-- Applied with: node tools/apply-migration.mjs supabase/migration-020-publish-agent-list.sql
-- Verified by:  nicks_code/diagnostics/verify-publish-agent-list.mjs (rolled back, never commits)
--               nicks_code/diagnostics/verify-campaign-sync.mjs · verify-agent-sync.mjs
--
-- Every UPDATE in here carries a WHERE clause: the PostgREST role runs with
-- pg-safeupdate, which refuses an UPDATE without one (seen live 2026-09-03; a psql
-- session, and so the verifier, never trips it).
-- ============================================================================

-- ------------------------------------------------------------- campaign_label
-- PULSE's campOf() plus the VT-sheet rule, in SQL, so the record is derived once.
--   · a row on a sheet named VT / Tracker / Vehicle is VT whatever its cell says
--     (the workbook's VT tab labels rows by QUEUE: Scheduling, Matrix Digital, …)
--   · blank → Courtesy (reported to the uploader as blank_campaign, never silent)
--   · nest → Nesting · cuddle → Cuddle · track|vehicle|vision|VT → VT · courtesy → Courtesy
--   · anything else is a campaign in its own right, spelled as the list spells it
create or replace function campaign_label(p_raw text, p_sheet text default null) returns text
language sql immutable as $fn$
  select case
    when coalesce(p_sheet, '') ~* '^\s*vt\s*$|vehicle|tracker' then 'VT'
    when x.s = ''                            then 'Courtesy'
    when x.s ~* 'nest'                       then 'Nesting'
    when x.s ~* 'cuddle'                     then 'Cuddle'
    when x.s ~* 'track|vehicle|vision|^vt$'  then 'VT'
    when x.s ~* 'courtesy'                   then 'Courtesy'
    else x.s end
  from (select regexp_replace(btrim(coalesce(p_raw, '')), '\s+', ' ', 'g') as s) x
$fn$;
comment on function campaign_label(text, text) is
  'The campaign a list row belongs to: PULSE''s campOf() vocabulary plus the VT-sheet fold. The ONE place a row is classified.';

-- ------------------------------------------------------------- agent_list_raw
-- The file as it arrived — every row of every sheet, with what became of it. The
-- audit trail that would have shown five "Download & Test" rows with accepted=false.
create table if not exists agent_list_raw (
  id            bigserial primary key,
  as_of         date not null,
  batch_id      text,
  fingerprint   text,
  ord           int,                 -- position in the file (1-based, across sheets)
  sheet         text,
  code_raw      text,
  cb            text,                -- norm_cb(code_raw)
  code          text,                -- CB123 spelling used on the roster
  name          text,
  sf            text,
  tl            text,
  campaign_raw  text,                -- the cell, verbatim
  campaign      text,                -- campaign_label(campaign_raw, sheet)
  tenure        text,
  callx         text,
  target        numeric,
  start_date    date,
  accepted      boolean not null default false,
  why           text,                -- when not accepted: 'no CB number' | 'no name' | 'duplicate row'
  loaded_at     timestamptz not null default now()
);
create index if not exists agent_list_raw_asof_idx on agent_list_raw (as_of desc, ord);
alter table agent_list_raw enable row level security;
comment on table agent_list_raw is
  'Every row of every Agent List file as uploaded, one snapshot per as_of, with accepted/why. If the roster is ever short, the missing rows are HERE with the reason.';

-- ------------------------------------------------- sync_campaigns: DELETE, not deactivate
alter table campaign_sync_logs add column if not exists deleted jsonb not null default '[]'::jsonb;
comment on table campaigns is
  'The campaigns the CURRENT Agent List carries — nothing else. Created and DELETED by sync_campaigns() on every list publish (Nick, 2026-09-03: "if it''s not in the next one it must be deleted"). campaign_sync_logs is the history. Targets and ownership are NOT here — see cm:targets / cm:assignments.';

drop function if exists sync_campaigns(text, boolean, int, int);
create or replace function sync_campaigns(
  p_actor        text    default 'system',
  p_apply        boolean default false,
  p_min_roster   int     default 25,
  p_max_delete   int     default 2
) returns jsonb
language plpgsql
security definer
set search_path = public
as $sync$
declare
  v_asof     date;
  v_roster   int;
  v_ncamp    int;
  v_on       jsonb := '[]'::jsonb;
  v_created  jsonb := '[]'::jsonb;
  v_deleted  jsonb := '[]'::jsonb;
  v_ndel     int;
begin
  select max(as_of), count(*) into v_asof, v_roster from agent_list_current;
  if coalesce(v_roster, 0) < p_min_roster then
    return jsonb_build_object('status', 'REFUSED', 'reason', 'roster_too_small', 'roster', v_roster, 'min', p_min_roster,
      'detail', format('the current list holds %s rows, under the floor of %s — a broken pull, not a floor that emptied', coalesce(v_roster, 0), p_min_roster));
  end if;

  drop table if exists _camp_on_list;
  create temp table _camp_on_list on commit drop as
  select campaign_key(campaign)                                        as key,
         mode() within group (order by btrim(campaign))                as label,
         count(*)::int                                                 as agents
  from   agent_list_current
  where  campaign_key(campaign) is not null
  group  by campaign_key(campaign);

  select count(*) into v_ncamp from _camp_on_list;
  if v_ncamp = 0 then
    return jsonb_build_object('status', 'REFUSED', 'reason', 'no_campaigns_on_list', 'roster', v_roster,
      'detail', 'the current list carries no campaign on any row — a column dropped in the export, not a floor with no campaigns');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('key', l.key, 'label', l.label, 'agents', l.agents) order by l.key), '[]'::jsonb)
    into v_on from _camp_on_list l;

  select coalesce(jsonb_agg(jsonb_build_object('key', l.key, 'label', l.label, 'agents', l.agents) order by l.key), '[]'::jsonb)
    into v_created
  from   _camp_on_list l
  where  not exists (select 1 from campaigns c where c.key = l.key);

  -- A campaign no agent on the list carries is off the list, and off the list means gone.
  select coalesce(jsonb_agg(jsonb_build_object('key', c.key, 'label', c.label, 'first_seen', c.first_seen, 'last_seen', c.last_seen) order by c.key), '[]'::jsonb),
         count(*)::int
    into v_deleted, v_ndel
  from   campaigns c
  where  not exists (select 1 from _camp_on_list l where l.key = c.key);

  if v_ndel > p_max_delete then
    return jsonb_build_object('status', 'REFUSED', 'reason', 'too_many_deletions',
      'would_delete', v_ndel, 'max', p_max_delete, 'deletions', v_deleted,
      'detail', format('%s campaigns would be removed in one run, over the cap of %s — check the list before letting this through', v_ndel, p_max_delete));
  end if;

  if not p_apply then
    return jsonb_build_object('status', 'PLAN', 'as_of', v_asof, 'on_list', v_on,
      'would_create', v_created, 'would_delete', v_deleted, 'applied', false);
  end if;

  -- ============================== APPLY ======================================
  insert into campaigns (key, label, active, first_seen, last_seen, agents, created_by, updated_at)
  select l.key, l.label, true, v_asof, v_asof, l.agents, p_actor, now()
  from   _camp_on_list l
  on conflict (key) do update
    set label      = excluded.label,
        active     = true,
        last_seen  = excluded.last_seen,
        agents     = excluded.agents,
        first_seen = coalesce(campaigns.first_seen, excluded.first_seen),
        updated_at = now();

  delete from campaigns c
   where not exists (select 1 from _camp_on_list l where l.key = c.key);

  insert into campaign_sync_logs (as_of, status, initiated_by, created, deleted, on_list, detail)
  values (v_asof, 'SUCCESS', p_actor, v_created, v_deleted, v_on,
          format('%s campaigns on the list of %s: +%s created, -%s deleted',
                 v_ncamp, v_asof, jsonb_array_length(v_created), v_ndel));

  return jsonb_build_object('status', 'SUCCESS', 'as_of', v_asof, 'on_list', v_on,
    'created', v_created, 'deleted', v_deleted, 'applied', true, 'actor', p_actor);
end;
$sync$;
comment on function sync_campaigns(text, boolean, int, int) is
  'Reconciles the campaigns table against the current Agent List: creates newly named campaigns, DELETES ones no agent carries (campaign_sync_logs keeps the history). Plans by default; p_apply writes. Refuses whole on a short list, a campaign-less list, or more than p_max_delete going at once.';
revoke all on function sync_campaigns(text, boolean, int, int) from public;

-- ---------------------------------------------------------- publish_agent_list
-- The one entry point for a list. Raw rows in; the derived roster, what was dropped
-- and why, and the three syncs' results out — SUCCESS only when all three applied.
--   p_apply=false  PLAN: derive, and report every password hash the apply will need
--                  (new agents AND new leaders) — nothing is written.
--   p_apply=true   APPLY: agents, then leaders, then campaigns, one transaction. A
--                  refusal at any later stage rolls back the earlier stages' writes.
create or replace function publish_agent_list(
  p_as_of        date,
  p_rows         jsonb,                        -- [{sheet,code,name,sf,tl,campaign,tenure,callx,target,start}] — every row, unclassified
  p_fingerprint  text    default null,
  p_actor        text    default 'system',
  p_hashes       jsonb   default '{}'::jsonb,  -- {"CB121": "pbkdf2h$…"} for every new login
  p_apply        boolean default false,
  p_min_roster   int     default 25
) returns jsonb
language plpgsql
security definer
set search_path = public
as $pub$
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
  drop table if exists _tl_on_list; drop table if exists _tl_create; drop table if exists _tl_remove; drop table if exists _camp_on_list;

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
$pub$;
comment on function publish_agent_list(date, jsonb, text, text, jsonb, boolean, int) is
  'THE way an Agent List lands: every raw row in, the roster derived here (campaign_label), then sync_agent_list + sync_team_leaders + sync_campaigns in ONE transaction. PLAN reports every hash the apply needs; APPLY is all-or-nothing. Returns SUCCESS | PLAN | REFUSED | FAILED | NEEDS_HASHES with stage, roster, dropped[].';
revoke all on function publish_agent_list(date, jsonb, text, text, jsonb, boolean, int) from public;

-- ------------------------------------------------------- agent_list_integrity
-- Read every ten minutes by the Worker's health cron; any failures > 0 becomes the
-- `agent-list-out-of-sync` alert in both apps. Sentences, so a failure reads as one.
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
       'record ' || coalesce((select fp from rec), '(none)') || ' vs synced ' || coalesce((select fingerprint from last_ok), '(none)');
comment on view agent_list_integrity is
  'Does the latest Agent List agree with the logins, the campaigns and the roster of record? failures > 0 on any row = the agent-list-out-of-sync alert. Critical rows mean a person or campaign is missing or lingering; the leader row is a warning (a human must supply the CB number).';
