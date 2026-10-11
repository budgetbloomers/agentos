# Tasks — 028 usage report (test-first)

Guard for every task: `node nicks_code/diagnostics/verify-usage-028.mjs` (sections A–G). RED first, then GREEN.

- [x] **T001** Plan, data model, tasks (this file).
- [x] **T002** RED — `verify-usage-028.mjs` written in full + PGlite devDependency (`nicks_code/diagnostics/package.json`):
  A migration in PGlite · B usage.mjs units · C Worker in-process · D pages send `page` · E backfill · F registration.
- [x] **T003** GREEN A — `supabase/migration-061-usage-events.sql`: table, indexes, RLS/revokes/grants, `usage_auth_event`,
  `usage_mirror_auth_log`, auth_log trigger, 13 views; anon/authenticated denied (SC-004); auth_log parity (SC-003).
- [x] **T004** GREEN B — `worker/src/usage.mjs`: `appFromPage`, `pageOf`, `usageRow` (clamps, uuid check), `usageInsert`
  (never rejects), `recordUsage` (waitUntil, one subrequest), `firstOpen` (60 s per user × app); `db.mjs` insert
  `'ignore'` → `resolution=ignore-duplicates`.
- [x] **T005** GREEN C — wire the Worker: login → app_open (+ `user_id` from `login()`), `/api/me` + `/api/portal/me`,
  help ask (`helpRequest(..., track)`: category + note + TL + campaign, delivered=false on any failure), help stage /
  close / confirm, CM request + act (`assistCreate/assistAct(..., track)`), both AI routes (`ask_log:<id>` key).
  A failing / hanging usage insert never changes status or body; ≤ 1 usage subrequest per request.
- [x] **T006** GREEN D — `site/auth-gate.js`, `agent/index.html`, `site/ask-widget.js` send `page` (query / login body).
- [x] **T007** GREEN E — `tools/usage-backfill.mjs` (`--dry` default, `--apply`): auth_log via RPC, kv:cm-areq(+arch),
  ask_log, HighLevel Help pipeline (read-only); per-source × event counts; a second run inserts 0; keys equal the live ones.
- [x] **T008** GREEN F — register in `.github/workflows/verify.yml`; regression: verify-login-lockout, verify-help-repeat,
  verify-help-contact, verify-campaign-manager, verify-cm-view, verify-session-name, verify-worker-sweep-014,
  verify-digest-fence, verify-wimpy-removal, verify-wimpy-service-drift, verify-targets-027 (after prepare-site).
- [x] **T009** Backfill DRY-RUN against live (read-only, 2026-10-11 13:48Z, usage_events not yet created):
  auth_log 2,622 (login_ok 1,380 · logout 487 · login_fail:bad_password 180 · password_change 170 · password_reset 133 ·
  login_fail:no_user 104 · login_fail:disabled 54 · login_ok:wimpy 25 · locked 19 · wimpy_signin_ok 19 · 12 rarer kinds 51)
  → mapped: login_ok 1,424 · login_fail 383 · logout 487 · password_change 323 · account_admin 5. ask_log 450 ai_question.
  CM 1 mirror row → 1 cm_request + 3 cm_action. hl_help SKIPPED (the Help location key is only a Worker secret).
