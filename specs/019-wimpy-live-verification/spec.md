# Feature Specification: The live Wimpy service, proved end to end

**Feature Branch**: `019-wimpy-live-verification`
**Created**: 2026-10-09
**Status**: Draft
**Input**: User description: "test the entire wimpy and make sure everything is working"

## What "working" means (the user stories, each independently checkable on the LIVE address)

### US1 — The service answers and is locked down (P1)
Health says the database and HighLevel are configured; the page loads with no price in it; every answer carries the
security headers; nothing answers without a sign-in; the retry route refuses without its secret; a POST that is not JSON
is refused; an unknown path is a plain 404.

### US2 — A person can do everything a person does (P1)
A real account on the live database signs in with a wrong password and is refused in the usual words; signs in with the
right one and gets a lunch-only session; sees who they are; gets today's menu with today's Big One and an open window
(it is a weekday inside 08:00–17:00 SAST); sees an empty My orders; places ONE order — clearly marked TEST — which the
kitchen accepts; sees it in My orders (on the kitchen board, or waiting for it); signs out; and is refused afterwards.
The account is a throwaway created for this check and removed at the end (its ledger rows and sessions with it).

### US3 — The suite side holds (P1)
The old Worker routes answer 410 naming the new address; the old page address forwards; a session minted by the new
service is refused by the Worker.

### US4 — The Agent List still feeds Wimpy (P2)
The database trigger that gives every new account the Wimpy app exists; no active agent or team leader lacks it; the
latest Agent List's integrity view raises nothing about Wimpy.

### US5 — The retry runs (P2)
Called with its secret, the retry route runs, reports counts, and writes the status the suite's health check reads.

## Requirements
- FR-001: every check runs against the LIVE address and the LIVE database with real credentials from the git-ignored files.
- FR-002: the only lasting side effects are ONE test order (kitchen slip + HighLevel contact/card, both labelled TEST)
  and the audit-log rows of the throwaway account's sign-ins; the account itself is removed.
- FR-003: no secret, password or token is printed.

## Success Criteria
- SC-001: every check passes; a failure names the request and the answer.
- SC-002: the throwaway account no longer exists when the suite ends, whatever happened in between.
