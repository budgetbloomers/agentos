-- migration-069-wimpy-orders-outlive-accounts.sql — an order is a record; it stays when the account goes (2026-11-10)
--
-- wimpy_orders.owner_user_id referenced app_users ON DELETE CASCADE (migration-055). When someone leaves the Agent List
-- the list sync deletes their account, and the cascade deleted every Wimpy order they had placed. Found 10 Nov 2026:
-- Wandile Nxumalo (CB252) left the list and his 7 orders, 22 Oct – 5 Nov, R729.10, vanished from AgentOS, although
-- the kitchen's HighLevel cards still showed them (cb121 and cb368 went the same way).
--
-- Now the order stays and only its owner link is cleared: owner_user_id may be NULL, and NULL means "the account was
-- deleted". `cb`, `placed_at`, `items` and `total` still say who ordered what and for how much. Nothing that reads the
-- ledger needs an owner: the history page selects by the signed-in owner (a NULL row is nobody's), the HighLevel retry
-- reads hl_state pending/failed only, and the duplicate-card check matches hl_opportunity_id.
--
-- wimpy_hl_contacts keeps its cascade: it is a cache of a person's HighLevel contact id, not a record of anything.
-- Idempotent.

alter table wimpy_orders alter column owner_user_id drop not null;

alter table wimpy_orders drop constraint if exists wimpy_orders_owner_user_id_fkey;
alter table wimpy_orders add constraint wimpy_orders_owner_user_id_fkey
  foreign key (owner_user_id) references app_users(id) on delete set null;

comment on column wimpy_orders.owner_user_id is
  'The account that placed the order; NULL = that account was deleted (migration-069). cb keeps who it was.';
