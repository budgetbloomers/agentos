# Data model — 001 CM view sign-off

| Entity | Fields | Rules |
|---|---|---|
| Campaign slice | campaign key, tenure (`all`/`M0`/`M1`/`M2`/`Exp`/`unset`), period key | agents in scope = digest rows whose campaign (segment, D4) and tenure match; figures are sums over exactly those rows |
| Period | `kind` current/month/cycle, `key` (`current`, `YYYY-MM`, `cycle-YYYY-MM`), `from`, `to`, `label` | cycle = 26th of previous month → 25th of YYYY-MM; month = 1st → last day; only published periods are offered |
| Digest agent row (+) | `closed: number\|null` | null when no case book loaded; never 0 for unknown |
| Conversion | `v = Σsales ÷ Σclosed`, `sales`, `closed`, `target`, `basis` | null (with `convWhy`) when Σclosed unknown or 0 |
| Talk | `v` sec per worked day, `targetMin`, `targetSec`, `source` | target = cm:targets override → cm_rules.json by campaign → 210 |
| Contact rate | `v = contacts ÷ dials`, `contacts` (= `ans`), `dials` (= `calls`) | contact = status not in noContactStatuses; null (with `contactWhy`) when no dials |
| Talk-target rule | `talk_target_min_by_campaign {courtesy:300, cuddle:270}`, `talk_target_min_default 210`, `_changes[]` | specs/cm_rules.json is the record; campaign.mjs carries the operative copy (drift-checked) |
| LM report rule | `leadReportExcludeCampaigns ['Courtesy']`, `_changes[]` | report layer only; leadBook/leadRoster unchanged |
| Coaching session | `date, agentName, cb, onList, type, themes[], supportProvided, hubTeamLeaderId` | from kv:coaching snapshot; newest first |
| Coaching analysis | `n, last, themes[], after{basis,before,after,dir}` | within the period; `after` = sales per worked day after vs before the last session; `dir` flat within ±5% (`COACH_FLAT_PCT`), else up/down; null if no session or no days either side |
| Wave log entry | `at, step, of, pairs, sessions, error` | last 20 kept in kv:coaching-wave-log |
