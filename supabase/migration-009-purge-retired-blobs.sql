-- ============================================================
-- migration-009: purge the retired money model's leftovers from the cloud.
-- Run once in: Supabase Dashboard → SQL Editor → New query → paste → Run
--
-- Non-negotiable #6: "One money model: Power BI - Active Cases... There is NO legacy
-- fallback. The old Activated-Services + GWP-table pricing was removed 2026-07; never
-- reintroduce it silently." The APP stopped reading these on 2026-07-15, but the cloud
-- copies were never removed:
--
--   kv:cb-facts-GWP_TABLE              3.0 KB — the retired GWP PRICE LIST, still intact.
--                                      purgeRetired() never touched it: RETIRED_SRC lists
--                                      only SF_ACTIVATED_SERVICES + SES_ACT_*, not this.
--                                      No SOURCES/TRANSFORM key reads it (verified 0 refs).
--   kv:cb-facts-SF_ACTIVATED_SERVICES  0 B — tombstone; purgeRetired wrote [] over it.
--   kv:cb-facts-SES_ACT_0800..1630     0 B — same, the 5 retired session slots.
--
-- KEPT DELIBERATELY: kv:cb-purged-activations. purgeRetired() reads it as its
-- "already done" marker (`if(await load('cb-purged-activations'))return 0;`). Deleting
-- it would make every client re-run the purge. It goes when RETIRED_SRC/purgeRetired
-- are deleted after 2026-08-15 (the block is time-boxed in the dashboard source).
--
-- Both halves must go: the pointer row in `rules` AND the object in Storage, or the
-- object is orphaned with nothing referencing it.
--
-- STORAGE HALF IS NOT SQL. Supabase blocks `delete from storage.objects`
-- (storage.protect_delete() -> 42501 "Direct deletion from storage tables is not
-- allowed. Use the Storage API instead."). The 7 objects were removed on 2026-07-17
-- via the Storage API with the service key:
--   DELETE {url}/storage/v1/object/raw/kv/cb-facts-GWP_TABLE            -> 200
--   DELETE {url}/storage/v1/object/raw/kv/cb-facts-SF_ACTIVATED_SERVICES -> 200
--   DELETE {url}/storage/v1/object/raw/kv/cb-facts-SES_ACT_{0800..1630}  -> 200 (x5)
-- If you are re-running this on a fresh restore, do the Storage half the same way
-- (or via the app's own Upload Station delete, which calls the Worker's /api/kv DELETE).
--
-- Safe to run repeatedly.
-- ============================================================

-- Pointer rows in `rules` (the SQL half)
delete from rules
 where key = 'kv:cb-facts-GWP_TABLE'
    or key = 'kv:cb-facts-SF_ACTIVATED_SERVICES'
    or key like 'kv:cb-facts-SES_ACT_%';

-- verify (both should return 0 rows):
-- select key from rules where key like '%GWP_TABLE%' or key like '%ACTIVATED%' or key like '%SES_ACT%';
-- select name from storage.objects where bucket_id='raw' and (name like '%GWP_TABLE%' or name like '%ACTIVATED%' or name like '%SES_ACT%');
-- and this one MUST survive:
-- select key from rules where key = 'kv:cb-purged-activations';
