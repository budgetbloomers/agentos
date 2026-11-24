# Feature Specification: Vehicle Tracking (VT) Analytics

**Feature Branch**: `feature/vt-analytics` (Spec Kit 071) | **Created**: 2026-11-23 | **Status**: Draft, ready to build

**Input**: The owner's instructions, quoted exactly; they are final.
> "I gave you excel sheets which are the scheduled, agent and list and bi active will be used to create a new tab on agent
> vehicle tracking so we removing everything from the old vehicles tracking and creating a new tab like how we have for vas
> analytics … we need to build the month to date, daily and weekly out, like how we have done for vas analytics, where we
> upload the 3 in the upload station, and it will apply the pivots, matching formula etc to build these reports like we did
> for vas, and build the agent composite score for the agent analytics because there will be agent view for vehicles tracking."
> "the score needs to be for the agents analytics, this is for vehicles tracking now, when the agent list is uploaded, you will
> see vehicles tracking agents." · "we are going to build another score for vehicles tracking agents so when they login their
> kpi will be different" · "you will get all the answers from the files I gave you, and kpi you did choose is fine, remove the
> old tracker, it must match vas analytics." · "optimize the supabase database to cater for all these files, as well".

**Evidence base** (read these first): `specs/vt-analytics/workbook-rules.md` (how the owner's workbook works, proven
cell by cell), `specs/vt-analytics/current-state.md` (the old Tracker and the VAS pipeline), and the five files in
`../reference/zips/vt/`. Every number in this spec is traced to a cell or to a decision (D1–D12) in §9. People are named by
CB number only. No customer data appears here.

## 0. What the files settle (found 2026-11-23, read-only)

| # | Finding | Evidence |
|---|---|---|
| F1 | **The Agent List `Target` is sales per working day (SPD), and it equals the November budget.** Digital 6.5, Referral 3, Predictive Exp 2 / M2 1.5 / M1 1. | `Sales_Review_YTD 2026.xlsx`: `VT Digital!N20`=6.5, `VT Referrals!N12`=3, `VT Predictive!N46:N48`=2/1.5/1 (Nov block = col N, "26 Oct to 25 Nov 2026"). Matches `Matrix - Agent List.xlsx` `VT!I` for every sales row. This closes workbook-rules open question 10; the earlier 7 / 2.5 were the September/October budgets (cols B/H). |
| F2 | **The business month runs from the 26th to the 25th**, and it is named after the month it ends in. | Sales Review row 2 headers ("NOVEMBER 2026 \| 26 Oct to 25 Nov 2026"); report "Current" = sale date ≥ 26 Oct (1,399 rows, clean split); `worker/src/cycle.mjs` already defines this cycle (`cycle-YYYY-MM`). |
| F3 | **Fitment budgets**: Digital 85 %, Referral 85 %, Predictive Exp 80 % / M2 75 % / M1 70 % (overall 80 %). | `VT Digital!N45`, `VT Referrals!N17`, `VT Predictive!N70:N73`; `VT Scheduling!N16` (80 % floor-wide). |
| F4 | **Missed budget = 5 % of sales** for every sub-campaign. | `VT Scheduling!N22/N7` = 103.3/2066, `N24/N9` = 8.95/179, `N25/N10` = 39.25/785 (all exactly 5 %). |
| F5 | **Scheduling-speed budgets** (share of open Scheduled cases): 24 h 80 %, 48 h 10 %, 72 h 5 %, 72 h+ 5 %. | `VT Scheduling!A41,A46,A51,A56` labels. |
| F6 | **Cancellation budget 5 %**, but no upload carries a cancellation: BI Active Fitted is active-only (Contract Status "Active" on all 19,404 rows; "Contract Deactivate Date" present but blank on every row; it holds only contracts created in the current business month), and the S&M "Status" holds only 1st/2nd/3rd attempt, New, In Progress. **But the hand report shows how a cancellation appears:** of the 93 current-month sales in NEITHER 10 Nov file it marks 90 Cancelled (97 %); of the 175 older (rollover) sales in neither file, 114 Cancelled, 54 Scheduled/Missed, 7 Fitted. So Cancelled is DERIVED (A13). | `VT Digital!N55`; workbook-rules §5 cause 2; `verify-vt-oracle` R10. |
| F7 | **BI `Contract Create Date` and `Installation Date` are the FITMENT date, not the sale date.** They are equal on 1,103 of 1,107 VT lines and fall 0–15 days after the report's sale date (mode +1). | Scratch analysis of `BI Active Fitted 101126.xlsx` cols O, Q against report col B. |
| F8 | **No upload carries a sale date.** Case Numbers are issued in sale order: sorted by Case Number, the report's sale dates are out of order only 5 times in 2,024 rows. All 1,309 non-cancelled "Current" report sales (832 F + 374 S + 103 M) are present in that day's two uploads (830 Current cases in BI and 479 in S&M). So **the day a case first appears in a daily upload is its sale day** (within a day). | Report `Schedulers Data` A/B/F/K; inputs C/AS. |
| F9 | **The workbook's GWP is a bundle price incl. VAT (R99/189/199/209/229/359…), not the Charge Amount.** Σ Charge Amount × 1.15 equals the report GWP for only 328 of 1,104 fitted cases. S&M has no amount at all. The budgets' Avg GWP (Digital 166, Referral 199, Predictive 169) are on the bundle-price basis. | `BI!X`/`AD` (identical on 1,107 of 1,107 VT lines) against report col E; `VT Digital!N35`, `VT Referrals!N15`, `VT Predictive!N60`. |
| F10 | VT lines in BI = Unit Type (first column, Y) ∈ {BEAME, MXV, Matrix Vision}: 1,107 lines / 1,104 cases = exactly the report's Fitted paste column. | workbook-rules §1.1. |
| F11 | The real BI headers VAS BI lacks: `Installation Status`, `Vehicle Reg Number`, `Box Number`, `Fitment_Case_Created_By`, `Fitment Centre Name`, `Unit Type`. S&M is unique on `MissedAndScheduledFitment` + `Fitment Date`. | Header dump of both files. |
| F12 | Hrs Ahead in the report was computed with TODAY = 11 Nov on files named `101126` (extract 10 Nov). | workbook-rules §1.4 (328/328 cached values). |

## User Scenarios & Testing *(mandatory)*

### User Story 1: The Ops uploader loads the three files and the VT reports build themselves (Priority: P1)
The person who runs the Upload Station each morning drops `BI Active Fitted <ddmmyy>.xlsx`, `Scheduled & Missed <ddmmyy>.xlsx`
and (when it changes) `Matrix - Agent List.xlsx` into the **same** VAS Upload Station. The VT engine matches the files on Case
Number, applies the workbook's status rules, attributes each sale to its seller, and the Vehicle Tracking reports update.

**Why this priority**: nothing else exists without intake. It is also the riskiest step, because BI Active Fitted looks like
VAS BI and would otherwise overwrite VAS money.

**Independent Test**: load the three sample files into a fresh station in a test harness. Every one of the 1,756 cases that
carries a status gets the report's Result, and VAS state (`kv:vas-state`) is byte-identical before and after.

**Acceptance Scenarios**:
1. **Given** an empty VT book, **When** `BI Active Fitted 101126.xlsx` is dropped, **Then** it is recognised as *VT · BI Active
   Fitted* (never as VAS BI). 1,104 cases are recorded Fitted, and the receipt states: file, extract date 10 Nov 2026, VT lines
   1,107 of 19,404 rows, cases 1,104, sellers matched/unmatched (names of the unmatched), and "VAS money unchanged".
2. **Given** the same, **When** `Scheduled & Missed 101126.xlsx` is dropped, **Then** 499 cases are Scheduled and 153 Missed.
   The 4 cases also in BI stay Fitted, and the 2 BI cases that are only "Recovery Service" lines stay Missed.
3. **Given** the same file is dropped again, **Then** nothing changes and the toast reads "already uploaded".
4. **Given** a BI Active Fitted file whose VT case count is under 90 % of the last BI file's count in the same business month,
   **Then** it is refused as a thin pull, with both counts in words. Nothing is written.
5. **Given** another station saved the VT book a moment earlier, **When** this upload commits, **Then** the commit is refused
   as a version conflict. The station re-reads the book, re-applies the file, and commits once. The user sees one receipt.
6. **Given** the Agent List is uploaded, **Then** VT agents appear on the VT pages under their sub-campaign and team leader.
   The VAS roster behaviour is unchanged.
7. **Given** a VT file is dropped on the **Ops** Upload Station, **Then** Ops refuses it with "This is a Vehicle Tracking file.
   Load it in the VAS Upload Station" and stores nothing.

### User Story 2: A VT agent signs in and sees their own VT rating (Priority: P1)
A Digital, Predictive or Referral sales agent opens Agent Analytics and sees the **VT agent rating** card. It works like the VAS
card: a score out of 100, a tier, one row per driver with value / target / bar / points / "At target" or "To go", "points
available", "How the score works", "Open my session brief", and "Ask my team leader". The drivers are VT ones.

**Why this priority**: it is what the owner asked for in his own words ("when they login their kpi will be different").

**Independent Test**: publish a VT digest from fictional fixtures and open Agent Analytics as a fictional VT agent. The card
shows the two VT drivers (Target Achievement, Fitment Rate) plus the unscored "For your information" lines, and no VAS
driver, no VAS commission calculator and no R99 floor. A VAS agent's response and
rendered page are byte-identical to the build before this feature.

**Acceptance Scenarios**:
1. **Given** a VT Digital agent with VT cases this business month, **Then** they see the VT card with two driver rows,
   Target Achievement and Fitment Rate, each using the engine's numbers and verdicts. Under them, "For your information — not
   part of your score" shows Missed and Cancelled (count and % of sales, beside the 5 % budgets) and Fitments done this month,
   with no pill and no points (rule book vt-1.2, §6).
2. **Given** a VT agent with no cases yet this month, **Then** they see "No <Month> figures yet" with a link to last month
   (final), never a zero score.
3. **Given** a VT Scheduling agent, **Then** they see "Scheduling agents are not rated yet: the uploads do not say which
   scheduler handled a sale". They also see the team's scheduling-speed figures as context.
4. **Given** a VAS agent, **Then** nothing on their page or in their API response changes.
5. **Given** an agent on neither digest, or a non-VT agent found only as `notCovered` with `why:'campaign'`, **Then** the
   "different scheme" notice shows. This is the fix for the `notReported` empty-card bug, current-state §B2.

### User Story 3: A VT team leader reads their team's Month to date, Weekly and Daily reports (Priority: P2)
Team leaders CB194 (Digital), CB104 (Referral + Scheduling), CB360 and CB358 (Predictive) open the Reports tab and see VT
reports for their own agents, laid out like the VAS team reports, with .xlsx export.

**Independent Test**: with a fictional VT digest, a fictional VT TL sees only their own agents, and the export holds one sheet
per report with the same figures as the screen.

**Acceptance Scenarios**:
1. **Given** a VT TL, **When** they open Reports, **Then** the tabs read "VT Month to date / VT Weekly / VT Daily" and the rows
   are their agents plus a team total.
2. **Given** an agent who moved team this business month, **Then** the agent shows under the team on the latest list for the
   whole business month (the whole-month rule).
3. **Given** they press Export, **Then** a file `TL VT <report> - <team> - <period>.xlsx` downloads.

### User Story 4: The VT campaign manager sees VT campaign views (Priority: P2)
The campaign manager whose scope includes VT sees VT campaign cards and reports. These have sub-campaign totals (Digital,
Predictive, Referral; Scheduling separate) and a lead-source breakdown (Lead Gen: Revx / Tracking Empire / Jag / Afrilead;
Predictive; Referral).

**Acceptance Scenarios**:
1. **Given** a CM with VT in scope, **Then** a VT campaign card appears beside their VAS cards. Their VAS cards are unchanged.
2. **Given** they pick a past business month, **Then** the VT history key for that month is served.

### User Story 5: An executive or manager reads the VT pages in VAS Analytics (Priority: P2)
A management user with the VT tabs picks **Vehicle Tracking** in the app dropdown (D13; until 2026-11-24 a group inside VAS Analytics) and opens **Month to date / Weekly / Daily**. They filter by
team leader, sub-campaign and lead source, and export .xlsx, exactly as on the VAS pages.

**Acceptance Scenarios**:
1. **Given** the sample files, **When** Month to date for business month 2026-11 is opened, **Then** the floor totals equal the
   case-level reproduction (Fitted 1,104, Missed 153, Scheduled 499 on the reproducible rows), and the
   Hrs Ahead buckets for open Scheduled cases are 136 / 83 / 99 / 181. These are the 499 reproducible rows; the report shows
   139/84/105/189 because it also counts 18 Scheduled rows left over from earlier days.
2. **Given** a user without the VT tabs, **Then** the VT pages are absent from the navigation and refuse to render.

### User Story 6: The old Tracker is gone (Priority: P1)
`/tracker/` no longer exists, nothing links to it, and no page ships the July seed data with real first names.

**Acceptance Scenarios**:
1. **Given** the built site, **Then** `site/tracker/` does not exist. The app switchers in Ops and PULSE have no "Tracker
   Analytics". `auth-gate.js` has no `tracker` app.
2. **Given** an account that had only the `tracker` management grant, **Then** before the removal deploys it has been given the
   VT tabs in `vas`, so the person keeps a management view (the grant tool runs as a dry run first; the owner applies it at deploy).

### Edge Cases
- A case in both S&M Missed and BI on the same extract → Fitted (3 cases in the sample). A case in both S&M Scheduled and BI →
  Fitted (1 case).
- A Fitted case that later drops out of BI (a new month's filter) → stays Fitted: absence never cancels a fitted unit. A
  BI row that carries a Contract Deactivate Date (or a Contract Status other than Active) → Cancelled, reason
  `deactivated`, winning over Fitted (A13; the current files never fill it).
- A Scheduled or Missed case that is in NEITHER file of a complete extract day (both files of that date committed) →
  Cancelled, reason `dropped`, as at that day (A13). One file of a day alone never cancels anything; a skipped day cancels
  nothing by itself; a late file for an older day neither cancels nor un-cancels. If a later file carries the case again it
  takes that file's status (one event, still one sale).
- A Missed case later appears as Scheduled in a newer S&M (re-booked, "2nd attempt") → Scheduled, and the Missed event stays in
  the case history (Daily/Weekly "missed appointments" still count it).
- An OLDER extract uploaded after a newer one → it may fill fields that are still blank, but never changes a status decided by
  a newer extract.
- The footer rows ("Applied filters: …", "No filters applied") and blank Case Numbers → skipped and counted in the receipt.
- A file with no ddmmyy in its name → the extract date is today (SAST), and the receipt warns "extract date assumed".
- A seller on no Agent List sheet → excluded from agent rows, counted as unmatched (7 sellers, 49 BI + 17 S&M cases in the
  sample). The CB342 one-letter variant resolves through near-spelling.
- `Target` "-" (Scheduling rows) or blank → no target, so Target Achievement is unmeasured, never 0 (Fitment Rate alone is then out of 100).
- An agent with fewer than 5 cases in a rate's denominator → the rate is shown but not scored (renormalised).
- A Saturday sale or fitment → counted as data, never as a working day (VAS `dataOnlyDay` rule).
- First upload into an empty book (go-live) → see A6: opening-book cases have no sale day.

## Requirements *(mandatory)*

### Functional Requirements

**Intake (Upload Station, PULSE)**
- **FR-001** The station MUST classify a sheet as `vtBiFitted` when its header row contains all of `installation status`,
  `vehicle reg number`, `box number`, `unit type`, `case number`, `created by`. This check MUST run BEFORE the VAS `bi` /
  `inactive` rules.
- **FR-002** The station MUST classify a sheet as `vtSchedMissed` when its header contains `missedandscheduledfitment`,
  `fitment date`, `case number`.
- **FR-003** The station MAY classify the hand-built report's `Schedulers Data` sheet as `vtOpeningBook` (headers `month`,
  `date`, `agent`, `case number`, `result`). From it, only the sale date of each case is taken (A6). Its Result, GWP, Scheduler
  and customer contact are never stored.
- **FR-004** VT files MUST NOT enter `vas-state`, the VAS money store, the raw-file relay (`/api/upload-archive`) or the Rake. Ops
  `detectSource` and PULSE `rakeDetect` MUST refuse them by the same signatures.
- **FR-005** De-duplication by SHA-256 of the bytes: a hash already committed is skipped ("already uploaded"), in the browser and
  again in the database (unique key).
- **FR-006** Validation refusals with reasons: no VT lines; missing required columns (named); thin BI pull (VT cases < 90 % of
  the last BI file of the same business month); S&M with < 40 % of the previous S&M's cases (refused unless "this is a genuine
  quiet day" is ticked; the tick is logged on the receipt).
- **FR-007** Only the columns in plan §DB-4 "stored" are kept. Customer name, phone, registration, chassis, box, account and
  contract numbers are dropped in the browser and never leave it.
- **FR-008** A commit is compare-and-set on the VT book revision. A conflict re-reads, re-merges and retries up to 3 times, then
  says so in a persistent banner (save-reliability rules).
- **FR-009** Every committed file produces a visible receipt (Upload Station card and toast): kind, extract date, rows, VT
  lines, cases, status changes (new / Fitted / Missed / Scheduled), sellers matched and unmatched by name, warnings.

**Case book and status (VT engine)**
- **FR-010** One record per Case Number holds the last known status and every field a file supplied (plan §DB-2).
- **FR-011** Status from one extract: in the BI VT set → Fitted; else S&M "Missed Fitment" → Missed; else "Scheduled Fitment" →
  Scheduled (precedence Fitted > Missed > Scheduled).
- **FR-012** Across extracts: the newer extract decides between Missed and Scheduled. Fitted is terminal. A case absent from
  both files keeps its status (sticky). An older extract never overrides a newer one's status.
- **FR-013** Every status change is written as one event (case, date, from, to, the appointment date at that moment). There is
  never a daily snapshot of the book.
- **FR-014** The sale day = the extract date of the first upload that carried the case (`first_seen`). Exception: a case in the
  opening book (FR-003) takes the report's sale date. Opening cases without either have no sale day (A6).
- **FR-015** Fitted day = BI `Installation Date` (Q; `Contract Create Date` (O) when Q is blank). Appointment day = S&M
  `Fitment Date` (R).
- **FR-016** The seller = S&M `Created By` (S), else BI `Created By` (L). Strip `- Panimax`, collapse spaces, case-fold, then
  resolve through the Agent List identity (aliases, one-typo near-spelling), then a VT-only unique first-and-last-token match.
  If none resolves, the seller is unmatched.
- **FR-017** Lead source = Salesforce Source Partner (S&M A / BI AP), folded per rule `leadSources`. "Panimax - New Sales"
  becomes Referral when the seller's team is Referral, otherwise Predictive. "Sales Enablement" is reported as its own line,
  never re-labelled.
- **FR-018** Attribution (team leader, sub-campaign, tenure, target, role) comes from the Agent List in force for that business
  month (the latest list dated within the month, else the latest before it; the whole-month rule). It is read from the roster
  of record (`/api/roster` + `vt_roster_at`).

**Periods**
- **FR-020** Business month = 26th → 25th, keyed `cycle-YYYY-MM` by the month it ends in (`cycle.mjs`). Rule `periodStartDay: 26`.
- **FR-021** Weeks run Monday to Saturday and are clipped to the business month. A Sunday row joins the week of the Monday before.
- **FR-022** Working day = Monday–Friday that is not an SA public holiday (VAS `dataOnlyDay`). Saturday is data, not a working day.
- **FR-023** The as-at date for Hrs Ahead = the latest extract date + 1 day (rule `hrsAheadAsAtOffsetDays: 1`, F12).

**Reports**
- **FR-030** Month to date, Weekly and Daily report pages under a "Vehicle Tracking" group in VAS Analytics, with the columns in
  §5, at agent, team-leader, sub-campaign and lead-source level. Filters: team leader, sub-campaign, lead source.
  .xlsx export, one sheet per report.
- **FR-031** The same reports for TLs and CMs in Agent Analytics, painted from the published VT digest (no maths on the page).
- **FR-032** Unmatched sellers appear as one "Unmatched sellers (n)" line in the floor totals, never as agent rows.
- **FR-033** Scheduling agents are listed under Scheduling with "not rated in v1".

**Rating (Agent Analytics)**
- **FR-040** The VT rating is computed in the VT engine from the rule book (§6). The Worker attaches nothing VAS-specific, and
  the page paints it.
- **FR-041** A VT agent (roster campaign `VT`, sub-campaign not Scheduling) gets `scorecard:'vt'`. A VAS agent's payload is
  unchanged byte for byte.
- **FR-042** Missing drivers renormalise, and the effective weights are published so the card still adds up.

**Publishing and serving**
- **FR-050** Live digest `kv:vt-digest` (current business month, SAST) and history `kv:vt-digest-cycle-YYYY-MM`. Staff-only
  writes (`GUARDED_KV`). An empty payload never overwrites one with data. Rollover grace: the previous business month may stay
  live until the current one publishes.
- **FR-051** The Worker serves VT scopes (agent / team / campaign / staff) from the digest only. It never parses the case book
  on a portal request.

**Removal, permissions, guards**
- **FR-060** Remove the Tracker Analytics app and its traces (plan §R). Keep everything in current-state list (b).
- **FR-061** New VT tab ids `vt_mtd`, `vt_weekly`, `vt_daily` under the `vas` app. `tools/audit-permissions.mjs` knows them, and
  a grant tool (dry run first) maps every holder of the `tracker` grant onto them.
- **FR-062** Each rule has a guard written first (plan §T). The existing VAS suites pass before and after, as proof that nothing
  changed.

**Database (D12)**
- **FR-070** VT facts live in dedicated Supabase tables (`vt_cases`, `vt_case_events`, `vt_uploads`, `vt_upload_stage`), written
  only through Worker-called RPCs. They have RLS on, no anon/authenticated access, and EXECUTE revoked from
  public/anon/authenticated.
- **FR-071** No full daily snapshot is ever stored. Growth stays under 5 MB per business month at today's volumes. Events and
  receipts are trimmed after 13 business months, and staging after 1 day.
- **FR-072** Reads at request time go through one RPC returning one JSON value (no PostgREST paging), or through the published
  digest.

### Key Entities
- **VT case**: one sale, keyed by Case Number. It holds the current status, status date, sale day and its basis, appointment
  day, fitted day, products, bundle, Charge Amount (ex VAT), lead source (raw + folded), seller name (normalised), seller CB
  and match method, first/last seen, and the last upload.
- **Case event**: one status change of one case on one extract date.
- **VT upload**: one file. It holds the hash, kind, extract date, counts, unmatched sellers, warnings, who, when, and the book
  revision after commit.
- **VT agent** (from the Agent List VT sheet): CB, sub-campaign (Digital / Predictive / Referral / Scheduling), team leader,
  tenure, role, target (SPD), for each business month.
- **VT digest**: the published per-business-month payload (plan §P).

## 5. Report definitions

Notation: *in play* (MTD) = cases sold in the business month (**Current**), plus cases sold earlier (**Rollover**) that were open
(Scheduled/Missed) at any point in the month or were fitted in it. This is the workbook's pivot with Month = (All). *Cohort*
columns split a set of sales by their status **as at** the report date (exactly as the workbook's Result columns do). *Activity*
columns count events on their own date. Rates use the same set's sales as the denominator (workbook `GETPIVOTDATA` ratios).

| # | Column | Formula | Source (file · column) | Date basis | MTD | Weekly | Daily |
|---|---|---|---|---|---|---|---|
| C1 | Agent / Team leader / Sub-campaign / Lead source | row key | Agent List VT!A,C,E,F,G,I; Source Partner S&M A / BI AP | business month's list | ✓ | ✓ | ✓ |
| C2 | Sales | count of cases in the set | Case Number S&M C / BI AS | sale day (FR-014). MTD = in play | ✓ | ✓ | ✓ |
| C3 | of which Current / Rollover | split of C2 by sale day vs period start | — | sale day | ✓ | – | – |
| C4 | Fitted | C2 cases with status Fitted | BI VT set (Unit Type Y) | status as at | ✓ | ✓ | ✓ |
| C5 | Scheduled | C2 cases with status Scheduled | S&M U = "Scheduled Fitment" | status as at | ✓ | ✓ | ✓ |
| C6 | Missed | C2 cases with status Missed | S&M U = "Missed Fitment" | status as at | ✓ | ✓ | ✓ |
| C7 | Cancelled | C2 cases with status Cancelled (0 when none) | DERIVED (A13): a Scheduled/Missed case in neither file of a complete extract day (`dropped`), or a BI row with a deactivate date (`deactivated`) | status as at (the event's day: the complete day it dropped out / the deactivate date) | ✓ | ✓ | ✓ |
| C8 | Fitted Rate % | C4 ÷ C2 | — | — | ✓ | ✓ | ✓ |
| C9 | Missed Rate % | C6 ÷ C2 | — | — | ✓ | ✓ | ✓ |
| C9a | Cancellation % | C7 ÷ C2 (C2 = ALL the set's sales: a cancelled sale stays in Sales), beside the 5 % budget (`budgets[cycle].cancelled`, F6) — shown, never scored | — | — | ✓ | ✓ | ✓ |
| C10 | Scheduled Rate % | C5 ÷ C2 | — | — | ✓ | ✓ | ✓ |
| C11 | Fitments done | events → Fitted dated in the window | BI Q (Installation Date) | fitted day | ✓ | ✓ | ✓ |
| C12 | Missed appointments | events → Missed dated in the window (by appointment day) | S&M R | appointment day | ✓ | ✓ | ✓ |
| C13 | Due to fit | open Scheduled cases with appointment day in the window | S&M R | appointment day | ✓ | ✓ | ✓ |
| C14 | Hrs Ahead 24 / 48 / 72 / 72+ / Past due | open Scheduled cases by (appointment day − as-at) = 0 / 1 / 2 / ≥3 / <0 | S&M R | as-at (FR-023) | ✓ | – | – |
| C15 | Hrs Ahead share vs budget | C14 ÷ open Scheduled, beside 80 / 10 / 5 / 5 % | `VT Scheduling!A41..A56` | as-at | ✓ (team, sub-campaign, floor rows only) | – | – |
| C16 | Working days | Mon–Fri non-holiday days from max(period start, agent start) to the last extract date | calendar | — | ✓ | ✓ | – |
| C17 | SPD | C2 (Current sales only) ÷ C16 | — | sale day | ✓ | ✓ | – |
| C18 | Target SPD | Agent List Target (agent); team = Σ target | VT!I | list in force | ✓ | ✓ | ✓ |
| C19 | % to target | C17 ÷ C18 | — | — | ✓ | ✓ | – |
| C20 | Fitment budget % | rule `budgets[cycle][sub][tenure].fitment` | Sales Review (F3) | — | ✓ | – | – |
| C21 | Fitted value (incl VAT) | Σ Charge Amount (X) of the case's VT lines × (1 + VAT) for C4 cases | BI X | fitted day | ✓ | ✓ | ✓ |
| C22 | Sales without a sale day | opening-book cases with no sale day (shown only when > 0) | — | — | ✓ | – | – |

Rules every column obeys: an absent figure reads "—", never 0 (e.g. C19 with no target; C7 is a real count since A13). Every rate's denominator is C2, all the set's sales, cancelled ones included (the hand report counts Sale Count = 1 on a cancelled row). A fitment done (C11) and its value (C21) stay counted on their day if the contract is later deactivated. Rates are computed only when
C2 > 0. Team and floor totals are sums of counts, and their rates are ratios of sums, never a mean of agent rates.
C21 is labelled "Charge Amount basis, not the bundle price" (F9). The workbook's scheduler pivots (PD sheets) are **not**
built in v1: no upload names the scheduler (workbook-rules §3.4).

## 6. The VT agent rating

**Same mechanics as VAS** (`COMPOSITE_RULES` / `compositeFor`): each driver's attainment `att = clamp(v / t, 0, 1)` (for
lower-is-better drivers `att = clamp(t / v, 0, 1)`, with `v = 0` giving `att = 1`). Points `= round(w × clamp((att − 0.5) / 0.5, 0, 1), 1)`,
so points start at half of target (`floor 0.5`). The score is `raw ÷ Σ measured weights × 100`, so unmeasured drivers renormalise.
Tiers are the VAS bands: **Elite ≥ 90 · Strong ≥ 80 · On track ≥ 70 · Building ≥ 60 · Needs support < 60**. The card shows
"At target" when `v ≥ t` (`v ≤ t` for lower-is-better), otherwise "To go". Since rule book **vt-1.2** (2026-11-24) no scored
driver is lower-is-better; the lower-is-better path stays in the engine, tested (`verify-vt-rating`), for future use. The page shows "points available" (`w − pts`), the
weakest driver and points to the next tier. There are no penalties and no ranking against colleagues. The page never
recomputes.

| Driver (key) | Measure | Target and source | Weight | Direction | Scored when |
|---|---|---|---|---|---|
| **Target Achievement** (`targetAch`) | Current sales ÷ working days (C17) | Agent List `Target` for the agent in this business month (VT!I; = November SPD budget, F1); tenure-aware because the list is | **50** | higher | target > 0 and ≥ 5 tracked working days (A6) |
| **Fitment Rate** (`fitRate`) | Fitted ÷ in-play sales (C8, MTD set) | `budgets[cycle][sub][tenure].fitment`: Digital 85 %, Referral 85 %, Predictive Exp 80 / M2 75 / M1 70 % (F3) | **50** | higher | ≥ 5 in-play sales |

**Shown, not scored** (the card's "For your information — not part of your score" block, under the driver rows; carried as
`rating.info` in the digest; no pill, no bar, no points): **Missed** (count and % of in-play sales, beside the 5 % budget,
F4), **Cancelled** (count and %, beside the 5 % budget, F6) and **Fitments done this month** (C11). In the reports they stay
ordinary columns (C6, C7, C9, C9a, C11).

**Why these weights** (total 100, rule book vt-1.2, 2026-11-24). Two things an agent does: sell (Target Achievement, the one
driver the agent controls fully, its target the list cell the owner already maintains) and get the sale fitted (Fitment Rate,
the revenue event every Sales Review block leads with). They weigh the same. **Missed Rate and Fitted vs target were removed
as double counting of Fitment Rate** (an executive's review, the owner's decision "Two drivers (Recommended)"): once a sale is
scheduled it ends fitted or not, so a missed sale is a sale not fitted, which Fitment Rate already scores; and Fitted vs
target (target × working days × fitment budget) re-scored Target Achievement × Fitment Rate. Under vt-1.1 (35/30/20/15), for
an agent with 60 sales, 3 missed (5 %) scored 20/20 on Missed Rate, 4 missed (6.7 %) 10/20 and 6 missed (10 %) 0/20, and the
same missed sale also lowered Fitment Rate and Fitted vs target: about 12 points for one sale. Now every outcome counts once:
a missed or cancelled sale lowers Fitment Rate only. GWP, scheduling speed, cancellations, attendance, talk time, QA and
conversion stay **not** scored, as before: see D7-a…g in §9.

**Window.** VAS rates the last five worked sessions. VT cannot: a sale is fitted 0–15 days later (median 3, F7), so a
five-day window would rate most of an agent's sales as "not yet fitted". **The VT window is the business month to date**
(26th → latest extract). Rates use the in-play set (Current + Rollover, the workbook's Month = All), so cases sold late last
month and fitted this month count. The card says "your business month to date (26 Oct – 10 Nov)".

**Worked example** (fictional agent CB9101, Digital, Exp, Target 6.5, business month 2026-11, latest extract Mon 9 Nov →
11 working days: 26–30 Oct, 2–6 Nov, 9 Nov). Current sales 57 → SPD 5.18 → att 0.797 → scaled 0.594 → **29.7 / 50**.
In play 66, Fitted 46 → 69.7 % vs 85 % → att 0.820 → scaled 0.640 → **32.0 / 50**.
Score = 29.7 + 32.0 = **61.7 → "Building"**, 8.3 points from On track; 0 of 2 drivers at target. The most points available
are in Target Achievement (20.3; Fitment Rate 18.0). Shown, not scored: Missed 4 (6.1 % of sales, budget 5 %), Cancelled 0
(0.0 %, budget 5 %), Fitments done 44. (Under vt-1.1 the same agent scored 59.7, "Needs support".) These are the engine's
numbers: test fixture `vt-rating-example` in `verify-vt-rating.mjs`.

## Success Criteria *(mandatory)*
- **SC-001** All 1,756 cases carried by the sample uploads get the report's Result (0 disagreements). Per-agent Fitted /
  Scheduled / Missed on reproducible rows equal the report rows restricted to the same cases, for every matched seller.
- **SC-002** All 499 open Scheduled cases get the report's Hrs Ahead bucket (as-at 11 Nov).
- **SC-003** VAS proof of no change: `verify-engine-rules`, `verify-vas-mtd`, `verify-mtd-values`, `verify-composite-score`,
  `verify-agent-card`, `verify-agent-portal`, `verify-cm-view`, `verify-digest-fence` pass before and after. A VAS agent's
  `/api/portal/overview` body is byte-identical on a fixed fixture.
- **SC-004** The three daily files load in under 10 s each in the station (19,404-row BI on a floor PC). No Worker request
  exceeds the free-plan CPU budget (measured in `verify-vt-worker`).
- **SC-005** Database growth is ≤ 5 MB per business month (`vt_*` tables), measured by `db_health`.
- **SC-006** `site/tracker/` is gone and no shipped page contains the old seed names.
- **SC-007** Every VT agent's card equals the engine's verdicts (`verify-agent-card` VT mode, nightly).

## 9. Assumptions and decisions
Each line gives the decision, the evidence, and what would change it. The owner can overrule any of them. Each one is a rule-book
value or a one-line code change.

- **A1 · Target unit = SPD.** Evidence: F1 (the list equals the November SPD budget cell for cell). Would change if: a list
  cell disagrees with the Sales Review SPD budget for its cycle (the station warns).
- **A2 · Business month 26th–25th** (`periodStartDay 26`). Evidence: F2. Would change if: the Sales Review headers move.
- **A3 · Weeks Monday–Saturday.** Evidence: Sales Review "Last 5 Days Run Rate" ranges 19/10–24/10 and 02/11–07/11 (Mon–Sat).
  Would change if: a run rate is quoted over other days.
- **A4 · Working days Mon–Fri without public holidays.** Evidence: Sales Review dialing days Sep 22 and Oct 20 equal exactly the
  weekdays minus Heritage Day. November's budget says 22 against 23 such days (unexplained, recorded). Would change if: the owner
  names the missing day (add it as a one-off in `extraHolidays`).
- **A5 · Sale day = first extract that carried the case.** Evidence: F8. Would change if: a future file carries a sale/created
  date (rule slot `saleDateColumn`).
- **A6 · Go-live / opening book.** The first files into an empty book carry cases sold on earlier days. Their sale day is
  unknown, so they are in play (statuses count) but not counted as sales on any day, and Target Achievement waits for 5 tracked
  working days. Optionally the owner's own report (`Schedulers Data`) can be dropped once to supply real sale days (FR-003).
  This is a fourth, optional, one-off file (a deviation from "the 3", stated). Would change if: the owner declines it (then the
  first business month's TA starts on its 5th tracked day).
- **A7 · Status rules.** Same extract: Cancelled (deactivated) > F > M > S (workbook-rules §3.1, 4 overlap cases). Across extracts: newer wins between
  M and S, F terminal, sticky when absent. Evidence: 178 report rows hold earlier statuses (workbook-rules §3.1). Would change if:
  a cancellation or de-fitment status appears in a file.
- **A8 · "Cancelled" not invented — SUPERSEDED 2026-11-23 by A13** (owner: "ok do the recommend fix"). It read "—" because no
  file carries a cancellation; the hand report showed that a cancellation appears as a sale dropping out of both files (F6).
- **A13 · Cancelled is derived (2026-11-23).** (1) `dropped`: a case whose last status is Scheduled or Missed and which is in
  neither file of a COMPLETE extract day (a BI Active Fitted and a Scheduled & Missed of that date both committed) becomes
  Cancelled as at that day. It is decided by the commit of the day's second file, against that day's two files (whichever
  came first), and only when no later extract day is complete; the station reads the receipts after the book, and the
  database refuses a `dropped` event the upload cannot prove (`bad_cancel`, under the revision lock). Re-sending a file
  changes nothing. (2) A dropped case carried again by a file of its cancellation day or later takes that file's status
  (Fitted > Missed > Scheduled), with one event; it was always one sale. (3) Fitted is never cancelled by absence (the BI
  file only holds the current business month's contracts). (4) `deactivated`: a BI row with a Contract Deactivate Date, or
  a Contract Status other than Active, cancels the case as at that date (never before its previous status day, never after
  the extract), winning over Fitted; only a newer Active BI row reactivates it; the columns are optional. (5) Any age: a
  rollover sale drops out the same way (the 10 Nov evidence is weaker there — 114 of 175 — but its sale month does not
  separate the report's Cancelled from its Scheduled/Missed rows, so no separate rule); the reason (`dropped` inferred,
  `deactivated` explicit) is stored on the case and on the event, and every page says in words that Cancelled includes
  sales that dropped out of both files. (6) The rating was unchanged by A13 (then four drivers, 35/30/20/15): a cancelled sale
  was simply no longer a Missed or Scheduled case. Since D13 (vt-1.2) a cancelled sale is still a sale and is not fitted, so it
  lowers Fitment Rate, and nothing else. Oracle (R10, prior state = the report's Schedulers Data, then 10 Nov complete):
  the rule cancels 259 cases — 204 the report calls Cancelled (90 Current + 114 Rollover; every report-Cancelled sale is
  caught) and 55 the report still calls open (1 Current Missed, 18 Rollover Scheduled, 36 Rollover Missed: the report's
  sticky rows the export no longer carries); no Fitted case is cancelled. Would change if: a file starts to carry a
  cancellation (then it becomes an explicit source like `deactivated`).
- **A9 · Fitment = BEAME / MXV / Matrix Vision** in the first Unit Type column. "Recovery Service" lines alone are not fitments.
  Evidence: F10 (1,104 = 1,104). Would change if: the owner counts Recovery Service.
- **A10 · Seller = Salesforce Created By.** The 11 manual credits in the report are not reproduced. Evidence: workbook-rules §3.2
  (650/656, 1,101/1,106). Would change if: an override list is wanted (`creditOverrides`, empty).
- **A11 · Grouping by the agent's team, lead source secondary** (D4). Evidence: the Agent List is the org of record (CLAUDE.md
  NN11). The report's partner-based grouping is kept as the lead-source breakdown. "Panimax - New Sales" is split by team
  (177/179). Would change if: the owner wants lead source first (a view toggle; the figures exist).
- **A12 · Hrs Ahead as-at = extract + 1 day.** Evidence: F12.
- **D7-a · GWP not scored.** Evidence: F9 (Charge Amount equals the workbook's GWP only 30 % of the time, the budget is on the
  bundle basis, and S&M has no amount). The report shows "Fitted value" on the Charge Amount basis, labelled. Would change if: a
  bundle price list is supplied (rule slot `bundlePrices`).
- **D7-b · Scheduling speed not scored for sellers.** Hrs Ahead is the scheduler's queue age, not something the seller does
  (workbook-rules §3.4). It is shown at team, sub-campaign and floor level against the 80/10/5/5 budgets.
- **D7-c · Attendance, talk time, QA, conversion and opt-ins not scored.** None of them is in the VT files. VT attendance and
  dialler data do sit in `vas-state`, but reading them would couple the VT engine to VAS state (D1 isolation). They are v2
  candidates. Would change if: the owner asks for them (then a read-only projection is published by PULSE, never shared state).
- **D7-d · Schedulers not rated** (scheduler not derivable). They are listed.
- **D7-e · Window = business month to date** (fitment lag, F7).
- **D7-f · Minimum 5 cases / 5 tracked days** to score a driver (the VAS `convMinDataDays` pattern). Below that the driver is
  shown, not scored.
- **D13 · Two scored drivers, 50 / 50 (2026-11-24, rule book vt-1.2) — supersedes the §6 four-driver weights (35/30/20/15).**
  Decision: the owner, "Two drivers (Recommended)", after an executive (Barry) reviewed the score: "you can't have missed and
  fitted — it's double counting … once you have your scheduled, it's either missed or fitted. So if [it's] missed your missed
  would be high and your fitted would be low, so it's a double minus on your score." Evidence: for an agent with 60 sales,
  3 missed (5 %) scored 20/20 on Missed Rate, 4 missed (6.7 %) 10/20, 6 missed (10 %) 0/20, and the same missed sale also
  lowered Fitment Rate and Fitted vs target — about 12 points for one sale; Fitted vs target is Target Achievement × Fitment
  Rate in another form. Now: Target Achievement 50 + Fitment Rate 50; Missed, Cancelled and Fitments done are shown on the
  card, unscored, and stay report columns. Measures, targets, scored-when rules, floor, renormalisation and bands unchanged.
  It landed before the first VT figures were published, so no published score moved. Would change if: the owner wants an
  appointment-keeping measure that is not the same event as an unfitted sale (e.g. missed appointments per booking, C12).
- **D7-g · Budgets for a cycle with no Sales Review block** use the most recent earlier cycle's budgets, and the card says which
  cycle's budget it uses.
- **D9 · Removal.** Detail in plan §R. PULSE's latent "Matrix Tracker" filter option is hidden (two different VT sales figures
  on one site would break "one number, one verdict"). The engine branch behind it is left untouched, so the VAS guards are unchanged.
- **D13 · Vehicle Tracking is its own dropdown app (2026-11-24; reason: owner).** "where is the drop down for me to access the
  vehicles tracking" — his brief was "a new tab like how we have for vas analytics". The app switcher (Ops and VAS) offers
  **Vehicle Tracking**; it opens PULSE in VT mode (`/pulse/?app=vt`, `nicks_code/vt-app.js`) with only the VT pages, the Upload
  Station and Apps in the sidebar, and VAS Analytics loses the VT group. Same code, same `vas` tab grants (no new app grant, no
  migration); the entry shows for an account that can open a VT page or the Upload Station. Guard: `verify-vt-app.mjs`.
- **D12 · Database.** Tables, not a growing blob. Current state per case plus status-change events only. No daily snapshots
  (the 4.66 GB open-cases lesson).
