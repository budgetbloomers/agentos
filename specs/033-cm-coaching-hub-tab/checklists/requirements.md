# Specification Quality Checklist: 033 — the Coaching Hub, exactly as it is, as a campaign manager tab

**Purpose**: Validate spec.md before build. **Created**: 2026-10-13 · **Revised**: 2026-10-13 (exact-interface decision)

## Content Quality

- [x] States the decision plainly: the live Hub runs inside the tab; not a copy, not a link
- [x] Explains why not a native rebuild (source unavailable, drift) in research R2
- [x] Written for Nick: sidebar order, what he sees on click, what never changes
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No open questions remain (scope = the whole Hub; edit/delete = whatever the Hub does; colours = campaign manager
  palette via a Hub-side theme, token table in R9)
- [x] The one external dependency is named: the Hub's repository for the colour theme (WP-B); WP-A does not wait
- [x] Every FR maps to a guard (contracts § G) or the real-browser smoke
- [x] Success criteria measurable (flows completed in-tab, state survives re-render, byte-identical other views)
- [x] Edge cases: frame refused later, storage partitioning, PDF download, phone
- [x] Scope bounded: two files; Worker, Hub, data untouched; no secret stored
- [x] The Convex deploy key Nick pasted is explicitly NOT used and NOT stored; rotation recommended

## Feature Readiness

- [x] Two user stories, independently testable
- [x] Constitution Check passes with one documented exception (a single `frame-src` origin), recorded for CLAUDE.md +
  constitution
- [x] Release, live check and rollback in quickstart.md

## Notes

- Verified 2026-10-13: Hub response headers carry no frame restriction; `site/_headers` has no `frame-src`; the Hub's
  source is not on this machine.
