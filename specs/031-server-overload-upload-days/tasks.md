---
description: "Task list — 031 the server stops being overwhelmed on upload days"
---

# Tasks: server overload on upload days

**Input**: spec.md, plan.md (C1–C6). **Tests**: REQUIRED (Constitution VII), red first.

- [x] T001 Baseline measurement (read-only): Cloudflare exceededResources per day, kv_write_log sizes, manifest
  archive sizes, save_failures kinds, live vas-state composition → plan.md Evidence
- [x] T002 [US1][US2][US3] NEW `nicks_code/diagnostics/verify-overload-031.mjs` — in-process Worker, stubbed
  Storage/PostgREST, counting DecompressionStream:
  A gzip vas-state POST stored byte-identical, pointer `{store,gz,size}`, write log = ISIZE, no more than 16 KB fed to
  the unpacker; GET → Content-Encoding gzip, same bytes · B wipe guard refuses a tiny gzip over a big compressed store,
  `?force=1` passes; `files=0` → 409 empty_state; garbled trailer → 400; corrupt start → 400 · C plain (old-tab) save
  still stored and read · D `/api/campaign-stats`, `/api/ask` VAS block and the rosterSync derivation give the same
  answers from a compressed store + summary as from the plain state, and fall back when the summary is stale ·
  E archive start → signed PUT → complete records the manifest entry once (second complete = dupe), size mismatch
  and missing object refused, nothing under uploads/ until complete; old `/api/upload-archive` still archives ·
  F exactly one `cbx_heavy` line per heavy request, none for light ones · G wrangler.toml observability on · H pages:
  PULSE sends `&files=` and pushes `vas-summary`, both pages archive through start/complete with the old-route
  fallback; tools read vas-state through kv-store.mjs — RED
- [x] T003 [US2] C1 wrangler `[observability]` + `heavyLog` in `fetch()`
- [x] T004 [US1] C2 + C3 POST /api/kv keeps vas-state as it arrives; bounded `gzipStart`; ISIZE wipe guard; `files=0`
- [x] T005 [US1][US3] C4 `vasView()` + rosterSync / campaign-stats / ask; PULSE `vas-summary` push + `&files=`
- [x] T006 [US1] C6 archive start/complete routes; PULSE + Ops clients with fallback
- [x] T007 [US3] C5 tools read through kv-store.mjs; verify-kv-large-store section E follows 031
- [x] T008 GREEN + the save-safety suites (save-acks, store-freshness, kv-large-store, ops-cas, live-month-page,
  roster-of-record, roster-autoupdate, upload-station-layout, vas-sweep-014, worker-sweep-014, digest-fence,
  targets-027, usage-028/029/030, wimpy-removal, wimpy-service-drift); register in verify.yml; runbook.md
- [ ] T009 Release (needs Nick's go-ahead): Worker → merge (tools) → Pages → smoke; measure SC-001/SC-002 on the next
  two upload days with the runbook queries
