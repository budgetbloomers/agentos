-- migration-024 — the upload manifest is appended atomically, never read-modify-written.
--
-- WHY (Tuesday 2026-09-08): Ashton dropped five files into the VAS Upload Station within
-- five seconds (07:19:47 → 07:20:22 SAST). Each archive POST read kv:upload-manifest, pushed
-- its entry and wrote the whole list back; three of them overlapped and the ViciDial call
-- report's entry lost — its 5 MB blob sat in raw/uploads/ with no manifest row, so the Ops
-- dashboard never relayed Monday's calls. The endpoint's own comment had called this out as a
-- "KNOWN LIMIT … last writer wins" since August. It is not a limit any more: one statement,
-- under the row lock, appends the entry; a second caller waits and appends after it.
--
-- Called by the Worker (/api/upload-archive) and by its cron reconciler, which lists
-- raw/uploads/ and re-adds any blob the manifest lost. Shape of a file entry is unchanged:
--   {n: filename, h: sha256 hex of the bytes, s: bytes, at: ISO timestamp}
-- newest first, capped at 1000 (a file evicted from the manifest is unreachable by the relay).

create or replace function upload_manifest_add(
  p_name  text,
  p_hash  text,
  p_size  bigint,
  p_at    timestamptz default now(),
  p_actor text default 'relay'
) returns text
language plpgsql
as $$
declare
  v      jsonb;
  files  jsonb;
  entry  jsonb;
begin
  if p_name is null or length(trim(p_name)) = 0 then raise exception 'upload_manifest_add: name required' using errcode = 'P0001'; end if;
  if p_hash is null or p_hash !~ '^[0-9a-fA-F]{8,64}$' then raise exception 'upload_manifest_add: hash must be 8–64 hex characters' using errcode = 'P0001'; end if;

  entry := jsonb_build_object('n', p_name, 'h', p_hash, 's', coalesce(p_size, 0), 'at', to_char(coalesce(p_at, now()) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));

  -- lock the row so two archivers serialise instead of overwriting each other
  select value into v from rules where key = 'kv:upload-manifest' for update;

  if v is null then
    insert into rules (key, value, updated_by, updated_at)
      values ('kv:upload-manifest', jsonb_build_object('files', jsonb_build_array(entry)), p_actor, now());
    return 'added';
  end if;

  files := coalesce(v -> 'files', '[]'::jsonb);
  if exists (select 1 from jsonb_array_elements(files) f where f ->> 'h' = p_hash) then
    return 'dupe';
  end if;

  files := jsonb_build_array(entry) || files;
  -- keep the newest 1000 in order
  select coalesce(jsonb_agg(x order by i), '[]'::jsonb) into files
    from jsonb_array_elements(files) with ordinality t(x, i)
   where i <= 1000;

  update rules
     set value = jsonb_set(v, '{files}', files),
         updated_by = p_actor,
         updated_at = now()
   where key = 'kv:upload-manifest';
  return 'added';
end;
$$;

-- test cleanup only: remove one entry by hash (the blob is the caller's business)
create or replace function upload_manifest_remove(p_hash text) returns integer
language plpgsql
as $$
declare
  v     jsonb;
  files jsonb;
  n0    integer;
  n1    integer;
begin
  select value into v from rules where key = 'kv:upload-manifest' for update;
  if v is null then return 0; end if;
  files := coalesce(v -> 'files', '[]'::jsonb);
  n0 := jsonb_array_length(files);
  select coalesce(jsonb_agg(x order by i), '[]'::jsonb) into files
    from jsonb_array_elements(files) with ordinality t(x, i)
   where x ->> 'h' <> p_hash;
  n1 := jsonb_array_length(files);
  if n1 <> n0 then
    update rules set value = jsonb_set(v, '{files}', files), updated_at = now() where key = 'kv:upload-manifest';
  end if;
  return n0 - n1;
end;
$$;

grant execute on function upload_manifest_add(text, text, bigint, timestamptz, text) to service_role;
grant execute on function upload_manifest_remove(text) to service_role;
