# Feature Specification: Daily sales targets follow the Agent List

**Feature Branch**: `027-targets-follow-agent-list` | **Created**: 2026-10-11 | **Status**: Draft
**Input**: UAT feedback (Nick, 2026-10-11): "The targets are not updated for the agents based on their tenure below —
Month 1 - 4, Month 2 - 5, Exp - 6"

## What was found (2026-10-11, read-only)

The Agent List uploaded 9 Oct ALREADY carries the new targets in its Target column — Courtesy M1 = 4 (16 agents),
M2 = 5 (6), Exp = 6 (13), M0 = 3 (13); Cuddle Exp = 8 (29); VT mixed (1 – 7). The dashboards ignore that column for
any campaign|tenure the rule-book table names (`salesTargetMatrix`: Courtesy M1 3, M2 4, Exp 5, Cuddle Exp 8, Nesting 2;
since 20 Aug the table decides first). No campaign-manager override (`cm:targets`) exists. So every Courtesy agent is
measured one sale a day too low, in VAS, in the Agent Analytics digest and on the CM view.

## Decided with Nick (2026-10-11)

1. **The Agent List's Target column is the authority.** The rule-book table is the fallback only for a blank cell; a
   campaign manager's override still sits above both. A future target change needs only a list upload.
2. **A list's targets apply to the month it is uploaded in** (the same whole-month rule as campaigns and team leaders):
   October uses 4 / 5 / 6 from 1 Oct; September and earlier keep the targets they were measured on (3 / 4 / 5).

## User Scenarios & Testing *(mandatory)*

### User Story 1 — An agent is measured against the target on the Agent List (Priority: P1)
1. **Given** a Courtesy M1 agent whose list row says Target 4, **When** October's MTD is viewed in VAS, Agent Analytics
   (agent, team leader, campaign manager) or the CM view, **Then** their daily target is 4 and their MTD target is
   4 × their shifts; % of target follows.
2. **Given** the same agent in September, **Then** September's target stays 3 per day.
3. **Given** a list row with a blank Target cell, **Then** the rule-book value for that campaign|tenure applies (as today).
4. **Given** Dalwin sets an override for Courtesy|M1, **Then** the override wins everywhere (as today).

### User Story 2 — A later list changes targets for its own month only (Priority: P1)
1. **Given** a November list that sets Courtesy M1 to 5, **Then** November uses 5 and October keeps 4.
2. **Given** an agent moves campaign mid-month, **Then** each day takes the target of the campaign/list row in force that day
   (the existing campaign-move rule), never a stale cell from another campaign.

### User Story 3 — A suspicious list is flagged, not silently trusted (Priority: P2)
1. **Given** a list where agents in the same campaign and tenure carry different targets, **Then** the Upload Station names
   the group and the values with counts (a warning — the list still publishes).

### Edge Cases
- Target cell not a number (text, "TBC") → treated as blank → rule-book fallback, and named in the warning.
- Agent added mid-month → their target from that list applies from the first day they appear (the month's rule).
- Leavers keep the target their days were measured on.

## Requirements *(mandatory)*
- **FR-001** Per-day target precedence everywhere: CM override exact → CM override campaign-wide → **the Agent List row's
  Target in force that day** → rule book exact → rule book campaign-wide.
- **FR-002** "In force that day" = the list row recorded for that agent for that day's month (whole-month rule); months
  before 2026-10-01 have no list targets recorded and keep the rule book (unchanged figures).
- **FR-003** VAS, the published digests (Agent Analytics), the Worker's CM view / /api/roster and Ops read the same number.
- **FR-004** The Upload Station warns on mixed targets within a campaign|tenure group (and on non-numeric cells).
- **FR-005** The rule book (specs/mtd_engine_rules.json) and every mirror state the new precedence; the drift guards agree.

## Success Criteria *(mandatory)*
- **SC-001** After release, every Courtesy agent's October daily target equals their Agent List cell (4 / 5 / 6 / 3).
- **SC-002** Every September figure (targets, % of target, composite) is unchanged to the cent.
- **SC-003** VAS, Agent Analytics and the CM view show the same October target for the same agent.

## Assumptions
- "Month 1 / Month 2 / Exp" are the list's M1 / M2 / Exp tenure codes; the feedback concerns Courtesy (Cuddle Exp is 8 on
  the list and in the table, VT already takes its list cells).
