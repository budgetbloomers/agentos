-- migration-058 · the Wimpy lunch app is its own service (Spec Kit 018-wimpy-standalone-service, 2026-10-09)
--
-- Nick: "extract wimpy as a docker with the highlevel api keys and all its functionality because I want to remove it
-- from vas analytics and put that on vercel". The Wimpy sign-in, menu, order, ledger write and "My orders" now run in
-- wimpy-service/ (Vercel, or a container). It mints the same scope='wimpy' sessions in this table and is the ONLY thing
-- that accepts them; the suite's Worker refuses a wimpy session on every route from this release.
--
-- Run ONCE at release, AFTER the Worker that refuses them is deployed (so no session minted by the OLD Worker can keep
-- reaching it) and after the service is live (so people simply sign in again at the new address). Same shape as
-- migration-053: ends every Wimpy session; nothing else is signed out. Safe to re-run.
--
-- No table changes: wimpy_orders and wimpy_hl_contacts (migration-055) are read and written by the service exactly as
-- the Worker did, with the same service key over PostgREST.

delete from app_sessions where scope = 'wimpy';

comment on column app_sessions.scope is
  'full = a main sign-in (reaches everything its role allows); wimpy = minted by the standalone Wimpy service (wimpy-service/, Spec Kit 018) with the account password, accepted by that service alone and refused by the Worker on every route; referrals = the scheduled referrals pull (tools/sync-referrals.mjs), refused by the Worker everywhere except GET /api/referrals, 10-minute life, deleted after use.';
