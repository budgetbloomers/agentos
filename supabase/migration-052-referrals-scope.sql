-- migration-052 · the 'referrals' session scope (Spec Kit 002-live-month-sync-coaching, 2026-10-01)
--
-- tools/sync-referrals.mjs (run by the local tick at 08:00 and 14:00 SAST) mints a short-lived session to
-- call the Worker's GET /api/referrals. The security review (ecc:security-reviewer, 2026-10-01) asked that it
-- not be a full admin session: the Worker now refuses a scope='referrals' session on every route except
-- GET /api/referrals (worker/src/index.mjs, mirroring the 'wimpy' scope of migration-037). The database
-- constraint from migration-037 only allowed 'full' and 'wimpy', so the mint would be refused.
-- Idempotent: re-running leaves the same constraint.

alter table app_sessions drop constraint if exists app_sessions_scope_chk;
alter table app_sessions add constraint app_sessions_scope_chk check (scope in ('full', 'wimpy', 'referrals'));

comment on column app_sessions.scope is
  'full = a password login (reaches everything its role allows); wimpy = the CB-only Wimpy sign-in, refused by the Worker outside /api/wimpy/*; referrals = the scheduled referrals pull (tools/sync-referrals.mjs), refused by the Worker everywhere except GET /api/referrals, 10-minute life, deleted after use.';
