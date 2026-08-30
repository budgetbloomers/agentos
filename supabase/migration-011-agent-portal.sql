-- ============================================================
-- Migration 011 — Agent Analytics portal accounts
--
-- Agents and Team Leaders sign in to /agent/ with their CB NUMBER and a
-- password. They are ordinary app_users rows — there is no second user table
-- and no second auth system; login, hashing, lockout, sessions and the audit
-- log are all the existing ones (migration 003).
--
-- Two things were missing to make that work:
--
-- 1. `cb` already exists ("optional link to agents roster") but was NULL on all
--    23 rows and had no uniqueness guarantee. The portal resolves a signed-in
--    user to exactly one agent through it, so a duplicate CB would silently let
--    two people share one identity. Made unique (NULLs are exempt, so the 23
--    management accounts are unaffected).
--
-- 2. A Team Leader's TEAM had nowhere to live. Team membership is the Agent
--    List's `Team Leader` column, which names the leader as a STRING — there is
--    no team id anywhere in the system, and Team Leaders are not on the agent
--    roster at all (they have no roster row of their own). Matching a leader to
--    their team by their display name at request time is exactly the fragile
--    name-join this portal is supposed to avoid, so the binding is stored
--    explicitly and re-synced from the roster by
--    tools/provision-agent-logins.mjs.
--
-- Roles used by the portal (both NEW — the existing admin/exec/tl/qa/viewer
-- roles keep today's behaviour untouched):
--    'agent'        — sees their own figures only
--    'team_leader'  — sees their own team only
-- The Worker refuses these two roles every route except a small allow-list, so
-- an agent session cannot reach /api/kv, /api/bi, /api/eod or /api/ask even by
-- crafting the request by hand.
-- ============================================================

alter table app_users add column if not exists team text;

comment on column app_users.team is
  'Agent Analytics: for role team_leader, the exact Agent List "Team Leader" string whose agents this user may see. NULL for everyone else. Re-synced by tools/provision-agent-logins.mjs.';

comment on column app_users.cb is
  'Agent Analytics: the CB number this account signs in with and is scoped to (role agent / team_leader). NULL for management accounts, which sign in by username.';

-- One CB number, one account. Partial so the NULLs on management rows are fine.
create unique index if not exists app_users_cb_uniq
  on app_users (upper(cb)) where cb is not null;

-- The portal looks users up by CB on every sign-in.
create index if not exists app_users_team_idx on app_users (team) where team is not null;
