# Agent View — testing round of 3 Sep 2026: change plan

Source: `Agent OS testing.docx` (workspace root, 3 Sep 14:49). Every item is on the
Agent Analytics **agent** view (`agent/index.html`). The doc references screenshots
that did not survive the export, so each item below states what the code actually
does today, what changes, and whether Nick has to decide anything before we build.

Verification for the whole round: `nicks_code/diagnostics/verify-agent-analytics.mjs`
(89 checks today — several assert the copy and layout being changed, so the suite
is updated alongside), then build (`prepare-site` consistency check), deploy, and
the real-browser smoke. One deploy at the end, not one per item — every deploy
trips the stale-tab banner for every open phone.

---

## A. Today page

### A1. Say up front that it is a projection
**Doc:** "at the beginning, this is a projection of how your month is going thus far."
**Today:** subtitle reads "Here is how your month is going so far — 1–2 September."; the
hero is labelled "On track to earn this month".
**Change:** subtitle → *"A projection of how your month is going so far — from your
1–2 September figures. Today's sales land with tonight's upload."* Hero label →
*"Projected commission this month"*. No maths changes.

### A2. Days worked must not include today
**Doc:** "1st to 2nd is not 3 working days — it needs to say 2 days and not include
today, as today's stats are not included."
**Today:** "days worked" everywhere is `ME.act` = **Actual Shifts from the attendance
register**. When the register for today is uploaded before the day's sales/dialler
files, the page shows 3 days worked against 2 days of figures — and every per-day
figure derived from it (average a day, projection, remaining days) is wrong.
**Change:** cap days-worked at the number of working days from period start to the
**last date that carries sales data** (`D.dates`, the same list the period label
already uses). Rule: *a day counts only once its files have landed.* Applies to
the KPI tiles, the hero, the commission calculator's "days passed", and the pace
meter. PULSE side: publish `daysWithData` explicitly so the page is not inferring it.
**Nick to confirm:** attendance-only days (present, no sales files yet) never count
until the sales file lands — yes?

### A3. "How will an agent make 59 sales over the next 2 days"
**Doc:** the number below the projection is absurd.
**Today:** "Your number for today" shows three "rungs" — *keeps your target*
(sales-to-target ÷ remaining days), *holds your pace*, *moves you up a bracket*.
`remaining days = working days − days worked`; with A2's inflated day count and a
digest that fell back to elapsed days, `remaining` collapses to 2 and the division
explodes. It is arithmetic nobody asked for, presented as a menu.
**Change:** replace the three rungs with **one precise statement**: *"To reach your
September target of 128 sales you need about 6 a day over the 19 working days left
(3–30 Sep)."* — target, sales so far, days left with the dates, per-day. If already
over target: *"Target reached — every sale from here is upside."* Drop "pick your
rung" entirely. The bracket angle moves to the Commission page where it belongs.

### A4. "Pick your rung" — remove
Covered by A3. The `.td-rung*` CSS and the rung builder go.

### A5. Last session zero vs Momentum "last session hit target"
**Doc:** contradictory.
**Root cause (a real bug):** the "Your last session" card takes the **last day row**
regardless of whether the agent worked it; the Momentum streak **skips** days with
no shift or no target. So a zero day with no shift (or today's provisional row) shows
as the last session, while the streak silently counts back to the previous real day.
**Change:** both cards read the same **last worked session** (last row with a shift
and a target). If the newest row is provisional/no-shift it is labelled *"Yesterday's
files are still landing"* and excluded from both. Add a test that the two cards can
never disagree.

### A6. "How you are tracking" must name the period
**Doc:** "cannot just say how you are tracking."
**Change:** every tracking heading carries its scope and dates: *"How you are tracking
— September to date (1–2 Sep)"*; the target line says *"x of y sales for the days
worked so far"*. Same rule applied to the KPI header ("21 working days" → "2 of 21
working days worked").

---

## B. Commission page

### B1. Wording
Heading is already **Projected Commission Calculator** (shipped 2 Sep).
**Change:** nav tab "Commission" → **"Projected Commission"**; subtitle "What you are
earning, and what would change it." → **"What you can potentially earn, and what can
change it."**; hero label "Bracket you are on pace for" stays (it is a projection).

### B2. The editable figures
**Doc:** "why are we giving them options to change figures, when we are stating to
them 'your figures for 1–2 September'?"
**Today:** the figures card has editable Tenure / days passed / days in period / GWP
inputs and a "Reset to my real figures" link (a sandbox; nothing is saved).
**Change:** make the card **read-only** — their real figures, labelled as such. Remove
the four inputs and the reset link. The what-if segmented control ("what if you add
1 more sale a day") is the one lever that is genuinely theirs; **recommend keeping
it**, but it is the same category of "changing figures" — **Nick to decide.**

### B3. Demo of the calculation
**Doc:** "Please demo this entire calculation to me and how does it work."
**Deliverable (not code):** a one-page worked example on a real agent (Enoch, CB70):
premium written ÷ days worked = daily average → × working days in month = projected
GWP → highest bracket whose threshold ≤ projection → commission = projection ×
(bracket comm ÷ bracket threshold), i.e. pro-rata on the bracket's rate → gap to
next bracket measured on premium **banked**, not projected. Plus why the September
table is 21 days (Heritage Day) and how a month keeps its own model. Published as an
artifact / one-pager for Nick before B2 is finalised.

---

## C. Across pages

### C1. Tracking repeated on every page
**Doc:** "why are we repeating the agent's tracking on each page."
**Today:** the "On track to earn" hero renders on **Today**, the same projection is
the **Commission** hero, and My Progress carries the driver rows.
**Change — one home per figure:**
- **Today**: tracking vs target (A3/A6), last session, focus. **No money hero.**
- **Projected Commission**: the only place the rand projection appears.
- **My Progress**: the rating and its seven drivers.
The Today page gets a one-line pointer ("Your projected commission is on the
Projected Commission tab") instead of the duplicate hero.

### C2. Nikola — hidden for agents
**Change:** drop `nik` from the agent nav and view guard (team-leader and campaign-
manager Nikola untouched). The `/api/portal/ask` route stays for those roles.

### C3. "Rewarded" programme — PAUSED (Nick, 3 Sep: "pause on the reward tab")
**Doc:** "And rewarded program to be added. Rewarded."
**Today:** nothing in the repo, specs or KB describes a "Rewarded" programme.
**Blocked on Nick:** what is it (recognition / incentive / prize ladder?), who
qualifies, what data drives it (sales? QA? attendance? referrals?), what an agent
sees, and who administers it. Building a tab without that would be inventing a
scheme. Proposed shape once defined: a `Rewarded` tab in the agent nav + a
Worker-published `rewards` block in the digest.

### C4. Data-assurance alerts off for agents
**Doc:** "Data assurance alerts should be removed for agent view."
**Today:** sidebar "Up to date / Numbers last refreshed … / Coaching is showing an
older copy" card (`freshHTML`), the "Numbers updated …" footer stamp, and the
health-alert banner render for everyone.
**Change:** render none of them when the signed-in role is `agent`. Team leaders and
campaign managers keep them (they act on staleness; agents cannot).

---

### C5. Agents kept seeing LAST month (found 3 Sep while implementing)
**Symptom:** Enoch's Today page read "1 – 31 August" on 3 September, "Numbers updated
03 Sept 14:59".
**Root cause:** PULSE republishes the live `kv:agent-digest` every 90 s from whatever
period the signed-in VAS browser is looking at; its only guard was "the period starts
on the 1st", so a browser reviewing August republished August as the live month.
**Fix (shipped this round):** the live key is written only when the payload's month is
the current SAST month — a past month may refresh its own history key only. The Worker
refuses (409) a live-key payload for any other month, so a tab on an older build cannot
reintroduce it. `digest-republish.mjs --history` re-published every month correctly.

## Status (3 Sep 2026)

Implemented and deployed in this round: A1–A6, B1, B2 (read-only figures, what-if
kept), B3 (worked example: `specs/projected-commission-worked-example.md`), C1, C2,
C4, C5. **Paused on Nick's instruction: C3 Rewarded.**

## Order of work

1. **Bugs and arithmetic first** — A2 (days), A5 (last session vs momentum), A3/A4
   (one precise statement replaces the rungs). These change what agents are told.
2. **Copy** — A1, A6, B1.
3. **Layout** — C1 (one home per figure), C4 (alerts off), C2 (Nikola off).
4. **B2 read-only figures** — after Nick sees the B3 demo and decides on the what-if.
5. **C3 Rewarded** — separate piece of work once Nick defines it.

Each step: update the assertions in `verify-agent-analytics.mjs` (sections C, D and
the Today/calc render checks reference the exact copy being changed), run the
suite, then one build + deploy + smoke for the round.

## Decisions needed from Nick before build

| # | Question | If no answer, we do |
|---|----------|---------------------|
| A2 | Attendance-only days (no sales file yet) never count as worked? | Yes — a day counts when its files land |
| B2 | Keep the "what if you add 1 more sale a day" control? | Keep it; remove the raw inputs |
| C1 | Money hero on Today: remove entirely, or one-line pointer? | One-line pointer |
| C3 | What is the Rewarded programme? | Nothing built until defined |
