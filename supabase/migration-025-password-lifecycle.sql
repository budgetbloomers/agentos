-- migration-025 — the password lifecycle lives in the database.
--
-- WHY (Nick, 2026-09-08: "when they create their new password agentos123 must be removed …
-- create that function in supabase, and fix any supabase tables, think like a database
-- engineer"). The facts on the day: 161 accounts, every one with must_change_password = false,
-- and not one password_change in auth_log since the system began. sync_agent_list() creates
-- agents on the start password with must_change_password FALSE, so nothing ever forced a
-- change, and a hash written by any other path left no trace of whether it was the start
-- password or the person's own. The table did not know, so nothing downstream could act.
--
-- WHAT THE TABLE NOW GUARANTEES
--   1. app_users.password_is_default says whether the hash is the start password. New rows
--      default to TRUE (every provisioning path creates on the start password) and a row on
--      the default MUST change it: a trigger sets must_change_password = true on insert.
--   2. Writing a new password_hash flips the row to a personal password unless the statement
--      itself says it is a reset (password_is_default = true): password_is_default := false,
--      must_change_password := false, password_changed_at := now(). Old code paths that update
--      the hash directly therefore behave correctly without being touched.
--   3. set_password() is the one call the Worker makes on a change: hash, flags, lockout reset,
--      every OTHER session of the account dropped, auth_log row — one transaction.
--   4. reset_password_to_default() is the one call an admin tool makes: hash, flags back to
--      default + forced change, ALL sessions dropped, auth_log row — one transaction.
--   5. accounts_on_default_password is the view the health cron and the audit tool read.
--
-- The start password itself is never stored in the database (hashes are salted PBKDF2), so the
-- backfill of password_is_default for EXISTING rows is done by tools/audit-default-passwords.mjs,
-- which verifies each hash against the start password in the Worker's own scheme and writes the
-- flag. This file only adds the machinery.

alter table app_users
  add column if not exists password_is_default  boolean not null default true,
  add column if not exists password_changed_at  timestamptz;

comment on column app_users.password_is_default is 'true while the hash is the provisioning start password; a row on the default must change it (trigger forces must_change_password)';
comment on column app_users.password_changed_at is 'when the hash last changed, by any path (trigger)';

-- ---- 1. born on the default ⇒ must change -------------------------------------------------
create or replace function app_users_password_birth() returns trigger
language plpgsql as $$
begin
  if new.password_is_default then new.must_change_password := true; end if;
  if new.password_changed_at is null then new.password_changed_at := now(); end if;
  return new;
end $$;

drop trigger if exists app_users_password_birth on app_users;
create trigger app_users_password_birth
  before insert on app_users
  for each row execute function app_users_password_birth();

-- ---- 2. a new hash is a personal password unless the statement says "reset" --------------
create or replace function app_users_password_turn() returns trigger
language plpgsql as $$
begin
  if new.password_hash is distinct from old.password_hash then
    -- the caller did not touch the flag ⇒ this is the person's own password
    if new.password_is_default is not distinct from old.password_is_default then
      new.password_is_default := false;
      new.must_change_password := false;
    end if;
    -- a reset to the default always forces the change
    if new.password_is_default then new.must_change_password := true; end if;
    new.password_changed_at := now();
    new.failed_attempts := 0;
    new.locked_until := null;
  end if;
  return new;
end $$;

drop trigger if exists app_users_password_turn on app_users;
create trigger app_users_password_turn
  before update of password_hash, password_is_default on app_users
  for each row execute function app_users_password_turn();

-- ---- 3. the person changes their own password -------------------------------------------
create or replace function set_password(
  p_user_id        uuid,
  p_new_hash       text,
  p_keep_token     text default null,     -- the caller's own session survives; every other one dies
  p_ip             text default ''
) returns jsonb
language plpgsql
as $$
declare
  v_username text;
  v_dropped  integer;
begin
  if p_new_hash is null or p_new_hash !~ '^pbkdf2h\$' then
    raise exception 'set_password: hash must be in the Worker''s pbkdf2h scheme' using errcode = 'P0001';
  end if;
  update app_users
     set password_hash = p_new_hash,
         password_is_default = false          -- said out loud, so the trigger cannot read this as a reset
   where id = p_user_id and active
   returning username into v_username;
  if v_username is null then
    raise exception 'set_password: no active account %', p_user_id using errcode = 'P0002';
  end if;
  delete from app_sessions
   where user_id = p_user_id
     and (p_keep_token is null or token_hash <> p_keep_token);
  get diagnostics v_dropped = row_count;
  insert into auth_log (user_id, username, event, ip) values (p_user_id, v_username, 'password_change', coalesce(p_ip, ''));
  return jsonb_build_object('ok', true, 'username', v_username, 'sessions_dropped', v_dropped);
end $$;

-- ---- 4. an administrator puts an account back on the start password -----------------------
create or replace function reset_password_to_default(
  p_user_id      uuid,
  p_default_hash text,                     -- hashPassword(start password), made by the Worker/tool
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
         password_is_default = true,        -- the trigger forces must_change_password
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
  return jsonb_build_object('ok', true, 'username', v_username, 'sessions_dropped', v_dropped, 'must_change_password', true);
end $$;

-- ---- 5. who is still on the start password ----------------------------------------------
create or replace view accounts_on_default_password as
select u.username, u.full_name, u.role, u.cb, u.active, u.last_login,
       u.must_change_password,
       greatest(0, (current_date - coalesce(u.password_changed_at, u.created_at)::date)) as days_on_default
  from app_users u
 where u.password_is_default
 order by (u.role = 'agent'), u.role, u.username;

comment on view accounts_on_default_password is 'active or not, every account whose hash is still the provisioning start password; management roles first';

grant execute on function set_password(uuid, text, text, text) to service_role;
grant execute on function reset_password_to_default(uuid, text, text) to service_role;
grant select on accounts_on_default_password to service_role;
