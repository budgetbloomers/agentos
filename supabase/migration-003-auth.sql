-- ============================================================
-- Migration 003 — App login & per-tab access control
-- Users are created by an admin (no self-signup). Passwords are NEVER
-- stored in plaintext: the Worker hashes with PBKDF2-SHA256 (WebCrypto,
-- 100k+ iterations, per-user salt) and stores 'pbkdf2$iter$salt$hash'.
-- Enforcement: the Worker validates the session on EVERY /api call and
-- filters data by the user's tab permissions — hiding tabs in the UI is
-- cosmetic; the API is the real gate.
-- RLS deny-by-default: only the Worker (secret key) touches these tables.
-- ============================================================

create extension if not exists pgcrypto;  -- gen_random_uuid

create table if not exists app_users (
  id                   uuid primary key default gen_random_uuid(),
  username             text unique not null,
  email                text unique,
  full_name            text,
  password_hash        text not null,          -- 'pbkdf2$<iters>$<salt_b64>$<hash_b64>' — never plaintext
  role                 text not null default 'viewer',  -- admin / exec / tl / qa / viewer
  apps                 text[] not null default '{ops}', -- which apps: ops, vas
  -- per-app allowed tab ids, e.g.
  -- {"ops":["exec","brain","tl","scorecard"],"vas":["dashboard","agents","leaderboard"]}
  -- the literal "*" grants all tabs in that app
  tabs                 jsonb not null default '{"ops":[],"vas":[]}',
  cb                   text,                   -- optional link to agents roster (a TL sees their team)
  pii_unmask           boolean not null default false,  -- who may flip the PII toggle
  active               boolean not null default true,
  must_change_password boolean not null default true,
  failed_attempts      int not null default 0,
  locked_until         timestamptz,            -- lockout after repeated failures
  last_login           timestamptz,
  created_at           timestamptz default now(),
  created_by           text
);

create table if not exists app_sessions (
  token_hash text primary key,                 -- SHA-256 of the session token (raw token never stored)
  user_id    uuid not null references app_users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz default now(),
  ip         text,
  user_agent text
);
create index if not exists app_sessions_user_idx on app_sessions(user_id, expires_at);

create table if not exists auth_log (
  id      bigint generated always as identity primary key,
  user_id uuid,
  username text,
  event   text not null,                        -- login_ok / login_fail / locked / logout / pw_change / created / disabled / perm_change
  ip      text,
  at      timestamptz default now()
);

-- RLS: deny-by-default (no policies). Worker-only, same as everything else.
alter table app_users    enable row level security;
alter table app_sessions enable row level security;
alter table auth_log     enable row level security;
