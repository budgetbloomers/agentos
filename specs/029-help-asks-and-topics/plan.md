# Implementation Plan: Who asks for help, and what they ask most

**Branch**: `feat/029-asks` | **Date**: 2026-10-11 | **Spec**: [spec.md](spec.md) | **Data model**: [data-model.md](data-model.md)

## Summary
028's `usage_events` already records every help ask (agent → TL) and every CM request (TL → CM). 029 adds:
1. **The TL's words on a CM request** (FR-002): `assist.mjs` puts the description (+ business impact) in
   `detail.text` / `detail.impact` of the `cm_request` row — never for a restricted request (it has no text), clamped to
   2,000 like a help note. The responsible campaign managers at raise time (`detail.cms`, from `cm:assignments`) ride too.
2. **One topic per ask** (FR-003): `usage_events.topic` (a slug from `ask_topics`). `worker/src/topics.mjs` labels the
   ask AFTER the response, inside the same `ctx.waitUntil` as 028's insert: insert (returning its id) → active topics
   (cached per isolate, 10 min) → Workers AI (`env.AI`, the SAME models as `/api/ask`: Llama 4 Scout, falling back to
   Llama 3.3 70B; 8 s per attempt) → `PATCH usage_events?id=eq.<id>&topic=is.null`. The AI's answer is checked against
   the active list; anything else is `other`. AI missing / failing / over the daily allowance → topic stays NULL.
3. **Topics Nick owns** (FR-004): `ask_topics` (slug, label, hint, merged_into, active). Renaming = edit `label`;
   merging = set `merged_into` (+ `active=false`). `ask_topic_effective` follows merge chains, so every past count moves.
4. **Report views** (FR-001, SC-001/002) — day / week / month in one long shape (`grain`, `period_start`, SAST):
   `help_askers_by_period`, `help_askers_by_tl`, `help_askers_by_campaign`, `help_top_askers`, `cm_askers_by_period`,
   `cm_askers_by_cm`, `most_asked_topics`, `most_asked_categories`, on top of one row-per-ask view `ask_events`.
5. **Catch-up + history** (FR-005): `tools/usage-topics.mjs` (`--dry` default, `--apply`) labels every row with a NULL
   topic; `tools/usage-backfill.mjs` gains the Campaign Assistance pipeline (read-only GETs) — the TL's words attach to
   the request rows the mirror backfill made, and rounds with no mirror row come back from the card's notes.

## Decisions (and why)
| Brief | Plan | Why |
|---|---|---|
| Label route POST /api/usage/label (admin) **or** Workers AI REST with the wrangler OAuth token | **REST** (`api.cloudflare.com/client/v4/accounts/<acct>/ai/run/<model>`), token from `CLOUDFLARE_API_TOKEN` or wrangler's OAuth config (scope `ai:write` is present), account from `CLOUDFLARE_ACCOUNT_ID` or `GET /accounts` | No new write route on the Worker (constitution V: nothing to scope, rate-limit or mint sessions for), no deploy needed before the label run, no 50-subrequest ceiling on the batch. The SAME `labelAsk()` runs in both places: the tool hands it an `env.AI` shim backed by REST, so prompt + validation cannot drift. |
| PATCH by source_key/id | insert asks for `return=representation` (`db.mjs`: `'ignore'` + returning → `resolution=ignore-duplicates,return=representation`); PATCH by `id`, else by `source_key` (a conflict-ignored row), both with `topic=is.null` | A not-delivered ask has no source_key; `topic=is.null` means a live label never overwrites one the tool or Nick set |
| ≤ 2 extra subrequests | fetch subrequests: `ask_topics` read (cold isolate only) + the PATCH. `env.AI` is a binding to a Cloudflare service — it does not count toward the FREE plan's 50 external subrequests, but it is still bounded: ≤ 2 attempts, 8 s each, `max_tokens` 12 | Guarded in verify-usage-029 (cold ≤ +2, warm ≤ +1) |
| Topics table (topic, label, merged_into, active, created_at) | + `hint` (one line saying what belongs in the topic) | the hint is what makes a small model pick consistently; it is shown in the prompt only |
| — | deterministic pre-labels, no AI call: empty / < 3 letters → `other`; restricted CM request → `personal`; an obvious test ("test", "testing", "hi", "AUTOMATED TEST …") → `test` | spec edge case ("too short → Other"); the real data (11 Help cards, 2 CM cards) is half test asks — they must not crowd "most asked"; a restricted request's text never exists, so nothing goes to the AI |
| CM text for rows already backfilled | `usage_attach_cm_text(source_key, text, impact)` — fills `detail.text` ONCE (only when empty, never restricted), service_role only | live 028 backfill already wrote the one real CM request without text; usage_events stays append-only otherwise (service_role gets UPDATE on `topic` only) |
| "per campaign manager" | `cm_askers_by_cm`: who actually HANDLED it — the first action in the request's round by someone who is not the requesting TL (campaign manager / admin / exec), else "Not picked up yet" / "Not delivered"; `detail.cms` keeps who was responsible at raise time | all three CMs are assigned to every campaign today, so "responsible" alone would triple-count |

## Technical Context
ESM Worker, Cloudflare FREE (10 ms CPU, 50 subrequests); Supabase via PostgREST; tests run the migration VERBATIM in
PGlite (028 harness, extended with PATCH); the real Worker in-process with stubbed PostgREST/HighLevel/AI.

## Constitution Check
- I Engine decides — the AI picks a LABEL from a closed list, never a figure; every count is SQL. A label the list does
  not contain is refused (→ `other`). ✅ (recorded in Complexity Tracking)
- II Absence ≠ nought — an unlabelled ask reads "Not labelled yet", never "Other"; an AI outage leaves NULL for the tool. ✅
- III Agent List — TL/campaign are 028's (digest row at ask time); CM from `cm:assignments` + the actor on record. ✅
- V Locked down — RLS on `ask_topics`; everything revoked from public/anon/authenticated; service_role SELECT on views,
  UPDATE only on `usage_events.topic`; functions `search_path` pinned + EXECUTE revoked (049 rule); no new route, no new
  CORS header; restricted text never stored or sent to the AI. ✅
- VI Saves — telemetry, fire-and-forget (028's justified deviation). ✅
- VII Guard first — `verify-usage-029` RED before code, registered in verify.yml. ✅

## Release order (Nick)
1. `node tools/apply-migration.mjs supabase/migration-062-help-asks-and-topics.sql`.
2. Deploy the Worker (`cd worker && npx wrangler deploy`) — no new secret (AI binding exists), then Pages (`node tools/prepare-site.js`, unchanged pages).
3. `node tools/usage-backfill.mjs --sources=hl_help,cm,hl_cm` (dry) → `--apply` (needs `help-highlevel.env`).
4. `npx wrangler whoami` (refreshes the OAuth token) → `node tools/usage-topics.mjs` (dry: sizes + samples) → `--apply`.
5. SQL in data-model.md answers the three questions.

## Complexity Tracking
| Deviation | Why needed | Simpler alternative rejected |
|---|---|---|
| An LLM decides a category that is counted | Nick's decision 2 ("grouped into topics by the AI AgentOS already uses") | keyword rules: rewordings would split; free-text AI labels: unbounded, ungroupable |
| `usage_events.topic` is updatable | the label arrives after the insert | label before insert: an AI outage would delay or lose the ask row |
| `usage_attach_cm_text` writes detail once | 1 live CM row predates FR-002 | re-inserting: duplicate request rows |
