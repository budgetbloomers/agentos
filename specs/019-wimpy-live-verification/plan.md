# Implementation Plan: live Wimpy verification (019)

**Spec**: spec.md · **Date**: 2026-10-09

One suite, `nicks_code/diagnostics/verify-wimpy-live.mjs`, in the suite's guard style (ok/head, non-zero exit on any
failure). Credentials from `agentos/supabase.env` (PostgREST, service key, Postgres URL) and `wimpy-service/.env`
(CRON_SECRET) — read from disk, never printed. The address is `WIMPY_URL` (default https://chatterbox-wimpy.vercel.app).

Sections: A (no credentials: health, page, headers, gates) · B (suite side: Worker 410s, Pages 302, a service session
refused by the Worker) · C (database: the migration-037 trigger via Postgres, `agent_list_integrity`'s Wimpy row via
PostgREST) · D (the throwaway person: created over PostgREST with a random password hashed by the service's own
`hashPassword`; sign-in wrong/right; me; menu; empty history; ONE order with notes "TEST - please ignore"; history after;
cron with the secret; logout; refused after) · E (cleanup in `finally`: the account's ledger rows, contact link and the
account — sessions cascade).

Constitution: V (nothing leaves the machine but the requests the page itself makes; secrets never printed); VII (this IS
the guard; it needs credentials so it is not in verify.yml, like the other live suites).
