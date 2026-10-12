# Implementation Plan: Wimpy Order as its own service — out of VAS analytics, onto Vercel (and Docker)

**Branch**: `018-wimpy-standalone-service` | **Date**: 2026-10-09 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/018-wimpy-standalone-service/spec.md`

## Summary

Move the Wimpy lunch app (page + API + HighLevel ledger/retry) out of the Cloudflare Worker and Pages site into a
self-contained `agentos/wimpy-service/` that runs the SAME module code behind a Web-standard `handle(req, env, ctx)` core
with two adapters: a dependency-free Node server (Docker image + compose, in-process retry timer) and a Vercel Node
function (static page, `vercel.json` cron). The suite stops serving the page, answers 410 on every Wimpy route, refuses
wimpy-scoped sessions everywhere, drops the Wimpy cron, allow-list entries and sign-in, points the Apps card at the new
address and forwards `/wimpy/`. The three Wimpy guards and the sweep-014 page checks are ported into the service; the
suite gains a drift guard (copied sign-in code identical to the Worker's) and a removal guard.

## Technical Context

**Language/Version**: JavaScript ESM, Node ≥ 22 (local 24.18.0; image `node:24-alpine`); page ES5 single-file HTML

**Primary Dependencies**: none at runtime in the container; `@vercel/functions` (waitUntil) for the Vercel adapter only;
Playwright (dev, resolved from `../nicks_code/diagnostics/node_modules`) for the page tests

**Storage**: Supabase PostgREST with the service key — the existing `app_users`, `app_sessions`, `auth_log`,
`wimpy_orders`, `wimpy_hl_contacts`, `rules` (no schema change; migration-058 purges old wimpy sessions at release)

**Testing**: `wimpy-service/test/*.test.mjs` run by `test/run.mjs` (the repo's ok/head guard style, child processes);
`nicks_code/diagnostics/verify-wimpy-service-drift.mjs`, `verify-wimpy-removal.mjs` in the suite

**Target Platform**: (a) Linux container, port 8080; (b) Vercel Node runtime function + static `public/`

**Project Type**: web service (API + one static page)

**Performance Goals**: unchanged from the Worker: the order reply never waits on the ledger or HighLevel; HighLevel calls
abort at 8 s (writes) / 5 s (history read)

**Constraints**: zero secrets in code/image/repo/logs/replies; same lock rules as `/api/login` (drift guard); same-origin
page; no behaviour difference between hosts except the adapter and the scheduler

**Scale/Scope**: ~130 people, a few hundred orders a week

## Constitution Check

| Principle | How this plan honours it |
|---|---|
| I. Engine decides, page paints | Unchanged: the page paints `wimpyMenu()`/`listMyOrders()` payloads; the only page edits are the base URL and two route names |
| II. One money model | Not touched (prices and totals move with `wimpy.mjs`, byte for byte) |
| III. The Agent List is the record | Unchanged: accounts and the `wimpy` app grant still come from `sync_agent_list` (migration-037 trigger); the service only reads them |
| V. Locked down by default | The service accepts only wimpy-scoped sessions; the Worker refuses them everywhere; secrets as env only; redaction unchanged; CSP `connect-src 'self'`; cron route bearer-protected and closed when unconfigured. **Deviation noted**: "the Worker is the ONLY component that talks to Supabase" — the service now also holds the service key (see Complexity Tracking) |
| VI. Saves acknowledged, noticed, recoverable | Unchanged ledger/retry/stuck/health machinery; the Node adapter waits for in-flight background work on shutdown |
| VII. Every rule has a guard | Four ported suites + two new suite guards, written first (RED on the empty service / unchanged Worker) |
| Platform constraints | The Worker loses a cron and ~1,000 lines; the service has no 50-subrequest or 10 ms limit, so the budgets become regression bounds only; `site/` stays generated |
| Delivery workflow | specify → plan → tasks → tests first → implement → code + security review → full suite run → Nick deploys in the quickstart's order |

## Project Structure

### Documentation (this feature)

```text
specs/018-wimpy-standalone-service/
├── plan.md              # This file
├── research.md          # R1–R12 decisions
├── data-model.md        # tables (unchanged), migration-058, configuration
├── quickstart.md        # run / test / container / Vercel / release order
├── contracts/service-api.md
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root = agentos/)

```text
wimpy-service/                       NEW — self-contained; imports nothing outside this folder
├── package.json                     type module, engines node>=22, scripts {start, test, dev}, dependency @vercel/functions, devDependency playwright
├── Dockerfile                       node:24-alpine, non-root, HEALTHCHECK /api/health, CMD node src/server.mjs — no npm install
├── docker-compose.yml               env_file ../supabase.env + ../wimpy-highlevel.env, port 8080
├── .dockerignore / .gitignore       node_modules, .env*, test, api (Vercel-only)
├── .env.example                     every variable NAME with a placeholder value
├── vercel.json                      rewrites /api/* → /api/index, headers (same CSP), crons 7,27,47, functions maxDuration
├── README.md                        what it is, how to run, release order (mirrors quickstart)
├── api/index.mjs                    Vercel adapter: export GET/POST/DELETE/OPTIONS(request) → handle(); waitUntil from @vercel/functions; TRUST_PROXY=1
├── public/index.html                the page (moved from wimpy/index.html): API='' , /api/wimpy/me, /api/wimpy/logout
├── scripts/vercel-env.mjs           prints `vercel env add` commands from the two env files (+ a generated CRON_SECRET)
├── src/app.mjs                      handle(req, env, ctx): routes of contracts/service-api.md; json(); clientIp(); the session gate
├── src/auth.mjs                     SHARED block (copied verbatim: helpers, checkPassword, loginKey, findAccount, session, hashPassword, verifyPassword) + signinWimpy (clientIp) + logout
├── src/db.mjs                       copied verbatim
├── src/wimpy.mjs                    moved (header comment updated; code unchanged)
├── src/wimpy-hl.mjs                 moved (header comment updated; code unchanged)
├── src/headers.mjs                  SECURITY_HEADERS (one definition; vercel.json repeats the CSP — a test compares)
├── src/server.mjs                   Node http adapter, static page, retry timer, graceful shutdown, env validation at start
└── test/
    ├── run.mjs                      runs every *.test.mjs as a child process, aggregates, exits non-zero on any failure
    ├── _harness.mjs                 shared: ok/head/summary, Playwright resolver, stubbed-world helpers used by history + page tests
    ├── menu.test.mjs                verify-wimpy A–N (page flow M in Chromium against the service's own handle())
    ├── signin.test.mjs              verify-wimpy-signin A–H + I (service shape)
    ├── history.test.mjs             verify-wimpy-history T001–T011, R1–R10, SC-005 (cron via handle('/api/wimpy/cron/retry') + retryDueOrders)
    ├── page-sweep.test.mjs          sweep-014 A3/A4/A5 + ES5 check
    └── hosting.test.mjs             NEW: /api/health, cron bearer rules, scope gate, security headers = vercel.json, clientIp/TRUST_PROXY, env validation, Dockerfile/compose/vercel.json sanity

worker/src/index.mjs                 REMOVE Wimpy imports/routes/cron branch; ADD WIMPY_URL const, 410 on /api/wimpy/* and /api/portal/wimpy/*, 403 for scope wimpy before /api/me
worker/src/auth.mjs                  REMOVE signinWimpy + WIMPY_* constants (checkPassword keeps `via`)
worker/src/portal.mjs                REMOVE the three /api/wimpy entries from PORTAL_ALLOWED
worker/src/health.mjs                reword the not-configured alert (service variables, not wrangler)
worker/wrangler.toml                 crons = ["*/10 * * * *", "3,23,43 * * * *"]; drop the WIMPY secret comments
worker/src/wimpy.mjs, wimpy-hl.mjs   DELETED (moved)
wimpy/index.html                     DELETED (moved); site/wimpy/ removed from the build
tools/prepare-site.js                drop wimpy from the companion list and the shells list
site/_redirects                      NEW: /wimpy/* → WIMPY_URL 302
nicks_code/index.html                Apps card url → WIMPY_URL
supabase/migration-058-wimpy-service.sql   NEW (purge wimpy sessions; scope comment)
nicks_code/diagnostics/verify-wimpy-service-drift.mjs   NEW
nicks_code/diagnostics/verify-wimpy-removal.mjs         NEW
nicks_code/diagnostics/verify-wimpy*.mjs (3)            DELETED (ported); verify-agent-sweep-014.mjs loses its Wimpy section (ported)
.github/workflows/verify.yml         swap the three guards for the two new ones + `npm test` in wimpy-service
CLAUDE.md                            layout rows for wimpy-service/ and worker/; the wimpy/ row rewritten as history
```

**Structure Decision**: a single new top-level folder `wimpy-service/` inside the repository (one commit carries extraction
and removal; Vercel "Root Directory" = `wimpy-service`), self-contained so it can be split out later. No shared package:
the four files are copies, with a drift guard on the one piece (sign-in rules) where a silent divergence would weaken
security.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| A second component holds the Supabase service key (Principle V says the Worker is the only one) | The lunch app must leave the Worker (Nick's request) and keeps the suite's accounts, ledger and audit log | A dedicated restricted Postgres role would need a signed JWT per request and a new grant set — more machinery than the feature warrants today; recorded as a follow-up in tasks.md |
| Copied sign-in code (two copies of `checkPassword` etc.) | The service imports nothing from `worker/` so it can be hosted and moved on its own | A shared npm package would introduce a build/publish step to a repo that has none; the drift guard makes divergence a failing test instead |
