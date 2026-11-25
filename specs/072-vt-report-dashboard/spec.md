# Feature Specification: VT Report — consolidated Vehicle Tracking dashboard

**Spec Kit 072** · branch `feature/vt-dashboard` · extends the LIVE spec 071 (`specs/071-vehicle-tracking-analytics/`)

The owner, verbatim: *"I need you to add dashboard to the vehicle tracking I want it like this [mockup], I gave you a pdf with all the formulas broken down from my master november 2026 VT, our goal is to build one consilidated dashboard, with all the information, take a look at the master november that was build out, and continue, all the formulas used are in the pdf."*

One page, **VT Report**, inside the Vehicle Tracking app (`/pulse/?app=vt`), laid out like the owner's mockup, in the suite's own look, honouring the per-account light/dark theme. It consolidates the whole of `Master November 2026 - VT Report.xlsx` — all eight sheets — into one screen fed by the engine and the rule book.

---

## 0. What the files settle (found 2026-11-24, read-only)

The guide (`VT_Report_Rules_Formulas_Guide.pdf`, 7 pages, 16 sections + 2 appendices) is the **map**; the workbook is the **territory**. Every figure below was recomputed from the workbook's own cells, not read off a summary. Where they disagree, the workbook wins and the disagreement is recorded.

### 0.1 The workbook has 3,010 records, not 19,960

- **F0-1** The guide says "Schedulers Data contains 19,960 data rows (rows 2–19,961)". It does not. **16,950 of those rows are empty** — they carry only the extended formulas in `L` (Hrs Ahead) and `R` (Channel), which evaluate to blank. The populated record count is **3,010**: column `A` reads `Current` on 2,382 and `Rollover` on 628, and nothing else.
- **F0-2** All 3,010 populated rows have a real numeric Date (`B`), a Result (`K`), a GWP (`E`), a Scheduler (`J`) and a Campaign/Partner (`H`). **Zero blanks** in any of them. There is no "unexpected Result value" case in this file.
- **F0-3** **Sale Count is 1 on every populated row and there are no duplicate case numbers** — 3,010 rows, 3,010 distinct case numbers. This resolves the guide's §16 question "whether Sale Count should always be 1 per row and how duplicate case numbers are handled" **from the data**: one row = one case = one sale.
- **F0-4** Consequence for the build: a formula range that ends at row 19,961 (guide §14 "Formula range" risk) is irrelevant to us — we never carry the sheet's formulas, only its three unique facts (Scheduler, GWP, sale Date).

### 0.2 The cycle, the data-through date and the holiday

- **F0-5** `Exco Summary!H4` = **2026-10-26**, `J4` = **2026-11-25** (raw serials 46321 / 46351). This is exactly the suite's business month (26th → 25th, keyed by the month it ends in) — `cycle-2026-11` in `worker/src/cycle.mjs`. No new period definition is needed.
- **F0-6** `Sales Review!K7` (data-through) = `MIN(cycle end, MAX(sale date))` = **2026-11-23**. Sale dates in the file run 2026-08-21 → 2026-11-23.
- **F0-7** `Sales Review!K9` = **2026-11-04**, the only holiday entered; K10:K14 blank. This is already `periods.extraHolidays` in `specs/vt_engine_rules.json` **and** `MTD_RULES.extraHolidays`. **Confirmed in both; nothing to add.**
- **F0-8** Dialing days recomputed: `NETWORKDAYS(2026-10-26, 2026-11-25, {2026-11-04})` = **22 total**; elapsed to 2026-11-23 = **20**; 91 % of the cycle elapsed, 2 days left. Matches the workbook's `B49` / `C49` / `D49` / `E49`.

### 0.3 The cycle-view figures the dashboard must reproduce

Recomputed from the workbook's cells for `cycle view = in-cycle sales + pre-cycle Fitted` (n = 2,705):

| Channel | Sales | Fitted | Scheduled* | Missed* | Cancelled* | Fitment rate |
|---|---|---|---|---|---|---|
| Lead Gen (labelled **Digital**) | 1,921 | 1,435 | 262 | 91 | 133 | 74.7 % |
| Referral | 245 | 161 | 54 | 12 | 18 | 65.7 % |
| Predictive | 538 | 400 | 56 | 25 | 57 | 74.3 % |
| Other | 1 | 0 | 1 | 0 | 0 | 0.0 % |
| **Total** | **2,705** | **1,996** | **373** | **128** | **208** | **73.8 %** |

- **F0-9** `*` **Scheduled, Missed and Cancelled are counted IN-CYCLE ONLY** in the Sales Review cycle column (`C88`–`C92`, `C70`–`C74`, `C76`–`C80` carry no pre-cycle term), while Sales (`C52`–`C56`) and Fitments (`C58`–`C62`) **add** the pre-cycle `Result = Fitted` term. The identity still holds — 1,996 + 373 + 128 + 208 = 2,705 — precisely because every row the pre-cycle term adds is Fitted on both sides. **K17 reads OK on the real data.** The dashboard must reproduce this asymmetry exactly; "fixing" it to add pre-cycle scheduled/missed/cancelled would break K17.
- **F0-10** Against budget: sales 2,705 / 3,030 = **89.3 %** (−325); fitments 1,996 / 2,424 = **82.3 %** (−428); straight-line forecast sales **2,976** (98.2 % of budget), fitments **2,196** (90.6 %). Cancelled 7.69 % against the 5 % target; missed 4.73 %; scheduled 13.79 % against the 10 % target.
- **F0-11** Fitted GWP, cycle view = **R 383,206** (Σ `E` where `K = Fitted`). Total GWP over all 3,010 records = R 584,184 (mean R 194).
- **F0-12** Other views: **all data** 3,010 (1,996 F / 460 S / 182 M / 372 C, 66.3 % fitted); **current cycle only** 2,382 (1,673 / 373 / 128 / 208); **rollovers only** 628 (323 F / 87 S / 164 C / 54 M → **305 open to action**).

### 0.4 The five lead-time buckets — and what `TODAY()` was

- **F0-13** The `L` column tallies, all data: `24` = 140, `48` = 77, `72` = 30, `72+ in cycle` = **0**, `72+ out cycle` = 213 — **460, exactly the Scheduled count**. Every Scheduled row has a Date Scheduled; **K18 reads OK on the real data**. In the cycle view the five are 130 / 68 / 26 / 0 / 149 = 373.
- **F0-14** The upcoming-fitment counts by Date Scheduled are 2026-11-24 → 140, 11-25 → 77, 11-26 → 30. Those are the *same numbers* as buckets `24`, `48`, `72`. Therefore **`TODAY()` was 2026-11-24 when the workbook was last calculated** — one day after the last sale date. The engine's existing frozen basis is `hrsAsAt = extract date + 1 day` (`periods.hrsAheadAsAtOffsetDays = 1`), which on this file is also 2026-11-24. **The engine's frozen basis reproduces the workbook's buckets exactly on the day the workbook was built.** See D5.
- **F0-15** `72+ in cycle` is **structurally empty late in a cycle**: its rule is "3+ days ahead AND on or before the 25th cutoff", so from the 23rd of a month onward nothing can land in it. It is 0 here for that reason, not because of missing data. Its 5 % share of the scheduled target is unreachable in the last three days of every cycle — see **Q4**.

### 0.5 Channels, campaigns and schedulers

- **F0-16** Seven campaigns appear and **all seven are mapped** in `Exco Summary!B26:C32`: Revx 1,061, Tracking Empire 760, Jag 246, Afrilead 38 (→ Lead Gen); Referral Agent 278 (→ Referral); Predictive 626 (→ Predictive); Black Birch Projects 1 (→ Other). **Unmapped campaigns in this file: zero.** `Other` holds exactly one record. This partly resolves §16's "is the campaign mapping complete" — for this cycle, yes; the rule stays "unmapped falls to Other".
- **F0-17** **6 distinct schedulers**, which is exactly the headcount budget of 6 (`Sales Review!B50`; actual `C50` = `ROWS(UNIQUE(FILTER(...)))` = 6). Their cycle-view spreads, anonymised S1–S6 in sheet order: 628 sales / 75.6 % fitted · 56 / 78.6 % · 258 / 84.9 % · 643 / 74.5 % · 409 / 62.3 % · 711 / 73.7 %. A 22-point spread between the best and worst scheduler is the single most actionable fact in the workbook and is why the four pivots must be on the page.
- **F0-18** Schedulers are **on the Agent List** — `teams.keys` already carries `Scheduling` and `teams.notRated` already excludes it from rating. So a scheduler resolves to a CB through `vt_roster_at(on)` where the sub-campaign is `scheduling`, through the same `resolveSeller` chain as a seller. No new identity mechanism.

### 0.6 Quirks that will bite a parser

- **F0-19** **`Referring Agent` (col I) is the number `0`, not blank,** when there is no referrer. A parser that tests for blank will report 2,382 referrals.
- **F0-20** A blank `Date Scheduled` (col M) reads as serial `0` (renders 1899-12-29), not empty.
- **F0-21** Column `N` is blank by design; `O` / `P` / `Q` ("Scheduled" / "Missed" / "Fitted") are reference/identifier helpers and are **not** outcome fields. `R` (Channel) is a formula.
- **F0-22** Column `G` is **`Customer Contact`** — customer data. It is discarded before anything leaves the browser, like every other PII column in `columns.discardAll`.
- **F0-23** `Agent & Scheduler Summary!E36` carries a **third integrity check** the guide never mentions: `IF(C39 = B7, "Reconciles to total sales in view", "Check: N sales in view have no scheduler name")`. We adopt it as our third on-screen check.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1: An exec or campaign manager reads the cycle in one screen (Priority: P1)

The CTTO or the VT campaign manager opens Vehicle Tracking → **VT Report** and sees, without scrolling to understand it: how many sales and fitments this business month, what share of the 3,030 sales budget that is, whether the straight-line forecast lands above or below budget, where the leakage is (cancelled, missed), which channel and which campaign is carrying the month, how the scheduled pipeline is spread over the five lead times, and — in plain words — what the numbers mean.

**Acceptance scenarios**

1. **Given** the November 2026 cycle with 2,705 cycle-view sales, **when** the page opens with the default view, **then** the KPI row reads Total Sales 2,705, Total Fitments 1,996, Cancellations 208, Missed 128 and Target Achieved 89.3 %, and the page header says which view and which cycle is showing.
2. **Given** no `cycle-2026-10` digest exists, **when** the KPI cards render, **then** each change-vs-previous-cycle reads **"—"** with the words "no previous cycle on file" — never `0`, never `+100 %`.
3. **Given** the cycle is 91 % elapsed, **when** the Sales-vs-budget panel renders, **then** it shows actual 2,705 against budget 3,030 and forecast 2,976 on the same track, and states "dialing day 20 of 22".
4. **Given** the integrity checks pass, **when** the page renders, **then** both show **OK** with a tick and the words; **given** one fails, **then** it shows **CHECK** with the two disagreeing numbers written out.
5. **Given** the owner switches the view selector to *Rollovers only*, **when** the page repaints, **then** every panel honours it (628 sales, 305 open to action) and the header says "Rollovers only — sales dated before 26 Oct 2026".
6. **Given** a screen reader or a colour-blind reader, **when** any chart renders, **then** every series is named by a legend **and** by a direct label or a table row — never by colour alone.

### User Story 2: The Ops uploader lands Schedulers Data (Priority: P1)

The person who uploads the daily VT exports now also drops the **Schedulers Data** sheet, and gets a receipt saying what it changed.

**Acceptance scenarios**

1. **Given** the Vehicle Tracking Upload Station, **when** the uploader looks at the VT card, **then** there are **three** slots: BI Active Fitted, Scheduled & Missed, and **VT · Schedulers Data** — and the old *Opening book (once)* slot is gone, its job absorbed.
2. **Given** `Master November 2026 - VT Report.xlsx` dropped on the Schedulers Data slot, **when** it is ingested, **then** 3,010 case rows are staged (not 19,960), the 16,950 empty rows are counted and reported as skipped, and the receipt names how many cases gained a Scheduler, a GWP and a sale date, and how many sale dates it **changed**.
3. **Given** cases already dated by the retired opening book (`sold_basis = 'opening_book'`), **when** Schedulers Data lands, **then** their sale date is re-stated from column `B` with `sold_basis = 'schedulers_data'`, the change is counted on the receipt, and `vt_book_rev.opening_book_on` keeps its meaning so `trackFrom` does not move.
4. **Given** a Schedulers Data file whose `Result` column disagrees with the engine's status for a case, **when** it commits, **then** the engine's status **stands unchanged** and the disagreement is counted — never applied.
5. **Given** a file with a `Customer Contact` column, **when** it is parsed, **then** that column never reaches the Worker, the database, the page or the export.
6. **Given** the Schedulers Data file is dropped on the BI or Scheduled & Missed slot, **then** it is refused in words naming the right slot.

### User Story 3: A VT team leader works the pipeline (Priority: P2)

A VT team leader opens VT Report to see which scheduler is losing bookings, which appointments are due in the next 24/48/72 hours, and which pre-cycle sales are still open.

**Acceptance scenarios**

1. **Given** six schedulers in the cycle, **when** the scheduler pivots render, **then** each scheduler has Fitted / Scheduled / Cancelled / Missed counts and the four percentages over that scheduler's own grand total, for Referral, Predictive, Lead Gen and All Campaigns, and no percentage ever shows a divide-by-zero.
2. **Given** 305 open rollovers, **when** the Rollover Follow-up panel renders, **then** it lists per channel the rollover sales, the fitted ones (counted in cycle), scheduled, cancelled-to-rebook, missed-to-rebook, open-to-action and the open GWP.
3. **Given** 460 scheduled bookings, **when** the Upcoming Scheduled Fitments panel renders, **then** it starts at the earliest scheduled date (2026-11-24) and lists a count per date with a share of pipeline, folding everything past the horizon into "Later dates".
4. **Given** the person dimension is switched to **Scheduler** / **Agent** / **Referring Agent**, **when** the Agent & Scheduler Summary repaints, **then** the breakdown follows the chosen dimension and respects the date, channel and campaign filters, and says which filters are active.

### Edge Cases

- A cycle with no uploads at all → the page says so and shows no figures (never zeros), exactly as the three existing VT pages do.
- Schedulers Data never uploaded → the Scheduler pivots, Fitted GWP and the "exact sale date" basis say **"needs the Schedulers Data upload"** in words and paint nothing; every other panel still works off the daily exports.
- A scheduler name not on the Agent List → counted under the name as typed, flagged in an unmatched list, never dropped and never guessed.
- A campaign not in the mapping → folds to **Other**, and the page names it in the unmapped list so the mapping can be extended.
- `Referring Agent = 0` → no referrer (F0-19).
- `72+ in cycle` empty near cycle end → 0 with the structural note, not an error (F0-15).
- Cancellation % above its 5 % budget → shown red, never scored (spec 071 A13 stands: a cancelled sale is still a sale).
- Previous cycle present but empty → delta "—", by the same absence rule.

---

## Requirements *(mandatory)*

### Functional Requirements

**The page (PULSE, Vehicle Tracking app)**

- **FR-001** A new page **VT Report** MUST exist in the Vehicle Tracking NAV group, NAV id `vt_report`, as the group's FIRST item, above Month to Date.
- **FR-002** The page MUST be invisible to any account without an explicit `vt_report` tab grant (`tools/vt-grant-tabs.mjs`, non-negotiable "new pages need tab grants").
- **FR-003** The page MUST compute nothing. Every figure MUST come from `VTEngine` and every threshold from the rule book; `verify-vt-rules.mjs` MUST fail on any rule literal written into page code.
- **FR-004** The page MUST honour the per-account light/dark theme through CSS custom properties only. It MUST NOT hard-code the mockup's dark palette.
- **FR-005** The page MUST render from `file://` with no network beyond the Worker — no CDN chart library (see plan §CH).
- **FR-006** Every panel MUST state the **view** it is honouring and, where it differs from the view, say so in words (the lead-time and upcoming-fitment panels cover all bookings regardless of view — guide §9, workbook `B108`).

**The view selector and the rollover rules**

- **FR-007** A view selector MUST offer exactly the workbook's four views and nothing else: **Cycle view** (in-cycle + pre-cycle `Fitted` only), **Current cycle only**, **Rollovers only**, **All data**.
- **FR-008** The default view MUST be **Cycle view**, and the page MUST name it in plain words ("Cycle view — sales dated in the cycle, plus earlier sales only where they were fitted").
- **FR-009** In Cycle view, a pre-cycle case MUST be included **only** when its status is `fitted`; pre-cycle `scheduled`, `missed` and `cancelled` cases MUST be excluded from every count on the page except the Rollover Follow-up panel.
- **FR-010** Scheduled, Missed and Cancelled in the cycle-view panels MUST be counted **in-cycle only**, with no pre-cycle term, per F0-9.
- **FR-011** A pre-cycle sale that is still open MUST appear in the **Rollover Follow-up** panel with its outcome and its GWP, and MUST NOT count as a new-cycle sale until it is fitted.

**Precedence where the sources disagree (shown, never hidden)**

- **FR-012** **Status** (`fitted` / `scheduled` / `missed` / `cancelled`) MUST come from the daily exports through the engine's existing rules, including derived cancellation (rule book `vt-1.3`, spec 071 A13). The Schedulers Data `Result` column MUST NOT change any status.
- **FR-013** **Scheduler**, **GWP** and **sale date** MUST come from Schedulers Data; nothing else carries them. A case with no Schedulers Data row MUST show "—" for all three, never 0 and never a guess.
- **FR-014** The page MUST carry a **Where the sources disagree** panel stating, as counts and shares: cases whose Schedulers Data `Result` differs from the engine status (by direction); cases whose sale date moved when Schedulers Data landed; schedulers and sellers not matched to a CB; campaigns not in the mapping; and GWP present in one source and not the other.
- **FR-015** That panel MUST **extend** the 071 oracle's existing accounting, not restart it: the ~11 hand credits and ~6.6 % relabelled lead sources recorded in `specs/071-vehicle-tracking-analytics/floor-guide.md` and measured by `verify-vt-oracle.mjs`'s `doc()` mechanism MUST be carried forward and shown beside the new disagreement counts, with the same wording.
- **FR-016** The page MUST name which source each figure came from wherever two sources could have supplied it — in particular **Fitted GWP** (Schedulers Data col `E`) versus the engine's **Fitted value** (BI charge ex VAT × `vat`). Both MUST be shown; neither MUST be adjusted to match the other.

**KPI cards (guide §6, §7.3)**

- **FR-017** Five KPI cards MUST render: **Total Sales**, **Total Fitments**, **Cancellations**, **Missed**, **Target Achieved** (actual ÷ sales budget).
- **FR-018** Each card MUST carry its change against the **previous business month's frozen cycle** (`kv:vt-digest-cycle-YYYY-MM` for the prior cycle), as an absolute change and a percentage.
- **FR-019** When the previous cycle is absent or empty, the change MUST read "—" with the reason in words. It MUST NOT read 0.
- **FR-020** Target Achieved MUST name the budget it measures against and its workbook cell ("89.3 % of the 3,030 cycle sales budget — Sales Review B51").

**Performance Trend (guide §9, §13)**

- **FR-021** A Performance Trend panel MUST plot **sales by week** against the per-week target for the selected view.
- **FR-022** The week window MUST be `date >= week start AND date < week start + 7` — the workbook's own window — and the panel MUST use the engine's existing `periods.weeksOf` cycle weeks so it agrees with the VT Weekly page.
- **FR-023** The per-week target MUST be the cycle sales budget spread over the cycle's **dialing days** in that week (budget ÷ 22 × that week's dialing days), never budget ÷ number of weeks, and the panel MUST say so.
- **FR-024** In Cycle view the panel MUST mark the pre-cycle weeks as **fitted-only** (workbook note `B109`: their fitted % reads 100 % by construction) so nobody reads them as a real week.

**Channel Performance (guide §3)**

- **FR-025** A Channel Performance panel MUST split the view's sales across exactly four channels: **Lead Gen** (labelled **Digital** where the Sales Review labels it so), **Referral**, **Predictive**, **Other**.
- **FR-026** Channel MUST be derived from the campaign→channel mapping in the rule book. An unmapped campaign MUST fall to **Other** and MUST be named in the unmapped list.
- **FR-027** The channel dimension MUST be the **lead source** (`leadAgg` / lead groups), NOT the agent's sub-campaign (`subAgg`). The two are different dimensions and the page MUST not conflate them.

**Campaign Breakdown (guide §3)**

- **FR-028** A Campaign Breakdown panel MUST split the view's sales by **Campaign/Partner**, and MUST show **Panimax** (Referral + Predictive) as a named roll-up exactly where the Sales Review does, labelled as a roll-up and never counted twice in a total.

**Cycle Performance — the five lead-time buckets (guide §5, §8)**

- **FR-029** A Cycle Performance panel MUST show **five** buckets: `24`, `48`, `72`, `72+ in cycle`, `72+ out cycle`, each with its actual count, its target and its attainment.
- **FR-030** The bucket targets MUST be the channel's scheduled target (10 % of that channel's sales budget) apportioned **75 / 10 / 5 / 5 / 5**, from `Sales Review!B94 / B100 / B106 / B112 / B118`.
- **FR-031** The bucket MUST be computed from the **frozen extract date** — `hrsAsAt = latest extract + 1 day`, the engine's existing `periods.hrsAsAt` — and NOT from `TODAY()`. See **D5**.
- **FR-032** The in-cycle cutoff for `72+ in cycle` MUST be the cycle end from `periods.cycleByKey`, not the workbook's `DATE(YEAR(TODAY()),MONTH(TODAY())+(DAY(TODAY())>25),25)` expression.
- **FR-033** Adding the fifth bucket MUST be **display only**: it MUST NOT change the VT agent rating, its two drivers, its weights or any per-sub-campaign fitment budget (D2), and `verify-vt-rating.mjs` MUST still pass byte-for-byte.
- **FR-034** Where the dashboard's bucket shares (75/10/5/5/5) differ from the rating-side `budgets[cycle].hrsShare` (80/10/5/5), **each screen MUST label which target it is measuring against**, naming its source workbook. See **D3**.

**Sales vs budget, and Forecast vs Actual (guide §7.1, §7.2)**

- **FR-035** The mockup's "Budget vs Spend" card MUST be **sales against the cycle sales budget of 3,030** with the straight-line forecast beside it (owner decision D4). There is no spend or cost data anywhere in any source and the page MUST NOT invent one or imply one.
- **FR-036** Forecast MUST be `actual ÷ elapsed dialing days × total dialing days`, per `Sales Review!F51` / `F57`.
- **FR-037** Dialing days MUST be `NETWORKDAYS(cycle start, end, holidays)`, elapsed `NETWORKDAYS(cycle start, data-through, holidays)`, with data-through = `MIN(cycle end, latest sale date)`. The engine's existing `periods.workingDaysBetween` MUST be the one implementation.
- **FR-038** The holiday list MUST be the rule book's (`periods.extraHolidays` + computed SA public holidays). 2026-11-04 is already in both the rule book and the workbook (F0-7) and MUST NOT be duplicated.
- **FR-039** A Forecast vs Actual panel MUST show, per channel, actual and forecast against that channel's budget for **both** sales and fitments.
- **FR-040** Forecast MUST be labelled a **straight-line pace**, not a prediction (guide §7.1).

**Detailed Breakdown and Key Insights**

- **FR-041** A Detailed Breakdown table MUST give, per channel: sales, fitments, cancellations, missed, target, achievement %, change vs last cycle, and a totals row whose rates are **ratios of sums**, never means of rates (`reports.totals`).
- **FR-042** A **Key Insights** panel MUST be **computed from the figures on the page**. No insight may be hand-written, and each MUST name the number it came from.
- **FR-043** Each insight MUST be a template filled from the model (conversion, leakage, best campaign at 20+ sales, rollover position — the workbook's own `B11`–`B14` headlines), and a template with no data MUST be omitted, never padded.

**The rest of the workbook, so it is genuinely consolidated**

- **FR-044** **Fitted GWP** MUST be Σ GWP where status is `fitted`, from Schedulers Data col `E`, for the selected view, with the total GWP in view beside it.
- **FR-045** The **four scheduler pivots** (Referral, Predictive, Lead Gen, All Campaigns) MUST render with per-scheduler Fitted / Scheduled / Cancelled / Missed counts and the four percentages over that scheduler's grand total, every one divide-by-zero safe (the workbook's are not — guide §11).
- **FR-046** The pivots MUST be **all data** by default, as the workbook's are, and MUST say so.
- **FR-047** An **Agent & Scheduler Summary** MUST offer the person dimension **Agent / Referring Agent / Scheduler** with date-from, date-to, channel and campaign filters, and MUST print which filters are active.
- **FR-048** An **Upcoming Scheduled Fitments** panel MUST start at the earliest scheduled date (`MINIFS` over Date Scheduled where status `scheduled`), count per date, give each date's share of the scheduled pipeline, and fold the tail into "Later dates / not shown".
- **FR-049** A **Rollover Follow-up** panel MUST list the open pre-cycle position per channel, with Open to Action = scheduled + cancelled + missed, and Open GWP.

**Integrity checks on screen (guide §6, §8, §14)**

- **FR-050** The page MUST show **K17**: `fitted + scheduled + missed + cancelled = total sales`, as **OK** or **CHECK**, and on CHECK print both sides and the difference.
- **FR-051** The page MUST show **K18**: the five bucket counts = the scheduled pipeline, same treatment.
- **FR-052** The page MUST show the third check found in the workbook (F0-23): sales in view with no scheduler name, as OK or "N sales in view have no scheduler".
- **FR-053** A check MUST never be colour-alone: each carries an icon and the words OK / CHECK.
- **FR-054** A failing check MUST NOT block the page. It states the disagreement and the page still renders.

**Export**

- **FR-055** The whole dashboard MUST export to `.xlsx`, built live from the same model object the screen paints — one sheet per panel, through the existing `workbookFor` / `exportView` pattern in `nicks_code/vt-pages.js`.
- **FR-056** The export MUST carry the view, the cycle, the data-through date and the rule-book version in a header sheet, so a distributed copy says what it is.
- **FR-057** The export MUST contain no customer field.

**Engine, rule book and the existing module**

- **FR-058** Every figure MUST be produced by a **pure** engine function with no clock and no DOM, taking its "today" in as an argument, like `VTEngine.model`.
- **FR-059** The rule book version MUST bump to **`vt-1.4`** with a dated `_changes[]` entry per changed key, in BOTH `specs/vt_engine_rules.json` and the inlined `VT_RULES` (`verify-vt-rules.mjs`).
- **FR-060** The existing **Month to date**, **Weekly**, **Daily** pages and the **VT agent card** MUST keep working. The only figure the five-bucket change touches is the `hrsAhead` breakdown on the MTD page's "Hrs Ahead — open Scheduled cases" table and the matching table in `agent/vt-view.js`, which gain a column where `72+` splits into in-cycle and out-of-cycle. No sales, fitted, scheduled, missed, cancelled, rate, SPD, target or score figure moves anywhere.
- **FR-061** `verify-vt-isolation.mjs` MUST still prove `vas-state` byte-identical after a Schedulers Data file is dropped, and `verify-vt-vas-golden.mjs` MUST still pass.
- **FR-062** The Schedulers Data intake MUST reuse the existing begin / stage / commit / abandon flow with compare-and-set on the book revision, and MUST refuse a thin pull by the existing `guardUpload` rules.

### Key Entities

- **Schedulers Data record** — one row, one case: sale date (`B`), agent (`C`), GWP (`E`), case number (`F`), campaign/partner (`H`), referring agent (`I`, `0` = none), scheduler (`J`), hand-typed result (`K`, read for the disagreement count only, never applied), date scheduled (`M`). Everything else discarded.
- **Channel** — a lead-source group: `lead_gen` (labelled Digital in the Sales Review), `referral`, `predictive`, `other`. Four, fixed.
- **Campaign/Partner** — the raw campaign; seven known, mapped in the rule book; **Panimax** is the Referral + Predictive roll-up, never a raw channel.
- **View** — one of four inclusion rules over sale date and status (FR-007).
- **Lead-time bucket** — one of five, from Date Scheduled against the frozen as-at date.
- **Cycle budget** — per channel: sales, fitments, fitment rate, cancelled %, missed %, scheduled %, bucket shares, headcount — all with their Sales Review cells.
- **Scheduler** — a person on the Agent List's `Scheduling` sub-campaign, resolved to a CB through the existing chain; never rated (`teams.notRated`).

---

## 5. Panel table

Every panel: what it shows, the formula, the workbook sheet + cell, the date basis, and which views it honours.

| # | Panel | What it shows | Formula | Workbook source | Date basis | Views |
|---|---|---|---|---|---|---|
| 1 | KPI · Total Sales | count + Δ vs previous cycle | count of records in view | SR `C51` / Exco `B7` | sale date `B` | all four |
| 2 | KPI · Total Fitments | count + Δ | count where status `fitted` | SR `C57` / Exco `C7` | sale date | all four |
| 3 | KPI · Cancellations | count + % of sales + Δ | count `cancelled`; ÷ sales | SR `C75`, `C81` | sale date, in-cycle only | all four |
| 4 | KPI · Missed | count + % of sales + Δ | count `missed`; ÷ sales | SR `C69` | sale date, in-cycle only | all four |
| 5 | KPI · Target Achieved | % of sales budget + Δ | sales ÷ 3,030 | SR `D51` vs `B51` | sale date | all four (the budget is a cycle figure — labelled when the view is not a cycle view) |
| 6 | Performance Trend | sales per week vs per-week target | `date >= wk AND date < wk+7`; target = 3,030 ÷ 22 × that week's dialing days | Exco `B67:H81`; guide §9 / §13 | sale date | all four; pre-cycle weeks marked fitted-only in Cycle view |
| 7 | Channel Performance | the view's sales split 4 ways | campaign→channel map; unmapped → Other | Exco `B26:C32`, `B18:L22` | sale date | all four |
| 8 | Campaign Breakdown | sales by campaign + Panimax roll-up | count per campaign; Panimax = Referral + Predictive | Exco `B26:L33`; SR `A54`, `A60` | sale date | all four |
| 9 | Cycle Performance | 5 buckets: actual vs 75/10/5/5/5 of the 10 % scheduled target | bucket from Date Scheduled vs frozen as-at | SR `C93` / `C99` / `C105` / `C111` / `C117` vs `B94` / `B100` / `B106` / `B112` / `B118` | **appointment date** vs as-at | all bookings, **regardless of view** (stated) |
| 10 | Sales vs budget | actual + forecast on the budget track | actual; forecast = actual ÷ elapsed × total | SR `C51`, `B51`, `F51` | sale date; dialing days | cycle views; labelled otherwise |
| 11 | Forecast vs Actual | per channel, sales + fitments: actual, forecast, budget | straight-line pace | SR `A27:G34` | sale date; dialing days | cycle views |
| 12 | Detailed Breakdown | per channel: sales, fitments, cancellations, missed, target, achievement %, Δ, totals | counts; rates = ratios of sums | SR `A36:G43` + `A45:G122` | sale date | all four |
| 13 | Key Insights | computed sentences, each naming its figure | templates over the model | Exco `B11:B14` | as the figure it cites | follows the view |
| 14 | Fitted GWP | Σ GWP where fitted, and total GWP in view | `SUMIFS(E, status, fitted)` | Exco `K7`, `K8`, `L18:L22` | sale date | all four |
| 15 | Scheduler pivots ×4 | per scheduler: F/S/C/M counts + 4 percentages | count ÷ that scheduler's grand total | the four Pivot sheets | sale date | **all data** by default, stated |
| 16 | Agent & Scheduler Summary | person dimension × filters | COUNTIFS by person + date/channel/campaign | A&SS `B36:W…`, `C4` / `C5` / `E5` / `H5` / `K5` / `Z18` | sale date | all four + its own filters |
| 17 | Upcoming Scheduled Fitments | earliest scheduled date, count + share per date | `MINIFS(M, status = scheduled)`; `COUNTIFS(M = date)` | Exco `B83:D102` | **appointment date** | all bookings, regardless of view |
| 18 | Rollover Follow-up | open pre-cycle position per channel | sale date `< cycle start`, by status; open = S + C + M | Exco `B35:L42` | sale date | its own rule (always pre-cycle) |
| 19 | Where the sources disagree | counts + shares of every disagreement | see FR-014 / FR-015 | — (071 oracle + new) | — | follows the view |
| 20 | Integrity checks ×3 | OK / CHECK with both sides | K17, K18, scheduler-name check | SR `K17`, `K18`; A&SS `E36` | as each check | follows the view |

---

## 6. The view and precedence rules, in one place

**Views** — `date` is the sale date, `status` the engine's status:

| View | Rule |
|---|---|
| **Cycle view** (default) | `cycle.from <= date <= cycle.to` **OR** (`date < cycle.from` **AND** `status = fitted`) |
| Current cycle only | `cycle.from <= date <= cycle.to` |
| Rollovers only | `date < cycle.from` |
| All data | `date` is a real date |

Within Cycle view, **Scheduled / Missed / Cancelled are in-cycle only** (F0-9, FR-010). Lead-time and upcoming-fitment panels cover **all** bookings regardless of view, and say so.

**Precedence**

| Fact | Comes from | Never from |
|---|---|---|
| Status (fitted / scheduled / missed / cancelled) | the daily exports via the engine, incl. derived cancellation (`vt-1.3`) | the Schedulers Data `Result` column |
| Scheduler | Schedulers Data `J` | anything else — nothing else carries it |
| GWP | Schedulers Data `E` | the BI charge (that is the engine's separate `value`) |
| Sale date | Schedulers Data `B` (basis `schedulers_data`), else first-seen | — |
| Channel / lead source | the rule-book campaign map over the Salesforce partner | the hand-typed report label (071 A11) |
| Seller credit | Salesforce `Created By` (071 A10) | the hand-typed report Agent |
| Targets on this page | the rule book's `cycleBudget`, from Sales Review cells | page code |

Every disagreement above is **counted and shown** (FR-014), extending the 071 oracle (FR-015).

---

## Success Criteria *(mandatory)*

- **SC-001** On the owner's own `Master November 2026 - VT Report.xlsx`, a new oracle suite reproduces, to the unit: cycle-view sales 2,705, fitments 1,996, scheduled 373, missed 128, cancelled 208, fitment rate 73.8 %, Fitted GWP R 383,206, buckets 130 / 68 / 26 / 0 / 149, dialing days 20 of 22, forecast sales 2,976, and the three other views' totals (3,010 / 2,382 / 628) — with every irreproducible difference printed under DOCUMENTED DIFFERENCES by the 071 `doc()` mechanism, never special-cased.
- **SC-002** Both workbook checks read **OK** on that file, computed by the engine: `1,996 + 373 + 128 + 208 = 2,705` and `130 + 68 + 26 + 0 + 149 = 373`.
- **SC-003** `verify-vt-rating.mjs`, `verify-vt-vas-golden.mjs` and `verify-vt-isolation.mjs` pass **unchanged**: no agent score moves and `vas-state` stays byte-identical.
- **SC-004** The three existing VT pages' figures are byte-identical before and after, except the `hrsAhead` table's new column (a golden capture proves it).
- **SC-005** The page renders in real Chromium from the BUILT site in both themes with no console error, no empty card, no spinner left behind, and no customer field anywhere in the DOM or the export.
- **SC-006** Every chart passes the colour validator in both modes, and every series is identified by a legend **and** a label or table row.
- **SC-007** The `.xlsx` export opens and its figures equal the screen's, panel for panel.
- **SC-008** `verify-vt-rules.mjs` fails if any threshold on the new page is written as a literal.

---

## 9. Assumptions and decisions

- **A1 · The guide is the map, the workbook is the territory.** Evidence: the guide's "19,960 data rows" is 3,010 (F0-1). Every figure in this spec was recomputed from cells. *Would change if:* a later workbook genuinely populates those rows — the parser counts rows rather than trusting a range, so nothing breaks.
- **A2 · Sale Count is always 1 and case numbers are unique.** Evidence: 3,010 rows, 3,010 distinct case numbers, `D = 1` on every one (F0-3). Resolves guide §16. *Would change if:* a future file repeats a case number — the intake MUST then refuse the file and name the duplicates, as `publish_agent_list` does for a duplicate CB.
- **A3 · The workbook's cycle IS the suite's business month.** Evidence: H4 / J4 = 26 Oct / 25 Nov (F0-5). *Would change if:* the owner moves the cycle boundary — one rule-book value, already shared with `worker/src/cycle.mjs`.
- **A4 · The holiday list already agrees.** Evidence: SR `K9` = 2026-11-04 = `periods.extraHolidays` = `MTD_RULES.extraHolidays` (F0-7). *Would change if:* the owner adds a holiday — the rule book and the spec's `extra[]` move together, as the public-holiday non-negotiable requires.
- **A5 · The scheduled/missed/cancelled asymmetry is deliberate, not a workbook bug.** Evidence: K17 reads OK *because of* it (F0-9). *Would change if:* the owner says pre-cycle open items should count in the cycle — then K17's definition changes with it, and both move together.
- **A6 · Schedulers are Agent List people.** Evidence: `teams.keys.Scheduling` and `teams.notRated` already exist; 6 schedulers = headcount budget 6 (F0-17, F0-18). *Would change if:* a scheduler is not on the list — the unmatched list names them for a human, never invents a CB.
- **A7 · GWP and the engine's `value` are two different measures.** Evidence: Schedulers Data `E` sums to R 584,184 (mean R 194) and is typed by hand; the engine's `value` is the BI charge ex VAT × `vat`. *Would change if:* the owner says one is wrong — until then both are shown, named, and neither is adjusted (non-negotiable: never "fix" one aggregate to match another).
- **A8 · There is no spend or cost data.** Evidence: no cost column exists in any of the eight sheets, the two daily exports or the Agent List. The mockup's "Budget vs Spend" is therefore sales vs the sales budget (owner decision D4). *Would change if:* the owner supplies a cost source — a new upload and a new panel, not an invented figure.
- **A9 · The previous-cycle delta needs a frozen cycle digest.** Evidence: `kv:vt-digest-cycle-YYYY-MM` is written per cycle by `vt-publish.js`, and 071 went live inside `cycle-2026-11`, so `cycle-2026-10` does not exist. *Would change if:* the owner wants history back-built — a `tools/vt-republish-cycle.mjs` run over the Schedulers Data book, which now carries sale dates back to 2026-08-21. Until then the delta reads "—".
- **A10 · The four scheduler pivots are all-data.** Evidence: the pivot grand total is 3,010, with every page field `(All)`. *Would change if:* the owner wants them to follow the view — one flag; the panel already says which it is showing.
- **A11 · `Other` is one record.** Evidence: Black Birch Projects, 1 (F0-16). It stays a named channel with a real hue because it carries meaning, but the page will read as three channels plus a rounding line, and that is correct.
- **A12 · The retired opening book re-dates cleanly.** Evidence: it only ever stored case number + sale date (`detection.vtOpeningBook.takeOnly`), from the same sheet. *Would change if:* an opening-book date is later found better than the Schedulers Data date — `sold_basis` records which won, so it is a query, not an archaeology.

### Decisions taken (do not reopen)

- **D1 · Schedulers Data becomes an upload** with its own slot, superseding *Opening book (once)*. It supplies Scheduler (`J`), GWP (`E`) and the true sale date (`B`). (Owner.)
- **D2 · The workbook's targets are authoritative for this dashboard** — fitment rate 80 % flat, cancelled 5 %, scheduled 10 % split 75/10/5/5/5, headcount 6, sales 2,066 / 179 / 785 = 3,030, fitments 1,653 / 143 / 628 = 2,424 — in the rule book with their Sales Review cells, never in page code. **The agent rating does not change** (two drivers, Target Achievement 50 / Fitment Rate 50, and its per-sub-campaign fitment budgets, settled 2026-11-24 after an executive review). (Owner.)
- **D3 · Each screen labels which target it is measuring against.** The dashboard's fitment target is **80 % flat (Sales Review B63)**; the agent card's is **that agent's sub-campaign budget (85 % digital / 85 % referral / 80–70 % predictive by tenure)**. The dashboard's bucket shares are **75/10/5/5/5 (Sales Review B94…B118)**; the rating-side `budgets[cycle].hrsShare` is **80/10/5/5** from a different workbook (`Sales_Review_YTD 2026.xlsx` `'VT Digital'!N…`). Both are real, both stay, each is cited where it is shown. The bucket shares are **not scored** (`rating.notScored.hrsAhead`), so nothing about any score is at stake.
- **D4 · "Budget vs Spend" is sales against the 3,030 cycle sales budget with the straight-line forecast beside it.** No spend, no cost, ever invented. (Owner.)
- **D5 · The lead-time bucket is computed from the FROZEN extract date, not `TODAY()`.** The engine's existing `hrsAsAt = latest extract + 1 day`. **Reasoning:** (a) on the owner's own file the two bases are *the same day* — `TODAY()` was 2026-11-24 when the workbook last calculated and the frozen as-at is also 2026-11-24, so the frozen basis reproduces the workbook's buckets exactly (F0-14); (b) the suite's standing rule is **one number, one verdict** — a published digest may not change meaning without a new upload, and a `TODAY()` basis would silently relabel a closed cycle's pipeline every night; (c) the engine has no clock anywhere by design (`model` takes every "today" in), and introducing one would break `verify-vt-periods.mjs` and the digest's reproducibility; (d) the workbook itself names this as an open question (guide §5 and §16: "Whether historical Hrs Ahead buckets should recalculate with TODAY() or be frozen at booking time") — we answer it the way the rest of the suite already answers it, and the page states the as-at date on the panel so the reader knows what it is relative to.
- **D6 · The fifth bucket is display only.** `72+` splits into `72+ in cycle` and `72+ out cycle` for the page, the MTD Hrs Ahead table and the TL/CM VT report table. The agent score, its drivers, its weights and its fitment budgets are untouched (FR-033).
- **D7 · The two donuts become the forms the data's job asks for** — this is the one place the build departs from the owner's mockup, and it is flagged for him. Channel Performance (one whole, four parts, read at a glance) becomes a **tall segmented bar with a legend**; Campaign Breakdown (seven parts, two of them 38 and 1) becomes **ranked horizontal bars, largest first, one hue**, with the Panimax roll-up as a labelled sub-total. The ring the mockup's eye expects is kept where it is *correct* — **Target Achieved**, a single ratio against a limit, uses the suite's existing `ringSVG` meter. Reason: a donut cannot be read for rank or for close values, and two of the seven campaigns are 1.3 % and 0.03 % of the whole; segments laid end to end would hide exactly the figures the panel exists to show. *Would change if:* the owner says he wants the ring shape regardless — it is one function in the chart kit and the data is identical.

### The guide's own §16 open questions

| §16 question | Status |
|---|---|
| What does **Missed** mean operationally (no-show / failed contact / other)? | **Needs the owner.** The engine takes `Missed Fitment` from the Scheduled & Missed export and never interprets it further; no number on the page depends on the answer, but the floor guide's wording does. → **Q1** |
| Should **Sale Count** always be 1 per row; how are duplicate case numbers handled? | **Resolved from the workbook** (A2): 1 per row, zero duplicates in 3,010 records. The intake will refuse a file with a repeated case number. |
| Currency and adjustment / rounding rules for **GWP**? | **Partly resolved.** The values are whole rand, as typed (99, 149, 189, 199, 209, 229, 359 …). Whether they are VAT-inclusive and how they relate to the BI charge needs the owner. → **Q2** |
| Who approves **budgets, headcount and target percentages**? | **Needs the owner.** They are rule-book values with a dated `_changes[]` entry; the entry needs a name. → **Q3** |
| Should historical **Hrs Ahead** buckets recalculate with `TODAY()` or be frozen? | **Resolved — frozen** (D5), with the evidence that the two bases agree on the owner's own file. |
| Is the **campaign mapping** complete; should all unmapped campaigns default to Other? | **Resolved for this cycle** (F0-16): all seven campaigns present are mapped; zero unmapped. The rule stays "unmapped → Other", and the page names any unmapped campaign so the map can be extended. |

### Open questions that genuinely need the owner

- **Q1** What does **Missed** mean on the floor — a customer no-show, a failed fitment attempt, or a booking the fitter never reached? It changes the wording of the Key Insights and the floor guide, not a number.
- **Q2** Is Schedulers Data **GWP VAT-inclusive**, and is it meant to agree with the BI charge? Until answered, both are shown and named (A7).
- **Q3** **Who approves** the budgets, the headcount and the target percentages? The `_changes[]` entry needs that name.
- **Q4** The **`72+ in cycle` bucket is unreachable in the last three days of every cycle** (F0-15) — its 5 % share cannot be hit. Should that 5 % migrate to `72+ out cycle` late in the cycle, or is a zero there the intended signal?
- **Q5** Should the **previous-cycle deltas be back-built** from the Schedulers Data sale dates (which reach back to 2026-08-21), or left reading "—" until `cycle-2026-12` gives the page its first real comparison? (A9.)
- **Q6** The **scheduler spread is 62.3 % to 84.9 % fitted** (F0-17). Is there a per-scheduler target, or is the floor target (80 %) the only one? There is none in any source.

---

## Correction, 25 Nov 2026 — the daily exports build this report

The owner, after the first deploy:

> "the report for vehicle tracking needs to be build by the reports in the upload station, we are not going to be
> uploading this master every month, that is the example which we need to get with the current data"

`Master November 2026 - VT Report.xlsx` is the **example of the output**, not a monthly input. This reverses the
*framing* of decision D1, not the engine's behaviour.

### What was measured before changing anything

Cross-referenced the master's `Schedulers Data` sheet (3,010 cases) against the 10 Nov daily exports. The daily files
carry **none** of the sheet's three facts, so nothing could be re-sourced:

| Fact | Result |
|---|---|
| Scheduler | 6 names in the master. `Last Modified By` has **74 distinct values, 0 exact matches** (380/1,078 loose first-name hits, ~35%). Internal/External Consultant: 4–5 values, **0 matches**. `Created By`: 47 values, 0 matches. |
| GWP | **No column equals it**, and the bundle does not determine it — "Beam-e Budget" is both 99 and 199; up to **12 distinct GWP per `Product Bundle`**. |
| Sale day | `Fitment Date` is later than the sale on **1,078/1,078** rows. `Contract Create Date` / `Installation Date`: later on 1,859/1,867, median **+4 days**, max **+62**. `Account Create Date` matches only **11/1,867** — an existing customer's account can predate the sale by **6,203 days**. |

### What changed

Nothing in the engine. `saleDay.basisPrecedence` already reads `schedulers_data > opening_book > first_seen`, so a
sale **first seen after the book opened is dated by its own daily upload**. What changed is that the page no longer
presents the sheet as a requirement, and no longer blanks itself over history it cannot date:

1. The top banner is now **"Two panels wait on the Schedulers Data sheet"** — it names the two panels and says the
   rest is built from the daily exports, an occasional extra and not a monthly chore.
2. The no-uploads state says the two daily exports build the report; the sheet is optional.
3. **The whole-page gate now explains itself.** A case already open when VT reporting started carries no sale day at
   all, so it belongs to no business month. The page names how many, says they predate the book, states that no daily
   export carries the day a sale was made, and says every sale from the next daily upload onward is dated by it.
4. The two integrity rows that said a sale date "arrives with the next Schedulers Data sheet" now say what is true: a
   new sale is dated by its own daily upload; the sheet is what dates pre-book history.

### Consequence for the owner

Upload only the two daily files and the dashboard fills from that day forward. The scheduler pivots and the
hand-typed GWP stay empty — never zero — until the sheet is loaded, which may be once, occasionally, or never.
`migration-073` uses `coalesce`, so a daily upload can never blank what a past sheet filled in.

**Guards:** `verify-vt-dashboard` 173 (3 new: the undated book is named and explained, the daily-upload sentence, no
zero painted), `verify-vt-rules` 72 (1 new: the dated `_changes` entry and its measurement must survive).
