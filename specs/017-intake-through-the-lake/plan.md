# Implementation Plan: Intake through the lake (017, Stage 1)

**Spec**: [spec.md](spec.md) | **Date**: 2026-10-08 | **Code map**: the read-only survey of 2026-10-08 (summarised below)

## What exists today (from the code map)

| Source | Today's store (browser) | Lake table (exists) | Loaded by | Engine readers (PULSE) |
|---|---|---|---|---|
| Agent List | S.roster/orgHist/leavers + kv:roster-current | agent_list (+aliases, leavers, team_leader_cbs) | POST /api/roster → publish_agent_list (SQL) | buildIndex/resolveKey (identity for everything) |
| Attendance (+leave codes) | S.att[date][cb]; Ops facts.ATTENDANCE | attendance (date, code) | lake-load from the Ops blob only | attWeight, excusedShare, buildModel, dataOnlyDay |
| QA evaluations | S.evals[date][cb][]; Ops facts.QA_EVALUATIONS | qa_evaluations (record_id) | lake-load only | evalsFor, qaSeries, composite QA |
| BI active cases (money) + Cancellations | S.sales (case grain) + S.cancRows; Ops facts.BI_ACTIVE_CASES | bi_active_cases (monthly partitions); sf_inactive | /api/bi (Ops, ≤35,200 rows) · rake_page (large) · lake-load | grossUpSales, agentAgg, buildModel, compositeFor, variance |
| Salesforce open / closed | S.opencasesLM (already from the lake via /api/lead-book); S.closedcases | sf_open_cases, sf_closed_cases | rake_page; lake-load | leadBook, leadFunnel, conversion driver |
| ViciDial | S.calls[date][cb] aggregates, viciDays; Ops facts.VICI_CALL_REPORT (a row per call, 132 MB) | vici_calls (monthly partitions) | rake_page; lake-load | buildModel, agentAgg, V14/V25, diallerWarning |

The blob machinery to retire once nothing needs it: vas-state / cb-facts-* pushes, X-Cbx-Base compare-and-set, 409/425
replay + mergeStates, __saveAck/__saveFail/__unsavedBanner, /api/save-fail + saves-failing, kv_write_log for those keys,
the torn-cache self-heal, hydrate + the cbx-fresh poller, the upload-archive relay between PULSE and Ops
(`/api/upload-archive`, kv:upload-manifest, syncUploadsFromStation, BroadcastChannel), KV_INFLATE_MAX gz-at-rest for
cb-facts, lake-load (the lake is loaded directly).

## Technical Context

Browser pages parse files (they already do, at flat memory for CSV/TSV/HTML; XLSX whole) and STREAM rows to database
staging through the existing `/api/rake/page` pass-through (≈0 Worker CPU) — `rake_page_begin/stage/merge/finish`
(migration-042). Merges are SQL (`rake_merge_*`). Engines keep running in the pages (Stage 1) but read their inputs
through a new `/api/lake/<view>` pass-through (PostgREST streamed, no parsing in the Worker) backed by SQL views shaped
exactly like the S.* structures they consume today. Limits: PostgREST 1,000 rows/page (the pass-through streams with
Range paging), statement timeout → merges in slices (existing). No new runtime; the Oracle box (016) only takes over
scheduled work (digest publish, NBA review, referrals), which is unchanged by this spec.

## Constitution Check

I Engine decides, page paints — engines unchanged in Stage 1; only where they READ moves. II One money model — the BI
merge keeps case grain + cancellation netting in SQL views, proven by parity. III Agent List is the record — identity
resolution stays through agent_list (rake_owner_map already). V Locked down — new tables/views RLS-on, revoked;
reads only via the Worker's session gate. VI Acknowledged — the upload receipt IS the acknowledgement (upload_files
row + batches); no second save to fail. VII Guards — verify-intake-017 (per source) + the parity tool.

## Design

### A. Foundation (no cutover yet)
1. **Contracts for every slot**: extend `rake_page_contracts` + staging + `rake_merge_*` for ATTENDANCE, QA_EVALUATIONS,
   SF_INACTIVE (cancellations), and make BI/VICI/SF merges carry every ingest rule the page applies today (test rows,
   VAT floor cent, net-of-cancellation, fuller-day-wins, dedupe keys, SAST timestamps, `full-export` QA retire).
   The Agent List keeps `/api/roster` (already SQL, already the record).
2. **One upload path for every size**: `LARGE_MIN` becomes 0 for a switched source — every file takes
   `rakeInPage` (hash first → duplicate says so → stage/merge → receipt). The Upload Station card shows per file:
   reading → in the database (rows, span) / refused (first bad row) / incomplete (Resume).
3. **Engine input views + `/api/lake/<view>?from&to`**: SQL views `engine_att_day`, `engine_qa_day`, `engine_sales_day`
   (case grain, netted), `engine_calls_day` (talk/calls/ans/opt/saleD per date×cb, fuller-day-wins), `engine_closed`,
   each shaped like the S.* key the page reads; the Worker streams them (Range paging, gzip) with no parsing.
4. **Parity tool** `tools/parity-017.mjs`: for a source and month, builds the S.* shape from the lake view and from the
   live blob, diffs per date×cb, prints the first 20 differences; a cutover needs 0 (recorded in tasks.md).
5. **Readers in PULSE/Ops**: a `LAKE_SOURCES` switch per source; when on, `rebuild()` fills S.att/S.evals/S.sales/S.calls
   from the view instead of the blob and the slot's INGEST stops writing the blob; `S.files` becomes the upload_files
   receipts for the month. Ops: `facts[SRC]` filled from the same views (its own engine unchanged).

### B. Cutovers — one source at a time, each: parity 0 → Nick's OK → switch on → a week clean → retire its blob path
1. Attendance (+leave) 2. QA 3. Cancellations + BI (together: netting) 4. ViciDial (also removes Ops' 132 MB store)
5. Salesforce closed (open is already lake-fed) 6. Agent List (blob copies only) 7. Retire the shared blob machinery
(list above) and the alerts that only existed for it; upload-archive relay replaced by "both apps read the lake".

## Subrequest / size budget
`/api/rake/page` and `/api/lake/*` are pass-throughs: 1 subrequest each, ~0 CPU, streamed bodies. Staging slices stay
5,000 rows; merges 20,000 rows with the existing halving on timeout. Views over a month: attendance ≤ 3k rows, QA ≤ 10k,
sales ≤ 40k, calls ≤ 1.2M per-call → aggregated in the view to ≤ 4k rows date×cb.

## Project Structure
```text
supabase/migration-056-intake-contracts.sql   staging + merges for ATTENDANCE, QA_EVALUATIONS, SF_INACTIVE; rule parity in BI/VICI merges
supabase/migration-057-engine-views.sql       engine_* views (+ RLS/revokes), upload receipts view
worker/src/index.mjs                          /api/lake/<view> pass-through (session gate, allow-list of views, Range paging)
nicks_code/index.html                         LAKE_SOURCES switch; rakeInPage for every size per switched source; receipts card; rebuild() reads views
Chatterbox_AgentOS_Analytics.html             facts[SRC] from views per switched source
tools/parity-017.mjs                          the parity tool
nicks_code/diagnostics/verify-intake-017.mjs  guard (fixtures through staging → views → S.* shape; receipts; dup; resume; refusal)
```

## Release discipline
Per source: tests RED→GREEN on fixtures → migration applied → parity 0 on live for current + previous month → Nick's
go-ahead → switch (a flag, instantly reversible) → one week clean → remove the old path in a follow-up commit.
