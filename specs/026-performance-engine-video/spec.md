# Feature Specification: AgentOS video 2 — The Performance & Coaching Engine

**Feature Branch**: `026-performance-engine-video`

**Created**: 2026-10-11

**Status**: Draft

**Input**: User description: "Create me another video with a voice agent, exactly like how you did the first one — this is
the second product video. Use Spec Kit and /ecc:prompt-optimizer." Script: VIDEO 2 — THE PERFORMANCE & COACHING ENGINE
("AgentOS: From Managing People to Managing Exceptions", 2–3 min; audience team leaders, campaign managers, operations
directors; core message: managers stop hunting through reports and manage the people and problems that need
intervention). Mid-task: "remember, we take the screenshots from AgentOS based on what the script needs, using
ThroughBalls colours." Decided with the user 2026-10-11: voice = Kokoro British male (offline; the free Microsoft voice
was refused by Microsoft and Higgsfield had 0.68 of ~20 credits needed); short captions stay with the voice.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The manager's day, captured live from AgentOS (Priority: P1)

A viewer sees the real Agent Analytics — in the ThroughBalls palette, over the fictional floor — used the way a team
leader and a campaign manager use it: the team's exceptions, one agent whose performance slipped, the evidence behind
it, the recommended intervention, the coaching recorded and signed, help requests and their response times, and the
campaign manager comparing teams.

**Why this priority**: the script is only believable if every claim is visible in the product.

**Independent Test**: play the clips muted; each script scene is real use of the app (pointer, clicks, typing), in the
ThroughBalls look, with no Chatterbox branding and no real names.

**Acceptance Scenarios**:

1. **Given** the team leader's view, **When** scene 2 plays, **Then** it shows who needs help, the next step per agent,
   what is already in progress, and the assistance requests waiting.
2. **Given** the agent who slipped, **When** scenes 3–4 play, **Then** her healthy activity (talk time, attendance) and her
   below-target conversion are both on screen, and the product's own rule names the constraint.
3. **Given** scene 6, **When** it plays, **Then** a coaching document is recorded, signed and submitted through the product.

---

### User Story 2 - A narrated film (Priority: P1)

The viewer hears a calm, professional voice tell the script's story while the screens play, with short captions so it
also works muted.

**Why this priority**: the user asked for a "voice agent" this time.

**Independent Test**: every scene's narration finishes before its clip ends; no narration plays over the wrong screen;
captions match the narration's point.

**Acceptance Scenarios**:

1. **Given** the film, **When** it plays, **Then** scenes 1–8 and the end card follow the script's order, each narrated.
2. **Given** a narration line, **When** it is compared with its screen, **Then** it claims nothing the screen does not show.

---

### User Story 3 - Checked and ready (Priority: P2)

Every caption frame, clip opening and the audio timing are reviewed before Raylight assembles the film; a local preview
with sound exists immediately.

**Independent Test**: review log with zero open findings; preview plays with voice in sync.

### Edge Cases

- The script's examples (contact rate stable, conversion down; "AI-generated insight") must match the fictional data and
  the product's real rule wording — the demo floor is shaped so the product's own ladder produces that diagnosis; the
  narration says "AgentOS" where the script says "AI" for rule-based recommendations.
- A narration longer than its planned clip: the clip holds until the narration ends — never cut a sentence.
- Videos 005/008/009 outputs must not change.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Same look and rules as spec 009: ThroughBalls palette by rule, no Chatterbox branding, fictional people
  only, live product untouched, one command reproduces every clip.
- **FR-002**: The film MUST follow the script's eight scenes and the end card "AgentOS Performance Engine — Data →
  Diagnosis → Coaching → Accountability → Improvement".
- **FR-003**: Each scene MUST carry narration adapted from the script's voiceover, spoken by the chosen voice, ending
  before its clip ends; captions are short and one family (as video 1).
- **FR-004**: The diagnosis on screen MUST be the product's own rule wording (R7 "Critical Conversion Failure", its
  reason and action) produced from the agent's data — not text typed onto the screen.
- **FR-005**: The team leader view, the agent drill-in, the Coaching Hub, the Help Center and the campaign manager view
  MUST each appear in use.
- **FR-006**: 16:9, 1920×1080, 2–3 minutes; Raylight assembles the clips (with their audio); a local preview with
  voice is produced too.
- **FR-007**: Every clip is checked (errors, spinners, off-palette, Chatterbox, Wimpy, real names, story steps) and every
  caption frame and clip opening is viewed before assembly.

### Key Entities

- **Narration line**: scene, text, audio length.
- **Clip**: scene, screens, captions, length ≥ narration + lead-in.

## Success Criteria *(mandatory)*

- **SC-001**: 8/8 scenes and the end card, in order, each narrated.
- **SC-002**: 0 frames with off-palette colour, Chatterbox branding, a real name or a misspelling.
- **SC-003**: 0 narration lines cut off or playing over the wrong scene.
- **SC-004**: Length 120–180 s at 1920×1080.

## Assumptions

- Story people (fictional, spec 005 floor): team leader Tumi Khoza, agent Megan Fourie (video-2 profile: sales ~92% and
  slipping, healthy talk time and attendance, QA ≥ 90%, conversion ~5% against the 10% target), campaign manager Imogen
  Botha. The video-2 profile is applied only when the demo is run for video 2.
- The NBA payload in the demo is the demo's stand-in for the Ops engine's weekly review; it follows the Ops ladder
  order and uses its exact rule wording (R1/R5/R6/R7/R10, P2).
- Voice: Kokoro "bm_george" (British male), offline; no voice data leaves the machine.
