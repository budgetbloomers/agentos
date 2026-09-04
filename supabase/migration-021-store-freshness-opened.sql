-- ============================================================================
-- migration-021 — store_freshness asks "opened since its last save?", per app.
--
-- 2026-09-04: VAS Analytics showed a red banner, "AgentOS Analytics has not saved
-- its config since 2026-09-02 21:26 despite staff signing in since". Nobody had
-- opened Ops since that save — the staff who signed in used VAS and the agent app.
-- The check inferred "somebody used Ops" from ANY staff sign-in, which is the wrong
-- question. The Worker now stamps each dashboard's boot into kv:app-opened
-- ({vas, ops}, ISO timestamps), and this view — the SQL twin of
-- worker/src/health.mjs evaluateFreshness — asks the right one: was THIS dashboard
-- opened after it last saved, and is that save now over 26 hours old? Until the
-- stamp row exists (older Worker, fresh database) the staff-sign-in rule stands, so
-- the safety net never has a gap.
--
-- Check names are unchanged: verify-store-freshness.mjs and the health cron read
-- them by name.
-- ============================================================================
create or replace view store_freshness as
with k as (
  select
    max(updated_at) filter (where key = 'kv:upload-manifest') as manifest,
    max(updated_at) filter (where key = 'kv:vas-state')       as vas,
    max(updated_at) filter (where key = 'kv:cb-config')       as ops
  from rules
),
opened as (
  select (value->>'vas')::timestamptz as vas,
         (value->>'ops')::timestamptz as ops,
         true                          as stamped
  from   rules where key = 'kv:app-opened'
  union all
  select null, null, false where not exists (select 1 from rules where key = 'kv:app-opened')
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
       case when coalesce(k.vas, 'epoch'::timestamptz) < now() - interval '26 hours'
             and case when o.stamped then coalesce(o.vas, 'epoch'::timestamptz) > coalesce(k.vas, 'epoch'::timestamptz)
                      else s.recent > 0 end
            then 1 else 0 end
from k, staff s, opened o
union all
select 'Ops config older than 26h despite staff sign-ins since',
       case when coalesce(k.ops, 'epoch'::timestamptz) < now() - interval '26 hours'
             and case when o.stamped then coalesce(o.ops, 'epoch'::timestamptz) > coalesce(k.ops, 'epoch'::timestamptz)
                      else s.recent > 0 end
            then 1 else 0 end
from k, staff s, opened o
union all
select 'test probe keys (zz-*) older than a day still in the store',
       (select count(*)::int from rules
        where key like 'kv:zz-%' and updated_at < now() - interval '1 day');
comment on view store_freshness is
  'Named persistence-health checks. Any non-zero failures row means saves are being lost or hygiene slipped. Since migration-021 the two staleness rows ask "opened since its last save?" per dashboard (kv:app-opened), falling back to staff sign-ins when no stamp exists. Read by the Worker cron (alerts), verify-store-freshness.mjs and the daily health check.';
