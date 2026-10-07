#!/usr/bin/env node
/**
 * verify-coaching-signature.mjs — spec 003-coaching-comments-signature.
 *
 *   node nicks_code/diagnostics/verify-coaching-signature.mjs
 *
 * WHY: on 2026-10-05 every signature drawn on a coaching form in Agent Analytics was thrown away before the save —
 * the form wired the signature pad with its READER (cGet) in the setter's place — and the new view stripped
 * signatures from its list, so nobody could see it; Formal Coaching comments were stored but every summary read
 * field names that product does not have. Pure: the page runs in a stubbed DOM, the Worker modules against a stubbed
 * fetch. Nothing here reaches the live Hub.
 *
 *   A  the form keeps what is drawn   every signature box of all six products writes the form; drawing marks it dirty
 *   B  the Worker never drops one     a supplied-but-unreadable signature refuses the save, naming the signatory
 *   C  signed state, no images        list rows say which signatures exist; no image travels, nested rows included
 *   D  formal comments reach agents   the copy keeps call notes (never contact numbers); the agent card shows them
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const SRC = (f) => pathToFileURL(path.join(ROOT, 'worker', 'src', f)).href;
const PAGE = fs.readFileSync(path.join(ROOT, 'agent', 'index.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, note) => { if (cond) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (note !== undefined ? ' — ' + note : '')); } };
const head = (t) => console.log('\n' + t);
const text = (h) => String(h).replace(/<[^>]*>/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const IMG = 'data:image/png;base64,TEST';

/* ------------------------------------------------------------------ the page, in a stubbed DOM with drawable canvases */
function loadPage() {
  const m = PAGE.match(/<script>\n"use strict";([\s\S]*?)<\/script>/);
  if (!m) throw new Error('could not find the page script');
  const src = m[1].replace(/\nboot\(\);\s*$/, '\n');
  const nodes = {}, sel = {}, winL = {}, canvases = [];
  const mkEl = () => ({ innerHTML: '', value: '', textContent: '', className: '', style: {}, classList: { add() {}, remove() {}, contains: () => false },
    addEventListener() {}, setAttribute() {}, getAttribute: () => null, querySelectorAll: () => [], querySelector: () => null,
    focus() {}, onclick: null, onchange: null, remove() {}, appendChild() {} });
  const mkCanvas = () => { const c = { width: 0, height: 0, style: {}, L: {}, addEventListener(t, f) { this.L[t] = f; },
    getContext: () => ({ scale() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} }),
    getBoundingClientRect: () => ({ left: 0, top: 0 }), toDataURL: () => IMG }; canvases.push(c); return c; };
  const doc = { getElementById: (id) => (nodes[id] = nodes[id] || mkEl()), querySelectorAll: (s) => sel[s] || [],
    createElement: (t) => (t === 'canvas' ? mkCanvas() : mkEl()), body: mkEl(), addEventListener() {}, removeEventListener() {} };
  const store = {}, sess = {};
  const win = { location: { search: '' }, scrollTo() {}, confirm: () => true, removeEventListener() {},
    addEventListener(t, f) { (winL[t] = winL[t] || []).push(f); },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; }, removeItem: (k) => { delete store[k]; } } };
  const session = { getItem: (k) => (k in sess ? sess[k] : null), setItem: (k, v) => { sess[k] = String(v); }, removeItem: (k) => { delete sess[k]; } };
  const fetchImpl = () => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ error: 'no route in test' }) });
  const names = ['coachBlank', 'wireCoachForm', 'cGet', 'cSet', 'sigPad', 'coachHTML', 'coachSaid', 'coachAgreed', 'coachSigLine', 'COACH_SPEC'];
  const fn = new Function('document', 'window', 'localStorage', 'sessionStorage', 'location', 'fetch', 'URLSearchParams', 'setTimeout', 'setInterval', 'clearInterval', 'Intl', 'console',
    src + '\nvar __o={};' + JSON.stringify(names) + '.forEach(function(n){ try{ __o[n]=eval(n); }catch(e){ __o[n]=undefined; } });'
    + '__o.setForm=function(c){CFORM=c}; __o.getForm=function(){return CFORM}; __o.setTeam=function(t){TEAM=t}; __o.setU=function(u){U=u};'
    + 'return __o;');
  const P = fn(doc, win, win.localStorage, session, win.location, fetchImpl, URLSearchParams, () => 0, () => 0, () => {}, Intl, { log() {}, error() {}, warn() {} });
  return { P, sel, winL, canvases };
}

/* every signature path a product's form declares, in form order */
const sigPaths = (spec) => {
  const out = [];
  for (const s of spec.sec) for (const f of s.f) {
    if (f[2] === 'sig') out.push(f[0]);
    if (f[2] === 'signoffs') out.push('employeeSignoffs.0.signature');
  }
  return out;
};
const mkBox = (p) => ({ clientWidth: 300, clientHeight: 80, innerHTML: '', querySelector: () => null, appendChild() {},
  getAttribute: (a) => (a === 'data-sig' ? p : null) });

/* ------------------------------------------------------------------ the Worker modules */
const realFetch = globalThis.fetch;
let CONVEX = [];
const stubConvex = (answers) => {
  CONVEX = [];
  globalThis.fetch = async (url, o) => {
    const body = JSON.parse((o && o.body) || '{}');
    CONVEX.push({ url: String(url), path: body.path, args: body.args });
    const a = typeof answers === 'function' ? answers(body.path, body.args) : answers[body.path];
    const value = a === undefined ? [] : a;
    return { ok: true, status: 200, json: async () => ({ status: 'success', value }) };
  };
};
const H = await import(SRC('hubs.mjs'));
const C = await import(SRC('coaching.mjs'));

const ids = { coaching: 'L1' };
const tl = { username: 'cb267', full_name: 'Denise Haripersad', role: 'team_leader' };
const formalBody = (o = {}) => ({ type: 'formalCoachingCalls', agentName: 'Ann Agent', employeeNumber: 'CB1', date: '2026-10-05', campaign: 'Courtesy',
  supportProvided: 'Role-played the price objection.', agreedPlanAgentFeedback: 'Will slow the close.',
  calls: [{ contactNumber: '0820000000', developmentAreas: 'Rushed the close.' }], ...o });

try {
  /* =================================================================== A */
  head('A · the form keeps what is drawn — every signature box of all six products');
  {
    const { P, sel, winL, canvases } = loadPage();
    ok('the page exposes the coaching form functions', typeof P.coachBlank === 'function' && typeof P.wireCoachForm === 'function' && P.COACH_SPEC);
    P.setTeam({ agents: [{ name: 'Ann Agent', code: 'CB1' }], name: 'Denise Haripersad' });
    P.setU({ full_name: 'Denise Haripersad', role: 'team_leader' });
    for (const type of Object.keys(P.COACH_SPEC)) {
      const paths = sigPaths(P.COACH_SPEC[type]);
      if (!paths.length) { ok(type + ': declares no signature (scorecard) — nothing to draw', type === 'qualityCoaching'); continue; }
      for (const how of ['mouse', 'touch']) {
        P.setForm({ type, data: P.coachBlank(type), dirty: false, saving: false });
        sel['.sig'] = paths.map(mkBox); sel['.cc'] = []; sel['.sigclr'] = [];
        const before = canvases.length; for (const k of Object.keys(winL)) delete winL[k];
        P.wireCoachForm();
        const mine = canvases.slice(before);
        ok(type + ' (' + how + '): one pad per signature box (' + paths.length + ')', mine.length === paths.length, mine.length);
        mine.forEach((c) => {
          const e = (x) => ({ clientX: x, clientY: x, touches: how === 'touch' ? [{ clientX: x, clientY: x }] : undefined, preventDefault() {} });
          if (how === 'mouse') { c.L.mousedown(e(5)); c.L.mousemove(e(9)); (winL.mouseup || []).forEach((f) => f()); }
          else { c.L.touchstart(e(5)); c.L.touchmove(e(9)); c.L.touchend(); }
        });
        const kept = paths.filter((p) => P.cGet(p) === IMG);
        ok(type + ' (' + how + '): every drawn signature is in the form — ' + paths.join(', '), kept.length === paths.length, 'kept ' + JSON.stringify(kept));
        ok(type + ' (' + how + '): drawing marks the form as not saved', P.getForm().dirty === true);
      }
    }
    /* Clear empties exactly the one box */
    P.setForm({ type: 'formalCoachingCalls', data: P.coachBlank('formalCoachingCalls'), dirty: false, saving: false });
    P.getForm().data.agentSignature = IMG; P.getForm().data.teamLeaderSignature = IMG;
    const clr = { getAttribute: (a) => (a === 'data-clr' ? 'teamLeaderSignature' : null), onclick: null };
    sel['.sig'] = []; sel['.cc'] = []; sel['.sigclr'] = [clr];
    P.wireCoachForm();
    try { clr.onclick(); } catch (e) { /* render() needs a full page; the write happens before it */ }
    ok('Clear empties the team leader signature', P.cGet('teamLeaderSignature') === '');
    ok('…and leaves the agent signature alone', P.cGet('agentSignature') === IMG);
  }
  {
    /* the static guard: the pad takes (box, path, setter) — a fourth argument is how the reader got in */
    const calls = [...PAGE.matchAll(/(?<!function )sigPad\(/g)].map((mm) => {
      let i = mm.index + 'sigPad('.length, depth = 1, args = 1;
      for (; i < PAGE.length && depth; i++) { const ch = PAGE[i]; if (ch === '(') depth++; else if (ch === ')') depth--; else if (ch === ',' && depth === 1) args++; }
      return args;
    });
    ok('every sigPad( call passes at most 3 arguments (' + calls.join(',') + ')', calls.length >= 2 && calls.every((n) => n <= 3), JSON.stringify(calls));
    ok('no sigPad call hands it the reader', !/sigPad\([^)]*cGet/.test(PAGE));
  }

  /* =================================================================== B */
  head('B · the Worker never drops a supplied signature silently');
  {
    stubConvex({ 'formalCoachingCalls:create': 'new-id' });
    const r = await H.coachingCreate(ids, tl, formalBody({ agentSignature: IMG, teamLeaderSignature: IMG }));
    const create = CONVEX.find((c) => c.path === 'formalCoachingCalls:create');
    ok('a valid signature pair reaches the Hub create unchanged', r.ok && create && create.args.agentSignature === IMG && create.args.teamLeaderSignature === IMG, JSON.stringify(r));

    stubConvex({ 'formalCoachingCalls:create': 'new-id' });
    const bad = await H.coachingCreate(ids, tl, formalBody({ agentSignature: IMG, teamLeaderSignature: 'not-an-image' }));
    ok('a supplied signature that is not an image → 400 naming the team leader signature', bad.status === 400 && /team leader signature/i.test(bad.error || ''), JSON.stringify(bad));
    ok('…and NOTHING is written to the Hub', CONVEX.length === 0, CONVEX.length);

    stubConvex({ 'formalCoachingCalls:create': 'new-id' });
    const big = await H.coachingCreate(ids, tl, formalBody({ agentSignature: 'data:image/png;base64,' + 'A'.repeat(250001) }));
    ok('an oversized signature → 400 naming the agent signature, nothing written', big.status === 400 && /agent signature/i.test(big.error || '') && CONVEX.length === 0, JSON.stringify(big).slice(0, 160));

    stubConvex({ 'formalCoachingCalls:create': 'new-id' });
    const blank = await H.coachingCreate(ids, tl, formalBody({ agentSignature: '', teamLeaderSignature: '' }));
    const c2 = CONVEX.find((c) => c.path === 'formalCoachingCalls:create');
    ok('an empty signature still means "not signed": the create proceeds without the field', blank.ok && c2 && !('agentSignature' in c2.args) && !('teamLeaderSignature' in c2.args), JSON.stringify(c2 && Object.keys(c2.args)));

    stubConvex({ 'groupCoaching:create': 'g-id' });
    const grp = await H.coachingCreate(ids, tl, { type: 'groupCoaching', date: '2026-10-05', campaign: 'Courtesy', coachingDetails: 'x', feedback1: 'a', feedback2: 'b', feedback3: 'c',
      employeeSignoffs: [{ employeeName: 'Ann Agent', date: '2026-10-05', signature: IMG }, { employeeName: 'Bea Buyer', date: '2026-10-05', signature: 'garbage' }] });
    ok('a group attendee with an unreadable signature → 400 naming the attendee row, nothing written', grp.status === 400 && /Bea Buyer|attendee/i.test(grp.error || '') && CONVEX.length === 0, JSON.stringify(grp));
  }

  /* =================================================================== C */
  head('C · the leader\'s list says which signatures exist — and carries no image');
  {
    const rows = {
      'formalCoachingCalls:list': [{ _id: 'f1', date: '2026-10-05', agentName: 'Ann Agent', employeeCode: 'CB1', agentSignature: IMG, supportProvided: 'x' },
        { _id: 'f2', date: '2026-10-04', agentName: 'Bea Buyer', employeeCode: 'CB2', agentSignature: IMG, teamLeaderSignature: IMG }],
      'leadManagementCoaching:list': [{ _id: 'l1', date: '2026-10-03', agentName: 'Ann Agent', employeeCode: 'CB1', sosSignature: IMG }],
      'groupCoaching:list': [{ _id: 'g1', date: '2026-10-02', campaign: 'Courtesy', employeeSignoffs: [{ employeeName: 'Ann Agent', date: '2026-10-02', signature: IMG }, { employeeName: 'Bea Buyer', date: '2026-10-02' }] }],
      'qualityCoaching:list': [{ _id: 's1', date: '2026-10-01', agentName: 'Ann Agent', tlName: 'Denise' }],
    };
    stubConvex(rows);
    const L = await H.coachingList(ids);
    const by = (id) => (L.sessions || []).find((s) => s._id === id) || {};
    const st = (id) => (by(id)._sigs || []).map((g) => g.label + ':' + g.signed).join(',');
    ok('formal f1: agent signed, team leader NOT — the absent key reads as not signed', st('f1') === 'Agent:true,Team leader:false', st('f1'));
    ok('formal f2: both signed', st('f2') === 'Agent:true,Team leader:true', st('f2'));
    ok('lead management: agent not signed, SOS signed', st('l1') === 'Agent:false,SOS:true', st('l1'));
    ok('scorecard: no signatories → _sigs []', Array.isArray(by('s1')._sigs) && by('s1')._sigs.length === 0, JSON.stringify(by('s1')._sigs));
    ok('no "data:image" string anywhere in the list payload — nested group attendee rows included', !JSON.stringify(L).includes('data:image'));
    ok('no key named like a signature holds a value in the payload', !/"[A-Za-z]*[Ss]ignature":"[^"]/.test(JSON.stringify(L)));
  }

  /* =================================================================== D */
  head('D · formal comments reach the agent; customer contact numbers never do');
  {
    stubConvex((p) => (p === 'teamLeaders:list' ? [{ _id: 'L1', name: 'Denise Haripersad' }]
      : p === 'formalCoachingCalls:list' ? [{ _id: 'f1', date: '2026-10-05', employeeCode: 'CB1', agentName: 'Ann Agent',
        supportProvided: 'Role-played the price objection.', agreedPlanAgentFeedback: 'Will slow the close.',
        calls: [{ contactNumber: '0820000000', developmentAreas: 'Rushed the close.' }, { contactNumber: '0831111111', developmentAreas: '' },
          { contactNumber: '0842222222', developmentAreas: 'X'.repeat(900) }] }] : []));
    const snap = await C.fetchCoaching({});
    const s = (snap.sessions || [])[0] || {};
    ok('the copy keeps each formal call\'s development areas as callNotes, empties dropped', Array.isArray(s.callNotes) && s.callNotes.length === 2 && s.callNotes[0] === 'Rushed the close.', JSON.stringify(s.callNotes && s.callNotes.map((x) => x.length)));
    ok('…each capped at 600 characters', s.callNotes && s.callNotes[1].length === 600);
    ok('no contact number anywhere in the copy', !/08[234]\d{7}/.test(JSON.stringify(snap)) && !JSON.stringify(snap).includes('contactNumber'));

    const { P } = loadPage();
    ok('the page has coachSaid / coachAgreed', typeof P.coachSaid === 'function' && typeof P.coachAgreed === 'function');
    const formal = { type: 'Formal Coaching', typeLabel: 'Formal Coaching', collection: 'formalCoachingCalls', date: '2026-10-05',
      supportProvided: 'Role-played the price objection.', agreedPlanAgentFeedback: 'Will slow the close.', callNotes: ['Rushed the close.', 'Skipped verification.'] };
    const said = text(P.coachSaid(formal));
    ok('formal "What was discussed" carries the call notes and the support provided', /Rushed the close/.test(said) && /Skipped verification/.test(said) && /Role-played the price objection/.test(said), said);
    ok('formal "What you agreed" is the agreed plan', /Will slow the close/.test(text(P.coachAgreed(formal))));
    const informal = { type: 'Informal Coaching', collection: 'informalCoaching', teamLeaderFeedback: 'Good energy.', agentFeedback: 'Thanks.', wayForward: 'Keep it up.' };
    ok('informal is unchanged: discussed = team leader feedback, agreed = agent feedback', /Good energy/.test(text(P.coachSaid(informal))) && /Thanks/.test(text(P.coachAgreed(informal))));
    const card = P.coachHTML({ windowDays: 90, coachingAt: '2026-10-05T06:00:00Z', agents: [{ code: 'CB1', sessions: [formal], themes: [] }] });
    ok('the agent card shows "What was discussed" for a formal session', /What was discussed/.test(text(card)) && /Rushed the close/.test(text(card)), text(card).slice(0, 300));
    ok('…and escapes what it prints', !P.coachSaid({ collection: 'formalCoachingCalls', callNotes: ['<img src=x onerror=alert(1)>'] }).includes('<img'));
  }
  /* =================================================================== E */
  head('E · the audit of already-unsigned documents only ever READS the Hub');
  {
    const tool = fs.readFileSync(path.join(ROOT, 'tools', 'audit-hub-signatures.mjs'), 'utf8');
    ok('tools/audit-hub-signatures.mjs queries (/api/query) and never mutates (/api/mutation, :create/:update/:remove)', /\/api\/query/.test(tool) && !/\/api\/mutation|:(create|update|remove)['"`]/.test(tool));
    const kept = (tool.match(/found\.push\(\{([^}]*)\}\)/) || [])[1];
    ok('…and the only record it prints holds no agent name and no signature value', !!kept && !/agentName|r\[f\]|\.signature|Signature\]/.test(kept), kept);
  }
} catch (e) {
  fail++; console.log('  FAIL the suite threw: ' + (e && e.stack || e));
} finally {
  globalThis.fetch = realFetch;
}

console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
process.exit(fail ? 1 : 0);
