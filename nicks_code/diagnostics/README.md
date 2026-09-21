# VAS verification suites

Headless Playwright suites that drive the real app in a browser and assert against the real
export files in `uploads/`. They exist because every intake bug this dashboard has had was
invisible in code review and obvious the moment real files went through it.

## Running

```bash
cd nicks_code/diagnostics
npm i playwright xlsx && npx playwright install chromium   # once
node audit-dupes.mjs
```

Each suite serves `nicks_code/index.html` over `http://127.0.0.1:<port>` — **not** `file://`,
because the app loads `/xlsx.full.min.js` from the site root and that 404s on `file://`.
Each uses its own port so they can run back to back.

| Suite | Checks | What it protects |
|---|---|---|
| `audit-dupes.mjs` | 15 | Nothing is ever counted twice: re-uploads, renamed copies, reversed upload order, a multi-day ViciDial pull against its own single days (both orders), a QA export with every row duplicated, an agent list repeating agents, and both dialler orders. |
| `verify-history.mjs` | 34 | **Historical attribution.** A three-month simulation on synthetic fixtures (written in the real header contracts): an agent sells 100 under Leader Alpha in month 1, moves to Leader Bravo in month 2, and works on under Bravo in month 3. Month 1 must still read "Leader Alpha — 100" from month 2, from month 3, after the agent list is re-uploaded, and when the months are loaded backwards. Also carries the incremental half — re-upload, renamed copy, overlapping range, corrected record, narrower QA re-pull. Needs no drop; run it anywhere. **Its own control:** run it against the pre-change build and 16 checks fail, with all 100 sales moved to the wrong leader — that is the bug it exists to keep out. |
| `audit-removal.mjs` | 14 | Every source is fully removable, removing one file never takes another's data, clear-all leaves nothing, an Open Cases export is refused. Removing the cancellations file releases the gross-up it contributed to GWP — and only that — and re-adding it restores the same figure to the rand. |
| `audit-hydrate.mjs` | 7 | Adopting an OLDER cloud blob does not kill the app. `hydrate()` deletes every key on `S` and adopts the blob wholesale, so any store added later must be re-seeded by `normalizeState()`. |
| `verify-render.mjs` | 35 | **Every page actually renders**, with a real drop loaded — all fourteen tabs plus the agent drawer, failing on the first uncaught error. Every other suite drives the model and reads numbers out of it; none of them look at a page, and that gap hid a crash on Adjustments for as long as a template kept reading the renamed `S.canc` store. Also asserts the historical-attribution UI is on screen (movement register, "effective from", the drawer's team history). |
| `verify-generator.mjs` | 15 | The generated MTD tracker matches the hand-built workbook: sheet names and order, every column, every TL MTD metric row, and grand totals that reconcile against their own agent rows. |
| `verify-mtd-values.mjs` | 26 | The generated tracker matches the workbook's **numbers**, agent by agent — shifts, targets, sales, GWP, Ave GWP, cancellations — over the window the workbook actually covers. Guards the two money rules the daily read depends on: sales and GWP are GROSS of cancellation (Active ∪ Inactive by account), and GWP rounds to the rand PER ACCOUNT before summing. The handful of rows that legitimately differ are listed by name in the file's header with the reason. |
| `verify-asat.mjs` | 20 | The **as at** cut-off: it caps where the period ends without reshaping the month, the ragged-coverage note appears only while the sources disagree, clearing it restores the full period, a date outside the period is ignored rather than obeyed into an empty page — and with it set to the day the workbook was cut, the dashboard reproduces the workbook's Cohen Govender row to the rand. |
| `verify-engine-rules.mjs` | 23 | **The rule book is obeyed.** Two halves: the inlined `MTD_RULES` in `index.html` still matches `specs/mtd_engine_rules.json` field by field (two copies drift), and the real 1–4 Aug drop reproduces the workbook — Cuddle GWP R47 370 exactly, Courtesy within pull drift, Nesting's 3 agents and 17 sales present rather than silently dropped, the three excluded agents gone, dialling days taken from the register, and every §11 check passing. Needs the drop in `diagnostics/src-aug/` (gitignored); skips the behaviour half without it. **Run it against the build too — `PULSE_HTML=site/pulse/index.html node verify-engine-rules.mjs` — before calling a deploy verified:** the build passes through `prepare-site.js`, and a build step is exactly where a rule can quietly stop being applied. |
| `verify-vas-mtd.mjs` | 16 | Cancellations reconcile against an independent recompute of the file; a new Agent List drops leavers from the roster and the report. |
| `verify-vici-callreport.mjs` | 23 | **The ViciDial per-call export** (`EXPORT_CALL_REPORT*.txt`). Every figure is recomputed independently from the raw tab-separated text and compared with what the app stored, so the parser is checked against the file rather than against itself: talk time per agent-day, calls, answered, opt-ins, sale dispositions. Plus the delimiter sniff (read as CSV the file is rejected outright), the exclusions being counted rather than silent, the ring-time split, and the incremental rules — re-upload, renamed copy, every row doubled, and a partial pull in both orders against a full one. Needs `uploads/2026-08-13/EXPORT_CALL_REPORT*.txt` (gitignored — lead names, phone numbers, emails); skips cleanly without it. |
| `verify-pulse-aug.mjs` | 10 | The August drop, including the ViciDial export. |
| `verify-pulse.mjs` | 16 | July regression — GWP matches an independent recompute to the cent. |
| `verify-variance.mjs` | 46 | **The Variance Report obeys its own rule book** (`specs/vas_variance_report_rules.json`, artefact A — a module IN VAS Analytics but deliberately NOT part of the MTD engine). Synthetic fixtures with hand-computed expectations for every DV formula: DV01 distinct-account sales (BI Active ∪ Inactive, TESTRR excluded), DV02 GWP = ROUND(SUM×1.15) **after** summing — the 0.30+0.30→1 case that per-account rounding gets wrong, DV03's three activity flags (Cuddle talk honestly unknown without day-level ViciDial), DV04 blocked-emits-null. Plus tolerance boundaries (±1 pass / ±2 material), unmapped identities excluded-and-reported, RC5 scope auto-classification, multi-day isolation, board day-replace, duplicate-upload idempotency, snapshot-skew downgrade to indeterminate (RC1), manual RC classification persistence, the page/filter renders, and field-by-field drift against the spec JSON. |
| `verify-pulse-trust.mjs` | 25 | **The Data Trust bar tells the truth.** Drops the full 2026-08-13 package plus a Manual Stats board fixture and the HighLevel referrals CSV through the real UI and asserts the bar reads 9/9 with every chip fresh — the nine entries mirror the nine Upload Station slots (bi, CallX, ViciDial, attendance, evals, roster, cancellations, referrals, board). Exists because the bar shipped with a stale six-source list that still counted the dropped Open Cases source, so it read 5/6 forever with everything uploaded. Also asserts refused Ops files (open/closed cases) register nothing, referrals land in `S.refs` matched through the roster, and the MTD page renders with them. |
| `verify-referrals-sync.mjs` | 8 | **Referrals pull themselves from the HighLevel API** — no manual upload. The Worker endpoint is intercepted with rows built from the real pull; the OPS auto-sync must land them through applyLoad (batch audited as "HighLevel API"), map 55+ agents through the Agent List, supersede per contact on re-sync (never stack), and the slot must carry the manual "Sync from HighLevel" button. `probe-pulse-refsync.mjs` is the PULSE twin (auto-sync → `S.refs`, tiered matching inside `_refStore`). |
| `verify-ops-intake.mjs` | 33 | **The OPS dashboard's bulk intake** (drives `Chatterbox_AgentOS_Analytics.html` at `file://`, not Pulse). The full 2026-08-13 package lands 8 sources with the right row counts (incl. the VICI_CALL_REPORT source added 2026-08-14 — xlsx + txt overlap superseded on the record key, ~13,473 rows, Sales page renders the per-agent dial table, and a campaign filter must keep Vici rows); the empty SF-Closed frameset shell is refused honestly; the trust bar renders and flags what's missing. Exists because the new `Active.xlsx`/`Inactive.xlsx` exports are header-identical and score-ranked detection once routed the Inactive file INTO the money source, where the BI supersede-by-date-span wiped the month's charges — detectSource now lets the data (majority Contract Status) decide whenever both contracts match. |

## Chasing a single number

`node diff-daily.mjs` compares the app against the workbook's **August** sheet at day level —
one row per agent per dialling day, the finest grain either system has. It reports how many
of the 130 agent-days differ per column, so a change either holds the line or is caught by a
number, not a feeling. Note the workbook's daily sheet pads its money headers (`" GWP
Achieved "`) and stores Talk Time as a real Excel time cell — read it `raw:false` and trim
the keys, or you get zeros and a diff that blames the app for the harness.

`node probe-agent.mjs "Cohen Govender"` drives the real app over the August set and prints
that agent **day by day** — attendance status, emp/act/target/sales/GWP/talk per day, whether
the dialler covered the day, then the MTD roll-up — in both the calendar-month window and the
window the hand-built workbook covers. When someone says "this agent's numbers are wrong",
run this first: it shows in one screen whether the gap is a formula or a period.

## What identifies a record, per source

Every upload is an incremental update, so each source needs a key that says "this is the same
record I already hold" — never the filename, which says nothing. These are the keys in force;
`audit-dupes.mjs` and `verify-history.mjs` are what hold them to it.

| Source | Record identity | On a repeat |
|---|---|---|
| ViciDial call report (`EXPORT_CALL_REPORT*.txt`) | call_date + user + lead_id + status | Unique over all 2 317 rows of the reference pull. Repeats inside one file are counted once; across files the fuller agent-day wins, never the sum. Tab-separated, so the delimiter sniff has to fire before any of this — read as CSV the file is one 39-wide column and is rejected as unrecognised. |
| Power BI - Active Cases | date + owner + **account number** | The day is re-derived from the file. Replacing it *is* the merge here: `a` means "accounts created that day that are still active", and `grossUpSales()` rebuilds the rest from the Inactive export — keep an account a newer pull dropped and the gross-up counts it a second time. A pull that shrinks a day is counted and named in a toast, because a filtered pull and a real cancellation look identical in the data. |
| Cancellations (BI Inactive) | account + contract + deactivate date | Keyed per contract in `S.cancRows`; a repeat overwrites its own row. |
| Call records (CallX) | date, then fullest-file-wins | Per day the file that recorded more calls keeps it; the same file re-uploaded always wins over itself. Provenance in `S.callsMeta`. |
| ViciDial | its own `from..to` range, or the single day | A range whose days arrived as single-day exports contributes nothing — the finer data wins, in either upload order. |
| Attendance | date + employee code | Merged per employee-day; the newer file wins that cell and leaves the rest. |
| QA evaluations | **Record ID** | Merged across files, never replaced by day: an ID already stored is updated in place (corrected score, closed dispute), an ID not stored is added. Two exports can both cover one day. |
| Agent list | employee code | A live snapshot — replaced for the campaigns it covers. Its *organisational* content is filed into `S.orgHist` against the date the snapshot describes, and that is append-on-change only. |
| Tracker daily | date + employee code | Merged per agent-day; also a dated statement of the team leader, so it feeds `S.orgHist` too. |
| Manual Stats (board) | the **day** — one sheet per day, named DD.MM | The sheet is the day's complete record: a re-upload replaces exactly its own day, so overlapping uploads can never double-count. Rows store by RAW agent name and resolve through the Agent List at report-build time, so a later mapping repairs old days. Feeds the Variance Report only — never the MTD engine. |

## When you add a data source

Adding one means touching several places that each hold their own copy of "what sources
exist". Miss one and you get a bug that only shows up in production:

1. `detectType()` — recognise it
2. `INGEST.<type>` — parse it
3. `SLOTS` — the upload card
4. `SLOT_TYPES` — which types that slot accepts
5. `typeLabel` — how the registry names it
6. `STORE_OF` — used by `regFile()` cleanup
7. `removeFile()`'s **own** `storeOf` — a *second*, separate map
8. `normalizeState()`'s store list — **miss this and an older cloud blob kills the app**
9. the "Clear uploaded data" button's list

If the source carries an organisational assignment (team leader, campaign, team), also call
`recordOrg(code, date, {...}, 'your-source')` from its `INGEST` function. A source that states
who owned an agent **on a date** is historical evidence and belongs in `S.orgHist`; a source
that only says who owns them **now** must never be read for a past date.

Items 6-9 are four separate copies of the same knowledge. Consolidating them into one
registry is the single highest-value refactor available in this file.
## The Denise pilot (2026-09-21)

Three files, run in this order, answering "is the agent and team-leader view safe to go live?"
with numbers rather than a feeling. They need no credentials and no data drop: the fixtures are
written in the real export header contracts and go through the real ingest.

| File | What it does |
|---|---|
| `verify-denise-pilot.mjs` | Six weeks (3 Aug – 12 Sep 2026), nine agents on Denise Haripersad's team, every source. Tests the six joins — agent, team, campaign, interaction, sale, QA — against an INDEPENDENT recompute of the same fixture rows, then re-uploads every file to prove nothing doubles. Deliberate defects: a near spelling, a transposition, a middle name, a zero-padded QA code, a dialler login issued to someone else, a team leader dialling, a system login, a renamed agent, a stranger owning real money, an ambiguous surname. Round 3 measures what each finding COSTS. Writes `scratch/denise/evidence.json`. |
| `verify-denise-views.mjs` | Takes that digest through the Worker's own `authorise()` and `checksFor()` — the real modules, unmodified — to test the agent view and the team-leader view: scoping, the two checks, the composite's renormalisation, and whether the leader's two panels agree. Writes `scratch/denise/views.json`. |
| `trace-denise-record.mjs [CB910] [2026-08-04]` | One agent, one day, end to end: the raw row in each source file, the key it joins on, the formula, the reconciliation, the exclusions, and what the agent and the leader finally read. Writes `scratch/denise/trace.txt`. |

The failing checks are the point — each one is a finding, not a broken test. See
`reports/denise-pilot-2026-09-21/`.
