<!--
Sync Impact Report
- 1.1.0 → 1.2.0 (MINOR, 2026-10-01, feature 002-live-month-sync-coaching): the live-digest constraint redefined —
  always the current month (empty payload before its first data), empty never over data. CLAUDE.md NN12 amended
  in the same change.
- 1.0.0 → 1.1.0 (MINOR, 2026-10-01, feature 001-cm-view-signoff): Platform Constraints expanded — published
  period keys (months, billing cycles) and the explicit Worker subrequest budget for fan-out work. CLAUDE.md
  NN12 amended in the same change.
- Version change: (template) → 1.0.0
- Principles added: I. The Engine Decides, the Page Paints · II. One Money Model; an Absence Is Not a Nought ·
  III. The Agent List Is the Record · IV. Like for Like · V. Locked Down by Default ·
  VI. Saves Are Acknowledged, Noticed and Recoverable · VII. Every Rule Has a Guard
- Sections added: Platform Constraints, Delivery Workflow, Governance
- Removed sections: none (first adoption)
- Source: every principle summarises a rule ALREADY enforced in agentos/CLAUDE.md (non-negotiables 1–15,
  dashboard conventions, deployment). Nothing here is new policy.
- Templates: plan/spec/tasks templates read this file at run time; no template edits required.
- Deferred TODOs: none
-->
# Chatterbox AgentOS Constitution

## Core Principles

### I. The Engine Decides, the Page Paints
Every number and every verdict an agent, team leader or campaign manager sees is computed by deterministic
code — the PULSE engine (`nicks_code/index.html`), the Ops engine, or `worker/src/*.mjs` rule modules — and
travels to the page as a value or a verdict. Pages MUST NOT re-derive a rule-book value (no VAT divisions, no
literal thresholds). LLMs (Nikola, `/api/ask`) MAY explain numbers and MUST NOT compute them. A rule-book value
lives in a spec file (`specs/*.json`) with an inlined operative copy, changes only with a dated `_changes[]`
entry, and both copies change together (drift guards fail otherwise). Saturdays, public holidays and excused
leave are data, not shifts (`dataOnlyDay()`, `excusedStatuses`). (CLAUDE.md NN1, NN12)

### II. One Money Model; an Absence Is Not a Nought
GWP comes from the Power BI Active Cases model only: charges ex-VAT per Case Number, grossed up through the
VAT rule, sales net of cancellation. Missing data reads blank and says so — it MUST NOT become a zero, an
imputed value, or a silent fallback; scores renormalise across the metrics an agent actually has. A real zero
with data loaded still scores zero. (NN4, NN6)

### III. The Agent List Is the Record
The latest valid Agent List is the identity base and the org of record: CB codes normalise, every join
resolves through it, unmapped rows are flagged never dropped or invented. Facts are attributed at MONTH grain
(the list owns its whole month); a genuine campaign move inside a month is split by date (D4). Accounts follow
the list and the DATABASE enforces it in one transaction (`publish_agent_list` → `sync_*`), with fail-closed
guards. Team leaders are reported, never invented. (NN7, NN11, NN13)

### IV. Like for Like
Agents are compared only within their tenure group (M0/M1/M2/Exp-Courtesy/Exp-Cuddle); percentiles are within
group. One primary NBA per agent; the R2A tier classifies but carries no score penalty; the composite follows
the live-editable `compositeWeights` rule. (NN2–NN5)

### V. Locked Down by Default
The suite sits behind its own login (PBKDF2, sessions, lockout) on every page; role scoping is enforced in the
Worker, never by hiding UI. The Worker is the ONLY component that talks to Supabase; the service key is a
Worker secret, CSP `connect-src` stays `'self'` (the one signed-URL storage exception is documented), PII
masking defaults on, and all user strings pass through `esc()`. New pages are invisible to scoped users until
granted. (NN10, conventions)

### VI. Saves Are Acknowledged, Noticed and Recoverable
Unsaved data is a STATE (banner, retry with backoff, `beforeunload` challenge), never a toast. Writes that two
sessions can race use compare-and-set. The server watches for what did not arrive (sentinels, health alerts
that clear themselves). Browser behaviour is proven in a real browser: a production deploy is not done until
the post-deploy smoke (`verify-cors-headers --live`, `verify-live-save --live`) passes. (NN14)

### VII. Every Rule Has a Guard
Every rule and every fix ships with a `nicks_code/diagnostics/verify-*.mjs` suite written first (red, then
green). Credential-free suites are registered in `.github/workflows/verify.yml`; no figure ships with an
error-severity rule-check FAIL; a deployed change is verified against live data where a live suite exists.

## Platform Constraints

- Zero-local: compute, cron and login on Cloudflare (Worker, Pages, Cron Triggers); data in Supabase
  (Postgres + Storage). The Cloudflare plan is FREE (10 ms CPU per request): engines MUST NOT run in the
  Worker — heavy computation happens in PULSE or a tool and is published as a payload the Worker serves.
- The live agent digest is ALWAYS the current SAST calendar month — an honest empty-month payload (null
  figures) before its first data, never zeros, and never replacing a same-month payload that has data; an older
  month never takes the live key. Other periods are published under their own keys — past months as
  `kv:agent-digest-YYYY-MM`, billing cycles (26th→25th, `worker/src/cycle.mjs`) as `kv:agent-digest-cycle-YYYY-MM`,
  both built by the engine, never re-aggregated by the Worker.
- Every Worker invocation stays inside the FREE plan's 50 subrequests: fan-out work (the Coaching Hub refresh)
  is chunked against an explicit budget, resumes from a pointer, and logs every attempt.
- Large files take the Rake; duplicates are removed by the database (`dedupe_lake()`). (NN15)
- `site/` is generated by `tools/prepare-site.js`; never edit it by hand.
- Pages are ES5 single-file HTML (no build step); the Worker is ESM.

## Delivery Workflow

Specify → plan → tasks → tests first → implement → independent review (code + security where auth, input,
data or external calls change) → full credential-free suite run → deploy Worker then Pages → mandatory
post-deploy smoke → live verification → commit (conventional message). Pushing is a separate, explicit request.

## Governance

`agentos/CLAUDE.md` is the operational source of truth; this constitution summarises it and MUST be amended
in the same change whenever a non-negotiable is added, changed or retired. Plans (`/speckit-plan`) MUST pass a
Constitution Check against Principles I–VII; any justified deviation is recorded in the plan's Complexity
Tracking table. Versioning: MAJOR = a principle removed or redefined; MINOR = a principle or section added or
materially expanded; PATCH = wording.

**Version**: 1.2.0 | **Ratified**: 2026-10-01 | **Last Amended**: 2026-10-01
