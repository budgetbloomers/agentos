-- migration-066-2fa-retry.sql — two-step setup: retry without getting stuck, safely (2026-11-05)
--
-- Denise could not finish setup: one wrong code ended the attempt, and each new sign-in made a new secret her phone
-- did not hold. A retained challenge and a reused secret fix that, and these two columns keep them safe:
--   app_users.totp_pending_at      when this unfinished secret was made. It is reused for 30 minutes only, so a secret
--                                  copied by someone who knows the password dies instead of becoming a permanent factor.
--   app_login_challenges.attempts  tries used on this request, moved by compare-and-set BEFORE a code is checked, so
--                                  guesses fired in parallel cannot race the 5-wrong-codes lockout.
-- Additive and idempotent: the running Worker ignores both columns. Apply BEFORE deploying the Worker that writes them.

alter table app_users add column if not exists totp_pending_at timestamptz;
alter table app_login_challenges add column if not exists attempts integer not null default 0;
