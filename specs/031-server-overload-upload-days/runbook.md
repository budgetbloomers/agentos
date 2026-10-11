# Runbook — which request failed, and why (Spec Kit 031)

Nick, 2026-10-11: "I get a lot of notification didnt reach the server, is something wrong with supabase or agent os".
A "didn't reach the server" / "Cloud save failed (network)" warning is almost always a Worker request that Cloudflare
KILLED (exceededResources: CPU or memory) — it sends no reply, so the page sees "Failed to fetch". These are the places
that say which one.

## 1 · Workers Logs (Cloudflare dashboard, free: 200,000 events/day, kept 3 days)

Workers & Pages → `chatterbox-agentos-api` → **Logs** (Observability). Switched on by `worker/wrangler.toml`
`[observability] enabled = true, head_sampling_rate = 1` — live from the first `wrangler deploy` after 031.

**Killed requests** (Cloudflare writes these; our own line never gets written for a killed request):

- Filter `$workers.outcome` = `exceededResources` (also look at `exceededCpu`, `exceededMemory`, `canceled`).
- The row's `$workers.event.request.url` names the route and the key (e.g. `/api/kv?key=vas-state`), the
  `$workers.event.request.method` the verb; `$workers.cpuTimeMs` / `$workers.wallTimeMs` how far it got.

**Heavy requests that finished** — one line per request, an object with indexed fields:

| field | meaning |
|---|---|
| `ev` | always `cbx_heavy` — filter on it |
| `route`, `method`, `key` | e.g. `/api/kv` `POST` `vas-state`; `/api/upload-archive/complete`; `/api/bi` |
| `req_bytes` | the request's Content-Length (a VAS save is ~1.5 MB gzip; an old tab's plain save ~20 MB) |
| `status` | the answer's status |
| `ms` | wall time inside the Worker |
| `reason` | on a refusal (status ≥ 400), the error CODE — the answer's words up to the first colon, e.g. `wipe_blocked`, `version_conflict`, `empty_state` (never the detail, which can name a file or an agent) |

Useful queries (Query Builder, last 24 h):

- `ev = cbx_heavy` · group by `route`, `key` · count, max(`req_bytes`), p99(`ms`) — what is heavy today.
- `ev = cbx_heavy AND status >= 400` · group by `reason` — what is being refused.
- `$workers.outcome = exceededResources` · group by `$workers.event.request.url` — what is being killed.

From a terminal (read-only): `cd worker && npx wrangler tail --format json --search cbx_heavy` streams the lines live.

## 2 · The before/after count (FR-005, SC-001)

Cloudflare's own record, per day (read-only GraphQL with the wrangler OAuth token — `npx wrangler whoami` first):

```graphql
query($a:String!,$s:Time!,$e:Time!){viewer{accounts(filter:{accountTag:$a}){
  workersInvocationsAdaptive(limit:500,filter:{scriptName:"chatterbox-agentos-api",datetime_geq:$s,datetime_leq:$e},orderBy:[date_ASC]){
    sum{requests errors} quantiles{cpuTimeP50 cpuTimeP99} dimensions{date status}}}}}
```

Baseline (before 031): exceededResources 4 Oct 23 · 5 Oct 10 · 7 Oct 7 · 8 Oct 40 · **9 Oct 102**; success CPU p99 238 ms
(8 Oct). Target: ≤ 10 a day on the first two upload days after release.

## 3 · What the pages said (SC-002)

```sql
-- save failures the pages reported, by kind, per day
select date_trunc('day', at) d, key, left(status, 40) kind, count(*)
from save_failures where at > now() - interval '7 days' group by 1,2,3 order by 1 desc, 4 desc;
-- what arrived (unpacked sizes)
select key, count(*), max(bytes), avg(bytes)::int from kv_write_log where at > now() - interval '1 day' group by 1 order by 3 desc;
```

A failed `vas-summary` save is not lost data — the state saved — and is deliberately NOT a save failure (that table is
the floor's "your upload is not stored" alarm). It shows in Workers Logs instead: search `vasView: summary stale` / `no
summary yet` — until the next summary lands the Worker reads the whole state for its own few reads (correct, only slower;
on a busy morning that is a request at risk of being killed, so a run of these lines is worth a look).

## 4 · Housekeeping

- An archive upload that reached Storage but never called `complete` sits under `raw/pending-uploads/<owner>~…` —
  nothing reads that folder, and the 10-minute tick deletes anything there older than an hour (up to 50 a tick;
  `[cron] pending uploads swept: N`). `/api/upload-archive/start` answers 429 `too_many_pending` to a person who
  already has 5 unfinished there.
- Who may write `vas-state` / `vas-summary`: admin, or a full session holding the VAS app (`vas-summary.mjs`
  `vasWriteAllowed`). Writers on 2026-10-11 (30 days): ashton, sylvannas, sharoma, renolan (viewers), avesh, aarav
  (exec), dalwin (campaign manager with VAS). A refusal logs `reason = Not permitted`.
- A summary refused on write logs `stale_summary` (it described an older state) or `bad_summary` (wrong shape); one
  rejected on read logs `vasView: summary rejected (…)`.
- The old relay route `POST /api/upload-archive` is kept for one release for tabs on an older build; remove it in the
  release after 031 once `cbx_heavy` shows no `route = /api/upload-archive` for a week.
