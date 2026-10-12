# Feature Specification: Raylight product demo video

**Feature Branch**: `007-raylight-product-demo`

**Created**: 2026-10-06

**Status**: Draft

**Input**: User description: "Use Raylight to create me a product demo of the AgentOS system. Do not involve the Wimpy app —
remove that. Make sure the edits are correct: nothing missing, the logo etc., formats are correct. Use Spec Kit and
/ecc:prompt-optimizer." Optimised brief (prompt-optimizer, 2026-10-06): a motion-design demo video built in Raylight from
the fictional-data screenshots of spec 005, with Wimpy excluded from the demo only, the real Chatterbox logo on the intro
and outro, 16:9 at 1920×1080, about 90–120 seconds, on-screen captions, every shot checked on rendered frames before it is
exported.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Demo material that is clean to show (Priority: P1)

The person preparing the demo regenerates the screenshot set and gets screens that show only Chatterbox AgentOS: no
Wimpy ordering card, no Wimpy link, and none of the third-party hub preview images that carry real team-leader names and
another company's logo.

**Why this priority**: the video is built from these screens; a Wimpy card or a real name in the source would end up in
the video. Spec 005's set has both: the VAS Apps page shows a "Wimpy Order" card plus two hub previews with real first
names, and the agent's Links page shows a "Wimpy order" link.

**Independent Test**: regenerate the set with the one command; open the Apps and Links screenshots — no Wimpy, no hub
preview images; the automatic leak check passes.

**Acceptance Scenarios**:

1. **Given** the regenerated set, **When** any screenshot is inspected, **Then** the word "Wimpy" and the Wimpy card or
   link appear nowhere.
2. **Given** the regenerated VAS Apps screenshot, **When** it is inspected, **Then** the KPI Hub and Coaching Hub cards
   show their title, description and button but no preview image.
3. **Given** the live product, **When** a manager opens the real VAS Apps page after this work, **Then** it is unchanged
   (Wimpy card and previews still there) — the exclusions apply to the demo only.

---

### User Story 2 - A demo video that tells the product's story (Priority: P1)

A prospective client watches a short video: the Chatterbox logo opens it, then VAS Analytics (where every figure is
built), then Agent Analytics through the eyes of the team leader, the agent and the campaign manager, then the logo
closes it. Each screen carries a short caption saying what it is for.

**Why this priority**: this is the deliverable the user asked for.

**Independent Test**: play the video end to end; it follows the order above, every caption names what is on screen, and
it runs 90–120 seconds at 16:9.

**Acceptance Scenarios**:

1. **Given** the finished project, **When** it is played, **Then** the order is: logo intro → VAS Analytics → team leader
   → agent → campaign manager → logo outro.
2. **Given** any shot, **When** it is paused mid-hold, **Then** the screen is readable at 1080p and its caption matches
   what is shown.
3. **Given** the team-leader section, **When** it plays, **Then** the coaching document is shown as a sequence: draft
   saved → signed → submitted and locked.

---

### User Story 3 - Checked, exported and ready to share (Priority: P2)

Before the video is exported, every shot is reviewed on real rendered frames for the problems the user named — a missing
or clipped logo, wrong formatting, typos, cropped text — plus real names and Wimpy. The exported video's page carries a
proper title and description and stays private until the user chooses to share it.

**Why this priority**: the user asked explicitly that "the edits are correct, nothing missing, the logo, formats correct".

**Independent Test**: the review log lists every shot with its checked frames and zero open findings; the export's page
shows the title and description and is private.

**Acceptance Scenarios**:

1. **Given** a shot, **When** its rendered frames are reviewed, **Then** the logo (where the shot has one) is whole and
   undistorted, no text is cut off or overlapping, captions are spelled correctly, and no real name or Wimpy appears.
2. **Given** the exported video, **When** its share page is opened by the owner, **Then** it shows the agreed title and
   description and its visibility is private.

### Edge Cases

- The Raylight editor tab is not open or not connected: work stops and the user is given the exact project link to open.
- A rendered frame shows half-loaded media: that time is rendered again before any judgement is made.
- A screenshot is taller than 16:9 (full-page captures): it is cropped to the part that matters or panned, never squashed;
  the crop never cuts through a line of text or the in-app logo.
- More files than one upload call accepts: they go up in batches.
- The free Raylight plan stamps "Made in Raylight" on the share page: accepted (removing it needs a paid plan); the video
  itself carries no third-party logo.
- A caption would cover important figures: the caption moves or the screenshot is reframed; captions never sit on data.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The Wimpy app MUST appear in no demo screenshot and no video frame — no card, no link, no caption, no name.
- **FR-002**: The live product, including the VAS Apps page and the live Wimpy app, MUST NOT change; exclusions apply only
  inside the demo run.
- **FR-003**: The KPI Hub and Coaching Hub preview images MUST NOT appear in any demo screenshot or video frame.
- **FR-004**: All demo data MUST stay fictional; spec 005's leak check (no real Agent List name or CB number) MUST pass on
  the regenerated set.
- **FR-005**: The video MUST follow the order: logo intro → VAS Analytics → Agent Analytics team leader → agent →
  campaign manager → logo outro.
- **FR-006**: The intro and outro MUST show the real Chatterbox logo, whole, with its proportions kept and no part clipped
  by the frame edge or covered.
- **FR-007**: The video MUST be 16:9 at 1920×1080 and run 90–120 seconds.
- **FR-008**: Every screen shot MUST carry a short caption (a title of at most six words, an optional line of at most
  twelve), in one font family across the video, spelled correctly, using the product names exactly: "Chatterbox
  AgentOS", "VAS Analytics", "Agent Analytics".
- **FR-009**: Screenshots MUST be shown undistorted; any crop MUST keep whole lines of text and the in-app logo when the
  crop includes the sidebar.
- **FR-010**: Every shot MUST be reviewed on rendered frames (after entrances settle, mid-hold, before the cut) before
  export, and every finding fixed and re-rendered.
- **FR-011**: The exported video's share page MUST carry the title "Chatterbox AgentOS — Product Demo" and a one-line
  description, and MUST stay private unless the user asks for it to be public.
- **FR-012**: The screenshot set MUST stay reproducible by the existing one command.

### Key Entities

- **Demo screenshot**: one numbered fictional-data screen from the regenerated set (app, role, screen name).
- **Shot**: one segment of the video — its screenshot or logo, caption, duration and motion.
- **Review finding**: a problem seen on a rendered frame — shot, time, kind (logo, typo, crop, overlap, name, Wimpy,
  loading), and whether it is fixed.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 0 screenshots and 0 reviewed frames show Wimpy.
- **SC-002**: 0 real names or CB numbers in the regenerated set (leak check), and 0 hub preview images.
- **SC-003**: The logo is whole and unclipped on 100% of reviewed intro and outro frames.
- **SC-004**: Running time 90–120 seconds; frame size 1920×1080.
- **SC-005**: 0 caption spelling errors and 0 open review findings at export.
- **SC-006**: A first-time viewer can name the two apps and the three roles after one viewing.

## Assumptions

- "Remove Wimpy" means remove it from the demo; the Wimpy app stays live for the floor.
- Source material is spec 005's fictional floor (September 2026, viewed on 29 Sep 09:30 SAST), regenerated after the two
  demo-only exclusions; the shot list is a curated subset (~20 screens) of its 59 screenshots, not all of them.
- On-screen captions, no voiceover; a quiet music bed is added only if the editor's own library provides one.
- The video is built in the user's own Raylight account (free plan) in a project they can watch live; the user presses
  Export in the editor (no tool exports), after which the share page is set up.
- The Ops app, Tracker, Wimpy and the third-party KPI/Coaching Hubs are out of scope.
