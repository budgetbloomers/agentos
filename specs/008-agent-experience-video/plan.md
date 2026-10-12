# Implementation Plan: AgentOS video 1 — The Agent Experience

**Branch**: `008-agent-experience-video` | **Date**: 2026-10-06 | **Spec**: [spec.md](spec.md)

## Summary

(1) A new one-command capture, `node tools/demo-agent-experience.mjs`, runs spec 005's fictional floor through the real
engines and the real Worker (in-process), serves Agent Analytics through a demo-only ThroughBalls skin (the HTML is
rewritten as it is served: palette, logo, product name — `agent/index.html` on disk is untouched), and performs the
story through the product: Nomvula Dube (CB9112) signs in, opens her behind-target tile, reads her advice, asks Tumi
Khoza (cb9002) for help; Tumi opens it (seen) and moves it to "Waiting on agent"; Nomvula answers "Yes, I was helped".
Screens are 1440×900 viewports at 2× density into `Downloads\AgentOS Agent Experience`. (2) The video is built in the
Raylight project "Agent OS" (cleared first) with the native Raylight MCP tools, reviewed frame by frame, exported by the
user, share page private.

## Technical Context

**Language/Version**: Node 20+ ESM (tools/demo/*), Playwright from nicks_code/diagnostics/node_modules, Python PIL (logo
variants, one-off)
**Primary Dependencies**: Raylight MCP (user scope, signed in); the existing demo floor/backend (spec 005)
**Storage**: none in the product; output folder in Downloads; brand assets in `tools/demo/brand/`
**Testing**: per-shot checks (page errors, spinners, error text, "Chatterbox" text, Wimpy, content-visibility, leak
check) + story assertions (the request reaches each state); Raylight `render_stills`/`render_filmstrip` review
**Constraints**: the live product is never changed (FR-001); the Raylight tools must be loaded in the session that
builds — this session started before the server existed, so the build runs after the conversation is resumed in a fresh
Claude Code process (the headless route was slow and opaque and the user stopped it)
**Scale/Scope**: ~14 screens, 8 scenes, ~113 s

## Constitution Check

| Principle | Check |
|---|---|
| I Engine decides | Pass — every figure comes from the real engines; captions quote only what the screen shows. |
| II Money model | Pass — unchanged; no figure re-derived. |
| III Agent List | Pass — fictional floor; leak check runs. |
| V Locked down | Pass — no product, route or CSP change; the skin exists only inside the demo's own server; nothing live contacted. |
| VII Guard first | Pass — the brand check (no "Chatterbox" text, no Chatterbox logo bytes on the page) and story-state assertions fail the run. |

## Brand system (demo + video)

- Palette: black `#000000` (canvas, sidebar), dark green `#007338` (primary buttons, active nav — white text passes
  contrast), green `#46b649` (accents, progress, highlights), lime `#90c640` (key-word highlight, glows), text
  `#FFFFFF` / `#B9C4BC` on black; the app's status colours (on track / watch / behind) stay semantic.
- Logo: the official file (`tools/demo/brand/throughballs-logo.png`, black wordmark) on light surfaces; a white-wordmark
  copy made from the same file (`throughballs-logo-white.png`) on black; the hex mark alone (`throughballs-mark.png`) for
  small placements. Never redrawn, recoloured greens, stretched or clipped.
- Type: Montserrat (closest to the logo's tagline) if the editor has it, else Inter — one family, 700 headline / 500
  line, eyebrow 600 caps tracked +12%.

## Story screens (capture order)

| # | Role | Screen |
|---|---|---|
| s01 | — | Sign-in screen (ThroughBalls logo) |
| s02 | agent | Today — her tiles against target |
| s03 | agent | Today — the behind-target tile's "what to do" panel |
| s04 | agent | My Progress — rating, drivers "to go", advice cards, "Ask Tumi to help with …" |
| s05 | agent | Help dialog — topic picked, note written, "Send to Tumi" |
| s06 | agent | My Progress — "Your help requests": sent, not opened yet |
| s07 | team leader | Help Center — Nomvula: new, not opened yet |
| s08 | team leader | Help Center — note open, seen |
| s09 | team leader | Help Center — moved to "Waiting on agent" |
| s10 | agent | My Progress — "Did Tumi sort it out? Yes, I was helped / Not yet" |
| s11 | agent | My Progress after "Yes, I was helped" (closed) |
| s12 | team leader | My Team — the team's view (context shot for "multiple views") |

## Scenes and captions (approved text; eyebrow · headline · line)

| Scene | s | Screens | On-screen text |
|---|---|---|---|
| 1 The problem | 15 | type on black → s01 | "Most agents work across multiple systems." · "They know their target. They can see their numbers." · "But what should they do differently **today**?" · (over s01) "That's what AgentOS solves." |
| 2 Personal performance | 16 | s02 | YOUR PERFORMANCE · "Not twenty dashboards. One view." · "Her numbers, against the targets that matter." then chips: "Dialler · CRM · QA · Attendance · Coaching — in one place." |
| 3 Identify the problem | 12 | s02 zoom → tile | SPOT THE GAP · "[the measure shown] is behind target." · "A red number on its own changes nothing." then "So AgentOS goes one step further." |
| 4 Next best action | 16 | s03 → s04 | NEXT BEST ACTION · "Not “improve your numbers.”" → "“Here's what to do next.”" · "Built from your rules, your coaching and her own data." |
| 5 Today's priorities | 12 | s04 cards | TODAY'S PRIORITIES · "The highest-impact actions first." · "No overload. No twenty-point plan." |
| 6 Ask the team leader | 20 | s05 → s06 → s07 → s08 | ASK YOUR TEAM LEADER · "Need help? Ask your team leader — right here." · then "It lands in their Help Center." · "Visible. Time-stamped. Accountable." · "Not lost in a WhatsApp message." |
| 7 Close the loop | 16 | s09 → s10 → s11 | CLOSE THE LOOP · "Done — and confirmed by the agent." · "Every request stays on the record." then the loop: Measure → Identify → Recommend → Act → Confirm → Improve |
| End card | 6 | logo | (white-wordmark logo) · "AgentOS" · "Turn performance data into action." |

≈ 113 s. "[the measure shown]" is filled from s02/s03 after capture (FR-005). s12 is used only if a beat needs it.

## Motion and transitions (current, restrained)

Black canvas with two slow-drifting radial glows (#007338 → transparent, ≤ 30% opacity) and fine grain; screens float
in a dark device frame (16 px radius, 1 px #1E2A22 rim, soft green rim light). Kinetic type: words blur-in with an 60–80
ms stagger, settle by ~700 ms; key word lit in lime. Transitions: blur cross-dissolve between beats; a camera
zoom-through into the behind-target tile (scene 3); a horizontal push with motion blur from agent to team leader
(scene 6, "the request travels"); a lime line-wipe into the loop (scene 7); scale-down-and-glow into the end card.
Mirror the beats of Raylight's official "linear-agent" / "linear-hero" templates (design guide) — no wobble, no bounce.

## Project structure

```text
specs/008-agent-experience-video/   spec · plan · tasks · checklists · review.md
tools/demo-agent-experience.mjs     the one command (floor → VAS digest → backend → story walk → checks)
tools/demo/story.mjs                ThroughBalls skin (served HTML rewrite) + the story walk
tools/demo/brand/                   throughballs-logo.png · throughballs-logo-white.png · throughballs-mark.png
```
