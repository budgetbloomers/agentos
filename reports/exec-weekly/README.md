# Executive Weekly Health Report

The Thursday view of the whole business for EXCO: ten sections, each scored out of 100 from its
own contributing factors, and one overall business score weighted by each section's portion.
It answers the 60-second test from the KB command-centre spec — what works, what is broken, who
owns it, what action is live, where it escalates — and nothing else.

This is **not** `/weekly-report`. That one is the Monday Team Leader NBA brief: one primary NBA
per agent, tenure-relative, for the floor. This one is the business, for the board table. They
share the money model and the roster; they share nothing else.

## Three files, three jobs

| File | Owns |
|---|---|
| `specs/exec_scorecard_rules.json` | **The rule book.** Sections, their weight in the business score, the contributing factors and their weights inside a section, the scale each factor is scored on, the bands, the owners. Every change carries a dated `_changes[]` entry. |
| `tools/build-exec-report.mjs` | **The arithmetic.** Reads the rule book and a week's readings, computes every score, writes the report. Nobody types a score. |
| `<week>/data.json` | **The week's readings.** One value per factor, each with the basis it was obtained on and the source line that will be printed under it. |

## Running it

```bash
node tools/build-exec-report.mjs reports/exec-weekly/2026-W37
```

Writes three files into that folder:

- `index.html` — the report. Branded, print-friendly, no JavaScript; open it, print it or forward it.
- `REPORT.md` — the same figures as text, for the pack and the brain vault.
- `scores.json` — the computed scores, so next week's `data.json` can carry a `previous` block and
  the report prints a movement arrow without anyone recomputing history.

Guard: `node nicks_code/diagnostics/verify-exec-report.mjs` (95 checks). Run it after any change to
the rule book, the builder or the week's data — it fails if the emitted page and the computed
scores ever disagree.

## Starting a new week

```bash
cp -r reports/exec-weekly/2026-W37 reports/exec-weekly/2026-W38
```

Then edit `data.json`: update `meta`, replace each `value`, move last week's section scores into
`previous.sections` (read them out of the old `scores.json`), rewrite `summary`, `redIssues` and
each section's `commentary`. Re-run the builder and the guard.

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
| An IR register (HR OS module or a Blue board) | LRC — 7%, currently a placeholder in every row | Jared (P04) |
| Blue ticket export | Business Analytics — three of its six factors have no feed | Ryan (P08) |
| A named facilities owner | Facilities — 4% of the score is unowned while P18 is vacant | EXCO |

Several factors already marked *simulated* are computable from the live engines today
(sales per day, conversion, QA, cancellations, opt-in, rated share, nesting productivity, time to
first sale, talk time, connect rate). They are placeholders only because this first issue was built
from committed evidence rather than a live Worker query. Wiring those is a builder change, not a
new data contract — and it is the cheapest jump in the evidence figure available.
