# Wimpy ordering moves to VAS Analytics → Apps — implementation plan

**Asked (Nick, 2026-09-10):** "remove the wimpy tab from the agent view and put it directly into apps in
the vas analytics, and there must be no option to add-ons and edit the items, and if one person orders
send the data to the webhook, create a full implementation plan."

Status: PLAN — nothing below is built. Every step names the file it touches and the guard that proves it.

---

## 1 · What exists today (verified 2026-09-10)

| Piece | Where | Behaviour |
|---|---|---|
| Menu, prices, Big One rotation, window, pricing, webhook POST | `worker/src/wimpy.mjs` (458 lines) | The only place a price lives. `wimpyMenu(now)`, `priceOrder(body, now)`, `submitWimpyOrder(env, user, body)`. Orders are already **as-is**: any `customisations` on a line is refused, never stripped. Add-ons still exist as a *door* — `ADDONS` at 0.00 "until a price is set", drawn from the 13 core lines. |
| Routes | `worker/src/index.mjs` ~754 | `GET /api/portal/wimpy/menu`, `POST /api/portal/wimpy/order`. Sit after the session gate; reachable by any signed-in session (agent, team leader, management). |
| Page | `agent/index.html` ~3155–3720 | Tab "Wimpy Order" on the agent nav, shown only 08:00–09:00 SAST Mon–Fri (`wimpyOpenNow`, 30 s flip poll). `wimpyPage`, `wCartHTML`, `wAdd`, `wConfirmPage`, `wDonePage`, `wValidate`, `wSubmit`, `wireWimpy`, 87 `.wp-*` CSS rules, `ICON.wimpy`. |
| Identity on an order | `submitWimpyOrder` | `agent_name` = `user.full_name`, `cb_number` = `user.cb` — **both mandatory** (403 without). |
| Webhook | `WIMPY_WEBHOOK_URL` secret, else the n8n URL in the module | One POST per order, 15 s timeout, failure keeps the cart and offers Retry. Live-tested 2 Sep. |
| Guard | `nicks_code/diagnostics/verify-wimpy.mjs` (131 checks) | Module half (menu shape, rotation, overlap invariant, pricing, refusals) + page half that serves **agent/index.html** on :8298 and drives the tab. Section L fails if the operating-model tab returns. |
| VAS Apps page | `nicks_code/index.html` `PAGES.hubs` (~6830), nav id `hubs` under "Apps" | A grid of cards (`HUBS[]`): KPI Hub, Coaching Hub, Agent Analytics link — each opens an external URL. No in-page app lives there yet. |

**Who can reach VAS Analytics today** (`app_users`, active):

| Role | Accounts | Apps | Has CB |
|---|---|---|---|
| agent | 126 | agent only | yes |
| team_leader | 9 | agent only | yes |
| campaign_manager | 3 | ops, vas (+tracker) | 2 of 3 |
| exec | 8 | ops, vas, tracker | no |
| viewer | 10 | vas (+ops, tracker) | no |
| admin | 2 | ops, vas (+tracker) | no |
| qa | 1 | ops | no |

So: **after the move, no agent or team leader can order** (they cannot open VAS), and **most of the people who can open VAS have no CB number**, which today's `submitWimpyOrder` refuses. Both are decided in §2.

---

## 2 · Decisions this plan takes (say if any is wrong)

1. **Who orders.** Whoever is signed in to VAS Analytics — management, campaign managers, execs, viewers. Agents lose the tab, as asked. If agents must still order lunch, that is a different door (say so and §7 has the shape).
2. **Identity on the order.** `agent_name` ← `full_name`, falling back to `username`. `cb_number` ← `cb` when the account has one, else the `username` (so the kitchen sheet always has a stable handle). The field names stay exactly as they are so the n8n workflow needs no change. A missing *name* still refuses (a nameless order cannot be plated).
3. **No add-ons, no editing.** The add-on door is **deleted** from the module (no `ADDONS`, no `added[]` on a line, no `customisations` object at all). The page has no "customise" affordance of any kind. `priceOrder` refuses a request that carries `customisations` or `added` — it does today for customisations; add-ons join that rule. **Quantity +/− stays** (three of the same burger is not an edit of the item); flag if you want one-of-each only.
4. **One order → one webhook POST**, exactly as today; nothing is batched, nothing is queued. The Worker does the POST (browser CSP cannot reach n8n). Payload shape unchanged.
5. **Office hours stay** (08:00–09:00 SAST, Mon–Fri) unless you say otherwise. In VAS the card is *always visible* on the Apps page but says "orders open at 08:00" outside the window; the Worker still refuses out of window.
6. **Menu and prices stay where they are** (`worker/src/wimpy.mjs`) — verify-wimpy's "no price in the page" rule is extended to `nicks_code/index.html`.
7. **Where in VAS.** The Apps page (`hubs`) gets the ordering card **inline** — a card at the top of the grid that expands into the menu + cart (no new nav entry, no new tab id, so no permission grants are needed: everyone who can see Apps can order). If you would rather a dedicated "Wimpy" nav item, §7 lists the extra steps (page id + `tools/audit-permissions.mjs` + grants).

---

## 3 · Phases

### Phase 0 — Freeze the contract (½ day)
- `specs/wimpy-3331-menu.md`: add a dated `_changes` note — "add-ons removed 2026-09-xx; ordering moved to VAS Apps". The 3–3–3–1 menu, rotation and overlap invariant are untouched.
- Write the new checks FIRST in `verify-wimpy.mjs` (RED): (a) module exports no `ADDONS`, menu payload carries no `addOns`; (b) `priceOrder` refuses a line with `added[]`; (c) `submitWimpyOrder` accepts a management session `{full_name, username, cb:null}`; (d) page half drives `site/pulse/index.html` not `agent/index.html`; (e) `agent/index.html` contains no `wimpy` token; (f) none of the 14 prices appears in `nicks_code/index.html`.

### Phase 1 — Worker (½ day) — `worker/src/wimpy.mjs`, `worker/src/index.mjs`
1. Delete `ADDONS` and every reference (`wimpyMenu` payload, `priceOrder` add-on pricing, `formatOrder` "+ …" lines). Lines become `{id, quantity}` only.
2. `priceOrder`: refuse any line carrying `added`, `removed` or `customisations` with the existing wording ("comes as it is"). Keep the Big One day-lock and the window.
3. `submitWimpyOrder`: identity per §2.2. Keep 403 on a nameless account. Keep the window check first.
4. Routes: move the two routes out of the agent-portal block into the management block and rename to `/api/wimpy/menu` and `/api/wimpy/order`; keep the old `/api/portal/wimpy/*` paths answering **410 Gone** with a message for one release, so a cached agent page fails loudly rather than silently.
5. `portalOnly(user)` → 403 on the new routes (agents cannot order through the API after the tab is gone).
6. Deploy Worker; `verify-wimpy` module half GREEN.

### Phase 2 — PULSE page (1 day) — `nicks_code/index.html`
1. Port the page functions from `agent/index.html` (`wimpyPage`→`wimpyCard`, `wCartHTML`, `wAdd`, `wConfirmPage`, `wDonePage`, `wValidate`, `wSubmit`, `wireWimpy`, `wZar`, `wCents`, `wPriceInner`, `wItemDef`, `wLineCents`, `wTotalCents`, `wLoadMenu`, `wimpyOpenNow` + the 30 s flip poll) into a `/* ===== WIMPY ORDERING ===== */` block. Drop everything add-on related (`l.added`, the customise sheet remnants).
2. Move the 87 `.wp-*` rules into PULSE's stylesheet unchanged (they are namespaced; PULSE wears the Agent Analytics light skin, so colours port as-is; dark glass survives behind `data-theme='dark'`).
3. `PAGES.hubs`: render `wimpyCard()` as the first card. States: **closed** (window shut: hours + weekday text, no menu fetched), **loading**, **menu** (items with was-price + saving badge, cart with quantity +/−, total), **confirm** (read-back, Send / Back), **done** (order_formatted echo, "Order another"). No customise, no add-on, no free-text per line; `additional_notes` (≤1000 chars) stays as today — say if it must go.
4. Fetch through the existing PULSE Worker helper (`sessionStorage.cbx_token`, `X-Cbx-Client: v5`), never the agent token.
5. `PAGES._wire_hubs`: wire buttons after render (PULSE's `_wire_*` convention). Cart state lives in a page-local variable, never in the shared `S.ui` blob.
6. `tools/prepare-site.js` → `site/pulse/index.html`; `verify-wimpy` page half GREEN against the build copy.

### Phase 3 — Agent view removal (½ day) — `agent/index.html`
1. Remove the nav concat (`wimpyOpenNow()?[['wimpy',…]]:[]`), the two `VIEW==='wimpy'` guards, the header copy line, the `wimpyPage()` branch, `wireWimpy()` call, all `w*` functions, the flip poll, `ICON.wimpy`, the 87 `.wp-*` rules.
2. `verify-wimpy` check (e) GREEN; `verify-agent-analytics.mjs` and `verify-agent-card.mjs` still GREEN (nav length changes — check their nav assertions).

### Phase 4 — Guards, docs, permissions (½ day)
- `verify-wimpy.mjs`: page half now serves `nicks_code/index.html` (env `PULSE_HTML` for the build copy) on :8298, mints a **management** session, opens Apps, orders one item at a stubbed webhook (`WIMPY_WEBHOOK_URL` → local http server in the test) and asserts the payload: `cb_number`, `agent_name`, `timestamp`, `total_price`, `order.items[]` with no `customisations`, one POST per order. Keep the ingredient-overlap and rotation checks. Section L (no operating model) stays.
- `verify-controls.mjs` / `verify-all-tabs.mjs`: add the Apps card to the every-control sweep (open, add, +, −, remove, back, send-disabled-outside-window).
- No permission grants needed (§2.7). If a nav item is chosen instead: add the page id to `PAGES.vas` in `tools/audit-permissions.mjs`, run it, and grant the tab to every explicit-tabs user.
- `CLAUDE.md`: one sentence under the Agent Analytics / Wimpy note; `specs/wimpy-3331-menu.md` `_changes`.
- Memory: update `wimpy-ordering.md` (tab location, no add-on door, identity rule).

### Phase 5 — Deploy and prove (½ day)
1. `npx wrangler deploy` (worker) → `node tools/prepare-site.js` → `npx wrangler pages deploy site --project-name chatterbox-agentos --branch main`.
2. Post-deploy smoke (mandatory): `verify-cors-headers --live`, `verify-live-save --live`.
3. Real order in the window with a marked-TEST note from a management account; confirm the n8n run (`Workflow was started`) and the sheet row carries the username-as-CB when the account has no CB.
4. Out-of-window check: card says closed, `POST /api/wimpy/order` → 403.
5. Agent view: sign in as an agent between 08:00 and 09:00 — no Wimpy tab; `GET /api/portal/wimpy/menu` → 410.

---

## 4 · File-by-file change list

| File | Change |
|---|---|
| `worker/src/wimpy.mjs` | remove `ADDONS` + add-on pricing/formatting; refuse `added`/`customisations`; identity fallback (name → username, cb → username); nothing else |
| `worker/src/index.mjs` | routes `/api/wimpy/menu`, `/api/wimpy/order` in the management block with `portalOnly` → 403; old `/api/portal/wimpy/*` → 410 for one release |
| `nicks_code/index.html` | Wimpy block (functions + CSS), `wimpyCard()` first on `PAGES.hubs`, `_wire_hubs`, flip poll |
| `agent/index.html` | delete the tab, functions, CSS, icon, guards |
| `nicks_code/diagnostics/verify-wimpy.mjs` | page half → PULSE; new checks (a)–(f); stubbed-webhook payload assertion |
| `nicks_code/diagnostics/verify-controls.mjs`, `verify-all-tabs.mjs` | Apps card in the sweep |
| `nicks_code/diagnostics/verify-agent-analytics.mjs`, `verify-agent-card.mjs` | nav assertions without Wimpy |
| `specs/wimpy-3331-menu.md`, `CLAUDE.md`, memory | dated notes |

No database change. No new secret (`WIMPY_WEBHOOK_URL` already exists as an optional override).

---

## 5 · Test plan (what GREEN means)

- Module: 14 prices unchanged; `wimpyMenu()` has no `addOns`; `priceOrder({items:[{id, quantity:2}]})` prices; `priceOrder` with `added:[…]` → refused with the as-is wording; wrong-day Big One → refused by name; window closed → 403 before pricing.
- Identity: `{full_name:'X', cb:'CB1'}` → `cb_number:'CB1'`; `{full_name:'X', username:'dalwin', cb:null}` → `cb_number:'dalwin'`; `{username:'x'}` with no name → 403.
- Page (PULSE, headless): Apps shows the card; outside the window it shows hours and fetches nothing; inside, add → cart → confirm → send hits the stub exactly once with the shape in §2.4; a 502 from the stub keeps the cart and shows Retry; no element in the card carries "customise", "add-on", "extra".
- Agent page: no `wimpy` token; nav has four tabs for an agent.
- Prices: none of the 14 appear in either page.
- Existing: `verify-wimpy` sections on rotation, overlap and section L all still pass.

---

## 6 · Risks and what limits them

- **People with no CB.** Handled by the username fallback; the kitchen sheet column reads a username for execs/viewers/admins. If the sheet must be CB-only, those roles cannot order — decide before Phase 1.
- **Cached agent pages** after Phase 3: a phone with the old tab open gets 410 with a message, never a silent failure.
- **Two price lists drifting**: unchanged discipline — the client total is display-only and `price_mismatch` travels with the order.
- **The window in a management app**: a card that is visible all day but only orders for an hour must say so on its face (the "closed" state), or it reads as broken.
- **verify-all-tabs / verify-controls** drive every VAS page nightly; a card with a live cart must not leave the shared `S.ui` blob dirty (page-local cart state only).

---

## 7 · Open questions for Nick (answers change the work)

1. Should agents and team leaders still be able to order at all? (Today they are the only ones with the tab; after this, nobody in the agent app can.) If yes: the cheapest door is keeping the *route* open for portal sessions and a one-button "Order lunch" link on the agent's Links tab that opens the VAS card in a read-only shell — about a day more.
2. Quantity +/−: keep, or one of each?
3. Keep the 08:00–09:00 window, or open it wider now that management orders?
4. Keep `additional_notes` (free text on the order), or drop it as "editing"?
5. Inline card on Apps (no grants needed) or a dedicated "Wimpy" nav item (grants needed for every explicit-tabs user)?

**Effort:** ~3½ days including the guard rewrite and the live proof. Order of work: Phase 0 → 1 → 2 → 3 → 4 → 5; Phases 2 and 3 can run in parallel once Phase 1's routes are live.
