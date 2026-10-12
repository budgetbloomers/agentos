# Feature Specification: A usage report you can query in Supabase

**Feature Branch**: `028-usage-report` | **Created**: 2026-10-11 | **Status**: Draft
**Input**: Nick, 2026-10-11: "I need you to create me a table in supabase so we can see how many times users ask for
request, how many times users login in to the software, basically we want to query supabase and make a usage report,
see what users ask their team leader most of the time etc"

## What exists today (read-only check, 2026-10-11)
- Sign-ins: `auth_log` (2,622 rows since Aug; Oct so far 202 AgentOS sign-ins, 25 Wimpy, 89 sign-outs, ~43 failures) —
  but it does not say WHICH app (VAS, Ops, Agent Analytics, Tracker) the person opened.
- Help asks to team leaders (`/api/portal/help/request`, worker/src/help.mjs): a category from HELP_CATEGORIES + the
  agent's note go to the HighLevel Help Center — NOTHING per ask is kept in our database.
- Campaign-manager assistance (worker/src/assist.mjs): one `rules` row per request (`kv:cm-areq:*`, archive `kv:cm-areq-arch:*`).
- Ask AgentOS (AI) questions: `ask_log` (asked_by, question, answer, model).

## Decided with Nick (2026-10-11)
1. Help asks keep the **category and the agent's note** (staff-only), plus the agent's team leader and campaign.
2. **Each app open** is recorded (which app, who, when) — not only sign-ins.
3. **Backfill what exists**: sign-ins from auth_log, every campaign-manager request, AI questions, and past help asks read
   back (read-only) from the HighLevel Help pipeline. App opens start at release.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — How much is AgentOS used? (P1)
1. **Given** a month, **When** Nick queries the report, **Then** he sees per day and per person: sign-ins, failed sign-ins,
   and app opens per app (VAS, Ops, Agent Analytics, Tracker).
2. **Given** a person, **Then** their first and last sign-in, number of sign-ins and days active in a period are one query.

### User Story 2 — What do agents ask their team leader? (P1)
1. **Given** a period, **Then** help asks are counted by category, by team leader, by campaign and by agent, newest first,
   with the agent's note readable.
2. **Given** a team leader moves an ask's card (stage), **Then** the report shows how many asks were answered and how fast.

### User Story 3 — Requests to campaign managers and to the AI (P2)
1. Campaign-manager assistance requests counted by blockage type, team leader and status.
2. Ask AgentOS questions counted per person and per app, with the question text.

### Edge Cases
- A failed help ask (HighLevel down) is still recorded, marked not delivered.
- Recording never slows or fails the request it describes.
- The backfill can be re-run without duplicating anything.
- A leaver's history stays (their username is kept on the event).

## Requirements *(mandatory)*
- **FR-001** One append-only event table with: time, person (id + username + role), app, event, category, team leader,
  campaign, and a detail field for the rest (note text, stage, error, question).
- **FR-002** Events written by the server for: sign-in ok/fail, sign-out, app open, help ask (+ delivered or not), help
  stage change, campaign-manager request and action, AI question.
- **FR-003** Ready-made report views: usage per day, sign-ins per person, app opens per person and app, help asks by
  category / team leader / campaign / agent (with notes), help answered + time to answer, CM requests by blockage,
  AI questions per person.
- **FR-004** Staff-only: row-level security on, no anonymous or signed-in database access; readable in Supabase by the
  service role (and by staff through any future report page via the Worker).
- **FR-005** A one-off, re-runnable backfill from auth_log, kv:cm-areq rows, ask_log and the HighLevel Help pipeline.
- **FR-006** Writing an event must never fail or noticeably slow the user's request.

## Success Criteria *(mandatory)*
- **SC-001** "Sign-ins per person this month" and "top help categories this month" are each one SELECT on a view.
- **SC-002** After release, 100% of help asks appear in the table within a minute, including failed ones.
- **SC-003** The backfill reproduces auth_log's counts exactly and is idempotent (a second run adds 0 rows).
- **SC-004** No usage data is readable with the anon or authenticated keys.

## Assumptions
- The app is known from the page path the request comes from (VAS = /pulse, Ops = /, Agent Analytics = /agent/,
  Tracker = /tracker) — the Wimpy service is outside this Worker and keeps its own sign-in rows in auth_log.
- A report web page is not part of this spec (queries in Supabase first); it can follow.
