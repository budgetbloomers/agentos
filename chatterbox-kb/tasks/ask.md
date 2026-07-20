<purpose>
Answer a question about The Chatterbox by identifying the domain, retrieving only the required knowledge-base module(s), and responding with status tags, module citations, conflict flags and [INPUT REQUIRED] markers.
</purpose>

<user-story>
As a Chatterbox executive or builder, I want grounded answers with the fact's status and source visible, so that I can act on them without re-verifying and never mistake a model for an actual.
</user-story>

<when-to-use>
- Any factual question about The Chatterbox
- Grounding another workflow (dashboard, agent, document) in canonical facts
- Entry point routes here via /chatterbox-kb ask
</when-to-use>

<context>
@../context/kb-state.md
</context>

<references>
@../frameworks/retrieval-protocol.md (before retrieval — module map and rules)
@../data/modules/10_OPEN_DECISIONS_AND_SOURCE_RULES.yaml (when a fact may be conflicted or missing)
</references>

<steps>

<step name="identify_domain" priority="first">
Classify the question.

1. Map the question to one or more domains using the module map in retrieval-protocol.md.
2. If the question is ambiguous between domains, ask one clarifying question rather than loading everything.
3. Check kb-state.md for session-ingested facts that touch the question.

**Wait for clarification only if the domain is genuinely ambiguous.**
</step>

<step name="retrieve_modules">
Load only the identified module file(s) from ../data/modules/.

1. Read the relevant module(s) and locate the specific entries (use entity IDs: P##, SYS-###, D##, dashboard/adapter names).
2. Note each fact's status (confirmed / model / proposed / historical / conflict / input_required).
3. If any retrieved fact appears in module 10's known_conflicts, load module 10 and apply its stated treatment.
</step>

<step name="compose_answer">
Answer using @../templates/answer-brief.md.

1. Lead with the direct answer in executive language.
2. Tag every material figure or claim with its status; never present model/proposed as actual.
3. Cite the module (and entity ID) for each material claim.
4. Missing facts: `[INPUT REQUIRED: what is needed]` — never fabricate.
5. Conflicts: name both sources, the module 10 treatment, and which figure is safe to use for which purpose.
6. If the answer surfaces a red issue, add the issue line: issue | impact | evidence | owner | action | due | escalation.
</step>

<step name="review_and_deliver">
Validate against `agent_validation_checklist.before_answering` in @../data/modules/10_OPEN_DECISIONS_AND_SOURCE_RULES.yaml, then deliver.

Ask: "Does this answer it, or should I go deeper on any point?"

**Wait for follow-up or confirmation.**
</step>

</steps>

<output>
An answer brief (templates/answer-brief.md format): direct answer, status-tagged claims with module citations, conflict flags, and an [INPUT REQUIRED] list if facts are missing. In-chat.
</output>

<acceptance-criteria>
- [ ] Only the required module(s) were loaded (layered retrieval respected)
- [ ] Every material claim carries a status tag and module citation
- [ ] No model/proposed/historical fact presented as a current actual
- [ ] Conflicts flagged with module 10 treatment, never silently blended
- [ ] Missing facts returned as [INPUT REQUIRED], not invented
- [ ] kb-state.md checked for overriding session facts
</acceptance-criteria>

