# Implementation plan — Spec 039 Sales vs QA coverage

Planned 2026-10-28 with the agent-skills `planning-and-task-breakdown` method and an ECC `code-explorer` read of the QA tool (`budgetbloomers/qa-ops`, cloned read-only to `../qa-ops-src`). Tasks: `tasks.md`.

## Shape

```
AgentOS (Supabase A)                                   QA tool (Supabase B, Next.js on Vercel)
───────────────────                                    ────────────────────────────────────────
Upload Station ─▶ BI Active Cases ─▶ lake: bi_active_cases
                                         │
          tick: lake-load ─▶ qa-sales-sync (NEW) ──upsert changed days──▶ agent_sales_daily (NEW, 08_*.sql)
                                         │                               sales_sync_runs  (NEW: freshness)
                                         └ Agent List history (campaign + name per day)          │
                                                                                                  ▼
                                                     evaluations (existing) ─▶ /api/sales-coverage (NEW, Jared-only, server)
                                                                                                  │
                                                                              /sales-coverage page (NEW, Jared-only nav)
```

## Architecture decisions

1. **Push, not pull.** AgentOS pushes per-agent-per-day sales into the QA tool's own database. The QA tool stays self-contained (one database, its own login), and AgentOS's database is never exposed to it. The push uses the QA project's service-role key, kept in a git-ignored `qa-ops.env` on the tick machine only — never in the AgentOS repo, the Worker or a browser.
2. **Grain = one row per agent per day** — `(cb, sale_date)` with `sales` (made), `cancellations` (by cancellation day, from `sf_inactive`), `campaign_key`, `agent_name`, `synced_at`; net = made − cancellations over the range (Nick, D1: show both). Small (≈ 130 agents × 30 days ≈ 4,000 rows a month), so the tab sums it in a single query for any range.
3. **Sales = distinct BI case numbers by contract create date** (one case = one sale — the AgentOS money model's grain), before cancellations (D1). Source table `bi_active_cases`, the same lake the rest of AgentOS reads.
4. **Delta by day, like lake-load.** Each run compares per-day (count, sum) signatures between the lake and `agent_sales_daily` and sends only changed days; a full backfill is `--days 120`. A day that disappears from BI (a corrected re-upload) is zeroed, never left stale.
5. **Identity = CB, normalised to the QA tool's `CB-123`** in the sync (one place). Rows whose CB is blank are not sent and are counted in the run log (Panimax today). In the QA tool the join is on CB; evaluations with a blank CB fall back to the agent NAME (the Dashboard's own key) and are reported as "matched by name".
6. **Campaign mapped once, in the sync:** Cuddle → `matrix_cuddle`, Courtesy → `matrix_courtesy`, VT → `matrix_tracker`, Training Gr … / Nesting → `sales_lab`, Download & Test → `download_test_upsell`; the campaign is the one the Agent List carried for that agent ON THAT DAY (movers are attributed per day). An unmapped campaign fails the run loudly rather than inventing a key.
7. **Jared-only is enforced on the server.** A new grant flag `salesCoverage` on Jared's entry in `grants.ts` and a predicate `canViewSalesCoverage`. The new route `/api/sales-coverage` returns 403 for everyone else; the sidebar item and a client redirect only hide the door. The table is NOT added to the generic `/api/data/[table]` registry (it lets any signed-in user read).
8. **One definition of score and count.** The route reuses the Dashboard's `calcAvgScore` and its qualifying filter (D5) so "QA score" on this tab can never disagree with the Dashboard for the same agent and range. Coverage = qualifying evaluations ÷ sales, shown to one decimal; above 100% is shown and flagged (evaluations can cover sales from before the range), never capped silently.
9. **Pure logic, tested.** The join / coverage / totals / sort live in `src/lib/eval-coverage.ts` (vitest), the sync's aggregation in a pure exported function (node suite) — the UI and the route only call them.

## Phases

- **Phase 0 — decide and reconcile (no code).** Nick answers D1–D6. Reconcile the lake's BI with what Nick expects for one agent and one window (VAS shows sales net of cancellation per campaign segment; this tab shows sales made per agent) and confirm whether VT sales are in the BI file (D2).
- **Phase 1 — the data path.** QA migration `08_agent_sales_daily.sql` → AgentOS `tools/qa-sales-sync.mjs` (dry run first) → tick step after lake-load with a health alert on failure. Checkpoint: QA-side totals equal the lake's for a window, to the case.
- **Phase 2 — the tab.** Grant flag + predicate + tests → server route + pure join lib + tests → page (shared filter bar extracted from the Dashboard, sortable table, totals, freshness line, SLA colouring once D3 lands). Checkpoint: `npm run check` + build green; Jared sees it, a non-Jared account gets 403 from the route.
- **Phase 3 — release.** Apply 08 in the QA project's SQL editor, put the key in `qa-ops.env`, backfill, deploy qa-ops (Vercel CLI — Hobby blocks non-owner commit authors, see the Coaching Hub note), smoke as Jared and as one other user, hand over to Jared.

## Agents and skills per phase

| Phase | Skills (agent-skills) | ECC agents |
|---|---|---|
| 0 | `interview-me` / `spec-driven-development` for D1–D6 | — |
| 1 | `source-driven-development`, `test-driven-development`, `security-and-hardening` | `ecc:database-reviewer` (08 migration), `ecc:security-reviewer` (service key handling) |
| 2 | `incremental-implementation`, `frontend-ui-engineering`, `test-driven-development` | `ecc:typescript-reviewer`, `ecc:react-reviewer`, `ecc:security-reviewer` (route gate) |
| 3 | `shipping-and-launch`, `browser-testing-with-devtools` | `ecc:e2e-runner` (Jared vs non-Jared walk) |

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| The BI lake and VAS disagree on a day (seen 28 Oct: per-day shapes differ, VT included in one and not the other) | High — Jared quotes a number Nick does not recognise | Phase 0 reconciliation; the page states the definition ("sales made, BI Active Cases, before cancellations"); acceptance test: synced total = lake total for the window |
| Any signed-in QA user could read sales via the generic API | High (POPIA, payroll-adjacent) | Dedicated route + grant; table not in `TABLES`; RLS on + revoked from anon/authenticated (06_hardening default) |
| Service-role key of the QA project leaks | High | Only in git-ignored `qa-ops.env` on the tick machine; never logged; rotate if pasted anywhere |
| CB mismatch (`CB123` vs `CB-123`, blank CBs) | Medium — agents show 0 sales or 0 evaluations | Normalise once in the sync; name fallback for blank CBs, counted and shown |
| VT sales not in BI (D2) | Medium — VT reads 0% | Show "sales not in BI" instead of 0%; separate VT source later |
| The tick machine is a laptop (best effort) | Medium — sales go stale | Freshness line on the page + the existing scheduled-step health alert |
| QA-tool deploy path (Vercel Hobby author rule) | Low | Deploy via CLI as in spec 033 |

## Open questions

D1–D6 in `spec.md`, plus: who holds access to the QA tool's Supabase project (to apply 08 and copy the service key)?
