# Data model — 029 who asks for help, and what they ask most (migration-062)

Builds on 028's `usage_events` (migration-061). Nothing in 061 is redefined.

## `usage_events` changes
| change | detail |
|---|---|
| `topic text NULL` (≤ 60, a slug from `ask_topics`) | set only on `help_ask` / `cm_request`; NULL = not labelled yet (never read as "Other") |
| `grant update (topic) on usage_events to service_role` | the ONLY updatable column — the table stays append-only for everything else |
| index `(topic, at) where topic is not null`; `(event, at) where topic is null and event in (help_ask, cm_request)` | the views; the label tool's "what is left" read |
| `cm_request.detail.text` / `.impact` (Worker, FR-002) | the TL's description (≤ 2,000) and business impact (≤ 600) — delivered, merged duplicate and not-delivered alike; NEVER for a restricted request (it has none) |
| `cm_request.detail.cms` | usernames of the campaign managers responsible for that campaign at raise time (`cm:assignments`) |

## `ask_topics` — the curated list Nick owns
| column | type | meaning |
|---|---|---|
| topic | text PK (slug, `^[a-z][a-z0-9_]{1,39}$`) | what `usage_events.topic` stores — never changes |
| label | text NOT NULL (≤ 60) | the name shown and given to the AI — **rename here** |
| hint | text NULL (≤ 300) | one line: what belongs in this topic (prompt only) |
| merged_into | text NULL → ask_topics(topic), ≠ topic | **merge**: point at the surviving topic (and set active=false) |
| active | boolean NOT NULL default true | only active topics are offered to the AI |
| created_at | timestamptz default now() | |

RLS on, revoked from public/anon/authenticated; service_role SELECT/INSERT/UPDATE. The seed is `on conflict do nothing`,
so re-running the migration never undoes a rename or merge.

`ask_topic_effective` (view): `topic, label, active, effective_topic, effective_label, hops` — follows `merged_into`
chains (cycle-safe, ≤ 10 hops). Every report view reads topics through it, so a merge moves every past count.

### Seed (17) and why
Read 2026-10-11 (read-only): all 11 "Agent Help Center" cards / 18 ask notes, the 2 "Campaign Assistance" cards / 8
request notes, the one CM mirror row, HELP_CATEGORIES and the 11 `cm:blockages`.
What the real asks say: call reviews ("please listen to this call … can I put it through", "help me my last call"),
what to say ("help me move past my introduction"), closing ("please assist in my closing"), quality results ("explain my
quality score", "help with my qa"), the app's figures ("has this app updated to our actual days we worked"), product
knowledge (the one real CM request) — and many tests ("test", "testing", "hi", "AUTOMATED TEST …"). The rest come from
the six help categories, the eleven CM blockages, and the floor's standing themes (the R99 GWP floor, targets, attendance,
commission, passwords, dialler, leads).

| topic | label | from |
|---|---|---|
| call_review | Review my call | category "Review my call"; 5 real asks |
| what_to_say | What to say on calls | category "Explain what to say"; "move past my introduction" |
| closing_objections | Closing and objections | "assist in my closing"; objection handling |
| product | Product questions | category "Explain the product"; CM blockage knowledge |
| quality_score | Quality score (QA) | category "Explain my quality result"; CM blockage qa; 2 real asks |
| sale_value | Sale value (GWP floor) | the R99 value check (two-check rule) |
| targets_sales | Targets and sales count | daily targets / sales counted |
| attendance_days | Attendance and days worked | "our actual days we worked"; CM blockage attendance |
| commission_pay | Commission and pay | CM blockage payroll |
| signin_password | Sign-in and passwords | access / locked out |
| app_figures | App or figures wrong | category "Help with the system"; CM blockage crm |
| dialler | Dialler problems | CM blockage dialler |
| leads_data | Leads and data | CM blockage leads |
| training_coaching | Training and coaching | CM blockages skill + training |
| personal | Personal matter | CM blockage personal (restricted — labelled without the AI) |
| test | Test message | half of today's asks are tests — kept visible, kept apart |
| other | Other | anything else; the AI's fallback |

## Test traffic is not in the report (Nick, 2026-10-11: "Exclude test traffic from the report")
`usage_test_markers (kind username|card|source_key_prefix, value, note, created_at; PK kind+value)` names test traffic in
ONE place; `usage_events_real` = usage_events minus marked rows (username in any letter case, `detail->>'opp_id'` = card,
`source_key` prefix) minus every ask whose topic resolves to `test`. EVERY report view (029's, and 028's 14 re-issued in
062 unchanged but for their source) reads it; the raw table keeps everything. Seed (live dry run 2026-10-11, 3,078 rows,
82 hidden by markers): wimpy.livecheck 42 · wimpy.livecheck2 2 · testbot 13 · __healthcheck__ 1 · __ping__ 1 · __probe__ 3 ·
__no_such_user_probe__ 6 · cb999999 13 · wimpy:cb99999 1; cards Hlynw1… (CM e2e test; 42 rows once hl_cm is backfilled),
3exXcU… / CEnKfG… / Aghp6r… (all-test Help cards; 1 ask + 1 stage each once hl_help is backfilled). Left visible for
Nick to decide: ghost, x, cb0, cb1000 (one row each).

## Labelling rules (worker/src/topics.mjs — also used by tools/usage-topics.mjs)
1. restricted CM request → `personal` · empty or < 3 letters → `other` · an obvious test → `test` (no AI call).
2. else the AI picks ONE label from the active list (label + hint), given the category/blockage and ≤ 600 chars of text.
3. the answer must equal an active label or slug (case/quotes/full stop ignored) — anything else → `other`.
4. AI missing / throwing / timing out (8 s) / daily allowance (4006) → NULL (the tool labels it later).

## Functions (search_path pinned; EXECUTE revoked from public/anon/authenticated; service_role only)
- `usage_attach_cm_text(p_source_key text, p_text text, p_impact text) → boolean` — fills a `cm_request` row's
  `detail.text` once (only when empty, never restricted). Used by the backfill for rows written before 029.

## Views (security_invoker; SELECT to service_role only). `grain` ∈ day · week (Monday) · month; `period_start` is SAST.
| view | grain | columns |
|---|---|---|
| ask_topic_effective | topic | topic, label, active, effective_topic, effective_label, hops |
| ask_events | one row per help ask / CM request (merged duplicates included, flagged) | id, at, day, week, month, source (`help`/`cm`), asker, asker_name, team_leader, campaign, category, text, delivered, merged, restricted, opp_id, topic, topic_label |
| help_askers_by_period | grain × period | askers (distinct agents), asks, delivered, not_delivered, team_leaders |
| help_askers_by_tl | grain × period × TL | askers, asks, delivered, not_delivered, campaigns |
| help_askers_by_campaign | grain × period × campaign | askers, asks, delivered, not_delivered |
| help_top_askers | grain × period × agent | agent_name, team_leader, campaign, asks, delivered, rank |
| cm_askers_by_period | grain × period | team_leaders (distinct), requests, delivered, not_delivered, duplicates_merged |
| cm_askers_by_cm | grain × period × campaign × campaign_manager | team_leaders, requests, delivered, not_delivered (campaign_manager = first non-TL actor in the request's round; "Not picked up yet" / "Not delivered") |
| most_asked_topics | grain × period × source (`help`/`cm`/`all`) × topic | label, asks, askers, examples (≤ 3, newest first, ≤ 200 chars), categories, rank |
| most_asked_categories | grain × period × source × category | label (CM blockage label from `cm:blockages`), asks, askers |

## The three questions (SC-001 / SC-002)
```sql
-- 1 · how many agents asked their team leader for help this month (and per TL)
select askers, asks, delivered from help_askers_by_period
 where grain = 'month' and period_start = date_trunc('month', now() at time zone 'Africa/Johannesburg')::date;
select team_leader, askers, asks from help_askers_by_tl
 where grain = 'month' and period_start = date_trunc('month', now() at time zone 'Africa/Johannesburg')::date order by asks desc;

-- 2 · how many team leaders asked a campaign manager this month (and per CM / campaign)
select team_leaders, requests, delivered, not_delivered from cm_askers_by_period
 where grain = 'month' and period_start = date_trunc('month', now() at time zone 'Africa/Johannesburg')::date;
select campaign, campaign_manager, team_leaders, requests from cm_askers_by_cm
 where grain = 'month' and period_start = date_trunc('month', now() at time zone 'Africa/Johannesburg')::date;

-- 3 · the most asked questions this month (top 10, both directions, with examples)
select rank, label, asks, askers, examples from most_asked_topics
 where grain = 'month' and source = 'all' and period_start = date_trunc('month', now() at time zone 'Africa/Johannesburg')::date
 order by rank limit 10;

-- rename / merge a topic (counts follow)
update ask_topics set label = 'Listen to my call' where topic = 'call_review';
update ask_topics set merged_into = 'what_to_say', active = false where topic = 'closing_objections';
```
