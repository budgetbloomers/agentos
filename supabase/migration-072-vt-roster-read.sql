-- migration-072-vt-roster-read.sql — WHO IS ON VEHICLE TRACKING, AS THE LIST STOOD (Spec Kit 071, plan DB-7.1, 2026-11-23)
--
-- WHY. VT attribution (team leader, sub-campaign, tenure, target) comes from the Agent List in force for the business
-- month (FR-018, the whole-month rule). The VT sub-campaign ("Matrix Vehicle Tracking - Digital / Predictive / Referral /
-- Scheduling") exists ONLY in agent_list_raw.campaign_raw — the roster of record folds every VT row to campaign 'VT'.
-- So this adds one READ-ONLY function over the snapshots publish_agent_list() already stores: the latest ACCEPTED VT
-- snapshot dated on or before p_on. It touches neither publish_agent_list() nor any sync_* function, writes nothing, and
-- adds no second list ingester: the list is still uploaded once, in the VAS Upload Station.
--
--   vt_roster_at(p_on date) → {as_of, rows:[{code, name, sf, tl, tl_code, campaign_raw, tenure, target, start_date, as_of}]}
--
-- The sub-campaign is parsed from campaign_raw by the VT engine (VTEngine.subOf, the rule book's teams.fromCampaignRaw),
-- not here — the rule lives once. target is NULL for "-", blank or 0 (the engine: no target → unmeasured, never 0).
-- tl_code comes from team_leader_cbs (the list names a leader, never their CB); a leader without a CB stays NULL.
-- The station asks for p_on = the business month's last day, so a list dated inside the month wins the whole month.
--
-- Apply: node tools/apply-migration.mjs supabase/migration-072-vt-roster-read.sql   (the OWNER, at deploy — after 071)
-- Guarded by nicks_code/diagnostics/verify-vt-db.mjs (D14).

-- the function is SECURITY INVOKER: the Worker's role reads the two tables itself (Supabase grants this by default; said here)
grant select on table agent_list_raw, team_leader_cbs to service_role;

create index if not exists agent_list_raw_vt_idx on agent_list_raw (as_of desc) where campaign = 'VT' and accepted;

create or replace function vt_roster_at(p_on date)
returns jsonb language sql stable security invoker set search_path = public as $$
  with snap as (
    select max(as_of) as a from agent_list_raw where campaign = 'VT' and accepted and as_of <= p_on
  )
  select jsonb_build_object(
    'as_of', s.a,
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
               'code', r.code, 'name', r.name, 'sf', r.sf, 'tl', r.tl, 'tl_code', nullif(trim(t.employee_code), ''),
               'campaign_raw', r.campaign_raw, 'tenure', r.tenure, 'target', case when r.target > 0 then r.target end,
               'start_date', r.start_date, 'as_of', r.as_of) order by r.ord, r.id)
        from agent_list_raw r
        left join team_leader_cbs t on lower(trim(t.leader_name)) = lower(trim(r.tl))
       where r.as_of = s.a and r.campaign = 'VT' and r.accepted), '[]'::jsonb))
  from snap s
$$;
revoke execute on function vt_roster_at(date) from public, anon, authenticated;
grant execute on function vt_roster_at(date) to service_role;
