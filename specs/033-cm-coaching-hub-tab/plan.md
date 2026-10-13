# Implementation Plan: The Coaching Hub, exactly as it is, as a campaign manager tab

**Branch**: `033-cm-coaching-hub-tab` | **Date**: 2026-10-13 (revised same day) | **Spec**: [spec.md](spec.md)

**Input**: [spec.md](spec.md) · [research.md](research.md) R1–R8 · [contracts/interfaces.md](contracts/interfaces.md) ·
[data-model.md](data-model.md) · [quickstart.md](quickstart.md)

## Summary

Add a **Coaching Hub** entry to the campaign manager sidebar directly below Reports. Clicking it shows the live Coaching
Hub application inside the content area — the exact interface, every screen, following the Hub's own updates — kept
alive across page re-renders and tab switches, removed on sign-out. One CSP directive (`frame-src` for the Hub's
origin) is added to the Pages headers. No Worker change, no data change, no key.

**Colours (revision 2)**: the Hub gains a `?theme=agentos` theme in its own code (CSS custom properties + the R9 token
table + Inter); the tab opens the Hub with that parameter. Two work packages, independent: **WP-A** (this repo: tab,
frame, headers) and **WP-B** (the Hub repository: the theme). WP-A ships first and shows the Hub's current colours
until WP-B is deployed on Vercel.

## Technical Context

**Language/Version**: page — ES5 single-file HTML (`agent/index.html`, no build); headers — Cloudflare Pages `_headers`.
**Primary Dependencies**: the Hub at `https://coaching-hub-psi.vercel.app/` (serves without frame-blocking headers).
**Storage**: none. **Testing**: `verify-cm-view.mjs` (stubbed DOM), `verify-agent-analytics.mjs` (source + headers
checks), `verify-cm-live.mjs --live` (headers), real-browser smoke. **Target**: Cloudflare Pages; desktop + phone.
**Performance**: the frame loads once per sign-in; re-renders cost nothing extra. **Constraints**: `connect-src` and
`frame-ancestors` untouched; no Worker involvement; ES5 only. **Scale**: 3 users, 2 files.

## Contracts (summary — full text in contracts/interfaces.md)

P1 nav order · P2 the view's header/body · P3 the single persistent frame (`cmHubEnsure/Sync/Hide/Drop`) · P4 styles ·
H1 one `frame-src` directive · G guards.

## Constitution Check

| Principle | Status | Note |
|---|---|---|
| I Engine decides, page paints | PASS | No figure, no rule. The page hosts an external app. |
| II Absence is not a nought | PASS | A frame that does not load shows words + Retry, never a blank. |
| III Agent List is the record | N/A | No identity join. |
| IV Like for like | N/A | |
| V Locked down by default | PASS with a documented exception | The tab is role-scoped in the page (`CM_VIEWS`/`navFor`); the Hub itself is public by Nick's standing decision (spec 004). CSP: `connect-src 'self'` stays; the new `frame-src` names ONE origin and is recorded in CLAUDE.md and the constitution (Platform Constraints, MINOR bump). Cross-origin isolation applies to the frame; no secret is added. |
| VI Saves acknowledged | PASS | Saves happen in the Hub, under its own rules; the frame is never reloaded by our page (R3), so nothing typed is lost by us. Real-browser smoke mandatory. |
| VII Every rule has a guard | PASS | S extended red first; headers check; live header checks; browser smoke. |
| Platform | PASS | Pages only; `site/_headers` is committed source, not generated. |

Post-design re-check: unchanged.

## Project Structure

```text
specs/033-cm-coaching-hub-tab/   spec · plan · research · data-model · quickstart · contracts/interfaces.md ·
                                 checklists/requirements.md · tasks.md
agent/index.html                 CM_VIEWS · navFor() · cmView() (cm_hub branch) · CMHUB + HUB_APP_URL ·
                                 cmHubEnsure/Sync/Hide/Drop · render() hide hook · resetClientState() drop ·
                                 resize/orientationchange listener · styles (P4)
site/_headers                    CSP += frame-src https://coaching-hub-psi.vercel.app
nicks_code/diagnostics/verify-cm-view.mjs          S: cm_hub (P1–P3 invariants)
nicks_code/diagnostics/verify-agent-analytics.mjs  _headers frame-src check
nicks_code/diagnostics/verify-cm-live.mjs          Hub headers + deployed CSP
CLAUDE.md · .specify/memory/constitution.md        the frame-src sentence

(WP-B, the Hub repository — not in this repo)
tailwind.config.*                 brand/gray scales → CSS custom properties (defaults = today's values)
src/index.css                     :root defaults + [data-theme=agentos] overrides (R9 table) + Inter @import under the theme
src/main.tsx (or App)             read ?theme=agentos → document.documentElement.dataset.theme
src/**/*.tsx                      inline #00873f / #007438 / #eef2f7 / #eaf3ff / #1d6af5 → var(--…)
```

**Structure Decision**: no new module; ~120 lines in the page, one directive in the headers.

## Design notes that bind the implementation

1. **One frame, outside `#root`.** Created on first entry, never moved, never re-`src`'d except by Retry; hidden with
   `display:none`; removed in `resetClientState()`. The stubbed-DOM guard asserts element identity across renders.
2. **No link as content.** The tab's HTML contains no `href` to the Hub; the failure state is words + Retry.
3. **Header rule.** `cm_hub` joins the `cm_set` branch (P1 marker only); `cmGateCard` skipped.
4. **Sizing.** `cmHubSync()` from the host's rect; `body.cmhub-open` stops the page scrolling; phone media rule.
5. **Nothing else changes here.** Team-leader/agent `navFor()` branches, `cm_coach`, the Worker, `app_users`.
6. **The theme is the Hub's.** Defaults equal today's colours so the plain address is pixel-unchanged; the tab's
   URL carries `?theme=agentos`; no proxy, no bundle rewrite, no injected stylesheet from our side (R9).

## Risks

- The Hub adds `frame-ancestors`/`X-Frame-Options` later → frame blank → our timer shows words + Retry, and
  `verify-cm-live --live` fails naming the header. Fix is on the Hub (allow `https://<pages origin>`).
- Storage partitioning → the Hub may not remember the last leader inside the tab (R6). Accepted.
- Mobile keyboards + fixed positioning: `cmHubSync` re-runs on `resize`; verified on a phone in the smoke.
- WP-B depends on access to the Hub repository. Until then the tab shows the Hub's green; nothing breaks. If the
  repository is never available, the documented fallback (Worker proxy + override stylesheet) is a separate decision
  with its own costs (R9) — not started without Nick's say-so.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| New CSP directive `frame-src <one origin>` | The exact Hub interface can only be the Hub itself | Rebuilding the Hub natively: source not available, weeks of work, a drifting copy; a link: Nick refused it |
