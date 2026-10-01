# Contracts — 001 CM view sign-off

The three work packages meet ONLY at these interfaces. Field names are binding.

## C1 Digest fields (PULSE engine → Worker) — owner WP1

| Field | Where | Type | Meaning |
|---|---|---|---|
| `agents[].closed` | every digest (live, month, cycle) | number \| null | leads (Salesforce cases) the agent closed in the period, any status incl. "no feedback" (`leadBook().A[cb].tc`). `null` = no case book loaded — never 0 for "unknown". |
| `period.kind` | cycle digests | `'cycle'` | present only on cycle payloads; month payloads unchanged. |
| key `kv:agent-digest-cycle-YYYY-MM` | Storage `raw/kv/agent-digest-cycle-YYYY-MM` + rules pointer | same shape as a month digest | billing cycle 26th of the previous month → 25th of YYYY-MM. Written ONLY by `tools/digest-republish.mjs` for the last complete cycle and the cycle in progress. Never the live key. |
| `MTD_RULES.leadReportExcludeCampaigns` | PULSE + `specs/mtd_engine_rules.json` (dated `_changes[]`) | string[] | `['Courtesy']` from 2026-10-01. Applied to the Lead management REPORT only (PULSE page + `agent-reports-leads`). |
| `excludedCampaigns`, `excludedFrom` | `kv:agent-reports-leads` payload | string[], 'YYYY-MM-DD' | the rule above, present ONLY when the report period ends on/after the rule's effective date (2026-10-01) — so September history keeps Courtesy; pages explain/hide; rows, `teams`, `teamsByCamp`, `campaigns` for those campaigns are omitted. (Amended after /speckit-analyze A1.) |

## C2 Campaign-manager overview (Worker → page) — owner WP2, consumer WP3

`GET /api/portal/overview?period=<p>&tenure=<t>` — existing route; the new params apply to role
`campaign_manager` only and are ignored for every other role.

- `p`: `current` (default) | `YYYY-MM` | `cycle-YYYY-MM`. Malformed → 400 `{error:'bad_period'}`. Not published
  → 404 `{error:'period_not_published', period:{key,from,to,label}, message}` (message says the 15-minute
  refresh builds it).
- `t`: `all` (default) | `M0` | `M1` | `M2` | `Exp` | `unset`. Malformed → 400 `{error:'bad_tenure'}`.

Additions to the campaign-scope response (existing fields unchanged unless listed):

```text
period   : {kind:'current'|'month'|'cycle', key, from:'YYYY-MM-DD', to:'YYYY-MM-DD', label:'26 Aug – 25 Sep 2026'}
periods  : {months:['YYYY-MM', …newest first], cycles:[{key:'cycle-YYYY-MM', from, to, label, complete:boolean, published:boolean}]}
cm.tenure: 'all'|'M0'|'M1'|'M2'|'Exp'|'unset'
cm.campaigns[i].tenures : [{key:'M1', label:'M1', agents:n}, …]          // tenures present on that campaign
cm.campaigns[i].kpis.conv       : {v, sales, closed, target, basis:'sales ÷ closed leads'} | null
cm.campaigns[i].kpis.convWhy    : string (when conv is null)
cm.campaigns[i].kpis.talk       : {v:<sec per worked day>, targetMin, targetSec, source:'default'|'settings'}
cm.campaigns[i].kpis.contactRate: {v, contacts, dials} | null
cm.campaigns[i].kpis.contactWhy : string (when contactRate is null)
cm.campaigns[i].teams[j].contactRate : {v, contacts, dials} | null        // per team leader row
cm.campaigns[i].teams[j].conv        : closed-lead basis, same shape as kpis.conv
assist.blockPanelByCamp : {<campaignKey>: [blockPanel rows]}            // rows for that campaign only
agents  : [digest agent rows for the CM's campaigns ∩ tenure]            // SAME row shape the TL overview returns
tlAgg   : [digest tlAgg rows for team leaders in scope]
campAgg : {<campaign name>: block} — the digest's own keyed-object shape, filtered to the CM's campaigns
summary : {onTarget, talkUnit, teams:tlAgg, campaigns:campAgg} — the team-scope shape, so the TL renderers reuse it
          (tlAgg/campAgg/summary are whole-period engine aggregates: NOT cut by tenure — the page says so)
kpis.talk on the 'all' entry: targetMin/targetSec null, source 'mixed' (campaign targets differ)
weeks, dates, workingDays, diallingDays, talkUnit                        // envelope, as for the TL overview
```

(If the existing CM payload names the KPI container or team rows differently, keep the existing names and
add these fields inside them — the field names above are binding, the container path follows the code.)

Talk target resolution: `cm:targets` per-campaign `talk_target` if set, else `specs/cm_rules.json`
`talk_target_min_by_campaign[campaignKey]`, else `talk_target_min_default` (210).

## C3 Team leaders' coaching (Worker → page) — owner WP2, consumer WP3

`GET /api/portal/cm-coaching?tl=<team leader name>&period=<p>` — role `campaign_manager` only (403 otherwise).
Scope: team leaders of the manager's effective campaigns only (server-enforced); an out-of-scope `tl` → 404.

```text
{ fetchedAt:'ISO', stale:boolean, ageHours:number, hubUrl:'https://coaching-hub-psi.vercel.app/',
  period:{from,to,label},
  leaders:[{name, campaign, sessions:n, agentsCoached:n, last:'YYYY-MM-DD'|null}],   // all in-scope TLs
  tl: name|null,
  sessions:[{date, agentName, cb|null, onList:boolean, type, themes:[label…], supportProvided:string|null}] }
```
Sessions: the chosen TL only, inside the period, newest first, at most 300. Source: the `kv:coaching` snapshot
(matched by the TL's `app_users.hub_ids.coaching`, falling back to the hub team-leader name).

## C4 Team-leader overview additions (Worker → page) — owner WP2, consumer WP3

Every agent row in the team-scope overview gains:
```text
drill : the same verdict object agentDetail publishes as me.drill (drill.mjs), for ta/aveG/qa/att
coach : {n, last:'YYYY-MM-DD'|null, themes:[label…], after:{basis:'sales per worked day', before, after,
         dir:'up'|'down'|'flat'} | null}                 // within the digest period
```

## C5 Coaching refresh (Worker internal) — owner WP2

- `snapshotCoachingWave` processes (collection, leader) pairs in chunks of ≤ 35 Convex calls per invocation,
  keeping a pointer in `kv:coaching-waves`; the snapshot is written only when every pair is done.
- Every invocation appends `{at, step, of, pairs, sessions, error|null}` to `kv:coaching-wave-log` (last 20).
- Health: `evaluateFreshness` raises `coaching-stale` (warning) when `kv:coaching.fetchedAt` is older than
  26 h on a working day; it clears itself.
