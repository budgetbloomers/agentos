# Duplicates — refused at the door, removed by the database, proven every night

*Nick, 8 September 2026: "if I upload files, are there duplicates?" and "I want a function in the database
to remove the duplicates if there are any." This is the standing answer.*

## 1 · What each upload path does with a repeat

| Path | Same file again | Overlapping export (e.g. 1–7 Sep then 1–14 Sep) | Repeated rows inside one file |
|---|---|---|---|
| **PULSE Upload Station** (`nicks_code/index.html`) | Content hash in the file registry (`S.files[].hash`); the re-upload is recognised and does not re-parse or re-add | Per-key supersede: a row for the same agent-day / case / contract replaces the earlier one; a narrower re-pull cannot wipe months it does not cover | Agent List: one row per employee code, the surplus is toasted; V01 fails the upload on a duplicate agent-day |
| **Ops Upload Station** (`Chatterbox_AgentOS_Analytics.html`) | Same hash for the same source = UPDATE of the earlier batch in place, never a second copy (the card says so before you confirm) | Record-key supersede per source; snapshot sources replace whole; BI replaces its own date span | In-file dedupe by record key, counted on the batch (`deduped_in_file`) |
| **Data Rake** (`tools/rake.mjs`) | sha256 of the bytes; a re-upload of loaded bytes fails once as `duplicate of <id>` and never retries | Keyed merges (`rake_merge_*`): the same case / call / charge line updates the existing row | `distinct on` the natural key inside every merge slice |
| **The lake** (Postgres) | Primary keys and the BI natural unique index make exact twins impossible | — | — |

## 2 · The database removes what slips through

Primary keys cannot stop a *semantic* twin — the same fact stored under two keys. `dedupe_lake()`
(migration-032) finds and removes those:

- **Closed cases** keyed under two closure days with the same true closure time (`closed_ts`), the class that
  once wrote 7,002 rows. Legacy rows without `closed_ts` are twins when opening time and disposition also
  match. A case with two *different* closure times is a re-closed case and is kept. Keeps the row with a
  `closed_ts`, then the most recently loaded.
- **Agent List** rows carrying one CB spelt two ways on the same dated list. Keeps the canonical spelling.
- **Batches** with the same bytes loaded twice for one source: older ones marked `superseded` (rows may
  reference them, so never deleted).
- **Rake files** with the same sha256 loaded twice: older ones marked failed as `duplicate of <id>`.
- **Two active logins on one CB number**: reported, never touched. Deactivating a sign-in is a person's call.

It runs after every Rake load, nightly at 02:40 SAST (pg_cron `dedupe-lake`), and on demand:

```sql
select dedupe_lake(false, 'me');   -- dry report: what would go
select dedupe_lake(true,  'me');   -- remove it
select * from dedupe_log order by ran_at desc limit 5;
```

Every run is logged in `dedupe_log` with the per-class counts and a sample of what was removed.

## 3 · The nightly proof

`diagnostics/verify-no-duplicates.mjs` reads the live stores and fails if anything is counted twice: every
lake table on its natural key, one agent per dated list, the same bytes never loaded twice, one active login
per CB and per username, the PULSE file registry, V01 on the live PULSE model (the deployed build driven
headlessly), and that `dedupe_lake()` applied within the last 26 hours. The Ops in-browser registry blob
(`kv:cb-audit`) is reported only: it still carries two July 2026 twins from before the Worker path, and the
rows themselves live in the lake, which is clean. `diagnostics/verify-rake.mjs` plants twins and proves the
function removes exactly those, inside a transaction that rolls back.

First live run, 8 Sep: 0 rows to remove. The two closed cases on two days (of 44,941) are genuine re-closures.
