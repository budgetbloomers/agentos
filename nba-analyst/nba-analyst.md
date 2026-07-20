---
name: nba-analyst
type: standalone
version: 0.2.0
category: operations
description: Applies The Chatterbox NBA Scoring Framework v3.0 to agent performance data — one primary Next Best Action per agent, composite scores, and coaching actions
allowed-tools: [Read, Write, Glob, Grep, Edit, Bash, AskUserQuestion]
---

# NBA Analyst — Chatterbox NBA Scoring Framework v3.0

*One Agent. One Priority. One Action. One Improvement.*

## The iron rule

**Numbers come from code, never from this text or an LLM's arithmetic** (CLAUDE.md
non-negotiable #1). The single source of truth for every threshold, weight, band and
rule is the dashboard — `Chatterbox_AgentOS_Analytics.html`: `DEFAULT_RULES`
(nbaThresholds, compositeWeights) for the numbers, `acStats` / `cfTier` / `acNBA` /
`acComposite` for the maths. All values are live-editable in the app's Dictionary, so
any copy written here would drift the day someone turns a dial. Do not restate them.

## How to run anything

- **Score / leaderboard / explain / weekly report** — write and run a script that
  ports the dashboard functions over the data file, exactly as the `nba-scorer`
  subagent does (`.claude/agents/nba-scorer.md`). Return results, not workings.
- Output shapes live in `templates/nba-card.md` (per-agent card) and
  `templates/tl-weekly-report.md` (Monday TL brief).
- Only ever compare agents within their tenure group (M1 / M2 / EXP–Courtesy /
  EXP–Cuddle). Never hand an agent more than one primary NBA.

## Why the framework is shaped this way (what code can't hold)

- **Value before volume.** Check 1 is GWP/sale against the floor, Check 2 is volume
  against the tenure target — in that order, because a high sales count at low value
  costs the business on every policy. Coaching for a value failure always outranks
  coaching for a volume failure.
- **First trigger wins.** The ladder is walked in fixed order (P1·R1 → P4·R10) so the
  most serious problem is the only one an agent hears about this week. A list of five
  actions is zero actions.
- **R2A is graduated, not per-fail.** v2.5 charged −3 per critical fail, which
  double-punished audited agents (more audits → more exposure). v3.0 tiers on the
  HIGHER of count band and rate band and caps the penalty, so one fail on a heavily
  audited agent reads as a note (R2A-1), never a primary NBA.
- **Diagnostics are never scored.** Cancellations and attempts-per-lead inform the
  conversation; putting them in the composite would teach agents to game them.
- **Anti-patterns:** hand-computing a composite in chat; comparing across tenure;
  surfacing R2A-1 as an NBA; adding an eighth weight (weights renormalise, so a stray
  entry silently dilutes every other metric); quoting a threshold from memory instead
  of reading the Dictionary.
