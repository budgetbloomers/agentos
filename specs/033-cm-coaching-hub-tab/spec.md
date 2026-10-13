# Feature Specification: The Coaching Hub, exactly as it is, as a campaign manager tab

**Feature Branch**: `033-cm-coaching-hub-tab`

**Created**: 2026-10-13 · **Revised**: 2026-10-13 (Nick: "I want the exact interface when I click the tab", "below the reports",
"not a link")

**Status**: Ready for build (tab + embedding). The colour work package (US3) needs the Hub's repository — see Assumptions.

**Revised again 2026-10-13**: Nick — "customize the color of course to the campaign manager view" → User Story 3.

**Input**: Nick, 2026-10-13 — "I want a tab that says coaching hub for the campaign manager below the reports … this is
the coaching hub: https://coaching-hub-psi.vercel.app, I want the full view of the coaching hub exactly like it is,
built in the campaign manager tab … I dont want the link i want the exact interface when I click the tab"

## Context

- The **Coaching Hub** is Nick's Vercel app (`https://coaching-hub-psi.vercel.app`) on a Convex backend
  (`acrobatic-setter-212`). No sign-in; its own screens: team-leader directory ("Manage team leaders"), a leader's six
  coaching products, each document (view, edit, delete, PDF), the create forms, analytics charts.
- Its front-end source is **not on this machine**; the deployed bundle is 1.4 MB of minified React. Rebuilding it inside
  the ES5 Agent Analytics page would be a copy that drifts from the Hub every time Nick changes the Hub.
- The Hub serves **no `X-Frame-Options` and no `frame-ancestors`** (checked 2026-10-13), so a browser may show it inside
  another page. Agent Analytics' own CSP (`site/_headers`) has no `frame-src`, so today a frame of the Hub is blocked
  by our side only.
- The campaign manager view (Dalwin, Ryan, Preshen) has: Campaign · Team Leaders · Assistance · Reports · Nikola ·
  Settings, plus the "Team leaders' coaching" button above the user card.

## Decision

The tab **runs the live Coaching Hub app inside the campaign manager page**. Same screens, same look, same behaviour,
because it IS the Hub — and it follows every change Nick makes to the Hub without a redeploy here. Nothing about
the Hub, its data or its functions changes. The Convex deploy key Nick supplied is NOT needed and is NOT stored.

**Colours.** The Hub's palette (its green `#00873f`, grey header, Tailwind greys) is painted by the Hub's own code —
largely as inline styles in its JavaScript — so the campaign manager's colours cannot be applied from outside. The Hub
gains a **theme**: opened with `?theme=agentos` it wears the campaign manager palette (navy, blue, the AgentOS greys,
Inter); opened plainly it looks exactly as today. The tab opens the Hub with that parameter. This is a small change in
the Hub's repository (a token table in research R9), deployed to Vercel by Nick.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Click Coaching Hub, see the Coaching Hub (Priority: P1)

A campaign manager clicks **Coaching Hub** in the sidebar, directly below **Reports**, and the content area shows the
Coaching Hub exactly as it looks at its own address — directory, team leaders, documents, forms, PDF — and they use it
there without leaving Agent Analytics.

**Why this priority**: it is the whole request.

**Independent Test**: Sign in as Dalwin, click Coaching Hub: the Hub's home screen appears inside the page; pick a team
leader, open a document, download its PDF, create a session — each works as on the Hub's own address.

**Acceptance Scenarios**:

1. **Given** the campaign manager sidebar, **Then** the entries read Campaign · Team Leaders · Assistance · Reports ·
   **Coaching Hub** · Nikola · Settings; "Team leaders' coaching" above the user card is unchanged.
2. **Given** the Coaching Hub tab, **Then** the content area is the Hub app, filling the space below the page header to
   the bottom of the window, with no second scrollbar from the page itself, on desktop and on a phone.
3. **Given** the manager works inside the Hub (picks a leader, opens a form), **When** anything else on the page
   refreshes (the P1 marker, a live re-ask), **Then** the Hub does NOT reload — what they were doing stays.
4. **Given** the manager switches to Reports and back, **Then** the Hub is where they left it (it is kept, hidden).
5. **Given** the Hub cannot be shown (network, or the Hub starts refusing frames), **Then** the tab says so in words
   with a Retry — never a blank area, and never only a link.
6. **Given** sign-out, **Then** the Hub is removed from the page; the next person starts fresh.

---

### User Story 2 - Nothing else moves (Priority: P1)

Team leaders keep their own Coaching Hub tab (forms, drafts, locked lines). Agents are untouched. The manager's
"Team leaders' coaching" page, filters rule (spec 012) and every figure are unchanged.

**Acceptance Scenarios**:

1. **Given** a team leader or agent signs in, **Then** their navigation is exactly as before (no new tab).
2. **Given** the Coaching Hub tab, **Then** the header shows no campaign/tenure/period pickers and no selection line
   (its content is not a period slice — the rule spec 012 applies to Settings) and the P1 marker still shows.
3. **Given** every other tab, **Then** verify-cm-view's existing sections pass unchanged.

---

### User Story 3 - The Hub wears the campaign manager's colours in the tab (Priority: P1)

Inside the tab, the Hub's screens use the campaign manager view's palette — navy where the Hub is dark grey, AgentOS
blue where the Hub is green, the AgentOS greys, borders and background, the Inter font — so the tab reads as one
application. Opened at its own address, the Hub is unchanged.

**Why this priority**: Nick's instruction ("of course"); without it the tab is visibly a different product.

**Independent Test**: Open `https://coaching-hub-psi.vercel.app/?theme=agentos` directly: navy header, blue primary
buttons and highlights, `#F2F5FA` background, Inter. Open the plain address: green, as today.

**Acceptance Scenarios**:

1. **Given** the tab, **Then** every surface the Hub paints in its brand green (buttons, active tabs, highlights,
   tints) is in AgentOS blue / blue-soft; dark headers and primary dark buttons are navy; page background, card borders
   and text greys are the AgentOS tokens (table in research R9); status reds/ambers/greens keep their meaning in the
   AgentOS values; team-leader avatar colours (data) are untouched.
2. **Given** the Hub's own address without the parameter, **Then** nothing has changed.
3. **Given** the Hub is redeployed later, **Then** the theme travels with it (it is part of the Hub's code), and the
   live guard still finds the theme rule in the Hub's stylesheet.

---

### Edge Cases

- Browser storage partitioning: inside another page, the Hub's browser storage is partitioned per top site, so the Hub
  may not remember the last-chosen leader between visits. Accepted; said nowhere (it is the Hub's own behaviour).
- The Hub's PDF button downloads a file: the frame must allow downloads.
- A phone: the sidebar is an overlay; the Hub fills the width under the header.
- The Hub gets a `frame-ancestors` header one day: the live guard fails loudly and the tab shows the words + Retry.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The campaign manager sidebar MUST gain **Coaching Hub** (view id `cm_hub`) immediately below Reports;
  campaign managers only.
- **FR-002**: The `cm_hub` content MUST be the live Coaching Hub app (`https://coaching-hub-psi.vercel.app/`) rendered
  inside the page's content area — the exact application, not a copy and not a link.
- **FR-003**: The embedded Hub MUST survive page re-renders and tab switches without reloading (created once per
  sign-in, hidden when another tab is open), and MUST be removed on sign-out.
- **FR-004**: The Hub area MUST fill from below the page header to the bottom of the viewport and resize with the
  window; the page MUST NOT show a second scrollbar for it.
- **FR-005**: Agent Analytics' CSP (`site/_headers`) MUST allow framing exactly that one origin (`frame-src
  https://coaching-hub-psi.vercel.app`); `frame-ancestors 'self'` and every other directive stay as they are.
- **FR-006**: If the Hub does not render within a bounded wait, the tab MUST show a message in words and a Retry;
  the tab MUST NOT present a link as the content.
- **FR-007**: The header on `cm_hub` MUST carry no pickers and no selection line; the P1 marker stays.
- **FR-008**: Nothing in the Worker, the Hub, the Hub's data or `app_users` changes. No key or secret is added anywhere.
- **FR-009**: Team-leader and agent views, and the manager's other tabs, MUST be unchanged (guarded).
- **FR-010**: The Hub MUST accept `?theme=agentos` and, when present, apply the campaign manager palette (research R9
  token table) to every colour it paints — classes and inline styles alike — and load Inter; without the parameter it
  MUST render exactly as today.
- **FR-011**: The tab MUST open the Hub with `?theme=agentos` (the one `src` the frame ever gets).
- **FR-012**: The theme MUST live in the Hub's code (deployed with the Hub), never injected or rewritten from the
  AgentOS side; the Worker MUST NOT proxy or rewrite the Hub.
- **FR-013**: Status colours MUST keep their meaning (red = problem, amber = watch, green = good) in the AgentOS
  values; per-leader avatar colours (data) MUST NOT change.
- **FR-014** (Nick, 2026-10-13, screenshot of the live tab: "all I ask is to change the color to blue so it shows as if
  its part of the agent os, and remove the throughballs logo"): under `?theme=agentos` the ThroughBalls logo MUST NOT
  render anywhere in the Hub — sidebar, home, form and document headers, and therefore the PDF generated from the tab;
  at the plain address it MUST remain exactly as today.

### Key Entities

- **Coaching Hub app**: the external application at one fixed origin. Its state is its own.
- **The frame host**: one element kept outside the re-rendered page root, positioned over the content area, shown
  only on `cm_hub`.

## Success Criteria *(mandatory)*

- **SC-001**: Dalwin, Ryan and Preshen each complete, inside the tab, the Hub's own flows: pick a leader → open a
  document → download the PDF → create a session. Identical to doing it at the Hub's address.
- **SC-002**: A page refresh of the P1 marker or a live re-ask while the Hub is open leaves the Hub state untouched
  (proven in the stubbed DOM by element identity and in a real browser by a form half filled surviving a re-render).
- **SC-003**: Team leaders' and agents' navigation and payloads are byte-identical before and after (guards).
- **SC-004**: `verify-cm-view` S extended (red → green), `verify-agent-analytics` CSP check, `verify-cm-live --live`
  header checks, and a real-browser smoke of the frame rendering, all green before "LIVE".
- **SC-005**: In the tab, no element shows the Hub's green `#00873f`/`#007438` or its grey-900 header (checked in the
  real browser by computed style on the header, a primary button and a tint); the plain Hub address is pixel-unchanged.

## Assumptions

- The Hub keeps serving without `X-Frame-Options`/`frame-ancestors` (it does today; the live guard watches it).
- "Built in the campaign manager tab" is satisfied by the Hub running inside the tab; a native rebuild would need the
  Hub's front-end source and would drift — if Nick later shares the Hub repo, the same tab can host a same-origin build
  (`/agent/hub/`) with no change to this spec's behaviour.
- The Hub remains open to anyone with its address (Nick's call, spec 004); showing it to the three managers adds no
  exposure. Agents and team leaders are not given the tab; the Worker cannot gate the Hub itself.
- **The colour work needs the Hub's repository** (the Vercel project's git source). Nick gives Aarav access, or hands
  research R9 to whoever maintains the Hub. The tab ships first and simply shows the Hub's current colours until the
  Hub's theme is deployed; nothing else waits.
- Fallback if the repository cannot be had: a Worker reverse-proxy of the Hub with an override stylesheet (R9) —
  rejected as the primary path because the Hub's greens are inline styles, the free plan's CPU budget forbids
  rewriting the bundle, and a proxied copy breaks every time the Hub is rebuilt.
