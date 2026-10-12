/**
 * THE DEMO BACKEND (spec 005, research R2) — the REAL Worker (worker/src/index.mjs), run in this Node process, with every
 * service it talks to replaced by an in-memory fake holding the fictional floor:
 *
 *   Supabase PostgREST + Storage  → `rules`, `app_users`, `app_sessions` (+ any table, empty) and a storage map
 *   Convex Coaching Hub / KPI Hub → coaching sessions and KPI forms for the four fictional team leaders
 *   HighLevel                     → the Help Center, coaching and Campaign Assistance pipelines
 *   Workers AI (env.AI)           → a fixed, clearly-worded answer
 *
 * Nothing leaves the machine: the fake `fetch` answers those hosts and refuses everything else. The Worker's own code
 * decides every answer the pages get — sign-in, role lockdown, scoping, the digest slices, the coaching lock.
 *
 * The Node clock is SHIFTED (still running) so "now" is the demo's Tuesday morning — the Worker's freshness checks,
 * cycles and SLA clocks read the same day the browser does.
 */
import crypto from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PEOPLE, TEAM_LEADERS, CAMPAIGN_MANAGER, CLOCK, DAYS } from './floor.mjs';

const SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAAAQCAYAAACm53kpAAAAQ0lEQVR42u3QQQ0AAAgDILV/52nBuQkqYK1nZhcYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACw2GgIRAY2B0NwAAAAASUVORK5CYII=';
const SUPA = 'demo.supabase.local';
const HUB_COACH = 'acrobatic-setter-212.eu-west-1.convex.cloud';
const HUB_KPI = 'cautious-bass-675.eu-west-1.convex.cloud';
const HL = 'services.leadconnectorhq.com';
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const iso = (ms) => new Date(ms).toISOString();

/* ---------------------------------------------------------------- the clock */
function shiftClock() {
  if (globalThis.Date.__demoShift) return;
  const RealDate = globalThis.Date;
  const DELTA = RealDate.now() - Date.parse(CLOCK);
  class DemoDate extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(RealDate.now() - DELTA); }
    static now() { return RealDate.now() - DELTA; }
  }
  DemoDate.__demoShift = true;
  globalThis.Date = DemoDate;
}

/* ---------------------------------------------------------------- PostgREST, in memory */
function postgrest() {
  const PK = { rules: 'key', app_users: 'id', app_sessions: 'token_hash' };
  const T = {};
  let auto = 1;
  const table = (t) => (T[t] = T[t] || new Map());
  const field = (row, expr) => {
    const parts = expr.split(/->>?/);
    let v = row[parts[0]];
    for (const p of parts.slice(1)) v = v == null ? undefined : v[p];
    if (/->>/.test(expr) && v != null && typeof v === 'object') v = JSON.stringify(v);
    return v;
  };
  const test = (v, op, arg) => {
    const s = v == null ? null : (typeof v === 'object' ? JSON.stringify(v) : String(v));
    switch (op) {
      case 'eq': return s === arg;
      case 'neq': return s !== arg;
      case 'gt': return s != null && s > arg;
      case 'gte': return s != null && s >= arg;
      case 'lt': return s != null && s < arg;
      case 'lte': return s != null && s <= arg;
      case 'like': case 'ilike': {
        const re = new RegExp('^' + arg.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/[*%]/g, '.*') + '$', op === 'ilike' ? 'i' : '');
        return s != null && re.test(s);
      }
      case 'in': { const list = arg.replace(/^\(|\)$/g, '').split(',').map((x) => x.replace(/^"|"$/g, '')); return s != null && list.includes(s); }
      case 'is': return arg === 'null' ? v == null : arg === 'true' ? v === true : arg === 'false' ? v === false : false;
      default: return true;
    }
  };
  const cond = (row, col, raw) => {
    let neg = false, v = raw;
    if (v.startsWith('not.')) { neg = true; v = v.slice(4); }
    const i = v.indexOf('.');
    const r = test(field(row, col), v.slice(0, i), v.slice(i + 1));
    return neg ? !r : r;
  };
  const splitTop = (s) => { const out = []; let d = 0, cur = ''; for (const ch of s) { if (ch === '(') d++; if (ch === ')') d--; if (ch === ',' && !d) { out.push(cur); cur = ''; } else cur += ch; } if (cur) out.push(cur); return out; };
  const matches = (row, params) => {
    for (const [k, v] of params) {
      if (['select', 'order', 'limit', 'offset'].includes(k)) continue;
      if (k === 'or' || k === 'and') {
        const items = splitTop(v.replace(/^\(|\)$/g, '')).map((it) => /^([^.]+)\.(.*)$/.exec(it)).filter(Boolean);
        const res = items.map((m) => cond(row, m[1], m[2]));
        if (k === 'or' ? !res.some(Boolean) : !res.every(Boolean)) return false;
        continue;
      }
      if (!cond(row, k, v)) return false;
    }
    return true;
  };
  const project = (row, sel, t) => {
    if (!sel || sel === '*') return { ...row };
    const out = {};
    for (const item of splitTop(sel)) {
      const emb = /^(\w+)\((.*)\)$/.exec(item);
      if (emb) {
        const target = emb[1], cols = emb[2].split(',');
        const fk = t === 'app_sessions' && target === 'app_users' ? table('app_users').get(row.user_id) : null;
        out[target] = fk ? Object.fromEntries(cols.map((c) => [c, fk[c]])) : null;
        continue;
      }
      const [alias, expr] = item.includes(':') ? item.split(':') : [item.split(/->>?/).pop(), item];
      out[alias] = field(row, expr);
    }
    return out;
  };
  async function handle(url, method, prefer, bodyText) {
    const rel = url.pathname.replace(/^\/rest\/v1\//, '');
    if (rel.startsWith('rpc/')) return { status: 200, body: null, log: 'rpc ' + rel };
    const t = rel, params = [...url.searchParams.entries()];
    const tab = table(t), pk = PK[t];
    const sel = url.searchParams.get('select');
    const hit = () => [...tab.values()].filter((r) => matches(r, params));
    if (method === 'GET') {
      let rows = hit();
      const order = url.searchParams.get('order');
      if (order) { const [c, dir] = order.split('.'); rows.sort((a, b) => (String(field(a, c)) < String(field(b, c)) ? -1 : 1) * (dir === 'desc' ? -1 : 1)); }
      const lim = +url.searchParams.get('limit') || 0; if (lim) rows = rows.slice(0, lim);
      return { status: 200, body: rows.map((r) => project(r, sel, t)) };
    }
    if (method === 'POST') {
      const list = [].concat(JSON.parse(bodyText || '[]'));
      const upsert = /merge-duplicates/.test(prefer);
      const out = [];
      for (const r of list) {
        const id = pk ? r[pk] : 'auto' + auto++;
        if (pk && tab.has(id) && !upsert) return { status: 409, body: { code: '23505', message: 'duplicate key value violates unique constraint' } };
        const row = { ...(upsert && tab.get(id) || {}), ...r };
        if (t === 'rules' && !row.updated_at) row.updated_at = iso(Date.now());
        tab.set(id, row); out.push(row);
      }
      return { status: 201, body: /return=representation/.test(prefer) ? out : null };
    }
    if (method === 'PATCH') {
      const patch = JSON.parse(bodyText || '{}');
      const rows = hit(); for (const r of rows) Object.assign(r, patch);
      return { status: 200, body: /return=representation/.test(prefer) ? rows : null };
    }
    if (method === 'DELETE') { for (const r of hit()) tab.delete(pk ? r[pk] : [...tab.entries()].find(([, v]) => v === r)[0]); return { status: 204, body: null }; }
    return { status: 405, body: { message: 'method' } };
  }
  return { T, table, handle };
}

/* ---------------------------------------------------------------- the fictional Hubs and HighLevel */
function hubs() {
  const leaders = [...TEAM_LEADERS.map((t, i) => ({ _id: 'hub-tl-' + (i + 1), name: t.name })), { _id: 'hub-cm', name: CAMPAIGN_MANAGER.name }];
  const hubOf = (name) => leaders.find((l) => l.name === name)._id;
  const coaching = { formalCoachingCalls: [], informalCoaching: [], qualityAssuranceCoaching: [], leadManagementCoaching: [], groupCoaching: [], qualityCoaching: [] };
  let n = 1;
  const add = (t, rec) => coaching[t].push({ _id: 'cs' + (n++), _creationTime: Date.parse(rec.date || rec.dateOfCoaching) + 3600000, ...rec });
  const sept = DAYS.filter((d) => d >= '2026-09-01');
  const cbHub = (code) => 'CB-' + code.slice(2);
  const THEMES = ['gap.objection_handling', 'gap.pitch_value_creation', 'gap.customer_verification', 'gap.communication_call_control', 'gap.compliance_required_wording'];
  PEOPLE.forEach((p, i) => {
    const hub = hubOf(p.tl), d1 = sept[(i * 3) % sept.length], d2 = sept[(i * 5 + 7) % sept.length];
    const theme = THEMES[i % THEMES.length];
    add('formalCoachingCalls', { teamLeaderId: hub, teamLeaderName: p.tl, date: d1, campaign: p.campaign, agentName: p.name, employeeNumber: cbHub(p.code), employeeCode: p.code,
      calls: [{ contactNumber: '0800000' + String(100 + i), developmentAreas: 'Moved to price before building value; customer pushed back on cost.' },
        { contactNumber: '0800000' + String(200 + i), developmentAreas: 'Strong verification and a clean close.' }, { contactNumber: '', developmentAreas: '' }],
      supportProvided: 'Listened to two calls together; role-played the price objection.', agreedPlanAgentFeedback: 'Will build value before quoting and ask for the sale twice.',
      clusterGap: theme, clusterAgentCommitment: 'commitment.improve_objection_handling', clusterSupportProvided: 'support.role_play_practice', clusterSource: 'coach',
      agentSignature: SIG, teamLeaderSignature: SIG });
    if (i % 2 === 0) add('informalCoaching', { teamLeaderId: hub, teamLeaderName: p.tl, date: d2, campaign: p.campaign, agentName: p.name, employeeNumber: cbHub(p.code), employeeCode: p.code,
      teamLeaderFeedback: 'Great energy on the floor this week — keep the opening tight.', agentFeedback: 'Thanks, I will keep using the new opener.', wayForward: 'Check in on Friday.',
      clusterTeamLeaderFeedback: 'gap.communication_call_control', clusterAgentCommitment: 'commitment.improve_communication', clusterNextAction: 'commitment.apply_coaching_targets', clusterSource: 'coach',
      agentSignature: SIG, teamLeaderSignature: SIG });
    if (i % 3 === 0) add('qualityAssuranceCoaching', { teamLeaderId: hub, teamLeader: p.tl, dateOfCoaching: d2, qaEvaluationDate: d1, callDate: d1, caseNumbers: 'CS' + (401000 + i), qaScore: String(Math.round(p.qa * 100)),
      campaign: p.campaign, agentName: p.name, employeeNumber: cbHub(p.code), employeeCode: p.code, developmentAreas: 'Required wording on the debit order was rushed.',
      teamLeaderComments: 'Read the mandate slowly and confirm understanding.', agentFeedback: 'Understood — I will slow down on the mandate.', clusterPurpose: 'purpose.quality_compliance',
      clusterDevelopmentArea: 'gap.compliance_required_wording', clusterTeamLeaderGuidance: 'gap.compliance_required_wording', clusterAgentCommitment: 'commitment.use_required_wording', clusterSource: 'coach',
      agentSignature: SIG, agentSignDate: d2, teamLeaderSignature: SIG, teamLeaderSignDate: d2 });
    if (p.campaign !== 'Courtesy' && i % 2 === 1) add('leadManagementCoaching', { teamLeaderId: 'hub-cm', sosName: CAMPAIGN_MANAGER.name, date: d2, campaign: p.campaign, agentName: p.name,
      employeeNumber: cbHub(p.code), employeeCode: p.code, developmentAreas: 'Leads left at 1st attempt for more than three days.', sosComments: 'Work the oldest leads first each morning.',
      agentFeedback: 'Will clear the 1st-attempt queue before 10:00.', clusterPurpose: 'purpose.lead_management', clusterGap: 'gap.lead_management', clusterGuidance: 'gap.lead_management',
      clusterAgentCommitment: 'commitment.follow_lead_process', clusterSource: 'coach', agentSignature: SIG, sosSignature: SIG, signDate: d2 });
  });
  for (const t of TEAM_LEADERS) {
    const team = PEOPLE.filter((p) => p.tl === t.name).slice(0, 5);
    add('groupCoaching', { teamLeaderId: hubOf(t.name), teamLeaderName: t.name, date: '2026-09-15', campaign: t.campaign, coachingDetails: 'Team huddle: the new product bundle and how to position it.',
      feedback1: 'Lead with the benefit, then the price.', feedback2: 'Use the bundle when the customer has more than one policy.', feedback3: 'Share wins in the group chat.',
      employeeSignoffs: team.map((p) => ({ employeeName: p.name, date: '2026-09-15', signature: SIG })) });
  }
  const kpi = [];
  const leah = PEOPLE.filter((p) => p.tl === 'Leah Marais');
  leah.forEach((p, i) => kpi.push({ _id: 'kf' + (i + 1), leaderId: 'kpi-tl-1', title: i === 4 ? 'Performance Improvement Program (PIP)' : 'Monthly KPI Acknowledgement Form',
    agentName: p.name, weekLabel: 'Week ' + (1 + (i % 4)) + ' / 5', month: 'September', year: 2026, status: i < 3 ? 'submitted' : 'draft', createdAt: Date.parse('2026-09-0' + (2 + i) + 'T09:00:00Z'), formData: '{}' }));
  return { leaders, coaching, kpi };
}

function highlevel() {
  const STD = ['New', 'In progress', 'Waiting on agent', 'Closed'];
  const pipes = [
    ['pipe-help', 'Agent Help Center', STD], ['pipe-act', 'Coaching Actions', ['To do', 'In progress', 'Done']], ['pipe-fail', 'Coaching Fails', ['New', 'Coaching booked', 'Resolved']],
    ['pipe-sess', 'Coaching Sessions', ['Logged']], ['pipe-cm', 'Campaign Assistance', ['New', 'Triaged', 'Assisting', 'Awaiting confirmation', 'Follow-up due', 'Closed']],
  ].map(([id, name, st]) => ({ id, name, stages: st.map((s, i) => ({ id: id + '-s' + i, name: s, position: i })) }));
  const st = { opps: [], notes: {}, contacts: 0, n: 0 };
  const stamp = () => iso(Date.now() + (st.n++));
  function handle(url, method, body) {
    const p = url.pathname;
    if (p === '/opportunities/pipelines') return { status: 200, body: { pipelines: pipes } };
    if (p === '/opportunities/search') {
      const pid = url.searchParams.get('pipeline_id') || (body && (body.pipelineId || body.pipeline_id));
      const ops = st.opps.filter((o) => !pid || o.pipelineId === pid).slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      return { status: 200, body: { opportunities: ops, meta: { total: ops.length } } };
    }
    if (p === '/opportunities/' && method === 'POST') { const t = stamp(); const o = { id: 'opp' + (st.opps.length + 1), ...body, createdAt: t, updatedAt: t, lastStatusChangeAt: t }; st.opps.push(o); return { status: 201, body: { opportunity: o } }; }
    let m = /^\/opportunities\/([^/]+)$/.exec(p);
    if (m) { const o = st.opps.find((x) => x.id === decodeURIComponent(m[1])); if (!o) return { status: 404, body: { message: 'not found' } };
      if (method === 'PUT') Object.assign(o, body, { updatedAt: stamp() }); return { status: 200, body: { opportunity: o } }; }
    m = /^\/contacts\/([^/]+)\/notes$/.exec(p);
    if (m) { const c = m[1]; st.notes[c] = st.notes[c] || [];
      if (method === 'POST') { const nt = { id: 'n' + (st.n++), body: body.body, dateAdded: stamp() }; st.notes[c].push(nt); return { status: 201, body: { note: nt } }; }
      return { status: 200, body: { notes: st.notes[c].slice().reverse() } }; }
    if ((p === '/contacts/' || p === '/contacts/upsert') && method === 'POST') { const id = 'c' + (++st.contacts); return { status: 201, body: { contact: { id }, new: true } }; }
    if (p === '/contacts/' && method === 'GET') return { status: 200, body: { contacts: [], meta: { total: 0 } } };
    if (/^\/locations\/[^/]+\/customFields$/.test(p)) return { status: 200, body: { customFields: [] } };
    return { status: 404, body: { message: 'demo: unhandled HighLevel ' + method + ' ' + p } };
  }
  return { st, handle };
}

/* ---------------------------------------------------------------- the NBA digest the management app would publish */
function nbaDigest(digest, { story = null, conv = {} } = {}) {
  const agents = (digest.agents || []).map((a) => {
    const crit = a.code === 'CB9129';
    const pct = a.pctT == null ? null : a.pctT, qa = a.qa == null ? null : a.qa, cv = conv[a.code] == null ? null : conv[a.code];
    /* video 2 (spec 026): the Ops ladder's own R6 / R7 wording (Chatterbox_AgentOS_Analytics.html 4395, 4408; salesLow 70,
       salesNear 90, convTarget 10%) — opt-in, so specs 005/008/009 keep the payload they were recorded with */
    const v2 = story === 'v2';
    const nba = crit ? { lvl: 1, code: 'P2', label: 'Critical compliance failure', reason: 'A critical fail on a September QA evaluation.', action: 'Formal coaching within 48 hours and a compliance refresher.', h: 48 }
      : pct != null && pct < 0.7 ? { lvl: 2, code: 'R1', label: 'Sales volume below plan', reason: Math.round(pct * 100) + '% of target with the month nearly done.', action: 'Daily call review and a pitch refresher this week.', h: 72 }
      : v2 && pct != null && pct < 0.9 ? { lvl: 2, code: 'R6', label: 'Low Sales Achievement', reason: 'Volume at ' + Math.round(pct * 100) + '% of target (70–90% band).', action: 'Sales coaching every 2 weeks: objection roleplays, peer pairing, activity review; add conversion training if low.', h: 336 }
      : qa != null && qa < 0.88 ? { lvl: 3, code: 'R5', label: 'Quality below standard', reason: 'QA average ' + Math.round(qa * 100) + '% against 90%.', action: 'Coach the weakest criterion on the next evaluation.', h: 120 }
      : v2 && cv != null && cv < 0.1 ? { lvl: 3, code: 'R7', label: 'Critical Conversion Failure', reason: 'Conversion ' + (Math.round(cv * 1000) / 10) + '% — below the 10% tenure target.', action: 'Conversion masterclass within 5 days: pipeline review, closing calls, closing skills, follow-up.', h: 120 }
      : { lvl: 4, code: 'R10', label: 'Develop & recognise', reason: 'On plan for value and volume.', action: 'Recognise the month and stretch the target.', h: null };
    /* the units the page reads (agent/index.html 2383, 2426): ta in PERCENT, gwpSale in rands INCLUDING VAT, qa/att as fractions */
    const saleIncl = a.aveG == null ? null : Math.round(a.aveG * 1.15 * 100) / 100;
    const both = pct != null && pct >= 1 && (saleIncl == null || saleIncl >= 99);
    const adj = a.composite && a.composite.adj != null ? a.composite.adj : null;
    const driver = pct != null && pct < 0.9 ? { key: 'targetAch', label: 'Target achievement', points: Math.round((1 - pct) * 300) / 10 }
      : qa != null && qa < 0.9 ? { key: 'qa', label: 'Call quality', points: Math.round((0.9 - qa) * 400) / 10 }
      : { key: 'attendance', label: 'Attendance', points: Math.round((1 - (a.att == null ? 1 : a.att)) * 200) / 10 + 0.5 };
    return { cb: a.code, name: a.name, tl: a.tl, nba, composite: { adj, raw: adj, pen: 0 }, r2a: { fails: 0, tier: null, elite: null },
      twoCheck: { status: both ? 'Both Pass' : pct != null && pct >= 1 ? 'Value only' : 'Volume short', gwpSale: saleIncl, ta: pct == null ? null : Math.round(pct * 1000) / 10 },
      stats: { sales: a.sales, ta: pct == null ? null : Math.round(pct * 1000) / 10, gwpSale: saleIncl, qa, att: a.att == null ? null : a.att, conv: null, talkDay: a.aveTalk == null ? null : a.aveTalk },
      driver };
  });
  return { updatedAt: iso(Date.now() - 3600000), period: digest.period, workDays: digest.workingDays,
    thresholds: { gwpFloor: 99, qaTarget: 90, attTarget: 95, convTarget: 10, talkTargetMin: 210 }, agents };
}

/* ---------------------------------------------------------------- assemble */
export async function createBackend({ root, vas, story = null, conv = {} }) {
  shiftClock();
  const db = postgrest();
  const hub = hubs();
  const hl = highlevel();
  const unhandled = [];
  const json = (status, body) => new Response(body == null ? '' : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const method = String(init.method || (typeof input !== 'string' && input.method) || 'GET').toUpperCase();
    const bodyText = init.body == null ? null : (typeof init.body === 'string' ? init.body : Buffer.from(await new Response(init.body).arrayBuffer()).toString('utf8'));
    const hdr = new Headers(init.headers || {});
    if (url.host === SUPA && url.pathname.startsWith('/rest/v1/')) {
      const r = await db.handle(url, method, hdr.get('prefer') || '', bodyText);
      if (r.log) unhandled.push(r.log);
      return json(r.status, r.body);
    }
    if (url.host === SUPA && url.pathname.startsWith('/storage/v1/object/')) {
      const key = decodeURIComponent(url.pathname.replace(/^\/storage\/v1\/object\//, ''));
      const store = db.table('__storage');
      if (method === 'GET') return store.has(key) ? new Response(store.get(key).v, { status: 200 }) : json(400, { error: 'not_found', message: 'Object not found' });
      if (method === 'POST' || method === 'PUT') { store.set(key, { v: bodyText }); return json(200, { Key: key }); }
      return json(404, { error: 'demo' });
    }
    if (url.host === HUB_COACH || url.host === HUB_KPI) {
      const { path: fn, args = {} } = JSON.parse(bodyText || '{}');
      let value = null;
      if (url.host === HUB_COACH) {
        const [t, op] = fn.split(':');
        if (fn === 'teamLeaders:list') value = hub.leaders;
        else if (op === 'list') value = (hub.coaching[t] || []).filter((r) => r.teamLeaderId === args.teamLeaderId);
        else if (op === 'get') value = Object.values(hub.coaching).flat().find((r) => r._id === args.id) || null;
        else if (op === 'create') { const id = 'cs-new-' + Date.now(); (hub.coaching[t] = hub.coaching[t] || []).push({ _id: id, _creationTime: Date.now(), ...args }); value = id; }
      } else {
        if (fn === 'forms:listByLeader') value = hub.kpi.filter((f) => f.leaderId === args.leaderId);
        else if (fn === 'forms:createForm') { const id = 'kf-new-' + Date.now(); hub.kpi.push({ _id: id, ...args, status: 'draft', createdAt: Date.now(), formData: '{}' }); value = id; }
        else if (/^forms:(updateForm|submitForm|deleteForm)$/.test(fn)) value = null;
      }
      return json(200, { status: 'success', value });
    }
    if (url.host === HL) {
      const r = hl.handle(url, method, bodyText ? JSON.parse(bodyText) : null);
      if (r.status === 404) unhandled.push(r.body.message);
      return json(r.status, r.body);
    }
    unhandled.push('refused: ' + method + ' ' + url.host + url.pathname);
    return json(503, { error: 'demo: no network' });
  };

  const env = { SUPABASE_URL: 'https://' + SUPA, SUPABASE_SECRET_KEY: 'demo', HL_HELP_API_KEY: 'demo', HL_HELP_LOCATION_ID: 'loc-help', HL_API_KEY: 'demo', HL_LOCATION_ID: 'loc-main',
    AI: { run: async () => ({ response: 'Strong month: volume is ahead of plan and value per sale is holding above the floor. To finish stronger, protect the first hour of each shift for outbound calls and keep building value before quoting price.' }) } };
  const ctx = { waitUntil: (p) => Promise.resolve(p).catch(() => {}), passThroughOnException() {} };

  /* the people who sign in, and their sessions */
  const users = [
    { id: 'u-admin', username: 'demo-admin', full_name: 'Demo Administrator', role: 'admin', apps: ['vas', 'ops', 'agent'], tabs: {}, pii_unmask: true, active: true, theme: 'light' },
    ...TEAM_LEADERS.map((t, i) => ({ id: 'u-tl-' + (i + 1), username: t.username, full_name: t.name, role: 'team_leader', cb: t.cb, team: t.name, apps: ['agent'], tabs: {}, active: true,
      hub_ids: { coaching: 'hub-tl-' + (i + 1), kpi: 'kpi-tl-' + (i + 1) }, theme: 'light' })),
    { id: 'u-cm', username: CAMPAIGN_MANAGER.username, full_name: CAMPAIGN_MANAGER.name, role: 'campaign_manager', apps: ['agent'], tabs: {}, active: true, hub_ids: { coaching: 'hub-cm' }, theme: 'light' },
    ...PEOPLE.map((p) => ({ id: 'u-' + p.code, username: p.code.toLowerCase(), full_name: p.name, role: 'agent', cb: p.code, apps: ['agent'], tabs: {}, active: true, theme: 'light' })),
  ];
  const tokens = {};
  for (const u of users) {
    db.table('app_users').set(u.id, { must_change_password: false, ...u });
    const tok = 'demo-' + u.username;
    tokens[u.username] = tok;
    db.table('app_sessions').set(sha(tok), { token_hash: sha(tok), user_id: u.id, scope: 'full', expires_at: '2030-01-01T00:00:00Z' });
  }
  const rule = (key, value) => db.table('rules').set(key, { key, value, updated_by: 'demo', updated_at: iso(Date.now() - 2 * 3600000) });

  /* what PULSE published (exactly), plus the copies the other jobs keep */
  rule('kv:agent-digest', { data: JSON.stringify(vas.digest), period: vas.digest.period });
  rule('kv:agent-reports-variance', { data: JSON.stringify(vas.variance) });
  rule('kv:agent-reports-leads', { data: JSON.stringify(vas.leads) });
  rule('kv:nba-digest', { data: JSON.stringify(nbaDigest(vas.digest, { story, conv })) });
  rule('kv:agent-links', { items: [
    { title: 'Salesforce', sub: 'Cases, quotes and the customer record', url: 'https://example.com/salesforce' },
    { title: 'ViciDial', sub: 'The dialler — sign in at the start of every shift', url: 'https://example.com/vicidial' },
    { title: 'Product guide', sub: 'Every product, benefit and price in one place', url: 'https://example.com/products' },
  ] });   // no Wimpy link: the demo shows Chatterbox AgentOS only (spec 007 FR-001)
  rule('cm:assignments', { [CAMPAIGN_MANAGER.username]: { name: CAMPAIGN_MANAGER.name, campaigns: CAMPAIGN_MANAGER.campaigns } });
  /* the two big exports that take the large-file path every morning */
  const upl = (id, file_name, source, mb, rows, at) => db.table('upload_files').set(id, { id, file_name, source, status: 'loaded', bytes: Math.round(mb * 1048576),
    rows_in: rows, rows_loaded: rows, rows_rejected: 0, error: null, received_at: at, validated_at: at, loaded_at: at, uploaded_by: 'demo-admin' });
  upl('uf-1', 'Open Cases Lead Management 29.09.2026.csv', 'SF_OPEN_CASES', 41.3, 182400, '2026-09-29T05:52:00Z');
  upl('uf-2', 'Power BI Active Cases 29.09.2026.xlsx', 'BI_ACTIVE_CASES', 36.8, 96120, '2026-09-29T05:41:00Z');

  const W = (f) => pathToFileURL(path.join(root, 'worker', 'src', f)).href;
  const worker = (await import(W('index.mjs'))).default;
  const { fetchCoaching } = await import(W('coaching.mjs'));
  const snap = await fetchCoaching(env);                 // the Worker's own pull, against the fictional Hub
  rule('kv:coaching', { data: JSON.stringify(snap), fetchedAt: snap.fetchedAt, sessions: snap.sessions.length });

  const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type,x-cbx-client,x-cbx-base,content-encoding',
    'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS', 'access-control-expose-headers': 'X-Cbx-Version' };
  /** Call the Worker directly (seeding, checks). */
  async function call(method, apiPath, { as, body } = {}) {
    const h = { 'content-type': 'application/json', 'x-cbx-client': 'v5' };
    if (as) h.authorization = 'Bearer ' + tokens[as];
    const res = await worker.fetch(new Request('https://chatterbox-agentos-api.chatterbox-agentos.workers.dev' + apiPath, { method, headers: h, body: body == null ? undefined : JSON.stringify(body) }), env, ctx);
    const text = await res.text();
    let j = null; try { j = text ? JSON.parse(text) : null; } catch (e) { j = { raw: text }; }
    return { status: res.status, json: j };
  }
  /** Answer one browser request with the Worker. `as` signs a token-less page (VAS Analytics) in as staff. */
  async function route(r, { as } = {}) {
    const req = r.request();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    const headers = { ...req.headers() };
    /* PULSE sends "Bearer " with an EMPTY token when it is not signed in — sign it in as staff for these reads */
    if (as && !/^Bearer\s+(?!null$|undefined$)\S/.test(headers.authorization || '')) headers.authorization = 'Bearer ' + tokens[as];
    const buf = req.postDataBuffer();
    const res = await worker.fetch(new Request(req.url(), { method: req.method(), headers, body: buf && req.method() !== 'GET' ? buf : undefined }), env, ctx);
    const out = {}; res.headers.forEach((v, k) => { out[k] = v; }); Object.assign(out, CORS);
    return r.fulfill({ status: res.status, headers: out, body: Buffer.from(await res.arrayBuffer()) });
  }
  return { worker, env, db, hub, hl, tokens, users, call, route, unhandled, restoreFetch: () => { globalThis.fetch = realFetch; } };
}
