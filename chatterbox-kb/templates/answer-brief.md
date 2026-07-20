# Answer Brief Template

Output format for `/chatterbox-kb ask`. Keeps the response contract visible: status-tagged claims, module citations, conflicts flagged, gaps as [INPUT REQUIRED].

---

```template
## {question-restated-in-one-line}

**Answer:** [direct executive answer in 1–4 sentences]

### Supporting facts

| Claim | Status | Source |
|-------|--------|--------|
| [material claim or figure] | {confirmed / model / proposed / historical} | {module}: {entity-id-or-key} |

### Conflicts
[Only if applicable — name both figures/sources, the module 10 treatment, and which to use for which purpose. Omit section if none.]

### Missing inputs
- [INPUT REQUIRED: {exactly what is needed and who can supply it}]
[Omit section if none.]

### Red issue
[Only if the answer surfaces a red issue:]
{issue} | {impact} | {evidence} | {owner-id} | {action} | {due} | {escalation}
```

---

## Field Documentation

| Field | Convention | Notes |
|-------|-----------|-------|
| Status | Variable | One of the six pack statuses — never omit on figures |
| Source | Variable | Module short-name + entity ID (P##, SYS-###, D##) or YAML key |
| `[INPUT REQUIRED: …]` | Prose | Specific enough to act as a data request |
| Owner | Variable | Module 03 identity ID; never invent an owner |

## Section Specifications

- **Answer first** — the reader gets the conclusion before the audit trail.
- **Supporting facts table is mandatory** whenever the answer contains a number, name, status or commitment.
- **Conflicts and Missing inputs** sections appear only when non-empty — no empty scaffolding.
- Model/proposed figures must be visibly labelled inside the Answer sentence too, not only in the table.

