# Contracts — 002 (binding field names)

Work packages: **WP-A** engine + tools (`nicks_code/index.html`, `tools/digest-republish.mjs`,
`tools/tick-local.mjs`, NEW `tools/sync-referrals.mjs`); **WP-B** Worker (`worker/src/*.mjs`); **WP-C** page
(`agent/index.html`). They meet only here.

## C1 Empty-month digest (WP-A → WP-B, WP-C)
Same top-level shape as a month digest, plus:
```text
empty        : true                       // only on an empty payload; absent otherwise
period       : {from:'2026-10-01', to:'2026-10-31'}
daysWithData : 0,  dates: [],  weeks: [],  diallingDays: 0,  workingDays: <calendar working days>
comm         : the current month's model;  commNow absent
agents[]     : {code, name, tl, campaign, tenure, plan, target (month target from the list), covered:false,
                every figure null: sales, gwpEx, pctT, spd, att, qa, aveG, ref, closed, leads, calls, ans,
                talk, aveTalk, act, emp, composite, days:[], wk:[]}
tlAgg: [], campAgg: {}, updatedAt, dataReach
```
- The live pointer row gains `empty:true` when the payload is empty (beside `period`).
- The previous month's history key `agent-digest-YYYY-MM` is (re)written by the tool when the live month is empty.

## C2 Live-key fence (WP-B; the tool mirrors it)
- Current month always allowed EXCEPT: an `empty:true` payload is refused (409 `empty_over_data`) when the live key
  holds the same month and is NOT empty. Older months never. (`liveDigestAllowed` + the pointer's `empty` stamp.)

## C3 Referrals (WP-A writes, WP-A/PULSE + WP-B read)
```text
kv:referrals-latest   : {rows:[{id,created,agent,referrer,count}], contacts, pulled_at:'ISO', slot:'08:00'|'14:00'|'manual', by:'tick'}
kv:referrals-sync-log : {data: JSON.stringify({entries:[{at, slot, ok, rows, contacts, total, error|null}]})}   // last 30
```
- Storage `raw/kv/referrals-latest` + rules pointer (like other tool writes).
- PULSE adopts it via `GET /api/kv?key=referrals-latest` when `pulled_at` > `S.refs.at` (boot, focus, 10-min poll).
- WP-B: the `/api/kv` GET must allow that key for PULSE (staff) sessions; health `referrals-slot-missed` (warning,
  names the slot) when today's slot (08:00 / 14:00 SAST) is > 2 h past with no ok entry at/after it; clears itself.

## C4 Coaching (WP-B → WP-C)
- Every coaching payload carries `coachingAt` (the snapshot's fetchedAt):
  agentDetail coaching block, team overview coaching block, `cm-coaching` (already `fetchedAt`), hub tab.
- Session objects shown to TL/CM/agent views carry `coach` (hub leader name), `coachIsTl` (bool), and
  `type`/`typeLabel`/`collection`.
- Attribution: a session with an agent CB belongs to that agent's CURRENT team leader (digest row / list),
  whoever logged it; without a CB it stays with the logging profile.
- `GET /api/portal/hub/coaching` (TL tab) adds `others: [sessions on the TL's agents logged under another Hub
  profile, from the snapshot, newest first]` and `coachingAt`.
- Type counts: `byType` keyed by type label includes 'Lead Management Coaching' (0 when none) and
  `lmCount` for the period.
- Themes: `coachAnalysis` and every theme list include any `*.lead_management` cluster key alongside gap themes.
- `cmCoaching`: owner = the agent's current TL by CB first, then hub leader; scope filter unchanged (CB in the
  manager's codes).
- Daily guarantee: `snapshotCoachingWave` starts a pull when the copy predates today's 05:30 SAST (and now ≥ 05:30
  SAST), regardless of REFRESH_HOURS.
