-- ============================================================
-- migration-007: make BI uploads idempotent by file.
-- Run once in: Supabase Dashboard → SQL Editor → New query → paste → Run
--
-- Problem seen in the field: the same Power BI file was uploaded 4 times (by a
-- second developer) and each load stacked another full copy into bi_active_cases
-- — 41,088 rows / ~4× the money — because the replace-then-insert of concurrent
-- uploads interleaved. The app's own copy (kv blob) stayed correct; only this
-- queryable table duplicated.
--
-- Fix: a partial unique index on (source_type, file_hash). A given file's hash can
-- exist on at most ONE batch record, so a second upload of the same file — even
-- from another machine, even racing — cannot create a second batch, and the Worker
-- skips its row insert. Months still ACCUMULATE: a genuinely new file (next month,
-- or a correction) has a different hash and loads normally, replacing its own span.
--
-- Safe to run repeatedly. There are currently no (source_type, file_hash) duplicates.
-- ============================================================

create unique index if not exists batches_source_filehash_uq
  on batches (source_type, file_hash)
  where file_hash is not null and file_hash <> '';

-- verify:
-- select indexname from pg_indexes where tablename='batches' and indexname='batches_source_filehash_uq';
