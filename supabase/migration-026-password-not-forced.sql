-- migration-026 — a password change is the person's choice, never forced.
--
-- WHY (Nick, 2026-09-08, an hour after migration-025 went live and every sign-in opened on
-- "Set a new password"): "everything is asking to set new passwords, no users needs to use
-- agentos123, but if they want to change it they can … after the sign in dont make change it,
-- only if they want to". So: the start password stays valid for as long as the person keeps it;
-- the Change-password option is there in every app for whoever wants it; nothing is forced.
--
-- WHAT STAYS from migration-025: password_is_default / password_changed_at (the table still
-- KNOWS who is on the start password — the view accounts_on_default_password is the audit),
-- set_password() as the one atomic change (flags, sessions, auth_log), and the update trigger
-- that flips a new hash to "personal". WHAT GOES: every path that set must_change_password
-- because of the default. must_change_password remains a column an administrator can set by
-- hand for one account if they ever need to — nothing sets it automatically any more.

-- 1. born on the default: record it, force nothing
create or replace function app_users_password_birth() returns trigger
language plpgsql as $$
begin
  if new.password_changed_at is null then new.password_changed_at := now(); end if;
  return new;
end $$;

-- 2. a new hash is personal unless the statement says reset; a reset forces nothing either
create or replace function app_users_password_turn() returns trigger
language plpgsql as $$
begin
  if new.password_hash is distinct from old.password_hash then
    if new.password_is_default is not distinct from old.password_is_default then
      new.password_is_default := false;
      new.must_change_password := false;
    end if;
    new.password_changed_at := now();
    new.failed_attempts := 0;
    new.locked_until := null;
  end if;
  return new;
end $$;

-- 3. an administrator's reset puts the account back on the start password; the person may keep it
create or replace function reset_password_to_default(
  p_user_id      uuid,
  p_default_hash text,
  p_actor        text default 'admin'
) returns jsonb
language plpgsql
as $$
declare
  v_username text;
  v_dropped  integer;
begin
  if p_default_hash is null or p_default_hash !~ '^pbkdf2h\$' then
    raise exception 'reset_password_to_default: hash must be in the Worker''s pbkdf2h scheme' using errcode = 'P0001';
  end if;
  update app_users
     set password_hash = p_default_hash,
         password_is_default = true,
         must_change_password = false,      -- Nick, 2026-09-08: nobody is made to change it
         failed_attempts = 0,
         locked_until = null
   where id = p_user_id
   returning username into v_username;
  if v_username is null then
    raise exception 'reset_password_to_default: no account %', p_user_id using errcode = 'P0002';
  end if;
  delete from app_sessions where user_id = p_user_id;
  get diagnostics v_dropped = row_count;
  insert into auth_log (user_id, username, event, ip) values (p_user_id, v_username, 'password_reset', 'by ' || coalesce(p_actor, 'admin'));
  return jsonb_build_object('ok', true, 'username', v_username, 'sessions_dropped', v_dropped, 'must_change_password', false);
end $$;

-- 4. undo this morning's forcing on every account (pg-safeupdate: the WHERE names the rows)
update app_users set must_change_password = false where must_change_password = true;
