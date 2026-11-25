# Tasks: VT Report — consolidated Vehicle Tracking dashboard (072)

Five phases, A → E. Each is sized for **one builder**. Within a phase, tasks marked **[P]** may run in parallel with each other; phases themselves are sequential except where stated.

## Shared-file matrix (do NOT run two builders on the same file at once)

| File | A | B | C | D | E |
|---|---|---|---|---|---|
| `specs/vt_engine_rules.json` | **write** | — | — | — | read |
| `nicks_code/vt-engine.js` | **write** | **write** | — | **write** | read |
| `nicks_code/vt-pages.js` | — | **write** | — | **write** | read |
| `nicks_code/index.html` | — | — | **write** | — | **write** |
| `nicks_code/vt-dashboard.js` | — | — | **write** | **write** | **write** |
| `nicks_code/vt-charts.js` | — | — | **write** | — | — |
| `agent/vt-view.js` | **write** | — | — | — | — |
| `worker/src/vt.mjs` | — | **write** | — | — | — |
| `supabase/migration-073-*.sql` | — | **write** | — | — | — |
| `verify-vt-periods / -rules / -engine / -rating` | **write** | — | — | — | read |
| `verify-vt-db / -worker / -station / -validate` | — | **write** | — | — | read |
| `verify-vt-dashboard / -export` | — | — | **write** | **write** | **write** |
| `tools/vt-*.mjs`, `tools/audit-permissions.mjs` | — | — | — | — | **write** |

**Hard conflicts to sequence around:**
- `nicks_code/vt-engine.js` is written by **A, B and D** — they must not overlap. A finishes first (it owns the rule book and the bucket split); B adds `parseSchedulers` + the merge branch; D adds the pivot and summary aggregations.
- `nicks_code/vt-pages.js` is written by **B** (slot swap, ingest branch) and **D** (the MTD table's 5th column). Give both to the same builder, or run D after B.
- `nicks_code/vt-dashboard.js` is written by **C, D and E**. C creates it with the mockup's panels; D appends the workbook's remaining panels; E appends the export and the checks. Strictly sequential.
- `nicks_code/index.html` is written by **C** (NAV, PAGES, script tags, chart CSS, `--vtc*` tokens) and **E** (nothing, unless a token moves). C only, if possible.
- A and B may overlap **only** if A's engine edits land first and B rebases; safer to run A → B.

---

## Phase A · Rule book + the pure engine changes + the oracle · one builder

The whole phase is pure: no UI, no DB, no network. **Tests are written before the code they test.**

- [x] **A1 · Write the oracle first.** `nicks_code/diagnostics/verify-vt-report-oracle.mjs` — read the owner's `Master November 2026 - VT Report.xlsx` from `../reference/zips/vt-master/` and assert SC-001 and SC-002: 3,010 records (not 19,960), cycle-view 2,705 / 1,996 / 373 / 128 / 208, 73.8 %, Fitted GWP R 383,206, buckets 130/68/26/0/149, all-data 3,010, current-cycle 2,382, rollovers 628 with 305 open, dialing days 20 of 22, forecast 2,976. Use the 071 `doc()` mechanism for anything irreproducible and **carry forward the 11 hand credits and the ~6.6 % relabels with the floor guide's wording** (FR-015). It must FAIL at this point.
  - Acceptance: the suite runs and reports failures with real numbers, never a crash.
  - Verify: `node nicks_code/diagnostics/verify-vt-report-oracle.mjs`
  - Files: 1 new.
- [x] **A2 · `specs/vt_engine_rules.json` → `vt-1.4`.** Apply `rules-draft.json`: `views`, `channels`, `cycleBudget`, `dashboardHrsShare`, `forecast`, `insights`, `integrity`, the 5-bucket `periods.leadTimeBuckets`, `columns.schedulers`, `detection.vtSchedulers`, `columns.discardAll` amendment. One dated `_changes[]` entry **per key**, each naming its Sales Review cell or its decision id. Drop `_evidence` prose (it lives in the draft and the spec); keep `_cells`.
  - Acceptance: every non-`_` key traces to a cell or a decision id; `version` is `vt-1.4`.
  - Files: 1.
- [x] **A3 · Mirror into `VT_RULES`** inside the `@vt-rules` block of `nicks_code/vt-engine.js`, field for field.
  - Verify: `node nicks_code/diagnostics/verify-vt-rules.mjs` passes (extend it for the new keys in the same task).
  - Files: 2.
- [x] **A4 · Split the 5th bucket.** `periods.hrsBucket(apptOn, asAt, cycleTo)`; `h72p` → `h72pIn` + `h72pOut`; `past` unchanged. Update `model()`'s `hrsAhead` on `tlAgg`/`subAgg`/`leadAgg`/`floor` and the `digest()` shape. Extend `verify-vt-periods.mjs` for the five buckets, the cycle-end cutoff, the frozen as-at (D5) and an assertion that **no clock exists anywhere in the engine**.
  - Acceptance: `verify-vt-rating.mjs` passes **byte-for-byte unchanged** (SC-003) — this is the gate on the whole phase.
  - Verify: `verify-vt-periods`, `verify-vt-rating`, `verify-vt-digest`, `verify-vt-engine`.
  - Files: 4–5.
- [x] **A5 · `hrsTable` 5th column in `agent/vt-view.js`.** Display only; no rule literal.
  - Verify: `verify-vt-portal.mjs`.
  - Files: 1.
- [x] **A6 · `VTEngine.dashboard(book, roster, {cycleKey, view, asOf, prev, isDataOnlyDay})`** — pure, no clock, no DOM. Returns `{period, view, viewWords, dataThrough, dialingDays:{total,elapsed,left,pct}, kpis[5], weeks[], channels[], campaigns[], buckets[5], budget, forecast, breakdown[], insights[], gwp, integrity[3], disagree, unmapped[], unmatched[]}`. Reuses `tally` / `rates` / `periods` / `leadGroupOf`; honours the four views including the in-cycle-only asymmetry (F0-9). One accessor `cycleBudgetFor(cycleKey)` with the latest-earlier-cycle fallback, naming the cycle used.
  - Acceptance: A1's oracle **passes**; `verify-vt-views.mjs` (new, written in this task) proves the four views, the three integrity checks, the forecast, the dialing days and the insight templates.
  - Verify: `verify-vt-report-oracle`, `verify-vt-views`.
  - Files: 2–3.
- [x] **A7 · Checkpoint.** Run the full `verify-vt-*` set. **Nothing may fail**, and `-rating`, `-vas-golden`, `-isolation` must be untouched passes. Capture a golden of the three existing VT pages' figures for SC-004 before Phase B begins.

### Phase A build note (2026-11-25, Phase A builder)

A1-A7 are done and every suite is green. Three things the next phase needs to know:

- **A2, the detection rename is ADDITIVE.** `detection.vtSchedulers` is in both rule-book copies, but
  `detection.vtOpeningBook` is still there and `detect()` / `parseOpeningBook()` still use it. Eleven
  files reference the old key and they are all Phase B's (`parseSchedulers`, the slot swap, the
  validator). **B1/B5 retire `vtOpeningBook`**; doing it in A would have broken `verify-vt-engine`,
  `-station`, `-validate`, `-app` and `-isolation` for no gain.
- **A4 reached two files outside its column.** The five-bucket split renamed
  `periods.hrsAheadBuckets` to `periods.leadTimeBuckets`, so `nicks_code/vt-pages.js` needed that one
  identifier changed (line 545) or the MTD Hrs Ahead table would have lost every bucket column, and
  `verify-vt-pages.mjs` / `verify-vt-oracle.mjs` needed their four-bucket expectations re-stated for
  five. **D3 still owns the labelling** - the two new columns currently show the absent marker for
  their budget, because `budgets[cycle].hrsShare` has four keys by design (D3, FR-034).
- **A6 also delivered D1's engine aggregations.** The oracle written in A1 asserts the scheduler
  pivots, the person dimensions, the upcoming fitments and the Rollover Follow-up, so `dashboard()`
  returns all of them already. **Task D1 is engine-complete**; D2 only has to paint them.

---

## Phase B · Schedulers Data upload: parser, merge, migration, Worker, station · one builder (after A)

- [x] **B1 · `VTEngine.parseSchedulers(aoa)`** by position per `columns.schedulers`. Counts and skips the 16,950 empty rows; handles `Referring Agent = 0` (F0-19) and appointment serial 0 (F0-20); discards `Customer Contact` and every unlisted column; refuses a file with a duplicate case number, naming them (A2); returns `{kind:'schedulers_data', cases, rows, warnings, skippedBlank, missing}`.
  - Acceptance: 3,010 cases from the owner's file; no customer field in any output; `verify-vt-engine.mjs` section added.
  - Files: 2.
- [x] **B2 · `merge()` branch.** Sets `sold_on` + `sold_basis='schedulers_data'` (outranking `opening_book` / `first_seen`), `scheduler_cb` / `scheduler_name` via `resolveSeller` against the `scheduling` roster, `gwp_rpt`, `referring_cb`. **Never sets status.** Counts `Result` disagreements by direction into the returned `disagree`. Sets `book.openingBookOn` with the opening book's exact semantics (U-5). Returns a `redated` tally.
  - Acceptance: `model().trackFrom` is identical before and after a Schedulers Data commit (risk 2); status never changes; `verify-vt-views.mjs` asserts both.
  - Files: 2.
- [x] **B3 · `supabase/migration-073-vt-schedulers.sql`** — DB-1…DB-4 and DB-6. **New file only**; never edit 071/072. `coalesce` semantics so an ordinary BI commit cannot blank the four new columns.
  - Verify: `node nicks_code/diagnostics/verify-vt-db.mjs` (extended) — 073 runs verbatim in PGlite; both CHECKs, four columns, grants, and the BI-after-Schedulers preservation case (risk 3).
  - **Do not apply it.** No `--apply`, no live Supabase write; Nick applies migrations.
  - Files: 2.
- [x] **B4 · `worker/src/vt.mjs`** — accept `kind='schedulers_data'` on begin/stage/commit. No new route, no new auth rule.
  - Verify: `verify-vt-worker.mjs` (extended) against the stubbed PostgREST.
  - Files: 2.
- [x] **B5 · The slot swap in `nicks_code/vt-pages.js`.** `DB_KIND` / `LABEL` / `slotsHtml()`: three slots, *Opening book (once)* **removed**, `VT · Schedulers Data` in its place with the U-2 wording. Ingest branch: no thin-pull exemption, re-uploadable, receipt reports staged / skipped-blank / redated / disagreements / unmatched schedulers. Dropped on the wrong slot → refused in words naming the right one.
  - Verify: `verify-vt-station.mjs` + `verify-vt-station-fixes.mjs` (extended), `verify-vt-validate.mjs`, and `verify-vt-isolation.mjs` **unchanged** (a Schedulers Data drop leaves `vas-state` byte-identical).
  - Files: 3–4.
- [x] **B6 · Checkpoint.** The owner's workbook ingests end to end against the stub Worker: 3,010 staged in 4 calls, a receipt that reads in plain words, and the oracle still green.

### Phase B build note (2026-11-25, Phase B builder)

B1-B6 are done; every suite is green and `-rating` (58), `-vas-golden` (32) and `-isolation` (27) passed with the
rating file untouched. What Phase C needs to know:

- **The opening book is fully retired.** `detection.vtOpeningBook`, `columns.opening` and `parseOpeningBook()` are
  GONE from both rule-book copies and the engine; `detect()` answers `vtSchedulers` for the sheet and `DB_KIND` /
  `LABEL` / `slotsHtml()` carry three slots, the third `VT · Schedulers Data`. The OLD NAME still answers where
  something already uses it: `vt_uploads.kind='opening_book'` and `sold_basis='opening_book'` stay legal (073 ADDS,
  never edits 071), the receipt card reads "Opening book (retired)", `tools/vt-validate.mjs` has
  `retiredSlotNote()`, and `VTStation.REFUSE_OPENING_FIRST` is still exported (it aliases `REFUSE_DATING_FIRST`).
  `detection.vtSchedulers.requireHeaders` are deliberately the retired key's own five headers, so Ops'
  `VT_SIGNATURES` copy is byte-identical and nothing that was refused before stops being refused; the ten columns the
  parser READS are checked by name at their position inside `parseSchedulers` (`readColumns`).
- **The book carries SEVEN new fields**, appended to `BOOK_COLS` (so every earlier position is unmoved):
  `schedulerName`, `schedulerCb`, `gwpRpt`, `referringName`, `referringCb`, `campaignRpt`, `resultRpt`. The plan's
  DB-3 named four; `dashboard()` (Phase A) reads all seven, so a book read back without them would paint the
  scheduler pivots, the person dimension and the disagreement panel empty. They are null until the sheet lands, and
  the page must read "needs the Schedulers Data upload", never 0.
- **The back-build is in the ENGINE, not in a published key.** `VTEngine.cyclesInBook(book)` lists every business
  cycle the book's sale dates reach (oldest first, the earliest flagged `partial` with `firstSale` and a sentence),
  and `VTEngine.prevCycleFor(book, roster, cycleKey, {asOf})` returns a ready `prev` for `dashboard()` computed from
  the book, with `counts: null` when the cycle is not reached (an absence is not a nought). **Phase C should pass
  `prev` = the frozen `kv:vt-digest-cycle-<prev>` when one exists, else `prevCycleFor(...)`, and say which it used.**
  Frozen history keys for CLOSED cycles are refused from a browser by the existing fence (`closed_cycle`), so
  back-filling them stays the republish tool's job (spec A9, Phase E).
- **migration-073 is NOT applied.** Nick applies it at deploy. Until he does, the seven columns do not exist and a
  Schedulers Data commit would fail on the server; everything else keeps working exactly as today.

---

## Phase C · The VT Report page and its charts · one builder (after B) — [P] with D1 only if D waits for C's file

- [x] **C1 · `nicks_code/vt-charts.js`** — the five forms of §CH as inline SVG, theme-token only, no hex: tall segmented bar, ranked hbars, meter list, meter-with-forecast-marker, grouped bars with a reference line, plus a thin segmented bar. 2 px segment gaps, 4 px rounded data-ends, 2 px lines, ≥ 8 px markers, hover tooltip on every mark, legend + direct labels. Unique ids off the existing `CHART_ID` pattern.
  - Acceptance: renders from `file://`; no network; no literal colour.
  - Files: 1 new.
- [x] **C2 · The `--vtc1…--vtc4` tokens + chart CSS in `nicks_code/index.html`**, defined in BOTH theme blocks with the validated values from §CH. Re-run the `dataviz` validator on both sets and paste the report into the deploy checklist.
  - Acceptance: both modes PASS all six checks.
  - Files: 1.
- [x] **C3 · `nicks_code/vt-dashboard.js` — the shell.** `VTDash.render()`: head (cycle, view words, data-through, dialing day), the **view selector** (four options, FR-007/008) in one filter row above the panels, per-person state in `S.ui.vtReport`, the `ensure()` / loading / no-uploads / no-figures states borrowed from `VTPages`, and `repaint()`. The page holds **no arithmetic**.
  - Files: 1 new.
- [x] **C4 · The mockup's panels** (table rows 1–13): 5 KPI cards with previous-cycle deltas reading "—" when absent (FR-019), Target Achieved as a ring, Performance Trend, Channel Performance, Campaign Breakdown, Cycle Performance (5 buckets), Sales vs budget, Forecast vs Actual, Detailed Breakdown, Key Insights. Every panel names its view and its target's source (FR-006, FR-034).
  - Files: 1.
- [x] **C5 · NAV + registration in `nicks_code/index.html`**: `vt_report` first in the Vehicle Tracking group; `PAGES.vt_report`; two new `<script src="vt-charts.js" data-inline>` / `vt-dashboard.js` tags.
  - Verify: `verify-vt-build.mjs` (the companions ship inside the page), `verify-vt-app.mjs`.
  - Files: 1.
- [x] **C6 · `verify-vt-dashboard.mjs`** — real Chromium over the BUILT site, both themes, a fictional book served by the existing stub Worker: every panel present, the view selector repaints all of them, no console error, no empty card, no spinner, no customer field in the DOM, a legend and a label on every chart (SC-005, SC-006).
  - Files: 1 new.
- [x] **C7 · Checkpoint.** The owner's mockup is on screen, in both themes, with real figures and the deltas reading "—".

### Phase C build note (2026-11-25, Phase C builder)

C1–C7 are done; `verify-vt-dashboard` is new and green (100), and every other VT suite plus the VAS baseline is
green with counts only up. What Phase D needs to know:

- **Channel Performance is a DONUT, not §CH's tall segmented bar.** The owner chose the ring for that one panel
  (four slices read well); the plan's D7 preference survives as `VTCharts.segbar`, which the Detailed Breakdown's
  outcome-mix column uses. Campaign Breakdown is ranked horizontal bars exactly as §CH/D7 says.
- **`nicks_code/vt-dashboard.js` ends with the integrity panel.** E1 formally owns that panel; it is already built
  (verdicts, icon + words, both sides printed, never blocking) because the page could not honestly ship without it.
  E1 should extend rather than re-create. **Panel 19 (Where the sources disagree) and the .xlsx export are NOT built**
  — `D.disagree` is on the model and nothing paints it yet.
- **Two figures the model does not carry**, both worked around in words rather than computed in page code:
  1. `weeks[]` has `sales` and `target` but no per-week attainment, so the Performance Trend table prints the two
     side by side and has no Attainment column. If D wants one it belongs in `dashboard()`.
  2. A frozen `kv:vt-digest-cycle-<prev>` carries only `floor.mtd` (the model's **in-play month-to-date** set), which
     is a wider window than this page's cycle view, and carries no Target Achieved and no per-channel split. The page
     renames those four counts, sends the rest as null (so their change reads the absent marker) and says on screen
     which source answered and that the window differs. A `dash` block on the digest would close this properly — it
     is deliberately out of scope here (plan §P).
- **`VTDash.adopt(receipt, book, roster)` exists** and mirrors `VTPages.adopt`, but **nothing calls it**: the station
  only hands over to `VTPages`. Wiring it is a one-line change in `vt-pages.js`, which Phase C may not write.
- **The dashboard loads for itself** (receipts → book → roster → the frozen prev), because `VTPages` keeps its roster
  private. Two pages therefore hold two copies of the same book. If that ever matters, the shared cache belongs in
  `vt-pages.js` — D's file, not C's.
- **`/pulse/?app=vt` still lands on Month to Date.** `vt_report` is first in the NAV group (FR-001) and reachable at
  `?app=vt&page=vt_report` or the `?page=report` shorthand, but `VTApp.LANDING` was left alone so the address keeps
  the meaning it has had since 071.
- **`vt_report` is NOT yet in `tools/vt-grant-tabs.mjs` or `tools/audit-permissions.mjs`** — that is task E4. Until
  then only `admin` and `vas:['*']` accounts can open it.
- The palette validator was re-run for C2 and both modes PASS all six checks; the two reports are written into the
  comments beside the `--vtc1…--vtc4` definitions in `nicks_code/index.html`. E5 should copy them into
  `deploy-checklist.md`, which does not exist yet.

---

## Phase D · The rest of the workbook · one builder (after C)

- [x] **D1 · Engine aggregations** in `nicks_code/vt-engine.js`: per-scheduler pivots for the four scopes with percentages over each scheduler's own grand total, divide-by-zero safe (FR-045); the Agent / Referring Agent / Scheduler person dimension with date / channel / campaign filters (FR-047); upcoming scheduled fitments from the earliest date with per-date shares and a "Later dates" fold (FR-048); the Rollover Follow-up per channel with Open to Action and Open GWP (FR-049); Fitted GWP and total GWP in view (FR-044).
  - Acceptance: the oracle gains the scheduler figures (6 schedulers, the 62.3 %–84.9 % spread, the headcount-6 check) and the rollover figures (628 / 323 / 305).
  - Verify: `verify-vt-report-oracle`, `verify-vt-views`.
  - Files: 2.
- [x] **D2 · The panels** (table rows 14–18) in `nicks_code/vt-dashboard.js`: Fitted GWP tile, the four pivot tables with a scope switch stating "all data", the Agent & Scheduler Summary with its five controls and an active-filters line, Upcoming Scheduled Fitments, Rollover Follow-up. Every one says "needs the Schedulers Data upload" in words where that is the truth.
  - Files: 1.
- [x] **D3 · The MTD Hrs Ahead table's 5th column** in `nicks_code/vt-pages.js`, labelled against `budgets[cycle].hrsShare` and saying so (D3/FR-034).
  - Verify: `verify-vt-pages.mjs`; the Phase A golden proves SC-004 — nothing else moved.
  - Files: 2.
- [x] **D4 · Checkpoint.** All 20 panels render; the scheduler spread is visible; the oracle covers every panel's headline figure.

---

### Phase D build note (2026-11-25, Phase D builder)

D1–D4 are done and every suite is green (`-rating` 58, `-vas-golden` 32, `-isolation` 27 all unchanged passes).
What Phase E needs to know:

- **THE PAGE FOLDS NOW (the owner's layout decision, taken 2026-11-25): charts first, each table behind a native
  `<details class="vt-fold">`** whose summary reads "Show the figures — N …". It needs no JavaScript to open, the
  `<summary>` is focusable and Enter-operable by the browser itself, and the table is **always in the DOM** — never
  built on click — so the chart's `role="img"` alternative and the paired table both survive. The open/closed state
  is per person in `S.ui.vtReport.figures` (saved by `saveUI()`, never a shared blob) and `VTDash.fold()` deliberately
  does NOT repaint. The honest-state notices and the KPI row never fold. Panels now sit in `.vt-grid` (two columns at
  desk width, one on a phone, `.vt-wide` for the two full-width panels). **E3's export must read the model, not the
  DOM** — it already does; nothing about the fold changes a figure.
- **Panel 19 (Where the sources disagree) is BUILT** — E2 should extend rather than re-create it. It paints
  `D.disagree` (six counts, icon + words, the by-direction breakdown) and carries forward the 071 hand credits and
  the 6.6 % relabels in the floor guide's own wording. Panel 20 (integrity) is still Phase C's and unchanged.
- **One engine addition, deliberately minimal:** `VTEngine.dashboard().schedulerPivot(scope)` still returns the same
  array, but now carries `all` (the scope's grand total — the floor average), `scope`, `label` and `words` as
  properties ON that array, so every earlier caller (`.map`, `.filter`, `.reduce`) is unmoved. It exists because
  **there is no per-scheduler target in any source** — the cycle budget carries a scheduler headcount and nothing
  else — so the panel shows the figures and the scope average, named on screen as "not a target", and never invents
  one. The rule book was NOT touched (no new keys, no version bump): the sentences live in the engine beside
  `rollover.words`. Asserted in `verify-vt-report-oracle` (against each Pivot sheet's own G15/F15) and `verify-vt-views`.
- **`VTDash.adopt` is wired** (`vt-pages.js`, beside `VTPages.adopt`), so an Upload Station commit refreshes the
  report instead of leaving it on the book it opened with.
- **D3 is a LABEL, not a budget.** `budgets[cycle].hrsShare` carries one `72+` key (`h72p`, 5 %) and not two, so the
  MTD Hrs Ahead table's two split columns print the absent marker for their budget and the table's note says why,
  naming the rule-book path. Splitting that 5 % would be a rule-book change nobody wrote — E5 should record it in
  the floor guide beside the D5 note.
- **Measured page height** (verify-vt-dashboard prints it every run): folded **5,619 px ≈ 6.2 screens** for all
  sixteen panel blocks, **9,475 px ≈ 10.5 screens** with every table open; the mockup's Overview panels alone are
  **2,688 px ≈ 3.0 screens** in two columns. The remaining height is the per-panel provenance notes, which stay
  visible on purpose (FR-006/FR-034). Folding those too is the one lever left and is the owner's call.
- Screenshots (synthetic data only): `nicks_code/diagnostics/scratch/vt/vt-report-folded.png` (the new default),
  `vt-report-schedulers.png`, `vt-report-agents.png`, plus the light/dark pair Phase C already saved.

---

## Phase E · Export, integrity, health, validator, docs · one builder (after D)

- [ ] **E1 · The three integrity checks** (panel 20) in `nicks_code/vt-dashboard.js`: K17, K18 and the scheduler-name check as engine **verdicts**, each with an icon and the words OK / CHECK, printing both sides and the difference on CHECK, and never blocking the page (FR-050…054).
  - Files: 1.
- [ ] **E2 · "Where the sources disagree"** (panel 19): the new counts beside the carried-forward 071 figures, in the floor guide's wording (FR-014, FR-015).
  - Files: 1.
- [ ] **E3 · `.xlsx` export** through `workbookFor` / `exportView`: one sheet per panel, built from the same model object, plus a header sheet carrying view, cycle, data-through and rule-book version; no customer field (FR-055…057).
  - Verify: `verify-vt-export.mjs` (new) — SC-007, the file's figures equal the screen's.
  - Files: 2.
- [ ] **E4 · Grants, validator, health, tick** — **[P]** with E3: `vt_report` in `tools/vt-grant-tabs.mjs` and `tools/audit-permissions.mjs`; the new file in `tools/vt-validate.mjs` (and the retired slot named as retired); the page in `tools/vt-verify.mjs` so it joins the daily tick; a `vt-schedulers-stale` alert in `worker/src/vt-health.mjs` when the newest Schedulers Data receipt is older than the newest BI receipt by more than `guards.uploadGapWorkingDays`.
  - Verify: `verify-vt-tabs`, `verify-vt-validate`, `verify-vt-health`.
  - Files: 5.
- [ ] **E5 · Docs** — **[P]** with E3/E4: `specs/072-vt-report-dashboard/deploy-checklist.md` (every suite in order, the two palette validator reports, the migration-073 apply step, the post-deploy smoke, and the standing note that 073 is applied by Nick) and `floor-guide.md` (what each panel means, the four views in plain words, why the page's `72+` buckets may differ from the owner's workbook as his sheet ages — D5 — and the carried-forward known differences).
  - Files: 2 new.
- [ ] **E6 · Final checkpoint.** Every `verify-vt-*` suite green, including the three that must be **unchanged** passes. Then hand to Nick: he applies migration-073, deploys, republishes, and runs the post-deploy smoke. **This spec's builders do not deploy, do not run wrangler, and make no live Supabase write.**

---

## Migrations by task

| Migration | Task | Applied by |
|---|---|---|
| `migration-073-vt-schedulers.sql` | B3 | **Nick**, at deploy (E6). Never `--apply` from a builder. |

## Parallel opportunities

- **A1 may be written while the rest of A is specified** — it is the only task that must fail first.
- **C1 + C2** (charts and tokens) are independent of **C3 + C4** (the page) if two builders agree the function signatures first; otherwise one builder, in order.
- **E3, E4 and E5** are genuinely independent and are the only three-way parallel in the plan.
- **Never** parallelise A with B, B with D, or any two of C / D / E — they write the same two files.
