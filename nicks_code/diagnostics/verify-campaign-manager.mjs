#!/usr/bin/env node
/**
 * verify-campaign-manager.mjs — the proof for the campaign manager view.
 *
 * Run:  node nicks_code/diagnostics/verify-campaign-manager.mjs
 *
 * Everything runs against a STUBBED HighLevel and Supabase, so this is safe on
 * any machine and proves the rules, not the network:
 *
 *   scope       — a campaign manager's payload holds ONLY their campaigns'
 *                 agents; a viewer is still refused; a missing context fails
 *                 loudly, never quietly to an empty scope
 *   reconcile   — campaign totals ≡ Σ team totals over the fixture digest
 *   honesty     — the six unsourced measures are null, never zero
 *   golden rule — acknowledge / assign / book do NOT stamp the clock; the
 *                 Assisting transition does, ONCE, and never re-stamps
 *   priority    — refused after assistance starts
 *   restricted  — a personal request's text NEVER reaches HighLevel
 *   duplicates  — a second open request on the same key MERGES
 *   one search  — the register makes no per-row HighLevel fetches
 *   gates       — closeBlockers NAMES what is missing
 */
import path from 'node:path';
import fsSync from 'node:fs';
import pathSync from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = pathSync.resolve(HERE, '..', '..');
const W = (f) => 'file:///' + path.resolve(HERE, '..', '..', 'worker', 'src', f).replace(/\\/g, '/').replace(/ /g, '%20');

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; console.log('  ok  ' + name); } else { fail++; console.log('  FAIL ' + name); } };

/* ---------------- stub HighLevel ---------------- */
const HLLOG = [];
let OPPS = [];                       // the pipeline's opportunities
let NEXT_ID = 1;
const STAGES = ['New', 'Triaged', 'Assisting', 'Awaiting confirmation', 'Follow-up due', 'Closed']
  .map((name, i) => ({ id: 'st' + i, name, position: i }));

globalThis.fetch = async (url, opts) => {
  const u = String(url); const method = (opts && opts.method) || 'GET';
  HLLOG.push(method + ' ' + u.replace(/^https?:\/\/[^/]+/, '').split('?')[0]);
  const body = opts && opts.body ? JSON.parse(opts.body) : null;
  const json = (o) => ({ ok: true, status: 200, text: async () => JSON.stringify(o), json: async () => o });

  if (u.includes('/opportunities/pipelines'))
    return json({ pipelines: [{ id: 'pipe1', name: 'Campaign Assistance', stages: STAGES }] });
  if (u.includes('/opportunities/search'))
    return json({ opportunities: OPPS, meta: { total: OPPS.length } });
  if (u.includes('/opportunities/') && method === 'GET') {
    const id = decodeURIComponent(u.split('/opportunities/')[1].split('?')[0]);
    return json({ opportunity: OPPS.find((o) => o.id === id) || {} });
  }
  if (u.endsWith('/opportunities/') && method === 'POST') {
    /* HighLevel's OPPORTUNITY_NO_DUPLICATE (seen live 2026-09-21): one card per contact per pipeline,
       won or not. The stub refuses exactly as the location does. */
    if (OPPS.some((x) => x.pipelineId === body.pipelineId && String(x.contactId) === String(body.contactId)))
      return { ok: false, status: 400, text: async () => JSON.stringify({ statusCode: 400, message: 'Can not create duplicate opportunity for the contact.', code: 'OPPORTUNITY_NO_DUPLICATE' }), json: async () => ({ code: 'OPPORTUNITY_NO_DUPLICATE' }) };
    const o = { id: 'opp' + (NEXT_ID++), name: body.name, pipelineId: body.pipelineId,
      pipelineStageId: body.pipelineStageId, status: body.status, contactId: body.contactId,
      createdAt: new Date().toISOString() };
    OPPS.push(o);
    return json({ opportunity: o });
  }
  if (u.includes('/opportunities/') && method === 'PUT') {
    if (globalThis.FAIL_NEXT_PUT) { globalThis.FAIL_NEXT_PUT = false; return { ok: false, status: 500, text: async () => 'boom', json: async () => ({}) }; }   // a HighLevel hiccup, once
    const id = decodeURIComponent(u.split('/opportunities/')[1].split('?')[0]);
    const o = OPPS.find((x) => x.id === id);
    if (o) Object.assign(o, body.pipelineStageId ? { pipelineStageId: body.pipelineStageId, status: body.status } : {}, body.name ? { name: body.name } : {});
    return json({ ok: true });
  }
  if (u.includes('/contacts/') && u.includes('/notes')) { NOTES.push(body ? body.body : ''); return json({ ok: true }); }
  if (u.endsWith('/contacts/') && method === 'POST') return json({ contact: { id: 'contact-' + ((body.tags || []).find((t) => /^cb\d+$/i.test(t)) || 'x') } });   // one contact per CB, as help.mjs tags them
  throw new Error('unstubbed fetch: ' + method + ' ' + u);
};
const NOTES = [];

/* ---------------- stub Supabase ---------------- */
const RULES = {};                    // key -> value (mirrors + rule book)
const DB = {
  select: async (q) => {
    if (q.startsWith('rules?key=like.')) {
      const pref = decodeURIComponent(q.split('like.')[1].split('&')[0]).replace(/\*$/, '');
      return Object.entries(RULES).filter(([k]) => k.startsWith(pref)).map(([key, value]) => ({ key, value }));
    }
    if (q.startsWith('rules?key=in.')) return [];               // no seeded rule book → defaults
    if (q.startsWith('rules?key=eq.')) {
      const k = decodeURIComponent(q.split('eq.')[1].split('&')[0]);
      return RULES[k] ? [{ key: k, value: RULES[k] }] : [];
    }
    if (q.startsWith('app_users?role=eq.team_leader'))
      return [{ username: 'cb207', full_name: 'Renolan Pillay', cb: 'CB207', team: 'Renolan Pillay' },
              { username: 'cb212', full_name: 'Shane Methalal', cb: 'CB212', team: 'Shane Methalal' }];
    return [];
  },
  insert: async (table, rows) => { for (const r of rows) RULES[r.key] = r.value; },
  del: async (q) => { const k = decodeURIComponent(q.split('eq.')[1]); delete RULES[k]; },
  update: async () => {},
  storageGet: async () => null,
};
const env = { HL_HELP_API_KEY: 'k', HL_HELP_LOCATION_ID: 'loc' };

/* ---------------- fixture digest ---------------- */
const digest = {
  updatedAt: new Date().toISOString(),
  period: { from: '2026-08-01', to: '2026-08-31' },
  diallingDays: 20, workingDays: 21, dates: [], weeks: [],
  agents: [
    { code: 'CB1', name: 'A One', campaign: 'Cuddle', tl: 'Renolan Pillay', sales: 100, target: 200, gwpEx: 9900, gwpT: 19800, qa: 0.92, att: 1, act: 20, emp: 20, canc: 2, talk: 240000, ref: 0, composite: { r2a: { fails: 1 } } },
    { code: 'CB2', name: 'A Two', campaign: 'Cuddle', tl: 'Renolan Pillay', sales: 80, target: 160, gwpEx: 8000, gwpT: 15840, qa: 0.88, att: 0.9, act: 18, emp: 20, canc: 1, talk: 200000, ref: 0, composite: { r2a: { fails: 0 } } },
    { code: 'CB3', name: 'B One', campaign: 'Cuddle', tl: 'Shane Methalal', sales: 150, target: 180, gwpEx: 15000, gwpT: 17820, qa: 0.95, att: 1, act: 20, emp: 20, canc: 0, talk: 260000, ref: 0, composite: { r2a: { fails: 0 } } },
    { code: 'CB4', name: 'C One', campaign: 'Courtesy', tl: 'Shane Methalal', sales: 60, target: 100, gwpEx: 5900, gwpT: 9900, qa: 0.85, att: 0.95, act: 19, emp: 20, canc: 3, talk: 190000, ref: 0, composite: { r2a: { fails: 2 } } },
  ],
  notCovered: [],
};

const { authorise, overview, PORTAL_ROLES } = await import(W('portal.mjs'));
const { loadCmContext, cmOverviewBody } = await import(W('campaign.mjs'));
const { assistCreate, assistList, assistAct, closeBlockers } = await import(W('assist.mjs'));

const cmUser = { username: 'dalwin', full_name: 'Dalwin Callaghan', role: 'campaign_manager', cb: '' };
const tlUser = { username: 'cb207', full_name: 'Renolan Pillay', role: 'team_leader', cb: 'CB207', team: 'Renolan Pillay' };
const tl2User = { username: 'cb212', full_name: 'Shane Methalal', role: 'team_leader', cb: 'CB212', team: 'Shane Methalal' };

console.log('A. SCOPE');
ok(PORTAL_ROLES.has('campaign_manager'), 'campaign_manager is a portal role (lockdown applies)');
delete globalThis.__cmCtx;
let a = authorise(cmUser, digest);
ok(a.error && a.status === 503, 'missing context fails LOUDLY (503), never to an empty scope');
const ctx = await loadCmContext(DB);
a = authorise(cmUser, digest);
ok(a.scope === 'campaign', 'scope is campaign');
ok(a.codes.size === 4 && a.codes.has('CB1') && a.codes.has('CB4'), 'holds exactly the assigned campaigns\' agents');
ok(authorise({ username: 'x', role: 'viewer' }, digest).status === 403, 'a viewer is still refused');
/* narrow the assignment and the codes narrow with it */
globalThis.__cmCtx.assign = { dalwin: { campaigns: ['cuddle'] } };
const a2 = authorise(cmUser, digest);
ok(a2.codes.size === 3 && !a2.codes.has('CB4'), 'narrowing cm:assignments narrows the scope — nothing else grants access');
globalThis.__cmCtx.assign = { dalwin: { campaigns: ['cuddle', 'courtesy'] }, ryan: { campaigns: ['cuddle', 'courtesy'] } };

console.log('B. SALES — reconcile + honesty');
a = authorise(cmUser, digest);
const body = cmOverviewBody(digest, a, { requests: [] }, globalThis.__cmCtx);
const cud = body.campaigns.find((c) => c.key === 'cuddle');
ok(cud.reconciled, 'campaign total ≡ Σ team totals');
ok(cud.kpis.sales.v === 330 && cud.teams.reduce((n, t) => n + t.sales, 0) === 330, 'sales sum is the team-leader measure summed (330)');
ok(cud.kpis.pitches === null && cud.kpis.conv === null && cud.kpis.checks === null, 'unsourced measures are null — an absence is not a nought');
ok(Math.round(cud.kpis.gwp.projected) === Math.round((32900 / 20) * 21), 'projection = GWP/diallingDays × workingDays');
ok(cud.teams.length === 2, 'a team is one leader AND one campaign — Shane appears once per campaign');
ok(body.freshness.label.indexOf('live') === -1 && body.freshness.label.indexOf('real time') === -1, 'freshness language never says live/real time');

console.log('C. THE PIPELINE — restricted, duplicates, one search');
let r = await assistCreate(env, DB, cmUser, digest, ctx, { blockage: 'dialler', description: 'x' });
ok(r.status === 403, 'a campaign manager cannot raise a request to themselves');
r = await assistCreate(env, DB, tlUser, digest, ctx, { blockage: 'personal', description: 'SECRET-TEXT', impact: 'SECRET-IMPACT', priority: 'P3', campaign: 'Cuddle' });
ok(r.status === 200 && r.body.ok, 'a restricted request is accepted');
ok(!NOTES.some((n) => n.includes('SECRET-TEXT') || n.includes('SECRET-IMPACT')), 'its text NEVER reached HighLevel');
ok(NOTES.some((n) => n.includes('Restricted — personal matter')), 'the note says restricted, details held with the team leader');
ok(!OPPS.some((o) => o.name.includes('SECRET')), 'nor the card name');

/* ONE CARD PER TEAM LEADER AT A TIME (HighLevel's rule): a second, different blockage while the first
   is open is refused HONESTLY — a 409 naming the open request — never a 502 from HighLevel. */
globalThis.__cmMir = null;
r = await assistCreate(env, DB, tlUser, digest, ctx, { blockage: 'dialler', description: 'dialler drops every call', priority: 'P1', campaign: 'Cuddle' });
ok(r.status === 409 && r.body.open === true && /already has an open request/.test(r.body.error), 'a second live request from the same team leader is a 409 naming the open one, not a 502 (' + r.status + ')');
r = await assistCreate(env, DB, tl2User, digest, ctx, { blockage: 'dialler', description: 'dialler drops every call', priority: 'P1', campaign: 'Cuddle' });
const reqId = r.body.id;
ok(r.status === 200 && !r.body.merged, 'a normal request (another team leader) creates a card'); if (r.status !== 200) console.log('      → ' + JSON.stringify(r).slice(0, 300));
ok(NOTES.some((n) => n.includes('dialler drops every call')), 'its description travels in the note');
globalThis.__cmMir = null;   // drop the 30s mirror cache so the dup scan sees the new row
r = await assistCreate(env, DB, tl2User, digest, ctx, { blockage: 'dialler', description: 'still down', priority: 'P2', campaign: 'Cuddle' });
ok(r.status === 200 && r.body.merged === true && r.body.id === reqId, 'same team + same blockage while open → MERGES, never a second card');
ok(NOTES.some((n) => n.includes('Duplicate request merged into this one')), 'and says so on the surviving record');

console.log('D. THE GOLDEN RULE — the clock');
const mirKey = 'kv:cm-areq:' + reqId;
await assistAct(env, DB, cmUser, digest, ctx, { id: reqId, action: 'acknowledge' });
await assistAct(env, DB, cmUser, digest, ctx, { id: reqId, action: 'assign', owner: 'Aarav · Systems' });
await assistAct(env, DB, cmUser, digest, ctx, { id: reqId, action: 'book', when: 'today 15:00' });
let m = RULES[mirKey];
ok(m.acknowledged_at && m.owner_name === 'Aarav · Systems' && m.booked_at, 'acknowledge, assign and book are all recorded…');
ok(!m.assistance_started_at, '…and NONE of them stopped the clock');
r = await assistAct(env, DB, cmUser, digest, ctx, { id: reqId, action: 'start' });
m = RULES[mirKey];
ok(m.assistance_started_at && m.first_response_mins != null && m.within_sla === true, 'the Assisting transition stamps the clock (inside the 15-min P1 target)');
const stamp1 = m.assistance_started_at;
await assistAct(env, DB, cmUser, digest, ctx, { id: reqId, action: 'start' });
ok(RULES[mirKey].assistance_started_at === stamp1, 'a second start does NOT re-stamp — written once, never recomputed');
r = await assistAct(env, DB, cmUser, digest, ctx, { id: reqId, action: 'priority', priority: 'P4' });
ok(r.status === 409, 'priority is refused once assistance has started');
r = await assistAct(env, DB, cmUser, digest, ctx, { id: reqId, action: 'complete' });
ok(r.status === 400, 'a session cannot complete without a resolution');
r = await assistAct(env, DB, cmUser, digest, ctx, { id: reqId, action: 'complete', resolution: 'reset the carrier trunk' });
ok(r.status === 200 && r.body.blockers.includes('evidence') && r.body.blockers.includes('team leader confirmation'),
  'the gates NAME what is still missing: ' + r.body.blockers.join(', '));
ok(closeBlockers({ resolution: 'x', evidence_n: 1, tl_confirmed: true }).length === 0, 'all gates met → nothing blocks');

console.log('E. THE REGISTER — one search, scoped');
globalThis.__cmMir = null;
HLLOG.length = 0;
r = await assistList(env, DB, cmUser, digest, ctx);
ok(r.status === 200, 'the register answers');
const hlCalls = HLLOG.filter((l) => l.includes('leadconnectorhq') || l.startsWith('GET /opportunities') || l.startsWith('POST /opportunities'));
ok(HLLOG.filter((l) => l.includes('/opportunities/search')).length === 1, 'exactly ONE search — no per-row fetches (' + HLLOG.length + ' HL calls total)');
ok(!HLLOG.some((l) => l.includes('/notes') && l.startsWith('GET')), 'and no note reads in the list');
ok(r.body.requests.length === 2 && r.body.kpis.received === 2, 'both requests visible to the manager');
const restrictedRow = r.body.requests.find((x) => x.restricted);
ok(restrictedRow && JSON.stringify(restrictedRow).indexOf('SECRET') === -1, 'the restricted row carries no text at all');
globalThis.__cmMir = null;
r = await assistList(env, DB, tlUser, digest, ctx);
ok(r.body.requests.length === 1 && r.body.requests.every((x) => x.cb === 'CB207'), 'a team leader sees only their own (Renolan: 1 — the dialler request belongs to Shane)');
globalThis.__cmMir = null; r = await assistList(env, DB, tl2User, digest, ctx);
ok(r.body.requests.length === 1 && r.body.requests[0].cb === 'CB212' && r.body.requests[0].id === reqId, 'and the other team leader sees only theirs');
globalThis.__cmMir = null;
r = await assistList(env, DB, { username: 'x', role: 'agent', cb: 'CB1' }, digest, ctx);
ok(r.status === 403, 'an agent is refused the register');

console.log('F. THE TEAM↔REQUEST JOIN (regression, bug hunt 2026-08-30)');
{
  /* The card carries the ACCOUNT's full_name; the control-table row is keyed on
     the AGENT LIST name (app_users.team, which is what the digest publishes as
     `tl`). Those were the same string for all nine team leaders, so joining on
     the name worked — right up until somebody corrected a spelling, at which
     point the register would still list the request while the control table
     read "0 open" and the ladder called a blocked team a leadership problem.
     Joining on the CB number removes the coincidence. */
  OPPS = []; NOTES.length = 0; for (const k of Object.keys(RULES)) delete RULES[k];
  globalThis.__cmMir = null;
  const drifted = { username: 'cb207', full_name: 'Renolan  Pillay',   // note the double space
    role: 'team_leader', cb: 'CB207', team: 'Renolan Pillay' };
  await assistCreate(env, DB, drifted, digest, ctx, { blockage: 'dialler', description: 'd', priority: 'P1', campaign: 'Cuddle' });
  globalThis.__cmMir = null;
  const reg = await assistList(env, DB, cmUser, digest, ctx);
  const body2 = cmOverviewBody(digest, authorise(cmUser, digest), reg.body, globalThis.__cmCtx);
  const row = body2.campaigns.find((c) => c.key === 'cuddle').teams.find((t) => t.tl === 'Renolan Pillay');
  ok(reg.body.requests.length === 1, 'the register lists the request');
  ok(row && row.open === 1, 'and the TEAM ROW sees it too, despite the name drift — joined on CB207');
  ok(row && row.rag === 'r', 'so the ladder reads it as blocked, not as a leadership problem');
  /* the fallback still has to work for a leader with no account/CB on record */
  const noCb = body2.campaigns.find((c) => c.key === 'cuddle').teams.every((t) => typeof t.open === 'number');
  ok(noCb, 'every team row still returns a numeric open count');
}

console.log('H. THE LEAD MEASURES (Phase 7, 2026-08-30)');
{
  /* Conversion is sales / UNIQUE LEADS — the Lead Management rule — never sales per
     call. PULSE publishes the denominator; a null denominator must stay null. */
  const withLeads = JSON.parse(JSON.stringify(digest));
  withLeads.agents.forEach((a, i) => { a.leads = 100; a.calls = 400; a.ans = 200; });
  const b4 = cmOverviewBody(withLeads, authorise(cmUser, withLeads), { requests: [] }, globalThis.__cmCtx);
  const cc = b4.campaigns.find((c) => c.key === 'cuddle');
  ok(cc.kpis.conv && Math.abs(cc.kpis.conv.v - (330 / 300)) < 1e-9,
    'conversion = sales / unique leads, not sales / calls');
  ok(cc.kpis.contactRate && Math.abs(cc.kpis.contactRate.v - 0.5) < 1e-9, 'contact rate = answered / dials');
  ok(cc.kpis.attempts && Math.abs(cc.kpis.attempts.v - 4) < 1e-9, 'attempts per lead = dials / unique leads');
  ok(cc.kpis.leads && cc.kpis.leads.v === 300, 'lead volume is the unique-lead count');
  ok(cc.teams.every((t) => t.conv != null), 'every team row carries its own conversion');
  ok(b4.notPublished.join(',') === 'pitches,checks', 'only pitches and both-checks remain unpublished');

  /* the books not being loaded is NOT an agent with no leads */
  const noLeads = JSON.parse(JSON.stringify(digest));
  noLeads.agents.forEach((a) => { a.leads = null; a.calls = 400; a.ans = 200; });
  const b5 = cmOverviewBody(noLeads, authorise(cmUser, noLeads), { requests: [] }, globalThis.__cmCtx);
  const c5 = b5.campaigns.find((c) => c.key === 'cuddle');
  ok(c5.kpis.conv === null && c5.kpis.leads === null && c5.kpis.attempts === null,
    'no case books loaded -> conversion/leads/attempts are NULL, never zero');
  ok(c5.kpis.contactRate != null, 'but contact rate still reads — it needs no lead count');
}

console.log('I. THE PUBLISHER ONLY EVER PUBLISHES A MONTH');
{
  /* periodRange() reads S.ui — the SHARED view blob — so the period the publishing
     browser is looking at becomes what the whole floor is told its month is. */
  const src = fsSync.readFileSync(pathSync.join(REPO, 'nicks_code', 'index.html'), 'utf8');
  ok(src.indexOf('-01$/.test((p.period&&p.period.from)') > -1,
    'the digest push refuses any period that does not start on the 1st');
  const push = src.indexOf('var p=agentDigestPayload()');
  const guard = src.indexOf('p.period.from', push);
  const send = src.indexOf('/api/kv?key=agent-digest', push);
  ok(guard > push && guard < send, 'the guard sits BEFORE the fetch, so a bad period never leaves the browser');
  const agent = fsSync.readFileSync(pathSync.join(REPO, 'agent', 'index.html'), 'utf8');
  ok(!/MTD · this month so far/.test(agent),
    'the campaign header no longer hardcodes "this month so far" over whatever arrived');
}

console.log('G. THE ROSTER DRILL-DOWN CARRIES NAMES');
{
  const b3 = cmOverviewBody(digest, authorise(cmUser, digest), { requests: [] }, globalThis.__cmCtx);
  const c3 = b3.campaigns.find((c) => c.key === 'cuddle');
  ok(Array.isArray(c3.agentIndex) && c3.agentIndex.length > 0 && c3.agentIndex[0].name,
    'agentIndex travels, so expanding a team prints names not bare CB codes');
}


console.log('J. A SECOND REQUEST AFTER THE FIRST CLOSED (HighLevel: one card per contact, ever — 2026-09-21)');
/* self-contained: a fresh floor, Shane raises a dialler request and the manager works it to the gates */
OPPS = []; for (const k of Object.keys(RULES)) if (/^kv:cm-areq/.test(k)) delete RULES[k];
globalThis.__cmMir = null; globalThis.__cmArch = null; globalThis.__cmPipe = null;
r = await assistCreate(env, DB, tl2User, digest, ctx, { blockage: 'dialler', description: 'dialler drops every call', priority: 'P1', campaign: 'Cuddle' });
const reqId2 = r.body.id;
ok(r.status === 200 && reqId2, 'Shane raises a dialler request');
await assistAct(env, DB, cmUser, digest, ctx, { id: reqId2, action: 'start' });
await assistAct(env, DB, cmUser, digest, ctx, { id: reqId2, action: 'complete', resolution: 'reset the carrier trunk' });
await assistAct(env, DB, cmUser, digest, ctx, { id: reqId2, action: 'evidence', text: 'trunk log' });
r = await assistAct(env, DB, tl2User, digest, ctx, { id: reqId2, action: 'confirm_tl' });
ok(r.status === 200 && (r.body.blockers || []).length === 0, 'the team leader confirms and nothing blocks');
globalThis.__cmMir = null;
r = await assistList(env, DB, tl2User, digest, ctx);
ok(r.body.requests.length === 1 && r.body.requests[0].closed === true, 'the request is Closed on the register');
ok(OPPS.find((o) => o.id === reqId2).status === 'won', 'and HighLevel holds the card as won');
/* A HIGHLEVEL HICCUP ON THE REOPEN PUTS EVERYTHING BACK (review, 2026-09-21): no archive row left behind,
   the old record restored — never the same closed request counted twice. */
globalThis.__cmMir = null; globalThis.FAIL_NEXT_PUT = true;
let threw = null; try { await assistCreate(env, DB, tl2User, digest, ctx, { blockage: 'leads', description: 'first try', priority: 'P2', campaign: 'Cuddle' }); } catch (e) { threw = e; }
ok(threw && /HighLevel/.test(String(threw.message)), 'a failed reopen surfaces as an error (the route turns it into a plain message)');
ok(!Object.keys(RULES).some((k) => k.startsWith('kv:cm-areq-arch:' + reqId2)), 'no archive row was left behind');
ok(RULES['kv:cm-areq:' + reqId2].resolution === 'reset the carrier trunk' && RULES['kv:cm-areq:' + reqId2].blockage === 'dialler', 'the closed request record is back in place');
globalThis.__cmMir = null; globalThis.__cmArch = null;
r = await assistList(env, DB, cmUser, digest, ctx);
ok(r.body.requests.length === 1 && r.body.requests[0].closed, 'the register still shows exactly one, closed request — nothing double-counted');
/* HighLevel would now refuse a NEW card for Shane (the stub does too). The next request REUSES the card. */
globalThis.__cmMir = null;
r = await assistCreate(env, DB, tl2User, digest, ctx, { blockage: 'leads', description: 'no leads loaded this morning', priority: 'P2', campaign: 'Cuddle' });
ok(r.status === 200 && r.body.ok && r.body.id === reqId2 && !r.body.merged, 'a later request from the same team leader goes through — on the same card (' + r.status + ')');
const card = OPPS.find((o) => o.id === reqId2);
ok(card.status === 'open' && card.pipelineStageId === 'st0' && /^\[leads\]/.test(card.name), 'the card is back at New, open, renamed to the new blockage');
const archKeys = Object.keys(RULES).filter((k) => k.startsWith('kv:cm-areq-arch:' + reqId2 + ':'));
ok(archKeys.length === 1 && RULES[archKeys[0]].resolution === 'reset the carrier trunk' && RULES[archKeys[0]].card && RULES[archKeys[0]].card.blockage === 'dialler', 'the closed dialler request was archived with its record and card');
ok(RULES['kv:cm-areq:' + reqId2].blockage === 'leads' && !RULES['kv:cm-areq:' + reqId2].assistance_started_at, 'the live mirror is the NEW request — fresh clock, nothing inherited');
globalThis.__cmMir = null; globalThis.__cmArch = null;
r = await assistList(env, DB, tl2User, digest, ctx);
ok(r.body.requests.length === 2 && r.body.requests.filter((x) => x.closed).length === 1 && r.body.requests.filter((x) => !x.closed).length === 1, 'the team leader sees both: the closed dialler request (archived) and the open leads one');
const archived = r.body.requests.find((x) => x.archived);
ok(archived && archived.closed && archived.blockage === 'dialler' && archived.resolutionMins != null && archived.status === 'Resolved', 'the archived row is closed, resolved, and still carries its resolution time for the KPIs');
r = await assistList(env, DB, cmUser, digest, ctx);
ok(r.body.kpis.received === 2 && r.body.kpis.open === 1 && r.body.kpis.sessionsCompleted === 1, 'the manager KPIs count both requests (received 2, open 1, completed 1) — the archived one still counts');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
