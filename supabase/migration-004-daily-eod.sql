-- migration-004: daily_eod — Tracker Analytics (Matrix EOD) entries as real rows.
-- One row per date, upserted by the Worker (/api/eod). RLS on, zero policies:
-- only the Worker's service key can touch it (same pattern as all other tables).
create table if not exists daily_eod (
  eod_date   date primary key,
  employed   int,
  present    int,
  afrilead   int,
  jag        int,
  vt         int,
  gwp        numeric,          -- Avg GWP (R) as captured
  target     int,              -- number of agents to target
  updated_by text,
  updated_at timestamptz default now()
);
alter table daily_eod enable row level security;
