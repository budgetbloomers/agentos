# Chatterbox AgentOS — Build Plan (v0.3 · ZERO-LOCAL · SUPABASE + CLOUDFLARE)

**Goal:** A fully cloud-hosted Agent OS. Nothing runs on Nicholas's PC. **Cloudflare** hosts the suite, runs the Worker + Hermes AI + cron, and gates access. **Supabase** is the data layer: Postgres (SQL system of record) + Storage (raw files + the Obsidian brain). Obsidian and the Hermes chat agent both read from the same cloud brain.

**Version:** 0.3 · 11 July 2026 · supersedes v0.2 (which used Cloudflare D1/KV/R2 for data — replaced by Supabase at Nicholas's request; everything else carries over)

---

## 1. Architecture at a Glance

```
   Browser (TLs, execs)                      Obsidian (PC/phone — viewer only,
        │                                     syncs via Remotely-Save plugin)
        ▼                                            ▲
┌─────────────────────────┐        S3-compatible API │
│  CLOUDFLARE ACCESS       │◀────────────────────────┤
│  (Zero Trust login wall) │                         │
└──────────┬──────────────┘              ┌───────────┴───────────────┐
           ▼                             │        SUPABASE            │
┌─────────────────────────┐              │  ┌──────────────────────┐ │
│  CLOUDFLARE PAGES        │              │  │ POSTGRES (SQL)        │ │
│  /            Ops       │   fetch()    │  │ facts (agent-day),    │ │
│  /pulse/      VAS        │─────────────┼─▶│ batches, exceptions,  │ │
│  Ask chatbot widget      │             │  │ ACTION REGISTER,      │ │
└─────────────────────────┘             │  │ rules, ask_log        │ │
                                        │  └──────────────────────┘ │
┌─────────────────────────┐             │  ┌──────────────────────┐ │
│  CRON TRIGGERS           │──schedule──┼─▶│ STORAGE (S3-compat)   │ │
│  Mon 07:00 digest        │            │  │ raw upload files +    │ │
│  daily stale-check       │            │  │ brain/ markdown vault │ │
└──────────┬──────────────┘             │  └──────────────────────┘ │
           ▼                            └───────────▲───────────────┘
┌───────────────────────────────────────┐           │ service-role key
│  CLOUDFLARE WORKER (the agent)         │───────────┘ (Worker secret —
│  • /api/upload → Storage + Postgres    │              never in browser)
│  • NBA ENGINE (shared JS module —      │
│    code computes, never the LLM)       │
│  • /api/ask → WORKERS AI Hermes 2 Pro  │
│    function calling, tools:            │
│    sql_query · read_kb_module ·        │
│    read_brain · get_agent_result       │
│  • writes digests/cards → brain/       │
└───────────────────────────────────────┘
```

**Zero-local guarantee:** the only local things are a browser and (optionally) the Obsidian app as a *viewer* that syncs from Supabase Storage. No local LLM, no daemon, no database.

## 2. Component Choices

| Concern | v0.2 | v0.3 (current) | Notes |
|---------|------|----------------|-------|
| SQL system of record | Cloudflare D1 (SQLite) | **Supabase Postgres** | Real SQL, views, RLS available later; queried by Worker via PostgREST/supabase-js with the service-role key held as a Worker secret |
| Files & brain | Cloudflare R2 | **Supabase Storage** | Raw exports (immutable audit) + `brain/` markdown vault. S3-compatible endpoint → **Obsidian Remotely-Save syncs straight from it** |
| Config/rules | KV | **Postgres `rules` table** | One less service; the Dictionary stays user-edited, Worker reads it |
| Hosting | Cloudflare Pages | Cloudflare Pages | Unchanged — `/` Ops Analytics, `/pulse/` VAS Analytics |
| LLM (chat agent) | Workers AI Hermes 2 Pro | **Workers AI Hermes 2 Pro** | Unchanged — serverless function-calling Hermes behind `/api/ask`; the dashboard's chatbot widget is already wired to it |
| Agent runtime + cron | Cloudflare Worker + Cron Triggers | Unchanged | Monday digest, daily stale-check, upload processing |
| Auth | Cloudflare Access | **App-managed login (added 2026-07-12)**: `app_users` / `app_sessions` / `auth_log` in Supabase — admin-created users, PBKDF2-hashed passwords (never plaintext), session tokens (hashed at rest), lockout after failed attempts, **per-app + per-tab permissions** (`tabs` jsonb; `"*"` = all), per-user PII-unmask right. The Worker is the auth server: login endpoint, session check on EVERY /api call, tab-filtered data. UI hides unpermitted tabs, but the API is the real gate. Cloudflare Access remains optional as an outer wall for previews. | Built in Phase 2 (login page + Worker endpoints); table layer live now |

**Why this split works:** Cloudflare is best at edge hosting/AI/schedule/login; Supabase is best at data. The Worker is the only thing that talks to Supabase, so the CSP stays locked (`connect-src 'self'`) and no database credential ever ships to a browser.

## 3. The Iron Rule survives (unchanged)

NBA math is deterministic code — the dashboard functions `acStats`/`cfTier`/`acNBA`/`acComposite` are the ONLY engine, with every threshold live in the app Dictionary. (A separate `engine/` mirror + conformance guard existed 2026-07-12→15; it was production-unread and removed in the ponytail audit — resurrect from git only if the Worker ever needs to score server-side.) Hermes only narrates around computed JSON. AI autonomy A1–A2 per KB module 08; kill switch = a `rules` row the Worker checks before every AI call.

## 4. Data Flow

**Upload:** Upload Station (dashboard parses client-side, as today) → `POST /api/upload` → raw file to Storage (audit) + canonical facts to Postgres (date-keyed, Pulse's `buildModel` shape: `sales(date,agent)`, `calls(date,agent)`, `att(date,code)`, `evals(date,code)`, monthly snapshots) + batch row with counts/rejects → Worker scores via the shared engine → results + actions to Postgres → cards/report markdown to `brain/` in Storage.

**Chat (Hermes):** widget → `POST /api/ask` → Hermes 2 Pro with tools — `sql_query` (read-only Postgres over facts/results), `read_kb_module` (TCB-KB-V3 bundled with the Worker), `read_brain` (Storage), `get_agent_result` → guardrailed answer (status tags, `[INPUT REQUIRED]`, conflict flags, EBITDA block) → logged to `ask_log`.

**Brain/Obsidian:** Worker writes wikilinked markdown to Storage `brain/`; Nicholas's Obsidian (any device) syncs via Remotely-Save pointed at the Supabase Storage S3 endpoint (access key + secret from Supabase dashboard, bucket `brain`). Nothing local runs; Obsidian just catches up whenever opened. The repo's `brain/` seeds the bucket.

**Rhythm (cron):** Mon 07:00 digest → Postgres + engine → brain + dashboard home; daily stale-check mirrors the trust bar; overdue ACTION REGISTER rows escalate (hot-stove flow).

## 5. The Action Register (unchanged, now Postgres)

`actions` table per KB module 08 (`action_id, trigger, agent/system, issue, owner, priority, due, required_evidence, escalation, status, closed_date, evidence_text`). Every red NBA auto-creates one; closure requires evidence; overdue rows escalate on cron. *"A red metric without an owned action = the system has failed"* — enforced in SQL.

## 6. Phased Build — SHIPPED

Phases 0–3 and 5 are live (2026-07-15): suite deployed behind app-managed login, Worker + Supabase data path (kv blobs + row tables incl. bi_active_cases, THE money), /api/ask online, brain vault syncing via Remotely-Save. Phase 4 (action register + Monday/stale crons) was descoped — crons were removed unused; rebuild only when someone owns the digest.

## 7. Costs (ZAR at ~R16.4/USD)

| Item | Test week | Steady state |
|------|-----------|--------------|
| Cloudflare (Pages, Access ≤50 users, Worker free tier, Workers AI free 10k neurons/day) | R0 | **$5/mo (~R82–95 incl VAT)** Workers Paid, from Phase 3 |
| Supabase Free (500MB Postgres, 1GB Storage, 5GB egress) | R0 | R0 — comfortably fits this workload. **Caveat: free projects pause after ~1 week of inactivity**; daily cron traffic keeps it awake, but if it ever pauses it's one click to restore. Pro ($25/mo ≈ R410) only if the floor's data outgrows 500MB — years away at CSV scale |
| **Total** | **R0** | **~R82–130/mo** — unchanged from v0.2 |

## 8. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Service-role key leakage | Key lives only as a Worker secret; browser never talks to Supabase; CSP `connect-src 'self'` unchanged |
| Supabase free-tier pause | Daily cron ping keeps it active; restore is one click; raw files always re-ingestable |
| 7B Hermes number drift | Engine-JSON validation pass; SQL tool is read-only; kill-switch row |
| PII (POPIA) in cloud | Access in front; CB codes not names in AI prompts; Storage buckets private; masked views by default |
| Two-vendor coupling | Worker is the single integration point — swapping either side later touches one file |

## 9. Decision Log

- **NousResearch `hermes-agent` — REJECTED (2026-07-10)** for user-facing analytics/KB querying: self-improving A3–A4+ autonomy conflicts with KB module 08 (A1–A2, approved-content RAG), breaks engine-determinism, adds non-Cloudflare infrastructure, single-user by design. "Hermes" = the `hermes-2-pro-mistral-7b` **model** on Workers AI inside our guarded Worker. Phone Q&A later = WhatsApp/Telegram webhook → same Worker.
- **Cloudflare D1/KV/R2 — REPLACED by Supabase (2026-07-11)** at Nicholas's request: real Postgres SQL, S3-compatible Storage that Obsidian syncs from directly, one data vendor. Cloudflare keeps hosting/AI/cron/Access.
- **the-vault local HUD — REJECTED (2026-07-10)**: local Node server violates zero-local; vault conventions (hot/log) adopted into `brain/`. The INDEX.md catalog and its `/reindex` skill were dropped 2026-07-17 — a two-tier "read the index, then drill" retrieval layer over a three-file vault; only `hot.md` was ever read.
- **Permission-driven data scoping — DASHBOARD SIDE DONE (2026-07-20)**: role `tl` (SYS auth taxonomy: admin/exec/tl/qa/viewer) is now scoped to their own team. Enforced at `rowsForRaw` — the single data choke point — matched by the signed-in user's `full_name` → `team_leader`; fails CLOSED if unmatched (sees nothing, never the floor). The scoring peer-context (`acCtx`, guarded by `_fleetCtx`) is exempt, so tenure-relative percentiles/composites are still computed against the whole fleet for scoped and unscoped users alike. admin/exec/qa/viewer are unrestricted. **Open:** the identity link is name-based; a `team_id` on `app_users` would be sturdier, and finer clearance tiers (qa read-all vs viewer) are not yet differentiated beyond tl-scoping.
- **Coaching Hub ↔ QA closure sync — CONTRACT (2026-07-20, live sync = Phase 2)**: the Coaching Hub is an EXTERNAL Lovable app (`chatterbox-coaching-hub.lovable.app`, SYS-006), not code in this repo, so "close the QA flag when coaching completes" cannot be a client-side dashboard change. The dashboard is DOWNSTREAM: the QA pipeline shows every evaluation whose `qa_status` is not closed, so a flag closed in the QA tool (GHL) clears here on the next QA export. The client's request is really a Hub→QA-tool write-back (the Hub already carries `ghl_opportunity_id`/case linkage). **Phase-2 wiring:** Hub writes a coaching-completion row (keyed by `ghl_opportunity_id` or `record_id` + completed_at + coach) to a shared Supabase table; the Worker reconciles it against open QA evals and flips the flag, surfacing "closed by coaching" via the existing `qa_close_decision` field. Interim option if needed sooner: a manual "coaching completions" upload source that closes matching flags on ingest. Fits ZERO-LOCAL (Worker is the only Supabase writer).

## 9b. The Suite (unchanged)

Ops Analytics (`/`) + VAS Analytics (`/pulse/`), one Access login, app-switcher toggle, identical branding. Not code-merged — Phase 2's Supabase schema (date-keyed, Pulse-shaped) becomes the shared backbone feeding both. **Reconciliation register** (resolve before executive/external use): S1 sales definition (unique accounts vs unique opportunities — Finance decides), S2 GWP price source — RESOLVED 2026-07: Power BI `BI_ACTIVE_CASES` charge amounts are the only money source; the uploaded/hardcoded price tables were retired, S3 call source schema (CallX vs 3CX → one canonical call table), S4 coaching systems (NBA ladder is the prioritisation authority; Pulse plans = evidence layer), S5 attendance semantics (status codes vs shifts → unified attendance table).

## 10. Free-Tier Test Week (G3 gate before any spend)

Everything above runs on $0: Cloudflare free plan (Worker 10ms CPU — fine, parsing stays client-side; Workers AI hard-stops at the daily allocation, cannot bill; cron works on free) + Supabase free. Upgrade trigger at week's end: uploads persist multi-user, cloud scores match dashboard exactly, Hermes answers cite engine numbers, Monday digest arrived untouched, action register captured every red NBA → then Workers Paid ($5/mo) and carry on. Nothing gets rebuilt.

## 11. Immediate Next Steps

1. **Nicholas:** Cloudflare account + `npx wrangler login` + Access policy (company emails).
2. **Nicholas:** Supabase account → new project → copy URL + service-role key (I'll store it as a Worker secret, never in code) → create `raw` + `brain` buckets → generate Storage S3 keys (for Obsidian later).
3. **Me:** `/deploy` the suite → Phase 1 engine extraction → Phase 2 onward.

---

*v0.3 · zero-local · Supabase data layer + Cloudflare compute/AI · uses nba-analyst + chatterbox-kb skills*
