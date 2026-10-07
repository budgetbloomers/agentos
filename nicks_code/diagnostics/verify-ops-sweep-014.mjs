#!/usr/bin/env node
/* verify-ops-sweep-014.mjs — THE OPS HALF OF THE SYSTEM BUG SWEEP (Spec Kit 014, 2026-10-07).
 *
 * specs/014-system-bug-sweep/tasks.md, Area O. Every check drives the REAL page script in a Node VM
 * against a fake cloud (the harness of verify-ops-cas.mjs, with a recording DOM, captured timers and
 * a scripted network), so each one failed against the page before its fix and passes after it:
 *
 *   O1  a config save conflict never brings a dropped agent back into the identity maps
 *   O2  the relay's ViciDial self-heal finds the batch by original_file_name: a lost file is
 *       re-applied, a file whose rows are present is NOT re-downloaded
 *   O3  a relayed file whose store save failed is un-decided and re-applied on the next cycle
 *   O4  a team-scoped team leader's tab never publishes the shared digests
 *   O5  the anchor date ignores facts dated after today (leave filed ahead)
 *   O6  the cbx-fresh poller never re-inits over a load whose save is still pending
 *       (review R1) …but a refused save holds it for ten minutes, not for good; while held, another user's upload
 *       is said once and loaded when the hold ends; a refused shim retry is never taken for this tab's own write
 *   O7  the AI coaching reply is escaped before it is painted
 *   O8  a replay re-mints a batch id the fresh STORE carries even before the audit names it
 *   O9  the nba-digest stale-publisher self-heal reads the {value} the shim returns
 *   O10 a campaign outside the three buckets can be chosen in the filter bar and filters
 *   O11 the cycle panels read the whole floor whatever the filter bar says
 *   O12 the Agent List publish is dated by the SAST day
 *
 *   node nicks_code/diagnostics/verify-ops-sweep-014.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PAGE = fs.readFileSync(process.env.OPS_PAGE || path.join(ROOT, 'Chatterbox_AgentOS_Analytics.html'), 'utf8');   // OPS_PAGE: run against another copy (e.g. the pre-fix page) to see the checks fail
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  ok   ' + m); };
const bad = (m, d) => { fail++; console.log('  FAIL ' + m + (d ? '\n       ' + d : '')); };
const check = (cond, m, d) => (cond ? ok(m) : bad(m, d));

/* ── the page, in a VM: recording DOM, captured timers, scripted network, fake cloud ───────── */
const blocks = [...PAGE.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const el = () => new Proxy(function () {}, {
  get: (_, k) => { if (k === 'style' || k === 'dataset' || k === 'classList') return el(); if (k === 'children' || k === 'childNodes') return [];
    if (k === 'innerHTML' || k === 'textContent' || k === 'value') return ''; if (k === Symbol.toPrimitive) return () => ''; return el(); },
  set: () => true, apply: () => el(),
});
const WATCH = ['filterPanel', 'acAI'];                 // elements whose painted HTML a check reads back
const rec = {};
const recEl = (id) => rec[id] || (rec[id] = { id, innerHTML: '', textContent: '', style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  appendChild() {}, remove() {}, setAttribute() {}, addEventListener() {}, querySelector: () => el(), querySelectorAll: () => [] });
const listeners = {};
const doc = {
  querySelector: (s) => { const m = /^#([\w-]+)$/.exec(s || ''); return m && WATCH.includes(m[1]) ? recEl(m[1]) : el(); },
  querySelectorAll: () => [], getElementById: (id) => (WATCH.includes(id) ? recEl(id) : null), createElement: () => el(),
  addEventListener: (ev, f) => { (listeners[ev] = listeners[ev] || []).push(f); }, body: el(), documentElement: el(), head: el(), readyState: 'complete',
};
const timeouts = [], intervals = [];
const cloud = {}; const saves = []; let conflictsToServe = {}; let failKeys = {};
const storage = {
  ver: {}, fresh: {},
  get: async (k) => (k in cloud ? { value: typeof cloud[k] === 'string' ? cloud[k] : JSON.stringify(cloud[k]) } : null),   // the shim's shape: {value: string}
  set: async (k, v, opts) => {
    if (failKeys[k]) return { failed: true };
    if (conflictsToServe[k] > 0) { conflictsToServe[k]--; return { conflict: true, current: 'v2' }; }
    let val; try { val = JSON.parse(v); } catch (e) { val = v; }              // ai-digest-ops is plain text
    saves.push({ k, opts, val }); cloud[k] = val; return { ok: true };
  },
  delete: async () => {},
};
let net = () => Promise.reject(new Error('no net'));
const sandbox = {
  document: doc, console: { log() {}, info() {}, warn() {}, error() {} },
  setTimeout: (f, ms) => { timeouts.push({ f, ms }); return timeouts.length; }, clearTimeout: () => {}, requestAnimationFrame: () => 0,
  setInterval: (f, ms) => { intervals.push({ f, ms }); return intervals.length; }, clearInterval: () => {},
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  sessionStorage: { getItem: (k) => (k === 'cbx_token' ? 'tok' : null), setItem: () => {}, removeItem: () => {} },
  indexedDB: { open: () => ({}) }, fetch: (u, o) => net(String(u), o || {}), location: { href: '', search: '' }, navigator: { userAgent: 'node' },
  File, AbortController, Chart: function () {}, XLSX: {}, Papa: {}, structuredClone, Date, Math, JSON, Set, Map, Promise, Object, Array, String, Number, Boolean, RegExp,
  isNaN, isFinite, parseFloat, parseInt, encodeURIComponent, decodeURIComponent,
  storage,
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
try { vm.runInContext(blocks.join('\n;\n') + '\n;window.__T={SOURCES,TRANSFORM,DEFAULT_KPIS,DEFAULT_RULES};', sandbox, { filename: 'ops-inline.js' }); }
catch (e) { console.error('page did not load: ' + e.message); process.exit(1); }
const G = sandbox; Object.assign(G, G.__T || {});
const S = G.state;
const toasts = []; G.toast = (m, kind) => { toasts.push([kind || '', String(m)]); };
G.render = () => {};                                    // painting is not under test; the data paths are
const flush = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
const json = (o, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => o, text: async () => JSON.stringify(o), arrayBuffer: async () => new ArrayBuffer(8) });
const SAST = (ms) => new Date(ms + 2 * 3600000).toISOString().slice(0, 10);
const dayOff = (n) => SAST(Date.now() + n * 86400000);

const vrow = (d, user, lead, sec, status = 'SALE') => ({ call_date: d + ' 09:00:00', phone_number_dialed: '0820000000', status, user, full_name: 'Agent ' + user, campaign_id: 'C', list_id: '1', lead_id: String(lead), length_in_sec: String(sec), list_name: 'L', status_name: 'Sale', user_group: 'G' });
const parsedOf = (rows, hash) => ({ data: rows, headers: Object.keys(rows[0]), textHash: hash });
const blankFilters = () => ({ campaign: '', team: '', agent: '', dept: '', tenure: '' });
const reset = () => {
  S.facts = { VICI_CALL_REPORT: [] }; S.batches = []; S.exceptions = []; S.pending = {}; S.syncedUploads = {};
  S.cbInfo = {}; S.agentMap = {}; S.sfOwnerMap = {}; S.filters = blankFilters();
  S.rules = JSON.parse(JSON.stringify(G.DEFAULT_RULES)); S.kpis = JSON.parse(JSON.stringify(G.DEFAULT_KPIS)).map((k) => ({ show: true, ...k }));
  saves.length = 0; toasts.length = 0; for (const k in cloud) delete cloud[k]; conflictsToServe = {}; failKeys = {};
  G.CBX_USER = { username: 'aarav', full_name: 'Aarav', role: 'admin' };
  G.bumpDataVer();
};
const roster = (list) => { const o = {}; for (const [cb, name, tl, queue] of list) o[cb] = { code: cb, name, tl, target: 5, queue, tenure: 'EXP' }; return o; };

/* ═════════════════════════════════════════════════════════════════════════════════════════ */
console.log('\nO1 · a config save conflict never brings a dropped agent back');
{
  reset();
  const listRow = (cb, name) => ({ 'Employee Code': cb, 'Agent Name': name, 'Team Leader': 'TL One', Campaign: 'Cuddle', Tenure: 'EXP', 'Call x': '', 'Sales Force': name, Target: '5', 'Start Date': '' });
  /* the other session's copy still carries CB3, who is off the list this session just loaded */
  cloud['cb-config'] = { kpis: [], rules: {}, syncedUploads: { theirs: 1 },
    cbInfo: { CB1: { name: 'Agent One' }, CB2: { name: 'Agent Two' }, CB3: { name: 'Agent Three', tl: 'TL One' } },
    agentMap: { 'Agent One': 'CB1', 'Agent Two': 'CB2', 'Agent Three': 'CB3' }, sfOwnerMap: { 'agent one': 'CB1', 'agent two': 'CB2', 'agent three': 'CB3' } };
  conflictsToServe['cb-config'] = 1;
  G.applyLoad('AGENT_LIST', { name: 'agent_list.xlsx' }, { data: [listRow('CB1', 'Agent One'), listRow('CB2', 'Agent Two')], headers: Object.keys(listRow('CB1', 'x')), textHash: 'list-v2' }, 'test');
  await flush();
  const c = cloud['cb-config'] || {};
  check(c.cbInfo && c.cbInfo.CB1 && c.cbInfo.CB2 && !c.cbInfo.CB3, 'this session rebuilt identity without CB3 — the merge did not put CB3 back in cbInfo', JSON.stringify(Object.keys(c.cbInfo || {})));
  check(c.agentMap && !c.agentMap['Agent Three'] && c.sfOwnerMap && !c.sfOwnerMap['agent three'], '…nor in agentMap / sfOwnerMap', JSON.stringify([c.agentMap, c.sfOwnerMap]));
  check(c.syncedUploads && c.syncedUploads.theirs === 1, 'the other session\'s relay decisions are still merged in', JSON.stringify(c.syncedUploads));

  /* the reverse: the OTHER session rebuilt from the newer list; this stale tab only saves a relay mark */
  reset();
  S.cbInfo = { CB1: { name: 'Agent One' }, CB2: { name: 'Agent Two' }, CB3: { name: 'Agent Three' } };
  S.agentMap = { 'Agent Three': 'CB3' }; S.sfOwnerMap = { 'agent three': 'CB3' }; S.syncedUploads = { mine: 1 };
  cloud['cb-config'] = { kpis: [], rules: {}, syncedUploads: { theirs: 1 }, identityAt: new Date().toISOString(),
    cbInfo: { CB1: { name: 'Agent One' }, CB2: { name: 'Agent Two' } }, agentMap: { 'Agent One': 'CB1' }, sfOwnerMap: { 'agent one': 'CB1' } };
  conflictsToServe['cb-config'] = 1;
  G.mapAgent('Dialler Alias', 'CB2');                  // a hand mapping made in this tab, before the save lands
  await flush();
  const d = cloud['cb-config'] || {};
  check(d.cbInfo && !d.cbInfo.CB3 && d.cbInfo.CB1, 'a stale tab saving after another session\'s rebuild adopts that rebuild — CB3 stays off', JSON.stringify(Object.keys(d.cbInfo || {})));
  check(d.agentMap && !d.agentMap['Agent Three'] && d.sfOwnerMap && !d.sfOwnerMap['agent three'], '…and its stale aliases for CB3 are not merged back', JSON.stringify([d.agentMap, d.sfOwnerMap]));
  check(d.agentMap && d.agentMap['Dialler Alias'] === 'CB2', 'a mapping made by hand in this tab survives the adoption (regression guard)', JSON.stringify(d.agentMap));
  check(d.syncedUploads && d.syncedUploads.mine === 1 && d.syncedUploads.theirs === 1, 'syncedUploads is still the union of both sessions', JSON.stringify(d.syncedUploads));
}

/* ═════════════════════════════════════════════════════════════════════════════════════════ */
/* a relay cycle against a scripted Worker: manifest, downloads, and readUpload by file name */
let manifest = { files: [] }; const downloads = []; const parsedByName = {};
const relayNet = (u) => {
  if (/\/api\/upload-manifest/.test(u)) return Promise.resolve(json(manifest));
  const m = /\/api\/upload-file\?hash=([^&]+)/.exec(u);
  if (m) { downloads.push(decodeURIComponent(m[1])); return Promise.resolve(json({})); }
  return Promise.reject(new Error('unexpected ' + u));
};
G.readUpload = async (file) => { const p = parsedByName[file.name]; if (!p) throw new Error('no fixture for ' + file.name); return p; };
const relayCycle = async () => { net = relayNet; downloads.length = 0; await G.syncUploadsFromVAS(); await flush(); };
const isoAgo = (days) => new Date(Date.now() - days * 86400000).toISOString();

console.log('\nO2 · the ViciDial self-heal: a lost file is re-applied, a present one is not re-downloaded');
{
  reset();
  const N1 = 'EXPORT_CALL_REPORT_20260901.txt', N2 = 'EXPORT_CALL_REPORT_20260902.txt', N3 = 'EXPORT_CALL_REPORT_20260903.txt';
  parsedByName[N1] = parsedOf([vrow('2026-09-01', 'CB1', 1, 100), vrow('2026-09-01', 'CB2', 2, 200)], 'th-' + N1);
  parsedByName[N2] = parsedOf([vrow('2026-09-02', 'CB1', 3, 300)], 'th-' + N2);
  parsedByName[N3] = parsedOf([vrow('2026-09-03', 'CB1', 4, 400)], 'th-' + N3);
  for (const n of [N1, N2, N3]) G.applyLoad('VICI_CALL_REPORT', { name: n }, parsedByName[n], 'auto-relayed from the VAS Upload Station');
  const b1 = S.batches.find((b) => b.original_file_name === N1);
  S.facts.VICI_CALL_REPORT = S.facts.VICI_CALL_REPORT.filter((r) => r._batch !== b1.batch_id);   // another session saved over 1 Sep
  S.pending = {};
  S.syncedUploads = { h1: 1, h2: 1, h3: 1 };
  manifest = { files: [{ n: N3, h: 'h3', at: isoAgo(0.05) }, { n: N2, h: 'h2', at: isoAgo(10) }, { n: N1, h: 'h1', at: isoAgo(11) }] };
  await relayCycle();
  check(downloads.includes('h1'), 'the 1 Sep file — audit says loaded, store has none of its rows — is fetched again', JSON.stringify(downloads));
  const back = (cloud['cb-facts-VICI_CALL_REPORT'] || []).filter((r) => r._d === '2026-09-01').length;
  check(back === 2, '…re-applied, and its 2 rows are in the saved store', 'rows for 1 Sep in the cloud: ' + back);
  check(!downloads.includes('h3') && !downloads.includes('h2'), 'files whose rows are present are NOT re-downloaded — not even one archived today', JSON.stringify(downloads));
  await relayCycle();
  check(downloads.length === 0, 'the next cycle downloads nothing at all', JSON.stringify(downloads));
}

console.log('\nO3 · a relayed file whose store save failed is un-decided and re-applied');
{
  reset();
  const N4 = 'EXPORT_CALL_REPORT_20260904.txt';
  parsedByName[N4] = parsedOf([vrow('2026-09-04', 'CB1', 5, 500), vrow('2026-09-04', 'CB2', 6, 600)], 'th-' + N4);
  manifest = { files: [{ n: N4, h: 'h4', at: isoAgo(0.01) }] };
  failKeys['cb-facts-VICI_CALL_REPORT'] = 1;            // the store save is refused (e.g. 400 Memory limit)
  await relayCycle();
  check(downloads.includes('h4'), 'fixture: the new file was fetched and applied', JSON.stringify(downloads));
  check(!S.syncedUploads.h4, 'after the failed store save the file is NOT marked decided', JSON.stringify(S.syncedUploads));
  check(!(cloud['cb-config'] && cloud['cb-config'].syncedUploads && cloud['cb-config'].syncedUploads.h4), '…nor is a decided mark saved to the shared config', JSON.stringify(cloud['cb-config'] && cloud['cb-config'].syncedUploads));
  delete failKeys['cb-facts-VICI_CALL_REPORT'];
  await relayCycle();                                    // same tab, next cycle: the rows are still in memory
  const saved = (cloud['cb-facts-VICI_CALL_REPORT'] || []).filter((r) => r._d === '2026-09-04').length;
  check(downloads.includes('h4') && saved === 2, 'the next cycle fetches it again and the store save now carries its 2 rows', 'downloads ' + JSON.stringify(downloads) + ', saved rows ' + saved);
  check(S.syncedUploads.h4 === 1, '…and only then is it decided', JSON.stringify(S.syncedUploads));
  const bs = S.batches.filter((b) => b.original_file_name === N4);
  check(bs.length === 1 && !bs[0].save_failed, 'one batch record for the file, no longer flagged unsaved', JSON.stringify(bs.map((b) => [b.batch_id, b.save_failed])));

  /* a key-superseding source: the unsaved file is re-applied only while it is still the newest of its source */
  reset();
  const oc = (cn) => ({ 'Case ID': 'I' + cn, 'Case Number': cn, Subject: 'S', 'Date/Time Opened': '2026-09-20 08:00', 'Age (Hours)': '1', Open: '1', 'Account Name': 'A',
    'Account Number': 'AC' + cn, 'Account Mobile from Person Account': '', 'Person Account: Email': '', 'Case Record Type': 'Lead', 'Case Owner': 'Agent One', Status: 'New' });
  const OLD = 'open_cases_0920.csv', NEW = 'open_cases_0921.csv';
  parsedByName[OLD] = parsedOf([oc('C1'), oc('C2')], 'th-' + OLD);
  parsedByName[NEW] = parsedOf([oc('C3')], 'th-' + NEW);
  manifest = { files: [{ n: OLD, h: 'hOld', at: isoAgo(0.02) }] };
  failKeys['cb-facts-SF_OPEN_CASES'] = 1;
  await relayCycle();
  check(!S.syncedUploads.hOld && (S.batches.find((b) => b.original_file_name === OLD) || {}).save_failed === true, 'fixture: the open-cases book failed to save and was un-decided', JSON.stringify(S.syncedUploads));
  delete failKeys['cb-facts-SF_OPEN_CASES'];
  G.applyLoad('SF_OPEN_CASES', { name: NEW }, parsedByName[NEW], 'hand upload');   // a newer book lands by hand and saves
  await G.saveFacts('SF_OPEN_CASES');
  await relayCycle();
  const book = (cloud['cb-facts-SF_OPEN_CASES'] || []).map((r) => r.case_number);
  check(downloads.includes('hOld') && JSON.stringify(book) === '["C3"]', 'an older unsaved book is NOT re-applied over the newer one that landed since', 'downloads ' + JSON.stringify(downloads) + ', book ' + JSON.stringify(book));
  check(S.syncedUploads.hOld === 1, '…it is decided, so it is not fetched again', JSON.stringify(S.syncedUploads));
}

/* ═════════════════════════════════════════════════════════════════════════════════════════ */
console.log('\nO4 · a team-scoped team leader never publishes the shared digests');
{
  reset();
  S.cbInfo = roster([['CB1', 'Agent One', 'TL One', 'Cuddle'], ['CB2', 'Agent Two', 'TL Two', 'Courtesy']]);
  S.facts = { VICI_CALL_REPORT: [] }; G.bumpDataVer();
  const digestPush = intervals.find((t) => t.ms === 90000);
  const pubs = () => saves.filter((s) => s.k === 'nba-digest' || s.k === 'ai-digest-ops').map((s) => s.k);
  G.CBX_USER = { username: 'tlone', full_name: 'TL One', role: 'tl' }; G.bumpDataVer();
  G.__nbaPush(); if (digestPush) digestPush.f(); await flush();
  check(pubs().length === 0, 'a TL tab publishes neither nba-digest nor ai-digest-ops', JSON.stringify(pubs()));
  G.CBX_USER = { username: 'aarav', full_name: 'Aarav', role: 'admin' }; G.bumpDataVer();
  G.__nbaPush(); if (digestPush) digestPush.f(); await flush();
  const nba = saves.filter((s) => s.k === 'nba-digest').pop();
  check(nba && nba.val.agents.length === 2 && pubs().includes('ai-digest-ops'), 'an unscoped tab still publishes both, over the whole floor (control)', JSON.stringify(pubs()) + ' agents ' + (nba && nba.val.agents.length));
}

console.log('\nO9 · the nba-digest stale-publisher self-heal fires');
{
  /* continuing from O4: this tab published; now an older engine's copy (no `rules`) replaces it */
  cloud['nba-digest'] = { v: 1, agents: [] };
  const before = saves.filter((s) => s.k === 'nba-digest').length;
  G.__nbaPush(); await flush();
  const after = saves.filter((s) => s.k === 'nba-digest').length;
  check(after === before + 1, 'an unchanged payload is republished over a copy without `rules`', 'nba-digest saves ' + before + ' → ' + after);
  G.__nbaPush(); await flush();
  check(saves.filter((s) => s.k === 'nba-digest').length === after, '…and not again once the cloud copy carries them', 'saves ' + saves.filter((s) => s.k === 'nba-digest').length);
}

/* ═════════════════════════════════════════════════════════════════════════════════════════ */
console.log('\nO5 · the anchor date ignores facts dated after today');
{
  reset();
  const past = dayOff(-2), ahead = dayOff(13);
  S.facts = { VICI_CALL_REPORT: [{ _d: past }], ATTENDANCE: [{ _d: ahead, employee_code: 'CB1', status_code: 'AL' }] }; G.bumpDataVer();
  const a = G.isoDay(G.anchorDate());
  check(a === past, 'leave filed ' + ahead + ' does not move the anchor — it is the last day with facts up to today (' + past + ')', 'anchor ' + a);
  const w = G.periodWindow();
  check(w.to <= dayOff(0), 'the period window never ends in the future', JSON.stringify(w));
}

/* ═════════════════════════════════════════════════════════════════════════════════════════ */
console.log('\nO6 · the cbx-fresh poller does not re-init over a pending save');
{
  reset();
  const poll = intervals.find((t) => t.ms === 240000);
  let inits = 0; G.init = async () => { inits++; };
  let stamp = 'a1';
  net = (u) => (/key=cb-audit&meta=1/.test(u) ? Promise.resolve(json({ updated_at: stamp })) : Promise.reject(new Error('unexpected ' + u)));
  vm.runInContext('__initDone=true;', sandbox);
  G.__cbxLastWrite = 0;
  poll.f(); await flush();                               // first sighting: a1
  /* this tab applied a file; its save has not been made yet */
  G.applyLoad('VICI_CALL_REPORT', { name: 'EXPORT_CALL_REPORT_20260905.txt' }, parsedOf([vrow('2026-09-05', 'CB1', 7, 70)], 'th-5'), 'test');
  G.__cbxLastWrite = 0; stamp = 'a2';                    // and another user's upload moved the audit
  poll.f(); await flush();
  check(inits === 0, 'with this tab\'s load still unsaved the poller does not reload the stores over it', 'init() ran ' + inits + ' time(s)');
  await G.saveFacts('VICI_CALL_REPORT');
  G.__cbxLastWrite = 0;
  poll.f(); await flush();
  check(inits === 1, 'once the save is acknowledged the other user\'s upload is picked up (control)', 'init() ran ' + inits + ' time(s)');
}

/* ═════════════════════════════════════════════════════════════════════════════════════════ */
console.log('\nO6 · R1 · a refused save holds the reload for ten minutes, not for good');
{
  /* the shim re-queues a refused save for ever (a 400 "Memory limit" or a 413 never clears) and keeps no time or
     status, and every retry stamps __cbxLastWrite — the tab must still pick up other users' uploads */
  reset();
  const poll = intervals.find((t) => t.ms === 240000);
  let inits = 0; G.init = async () => { inits++; };
  let stamp = 'r0';
  net = (u) => (/key=cb-audit&meta=1/.test(u) ? Promise.resolve(json({ updated_at: stamp })) : Promise.reject(new Error('unexpected ' + u)));
  const realNow = Date.now; let skew = 0; Date.now = () => realNow() + skew;
  const QUEUED = () => ({ 'cb-facts-VICI_CALL_REPORT': '[]' });
  const notices = () => toasts.filter(([, m]) => /another user/i.test(m)).length;
  try {
    G.__cbxFailedSaves = {}; G.__cbxLastWrite = 0; G.__cbxSaveOk = 0;
    poll.f(); await flush(); inits = 0;                  // baseline: r0 is the stamp this tab has seen
    G.__cbxFailedSaves = QUEUED(); stamp = 'r1';         // this tab's save was refused; another user uploads meanwhile
    poll.f(); await flush();
    check(inits === 0, 'a refused save minutes old still holds the reload while the shim retries it (control)', 'init() ran ' + inits + ' time(s)');
    check(notices() === 1, 'while it holds, the tab still reads the audit stamp and says another user uploaded', JSON.stringify(toasts));
    poll.f(); await flush();
    check(notices() === 1 && inits === 0, '…once, not on every beat', notices() + ' notice(s), init() ' + inits);
    skew = 11 * 60000;                                   // eleven minutes on: the retry just ran (stamping the write clock) and failed again
    G.__cbxLastWrite = Date.now(); G.__cbxSaveOk = Date.now() - 9 * 60000;
    poll.f(); await flush();
    check(inits === 1, 'eleven minutes on, the still-refused save no longer holds it: the upload the notice named is loaded', 'init() ran ' + inits + ' time(s)');
    stamp = 'r2'; G.__cbxLastWrite = 0;
    poll.f(); await flush();
    check(inits === 2, 'a refused save older than ten minutes does not hold the reload of the next upload either', 'init() ran ' + inits + ' time(s)');
    stamp = 'r3'; G.__cbxLastWrite = Date.now();         // another failed retry: the write clock moved, the store did not
    poll.f(); await flush();
    check(inits === 3, 'the shim\'s refused retry stamping __cbxLastWrite is not taken for this tab\'s own write (no silent adopt)', 'init() ran ' + inits + ' time(s)');
    G.__cbxFailedSaves = {}; stamp = 'r4'; G.__cbxLastWrite = Date.now(); G.__cbxSaveOk = Date.now(); const n4 = inits;
    poll.f(); await flush();
    check(inits === n4, 'a write of this tab\'s that WAS saved is still adopted, not re-pulled (control)', 'init() ran ' + (inits - n4) + ' more time(s)');
    /* a fresh refusal of a NEW load restarts the hold, although the key sat in the queue long before */
    G.__cbxLastWrite = 0; skew = 0; G.__cbxFailedSaves = QUEUED(); poll.f(); await flush();   // first sighting at t=0
    skew = 30 * 60000; failKeys['cb-facts-VICI_CALL_REPORT'] = true;
    G.applyLoad('VICI_CALL_REPORT', { name: 'EXPORT_CALL_REPORT_20260906.txt' }, parsedOf([vrow('2026-09-06', 'CB1', 8, 80)], 'th-6'), 'test');
    await G.saveFacts('VICI_CALL_REPORT');
    stamp = 'r5'; G.__cbxLastWrite = 0; const n0 = inits;
    poll.f(); await flush();
    check(inits === n0, 'a new load whose save is refused now holds the reload again — its clock starts at this refusal', 'init() ran ' + (inits - n0) + ' more time(s)');
  } finally { Date.now = realNow; delete G.__cbxFailedSaves; G.__cbxLastWrite = 0; G.__cbxSaveOk = 0; }
}

/* ═════════════════════════════════════════════════════════════════════════════════════════ */
console.log('\nO7 · the AI coaching reply is escaped');
{
  reset();
  S.cbInfo = roster([['CB1', 'Agent One', 'TL One', 'Cuddle'], ['CB2', 'Agent Two', 'TL One', 'Cuddle']]); G.bumpDataVer();
  const HOSTILE = '<img src=x onerror="alert(1)">\nSecond <b>line</b>';
  net = (u) => (/\/api\/ask/.test(u) ? Promise.resolve(json({ answer: HOSTILE })) : Promise.resolve(json({ sessions: [], themes: [] })));
  rec.acAI = undefined;
  const t0 = timeouts.length;
  let threw = null; try { await G.agentOpen('CB1'); } catch (e) { threw = e.message; }
  for (const t of timeouts.slice(t0)) { try { if (String(t.f).includes('acAI')) t.f(); } catch (e) { /* not under test */ } }
  await flush();
  const h = (rec.acAI && rec.acAI.innerHTML) || '';
  check(!threw && h.length > 0, 'fixture: the agent card opened and the reply was painted', threw || ('innerHTML ' + JSON.stringify(h)));
  check(!/<img/i.test(h) && !/<b>/.test(h) && /&lt;img/.test(h), 'a hostile reply is painted as text — no live <img onerror>', JSON.stringify(h));
  check(/<br>/.test(h), '…while its line breaks still render', JSON.stringify(h));
}

/* ═════════════════════════════════════════════════════════════════════════════════════════ */
console.log('\nO8 · a replay re-mints an id the fresh store carries before the audit names it');
{
  reset();
  /* the other session saved its FACTS (B0001 2 Sep, B0002 4 Sep) but its audit save has not landed */
  cloud['cb-facts-VICI_CALL_REPORT'] = [Object.assign(G.TRANSFORM.VICI_CALL_REPORT(vrow('2026-09-02', 'CB1', 10, 100)), { _batch: 'B0001' }),
    Object.assign(G.TRANSFORM.VICI_CALL_REPORT(vrow('2026-09-02', 'CB2', 11, 200)), { _batch: 'B0001' }),
    Object.assign(G.TRANSFORM.VICI_CALL_REPORT(vrow('2026-09-04', 'CB2', 12, 200)), { _batch: 'B0002' })];
  cloud['cb-audit'] = { batches: [], exceptions: [] };
  const res = G.applyLoad('VICI_CALL_REPORT', { name: 'EXPORT_CALL_REPORT_20260903.txt' }, parsedOf([vrow('2026-09-03', 'CB1', 20, 300)], 'mine'), 'test');
  conflictsToServe['cb-facts-VICI_CALL_REPORT'] = 1;
  await G.saveFacts('VICI_CALL_REPORT');
  const days = {}; for (const x of cloud['cb-facts-VICI_CALL_REPORT'] || []) days[x._d] = (days[x._d] || 0) + 1;
  check(days['2026-09-02'] === 2 && days['2026-09-04'] === 1 && days['2026-09-03'] === 1, 'their 2 Sep rows survive the replay — B0001 in their store was not taken for ours', JSON.stringify(days));
  check(res.batch.batch_id === 'B0003', 'ours was re-minted past every id in their rows (B0003, not B0001 or B0002)', res.batch.batch_id);
}

/* ═════════════════════════════════════════════════════════════════════════════════════════ */
console.log('\nO10 · a campaign outside the three buckets is offered and filters');
{
  reset();
  S.cbInfo = roster([['CB1', 'Agent One', 'TL One', 'Cuddle'], ['CB5', 'Agent Five', 'TL One', 'Download & Test']]);
  S.facts = { ATTENDANCE: [{ employee_code: 'CB1', _d: '2026-09-02', status_code: 'P' }, { employee_code: 'CB5', _d: '2026-09-02', status_code: 'P' }] }; G.bumpDataVer();
  rec.filterPanel = undefined; G.drawFilters();
  const html = (rec.filterPanel && rec.filterPanel.innerHTML) || '';
  check(/value="Download &amp; Test"/.test(html), 'the campaign dropdown offers "Download & Test" from the roster\'s queue', (html.match(/<option[^>]*>[^<]*<\/option>/g) || []).filter((o) => !/>All</.test(o)).slice(0, 8).join(' '));
  S.filters.campaign = 'Download & Test'; G.bumpDataVer();
  const rows = G.rowsForRaw('ATTENDANCE', { from: '2026-09-01', to: '2026-09-30' });
  check(rows.length === 1 && rows[0].employee_code === 'CB5', 'choosing it returns that campaign\'s rows', JSON.stringify(rows.map((r) => r.employee_code)));
  S.filters.campaign = 'Cuddle'; G.bumpDataVer();
  const rc = G.rowsForRaw('ATTENDANCE', { from: '2026-09-01', to: '2026-09-30' });
  check(rc.length === 1 && rc[0].employee_code === 'CB1', 'a bucket campaign filters exactly as before (control)', JSON.stringify(rc.map((r) => r.employee_code)));
  const tl = PAGE.match(/if\(GF\.campaign&&[^)]*\([^)]*\)\)?!==GF\.campaign\)return false;/g) || [];
  check(tl.length === 2 && tl.every((s) => /campFilterKey\(i\.queue\)/.test(s)), 'the Team Leader and Brain pages filter the roster with the same key', tl.join(' | '));
}

/* ═════════════════════════════════════════════════════════════════════════════════════════ */
console.log('\nO11 · the cycle panels read the whole floor under a filter');
{
  reset();
  S.cbInfo = roster([['CB1', 'Agent One', 'TL One', 'Cuddle'], ['CB2', 'Agent Two', 'TL Two', 'Courtesy']]);
  S.sfOwnerMap = { [G.normName('Agent One')]: 'CB1', [G.normName('Agent Two')]: 'CB2' };
  S.facts = { BI_ACTIVE_CASES: [
    { account_number: 'A1', owner: 'Agent One', charge_amount: 100, _d: '2026-09-28', _batch: 'B0001' },
    { account_number: 'A2', owner: 'Agent Two', charge_amount: 200, _d: '2026-09-28', _batch: 'B0001' }] };
  S.rules.cycleStart = { label: 'x', vals: ['2026-09-26'] };
  S.filters.campaign = 'Cuddle'; G.bumpDataVer();
  const cc = G.cycleCalc('cycle');
  check(cc && cc.byCamp.Courtesy > 0 && cc.byCamp.Cuddle > 0, 'with the filter on Cuddle, Courtesy\'s cycle still reads its money', JSON.stringify(cc && cc.byCamp));
  check(S.filters.campaign === 'Cuddle', 'the filter bar is left exactly as the user set it', JSON.stringify(S.filters));
}

/* ═════════════════════════════════════════════════════════════════════════════════════════ */
console.log('\nO12 · the Agent List publish is dated by the SAST day');
{
  reset();
  S.facts = { AGENT_LIST: [{ cb_code: 'CB1', cb_norm: 'CB1', agent_name: 'Agent One', team_leader: 'TL One', queue: 'Cuddle' }] };
  S.batches = [{ batch_id: 'B0001', source_type: 'AGENT_LIST', validation_status: 'passed', uploaded_at: '2026-10-06T23:30:00.000Z' }];   // 01:30 SAST on 7 Oct
  let body = null;
  net = (u, o) => { if (/\/api\/roster/.test(u)) { body = JSON.parse(o.body); return Promise.resolve(json({ accepted: true, n: 1 })); } return Promise.reject(new Error('unexpected ' + u)); };
  G.publishRoster('agent_list.xlsx'); await flush();
  check(body && body.as_of === '2026-10-07', 'a list uploaded at 01:30 SAST on 7 Oct is published as of 2026-10-07', 'as_of ' + (body && body.as_of));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
