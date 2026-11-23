# Implementation Plan: Vehicle Tracking (VT) Analytics

**Branch**: `feature/vt-analytics` | **Date**: 2026-11-23 | **Spec**: [spec.md](./spec.md) | **Rule book draft**: [rules-draft.json](./rules-draft.json)

## Summary

The new "Vehicle Tracking" area is a **hybrid** (D1). It reuses the VAS Upload Station, the Agent List identity and the digest
publish/fence/serve contract. It gets its **own** engine file, rule book, Supabase tables, digest keys, Worker module and Agent
Analytics view. VT maths therefore cannot move a VAS figure, and VT data never enters `vas-state`.

Data flow:

```
browser (PULSE Upload Station)
  detectType: vtBiFitted / vtSchedMissed (BEFORE VAS bi)  ──►  vt-engine.js parse → keep only VT lines, drop PII
  GET  /api/vt/book            ◄── Worker streams RPC vt_book()      (one JSON value, ~0.6 MB)
  VTEngine.merge(book, file)   → changed case rows + events + receipt      (all logic in the engine)
  POST /api/vt/upload/begin|stage×n|commit  ──► RPC vt_upload_begin / _stage / _commit(p_base_rev)   (CAS, atomic)
  VTEngine.model(book', roster, rules) → VTEngine.digest(model)
  POST /api/kv kv:vt-digest + kv:vt-digest-cycle-YYYY-MM   (staff-only, fenced to the SAST business month)
Worker portal (vt.mjs) ── reads the digest only ──► Agent Analytics VT card / TL + CM VT reports
PULSE VT pages (vt-pages.js) ── paint VTEngine.model in the page (same numbers that were published)
```

## Technical Context

**Language/Version**: ES2019 browser JS (PULSE, Agent Analytics, no build step), Node 20 ESM (Worker, tools, diagnostics),
PostgreSQL 15 (Supabase).

**Primary Dependencies**: SheetJS (`/xlsx.full.min.js`, already loaded), Playwright (diagnostics), `pg` (diagnostics/tools only).

**Storage**: Supabase tables `vt_*` (new, §DB). KV rows in `rules` for the digest (existing mechanism).

**Testing**: `nicks_code/diagnostics/verify-vt-*.mjs` (Node + Playwright, house pattern). Database halves run inside a
transaction that always rolls back (`verify-rake` pattern).

**Target Platform**: Cloudflare Pages + Worker (FREE plan: 10 ms CPU, 50 subrequests per request), Supabase.

**Constraints**: the apps must run from `file://` (CLAUDE.md NN12). Never parse a blob in the Worker. PostgREST pages at 1,000 rows
and times out at about 8 s. Compare-and-set on shared stores. The month fence applies. VAS must not change (SC-003).

**Scale**: about 3,000 VT sales per business month (Sales Review `VT Scheduling!N6` budget 3,030). About 48 VT people, 4 TLs and
1 CM scope. Daily files: BI 19,404 rows / 1.4 MB, of which about 1,107 are VT lines. S&M 1,078 rows / 65 KB.

## Constitution Check

| Principle | How this plan holds it |
|---|---|
| I Engine decides | All VT maths in `nicks_code/vt-engine.js`, driven by `VT_RULES` (inlined copy of `specs/vt_engine_rules.json`, drift guard `verify-vt-rules.mjs`, dated `_changes[]`). Worker and pages only carry and paint verdicts. The merge logic lives ONLY in the engine; SQL applies the rows it computed. |
| II Absence ≠ nought | Cancelled "—"; no target → unmeasured; < 5 cases → shown, not scored; empty-cycle payload has null figures. |
| III Agent List is the record | VT org read from the roster of record (`/api/roster` + new read-only `vt_roster_at()`); no second list ingester; unmatched flagged. |
| IV Like for like | Targets per sub-campaign × tenure (the list's own cells; the Sales Review budgets per tenure). No cross-agent ranking. |
| V Locked down | New tables: RLS on, no policies, privileges revoked from anon/authenticated. New functions: EXECUTE revoked (re-assert of migration-049). Routes are staff-only or portal-scoped in the Worker. PII dropped in the browser. |
| VI Saves | CAS on `vt_book_rev`; retry ×3; persistent banner; staged uploads abandoned after 1 day; receipts visible. |
| VII Guards | Oracle + unit suites written first (Phase B, RED); VAS suites run before and after. |

## Project Structure

```text
specs/071-vehicle-tracking-analytics/   spec.md · plan.md · tasks.md · rules-draft.json
specs/vt_engine_rules.json              NEW  the VT rule book of record (from rules-draft.json)
nicks_code/vt-engine.js                 NEW  pure engine (UMD: window.VTEngine / module.exports), ≤ 800 lines; split
                                             vt-engine-parse.js if it grows past that
nicks_code/vt-pages.js                  NEW  VT report pages + export for PULSE (≤ 800 lines)
agent/vt-view.js                        NEW  VT card + VT reports for Agent Analytics (≤ 800 lines)
worker/src/vt.mjs                       NEW  VT routes: book, upload begin/stage/commit/abandon, receipts, portal scopes
supabase/migration-071-vt-facts.sql     NEW  vt_* tables, RPCs, grants, trim
supabase/migration-072-vt-roster-read.sql NEW read-only vt_roster_at() + partial index on agent_list_raw
supabase/migration-073-agent-list-raw-retention.sql  NEW (optional, owner-approved) retention for non-roster sheets
tools/vt-grant-tabs.mjs                 NEW  dry-run-first grant of VT tabs to former `tracker` holders
tools/vt-db-size.mjs                    NEW  read-only size/row report for vt_* (feeds verify + health)
nicks_code/diagnostics/verify-vt-*.mjs  NEW  suites (§T)
MODIFIED: nicks_code/index.html, agent/index.html, Chatterbox_AgentOS_Analytics.html, tools/prepare-site.js,
          site/auth-gate.js, site/_headers, worker/src/{index,rules,portal,campaign,health}.mjs, tools/audit-permissions.mjs,
          tools/digest-republish.mjs, tools/upload-station-validate.mjs, .github/workflows/verify.yml, CLAUDE.md
DELETED:  tracker/index.html, tracker/vt-mtd-report.html
```

### How a separate engine file coexists with "single file, runs from file://" (D1)
The source pages load companions with a relative classic script tag:
`<script src="vt-engine.js" data-inline></script>`. A classic `<script src>` relative to the page **works from `file://`**
(unlike `fetch` or modules), so opening `nicks_code/index.html` from disk still runs the VT engine. `tools/prepare-site.js`
gets **one generic inliner**: every `<script src="X.js" data-inline>` in `nicks_code/index.html` and `agent/index.html` is
replaced by `<script>/* inlined X.js */…</script>`. Each deployed shell is therefore one file with one build id. A cached
companion can never be a different build from its page (the stale-guard stays truthful), and the CSP is unchanged
(`'unsafe-inline'` is already required). The inliner fails the build if a tagged file is missing. Node tests `require()` the
same file. The repo has no such pattern today (prepare-site copies only `index.html`), so this is the smallest new one.
`verify-vt-build.mjs` proves it: the built shell has no `data-inline` tag left, the file:// page exposes `window.VTEngine`, and
the build id is consistent.

## §DB · Database design (D12)

### DB-1 · Decision: tables, current state per case, events only for changes
The VT book is small and keyed, and it is updated by case every day. That suits a table, not a KV blob. A blob (`kv:vt-state`)
would be rewritten whole on every upload. It would need compare-and-set on the whole thing, and it would grow without a trim
point. **There are no daily snapshots of anything**: the open-cases lesson (a ~490k-row book stored per day, 14.1M rows /
4.66 GB, the storage check failing, `tools/open-cases-trim.mjs`) is designed out from the start. Each file updates the
current row of each case it carries and appends one event per actual status change. The raw file is not stored (it holds
customer PII and the facts tables are the record). Its hash and receipt are stored instead.

Patterns reused, not reinvented:
- **Staged upload with begin / stage / commit / abandon** = the in-page Rake (`rake_page_*`, migration-042).
- **Atomic, row-locked single-statement apply** = `upload_manifest_add` (migration-024).
- **Grants** = migration-049 (revoke from public/anon/authenticated + default privileges). Re-asserted explicitly in 071 and
  tested, because `create or replace` has re-granted EXECUTE before.
- **Size and dead-row watch** = `db_health()` (read by `worker/src/health.mjs` 545) plus the weekly vacuum (Sunday 03:30 SAST).
  The `vt_*` tables are added to what it reports. No new vacuum job.
- **Duplicates handled by the database** = unique keys (case PK, upload hash) instead of `dedupe_lake()`. The VT tables cannot
  hold semantic twins by construction, so `dedupe_lake()` is not extended.
- **Partitioning (pg_partman, migration-027) is NOT used.** At about 3k cases and 9k events per business month the tables stay
  under 0.5M rows for years. Partitioning would add maintenance for no gain. Revisit above 5M event rows.

### DB-2 · Tables (migration-071)

**`vt_cases`**: one row per sale (current state).

| column | type | null | notes |
|---|---|---|---|
| `case_number` | `bigint` | PK | `check (case_number between 1 and 999999999999)`; S&M C / BI AS |
| `status` | `text` | no | `check (status in ('scheduled','missed','fitted','cancelled'))` |
| `status_on` | `date` | no | extract date that set the status |
| `sold_on` | `date` | yes | sale day (FR-014); null = opening book without a date |
| `sold_basis` | `text` | no | `first_seen` · `opening_book` · `unknown` |
| `first_seen` / `last_seen` | `date` | no | extract dates |
| `appt_on` | `date` | yes | S&M Fitment Date (latest) |
| `fitted_on` | `date` | yes | BI Installation Date (else Contract Create Date) |
| `sm_attempt` | `text` | yes | S&M Status (New / 1st attempt …) |
| `products` | `text[]` | no | Product Type / Unit Type set, e.g. `{MXV}` |
| `bundle` | `text` | yes | BI Product Bundle / S&M Bundle Name |
| `charge_ex` | `numeric(10,2)` | yes | Σ Charge Amount (X) of VT lines, ex VAT |
| `partner_raw` | `text` | yes | Source Partner verbatim |
| `lead_source` | `text` | yes | folded: `revx`·`tracking_empire`·`jag`·`afrilead`·`predictive`·`referral`·`sales_enablement`·`other` |
| `seller_name` | `text` | no | normalised Salesforce display name (staff, not customer) |
| `seller_cb` | `text` | yes | resolved CB; null = unmatched |
| `seller_match` | `text` | no | `exact`·`alias`·`near`·`first_last`·`unmatched` |
| `last_upload` | `bigint` | no | FK → `vt_uploads(id)` |
| `rev` | `bigint` | no | book revision that last wrote the row |
| `updated_at` | `timestamptz` | no | default now() |

Indexes, each tied to the query that needs it:
- `vt_cases_pkey (case_number)`: upsert and merge.
- `vt_cases_open_idx (appt_on) where status in ('scheduled','missed')`: `vt_book()` open cases; Hrs Ahead; Due to fit.
- `vt_cases_last_seen_idx (last_seen)`: `vt_book(p_from)`, the in-play window (cases touched since the period start).
- `vt_cases_sold_idx (sold_on)`: Current sales of a period; trim.
- `vt_cases_fitted_idx (fitted_on) where fitted_on is not null`: fitments done in a window.
- `vt_cases_seller_idx (seller_cb, sold_on)`: per-agent audit reads (`tools/`, support). Reports do not need it (they read the digest).

No index on team leader or sub-campaign. Those are **not stored on the case**: they come from the Agent List in force each
business month (the whole-month rule), so storing them would freeze an attribution the list is allowed to rewrite. Reports
read the published digest, which is already aggregated by TL, sub-campaign and lead source.

**`vt_case_events`**: status changes only.

| column | type | notes |
|---|---|---|
| `case_number` | `bigint` | FK → `vt_cases` on delete cascade |
| `on_date` | `date` | extract date |
| `from_status` | `text` | null for a new case |
| `to_status` | `text` | same check as `vt_cases.status` |
| `appt_on` | `date` | appointment date at that moment (missed-appointment day) |
| `upload_id` | `bigint` | FK → `vt_uploads` |
| PK | `(case_number, on_date, to_status)` | idempotent re-apply |

Index `vt_case_events_on_idx (on_date)` serves Daily/Weekly activity (Missed appointments, Fitments done) and the trim.

**`vt_uploads`**: the receipt and manifest.

| column | type | notes |
|---|---|---|
| `id` | `bigserial` PK | |
| `sha256` | `text` unique | `check (sha256 ~ '^[0-9a-f]{64}$')`; re-upload of the same bytes → `duplicate` |
| `kind` | `text` | `bi_fitted`·`sched_missed`·`opening_book` |
| `file_name` | `text` | |
| `extract_on` | `date` | from ddmmyy in the name, else today SAST (warning) |
| `cycle_key` | `text` | `cycle-YYYY-MM` of `extract_on` |
| `state` | `text` | `staging`·`committed`·`abandoned` |
| `counts` | `jsonb` | rows, vt_lines, cases, new, to_fitted, to_missed, to_scheduled, skipped_footer |
| `unmatched` | `jsonb` | `[{name, cases}]` (staff names) |
| `warnings` | `jsonb` | `[text]` |
| `quiet_day_ack` | `boolean` | FR-006 override |
| `uploaded_by` | `text` | session user |
| `started_at` / `committed_at` | `timestamptz` | |
| `rev_after` | `bigint` | book revision after commit |

Index `vt_uploads_kind_extract_idx (kind, extract_on desc) where state='committed'` serves the thin-pull guard ("last BI of
this cycle") and the receipts list.

**`vt_upload_stage`**: transient rows of an upload being staged. Columns `upload_id bigint` (FK, cascade), `ord int`,
`kind text` (`case`|`event`), `row jsonb`, PK `(upload_id, kind, ord)`. It is deleted at commit or abandon. Rows older than 1
day are purged by `vt_trim()`.

**`vt_book_rev`**: a single-row counter (`id smallint primary key check (id=1)`, `rev bigint not null`, `updated_at`). Commit
locks it `for update`. This is the compare-and-set base.

### DB-3 · Functions (all `security invoker`, called by the Worker with the service key; EXECUTE revoked from public/anon/authenticated)
- `vt_book(p_from date) returns jsonb`: **one value**, `{rev, cases:[[case_number,status,status_on,sold_on,sold_basis,
  first_seen,last_seen,appt_on,fitted_on,products,charge_ex,lead_source,seller_name,seller_cb,seller_match], …], events:[[…]]}`.
  It returns cases with `last_seen >= p_from` or an open status, plus events with `on_date >= p_from`. It is a single
  `jsonb_agg` statement over indexed predicates, so it is not paged and stays far under 8 s. Measured target: < 300 ms for 20k
  cases.
- `vt_upload_begin(p_sha256, p_kind, p_file_name, p_extract_on, p_user) returns jsonb`: returns `{id}`, or
  `{duplicate:true, id, committed_at}` if the hash is committed. It reuses a `staging` row with the same hash (a retry).
- `vt_upload_stage(p_id, p_kind, p_from_ord, p_rows jsonb) returns int`: inserts a batch (≤ 1,000 rows, ≤ 512 KB) with
  `on conflict do nothing`, so a retried batch is idempotent.
- `vt_upload_commit(p_id, p_base_rev, p_counts, p_unmatched, p_warnings, p_quiet_ack) returns jsonb`: in **one transaction**
  it locks `vt_book_rev`, and if `rev <> p_base_rev` it raises `version_conflict` (the Worker answers 409). Otherwise it upserts
  staged case rows (`insert … on conflict (case_number) do update` with the engine-computed values), inserts staged events
  (`on conflict do nothing`), increments `rev`, marks the upload committed, deletes its stage rows, and returns
  `{rev, cases, events}`. Re-committing a committed id returns the stored result (idempotent).
- `vt_upload_abandon(p_id)`: marks it abandoned and deletes its stage rows.
- `vt_trim(p_keep_cycles int default 13) returns jsonb`: deletes events and abandoned uploads older than 13 business months.
  It deletes `vt_cases` rows whose `last_seen` is older than 13 business months **and** whose status is terminal (fitted) or
  stale. It purges stage rows older than 1 day. It returns the counts. It is called weekly from the existing health cron
  (Sunday slot), and it logs into the health tick log.
- `vt_db_size() returns jsonb`: row counts and `pg_total_relation_size` per `vt_*` table, for `tools/vt-db-size.mjs` and
  `db_health`.

**No merge logic in SQL.** The functions apply what the engine computed and enforce only keys, checks, idempotency and the
revision. The precedence rules therefore exist once (`VTEngine.merge`), and the oracle tests that one copy.

### DB-4 · What is stored and what is discarded (PII)
| File | Stored (into `vt_cases` / events) | Discarded in the browser (never sent) |
|---|---|---|
| BI Active Fitted | Case Number, Unit Type (Y), Product Bundle, Charge Amount (X; AD checked equal), Installation Date, Contract Create Date, Created By (normalised), Source Partner | Account Number, Account Name, Contract Number(s), Subscriber Type, Owner, Fitment_Case_Created_By, LastModifiedBy, Asset Make/Model, Vehicle Reg Number, Box Number, Chassis Number, FleetNumber, Device_Status, Consultant, Group, Sales Vertical, Region, Area Manager, Account Region, Fitment Partner/Centre, Source Partner Account Number, Previous_Source_Partner, Charge Code, and all non-VT rows (about 18,300 VAS lines) |
| Scheduled & Missed | Case Number, Product Type, Status (attempt), Bundle Name, Fitment Date, Created By (normalised), MissedAndScheduledFitment, Opportunity Source Partner | CaseID, Account Name, Duplicates Flag, Count of Case Number, **Mobile**, **Registration**, **Vehicle Chassis**, Type, Subscriber Type, Internal/External Consultant, Fitment Partner, Last Modified By |
| Opening book (optional) | Case Number → sale date only | everything else, incl. **Customer Contact**, Agent, GWP, Result, Scheduler, Referring Agent |

### DB-5 · Size and growth (from the sample files)
| Table | Rows per business month | Bytes per row incl. index (est.) | MB per month | After 13-cycle trim (steady state) |
|---|---|---|---|---|
| `vt_cases` | ~3,000 new (S/M/F/C mix; 2,024 rows in the report cover ~1.4 cycles) | ~380 | ~1.1 | ~39k rows, ~15 MB |
| `vt_case_events` | ~7,500 (≈ 2.5 changes per case: new→scheduled→(missed→scheduled)→fitted) | ~110 | ~0.8 | ~98k rows, ~11 MB |
| `vt_uploads` | ~45 (2 files × ~22 working days) | ~1,000 (jsonb receipt) | 0.05 | ~600 rows, < 1 MB |
| `vt_upload_stage` | transient (≤ ~2,000 rows during one commit) | — | 0 | 0 |
| **Total** | | | **≈ 2 MB / month** | **≈ 27 MB** (vs the 4.66 GB incident) |

A daily VT upload writes only changed rows. A typical day is about 150 new cases plus about 200 status changes. Most days the
upsert therefore touches a few hundred rows, and dead tuples stay small; the weekly VACUUM (ANALYZE) is enough. `SC-005`
checks the monthly growth against these estimates through `vt_db_size()`.

### DB-6 · Security
- `alter table … enable row level security` on all five tables, with **no policies** (deny by default to anon/authenticated).
  `revoke all on table … from public, anon, authenticated`.
- Every new function: `revoke execute on function … from public, anon, authenticated` (explicit, in 071 and 072), on top of
  migration-049's default privileges. `verify-vt-db.mjs` checks `has_function_privilege('anon', …)` and
  `has_table_privilege('anon', …)` = false for every `vt_*` object, and repeats the floor-wide anon-EXECUTE audit (memory: the 22 Sep check).
- Only the Worker (service key) calls the RPCs. Routes: `vt/book`, `vt/upload/*` need a staff session with the upload grant
  (`canUpload`, `vas:data`). Portal routes read the digest only. No browser ever holds a Supabase key (CSP unchanged).

### DB-7 · Existing tables the VT work reads (separate, scoped migrations)
1. **`agent_list_raw`** (migration-020): the VT sub-campaign (`campaign_raw`, e.g. "Matrix Vehicle Tracking - Digital") exists
   only here. PULSE's roster discards it (`INGEST.roster` 3213). **Migration-072** adds
   `vt_roster_at(p_on date) returns jsonb` (rows `{code, name, tl, sub, tenure, target, start_date, as_of}` from the latest
   accepted snapshot with `as_of <= p_on` and `campaign='VT'`). It also adds the partial index
   `agent_list_raw_vt_idx on agent_list_raw (as_of desc) where campaign = 'VT' and accepted`. It is read-only and touches
   neither `publish_agent_list()` nor any `sync_*` function, so the roster of record is untouched. `target` is null for "-"
   (the publish parse). The engine treats ≤ 0 or null as "no target".
2. **`agent_list_raw` growth (review, optional migration-073)**: every list upload stores every row of every sheet, including
   the hidden HR sheets (`Reg List` 969 rows, `Sheet1` ~1,023), so about 2.3k rows per upload. Task F6 measures it read-only
   (`tools/vt-db-size.mjs --agent-list-raw`). Only if it exceeds 250k rows does it propose migration-073 (keep non-roster-sheet
   rows 90 days, roster-sheet rows forever), dry-run first, owner-approved. It is never applied by a builder.
3. **`rules` (KV rows)**: digest keys are primary-key reads, so no index is needed. A VT history key over the in-row threshold uses
   the existing `value.store` → Storage path (`verify-kv-large-store`). Estimated VT digest about 200 KB raw / 30 KB gzip, under the
   threshold.
4. **`usage_events`**: the `'tracker'` CHECK value stays (history). New VT page opens log as app `vas` (no constraint change).
5. **`daily_eod`**: left in place, dormant (D9). No migration.

## §P · Store keys and payload shapes

| Key / route | Writer | Shape | Size estimate |
|---|---|---|---|
| `kv:vt-digest` | PULSE (staff) | the current business month's digest | ~200 KB raw, ~30 KB gzip |
| `kv:vt-digest-cycle-YYYY-MM` | PULSE / `digest-republish.mjs` | same, frozen per business month | same |
| `GET /api/vt/book?from=` | Worker streams `vt_book` | DB-3 | ~0.6 MB (≈ 5k cases × 120 B) |
| `POST /api/vt/upload/{begin,stage,commit,abandon}` | PULSE | RPC args JSON passed through unparsed | stage ≤ 512 KB per call |
| `GET /api/vt/uploads?limit=20` | Worker | receipts | < 30 KB |
| `GET /api/portal/vt/overview`, `/api/portal/vt/agent`, `/api/portal/tl/reports?kind=vt-mtd|vt-weekly|vt-daily` | Worker | scoped slices of the digest | < 50 KB |

Digest (`VTEngine.digest`):
```
{ scorecard:'vt', version, period:{key:'cycle-2026-11', from:'2026-10-26', to:'2026-11-25', asOf:'2026-11-10', hrsAsAt:'2026-11-11'},
  empty:false, updatedAt, rulesVersion, workingDays, workingDaysElapsed, weeks:[{from,to,label}], dates:[…],
  drivers:[{k,label,w,dir,note}],                  // once, not per agent (VAS lesson: 176 KB saved)
  agents:[{ code, name, tl, tlCode, sub, tenure, role, target, rated,
            mtd:{sales,current,rollover,fitted,scheduled,missed,cancelled:null,fitRate,missRate,schedRate,
                 fitDone,missAppt,due,spd,toTarget,value},
            weeks:[{k, …same counts}], days:[{d, …same counts}],
            leads:{revx:{…},…},                     // lead-source split of mtd
            rating:{score,adj,band,nextBand,parts:[{k,value,target,measured,shown,att,points,available,onTarget,note}],
                    weightScored, window:{from,to}, budgetCycle, unmeasured:[…], weakest} }],
  notRated:[{code,name,tl,sub,why:'scheduling'|'nodata'}],
  tlAgg:[{tlCode,tl,sub[],mtd,weeks,days,hrsAhead:{h24,h48,h72,h72p,past,share{…}}}],
  subAgg:{digital:{…},predictive:{…},referral:{…},scheduling:{…}}, leadAgg:{…},
  floor:{mtd,weeks,days,hrsAhead,unmatched:{sellers:n,cases:n,names:[…staff names, staff-only field]}},
  budgets:{cycle:'cycle-2026-11', fitment:{…}, missed:0.05, hrsShare:{…}} }
```
`floor.unmatched.names` is stripped by the Worker for portal (non-staff) scopes.

## §RB · Rule book `specs/vt_engine_rules.json` (schema; first full draft = `rules-draft.json`)
Top level: `_source`, `_generated`, `_changes[]` (dated `{date,by,key,from,to,why}`), `version`, and:
- `detection`: per kind, `{requireHeaders[], beforeRules[], sheetName?, footerPattern, filenameDate}`.
- `vtUnitTypes[]`, `unitTypeColumn` ("first Unit Type, column Y").
- `status`: `{sameExtractPrecedence[], terminal[], sticky:true, olderExtractMayChangeStatus:false, cancelledFrom:null}`.
- `identity`: `{stripSuffixes[], firstLastTokenFallback:true, scope:'VT'}`.
- `leadSources`: partner → key map, `{panimaxNewSales:{referralIfTeam:'referral', else:'predictive'}}`, groups.
- `teams`: sub-campaign parse from `campaign_raw` (`/^Matrix Vehicle Tracking - (.+)$/`), `scheduling` role.
- `periods`: `{periodStartDay:26, cycleKeyBy:'end-month', weekStart:'Mon', weekEnd:'Sat', workingDays:'Mon-Fri-not-holiday',
  hrsAheadAsAtOffsetDays:1, hrsAheadBuckets[]}`.
- `guards`: `{thinBiShare:0.9, thinSmShare:0.4}`.
- `vat` (must equal `MTD_RULES.vat`; checked).
- `reports.columns[]`: id, label, formula id, date basis (spec §5).
- `rating`: `{floor:0.5, window:'cycle-to-date', minCases:5, minTrackedDays:5, drivers[{k,label,w,dir,target,note}], bands[]}`.
- `budgets`: `{ "cycle-2026-11": {fitment:{digital:{'*':0.85}, referral:{'*':0.85}, predictive:{Exp:0.8,M2:0.75,M1:0.7}},
  missed:{'*':0.05}, cancelled:{'*':0.05}, hrsShare:{h24:0.8,h48:0.1,h72:0.05,h72p:0.05}, _cells:{…} } }`, plus
  `budgetFallback:'latest-earlier-cycle'`.

Drift guard `verify-vt-rules.mjs`: `VT_RULES` inlined in `vt-engine.js` equals the JSON's operative subset field by field.
`vat` equals `MTD_RULES.vat`. Each budget carries a `_cells` reference. No literal 0.85 / 0.05 / 26 appears in
`vt-engine.js` outside `VT_RULES`, nor in `agent/vt-view.js` (the `verify-rule-constants` pattern).

## How VAS isolation is guaranteed
1. **Separate stores**: VT never writes `vas-state`, `S.*` VAS stores, the BI money store, the relay or the lake. `verify-vt-isolation.mjs`
   loads the three VT files into a PULSE station holding a fixed VAS fixture and asserts `kv:vas-state` is byte-identical,
   `S.files` holds no VT entry, and `/api/upload-archive` and `/api/upload/large/*` were not called.
2. **Detection order**: the VT rules run before `bi`/`inactive`. Regression in `verify-upload-formats` (+ a VAS BI file is still `bi`).
3. **Ops guard**: Ops `detectSource` refuses VT signatures (and the relay never carries them).
4. **Separate engine**: `vt-engine.js` reads only its own inputs plus a read-only roster/calendar handed to it. PULSE's
   `buildModel`, `MTD_RULES`, `COMPOSITE_RULES` are untouched (the hidden "Matrix Tracker" branch stays; only its filter option is hidden).
5. **Separate digest and scopes**: `kv:vt-digest*` only. Portal VT routes are new. Existing VAS routes change only where a VT
   agent previously received an empty VAS card (the `notReported` fix), and where `campaign.mjs` drops `vt` (now: keep it only
   when a VT digest exists, for VT cards only).
6. **Proof**: SC-003 suites before and after, plus golden VAS overview bodies (`verify-vt-vas-golden.mjs`).

## §R · Removal plan (D9)
(a) **Remove**: `tracker/index.html`, `tracker/vt-mtd-report.html` (seed with real first names). `prepare-site.js`: the
`['tracker','tracker','Tracker Analytics']` tuple (252), the `VT_REL` block (263–269), `'tracker/index.html'` in the shell list
(280), the comment at 245. `site/_headers` line 4 comment. `site/auth-gate.js` 6 (`/tracker` → `tracker` branch) and the `tracker`
entries in `NAMES`/`PATHS` (324–325). Ops app-switcher option (441). PULSE app-switcher option (6573) and the comment at 10059
("or Tracker Analytics"). Worker `MANAGEMENT_APPS` loses `'tracker'` (539). Worker AI prompt text that describes the Tracker app
(index.mjs 61, 72) and the `ai-digest-tracker` context pull (2545, 2555–2566, 2646). CLAUDE.md layout row for `tracker/`.
Re-check every line number before editing.

(b) **Keep**: every item in current-state list (b): `campOf` VT fold, VT sheet fold, per-campaign roster replace,
`reportedCampaigns`, `offCampaign`, VAS exclusions, the VAS hand-built tracker (`trackerDaily`, `S.tracker`), Ops `campBucket`/QA
tile, A1/A3, W7/W8 (they change in Phase E, they do not go), W9, migrations, tools, and diagnostics protecting VT roster rows.
"tracker" is overloaded: **never remove by grep**.

(c) **Left in place, with reason**:
| Item | Decision | Reason |
|---|---|---|
| `daily_eod` table, `/api/eod` GET/POST, `GATED_WRITES` entry, portal block | left, dormant | D9: no data deleted; route harmless without its page |
| `usage_events` CHECK `'tracker'`, `usage.mjs` labels | left | history; applied migration |
| PULSE hidden VT branch in `buildModel` / `aggCols({vt:true})` | left untouched | guarded by `verify-engine-rules`; changing it risks VAS |
| PULSE `gFilter` "Matrix Tracker" option (6680–6684) | **hidden** | it shows dialler-disposition VT sales that would contradict the new VT figures (one number, one verdict). No engine change |
| `MTD_RULES.actualShiftsFrom.VT:'register'` | left | VT module uses no shifts; drift-checked; harmless |
| `app_users.tabs.tracker`, `apps` containing `tracker` | data left; superseded | `tools/vt-grant-tabs.mjs` adds `vas` + VT tabs for every holder (dry run → owner applies at deploy); the stale `tracker` entries remain inert |
| `verify-agent-analytics` "no link to /tracker/", `verify-agent-portal` "/api/eod blocked" | left | still true, still useful |

Grants: `tools/vt-grant-tabs.mjs` lists, read-only, every `app_users` row whose `apps` holds `tracker`, plus every VT team leader
and VT CM. It prints the proposed `apps += 'vas'`, `tabs.vas += ['vt_mtd','vt_weekly','vt_daily']` (never removing anything). With
`--apply` (owner only, at deploy) it writes. It runs **before** the deploy that drops `tracker` from `MANAGEMENT_APPS`, so no
account silently becomes portal-only.

## §T · Testing strategy (tests first)
| Suite | What it proves | Data |
|---|---|---|
| `verify-vt-oracle.mjs` | Feeds the three sample uploads through `VTEngine` (Node). 1,756/1,756 case statuses equal the report Result. Fitted 1,104 / Missed 153 / Scheduled 499. Per-seller F/S/M equal the report rows restricted to the same cases and the same credited agent. Lead-source fold equals the report's Campaign/Partner on every case whose Salesforce partner is unambiguous. Restricted pivots (PD VT Campaign / Lead Gen / Predictive / Referral on agreeing rows) equal exactly. Hrs Ahead 499/499 (as-at 11 Nov). Unmatched = 8 names, 49 BI + 17 S&M cases. CB342 resolves by near-spelling. The 7 that should be unmatched stay unmatched. | reads `../reference/zips/vt/` at run time (outside git); **skips with a notice if absent**; prints CBs only |
| `verify-vt-engine.mjs` | Unit: detection signatures (incl. a VAS BI file is never VT and vice versa), footer skip, filename date, precedence within and across extracts, sticky, older-extract rule, first-seen sale day, opening book, thin guards, PII columns never in output | fictional fixtures (CB91xx) |
| `verify-vt-periods.mjs` | cycle keys (26th rollover, Dec→Jan), Mon–Sat weeks clipped, working days with SA holidays (byte-identical calendar), Hrs Ahead buckets incl. past due | synthetic |
| `verify-vt-rating.mjs` | the spec §6 worked example to the decimal; renormalisation; lower-is-better; min cases; no target; bands; budget fallback | fictional |
| `verify-vt-rules.mjs` | drift guard (above) + no literals | files |
| `verify-vt-db.mjs` | migrations 071/072 in a rolled-back transaction: begin/stage/commit, duplicate hash, CAS conflict, idempotent re-commit and re-stage, trim, grants (anon/authenticated denied), `vt_book` shape and < 300 ms at 20k cases | local/test DB |
| `verify-vt-isolation.mjs` | VAS state byte-identical, no relay, no Rake, Ops refusal (Playwright) | fixtures |
| `verify-vt-station.mjs` | real-browser Upload Station: receipt, dedupe toast, thin refusal, conflict retry banner, VT pages render, filters reach MTD/Weekly/Daily, export sheets equal the screen | stubbed Worker |
| `verify-vt-digest.mjs` | digest shape, fence (live = SAST business month + grace, empty never over data), GUARDED keys staff-only | stubbed Worker + unit |
| `verify-vt-worker.mjs` | `vt.mjs` routes, scopes (agent own CB, TL own team, CM VT scope), unmatched names stripped for portal, CPU timing on a 0.6 MB book stream | in-process Worker |
| `verify-vt-portal.mjs` | VT agent → VT card (no VAS drivers or calculator); scheduler message; no-data month; `notReported` fix; TL VT reports + export; CM VT card | Playwright, fictional |
| `verify-vt-vas-golden.mjs` | VAS agent/TL/CM overview bodies byte-identical to the pre-feature golden | fixture |
| `verify-vt-build.mjs` | inliner, file:// load, build-id consistency, no `site/tracker/` | build |
| existing (before AND after) | SC-003 list + `verify-upload-formats`, `verify-tab-guard`, `verify-server-grants`, `verify-rule-constants`, `verify-save-acks`, `verify-wimpy-removal`, `verify-wimpy-service-drift` | as today |

## Risks
1. **BI Active Fitted overwriting VAS money.** It shares the VAS BI headers. Mitigation: detection order + Ops refusal + Rake
   refusal + `verify-vt-isolation`. Highest impact; addressed in Phase C before any page exists.
2. **No sale date in the files.** Sale day is inferred from first appearance (F8). One missed daily upload shifts that day's sales
   to the next upload's date. Mitigation: the receipt shows "days since last S&M", and a gap > 1 working day raises a warning and
   a health alert. Optional opening book for go-live (A6).
3. **Go-live month is partial** (A6): TA unmeasured for the first 5 tracked days unless the opening book is loaded.
4. **Attribution disagreements with the hand report** (11 manual credits, ~5 % partner relabels). The engine follows Salesforce
   and the Agent List. The oracle documents the exact differences, so they are never "fixed" toward the hand sheet.
5. **Shared-file collisions between builders**: see the phase/file matrix in tasks.md. PULSE, prepare-site and index.mjs are
   touched by several phases, which must run in order.
6. **Grant removal**: dropping `tracker` from `MANAGEMENT_APPS` before the grants are applied would make tracker-only managers
   portal-only. The deploy checklist orders it.
7. **Engine/page size**: PULSE is 11,107 lines. All VT code goes in companion files, and PULSE gains only hooks (< 150 lines).
8. **Budgets per cycle** must be entered for each new business month (Sales Review). Fallback = latest earlier cycle, and the
   card says which cycle. A health warning fires when the live cycle has no budget row.
9. **Supabase function grants re-opened by `create or replace`**: explicit revokes + a test that fails on any anon EXECUTE.

## Complexity Tracking
| Deviation | Why needed | Simpler alternative rejected because |
|---|---|---|
| Companion `.js` files + build inliner | keep PULSE/Agent Analytics from growing past their ceilings while staying file:// and single-file deployed | inlining by hand into PULSE adds ~2,000 lines to an 11k-line file; a plain separate deploy file risks build skew |
| New tables instead of a KV blob | owner's D12; per-case upsert, trim, no snapshots | a blob is rewritten whole per upload, has no trim point, and races |
| Business-month digest fence (26th–25th) instead of the calendar month | every VT budget and the report are on the 26th cycle (F2) | a calendar-month VT digest would never match a Sales Review figure |
