# Quickstart: validating feature 003

## Credential-free (CI)

```bash
node nicks_code/diagnostics/verify-coaching-signature.mjs   # the feature's suite (new)
node nicks_code/diagnostics/verify-agent-analytics.mjs      # page still parses, routes intact
node nicks_code/diagnostics/verify-live-month-page.mjs      # coaching views unchanged for other products
node nicks_code/diagnostics/verify-coaching-attribution.mjs
node nicks_code/diagnostics/verify-coaching-wave.mjs
```

Expected: all exit 0. Before the fix, `verify-coaching-signature` fails its signature, signed-state and formal-note
sections (red first).

## Read-only live check (no writes to the Hub)

```bash
node tools/audit-hub-signatures.mjs --since 2026-08-20
```

Expected before the fix: the 3 known new-view sessions (2 formal, 1 informal, Denise Haripersad) listed as unsigned.
After deploy, any NEW new-view session that was signed on the form must not appear.

## In the browser after deploy (team leader account)

1. Coaching Hub tab → Record a session → Formal Coaching → choose an agent, fill one call note and Support provided,
   draw both signatures → Save session.
2. "Your sessions": the new row's Notes shows the support provided; the row reads "Signed by agent and team leader".
3. Open the record in the Hub app: both signatures render.
4. After the next coaching copy (≤ 2 h), the agent's coaching card shows "What was discussed" with the call note.
