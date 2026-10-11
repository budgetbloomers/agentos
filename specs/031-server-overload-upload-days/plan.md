# Implementation Plan: the server stops being overwhelmed on upload days

**Branch**: `feat/031-overload` | **Date**: 2026-10-11 | **Spec**: [spec.md](spec.md)
**Nick, 2026-10-11**: "I get a lot of notification didnt reach the server, is something wrong with supabase or agent os"

## Evidence (read-only, 2026-10-11)

| Source | What it shows |
|---|---|
| Cloudflare GraphQL `workersInvocationsAdaptive` (chatterbox-agentos-api) | exceededResources per day: 30 Sep 5 · 4 Oct 23 · 5 Oct 10 · 7 Oct 7 · 8 Oct 40 · **9 Oct 102** · 10–11 Oct 0. Success CPU p99 26–98 ms until 7 Oct, **238 ms (8 Oct), 233 ms (9 Oct)**. clientDisconnected 44 on 9 Oct. |
| `kv_write_log`, last 14 days | `vas-state`: 176 saves, avg **19.5 MB unpacked** (max 20.7 MB), 20–25 saves a day 6–9 Oct — every one unpacked whole by the Worker. Ops fact stores 9 Oct: 29 saves, 2,019 MB unpacked (ViciDial 180 MB kept compressed since 013; BI 25.5 MB, SF closed 24 MB, QA 9.7 MB still unpacked whole). |
| `kv:upload-manifest`, last 14 days | 75 archived raw files, 169 MB, 7–9 a day (16–21 MB/day), max 14.9 MB, 18 over 5 MB — every byte relayed through the Worker. |
| `save_failures` since 27 Sep | 85: 49 ViciDial "could not decompress" (ended 7 Oct, spec 013), 18 "replay 425" (spec 014), **12 "network"** (vas-state 7, nba-digest 2, fact stores 2, ai-digest-ops 1) — 6 on 8 Oct, 3 on 9 Oct: the kind Nick sees. |
| The live `raw/kv/vas-state` (this laptop) | 20.70 MB plain → 1.49 MB gzip. `JSON.parse` 434 ms, gunzip 87 ms on a laptop: the Worker's 10 ms CPU cannot hold either. `/api/ask` parses the whole state on EVERY question; `/api/campaign-stats` likewise. |

## Contracts

- **C1 Request log (FR-001)** — `worker/wrangler.toml` `[observability] enabled = true`, `head_sampling_rate = 1`
  (Free plan: 200,000 events/day, 3-day retention, no charge — the floor's ~6,000 requests/day plus one line each is
  ~12,000, 6 % of the allowance). `fetch()` emits ONE `console.log({ev:'cbx_heavy', route, method, key, req_bytes,
  status, ms, reason})` for the heavy routes: `/api/kv` POST (any key) and GET of `vas-state` / `cb-facts-*`,
  `/api/upload-archive*`, `/api/upload-file`, `/api/rake/page`, `/api/bi*`. `req_bytes` is the Content-Length header
  (no body is read); `reason` is the first 160 characters of an error answer (status ≥ 400; error bodies are small JSON).
  A request Cloudflare kills writes no line of ours — its invocation log carries `outcome = exceededResources` and the
  URL (route + key); the runbook queries both.
- **C2 VAS state kept as it arrives (FR-002)** — `POST /api/kv?key=vas-state` with a gzip body (1f 8b): never unpacked.
  The bytes are stored as they came (`application/octet-stream`); the pointer row is `{store, gz:true, size:<ISIZE>}`; the
  write log records ISIZE. A plain body (an old tab, the unload path) is stored as its bytes without decoding.
  `GET` is unchanged: it already decides by the stored bytes and serves gzip with `Content-Encoding: gzip`
  (`encodeBody:'manual'`), which every browser unpacks (013 has run this for Ops since 7 Oct).
  The 413 for a server-read key past `KV_INFLATE_MAX` no longer applies to vas-state (nothing unpacks it); it stays for
  agent-digest* / agent-reports-*.
- **C3 The safety rules that inspected the body, kept cheap**

  | Rule today | What it read | 031 |
  |---|---|---|
  | Wipe guard (17 Aug): refuse a vas-state body < 120,000 B when the stored copy is > 10× it, unless `?force=1` | `body.length` (after unpacking) + a HEAD of the stored object | Unpacked size = the gzip trailer's ISIZE (last 4 bytes — no unpacking). Stored size = the pointer's `size` when it has one (a compressed store's object length is the COMPRESSED size), else the HEAD as today. Same thresholds, same 409 `wipe_blocked`. |
  | "Is it gzip, is it JSON" (013) | the first chunk, unpacked | Kept, but bounded: only the first 16 KB of the compressed bytes are fed to the unpacker (`gzipStart`), for vas-state and cb-facts. Corrupt start → 400; not `{`/`[` → 400. |
  | — (new) gzip trailer sanity | — | ISIZE must be plausible for the compressed length (≥ length − 1 KB, ≤ 1,100 × length) — a truncated or garbled upload is refused 400 instead of stored. |
  | Whole-body inflate caught a corrupt gzip (CRC) | the whole body, unpacked | Nothing unpacks it now (review finding, MEDIUM), so PULSE declares `&gz=<compressed bytes>&size=<unpacked bytes>`; a body shorter than declared, or a trailer ISIZE ≠ the declared size, is 400 — trusted only to refuse. A truncated or garbled save from a current page can no longer be stored. Old tabs send neither and keep the plausibility window. |
  | Empty state (client only: `__cloudPush` refuses `S.files` empty unless the Danger-zone clear) | — | PULSE now ALSO declares `&files=<n>` on the save URL (a query parameter, never a header — headers need the CORS preflight, the 28 Aug lesson). The Worker trusts it only to REFUSE: `files=0` without `force=1` → 409 `empty_state`. Old tabs send nothing and keep the ISIZE wipe guard. |
  | Compare-and-set (X-Cbx-Base), write-in-progress 425, version stamps | pointer row only | Unchanged. |
  | Digest fence / emptiness (agent-digest*, agent-reports-*) | the parsed body (small) | Unchanged — those keys are still unpacked (≤ 0.5 MB). |

  Justification: every refusal stays server-side and is derived from bytes the Worker already holds (the trailer) or a
  value the client can only use against itself (`files=0`). Nothing the client declares can make the Worker ACCEPT
  something it would refuse today.
- **C4 The Worker's own reads of the state (FR-003)** — PULSE writes a SMALL side-copy after every acknowledged save:
  `POST /api/kv?key=vas-summary` = `{v:1, state_version, roster, files:[{type,name,asOf}], map, calls, months, roster_n,
  file_types}` (≈ 410 KB plain, ≈ 65 KB gzip, measured on the live state). `months` is the per-month sales/GWP the
  `/api/ask` block computed (same loop, moved to the engine — Principle I). The Worker's readers go through ONE helper,
  `vasView(env, DB)`: the summary when its `state_version` equals the vas-state row's `updated_at`; otherwise (an old tab
  saved last, or no summary yet) the full state as today — unpacked by streaming when it is stored compressed — flagged
  `source:'state'`. Readers: `rosterSync` derivation (only before any published list), `/api/campaign-stats`, `/api/ask`.
  Chosen over stream-unpacking: parsing 20 MB is ~430 ms of CPU however it is unpacked; the side-copy is ~5 ms.
  The key is `vas-summary`, not `vas-state-…`, so no `indexOf('/api/kv?key=vas-state')` matcher (stubs, probes) mistakes it
  for the state.
- **C5 Tools** — every tool that reads `raw/kv/vas-state` straight from Storage reads through `tools/kv-store.mjs`
  (`responseText` / `storeText`): digest-republish (the tick), publish-agent-list, sync-ops-roster-from-pulse,
  verify-list-vs-uploads, digest-backfill-tl, provision-agent-logins. The daily snapshot already copies gzip as is (013).
- **C6 Archive straight to storage (FR-004)** — `POST /api/upload-archive/start {name, hash, size}` (size ≤ 30 MB, hash
  hex 8–64) → a signed upload URL for `raw/pending-uploads/<hash16>-<rand>-<name>` (bucket `raw`, a folder
  `reconcileManifest` never lists). The browser PUTs the bytes to Supabase Storage (CSP `connect-src` already names the
  project). `POST /api/upload-archive/complete {name, hash, path, size}` → object info (must exist, size must equal the
  declared size) → move to `raw/uploads/<hash16>-<name>` (an existing destination = already archived: the pending copy
  is deleted) → `manifestAdd()` (migration-024, atomic) → `{ok, archived}` or `{ok, dupe}`. A signed PUT that never
  finishes leaves no object; one that finishes without `complete` sits under `pending-uploads/`, which nothing reads —
  no half-file is ever treated as archived. `POST /api/upload-archive` (old tabs) is kept, unchanged, for one release.
  Both pages (PULSE `archiveUpload`, Ops `archiveForVAS`) use the new path and fall back to the old route when `start`
  answers 404 (a Worker not yet deployed).

## Constitution Check

| Principle | Status |
|---|---|
| I Engine decides | PASS — the month totals for `/api/ask` move from the Worker into PULSE's summary |
| V Locked down | PASS — the service key never leaves the Worker; the signed URL names one pending path and expires; `start`/`complete` are refused to portal-only sessions; CSP unchanged (Supabase was already in `connect-src` for the large-file path) |
| VI Saves acknowledged | PASS — compare-and-set, 425, banners, retries untouched; the wipe guard and a new empty-state refusal hold; the summary is never a user-visible save (its failure only means readers fall back) |
| VII Guards | PASS — `verify-overload-031` written first (RED), registered in verify.yml |
| Platform: FREE plan | PASS — the save path does no unpacking; logs within the free allowance; no paid feature |

## Complexity Tracking

| Deviation | Why |
|---|---|
| A second small POST after each VAS save (`vas-summary`) | The Worker cannot read a 20 MB state inside 10 ms CPU in any form; a side-copy the engine writes is the only free-plan read. |

## Project Structure

```text
worker/wrangler.toml                         C1
worker/src/index.mjs                         C1 heavyLog, C2/C3 POST /api/kv, C4 vasView + 3 readers, C6 routes
nicks_code/index.html                        C3 &files=, C4 summary push, C6 archiveUpload
Chatterbox_AgentOS_Analytics.html            C6 archiveForVAS
tools/*.mjs (6)                              C5
nicks_code/diagnostics/verify-overload-031.mjs   NEW (RED first)
nicks_code/diagnostics/verify-kv-large-store.mjs E: vas-state past the line is now kept, the digest still 413s
specs/031-server-overload-upload-days/runbook.md how to query the logs; before/after measurement
```

## Release (order matters)

1. Worker first (`cd worker && npx wrangler deploy`): the new routes, `files=` refusal and compressed storage are
   inert until a page uses them, and an old page keeps working (plain or gzip saves, `/api/upload-archive`).
2. Merge so the tools (the tick's digest-republish) read through `kv-store.mjs` BEFORE the first compressed vas-state
   is written — the first PULSE gzip save after step 1 writes one. Steps 1–2 together, before anyone uploads.
3. Pages (`node tools/prepare-site.js` + the usual direct upload with `--branch main`), then the mandatory smoke
   (`verify-cors-headers --live`, `verify-live-save --live`).
4. No migration.

## Review round 2 (2026-10-11) — what changed

| Finding | Change |
|---|---|
| F1 HIGH: a decompression bomb / non-JSON could be stored | vas-state: ISIZE > `KV_INFLATE_MAX` → 413; a gzip WITHOUT `&gz=`/`&size=` (a page cached from before 031) is unpacked in full by streaming under the cap and must start `{` and end `}` (`gzipEnvelope`); a plain body must start `{` and end `}` (`plainIsObject`); every Worker unpack counts bytes and stops at a cap (`countCap`: storedText, the generic /api/kv inflate) |
| F2 MEDIUM: the summary was unvalidated, often stale, and its fallback was the killing parse | `worker/src/vas-summary.mjs`: shape checked on write (400 `bad_summary`, 413 over 4 MB) and on read; a write for another state version → 409 `stale_summary` (no out-of-order overwrite); a valid summary BEHIND the state is served flagged `stale:true`, the whole state only when no valid summary exists; `?meta=1` returns its `state_version`; PULSE skips a push when `__vasBase` moved on and catches the summary up after hydrate and every 10 minutes (`__vasSummaryCatchUp`); the AI prompt takes only `YYYY-MM` months and control-character-free file types |
| F1.3/F2: write permission | `vasWriteAllowed`: admin or a full session holding the VAS app — matches all 7 real writers of the last 30 days (an upload-tab rule would have locked out sylvannas and dalwin) |
| F3: pending uploads | owner-scoped pending path; `/start` 429 at 5 unfinished per person; the tick sweeps objects older than an hour (2 subrequests); `/complete` refuses another person's path |
| F4: no size from Storage | `/complete` refuses (409) and deletes the pending object |
| restore-state double gzip | the undo stash copies a gzip live store as is; prints stored and unpacked MB |
| logs | `heavyLog` reason = a short code only; no file names or state stamps in warnings |
| PULSE toast | left as is, deliberately: `toast()` writes textContent, so the server's words are already inert (esc() would show `&lt;`); Ops' HTML toast escapes |
