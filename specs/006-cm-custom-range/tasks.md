---

description: "Task list — 006 custom date range for campaign managers"
---

# Tasks: Custom date range for campaign managers' reports

**Input**: spec.md, plan.md (contracts C1–C6). **Tests**: REQUIRED (Constitution VII), red first.

## Phase 1: Setup

- [x] T001 Baseline green: verify-cm-signoff-worker, verify-cm-view, verify-cm-digest, verify-digest-fence, verify-agent-analytics

## Phase 2: User Story 1 + 2 — pick a range; a new range is built (P1) 🎯 MVP

- [x] T002 [P] [US1] verify-cm-signoff-worker: resolvePeriod('range-2026-09-01-2026-09-15') → kind 'range', label
  '1 – 15 Sep 2026'; invalid ranges (from > to, > 93 days, to after today, before 2025-01-01, malformed) → bad_period;
  unbuilt → 404 range_building + ONE queue entry (asked twice → still one); refused entry → 404 range_refused + reason;
  built → 200 with period kind 'range'; periods.ranges lists it; agent/TL get no range (their period param is ignored /
  refused); tl/reports?period=range… serves the range report to a CM — RED
- [x] T003 [P] [US1] verify-cm-view: picker offers "Custom range…" and built ranges; choosing it shows from/to inputs;
  Apply asks `period=range-…`; invalid dates refused in the page with a message; range_building card says "being built"
  and re-asks after 60 s; range_refused shows the reason; stored `cbx_cm_view` keeps a valid range; Variance/Lead
  management ask tl/reports with the period — RED
- [x] T004 [P] [US2] verify-cm-digest: the engine's range payload (setRange) carries exactly the range's days; the tool
  source has a RANGE-JOBS block that reads `kv:cm-range-requests`, calls setRange, publishes digest + both reports +
  pointer kind 'range', writes status back, rebuilds a range still filling — RED
- [x] T005 [P] [US3] verify-digest-fence: range digest and range report keys are guarded (staff-only) — RED
- [x] T006 [US1] worker/src/portal.mjs: C1–C4 (resolvePeriod, periodOf, overviewRequest queue + 404s, periods.ranges,
  loadReports with period); worker/src/rules.mjs GUARDED_KV; worker/src/index.mjs tl/reports period
- [x] T007 [US1] agent/index.html: C6 (cmValidPeriod, picker, inputs, building/refused card + retry, repLoad period, label)
- [x] T008 [US2] tools/digest-republish.mjs: C5 RANGE-JOBS
- [x] T009 T002–T005 GREEN; full related suites green

## Phase 3: Polish

- [x] T010 CLAUDE.md NN12 + constitution (MINOR): range keys; code review — 2026-10-06: NN12 sentence + constitution 1.4.0
  done; independent review found 2 MEDIUM + 2 LOW, all fixed red-first (typed dates survive the minute's re-ask; a
  different engine window is refused with its reason; a refusal over a day old is re-queued when asked again; a refused
  rebuild of a published range stays 'built'); suites green: cm-signoff-worker 253, cm-view 120, cm-digest 139,
  digest-fence 105, agent-analytics 169, live-month-page 75, coaching-drafts 85, coaching-signature 59,
  campaign-manager 69, cm-targets 28, coaching-attribution 65
- [x] T011 Deploy Worker → Pages → smoke — LIVE 2026-10-07 (Nick: "put all of this live"): Worker 665a8f9a, Pages build muxtsen8, smoke cors 13/13 + live-save 5/5; the tick builds the first range asked for
- [ ] T012 Commit (conventional), no push
