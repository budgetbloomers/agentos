# Feature Specification: The team leader's Coaching Hub tab — the Hub itself, locked to their own workspace

**Feature Branch**: `035-tl-coaching-hub-locked` · **Created**: 2026-10-14 · **Status**: BUILT 2026-10-15, guards green — awaiting deploy (Convex → Hub → Worker + Pages → `migrate-worker-drafts --apply` → browser walk as a leader)

## Decisions (Nick, 2026-10-15 — "going back to change the team leader view to this only, where they see their forms; once they fill in and click submit they cannot edit their forms; once they click save they can go back and edit their form")

- **Q1 — accepted**: the lock is in the Hub's leader mode and its data; the Hub still has no sign-in.
- **Q2 — dropped from the tab**: the team leader's Coaching Hub tab is the Hub and nothing else. "Coaching on your agents by others" stays where it also lives, in the agent drill-down (spec 002).
- **Q3 — keep the lock**: Submit locks a document for good (a line; never opened, edited, deleted or printed by its author in the Hub's leader mode). Save keeps a draft the leader can reopen and edit.
- Every linked leader gets the frame at once (no per-account trial flag). `tools/map-hub-ids.mjs` matches all 9 team-leader accounts (Charlotte included) — run `--apply` if any account still lacks `hub_ids.coaching`.

**Input**: Nick, 2026-10-13 (screenshot of the campaign manager's Coaching Hub tab showing Dharmendra's workspace in the
AgentOS theme): "for the team leaders coaching hub I want it to look like this but there can only see their forms and etc"

## Context

- Campaign managers get the live Hub app inside their Coaching Hub tab (spec 033), themed blue, no logo. Nick wants the
  **team leaders'** Coaching Hub tab to be the same thing, but each leader sees **only their own workspace and forms**.
- Today the team-leader tab is a native page (specs 003/004): the Hub's six forms rebuilt in the AgentOS page, **drafts**
  kept in the Worker, and the **submit lock** — once submitted, a document is a line the leader can never open again
  (UAT 5 Oct: "when click submit, he must not be able view"). It also shows "coaching on your agents by others".
- The Hub app has **no sign-in, no draft state and no submit lock**: every document is created on Save and stays
  viewable, editable and deletable by anyone with the address. Checked 2026-10-14: none of its ten tables carries a
  status field. 8 of 9 team leaders have a Hub profile id on their account; Charlotte Govender does not (the Hub lists a
  "Charlotte"; `tools/map-hub-ids.mjs` left her unmapped).

## Decision (proposed)

The team-leader tab embeds the Hub exactly as the manager's tab does, opened in a new **leader mode** the Hub gains:
`?theme=agentos&leader=<hubId>`. In leader mode the Hub (1) opens on that leader's workspace and refuses to leave it,
(2) keeps Nick's spec-004 rules inside its own data: **Save** keeps a document as a draft the leader can reopen; **Submit**
locks it — from then on it is a line (date, product, agent, signed state), never opened, edited, deleted or printed by
its author. Outside leader mode (the plain address, the manager's tab) nothing changes: everything stays visible.

## User Stories

### US1 — Same screens as the Hub, my workspace only (P1)
A team leader opens Coaching Hub and sees the Hub's dashboard for their own workspace (total sessions, the six product
cards, sessions over time), the six product lists, and New Coaching Session — in the AgentOS theme, no logo. There is
no team-leader directory, no "back to home", no "Manage team leaders", and typing another leader's workspace address
inside the frame lands back on their own.

### US2 — Drafts and the submit lock live in the Hub (P1)
Every coaching form in leader mode has **Save draft** and **Submit**. A draft opens again from its product list and can be
edited and signed; a submitted document shows as a locked line with its signature state. Signatures drawn on a draft
clear if the wording changes afterwards (the spec-004 rule, carried over). Existing documents (created before this
feature) count as submitted.

### US3 — Managers and the plain Hub unchanged (P1)
In the manager's tab and at the plain address, every document is still viewable, editable and printable, drafts
included (marked as drafts).

### US4 — Nothing lost from today's tab (P2)
Drafts a team leader already has in the Worker are carried into the Hub as drafts once, by a tool. The "coaching on your
agents by others" block (spec 002) either moves into the Hub's leader-mode dashboard as a card or stays as a small
native sub-tab — Q2.

## Open questions for Nick (the plan proceeds on the defaults in bold)

- **Q1 — The lock is in the browser, not at a door.** The Hub has no sign-in (your decision, spec 004). Leader mode
  stops a leader wandering inside the tab, but a leader who types the Hub's own address still sees every workspace, as
  today. **Default: accept that** (it is the position you chose in October). The alternative is a real sign-in on the
  Hub — a separate, larger feature.
- **Q2 — "Coaching on your agents by others"** (Dalwin's lead-management sessions on a leader's agents, for example).
  **Default: a card on the leader-mode dashboard** fed by the Hub's own data (sessions whose employee code is on the
  leader's roster but filed by another profile). Alternative: drop it.
- **Q3 — Editing a submitted document.** Spec 004 says never, for team leaders. **Default: keep it** (locked line). If you
  now want leaders to edit after submit, the lock becomes "view only", a one-line change.

## Requirements

- **FR-001** Hub: `?leader=<hubId>` (remembered for the session like `theme`) puts the app in leader mode: home and every
  other workspace redirect to `/workspace/<hubId>/dashboard`; the back-to-home control and "Manage team leaders" are not
  rendered; the Team Leader KPI section stays hidden exactly as its own access rule says.
- **FR-002** Hub data: the six coaching tables gain `submitted: boolean` (absent = `true` for existing rows) and a
  `submittedAt`; create/update accept `submitted`; a `submit` mutation flips it once; `remove`/`update` refuse a submitted
  document when called in leader mode (a `leaderMode` argument the UI passes, so the plain app is unchanged).
- **FR-003** Hub UI in leader mode: forms show **Save draft** / **Submit** (Submit confirms, names missing signatures);
  lists show drafts as openable and submitted documents as lines without View / Edit / Delete / PDF; views and edit routes
  for a submitted document redirect to the list with a plain message.
- **FR-004** Signatures on a draft clear when any non-signing field changes after signing (the page rule of spec 004).
- **FR-005** Agent Analytics: the team-leader `coach_team` tab becomes the embedded Hub (the spec-033 frame machinery,
  parameterised by URL) at `HUB_APP_URL + '?theme=agentos&leader=' + hubId`; the Worker puts the session's
  `hub_ids.coaching` on the team-leader overview as `hubId`; a leader with no Hub id sees the words "your account is not
  linked to the Coaching Hub yet" (no frame), as the current tab does.
- **FR-006** The native forms, drafts cards and "Your sessions" leave the team-leader tab; `drafts.mjs` and the Hub proxy
  routes stay in the Worker until the migration tool (FR-007) has run and been verified, then are retired in a follow-up.
- **FR-007** `tools/migrate-worker-drafts.mjs`: every `coach-draft:*` row becomes a Hub document with `submitted:false`
  under its owner's Hub id; reported, idempotent, dry-run by default.
- **FR-008** `tools/map-hub-ids.mjs --apply` maps Charlotte Govender (resolve the ambiguity by exact profile name).
- **FR-009** Guards: Hub-side unit tests for the mode/redirect and the submit rules (the repo has none yet — a minimal
  vitest setup); Agent Analytics `verify-agent-analytics` + a new `verify-tl-hub.mjs` section for the TL frame URL and
  the no-Hub-id case; `verify-coaching-drafts`/`verify-coaching-signature` adjusted for the retired native forms (their
  Worker-side assertions stay until FR-006's follow-up).

## Success Criteria

- A team leader's tab shows only their workspace; attempts to reach `/` or another `/workspace/:id` inside the frame land
  on their own dashboard.
- Save → reopen → edit → Submit → the document is a locked line for the leader; the manager's tab still opens it.
- Existing Worker drafts appear as Hub drafts; no document is lost; the plain Hub address renders exactly as before.
- No submitted document's written content reaches a team leader through the Hub in leader mode (checked by walking the
  list, view and edit routes as a leader in a real browser).

## Out of scope

A sign-in on the Hub (Q1 alternative); the KPI Hub; changes to the campaign manager's tab.
