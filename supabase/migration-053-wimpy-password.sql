-- migration-053 · Wimpy sign-in needs the person's password (Spec Kit 009-wimpy-password-signin, 2026-10-06)
--
-- Nick: "for the wimpy app users must put this password as well, for example dalwin cb number and his password to
-- login". Until this release the Wimpy app signed people in with a CB number alone (migration-037), so every
-- scope='wimpy' session that exists now was minted WITHOUT a password. The Worker (auth.mjs signinWimpy) now asks
-- for the account's own password through the same check and lock as /api/login.
--
-- Run ONCE at release, AFTER the Worker is deployed (so no new password-less session can be minted afterwards):
-- it ends every Wimpy session, and anyone mid-order signs in again with CB number + password. Wimpy sessions only
-- reach /api/wimpy/*, so nothing else is signed out. Safe to re-run: a second run only signs lunch users out again.

delete from app_sessions where scope = 'wimpy';

comment on column app_sessions.scope is
  'full = a main sign-in (reaches everything its role allows); wimpy = the Wimpy sign-in (CB number + the account password since migration-053), refused by the Worker outside /api/wimpy/*; referrals = the scheduled referrals pull (tools/sync-referrals.mjs), refused by the Worker everywhere except GET /api/referrals, 10-minute life, deleted after use.';
