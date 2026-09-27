-- migration-050 · a new campaign is named as the Agent List names it, minus the house prefix (2026-09-27)
--
-- Nick: "if I upload an agent list and there are new campaigns it must be automatically created
-- in VAS month to date, weekly, daily … the campaign must be taken from the agent list."
--
-- The list spells every VAS campaign "Matrix VAS - <name>". The four known names fold to their
-- canonical token before the prefix matters, but a campaign the vocabulary does not know fell
-- through as the WHOLE cell — "Matrix VAS - Rewarded" — so the campaigns table, the CM view and
-- every PULSE tab/export would have carried the prefix while Courtesy and Cuddle did not.
--
-- The name is still the list's own: only a leading "Matrix VAS -" (or "VAS -") is removed, the
-- rest is kept verbatim (case, spaces, "&"). A cell that is nothing BUT the prefix keeps itself.
-- PULSE's campOf() strips the same prefix in the same order — change both together;
-- diagnostics/verify-new-campaign.mjs holds the pair to the same answer.
--
-- Safe on live data: as of 2026-09-23 every list row labels Courtesy / Cuddle / VT, all of which
-- match the vocabulary first, so no existing campaign key changes.
--
-- Apply: node tools/apply-migration.mjs supabase/migration-050-campaign-label-prefix.sql

create or replace function campaign_label(p_raw text, p_sheet text default null) returns text
language sql immutable as $fn$
  select case
    when coalesce(p_sheet, '') ~* '^\s*vt\s*$|vehicle|tracker' then 'VT'
    when x.s = ''                            then 'Courtesy'
    when x.s ~* 'nest'                       then 'Nesting'
    when x.s ~* 'cuddle'                     then 'Cuddle'
    when x.s ~* 'track|vehicle|vision|^vt$'  then 'VT'
    when x.s ~* 'courtesy'                   then 'Courtesy'
    when nullif(regexp_replace(x.s, '^(matrix\s+)?vas\s*[-–—:|]\s*', '', 'i'), '') is not null
                                             then regexp_replace(x.s, '^(matrix\s+)?vas\s*[-–—:|]\s*', '', 'i')
    else x.s end
  from (select regexp_replace(btrim(coalesce(p_raw, '')), '\s+', ' ', 'g') as s) x
$fn$;
comment on function campaign_label(text, text) is
  'The campaign a list row belongs to: PULSE''s campOf() vocabulary plus the VT-sheet fold; an unknown campaign keeps the list''s own name minus a leading "Matrix VAS -". The ONE place a row is classified.';

-- create or replace re-grants EXECUTE to public; migration-049's rule is that only the Worker's
-- service_role (and postgres) may call anything in public.
revoke execute on function campaign_label(text, text) from public, anon, authenticated;
