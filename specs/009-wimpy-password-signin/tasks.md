---

description: "Task list — 009 Wimpy sign-in needs the person's password"
---

# Tasks: Wimpy sign-in needs the person's password

**Input**: spec.md, plan.md (contracts C1–C5). **Tests**: REQUIRED (Constitution VII), red first.

## Phase 1: Setup

- [x] T001 Baseline green: verify-wimpy, verify-login-lockout, verify-password-lifecycle, verify-agent-portal

## Phase 2: User Stories 1 + 2 — password required; guessing stopped (P1) 🎯 MVP

- [x] T002 [P] [US1] [US2] NEW nicks_code/diagnostics/verify-wimpy-signin.mjs driving the REAL auth.signinWimpy against a
  mocked DB with real PBKDF2 hashes: right CB + password → 200, scope 'wimpy' session row, `login_ok:wimpy`; CB-145 /
  cb 145 / 145 / username `dalwin` (cb CB145) all sign in; wrong password, unknown CB, inactive → the SAME 401 + words;
  no `password` key → 400 "reload"; empty field → 400 with zero lookups; over-long → 400; 5 wrong → locked, the 6th
  with the right password → 423 on Wimpy AND on login(); 3 Wimpy + 2 login() failures → locked; a success settles
  earlier failures; right password without the wimpy app → 403, no session, lock not advanced; 100 failures from one IP (30 before review)
  across CBs → 429 before any account lookup; no auth_log row or insert ever carries the password — RED (38 failed), GREEN 53/53
- [x] T003 [US1] [US2] worker/src/auth.mjs: lift `findAccount()` + `checkPassword()` out of login() (login unchanged);
  `signinWimpy()` per C1–C3 replacing signinByCb; lock count stops at `login_ok` or `login_ok:*` (not the old `wimpy_signin_ok`)
- [x] T004 [US1] worker/src/index.mjs: import + route call signinWimpy; comments; 410 wording
- [x] T005 T002 GREEN; verify-login-lockout, verify-password-lifecycle, verify-agent-portal still green

## Phase 3: User Story 3 — the page asks plainly (P2)

- [x] T006 [US3] nicks_code/diagnostics/verify-wimpy.mjs section M: one password field (type=password) labelled with
  "Agent Analytics"; managers' username line; forgotten-password line; no "no password" anywhere; pressing with the
  password empty sends nothing and marks the field; filled → the stub receives `{cb, password}`; a stubbed refusal
  shows its words, keeps the CB, clears the password. Section L: static names (signinWimpy, scope 'wimpy') — RED
- [x] T007 [US3] wimpy/index.html: C4 (fields, hints, foot, CB kept on refusal, header comment)
- [x] T008 T006 GREEN

## Phase 4: User Story 4 — old sessions end (P3)

- [x] T009 [US4] verify-wimpy-signin: supabase/migration-053-wimpy-password.sql deletes `scope = 'wimpy'` sessions and
  rewords the column comment (no "CB-only") — RED, then write the migration — GREEN

## Phase 5: Polish

- [x] T010 FR-013 wording: CLAUDE.md `wimpy/` row; superseded note in specs/wimpy-vas-apps-plan.md and
  specs/wimpy-3331-menu.md; verify-agent-portal F6 comment; register verify-wimpy-signin in .github/workflows/verify.yml
- [x] T011 Independent review (code + security: auth change); fixes red-first; full related suites green — 2026-10-06:
  no CRITICAL/HIGH. Fixed red-first: per-network limit 30 → 100 (30 could close lunch for a floor on one address;
  /api/login has no network cap, so a low one bought little); a password typed into the CB box is never logged as the
  username; the cursor returns to the password box after a refusal. Coverage added (passed at once — behaviour was
  right, unpinned): mock honours `order=at.desc`, fail-closed lock with auth_log down, ip on every row, `locked:wimpy`,
  ctx passed by the route. Not changed (pre-existing in login(), noted): parallel-burst race before the lock lands;
  unknown accounts skip PBKDF2 (timing); /api/login has no per-network cap. Suites: verify-wimpy-signin 59,
  verify-wimpy 182, verify-login-lockout 18, verify-agent-portal 86, verify-agent-analytics 169, all CI suites green
  except verify-variance (pre-existing) and verify-saturday-rule (flaky render timing — 33/33 on rerun, PULSE untouched
  apart from the Wimpy card text)
- [x] T012 Release — LIVE 2026-10-07: Worker 665a8f9a → migration-053 applied (0 wimpy sessions left) → Pages muxtsen8 → smoke green;
  (verify-cors-headers --live, verify-live-save --live) → sign in to /wimpy/ with a real CB + password
- [ ] T013 Commit (conventional), no push
