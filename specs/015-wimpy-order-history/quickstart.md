# Quickstart: prove Wimpy order history (015)

Offline (no credentials):
1. `node tools/prepare-site.js`
2. `node nicks_code/diagnostics/verify-wimpy-history.mjs` — two people order; each history holds only their own;
   forged cb/contact/id parameters change nothing; HighLevel down → order still placed, retried by the Wimpy cron;
   duplicate refusal recorded; no key/location/phone/HighLevel id in any reply; ES5 page; sign-out clears the list.
3. `node nicks_code/diagnostics/verify-wimpy.mjs` and `verify-wimpy-signin.mjs` — unchanged and green.

Release (Nick's go-ahead): duplicates ON check → secrets → migration-055 → Worker → Pages → one TEST order → open
"My orders" → see it at "New Order"; move the card in HighLevel → refresh → stage follows.
