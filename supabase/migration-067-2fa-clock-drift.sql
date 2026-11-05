-- migration-067-2fa-clock-drift.sql — remember how far a phone's clock is out (2026-11-05)
--
-- Authenticator codes depend on the phone's clock. Denise failed 4 of 4 tries, including a fresh scan, while others got
-- through, and rescanning cannot cure a wrong clock. As RFC 6238 §6 recommends, setup now accepts a code from a phone up
-- to 30 minutes out (the secret is on her screen at that moment, so this proves nothing less) and stores the offset here
-- in 30-second steps, so later sign-ins check around it at the normal ±30 seconds.
-- Additive and idempotent. Apply BEFORE deploying the Worker that reads it.

alter table app_users add column if not exists totp_drift integer not null default 0;
