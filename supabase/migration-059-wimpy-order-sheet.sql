-- migration-059 · wimpy_order_sheet — every Wimpy order, readable (Spec Kit 023, 2026-10-09)
--
-- Nick: "create a wimpy table in the supabase and let the order of the people show there". The orders already live in
-- wimpy_orders (migration-055, one row per order the kitchen accepted); this VIEW is the readable sheet over it: when
-- (SA time), who (the account's name and CB), what (the items in words), the total, the notes, and whether the order's
-- card reached the Wimpy HighLevel board — newest first. No phone numbers, no HighLevel ids.
--
-- Read it in Supabase → Table Editor → Views → wimpy_order_sheet, or: select * from wimpy_order_sheet limit 50;
-- Locked like every Wimpy object: nothing for anon/authenticated; service_role reads. Safe to re-run.
--   node tools/apply-migration.mjs supabase/migration-059-wimpy-order-sheet.sql

create or replace view wimpy_order_sheet as
select
  (o.placed_at at time zone 'Africa/Johannesburg')              as placed_sast,
  coalesce(u.full_name, '(account removed)')                    as person,
  o.cb                                                          as cb,
  (select string_agg((i->>'quantity') || ' × ' || (i->>'item'), ', ' order by t.ord)
     from jsonb_array_elements(o.items) with ordinality as t(i, ord))   as items,
  o.total                                                       as total_rand,
  o.notes                                                       as notes,
  case o.hl_state
    when 'written' then 'on the kitchen board'
    when 'pending' then 'card pending'
    when 'failed'  then 'card failed — retrying'
    else                'card stuck — needs attention'
  end                                                           as kitchen_board,
  o.placed_at                                                   as placed_at_utc,
  o.id                                                          as order_id
from wimpy_orders o
left join app_users u on u.id = o.owner_user_id
order by o.placed_at desc;

revoke all on wimpy_order_sheet from public, anon, authenticated;
grant select on wimpy_order_sheet to service_role;

comment on view wimpy_order_sheet is
  'Spec Kit 023: every Wimpy order in plain words, newest first — person, CB, items, total, notes, whether its HighLevel card landed. A view over wimpy_orders; nothing is copied.';
