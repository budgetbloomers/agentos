---

description: "Task list — 009 AgentOS video 1 redone: Agent Analytics walkthrough"
---

# Tasks: AgentOS video 1, redone — Agent Analytics walkthrough

**Input**: `/specs/009-agent-analytics-walkthrough/` — spec.md, plan.md

**Tests**: the recorder fails on any segment with an error, spinner, unpainted table, Chatterbox branding, Wimpy, a
real name, or an off-palette (blue/violet) colour on screen, and on any story step the product did not reach; review
frames are extracted per caption and viewed; the assembled film is reviewed on Raylight renders (review.md).

## Phase 1: User Story 1 — the ThroughBalls look (P1)

- [x] T001 [US1] tools/demo/checks.mjs: off-palette check (visible computed colours; blue/violet hue, saturation > 0.25)
  — RED first against spec 008's skin: 14/14 screens failed (navy-tinted greys, blue sign-out border, #3e47cc avatar)
- [x] T002 [US1] tools/demo/story.mjs `brandHtml` v2: palette by rule (hex + rgb/rgba), neutral emoji icons, avatars
  via a brand-palette tbAv(); GREEN: first recording run, every caption moment clean on all three roles
- [ ] T003 [US1] view one still per role in the new skin; adjust contrast if any text on colour is hard to read

## Phase 2: User Story 2 — the script, live (P1)

- [x] T004 [US2] tools/demo/video.mjs: screencast recorder (JPEG frames + timestamps → FFmpeg → MP4), pointer overlay
  with eased glide + click ripple, caption card show/hide, typing, smooth scroll — review found the FFmpeg concat route
  HALVED the clips (63 s recorded → 30.8 s encoded; captions drifted onto the wrong screens): now a strict 30 fps
  image2pipe stream from arrival-stamped frames, and every clip's encoded length must match its recording (±0.5 s)
- [x] T005 [US2] title cards: 00 problem, 05 loop, 08 end (logo + "AgentOS" + "Turn performance data into action.") —
  review: the loop row clipped "Measure." / "Improve." at the frame edge → chips resized
- [x] T006 [US2] clip 02 agent · clip 03 team leader · clip 04 agent confirms — story asserted against the backend

## Phase 3: User Story 3 — team leader and campaign manager views (P1)

- [x] T007 [US3] clip 06 team leader tour (My Team, Team Results, Reports) · clip 07 campaign manager tour (Campaign,
  Teams, Reports)

## Phase 4: User Story 4 — one film, checked (P2)

- [x] T008 [US4] tools/demo-agent-video.mjs: the one command → 9 MP4s (00–08) + review frames into
  `Downloads\AgentOS Agent Analytics Video`; leak check; staged, published only when clean
- [x] T009 [US4] view every caption's review frame; fix and re-record until 0 findings — 2026-10-07 final run: 9 clips,
  157.7 s, 37 review frames viewed (each caption + each clip's opening), 0 findings; preview film (local FFmpeg cut with
  the brief's transitions) 153.4 s. Fixed on the way: clips halved by the encoder, card timing lag, loop card clipped,
  toast hidden by the caption, stale caption at a clip start, one-word caption lines (balanced wrapping)
- [~] T010 [US4] Raylight: the clips in order with transitions; review with the tab visible; review.md — 2026-10-07
  BUILT in "Agent Os " (e9e3f3b7): the 3 leftover spec-008 shots removed (verified first), 9 clips uploaded, 9 full-frame
  shots at exact durations, 157.8 s; joins are fades through black (Raylight's API has no shot-overlap/crossfade op —
  set crossfades in the editor if wanted). Visual review NOT yet run: every render failed with the tab in the background
- [ ] T011 [US4] user exports; share page title + description, private
- [x] T012 code review of the new tooling (ecc:code-reviewer) — 0 CRITICAL; fixed: HIGH hex rule corrupted the
  `&#128276;` bell entity (now entity-safe + asserted), HIGH rerun deleted the final clips before re-making them (now
  staged, published only on a clean run); MEDIUM ffmpeg error/EPIPE handling, click after a long smooth scroll (box
  read until stable), frame memory (one frame per 1/30 s slot); LOW Montserrat load check, no black avatars on the
  black menu. Also found by my own review of the preview: the team leader's tour opened on a stale caption → every clip
  now clears captions before recording, and each clip's opening frame is in the review set
