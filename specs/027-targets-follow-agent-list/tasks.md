# Tasks: Daily sales targets follow the Agent List (027)

Test-first: T001 is written and run RED on the base before any engine change.

## Phase 1 — Guard (RED)
- [ ] **T001** `nicks_code/diagnostics/verify-targets-027.mjs`: Worker unit (`listTargetOf`, `effPerDay` 5-arg chain,
  `rosterTargets` fields, `cmSettingsBody` list column), drift (spec `_precedence` = MTD_RULES = Worker; matrix values
  unchanged; `listTargetOf` parity PULSE↔Worker), PULSE engine in a real browser (Sept list 3/4/5 cells, Oct list
  4/5/6: per-day Sept = book, Oct = list; MTD target / % / composite of September identical to the no-list build; CM
  override wins; blank → book; November list 5 changes November only; mover's days take the right row; empty-month
  payload uses the list; digest carries October 4; Upload Station warning names mixed groups; backfill on an
  unchanged fingerprint), Ops (rule_target before targets_from). Run → RED.
- [ ] **T002** Register in `.github/workflows/verify.yml`.

## Phase 2 — Rule book + Worker
- [ ] **T003** `specs/mtd_engine_rules.json`: `_precedence`, `_source`, Sales Target note, `_changes[]` (2026-10-11).
- [ ] **T004** `worker/src/campaign.mjs`: `TARGET_PRECEDENCE`, `listTargetOf`, `effPerDay(…, listTarget)`,
  `rosterTargets`, `cmSettingsBody(…, listGroups)`; `worker/src/index.mjs`: `/api/roster` fields + settings list groups.
- [ ] **T005** `verify-cm-targets.mjs`: chain cases to the new precedence (list beats book when in force).

## Phase 3 — PULSE engine
- [ ] **T006** `MTD_RULES.salesTargetPrecedence`, `listTargetOf`, `sameOrgT`, `recordOrgList` target, recordOrg
  dedupe, `listTargetAt`, `perDayTarget`; buildModel + emptyMonthPayload use it.
- [ ] **T007** INGEST.roster passes the row's list target; `listTargetWarnings` → `S.rosterEffect.targets`, slot note,
  toast on hand uploads.
- [ ] **T008** `adoptRosterFromRecord`: `list_target` mapping + unchanged-fingerprint backfill; orgHist merge tie-break.

## Phase 4 — Ops + Agent Analytics
- [ ] **T009** Ops: map `Rule Target` / `Target From`, re-sync on `targets_rev`, `acStats` picks per window.
- [ ] **T010** Agent Analytics CM settings: show "Agent List n" beside "rule book n". (Agent figures: digest only — no change.)

## Phase 5 — Verify
- [ ] **T011** `node tools/prepare-site.js`; GREEN on verify-targets-027 and every suite touching targets / engine /
  roster / digest / CM view, plus verify-wimpy-removal and verify-wimpy-service-drift.
