# 072 VT Report — deploy checklist (the single runbook for THIS deploy)

**The owner says "deploy". No builder ran any step below.** No builder applied a migration, ran `--apply`, deployed, or
wrote to production. Every database test ran in PGlite, every page test ran against fictional data, and the owner's real
workbook was only ever READ by the oracles at run time — nothing from it is in the repo or in a screenshot.

This spec adds one page (**VT Report**), one upload (**VT · Schedulers Data**, which REPLACES the once-only opening-book
slot), one migration (**073**) and one health alert. Everything 071 deployed stays exactly as it is, so the stages below
are **only what changes**. Where a stage is unchanged, it says so and names the 071 runbook
(`specs/071-vehicle-tracking-analytics/deploy-checklist.md`), which stays the record for migrations 071/072, the
`tracker` removal and the monthly Sales Review budgets.

Stages, in order. Each stage says how to undo it.

| # | Stage | Undo |
|---|---|---|
| 0 | Pre-flight suites (local, no credentials) | — |
| 1 | **Migration 073** (and the three checks after it) | R1 |
| 2 | Grants: dry run → owner approves → apply (`vt_report`) | R2 |
| 3 | Site build | — |
| 4 | Worker deploy (the `schedulers_data` kind + `vt-schedulers-stale`) | R4 |
| 5 | Pages deploy (`--branch main`) | R5 |
| 6 | Smoke (real Chromium, the deployed origin) | — |
| 7 | **Upload the Schedulers Data sheet** — this is what back-builds the earlier cycles | R7 |
| 8 | Publish / republish the VT digest, then back-fill the frozen cycles | R8 |
| 9 | Verify a real person sees the page (minted sessions) | — |
| 10 | Every business month: the Sales Review budgets (unchanged, 071 stage 11) | — |

**Order matters in two places.** 073 must be applied **before** the Worker and Pages deploys — the Worker accepts a
`schedulers_data` commit and the four/seven new columns must exist, or the first commit fails on the server. And the
Schedulers Data sheet must be uploaded **after** the first daily files of the day (the station and the database refuse
it on an empty book), which is also why stage 7 sits after stage 6.

---

## 0 · Pre-flight (local, no credentials)

1. `node tools/prepare-site.js` must end with **`Build consistency verified`**.
2. The VAS baseline, unchanged by this spec — run them one at a time, not in parallel:
   `verify-engine-rules verify-vas-mtd verify-mtd-values verify-digest-fence verify-cm-view verify-tab-guard
   verify-server-grants verify-saturday-rule verify-upload-formats verify-public-holidays`.
   The only acceptable reds are the recorded pre-existing ones (`composite-score` 1, `agent-analytics` 1,
   `agent-card` fixture 3).
3. Every VT suite green. This is the "Vehicle Tracking suites (specs 071 + 072)" step of `.github/workflows/verify.yml`:
   `verify-tracker-removed verify-grant-tabs-071 verify-audit-permissions-071 verify-vt-rules verify-vt-periods
   verify-vt-rating verify-vt-engine verify-vt-oracle verify-vt-views verify-vt-report-oracle verify-vt-export
   verify-vt-db verify-vt-worker verify-vt-station verify-vt-isolation verify-vt-build verify-vt-pages verify-vt-digest
   verify-vt-portal verify-vt-vas-golden verify-vt-station-fixes verify-vt-health verify-vt-validate
   verify-vt-dashboard verify-vt-tabs verify-vt-bi-two-files`, plus `CBX_VT_FIXTURE=1 node …/verify-agent-card.mjs`.
   - New in 072: **`verify-vt-views`** (the four views, the integrity verdicts, the forecast and the buckets, pure),
     **`verify-vt-report-oracle`** (the whole dashboard against the owner's master workbook; skips cleanly where
     `../reference/zips/vt-master/` is not on the machine), **`verify-vt-export`** (the `.xlsx` against the model) and
     **`verify-vt-dashboard`** (the built page in real Chromium, both themes, 168 checks).
   - **Three suites must be UNCHANGED passes** — they are the gate that no VAS or rating figure moved:
     `verify-vt-rating` (58), `verify-vt-vas-golden` (32), `verify-vt-isolation` (27).
4. The quick half, which is also what the daily tick runs: `node tools/vt-verify.mjs` — **12 pure suites, about 21 s**
   (it was 9 suites / 17 s before 072).

## 1 · Migration 073 — BEFORE the Worker and Pages deploys

`node tools/apply-migration.mjs supabase/migration-073-vt-schedulers.sql`

It only ADDS: the Schedulers Data columns on `vt_cases`, the `schedulers_data` upload kind and `sold_basis` value on
their CHECKs, and the `coalesce` semantics that stop an ordinary BI commit blanking them. It never edits 071 or 072.

After it:
1. The two CHECK constraints accept the new values and still refuse anything else.
2. `select … from information_schema.columns where table_name='vt_cases'` shows the new columns.
3. Re-run the anon-EXECUTE audit (071 stage 1), because a new or changed function must never be executable by `anon`.

**R1 · rollback**: the columns are additive and nullable, so the previous Worker and page ignore them. To undo
properly, take an export first (as in 071 R1), then drop the added columns and restore the two CHECK constraints to
their 071/072 text. A `sold_basis='schedulers_data'` row already written must be re-dated by reloading the daily files
(or set back to `first_seen`) before the CHECK will accept the old text.

## 2 · Grants — `vt_report`

1. Dry run, read-only: `node tools/vt-grant-tabs.mjs`. `VT_TABS` is now
   **`vt_report, vt_mtd, vt_weekly, vt_daily`**, so every VT grant proposes the dashboard too. The tool only ever adds.
2. The Phase F decision of 071 is unchanged: **agents, team leaders and campaign managers are never given the `vas`
   app.** They read VT inside Agent Analytics. A portal role that already holds `vas` gets the tab ids like anyone else.
3. The owner reads the plan, approves it, then runs `VT_GRANT_APPLY=owner node tools/vt-grant-tabs.mjs --apply`.
4. `node tools/audit-permissions.mjs` (read-only) must then show **no `VT:` lines**, and no DEAD `vt_*` id —
   `vt_report` is a real VAS page read out of PULSE's own NAV, so a missing grant is reported MISSING and never DEAD.
   The `DEAD-INERT apps:tracker / tabs.tracker` lines stay, by design.

**R2 · rollback**: remove `vt_report` from `tabs.vas` by hand on the accounts the saved dry-run output names. The page
is then invisible to them; nothing else changes.

## 3 · Site build

`node tools/prepare-site.js`. It now inlines **`nicks_code/vt-charts.js`** and **`nicks_code/vt-dashboard.js`** as well
as `vt-engine.js`, `vt-pages.js` and `vt-publish.js`; the build fails if a `data-inline` file is missing. Then
`node nicks_code/diagnostics/verify-vt-build.mjs --no-build` and `verify-vt-app.mjs`.

## 4 · Worker deploy

What is new in the Worker:
- `worker/src/vt.mjs` accepts `kind='schedulers_data'` on begin / stage / commit. **No new route and no new auth rule.**
- `worker/src/vt-health.mjs` adds **`vt-schedulers-stale`**: the newest committed Schedulers Data sheet more than
  `guards.uploadGapWorkingDays` (1) working days behind the newest BI Active Fitted file. Warning at two working days,
  critical at five or more. It rides `kv:health-alerts`, so it reaches exactly the existing banner recipients
  (aarav / nicholas / barry) — **no new channel**, and it clears itself the tick a newer sheet is committed. It never
  fires before the first sheet has ever landed: there is nothing to be stale against.

**R4 · rollback**: redeploy the previous Worker version (`npx wrangler rollback` or the dashboard's previous
deployment). A `schedulers_data` commit is then refused in words and the page says the sheet has not landed.

## 5 · Pages deploy

`npx wrangler pages deploy site --project-name chatterbox-agentos --branch main`. Production needs `--branch main`.

**R5 · rollback**: promote the previous production deployment in the Pages dashboard. The VT Report disappears; the
three 071 pages and every VAS page are untouched.

## 6 · Smoke (real Chromium, the deployed origin)

1. `node nicks_code/diagnostics/verify-cors-headers.mjs --live` — the Schedulers Data intake sends **no new header**
   (Authorization, Content-Type, X-Cbx-Client only), so the allow-list is unchanged. Run it anyway: the rule is that a
   browser-side change is only proven in a browser.
2. `node nicks_code/diagnostics/verify-live-save.mjs --live`.
3. `node nicks_code/diagnostics/verify-vt-tabs.mjs --live` — the **four** VT pages over the live book, read-only.
4. Open `/pulse/?app=vt&page=vt_report` as an admin: the head names the business month, the view, "figures to" and the
   dialing day; every panel paints; nothing reads `0` where it should read `—`.
5. Press **Export .xlsx** on the page. The file is named `VT Report - <view> - <Month Year> to <dd Mon>.xlsx` and holds
   20 sheets, the first being *About this export*. Open it and check the header sheet names the view, the cycle, the
   as-at date and the rule-book version.

## 7 · Upload the Schedulers Data sheet — what back-builds the earlier cycles

**Load the day's two daily files first** (`VT · BI Active Fitted`, `VT · Scheduled & Missed`), then drop the master VT
report on **VT · Schedulers Data**. The slot replaces *Opening book (once)*; the old name is still shown as
"Opening book (retired)" on an old receipt.

- It may be re-uploaded as often as the master is updated. It is **not** a one-off.
- It supplies the **scheduler, the GWP and the true sale date** — and nothing else carries them. It **never** changes a
  status: its `Result` column is counted as a disagreement and never applied.
- Because it carries the whole history, loading it is what lets the VT Report offer **earlier business months**: the
  engine lists every cycle the book's sale dates reach (`VTEngine.cyclesInBook`), and the oldest one is flagged partial
  with the first sale date and a sentence on screen.
- The receipt reports staged / skipped-blank / redated / disagreements / unmatched schedulers. ~17k empty rows of the
  owner's sheet are counted and skipped, not refused.
- Dropped on the wrong slot it is refused in words naming the right one. A thin pull is refused as well: the master
  only ever grows.
- Optional check first: `node tools/upload-station-validate.mjs <dir> --start … --end …` over a folder holding the
  files. It validates the Schedulers Data sheet exactly as it validates the two daily files (signature, extract date,
  duplicate case numbers, thin pull, duplicate extract dates) and names the retired slot where an old receipt uses it.

**R7 · rollback**: a bad sheet is superseded by the next good one — the book holds current state per case and the
Schedulers Data fields are overwritten whole. Reloading the previous master restores the earlier sale dates, GWP and
schedulers. Nothing a Schedulers Data commit writes can change a status, so no outcome figure can be wrong because of
it.

## 8 · Publish the VT digest, then back-fill the frozen cycles

A station commit publishes `kv:vt-digest` and `kv:vt-digest-cycle-YYYY-MM` from the page (`vt-publish.js`), which needs
the Upload Station grant. Then:
- `node tools/digest-republish.mjs --apply` carries the VT job as before.
- **The frozen history keys for CLOSED cycles are refused from a browser** (`closed_cycle`), so back-filling an earlier
  month's `kv:vt-digest-cycle-…` stays the republish tool's job. Until a month is back-filled, the VT Report's previous-
  cycle comparison is the **engine's own recomputation** from the same case book, and the page says so on screen; where
  a frozen key does answer, the page names the key and says the published figure is a wider window (a month-to-date set,
  not this page's cycle view), so Target Achieved and the per-channel changes read `—` rather than compare two different
  definitions.
- 15 minutes after the commit no `vt-digest-stale` should be showing, and no `vt-schedulers-stale`.

**R8 · rollback**: republish from the book. The fence refuses an older or empty payload over a newer one.

## 9 · Verify a real person sees it

Never sign in as a person — 2FA enrolment would start on their account. Mint a short-lived session row the way
`verify-cm-live.mjs` does (random token, sha256 stored, 5 minutes, deleted in `finally`), then check:

- **A staff account with a VT grant** (viewer / exec / manager): the Vehicle Tracking app dropdown entry is there, the
  sidebar lists **VT Report** first, and the page paints every panel with the live book. The four views each repaint the
  whole page. Export .xlsx downloads.
- **A staff account WITHOUT `vt_report`**: no VT Report in the sidebar, and typing `?page=vt_report` lands on their own
  page with a notice — not an error and not an empty screen.
- **A VT agent, team leader and campaign manager**: unchanged by this spec. They stay portal-only and read VT inside
  Agent Analytics (`CBX_VT=1 node nicks_code/diagnostics/verify-agent-card.mjs`, read-only).
- **A VAS agent**: the card is byte-identical to before (`verify-vt-vas-golden` offline, `verify-agent-card` live).

## 10 · Every business month (from the 26th): the Sales Review budgets

Unchanged — 071 stage 11. The VT Report reads the same budgets through one accessor
(`VTEngine.cycleBudgetFor`), falls back to the latest earlier cycle and **names the cycle it used** on every panel that
shows a target. `vt-budget-missing` still raises while a month's budgets are not in.

---

## The chart palette, validated (task C2)

The four VT Report series tokens are defined in **both** theme blocks of `nicks_code/index.html` (`--vtc1…--vtc4`) and
nothing on the page names a colour. The `dataviz` validator was run against each theme's own card surface, and both
modes PASS all six checks:

| Theme | Tokens | Report |
|---|---|---|
| Light (`:root`, card `#FFFFFF`) | `#2563EB #158A4C #6D4AE0 #B45309` | PASS lightness (L .43–.77) · PASS chroma · PASS CVD (worst adjacent ΔE 25.6 deutan) · PASS normal-vision (29.1) · PASS contrast |
| Dark (`[data-theme="dark"]`, card `#0A1730`) | `#3D86E8 #179C72 #8457E6 #B5790C` | PASS lightness (L .48–.67) · PASS chroma · PASS CVD (19.6 deutan) · PASS normal-vision (21.0) · PASS contrast |

The dark four are **selected for dark** — steps off the same ramps, not a flip of the light four and not the suite's own
dark tokens. `verify-vt-dashboard` asserts both sets exist and that no literal colour appears in any painted SVG.

## The `72+` budget share: ONE key, not two (task D3 / FR-034)

The five-bucket split of this spec divides `72+` into **in-cycle** and **out-of-cycle**, but the rule book carries **one**
`72+` share (`budgets[cycle].hrsShare.h72p`, 5 %) and not two. So:
- the MTD Hrs Ahead table's two split columns print the **absent marker** for their budget, and the table's note says why
  and names the rule-book path;
- the VT Report's Cycle Performance panel measures the five buckets against the **dashboard's own** shares
  (`dashboardHrsShare`, the Sales Review cells named on the panel) — deliberately **not** the share the agent rating
  reads on the Month to Date page, which comes from a different workbook. The panel says so.

Splitting that 5 % into two would be a **rule-book change nobody has written**. It needs the owner's number and a dated
`_changes[]` entry in `specs/vt_engine_rules.json` and the `VT_RULES` copy together. Until then the absent marker is the
honest answer, and `verify-vt-pages` holds it there.

## Known, documented differences from the hand-kept report

Everything 071 recorded still holds (`specs/071-vehicle-tracking-analytics/deploy-checklist.md`) — the derived
Cancelled, the **11 manual credits**, the **~6.6 % relabelled lead sources**, and a missed daily upload shifting sale
days. 072 does not fix any of them; it **counts and shows** them. The VT Report's *Where the sources disagree* panel
prints the new counts (Result against status, by direction; unmatched schedulers and sellers; unmapped campaigns; sales
with no sale date; sales with no GWP) **beside** those carried-forward 071 figures, in the floor guide's own wording, and
both travel into the `.xlsx`. Nothing in that panel changes a figure anywhere on the page.

Two more that are not bugs:
- **GWP is not the engine's fitted value.** GWP is the hand-typed Schedulers Data column E; the engine's fitted value is
  the BI Charge Amount × VAT. Both are shown, each named, and neither is adjusted to match the other.
- **The lead-time buckets are frozen at the extract plus one day**, never at a clock, and the two `72+` buckets split on
  the cycle end. As the owner's own sheet ages, its live formulas move while the page's as-at does not — the page says
  the as-at date on the panel, so the two can be read against each other honestly.

## How the suites run today

GitHub Actions has been off since 16 Sep, so `verify.yml` runs by hand. What runs on a schedule is the local tick
(`tools/tick-local.mjs`), which runs `tools/vt-verify.mjs` once per SAST day, last, stamped `verify-vt`; a red stamp
raises the existing "verification-failed" banner. 072 added three pure suites to it (`verify-vt-views`,
`verify-vt-report-oracle`, `verify-vt-export`): **about 3.9 s, taking the step from ~17 s to ~21 s.** The browser suite
for the page (`verify-vt-dashboard`) stays out of the tick, like every other browser suite, and runs in `verify.yml` and
by hand. `verify-all-tabs` and `verify-controls` now drive **four** VT pages, the VT Report among them.
