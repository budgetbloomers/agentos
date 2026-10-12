# Implementation Plan: The refresh runs on a server (016)

**Spec**: [spec.md](spec.md) | **Date**: 2026-10-08

## Technical Context

Node 24 on Ubuntu 24.04 aarch64 (Oracle A1, 4 OCPU / 24 GB); Playwright Chromium (arm64 is supported on Ubuntu
22.04/24.04); a systemd timer; the existing `tools/tick-local.mjs` and its steps, unchanged in what they do. Supabase
PostgREST (`rules` table) for the shared lease. No paid service.

## Constitution Check

- **V Locked down by default** — a dedicated `runner` account; credentials 0600 owned by it; SSH key-only, no password
  login; no inbound port but 22.
- **VI Acknowledged / noticed** — every stamp names the machine; the existing freshness alerts are unchanged.
- **VII Every rule has a guard** — `verify-runner-016.mjs`, registered in verify.yml.

## Design

1. **Shared lease** (`tools/runner-lease.mjs`, new): a `kv:runner-lease` row in `rules`
   `{ holder, host, role, started_at, expires_at }`. Acquire = insert when absent, or a compare-and-set on `updated_at`
   when the current lease has expired; renewed on the existing 60-second heartbeat; released when the tick ends. The
   tick acquires it AFTER deciding to run; a held lease → one log line and an exit (no steps, no stamps).
2. **Roles**: `--role server` = primary (FR-001 rules: the full tick in working hours, referrals slots every day);
   `--role pc` (the default on Windows) = fallback only — runs only when the newest stamp is > 20 min old, or a
   referrals slot is due and unserved. Stamps carry `runner:"server:<host>"` or `"local:<host>"`.
3. **Linux**: runStep kills the process group (`detached: true` + `process.kill(-pid, 'SIGKILL')`); the local lock file
   lives in the OS temp dir; nothing Windows-only (wscript, taskkill) runs on Linux.
4. **Server setup** (`tools/runner/setup.sh`, idempotent, run once over SSH as the `ubuntu` user with sudo): apt
   baseline + unattended-upgrades; Node 24 (NodeSource); user `runner`; `/opt/agentos`; `npm ci` in the root and
   `nicks_code/diagnostics`; `npx playwright install --with-deps chromium`; TZ Africa/Johannesburg; a 4 GB swap file;
   systemd `agentos-tick.service` (oneshot, `TimeoutStartSec=45min`, `MemoryMax=16G`, `Nice=5`) and
   `agentos-tick.timer` (`OnCalendar=*:07,22,37,52`, `Persistent=true`, `RandomizedDelaySec=30`); logrotate for
   `reports/*.log`; ufw allowing 22 only.
5. **Release** (`tools/runner-deploy.mjs`, run on this PC): `git ls-files` (plus the built `site/`) → tar over `ssh`
   into a fresh release directory, then an atomic symlink swap of `/opt/agentos/current`; `--secrets` sends
   supabase.env, highlevel.env and wimpy-highlevel.env as 0600 owned by `runner`; `npm ci` only when a lockfile
   changed; prints the next run time. `--dry-run` lists what would be sent and never reads secret values.
6. **Hand-over**: one day side by side (PC as fallback) → with Nick's OK, `tools/install-local-tick.ps1 -Remove`.

## Project Structure

```text
tools/runner-lease.mjs                      NEW — the shared lease
tools/tick-local.mjs                        roles, the lease, the Linux kill path
tools/runner/setup.sh                       NEW — idempotent server setup
tools/runner/agentos-tick.service, .timer   NEW — systemd units
tools/runner-deploy.mjs                     NEW — release from this PC over SSH (no GitHub)
specs/016-server-refresh-runner/runbook.md  NEW — restart, re-send credentials, read logs, remove from the PC
nicks_code/diagnostics/verify-runner-016.mjs NEW guard; registered in .github/workflows/verify.yml
```
