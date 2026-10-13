# Research: 033 — the Coaching Hub, exactly as it is, as a campaign manager tab

All findings 2026-10-13, read-only. Nothing in the Hub, Convex or the database was written. No key was stored.

## R1 — Can the Hub be shown inside Agent Analytics?

- `curl -I https://coaching-hub-psi.vercel.app/` → `HTTP/1.1 200`, `Server: Vercel`, **no `X-Frame-Options`, no
  `Content-Security-Policy`** (so no `frame-ancestors`). The Hub does not refuse to be framed.
- Agent Analytics' headers (`site/_headers`, the committed source — `tools/prepare-site.js` does not generate it):
  `default-src 'self'; … connect-src 'self' <worker> <supabase>; worker-src 'self' blob:; frame-ancestors 'self'`.
  There is **no `frame-src`**, so frames fall back to `default-src 'self'` and a frame of the Hub is blocked by OUR
  page. One line fixes it: `frame-src https://coaching-hub-psi.vercel.app`.
- **Decision**: embed the live Hub. `connect-src` is untouched (the Hub talks to Convex from ITS origin, not ours);
  `frame-ancestors 'self'` untouched; a new directive naming one origin is the whole CSP change. CLAUDE.md's `_headers`
  line and the constitution's Platform Constraints get the sentence.

## R2 — Why not rebuild the interface natively?

- The Hub's front-end source is not on this machine (`find` for coaching-hub/kpi-hub dirs: nothing; the only hits for
  the Convex host are the suite's own proxy and notes). The deployed bundle is 1.4 MB minified React + react-router +
  recharts + jsPDF + html2canvas.
- A native copy inside an ES5 single-file page would (a) take weeks, (b) be a copy — every change Nick makes in the Hub
  would have to be re-copied, (c) still not be "exactly like it is".
- The Convex deploy key Nick supplied would allow administering the backend (and reading function source), not the
  front-end. It is not needed for anything in this feature and was not written anywhere. **Recommend rotation** since
  it was pasted into a chat.
- **Decision**: no rebuild. If Nick shares the Hub's repository later, the variant "build the Hub into Pages under
  `/agent/hub/` and frame it same-origin" gives identical behaviour with no CSP exception; the page code is the same.

## R3 — The re-render problem

- `shell()` rewrites `#root.innerHTML` on EVERY `render()`; the CM view re-renders on the 60 s range re-ask, live
  refreshes, coaching loads, P1 marker changes. A frame inside `#root` would reload each time and lose the manager's
  place in the Hub. Moving a frame node in the DOM also reloads it.
- **Decision**: ONE frame element, created on first entry to `cm_hub`, appended to `document.body` (outside `#root`),
  `position:fixed`, shown/hidden with `display`, positioned over a placeholder `#cmHubHost` the shell draws on `cm_hub`
  (synced on render, `resize`, `orientationchange`). `src` is set once; re-renders never touch the element.
  `resetClientState()` removes it (sign-out, 401).

## R4 — Sizing without a second scrollbar

- `.main` has `padding:20px 26px 34px`; the topbar is inside `.wrap`. The host is drawn after the topbar with
  `height: calc(100vh - <host top>)` computed at sync time, and `document.body` gets class `cmhub-open` while the tab
  is open so the page itself does not scroll (`overflow:hidden`). On a phone the sidebar is an overlay; the host spans
  the full width.
- **Decision**: `cmHubSync()` reads `#cmHubHost.getBoundingClientRect()` and copies top/left/width/height to the frame.

## R5 — Frame attributes

- Cross-origin frames are already isolated from our page; a `sandbox` attribute would restrict the HUB (its own
  storage, downloads). The Hub needs downloads (PDF) and popups are not needed.
- **Decision (amended after the security review, 2026-10-13)**: `<iframe id="cmHubFrame" src="…/?theme=agentos"
  title="Coaching Hub" referrerpolicy="no-referrer" allow="clipboard-write" loading="eager" sandbox="allow-scripts
  allow-same-origin allow-forms allow-downloads allow-popups allow-popups-to-escape-sandbox allow-modals">` — the one
  token left out is `allow-top-navigation`, so a compromised Hub cannot send the whole tab to a look-alike sign-in page;
  the Hub keeps its scripts, its own origin (Convex, storage), forms, the PDF download and dialogs. Checked in a real
  browser that the Hub renders under this sandbox; the PDF download is part of the release smoke. Load detection: `onload`
  fires for cross-origin frames when the document loads; a 20 s timer without `onload` shows the words + Retry
  (Retry re-sets `src`). CSP blocks fire no `onload`, so the timer catches that case too.

## R6 — Browser storage partitioning

- Chrome/Safari/Firefox partition third-party storage by top-level site: the Hub inside our page has its OWN storage
  bucket, separate from the Hub opened directly. Consequence: the Hub may not remember the last-chosen leader between
  the two contexts. Harmless; not surfaced.

## R7 — Who can see it

- The Hub is unauthenticated by design (spec 004 note, Nick's call). Framing it for campaign managers adds nothing to
  what anyone with the address already has. The TAB is role-gated by `navFor()` and `CM_VIEWS` (campaign scope only);
  the Worker is not involved and cannot gate the Hub.
- **Decision**: no Worker change. `verify-agent-analytics`' isolation check already allows the Hub origin.

## R8 — Guards

- `verify-cm-view` S: nav order; `cm_hub` header rule; host placeholder; frame created once with the exact `src`; same
  element across re-renders and tab switches; display toggling; removal on `resetClientState`; no link as content.
- `verify-agent-analytics`: `site/_headers` carries exactly one `frame-src` origin and the other directives unchanged.
- `verify-cm-live --live`: the Hub answers without a frame-blocking header; the deployed Pages CSP contains the
  `frame-src`.
- Real-browser smoke (constitution VI): the frame renders the Hub's home and survives a forced re-render — the stubbed
  DOM cannot load a cross-origin document.

## R9 — Colours: how the Hub is painted, and where the campaign manager palette must go

Read from the deployed Hub (`assets/index-BFyiQMq7.css`, 23 KB Tailwind; `assets/index--MNM2fmm.js`):

- **Classes**: Tailwind utilities with a custom `brand` scale — `bg-brand-50 #E9F7EE`, `border-brand-200 #9FD9B0`,
  `border-brand-300 #6BC788`; `bg-gray-900` (dark header / dark buttons), `bg-gray-50/100`, `border-gray-100/200/300/900`,
  `text-gray-200…900`; status families red (7 uses), green (4), amber (3), purple/orange/cyan/blue (2 each).
- **Inline styles in the JavaScript** (the part a stylesheet cannot reach): `#00873f` ×32 and `#007438` ×11 (the brand
  green and its hover), `#eef2f7` ×5, `#eaf3ff` ×4, `#1d6af5` ×3, `#9ca3af` ×2, a few Tailwind greys as hex. Per-leader
  `avatarColor` is data from Convex.
- **No theme mechanism today**: no `:root` custom properties, no `data-theme`, no `prefers-color-scheme`. Font:
  `system-ui`.

**Why the theme must live in the Hub**: (a) CSS from our page cannot cross into a frame; (b) an override stylesheet
through a Worker proxy would recolour the ~15 classes but not the 43 inline uses without brittle
`[style*="rgb(0, 135, 63)"]` selectors; (c) rewriting the 1.4 MB bundle in the Worker is past the FREE plan's 10 ms CPU
and breaks on every Hub rebuild; (d) the Hub is Nick's app on his Vercel — a theme is a 20–40 line change there.

**Decision**: the Hub gains `?theme=agentos` → `document.documentElement.dataset.theme = 'agentos'` at boot; colours
become CSS custom properties with defaults equal to today's values; `[data-theme=agentos]` sets the campaign manager
values; inline hex uses in the JS move to those properties (`var(--brand)` etc.). Plain address = unchanged.

**Token table (Hub → campaign manager view, from `agent/index.html :root`)**

| Hub today | Where it shows | AgentOS token | Value |
|---|---|---|---|
| `#00873f` (inline), `brand-600` | primary buttons, active tabs, links, icons | `--blue` | `#2563EB` |
| `#007438` (inline hover) | hover/pressed primary | blue, darker | `#1D4ED8` |
| `bg-brand-50 #E9F7EE`, `#eaf3ff` | tints, selected rows | `--blue-soft` | `#EAF1FF` |
| `border-brand-200/300` | tinted borders | blue tint | `#BFD3FF` / `#93B4FF` |
| `#1d6af5` | secondary blue | `--blue` | `#2563EB` |
| `bg-gray-900`, `border-gray-900` | header, dark buttons | `--navy` | `#0A1730` |
| `text-gray-900/800` | headings, body text | `--ink` | `#0F1E36` |
| `text-gray-700/600` | body | `--body` | `#3B4A63` |
| `text-gray-500/400`, `#9ca3af` | muted | `--muted` | `#71809B` |
| `border-gray-100/200/300`, `#e5e7eb` | borders | `--line` | `#E3E9F3` |
| `bg-gray-50/100`, `#eef2f7`, `#f9fafb`, `#f3f4f6` | page background, wells | `--bg` | `#F2F5FA` |
| `bg-white` | cards | `--card` | `#FFFFFF` |
| red family (`#dc2626`, red-50…) | errors / fails | `--red` / `--red-soft` | `#C42D2D` / `#FBE9E9` |
| amber/orange family (`#ea580c`…) | warnings | `--amber` / `--amber-soft` | `#B45309` / `#FCF0DD` |
| green family (status, not brand) | good | `--green` / `--green-soft` | `#158A4C` / `#E6F6ED` |
| purple / cyan (category tints) | product badges | keep | unchanged |
| `avatarColor` (data) | leader avatars | keep | unchanged |
| font `system-ui` | everything | Inter (Google Fonts, as agent/index.html) | `'Inter','Segoe UI',system-ui` |

**Verification once the Hub ships it**: `verify-cm-live --live` fetches the Hub's current stylesheet (from its HTML's
`<link>`) and asserts a `[data-theme=agentos]` rule exists; the real-browser smoke checks computed colours (SC-005).

## Superseded (first draft of 033, same day)

The first draft proposed Worker routes reading each leader's documents and the manager authoring through the existing
forms under their own Hub profile (all three managers ARE profiles in the Hub's team-leader table; `app_users.hub_ids`
null for them; `hubIdsOf` is team-leader only). Nick asked for the exact Hub interface instead; that design is dropped
but the facts stand if a native view is ever wanted.
