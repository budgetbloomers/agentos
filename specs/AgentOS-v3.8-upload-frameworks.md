# AgentOS v3.8 Upload Frameworks & Copilot Spec — Operator Digest
*Distilled 2026-07-13 from "AgentOS_AI_Agent_Specification.md" v1.0 + "…_DETAILED.md" v2.0 (user-supplied, synthesised from the AgentOS v3.8 build, 204 verified checks). This digest is the in-repo reference; the source documents are the user's originals.*

**STATUS (this repo):** the S5 Power BI money source landed 2026-07 — `BI_ACTIVE_CASES` **is** this dashboard's money model. The legacy Activated-Services + GWP-table pricing was removed at the same time (`SF_ACTIVATED_SERVICES` and the `SES_ACT_*` slots now survive only inside the `RETIRED_SRC` purge list; `GWP_TABLE` is gone entirely).

## 1. Prime directive
Every number must be recomputable from a **named file, a named window, and named filters**. No file, no number. Rules are data (never hardcode a threshold or premium). The Agent List is the identity base. Honest remainders (unmapped/rejected rows are surfaced facts). Manual upload is doctrine — the client forbids integrations.

## 2. THE MONEY MODEL (the headline change)
**One money model: Power BI - Active Cases. GWP is never hardcoded or price-table-driven.**

- **THE MODEL (`BI_ACTIVE_CASES`):** GWP = Σ `Charge Amount` per account. **Charges are EX-VAT** — proof: Titanium Single's three lines 30,43 + 33,91 + 21,74 = R86,08 = R99 ÷ 1,15. Gross up ×(1 + vatRate) to inclusive. Sale dated **per row's** Contract Create Date (an account with contracts on two days contributes to both). Attribution: `cbOfOwner(Owner)`. Ex-VAT headline = raw charge sum to the cent.
- **No fallback.** With no BI file loaded, money reads **blank and says so** (`biLoaded()` gates it) — there is no legacy path to fall back to. The old highest-GWP-table-product-per-account model and its hardcoded price lists were removed 2026-07; never reintroduce them silently.
- **Cancellations:** inactive file, unique per account, windowed by Contract Create; *GWP Lost* reported separately, never netted.
- **Three GWP-target flavours — never conflate:**
  1. Scorecard target = roster daily target × `gwpMult` (89) → CB15: 8×89 = R712.
  2. NBA period target = `gwpFloor` (99) × daily target × working days.
  3. Cycle targets = per-campaign rand values in rules (Cuddle 389 285,16 · Courtesy 375 092,52), VAT-inclusive.
- VAT is a rule (default 15), **zero-safe** (0% means ex = incl, never a silent 15 fallback).
- Real BI extract: 10 673 rows · 3 484 accounts · R318 140,91 ex → **R365 862 incl**; ≤20 rows/account (mode 3).

## 3. Source contracts (S1–S12) & the quirk catalogue
| # | Source | Format · windowing | Join | Key quirks |
|---|--------|--------------------|------|------------|
| S1 | AGENT_LIST | xlsx · **daily snapshot, replaces wholesale**, rebuilds all identity maps | CB code | Q1 duplicate trailing Employee Code col (first wins). 96 agents; targets 5/4/8/0 |
| S2 | SF_OPEN_CASES | `.xls` that is **HTML table** (Q2) · snapshot (date filter never applies) | cbOfOwner(Case Owner) | Q3 owners suffixed `- Panimax`/`- EC3` incl tight `Name- Panimax` |
| S3 | SF_CLOSED_CASES | HTML-xls · windowed by close date; carries opened_at (feeds Leads Assigned) | cbOfOwner | 58,1% "Closed - No feedback"; Q11 closures stamped one date (artifact — throughput/day meaningless until dailies accumulate) |
| S4 | ~~SF_ACTIVATED_SERVICES~~ | **RETIRED 2026-07** — in `RETIRED_SRC`, actively purged on load (with the `SES_ACT_*` slots) | — | Superseded by S5. Do not reintroduce |
| S5 | **BI_ACTIVE_CASES** (Power BI) | xlsx 45 cols · **accumulating + windowed** — a re-upload replaces only **its own Contract-Create-Date span**, other months are kept (deliberate deviation from pack R-ING-BI-06); date filter applies to reads | cbOfOwner(Owner) | Q4 duplicate `Charge Amount`/`Contract Status` headers (first wins); Q5 Excel serial dates; **charges ex-VAT** (Q15) |
| S6 | CALLX_CALL_RECORDS | xlsx · windowed by Date & Time | cbOf(agent) | Q6 `Name CB-15` and `Name - CB221` variants; Q7 inbound legs blank agent + destination `s` → excluded from uniques; call_band derived live from band rule; Vici adapter later |
| S7 | QA_EVALUATIONS | csv 35 cols · windowed | code → name | Q8 durations `13;59`, tab-prefixed, trailing `/`, 7-digit call-IDs → normalise, junk→null, **6h cap** (fixed a 222 253h phantom → 93h05m); Q9 SM Escalation Reason blank fleet-wide (column reads 0 honestly) |
| S8 | ATTENDANCE | xlsx · windowed · join Employee Code (no dash) | normCB | 12 codes; **Q10 Terminated/Resigned = roster-exit rows** → excluded from every rate denominator, counted as **attrition**. Verified: attendance 886/965 = 91,8%; unplanned 21/965 = 2,2% |
| S9 | SF_INACTIVE (cancellations) | xlsx `Export` · windowed by Contract Create · unique per account | cbOfOwner | Q3b tight-hyphen owners |
| S10 | ~~GWP_TABLE~~ | **RETIRED 2026-07** — no longer a source in the dashboard at all (zero references) | — | Priced the legacy money model; superseded by S5 |
| S11 | REFERRALS | csv · one row per referred contact | `Agent:` line **extracted from Referral Details note** | `Submitted:` dates it; `Total Referrals:` can exceed rows (CB70 true total 40 over 38 rows); Q12 **211 names (~40%) off-roster** — red note, never dropped; legacy simple format still loads |
| S12 | Session slots ×10 | `SES_{DIAL|OPEN}_{0800,1000,1200,1500,1630}` (the five `SES_ACT_*` slots are retired/purged) | as parents | Replace-per-slot; **never mix into daily analytics; date filter never applies; roster filters do** |
Also: Q13 BOM on CSVs stripped · Q14 `0||15` falsy-VAT trap (isNaN-guarded).

## 4. Identity resolution (the spine)
- `normCB`: strip non-alphanumerics, uppercase → CB15 ≡ CB-15 ≡ cb 15.
- `normName`: lowercase; **strip from any hyphen touching a space** to end (kills `- Panimax`/`- EC3`, preserves tight double-barrels like Anne-Marie); collapse whitespace.
- `cbOf(agent)`: alias map (roster Call x) → extractCB → sfOwnerMap[normName].
- `cbOfOwner(owner)`: sfOwnerMap over roster Sales Force + Agent Name.
- `cbDept(cb)`: department = the CB's **latest attendance row** (roster has no department).
- `groupOf`: Exp → `EXP - {first word of queue}`; else tenure. Groups: M1 / M2 / EXP-CUDDLE / EXP-COURTESY.

## 5. The five clocks (state which one applies)
1. Global window (presets + custom; "All" clamps to earliest data day for working-day maths).
2. Sessions — no dates ever.
3. Cycle clock — `cycleStart` + `cycleDialingDays`; Days Past = distinct dial-days per campaign; ignores global window.
4. WoW/MoM — calendar weeks/months **anchored to attendance's own latest day** (a global anchor once emptied every window).
5. Snapshot sources show latest upload regardless of window; **BI is the exception** — months accumulate (a re-upload replaces only its own Contract-Create-Date span) and reads are windowed.

## 6. Metric dictionary (quote verbatim; twins named)
Attendance % = present ÷ (scheduled − exits) · Unplanned = codes-in-no-rule ÷ same · Attrition = exit-code rows per window · Unique calls = distinct destinations excl blank/`s` · Answer rate = band ≠ No Answer ÷ all · Talk/day = billable min ÷ present days (targets 210/150) · **Conversion has TWO flavours:** Card = sales ÷ total leads (open+closed); Lead-Mgmt = sales ÷ total closed · Wasted = Total Closed − Sales (floor 0) · **Payroll SPD** = sales ÷ working days and **Dialing SPD** = sales ÷ agent's distinct dial-days (both **[CONFIRM Ryan]**) · Att/Lead = total dials ÷ unique leads (3–5 diagnostic band, never scored) · QA average weights **critical-fail calls as zero** · CFR = fails ÷ audited · Disputed = closed_retracted + qa_review · Target Ach % = (sales ÷ present days) ÷ daily target · GWP/Sale vs R99 = value check · Daily movement: Assigned = opened-that-day (open∪closed); SPD = sales ÷ present headcount; Closure/day = closed ÷ headcount.

## 7. Rules registry (all live-editable, never baked)
**The Dictionary in the dashboard is the single source for every default** — `DEFAULT_RULES` in `Chatterbox_AgentOS_Analytics.html` (~line 573), each entry carrying its own label, help text and intent. Read it there; never quote a frozen copy from this digest (values are user-editable at runtime, so any copy here is wrong the moment someone edits a rule).

Rule groups: attendance codes (present/leave/exclude) · salesDepts · call bands · QA pass/coaching/critical + dispute statuses · discStages · staleDays · gwpMult · vatRate (zero-safe) · cycle rules (start/dialing days/targets) · leadWindow · `nbaThresholds` (the NBA ladder + R2A tiers + penalties) · `compositeWeights`.

## 8. NBA v3.0 (the engine's contract)
Most-serious-first ladder R1→R10 with R2A tiers exactly as `cfTier` / `acComposite` / `acNBA` in `Chatterbox_AgentOS_Analytics.html` (~lines 2450–2470) implement — that dashboard code IS the engine (the standalone `engine/nba-engine.mjs` was deleted 2026-07-15). R2A tier = HIGHER of count/rate band, penalty capped at the top tier's value, R2A-1 never surfaced as primary, Elite blocked at R2A-2+. Two-Check: value (≥R99/sale) before volume (≥100% target). **Composite renormalises over available metrics**, rank within tenure group. R4A = value passes but volume <70% → PIP.

## 9. Campaign targets & ownership
Cuddle 8/day · Courtesy 5/day · M2 4 · M1 3 (roster Target column authoritative per agent).
Owners: Nick (design) · Ryan (data/dashboards/quality) · Jared (QA/clean-sale) · Claudell (People/attendance/discipline) · Abigail (Recruitment/WFO) · Keshav (recruitment demand) · Aarav (CRM/automation) · Leon + TLs (floor) · Mekaeel (finance). **Ambiguity routes to the owner, never resolved by guessing.**

## 10. Open items (answer "unconfirmed", name the owner)
O1 SPD pair definitions — Ryan · O2 per-tenure conversion targets — Nick/Ryan · O3 clean-sale definition + CallX↔QA call-ID mapping — Jared/Ryan · O4 discipline ladder sign-off — Claudell · O5 the 211 unmatched referral names — Ryan · O6 Vici field map — Ryan · O7 Matrix VT cycle target — Mekaeel/Nick · O8 % sales/QA'd direction — Nick.

## 11. Copilot architecture & skills (Horizon 1)
Modes: **A** Claude Project (Q&A) · **B** Claude Code/Cowork + Skills (operations; reads real exports WITH CODE, never pastes rows) · **C** in-app panel (≈5KB context: rules + KPI dictionary + current aggregates + filters) — our deployed **Ask AgentOS widget IS Mode C**.
Twelve skills: SK1 validate-upload (GO/HOLD per file; never fix silently) · SK2 daily-brief (every number `[file · window · filters]`-tagged) · SK3 parity-audit (recount any figure from raw — the trust engine) · SK4 explain-metric · SK5 nba-coach (never surfaces R2A-1) · SK6 rule-impact (simulate, human applies) · SK7 mapping-triage · SK8 session-pulse · SK9 cycle-pace · SK10 guide-sync · SK11 quirk-sentinel · SK12 lifecycle-intake (Horizon 2).
Existing repo skills map: /upload-check≈SK1 · /weekly-report≈SK2+SK5 · nba-analyst≈SK4/SK5. Missing: SK3 parity-audit, SK6 rule-impact, SK7 mapping-triage, SK8/9/10/11.

## 12. Conduct (agent policy additions)
No file no number (cite file + window + filters) · definitions are law, twins named, open items flagged with owner · POPIA masking `M. Pi•••` style · propose don't mutate (rules/mappings/thresholds = evidence memo, human applies; NBA/discipline = drafts, no autonomous HR consequence) · honest remainders verbatim · never suggest direct integration · state the clock · SA conventions (en-ZA rands, comma decimals on cycle figures, VAT from rule) · drift = HOLD + report + wait · stay evaluable (prefer claims a parity-audit could grade).

## 13. Acceptance exam anchor answers (for evaluation)
Attendance 91,8% (886/965, 35 exits excluded) · unique calls 8 800 · Madelien legacy GWP R99 (max-product, never R168) · BI total R365 862 incl / R318 141 ex · ex-VAT proof 86,08 = 99÷1,15 · CB15 conversions 4,2% card / 4,8% lead-mgmt · her QA 95,4% (crit-as-zero over 27) · her tier R2A-1 −2 never surfaced · scorecard target 8×89 = R712 (13,9%) · required/day R19 459,31 incl / R16 921,14 ex · TL→SF reach 280/1 398 · top assessor 511 evals · 93h05m (post 6h-cap) · disputed = 30 · CB70 referrals = 40 not 38 · WoW/MoM = attendance clock · new attendance code → unplanned-absence fallback + banner + route to Claudell.
