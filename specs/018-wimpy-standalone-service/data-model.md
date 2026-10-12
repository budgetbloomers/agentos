# Data model: Wimpy Order as its own service (018)

No table changes. The service reads and writes the SAME tables the Worker did, through PostgREST with the service key.

| Table / key | Used for | Access by the service | Unchanged? |
|---|---|---|---|
| `app_users` | find the account by username or CB; password hash; `apps` grant; lock columns | select (username/cb), update (`failed_attempts`, `locked_until`) | yes |
| `app_sessions` | the wimpy-scoped session (`scope='wimpy'`, 12 h, hashed token) | insert on sign-in; select on every request (`token_hash` + embedded `app_users`); delete on sign-out | yes (migration-037 scope; migration-053 purge) |
| `auth_log` | audit events (`login_fail:wimpy:*`, `locked:wimpy`, `login_ok:wimpy`, `wimpy_signin_refused:no_app`, `logout`) and the per-network count | insert; select by `ip`/`user_id` | yes |
| `wimpy_orders` | the ledger (one row per accepted order; HL state machine) | insert, select, patch | yes (migration-055) |
| `wimpy_hl_contacts` | one HighLevel contact per person | insert, select | yes (migration-055) |
| `rules` key `kv:wimpy-hl-status` | the retry's report (counts only) | upsert | yes — still READ by `worker/src/health.mjs` |
| `rules` key `kv:wimpy-ledger-failed` | a lost ledger row | upsert | yes — still READ by `worker/src/health.mjs` |

## Migration-058 (release step, applied AFTER the removal Worker is deployed)

```sql
delete from app_sessions where scope = 'wimpy';
comment on column app_sessions.scope is '… wimpy = minted by the standalone Wimpy service (wimpy-service/), refused by the Worker on every route …';
```

Same shape as migration-053: ends every session the old Worker minted; safe to re-run.

## Configuration (environment)

| Name | Required | Host | Meaning |
|---|---|---|---|
| `SUPABASE_URL` | yes | both | PostgREST base |
| `SUPABASE_SECRET_KEY` | yes | both | service key (RLS bypass) — the same trust level the Worker has |
| `WIMPY_HL_API_KEY` | no | both | HighLevel private-integration key (Wimpy sub-account). Missing = "not configured" |
| `WIMPY_HL_LOCATION_ID` | no | both | HighLevel location. Missing = "not configured" |
| `WIMPY_WEBHOOK_URL` | no | both | the n8n kitchen webhook; defaults to the production URL in `wimpy.mjs` |
| `CRON_SECRET` | Vercel | Vercel | bearer the cron route demands; unset = the route refuses |
| `PORT` | no | container | default 8080 |
| `RETRY_EVERY_MIN` | no | container | in-process retry period; default 20; `0` disables |
| `TRUST_PROXY` | no | container | `1` = read `x-forwarded-for` (behind a proxy); Vercel adapter always trusts |

## Session object (as the modules see it)

```
{ username, full_name, role, apps, tabs, pii_unmask, active, cb, team, hub_ids, must_change_password, theme,
  user_id, token_hash, scope: 'wimpy' }
```

Identical to the Worker's `session()` result; `wimpy.mjs`/`wimpy-hl.mjs` read `user_id`, `cb`, `username`, `full_name`.
