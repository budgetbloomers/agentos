# log — append-only

## [2026-07-10] init | Brain vault created (LLM-wiki pattern; INDEX/hot/log adopted, local HUD rejected)

## [2026-07-12] phase-1 | Engine extracted: engine/nba-engine.mjs · 24/24 unit tests · 213/213 conformance checks (dashboard ≡ engine) · guard hook now blocks divergence

## [2026-07-12] phase-2to5 | LIVE: login gate on both apps · chat wired to Llama 3.3 (Hermes deprecated) answering framework Qs · action register create/list/evidence-gated-close verified · brain bucket seeded (10 objects) · Obsidian runbook written

## [2026-07-12] kb-access | AI given full TCB-KB-V3: kb.mjs bundles 11 modules + layered-retrieval router (bootstrap always-on + top-2 by keyword); response contract enforced (status tags, conflict-flagging, name corrections, [INPUT REQUIRED]). Verified: CTTO, 330-agent funding, systems-red count, COO-unresolved. Also: framework KB embedded, off-topic guardrail, sessionStorage login-per-tab.

## [2026-07-12] agent-ai | Clicking an agent (Ops modal + VAS drawer) now shows a Llama "what's working / what to improve" coaching card built from that agent's live metrics + NBA framework; back-arrow added to both. Deployed.

## [2026-07-13] tracker-v2 | migration-004 applied to Supabase (daily_eod, RLS on, 0 policies — verified via Management API; no kv blob to migrate). Tracker Analytics restyled to suite dark-glass (Ops palette, shared logo, hairline tables) + Ask AgentOS widget with ai-digest-tracker push; worker Ask loop now reads all three digests. site/ rebuilt — NOT yet deployed (needs /deploy + wrangler deploy in worker/).

## [2026-07-13] spec-v3.8 | AgentOS Copilot spec v1.0+v2.0 received (synthesised from an AgentOS v3.8 build, 204 jsdom checks — a SEPARATE artifact from this repo's dashboard). Headline: GWP no longer hardcoded — PRIMARY money = Power BI Active Cases (Σ ex-VAT charges ×1.15, per-row create date); GWP table demoted to legacy fallback. Digest filed at specs/AgentOS-v3.8-upload-frameworks.md; CLAUDE.md non-negotiable 6 updated to the two-model doctrine. GAP: BI_ACTIVE_CASES source not yet implemented in this repo's dashboard (11 sources, no jsdom suite). Open: where does the v3.8 build live / does BI get implemented here?

## [2026-07-13] cleanup+fresh | git repo initialised (baseline commit; uploads/ gitignored for POPIA). Ponytail-audit applied: deleted skillsmith/, the-vault-llm-wiki(+zip), tools/_archive, /api/fullaudit, canAccess, storagePut, pageSoon, maskContact, dup onCustomRange, perDay, tracker window exports; knowledgebase-src → uploads/. Knip clean. DB-VISIBILITY FIX: diagnosed cloud had only 4 kv keys (other sources never uploaded from a signed-in live session — second user saw nothing); added /api/kv meta=1 beacon + cbx-fresh watchers in all 3 apps (4-min + focus re-hydrate, mid-edit + resurrection guards). Engine 24 tests + 213 conformance checks pass. Awaiting /deploy + worker deploy + RE-UPLOAD of missing ops sources.
