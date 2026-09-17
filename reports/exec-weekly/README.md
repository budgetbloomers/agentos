# Executive Weekly Health Report

The Thursday view of the whole business for EXCO: ten sections, each scored out of 100 from its
own contributing factors, and one overall business score weighted by each section's portion.
It answers the 60-second test from the KB command-centre spec — what works, what is broken, who
owns it, what action is live, where it escalates — and nothing else.

This is **not** `/weekly-report`. That one is the Monday Team Leader NBA brief: one primary NBA
per agent, tenure-relative, for the floor. This one is the business, for the board table. They
share the money model and the roster; they share nothing else.

## Six files, six jobs

| File | Owns |
|---|---|
| `specs/exec_scorecard_rules.json` | **The rule book.** Sections, their weight in the business score, the contributing factors and their weights inside a section, the scale each factor is scored on, the bands, the owners — and the `viz` block, which owns every colour on the page. Every change carries a dated `_changes[]` entry. |
| `tools/build-exec-report.mjs` | **The arithmetic.** Reads the rule book and a week's readings, computes every score, writes the report. Nobody types a score. |
| `tools/exec-pull.mjs` | **The wire to the engines.** Fills the Performance section from the digest the Ops engine already publishes. |
| `tools/exec-coverage.mjs` | **The test.** Probes this repo for every factor's source, answers fully / partially / not at all, and writes the requirements pack. |
| `specs/exec_data_requests.json` | **The sourcing contract.** 25 requests — the header contract for everything the business does not produce yet. |
| `<week>/data.json` | **The week's readings.** One value per factor, each with the basis it was obtained on and the source line that will be printed under it. |

## Running it

```bash
node tools/exec-pull.mjs   reports/exec-weekly/2026-W37   # Performance, from the live engine
node tools/build-exec-report.mjs reports/exec-weekly/2026-W37
```

`exec-pull` is the wire to the real numbers. It reads `kv:nba-digest` — the payload the
deployed Ops engine publishes itself, one row per agent, republished every fifteen minutes —
and writes **seven of the eight Performance factors** into `data.json` with basis `actual`,
along with the campaign table, the team-leader table, the top five and the watchlist. It
aggregates rows the engine computed; it does not compute a performance figure, and it reads
its targets out of the digest's own `thresholds` block rather than keeping a second copy of a
rule. Insurance opt-in is the one it cannot reach — that driver lives in PULSE, not in the Ops
digest — so it leaves whatever the week's file already had, badged.

It needs `supabase.env` at the repo root (the same file the rest of `tools/` uses, deliberately
not in the repo). Without it, pass a saved digest: `--digest nba-digest.json`. `--dry` prints
what it would write and touches nothing.

The build writes three files into the week's folder:

- `index.html` — the report. Branded, print-friendly, no JavaScript; open it, print it or forward it.
- `REPORT.md` — the same figures as text, for the pack and the brain vault.
- `scores.json` — the computed scores, so next week's `data.json` can carry a `previous` block and
  the report prints a movement arrow without anyone recomputing history.

Guard: `node nicks_code/diagnostics/verify-exec-report.mjs` (107 checks). Run it after any change to
the rule book, the builder or the week's data — it fails if the emitted page and the computed
scores ever disagree.

## Sharing it as a PDF

```bash
node tools/build-exec-report.mjs reports/exec-weekly/2026-W37
chromium --headless --no-pdf-header-footer --virtual-time-budget=6000 \
  --print-to-pdf=reports/exec-weekly/2026-W37/Chatterbox-Exec-Weekly-2026-W37.pdf \
  "file://$PWD/reports/exec-weekly/2026-W37/index.html"
```

(On the runner the browser is at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`; add
`--no-sandbox --disable-gpu` there.) A4, ~16 pages, colours preserved — a RAG report printed in
greyscale is just a table, so every fill carries `print-color-adjust:exact`. Cards, breakout tables
and red-issue rows never split across a page break.

**The print layout is a first-class target, not a fallback**, because this page is forwarded and
printed far more often than it is browsed. It is also the one thing the palette validator cannot
check — it checks colour, not geometry. To look at the paper layout without printing, strip the
`@media print{…}` wrapper into a copy and render it at 718px (A4's text column at 96dpi); that is
how the KPI grid was caught running off the right edge at five columns, and why it is four.

## Starting a new week

```bash
cp -r reports/exec-weekly/2026-W37 reports/exec-weekly/2026-W38
```

Then edit `data.json`: update `meta`, replace each `value`, move last week's section scores into
`previous.sections` (read them out of the old `scores.json`), rewrite `summary`, `redIssues` and
each section's `commentary`. Re-run the builder and the guard.

## Reading the charts

- **Meter** (section and factor scores) — the fill carries the band; the track is a lighter step
  of the same ramp so the state reads across the whole bar; the hairline tick is 100, so a score
  is read against its target and not against the end of the bar. The scale runs to 110 because
  over-delivery is capped there.
- **The strip** under the masthead — one block per section, as wide as its share of the business
  score, filled to its own score. It is the answer to "where did 77 come from".
- **Breakout bars** are one hue, always. Their job is magnitude, and colouring a bar by its own
  length double-encodes what the length already says. Identity travels in the **dot** beside the
  name, in the campaign's own hue, which never changes with rank or filter.
- The palette in `viz` was **validated, not eyeballed** (`dataviz/scripts/validate_palette.js`):
  the VAS dark-theme campaign hues fail every check on a white page — too light, all under 3:1 —
  so the rule book carries their light-surface steps. Re-run the validator if you change one.
- No status colour carries meaning alone: every bar is labelled with its band, every mark has a
  hover title, and every value is in the cell beside its mark.

## What data this needs — and how to re-check it

```bash
node tools/exec-coverage.mjs              # the table
node tools/exec-coverage.mjs --section lrc  # one section
node tools/exec-coverage.mjs --write      # regenerates DATA-REQUIREMENTS.md
```

Every factor in the rule book carries a `feed` block — the system, the store, the exact fields,
the grain, the cadence, the owner — and a **probe** the tool runs against this repository. The
probe decides the state; the rule book never declares one, so a factor cannot be called reachable
because somebody typed that it was. Five states:

| State | Meaning |
|---|---|
| **LIVE** | The report reads it today. Proved by running `exec-pull`'s own aggregation, not asserted. |
| **WIRING** | The number exists in the suite — a lake table, an Ops KPI, a published digest field — and nothing carries it into the report yet. No new data contract. |
| **PARTIAL** | The value exists; what it is measured *against* does not. Revenue is exact to the rand and *revenue vs budget* is unscoreable. `feed.needs` names the missing half. |
| **MANUAL** | A human-maintained register is the only possible source. Real, and it ages — print the date it was last touched. |
| **FEED** | Nothing in the business produces it. The fields in the requirements document are the ask. |

`--write` emits three generated files — never hand-edit any of them, and re-run after any rule-book
change:

- `DATA-REQUIREMENTS.md` — part one, what each section needs and whether we have it (fully /
  partially / not at all); part two, the format for everything we do not.
- `DATA-REQUIREMENTS.html` — the same pack, branded, for sending and printing.
- A PDF, via the same chromium command as the report.

The three-state answer collapses the five probe states for someone deciding what to go and collect:
**Fully** = live or wiring (ours to do, nobody outside this repo is asked for anything) · **Partially**
= partial or manual · **Not at all** = feed. Today: 21 factors fully, 12 partially, 25 not at all.

`specs/exec_data_requests.json` holds the 25 requests, each with the exact header contract — shaped
like the dashboard's own `SOURCES` entries, so a delivered file becomes an upload slot with no
translation. **The guard fails if any factor we do not fully have is left without a request**, which
is what stops a gap sitting in the report for ever wearing a placeholder.

## The four rules this report will not bend

1. **Scores are computed, never typed.** CLAUDE.md non-negotiable 1. If a figure in the narrative
   disagrees with the table, the narrative is wrong — fix the sentence, never the number.
2. **An absence is not a nought.** A factor with no feed leaves the denominator and the rest of its
   section renormalise; the page shows the effective weight each one grew to carry. A measured zero
   still scores zero. An absence and a failure must never look the same on this page.
3. **The basis travels with the number**, and it describes the *score*: a real value measured
   against a placeholder target is a simulated score, badged and shaded, with the real figure named
   in its source line. The masthead states what share of the business score rests on measured
   evidence — currently under a quarter, which is the most important sentence in the report.
4. **Contribution, never EBITDA**, until management accounts are tied out. The guard enforces it.

## What would make this report defensible

Four feeds and one decision, in this order:

| Gap | Unlocks | Owner |
|---|---|---|
| Recruitment export (GHL) | the whole Recruitment section, and the other half of attrition | Abigail (P06) |
| Budget + payroll (Xero / Payscale) | Finance — 15% of the business score, currently all modelled | Mekaeel (P03) |
| A legal & risk register (HR OS module or a Blue board) | LRC — contracts, disputes and overdue risks, currently placeholders | Jared (P04) |
| Blue ticket export | Business Analytics — three of its six factors have no feed | Ryan (P08) |
| A named facilities owner | Facilities — 4% of the score is unowned while P18 is vacant | EXCO |

**Performance is not on that list.** Nothing on that tab is missing from the business — it was
missing from the report, because the first issue was typed from committed evidence instead of asked
of the engine. `exec-pull` closes it: run it where the credentials live and Performance goes to
seven of eight factors actual, with every breakout rebuilt from the same rows.

Elsewhere, several *simulated* factors are likewise computable today (nesting productivity, time to
first sale, talk time, connect rate, the R2A tier share, open critical fails). They need wiring into
`exec-pull`, not a new data contract — the cheapest jump in the evidence figure available.
