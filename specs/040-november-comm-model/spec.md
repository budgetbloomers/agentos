# Spec 040 — November 2026 commission model + Motor Warranty

**Asked (3 Nov 2026):** "open the zip file and update the comms calculator, to their latest model, also there is a new
campaign add that to the calculator and update that, also … update the vercel one as well
(https://comms-calc-five.vercel.app/)". Source: `fwnovembercommmodels.zip` (4 workbooks, copied to `reference/docs/`).

## What the workbooks say

| Workbook | Change vs October |
|---|---|
| Matrix Vas Comm Model_November26 | DD 22 → **20**; every threshold is the sheet's own formula `SPD × avg premium × DD`, so all rebase; comm amounts unchanged (rows where comm = premium ex VAT move with it) |
| **Motor Warranty Comm Model_November26** | **NEW campaign.** Three plans (Month 1, Month 2, Exp), 8 brackets each. `Gross Sales = SPD × DD(20)`, `Collected = Gross × FTC 60%`, `Net Premium Collected = Collected × R425`, Comm per bracket. Rule: "If Average Premium is under R425 then 20% of total earnings" |
| Matrix VT / VT Scheduling | changed (incl. a new Senior Scheduler sheet) — **out of scope**: VT is in neither calculator (no per-agent VT feed, see comms-calculator memory) |

## Decisions (user, 3 Nov 2026)

1. **November has 20 dial days** — 4 Nov 2026 is a public holiday (elections). Added to `MTD_RULES.extraHolidays` and
   `specs/mtd_engine_rules.json public_holidays.extra`, so working days, attendance and shifts treat it as a holiday.
2. **Brackets exactly as the workbook computes them** (generated from the xlsx, never retyped).
3. **Motor Warranty maths = the VAS maths:** the agent enters gross sales; commission is pro-rata on the bracket's rate.
   Implemented by expressing each MOW bracket as its Net Premium Collected (`gwp`) with a per-plan sale value of
   `0.6 × 425 = R255` (one gross sale's collected premium). Pro-rata on premium ≡ pro-rata on sales, so
   `commissionFor()` / `commCalc()` and the 11,880-case equivalence test cover MOW unchanged.
4. **R425 rule = lose 20% (paid 80%).** The user: "look at the data given". The VT workbook carries the identical
   sentence (R189), and its only implemented modifier table — "Ins Opt in (based on total comm earnings)" — writes the
   penalty tier as **-0.2**. One named constant (`PREMIUM_FLOOR`) in each calculator; change it there if Nick rules
   otherwise. Applied to the commission figures when the entered average premium is under R425.
5. **Both calculators.** Vercel app gets a full Motor Warranty calculator; AgentOS's Commission tab offers it in its
   try-it-yourself plan picker (no agent is on Motor Warranty on the 3 Nov Agent List and no MOW sales feed exists).

## One source for both calculators

`agent/reference/original-index.tsx` becomes the real, buildable app source (November + Download/Upsell in the picker +
Motor Warranty) and the SAME file is deployed to Vercel as `src/routes/index.tsx`. The live app (deployed 1 Sep from
`comm-calc.zip`, verified by its bundle: September's 4063.04 present, no EXP_DOWNUP) had missed October entirely.

## Month pinning (a new workbook never re-prices a paid month)

`COMM_RULES` = November (`version '2026-11'`, `dd 20`, + MOW plans). October → `COMM_RULES_2026_10`, pinned for
**'2026-09' and '2026-10'** (September has ridden the current model since 1 Oct; without the pin it would silently move
to November). July/August keep August's.

## Tasks

1. Copy the 4 November workbooks to `reference/docs/`.
2. `tools/gen-comm-model.mjs` — reads a month's VAS + Motor Warranty workbooks, prints the brackets (TSX + PULSE shapes).
3. `original-index.tsx` (+ `original-m0.tsx` label): November brackets, EXP_DOWNUP + 3 MOW plans in the picker,
   gross-sales + average-premium inputs for MOW, `PREMIUM_FLOOR`, "November 2026 — 20 working days".
4. PULSE `COMM_RULES` → November + MOW; October pinned; `extraHolidays` + spec.
5. Agent page: MOW labels, plan picker, gross-sales input mode, premium floor.
6. Verifiers: `verify-comm-model` (November + MOW to the cent), `verify-agent-analytics` (plan sizes, MOW, stale-digest
   figures), `verify-public-holidays`.
7. Reviews (ECC code-reviewer + typescript-reviewer), then deploy: Pages, digest republish, Vercel.

## Success criteria

- Every published bracket equals its workbook row to the cent (verify-comm-model).
- AgentOS `commCalc` ≡ the deployed app source on every plan incl. MOW (verify-agent-analytics).
- September/October months show the same commission figures as before the change.
- comms-calc-five.vercel.app reads "November", offers Download & Test and Motor Warranty, and its numbers match AgentOS.
- November working days = 20 everywhere.
