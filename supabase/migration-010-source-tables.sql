-- ============================================================================
-- migration-010-source-tables.sql — THE DATA LAKE
--
-- WHY. Today exactly one source is modelled in SQL: bi_active_cases (the money).
-- Everything else — ViciDial, CallX, open/closed cases, cancellations, QA,
-- attendance, referrals and the Agent List itself — is persisted by /api/kv as an
-- opaque JSON blob: a pointer row in `rules` (key 'kv:cb-facts-<SOURCE>') with the
-- payload streamed to Storage at raw/kv/<key>. That is a file cabinet, not a
-- database. You cannot ask it "who dialled on 13 August", you cannot join it to
-- the roster, and nothing can audit it without loading the whole blob into a
-- browser. Every investigation in this repo has had to run against the raw files
-- for exactly that reason.
--
-- WHAT THIS DOES. One table per source, with the identity rule of that source
-- encoded as a PRIMARY KEY so re-uploading is idempotent rather than additive —
-- the same guarantee bi_active_cases already gets from migration-007.
--
-- THE ONE THAT IS NOT JUST PLUMBING: agent_list. It is stored WITH an as_of date
-- and never replaced, which is what makes a past day reconstructible. The live
-- roster stays replace-on-upload in the app (Nick's design: "everytime ill upload
-- a new one so the old one can come out") — this table is the memory behind it, so
-- an agent who worked on 13 August can still be named after they leave. That is the
-- unfixed §10 defect in specs/dialler-attribution-framework.md: same day's data,
-- roster swapped, 87 variance rows fall to 75 and the missing agents' sales divert
-- to Unmatched. With this table the answer is a query, not a guess.
--
-- SAFE TO RUN TWICE. Every statement is IF NOT EXISTS / OR REPLACE. It creates no
-- policies that would expose data: like the existing tables these are reached ONLY
-- through the Worker with the service-role key (CLAUDE.md: the Worker is the only
-- thing that talks to Supabase). RLS is enabled with no permissive policy, so the
-- anon key cannot read them even if it leaks.
-- ============================================================================

-- ---------------------------------------------------------------- agent_list
-- THE SPINE, kept as history. Primary key (as_of, employee_code): each upload is a
-- dated snapshot, so a later list opens a new row rather than overwriting the old.
create table if not exists agent_list (
  as_of           date         not null,
  employee_code   text         not null,
  agent_name      text,
  sales_force     text,          -- the Salesforce display name; the BI/case join key
  callx_alias     text,          -- dialler label; may embed a CONTRADICTING CB number
  campaign        text,          -- Cuddle | Courtesy | Nesting | VT — the classifier
  tenure          text,
  team_leader     text,
  target          numeric,
  start_date      date,
  batch_id        text,
  loaded_at       timestamptz  not null default now(),
  primary key (as_of, employee_code)
);
create index if not exists agent_list_code_idx     on agent_list (employee_code, as_of desc);
create index if not exists agent_list_campaign_idx on agent_list (campaign, as_of desc);
comment on table agent_list is
  'Dated roster snapshots. The app replaces its live roster on every upload; this keeps every version so a PAST day can still resolve an agent who has since left (dialler-attribution-framework.md §10).';

-- Who was on the roster on a given date: the latest snapshot at or before it.
create or replace view agent_list_asof as
select distinct on (employee_code, d.day)
       d.day, a.employee_code, a.agent_name, a.sales_force, a.callx_alias,
       a.campaign, a.tenure, a.team_leader, a.target, a.as_of
from   (select distinct as_of as day from agent_list) d
join   agent_list a on a.as_of <= d.day
order  by employee_code, d.day, a.as_of desc;

-- ------------------------------------------------------------- vici_calls
-- Identity per the source contract: call_date + user + lead_id + status. Repeats
-- inside one file collapse; a newer export supersedes its own keys, never stacks.
-- user_group is stored because it is the ONLY evidence that separates a filtered
-- export from an idle floor — the failure that hid the whole Cuddle floor on 13 Aug.
create table if not exists vici_calls (
  call_date       timestamptz  not null,
  call_day        date         not null,
  agent_login     text         not null,   -- the `user` column: the CB number, zero-padded
  lead_id         text         not null default '',
  status          text         not null default '',
  full_name       text,
  user_group      text,
  campaign_id     text,
  length_in_sec   integer      not null default 0,
  status_name     text,
  employee_code   text,                    -- resolved through the Agent List; NULL = unmatched
  batch_id        text,
  loaded_at       timestamptz  not null default now(),
  primary key (call_date, agent_login, lead_id, status)
);
create index if not exists vici_day_idx   on vici_calls (call_day, employee_code);
create index if not exists vici_group_idx on vici_calls (call_day, user_group);

-- ------------------------------------------------------------- callx_calls
-- CallX has no natural key, so identity is a hash of the identifying columns.
create table if not exists callx_calls (
  row_hash        text         primary key,
  call_at         timestamptz  not null,
  call_day        date         not null,
  agent_label     text,                    -- e.g. "Thulani Mbonambi CB-142"
  employee_code   text,
  call_type       text,
  campaign        text,
  disposition     text,
  duration_sec    integer,
  billable_sec    integer      not null default 0,
  branch          text,
  batch_id        text,
  loaded_at       timestamptz  not null default now()
);
create index if not exists callx_day_idx on callx_calls (call_day, employee_code);

-- --------------------------------------------------------- sf_open_cases
-- A SNAPSHOT source: the lead book as at a moment. Keyed by (snapshot_date,
-- case_number) so successive pulls are comparable instead of overwriting history —
-- which is what makes day-over-day lead movement answerable at last.
create table if not exists sf_open_cases (
  snapshot_date   date         not null,
  case_number     text         not null,
  case_id         text,
  subject         text,
  opened_at       timestamptz,
  age_hours       numeric,
  account_number  text,
  account_name    text,
  case_owner      text,                    -- a display name, never a code
  employee_code   text,                    -- resolved; NULL = queue or unmatched
  owner_kind      text,                    -- 'agent' | 'queue' | 'unmatched'
  status          text,                    -- the attempt stage: pivoted by Lead Allocation
  record_type     text,
  batch_id        text,
  loaded_at       timestamptz  not null default now(),
  primary key (snapshot_date, case_number)
);
create index if not exists sfopen_owner_idx  on sf_open_cases (snapshot_date, employee_code);
create index if not exists sfopen_status_idx on sf_open_cases (snapshot_date, status);

-- ------------------------------------------------------- sf_closed_cases
create table if not exists sf_closed_cases (
  case_number     text         not null,
  closed_at       timestamptz  not null,
  closed_day      date         not null,
  case_id         text,
  opened_at       timestamptz,
  disposition     text,
  status          text,
  age_hours       numeric,
  account_number  text,
  account_name    text,
  case_owner      text,
  employee_code   text,
  batch_id        text,
  loaded_at       timestamptz  not null default now(),
  primary key (case_number, closed_at)
);
create index if not exists sfclosed_day_idx on sf_closed_cases (closed_day, employee_code);

-- ------------------------------------------------------------ sf_inactive
-- Cancellations. Dated by Contract CREATE date deliberately (a cancellation counts
-- against the period the sale was made in), keyed on contract identity so a
-- re-upload can only overwrite the same contract.
create table if not exists sf_inactive (
  account_number    text        not null,
  contract_number   text        not null default '',
  deactivate_date   date        not null,
  create_date       date,
  contract_status   text,
  account_name      text,
  owner             text,
  employee_code     text,
  charge_amount_ex  numeric,
  product_bundle    text,
  marketing_type    text,
  batch_id          text,
  loaded_at         timestamptz not null default now(),
  primary key (account_number, contract_number, deactivate_date)
);
create index if not exists sfinactive_create_idx on sf_inactive (create_date, employee_code);

-- -------------------------------------------------------- qa_evaluations
create table if not exists qa_evaluations (
  record_id         text        primary key,
  date_of_call      date,                  -- QA filters on THIS only, per the rule book
  submitted_at      timestamptz,
  status            text,
  sales_agent       text,
  sales_agent_cb    text,
  employee_code     text,
  team_leader       text,
  tenure            text,
  campaign          text,
  qa_agent          text,
  score_pct         numeric,               -- 0% scores are KEPT, never filtered
  call_duration_sec integer,
  assessment_type   text,
  offense_number    text,
  coaching_category text,
  critical_fail     text,
  escalation        text,
  batch_id          text,
  loaded_at         timestamptz not null default now()
);
create index if not exists qa_doc_idx on qa_evaluations (date_of_call, employee_code);

-- ------------------------------------------------------------- attendance
-- New file wins per employee-day (the supersede exception in confirmLoad).
create table if not exists attendance (
  attendance_date date         not null,
  employee_code   text         not null,
  employee_name   text,
  title           text,
  employee_type   text,
  department      text,
  reports_to      text,
  status_code     text,
  status          text,
  batch_id        text,
  loaded_at       timestamptz  not null default now(),
  primary key (attendance_date, employee_code)
);
create index if not exists att_day_idx on attendance (attendance_date, status_code);

-- -------------------------------------------------------------- referrals
-- Pulled live from HighLevel rather than uploaded; stored so the count is
-- reproducible after the fact instead of only ever being "whatever HL says now".
create table if not exists referrals (
  contact_id      text         primary key,
  created_at      timestamptz,
  referral_day    date,
  agent_name      text,
  employee_code   text,
  business_name   text,
  tags            text,
  synced_at       timestamptz  not null default now()
);
create index if not exists referrals_day_idx on referrals (referral_day, employee_code);

-- ------------------------------------------------------- upload_coverage
-- THE COVERAGE LAW (framework §5) as a queryable fact, not just a screen. One row
-- per upload day per campaign: present vs dialling. A whole campaign present but
-- not dialling is a filtered export and must fail before anyone trusts the day.
create table if not exists upload_coverage (
  coverage_day    date         not null,
  campaign        text         not null,
  roster_agents   integer      not null default 0,
  present_agents  integer      not null default 0,
  dialling_agents integer      not null default 0,
  verdict         text         not null,   -- 'ok' | 'warn' | 'fail' | 'none'
  detail          text,
  computed_at     timestamptz  not null default now(),
  primary key (coverage_day, campaign)
);

-- ---------------------------------------------------------------- security
-- Reached ONLY through the Worker's service-role key. RLS on, no permissive policy:
-- the anon key cannot read these even if it leaks.
alter table agent_list      enable row level security;
alter table vici_calls      enable row level security;
alter table callx_calls     enable row level security;
alter table sf_open_cases   enable row level security;
alter table sf_closed_cases enable row level security;
alter table sf_inactive     enable row level security;
alter table qa_evaluations  enable row level security;
alter table attendance      enable row level security;
alter table referrals       enable row level security;
alter table upload_coverage enable row level security;

-- ------------------------------------------------------------------ audit
-- What is actually in the lake, per source. Answers "is the data there" without
-- opening a blob — the question this whole migration exists to make answerable.
create or replace view lake_audit as
select 'agent_list'      as source, count(*) as rows, min(as_of)::text          as first_day, max(as_of)::text          as last_day from agent_list
union all select 'vici_calls',      count(*), min(call_day)::text,        max(call_day)::text        from vici_calls
union all select 'callx_calls',     count(*), min(call_day)::text,        max(call_day)::text        from callx_calls
union all select 'sf_open_cases',   count(*), min(snapshot_date)::text,   max(snapshot_date)::text   from sf_open_cases
union all select 'sf_closed_cases', count(*), min(closed_day)::text,      max(closed_day)::text      from sf_closed_cases
union all select 'sf_inactive',     count(*), min(create_date)::text,     max(create_date)::text     from sf_inactive
union all select 'qa_evaluations',  count(*), min(date_of_call)::text,    max(date_of_call)::text    from qa_evaluations
union all select 'attendance',      count(*), min(attendance_date)::text, max(attendance_date)::text from attendance
union all select 'referrals',       count(*), min(referral_day)::text,    max(referral_day)::text    from referrals
union all select 'bi_active_cases', count(*), null, null from bi_active_cases;

-- Unattributed rows per source — the framework's "reported by name, never dropped"
-- made queryable, so a mapping gap surfaces in SQL and not only in a browser tab.
create or replace view lake_unmatched as
select 'vici_calls' as source, call_day as day, full_name as identity, count(*) as rows
  from vici_calls where employee_code is null group by 1,2,3
union all
select 'callx_calls', call_day, agent_label, count(*)
  from callx_calls where employee_code is null group by 1,2,3
union all
select 'sf_open_cases', snapshot_date, case_owner, count(*)
  from sf_open_cases where employee_code is null and owner_kind <> 'queue' group by 1,2,3;
