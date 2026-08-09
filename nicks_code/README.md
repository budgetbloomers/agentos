# Pulse — VAS Performance Platform

A self-contained executive analytics platform (`index.html`) for the Matrix VAS
call-centre operation. Upload the raw daily exports and it builds the full
month-to-date reporting suite — with the same verified calculations as the June
tracker workbook — wrapped in a dark, glassmorphism dashboard UI. Open the file
in any browser (or use the hosted artifact); no server, no install. All data
stays in the browser (localStorage).

## What's inside

- **Dashboard** — KPI cards with sparklines and previous-period deltas, auto-generated
  insight cards (month-end forecast, at-risk agents, QA slippage, star performers),
  GWP trend, stacked daily sales, team %-to-target bars, top/bottom performers.
- **Month to Date / Weekly / Daily / Sales Heatmap** — the workbook's report tabs,
  each with Cuddle / Courtesy / **Vehicle Tracking** sections.
- **Vehicle Tracking campaign** — Ryan Govender's team (from the agent list's VT
  sheet): calls, answered %, AHT, talk time, QA, and sales counted from "Sale
  Made" dialer dispositions (marked ±; tracker units aren't in the VAS Activated
  Services export, so no GWP). VT never inflates the VAS headline KPIs.
- **Attendance matrix** — agents × days register (✓ / ½ / ✕) with attendance %,
  sorted worst-first, with a coverage warning for days without an attendance file.
- **Agent Performance** — sortable, searchable table (GWP, sales, % target, SPD, QA,
  attendance, opt-in, AHT, trend, performance score, risk level, coaching status).
- **Agent profile drawer** — click any agent: score ring, badges, team/company rank,
  MTD KPIs vs last period, trend charts, generated performance analysis, coaching
  plan with evidence + manager notes + follow-up, and a timeline of evaluations
  and milestones.
- **Leaderboards, Coaching queue, Compare** (radar + head-to-head), **Open Cases**.
- Global search, campaign/team filters, dark/light themes, CSV export per page
  plus full multi-sheet workbook export.
- **Date presets** — calendar month, 26th–25th cycle, month-to-date, today,
  yesterday, last 7/30 days, previous month, or any custom range. Every KPI,
  chart, table and comparison recalculates from the selected range.
- **Monthly snapshots & history** — a whole-month sales export with no per-day
  dates (e.g. `SF_Activated_Services__May_2026.csv`) is stored as a monthly
  snapshot: it powers the monthly-history chart and month-over-month deltas
  (marked "snapshot") when the previous period has no daily data.

## Convex readiness

The engine is a pure function `buildModel(dateRange)` over date-keyed stores
(`sales[date][agent]`, `calls[date][agent]`, `att[date][code]`,
`evals[date][code]`, `snapshots[month]`). To move to Convex, replace the
localStorage store layer with tables of the same shape — one document per
agent-day per source plus a monthly-snapshots table — and the calculations,
pages and exports work unchanged. Nothing is hardcoded to a month.

## How to use it

1. Open the dashboard and go to the **Data** tab.
2. Drop in the day's files — the type is detected automatically from the headers:

| File | What it feeds |
|---|---|
| **SF Activated Services** (one per sale day) | Sales achieved + GWP achieved per agent (one GWP-valued line per opportunity, priced from the built-in GWP list) |
| **Call records** (3CX/PBX export) | Talk time, insurance opt-ins per agent per day |
| **Attendance** export | Employed / actual shifts, attendance %, terminations |
| **QA evaluations** (CallBi full export) | QA % per agent (by date of call) |
| **Matrix Agent List** | Roster: team leader, campaign, tenure, daily target, start date |
| **Tracker workbook** (multi-sheet CSV, June format) | Back-fills historical months (recreates June exactly) |
| **SF Open Cases** (optional) | Backlog snapshot card |

3. Pick the month and period style (calendar month or 26th→25th cycle) in the header.
4. Read the tabs: **Overview**, **Daily**, **Pivot**, **WTD/MTD · Cuddle**,
   **WTD/MTD · Courtesy**, **TL MTD** — each exports to CSV, and **Export report**
   produces the full multi-sheet workbook CSV.

## The rule book

Since 2026-08-09 the calculations are driven by the **VAS MTD Reporting Engine spec v6.0**.
The machine-readable rules live in `../specs/mtd_engine_rules.json`; the operative subset is
inlined in `index.html` as `MTD_RULES` (inlined because the app must run from `file://` with
no server), and `diagnostics/verify-engine-rules.mjs` fails if the two drift apart.

What the rule book decides, and where the spec says so:

- **Actual Shifts** (§6.2) — Courtesy and Nesting are **dialler-derived**: `HDCA → 0.5`,
  else `talk > 0 → 1`, else `0`. Cuddle stays on the HR register, because the ViciDial export
  is period-aggregated and cannot answer "did they talk today". The register records who was
  in the building; the tracker records who worked the phones, and the two genuinely disagree
  (134/136 rows against the register's 123/136).
- **Nesting is a reported campaign** (§7) — it used to be folded into Courtesy and filtered
  out of both pivots, losing 3 agents and 17 sales from every report.
- **Excluded agents** (§5) — `CB67`, `CB205`, `CB265` are off the fact table. Not derivable
  from the data (CB143 has an identical status and stays in); a maintained list, confirmed
  monthly, and always named in the Rule checks panel.
- **Dialling days** (§1) — distinct dates in the **attendance register**, not every date some
  file happens to carry. 01 Aug is a Saturday with four sales and no register: money, but not
  a shift. TL-level SPD divides by this.
- **QA** (§6.7) — filtered on `Date of Call` only, no other filters (six variants were tested
  and all scored worse), 0% scores kept (they are exactly Critical Fails), superseded CB codes
  remapped for QA rows *only*, and agents with no evaluation excluded from the average rather
  than scored zero. Totals are the mean of agent means, per the workbook's `=AVERAGE(U4:U)`.
- **Test data** (§2) — charge code `TESTRR` and account `622622` excluded and counted;
  `Charge Amount` only, never the byte-identical `Charge Amount_1`; the attendance register
  filtered to `Employee Type = Call Agent` so support staff stop accruing shifts.
- **Rule checks** (§11) — V01–V22 re-run after every upload and print on the Data tab. A
  **FAIL** is a figure that should not be published; a **note** is data that is provisional
  rather than wrong.

## Calculation rules (mirrors the June workbook)

- **Sales achieved** = unique opportunities in the Activated Services file per agent.
- **GWP achieved** = one value per opportunity — the "Subs" line's bundled-product
  price from the GWP list (e.g. Titanium Single → R99). The GWP price list is
  hard-coded into the app (it doesn't change); GWP file uploads are ignored, and
  one-off extra products can be added in Settings.
- **Sales target** = agent's daily target × employed shifts; **GWP target** = sales
  target × 89 (configurable in Settings).
- **SPD** = sales ÷ actual shifts; **Att %** = actual ÷ employed shifts.
- **Insurance opt-in** = call dispositions containing "insurance opt" (excluding
  "no insurance").
- **Agent matching** handles the dialer-name quirks: the full "Call x" name wins
  over the CB number embedded in it (e.g. "Kyle Kisten CB-138" → employee CB137).
- **Cancellations & referrals** have no source file — enter them in the
  Adjustments tab.
- Weeks run Monday–Sunday; dialing days are the dates that actually have call or
  sales data, so public holidays drop out automatically.

## Verified against real data

`test.mjs` (Playwright) loads the real exports and asserts:
- July 1: 297 sales, R29,275 GWP, per-agent sales/GWP/talk-time and opt-ins match
  an independent Python computation.
- June (via tracker workbook upload): grand total 7,540 sales (Cuddle 4,701 /
  Courtesy 2,839), GWP R763,313 and per-TL figures identical to the workbook.
