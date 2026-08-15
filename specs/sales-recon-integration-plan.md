# Variance Report → native VAS Analytics tab — Implementation Plan v3
*2026-08-14 · from dissecting `sales-recon-demo.zip` (built from the real 13 Aug files). v2 per Nick: NATIVE tab inside the VAS Analytics module — no iframe, no second shell, no separate dropdown — uploads fold into the EXISTING Upload Station. v3 per Nick: the tab is named **Variance Report**, and the required uploads are spelled out (§3a). Status: BUILDING.*

> **2026-08-15 — a Variance Report tab SHIPPED, on a different rule book.** Nick supplied
> `specs/vas_variance_report_rules.json` (the VAS Variance Report spec, artefact A: Salesforce
> vs agent-logged board vs dialler per agent-day) and named it the source of truth. That module
> is live: `nicks_code/index.html` → NAV `variance`, `VARIANCE_RULES`, `buildVariance()`, the
> **Manual Stats** upload slot (`INGEST.board`, this plan's "Board Stats" renamed), guarded by
> `diagnostics/verify-variance.mjs` (46 checks). Key divergence from THIS plan: sales are dated
> on **Contract Create Date** (spec DV01), not Account Create Date, and the baseline comparison
> is board-vs-Salesforce only — the four-way VICCI/CallX source recon in this plan (§2.3, §3.3
> recon counters) remains UNBUILT. If that source-vs-source view is still wanted, build it as a
> separate sub-tab reading `RECON_RULES`; do NOT rebuild the `variance` tab or re-add a Board
> Stats slot — the upload already exists as Manual Stats.

## 1. What is in the zip (dissection)

| File | What it is |
|---|---|
| `index.html` (112KB) | The finished module: five tabs with the 13-Aug data baked in as `const SEED`. Plain HTML/CSS/JS. |
| `index.template.html` (67KB) | Same layout, `/*SEED_GOES_HERE*/` marker instead of data. **Every render function reads only from SEED** — that is the porting seam. |
| `recon-seed.js` (44KB) | The data contract: `{period, boardDay, days, coverage{src:[dates]}, files, rules, pbiStats, agents[{code,name,camp,tl,ten,target,cov,d,dd,alias,gwp}], unmatched[], defects[]}`. `d` = sales per source per day as counted; `dd` = repeat dispositions collapsed. |
| `build.py` | Python seed builder. **All rules are named constants at the top** (VICCI_SALE_STATUS={VASNP,VASKP}, CALLX_SALE_DISP={2 dispositions}, CALLX_INCLUDE_INBOUND=True, PBI_UNIT="Account Number", DEDUPE_KEY_COLS, BOARD_SHEET per day). Made obsolete by this integration — the app computes the seed itself. |
| `README.txt` / `INTEGRATION.txt` | Findings, join doctrine, 10 open decisions. |

**Tab name**: **Variance Report** (Nick, 2026-08-14) — one entry in the VAS Analytics nav (Analytics group). Its former five internal tabs become **four in-page sub-tabs** — Reconciliation · Variances (badge) · Source Coverage · Agent Mapping (badge) — following the MTD page's existing sub-tab pattern. The module's fifth tab (its own Upload Station) is **dropped**: uploads happen in the app's real Upload Station.

## 2. Rules & frameworks carried verbatim (the module's doctrine)

1. **Join spine = Employee Code via Agent List sheet VAS**; per source: VICCI `user` = zero-padded CB (CB014≡CB14); Call X `Agent` matches the roster's `Call x` column **as a literal string**; Power BI `Owner` strips ` - Panimax` then name-matches; Board matches normalized name.
2. **NEVER regex the CB out of the Call X agent string** — four roster aliases embed wrong codes (CB137→"…CB-138", CB143→"…CB-144", CB144→"…CB-145", CB148→"…CB-178" colliding with the real CB178). Literal match, name fallback, remainder reported. (PULSE's `resolveKey` already obeys this.)
3. **Campaign partitions the sources**: Cuddle=Power BI, Courtesy=Call X, Nesting=VICCI, everyone=Board → a TWO-way comparison per agent; sparse columns legitimate; "not on this system" ≠ 0.
4. **Sale definitions** (→ `RECON_RULES`): VICCI status ∈ {VASNP,VASKP} with the VAS-campaign-only assertion (fail loudly, never drop silently); Call X Lead Disposition ∈ {"VAS Sale No Insurance Opt In","VAS Insurance Opt In"}, inbound included; Power BI = distinct **Account Number** per agent dated on **Account Create Date** (⚠ deliberately different from the money model's Contract Create Date — separate counters, never merged); Board = populated Sale 1..27 cells (cell value = GWP).
5. **Board Stats is ONE DAY per file** — one board upload per day, merged per day like attendance.
6. **Partial-coverage exclusion**: a source that only partly covers the selected window is marked "Partial", starred, excluded from spread/variance/status. MTD then honestly reports nothing comparable.
7. **De-dup toggle** (34 repeat rows, same agent+number+day): counted as-is by default, collapsible via toggle; both figures carried in the seed (`d` vs `dd`).
8. Baseline (default Board) compares each source **over the agents both cover** — never whole-file totals.
9. **13-Aug acceptance anchors**: VICCI 36 · Call X 569 (dedup 537; 13 Aug 115/110 vs board 103) · PBI 386 (1,142 rows → 377 accounts; 8 accounts on 2-3 agents) · Board 331 · 30/47 reconciled · Nesting 7=7 exactly · 7 join defects listed.

## 3a. UPLOADS NEEDED — what feeds the Variance Report, per day

| # | Upload (existing Upload Station slot) | Feeds | Campaign it reconciles | Cadence |
|---|---|---|---|---|
| 1 | **Matrix - Agent List.xlsx** (VAS sheet) — *existing slot* | The join spine: CB codes, names, `Call x` aliases, campaigns, TLs | all (identity) | Daily (replaces roster) |
| 2 | **ViciDial call report** — `EXPORT_CALL_REPORT_*.txt` (preferred) or the Call Report xlsx — *existing slot* | VICCI sales (status VASNP/VASKP per agent-day) | **Nesting** | Daily |
| 3 | **Call X call records** — `call_records*.csv` — *existing slot* | Call X sales (the two VAS dispositions per agent-day) | **Courtesy** | Daily |
| 4 | **Power BI Active** — `Active.xlsx` — *existing slot* | PBI sales (distinct Account Number per agent, dated Account Create Date) | **Cuddle** | Daily, and it must be **exported up to the board day** — a stale export (13-Aug package was 2 days behind) makes Cuddle unreconcilable |
| 5 | **Board Stats.xlsx** — **NEW slot (the only new upload)** | The board baseline: Sale 1..27 cells per agent (value = GWP) | all (baseline) | **One file per day** (sheet named DD.MM); re-upload replaces its own day |

The report never blocks on a missing upload — a source absent or only partly covering the selected window is marked "Partial"/missing, shown with an asterisk, and excluded from spread/variance/status (the partial-coverage rule). But a day is only fully reconcilable when all five are in for it.

## 3. Implementation — three phases, all inside `nicks_code/index.html`

### Phase A — data layer (Upload Station + ingest counters)
1. **`RECON_RULES` const** — build.py's constants ported verbatim; one place to change, same doctrine as `MTD_RULES`.
2. **New source: Board Stats** through the existing Upload Station — full 9-step new-source checklist: `detectType` (header shape: Agent Name + Sale 1..Sale 27 columns; sheet name DD.MM dates the day), `INGEST.board` → `S.board[day][code]={sales,gwp}` merged per day (re-upload replaces its own day), slot card in SLOTS, SLOT_TYPES, typeLabel, removeFile, normalizeState seed, clear-all list, trust bar (9 sources), hydrate-empty liveness guard.
3. **Recon counters on the existing ingests** (PULSE keeps aggregates; the recon needs per-agent-per-day by-source sale counts, as-counted AND deduped):
   - ViciDial per-call ingest: VASNP/VASKP count per agent-day + deduped (phone/day key); assert VAS-campaign-only like build.py.
   - Call X ingest: the two VAS dispositions per agent-day + deduped (Destination/day); literal `Call x` join first, name fallback.
   - BI ingest: distinct Account Numbers per agent-day **on Account Create Date** (new counter beside — never replacing — the Contract-Create money dating).
   All three land in the existing day buckets so removal/supersede rules apply unchanged.
4. Join-defect + unresolved tables generate live from the roster on every Agent List upload.

### Phase B — the tab (native UI)
1. `NAV`: add `['recon','Sales Reconciliation',icon]` to the Analytics group. No new dropdown, no mode pill — one nav button like every other tab.
2. `PAGES.recon`: port the module's render functions (`model/renderRecon/renderVariance/renderCoverage/renderMapping/renderSummary/renderTiles/statusPill…`) — they read only from a SEED object, so the port is: **`seedFromState()`** builds that exact shape from `S` (roster, day buckets' recon counters, `S.board`, coverage from the file registry) and the renderers stay logically byte-identical. Sub-tab bar inside the page (MTD-page pattern), state under `S.ui.recon*`.
3. Controls fold into the page header: From/To reuses PULSE's existing period control; Board-day / MTD shortcuts, Baseline picker, De-dup toggle, Variances-only, Export CSV — all from the module, persisted in `S.settings` (not `sr.` localStorage).
4. CSS: the module's palette matches AgentOS; keep only its component classes, prefixed `sr-` to avoid collisions with PULSE's `.topbar/.trustbar/.content`.
5. Data Trust: board freshness rides the existing bar (new 9th source chip).

### Phase C — verification + ship
1. New suite `verify-recon.mjs`: drive the real app, upload the 13-Aug five files through the real Upload Station, assert every anchor in §2.9, the partial-coverage exclusion on MTD, the de-dup toggle numbers, and the poisoned-alias join (CB148 must never pay CB178).
2. Full regression: engine-rules (35), render, dupes, removal, hydrate, trust — the ingest counters touch shared code.
3. `prepare-site.js` → deploy → live markers verified.

## 4. Decisions needed from Nick (they change the numbers)
1. Board = one day per file? (evidence says yes) → one board upload per day workflow.
2. Call X sales: both dispositions (569) or only the file's own "Sale" classification (421)?
3. Include the 39 inbound sale calls? (currently yes)
4. De-dup repeats by default, or keep the as-counted default + toggle?
5. PBI accounts credited to 2-3 agents: full credit each (current) or split?
6. What is a Power BI "sale" for Cuddle against a one-day board? (needs per-day PBI export discipline or a different Cuddle rule)
7. CB65 / CB67 on the roster but in no source — leavers or missing data?

## 5. Effort & risk
- Phase A ~1 day (Board Stats source is the bulk — 9 registries + per-day merge; counters are small, guarded by anchors).
- Phase B ~1 day (renderers port cleanly — SEED-only reads; CSS namespacing is the main drudge).
- Phase C ~half day.
- Risk concentrated in: shared-ingest touches (regression suites cover), the Account-Create vs Contract-Create split (must stay visibly separate from the money model — non-negotiables 6/12), and board detectType (its Sale 1..27 shape must never collide with the roster/tracker detects).
