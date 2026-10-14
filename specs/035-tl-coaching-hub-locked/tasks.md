---

description: "Task list — 035 the team leader's Coaching Hub tab, locked to their own workspace (PLAN)"
---

# Tasks: 035 (not started — Nick to answer spec Q1–Q3 first)

**Tests**: REQUIRED, red first.

## Phase 0 — Prerequisites
- [ ] T001 Nick answers Q1 (client-side lock accepted?), Q2 ("by others" card or drop), Q3 (keep the submit lock)
- [ ] T002 Hub repo: merge `live-source-2026-10-13` into `main` (the live code); confirm `vercel --prod` deploys from a
  folder without git metadata or with a budgetbloomers-authored commit (Hobby author block, spec 033)
- [ ] T003 `tools/map-hub-ids.mjs`: exact-name match → Charlotte Govender gets her Hub id (`--apply`)

## Phase 1 — WP-H part 1: leader mode (Hub repo)
- [ ] T004 vitest: `isLeaderMode()` from `?leader=` and session memory; route table redirects `/` and foreign workspaces;
  sidebar renders no back-to-home — RED
- [ ] T005 `src/lib/mode.ts`, `main.tsx`, `App.tsx`, `Sidebar.tsx`, `Home.tsx` — GREEN; build; preview both modes

## Phase 2 — WP-A: the frame on the team-leader tab (this repo)
- [ ] T006 `verify-tl-hub.mjs` (new): TL overview carries `hubId`; the `coach_team` tab draws the frame with
  `HUB_APP_URL?theme=agentos&leader=<hubId>` (src once, outside #root, hidden off-tab, dropped on sign-out — the 033
  invariants); no Hub id → words, no frame; the manager's tab unchanged — RED
- [ ] T007 `portal.mjs` (hubId on the TL overview), `agent/index.html` (generalise `cmHub*` to `hubFrame*` with a URL;
  `coach_team` uses it; per-account flag `tl_hub_embed` honoured until the flip) — GREEN
- [ ] T008 Deploy Worker + Pages; real-browser walk as one trial leader (own workspace only; `/` inside the frame lands home)

## Phase 3 — WP-H part 2: drafts and the submit lock inside the Hub
- [ ] T009 vitest: `submitted` defaults; `submit` flips once; `update`/`remove` refuse a submitted doc in leader mode;
  list rendering (draft openable, submitted = line); signature clearing — RED
- [ ] T010 `convex/schema.ts` + the six product modules; forms (Save draft / Submit, confirm naming missing signatures);
  `SessionList.tsx`; views/edit routes redirect for submitted docs in leader mode — GREEN; `npx convex deploy`; Vercel
- [ ] T011 `tools/migrate-worker-drafts.mjs` (dry-run → `--apply`): every `coach-draft:*` row → Hub draft under its
  owner's Hub id; report; verify counts
- [ ] T012 Q2: "by others" card on the leader-mode dashboard — the Hub needs the leader's roster codes; decide in plan
  review whether Agent Analytics passes them (short list in the URL) or the Hub reads them from a tiny public Worker JSON
  — or drop the card
- [ ] T013 Flip every leader to the embedded tab; browser walk as two leaders; `verify-coaching-drafts` /
  `verify-coaching-signature` adjusted; register `verify-tl-hub`

## Phase 4 — Follow-up spec
- [ ] T014 Retire the native TL forms, `drafts.mjs` and the Hub proxy's create path once no draft remains in the Worker
