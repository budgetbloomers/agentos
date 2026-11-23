-- migration-072-vt-roster-read.sql — WHO IS ON VEHICLE TRACKING, AS THE LIST STOOD (Spec Kit 071, plan DB-7.1, 2026-11-23; review fixes same day)
--
-- WHY. VT attribution (team leader, sub-campaign, tenure, target) comes from the Agent List in force for the business
-- month (FR-018, the whole-month rule). The VT sub-campaign ("Matrix Vehicle Tracking - Digital / Predictive / Referral /
-- Scheduling") exists ONLY in agent_list_raw.campaign_raw — the roster of record folds every VT row to campaign 'VT'.
-- So this adds one READ-ONLY function over the snapshots publish_agent_list() already stores: the latest ACCEPTED VT
-- snapshot dated on or before p_on. It touches neither publish_agent_list() nor any sync_* function, writes nothing, and
-- adds no second list ingester: the list is still uploaded once, in the VAS Upload Station.
--
--   vt_roster_at(p_on date) → {as_of, list_as_of, rows:[{code, name, sf, tl, tl_code, campaign_raw, tenure, target, start_date, as_of}]}
--
-- as_of is the VT snapshot used; list_as_of is the newest accepted list of ANY campaign on or before p_on (review
-- D-M9). When they differ, a newer list without VT rows has landed since — the engine/page can warn instead of
-- silently attributing on the older VT list.
-- The sub-campaign is parsed from campaign_raw by the VT engine (VTEngine.subOf, the rule book's teams.fromCampaignRaw),
-- not here — the rule lives once. target is NULL for "-", blank or 0 (the engine: no target → unmeasured, never 0).
-- tl_code comes from team_leader_cbs (the list names a leader, never their CB), joined the house way (migration-018:
-- btrim(leader_name); migration-014: norm_cb(employee_code)) through a LATERAL ... LIMIT 1 (review D-M8), so two
-- spellings of one leader in team_leader_cbs can never duplicate a roster row: the exact btrim spelling wins, then a
-- case-insensitive one, a row with a CB before one without. A leader without a CB stays NULL. Needs norm_cb (014).
-- The station asks for p_on = the business month's last day, so a list dated inside the month wins the whole month.
--
-- APPLYING (review): a 3-second lock timeout makes the index build on agent_list_raw fail fast instead of queueing a
-- list publish behind it; apply outside the upload / publish windows (deploy-checklist.md, Phase C).
--
-- Apply: node tools/apply-migration.mjs supabase/migration-072-vt-roster-read.sql   (the OWNER, at deploy — after 071)
-- Guarded by nicks_code/diagnostics/verify-vt-db.mjs (D14, R9, R10).

set local lock_timeout = '3s';

-- the function is SECURITY INVOKER: the Worker's role reads the two tables itself (Supabase grants this by default; said here)
grant select on table agent_list_raw, team_leader_cbs to service_role;

create index if not exists agent_list_raw_vt_idx on agent_list_raw (as_of desc) where campaign = 'VT' and accepted;

create or replace function vt_roster_at(p_on date)
returns jsonb language sql stable security invoker set search_path = public as $$
  with snap as (
    select (select max(as_of) from agent_list_raw where campaign = 'VT' and accepted and as_of <= p_on) as a,
           (select max(as_of) from agent_list_raw where accepted and as_of <= p_on) as l
  )
  select jsonb_build_object(
    'as_of', s.a,
    'list_as_of', s.l,
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
               'code', r.code, 'name', r.name, 'sf', r.sf, 'tl', r.tl, 'tl_code', t.cb,
               'campaign_raw', r.campaign_raw, 'tenure', r.tenure, 'target', case when r.target > 0 then r.target end,
               'start_date', r.start_date, 'as_of', r.as_of) order by r.ord, r.id)
        from agent_list_raw r
        left join lateral (
          select norm_cb(m.employee_code) as cb
            from team_leader_cbs m
           where lower(btrim(m.leader_name)) = lower(btrim(r.tl))
           order by (btrim(m.leader_name) = btrim(r.tl)) desc, (norm_cb(m.employee_code) is not null) desc, m.leader_name
           limit 1) t on true
       where r.as_of = s.a and r.campaign = 'VT' and r.accepted), '[]'::jsonb))
  from snap s
$$;
revoke execute on function vt_roster_at(date) from public, anon, authenticated;
grant execute on function vt_roster_at(date) to service_role;

-- PostgREST caches the schema: ask it to see the new function now (harmless if nothing listens; first in this project)
notify pgrst, 'reload schema';
