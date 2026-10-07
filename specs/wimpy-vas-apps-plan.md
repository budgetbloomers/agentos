# Wimpy ordering becomes its own app — implementation plan (v3)

**Asked (Nick, 2026-09-10, two messages):**
1. "remove the wimpy tab from the agent view and put it directly into apps in the vas analytics, and there
   must be no option to add-ons and edit the items, and if one person orders send the data to the webhook,
   create a full implementation plan."
2. "to login to the app the users needs to put their cb number and when they order they need to put their
   cb number, name, surname, also add to the plan when the agent list is uploaded it must update the logins
   for this app, create this to my wimpy themed as well."

> **Superseded 2026-10-06 (Nick, Spec Kit 009):** the sign-in now needs the CB number AND the person's own
> password, under the main sign-in's lock (`auth.mjs signinWimpy`; `specs/009-wimpy-password-signin/`). Item 2
> below describes the password-less sign-in as it was from 10 Sep to 6 Oct.

**Decided (Nick, 2026-09-10, message 3):** orders 08:00–17:00; sign in with the CB number only, no password;
quantity allowed, no customising of an item; everyone can order, management included.

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
2. **Sign-in = CB number only, no password (decided).** One field. The Worker looks the CB up in `app_users` and mints a session **scoped to this app**: `app_sessions.scope = 'wimpy'` (new column, default `'full'`), and every route outside `/api/wimpy/*`, `/api/me` and `/api/logout` refuses a wimpy-scoped session. So a passwordless sign-in buys lunch and nothing else — never Agent Analytics, never a management app. Management have no CB: the same field accepts their **username** (label: "CB number — managers: your username"); they are looked up in `app_users` and get the same scoped session. The route is rate-limited (10 tries per CB and per IP per 10 minutes, reusing the lockout table) so a CB cannot be guessed at speed. Known exposure, accepted by Nick: anyone who knows a colleague's CB can order in their name; the typed name/surname (§2.3) and `list_name` on the sheet make that visible, not impossible.
3. **The order form asks for CB number, name, surname** — three required fields, pre-filled from the account, editable. Rules: the CB typed **must be the signed-in CB** (an order for somebody else is refused with "sign in as that person"); name and surname are free text (2–40 letters each, no digits) and travel as typed; the Agent List's name for that CB travels beside them (`list_name`) so the kitchen sheet can reconcile a nickname. Nothing on the form edits an item.
4. **No add-ons, no customising; quantity stays (decided).** The add-on door is deleted from the module (no `ADDONS`, no `added[]`, no `customisations`). `priceOrder` refuses a line carrying any of them, as it refuses customisations today. A line is `{id, quantity}` with quantity 1–10; +/− on the cart is the only control on an item.
5. **One order → one webhook POST**, unchanged mechanics (Worker does the POST; 15 s timeout; failure keeps the cart). Payload adds `first_name`, `surname`, `list_name`; `agent_name` stays as "Name Surname" as typed, `cb_number` as typed (= session CB). Existing n8n workflow keeps working; the new columns are there when the sheet wants them.
6. **Logins follow the Agent List — including this app.** With CB-only sign-in there is no password to provision: "a login for this app" means **an active account for that CB**, which `sync_agent_list()` already creates on every publish and the ten-minute cron, and deletes for leavers. The migration adds `wimpy` to `apps` for agents and leaders (so the sign-in route can refuse an account that has been taken off the list but somehow still exists), backfills existing accounts, and adds an `agent_list_integrity` row (every active agent holds `wimpy`). Management keep their usernames and get `wimpy` too.
7. **Orders 08:00–17:00 SAST, Monday to Friday (decided).** `wimpyWindowOpen()` changes from the 08:00 hour to 08:00–17:00; the menu payload's `window.hours` reads "08:00–17:00"; the app is always reachable and outside the window shows the hours and today's Big One to read; the Worker still refuses out of window. The 30 s flip poll stays (it flips at 08:00 and 17:00).
8. **Menu and prices stay in `worker/src/wimpy.mjs`.** The "no price in a page" rule extends to `wimpy/index.html`.
9. **Wimpy theme.** Red-and-white with the yellow accent, rounded friendly type, the Wimpy wordmark on the sign-in card and header. Colour values come from the brand assets you supply (logo file / brand sheet) — the plan carries **placeholder tokens** (`--wimpy-red`, `--wimpy-yellow`, `--wimpy-cream`, `--wimpy-ink`) and never publishes a guessed hex as official. Light theme only (no dark palette, like Agent Analytics). The masthead reads "Chatterbox × Wimpy — Weekday Value Menu".

---

## 3 · Phases

### Phase 0 — Contract and RED tests (½ day)
- `specs/wimpy-3331-menu.md`: dated `_changes` note (add-ons removed; ordering moved to its own app; form fields).
- New checks in `verify-wimpy.mjs`, written first: (a) module has no `ADDONS`, menu carries no `addOns`; (b) `priceOrder` refuses `added[]`; (c) `submitWimpyOrder` refuses a typed CB ≠ session CB, refuses a missing/invalid name or surname, accepts the three fields and sends `first_name`/`surname`/`list_name`; (d) page half serves `wimpy/index.html`; (e) `agent/index.html` has no `wimpy` token; (f) no price in `wimpy/index.html`; (g) sign-in card labels the field "CB number".
- `verify-agent-sync.mjs` (80 checks, rolled back): new checks — a new list row gets `apps` containing `wimpy`; a leaver's account is gone; a leader gets `wimpy`.
- `verify-wimpy.mjs` sign-in checks: `POST /api/wimpy/signin {cb}` for an active agent → a session with `scope='wimpy'`; that token on `/api/kv`, `/api/portal/agent`, `/api/roster` → 403; an unknown or inactive CB → 404 with no hint which; the 11th try in 10 minutes → 429; a manager's username → the same scoped session.

### Phase 1 — Database: logins follow the list into this app; scoped sessions (½ day)
- `supabase/migration-037-wimpy-app-grant.sql`: `sync_agent_list()` and `sync_team_leaders()` create with `apps:['agent','wimpy']`; on every sync, add `wimpy` to any active agent/leader account missing it (idempotent); one-off backfill in the same migration for existing accounts and for management (`ops`/`vas` holders). `agent_list_integrity` gains a row: every active agent holds `wimpy`. Guarded by the Phase 0 checks; applied with `tools/apply-migration.mjs`; `tools/audit-permissions.mjs` learns the app id.
- Same migration: `alter table app_sessions add column scope text not null default 'full' check (scope in ('full','wimpy'))`; the session lookup the Worker reads returns it. Nothing existing changes behaviour (every current row is `'full'`).

### Phase 2 — Worker (½ day) — `worker/src/wimpy.mjs`, `worker/src/index.mjs`, `worker/src/portal.mjs`
1. Delete `ADDONS` and every reference; lines are `{id, quantity}`.
2. `priceOrder`: refuse `added`/`removed`/`customisations` (existing wording). Keep the Big One day-lock and the window.
3. `submitWimpyOrder(env, user, body)`: read `body.who = {cb, first_name, surname}`; for an agent `normCb(who.cb) === normCb(user.cb)` or 403; for a manager (no CB) `who.cb` must equal their username; validate names; `list_name` from `active_agents` for that CB (empty for management); build the payload per §2.5.
4. **Sign-in route** `POST /api/wimpy/signin {cb}` (`worker/src/auth.mjs` gains `signinByCb`): normalise; find an active `app_users` row by `cb` (agents, leaders) else by `username` (management) with `'wimpy'` in `apps`; rate-limit per CB and per IP through the existing lockout table; insert `app_sessions` with `scope='wimpy'`, 12-hour expiry; return the token. No password path is touched.
5. **Scope enforcement**: `session()` returns `scope`; right after the session gate, a wimpy-scoped session on any path other than `/api/wimpy/*`, `/api/me`, `/api/logout` → 403. This sits ABOVE the agent role lockdown so it applies to every role. Routes → `/api/wimpy/menu`, `/api/wimpy/order` (+ `/api/wimpy/signin` before the gate); add the two to `PORTAL_ALLOWED` so a full agent session could also call them. `wimpyWindowOpen()` → 08:00–17:00. Old `/api/portal/wimpy/*` → 410 with a message for one release.
6. `/api/me` returns `cb`, `full_name`, `scope` — the form pre-fills from it. Deploy; module half GREEN.

### Phase 3 — The app (1½ days) — `wimpy/index.html`, `tools/prepare-site.js`, `site/_headers`
1. New single-file app: its own one-field sign-in card ("CB number — managers: your username", a Wimpy-red "Let's eat" button) calling `/api/wimpy/signin` and storing the token under `cbx_wimpy_token` (never `cbx_token`, so a Wimpy session is never mistaken for a management one in a shared browser); `auth-gate.js` is NOT injected here — the page has its own gate and the Worker's scope check is the lock. Header with wordmark, window state ("Orders open 08:00–17:00, Monday to Friday"), menu (14 items, was-price + saving badge, week strip readable not orderable), cart with quantity +/− (1–10), **order form (CB number, name, surname — pre-filled, required)**, confirm, done. Port the `w*` functions from `agent/index.html`; drop add-on remnants.
2. Theme per §2.9 as CSS tokens at the top of the file; PII masking not needed (the page shows only the signed-in person).
3. `prepare-site`: add `['wimpy', 'wimpy', 'Wimpy Order']` to the shell list; shell count 5 → 6 in the consistency check; CSP unchanged (the page talks only to the Worker).
4. Phone-first layout (agents order from phones); 30 s window flip poll kept.

### Phase 4 — VAS Apps card + agent-view removal (½ day)
- `nicks_code/index.html` `HUBS[]`: add `{name:'Wimpy Order', url:<pages>/wimpy/, desc:'Order the Weekday Value Menu — sign in with your CB number (managers: your username). Orders 08:00–17:00, Mon–Fri.', copy:true}` with a screenshot like the others. No new nav id ⇒ no tab grants.
- `agent/index.html`: remove the tab, guards, functions, poll, icon, 87 CSS rules. `verify-agent-analytics.mjs` / `verify-agent-card.mjs` nav assertions updated.

### Phase 5 — Guards and docs (½ day)
- `verify-wimpy.mjs` page half: serves `wimpy/index.html` (env `WIMPY_HTML` for the build copy), signs in with a fixture CB through a stubbed `/api/wimpy/signin` (and, live, through the real one), orders one item at a stubbed webhook (`WIMPY_WEBHOOK_URL` → local server) and asserts one POST with `cb_number`, `first_name`, `surname`, `agent_name`, `list_name`, `total_price`, `order.items[]`, no `customisations`; a typed CB of another agent is refused on the page and by the Worker; nothing in the page says customise/add-on/extra.
- `verify-all-tabs` / `verify-controls`: the Apps card is in the sweep (Open + Copy link).
- `verify-cors-headers`: the new page sends no header the Worker preflight does not name.
- `CLAUDE.md` (app table + one sentence under 13), `specs/wimpy-3331-menu.md`, memory `wimpy-ordering.md`.

### Phase 6 — Deploy and prove (½ day)
1. Apply migration-037 → `npx wrangler deploy` (worker) → `node tools/prepare-site.js` → `npx wrangler pages deploy site --project-name chatterbox-agentos --branch main`.
2. Post-deploy smoke (mandatory): `verify-cors-headers --live`, `verify-live-save --live`.
3. Real order inside the window from an agent account with a marked-TEST note → n8n answers `Workflow was started`; the sheet row shows the typed name/surname beside `list_name`.
4. Agent List publish (or the cron) → a fresh agent account holds `wimpy`; `agent_list_integrity` clean; `tools/audit-permissions.mjs` clean.
5. Agent view: no Wimpy tab; `GET /api/portal/wimpy/menu` → 410. Out of window (after 17:00): the app says closed; `POST /api/wimpy/order` → 403.
6. Scope proof, live: a wimpy-scoped token on `/api/kv?key=vas-state` → 403; on `/api/portal/agent` → 403. This check must pass before the link is handed out.

---

## 4 · File-by-file change list

| File | Change |
|---|---|
| `supabase/migration-037-wimpy-app-grant.sql` | NEW — `wimpy` in the default and reconciled `apps` for agents and leaders; backfill; integrity row; `app_sessions.scope` |
| `worker/src/wimpy.mjs` | remove `ADDONS`; refuse `added`/`customisations`; `who{cb,first_name,surname}` validation; `list_name`; payload fields |
| `worker/src/auth.mjs` | `signinByCb` (CB or username → wimpy-scoped session), rate limit via the lockout table |
| `worker/src/index.mjs`, `worker/src/portal.mjs` | `/api/wimpy/signin` before the gate; scope check after it; routes `/api/wimpy/*` on the agent allow-list; old paths 410 |
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
- Sign-in: `{cb:'cb 101'}` → 200 + token, session scope `wimpy`, 12 h expiry; the same token on any non-Wimpy route → 403; `{cb:'CB999'}` (not on the list) → 404; a leaver's CB → 404; a manager's username → 200; 11 tries in 10 min → 429.
- Identity: session `{cb:'CB101', full_name:'Ann Smith'}` + typed `{cb:'CB101', first_name:'Ann', surname:'Smith'}` → payload `cb_number:'CB101', first_name:'Ann', surname:'Smith', agent_name:'Ann Smith', list_name:'Ann Smith'`; typed `cb:'CB102'` → 403; surname blank → 400; digits in a name → 400.
- Accounts: a list with a new CB → account with `apps ⊇ ['agent','wimpy']`; a CB removed → account gone; a leader in `team_leader_cbs` → `wimpy` granted; re-running the sync changes nothing (idempotent).
- App (headless): sign-in field labelled "CB number"; wrong password refused; outside the window the menu is read-only and no order button exists; inside, add → cart → form → confirm → send hits the stub once with the §2.5 shape; a 502 keeps the cart and shows Retry; no customise/add-on/extra control exists; the page contains none of the 14 prices.
- Agent page: no `wimpy` token; four tabs for an agent.
- VAS: the Apps card opens the app URL and copies it.
- Existing: rotation, overlap invariant and section L still pass.

---

## 6 · Risks and what limits them

- **CB-only sign-in (decided)** lets anyone who knows a colleague's CB order in their name. Limited, not removed: the typed CB must equal the signed-in CB, the typed name/surname and `list_name` land on the sheet, the sign-in is rate-limited, and — the part that matters for the rest of the suite — a Wimpy session is **scoped**: it can buy lunch and reach nothing else, so a guessed CB never opens Agent Analytics or a management app.
- **Two names for one person** (typed vs list): both travel; the sheet decides. Nothing is silently corrected.
- **Cached agent pages** after Phase 4 get 410 with a message, never a silent failure.
- **Route exposure for agents**: only the two Wimpy routes join the allow-list; they answer for the caller alone. `verify-agent-sync` and the role-lockdown checks stay the proof that an agent session reaches nothing else.
- **Brand colours**: placeholders until the assets arrive; the theme is a token block, so swapping values touches one place.
- **A sixth shell**: `prepare-site`'s consistency check counts shells — update the count or the build refuses.

---

## 7 · Decided and still open

Decided (Nick, 2026-09-10): CB number only, no password · quantity allowed, no customising · orders 08:00–17:00 · everyone orders, management included.

Still open (the work does not wait on these; defaults in brackets):
1. Keep the free-text `additional_notes` on the order? [keep, 1000 chars — it is not an edit of an item]
2. Brand assets: send the Wimpy logo (SVG or PNG) and the colour sheet if you have one [otherwise colours are sampled from the logo and marked so].
3. Managers sign in with their username in the same field [yes — they have no CB].
4. Session length for the passwordless sign-in [12 hours — one working day, sign in again tomorrow].

**Effort:** ~5 days including the migration, the scoped sign-in, the new app, the guard rewrite and the live proof. Order: Phase 0 → 1 → 2 → 3 → 4 → 5 → 6; Phases 3 and 4 can run in parallel once Phase 2's routes are live.
