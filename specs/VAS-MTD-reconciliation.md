> **Superseded in part, 2026-08-09.** The VAS MTD Reporting Engine spec v6.0 is now the rule
> book, extracted to [`mtd_engine_rules.json`](mtd_engine_rules.json) and wired into the app
> (`MTD_RULES` in `nicks_code/index.html`, enforced by `diagnostics/verify-engine-rules.mjs`).
> It answers four of the questions this document left open:
>
> | Left open here | Ruled by spec v6.0 |
> |---|---|
> | §5 "an agent with no talk and no sales does not count as a shift worked" — *your call* | **Yes, for Courtesy and Nesting.** Actual Shifts are dialler-derived (§6.2): `HDCA → 0.5`, else `talk > 0 → 1`, else `0`. Cuddle stays on the register — ViciDial is period-aggregated and cannot answer per day. |
> | §5 Theva Pragasen / Darrien Govender counted as employed — *your call* | **Excluded** (§5), with `CB265`. A maintained list, not a data rule: CB143 has an identical status and stays in. |
> | §5 the 4 Nesting agents dropped silently | **Nesting is a reported campaign** (§7) with its own MTD section and export sheet. |
> | §5 `Kasavani Snakarparsad` spelling | Display name now comes from the roster's **`Sales Force`** column, not `Agent Name` (§3). |
>
> Still open and unchanged: **Referrals have no source file** (§5, spec OI-01) and **Courtesy
> talk time needs the CallX agent-summary report** (§4, spec OI-15). Both need a file only
> Nick can pull. Everything in §0–§4 below still stands and is still enforced.

# Why the software's MTD did not match the August file — and the exact rules that make it match

Reference: `uploads/2026-08-06/VAS - August 2026 MTD Tracker 1 - 4 Aug.xlsx` (the hand-built
workbook) against the Pulse VAS dashboard (`nicks_code/index.html`) fed the same seven
exports. Every figure below is from the real files; the checks live in
`nicks_code/diagnostics/verify-mtd-values.mjs` (26 assertions).

---

## 0. The headline: two different things were being compared

The workbook is titled **1 – 4 Aug** and it means it. It contains **two dialling days**:

| | Workbook | Software (calendar August) |
|---|---|---|
| Days with a shift register | 03, 04 Aug | 03, 04, 05 Aug |
| Days with sales | 01, 03, 04 Aug | 01, 03, 04, 05 Aug |
| Employed Shifts per agent | 2 | 3 |

1 Aug is a Saturday: the BI export carries four sales dated to it, but the HR register has no
entry, so it contributes money and no shift — both systems agree on that.

Everything downstream of Employed Shifts is a **multiple** of it:

```
Sales Target  = agent's daily target × Employed Shifts
GWP Target    = Sales Target × gwpPerUnit (R89)
Att %         = Actual Shifts ÷ Employed Shifts
SPD           = Sales ÷ Actual Shifts
```

So a one-day difference in the window moves Sales Target from 8 to 12, GWP Target from R712
to R1 068, and Employed Shifts from 2 to 3 — with nothing wrong anywhere. This is most of
what "the emp is wrong, the target is wrong, the GWP target is wrong" was.

**Rule: never compare the two without pinning the software to the workbook's own window.**
Once pinned to 1 – 4 Aug, before any code changed, these matched for **every single agent**:
Employed Shifts (0 of 25 Cuddle, 0 of 39 Courtesy differing), Actual Shifts, Att %, Sales
Target, GWP Target.

Cohen Govender is the example you sent. On the workbook's window the software now produces:

| | Workbook | Software |
|---|---|---|
| Employed Shifts | 2 | 2 |
| Actual Shifts | 2 | 2 |
| Sales Target | 8 | 8 |
| Sales | 4 | 4 |
| SPD | 2.0 | 2.0 |
| Cancellations | 0 | 0 |
| GWP Target | R712 | R712 |
| GWP | R416 | R416 |

The screenshot showing EMP 4 / TARGET 16 / GWP TARGET 1424 is a **four-day** window — the
calendar-month view over a data set that reaches the 5th. It is the same numbers, twice.

### The fix — BUILT: an "as at" cut-off

The period selector had no end-date control, so "MTD" silently meant *every date any file
happens to carry* — and the sources never end together: attendance to the 6th, BI to the 5th,
the dialler to the 5th, the workbook cut on the 4th.

There is now an **as at** date in the toolbar, next to the month. It caps where the period
ENDS without changing its shape — the month is still the month, week buckets and targets are
untouched, the window simply stops on the day you name. Set it to the day the tracker was cut
and the two line up:

| Cohen Govender | Workbook | Calendar August | **As at 4 Aug** |
|---|---|---|---|
| Employed Shifts | 2 | 3 | **2** |
| Actual Shifts | 2 | 3 | **2** |
| Sales Target | 8 | 12 | **8** |
| Sales | 4 | 8 | **4** |
| SPD | 2.0 | 2.67 | **2.0** |
| GWP Target | R712 | R1 068 | **R712** |
| GWP | R416 | R782 | **R416** |

Clearing it restores the full period; a date outside the period is ignored rather than
obeyed into an empty page. Alongside it, the MTD page now states the number of dialling days
in the window, and raises a note naming where each source ends whenever they disagree — so
the next time the numbers look wrong, the page says why before anyone has to ask.
Covered by `diagnostics/verify-asat.mjs` (20 checks).

---

## 1. Sales and GWP were NET of cancellation — they must be GROSS

**Where:** `INGEST.bi` — the money source is *Power BI – Active Cases*, which by definition
only lists contracts that are still active. A sale made on the 4th that cancels on the 5th
is simply **absent** from the next pull.

**The damage:** Sales Achieved and GWP shrank a little every time you re-pulled the export,
and `% of Cancellations to Sales` divided cancellations by a denominator that had already
had those same cancellations removed from it.

**The rule now implemented** (`grossUpSales()`):

```
gross accounts for (create-date, agent)
    = accounts in BI Active            ∪  accounts in BI Inactive
      (charge lines summed per account across BOTH files)

Sales Achieved = count of those accounts
GWP            = Σ round(account's total ex-VAT charge × 1.15)
```

The union is at **account** level, never row level, because that is the unit a sale is
counted in:

| Case | Before | After | Workbook |
|---|---|---|---|
| Account fully cancelled (Enoch Pillay) | 34 sales / R3 446 | 35 / R3 545 | 35 / R3 545 |
| One of 3 contracts cancelled (Amahle Makhanyela) | 7 / R668 | 7 / R693 | 7 / R693 |

Verified against an independent recompute: **62 of 65 agents match the workbook exactly**
(the other three are pull-date drift — see §5).

---

## 2. GWP was grossed up on the wrong total — round PER ACCOUNT

**Where:** `INGEST.bi`, previously `gwp: o.ex * 1.15` on the agent's whole day.

Charge Amount lines are two-decimal and ex-VAT. A Titanium Single account bills three lines:

```
30,43 + 33,91 + 21,74 = 86,08        86,08 × 1,15 = 98,992
```

but the account bills **R99**. Grossing up the agent's total carried that 0,008 rounding
error on every account and never recovered it.

**The rule:** round each **account** to the rand, then sum.

```
GWP = Σ_accounts round(Σ_charge_lines(account) × 1.15)
```

| | Before | After | Workbook |
|---|---|---|---|
| Cuddle GWP (1–4 Aug) | R46 970,35 | **R47 370** | R47 370 |
| Courtesy agents with a wrong Ave GWP | 30 of 39 | **0 of 39** | — |

Two consequences worth knowing: GWP is now always a whole rand (a total with cents is now a
bug), and the July back-history restates from **R2 320 517,89 to R2 379 497** — an
independent recompute confirms the new figure.

---

## 3. Cancellations were counted per CONTRACT — they must be per ACCOUNT

**Where:** `buildModel()`. Cancellations were stored one row per contract
(`account|contract|deactivate-date`) and counted one-for-one, while Sales Achieved counts
**accounts**. A cancelled 3-service account therefore read as **3 cancellations against 1
sale**, and `% of Cancellations` was roughly trebled.

**The rule:** count **distinct accounts** per create-date, the same unit as sales.

Once counted that way, and setting aside the two that deactivated on the 5th (after your file
was cut), the software gives **Cuddle 2, Courtesy 2** — exactly the workbook.

---

## 4. Talk Time was measuring the whole call, ring included

**Where:** `INGEST.calls` — `b.talk += durSecs(r['Duration'])`.

`Duration` is the entire call: dial, ring, connect, hangup. `Billable Seconds` is the
connected leg, and is zero on every BUSY / NO ANSWER row. On a 220-dial day the ~13 s of
ringing per dial is over an hour of *ringing* being reported as *talking*.

| Agent-day | Workbook | `Duration` (was) | `Billable Seconds` (now) |
|---|---|---|---|
| Cohen Govender, 3 Aug | 2:13:19 | 3:56:21 (+77%) | 2:32:11 (+14%) |
| Nosipho Shange, 3 Aug | 1:39:18 | 2:17:34 (+39%) | 1:41:10 (+2%) |
| Ramiska Binda, 4 Aug | 2:13:16 | 3:29:30 (+57%) | 2:13:37 (+0,3%) |

`durSecs` was also silently returning **0** for a bare number of seconds (it only understood
`h:m:s`), so the column would have read as no talk at all — fixed with the same change.

**Still open, and it needs you.** Across all 55 comparable agent-days, no arithmetic on the
call-by-call export reproduces your figure. Every candidate rule was tried:

| Rule tried on the call-by-call export | Exact hits | Mean bias per agent-day |
|---|---|---|
| sum `Duration` (what the app used to do) | 0 / 55 | **+4 031 s** |
| sum `Billable Seconds` (what it does now) | 0 / 55 | **+190 s** |
| Billable, dropping Voicemail | 0 / 55 | −718 s |
| Billable, dropping calls under 3 s / 5 s / 10 s | 0 / 55 | +159 / +71 / −92 s |
| Billable minus 1 s / 2 s per connected call | 0 / 55 | +62 / −60 s |
| Billable, wrapped calls only | 0 / 55 | −14 s |
| `Duration`, answered calls only | 0 / 55 | +2 732 s |

Nothing lands on it, and your figure is always a little *lower*. That is the signature of a
**CallX agent-summary report** — a report with its own Talk Time metric that excludes hold and
wrap — not of the call-by-call file. **Send that report, or name the column, and this becomes
exact.** Until then the app measures the right thing (connected time) by the best column the
call-by-call export carries, at ~3 % over instead of ~67 %.

---

## 5. What is left, and why none of it is a formula

| Difference | Cause | What to do |
|---|---|---|
| **Referrals read 0** | **No uploaded file carries referrals.** Not in CallX's 24 dispositions, not in ViciDial's 30 columns. The Adjustments page is currently their only source. | Either key them on Adjustments each month, or get a dialler disposition / export column created for referrals. This is the one gap with no data at all behind it. |
| QA differs on 12 Cuddle agents | Your evaluations export is an earlier snapshot; several calls were scored on 5–6 Aug. Courtesy QA already matches **0 of 12** — the method is right. | Nothing. Re-pull QA at the same time you cut the tracker. |
| 3 agents short/long by one R99 sale (Anerly Naidoo, Ramiska Binda, Thalente Xaba) | The sale exists in neither the 5-Aug Active nor the 5-Aug Inactive pull. It moved between your 4-Aug pull and ours. | Nothing the software can do — it can only report the file it is given. |
| 6 Courtesy agents' Actual Shifts (5,5 shifts, 6,6 pp of Courtesy attendance) | You zero a shift for an agent the HR register marks **Present** who produced nothing all day. The app follows the register. Note it is not a clean rule in the workbook either — Mzwandile Masuku, 4 Aug is zeroed despite 1:25 of talk and 3 sales. | **Your call.** Say the word and it becomes a live setting: "an agent with no talk and no sales does not count as a shift worked". |
| Theva Pragasen, Darrien Govender appear in Cuddle (+4 employed shifts, +32 sales target) | Sick leave and suspension for the whole period. They are on the roster and on the register, so the app counts them employed. You omit them. | **Your call.** Can be a rule: "statuses that carry no expectation of work do not accrue an employed shift". |
| `Kasavani Snakarparsad` | The Agent List's own **Agent Name** column spells it that way; the correct `Ashnee Kasavani Sankarparsad` sits in the *Sales Force* column beside it. | Fix it in `Matrix - Agent List.xlsx`. |
| 4 "Nesting" agents missing (CB261–264 — 20 sales, 1 122 calls) | The roster loader drops any agent whose campaign is not Cuddle / Courtesy / Tracker, and did so **silently**; their money was landing in *Unmatched agents* with nothing explaining why. | Now named in a toast at upload. Decide whether Nesting should be a reported campaign. |

---

## 5b. The proof: every agent, every day

`diagnostics/diff-daily.mjs` compares the app against the workbook's **August** sheet — one
row per agent per dialling day, the finest grain either system has. Over **130 agent-days**:

| Column | Rows differing | Why |
|---|---|---|
| Employed Shifts | **0 / 130** | — |
| Sales Target | **0 / 130** | — |
| GWP Target | **0 / 130** | — |
| Sales Achieved | 2 / 130 | Ramiska Binda 3 Aug, Anerly Naidoo 4 Aug — pull drift (§5) |
| GWP Achieved | 3 / 130 | the same two, plus Thalente Xaba 3 Aug |
| Actual Shifts | 7 / 130 | the manual overrides (§5) |
| Referrals | 24 / 130 | no upload carries them (§5) |
| Talk Time | 101 / 130 | the open item in §4 |

Nothing else in the daily sheet disagrees. Six rows exist in the workbook and not in the app
(the three Nesting agents × two days, §5); the app additionally carries the VT floor and the
two sick/suspended Cuddle agents, which the workbook's two campaign tabs do not cover.

## 6. The formulas, as they now stand

```
Employed Shifts   Σ days in period where the agent is on the roster, started, not terminated,
                  and the day has an attendance register (or the agent had activity)
Actual Shifts     Σ attWeight(HR status)      Present 1 · anything "half" 0,5 · else 0
Att %             Actual ÷ Employed
Sales Target      agent's daily target × Employed Shifts
Sales Achieved    distinct ACCOUNTS in (BI Active ∪ BI Inactive), dated by Contract Create Date
% of Sales Target Sales ÷ Sales Target
SPD               Sales ÷ Actual Shifts
Cancellations     distinct ACCOUNTS in BI Inactive, dated by Contract Create Date
% of Cancellations Cancellations ÷ Sales Achieved          (gross denominator — that is the point)
Ave Talk Time     Σ connected seconds ÷ shifts THE DIALLER COVERED (not every shift in the period)
GWP Target        Sales Target × R89
GWP Achieved      Σ_accounts round(Σ charge lines × 1,15)
% To GWP Target   GWP ÷ GWP Target
Ave GWP           GWP ÷ Sales Achieved
Referrals         Adjustments page only — no upload carries them
QA                mean Score % over evaluations whose Date of Call falls in the period
```

## 7. Order of work to close the remaining gap

1. ~~Add an "as at" end date to the period bar~~ — **done** (§0). Set it to the day a tracker
   was cut and the two reconcile.
2. **Send the CallX agent-summary report** so Talk Time can be made exact rather than close.
   This is the only systematic difference left, and it needs a file only you can pull.
3. **Decide the two attendance policies** in §5 — both can be live settings in minutes.
4. **Find a source for Referrals**, or accept the Adjustments page as the entry point.
5. Fix the agent-name spelling in the Agent List; decide on the Nesting campaign.

Items 2–5 are the whole remaining distance, and none of them is arithmetic — they are a file,
two policy decisions and a spelling. Everything in §0–§4 is done and held in place by
`diagnostics/verify-mtd-values.mjs` (26 checks), `verify-asat.mjs` (20) and `diff-daily.mjs`.