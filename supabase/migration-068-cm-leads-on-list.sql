-- migration-068-cm-leads-on-list.sql — a campaign manager named as a team leader has a login (2026-11-09)
--
-- The agent-list-out-of-sync alert said "team leader on the latest list with no login (2: Preshen Naidoo, Ryan Govender)"
-- every day. Both sign in, as campaign managers: a few agents on the Agent List name them directly as their leader, and
-- agent_list_integrity only counted a team_leader account. A campaign manager's login now counts. A leader with no login
-- at all is still flagged, which is what this check is for.
--
-- Ryan's account read "Ryan G" against the list's "Ryan Govender", so no name rule could match it; the user chose to give
-- the account his full name (2026-11-09). Only the display name changes: username, password and access stay; campaign
-- manager scope comes from cm:assignments by username, never from this name.
--
-- The view body is the live definition (pg_get_viewdef) with that one condition changed. CREATE OR REPLACE keeps the
-- view's grants and comment. Idempotent.

update app_users set full_name = 'Ryan Govender'
 where username = 'ryan' and role = 'campaign_manager' and full_name = 'Ryan G';

create or replace view agent_list_integrity as
WITH cur AS (
         SELECT agent_list_current.as_of,
            agent_list_current.employee_code,
            agent_list_current.agent_name,
            agent_list_current.sales_force,
            agent_list_current.callx_alias,
            agent_list_current.campaign,
            agent_list_current.tenure,
            agent_list_current.team_leader,
            agent_list_current.target,
            agent_list_current.start_date,
            agent_list_current.batch_id,
            agent_list_current.loaded_at
           FROM agent_list_current
        ), rec AS (
         SELECT rules.value ->> 'fingerprint'::text AS fp
           FROM rules
          WHERE rules.key = 'kv:roster-current'::text
        ), last_ok AS (
         SELECT agent_sync_logs.fingerprint
           FROM agent_sync_logs
          WHERE agent_sync_logs.status = 'SUCCESS'::text AND agent_sync_logs.fingerprint IS NOT NULL
          ORDER BY agent_sync_logs.created_at DESC
         LIMIT 1
        )
 SELECT 'agent on the latest list with no active login'::text AS check_name,
    'critical'::text AS severity,
    count(*)::integer AS failures,
    "left"(string_agg((active_agents.list_code || ' '::text) || COALESCE(active_agents.agent_name, ''::text), ', '::text ORDER BY active_agents.list_code), 300) AS detail
   FROM active_agents
  WHERE NOT active_agents.has_account OR NOT COALESCE(active_agents.account_active, false)
UNION ALL
 SELECT 'agent login that is not on the latest list'::text AS check_name,
    'critical'::text AS severity,
    count(*)::integer AS failures,
    "left"(string_agg(u.username, ', '::text ORDER BY u.username), 300) AS detail
   FROM app_users u
  WHERE u.role = 'agent'::text AND norm_cb(u.cb) IS NOT NULL AND NOT (EXISTS ( SELECT 1
           FROM cur l
          WHERE norm_cb(l.employee_code) = norm_cb(u.cb)))
UNION ALL
 SELECT 'campaign on the latest list that does not exist'::text AS check_name,
    'critical'::text AS severity,
    count(*)::integer AS failures,
    "left"(string_agg(c.label, ', '::text ORDER BY c.label), 300) AS detail
   FROM ( SELECT campaign_key(cur.campaign) AS key,
            min(btrim(cur.campaign)) AS label
           FROM cur
          WHERE campaign_key(cur.campaign) IS NOT NULL
          GROUP BY (campaign_key(cur.campaign))) c
  WHERE NOT (EXISTS ( SELECT 1
           FROM campaigns k
          WHERE k.key = c.key AND k.active))
UNION ALL
 SELECT 'campaign that the latest list does not carry'::text AS check_name,
    'critical'::text AS severity,
    count(*)::integer AS failures,
    "left"(string_agg(k.label, ', '::text ORDER BY k.label), 300) AS detail
   FROM campaigns k
  WHERE NOT (EXISTS ( SELECT 1
           FROM cur l
          WHERE campaign_key(l.campaign) = k.key))
UNION ALL
 SELECT 'team leader on the latest list with no login'::text AS check_name,
    'warning'::text AS severity,
    count(*)::integer AS failures,
    "left"(string_agg(t.leader, ', '::text ORDER BY t.leader), 300) AS detail
   FROM ( SELECT DISTINCT btrim(cur.team_leader) AS leader
           FROM cur
          WHERE COALESCE(btrim(cur.team_leader), ''::text) <> ''::text) t
  WHERE NOT (EXISTS ( SELECT 1
           FROM app_users u
          WHERE (u.role = ANY (ARRAY['team_leader'::text, 'campaign_manager'::text])) AND u.active AND (btrim(COALESCE(u.team, ''::text)) = t.leader OR btrim(COALESCE(u.full_name, ''::text)) = t.leader)))
UNION ALL
 SELECT 'roster of record is the last synchronised list'::text AS check_name,
    'critical'::text AS severity,
        CASE
            WHEN (( SELECT rec.fp
               FROM rec)) IS DISTINCT FROM (( SELECT last_ok.fingerprint
               FROM last_ok)) THEN 1
            ELSE 0
        END AS failures,
    (('record '::text || COALESCE(( SELECT rec.fp
           FROM rec), '(none)'::text)) || ' vs synced '::text) || COALESCE(( SELECT last_ok.fingerprint
           FROM last_ok), '(none)'::text) AS detail
UNION ALL
 SELECT 'active agent login without the Wimpy app'::text AS check_name,
    'warning'::text AS severity,
    count(*)::integer AS failures,
    "left"(string_agg(u.username, ', '::text ORDER BY u.username), 300) AS detail
   FROM app_users u
  WHERE u.active AND (u.role = ANY (ARRAY['agent'::text, 'team_leader'::text])) AND NOT ('wimpy'::text = ANY (COALESCE(u.apps, ARRAY[]::text[])));
