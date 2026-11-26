# Spec 074 — VT agents scored on the VAS KPIs, and VT data that never goes stale

**Status:** DRAFT — awaiting the owner's approval. No code until approved.
**Owner request (26 Nov 2026):** "now for the score in the agent analytics for the vehicle tracking, the kpi must be the
same as the agent from vas analytics build that out, and just make sure all the data in vehicle tracking is correct and
its not static because data will be uploaded everyday for VT — use addyosmani"

---

## Capability map

| Module id | Responsibility | Depends on |
|---|---|---|
| `vt-targets-live` | VT budgets and targets set **in the app** each cycle (no code edit), carried forward and labelled until set | — |
| `vt-composite` | Score every VT agent on the VAS composite's seven KPIs, weights and bands; Agent Analytics paints it like a VAS agent's card | VT book, VAS QA / dialler / attendance stores, `vt-targets-live` |
| `vt-freshness` | Prove the VT pipeline is live end to end: upload → book → reports → digest → Agent Analytics, every day, every cycle | the two above |

**Build order:** `vt-targets-live` → `vt-composite` → `vt-freshness`. (The score needs this cycle's targets first.)

---

## What was measured (26 Nov, read-only)

### The two scores today
| | VAS agent (specs/composite_rules.json) | VT agent (specs/vt_engine_rules.json, vt-1.4) |
|---|---|---|
| KPIs | **Avg GWP per Sale 25 · Target Achievement 20 · QA Score 20 · Total GWP 15 · Conversion 10 · Talk Time 5 · Attendance 5** | Target Achievement 50 · Fitment Rate 50 |
| Bands | Elite 90 · Strong 80 · On track 70 · Building 60 · Needs support | the same |
| Computed in | PULSE `compositeFor()` → agent digest → Agent Analytics | `VTEngine.rating()` → VT digest → `agent/vt-view.js` |

### Do the VAS KPIs' sources carry VT agents? (VT roster today: 42 agents)
| KPI | Source | VT coverage (one recent week) |
|---|---|---|
| Attendance | HR attendance register | **42 of 42** |
| QA Score | QA evaluations (`engine_qa_day`) | **27–33 of 42 per day** |
| Talk Time · Conversion | ViciDial (`vici_calls`) | **yes** — VT dials under its own user groups (Fabian_Digital, Ryan_Scheduling, Ryan_Digital_Ref) |
| Target Achievement | Agent List target per VT agent | **yes** — already scored |
| Avg GWP per Sale · Total GWP | the VT case book | **values yes** (BI Charge Amount on every fitted case daily; Schedulers Data GWP when that sheet is loaded) — **targets: none exist** |

### Static vs live (the second half of the request)
| Item | State | Risk |
|---|---|---|
| VT digests (Agent Analytics' data) | republished automatically (13:01 today, Nov + Dec) | ✅ live |
| Agent targets | from each Agent List upload | ✅ live |
| Sale dates, statuses | from each daily upload | ✅ live |
| Public holidays | computed per year | ✅ live |
| **Cycle budgets** (Sales Review targets, fitment / missed / cancelled budgets, headcount) | **typed into the rule book per cycle; only November exists** | ❌ **static.** December began **today** (26 Nov – 25 Dec) and is running on November's numbers. Every month needs a code edit. |
| Campaign → channel map | in the rule book | ⚠ a new campaign lands in "Other" and is named in a banner (honest, but needs a code edit to map) |
| Daily VT uploads | last daily export: **10 Nov** | ⚠ operational — December has no sales yet, so VT agents' cards are empty until uploads resume |

---

## Proposed design

1. **`vt-targets-live`** — an admin "VT targets" panel (Upload Station, VT mode) to enter each cycle's budgets: sales and
   fitments per channel, fitment / missed / cancelled / scheduled %, headcount, and the GWP targets the new score needs.
   Stored in the database (one row per cycle, audited, compare-and-set like every other save). **A cycle with no entry
   carries the latest earlier cycle forward and says so on every page** (today's behaviour, now automatic). The rule
   book keeps November as the seed. Nothing about targets needs a deploy again.
2. **`vt-composite`** — a VT agent's score uses the VAS composite's own rule book (same seven drivers, weights, bands,
   scoring curves). Inputs: QA, Talk Time, Attendance and Conversion from the same VAS stores, keyed by the agent's CB;
   Sales, Target Achievement and GWP from the VT book. One scoring function serves both, so the two can never drift.
   Agent Analytics shows a VT agent the **same card layout** as a VAS agent.
3. **`vt-freshness`** — a nightly guard (like `verify-agent-card`) that recomputes every VT agent's card from the live
   book and fails loudly if the published digest disagrees, is older than the last upload, or the current cycle has no
   targets on file; plus a health-banner alert when no VT daily file has landed for 2 working days.

## Success criteria

1. Every VT agent's Agent Analytics card shows the VAS composite's seven KPIs, weights and bands, from live data.
2. A VT agent and a VAS agent with identical inputs get identical scores (one function, proved by a test).
3. December's targets can be entered in the app today, and the VT Report, Sales Review and scores use them on the next load
   — no code edit, no deploy.
4. A cycle with no targets carries the previous cycle forward and says so on screen.
5. The nightly guard proves digest = engine for every VT agent; a stale digest or a missing upload raises an alert.
6. All existing VT suites stay green; the workbook oracle stays at 3,508 / 0.

## Boundaries
- **Always:** one scoring function for VAS and VT · targets never hard-coded again · an absence is never a nought.
- **Ask first:** any change to the VAS composite's weights or bands (VAS agents would move too).
- **Never:** score a VT agent on a KPI with no target on file without saying so on the card.

## Open questions for the owner — the answers change what gets built

1. **Fitment Rate.** It is VT's core outcome, but the VAS score has no Fitment Rate. Use the seven VAS KPIs exactly
   (Fitment Rate shown on the card but not scored), or replace one VAS KPI with Fitment Rate (e.g. Conversion)?
   *Default if unanswered: the seven exactly, Fitment Rate shown beside them, not scored.*
2. **Which GWP for VT?** (a) BI Charge Amount × VAT on fitted cases — arrives with every daily upload; or (b) the
   Schedulers Data sheet's hand-typed GWP — only when that sheet is loaded. *Default: (a).*
3. **GWP targets for VT agents.** None exist. VAS uses tenure targets (an R99 floor per sale and a period GWP target).
   Do you have VT figures, or should VT start on the VAS targets until you set them in the new targets panel?
   *Default: you enter them in the panel; until then those two KPIs read "no target on file" and are left out of the score.*
4. **December's budgets** — do you have the Sales Review numbers for 26 Nov – 25 Dec? If not, November carries forward,
   labelled, until you enter them.
5. **Conversion for VT** = VT sales ÷ leads the agent dialled on ViciDial's VT queues — is that right?
