# Tasks — Spec 039 Sales vs QA coverage

Repos: **A** = AgentOS (`agentos/`), **Q** = QA tool (`budgetbloomers/qa-ops`). Checks: A → `node nicks_code/diagnostics/<suite>.mjs`; Q → `npm run check` (typecheck + lint + vitest) and `npm run build`.

## Phase 0 — decide and reconcile

### T0 · Nick's decisions D1–D6 recorded — XS
- [x] D1 both (made + net), D3 no target yet, D4 date of call, D6 current TL — recorded in spec.md 28 Oct
- [ ] D5 confirmed (default: the QA score's own evaluation set) · D2 answered by T1
- **Depends on:** none · **Files:** `specs/039-qa-sales-coverage/spec.md`

### T1 · Reconcile the sales number for one window — S
- [ ] For 25 Sep – 26 Oct: per agent, lake BI cases (sales made) vs the VAS engine (net, per campaign segment); every difference explained (cancellations, VT, Panimax, segments)
- [ ] Whether VT sales are present in the BI file (D2), with the evidence
- **Verify:** a short note in this folder Nick can read in two minutes · **Depends on:** T0 (D1) · **Files:** `specs/039-qa-sales-coverage/reconcile.md`

### Checkpoint 0 — Nick approves the definitions before any code

## Phase 1 — the data path

### T2 · QA migration `08_agent_sales_daily.sql` — S (Q)
- [ ] `agent_sales_daily (cb text, sale_date date, sales int not null, cancellations int not null default 0, campaign_key text not null, agent_name text, synced_at timestamptz)`, primary key `(cb, sale_date)`, index on `sale_date` (D1: both sales made and net)
- [ ] `sales_sync_runs (id, ran_at, from_day, to_day, days_sent, rows_upserted, max_sale_date, note)`
- [ ] RLS enabled, no policies; revoked from anon/authenticated (06_hardening posture); re-runnable
- **Verify:** applied to a scratch copy / local Postgres; `ecc:database-reviewer` pass · **Depends on:** Checkpoint 0 · **Files:** `supabase/08_agent_sales_daily.sql`, `supabase/README.md`

### T3 · AgentOS `tools/qa-sales-sync.mjs` — M (A)
- [ ] Pure `salesByAgentDay(bi, cancellations, listHistory)` → `{cb:'CB-123', sale_date, sales, cancellations, campaign_key, agent_name}`; sales = distinct BI cases by contract create date; cancellations = `sf_inactive` cases by deactivate date (the VAS rule); CB normalised; campaign from the Agent List in force that day; unmapped campaign = loud failure
- [ ] Per-day signature delta against `agent_sales_daily`; changed days upserted, vanished days zeroed; `--dry`, `--days N`, `--from/--to`
- [ ] Writes one `sales_sync_runs` row; reads `qa-ops.env` (git-ignored, added to `.gitignore`); never prints the key
- **Verify:** `verify-qa-sales-sync.mjs` (fixtures: CB formats, movers, blank CB, unmapped campaign, re-upload shrink); dry run against live lake prints totals equal to the lake for the window · **Depends on:** T2 · **Files:** `tools/qa-sales-sync.mjs`, `nicks_code/diagnostics/verify-qa-sales-sync.mjs`, `.gitignore`

### T4 · Tick step `qa-sales-sync` after lake-load — S (A)
- [ ] `tools/tick-local.mjs` runs it after lake-load and stamps it (job-status), so a failure raises the existing scheduled-step health alert
- **Verify:** `verify-tick-014.mjs` + `verify-health-loud.mjs` green; one tick runs it · **Depends on:** T3 · **Files:** `tools/tick-local.mjs`, `nicks_code/diagnostics/verify-tick-014.mjs`

### Checkpoint 1 — QA-side Σ sales for 25 Sep – 26 Oct equals the lake to the case; `ecc:security-reviewer` on the key handling

## Phase 2 — the tab (Q)

### T5 · Jared-only grant — S
- [ ] `salesCoverage: true` on Jared's GRANTS entry only; `Grant` type + `mergedGrant`; `canViewSalesCoverage(user)` in `permissions.ts`
- [ ] `permissions.test.ts`: Jared true; every other GRANTS entry (incl. fullAccess users) false
- **Verify:** `npm run check` · **Depends on:** none (parallel with Phase 1) · **Files:** `src/lib/auth/grants.ts`, `src/lib/auth/permissions.ts`, `src/lib/auth/permissions.test.ts`

### T6 · Pure join + route `/api/sales-coverage` — M
- [ ] `src/lib/eval-coverage.ts`: join on CB (name fallback for blank CB), D4 date, D5 qualifying set, `calcAvgScore` reused, coverage %, totals, sort comparator; agents with sales-only and evaluations-only both appear
- [ ] Route: `requireSession` → `forbidden()` unless `canViewSalesCoverage`; params tl[], campaign, from, to; reads `agent_sales_daily` + `evaluations` + roster via `supabaseAdmin`; tolerates a missing table (MISSING_RELATION) with a clear message; returns freshness from `sales_sync_runs`
- **Verify:** `eval-coverage.test.ts` (coverage maths, >100% flagged, 0 sales, blank CB, score parity with the Dashboard on a fixture); `npm run check` · **Depends on:** T2, T5 · **Files:** `src/lib/eval-coverage.ts`, `src/lib/eval-coverage.test.ts`, `src/app/api/sales-coverage/route.ts`

### T7 · The page and its nav — M
- [ ] Dashboard filter bar extracted to a shared component (Dashboard behaviour unchanged) and reused: TL multi-select, campaign, date range
- [ ] Table: Agent name · Sales made · Net sales · QA evaluations · % of sales made evaluated · % of net sales evaluated · QA score; every header sorts asc/desc (`useSort` + chevrons); totals row; freshness line
- [ ] No SLA colours (D3: Jared sets the target after seeing the current rate); a strip above the table shows the current operating % for whatever the filters select, so the target can be chosen from evidence
- [ ] Sidebar item "Sales vs QA" only when `canViewSalesCoverage`; client redirect for anyone else
- **Verify:** `npm run check` + `npm run build`; manual: sort each column both ways, each filter narrows the rows and the totals · **Depends on:** T6 · **Files:** `src/app/(protected)/sales-coverage/page.tsx`, `src/components/filters/FilterBar.tsx`, `src/app/(protected)/dashboard/page.tsx`, `src/components/layout/Sidebar.tsx`, `src/lib/use-sort.ts`

### Checkpoint 2 — `ecc:typescript-reviewer` + `ecc:react-reviewer` + `ecc:security-reviewer`; route returns 403 for a non-Jared session

## Phase 3 — release

### T8 · Go live — S
- [ ] 08 applied in the QA project's SQL editor; `qa-ops.env` on the tick machine; backfill `--days 120`; deploy qa-ops via Vercel CLI
- [ ] Smoke: Jared sees the tab with numbers matching T1; a fullAccess non-Jared account sees no tab and gets 403 from the route
- **Depends on:** Checkpoints 1–2 + Nick's "deploy" · **Files:** none new

### T9 · Handover — XS
- [ ] One-page note for Jared (what each column means, the definitions D1/D4/D5, freshness); AgentOS memory note
- **Depends on:** T8

---

## Build log — 2026-10-28 ("build it")

- [x] **T1 reconcile** — the lake's `bi_active_cases` is NOT usable as the source: it held nothing for 20–25 Oct (batches jump from 19 Oct to 26 Oct), it counts uncased feature lines, and cancellations there are keyed by owner name. The sales therefore come from the **VAS engine's own books** (`digest-republish --qa-sales`, local only): net = the engine's `n` (exactly VAS), made = net + cases created that day that later cancelled (`S.cancRows`). 25 Sep – 26 Oct: Cuddle 5,153 · Courtesy 4,472 · Training Gr 17 62 net — **equal to VAS to the case**; CB19 269 = VAS. **D2 answered: VT sales ARE in BI** — VT 2,010 net / 2,125 made, 44 agents. 24 owners on no Agent List (Panimax partners, 376 sales) are counted and not sent.
- [x] **T2** `qa-ops/supabase/08_agent_sales_daily.sql` — columns are `sales_made` and `sales_net` (not sales/cancellations); applied twice in PGlite, constraints refuse net > made / negatives / no campaign; RLS on, no anon/authenticated grants.
- [x] **T3** `agentos/tools/qa-sales-sync.mjs` + `verify-qa-sales-sync.mjs` (12 ok); dry run 25 Sep – 26 Oct = 12,384 made · 11,697 net · 116 agents.
- [x] **T4** tick step `qa-sales-sync` after lake-load; SKIPPED (green) until `qa-ops.env` exists. verify-tick-014 128 ok, verify-health-loud 30 ok.
- [x] **T5** `salesCoverage` grant (Jared only) + `canViewSalesCoverage` + tests (fullAccess admins refused).
- [x] **T6** `src/lib/eval-coverage.ts` (+11 tests) + `/api/sales-coverage` (Jared-only, not in the generic data registry). Evaluations are joined in the browser from the Dashboard's own cache, so TL / campaign / QA score are the Dashboard's.
- [x] **T7** `/sales-coverage` page + sidebar item. The Dashboard was NOT modified (its filter bar is mirrored, not extracted — lower risk).
- QA tool: `npm run check` (typecheck, lint 0 warnings, 66 tests) and `npm run build` green; commit f5b8eb8 on `feat/sales-coverage` (local). AgentOS: 84f5400, 914b6d7.
- [ ] **T8 go live** — needs: the QA project's Supabase access (apply 08 in its SQL editor; its URL + service-role key into `agentos/qa-ops.env` as QA_SUPABASE_URL / QA_SUPABASE_SERVICE_KEY), a push of the branch, and Nick's "deploy" for the Vercel deploy.
