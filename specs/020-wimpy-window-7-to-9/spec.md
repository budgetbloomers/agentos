# Feature Specification: Wimpy ordering only 07:00–09:00 SAST, Monday to Friday

**Feature Branch**: `020-wimpy-window-7-to-9` · **Created**: 2026-10-09 · **Status**: Draft
**Input**: Nick: "for the wimpy it must only be accessible from 7 to 9, monday to friday then its closed"

## Decided
1. "Accessible" is read as ORDERING: the window moves from 08:00–17:00 to 07:00–09:00 SAST, Monday to Friday. Outside
   it the app behaves exactly as it does outside the window today — a person can still sign in, read the menu (marked
   closed) and open My orders, but nothing can be added and the server refuses an order whatever the page's clock says
   (Nick's decisions in specs 014/015 kept history readable whenever a person can sign in). If Nick meant the whole app
   shut, that is one more line (refuse sign-in outside the window) — say so.
2. SAST (UTC+2, no daylight saving), as today.

## User Story — the window (P1)
At 07:00 on a weekday the menu opens; at 09:00 it closes; on a weekend it is closed all day. The page says the hours
when closed; the sign-in footer says the hours; the VAS Apps card says the hours; a tab left open flips by itself.

**Acceptance**: a Wednesday 08:00 order is accepted; 06:59 and 09:00 are refused with a message naming 07:00 and 09:00;
Saturday 08:00 is refused; the menu payload carries `window.hours = '07:00–09:00'`.

## Requirements
- FR-001: ONE server constant defines the window; the server refuses outside it regardless of the page.
- FR-002: every mirror of the hours moves with it: the page's flip clock, the sign-in footer, the refusal message, the
  VAS Apps card, CLAUDE.md, the service README.
- FR-003: nothing else changes — prices, menu, sign-in, My orders.
- FR-004: every test that assumed the old hours is re-based; all suites green; the live suite checks the window.

## Success Criteria
- SC-001: service tests 5/5 files green; verify-wimpy-live green at the new address.
- SC-002: the live menu payload says 07:00–09:00 and `window.open` matches the SAST clock.
