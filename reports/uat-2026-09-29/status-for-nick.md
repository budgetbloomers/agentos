Subject: AgentOS priority sprint — status after the first fixes (29 Sep)

Hi Nick,

Consolidated status against your seven items. Everything marked Done is live and was tested on the live system.

1. Leave / attendance — DONE
Agents on annual leave were counted as absent, so their target grew and their attendance dropped. From 1 September, leave days (annual, sick, family responsibility, maternity, and half-days) no longer count as shifts: the target shrinks, attendance is not penalised, and Ops no longer flags "Zero Attendance – escalate to HR" for someone on leave. Agents see "Leave: N days — not counted as shifts".

2. Campaign attribution — DONE (two confirmations needed)
Joeline, Zandile, Nothando and Jamie Lee now show Download & Test (1–13 Sep) and Courtesy (from 14 Sep) separately, with the whole month as the total. Campaign managers see only the days worked on their own campaign.
Needed: Denise to confirm 14 Sep as the move date, and your/finance sign-off on how commission is paid for a split month. Agents currently see it clearly labelled as a projection. Download & Test also needs its own daily sales target set; until then those days use the Courtesy target.

3. KPI drill-down — DONE
An agent taps any KPI marked WATCH or FOCUS and sees: the KPI, their result, the target, what is driving it, what to do, and whether team-leader help is recommended, with a button that opens the help request on the right topic.

4. Help request error — DONE
Cause: our HighLevel setup allows one card per person, so anyone who had asked before got an error, which is what Joeline and Zandile hit. Fixed on 28 Sep. The full workflow now runs end to end: agent requests → request created → TL notified → TL acknowledges (opening it marks it seen) → action completed → agent confirms ("Yes, I was helped" / "Not yet"). Tested on the live system.

5. TL notifications — DONE
Team leaders get a red count on the Help Center tab within about 20 seconds of an agent asking, with no need to open the tab. It clears when they open the request, and the agent sees "seen by <TL> at <time>".

6. Data refresh — DONE
Agreed intervals: help requests within 20 seconds; team leader pages every 2 minutes; the agent's own page every 5 minutes (it previously never refreshed); performance data follows each daily upload. Agents now see "Figures to <day> · updated <time>".

7. UAT — READY
Josh has a 15-test checklist (owner, status, sign-off columns). Avesh can schedule round 2 with Denise, Dalwin and the four agents above.

Decisions I made on your behalf, for you to confirm: which leave codes count as excused (work-from-home is NOT treated as leave, so please confirm how WFH should count); the rule for recommending team-leader help (below target in 3 of the last 5 sessions, a gap needing more than 1.5× current pace, or QA under 80%); and the campaign split above.

Aarav
