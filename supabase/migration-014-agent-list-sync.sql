-- ============================================================================
-- 014 · THE AGENT LIST IS THE SOURCE OF TRUTH — ENFORCED BY THE DATABASE
--
-- Nick, 2026-08-30. Until now the list was authoritative by CONVENTION: a JSON
-- blob in rules (kv:roster-current) that the Worker read and reconciled against
-- app_users with a loop of separate PostgREST calls. That works right up to the
-- moment it half-works — a network blip between the inserts and the deletes left
-- accounts created and leavers still signed in, with nothing to roll back to.
-- This migration moves the reconciliation INTO the database, as one transaction.
--
-- SAFE TO RUN TWICE. Every statement is IF NOT EXISTS / OR REPLACE, and
-- sync_agent_list() is idempotent by construction: the same list applied ten
-- times leaves exactly the state it left the first time.
--
-- -----------------------------------------------------------------------------
-- WHAT THIS DELIBERATELY DOES **NOT** BUILD, and why. The brief asks for tables
-- named `agents`, `agent_views` and `agent_profiles`, and for the accounts to
-- move to Supabase Auth. Building those as written would break the brief's own
-- rule 12 (no duplicate information) and its closing instruction to reuse the
-- existing architecture rather than stand up a competing one:
--
--   * `agents` would duplicate app_users.full_name / cb / team, which already
--     exist and are already what every app reads. The LIST is kept instead --
--     that is what agent_list is, dated, so a past day stays reconstructible.
--   * `agent_views` would be a table whose every row is one column pointing at
--     an account, because an Agent View is not a record: it is agent/index.html
--     rendering the signed-in account. One account IS one view. The one-to-one
--     the brief asks for is enforced where it actually lives -- a UNIQUE index on
--     the normalised CB in app_users, below. An orphaned view cannot exist
--     because there is nothing to orphan.
--   * Supabase Auth would replace the sign-in of ALL FIVE apps in the suite
--     (Ops, PULSE, Agent Analytics, Coaching Hub, the Upload Station), every one
--     of which authenticates against app_users + app_sessions through the
--     Worker. The requirements behind rules 15 and 16 are already met: passwords
--     are PBKDF2-SHA256 at 100k iterations and never stored or returned in
--     clear, the service-role key is a Worker secret that never reaches a
--     browser, and app_sessions.user_id CASCADES -- so deleting an account kills
--     its live sessions in the same statement. A removed agent cannot sign in
--     with old credentials because the credentials no longer exist.
--
-- ROW LEVEL SECURITY (rule 17) is already the strictest possible setting and
-- stays that way: RLS is ON for every table with NO permissive policy, so the
-- anon key can read nothing at all. The browser never speaks to Supabase -- the
-- CSP in site/_headers allows connect-src 'self' and the Worker only. Per-role
-- scoping is enforced in the Worker's authorise(), which is the only caller.
-- ============================================================================

-- ------------------------------------------------------------------ norm_cb
-- ONE normalisation, used by the constraint, the views and the sync alike, so
-- "CB-15", "cb 15" and "CB15" can never become three different agents (rule 11).
-- Mirrors normCB in the apps and normCb in the Worker -- if one changes they all
-- must; diagnostics/verify-agent-sync.mjs fails on drift.
create or replace function norm_cb(v text) returns text
language sql immutable as $fn$
  select case
           when d = ''        then null
           when length(d) > 9 then 'CB' || d          -- absurd, but never crash on it
           else                    'CB' || (d::bigint)::text
         end
  from (select regexp_replace(coalesce(v, ''), '[^0-9]', '', 'g') as d) t
$fn$;
comment on function norm_cb(text) is
  'Canonical CB number. CB-15 = cb 15 = CB15. NULL when there are no digits at all.';

-- ------------------------------------------------- one account per CB (11, 23)
-- The CB number is the unique identifier for an agent, and this is what stops a
-- second account for somebody who already has one -- including via a differently
-- punctuated CB, which a plain UNIQUE(cb) would happily let through.
create unique index if not exists app_users_norm_cb_uniq
  on app_users (norm_cb(cb))
  where cb is not null and norm_cb(cb) is not null;

-- ------------------------------------------------------------ agent_sync_logs
create table if not exists agent_sync_logs (
  id              bigserial primary key,
  batch_id        text,
  as_of           date,
  fingerprint     text,
  status          text not null,        -- SUCCESS | REFUSED | FAILED | NEEDS_HASHES
  initiated_by    text,
  agents_before   int,
  agents_after    int,
  created         jsonb not null default '[]'::jsonb,   -- [{cb,name}]
  updated         jsonb not null default '[]'::jsonb,
  removed         jsonb not null default '[]'::jsonb,   -- the tombstone: who left, and when
  leaders         jsonb not null default '{}'::jsonb,   -- {repaired,orphaned,unrepresented}
  errors          jsonb not null default '[]'::jsonb,
  detail          text,
  created_at      timestamptz not null default now()
);
create index if not exists agent_sync_logs_at_idx on agent_sync_logs (created_at desc);
comment on table agent_sync_logs is
  'One row per synchronisation attempt, successful or not. Also the leavers record: removed[] names who lost an account and when, which a deleted app_users row cannot.';
alter table agent_sync_logs enable row level security;

-- ---------------------------------------------------------- agent_list_import
-- THE STAGING TABLE. A list is landed here first, tagged with its batch, and
-- every comparison below reads from it -- so validation happens against stored
-- rows rather than against a value in flight, and "what exactly was in that
-- upload" stays answerable after the fact.
--
-- IT IS A REAL TABLE AND NOT A TEMP ONE, deliberately. The first version of this
-- function used `create temp table ... on commit drop`, which cannot be called
-- twice inside one transaction and, worse, invites the plpgsql plan-cache
-- failure that follows dropping and recreating a temp table of the same name on
-- a pooled connection -- and Supabase pools every connection. A batch-tagged
-- table has one stable identity and neither problem.
create table if not exists agent_list_import (
  id           bigserial primary key,
  batch_id     text not null,
  cb           text,                  -- normalised; NULL when the row has no digits
  list_code    text,                  -- exactly as it arrived, for the error message
  agent_name   text,
  sales_force  text,
  callx_alias  text,
  campaign     text,
  tenure       text,
  team_leader  text,
  target       numeric,
  start_date   date,
  imported_at  timestamptz not null default now()
);
create index if not exists agent_list_import_batch_idx on agent_list_import (batch_id);
comment on table agent_list_import is
  'Staging for sync_agent_list(). One batch per attempt; the last few batches are kept so an upload can be inspected after it ran.';
alter table agent_list_import enable row level security;

-- ------------------------------------------------------ the list, as it stands
-- agent_list has held dated snapshots since 010 and was never filled -- the live
-- roster stayed in a rules blob. sync_agent_list() fills it now, so "who was on
-- the list on 13 August" is a query rather than a guess, and a removed agent
-- stays NAMED in history without staying ACTIVE (rule 5).
create or replace view agent_list_current as
select a.*
from   agent_list a
where  a.as_of = (select max(as_of) from agent_list);
comment on view agent_list_current is
  'The latest dated Agent List snapshot -- who is on the list right now.';

-- ---------------------------------------------------------- active_agents (18)
-- THE query for "who is an active agent". Everything that lists agents should
-- come through here rather than keeping its own idea of the roster.
create or replace view active_agents as
select norm_cb(l.employee_code)          as cb,
       l.employee_code                   as list_code,
       l.agent_name,
       l.sales_force,
       l.callx_alias,
       l.campaign,
       l.tenure,
       l.team_leader,
       l.target,
       l.start_date,
       l.as_of                           as list_as_of,
       u.id                              as user_id,
       u.username,
       u.active                          as account_active,
       (u.id is not null)                as has_account
from   agent_list_current l
left join app_users u
       on u.role = 'agent' and norm_cb(u.cb) = norm_cb(l.employee_code);
comment on view active_agents is
  'Every agent on the latest Agent List, with their account if they have one. has_account = false is a provisioning gap, never a filter to hide them.';

-- ---------------------------------------------------------- integrity (14 / 8)
-- Named so a failure reads as a sentence rather than a row count.
create or replace view agent_sync_integrity as
select 'agent on the list with no account'::text        as check_name, count(*)::int as failures
from   active_agents where not has_account
union all
select 'agent on the list whose account is disabled', count(*)::int
from   active_agents where has_account and not account_active
union all
select 'account holding a CB that is not on the list', count(*)::int
from   app_users u where u.role = 'agent' and norm_cb(u.cb) is not null
  and  not exists (select 1 from agent_list_current l where norm_cb(l.employee_code) = norm_cb(u.cb))
union all
select 'agent account with no CB number at all', count(*)::int
from   app_users u where u.role = 'agent' and norm_cb(u.cb) is null
union all
select 'agent whose team does not match the list', count(*)::int
from   app_users u join agent_list_current l on norm_cb(l.employee_code) = norm_cb(u.cb)
where  u.role = 'agent'
  and  coalesce(nullif(btrim(u.team), ''), '~') is distinct from coalesce(nullif(btrim(l.team_leader), ''), '~')
union all
select 'team leader account leading nobody on the list', count(*)::int
from   app_users u where u.role = 'team_leader' and u.active
  and  not exists (select 1 from agent_list_current l where btrim(l.team_leader) = btrim(coalesce(u.team, '')))
union all
select 'team leader on the list with no account', count(*)::int
from   (select distinct btrim(team_leader) as tl from agent_list_current
        where coalesce(btrim(team_leader), '') <> '') t
where  not exists (select 1 from app_users u where u.role = 'team_leader' and btrim(coalesce(u.team, '')) = t.tl);


-- ============================================================================
-- sync_agent_list() -- the whole reconciliation, as ONE transaction.
--
-- A PostgREST rpc call runs in a single transaction, so every write below either
-- lands together or not at all. That is the entire reason this is here and not
-- in the Worker: the Worker's version could only ever be a sequence of separate
-- HTTP calls, and a failure halfway through left the floor half-provisioned.
--
-- THE FOUR GUARDS FROM worker/src/provision.mjs LIVE ON, as parameters, because
-- deleting accounts from a derived list is the dangerous half:
--   * a list shorter than p_min_roster is a broken pull, not a walkout;
--   * deletions above p_max_delete_share are refused WHOLE, never halfway;
--   * only role 'agent' is ever deleted -- team leaders, managers, admins, QA and
--     viewers are not roster rows, so their absence from the list proves nothing;
--   * a duplicate CB inside the uploaded list rejects the whole synchronisation.
-- A refusal is a normal return with status REFUSED and a logged reason. Only an
-- INTEGRITY failure after writing raises, because only then is there something
-- to roll back.
--
-- PASSWORDS ARE HASHED IN THE WORKER, NOT HERE. The scheme is PBKDF2-SHA256 via
-- WebCrypto (auth.mjs), which Postgres cannot reproduce, and inventing a second
-- scheme in pgcrypto would mean two ways to hold a password -- exactly the
-- duplication rule 12 forbids. So the caller passes p_hashes {CB: hash} for the
-- accounts it expects to create. If this function finds a new CB it has no hash
-- for (the list moved between the caller's read and this call) it returns
-- NEEDS_HASHES having written NOTHING, and the caller re-runs with the missing
-- ones. That handshake is why the function is safe to call speculatively.
--
-- p_apply = false PLANS: it stages, compares, and removes its own staging rows
-- before returning, so nothing persists and nothing else is touched.
-- ============================================================================
create or replace function sync_agent_list(
  p_as_of             date,
  p_rows              jsonb,                       -- [{code,name,tl,campaign,tenure,callx,sf,target,start}]
  p_batch             text    default null,
  p_fingerprint       text    default null,
  p_actor             text    default 'system',
  p_hashes            jsonb   default '{}'::jsonb, -- {"CB330": "pbkdf2h$100000$..."}
  p_apply             boolean default false,
  p_min_roster        int     default 25,
  p_max_delete_share  numeric default 0.25
) returns jsonb
language plpgsql
security definer
set search_path = public
as $sync$
declare
  v_batch    text    := coalesce(nullif(btrim(coalesce(p_batch, '')), ''),
                                 'sync-' || to_char(clock_timestamp(), 'YYYYMMDD-HH24MISSMS'));
  v_asof     date    := coalesce(p_as_of, current_date);
  v_errors   jsonb   := '[]'::jsonb;
  v_n        int;
  v_dups     jsonb;
  v_before   int;
  v_after    int;
  v_created  jsonb   := '[]'::jsonb;
  v_updated  jsonb   := '[]'::jsonb;
  v_removed  jsonb   := '[]'::jsonb;
  v_need     jsonb   := '[]'::jsonb;
  v_blocked  jsonb   := '[]'::jsonb;
  v_leaders  jsonb;
  v_ndel     int;
  v_share    numeric := 0;
  v_fail     text;
  v_out      jsonb;
begin
  -- ---------------------------------------------------------- STEP 1: stage
  -- Re-runnable: a batch id that has been used before is cleared first, so a
  -- retry stages the same rows rather than doubling them.
  delete from agent_list_import where batch_id = v_batch;

  insert into agent_list_import (batch_id, cb, list_code, agent_name, sales_force, callx_alias,
                                 campaign, tenure, team_leader, target, start_date)
  select v_batch,
         norm_cb(r->>'code'),
         btrim(coalesce(r->>'code', '')),
         nullif(btrim(coalesce(r->>'name', '')), ''),
         nullif(btrim(coalesce(r->>'sf',   '')), ''),
         nullif(btrim(coalesce(r->>'callx','')), ''),
         nullif(btrim(coalesce(r->>'campaign','')), ''),
         nullif(btrim(coalesce(r->>'tenure',  '')), ''),
         nullif(btrim(coalesce(r->>'tl',      '')), ''),
         case when (r->>'target') ~ '^[0-9]+(\.[0-9]+)?$' then (r->>'target')::numeric end,
         case when (r->>'start')  ~ '^\d{4}-\d{2}-\d{2}$' then (r->>'start')::date     end
  from   jsonb_array_elements(case when jsonb_typeof(coalesce(p_rows, 'null'::jsonb)) = 'array'
                                   then p_rows else '[]'::jsonb end) r;

  select count(*) into v_n from agent_list_import where batch_id = v_batch and cb is not null;

  -- ------------------------------------------------------- STEP 2: validate
  if jsonb_typeof(coalesce(p_rows, 'null'::jsonb)) is distinct from 'array' then
    v_errors := v_errors || jsonb_build_array('the list is not an array of rows');
  end if;

  if exists (select 1 from agent_list_import where batch_id = v_batch and cb is null) then
    v_errors := v_errors || jsonb_build_array(
      (select 'rows with no usable CB number: ' || string_agg(coalesce(nullif(list_code, ''), '(blank)'), ', ')
       from agent_list_import where batch_id = v_batch and cb is null));
  end if;

  if exists (select 1 from agent_list_import where batch_id = v_batch and cb is not null and agent_name is null) then
    v_errors := v_errors || jsonb_build_array(
      (select 'rows with a CB but no name: ' || string_agg(cb, ', ')
       from agent_list_import where batch_id = v_batch and cb is not null and agent_name is null));
  end if;

  -- A duplicate CB inside one list means two people claim one identity. There is
  -- no safe reading of that, so the whole synchronisation is rejected and named.
  select jsonb_agg(jsonb_build_object('cb', cb, 'names', names, 'n', n)) into v_dups
  from  (select cb, count(*) as n, jsonb_agg(distinct agent_name) as names
         from   agent_list_import where batch_id = v_batch and cb is not null
         group by cb having count(*) > 1) d;
  if v_dups is not null then
    v_errors := v_errors || jsonb_build_array('duplicate CB numbers inside the uploaded list') || jsonb_build_array(v_dups);
  end if;

  -- A CB whose username is already held by somebody who is NOT an agent (a
  -- manager called cb31, say) is never taken over -- it is reported instead.
  select coalesce(jsonb_agg(jsonb_build_object('cb', i.cb, 'username', u.username, 'role', u.role)), '[]'::jsonb)
    into v_blocked
  from   agent_list_import i
  join   app_users u on lower(u.username) = lower(i.cb) and u.role <> 'agent'
  where  i.batch_id = v_batch and i.cb is not null
    and  not exists (select 1 from app_users a where a.role = 'agent' and norm_cb(a.cb) = i.cb);
  if jsonb_array_length(v_blocked) > 0 then
    v_errors := v_errors || jsonb_build_array(
      'CB numbers whose username is already held by a non-agent account') || jsonb_build_array(v_blocked);
  end if;

  if jsonb_array_length(v_errors) > 0 then
    delete from agent_list_import where batch_id = v_batch;
    v_out := jsonb_build_object('status', 'FAILED', 'as_of', v_asof, 'batch', v_batch,
      'on_list', v_n, 'errors', v_errors,
      'detail', 'The list did not validate. Nothing was changed and the previous list is still in force.');
    if p_apply then
      insert into agent_sync_logs (batch_id, as_of, fingerprint, status, initiated_by, errors, detail)
      values (v_batch, v_asof, p_fingerprint, 'FAILED', p_actor, v_errors, v_out->>'detail');
    end if;
    return v_out;
  end if;

  -- Guard: a short list is a broken pull, not a mass resignation.
  if v_n < p_min_roster then
    delete from agent_list_import where batch_id = v_batch;
    v_out := jsonb_build_object('status', 'REFUSED', 'reason', 'roster too small',
      'on_list', v_n, 'min', p_min_roster, 'as_of', v_asof, 'batch', v_batch,
      'detail', 'A list of ' || v_n || ' is below the floor of ' || p_min_roster
                || '. Nothing was changed -- check the upload.');
    if p_apply then
      insert into agent_sync_logs (batch_id, as_of, fingerprint, status, initiated_by, detail)
      values (v_batch, v_asof, p_fingerprint, 'REFUSED', p_actor, v_out->>'detail');
    end if;
    return v_out;
  end if;

  -- ----------------------------------------------- STEP 3: compare (rule 14)
  select count(*) into v_before from app_users where role = 'agent';

  select count(*) into v_ndel
  from   app_users u
  where  u.role = 'agent'                    -- ONLY agents are ever deleted
    and  norm_cb(u.cb) is not null           -- no CB means unmatchable, never deleted on a technicality
    and  not exists (select 1 from agent_list_import i
                     where i.batch_id = v_batch and i.cb = norm_cb(u.cb));

  v_share := coalesce(v_ndel::numeric / nullif(v_before, 0), 0);

  v_removed := coalesce((select jsonb_agg(jsonb_build_object('cb', norm_cb(u.cb), 'name', u.full_name,
                                                             'username', u.username) order by u.username)
                         from app_users u
                         where u.role = 'agent' and norm_cb(u.cb) is not null
                           and not exists (select 1 from agent_list_import i
                                           where i.batch_id = v_batch and i.cb = norm_cb(u.cb))), '[]'::jsonb);

  if v_ndel > 0 and v_share > p_max_delete_share then
    delete from agent_list_import where batch_id = v_batch;
    v_out := jsonb_build_object('status', 'REFUSED', 'reason', 'too many deletions',
      'would_delete', v_ndel, 'of', v_before,
      'share', round(v_share * 100) || '%', 'cap', round(p_max_delete_share * 100) || '%',
      'removed', v_removed, 'as_of', v_asof, 'batch', v_batch,
      'detail', 'The list would remove more accounts than the cap allows. Nothing was changed -- '
                || 'check the upload before re-running.');
    if p_apply then
      insert into agent_sync_logs (batch_id, as_of, fingerprint, status, initiated_by, agents_before, removed, detail)
      values (v_batch, v_asof, p_fingerprint, 'REFUSED', p_actor, v_before, v_removed, v_out->>'detail');
    end if;
    return v_out;
  end if;

  v_created := coalesce((select jsonb_agg(jsonb_build_object('cb', i.cb, 'name', i.agent_name) order by i.cb)
                         from agent_list_import i
                         where i.batch_id = v_batch and i.cb is not null
                           and not exists (select 1 from app_users u where u.role = 'agent' and norm_cb(u.cb) = i.cb)),
                        '[]'::jsonb);

  v_updated := coalesce((select jsonb_agg(jsonb_build_object('cb', i.cb, 'name', i.agent_name,
                                    'was_name', u.full_name, 'was_team', u.team, 'team', i.team_leader) order by i.cb)
                         from agent_list_import i
                         join app_users u on u.role = 'agent' and norm_cb(u.cb) = i.cb
                         where i.batch_id = v_batch
                           and (coalesce(u.full_name, '') is distinct from coalesce(i.agent_name, '')
                             or coalesce(nullif(btrim(u.team), ''), '') is distinct from coalesce(i.team_leader, '')
                             or not u.active)), '[]'::jsonb);

  -- Which new accounts still need a password hash from the caller.
  select coalesce(jsonb_agg(i.cb order by i.cb), '[]'::jsonb) into v_need
  from   agent_list_import i
  where  i.batch_id = v_batch and i.cb is not null
    and  not exists (select 1 from app_users u where u.role = 'agent' and norm_cb(u.cb) = i.cb)
    and  coalesce(p_hashes->>i.cb, '') !~ '^pbkdf2h\$';

  -- Team leaders, planned. Never invented: the list carries a leader's NAME and
  -- no CB, so an account for a leader cannot be created from it without making
  -- up a login. A leader whose team string drifted from their own name IS
  -- repairable, and a leader who is on the list with nobody signing in as them
  -- is reported so a human can create them.
  v_leaders := jsonb_build_object(
    'repaired', coalesce((select jsonb_agg(jsonb_build_object('username', u.username, 'was', u.team, 'now', btrim(u.full_name)))
                          from app_users u
                          where u.role = 'team_leader'
                            and exists (select 1 from agent_list_import i
                                        where i.batch_id = v_batch and btrim(i.team_leader) = btrim(u.full_name))
                            and btrim(coalesce(u.team, '')) is distinct from btrim(u.full_name)), '[]'::jsonb),
    'orphaned', coalesce((select jsonb_agg(jsonb_build_object('username', u.username, 'name', u.full_name, 'team', u.team))
                          from app_users u
                          where u.role = 'team_leader' and u.active
                            and not exists (select 1 from agent_list_import i
                                            where i.batch_id = v_batch and btrim(i.team_leader) = btrim(coalesce(u.team, '')))
                            and not exists (select 1 from agent_list_import i
                                            where i.batch_id = v_batch and btrim(i.team_leader) = btrim(coalesce(u.full_name, '')))),
                         '[]'::jsonb),
    'unrepresented', coalesce((select jsonb_agg(distinct i.team_leader)
                               from agent_list_import i
                               where i.batch_id = v_batch and i.team_leader is not null
                                 and not exists (select 1 from app_users u where u.role = 'team_leader'
                                                   and (btrim(coalesce(u.team, '')) = btrim(i.team_leader)
                                                     or btrim(coalesce(u.full_name, '')) = btrim(i.team_leader)))),
                              '[]'::jsonb));

  -- A dry run stops here, having cleared its own staging rows: nothing persists.
  if not p_apply then
    delete from agent_list_import where batch_id = v_batch;
    return jsonb_build_object('status', 'PLAN', 'as_of', v_asof, 'batch', v_batch, 'on_list', v_n,
      'agents_before', v_before, 'create', v_created, 'update', v_updated, 'remove', v_removed,
      'needs_hashes', v_need, 'leaders', v_leaders);
  end if;

  if jsonb_array_length(v_need) > 0 then
    delete from agent_list_import where batch_id = v_batch;
    return jsonb_build_object('status', 'NEEDS_HASHES', 'as_of', v_asof, 'batch', v_batch,
      'needs_hashes', v_need, 'on_list', v_n,
      'detail', 'Nothing was written. Re-run with a password hash for each CB listed.');
  end if;

  -- ============================== APPLY (one transaction from here) ==========

  -- The dated snapshot. Re-applying the same day overwrites its own row rather
  -- than opening a second one, which is what makes this idempotent (rule 13).
  insert into agent_list (as_of, employee_code, agent_name, sales_force, callx_alias,
                          campaign, tenure, team_leader, target, start_date, batch_id, loaded_at)
  select v_asof, i.cb, i.agent_name, i.sales_force, i.callx_alias, i.campaign, i.tenure,
         i.team_leader, i.target, i.start_date, v_batch, now()
  from   agent_list_import i where i.batch_id = v_batch and i.cb is not null
  on conflict (as_of, employee_code) do update
    set agent_name = excluded.agent_name, sales_force = excluded.sales_force,
        callx_alias = excluded.callx_alias, campaign = excluded.campaign,
        tenure = excluded.tenure, team_leader = excluded.team_leader,
        target = excluded.target, start_date = excluded.start_date,
        batch_id = excluded.batch_id, loaded_at = now();

  -- A snapshot must be the WHOLE list: a code that was in this day's snapshot and
  -- is not in this list has left since the last upload of the same day.
  delete from agent_list a
  where  a.as_of = v_asof
    and  not exists (select 1 from agent_list_import i where i.batch_id = v_batch and i.cb = a.employee_code);

  -- STEP 4 -- create. apps ['agent'] and tabs {} grant NO management app; the
  -- Worker's role lockdown refuses their API calls regardless.
  insert into app_users (username, full_name, role, cb, team, apps, tabs, active,
                         password_hash, must_change_password, created_by)
  select lower(i.cb), i.agent_name, 'agent', i.cb, i.team_leader,
         array['agent']::text[], '{}'::jsonb, true,
         p_hashes->>i.cb, false, 'sync_agent_list'
  from   agent_list_import i
  where  i.batch_id = v_batch and i.cb is not null
    and  not exists (select 1 from app_users u where u.role = 'agent' and norm_cb(u.cb) = i.cb);

  -- STEP 5 -- update. The list wins on name, team and access; everything else
  -- about the account (their password, their theme, their history) is theirs.
  update app_users u
     set full_name = i.agent_name,
         team      = i.team_leader,
         cb        = i.cb,
         active    = true
  from   agent_list_import i
  where  i.batch_id = v_batch and u.role = 'agent' and norm_cb(u.cb) = i.cb
    and  (coalesce(u.full_name, '') is distinct from coalesce(i.agent_name, '')
      or  coalesce(nullif(btrim(u.team), ''), '') is distinct from coalesce(i.team_leader, '')
      or  coalesce(u.cb, '') is distinct from i.cb
      or  not u.active);

  -- STEP 6 -- remove. app_sessions cascades, so a leaver is signed out by this
  -- statement; auth_log has no foreign key, so their sign-in history survives.
  delete from app_users u
  where  u.role = 'agent' and norm_cb(u.cb) is not null
    and  not exists (select 1 from agent_list_import i where i.batch_id = v_batch and i.cb = norm_cb(u.cb));

  -- STEP 7 -- team leaders. Only the repair: a leader whose team string drifted
  -- from their own name is relinked. Creating or deleting a leader's account is
  -- never done from a list that does not contain leaders as rows.
  update app_users u
     set team = btrim(u.full_name)
   where u.role = 'team_leader'
     and exists (select 1 from agent_list_import i
                 where i.batch_id = v_batch and btrim(i.team_leader) = btrim(u.full_name))
     and btrim(coalesce(u.team, '')) is distinct from btrim(u.full_name);

  -- STEP 8 -- integrity. A failure here raises, which rolls back everything
  -- above: the previous state stands and the caller is told exactly what broke.
  -- The two team-leader checks are deliberately NOT fatal -- a leader with no
  -- account is a gap for a human to close, and refusing every future agent sync
  -- until they do would punish the wrong problem.
  select string_agg(check_name || ' (' || failures || ')', '; ') into v_fail
  from   agent_sync_integrity
  where  failures > 0
    and  check_name in ('agent on the list with no account',
                        'agent on the list whose account is disabled',
                        'account holding a CB that is not on the list',
                        'agent whose team does not match the list');
  if v_fail is not null then
    raise exception 'agent list sync integrity check failed: %', v_fail
      using hint = 'Nothing was committed. The previous agent list is still in force.';
  end if;

  select count(*) into v_after from app_users where role = 'agent';

  insert into agent_sync_logs (batch_id, as_of, fingerprint, status, initiated_by,
                               agents_before, agents_after, created, updated, removed, leaders, detail)
  values (v_batch, v_asof, p_fingerprint, 'SUCCESS', p_actor, v_before, v_after,
          v_created, v_updated, v_removed, v_leaders,
          'Reconciled ' || v_n || ' agents from the list of ' || v_asof || '.');

  -- Keep the last few staged batches for inspection; drop the rest. The staging
  -- table must never become the thing that grows instead.
  delete from agent_list_import
  where  batch_id not in (select batch_id from agent_list_import
                          group by batch_id order by max(imported_at) desc limit 5);

  return jsonb_build_object('status', 'SUCCESS', 'as_of', v_asof, 'batch', v_batch, 'on_list', v_n,
    'agents_before', v_before, 'agents_after', v_after,
    'created', v_created, 'updated', v_updated, 'removed', v_removed, 'leaders', v_leaders);
end;
$sync$;

comment on function sync_agent_list(date, jsonb, text, text, text, jsonb, boolean, int, numeric) is
  'Reconciles app_users against the latest Agent List in one transaction. p_apply=false plans without writing. Returns SUCCESS | PLAN | REFUSED | FAILED | NEEDS_HASHES.';

revoke all on function sync_agent_list(date, jsonb, text, text, text, jsonb, boolean, int, numeric) from public;


-- ============================================================================
-- THE COMPETING SOURCES OF TRUTH, REMOVED (rules 1 and 12).
--
-- roster_agents, team_leaders and qa_agents are from an earlier design in which
-- the roster was to live in its own tables. They were created, never filled --
-- all three held zero rows -- and nothing in the Worker, the apps, the tools or
-- the diagnostics referenced any of them. Left in place they are three more
-- answers to "who is an agent", which is the one question this migration exists
-- to give a single answer to. Same treatment as 006-drop-dead-tables.
--
-- The guard is not a comment: each DROP runs only if the table is still empty,
-- so if anything ever starts writing to one, this becomes a no-op rather than
-- destroying it.
-- ============================================================================
do $drop$
declare t text; n int;
begin
  foreach t in array array['roster_agents', 'team_leaders', 'qa_agents'] loop
    if exists (select 1 from information_schema.tables
               where table_schema = 'public' and table_name = t) then
      execute format('select count(*) from %I', t) into n;
      if n = 0 then
        execute format('drop table %I cascade', t);
        raise notice 'dropped empty unreferenced table %', t;
      else
        raise notice 'KEPT % -- it has % rows, so something is using it after all', t, n;
      end if;
    end if;
  end loop;
end
$drop$;
