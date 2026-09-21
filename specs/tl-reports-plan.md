# Team-leader Variance + Lead management tabs (2026-09-21)

Nick: "bring variance report and lead management report to team leader view and map it out just for that
team leader." Planned by ecc:planner, verified by ecc:architect (GO WITH CHANGES — 13 corrections, all
applied), executed and guarded the same day.

Doctrine, as everywhere in the suite: PULSE computes, publishes; the Worker slices by authorise(); the page
paints. Nothing is computed in the Worker (free plan, 10 ms CPU) and nothing is re-derived on the page.

- PULSE publishes two SIBLING keys beside the digest from the same 90-s publisher with their own
  fingerprints: `kv:agent-reports-variance` (positional rows under `cols`, one per non-VT agent-day —
  ~186 KB) and `kv:agent-reports-leads` (per-agent funnel + per-team unions — ~25 KB). The digest is
  untouched (309 KB). Both built by the pages' own engines: `buildVariance` and `leadBook(true)` +
  `leadFunnel` (the funnel arithmetic extracted ONCE from PAGES.leads; its export csv reads it too).
  Row status (`st`), GWP-per-sale (`gps`) and every conversion verdict travel as published values.
  Never travels: names, leaders, unmapped owners, comments, raw attendance strings, case numbers.
- Live keys must be a WHOLE month (from the 1st AND to the last day) — an as-at capped tab publishes
  nothing (found the same day: a 1–14 Sep tab had shrunk everyone's month).
- Worker: `GET /api/portal/tl/reports?kind=variance|leads` (PORTAL_ALLOWED) → `tlReports()`: agents
  sliced to `auth.codes`, `teams[auth.team]` only (staff: all), 403 agents, 404 when
  unpublished; month fence + cache drop cover the new keys. Campaign managers (2026-09-21 PM):
  agents of `auth.campaigns` + `teamsByCamp` ("<campaign>|<team leader>") + `campaigns` for those
  campaigns only, matched through `campKey`; never the leader-only `teams` blocks.
- Page: REPORT_TABS Variance / Lead management; `REP` loader on tab entry, LIVE timer, focus, Refresh;
  403/404 → a card, never a sign-out; per-tab Published stamp; .xlsx export with the on-screen columns;
  Export all = 5 sheets.
- Guards: `verify-tl-reports.mjs` (35: Worker slice, payload ≡ engine over the live state — all 1,340
  rows — leads ≡ page export, sizes, page render + export), `verify-agent-analytics` (142),
  `verify-agent-portal` (86). `tools/digest-republish.mjs --apply` now also writes both keys.
- Open questions for Nick: board-less days show a note (not hidden); VT teams are not reported by
  either engine; ageing bands are not a PULSE measure today (needs a dated rule) — not shipped; root-cause
  classification stays management-only (read-only on the tab).

## Campaign-manager Reports sub-tabs (2026-09-21 PM)

Nick: "the lead management and variance needs to be in reporting as sub … with the correct data showing".
- PULSE: both payloads also carry `teamsByCamp` and `campaigns` blocks (same block arithmetic as `teams`,
  grouped by the Agent List campaign of each agent-day / agent).
- Page: CM nav gains **Reports** → sub-tabs `cm_variance` / `cm_leads` (`CM_REPORT_TABS`, `LAST_CM_REPORT`
  remembers the last one). `pageCmReport()` paints one leader × campaign row per block
  (`cmVarianceTable` / `cmLeadsTable`), the campaign total (`repCmTotal`) and the agent tables scoped
  by `repAgents()` to `cmCamp().agentIndex`. Export names the workbook after the campaign.
- Reports wiring is ONE `wireReports()` (sub-tab pills, day pickers, load-on-entry, Refresh, Export) called
  by teamView and cmView — the CM tab first shipped stuck on "Loading the published report…" because
  only teamView asked the Worker.
- Guard: `verify-tl-reports.mjs` 39 (CM Worker slice with `teamsByCamp`/`campaigns` fixtures, `tcAgree` /
  `campAgree` payload ≡ engine, CM render + export). Live walk as Dalwin (CB145): 6 leader × campaign
  blocks, 67 agents, Courtesy + Cuddle totals = Campaign tab sales.
