# Raylight assembly brief — AgentOS video 1, redone (spec 009)

The film is already made as 9 recorded clips (1920×1080 H.264, 30 fps) in
`C:\Users\aarav\Downloads\AgentOS Agent Analytics Video\` — the app, the pointer, the clicks, the typing and the
captions are INSIDE the clips. Raylight's job: put them in order, full-frame, with smooth modern transitions, and check
the result. Add NO text layers and NO other media.

## Project
Use project `e9e3f3b7-87a0-4743-b077-5b9d82683682` ("Agent Os ", the project the user created for this video and
keeps open) and pass that projectId on every call. First confirm with get_editor_status that it is the connected tab.
It should hold ONLY the stopped earlier build (spec 008): THREE shots of ≈ 4 s each on black with green glows, whose
text is exactly (1) "Most agents work across multiple systems." (2) "They know their target. They can see their
numbers." (3) "But what should they do differently today?" (possibly split across layers, "today" in lime), plus 17
uploaded PNGs in the library. Verified 2026-10-07: no earlier build process is still running. Remove those three shots
and their layers (leave the media library alone). If the project holds anything else — other shots, other text, other
media placed on the canvas — STOP without deleting anything and describe what you saw. (Project 90e8c1dd "AgentOS — The Agent Experience" is NOT used.)
Touch no other project.

## Clips, in order (upload with upload_media way 3: files → curl PUT with Content-Type video/mp4 → assetIds)
| # | path | bytes | durationMs |
|---|---|---|---|
| 00 | C:\Users\aarav\Downloads\AgentOS Agent Analytics Video\clip00-title-the-problem.mp4 | 3257023 | 14433 |
| 01 | C:\Users\aarav\Downloads\AgentOS Agent Analytics Video\clip01-sign-in.mp4 | 64911 | 5033 |
| 02 | C:\Users\aarav\Downloads\AgentOS Agent Analytics Video\clip02-agent-her-day.mp4 | 7342909 | 58167 |
| 03 | C:\Users\aarav\Downloads\AgentOS Agent Analytics Video\clip03-team-leader-help-center.mp4 | 1347060 | 14767 |
| 04 | C:\Users\aarav\Downloads\AgentOS Agent Analytics Video\clip04-agent-confirms.mp4 | 1868278 | 8300 |
| 05 | C:\Users\aarav\Downloads\AgentOS Agent Analytics Video\clip05-title-the-loop.mp4 | 1545226 | 8233 |
| 06 | C:\Users\aarav\Downloads\AgentOS Agent Analytics Video\clip06-team-leader-view.mp4 | 8505567 | 23433 |
| 07 | C:\Users\aarav\Downloads\AgentOS Agent Analytics Video\clip07-campaign-manager-view.mp4 | 6792199 | 18733 |
| 08 | C:\Users\aarav\Downloads\AgentOS Agent Analytics Video\clip08-end-card.mp4 | 993054 | 6700 |

A local FFmpeg cut with these exact transitions runs 153.4 s — the Raylight timeline should land within ±1 s of it.

## Build
- One shot per clip, in the order above; the video fills the frame exactly (no crop, no letterbox, no scaling up).
- Each shot lasts exactly its clip's duration (set_shot_duration); do not trim or speed up the clips.
- Transitions between shots: a soft 400–500 ms crossfade/blur dissolve; between clip 00 → 01 and 07 → 08 a slightly
  longer (700 ms) fade through black. No wipes, no spins, no zoom bounces. Background black.
- Optionally a very slow push-in (≤ 3%) on the two title cards (clips 00 and 05) only. Never move the camera on the
  app clips — the pointer and captions must stay where they were recorded.
- Optional: a quiet music bed only if search_sounds finds a calm corporate/ambient track; fade it out over the end card.

## Review (renders need the tab VISIBLE on screen)
render_stills at each shot's start + 1 s, middle and end − 1 s; render_filmstrip across every transition (±600 ms).
Check: each clip plays in order; no black gaps or frozen frames at the joins; nothing cropped; no template leftovers;
total length = sum of the clips (≈ 158 s) minus overlaps. If renders fail with the background-tab message, stop and
say the tab must be in front. Do not export; do not change share pages.

## Final message
Timeline length; a table of shots (clip, start, duration, transition in/out); review findings and fixes; anything not
done and why.
