# Implementation Plan: CM filters on the Campaign tab only

**Branch**: `012-cm-filters-campaign-tab` | **Date**: 2026-10-07 | **Spec**: [spec.md](spec.md)

## Contracts

- **C1** `cmView()` (agent/index.html): `onCampaign = VIEW==='cm'`. The header `right` = P1 marker (every tab) +
  - Campaign tab: `#cmSel` (if > 1 campaign) + `cmTenureSelect` + `cmPeriodSelect` + `#cmSelection` + `#cmEod` (as today);
  - other tabs except `cm_set`: `#cmSelection` (read-only, `cmSelectionLine`) + `#cmToCampaign` button
    "Change on the Campaign tab" → `VIEW='cm'; render()`;
  - `cm_set`: nothing beyond the P1 marker.
- **C2** `cmRangeForm()` is drawn only on the Campaign tab; `CMCUSTOM` is kept, so the form returns with the tab.
- **C3** Wiring is unchanged (every handler already guards a missing element); `#cmToCampaign` is wired when present.

## Constitution Check

| Principle | Status |
|---|---|
| I Engine decides, page paints | PASS — presentation only; no figure or rule changes |
| II An absence is not a nought | PASS — every figure tab still names its selection (the chip text is the payload's) |
| VII Guards | PASS — verify-cm-view section S, red first; ES5 check covers the edited function |

## Project Structure

```text
agent/index.html                          cmView() header + range form placement
nicks_code/diagnostics/verify-cm-view.mjs  S · filters only on the Campaign tab
```
