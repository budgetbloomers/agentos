# Source-of-truth audit — 15 September 2026

**Nick:** "I need the latest data to be showing, and I need problems like this not to come up again,
especially with the agent list which is the source of truth, and I need the correct data to be showing on
all of the reports, specifically for VAS, because if VAS is correct Agent Analytics will be correct.
Find what is missing, what's broken and what you would change."

Method: the independent recomputation suites over the live data (VAS MTD against the workbook, every
tab, every control, every rated agent's card, the composite recompute), a trace of the Agent List from
the archive → the publish → the record → PULSE → the digest, and a read of how PULSE saves shared state.
Every number below is from today's live stores.

---

## 1 · What is broken today (in order of damage)

### 1.1 A leaver's month vanishes from every VAS report (FIXED 15 Sep PM — Nick agreed; rule `departures`, migration-041, verify-departures 26/26)
The 14 Sep list removed 17 agents. By the rule you set on 27 Aug ("the list wins its whole month") the
roster no longer knows them, so their **September facts still in the store are credited to nobody**:

| The 17 removed agents' September | now credited to |
|---|---|
| 49 sales, R4,311 GWP, across 10 days | nobody (owner unresolved) |
| 205.8 hours of dialler talk | "dialler logins the Agent List does not know" |

That is the Month to Date notice now reading "254 h of talk belongs to 32 logins the list does not know"
— most of it is these leavers. Every leader's MTD, every campaign total, the Dashboard sales count and the
TL Reports lost those 49 sales the moment the list published. The 28 Aug memory warned of exactly this
("keep leavers on the list until month end"); the floor's list does not work that way, and should not
have to.

**What I would change:** a leaver keeps their attribution up to the day they left. `S.orgHist` already
holds each person's history (all 17 are in it, with leader and campaign); the engine fails only because
the identity index (`IDX.byName`/`byCode`) is built from the *current* roster. Build it from the roster
**plus every code in orgHist whose last segment falls inside the period**; those agents carry a `left`
date (the first list that no longer names them); their shifts and dialling days stop on that date; MTD,
TL and campaign tables show them with a "left 14 Sep" marker. Movers keep the month-grain rule; only
departures become day-grain. A rule-book change (non-negotiable 11) with a dated `_changes[]` entry.

### 1.2 The shared state can be overwritten by any open tab (FIXED 15 Sep PM — `X-Cbx-Base` + `mergeStates` replay)
PULSE saves `vas-state` as one blob with a timestamp tie-break and **no compare-and-set**. Ops got
compare-and-set on 14 Sep (`X-Cbx-Base`, reload-and-replay) after the lost-update race that erased
ViciDial days; PULSE never did. Today a colleague's tab on an older build saved a stale 131-agent roster
over a record of 129 three times in an hour, and once re-published it as a *new* list, creating and
deleting two leavers' logins within four seconds. I closed the two doors open today (an adopted record can
no longer publish itself; the roster is reconciled to the record on every poll), but the blob race remains
for every other store in `vas-state` (sales, calls, attendance, evals).

**What I would change:** PULSE's `__cloudPush` sends `X-Cbx-Base` and on a 409 reloads, replays its own
delta and saves again — the machinery Ops already has; the Worker side exists.

### 1.3 The Agent List was refused for five days and nobody knew (FIXED today)
Uploads on 10, 11, 12 and 14 Sep were all refused (the legacy "May" tab spelt CB156 differently; the
duplicate rule rejected the whole list); the only sign was a 20-second toast. Fixed: legacy sheets are
dropped by rule (migration-039); a refusal is recorded and raised as a critical alert in both apps
(`agent-list-not-published`); PULSE keeps a red banner until a list is accepted.

### 1.4 The leaders were a hand-kept JSON file (FIXED today)
The workbook's "VAS TL" sheet is now the record: CB, campaign, sales manager; logins are created from
it, kept with zero agents, forgotten when a sheet stops naming them (migration-040). Open: **Charlotte
Govender** leads 19 VT agents and has no CB anywhere in the workbook.

### 1.5 The lead book silently froze (FIXED today)
Salesforce moved the pool into "Courtesy call- Panimax"; the owner rule was a name list; the book grew to
46 MB and timed out; the tab kept an old book. Fixed by a shape rule and a size sentinel (migration-038).

### 1.6 Two classifiers, two answers (FIXED 15 Sep PM — the publish answer carries the record's roster, leaders and leavers, and PULSE adopts it; the browser's classification lives for the seconds before the answer)
PULSE still classifies the roster in the browser as a "preview" while the server derives the record;
today they disagreed (131 vs 129) and the preview was what people saw. The reconciliation now forces the
record's code set, but PULSE keeps its own campaign folding, legacy-sheet ranking and leader detection.
**What I would change:** PULSE stops classifying; on upload it posts the raw rows and renders only what
the server returns. One classifier, one answer — what migration-020 stated and never finished.

---

## 2 · What is missing

| Gap | Consequence | What I would add |
|---|---|---|
| The daily drop is still a person (never-stale Phase 3 unbuilt) | every source waits for Ashton; a missed morning is a stale day nobody is told about until the cadence grace lapses | pull ViciDial, Salesforce and BI on a schedule with service credentials; until then an "expected by HH:MM, owner" strip on each Upload Station slot, red when overdue |
| No plausibility check on a publish | a list that drops 17 people or a whole campaign publishes with no second look; the only guard is the 25% cap | a publish that removes more than N people or a campaign still succeeds but raises a named "review" note in both apps listing who left |
| Verification runs at 22:09 | a figure wrong at 08:00 is proven wrong at 22:33 | the cheap proofs (integrity, freshness, lead-book size, digest reach) on the 15-minute tick; browser suites stay nightly |
| No disk or vacuum watch | the Supabase disk filled today; the September open-cases partition had never been autovacuumed; Postgres restarted for three minutes | weekly `VACUUM (ANALYZE)` on current partitions via pg_cron; a health row for database and WAL size |
| The integrity view only compares the record with itself | green for five days on a stale list | fixed for the Agent List (archive vs record); the same comparison should exist for every source |
| Dialler logins on no list are reported, never resolved | 32 logins, 254 h this month; the top six are the 14 Sep leavers | 1.1 fixes the leavers; the rest (CB232, CB333, CB335–339, CB374/379…) belong on the Agent List slot itself, not buried on MTD |

---

## 3 · What is correct (proven today)

VAS Month to Date recomputes against the workbook (16/16); every tab renders over live data (50/50);
every control changes something (89/89); every rated agent's card matches the engine (920 checks); the
composite recompute from raw rows (4,244 checks); performance score, Saturday rule and engine rules (10/33/42);
rule-book drift none. The record is your 15 Sep file:
129 agents, Courtesy 41 / Cuddle 28 / VT 60; ten leaders with logins and hub links; campaigns follow the
list. Every Upload Station slot shows its newest archived file.

---

## 4 · Order of work — status at 15 Sep, 16:40 SAST

1. ~~Leavers keep their days (1.1)~~ **built** — Nick: "I agree with your plan".
2. ~~Compare-and-set for PULSE saves (1.2)~~ **built**.
3. ~~One classifier (1.6)~~ **built** (publish answer adopted).
4. ~~The "expected by" strip~~ **built** on every source slot, owner from `source_cadence`; the cheap proofs
   (integrity, freshness, refusal, disk) were already on the 10-minute cron — the strip is what was missing.
5. ~~Vacuum cron + disk sentinel~~ **built** (migration-041 `vacuum-lake-weekly`, `db_health` → alert `database-size`).
6. ~~Plausibility note on a publish~~ **built** — ≥ 5 removals or a campaign gone → `agent-list-review` banner for 72 h; never a refusal.
7. Accounts: Nick 15 Sep — "if they not on the agent list they dont need to have an account"; that is how
   `sync_agent_list` already works, so the 26 dialler logins on no list stay a REPORTING note on MTD, not an
   accounts task. Charlotte Govender's CB on the VAS TL sheet is still Nick's.
