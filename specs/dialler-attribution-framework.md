# Dialler Attribution Framework v1

*2026-08-16 · Written after the 13 Aug Cuddle blank. Applies to every upload day.*

> Nick: *"the agent list identifies the cuddle agents, then once they are identified they are in
> the vicidial report by CB — there is no cuddle dialler list, it's all in vici."*

That is correct, and it is the rule this framework encodes. The 13 Aug failure was **not** a
missing floor and **not** a broken join. It was a **filtered export**: the pull carried only some
ViciDial user groups, and the Cuddle groups were not among them. Everything below exists so that
this is impossible to ship silently again.

---

## 1. The one rule

**The Agent List is the spine. Everything else joins onto it by CB number.**

- The roster decides **who exists** and **which campaign they are** (Cuddle / Courtesy / Nesting /
  VT). A report never classifies an agent — it only supplies activity for one.
- Every dialler, case, money and QA row resolves to a **CB number** first.
- A row that resolves to nobody is **reported by name**, never spread, never dropped, never guessed.
- The roster changes daily. Re-uploading it must re-resolve everything already loaded — identity is
  computed at model-build time, not frozen at parse time.

There is **one** dialler population per agent, defined by the roster. There is no such thing as a
"Cuddle file". Cuddle agents are ViciDial agents who happen to sit in Cuddle user groups.

## 2. Identity resolution ladder

Applied in order, first hit wins, **unique-or-nothing** throughout:

| # | Key | Notes |
|---|---|---|
| 1 | **CB number**, zero-padding normalised | `CB014` = `CB14` = `CB-14`. ViciDial zero-pads; the roster does not. |
| 2 | **Exact normalised name** | Business-unit suffixes stripped (`Jolene Chetty - Panimax`), embedded CB tokens stripped (`Thulani Mbonambi CB-142`). |
| 3 | **Documented label overrides** | The spec's dialler-label table. |
| 4 | Embedded CB in a free-text label | Last resort only. |

**Two candidates = no match.** A bare surname fits nine agents, so it fits none of them.

**The one standing exception.** Where the report's CB and the roster's name disagree, the
**roster wins and the clash is reported**. ViciDial ships *Kyle Kisten* as `CB138`; the Agent List
gives `CB138` to *Jabu Ntombela*. Matching on the number alone pays 735 of Kyle's calls to Jabu.
This exception is narrow and evidenced — it is not a licence to prefer names generally.

**Where the CB must win.** In the aggregated *Agent Performance Detail* export the `USER NAME` is
abbreviated — `Ashleigh Naidoo` for *Ashleigh Alexandra Naidoo*, `Thalente Xaba` for *Thalente
Celokuhle Xaba*. Measured on the 3–5 Aug file: **18 of 24 rows agree, 5 resolve only by CB
(~63 hours of talk otherwise lost), 1 resolves only by name (Kyle).** Hence the ladder above:
**CB first, name as the override for a documented clash.**

## 3. Which report carries whom

Measured on the 13 Aug package, after resolving every row to the roster:

| Source | Population it actually carried | Coverage |
|---|---|---|
| ViciDial `EXPORT_CALL_REPORT` | Nesting (8 agents, 17.1h) · VT (19 agents, 37.7h) | 2,244 of 2,255 rows attributed (99.5%) |
| CallX `call_records.csv` | Courtesy (37 agents, 78.7h) | 8,103 of 8,230 rows attributed (98.5%) |
| Power BI `Active.xlsx` | Cuddle · Courtesy · Nesting | 682 of 682 rows attributed (100%) |
| Attendance register | Cuddle 25 · Courtesy 39 · VT 21 | 85 agent rows + 42 non-agents (TLs, support) |

**Cuddle: zero dialler rows.** Yet 25 Cuddle agents were marked present and 22 booked R13,266.
They worked and sold with no record of a single call.

## 4. Why — the ViciDial `user_group` column

The export carries `user_group`. The 13 Aug pull contained **only**:

```
917  Hezron_Courtesy_C      (Nesting intake)
789  Ryan_Digital           (Vehicle Tracking)
200  Ryan_Digital_Ref
131  Ryan_Scheduling
266  (blank)
 11  ADMIN
  3  LD_Training
```

The Cuddle groups — **`Renolan_Matrix_WC`** and **`Sharoma_Matrix_WC`**, named for their team
leaders Renolan Pillay and Sharoma Rampersad — are **absent entirely**. They are real ViciDial
groups: they are what the 3–5 Aug Cuddle export contains. So the data exists in ViciDial and the
pull left it out.

**Therefore: the export must be pulled with ALL user groups selected.** A per-group pull is the
defect. `user_group` is the evidence trail — it says what a file covers, so it is what the
coverage gate reads.

## 5. The coverage law

> **Every roster campaign group that has present agents must appear in a dialler source for that
> day. A whole group at zero is a filtered export until proven otherwise — never an idle floor.**

An individual agent at zero is ordinary (leave, training, admin day). **All 26 of a group at zero,
while 25 of them are marked present and 22 booked sales, is a file problem.** That asymmetry is
the signal, and it is mechanically checkable:

```
for each campaign group in the Agent List:
    present   = agents marked present in the attendance register that day
    dialled   = agents with >=1 dialler row that day
    if present >= 1 and dialled == 0  ->  FAIL: export filtered or missing
    if dialled / present < 0.5        ->  WARN: partial coverage
```

Run it with:

```
node nicks_code/diagnostics/audit-upload-day.mjs <uploadFolder> [YYYY-MM-DD]
```

It resolves every source to the roster, prints the attribution table above, lists every identity
that reached nobody, and ends on a per-group PASS/FAIL.

## 6. Failure catalogue

| Symptom | Means | Fix |
|---|---|---|
| A whole campaign group has no dialler rows | Export pulled with a user-group filter | Re-pull with all groups selected |
| A group shows amber `~estimate` talk | Only a period-aggregated export covers them | Pull the day-level `EXPORT_CALL_REPORT` |
| One agent's rows attribute to nobody | Name spelled differently and no CB on the row | Add the exact name to the roster, or use the CB-bearing export |
| Rows attribute to the *wrong* agent | A ViciDial login collides with a roster CB | The roster wins; the clash must be reported |
| An agent dials but is on no roster tab | Missing from the current Campaign-format tabs | Add them — a legacy tab does not load |

**Open items from 13 Aug**, each a real person whose day is invisible:

- **Joeline Muniappen** — 52 CallX calls (1.2h), on the attendance register, on no roster tab.
- **Zandile Chamane** — 50 CallX calls (1.3h), on the attendance register; exists only on a
  **legacy tab as CB150** while CallX labels her **CB210**. Legacy tabs do not load.
- **Kent Le Ray** — 11 ViciDial calls, on no roster tab.
- Team leaders **Nikita Baijnath (CB230)**, **Shane Methalal (CB212)**, **Dharmendra Bhudoo**
  dialled 25 calls (3.5h). Correctly excluded from agent stats — noted so it is not re-diagnosed.

## 7. Daily runbook

1. Upload the **Agent List first**. It is the spine; everything re-resolves against it.
2. Pull `EXPORT_CALL_REPORT` for the day with **all user groups**, one day at a time.
3. Upload CallX for the day.
4. Run the audit for that folder and read the per-group verdict.
5. Any group at FAIL: re-pull that export before trusting a single number on the day.
6. Any identity in the "reached nobody" list that is a current employee: fix the Agent List and
   re-upload it. Do not patch it downstream.

## 8. What this framework deliberately does not do

- It does not infer campaign from the dialler's `user_group`. The group names are useful evidence
  and a good cross-check, but the **roster** classifies agents — a TL rename would otherwise
  silently reassign a floor.
- It does not fill a gap with an estimate unless the source is genuinely period-aggregated, and
  then it is labelled as an estimate and never treated as measured.
- It does not drop anything it cannot place. Unattributed is a **reported** state with a name
  attached, because that is the only version anyone ever fixes.

---

## 9. Where the framework is enforced (2026-08-16)

| Surface | What it does |
|---|---|
| `Chatterbox_AgentOS_Analytics.html` → `dialCoverage()` | Computes present-vs-dialling per campaign for the selected window. Campaign from the Agent List; present from the `presentCodes` rule. |
| Ops → **Upload Station → "Dialler coverage by campaign"** | Renders the verdict on every visit, red-bordered on a FAIL, and prints the ViciDial `user_group` census beside it as the evidence of what the pull covered. |
| `VICI_CALL_REPORT` transform | Now stores `user_group` — the only field that separates a filtered export from an idle floor. |
| `nicks_code/diagnostics/audit-upload-day.mjs` | Same law over the raw files, for any upload folder, before anything is loaded. |
| `nicks_code/diagnostics/verify-coverage-law.mjs` | 15 checks. Drives the real 13 Aug package and asserts Cuddle FAILS, Courtesy passes, and a campaign with nobody present is not failed. |

On the 13 Aug package Ops now reports:

```
Courtesy  r39/p39/d39  ok
Cuddle    r26/p25/d0   FAIL  — 25 present but ZERO dialler rows
Nesting   r8/p0/d8     ok
VT        r22/p20/d19  ok

user_group census: Hezron_Courtesy_C 915 · Ryan_Digital 780 · (blank) 266
                   Ryan_Digital_Ref 199 · Ryan_Scheduling 131 · ADMIN 11 · LD_Training 3
```

A campaign with nobody marked present is reported as `—`, never a failure: the law is about a
floor that worked and left no trace, not about a quiet day.

---

## 10. The roster is a REPLACEMENT, and a past day must not move (open — 2026-08-16)

> Nick: *"the agent list will come with no date but when its uploaded its the latest one"* /
> *"vas and ops doesnt need to keep the agent list because everytime ill upload a new one so the
> old one can come out and then the new one is in place."*

**Settled design:** one roster, replaced wholesale on every upload, no effective date, no history
of prior lists. The uploaded list describes **now**.

**The consequence, measured.** PULSE's Variance Report gates every row on the LIVE roster
(`IDX.byCode`). Because the roster is replaced daily, past days silently rewrite themselves. Same
13 Aug data, roster swapped underneath it:

```
roster A (contemporaneous)  ->  87 variance rows
roster B (a later list)     ->  75 variance rows
14 agents lost: CB256 CB257 CB258 CB261 CB262 CB263 CB274 CB275 CB276 CB278 CB282 CB283 CB284 CB287
their sales diverted to unmapped: siziwethabete(1) zamamthethwa(3) bradleynaidoo(2) justinmotilall(3) busiswamathenjwa(2)
```

The data is loaded and correct. It is the *identity* that stops resolving, so the row disappears.

**Why `orgAt()` cannot fix this on its own.** Non-negotiable 11's effective-dated history works
only where earlier lists were observed. With replace-on-upload and no retention, a leaver has no
earlier segment, and "dates before the earliest observation resolve to that earliest segment"
returns the current roster — which does not contain them. History is the right mechanism going
forward and the wrong one for anybody already gone.

**Therefore the rule:**

> An agent belongs on a day if **that day's sources carry activity for them**. The roster says who
> they are — campaign, team leader, tenure. It does not get to say whether the day happened.

**The change, in three parts:**

1. **Scope gate** — admit any code with sales, board, talk or a present mark that day, whether or
   not it is on the current roster.
2. **Identity fallback** — `resolveKey` fails on a name that is off the live roster, which is why
   the leavers' BI sales land in *unmapped* rather than on a row. It needs a lightweight identity
   ledger (code → name/campaign/TL as last seen) that survives roster replacement. This is the
   load-bearing part: the scope gate alone is not enough, because a leaver's talk never reaches
   `talkMap` and their BI owner name never resolves.
3. **Label, don't hide** — such rows carry an "off current roster" marker. Their sales and talk
   count for that past day (it happened); they are excluded from present-day headcount and target
   denominators.

**The invariant, and the test:** load one day's data, swap the roster underneath it, and the day
must not change. Today that assertion fails 87 → 75.

**Status: designed, not built.** It cuts into PULSE identity resolution, guarded by
`verify-history.mjs` (34 checks) and `verify-variance.mjs` — it needs a clean run, not a tail end.
