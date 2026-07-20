-- ============================================================
-- Chatterbox AgentOS — Supabase schema (lean, 2026-07 audit)
-- Run once in: Supabase Dashboard → SQL Editor → New query → paste → Run
--
-- Only tables something actually reads or writes live here. The app persists
-- its uploaded sources as kv blobs through the Worker (/api/kv → rules table +
-- Storage bucket 'raw'); the row-level tables are in their own migrations:
--   migration-003  app_users / app_sessions / auth_log   (login)
--   migration-004  daily_eod                             (Tracker EOD)
--   migration-005  bi_active_cases + bucket bi-reports   (THE money)
-- The 17 speculative fact tables this file once declared (sales, calls,
-- attendance, evals, open_cases, …) were never written by anything and were
-- dropped in migration-006.
--
-- Security: RLS ON, ZERO anon policies → the publishable key can touch
-- nothing; only the Worker (secret key, bypasses RLS) reads/writes.
-- ============================================================

-- ---------- upload audit (same contract as the dashboard) ----------
create table if not exists batches (
  batch_id      text primary key,
  source_type   text not null,               -- BI_ACTIVE_CASES, SF_OPEN_CASES, ...
  source_system text,
  uploaded_by   text,
  uploaded_at   timestamptz default now(),
  period_start  date,
  period_end    date,
  file_name     text,
  file_hash     text,
  raw_rows      int,
  loaded_rows   int,
  rejected_rows int,
  status        text,                        -- passed / warning / failed
  notes         text,
  storage_path  text                         -- raw file in Storage
);

-- ---------- rules / kv (Dictionary values + the app's kv blobs) ----------
create table if not exists rules (
  key        text primary key,               -- e.g. 'kv:cb-facts-ATTENDANCE', 'ai_kill_switch'
  value      jsonb not null,
  updated_at timestamptz default now(),
  updated_by text
);
insert into rules(key, value) values ('ai_kill_switch', '{"enabled": true}')
  on conflict (key) do nothing;

-- ---------- Ask AgentOS audit trail ----------
create table if not exists ask_log (
  id         bigint generated always as identity primary key,
  asked_by   text,
  question   text,
  answer     text,
  model      text,
  created_at timestamptz default now()
);
-- This file is create-if-not-exists, so removing the two lines above does NOT reach
-- the already-deployed database. These do, and are idempotent (safe to re-run):
--   tools_used — never written; tool-calling never shipped.
--   model default — named a model deprecated 2026-05-30; the Worker always passes
--   model explicitly, so the default only ever mislabelled a manual insert.
alter table ask_log drop column if exists tools_used;
alter table ask_log alter column model drop default;

alter table batches enable row level security;
alter table rules   enable row level security;
alter table ask_log enable row level security;
