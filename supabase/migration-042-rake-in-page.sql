-- migration-042-rake-in-page.sql
-- THE RAKE WITHOUT A RUNNER (Nick, 2026-09-15: "i am not going to pay for github so make sure it
-- works, you have access to supabase to make changes as well").
--
-- The Data Rake's LOAD half was always SQL (rake_merge_* over unlogged staging, migration-028); only
-- the parse/transform ran in Node on the GitHub runner — and GitHub stopped starting runs. The
-- uploader's browser already holds the file, and the Ops app parses these very exports in the page,
-- so PULSE now parses a large file as it uploads it and hands the rows to Postgres in slices through
-- these functions. No machine in the middle. tools/rake.mjs is unchanged and still drains the queue
-- when a runner is on — a file the page loaded is 'loaded' and the queue skips it; a file the page
-- abandoned mid-load is put back on the queue (rake_page_abandon) or loads again on the next attempt.
--
--   rake_page_begin(file, source, sha, bytes)   claims the file, truncates the source's staging table
--   rake_page_stage(file, from, rows)           inserts one slice of canonical rows (_seq = from + n)
--   rake_page_merge(file, from, to)             merges one slice into the lake (the migration-028 merge)
--   rake_page_finish(file, rows_in)             batches row, upload_files loaded, staging truncated
--   rake_page_abandon(file, error)              back to 'received' and the queue

-- one row per source: which staging table, which merge function, in which column order
create table if not exists rake_page_contracts (
  source     text primary key,
  stage      text not null,
  merge_fn   text not null,
  lake_cols  text[] not null
);
insert into rake_page_contracts (source, stage, merge_fn, lake_cols) values
  ('SF_OPEN_CASES',    'rake_stage_sf_open',   'rake_merge_sf_open',   array['case_id','case_number','subject','opened_at','age_hours','account_name','account_number','case_owner','status','record_type','snapshot_date']),
  ('SF_CLOSED_CASES',  'rake_stage_sf_closed', 'rake_merge_sf_closed', array['case_id','case_number','subject','opened_at','closed_at','disposition','age_hours','account_name','account_number','case_owner','status','record_type']),
  ('BI_ACTIVE_CASES',  'rake_stage_bi',        'rake_merge_bi',        array['account_no','contract_status','account_name','contract_number','owner','contract_create_date','charge_amount','charge_code','product_bundle','merged_bundle','consultant','sales_vertical','case_number']),
  ('VICI_CALL_REPORT', 'rake_stage_vici',      'rake_merge_vici',      array['call_date','agent_login','lead_id','status','full_name','user_group','campaign_id','length_in_sec','status_name'])
on conflict (source) do update set stage = excluded.stage, merge_fn = excluded.merge_fn, lake_cols = excluded.lake_cols;
grant select on rake_page_contracts to service_role;

create or replace function rake_page_begin(p_file uuid, p_source text, p_sha text default null, p_bytes bigint default null)
returns jsonb language plpgsql security definer set search_path = public, pgmq as $$
declare c rake_page_contracts%rowtype; f upload_files%rowtype; d uuid; busy record;
begin
  select * into c from rake_page_contracts where source = p_source;
  if not found then return jsonb_build_object('ok', false, 'error', 'unknown source ' || coalesce(p_source, '')); end if;
  select * into f from upload_files where id = p_file;
  if not found then return jsonb_build_object('ok', false, 'error', 'unknown upload'); end if;
  if f.status = 'loaded' then return jsonb_build_object('ok', false, 'error', 'already loaded'); end if;
  -- the same bytes already loaded: say so, mark it, do not load twice
  if p_sha is not null then
    select id into d from upload_files where sha256 = p_sha and id <> p_file and status = 'loaded' limit 1;
    if d is not null then
      update upload_files set status = 'failed', error = 'duplicate of ' || d || ' (same bytes already loaded)', sha256 = null where id = p_file;
      return jsonb_build_object('ok', false, 'error', 'duplicate of ' || d || ' (same bytes already loaded)', 'duplicate', true);
    end if;
  end if;
  -- one load per staging table at a time (the runner and another tab share it)
  select id, file_name into busy from upload_files
   where source = p_source and status in ('loading', 'transforming') and id <> p_file
     and coalesce(validated_at, received_at) > now() - interval '30 minutes' limit 1;
  if busy.id is not null then
    return jsonb_build_object('ok', false, 'error', 'another file is loading into ' || p_source || ' (' || busy.file_name || ') — try again in a few minutes', 'busy', true);
  end if;
  execute format('truncate %I', c.stage);
  update upload_files set status = 'loading', source = p_source, sha256 = coalesce(p_sha, sha256), bytes = coalesce(p_bytes, bytes),
         validated_at = now(), attempts = attempts + 1, error = null, checkpoint = null, rows_loaded = 0, rows_rejected = 0
   where id = p_file;
  -- the runner must not pick this file up while the page is loading it
  perform pgmq.delete('ingest', q.msg_id) from pgmq.q_ingest q where q.message ->> 'file_id' = p_file::text;
  return jsonb_build_object('ok', true, 'stage', c.stage, 'cols', to_jsonb(c.lake_cols));
end $$;

create or replace function rake_page_stage(p_file uuid, p_from bigint, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c rake_page_contracts%rowtype; f upload_files%rowtype; n bigint; sel text;
begin
  select * into f from upload_files where id = p_file;
  if not found or f.status <> 'loading' then return jsonb_build_object('ok', false, 'error', 'file is not loading'); end if;
  select * into c from rake_page_contracts where source = f.source;
  if jsonb_typeof(p_rows) <> 'array' then return jsonb_build_object('ok', false, 'error', 'rows must be an array'); end if;
  -- rows arrive as arrays in lake_cols order; every value is text (the merge functions parse)
  select string_agg(format('nullif(r ->> %s, %L)', i - 1, ''), ', ') into sel from generate_subscripts(c.lake_cols, 1) i;
  execute format('insert into %I (_seq, %s) select %s + ord, %s from jsonb_array_elements($1) with ordinality as t(r, ord)',
                 c.stage, (select string_agg(quote_ident(x), ', ') from unnest(c.lake_cols) x), p_from, sel) using p_rows;
  get diagnostics n = row_count;
  update upload_files set rows_in = greatest(coalesce(rows_in, 0), p_from + n) where id = p_file;
  return jsonb_build_object('ok', true, 'staged', n, 'seq', p_from + n);
end $$;

create or replace function rake_page_merge(p_file uuid, p_from bigint, p_to bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c rake_page_contracts%rowtype; f upload_files%rowtype; m bigint; r bigint; b text;
begin
  select * into f from upload_files where id = p_file;
  if not found or f.status <> 'loading' then return jsonb_build_object('ok', false, 'error', 'file is not loading'); end if;
  select * into c from rake_page_contracts where source = f.source;
  b := 'rake:' || p_file;
  insert into batches (batch_id, source_type, source_system, uploaded_by, uploaded_at, file_name, file_hash, raw_rows, status, storage_path)
  values (b, f.source, 'rake-page', coalesce(f.uploaded_by, 'page'), now(), f.file_name, f.sha256, coalesce(f.rows_in, 0), 'loading', f.storage_bucket || '/' || f.storage_path)
  on conflict (batch_id) do update set raw_rows = excluded.raw_rows, status = 'loading';
  execute format('select merged, rejected from %I($1, $2, $3)', c.merge_fn) into m, r using b, p_from, p_to;
  update upload_files set rows_loaded = rows_loaded + m, rows_rejected = rows_rejected + r, checkpoint = jsonb_build_object('seq', p_to) where id = p_file;
  return jsonb_build_object('ok', true, 'merged', m, 'rejected', r, 'to', p_to);
end $$;

create or replace function rake_page_finish(p_file uuid, p_rows_in bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c rake_page_contracts%rowtype; f upload_files%rowtype; b text;
begin
  select * into f from upload_files where id = p_file;
  if not found or f.status <> 'loading' then return jsonb_build_object('ok', false, 'error', 'file is not loading'); end if;
  select * into c from rake_page_contracts where source = f.source;
  b := 'rake:' || p_file;
  update batches set loaded_rows = f.rows_loaded, rejected_rows = f.rows_rejected, raw_rows = p_rows_in, status = 'loaded' where batch_id = b;
  execute format('truncate %I', c.stage);
  update upload_files set status = 'loaded', loaded_at = now(), rows_in = p_rows_in, checkpoint = null where id = p_file;
  return jsonb_build_object('ok', true, 'rows_loaded', f.rows_loaded, 'rows_rejected', f.rows_rejected);
end $$;

-- a page that went away mid-load: back to the queue, so the next runner (or the next attempt) redoes it
create or replace function rake_page_abandon(p_file uuid, p_error text default 'page closed during load')
returns jsonb language plpgsql security definer set search_path = public, pgmq as $$
declare c rake_page_contracts%rowtype; f upload_files%rowtype;
begin
  select * into f from upload_files where id = p_file;
  if not found or f.status <> 'loading' then return jsonb_build_object('ok', false); end if;
  select * into c from rake_page_contracts where source = f.source;
  if c.stage is not null then execute format('truncate %I', c.stage); end if;
  update upload_files set status = 'received', error = left(p_error, 300), checkpoint = null, rows_loaded = 0, rows_rejected = 0 where id = p_file;
  perform pgmq.send('ingest', jsonb_build_object('file_id', p_file));
  return jsonb_build_object('ok', true);
end $$;

grant execute on function rake_page_begin(uuid, text, text, bigint) to service_role;
grant execute on function rake_page_stage(uuid, bigint, jsonb) to service_role;
grant execute on function rake_page_merge(uuid, bigint, bigint) to service_role;
grant execute on function rake_page_finish(uuid, bigint) to service_role;
grant execute on function rake_page_abandon(uuid, text) to service_role;
comment on function rake_page_begin(uuid, text, text, bigint) is 'In-page Rake (migration-042): the uploading browser parses the file and loads it through begin → stage… → merge… → finish; no runner needed.';
