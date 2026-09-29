# Refresh intervals — what updates when (sprint 2026-09-29, item 6)

Nick, 29 Sep: *"We do not necessarily need every metric updating every second. Performance data can refresh
at an agreed interval, but agent assistance requests should be effectively immediate. AgentOS must also
clearly display when the data was last updated."*

| Data | Source of change | How often it reaches the screen | What the person sees |
|------|------------------|----------------------------------|----------------------|
| **Help requests (agent → team leader)** | an agent taps "Ask … for help" | **≤ 20 s** — the leader's page asks `/api/portal/help/pulse` every 20 s while visible, and at once when the tab comes back | a count icon on the Help Center tab; "new — not opened yet" / "seen" on each row |
| Help request status (agent's side) | the leader opens / marks done | when the agent opens My Progress (45 s cache) | "seen by … at …", then "Did … sort it out?" |
| Performance figures (sales, GWP, talk, QA, attendance) | the daily exports, uploaded to the VAS Upload Station | PULSE publishes the digest ~2.5 s after each upload and every 90 s while open; the Worker re-reads it within a minute | — |
| Team leader + campaign manager pages | the digest above | every **120 s** while visible, on focus (30 s apart), and the Refresh button | "Numbers updated …" + freshness dot |
| **Agent's own page** | the digest above | every **5 min** while visible, and when the tab comes back (30 s apart) — was: once at sign-in | one quiet line: **"Figures to <last data day> · updated <date time>"** (D2) |
| Agent List / roster, logins, campaigns | an Agent List upload | Worker cron every 10 min; PULSE + Ops sync every 10 min and on focus | receipt toast in the station |
| Coaching (Hub) | coaching sessions | Worker cron every 20 min | "Coaching is showing an older copy" (leaders only) |
| Lake loads, NBA republish, relay | large files, the weekly review | local tick every 15 min, Mon–Fri 06:00–20:00 SAST | settings page |

Budget note (Cloudflare Worker free plan, 100k requests/day): ~10 leaders × 3 pulses/min × 9 h ≈ 16k;
~130 agents × 12/h × 9 h ≈ 14k on the busiest possible day (every agent's tab visible all day) — both
bounded by "visible only". The pulse is one database read and never calls HighLevel except its one
self-check per beat.
