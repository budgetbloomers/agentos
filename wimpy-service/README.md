# Wimpy Order — the Chatterbox lunch app as its own service

Spec Kit 018 (`agentos/specs/018-wimpy-standalone-service/`). The lunch app left the VAS analytics suite on
2026-10-09: the page, the sign-in, the menu, the order, the HighLevel ledger and "My orders" now live here, hosted on
Vercel or as a container — same code either way. It still uses the suite's accounts (CB number + the WIMPY password: `wimpy123` to start, changed inside the app — never the Agent Analytics password), the suite's
database (the order ledger, the audit log) and still reports to the suite's health banner.

## Run the tests (no credentials)

```
npm test
```

Playwright (for the page tests) is resolved from `node_modules` or `../nicks_code/diagnostics/node_modules`. Without it
the run FAILS unless `WIMPY_SKIP_BROWSER=1`.

## Configuration

See `.env.example`. `node scripts/env.mjs` assembles `.env` (git-ignored) from the suite's git-ignored
`../supabase.env` and `../wimpy-highlevel.env` and generates `CRON_SECRET`. The service refuses to start without the two
database settings. Without the HighLevel key/location ordering still works; cards wait as pending.

## Container

```
node scripts/env.mjs
docker compose up -d --build
curl -s localhost:8080/api/health
```

The HighLevel retry runs in-process every `RETRY_EVERY_MIN` minutes (default 20). Behind a reverse proxy set
`TRUST_PROXY=1`.

## Vercel (LIVE since 2026-10-09 at https://phoenix-wimpy.vercel.app, project `chatterbox-wimpy`, account `budgetbloomers`)

```
npm i -g vercel && vercel login && vercel link --yes --project chatterbox-wimpy
node scripts/env.mjs --vercel                        # vercel env add --sensitive for every setting, values piped on stdin
vercel --prod --yes
```

Three things learnt on the first deploy, all handled in the code and worth knowing before changing it:

- **Deploy from a copy OUTSIDE the git repository** (the quickstart does this). From inside `agentos/` the CLI attaches the
  repo's last commit author, and Vercel BLOCKS the deployment when that author is not a member of the Vercel account
  ("the commit author doesn't have permission to create deployments for this project").
- **Vercel runs this project as ONE Node server**, not as `api/` functions: its build says "Using src/app.mjs as the root
  entrypoint" and calls that file's default export with Node's `(req, res)`. `src/app.mjs` default-exports the Vercel entry
  (`api/index.mjs`, lazily) which accepts both shapes through `src/node-adapter.mjs`; the page is served by the core too.
  `vercel.json` therefore has no `rewrites`/`functions`.
- **The Hobby plan refuses a cron more often than daily** — the deploy fails outright. The retry runs at 05:07 SAST.

`vercel.json` serves `public/index.html`, rewrites `/api/*` to `api/index.mjs`, sets the security headers and runs the
retry cron ONCE A DAY at 05:07 SAST with `Authorization: Bearer $CRON_SECRET` — the Hobby plan refuses anything more
often (the deploy fails outright). "My orders" self-heals a person's own late cards whenever they look, so a failed
card waits at most until its owner next opens the page or the nightly run. On the Pro plan change the schedule back
to `7,27,47 * * * *` (the Worker's old cadence). The container runs its own 20-minute timer and ignores this.

**The kitchen board check (2026-11-24)** — `GET /api/wimpy/cron/board?slot=10:45|12:00` (same `CRON_SECRET` bearer) reads
the Wimpy Pipeline (GET only) and stores `kv:wimpy-board-status`: today's cards still in New Order (10:45) or New Order /
Order Processing (12:00), by SAST time and CB number. Hobby cron cannot fire at those times (daily, ±59 min), so the
**AgentOS Worker's ten-minute tick** calls it (worker/src/health.mjs) and raises ONE `wimpy-board` alert on the health
banner. The Worker needs the secret `WIMPY_CRON_SECRET` = this service's `CRON_SECRET`; without it the Worker never calls.

**Every order outcome is in `auth_log`** — `wimpy_order_ok` or `wimpy_order_refused:<reason>` (window_closed, cb_missing,
cb_mismatch, name, surname, phone_missing, phone_invalid, cart_empty, item_*, kitchen_status:<code>, kitchen_timeout,
kitchen_unreachable, no_session). A `kitchen_timeout` row with a kitchen card but no `wimpy_orders` row = the kitchen
answered late. The kitchen wait is 20 s (`KITCHEN_TIMEOUT_MS`) inside the function's 30 s.

## Routes

`GET /api/health` · `POST /api/wimpy/signin` · `GET /api/wimpy/me` · `POST /api/wimpy/logout` · `POST /api/wimpy/password` (the Wimpy password: `wimpy123` to start, then the person's own — spec 025) · `GET /api/wimpy/menu` ·
`POST /api/wimpy/order` · `GET /api/wimpy/orders` · `GET /api/wimpy/cron/retry` (bearer) · `GET /api/wimpy/cron/board?slot=` (bearer). Full contract:
`specs/018-wimpy-standalone-service/contracts/service-api.md`.

## Rules that did not move

- Menu and every price: `src/wimpy.mjs` only. The page holds no price.
- The sign-in rules (`src/auth.mjs` SHARED-AUTH blocks) are the Worker's, byte for byte — `verify-wimpy-service-drift`
  in the suite fails if they differ. Change both together.
- Secrets: environment only. Never in this folder, the image, a reply or a log (every HighLevel/database error is
  redacted before it is stored or printed).
