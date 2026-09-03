-- ============================================================================
-- migration-019-campaigns.sql
--
-- CAMPAIGNS FOLLOW THE AGENT LIST — the third thing the list creates.
--
-- Nick, 2026-09-03: "when a new agent list is uploaded it already automatically
-- creates agent view and team leader view … now add: when a new agent list is
-- uploaded, new campaigns are created." Until now a campaign was not a THING
-- anywhere in the database: the Worker's campaign-manager context held a
-- hardcoded set, PULSE folded any unknown spelling into Courtesy, and a campaign
-- that appeared on the list for the first time existed only as a string on 40
-- rows. This gives campaigns a table, fed by the list, on the same cadence and
-- with the same posture as agents (014) and team leaders (018).
--
-- EVIDENCE FOR EACH DIRECTION:
--   create     — a campaign named on the current list that has no row.
--   reactivate — a row that exists, is inactive, and is named again.
--   deactivate — an active row that NO agent on the current list carries.
--                Deactivated, never deleted: a campaign that ran for six months is
--                history the month views still refer to.
--
-- GUARDS, FAIL-CLOSED, MIRRORING 014/018:
--   * a list under p_min_roster rows is a broken pull — refuse whole
--   * a list with NO campaign column at all is a broken pull — refuse whole
--   * more than p_max_deactivate campaigns going quiet in one run is refused whole
--   * p_apply defaults FALSE — plans by default, writes only when asked
--
-- WHAT THIS DELIBERATELY DOES NOT DO: invent targets, assign campaign managers, or
-- tell the dashboards how to report a new campaign. A created campaign is a named
-- fact with a head count; its targets and its owner are human decisions, surfaced
-- in `created` so a human sees them (specs/campaign-sync-plan.md, Phase 2).
--
-- SAFE TO RUN TWICE.
-- ============================================================================

-- ---------------------------------------------------------------- campaign_key
-- ONE normalisation for the join between a list cell and a row: trimmed, single
-- spaces, lower case. The label keeps the list's own spelling (most common form).
create or replace function campaign_key(v text) returns text
language sql immutable as $fn$
  select nullif(lower(regexp_replace(btrim(coalesce(v, '')), '\s+', ' ', 'g')), '')
$fn$;
comment on function campaign_key(text) is
  'Canonical campaign key: trimmed, spaces collapsed, lower-cased. NULL for blank.';

-- ------------------------------------------------------------------ campaigns
create table if not exists campaigns (
  key          text primary key,                 -- campaign_key(label)
  label        text not null,                    -- as the Agent List spells it
  active       boolean not null default true,    -- named on the CURRENT list
  first_seen   date,                             -- the list that first carried it
  last_seen    date,                             -- the latest list that carries it
  agents       int  not null default 0,          -- head count on the current list
  source       text not null default 'agent_list',
  created_by   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
comment on table campaigns is
  'Every campaign the Agent List has ever named. active = carried by the current list. Created and deactivated by sync_campaigns() on every list publish; never deleted, because past months still refer to it. Targets and ownership are NOT here — see cm:targets / cm:assignments.';
alter table campaigns enable row level security;

create or replace view active_campaigns as
  select key, label, agents, first_seen, last_seen from campaigns where active order by label;
comment on view active_campaigns is 'The campaigns on the current Agent List — THE list every app should read.';

-- ---------------------------------------------------------- campaign_sync_logs
create table if not exists campaign_sync_logs (
  id            bigserial primary key,
  as_of         date,
  status        text not null,            -- SUCCESS | REFUSED
  initiated_by  text,
  created       jsonb not null default '[]'::jsonb,
  reactivated   jsonb not null default '[]'::jsonb,
  deactivated   jsonb not null default '[]'::jsonb,
  on_list       jsonb not null default '[]'::jsonb,
  detail        text,
  created_at    timestamptz not null default now()
);
alter table campaign_sync_logs enable row level security;

-- ------------------------------------------------------------- sync_campaigns
create or replace function sync_campaigns(
  p_actor           text    default 'system',
  p_apply           boolean default false,
  p_min_roster      int     default 25,
  p_max_deactivate  int     default 2
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
  v_react    jsonb := '[]'::jsonb;
  v_deact    jsonb := '[]'::jsonb;
  v_ndeact   int;
  v_out      jsonb;
begin
  select max(as_of), count(*) into v_asof, v_roster from agent_list_current;
  if coalesce(v_roster, 0) < p_min_roster then
    return jsonb_build_object('status', 'REFUSED', 'reason', 'roster_too_small', 'roster', v_roster, 'min', p_min_roster,
      'detail', format('the current list holds %s rows, under the floor of %s — a broken pull, not a floor that emptied', coalesce(v_roster, 0), p_min_roster));
  end if;

  -- What the current list says exists: one row per campaign key, labelled by its
  -- most common spelling, with a head count. Dropped first: ON COMMIT DROP only
  -- fires at commit, so a second call inside one transaction (the verifier, or a
  -- publish that reconciles twice) would otherwise find the table already there.
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

  select coalesce(jsonb_agg(jsonb_build_object('key', l.key, 'label', l.label, 'agents', l.agents) order by l.key), '[]'::jsonb)
    into v_react
  from   _camp_on_list l
  join   campaigns c on c.key = l.key
  where  not c.active;

  select coalesce(jsonb_agg(jsonb_build_object('key', c.key, 'label', c.label, 'last_seen', c.last_seen) order by c.key), '[]'::jsonb),
         count(*)::int
    into v_deact, v_ndeact
  from   campaigns c
  where  c.active
    and  not exists (select 1 from _camp_on_list l where l.key = c.key);

  if v_ndeact > p_max_deactivate then
    return jsonb_build_object('status', 'REFUSED', 'reason', 'too_many_deactivations',
      'would_deactivate', v_ndeact, 'max', p_max_deactivate, 'deactivations', v_deact,
      'detail', format('%s campaigns would go quiet in one run, over the cap of %s — check the list before letting this through', v_ndeact, p_max_deactivate));
  end if;

  if not p_apply then
    return jsonb_build_object('status', 'PLAN', 'as_of', v_asof, 'on_list', v_on,
      'would_create', v_created, 'would_reactivate', v_react, 'would_deactivate', v_deact, 'applied', false);
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

  update campaigns c
     set active = false, agents = 0, updated_at = now()
   where c.active
     and not exists (select 1 from _camp_on_list l where l.key = c.key);

  insert into campaign_sync_logs (as_of, status, initiated_by, created, reactivated, deactivated, on_list, detail)
  values (v_asof, 'SUCCESS', p_actor, v_created, v_react, v_deact, v_on,
          format('%s campaigns on the list of %s: +%s created, %s reactivated, %s deactivated',
                 v_ncamp, v_asof, jsonb_array_length(v_created), jsonb_array_length(v_react), v_ndeact));

  return jsonb_build_object('status', 'SUCCESS', 'as_of', v_asof, 'on_list', v_on,
    'created', v_created, 'reactivated', v_react, 'deactivated', v_deact, 'applied', true, 'actor', p_actor);
end;
$sync$;

comment on function sync_campaigns(text, boolean, int, int) is
  'Reconciles the campaigns table against the current Agent List: creates newly named campaigns, reactivates returning ones, deactivates (never deletes) ones no agent carries. Plans by default; p_apply writes. Refuses whole on a short list, a campaign-less list, or more than p_max_deactivate going quiet at once.';
revoke all on function sync_campaigns(text, boolean, int, int) from public;

-- Seed from the list as it stands, so the table is never empty after this runs.
select sync_campaigns('migration-019', true);
