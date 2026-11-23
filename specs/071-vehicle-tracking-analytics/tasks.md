---
description: "Task list for 071 Vehicle Tracking Analytics"
---

# Tasks: Vehicle Tracking (VT) Analytics (071)

**Input**: [spec.md](./spec.md), [plan.md](./plan.md), [rules-draft.json](./rules-draft.json).
**Tests**: REQUIRED and written first (constitution VII). Each phase opens with its guard, which is run RED before any code it guards.
**Hard rules for every builder**: no deploy, no push, no production data write, no migration applied anywhere but a local/test
database inside a rolled-back transaction (D11). Applied migrations are never edited. People are named by CB only. Fixtures are
fictional (CB91xx). Real files are read only from `../reference/zips/vt/` at run time and never copied into the repo.
Re-check every line number quoted from current-state.md before editing.

Format: `[ID] [P?] [Story] Description · files · acceptance`. `[P]` = may run in parallel with the other `[P]` tasks of the
**same phase** (different files, no dependency).

## Shared-file matrix (do NOT run two builders on the same file at once)

| File | A | B | C | D | E | F |
|---|---|---|---|---|---|---|
| `nicks_code/index.html` (PULSE) | A4 | – | C5 C6 C7 | D1 | E2 | – |
| `tools/prepare-site.js` | A2 | – | C9 (generic inliner) | – | – | – |
| `worker/src/index.mjs` | A6 | – | C4 (mount vt routes) | – | E5 (mount portal routes) | – |
| `worker/src/vt.mjs` | – | – | C4 (intake half) | – | E5 (portal half) | – |
| `nicks_code/vt-pages.js` | – | – | C6 (station half) | D2 D3 (report half) | – | – |
| `worker/src/rules.mjs` | – | – | – | – | E4 | – |
| `worker/src/portal.mjs`, `campaign.mjs` | – | – | – | – | E5 E6 | – |
| `worker/src/health.mjs` | – | – | – | – | – | F3 |
| `Chatterbox_AgentOS_Analytics.html` (Ops) | A4 | – | C8 | – | – | – |
| `agent/index.html` | – | – | – | – | E7 | – |
| `site/auth-gate.js`, `site/_headers` | A3 | – | – | – | – | – |
| `nicks_code/vt-engine.js` | – | B3–B6 (owner) | C4 (merge output only) | – | E1 (digest only) | – |
| `specs/vt_engine_rules.json` | – | B2 | – | – | – | F5 (`_changes[]` only) |
| `.github/workflows/verify.yml` | A8 | B8 | C11 | D4 | E10 | F7 |
| `tools/audit-permissions.mjs` | – | – | – | – | – | F1 |
| `CLAUDE.md` | – | – | – | – | – | F8 |

Phases are **sequential**: A → B → C → D → E → F. **B may run in parallel with A** (B touches only new files plus its own
lines in `verify.yml`; give `verify.yml` to whichever finishes second). D and E both read `vt-engine.js` but only E1 writes
it. Run D before E, or let E1 land first and then D.

---

## Phase A · Remove the old Tracker (US6) · one builder

- [ ] **A0** Baseline: run the SC-003 VAS suites + `verify-upload-formats`, `verify-tab-guard`, `verify-server-grants`,
  `verify-agent-analytics`, `verify-agent-portal`, and record pass counts in `specs/071-vehicle-tracking-analytics/baseline.txt`.
  Acceptance: the file lists suite → result; any pre-existing red is noted, never "fixed" here.
- [ ] **A1** [US6] Guard first: `nicks_code/diagnostics/verify-tracker-removed.mjs`. It checks that `site/tracker/` is absent
  after build, there are no `tracker/index.html` links in Ops or PULSE, `auth-gate.js` has no `tracker` APP, `MANAGEMENT_APPS`
  has no `tracker`, no shipped file contains the old seed names (the list is read from git history at test time and never
  written into the test), and the VAS hand-built tracker (`trackerDaily`, `STORE_KEY`) is still present. Run RED.
- [ ] **A2** Delete `tracker/index.html`, `tracker/vt-mtd-report.html`. In `tools/prepare-site.js`, remove the tracker tuple (≈252),
  `VT_REL` block (≈263–269), `'tracker/index.html'` in the shell list (≈280), and the comment (≈245). Acceptance:
  `node tools/prepare-site.js` passes the build-consistency check.
- [ ] **A3** [P] `site/auth-gate.js`: drop the `/tracker` branch (≈6) and the `tracker` keys in `NAMES`/`PATHS` (≈324–325).
  `site/_headers`: drop the line-4 comment. Acceptance: `verify-tab-guard` green.
- [ ] **A4** [P] App switchers: Ops option (≈441) and PULSE option (≈6573) + PULSE comment (≈10059). Also hide PULSE `gFilter`'s
  "Matrix Tracker" option (≈6680–6684) **without touching `buildModel`/`aggCols`/`vtHidden`**. Acceptance: `verify-engine-rules`
  unchanged result; `verify-saturday-rule` campaign-filter checks still pass.
- [ ] **A5** `tools/vt-grant-tabs.mjs` (new; dry run by default; `--apply` refuses unless `VT_GRANT_APPLY=owner`). It lists
  `tracker` holders + VT TLs (CB194, CB104, CB360, CB358) + VT-scope CMs, and proposes adding `vas` + `tabs.vas` ids
  `vt_mtd`,`vt_weekly`,`vt_daily`. It never removes anything. Acceptance: the dry run against a fixture DB prints the plan;
  the unit test covers "never removes".
- [ ] **A6** `worker/src/index.mjs`: remove `'tracker'` from `MANAGEMENT_APPS` (≈539), the Tracker app text in the AI system
  prompt (≈61, 72), and the `ai-digest-tracker` / `daily_eod` context pull (≈2545, 2555–2566, 2646). **Keep** `/api/eod`,
  `GATED_WRITES` entry, `usage.mjs`. Acceptance: `verify-agent-portal`, `verify-server-grants` green. A deploy note in A7 says
  A5 must be applied first.
- [ ] **A7** `specs/071-vehicle-tracking-analytics/deploy-checklist.md`: the order is grants (A5 `--apply`) → deploy → smoke.
  List every (c) item "left in place, reason" (plan §R).
- [ ] **A8** Register `verify-tracker-removed` in `.github/workflows/verify.yml`. Re-run the A0 suites: same results + A1 GREEN.

**Checkpoint A**: the old Tracker is gone, VAS is unchanged against the baseline, and the grant plan is ready.

---

## Phase B · Rule book + VT engine + oracle/unit tests (pure, no UI) (US1, US2) · one builder (may overlap A)

- [ ] **B1** [P] Guards first (RED): `verify-vt-oracle.mjs`, `verify-vt-engine.mjs`, `verify-vt-periods.mjs`,
  `verify-vt-rating.mjs`, `verify-vt-rules.mjs`, as specified in plan §T. Oracle expected values are DERIVED at run time
  from `November 2026 - VT Report.xlsx` (restricted to reproducible rows), plus the fixed aggregates 1,756 / 1,104 / 153 / 499 /
  Hrs 136-83-99-181 / unmatched 8 / 49 / 17. Scratch output goes to `nicks_code/diagnostics/scratch/vt/`. Acceptance: all five fail
  because `vt-engine.js` is missing.
- [ ] **B2** `specs/vt_engine_rules.json` from `rules-draft.json` (drop `_evidence` prose that is not a rule; keep `_cells`).
  `_changes[]` first entry dated 2026-11-23.
- [ ] **B3** `nicks_code/vt-engine.js` (UMD) `VT_RULES` inlined + `detect(header, sheetName)`, `extractDate(fileName)`,
  `parseBi(aoa)`, `parseSm(aoa)`, `parseOpeningBook(aoa)`. Read by POSITION where headers repeat (Contract Status B/R, Charge
  Amount X/AD, Unit Type Y/AK). Footer skip. PII columns are never copied. Acceptance: `verify-vt-engine` detection/parse
  cases are green.
- [ ] **B4** `normSeller`, `resolveSeller(name, roster, aliases)` (exact → alias → one-typo near-spelling → VT-only unique
  first+last token → unmatched), `leadSourceOf(partner, sellerSub)`, `subOf(campaignRaw)`. Acceptance: the oracle seller
  matches (41 + CB342).
- [ ] **B5** `merge(book, observations, extractOn) → {cases:[changed rows], events:[…], counts, unmatched, warnings}`. It
  implements spec FR-011…FR-015 and A7. It is pure and deterministic, and the input book is never mutated (returns new
  objects). Acceptance: oracle 1,756/1,756; precedence/sticky/older-extract unit cases.
- [ ] **B6** `periods` (cycle of a day, weeks Mon–Sat clipped, working days via an injected `isDataOnlyDay`, with a test copy of
  `saHolidaysFor` checked byte-identical to PULSE's), `model(book, rosterByCycle, rules, asOf)` (all spec §5 columns at agent / TL
  / sub / lead / floor, MTD / weeks / days), and `rating(agentModel, rules)` (spec §6). Acceptance: the periods + rating suites
  are green, including the worked example 59.7 / Needs support.
- [ ] **B7** Size check: `vt-engine.js` ≤ 800 lines (otherwise split `vt-engine-parse.js`, both tagged `data-inline`).
- [ ] **B8** Register the five suites in `verify.yml` (coordinate with A8).

**Checkpoint B**: the engine reproduces every reproducible workbook figure in Node. No UI or VAS file has been touched.

---

## Phase C · Database, Worker intake, Upload Station intake (US1) · one builder (C1–C2 may be a second, DB-only builder in parallel with C4–C8)

- [ ] **C1** [P] Guard first: `verify-vt-db.mjs` (plan §T). RED.
- [ ] **C2** [P] `supabase/migration-071-vt-facts.sql`: the tables, indexes, checks, FKs, RLS, revokes, and the functions
  `vt_book`, `vt_upload_begin/stage/commit/abandon`, `vt_trim`, `vt_db_size` (plan §DB-2/3/6). Header comment: why, the size
  estimates, "Apply: node tools/apply-migration.mjs … (owner, at deploy)". Acceptance: `verify-vt-db` GREEN on a local/test
  database (rolled back). `vt_book` < 300 ms at 20k synthetic cases. anon/authenticated denied on every object.
- [ ] **C3** `supabase/migration-072-vt-roster-read.sql`: `vt_roster_at(p_on date)` + partial index `agent_list_raw_vt_idx`
  + revoke (plan §DB-7.1). It must not touch `publish_agent_list` or `sync_*`. Acceptance: `verify-vt-db` roster cases;
  `verify-publish-agent-list` and `verify-agent-sync` unchanged.
- [ ] **C4** Guard first, then `worker/src/vt.mjs`: `GET /api/vt/book` (streams the RPC body, no JSON parse), `POST
  /api/vt/upload/{begin,stage,commit,abandon}` (args passed through; stage size cap 512 KB → 413; commit `version_conflict` →
  409), `GET /api/vt/uploads`, `GET /api/vt/roster`. All are staff + `canUpload`. Mount in `worker/src/index.mjs`. Add the
  routes to `GATED_WRITES`. Tests: `verify-vt-worker.mjs` (intake half), CPU timing. Acceptance: GREEN; no route parses a
  body > 64 KB.
- [ ] **C5** PULSE hooks (`nicks_code/index.html`, < 60 lines): `<script src="vt-engine.js" data-inline>`, and `detectType`
  calls `VTEngine.detect` FIRST (before the `bi` rule ≈2491). `ingestText` routes VT kinds to `vtIngest()` and returns early
  (no `INGEST`, no `regFile`, no `archiveUpload`, no Rake). Slots: add three Upload Station slots ("VT · BI Active Fitted",
  "VT · Scheduled & Missed", "VT · Opening book (once)") to `SLOT_TYPES`. Acceptance: `verify-upload-formats` (+ new VT
  cases: VT never `bi`, VAS BI still `bi`) green.
- [ ] **C6** `vtIngest()` (it lives in `vt-pages.js`, the station half): hash, then `GET book`, then `VTEngine.merge`, then
  begin/stage (≤ 1,000 rows per batch)/commit with base rev; on 409 re-read, re-merge, retry ≤ 3; persistent red banner on
  failure; receipt card + toast (FR-009); thin-pull refusal and quiet-day tick (FR-006). Then `VTEngine.model` → publish (wired
  in E2). Acceptance: `verify-vt-station.mjs` intake half (stubbed Worker).
- [ ] **C7** Roster: VT org per business month from `/api/vt/roster` (`vt_roster_at`), with a fallback to PULSE `S.roster` rows
  of campaign `VT` (sub = unknown) when the Worker is unreachable (file://). The fallback is flagged on the receipt. No change
  to `INGEST.roster`. Acceptance: unit cases in `verify-vt-station`.
- [ ] **C8** Ops (`Chatterbox_AgentOS_Analytics.html`) `detectSource`: VT signatures are refused with the spec US1-7 sentence.
  PULSE `rakeDetect` (≈8262) refuses them too. Acceptance: `verify-vt-isolation.mjs` (written first in this task) GREEN.
  `verify-ops-formulas` unchanged.
- [ ] **C9** `tools/prepare-site.js`: a generic `data-inline` inliner for `nicks_code/index.html` and `agent/index.html` that
  fails if a tagged file is missing. Guard `verify-vt-build.mjs` (written first). Acceptance: GREEN; build consistency passes.
- [ ] **C10** Optional opening book (US1, P3): `vtOpeningBook` kind → sale dates only (FR-003). Acceptance: the oracle runs
  with it: Current/Rollover split equals the report's Month column on reproducible rows.
- [ ] **C11** Register the C suites in `verify.yml`. Re-run the A0 baseline: VAS unchanged.

**Checkpoint C**: the three files load, the book persists in `vt_*` (test DB), VAS is byte-identical, and Ops refuses VT files.

---

## Phase D · Vehicle Tracking report pages in VAS Analytics (US5) · one builder

- [ ] **D0** Guard first: `verify-vt-pages.mjs` (Playwright, fictional fixtures + stubbed Worker). It checks the NAV group
  "Vehicle Tracking" with Month to date / Weekly / Daily, that `tabAllowed` refuses ungranted ids, that the filters (TL, sub,
  lead source) reach all three pages, that every spec §5 column is present with "—" for absent figures, that totals are ratios
  of sums, that Hrs Ahead shares sit beside the budgets, that "Unmatched sellers (n)" is one line, that Scheduling is listed
  "not rated in v1", and that export has one sheet per report equal to the screen. RED.
- [ ] **D1** PULSE hooks only (`nicks_code/index.html`, < 50 lines): NAV entries `vt_mtd`,`vt_weekly`,`vt_daily` (≈6531), a
  `PAGES` dispatch to `VTPages.render(id)`, `<script src="vt-pages.js" data-inline>`.
- [ ] **D2** `nicks_code/vt-pages.js` (report half): renders from `VTEngine.model` using PULSE's shell classes (same look as
  `campSection`/`aggCols`), `esc()` and `maskName()` on every string, and `exportVT(which)` via global `XLSX`
  (`aoa_to_sheet`). It never computes a figure itself (it reads model fields). It stays ≤ 800 lines.
- [ ] **D3** Upload Station VT receipts card (`ruleChecksCard` neighbour): the last 10 VT receipts from `/api/vt/uploads`.
- [ ] **D4** Register `verify-vt-pages`. Re-run `verify-render`, `verify-all-tabs` (fixture mode), `verify-upload-station-layout`.

**Checkpoint D**: managers can read VT MTD/Weekly/Daily and export them in VAS Analytics.

---

## Phase E · Digest, Worker portal, Agent Analytics VT card + TL/CM sections (US2, US3, US4) · one builder

- [ ] **E0** Guards first: `verify-vt-digest.mjs`, `verify-vt-portal.mjs`, `verify-vt-vas-golden.mjs` (golden captured from
  the PRE-E build on a fixed fixture), and extend `verify-agent-card.mjs` with a VT mode. RED.
- [ ] **E1** `vt-engine.js`: `digest(model)` and `emptyCyclePayload(cycleKey)` exactly as plan §P (drivers once, per-agent
  numbers only, `empty:true` with null figures).
- [ ] **E2** PULSE hook: after a VT commit, and on a VT page open when the book rev is newer than the last publish, POST
  `kv:vt-digest` + `kv:vt-digest-cycle-YYYY-MM` with the client fence (period = the SAST business month) and the save-ack/retry
  machinery. `tools/digest-republish.mjs`: a VT job (publishes the empty cycle at the 26th rollover; republishes after a tick).
- [ ] **E3** [P] `worker/src/cycle.mjs`: no change expected. If one is needed, it is a pure addition with a unit test (it is
  shared with the CM billing cycle; never change existing outputs).
- [ ] **E4** `worker/src/rules.mjs`: add `vt-digest(-cycle-\d{4}-\d{2})?` to `GUARDED_KV`, `liveVtDigestAllowed` (current SAST
  business month + rollover grace), and apply `emptyOverData` to the VT keys. Acceptance: `verify-digest-fence` unchanged +
  `verify-vt-digest` GREEN.
- [ ] **E5** `worker/src/vt.mjs` portal half + mounts in `index.mjs`: `loadVtDigest` (60 s isolate cache, `value.store` path),
  scopes via `authorise`-equivalent (agent own CB / TL codes / CM VT scope / staff), `/api/portal/vt/overview`,
  `/api/portal/vt/agent`, and `kind=vt-mtd|vt-weekly|vt-daily` on `/api/portal/tl/reports`. Strip `floor.unmatched.names` for
  portal scopes. `portal.mjs overview()`: a VT agent (roster campaign VT) → `{scorecard:'vt', me:<vt row>}` with no
  `checksFor`/`drillFor`. **`notReported` fix**: set it when the row is `!covered && why==='campaign'` and the agent is not a VT
  agent with a VT row (spec US2-5).
- [ ] **E6** `worker/src/campaign.mjs` (≈283–297, 332) and `portal.mjs` (≈518–524): keep `vt` in a CM's effective campaigns
  ONLY for VT cards built from the VT digest. VAS CM cards and the VAS rows are unchanged. Acceptance: `verify-cm-view`,
  `verify-cm-digest`, `verify-cm-signoff-worker` unchanged; `verify-vt-portal` CM cases GREEN.
- [ ] **E7** `agent/index.html` hooks (< 60 lines): `<script src="vt-view.js" data-inline>`, and a branch in
  `loadPortal`/`render` on `D.scorecard==='vt'`. The TL table paints VT rows instead of "Not reported" (≈5987).
  `reportsTabs` gains VT tabs for VT TLs/CMs.
- [ ] **E8** `agent/vt-view.js`: the VT card (score, band, 4 driver rows, points available, "How the score works" from
  `drivers[].note`, "Open my session brief", "Ask my team leader", scheduler message, no-data month), and the VT reports +
  `exportReports`-style .xlsx (`TL VT <report> - <team> - <period>.xlsx`). No rule literal (guarded). ≤ 800 lines.
- [ ] **E9** Acceptance: `verify-vt-portal`, `verify-vt-vas-golden` (byte-identical), `verify-agent-card` (VAS + VT),
  `verify-agent-portal`, `verify-agent-analytics`, `verify-tl-reports`, `verify-tl-past-months`, `verify-live-month-page`,
  `verify-empty-month` all GREEN.
- [ ] **E10** Register the E suites in `verify.yml`.

**Checkpoint E**: VT agents, TLs and the CM see VT figures. VAS agents are byte-identical.

---

## Phase F · Permissions, guards, health, database hygiene, docs · one builder

- [ ] **F1** `tools/audit-permissions.mjs`: read the VT NAV ids (`vt_mtd`,`vt_weekly`,`vt_daily`) from PULSE `NAV`, report
  MISSING/DEAD for them, and drop `tracker` as a known app (report stale `tabs.tracker` as DEAD-INERT). `verify-tab-guard` +
  `verify-server-grants` cases for the VT ids.
- [ ] **F2** `tools/upload-station-validate.mjs`: replace the stale "VT sheet has no Target column" finding (≈654) with a check
  that VT Target equals the cycle's SPD budget (warn on mismatch, A1). Add VT file checks (signatures, extract date, thin share).
- [ ] **F3** `worker/src/health.mjs`: alerts `vt-upload-gap` (no S&M or BI commit for > 1 working day while the floor works),
  `vt-staging-stuck` (a staging upload > 1 h), `vt-digest-stale` (VT book rev newer than the published digest by > 15 min),
  and `vt-budget-missing` (the live cycle has no budget row). The weekly slot calls `vt_trim()` and logs counts. `db_health`
  consumers include `vt_db_size()`. Tests: extend `verify-store-freshness` / a new `verify-vt-health.mjs` (pure logic). Alerts
  clear themselves.
- [ ] **F4** [P] `tools/vt-db-size.mjs` (read-only): rows/MB per `vt_*` table and month-on-month growth vs plan §DB-5, plus
  `--agent-list-raw` (rows by sheet, oldest as_of). Acceptance: runs against the test DB; prints PASS when growth ≤ 5 MB/cycle.
- [ ] **F5** [P] `specs/vt_engine_rules.json` `_changes[]`: record any value a builder had to adjust (with evidence). `verify-vt-rules` stays GREEN.
- [ ] **F6** [P] DB hygiene review (plan §DB-7.2): run `vt-db-size --agent-list-raw` against a test copy or a read-only
  query the owner runs. ONLY if `agent_list_raw` > 250k rows, write `supabase/migration-073-agent-list-raw-retention.sql`
  (90-day retention for non-roster sheets; roster sheets never trimmed; dry-run function first) + `verify-agent-list-raw-retention.mjs`
  (rolled back). Otherwise record "not needed (n rows)" in `deploy-checklist.md`. Never applied by a builder.
- [ ] **F7** Register the F suites in `verify.yml`. Final run: the A0 baseline list + every `verify-vt-*` + `verify-tracker-removed` +
  `verify-wimpy-removal` + `verify-wimpy-service-drift` + `verify-rule-constants` + `verify-save-acks` (Ops half on the generated site).
- [ ] **F8** Docs: CLAUDE.md (remove the `tracker/` row; add a `VT Analytics` row and one non-negotiable paragraph: VT rule
  book two copies + drift guard, its own tables, business-month fence, engine decides). Update the constitution only if a
  principle wording changes (it should not). `specs/071-…/deploy-checklist.md` final order: apply 071 → 072 (→ 073 if
  approved) → `vt-grant-tabs --apply` → `prepare-site` → deploy → `verify-cors-headers --live` + `verify-live-save --live` +
  `verify-vt-portal --live` smoke. **The owner says "deploy"; no builder runs any of it.**

**Checkpoint F**: permissions audited, health watching VT, database growth measured, docs current.

## Migrations by task
| Migration | Task | Content | Applied by |
|---|---|---|---|
| `migration-071-vt-facts.sql` | C2 | `vt_cases`, `vt_case_events`, `vt_uploads`, `vt_upload_stage`, `vt_book_rev`, RPCs, trim, size, RLS, revokes | owner, at deploy |
| `migration-072-vt-roster-read.sql` | C3 | `vt_roster_at()` + partial index on `agent_list_raw` | owner, at deploy |
| `migration-073-agent-list-raw-retention.sql` | F6 (conditional) | retention for non-roster sheets of `agent_list_raw` | owner, only if F6 shows the need |

(Numbers assume 070 is the latest today. Re-check `supabase/` before creating, and renumber if another migration has landed.)
