# Implementation Plan: Wimpy order history — each person sees only their own orders

**Branch**: `015-wimpy-order-history` | **Date**: 2026-10-07 | **Spec**: [spec.md](spec.md)

## Summary

Every order the Worker accepts (and hands to the n8n kitchen webhook, unchanged) is also recorded in our own ledger,
owned by the signed-in account's id, and then — off the request's critical path — written to the Wimpy HighLevel
sub-account as the person's contact + one opportunity ("card") per order in "Wimpy Pipeline" at "New Order". A new
`GET /api/wimpy/orders` returns the signed-in account's own ledger rows (newest 50) with each order's live stage read
from HighLevel, accepting a card only when it is recorded on that row AND belongs to that person's contact. The Wimpy
page gets a "My orders" view (ES5). Failed HighLevel writes retry on a dedicated cron with its own subrequest budget.

## Technical Context

**Language/Version**: JavaScript — Cloudflare Worker (ES modules), page ES5 (`wimpy/index.html`), Node 24 test harness
**Primary Dependencies**: Supabase PostgREST (service key, `worker/src/db.mjs`), HighLevel API v2
(`services.leadconnectorhq.com`, `Version: 2021-07-28`, Bearer private-integration token)
**Storage**: two new Postgres tables (migration-055): `wimpy_orders` (ledger) and `wimpy_hl_contacts` (person → contact)
**Testing**: `nicks_code/diagnostics/verify-wimpy-history.mjs` — the real Worker module in-process with stubbed fetch
(Supabase + HighLevel + n8n) and the real page in Chromium; existing `verify-wimpy`, `verify-wimpy-signin` stay green
**Target Platform**: Cloudflare Workers FREE plan (10 ms CPU, 50 subrequests per invocation) + Pages
**Constraints**: ordering must never fail or slow because of HighLevel; per-request subrequests ≤ 12; secrets never in
code, git, logs or responses
**Scale**: ~130 people, ≤ a few hundred orders a week

## Constitution Check

| Principle | How this plan honours it |
|---|---|
| I. Engine decides, page paints | The Worker decides ownership and the stage label; the page only renders the list it is given |
| III. The Agent List is the record | Owner = the signed-in account (Agent List accounts); leavers' accounts go → their rows cascade away |
| V. Locked down by default | Tables RLS-on with no policies + `revoke all … from public, anon, authenticated`; route inside the wimpy fence; identity from the session only; secrets as Worker secrets |
| VI. Saves acknowledged, noticed, recoverable | Ledger row is the acknowledgement; HighLevel write tracked per row (`pending/written/failed/stuck`), retried, stuck rows alert |
| VII. Every rule has a guard | `verify-wimpy-history.mjs` registered in verify.yml; isolation checks run RED first |

No violations.

## Design (see research.md, data-model.md, contracts/wimpy-orders.md)

1. **Order path** (`submitWimpyOrder`, unchanged up to the n8n POST):
   n8n OK → insert ledger row (`hl_state='pending'`; a failed insert is logged and reported, the order still succeeds) →
   `ctx.waitUntil(writeOrderToHighLevel(row))`. The response to the page is unchanged.
2. **writeOrderToHighLevel(row)** (`worker/src/wimpy-hl.mjs`, new): read the owner's `wimpy_hl_contacts` row → if none,
   `POST /contacts/` (name as typed, phone, tags `wimpy`, CB) and insert the link (`on conflict do nothing`, then re-read —
   a racing duplicate contact is left orphaned, never linked) → `POST /contacts/{id}/notes` with the formatted order →
   `POST /opportunities/` (pipeline "Wimpy Pipeline", stage "New Order", `status:'open'`, `contactId`, `monetaryValue` =
   total, name `CB · first last · R total · time`) → patch the row `written` + `hl_opportunity_id` + `hl_contact_id`.
   Any failure → `failed`, `hl_tries+1`, `hl_error` (redacted, ≤ 300 chars), `hl_next_at` = backoff (2, 5, 10, 20, 40 min…);
   after 8 tries → `stuck`. Pipeline + stage ids resolved by NAME from `GET /opportunities/pipelines` and cached in the
   isolate (re-resolved on a miss).
3. **Retry cron**: a third trigger `"7,27,47 * * * *"` (`WIMPY_CRON`) routed explicitly in `scheduled()` (today anything
   that is not the tick is treated as the coaching wave — that routing becomes an explicit three-way match). It takes ≤ 5
   due rows (`pending` older than 2 min or `failed` with `hl_next_at <= now`), writes `kv:wimpy-hl-status`
   (counts + last error, no personal data), and health raises an alert when any row is `stuck`.
4. **History** `GET /api/wimpy/orders`: owner = `user.user_id` from the session; query parameters and body are IGNORED.
   `wimpy_orders?owner_user_id=eq.<uuid>&order=placed_at.desc&limit=50` → if any row has `hl_opportunity_id`: the owner's
   contact link → `GET /opportunities/search?location_id&contact_id&pipeline_id&limit=100` → a card's stage is used only
   if `card.contactId === link.contact_id` AND `card.id` is that row's `hl_opportunity_id`. HighLevel down/slow (5 s) →
   orders still returned with `stage:null, stage_note`. Response carries no HighLevel ids, no phone, no other person's data.
   Also kicks a `waitUntil` retry of THIS owner's due rows (≤ 2) so a person's own pending card catches up when they look.
5. **Page** (`wimpy/index.html`, ES5): a "My orders" button on the menu screen AND on the closed-window screen; list
   newest first (SAST time, items × qty, total, stage chip), empty state, "History starts <date>", Refresh; cleared by
   `wReset()` on sign-out / 401 (spec 014 A4).
6. **Secrets/config**: `WIMPY_HL_API_KEY`, `WIMPY_HL_LOCATION_ID` via `wrangler secret put` (release step, Nick's OK);
   local copy only in git-ignored `wimpy-highlevel.env`. Missing config → rows stay `pending` with error "not configured";
   history says stages are not available yet. `WIMPY_HISTORY_SINCE` constant in wimpy.mjs set to the release day.

## Project Structure

```text
worker/src/wimpy.mjs            submitWimpyOrder → ledger insert + waitUntil hand-off; WIMPY_HISTORY_SINCE
worker/src/wimpy-hl.mjs         NEW — HighLevel client (contact, note, opportunity, search, pipelines), writeOrderToHighLevel,
                                retryDueOrders, listMyOrders; every call with a timeout, errors redacted
worker/src/index.mjs            GET /api/wimpy/orders inside the wimpy fence; pass ctx to submitWimpyOrder; scheduled() 3-way
worker/src/health.mjs           stuck-row alert from kv:wimpy-hl-status
worker/wrangler.toml            third cron "7,27,47 * * * *"
supabase/migration-055-wimpy-order-history.sql   NEW — tables, indexes, RLS on, revokes, grants to service_role
wimpy/index.html                "My orders" view (ES5)
nicks_code/diagnostics/verify-wimpy-history.mjs  NEW guard; registered in .github/workflows/verify.yml
```

## Subrequest budget (FREE plan, 50)

| Invocation | Calls |
|---|---|
| POST /api/wimpy/order | session 1 + n8n 1 + ledger insert 1 + waitUntil (link read 1, contact 1, link insert 1, re-read 1, note 1, pipelines 1, opportunity 1, row patch 1) = ≤ 11 |
| GET /api/wimpy/orders | session 1 + ledger 1 + link 1 + pipelines 1 + search 1 + own retry ≤ 2 × 8 = ≤ 21 |
| Wimpy cron | due select 1 + 5 × 8 + status write 1 = ≤ 42 |

## Release (only with Nick's go-ahead)

1. Nick turns ON "Allow duplicate opportunities" in the Wimpy sub-account; the release script reads
   `GET /locations/{id}` and refuses to continue while `settings.allowDuplicateOpportunity` is false.
2. `wrangler secret put WIMPY_HL_API_KEY` / `WIMPY_HL_LOCATION_ID` → migration-055 → Worker deploy → Pages.
3. One marked TEST order end-to-end (Nick's OK — a live kitchen order + card), confirm the card at "New Order" and the
   history answer; delete the TEST card afterwards if Nick wants.
