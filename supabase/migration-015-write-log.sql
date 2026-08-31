-- ============================================================================
-- 015 · THE DATABASE KNOWS WHEN EACH STORE LAST MOVED — AND SAYS SO
--
-- Phase 2/5 of specs/save-reliability-plan.md (the 28–31 Aug incident: every
-- PULSE save silently refused by the browser for four days; the server had no
-- idea because the requests never arrived, and nothing compared the stores'
-- timestamps against each other).
--
-- Two objects, both read-side:
--   kv_write_log     — one row per successful /api/kv POST, written by the
--                      Worker. History, where the rules pointer holds only the
--                      latest. This is the ground truth for "when did each
--                      store last actually move".
--   store_freshness  — named sentence-checks over the stores' timestamps, so a
--                      human or a script can SELECT the health of persistence.
--                      Precedent: agent_sync_integrity (migration-014).
--
-- SAFE TO RUN TWICE — everything is IF NOT EXISTS / OR REPLACE.
-- ============================================================================

create table if not exists kv_write_log (
  id        bigserial primary key,
  key       text not null,
  bytes     int,
  username  text,
  at        timestamptz not null default now()
);
create index if not exists kv_write_log_key_idx on kv_write_log (key, at desc);
create index if not exists kv_write_log_at_idx  on kv_write_log (at);
comment on table kv_write_log is
  'One row per successful /api/kv POST. The rules pointer only holds the latest write; this holds the history, so "when did saves stop" is a query. Pruned past 90 days by the Worker cron.';
alter table kv_write_log enable row level security;

-- ---------------------------------------------------------------------------
-- store_freshness — every check is a sentence, every failure is a count.
--
-- THE SENTINEL RULE IS DERIVED FROM ACTIVITY, NOT A SCHEDULE. The floor does
-- not upload on Sundays, so "state must move daily" would cry wolf weekly.
-- What can never legitimately happen is the incident's signature: raw files
-- arriving in the upload archive while NEITHER dashboard's state blob moves —
-- the relay working while the saves fail.
--
-- Staff logins (usernames that are not cb<digits>) gate the absolute-staleness
-- checks for the same reason: a quiet day with nobody signed in proves nothing.
-- ---------------------------------------------------------------------------
create or replace view store_freshness as
with k as (
  select
    max(updated_at) filter (where key = 'kv:upload-manifest') as manifest,
    max(updated_at) filter (where key = 'kv:vas-state')       as vas,
    max(updated_at) filter (where key = 'kv:cb-config')       as ops
  from rules
),
staff as (
  select count(*) as recent
  from   auth_log
  where  event = 'login_ok'
    and  at > now() - interval '26 hours'
    and  username !~* '^cb[0-9]+$'
)
select 'uploads archived but neither dashboard state saved within the hour'::text as check_name,
       case when k.manifest is not null
             and k.manifest > coalesce(k.vas, 'epoch'::timestamptz) + interval '60 minutes'
             and k.manifest > coalesce(k.ops, 'epoch'::timestamptz) + interval '60 minutes'
            then 1 else 0 end as failures
from k
union all
select 'PULSE state older than 26h despite staff sign-ins since',
       case when s.recent > 0
             and coalesce(k.vas, 'epoch'::timestamptz) < now() - interval '26 hours'
            then 1 else 0 end
from k, staff s
union all
select 'Ops config older than 26h despite staff sign-ins since',
       case when s.recent > 0
             and coalesce(k.ops, 'epoch'::timestamptz) < now() - interval '26 hours'
            then 1 else 0 end
from k, staff s
union all
select 'test probe keys (zz-*) older than a day still in the store',
       (select count(*)::int from rules
        where key like 'kv:zz-%' and updated_at < now() - interval '1 day');
comment on view store_freshness is
  'Named persistence-health checks. Any non-zero failures row means saves are being lost or hygiene slipped. Read by the Worker cron (alerts), verify-store-freshness.mjs and the daily health check.';
