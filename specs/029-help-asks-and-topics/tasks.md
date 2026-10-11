# Tasks — 029 who asks for help, and what they ask most (test-first)

Guard for every task: `node nicks_code/diagnostics/verify-usage-029.mjs` (sections A–F). RED first, then GREEN.

- [x] **T001** Plan, data model, tasks (this file); topic seed read from the real Help + Campaign Assistance pipelines.
- [x] **T002** RED — `verify-usage-029.mjs` in full + the 028 harness learns PATCH:
  A migration-062 in PGlite (topic column, ask_topics seed, merges, every view on fixtures, lockdown) ·
  B topics.mjs units (pre-labels, prompt, validation, timeout, null on failure) ·
  C the REAL Worker (CM text stored, label in waitUntil, response unchanged, junk → other, AI throws → NULL, budget ≤ +2) ·
  D tools/usage-topics.mjs (dry writes nothing, apply labels, idempotent, REST shim) ·
  E tools/usage-backfill.mjs Campaign Assistance (text attached once, note-only rounds, idempotent, GETs only) ·
  F registered in verify.yml.
- [x] **T003** GREEN A — `supabase/migration-062-help-asks-and-topics.sql`.
- [x] **T004** GREEN B+C — `worker/src/topics.mjs`; `usage.mjs` (ask events insert returning id → labeller);
  `db.mjs` ('ignore' + returning); `assist.mjs` (detail.text / impact / cms); `index.mjs` wires the labeller with
  `/api/ask`'s models. 028 assertions that forbade CM text updated to FR-002.
- [x] **T005** GREEN D — `tools/usage-topics.mjs` (`--dry` default, `--apply`, `--limit`, REST shim, token from env or wrangler).
- [x] **T006** GREEN E — `tools/usage-backfill.mjs`: `cm` attaches the TL's words from the Campaign Assistance notes
  (new rows carry them; existing rows via `usage_attach_cm_text`), new source `hl_cm` for rounds with no mirror row.
- [x] **T007** GREEN F — verify.yml; regression: verify-usage-028, verify-campaign-manager, verify-cm-view,
  verify-help-repeat, verify-help-contact, verify-worker-sweep-014, verify-digest-fence, verify-wimpy-removal,
  verify-wimpy-service-drift, verify-targets-027 (after `node tools/prepare-site.js`).
- [x] **T008** Read-only dry run against live (2026-10-11 14:44Z, `--sources=hl_help,cm,hl_cm`, nothing written; usage_events
  exists live from 028, migration-062 not yet applied): **Agent Help Center** 11 cards → 29 rows (19 help_ask + 10 stage
  readings); **Campaign Assistance** 2 cards → `cm` 1 mirror, 0 new rows, words to attach to 1 existing row ("testing
  with throughballs" — a test); `hl_cm` 42 rows (7 cm_request incl. 1 merged + 35 cm_action, all from the automated
  verify-cm-assist-e2e card Hlynw1, which has no mirror row). Most real asks so far are tests → they will label `test`.
