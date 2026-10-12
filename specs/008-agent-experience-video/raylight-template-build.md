# Raylight TEMPLATE build — AgentOS video 1, The Agent Experience (spec 008)

Supersedes the from-scratch brief (raylight-build.md) for HOW to build; the captions, brand and review rules there still
apply. Decided 2026-10-07: the from-scratch build ran ~1 beat/hour, so the video is rebuilt from Raylight's free
**Limelight** template (`T89DiaWb`, design guide topic `limelight`): 7 dark desktop-screenshot scenes (tilted, slow drift,
crossfades), a wordmark scene, a logo scene. Everything below is mostly duplicating its two shot types.

## Phase A — create and upload (no editor tab needed)
1. `start_from_template` template `T89DiaWb`, name `AgentOS — The Agent Experience`. Note the new projectId + editUrl.
2. `upload_media` into THAT projectId: the 17 PNGs listed in the scratchpad file `raylight-008-files.md` (way 3 bulk:
   files → curl PUT each → assetIds).
3. Stop and report the projectId and editUrl — the user opens it before Phase B.

## Phase B — build (tab connected; renders need the tab VISIBLE)
Shot types: **SCREEN** = a Limelight screen scene (one screenshot, tilt reduced to ≤ 18° so the UI stays readable, slow
drift, crossfade cut) + a caption (headline + optional line, Montserrat 700/500, white / #B9C4BC, left-aligned in the
safe area, never covering key UI); **CARD** = the Limelight wordmark scene used as a full-frame text card on black.
Duplicate shots (duplicate_asset / copy_asset_to_shot / add_shot), swap images, copy_motion_style from the template's own
shots. Recolour any template accent to #46b649 / lime #90c640; background stays black. Borrow motion with
`apply_template_motion` only where named.

| # | Type | Media | Headline | Line | ~s |
|---|---|---|---|---|---|
| 1 | CARD (typed on, twitter-app S1 motion) | — | Most agents work across multiple systems. | — | 4 |
| 2 | CARD | — | They know their target. They can see their numbers. | — | 4 |
| 3 | CARD | — | But what should they do differently **today**? (lime "today") | — | 4 |
| 4 | SCREEN | s01 sign-in | That's what AgentOS solves. | — | 4 |
| 5 | SCREEN | s02 Today | Not twenty dashboards. One view. | Her numbers, against the targets that matter. | 7 |
| 6 | SCREEN | s02 Today (slow push) | Dialler · CRM · QA · Attendance · Coaching | All in one place. | 6 |
| 7 | SCREEN | s02 → camera dive onto the "52%" TARGET ACHIEVED tile (fey S1-style push, ease-in-expo) | Target achieved: 52%. | A red number on its own changes nothing. | 7 |
| 8 | CARD | — | So AgentOS goes one step further. | — | 3 |
| 9 | SCREEN | s03 What-to-do panel (push to the panel) | First `Not “improve your numbers.”`, then it swaps to `“Here's what to do next.”` | Built from your operating rules and her own data. | 8 |
| 10 | SCREEN | s14 Tumi's My Team | Her team leader sees the same next step. | — | 5 |
| 11 | SCREEN | s04 priorities (drift across the three advice cards) | The highest-impact actions, first. | Ranked by points available. No twenty-point plan. | 8 |
| 12 | SCREEN | s05 → s06 (crossfade) | Need help? Ask Tumi, right inside AgentOS. | Pick a reason. Say what you need. | 6 |
| 13 | SCREEN | s07 → s08 (horizontal push, "the request travels") | It lands in Tumi's Help Center. | Time-stamped. Visible. Accountable. | 6 |
| 14 | SCREEN | s09 framed on Nomvula's message lines | Not lost in a WhatsApp message. | — | 4 |
| 15 | SCREEN | s10 → s11 → s12 (crossfades) | Tumi marks it done. Nomvula confirms. | Every request stays on the record. | 9 |
| 16 | CARD (word-flow, twitter-app S7 motion) | — | Measure. Identify. Recommend. Act. Confirm. Improve. | — | 6 |
| 17 | Limelight logo scene | throughballs-logo-white.png (whole, proportions locked) | — | — | 3 |
| 18 | Limelight wordmark scene | — | AgentOS | Turn performance data into action. | 5 |

≈ 104 s. Delete any template scene left unused; the template's own sample screenshots and text must not survive.

## Review (Phase B end — tab in front)
As raylight-build.md §5: render_stills at start+700 ms / mid / end−300 ms for every shot, regions on captions and on
each screen's sidebar logo; render_filmstrip on 1–3, 7, 13, 16–18; captions character for character; ThroughBalls logo
whole (white wordmark on black only); no "Chatterbox", no template leftovers, no real names; nothing clipped or
overlapping; total 90–120 s. If renders fail with the background-tab message, stop and say the tab must be in front.
Do not export; do not change share pages.
