---
description: "Tasks — 015 Wimpy order history (each person sees only their own orders)"
---

# Tasks: Wimpy order history

**Input**: spec.md, plan.md, research.md, data-model.md, contracts/wimpy-orders.md, quickstart.md
**Tests**: REQUIRED (constitution VII + Nick's "no one elses") — every check is run RED on the current code first.
**Rules**: no deploy, migration, secret or live HighLevel/Supabase write without Nick's go-ahead; the key lives only in the
git-ignored `wimpy-highlevel.env` and (at release) Worker secrets; ES5 in wimpy/index.html.

## Phase 1: Setup

- [x] T001 Create the guard skeleton nicks_code/diagnostics/verify-wimpy-history.mjs (real worker/src/index.mjs in-process;
  stubbed fetch for Supabase PostgREST tables wimpy_orders / wimpy_hl_contacts / app_sessions, HighLevel v2 and the n8n
  webhook; two accounts "thandi" CB901 and "sipho" CB902) and register it in .github/workflows/verify.yml
  — evidence: skeleton RED 2 passed / 1 failed (GET /api/wimpy/orders → 403 "Not permitted."); registered in verify.yml's credential-free loop
- [x] T002 Write supabase/migration-055-wimpy-order-history.sql per data-model.md (tables, indexes, RLS on, revokes,
  service_role grants) — NOT applied
  — evidence: 28 static checks RED (file absent) → all 29 T002 checks green; adds hl_contact_seed (data-model.md updated); not applied

## Phase 2: Foundational

- [x] T003 New worker/src/wimpy-hl.mjs: HighLevel client (Bearer + Version header, 8 s timeout per call, redacted errors
  ≤ 300 chars), pipeline/stage resolution by NAME ("Wimpy Pipeline", "New Order") cached per isolate, config check
  (WIMPY_HL_API_KEY / WIMPY_HL_LOCATION_ID present)
  — evidence: 4 checks RED (module absent) → 19/19 T003 checks green (8 s abort measured 8005 ms; key/location/phone redacted)
- [x] T004 Route scheduled() in worker/src/index.mjs by an explicit three-way match (tick / COACHING_CRON / new WIMPY_CRON
  "7,27,47 * * * *") and add the trigger to worker/wrangler.toml
  — evidence: 20 checks RED (the Wimpy cron and "0 5 * * *" both ran the coaching wave) → 23/23 green; cronKind() matches the
  minute field as a set (whitespace/order forgiven); unknown = logged + kv:cron-log kind:'unknown', one subrequest

## Phase 3: User Story 3 — every order reaches the kitchen board, never breaking ordering (P2, built first: US1 reads it)

- [x] T005 [US3] Tests: order with HighLevel up → ledger row + contact (once) + note + card at New Order + row written;
  second order reuses the contact; HighLevel 5xx / timeout / duplicate refusal / missing config → order reply unchanged
  (200), row failed|pending with reason; n8n failure → NO ledger row (order not placed); ledger insert failure → order
  still 200
  — evidence: 43 order-path checks written; RED on the pre-T006 code = 27 failed (no ledger row, contact, card or report),
  the byte-for-byte n8n body / call order / unchanged reply checks already green (they pin what must NOT change)
- [x] T006 [US3] worker/src/wimpy.mjs submitWimpyOrder(env, user, body, now, ctx): after n8n OK insert the ledger row
  (owner = user.user_id) and ctx.waitUntil(writeOrderToHighLevel); worker/src/index.mjs passes ctx
  — evidence: T005 27 RED → all 43 green; measured 10 subrequests (first order, cold) / 7 (repeat) ≤ 11; verify-wimpy 182/182
  unchanged (a call with no session user_id records nothing); ledger failure → kv:wimpy-ledger-failed (no personal data)
- [x] T007 [US3] writeOrderToHighLevel + retryDueOrders in worker/src/wimpy-hl.mjs (backoff 2·5·10·20·40·80·160 min, stuck
  after 8, ≤ 5 rows per cron run, kv:wimpy-hl-status counts without personal data)
  — evidence: writeOrderToHighLevel proven by T005 (27 RED → green); retryDueOrders by T008 (RED on the T004 stub, then green).
  Card BEFORE note (deviation from plan order: a refused card would otherwise add a duplicate note on every retry);
  claimDue() = one atomic PATCH so two runners never write one card twice
- [x] T008 [US3] Tests + code: the Wimpy cron retries due rows; ≤ 42 subrequests per run; stuck rows raise a health alert
  (worker/src/health.mjs)
  — evidence: 18 RED (pre-T007 retry stub, no health code) → 26/26 green; measured worst-case cron 40 ≤ 42 (5 rows, cold
  pipeline, every row creating a contact + losing the link race), next run 18; alerts wimpy-hl-stuck / -not-configured /
  wimpy-ledger-failed ride the sentinel's first select (no extra subrequest)

## Phase 4: User Stories 1 + 2 — my orders, and nobody else's (P1)

- [x] T009 [US1] [US2] Tests: GET /api/wimpy/orders as thandi → only thandi's rows (newest first, ≤ 50, items, total, SAST
  time, stage from her card); as sipho → only his; with ?cb=CB902 / ?user= / ?contact= / ?owner= / a body naming sipho →
  still only thandi's; a HighLevel card under thandi's CB but another contact → ignored; a card id not on her rows →
  ignored; HighLevel down → orders with stage null + stage_note; no session → 401; referrals-scoped session → refused;
  reply never contains a phone, HighLevel id, the key or the location id
  — evidence: 47 isolation checks written; RED = 30 failed (route absent → 403/404); the negative checks (no sipho data,
  no ids/secrets, 401/403 refusals) are green on both sides by design
- [x] T010 [US1] [US2] listMyOrders in worker/src/wimpy-hl.mjs + the route in worker/src/index.mjs inside the wimpy fence
  (owner = session user_id only; parameters ignored; own due rows retried via waitUntil, ≤ 2)
  — evidence: T009 30 RED → 47/47 green (suite 186/186); measured 5 subrequests (plain look), 8 (with her own retry),
  15 worst case (3 due, cold link + race, cold pipeline) ≤ 21; route answers Cache-Control: no-store; on PORTAL_ALLOWED
- [x] T011 [US1] Tests (Chromium, real page): "My orders" from the menu AND from the closed-window screen; list, empty
  state, "History starts <date>", Refresh, stage chip; sign-out / 401 clears it before the next person signs in; ES5 scan
  — evidence: 23 page checks written (menu + closed menu, list/empty/refresh/back, notes escaped, no query string,
  sign-out + late-reply + 401 clearing, stages-unavailable note); RED = no #wpMine, no /api/wimpy/orders in the page
- [x] T012 [US1] wimpy/index.html "My orders" view (ES5), cleared in wReset(); WIMPY_HISTORY_SINCE in worker/src/wimpy.mjs
  — evidence: T011 RED → 24/24 green (suite 212/212); a mutant page without the wReset clear + epoch guard fails exactly the
  two memory checks; WIMPY_HISTORY_SINCE = '2026-10-08' (release sets the real day), shown as "History starts 8 October 2026"

## Phase 5: Polish

- [x] T013 Run verify-wimpy-history, verify-wimpy, verify-wimpy-signin, verify-agent-sweep-014, verify-worker-sweep-014,
  verify-digest-fence, verify-session-name; `node tools/prepare-site.js`
  — evidence (2026-10-07, after prepare-site build muy6feq3): wimpy-history 212/212 (also on site/ copy), wimpy 182/182
  (also site/), wimpy-signin 59/59, agent-sweep-014 71/71 (also site/), worker-sweep-014 71/71, digest-fence 105/105,
  session-name 19/19, cm-signoff-worker 253/253, coaching-wave 70/70, agent-portal 86/86, roster-propagation 15/15,
  roster-changes 31/31, store-freshness 78/78, agent-analytics 169/169. Secret scan: the key is in no repo file; the
  location id found in research.md (pre-existing) was redacted
- [x] T014 code review + security review (no CRITICAL/HIGH; no path returns another person's orders); R1–R10 fixed test-first (see Review section)
- [x] R1 (M1) ledger insert moved off the reply path into the same waitUntil chain as the card (wimpy.mjs recordOrder) —
  RED: a 30 s Supabase stall held the confirmation 30005 ms → GREEN: reply in < 1.5 s, unchanged, row + card land after
- [x] R2 (M2) one order, one card: the card id is recorded in the "written" patch straight after the card, before the note;
  a claimed retry whose person already had a contact searches for the card named for THIS order (cardNameFor: CB · total ·
  time · #order-tag) and reuses it unless another row records it — RED 5 (2 cards after an 8 s abort / a failed patch) → GREEN 7/7
- [x] R3 (M3) due rows selected directly (pending|failed, hl_next_at ≤ now, order hl_next_at, limit 5); counts from a separate
  light select — RED: 250 stuck rows hid the due row → GREEN: due row written, 250 stuck counted
- [x] R4 (M4) hl_contact_seed cleared on written, on stuck, and on any attempt once the person has a contact link;
  data-model.md updated — RED 4 → GREEN 5/5 (a row still waiting to create its contact keeps it)
- [x] R5 (L1) per-row claim = compare-and-set on hl_tries (tries + 1, lease); a row already at 8 tries is marked stuck by that
  claim; failWith no longer double-counts claimed rows — RED: never stuck after 12 runs → GREEN: stuck after 8 claims / 8 attempts
- [x] R6 (L2) a full search page (100) without an order's card → "could not be reached", never "gone" — RED 1 → GREEN 2/2
- [x] R7 (L3) one HighLevel read per person per 10 s, isolate map keyed by the session user_id only; inside the window her own
  copy answers, an unseen card says "Updated a moment ago" — RED 4 → GREEN 4/4 (sipho gets his own read in the same 10 s)
- [x] R8 (L4) the typed first/last name redacted from hl_error (and the note-failure log) — RED 1 → GREEN
- [x] R9 (L5) the Wimpy cron's catch logs dbWhy(env, e), not the raw message — RED (key + phone in the log; SC-005 too) → GREEN
- [x] R10 (L6) contact tags ['wimpy', '<cb lower-case>'] (a manager: their username) — RED 2 → GREEN 2/2
  Re-measured subrequests: order 10 (cold) / 7 (repeat) ≤ 11 · history 5 plain / 9 own retry / 16 worst ≤ 21 · Wimpy cron 41 worst
  (5 rows, cold pipeline, every row creating a contact + losing the link race), 19 next run ≤ 42.
  Kept: the coordinator's scheduled() change — an unknown trigger falls back to the coaching wave (kind 'unknown').
- [x] T015 RELEASED 2026-10-07 with Nick's go-ahead ("Release now, switch it on later"): migration-055 applied (RLS on, anon no select), Worker secrets WIMPY_HL_API_KEY + WIMPY_HL_LOCATION_ID, Worker 03191223 (crons */10 · 3,23,43 · 7,27,47), Pages muy874bb; smoke CORS 13/13, live save 5/5; ONE TEST order (aarav, Mzansi Brekkie R45.90, notes "TEST - please ignore") → kitchen 200, ledger written, card at New Order, My orders shows it, no key/location/phone in the reply, no session → 401. OPEN: Nick turns ON "Allow Duplicate Opportunity" — until then a person's 2nd+ order retries then goes stuck (health alert)

## Dependencies

T001–T004 → US3 (T005–T008) → US1+US2 (T009–T012) → T013–T015. Tests before code in every story.

## After release (2026-10-08)

- [x] R11 HIGH the Wimpy retry trigger "7,27,47" was registered with Cloudflare (schedules API lists it) but NEVER invoked —
  0 runs in 18 h while "3,23,43" ran 54 times (workersInvocationsScheduled). Coaching and the Wimpy retry now share ONE
  trigger "3,7,23,27,43,47 * * * *"; index.mjs cronKind picks the job by event.scheduledTime's minute (3/23/43 coaching,
  7/27/47 Wimpy; no time → coaching). verify-wimpy-history: 11 RED → 251/251. Deployed (Nick: "Deploy and commit") as Worker
  a4cf3dd7; confirmed live: coaching 09:03:56 success, Wimpy 09:07:55 stamped kind "wimpy" + first kv:wimpy-hl-status
  (configured, 0 due). Unrelated, pre-existing: 27 of 992 ticks this week ended exceededResources (18 on 4 Oct) — follow-up.

