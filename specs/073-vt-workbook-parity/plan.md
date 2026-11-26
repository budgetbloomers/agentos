# Plan 073 — The VT Report is the workbook

**Approved 26 Nov 2026** (owner: "approve please put everything live") with the spec's five defaults: tabs; the chart
Dashboard stays first; the drill-down shows case numbers; "Not captured" = a scheduled sale with no lead-time bucket;
HC = distinct schedulers with a sale in the cycle.

## Rules read off the workbook (the oracle), 26 Nov

| Rule | Cell |
|---|---|
| Exco and A&SS follow the page's View (the workbook was saved on **All data**); Sales Review column C is **always** the cycle view, column G is **all data** | Exco C4, SR C48/G48 |
| Outcome counts in a view count the view's own sales set by status (cycle view: in-cycle, plus pre-cycle Fitted) | Exco C7, C67 |
| Rollover tables are always pre-cycle, all data, never the view | Exco D41, A&SS M40 |
| Lead time tables cover every Scheduled booking; A&SS's follows Channel + Campaign filters only | Exco K67, A&SS I54 |
| Not captured = Scheduled − the five buckets | Exco K72, A&SS H54 |
| Weekly table: 14 Monday weeks ending at the week of the newest sale | Exco B67 |
| Upcoming: 16 days from the earliest Scheduled appointment, then "later / not shown", then total | Exco B85, C101 |
| Deficit/Surplus = actual − budget; **Dialing Days** shows days left = budget − actual | SR E51, E49 |
| % Tgt and Deficit are blank wherever either side is blank (Other has no budget) | SR D53, E53 |
| Forecast = actual ÷ elapsed dialing days × total for counts; Fitment Rate forecast = forecast fitments ÷ forecast sales; Missed, Cancelled, Cancelled %, Scheduled and the five buckets show "-" | SR F51, F63, F69 |
| Panimax = Referrals + Predictive, budgets included; Total = Digital + Other + Panimax | SR B54, C51 |
| Missed / Cancelled budgets 5 %, Scheduled 10 % of each channel's sales budget; buckets 75/10/5/5/5 % of Scheduled | SR B70, B88, B94 |
| HC actual = distinct schedulers with a sale dated in the cycle | SR C50 |

## Components (build order)

1. **Engine, one change:** `dashboard()` hands out `facts` and the view's `inView.sales / inView.open` as
   NON-enumerable properties, so no JSON of the model (digest, export, tests) changes by a byte.
2. **`nicks_code/vt-workbook.js`** — `VTWorkbook.exco(D)`, `.people(D, filters)`, `.drill(D, type, name, filters)`,
   `.review(Dcycle)`. Pure, no DOM, Node-testable. Every figure carries its workbook cell.
3. **`verify-vt-workbook-oracle.mjs`** — the book from the workbook's own Schedulers Data sheet; every numeric cell
   of the target ranges compared, rows matched by label (the workbook's person tables are dynamic arrays).
4. **`nicks_code/vt-sheets.js`** — the four tabs, painted from the model; tables open; drill-down pickers.
5. **Tab switcher** in `vt-dashboard.js`; `prepare-site.js` inlines `vt-workbook.js` + `vt-sheets.js`.
6. **Export** — the three sheets in the workbook's layout.
7. Browser checks (fixture + live), all VT suites, deploy, live smoke.

## Risks

| Risk | Mitigation |
|---|---|
| A daily-only book has no scheduler / GWP / campaign | each panel says so and paints nothing — never a zero (072's rule) |
| `vt-dashboard.js` is past 800 lines | new page code lives in `vt-sheets.js`; the dashboard file gets only the switcher |
| Exposing facts bloats a serialised model | non-enumerable properties |
| Engine bucket ≠ sheet column L for some row | the oracle checks every bucket cell, by channel and by scheduler |
