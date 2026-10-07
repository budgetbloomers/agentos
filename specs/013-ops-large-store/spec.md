# Feature Specification: VAS uploads reach Ops again — a store larger than the server's memory is kept compressed

**Feature Branch**: `013-ops-large-store`

**Created**: 2026-10-07

**Status**: Draft

**Input**: "⚠ 3 cloud saves failed in the last hour … ops cb-facts-VICI_CALL_REPORT → 400 could not decompress the upload:
Memory limit ×3" — "the upload station in vas analytics, the same data is needed in ops analytics, so when data is
uploaded in vas the ones that are needed can it go into ops".

## What is happening (2026-10-07, read-only)

- VAS → Ops already works by design: every file VAS ingests is archived, and Ops (and the 15-minute relay) pulls each
  new one through its own reader. Today every source is current in Ops — Agent List, attendance, BI, QA, closed cases,
  inactive, referrals — **except ViciDial**.
- Ops' ViciDial store holds one row per call: **132.7 MB**. A save is sent compressed (~10:1), and the server
  decompresses the WHOLE body before storing it — the server's memory runs out ("Memory limit exceeded before EOF").
  The last ViciDial save that landed was **28 Sep 07:26**; every one since has failed.
- Ops' self-heal already re-relays a ViciDial file whose rows are not in the store, every cycle — so each relay
  re-applies the missing days and fails the same save again: the "3 saves failed in the last hour" banner.
- The database's call history (`vici_calls`, filled from the same store by `tools/lake-load.mjs`) stops at 26 Sep for
  the same reason.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A ViciDial upload in VAS lands in Ops (Priority: P1)

A ViciDial export uploaded in the VAS Upload Station reaches Ops and STAYS there (saved to the cloud), however large
Ops' call store has grown.

**Independent Test**: Save a store larger than the server's memory; it is accepted and reads back byte-for-byte.

**Acceptance Scenarios**:

1. **Given** Ops' call store is larger than the server can unpack, **When** it is saved, **Then** the save succeeds
   and the store is kept compressed.
2. **Given** a compressed store, **When** any app opens it, **Then** it reads the same data as before (the browser
   unpacks it on arrival).
3. **Given** the fix is live, **When** the next relay runs, **Then** the ViciDial days missing since 28 Sep are
   re-applied by the existing self-heal and saved, and the failed-save banner clears.

### User Story 2 - Nothing that reads a store breaks (Priority: P1)

Every reader of a store — the apps, the backups, the daily snapshot, the call-history load, the NBA republish,
the duplicate clean-up — handles a compressed store.

**Acceptance Scenarios**:

1. **Given** a compressed store, **Then** the call-history load, the NBA republish and the duplicate clean-up read
   it as JSON.
2. **Given** a compressed store, **Then** the daily snapshot and the backup tool copy it as it is (never compressed
   twice, so a restore still works).

### Edge Cases

- A compressed upload that is not JSON, or whose bytes are not valid gzip, is refused (400) — never stored.
- Stores under the size line are stored exactly as today (plain JSON) — no reader sees any change for them.
- The keys the server reads (the agent digest and reports, the VAS state's wipe guard) are never stored compressed.
- A store written plain by a tool after being compressed (the duplicate clean-up) is still read correctly: the format
  is decided from the stored bytes, not from a flag.

## Requirements *(mandatory)*

- **FR-001**: A compressed save whose unpacked size (from the gzip trailer) exceeds the server's safe line (32 MB)
  MUST be stored compressed, without unpacking it whole; its start MUST be unpacked enough to confirm it is JSON.
- **FR-002**: A load MUST decide from the stored bytes whether the store is compressed, and send it with
  `Content-Encoding: gzip` if so.
- **FR-003**: Saves under the line, and the server-read keys (agent-digest*, agent-reports-*, vas-state), MUST behave
  exactly as today.
- **FR-004**: Every tool that reads a store directly MUST handle a compressed one; snapshot and backup copies MUST copy
  a compressed store as it is.
- **FR-005**: The write log MUST record the unpacked size.

## Success Criteria *(mandatory)*

- **SC-001**: Ops' ViciDial store saves again; the "cloud saves failed" banner for it clears within one relay cycle.
- **SC-002**: Ops' ViciDial calls are current to the latest VAS upload (no gap since 28 Sep).

## Assumptions

- The existing self-heal (relay re-applies a ViciDial file whose rows are missing) repairs the gap once saves land —
  no hand-run repair is needed.
- Ops' open cases (stale since 31 Aug) are out of scope: that export now goes to the lake by design.
