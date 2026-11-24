# Vehicle Tracking in AgentOS — a one-page guide for the floor

## What to upload each day, and in what order

**Where Vehicle Tracking lives.** Pick **Vehicle Tracking** in the app dropdown at the top of the sidebar (beside Ops Analytics
and VAS Analytics). Its sidebar holds Month to Date, Weekly Reports, Daily Reports, the Upload Station (if your account uploads)
and Apps. Its address is `/pulse/?app=vt`, so a bookmark or a reload brings you straight back. No Vehicle Tracking entry in the
dropdown means your account has no VT pages; ask Nick or Nicholas.

Use the **Upload Station inside Vehicle Tracking** (it is the same station as VAS Analytics → Upload Station). Never the Ops one:
Ops refuses VT files.

1. **The two daily files.** Load them in either order, on their own VT slots:
   - `BI Active Fitted <ddmmyy>.xlsx` on **VT · BI Active Fitted**
   - `Scheduled & Missed <ddmmyy>.xlsx` on **VT · Scheduled & Missed**

   Keep the date in the file name (ddmmyy, the day you pulled it). A file without it is dated "today".
2. **The Agent List, when it changes.** It goes in the usual place. The VT sheet's Target column is each agent's sales-per-day target.
3. **The opening book. This is a one-off, at go-live only.** Load it after the first day's two files, never before. It is the
   `Schedulers Data` sheet of the hand-kept report, and it carries sale dates only.

Load the files every working day. No file carries a sale date, so a sale is counted on the day it first appears in an upload.
If a day is missed, that day's sales land on the next upload's day.

## What the receipts mean

Each upload shows a receipt card:

| It says | Meaning |
|---|---|
| VT lines n of N rows · cases n | how much of the file was Vehicle Tracking (the rest is VAS and is ignored here) |
| Sellers matched / unmatched | sellers the Agent List could place. The unmatched names are listed. Fix the Sales Force name on the list. |
| VAS money unchanged | the VT file never touches VAS sales or GWP |
| Already uploaded | the same file was loaded before. Nothing changed. |
| Refused as a thin pull | the file has far fewer cases than the last one (BI under 90 %). Pull it again. |
| Missing day | a working day with no file. See above. |

## What each VT page shows (app dropdown → Vehicle Tracking)

- **Month to date**: the business month (26th to 25th) by agent, team leader, sub-campaign and lead source. It shows Sales
  (Current + Rollover), Fitted, Scheduled, Missed, the rates, Fitments done, Missed appointments, Due to fit, SPD against
  target, Fitted value, and Hrs Ahead (24 / 48 / 72 / 72+ / past due) against the 80 / 10 / 5 / 5 % budget.
- **Weekly**: the same figures, one card per week (Monday to Saturday).
- **Daily**: one day at a time, with a day picker.

Every page exports to .xlsx exactly as shown. Team and floor totals are sums, and their rates are ratios of the sums.

## How the VT agent rating is worked out

Agents see it in Agent Analytics. It covers **your business month to date**. It does not use the last five sessions, because a
sale is often fitted days later.

| Driver | What it measures | Target | Points |
|---|---|---|---|
| Target Achievement | your sales per working day | your Target on the Agent List | 50 |
| Fitment Rate | fitted ÷ your sales | the Sales Review budget (e.g. 85 % Digital) | 50 |

- **Every sale counts once.** A sale ends up fitted or not. A missed or cancelled sale is a sale that is not fitted, so it
  lowers your Fitment Rate — and nothing else. (Until 24 Nov 2026 Missed Rate and Fitted vs target were scored too; that
  took points off twice for the same sale, so they were removed before the first figures were published.)
- **Shown, not scored.** Under the two drivers the card lists, "for your information — not part of your score": Missed
  (count and % of your sales, beside the 5 % budget), Cancelled (count and %, beside the 5 % budget) and Fitments done this
  month. They have no pill and no points. The reports still show them as ordinary columns.

- **Points start at half of target.** At half of the target or below you score 0 for that driver. At the target you get all
  of its points. In between, the points rise evenly.
- A driver without enough data yet (fewer than 5 sales, fewer than 5 working days, or no target) is **not measured**. It is
  left out, and the other driver is then out of 100. It never counts as zero.
- The score is out of 100. The bands are **Elite 90+ · Strong 80+ · On track 70+ · Building 60+ · Needs support** below 60.
- **"Not rated yet"** means there is nothing to rate this business month (no sale in play yet). Scheduling agents are not
  rated in this version.
- If this month's Sales Review budgets have not been entered yet, the card uses last month's budgets and names that month.

## What "—" means

**"—" means no figure, never zero** — for example, % to target with no target.

## What "Cancelled" means

No upload says "cancelled", so the system works it out:
- A **Scheduled or Missed** sale that is in **neither** of a day's two files (BI Active Fitted and Scheduled & Missed)
  counts as **Cancelled from that day** — it "dropped out of both files". This only happens once **both** files of the
  day are loaded; one file alone never cancels anything, and a day with no files cancels nothing.
- A contract the BI file shows as **deactivated** is Cancelled from its deactivate date, even if it was fitted.
- A **Fitted** sale never becomes Cancelled just because it left the files.
- If a later file carries the sale again, it goes back to that file's status.
- A cancelled sale **stays in Sales**. It is no longer Scheduled or Missed, so it no longer counts against the Missed
  Rate. **Cancellation %** = cancelled ÷ sales, shown beside the 5 % budget. It is not part of the rating.
- The upload receipt says how many sales dropped out, and whether the day was complete.

## Why a figure can differ from the hand-kept report

The system follows Salesforce and the Agent List, so a few things differ on purpose:
- **Cancelled is worked out, not copied.** On 10 Nov the rule catches every sale the hand-kept report marks Cancelled,
  and also cancels about 55 older Scheduled/Missed rows the report still keeps although no export carries them any more.
- **Manual credits are not copied.** 11 sales that the hand-kept report credited by hand go to the seller Salesforce names.
- **Lead sources follow Salesforce.** About 6.6 % of cases had their lead source relabelled by hand in the hand-kept report.
- **A missed daily upload shifts sale days** to the next upload's day.
