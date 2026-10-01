# Feature Specification: Campaign Manager view — sign-off list

**Feature Branch**: `001-cm-view-signoff`

**Created**: 2026-10-01

**Status**: Ready for planning (clarifications answered from live data — see Clarifications)

**Input**: User description: "Please see items below to resolve for campaign manager view of agent os, we can
only go live with entire campaign if cm view is signed off also. Campaign Tab: be able to select tenure and
campaign; Billing month, custom month and current month; conversion rate — currently pulling from Dialer
report, must be calculated using sales divided by total closed leads; average talk time target 5 hours
courtesy, 4.5 hours cuddle — change to display hours; contact rate needed — speaking to a person means contact
made; what is blocking my campaign — relook at the wording. Team leaders: investigate why coaching from
Denise not displaying for campaign manager. Coaching hub to be brought into CM view: CM needs access to view
each team leader's coaching done, create a link in left at the bottom above logout that CM will click on and
take him straight into team leaders coaching. Reports: lead management no longer for courtesy, all reports on
analytics must move over as is. [QA capture tool — OUT OF SCOPE for this feature.] Month to date report for
TL: team leaders to have agent view KPIs and coaching analysis change AI." Users: Ryan and Dalwin
(campaign managers). Go-live of the whole campaign depends on this sign-off.

## Clarifications

### Session 2026-10-01 (answered from code and live data; no questions put to the requester)

- Q: What is the "billing month"? → A: The 26th of the previous month to the 25th of the month — the cycle
  PULSE already offers as "Cycle (26th–25th)" and the one the digest publisher's comments name.
- Q: What is a "custom month"? → A: Any past calendar month that has been published (the month list the
  system already keeps). Arbitrary day ranges are out of scope.
- Q: What are "total closed leads"? → A: Every lead (Salesforce case) the agent closed in the period,
  whatever the closing status — including "no feedback". Conversion = sales ÷ closed leads.
- Q: Which talk-time measure carries the 5 h / 4.5 h target? → A: The campaign view's existing measure —
  talk time per day actually worked. Default targets: Courtesy 5 h, Cuddle 4.5 h; every other campaign keeps
  3.5 h. All remain editable per campaign in Settings.
- Q: What counts as a contact? → A: A dialled call whose outcome shows a person was spoken to — any outcome
  NOT on the rule book's no-contact list (no answer, busy, answering machine, voicemail, disconnected,
  dropped, timeouts, invalid numbers…). An answering machine is not a contact.
- Q: New wording for "What is blocking the campaign"? → A: "Where my team leaders need help", with the line
  "Open help requests from your team leaders, grouped by what is holding them up — oldest first."
- Q: Why does Denise's coaching not show for the campaign manager? → A: Two causes found live on 2026-10-01:
  (1) the campaign-manager view carries no Coaching Hub data at all — only help requests; (2) Agent OS's copy
  of the Coaching Hub stopped refreshing on 2026-09-21 (the hub itself is healthy and holds later sessions —
  Denise's newest are 2026-09-22). Denise Haripersad is a Courtesy team leader on the 1 October list (7
  agents), linked to the hub. Both causes are fixed by this feature.
- Q: Where does the "team leaders' coaching" link go? → A: To a page inside Agent OS that shows every coaching
  session each of the manager's team leaders logged in the Coaching Hub — no second login. The page also
  offers "Open the Coaching Hub ↗" for anyone who wants the hub itself.
- Q: Which "reports on analytics" move over? → A: The VAS Analytics reports already published to Agent OS —
  Month to date, Daily, Weekly, Variance and Lead management — with the same columns as VAS Analytics. The
  campaign manager gets all five (today only Variance and Lead management).
- Q: "Lead management no longer for Courtesy" — where? → A: Courtesy leaves the Lead management REPORT (in
  VAS Analytics and in Agent OS). Courtesy's closed leads still count for conversion.
- Q: "Team leaders to have agent view KPIs and coaching analysis, change AI" → A: On the team leader's Month to
  date report every agent shows the same KPI verdicts the agent sees (Target achieved, Premium written,
  Average sale, QA, Attendance, Referrals — On track / Watch / Focus), plus a coaching analysis worked out by
  rules from the Coaching Hub (sessions this month, last session, themes coached, what moved after coaching).
  The AI assistant may explain this analysis; it never produces the figures or the verdicts.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Campaign tab shows the right numbers (Priority: P1)

Ryan opens the Campaign tab and reads conversion, talk time, contact rate and where his team leaders need
help — every figure defined the way the business defines it.

**Why this priority**: These are the figures the sign-off is judged on; a wrong definition blocks go-live.

**Independent Test**: With a month of data loaded, compare each tile against an independent recomputation
from the same published data.

**Acceptance Scenarios**:

1. **Given** case books are loaded, **When** Ryan opens the Campaign tab, **Then** Conversion reads
   Σsales ÷ Σclosed leads for the campaign, says "sales ÷ N closed leads", and is blank-with-reason (never 0%)
   when closed leads are not loaded.
2. **Given** Courtesy talk data, **When** the tile renders, **Then** it reads hours and minutes (e.g.
   "4 h 32 m a day") against "target 5 h"; Cuddle against "target 4 h 30 m"; any other campaign against 3 h 30 m
   unless changed in Settings.
3. **Given** dialler data, **When** the tile renders, **Then** Contact rate = contacts ÷ dials with the counts
   shown ("N people reached from M dials"); without dialler data it shows "—" and why.
4. **Given** open help requests on two campaigns, **When** Ryan picks one campaign, **Then** the card headed
   "Where my team leaders need help" lists only that campaign's requests.

---

### User Story 2 - Select tenure and campaign (Priority: P1)

Dalwin narrows the Campaign tab to one campaign and one tenure group (e.g. Courtesy · M1).

**Why this priority**: Tenure-relative comparison is a rule of the business; a blended number misleads.

**Independent Test**: Select each tenure in turn; the tiles and team rows equal the sum over exactly the
agents of that tenure.

**Acceptance Scenarios**:

1. **Given** Courtesy has M1, M2 and Exp agents, **When** Dalwin selects Courtesy · M1, **Then** every tile
   and team row covers only Courtesy M1 agents, and the selection is stated on screen.
2. **Given** "All tenures", **When** selected, **Then** the figures equal today's campaign figures.
3. **Given** a tenure with no agents on a campaign, **When** selected, **Then** the page says so rather than
   showing zeros.

---

### User Story 3 - Choose the period: current, billing or a past month (Priority: P2)

Ryan switches between the current month, the billing month (26th–25th) and any published past month.

**Why this priority**: Finance and payroll talk in billing months; reviews talk in calendar months.

**Independent Test**: For a chosen billing month, every campaign figure equals the engine's own 26th–25th
build of the same data.

**Acceptance Scenarios**:

1. **Given** today is 1 October, **When** Ryan picks "Billing month", **Then** the page states
   "26 Aug – 25 Sep 2026" (the last complete cycle) and offers the cycle in progress
   (26 Sep – 25 Oct 2026) as well.
2. **Given** a past month is chosen, **When** the page loads, **Then** every tile, team row and report reads
   that month and the period is named on screen.
3. **Given** a billing month has not been built yet, **When** chosen, **Then** the page says when it will be,
   instead of showing another period's numbers.

---

### User Story 4 - See each team leader's coaching (Priority: P1)

Ryan clicks "Team leaders' coaching" at the bottom left, just above Sign out, and sees every coaching session
each of his team leaders logged — including Denise's.

**Why this priority**: Named in the sign-off; coaching is the campaign manager's main lever.

**Independent Test**: For each team leader in the manager's campaigns, the page lists the same sessions the
Coaching Hub holds for that leader, no older than the hub's latest refresh.

**Acceptance Scenarios**:

1. **Given** Denise logged sessions in the hub, **When** Ryan opens the page and picks Denise, **Then** her
   sessions appear (date, agent, type, themes, support provided), newest first.
2. **Given** the hub copy is more than a day old, **When** the page opens, **Then** it says how old it is.
3. **Given** a team leader outside the manager's campaigns, **When** the manager asks for them, **Then**
   nothing is returned.
4. **Given** the scheduled refresh fails, **When** it fails, **Then** the failure is recorded and raised as a
   health warning instead of passing silently.

---

### User Story 5 - All analytics reports, Lead management without Courtesy (Priority: P2)

Dalwin opens Reports and finds Month to date, Daily, Weekly, Variance and Lead management for his campaigns,
laid out as in VAS Analytics; Lead management no longer covers Courtesy.

**Why this priority**: "All reports must move over as is" — part of the sign-off.

**Independent Test**: Each report's rows and totals equal the VAS Analytics report for the same campaign and
period; Lead management has no Courtesy rows anywhere.

**Acceptance Scenarios**:

1. **Given** a campaign manager, **When** Reports opens, **Then** five sub-tabs are offered.
2. **Given** Courtesy agents, **When** Lead management renders (VAS Analytics, team leader or campaign
   manager), **Then** no Courtesy row or total appears, and a Courtesy-only team leader is not offered the tab.
3. **Given** a Courtesy agent closes leads, **When** conversion is computed, **Then** those closed leads still
   count.

---

### User Story 6 - Team leader Month to date: agent KPIs and coaching analysis (Priority: P3)

A team leader opens Month to date and, for each agent, sees the KPI verdicts the agent sees plus a coaching
analysis.

**Why this priority**: Requested for team leaders; it reuses existing verdicts.

**Independent Test**: For every agent the six verdicts equal the verdicts on that agent's own Today page; the
coaching analysis counts equal the hub sessions for that agent in the period.

**Acceptance Scenarios**:

1. **Given** an agent on Watch for QA, **When** the team leader views Month to date, **Then** that agent's row
   shows QA · Watch, identical to the agent's own tile.
2. **Given** an agent coached twice this month on one theme, **When** the analysis renders, **Then** it shows
   2 sessions, the last date, the theme, and whether the coached KPI moved since.
3. **Given** an agent with no sessions, **When** rendered, **Then** it says "No coaching logged this month".

### Edge Cases

- Case books not loaded → conversion blank with the reason, never 0%.
- A campaign mover inside the month → counted on each campaign for its own days (existing D4 rule).
- A tenure value missing on an agent → listed as "Tenure not set", never silently dropped.
- Coaching session with no matching agent on the list → for a campaign manager it is NOT shown: a session is
  kept only when its agent is one of the manager's own agents (security review, 2026-10-01 — a team leader
  whose agents span campaigns must not expose another campaign's coaching notes; Constitution V). Group
  sessions show only the manager's attendees.
- A billing month spanning a list change → attribution follows the existing month-grain rules for each month.
- The Coaching Hub unreachable → the last good copy is shown with its age.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The Campaign tab MUST offer campaign and tenure selectors (including "All"); every tile and team
  row MUST cover exactly the selected agents.
- **FR-002**: The Campaign tab MUST offer the periods: Current month, Billing month (26th–25th: last complete
  and in progress), and any published past month; the period MUST be named on screen.
- **FR-003**: Billing-month figures MUST be produced by the same calculation engine as calendar months, not
  recomputed by the page.
- **FR-004**: Conversion MUST equal Σsales ÷ Σclosed leads (all closing statuses) and MUST read blank with a
  reason when closed leads are not loaded.
- **FR-005**: Average talk time MUST display hours and minutes; default targets MUST be Courtesy 5 h, Cuddle
  4.5 h, others 3.5 h; targets stay editable per campaign; the change MUST be recorded with its date.
- **FR-006**: Contact rate MUST equal contacts ÷ dials where a contact is any outcome not on the rule book's
  no-contact list; it MUST show on the Campaign tab, per team leader, and per tenure selection.
- **FR-007**: The help-request card MUST be headed "Where my team leaders need help" and MUST show only the
  selected campaign's requests.
- **FR-008**: The campaign-manager navigation MUST show "Team leaders' coaching" at the bottom left directly
  above Sign out, opening an in-app page of each in-scope team leader's Coaching Hub sessions.
- **FR-009**: The coaching page MUST only return team leaders within the manager's campaigns (enforced by the
  server), and MUST state the age of the coaching copy.
- **FR-010**: The coaching copy MUST refresh on schedule; every refresh attempt's outcome MUST be recorded,
  and a copy older than one working day MUST raise a health warning.
- **FR-011**: The campaign manager's Reports MUST offer Month to date, Daily, Weekly, Variance and Lead
  management for their campaigns, with the VAS Analytics columns.
- **FR-012**: Courtesy MUST be excluded from the Lead management report everywhere it appears; the exclusion
  MUST be a dated rule; Courtesy's closed leads MUST still feed conversion.
- **FR-013**: The team leader's Month to date report MUST show, per agent, the six agent-view KPI verdicts
  (identical to the agent's own) and a rules-based coaching analysis.
- **FR-014**: No figure or verdict in this feature may be computed by the AI assistant.
- **FR-015**: Everything is limited to the campaign manager's own campaigns; Ryan, Dalwin (and Preshen, same
  role) see only what their assignments allow. Team leaders see only their teams.

### Key Entities

- **Campaign slice**: campaign × tenure × period → agents in scope and their summed figures.
- **Period**: current month · billing cycle (26th–25th) · published past month.
- **Closed lead**: a Salesforce case closed in the period by an agent, any status.
- **Contact**: a dialled call whose outcome is not on the no-contact list.
- **Talk target**: hours per worked day per campaign, dated.
- **Coaching session**: date, team leader, agent, type, themes, support provided (from the Coaching Hub).
- **Coaching analysis**: per agent per period — sessions, last session, themes, KPI movement after coaching.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every Campaign-tab figure matches an independent recomputation from the same data to the cent /
  0.1 percentage point, for every campaign × tenure × period combination tested.
- **SC-002**: Ryan and Dalwin can switch campaign, tenure and period and read the result in under 3 seconds.
- **SC-003**: Denise's (and every in-scope team leader's) coaching sessions appear, no more than one working
  day behind the Coaching Hub.
- **SC-004**: 100% of the five reports' totals equal the VAS Analytics report for the same campaign and
  period; zero Courtesy rows in Lead management.
- **SC-005**: For 100% of agents, the team leader's KPI verdicts equal the agent's own.
- **SC-006**: Campaign managers can reach team leaders' coaching in one click from any CM page.

## Assumptions

- Users: Ryan and Dalwin; Preshen shares the role and gets the same view. Campaigns in scope follow the
  existing assignment rules (Courtesy, Cuddle, plus unowned non-VT campaigns such as "Training Gr 17").
- The QA capture tool is excluded from this feature.
- Download & Test is no longer on the 1 October list (its agents and Denise moved to Courtesy); nothing in
  this feature special-cases it.
- Talk time keeps its current definition (includes ringing, per the 2026-08-13 decision).
- Arbitrary day ranges are not offered; months and billing cycles only.
- Existing role scoping, session sign-in and data publication paths are reused.

## Analysis follow-up (2026-10-01, /speckit-analyze)

- The Lead management exclusion is date-gated: it applies to report periods ending on or after 2026-10-01, so
  September history keeps Courtesy; the report says from when (A1).
- With a tenure selected, the team-leader summary blocks stay whole-period (engine aggregates); the page says
  "Team leader summary covers all tenures." (U2).
- On "All campaigns" the talk target reads "targets differ by campaign" (Courtesy 5 h, Cuddle 4 h 30 m).
- Live verification (T046) also covers SC-001/SC-004 with an independent recompute against the published data,
  and times a selector change for SC-002 (G1–G3).
