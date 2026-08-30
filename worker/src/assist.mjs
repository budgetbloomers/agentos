/**
 * CAMPAIGN ASSISTANCE — the team-leader → campaign-manager pipeline.
 *
 * The third tier of one idea. An agent asks their team leader in the Agent
 * Help Center; a team leader asks their campaign manager HERE — a fifth
 * pipeline in the same HighLevel location, worked by Dalwin and Ryan. Same
 * hl() wrapper, same searchAll() truncation guard, same contactFor(), same
 * [tag] CBnn Name card grammar (help.mjs). Nothing new where something works.
 *
 * THE GOLDEN RULE, MADE STRUCTURAL (spec, rules.sla): acknowledging a request
 * is not assistance. Stage 2 (Triaged) holds the clock OPEN — classifying,
 * assigning an owner and booking a session all happen there and stop nothing.
 * Only the move to Assisting stamps the clock.
 *
 *   1 New                    clock running        (new)
 *   2 Triaged                clock STILL running  (triaged · assigned · booked)
 *   3 Assisting              clock stops here     (live · awaiting evidence)
 *   4 Awaiting confirmation                       (awaiting TL · awaiting agent)
 *   5 Follow-up due
 *   6 Closed                                      (resolved)
 *
 * WHERE THE MACHINE STATE LIVES. HighLevel carries the queue a human sees —
 * the card, its stage, its owner, its notes. The stamps and flags the SLA
 * maths needs (assistance_started_at, first_response_mins, within_sla, the
 * baseline, the gates) live in a MIRROR ROW per request: rules key
 * kv:cm-areq:<opportunityId> — the same one-row-per-thing pattern as
 * kv:help-contact:CBnn, and for the same reason (no shared blob to race on).
 * The list is then ONE HighLevel search plus ONE rules select, merged on id —
 * never a per-row fetch, which is what blows the 50-subrequest cap.
 *
 * STAMP THE CLOCK, NEVER INFER IT. lastStageChangeAt looks like it gives the
 * assistance-start moment for free — until the card moves again and it
 * silently becomes the wrong number. The Assisting transition writes the
 * stamps once; nothing recomputes them.
 *
 * RESTRICTED REQUESTS NEVER WRITE THEIR TEXT TO HIGHLEVEL. The CRM is not a
 * confidential store — anyone with access reads any note. A personal matter
 * shows its status, owner and clock; the description stays with the team
 * leader, by never being sent.
 *
 * DUPLICATES MERGE — deliberately the OPPOSITE of the Help Center's rule.
 * There, duplicates are the point (an agent asking twice is two real asks).
 * A team blocked twice on the same thing is one blockage, and counting it
 * twice would flatter the repeat rate.
 */

import { hl, searchAll, contactFor } from './help.mjs';
import { authorise, normCb } from './portal.mjs';
import { campKey, blockageOf, CM_SLA_DEFAULTS } from './campaign.mjs';

const PIPE = 'Campaign Assistance';
const STAGES = ['New', 'Triaged', 'Assisting', 'Awaiting confirmation', 'Follow-up due', 'Closed'];
const MK = 'kv:cm-areq:';

async function pipeline(env) {
  const c = globalThis.__cmPipe;
  if (c && Date.now() - c.t < 300000 && c.p) return c.p;
  const j = await hl(env, '/opportunities/pipelines?locationId=' + env.HL_HELP_LOCATION_ID);
  let p = (j.pipelines || []).find((x) => x.name === PIPE) || null;
  if (!p) {
    const made = await hl(env, '/opportunities/pipelines', { method: 'POST', body: JSON.stringify({
      locationId: env.HL_HELP_LOCATION_ID, name: PIPE,
      stages: STAGES.map((name, position) => ({ name, position })) }) });
    p = made.pipeline || null;
  }
  if (p) p.stages = (p.stages || []).slice().sort((a, b) => a.position - b.position);
  globalThis.__cmPipe = { t: Date.now(), p };
  return p;
}

/* All mirror rows in one select. `like` with * is PostgREST's wildcard. */
async function mirrors(DB) {
  const c = globalThis.__cmMir;
  if (c && Date.now() - c.t < 30000) return c.m;
  const rows = await DB.select('rules?key=like.' + encodeURIComponent(MK + '*') + '&select=key,value').catch(() => []);
  const m = {};
  for (const r of rows || []) m[r.key.slice(MK.length)] = r.value || {};
  globalThis.__cmMir = { t: Date.now(), m };
  return m;
}
async function writeMirror(DB, id, v) {
  await DB.insert('rules', [{ key: MK + id, value: v, updated_by: 'campaign-assist',
    updated_at: new Date().toISOString() }], true);
  const c = globalThis.__cmMir; if (c) c.m[id] = v;
}

/* [blockage] CBnn Team Leader Name · Campaign — parseable with the proven regex. */
const cardName = (bk, cb, name, camp) =>
  '[' + bk + '] ' + cb + ' ' + String(name).slice(0, 60) + ' · ' + String(camp).slice(0, 40);
function parseCard(o, stages) {
  const m = String(o.name || '').match(/^\[([^\]]+)\]\s+(CB\d+)\s+(.*?)\s+·\s+(.*)$/i);
  const si = stages.findIndex((s) => s.id === o.pipelineStageId);
  return { id: o.id, blockage: m ? m[1] : 'other', cb: m ? normCb(m[2]) : '',
    tl: m ? m[3] : '', campaign: m ? m[4] : '',
    contactId: o.contactId || (o.contact && o.contact.id) || '',
    stageIdx: si, stage: si >= 0 ? stages[si].name : '?',
    closed: (stages.length && si === stages.length - 1) || o.status === 'won',
    created: o.createdAt || o.dateAdded || '', updated: o.updatedAt || '' };
}

const slaTargetOf = (sla, priority) =>
  Number(sla[{ P1: 'p1_mins', P2: 'p2_mins', P3: 'p3_mins', P4: 'p4_mins' }[priority]]) ||
  Number(CM_SLA_DEFAULTS[{ P1: 'p1_mins', P2: 'p2_mins', P3: 'p3_mins', P4: 'p4_mins' }[priority]]) || 240;

/** The clock, read the only honest way: from the stamps. */
function slaOf(mir, sla, now) {
  const target = Number(mir.sla_target_mins) || slaTargetOf(sla, mir.priority || 'P3');
  const t0 = Date.parse(mir.requested_at || 0);
  const nearPct = (Number(sla.near_breach_pct) || 75) / 100;
  if (mir.assistance_started_at) {
    const fr = Number(mir.first_response_mins) || 0;
    return mir.within_sla
      ? { state: 'met', target, mins: fr, label: fr + ' min to first assistance' }
      : { state: 'met_late', target, mins: fr, label: fr + ' min to first assistance — outside SLA' };
  }
  const el = Math.max(0, Math.round((now - t0) / 60000));
  if (el > target) return { state: 'breached', target, over: el - target, label: (el - target) + ' min over' };
  if (el >= target * nearPct) return { state: 'near', target, left: target - el, label: (target - el) + ' min left' };
  return { state: 'within', target, left: target - el, label: (target - el) + ' min left' };
}

function statusOf(row, mir) {
  if (row.closed) return 'Resolved';
  switch (row.stageIdx) {
    case 0: return 'New';
    case 1: return mir.booked_at ? 'Booked' : (mir.owner_name ? 'Assigned' : 'Triaged');
    case 2: return mir.completed_at ? 'Awaiting evidence' : 'Live';
    case 3: return mir.tl_confirmed ? 'Awaiting agent confirmation' : 'Awaiting team leader confirmation';
    case 4: return 'Follow-up due';
    default: return 'Resolved';
  }
}

const note = (env, contactId, oppId, title, body) =>
  hl(env, '/contacts/' + contactId + '/notes', { method: 'POST', body: JSON.stringify({
    body: 'Assist ' + oppId + '\n' + title + (body ? '\n\n' + String(body).slice(0, 2000) : '') }) }).catch(() => null);

const hist = (mir, actor, what) => {
  (mir.history = mir.history || []).push({ at: new Date().toISOString(), actor, what });
  if (mir.history.length > 60) mir.history = mir.history.slice(-60);
};

/* Baseline: the metric the follow-up will be measured against, read from the
   TEAM's digest rows at raise time. conv/leads/calls are not published yet →
   the follow-up honestly answers Not measurable rather than inventing one. */
function baselineFor(metric, digest, tlName, camp) {
  if (!metric) return { metric: null, value: null };
  const rows = (digest.agents || []).filter((a) =>
    String(a.tl || '').trim() === tlName && campKey(a.campaign) === campKey(camp));
  const n = (v) => (v == null || isNaN(v) ? 0 : Number(v));
  if (metric === 'sales') return { metric, value: rows.reduce((s, a) => s + n(a.sales), 0) };
  if (metric === 'qa') { const q = rows.filter((a) => a.qa != null); return { metric, value: q.length ? q.reduce((s, a) => s + Number(a.qa), 0) / q.length : null }; }
  if (metric === 'present') { const e = rows.reduce((s, a) => s + n(a.emp), 0); return { metric, value: e ? rows.reduce((s, a) => s + n(a.act), 0) / e : null }; }
  return { metric, value: null };            // conv · leads · calls — not published yet
}

/* --------------------------------------------------------------------------- */

/** POST /api/portal/cm/request — a TEAM LEADER raises a request. raise_request
 *  is a team-leader-only permission: a campaign manager cannot raise one to
 *  themselves, and an agent's route is the Help Center. */
export async function assistCreate(env, DB, user, digest, ctx, body) {
  if (user.role !== 'team_leader') return { status: 403, body: { error: 'Assistance requests come from team leaders. Agents ask through the Help Center.' } };
  const auth = authorise(user, digest);
  if (auth.error) return { status: auth.status, body: { error: auth.error } };

  const blk = blockageOf(ctx, body.blockage);
  if (!blk) return { status: 400, body: { error: 'Choose what the team is blocked on.' } };
  const priority = ['P1', 'P2', 'P3', 'P4'].includes(String(body.priority)) ? String(body.priority) : 'P3';
  const myCamps = [...new Set(auth.rows.map((a) => String(a.campaign || '').trim()).filter(Boolean))];
  const camp = myCamps.find((c) => campKey(c) === campKey(body.campaign)) || myCamps[0];
  if (!camp) return { status: 409, body: { error: 'No campaign is recorded for your team yet.' } };
  const restricted = !!blk.restricted;
  const desc = String(body.description || '').trim().slice(0, 2000);
  const impact = String(body.impact || '').trim().slice(0, 600);
  if (!restricted && !desc) return { status: 400, body: { error: 'Say what the team is blocked on — the description is what your campaign manager reads.' } };
  const affected = Math.max(0, Math.min(99, parseInt(body.affected, 10) || 0));

  const cb = normCb(user.cb);
  if (!cb) return { status: 403, body: { error: 'This account has no CB number — ask Nick to re-run provisioning.' } };
  const tlName = user.full_name || user.username;

  const p = await pipeline(env);
  if (!p || !p.stages.length) return { status: 503, body: { error: 'The Campaign Assistance pipeline could not be reached — try again shortly.' } };

  /* DUPLICATE MERGE on campaign|tl|blockage while one is still open. */
  const repeatKey = campKey(camp) + '|' + cb + '|' + blk.key;
  const mir = await mirrors(DB);
  const sr = await searchAll(env, p.id);
  for (const o of sr.ops) {
    const row = parseCard(o, p.stages);
    if (row.closed) continue;
    const m = mir[row.id] || {};
    if ((m.repeat_key || (campKey(row.campaign) + '|' + row.cb + '|' + row.blockage)) === repeatKey) {
      if (!restricted) await note(env, row.contactId, row.id, 'Duplicate request merged into this one', desc);
      hist(m, tlName, 'duplicate merged');
      await writeMirror(DB, row.id, m);
      return { status: 200, body: { ok: true, id: row.id, merged: true } };
    }
  }
  if (sr.truncated) return { status: 503, body: { error: 'The pipeline scan was cut short — refusing to create a possible duplicate. Try again shortly.' } };

  const contactId = await contactFor(env, DB, cb, tlName);
  const opp = await hl(env, '/opportunities/', { method: 'POST', body: JSON.stringify({
    locationId: env.HL_HELP_LOCATION_ID, pipelineId: p.id, pipelineStageId: p.stages[0].id,
    name: cardName(blk.key, cb, tlName, camp), status: 'open', contactId }) });
  const id = (opp.opportunity && opp.opportunity.id) || '';
  if (!id) return { status: 502, body: { error: 'HighLevel did not return the new request.' } };

  const now = new Date().toISOString();
  const m = {
    priority, sla_target_mins: slaTargetOf(ctx.sla, priority),
    blockage: blk.key, restricted, campaign: camp, cb, tl: tlName,
    affected, requested_at: now, repeat_key: repeatKey, contactId,
    route: blk.routes_to, owner_hint: blk.owner,
    baseline: baselineFor(blk.baseline_metric, digest, String(user.team || '').trim() || tlName, camp),
    evidence_n: 0, tl_confirmed: false, agent_confirmed: false, reopened: 0, history: [],
  };
  hist(m, tlName, 'raised · ' + priority + ' · ' + blk.key);
  await writeMirror(DB, id, m);
  /* The note carries the team leader's words — UNLESS restricted, in which case
     the text never travels. That line IS the confidentiality control. */
  await note(env, contactId, id, restricted
    ? 'Restricted — personal matter. Details held with the team leader.'
    : 'Request raised · ' + blk.label + ' · ' + priority + (affected ? ' · ' + affected + ' agents affected' : ''),
    restricted ? '' : desc + (impact ? '\n\nBusiness impact: ' + impact : ''));
  return { status: 200, body: { ok: true, id } };
}

/** GET /api/portal/cm/assist — the register + every assistance KPI, from ONE
 *  HighLevel search and ONE rules select. CM sees their campaigns; a team
 *  leader sees their own; admin/exec see all; agents are refused. */
export async function assistList(env, DB, user, digest, ctx) {
  const auth = authorise(user, digest);
  if (auth.error) return { status: auth.status, body: { error: auth.error } };
  if (auth.scope === 'agent') return { status: 403, body: { error: 'The assistance register is not an agent page.' } };

  const p = await pipeline(env);
  if (!p) return { status: 503, body: { error: 'The Campaign Assistance pipeline could not be reached.' } };
  const [sr, mir] = await Promise.all([searchAll(env, p.id), mirrors(DB)]);
  const now = Date.now();
  const sla = ctx.sla || CM_SLA_DEFAULTS;
  const myCb = normCb(user.cb);

  let rows = sr.ops.map((o) => {
    const r = parseCard(o, p.stages);
    const m = mir[r.id] || {};
    const s = slaOf({ requested_at: m.requested_at || r.created, ...m }, sla, now);
    const b = blockageOf(ctx, m.blockage || r.blockage);
    return { ...r,
      team: r.campaign + ' · ' + (r.tl.split(/\s+/)[0] || r.tl),
      blockage: m.blockage || r.blockage, blockageLabel: b ? b.label : (m.blockage || r.blockage),
      priority: m.priority || 'P3', restricted: !!m.restricted, affected: m.affected || 0,
      requested: m.requested_at || r.created, sla: s, status: statusOf(r, m),
      owner: m.owner_name || '', ownerHint: m.owner_hint || (b ? b.owner : ''), route: m.route || (b ? b.routes_to : ''),
      firstResponse: m.first_response_mins != null ? m.first_response_mins : null,
      sessionMins: m.session_mins != null ? m.session_mins : null,
      sessionEnd: m.session_end || null, completedAt: m.completed_at || null,
      followUpDue: m.follow_up_due_at || null, outcome: m.outcome || null,
      evidenceN: m.evidence_n || 0, tlConfirmed: !!m.tl_confirmed, agentConfirmed: !!m.agent_confirmed,
      reopened: m.reopened || 0, escalated: !!m.escalated_at,
      repeatKey: m.repeat_key || (campKey(r.campaign) + '|' + r.cb + '|' + r.blockage),
      resolutionMins: m.resolution_mins != null ? m.resolution_mins : null };
  });

  if (auth.scope === 'team') rows = rows.filter((r) => r.cb === myCb);
  else if (auth.scope === 'campaign') rows = rows.filter((r) => (auth.campaigns || []).includes(campKey(r.campaign)));
  /* scope 'all' sees everything — admin/exec preview, same as the portal. */

  /* REPEATS: same key, inside the window, at least repeat_min occurrences. */
  const winMs = (Number(sla.repeat_window_days) || 30) * 86400000;
  const minN = Number(sla.repeat_min) || 2;
  const byKey = {};
  for (const r of rows) { const t = Date.parse(r.requested || 0); (byKey[r.repeatKey] = byKey[r.repeatKey] || []).push(t); }
  const repeatKeys = new Set(Object.keys(byKey).filter((k) => {
    const ts = byKey[k].sort();
    for (let i = 0; i + minN - 1 < ts.length; i++) if (ts[i + minN - 1] - ts[i] <= winMs) return true;
    return false;
  }));
  for (const r of rows) r.repeat = repeatKeys.has(r.repeatKey);

  rows.sort((a, b) => {
    const sev = { breached: 0, near: 1, within: 2, met_late: 3, met: 4 };
    const d = (sev[a.sla.state] ?? 5) - (sev[b.sla.state] ?? 5);
    return d || String(b.requested).localeCompare(String(a.requested));
  });

  /* The 24 assistance KPIs — "How I am unblocking teams". slaPct divides by
     ANSWERED, not by all requests (spec, rules.assistance_kpis). */
  const open = rows.filter((r) => !r.closed);
  const answered = rows.filter((r) => r.firstResponse != null);
  const withinSla = answered.filter((r) => r.sla.state === 'met').length;
  const med = (xs) => { const s = xs.filter((v) => v != null).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
  const followDue = open.filter((r) => r.followUpDue);
  const measured = rows.filter((r) => r.outcome && r.outcome !== 'Not measurable');
  const kpis = {
    received: rows.length, open: open.length, answered: answered.length,
    withinSla, slaPct: answered.length ? (withinSla / answered.length) * 100 : null,
    nearBreach: open.filter((r) => r.sla.state === 'near').length,
    outsideSla: open.filter((r) => r.sla.state === 'breached').length + answered.filter((r) => r.sla.state === 'met_late').length,
    medianFirstResponse: med(answered.map((r) => r.firstResponse)),
    medianResolution: med(rows.map((r) => r.resolutionMins)),
    sessionsRequested: rows.filter((r) => ['skill', 'knowledge', 'training'].includes(r.blockage)).length,
    sessionsBooked: open.filter((r) => r.status === 'Booked').length,
    sessionsLive: open.filter((r) => r.status === 'Live').length,
    sessionsCompleted: rows.filter((r) => r.completedAt).length,
    awaitingTl: open.filter((r) => r.status === 'Awaiting team leader confirmation').length,
    awaitingAgent: open.filter((r) => r.status === 'Awaiting agent confirmation').length,
    followUpsDue: followDue.length,
    followUpsOverdue: followDue.filter((r) => Date.parse(r.followUpDue) < now).length,
    repeatRate: rows.length ? (rows.filter((r) => r.repeat).length / rows.length) * 100 : null,
    repeatThemes: [...repeatKeys].length,
    escalated: rows.filter((r) => r.escalated).length,
    evidenceCompleteness: rows.length ? (rows.filter((r) => r.evidenceN > 0).length / rows.length) * 100 : null,
    improvedPct: measured.length ? (rows.filter((r) => r.outcome === 'Improved').length / measured.length) * 100 : null,
    improvedOf: { n: rows.filter((r) => r.outcome === 'Improved').length, of: measured.length },
    p1Open: open.filter((r) => r.priority === 'P1').length,
  };

  /* Blockage panel rows — open · raised · agents affected · oldest · avg
     resolution · comes back (spec, rules.blockages.reported_by_category). */
  const blockPanel = (ctx.blockages || []).map((b) => {
    const mineB = rows.filter((r) => r.blockage === b.key);
    if (!mineB.length) return null;
    const openB = mineB.filter((r) => !r.closed);
    const oldest = openB.length ? Math.max(...openB.map((r) => now - Date.parse(r.requested || now))) : null;
    const res = mineB.map((r) => r.resolutionMins).filter((v) => v != null);
    return { key: b.key, label: b.label, routes_to: b.routes_to,
      open: openB.length, raised: mineB.length,
      affected: mineB.reduce((s2, r) => s2 + (r.affected || 0), 0),
      oldestDays: oldest == null ? null : Math.floor(oldest / 86400000),
      avgResolution: res.length ? Math.round(res.reduce((a2, v) => a2 + v, 0) / res.length) : null,
      comesBack: mineB.some((r) => r.repeat) };
  }).filter(Boolean);

  /* The list never carries a restricted request's text — it never had it.
     The blockage table travels too: the team leader's raise form builds its
     options from it, so the form reads the rule rather than copying it. */
  return { status: 200, body: { stages: p.stages.map((s) => ({ id: s.id, name: s.name })),
    requests: rows, kpis, blockPanel, truncated: sr.truncated, total: sr.total,
    blockages: (ctx.blockages || []).map((b) => ({ key: b.key, label: b.label, restricted: !!b.restricted })),
    sla: { p1: slaTargetOf(sla, 'P1'), p2: slaTargetOf(sla, 'P2'), p3: slaTargetOf(sla, 'P3'), p4: slaTargetOf(sla, 'P4') } } };
}

/** GET /api/portal/cm/detail?id= — one request with its notes and history. */
export async function assistDetail(env, DB, user, digest, ctx, id) {
  const list = await assistList(env, DB, user, digest, ctx);
  if (list.status !== 200) return list;
  const row = (list.body.requests || []).find((r) => r.id === String(id || ''));
  if (!row) return { status: 404, body: { error: 'That request is not in your scope.' } };
  let notes = [];
  if (!row.restricted && row.contactId) {
    try {
      const n = await hl(env, '/contacts/' + row.contactId + '/notes');
      notes = (n.notes || []).filter((x) => String(x.body || '').startsWith('Assist ' + row.id + '\n'))
        .map((x) => ({ at: x.dateAdded || x.createdAt || '', body: String(x.body || '').slice(('Assist ' + row.id + '\n').length) }));
    } catch {}
  }
  const mir = await mirrors(DB);
  return { status: 200, body: { ...row, notes, history: (mir[row.id] || {}).history || [] } };
}

/**
 * POST /api/portal/cm/act — every workflow transition. Permission-checked per
 * the spec's table: triage/assign/priority/book/start/complete/escalate are
 * the campaign manager's (and Director's); confirm_tl is the requesting team
 * leader's; acknowledge and evidence are open to both sides.
 */
export async function assistAct(env, DB, user, digest, ctx, body) {
  const auth = authorise(user, digest);
  if (auth.error) return { status: auth.status, body: { error: auth.error } };
  if (auth.scope === 'agent') return { status: 403, body: { error: 'Not an agent action.' } };
  const isCm = auth.scope === 'campaign' || auth.scope === 'all';
  const actor = user.full_name || user.username;
  const action = String(body.action || '');
  const id = String(body.id || '');
  if (!id) return { status: 400, body: { error: 'id required.' } };

  const p = await pipeline(env);
  if (!p || !p.stages.length) return { status: 503, body: { error: 'Pipeline unreachable.' } };
  const cur = await hl(env, '/opportunities/' + encodeURIComponent(id));
  const opp = cur.opportunity || cur;
  if (String(opp.pipelineId || '') !== p.id) return { status: 404, body: { error: 'That is not an assistance request.' } };
  const row = parseCard(opp, p.stages);

  /* Scope: a CM may act on their campaigns' requests; a TL only on their own. */
  if (auth.scope === 'campaign' && !(auth.campaigns || []).includes(campKey(row.campaign)))
    return { status: 403, body: { error: 'That request is not on your campaigns.' } };
  if (auth.scope === 'team' && row.cb !== normCb(user.cb))
    return { status: 403, body: { error: 'That request is not yours.' } };

  const mir = await mirrors(DB);
  const m = mir[id] || { requested_at: row.created, history: [] };
  const now = new Date();
  const nowIso = now.toISOString();
  const stage = (i) => hl(env, '/opportunities/' + encodeURIComponent(id), { method: 'PUT',
    body: JSON.stringify({ pipelineStageId: p.stages[i].id, status: i === p.stages.length - 1 ? 'won' : 'open' }) });
  const say = (title, text) => m.restricted ? Promise.resolve() : note(env, row.contactId || m.contactId, id, title, text || '');
  const started = !!m.assistance_started_at;
  const CM_ONLY = { error: 'That action belongs to the campaign manager.', status: 403 };

  switch (action) {
    case 'acknowledge': {
      /* Deliberately does NOT stop the SLA clock. */
      if (!m.acknowledged_at) { m.acknowledged_at = nowIso; hist(m, actor, 'acknowledged'); await say('Acknowledged by ' + actor); }
      break;
    }
    case 'classify': {
      if (!isCm) return { status: 403, body: CM_ONLY };
      const b = blockageOf(ctx, body.blockage);
      if (!b) return { status: 400, body: { error: 'Unknown blockage.' } };
      m.blockage = b.key; m.route = b.routes_to; m.owner_hint = b.owner;
      m.repeat_key = campKey(row.campaign) + '|' + row.cb + '|' + b.key;
      /* Reclassifying renames the card, so the board reads true. */
      await hl(env, '/opportunities/' + encodeURIComponent(id), { method: 'PUT',
        body: JSON.stringify({ name: cardName(b.key, row.cb, row.tl, row.campaign) }) });
      if (row.stageIdx === 0) await stage(1);
      hist(m, actor, 'classified · ' + b.key); await say('Classified as ' + b.label + ' → ' + b.routes_to);
      break;
    }
    case 'priority': {
      if (!isCm) return { status: 403, body: CM_ONLY };
      if (started) return { status: 409, body: { error: 'Assistance has already started — the priority it was answered under stands.' } };
      const pr = ['P1', 'P2', 'P3', 'P4'].includes(String(body.priority)) ? String(body.priority) : null;
      if (!pr) return { status: 400, body: { error: 'P1–P4.' } };
      m.priority = pr; m.sla_target_mins = slaTargetOf(ctx.sla, pr);
      hist(m, actor, 'priority → ' + pr); await say('Priority set to ' + pr);
      break;
    }
    case 'assign': {
      if (!isCm) return { status: 403, body: CM_ONLY };
      m.owner_name = String(body.owner || m.owner_hint || actor).slice(0, 80);
      (m.transferred = m.transferred || []).push({ at: nowIso, to: m.owner_name, by: actor });
      if (row.stageIdx === 0) await stage(1);
      hist(m, actor, 'assigned → ' + m.owner_name); await say('Assigned to ' + m.owner_name);
      break;
    }
    case 'book': {
      if (!isCm) return { status: 403, body: CM_ONLY };
      /* Booking does not stop the clock — the card STAYS in Triaged. */
      m.booked_at = nowIso; m.booked_for = String(body.when || '').slice(0, 40);
      if (row.stageIdx === 0) await stage(1);
      hist(m, actor, 'session booked'); await say('Session booked' + (m.booked_for ? ' for ' + m.booked_for : ''));
      break;
    }
    case 'start': {
      if (!isCm) return { status: 403, body: CM_ONLY };
      /* THE ONLY TRANSITION THAT STOPS THE FIRST-RESPONSE CLOCK. Stamped once,
         never recomputed — lastStageChangeAt is a cross-check, not a source. */
      if (!started) {
        m.assistance_started_at = nowIso;
        m.first_response_mins = Math.max(0, Math.round((now - Date.parse(m.requested_at || row.created)) / 60000));
        m.within_sla = m.first_response_mins <= (Number(m.sla_target_mins) || slaTargetOf(ctx.sla, m.priority || 'P3'));
        if (!m.owner_name) m.owner_name = actor;
      }
      m.session_start = m.session_start || nowIso;
      await stage(2);
      hist(m, actor, 'assistance started (' + m.first_response_mins + ' min, ' + (m.within_sla ? 'inside' : 'outside') + ' SLA)');
      await say('Assistance started by ' + (m.owner_name || actor));
      break;
    }
    case 'evidence': {
      const ev = String(body.text || '').trim();
      if (!ev) return { status: 400, body: { error: 'Say what the evidence is.' } };
      m.evidence_n = (m.evidence_n || 0) + 1;
      hist(m, actor, 'evidence added'); await say('Evidence', ev);
      if (row.stageIdx === 2 && m.completed_at) { /* was awaiting evidence — recheck gates below */ }
      break;
    }
    case 'complete': {
      if (!isCm) return { status: 403, body: CM_ONLY };
      const res = String(body.resolution || '').trim();
      if (!res) return { status: 400, body: { error: 'Record what was actually done — a session with no resolution is not complete.' } };
      m.resolution = res.slice(0, 1200); m.session_end = nowIso; m.completed_at = nowIso;
      if (m.session_start) m.session_mins = Math.max(0, Math.round((now - Date.parse(m.session_start)) / 60000));
      hist(m, actor, 'session completed'); await say('Session completed — resolution', res);
      if (!m.evidence_n) { /* awaiting_evidence: stays in Assisting; the screen names the gap */ }
      else await stage(3);
      break;
    }
    case 'confirm_tl': {
      /* The requesting team leader's word — or the CM recording it. */
      if (auth.scope === 'team' && row.cb !== normCb(user.cb)) return { status: 403, body: { error: 'Not your request.' } };
      if (String(body.disputed) === 'true') {
        m.reopened = (m.reopened || 0) + 1; m.tl_confirmed = false;
        m.completed_at = null; m.session_end = null;
        await stage(1); hist(m, actor, 'disputed by team leader — reopened');
        await say('Team leader disputed the assistance — reopened');
        break;
      }
      m.tl_confirmed = true; m.confirmed_at = nowIso;
      hist(m, actor, 'team leader confirmed');
      await say('Team leader confirmed the assistance');
      if (String(body.agent_involved) === 'true' && !m.agent_confirmed) { m.agent_involved = true; await stage(3); break; }
      await finishOrFollowUp(m, ctx, stage, nowIso);
      break;
    }
    case 'confirm_agent': {
      m.agent_confirmed = true;
      hist(m, actor, 'agent confirmation recorded');
      await say('Agent confirmed the assistance');
      await finishOrFollowUp(m, ctx, stage, nowIso);
      break;
    }
    case 'followup': {
      if (!isCm) return { status: 403, body: CM_ONLY };
      const after = baselineFor(m.baseline && m.baseline.metric, digest,
        (Object.entries(ctx.leaders || {}).find(([, v]) => v.cb === row.cb) || [row.tl])[0], row.campaign);
      let verdict = 'Not measurable';
      if (m.baseline && m.baseline.value != null && after.value != null) {
        const delta = (after.value - m.baseline.value) / Math.abs(m.baseline.value || 1);
        verdict = delta > 0.02 ? 'Improved' : delta < -0.02 ? 'Declined' : 'Unchanged';
      }
      m.outcome = verdict; m.followup = { at: nowIso, before: m.baseline, after: after.value, by: actor };
      m.follow_up_due_at = null;
      hist(m, actor, 'follow-up read: ' + verdict);
      await say('48-hour follow-up: ' + verdict);
      if (verdict === 'Declined') { m.reopened = (m.reopened || 0) + 1; await stage(1); await say('Outcome declined — reopened'); }
      else { m.resolution_mins = Math.max(0, Math.round((now - Date.parse(m.requested_at || row.created)) / 60000)); await stage(5); }
      break;
    }
    case 'escalate': {
      if (!isCm) return { status: 403, body: CM_ONLY };
      m.escalated_at = nowIso; m.escalation_reason = String(body.reason || '').slice(0, 400);
      hist(m, actor, 'escalated'); await say('Escalated', m.escalation_reason);
      break;
    }
    case 'reopen': {
      m.reopened = (m.reopened || 0) + 1; m.completed_at = null; m.outcome = null;
      await stage(1); hist(m, actor, 'reopened'); await say('Reopened', String(body.reason || ''));
      break;
    }
    default: return { status: 400, body: { error: 'Unknown action.' } };
  }

  await writeMirror(DB, id, m);
  /* The audit trail rides the mirror's history + updated_at; the auth_log
     carries sign-ins, not per-record acts — same split as the hubs. */
  return { status: 200, body: { ok: true, blockers: closeBlockers(m) } };
}

/** The resolution gates — the screen NAMES what is missing, it never just
 *  disables the button (spec, rules.workflow.resolution_gates). */
export function closeBlockers(m) {
  const out = [];
  if (!m.resolution) out.push('resolution details');
  if (!m.evidence_n) out.push('evidence');
  if (!m.tl_confirmed) out.push('team leader confirmation');
  if (m.agent_involved && !m.agent_confirmed) out.push('agent confirmation');
  if (m.baseline && m.baseline.metric && m.baseline.value != null && !m.outcome) out.push('the 48-hour follow-up reading');
  return out;
}

/* Resolved outright when nothing measurable remains; otherwise the 48-hour
   follow-up is created and the request waits for its reading. */
async function finishOrFollowUp(m, ctx, stage, nowIso) {
  const measurable = m.baseline && m.baseline.metric && m.baseline.value != null;
  if (measurable && !m.outcome) {
    const h = Number(ctx.sla.followup_hours) || 48;
    m.follow_up_due_at = new Date(Date.parse(nowIso) + h * 3600000).toISOString();
    await stage(4);
  } else {
    if (!m.outcome) m.outcome = 'Not measurable';
    m.resolution_mins = Math.max(0, Math.round((Date.parse(nowIso) - Date.parse(m.requested_at)) / 60000));
    await stage(5);
  }
}
