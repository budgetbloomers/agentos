# Implementation Plan: 038 — the Wimpy Order SOP

**Date**: 2026-10-16 | **Spec**: [spec.md](spec.md)

## Approach

1. **Research (read-only)**: the nine Wimpy specs, `wimpy-service/README.md`, `src/wimpy.mjs` (WINDOW, ITEMS, BIG_ONES,
   MAX_QTY, refusal wording, formatOrder, whoIsOrdering, submitWimpyOrder), `src/auth.mjs` (lock, network guard, session
   hours, start password, password rules), `src/wimpy-hl.mjs` (stages, MAX_TRIES, backoff, "Not on the kitchen board
   yet"), `public/index.html` (screens, wording, brand tokens), `worker/src/health.mjs` (alerts), memory notes.
2. **Write** `wimpy-sop.html`: one self-contained HTML file, print CSS (A4, page breaks, running footer), the brand tokens,
   an inline SVG roundel (the app's favicon, enlarged) for the cover.
3. **Render** with Playwright's Chromium (resolved from `nicks_code/diagnostics/node_modules`): `page.pdf({format:'A4',
   printBackground:true, displayHeaderFooter:true, footerTemplate})` → `Downloads\Wimpy Order SOP v1.0.pdf`.
4. **Check**: open the PDF pages (Read) — cover, document control, TOC, a table page, the troubleshooting matrix, the
   quick card; fix layout faults; re-render.
5. **Evaluate**: `ecc:agent-evaluator` scores the document; act on any accuracy finding.

## ECC components chosen

| Component | Why |
|---|---|
| `/ecc:prompt-optimizer` | Asked for; turned the request into scoped requirements |
| Spec Kit (this folder) | Asked for; the SOP is a controlled document, so it gets a spec and a task list |
| gstack `make-pdf` | Evaluated (cover/TOC/footer) — rejected for this job: fixed theme, no brand palette or font |
| Playwright Chromium (`page.pdf`) | Full control of colours, fonts, cover and footer; already installed |
| `ecc:agent-evaluator` | The one ECC agent whose job is scoring a finished deliverable |

## Risks

- A fact in the SOP drifts from the code later (a price, the window). Mitigation: the SOP names its sources and the
  change-control section makes "update SOP-WIMPY-001" a step of every Wimpy release.
- Google Fonts unreachable at render time: Nunito falls back to Segoe UI; the layout does not depend on it.
