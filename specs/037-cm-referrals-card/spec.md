# Feature Specification: The campaign manager's Referrals card

**Feature Branch**: `037-cm-referrals-card` · **Created**: 2026-10-15 · **Status**: BUILT 2026-10-15 (see tasks.md)

**Input**: Nick, 2026-10-15: "one of the cards for the campaign managers is how many referrals they have, so one of
dalwins card should show how many referrals live, and of course when he filters etc it must be there"

## Context

- The campaign manager's Campaign tab (Agent Analytics, `cm` view) paints the cards `cmOverviewBody` builds in the Worker
  (`worker/src/campaign.mjs`): sales, GWP, average sale, conversion, talk, attempts, contact rate, lead volume, QA, critical
  failures, cancellations, attendance. The page computes nothing (constitution I).
- Referrals already travel on every digest agent row as `ref` — the HighLevel referrals feed is synced at 08:00 and 14:00
  SAST (`tools/sync-referrals.mjs` → `kv:referrals-latest`), ingested by the headless digest, and the aggregator `agg()`
  already sums `o.ref`. The team leader's tables and the agent's own card show it; the manager's cards do not.

## Decision

One more measure in `kpis`, built from the SAME rows as the other cards — the campaign's rows after the tenure slice,
from the digest of the period on screen — and one more card on the page. Because the figure is built that way, the
campaign picker, tenure, month, billing cycle and custom range apply to it by construction; nothing is summed on the page.

## User Stories

### US1 — The card (P1)
Dalwin opens Campaign and sees a Referrals card: the number of referrals his campaign's agents made in the period on
screen, with "N of M agents referred at least one · from the referrals feed". All campaigns shows the total across his
campaigns.

### US2 — Every filter applies (P1)
Switching campaign, picking a tenure, changing the month / cycle / custom range changes the card exactly as it changes
Sales — the same rows, the same digest.

### US3 — Honest when empty (P2)
A quiet period reads "0 · 0 of M agents referred at least one"; an older payload without the figure shows no card at
all, never a 0.

## Requirements

- **FR-001** `cmOverviewBody`: every campaign entry and the "All campaigns" entry carry
  `kpis.referrals = { v: Σ ref, agents: distinct CBs with ref > 0, people: headcount }` over the sliced rows.
- **FR-002** `agent/index.html` `cmCmdPage`: a `kpi()` card "Referrals" from that object; absent object → no card. ES5.
- **FR-003** Guards: `verify-cm-signoff-worker` (per campaign, all, and a tenure slice), `verify-cm-view` (the card
  prints; absent → no card) — red first.

## Out of scope

Referrals per team row on the Team Leaders page; a referral target; changes to the feed or its schedule.
