# TL Weekly Report Template

Output of `/nba-analyst report` — the Monday review view. One row per agent, colour-coded by priority Level, sorted RED → AMBER → BLUE → GREEN. Output file naming (when saved): `nba-report-{team}-{week}.md`.

---

```template
# Weekly NBA Report — {team-name} · Week of {monday-date}

**Period:** {period} · **Working days:** {working-days} · **Agents:** {agent-count}

## Priority Summary

| Level | Colour | Count |
|-------|--------|-------|
| L1 Protect the Business | 🔴 RED | {count-l1} |
| L2 Protect the Revenue | 🟠 AMBER | {count-l2} |
| L3 Improve the Skill | 🔵 BLUE | {count-l3} |
| L4 Develop & Recognise | 🟢 GREEN | {count-l4} |

## Agent Rows

| ⬤ | Agent | Tenure | NBA | Reason | Action | Owner | Due | Success Measure | Review | Status |
|---|-------|--------|-----|--------|--------|-------|-----|-----------------|--------|--------|
| {colour} | {agent} | {group} | {rule-code} {rule-name} | [trigger with actual numbers] | [framework action] | {owner} | {due} | [clearing value] | {review-date} | {status} |

## Compliance Flags (R2A-1 notes — not primary NBAs)

- {agent}: 1 critical fail, CFR {cfr}% — coaching note in weekly 1:1; −2 composite; Elite retained.

## Carry-Forward Decisions

| Agent | Last week's NBA | Resolved? | Decision |
|-------|-----------------|-----------|----------|
| {agent} | {rule-code} | {yes/no} | {clear / escalate} |
```

---

## Field Documentation

| Field | Convention | Notes |
|-------|-----------|-------|
| `{colour}` | Variable | 🔴 / 🟠 / 🔵 / 🟢 per Level |
| `{rule-code}` | Variable | From the Decision Ladder only |
| `[Reason]` | Prose | Trigger with the agent's actual values |
| `{owner}` / `{due}` | Variable | `[TL to assign Monday]` when not yet set |
| `{status}` | Variable | new / open / carried-forward / escalated |

## Section Specifications

- **One row per agent** — a second issue for the same agent is by definition lower priority and is NOT shown (Golden Rule 1); it will surface when the primary clears.
- **Sort order is priority, not alphabet** — the TL's eye lands on RED first.
- **Carry-Forward Decisions** implements the rhythm: clear the NBA if resolved, escalate if not.

