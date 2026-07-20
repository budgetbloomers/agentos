---
name: weekly-report
description: Build the Monday Team Leader NBA report from the latest data exports — score every agent through NBA v3.0, produce the colour-coded TL brief, save to reports/. Use when asked for the weekly report, Monday brief, or a scoring run over new files.
---

# Weekly Report

Produce the Monday TL report: one primary NBA per agent, colour-coded RED→AMBER→BLUE→GREEN, with carry-forward decisions. Mirrors the dashboard's TL view but as a portable markdown artefact for the Monday meeting and the Obsidian vault.

## Steps

1. **Locate inputs.** Look in `uploads/` (or the path the user gives) for the latest exports: Agent List (mandatory — identity base), **Power BI - Active Cases (`BI_ACTIVE_CASES` — THE money source: sales and GWP come from this file only)**, CallX call records, QA evaluations, attendance, inactive/cancellations. If the Agent List is missing, stop and ask — every threshold is tenure-relative. With no BI file, money reads blank and the report must say so — there is no legacy fallback (Activated Services + GWP table were retired 2026-07).
2. **Delegate scoring to the `nba-scorer` subagent.** Pass it the file paths and the reporting window. It writes and runs the scoring script (code computes, never mental math) and returns: derived-metrics table, per-agent NBA cards, leaderboard with composite 'Adj', and R2A flags.
3. **Assemble the report** using `nba-analyst/templates/tl-weekly-report.md`:
   - Priority summary counts (L1–L4), one row per agent sorted RED→AMBER→BLUE→GREEN
   - R2A-1 flags as footnotes, never rows
   - Carry-forward table: read last week's report from `reports/` if present; mark each open NBA clear/escalate
   - Owners/dues not yet assigned → `[TL to assign Monday]`
4. **Validate** against `nba-analyst/checklists/nba-quality.md`. Any failed check = fix before delivering.
5. **Save** to `reports/nba-report-{team}-{ISO week}.md` and present the priority summary + RED rows in chat.
6. **File into the brain vault** (`brain/` — see brain/CLAUDE.md schema): the report as `brain/NBA-Reports/{ISO week}.md` with wikilinks (`[[CB-xx]]`, `[[P2-R4]]`, `[[Team-x]]`); create/update one `brain/Agents/{CB-code}.md` page per RED/AMBER agent; one `brain/Actions/` entry per red NBA (owner, due, evidence pending). Append a `## [date] ingest | week {W} report` line to `brain/log.md`, then refresh `brain/hot.md` (keep it under 500 words — it is what the session-start hook and the Worker's /api/ask read).

## Rules

- Numbers in the narrative must match the scorer's JSON exactly — re-ask the scorer rather than adjusting a figure yourself.
- Never score across tenure groups; never surface two NBAs for one agent.
- If input files fail contract validation, run /upload-check on them and report instead of guessing at columns.
