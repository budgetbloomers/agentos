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
| `audit-removal.mjs` | 12 | Every source is fully removable, removing one file never takes another's data, clear-all leaves nothing, an Open Cases export is refused. |
| `audit-hydrate.mjs` | 7 | Adopting an OLDER cloud blob does not kill the app. `hydrate()` deletes every key on `S` and adopts the blob wholesale, so any store added later must be re-seeded by `normalizeState()`. |
| `verify-generator.mjs` | 15 | The generated MTD tracker matches the hand-built workbook: sheet names and order, every column, every TL MTD metric row, and grand totals that reconcile against their own agent rows. |
| `verify-vas-mtd.mjs` | 16 | Cancellations reconcile against an independent recompute of the file; a new Agent List drops leavers from the roster and the report. |
| `verify-pulse-aug.mjs` | 10 | The August drop, including the ViciDial export. |
| `verify-pulse.mjs` | 16 | July regression — GWP matches an independent recompute to the cent. |

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