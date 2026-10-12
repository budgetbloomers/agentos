# Feature Specification: a readable Wimpy orders view in Supabase, and a favicon (023)

**Created**: 2026-10-09 · **Input**: Nick: "create a wimpy table in the supabase and let the order of the people show there and add a favicon to the wimpy app"

## Decided
- Every order is already kept in `wimpy_orders` (spec 015). What is missing is a READABLE place: a view `wimpy_order_sheet` that shows, newest first, when (SA time), who (name + CB), what (items in words), the total, the notes and whether the card is on the kitchen board. No second table; nothing copied.
- The favicon is an inline SVG data icon in the page head (the CSP already allows `img-src data:`), with a matching theme colour.

## Stories
- US1 (P1): Nick opens Supabase → Table Editor → Views → `wimpy_order_sheet` and reads every order, newest first, in plain words.
- US2 (P2): the Wimpy tab in a browser shows an icon.

## Requirements
- FR-001: migration-059 creates the view; select granted to service_role only (revoked from public/anon/authenticated) like every Wimpy object.
- FR-002: the view leaves out phone numbers and HighLevel ids; it shows the HighLevel card state in words.
- FR-003: the page carries `<link rel="icon">` as a data URI; no external request; the ES5/no-price rules still hold.

## Success
- the view answers a query with today's orders; service tests green; the live page serves the icon.
