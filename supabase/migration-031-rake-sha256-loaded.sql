-- migration-031 — a file's hash is unique among LOADED files, not among attempts.
--
-- upload_files.sha256 was unique across the whole table, so re-uploading a file whose earlier row was
-- left in any non-loaded state (a failed attempt, a rehearsal) made the runner's own bookkeeping raise
-- "duplicate key" at validate — the retry loop then burned three attempts on a constraint, never on
-- the file. The rule we want: two LOADED rows never share bytes (that is the duplicate the rake refuses
-- with a final error naming the earlier id); a failed or abandoned attempt may share its hash with the
-- attempt that finally succeeds.
alter table upload_files drop constraint if exists upload_files_sha256_key;
create unique index if not exists upload_files_sha256_loaded_uq on upload_files (sha256) where status = 'loaded';
comment on index upload_files_sha256_loaded_uq is 'Same bytes are loaded once. Non-loaded attempts may repeat a hash.';
