-- migration-036 — an abandoned upload is not a failure a person must act on.
--
-- 2026-09-10: three rows sat at 'received' with no object in storage — /start had recorded them, the
-- browser PUT never finished, /complete never came. tools/rake.mjs now records such a row (an hour
-- after receipt, storage GET 400/404) as status 'failed' with an error starting "abandoned:", the
-- same way a refused duplicate is recorded. rake_health() leaves both out of failed_24h and out of
-- failed_names, counts them in their own fields, and the Large files card still shows each with its
-- reason — that is the honest record; the banner is for what needs a person.

create or replace function rake_health() returns jsonb
language sql security definer set search_path = public, pgmq as $$
  select jsonb_build_object(
    'received_stuck',  (select count(*) from upload_files where status = 'received' and received_at < now() - interval '1 hour'),
    'in_flight',       (select count(*) from upload_files where status in ('validated', 'transforming', 'loading')),
    'failed_24h',      (select count(*) from upload_files where status = 'failed'
                          and coalesce(error, '') not like '%duplicate of %'
                          and coalesce(error, '') not like '%abandoned:%'
                          and coalesce(loaded_at, received_at) > now() - interval '24 hours'),
    'duplicates_24h',  (select count(*) from upload_files where status = 'failed'
                          and coalesce(error, '') like '%duplicate of %'
                          and coalesce(loaded_at, received_at) > now() - interval '24 hours'),
    'abandoned_24h',   (select count(*) from upload_files where status = 'failed'
                          and coalesce(error, '') like '%abandoned:%'
                          and coalesce(loaded_at, received_at) > now() - interval '24 hours'),
    'failed_names',    (select coalesce(jsonb_agg(file_name order by received_at desc), '[]'::jsonb)
                          from (select file_name, received_at from upload_files
                                 where status = 'failed' and coalesce(error, '') not like '%duplicate of %'
                                   and coalesce(error, '') not like '%abandoned:%'
                                   and received_at > now() - interval '24 hours' limit 5) f),
    'queue_depth',     (select coalesce(count(*), 0) from pgmq.q_ingest),
    'dlq_depth',       (select coalesce(count(*), 0) from pgmq.q_ingest_dlq),
    'last_run',        (select to_jsonb(r) from (select started_at, finished_at, ok, files_loaded, files_failed, rows_loaded, note
                                                   from pipeline_runs order by started_at desc limit 1) r)
  );
$$;
grant execute on function rake_health() to service_role;
comment on function rake_health() is 'Rake state for the health cron. failed_24h counts only failures a person must act on; a re-upload refused as a duplicate (duplicates_24h) and a browser upload that never completed (abandoned_24h) are counted separately and never raise the banner.';
