<purpose>
Gate a claim, document or output against the TCB-KB-V3 validation rules — fact status, source priority, name/role corrections, prohibited language and approval requirements — before internal sign-off or external use.
</purpose>

<user-story>
As a Chatterbox executive, I want drafts checked against the canonical rules before they circulate, so that no unsupported claim, misattributed owner or unreconciled number reaches staff, clients or investors.
</user-story>

<when-to-use>
- Before publishing or sending anything external (client, investor, public content)
- Before an internal document becomes a decision input
- Spot-checking a specific claim ("can we say X?")
- Entry point routes here via /chatterbox-kb validate
</when-to-use>

<context>
@../context/kb-state.md
</context>

<references>
@../frameworks/retrieval-protocol.md (for status and source-priority rules)
@../data/modules/10_OPEN_DECISIONS_AND_SOURCE_RULES.yaml (validation checklist, conflicts, source priority)
@../data/modules/07_FINANCE_ECONOMICS_AND_SCALE.yaml (when the draft contains economics — language rules)
</references>

<steps>

<step name="receive_draft" priority="first">
Obtain the draft/claim and its intended audience (internal / client / investor / public). Audience determines which checklist tiers apply.

**Wait for the draft.**
</step>

<step name="verify_claims">
Check every material claim.

1. Trace each claim to its module; record status. Claims with no KB support are marked UNSUPPORTED.
2. Check module 10 known_conflicts — any conflicted figure must show the approved treatment (e.g. conservative for diligence).
3. Check name/role corrections: Nicholas Pillay is CTTO (never Chief Growth and Transformation Officer); Claudell Panday spelling; Abigail owns recruitment execution; Tiara superseded; COO unresolved unless kb-state.md records signed evidence.
4. Check prohibited language: "EBITDA" for seat contribution before tie-out; adoption/control/value claims based on deployment links; client names/results without approved evidence; guaranteed returns.
5. Check PII and confidential economics exposure against the audience.
</step>

<step name="apply_gate">
Run `agent_validation_checklist` in @../data/modules/10_OPEN_DECISIONS_AND_SOURCE_RULES.yaml — the tier(s) matching the audience (`before_answering`, `before_recommending`, `before_publishing_or_external_use`).

For external use also confirm: Risk (P04) approval needed for compliance claims; Finance (P03) approval for economics; legal entity, client permission and brand assets verified — mark each as CONFIRMED or [INPUT REQUIRED].
</step>

<step name="report_verdict">
Deliver the verdict table: claim | module/source | status | verdict (PASS / FIX / REMOVE / NEEDS-APPROVAL) | required fix or approver.

Overall verdict: RELEASABLE / RELEASABLE-WITH-FIXES / BLOCKED, with the shortest path to release.

**Wait for the user to accept fixes or dispute a verdict.**
</step>

</steps>

<output>
A validation report: per-claim verdict table, overall release verdict, required approvals and fixes. In-chat, optionally saved alongside the draft.
</output>

<acceptance-criteria>
- [ ] Every material claim traced to a module or marked UNSUPPORTED
- [ ] Conflicted figures show the module 10 treatment
- [ ] Name/role corrections enforced
- [ ] Prohibited language flagged with replacements
- [ ] External assets show Risk/Finance approval status
- [ ] Clear overall verdict with the path to release
</acceptance-criteria>

