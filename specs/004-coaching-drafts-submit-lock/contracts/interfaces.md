# Contracts: Coaching drafts with a submit lock

All routes: team leader only (`hubIdsOf`), JSON, the leader taken from the session. Synthetic values throughout.

## D1 — List drafts: `GET /api/portal/hub/coaching/drafts`

```json
{ "drafts": [
  { "id": "6f1c…", "type": "formalCoachingCalls", "label": "Formal Coaching", "state": "draft",
    "agentName": "Ann Agent", "employeeNumber": "CB1", "date": "2026-10-05",
    "createdAt": "2026-10-05T08:00:00.000Z", "updatedAt": "2026-10-05T08:30:00.000Z",
    "sigs": [ { "field": "agentSignature", "label": "Agent", "signed": true },
              { "field": "teamLeaderSignature", "label": "Team leader", "signed": false } ] } ],
  "max": 50 }
```

No content, no images. `state` is `draft` or `submitting` (`submitted` rows are never listed).

## D2 — Open one: `GET /api/portal/hub/coaching/drafts?id=<id>`

`{ "draft": { "id", "type", "label", "state", "updatedAt", "data": { …every form field, signatures as data:image… } } }`;
404 when it is not the caller's.

## D3 — Save: `POST /api/portal/hub/coaching/drafts` `{ action:"save", id?, base?, type, data }`

- No `id` → new draft (refused 409 at 50 drafts; 413 above 1.5 MB). With `id` → `base` (the `updatedAt` the page holds)
  is required; a mismatch or a `submitting` draft → `409 { error, conflict:true }`.
- Signatures are validated as in feature 003 (a supplied non-image or > 250,000 chars → 400 naming the signatory).
- Signature rule R5: `cleared: ["agentSignature", …]` lists stored signatures dropped because the content changed.
- `200 { ok:true, id, updatedAt, cleared }`.

## D4 — Delete: `{ action:"delete", id }` → `200 { ok:true }` (404 when not the caller's; 409 while `submitting`).

## D5 — Submit: `{ action:"submit", id, base, data? }`

- `data` (optional) = the form as it stands; R5 applies against the stored draft.
- Compare-and-set to `submitting` on `base` → 409 when it lost. Then `coachingCreate` → on success the row is deleted:
  `200 { ok:true, hubId, table, label, cleared }`; on failure the row returns to `draft` and the error is returned
  with `{ updatedAt }` (the new base).
- A new, never-saved form is submitted through the existing `POST /api/portal/hub/coaching` (unchanged create).

## D6 — Reopen a stuck submit: `{ action:"reopen", id }` → only when `state:"submitting"` for > 2 minutes; → `draft`.

## L1 — The leader's live list: `GET /api/portal/hub/coaching` (changed)

`sessions[]` rows carry ONLY: `_id, _table, _label, date, dateOfCoaching, agentName, employeeCode, employeeNumber,
campaign, _sigs, attendees` (count, group sessions). No comment field, no calls, no classification free text, no image.
`others[]` rows lose `supportProvided`.

## L2 — Leader-facing coaching sessions elsewhere

- `GET /api/portal/agent?cb=` called by a team leader: `coaching.agents[0].sessions[]` carry no field from
  `COACH_TEXT_FIELDS` and no `callNotes`.
- `GET /api/portal/help/fail-detail` called by a team leader: every `sessions[].note` is `''`.
- Agents (own overview) and campaign managers: unchanged.

## P1 — Page (agent/index.html, ES5)

- Form buttons: **Save draft**, **Submit**, **Delete draft** (when saved), **← All forms**.
- Hub tab: a **Drafts** card (product, agent, last saved, signature state, Open, Delete; "Submitting — check your
  sessions" + Reopen for a stuck one) above **Your sessions**, whose rows are agent · product · date · SUBMITTED ·
  signature line — no Notes column, no View.
- "All forms": coaching drafts (DRAFT, Open) and submitted sessions (SUBMITTED, no action).
- The footer keeps the "Open the Coaching Hub ↗" link (new tab, rel=noopener) but no longer invites editing or printing a submitted document there.
- Editing any content after a signature clears every signature with the notice
  "The document changed after it was signed — signatures cleared, please sign again."
