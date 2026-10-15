---
description: "Task list — 037 the campaign manager's Referrals card"
---

# Tasks: 037

**Tests**: REQUIRED, red first.

- [x] T001 `verify-cm-signoff-worker`: referrals = Σ ref per campaign, for All campaigns, and over a tenure slice — RED
- [x] T002 `verify-cm-view`: the Referrals card prints "17 · 5 of 12 agents referred at least one · from the referrals feed";
  an older payload without the figure draws no card — RED
- [x] T003 `worker/src/campaign.mjs`: `agg()` counts distinct referring people; `kpis.referrals` on every campaign entry and
  on All campaigns — GREEN (worker suite)
- [x] T004 `agent/index.html` `cmCmdPage`: the card, after Attendance, ES5 — GREEN (view suite)
- [x] T005 (suites green; code review APPROVE, 2 LOW notes — movers carry ref once, portal.mjs:445) Full CM suites (`verify-cm-view`, `verify-cm-signoff-worker`, `verify-cm-digest`, `verify-agent-analytics`,
  `verify-agent-portal`), `/ecc:code-review`
- [x] T006 Deployed 2026-10-15: Worker 803ec112, Pages b4aae8d7 (card on the live page); the deployed page carries the card code; CLAUDE.md note; commit + push
