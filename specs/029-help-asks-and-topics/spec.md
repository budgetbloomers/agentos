# Feature Specification: Who asks for help, and what they ask most

**Feature Branch**: `029-help-asks-and-topics` | **Created**: 2026-10-11 | **Status**: Draft
**Input**: Nick, 2026-10-11 (after running the 028 queries): "we also want to monitor, how many agents ask their team leader
for help, how many team leaders asked their cm for help, what was the most asked question"

## What exists (2026-10-11)
- 028's `usage_events`: help asks (agent → TL) recorded from 11 Oct with category + note; CM requests (TL → CM) recorded
  with blockage + delivered — but NOT the request's own words; 1 CM request ever (31 Aug); 450 Ask AgentOS questions.
- Help categories are fixed (Review my call · Explain what to say · Explain the product · Explain my quality result ·
  Help with the system · Something else). Past help asks are only in HighLevel (Help Center pipeline).

## Decided with Nick (2026-10-11)
1. "Most asked question" covers **agents' help asks to their TL** and **TLs' requests to campaign managers** (not the AI).
2. Rewordings are grouped into **topics by the AI AgentOS already uses** (Workers AI).
3. **Past help asks are included** — Nick provides the Help Center key in a git-ignored `help-highlevel.env`.

## User Scenarios & Testing *(mandatory)*
### US1 — How many agents ask their team leader for help? (P1)
For a day/week/month: number of distinct agents who asked, number of asks, per team leader and per campaign, and the
agents who ask most.
### US2 — How many team leaders ask their campaign manager? (P1)
For a period: number of distinct TLs who asked, number of requests (delivered / not), per campaign manager / campaign
and per blockage.
### US3 — What is asked most? (P1)
Topics ranked by how often they were asked, separately for agent→TL and TL→CM and combined, with a few example
questions per topic and the category/blockage they came under. Rewordings of the same question land in the same topic.
### Edge Cases
- A note too short or empty to label → "Other".
- The AI is unavailable → the ask is recorded unlabelled and labelled later (never blocks the ask).
- A topic Nick renames or merges updates every past count.
- The same ask backfilled from HighLevel and recorded live is counted once.

## Requirements *(mandatory)*
- **FR-001** Views for US1 and US2 per day / week / month, with distinct people and totals.
- **FR-002** The words of a TL → CM request are kept (staff-only), like a help note.
- **FR-003** Every help ask and CM request gets one topic from a curated list (seeded from the real asks), or "Other";
  labelling runs after the request and never delays or fails it.
- **FR-004** Nick can rename or merge topics in one table; counts follow.
- **FR-005** A re-runnable tool labels anything unlabelled (history, AI outages) and backfills past help asks from the
  HighLevel Help pipeline once the key exists — never duplicating.
- **FR-006** Staff-only: RLS on, anon/authenticated revoked, like 028.

## Success Criteria *(mandatory)*
- **SC-001** "How many agents asked their TL this month" and "how many TLs asked a CM this month" are one query each.
- **SC-002** "Top 10 topics this month" is one query, with example questions.
- **SC-003** 100% of asks carry a topic within 15 minutes (or "Other"), none lost when the AI is down.

## Assumptions
- Topics are short English labels (2–5 words); the curated list starts small (≈10–20) and grows only through the table.
