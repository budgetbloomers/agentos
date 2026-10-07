---

description: "Task list — 014 system bug sweep (triaged from the suite run, live health and five code audits, 2026-10-07)"
---

# Tasks: System bug sweep

**Rules**: each fix gets a test that FAILS first (shown) and passes after; no rule Nick decided changes; no live writes;
no deploy/commit (Nick approves). Severity is the triage call, not the auditor's.

## Area V — VAS / PULSE (nicks_code/index.html)

- [x] V1 MEDIUM a reload during another tab's write (425) was reported as a save failure → false "saves failing"
  critical alerts (6/day live); after 4 conflicts the tab re-pushed a stale base until the background poll rescued it.
  Fixed: wait out 425 / 409 write_in_progress (≤ 8 × 0.2–5 s), backoff restarts the conflict count.
  verify-save-acks "two tabs" — RED without the fix (replay 425 reported), GREEN 19/19.
- [x] V2 MEDIUM the Agent List publish reads `rosterRaw`/`S.roster` 3 s after ingest — a second file dropped with it
  nulls rosterRaw (leader rows never published); snapshot rows + roster at ingest time.
- [x] V3 MEDIUM handleFiles has no re-entrancy lock while ingestText keeps per-file state in globals
  (__curFileHash …) — the station sync can interleave with a user drop; serialise handleFiles.
- [x] V4 MEDIUM removeFile on a ViciDial file deletes the whole day although another file covers it (callsMeta never
  set for vici) — keep days another registered file covers.
- [x] V5 MEDIUM XSS: genInsights text, coachingFor `why` (QA "Coaching Category"), narrativeFor, the AI coach reply,
  the Coaching Hub name — esc() / textContent.
- [x] V6 MEDIUM digest/report POST failures are never retried — the fingerprint is recorded before the fetch and r.ok
  is never checked; record after an ok response.
- [x] V7 LOW period presets / rosterAsOf use the UTC day (00:00–02:00 SAST wrong day; 1st of the month wrong month).
- [x] V8 LOW #pPreset and dailyStep call save() (whole state to the cloud) instead of saveUI().
- [x] V9 LOW search boxes lose focus after a pause (re-focus runs before the real input exists).
- [x] V10 verify-variance 8 failures = a STALE TEST (CallX intake refused whatever the date on purpose — index.html:636-641,
  mtd_engine_rules.json:110, Nick 15 Sep); fixture now turns the cutover off like verify-mtd-values → 78/0.
  Area V DONE (verify-vas-sweep-014: 12 pass / 37 fail on HEAD → 49/49; 14 related suites green). Left: VR16 remedy text still
  mentions CallX (rule-book text, two copies) — LOW.

## Area O — Ops (Chatterbox_AgentOS_Analytics.html)

- [x] O1 HIGH saveConfig's conflict merge brings dropped agents back into cbInfo/agentMap/sfOwnerMap (breaks
  "a dropped agent is OFF every report") — identity maps rebuilt by buildIdentity replace, never merge.
- [x] O2 HIGH the relay's ViciDial self-heal is dead (`x.file_name` — batches carry `original_file_name`), and its
  fallback re-downloads every Vici file of the last 3 days on every cycle — fix the field; this is what refills the
  ViciDial days missing since 28 Sep once spec 013's saves land.
- [x] O3 MEDIUM the relay marks files decided even when saveFacts returned {failed:true} — un-decide that source's
  files of the cycle.
- [x] O4 MEDIUM a team-scoped TL tab publishes nba-digest / ai-digest-ops built from its own team only — scoped tabs
  never publish shared digests.
- [x] O5 MEDIUM anchorDate takes the max date of every source incl. leave filed ahead — future anchor moves every
  window; anchor on facts dated ≤ today.
- [x] O6 MEDIUM the cbx-fresh poller can reload facts over a load whose save is still pending — skip while pending.
- [x] O7 MEDIUM XSS: the AI coaching reply is set with innerHTML unescaped.
- [x] O8 MEDIUM batch-id re-mint ignores ids present in the fresh store's rows but not yet in the audit.
- [x] O9 LOW the nba-digest stale-publisher self-heal JSON.parses the {value} object (never fires).
- [x] O10 LOW campaign filter reads `i.campaign` (cbInfo stores `queue`) — non-bucket campaigns unfilterable.
- [x] O11 LOW cycleCalc does not clear the global filters (other campaign's cycle reads R0 under a filter).
- [x] O12 LOW publishRoster's as_of is the UTC day.
  Area O DONE (verify-ops-sweep-014: 14 pass / 26 fail on HEAD → 40/40; verify-ops-cas F updated for O3; 8 related suites green).

## Area A — Agent Analytics + Wimpy (agent/index.html, wimpy/index.html)

- [x] A1 HIGH sign-out (and every 401 path) leaves the previous person's data in memory (coaching hub, drafts, help,
  reports, half-typed forms, VIEW) — a shared browser shows it to the next person; reset all client state.
- [x] A2 MEDIUM a campaign manager's Variance / Lead management show the LIVE month under a past month's or billing
  cycle's label (no period sent for month/cycle) — send the period or say "live month only".
- [x] A3 MEDIUM Wimpy: a cart line whose item left the menu (the Big One after the day flips) is invisible and cannot
  be removed, but blocks the order — drop it and say so.
- [x] A4 MEDIUM Wimpy: sign-out keeps the previous person's name/surname/phone/notes; the next person's order goes to
  the kitchen under the old name.
- [x] A5 LOW Wimpy: the window-flip re-render wipes the order form being typed.
- [x] A6 LOW KPI form dates use the UTC day.
  Area A DONE (verify-agent-sweep-014: 38 of 53 failed on the unfixed pages → 53/53; 9 related suites green). A2 note: month/cycle
  report keys are never published, so those periods say "live month only"; also applied to a TL's "<Month> (final)" view
  (same wrong-label defect) — Nick to confirm. Known LOW left: four pre-existing [...new Set()] spreads in agent/index.html.

## Area W — Worker (worker/src/*.mjs)

- [x] W1 HIGH /api/kv `key` is never validated: `zzz/../agent-digest` passes kvWriteAllowed and URL normalisation
  writes the live digest blob, skipping every digest fence; DELETE can remove objects outside raw/kv — validate keys
  (`^[A-Za-z0-9._:-]+$`, no `..`) on GET/POST/DELETE.
- [x] W2 MEDIUM /api/agent-signins (and /api/bi GET) rely on one PostgREST read with limit=20000 — capped at 1000
  rows, so later days read "signed in on no days"; page through.
- [x] W3 MEDIUM /api/bi POST is delete-then-insert across many calls; a failure leaves a half-loaded span AND a
  batch row that refuses the re-upload as "already loaded" — remove the batch row on failure.
- [x] W4 LOW /api/agent-digest is reachable by a wimpy/referrals-scoped session (above the scope fences).
- [x] W5 LOW hubs.mjs default coaching date and month/year use UTC.
  Area W DONE (verify-worker-sweep-014: 21 pass / 39 fail before → 61/61 after; 13 related suites unchanged).
- [ ] W6 FOLLOW-UP (capacity, pre-existing): /api/bi takes one BI file per request; past ~35,200 rows (44 chunks of 800 under the
  50-subrequest cap) it is now refused 413 up front (before: half-loaded + stuck batch). Month-end BI files reach ~33k
  (max seen 32,924) — Ops pushBI should send a large file in parts before a busy month crosses the line.

## Area T — tick + tools (tools/*.mjs)

- [x] T0 HIGH tick-local keeps the LAST two lines of a failed step — always the blank line + "Node.js v24" footer —
  so every failure note is empty; keep the error lines and write the full output to reports/.
- [x] T1 HIGH nba-republish has crashed on every run since 21 Sep (the weekly NBA review is stuck on 1–17 Sep) —
  find the real error; likely the 132 MB ViciDial store pushed through page.evaluate; no try/finally (Chromium leaks).
- [x] T2 HIGH lake-load has crashed on every run since 6 Oct (the call history and agent_day stop) — find the real
  error (pg 'error' listener missing; possible duplicate keys in one upsert chunk).
- [x] T3 HIGH spawnSync's timeout does not bound a step (runs of 2–15 h logged) and the lock expires mid-run, so
  ticks overlap — kill the process tree, refresh the lock between steps.
- [x] T4 MEDIUM ops-relay: failure cause hidden; on a quiet day it waits the whole --wait window every tick.
- [x] T5 MEDIUM stamp() is an unguarded read-modify-write of kv:jobs-status (a throw skips the rest; races).
- [x] T6 MEDIUM a prepare-site failure exits without a stamp.
  Area T DONE (verify-tick-014: 11 pass / 31 fail before → 87/87). Real errors: nba-republish "page.evaluate: Target page,
  context or browser has been closed" (the 126.5 MB / 588,106-row Vici store in one evaluate → now ≤ 8 MB pieces);
  lake-load: duplicate SF_INACTIVE key (acct 10496996, B0473) in one upsert chunk → 21000 (now collapsed, last wins;
  pg error listener + timeouts; one failed source no longer stops the rest). Follow-up: install-local-tick.ps1 sets a
  40-min task limit, shorter than a worst-case tick.

## Review (Z1) — three independent reviewers (pages · Worker+tools · security), 2026-10-07: no CRITICAL, no HIGH

First full run of every credential-free suite (47): all green but one — V9 lost a keystroke under load.

- [x] R1 MEDIUM V9 residual: the skeleton removed the search box until the real paint, so a key pressed in that frame went
  nowhere ("Nos" for "Nosi"). No skeleton while a search box has focus; keys typed meanwhile are carried onto the new box.
  verify-vas-sweep-014 V9 (frames HELD — deterministic): RED 3 fails → GREEN 52/52.
- [x] R2 LOW V1: the 409 write_in_progress wait shared the replay's counter (reset by every good reload) → never capped;
  after it, the same 409 also took the four version_conflict reloads. Own counter (__pushWipN), reset only by a landed save or
  the backoff; the ninth refusal is reported. verify-save-acks "write lock that never clears": RED (29 waits, no report) → 22/22.
- [x] R3 MEDIUM Ops opsSavePending (O6) blocked the fresh-reload for ever while a save was refused PERMANENTLY. The shim's
  queue carries no time/status, so the page records when a key was first refused (store()) and holds the reload ≤ 10 min;
  also a shim RETRY stamped __cbxLastWrite, so the poller mistook it for this tab's own write and swallowed other users'
  uploads (opsLastWriteRefused). While held, one small audit read still shows "another user uploaded". 43/48 → 48/48.
  Known rare race left: a poll during this tab's own audit save with a refused save queued → one false toast + one reload.
- [x] R4 LOW Wimpy: a cart emptied by the prune on the Confirm/form screen showed R0.00 with "Confirm & send" enabled → back
  to the order screen with the "no longer on the menu" note; the typed form is kept.
- [x] R5 LOW (security) Agent Analytics: some 401s (hub/help/reports) showed an error but never returned to sign-in → api()
  ends the session on any 401 of the current session (not /api/login, /api/logout), on the next task so the caller settles
  first; sessionExpired() is once-only. verify-agent-sweep-014: 57/70 on the unfixed pages → 71/71.
- [x] R6 MEDIUM tick-local: a failed taskkill / a Chromium grandchild holding the pipes kept the tick's node alive → the
  scheduled task would skip every later run. finish() unrefs + destroys the child's stdio; exitIfStuck() ends the process
  10 s after main(); a failed kill is said in the note, the log line and the step log.
- [x] R7 MEDIUM W2 paging caps too high for the FREE plan's 10 ms CPU → PG_MAX_PAGES 12 (agent-signins ≤ 16 subrequests),
  /api/bi GET ≤ 5 pages with truncated + next_offset (no page or tool calls it).
- [ ] R8 MEDIUM (security) nba-digest / ai-digest-* not in the server's guarded keys — NOT APPLIED, needs Nick: campaign
  managers (Dalwin, Preshen hold ops+vas) publish nba-digest + ai-digest-ops from Ops and ai-digest-vas from the PULSE
  widget LEGITIMATELY; a 403 would put the red NOT-saved banner on their tabs and raise the saves-failing CRITICAL alert.
  Scoped (wimpy/referrals) sessions are already refused (pinned by two new checks). Order if wanted: Ops + widget skip
  sessions the server would refuse → then GUARDED_KV.
- [x] R9 LOW lake-load stops on a query timeout (the rest FAILED "not attempted", audit + agent_day refresh skipped, exit 1);
  stampJob fetches AbortSignal.timeout(20 s); one NOTE_MAX = 300 shared by job-status and tick-local.
- [x] R10 LOW (security) tick step logs + the jobs-status note are redacted (Bearer, JWTs, token/key/password=, postgres
  credentials, sb_secret_, any ≥16-char value from supabase.env / highlevel.env).
  verify-tick-014 90/25 → 115/115 · verify-worker-sweep-014 67/4 → 71/71.
- [x] R11 BI_MAX_CHUNKS spare subrequest: counted 50 of 50 worst case (1 session + 1 dup select + 1 batch + 1 span delete + 44
  chunks + 2 cleanup). The dup select is skipped when a batch row is written — the batch insert is the check (unique index
  batches_source_filehash_uq, CONFIRMED LIVE read-only 7 Oct; partial: hash-less uploads were never deduped, before or after).
  Now 49 of 50; still 44 chunks = 35,200 rows (month-end 32,924 uses 45).
- Noted, not changed: /api/referrals/health is unauthenticated and calls HighLevel each time (pre-existing); every staff role incl. `viewer`
  may write generic /api/kv keys such as vas-state (pre-existing — Nick's call).

## Close

- [ ] Z0 RE-ENABLE THE LOCAL TICK — paused 2026-10-07 ~11:16 UTC with Nick's OK (it rebuilt site/ from the files being edited; the 11:04 digest step crashed on a half-edited build): `Enable-ScheduledTask -TaskName 'Chatterbox AgentOS local tick'` once the sweep is verified
- [x] Z1 independent review of all fixes (3 reviewers, no CRITICAL/HIGH; R1–R11 above); five new suites registered in
  verify.yml; final run 2026-10-07: 50 credential-free suites, every one green (3,320 checks). Not run: verify-controls,
  verify-vici-tz, verify-agent-portal (live database).
- [ ] Z2 release + commit (Nick's go-ahead)
