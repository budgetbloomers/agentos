# The Data Rake — large files from the Upload Station into the lake

*Built 8 September 2026 (Phases 0 and 1 of the Chatterbox Data Rake proposal). This is the usage guide;
the design rationale and the reference-repository verdicts are in the proposal artifact
https://claude.ai/code/artifact/e07f7740-adb8-4377-bee4-cabb2961d260.*

## What it is for

Salesforce Power BI, open-cases and closed-cases exports can run past 500 MB; ViciDial rarely. The browser
path (Upload Station → in-page parse → Worker relay, 30 MB cap) cannot carry them. The Rake is a second
path for files of any size: the browser streams the file straight to Supabase Storage, the Worker records
it and queues it, and the GitHub runner turns it into a Parquet copy plus rows in partitioned Postgres
tables. The browser never parses a large file and the Worker never touches its bytes.

## How to use it (Nick / Ashton)

1. PULSE → Upload Station → **Large files** card → choose the file (or drop it).
2. Watch the progress line: uploading → `Received … queued for the rake`. Closing the tab after "Received" is safe.
3. The card's table shows every large file with its status. `loaded` with a row count means it is in the lake;
   `failed` shows the reason (an unrecognised header is the common one). A file stuck in `received` for over
   an hour raises the `rake-stuck` health banner in both apps.
4. The runner picks files up on the digest schedule (every 15 minutes, Mon–Sat 06–20 SAST). To run it now:
   GitHub → Actions → publish-digests → Run workflow → `steps: all`.

Power BI exports should be CSV past ~200 MB. XLSX is read whole (the format allows nothing else); CSV, TSV
and Salesforce's HTML ".xls" stream at flat memory whatever their size.

## The moving parts

| Piece | Where | Does |
|---|---|---|
| Large files card | `nicks_code/index.html` (`largeFileCard`, `largeUpload`, `largeStatus`, `LARGE_MSG`) | Asks the Worker for a signed URL, PUTs the file to Storage with progress, tells the Worker it is complete, lists status |
| Worker routes | `worker/src/index.mjs` `/api/upload/large/start\|complete\|status` | Mints a signed upload URL for `raw-uploads/<yyyy>/<mm>/<dd>/<id>-<name>`, records `upload_files` (received), calls `rake_enqueue` |
| Health | `worker/src/health.mjs` `rake-stuck` | Reads `rake_health()`; alerts on stuck, failed or dead-lettered files |
| Runner step | `.github/workflows/publish-digests.yml` "Data Rake" | `node tools/rake.mjs` before the digests, so a file that just landed is in the lake when they republish |
| The rake | `tools/rake.mjs` | Queue drain: download-hashing → sniff → stream to canonical CSV → DuckDB Parquet → COPY into unlogged staging → SQL merge in 50k slices with a checkpoint → rejects to `failed/` → `agent_day` refresh → `pipeline_runs` |
| The pure parts | `tools/rake-lib.mjs` | Source contracts, header detection, snapshot-date rule, byte sniffing, the three readers, the canonical CSV writer |
| Schema | `supabase/migration-027…030` | Partitioned lake tables (pg_partman monthly), `upload_files`, `pipeline_runs`, pgmq `ingest`/`ingest_dlq`, staging tables, merge functions, `rake_owner_map`, `closed_ts` |
| Buckets | `raw-uploads`, `processed`, `failed` | The file as received; the Parquet copy per source and month; rejected rows with reasons |

### CLI

```
node tools/rake.mjs                                   drain the queue, refresh agent_day
node tools/rake.mjs --file <upload_files.id>          one recorded file, queued or not
node tools/rake.mjs --register raw-uploads/<path> [--name <file name>] [--by <user>]
node tools/rake.mjs --dry                             validate + Parquet, load nothing
```

Needs `supabase.env` (SUPABASE_URL, SUPABASE_SECRET_KEY, SUPABASE_DB_URL — the pooler URL) and the
diagnostics `node_modules` (pg, @duckdb/node-api, csv-parse, pg-copy-streams are in
`nicks_code/diagnostics/package.json`).

## Conventions the merges enforce (the parts that look like bugs and are not)

- **Owners resolve through the Agent List, once.** `rake_owner_map` is every normalised Sales Force name
  and Agent Name that exactly ONE CB claims; a name two agents share resolves to nothing rather than a
  guess, and a later load fills `employee_code` in without erasing a resolved one (`coalesce`).
- **Closed cases key on the closure DAY at midnight UTC.** That is the Ops app's convention, so the
  browser path and the rake update the same row instead of writing twins; the true closure time lives
  in `closed_ts` (migration-029). Learned the hard way: the first live load wrote 7,002 twins.
- **Queues are not agents.** `Cuddle Call`, `Courtesy Call`, `VIP Welcome Calls`, `EC3 Welcome Call` as
  a case owner set `owner_kind = 'queue'` and no employee code.
- **A Vici login is an employee code only when it is a CB number.** `VDCL` and friends stay unresolved.
- **Excel serial dates, comma decimals, `.0` account suffixes** are parsed in SQL (`rake_date`,
  `rake_num`, `rake_idish`) and never raise; an unparseable key row is a reject, listed in
  `rake_rejects_<source>` and written to `failed/`.
- **Snapshot date** for open cases comes from `ddmmyy` in the file name, else the received day.
- **Duplicate headers**: the first occurrence wins, as in the browser.
- **The lake is fuller than the browser path by design**: full open-case snapshots, zero-length calls and
  every BI charge line land; the browser path aggregates at ingest.

## Verification

`node nicks_code/diagnostics/verify-rake.mjs` — 32 checks. The library half drives `rake-lib.mjs` on
fixtures in a temp folder; the database half stages fixture rows (cases 9000xx, CB900077), calls every
merge and reads the lake back inside one transaction that always rolls back. Runs nightly
(publish-digests) and on every verify run (verify.yml).

Live figures from the first end-to-end runs (8 Sep): SF closed 7,002 merged in place; SF open 78,273 rows
in 35 s; Vici 25,649; BI 10,225 + 1 reject; browser upload of a 1,315-row export end to end.

## Not built yet (Phase 2)

Retention policy on `raw-uploads`; `wrappers` S3 foreign tables over the Parquet copies for ad-hoc SQL;
compatibility view replacing `kv:upload-manifest`; a ViciDial screenshot for the agents' Links tab
(office network only). Still with Nick: `GH_DISPATCH_TOKEN` so the Worker can kick a silent runner.
