# Implementation Plan: Wimpy sign-in needs the person's password

**Branch**: `009-wimpy-password-signin` | **Date**: 2026-10-06 | **Spec**: [spec.md](spec.md)

## Summary

The Wimpy sign-in (`POST /api/wimpy/signin`, `worker/src/auth.mjs signinByCb`) stops accepting a CB number alone. It
runs the SAME password check as the main sign-in — one account lookup, one PBKDF2 verify, one append-only lockout, one
audit log — and only then mints the session it mints today (`app_sessions.scope = 'wimpy'`, confined to `/api/wimpy/*`).
`login()`'s lookup and password/lockout steps are lifted into shared helpers so the two sign-ins cannot drift; `login()`'s
behaviour is unchanged (its suites stay green untouched). The page gains a password field. Old password-less sessions
are deleted at release (migration-053).

## Technical Context

**Language/Version**: ESM Worker (`worker/src/auth.mjs`, `index.mjs`); ES5 single-file page (`wimpy/index.html`); SQL
migration. **Storage**: existing `app_users`, `app_sessions`, `auth_log` — no new column, no new table.
**Testing**: new `verify-wimpy-signin.mjs` (drives the real sign-in against a mocked database with real PBKDF2 hashes);
extend `verify-wimpy.mjs` (page + static checks); `verify-login-lockout.mjs`, `verify-password-lifecycle.mjs`,
`verify-agent-portal.mjs` stay green. **Platform**: FREE plan 10 ms CPU — PBKDF2 at 100k iterations already runs in
`login()` on every sign-in, so the Wimpy sign-in costs the same as a main sign-in.

## Research (from the code, 2026-10-06)

- R1 `login()` (auth.mjs:61) already does everything the Wimpy sign-in now needs: CB spellings → `cbNNN`, username first
  then the `cb` column (Dalwin: `dalwin` / CB145), active check, `locked_until`, PBKDF2 verify, failures counted per
  `user_id` from `auth_log` since the last `login_ok` (cannot race), `failed_attempts` kept for the admin screens.
- R2 `signinByCb` (auth.mjs:203) looks up `cb` first then `username`, checks `active` and `apps ∋ 'wimpy'`, rate-limits
  per typed value and per IP (10 / 10 min, events `wimpy_signin_fail`), mints `scope:'wimpy'` for 12 h. Nothing outside
  auth.mjs reads `wimpy_signin_fail` (grep, 2026-10-06).
- R3 The scope fence (index.mjs:629) and `/api/me` + `/api/logout` above it are unchanged — the session is the same.
- R4 `app_sessions` rows carry `scope`; deleting `scope = 'wimpy'` rows ends every lunch session and nothing else.
- R5 The page (`wimpy/index.html` `loginScreen`) posts `{cb}`; a cached copy will keep posting `{cb}` with no
  `password` key after release — the Worker can tell that apart and ask for a reload.

## Contracts

- **C1 request** `POST /api/wimpy/signin {cb, password}` (`cb` may be a CB number in any spelling or a username;
  `username` is accepted as an alias of `cb`, as today).
- **C2 answers** (status · error), checked in this order:
  1. no `password` key at all → 400 · "Wimpy now asks for your password too — reload this page (Ctrl+Shift+R) to sign in."
  2. `cb` or `password` empty → 400 · "Type your CB number and your password."
  3. `cb` over 40 or `password` over 200 characters → 400 · "That is too long to be a CB number or password."
  4. ≥ 100 Wimpy sign-in failures from this IP in 10 min (30 before the security review) → 429 · "Too many wrong sign-ins from this network. Wait ten
     minutes and try again." (no lookup)
  5. no account / inactive → 401 · "That CB number and password do not match." (failure logged, awaited)
  6. locked → 423 · "Account locked after repeated failures. Try again in a few minutes." (same words as the main sign-in)
  7. wrong password → 401 · same words as 5; counts toward the shared lock (≥ 5 since the last success in 15 min → 15 min)
  8. right password, no `wimpy` app → 403 · "Your account cannot order from Wimpy yet — ask your team leader." (not a
     password failure; no session)
  9. right password → 200 `{token, user:{username, full_name, role, cb, scope:'wimpy'}}`; lockout counters reset.
- **C3 audit events** (`auth_log.event`, never a password): Wimpy failures `login_fail:wimpy:no_user|disabled|bad_password`
  (prefix `login_fail` → they count toward the account lock exactly like main-sign-in failures); `locked:wimpy`;
  `wimpy_signin_refused:no_app`; success `login_ok:wimpy`. The lock count stops at the last `login_ok` or `login_ok:…`
  — NOT at the old `wimpy_signin_ok`, which proved no password. Readers that count `event = 'login_ok'` exactly (health
  sentinel, the agent sign-in report, migrations 015/021) are untouched: a lunch sign-in is not an Analytics sign-in.
  The IP limit counts `event like 'login_fail:wimpy:%'` per IP.
- **C4 page** two fields — `#cb` (CB number; "Managers: type your username here.") and `#pw` (`type=password`; "The
  password you use for Agent Analytics."); foot: hours + "Forgotten your password? Ask your team leader or manager to
  reset it."; an empty field is marked and nothing is sent; a refusal re-shows the card with the CB kept and the password
  cleared.
- **C5 migration-053** `delete from app_sessions where scope = 'wimpy'` + the `scope` column comment reworded (no longer
  "CB-only"). Idempotent in effect: re-running only signs lunch users out.

## Constitution Check

| Principle | Status |
|---|---|
| I Engine decides | N/A — no figure changes |
| V Locked down | PASS — the one sign-in that skipped the password now uses the suite's own PBKDF2 + lockout; the scope fence is unchanged; no password is logged; enumeration stays closed (one answer for unknown/inactive/wrong) |
| VI Saves acknowledged | N/A |
| VII Guards | PASS — new suite + extended `verify-wimpy`, red first; registered in verify.yml |
| Delivery order | DEVIATION (justified) — see Complexity Tracking |

No constitution amendment: Principle V already says the suite sits behind its own login with lockout on every page;
this removes the one exception. CLAUDE.md's `wimpy/` row is corrected (it states the old "no password" rule).

## Project Structure

```text
worker/src/auth.mjs       findAccount() + checkPassword() lifted out of login(); signinByCb → signinWimpy (C1–C3)
worker/src/index.mjs      route calls signinWimpy; comments + the 410 wording ("CB number and password")
wimpy/index.html          C4 (two fields, hints, CB kept on refusal); header comment
supabase/migration-053-wimpy-password.sql   C5
nicks_code/diagnostics/verify-wimpy-signin.mjs   NEW — C1–C3 against a mocked DB, shared lock with login()
nicks_code/diagnostics/verify-wimpy.mjs          page: password field, both fields sent, empty refused; static names
nicks_code/diagnostics/verify-agent-portal.mjs   F6 comment only (route list unchanged)
.github/workflows/verify.yml                     register verify-wimpy-signin
CLAUDE.md (wimpy/ row) · specs/wimpy-vas-apps-plan.md + specs/wimpy-3331-menu.md (superseded note)
```

## Complexity Tracking

| Deviation | Why | Simpler alternative rejected because |
|---|---|---|
| Release order Worker → migration-053 → Pages leaves a minute where an open old page posts `{cb}` | The Worker must refuse CB-only first, or sessions cleared by the migration could be re-minted without a password | Pages first would leave the old Worker signing people in by CB alone after the new page shipped; the old page instead gets C2.1's "reload" message, so the gap fails in words |
