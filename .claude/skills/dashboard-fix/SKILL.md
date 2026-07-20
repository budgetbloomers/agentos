---
name: dashboard-fix
description: Make changes to the Chatterbox analytics dashboard (Chatterbox_AgentOS_Analytics.html) safely — new KPIs, sources, pages, fixes — following the app's conventions. Use for any edit to the dashboard HTML.
---

# Dashboard Fix

Convention-enforced editing of the single-file dashboard. The file is ~5k lines: **never read it whole** — Grep for the target section, read that region, edit surgically.

## Workflow

1. **Locate** the section with Grep (see the architecture map in `.claude/agents/dashboard-reviewer.md` — SOURCES, TRANSFORM, DEFAULT_RULES, DEFAULT_KPIS, evalKPI/rowsFor, acStats/cfTier/acNBA/acComposite, page renderers).
2. **Edit** following the conventions in CLAUDE.md ("Dashboard conventions" + "Non-negotiables"). The most common tasks:
   - **New KPI** → add to `DEFAULT_KPIS` (id, name, domain, src, type, num filter using `$rule` refs, format, dir, green/amber, owner, interp, red-action). A KPI without `interp` and `red` text is decoration — always write both.
   - **New threshold/definition** → `DEFAULT_RULES` entry, referenced via `$ruleName`; never a hardcoded constant.
   - **New data source** → `SOURCES` contract + `TRANSFORM` mapping + rejects with reasons; decide snapshot vs time-series (`snapshot:true` replaces on upload).
   - **UI strings** → through `esc()`; names `maskName()`; money `fmtVal(v,'zar')`/`zarStack()` (VAT-inclusive with ex-VAT line).
3. **The dashboard-guard hook fires automatically after your edit** and blocks if a non-negotiable broke (weights ≠ 100, cfTier/acNBA removed, penalty cap gone, normCB/maskName missing, gwpFloor gone). Fix immediately if it triggers.
4. **Review**: for anything beyond a trivial tweak, hand the diff summary to the `dashboard-reviewer` subagent and act on DO-NOT-SHIP findings.
5. **Verify in browser**: open the file, load demo data (Upload Center → Load demo data), and exercise the changed page.
6. **Re-prepare the deploy copy**: `node tools/prepare-site.js` so `site/index.html` picks up the change (never edit site/index.html directly).

## Hard limits

- Ladder order, R2A banding, composite weights, tenure targets change ONLY on an explicit framework-version instruction from the user (they mirror the signed NBA v3.0 document) — and then update `nba-analyst/frameworks/` in the same commit so skill and dashboard stay in lockstep.
- Session (SES_*) data must never feed daily analytics, the Scorecard, or KPI tiles.
