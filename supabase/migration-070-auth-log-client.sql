-- migration-070-auth-log-client.sql — every sign-in audit row says which browser, page and typing trouble (2026-11-10)
--
-- "20+ agents cannot log in with their CB number and agentos123". agentos123 was right for every one of them; between
-- 15:00 and 15:53 twelve people sent something else 39 times. auth_log could not say from which browser or page, or
-- whether Caps Lock or Num Lock was involved: only the sessions of the people who DID get in carry a user agent, so the
-- cause (new Linux PCs, Firefox 136 / Chrome 112) had to be pieced together from the successes.
--
-- auth_log.client now holds a short label such as "Firefox 136 | Linux | /agent/ | caps,numpad_off". The Worker builds
-- it (worker/src/signin-client.mjs: browser, system, page path, and up to four yes/no typing facts from a fixed list —
-- never the password) and sends it as the x-cbx-signin header on the sign-in request only. The column DEFAULT reads
-- that header from PostgREST's request.headers, so every row written during the sign-in — login_ok, login_fail:*,
-- locked — carries it with no change to the insert itself. That matters: the insert lives in the SHARED-AUTH blocks
-- of worker/src/auth.mjs, which the Wimpy service copies verbatim. Rows written any other way (the Wimpy service, the
-- Ops relay, a direct SQL session) get NULL.
--
-- A SIGN-IN MUST NEVER FAIL BECAUSE OF THE LABEL:
--   · the function returns NULL on anything unexpected (no header, an empty setting, malformed JSON) instead of raising —
--     a raise inside a column default would fail the auth_log insert, and the lockout counts failures from that insert;
--   · the column is added WITHOUT a default first (metadata only, no table rewrite), then the default is set, which
--     applies to new rows only;
--   · EXECUTE is granted to service_role explicitly: the Worker and the Wimpy service both write auth_log as
--     service_role, and a default the inserting role may not execute fails every insert. anon/authenticated get nothing
--     (migration-049's rule for every new function).
--   · auth_log is read and written on every sign-in, so no statement here may hold its lock for long: a 3-second lock
--     timeout makes the migration fail fast rather than queue sign-ins, and the length check is added NOT VALID (no scan
--     under the exclusive lock) and validated afterwards under the lighter SHARE UPDATE EXCLUSIVE lock.
-- Idempotent.

set lock_timeout = '3s';

create or replace function auth_log_client_label() returns text
language plpgsql stable set search_path = public as $$
declare h text;
begin
  h := current_setting('request.headers', true);
  if h is null or h = '' then return null; end if;
  return nullif(left(regexp_replace(coalesce(h::json ->> 'x-cbx-signin', ''), '[^A-Za-z0-9 ./_,|-]', '', 'g'), 120), '');
exception when others then
  return null;
end $$;

revoke execute on function auth_log_client_label() from public, anon, authenticated;
grant execute on function auth_log_client_label() to service_role;

alter table auth_log add column if not exists client text;
alter table auth_log alter column client set default auth_log_client_label();
alter table auth_log drop constraint if exists auth_log_client_len;
alter table auth_log add constraint auth_log_client_len check (client is null or char_length(client) <= 120) not valid;
alter table auth_log validate constraint auth_log_client_len;

comment on column auth_log.client is
  'Browser | system | page | typing facts of the sign-in that wrote this row (migration-070; worker/src/signin-client.mjs). NULL = not written by the Worker''s sign-in. Never holds the password.';
