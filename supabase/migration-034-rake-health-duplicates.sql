-- migration-034 — a refused duplicate is a correct outcome, not something needing attention.
--
-- 2026-09-09: the health banner carried "Large-file uploads need attention: 1 failed in the last day
-- (sf closed 070926.xls)". That file failed because it was a re-upload of bytes already loaded, which
-- is the Rake working exactly as designed (migration-031: same bytes load once, and the second attempt
-- is refused immediately rather than retried). An alarm that fires on correct behaviour teaches people
-- to ignore alarms, which is the one thing the never-stale plan cannot afford.
--
-- So rake_health() now separates the two. `failed_24h` counts only files that failed for a reason a
-- person must act on — an unrecognised header, a broken read, a load that could not finish — and
-- `duplicates_24h` counts the refusals, reported but never alarming. The Large files card is unchanged:
-- it still shows every file with its own status and reason, because that IS the honest record.

create or replace function rake_health() returns jsonb
language sql security definer set search_path = public, pgmq as $$
  select jsonb_build_object(
    'received_stuck',  (select count(*) from upload_files where status = 'received' and received_at < now() - interval '1 hour'),
    'in_flight',       (select count(*) from upload_files where status in ('validated', 'transforming', 'loading')),
    'failed_24h',      (select count(*) from upload_files where status = 'failed'
                          and coalesce(error, '') not like '%duplicate of %'
                          and coalesce(loaded_at, received_at) > now() - interval '24 hours'),
    'duplicates_24h',  (select count(*) from upload_files where status = 'failed'
                          and coalesce(error, '') like '%duplicate of %'
                          and coalesce(loaded_at, received_at) > now() - interval '24 hours'),
    'failed_names',    (select coalesce(jsonb_agg(file_name order by received_at desc), '[]'::jsonb)
                          from (select file_name, received_at from upload_files
                                 where status = 'failed' and coalesce(error, '') not like '%duplicate of %'
                                   and received_at > now() - interval '24 hours' limit 5) f),
    'queue_depth',     (select coalesce(count(*), 0) from pgmq.q_ingest),
    'dlq_depth',       (select coalesce(count(*), 0) from pgmq.q_ingest_dlq),
    'last_run',        (select to_jsonb(r) from (select started_at, finished_at, ok, files_loaded, files_failed, rows_loaded, note
                                                   from pipeline_runs order by started_at desc limit 1) r)
  );
$$;
grant execute on function rake_health() to service_role;
comment on function rake_health() is 'Rake state for the health cron. failed_24h counts only failures a person must act on; a re-upload refused as a duplicate is counted separately in duplicates_24h and never raises the banner.';
