# Feature Specification: Live month, scheduled referrals, fresh and complete coaching

**Feature Branch**: `002-live-month-sync-coaching`

**Created**: 2026-10-01

**Status**: Ready for planning (clarifications answered from code and live read-only data)

**Input**: User description: "we are in october today so we need to see this month not september, secondly for
referrals, i need the sync flow to automatically trigger at 8 in the moring and at 2 oclock midday, then the
coaching hub seems to be stale, i also need an automatic trigger to pull the latest data at least once a day for
this, thirdly, my tls are saying there are only compliance coming from coaching when there are lead management
there as well investigate"

## Clarifications

### Session 2026-10-01 (answered from code and live data; no questions put to the requester)

- Q: October has no figures yet (the first day lands with tomorrow morning's uploads). What do people see? → A:
  October, with an honest empty state — "No October figures yet — the first day lands after tomorrow morning's
  uploads" — never zeros; a "September (final)" link opens the closed month. This replaces this morning's rule
  that kept the closed month on screen until the new month had data.
- Q: Which days do the referral refreshes run? → A: Every day, at 08:00 and 14:00 SAST.
- Q: Why do referrals go stale today? → A: Nothing refreshes them on a schedule — VAS pulls referrals from
  HighLevel only when a person has VAS open (and then only when it holds none), and the scheduled publisher
  republishes whatever count VAS last saved.
- Q: Is the coaching copy stale now? → A: It was frozen from 21 Sep to 1 Oct (fixed earlier today; last full pull
  1 Oct 16:23 SAST, 1,427 sessions, newest 1 Oct). The ask is a guarantee: a full pull at least daily, before the
  floor opens (05:30 SAST), on top of the rolling refresh — and every coaching screen says how fresh it is.
- Q: Why do team leaders see "only compliance"? → A: Proven live on 2026-10-01:
  (1) the Coaching Hub holds exactly 28 lead-management coaching sessions, all logged in July 2026 by Dalwin
  (the SOS coach) on team leaders' agents — none logged by a team leader, none since 1 September;
  (2) September–October coaching is 49% QA coaching, so compliance themes dominate (quality/compliance purpose
  335, required-wording gap 200, no lead-management theme in the top 14);
  (3) Agent OS hides the lead-management coaching that does exist: the team leader's Coaching Hub tab lists only
  sessions logged under the team leader's own Hub profile; the campaign-manager coaching page drops sessions
  logged by a coach who is not a team leader on the list; and theme summaries show only "gap" themes, hiding
  the lead-management purpose theme.
- Q: Whose coaching is it — the coach's or the team leader's? → A: Every session belongs to the agent's current
  team leader (matched by the agent's CB), and shows who coached ("coached by Dalwin (SOS)").

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Open the app and see this month (Priority: P1)

On 1 October an agent, a team leader or a campaign manager opens Agent OS and sees October — not September.

**Why this priority**: The calendar says October; a September screen reads as broken data.

**Independent Test**: With no October rows published, every view names October, shows no invented figures, and
reaches September (final) in one click.

**Acceptance Scenarios**:

1. **Given** no October data yet, **When** an agent opens Today, **Then** the page is headed with October, says
   "No October figures yet — the first day lands after tomorrow morning's uploads", shows no sales, premium or
   percentage figures, and offers "September (final)".
2. **Given** the same, **When** the agent opens Projected Commission, **Then** it shows their first October payout
   (amount, premium needed, sales and per-day ask over October's working days).
3. **Given** the same, **When** a team leader opens My Team or Reports, **Then** they see October's empty state and
   a link to September (final); no report shows zero rows as if nobody sold.
4. **Given** the same, **When** a campaign manager opens the Campaign tab, **Then** "Current month" shows October's
   empty state and offers September (final) and the billing month in progress (26 Sep – 25 Oct).
5. **Given** October's first day is uploaded, **When** anyone opens the app, **Then** October figures appear with no
   other change.
6. **Given** any older month, **When** anything tries to make it the live view, **Then** it is refused.

---

### User Story 2 - Referrals refresh on schedule (Priority: P1)

At 08:00 and 14:00 every day the referral counts refresh from HighLevel without anyone opening VAS.

**Why this priority**: Referrals are on every agent's card and the team reports; stale counts undermine trust.

**Independent Test**: After a scheduled slot, the referral totals agents and team leaders see match HighLevel as of
that slot, and the run is logged.

**Acceptance Scenarios**:

1. **Given** 08:00 SAST, **When** the schedule fires, **Then** referral counts are pulled, matched to agents, published
   to every view, and the run is logged with the time and the counts.
2. **Given** the 14:00 slot, **When** it fires, **Then** the same happens again.
3. **Given** a slot did not run or failed, **When** the slot is more than two hours late, **Then** a health warning
   names the missed slot; it clears after the next successful run.
4. **Given** VAS is open in a browser, **When** a scheduled refresh lands, **Then** VAS shows the new counts without a
   manual sync and never overwrites a newer manual sync.

---

### User Story 3 - Coaching is fresh, every day (Priority: P2)

Team leaders and campaign managers see coaching that is at most a day old, and every coaching screen says how old.

**Why this priority**: Stale coaching produced the original "Denise's coaching is missing" report.

**Independent Test**: On any working morning the coaching copy is from 05:30 SAST that day or later, and every
coaching surface prints its age.

**Acceptance Scenarios**:

1. **Given** 05:30 SAST, **When** the day starts, **Then** a full pull of the Coaching Hub completes before 07:00.
2. **Given** a coaching surface (agent coaching history, team leader views, campaign-manager coaching page,
   team-leader Month to date analysis), **When** it renders, **Then** it states "Coaching Hub copy from <day time>".
3. **Given** the daily pull fails, **When** the copy is older than a day, **Then** the existing health warning fires.

---

### User Story 4 - Lead-management coaching is visible (Priority: P1)

Team leaders see every coaching session on their agents — including lead-management coaching logged by the SOS
coach — counted by type, with lead-management themes shown.

**Why this priority**: Team leaders report coaching as "only compliance"; the data they believe in must be visible.

**Independent Test**: For an agent coached on lead management by the SOS coach, the team leader's views list that
session under the agent, as "Lead Management Coaching", "coached by Dalwin (SOS)", with its lead-management theme.

**Acceptance Scenarios**:

1. **Given** the 28 July lead-management sessions, **When** a team leader opens the Coaching Hub tab for a period
   that includes July, **Then** the sessions on their agents appear with the coach's name.
2. **Given** a period with no lead-management coaching (September, October), **When** a team leader views coaching,
   **Then** it says plainly "No lead-management coaching logged in <period>" next to the type counts.
3. **Given** coaching type counts, **When** shown, **Then** Lead Management Coaching is its own count beside Formal,
   Informal, QA, Group and Scorecard.
4. **Given** theme summaries, **When** an agent has a lead-management theme, **Then** it appears alongside the
   development (gap) themes.
5. **Given** a campaign manager, **When** they open Team leaders' coaching, **Then** sessions logged by a coach who is
   not a team leader are attributed to the agent's team leader instead of being dropped (still only for the
   manager's own agents).

### Edge Cases

- A session with no agent CB → attributed to the Hub profile it was logged under, as today.
- An agent who changed team leader → the session shows under the current team leader, with the coach's name.
- HighLevel unreachable at a slot → the run is logged as failed, the last good counts stay, the warning fires.
- A manual VAS referral sync newer than the scheduled pull → the newer one wins.
- The empty month on the last day before data (e.g. a public holiday on the 1st) → stays empty with the same
  wording until the first day lands.
- An agent drill-down or report link built for September → still opens September (final).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The live view MUST always be the current calendar month (South African time), including before its
  first data; an older month MUST never become the live view.
- **FR-002**: With no data yet, every view MUST show the current month's empty state with the agreed wording and no
  invented figures, and MUST offer the previous month as "<Month> (final)".
- **FR-003**: Projected Commission MUST show the first payout of the current month when no day has been worked.
- **FR-004**: Campaign managers' empty current month MUST offer the previous month (final) and the billing month in
  progress.
- **FR-005**: Referral counts MUST refresh automatically at 08:00 and 14:00 SAST every day, reaching every view
  that shows referrals, without anyone opening VAS.
- **FR-006**: Every scheduled referral run MUST be logged (time, outcome, totals); a slot more than two hours late
  or failed MUST raise a health warning that clears itself.
- **FR-007**: A scheduled referral refresh MUST NOT overwrite a newer manual sync.
- **FR-008**: The Coaching Hub copy MUST receive a full pull at least once a day, starting 05:30 SAST, in addition
  to the rolling refresh.
- **FR-009**: Every coaching surface MUST state the age of its coaching copy.
- **FR-010**: Coaching sessions MUST be attributed to the agent's current team leader by the agent's CB, with the
  coach's name shown; sessions without a CB keep their logging profile.
- **FR-011**: Coaching views MUST count sessions by type with Lead Management Coaching separate, and theme
  summaries MUST include lead-management themes.
- **FR-012**: When a period has no lead-management coaching, team-leader coaching views MUST say so.
- **FR-013**: Campaign-manager coaching MUST keep its scoping (only the manager's own agents) while no longer
  dropping sessions logged by non-team-leader coaches.

### Key Entities

- **Live month**: the current calendar month; empty or with data.
- **Closed month (final)**: the previous month, reachable from the empty state.
- **Referral refresh run**: slot (08:00 / 14:00), time, outcome, totals.
- **Coaching session**: date, type, agent, the agent's current team leader, the coach, themes.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On the first day of a month, 100% of views name the new month and none shows a figure for it before
  its first data.
- **SC-002**: Referral counts on agent cards match HighLevel within one slot (≤ 6 h) on every day.
- **SC-003**: Every scheduled referral slot is logged; a missed slot is flagged within 2 hours.
- **SC-004**: On working mornings the coaching copy is from 05:30 SAST or later, 100% of days.
- **SC-005**: 100% of lead-management sessions on a team leader's agents are visible to that team leader with the
  coach's name.
- **SC-006**: Team leaders can tell, in one look, how many lead-management sessions were logged in the period.

## Assumptions

- Lead-management coaching continues to be logged in the Coaching Hub (by the SOS coach or by team leaders);
  Agent OS cannot show coaching that was never logged — the plain "none logged" message covers that.
- The scheduled referral refresh uses the existing HighLevel connection and the existing agent-matching rules.
- The machine that runs the scheduled publisher is on during the slots (the same constraint as today's 15-minute
  publisher); when it is not, the missed-slot warning fires.
- This morning's billing-cycle and CM features are unchanged.
