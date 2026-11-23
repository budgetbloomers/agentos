# 071 Vehicle Tracking Analytics — deploy checklist (the single runbook)

**The owner says "deploy". No builder runs any step below.** No builder has applied a migration, run `--apply`, deployed,
or written to production. Every database test ran in PGlite, and every page test ran against fictional data.

Stages, in order. Each stage says how to undo it:

| # | Stage | Undo |
|---|---|---|
| 0 | Pre-flight suites (local) | — |
| 1 | Migration 071, then 072 (and the four checks after them) | R1 |
| 2 | Grants: dry run → owner reads and approves → apply | R2 |
| 3 | Site build | — |
| 4 | Worker deploy | R4 |
| 5 | Pages deploy (`--branch main`) | R5 |
| 6 | Smoke | — |
| 7 | First upload of the day's three files | R7 |
| 8 | Optional opening book (only after stage 7) | R8 |
| 9 | Publish / republish the VT digest | R9 |
| 10 | Verify the four views with minted sessions | — |
| 11 | Every business month: the Sales Review budgets | — |

---

## 0 · Pre-flight (local, no credentials)

1. `node tools/prepare-site.js` must end with `Build consistency verified`.
2. The VAS baseline must give the same result as `baseline.txt` (the pre-existing reds stay as recorded there):
   `verify-engine-rules verify-vas-mtd verify-mtd-values verify-cm-view verify-digest-fence verify-upload-formats
   verify-tab-guard verify-server-grants verify-agent-analytics verify-saturday-rule verify-rule-constants verify-save-acks
   verify-wimpy-removal verify-wimpy-service-drift`, plus `CBX_EMPTY_FIXTURE=1 node …/verify-agent-card.mjs`.
3. Every VT suite must be green. These are the "Vehicle Tracking suites" step of `.github/workflows/verify.yml`:
   `verify-tracker-removed verify-grant-tabs-071 verify-audit-permissions-071 verify-vt-rules verify-vt-periods
   verify-vt-rating verify-vt-engine verify-vt-oracle verify-vt-db verify-vt-worker verify-vt-station verify-vt-isolation
   verify-vt-build verify-vt-pages verify-vt-digest verify-vt-portal verify-vt-vas-golden verify-vt-station-fixes
   verify-vt-health verify-vt-validate verify-vt-tabs`, plus `CBX_VT_FIXTURE=1 node …/verify-agent-card.mjs`.
   The quick half runs with `node tools/vt-verify.mjs`, which takes about 20 s.
   Run the suites one after another. Several of them rebuild `site/`, and running them in parallel makes Playwright suites flake.
4. The security-review fix pass on `worker/src/vt.mjs`, `portal.mjs`, `campaign.mjs`, `rules.mjs`, `index.mjs`,
   `agent/vt-view.js`, `nicks_code/vt-publish.js` and `tools/digest-republish.mjs` must be **merged** and its suites green.
   After that pass:
   - Publishing the VT digest needs the **Upload Station grant**, not just any staff role.
   - The digest has a size cap and a "newer wins" check.
   - `GET /api/kv?key=vt-digest` is staff-only.
5. The Phase C station follow-ups are in: the station abandons before retrying, and it says `busy` and the refusal codes in
   words. `verify-vt-station-fixes` guards this.

## 1 · Migrations: 071, then 072

Apply them outside the upload window (nobody on the Upload Station) and not while an Agent List publish runs.
`apply-migration.mjs` runs each file in ONE transaction, so `set local` covers the whole file.

1. Check `statement_timeout` **first**, before the first-day or opening-book load:
   `select rolname, rolconfig from pg_roles where rolname in ('service_role','authenticator','authenticated');`.
   A 20k-case first load committed in about 1.7 s in PGlite. If the Worker role's effective timeout is under about 15 s, run
   `alter role service_role set statement_timeout = '60s';` (or load the first day after hours).
2. `node tools/apply-migration.mjs supabase/migration-071-vt-facts.sql`. This creates five `vt_*` tables with RLS on and no
   policy, plus the intake, book, trim and size functions. EXECUTE is revoked from public, anon and authenticated.
3. `node tools/apply-migration.mjs supabase/migration-072-vt-roster-read.sql`. This adds `vt_roster_at()` and the partial
   index `agent_list_raw_vt_idx`. It sets `lock_timeout = '3s'`: if a list publish holds `agent_list_raw`, it fails fast and
   changes nothing, so re-run it later. It touches neither `publish_agent_list()` nor any `sync_*`.
4. Checks, in the SQL editor:
   - The index is valid: `select indisvalid from pg_index where indexrelid = 'agent_list_raw_vt_idx'::regclass;` → `t`.
   - EXECUTE is revoked on every VT function. The query must return exactly **8 rows**, all `f`:
     ```sql
     select p.oid::regprocedure as fn,
            has_function_privilege('anon', p.oid, 'execute')          as anon,
            has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
            coalesce(array_to_string(p.proacl, ','), '') ~ '(^|,)=X'  as public
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname like 'vt\_%' order by 1;
     ```
     Then re-run the floor-wide anon-EXECUTE audit (the 22 Sep check).
   - PostgREST sees the functions. Both files end with `notify pgrst, 'reload schema';`. Call
     `POST /rest/v1/rpc/vt_db_size {}` with the service key: it must answer 200. A 404 / `PGRST202` means the schema
     cache is stale: run `notify pgrst, 'reload schema';` again, or reload it from the dashboard.
   - Run `node tools/vt-db-size.mjs` (read-only). Every table should be near 0 rows.
5. **Migration 073 is NOT needed yet (F6).** The condition is `agent_list_raw` over 250,000 rows. The repo's own figures
   cannot reach it yet:
   - Each publish replaces the rows of its own `as_of` day (delete then insert, since migration-039).
   - That is about 2.3k rows per list (plan §DB-7.2).
   - At most one `as_of` per calendar day since migration-020 (3 Sep) gives at most about 82 days, so at most about 189k rows.
   - At one list per working day, it crosses 250k at about 109 list-days, around early February 2027.

   Measure the real figure read-only with `node tools/vt-db-size.mjs --agent-list-raw` (it prints the verdict). Write 073
   only when that says `PROPOSE migration-073`: 90-day retention for the non-roster sheets, roster sheets kept for ever,
   dry-run function first, owner-approved.

**R1 · rollback (072, then 071)**, after the Worker and Pages are rolled back (R4/R5):
`drop function if exists vt_roster_at(date); drop index if exists agent_list_raw_vt_idx;`. Then export the book if any real
file was loaded (`select vt_book(null);`, `select * from vt_uploads;`), then:
```sql
drop function if exists vt_upload_begin(text, text, text, date, text, text), vt_upload_stage(bigint, text, int, jsonb, text),
  vt_upload_commit(bigint, bigint, jsonb, jsonb, jsonb, boolean, int, int, text), vt_upload_abandon(bigint, text),
  vt_book(date, bigint[]), vt_trim(int, date, int), vt_db_size();
drop table if exists vt_upload_stage, vt_case_events, vt_cases, vt_book_rev, vt_uploads;
notify pgrst, 'reload schema';
```
Then re-run the anon-EXECUTE audit, and `delete from rules where key in ('kv:vt-trim-log');` if the cron wrote it.

## 2 · Grants (before the Worker that drops `tracker`)

1. Dry run, read-only: `node tools/vt-grant-tabs.mjs`. It prints a row per account, `i` notes, and a `by role:` line.
2. **The decision taken in Phase F.** Agents, team leaders and campaign managers are **never given the `vas` app**.
   - Phase E put the VT team leader's and the VT campaign manager's reports inside Agent Analytics (`vtScope`: team leader →
     own team; campaign manager → the VT scope in `cm:assignments`; the Reports VT tabs).
   - Giving them `vas` would make them managers (`MANAGEMENT_APPS`) for no VT reason.
   - A portal role that already holds `vas` gets the three VT tab ids. Staff (viewer/exec/manager) who held `tracker` get
     `vas` + `vt_mtd, vt_weekly, vt_daily`.
   - A portal role whose only management app was `tracker` becomes **portal-only** on this deploy, which is intended. The
     plan marks these rows "was a manager only through 'tracker'".
   - A campaign manager without VT in `cm:assignments` is told the VT card needs that assignment. Add it in the CM settings
     if they should see VT.
3. The owner reads the plan and approves it, then runs `VT_GRANT_APPLY=owner node tools/vt-grant-tabs.mjs --apply`.
   It never removes anything.
4. `node tools/audit-permissions.mjs` (read-only) should then show:
   - no `VT:` lines;
   - `DEAD-INERT apps:tracker / tabs.tracker`, reported and left in place by design (`--dead` never strips them);
   - no DEAD `vt_*` ids, because the VT pages are real VAS pages now.

**R2 · rollback**: the tool only adds. To undo one account, remove `vas` (only where the plan added it) and the three
`vt_*` ids from `tabs.vas` by hand. The dry-run output, saved before `--apply`, lists exactly what was added.

## 3 · Site build

`node tools/prepare-site.js`. It inlines `nicks_code/vt-engine.js`, `vt-pages.js` and `vt-publish.js` into
`site/pulse/index.html`, and `agent/vt-view.js` into `site/agent/index.html`. The build fails if a `data-inline` file is
missing, and it deletes any stale `site/tracker/`. Then run `node nicks_code/diagnostics/verify-vt-build.mjs --no-build` and
`node nicks_code/diagnostics/verify-tracker-removed.mjs --no-build`.

## 4 · Worker deploy

Deploy the Worker. It brings `vt.mjs` (intake + portal), the VT digest fence in `rules.mjs`, the CM VT scope, the
`tracker` removal from `MANAGEMENT_APPS`, and the VT health checks (`worker/src/vt-health.mjs`, wired in `health.mjs`).

Before 071 is applied, the health checks are silent: `vt_uploads` cannot be read, so they have no opinion. After it is applied:
- they raise `vt-digest-stale`, `vt-upload-gap`, `vt-staging-stuck`, `vt-budget-missing`, `vt-db-size` and `vt-unmatched`
  into `kv:health-alerts`, which reaches only the existing banner recipients;
- they run `vt_trim()` once a week, on Sunday SAST, logged in `kv:vt-trim-log`.

**R4 · rollback**: redeploy the previous Worker version (`npx wrangler rollback` or the dashboard's previous deployment).
Nothing calls the VT functions after that.

## 5 · Pages deploy

Run `npx wrangler pages deploy site --project-name chatterbox-agentos --branch main`. Production needs `--branch main`;
without it the upload lands on a preview.

**R5 · rollback**: promote the previous production deployment in the Pages dashboard.

## 6 · Smoke (real Chromium, the deployed origin)

1. `node nicks_code/diagnostics/verify-cors-headers.mjs --live`. The VT intake sends no new header (only Authorization,
   Content-Type and X-Cbx-Client), so the allow-list is unchanged.
2. `node nicks_code/diagnostics/verify-live-save.mjs --live`.
3. `/tracker/` must not serve the old app. A former tracker-only staff account still opens VAS Analytics and sees
   Vehicle Tracking.
4. Run `node nicks_code/diagnostics/verify-vt-tabs.mjs --live` once 071/072 are applied: the three VT pages over the live
   book, read-only. It skips cleanly before that.
5. Check `GET /api/kv?key=vt-digest` with an agent's session: it must be refused (staff-only after the fix pass).

## 7 · First upload of the day's files

On the VAS Upload Station:
1. Drop `BI Active Fitted <ddmmyy>.xlsx` on **VT · BI Active Fitted** and `Scheduled & Missed <ddmmyy>.xlsx` on
   **VT · Scheduled & Missed**, in either order. Each receipt must say "VAS money unchanged".
2. Load the Agent List as usual, if it changed.
3. Optional check first: `node tools/upload-station-validate.mjs <dir> --start … --end …` over a folder holding the files.
   It now validates the three VT files and checks the VT Targets against the business month's SPD budgets.

**R7 · rollback**: a bad file is superseded by the next good one (the book holds current state per case). To remove a
day entirely, restore from the export taken in R1 or reload from the previous day's files.

## 8 · Optional opening book (only AFTER stage 7)

Drop the `Schedulers Data` sheet of the hand-kept report on **VT · Opening book (once)**. It sets sale days only. The
station and the database refuse it on an empty book.

**R8 · rollback**: the opening book only sets `sold_on` / `sold_basis='opening_book'` on cases already present. Reload
the next daily files, or ask for a one-off SQL reset of `sold_basis` (owner).

## 9 · Publish the VT digest

A station commit publishes `kv:vt-digest` and `kv:vt-digest-cycle-YYYY-MM` from the page (`vt-publish.js`). After the fix
pass this needs the Upload Station grant. A VT page opened by such an account republishes when the book is newer.
`node tools/digest-republish.mjs --apply` also carries a VT job: it publishes the empty business month at the 26th rollover
and republishes after a tick.
- Check the result with `node nicks_code/diagnostics/verify-vt-health.mjs` (offline logic) and the live banner. No
  `vt-digest-stale` should be showing 15 minutes after the commit.

**R9 · rollback**: republish from the book (stage 9 again). The fence refuses an older or empty payload over a newer one.

## 10 · Verify four views with minted sessions

Never sign in as a person: 2FA enrolment would start on their account. Mint a short-lived session row the way
`verify-cm-live.mjs` does (random token, sha256 stored, 5 minutes, deleted in `finally`). Then check:
- **A VT agent**: Agent Analytics shows the VT card, with 4 drivers, "points start at half of target", and no VAS calculator.
  Run `CBX_VT=1 node nicks_code/diagnostics/verify-agent-card.mjs`, which renders every VT agent's card against the
  published digest, read-only.
- **A VT team leader**: Reports has VT Month to date / Weekly / Daily for their own team only, and the export names the team.
- **A VT campaign manager**: the VT card and VT reports appear; the VAS CM cards are unchanged.
- **A VAS agent**: the card is byte-identical to before (`verify-vt-vas-golden` proved this offline). Live, run
  `node nicks_code/diagnostics/verify-agent-card.mjs` (VAS mode).

**Open:** there is no automated live TL / CM VT check yet. `verify-vt-portal` has no `--live` mode, and its file was
reserved for the review fix pass. Do the TL and CM checks by hand with minted sessions until it gets one.

## 11 · Every business month (from the 26th): the Sales Review budgets

For each business month (26th → 25th, keyed by the month it ends in), the owner supplies the Sales Review figures:
- SPD per sub-campaign and tenure;
- fitment %;
- missed % (5 %);
- the Hrs Ahead shares;
- the cancelled budget;
- the Avg GWP figures (shown, not scored).

These go into `specs/vt_engine_rules.json` → `budgets["cycle-YYYY-MM"]` **and** the `VT_RULES` copy in
`nicks_code/vt-engine.js`, with a dated `_changes[]` entry. `verify-vt-rules` fails if the two differ. Until they are in:
- the rating uses the latest earlier month's budgets, and each card says so;
- the health banner shows `vt-budget-missing`;
- the validator flags the month.

## Known, documented differences from the hand-kept report

These are not bugs. Never "fix" them toward the hand sheet:
- **Cancelled is absent.** No upload carries a cancellation, so the column reads "—", never 0, until a source exists (`cancelledFrom`).
- **The 11 manual credits are not copied.** The hand-kept report credits 11 sales to someone other than the Salesforce
  seller. The engine follows Salesforce and the Agent List.
- **About 6.6 % of lead sources were relabelled** by hand in the report. The engine folds the Salesforce partner.
- **A missed daily upload shifts sale days.** No file carries a sale date, so a sale is dated the day it is first seen.
  The receipt, the pages and `vt-upload-gap` name the missing day.

## Kept in place from Phase A, with reason (plan §R (c))

| Item | Decision | Reason |
|---|---|---|
| `daily_eod` table, `/api/eod`, its `GATED_WRITES` entry, the portal block on `/api/eod` | left, dormant | D9: no data deleted; the owner can drop it later after an export |
| `usage_events` CHECK allowing `'tracker'`, `usage.mjs` labels | left | history; an applied migration is never edited |
| PULSE hidden VT branch in `buildModel` / `aggCols({vt:true})` / `campSection` / `vtHidden` | untouched | guarded by `verify-engine-rules`; changing it risks VAS figures |
| PULSE "Matrix Tracker" view | hidden | only reachable through a saved `S.ui.camp='VT'`, which `rebuild()` now clears with a toast |
| `MTD_RULES.actualShiftsFrom.VT:'register'` | left | the VT module uses no shifts; drift-checked |
| `app_users` `tracker` grants | left, inert | reported as DEAD-INERT by `audit-permissions`; never stripped |
| `.gitignore` `site/tracker/*`, agent/index.html comments naming the old app | left | harmless |

## How the suites run today

GitHub Actions has been off since 16 Sep, so `verify.yml` and the nightly step in `publish-digests.yml` run only by hand.
Both now list the VT suites. The nightly step adds `CBX_VT=1 verify-agent-card`, `verify-vt-tabs --live` and
`verify-vt-health`, and `verify-all-tabs` / `verify-controls` drive the three VT pages.

What actually runs on a schedule is the local tick (`tools/tick-local.mjs`). It now runs `tools/vt-verify.mjs` (the nine pure
VT suites, about 20 s) **once per SAST day**, on the first full tick, as its last step, stamped `verify-vt`. A red stamp
raises the existing "verification-failed" banner.
