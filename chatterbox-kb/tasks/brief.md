<purpose>
Produce a usable Chatterbox operating asset — brief, dashboard spec, register, plan, pack section — grounded in retrieved modules and structured by the approved agent output template.
</purpose>

<user-story>
As a Chatterbox executive, I want operating assets with clear decisions, controls, dependencies and next actions, so that outputs drive execution instead of adding generic advice to a pile.
</user-story>

<when-to-use>
- Drafting an operating asset: exec brief, system acceptance pack, register, campaign plan, dashboard spec, investor/client pack section
- Turning a red metric or open decision into an actionable document
- Entry point routes here via /chatterbox-kb brief
</when-to-use>

<context>
@../context/kb-state.md
</context>

<references>
@../frameworks/retrieval-protocol.md (before retrieval)
@../data/modules/08_GOVERNANCE_RISK_AI_AND_CONTROLS.yaml (for the output template, owner model and controls)
@../data/modules/10_OPEN_DECISIONS_AND_SOURCE_RULES.yaml (for conflicts and critical inputs touching the asset)
</references>

<steps>

<step name="scope_the_asset" priority="first">
Pin down what is being produced.

1. Ask (if not stated): asset type, audience (EXCO / MANCO / investor / client / internal builder), decision it must enable, and deadline.
2. Note the sensitivity: investor/client-facing assets must pass tasks/validate.md before release.

**Wait for scope confirmation.**
</step>

<step name="retrieve_grounding">
Retrieve the module(s) the asset depends on per retrieval-protocol.md, plus module 10 for any conflicts or critical inputs in scope. List the facts used with their statuses before drafting, so the grounding is visible.
</step>

<step name="draft_asset">
Draft using @../templates/operating-asset.md.

1. Fill all required sections: role, objective, context, inputs, assumptions, tasks, deliverables, acceptance criteria, risks, dependencies, decisions required, output format.
2. Every issue raised uses: issue | impact | evidence | owner | action | due | escalation.
3. Owners come from module 03 by ID — respect boundaries (e.g. P02 designs mechanisms but is not the daily administrator; recruitment execution is P06 under P05).
4. Label every number: actual / target / forecast / model / proposed. Use [INPUT REQUIRED] for gaps; keep the gap list at the end so it doubles as a data request.
5. Language rules: seat "contribution", not EBITDA, unless reconciled; no adoption claims from deployment links; executive, direct, no filler.
</step>

<step name="review_and_deliver">
Validate against `agent_validation_checklist.before_recommending` in @../data/modules/10_OPEN_DECISIONS_AND_SOURCE_RULES.yaml (add `before_publishing_or_external_use` if external-facing).

Present the asset and its [INPUT REQUIRED] list.

Ask: "Ready to finalize, or adjust scope/sections?"

**Wait for approval or revision requests.**
</step>

</steps>

<output>
The operating asset (templates/operating-asset.md format), in-chat and optionally written to a user-named file, with a visible grounding list and [INPUT REQUIRED] register.
</output>

<acceptance-criteria>
- [ ] Asset uses the required output template sections
- [ ] Every owner is a module 03 identity respecting role boundaries
- [ ] Every number labelled actual/target/forecast/model/proposed; no invented figures
- [ ] Red issues use the issue | impact | evidence | owner | action | due | escalation format
- [ ] Prohibited language avoided (EBITDA before tie-out, unsupported claims)
- [ ] External-facing assets flagged for tasks/validate.md before release
- [ ] User approved final output
</acceptance-criteria>

