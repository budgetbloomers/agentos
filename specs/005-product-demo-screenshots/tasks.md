---

description: "Task list — 005 product demo screenshots"
---

# Tasks: Product demo screenshots

**Input**: `/specs/005-product-demo-screenshots/` — spec.md, plan.md, research.md

**Tests**: the run asserts every shot itself (page errors, spinners, empty/error cards, live-roster names) and stops
on the first failure; there is no product code change to unit-test.

## Phase 1: Setup

- [x] T001 tools/demo/floor.mjs — the fictional floor: 1 CM, 4 TLs, 29 agents (CB9101+), Courtesy/Cuddle/Nesting,
  3 Aug–28 Sep 2026 (public holidays skipped), attendance, calls, sales with case maps, QA, cancellations, Manual Stats,
  open/closed lead books, referrals, coaching flags, Upload Station file registry; deterministic (seeded)

## Phase 2: User Story 1 — VAS Analytics (P1) 🎯 MVP

- [x] T002 [US1] tools/demo/pulse.mjs — serve nicks_code/index.html, pin the clock, inject the floor, walk the 15 pages and
  their sub-tabs (MTD per campaign + Team Leaders, Weekly per campaign, Variance sub-tabs, Leaderboard metrics, an agent
  drawer), assert each shot, export `digest()` + `reports()` for US2
- [x] T003 [US1] tools/demo-screenshots.mjs — the one command: (re)create the Downloads folder, run US1, number the shots

## Phase 3: User Story 2 — Agent Analytics (P1)

- [x] T004 [US2] tools/demo/agent.mjs — in-memory DB seeded with the exported digest, reports, coaching copy, NBA digest,
  links, CM assignments; route every `/api/*` call to the real Worker function; fictional Convex (coaching + KPI hubs) and
  HighLevel (help center, campaign assistance) behind `globalThis.fetch`
- [x] T005 [US2] team leader walk: My Team, an agent drill-in, Help Center, KPI Hub, Coaching Hub, the coaching sequence
  (pick → filled form → draft saved → signed → submit confirmation → locked line), Team Results, Reports (5), Nikola,
  All forms
- [x] T006 [US2] agent walk: Today, Projected Commission, My Progress, Coaching, Links
- [x] T007 [US2] campaign manager walk: Campaign, Teams, Assistance, Reports (5), Nikola, Settings, Coaching

## Phase 4: User Story 3 — Safe and repeatable (P2)

- [x] T008 [US3] leak check: every rendered page's text against the real Agent List (names + CBs), never printed
- [x] T009 [US3] full run twice; same set; view a sample of shots for quality

## Phase 5: Polish

- [ ] T010 tools/demo files reviewed (ecc:code-reviewer) — OPEN; README line in CLAUDE.md Workflows — done
