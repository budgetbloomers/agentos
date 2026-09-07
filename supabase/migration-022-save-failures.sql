-- ============================================================================
-- migration-022 — save_failures: a refused save reports itself.
--
-- 2026-09-07: Nick's Ops tab showed "2 items NOT saved to the database — retrying
-- automatically" for the whole morning. The same page booted headlessly from the same
-- origin saved everything; nothing his tab tried ever reached the Worker's write log,
-- because a refused or failed request is not a write. The only evidence was a toast
-- with a status code that disappears after twelve seconds. Non-negotiable 14(c) says
-- the server watches for what did NOT arrive — this table is where a client tells it.
--
-- Both dashboards' save paths now POST /api/save-fail with the key, the status (HTTP
-- code + response snippet, or "network") and the build; the Worker inserts here and
-- the health cron raises `saves-failing` when several land within an hour.
-- ============================================================================
create table if not exists save_failures (
  id        bigserial primary key,
  at        timestamptz not null default now(),
  username  text,
  app       text,                 -- 'ops' | 'vas'
  key       text,                 -- the kv key the client was saving
  status    text,                 -- '409 {"error":"wipe_blocked…"}' | 'network TypeError: …' | '426 …'
  detail    text,
  build     text,                 -- CBX_BUILD of the tab that failed
  ua        text
);
create index if not exists save_failures_at_idx on save_failures (at desc);
alter table save_failures enable row level security;
comment on table save_failures is
  'One row per cloud save a dashboard could not land, reported by the client (POST /api/save-fail). The write log shows what arrived; this shows what did not, and why.';
