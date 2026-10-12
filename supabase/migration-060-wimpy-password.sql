-- migration-060 · a Wimpy-only password (Spec Kit 025, 2026-10-09)
--
-- Nick: "the wimpy is now a dependant app so users must have access to change their password for this, so their agent
-- os password will now be different from wimpy". Until a person sets one, Wimpy keeps accepting the AgentOS password
-- (wimpy_password_hash null = "not set"); once set, Wimpy checks THIS hash and AgentOS keeps its own. Same PBKDF2 scheme,
-- written only by the Wimpy service (service_role). Nothing in the Worker reads it.
--
-- FORGOT THE WIMPY PASSWORD: the team leader resets the AgentOS password as today (back to the start password, which
-- sets password_is_default = true). That reset clears the Wimpy password too, so both apps answer to the start password
-- until the person sets new ones. Safe to re-run.
--   node tools/apply-migration.mjs supabase/migration-060-wimpy-password.sql

alter table app_users add column if not exists wimpy_password_hash text;
comment on column app_users.wimpy_password_hash is
  'Spec Kit 025: the Wimpy lunch app''s own password (PBKDF2, same scheme as password_hash). NULL = not set yet — Wimpy then accepts password_hash. Cleared by a reset to the start password (app_users_clear_wimpy_password).';

create or replace function app_users_clear_wimpy_password() returns trigger
language plpgsql as $$
begin
  if new.password_is_default is true and (old.password_is_default is distinct from true) then
    new.wimpy_password_hash := null;
  end if;
  return new;
end $$;
drop trigger if exists app_users_clear_wimpy_password on app_users;
create trigger app_users_clear_wimpy_password before update of password_is_default on app_users
  for each row execute function app_users_clear_wimpy_password();
comment on function app_users_clear_wimpy_password is
  'Spec Kit 025: a reset to the start password (password_is_default → true) also forgets the Wimpy-only password, so the person can sign in to Wimpy with the start password again.';
revoke all on function app_users_clear_wimpy_password() from public, anon, authenticated;
