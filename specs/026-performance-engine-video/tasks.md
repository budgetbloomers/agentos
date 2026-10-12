---

description: "Task list — 026 AgentOS video 2, The Performance & Coaching Engine"
---

# Tasks: AgentOS video 2 — The Performance & Coaching Engine

- [x] T001 [US1] floor v2 profile for Megan Fourie (opt-in); backend NBA stand-in with the Ops ladder wording (opt-in)
- [x] T002 [US2] tools/demo/voice.py — Kokoro bm_george narration per scene; lengths
- [x] T003 [US1] video.mjs: v2 title + end cards; muxAudio()
- [x] T004 [US1] tools/demo-performance-video.mjs — clips 00–08 timed to narration; checks; staging + publish —
  2026-10-11: 9 clips, 141.6 s, all clean (Megan conversion 5.4% → R7). Fixed on the way: the drill-in is a panel (no
  My Progress switch), "her performance has slipped" was false (she is at ~102% of target) → reworded, drafts list reload
- [x] T005 [US3] 28 review frames + coaching-flow frames viewed (form filled, both signatures, submitted); every
  narration ends inside its clip (checked per clip)
- [x] T006 [US2] preview with voice: 137.3 s (xfade + acrossfade)
- [x] T007 Raylight assembly + review — 2026-10-11, project "AgentOS Video 2 " (691b5505): 9 full-frame shots
  (scale 0.5655), 141.7 s, fades through black (700 ms around the cards, 450 ms elsewhere). Raylight does NOT play a
  video layer's own audio track, so the 9 narration WAVs are separate sound blocks at shot start + 500 ms (add_sound/
  move_sound `atMs` is where the sound's PEAK lands → atMs = start + peakOffsetMs). Stills (9), joins and the
  full-length waveform checked
- [ ] T008 code review (ecc:code-reviewer)
