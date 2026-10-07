# Quickstart: validating feature 004

## Credential-free

```bash
node nicks_code/diagnostics/verify-coaching-drafts.mjs     # 004
node nicks_code/diagnostics/verify-coaching-signature.mjs  # 003
node nicks_code/diagnostics/verify-agent-analytics.mjs
node nicks_code/diagnostics/verify-live-month-page.mjs
node nicks_code/diagnostics/verify-coaching-attribution.mjs
node nicks_code/diagnostics/verify-help-repeat.mjs
```

## In the browser after deploy (a team leader account)

1. Coaching Hub tab → Record a session → Formal Coaching → choose an agent, type a call note → **Save draft**.
   The Drafts card lists it; nothing new in "Your sessions".
2. Sign out, sign in on another browser → open the draft → the note is there. Draw both signatures → Save draft.
3. Change one word → both signature boxes empty with the "signatures cleared" notice. Sign again → **Submit** → confirm.
4. The draft is gone; "Your sessions" shows the session as SUBMITTED, "Signed by agent and team leader", with no View
   and no notes. Open the agent's page from My Team: the coaching card lists the session with no written content.
5. Open the record in the Hub app (as Nick): both signatures and all text are there.
