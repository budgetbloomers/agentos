# Contracts: 033 — the Coaching Hub, exactly as it is, as a campaign manager tab

No Worker route changes. Two surfaces: the page and the Pages headers.

## P1 — Navigation (agent/index.html)

- `CM_VIEWS` += `'cm_hub'`.
- `navFor()` for the campaign scope returns, in order: `cm` Campaign · `cm_teams` Team Leaders · `cm_assist` Assistance ·
  `cm_reports` Reports (sub-tabs as today) · **`cm_hub` Coaching Hub** (icon `ICON.coaching`) · `cm_nik` Nikola ·
  `cm_set` Settings. `cmCoachNavHTML()` ("Team leaders' coaching") unchanged.
- Team-leader and agent `navFor()` branches unchanged.

## P2 — The view (`cmView()` on `cm_hub`)

- Header `right`: the P1 marker only (same branch as `cm_set`): no `#cmSel/#cmTenure/#cmPeriod/#cmSelection/#cmEod`,
  no `#cmToCampaign`, no range form. `cmGateCard` is skipped. Subtitle: "The Coaching Hub — exactly as it is".
- Body: `<div id="cmHubHost" class="cmhub-host"></div>` (+ the words/Retry card when `CMHUB.failed`). NO footer card,
  NO "Open the Coaching Hub" link on this tab. The "Numbers updated … / Sign out" footer is omitted here (the frame
  fills to the bottom; Sign out remains in the sidebar user card).

## P3 — The frame (`cmHubEnsure()`, `cmHubSync()`, `cmHubHide()`, `cmHubDrop()`)

- `cmHubEnsure()` — if `CMHUB.el` is null: create `<iframe id="cmHubFrame" class="cmhub-frame" title="Coaching Hub"
  referrerpolicy="no-referrer" allow="clipboard-write" loading="eager" sandbox="allow-scripts allow-same-origin
  allow-forms allow-downloads allow-popups allow-popups-to-escape-sandbox allow-modals">` (security review 2026-10-13:
  everything the Hub needs, but NOT `allow-top-navigation` — a compromised Hub must not be able to steer this tab to a
  look-alike sign-in), set `src = HUB_TAB_URL` ONCE, append to `document.body`, start the 20 s timer; `onload` →
  `loaded=true`, clear timer, and re-render if the failure card was up. If it exists: nothing.
- `preShell()` (sign-in, change-password, fatal screens — they rewrite `#root` without `render()`) and a render with
  `PW_OPEN` call `cmHubHide()` first, so the frame never sits over those screens (code review HIGH, 2026-10-13).
- `cmHubSync()` — copies `#cmHubHost.getBoundingClientRect()` to the frame (`top/left/width/height`, `display:block`);
  adds `body.cmhub-open`. Called after every render on `cm_hub`, and on `resize`/`orientationchange` while open.
- `cmHubHide()` — `display:none`, removes `body.cmhub-open`. Called by `render()` whenever `VIEW !== 'cm_hub'`.
- `cmHubDrop()` — removes the element, clears the timer, resets `CMHUB`. Called from `resetClientState()`.
- Retry (`#cmHubRetry`): `failed=false`, timer restarted, `el.src = HUB_APP_URL` re-assigned (the one case `src` is
  touched again).
- Invariants: at most ONE `#cmHubFrame` in the document; `src` equals `HUB_APP_URL` exactly; the element identity is
  the same across any number of `render()` calls and tab switches.

## P4 — Styles

```
.cmhub-host{min-height:60vh}                       /* real height is set by cmHubSync from the viewport */
.cmhub-frame{position:fixed;border:0;background:#fff;z-index:5;display:none}
body.cmhub-open{overflow:hidden}                   /* the Hub scrolls inside itself; the page does not */
@media (max-width:900px){ .cmhub-frame{left:0!important;width:100vw!important} }
```

## H1 — Pages headers (`site/_headers`)

One directive added to the existing CSP line, nothing else changed:
`frame-src https://coaching-hub-psi.vercel.app`. (`frame-ancestors 'self'`, `connect-src`, `img-src` as today.)

## T1 — Theme contract (Hub side; owner: whoever holds the Hub repository)

- URL: `GET https://coaching-hub-psi.vercel.app/?theme=agentos` → at boot the Hub sets `<html data-theme="agentos">`;
  any other value or no parameter → no attribute, today's look.
- CSS: colours as custom properties on `:root` with today's values as defaults; `[data-theme="agentos"]` overrides per
  the R9 token table; every inline hex in the JS replaced by the matching property. Inter loaded (Google Fonts) under
  the theme only.
- Persistence: the attribute is set from the URL on every load (the tab always passes it); no storage needed.
- Our side (`agent/index.html`): `HUB_APP_URL` for the frame = `'https://coaching-hub-psi.vercel.app/?theme=agentos'`
  (the footer link on the team-leader tab keeps the plain address). The frame's `src` is still assigned once.

## G — Guards

- `verify-cm-view` S (extended): nav order (Reports immediately before Coaching Hub); `cm_hub` header rule; `#cmHubHost`
  present; after render on `cm_hub` exactly one `#cmHubFrame` child of `body` with `src === HUB_APP_URL`; a second
  `render()` and a round trip to `cm_mtd` and back keep the SAME element and never re-assign `src`; `display` is
  `none` off the tab and `block` on it; `resetClientState()` removes it; the tab's HTML contains no `href=` to the Hub;
  the failed state shows words + `#cmHubRetry` and no link; ES5 only; no `undefined`/`NaN`.
- `verify-agent-analytics` (new check): `site/_headers` CSP has `frame-src` with exactly `https://coaching-hub-psi.vercel.app`;
  `frame-ancestors 'self'` still present; `connect-src` unchanged from its current value.
- `verify-cm-live --live` (new checks): `HEAD` of the Hub has no `x-frame-options` and no `frame-ancestors`; the deployed
  `/agent/` response's CSP contains the `frame-src`.
- Real-browser smoke (release step, not a Node suite): the Hub's home renders inside the tab; a forced `render()` from
  the console does not reload it (a half-filled Hub form survives); PDF download works; phone width.
- Theme (after the Hub ships T1): `verify-cm-view` S asserts the frame `src` is exactly the themed URL;
  `verify-cm-live --live` fetches the Hub HTML, follows its stylesheet `<link>`, asserts a `[data-theme=agentos]` rule;
  the browser smoke checks computed colours of the header (navy), a primary button (blue) and a tint (blue-soft), and
  that the plain address still shows `#00873f`.
