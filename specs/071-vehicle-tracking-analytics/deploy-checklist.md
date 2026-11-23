# 071 Vehicle Tracking Analytics — deploy checklist

**The owner says "deploy". No builder runs any step below.** Phase F (F8) writes the final order; this is the Phase A part.

## Phase A — removing the old Tracker Analytics app

Order matters (plan §R, risk 6). The Worker change drops `'tracker'` from `MANAGEMENT_APPS`. An account whose only
management app is `tracker` would become portal-only the moment that Worker is live, so the grants go first.

1. **Grants first.** Run the dry run and read it:
   `node tools/vt-grant-tabs.mjs`
   It lists every `app_users` row holding `tracker`, the VT team leaders (CB194, CB104, CB360, CB358) and every campaign
   manager whose `cm:assignments` row names VT, and proposes `apps += 'vas'` and `tabs.vas += vt_mtd, vt_weekly, vt_daily`.
   It never removes anything. Rows marked `NOTE: … becomes a manager` are team leaders or campaign managers that are
   portal-only today. Granting them `vas` makes them managers in the Worker's eyes. Decide on those rows deliberately.
   Then apply: `VT_GRANT_APPLY=owner node tools/vt-grant-tabs.mjs --apply`.
   (Until Phase D ships, the three VT tab ids exist in no page. They are inert, and `audit-permissions` will report them
   as DEAD until then. Do not strip them with `--dead`.)
2. **Build:** `node tools/prepare-site.js`. It deletes any `site/tracker/` an older build left on disk, because `site/` is
   uploaded as it stands. Then `node nicks_code/diagnostics/verify-tracker-removed.mjs --no-build` must be green.
3. **Deploy** the Worker and Pages together, the usual `/deploy` flow.
4. **Smoke:** `verify-cors-headers --live` + `verify-live-save --live`. Opening `/tracker/` must not serve the old app. A
   former tracker-only account must still sign in to VAS Analytics.

## Left in place, with reason (plan §R (c))

| Item | Decision | Reason |
|---|---|---|
| `daily_eod` table, `/api/eod` GET/POST, the `POST /api/eod` entry in `GATED_WRITES`, the portal block on `/api/eod` | left, dormant | D9: no data is deleted. The route is harmless without its page. Dropping it needs a new migration after an export, and is the owner's call |
| `usage_events` CHECK allowing `'tracker'`, `worker/src/usage.mjs` labels | left | history; an applied migration is never edited |
| PULSE hidden VT branch in `buildModel` / `aggCols({vt:true})` / `campSection` / `vtHidden` | left untouched | guarded by `verify-engine-rules`; changing it risks VAS figures |
| PULSE "Matrix Tracker" view | **hidden** | the header Campaign filter never offered VT (`CAMPS` drops it). The only way in was a saved `S.ui.camp='VT'`. `rebuild()` now clears that like any other unreported campaign, with a toast. No engine change |
| `MTD_RULES.actualShiftsFrom.VT:'register'` | left | the VT module uses no shifts; drift-checked; harmless |
| `app_users.tabs.tracker`, `apps` containing `tracker` | data left; superseded | `tools/vt-grant-tabs.mjs` adds `vas` + the VT tabs. The stale `tracker` entries stay inert (F1 reports them as DEAD-INERT) |
| `verify-agent-analytics` "no link to /tracker/", `verify-agent-portal` "/api/eod blocked" | left | still true, still useful |
| `.gitignore` entries `site/tracker/*` | left | harmless; they keep a stale local build out of git |
| `agent/index.html` comments naming Tracker Analytics / `/tracker/` (lines ≈50, ≈948) | left | comments only, explaining the agent page's walls; `verify-agent-analytics` checks for links, not comments |
| CLAUDE.md layout row for `tracker/` | left for F8 | Phase F owns CLAUDE.md (tasks.md file matrix) |

## Phase C — the VT case book and the Upload Station intake

No builder applied anything; every database test ran in PGlite (in-process). At deploy, the owner, in this order:

1. **Migrations, before the Worker that calls them:**
   `node tools/apply-migration.mjs supabase/migration-071-vt-facts.sql` (five `vt_*` tables, RLS with no policy, the
   intake / book / trim / size functions, EXECUTE revoked from public, anon and authenticated), then
   `node tools/apply-migration.mjs supabase/migration-072-vt-roster-read.sql` (read-only `vt_roster_at()` + the partial
   index `agent_list_raw_vt_idx`; it touches neither `publish_agent_list()` nor any `sync_*` function).
   Then re-run the floor-wide anon-EXECUTE audit (memory: "Agent List check 22 Sep"): no `vt_*` function may be
   executable by anon.
2. **Build:** `node tools/prepare-site.js` — it now inlines `nicks_code/vt-engine.js` and `nicks_code/vt-pages.js` into
   `site/pulse/index.html` and fails if a `data-inline` file is missing. Then `node nicks_code/diagnostics/verify-vt-build.mjs --no-build`.
3. **Deploy** the Worker (new `worker/src/vt.mjs`, mounted in `index.mjs`) and Pages together.
4. **Smoke:** `verify-cors-headers --live` + `verify-live-save --live` as usual. The VT intake sends no new header (only
   `Authorization`, `Content-Type`, `X-Cbx-Client`), so the CORS allow-list is unchanged. Then drop the day's
   `BI Active Fitted <ddmmyy>.xlsx` on the **VT · BI Active Fitted** slot and check the receipt says "VAS money unchanged".
5. **Order of the first files:** the two daily files first (either order). The **opening book** (`Schedulers Data` sheet of
   the hand-built report) only AFTER the first day's two files — the station and the database both refuse it on an empty book.

Not yet wired (later phases): the VT pages (D), the digest publish after a commit (E2, `VTStation.afterCommit` is the
hook), the weekly `vt_trim()` call and the VT health alerts (F3).
