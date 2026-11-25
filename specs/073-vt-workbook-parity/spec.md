# Spec 073 — The VT Report is the workbook

**Status:** DRAFT — awaiting the owner's approval. No code until approved.
**Owner request (26 Nov 2026):** "we want to make the data analytics like how it is in the excel dashboard bring
everything in the agent os, you have the pdf with all the rules etc, use addyosmani"
**Oracle:** `reference/zips/vt-master/Master November 2026 - VT Report.xlsx` (outside the repo) and
`VT_Report_Rules_Formulas_Guide.pdf`. The workbook is the *example output* (owner, 25 Nov); AgentOS must produce the
same figures from the daily uploads (+ the optional Schedulers Data sheet).

---

## Assumptions (correct any of these before approval)

1. **"Like the Excel dashboard" means the workbook's own sheets, as sheets.** The VT Report gains tabs —
   *Dashboard* (today's chart page, unchanged) · *Exco Summary* · *Agent & Scheduler Summary* · *Sales Review* ·
   *Pivots* — each laid out in its sheet's section order, with the sheet's own row and column labels, and its tables
   **shown open** the way Excel shows them (not folded behind "Show the figures").
2. **Same data, same rules.** Every figure comes from the existing case book through `VTEngine`. No new upload, no
   new slot, no database migration, no Worker change.
3. **The workbook is the acceptance test.** Built from the workbook's own Schedulers Data sheet, every figure on
   every new tab must equal the workbook's stored value for that cell.
4. **The drill-down shows what the workbook shows:** staff names, sale date, case number, cycle tag, scheduler,
   referring agent, campaign. **No customer field** (name, mobile, registration) ever reaches the page.
5. **Access is unchanged:** whoever holds the `vt_report` grant sees every tab.

---

## Capability map

| Module id | Responsibility | Depends on |
|---|---|---|
| `wb-model` | Engine module `nicks_code/vt-workbook.js`: pure functions that turn `VTEngine.dashboard()`'s model and its sale facts into the three sheet models. No DOM. | `VTEngine.dashboard()` (exposes `facts`) |
| `review-tab` | The Sales Review tab, incl. the 14-KPI × 5-channel detailed table | `wb-model` |
| `exco-tab` | The Exco Summary tab | `wb-model` |
| `people-tab` | The Agent & Scheduler Summary tab, incl. the drill-down and the scheduler lead-time pipeline | `wb-model` |
| `wb-export` | The .xlsx export carries the three sheets in the workbook's layout | the three tabs' models |

**Build order:** `wb-model` → `review-tab` → `exco-tab` → `people-tab` → `wb-export`.
(Sales Review first: it carries the budgets every other sheet compares against, and the largest gap.)

---

## Gap matrix — every workbook section against AgentOS today

Legend: **Have** = figure and layout exist · **Partial** = figure exists, sheet layout/columns don't ·
**Missing** = no code computes it today (verified by search, 26 Nov).

### Exco Summary (`B2:AB109`)
| Section (cells) | Today | Work |
|---|---|---|
| KPI strip: Total · Fitted · Scheduled · Cancelled · Missed · Fitted GWP, each "% of sales" (B6:K8) | Partial — KPI cards | sheet strip incl. Scheduled + GWP |
| Headlines (B11:B14) | Have — Key Insights | reuse |
| Performance by Channel: share, sales, 4 outcomes, 3 rates, Fitted GWP (B17:L22) | Partial | Share + Fitted GWP columns |
| Performance by Campaign incl. Channel column + Fitted GWP (B25:L33) | Partial | Channel + GWP columns |
| Rollover Follow-up (B36:L41) | Have | reuse |
| Weekly Sales Outcomes, last 14 weeks, Fitted % (B66:H81) | Partial — trend has sales/target | outcome mix per week |
| Pipeline by Lead Time incl. **Not captured** (J66:L73) | Partial | "Not captured" row |
| Upcoming Scheduled Fitments + "Later dates" + total (B84:D102) | Have | reuse |
| Notes & Definitions (B104:B109) | Partial — scattered notes | one notes block |

### Agent & Scheduler Summary (`A1:AV3200`)
| Section | Today | Work |
|---|---|---|
| KPI strip + Headlines (B6:B14) | Partial | sheet strip |
| Visual overview, top 10 by sales | Have — person bars | reuse |
| **Drill-down: one person's every sale** (Y17:AE…) | **Missing** | type + name pickers → outcome counts, Fitted/Total GWP, record list |
| Scheduler / Agent / Referring-agent Summary — outcomes, rates, Fitted GWP, **Lost GWP** (C:L) | Partial | Lost GWP column |
| … **ROLLOVERS** group: Sales · Fitted (counted) · Scheduled · Canc./Missed (M:P) | **Missing** | new column group |
| … **SALES IN VIEW BY CAMPAIGN**: Revx · Tracking Emp. · Jag · Afrilead · Referral Ag. · Predictive · Black Birch (Q:W) | **Missing** | new column group |
| **Scheduler Pipeline by Lead Time** — scheduler × 24h · 48h · 72h · 72+ in · 72+ out · Not captured · Total (B51:I59) | **Missing** | new table |
| "Reconciles to total sales in view" check (E36, E65) | Have — integrity | show per table |
| Date / channel / campaign filters (B5:K5) | Have — person filters | reuse |

### Sales Review (`A1:Z122`)
| Section | Today | Work |
|---|---|---|
| KPI strip: Dialing days "20 of 22", % of cycle elapsed, days left, Total Sales, Fitments, Fitment Rate, Cancelled %, Scheduled Pipeline, Forecast — each with its budget (A4:G7) | Partial | sheet strip |
| **Cycle settings**: start, end, data up to, public holidays (I4:I15) | **Missing** on screen | settings block |
| CHECKS: outcomes = total, hrs buckets = scheduled (I16:K19) | Have — integrity | reuse |
| Sales & Fitments vs Budget per channel incl. Panimax (A28:G34) | Have — Forecast vs Actual | sheet layout |
| Outcome Mix per channel (A37:G43) | Partial | sheet layout |
| **Detailed table**: 14 KPIs (Dialing Days, HC, Total Sales, Total Fitments, Fitment Rate, Missed, Cancelled, Cancelled %, Total Scheduled, Scheduled 24 h/48 h/72 h/72+ in/72+ out) × 5 channels (Digital, Other, Panimax, Referrals, Predictive) × **Budget · Cycle view · % Tgt · Deficit/Surplus · Forecast · All data** (A47:G122) | **Missing** — budget/forecast exist per KPI; **Deficit/Surplus and the full grid do not** | new table |

### Pivots — Referral · Predictive · Lead Gen · All Campaigns (`A1:K15` each)
| Section | Today | Work |
|---|---|---|
| Scheduler × Cancelled/Missed/Scheduled/Fitted + four % columns | Have — Scheduler pivots panel | own tab, tables open |

---

## Tech stack & structure

Vanilla ES5 in single-file apps (CSP: cdnjs only; runs from `file://`) — no framework, no chart library.

```
nicks_code/vt-engine.js        engine (1 758 lines — past the 800 ceiling, so NOTHING new goes in it but one line:
                               dashboard() returns `facts`)
nicks_code/vt-workbook.js      NEW — wb-model, pure, Node-testable, inlined like vt-engine.js
nicks_code/vt-sheets.js        NEW — the four new tabs (page code), inlined via data-inline
nicks_code/vt-dashboard.js     tab switcher only (+ export hook)
nicks_code/diagnostics/verify-vt-workbook-oracle.mjs   NEW — the acceptance oracle
specs/073-vt-workbook-parity/  this spec, plan.md, tasks.md
```

## Commands

```
Build:   node tools/prepare-site.js
Oracle:  node nicks_code/diagnostics/verify-vt-workbook-oracle.mjs     (new; workbook cells vs engine)
Suites:  node nicks_code/diagnostics/verify-vt-report-oracle.mjs  verify-vt-dashboard.mjs  verify-vt-format.mjs
         verify-vt-export.mjs  verify-vt-views.mjs  verify-vt-tabs.mjs  verify-all-tabs.mjs
Deploy:  npx wrangler pages deploy site --project-name chatterbox-agentos --branch main   (owner runs it)
```

## Code style

Matches `vt-engine.js`: rule-book values never hard-coded, every figure carries the workbook cell it answers,
an absence is never a nought.

```js
/* Sales Review E51: Deficit/Surplus = actual - budget, blank when either side is blank (never a zero). */
function deficit(actual, budget) { return actual == null || budget == null ? null : actual - budget; }
/* a detailed-table row (synthetic values) */
row = { kpi: 'Total Sales', channel: 'Digital', budget: 2000, actual: 1000, pctTgt: 0.5,
        deficit: -1000, forecast: 2000, allData: 1900, cell: 'Sales Review C52' };
```

## Testing strategy

- **Acceptance oracle (new):** build the book from the workbook's Schedulers Data sheet, run `VTWorkbook`, and
  compare against the workbook's stored values — target **every numeric cell** of the Exco Summary tables, the
  Agent & Scheduler Summary scheduler and agent tables (C:W) and lead-time table (C53:I59), the Sales Review
  KPI strip and detailed table (B49:G122), and the four pivots. Each check names its cell.
- **Unit:** `vt-workbook.js` functions in Node (drill-down returns no customer field; deficit/forecast blank rules).
- **Browser:** each tab renders with no page error over the fixture and over the live book; tables open; layout
  guards from `verify-vt-format.mjs` (no table needs more than a screen-width of scroll).
- **Regression:** every existing VT suite stays green; `verify-vt-report-oracle` (189) is untouched.

## Boundaries

- **Always:** derive every figure in `vt-workbook.js`, never in page code · name the workbook cell for each figure ·
  run the oracle and every VT suite before a commit · keep customer fields out of the page.
- **Ask first:** changing any rule-book value · changing the existing Dashboard tab · adding a dependency ·
  any database or Worker change.
- **Never:** hand-type a figure from the workbook into code · show a zero where a source is absent ·
  deploy without the owner.

## Success criteria

1. VT Report shows five tabs; the four new ones follow their sheet's section order and labels.
2. `verify-vt-workbook-oracle` passes on every listed cell range, built from the workbook's own data.
3. The drill-down lists one person's sales with the workbook's seven columns and no customer field.
4. The Sales Review detailed table fills all 14 KPIs × 5 channels × 6 columns, Deficit/Surplus included.
5. The four new tabs render over the live book with no page error, at 1280 px and 1600 px.
6. The .xlsx export carries the three sheets in the workbook's layout.
7. All existing VT suites stay green.

## Open questions for the owner

1. **Tabs, or one long page in sheet order?** (Assumed: tabs.)
2. **Should the current chart Dashboard stay as the first tab?** (Assumed: yes, unchanged.)
3. **The drill-down shows case numbers** — fine for everyone with the VT Report (team leaders, campaign managers)?
4. **"Not captured"** (lead time) = a scheduled sale with no appointment date — is that the workbook's meaning?
5. **HC** in the Sales Review = distinct schedulers in view (the workbook's C50 = 6) — confirm, or is it agents?
