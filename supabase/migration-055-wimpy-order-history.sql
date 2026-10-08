-- migration-055 · Wimpy order history — each person sees only their own orders (Spec Kit 015-wimpy-order-history, 2026-10-07)
--
-- Nick: "I gave you the private intergration key and location ID to shpw the users their order history, it must only
-- show their order history and no one elses".
--
-- Two tables, both the Worker's alone (service_role over PostgREST; no page ever reaches Supabase):
--   · wimpy_orders       THE LEDGER — one row per order the Worker accepted (written after the n8n kitchen webhook said
--                        yes). owner_user_id is the signed-in session's user id and the ONLY key "My orders" reads by.
--                        hl_* track the order's card in the Wimpy HighLevel sub-account (pending → written | failed →
--                        stuck after 8 tries); hl_contact_seed is the name and phone the person TYPED, kept only until
--                        the card is written (it is what a retry creates their contact from) and then cleared.
--   · wimpy_hl_contacts  one HighLevel contact per person, created once and reused for every later order.
-- A leaver's account is deleted by sync_agent_list → their rows cascade away (their cards stay in HighLevel).
--
-- Locked down like every table here: RLS ON with NO policies, everything revoked from public/anon/authenticated, the
-- four verbs granted to service_role. No functions, so nothing to revoke EXECUTE on (migration-049 covers future ones).
--
-- NOT APPLIED. Apply only at release, with Nick's go-ahead, BEFORE the Worker that writes to it is deployed:
--   node tools/apply-migration.mjs supabase/migration-055-wimpy-order-history.sql
-- Safe to re-run (if not exists everywhere).

create table if not exists wimpy_orders (
  id                 uuid primary key default gen_random_uuid(),
  owner_user_id      uuid not null references app_users (id) on delete cascade,
  cb                 text not null,                       -- CB number, or a manager's username (whoIsOrdering, checked against the session)
  placed_at          timestamptz not null default now(),
  items              jsonb not null,                      -- [{id, item, quantity, item_total}] as priced by the Worker
  total              numeric(10,2) not null,              -- the Worker's total, never the page's
  notes              text check (notes is null or char_length(notes) <= 1000),
  hl_state           text not null default 'pending' check (hl_state in ('pending', 'written', 'failed', 'stuck')),
  hl_contact_id      text,
  hl_opportunity_id  text,
  hl_tries           int not null default 0,
  hl_error           text check (hl_error is null or char_length(hl_error) <= 300),   -- redacted: never the key, the location or a phone number
  hl_next_at         timestamptz not null default now(),  -- when the retry cron may next take it (backoff 2·5·10·20·40·80·160 min)
  hl_contact_seed    jsonb                                -- {first, last, phone} as typed; cleared once the card is written
);
create index if not exists wimpy_orders_owner_placed_idx on wimpy_orders (owner_user_id, placed_at desc);
create index if not exists wimpy_orders_hl_due_idx on wimpy_orders (hl_next_at) where hl_state in ('pending', 'failed');

create table if not exists wimpy_hl_contacts (
  owner_user_id  uuid primary key references app_users (id) on delete cascade,
  cb             text not null,
  contact_id     text not null unique,                   -- one HighLevel contact is never linked to two people
  created_at     timestamptz default now()
);

alter table wimpy_orders enable row level security;
alter table wimpy_hl_contacts enable row level security;
revoke all on table wimpy_orders from public, anon, authenticated;
revoke all on table wimpy_hl_contacts from public, anon, authenticated;
grant select, insert, update, delete on table wimpy_orders to service_role;
grant select, insert, update, delete on table wimpy_hl_contacts to service_role;

comment on table wimpy_orders is
  'Spec Kit 015: one row per Wimpy order the Worker accepted (after the n8n kitchen webhook). owner_user_id = the signed-in session; GET /api/wimpy/orders reads by it alone. hl_* = the order''s card in the Wimpy HighLevel sub-account.';
comment on table wimpy_hl_contacts is
  'Spec Kit 015: the one HighLevel contact (Wimpy sub-account) each person''s orders are carded under — created on their first order, reused after.';
