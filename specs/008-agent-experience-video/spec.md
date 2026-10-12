# Feature Specification: AgentOS video 1 — The Agent Experience

**Feature Branch**: `008-agent-experience-video`

**Created**: 2026-10-06

**Status**: Draft

**Input**: User description: "Redo it with the ThroughBalls brand colours [#46b649, #90c640, #007338, #000000] and logo. This
product video covers Agent Analytics and its multiple views, with appropriate, current transitions, visuals and colour.
Script: VIDEO 1 — THE AGENT EXPERIENCE ('AgentOS: Know Exactly What to Do Next', 90–120 s; core message: AgentOS does not
just show an agent their numbers, it tells them what to do about them; scenes 1–7 + end card 'AgentOS — Turn performance
data into action.'). Rebrand AgentOS in the ThroughBalls colours. Choose good captions. Use Spec Kit and
/ecc:prompt-optimizer; the product demo is built with the Raylight MCP." Decided with the user 2026-10-06: the rebrand is
for the demo and video only; the script is delivered as on-screen text; only real product screens are shown and the
wording is adapted to them; the video is built in the Raylight project "Agent OS", cleared of the stopped 007 build.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The agent's day, captured through the real product (Priority: P1)

The person making the video gets a set of screens, wearing the ThroughBalls brand, that walk one under-target agent's
real journey through Agent Analytics: she signs in, sees her own numbers against her targets, sees which measure is
behind, reads what the product tells her to do next, asks her team leader for help, her team leader sees and resolves
the request, and she confirms she was helped.

**Why this priority**: the video can only show what these screens show; every scene depends on them.

**Independent Test**: run the capture once; the screens exist in story order, each shows the ThroughBalls logo and
colours, none shows the Chatterbox name or logo, and the help request moves from "sent" to "seen" to "resolved" to
"confirmed" because the product moved it.

**Acceptance Scenarios**:

1. **Given** the fictional floor, **When** the capture runs, **Then** it produces, in order: the sign-in screen, the
   agent's month view, the behind-target measure, her advice ("what to do next"), the help request being written, the
   request as sent, the team leader's Help Center with the request, the request opened and marked done, the agent asked
   whether she was helped, and the confirmed, closed request.
2. **Given** any captured screen, **When** it is inspected, **Then** the ThroughBalls logo and palette are shown and the
   words "Chatterbox" / "The Chatterbox" appear nowhere.
3. **Given** the live product, **When** any user opens Agent Analytics after this work, **Then** it is unchanged.

---

### User Story 2 - A 90–120 second video that tells the script's story (Priority: P1)

An operational buyer, a team leader or an agent watches "AgentOS: Know Exactly What to Do Next" and understands, without
sound, that AgentOS turns an agent's numbers into the next thing to do — and closes the loop with the team leader.

**Why this priority**: it is the deliverable.

**Independent Test**: play it muted; the seven scenes and the end card follow the script's order, each caption is
readable and true to the screen beside it, and the closed-loop message (Measure. Identify. Recommend. Act. Confirm.
Improve.) lands before the end card.

**Acceptance Scenarios**:

1. **Given** the finished video, **When** it plays, **Then** the order is: the problem → personal performance → the
   behind-target measure → next best action → today's priorities → ask the team leader → close the loop → end card
   "AgentOS — Turn performance data into action."
2. **Given** any caption, **When** it is compared with the screen it sits on, **Then** it claims nothing the screen does
   not show.
3. **Given** the brand, **When** any frame is inspected, **Then** only the ThroughBalls palette and logo are used for the
   video's own design; the logo is whole, undistorted and readable on its background.

---

### User Story 3 - Checked, exported and ready to share (Priority: P2)

Before export every scene is reviewed on rendered frames; the exported video's page carries the title and a one-line
description and stays private until the user decides.

**Why this priority**: the user asked that the captions are good and the edits correct.

**Independent Test**: the review log lists every scene with zero open findings; the share page shows the title and is
private.

**Acceptance Scenarios**:

1. **Given** a scene, **When** its frames are reviewed, **Then** captions match the approved text character for
   character, nothing is clipped or overlapping, the logo is intact, and no real name or Chatterbox branding appears.
2. **Given** the export, **When** its page is opened, **Then** it is titled "AgentOS: Know Exactly What to Do Next" and
   is private.

### Edge Cases

- The black "THROUGH" of the official logo is invisible on black: dark scenes use a white-wordmark version made from the
  official file, never a redrawn logo.
- The brand-kit page misspells the tagline ("YOUR FOWARD PASS"); the official logo file reads "YOUR FORWARD PASS" — the
  file is the authority and the misspelling never appears.
- White text on the lighter greens is hard to read: text on colour uses the dark green; the light greens are accents.
- A help request already open for the story agent would muddle the loop: the story agent starts with none.
- The Raylight project still holds the stopped 007 build: it is cleared before building; nothing else of the user's is
  touched.
- The editor tab is not connected: work waits and the user is told exactly what to open.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The captured screens MUST show Agent Analytics re-skinned in the ThroughBalls brand (official logo; palette
  #46b649, #90c640, #007338, #000000) for the demo only; the live product MUST NOT change.
- **FR-002**: No captured screen or video frame may show "Chatterbox", "The Chatterbox" or the Chatterbox logo.
- **FR-003**: The story MUST be performed through the product itself — the help request is created, seen, marked done and
  confirmed by the product's own actions, not drawn or typed onto images.
- **FR-004**: All people and figures MUST be fictional (spec 005's floor and leak check).
- **FR-005**: The video MUST follow the script's seven scenes and end card in order, as on-screen text, with wording
  adapted so that every claim is visible on the screen it accompanies.
- **FR-006**: The video MUST be 16:9 at 1920×1080 and run 90–120 seconds.
- **FR-007**: Captions MUST use one type family, at most two weights per caption, at most 12 words per line, spelled
  correctly, and use the product names exactly ("AgentOS", "Agent Analytics").
- **FR-008**: The ThroughBalls logo MUST open or close the video at least once, whole, with proportions kept, readable on
  its background.
- **FR-009**: Screens MUST be shown sharp (captured at twice the display density) and undistorted.
- **FR-010**: Every scene MUST be reviewed on rendered frames before export; every finding fixed and re-rendered.
- **FR-011**: The exported video's page MUST be titled "AgentOS: Know Exactly What to Do Next", carry a one-line
  description, and stay private unless the user asks otherwise.
- **FR-012**: The screen set MUST be reproducible by one command and MUST NOT disturb spec 005's screenshot set.

### Key Entities

- **Story screen**: one captured, branded screen — order, role (agent / team leader), what it shows.
- **Scene**: one script scene — its on-screen text, its screens, its motion, its duration.
- **Help request**: the agent's request — topic, note, sent time, seen-by, stage, the agent's confirmation.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of the script's scenes (7) and the end card appear, in order.
- **SC-002**: 0 frames show Chatterbox branding, a real name or a misspelling.
- **SC-003**: Running time 90–120 seconds at 1920×1080.
- **SC-004**: A muted first-time viewer can state the core message ("it tells the agent what to do next, and the team
  leader closes the loop") after one viewing.
- **SC-005**: The screen set regenerates with one command in under 5 minutes.

## Assumptions

- The story agent is Nomvula Dube (fictional, Courtesy, team leader Tumi Khoza), behind target on sales; the script's
  "conversion" example becomes whichever measure the product shows behind target for her.
- "Next best action" is shown as the product's own advice cards (highest-impact first, up to three); "two actions today"
  becomes "the highest-impact actions first"; the "SLA/timer" becomes the request's sent and seen times; "action
  completion" becomes the team leader marking the request done and the agent confirming she was helped.
- No voiceover; a quiet music bed only if the editor provides one.
- Fonts: the brand kit's typography page was not supplied; a clean geometric sans close to the logo's tagline is used.
- Video-only scope: VAS Analytics, the campaign manager view, Ops, Tracker and Wimpy are out of this video.
