# Implementation Plan: A usage report you can query in Supabase

**Branch**: `feat/028-usage` | **Date**: 2026-10-11 | **Spec**: [spec.md](spec.md) | **Data model**: [data-model.md](data-model.md)

## Summary
One append-only table, `usage_events`, plus ready-made report views (migration-061). Events arrive three ways:
1. **Sign-ins mirror `auth_log` in the database** — an AFTER INSERT trigger copies every `auth_log` row into
   `usage_events` (source_key `auth_log:<id>`). One mapping function serves the trigger AND the backfill RPC, so the
   backfill reproduces auth_log exactly (SC-003) and the Wimpy service's sign-ins (outside this Worker) are covered too.
2. **The Worker records what only it sees** (`worker/src/usage.mjs` → `recordUsage`): app opens, help asks (category,
   note, the agent's team leader + campaign, delivered or not), help stage moves, campaign-manager requests + actions,
   AI questions. Fire-and-forget via `ctx.waitUntil`, catch-and-drop, ONE subrequest, never awaited on the request path.
3. **A re-runnable backfill** (`tools/usage-backfill.mjs`, `--dry` default) from auth_log (RPC), kv:cm-areq rows,
   ask_log and the HighLevel Help pipeline (read-only GETs). Live and backfilled rows share deterministic
   `source_key`s, so a re-run after release adds nothing (`ON CONFLICT (source_key) DO NOTHING`).

## Refinements of the brief (and why)
| Brief | Plan | Why |
|---|---|---|
| Worker writes login ok/fail/logout | DB trigger on auth_log | exact parity by construction (SC-003); covers wimpy-service sign-ins; 0 extra subrequests on login; keeps the SHARED-AUTH blocks (drift-guarded against wimpy-service) untouched |
| App from Referer/Origin path | page sends `?page=<location.pathname>` (`/api/me`, `/api/portal/me`, `/api/ask`) and `page` in the login body; Referer path only as a fallback | `_headers` sets `Referrer-Policy: strict-origin-when-cross-origin`, so the cross-origin Worker only ever sees the ORIGIN — every page would read as `/` (Ops). A query param / body field needs no CORS change (no new header) |
| De-dup per token within 60 s | per user × app within 60 s, in-isolate | the login's own app_open can seed it (the raw token is never hashed twice) |
| Sign-in → app_open | a successful login also records `app_open` (`detail.via='login'`) | management pages call no `/api/me` after a fresh sign-in, so the open would otherwise be lost |
| `ask_log:<id>` backfill key | the Worker inserts ask_log with `return=representation` and keys its live event `ask_log:<id>` | a later backfill run can never double-count a live AI question |

## Technical Context
ESM Worker on Cloudflare FREE (10 ms CPU, 50 subrequests); Supabase Postgres via PostgREST with the service key;
pages ES5 single-file. Tests: `nicks_code/diagnostics/verify-usage-028.mjs` — real Worker in-process with a stubbed
PostgREST + fake HighLevel; the migration runs VERBATIM in PGlite 0.5.8 (PostgreSQL 18 WASM, devDependency as in spec 017).

## Constitution Check
- I Engine decides — no page computes a usage figure; the views do. ✅
- II Absence is not a nought — a failed help ask is recorded `delivered=false`, never dropped; unknown app is NULL, not guessed. ✅
- III Agent List is the record — TL + campaign come from the published digest row (`authorise().rows[0]`), never invented; backfilled asks take them from the note the Worker wrote at the time, else NULL. ✅
- IV Like for like — n/a.
- V Locked down — RLS on, everything revoked from public/anon/authenticated, service_role only (select+insert: append-only); every function revoked from anon/authenticated with `search_path` pinned (migration-049 rule); restricted CM requests never store text; no new CORS header. ✅
- VI Saves acknowledged — usage writes are telemetry, deliberately fire-and-forget (FR-006); auth_log stays the audit of record. ✅ (justified deviation: no retry/banner)
- VII Every rule has a guard — `verify-usage-028` written first, registered in verify.yml. ✅

## Release order (Nick)
1. `node tools/apply-migration.mjs supabase/migration-061-usage-events.sql` (table, trigger, views). 2. Deploy Worker,
then Pages (`node tools/prepare-site.js`). 3. `node tools/usage-backfill.mjs` (dry) → `--apply`. 4. Re-run `--dry`: 0 to insert.
Help-pipeline backfill needs the Help location key locally (`help-highlevel.env`: HL_HELP_API_KEY, HL_HELP_LOCATION_ID —
git-ignored); without it that source is skipped and says so.

## Complexity Tracking
| Deviation | Why needed | Simpler alternative rejected |
|---|---|---|
| Trigger on auth_log | parity + Wimpy coverage | Worker-side mirror: double subrequest on login, misses wimpy-service, can drift from auth_log |
| `page` param from three pages | Referrer-Policy hides the path | Referer parsing: always `/` cross-origin |
