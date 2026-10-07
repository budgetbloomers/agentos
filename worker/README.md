# AgentOS API Worker — Deploy Runbook (Phase 2–4)

## Prereqs (once)
1. Cloudflare account + `npx wrangler login`
2. Workers AI enabled on the account (dashboard → AI) — free allocation is fine

## Deploy
```bash
cd worker
npx wrangler secret put SUPABASE_SECRET_KEY   # paste the sb_secret_... key when prompted (interactive; never in files/chat)
npx wrangler deploy
```
Wrangler prints the Worker URL (…workers.dev). Verify: `GET <url>/api/me` → `{"error":"not signed in"}` = alive.

## First admin user (one-time bootstrap)
No default admin exists (by design). Create the first one directly in Supabase SQL Editor — generate the hash first:
```bash
node -e "import('./src/auth.mjs').then(async a=>console.log(await a.hashPassword('CHOOSE-A-STRONG-PASSWORD')))"
```
```sql
insert into app_users (username, full_name, password_hash, role, apps, tabs, pii_unmask, must_change_password)
values ('nicholas', 'Nicholas Pillay', '<paste pbkdf2$... hash>', 'admin', '{ops,vas}', '{"ops":["*"],"vas":["*"]}', true, false);
```
There is no admin UI and no user-creation route — **this SQL block is the only way to add a user.**
Re-run it (with a fresh hash) for each new person; `role`, `apps` and `tabs` control what they see.

## Endpoints
Every route the Worker actually serves. Anything not listed here does not exist.

| Route | Method | Access | Purpose |
|---|---|---|---|
| /api/login | POST | public | Sign in → `{user, token}` (12h session, lockout after 5 fails) |
| /api/logout | POST | session | Destroy the current session |
| /api/me | GET | public | Current user, or 401 `not signed in` — the gate every page calls |
| /api/password | POST | self | Change own password (min 10 chars) |
| /api/kv?key= | GET | session | Shared app state. `&meta=1` → `{updated_at}` freshness beacon only |
| /api/kv?key= | POST | session | Body IS the payload → Supabase Storage; rules row keeps the pointer |
| /api/kv?key= | DELETE | session | Real delete: Storage object **and** pointer row |
| /api/eod | GET | session | Tracker daily_eod rows. **503 = table missing** → client falls back to kv |
| /api/eod | POST | session | Upsert/delete one date (`{date,…}` or `{date,delete:true}`) |
| /api/bi | GET | session | BI money rows, `?from=&to=&limit=&offset=` — at most 5,000 rows a request; `truncated` + `next_offset` say where to carry on |
| /api/bi | POST | session | Load a month: idempotent by `file_hash`, replaces its own date span only |
| /api/bi | DELETE | session | Drop all BI rows + their batch records (raw archive kept) |
| /api/bi/raw?name= | POST | session | Archive the exact export bytes → `bi-reports/` (R-FMT-06) |
| /api/ask | POST | session | Workers AI, kill-switch checked, every Q&A logged to ask_log |

**Version gate:** clients must send `X-Cbx-Client: v5`. Without it, `/api/login` and `/api/me`
return 426, and every write above (`POST`/`DELETE` on kv, eod, bi, bi/raw) returns 409 — outdated
tabs stay read-only until refreshed. `GET`s, `/api/logout` and `/api/password` are not gated.

## Wiring the dashboards (after deploy)
- Set `askEndpoint` rule to `<worker-url>/api/ask` (or route the Worker under the Pages domain so `/api/*` is same-origin — preferred; then no change needed).
