-- migration-065: second-step sign-in (TOTP authenticator) for the AgentOS management suite,
-- plus the pending-challenge table the two-step flow needs. Agent Analytics / Coaching Hub /
-- KPI hub are unchanged (scope is decided in code by TWOFA_ROLES in worker/src/twofa.mjs).
-- Cloudflare Turnstile needs no schema; its secret lives in the Worker env (TURNSTILE_SECRET).

-- Per-account TOTP state. Secret is base32; recovery is an array of sha256 hashes (never plaintext).
alter table app_users add column if not exists totp_secret   text;
alter table app_users add column if not exists totp_enabled  boolean not null default false;
alter table app_users add column if not exists totp_recovery jsonb   not null default '[]'::jsonb;

-- Short-lived, single-use handle for "password proven, second step pending". The browser never
-- holds a real session until the code checks out; this row is what /api/login/totp consumes.
create table if not exists app_login_challenges (
  challenge_hash text primary key,                 -- sha256 of the opaque token handed to the browser
  user_id        uuid not null references app_users(id) on delete cascade,
  kind           text not null check (kind in ('enroll','totp')),
  expires_at     timestamptz not null,             -- 5 minutes; takeChallenge() also deletes on use
  created_at     timestamptz not null default now()
);
create index if not exists app_login_challenges_expires_idx on app_login_challenges (expires_at);

-- Same posture as every other table here: RLS on, no anon/authenticated reach; the Worker uses
-- the service key (consistent with migration-049's anon lockdown).
alter table app_login_challenges enable row level security;
revoke all on app_login_challenges from anon, authenticated;

-- Housekeeping: a best-effort sweep of expired challenges (also enforced in code on read).
-- Safe to run repeatedly; no-op if pg_cron is absent.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('agentos-prune-login-challenges', '*/10 * * * *',
      $cron$ delete from app_login_challenges where expires_at < now() - interval '1 hour' $cron$);
  end if;
exception when others then null;
end $$;
