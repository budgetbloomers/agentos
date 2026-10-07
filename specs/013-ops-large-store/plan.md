# Implementation Plan: keep a store larger than the server's memory compressed

**Branch**: `013-ops-large-store` | **Date**: 2026-10-07 | **Spec**: [spec.md](spec.md)

## Contracts

- **C1 POST /api/kv** (worker/src/index.mjs): gzip bytes (1f 8b) → read ISIZE (last 4 bytes, little-endian). If
  ISIZE > `KV_INFLATE_MAX` (32 MiB) and the key is not server-read (agent-digest*, agent-reports-*, vas-state):
  inflate only the FIRST chunk (sniff the first non-blank character: `[` or `{`, else 400 "not JSON"; an inflate
  error → 400 "could not decompress"); store the gzip bytes as they came (`Content-Type: application/octet-stream`);
  pointer `{store}` as today; write log records ISIZE. Otherwise: today's path, unchanged. A server-read key over
  the line → 413.
- **C2 GET /api/kv**: peek the stored object's first chunk; gzip magic → respond with `Content-Encoding: gzip`
  (`encodeBody: 'manual'`) and the bytes unchanged; otherwise exactly as today.
- **C3 snapshot** (worker/src/health.mjs): a source already gzip is copied as is; otherwise compressed as today.
- **C4 tools**: `tools/kv-store.mjs` → `isGzip(buf)`, `storeText(buf)`; used by lake-load, nba-republish,
  dedupe-facts (read); backup-facts copies gzip bytes as is.

## Constitution Check

| Principle | Status |
|---|---|
| VI Saves acknowledged, noticed, recoverable | PASS — the failing save lands; snapshots stay restorable (no double gzip) |
| Platform: FREE plan | PASS — the large path never inflates (no CPU/memory spike); loads stream |
| VII Guards | PASS — new verify-kv-large-store (Worker in-process + static reader checks), red first |

## Project Structure

```text
worker/src/index.mjs        C1, C2
worker/src/health.mjs       C3
tools/kv-store.mjs          NEW helper (C4)
tools/lake-load.mjs · tools/nba-republish.mjs · tools/dedupe-facts.mjs · tools/backup-facts.mjs   C4
nicks_code/diagnostics/verify-kv-large-store.mjs   NEW
```
