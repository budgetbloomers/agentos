-- migration-043-rake-health-stalled.sql
-- A LOAD THAT STOPPED HALFWAY IS A LOAD NOBODY IS DOING (2026-09-17 audit). Ashton's 16 Sep open-cases
-- file sat at 'loading' with 50,000 of 484,000 rows for 23 hours after the uploading tab went away;
-- rake_health counted only 'received' files as stuck, so no banner said so. A 'loading' record whose
-- claim is older than 30 minutes is stalled: counted here, named for the banner, and the Upload
-- Station's "Load from here" picks it up on its own from any open management tab.
create or replace function rake_health() returns jsonb
language sql security definer set search_path = public, pgmq as $$
  select jsonb_build_object(
    'received_stuck',  (select count(*) from upload_files where status = 'received' and received_at < now() - interval '1 hour'),
    'loading_stalled', (select count(*) from upload_files where status = 'loading' and coalesce(validated_at, received_at) < now() - interval '30 minutes'),
    'stalled_names',   (select coalesce(jsonb_agg(file_name order by received_at desc), '[]'::jsonb)
                          from (select file_name, received_at from upload_files
                                 where (status = 'loading' and coalesce(validated_at, received_at) < now() - interval '30 minutes')
                                    or (status = 'received' and received_at < now() - interval '1 hour')
                                 order by received_at desc limit 5) s),
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
comment on function rake_health() is 'Rake state for the health cron. failed_24h counts only failures a person must act on; duplicates and abandoned browser uploads are counted separately; loading_stalled = a page load that stopped over 30 minutes ago (any open Upload Station reloads it).';
