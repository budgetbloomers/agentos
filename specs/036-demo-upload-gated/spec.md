# Feature Specification: 036 — the demo starts empty and fills from the Upload Station

**Feature Branch**: `036-demo-upload-gated` (docs only in this repo; the work lands in `budgetbloomers/agentos-demo`)
**Created**: 2026-10-14 | **Status**: Built 2026-10-15 on demo branch `036-upload-gated`; `tools/verify-demo.mjs` 32/32 green
(empty start → upload → every store → digest → TL1 / CM1 / agent sign-ins → old-build wipe); awaiting Nick's deploy
**Input**: Nick, 14 Oct: "edit the demo by there must no data until I upload the files in the upload station, create me
dummy data for the upload station when I upload it must show, edit the upload station to match the current one … dont
bring the code here or anything we just editing" and "take into account once the changes are made everything from the
demo will be removed".

## What the demo is today

`agentos-demo` (live at agentos-demo-livid.vercel.app) is a static build of this repo's apps with a browser-side
backend (`tb-demo.js`): sign-in, the key/value store (IndexedDB) and every `/api/*` route run in the page. A **dataset
generated at build time** is seeded into the browser on first visit (`public/demo-data/*.json`: the whole VAS state,
the agent digest, hubs, help centre, campaign views, the Ops fact store), so every tab shows figures before anyone
uploads anything. The PULSE copy in it was built from the 31 Aug upstream, so its Upload Station is six weeks behind
the real one (no ViciDial slot, no Large files card, no rule checks, old referrals card).

## User Scenarios & Testing

### US1 — Nothing until the files are uploaded (P1)
A prospect signs in to the demo and opens VAS Analytics. Every tab shows its empty state — no agents, no sales, no
talk time, no QA, no lead book — and the Upload Station's file table reads "Nothing uploaded yet". Agent Analytics
tells a visitor that nothing has been published yet. A browser that visited the old demo is wiped on its first load
of the new build, so the baked dataset is gone everywhere, not only for new visitors.

**Acceptance**: fresh profile → sign in → PULSE Month to Date / Daily / Weekly / Lead Management / Variance / Data
show no figures; the Data Trust bar shows every source missing; `/api/kv?key=vas-state` and `agent-digest` are 404 in
the page; a profile holding the previous build's IndexedDB keys ends up with none of them after one load.

### US2 — The dummy files make the data appear (P1)
From the Upload Station the presenter downloads the demo files (one click each, or all at once), drops them on the
station exactly as a real user would, and watches the slots light up, the rule checks run and every tab fill. Within
a few seconds Agent Analytics shows the floor: an agent sees their own page, a team leader their team, a campaign
manager the campaign view.

**Acceptance**: the sample set covers every slot the current station offers — Power BI Active Cases, Attendance, QA
Evaluations, Agent List (VAS + VAS TL + VT sheets), Cancellations (BI Inactive), ViciDial EXPORT_CALL_REPORT (.txt),
Manual Stats (one sheet per day, DD.MM), Lead Management Open Cases, Lead Management Closed Cases, Referrals (CSV).
Each file is detected by the real `detectType` rules from its own headers (renaming is harmless), parses through the
real `INGEST` parsers with no "could not recognise" toast, and the Uploaded files table lists all ten. After the drop
the Month to Date tab shows every reported agent with sales, GWP, talk, attendance and QA; Lead Management shows open
and closed books; the Variance Report has board days; Cancellations and Referrals are non-zero. The digest PULSE
publishes is what Agent Analytics reads: TL1 signs in and sees the first leader's team with totals; CM1 sees the
campaign roll-up computed by the Worker's own campaign engine; the agent named on the sign-in card sees their month.

### US3 — The Upload Station is the current one (P1)
The demo's Upload Station is the station in `nicks_code/index.html` as of this commit: same slots, same copy, same
cards (Large files, Rule checks, Coverage, Unmatched, Matched by spelling), same behaviours — reskinned by the demo's
brand pass only. One extra card at the top, clearly a demo card, offers the sample files and says what to expect.

**Acceptance**: the demo's PULSE is produced by the existing build from the current upstream (not patched by hand);
the slot list in the built page equals the upstream `SLOTS` list; the demo card is added by the runtime, not by
editing PULSE's source.

### Edge cases
- A visitor drops only some files: PULSE's own partial-data behaviours apply (e.g. referrals defer until the Agent
  List is in; the digest publishes whatever the model has). Nothing in the demo pretends otherwise.
- A visitor drops the same file twice: skipped by content hash, as in production.
- Clock: the dataset is the month of the build (October 2026, 1st to the build day). The demo's frozen clock keeps
  the apps on that month after the real calendar moves on, so the files never "age out".
- Large files card: the Rake path (signed URL → storage) has no backend here; the card stays as upstream draws it, and
  a file sent that way is answered with a demo message rather than silently accepted.
- Referrals "Sync now": `/api/referrals` answers no rows; the CSV drop is the demo path.

## Requirements

- **FR-001** The build MUST emit no dataset: no VAS state, digest, hubs, help, campaign views, Ops facts. Only two
  configuration keys remain seeded — KPI form templates (`hub-titles`) and help-pipeline stage names (`help-stages`)
  — because they are form definitions, not data.
- **FR-002** The runtime MUST clear every key of its store when the stored build id differs from the page's, before
  anything reads it.
- **FR-003** The build MUST generate the sample files from the fictional floor (the demo's own roster pairing and
  model) in the real export shapes, into `public/sample-data/`, with a manifest naming each file, its slot and its
  size; and a stored (uncompressed) zip of the set.
- **FR-004** The Upload Station MUST show a demo card listing the files with download links, the suggested order and
  the sign-ins to try afterwards; added by a runtime script that wraps `PAGES.data`.
- **FR-005** Digest writes MUST NOT be frozen: whatever PULSE publishes is what Agent Analytics serves. The frozen-key
  rule is deleted.
- **FR-006** Team-leader and campaign-manager sign-ins MUST be derived from the published digest at sign-in time:
  TL1…n in alphabetical order of leader name, CM1…n in alphabetical order of campaign key. Before a digest exists,
  sign-in says so instead of "no such account".
- **FR-007** The campaign-manager overview MUST be computed in the browser by the Worker's own `cmOverviewBody`
  (`worker/src/campaign.mjs` + `rules.mjs` served as one ES module), with an empty assistance register.
- **FR-008** The Visual Brain tab (a demo invention over baked data) is removed. Nothing else is added to PULSE.
- **FR-009** Nothing real may survive: the leak audit must pass. `src/identity.local.mjs` (gitignored) carries the
  named individuals and stays off the repo.
- **FR-010** The demo repo's README MUST describe the new flow (empty start, sample files, where they come from).

## Out of scope / decisions

- QA Ops (`public/qa/`) is a separate static export of `qa-ops` with its own baked people; untouched here — flagged
  to Nick.
- The Ops command centre starts empty too and keeps its own station; the same files can be dropped there, but that
  is not an acceptance criterion.
- Hubs (KPI, Coaching, Help) start empty; a presenter files records live.
- Deploy is Nick's: `cd public && npx vercel deploy --prod` from the account that owns the project (not in the Aarav
  Vercel team).
