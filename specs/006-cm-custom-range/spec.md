# Feature Specification: Custom date range for campaign managers' reports

**Feature Branch**: `006-cm-custom-range`

**Created**: 2026-10-06

**Status**: Draft

**Input**: "For Dalwin, please add custom range for him to filter his reports." Decided with the user 2026-10-06:
figures for a custom range are **built by the engine** (exact, the same rules as monthly reports — ready within about
15 minutes the first time a range is asked for, instantly afterwards), and the option is for **all campaign managers**
(Dalwin, Ryan, Preshen).

## Context

Today a campaign manager's period picker offers only periods the engine has already published: the current month,
the billing months (26th → 25th) and past calendar months. Every figure for those periods is built by the engine and
published under its own key; the Worker only serves it (constitution: "never re-aggregated by the Worker"). A range
of the manager's own choosing has no published figures, so it must be built the same way a billing month is: by the
engine on the laptop tick, then served. The Variance and Lead management reports ignore the period picker today.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Pick a date range and see every report for it (Priority: P1)

Dalwin chooses "Custom range…", picks a start and an end date, and his campaign view and every report (month to date,
daily, weekly, variance, lead management) show that range.

**Why this priority**: it is the request — month and billing-month boundaries do not match every question a campaign
manager is asked (a promotion fortnight, the week after a system outage).

**Independent Test**: pick 1–15 September; once built, the campaign view, the five reports and coaching all read
"1 – 15 Sep 2026" and their figures equal the engine's for exactly those days.

**Acceptance Scenarios**:

1. **Given** the period picker, **When** Dalwin chooses "Custom range…", **Then** he can enter a from and a to date and
   apply them.
2. **Given** a range that has already been built, **When** he applies it, **Then** every view shows it straight away,
   labelled with the dates.
3. **Given** a built range, **When** he opens Variance or Lead management, **Then** they show the range too — not the
   live month.
4. **Given** a range he has used before, **When** he opens the picker again, **Then** it is listed with the other periods.

---

### User Story 2 - A new range is built for him, and he is told so (Priority: P1)

The first time a range is asked for, it is queued for the engine. The page says it is being built and when to expect
it, and fills in on its own when it lands.

**Why this priority**: an honest wait is better than a wrong number; a silent wait reads as broken.

**Independent Test**: ask for a range never built: the page says "being built — ready within about 15 minutes",
the request is queued once (asking again does not queue a second copy), and after the next engine run the page fills
in without a reload.

**Acceptance Scenarios**:

1. **Given** an unbuilt range, **When** it is applied, **Then** the page shows "<range> is being built — it will be ready
   within about 15 minutes" and checks again every minute while it is on screen.
2. **Given** the same range asked for twice, or by two managers, **Then** it is queued once.
3. **Given** a range the engine cannot build (no data for those days, or the data starts after the range does),
   **When** the engine runs, **Then** the page says why, instead of waiting forever.

---

### User Story 3 - Only sensible ranges, only the right people (Priority: P2)

A range must be a real span of days the floor has data for; only campaign managers can ask for one; only the engine can
publish one.

**Acceptance Scenarios**:

1. **Given** a from date after the to date, a span longer than 93 days, or a to date after today, **When** applied,
   **Then** the page says what is wrong and nothing is queued.
2. **Given** an agent or team leader, **Then** there is no custom-range option and the Worker refuses a range request.
3. **Given** any session that is not staff, **Then** it cannot write or delete a range's published figures.

### Edge Cases

- A range that includes yesterday or today keeps being rebuilt on each engine run until its last day has landed (its
  figures still move); an older range is built once.
- A range that matches a calendar month or billing month exactly: still built as a range (simple; no special case).
- The queue is bounded (at most 20 waiting ranges; requests older than 7 days are dropped).
- Coaching for a range shows the sessions inside it.
- Nikola's brief follows the published live month (unchanged) — the range applies to figures and reports.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The campaign-manager period picker MUST offer "Custom range…" with a from and a to date.
- **FR-002**: A range MUST be valid before it is accepted: from ≤ to, at most 93 days, to not after today (SAST), from
  not before 1 January 2025.
- **FR-003**: Figures for a range MUST be built by the engine and published under the range's own key; the Worker MUST
  only serve them.
- **FR-004**: Asking for an unbuilt range MUST queue it (once) and show a "being built" state that re-checks every minute
  while on screen; a refused build MUST show its reason.
- **FR-005**: The campaign view, month-to-date, daily, weekly, variance, lead-management reports and coaching MUST all
  follow a selected range.
- **FR-006**: Ranges already built MUST be listed in the picker.
- **FR-007**: Only campaign managers may request a range; only staff (the engine's publisher) may write or delete a
  range's published figures.
- **FR-008**: A range still filling (its end within the last two days) MUST be rebuilt on each engine run.

### Key Entities

- **Range request**: from, to, who asked, when; status (waiting, refused + reason).
- **Published range**: the engine's digest and the two report payloads for exactly those days.

## Success Criteria *(mandatory)*

- **SC-001**: A campaign manager can view any valid range across all five reports and the campaign view.
- **SC-002**: A new range is available within one engine run (≤ 15 minutes) of being asked for.
- **SC-003**: 100% of range figures equal the engine's figures for exactly those days (no page- or Worker-side sums).
- **SC-004**: 0 duplicate queue entries for the same range.

## Assumptions

- The laptop tick keeps running every 15 minutes, as it already must for billing months; when it is off, a new range
  waits and says so.
- Maximum span 93 days keeps one engine build within the tick's time budget.
- Nikola, the assistance register and settings are not period-based today and stay that way.
