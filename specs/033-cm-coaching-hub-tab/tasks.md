---

description: "Task list — 033 the Coaching Hub, exactly as it is, as a campaign manager tab"
---

# Tasks: The Coaching Hub, exactly as it is, as a campaign manager tab

**Input**: `/specs/033-cm-coaching-hub-tab/` — spec.md, plan.md, research.md, contracts/interfaces.md, quickstart.md

**Tests**: REQUIRED (Constitution VII) — `verify-cm-view.mjs` section S extended and `verify-agent-analytics.mjs` headers
check, written first, seen red; `verify-cm-live.mjs --live` and a real-browser smoke at release.

**Blocked on**: WP-A (T001–T014) on nothing; release needs Nick/Aarav (Pages deploy). WP-B (T015–T020, the colours)
needs access to the Hub's repository (Nick) and a Vercel deploy of the Hub.

## Phase 1: Setup

- [x] T001 Baseline (2026-10-13): verify-cm-view 151, verify-agent-analytics 169, verify-live-month-page 75 green;
  verify-agent-portal F6 and verify-agent-progress (live session dots) FAIL BEFORE this change too — pre-existing, left alone
- [x] T002 Hub headers re-checked: no `x-frame-options`, no `content-security-policy` (R1)

## Phase 2: Tests first (RED)

- [x] T003 [P] [US1] [US2] DONE as verify-cm-view section **T** (14 checks, red first — 10 failed before the page change): nav for the campaign scope lists Reports
  immediately followed by "Coaching Hub" (`data-view="cm_hub"`), then Nikola, Settings; team-leader and agent navs
  unchanged; on `cm_hub` no `cmSel/cmTenure/cmPeriod/cmSelection/cmEod/cmToCampaign/cmRangeCard`, P1 marker kept,
  subtitle "The Coaching Hub — exactly as it is", `#cmHubHost` present, no `href=` to the Hub in the tab; after render
  exactly ONE `#cmHubFrame` appended to `body` with `src === 'https://coaching-hub-psi.vercel.app/?theme=agentos'`, `title`,
  `referrerpolicy="no-referrer"`; a second render and a `cm_mtd` → `cm_hub` round trip keep the same element and
  `src` is assigned once; `display` none off-tab / block on-tab; `body.cmhub-open` toggles; `resetClientState()` removes
  the element; failed state (timer) shows "did not load" words + `#cmHubRetry`, Retry re-assigns `src`; ES5 only;
  no `undefined`/`NaN` — RED (stub DOM: `document.body.appendChild`, `getBoundingClientRect`, `setTimeout` capture)
- [x] T004 [P] [US1] verify-agent-analytics new section (5 checks, 3 red first): `site/_headers` CSP contains `frame-src https://coaching-hub-psi.vercel.app`
  and no other `frame-src` source; `frame-ancestors 'self'` present; `connect-src` value unchanged — RED

## Phase 3: Build (GREEN)

- [x] T005 [US1] agent/index.html: `CM_VIEWS` += `cm_hub`; `navFor()` campaign order (P1); `cmView()` — `cm_hub` in the
  `cm_set` header branch, `subs.cm_hub`, no gate card, body = `cmHubBody()` (host div, or words + Retry when failed);
  no footer on this tab
- [x] T006 [US1] [US3] agent/index.html: `HUB_APP_URL` = the plain address (reuse where it is hard-coded today — the TL
  footer link and `COACH_HUB_URL`) and `HUB_TAB_URL` = `HUB_APP_URL + '?theme=agentos'` for the frame, `CMHUB` state, `cmHubEnsure/cmHubSync/cmHubHide/cmHubDrop` (P3), `render()` calls
  `cmHubHide()` when `VIEW!=='cm_hub'` and `cmHubEnsure()+cmHubSync()` after painting `cm_hub`; `resetClientState()`
  calls `cmHubDrop()`; one `resize`/`orientationchange` listener; `#cmHubRetry` wiring; styles (P4)
- [x] T007 [US1] site/_headers: `frame-src https://coaching-hub-psi.vercel.app` added to the CSP line (nothing else)
- [x] T008 GREEN: verify-cm-view 165/165, verify-agent-analytics 174/174, verify-live-month-page 75/75,
  verify-coaching-drafts 85, verify-coaching-signature 59, verify-cm-signoff-worker 253; `tools/prepare-site.js` run
  (site/agent/index.html carries the tab). Trap met on the way: a `git stash` round trip flipped the page to CRLF and
  every page suite said "could not find the page script" — normalised back to LF

## Phase 4: Guards, docs, review

- [x] T009 verify-cm-live.mjs section H: `HEAD` the Hub (no `x-frame-options` / `frame-ancestors`), the deployed `/agent/`
  CSP carries the `frame-src`, the Hub stylesheet carries `[data-theme=agentos]` (red until the Hub repo branch is
  deployed). Runs with `--live` after the Pages deploy (T012)
- [x] T010 Reviews done 2026-10-13. Security: none above LOW; adopted both LOW items — a `sandbox` without
  `allow-top-navigation` (the Hub renders under it, checked in a browser; PDF download stays in the release smoke) and
  hiding the frame on a `PW_OPEN` render. Code review: HIGH — `preShell()` (change password, fatal, sign-in) rewrote
  #root without `render()`, so the frame stayed over those screens → `cmHubHide()` first thing in `preShell()`, guarded
  (section T); MEDIUM — frame breakpoint 900 px vs the sidebar's 860 px → 860; LOW — a late `onload` now re-renders to
  take the failure card down
- [x] T011 CLAUDE.md `site/_headers` line amended; constitution 1.5.0 → 1.6.0 (Platform Constraints bullet + Sync
  Impact line)

## Phase 5: Release (Nick or Aarav)

- [x] T012 LIVE 2026-10-13 (Nick: "deploy it"): Pages deployment `db1feafa` (`--commit-dirty`); verify-cors-headers 13/13,
  verify-live-save 5/5; verify-cm-live --live: section H green except the Hub theme (Vercel had not rebuilt the Hub yet —
  main was fast-forwarded to 9b9326b and pushed; if Vercel does not auto-deploy from main, redeploy in the Vercel
  dashboard). Two unrelated pre-existing FAILs in that suite (Worker conversion denominator; /api/kv answers 400)
- [x] T013 Browser smoke on production as Dalwin (minted 15-min session, deleted after): sidebar Campaign · Team Leaders ·
  Assistance · Reports · **Coaching Hub** · Nikola · Settings; the Hub renders inside the tab (frame child of body,
  sandboxed, src with ?theme=agentos, no pickers, no link); `render()` twice → same element, loaded; Reports → hidden,
  back → same element shown; sign-out → frame gone, login shown. NOT yet checked: PDF download inside the sandbox and
  phone width — do these on a real device when the theme is live
- [x] T014 Committed `920c55e` on feature/campaign-manager-theme-wimpy (no push); memory note updated

## Phase 6: WP-B — the Hub wears the campaign manager palette (US3; the Hub repository)

- [x] T015 [US3] Hub repository: `https://github.com/budgetbloomers/coaching-hub` (Nick, 2026-10-13); cloned to
  `C:\Users\aarav\repos\coaching-hub` (outside OneDrive), branch `feat/agentos-theme`
- [x] T016 [US3] `tailwind.config.js` + `src/index.css`: brand, gray, red, green, amber and `page` as `rgb(var(--…) /
  <alpha-value>)` scales; `:root` = today's values; `[data-theme="agentos"]` = the R9 table; Inter via a `<link>` the
  boot adds under the theme only (not an `@import` — the plain address loads no font)
- [x] T017 [US3] `src/main.tsx` `applyTheme()`: `?theme=agentos` → `html[data-theme=agentos]`, remembered in
  `sessionStorage` (in-app navigation drops the query string; a reload inside the tab keeps the theme — proven);
  `?theme=default` forgets it
- [x] T018 [US3] Arbitrary-value classes → scale classes in 14 files (`bg-[#00873f]`→`bg-brand-600`,
  `hover:bg-[#007438]`→`hover:bg-brand-700`, `bg-[#eef2f7]`→`bg-page` …); colour STRINGS (signature pen, chart ticks /
  grid / tooltip cursor, avatar fallback) through `src/utils/theme.ts cssColor()`; product chart colours, avatar
  colours and the group-signature ink untouched
- [x] T019 [US3] `npm run build` + eslint clean; real browser (chrome-devtools): plain build vs live Hub computed
  values identical (page bg 238 242 247, h1 17 24 39, borders, brand button 0 135 63, active nav tint); themed:
  button 37 99 235, active nav 234 241 255, h1 10 23 48, bg 242 245 250, Inter, chart grid #eaeff6. Commit `9b9326b`
  on `feat/agentos-theme` — NOT pushed (Nick's call: push → merge → Vercel deploys)
- [ ] T020 [US3] After the Hub deploy: `verify-cm-live --live` theme check (contract G) green; browser smoke SC-005 in
  the tab; memory note updated

## Phase 7: WP-B follow-up — the logo (FR-014) and getting the Hub deployed

- [x] T021 [US3] Hub `src/components/ThroughBallsLogo.tsx` renders nothing under the theme — built, preview checked
  (themed: 0 logos, navy h1, --brand #2563eb; plain: logo present, unchanged), commit `b3c402d` on main, pushed
- [x] T022 DONE 2026-10-13 (Nick: "deploy"). Findings: the Hub's Vercel project IS git-linked to the repo (prod branch
  main), but the account is a Hobby team and Vercel BLOCKS any deployment whose commit author is not the Vercel user
  (`readyStateReason: "the commit author doesn't have permission…"`, `seatBlock TEAM_ACCESS_REQUIRED`) — my commits are
  authored `Aarav <nicholas@…>`, the repo's own are `budgetbloomers <110726950+budgetbloomers@users.noreply.github.com>`.
  So both GitHub builds (9b9326b, b3c402d) and a first CLI deploy were BLOCKED. The live site had been deployed from the
  CLI out of a working copy with the Team Leader KPI forms (Monthly/PIP) that never reached GitHub. Resolution: read that
  deployment's 138 source files back from Vercel's API into `C:\Users\aarav\repos\coaching-hub-live`, re-applied the theme
  + no-logo change on top (same substitutions; the five authored files were byte-identical to the GitHub base), built,
  previewed, and deployed with the CLI **with the .git folder set aside** so no author travels → `dpl_HGnoomgomfPWpSi946y2V6vtzYNr`
  READY 19:49 UTC; `coaching-hub-psi.vercel.app` now serves `index-ClThy_GB.css` with `[data-theme=agentos]`. The live
  source + theme is also on GitHub as branch `live-source-2026-10-13` (merge into main; for future GitHub-triggered
  deploys commit as budgetbloomers or add the author to the Vercel team)
- [x] T023 DONE 2026-10-13 21:52: `verify-cm-live --live` section H all green (34 passed; the 2 fails are the pre-existing
  Worker ones); production tab as Dalwin: the Hub renders in navy/blue, Inter, no ThroughBalls logo (screenshot taken);
  sign-out removes the frame. Still to do on a device: PDF download inside the sandbox, phone width

## Dependencies

WP-A: T001–T002 → (T003 ∥ T004) → T005 → T006 → T007 → T008 → (T009 ∥ T010 ∥ T011) → T012 → T013 → T014.
WP-B: T015 → T016 → T017 → T018 → T019 → T020; independent of WP-A except T020 (needs the tab live).
