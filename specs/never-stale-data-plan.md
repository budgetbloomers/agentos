# Never stale again — implementation plan

Nick, 2026-09-07: "i want you to make sure there is never stale data again, create me an
implementation plan with functions to never have this problem again."

## What "stale" has meant, with dates

| Date | What was stale | Why |
|---|---|---|
| 28–31 Aug | Every PULSE save for four days | A header the browser refused to send; no server-side view of what did not arrive |
| 3 Sep | Live agent digest showing August | Published from a browser tab that happened to be on a past month |
| 3 Sep | Coaching snapshot (3 days), data lake (8 days) | Both are manual tools; nobody ran them |
| 4–7 Sep | Ops dashboard facts (5 days) | Ops ingests only when a tab is open and its saves land; two big saves failed in Nick's tab, silently |
| 7 Sep | Lake (5 days), coaching (4 days) again | Same manual tools; the scheduled runner exists but has no secrets |

Every case is one of four dependencies: a **human upload**, a **browser tab that must be
open**, a **tool somebody must remember**, or a **failure nobody could see**. The plan removes
each dependency or, where it cannot be removed yet, makes the miss visible within fifteen
minutes and re-runs the step automatically.

## The principle

Every stage of the pipeline gets four things:

1. **A server-side driver** — it runs on a schedule, not when a person is present.
2. **A freshness contract** — how far its data should reach, by what time, on which days.
3. **A sentinel** — the Worker cron measures reach against the contract every ten minutes and raises a named alert in both apps.
4. **A self-heal** — the scheduled driver re-runs the step; the alert clears itself when the contract is met again.

## The pipeline, stage by stage

```
sources ──upload──▶ archive (manifest) ──▶ PULSE state ──▶ agent digest ──▶ Agent Analytics
                         │                    │
                         ├──▶ Ops facts ──────┴─▶ NBA digest ──▶ Ops / Agent Analytics
                         └──▶ data lake (Supabase tables)      coaching snapshot ◀── Coaching Hub
```

## Phase 0 — built today (7 Sep)

| Function | Where | What it does | Trigger | Alert |
|---|---|---|---|---|
| `opsBehindUploads` | `worker/src/health.mjs` | Compares the upload manifest's last move with the newest Ops fact store; if uploads moved and Ops has not followed within 30 min | Worker cron, 10 min | `ops-behind-uploads` (critical) — names the hours behind |
| `digestBehindStore` | `worker/src/health.mjs` | PULSE state saved but the live agent digest not republished within 30 min | Worker cron, 10 min | `digest-behind-store` (warning) |
| `tools/ops-relay.mjs` | tools | Boots the Ops dashboard headlessly as a service session, lets its upload relay pull every unseen archived file and save the fact stores, republishes the NBA digest | Scheduled runner (Phase 1) or by hand | — |
| Saves report themselves | `POST /api/save-fail` (6 Sep) | A save the browser could not land is logged with its status | already live | `saves-failing` |

These would have named this morning's Ops gap at 13:28 SAST on Sunday, thirty minutes after
Ashton's upload, instead of it being found by hand on Monday.

## Phase 1 — the scheduler runs — LIVE since 7 Sep 13:45 SAST (five secrets set on the repository, main fast-forwarded so the schedule is on the default branch; run #1 green except referrals, fixed by passing the HighLevel secrets)

The runner is written: `.github/workflows/publish-digests.yml`. It cannot run without three
repository secrets. Once they exist, every step below runs on schedule with no browser and no
laptop:

| Step | Cadence (SAST) | Tool |
|---|---|---|
| Republish agent digest (live month + history) | every 15 min, 06:00–20:00 | `tools/digest-republish.mjs --apply --history` |
| Ops relay + NBA digest | every 15 min, 06:00–20:00 | `tools/ops-relay.mjs` then `tools/nba-republish.mjs --apply` |
| Data lake load | daily 21:00 and after every relay | `tools/lake-load.mjs` |
| Coaching snapshot | every 2 h | `tools/sync-coaching-hub.mjs` |
| Referrals | daily 06:30 | `tools/fetch-referrals.mjs` |
| Verification | nightly 22:00 | `verify-all-tabs`, `verify-controls`, `verify-live-save --live` |

**To add the secrets:** GitHub → budgetbloomers/agentos → Settings → Secrets and variables →
Actions → New repository secret, three times: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`,
`SUPABASE_DB_URL` (the three values in `supabase.env`). Then Actions → publish-digests → Run
workflow once to confirm.

Two additions to the workflow in this phase:

| Function | What it does |
|---|---|
| `jobs-status` write | Every step writes `kv:jobs-status {step, ranAt, ok, note}` when it finishes |
| `runnerSilent` sentinel | If no step has written for 45 min during working hours → `runner-silent` (critical): the scheduler itself has stopped |

## Phase 2 — freshness contracts per source — built 7 Sep (source_cadence, data_reach, dataReach/expectedReach in the digest, source-stale, PULSE trust chips, "Figures to …" in Agent Analytics; the Ops DATA TRUST bar still counts files)

Today the DATA TRUST bar counts files. It should measure **reach**: how far each source's data
actually goes, against when it is due.

| Function | Where | What it does |
|---|---|---|
| `source_cadence` table | Supabase | One row per source: `source, due_by_sast, weekdays_only, grace_hours, owner` (e.g. BI Active due 13:00 Mon–Sat, owner Ashton) |
| `data_reach` view | Supabase | Max data date per source from the lake and the stores, joined to its cadence, with `hours_late` |
| `sourceStale` sentinel | `health.mjs` | Any source past due + grace → `source-stale` alert naming the source, its reach and its owner |
| DATA TRUST bar (both apps) | PULSE, Ops | Reads `data_reach` from the Worker instead of counting local files, so agents and campaign managers see the same truth as admins |
| Reach stamp in every digest | publishers | `dataReach: {sales, calls, attendance, qa}` in the payload; Agent Analytics shows "data to Friday 5 Sep" instead of a bare figure |

## Phase 3 — remove the daily drop (needs credentials)

The remaining human dependency is the upload itself. Each connector below writes the raw file
into the same archive and manifest, so both apps ingest it exactly as they do a hand upload —
nothing downstream changes.

| Connector | Source | Needs from Nick |
|---|---|---|
| `connectors/salesforce.mjs` | Open, closed and inactive case reports | A Salesforce API user or a scheduled report export |
| `connectors/vicidial.mjs` | EXPORT_CALL_REPORT | ViciDial DB read access or the report URL and credentials |
| `connectors/attendance.mjs` | HR attendance register | Where the register is exported from |
| `connectors/powerbi.mjs` | BI Active / Inactive cases | Power BI export API access, or a scheduled email to n8n |
| already live | HighLevel referrals, Coaching Hub | — |

Until a connector exists, the `source-stale` alert (Phase 2) names the missing upload and its
owner by 13:30, which turns "we found out on Monday" into "Ashton's phone buzzed at 13:30".

## Phase 4 — prove it every night — built 7 Sep (nightly verify job, Scheduled-jobs card in Settings, weekly reach report; the report is stored, not yet posted anywhere)

| Function | What it does |
|---|---|
| Nightly suite run in the runner | 75 diagnostic suites over live data; red → `verification-failed` alert with the suite names |
| `kv:jobs-status` page | A Jobs tab in Settings listing every scheduled step, its last run and result |
| Weekly reach report | Monday 07:00: per-source reach for the past week, posted where Nick reads it (n8n → WhatsApp/email) |

## Definition of "never stale" (the acceptance test)

An alert is raised in both apps, within one cron tick, whenever any of these is true:

| Condition | Alert |
|---|---|
| A source's reach is past its due day (Sat only for sales/calls) | `source-stale` |
| Uploads moved and Ops has not ingested them within 30 min | `ops-behind-uploads` |
| PULSE saved and the digest did not follow within 30 min | `digest-behind-store` |
| The live digest is not the current month | `agent-digest-wrong-month` |
| No scheduled step has reported for 45 min in working hours | `runner-silent` |
| Three saves failed in an hour, by the clients' own report | `saves-failing` |
| The list, the logins and the campaigns disagree | `agent-list-out-of-sync` |

And every alert has a driver that re-runs the step on the next schedule without a person.

## What Nick decides

1. ~~Add the three secrets (Phase 1)~~ — done 7 Sep; the runner is live.
2. Confirm the cadence table: which source is due when, and who owns it.
3. Which connectors to pursue first, and the credentials for them.
