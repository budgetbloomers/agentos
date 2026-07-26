# AgentOS verification suites

Browser-level checks for the whole suite — every number asserted against
hand-computed expectations (the maths is verified by code, per the project's
non-negotiable #1). All suites run headless Chromium via `playwright-core`
against hermetic copies of the apps (local JS libs, no CDN, no network).

## Run

    cd diagnostics
    npm install          # playwright-core + papaparse + chart.js (libs only; no browser download)
    npm run all          # every suite, ~4 minutes

Chromium is resolved from `/opt/pw-browsers` (CI/sandbox); override with
`CBX_CHROME=/path/to/chrome`. Generated files land in `.work/` (gitignored).

## Suites

| Suite | Command | What it proves |
|---|---|---|
| Ops golden (95 asserts) | `npm run ops-golden` | Every KPI formula, NBA ladder R1–R10, R2A tiers/caps, composite renormalisation + penalty, BI money to the cent (VAT identity), lead dedupe, conversion split, attendance codes, exceptions, session isolation, masking, and six RUNTIME rule-edit liveness flips. |
| Upload merge (33 asserts) | `npm run merge` | Idempotent re-uploads (byte-identical AND renamed files), overlap dedupe, QA record update-in-place, BI span replace + GWP stability, attendance employee-day supersede, all-page render sweep, worker-parse path. `node harness.js baseline` compares against `git show HEAD` when you want before/after timings. |
| Ask widget | `npm run widget` | Both widgets render markdown-lite answers (bold/lists/tables/headings/code) from a stubbed `/api/ask`; injection payloads stay inert text. |
| PULSE golden | `npm run pulse` | The frozen workbook engine via `window.__mtd`: unique-account sales, ex×1.15 GWP, talk/QA aggregates, idempotent re-ingest, global-filter maths, removeFile overlap safety, digest coverage, all-tab sweep. Fixtures are synthetic — see `nicks_code/diagnostics/verify.mjs` for the original (stale) workbook-file harness. |
| Tracker smoke | `npm run tracker` | Pre-hydrate save queue + flush, honest save status, single-flight hydrate, dirty-guard on background refresh, in-code Attendance %/SPD, vt-mtd seed banner + filtered totals + auth-gate include. |

Run these after ANY change to the dashboard, PULSE, Tracker, the widgets, or
`tools/prepare-site.js`, and before `/deploy`.
