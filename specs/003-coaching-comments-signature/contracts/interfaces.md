# Contracts: Coaching comments show, signatures save

## C1 — Session list: signature presence (`GET /api/portal/hub/coaching`, team leader only)

Each `sessions[]` row (synthetic example):

```json
{
  "_id": "k1…", "_table": "formalCoachingCalls", "_label": "Formal Coaching",
  "date": "2026-10-05", "agentName": "Ann Agent", "employeeCode": "CB1",
  "supportProvided": "Role-played the price objection.",
  "calls": [{ "contactNumber": "0820000000", "developmentAreas": "Rushed the close." }],
  "_sigs": [
    { "field": "agentSignature", "label": "Agent", "signed": true },
    { "field": "teamLeaderSignature", "label": "Team leader", "signed": false }
  ]
}
```

- No key matching `/signature/i` holding an image appears anywhere in the payload, nested arrays included.
- Group rows: `employeeSignoffs: [{ "employeeName": "…", "date": "…", "signed": false }]`, `_sigs: []`.
- Scorecard rows: `_sigs: []`.

## C2 — Create: a supplied signature is never dropped (`POST /api/portal/hub/coaching`)

- Signature value `''` / absent → not signed, the create proceeds (unchanged).
- Signature value present but not `data:image/…` or longer than 250,000 characters →
  `400 { "error": "The team leader signature could not be read — clear it and sign again." }` and NOTHING is written.
- A valid image → forwarded to the Hub create under the same field name (unchanged).

## C3 — Coaching copy: call notes (`kv:coaching`, `worker/src/coaching.mjs normalise`)

- Formal sessions gain `callNotes: ["Rushed the close.", "…"]` (≤ 3, each ≤ 600 chars, empties dropped).
- `contactNumber` never appears in the copy, nor in any agent payload built from it.

## C4 — Page helpers (`agent/index.html`, ES5)

- `coachNote(s)` → the one-line note for a list row, by product (research R4). Used by "Your sessions" and "All forms".
- `coachSaid(s)` / `coachAgreed(s)` → the agent card's "What was discussed" / "What you agreed".
- `coachSigLine(s)` → from `_sigs`: `''` when the product has no signatories; otherwise e.g. "Signed by agent and team
  leader" or "Not signed by team leader". Shown on the list row and in the session view.
- All output through `esc()`.
