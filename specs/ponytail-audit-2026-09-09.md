# Ponytail audit — 9 September 2026

*The second one. The first (2026-07-15, recorded in `brain/hot.md`) cut the production-unread `engine/`
mirror, the demo generator, the ViciDial placeholder, the GWP price table and 17 never-written tables
(migration-006). This pass swept the database, storage, the repo and the application code.*

**Headline: the clutter is minor. The guards are the finding.** Three mechanisms this project relies on
to prove itself are quieter than they read, and one of them lets a non-negotiable be violated today.

---

## A · Guards that do not guard  (fix first)

**A1. The R99 floor guard has two holes, and the literal is back in the agent app.**
Non-negotiable 12 says `agent/index.html` never carries a 99 again and `verify-rule-constants` fails on
the literal. It does not.
- The suite scans only `agent/index.html` and `worker/src/portal.mjs`
  (`nicks_code/diagnostics/verify-rule-constants.mjs:60`). `worker/src/campaign.mjs` is never scanned.
- Its floor pattern is `/gwpFloor\s*:\s*99\b|:\s*99\)|\?\s*99\b/`, which does not match the `||99` form.

So these pass a green suite today:
`agent/index.html:1669` and `:1857` (`num(th.gwpFloor||99)`), `worker/src/campaign.mjs:43`
(`gwp_ref: 99`), `:471` and `:541` (`Number(...gwp_ref) || 99`). Five independent copies of a rule-book
number, in a system whose rule is that the number has one home.

**A2. Three of eleven "live" nightly suites can exit green having asserted nothing.**
- `verify-agent-list.mjs:57` skips when `uploads/` is absent, and `uploads/` is gitignored — so it
  skips on **every** CI run, always.
- `verify-all-tabs.mjs:37` and `verify-composite-score.mjs:51` exit 0 when the live state blob cannot
  be read. A Supabase blip reads as a pass.
The nightly loop treats a zero exit code as success, so none of this is visible in the run summary.
Same pattern in nine more suites (`verify-bi-gwp:32`, `verify-cancellation-rows:49`,
`verify-live-integrity:24`, `verify-filter-empty:19`, `verify-leads-vas:27`, `verify-leads-cache:42`,
`verify-roster-removal:39`, `verify-qa-shown:43`, `verify-agent-progress:47`).
**Fix:** a skip should exit non-zero in CI, or print a line the workflow counts.

**A3. A test drives a path no user can reach.** `agent/index.html:4568` `openAgent(cb)` has zero call
sites in shipped code; every live row calls `openDrawer(cb)`. The only caller left is
`verify-agent-card.mjs:43,49`. The nightly render check exercises dead code.

---

## B · Removed features still reachable

| What | Where | State |
|---|---|---|
| Activated Services purge | `Chatterbox_AgentOS_Analytics.html:5215-5234` | Its own comment says *"delete this whole block after 2026-08-15"*. It is 25 days past that and still runs on every boot (`:5356`). |
| CallX upload slot | `Chatterbox_AgentOS_Analytics.html:535`, `:575` | Retired 2026-09-01. The uploader still renders; intake (`:1407`) discards every row, so the slot can now only ever load zero rows. |
| CallX intraday Dialler slots | `Chatterbox_AgentOS_Analytics.html:566-573` | `SES_DIAL_0800…1630` are built on the CallX parser and are **not** covered by the retirement filter, which tests the source key exactly. |
| Lead Allocation dial | `Chatterbox_AgentOS_Analytics.html:600` (`leadAllocStale`) | The page it configured was deleted 2026-08-23. The dial is still editable. |
| GWP multiplier dial | `Chatterbox_AgentOS_Analytics.html:605` (`gwpMult`) + dead reader `:2123` | An editable rule that changes nothing. |
| Prototype app | `agent-preview/index.html`, shipped by `tools/prepare-site.js:217` | 974 KB, ~11k lines of fictional agents with its own duplicated sign-in, live at `/agent-preview/`, last touched 30 Aug, linked from no menu. |

---

## C · Dead code and dead database objects

**Database** (checked three ways: no reference in 265 source files, no reference from any function body,
view, trigger or cron, and no rows ever written). Drop script ready and **not applied**:
`supabase/migration-033-ponytail-cuts.sql`.
- `upload_coverage` — table, declared 2026-07 as "the coverage law as a queryable fact", **never written
  once**. The law is genuinely enforced elsewhere (`verify-coverage-law.mjs`, V01–V22).
- `agent_list_asof` — view, superseded by `agent_list_current`.
- `lake_unmatched` — view, nothing reads it; still unions the retired `callx_calls`.
- `upload_manifest_files` — view, built for a Phase 2 compatibility layer that was never built.
- `upload_manifest_remove()` — function, commented "test cleanup only", no caller.

Kept though a code-only scan flags them: `norm_owner` and `rake_sf_ts_local` (called inside the rake
merges), `app_users_password_birth/_turn` (triggers), `rls_auto_enable` (the `ensure_rls` event
trigger), `callx_calls` (70,161 rows of real history).

**Application functions with zero shipped call sites:** `coverageCard` + its private helpers
`dialCoverage`, `viciGroupCensus` (`Chatterbox_AgentOS_Analytics.html:4889-4922`, ~48 lines);
`allocEmpty` (`:4437`); `gwpMultVal` (`:2123`); `fileToText` (`nicks_code/index.html:7604`);
`monthFromFilename` (`:929`); `openAgent` (`agent/index.html:4568`, see A3).

**Worker routes no client calls:** `/api/agent-link` (`worker/src/index.mjs:875`), `/api/campaign-stats`
(`:896`), `/api/campaigns` (`:961`), `/api/agent-signins` (`:1264`), and `/api/referrals/health`
(`:451`, unauthenticated — plausibly an external monitor, confirm before removing). The other 50 routes
all have a live client.

---

## D · Dead files  (~9.6 MB, none of it shipped)

- `nicks_code/diagnostics/verify.mjs` — hardcodes a vanished sandbox (`/root/.claude/uploads/…`,
  `file:///home/user/…`). Cannot run anywhere. Last touched 2026-07-20.
- Root `dl/`, `dl-values/`, `simfix/` (2.9 MB) — byte-identical to the diagnostics copies and
  *regenerated* by the suites; they exist at root only because someone ran a suite from there.
- Five root scratch fixtures (~1.53 MB) that suites **write**, never read.
- `nicks_code/diagnostics/src-full/` (5.1 MB) — zero references; its sibling `src-aug/` is the live one.
- `design-system/MASTER.md` — documents the dark-glass palette the suite moved off on 2026-08-26.
- `npm install --no-save pg@8` appears four times across the two workflows; `pg` is already a declared
  devDependency.

**37 diagnostic suites are named nowhere** — not in a workflow, the diagnostics README, CLAUDE.md, a
spec, or another suite. Most were bulk path-fixed on 2026-09-08, so their dates prove nothing. Genuinely
cold by git date: `bench-xlsx`, `profile-ops`, `profile-ops-parse` (6 Aug), `diagnose-talk`,
`diagnose-cancellations` (9 Aug) — CallX-era one-offs.

**Seven specs have no inbound reference.** `lead-allocation-plan.md` (29 KB) documents a feature removed
on 2026-08-27 — but it is the *only* thing keeping `verify-lead-allocation.mjs` alive and is one of two
references for `verify-ops-intake.mjs` and `verify-render.mjs`. Spec and suite are one decision, not two.

**Local only, not repo weight:** `backups/` 186 MB (nothing newer than 30 Aug; superseded by the daily
cron snapshots into `raw/kv-history/`, which are working — 8 kept for `vas-state`) and `uploads/` 165 MB.
Both correctly gitignored, and both still read by a handful of suites.

**Loose since yesterday:** `.agents/`, `skills-lock.json` and `.claude/skills/supabase*` are untracked
and un-ignored, so they sit in every `git status`. Commit them or ignore them.

---

## E · Checked and clean

No `console.log` or `debugger` in shipped app code. No `TODO`/`FIXME`. No large commented-out blocks.
No unused npm dependencies and no undeclared imports. No dead Worker bindings. Every script and suite
named in the two workflows exists. Storage buckets hold no orphaned objects. The `engine/` mirror the
last audit removed has not grown back.

Five test hooks are reachable from any browser console on the live app
(`nicks_code/index.html:1366, 1371, 1391, 8053`): they can shorten the save-retry backoff, suppress the
unsaved-work banner, and mutate the period and roster. They are deliberate and documented as test hooks;
worth a decision on whether they should be gated in production.

---

## F · What to do, in order

1. **Fix A1** — either delete the five copied 99s or widen `verify-rule-constants` to scan
   `worker/src/campaign.mjs` and match the `||99` form. Do not leave the guard passing on a violation.
2. **Fix A2** — make a skipped suite fail in CI.
3. **Delete the expired time-boxed block** (B, row 1) and decide on the CallX slots.
4. **Apply `migration-033`** once Nick agrees, or implement `upload_coverage` and delete the migration.
5. **Delete D** — the 9.6 MB is free and nothing ships it.
6. Decide on `agent-preview/`: keep shipping a fictional-data app on the live origin, or stop.
