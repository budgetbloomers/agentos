#!/usr/bin/env node
/**
 * verify-coaching-drafts.mjs — spec 004-coaching-drafts-submit-lock.
 *
 *   node nicks_code/diagnostics/verify-coaching-drafts.mjs
 *
 * WHY: UAT, 2026-10-05 — "Allow TL to create coaching doc, save the draft and edit, but when click submit, he must not
 * be able view". The Coaching Hub has no draft state, so drafts live in the Worker (one `rules` row per draft, owner =
 * the session's user id); Submit sends a draft to the Hub exactly once; after that a team leader sees a line, never
 * the document — enforced in the Worker, not by hiding a button. Signatures may be drawn on a draft, but changing the
 * content after signing clears them. Pure: an in-memory PostgREST fake, a stubbed Convex, the page in a stubbed DOM.
 *
 *   A  drafts        save / list / open / re-save / delete, owner-only, compare-and-set, limits
 *   B  draft page    Save draft, the Drafts card, open a draft, a conflict keeps the form
 *   C  submit lock   exactly-once submit, failure keeps the draft, reopen; NO written content on any leader route
 *   D  locked page   sessions are lines (SUBMITTED + signature state), no View/Notes, no "edit it in the Hub" footer
 *   E  signatures    content change clears them (page) and a stale signature beside new content is dropped (Worker)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const SRC = (f) => pathToFileURL(path.join(ROOT, 'worker', 'src', f)).href;
const PAGE = fs.readFileSync(path.join(ROOT, 'agent', 'index.html'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'worker', 'src', 'index.mjs'), 'utf8');
const PORTAL_SRC = fs.readFileSync(path.join(ROOT, 'worker', 'src', 'portal.mjs'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, note) => { if (cond) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (note !== undefined ? ' — ' + note : '')); } };
const head = (t) => console.log('\n' + t);
const text = (h) => String(h).replace(/<[^>]*>/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const IMG = 'data:image/png;base64,TEST', IMG2 = 'data:image/png;base64,NEWER';
const tick = () => new Promise((r) => setImmediate(r));
const settle = async () => { for (let i = 0; i < 8; i++) await tick(); };

/* ------------------------------------------------------------------ an in-memory PostgREST `rules` table */
let CLOCK = Date.parse('2026-10-05T08:00:00.000Z');
const ROWS = new Map();
const pgTs = (iso) => String(iso).replace('Z', '+00:00');           // Postgres renders timestamptz like this — the code must re-use what it READ
const parseQ = (q) => { const i = q.indexOf('?'); return new URLSearchParams(i < 0 ? '' : q.slice(i + 1)); };
const matches = (row, p) => {
  for (const [k, v] of p) {
    if (k === 'select' || k === 'order' || k === 'limit') continue;
    const col = k === 'key' ? row.key : k === 'updated_at' ? row.updated_at : undefined;
    if (v.startsWith('eq.')) { if (col !== v.slice(3)) return false; }
    else if (v.startsWith('like.')) { const pre = v.slice(5).replace(/[*%]$/, ''); if (!String(col).startsWith(pre)) return false; }
    else return false;
  }
  return true;
};
const shape = (row, sel) => {
  if (!sel || sel === '*') return { ...row };
  const out = {};
  for (const part of sel.split(',')) {
    const [alias, expr] = part.includes(':') ? part.split(':') : [part, part];
    if (expr === 'value->meta') out[alias] = row.value && row.value.meta; else out[alias] = row[expr];
  }
  return out;
};
const clone = (o) => JSON.parse(JSON.stringify(o));
const DDB = {
  log: [],
  select: async (q) => { DDB.log.push('select ' + q); const p = parseQ(q); return [...ROWS.values()].filter((r) => matches(r, p)).map((r) => clone(shape(r, p.get('select')))); },
  insert: async (table, rows, upsert, returning) => {
    DDB.log.push('insert'); const out = [];
    for (const r of rows) {
      if (ROWS.has(r.key) && !upsert) throw new Error('supabase POST rules → 409: duplicate key');
      const row = { key: r.key, value: clone(r.value), updated_by: r.updated_by, updated_at: pgTs(r.updated_at || new Date(CLOCK).toISOString()) };
      ROWS.set(r.key, row); out.push(clone(row));
    }
    return returning ? out : null;
  },
  updateReturning: async (q, patch) => { DDB.log.push('patch ' + q); const p = parseQ(q); const hit = [...ROWS.values()].filter((r) => matches(r, p));
    for (const r of hit) { if (patch.value !== undefined) r.value = clone(patch.value); if (patch.updated_at) r.updated_at = pgTs(patch.updated_at); if (patch.updated_by) r.updated_by = patch.updated_by; }
    return hit.map(clone); },
  update: async (q, patch) => { await DDB.updateReturning(q, patch); return null; },
  del: async (q) => { DDB.log.push('del ' + q); if (DDB.beforeDel) { const h = DDB.beforeDel; DDB.beforeDel = null; h(); }
    const p = parseQ(q); for (const r of [...ROWS.values()]) if (matches(r, p)) ROWS.delete(r.key); return null; },
};

/* ------------------------------------------------------------------ a stubbed Convex */
const realFetch = globalThis.fetch;
let CONVEX = [], CONVEX_FAIL = null;
globalThis.fetch = async (url, o) => {
  const body = JSON.parse((o && o.body) || '{}');
  CONVEX.push({ path: body.path, args: body.args });
  if (CONVEX_FAIL) return { ok: true, status: 200, json: async () => ({ status: 'error', errorMessage: CONVEX_FAIL }) };
  const value = /:create$/.test(body.path) ? 'hub-' + CONVEX.length : (LISTS[body.path] || []);
  return { ok: true, status: 200, json: async () => ({ status: 'success', value }) };
};
let LISTS = {};

const D = await import(SRC('drafts.mjs')).catch((e) => ({ __missing: String(e.message || e) }));
const H = await import(SRC('hubs.mjs'));

const u1 = { user_id: 'u1', username: 'cb267', full_name: 'Denise Haripersad', role: 'team_leader', hub_ids: { coaching: 'L1' } };
const u2 = { user_id: 'u2', username: 'cb207', full_name: 'Renolan Pillay', role: 'team_leader', hub_ids: { coaching: 'L2' } };
const ids = { coaching: 'L1' };
const draftData = (o = {}) => ({ agentName: 'Ann Agent', employeeNumber: 'CB1', date: '2026-10-05', campaign: 'Courtesy',
  supportProvided: 'Partial notes', agreedPlanAgentFeedback: '', calls: [{ contactNumber: '', developmentAreas: 'Rushed the close.' }], ...o });
const save = (user, o) => D.draftsPost(DDB, user, ids, { action: 'save', type: 'formalCoachingCalls', ...o }, CLOCK);
const post = (user, o) => D.draftsPost(DDB, user, ids, o, CLOCK);
const get = (user, q) => D.draftsGet(DDB, user, q || {});

try {
  /* =================================================================== A */
  head('A · drafts: save, list, open, re-save, delete — the owner only, never overwritten');
  ok('worker/src/drafts.mjs exists and exports draftsGet / draftsPost / staleSigs', !D.__missing && typeof D.draftsGet === 'function' && typeof D.draftsPost === 'function' && typeof D.staleSigs === 'function', D.__missing);
  if (!D.__missing) {
    CONVEX = [];
    const s1 = await save(u1, { data: draftData({ agentSignature: IMG }) });
    ok('save new → 200 with an id and a version', s1.status === 200 && s1.body.ok && s1.body.id && s1.body.updatedAt, JSON.stringify(s1));
    const id = s1.body.id;
    ok('the row is keyed by the SESSION user: coach-draft:u1:<id>', ROWS.has('coach-draft:u1:' + id), JSON.stringify([...ROWS.keys()]));
    ok('a draft never reaches the Hub', CONVEX.length === 0, CONVEX.length);

    const L = await get(u1);
    const d = (L.body.drafts || [])[0] || {};
    ok('list (D1): one draft with product, agent, state and version', L.status === 200 && L.body.drafts.length === 1 && d.id === id && d.type === 'formalCoachingCalls' && d.label === 'Formal Coaching' && d.state === 'draft' && d.agentName === 'Ann Agent' && d.updatedAt === s1.body.updatedAt, JSON.stringify(L.body));
    ok('list: signature state per signatory (agent signed, team leader not)', (d.sigs || []).map((g) => g.label + ':' + g.signed).join(',') === 'Agent:true,Team leader:false', JSON.stringify(d.sigs));
    ok('list carries no content and no image', !JSON.stringify(L.body).includes('Partial notes') && !JSON.stringify(L.body).includes('data:image') && !('data' in d));
    ok('list reads meta only (the select names value->meta, not value)', DDB.log.some((l) => /select rules\?key=like\..*meta%3Avalue-%3Emeta|select rules\?key=like\..*meta:value->meta/.test(l)), DDB.log.filter((l) => l.startsWith('select')).slice(-2).join(' | '));

    const O = await get(u1, { id });
    ok('open (D2): the owner gets the whole form back, signature included', O.status === 200 && O.body.draft.data.supportProvided === 'Partial notes' && O.body.draft.data.agentSignature === IMG && O.body.draft.updatedAt === s1.body.updatedAt, JSON.stringify(O.body).slice(0, 200));
    ok('another team leader cannot open it (404)', (await get(u2, { id })).status === 404);
    ok('…does not see it in their list', ((await get(u2)).body.drafts || []).length === 0);
    ok('…cannot save over it (404)', (await save(u2, { id, base: s1.body.updatedAt, data: draftData() })).status === 404);
    ok('…cannot delete it (404)', (await post(u2, { action: 'delete', id })).status === 404 && ROWS.has('coach-draft:u1:' + id));

    CLOCK += 60000;
    const s2 = await save(u1, { id, base: s1.body.updatedAt, data: draftData({ supportProvided: 'More notes', agentSignature: IMG }) });
    ok('re-save on the current version → 200 with a NEW version', s2.status === 200 && s2.body.id === id && s2.body.updatedAt && s2.body.updatedAt !== s1.body.updatedAt, JSON.stringify(s2));
    CLOCK += 60000;
    const s3 = await save(u1, { id, base: s1.body.updatedAt, data: draftData({ supportProvided: 'Stale tab' }) });
    ok('a save on a stale version → 409 conflict, nothing overwritten', s3.status === 409 && s3.body.conflict === true && ROWS.get('coach-draft:u1:' + id).value.data.supportProvided === 'More notes', JSON.stringify(s3));
    ok('a re-save without a version is refused (400)', (await save(u1, { id, data: draftData() })).status === 400);
    ok('an unknown product is refused (400)', (await D.draftsPost(DDB, u1, ids, { action: 'save', type: 'teamLeaders', data: draftData() }, CLOCK)).status === 400);
    ok('an unreadable signature is refused on save too (400, named)', (r => r.status === 400 && /team leader signature/i.test(r.body.error || ''))(await save(u1, { data: draftData({ teamLeaderSignature: 'nope' }) })));
    ok('a draft over 1.5 MB → 413', (await save(u1, { data: draftData({ supportProvided: 'x'.repeat(1600000) }) })).status === 413);

    /* review M/L (2026-10-05): a submit claims the draft between delete's read and its delete — the delete must not report success */
    DDB.beforeDel = () => { const r = ROWS.get('coach-draft:u1:' + id); r.value.meta.state = 'submitting'; r.updated_at = pgTs(new Date(CLOCK + 5).toISOString()); };
    const raced = await post(u1, { action: 'delete', id });
    ok('a delete that loses to a submit claim says so (409) and the draft is still there', raced.status === 409 && ROWS.has('coach-draft:u1:' + id), JSON.stringify(raced));
    { const r = ROWS.get('coach-draft:u1:' + id); r.value.meta.state = 'draft'; }
    const del = await post(u1, { action: 'delete', id });
    ok('delete (D4) → 200 and the row is gone', del.status === 200 && !ROWS.has('coach-draft:u1:' + id), JSON.stringify(del));
    ok('…open after delete → 404', (await get(u1, { id })).status === 404);

    for (let i = 0; i < 50; i++) await save(u1, { data: draftData({ supportProvided: 'n' + i }) });
    const over = await save(u1, { data: draftData() });
    ok('the 51st draft is refused (409, asks to submit or delete one)', over.status === 409 && /50/.test(over.body.error || ''), JSON.stringify(over));
    for (const k of [...ROWS.keys()]) ROWS.delete(k);
  }
  ok('the route is wired: index.mjs serves /api/portal/hub/coaching/drafts behind hubIdsOf', /\/api\/portal\/hub\/coaching\/drafts/.test(INDEX) && /coaching\/drafts[\s\S]{0,400}hubIdsOf\(user\)/.test(INDEX));
  ok('…and the portal allow-list names it', PORTAL_SRC.includes("'/api/portal/hub/coaching/drafts'"));

  /* =================================================================== C */
  head('C · submit locks: exactly once, failure keeps the draft, and no leader route carries the written document');
  if (!D.__missing) {
    const a = await save(u1, { data: draftData({ agentSignature: IMG, teamLeaderSignature: IMG }) });
    CONVEX = [];
    const sub = await post(u1, { action: 'submit', id: a.body.id, base: a.body.updatedAt });
    const cr = CONVEX.filter((c) => c.path === 'formalCoachingCalls:create');
    ok('submit (D5) creates the document in the Hub once, under the session\'s Hub id', sub.status === 200 && sub.body.ok && cr.length === 1 && cr[0].args.teamLeaderId === 'L1' && cr[0].args.supportProvided === 'Partial notes', JSON.stringify(sub));
    ok('…with both signatures', cr[0] && cr[0].args.agentSignature === IMG && cr[0].args.teamLeaderSignature === IMG);
    ok('…and the draft is gone', !ROWS.has('coach-draft:u1:' + a.body.id));

    const b = await save(u1, { data: draftData() });
    CONVEX = [];
    const both = await Promise.all([post(u1, { action: 'submit', id: b.body.id, base: b.body.updatedAt }), post(u1, { action: 'submit', id: b.body.id, base: b.body.updatedAt })]);
    ok('two submits of one draft (double click / two tabs) → exactly ONE Hub create', CONVEX.filter((c) => /:create$/.test(c.path)).length === 1, CONVEX.length);
    ok('…one succeeds, the other is refused 409', both.map((r) => r.status).sort().join(',') === '200,409', JSON.stringify(both.map((r) => r.status)));

    const c = await save(u1, { data: draftData() });
    CONVEX = []; CONVEX_FAIL = 'Hub said no';
    const f = await post(u1, { action: 'submit', id: c.body.id, base: c.body.updatedAt });
    CONVEX_FAIL = null;
    const row = ROWS.get('coach-draft:u1:' + c.body.id);
    ok('a Hub failure → an error, and the draft is still there as a draft', f.status >= 400 && row && row.value.meta.state === 'draft', JSON.stringify(f));
    ok('…the reply carries the new version, and a retry on it succeeds', f.body.updatedAt === row.updated_at && (await post(u1, { action: 'submit', id: c.body.id, base: f.body.updatedAt })).status === 200, JSON.stringify(f.body));

    const v = await save(u1, { data: draftData({ agentName: '', employeeNumber: '' }) });
    const vr = await post(u1, { action: 'submit', id: v.body.id, base: v.body.updatedAt });
    ok('a submit the Hub create refuses (no agent) → 400 and the draft stays a draft', vr.status === 400 && ROWS.get('coach-draft:u1:' + v.body.id).value.meta.state === 'draft', JSON.stringify(vr));
    await post(u1, { action: 'delete', id: v.body.id });

    const st = await save(u1, { data: draftData() });
    const k = 'coach-draft:u1:' + st.body.id; const sr = ROWS.get(k);
    sr.value.meta.state = 'submitting'; sr.value.submittingAt = new Date(CLOCK - 60000).toISOString();
    ok('a stuck submit lists as state "submitting"', ((await get(u1)).body.drafts || []).some((x) => x.id === st.body.id && x.state === 'submitting'));
    ok('it cannot be saved over or deleted while submitting (409)', (await save(u1, { id: st.body.id, base: sr.updated_at, data: draftData() })).status === 409 && (await post(u1, { action: 'delete', id: st.body.id })).status === 409);
    ok('reopen within 2 minutes is refused (409)', (await post(u1, { action: 'reopen', id: st.body.id })).status === 409);
    sr.value.submittingAt = new Date(CLOCK - 180000).toISOString();
    const ro = await post(u1, { action: 'reopen', id: st.body.id });
    ok('reopen after 2 minutes → back to a draft', ro.status === 200 && ROWS.get(k).value.meta.state === 'draft', JSON.stringify(ro));
    for (const kk of [...ROWS.keys()]) ROWS.delete(kk);
  }
  {
    LISTS = { 'formalCoachingCalls:list': [{ _id: 'f1', _creationTime: 1, teamLeaderId: 'L1', date: '2026-10-05', agentName: 'Ann Agent', employeeCode: 'CB1', employeeNumber: 'CB1', campaign: 'Courtesy',
      supportProvided: 'SECRET-SUPPORT', agreedPlanAgentFeedback: 'SECRET-AGREED', calls: [{ contactNumber: '0820000000', developmentAreas: 'SECRET-CALL' }],
      clusterGap: 'gap.objection_handling', teamLeaderName: 'Denise Haripersad', agentSignature: IMG }],
      'informalCoaching:list': [{ _id: 'i1', date: '2026-10-04', agentName: 'Bea Buyer', employeeCode: 'CB2', teamLeaderFeedback: 'SECRET-FB', wayForward: 'SECRET-WAY', agentFeedback: 'SECRET-AF' }],
      'groupCoaching:list': [{ _id: 'g1', date: '2026-10-03', campaign: 'Courtesy', coachingDetails: 'SECRET-GROUP', feedback1: 'SECRET-F1', employeeSignoffs: [{ employeeName: 'Ann Agent', date: '2026-10-03', signature: IMG }, { employeeName: 'Bea Buyer', date: '2026-10-03' }] }] };
    const L = await H.coachingList(ids);
    LISTS = {};
    const ALLOW = new Set(['_id', '_table', '_label', 'date', 'dateOfCoaching', 'agentName', 'employeeCode', 'employeeNumber', 'campaign', '_sigs', 'attendees']);
    const extra = (L.sessions || []).flatMap((s) => Object.keys(s).filter((x) => !ALLOW.has(x)));
    ok('the leader\'s live list (L1) carries ONLY the line\'s fields', L.sessions && L.sessions.length === 3 && extra.length === 0, JSON.stringify(extra));
    ok('…no written content of any submitted document', !/SECRET-/.test(JSON.stringify(L)));
    ok('…a group session says how many attended, not who signed what', ((L.sessions || []).find((s) => s._id === 'g1') || {}).attendees === 2);
    ok('…no image, no contact number', !JSON.stringify(L).includes('data:image') && !JSON.stringify(L).includes('0820000000'));
  }
  {
    /* the snapshot routes, in the world verify-coaching-attribution.mjs builds */
    const NOW = Date.parse('2026-10-01T08:00:00Z'); const realNow = Date.now; Date.now = () => NOW;
    const RULES = {}, STORE = {};
    const publish = (key, obj) => { RULES[key] = { store: 'raw/kv/' + key.replace(/^kv:/, '') }; STORE['raw/kv/' + key.replace(/^kv:/, '')] = JSON.stringify(obj); };
    const decodeKeys = (q) => { const m = /key=in\.\(([^)]*)\)/.exec(q); return m ? decodeURIComponent(m[1]).split(',') : []; };
    const APP_USERS = [{ username: 'cb267', full_name: 'Denise Haripersad', cb: 'CB267', team: 'Denise Haripersad', hub_ids: { coaching: 'DEN' } }];
    const DB = {
      select: async (q) => {
        if (q.startsWith('rules?key=in.')) return decodeKeys(q).filter((k) => RULES[k]).map((k) => ({ key: k, value: RULES[k] }));
        if (q.startsWith('rules?key=like.')) { const pref = decodeURIComponent(q.split('like.')[1].split('&')[0]).replace(/[%*]$/, ''); return Object.keys(RULES).filter((k) => k.startsWith(pref)).map((key) => ({ key })); }
        if (q.startsWith('rules?key=eq.')) { const k = decodeURIComponent(q.split('eq.')[1].split('&')[0]); return RULES[k] ? [{ key: k, value: RULES[k] }] : []; }
        if (q.startsWith('app_users?role=eq.team_leader')) return APP_USERS.map((u) => ({ ...u }));
        return [];
      },
      insert: async () => {}, del: async () => {}, update: async () => {},
      storageGet: async (bucket, key) => STORE[bucket + '/' + key] || null,
    };
    for (const k of ['__digestCaches', '__digestMonths', '__digestCycles', '__coachCache', '__cmCtx', '__nbaCache', '__reportCaches']) delete globalThis[k];
    const mk = (code, name, tl) => ({ code, name, campaign: 'Courtesy', tenure: 'M1', tl, sales: 20, target: 60, pctT: 0.3, gwpEx: 1800, gwpT: 5000, act: 10, emp: 10, talk: 1000, calls: 400, ans: 200, leads: 90, closed: 100, qa: 0.9, att: 1, canc: 0, ref: 0, composite: { r2a: { fails: 0 } }, days: [] });
    const digest = { updatedAt: new Date(NOW).toISOString(), period: { from: '2026-09-01', to: '2026-09-30' }, diallingDays: 20, workingDays: 21, daysWithData: 20, dates: [], weeks: [], talkUnit: 'hours',
      agents: [mk('CB1', 'Courtesy One', 'Denise Haripersad')], notCovered: [], tlAgg: [{ camp: 'Courtesy', tl: 'Denise Haripersad', sales: 20 }], campAgg: { Courtesy: { sales: 20 } } };
    const cl = { clusterKey: 'gap.customer_verification', family: 'gap', field: 'clusterGap' };
    const sess = (id, hubId, hubName, o) => ({ id, type: 'Formal Coaching', typeLabel: 'Formal Coaching', collection: 'formalCoachingCalls', date: '2026-09-24', cb: 'CB1', agentName: 'Courtesy One', campaign: 'Courtesy',
      hubTeamLeader: hubName, hubTeamLeaderId: hubId, clusters: [cl], supportProvided: 'SECRET-SUPPORT', agreedPlanAgentFeedback: 'SECRET-AGREED', callNotes: ['SECRET-CALL'], ...o });
    publish('kv:agent-digest', digest);
    publish('kv:coaching', { fetchedAt: '2026-10-01T05:40:00.000Z', hub: 'x', leaders: [{ id: 'DEN', name: 'Denise Haripersad' }, { id: 'REN', name: 'Renolan Pillay' }],
      sessions: [sess('f1', 'DEN', 'Denise Haripersad'), sess('x1', 'REN', 'Renolan Pillay', { teamLeaderFeedback: 'SECRET-FB' })], errors: [] });
    RULES['cm:assignments'] = { ryan: { name: 'Ryan G', campaigns: ['courtesy'] } };
    const { agentDetail, coachingOthers } = await import(SRC('portal.mjs'));
    const { failDetail } = await import(SRC('help.mjs'));
    const { loadCmContext } = await import(SRC('campaign.mjs'));
    await loadCmContext(DB, { force: true });
    const denise = { username: 'cb267', full_name: 'Denise Haripersad', role: 'team_leader', cb: 'CB267', team: 'Denise Haripersad', hub_ids: { coaching: 'DEN' } };
    const ryan = { username: 'ryan', full_name: 'Ryan G', role: 'campaign_manager', cb: '' };

    const ad = await agentDetail({}, DB, denise, digest, 'CB1');
    const ss = (((ad.body || {}).coaching || {}).agents || [{}])[0].sessions || [];
    ok('agent drill-in for a team leader (L2): the sessions are there…', ad.status === 200 && ss.length === 2, JSON.stringify(ad.body && ad.body.error));
    ok('…but carry no written content (support, agreed plan, call notes, feedback)', !/SECRET-/.test(JSON.stringify(ad.body)), (JSON.stringify(ad.body).match(/.{0,40}SECRET-.{0,20}/) || [])[0]);
    ok('…themes and who coached still travel', ss.every((s) => Array.isArray(s.clusters) && s.clusters.length && s.coach));
    const cm = await agentDetail({}, DB, ryan, digest, 'CB1');
    ok('a campaign manager\'s drill-in is unchanged (still reads the support provided)', cm.status === 200 && /SECRET-SUPPORT/.test(JSON.stringify(cm.body)), JSON.stringify(cm.body && cm.body.error));
    const oth = await coachingOthers({}, DB, denise, digest, {}, NOW);
    ok('"coaching on your agents by others": no support text travels', oth.others && oth.others.length === 1 && !/SECRET-/.test(JSON.stringify(oth)), JSON.stringify(oth).slice(0, 200));
    const { withoutText } = await import(SRC('coaching.mjs'));
    const w = withoutText({ id: 'x', type: 'Formal Coaching', date: '2026-10-01', cb: 'CB1', clusters: [cl], coach: 'Denise', coachIsTl: true,
      supportProvided: 'SECRET-1', someFieldTheHubAddsTomorrow: 'SECRET-2', callNotes: ['SECRET-3'] });
    ok('withoutText is an ALLOW list: a free-text field nobody listed is withheld too; the line survives', !/SECRET-/.test(JSON.stringify(w)) && w.id === 'x' && w.cb === 'CB1' && w.clusters.length === 1 && w.coach === 'Denise', JSON.stringify(w));
    const fd = await failDetail({}, DB, denise, digest, { cb: 'CB1', theme: 'gap.customer_verification' });
    ok('the help-center theme story for a team leader: sessions listed, every note empty', fd.status === 200 && fd.body.sessions.length === 2 && fd.body.sessions.every((s) => s.note === '') && !/SECRET-/.test(JSON.stringify(fd.body)), JSON.stringify(fd.body).slice(0, 200));
    Date.now = realNow;
  }

  /* =================================================================== E (Worker half) */
  head('E · a signature covers the final wording — the Worker drops a stale one');
  if (!D.__missing) {
    const T = 'formalCoachingCalls';
    const stored = draftData({ agentSignature: IMG, teamLeaderSignature: IMG });
    const r1 = D.staleSigs(T, stored, draftData({ supportProvided: 'Changed', agentSignature: IMG, teamLeaderSignature: IMG2 }));
    ok('changed content: the unchanged agent signature is dropped, the newly drawn team leader one kept', !r1.data.agentSignature && r1.data.teamLeaderSignature === IMG2 && r1.cleared.join() === 'agentSignature', JSON.stringify(r1.cleared));
    const r2 = D.staleSigs(T, stored, draftData({ agentSignature: IMG, teamLeaderSignature: IMG }));
    ok('unchanged content: both signatures kept', r2.data.agentSignature === IMG && r2.data.teamLeaderSignature === IMG && r2.cleared.length === 0);
    const r3 = D.staleSigs('groupCoaching', { coachingDetails: 'a', employeeSignoffs: [{ employeeName: 'Ann', date: 'd', signature: IMG }] },
      { coachingDetails: 'b', employeeSignoffs: [{ employeeName: 'Ann', date: 'd', signature: IMG }] });
    ok('group: a stale attendee signature is dropped too', !r3.data.employeeSignoffs[0].signature && r3.cleared.join() === 'employeeSignoffs.0.signature', JSON.stringify(r3.cleared));
    ok('no stored draft → nothing to compare, nothing cleared', D.staleSigs(T, null, stored).cleared.length === 0);
    const qaStored = { developmentAreas: 'a', agentSignature: IMG, agentSignDate: '', teamLeaderSignature: IMG, teamLeaderSignDate: '' };
    const r4 = D.staleSigs('qualityAssuranceCoaching', qaStored, { ...qaStored, agentSignDate: '2026-10-05', teamLeaderSignDate: '2026-10-05' });
    ok('sign dates are part of signing, not of the document: both signatures kept', r4.cleared.length === 0 && r4.data.agentSignature === IMG, JSON.stringify(r4.cleared));
    const r5 = D.staleSigs('groupCoaching', { coachingDetails: 'a', employeeSignoffs: [{ employeeName: 'Ann', date: 'd', signature: IMG }] },
      { coachingDetails: 'a', employeeSignoffs: [{ employeeName: 'Ann', date: 'd', signature: IMG }, { employeeName: 'Bea', date: 'd', signature: IMG2 }] });
    ok('group: another attendee signing in keeps the first attendee\'s signature', r5.cleared.length === 0 && r5.data.employeeSignoffs[0].signature === IMG, JSON.stringify(r5.cleared));

    const a = await save(u1, { data: stored });
    const b = await save(u1, { id: a.body.id, base: a.body.updatedAt, data: draftData({ supportProvided: 'Rewritten', agentSignature: IMG, teamLeaderSignature: IMG }) });
    const kept = ROWS.get('coach-draft:u1:' + a.body.id).value.data;
    ok('save: content changed beside the stored signatures → both dropped and named', b.status === 200 && (b.body.cleared || []).sort().join() === 'agentSignature,teamLeaderSignature' && !kept.agentSignature && !kept.teamLeaderSignature, JSON.stringify(b.body));
    const c = await save(u1, { id: a.body.id, base: b.body.updatedAt, data: draftData({ supportProvided: 'Rewritten', agentSignature: IMG2, teamLeaderSignature: IMG2 }) });
    CONVEX = [];
    const s = await post(u1, { action: 'submit', id: a.body.id, base: c.body.updatedAt, data: draftData({ supportProvided: 'Rewritten AGAIN', agentSignature: IMG2, teamLeaderSignature: IMG2 }) });
    const cr = CONVEX.find((x) => /:create$/.test(x.path));
    ok('submit with edits after signing: the Hub create receives NO stale signature', s.status === 200 && cr && !cr.args.agentSignature && !cr.args.teamLeaderSignature && (s.body.cleared || []).length === 2, JSON.stringify(s.body));
    for (const k of [...ROWS.keys()]) ROWS.delete(k);
  }

  /* =================================================================== B / D / E (page) */
  head('B · D · E — the page: drafts, a locked list, and signatures that clear');
  {
    const m = PAGE.match(/<script>\n"use strict";([\s\S]*?)<\/script>/);
    const src = m[1].replace(/\nboot\(\);\s*$/, '\n');
    const nodes = {}, sel = {};
    const mkEl = () => ({ innerHTML: '', value: '', textContent: '', className: '', style: {}, classList: { add() {}, remove() {}, contains: () => false },
      addEventListener() {}, setAttribute() {}, getAttribute: () => null, querySelectorAll: () => [], querySelector: () => null, focus() {}, onclick: null, onchange: null, remove() {}, appendChild() {} });
    const canvas = () => ({ width: 0, height: 0, style: {}, addEventListener() {}, getContext: () => ({ scale() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} }), getBoundingClientRect: () => ({ left: 0, top: 0 }), toDataURL: () => IMG });
    const doc = { getElementById: (id) => (nodes[id] = nodes[id] || mkEl()), querySelectorAll: (s) => sel[s] || [], createElement: (t) => (t === 'canvas' ? canvas() : mkEl()), body: mkEl(), addEventListener() {}, removeEventListener() {} };
    let confirmText = '', confirmAnswer = true;
    const win = { location: { search: '' }, scrollTo() {}, addEventListener() {}, removeEventListener() {}, confirm: (t) => { confirmText = String(t); return confirmAnswer; },
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} } };
    const session = { getItem: () => 'tok', setItem() {}, removeItem() {} };
    const calls = []; let routes = {};
    const fetchImpl = (url, o) => {
      const u = String(url).replace(/^https?:\/\/[^/]+/, ''); const method = (o && o.method) || 'GET';
      calls.push({ u, method, body: o && o.body ? JSON.parse(o.body) : null });
      const r = routes[method + ' ' + u.split('?')[0]]; const res = r ? r(u, o && o.body ? JSON.parse(o.body) : null) : { status: 404, body: { error: 'no route' } };
      return (res.wait || Promise.resolve()).then(() => ({ ok: res.status < 400, status: res.status, json: () => Promise.resolve(res.body) }));
    };
    const names = ['coachHubPage', 'allFormsPage', 'coachFormPage', 'coachSaveDraft', 'coachSubmit', 'coachOpenDraft', 'coachDeleteDraft', 'coachBlank', 'cSet', 'cGet', 'coachSigLine', 'coachHTML', 'draftsLoad', 'hubStale'];
    const fn = new Function('document', 'window', 'localStorage', 'sessionStorage', 'location', 'fetch', 'URLSearchParams', 'setTimeout', 'setInterval', 'clearInterval', 'Intl', 'console',
      src + '\nvar __o={renders:0};' + JSON.stringify(names) + '.forEach(function(n){ try{ __o[n]=eval(n); }catch(e){ __o[n]=undefined; } });'
      + 'render=function(){ __o.renders++; };'
      + '__o.setForm=function(c){CFORM=c}; __o.getForm=function(){return CFORM}; __o.setHub=function(h){ for(var k in h) HUB[k]=h[k]; }; __o.getHub=function(){return HUB};'
      + '__o.setTeam=function(t){TEAM=t}; __o.setU=function(u){U=u}; __o.setD=function(d){D=d};'
      + 'return __o;');
    const P = fn(doc, win, win.localStorage, session, win.location, fetchImpl, URLSearchParams, (f) => { f(); return 0; }, () => 0, () => {}, Intl, { log() {}, error() {}, warn() {} });
    const has = ['coachSaveDraft', 'coachSubmit', 'coachOpenDraft', 'coachDeleteDraft', 'coachSigLine'].filter((n) => typeof P[n] !== 'function');
    ok('the page has the draft functions', has.length === 0, 'missing ' + has.join(', '));
    P.setTeam({ agents: [{ name: 'Ann Agent', code: 'CB1' }], name: 'Denise Haripersad' }); P.setU({ full_name: 'Denise Haripersad', role: 'team_leader' }); P.setD({});

    if (!has.length) {
      /* ---- B: Save draft */
      const blank = P.coachBlank('formalCoachingCalls'); blank.agentName = 'Ann Agent'; blank.employeeNumber = 'CB1'; blank.supportProvided = 'Partial';
      P.setForm({ type: 'formalCoachingCalls', data: blank, dirty: true, saving: false });
      routes['POST /api/portal/hub/coaching/drafts'] = () => ({ status: 200, body: { ok: true, id: 'd1', updatedAt: 'T1', cleared: [] } });
      routes['GET /api/portal/hub/coaching/drafts'] = () => ({ status: 200, body: { drafts: [], max: 50 } });
      P.coachSaveDraft(); await settle();
      const sv = calls.find((c) => c.method === 'POST' && c.u === '/api/portal/hub/coaching/drafts');
      ok('Save draft posts {action:"save", type, data} to the drafts route — and nothing to the Hub create', sv && sv.body.action === 'save' && sv.body.type === 'formalCoachingCalls' && sv.body.data.supportProvided === 'Partial' && !sv.body.id
        && !calls.some((c) => c.method === 'POST' && c.u === '/api/portal/hub/coaching'), JSON.stringify(sv && sv.body).slice(0, 160));
      ok('…the form now holds the draft id and version, and is clean', P.getForm().draftId === 'd1' && P.getForm().base === 'T1' && P.getForm().dirty === false, JSON.stringify({ id: P.getForm().draftId, b: P.getForm().base, d: P.getForm().dirty }));
      calls.length = 0; P.getForm().dirty = true;
      routes['POST /api/portal/hub/coaching/drafts'] = () => ({ status: 409, body: { error: 'This draft changed somewhere else.', conflict: true } });
      P.coachSaveDraft(); await settle();
      const sv2 = calls.find((c) => c.method === 'POST');
      ok('a re-save sends the id and the version it was opened at', sv2 && sv2.body.id === 'd1' && sv2.body.base === 'T1');
      ok('a 409 keeps the form open with its content and says it changed elsewhere', P.getForm().type === 'formalCoachingCalls' && P.getForm().data.supportProvided === 'Partial' && /changed|another tab|somewhere else/i.test((nodes.cfMsg || {}).textContent || ''), (nodes.cfMsg || {}).textContent);

      /* ---- B: edits typed while a save is on the wire stay "not saved" (review L, 2026-10-05) */
      { let release; const gate = new Promise((r) => { release = r; });
        routes['POST /api/portal/hub/coaching/drafts'] = () => ({ status: 200, body: { ok: true, id: 'd1', updatedAt: 'T2', cleared: [] }, wait: gate });
        P.getForm().dirty = true; P.coachSaveDraft(); await settle();
        P.getForm().data.supportProvided = 'typed during the save'; P.getForm().dirty = true;
        release(); await settle();
        ok('an edit made while the save was in flight keeps the form dirty', P.getForm().dirty === true && P.getForm().base === 'T2', JSON.stringify({ d: P.getForm().dirty, b: P.getForm().base }));
        P.getForm().base = 'T1'; }

      /* ---- B: a list asked for again while an older fetch is in flight is fetched again, never left stale (review M) */
      { P.setHub({ drafts: null });
        let release; const gate = new Promise((r) => { release = r; }); let n = 0;
        routes['GET /api/portal/hub/coaching/drafts'] = () => { n++; return n === 1 ? { status: 200, body: { drafts: [{ id: 'OLD', type: 'formalCoachingCalls', label: 'Formal Coaching', state: 'draft', sigs: [] }] }, wait: gate }
          : { status: 200, body: { drafts: [{ id: 'NEW', type: 'formalCoachingCalls', label: 'Formal Coaching', state: 'draft', sigs: [] }] } }; };
        P.draftsLoad(); P.hubStale('drafts'); P.draftsLoad();
        release(); await settle();
        const ids = ((P.getHub().drafts || {}).drafts || []).map((x) => x.id).join();
        ok('a reload requested during an in-flight fetch refetches — the stale answer is never the final list', ids === 'NEW' && n === 2, ids + ' after ' + n + ' fetches'); }

      /* ---- B: the Drafts card + open a draft */
      P.setForm({ type: null, data: null, dirty: false, saving: false });
      const SIGS = [{ field: 'agentSignature', label: 'Agent', signed: true }, { field: 'teamLeaderSignature', label: 'Team leader', signed: false }];
      P.setHub({ coaching: { linked: true, byType: {}, sessions: [] }, drafts: { drafts: [{ id: 'd1', type: 'formalCoachingCalls', label: 'Formal Coaching', state: 'draft', agentName: 'Ann Agent', employeeNumber: 'CB1', updatedAt: '2026-10-05T08:30:00Z', sigs: SIGS },
        { id: 'd2', type: 'informalCoaching', label: 'Informal Coaching', state: 'submitting', agentName: 'Bea Buyer', employeeNumber: 'CB2', updatedAt: '2026-10-05T08:40:00Z', sigs: [] }], max: 50 } });
      const hub = P.coachHubPage();
      ok('the Hub tab has a Drafts card listing product, agent and signature state', /Drafts/.test(text(hub)) && /Ann Agent/.test(text(hub)) && /Formal Coaching/.test(text(hub)) && /Not signed by team leader/.test(text(hub)), text(hub).slice(0, 300));
      ok('…with Open and Delete for each draft', hub.includes('data-draft-open="d1"') && hub.includes('data-draft-del="d1"'));
      ok('a stuck submit says to check the sessions and offers Reopen, not Open', /check your sessions/i.test(text(hub)) && hub.includes('data-draft-reopen="d2"') && !hub.includes('data-draft-open="d2"'));
      routes['GET /api/portal/hub/coaching/drafts'] = (u) => (/id=d1/.test(u) ? { status: 200, body: { draft: { id: 'd1', type: 'formalCoachingCalls', label: 'Formal Coaching', state: 'draft', updatedAt: 'T9', data: Object.assign(P.coachBlank('formalCoachingCalls'), { agentName: 'Ann Agent', employeeNumber: 'CB1', supportProvided: 'Reopened', agentSignature: IMG }) } } } : { status: 200, body: { drafts: [] } });
      P.coachOpenDraft('d1'); await settle();
      ok('opening a draft fills the form: id, version, content, signature', P.getForm().type === 'formalCoachingCalls' && P.getForm().draftId === 'd1' && P.getForm().base === 'T9' && P.getForm().data.supportProvided === 'Reopened' && P.getForm().data.agentSignature === IMG, JSON.stringify({ t: P.getForm().type, id: P.getForm().draftId }));
      const form = P.coachFormPage();
      ok('the form shows the saved signature and offers Save draft, Submit and Delete draft', form.includes('<img src="' + IMG + '"') && /Save draft/.test(form) && /Submit/.test(form) && /Delete draft/.test(form), text(form).slice(0, 200));

      /* ---- D: Submit */
      calls.length = 0; confirmText = ''; confirmAnswer = false;
      P.coachSubmit(); await settle();
      ok('Submit asks first and names the missing signature; cancelling sends nothing', /team leader/i.test(confirmText) && /open|view|change/i.test(confirmText) && !calls.some((c) => c.method === 'POST'), confirmText);
      confirmAnswer = true;
      routes['POST /api/portal/hub/coaching/drafts'] = () => ({ status: 200, body: { ok: true, hubId: 'h1', table: 'formalCoachingCalls', label: 'Formal Coaching', cleared: [] } });
      routes['GET /api/portal/hub/coaching'] = () => ({ status: 200, body: { linked: true, byType: {}, sessions: [] } });
      P.coachSubmit(); await settle();
      const sb = calls.find((c) => c.method === 'POST' && c.u === '/api/portal/hub/coaching/drafts');
      ok('confirmed, a saved draft submits as {action:"submit", id, base, data}', sb && sb.body.action === 'submit' && sb.body.id === 'd1' && sb.body.base === 'T9' && sb.body.data && sb.body.data.supportProvided === 'Reopened', JSON.stringify(sb && sb.body).slice(0, 160));
      ok('…the form closes and the sessions + drafts are fetched again', P.getForm().type === null && calls.some((c) => c.method === 'GET' && c.u === '/api/portal/hub/coaching') && calls.some((c) => c.method === 'GET' && /coaching\/drafts/.test(c.u)));
      calls.length = 0;
      const nb = P.coachBlank('formalCoachingCalls'); nb.agentName = 'Ann Agent'; nb.employeeNumber = 'CB1';
      P.setForm({ type: 'formalCoachingCalls', data: nb, dirty: true, saving: false });
      routes['POST /api/portal/hub/coaching'] = () => ({ status: 200, body: { ok: true, id: 'h2', table: 'formalCoachingCalls', label: 'Formal Coaching' } });
      P.coachSubmit(); await settle();
      const direct = calls.find((c) => c.method === 'POST');
      ok('a never-saved form submits straight to the Hub create (one request)', direct && direct.u === '/api/portal/hub/coaching' && direct.body.type === 'formalCoachingCalls', JSON.stringify(direct && direct.u));

      /* ---- D: the locked list */
      P.setHub({ coaching: { linked: true, byType: { 'Formal Coaching': 1 }, sessions: [{ _id: 's1', _table: 'formalCoachingCalls', _label: 'Formal Coaching', date: '2026-10-05', agentName: 'Ann Agent', employeeCode: 'CB1',
        _sigs: [{ field: 'agentSignature', label: 'Agent', signed: true }, { field: 'teamLeaderSignature', label: 'Team leader', signed: true }] }] },
        drafts: { drafts: [{ id: 'd1', type: 'formalCoachingCalls', label: 'Formal Coaching', state: 'draft', agentName: 'Bea Buyer', updatedAt: '2026-10-05T08:30:00Z', sigs: SIGS }] }, kpi: { linked: true, forms: [] } });
      const locked = P.coachHubPage();
      ok('"Your sessions": a submitted session is a line — SUBMITTED and "Signed by agent and team leader"', /SUBMITTED/.test(text(locked)) && /Signed by agent and team leader/.test(text(locked)), text(locked).slice(0, 400));
      ok('…with no View and no Notes column', !locked.includes('data-coach-view') && !/<th[^>]*>Notes</.test(locked) && !/>View</.test(locked));
      ok('the footer keeps the Coaching Hub link (new tab, rel=noopener) without inviting edits of a submitted document',
        /<a href="https:\/\/coaching-hub-psi\.vercel\.app\/" target="_blank" rel="noopener noreferrer">Open the Coaching Hub/.test(locked)
        && !/edit a session you already saved/i.test(locked) && !/to print one/i.test(locked));
      const all = P.allFormsPage();
      ok('"All forms": the draft is DRAFT with Open; the submitted session is SUBMITTED with no action', /DRAFT/.test(text(all)) && all.includes('data-draft-open="d1"') && /SUBMITTED/.test(text(all)) && !all.includes('data-coach-view'), text(all).slice(0, 300));
      ok('no data-coach-view handler or button survives anywhere in the page', !PAGE.includes('data-coach-view') && !/function coachView\(/.test(PAGE));
      const card = P.coachHTML({ windowDays: 90, coachingAt: '2026-10-05T06:00:00Z', agents: [{ code: 'CB1', sessions: [{ type: 'Formal Coaching', typeLabel: 'Formal Coaching', collection: 'formalCoachingCalls', date: '2026-10-05' }], themes: [] }] });
      ok('a session with no text (what a team leader receives) is a plain line, not an empty expander', /Formal Coaching/.test(text(card)) && !/<details[^>]*>\s*<summary>[^]*?<\/summary>\s*<\/details>/.test(card), card.slice(0, 300));

      /* ---- E: changing content clears signatures */
      const sd = P.coachBlank('formalCoachingCalls'); sd.agentSignature = IMG; sd.teamLeaderSignature = IMG; sd.supportProvided = 'a';
      P.setForm({ type: 'formalCoachingCalls', data: sd, dirty: false, saving: false });
      sel['.sig'] = [];
      P.cSet('supportProvided', 'b');
      ok('editing the content after signing clears BOTH signatures', P.cGet('agentSignature') === '' && P.cGet('teamLeaderSignature') === '', JSON.stringify([P.cGet('agentSignature'), P.cGet('teamLeaderSignature')]));
      ok('…and says so', /signatures cleared/i.test((nodes.cfMsg || {}).textContent || ''), (nodes.cfMsg || {}).textContent);
      P.cSet('agentSignature', IMG); P.cSet('teamLeaderSignature', IMG2);
      ok('drawing a signature never clears the other one', P.cGet('agentSignature') === IMG && P.cGet('teamLeaderSignature') === IMG2);
      const gd = P.coachBlank('groupCoaching'); gd.employeeSignoffs[0].signature = IMG; gd.employeeSignoffs[0].employeeName = 'Ann';
      P.setForm({ type: 'groupCoaching', data: gd, dirty: false, saving: false });
      P.cSet('coachingDetails', 'changed');
      ok('group: an attendee signature clears too when the content changes', P.cGet('employeeSignoffs.0.signature') === '');
      /* signing is not editing: the date beside a signature, or the next attendee's own row, must never void the ones drawn */
      gd.employeeSignoffs[0].signature = IMG; gd.employeeSignoffs.push({ employeeName: '', date: '', signature: '' });
      P.cSet('employeeSignoffs.1.employeeName', 'Bea'); P.cSet('employeeSignoffs.1.date', '2026-10-05');
      ok('group: the next attendee typing their name and date keeps the first attendee\'s signature', P.cGet('employeeSignoffs.0.signature') === IMG);
      const qa = P.coachBlank('qualityAssuranceCoaching'); qa.agentSignature = IMG; qa.teamLeaderSignature = IMG;
      P.setForm({ type: 'qualityAssuranceCoaching', data: qa, dirty: false, saving: false });
      P.cSet('agentSignDate', '2026-10-05'); P.cSet('teamLeaderSignDate', '2026-10-05');
      ok('QA: filling in the sign dates keeps both signatures', P.cGet('agentSignature') === IMG && P.cGet('teamLeaderSignature') === IMG);
      P.cSet('teamLeaderComments', 'edited');
      ok('QA: …but editing the comments still clears them', P.cGet('agentSignature') === '' && P.cGet('teamLeaderSignature') === '');
    }
  }
} catch (e) {
  fail++; console.log('  FAIL the suite threw: ' + (e && e.stack || e));
} finally {
  globalThis.fetch = realFetch;
}

console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
process.exit(fail ? 1 : 0);
