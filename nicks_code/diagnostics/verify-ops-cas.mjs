#!/usr/bin/env node
/* verify-ops-cas.mjs — THE FACT STORE MUST NOT LOSE ANOTHER SESSION'S FILE (2026-09-14).
 *
 * Found in the Ops audit: ViciDial's 3 Sep export (batch B0160, 19,121 rows) was loaded by one
 * session at 08:37 and gone by 10:33, when a second session — the headless relay and a browser
 * tab both hold whole stores in memory and write them back whole — saved its own copy over it.
 * 27–29 Aug went the same way. The fix is a compare-and-set write (Worker) with a reload-and-
 * replay on conflict (Ops). This drives the REAL page script in a VM against a fake cloud and
 * proves the replay, then reads the Worker and the shim for the wire contract.
 *
 *   node nicks_code/diagnostics/verify-ops-cas.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const rd = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const PAGE = rd('Chatterbox_AgentOS_Analytics.html');
const WORKER = rd('worker', 'src', 'index.mjs');
const SHIM = rd('tools', 'prepare-site.js');
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  ok   ' + m); };
const bad = (m, d) => { fail++; console.log('  FAIL ' + m + (d ? '\n       ' + d : '')); };

/* ── the page, in a VM with a fake cloud ─────────────────────────────────── */
const blocks = [...PAGE.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const el = () => new Proxy(function () {}, {
  get: (_, k) => { if (k === 'style' || k === 'dataset' || k === 'classList') return el(); if (k === 'children' || k === 'childNodes') return [];
    if (k === 'innerHTML' || k === 'textContent' || k === 'value') return ''; if (k === Symbol.toPrimitive) return () => ''; return el(); },
  set: () => true, apply: () => el(),
});
const doc = { querySelector: () => el(), querySelectorAll: () => [], getElementById: () => null, createElement: () => el(), addEventListener: () => {}, body: el(), documentElement: el(), head: el(), readyState: 'complete' };
/* the fake cloud: what "the other session" wrote, and every save this session makes */
const cloud = {}; const saves = []; let conflictsToServe = {};
const storage = {
  ver: {}, fresh: {},
  get: async (k) => (k in cloud ? { value: JSON.stringify(cloud[k]) } : null),
  set: async (k, v, opts) => {
    if (conflictsToServe[k] > 0) { conflictsToServe[k]--; return { conflict: true, current: 'v2' }; }
    saves.push({ k, opts, rows: JSON.parse(v) }); cloud[k] = JSON.parse(v); return { ok: true };
  },
  delete: async () => {},
};
const sandbox = {
  document: doc, console: { log() {}, info() {}, warn() {}, error() {} }, setTimeout: (f) => 0, clearTimeout: () => {}, requestAnimationFrame: () => 0,
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }, sessionStorage: { getItem: () => null, setItem: () => {} },
  indexedDB: { open: () => ({}) }, fetch: () => Promise.reject(new Error('no net')), location: { href: '', search: '' }, navigator: { userAgent: 'node' },
  Chart: function () {}, XLSX: {}, Papa: {}, structuredClone, Date, Math, JSON, Set, Map, Promise, Object, Array, String, Number, Boolean, RegExp, isNaN, parseFloat, parseInt,
  storage,
};
sandbox.window = sandbox; sandbox.globalThis = sandbox; sandbox.setInterval = () => 0;
vm.createContext(sandbox);
try { vm.runInContext(blocks.join('\n;\n') + '\n;window.__T={SOURCES,TRANSFORM,DEFAULT_KPIS,DEFAULT_RULES};', sandbox, { filename: 'ops-inline.js' }); }
catch (e) { console.error('page did not load: ' + e.message); process.exit(1); }
const G = sandbox; Object.assign(G, G.__T || {});
if (typeof G.applyLoad !== 'function' || typeof G.saveFacts !== 'function' || typeof G.mergeIntoStore !== 'function') { console.error('FATAL: applyLoad / saveFacts / mergeIntoStore not found'); process.exit(1); }
G.toast = () => {};

const vrow = (d, user, lead, sec, status = 'SALE') => ({ call_date: d + ' 09:00:00', phone_number_dialed: '0820000000', status, user, full_name: 'Agent ' + user, campaign_id: 'C', list_id: '1', lead_id: String(lead), length_in_sec: String(sec), list_name: 'L', status_name: 'Sale', user_group: 'G' });
const parsedOf = (rows, hash) => ({ data: rows, headers: Object.keys(rows[0]), textHash: hash });
const S = G.state;
const reset = () => { S.facts = { VICI_CALL_REPORT: [] }; S.batches = []; S.exceptions = []; S.pending = {}; S.syncedUploads = {}; saves.length = 0; for (const k in cloud) delete cloud[k]; conflictsToServe = {}; };

console.log('\nA · a save that loses the race replays this session\'s batch onto the other session\'s copy');
{
  reset();
  /* this session booted with an empty store; meanwhile the other session loaded 2 Sep (B0001) */
  cloud['cb-facts-VICI_CALL_REPORT'] = [vrow('2026-09-02', 'CB1', 10, 100), vrow('2026-09-02', 'CB2', 11, 200)].map((r) => Object.assign(G.TRANSFORM.VICI_CALL_REPORT(r), { _batch: 'B0001' }));
  cloud['cb-audit'] = { batches: [{ batch_id: 'B0001', source_type: 'VICI_CALL_REPORT', file_hash: 'other-file', uploaded_at: '2026-09-07T08:37:00Z' }], exceptions: [] };
  /* this session loads 3 Sep — and, counting from its own boot copy, also mints B0001 */
  const res = G.applyLoad('VICI_CALL_REPORT', { name: 'EXPORT_CALL_REPORT_20260903.txt' }, parsedOf([vrow('2026-09-03', 'CB1', 20, 300), vrow('2026-09-03', 'CB3', 21, 400), vrow('2026-09-03', 'CB3', 21, 400)], 'my-file'), 'test');
  res.batch.batch_id === 'B0001' ? ok('both sessions minted B0001 — the collision the replay must survive') : bad('fixture: expected B0001, got ' + res.batch.batch_id);
  res.loaded === 2 ? ok('the in-file duplicate was dropped once (2 of 3 rows loaded)') : bad('in-file dedupe changed: loaded ' + res.loaded);
  conflictsToServe['cb-facts-VICI_CALL_REPORT'] = 1;          // the Worker says: your base is stale
  const r = await G.saveFacts('VICI_CALL_REPORT');
  (r && r.ok) ? ok('the second attempt saved') : bad('save did not succeed after the conflict', JSON.stringify(r));
  const final = cloud['cb-facts-VICI_CALL_REPORT'] || [];
  const days = {}; for (const x of final) days[x._d] = (days[x._d] || 0) + 1;
  (days['2026-09-02'] === 2 && days['2026-09-03'] === 2) ? ok('the saved store carries BOTH files — 2 Sep (theirs) and 3 Sep (ours): ' + JSON.stringify(days)) : bad('rows were lost in the replay', JSON.stringify(days));
  const ids = new Set(final.map((x) => x._batch));
  (ids.size === 2 && res.batch.batch_id !== 'B0001') ? ok('our batch was re-minted to ' + res.batch.batch_id + ' — their B0001 rows were not mistaken for our previous rows') : bad('batch id clash not resolved', [...ids].join(','));
  (S.batches[0].batch_id === res.batch.batch_id) ? ok('the batch record in the audit carries the re-minted id') : bad('audit record still says B0001');
  (saves.filter((s) => s.k === 'cb-facts-VICI_CALL_REPORT').every((s) => s.opts && s.opts.cas)) ? ok('every fact-store save asked for compare-and-set') : bad('a fact-store save went out without cas');
  (!S.pending.VICI_CALL_REPORT) ? ok('the pending list is cleared once the store is saved') : bad('pending batches linger after a successful save');
}

console.log('\nB · the same file already in the other session\'s copy is not doubled');
{
  reset();
  const rows = [vrow('2026-09-04', 'CB1', 30, 100), vrow('2026-09-04', 'CB2', 31, 200)];
  const res = G.applyLoad('VICI_CALL_REPORT', { name: 'f.txt' }, parsedOf(rows, 'same-file'), 'test');
  /* the other session loaded the SAME file (same hash) under the same id and saved first */
  cloud['cb-facts-VICI_CALL_REPORT'] = rows.map((r) => Object.assign(G.TRANSFORM.VICI_CALL_REPORT(r), { _batch: res.batch.batch_id }));
  cloud['cb-audit'] = { batches: [{ batch_id: res.batch.batch_id, source_type: 'VICI_CALL_REPORT', file_hash: 'same-file', uploaded_at: '2026-09-07T08:37:00Z' }], exceptions: [] };
  conflictsToServe['cb-facts-VICI_CALL_REPORT'] = 1;
  await G.saveFacts('VICI_CALL_REPORT');
  const final = cloud['cb-facts-VICI_CALL_REPORT'];
  final.length === 2 ? ok('two rows, not four — a replay of the same file supersedes its own record keys') : bad('the same file was stacked: ' + final.length + ' rows');
}

console.log('\nC · a conflict that never resolves is reported, not forced');
{
  reset();
  G.applyLoad('VICI_CALL_REPORT', { name: 'f.txt' }, parsedOf([vrow('2026-09-05', 'CB1', 40, 100)], 'h'), 'test');
  conflictsToServe['cb-facts-VICI_CALL_REPORT'] = 99;
  let toasts = []; G.toast = (m, kind) => toasts.push([kind, m]);
  const r = await G.saveFacts('VICI_CALL_REPORT');
  (r && r.failed && toasts.some((t) => t[0] === 'err')) ? ok('after four attempts the saver gives up loudly (' + toasts.filter((t) => t[0] === 'err').length + ' error toast)') : bad('an unresolvable conflict was not surfaced', JSON.stringify(r));
  G.toast = () => {};
}

console.log('\nD · config and audit saves merge the other session\'s decisions in');
{
  reset();
  S.syncedUploads = { mine: 1 };
  cloud['cb-config'] = { kpis: [], rules: {}, agentMap: {}, sfOwnerMap: {}, cbInfo: { CB9: { tl: 'X' } }, user: 'them', syncedUploads: { theirs: 1 } };
  conflictsToServe['cb-config'] = 1;
  await G.saveConfig();
  const c = cloud['cb-config'];
  (c.syncedUploads.mine === 1 && c.syncedUploads.theirs === 1) ? ok('syncedUploads is the union — neither session re-loads what the other decided') : bad('syncedUploads lost a side', JSON.stringify(c.syncedUploads));
  (c.cbInfo && c.cbInfo.CB9) ? ok('identity entries the other session added are kept') : bad('cbInfo from the other session was dropped');
  S.batches = [{ batch_id: 'B0009', file_hash: 'a', uploaded_at: '2026-09-14T06:00:00Z' }]; S.exceptions = [];
  cloud['cb-audit'] = { batches: [{ batch_id: 'B0008', file_hash: 'b', uploaded_at: '2026-09-14T05:00:00Z' }], exceptions: [{ x: 1 }] };
  conflictsToServe['cb-audit'] = 1;
  await G.saveAudit();
  const a = cloud['cb-audit'];
  (a.batches.length === 2 && a.batches[0].batch_id === 'B0009' && a.exceptions.length === 1) ? ok('the audit is the union of both sessions\' batches, newest first') : bad('audit merge wrong', JSON.stringify(a).slice(0, 200));
}

console.log('\nE · the wire contract: shim ↔ Worker');
{
  /X-Cbx-Base/.test(SHIM) && /opts && opts\.cas\) hdrs\['X-Cbx-Base'\] = ver\[k\] \|\| 'none'/.test(SHIM) ? ok('the shim sends X-Cbx-Base only for a compare-and-set save, "none" when it read no row') : bad('shim does not send the base version');
  /r\.status === 409 && opts && opts\.cas/.test(SHIM) && /return \{ conflict: true/.test(SHIM) ? ok('a 409 on a cas save is returned to the caller, never queued for a blind retry') : bad('shim queues a conflicting save');
  /r\.status !== 425\) break;/.test(SHIM) ? ok('a read waits out a write in progress (425) instead of falling back to the cache') : bad('shim does not handle 425');
  /Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Cbx-Client,Content-Encoding,X-Cbx-Base'/.test(WORKER) ? ok('the preflight names X-Cbx-Base') : bad('X-Cbx-Base missing from the preflight allow list — the browser would refuse to send it');
  /'Access-Control-Expose-Headers': 'X-Cbx-Version'/.test(WORKER) ? ok('X-Cbx-Version is exposed to the page') : bad('X-Cbx-Version not exposed');
  /const base = req\.headers\.get\('X-Cbx-Base'\);/.test(WORKER) && /updateReturning\(pk \+ '&updated_at=eq\.'/.test(WORKER) ? ok('the Worker claims the pointer with ONE filtered PATCH on the base version — atomic') : bad('Worker CAS claim missing');
  /json\(\{ error: 'version_conflict', current: curAt \|\| 'none' \}, 409\)/.test(WORKER) ? ok('a stale base is refused with 409 version_conflict') : bad('no version_conflict response');
  /write_in_progress', retry_in_ms: 1500 \}, 425/.test(WORKER) ? ok('a GET during a claimed write answers 425, never the old blob under a new stamp') : bad('GET does not guard the claim window');
  /KV_WRITING_TTL_MS = 120000/.test(WORKER) ? ok('a dead writer\'s claim expires (120 s)') : bad('no TTL on the writing claim');
  /version: newVer/.test(WORKER) ? ok('a successful write returns the new version for the client to hold') : bad('POST does not return the new version');
  /await saveFacts\(srcKey\);await saveAudit\(\);/.test(PAGE) && !/Promise\.all\(\[saveFacts\(/.test(PAGE) ? ok('the audit is saved AFTER the facts everywhere — a re-minted batch id reaches the audit last') : bad('a call site still saves facts and audit in parallel');
  /window\.storage\.ver\[mk\]=stamp;/.test(PAGE) ? ok('a store reused from the local mirror is stamped with its cloud version at boot') : bad('boot does not stamp reused stores — their first save would conflict');
}

console.log('\nF · the relay re-applies a ViciDial file the audit says loaded but the store has lost');
{
  const at = PAGE.indexOf('async function syncUploadsFromVAS');
  const relay = PAGE.slice(at, at + 14000);
  /const lost=src==='VICI_CALL_REPORT'&&had\.loaded_row_count>0&&!\(state\.facts\[src\]\|\|\[\]\)\.some\(r=>r\._batch===had\.batch_id\)/.test(relay)
    ? ok('a ViciDial file with an audit record but no rows in the store is re-applied — the lost-update signature heals itself')
    : bad('the relay still skips a file on its audit record alone');
  /if\(!lost\)continue;/.test(relay) ? ok('…and only ViciDial is judged that way — key-superseding sources keep their skip') : bad('the re-apply is not restricted to ViciDial');
}

console.log('\nG · the Executive page after the CallX cutover reads ViciDial, not zeros');
{
  S.facts = {}; S.rules = JSON.parse(JSON.stringify(G.DEFAULT_RULES)); S.kpis = JSON.parse(JSON.stringify(G.DEFAULT_KPIS)).map((k) => ({ show: true, ...k }));
  const EXEC = ['total_calls', 'answer_rate', 'activations', 'lead_conversion', 'clean_sale_rate', 'avg_qa_score', 'attendance_rate', 'open_backlog', 'critical_rate'];
  let sept=''; try { sept = G.kpiRow(null, { from: '2026-09-01', to: '2026-09-13' }, EXEC); } catch (e) { console.log('   kpiRow threw: ' + e.message); }
  (/Vici Dials/.test(sept) && /Vici Answer Rate/.test(sept) && !/>Total Calls</.test(sept) && !/>Answer Rate</.test(sept))
    ? ok('a September window swaps Total Calls / Answer Rate for Vici Dials / Vici Answer Rate') : bad('the Executive tiles still read CallX after the cutover');
  const aug = G.kpiRow(null, { from: '2026-08-01', to: '2026-08-31' }, EXEC);
  (/>Total Calls</.test(aug) && !/Vici Dials/.test(aug)) ? ok('an August window keeps the CallX tiles — that history still counts') : bad('a pre-cutover window lost its CallX tiles');
  const salesSept = G.kpiRow('Sales', { from: '2026-09-01', to: '2026-09-13' });
  (/CallX tile/.test(salesSept) && /hidden/.test(salesSept) && !/>Unique Calls</.test(salesSept)) ? ok('the Sales page hides the CallX-only tiles for September and says so') : bad('CallX-only tiles still render as zeros on the Sales page');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
