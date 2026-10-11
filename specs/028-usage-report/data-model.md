# Data model — 028 usage report (migration-061)

## `usage_events` — one row per thing a person did (append-only)
| column | type | meaning |
|---|---|---|
| id | bigserial PK | |
| at | timestamptz, default now() | when it happened (UTC; every view reports the **SAST** day) |
| user_id | uuid NULL | app_users.id at the time — **no FK**: a leaver's history stays |
| username | text NULL | as signed in (`cb162`, `dalwin`); kept for leavers |
| role | text NULL | app_users.role at the time |
| app | text NULL, check in (`vas`,`ops`,`agent`,`tracker`,`wimpy`,`worker`) | the app the person was in. `worker` = a server event with no page (a suite sign-in); NULL = not knowable (an old page that sent no `page`) — never guessed |
| event | text NOT NULL | see the event table |
| category | text NULL | help topic · CM blockage · CM action · failure reason · stage name |
| team_leader | text NULL | help ask: the agent's TL from the digest; CM: the requesting TL; TL events: the TL's own team name |
| campaign | text NULL | the agent's / team's campaign from the digest |
| detail | jsonb NULL | everything else (note text, delivered, error, opp_id, question…) |
| source | text NOT NULL, check in (`worker`,`auth_log`,`backfill`) | who wrote the row |
| source_key | text UNIQUE NULL | idempotency key shared by the live write and the backfill (NULL = nothing to collide with) |

Indexes: `(at)`, `(event, at)`, `(username, at)`, `(team_leader, at) where team_leader is not null`, `(detail->>'opp_id') where event in help/CM`.
Security: RLS on, no policies; `revoke all … from public, anon, authenticated`; `grant select, insert` (no update/delete —
append-only) + sequence usage to `service_role`.

## Events
| event | written by | category | team_leader / campaign | detail | source_key |
|---|---|---|---|---|---|
| `login_ok` | trigger on auth_log | — | — | `{auth_event}` | `auth_log:<id>` |
| `login_fail` | trigger | reason: `bad_password` `no_user` `disabled` `locked` `no_app` `failed` | — | `{auth_event}` | `auth_log:<id>` |
| `logout` | trigger | — | — | `{auth_event}` | `auth_log:<id>` |
| `password_change` | trigger | `change` / `reset` | — | `{auth_event}` | `auth_log:<id>` |
| `account_admin` | trigger | first part of the auth event (`created`, `unlock`, `username_changed`…) | — | `{auth_event}` | `auth_log:<id>` |
| `app_open` | Worker: login ok, `/api/me`, `/api/portal/me` | — | TL's own team for a TL | `{via:'login'|'boot'}` | NULL |
| `help_ask` | Worker: `/api/portal/help/request` | the topic (HELP_CATEGORIES) | agent's TL + campaign (digest row) | `{note, delivered, error?, opp_id, merged?, reopened?, note_failed?, cb, agent_name}` | `hl-help:<opp>:<asked iso>` when delivered |
| `help_stage` | Worker: `/help/stage` `/help/close` `/help/confirm` | stage name | TL's team for a TL | `{opp_id, closed, by:'team_leader'|'agent'|role, action}` | NULL (backfill: `hl-help-stage:<opp>:<at>`) |
| `cm_request` | Worker: `/api/portal/cm/request` | blockage key | requesting TL + campaign | `{opp_id, priority, restricted, affected, merged?, delivered, error?}` — **never the text**; a request that fails to send is recorded `delivered:false` with the reason ≤120 (Nick, 2026-10-11: "Yes, record them as not delivered") | `cm-req:<opp>:<requested_at digits>`; merged: `cm-hist:<opp>:<hist at>`; not delivered: NULL |
| `cm_action` | Worker: `/api/portal/cm/act` | the action (`acknowledge`, `start`, …) | request's TL + campaign | `{opp_id, actor, started, resolved}` | `cm-hist:<opp>:<hist at>` |
| `ai_question` | Worker: `/api/portal/ask`, `/api/ask` | — | — | `{question, model, ask_id}` | `ask_log:<id>` |

The help/CM keys are computed identically from the live write and from what the backfill reads back (the note's
`Help request <opp>` + `Asked: <iso>` lines; the mirror row's `requested_at` and `history[].at`), so the two can
never double-count.

## Functions (all `set search_path = public`, revoked from public/anon/authenticated)
- `usage_auth_event(text) → (event, category, app)` — the ONE auth_log mapping.
- `usage_mirror_auth_log(p_min_id bigint, p_max_id bigint) → int` — inserts the mapped rows for an id range,
  `on conflict (source_key) do nothing`; the trigger calls it for one id, the backfill for all (service_role EXECUTE).
- `usage_from_auth_log()` — the AFTER INSERT trigger; swallows any error with a WARNING so a sign-in never fails because of the report.

## Views (`security_invoker = true`; select granted to service_role only). `day`/`month` are SAST.
| view | grain | columns |
|---|---|---|
| usage_daily | day × app × event | events, people |
| logins_by_user | day × user | sign_ins, failed_sign_ins, wimpy_sign_ins, first_sign_in, last_sign_in |
| logins_by_user_month | month × user | sign_ins, failed_sign_ins, days_active, first_sign_in, last_sign_in |
| app_opens_by_user_app | day × user × app | opens, via_login, first_at, last_at |
| help_by_category | day × category | asks, delivered, not_delivered, agents |
| help_by_team_leader | day × TL × category | asks, delivered, agents |
| help_by_campaign | day × campaign × category | asks, delivered, agents |
| help_by_agent | day × agent × category | asks, delivered, agent_name, team_leader, campaign |
| help_notes | one row per ask | at, agent, agent_name, cb, team_leader, campaign, category, note, delivered, error, opp_id, last_stage, last_stage_at |
| help_answer_times | one row per delivered ask | first_response_at/by, minutes_to_first_response, closed_at, minutes_to_close, answered |
| cm_requests | one row per CM request (incl. ones not delivered) | requested_at, opp_id, team_leader, campaign, blockage, priority, restricted, duplicates_merged, actions, first_action_at, started_at, last_action, status (`Not delivered` · New · Triaged · Assisting · Resolved), delivered, error |
| cm_request_summary | day × blockage | requests, delivered, not_delivered |
| ask_ai_by_user | day × user × app | questions, first_at, last_at |
| ai_questions | one row per question | at, username, role, app, question, model |
