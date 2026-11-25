# The VT Report — a one-page guide for the people who use it

The **VT Report** is one screen with the whole of the hand-kept *Master November 2026 - VT Report* workbook on it:
app dropdown → **Vehicle Tracking** → **VT Report** (first in the sidebar), or the address
`/pulse/?app=vt&page=vt_report`.

Everything on it is worked out by the engine from the Vehicle Tracking case book. The page chooses the shapes and the
formats and **computes nothing** — so a figure here and the same figure on Month to Date, on an agent's card or in the
export can never disagree.

If you do not see **VT Report** in the sidebar, your account has not been given it. Ask Nick or Nicholas.

---

## The one thing to upload for this page

The page needs the **master VT report** itself: Vehicle Tracking → Upload Station → **VT · Schedulers Data**, after the
day's two daily files. That sheet is the only place the **scheduler**, the **GWP** and the **true sale date** exist —
no daily export carries them. Until it is loaded, those panels say *"needs the Schedulers Data upload"* in words and
show nothing. **Nothing is ever filled in with a zero.**

Re-upload it whenever the master is updated; it is not a one-off. (It replaced the old one-off *Opening book* slot.)
Because it carries the whole history, loading it is also what lets the business-month picker offer **earlier months** —
the oldest one it reaches is marked partial, with the first sale date it has.

## The four views — the switch at the top

Every panel follows the view, and each panel that uses a different rule says so on itself.

| View | What it counts |
|---|---|
| **Cycle view** (the default) | sales dated in this business month, **plus** earlier sales only where they were fitted. The open outcomes (Scheduled, Missed, Cancelled) are counted **in-cycle only** — this is what the owner's Sales Review cells do, and it is what makes the outcomes add up to total sales. |
| **Current cycle sales only** | sales dated in this business month, nothing earlier. Open outcomes in-cycle only. |
| **Rollovers only** | sales dated **before** this business month. Every outcome counted, whenever it happened. |
| **All data** | every sale in the book, whatever its date. Every outcome counted. |

Two panels ignore the view on purpose and say so: **Cycle Performance** (the lead-time buckets) and **Upcoming
Scheduled Fitments** cover all bookings, and the four **Scheduler pivots** are all data, exactly as the workbook's own
pivot sheets are. **Rollover follow-up** is always the pre-cycle position.

The business month is the **26th → 25th** cycle, named after the month it ends in.

## Charts first, the figures one click away

Each panel shows its chart, and the table behind it sits under **"Show the figures — …"**. It opens with a click or the
Enter key and stays open for you alone (it is your own setting, not a shared one). The warnings at the top and the five
KPI cards never fold. **Opening or closing a table changes no figure and changes nothing in the export.**

## What each panel means

| Panel | What it tells you |
|---|---|
| **The five KPI cards** | Total Sales, Total Fitments, Cancellations, Missed and Target Achieved, each with its change against the previous business month and a sparkline of the weeks. |
| **Performance Trend** | sales by week against the per-week target (the cycle sales budget spread over the cycle's dialing days). Weeks outside the cycle have no dialing days, so they have no target, and the table says so. |
| **Channel Performance** | the view's sales split four ways (Referral, Predictive, Lead Gen, Other), with each channel's budget and achievement. Panimax is shown as a named roll-up and is never added in beside its own members. |
| **Campaign Breakdown** | sales by Campaign/Partner, largest first. A campaign the rule book does not map falls to Other, is **named** above the panels and is never dropped. |
| **Cycle Performance** | the open scheduled pipeline by lead time — **24 / 48 / 72 / 72+ in cycle / 72+ out of cycle**, plus a past-due row — against the dashboard's own share targets. |
| **Sales vs budget** | sales and fitments against the cycle budget, with the straight-line forecast marked. **There is no spend figure in any Vehicle Tracking source**, so this is sales against the sales budget — never a cost and never a margin. |
| **Forecast vs Actual** | per channel, sales and fitments, actual and forecast against budget. The forecast is a straight line at the current pace over the cycle's dialing days, and nothing else. |
| **Detailed Breakdown** | per channel: sales, fitments, cancellations, missed, target, achievement, the change, and the outcome mix as a bar. The totals row is the engine's own sum, never an average of the rows on screen. |
| **Key Insights** | sentences filled in from the figures on this page, each naming the workbook cell it answers. A sentence with no figures behind it is left out rather than padded. |
| **Fitted GWP** | fitted GWP, total GWP in view, GWP on cancelled and missed, and open GWP — all from the Schedulers Data sheet. |
| **Scheduler pivots** | the owner's four pivot sheets: every scheduler's four outcomes and four percentages, each over **that scheduler's own** grand total. The dashed line on each bar is the **scope's own average, not a target** — see below. |
| **Agent & Scheduler Summary** | one dimension at a time (Agent, Referring Agent, Scheduler) with the workbook's own four filters (from, to, channel, campaign) and a line saying which are active. |
| **Upcoming Scheduled Fitments** | bookings by the date they are due to fit, from the earliest one, with everything past the horizon folded into "Later dates" so the shares still add to the whole pipeline. |
| **Rollover follow-up** | the pre-cycle sales still to work: fitted, scheduled, cancelled and missed to rebook, **Open to action** = scheduled + cancelled + missed, and the open GWP. |
| **Where the sources disagree** | every disagreement, counted and named — never a hidden adjustment. See below. |
| **Integrity checks** | the workbook's own checks, as **OK** or **CHECK**, each with an icon and the word (never colour alone). A CHECK prints both sides and the difference, and **never blocks the page**: the figures are still the figures. |

## "—" means no figure, never zero

A dash is a figure that is **not measured**. With no previous business month on file, every change reads `—` and the
page says why. Without the Schedulers Data sheet, GWP and every scheduler figure read in words that they need it.
Nothing on this page is ever filled in with a 0 in place of a missing number.

## There is no per-scheduler target

No source has one. The cycle budget carries a scheduler **headcount** and nothing else, so the pivots show the figures
and the scope's own average, named on screen as *not a target*. The page never invents one.

## Export .xlsx

The button beside the view switch builds **one workbook of the whole page** — about 20 sheets: *About this export*
first, then an Exco-style summary, the trend, the channel and campaign splits, the cycle buckets, budget and forecast,
the detailed breakdown, the insights, GWP, **all four** pivot sheets (the screen shows one scope at a time), the Agent
& Scheduler Summary as your controls are set, upcoming fitments, the rollover follow-up, the disagreements and the
integrity checks.

- Every sheet names the **panel, the view, the business month and the as-at date** before its columns, and *About this
  export* also carries the rule-book version, so a copy you email says what it is.
- It is built from the same figures the page is showing — not scraped off the screen — so a folded table exports exactly
  like an open one, and a count is a real number in the file, not text.
- There is **no customer field** in it. No Vehicle Tracking source carries one.

## Why a figure can differ from the hand-kept workbook

The system follows Salesforce and the Agent List. These differences are on purpose and are **counted and shown** on
*Where the sources disagree*, beside the ones spec 071 already recorded:

- **The `Result` column is read, compared and counted — never applied.** The daily exports are the system of record for
  a sale's status. Where the hand-typed Result disagrees, the panel counts it and shows the direction.
- **Manual credits are not copied.** 11 sales the hand-kept report credited by hand go to the seller Salesforce names.
- **Lead sources follow Salesforce.** About 6.6 % of cases had their lead source relabelled by hand in the report.
- **Cancelled is worked out, not copied** (spec 071): a Scheduled or Missed sale in neither file of a day with both
  files in counts as Cancelled from that day, and a contract the BI file shows deactivated is Cancelled too.
- **A missed daily upload shifts sale days**, because no file carries a sale date. The missing day is named at the top
  of the page.
- **Schedulers and sellers not on the Agent List** are counted under the name the source types, listed, and never
  guessed away or dropped.
- **GWP is not the engine's fitted value.** GWP is hand-typed in the sheet (column E); fitted value is the BI Charge
  Amount × VAT. Both are shown, each named, and neither is adjusted to match the other.

## Why the `72+` buckets can read differently from the owner's sheet

Lead time on this page is **frozen at the extract date plus one day** — never at a clock — and the two `72+` buckets
split on the **cycle end**. The owner's workbook recalculates its own lead-time formulas every time it is opened, so as
his sheet ages its `72+` rows drift while this page's as-at date stays where the data is. The panel prints that as-at
date, so the two can be compared honestly.

The two split columns on **Month to Date**'s Hrs Ahead table show `—` for their budget on purpose: the rule book
carries **one** `72+` share (5 %) and not two, and splitting it would be a rule-book change nobody has written. The
table's note says so and names the path. The VT Report's own Cycle Performance panel measures against the dashboard's
own shares instead, and names the Sales Review cells it used.
