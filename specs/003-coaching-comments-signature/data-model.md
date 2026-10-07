# Data model: Coaching comments show, signatures save

No database or Hub schema changes. Two payload shapes gain fields; one page state is corrected.

## Coaching form state (page, `CFORM.data`)

| Field | Before | After |
|---|---|---|
| `agentSignature`, `teamLeaderSignature`, `sosSignature` | always `''` (the pad never wrote) | `data:image/png;base64,…` once drawn, `''` after Clear |
| `employeeSignoffs[i].signature` | always `''` | as above, per attendee |
| `CFORM.dirty` | unchanged by drawing | `true` once a signature is drawn |

## Live session list row (`GET /api/portal/hub/coaching` → `sessions[]`)

Unchanged fields stay as they are (signature images were already removed at the top level). Added:

| Field | Type | Meaning |
|---|---|---|
| `_sigs` | `{field, label, signed}[]` | one per signatory the product declares; `signed` = the Hub record holds a non-empty image |
| `employeeSignoffs[i].signed` | boolean | group attendee row; replaces the `signature` image, which no longer travels |

Products and their declared signatories (from the create spec): formal / informal / QA → agent, team leader;
lead management → agent, SOS; group → per attendee row; scorecard → none (`_sigs: []`).

## Coaching copy session (`kv:coaching` → `sessions[]`, normalised)

| Field | Type | Meaning |
|---|---|---|
| `callNotes` | `string[]` (absent when none) | formal sessions: each call's development areas, trimmed, ≤ 600 chars each, empties dropped; NEVER the contact number |

## Validation

- A supplied signature is accepted only as `data:image/…` ≤ 250,000 characters; otherwise the create is refused (400)
  with the signatory named. `''`/absent = not signed.
