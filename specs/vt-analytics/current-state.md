# Vehicle Tracking Analytics — current state (Phase 0, read-only research)

Date: 2026-11-23. Scope: inventory of everything "Vehicle Tracking" (VT) today, plus a map of the VAS pipeline to use as the template for the new module. Nothing in the application was changed. Line numbers are from the working tree on this date. Recheck them before you edit, because the files move every day.

Companion file: `workbook-rules.md` in this folder (being written separately). This file does not cover the VT workbook rules.

## 0. File sizes (line counts, 2026-11-23)

| File | Lines | Role |
|---|---|---|
| `nicks_code/index.html` (PULSE / VAS Analytics) | **11,107** | Upload Station, MTD engine, reports, digest publisher |
| `agent/index.html` (Agent Analytics) | **8,630** | agent / TL / CM views, Reports tab, .xlsx export |
| `Chatterbox_AgentOS_Analytics.html` (Ops) | **6,188** | Ops dashboard |
| `worker/src/index.mjs` | 2,668 | Worker router |
| `worker/src/portal.mjs` | 1,184 | portal scopes (agent/team/campaign) |
| `worker/src/campaign.mjs` | 905 | campaign-manager context |
| `worker/src/rules.mjs` | 152 | digest fence, KV write gate, upload gate |
| `tracker/index.html` (Tracker Analytics) | 939 | Matrix EOD tracker + VT tab host |
| `tracker/vt-mtd-report.html` | 1,048 | the old "VT MTD Report" |
| `tools/prepare-site.js` | 299 | site build |

All three main apps are already far past the 800-line soft ceiling in the user's coding rules. They are allowed exceptions because each must be a single file that runs from `file://` (CLAUDE.md non-negotiable 12, "the app must run from `file://`"). Any new module should not make PULSE bigger than it has to be (see §3).

---

## JOB 1 — Inventory of the old Vehicle Tracking

### Key finding

VT is **not** a module inside VAS today. It appears in three forms:

1. **The "Tracker Analytics" app** (`/tracker/`, app grant `tracker`). It has a manual end-of-day tracker and an embedded **"VT MTD Report"** tab. The VT MTD Report is a mock-up seeded with July 2026 figures. Its uploads only *register* files, and its state lives only in the browser's `localStorage`.
2. **The VT campaign in the shared roster.** The Agent List's "VT" sheet produces roster rows labelled `VT` ("Matrix Tracker"). These rows flow through PULSE, the SQL `publish_agent_list()`, `sync_agent_list()`, Ops, the Worker portal and the Coaching Hub. VT agents get accounts, Agent Analytics logins and team-leader attribution like everyone else.
3. **Exclusion logic.** Dozens of places deliberately keep VT *out* of the VAS money, MTD and campaign figures, and some of those are guarded by tests.

Watch for name clashes: "tracker" means three different things in this codebase.
- **Tracker Analytics** (`/tracker/`) — the old VT/EOD app. This is a removal candidate.
- **The hand-built VAS MTD tracker**: PULSE's `trackerDaily` upload type, the `S.tracker` store, `STORE_KEY='vas_mtd_tracker_v1'`, the generated tracker workbook and `verify-generator.mjs`. **This is VAS and must stay.**
- **"Referral tracker"**, the HighLevel referrals source in Ops (`REFERRALS` at Ops line 551). This is VAS and must stay.

The other search terms do **not** mean VT:
- **Download & Test / `EXP_DOWNUP`** is a VAS campaign (the R40 product). See PULSE `COMM_RULES.saleValues.EXP_DOWNUP` (10077), `commPlanOf` (10180–10190), `PLAN_LAB` in `agent/index.html` 8385, and `qa-sales-sync.mjs` 45. Keep it.
- **"Referral" / "Predictive" / "Digital"** appear in VT only as *queue names* on the VT sheet ("Scheduling / Matrix Digital / Panimax Referrals / Panimax Predictive", PULSE 3194–3199). They also appear as VT MTD seed fields (`predictive`, `referrals`). VAS referrals (HighLevel) are a separate feature. Keep them.
- **"Panimax"** is a name-suffix strip in identity matching (`normName` 1038, `nameTokens` 1043, `ownerKey` in `qa-sales-sync.mjs` 102, rule book `mtd_engine_rules.json` 336, migration-038 queue owners). It is shared by every campaign. Keep it.

### 1A. Tracker Analytics app (`tracker/`)

| # | Item | Location | What it does | Data read/written | Who sees it | Depends on it |
|---|---|---|---|---|---|---|
| T1 | Tracker Analytics shell | `tracker/index.html` 1–939 | Three tabs: **Input** (manual EOD capture), **Daily Tracker** (one row per date: Employed / Present HC, Afrilead / JAG / VT sales, Avg GWP, agents to target, Attendance %, SPD), **VT MTD Report** (an iframe, 405–407, lazy `src` at 643). Has an "Ask AgentOS" widget (896–906, `digestKey:"ai-digest-tracker"`). | `GET/POST /api/eod` → table `daily_eod`. KV fallback `kv:tracker-eod` (418, 483–501). Polls every 4 minutes. | App grant `tracker`. `auth-gate.js` maps `/tracker` to `APP='tracker'` (site/auth-gate.js 6, 324–325). Users with `apps` containing `tracker` and `tabs.tracker`. | Nothing in VAS or Ops reads its data. The Worker's AI answer reads `daily_eod` (see W2). |
| T2 | VT MTD Report | `tracker/vt-mtd-report.html` 1–1048 | A self-contained "Vehicle Tracking — MTD Report". It holds **hard-coded July 2026 seed data** (`SEED`, 474–521: projection, schedulers, Afri/JAG lead rows, a per-case detail list). It has two upload slots, (1) Salesforce "Scheduled & Missed" and (2) two scheduler paste slots. Per its own comment (469–471), the uploads "register files only — ingestion rules are next build". It shows a "Wiring plan — rules & formulae to build next" panel. CSV export (`exportReport`, 945). | `localStorage` only: `vtmtd.projInputs`, `vtmtd.uploads`, `vtmtd.month` (522). **No server persistence.** | Anyone who can open `/tracker/`. | Nothing. |
| T3 | Build step | `tools/prepare-site.js` 245, 252 (copies `tracker` → `/tracker/`), 263–269 (`VT_REL` copies `vt-mtd-report.html`), 280 (the stale-guard shell list includes `tracker/index.html`) | Publishes the app | — | — | Site build. Removing the app means removing these lines too. |
| T4 | Cache header note | `site/_headers` line 4 (a comment about `/tracker/vt-mtd-report.html`) | Cache-control | — | — | — |
| T5 | `daily_eod` table | `supabase/migration-004-daily-eod.sql` (columns `eod_date` PK, `employed`, `present`, `afrilead`, `jag`, `vt`, `gwp`, `target`, `updated_by`). Listed in `schema.sql` 9 and in migration-006's survivor list (40). | Storage for T1 | Rows | Worker service key only (RLS on, no policies) | Worker routes W1 and W2. |

**PII surprise:** the T2 seed embeds real first names (schedulers "Chireshi" and "Vanessa", and agent first names with case numbers in `SEED.detail`). These ship to `/tracker/vt-mtd-report.html` on every deploy. That is one more reason to retire it.

**Is the EOD tracker (T1 Input/Daily) VT?** Only partly. It captures *Afrilead, JAG and VT sales* for the whole "Matrix EOD" floor. Those are VT lead sources (Afri leads, JAG leads), so in practice it is a VT-floor daily sheet. It is still a manual capture that someone may be using today. I can't see who without querying `app_users` or `daily_eod`; I did not run any database query.

### 1B. Worker

| # | Item | Location | What it does | Shared? |
|---|---|---|---|---|
| W1 | `/api/eod` GET/POST | `worker/src/index.mjs` 2354–2380 (comment: "LOAD-BEARING 503", which `tracker/index.html` relies on to fall back to KV) | reads and upserts `daily_eod` | T1 only |
| W2 | AI context: Tracker | `index.mjs` 61 (the system prompt names three apps: "Ops / VAS / Tracker"), 72 (the TRACKER ANALYTICS description), 2545 (`ai-digest-tracker` key), 2555–2566 (pulls the last 60 `daily_eod` rows into the AI prompt), 2646 | Ask AgentOS covers Tracker | Prompt text must change if T1 goes |
| W3 | `GATED_WRITES` includes `POST /api/eod` | `index.mjs` 756 | write gate | T1 only |
| W4 | `MANAGEMENT_APPS = {'ops','vas','tracker'}` | `index.mjs` 536–539 | a user with `tracker` counts as a manager (not portal-only) | **Shared semantics**: removing `tracker` changes who counts as a manager, but only for accounts whose ONLY management app is `tracker`. Decision needed. |
| W5 | Portal blocks `/api/eod` | `portal.mjs` 38 (comment) and the portal allow-list; `verify-agent-portal.mjs` 189, 310; `verify-agent-analytics.mjs` 451 | agents can never reach it | Guard text only |
| W6 | Usage app `tracker` | `worker/src/usage.mjs` 18, 32; `migration-061-usage-events.sql` 34 (CHECK constraint allows `'tracker'`) | usage report counts Tracker opens | History. **Keep** the constraint (never edit an applied migration). |
| W7 | VT never makes a CM screen | `campaign.mjs` 283–297 (`effectiveCamps` drops `vt`), 332 (`key === 'vt'` skipped); `portal.mjs` 518–524 | campaign managers never get a VT card, because VT carries no digest rows | **Shared**. This must CHANGE (not be removed) when VT gets real figures. |
| W8 | VT agents stay scoped to their TL | `portal.mjs` 436–440 (`notCovered` roster entries, "a VT agent on a team leader's list must still be listed as theirs") | the TL view lists VT agents with no numbers | **Shared, must stay** |
| W9 | `vas-summary.mjs` 58 (`V.tracker`) | the VAS MTD tracker store, NOT VT | — | VAS, keep |

### 1C. PULSE (`nicks_code/index.html`)

| # | Item | Lines | What it does | Classification |
|---|---|---|---|---|
| P1 | `campOf` folds `track|vehicle|vision|^vt$` → `'VT'` | 961–966; `KNOWN_CAMP` 982 | campaign vocabulary | **Shared** (roster classifier) |
| P2 | VT sheet fold: a row on a sheet named VT / Tracker / Vehicle IS VT, whatever its queue cell says | 3194–3213 (`vtSheet`) | roster ingest | **Shared**. Mirrored in SQL `campaign_label` (migration-020 47–66, superseded by migration-050 16–36) |
| P3 | Roster ingest replaces only the campaigns a sheet covers (a VAS sheet never wipes VT) | 2153, 3242–3261, 3302, 3394; file-wide prune 2575–2584 | roster safety | **Shared, must stay** |
| P4 | `CAMPS = MTD_RULES.reportedCampaigns` (VT not reported); `carried.delete('VT')` | 987–1031 | report campaign list | **Shared**. VAS reports must keep excluding VT |
| P5 | Labels and colours: `CAMPLAB.VT='Matrix Tracker'` 1037; `--vt` colour 36/54; `CAMPC.VT` 5493 | — | display | Shared, harmless |
| P6 | `actualShiftsFrom.VT:'register'` | 604 (in `MTD_RULES`) | the shift rule for VT if it were reported | Shared rule-book entry (drift-checked). Leave it, or move it to the new module's rule book later |
| P7 | VT is skipped from the money / fact model, tallied in `offCampaign` | 4388, 4412, 4453, 4469–4475 (V03/V04 comment: VT appears in the BI export, about 20 sales / R4,278, but is not VAS revenue), 4658–4664, 4898–4941, 5130, 5383–5398, 5421 | VAS headline excludes VT | **Shared, must stay**. Guarded by `verify-engine-rules.mjs` 241, 277–281 ("Tracker produces no fact rows", "only VT is excluded"), 376–387 |
| P8 | **Latent VT report view**: `buildModel` VT branch counts dialler "Sale Made" dispositions as provisional sales with no GWP (4950–4953); `aggCols({vt:true})` VT column set (7144–7160); `campSection` switches to it when `camp==='VT'` (7323); `gFilter` shows VT only when "Matrix Tracker" is picked (6680–6684); `vtHidden` (6705, used at 6623 and 6934) | — | The only "VT analytics" inside PULSE: picking Matrix Tracker on MTD / Weekly / Daily gives a dialler-disposition VT table | **(c) owner decision.** The new module replaces it. Removing it touches `buildModel` and the shared report renderer |
| P9 | VAS-only exclusions in Workforce / Variance / Lead / leaderboard / digest | 6365–6368 (Variance board), 7515 (Workforce), 7707, 7727 (variance rows), 9128–9130, 9249 (reports), 10063, 10240 ("not a reported campaign (VT)"), 10481, 10605 (digest) | VAS pages | **Shared, must stay** |
| P10 | Comment references to the VT workbook in `COMM_RULES` | 10078–10082 | doc only | keep |
| P11 | App switcher option "Tracker Analytics" | 6573 | navigation | (a) remove with T1 |
| P12 | `trackerDaily`, `S.tracker`, `isGeneratedTracker`, `STORE_KEY` | 559, 1362, 1415, 1552, 2535, 2588–2640, 2670, 2686, 3423–3449 | **VAS hand-built tracker — NOT VT** | keep |

### 1D. Ops (`Chatterbox_AgentOS_Analytics.html`)

| # | Item | Lines | Classification |
|---|---|---|---|
| O1 | App switcher option `tracker/index.html` | 437–442 | (a) remove with T1 |
| O2 | `campBucket` → `'VT'`; `CAMP_OPTS` includes `['VT','Matrix Tracker']` | 756–761 | **Shared** (the Ops campaign filter; `verify-ops-formulas.mjs` 246 "M6 the tracker folds to VT") |
| O3 | "QA by campaign" VT tile | 3964–3978 | **Shared** (QA covers VT evaluations, see rule book OI-13) |
| O4 | Cycle-target and attributed-money notes naming VT | 3470, 3495–3497, 1880–1882 (VT agents carry "-" for Sales Force), 5399 | Shared (comments plus a guard against a key collision) |
| O5 | `syncRosterFromVAS` brings VT agents into Ops | (CLAUDE.md 11; `tools/sync-ops-roster-from-pulse.mjs` 35, 50) | **Shared, must stay** |

### 1E. Agent Analytics (`agent/index.html`)

| # | Item | Lines | Classification |
|---|---|---|---|
| A1 | `TL_CAMP_LABEL.VT='Matrix Tracker'` | 1520 | Shared (the TL view labels VT agents) |
| A2 | "NO link to … Tracker Analytics" (comment); token note naming `/tracker/` | 50, 948 | doc; `verify-agent-analytics.mjs` 350 asserts there is no link to `/tracker/`. Harmless |
| A3 | "VAS Tracker" / "Var SF vs Tracker" columns; "Tracker columns blank" | 1935–1937, 2023 | **VAS Variance (Manual Stats board) — NOT VT**. Keep |

### 1F. Supabase

| # | Item | Classification |
|---|---|---|
| S1 | `daily_eod` (migration-004) | (c). Drop only with a NEW migration, after the owner confirms the data is not needed (export it first) |
| S2 | `campaign_label` VT fold (migration-020 47–66, migration-050 16–36); `agent_list.campaign` "Cuddle \| Courtesy \| Nesting \| VT" (migration-010 43); legacy-sheet handling naming the "VT" tab (039 64, 040 83, 046 72); leader-twice fix naming Matrix Vehicle Tracking (054) | **Shared, must stay**. The roster of record depends on it |
| S3 | `usage_events.app` CHECK allows `'tracker'` (061 34) | keep (history) |
| S4 | `app_users.apps` containing `'tracker'`, `app_users.tabs.tracker` | (c). Data, not code. List the holders with a read-only query before deciding |

### 1G. Tools and specs

| Item | Location | Classification |
|---|---|---|
| `upload-station-validate.mjs` VT-floor Vici notes, "VT sheet has no Target column" finding, roster VAS/VT counts | 385, 654, 759–828 | Shared (validator). Keep |
| `qa-sales-sync.mjs` `CAMPAIGN_KEY.VT='matrix_tracker'`, `QUEUE_CAMPAIGN['Vehicle Tracking']` | 20–21, 45, 106, 178 | Shared (QA tool sync). Keep |
| `digest-republish.mjs` "VT is included" (Agent List segment per day) | 272–273, 304 | Shared. Keep |
| `sync-ops-roster-from-pulse.mjs`, `publish-agent-list.mjs`, `audit-agent-list.mjs`, `verify-list-vs-uploads.mjs` 192, `verify-ops-formulas.mjs` 246 | — | Shared. Keep |
| `specs/mtd_engine_rules.json` VT mentions: `sheets_of_record: ["VAS","VT"]` (235–238), campaign normalisation "Matrix Tracker → Tracker" (99, 778–782), QA OI-13 (782, 1824–1825) | — | Shared rule book. Keep; change only with a dated `_changes[]` entry |
| Diagnostics naming VT | `verify-targets-027` (19 hits), `verify-agent-list` (18), `verify-roster-removal` (11), `verify-publish-agent-list` (10), `verify-engine-rules` (8), `verify-attendance-wide` (6), `verify-agent-analytics` (6), `verify-usage-028` (5), `verify-all-tabs` (5), plus about 20 more with 1–4 hits each | Almost all assert that VT roster rows SURVIVE or that VT stays OUT of VAS. Keep. Only `verify-agent-analytics`/`verify-agent-portal` mention `/tracker/` and `/api/eod`, as "must not reach" checks; update their wording if those routes go |

### 1H. Proposed removal list

**(a) Safe to remove (6 items):**
1. `tracker/vt-mtd-report.html`, whole file (T2). Seed data only, `localStorage` only, embeds real first names.
2. The "VT MTD Report" tab and iframe in `tracker/index.html` (285, 405–407, 643).
3. `tools/prepare-site.js` 263–269 (`VT_REL` copy).
4. The `site/_headers` line-4 comment about vt-mtd-report.
5. *If the whole Tracker app goes* (depends on (c)1): the app-switcher options in Ops 441 and PULSE 6573.
6. *If the whole Tracker app goes*: `tracker` in `prepare-site.js` 252 and 280, and `auth-gate.js` 6 and 324–325.

**(b) Shared — must stay (about 15 groups):** P1–P7 and P9 (campOf, VT sheet fold, per-campaign roster replace, `reportedCampaigns`, `offCampaign`, every VAS exclusion), P12 (the VAS tracker), O2–O5, A1/A3, W7/W8 (they change, not go), W9, S2/S3, every tool in 1G, `mtd_engine_rules.json` VT entries, and the diagnostics that protect VT roster rows. Download & Test / `EXP_DOWNUP`, Panimax stripping and VAS referrals are not VT and stay.

**(c) Unclear — the owner decides (5 items):**
1. **The Tracker Analytics app as a whole** (T1: the manual Matrix EOD tracker with Afrilead / JAG / VT sales). Is anyone still capturing into it? Decide by checking `daily_eod` for recent `updated_at` values and listing `app_users` that hold `tracker`. If it is retired: remove W1, W3 and the W2 prompt text, and drop `daily_eod` with a new migration after an export.
2. **`MANAGEMENT_APPS` includes `tracker`** (W4). An account whose only management app is `tracker` would change class.
3. **PULSE's latent VT view** (P8). Remove it once the new module covers VT, or keep it until then. It touches `buildModel` and `aggCols`, which VAS shares.
4. **`actualShiftsFrom.VT:'register'`** (P6). Keep it in VAS's rule book or move it to the new VT rule book.
5. **`app_users.tabs.tracker` grants** (S4). Strip them, or re-point them to the new module's grant.

---

## JOB 2 — The VAS pipeline as a template

### a. Upload Station (PULSE)

- **Entry points.** `#fileInput.onchange` (PULSE ~9980) and drop → `handleFiles(list, expected)` at **9915**. `expected` is the slot the file was dropped on (`window.__slotExpected`).
- **Small vs large.** `LARGE_MIN = 30 MB` (**9905**). Files above it go to `routeLargeFiles` (9926) → `largeUpload` (**8224**): `POST /api/upload/large/start` (Worker index.mjs 1720) gets a signed Storage URL, the browser PUTs to it, then `/complete` (1738). The file is recorded in `upload_files` and queued in pgmq. After that it is loaded either by the runner's `tools/rake.mjs` or **in the page** by `rakeInPage` (**8283**) through `/api/rake/page?fn=begin|stage|…|abandon` (SQL `rake_page_*`, migration-042). `rakeDetect` (8262) identifies headers on that path. XLSX cannot stream there; it must be CSV, or go to the runner.
- **Small path.** `handleFilesNow` (**9932**): `hashBuf` (9402) SHA → **de-duplication** against `S.files[].hash` (it skips when the hash matches and the entry is still live, with the QA `basis` exception) → `bufferToText` → `ingestText` (**2598**).
- **Recognition.** `ingestText` splits the sheets (`splitSheets`), orders them (Agent List / VAS first), special-cases ViciDial by content, converts wide registers, then calls `detectType(header, sheetName, recs)` (**2488–2536**). Detection is by **header substrings** (`has('charge amount','contract create date')` and similar), with a data sniff where headers are identical (BI Active vs Inactive by `Contract Deactivate Date`). The slot (`expected`) or the filename settles ambiguous cases (opencases vs opencasesLM, 2626). A slot mismatch is checked against `SLOT_TYPES` (2668–2672). If nothing is recognised, a toast says "Could not recognise … check the file headers".
- **Ingest.** The `INGEST` table at **2858** (`INGEST.roster` at 3149, `trackerDaily` 3423, …). Each ingester writes into `S.<store>`, a day-keyed store (`DATA_STORES` 1415; `STORE_OF` 2686), and calls `regFile(name,type,dates,rows,extra)` (**2687**) so the file registry (`S.files`) holds the type, dates, row count and hash.
- **Persist.** `save()` (**1849**) stamps `S._rev`, marks it dirty (`__vasDirtySince`) and posts `kv:vas-state` (gzip). The Worker keeps it as it arrives (spec 031, index.mjs 2067). Dirty banner and retry: CLAUDE.md 14(b).
- **Relay.** `archiveUpload` (**9472**) posts the raw bytes to `/api/upload-archive` (index.mjs 1691, 30 MB cap `ARCHIVE_MAX` 233) and `kv:upload-manifest`. Ops pulls them. `syncUploadsFromStation` (9729) pulls the other way.
- **What the user sees.** Per-file toasts. The closing toast is "N files loaded · M skipped (already uploaded)" plus collected `__uploadWarns` (9965–9972). Agent List receipts and banners go through `reportListPublish` (9557) and `kv:roster-refused`. The rule checks V01–V26 render in `ruleChecksCard()` (**8184**) on the Upload Station (`PAGES.data`, **8025**). After any upload: `save(); rebuild(); renderAll(); kickAgentDigest()`.

### b. Roster / Agent List

- **Detect.** `has('team leader','agent name') && (has('sales force')||has('call x'))` → `'roster'`. `has('team leader name','employee code')` → `'leaders'` (the "VAS TL" sheet) (2531–2534).
- **Ingest.** `INGEST.roster` (**3149**): `campOf` (961) plus the VT-sheet fold (3199). It replaces only covered campaigns (3242), and does a file-wide prune of departed agents (2650–2665, departures named in a toast). `rosterAsOf` stamps the date the snapshot describes.
- **History.** `recordOrgList(code,asOf,val)` (**2265**) rewrites the agent's segments inside the list's month (whole-month rule). `recordOrg` (1987) handles day-dated rows. Facts read `orgAt(code,date)` (**2094**), never `S.roster` (CLAUDE.md 11).
- **Publish (the record).** `listPublishJob` / `snapListPublish` (**2561–2570**) post **every row of every sheet** unclassified → Worker `POST /api/roster` (index.mjs **1466**) → SQL `publish_agent_list()` (migration-020, plus 039/040/046/050) → `sync_agent_list` → `sync_team_leaders` → `sync_campaigns` in ONE transaction (CLAUDE.md 13). `GET /api/roster` (1397) serves roster + fingerprint + leavers + aliases. PULSE re-adopts the record (9704).
- **Identity.** `normCB` (`CB-15`=`CB15`), `resolveKey` / `resolveKeyUncached` (**4199–4204**: `S.map` first, zero-padded CB codes, name match), `normName` / `nameTokens` (1038 / 1043, Panimax stripped), `S.aliases` + `rememberNames` / `adoptAliases` (2058–2077; SQL `agent_list_aliases()`, migrations 044–046: "agent name is the identity", one-typo near-spelling). Unmapped rows are FLAGGED (rule V14), never guessed.
- **For VT:** the Matrix Agent List is *the same workbook* PULSE already ingests (its VT sheet). VT agents are already on the roster of record with TL and campaign `VT`. **Reuse it; do not build a second roster ingester.**

### c. The engine

- `rebuild()` (**4361**): `normalizeState` → `grossUpSales` → `pruneDeadFiles` → `buildIndex()` (**4074**, indexes the stores) → `M = buildModel(periodRange(), key)` (**4752**) plus `MP` (the previous period).
- `buildModel(range, periodKey, opts)`: per agent per day facts (4898–5250, the VT branch at 4950), `byAgentDay` (5257), Monday-anchored `weeks` (5294), `tlAgg` / `campAgg` (5354), the grand total (5383), `offCampaign` (5421). Rule checks V01–V26 run against the built model (from 4437; V25 4616).
- **Daily / Weekly / MTD** are views of the same `M`: `PAGES.mtd` (7333), `PAGES.weekly` (7374), `PAGES.daily` (7398), via `campSection(camp,week,opts)` (7322), `agentRows(camp,week)` (7284) and `aggCols(opts)` (7144). The period comes from `periodRange` / `periodRangeRaw` (4262–4266); `applyAsAt` (4250) caps the end date.
- **Rules.** `MTD_RULES` (**573**) is the inlined operative subset of `specs/mtd_engine_rules.json`. `MTD_VAT` (1138) is derived from it. `VARIANCE_RULES` (1167) mirrors `specs/vas_variance_report_rules.json`. `COMPOSITE_RULES` (1277) mirrors `specs/composite_rules.json`. `dataOnlyDay()` (4720) is the single Saturday / public-holiday decision. **Drift guards:** `verify-engine-rules.mjs` (reads the JSON at 35 and compares field by field), `verify-variance.mjs`, `verify-rule-constants.mjs` (no literal 1.15 / 99 copies), and `verify-composite-score.mjs`. A rule changes only in both copies, with a dated `_changes[]` entry.

### d. Composite score

- `COMPOSITE_RULES` (**1277–1340**): seven drivers with weights gwpSale 25, targetAch 20, qa 20, gwpTotal 15, conv 10, talk 5, attendance 5. `floor:0.5`, `windowSessions:5` (the last five CONFIRMED worked sessions, `compositeWindow` 5811), attendance over scheduled shifts, `r2aTiers` (1337; tier penalties are 0 since 2026-09-11 and the tier classifies only). `compositeFor(code, agent)` (**5855**) computes the object. Missing drivers renormalise (CLAUDE.md 6).
- A separate `perfParts` / `perfScore` (**5759 / 5773**: t 45, qa 25, att 20, opt 10, renormalising, effective weights published) is the "performance score" used on rating cards.
- **Engine decides, page paints** (CLAUDE.md 12): PULSE publishes the finished composite object and `compositeDrivers` in the digest (10541). The Worker attaches verdicts (`rules.mjs` `checksFor` 28, `drill.mjs` for the Today tiles). `agent/index.html` never recomputes. Guarded by `verify-agent-card.mjs` (every rated agent nightly), `verify-composite-score.mjs`, `verify-perf-score.mjs` and `verify-drill.mjs`.
- **For VT:** its own composite (a VT driver set) belongs in a **VT rule book JSON + an inlined copy + a drift guard**, built the same way as `COMPOSITE_RULES`. Never compute it in the Worker or in `agent/index.html`.

### e. Publishing (digest) and Worker serving

- **Builder.** `agentDigestPayload()` (**10269–10567**). Shape: `{period{from,to}, updatedAt, weeks[], diallingDays, extraHolidays, workingDays, daysWithData, dates[], comm, commNow?, compositeDrivers, groups, onTarget, talkUnit, tlAgg[], campAgg{}, agents[] (one row per covered agent, incl. per-day rows, composite, perf, segments[] for movers), notCovered[] (VT + no-activity: name and TL, no figures)}`. `emptyMonthPayload` (10228) is used before the month's first data (`empty:true`, figures null).
- **Push.** The IIFE ending at 10830: every 90 s, plus `kickAgentDigest` after uploads. **Month fence in the client**: the period must start on the 1st and end on the month's last day (10749–10756). `liveDigestMonthOk` (10196). POST `kv:agent-digest` (live) and `kv:agent-digest-YYYY-MM` (history). `pushReports` publishes `kv:agent-reports-variance|leads`. `healStaleDigest` re-publishes over an older engine's copy.
- **Server fence.** Worker `/api/kv` POST (index.mjs **2154–2216**): `liveDigestAllowed` (rules.mjs **46**, current SAST month plus rollover grace), `emptyOverData` (63) and `digestEmptiness` (136, emptiness derived server-side), 409 `stale_month` / `empty_over_data`. **Writes are staff-only for the `GUARDED_KV` keys** (rules.mjs 97–111). A new VT digest key must be **added to `GUARDED_KV`**, or any session could overwrite it.
- **Storage.** KV rows live in Supabase `rules` (`key='kv:<name>'`). Large values sit in Storage `raw/kv/<key>` (the pointer `value.store`). Read with a 60 s isolate cache (`loadDigest` portal.mjs **211**, `loadReports` 130).
- **Scopes.** `authorise(user, digest)` (portal.mjs **486**) → `agent` (own CB), `team` (TL's codes), `campaign` (CM's `effectiveCamps`, campaign.mjs 288), or staff. `overview(...)` (**993**) and `agentDetail` (**1141**) build the bodies. `bySegment` (454) splits movers for CMs. Routes: `/api/portal/overview` (index.mjs 963), `/api/portal/agent` (1218), `/api/portal/tl/reports` (1213 → `reportsRequest` portal.mjs 186 → `tlReports` 152). Portal sessions are limited to `PORTAL_ALLOWED` (portal.mjs 40).

### f. Reports tab and .xlsx (Agent Analytics)

- The TL / CM Reports tab: `reportsTabs` (1393), MTD `reportMTD` / `pageMTD` (1441 / 1445), TL summary from `tlAgg` (`tlSummaryRows` 1521, `reportTLSummary` 1548), Weekly (`weeklyRows` 1668, `reportWeekly` 1689, `pageWeeklyTeam` 1720), Daily (`dailyCols` 1740, `reportDaily` 1768, `pageDailyTeam` 1779). Variance / Leads are fetched lazily from `/api/portal/tl/reports?kind=` (`repLoad` 1859, `pageVarianceTeam` 1996, `pageLeadsTeam` 2080, `pageCmReport` 1981). All of it is painted from published figures, with no maths.
- **Export.** `exportReports(which)` (**2118–2164**) uses the global `XLSX` (SheetJS from `/xlsx.full.min.js`) with `aoa_to_sheet`, one sheet per report, filename `TL <label> - <team> - <period>.xlsx`. Guarded by `verify-tl-reports.mjs` and `verify-tl-past-months.mjs`.

### g. Permissions

- `app_users.apps[]` (app grants: `vas`, `ops`, `tracker`, `agent`, `wimpy`) and `app_users.tabs{app:[ids]|'*'}`.
- **Browser.** `site/auth-gate.js`: `APP` is derived from the path (line 6; a new app path needs a branch here plus `NAMES` / `PATHS` 324–325). `applyPerms` hides nav items not in `tabs[APP]`. `noAccessNotice` handles the no-access case. In PULSE, `tabAllowed(id)` (**6720**) refuses to render ungranted pages. Nav ids come from `NAV` (**6531**).
- **Server.** `canUpload` / `UPLOAD_TABS` (rules.mjs 118–131: `vas:['data']`, `ops:['uploads','sess_uploads']`). A separate VT app would need its own entry. `MANAGEMENT_APPS` (index.mjs 539). Portal roles get `apps:['agent']` only (CLAUDE.md 13).
- **Audit.** `node tools/audit-permissions.mjs` (MISSING / DEAD per user, reads PAGES from PULSE `NAV` and Ops `{id:'…',label:}`). It only knows `vas` and `ops`, so **a new app must be added to it**. A new page is invisible to scoped users until granted (memory: "New pages need tab grants"). `verify-tab-guard.mjs` and `verify-server-grants.mjs` cover enforcement.

### h. Guards per stage (in `nicks_code/diagnostics/`; run with `node <suite>.mjs`, which serves PULSE on `127.0.0.1:<port>` through Playwright — see README; CI list in `.github/workflows/verify.yml` 60–85, though Actions has been OFF since 16 Sep per memory, so suites run locally / on the tick)

| Stage | Suites |
|---|---|
| Upload / detect / dedupe | `audit-dupes`, `audit-removal`, `verify-upload-formats`, `verify-upload-station-layout`, `verify-upload-relay`, `verify-upload-compression`, `verify-rake` (37, rolled back), `verify-no-duplicates`, `tools/upload-station-validate.mjs` |
| Roster / identity | `verify-agent-list`, `verify-publish-agent-list` (45), `verify-agent-sync` (80), `verify-history` (39), `verify-tbc-backdate`, `verify-identity-aliases`, `verify-roster-*`, `verify-campaign-moves` / `-split`, `verify-new-campaign` |
| Engine / rules | `verify-engine-rules`, `verify-rule-constants`, `verify-vas-mtd`, `verify-mtd-values`, `verify-saturday-rule`, `verify-public-holidays`, `verify-leave-days`, `verify-variance` (46), `verify-render`, `verify-all-tabs` (live daily health check) |
| Composite | `verify-composite-score`, `verify-composite-recompute`, `verify-perf-score`, `verify-agent-card` (nightly, deployed page), `verify-drill` |
| Publish / serve | `verify-digest-fence`, `verify-empty-month`, `verify-live-month-page`, `verify-cm-digest`, `verify-cm-view`, `verify-agent-portal`, `verify-agent-analytics`, `verify-kv-large-store`, `verify-kv-cas-live` |
| Reports | `verify-tl-reports`, `verify-tl-past-months` |
| Permissions | `verify-tab-guard`, `verify-server-grants`, `tools/audit-permissions.mjs` |
| Saves / CORS (deploy) | `verify-save-acks`, `verify-cors-headers --live`, `verify-live-save --live` (the /deploy skill) |

### Hard constraints a new module must respect

| Constraint | Source |
|---|---|
| Cloudflare Worker **FREE plan: 10 ms CPU** per request and **50 subrequests**. Never parse a big blob in the Worker; aggregate in the engine and serve the result. | index.mjs 174–178 (20 MB state = about 430 ms CPU), 248–253; CLAUDE.md 12 (Coaching waves ≤ 35 calls) |
| Worker memory about 128 MB; KV bodies over **32 MiB** are not unpacked (`KV_INFLATE_MAX`) | index.mjs 86–89 |
| Worker body cap 100 MB; relay cap **30 MB** (`ARCHIVE_MAX`); in-page parse ceiling **30 MB** (`LARGE_MIN`), so larger files take the Rake | index.mjs 233, 1714–1716; PULSE 9905; CLAUDE.md 15 |
| PostgREST returns ≤ **1000 rows** per page and has an ~8 s statement timeout, so page reads and prebuild caches | index.mjs 244–255; CLAUDE.md 15 |
| **Compare-and-set** writes (`X-Cbx-Base` → 409 `version_conflict`) for shared fact stores | index.mjs 2241–2275; memory "Ops audit 14 Sep" |
| The blob model has a parse / heap ceiling (vas-state about 20 MB unpacked / 1.5 MB gzip); do not add another large store to `vas-state` | memory "Suite performance limits"; index.mjs 2067 (spec 031) |
| **Single-file HTML apps that run from `file://`**; rule books inlined plus a drift guard (two copies, change both, dated `_changes[]`) | CLAUDE.md 12 |
| The digest is fenced to the **current SAST month** (rollover grace), whole month only, empty never over data; **staff-only writes** on guarded keys (add the new keys to `GUARDED_KV`) | rules.mjs 46–75, 97–111; PULSE 10749–10756; CLAUDE.md 12 |
| **Engine decides, page paints**; no rule literals in `agent/index.html` | CLAUDE.md 12; `verify-rule-constants` |
| An absence is not a nought; renormalise across available drivers | CLAUDE.md 6 |
| The Agent List is the identity base (`orgAt`, whole-month rule, aliases); unmapped is flagged, never guessed | CLAUDE.md 7, 11, 13 |
| CSP `connect-src 'self'` (+ storage host), scripts from cdnjs only; the Worker is the only Supabase client | CLAUDE.md "Dashboard conventions" / "Deployment" |
| Saves acknowledged: dirty banner, retry, `beforeunload`; CORS headers proven in a real browser | CLAUDE.md 14 |
| New pages need tab grants plus an audit; the server checks the upload grant | `tools/audit-permissions.mjs`; rules.mjs 118 |
| Never edit an applied migration; add a new numbered one | CLAUDE.md layout (`supabase/`) |
| Saturdays and public holidays are data, not shifts (`dataOnlyDay`); leave is excused per agent | CLAUDE.md 12 |
| File size: the user's coding rules set an 800-line soft ceiling; the existing apps are deliberate exceptions, so avoid growing PULSE much further | `~/.claude/rules/ecc/common/coding-style.md` |

### Risks and surprises

1. **BI Active Fitted may look like VAS BI to `detectType`.** If the VT "BI Active Fitted" export carries `Charge Amount + Contract Create Date + Account Number`, PULSE will classify it as `bi` (2491). It would then **merge VT money into the VAS sales store**, and BI uploads *supersede by date span*. VT agents already appear in the VAS BI export (about 20 sales / R4,278 in the reference period, 4469). The new detection needs a hard discriminator (product type, filename, or an explicit slot) checked *before* the VAS `bi` rule. Add a regression test in `verify-upload-formats`.
2. **The VT exclusion is guarded.** `verify-engine-rules` asserts "Tracker produces no fact rows" and that the VAS headline excludes VT. A VT engine inside PULSE's `buildModel` would break those guards and risk the VAS totals. Keep VT facts in **separate stores and a separate model**.
3. **The CM view drops VT on purpose** (campaign.mjs 297, 332; portal.mjs 522). The new VT scope must change these, not work around them.
4. **The validator's "VT sheet has no Target column" finding is stale.** The finding is at upload-station-validate 654. The current list (`reference/zips/vt/Matrix - Agent List.xlsx`) HAS a Target column on VT, with values 1 / 1.5 / 2 / 3 / 6.5 and "-" on 6 rows (the Scheduling agents). VT targets are in different units (VT sales/fitments per day) from VAS. `MTD_RULES.salesTargetMatrix` has no VT entries, and "-" parses to 0 (`parseFloat`, PULSE 3216). See §B2.
5. The old VT MTD Report **ships real first names** in seed data.
6. "tracker" is overloaded (see the warning in Job 1). Removing "tracker" by grep would delete the VAS MTD tracker.

---

## Recommendation: where the new module should live

**Recommended: option (3), a hybrid.** Build a separate VT engine and data store, reuse PULSE's Upload Station shell and roster, and publish a separate VT digest that Agent Analytics reads as an extra tab.

Concretely:
- **Ingest in PULSE's Upload Station** (one drop zone for the floor; the Agent List is already ingested there). Add VT entries to `detectType` and `INGEST`, ahead of the VAS `bi` rule, with explicit slots. Write VT facts to **their own KV key(s)** (for example `kv:vt-state`, compare-and-set), NOT into `vas-state`.
- **Put the VT engine in its own file** (for example `nicks_code/vt-engine.js`, loaded by PULSE with a `<script src>`, or inlined by `prepare-site.js` so `file://` still works). Add `specs/vt_engine_rules.json` plus an inlined `VT_RULES` and a drift guard (`verify-vt-rules.mjs`). Its composite object must be built in the engine.
- **Publish `kv:vt-digest` / `kv:vt-digest-YYYY-MM`** from the same push loop and month fence. Add the keys to `GUARDED_KV` and extend `liveDigestAllowed` / `emptyOverData` to them.
- **Serve VT scopes from a new `worker/src/vt.mjs`** that reuses `authorise` / `effectiveCamps` logic. Agent Analytics gets VT Reports (MTD / Daily / Weekly + .xlsx via `exportReports`) and VT agent cards.

| Option | Upside | Downside |
|---|---|---|
| (1) New tab inside PULSE, same engine | One app, one Upload Station, roster and identity for free | PULSE is 11,107 lines; `buildModel` is VAS-shaped (BI money, VAS exclusions guarded); VT facts in `vas-state` push the blob toward its parse ceiling; highest risk of moving VAS numbers |
| (2) Separate single-file app like PULSE | Clean isolation, own rule book | Duplicates the Upload Station, roster ingest, identity, relay, save-reliability and digest fence (thousands of lines of hard-won fixes); a second Agent List ingester risks two rosters, against CLAUDE.md 13 |
| **(3) Hybrid (recommended)** | Reuses the three most proven pieces (Upload Station plus dedupe, Agent List / identity, digest publish plus fence); VT maths cannot move VAS figures; separate store keeps `vas-state` lean | Needs a little build plumbing (an extra script file or inlining), new guarded keys, a new Worker module, and new tab grants plus an audit-permissions update |

**The three most reusable VAS pieces:**
1. Upload Station intake: `handleFiles` → hash dedupe → `ingestText` / `detectType` / `INGEST` / `regFile`, plus the Rake path for files over 30 MB.
2. Agent List and identity: `INGEST.roster` / `recordOrgList` / `orgAt` / `resolveKey` / aliases, with `publish_agent_list()` as the record. VT agents are already in it.
3. The digest publish and serve contract: `agentDigestPayload` shape, the client and server month fence, staff-only guarded keys, `authorise` scopes, and the Agent Analytics Reports tab with `exportReports` .xlsx.

---

## Addendum (owner clarification): who is a VT agent, and which scorecard they get

### B1. How the list ingest classifies VT today (expands Job 2b)

**The current list file** is `reference/zips/vt/Matrix - Agent List.xlsx`. I read it locally on 2026-11-23 and counted rows only; no names were copied here.

| Sheet | Rows with code + name | Columns | Campaign cell values (count) | TLs |
|---|---|---|---|---|
| `VAS` | 71 | Employee Code, Sales Force, Start Date, Team Leader, Agent Name, Campaign, Tenure, VICCI Dial, Target | Matrix VAS - Courtesy 46 · Matrix VAS - Cuddle 25 | 5 |
| **`VT`** | **48** | Employee Code, Start Date, Team Leader, Agent Name, Campaign, Tenure, **Job Title**, Sales Force, Target (no Call x, no VICCI Dial) | **Matrix Vehicle Tracking - Predictive 22 · - Digital 17 · - Scheduling 6 · - Referral 3** | **4** |
| `TL` (leaders) | 10 | Employee Code, Team Leader Name, Sales Manager, Campaign, VICCI Dial | 4 VAS leaders, VT leaders on Predictive (2), Digital (1), Referral (1), and "Matrix VAS - Training Gr 18" (1) | — |
| `May` | 83 | historical sheet with a Que column | frozen; skipped (migration-039 / `historical_sheets`) | — |
| `Reg List`, `Sheet1` | 86 / 139 | HR lists | not roster | — |

VT tenure: Exp 29, M2 10, M1 9. VT Job Title: "Sales Agent" 42, "Scheduling Agent" 6. VT targets: 1 / 1.5 / 2 / 3 / 6.5, and "-" on 6 rows.

**How each layer classifies those rows:**
- **PULSE (preview).** `detectType` marks the VT sheet as `roster`: it has `team leader` + `agent name` + `sales force` (2534). In `INGEST.roster` (3149), `vtSheet=/^\s*vt\s*$|vehicle|tracker/i.test(sheet)` (3199). That makes **every VT row `campaign:'VT'`** (3213), and **the sub-campaign (Predictive / Digital / Referral / Scheduling) is discarded**. The row also keeps `role` = Job Title, `target=parseFloat(Target)||0` ("-" → 0), tenure, TL and start date. Only campaigns a sheet covers are replaced (3242).
- **Database (the record).** `publish_agent_list()` labels each row with `campaign_label(campaign_raw, sheet)` (migration-050 16–36: a sheet named VT/Tracker/Vehicle → `'VT'`). **`campaign_raw` IS kept** in `agent_list_raw` (migration-046 48, 182–184), so the sub-campaign is recoverable server-side only. `sync_agent_list` gives each VT agent an account (CB + `agentos123`, `apps:['agent']`). `sync_team_leaders` and `sync_campaigns` record the VT leaders and the `VT` campaign.
- **Campaign set per period.** `CAMPS` is `MTD_RULES.reportedCampaigns` plus what the list carries in the period (987–1031). **`carried.delete('VT')`** (1031) means VT is never reported. VT rows land in `offCampaign` and are published only as `notCovered`.
- **Count in the published roster.** From the latest tick log (`reports/tmp/tick-steps/agent-digest-2026-11-22T12-23-37Z.log`): **roster of record 108 agents**, and **the digest covers 66**. So about 42 roster agents are `notCovered`: VT plus VAS agents with no data. The list itself has 48 VT rows. **I could not get the exact VT count in the record.** My read-only Supabase query was refused by this session's permission check. To get it, run `select campaign, count(*) from active_agents group by 1`, or use `tools/audit-agent-list.mjs`.
- **"Download & Test" is NOT on the current VT sheet.** The code treats it as a VAS-sheet campaign: plan `EXP_DOWNUP` in the VAS comm model (R40 product, PULSE 10077, 10184–10187), QA key `upsell` (`qa-sales-sync.mjs` 45), and its movers went to Courtesy in September. **This conflicts with the owner's note. The owner must confirm before any VT rule names it.** The VT sub-campaigns on the list are Predictive, Digital, Referral and Scheduling.

### B2. What Agent Analytics shows a VT agent today, and how the scorecard is chosen (expands Job 2d/2e)

**How the scorecard is chosen:** it depends only on whether the CB is in `digest.agents` (covered) or `digest.notCovered`. It does not depend on role or team, and there is only ONE scorecard, the VAS one.
- PULSE `agentDigestPayload` puts an agent in `agents[]` only if they are on a reported campaign and have facts. Everyone else on the roster goes to `notCovered[]` as `{code,name,tl,why:'campaign'|'nodata',campaign}` (10478–10497). VT always gets `why:'campaign'`. Covered rows carry `campaign`, `tenure`, `plan:commPlanOf(camp,tenure)` (10358, the comm-calculator plan), `composite:compositeFor(...)` (10425), perf parts, days and segments.
- Worker `everyone(digest)` (portal.mjs 474–480) merges both lists with `covered:true/false`. `authorise()` (486) finds the agent in either. `overview()` (993) builds `me` and attaches `me.checks` (`checksFor`) and `me.drill` (`drillFor`; null if uncovered, 1105). It sets `notReported` **only when `auth.missing`**, which means the CB is on neither list (1034).
- The page: `loadPortal` (`agent/index.html` 4560) → campaign scope → `cmOpen`; TL / team → `teamView`; `D.notReported` → `notReported()` (4678, the "different scheme" message for `why==='campaign'`); otherwise `show(D.me)` (6601) → Today (`todayHTML` 7724, `heroHTML` 6837), My Progress (`progressPage` 7634: `pgRating` composite, `pgNBA`, sessions), the commission calculator (`comsPage` 8591, `whatIfHTML` 8310, driven by `plan` + `digest.comm`), and coaching.

**Finding (probable latent bug).** I ran `authorise()` in Node against a fake digest. For a VT agent present in `notCovered`, it returns `{scope:'agent', rows:[{…, covered:false, why:'campaign'}]}` **with no `missing`**. So `notReported` stays null. The "your work sits on another campaign … your team leader has them" message (4680) is therefore likely **never shown** to a signed-in VT agent. Instead `show()` runs with a row that has no figures. `verify-agent-analytics.mjs` 893–902 only calls `notReported()` with an injected payload, so the route is not covered end to end. Confirm this in a browser.

**Team leader and campaign manager today.** A VT TL's team scope includes their VT agents (portal.mjs 436–440). Each one shows "Not reported on this page" (`agent/index.html` 5987). Team composites average covered rows only (1306–1337). CMs never see VT: `effectiveCamps` drops `vt` (campaign.mjs 297, 332) and the CM overview drops campaigns with no digest rows (portal.mjs 518–524).

**What must change for a VT agent to get a VT scorecard:**
1. **Payload.** Publish a VT digest (`kv:vt-digest[-YYYY-MM]`, recommended). Its rows carry `{code,name,tl,campaign:'VT',sub,tenure,role,days[],weeks[],mtd{…},composite{adj,rated,parts[{k,label,w,v,pts}]}}` plus a top-level `scorecard:'vt'`, `vtDrivers[]` and `tlAgg` / `campAgg` for Reports. Every verdict is computed in the VT engine. The VT ingest must keep the raw Campaign cell; PULSE discards it today at 3213.
2. **Worker.**
   - `overview()`/`authorise()`: serve `me` from the VT digest with `scorecard:'vt'`, and close the `missing` vs `notCovered` gap.
   - `checksFor` / `drillFor` are VAS rules (R99 floor, target %), so they need VT equivalents or must be skipped.
   - The team scope merges VT rows.
   - `effectiveCamps` / `cmCampsFor` stop dropping `vt`, and the CM overview builds VT cards.
   - Add the new keys to `GUARDED_KV` and to the month fence.
   - `/api/portal/tl/reports` gets a VT `kind`.
3. **Page.** Branch in `loadPortal` / `render` (4332, 4568) on `D.scorecard==='vt'`:
   - Add VT Today/hero and My Progress / `pgRating` panels from `vtDrivers`.
   - Replace or hide the VAS calculator. VT has its own comm workbooks (`Matrix VT Comm Model_November26.xlsx`, `Matrix VT Scheduling Comm Model_November26.xlsx` in `reference/docs`).
   - Paint VT rows in the TL table instead of "Not reported" (5987).
   - Add VT Reports tabs (`reportsTabs` 1393) and `exportReports` sheets. `TL_CAMP_LABEL.VT` (1520) already exists.
4. **Guards.**
   - Extend `verify-agent-card`, `verify-agent-portal` (VT agent → VT card, never VAS figures; VAS agents unchanged), `verify-cm-view` and `verify-digest-fence`.
   - Add a new `verify-vt-*` suite.
   - Keep `verify-engine-rules`' "VT produces no VAS fact rows" as the proof that VAS is untouched.

### B3. New-source detection risk (confirmed on the real files)

`BI Active Fitted 101126.xlsx` (sheet `Export`) has the headers **Account Number, Contract Create Date, Contract Deactivate Date, Charge Amount** — exactly what PULSE's `detectType` keys on for VAS BI (2491). Dropped into today's Upload Station, it would become **`bi` (or `inactive`)** and **supersede the VAS money store for its date span**. A VT rule must run FIRST and key on columns VAS BI does not have: `Installation Status`, `Vehicle Reg Number`, `Box Number`, `Fitment_Case_Created_By`, `Fitment Centre Name`. `Scheduled & Missed 101126.xlsx` (Case Number, Product Type, Status, Fitment Partner, Fitment Date, MissedAndScheduledFitment, …) matches no current rule and would be reported as "Could not recognise".
