# Research: Product demo screenshots

Two read-only maps of the apps (2026-10-06). Line numbers are into `nicks_code/index.html` (IH) and `agent/index.html` (AI).

## R1 — VAS Analytics (PULSE)

- **Pages, nav order** (IH:6126-6155; switch with `window.__mtd.go(id)`): dashboard, mtd, weekly, daily, attend
  (Workforce), variance, leads, agents, leaderboard, coaching, manual, data (Upload Station), adjust, hubs (Apps),
  settings. Sub-tabs are `S.ui` keys + `renderPage()`: `mtdSub` (each campaign, 'Team Leaders'), `wtdCamp`,
  `varSub` (summary|daily|unmapped|rules), `lbMetric` (gwp|sales|pctT|spd|qa|score), agent drawer `__mtd.openDrawer(cb)`.
- **State** (all through `rebuild()`): `roster`, `att {d:{cb:status}}`, `calls {d:{cb:{talk,calls,ans,opt,saleD,v:1}}}`,
  `sales {d:{cb:{n,gwp,x,canc,u:'case',a:{case:exVat}}}}`, `evals {d:{cb:[{s,rid,f,dec,cat,pri,camp,dsp,dspSt,st}]}}`,
  `cancRows`, `board` (Manual Stats → Variance), `opencasesLM`, `closedcases`, `refs`, `adjust`, `coach`, `orgHist`
  (via `recordOrgList`), `files` (Upload Station slots), `rosterEffect`. Courtesy is excluded from Lead Management.
- **Decision**: build the whole state in Node, assign it into `window.__mtd.state()`, `rebuild()`, `setPeriod('2026-09')`.
  `freshState()` seeds REAL names (DEFAULTS.roster) — the demo always overwrites the roster.
- **Banners**: serve `nicks_code/index.html` (not `site/pulse` — its stale-version banner), no `cbx_token` (every Worker
  sync is skipped), pin the clock (Data Trust bar is green only when files are < 7 days old), stub `__cloudPush`, hide
  `#toast`. The four ungated fetches (`/api/coaching/summary`, `/api/coaching?cb=`, `/api/ask`,
  `/api/upload/large/status`) get fictional answers.
- **Digest**: `window.__mtd.digest()` (IH:9475) and `__mtd.reports('variance'|'leads')` build exactly what PULSE would
  publish — Agent Analytics is fed from these, so both apps show the same figures.

## R2 — Agent Analytics

- **Boot**: token in `sessionStorage.cbx_agent_token` → `GET /api/portal/me` → `GET /api/portal/overview`; scope decides
  the view (campaign → CM, team → TL, else the agent). Cross-origin: every answer carries CORS headers, OPTIONS → 204.
- **Views** (`navFor` AI:3995): agent — month, calc, progress, links (+ coaching); team leader — team, help, kpihub,
  coach_team, results, reports (mtd_team, daily_team, weekly_team, variance_team, leads_team), nik_team, forms; campaign
  manager — cm, cm_teams, cm_assist, cm_reports (cm_mtd, cm_daily, cm_weekly, cm_variance, cm_leads), cm_nik, cm_set,
  cm_coach. Switch with `VIEW='x'; render()` or the nav item `[data-view]`.
- **Routes → Worker**: overview/agent → `portal.mjs` (needs `kv:agent-digest`, `kv:coaching`, `kv:nba-digest`,
  `kv:agent-links`); tl/reports → `kv:agent-reports-variance|leads`; hub/coaching(+drafts) → `hubs.mjs`/`drafts.mjs`
  (Convex); hub/kpi → Convex; help/* → `help.mjs` (HighLevel); cm/* → `campaign.mjs`/`assist.mjs` (HighLevel);
  cm-coaching → `portal.cmCoaching`; ask → Workers AI.
- **Decision**: answer each route by calling the real Worker function in Node over an in-memory DB, with
  `globalThis.fetch` answering Convex and HighLevel from fictional stores (patterns: verify-coaching-drafts,
  verify-help-repeat, verify-campaign-manager). `ask` is answered directly (needs `env.AI`).
- **Clean shots**: `page.clock` pinned; `window.__agentToday='2026-09-29'`; animations off by injected CSS; identical
  payloads on refresh timers; viewport > 860 px so the sidebar stays.

## R3 — Leak check

- Fictional names were checked against `../Matrix - Agent List.xlsx`: 0 full-name matches; real CB numbers end at CB413,
  so the demo uses CB9101+.
