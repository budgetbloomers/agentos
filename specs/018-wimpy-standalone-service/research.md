# Research: Wimpy Order as its own service (018)

Date: 2026-10-09. Everything below was read from the repository on this date; nothing is from memory alone.

## R1 · What "Wimpy" is today (the inventory to move)

| Piece | Where | Lines | Notes |
|---|---|---|---|
| Menu, prices, window, pricing, identity check, kitchen payload, ledger insert | `worker/src/wimpy.mjs` | 532 | Imports `db.mjs`, `wimpy-hl.mjs`. Reads `env.WIMPY_WEBHOOK_URL`, `env.SUPABASE_URL` |
| HighLevel client, contact/card/note, retry, My orders | `worker/src/wimpy-hl.mjs` | 459 | Reads `env.WIMPY_HL_API_KEY`, `env.WIMPY_HL_LOCATION_ID`; caches on `globalThis` |
| Sign-in (`signinWimpy`) and the SHARED `checkPassword`, `loginKey`, `findAccount`, `verifyPassword`, `session`, `logout` | `worker/src/auth.mjs` | 237–280 + shared helpers | `cf-connecting-ip` for the network limit |
| Routes, scope fence, cron routing | `worker/src/index.mjs` | 141–165, 626–633, 732–733, 991–1013, 441–448 | `SHARED_CRON "3,7,23,27,43,47"`, minutes 7/27/47 = Wimpy |
| Agent allow-list entries | `worker/src/portal.mjs` | 47–50 | `/api/wimpy/menu`, `/order`, `/orders` |
| Health alerts | `worker/src/health.mjs` | 405–428, 443–450 | READS `kv:wimpy-hl-status`, `kv:wimpy-ledger-failed` — stays |
| The page | `wimpy/index.html` | 575 | ES5; `API` = Worker URL; token under `cbx_wimpy_token`; calls `/api/me`, `/api/logout` |
| Pages build | `tools/prepare-site.js` | 250–252, 281 | copies to `site/wimpy/`; shells list |
| Apps card | `nicks_code/index.html` | 8107 | URL `https://chatterbox-agentos.pages.dev/wimpy/` |
| Cron triggers | `worker/wrangler.toml` | `crons = ["*/10 * * * *", "3,7,23,27,43,47 * * * *"]` | |
| Migrations | `supabase/migration-037`, `-053`, `-055` | | scope column, session purge, ledger tables — all stay |
| Guards | `nicks_code/diagnostics/verify-wimpy.mjs` (476), `verify-wimpy-signin.mjs` (281), `verify-wimpy-history.mjs` (1222), `verify-agent-sweep-014.mjs` 538–695 | | Playwright from `nicks_code/diagnostics/node_modules` |
| CI | `.github/workflows/verify.yml` line 51 | | three Wimpy guards listed |
| Secrets | `agentos/wimpy-highlevel.env` (git-ignored), `agentos/supabase.env` (git-ignored) | | names only: `WIMPY_HL_API_KEY`, `WIMPY_HL_LOCATION_ID`; `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_DB_URL` |

## R2 · Docker vs Vercel

**Decision**: one source tree, Web-standard `Request`/`Response` core (`src/app.mjs` → `handle(req, env, ctx)`), two thin
adapters: `src/server.mjs` (Node `http` → Request/Response, serves `public/`, in-process retry timer, graceful shutdown)
and `api/index.mjs` (Vercel Node runtime Web handler: `export function GET/POST/DELETE/OPTIONS(request)`).

**Rationale**: the Worker code already speaks Web `Request`/`Response`, so the modules move unchanged; Vercel's Node
runtime accepts Web-signature handlers (named `GET`/`POST` exports); a Node http adapter is ~40 lines and needs no
framework. Vercel cannot run a container (it runs functions + static files), so "Docker on Vercel" is not a real option.

**Alternatives considered**: Hono (one dependency, three adapters) — rejected: the repo's rule is no runtime deps and the
adapter is tiny. Fly.io/Railway for the container — out of scope; the Dockerfile works on any of them.

## R3 · Background work after the reply (`ctx.waitUntil`)

- Cloudflare: `ctx.waitUntil`. Node server: a set of in-flight promises; `SIGTERM` waits for them (≤ 20 s).
- Vercel: `waitUntil` from `@vercel/functions` (the ONLY dependency; imported only by `api/index.mjs`, so the Docker image
  has no `node_modules` at all).

## R4 · The scheduled retry

- Container: `setInterval` every `RETRY_EVERY_MIN` (default 20; `0` disables) calling `retryDueOrders` directly.
- Vercel: `vercel.json` `crons: [{ path: "/api/wimpy/cron/retry", schedule: "7,27,47 * * * *" }]`. Vercel sends
  `Authorization: Bearer $CRON_SECRET` when the `CRON_SECRET` env var exists; the route refuses any other bearer and
  refuses everything when the variable is unset (never an open trigger). **Hobby plan caveat**: Vercel limits Hobby crons
  to once per day; the My-orders self-heal (≤ 2 own rows per look) covers the gap, as spec 015 designed.

## R5 · Client address for the per-network limit

The Worker read `cf-connecting-ip`. Vercel sets `x-forwarded-for` (and `x-real-ip`) from its edge and strips client
copies, so it is trustworthy there. A bare container could be sent a forged `x-forwarded-for`. **Decision**:
`clientIp(req)` = first `x-forwarded-for` entry when `TRUST_PROXY` is set (the Vercel adapter sets it always), else the
socket address the Node adapter injects as `x-wimpy-socket-ip` (a header the adapter overwrites on every request, so a
client cannot supply it).

## R6 · Sessions

The service mints `app_sessions` rows with `scope='wimpy'` exactly as `signinWimpy` did and accepts ONLY `scope='wimpy'`
sessions (a leaked full-scope token is useless to it). The Worker, in turn, refuses `scope='wimpy'` on every route. At
release, `migration-058` deletes every existing wimpy session (same shape as migration-053) so no session minted by the
old Worker outlives it.

## R7 · Same-origin page

The page's `API` constant becomes `''` (relative); `/api/me` → `/api/wimpy/me`, `/api/logout` → `/api/wimpy/logout`.
CORS disappears; the CSP is `connect-src 'self'`. The `X-Cbx-Client` header is dropped (the version gate was the suite's).

## R8 · Copied auth code and drift

`checkPassword`, `loginKey`, `findAccount`, `verifyPassword`, `pbkdf2`, `hashPassword`, `session` (and the `toHex`/
`fromHex`/`sha256hex`/`log` helpers) are copied VERBATIM into `wimpy-service/src/auth.mjs` between
`/* === SHARED WITH worker/src/auth.mjs (drift guard) === */` markers. `nicks_code/diagnostics/verify-wimpy-service-drift.mjs`
extracts each named function's source from both files and asserts equality after whitespace normalisation. The only
intentional difference is `clientIp()` replacing the `cf-connecting-ip` read inside `signinWimpy` (not a shared function).

## R9 · Health alerts stay in the Worker

`health.mjs` only READS the two `rules` keys; the service keeps writing them with the same shape. The alert text "set on
the Worker (npx wrangler secret put)" is reworded to name the service's variables.

## R10 · Security headers on both hosts

One definition in `src/headers.mjs` (`SECURITY_HEADERS`), applied by the Node adapter to every response, and repeated in
`vercel.json` `headers` for the static page (Vercel serves `public/` itself). A test asserts the `vercel.json` CSP equals
the module's.

## R11 · Tests

Ported one for one into `wimpy-service/test/`: `menu.test.mjs` (verify-wimpy A–N incl. the Chromium flow M),
`signin.test.mjs` (verify-wimpy-signin A–H; I rewritten for the service), `history.test.mjs` (verify-wimpy-history
T001–T011 and R1–R10, cron via the service's retry entry, the 50-subrequest *cap* dropped — no such platform limit — but the
measured budgets kept as regression bounds), `page-sweep.test.mjs` (sweep-014 A3/A4/A5 + the ES5 check). Runner
`test/run.mjs` executes them as child processes; Playwright is resolved from `wimpy-service/node_modules` or
`../nicks_code/diagnostics/node_modules`; absence FAILS unless `WIMPY_SKIP_BROWSER=1`.

## R12 · Version of Node on Vercel

Vercel supports Node 22 (and 24 where enabled); the code uses nothing past Node 22. `engines.node >= 22`; image
`node:24-alpine`. Local machine: Node 24.18.0.
