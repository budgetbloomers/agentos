# Implementation Plan: Signed-in name from the session; list publish answers with its integrity

**Branch**: `011-signed-in-name-and-list-sync` | **Date**: 2026-10-07 | **Spec**: [spec.md](spec.md)

## Contracts

- **C1 Ops `whoAmI()`** → `CBX_USER.full_name || CBX_USER.username || ''`; `paintUser()` writes `#userNm` /
  `#userAv` from it (placeholder "Signed in" / "·" until known); called at every former paint site and on the
  auth-gate's `cbx-authed` event.
- **C2 Ops config** `cfgPayload()` drops `user`; `applyCfg()` never reads `cfg.user`; `state.user` is no longer a
  source of truth for anything shown or stamped.
- **C3 Ops batch** `uploaded_by: whoAmI() || 'unknown'`, plus `uploaded_by_username: CBX_USER.username`.
- **C4 tool** `tools/publish-agent-list.mjs --apply --as <username>`: looks the account up (active, not a portal role),
  mints the 5-minute session for THAT account; no `--as` → refuses before posting.
- **C5 Worker** `POST /api/roster` accepted → `integrity: {in_step, failures:[{check, n, severity}]}` from
  `agent_list_integrity` (failures > 0); a read error → `{in_step:null, error}`.
- **C6 stations** VAS `reportListPublish` and Ops `reportListPublish`: `in_step === true` → "In step with the list:
  N agents, leader logins and campaigns match."; `false` → red, naming each failing check and its count; `null` →
  "could not be confirmed".

## Constitution Check

| Principle | Status |
|---|---|
| III The Agent List is the record | PASS — the database's own integrity view decides "in step"; nothing re-derived in a page |
| V Locked down | PASS — identity comes from the session; the tool signs in as the named operator, never a stand-in |
| VII Guards | PASS — new verify-session-name (Ops VM), verify-roster-of-record §12 (integrity in the answer), red first |

## Project Structure

```text
Chatterbox_AgentOS_Analytics.html   C1–C3, C6 (Ops)
nicks_code/index.html               C6 (VAS)
worker/src/index.mjs                C5
tools/publish-agent-list.mjs        C4
nicks_code/diagnostics/verify-session-name.mjs      NEW — Ops in a VM: shared config with user 'Nick' never shows/stamps
nicks_code/diagnostics/verify-roster-of-record.mjs  §12 — integrity in the accepted answer
nicks_code/diagnostics/verify-ops-cas.mjs           D — the config merge no longer carries a name
```
