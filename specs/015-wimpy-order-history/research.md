# Research: Wimpy order history (015)

Probed read-only 2026-10-07 with the key Nick supplied (no writes; probes that POST an empty body are refused by
HighLevel's validation and create nothing).

| Question | Finding | Decision |
|---|---|---|
| Where are orders today? | Location (id in the git-ignored wimpy-highlevel.env — never in the repo, FR-009) ("Wimpy ", added 2025-09-04, tz Africa/Harare): **0 contacts, 0 opportunities**. Orders go only to the n8n webhook (`worker/src/wimpy.mjs` WEBHOOK). | The Worker writes orders to HighLevel itself (Nick, decision 2). |
| Pipeline | One: "Wimpy Pipeline" — New Order → Order Processing → Ready for Collection → Completed. | Card at "New Order"; stage names shown to the person as-is; ids resolved by NAME at run time (no hard-coded ids). |
| Duplicate cards | `settings.allowDuplicateOpportunity: false` (contacts: `allowDuplicateContact: true`). | Nick turns duplicates ON (decision 3); release refuses while it is off; a duplicate refusal is recorded as `failed` with its reason. |
| Key scopes | `GET` location/contacts/pipelines/opportunities/customFields/objects 200; `POST /contacts/search` 200; `POST /opportunities/` `{}` → 422 "locationId can't be undefined" (scope OK); `POST /contacts/` `{}` → 403 "token does not have access to this location" (ambiguous — body had no locationId). | Contact write access is CONFIRMED only by the approved TEST order at release (FR-012). |
| Custom fields | Only the template's three contact fields; no opportunity fields; no custom objects beyond Company/Opportunity/Contact. | No schema writes in HighLevel: the order's items go in a contact NOTE and the card name; our ledger holds items for history. |
| Who owns an order? | The session carries `user_id` (uuid, `auth.mjs` sessionUser) — never forgeable by the page. | Ledger owner = `user_id`; the CB/username from `whoIsOrdering` (already checked against the session) is stored beside it. |
| Where do retries run? | The 10-min tick already spends most of its 50 subrequests (roster sync + health); the coaching wave has its own trigger. | A third cron (`7,27,47 * * * *`) with its own budget; `scheduled()` routes the three expressions explicitly. |
| Isolation of the stage read | HighLevel search by `contact_id` returns that contact's cards. | Belt and braces: a card is used only if its `contactId` equals the owner's linked contact AND its id is recorded on the owner's own ledger row. |

Alternatives rejected: history from HighLevel alone (no ownership guarantee beyond a search filter, nothing when HighLevel
is down); keying people by phone (people share/retype phones); one card per person + notes (Nick chose duplicates ON).
