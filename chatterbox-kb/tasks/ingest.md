<purpose>
Record new facts, conflict resolutions, supplied critical inputs or corrections into the knowledge base under source-priority rules — updating kb-state.md by default, and module files only with explicit user approval and a version note.
</purpose>

<user-story>
As the KB owner, I want new evidence captured with its source rank and effective date, so that the knowledge base stays current without silent edits or parallel sources of truth.
</user-story>

<when-to-use>
- The user supplies a fact that resolves an [INPUT REQUIRED] gap or a known conflict
- A signed decision supersedes a pack fact (e.g. COO appointed, pricing approved)
- A correction to a wrong or stale entry
- Entry point routes here via /chatterbox-kb ingest
</when-to-use>

<context>
@../context/kb-state.md
</context>

<references>
@../frameworks/retrieval-protocol.md (source-priority ranking)
@../data/modules/10_OPEN_DECISIONS_AND_SOURCE_RULES.yaml (known conflicts and critical-inputs registers)
</references>

<steps>

<step name="capture_the_fact" priority="first">
Capture the new information with full provenance.

1. Record: the fact, its source (document name/type), source-priority rank (1–8), effective date, and the owner who confirmed it.
2. If the source rank is 7 (conversation context) or 8 (assumption), label the fact accordingly — it does not override ranked documents.
3. Identify what it touches: which module, which known_conflict, which critical_input, or which existing fact it supersedes.

**Wait for provenance if the source is unclear — an unranked fact cannot be ingested.**
</step>

<step name="apply_update">
Write the update.

1. Default: append to kb-state.md under the matching section (Resolved Conflicts / Supplied Critical Inputs / Superseded Facts / New Facts), with fact, source, rank, effective date, and the module entry it affects.
2. If the new source outranks the pack entry, mark the pack fact `superseded` in kb-state.md — do not delete anything.
3. Module file edits (data/modules/*.yaml) only if the user explicitly asks to update the canonical pack: make the edit, bump a version note at the top of the module, and record the change in kb-state.md.
4. Never create a parallel record without an expiry/reconciliation note (canonical rule).
</step>

<step name="confirm_and_report">
Show the exact entry written, what it supersedes or resolves, and any downstream effects (e.g. "COO resolved → module 03 P18 vacancy note now superseded; validate.md checks will use the new owner").

Ask: "Recorded correctly? Anything else this evidence affects?"

**Wait for confirmation.**
</step>

</steps>

<output>
Updated context/kb-state.md (and, only on explicit request, a versioned module edit), plus a confirmation of what was resolved or superseded.
</output>

<acceptance-criteria>
- [ ] Fact recorded with source, priority rank, effective date and confirming owner
- [ ] Lower-ranked information never overrides higher-ranked entries
- [ ] Pack facts marked superseded, never silently deleted
- [ ] Module files untouched unless explicitly approved, with version note when edited
- [ ] User confirmed the recorded entry
</acceptance-criteria>

