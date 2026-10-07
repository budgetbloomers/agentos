# Feature Specification: The campaign manager's filters live on the Campaign tab only

**Feature Branch**: `012-cm-filters-campaign-tab`

**Created**: 2026-10-07

**Status**: Draft

**Input**: (screenshot of the campaign manager header: All campaigns · All tenures · Current month · the selection
chip · EOD report) "I want these filters to only be on the campaign tab in agent view … use spec kit"

## Context

In Agent Analytics, the campaign manager view (Dalwin, Ryan, Preshen) has six tabs — Campaign, Team Leaders,
Assistance, Reports (Month to date · Daily · Weekly · Variance · Lead management), Nikola, Settings. The header bar
with the campaign, tenure and period pickers, the selection chip and the EOD report button is drawn by the shared
page header, so it shows on every tab.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Filters only on the Campaign tab (Priority: P1)

A campaign manager sets the campaign, tenure and period on the Campaign tab; the other tabs no longer carry the
pickers or the EOD report button.

**Independent Test**: Open each tab: the pickers and EOD report appear on Campaign and nowhere else.

**Acceptance Scenarios**:

1. **Given** the Campaign tab, **Then** the campaign picker (when there is more than one campaign), the tenure picker,
   the period picker (with "Custom range…"), the selection chip and the EOD report button are shown and work as today.
2. **Given** Team Leaders, Assistance, any Reports sub-tab, Nikola or Settings, **Then** none of the pickers, the
   custom-range form or the EOD report button is shown.

### User Story 2 - Other tabs still say what they show (Priority: P1)

The other tabs keep following the choice made on the Campaign tab, and say which one it is.

**Acceptance Scenarios**:

1. **Given** the manager picked Cuddle · M1 · a custom range on the Campaign tab, **When** they open Reports, **Then**
   the figures are for that choice and a read-only line names it ("Cuddle · M1 · 1 – 15 Sep 2026"), with a way back
   to the Campaign tab to change it.
2. **Given** the Settings tab (targets do not depend on the selection), **Then** no selection line is shown there.
3. **Given** a P1 assistance request is open, **Then** its "● P1 open" marker still shows on every tab (it is not a
   filter).

### Edge Cases

- A custom-range form left open on the Campaign tab is not drawn on other tabs, and is there again on return.
- A "being built" range keeps re-asking every minute whichever tab is open (unchanged).

## Requirements *(mandatory)*

- **FR-001**: The campaign, tenure and period pickers, the custom-range form and the EOD report button MUST render only
  on the Campaign tab of the campaign manager view.
- **FR-002**: Every other campaign manager tab except Settings MUST show the current selection as read-only text, with
  a control that opens the Campaign tab.
- **FR-003**: The selection made on the Campaign tab MUST keep applying to every tab exactly as today.
- **FR-004**: Agent and team leader views MUST be unchanged.

## Success Criteria *(mandatory)*

- **SC-001**: On 10 of the 11 campaign manager pages there is no picker and no EOD button; on the Campaign tab all of
  them work as before.
- **SC-002**: No page shows figures without naming the campaign, tenure and period they cover (Settings excepted).

## Assumptions

- "These filters" is the whole header bar in the screenshot, including the EOD report button (it reports the campaign
  overview); the P1 marker stays — it is a warning, not a filter.
