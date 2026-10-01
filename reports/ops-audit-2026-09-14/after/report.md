# Ops audit — 2026-09-14 (SAST)

## A · Worker health sentinel (kv:health-alerts)
- last run: 2026-09-14 06:10 · 0 alert(s)

## B · Ops fact stores (kv:cb-facts-*)
- AGENT_LIST           rows     126 · data — → — · batches 1 · written 2026-09-08 12:45 (5.8 d ago) by aarav · 0.03 MB
- ATTENDANCE           rows   18214 · data 2026-01-02 → 2026-09-11 · batches 8 · written 2026-09-12 08:35 (1.9 d ago) by nicholas · 4.84 MB
- BI_ACTIVE_CASES      rows   29051 · data 2026-07-27 → 2026-09-13 · batches 2 · written 2026-09-14 06:02 (0.1 d ago) by nicholas · 11.71 MB
- CALLX_CALL_RECORDS   rows   70161 · data 2026-08-06 → 2026-08-31 · batches 6 · written 2026-09-01 11:54 (12.8 d ago) by aarav · 38.55 MB
- QA_EVALUATIONS       rows    8240 · data 2026-04-30 → 2026-09-12 · batches 4 · written 2026-09-14 06:02 (0.1 d ago) by nicholas · 6.15 MB
- REFERRALS            rows    2914 · data 2026-05-26 → 2026-09-11 · batches 2 · written 2026-09-14 07:17 (0.0 d ago) by nicholas · 0.63 MB
- SES_DIAL_0800        rows       0 · data — → — · batches 0 · written 2026-08-31 15:40 (13.7 d ago) by db-cleanup · 0.00 MB
- SES_DIAL_1000        rows       0 · data — → — · batches 0 · written 2026-08-31 15:40 (13.7 d ago) by db-cleanup · 0.00 MB
- SES_OPEN_0800        rows       0 · data — → — · batches 0 · written 2026-08-31 15:40 (13.7 d ago) by db-cleanup · 0.00 MB
- SES_OPEN_1000        rows       0 · data — → — · batches 0 · written 2026-08-31 15:40 (13.7 d ago) by db-cleanup · 0.00 MB
- SF_CLOSED_CASES      rows   49752 · data 2026-07-01 → 2026-09-11 · batches 10 · written 2026-09-12 08:35 (1.9 d ago) by nicholas · 16.79 MB
- SF_INACTIVE          rows    7131 · data 2026-03-26 → 2026-09-11 · batches 11 · written 2026-09-14 06:02 (0.1 d ago) by nicholas · 3.20 MB
- SF_OPEN_CASES        rows   26086 · data 2025-10-01 → 2026-08-25 · batches 1 · written 2026-08-31 10:38 (13.9 d ago) by nicholas · 8.02 MB
- VICI_CALL_REPORT     rows  298855 · data 2026-08-14 → 2026-09-12 · batches 19 · written 2026-09-14 07:17 (0.0 d ago) by nicholas · 64.42 MB

## C · Upload manifest vs Ops intake (kv:upload-manifest vs cb-config.syncedUploads)
- manifest: 128 entries · written 2026-09-13 17:01
- cb-config written 2026-09-14 07:17 by nicholas · syncedUploads decided: 128 · top-level keys: kpis, rules, agentMap, sfOwnerMap, cbInfo, user, syncedUploads
- last 14 days: 96 files (manifest entry keys: name, hash, size, at)
  - 2026-09-13 17:01 · EXPORT_CALL_REPORT_20260913-170046.txt                             · 0.09 MB · Ops: 1
  - 2026-09-13 17:01 · Inactive.xlsx                                                      · 0.04 MB · Ops: 1
  - 2026-09-13 17:01 · evaluations-full-export-2026-09-13.csv                             · 4.01 MB · Ops: 1
  - 2026-09-13 17:01 · BI Active.xlsx                                                     · 1.08 MB · Ops: 1
  - 2026-09-12 08:20 · BI Inactive 110926.xlsx                                            · 0.04 MB · Ops: 1
  - 2026-09-12 08:20 · BI Active 110926.xlsx                                              · 1.05 MB · Ops: 1
  - 2026-09-12 08:15 · EXPORT_CALL_REPORT_20260912-080510.txt                             · 6.37 MB · Ops: 1
  - 2026-09-12 08:15 · sf closed 110926.xls                                               · 0.88 MB · Ops: 1
  - 2026-09-12 08:15 · board stats 110926.xlsx                                            · 0.18 MB · Ops: 1
  - 2026-09-12 08:15 · evaluations-full-export-2026-09-12.csv                             · 4.00 MB · Ops: 1
  - 2026-09-12 08:15 · BI Inactive.xlsx                                                   · 0.01 MB · Ops: 1
  - 2026-09-12 08:15 · Matrix - Agent List.xlsx                                           · 0.08 MB · Ops: 1
  - 2026-09-12 08:15 · attendance_2025-10-01_to_2026-09-12.csv                            · 1.74 MB · Ops: 1
  - 2026-09-12 08:14 · BI Active.xlsx                                                     · 0.13 MB · Ops: 1
  - 2026-09-11 08:41 · sf closed - 100926.xls                                             · 0.94 MB · Ops: 1
  - 2026-09-11 08:41 · board stats 100926.xlsx                                            · 0.17 MB · Ops: 1
  - 2026-09-11 08:41 · EXPORT_CALL_REPORT_20260911-071031.txt                             · 7.11 MB · Ops: 1
  - 2026-09-11 08:41 · BI Inactive 100926.xlsx                                            · 0.03 MB · Ops: 1
  - 2026-09-11 08:41 · Matrix - Agent List.xlsx                                           · 0.08 MB · Ops: 1
  - 2026-09-11 08:41 · evaluations-full-export-2026-09-11.csv                             · 3.94 MB · Ops: 1
  - 2026-09-11 08:41 · attendance_2025-10-01_to_2026-09-11.csv                            · 1.72 MB · Ops: 1
  - 2026-09-11 08:41 · BI Active - 100926.xlsx                                            · 0.96 MB · Ops: 1
  - 2026-09-10 08:44 · SF Closed 090926.xls                                               · 0.96 MB · Ops: 1
  - 2026-09-10 08:44 · board stats 090926.xlsx                                            · 0.17 MB · Ops: 1
  - 2026-09-10 08:44 · EXPORT_CALL_REPORT_20260910-071448.txt                             · 7.48 MB · Ops: 1
  - 2026-09-10 08:44 · BI Inactive.xlsx                                                   · 0.03 MB · Ops: 1
  - 2026-09-10 08:44 · Matrix - Agent List.xlsx                                           · 0.08 MB · Ops: 1
  - 2026-09-10 08:44 · evaluations-full-export-2026-09-10.csv                             · 3.87 MB · Ops: 1
  - 2026-09-10 08:43 · attendance_2025-10-01_to_2026-09-10.csv                            · 1.71 MB · Ops: 1
  - 2026-09-10 08:43 · BI Active.xlsx                                                     · 0.88 MB · Ops: 1
  - 2026-09-09 10:38 · sf closed 080926.xls                                               · 0.98 MB · Ops: 1
  - 2026-09-09 10:37 · board stats 080926.xlsx                                            · 0.18 MB · Ops: 1
  - 2026-09-09 10:37 · EXPORT_CALL_REPORT_20260909-072340.txt                             · 6.22 MB · Ops: 1
  - 2026-09-09 10:37 · BI Inactive.xlsx                                                   · 0.02 MB · Ops: 1
  - 2026-09-09 10:37 · evaluations-full-export-2026-09-09.csv                             · 3.81 MB · Ops: 1
  - 2026-09-09 10:37 · attendance_2025-10-01_to_2026-09-09.csv                            · 1.71 MB · Ops: 1
  - 2026-09-09 10:37 · BI Active.xlsx                                                     · 0.79 MB · Ops: 1
  - 2026-09-08 12:15 · Matrix - Agent List.xlsx                                           · 0.08 MB · Ops: 1
  - 2026-09-08 07:49 · BI Inactive.xlsx                                                   · 0.02 MB · Ops: 1
  - 2026-09-08 07:49 · BI Active.xlsx                                                     · 0.70 MB · Ops: 1
  - 2026-09-08 07:20 · sf closed 070926.xls                                               · 1.02 MB · Ops: 1
  - 2026-09-08 07:20 · EXPORT_CALL_REPORT_20260908-071026.txt                             · 4.95 MB · Ops: 1
  - 2026-09-08 07:20 · board stats 070926.xlsx                                            · 0.18 MB · Ops: 1
  - 2026-09-08 07:19 · Matrix - Agent List.xlsx                                           · 0.08 MB · Ops: 1
  - 2026-09-08 07:19 · evaluations-full-export-2026-09-08.csv                             · 3.78 MB · Ops: 1
  - 2026-09-08 07:19 · attendance_2025-10-01_to_2026-09-08.csv                            · 1.69 MB · Ops: 1
  - 2026-09-06 12:59 · sf closed cases 060926.xls                                         · 5.45 MB · Ops: 1
  - 2026-09-06 12:58 · board stats 050926.xlsx                                            · 0.17 MB · Ops: 1
  - 2026-09-06 12:58 · EXPORT_CALL_REPORT_20260906-124950.txt                             · 6.51 MB · Ops: 1
  - 2026-09-06 12:58 · board stats 040926.xlsx                                            · 0.17 MB · Ops: 1
  - 2026-09-06 12:58 · BI Inactive 060926.xlsx                                            · 0.02 MB · Ops: 1
  - 2026-09-06 12:58 · Matrix - Agent List.xlsx                                           · 0.08 MB · Ops: 1
  - 2026-09-06 12:57 · evaluations-full-export-2026-09-06.csv                             · 3.69 MB · Ops: 1
  - 2026-09-06 12:57 · attendance_2025-10-01_to_2026-09-06.csv                            · 1.68 MB · Ops: 1
  - 2026-09-06 12:57 · BI Active 060926.xlsx                                              · 0.62 MB · Ops: 1
  - 2026-09-04 15:39 · Matrix - Agent List.xlsx                                           · 0.08 MB · Ops: 1
  - 2026-09-04 15:30 · Matrix - Agent List.xlsx                                           · 0.08 MB · Ops: 1
  - 2026-09-04 08:39 · EXPORT_CALL_REPORT_20260904-083919.txt                             · 0.23 MB · Ops: 1
  - 2026-09-04 07:48 · sf closed 030926.xls                                               · 1.35 MB · Ops: 1
  - 2026-09-04 07:47 · Board stats 030926.xlsx                                            · 0.17 MB · Ops: 1
  - 2026-09-04 07:47 · EXPORT_CALL_REPORT_20260903-192627.txt                             · 4.83 MB · Ops: 1
  - 2026-09-04 07:47 · BI Inactive.xlsx                                                   · 0.02 MB · Ops: 1
  - 2026-09-04 07:47 · evaluations-full-export-2026-09-03.csv                             · 3.59 MB · Ops: 1
  - 2026-09-04 07:47 · attendance_2025-10-01_to_2026-09-03.csv                            · 1.66 MB · Ops: 1
  - 2026-09-04 07:47 · BI Active.xlsx                                                     · 0.53 MB · Ops: 1
  - 2026-09-03 13:44 · Matrix - Agent List.xlsx                                           · 0.08 MB · Ops: 1
  - 2026-09-02 19:12 · closed cases 020926.xls                                            · 1.48 MB · Ops: 1
  - 2026-09-02 19:12 · VAS Daily Tracker - September 2026.xlsx                            · 0.17 MB · Ops: 1
  - 2026-09-02 19:12 · EXPORT_CALL_REPORT_20260902-172956.txt                             · 4.99 MB · Ops: 1
  - 2026-09-02 19:12 · BI Inactive.xlsx                                                   · 0.01 MB · Ops: 1
  - 2026-09-02 19:11 · Matrix - Agent List.xlsx                                           · 0.08 MB · Ops: 1
  - 2026-09-02 19:11 · evaluations-full-export-2026-09-02.csv                             · 3.51 MB · Ops: 1
  - 2026-09-02 19:11 · attendance_2025-10-01_to_2026-09-02.csv                            · 1.65 MB · Ops: 1
  - 2026-09-02 19:11 · BI Active.xlsx                                                     · 0.41 MB · Ops: 1
  - 2026-09-01 19:14 · BI Inactive.xlsx                                                   · 0.01 MB · Ops: 1
  - 2026-09-01 19:14 · BI Active.xlsx                                                     · 0.33 MB · Ops: 1
  - 2026-09-01 19:11 · closed 010926.xls                                                  · 1.03 MB · Ops: 1
  - 2026-09-01 19:10 · boardstats 010926.xlsx                                             · 0.17 MB · Ops: 1
  - 2026-09-01 19:10 · EXPORT_CALL_REPORT_20260901-183239.txt                             · 5.95 MB · Ops: 1
  - 2026-09-01 19:10 · Matrix - Agent List.xlsx                                           · 0.08 MB · Ops: 1
  - 2026-09-01 19:10 · evaluations-full-export-2026-09-01.csv                             · 3.43 MB · Ops: 1
  - 2026-09-01 19:10 · attendance_2025-10-01_to_2026-09-01.csv                            · 1.63 MB · Ops: 1
  - 2026-09-01 07:15 · call_records.xlsx                                                  · 0.16 MB · Ops: 1
  - 2026-08-31 21:12 · SF Closed 310828.xls                                               · 0.91 MB · Ops: 1
  - 2026-08-31 21:12 · Board Stats 310828.xlsx                                            · 0.17 MB · Ops: 1
  - 2026-08-31 21:12 · EXPORT_CALL_REPORT_20260831-210624.txt                             · 6.06 MB · Ops: 1
  - 2026-08-31 21:11 · BI Inactive 310828.xlsx                                            · 0.01 MB · Ops: 1
  - 2026-08-31 21:11 · Matrix - Agent List.xlsx                                           · 0.08 MB · Ops: 1
  - 2026-08-31 21:11 · evaluations-full-export-2026-08-31.csv                             · 3.36 MB · Ops: 1
  - 2026-08-31 21:11 · attendance_2025-10-01_to_2026-08-31.csv                            · 1.62 MB · Ops: 1
  - 2026-08-31 21:11 · BI Active 310828.xlsx                                              · 0.25 MB · Ops: 1
  - 2026-08-31 12:41 · BI Inactive.xlsx                                                   · 0.01 MB · Ops: 1
  - 2026-08-31 12:41 · call_records.xlsx                                                  · 0.48 MB · Ops: 1
  - 2026-08-31 12:41 · BI Active.xlsx                                                     · 0.22 MB · Ops: 1
  - 2026-08-31 07:50 · Lead Management - Open cases.xls                                   · 17.86 MB · Ops: 1
  - 2026-08-31 07:24 · EXPORT_CALL_REPORT_20260831-072402.txt                             · 5.70 MB · Ops: 1

## D · Roster: Ops cb-facts-AGENT_LIST vs PULSE vas-state
- vas-state written 2026-09-13 17:35 · roster 126 agents · rosterEffect {"hash":"Agent List — published as of 2026-09-08","at":"2026-09-13 15:01","asOf":"2026-09-08","file":"Agent List — published as of 2026-09-08","agents":126,"mov
- Ops AGENT_LIST latest _d B0183 · 126 rows (of 126 total) · batches B0183
- only in PULSE: 0 
- only in Ops:   0 
- team-leader differs: 0
- campaign differs: 0
- tenure differs: 0

## E · September day coverage per Ops source (rows per _d)
| day | ATTENDANCE | BI ACTIVE CASE | CALLX CALL REC | QA EVALUATIONS | REFERRALS | SES DIAL 0800 | SES DIAL 1000 | SES OPEN 0800 | SES OPEN 1000 | SF CLOSED CASE | SF INACTIVE | SF OPEN CASES | VICI CALL REPO |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 09-01 | 163 | 1252 | · | 156 | 20 | · | · | · | · | 1315 | 37 | · | 22480 |
| 09-02 | 161 | 1170 | · | 162 | 35 | · | · | · | · | 1898 | 46 | · | 19713 |
| 09-03 | 159 | 1220 | · | 173 | 24 | · | · | · | · | 1733 | 29 | · | 19121 |
| 09-04 | 159 | 1042 | · | 224 | 30 | · | · | · | · | 1381 | 12 | · | 18747 |
| 09-05 | · | 397 | · | · | 15 | · | · | · | · | 674 | · | · | 6873 |
| 09-06 | · | 9 | · | · | · | · | · | · | · | · | · | · | 1 |
| 09-07 | 160 | 1096 | · | 192 | 45 | · | · | · | · | 1315 | 24 | · | 20140 |
| 09-08 | 162 | 1310 | · | 67 | 47 | · | · | · | · | 1253 | 29 | · | 22580 |
| 09-09 | 160 | 1257 | · | 137 | 45 | · | · | · | · | 1230 | 40 | · | 26573 |
| 09-10 | 159 | 1198 | · | 157 | 37 | · | · | · | · | 1202 | 12 | · | 25669 |
| 09-11 | 180 | 1367 | · | 138 | 43 | · | · | · | · | 1126 | 8 | · | 22876 |
| 09-12 | · | 372 | · | 22 | · | · | · | · | · | · | · | · | 363 |
| 09-13 | · | 22 | · | · | · | · | · | · | · | · | · | · | · |
| 09-14 | · | · | · | · | · | · | · | · | · | · | · | · | · |

## F · kv:nba-digest (what the TL / agent views read from Ops)
- written 2026-09-14 07:17 by nicholas · period {"from":"2026-09-01","to":"2026-09-13"} · agents 126 · updatedAt 2026-09-14T05:17:20.491Z · rules.pen [0,0,0]

## G · kv:app-opened
- 