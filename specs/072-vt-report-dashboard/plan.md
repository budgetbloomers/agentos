# Implementation Plan: VT Report — consolidated Vehicle Tracking dashboard (072)

## Summary

One new page, `vt_report`, first in the Vehicle Tracking NAV group, that paints the whole of the owner's master workbook from the VT book. Nothing about it is new architecture: the engine already keys cases, resolves sellers, derives status and cancellation, computes the business month, the weeks, the working days and the lead-time buckets. 072 adds **three unique facts** the daily exports do not carry (Scheduler, GWP, true sale date) through a **new upload slot that replaces the retired opening book**, **one extra lead-time bucket** (display only), **the workbook's cycle budgets** in the rule book with their Sales Review cells, **four view definitions**, and a **pure dashboard model function** the page and the `.xlsx` export both paint from.

Rule book goes `vt-1.3` → **`vt-1.4`**. One new migration, **073**. No change to the agent rating, the digest fence, the VAS side, or any figure on the three existing VT pages except one table gaining a column.

## Technical Context

- **Language / runtime**: browser ES2019 in `nicks_code/*.js` companions loaded as `<script src="X.js" data-inline>` (works from `file://`, inlined at build by `tools/prepare-site.js`); Node 24 for the diagnostics suites; Cloudflare Worker modules for the intake.
- **Engine**: `nicks_code/vt-engine.js` (878 lines) — pure, no clock, no DOM, UMD. `VT_RULES` inlined between `/* @vt-rules start */` markers; `verify-vt-rules.mjs` fails on drift and on a rule literal outside that block.
- **Storage**: Postgres tables, not a blob (migration-071): `vt_cases`, `vt_case_events`, `vt_uploads`, `vt_upload_stage`, `vt_book_rev`; begin / stage / commit / abandon with compare-and-set on `vt_book_rev.rev`.
- **Transport**: `worker/src/vt.mjs` — `GET/POST /api/vt/book`, the four `/api/vt/upload/*` steps, `GET /api/vt/uploads`, `GET /api/vt/roster`. 512 KB per stage call, 1000 rows per call.
- **Constraints**: Cloudflare FREE plan — 10 ms CPU per Worker request and 50 subrequests, so all maths stays in the browser/engine; CSP `script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com`; the apps must run from `file://`.

## Constitution Check

| Non-negotiable | How 072 complies |
|---|---|
| 16 · VT is its own module; BI Active Fitted is VT, never VAS BI | No VAS file, store or page is touched. The new upload is detected by **sheet name + headers alone** (`Schedulers Data`), which no VAS export has, so the BI name-hint incident cannot recur here. `verify-vt-isolation` re-run. |
| 16 · the rule book is `specs/vt_engine_rules.json`, operative copy inlined | Every new value lands in both, with a dated `_changes[]` entry per key. First draft is `rules-draft.json` beside this plan. |
| 16 · the engine decides, every page paints | New pure `VTEngine.dashboard()`. The page holds no arithmetic and no threshold. |
| 16 · digest is a business month, 26→25 | Unchanged. The dashboard's cycle **is** `cycle-YYYY-MM`; the previous-cycle delta reads the already-frozen `kv:vt-digest-cycle-*`. |
| 16 · which scorecard / the rating | **Untouched** (D2, FR-033). |
| 6 · an absence is not a nought | Missing previous cycle → "—"; missing Schedulers Data → "needs the upload"; a case with no GWP → "—". Never 0. |
| 12 · a rule must be READ, not copied | The dashboard budgets are read through one accessor (`cycleBudgetFor`), as `MTD_VAT` is; `verify-vt-rules` asserts no literal. |
| 12 · one number, one verdict | The integrity checks and the OK/CHECK verdicts are computed in the engine and travel as verdicts; the page prints them. This is also the core of D5. |
| 14 · a save must be acknowledged | The new upload rides the existing receipt + dirty-state + retry machinery in `vt-pages.js` / `vt-publish.js`; no new persistence path. |
| 10 · PII | `Customer Contact` joins `columns.discardAll`. Staff names are kept exactly as sellers already are. |
| "new pages need tab grants" | `vt_report` added to `tools/vt-grant-tabs.mjs` and `tools/audit-permissions.mjs`. |

## Project Structure

### Documentation (this feature)

```
specs/072-vt-report-dashboard/
├── spec.md               the specification (written)
├── plan.md               this file
├── tasks.md              dependency-ordered phases
├── rules-draft.json      draft 1 of the vt-1.4 rule-book additions
├── deploy-checklist.md   (Phase E) the suites to run + the deploy order
└── floor-guide.md        (Phase E) what the floor reads on the page
```

### Source code (files to create / modify)

| Path | New? | Change |
|---|---|---|
| `specs/vt_engine_rules.json` | modify | `vt-1.4`: `views`, `channels`, `cycleBudget`, `dashboardHrsShare`, `forecast`, the 5th bucket, `detection.vtSchedulers`, `columns.schedulers`, `insights` |
| `nicks_code/vt-engine.js` | modify | inlined `VT_RULES` to match; `parseSchedulers()`; `merge()` accepts the new kind; `periods.hrsBucket` 5 buckets; new pure `dashboard()`; `cycleBudgetFor()`; `insights()` |
| `nicks_code/vt-dashboard.js` | **NEW** | the VT Report page: render, controls, the 20 panels, the `.xlsx` export. Loaded as a 5th `data-inline` companion. |
| `nicks_code/vt-charts.js` | **NEW** | the five chart forms this page needs, as inline SVG, theme-token only (see §CH) |
| `nicks_code/vt-pages.js` | modify | slot swap (opening book → Schedulers Data); `DB_KIND` / `LABEL`; ingest branch; the MTD Hrs Ahead table's 5th column |
| `nicks_code/index.html` | modify | NAV item `vt_report`; `PAGES.vt_report`; two `<script src data-inline>` tags; the new chart CSS + the validated series tokens |
| `agent/vt-view.js` | modify | `hrsTable` 5th column only |
| `worker/src/vt.mjs` | modify | accept `kind='schedulers_data'` on begin/stage/commit; nothing else |
| `supabase/migration-073-vt-schedulers.sql` | **NEW** | the `kind` and `sold_basis` check values, three columns on `vt_cases`, `vt_book()` columns |
| `tools/vt-grant-tabs.mjs`, `tools/vt-validate.mjs`, `tools/vt-verify.mjs`, `tools/audit-permissions.mjs` | modify | know the new page and the new file |
| `nicks_code/diagnostics/verify-vt-dashboard.mjs` | **NEW** | the page in real Chromium, both themes |
| `nicks_code/diagnostics/verify-vt-report-oracle.mjs` | **NEW** | SC-001 / SC-002 against the owner's workbook |
| `nicks_code/diagnostics/verify-vt-views.mjs` | **NEW** | the four views + the three integrity checks, pure |
| `verify-vt-rules / -periods / -engine / -pages / -digest / -portal / -station / -db / -validate / -build / -isolation / -oracle` | modify | the 5th bucket, the new kind, the new page |

## Data flow

```
Schedulers Data .xlsx (owner's workbook, 1.1 MB, 19,961 rows)
        │  dropped on the VT · Schedulers Data slot (PULSE, in the browser)
        ▼
VTEngine.detect(header, sheetName) → 'vtSchedulers'
VTEngine.parseSchedulers(aoa)      → 3,010 rows; 16,950 empty counted & skipped;
                                     Customer Contact and every other column DISCARDED
        ▼
VTEngine.merge(book, parsed, {extractOn, roster, …})
   · sets sold_on + sold_basis='schedulers_data', scheduler_cb/name, gwp_rpt, referring_cb
   · NEVER sets status  → counts the Result disagreements into `cancel`/`disagree`
        ▼
/api/vt/upload/begin → stage ×4 (1000 rows) → commit (CAS on vt_book_rev.rev)
        ▼
vt_cases (+3 columns)  ·  vt_uploads receipt  ·  vt_book_rev.rev++
        ▼
GET /api/vt/book?from=cycle.from   (the page already does this)
        ▼
VTEngine.model(book, roster, {asOf, cycleKey, …})        ← unchanged, feeds vt_mtd/weekly/daily
VTEngine.dashboard(book, roster, {cycleKey, view, prev}) ← NEW, pure, feeds vt_report
        ▼
VTPages / VTDash render(view)  →  HTML string  →  the same model → workbookFor() → .xlsx
        ▼
(unchanged) VTPublish.buildDigest → kv:vt-digest + kv:vt-digest-cycle-YYYY-MM
```

The **previous-cycle delta** is the one figure that is not derived from the book: `vt_report` reads `kv:vt-digest-cycle-<prev>` through the existing `GET /api/kv` path and takes five numbers off it. Absent → "—".

## §U · Where the Schedulers Data upload fits, and the opening-book migration (D1)

- **U-1 · It is the same file.** `detection.vtOpeningBook` already matched `sheetName: "Schedulers Data"` with headers `month, date, agent, case number, result`. 072 renames that detection key to **`vtSchedulers`** and widens `takeOnly` from `["case number","date"]` to `["case number","date","gwp","campaign/partner","referring agent","scheduler","result","date scheduled"]`. The rename carries a `_changes[]` entry; `verify-vt-rules` enforces both copies.
- **U-2 · The slot.** `LABEL.vtSchedulers = 'VT · Schedulers Data'`, `DB_KIND.vtSchedulers = 'schedulers_data'`. The *Opening book (once)* slot is **removed from `slotsHtml()`**; its description text is replaced by the new one ("The Schedulers Data sheet of the master VT report: the scheduler, the GWP and the true sale date for every case. Upload it whenever the master is updated — it may be re-uploaded as often as you like.").
- **U-3 · The old kind stays legal in the database.** `vt_uploads.kind` keeps `'opening_book'` in its CHECK (never edit an applied migration; historical receipts must still read), and migration-073 **adds** `'schedulers_data'`. `tools/vt-validate.mjs` recognises the new name and says the old slot is retired.
- **U-4 · Cases already dated by the opening book.** `sold_basis` gains `'schedulers_data'`, which **outranks** `'opening_book'` and `'first_seen'`. On the first Schedulers Data commit, every case present in the sheet takes column `B` as its sale date; the receipt reports `redated: {from_opening_book: n, from_first_seen: n, unchanged: n}`. A case the sheet does not carry keeps whatever it had. `sold_basis` is the audit trail, so the question "why did this case move months?" is a query, not an investigation.
- **U-5 · `trackFrom` does not move.** `vt_book_rev.opening_book_on` keeps its meaning (the day a sheet first supplied pre-upload sale dates) and is set by a Schedulers Data commit exactly as the opening book set it. So `model()`'s `trackFrom` logic, the working-day count and therefore **every published SPD and target-achievement figure stay as they are** — this is the one place a careless change would move an agent's score, and it is why `opening_book_on` is reused rather than replaced.
- **U-6 · Re-uploadable.** Unlike the opening book, which was once-only and refused on an empty book, Schedulers Data is idempotent: the merge is keyed by case number and simply re-states the three facts. The thin-pull guard still applies (`guardUpload`), and a file whose case count is under `thinSmShare` of the known book is refused with the existing quiet-day acknowledgement button.
- **U-7 · A duplicate case number inside one file rejects the whole file** (spec A2), in the pattern of `publish_agent_list`'s duplicate-CB refusal.

## §DB · Database (migration-073-vt-schedulers.sql — NEW file only)

- **DB-1** `vt_uploads.kind` CHECK: add `'schedulers_data'`, keep the three existing values.
- **DB-2** `vt_cases.sold_basis` CHECK: add `'schedulers_data'`, keep `first_seen | opening_book | unknown`.
- **DB-3** Three columns on `vt_cases`, all nullable: `scheduler_cb text CHECK (scheduler_cb ~ '^CB\d+$')`, `scheduler_name text`, `gwp_rpt numeric(10,2)`. Plus `referring_cb text` (the fourth fact, free) — `Referring Agent` is a staff name and the Agent & Scheduler Summary needs the dimension.
- **DB-4** `vt_upload_commit` and `vt_book` learn the new columns: the commit applies them when the staged row carries them (a BI or S&M commit sends them as `null` and must **not** blank an existing value — the merge sends only changed fields, so the SQL uses `coalesce(excluded.x, vt_cases.x)` for these four and keeps its existing semantics for everything else).
- **DB-5 · Size.** 3,010 cases × (scheduler_cb 6 B + scheduler_name ~20 B + gwp 8 B + referring_cb 6 B) ≈ **120 KB** on the book read, on top of the existing book. 13 business months retained by `vt_trim()` → under 2 MB. Negligible against the 4.66 GB open-cases incident's scale. The staged upload is 3,010 rows / 1000 per call = **4 stage calls**, each well under the 512 KB cap.
- **DB-6 · Security.** Same as 071: `security invoker`, `set search_path = public`, EXECUTE revoked from `public`/`anon`/`authenticated`, RLS on. No new function, no new grant. `verify-vt-db.mjs` runs 073 verbatim in PGlite.
- **DB-7 · No index needed.** Every read is the whole book by `sold_on >= from`, which already has its index.

## §P · Store keys and payload shapes

| Key / endpoint | Owner | Shape | Size |
|---|---|---|---|
| `GET /api/vt/book?from=` | existing | `BOOK_COLS` + 4 new columns | ~1.2 MB for a cycle (was ~1.1 MB) |
| `kv:vt-digest`, `kv:vt-digest-cycle-YYYY-MM` | existing | **unchanged in Phase A–C** | ~530 KB |
| `kv:vt-digest-cycle-<prev>` | read-only here | 5 numbers taken off it | — |
| `S.ui.vtReport` (per-person view state) | NEW, client | `{view, personDim, from, to, channel, campaign, pivot}` | < 200 B |

**The digest is deliberately not extended in this spec.** The dashboard is a PULSE page computing from the book, exactly as `vt_mtd` does; adding a `dash` block to the digest would grow a 530 KB payload, move the fence's size guard and put the same figures in two places. If the owner later wants the dashboard inside Agent Analytics for the campaign manager, that is a Phase F follow-on with its own `_changes[]` entry — and it is the reason `VTEngine.dashboard()` is pure and takes everything in.

**Per-person view state**, not shared: the "all the data is wrong" incident was a shared UI blob. `S.ui.vtReport` follows `S.ui.preset`.

## §RB · Rule-book additions (schema; full first draft in `rules-draft.json`)

```
version: "vt-1.3" → "vt-1.4"            + one _changes[] entry per key below

detection.vtOpeningBook → detection.vtSchedulers   { sheetName, requireHeaders, takeOnly[8], optional:false, reUploadable:true }
columns.schedulers      NEW  { byPosition:true, saleDate:"B", agent:"C", saleCount:"D", gwp:"E",
                               caseNumber:"F", campaignRaw:"H", referringAgent:"I", scheduler:"J",
                               result:"K", apptOn:"M", discard:["A","G","L","N","O","P","Q","R"] }
columns.discardAll      amend: name "Customer Contact" explicitly
channels                NEW  { keys:["lead_gen","referral","predictive","other"],
                               labels:{lead_gen:"Lead Gen", …}, salesReviewLabels:{lead_gen:"Digital"},
                               campaignMap:{Revx:"lead_gen", …7 entries}, unmapped:"other",
                               rollups:{panimax:["referral","predictive"]} }
views                   NEW  4 entries, each { label, words, dateRule, preCycle, openOutcomesInCycleOnly }
periods.leadTimeBuckets h72p → h72pIn + h72pOut (5 + past);  h72pIn.cutoff:"cycle.to"
cycleBudget             NEW  per cycle key: { headcount, sales{}, fitments{}, fitmentRate, cancelledPct,
                               missedPct, scheduledPct, dialingDays, _cells{} }
dashboardHrsShare       NEW  { h24:0.75, h48:0.10, h72:0.05, h72pIn:0.05, h72pOut:0.05, _cells }
forecast                NEW  { method:"straight_line_pace", formula, label:"straight-line pace, not a prediction",
                               dataThrough:"MIN(cycle.to, max sale date)" }
insights                NEW  templates[] — id, text with {placeholders}, requires[], minSales
integrity               NEW  { k17, k18, schedulerName } — each { label, formula, okWords, checkWords }
```

**`cycleBudget` is a separate branch from `budgets`.** `budgets[cycle]` stays exactly as it is — per **sub-campaign**, per tenure, for the **rating**. `cycleBudget[cycle]` is per **channel** (lead source), for the **dashboard**. They are different dimensions over different workbooks and conflating them is the single most likely way to break the rating. Each is read through its own accessor and each screen names which it is showing (D3).

## §CH · Charting approach

**What the suite already loads.** There is **no Chart.js anywhere in the live apps** — only in dead scratch copies under `diagnostics/scratch/`. What is live is a bespoke **inline-SVG chart kit** in `nicks_code/index.html` (section marker `/* ---------- SVG chart kit ---------- */`, line ~5557): `sparkSVG`, `lineChart`, `stackChart`, `hbarChart`, `radarChart`, `ringSVG`, with CSS at lines 299–318 (`.chartbox`, draw-in animations, `.ring`). Every one reads CSS custom properties, so it themes itself. The only heavy library PULSE loads is SheetJS, and it is **self-hosted** (`/xlsx.full.min.js`) with the comment "an ad-blocker or work network silently killing the CDN would take uploads down with it".

**Decision: extend the existing inline-SVG kit; add no library.** CSP permits cdnjs, but a CDN chart library would (a) not render from `file://` offline, which the VT pages must do, (b) reintroduce the `#cdnWarn` "Chart library could not load" failure mode the suite deliberately left behind, and (c) need a `data-inline` exemption in `tools/prepare-site.js`. The five forms this page needs are 40–90 lines of SVG each. They go in a **new companion `nicks_code/vt-charts.js`** rather than growing the 11,158-line `index.html`, following the same `data-inline` pattern as the other VT files.

**The forms, chosen by the data's job (`dataviz`), not by the mockup's shape:**

| Panel | Form | Why |
|---|---|---|
| 5 KPI cards | **stat tiles**: value + delta + day sparkline (`sparkSVG`) | a single current value is a tile, never a one-bar chart |
| Target Achieved | **meter** — the existing `ringSVG` | one ratio against one limit |
| Performance Trend | **line, 2 series** (actual, target), legend + direct labels, crosshair tooltip | trend over time; both series are counts → **one axis** |
| Channel Performance | **tall segmented bar** + legend (4 parts, share printed on each) | one whole into ≤ 6 parts read at a glance (was a donut — D7) |
| Campaign Breakdown | **ranked horizontal bars**, largest first, one hue, Panimax as a labelled sub-total | 7 parts, two of them 38 and 1; segments would hide them (was a donut — D7) |
| Cycle Performance (5 buckets) | **meter list** — name, aligned bar, figure, target marker per bucket | several ratios, one per named row, each against its own limit |
| Sales vs budget | **meter** with a second marker for the forecast | one ratio against a limit, plus a projection |
| Forecast vs Actual | **grouped bars** per channel (actual, forecast) with a budget rule line | 2 series + a reference, one axis |
| Detailed Breakdown | **table**, with a thin segmented bar per channel row (no text on it) | the row carries the figures; this is also the required table view |
| Pivots, summaries, rollovers, upcoming | **tables** (upcoming also gets a single-hue column strip by date) | > 7 classes that all carry meaning → a table |

**Series palette — validated, not eyeballed.** Run through the `dataviz` validator (`scripts/validate_palette.js`), all six checks:

```
light (surface #FFFFFF):  #2563EB lead_gen · #158A4C referral · #6D4AE0 predictive · #B45309 other
   → PASS lightness · PASS chroma · PASS CVD (worst adjacent ΔE 25.6 deutan) · PASS normal-vision (29.1) · PASS contrast
dark  (surface #0A1730):  #3D86E8 · #179C72 · #8457E6 · #B5790C
   → PASS lightness (L 0.48–0.67 band) · PASS chroma · PASS CVD (19.6) · PASS normal-vision (21.0) · PASS contrast
```

The light four **are the suite's existing tokens** (`--accent`, `--courtesy`, `--vt`/`--violet`, `--nesting`/`--amber`). The dark four are **new, darker steps**: the suite's dark tokens (`#4C9DFF`, `#2BD9B0`, `#A78BFA`, `#F5B02E`) sit at L 0.69–0.77 and **fail the dark lightness band** — dark mode is selected from the same ramps, never an automatic flip. They land as four new custom properties `--vtc1…--vtc4` defined in both theme blocks, so no chart ever names a hex.

Mandatory with them: fixed hue order, never cycled (a 9th campaign folds into Other); legend **always** present for ≥ 2 series with direct labels on ≤ 4; status colours (`--good`/`--crit`) reserved for the OK/CHECK verdicts and never used as a series; 2 px surface gap between stacked segments and 2 px rings on overlaps; 4 px rounded data-ends; 2 px lines; ≥ 8 px markers; recessive `--grid-line` axes; text in ink tokens, never in a series colour. Tritan separation on the adjacent pairs is 4–6 ΔE (below the 6–8 floor band), so the direct labels and the table view are **not optional** — they are the required secondary encoding, which the chosen forms already carry.

## §5B · The five-bucket change and its blast radius

`periods.leadTimeBuckets` today: `h24` (days 0), `h48` (1), `h72` (2), `h72p` (minDays 3), `past` (maxDays −1). 072 splits `h72p` into `h72pIn` (minDays 3, `apptOn <= cycle.to`) and `h72pOut` (minDays 3, `apptOn > cycle.to`). `past` is unchanged.

**Touched:**

1. `periods.hrsBucket()` — one `if`, plus the cycle end passed in (it already has the cycle in `model`).
2. `model()`'s `hrsAhead` object on `tlAgg`, `subAgg`, `leadAgg`, `floor`: `{total, h24, h48, h72, h72p, past, share:{…}}` → `h72p` replaced by `h72pIn` + `h72pOut`. **An agent row never carries `hrsAhead`**, so nothing per-agent changes shape.
3. `digest()` — the same `hrsAhead` objects travel; `verify-vt-digest.mjs` shape checks updated.
4. `reports.columns` ids `hrsAhead` / `hrsShare` — the MTD page's "Hrs Ahead — open Scheduled cases" table and `agent/vt-view.js`'s `hrsTable` each gain one column.
5. Suites: `verify-vt-periods`, `-digest`, `-pages`, `-portal`, `-rules`, `-engine`.

**Not touched — and this is the point:** `rating.notScored.hrsAhead` already excludes the buckets from the score, so the two drivers, their 50/50 weights, the half-of-target floor, the renormalisation, the bands and every `budgets[cycle].fitment` value are untouched; `verify-vt-rating.mjs` must pass **byte-for-byte**. No sales, fitted, scheduled, missed, cancelled, fitRate, missRate, schedRate, canRate, SPD, target, toTarget, fitBudget, canBudget, value or noSaleDay figure moves on any page, in any digest, for any agent, team leader, sub-campaign or lead source. **The exact list of numbers that change anywhere in the suite is: the `72+` column on two tables becomes two columns.**

`budgets[cycle].hrsShare` (80/10/5/5) is **left exactly as it is** — it belongs to a different workbook and to the MTD table. The dashboard reads `dashboardHrsShare` (75/10/5/5/5) and labels it (D3, FR-034).

## §T · Testing strategy (tests first)

| Suite | Kind | What it proves |
|---|---|---|
| `verify-vt-report-oracle.mjs` | **NEW**, pure, over the owner's real workbook | SC-001 + SC-002 — every figure in spec §0.3 / §0.4 to the unit, with `doc()` for anything irreproducible. Written **before** `dashboard()`. |
| `verify-vt-views.mjs` | **NEW**, pure | the four views, the pre-cycle-fitted rule, the in-cycle-only asymmetry (F0-9), the three integrity checks, the forecast and dialing days, the insight templates |
| `verify-vt-periods.mjs` | modify | the 5 buckets, the cycle-end cutoff, the frozen as-at (D5), and that no clock exists in the engine |
| `verify-vt-rating.mjs` | **unchanged, must pass** | SC-003 — the score did not move |
| `verify-vt-vas-golden.mjs`, `verify-vt-isolation.mjs` | **unchanged, must pass** | VAS untouched; `vas-state` byte-identical after a Schedulers Data drop |
| `verify-vt-engine.mjs` | modify | `parseSchedulers` by position, 3,010 of 19,961 rows, `Referring Agent = 0` (F0-19), serial-0 appointment date (F0-20), `Customer Contact` absent from every output, `Result` never applied |
| `verify-vt-db.mjs` | modify | 073 verbatim in PGlite: the two CHECKs, the four columns, `coalesce` semantics, grants |
| `verify-vt-worker.mjs`, `-station.mjs`, `-validate.mjs` | modify | the new kind end to end against the stub; slot swap; the retired slot refused in words |
| `verify-vt-dashboard.mjs` | **NEW**, real Chromium over the BUILT site | SC-005 + SC-006: both themes, every panel, the view selector, no console error, no empty card, no customer field, legend + label on every chart |
| `verify-vt-export.mjs` (or a `verify-vt-dashboard` section) | **NEW** | SC-007: the `.xlsx` figures equal the screen's |
| `verify-vt-rules.mjs` | modify | SC-008: both rule-book copies equal; no literal outside `@vt-rules` |
| `verify-vt-build.mjs` | modify | the two new `data-inline` companions ship inside the page |
| `tools/vt-verify.mjs` | modify | the new page joins the daily tick |
| `dataviz` validator | run | the two palettes, both modes — committed in the plan output above |

## Risks

1. **The rating moves by accident.** The one real danger. Mitigated by making `cycleBudget` a separate branch from `budgets`, by never touching `rating.*`, and by requiring `verify-vt-rating.mjs` to pass byte-for-byte as an acceptance gate on Phase A.
2. **`trackFrom` moves and every SPD changes.** The Schedulers Data commit must set `opening_book_on` with exactly the opening book's semantics (U-5). Guarded by an explicit check in `verify-vt-views.mjs` that `model().trackFrom` is unchanged for a book before and after a Schedulers Data commit.
3. **`vt_upload_commit` blanks the new columns on an ordinary BI commit.** Mitigated by DB-4's `coalesce`, and by a PGlite check that a BI commit after a Schedulers Data commit preserves scheduler, GWP and `sold_basis`.
4. **The guide's figures get quoted instead of the workbook's.** The guide is wrong about the row count and loose about the scheduled/missed/cancelled asymmetry. Mitigated by SC-001's oracle, which checks against recomputed cells, not against the PDF.
5. **A `TODAY()`-based reader disagrees with the page.** The owner's own workbook will drift away from the page as days pass, because his `L` column recalculates and ours does not. The panel states its as-at date, the floor guide explains it, and D5 records why. This will be the first "the numbers don't match" question and the answer must be ready.
6. **Attribution disagreements with the hand report** (11 manual credits, ~6.6 % partner relabels) now become visible on an executive screen for the first time. Mitigated by FR-014/FR-015: they are a named panel with the same wording as the floor guide, not a surprise.
7. **Donuts.** The owner asked for two; the build ships a segmented bar and ranked bars (D7). If he wants the rings, it is one function — but the plan must not pretend the request was honoured.
8. **Page weight.** 20 panels, four of them tables of up to 122 rows. The page renders a string like the other VT pages; the book is already in memory. Expected first paint from a warm book under 400 ms. If it is not, the pivots and the Agent & Scheduler Summary move behind a disclosure, as the Ops pages do.

## Complexity Tracking

| Added complexity | Why it is justified | What was rejected |
|---|---|---|
| A 5th and 6th companion file (`vt-dashboard.js`, `vt-charts.js`) | `index.html` is 11,158 lines; the VT module's whole pattern is companions | growing `index.html`; a bundler |
| `cycleBudget` beside `budgets` | they are different dimensions over different workbooks; merging them risks the rating | one budgets tree |
| A 5th lead-time bucket the score ignores | the workbook has five and the owner reads five | changing the four and letting the score follow |
| A `dashboard()` function beside `model()` | four views × 20 panels would bloat `model()`, which three live pages and the digest depend on | extending `model()` |
| A chart kit file instead of a library | `file://`, no CDN failure mode, 2 kB of SVG per form | Chart.js from cdnjs |
