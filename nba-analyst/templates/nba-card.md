# NBA Card Template

Per-agent output of `/nba-analyst score`. One card per agent — never more than one primary NBA (Golden Rule 1). Output file naming (when saved): `nba-{agent-id}-{period}.md`.

---

```template
## {agent-name} · {tenure-group} · {level-colour} LEVEL {level-number}

**Primary NBA:** {rule-code} — {rule-name}

| Field | Value |
|-------|-------|
| Issue | [plain-language statement of what triggered the rule, with the actual numbers] |
| Trigger data | {metric}: {actual-value} vs {threshold} |
| Two-Check status | {ON TARGET / VALUE ISSUE / VOLUME ISSUE / BOTH ISSUES} |
| Action | [the framework action for this rule, verbatim] |
| Owner | {owner-name-or-role} |
| Due | {due-date} |
| Target | [the specific metric value that clears this NBA] |
| Review | {review-date} |
| Status | {new / open / carried-forward} |

**Compliance flag:** [R2A-1 note if applicable — "1 critical fail, CFR {cfr}%, {tier-1-penalty} composite (nbaThresholds pen1), Elite retained, log in weekly 1:1" — otherwise omit this line]

**Composite:** {raw-composite} → Adj {adjusted-composite} ({r2a-tier})
```

---
