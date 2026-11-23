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
async function answers(withVt) {
  W.rules = { 'kv:agent-digest': vasDigest() };
  if (withVt) { const d = vtDigest(); W.rules['kv:vt-digest'] = d; W.rules['kv:vt-digest-cycle-2026-11'] = d; }
  const out = {};
  for (const [name, u, p] of CASES) { globalThis.__digestCaches = {}; globalThis.__vtDigestCaches = {}; globalThis.__cmCtx = null;
    const r = await W.call(u, 'GET', p); out[name] = { status: r.status, body: r.t }; }
  return out;
}
const before = await answers(false);
if (CAPTURE) {
  fs.writeFileSync(GOLDEN, JSON.stringify(before, null, 1));
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
console.error = err0; console.warn = warn0;
quiet(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
