# Contract: the Wimpy service HTTP API (018)

All routes on ONE origin with the page. JSON in, JSON out. Bearer token = the session token the sign-in returned, sent as
`Authorization: Bearer <token>` (the page keeps it in `sessionStorage` under `cbx_wimpy_token`).

| Method | Path | Auth | Answer | Moved from |
|---|---|---|---|---|
| GET | `/` , `/index.html` | none | the page (`public/index.html`), security headers, `Cache-Control: no-store` | Pages `/wimpy/` |
| GET | `/api/health` | none | `{ ok: true, service: 'wimpy', db_configured, hl_configured, cron_configured, version }` — booleans only, no network call | new |
| POST | `/api/wimpy/signin` | none | `{ token, user:{username, full_name, role, cb, scope:'wimpy'} }` or `{ error }` with 400/401/403/423/429 — the words of `signinWimpy`, unchanged | Worker |
| GET | `/api/wimpy/me` | session | `{ user }` (no `token_hash`) or 401 | Worker `/api/me` |
| POST | `/api/wimpy/logout` | session | `{ ok: true }` (session row deleted) | Worker `/api/logout` |
| POST | `/api/wimpy/password` | session | `{ current, new }` → `{ ok: true }`; 400 short/same/missing, 401 wrong current (counts toward the lock), 423 locked. Current = `wimpy123` until the person has set one (NULL hash); new ≠ `wimpy123`. Writes `app_users.wimpy_password_hash` (migration-060), ends the account's other Wimpy sessions. Spec Kit 025. | — (new) |
| GET | `/api/wimpy/menu` | session (scope wimpy) | `wimpyMenu()` payload, unchanged | Worker |
| POST | `/api/wimpy/order` | session (scope wimpy) | `submitWimpyOrder` → `{ ok, total_price, order_formatted, timestamp }` or `{ error, errors? }` 400/403/502 — unchanged | Worker |
| GET | `/api/wimpy/orders` | session (scope wimpy) | `listMyOrders` → `{ since, stages_available, orders[] }`, `Cache-Control: no-store` — unchanged; every query/body/header ignored | Worker |
| GET | `/api/wimpy/cron/retry` | `Authorization: Bearer <CRON_SECRET>` | `{ ok: true, configured, due, counts, processed }` (the `retryDueOrders` summary); 401 on a wrong/missing bearer; 503 when `CRON_SECRET` is unset | Worker cron (:07/:27/:47) |
| OPTIONS | any | none | 204, no CORS headers (same origin) | — |
| any | other `/api/*` | session gate first | 401 without a bearer session (like the Worker); 404 `{ error: 'Not found.' }` with one | — |
| any | other (not `/api/`) | — | 404 `{ error: 'Not found.' }` | — |

Also on every API route (security review 018): a POST MUST carry `Content-Type: application/json` (else 415); a body over
256 KB is refused (413) on both hosts; a session is accepted as a Bearer header ONLY — the suite's `cbx_session` cookie is
never honoured here.

Rules:
- A session whose scope is not `wimpy` is refused with 403 `{ error: 'This sign-in is for Wimpy orders only.' }` on every
  session route (the service mints only wimpy sessions; a suite token is useless here).
- Every response carries `SECURITY_HEADERS` (`src/headers.mjs`): `Cache-Control: no-store, must-revalidate`,
  `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
  `Permissions-Policy: geolocation=(), microphone=(), camera=()`, `Content-Security-Policy: default-src 'self'; script-src
  'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data:; font-src
  'self' data: https://fonts.gstatic.com; connect-src 'self'; frame-ancestors 'self'`.
- Missing `SUPABASE_URL`/`SUPABASE_SECRET_KEY`: the container refuses to start naming the variable; Vercel answers 503
  `{ error: 'The Wimpy service is not configured (SUPABASE_URL / SUPABASE_SECRET_KEY).' }` on every API route.

# Contract: what the suite answers after the removal

| Path on the Worker | Answer |
|---|---|
| `/api/wimpy/*` and `/api/portal/wimpy/*` (any method) | 410 `{ error: 'Wimpy ordering has moved to its own app — open <WIMPY_URL> and sign in with your CB number and password.' }` |
| any route with a `scope='wimpy'` session | 403 `{ error: 'This sign-in is for Wimpy orders only — open <WIMPY_URL>.' }` (including `/api/me` and `/api/logout`) |
| Pages `/wimpy/*` | `_redirects`: `302` to `<WIMPY_URL>` |
| Worker cron | `crons = ["*/10 * * * *", "3,23,43 * * * *"]` — tick and coaching only |

`WIMPY_URL` = `https://phoenix-wimpy.vercel.app` (one constant in `worker/src/index.mjs`; the same literal in
`site/_redirects` and the Apps card — the removal guard checks all three agree).
