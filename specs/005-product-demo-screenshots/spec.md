# Feature Specification: Product demo screenshots

**Feature Branch**: `005-product-demo-screenshots`

**Created**: 2026-10-06

**Status**: Draft

**Input**: "I want to make a product demo of this software, take screenshots for me of it in order." Decided with the user
2026-10-06: scope = **Agent Analytics, all the views, and everything in VAS Analytics**; data = **fictional**; output =
**PNGs only**, **in a folder in the user's Downloads folder**.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A walk through every VAS Analytics page (Priority: P1)

The person giving the demo opens a folder of numbered screenshots and finds every VAS Analytics page — from the
dashboard through month-to-date, weekly, daily, the reports, lead management, variance, coaching, the Upload Station
and the data checks — in the order the app presents them, each showing a believable, fully populated floor.

**Why this priority**: VAS Analytics is where the data lands and every figure is built; a demo starts there.

**Independent Test**: run the demo once; every page in the VAS Analytics navigation has a numbered screenshot (more
where a page has sub-tabs), none shows an error, an empty state or a loading spinner.

**Acceptance Scenarios**:

1. **Given** the fictional floor, **When** the demo run finishes, **Then** there is a screenshot per VAS Analytics page
   and sub-tab, numbered in navigation order.
2. **Given** any screenshot, **When** it is inspected, **Then** it shows populated figures, tables or charts — not
   "no data", not a spinner, not an error card.

---

### User Story 2 - Agent Analytics through each person's eyes (Priority: P1)

The screenshots continue with Agent Analytics as each audience sees it: the team leader (their team, the reports, the
coaching hub including recording a coaching document, saving it as a draft, signing and submitting it, and the locked
line afterwards, the KPI forms, the help center), the agent (their month, progress, coaching, commission calculator),
and the campaign manager (campaign overview, teams, coaching, reports).

**Why this priority**: Agent Analytics is what the floor actually uses; showing each role is the point of the demo.

**Independent Test**: every view in each role's navigation has a numbered screenshot, the coaching flow appears as a
sequence (blank form → draft saved → signed → submitted → locked line), and every figure agrees with the VAS Analytics
screenshots of the same agent.

**Acceptance Scenarios**:

1. **Given** the fictional floor, **When** the demo runs, **Then** every view of the team leader, agent and campaign
   manager navigation is captured, in navigation order within each role.
2. **Given** the coaching flow, **When** its screenshots are read in order, **Then** they show the draft, the signatures,
   the submit confirmation and the locked session line.
3. **Given** the same fictional agent in both apps, **When** their sales and GWP are compared, **Then** they agree.

---

### User Story 3 - Safe to show anyone, and easy to refresh (Priority: P2)

The screenshots contain no real person, no real figure and nothing from the live system, so they can be put in front
of a client. When the product changes, the whole set can be produced again with one command.

**Why this priority**: a demo that leaks a real agent's name or pay is a POPIA incident; a demo that cannot be refreshed
is out of date within a week.

**Independent Test**: no name or CB number from the real Agent List appears in the demo data; running the command again
produces the same set.

**Acceptance Scenarios**:

1. **Given** the demo data, **When** it is checked against the real Agent List, **Then** no name and no CB number match.
2. **Given** a finished run, **When** the command is run again, **Then** the same numbered set is produced, and no live
   system was contacted.

### Edge Cases

- A page that only shows content for a specific date or filter: the demo sets that date/filter so the page is populated.
- The current calendar month is days old: the demo is pinned to a fictional date inside a complete month so month-to-date
  views are full, never "No October figures yet".
- Coaching documents not yet deployed live: the demo runs from the local build, so the screenshots show the current code.
- Pages that call outside services (Coaching Hub, KPI Hub, HighLevel): answered with fictional responses, never reached.
- A rerun into a folder that already holds an older set: the older screenshots are replaced, never mixed with new ones.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The demo MUST capture every page and sub-tab in the VAS Analytics navigation, in navigation order.
- **FR-002**: The demo MUST capture every view in the Agent Analytics navigation for the team leader, the agent and the
  campaign manager, in that order and in navigation order within each role.
- **FR-003**: The team leader's coaching section MUST be captured as a step-by-step sequence: pick a document, the filled
  form, draft saved, signed, submit confirmation, the locked line in "Your sessions".
- **FR-004**: All data MUST be fictional: names, CB numbers, team leaders, campaign manager and figures; no live system may
  be contacted during a run.
- **FR-005**: The same fictional floor MUST feed both apps, so an agent's figures agree between them.
- **FR-006**: Screenshots MUST be PNG files named with a sequence number and a short screen name, written to one folder
  inside the user's Downloads folder (`C:\Users\aarav\Downloads\Chatterbox Demo Screenshots`).
- **FR-007**: No screenshot may show an error, a spinner, an empty-data message, or a system banner (stale data, health
  alert, unsaved changes).
- **FR-008**: The set MUST be reproducible by one command.

### Key Entities

- **Fictional floor**: a believable call-centre month — campaigns, team leaders, a campaign manager, agents with tenure,
  targets, daily attendance, calls and talk time, sales and GWP, QA scores, leads and closed cases, referrals, coaching
  sessions and KPI forms.
- **Demo shot**: one screenshot — sequence number, app, role, screen name.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of VAS Analytics pages/sub-tabs and Agent Analytics views (all three roles) are in the set.
- **SC-002**: 0 screenshots show an error, spinner, empty state or system banner.
- **SC-003**: 0 real names or CB numbers appear in the demo data.
- **SC-004**: The full set regenerates with one command, in under 10 minutes.

## Assumptions

- Desktop size (1440 × 900 viewport, full-page captures); light theme, which is the suite's skin.
- The fictional month is September 2026 (complete), viewed as on Tuesday 29 September 2026; three campaigns
  (Courtesy, Cuddle, Nesting), four team leaders, one campaign manager, about 30 agents; CB numbers in a range no real
  agent uses.
- The Ops app, Tracker and Wimpy are out of scope (not requested).
- Output: `C:\Users\aarav\Downloads\Chatterbox Demo Screenshots\` (local only; nothing is published).
