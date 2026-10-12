# Tasks: Wimpy Order as its own service (018)

**Input**: Design documents from `/specs/018-wimpy-standalone-service/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/service-api.md, quickstart.md
**Tests**: REQUIRED (constitution VII) — the ported guards are written first and run RED against an empty service.

## Phase 1: Setup

- [x] T001 Create `wimpy-service/` with `package.json` (type module, engines node>=22, scripts start/test/dev, dependency `@vercel/functions`, devDependency `playwright`), `.gitignore`, `.dockerignore`, `.env.example`, `README.md`
- [x] T002 [P] `wimpy-service/src/headers.mjs` — `SECURITY_HEADERS` (one definition); `src/net.mjs` — `clientIp()` (shared by app.mjs and auth.mjs)

## Phase 2: Foundational — the moved modules and the Web-standard core

- [x] T003 [P] Move `worker/src/wimpy.mjs` → `wimpy-service/src/wimpy.mjs` (header comment updated; code unchanged — diff proved)
- [x] T004 [P] Move `worker/src/wimpy-hl.mjs` → `wimpy-service/src/wimpy-hl.mjs` (header comment updated; code unchanged — diff proved)
- [x] T005 [P] Copy `worker/src/db.mjs` → `wimpy-service/src/db.mjs`
- [x] T006 `wimpy-service/src/auth.mjs` — generated from the Worker's four SHARED-AUTH blocks (markers added to `worker/src/auth.mjs`) + `signinWimpy(DB, req, body, ctx, env)` using `clientIp()` + `logout`
- [x] T007 `wimpy-service/src/app.mjs` — `handle(req, env, ctx)`: every route of contracts/service-api.md, the wimpy-only session gate, `/api/health`, the bearer-protected cron route (constant-time compare), 503 when the database is unconfigured
- [x] T008 Move `wimpy/index.html` → `wimpy-service/public/index.html`: `API=''`, `/api/wimpy/me`, `/api/wimpy/logout`, `X-Cbx-Client` dropped

## Phase 3: User Story 1 — lunch works as before (tests first)

- [x] T009 [P] [US1] `wimpy-service/test/_harness.mjs` + `test/run.mjs`
- [x] T010 [P] [US1] `wimpy-service/test/menu.test.mjs` — verify-wimpy A–N ported (168 checks; section L moved to the removal guard)
- [x] T011 [P] [US1] `wimpy-service/test/signin.test.mjs` — verify-wimpy-signin A–H ported; I rewritten for the service (61 checks; the cross-door lock cases live in the drift guard)
- [x] T012 [P] [US1] `wimpy-service/test/history.test.mjs` — verify-wimpy-history ported (216 checks; cron = `GET /api/wimpy/cron/retry`; the health-alert section moved to the removal guard; a FULL session is refused — FR-003)
- [x] T013 [P] [US1] `wimpy-service/test/page-sweep.test.mjs` — sweep-014 A3/A4/A5 + ES5 check ported (19 checks)
- [x] T014 [US1] `npm test` → 5 files green (2026-10-09)

## Phase 4: User Story 3 — two hosts

- [x] T015 [P] [US3] `wimpy-service/src/server.mjs` — Node http adapter, static page, env validation, retry timer (`RETRY_EVERY_MIN`), graceful shutdown waiting on `ctx.waitUntil` work, `TRUST_PROXY`, 413 on an over-long body
- [x] T016 [P] [US3] `wimpy-service/api/index.mjs` — Vercel Web handler exports, `waitUntil` from `@vercel/functions`
- [x] T017 [P] [US3] `wimpy-service/vercel.json` — rewrites, headers (CSP = headers.mjs), crons `7,27,47 * * * *`, functions maxDuration 30
- [x] T018 [P] [US3] `wimpy-service/Dockerfile`, `docker-compose.yml` (Docker is not installed here — the image is NOT built; Nick builds it)
- [x] T019 [P] [US3] `wimpy-service/scripts/env.mjs` — assembles `.env` (the names + a generated `CRON_SECRET`) from `../supabase.env` + `../wimpy-highlevel.env`; `--vercel` runs `vercel env add` for each, values piped on stdin, never printed
- [x] T020 [US3] `wimpy-service/test/hosting.test.mjs` — 56 checks, incl. the real Node server on a free port over HTTP
- [x] T021 [US3] `node src/server.mjs` booted locally against the real env files (kitchen webhook pointed at a dead address): /api/health 200 (db + HighLevel configured), the page served with the CSP, menu without a session 401

## Phase 5: User Story 2 — the removal from VAS (guards first)

- [x] T022 [US2] `nicks_code/diagnostics/verify-wimpy-removal.mjs` — written RED, 80 checks green after the removal
- [x] T023 [US2] `worker/src/index.mjs` — imports, routes, cron constants/branch dropped; `WIMPY_URL`, the total wimpy-scope refusal (straight after the session read), the 410 catch-all added
- [x] T024 [P] [US2] `worker/src/auth.mjs` — `signinWimpy` and its constants removed (`WIMPY_NO_MATCH` kept inside the shared lock block)
- [x] T025 [P] [US2] `worker/src/portal.mjs` — the three entries removed
- [x] T026 [P] [US2] `worker/src/health.mjs` — alerts reworded (the service's variables; the service log)
- [x] T027 [P] [US2] `worker/wrangler.toml` — crons back to tick + `3,23,43`; secret-delete note
- [x] T028 [P] [US2] `git rm` of `worker/src/wimpy.mjs`, `worker/src/wimpy-hl.mjs`, `wimpy/index.html`, `site/wimpy/index.html`; `tools/prepare-site.js` lists
- [x] T029 [P] [US2] `site/_redirects` (new) and the Apps card URL in `nicks_code/index.html`
- [x] T030 [P] [US2] `supabase/migration-058-wimpy-service.sql` (NOT applied — release step 3)
- [x] T031 [US2] The three ported guards `git rm`'d; the Wimpy section cut from `verify-agent-sweep-014.mjs`; `.github/workflows/verify.yml` updated; verify-login-lockout, worker-sweep-014, tick-014, agent-sweep-014, agent-analytics, session-name, coaching-wave, referrals-schedule re-run green

## Phase 6: User Story 4 — drift guard

- [x] T032 [US4] `nicks_code/diagnostics/verify-wimpy-service-drift.mjs` — 24 checks: each shared block identical character for character, plus the cross-door lock behaviour on one mocked database

## Phase 7: Polish

- [x] T033 `CLAUDE.md` layout rows; `.specify/memory/constitution.md` Principle V + Platform Constraints amended — version 1.4.0 → 1.5.0
- [x] T034 Independent review (2026-10-09): code-reviewer + security-reviewer — no CRITICAL/HIGH. Fixed: rightmost + validated x-forwarded-for under TRUST_PROXY and no socket-header fallback there (M2/L1); JSON-only POSTs, 256 KB cap and bearer-only sessions in the shared core (L3/L6); CSP base-uri/form-action/object-src/frame-ancestors 'none', X-Frame-Options DENY, HSTS (L2); compose binds 127.0.0.1 with read_only/cap_drop/no-new-privileges/mem_limit and stop_grace_period 30 s, HEALTHCHECK honours PORT (M1/L8); drain loops after server.close, re-entrancy guard, body-abort rejection (code M1/L4); `vercel env add --sensitive` (M3); vercel.json installCommand omits dev deps (L7); contract wording for unknown /api paths (L5). Accepted/deferred: the service key's blast radius (T037), order-rate limiting and an item-line cap, the kitchen webhook's own auth (L5 security), the `detail` echo in the kitchen 502 (moved module, unchanged) — all recorded for Nick
- [x] T035 Full credential-free suite run (2026-10-09): all 43 suites in verify.yml green + drift 24 + removal 80 + `npm test` 5/5 files (216 · 59 · 168 · 19 · 61)
- [x] T036 RELEASED 2026-10-09 ~08:30 SAST: Vercel project `chatterbox-wimpy` (account budgetbloomers) live at https://chatterbox-wimpy.vercel.app — health 200 (db + HighLevel configured), page served, menu gated, wrong sign-in refused in the right words, cron closed; Worker d70f4b3f (410 on /api/wimpy/*, wimpy sessions refused); migration-058 APPLIED; Pages 4c91c8df (/wimpy/ → 302 to the service); Worker secrets WIMPY_HL_API_KEY / WIMPY_HL_LOCATION_ID DELETED; verify-cors-headers --live 13/13, verify-live-save --live 5/5. Three deploy lessons folded into the code (see README): deploy from outside the repo, Vercel's root-entrypoint Node (req, res) shape (src/node-adapter.mjs), daily cron on Hobby. NOT YET: a real sign-in + test order by a person; the commit.
- [ ] T037 Follow-up (not this feature): a restricted database role for the service instead of the service key

## Dependencies

Phase 2 → Phase 3 (tests need the modules in place to go GREEN; they are written RED first against the empty folder).
Phase 5 after Phase 3 (the suite must not lose Wimpy before the service proves it). Phase 6 any time after T006.
