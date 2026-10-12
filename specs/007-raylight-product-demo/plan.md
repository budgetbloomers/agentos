# Implementation Plan: Raylight product demo video

**Branch**: `007-raylight-product-demo` | **Date**: 2026-10-06 | **Spec**: [spec.md](spec.md)

## Summary

Two parts. (1) Make spec 005's screenshot run demo-clean: drop the fictional Wimpy link, and on the VAS Apps page drop
the Wimpy card and blank the two third-party hub previews in the demo browser's own copy of `HUBS`; the run's per-shot
check now fails on "Wimpy" text or a visible hub preview. (2) Build the video in Raylight from ~20 of the regenerated
screenshots plus the transparent Chatterbox logo, review every shot on rendered stills, then the user exports and the
share page gets its title and description (kept private).

## Technical Context

**Language/Version**: Node 20+ ESM tools (existing `tools/demo/*`), Playwright from `nicks_code/diagnostics/node_modules`
**Primary Dependencies**: Raylight MCP (`https://api.raylight.app/mcp`, user scope, OAuth signed in 2026-10-06)
**Storage**: none in the product; screenshots in `C:\Users\aarav\Downloads\Chatterbox Demo Screenshots`; media in the
user's Raylight asset library
**Testing**: the run's own per-shot checks (now incl. Wimpy + hub previews) and the leak check; Raylight `render_stills`
/ `render_filmstrip` review of every shot
**Target Platform**: Raylight editor tab in the user's browser (edits stream live into it)
**Constraints**: Raylight tools only drive a CONNECTED editor tab; this Claude Code session started before Raylight was
added, so the Raylight work runs through the bundled CLI headless (`claude -p`, tools limited to `mcp__raylight__*`, curl
for the signed uploads, Read) — the user watches it build live
**Scale/Scope**: ~20 shots, 90–120 s, 1920×1080

## Constitution Check

| Principle | Check |
|---|---|
| I Engine decides | Pass — every figure on screen comes from spec 005's run through the real engines; the video adds captions only, no numbers. |
| II Money model | Pass — unchanged; no figure is re-derived or typed into a caption. |
| III Agent List | Pass — fictional floor; leak check against the real list still runs. |
| IV Like for like | n/a |
| V Locked down | Pass — no product code, route or CSP changes; nothing from the live system is used; share page stays private. |
| VI Saves | n/a |
| VII Guard first | Pass with note — the guard (Wimpy text + hub-preview check in `shot()`) is in the run itself; its red state is shots 24 and 48 of the 005 set (both show Wimpy, 24 shows the previews). |

No deviations; Complexity Tracking not needed.

## Project Structure

```text
specs/007-raylight-product-demo/   spec.md · plan.md · tasks.md · checklists/requirements.md · review.md (shot review log)
tools/demo/backend.mjs             − Wimpy link in kv:agent-links
tools/demo/pulse.mjs               apps step: demo copy of HUBS without Wimpy, hub previews blanked
tools/demo-screenshots.mjs         shot(): fails on "Wimpy" text or a visible hub/Wimpy preview image
```

## Shot list (story order, FR-005)

Captions are final only after the regenerated screenshots are viewed (FR-008: title ≤ 6 words, line ≤ 12).

| # | Source | Title | Line | s |
|---|---|---|---|---|
| 0 | logo | Chatterbox AgentOS | Call-centre performance, from raw data to coaching | 5 |
| 1 | 01 vas-dashboard | VAS Analytics | The whole floor at a glance | 6 |
| 2 | 02 vas-month-to-date-courtesy | Month to date | Every agent against target, per campaign | 5 |
| 3 | 05 vas-month-to-date-team-leaders | Team leaders | Every team, side by side | 5 |
| 4 | 06 vas-weekly-courtesy | Weekly reports | Week-on-week, per campaign | 5 |
| 5 | 09 vas-daily | Daily reports | Yesterday's floor, agent by agent | 5 |
| 6 | 11 vas-variance-summary | Variance report | Where the numbers moved, and why | 5 |
| 7 | 15 vas-lead-management | Lead management | Open leads and how old they are | 5 |
| 8 | 17 vas-agent-profile-drawer | Agent performance | One agent, every measure | 5 |
| 9 | 18 vas-leaderboard-gwp | Leaderboards | Like-for-like rankings | 4 |
| 10 | 22 vas-upload-station | Upload Station | Daily exports in, checked and loaded | 5 |
| 11 | 26 tl my-team | Agent Analytics | Team leader: my team today | 5 |
| 12 | 31→32→34→35 tl coaching | Coaching, on the record | Draft, sign, submit — then locked | 10 |
| 13 | 37 tl report-month-to-date | Team reports | The same numbers, for each team | 4 |
| 14 | 44 agent today | The agent's view | My day, my numbers | 5 |
| 15 | 45 agent projected-commission | Projected commission | What this month is worth | 5 |
| 16 | 46 agent my-progress | My progress | Month by month, against target | 4 |
| 17 | 49 cm campaign | Campaign manager | The whole campaign in one place | 5 |
| 18 | 50 cm teams | Teams | Every team leader, side by side | 4 |
| 19 | 52 cm report-month-to-date | Campaign reports | Month to date, ready to export | 4 |
| 20 | logo | Chatterbox AgentOS | — | 5 |

≈ 106 s. Tall full-page captures are framed on their top 16:9 region (sidebar logo + page head + first rows) or panned
slowly; never squashed (FR-009).

## Raylight build (order)

1. `get_editor_status` → connected tab on the user's new 16:9 project; else `list_projects` and give the link.
2. `get_design_guide` for the closest official template (image-slide / linear-hero) — mirror its timing beats.
3. `upload_media` way 3 (signed PUT, `files` bulk ≤ 20) for the logo + the 23 source PNGs; finish with `assetIds`.
4. `apply_edits` per section (shots, images, captions with one font family, entrances, camera rest/moves).
5. Review every shot: `render_stills` at start+700 ms, mid-hold, end−300 ms; `region` zoom on captions and the logo;
   lint from `get_shot_details` clean. Findings → `review.md`, fixed, re-rendered.
6. User presses Export; then `list_videos` → `update_share_page` (title, description; visibility stays private).
