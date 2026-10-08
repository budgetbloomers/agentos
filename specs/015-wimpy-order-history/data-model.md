# Data model: Wimpy order history (015) — migration-055

## wimpy_orders (the ledger — one row per accepted order)

| Column | Type | Rule |
|---|---|---|
| id | uuid pk default gen_random_uuid() | |
| owner_user_id | uuid not null → app_users(id) on delete cascade | the signed-in account (session `user_id`); the ONLY key history reads by |
| cb | text not null | CB number or manager username, from `whoIsOrdering` (already equal to the session's) |
| placed_at | timestamptz not null default now() | |
| items | jsonb not null | `[{id, item, quantity, item_total}]` from `priceOrder` |
| total | numeric(10,2) not null | server-priced total |
| notes | text | the person's own additional notes (≤ 1000) |
| hl_state | text not null default 'pending' | check in ('pending','written','failed','stuck') |
| hl_contact_id / hl_opportunity_id | text | set when written |
| hl_tries | int not null default 0 | stuck after 8 |
| hl_error | text | redacted, ≤ 300 chars |
| hl_next_at | timestamptz not null default now() | backoff; the order path inserts now + 2 min so the retry cron never races its own hand-off |
| hl_contact_seed | jsonb | `{first, last, phone}` as TYPED on the order — kept ONLY to create the person's HighLevel contact; cleared when the row is `written`, when it goes `stuck`, and on any attempt once the person has a contact link (review M4); never in any reply (added at implementation: the ledger otherwise holds no name/phone, so a retry could not create the contact) |

`notes` ≤ 1000 and `hl_error` ≤ 300 characters are check constraints on the table itself.

Indexes: `(owner_user_id, placed_at desc)`; partial `(hl_next_at) where hl_state in ('pending','failed')`.

## wimpy_hl_contacts (one HighLevel contact per person)

| Column | Type | Rule |
|---|---|---|
| owner_user_id | uuid pk → app_users(id) on delete cascade | |
| cb | text not null | |
| contact_id | text not null unique | |
| created_at | timestamptz default now() | |

Both tables: `enable row level security` (no policies), `revoke all … from public, anon, authenticated`,
`grant select, insert, update, delete … to service_role`. No functions (nothing to revoke EXECUTE on).

## State transitions (hl_state)

pending → written (card created) · pending/failed → failed (tries+1, backoff 2·5·10·20·40·80·160 min) · failed → stuck
(tries ≥ 8; health alert) · stuck → pending only by hand (re-queue after the cause is fixed).
