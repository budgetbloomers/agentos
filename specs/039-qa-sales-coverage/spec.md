# Spec 039 — Sales vs QA coverage in the QA tool (Jared only)

**Status:** DECIDED 28 Oct (D1, D3, D4, D6 by Nick; D2 is a data check in T1; D5 takes the recommendation unless Nick says otherwise) · ready to build on Nick's go · **Date:** 2026-10-28

## Nick's answers (28 Oct)

- **D1 — both.** Show **sales made** AND **net sales** (sales made minus cancellations), each with its own % evaluated. The sync carries cancellations per agent per day from the cancellations report (`sf_inactive` in the lake), counted on the day of cancellation as VAS does.
- **D3 — no target yet.** "Jared needs to see what [we] are currently operating at to set one." The tab shows the % with no colours, plus the floor's current operating % (and per team / campaign under the filters) so Jared can choose the target; colours are a one-line change once he does.
- **D4 — date of the call.** An evaluation is in the range when its call date is; sales by the case's contract create date.
- **D6 — current team leader**, exactly as the Dashboard tab.

**Columns (final):** Agent name · Sales made · Net sales · QA evaluations · % of sales made evaluated · % of net sales evaluated · QA score — every one sortable both ways.
**Requested by:** Nick — "I need the sale volumes per person etc brought into the QA tool. I need to understand how many sales were made vs the QA evaluations. This should thereafter display an SLA %."

## What it is

A new tab in the QA tool (qa-ops, `https://qa-ops-sage.vercel.app`) that only Jared can see. For every agent it shows:

| Column | Meaning |
|---|---|
| Agent name | The QA tool's own agent name (joined to sales on the CB number) |
| Number of sales | Sales the agent made in the date range, from the BI Active Cases report uploaded at the AgentOS Upload Station |
| Number of QA evaluations | QA evaluations of that agent's calls in the same date range |
| % of sales evaluated | evaluations ÷ sales — the **SLA %** |
| QA score | The agent's average QA score in the range, computed exactly as the QA tool's Dashboard computes it |

- **Filters** — the same three as the Dashboard tab: team leader, campaign, date range.
- **Sorting** — every column sorts low → high and high → low (click the header; click again to reverse).
- A totals row, and a line saying how fresh the sales are ("sales up to 27 Oct, synced 08:15").

## Where the data comes from — and why a sync

The QA tool and AgentOS are **two separate Supabase databases** (checked 28 Oct: the QA tool's `evaluations`, `users`, `agents` tables do not exist in the AgentOS database). Sales live only in AgentOS: the BI Active Cases report is uploaded at the Upload Station and lands in the AgentOS lake table `bi_active_cases`. So the QA tool cannot "read" sales — they have to be **sent** to it.

**The sync:** after every lake load, AgentOS adds up sales per agent per day and upserts them into a new QA-tool table, `agent_sales_daily`. Only days whose numbers changed are sent (the per-day delta pattern lake-load already uses). The QA tool never touches AgentOS, and AgentOS never reads QA evaluations for this.

## Facts this spec rests on (verified 28 Oct)

- QA tool: Next.js 16 + Supabase, repo `budgetbloomers/qa-ops`, Vercel project `qa-ops`. Login is a signed `qa_session` cookie; per-person rights are the `GRANTS` list in `src/lib/auth/grants.ts` keyed by email. Jared is `jared@thechatterbox.co.za` there today (fullAccess, peopleAdmin, editRecords).
- The QA tool's generic read API (`/api/data/[table]`) lets **any** signed-in user read every registered table — sales must NOT be registered there; the tab gets its own server route that checks Jared's grant.
- `fullAccess` also covers Shameem, Aarav, Nicholas and others — too broad for "Jared only"; a dedicated grant flag is needed.
- CB formats differ: AgentOS `CB123`, the QA tool `CB-123`. The Dashboard groups by agent NAME; CB can be blank on old ("Ex Agent") evaluations.
- Campaign keys differ: QA tool `matrix_cuddle · matrix_courtesy · matrix_tracker · sales_lab (Nesting) · upsell` (Downloads, Test & Upsell); AgentOS `Cuddle · Courtesy · VT · Training Gr … · Download & Test`.
- QA score on the Dashboard is `calcAvgScore`: a plain mean over evaluations whose assessment type is sale or partner escalation, 0% kept, rounded to one decimal.
- BI in the lake, 25 Sep – 26 Oct: 9,387 sale cases attributed to 122 agents; 335 more belong to Panimax (external, correctly unattributed).
- QA evaluations in the same window: Courtesy 2,418 · Cuddle 2,354 · Tracker (VT) 1,499 · Nesting 192.
- In the QA tool "SLA" already means escalation deadlines (`sla.ts`), so in code the new metric is named **eval coverage**; on screen it reads "SLA %" as Nick asked.

## Decisions needed from Nick before building

| # | Decision | Recommendation |
|---|---|---|
| D1 | Which sales count: **sales made** (every case created, before cancellations) or VAS's **net** figure (cancellations taken off)? | **Sales made.** An evaluation is of a call that produced a sale; a sale that later cancels was still made and still evaluable. The page says so in one line. |
| D2 | VT (Matrix Tracker) is QA-evaluated (1,499 in the window), but VT reports outside VAS. Are VT sales in the BI report? | Phase 0 checks the BI file. If VT sales are not in it, VT agents show evaluations with sales "not in BI" until a VT sales source is named. |
| D3 | The SLA target — what % of sales must be evaluated (green / amber / red)? | Nick or Jared to name it (e.g. green ≥ 10%, amber ≥ 5%). Until then the % shows without colour. |
| D4 | Which date puts an evaluation in the range: the **date of the call** or the date it was **submitted** (what the Dashboard filters on)? | **Date of call** — it is the same day as the sale being evaluated, so the % compares like with like. The filter label says "Date of call / sale". |
| D5 | Which evaluations count — every evaluation, or only those the QA score counts (assessment type sale / partner escalation)? | **The same set as the QA score**, so the count and the score always describe the same evaluations. Admin-deleted ones never count. |
| D6 | Team leader for the filter — the agent's **current** TL (as the Dashboard does) or the TL at the time of the sale? | **Current TL**, exactly as the Dashboard — one answer to "whose team is this agent in" across the tool. |

## Out of scope

- Writing anything back to AgentOS; changing the Dashboard tab; showing this to anyone but Jared; per-evaluation drill-down; a VT sales feed (unless D2 finds it in BI).
