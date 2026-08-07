# August 2026 MTD Tracker — data & framework audit

**Date:** 2026-08-07 · **Scope:** VAS August MTD tracker vs software export · **Status:** framework fixed, three items blocked on source data

## Files compared

| | Rows | Period | Agents/day |
|---|---|---|---|
| `VAS - August 2026 MTD Tracker 1 - 4 Aug.xlsx` (manual — treated as truth) | 136 daily | Mon 03.08, Tue 04.08 | 68 |
| `VAS - August 2026 MTD Tracker 01.08 - 05.08.xlsx` (software export) | 356 daily | Sat 01.08, Mon–Wed 03–05.08 | 89 |

The periods differ, so every comparison below is on the **two shared days (03–04 Aug)** unless stated.

| Metric (03+04 Aug) | Tracker | Software | Δ |
|---|---|---|---|
| Daily rows | 136 | 178 | +42 |
| Actual shifts | 110.0 | 147.5 | +37.5 |
| Sales achieved | 631 | 608 | −23 |
| GWP achieved | R63,409.00 | R61,436.17 | −R1,972.83 |
| Talk time (03.08) | 148.49 h | 91.86 h | −38% |
| Referrals | 54 | 0 | −54 |

## Which sheet is authoritative

The tracker's **`August` daily sheet reconciles exactly** to its `MTD - Cuddle` and `MTD - Courtesy` sheets — employed shifts, actual shifts, targets, sales, GWP targets, GWP and referrals all tie to the cent. It is the base of truth.

Two sheets inside the tracker are **stale and self-contradictory** — do not reconcile to them:

- **`TL MTD`** claims 8 dialing days and 1,426 Cuddle sales; the August sheet has 2 days and 470. It is a leftover from a prior period.
- **`Team Split`** maps CB142/CB162/CB173 to *Kayleen Pillay*, while the August sheet (and the software roster) put them under *Nikita Baijnath*.

## Defects found and fixed

All fixes are in `nicks_code/index.html`, with regression tests in `nicks_code/diagnostics/august-rules.mjs` (12 assertions; **9 fail on the pre-fix build, all 12 pass after**).

**1. Non-dialing days booked full shifts.** Sat 01.08 appeared with 89 rows — every agent employed *and* present, attendance 100% — on a day with zero talk and zero sales across all 89. A source export carrying weekend header rows was enough to create the day. A date now counts only if somebody actually talked or sold on it, which also drops public holidays with no special-casing. *(`buildModel`, new `liveDate`; dropped days reported as `M.droppedDates`.)*

**2. Attendance was inferred, not read.** When no attendance file covered a day the code ran `act = active ? 1 : (emp ? 1 : 0)` — i.e. **employed therefore present**. Combined with defect 1 that is what produced the 89/89 Saturday. A missing register now books nothing, and an agent with no talk and no sale books no shift however the register was filled in (half-days still read 0.5). Affected on 03.08 alone: CB131, CB142, CB148, CB173, CB229. *(`settings.shiftNeedsActivity`, default on.)*

**3. GWP was ~1c light on every sale.** Charges are ex-VAT and were summed across the whole owner-day before a single gross-up, so R86.08 × 1.15 = R98.992 — the export shows **R98.99 where the tracker shows R99**. Gross-up and rounding now happen **per account**, which recovers the exact price point (R99, R199, R219 …). Confirmed by test: the pre-fix build returns `98.99199999999999`.

**4. Nesting agents were silently deleted.** The roster parser dropped any campaign outside a hardcoded allowlist (`cuddle|courtesy|track|vehicle|vision`), so the three Nesting agents — CB261 Justin Motilall, CB262 Busiswa Mathenjwa, CB263 Lindokuhle Phakathi (TL "TBC", **17 sales, R1,403 GWP** over the two days) — never entered the model. Nesting is now a first-class campaign that appears on the daily sheet but stays out of the campaign tabs and the grand total, exactly as the tracker treats it (Cuddle 470 + Courtesy 144 = 614; Nesting 17 sits outside).

**5. Vehicle Tracking polluted the VAS roll-up.** 22 VT agents (Ryan Govender's team, plus CB112 and CB157 mapped under Dhamendra Budhu) carried Employed = 1 and Actual = 1 with target 0 and no sales, adding ~17 actual shifts/day of pure dilution to attendance and target maths. The app's own rule is "VT never inflates the VAS headline KPIs". The grand total now filters on `VAS_CAMPS` rather than merely excluding `VT`.

**6. TL MTD was missing seven rows.** `QA %` exported blank because QA was only ever computed per agent — TL and campaign rollups had no `qa` at all. Added, averaged over every evaluation in the group (so a 10-eval agent weighs 10× a 1-eval agent, same basis as the campaign figure). Also added the rows the workbook carries and the export omitted: Dialing Days, % of Cancellations, Ave Talk Time, % Of Referrals, % Of Agents on Target.

**7a. Dot-separated dates never parsed.** `parseDateLoose` accepted `-` and `/` but not `.`, while the tracker workbook writes `03.08.2026` — the ZA convention used throughout these exports. Every tracker row failed the date check and was skipped silently (`if(!d||!code){ skip++; continue; }`), so uploading the workbook to back-fill a month did nothing at all. Found by feeding the real August workbook into the app: the model came back with **zero dialing days**. Fixed; `dateFromFilename` already accepted dots, so the two were inconsistent.

**7. The daily sheet omitted five derived columns.** Att %, % of Sales Target, % of GWP Target, Ave GWP and % Of Referrals To Sales Achieved were not exported, so the daily sheet could not be reconciled line by line. Added.

**8. VAT rate was hardcoded.** `const VAT=1.15` in Pulse against a live-editable `vatRate` rule in Ops — today both are 15%, but any Dictionary change would have silently diverged every money figure between the two apps. Now `settings.vatRate`.

## Not fixed — these need source data or a ruling

**A. Sales definition (register item S1 — needs Finance).** The tracker counts **one more sale than the software for certain agents**, each worth ~R99: 03.08 CB176 (5 vs 4), CB95 (9 vs 8); 04.08 CB17 (12 vs 11), CB197 (16 vs 15), CB44 (12 vs 11), CB70 (21 vs 20). Two explanations fit the evidence equally well and I cannot separate them without the Power BI export:

- the tracker counts unique **opportunities/contracts** where the software counts unique **accounts** (one account, two contracts), or
- the software's file was pulled a day later and *Active Cases* had already dropped a contract cancelled in between.

I did **not** change the sales grain, because `specs/AgentOS-v3.8-upload-frameworks.md` §2, `migration-005` and CLAUDE.md non-negotiable 6 all define GWP as "Σ Charge Amount **per account**" — the software currently implements the documented rule correctly. Changing it is a governance decision, not a bug fix. **Send the August Power BI - Active Cases export and I can settle it in minutes** by checking whether the affected accounts carry two `contract_number`s.

**B. Talk time — the call-record join drops ~22 agents/day.** 03.08: 148.49 h → 91.86 h (−38%); 04.08: 165.14 h → 106.01 h. Agents with real talk in the tracker export as `0:00:00` — CB106, CB136, CB137, CB15, CB152, CB17, CB19, CB196, CB197, CB206, CB21, CB30, CB42, CB44 and more — and **never the reverse**, so calls are being dropped, not just misattributed. A few agents also gain time (CB176: 02:02:28 → 3:19:10), which points at misattribution on top. The roster shows why the VT ones fail — blank `Call x` (no dialer name) — but the Cuddle/Courtesy agents above all have one, so the fault is in the matching itself. **I need the August call-records export** to fix this properly; guessing at name-normalisation without the real dialer strings would be reckless.

**C. Referrals and cancellations have no source.** Referrals export as 0 everywhere against the tracker's 54 (Cuddle 50, Courtesy 4). Cancellations run the other way: 91 in the software (Cuddle 70, Courtesy 21) against the tracker's 4. Both are Adjustments-tab manual inputs — the BI ingest hardcodes `canc: 0` — so this is data entry, not calculation. The cancellation figure in particular looks over-entered by a wide margin and should be checked before anyone reads it.

## End-to-end proof

`nicks_code/diagnostics/august-reconcile.mjs` feeds the **real August workbook's daily sheet** into the app and compares the model against the workbook's own MTD tabs. On the fixed build, **17/17 pass**:

```
dialing days: 2026-08-03, 2026-08-04
Cuddle    emp 50  act 44.5  target 400  sales 470  gwpT 35600  gwp 47370  ref 50
Courtesy  emp 80  act 59.5  target 380  sales 144  gwpT 33820  gwp 14636  ref 4
Nesting   broken out separately;  grand = 614 = Cuddle + Courtesy (Nesting excluded)
```

Every figure ties to the workbook exactly. The same suite returns **0 dialing days and 16 failures** on the pre-fix build.

## Why the running app still shows the old numbers

The screenshot of `Matrix Courtesy` (EMP 4 for every agent, attendance 100%, Bandile Dlamini 3 actual shifts) is the **pre-fix build** — EMP 4 is 01+03+04+05 August, i.e. the phantom Saturday is still being counted, and the MTD tab strip has no **Nesting** chip. Nothing was wrong with what you were looking at; it simply predates these fixes.

The fixes are on branch `claude/august-file-audit-reconcile-k1tgw0` and are **not live**. To ship them:

1. Merge the branch to `main`.
2. `node tools/prepare-site.js` — already run here; `site/pulse/index.html` now carries the fixes.
3. `npx wrangler pages deploy site --project-name chatterbox-agentos`.

I could not run step 3: `chatterbox-agentos.pages.dev` and `api.cloudflare.com` are both blocked by this session's egress policy (403 on CONNECT).

## Important caveat on scope

**The uploaded software export was not produced by any code in this repository.** It contains `Pivot Table`, `Team Split` and `August` sheets, plus Excel pivot vocabulary (`Row Labels`, `Sum of…`, `Count of…`), none of which appear anywhere in the codebase; Pulse's own exporter emits `Daily` and `WTD - Cuddle - Week 1`. Its TL MTD is also a superset of Pulse's.

The defects above were nonetheless **proven present in this repo's Pulse engine** by test, and are fixed here. But if your live tool is a separate build, these fixes will not reach it until the same changes are applied there — tell me where that build lives and I will port them.
