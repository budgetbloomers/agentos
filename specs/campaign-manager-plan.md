# Campaign Manager — implementation plan

**What:** a third view in Agent Analytics — agent view, team leader view, **campaign manager view**.
**Where:** `agent/index.html` + `worker/src/portal.mjs`, served at `/agent/`.
**For:** Dalwin and Ryan.
**Rule book:** `Chatterbox_CampaignManager.json` v1.1.0.
**Written:** 2026-08-30. **Built:** 2026-08-30 — see §8 Build status.

---

## 0. A third view in the same app

Agent Analytics already renders two views off one login. Nothing about that changes; the
campaign manager is the third, built the same way:

| | Agent view | Team leader view | **Campaign manager view** |
|---|---|---|---|
| Signs in as | their CB number | their CB number | their own account |
| `authorise()` scope | `agent` — one code | `team` — their roster | **`campaign`** — every agent on the campaigns they hold |
| Nav | Today · Commission · My Progress · Nikola | My Team · Help Center · KPI Hub · Coaching Hub · Team Results · MTD · Weekly · Daily · Nikola | **Campaign · Team Leaders · Assistance · Nikola** |
| Sees | themselves, plus an anonymous group average | their agents | their team leaders, and each leader's team |
| Drill-down | — | the agent page | **the team leader view, unchanged** |

The whole feature is a third branch in the four places the second view already branches:

1. `authorise()` in `portal.mjs` — a `campaign` scope beside `agent` and `team`
2. `PORTAL_ALLOWED` — the routes that scope may reach
3. `navFor()` in `agent/index.html` — a `CM_VIEWS` array beside `TL_VIEWS`
4. `render()` — a third branch, exactly as `isTeam` is the second

Everything already true of the app stays true: one login, one shell, one design system,
**no metric computed on the page**, and the scope decided in the Worker so the bytes
never contain anyone else's numbers.

**What the JSON is for.** `Chatterbox_CampaignManager.json` is this same view already
built and running — on the prototype's own `AP.*` engine over its fourteen invented
agents. So it is read as the **specification** (role, permissions, scope model, four SLA
clocks, eleven blockages, twelve statuses, thirteen workflow transitions, the nine-rung
diagnosis ladder, the Nikola grammar) rather than pasted in as source — the same way the
team leader view was built. Every rule below is quoted from it; nothing is invented, and
where a rule cannot be honoured yet it says so.

### 0.1 What the screenshots settle (2026-08-30)

The view runs today on the `v25 campaignmanager` build as **Nolwazi Mahlangu · Campaign
Manager** over Matrix Cuddle — Campaign Command with the Nikola brief, the fourteen-tile
sales grid, the twelve-tile assistance grid, the blockage table, then the control table
and the assistance register. That is the target, screen for screen. Four things in it
change this plan:

**(a) Fourteen tiles are drawn, and six of them have no real source.** The prototype
renders Pitches 6,216 · Conversion 6.1% · Attempts per Lead 1.9 · Contact Rate 28.4% ·
Lead Volume 9,504 · Both-Checks 20% from its own invented engine. On the real digest those
six go blank. **Phase 7 therefore moves alongside Phase 2, not after it** — shipping a
grid with six empty tiles would read as a broken screen rather than an honest one.

**(b) The honest-absence idiom is already designed, and is the pattern to copy.** Two
tiles in the same grid already read *"Not measured · cancellations file not uploaded"* and
*"8 from compliance exceptions — no QA audit uploaded"*, and the header band reads
*"No upload loaded — the figures below are the prototype position · 11 sources not
uploaded."* That is exactly the treatment the six unsourced tiles get until Phase 7 lands.

**(c) The "Prototype role" switcher must not ship.** The sidebar carries an
Agent / Team Leader / Campaign toggle and a campaign-manager picker. In Agent Analytics
the role comes from the session and the campaign list comes from `cm:assignments` —
**neither is ever a control on screen**, because a role switch in the browser is a
role switch an auditor cannot see. The campaign *selector* stays, populated only with the
campaigns that manager holds; selecting outside scope is refused by the Worker and changes
nothing.

**(d) `EOD report` is a button, so `export_eod` needs a route.** It is in the permission
table (`cm`, `director`) and appears top-right on every screen — add
`/api/portal/cm/eod` to the allow-list in Phase 1 and build the export in Phase 4.

---

## 1. What the data actually supports today (measured, not assumed)

### 1.1 The digest carries most of the sales layer already

`kv:agent-digest` → `raw/kv/agent-digest`, published by PULSE, 77 agents, period
2026-08-01→31. Per-agent fields: `code, name, campaign, tenure, tl, plan, gwpEx, sales,
target, pctT, spd, att, qa, aveG, ref, canc, gwpT, talk, act, emp, rankCo, nCo, rankTeam,
nTeam, trend, trendPct, badges, spark, score, composite, scoreParts, days`.

Campaigns: **Courtesy 46 · Cuddle 21 · Nesting 10**.
Team leaders with agents: **Dhamendra 16 · Renolan 20 · Shane 17 · Sharoma 11 · Denise 7 · Hezron 6**.

The spec's fourteen measures against that:

| # | Measure (spec) | Digest field | Status |
|---|---|---|---|
| 1 | Total Sales | `sales` / `target` | ✅ |
| 2 | Total GWP | `gwpEx` / `gwpT` | ✅ |
| 3 | Avg GWP per Sale | `aveG` | ✅ |
| 4 | Pitches | — | ❌ |
| 5 | Conversion Rate | — | ❌ |
| 6 | Average Talk Time | `talk` | ✅ |
| 7 | Attempts per Lead | — | ❌ |
| 8 | Contact Rate | — | ❌ |
| 9 | Lead Volume / Cover | — | ❌ |
| 10 | Average QA Score | `qa` | ✅ |
| 11 | Both-Checks Pass Rate | — | ❌ (an Ops `twoCheck` concept, not a PULSE one) |
| 12 | Critical Failures / P1 | `composite.r2a.fails` | ✅ (P1 comes from the assistance layer) |
| 13 | Cancellation Rate | `canc` | ✅ |
| 14 | Attendance / Productive Agents | `att`, `act`, `emp` | ✅ |

**Nine of fourteen come free from data that already exists.** The five missing ones are all
dialler/lead measures that PULSE already computes for its own tabs — they need a digest
extension, not new maths (Phase 7, which §0.1a moves alongside Phase 2). Until it lands,
those tiles print *"not published yet"* — never a zero (non-negotiable 6: an absence is not
a nought), and exactly the treatment the prototype already gives Cancellation Rate.

The reconciliation rule — *"the campaign total must equal the sum of the teams shown, or
the screen is lying"* — holds **by construction** here, because a campaign total is a sum
over the same agent rows the team totals are summed over. That is a stronger guarantee
than the prototype's `AP.cmReconcile()` and should still be asserted in a test.

### 1.2 The Coaching Hub — the team leader form

Convex `acrobatic-setter-212.eu-west-1.convex.cloud`. `teamLeaders:list` returns **15**
leaders. Six collections, `<collection>:list` requires a `teamLeaderId`. Pulled live
2026-08-30, **711 records**:

| Collection | Label | Rows | Months |
|---|---|---|---|
| `qualityAssuranceCoaching` | Quality Assurance Coaching | 546 | Jul 298 · Aug 248 |
| `formalCoachingCalls` | Formal Coaching | 80 | Jul 9 · Aug 71 |
| `informalCoaching` | Informal Coaching | 38 | Jul 6 · Aug 32 |
| `leadManagementCoaching` | Lead Management Coaching | 28 | Jul 28 |
| `groupCoaching` | Group Coaching | 19 | Jul 10 · Aug 9 |
| `qualityCoaching` | Coaching Scorecard | **0** | — |

Cluster taxonomy actually in use (top): `purpose.quality_compliance` 523 ·
`gap.customer_verification` 189 · `gap.compliance_required_wording` 146 ·
`gap.objection_handling` 80 · `gap.product_knowledge` 40 · `gap.call_process_systems` 39 ·
`purpose.lead_management` 28 · `gap.communication_call_control` 26 ·
`gap.other_needs_review` 25 · `gap.lead_management` 22.

**The blockage categories map onto this taxonomy almost one-to-one**, which is the
single most valuable finding in this document — a campaign manager's blockage panel can
be populated from coaching evidence that already exists, rather than waiting for team
leaders to start raising requests:

| Blockage (`CM_BLOCKAGES`) | Hub cluster family |
|---|---|
| `skill` | `gap.objection_handling`, `gap.pitch_value_creation`, `gap.communication_call_control`, `gap.customer_engagement_rapport` |
| `knowledge` / `training` | `gap.product_knowledge` |
| `qa` | `gap.compliance_required_wording`, `gap.customer_verification`, `purpose.quality_compliance` |
| `leads` | `gap.lead_management`, `purpose.lead_management` |
| `crm` / `dialler` | `gap.call_process_systems` |
| `other` | `gap.other_needs_review` |

### 1.3 The KPI Hub — the acknowledgement forms

Convex `cautious-bass-675.eu-west-1.convex.cloud`. `users:list` → 11 team leaders;
`forms:listByLeader` → **174 forms**: Monthly KPI Acknowledgement 127 · Nesting Phase 34 ·
PIP 13. Status: submitted 111, **draft 63**. Months: Jul 90 · Aug 82 · Jun 2.
`formData` is a JSON string carrying `agentFullName`, `lineManagerFullName`, `date`, and
nine KPI rows (`attendance, talkTime, totalSales, spd, totalGwp, gwpAve, insOptIns,
referrals, qaScore`), each with target/achieved/pct.

Forms per leader: Renolan 34 · Sharoma 29 · Nikita 29 · Dharmendra 27 · Kayleen 17 ·
Shane 13 · Hezron 13 · Denise 12 · **Ryan 0 · Samantha 0 · Ntokozo 0**.

For a campaign manager this is the *compliance* half of the control table: which of my
team leaders have acknowledged KPIs with their agents this month, and how many are still
sitting in draft. 63 drafts across the floor is itself a finding.

### 1.4 Three traps in the Hub data — read before writing a line of code

**(a) The Hub's `campaign` field is unusable for scoping.** Free text, ~50 spellings
across 711 records: `"Matrix Courtesy"` (106), `"Matrix Cuddle"` (93), `"VAS Matrix
Courtesy"` (58), `"VAS"` (53), `"Matrix"` (47), and then `"Matrox Courtesy"`,
`"Matric Cuddle"`, `"Matrix Cudlle"`, `"Mtarix"`, `"Matri-Vas"`, `"Marix"`, `"Test
campaign"`, `"Vehicle Tracking  "`. **Campaign scope must come from the Agent List via
the digest, joined on CB number** — the standing rule, and the reason it exists.

**(b) The Hub's team leaders are not the org chart.** 15 on the Hub, 6 with VAS agents in
the digest. It spells Dhamendra "Dharmendra"; the QA `teamLeader` free-text column also
contains `"Sharona Rampersad"`, `"Dharmendra Budu"`, `"Shane Methalal\t"`, `"Matrix
Courtesy"` (a campaign typed into a name field). Never join on that column.

**(c) Nothing on the Hub is coach-chosen.** Every classified session carries
`clusterSource:'inferred'` — so `rollUp()`'s `scored` is 0 across the board and no theme
reaches Repeat or Persistent. The CM blockage panel must present Hub-derived themes as
**evidence, not verdicts**, and must never let an inferred theme drive an escalation at a
named person (`worker/src/coaching.mjs:290`).

**(d) The coaching snapshot is currently stale.** `kv:coaching` was last written
2026-08-24 by `sync-coaching-hub`; `STALE_HOURS` is 26. Any CM screen reading it today
gets a six-day-old picture. Put the sync on the daily cron next to `fetch-referrals.mjs`
before the CM layer depends on it.

### 1.5 Dalwin and Ryan, as the system currently knows them

```
dalwin | Dalwin    | role=viewer | cb=null | team=null | hub_ids=null | active
ryan   | Ryan G    | role=viewer | cb=null | team=null | hub_ids=null | active
```

`authorise()` refuses `viewer` outright — *"Agent Analytics is for agents and team
leaders."* So neither can open the app at all today.

What the data says about them:

- **Dalwin** (`Dalwin Callaghan`) is the **SOS / Lead Management coach**. All 28
  `leadManagementCoaching` records are his (`sosName: "Dalwin"`), campaigns `"VAS - Group
  9"` / `"VAS - Group 10"`, purpose `improve_lead_management` (27) and `maximize_contact` (1).
  Coaching Hub id `jx75btj1c7wassf4vk6qrywge9899eev`. Not on the KPI Hub. Leads no agents
  on the Agent List.
- **Ryan** is on both hubs — Coaching `jx7fh7ktkj01crg5mj48knqqgh892xfe`, KPI
  `j977fp83bmzncw49fkny2718bd893sjm` — with **zero records on either**, and leads no
  agents. Notably, the JSON's own blockage routing already names him twice:
  `leads → "Campaign team · Ryan"` and `payroll → "Ryan · Data"`.

Both fit the role the spec describes — *"sits between the team leader and the
director"* — and neither has a team, which is precisely why the team-leader scope does
not work for them and a campaign scope is needed.

---

## 2. Decisions

### D1 — Campaign assignments **[BLOCKING · Nick]**

`CM_ASSIGNMENTS` says only a Director may hold ALL. The real campaigns are Courtesy,
Cuddle and Nesting. Nick must say which of the three each of Dalwin and Ryan runs.

**Proposed default so the build is not blocked:** both are assigned all three VAS
campaigns (`courtesy, cuddle, nesting`), Nicholas is Director with `ALL`. Every screen is
built campaign-scoped from day one, so narrowing the assignment later is a row edit, not
a code change.

### D2 — Where assistance records live → **a HighLevel pipeline** (Nick, 2026-08-30)

**Decided: a fifth pipeline in the existing Help Center location, exactly the way the
agent→team-leader pipeline works.** I had first recommended a Supabase table on the
grounds that 48 fields, four SLA clocks and median-response maths would not survive as
opportunity custom fields. **I checked that against the live API before writing this, and
it does not hold** — see below. The pipeline is the right call, and it buys three things a
table would not: the CRM keeps a durable record of how often each manager unblocked each
leader, the stages stay editable in HighLevel with no deploy, and the floor already knows
the pattern.

This is the third tier of the same idea, and there is already precedent for all of it:

| Tier | Pipeline | Who asks | Who works it |
|---|---|---|---|
| Agent | `Agent Help Center` | agent | team leader |
| **Team leader** | **`Campaign Assistance`** *(new)* | **team leader** | **campaign manager — Dalwin, Ryan** |
| — | `Coaching Actions`, `Coaching Fails`, `Coaching Sessions` | — | team leader |

Four pipelines already live in the `HL_HELP_LOCATION_ID` location. The fifth joins them:
one location, one key, **one HL contact per person** — `contactFor()` is reused verbatim
and keyed on CB, so a team leader who has ever appeared in another pipeline is the same
contact here.

**What I verified against the live API (read-only, 2026-08-30).** The objection was that
the register could not render an SLA column without a per-row fetch, which would blow
Cloudflare's 50-subrequest cap. It can:

- `/opportunities/search` returns **`customFields` inline on every opportunity** — so the
  whole register, SLA clocks included, renders from **one** call.
- Opportunities natively carry `assignedTo`, `status`, `createdAt`, `updatedAt`,
  **`lastStageChangeAt`** and `lastStatusChangeAt`.
- `POST /locations/{id}/customFields?model=opportunity` answers 200 — the field
  definitions can be provisioned by tool rather than clicked in by hand.
- `meta.total` plus a `startAfter` cursor drives pagination. The live referrals pipeline
  holds **1,747** opportunities, so the Help Center's five-page (500) scan cap is a real
  ceiling, not a theoretical one — this pipeline pages on the cursor and surfaces
  truncation rather than assuming it away.

**One thing HighLevel is genuinely not, and it changes a rule.** It is not a confidential
store — anyone with CRM access reads any note. So for a `restricted` (personal) request the
description and business impact are **never written to HighLevel at all**; the note reads
*"Restricted — personal matter. Details held with the team leader."* That is stronger than
the spec asked for: it removes the text rather than hiding it, and satisfies
*"the description and business impact are withheld"* by construction.

**The Help Center is not replaced and not touched.** The spec's own reasoning holds:
`AP.s.reqs` is the agent tier and `AP.s.areqs` is a sibling, *"because every consumer
filters `r.agent === id`"*. Here that separation is a separate pipeline — same grammar,
same code shape, different queue.

**No `migration-013` is needed.** Phase 0 loses the table; the only Supabase writes are the
contact-id rows `contactFor()` already makes.

### D3 — Where the rule book lives → **`rules` table keys**, not a workbook

The rules were uploaded as a spreadsheet on the prototype. Agent Analytics has no upload station and must not
grow one. The three tabs become three `rules` rows, edited by a small Node tool the way
every other setting is:

- `cm:sla` — the eight `setting_key`/`value` rows
- `cm:blockages` — the eleven blockage rows
- `cm:assignments` — the campaign-manager assignment rows

`AP.rbValidate` becomes `validateRuleBook()` in the Worker, carrying **all eleven**
validation rules verbatim — including *"P1 must be answered faster than P2, P2 than P3,
P3 than P4"* and *"a workbook that puts them out of order is refused and the error prints
both numbers"*. Nothing loads until every sheet passes; a failed write changes nothing.

### D4 — The five missing measures → **build them alongside Phase 2**

Originally scoped as a later, separable phase. The screenshots changed that: the sales grid
is fourteen tiles, and five of them would be empty on real data (§0.1a). The work is a PULSE
digest extension, not Worker or UI work, so it sits off the critical path and costs nothing
to run in parallel.

What stays true: **never invent a measure to fill a tile.** Conversion in particular is
flagged in the JSON's own open decisions as not yet usable — the 40% EXP–Cuddle tenure
target makes the campaign-weighted target read 33.3% against a 6.1% actual — so it may
publish and still print with a caveat until that target is settled (Q5).

---

## 3. The build

### Phase 0 — Provisioning (½ day)

1. Extend the `app_users` role check to allow `campaign_manager`. **No new table** —
   the assistance records live in HighLevel (D2).
2. Seed `cm:sla`, `cm:blockages`, `cm:assignments` from §rule_book of the JSON, verbatim.
3. `tools/provision-cm.mjs` — flip `dalwin` and `ryan` to `role='campaign_manager'`, set
   `full_name`, attach `hub_ids` (both leaders' Convex ids are known, §1.5), write the
   `cm:assignments` rows. Read-modify-write with a printed diff; no blind updates.
4. `tools/provision-cm-pipeline.mjs` — create the fourteen opportunity custom fields in the
   Help Center location via `POST /locations/{id}/customFields?model=opportunity`, and
   print their ids. Idempotent: it reads the existing definitions first and creates only
   what is missing. The pipeline itself is created by the Worker on first use.
5. Put `tools/sync-coaching-hub.mjs` on the daily cron (§1.4d).

**Verify:** `node tools/audit-permissions.mjs` — the standing rule is that a page is
invisible to scoped users until granted. Run it after this phase and after Phase 4.

### Phase 1 — The role, server-side (1 day) · `worker/src/portal.mjs`

`PORTAL_ROLES` gains `campaign_manager`. `authorise()` gains a fourth branch, sitting
between team leader and management:

```js
if (user.role === 'campaign_manager') {
  const camps = campaignsFor(user);                       // from cm:assignments — NEVER from the request
  if (!camps.length) return { error: 'This campaign manager account is not assigned to a campaign yet.', status: 403 };
  const rows = all.filter(a => camps.includes(campKey(a.campaign)));
  if (!rows.length) return { error: `No agents are currently on ${camps.join(', ')}.`, status: 409 };
  return { scope: 'campaign', cb: normCb(user.cb), campaigns: camps,
           codes: new Set(rows.map(r => r.code)), rows };
}
```

Fail loudly, never to an empty campaign — the same reasoning already written above the
team-leader branch (`portal.mjs:186`).

**The campaign scope needs one thing the team scope does not: the team leaders' own CB
codes.** The digest names a leader (`tl: "Renolan Pillay"`) but does not code them, and the
assistance pipeline is keyed on the leader's CB — so `authorise()` also returns
`leaderCodes`, resolved from `app_users` where `role='team_leader'`, whose `team` column is
exactly that same name (`cb207 | Renolan Pillay | Renolan Pillay`). Same reasoning as the
existing note above `tl`: a code that decides authorisation must not depend on whoever last
had a browser tab open.

`PORTAL_ALLOWED` gains exactly seven routes: `/api/portal/cm/overview`,
`/api/portal/cm/teams`, `/api/portal/cm/assist`, `/api/portal/cm/act`,
`/api/portal/cm/brief`, `/api/portal/cm/rulebook`, `/api/portal/cm/eod`.
Deny-by-default is preserved.

**The permission table is code, not documentation.** A `can(user, perm)` helper reads the
twelve-row table; `edit_source_data` and `override_sla` return `false` for every role
including Director, and there is no code path that can grant them.

**A campaign manager must not inherit team-leader routes.** `/api/portal/hub/kpi` and
`/api/portal/hub/coaching` are gated on `role === 'team_leader'` in `hubIdsOf()` and stay
that way. The CM reads coaching through the **snapshot** (`kv:coaching`, campaign-filtered
by CB join) and KPI-form *counts* through a new read-only CM path — never by borrowing a
leader's write credentials.

### Phase 2 — Sales aggregation (1½ days) · new `worker/src/campaign.mjs`

The sales half of the view. For each of `today` / `wtd` / `mtd`:

- Nine measures, summed over `auth.rows`, grouped by `campaign × tl` — **a team is one
  team leader AND one campaign**, the spec's intersection rule. Leon Petersen's worked
  example (7 agents split 2/3/2 across three campaigns) is the reason; the same shape
  applies to Renolan's 20.
- The **projection**: avg GWP per completed dialling day × planned dialling days. The
  digest publishes both `diallingDays` (elapsed) and `workingDays` (every weekday) and
  **confusing them breaks the money** — PULSE's own comment records an agent being told
  to write R2,012 a day instead of R252. MTD view only: *"a run rate on one day is not a
  run rate."*
- **Unattributed**, never silently allocated: agents whose GWP has no reading, and the
  digest's `notCovered` list. Banner-flagged by name.
- **Freshness** from `digest.updatedAt` and `coaching.fetchedAt`. The wording rule is
  absolute — *"Latest operational position"*, *"last uploaded"*, *"No upload loaded"*;
  the strings *"live data"* and *"real time"* must not appear.
- `reconcile()` asserts campaign total ≡ Σ team totals and refuses to render on a mismatch.

### Phase 3 — The Campaign Assistance pipeline (3 days) · new `worker/src/assist.mjs`

The largest piece, and the one carrying the golden rule:

> **Acknowledging a request is not assistance.** The first-response clock stops only when
> meaningful assistance begins or an authorised owner takes ownership and records a valid
> next action.

Written the way `help.mjs` is written — same `hl()` fetch wrapper with its 10-second abort,
same `pipeline()` name lookup with its 5-minute cache, same `searchAll()` truncation guard,
same `contactFor()`. Nothing new is invented where something already works.

**The pipeline.** `Campaign Assistance`, created by code if missing — the `Coaching Actions`
precedent, which creates its own pipeline because stage creation works when stages carry
positions. Six stages, and the whole design turns on one of them:

| # | Stage | Clock | Spec statuses folded in |
|---|---|---|---|
| 1 | New | **running** | `new` |
| 2 | Triaged | **still running** | `triaged`, `assigned`, `booked` |
| 3 | Assisting | **stops here** | `live`, `awaiting_evidence` |
| 4 | Awaiting confirmation | stopped | `awaiting_tl`, `awaiting_agent` |
| 5 | Follow-up due | stopped | `followup_due` |
| 6 | Closed | stopped | `resolved` |

Stage 2 holding the clock **open** is the golden rule made structural: triaging, assigning
an owner and booking a session all happen in Triaged, and none of them stops anything.
`escalated` and `reopened` are not stages — escalation is a flag that also pushes to the
existing escalation store, and a reopen moves the card back to Triaged with a note saying
why. Twelve statuses still exist in the API; six of them are stage boundaries and the rest
are carried as fields, so the board stays legible to a human dragging cards.

**The opportunity name** follows the proven `[tag] CBnn Name` shape so `parseRow()`'s regex
carries over unchanged — with the subject being a team **leader**, not an agent:

```
[dialler] CB207 Renolan Pillay · Cuddle
```

Blockage in brackets, the leader's CB (every team leader has one in `app_users`), then
name and campaign. Reclassifying on triage renames the card — one `PUT`, and the board
reads true.

**Where the machine state landed (built differently from the first draft of this
section, deliberately).** The draft put the stamps in HL opportunity custom fields. The
build uses a **mirror row per request** instead — `rules` key `kv:cm-areq:<opportunityId>`,
the same one-row-per-thing pattern as `kv:help-contact:CBnn` — holding priority, campaign,
the stamps, the gates, the baseline and the capped history. Two reasons: the custom-field
*write* API was the one call not verified against the live location (zero field defs exist
there), and a mirror row keeps the read path identical anyway — the register is still ONE
HL search plus ONE rules select, merged on id. HighLevel keeps what a human works: the
card, its stage, its owner, its notes. Owner rides `assignedTo`-equivalent in the mirror;
raised-at is HL's own `createdAt`.

> **Stamp the clock, never infer it.** `lastStageChangeAt` looks like it gives the
> assistance-start moment for free, and it does — until the card moves again, when it
> silently becomes the wrong number and every SLA figure behind it drifts. So the Assisting
> transition writes `assistance_started_at`, `first_response_mins` and `within_sla` at the
> moment it happens, and they are never recomputed. `lastStageChangeAt` is kept only as a
> cross-check in the audit note.

**Notes are the audit trail**, append-only and authored — the TL's own words, every
transition (who, what, from, to, when), resolution details, evidence, both confirmations,
and the follow-up reading. Read on drill-down only, exactly as `helpDetail` does with its
strict `startsWith` prefix match. **Never in the list** — a note fetch per row is what blows
the 50-subrequest cap.

**One search per page load.** Every assistance KPI — within-SLA %, median first response,
median resolution, repeat rate, evidence completeness — is computed in the Worker from the
one result set. `help.mjs` already warns that its list routes chain up to six HL calls; this
one does not fan out.

Then the rules themselves, all read from `cm:sla` and `cm:blockages`, never as literals in
the code (non-negotiable 12: *a rule must be READ, not copied*):

- P1 15m · P2 30m · P3 240m · P4 1440m. Four states: within / near (past `near_breach_pct`
  75%) / breached / met. `priority` is refused once assistance has begun.
- Eleven blockages, each routing to an owner. `personal` never writes its text to
  HighLevel at all (D2).
- **Resolution gates** — no close without resolution details, evidence, TL confirmation,
  agent confirmation where an agent was involved, and a follow-up date where improvement
  must still be measured. The screen **names what is missing** rather than disabling the
  button.
- **Duplicates merge**, on `campaign | team_leader | category`: before creating, scan the
  open cards for that `repeat_key`; on a hit, append *"Duplicate request merged into this
  one"* to the survivor and return its id. **This is deliberately the opposite of the Help
  Center's rule** — there, "duplicates are the point", because an agent asking twice with
  different reasons is two real asks. A team blocked twice on the same thing is one
  blockage, and counting it as two would flatter the repeat rate.
- **Repeats**: same key inside 30 days, minimum 2. *"A repeat means the cause was never
  fixed, only the case."*
- **Follow-up at 48 h**: baseline captured at raise time, metric re-read per category
  (`skill→conv`, `qa→qa`, `attendance→present`, …), verdict Improved / Unchanged /
  Declined (reopens) / **Not measurable** — which resolves *without inventing a reading*.
  Categories whose metric is not yet published return Not measurable until Phase 7.
- Every transition also writes an `assist` line into the existing audit trail.

### Phase 4 — The view itself (3 days) · `agent/index.html`

`CM_VIEWS` beside the existing `TL_VIEWS`, a third case in `navFor()`, a third branch in
`render()` — the two edits `TL_VIEWS` already made. Same shell, same sidebar, same KPI
tile, card, table and chip components, **no new design system**: the suite wears one skin,
and a campaign manager should recognise the app a team leader showed them.

1. **`cm_cmd` — Campaign Command.** Header (campaign name, manager, team/agent count,
   reporting period, the P1-open pill, the campaign selector, Today/WTD/MTD and
   **EOD report**), freshness line, the five answer tiles, the Nikola brief, the fourteen-tile
   sales grid, the "How the projection is worked out" line, the twelve-tile assistance grid
   ("How I am unblocking teams"), the blockage panel. **No role switcher** (§0.1c).
2. **`cm_teams` — Sales performance and assistance.** The eighteen-column control table,
   one row per team leader × campaign, ending in **Status** and **Next action**. The
   nine-rung diagnosis ladder is walked in order, first match wins — *"to tell a
   leadership problem from a blockage"*. Rung 9 (*"No agents on this campaign"*) matters
   here: several Hub leaders lead nobody, and *"an empty team is a finding, not an
   absence."*
3. **`cm_assist` — Assistance register.** Filters, request drawer, every action dialog.
4. **`cm_nik` — Nikola.** Three signals, **at most three actions**, each carrying what /
   why / owner / deadline / link. Nikola explains and prioritises what the deterministic
   rules found; it never makes a material decision about a person, and every action names
   a human owner who decides.

**Drill-down reuses the existing team-leader view** — `AP.cmOpenTl` becomes a call into
`pageMyTeam()` / `pageTeamResults()` in this campaign's context. *"There is no second
version of that screen."*

**Language.** The agent-facing acronym ban (`agent/index.html:63`) is an *agent* rule. A
campaign manager is management and may read SLA, P1, GWP, conversion. The rules that do
carry over: every figure keeps its sentence, and freshness is never dressed up as live.

### Phase 5 — The team leader's side (1 day)

Wraps the existing TL views rather than editing them, exactly as module `47-` does:
a "Ask the campaign manager" action, the request's live clock, and the confirm-or-dispute
step. `raise_request` is a **team-leader-only** permission — a campaign manager cannot
raise a request to themselves.

### Phase 6 — Rule book editing (½ day)

`tools/cm-rulebook.mjs --export | --validate <file> | --apply <file>` with a printed diff.
All eleven validation rules. On apply: **open requests re-read their target; answered ones
keep the target they were measured against.**

### Phase 7 — The five missing measures (2 days) — **run alongside Phase 2**

Extend `agentDigestPayload()` in `nicks_code/index.html` with per-agent `pitches`, `dials`,
`uniqueLeads`, `contacts`, `leadsWorked` — all already computed for PULSE's own tabs from
`VICI_CALL_REPORT` and `SF_OPEN_CASES`. Then conversion, attempts-per-lead, contact rate
and lead cover fall out, and the four blocked follow-up categories start measuring.
The digest is versioned (`v:1`) so the Worker can tell an old publisher from a new one.

---

## 4. Tests

| File | What it proves |
|---|---|
| `verify-cm-scope.mjs` | A campaign manager's payload contains **only** their campaigns' agents; a `viewer` is still refused; a CM cannot reach `/api/portal/hub/*`; `edit_source_data` and `override_sla` return false for every role including Director. |
| `verify-cm-sla.mjs` | Acknowledge/assign/book do **not** stop the clock; the Assisting transition does; the stamp is written once and never recomputed from `lastStageChangeAt`; near-breach fires at 75%; priority is refused after assistance starts; P1<P2<P3<P4 is enforced on rule-book apply. |
| `verify-cm-pipeline.mjs` | The register renders every SLA column from **one** `/opportunities/search` — no per-row note or detail fetch. Truncation past the page cap is surfaced, never assumed away. A duplicate on an open `repeat_key` merges instead of minting a second card. |
| `verify-cm-reconcile.mjs` | Campaign totals ≡ Σ team totals for all three periods, over the real digest. |
| `verify-cm-restricted.mjs` | A `personal` request's description and business impact never reach HighLevel at all — asserted on the outbound request body, not on the rendered page. |
| `verify-cm-rulebook.mjs` | All eleven validation rules; a failed apply changes nothing. |
| `verify-cm-hub-join.mjs` | Campaign is resolved from the Agent List, never from the Hub's `campaign` string — asserted against the 50-spelling live set. |

Plus the standing suite: `verify-all-tabs.mjs` and `tools/audit-permissions.mjs` after
Phases 0 and 4.

---

## 5. Sequence and effort

| Phase | Days | Depends on |
|---|---|---|
| 0 · Provisioning | 0.5 | **D1** |
| 1 · Role, server-side | 1 | 0 |
| 2 · Sales aggregation | 1.5 | 1 |
| 3 · Assistance + SLA | 3 | 1 |
| 4 · The four screens | 3 | 2, 3 |
| 5 · Team leader side | 1 | 3 |
| 6 · Rule book tool | 0.5 | 0 |
| 7 · Missing measures | 2 | PULSE-side; run with 2 |

**~12.5 working days to the view as the screenshots show it, all fourteen tiles
populated.** Phases 2, 3 and 7 are independent and run in parallel — ~10 days elapsed with
two people. Cutting Phase 7 saves nothing on the critical path and costs six blank tiles
on the main screen (§0.1a).

---

## 6. Open questions

1. **D1 — campaign assignments for Dalwin and Ryan.** Blocking Phase 0. Default proposed above.
2. **Dalwin's Lead Management coaching sits on "VAS - Group 9/10"**, not on a VAS campaign
   name. Is that a campaign, a nesting cohort, or a lead batch? It decides whether his 28
   sessions can be campaign-scoped at all, or whether they need their own join.
3. **The Coaching Scorecard is empty (0 of 711)** while the other five products are in
   daily use. Dead product, or a form nobody has been shown?
4. **63 KPI forms are in draft.** Should the control table treat a draft acknowledgement as
   not-done — i.e. is it a blockage, or just admin?
5. **The EXP–Cuddle conversion target** (the JSON's own open decision): 40% tenure target
   makes the campaign-weighted target read 33.3% against 6.1% actual — visible in the
   screenshots as *"6.1% · target 33.4%"*. The number is honest and reads as catastrophic.
   Settle the target, or the Conversion tile ships showing the actual with no target line.

---

## 7. What is deliberately not being done

- **The JSON's eight modules are not pasted in as source.** They are the same view written
  against the prototype's `AP.*` engine and its fourteen invented agents; here the view is
  built on the digest and the Worker, the way the other two views are. The rules come
  across verbatim — the code does not. (Applying the modules to `agent-preview/` instead is
  a separate, one-hour job if a demo build is ever wanted.)
- **The Help Center is not replaced.** Different tier, its own pipeline, same status
  grammar and the same code shape. An agent still asks their team leader there; a team
  leader asks Dalwin or Ryan in the new one.
- **No metric is computed in `agent/index.html`.** The one existing exception is the
  commission calculator, and it is test-proven against its React original. The campaign
  layer adds nothing to that list — every number is summed in the Worker from the digest,
  so this app and PULSE cannot drift apart.
- **Nothing is written to either Convex hub by the campaign layer.** The Coaching Hub is
  read-only from this suite by standing rule; `teamLeaders:create` and `:remove` exist on
  that deployment and nothing here may ever call them.

---

## 8. Build status (2026-08-30)

**LIVE since 2026-08-30.** `provision-cm.mjs --apply` ran (rule rows seeded, dalwin +
ryan flipped to `campaign_manager`), the Worker deployed (version 84f46184), and Pages
build `mtff38xm` serves the view at `/agent/`. The `Campaign Assistance` pipeline
creates itself in HighLevel the first time a manager or team leader touches it.

| Piece | Where |
|---|---|
| Sales aggregation, ladder, brief, EOD | `worker/src/campaign.mjs` (new) |
| Campaign Assistance pipeline + SLA + workflow | `worker/src/assist.mjs` (new) |
| Role, `campaign` scope, allow-list, overview branch | `worker/src/portal.mjs` |
| Route wiring + per-request CM context load | `worker/src/index.mjs` |
| The four screens + TL raise/confirm card | `agent/index.html` |
| Provisioning (rule seeds + role flips) | `tools/provision-cm.mjs` (dry-run by default) |
| Proof | `nicks_code/diagnostics/verify-campaign-manager.mjs` — 36 checks |

Verified: `verify-campaign-manager.mjs` 36/36 · `verify-agent-analytics.mjs` 89/89 ·
`verify-agent-portal.mjs` 81/81 (the endpoint contract and the F2 role contract were
extended for the new routes/role, the same way the help routes were on 2026-08-26).
Smoke-tested over the LIVE digest: 77 agents, three campaigns, all reconciled; Renolan
correctly appears as two teams (Cuddle · Renolan, Nesting · Renolan).

**What changed for the two accounts:** the flip put dalwin and ryan INSIDE the portal
lockdown — they no longer open the management dashboards; they sign in at `/agent/`
with their existing usernames and passwords and land on Campaign Command.

Still open: D1 (both managers currently hold all three campaigns — edit
`cm:assignments` to narrow), Phase 7 (the six unsourced tiles read "not published
yet" until the PULSE digest carries the dialler/lead measures), and the daily cron
for `sync-coaching-hub.mjs`.
