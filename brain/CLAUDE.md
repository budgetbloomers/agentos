# ChatterboxOS Brain — the LLM Wiki

This folder is the persistent memory of the Chatterbox Agentic OS, following the LLM-wiki pattern (knowledge compiled once and kept current — never re-discovered per query). It is the markdown vault that syncs to R2 in Phase 5b and opens in Obsidian as the personal graph view.

## Session start (when working in this folder)
1. Re-read this file (the schema).
2. Read `hot.md` — current state of play (~500 words max). The session-start hook prints it automatically, and the Worker's `/api/ask` reads it from the `brain` bucket.
3. Need more? Glob the vault — it is small enough that the filesystem is the index. (There is no INDEX.md: a catalog of three files was pure overhead. If the vault ever grows past a few dozen pages, reintroduce one then.)

## Ownership (mirrors TCB-KB-V3 rules)

| Area | What | Who writes |
|------|------|-----------|
| `../uploads/` + `../chatterbox-kb/data/modules/` | Immutable sources (exports, the KB pack) | Human/system only — **never edited from here** |
| `Agents/` | One page per call-centre agent (Passport-lite), wikilinked to team, campaign, rules, reports | LLM/automation |
| `NBA-Reports/` | Weekly TL reports + NBA cards | LLM/automation (via /weekly-report) |
| `Actions/` | Action register entries: owner, due, evidence, escalation, closure | LLM drafts, humans close with evidence |
| `Decisions/` | Decision objects: issue, options, decider, rationale, evidence | LLM drafts, humans decide |
| `KB-Answers/` | Filed answers from KB queries, linked to cited modules | LLM |
| `hot.md` / `log.md` | Session cache (the state of play) and append-only audit log | LLM maintains |

## Conventions
- Link everything with `[[wikilinks]]` — `[[CB-97]]`, `[[P2-R4]]`, `[[2026-W29]]`, `[[Team-Sipho]]`. A link to a page that doesn't exist yet marks a page worth writing.
- Every operation appends one greppable line to `log.md`: `## [YYYY-MM-DD] <op> | <title>` — this is the evidence trail your governance model requires.
- PII discipline: agent pages use CB codes as filenames; masked names in prose unless the vault owner unmasks deliberately.
- Numbers in any page come from the NBA engine or the KB with status tags — same non-negotiables as the project root CLAUDE.md.
- After any batch of writes: refresh `hot.md` if the state of play moved, and append the `log.md` line.

## Three operations
1. **Ingest** — a weekly report, scoring run, closed action or KB answer lands → page written → related pages cross-linked → `log.md` line → `hot.md` refreshed if the state of play moved.
2. **Query** — read `hot.md` → Glob/Grep the vault → answer with citations → file good answers into `KB-Answers/`.
3. **Lint** — health check: contradictions between pages, stale claims (superseded by kb-state.md), orphan pages, agents with repeated rule-fires across weeks (coaching not landing — flag it).
