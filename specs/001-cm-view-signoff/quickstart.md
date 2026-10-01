# Quickstart — validate 001 CM view sign-off

Run from `agentos/`.

## 1. Credential-free (before deploy)
```bash
node nicks_code/diagnostics/verify-cm-digest.mjs        # WP1: closed leads, cycle payload, LM rule (new)
node nicks_code/diagnostics/verify-engine-rules.mjs     # MTD_RULES ⇔ spec drift incl. the LM rule
node nicks_code/diagnostics/verify-cm-signoff-worker.mjs # WP2: period/tenure, conv/talk/contact, scoping, cm-coaching, TL drill+coach (new)
node nicks_code/diagnostics/verify-coaching-wave.mjs    # WP2: budgeted chunks ≤ 35 calls, wave log, coaching-stale (new)
node nicks_code/diagnostics/verify-campaign-manager.mjs # existing CM suite still green
node nicks_code/diagnostics/verify-cm-view.mjs          # WP3: CM page — selectors, hours, wording, link, coaching page, 5 reports, TL MTD (new)
node nicks_code/diagnostics/verify-agent-analytics.mjs  # existing page suite still green
```
Expected: every suite exits 0.

## 2. Build, deploy, smoke
```bash
node tools/prepare-site.js
(cd worker && npx wrangler deploy)
npx wrangler pages deploy site --project-name chatterbox-agentos --branch main --commit-dirty=true
node nicks_code/diagnostics/verify-cors-headers.mjs --live
node nicks_code/diagnostics/verify-live-save.mjs --live
```

## 3. Live checks (after the tick republishes: live digest + cycle keys)
- `kv:agent-digest-cycle-2026-09` and `-2026-10` exist; live digest rows carry `closed`.
- As ryan and dalwin (temporary session, deleted after): Campaign tab — select Courtesy · M1 · Billing month;
  conversion basis "sales ÷ N closed leads"; talk "h m" vs "5 h"; contact rate shown; heading "Where my team
  leaders need help"; "Team leaders' coaching" above Sign out → Denise's sessions listed with the copy's age;
  Reports offers 5 tabs; Lead management has no Courtesy rows.
- `kv:coaching.fetchedAt` is today; `kv:coaching-wave-log` shows completed steps.
- `node nicks_code/diagnostics/verify-agent-card.mjs --live` still green.
