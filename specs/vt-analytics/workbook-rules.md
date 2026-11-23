# VT workbook rules (Phase 0 reverse-engineering)

Date: 23 Nov 2026. Source folder: `reference/zips/vt/`. All analysis ran locally on copies in a scratch folder; nothing left this machine.
People are referred to by CB number (from `Matrix - Agent List.xlsx`) or as Agent A/B/C/D. No customer data is reproduced.

Proof levels used below:
- **PROVEN (formula/pivot)**: read directly from a cell formula, pivot table XML or pivot cache.
- **PROVEN (data)**: holds for every row tested, e.g. "1,104 of 1,104 cases".
- **INFERRED**: the best explanation the data supports, with the evidence given. It still needs the owner to confirm it.

---

## 0. Summary (the one-paragraph answer)

`November 2026 - VT Report.xlsx` is a **scheduler fitment-tracking workbook**, not an agent MTD/daily/weekly pack. Everything in it comes from one hand-maintained sheet, **Schedulers Data**: one row per VT sale (Case Number), with a hand-typed **Result** (Scheduled / Missed / Fitted / Cancelled). Five pivots count those Results. Four of them are per **Scheduler** and split by Campaign/Partner group. The fifth is per **sales Agent**. The workbook contains **no lookup formulas**. Matching to the daily uploads is done by eye. The user pastes the Case Numbers from the uploads into columns O/P/Q, and *duplicate-value conditional formatting* highlights the matches. The person then types the Result. The workbook has no team-leader view, no daily or weekly sheet, no targets on the live sheets, and no composite score. The Agent List is not referenced anywhere in the report.

---

## 1. Files and sheets

### 1.1 `BI Active Fitted 101126.xlsx` (input, Salesforce/BI export)
| Sheet | Export (only sheet, visible) |
|---|---|
| Header row | 1 |
| Rows | 19,405 data-range rows = 19,404 records + 1 footer row (A19406 holds the text "Applied filters: Subscriber Type 2 is not Non-Subscriber / Contract Status is Active / CurrentSalesMonth is Current") |
| Grain | one row per **contract** (product line), so several rows per Case and per Account. 5,104 distinct Case Numbers, 4,742 accounts, 19,404 contracts |
| Date range | Contract Create Date and Installation Date run from **26 Oct to 10 Nov 2026** (serials 46321–46336). The file is cumulative over the sales month, not a single day ("101126" is the extract date) |
| Formulas | none |

Columns (45, A–AS): Account Number, Contract Status, Installation Status, Account Create Date (serial with time), Account Name (customer), Account Record Type, Account_Status, Third Party Billing, Contract Number, Subscriber Type, **Owner (K)**, **Created By (L)**, Fitment_Case_Created_By (M), LastModifiedBy, Contract Create Date (O, integer serial), Contract Deactivate Date, **Installation Date (Q, integer serial)**, Contract Status (again, R), Asset Make, Vehicle Reg Number, Asset Model, Box Number, Case Type (W), Charge Amount (X), **Unit Type (Y)**, Product Bundle, Merged Product Bundle, Chassis Number, Charge Code, Charge Amount (again, AD), FleetNumber, Device_Status, Consultant, Group, Sales Vertical, Region, Unit Type (again, AK), Area Manager, Account Region, Fitment Partner Account Number, Fitment Centre Name, **Source Partner (AP)**, Source Partner Account Number, Previous_Source_Partner, **Case Number (AS)**.

Quirks:
- **Duplicate header names**: Contract Status (B, R), Charge Amount (X, AD) and Unit Type (Y, AK). Read columns by position, not by name.
- The file **mixes VAS and VT**. Most rows are VAS "Welcome Call" service contracts (Source Partner "Panimax - New Sales", Unit Type "Service"). The **VT subset** is Unit Type (Y) ∈ {BEAME, MXV, Matrix Vision}: 1,867 rows and **1,104 cases**. PROVEN (data): this is exactly the set pasted into the report's "Fitted" column Q (1,104 = 1,104, with no extras either way). Using the second Unit Type column (AK) or Subscriber Type = Subscriber gives 1,106 cases. The 2 extra cases are "Recovery Service" lines, and the report marks both as Missed.
- Some date cells carry a number format that renders as `TRUE` in Excel text. Read the raw serial values.
- Created By and Owner carry a " - Panimax" suffix and sometimes a double space ("Name  - Panimax").

### 1.2 `Scheduled & Missed 101126.xlsx` (input, Salesforce report)
| Sheet | Export (only sheet) |
|---|---|
| Header row | 1 |
| Rows | 1,079 = 1,078 records + footer row ("No filters applied") |
| Grain | one row per **case × product** (Product Type BEAME / MXV / Matrix Vision). 656 distinct Case Numbers: 500 "Scheduled Fitment" and 156 "Missed Fitment". No case appears in both |
| Date range | Fitment Date 23 Oct – 4 Dec 2026. The file has **no sale/created date** |
| Formulas | none |

Columns (21, A–U): **Opportunity Source Partner (A)**, CaseID, **Case Number (C)**, Account Name (customer), Duplicates Flag, Count of Case Number, Mobile (customer), Registration, Vehicle Chassis, Product Type, Type (always Installation), Status (New / 1st attempt / 2nd attempt / 3rd attempt / In Progress), Bundle Name, Subscriber Type, Internal Consultant, External Consultant, Fitment Partner, **Fitment Date (R, unformatted serial, shows as e.g. 46356)**, **Created By (S)**, Last Modified By (T), **MissedAndScheduledFitment (U)** ∈ {Scheduled Fitment, Missed Fitment}.

Quirks: Fitment Date has no date format. 2 rows are flagged "Duplicate". Partner values are long Salesforce names (see 3.3).

### 1.3 `Matrix - Agent List.xlsx` (input, roster)
| Sheet | Hidden? | Header | Rows | Purpose |
|---|---|---|---|---|
| May | hidden | 1 | 83 | legacy May roster + old pivot (cache source `May!A1:J84`) |
| VAS | visible | 1 | 71 | VAS roster, A:I (+ pivot K:Q) |
| **VT** | visible | 1 | **48** | **VT roster**, A:I (+ a stale pivot at K1:P14, source `VT!A1:I…`) |
| TL | visible | 1 | 10 | team leaders: Employee Code, Team Leader Name, Sales Manager, Campaign, VICCI Dial |
| Reg List | hidden | 1 | 969 | HR register: Employee Code, Name, Title, Reports to |
| Sheet1 | hidden | 1 | ~1,023 | Employee Code / Title / Name |

VT sheet columns: Employee Code (A, "CBnnn"), Start Date (B), Team Leader (C, a name), Agent Name (D), **Campaign (E)**, Tenure (F: Exp/M2/M1), **Job Title (G: "Sales Agent" / "Scheduling Agent")**, Sales Force (H, Salesforce display name, identical to D for all 48 rows), **Target (I: number, or "-" for schedulers)**.
Quirks: 2 names have trailing spaces (CB441, CB228). The pivot in K:P is stale: it still shows "Training Gr 6" and a VAS TL, and does not match A:I.

### 1.4 `November 2026 - VT Report.xlsx` (answer key)
Saved on SharePoint under ".../SOS Matrix Vehicle Tracking/VT Scheduler Stats Tracking/". The pivot caches were refreshed 11 Nov 2026 14:17 (serial 46337.59). TODAY() at the last calculation was **11 Nov 2026**, which is implied by every cached Hrs Ahead value (328 of 328).

| Sheet | Hidden? | Range | What it is |
|---|---|---|---|
| Projection | hidden | A1:T15 | stale **October** fitment projection (26.09–25.10). Targets are typed in: Lead Gen fitment target 2,560; Referrals 240; Predictive 880 (internal) / 300 ("Matrix Target"); Working Days 20; Days Passed 0; Actuals blank, so results show #DIV/0! |
| Lead Gen Tracker | hidden | A1:M19 (Table1 A2:M18) | stale "Afri Leads – October 2026" daily/weekly funnel typed by hand: Afrilead Created, Dialed, Total Account Sales, No Contact, WIP, Final Outcome, Invalid, Queries, Duplicate, Credit Check Failed/Legal, Language. Conversion = `IFERROR(D/(C−J),0)` = sales / (dialed − duplicates). Weekly rows = SUM of the day rows. MTD = SUM of the week rows |
| Play Around PIVOT | visible | A1:G62 | pivot by **sales Agent** × Result |
| **Schedulers Data** | visible | A1:Q2025 | **the data sheet** (2,024 rows) |
| PD - Predictive | visible | A1:K15 | pivot by Scheduler × Result, Predictive only |
| PD - Referral | visible | A1:K15 | pivot by Scheduler × Result, Referral only |
| PD - Lead Gen | visible | A1:K15 | pivot by Scheduler × Result, the 4 lead-gen partners |
| PD VT Campaign | visible | A1:K15 | pivot by Scheduler × Result, all campaigns |

No defined names except an AutoFilter (`'Schedulers Data'!A1:M2025`). No data validations. No external links (no `externalLinks` part). No calcChain dependencies outside the workbook.

#### Schedulers Data columns
| Col | Header | Type | Filled | Notes |
|---|---|---|---|---|
| A | Month | text | 2,024 | "Current" (1,399) = sale date 26 Oct–10 Nov; "Rollover" (625) = sale date 21 Aug–24 Oct. PROVEN (data): the 26 Oct boundary splits the two cleanly (no overlap) |
| B | Date | date | 2,024 | **sale date**, 21 Aug – 10 Nov 2026, sorted ascending (0 inversions) |
| C | Agent | text | 2,024 | sales agent full name, typed. Spelling drift exists, e.g. one row has leading and trailing spaces and a case variant of a CB14 name |
| D | Sale Count | number | 2,024 | always 1 |
| E | GWP | currency | 2,024 | R22–R999; mostly R99/189/199/209/229/359 |
| F | Case Number | number | 2,024 | **the key**. 2,024 distinct values, no duplicates |
| G | Customer Contact | number/text | 2,024 | customer phone (PII, never use) |
| H | Campaign/Partner | text | 2,024 | Revx 654, Tracking Empire 521 (+3 "Tracking empire"), Predictive 477, Referral Agent 179, Jag 157 (+1 "jag"), Afrilead 32 |
| I | Referring Agent | text | 181 | filled for Referral Agent rows (178) and 3 Predictive rows. These are mostly VAS agent names |
| J | Scheduler | text | 2,024 | first name of a Scheduling Agent (see 3.4) |
| K | Result | text | 2,024 | Scheduled 517 / Missed 190 / Fitted 1,113 / Cancelled 204. **Typed by hand, no formula** |
| L | Hrs Ahead | formula | 2,018 formulas | `=IF(M-TODAY()=0,24,IF(M-TODAY()=1,48,IF(M-TODAY()=2,72,IF(M-TODAY()>=3,"72+",""))))` (PROVEN, all 2,018 identical in shape) |
| M | Date Scheduled | date | 517 | filled **only** for Result = Scheduled; equals S&M Fitment Date for 499 of 499 matched cases |
| N | (blank) | | 0 | spacer |
| O | Scheduled | number | 499 | pasted Case Numbers = S&M rows with "Scheduled Fitment" (499 of 499 in the file) |
| P | Missed | number | 153 | pasted Case Numbers = S&M "Missed Fitment" (153 of 153) |
| Q | Fitted | number | 1,104 | pasted Case Numbers = BI cases with Unit Type (Y) in the VT set (1,104 of 1,104) |

Conditional formatting (PROVEN, sheet4.xml): `duplicateValues` rules over `F:F` combined with `O:O`, `P:P`, `Q:Q` and `O:Q`. This is the matching mechanism. A Case Number in F lights up when the same number is pasted into O/P/Q, and the user then sets K by hand.

---

## 2. Output sheets and how each figure is produced

The four "PD" pivots share one design (PROVEN, pivotTable2–5.xml + cache 1, source `'Schedulers Data'!A1:L1048576`):
- Rows: **Scheduler** (J). Columns: **Result** (K). Value: **Count of Result** (counts non-blank K).
- Page filters: Month (A), Date (B), Campaign/Partner (H), Hrs Ahead (L). All are set to (All) except Campaign/Partner on the three campaign sheets.
- The Date field has Days and Months grouping (21 Aug – 11 Nov), but no pivot uses it.
- Columns H:K sit beside the pivot as GETPIVOTDATA formulas, one row per scheduler:
  - **Missed Rate %** = `GETPIVOTDATA(Result, Scheduler=x, Result="Missed") / GETPIVOTDATA(Result, Scheduler=x)`
  - **Fitted Rate %** = Fitted / row total
  - **Scheduled Rate %** = Scheduled / row total
  - **Cancellations** (a %) = Cancelled / row total
  - Grand-total row: the same ratios over the whole pivot.
  - The denominator is **all rows (sales) for that scheduler**, including still-Scheduled ones. These are shares of sales, not "of fitments due".

| Sheet | Campaign/Partner items shown (PROVEN from hidden items) | Grand total in file |
|---|---|---|
| PD VT Campaign | all | C 204 / M 190 / S 517 / F 1,113 / total 2,024; rates 9% / 55% / 26% / 10% |
| PD - Predictive | "Predictive" (+ blank). **"Predictive " with a trailing space is hidden** | C 79 / M 39 / S 99 / F 257 / 474 |
| PD - Referral | "Referral Agent" (+ blank) | C 13 / M 16 / S 76 / F 74 / 179 |
| PD - Lead Gen | Revx, Afrilead, Tracking Empire, Jag (+ blank) | C 112 / M 135 / S 341 / F 780 / 1,368 |

Pivot quirks (PROVEN from cache records):
- Pivot items match **without regard to case but with regard to spaces**. "Tracking empire" and "jag" fold into Tracking Empire and Jag, but "Predictive " (3 rows in the cache, all sales dated 10 Nov) is a separate item, and PD - Predictive hides it. That is why PD - Predictive shows 474 rows when the sheet now has 477 "Predictive" rows. The cache is stale relative to the sheet: the typo was fixed after the last refresh.
- The cache still lists unused items ("Panimax - New Sales", "#N/A", "No Name", "Luvo "), which shows those values were typed in at some point.

**Play Around PIVOT** (pivotTable1, cache 2, source `A1:K`): Rows = **Agent** (C), Columns = Result, Value = Count of Result. Page filters Month, Date and Campaign/Partner are all (All). There are 55 agent rows plus a blank row. Grand total C 204 / F 1,113 / M 190 / S 517 = 2,024. One agent appears twice because of a leading space in a name.

**What does not exist** (asked in the brief): there is no Month-to-Date, Daily or Weekly sheet, and no team-leader or campaign-manager view. "MTD" here means the pivot with Month = (All) over the November fiscal month plus Rollover. A daily or weekly view is only possible by setting the Date page filter by hand, and the saved file has none set. The only daily/weekly structure in the workbook is the hidden, stale October Lead Gen Tracker.

---

## 3. Join keys

### 3.1 Case Number is the only real key
Report F (Case Number) ↔ S&M C (Case Number) ↔ BI AS (Case Number). PROVEN (data): **every one of the 1,756 cases that carries a status in today's inputs is present in the report, with exactly the same status** (0 disagreements):

| Input status (engine rule) | Report Result | Cases |
|---|---|---|
| in BI VT set | Fitted | 1,104 (830 Current, 274 Rollover) |
| in S&M Missed, not in BI VT set | Missed | 153 |
| in S&M Scheduled, not in BI VT set | Scheduled | 499 |

Status precedence (INFERRED, strongly supported): **Fitted (BI) > Missed > Scheduled**. 3 cases sit in both S&M Missed and BI, and the report shows all 3 as Fitted. 1 case sits in both S&M Scheduled and BI, and the report shows it as Fitted. The 2 BI "Recovery Service"-only cases that are also in S&M Missed stay Missed, so they are not VT fitments.

The **Date Scheduled** (M) of a Scheduled row = S&M **Fitment Date** (R): 499 of 499.

Report rows that **no** input explains (178 of 2,024). Their status comes from earlier days or manual entry:

| Report Result / Month | Rows |
|---|---|
| Cancelled / Rollover | 114 |
| Cancelled / Current | 90 |
| Missed / Rollover | 36 |
| Missed / Current | 1 |
| Scheduled / Rollover | 18 |
| Fitted / Rollover | 7 |
| Fitted / Current | 2 |

INFERRED: Result is **sticky**. Once a case drops off the day's S&M export and is not in the month's BI, its last typed status stays. "Cancelled" has no source in any of the three files.

### 3.2 Agent: name only, no CB anywhere in the inputs
- Neither input carries a CB number or a dialler login. The agent appears only as a Salesforce user display name: BI **Created By** (L) / Owner (K), and S&M **Created By** (S).
- Normalise by removing the " - Panimax" suffix, collapsing whitespace and lowercasing. The result then equals the report's Agent (C) for 650 of 656 S&M cases and 1,101 of 1,106 BI cases. In the 11 remaining cases the report credits a different agent than the Salesforce creator (manual credit).
- Agent List join: the normalised name is matched to VT!D (Agent Name), which is identical to VT!H (Sales Force) in every row. Exact matches cover 38 of the 48 distinct BI creators. A **first-token + last-token** rule adds 3 more (CB14, CB346 and CB354, whose list names add or drop a middle name). One more (CB342) differs by a single letter in the first name and needs a near-spelling rule or an alias.
- The report itself does no matching to the Agent List. The workbook has no alias table, so spelling differences are not handled at all. Pivot rows simply split, e.g. the leading-space duplicate in Play Around PIVOT.

### 3.3 Campaign / Partner
The report's Campaign/Partner (H) is **per sale**, typed by hand. It agrees with Salesforce Source Partner (BI AP / S&M A) about 95% of the time:

| Salesforce partner | Report value |
|---|---|
| RevX | Revx |
| Tracking Empire / Shawn Langley | Tracking Empire |
| Jag Web Marketing- Panimax | Jag |
| Afrilead- Panimax | Afrilead |
| Panimax - New Sales | **Predictive** or **Referral Agent** |
| Sales Enablement (9 cases) | Jag or Revx (manual) |

Splitting "Panimax - New Sales" is INFERRED: Referral Agent where the selling agent is on the list under *Matrix Vehicle Tracking - Referral* (Referral-list agents → 177 of 179 Referral Agent rows), otherwise Predictive. Referral rows also carry a Referring Agent (I).

Report groupings (PROVEN from pivot filters): **Lead Gen** = Revx + Afrilead + Tracking Empire + Jag; **Predictive**; **Referral** (= "Referral Agent"). The downstream Sales Review calls Lead Gen "Digital" and Predictive + Referral "Panimax" (see 6).

The Agent List campaign is the **agent's team**, a different dimension from the sale's lead source. Digital-team agents sold 68 "Predictive"-labelled sales, and Predictive-team agents sold 82 lead-gen sales. Both views are valid, and the owner must pick one per report (see the open questions).

There is **no "Download & Test"** in any VT file. The VT campaigns are Digital, Referral, Predictive and Scheduling.

### 3.4 Scheduler
Scheduler (J) holds a first name that resolves to the six **Scheduling Agent** rows on VT (Job Title G): CB316, CB16, CB112, CB157, CB348 and CB190. The CB190 name is the agent's middle name, and the CB348 name matches a Salesforce form that carries an extra middle name. The **assignment is not derivable** from the inputs. S&M Last Modified By matches the scheduler only partly, and agent/date purity is only 72%. INFERRED: a manual allocation.

### 3.5 Team leader
The report has no team leader. For an engine, TL = VT!C (name) → TL!B, which gives the TL's CB in TL!A:
- Digital → CB194
- Referral and Scheduling → CB104
- Predictive → CB360 and CB358

---

## 4. Scoring, targets, tiers, composite

**There is no composite score, weighting, ranking or tier anywhere in the VT Report** (all 2,018 + 112 formulas inspected). It has only the per-scheduler ratio columns (2) and a stale hidden October projection with typed fitment targets: Lead Gen 2,560, Referrals 240, Predictive 880 internal / 300 Matrix, 20 working days.

### 4.1 Who is a VT agent (from the Agent List)
- **Sheet `VT`** of `Matrix - Agent List.xlsx`, rows A2:I49 (48 people). Campaign (E) begins "Matrix Vehicle Tracking - ". The TL sheet lists 4 VT team leaders (Campaign starting "Matrix Vehicle Tracking").
- No VT CB appears on the VAS sheet. There are no duplicate CBs. The Reg List titles do not identify VT.

| Sub-campaign (VT!E) | Job Title (G) | TL (CB) | Agents | Target (I) |
|---|---|---|---|---|
| Matrix Vehicle Tracking - Digital | Sales Agent | CB194 | 17 | 6.5 each |
| Matrix Vehicle Tracking - Referral | Sales Agent | CB104 | 3 | 3 |
| Matrix Vehicle Tracking - Predictive | Sales Agent | CB360 | 16 | 2 (1), 1.5 (8), 1 (7) |
| Matrix Vehicle Tracking - Predictive | Sales Agent | CB358 | 6 | 2 (4), 1 (2) |
| Matrix Vehicle Tracking - Scheduling | Scheduling Agent | CB104 | 6 | "-" |
| **Total** | | | **48** (42 sales + 6 schedulers) | |

Tenure: Exp 29, M2 10, M1 9. Predictive targets fall with tenure (Exp 2 → M2 1.5 → M1 1).

The Target unit is INFERRED to be **sales per day (SPD)**. The Sales Review computes SPD = Sales / Headcount / Dialing Days. Its campaign budgets, however, are 7 (Digital) and 2.5 (Referral), not 6.5 and 3, so the owner must confirm.

**Do the input agents resolve to the VT list?**

| Source | Distinct sellers | Exact match | First+last match | Not on any list sheet |
|---|---|---|---|---|
| BI VT Created By | 48 | 38 | 3 | 7 |
| S&M Created By | 47 | 38 | 3 | 6 |

Combined, **8 unmatched names**:
- One is a one-letter variant of CB342. CB342 is the only VT sales agent on the list with no activity in the inputs.
- The other 7 appear on no sheet at all, not even the hidden Reg List (INFERRED: they left or are unlisted). They account for **49 of 1,104 BI VT cases and 17 of 656 S&M cases**:

| | U1 (CB342 typo) | U2 | U3 | U4 | U5 | U6 | U7 | U8 |
|---|---|---|---|---|---|---|---|---|
| BI cases | 3 | 7 | 12 | 12 | 4 | 1 | 10 | 0 |
| S&M cases | 2 | 1 | 4 | 2 | 0 | 0 | 7 | 1 |

All 8 appear in the report as Agents. The report includes them because it never consults the list.

### 4.2 Per-agent measures the VT Report produces (candidate composite inputs)
The report's only per-**sales-agent** output is Play Around PIVOT (counts). Its ratios exist only per scheduler, but the same formulas apply per agent. Window = Month (All) = current fiscal month sales plus Rollover. A per-agent ratio would use the agent's own sales as the denominator.

| Measure | Definition (as in workbook) | Unit | Higher is better? | Where |
|---|---|---|---|---|
| Sales | count of Schedulers Data rows for the agent (Sale Count = 1 each) | count | yes | Play Around PIVOT G (Grand Total) |
| Fitted | rows with Result = Fitted (case in BI VT set) | count | yes | Play Around PIVOT C |
| Scheduled (open) | Result = Scheduled (in S&M Scheduled Fitment, not yet fitted) | count | neutral/pipeline | col E |
| Missed | Result = Missed (S&M Missed Fitment) | count | no | col D |
| Cancelled | Result = Cancelled (manual) | count | no | col B |
| Fitted Rate % | Fitted / all sales | % | yes | PD sheets col I (per scheduler) |
| Missed Rate % | Missed / all sales | % | no | col H |
| Scheduled Rate % | Scheduled / all sales | % | context | col J |
| Cancellation % | Cancelled / all sales | % | no | col K |
| GWP | sum of E per agent (in the data, no pivot shows it) | R | yes | Schedulers Data E |
| Hrs Ahead | for Scheduled rows: fitment date − today → 24 / 48 / 72 / 72+ | bucket | INFERRED: the owner reads 24h as "fit due today" | Schedulers Data L |

Targets and thresholds that apply **per agent**:
- Only the Agent List Target column (I) above.
- The VT Report applies none.
- Campaign-level budgets live in `Sales_Review_YTD 2026.xlsx` (see 6):
  - Fitment % 85% (Digital/Referral) and 80% (Scheduling)
  - Cancellation % 5%
  - Conversion % per partner: Tracking Empire 45%, RevX 43%, JAG 30%, Afrileads 15%; Referral 12.5%
  - Insurance opt-ins 70%
  - QA 90%
  - Attendance 90% (Referral 85%)
  - Talktime 0.2083 day = 5:00 h (Digital), 0.1875 = 4:30 h (others)
  - % agents on target 80%

  Attendance, talktime, QA, conversion and opt-ins are **not** in the VT Report or its three inputs.

---

## 5. Reproduction check (three inputs only)

Engine used (scratch script `repro.cjs`):
- Fitted = distinct BI Case Numbers with Unit Type (Y) ∈ {BEAME, MXV, Matrix Vision}.
- Missed / Scheduled = S&M cases by MissedAndScheduledFitment, with precedence Fitted > Missed > Scheduled.
- Agent = normalised Created By.
- Campaign from Source Partner (3.3), with Panimax - New Sales split by the agent's list campaign.
- Hrs Ahead from Fitment Date with TODAY = 11 Nov.

| # | Figure (report cell) | Expected | Recomputed | Result |
|---|---|---|---|---|
| 1 | MTD Fitted, all (PD VT Campaign!F15) | 1,113 | 1,104 | DIFF −9 |
| 2 | MTD Missed, all (D15) | 190 | 153 | DIFF −37 |
| 3 | MTD Scheduled, all (E15) | 517 | 499 | DIFF −18 |
| 4 | MTD Cancelled, all (C15) | 204 | – | CANNOT |
| 5 | MTD Grand Total sales (G15) | 2,024 | – | CANNOT |
| 6 | Lead Gen Fitted (PD - Lead Gen!F15) | 780 | 758 | DIFF −22 |
| 7 | Predictive Fitted (PD - Predictive!F15) | 257 | 270 | DIFF +13 |
| 8 | Referral Fitted (PD - Referral!F15) | 74 | 73 | DIFF −1 |
| 9 | Referral Scheduled (PD - Referral!E15) | 76 | 75 | DIFF −1 |
| 10–12 | Agent A (CB392) Fitted / Scheduled / Missed | 79 / 25 / 13 | 78 / 24 / 12 | DIFF −1 each |
| 13–15 | Agent B (CB430) Fitted / Scheduled / Missed | 82 / 22 / 5 | 82 / 22 / 5 | **MATCH ×3** |
| 16–18 | Agent C (CB350) F / S / M | 50 / 35 / 11 | 49 / 32 / 9 | DIFF |
| 19–21 | Agent D (CB184, Referral) F / S / M | 34 / 29 / 7 | 32 / 27 / 5 | DIFF |
| 22–29 | Team Fitted / Scheduled: CB194 756/338, CB104 75/79, CB360 167/79, CB358 65/8 (*expected = report rows joined to the Agent List; the report has no TL figure*) | as left | 750/325, 73/76, 168/80, 64/9 | DIFF (±1 to −13) |
| 30–33 | Scheduled by Hrs Ahead 24 / 48 / 72 / 72+ | 139 / 84 / 105 / 189 | 136 / 83 / 99 / 181 | DIFF (−18 total) |
| 34 | Daily: sales dated 10 Nov | 127 | – | CANNOT |
| 35 | Daily: 10 Nov sales already Fitted (proxy: BI Account Create Date = 10 Nov) | 10 | 10 | **MATCH** (proxy) |
| 36 | Daily: 10 Nov sales Scheduled | 112 | – | CANNOT |
| 37 | Weekly: sales dated 2–7 Nov now Fitted (proxy) | 305 | 243 | DIFF −62 |
| 38 | Weekly: sales dated 2–7 Nov, all results | 500 | – | CANNOT |

**Score: 4 of 33 computable figures match exactly; 5 more cannot be computed.** At **case level, all 1,756 cases that the inputs carry reproduce their Result exactly**, and none is missing from the report. Every figure-level gap comes from one of these causes:

1. **Status history** (178 rows, the dominant cause). Fitted −9 = 7 Rollover cases fitted before 26 Oct, which have left the month-filtered BI, plus 2 Current cases (INFERRED: contract later deactivated or typed by hand). Missed −37 and Scheduled −18 are sticky earlier statuses. The Hrs Ahead buckets are short by exactly those 18 Scheduled rows (3 + 1 + 6 + 8). One day's upload cannot rebuild a month of carried-forward statuses, so the engine must persist each case's last status day by day.
2. **Cancelled has no input.** None of the three files carries cancellations (204 rows).
3. **The sales universe (2,024 sales, sale date, GWP, Scheduler) is not in the inputs.** The inputs contain only cases that are currently scheduled, missed or fitted this month. Sale date is absent from S&M. BI Account Create Date equals the sale date for only 610 of 1,104 fitted cases, so it is unusable as a weekly proxy (row 37).
4. **Campaign labels.** The hand-typed Campaign/Partner disagrees with the Salesforce partner on about 90 fitted cases (Revx↔Tracking Empire 41, lead-gen↔Predictive 27, …). That causes rows 6–7.
5. **Agent credit.** 11 cases are credited to a different agent than the Salesforce creator. This causes the ±1–3 agent and team differences, on top of cause 1.
6. Scheduler-level figures (every PD row) **cannot** be reproduced at all, because the scheduler is not in any input.

---

## 6. `Sales_Review_YTD 2026.xlsx`: what it is

It is a monthly **management KPI pack** for fiscal months running from the 26th to the 25th (Sep, Oct, Nov, Dec 2026). Sheets: Overview, VAS Cuddle, VAS Courtesy, VT Digital, VT Referrals, VT Predictive and VT Scheduling. Each KPI block has Budget Target, Actual, % Tgt, Deficit/Surplus, Forecast and "Last 5 Days Run Rate". Actuals are **typed values**. Only the ratios and rollups are formulas (for example SPD = Sales/Headcount/Dialing Days, Fitment % = Fitments/Sales, Cancellation % = Cancelled/Sales, and Forecast = Actual/Days passed × Budget days). Comments note hard-coded 20 and 14 working days for M1 and M0.

**The VT Report does not depend on it**: there are no external links either way. It is a **downstream consumer** of VT Report-style counts. INFERRED: its VT Scheduling November block ("Digital" Total Sales 1,271) equals the report's Lead Gen rows with sale date up to 9 Nov, Month = All (exactly 1,271). Its "Panimax" figure of 623 is close to the report's 626, and its status figures (Fitted 1,004, Missed 221, Cancelled 181, Scheduled 488 = 143 / 85 / 44 / 216 by 24h / 48h / 72h / 72h+) are an earlier snapshot of the same tracker. It is the only place that holds the VT budgets listed in 4.2.

---

## 7. Open questions for the business owner

1. Where do the Schedulers Data rows (one per VT sale: sale date, agent, GWP, case number, campaign/partner, referring agent) come from each day? None of the three uploads contains the sales list. Is there a fourth export the engine should take?
2. How does a sale become "Cancelled"? 204 rows are Cancelled, and no input file carries cancellations.
3. How is each sale assigned to a Scheduler (fixed allocation, round robin, whoever worked it)? Should the engine use Salesforce Last Modified By, or does scheduler data need its own upload?
4. When a case disappears from the Scheduled & Missed export and is not in BI Active Fitted, should it keep its last status (which is what the workbook does today), become Cancelled, or something else? Confirm the precedence Fitted > Missed > Scheduled.
5. Confirm the fiscal month (26th to 25th) and the Rollover rule. How far back do Rollover sales carry (the file goes back to 21 Aug), and when does a Rollover sale leave the report?
6. When the hand-typed Campaign/Partner and the Salesforce Source Partner disagree (about 5% of sales), which one is authoritative? Is "Panimax - New Sales" split into Predictive or Referral Agent by the agent's team? What should "Sales Enablement" map to?
7. Should VT reports group by the sale's lead source (Lead Gen / Predictive / Referral, as the report does) or by the agent's team on the Agent List (Digital / Predictive / Referral)? They differ for about 150 sales.
8. When the Salesforce "Created By" differs from the agent credited in the tracker (11 cases), who gets the credit?
9. Is a "fitment" only a BEAME / MXV / Matrix Vision unit (BI first Unit Type column)? Do Recovery Service-only lines count?
10. What unit is the Agent List "Target" column (6.5 / 3 / 2 / 1.5 / 1)? Sales per day? Why does it differ from the Sales Review SPD budgets (Digital 7, Referral 2.5)?
11. What are the expected Daily and Weekly views? Which date drives them (sale date, fitment date or scheduled date), and what are the week boundaries? The Sales Review uses a Monday-to-Saturday "last 5 days", for example 02/11–07/11.
12. Should the 7 sellers who appear in the inputs but on no Agent List sheet (49 fitted and 17 scheduled/missed cases) be excluded, as with VAS? Should the CB342 spelling be aliased?
13. For the new VT agent composite score: which measures, what weights and what thresholds? Should targets vary by tenure, as the Predictive targets do? Should Cancelled and Missed count against the agent who sold, or against the scheduler?
14. Are the 6 Scheduling Agents shown and scored in Agent Analytics? If so, on scheduler measures (fitted/missed rate of their allocated sales, Hrs Ahead)?
15. What does Hrs Ahead mean? Is "24" a fitment due today, and is there a target, such as "share of scheduled within 24h"? The Sales Review tracks Scheduled 24h / 48h / 72h / 72h+ against budgets.
16. Should the engine use the Sales_Review budgets (Fitment % 85%, Cancellation % 5%, conversion by partner, and so on) as the VT target source, and who maintains them each month?
