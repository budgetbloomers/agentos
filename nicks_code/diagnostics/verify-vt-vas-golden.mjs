#!/usr/bin/env node
/* verify-vt-vas-golden.mjs — A VAS ACCOUNT'S ANSWER IS BYTE-IDENTICAL WITH OR WITHOUT VEHICLE TRACKING (spec 071, SC-003, E0).
 *
 * The REAL Worker in-process (vt-worker-harness.mjs) over a FIXED fictional VAS digest. The golden file was captured from
 * the PRE-Phase-E Worker (`--capture`, run once on c16ddfa before any Phase E edit). Every later run asks the same routes
 * twice — with no VT digest, and with a VT digest (live + history key) published beside it — and both answers must equal
 * the golden byte for byte:
 *   G1  a VAS agent (CB9201) · G2 a VAS agent with no data yet (CB9203, notCovered why:'nodata' — unchanged by the fix)
 *   G3  the VAS team leader (team "Leader Vas") · G4 the campaign manager's VAS overview (dalwin) · G5 the staff preview (admin)
 *   G6  the VAS team leader's drill-down into CB9201 (/api/portal/agent)
 * Date.now is frozen so the bodies are deterministic. Fictional people only (CB92xx).
 *
 *   node nicks_code/diagnostics/verify-vt-vas-golden.mjs [--capture]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { workerHarness, userRow } from './vt-worker-harness.mjs';
import { vasDigest, vtDigest } from './vt-digest-fixture.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN = path.join(HERE, 'vt-vas-golden.json');
const CAPTURE = process.argv.includes('--capture');
const FIXED = Date.parse('2026-11-10T08:00:00Z');
Date.now = () => FIXED;
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m + (d !== undefined ? ' — ' + String(d).slice(0, 300) : '')); } };
const quiet = console.log; const err0 = console.error, warn0 = console.warn;
console.error = () => {}; console.warn = () => {};
console.log = (...a) => { if (a.length === 1 && a[0] && typeof a[0] === 'object') return; quiet(...a); };

const W = await workerHarness();
const CASES = [
  ['G1 VAS agent CB9201', userRow({ username: 'cb9201', role: 'agent', cb: 'CB9201', full_name: 'Kilo Lima' }), '/api/portal/overview'],
  ['G2 VAS agent with no data CB9203', userRow({ username: 'cb9203', role: 'agent', cb: 'CB9203', full_name: 'Oscar Papa' }), '/api/portal/overview'],
  ['G3 VAS team leader', userRow({ username: 'leadervas', role: 'team_leader', cb: 'CB9290', team: 'Leader Vas', full_name: 'Leader Vas' }), '/api/portal/overview'],
  ['G4 campaign manager (VAS overview)', userRow({ username: 'dalwin', role: 'campaign_manager', full_name: 'Fictional Manager' }), '/api/portal/overview'],
  ['G5 staff preview (admin)', userRow({ username: 'boss', role: 'admin', apps: ['vas', 'agent'], tabs: { vas: '*' }, full_name: 'Boss' }), '/api/portal/overview'],
  ['G6 VAS team leader drills into CB9201', userRow({ username: 'leadervas', role: 'team_leader', cb: 'CB9290', team: 'Leader Vas', full_name: 'Leader Vas' }), '/api/portal/agent?cb=CB9201'],
];
/* withVt: false · true (inline copy, as before) · and since the security review (H2, 2026-11-23) three stored shapes:
   'stored' = the pointer the Worker's POST writes (store + business month + roster index codes + size) and the blob;
   'huge'   = a pointer stamped over the 2 MB cap; 'garbage' = an unstamped pointer whose blob does not parse. */
const RULES = await import(new URL('../../worker/src/rules.mjs', import.meta.url).href);
const VTPATH = '/storage/v1/object/raw/kv/vt-digest';
async function answers(withVt) {
  W.rules = { 'kv:agent-digest': vasDigest() }; W.storage = {};
  if (withVt === true) { const d = vtDigest(); W.rules['kv:vt-digest'] = d; W.rules['kv:vt-digest-cycle-2026-11'] = d; }
  if (withVt === 'stored') { const d = vtDigest(), s = JSON.stringify(d);
    W.rules['kv:vt-digest'] = { __raw: { store: 'raw/kv/vt-digest', ...RULES.vtDigestFence('vt-digest', d, null, FIXED).pointer, size: s.length } }; W.storage[VTPATH] = s; }
  if (withVt === 'huge') { W.rules['kv:vt-digest'] = { __raw: { store: 'raw/kv/vt-digest', period: 'cycle-2026-11', kind: 'vt', size: RULES.VT_DIGEST_MAX + 1 } }; W.storage[VTPATH] = '{"scorecard":"vt","agents":[' + '0,'.repeat(1000) + '0]}'; }
  if (withVt === 'garbage') { W.rules['kv:vt-digest'] = { __raw: { store: 'raw/kv/vt-digest', period: 'cycle-2026-11', kind: 'vt' } }; W.storage[VTPATH] = '{"scorecard":"vt","agents":[{"code":"CB9101"'; }
  const out = {};
  for (const [name, u, p] of CASES) { globalThis.__digestCaches = {}; globalThis.__vtDigestCaches = {}; globalThis.__vtPointerCache = null; globalThis.__cmCtx = null;
    const r = await W.call(u, 'GET', p); out[name] = { status: r.status, body: r.t, readVtBlob: (r.subs ? W.log.slice(-r.subs) : []).some((l) => l.includes(VTPATH)) }; }
  return out;
}
const before = await answers(false);
if (CAPTURE) {
  fs.writeFileSync(GOLDEN, JSON.stringify(Object.fromEntries(Object.entries(before).map(([k, v]) => [k, { status: v.status, body: v.body }])), null, 1));
  quiet('golden written: ' + GOLDEN + ' (' + Object.keys(before).length + ' answers)');
  for (const [k, v] of Object.entries(before)) quiet('  ' + k + ' → ' + v.status + ', ' + v.body.length + ' bytes');
  process.exit(0);
}
ok(fs.existsSync(GOLDEN), 'the pre-Phase-E golden exists (' + path.basename(GOLDEN) + ')');
const G = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
const withVt = await answers(true);
for (const [name] of CASES) {
  ok(G[name] && G[name].status === 200, name + ': the golden is a 200 answer', G[name] && G[name].status);
  ok(before[name].status === G[name].status && before[name].body === G[name].body, name + ': no VT digest → byte-identical to the golden', before[name].body.slice(0, 160));
  ok(withVt[name].status === G[name].status && withVt[name].body === G[name].body, name + ': VT digest published → still byte-identical to the golden', withVt[name].body.slice(0, 160));
  ok(!/"scorecard"\s*:\s*"vt"/.test(withVt[name].body), name + ': no VT scorecard in a VAS answer');
}
/* SECURITY REVIEW H2 (2026-11-23): the VT digest stored as the Worker stores it, over the cap, and unparsable — a VAS answer is
   the golden every time, and a VAS AGENT's overview decides from the pointer's roster index without reading the VT blob */
for (const shape of ['stored', 'huge', 'garbage']) {
  const A = await answers(shape);
  const same = CASES.every(([name]) => A[name].status === G[name].status && A[name].body === G[name].body);
  ok(same, 'H2 VT digest ' + shape + ': all six VAS answers byte-identical to the golden', CASES.filter(([n]) => A[n].body !== G[n].body).map(([n]) => n).join(', '));
  if (shape === 'stored') ok(!A['G1 VAS agent CB9201'].readVtBlob && !A['G2 VAS agent with no data CB9203'].readVtBlob, 'H2 stored: a VAS agent\'s overview never reads the VT digest blob (decided from the pointer\'s roster index)');
  if (shape === 'huge') ok(!A['G1 VAS agent CB9201'].readVtBlob, 'H2 huge: the over-cap blob is never fetched for a VAS agent');
}
/* G7 — THE ONE INTENTIONAL DIFFERENCE (spec 071 US2-5, the notReported fix; review LOW-4). An agent the VAS digest lists only in
   notCovered with why:'campaign' on a campaign it does not report (here 'Download & Test'): BEFORE Phase E the answer carried
   notReported:null beside an empty, uncovered row — an empty VAS card (vt-notreported-before.json is that pre-Phase-E answer, for
   the same code path: the old condition never looked at the campaign). NOW it carries the "different scheme" notice
   {why:'campaign', campaign}. It is not in the golden on purpose: the golden pins what must NOT change; this pins what did. */
{
  const vd = vasDigest(); vd.notCovered.push({ code: 'CB9204', name: 'Quebec Romeo', tl: 'Leader Vas', why: 'campaign', campaign: 'Download & Test' });
  W.rules = { 'kv:agent-digest': vd }; W.storage = {};
  globalThis.__digestCaches = {}; globalThis.__vtDigestCaches = {}; globalThis.__vtPointerCache = null; globalThis.__cmCtx = null;
  const r = await W.call(userRow({ username: 'cb9204', role: 'agent', cb: 'CB9204', full_name: 'Quebec Romeo' }), 'GET', '/api/portal/overview');
  const pre = JSON.parse(fs.readFileSync(path.join(HERE, 'vt-notreported-before.json'), 'utf8'));
  ok(pre.notReported === null && pre.me && pre.me.covered === false && pre.me.why === 'campaign', 'G7 before (pre-Phase-E, same code path): notReported:null over an uncovered campaign row — the empty card');
  ok(r.status === 200 && r.j && r.j.notReported && r.j.notReported.why === 'campaign' && r.j.notReported.campaign === 'Download & Test' && !r.j.scorecard,
    'G7 now (INTENTIONALLY different): a non-VT other-campaign agent gets the "different scheme" notice, still the VAS answer', JSON.stringify(r.j && r.j.notReported));
}
console.error = err0; console.warn = warn0;
quiet(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
