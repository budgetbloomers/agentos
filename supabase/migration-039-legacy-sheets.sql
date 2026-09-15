-- migration-039-legacy-sheets.sql
-- A LEGACY SHEET IS NOT THE RECORD (2026-09-15). See the comment block inside publish_agent_list.
-- The function is restated whole (the live 020 body + one rule) so the repo carries exactly what runs.
CREATE OR REPLACE FUNCTION public.publish_agent_list(p_as_of date, p_rows jsonb, p_fingerprint text DEFAULT NULL::text, p_actor text DEFAULT 'system'::text, p_hashes jsonb DEFAULT '{}'::jsonb, p_apply boolean DEFAULT false, p_min_roster integer DEFAULT 25)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_asof     date  := coalesce(p_as_of, current_date);
  v_batch    text  := 'pub-' || to_char(clock_timestamp(), 'YYYYMMDD-HH24MISSMS');
  v_nraw     int;
  v_nok      int;
  v_roster   jsonb;
  v_dropped  jsonb;
  v_blank    jsonb;
  v_camps    jsonb;
  v_agents   jsonb := '{}'::jsonb;
  v_leaders  jsonb := '{}'::jsonb;
  v_camp     jsonb := '{}'::jsonb;
  v_need     jsonb := '[]'::jsonb;
  v_det      text;
  v_stage    text;
  v_inner    jsonb;
begin
  if jsonb_typeof(coalesce(p_rows, 'null'::jsonb)) is distinct from 'array' then
    return jsonb_build_object('status', 'FAILED', 'reason', 'rows_not_array', 'detail', 'the list is not an array of rows');
  end if;

  -- ------------------------------------------------------------ derive
  drop table if exists _pub_rows;
  create temp table _pub_rows on commit drop as
  with raw as (
    select t.ord::int                                                  as ord,
           btrim(coalesce(t.r->>'sheet', ''))                          as sheet,
           btrim(coalesce(t.r->>'code', ''))                           as code_raw,
           btrim(coalesce(t.r->>'name', ''))                           as name_raw,
           nullif(nullif(btrim(coalesce(t.r->>'sf', '')), '-'), '')    as sf,
           nullif(btrim(coalesce(t.r->>'tl', '')), '')                 as tl,
           btrim(coalesce(t.r->>'campaign', ''))                       as campaign_raw,
           nullif(btrim(coalesce(t.r->>'tenure', '')), '')             as tenure,
           nullif(btrim(coalesce(t.r->>'callx', '')), '')              as callx,
           case when (t.r->>'target') ~ '^[0-9]+(\.[0-9]+)?$' then (t.r->>'target')::numeric end as target,
           case when (t.r->>'start')  ~ '^\d{4}-\d{2}-\d{2}$'  then (t.r->>'start')::date    end as start_date
    from   jsonb_array_elements(p_rows) with ordinality as t(r, ord)
  )
  select ord, sheet, code_raw, name_raw, sf, tl, campaign_raw, tenure, callx, target, start_date,
         upper(regexp_replace(code_raw, '[^A-Za-z0-9]', '', 'g'))     as code,
         norm_cb(code_raw)                                             as cb,
         coalesce(sf, nullif(name_raw, ''))                            as name,   -- Sales Force is the join key (spec §3); Agent Name is the fallback
         campaign_label(campaign_raw, sheet)                           as campaign,
         false                                                         as accepted,
         null::text                                                    as why
  from   raw
  where  code_raw <> '' or name_raw <> '' or sf is not null;          -- an empty line is not a row

  update _pub_rows set why = case
      when cb is null or code !~ '^CB[0-9]+$' then 'no CB number'
      when name is null                        then 'no name'
    end
   where ord is not null;
  -- A LEGACY SHEET IS NOT THE RECORD (migration-039, 2026-09-15). The Agent List workbook
  -- carries frozen month-named tabs ("May", a Que-column snapshot) beside the live "VAS"/"VT"
  -- tabs, and PULSE posts every row of every sheet — the 3 Sep principle that stopped the
  -- "Download & Test" rows being dropped in the browser. But a legacy tab can spell a CB
  -- differently from the live tab (CB156: "Kasavani Snakarparsad" vs "Ashnee Kasavani
  -- Sankarparsad"), and the duplicate rule below then refused the WHOLE list — every upload
  -- from 10 to 14 Sep, five days on an 8 Sep roster, with a 20-second toast as the only sign.
  -- PULSE already ranks a month-named sheet below a live one and skips it; the server now
  -- applies the same judgement: when the post carries at least one live sheet, every row from
  -- a month-named or "SheetN" tab is dropped with its reason. A file that is ONLY a legacy
  -- sheet (an old-format list) is still taken whole.
  if exists (select 1 from _pub_rows where why is null
               and sheet !~* '^(january|february|march|april|may|june|july|august|september|october|november|december)$'
               and sheet !~* '^sheet\s*[0-9]+$') then
    update _pub_rows set why = 'legacy sheet (superseded by the live sheet)'
     where why is null
       and (sheet ~* '^(january|february|march|april|may|june|july|august|september|october|november|december)$'
            or sheet ~* '^sheet\s*[0-9]+$');
  end if;
  -- The same person listed twice with the same name collapses to the first row; the same
  -- CB with two different names is left in, and sync_agent_list refuses the list, named.
  update _pub_rows p set why = 'duplicate row'
   where p.why is null
     and exists (select 1 from _pub_rows o where o.why is null and o.cb = p.cb and o.name = p.name and o.ord < p.ord);
  update _pub_rows set accepted = (why is null) where ord is not null;

  select count(*), count(*) filter (where accepted) into v_nraw, v_nok from _pub_rows;

  select coalesce(jsonb_agg(jsonb_build_object('code', code, 'name', name, 'tl', coalesce(tl, ''), 'campaign', campaign,
           'tenure', coalesce(tenure, ''), 'callx', coalesce(callx, ''), 'sf', coalesce(sf, ''),
           'target', target, 'start', coalesce(to_char(start_date, 'YYYY-MM-DD'), '')) order by ord), '[]'::jsonb)
    into v_roster from _pub_rows where accepted;
  select coalesce(jsonb_agg(jsonb_build_object('sheet', sheet, 'row', ord, 'code', code_raw, 'name', coalesce(name, name_raw), 'why', why) order by ord), '[]'::jsonb)
    into v_dropped from _pub_rows where not accepted;
  select coalesce(jsonb_agg(code order by code), '[]'::jsonb)
    into v_blank from _pub_rows where accepted and campaign_raw = '';
  select coalesce(jsonb_agg(jsonb_build_object('label', c.campaign, 'agents', c.n) order by c.campaign), '[]'::jsonb)
    into v_camps from (select campaign, count(*)::int as n from _pub_rows where accepted group by campaign) c;

  if v_nok < p_min_roster then
    return jsonb_build_object('status', 'REFUSED', 'reason', 'roster too small', 'stage', 'derive',
      'on_file', v_nraw, 'on_roster', v_nok, 'min', p_min_roster, 'dropped', v_dropped,
      'detail', format('%s usable agent rows in a file of %s is below the floor of %s. Nothing was changed.', v_nok, v_nraw, p_min_roster));
  end if;

  -- The inner syncs create temp tables without drop-if-exists; a second publish inside one
  -- transaction (the verifier, a retry) must not trip over the first one's.
  drop table if exists _tl_on_list; drop table if exists _tl_create; drop table if exists _tl_remove; drop table if exists _camp_on_list;

  -- ------------------------------------------------------------ the three syncs, one transaction
  begin
    v_agents := sync_agent_list(v_asof, v_roster, v_batch, p_fingerprint, p_actor, p_hashes, p_apply, p_min_roster);
    if v_agents->>'status' not in ('SUCCESS', 'PLAN') then
      -- It wrote nothing (it clears its own staging; its own log row stands). NEEDS_HASHES
      -- in apply mode lands here too: the caller hashes and calls again.
      return jsonb_build_object('status', v_agents->>'status', 'stage', 'agents', 'as_of', v_asof,
        'on_file', v_nraw, 'on_roster', v_nok, 'roster', v_roster, 'dropped', v_dropped, 'campaigns_on_list', v_camps,
        'needs_hashes', coalesce(v_agents->'needs_hashes', '[]'::jsonb),
        'reason', coalesce(v_agents->>'reason', v_agents->>'status'), 'detail', v_agents->>'detail', 'agents', v_agents);
    end if;

    v_leaders := sync_team_leaders(p_hashes, p_actor, p_apply, p_min_roster);
    if v_leaders->>'status' = 'NEEDS_HASHES' and not p_apply then
      null;                                                -- a plan: the hashes it names are reported below
    elsif v_leaders->>'status' not in ('SUCCESS', 'PLAN') then
      raise exception using errcode = 'P0002', message = 'leaders', detail = v_leaders::text;
    end if;

    v_camp := sync_campaigns(p_actor, p_apply, p_min_roster);
    if v_camp->>'status' not in ('SUCCESS', 'PLAN') then
      raise exception using errcode = 'P0002', message = 'campaigns', detail = v_camp::text;
    end if;
  exception when sqlstate 'P0002' then
    -- EVERYTHING in the block is undone — the agents' creates, updates and removals too.
    get stacked diagnostics v_stage = message_text, v_det = pg_exception_detail;
    v_inner := v_det::jsonb;
    if p_apply then
      insert into agent_sync_logs (batch_id, as_of, fingerprint, status, initiated_by, errors, detail)
      values (v_batch, v_asof, p_fingerprint, 'REFUSED', p_actor, jsonb_build_array(v_stage || ': ' || coalesce(v_inner->>'reason', v_inner->>'status', '')),
              'Refused at the ' || v_stage || ' stage: ' || coalesce(v_inner->>'detail', v_inner->>'reason', '')
              || ' Nothing was changed — the previous list is still in force.');
    end if;
    return jsonb_build_object('status', v_inner->>'status', 'stage', v_stage, 'as_of', v_asof,
      'on_file', v_nraw, 'on_roster', v_nok, 'roster', v_roster, 'dropped', v_dropped, 'campaigns_on_list', v_camps,
      'needs_hashes', coalesce(v_inner->'needs_hashes', '[]'::jsonb),
      'reason', coalesce(v_inner->>'reason', v_inner->>'status'),
      'detail', coalesce(v_inner->>'detail', '') || ' Nothing was changed — the previous list is still in force.',
      v_stage, v_inner);
  end;

  -- ------------------------------------------------------------ the file, kept
  if p_apply then
    delete from agent_list_raw where as_of = v_asof;
    insert into agent_list_raw (as_of, batch_id, fingerprint, ord, sheet, code_raw, cb, code, name, sf, tl,
                                campaign_raw, campaign, tenure, callx, target, start_date, accepted, why)
    select v_asof, v_batch, p_fingerprint, ord, sheet, code_raw, cb, code, name, sf, tl,
           campaign_raw, campaign, tenure, callx, target, start_date, accepted, why
    from   _pub_rows;
  end if;

  v_need := coalesce(v_agents->'needs_hashes', '[]'::jsonb) || coalesce(v_leaders->'needs_hashes', '[]'::jsonb);

  return jsonb_build_object('status', case when p_apply then 'SUCCESS' else 'PLAN' end, 'as_of', v_asof, 'batch', v_batch,
    'on_file', v_nraw, 'on_roster', v_nok, 'roster', v_roster, 'dropped', v_dropped, 'blank_campaign', v_blank,
    'campaigns_on_list', v_camps, 'needs_hashes', v_need,
    'agents', v_agents, 'leaders', v_leaders, 'campaigns', v_camp, 'applied', p_apply);
end;
$function$
;
