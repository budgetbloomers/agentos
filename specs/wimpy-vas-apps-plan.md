# Wimpy ordering becomes its own app — implementation plan (v2)

**Asked (Nick, 2026-09-10, two messages):**
1. "remove the wimpy tab from the agent view and put it directly into apps in the vas analytics, and there
   must be no option to add-ons and edit the items, and if one person orders send the data to the webhook,
   create a full implementation plan."
2. "to login to the app the users needs to put their cb number and when they order they need to put their
   cb number, name, surname, also add to the plan when the agent list is uploaded it must update the logins
   for this app, create this to my wimpy themed as well."

Status: PLAN — nothing below is built. Every step names the file it touches and the guard that proves it.
v1 (same day, earlier) put the ordering inline on the VAS Apps page; message 2 makes it a **standalone,
Wimpy-themed app with its own CB-number sign-in**, reached from the VAS Apps page. v1's decisions are
replaced where they conflict.

---

## 1 · What exists today (verified 2026-09-10)

| Piece | Where | Behaviour |
|---|---|---|
| Menu, prices, Big One rotation, window, pricing, webhook POST | `worker/src/wimpy.mjs` (458 lines) | The only place a price lives. `wimpyMenu(now)`, `priceOrder(body, now)`, `submitWimpyOrder(env, user, body)`. Orders are already **as-is**: any `customisations` on a line is refused, never stripped. Add-ons still exist as a *door* — `ADDONS` at 0.00 "until a price is set". |
| Routes | `worker/src/index.mjs` ~754 | `GET /api/portal/wimpy/menu`, `POST /api/portal/wimpy/order`, after the session gate; on the agent allow-list (`PORTAL_ALLOWED`, `worker/src/portal.mjs`). |
| Page | `agent/index.html` ~3155–3720 | Tab "Wimpy Order" on the agent nav, shown 08:00–09:00 SAST Mon–Fri only (`wimpyOpenNow`, 30 s flip poll). ~15 `w*` functions, 87 `.wp-*` CSS rules, `ICON.wimpy`. |
| Identity on an order | `submitWimpyOrder` | `agent_name` = `user.full_name`, `cb_number` = `user.cb`, both taken from the session, both mandatory. Nothing is typed. |
| Webhook | `WIMPY_WEBHOOK_URL` secret, else the n8n URL in the module | One POST per order, 15 s timeout; failure keeps the cart and offers Retry. Live-tested 2 Sep. |
| Guard | `nicks_code/diagnostics/verify-wimpy.mjs` (131 checks) | Module half + a page half that serves `agent/index.html` on :8298. Section L fails if the operating-model tab returns. |
| Per-app shells | `tools/prepare-site.js` line 217 | Builds `site/pulse`, `site/tracker`, `site/agent`, `site/agent-preview` from source dirs; injects `auth-gate.js` + the stale-guard; checks all shells carry one build id. |
| Sign-in | `site/auth-gate.js` (all apps), `worker/src/auth.mjs` | Username + password (PBKDF2, sessions, lockout). An agent's username IS their CB number, password `agentos123` by default, `apps:['agent']`. `auth-gate` refuses an app not in `u.apps`. |
| Accounts follow the list | `supabase/migration-014` `sync_agent_list()`, `migration-018` `sync_team_leaders()`, `migration-020` `publish_agent_list()` | Every Agent List publish + the ten-minute cron reconcile logins in ONE transaction: on the list ⇒ an active account; off it ⇒ no account. New agents get `apps:['agent']`. |
| VAS Apps page | `nicks_code/index.html` `PAGES.hubs` (~6830), nav id `hubs` | Cards in `HUBS[]` — KPI Hub, Coaching Hub, Agent Analytics — each "Open" + "Copy link". |

**Who has what today** (`app_users`, active): 126 agents and 9 team leaders hold `agent` only and all carry a CB; 24 management/viewer/exec/admin accounts hold `ops`/`vas`/`tracker` and 22 of them have **no CB**.

---

## 2 · The shape (decisions — say if any is wrong)

1. **A fourth app: `/wimpy/`** — source `wimpy/index.html`, built by `prepare-site` like `/agent/`, its own shell, its own theme, `auth-gate` app id `wimpy`. Listed on the VAS Apps page as a card (Open + Copy link), exactly like Agent Analytics. The agent view loses its Wimpy tab.
2. **Sign-in = CB number.** The username field on the Wimpy sign-in reads "CB number"; it is the same account the agent already has (username = CB, password `agentos123` until changed), so one credential works in Agent Analytics and Wimpy. **Recommended: CB number + password.** Alternative if you want CB-only: a one-field sign-in that mints a session for that CB with no password — cheaper to type, but anyone who knows a CB can order lunch in that person's name; the typed name/surname (§2.3) does not stop that. Pick before Phase 1.
3. **The order form asks for CB number, name, surname** — three required fields, pre-filled from the account, editable. Rules: the CB typed **must be the signed-in CB** (an order for somebody else is refused with "sign in as that person"); name and surname are free text (2–40 letters each, no digits) and travel as typed; the Agent List's name for that CB travels beside them (`list_name`) so the kitchen sheet can reconcile a nickname. Nothing on the form edits an item.
4. **No add-ons, no editing.** The add-on door is deleted from the module (no `ADDONS`, no `added[]`, no `customisations`). `priceOrder` refuses a line carrying any of them, as it refuses customisations today. Quantity +/− stays (three of one burger is not an edit) — say if you want one-of-each.
5. **One order → one webhook POST**, unchanged mechanics (Worker does the POST; 15 s timeout; failure keeps the cart). Payload adds `first_name`, `surname`, `list_name`; `agent_name` stays as "Name Surname" as typed, `cb_number` as typed (= session CB). Existing n8n workflow keeps working; the new columns are there when the sheet wants them.
6. **Logins follow the Agent List — including this app.** `sync_agent_list()` grants every agent `apps:['agent','wimpy']` (migration); `sync_team_leaders()` the same for leaders; a one-off backfill adds `wimpy` to every active agent/leader account; leavers already lose their account whole. Management keep their own usernames and get `wimpy` added too, so the Apps card works for them.
7. **Office hours stay** (08:00–09:00 SAST, Mon–Fri) unless you say otherwise. The app is always reachable; outside the window it shows the hours and today's Big One to read; the Worker still refuses out of window.
8. **Menu and prices stay in `worker/src/wimpy.mjs`.** The "no price in a page" rule extends to `wimpy/index.html`.
9. **Wimpy theme.** Red-and-white with the yellow accent, rounded friendly type, the Wimpy wordmark on the sign-in card and header. Colour values come from the brand assets you supply (logo file / brand sheet) — the plan carries **placeholder tokens** (`--wimpy-red`, `--wimpy-yellow`, `--wimpy-cream`, `--wimpy-ink`) and never publishes a guessed hex as official. Light theme only (no dark palette, like Agent Analytics). The masthead reads "Chatterbox × Wimpy — Weekday Value Menu".

---

## 3 · Phases

### Phase 0 — Contract and RED tests (½ day)
- `specs/wimpy-3331-menu.md`: dated `_changes` note (add-ons removed; ordering moved to its own app; form fields).
- New checks in `verify-wimpy.mjs`, written first: (a) module has no `ADDONS`, menu carries no `addOns`; (b) `priceOrder` refuses `added[]`; (c) `submitWimpyOrder` refuses a typed CB ≠ session CB, refuses a missing/invalid name or surname, accepts the three fields and sends `first_name`/`surname`/`list_name`; (d) page half serves `wimpy/index.html`; (e) `agent/index.html` has no `wimpy` token; (f) no price in `wimpy/index.html`; (g) sign-in card labels the field "CB number".
- `verify-agent-sync.mjs` (80 checks, rolled back): new checks — a new list row gets `apps` containing `wimpy`; a leaver's account is gone; a leader gets `wimpy`.

### Phase 1 — Database: logins follow the list into this app (½ day)
- `supabase/migration-037-wimpy-app-grant.sql`: `sync_agent_list()` and `sync_team_leaders()` create with `apps:['agent','wimpy']`; on every sync, add `wimpy` to any active agent/leader account missing it (idempotent); one-off backfill in the same migration for existing accounts and for management (`ops`/`vas` holders). `agent_list_integrity` gains a row: every active agent holds `wimpy`. Guarded by the Phase 0 checks; applied with `tools/apply-migration.mjs`; `tools/audit-permissions.mjs` learns the app id.

### Phase 2 — Worker (½ day) — `worker/src/wimpy.mjs`, `worker/src/index.mjs`, `worker/src/portal.mjs`
1. Delete `ADDONS` and every reference; lines are `{id, quantity}`.
2. `priceOrder`: refuse `added`/`removed`/`customisations` (existing wording). Keep the Big One day-lock and the window.
3. `submitWimpyOrder(env, user, body)`: read `body.who = {cb, first_name, surname}`; `normCb(who.cb) === normCb(user.cb)` or 403; validate names; `list_name` from `active_agents` for that CB (empty for management); build the payload per §2.5.
4. Routes → `/api/wimpy/menu`, `/api/wimpy/order`; add both to `PORTAL_ALLOWED` (agents reach them) — they are the only non-portal routes an agent session may call, and they return nothing about anyone else. Old `/api/portal/wimpy/*` → 410 with a message for one release.
5. `/api/me` already returns `cb`, `full_name` — the form pre-fills from it. Deploy; module half GREEN.

### Phase 3 — The app (1½ days) — `wimpy/index.html`, `tools/prepare-site.js`, `site/_headers`
1. New single-file app: sign-in card (auth-gate, app id `wimpy`, field label "CB number"), header with wordmark, window state, menu (14 items, was-price + saving badge, week strip readable not orderable), cart with quantity +/−, **order form (CB number, name, surname — pre-filled, required)**, confirm, done. Port the `w*` functions from `agent/index.html`; drop add-on remnants.
2. Theme per §2.9 as CSS tokens at the top of the file; PII masking not needed (the page shows only the signed-in person).
3. `prepare-site`: add `['wimpy', 'wimpy', 'Wimpy Order']` to the shell list; shell count 5 → 6 in the consistency check; CSP unchanged (the page talks only to the Worker).
4. Phone-first layout (agents order from phones); 30 s window flip poll kept.

### Phase 4 — VAS Apps card + agent-view removal (½ day)
- `nicks_code/index.html` `HUBS[]`: add `{name:'Wimpy Order', url:<pages>/wimpy/, desc:'Order the Weekday Value Menu — sign in with your CB number. Orders 08:00–09:00, Mon–Fri.', copy:true}` with a screenshot like the others. No new nav id ⇒ no tab grants.
- `agent/index.html`: remove the tab, guards, functions, poll, icon, 87 CSS rules. `verify-agent-analytics.mjs` / `verify-agent-card.mjs` nav assertions updated.

### Phase 5 — Guards and docs (½ day)
- `verify-wimpy.mjs` page half: serves `wimpy/index.html` (env `WIMPY_HTML` for the build copy), mints an AGENT session, signs in, orders one item at a stubbed webhook (`WIMPY_WEBHOOK_URL` → local server) and asserts one POST with `cb_number`, `first_name`, `surname`, `agent_name`, `list_name`, `total_price`, `order.items[]`, no `customisations`; a typed CB of another agent is refused on the page and by the Worker; nothing in the page says customise/add-on/extra.
- `verify-all-tabs` / `verify-controls`: the Apps card is in the sweep (Open + Copy link).
- `verify-cors-headers`: the new page sends no header the Worker preflight does not name.
- `CLAUDE.md` (app table + one sentence under 13), `specs/wimpy-3331-menu.md`, memory `wimpy-ordering.md`.

### Phase 6 — Deploy and prove (½ day)
1. Apply migration-037 → `npx wrangler deploy` (worker) → `node tools/prepare-site.js` → `npx wrangler pages deploy site --project-name chatterbox-agentos --branch main`.
2. Post-deploy smoke (mandatory): `verify-cors-headers --live`, `verify-live-save --live`.
3. Real order inside the window from an agent account with a marked-TEST note → n8n answers `Workflow was started`; the sheet row shows the typed name/surname beside `list_name`.
4. Agent List publish (or the cron) → a fresh agent account holds `wimpy`; `agent_list_integrity` clean; `tools/audit-permissions.mjs` clean.
5. Agent view: no Wimpy tab; `GET /api/portal/wimpy/menu` → 410. Out of window: the app says closed; `POST /api/wimpy/order` → 403.

---

## 4 · File-by-file change list

| File | Change |
|---|---|
| `supabase/migration-037-wimpy-app-grant.sql` | NEW — `wimpy` in the default and reconciled `apps` for agents and leaders; backfill; integrity row |
| `worker/src/wimpy.mjs` | remove `ADDONS`; refuse `added`/`customisations`; `who{cb,first_name,surname}` validation; `list_name`; payload fields |
| `worker/src/index.mjs`, `worker/src/portal.mjs` | routes `/api/wimpy/*` on the agent allow-list; old paths 410 |
| `wimpy/index.html` | NEW — the app (sign-in, menu, cart, order form, theme) |
| `tools/prepare-site.js` | sixth shell `wimpy/` |
| `nicks_code/index.html` | `HUBS[]` card "Wimpy Order" |
| `agent/index.html` | delete the tab, functions, CSS, icon, guards |
| `tools/audit-permissions.mjs` | knows app id `wimpy` |
| `nicks_code/diagnostics/verify-wimpy.mjs`, `verify-agent-sync.mjs`, `verify-agent-analytics.mjs`, `verify-agent-card.mjs`, `verify-all-tabs.mjs`, `verify-controls.mjs` | per Phases 0 and 5 |
| `CLAUDE.md`, `specs/wimpy-3331-menu.md`, memory | dated notes |

No new secret (`WIMPY_WEBHOOK_URL` already exists as an optional override). Brand assets (logo, colours) needed from Nick before Phase 3's theme is final; the layout does not wait for them.

---

## 5 · Test plan (what GREEN means)

- Module: 14 prices unchanged; no `addOns`; `priceOrder({items:[{id, quantity:2}]})` prices; `added:[…]` → refused; wrong-day Big One → refused by name; window closed → 403 before pricing.
- Identity: session `{cb:'CB101', full_name:'Ann Smith'}` + typed `{cb:'CB101', first_name:'Ann', surname:'Smith'}` → payload `cb_number:'CB101', first_name:'Ann', surname:'Smith', agent_name:'Ann Smith', list_name:'Ann Smith'`; typed `cb:'CB102'` → 403; surname blank → 400; digits in a name → 400.
- Accounts: a list with a new CB → account with `apps ⊇ ['agent','wimpy']`; a CB removed → account gone; a leader in `team_leader_cbs` → `wimpy` granted; re-running the sync changes nothing (idempotent).
- App (headless): sign-in field labelled "CB number"; wrong password refused; outside the window the menu is read-only and no order button exists; inside, add → cart → form → confirm → send hits the stub once with the §2.5 shape; a 502 keeps the cart and shows Retry; no customise/add-on/extra control exists; the page contains none of the 14 prices.
- Agent page: no `wimpy` token; four tabs for an agent.
- VAS: the Apps card opens the app URL and copies it.
- Existing: rotation, overlap invariant and section L still pass.

---

## 6 · Risks and what limits them

- **CB-only sign-in (if chosen)** lets anyone order in a colleague's name. The typed CB must still equal the signed-in CB, so the exposure is "knows a CB", not "types a CB". Password sign-in closes it; hence the recommendation.
- **Two names for one person** (typed vs list): both travel; the sheet decides. Nothing is silently corrected.
- **Cached agent pages** after Phase 4 get 410 with a message, never a silent failure.
- **Route exposure for agents**: only the two Wimpy routes join the allow-list; they answer for the caller alone. `verify-agent-sync` and the role-lockdown checks stay the proof that an agent session reaches nothing else.
- **Brand colours**: placeholders until the assets arrive; the theme is a token block, so swapping values touches one place.
- **A sixth shell**: `prepare-site`'s consistency check counts shells — update the count or the build refuses.

---

## 7 · Open questions for Nick (answers change the work)

1. Sign-in: **CB number + password** (recommended, one credential across the suite) or **CB number only**?
2. Quantity +/−: keep, or one of each?
3. Keep the 08:00–09:00 window?
4. Keep the free-text `additional_notes` on the order?
5. Brand assets: send the Wimpy logo (SVG or PNG) and the colour sheet if you have one; otherwise I match the logo's own colours and mark them "sampled from the logo".
6. Should management be able to order too (they get the `wimpy` grant either way), or is the Apps card only the doorway for agents?

**Effort:** ~4½ days including the migration, the new app, the guard rewrite and the live proof. Order: Phase 0 → 1 → 2 → 3 → 4 → 5 → 6; Phases 3 and 4 can run in parallel once Phase 2's routes are live.
