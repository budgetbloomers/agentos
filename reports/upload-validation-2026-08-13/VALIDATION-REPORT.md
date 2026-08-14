# Upload Station Validation — package 2026-08-13 (ops analytics)

Period **2026-08-01 → 2026-08-13** · run 2026-08-14T10:25Z · engine `tools/upload-station-validate.mjs`

## FINAL STATUS: FAILED VALIDATION (blocked by CRITICAL findings)

| Gate | Result |
|---|---|
| Agent validation | 23 unresolved identities (see agent-matching.csv) |
| Formula validation | 6/6 PASS |
| Duplicate validation | 0 duplicates flagged |
| Date validation | in-window filters live on every source (Sim 5) |
| Reconciliation | 7/7 PASS |
| Simulations | 9/10 clean |
| Findings | 1 CRITICAL · 6 HIGH · 2 MEDIUM |

## Sources ingested

| File | Source | Raw rows | In window | Note |
|---|---|---|---|---|
| Matrix - Agent List.xlsx | AGENT_LIST | 95 agents | — | sheets kept: VAS, VT · dropped: Sheet2, Reg List, Sheet1, May |
| attendance_2026-08-06_to_2026-08-13.csv | ATTENDANCE | 639 | 639 | covers 2026-08-06 → 2026-08-13 |
| call_records.csv | CALLX_CALL_RECORDS | 39852 | 39852 | inbound no-agent legs: 102 |
| Call Report 01 to 13 Aug.xlsx | VICI (dialler, VT floor) | 13466 | 13466 | ViciDial shape, NOT CallX — user column is the agent |
| EXPORT_CALL_REPORT_20260813-152302.txt | VICI daily txt | 2317 | — | 2310 rows already in the 01–13 report → excluded (double-count guard) |
| evaluations-full-export-2026-08-13.csv | QA_EVALUATIONS | 618 | 616 | windowed on Date of Call |
| Active.xlsx | BI_ACTIVE_CASES | 11905 | 7135 | THE money source; charges EX-VAT |
| Inactive.xlsx | SF_INACTIVE | 349 | 127 | windowed by Contract Create |
| SF Open Cases 5 - 13.xls | SF_OPEN_CASES | 2815 | snapshot | HTML .xls parsed as table |
| SF Closed 5 - 13.xls | SF_CLOSED_CASES | **0** | — | **frameset shell — NO DATA** |

## Findings (severity-ordered)

- **CRITICAL** [SF_CLOSED_CASES] "SF Closed 5 - 13.xls" carries ZERO case rows — it is an Excel frameset shell whose data lives in a companion "_files/sheet001.htm" folder that was not exported. Closed-case KPIs (Total Closed, Lead-Mgmt Conversion, Wasted Leads, Closure/day, No-Feedback rate) are NOT COMPUTABLE this run. Re-export closed cases (single-file HTML table like the Open Cases file).
- **HIGH** [ATTENDANCE] Attendance file only covers 2026-08-06 → 2026-08-13; period weekdays with NO attendance rows: 2026-08-03, 2026-08-04, 2026-08-05 (2026-08-10 also empty — Women’s Day observed, expected). Present-day denominators (talk/day, Target Ach %) are understated for 01–05 Aug.
- **HIGH** [COVERAGE] CALLX_CALL_RECORDS data spans 2026-08-06 → 2026-08-13 but the reporting period is 2026-08-01 → 2026-08-13 — KPIs from this source cover only its own span.
- **HIGH** [COVERAGE] QA (Date of Call) data spans 2026-07-24 → 2026-08-12 but the reporting period is 2026-08-01 → 2026-08-13 — KPIs from this source cover only its own span.
- **HIGH** [AGENT_LIST] 22 roster agents carry no Target (the VT sheet has no Target column) — Target Ach % reads N/A for them, never guessed.
- **HIGH** [ATTENDANCE] 16 attendance identities are in NEITHER the Agent List nor the register: CB231 Rajiv Mohan; CB272 Hezron Pillay; CB269 Shameem Chetty; CB259 Merisha Thanoo; CB217 Keshav Rampersad; CB215 Rozanna Govender; CB270 Beverlene Naidoo; CB218 Andile Gasa; CB260 Thembankosi Walter Faya; CB267 Denise Haripersad; CB273 Nishae Venkatsamy; CB213 Nithananthan Chetty; CB232 Kent Le Ray; CB268 Joshua Ashley Seekola; CB208 Rishae' Sanjeev Jayrahj; CB214 Beverly Govender
- **HIGH** [CALLX] 1 CallX agent identities not resolvable to the Agent List (46 rows) — excluded from agent KPIs, listed in agent-matching.csv
- **MEDIUM** [QA] qaDisputeStatuses rule (closed_retracted, qa_review) matches NOTHING in this export's Status vocabulary (Closed — Risk Mitigated | Awaiting QA Close | Pending TL Action…). Disputed reads 0 — vocabulary drift between rule and export, route to Jared.
- **MEDIUM** [VICI] 2310/2317 rows of the 13-Aug Vici txt export are already inside "Call Report 01 to 13 Aug.xlsx" — loading both would double-count 13 Aug. The txt file is the VAS-scope daily export; EXCLUDED from ops metrics this run.

## Simulations

| # | Simulation | Status | Detail |
|---|---|---|---|
| 1 | Agent validation sweep | DONE | VALID_AGENT: 385 distinct identities · NOT_IN_SOURCE_OF_TRUTH: 23 distinct identities · MANAGEMENT_OR_STAFF: 39 distinct identities · SYSTEM_OR_QUEUE: 12 distinct identities |
| 2 | Formula recalculation | PASS | 6/6 dual-path recomputations agree (no in-package precomputed report exists to diff against — parity is recomputation-vs-recomputation) |
| 3 | Duplicate detection | PASS | CallX exact-dupes 0 · QA RecordID dupes 0 · attendance employee-day dupes 0 · Open CaseNumber dupes 0 · BI exact-line dupes 0 · Vici exact dupes 0 · Vici txt↔xlsx 13-Aug overlap 2310/2317 |
| 4 | Missing data | FLAGGED | attendance missing weekdays in period: 2026-08-03, 2026-08-04, 2026-08-05, 2026-08-10 · closed-cases source EMPTY · roster agents without Target: 22 · without Start Date: 0 · ambiguous dates skipped: 0 |
| 5 | Date boundary | PASS | rows outside 2026-08-01→2026-08-13 excluded from MTD: CALLX 0 · QA 2 · BI_ACTIVE 4770 · VICI 0 · INACTIVE 222 — GWP with boundary off would read R353144.53 vs windowed R211692.21 (filter is live) |
| 6 | Zero denominators | PASS | agents with 0 scheduled days: 9, 0 QA: 18, 0 CallX calls: 56 — all render N/A (null), never 0% (violations: 0) |
| 7 | Agent removal | PASS | GWP all-owners R211692.21 − valid-agents R210603.60 = unattributed R1088.61 (36 rows, 13 accounts) — surfaced, never spread |
| 8 | Agent addition | PASS | re-adding top agent CB19 raises valid GWP by exactly R8866.24 and sales by 103 |
| 9 | Duplicate injection | PASS | injected copy of row 8: unique calls unchanged (17470), raw count +1 (39853), duplicate detector caught it (true) |
| 10 | Missing-record | PASS | removing one eval (score 100) from CB142: recomputed avg 78 = predicted 78 |

## Reconciliation

| Metric | Σ agents | Unattributed | Overall | Status |
|---|---|---|---|---|
| GWP ex-VAT (R) | 210603.6 | 1088.61 | 211692.21 | PASS |
| CallX agent calls | 39068 | 0 | 39068 | PASS |
| Vici dials (valid agents) | 13069 | 0 | 13069 | PASS |
| Vici talk seconds | 1333264 | 10120 | 1343384 | PASS |
| QA evals (valid agents) | 615 | 0 | 615 | PASS |
| Open cases | 1131 | 1684 | 2815 | PASS |
| Present days | 378 | 0 | 378 | PASS |

## Vici Dial Report (VAS-analytics treatment · talkFrom 'all')

Talk time = Σ `length_in_sec` grouped on the CB number (the `user` login, with the Agent List's name resolution winning any clash). Average talk time (AHT) = talk ÷ answered calls, where answered = status outside the no-contact list ('A' is Answering Machine, not answered). Totals recomputed from summed counts, never averaged percentages.

- Ringing share (talkFrom 'all' includes it): **159:17:37 of 373:09:44** (43%) sits on no-contact statuses — set talkFrom 'contacted' to bill only reached calls
- System logins excluded and counted: VDAD 114 · CBT001 26 · CBT003 8 · CBT005 15 · CBT007 4 · VDCL 76 (243 rows) · negative lengths zeroed: 2 · in-file record-key dupes: 0
- Login→roster reassignments (NAME wins): none

| CB | Agent | Days | Dials | Answered | Answer % | Talk | Avg talk (AHT) | Talk/day | Opt-ins | Sale disp |
|---|---|---|---|---|---|---|---|---|---|---|
| CB258 | Ismail Samuel | 8 | 883 | 165 | 18.7 | 31:54:49 | 11:36 | 3:59:24 | 27 | 39 |
| CB191 | Rousha Pillay | 9 | 636 | 176 | 27.7 | 25:31:21 | 8:42 | 2:50:06 | 31 | 38 |
| CB182 | Avelucia Gebuza | 9 | 569 | 179 | 31.5 | 21:51:30 | 7:20 | 2:25:42 | 11 | 26 |
| CB14 | Thokozile Irene Maphumulo | 8 | 660 | 251 | 38.0 | 18:46:41 | 4:29 | 2:20:48 | 8 | 37 |
| CB256 | Cassius Zamani Ngcobo | 9 | 507 | 146 | 28.8 | 17:23:04 | 7:09 | 1:55:54 | 8 | 12 |
| CB184 | Lesley-Ann Stolls | 8 | 486 | 125 | 25.7 | 17:11:58 | 8:15 | 2:09:00 | 27 | 37 |
| CB257 | Ryan Chetty | 6 | 525 | 129 | 24.6 | 16:34:40 | 7:43 | 2:45:48 | 16 | 22 |
| CB228 | Ntombovuyo Sihiya | 7 | 275 | 87 | 31.6 | 16:12:39 | 11:11 | 2:18:54 | 0 | 27 |
| CB183 | Avesh Singh | 8 | 541 | 97 | 17.9 | 15:33:27 | 9:37 | 1:56:42 | 9 | 21 |
| CB234 | Ranjini Sarabjeeth | 8 | 592 | 139 | 23.5 | 15:06:29 | 6:31 | 1:53:18 | 12 | 15 |
| CB275 | Nolulamo Mazaka | 5 | 538 | 119 | 22.1 | 14:05:55 | 7:07 | 2:49:12 | 0 | 5 |
| CB193 | Nonhle Cele | 7 | 382 | 82 | 21.5 | 13:52:18 | 10:09 | 1:58:54 | 0 | 18 |
| CB194 | Fabian Chetty | 9 | 257 | 79 | 30.7 | 12:31:12 | 9:31 | 1:23:30 | 3 | 10 |
| CB188 | Philile Angel Magubane | 9 | 397 | 124 | 31.2 | 12:23:36 | 6:00 | 1:22:36 | 7 | 36 |
| CB278 | Zama Mthethwa | 5 | 732 | 264 | 36.1 | 12:13:16 | 2:47 | 2:26:42 | 1 | 4 |
| CB189 | Princess Nompucuko Mlaba | 9 | 377 | 75 | 19.9 | 10:49:57 | 8:40 | 1:12:12 | 2 | 12 |
| CB274 | Siziwe Thabete | 5 | 540 | 165 | 30.6 | 10:47:53 | 3:56 | 2:09:36 | 0 | 8 |
| CB282 | Rene Nicole Williams | 4 | 528 | 117 | 22.2 | 10:09:05 | 5:12 | 2:32:18 | 0 | 3 |
| CB287 | Bradley Naidoo | 5 | 473 | 133 | 28.1 | 10:02:14 | 4:32 | 2:00:24 | 0 | 10 |
| CB47 | Selvi Singh | 8 | 364 | 101 | 27.7 | 9:59:41 | 5:56 | 1:15:00 | 0 | 16 |
| CB284 | Arthee Sirkar | 5 | 631 | 163 | 25.8 | 9:45:06 | 3:35 | 1:57:00 | 0 | 2 |
| CB276 | Ntokozo Zuma | 5 | 476 | 96 | 20.2 | 9:01:30 | 5:38 | 1:48:18 | 0 | 3 |
| CB225 | Nonhle Nombika | 4 | 173 | 52 | 30.1 | 7:59:33 | 9:13 | 1:59:54 | 0 | 9 |
| CB283 | Constance Tebogo Tshesane | 5 | 424 | 70 | 16.5 | 7:51:32 | 6:44 | 1:34:18 | 0 | 1 |
| CB190 | Devamani Vanessa Pillay | 8 | 286 | 1 | 0.3 | 7:17:42 | 7:17:42 | 54:42 | 0 | 0 |
| CB112 | Luvo Mawundu | 9 | 356 | 3 | 0.8 | 6:31:23 | 2:10:28 | 43:30 | 0 | 0 |
| CB157 | Mandisa Cele | 9 | 258 | 0 | 0.0 | 5:49:57 | N/A | 38:54 | 0 | 0 |
| CB16 | Chireshi Nair | 8 | 203 | 94 | 46.3 | 3:02:36 | 1:57 | 22:48 | 0 | 0 |
| TOTAL | 28 agents | 10 | 13069 | 3232 | 24.7 | 370:21:04 | 6:53 |  | 162 | 411 |

## Headline recalculated figures (valid reporting agents only, 2026-08-01 → 2026-08-13)

- Roster: **95 agents** (73 VAS · 22 VT) — register carries 139 employees for management classification
- Sales (distinct BI accounts): **2411** · GWP **R211692.21 ex-VAT / R243446.04 incl** — unattributed R1088.61 across 13 accounts (36 rows)
- Cancellations: **50 accounts** windowed by Contract Create · GWP lost R3609.30 ex
- CallX: 39852 calls in window (39068 on valid agents) · unique destinations 17470
- Vici (VT floor): 13466 dials · 370.4h talk incl ringing (user-column join)
- QA: 616 evals in window · Open cases snapshot: 2815
- Closed cases: **N/A — source file empty (see CRITICAL finding)**

## Output files

validated-agents.csv · mtd-agent-dataset.csv · vici-dial-report.csv · agent-matching.csv · formula-validation.csv · excluded-records.csv · duplicates.csv · reconciliation.csv

*Raw uploads untouched in `uploads/2026-08-13/`. Every excluded record carries a reason; nothing was silently deleted. POPIA: this report contains agent names — keep it inside the repo (reports/ is not deployed).*