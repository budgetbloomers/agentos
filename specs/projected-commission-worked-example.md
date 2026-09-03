# Projected Commission Calculator — how the number is worked out

For Nick (testing round of 3 Sep 2026: "please demo this entire calculation to me").
Every step below is code, not judgement: `commCalc()` in `agent/index.html`, a
line-for-line port of the Matrix VAS Comms Calculator, proven identical to the
original on 12,870 input combinations by `verify-agent-analytics.mjs`.

## The five inputs — all of them already on the agent's page

| Input | Where it comes from | Example (Enoch, Cuddle · Exp) |
|---|---|---|
| Premium written, **excluding VAT** | BI Active Cases, Σ charge ÷ 1.15, his cases only | R 1 856,52 |
| Days worked | Attendance shifts, **capped at days whose sales files have landed** (never today) | 2 |
| Working days in the month | Weekdays in the month **less SA public holidays** | 21 (Sept: 22 weekdays − Heritage Day) |
| Plan | Campaign + tenure → bracket table (Cuddle · Exp → EXP_CUDDLE) | September model |
| Bracket table | `Matrix Vas Comm Model_September26.xlsx`, ex-VAT thresholds | 10 brackets |

## The calculation

1. **Daily average** = premium ÷ days worked
   = 1 856,52 ÷ 2 = **R 928,26 a day**
2. **Projected month-end premium** = daily average × working days in month
   = 928,26 × 21 = **R 19 493,46** (ex-VAT)
3. **Bracket on pace for** = the highest bracket whose threshold ≤ the projection.
   September EXP_CUDDLE thresholds: … 17 877,39 (pays R 14 000) · **19 502,61 (pays R 17 500)** …
   19 493,46 is just under 19 502,61 → **bracket 6 (R 17 877,39 → R 14 000)**.
4. **Projected commission** = projection × (bracket commission ÷ bracket threshold)
   = 19 493,46 × (14 000 ÷ 17 877,39) = **R 15 265,54**
   This is *pro-rata on the bracket's rate*, not the flat bracket amount — writing
   more inside a bracket earns more inside it. (Deliberate; from the original.)
5. **Gap to the next bracket** = next threshold − premium **actually written** so far
   = 19 502,61 − 1 856,52 = R 17 646,09 still to write; ÷ 19 days left = R 928,74 a day.
   Measured against what is *banked*, not the projection — it answers "how much more
   must I write", which is the question an agent asks. (Also deliberate.)
6. **What the next bracket adds** = next bracket commission − projected commission
   = 17 500 − 15 265,54 = **+R 2 234,46**.

## The what-if ("one more sale a day")

Extra premium = extra sales × R 89 ÷ 1.15 × days left → added to the projection →
steps 3–4 re-run. One more sale a day over 19 days = +R 1 470,43 projected premium →
R 20 963,89 → crosses 19 502,61 → bracket 7 → 20 963,89 × (17 500 ÷ 19 502,61) =
**R 18 811,03**, i.e. R 3 545 more for the month.

## Why the page now reads the way it does

- **Read-only figures.** These are the agent's real inputs; there is nothing for them
  to type. The one lever left is the what-if, because one more sale a day is theirs.
- **"Projected", everywhere.** Nothing is earned until month end; the page says so.
- **21 days, not 22.** Heritage Day is a weekday nobody dials; August was 20 for the
  same reason (Women's Day observed). The workbook's DD row is the cross-check.
- **A month keeps its model.** August's view prices on August's table; September's on
  September's. A new table never rewrites a month already worked.
- **Today never counts.** Days worked stop at the last day whose files have landed.
