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
| `audit-removal.mjs` | 14 | Every source is fully removable, removing one file never takes another's data, clear-all leaves nothing, an Open Cases export is refused. Removing the cancellations file releases the gross-up it contributed to GWP — and only that — and re-adding it restores the same figure to the rand. |
| `audit-hydrate.mjs` | 7 | Adopting an OLDER cloud blob does not kill the app. `hydrate()` deletes every key on `S` and adopts the blob wholesale, so any store added later must be re-seeded by `normalizeState()`. |
| `verify-generator.mjs` | 15 | The generated MTD tracker matches the hand-built workbook: sheet names and order, every column, every TL MTD metric row, and grand totals that reconcile against their own agent rows. |
| `verify-mtd-values.mjs` | 26 | The generated tracker matches the workbook's **numbers**, agent by agent — shifts, targets, sales, GWP, Ave GWP, cancellations — over the window the workbook actually covers. Guards the two money rules the daily read depends on: sales and GWP are GROSS of cancellation (Active ∪ Inactive by account), and GWP rounds to the rand PER ACCOUNT before summing. The handful of rows that legitimately differ are listed by name in the file's header with the reason. |
| `verify-asat.mjs` | 20 | The **as at** cut-off: it caps where the period ends without reshaping the month, the ragged-coverage note appears only while the sources disagree, clearing it restores the full period, a date outside the period is ignored rather than obeyed into an empty page — and with it set to the day the workbook was cut, the dashboard reproduces the workbook's Cohen Govender row to the rand. |
| `verify-engine-rules.mjs` | 23 | **The rule book is obeyed.** Two halves: the inlined `MTD_RULES` in `index.html` still matches `specs/mtd_engine_rules.json` field by field (two copies drift), and the real 1–4 Aug drop reproduces the workbook — Cuddle GWP R47 370 exactly, Courtesy within pull drift, Nesting's 3 agents and 17 sales present rather than silently dropped, the three excluded agents gone, dialling days taken from the register, and every §11 check passing. Needs the drop in `diagnostics/src-aug/` (gitignored); skips the behaviour half without it. |
| `verify-vas-mtd.mjs` | 16 | Cancellations reconcile against an independent recompute of the file; a new Agent List drops leavers from the roster and the report. |
| `verify-pulse-aug.mjs` | 10 | The August drop, including the ViciDial export. |
| `verify-pulse.mjs` | 16 | July regression — GWP matches an independent recompute to the cent. |

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

Items 6-9 are four separate copies of the same knowledge. Consolidating them into one
registry is the single highest-value refactor available in this file.