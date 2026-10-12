# Feature Specification: The server stops being overwhelmed on upload days

**Feature Branch**: `031-server-overload-upload-days` | **Created**: 2026-10-11 | **Status**: Draft
**Input**: Nick, 2026-10-11: "I get a lot of notification didnt reach the server, is something wrong with supabase or agent os"

## Findings (read-only, 2026-10-11)
- **Not Supabase.** Cloudflare's own invocation record for the Worker shows requests KILLED for exceeding resources
  (CPU or memory) — 13 (4 Oct), 10 (5 Oct), 7 (7 Oct), **40 (8 Oct)**, **102 (9 Oct, upload day)**, 0 on days without
  uploads — while successful requests' CPU p99 rose from 45 ms to 238 ms. A killed request sends no reply, so the page
  reports "Failed to fetch" → the "didn't reach the server" / "cloud save failed (network)" warnings.
- `save_failures` since 27 Sep: 85. The ViciDial "could not decompress" (49) stopped on 7 Oct (spec 013); the
  "replay 425" (~19) mostly stopped with spec 014; **"network Failed to fetch"** on vas-state + Ops stores is the
  remaining, growing kind (9 on 8–9 Oct).
- Heavy requests through the Worker on upload days: the VAS month save (`vas-state`, ~21 MB unpacked, gzip-uploaded —
  the Worker unpacks the whole body on every save), raw files relayed to the archive (`/api/upload-archive`, ≤ 30 MB
  each), Ops fact stores, large GETs of the same blobs.
- Cloudflare's FREE plan: ~10 ms CPU and ~128 MB memory per request (Nick: no paid plans).

## Decided with Nick (2026-10-11)
Targeted fix now on the free plan: (1) switch on Cloudflare's free request logs to NAME the failing routes; (2) stop the
Worker unpacking the VAS month save (keep it compressed at rest, like Ops' ViciDial store since 013); (3) raw-file archive
uploads go straight to storage, not through the Worker. Measure before and after on Cloudflare's own record. The full cure
(spec 017, files straight into the database) continues separately.

## User Scenarios & Testing (mandatory)
### US1 — Saving after an upload just works (P1)
**Given** a busy upload morning (8–10 files, two people), **Then** no request is killed for exceeding resources and no
"didn't reach the server" / "cloud save failed (network)" warning appears for a save that the server could have taken.
### US2 — When something does fail, we can say exactly what (P1)
**Given** any killed or failed request, **Then** the logs name the route, size and reason, so the next fix is targeted.
### US3 — Nothing else changes (P1)
Every figure, the save safety net (compare-and-set, retries, banners) and the Wimpy/017/027/028–030 behaviour stay as they are.

### Edge Cases
- A VAS save larger than the Worker can unpack: stored compressed and still read back intact by every page.
- The Worker's OWN reads of vas-state (roster derivation, campaign stats) must still work — stream-unpack only what they need, or read a small side-copy.
- Old tabs still sending uncompressed saves keep working.
- An archive upload interrupted half-way leaves no half-file that the station treats as complete.

## Requirements (mandatory)
- **FR-001** Cloudflare request logs on (free tier), with route, request size, status and outcome; a short runbook query.
- **FR-002** The VAS month save is stored as it arrives (compressed); the Worker never unpacks it on save; reads serve it compressed (Content-Encoding) as for the Ops stores.
- **FR-003** Every Worker path that reads vas-state for its own use keeps working within the free-plan limits.
- **FR-004** Raw-file archive uploads go browser → storage directly (signed upload), the Worker only records them.
- **FR-005** Before/after measurement: exceededResources per upload day on Cloudflare's record, and save_failures "network" count.

## Success Criteria (mandatory)
- **SC-001** On the first two upload days after release, ≥ 90% fewer requests killed for exceeding resources than on 9 Oct (102).
- **SC-002** Zero "network Failed to fetch" save failures caused by a VAS save or an archive upload on those days.
- **SC-003** Every suite green; no figure changes.

## Assumptions
- The free logging tier (Workers Logs) is enough for a day's volume (~6,000 requests).
