# Feature Specification: AgentOS video 1, redone — Agent Analytics walkthrough

**Feature Branch**: `009-agent-analytics-walkthrough`

**Created**: 2026-10-07

**Status**: Draft

**Input**: User description: "This video is completely wrong — it is supposed to show the Agent Analytics in detail, with
the green UI/UX, and apply the script. Please redo it. Use Spec Kit." Decided with the user 2026-10-07: cover the agent
view, the team leader view and the campaign manager view; show the app LIVE (recordings of it being used) with Raylight
assembling the film; the app wears the ThroughBalls brand colours from the brand kit the user supplied ("I want it
ThroughBalls brand colours — you have the palette"). The script is "VIDEO 1 — THE AGENT EXPERIENCE" (scenes 1–7 + end
card "AgentOS — Turn performance data into action."). Supersedes spec 008's still-screen approach; 008's fictional
story, brand assets and approved caption wording are reused.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Agent Analytics in the ThroughBalls brand (Priority: P1)

Anyone watching sees Agent Analytics as a ThroughBalls product: the ThroughBalls logo, black for the frame and menu, the
brand greens (#46b649, #90c640, #007338) for every accent, highlight, button and chart, and the brand kit's neutral
greys and whites for surfaces — in all three views (agent, team leader, campaign manager).

**Why this priority**: the user rejected the previous attempt partly because the app did not look like this.

**Independent Test**: open each view of the three roles in the demo; every screen uses only the brand palette plus
neutral greys/whites, no blue, navy, violet or sky tint remains, no Chatterbox name or logo appears, and figures stay
easy to read.

**Acceptance Scenarios**:

1. **Given** any Agent Analytics screen in the demo, **When** it is viewed, **Then** it shows the ThroughBalls logo, a
   black menu with the selected item marked in brand green, green buttons and accents, and neutral grey/white surfaces.
2. **Given** a status that carries meaning (behind target, needs watching), **When** it is shown, **Then** it keeps its
   warning colour so the meaning is not lost.
3. **Given** the live product, **When** anyone uses Agent Analytics after this work, **Then** it is unchanged.

---

### User Story 2 - The script, performed live in the app (Priority: P1)

A viewer watches the real app being used: an agent who is behind target opens her day, taps the measure that is behind,
reads what to do next, sees her priorities, asks her team leader for help and types her note; the team leader sees it,
opens it and resolves it; the agent confirms she was helped. The script's lines appear as captions over the action.

**Why this priority**: "apply the script" — the story is the reason for the video.

**Independent Test**: play the recorded clips in order with the sound off; every script scene is visible as real use of
the app (pointer, clicks, scrolling, typing), and each caption matches what is on screen.

**Acceptance Scenarios**:

1. **Given** the clips, **When** they play in order, **Then** they follow the script: the problem → personal performance
   → the measure behind target → next best action → today's priorities → ask the team leader → close the loop.
2. **Given** the help request, **When** it is shown, **Then** it is created, opened, moved to waiting on the agent and
   confirmed by the product itself — not drawn on.
3. **Given** any caption, **When** it is on screen, **Then** it is spelled exactly as approved and claims nothing the
   screen does not show.

---

### User Story 3 - The team leader's and campaign manager's views in detail (Priority: P1)

After the agent's story, the viewer is walked through what the team leader and the campaign manager see: the team
leader's team with who needs help and the next step for each person, the Help Center, team results and reports; the
campaign manager's campaign overview, teams and reports.

**Why this priority**: the user asked for the agent, team leader and campaign views.

**Independent Test**: the team leader and campaign manager sections each show at least three of their views in use,
with a caption naming what each view is for.

**Acceptance Scenarios**:

1. **Given** the team leader section, **When** it plays, **Then** it shows My Team (who needs help and the next step),
   the Help Center, Team Results and a report.
2. **Given** the campaign manager section, **When** it plays, **Then** it shows the campaign overview, the teams and a
   report.

---

### User Story 4 - One finished film, checked and ready (Priority: P2)

The clips are assembled into one film with an opening, smooth modern transitions and the ThroughBalls end card
"AgentOS — Turn performance data into action."; it is checked frame by frame and exported privately.

**Why this priority**: the deliverable must be correct before anyone sees it again.

**Independent Test**: the review log lists every clip and the assembled film with zero open findings; the exported
video's page is private and titled.

**Acceptance Scenarios**:

1. **Given** the assembled film, **When** it is reviewed, **Then** every caption is exact, the logo is whole and
   readable, nothing is clipped, no Chatterbox branding or real name appears, and it runs 150–210 seconds.

### Edge Cases

- A status that is red/amber for a reason (behind target, watch) keeps that colour; only decorative blues, navies,
  violets and sky tints become brand colours.
- Emoji icons in the menus cannot be recoloured: they are shown in a single neutral tone so they read as simple icons.
- The ThroughBalls logo's black "THROUGH" disappears on black: the white-wordmark copy is used on the black menu.
- White text on the lighter greens is hard to read: text sitting on a filled colour uses dark green #007338; the lighter
  greens are accents only.
- Typing and clicking in a recording must never land on a different element than intended: each step is checked before
  the next.
- A recording that drops frames or shows a loading state is recorded again.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The demo MUST show Agent Analytics in the ThroughBalls brand palette only — black #000000, green #46b649,
  lime #90c640, dark green #007338 — plus the brand kit's neutral greys and whites; no blue, navy, violet or sky tint.
  The ThroughBalls logo replaces the Chatterbox logo; the selected menu item is marked in brand green.
- **FR-002**: Status colours that carry meaning (behind target, needs watching, alerts) MUST keep their meaning.
- **FR-003**: The live product MUST NOT change; the look exists only inside the demo.
- **FR-004**: No screen, clip or frame may show "Chatterbox", the Chatterbox logo, or a real person's name; all data is
  the fictional floor.
- **FR-005**: The app MUST be shown live — recorded while it is used, with a visible pointer, visible click feedback,
  real scrolling and typing — at 1920×1080.
- **FR-006**: The agent story MUST follow the script's seven scenes in order, performed through the product's own
  buttons, including the help request's full life (sent → opened → waiting on the agent → confirmed).
- **FR-007**: The team leader section MUST show My Team, the Help Center, Team Results and at least one report; the
  campaign manager section MUST show the campaign overview, the teams and at least one report.
- **FR-008**: Captions MUST use the approved wording from spec 008 for the script scenes (headline + optional line, no
  scene labels), plus a short caption per team leader and campaign manager view; one type family; spelled exactly.
- **FR-009**: The script's text-only moments (the opening problem, the closed loop) MUST appear as animated title
  cards in the brand.
- **FR-010**: The final film MUST be assembled in Raylight with an opening, modern transitions between clips and the
  ThroughBalls end card; 16:9, 1920×1080, 150–210 seconds.
- **FR-011**: Every clip and the assembled film MUST be checked frame by frame before export; every finding fixed.
- **FR-012**: Clips MUST be reproducible by one command; spec 005's and 008's outputs MUST NOT be disturbed.
- **FR-013**: The exported video's page MUST be titled "AgentOS: Know Exactly What to Do Next" and stay private unless
  the user says otherwise.

### Key Entities

- **Clip**: one recorded segment — order, role, the views it shows, its captions, its length.
- **Title card**: an animated text-only segment — its lines and timing.
- **Caption**: headline + optional line, start and end time within a clip.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of the script's scenes and the end card appear, in order, performed live in the app.
- **SC-002**: The team leader and campaign manager sections show at least 4 and 3 views respectively.
- **SC-003**: 0 frames show off-palette decoration (blue/navy/violet/sky), Chatterbox branding, a real name or a
  misspelling.
- **SC-004**: The film runs 150–210 seconds at 1920×1080.
- **SC-005**: A first-time viewer can name the three views and the agent's next step after one viewing.

## Assumptions

- Story people are fictional (spec 005 floor): agent Nomvula Dube, team leader Tumi Khoza, campaign manager Imogen
  Botha; September 2026 viewed on 29 September.
- Captions, not voiceover; a quiet music bed only if Raylight's library provides one.
- The script's 90–120 s target covered the agent story; adding the team leader and campaign manager tours extends the
  film to about 2.5–3.5 minutes.
- Raylight assembles recorded clips (it accepts video); the clips themselves carry the app, the pointer and the
  captions, so the Raylight work is mostly sequencing, transitions, the opening and the end card.
- The Raylight editor tab must be visible on screen for the final visual review.
- An Outlook screenshot sent mid-discussion was not the palette; the user confirmed the ThroughBalls brand colours.
