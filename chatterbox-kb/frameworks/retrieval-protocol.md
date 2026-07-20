<retrieval_protocol>

## Purpose

How to retrieve from the TCB-KB-V3 pack: which module answers which domain, how to treat fact statuses, how to rank conflicting sources, and what to do when a fact is absent. Reference this before any retrieval — loading the wrong module wastes context; blending conflicting sources breaks trust.

Source of truth: The Chatterbox Agent Knowledge Base Pack v3.0, README + module 10.

## Layered Retrieval

1. **Bootstrap is always on** — `data/modules/01_BOOTSTRAP_ALWAYS_ON.yaml` (identity, strategy, canonical rules, response contract, status taxonomy) is loaded at activation and never re-retrieved.
2. **Identify the task domain, then retrieve only the required module(s)** — never paste the whole pack into context.
3. **Module 10 is always retrievable** — check it whenever a fact might be conflicted, superseded or missing.
4. **Check `context/kb-state.md` before answering** — session-ingested resolutions and supplied inputs override pack defaults per source priority.

## Module Map

The `<routing>` block in `chatterbox-kb.md` carries the module→domain map and does the actual @-loading — read it there, not here.

Cross-domain questions load two or three modules — e.g. "who signs off the QA system going live?" needs 05 (SYS-009 gate/owners) + 03 (decision rights).

## Status Taxonomy

Six statuses (`confirmed` · `model` · `proposed` · `historical` · `conflict` · `input_required`) — defined in `01_BOOTSTRAP_ALWAYS_ON.yaml` → `status_taxonomy`, which is always on and therefore already in your context. Every fact carries one; repeat it when citing the fact. Presentation rules live in the same file's response contract: never present a `model` as actual, name the approver on a `proposed`, apply module 10's treatment on a `conflict`, and return `[INPUT REQUIRED: what is needed]` on an `input_required`.

## Source Priority

The eight-level hierarchy (higher number loses) is `source_priority` in `data/modules/10_OPEN_DECISIONS_AND_SOURCE_RULES.yaml` — always retrievable, check it there.

**Rule:** when sources conflict, record the conflict and use the safest configurable assumption; never silently blend.

## Examples

**Correct retrieval:** "What's our contribution margin at 330 agents?" → load module 07 only. Answer with both figures labelled: 62.4% (stretch **model**) and the conservative base ~5.79m contribution (**proxy model**), noting the R42,500-vs-R34,762 revenue-per-agent **conflict** and module 10's treatment: conservative for diligence, stretch shown separately.

**Correct absence handling:** "What are our per-seat rates?" → module 02/09 both say `input_required` → answer `[INPUT REQUIRED: approved per-seat rates and inclusions]` — do not estimate.

**Wrong:** answering a people question from memory of module 03 without checking kb-state.md — a session may have recorded a resolved COO appointment (priority-1 signed evidence beats the pack).

## Anti-Patterns

| Anti-Pattern | Why it's wrong |
|--------------|----------------|
| Loading all modules for every question | The pack is token-optimised for one-domain retrieval; wholesale loading defeats the design |
| Presenting a `model` number as an actual | Breaks the response contract; economics may reach investors |
| Silently choosing between conflicting figures | Module 10 mandates recording the conflict and safest assumption |
| Filling a gap with a plausible number | "Never invent operating numbers" is a canonical rule; use [INPUT REQUIRED] |
| Treating a deployed URL as adoption/control/value evidence | A link proves deployment only (module 05 rule) |

## Source

The Chatterbox Agent Knowledge Base Pack v3.0 — 00_READ_ME_FIRST, 01_BOOTSTRAP, 10_OPEN_DECISIONS_AND_SOURCE_RULES. Internal use only.

</retrieval_protocol>

