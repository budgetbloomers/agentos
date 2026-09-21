# The Denise pilot — go-live readiness for the agent and team-leader views

**Run 21 September 2026.** Six weeks (3 Aug – 12 Sep 2026), nine agents on Denise
Haripersad's team, every source. 217 checks passed, 11 failed. Every failure is a
finding, deliberately left failing; none is a broken test.

Reproduce with:

```bash
cd nicks_code/diagnostics
node verify-denise-pilot.mjs          # 158/162 — the six joins, duplicates, formulas
node verify-denise-views.mjs          #  59/66  — the agent view and the team-leader view
node trace-denise-record.mjs CB910 2026-08-04   # the walkthrough, one agent one day
```

## What this run could and could not do

This session had **no Supabase credentials and no export drop**, so the pilot could not be
run against production rows. Every fixture is written in the real export's header contract
and dropped through the real `#fileInput` → `detectType` → `INGEST` → `buildModel` path;
every expected figure is recomputed independently in the harness from the fixture rows, so
the app is never asked to check itself. **The pipeline conclusions transfer completely; the
volumes do not.** Confirming what is actually loaded today needs a live read.

## What holds

| Area | Checks | Result |
|---|---|---|
| Agent identity | 16 | Near spelling, transposition, dropped middle name, renamed agent, zero-padded dialler login and a login issued to someone else — every one landed on the right person, and every inference was reported. |
| Team attribution | 11 | The September list did not drag August's 75 sales to Denise. The mover splits 75 / 27 across two leaders in the facts. |
| Campaign | 10 | A campaign new to the rule book is reported under its own label, not swallowed into Courtesy. |
| Interaction | 19 | Talk and calls reconcile to the second against an independent re-read of the tab-separated file; a corrupt negative length is zeroed, not subtracted. |
| Sale and money | 20 | GWP reconciles to the rand — ex-VAT, grossed up by `MTD_VAT`, rounded per account. A cancellation counts once, per case, on the day of the sale. |
| Duplicates | 38 | Re-uploading every file (including the call report appended to itself) moved not one figure. |
| Formulas | 22 | Shifts, targets, VAT, attendance, the Saturday rule and the composite's renormalisation all behave as the rule book says. |
| View scoping | 24 | An agent sees themselves and nobody else. A leader with no team (403) or a renamed team (409) fails loudly rather than to an empty screen. |

## The six findings

### F1 — QA is the only join that does not use the identity spine · **blocks go-live**

Every other source resolves a **name** through the Agent List, with nine rungs of fallback
and a report for every inference. The QA ingest builds the code from the digits of
`Sales Agent CB` and stops — no name fallback, no padding tolerance, no exception register.

`CB-095` is stored as `CB095`; the Agent List says `CB95`; the two never meet, even though
`cbCode()` has stripped exactly that padding everywhere else since three agents and 4h37m
of talk once went missing on it.

Measured: CB95's six weeks of evaluations reached nobody. The agent's own card read
"QA — not measured". Correcting only the spelling of the code moved the composite
**42.9 → 54.1** and the framework scored from **70% → 90%**.

Second half: an evaluation whose code matches nobody is stored anyway and counted nowhere.
`M.unmatched` has a sales source, a cancellations source and a calls source — and **no QA
source**. Eight orphaned evaluations in this pilot appear on no screen at all.

Not proven: whether the production QA export pads its codes. What is proven is that this
join cannot survive it, cannot report it, and every other join can. The source catalogue
already records eighteen QA codes matching no roster sheet (open item OI-06).

**Fix:** route the code through `resolveKey`, fall back to the `Sales Agent` name, and give
QA a row in the exception register.

### F2 — the agent's value check fails because an upload is late · **blocks go-live**

On a day the money file has not reached, the engine correctly falls back to the dialler's
sale dispositions and prices them at a flat `S.gwpPerUnit` = **R89 incl = R77.39 ex**,
below the **R86.08** ex-VAT floor. So *any* provisional day drags the blended average under
the line for every agent whose real average sits at the floor — which on this product mix
is all of them.

Measured: 9 of 9 pilot agents read **FAIL** on Check 1. On the 30 days the money source
covers, every one of them is at **R86.09** and passes. The fact row already carries
`provisional: true`; `checksFor()` does not read it.

**Fix:** exclude provisional days from `aveG`, or show the check as pending until the money
file catches up.

### F3 — one team-leader screen, two team totals · **blocks go-live**

CB918 worked for Sharoma in August and moved to Denise on 1 September. The fact table gets
this right (75 / 27) and `tlAgg` carries the split. The per-agent digest row cannot — it has
one `tl` field — so all 102 sales are filed under the leader who holds him today.

Measured on Denise's screen: campaign roll-up **605** sales, agent rows **680**; target
**997** against **1,122**; employed shifts **272** against **297**. The difference is
exactly the 75 sales made under Sharoma.

And: Sharoma led 75 of the pilot's sales but her team-leader view returns **409 — "No agents
are currently assigned"**, because no agent on today's list names her. Correct as written;
wrong for a month-end review.

**Fix:** carry the period split into the digest, or label the agent row as a period total.

### F4 — a missing target puts an agent at the top of the leaderboard

"Download & Test" is reported correctly, but has no row in `MTD_RULES.salesTargetMatrix`, so
its target falls back to the Agent List's Target cell. Where that cell is blank the target is
**0**, and Target Achievement (w20) and Total GWP (w15) both drop out of the rating as
"not measured" rather than being scored.

Measured: CB917 is rated over **55%** of the framework where everyone else is rated over 90%,
and lands **second on the team leaderboard at 90.9** while selling 2/day.

The "an absence is not a nought" doctrine is right and is doing its job. That is precisely
why this raises nothing on screen — a missing input is indistinguishable from a driver the
agent does not have. F1 has the same shape.

**Fix:** give every campaign the Agent List creates a `salesTargetMatrix` row.

### F5 — a leader's code-shaped dialler login reads as a missing agent · disclose

Denise dialling under her **name** is classified "team leader" — nothing to fix. Denise
dialling under a **code-shaped login** (`CB902TL`, the shape ViciDial issues) reads
"missing from the Agent List", the one bucket that implies someone should act. The code path
needs `S.tlCbs`, which arrives from the Worker's roster payload or a leaders sheet; before
that lands, 50 minutes of a leader's talk is shown as a roster defect that is not one.

### F6 — the shift denominator follows the dialler, not the register · disclose

A day only exists in the model if sales, calls or a tracker row carry it (`allDataDates`).
The HR register alone does not create one. In the pilot, 11 and 12 September sit in the
register and in no fact row, so Employed Shifts read 33 where HR would say 35 — and every
target multiplied out of it **grows as the dialler catches up**. A leader who reads the month
on Monday and again on Wednesday sees a different target for the same period.

This may well be correct as designed. It needs a decision and a line on screen, not a code
change.

## Recommended order

1. Route the QA code through `resolveKey`; give QA a row in the exception register. (F1)
2. Decide what a provisional day does to Check 1. (F2)
3. Label the two team panels, or carry the period split into the digest. (F3)
4. Give every list-created campaign a target row. (F4)
5. Re-run all three suites against a real drop, with credentials, and confirm production volumes.

## Baseline availability

July and August 2026 are a continuous, reconciled baseline for sales, productivity and QA —
July verified to the cent against an independent recompute, August verified agent by agent
against the hand-built workbook (Cuddle GWP R47,370 exactly; 77 agents in the digest).
September is live and ragged by design. That is about nine weeks, of which eight are clean —
inside the 4–8 week ask with a month to spare.

Caveat: this is what the verification suites cover, not a live count.

## Refresh and access gaps

- The daily drop lands by **13:00 SAST** with yesterday's data; no Sunday data. The system
  derives that expectation and flags a source a day late, and again at two.
- The three sources arrive in a fixed order — **HR register, then dialler, then money**. That
  ordering is the root cause of both F2 and F6.
- Anything past ~30 MB never reaches the browser parser; it goes through the Rake to Supabase
  Storage and the lake. Open Cases is ~94 MB / 487,000 rows and is already past that line.
- The lake is deliberately fuller than the browser path. The two are not meant to match.
- ViciDial exports carry lead names, numbers and emails and are excluded from the repository.
  A pilot needs a controlled handling route.
