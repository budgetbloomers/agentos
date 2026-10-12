# Feature Specification: a Wimpy-only password (025)

**Created**: 2026-10-09 · **Input**: Nick: "the wimpy is now a dependant app so users must have access to change their password for this, so their agent os password will now be different from wimpy"

## Amendment (same day, Nick): "make their default password for wimpy, wimpy123 and they can change it to what they want after that"
Every account starts on the ONE start password `wimpy123` for Wimpy — the AgentOS password never opens lunch. `wimpy_password_hash` NULL = still on the start password; the page says so and nudges the person to choose their own. A team-leader reset (password_is_default → true) puts Wimpy back on `wimpy123`. The start password may not be chosen as the new one. Decided 1 below is superseded.

## Decided
1. ~~A person's Wimpy password starts as their AgentOS password~~ (superseded by the amendment: it starts as `wimpy123`). The moment they set a Wimpy password inside the app, Wimpy accepts only that one; AgentOS keeps its own. The two never sync.
2. One lock for both doors stays (five failures in fifteen minutes, counted on the account) — only the hash that is checked differs.
3. Forgot the Wimpy password: a team leader resets the AgentOS password as today (back to the start password); that reset also clears the Wimpy password, so both apps answer to the start password again until the person sets new ones.
4. Changing the Wimpy password ends every other Wimpy session of that account (the one that changed it stays signed in).

## Stories
- US1 (P1): signed in to Wimpy, a person opens "Change password", types the current one, a new one (10+ characters) twice, and from then on signs in to Wimpy with the new one; the AgentOS password is untouched.
- US2 (P1): wrong current password → refused and counted like a sign-in failure; new = current → refused; shorter than 10 → refused.
- US3 (P2): a new account from the Agent List signs in to Wimpy with the start password as before.

## Requirements
- FR-001 migration-060: app_users.wimpy_password_hash text null; trigger clears it when password_is_default becomes true.
- FR-002 sign-in uses wimpy_password_hash when set, else a hash of the start password `wimpy123` (never password_hash) — through the SAME shared checkPassword (drift guard green); sign-in and /me answer `wimpy_password_is_default`.
- FR-003 POST /api/wimpy/password {current, new}: verify current against the effective hash (a failure is logged as login_fail:wimpy:bad_password and counts toward the lock); new ≥ 10 chars, ≠ current, ≠ the start password; write wimpy_password_hash; delete the account's other wimpy sessions; log wimpy_password_change.
- FR-004 page: a Change password screen (ES5); the sign-in hint explains which password to use.
- FR-005 the Worker, the AgentOS password and /api/password are untouched.

## Success
- sign-in suite + page tests green; verify-wimpy-live proves change → old refused → new accepted → AgentOS hash unchanged.
