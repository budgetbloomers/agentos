---
description: "Tasks — 017 intake through the lake (Stage 1: every file to the database; engines read from it; blob machinery retired per source)"
---

# Tasks: Intake through the lake (017)

**Tests**: required; each RED first on fixtures (no live writes from tests). **Cutovers** need parity 0 on live data
(read-only) and Nick's go-ahead per source. The old path stays until a week after each switch.

## Phase 1: Setup
- [ ] T001 verify-intake-017.mjs skeleton: decide and record the SQL test harness (a local Postgres via the diagnostics
  devDependencies if available, else the recorded-PostgREST stub pattern from verify-rake) — never the live database;
  register in verify.yml
- [ ] T002 tools/parity-017.mjs: `--source <s> --month YYYY-MM` builds the S.* shape from the lake view and from the live
  blob (read-only), diffs per date×cb, exits 1 on any difference

## Phase 2: Foundation (US1 + US2 groundwork)
- [ ] T003 migration-056: staging + rake_page_contracts + rake_merge_* for ATTENDANCE, QA_EVALUATIONS, SF_INACTIVE;
  BI/VICI merges carry every page ingest rule (plan.md §A1); RLS/revokes
- [ ] T004 migration-057: engine views engine_att_day, engine_qa_day, engine_sales_day, engine_calls_day,
  engine_closed + an upload receipts view; RLS/revokes; EXPLAIN each over a month (≤ 2 s)
- [ ] T005 Worker: GET /api/lake/<view>?from&to — allow-listed views, session gate (staff + portal rules as the
  digest), Range paging, gzip, no parsing; tests incl. refusal of unknown views and scoped sessions
- [ ] T006 PULSE: rakeInPage for every size per switched source (LAKE_SOURCES flag), hash-first duplicate answer,
  receipts card ("In the database — rows, span" / refused with the first bad row / incomplete + Resume); Chromium tests
- [ ] T007 PULSE + Ops: rebuild()/facts fill from the views when a source is switched; S.files from receipts; tests
  prove the S.* shape is identical for the fixture month (blob path vs lake path)

## Phase 3: Cutovers (each: parity 0 recorded here → Nick's OK → flag on → week clean → retire)
- [ ] T008 Attendance (+leave): parity ___ ; switched ___ ; retired ___
- [ ] T009 QA: parity ___ ; switched ___ ; retired ___
- [ ] T010 Cancellations + BI (money): parity ___ (sales, gwp, canc per date×owner) ; switched ___ ; retired ___
- [ ] T011 ViciDial: parity ___ (talk/calls/ans/opt per date×cb; fuller-day-wins) ; switched ___ ; Ops 132 MB store retired ___
- [ ] T012 Salesforce closed: parity ___ ; switched ___ ; retired ___
- [ ] T013 Agent List: blob copies removed (kv:roster-current stays the record) ___

## Phase 4: Retire the blob machinery (US3)
- [ ] T014 Remove vas-state / cb-facts pushes, CAS + replay + banners, /api/save-fail + saves-failing, kv_write_log for
  those keys, torn-cache heal, hydrate/cbx-fresh poller, upload-archive relay, lake-load; update or remove the suites
  that pinned them (verify-save-acks, verify-ops-cas, verify-store-freshness, verify-kv-large-store…)
- [ ] T015 Upload Station copy: "in the database" language; alerts list reviewed with Nick (what remains must name a data problem)
- [ ] T016 Independent code + security review per phase; release per source with Nick's go-ahead; commit per source
