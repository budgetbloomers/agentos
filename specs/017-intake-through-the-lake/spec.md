# Feature Specification: Intake through the lake — a file goes to the database, never into the browser's memory

**Feature Branch**: `017-intake-through-the-lake` | **Created**: 2026-10-08 | **Status**: Draft
**Input**: Nick, 2026-10-08: "what is so hard, I want the files to be uploaded in the upload station, taking to supabase to
through the data rake etc, why are we doing so many checks, why are there so many failures"

## Why this exists

Today a file dropped in the Upload Station is read by the browser, which then holds the whole month's data in memory
(21 MB and growing) and re-uploads that entire blob to the server on every save. That is where "cloud saves failed",
"another tab saved first", "memory limit" and most of the red banners come from, and most of the checks exist to catch
what that design keeps breaking. Four of the seven file types already have a better path (the Data Rake: rows streamed
into database staging, merged by the database); the other three and the dashboards' own saves do not.

## Decided with Nick (2026-10-08)

1. **Stage 1 (this spec): intake first.** Every Upload Station file goes file → storage → database; the browser never
   again holds or re-uploads the month's state. The dashboards keep their engines for now but read from the database,
   so they look the same on day one. **Stage 2 (a later spec): the engines move to the server.**
2. **Source by source, old path kept.** Each file type switches only when its new path is proven on live data; the old
   path and the checks that existed only for it are removed afterwards. No day without dashboards.
3. The server-side machine is the Oracle Always Free box (spec 016); Stage 1 needs it only for scheduled work the
   browser used to do.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Upload a file and it is simply in (Priority: P1)
A team member drops a file in the Upload Station. The station shows it being read, then "In the database — 12,431
rows, 1–7 Oct". Closing the tab, a slow Wi-Fi, or a second person uploading at the same moment changes nothing: the
file is in, once, for everyone.
1. **Given** any of the seven file types, **When** it is dropped, **Then** its rows reach the database directly and
   the station reports the row count and the date span it covered.
2. **Given** the same file dropped twice (or by two people), **Then** it loads once and the second drop says so.
3. **Given** the tab is closed mid-upload, **Then** the file is either fully in or marked incomplete and resumable —
   never half in and silent.
4. **Given** the upload succeeded, **Then** no red "cloud save failed" banner can follow from it, because there is no
   second save.

### User Story 2 — The dashboards show the same numbers as before (Priority: P1)
1. **Given** a source has been switched, **When** VAS, Ops and Agent Analytics are opened, **Then** every figure that
   depends on that source equals the figure the old path produced for the same files (a recorded parity check).
2. **Given** the business rules (dropped agents off every report; Saturdays and public holidays are data, not shifts;
   CallX refused; live digest is the current SAST month; one sale = one case net of cancellation), **Then** none changes.
3. **Given** an upload lands, **Then** every open dashboard picks it up within one refresh without anyone re-uploading.

### User Story 3 — The checks that existed for the old design go away (Priority: P2)
1. **Given** a source has been switched and proven, **Then** its blob save, conflict handling, save banners and
   save-failure alerts are removed, and the Upload Station's language changes from "saved to the cloud" to "in the database".
2. **Given** all seven are switched, **Then** no tab pushes the month's state anywhere; the alerts list is shorter and
   each remaining alert names a real data problem (a source late, a file refused), not a save.

### Edge Cases
- A file for a past month, or a correction → loads and replaces its own span, as today (months accumulate).
- A huge file (hundreds of MB) → takes the streaming path with progress; the page stays responsive.
- A file with a format change → refused in words, with the first bad row, before anything is written.
- Two different files covering the same day (ViciDial) → fullest day wins, as today.
- The database is briefly unreachable → the station says so and offers Retry; nothing is half-written.

## Requirements *(mandatory)*
- **FR-001** Every Upload Station slot MUST write its rows to the database (staging → merge) and nothing else; no slot
  may add the file's rows to a browser-held state blob once switched.
- **FR-002** Each file MUST be loaded at most once (identified by content, not name), with a receipt: rows, span, who,
  when; a repeat is reported, not reloaded.
- **FR-003** Ingest rules MUST be applied where the rows are loaded, identically to today (identity and aliases,
  campaign classification, data-only days, CallX refusal, ViciDial fullest-day, BI case grain).
- **FR-004** Each engine input a source feeds MUST be served from the database (a view or an endpoint) with the same
  shape the engine reads today, so the engine code is unchanged in Stage 1.
- **FR-005** Before a source is switched, a parity check MUST show the database figures equal the blob figures for the
  same files, for the current and previous month, and the result MUST be recorded in the spec.
- **FR-006** After a source is switched and proven, its blob path and the checks that existed only for it MUST be removed.
- **FR-007** Access to the new tables MUST be locked down like the rest (RLS on, anon/authenticated revoked).
- **FR-008** Nothing switches, deploys or migrates without Nick's go-ahead per source.

## Key Entities
- **Upload (receipt)**: file identity (hash), slot/source, uploader, time, rows loaded, span, status (loading / in /
  refused / incomplete), and the reason when refused.
- **Lake table per source**: one row per fact at its natural grain, keyed so a re-upload replaces its own span.
- **Engine input view**: per source, the read shape an engine consumes today.

## Success Criteria *(mandatory)*
- **SC-001** Zero "cloud save failed" alerts caused by a switched source for a week after its switch; zero for all
  sources after the last switch.
- **SC-002** 100% figure parity on the recorded checks before each switch.
- **SC-003** An upload is visible on every dashboard within one refresh, without a re-upload.
- **SC-004** No tab pushes the month's state blob after the last switch (measured on the server's write log).

## Assumptions
- Order of switching: the sources that fail most and are smallest first (Agent List, attendance, leave, QA), then the
  four already partly on the Rake (BI, Salesforce open/closed, ViciDial) — confirmed against the code map in plan.md.
- Stage 2 (engines on the server, pages as readers) is scoped separately once Stage 1 is live for all seven.
