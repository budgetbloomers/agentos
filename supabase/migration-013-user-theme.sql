-- migration-013-user-theme.sql
-- PER-ACCOUNT THEME (Nick, 2026-08-30: "there must be a toggle for peoples account,
-- some people like to have dark theme and light theme, so when they click save that
-- is the theme for their account").
--
-- The suite wears one skin (2026-08-26) and LIGHT stays that skin — this is a
-- per-person override, not a second design system. NULL means "the suite default",
-- which is light, so every existing account keeps exactly what it has today and the
-- column can be dropped again without touching a single user.
--
-- Only the three management apps read it (Ops, VAS/PULSE, Tracker) — they share
-- auth-gate.js, which applies it. Agent Analytics is deliberately not covered: it
-- has no dark palette, and shipping a toggle that does nothing on the app 130 agents
-- open would be worse than not offering it there.
--
-- Idempotent: safe to re-run.

alter table app_users add column if not exists theme text;

comment on column app_users.theme is
  'Per-account UI theme for the three management apps: ''dark'', ''light'', or NULL meaning the suite default (light). Set from the toggle in auth-gate.js via POST /api/theme; never inferred from the OS, so a shared machine cannot flip somebody else''s account.';

-- A value the apps cannot render is worse than no value: refuse anything but the two
-- the stylesheets actually define.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'app_users_theme_chk') then
    alter table app_users add constraint app_users_theme_chk
      check (theme is null or theme in ('light', 'dark'));
  end if;
end $$;
