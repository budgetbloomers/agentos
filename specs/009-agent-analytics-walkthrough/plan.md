# Implementation Plan: AgentOS video 1, redone — Agent Analytics walkthrough

**Branch**: `009-agent-analytics-walkthrough` | **Date**: 2026-10-07 | **Spec**: [spec.md](spec.md)

## Summary

Record the real Agent Analytics — re-skinned for the demo only in the ThroughBalls palette — being used over spec 005's
fictional floor, as high-quality 1920×1080 clips with a visible pointer, click feedback and burned-in brand captions;
render the script's text-only moments as animated title cards; then Raylight assembles the clips (opening, transitions,
end card). One command produces every clip plus review frames.

## Technical Context

**Language/Version**: Node 20+ ESM (tools/demo/*), Playwright (Chromium) from nicks_code/diagnostics/node_modules
**Primary Dependencies**: FFmpeg 9 (full build, on PATH) for encoding and review frames; Raylight MCP for assembly
**Storage**: clips + review frames in `Downloads\AgentOS Agent Analytics Video`; nothing in the product
**Testing**: per-segment checks (page errors, spinners, error text, Chatterbox, Wimpy, unpainted tables, OFF-PALETTE
colours on screen) + story assertions against the backend + leak check; review frames extracted per caption and viewed
**Constraints**: product files untouched (served HTML rewritten in memory); Raylight renders need its tab visible
**Scale/Scope**: 8 clips, ≈ 3–3.5 minutes

## Constitution Check

| Principle | Check |
|---|---|
| I Engine decides | Pass — every figure comes from the real engines and Worker; captions only describe. |
| II Money model | Pass — unchanged. |
| III Agent List | Pass — fictional floor; leak check runs. |
| V Locked down | Pass — no product, route or CSP change; skin + overlays exist only in the demo's own server/browser. |
| VII Guard first | Pass — the off-palette check (red on spec 008's s02: navy-tinted greys, blue links) and every existing check fail the run. |

## Skin v2 — the ThroughBalls palette by rule (tools/demo/story.mjs `brandHtml`)

Every `#rrggbb` / `rgb()` / `rgba()` in the served HTML is mapped by hue/saturation/lightness:
- blue · navy · indigo · violet · sky (hue 180–300, saturation > 0.12): pale (L ≥ 0.80) → neutral grey of the same
  lightness; dark (L < 0.25) → neutral near-black; strong mid tones → #007338 (L < 0.42) / #46b649 (< 0.62) / #90c640;
  muted slate mid tones → neutral grey.
- greens (hue 80–170): snapped to #007338 / #46b649 / #90c640 by lightness; pale greens → brand-green tints.
- reds, ambers, yellows: unchanged (meaning). Neutral greys: unchanged.
Plus: logo → ThroughBalls (white wordmark on the black menu, black wordmark on light), "The Chatterbox" → AgentOS,
menu emoji shown in one neutral tone. Guard: a per-segment scan of visible elements' computed colours fails on any
blue/violet hue with saturation > 0.25.

## Recording

- Viewport 1600×900 CSS px at device scale 1.2 → frames are 1920×1080 physical pixels (UI 20% larger, crisp).
- Chromium screencast (JPEG q≈92, every frame) → frames with timestamps → FFmpeg concat → H.264 MP4 (CRF 16, 30 fps).
- Overlay injected per page: an arrow pointer that glides (eased, ~600 ms) to each target before the real click, a green
  click ripple; a caption card bottom-left (black 82%, green accent bar, Montserrat 700 headline / 500 line) that fades
  and slides in/out. App animations ON (the screenshot capture turned them off).
- Typing uses real key presses (~45 ms/char).

## Clips and captions (approved wording; ≈ s)

| Clip | View | What happens | Captions |
|---|---|---|---|
| 01 Title (13) | card | kinetic type on black + green glows | "Most agents work across multiple systems." · "They know their target. They can see their numbers." · "But what should they do differently **today**?" · "That's what AgentOS solves." |
| 02 Agent (≈80) | agent | sign-in screen → Today: tiles, slow scroll, back up → pointer to 52% tile → click → What-to-do panel → close → My Progress → advice cards → "Ask Tumi to help with …" → reason → typed note → Send → toast → "Your help requests: sent, not opened yet" | "Not twenty dashboards. One view." / "Her numbers, against the targets that matter." · "Dialler · CRM · QA · Attendance · Coaching" / "All in one place." · "Target achieved: 52%." / "A red number on its own changes nothing." · "So AgentOS goes one step further." · "Not “improve your numbers.”" → "“Here's what to do next.”" / "Built from your operating rules and her own data." · "The highest-impact actions, first." / "Ranked by points available. No twenty-point plan." · "Need help? Ask Tumi, right inside AgentOS." / "Pick a reason. Say what you need." |
| 03 Team leader (≈25) | TL | Help Center: new → click name, note opens → "Waiting on agent" | "It lands in Tumi's Help Center." / "Time-stamped. Visible. Accountable." · "Not lost in a WhatsApp message." · "Tumi marks it done." |
| 04 Agent (≈14) | agent | My Progress → "Did Tumi sort it out?" → "Yes, I was helped" → toast | "Nomvula confirms." / "Every request stays on the record." |
| 05 Loop (8) | card | six words light up in a loop | "Measure. Identify. Recommend. Act. Confirm. Improve." |
| 06 Team leader tour (≈32) | TL | My Team (who needs help + "Do this…") → Team Results → Reports (month to date) | "The team leader's view" / "Who needs help — and the next step for each person." · "Team results" / "Every agent, every measure, side by side." · "Reports" / "Month to date, ready to export." |
| 07 Campaign manager tour (≈28) | CM | Campaign → Teams → Reports (month to date) | "The campaign manager's view" / "Every campaign in one place." · "Teams" / "Every team leader, side by side." · "Campaign reports" / "The same numbers, for the whole operation." |
| 08 End (6) | card | ThroughBalls logo, "AgentOS", "Turn performance data into action." | — |

≈ 206 s before Raylight trims transitions (target 150–210 s).

## Raylight assembly

New project (or the user's open one, confirmed first): add the 8 MP4s as shots in order; 400–600 ms blur/crossfade
transitions; a short logo sting before clip 01 is optional; no extra text layers (captions are in the clips). Review:
render_stills at each clip's start/mid/end with the tab visible.

## Project structure

```text
specs/009-agent-analytics-walkthrough/   spec · plan · tasks · checklists · review.md
tools/demo-agent-video.mjs               the one command: floor → VAS digest → backend → clips → checks → review frames
tools/demo/video.mjs                     screencast recorder, pointer + caption overlay, title cards
tools/demo/story.mjs                     brandHtml v2 (palette by rule) — shared with spec 008's capture
tools/demo/checks.mjs                    + off-palette check
```
