# Operating Asset Template

Output format for `/chatterbox-kb brief` — the pack's required agent output structure (module 08, agent_output_template). Output file naming (when saved): `{asset-type}-{topic}-{date}.md`.

---

```template
# {Asset Title}

**Audience:** {EXCO / MANCO / investor / client / internal} · **Date:** {date} · **Status:** {draft / for-approval / approved}

## Role
[who this asset speaks as / is prepared by]

## Objective
[the decision or outcome this asset must enable — one sentence]

## Context
[relevant canonical facts, each with status tag and module citation]

## Inputs
[data/documents used, with source-priority rank]

## Assumptions
[every assumption labelled: model / proposed / configurable — none silent]

## Tasks
[the work this asset commissions or describes]

## Deliverables
[concrete artefacts with owners and dates]

## Acceptance Criteria
- [ ] [verifiable criterion]

## Risks
{risk} | {impact} | {evidence} | {owner-id} | {action} | {due} | {escalation}

## Dependencies
[systems (SYS-###), people (P##), decisions or data this depends on]

## Decisions Required
| Decision | Accountable decider | Options | Recommendation | Evidence needed |
|----------|--------------------|---------|----------------|-----------------|

## Output Format
[where this asset lives and how it is maintained]

## [INPUT REQUIRED] Register
- [INPUT REQUIRED: {gap} — {who can supply it}]
```

---

## Field Documentation

| Field | Convention | Notes |
|-------|-----------|-------|
| Owner IDs | Variable | Module 03 identities (P01–P20); respect role boundaries |
| Risk lines | Prose | Always the 7-part issue format from the bootstrap contract |
| Assumptions | Prose | Every number labelled actual / target / forecast / model / proposed |
| Decisions Required | Table | Decider comes from module 03 decision_rights, not convenience |

## Section Specifications

- **All twelve sections are required** (module 08 agent_output_template). Write "None" rather than deleting a section — reviewers scan for the headings.
- **Language rules:** seat "contribution" not EBITDA before tie-out; no adoption claims from deployment links; direct executive tone.
- **The [INPUT REQUIRED] Register doubles as the data request** — specific enough to hand to the named owner.

