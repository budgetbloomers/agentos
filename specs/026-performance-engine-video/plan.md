# Implementation Plan: AgentOS video 2 — The Performance & Coaching Engine

**Branch**: `026-performance-engine-video` | **Date**: 2026-10-11 | **Spec**: [spec.md](spec.md)

## Summary

Reuse spec 009's kit unchanged (ThroughBalls skin by rule, screencast recorder, pointer/caption overlay, title cards,
checks, staging + publish). Add: (1) `buildFloor({ story: 'v2' })` — Megan Fourie's video-2 profile; (2) the demo NBA
stand-in follows the Ops ladder with its exact wording (P2, R1, R5, R6, R7, R10) when `story: 'v2'`, reading conversion
computed from the floor (sales ÷ closed leads); (3) `tools/demo/voice.py` — Kokoro `bm_george` narration per scene
(WAV + length); (4) `tools/demo-performance-video.mjs` — records each scene's clip, holding until its narration has
finished (+0.8 s), then muxes the narration into the clip (starts 0.5 s in); (5) preview = xfade video + narration
placed at each clip's start. Raylight assembles the 9 clips (audio included) as for video 1.

## Constitution Check

I–III, V, VII as spec 009: every figure from the real engines; the NBA payload is the demo's stand-in (as in 005/009),
now worded exactly as the Ops ladder; nothing live touched; the run fails on any check.

## Clips, narration and captions

| Clip | Screens (actions) | Narration (spoken) | Captions |
|---|---|---|---|
| 00 card | title card | "Now let's look at AgentOS from the manager's perspective. A team leader might manage ten, fifteen or twenty people. A campaign manager may be responsible for hundreds. The problem isn't a lack of information. It's knowing who needs attention, why, and what should happen next." | card lines |
| 01 TL | My Team: team target, agents needing help, who needs help (NBA per agent, status), Help Center badge; Team Results | "AgentOS continuously evaluates performance and surfaces the exceptions. Instead of reviewing every agent by hand, the team leader sees at once where intervention is needed, what is already in progress, and who has asked for help." | "Exceptions, not everyone." / "Who needs help — and what's already in progress." |
| 02 TL→agent | Megan's card → Open Megan (drill-in): tiles, sessions trend, coaching history | "Let's take Megan. Her performance has slipped. AgentOS shows the problem in context. Is it activity? Conversion? Quality? Attendance? Or a combination?" | "Let's take Megan." / "Her month, in context." |
| 03 agent | My Progress drivers (talk time, attendance at target; conversion to go) → back to her card: R7 | "This is where coaching changes. Rather than coaching on opinion, AgentOS uses the evidence. Megan's talk time and attendance are healthy. But her conversion is below target. So the problem isn't activity. It's what happens inside the conversation." | "Activity is healthy." / "Conversion is not." · "Critical Conversion Failure" / "Below the 10% target." |
| 04 TL | the card's "Do this" + status → In progress | "AgentOS then recommends the intervention, from the company's own operating rules. The team leader still makes the decision. AgentOS assists the manager. It does not remove accountability." | "The next step, from your own rules." / "The team leader decides." |
| 05 TL | Coaching Hub → formal coaching for Megan: filled, signed, submitted → locked line; recurring themes | "The coaching is recorded and tracked: what was found, what was agreed, and who signed it. And if the same issue keeps coming back, AgentOS flags it. A measurable coaching system, not a coaching log." | "Recorded. Signed. Tracked." / "A coaching system, not a coaching log." |
| 06 TL | Help Center: requests with asked and seen times, help record, workshop radar | "The same applies when an agent asks for help. AgentOS records when the request was asked, when it was seen, and when it was closed. So leadership can measure what is normally invisible: how well managers support their people." | "Every request, time-stamped." / "Asked, seen, closed." |
| 07 CM | Campaign → Team Leaders → Reports | "Campaign managers can then compare teams, team leaders and issues across the whole campaign. Instead of asking what happened yesterday, they can focus on what needs action today." | "Compare every team." / "What needs action today?" |
| 08 card | end card | "AgentOS Performance Engine. Data, diagnosis, coaching, accountability, improvement." | end card |

## Project structure

```text
tools/demo/floor.mjs            buildFloor({ story }) — Megan's v2 profile (opt-in)
tools/demo/backend.mjs          createBackend({ …, story, conv }) — Ops-ladder wording when story 'v2'
tools/demo/voice.py             Kokoro narration → WAV per line
tools/demo/video.mjs            + titleCard('v2-problem' | 'v2-end'), muxAudio()
tools/demo-performance-video.mjs the one command → Downloads\AgentOS Video 2 - Performance Engine
```
