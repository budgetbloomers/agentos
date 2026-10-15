---

description: "Task list — 035 the team leader's Coaching Hub tab, locked to their own workspace (PLAN)"
---

# Tasks: 035 — BUILT 2026-10-15 (deploy + browser walk open)

**Tests**: REQUIRED, red first.

## Phase 0 — Prerequisites
- [x] T001 Nick answered 2026-10-15: Q1 accepted, Q2 the tab is the Hub only ("by others" dropped from the tab), Q3 keep the lock
- [ ] T002 Hub repo: the work sits on `live-source-2026-10-13` (the live code + 035); fast-forward `main` to it when it is
  pushed. Deploys: `vercel --prod` from the clone with `.git` set aside (Hobby author block, spec 033)
- [~] T003 `tools/map-hub-ids.mjs` matches all 9 team-leader accounts (Charlotte included); `--apply` if any lacks `hub_ids.coaching`

## Phase 1 — WP-H part 1: leader mode (Hub repo)
- [x] T004 `tests/mode.test.mjs` (node:test — no new dependency; Node strips the types): `readLeaderMode` from `?leader=` and
  session memory, `?leader=` empty forgets, non-ids ignored, `leaderRedirect` for `/`, foreign and own workspaces — RED then GREEN
- [x] T005 `src/lib/mode.ts`, `App.tsx` (`LeaderGate`), `Sidebar.tsx` (no back-to-home) — GREEN; `npm run build` clean
  (four dead retired KPI files that broke `tsc` and were already absent from the live tree were removed)

## Phase 2 — WP-A: the frame on the team-leader tab (this repo)
- [x] T006 `verify-tl-hub.mjs` (new, 41 checks): Worker hubId from the session; `hubTabUrl()` per role; one frame outside
  #root, src once, dropped on sign-out; linked → host + `&leader=<id>`; unlinked → words; manager → `leader=` empty;
  archive drafts not openable; the Hub clone's sources + its own tests — RED then GREEN
- [x] T007 `portal.mjs` (hubId on the team body), `agent/index.html` (`hubTabUrl`/`tlHubLinked`/`isHubView`/`tlHubBody`;
  `coach_team` draws the frame; the manager's `cm_hub` unchanged). No per-account flag: every linked leader at once (Nick)
- [ ] T008 **Nick**: deploy Worker + Pages (after the Hub); browser walk as one leader (own workspace only; `/` inside
  the frame lands on their dashboard; save → reopen → edit → submit → locked line; the manager's tab still opens it)

## Phase 3 — WP-H part 2: drafts and the submit lock inside the Hub
- [x] T009 `tests/submit-state.test.mjs`: absent = submitted; `assertLeaderMayWrite`; `submitFields` (plain app changes
  nothing, Save draft keeps a draft, Submit stamps once) — RED then GREEN
- [x] T010 `convex/schema.ts` (+ `submitted`/`submittedAt` on the six coaching tables), `convex/lib/submitState.ts`, the six
  product modules (`create` takes `submitted`; `update`/`remove` refuse `leaderMode` on a submitted doc; `submit`),
  `FormLayout` (Save draft + Submit), `useDraftFlow` (confirm naming missing signatures, signature clearing, navigation),
  the six forms, `SessionList` (draft badge / locked line / `?locked=1` notice), the six views (redirect) — GREEN.
  `npx convex deploy --dry-run` validated the schema (no index deleted). **Deploy = Nick** (the key is his)
- [x] T011 `tools/migrate-worker-drafts.mjs` written; dry run 2026-10-15: 1 Worker draft (Denise, QA coaching, 14 Oct) to
  carry over. `--apply` after the Convex deploy (the Hub must know `submitted` first)
- [x] T012 Q2 decided: dropped from the tab (Nick: "this only, where they see their forms")
- [~] T013 `verify-coaching-drafts` adjusted (archive: no Open on a draft), `verify-cm-view` + `verify-agent-analytics` read
  `hubTabUrl()`; `verify-tl-hub` registered in CLAUDE.md. The flip IS the deploy (T008); browser walk open

## Phase 4 — Follow-up spec
- [ ] T014 Retire the native TL forms, `drafts.mjs` and the Hub proxy's create path once no draft remains in the Worker
