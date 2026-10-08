# Contract: GET /api/wimpy/orders (new) and POST /api/wimpy/order (unchanged reply)

## GET /api/wimpy/orders
Auth: `Authorization: Bearer <wimpy-scoped or full session>`. Query string and body are IGNORED (any `cb`, `user`,
`contact`, `id`… parameter changes nothing).

200:
```json
{ "since": "2026-10-08", "stages_available": true,
  "orders": [ { "placed_at": "2026-10-08T12:31:04+02:00", "total": "89.90", "notes": "no onions please",
                "items": [ { "item": "Cheese Burger", "quantity": 2, "item_total": "79.80" } ],
                "stage": "Ready for Collection", "stage_note": null } ] }
```
- newest first, ≤ 50; `stage` one of the pipeline's stage names, or `null` with `stage_note` ("Not on the kitchen board
  yet" / "The kitchen board could not be reached — try again shortly" / "No longer on the kitchen board").
- NEVER contains: HighLevel ids, phone numbers, contact names, another account's rows, the key or location id.
401 without a valid session; 403 for a session the wimpy fence refuses; 500 → `{error}` in words.

## POST /api/wimpy/order
Request and response unchanged (spec 009/wimpy). Side effects added after the kitchen accepts: ledger row + HighLevel
card. A ledger or HighLevel failure never changes the reply.
