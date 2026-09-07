-- ============================================================================
-- migration-023 — source_cadence + data_reach (never-stale plan, Phase 2, 2026-09-07).
--
-- A freshness CONTRACT per source: when its daily drop is due (SAST), on which days, how
-- much grace, and WHO owns it — so a source-stale alert carries a name, not a mystery.
-- data_reach reads how far each source actually goes in the lake (loaded by the scheduled
-- runner); the Worker's sentinel prefers the digest's own dataReach stamp and reads this
-- table for owners. Edit the rows, never the code, when a cadence or an owner changes.
-- ============================================================================
create table if not exists source_cadence (
  source        text primary key,           -- key used by dataReach / the sentinel
  label         text not null,
  owner         text,                       -- who does the drop
  due_by_sast   time not null default '13:00',
  weekdays_only boolean not null default true,   -- Mon–Sat data; no Sunday
  grace_hours   int not null default 2,
  notes         text
);
alter table source_cadence enable row level security;
insert into source_cadence (source, label, owner, notes) values
  ('sales',      'Sales — BI Active cases',            'Ashton', 'Power BI export, one file per day'),
  ('calls',      'Calls — ViciDial call report',       'Ashton', 'EXPORT_CALL_REPORT, whole floor since 2026-09-01'),
  ('attendance', 'Attendance register (HR)',           'Ashton', 'cumulative CSV, re-uploaded daily'),
  ('qa',         'QA evaluations (CallBi)',            'Ashton', 'evaluations-full-export'),
  ('closed',     'Salesforce closed cases',            'Ashton', 'lead management'),
  ('leads',      'Salesforce open cases (Lead Mgmt)',  'Ashton', 'lead management'),
  ('roster',     'Agent List',                         'Ashton', 'every change of the floor'),
  ('referrals',  'HighLevel referrals',                'auto',   'pulled by fetch-referrals.mjs')
on conflict (source) do nothing;
comment on table source_cadence is
  'The freshness contract per source: due time (SAST), Mon–Sat, grace, OWNER. Read by the Worker sentinel (source-stale names the owner) and by data_reach.';

create or replace view data_reach as
with r as (
  select 'sales'      as source, max(contract_create_date)::date as reach from bi_active_cases
  union all select 'calls',      max(call_day)::date            from vici_calls
  union all select 'attendance', max(attendance_date)::date     from attendance
  union all select 'qa',         max(date_of_call)::date        from qa_evaluations
  union all select 'closed',     max(closed_day)::date          from sf_closed_cases
  union all select 'leads',      max(snapshot_date)::date       from sf_open_cases
)
select c.source, c.label, c.owner, c.due_by_sast, r.reach,
       (current_date - r.reach)::int as days_since_reach
from   source_cadence c left join r on r.source = c.source
order  by c.source;
comment on view data_reach is
  'How far each source reaches in the LAKE, with its owner. The lake is loaded by the scheduled runner, so this lags the dashboards until Phase 1 runs; the dashboards'' own reach travels in the agent digest (dataReach).';

-- Saturday is a data day only for the dialler and BI: the attendance register and QA carry no
-- Saturday rows, so on a Monday they are expected through FRIDAY, or every Monday would read a
-- false "1 day short" (seen 2026-09-07 at first light).
alter table source_cadence add column if not exists saturday boolean not null default false;
update source_cadence set saturday = true where source in ('sales', 'calls');
