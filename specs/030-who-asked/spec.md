# Feature Specification: Who asked — names, teams and leaders on every ask

**Feature Branch**: `030-who-asked` | **Created**: 2026-10-11 | **Status**: Draft
**Input**: Nick, 2026-10-11 (looking at most_asked_topics: rank, label, asks, examples): "add agents team name, who asked
and their team leader, do the same for team leader and campaign manager"

## Facts (read-only, 2026-10-11)
- An agent's team is named after its team leader (`app_users.team`, e.g. "Denise Haripersad"); campaign managers have no team.
- A team leader's campaign manager is on record in `team_leader_cbs.manager` (e.g. Hezron Pillay → Dalwin Callaghan);
  029 also stores the CMs responsible when a request is raised (`detail.cms`).
- Help asks backfilled from HighLevel carry the agent through the card's contact (CB in the name/notes).

## User Scenarios (mandatory)
### US1 — Every agent → team leader ask, with who asked (P1)
Each ask: when (SA time), the agent's name and CB, their team, their team leader, campaign, category, topic, the
question, whether it reached the team leader, and where it stands now.
### US2 — Every team leader → campaign manager request, with who asked (P1)
Each request: when, the team leader's name and CB, their team/campaign, the campaign manager it went to, blockage,
topic, the request, delivered, status.
### US3 — The most-asked list shows who asked (P1)
Next to each topic: how many different people asked it and who they are (name, CB, team; for CM requests the team
leader and the campaign manager).

## Requirements (mandatory)
- **FR-001** Two detail views (help asks, CM requests) with the fields above, filterable by day / week / month.
- **FR-002** `most_asked_topics` gains `askers` (distinct people) and `asked_by` (the list, readable).
- **FR-003** Names come from the account at the time of reading; a leaver or renamed person still shows (username/CB kept).
- **FR-004** Test traffic stays hidden (built on `usage_events_real`); staff-only like 028/029.

## Success Criteria (mandatory)
- **SC-001** "Who asked about Review my call this month, and who is their team leader" is one SELECT.
- **SC-002** Every non-test ask shows a name and CB (or the username if the account no longer exists).
