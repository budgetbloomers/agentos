# Raylight build brief — AgentOS video 1, The Agent Experience (spec 008)

Run this in a Claude Code session that HAS the Raylight MCP tools (mcp__raylight__*). Project: **"Agent Os "**
(id `e9e3f3b7-87a0-4743-b077-5b9d82683682`, https://www.raylight.app/editor/e9e3f3b7-87a0-4743-b077-5b9d82683682) —
the NEW project the user created and opened on 2026-10-06 (13:36 UTC) for this video; the earlier "Agent OS"
(cbd1a943…, which held the stopped 007 build) no longer exists in the account. Pass that projectId on every call.
Never touch another project.

## 0. Connect and check it is clean
1. get_editor_status → that project connected and 16:9. If not, give the user the link above and wait.
2. get_project_overview → it should be new: no media placed, at most one empty default shot (reuse it). If it holds
   anything someone else made, STOP and report what you saw — never delete it.

## 1. Media (local files, upload_media way 3: {files:[{mime,bytes,name}]} → curl PUT → {assetIds})
- `agentos/tools/demo/brand/throughballs-logo-white.png` (1600×285, white THROUGH + green BALLS — for black)
- `agentos/tools/demo/brand/throughballs-logo.png` (1600×285, black THROUGH — light surfaces only)
- `agentos/tools/demo/brand/throughballs-mark.png` (494×525, hex mark)
- `C:\Users\aarav\Downloads\AgentOS Agent Experience\s01…s14-*.png` (2880×1800 each = 1440×900 @2×)

## 2. Brand
Canvas black #000000; two slow radial glows #007338 (≤30% opacity) drifting; fine grain. Accent #46b649, highlight lime
#90c640 (one key word per beat), dark green #007338 for any filled shape with text. Text #FFFFFF (headline),
#B9C4BC (line). ONE family: Montserrat (700 headline ~64 px, 500 line ~30 px). NO eyebrow / scene labels (decided by
the user 2026-10-07: Raylight rejects the three-line stack) — each beat is headline + optional line, left-aligned
beside or above the screen, with a set text width so a headline never wraps awkwardly. Keep taste rules on. Screens sit in a dark device frame (radius 16, 1 px #1E2A22 rim, soft green rim
light), never stretched; zoom by camera, never by non-uniform scale. Get get_design_guide topics "linear-agent" and
"linear-hero" first and mirror their beats (entrance timing, camera easing). No wobble, no bounce.

## 3. Scenes — exact text (character for character)

| # | ~s | Media | Headline | Line |
|---|---|---|---|---|
| 1a | 4 | black, type only | Most agents work across multiple systems. | — |
| 1b | 4 | black | They know their target. They can see their numbers. | — |
| 1c | 4 | black | But what should they do differently **today**? (lime "today") | — |
| 1d | 3 | s01 rises in | That's what AgentOS solves. | — |
| 2a | 8 | s02 | Not twenty dashboards. One view. | Her numbers, against the targets that matter. |
| 2b | 7 | s02 (slow push) | Dialler · CRM · QA · Attendance · Coaching | All in one place. |
| 3a | 7 | s02 → camera zoom-through onto the "52% TARGET ACHIEVED" tile | Target achieved: 52%. | A red number on its own changes nothing. |
| 3b | 4 | tile held | So AgentOS goes one step further. | — |
| 4a | 9 | s03 (the What to do panel; zoom to the panel) | First `Not “improve your numbers.”`, then it SWAPS to `“Here's what to do next.”` (no arrow on screen) | Built from your operating rules and her own data. |
| 4b | 5 | s14 (Tumi's My Team, Nomvula's card: "Do this: Daily call review and a pitch refresher this week") | Her team leader sees the same next step. | — |
| 5 | 10 | s04 (advice cards: 17,6 · 10,4 · 4,0 points available; light each card in turn) | The highest-impact actions, first. | Ranked by points available. No twenty-point plan. |
| 6a | 6 | s05 → s06 | Need help? Ask Tumi, right inside AgentOS. | Pick a reason. Say what you need. |
| 6b | 5 | s07 (toast "Sent to Tumi — it is in their Help Center now.") → push to s08 | It lands in Tumi's Help Center. | Time-stamped. Visible. Accountable. |
| 6c | 5 | s09 framed on Nomvula's message lines only | Not lost in a WhatsApp message. | — |
| 7a | 8 | s10 (Tumi moves it to "Waiting on agent"; toast "Moved to Waiting on agent.") → s11 (Nomvula's card: "seen by Tumi Khoza 29 Sept, 09:30", "Did Tumi sort it out?" / Yes, I was helped) → s12 (toast "Thanks — marked as sorted. The record stays saved.") | Tumi marks it done. Nomvula confirms. | Every request stays on the record. |
| 7b | 8 | black; six chips in a loop, lit in sequence, lime line-wipe | Measure. Identify. Recommend. Act. Confirm. Improve. | — |
| End | 6 | black; white-wordmark logo | AgentOS | Turn performance data into action. |

Total ≈ 113 s (90–120 allowed). Words in quotes inside a headline use curly quotes as written.

## 4. Transitions
Blur cross-dissolve between beats; camera zoom-through into the tile (3a) and into the panel (4a); horizontal push with
motion blur from agent to team leader (6b, "the request travels"); lime line-wipe into the loop (7b); scale-down and
glow into the end card. Optional: a quiet music bed only if search_sounds finds one; no voiceover; no SFX unless they
land on cuts (check_sync).

## 5. Review — before telling the user it is done
For EVERY beat: render_stills at start+700 ms, mid-hold, end−300 ms; render_stills with a region on the caption and on
the screen's sidebar logo; get_shot_details lint clean; render_filmstrip on 1a–1d, 3a, 6b, 7b and the end card. Check:
caption text exactly as the table; the ThroughBalls logo whole and readable (white wordmark on black only); no
"Chatterbox"; no real names (the floor is fictional: Nomvula Dube, Tumi Khoza, Thando Zulu, Sizwe Ngcobo, Megan Fourie…
are all invented); nothing clipped or overlapping; media fully loaded; total 90–120 s. Log every finding and fix in
`specs/008-agent-experience-video/review.md`.

## 6. Hand-off
The user presses Export. Then list_videos → update_share_page video: title "AgentOS: Know Exactly What to Do Next",
description "How AgentOS turns an agent's numbers into the next thing to do — and closes the loop with the team
leader.", visibility private (ask before making it public).
