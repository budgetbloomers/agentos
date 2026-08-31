-- ============================================================================
-- migration-016-key-contracts.sql
--
-- NO SCHEMA CHANGE. Two comments, both earned by measuring the live store, so the
-- next person to write a dedupe reads the reasoning off the table itself.
--
-- WHAT WAS CHECKED. Before building ingest-time deduplication, every source's
-- identity rule was counted against the live data. One of them looked wrong and
-- was not, and the near-miss is worth recording:
--
--   vici_calls' primary key is (call_date, agent_login, lead_id, status), and
--   `call_date` is a TIMESTAMPTZ — the full moment of the call, with call_day
--   carried separately for day-grain queries. Keyed that way all 29 315 live rows
--   are distinct and there is nothing to collapse. Keyed on the DAY instead — which
--   is how the column name reads at a glance, and how the blob's own `_d` field
--   would tempt an implementer to write it — 2 016 rows collapse. Those are not
--   duplicates: an agent who rings the same lead twice in a day and hangs up with
--   the same disposition has made two calls, each with its own length_in_sec, and
--   ViciDial talk time is the SUM of that column. A dedupe written on the day would
--   have deleted real minutes from real agents' talk time, which is a scored driver
--   on every rating.
--
--   specs/source_keys.json now records the measured distinct-count beside every
--   key, and diagnostics/verify-source-keys.mjs re-measures them, so a key can no
--   longer be asserted without evidence.
--
-- SAFE TO RUN TWICE — it only sets comments.
-- ============================================================================

comment on column vici_calls.call_date is
  'The FULL timestamp of the call, not the day (call_day is the day). It is part of the primary key for a reason: the same agent, lead and disposition recur legitimately within one day — 2 016 such rows in the live pull — and each carries its own length_in_sec. Keying this on the day collapses real calls and silently removes billable talk time.';

comment on index batches_source_filehash_uq is
  'One batch per (source_type, file_hash): re-uploading a byte-identical file is refused here rather than appending a second copy. Every source is expected to write a batch row carrying its file hash — before 2026-08-31 only BI reliably did, which is how seven copies of one closed-cases export reached the store as 141 535 rows carrying 35 463 cases.';
