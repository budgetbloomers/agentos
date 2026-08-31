# Save Reliability Plan — an upload must never be lost silently again

**Incident reference:** 28–31 Aug 2026. PULSE's `vas-state` save added a
`Content-Encoding: gzip` header; the header was not in the Worker's CORS
allow-list, so every browser refused to *send* the save. Four days of uploads
were ingested, rendered, and discarded on refresh. No server log recorded
anything (the request never left the browser); the only symptom was a transient
toast; detection came from a client email. Fix shipped in `da1053e`.

The fix closed *that* bug. This plan closes the **classes** of failure that let
it run for four days — in Ops (AgentOS Analytics), VAS Analytics (PULSE), and
the Supabase database itself.

---

## The five failure classes the incident exposed

| # | Class | How it showed here |
|---|-------|--------------------|
| 1 | **A blocked request leaves no trace anywhere.** | The preflight refusal happened inside the browser. The Worker never saw a request; Supabase never saw a write; no log could have caught it server-side. |
| 2 | **The client assumes success.** | The failure signal was a 6–12 s toast. The app kept rendering the upload from memory, so everything *looked* saved. Dozens of toasts over four days, none actionable, none persistent. |
| 3 | **The server cannot tell "idle" from "broken".** | `kv:upload-manifest` moved every day (the raw-file relay worked); `kv:vas-state` froze on the 27th. Nothing compared the two timestamps, ever. |
| 4 | **The tests run where the failure does not exist.** | Every save test ran in Node. Node does not enforce CORS: the exact request Chrome refused returned HTTP 200 from a script. |
| 5 | **There is no recovery point.** | One blob, overwritten in place. The raw-file relay restored the data *by accident* — it archives files for cross-app sync, not for recovery. Had the loss been in a store the relay doesn't cover, it would have been permanent. |

Each phase below closes one class. Ordered by protection-per-effort: 1 and 2
are the protection, 3 is the proof, 4 is the parachute, 5 rides along with 2.

---

## Phase 1 — the client must KNOW it saved (PULSE + Ops)

*Closes class 2. Files: `nicks_code/index.html`, `Chatterbox_AgentOS_Analytics.html`.*

The apps already have half the state: PULSE stamps `S._rev` on every `save()`
and (since `da1053e`) records `window.__vasSaveOk` on every acknowledged 200.
The dirty flag is simply `S._rev > __vasSaveOk`.

- **1a · Dirty tracking in both apps.** PULSE: the two stamps above. Ops: the
  same pair around its `store()`/cloud push for `cb-config`.
- **1b · A persistent banner, not a toast.** When dirty for more than ~90 s,
  a fixed red strip: *"⚠ Not saved to the database since 07:12 — retrying…"*
  It stays until a save is acknowledged. A toast is a note; unsaved data is a
  *state*, and states get persistent UI. (This alone turns the four-day
  incident into a ninety-second one — Ashton would have seen a red bar that
  never cleared, on day one.)
- **1c · Automatic retry with backoff.** 30 s → 2 min → 5 min (capped) while
  dirty; reset on success. Today a failed save waits for the next user edit to
  try again — a quiet afternoon means hours of exposure.
- **1d · Exit guard.** `beforeunload` prompt while dirty: "Your upload is NOT
  saved to the database yet." The `pagehide` keepalive push stays as-is; the
  prompt is for the case where that push cannot succeed either.
- **1e · No swallowed throws.** Done for PULSE in `da1053e` (the outer catch
  now names the error); port the same to the Ops save chain.

**Acceptance** — new `nicks_code/diagnostics/verify-save-acks.mjs`
(Playwright): stub `fetch` to fail → banner appears within 90 s, retries fire
on schedule, unload prompts; unstub → next retry succeeds, banner clears,
`__vasSaveOk` advances. Run against both apps.

---

## Phase 2 — the Worker notices what did NOT arrive

*Closes class 3 (and gives class 1 a server-side shadow). Files:
`worker/src/index.mjs` (the existing 10-minute cron), new
`supabase/migration-015-write-log.sql`.*

- **2a · `kv_write_log` table.** One row per successful `/api/kv` POST:
  `key, bytes, username, at`. RLS on, no policy (Worker-only, like everything
  else). This is the ground truth for "when did each store last actually
  move", queryable, with history — the `rules` pointer only holds the latest.
  Retention: the cron deletes rows older than 90 days.
- **2b · Freshness sentinel in the cron.** The rule is *derived from
  activity*, not a fixed schedule (the floor doesn't upload on Sundays, and a
  fixed "must move daily" rule would cry wolf):
  - if `kv:upload-manifest` moved and **neither** `kv:vas-state` nor
    `kv:cb-config` moved within **60 minutes** after it → alert. (Files
    arriving while the state freezes is the *exact* signature of this
    incident — the relay worked, the save didn't.)
  - absolute backstop: a state key older than **26 h** on a day with any
    successful staff login → alert.
- **2c · `kv:health-alerts`.** The cron writes alerts there; both apps
  already poll `kv-meta` every couple of minutes, so they read this key on the
  same tick and show an **admin/exec-only banner**: *"PULSE uploads are being
  archived but the state has not saved since 27 Aug 17:10 — saves may be
  failing for everyone."* The alert clears itself when freshness recovers.
  No new infrastructure, no email dependency — the people who can act see it
  inside the tool they already have open.
- **2d · `store_freshness` SQL view.** Named sentence-checks (precedent:
  `agent_sync_integrity`): *"upload-manifest is newer than every state key"*,
  *"vas-state older than 26h with logins today"*, each with a failure count,
  so a human or a script can `SELECT` the health of the stores.

**Acceptance** — `verify-store-freshness.mjs`: seed the probe timestamps into
a throwaway key-pair, run the sentinel logic in dry-run, assert the alert
appears and then clears.

---

## Phase 3 — test where the failure lives: a real browser at the real origin

*Closes class 4. This is the one that would have stopped the incident from
shipping at all.*

- **3a · `verify-cors-headers.mjs`** (shipped in `da1053e`). Static half in
  every audit: it scans every client for request headers it sets and fails if
  the Worker's allow-list is missing one. `--live` drives real Chromium at the
  deployed origin.
- **3b · New `verify-live-save.mjs --live`.** The full round trip in a real
  browser at `https://chatterbox-agentos.pages.dev`: mint a short-lived
  session (the `verify-cm-live.mjs` pattern), have the page perform a real
  gzipped POST to a `zz-` probe key, read it back, delete it. The assertion is
  the round trip — not "the server accepted a Node request".
- **3c · Post-deploy smoke, wired into `/deploy`.** The deploy flow becomes:
  prepare → verify → `wrangler deploy` / `pages deploy` → **3a `--live` +
  3b**. A deploy is not *done* until a real browser has saved through the
  deployed pair. The gzip change would have failed this within a minute of
  shipping, on 28 August, instead of surfacing by client email on the 31st.
- **3d · CLAUDE.md non-negotiable.** Add: *"Node fetch proves nothing about
  CORS. Any change to the headers or fetch options a browser client sends
  must pass `verify-cors-headers --live` before deploy. Widening the server
  allow-list never rescues a cached preflight (Max-Age 86400) — the client
  must be able to work without the new entry for 24 h."*

---

## Phase 4 — recovery points in the Supabase database

*Closes class 5. This incident's data came back only because the raw-file
relay happens to archive uploads; the next loss may be in a store the relay
does not cover.*

- **4a · Daily state snapshots.** The cron copies `raw/kv/vas-state` and
  `raw/kv/cb-config` to `raw/kv-history/<key>/<YYYY-MM-DD>.json.gz` — once
  per day, on the first tick after the key changed that day. Stored gzipped:
  vas-state is ~0.6 MB compressed, so 30 retained days ≈ 20 MB. The cron
  prunes beyond 30.
- **4b · Restore tool.** `tools/restore-state.mjs --key vas-state --date
  2026-08-27` prints what it would restore (size, date, row counts) and does
  nothing; `--apply` writes the snapshot back to the live object and updates
  the pointer row. The wipe-guard's `409` story is then complete: a bad write
  is *blocked*, and a bad write that got through is *reversible*.
- **4c · Probe hygiene.** The cron deletes any `zz-*` keys older than a day
  (tests already clean up after themselves; this is the belt to that braces).

---

## Phase 5 — the database enforces its own hygiene

*Rides along with Phase 2's migration.*

- **5a · `migration-015-write-log.sql`** carries `kv_write_log`, the
  `store_freshness` view, and the retention function — same idempotent
  IF-NOT-EXISTS discipline as 014.
- **5b · The daily health check grows a freshness section.**
  `verify-all-tabs.mjs` (the "run after any upload-affecting change" suite)
  reads `store_freshness` and fails on any non-zero check, so the daily habit
  now covers persistence as well as calculation.
- **5c · CLAUDE.md layout table** gains the new table/view and the restore
  tool, so the next session knows they exist.

---

## Rollout order and rough size

| Order | Phase | Touches | Size |
|-------|-------|---------|------|
| 1 | P1 banner + retry + exit guard | both app HTMLs, one new diag | ~150 lines across 2 apps |
| 2 | P2 + P5 write log, sentinel, alerts, view | migration-015, cron block, both apps' poll handler | migration + ~80 Worker lines + ~30/app |
| 3 | P3 live save test + deploy smoke | one new diag, `/deploy` flow, CLAUDE.md | ~120 lines |
| 4 | P4 snapshots + restore tool | cron block, one new tool | ~100 lines |

Phases 1–2 are the protection and go first. 3 is the proof and gates every
deploy after it lands. 4 is the parachute.

---

## Already shipped (the baseline this plan builds on)

- The CORS fix itself (`da1053e`): client no longer sends `Content-Encoding`;
  Worker allow-list widened; gzip decided by magic bytes as it always was.
- `verify-cors-headers.mjs` — static header scan + `--live` browser preflight
  and write.
- Save-failure toasts now name the action to take, and the save chain's outer
  catch no longer swallows throws (PULSE).
- `window.__vasSaveOk` — the acknowledgement stamp Phase 1 builds on.

---

## Acceptance: the incident, replayed against the finished plan

| What happened on 28–31 Aug | What happens once this plan lands | Latency |
|---|---|---|
| The gzip-header deploy shipped broken | Post-deploy smoke (P3c) fails; the deploy is not done | ~1 min after deploy |
| Every save silently refused for 4 days | Persistent red banner in every open tab (P1b); retries in the background (P1c) | ~90 s |
| Server had no idea | Cron sentinel: manifest moved, state didn't → `kv:health-alerts` → admin banner in both apps (P2b/c) | ≤ 70 min |
| Data discarded on refresh | Unchanged risk window, but bounded by the above — and the previous day's snapshot exists regardless (P4a) | restore point ≤ 24 h |
| Detected by a client email on day 4 | Detected by the deploy smoke on day 0, and independently by the banner and the sentinel | — |
