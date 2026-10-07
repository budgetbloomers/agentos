#!/usr/bin/env node
/* verify-session-name.mjs — EACH PERSON SEES THEIR OWN NAME (Spec Kit 011, 2026-10-07).
 *
 * "I logged in with aarav … its showing nick". The Ops dashboard painted its header from state.user, and state.user
 * was SAVED IN THE SHARED cb-config and ADOPTED from it on every load and every save conflict — so whoever saved the
 * config last (the 15-minute relay, signed in as nicholas; or Nick himself) was the name everybody saw, and the name
 * stamped on every Ops upload as uploaded_by. This drives the REAL page script in a VM (the verify-ops-cas harness)
 * and proves the name comes from the signed-in session alone.
 *
 *   node nicks_code/diagnostics/verify-session-name.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PAGE = fs.readFileSync(path.join(ROOT, 'Chatterbox_AgentOS_Analytics.html'), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m + (d ? ' — ' + d : '')); } };

/* ── the page, in a VM with a fake cloud; the header's two elements record what is written to them ── */
const blocks = [...PAGE.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const el = () => new Proxy(function () {}, {
  get: (_, k) => { if (k === 'style' || k === 'dataset' || k === 'classList') return el(); if (k === 'children' || k === 'childNodes') return [];
    if (k === 'innerHTML' || k === 'textContent' || k === 'value') return ''; if (k === Symbol.toPrimitive) return () => ''; return el(); },
  set: () => true, apply: () => el(),
});
const header = { '#userNm': { textContent: '' }, '#userAv': { textContent: '' } };
const listeners = {};
const doc = { querySelector: (s) => header[s] || el(), querySelectorAll: () => [], getElementById: () => null, createElement: () => el(),
  addEventListener: (t, f) => { (listeners[t] = listeners[t] || []).push(f); }, body: el(), documentElement: el(), head: el(), readyState: 'complete' };
const cloud = {}; const saves = []; let conflictsToServe = {};
const storage = {
  ver: {}, fresh: {},
  get: async (k) => (k in cloud ? { value: JSON.stringify(cloud[k]) } : null),
  set: async (k, v, opts) => { if (conflictsToServe[k] > 0) { conflictsToServe[k]--; return { conflict: true, current: 'v2' }; }
    saves.push({ k, opts, body: JSON.parse(v) }); cloud[k] = JSON.parse(v); return { ok: true }; },
  delete: async () => {},
};
const sandbox = {
  document: doc, console: { log() {}, info() {}, warn() {}, error() {} }, setTimeout: () => 0, clearTimeout: () => {}, requestAnimationFrame: () => 0,
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }, sessionStorage: { getItem: () => null, setItem: () => {} },
  indexedDB: { open: () => ({}) }, fetch: () => Promise.reject(new Error('no net')), location: { href: '', search: '' }, navigator: { userAgent: 'node' },
  Chart: function () {}, XLSX: {}, Papa: {}, structuredClone, Date, Math, JSON, Set, Map, Promise, Object, Array, String, Number, Boolean, RegExp, isNaN, parseFloat, parseInt,
  storage,
};
sandbox.window = sandbox; sandbox.globalThis = sandbox; sandbox.setInterval = () => 0;
vm.createContext(sandbox);
try { vm.runInContext(blocks.join('\n;\n') + '\n;window.__N={state,cfgPayload,TRANSFORM};', sandbox, { filename: 'ops-inline.js' }); }
catch (e) { console.error('page did not load: ' + e.message); process.exit(1); }
const G = sandbox; const S = G.__N.state;
G.toast = () => {};
const shown = () => header['#userNm'].textContent;
const paint = () => { if (typeof G.paintUser === 'function') G.paintUser(); else { header['#userNm'].textContent = S.user; header['#userAv'].textContent = (S.user || '')[0] || 'A'; } };

console.log('\nA · the header shows the signed-in person, from the session');
{
  G.CBX_USER = { username: 'aarav', full_name: 'Aarav', role: 'exec' };
  (listeners['cbx-authed'] || []).forEach((f) => { try { f({ detail: G.CBX_USER }); } catch (e) { /* noop */ } });
  ok(typeof G.whoAmI === 'function' && G.whoAmI() === 'Aarav', 'whoAmI() is the session\'s display name', typeof G.whoAmI === 'function' ? G.whoAmI() : 'whoAmI missing');
  ok(shown() === 'Aarav' && header['#userAv'].textContent === 'A', 'the sign-in event paints "Aarav" in the header, "A" in the avatar', JSON.stringify([shown(), header['#userAv'].textContent]));
  ok((listeners['cbx-authed'] || []).length > 0, 'the page listens for the sign-in (cbx-authed) instead of guessing at boot');
}

console.log('\nB · the shared config can no longer put another person\'s name on screen');
{
  G.applyCfg({ kpis: [], rules: {}, user: 'Nick', syncedUploads: {} });
  paint();
  ok(shown() === 'Aarav', 'a config saved by Nick, loaded after sign-in, leaves the header on Aarav', shown());
  const p = G.__N.cfgPayload();
  ok(!('user' in p), 'the config this page saves carries no person\'s name', JSON.stringify(Object.keys(p)));
}

console.log('\nC · a save conflict merges the other session\'s config without its name');
{
  cloud['cb-config'] = { kpis: [], rules: {}, agentMap: {}, sfOwnerMap: {}, cbInfo: {}, user: 'Nick', syncedUploads: { theirs: 1 } };
  conflictsToServe['cb-config'] = 1;
  await G.saveConfig();
  paint();
  ok(shown() === 'Aarav', 'after the merge the header still reads Aarav', shown());
  ok(!('user' in (cloud['cb-config'] || {})), 'and the saved config holds no name', JSON.stringify(Object.keys(cloud['cb-config'] || {})));
}

console.log('\nD · an upload is credited to the person who made it');
{
  G.applyCfg({ kpis: [], rules: {}, user: 'Nick' });
  S.facts = { VICI_CALL_REPORT: [] }; S.batches = []; S.exceptions = []; S.pending = {};
  const row = { call_date: '2026-10-07 09:00:00', phone_number_dialed: '0820000000', status: 'SALE', user: 'CB1', full_name: 'Agent CB1', campaign_id: 'C',
    list_id: '1', lead_id: '1', length_in_sec: '60', list_name: 'L', status_name: 'Sale', user_group: 'G' };
  const res = G.applyLoad('VICI_CALL_REPORT', { name: 'EXPORT_CALL_REPORT_20261007.txt' }, { data: [row], headers: Object.keys(row), textHash: 'h1' }, 'test');
  ok(res && res.batch && res.batch.uploaded_by === 'Aarav', 'uploaded_by is the signed-in person, not the config\'s name', res && res.batch && res.batch.uploaded_by);
  ok(res && res.batch && res.batch.uploaded_by_username === 'aarav', '…with the username beside it for the audit', res && res.batch && res.batch.uploaded_by_username);
}

console.log('\nE · nothing left that reads a name from the shared config');
{
  ok(!/state\.user\s*=\s*cfg\.user/.test(PAGE), 'applyCfg no longer copies cfg.user');
  ok(!/user\s*:\s*state\.user/.test(PAGE), 'nothing saves or stamps state.user');
  ok(!/textContent\s*=\s*state\.user/.test(PAGE), 'the header is never painted from state.user');
}

console.log('\nF · the command-line publish is recorded under the person who runs it');
{
  const TOOL = fs.readFileSync(path.join(ROOT, 'tools', 'publish-agent-list.mjs'), 'utf8');
  ok(!/role=eq\.admin/.test(TOOL), 'the tool no longer signs in as "the first admin it finds"');
  ok(/--as/.test(TOOL) && /--as <[a-z ]*username>/i.test(TOOL), 'it requires --as <username> to publish');
  ok(/PORTAL_ROLES|team_leader|campaign_manager/.test(TOOL), 'and refuses an account that may not publish the list');
}

console.log('\nG · both upload stations show whether the floor matches the list after a publish (spec 011 US3)');
{
  const VAS = fs.readFileSync(path.join(ROOT, 'nicks_code', 'index.html'), 'utf8');
  const fnOf = (src) => { const i = src.indexOf('function reportListPublish('); return i < 0 ? '' : src.slice(i, i + 3000); };
  for (const [name, src] of [['VAS', VAS], ['Ops', PAGE]]) {
    const f = fnOf(src);
    ok(/integrity/.test(f) && /in_step/.test(f), name + ' station reads the integrity result in reportListPublish');
    ok(/could not be confirmed/i.test(f), name + ' says "could not be confirmed" when the check could not be read');
  }
}

console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
process.exit(fail ? 1 : 0);
