# Variance Tracker alignment — implementation plan

*2026-08-17 · Source of truth: `Variance Tracker.xlsx` (project root — Nick's actual workbook,
23 sheets, one per day named `DD Mon`, format identical on every daily sheet). This supersedes
the JSON spec's `output_layout` where the two disagree — the workbook is what the floor uses.*

## 1. The real format, read from the workbook

Daily sheet (e.g. `13 Mar`), columns A–N:

| Col | Heading (verbatim) | What it is |
|---|---|---|
| A | `TL` | team leader |
| B | `Agent` | agent name |
| C | `Total VICCI Sales` | **ViciDial's own sale count — the FIRST metric** |
| D | `VAS Tracker` | tracker (board) sales |
| E | `Sales Force` | Salesforce sales |
| F | `Variance (SF vs VAS Tacker)` *(sic — typo is the original's)* | SF − tracker, sales |
| G | `Variance (SF vs VICCI)` | **SF − ViciDial, sales** |
| H | `Total GWP` | one GWP figure per agent |
| I | `Ave GWP` | GWP ÷ sales |
| J | `Comments` | free text per row |
| K–N | `SF`, `VAS GWP`, match-bool, name | hidden engine helpers: SF GWP vs tracker GWP with a TRUE/FALSE match flag |

Workbook shape: **one sheet per day**, plus non-variance sheets (`Incentive winners`,
`Incentive Payout`, `Jameson`) that are separate trackers sharing the file.

## 2. Gap analysis — tracker vs the current Daily Variance tab

Current tab: `Agents · Campaign · Salesforce Sales/GWP · Tracker Sales/GWP · ViciDial Sales ·
Sales Variance · GWP Variance · Flags · Status · Root cause`.

| # | Missing / different | Tracker says | Effort |
|---|---|---|---|
| 1 | **TL column** | leads every row | trivial — `r.tl` already computed (orgAt) |
| 2 | **Column order** | VICCI · Tracker · SF (vici first) | trivial reorder |
| 3 | **Variance (SF vs VICCI)** | second variance column, sales | small — `sfSales − dlSales` when dialler covers the agent-day; dash otherwise. NEW: needs a verdict rule (spec defines no tolerance for a third system — propose: informational colouring only, no MATERIAL status from it) |
| 4 | **Ave GWP** | `Total GWP ÷ sales` | trivial — display only |
| 5 | **Total GWP as ONE column** | single figure + hidden SF-vs-VAS match flag | moderate choice: keep both GWP columns (more honest) or match tracker exactly (one column + boolean-style flag). **Recommend: match tracker — `Total GWP` = SF GWP, and the existing GWP Variance column carries the K/L/M intent** |
| 6 | **Comments** | free text per row | small — new `S.varComments[day|code]` store (like `varRC`), editable in the audit drawer, synced via the state blob |
| 7 | **Export: sheet per day `DD Mon`** | workbook mirrors screen, one day per sheet | small — exportVariance already groups by day; emit one sheet per day instead of one flat sheet |
| 8 | **Export: supporting raw sheets** | spec §output_layout: `SF`, `Tracker`, `Call X`, `Staff List` as pulled | moderate — raw extracts are in the state; add four sheets so every variance is traceable without re-querying |

Kept deliberately (not in the tracker, but load-bearing): `Campaign` (drives filters),
`Flags` (DV03), `Status` + `Root cause` (the rule book's classification workflow — every
non-exact variance must carry an RC). `Talk Time` stays out per Nick's explicit instruction.

## 3. Proposed final column set

`TL · Agent · Campaign · Total VICCI Sales · VAS Tracker · Sales Force ·
Variance (SF vs VAS Tracker) · Variance (SF vs VICCI) · Total GWP · Ave GWP ·
Comments · Flags · Status · Root cause`

Signs follow the tracker: both variances are **SF minus the other system** (matches DV01 as
stored — no display flip).

## 4. Build order

1. Columns 1–4 (TL, order, SF-vs-VICCI variance, Ave GWP) — one pass over `vrDailyTab` + export ✔ low risk
2. Total-GWP consolidation (5) — decide, then same pass
3. Comments store (6) — state key + drawer field + blob sync; guard: comments survive re-upload of the day
4. Export workbook shape (7, 8) — sheet-per-day + four raw supporting sheets
5. Guards: extend `verify-variance.mjs` — header assertion for the new set; comments persistence; export sheet-count = days in range

Each step ships independently; nothing touches the engine (`buildVariance` unchanged
throughout — DV01/DV02/DV03 already compute every number this plan displays).

## 5. Open questions for Nick

- Total GWP: one column like the tracker, or keep SF + Tracker GWP side by side?
- Should `Variance (SF vs VICCI)` colour like the tracker (plain number) or badge like DV01?
- Comments: per agent-day free text — who may edit (all users, or admin only)?

---

## 6. Data audit — 2026-08-17, run over the live state (01–15 Aug)

**Correct, machine-verified.** 11 of the spec's validation checks pass: formulas fixed (VR07),
sales counted as distinct accounts (VR11), cancelled-union on create date (VR12), blocked
metrics emit null never zero (VR08), every material variance carries a root cause (VR05),
tolerances declared before comparison (VR06). On the one fully-covered day — **13 Aug: 91 rows,
80 exact, 0 material** — the three systems agree almost everywhere. Where the report has data,
the data is right. Zero material variances across the whole period.

**Missing, in order of impact:**

| # | Gap | Evidence | Fix |
|---|---|---|---|
| 1 | **Board sheets for 10 of 11 days** — 1,408 metric-sides BLOCKED | `board:0` every day except 13.08 | Upload the August board workbook (DD.MM tabs load per day) — one upload fills the month |
| 2 | **VR02 cut-off skew** — BI runs to 08-15, board to 08-13 | 19 variances indeterminate at the ragged edge | Resolves itself when boards catch up to the BI cut |
| 3 | **VR03: 4 identities, 14 records unresolved** | the known set: Joeline Muniappen, Zandile Chamane (CB210 label), Kent Le Ray, CB290 Precious Makhoba | Add them to the Agent List (or mark leavers) — fix at the roster, never downstream |
| 4 | **11 tracker-only agents** (on the board, absent from SF that day) | VR04 set-difference | Review on the Unmapped/board side — genuine RC5 candidates |
| 5 | **Attendance 01 & 15 Aug** | `att:0` those days | Pull the two missing register days |
| 6 | **Cuddle dialler columns** (VICCI sales, SF-vs-VICCI variance) dash on every day | dialler-covered ~66/91 | The standing ViciDial export fix — all user groups |
| 7 | **Comments** — store live but empty | new this session | Floor starts using it; syncs automatically |
| 8 | **Export shape** — one sheet per day + 4 raw supporting sheets | §4 steps 4–5, deferred | Next build session |

Bottom line: the engine and the displayed numbers are correct; the report is starved of the
board. One workbook upload (#1) converts ~1,400 blocked comparisons into real verdicts.
