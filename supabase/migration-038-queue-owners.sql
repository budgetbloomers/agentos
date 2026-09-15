-- migration-038-queue-owners.sql
-- A QUEUE BY ANY OTHER NAME (2026-09-15).
--
-- rake_owner_kind() knew four queue names by exact match ('cuddle call', 'courtesy call',
-- 'vip welcome calls', 'ec3 welcome call'). Between 9 and 14 Sep Salesforce moved the whole
-- unallocated pool from the "Courtesy Call" queue into an owner named "Courtesy call- Panimax"
-- — 404,014 cases on the 14 Sep snapshot — and because that string is not on the list, every
-- one of them was classified 'agent', matched nobody on the Agent List, and was SHIPPED in the
-- Lead Management book: 465,986 "agent-held" rows instead of ~80,000, a 46 MB JSON the reader
-- could no longer return inside the statement timeout. The Lead Management tab kept the last
-- book it had and said nothing — exactly the failure the lake path was built to end.
--
-- The rule now reads the SHAPE, not a list: an owner whose name starts with "courtesy call" or
-- "cuddle call" (any spacing, any suffix such as "- Panimax") is a queue. A person on the Agent
-- List is "Name Surname - Team" and can never start with those words. The four exact names stay.
-- Existing rows are reclassified in place and the book is rebuilt.

create or replace function rake_owner_kind(p_owner text) returns text
language sql immutable as $$
  select case
    when coalesce(p_owner, '') = '' then null
    when lower(trim(p_owner)) in ('cuddle call', 'courtesy call', 'vip welcome calls', 'ec3 welcome call') then 'queue'
    when lower(trim(p_owner)) ~ '^(courtesy|cuddle)\s*call' then 'queue'   -- "Courtesy call- Panimax" and kin
    else 'agent' end;
$$;
comment on function rake_owner_kind is 'queue for the holding queues (exact names, or any owner starting "courtesy call"/"cuddle call" — Salesforce spawns suffixed pseudo-queues such as "Courtesy call- Panimax"); agent otherwise; null when blank.';

-- reclassify what is already in the lake (partitioned; the index on (snapshot_date, employee_code)
-- does not help here, so this is a scan of the affected partitions — done once)
update sf_open_cases
   set owner_kind = 'queue', employee_code = null
 where owner_kind = 'agent'
   and lower(trim(coalesce(case_owner, ''))) ~ '^(courtesy|cuddle)\s*call';

-- the book must be rebuilt from the reclassified rows: force it by clearing the freshness stamp
delete from lm_open_book_cache;
select lm_open_book_refresh();
