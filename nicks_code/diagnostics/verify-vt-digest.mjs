#!/usr/bin/env node
/* verify-vt-digest.mjs — THE VEHICLE TRACKING DIGEST: shape, fence, writers, size (Spec Kit 071, Phase E, E0/E1/E2/E4).
 *
 * Fictional floor only (vt-digest-fixture.mjs: CB91xx, invented case numbers). Nothing leaves the machine.
 *   D1  VTEngine.digest: scorecard 'vt', drivers once (no label/note per agent), columnar day rows (dayCols), MTD lead split
 *       only (no weekly/daily splits), the engine's missing-day list, minima + floor, empty DERIVED; the empty-cycle payload
 *   D2  the page's publisher builds the SAME numbers as the pages (VTPublish.buildDigest = digest(VTPages.modelFor(…)))
 *   D3  rules.mjs: liveVtDigestAllowed (current business month + rollover grace, SAST), vtDigestEmptiness, vtDigestFence
 *       (bad key, not the whole month, a future month, a history key holding another month, stale live, empty over data)
 *   D4  POST /api/kv through the REAL Worker: staff writes and the pointer is stamped {period, kind:'vt'}; an agent, a team
 *       leader / campaign manager who also holds VAS, a wimpy-scoped and a referrals-scoped session are refused; the VAS
 *       digest key still refuses a VT payload; GUARDED_KV / fence unchanged for agent-digest
 *   D5  the publisher's own fence and keys (liveOk, keysFor: never a VAS key; empty → no history key), stale()
 *   D6  the tool (tools/digest-republish.mjs): the VT job helpers (current + just-closed month, keys per job)
 *   D7  size: the fixture digest and a full synthetic business month (48 agents, ~3,000 cases) against the ceilings
 *
 *   node nicks_code/diagnostics/verify-vt-digest.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ENG, ROSTER, FX, bookRpc, vtDigest, vasDigest, CYCLE } from './vt-digest-fixture.mjs';
import { workerHarness, userRow } from './vt-worker-harness.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const require = createRequire(import.meta.url);
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m + (d !== undefined ? ' — ' + String(d).slice(0, 300) : '')); } };
const head = (t) => console.log('\n' + t);
const R = await import(pathToFileURL(path.join(ROOT, 'worker', 'src', 'rules.mjs')).href);
const PUB = require(path.join(ROOT, 'nicks_code', 'vt-publish.js'));
const PG = require(path.join(ROOT, 'nicks_code', 'vt-pages.js')).Pages;
const at = (iso) => Date.parse(iso);

head('D1 · the digest shape (VTEngine.digest)');
const D = vtDigest();
const a1 = D.agents.find((a) => a.code === 'CB9101');
ok(D.scorecard === 'vt' && D.period.key === CYCLE && D.period.from === '2026-10-26' && D.period.to === '2026-11-25', 'scorecard vt, the whole business month 26 Oct → 25 Nov', JSON.stringify(D.period));
ok(D.drivers.length === 4 && D.drivers.every((d) => d.label && d.note && d.w > 0), 'the four drivers travel ONCE, with labels, weights and notes');
ok(a1 && a1.rating.parts.every((p) => !('label' in p) && !('note' in p)), 'agent rating parts carry no label or note (drivers once — plan §P)');
ok(a1 && a1.rating.parts.every((p) => ['k', 'value', 'target', 'measured', 'att', 'points', 'weff', 'pointsEff', 'available', 'onTarget', 'why'].every((k) => k in p)), 'each part carries {k, value, target, measured, att, points, weff, pointsEff, available, onTarget, why}');
ok(a1 && typeof a1.rating.onTarget === 'number' && typeof a1.rating.measuredCount === 'number', 'the rating publishes "n of m drivers at target" (onTarget, measuredCount)', JSON.stringify([a1.rating.onTarget, a1.rating.measuredCount]));
ok(Array.isArray(D.dayCols) && D.dayCols[0] === 'd' && Array.isArray(a1.days[0]) && a1.days[0].length === D.dayCols.length, 'day rows are columnar in the order of dayCols', JSON.stringify(a1.days[0]));
ok(!('leadWeeks' in a1) && !('leadDays' in a1) && a1.leads && Object.keys(a1.leads).length > 0, 'the MTD lead split travels; the weekly/daily splits stay in PULSE');
const M = ENG.model(ENG.bookFromRpc(bookRpc('2026-10-26')), ROSTER, { cycleKey: CYCLE, aliases: {}, receipts: FX.receipts });
ok(JSON.stringify(D.gaps) === JSON.stringify(M.gaps) && D.gaps.length === 1 && D.gaps[0].date === '2026-11-05', 'the engine\'s missing-day list is in the digest (Thu 5 Nov)', JSON.stringify(D.gaps));
ok(D.minima && D.minima.cases === ENG.VT_RULES.rating.minCases && D.minima.trackedDays === ENG.VT_RULES.rating.minTrackedDays && D.minima.floor === ENG.VT_RULES.rating.floor, 'minima and the half-of-target floor travel from the rule book', JSON.stringify(D.minima));
const ma1 = M.agents.find((a) => a.code === 'CB9101');
ok(a1.rating.score === ma1.rating.score && a1.mtd.sales === ma1.mtd.sales && Math.abs(a1.mtd.fitRate - ma1.mtd.fitRate) < 1e-6, 'the digest row is the model row (score, sales, fitted rate)');
ok(D.empty === false, 'empty is false with in-play sales (derived)');
const E0 = ENG.digest(ENG.model(ENG.emptyBook(), ROSTER, { cycleKey: 'cycle-2026-12', asOf: '2026-11-27' }), {});
ok(E0.empty === true && E0.agents.every((a) => a.rating.rated === false), 'a month with no in-play sale is empty:true, nobody rated (never a 0 score)');
const X = ENG.emptyCyclePayload('cycle-2026-12', { updatedAt: 'x' });
ok(X.empty === true && X.agents.length === 0 && X.floor.mtd === null && X.gaps === null && X.dayCols.length === D.dayCols.length, 'emptyCyclePayload: empty, no agents, null figures, the same dictionary');

head('D2 · the publisher builds the pages\' numbers');
const P0 = PUB.buildDigest(ENG.bookFromRpc(bookRpc('2026-10-26')), ROSTER, CYCLE, FX.receipts, at('2026-11-10T06:20:00Z'));
const PM = PG.modelFor(ENG.bookFromRpc(bookRpc('2026-10-26')), ROSTER, CYCLE, FX.receipts);
ok(JSON.stringify(P0.agents.map((a) => [a.code, a.rating.score, a.mtd.sales])) === JSON.stringify(PM.agents.map((a) => [a.code, a.rating.score, a.mtd.sales])), 'VTPublish.buildDigest = digest(VTPages.modelFor(…)): the same agents, scores and sales the pages paint');
ok(JSON.stringify(P0) === JSON.stringify(ENG.digest(PM, { updatedAt: '2026-11-10T06:20:00.000Z' })), 'byte for byte the engine\'s digest of the page model');

head('D3 · the fence (rules.mjs)');
const N23 = at('2026-11-23T10:00:00Z'), N26 = at('2026-11-26T08:00:00Z'), N25late = at('2026-11-25T22:30:00Z');
ok(R.liveVtDigestAllowed('cycle-2026-11', '', N23) && R.liveVtDigestAllowed('cycle-2026-11', 'cycle-2026-11', N23), 'live: the current business month always');
ok(R.liveVtDigestAllowed('cycle-2026-10', 'cycle-2026-10', N23) && !R.liveVtDigestAllowed('cycle-2026-10', 'cycle-2026-11', N23), 'live: the month just closed only until the current one publishes (rollover grace)');
ok(!R.liveVtDigestAllowed('cycle-2026-09', '', N23) && !R.liveVtDigestAllowed('cycle-2026-12', '', N23), 'live: never older, never in the future');
ok(R.vtCycleOfDay(new Date(N25late + 2 * 3600000).toISOString().slice(0, 10)) === 'cycle-2026-12' && R.liveVtDigestAllowed('cycle-2026-12', '', N25late), 'the SAST day decides: 22:30 UTC on 25 Nov is 26 Nov in Durban — December\'s business month');
ok(R.liveVtDigestAllowed('cycle-2026-12', '', N26) && R.liveVtDigestAllowed('cycle-2026-11', 'cycle-2026-11', N26), 'the 26th: December is current; November may stay live until December publishes');
ok(R.vtDigestEmptiness({ scorecard: 'vt', agents: [] }).empty === true && R.vtDigestEmptiness(D).empty === false && R.vtDigestEmptiness({ agents: [] }).error === 'not_vt_digest', 'emptiness is derived; a non-VT body is refused');
ok(R.vtDigestEmptiness({ ...D, empty: true }).error === 'bad_empty', 'a payload flagged empty over real figures → bad_empty');
const F = (k, b, live, now = N23) => R.vtDigestFence(k, b, live, now);
ok(F('vt-digest', D, null).pointer && F('vt-digest', D, null).pointer.period === CYCLE && F('vt-digest', D, null).pointer.kind === 'vt', 'live write: allowed, pointer {period, kind:vt}');
ok(F('vt-digest-cycle-2026-11', D, null).pointer, 'history write of its own month: allowed');
ok(/^bad_vt_key/.test(F('vt-digest-foo', D, null).error) && F('vt-digest-foo', D, null).status === 400, 'any other vt-digest name → 400 bad_vt_key');
ok(/^wrong_cycle/.test(F('vt-digest-cycle-2026-10', D, null).error), 'a history key holding another month → 409 wrong_cycle');
ok(/^not_whole_cycle/.test(F('vt-digest', { ...D, period: { ...D.period, from: '2026-11-01' } }, null).error), 'a slice of the month → 409 not_whole_cycle');
ok(/^future_cycle/.test(F('vt-digest-cycle-2026-12', { ...D, period: { key: 'cycle-2026-12', from: '2026-11-26', to: '2026-12-25' } }, null).error), 'a business month that has not started → 409 future_cycle');
const OCT = { ...D, period: { key: 'cycle-2026-10', from: '2026-09-26', to: '2026-10-25' } };
ok(/^stale_cycle/.test(F('vt-digest', OCT, { period: 'cycle-2026-11', empty: false }).error), 'an older month over the current live key → 409 stale_cycle');
ok(F('vt-digest-cycle-2026-10', OCT, null).pointer, '…but it may refresh its own history key');
const EMPTY = { ...D, empty: true, agents: D.agents.map((a) => ({ ...a, mtd: { ...a.mtd, sales: 0 } })), floor: { ...D.floor, mtd: { ...D.floor.mtd, sales: 0 } } };
ok(/^empty_over_data/.test(F('vt-digest', EMPTY, { period: CYCLE, empty: false }).error), 'an empty month over the same month with data → 409 empty_over_data');
ok(F('vt-digest', EMPTY, { period: CYCLE, empty: true }).pointer && F('vt-digest', EMPTY, { period: 'cycle-2026-10', empty: false }).pointer.empty === true, 'empty over empty, or over another month: allowed, stamped empty');
ok(/^empty_over_data/.test(F('vt-digest', EMPTY, { period: '', empty: false }).error) === false, 'an unstamped pointer is another month (period "") — the stale rule, not empty-over-data, applies');
ok(R.isGuardedKvKey('vt-digest') && R.isGuardedKvKey('vt-digest-cycle-2026-11') && R.isGuardedKvKey('vt-digest-anything') && R.isGuardedKvKey('agent-digest') && R.isGuardedKvKey('agent-digest-2026-11'), 'GUARDED_KV: the VT family is staff-only; the VAS keys still are');

head('D4 · POST /api/kv through the real Worker');
const W = await workerHarness();
Date.now = () => N23;
const quiet = console.log; console.log = (...a) => { if (a.length === 1 && a[0] && typeof a[0] === 'object') return; quiet(...a); };
const err0 = console.error, warn0 = console.warn; console.error = () => {}; console.warn = () => {};
/* a VT key is written the way the publisher writes it since the security review (M1): the key's version read first (?meta=1),
   then the POST with X-Cbx-Base. VAS keys are posted exactly as before (no base). o.base: force a base (null = send none). */
const post = async (u, key, body, o = {}) => {
  let base = o.base;
  if (base === undefined && /^vt-digest/.test(key)) { const m = await W.call(u, 'GET', '/api/kv?key=' + key + '&meta=1'); base = m.status === 200 && m.j ? m.j.updated_at : 'none'; }
  return W.call(u, 'POST', '/api/kv?key=' + key, typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body), base == null ? o.headers : { 'X-Cbx-Base': base, ...(o.headers || {}) });
};
const STAFF = userRow({ username: 'uploader', role: 'exec', apps: ['vas'], tabs: { vas: ['data'] } });
W.rules = {}; W.storage = {};
let r = await post(STAFF, 'vt-digest', D);
const pw = W.writes.map((w) => String(w.body || '')).filter((b) => /kv:vt-digest/.test(b)).join(' ');
ok(r.status === 200, 'staff: kv:vt-digest written (200)', r.t);
ok(/"period":"cycle-2026-11"/.test(pw) && /"kind":"vt"/.test(pw), 'its pointer is stamped with the business month (period, kind:vt)', pw.slice(0, 200));
r = await post(STAFF, 'vt-digest-cycle-2026-11', D); ok(r.status === 200, 'staff: kv:vt-digest-cycle-2026-11 written', r.t);
W.rules['kv:vt-digest'] = { __raw: { store: 'raw/kv/vt-digest', period: CYCLE } };
r = await post(STAFF, 'vt-digest', OCT); ok(r.status === 409 && /stale_cycle/.test(r.t), 'staff: an older month over the live current one → 409 stale_cycle', r.t);
r = await post(STAFF, 'vt-digest', EMPTY); ok(r.status === 409 && /empty_over_data/.test(r.t), 'staff: an empty month over the live month with data → 409 empty_over_data', r.t);
r = await post(STAFF, 'vt-digest-cycle-2026-10', D); ok(r.status === 409 && /wrong_cycle/.test(r.t), 'staff: November under October\'s history key → 409', r.t);
r = await post(STAFF, 'vt-digest', '{not json'); ok(r.status === 400, 'a body that is not JSON → 400', r.t);
r = await post(STAFF, 'vt-digest-x', D); ok(r.status === 400 && /bad_vt_key/.test(r.t), 'an unknown vt-digest name → 400', r.t);
for (const [who, u] of [['an agent', userRow({ username: 'cb9101', role: 'agent', cb: 'CB9101' })],
  ['a team leader who also holds VAS', userRow({ username: 'tl', role: 'team_leader', cb: 'CB9190', team: 'Leader One', apps: ['agent', 'vas'], tabs: { vas: ['data'] } })],
  ['a campaign manager who also holds VAS', userRow({ username: 'dalwin', role: 'campaign_manager', apps: ['agent', 'vas'], tabs: { vas: '*' } })],
  ['a wimpy-scoped session on a staff account', userRow({ username: 'boss', role: 'admin', scope: 'wimpy' })],
  ['a referrals-scoped session', userRow({ username: 'boss', role: 'admin', scope: 'referrals' })]]) {
  const before = Object.keys(W.storage).length;
  r = await post(u, 'vt-digest', D);
  ok(r.status === 403 && Object.keys(W.storage).length === before, who + ': refused (403), nothing stored', r.status + ' ' + r.t.slice(0, 80));
}
W.rules = {};
r = await post(STAFF, 'agent-digest', D); ok(r.status === 400 && /vt_payload/.test(r.t), 'a VT payload is refused on the VAS live key (400 vt_payload — it would otherwise read as an empty VAS month)', r.status + ' ' + r.t.slice(0, 120));
r = await post(STAFF, 'agent-digest-2026-11', D); ok(r.status === 400 && /vt_payload/.test(r.t), 'and on a VAS history key (agent-digest-YYYY-MM) too', r.status + ' ' + r.t.slice(0, 120));
r = await post(STAFF, 'agent-reports-variance', D); ok(r.status === 400 && /vt_payload/.test(r.t), 'and on a VAS report key', r.status + ' ' + r.t.slice(0, 120));
r = await post(STAFF, 'agent-digest', vasDigest()); ok(r.status === 200, 'the VAS live digest still takes a VAS payload (its own fence, unchanged)', r.t.slice(0, 120));
console.log = quiet; console.error = err0; console.warn = warn0;

head('D5 · the publisher\'s own rule and keys (vt-publish.js)');
ok(PUB.liveOk('cycle-2026-11', N23) && PUB.liveOk('cycle-2026-10', N23) && !PUB.liveOk('cycle-2026-09', N23) && !PUB.liveOk('cycle-2026-12', N23), 'liveOk mirrors the Worker: current or just closed');
ok(JSON.stringify(PUB.keysFor(D, N23)) === '["vt-digest","vt-digest-cycle-2026-11"]', 'keys: the live key + its own history key — never a VAS key', JSON.stringify(PUB.keysFor(D, N23)));
ok(JSON.stringify(PUB.keysFor({ ...D, empty: true }, N23)) === '["vt-digest"]', 'an empty month: the live key only (no history copy of nothing)');
ok(JSON.stringify(PUB.keysFor(OCT, N26)) === '["vt-digest-cycle-2026-10"]', 'a month two back: its history key only');
ok(PUB.stale([{ state: 'committed', committed_at: '2026-11-10T06:15:00Z' }], '2026-11-10T06:00:00Z') && !PUB.stale([{ state: 'committed', committed_at: '2026-11-10T06:15:00Z' }], '2026-11-10T06:20:00Z') && PUB.stale([{ state: 'committed', committed_at: '2026-11-10T06:15:00Z' }], null), 'stale: an upload committed after the live digest (or nothing live yet)');
const SRC = fs.readFileSync(path.join(ROOT, 'nicks_code', 'vt-publish.js'), 'utf8');
ok(!/agent-digest/.test(SRC.replace(/\/\*[\s\S]*?\*\//g, '')), 'vt-publish.js never names a VAS digest key in code');
ok(/__vtDigestDirtySince/.test(SRC) && /beforeunload/.test(SRC) && /RETRY_MS = \[30000, 120000, 300000\]/.test(SRC) && /vtDigestBanner/.test(SRC), 'save-ack machinery: dirty flag, persistent banner, 30 s → 2 m → 5 m retries, beforeunload');

head('D6 · the republish tool\'s VT job');
const TOOL = fs.readFileSync(path.join(ROOT, 'tools', 'digest-republish.mjs'), 'utf8');
const blk = TOOL.slice(TOOL.indexOf('/*VT-JOBS-BEGIN*/'), TOOL.indexOf('/*VT-JOBS-END*/'));
ok(blk.length > 100, 'the VT job block is marked in the tool');
const C = await import(pathToFileURL(path.join(ROOT, 'worker', 'src', 'cycle.mjs')).href);
const fn = new Function(blk + '\nreturn { vtJobsFor, vtKeysFor };')();
const J = fn.vtJobsFor(N26, C.cycleKeyOf, C.cycleRange);
ok(J.length === 2 && J[0].key === 'cycle-2026-12' && J[0].live && J[1].key === 'cycle-2026-11' && !J[1].live, 'on the 26th: December live (empty until its first upload), November its (final)', JSON.stringify(J.map((x) => x.key)));
ok(JSON.stringify(fn.vtKeysFor({ job: J[0], empty: true })) === '["vt-digest"]' && JSON.stringify(fn.vtKeysFor({ job: J[1], empty: false })) === '["vt-digest-cycle-2026-11"]' && JSON.stringify(fn.vtKeysFor({ job: J[1], empty: true })) === '[]', 'keys per job: the empty current month takes the live key only; the closed month its history key, never empty');
/* (security review LOW-3: the call now passes the key's pointer view and the republish-path flag — the same fence, asked per key) */
ok(/const body = JSON\.parse\(vb\.body\)/.test(TOOL) && /vtDigestFence\(key, body, own\.view, Date\.now\(\), \{ liveKey, tool: true \}\)/.test(TOOL) && /--no-vt/.test(TOOL), 'the tool asks the Worker\'s own fence per key (with that key\'s pointer, as the republish path), and can be told --no-vt');
ok(/window\.VTPublish\.buildDigest/.test(TOOL), 'the tool builds through the page\'s VTPublish.buildDigest (one set of numbers)');

head('D7 · size');
const s1 = JSON.stringify(D);
ok(s1.length < 200 * 1024, 'fixture digest ' + Math.round(s1.length / 1024) + ' KB raw / ' + Math.round(zlib.gzipSync(s1).length / 1024) + ' KB gzip');
const subs = ['digital', 'predictive', 'referral', 'scheduling'], ros = [];
for (let i = 0; i < 48; i++) ros.push({ code: 'CB9' + (300 + i), name: 'Fict Person' + i, sf: null, tl: 'Lead ' + (i % 4), tlCode: 'CB99' + (i % 4), sub: subs[i % 4], tenure: ['Exp', 'M2', 'M1'][i % 3], role: null, target: 2, startDate: '2026-01-01' });
const big = ENG.emptyBook(); big.openedOn = '2026-10-01'; big.rev = 5; let n = 0;
const LS = ['revx', 'jag', 'tracking_empire', 'afrilead', 'predictive', 'referral'];
for (let d0 = '2026-10-26'; d0 <= '2026-11-25'; d0 = ENG.periods.addDays(d0, 1)) {
  if (!ENG.periods.isWorkingDay(d0)) continue;
  for (let k = 0; k < 140; k++) { const cn = String(80000000 + n++), a = ros[n % 48], st = n % 10 < 7 ? 'fitted' : n % 10 < 9 ? 'missed' : 'scheduled';
    big.cases[cn] = { caseNumber: cn, status: st, statusOn: d0, soldOn: d0, soldBasis: 'first_seen', firstSeen: d0, lastSeen: '2026-11-25', apptOn: ENG.periods.addDays(d0, 2), fittedOn: st === 'fitted' ? ENG.periods.addDays(d0, 2) : null,
      products: ['MXV'], chargeEx: 150, leadSource: LS[n % 6], partnerRaw: 'RevX', sellerName: a.name.toLowerCase(), sellerCb: a.code, sellerMatch: 'exact', smAttempt: null, bundle: null }; } }
const BD = JSON.stringify(ENG.digest(ENG.model(big, ros, { cycleKey: CYCLE, asOf: '2026-11-25' }), { updatedAt: 'x' }));
ok(BD.length < 400 * 1024, 'a full business month (48 agents, ' + n.toLocaleString('en-ZA') + ' cases): ' + Math.round(BD.length / 1024) + ' KB raw / ' + Math.round(zlib.gzipSync(BD).length / 1024) + ' KB gzip — far under the 32 MiB the Worker unpacks (KV_INFLATE_MAX)');
/* ROWS, NOT CASES: what keeps the digest's size (and so its parse) bounded is that it grows by AGENT, never by case —
   one agents row per agent on the list, and not one case number of the ~3,000-case book inside it. */
{ const PD = JSON.parse(BD), cnIn = Object.keys(big.cases).filter((cn) => BD.includes(cn)).length;
  ok(PD.agents.length === ros.length && cnIn === 0, 'it grows by agent, not by case: ' + PD.agents.length + ' agent rows for ' + ros.length + ' agents, ' + cnIn + ' of ' + n.toLocaleString('en-ZA') + ' case numbers in it', PD.agents.length + ' / ' + cnIn); }
/* PARSE COST IS RELATIVE, NOT A WALL-CLOCK NUMBER. An absolute "< 5 ms" read ~3 ms normally and 6.17 ms on a busy
   laptop, so the daily tick went red from load alone. The budget it stands for — "about one ordinary 200 KB JSON
   parse, once a minute per isolate" — is judged against a REFERENCE parsed in this run: a FIXED ~210 KB array of flat
   objects (it does not grow with the digest, so a fatter digest still reads as dearer). Load slows both alike; the two
   are interleaved, best of 15 batches each. The digest measures ~0.9–1.2× the reference here; the bound is 2.5×, which
   a digest that grew by case, or into a deeply nested / many-tiny-values shape, would blow straight through. The byte
   budget above stays absolute and strict. */
const REF_JSON = JSON.stringify(Array.from({ length: 2600 }, (_, i) => ({ c: 'CB' + i, n: 'Fict ' + i, a: i, b: i / 7, d: [i, i + 1], s: 'x' })));
const bestParse = (str) => { const t = process.hrtime.bigint(); for (let j = 0; j < 5; j++) JSON.parse(str); return Number(process.hrtime.bigint() - t) / 1e6 / 5; };
let parseMs = Infinity, refParseMs = Infinity; bestParse(BD); bestParse(REF_JSON);
for (let r = 0; r < 15; r++) { parseMs = Math.min(parseMs, bestParse(BD)); refParseMs = Math.min(refParseMs, bestParse(REF_JSON)); }
ok(parseMs < 2.5 * refParseMs, 'its parse costs ' + parseMs.toFixed(2) + ' ms here, ' + (parseMs / refParseMs).toFixed(2) + '× a plain ' + Math.round(REF_JSON.length / 1024) + ' KB JSON parse (bound 2.5×) — paid once a minute per isolate (the 60 s cache), not per request', parseMs.toFixed(2) + ' / ' + refParseMs.toFixed(2));

/* ======================= D8 · the Phase E security review fixes (2026-11-23) ======================= */
head('D8 · security review: who writes, how big, in what order, who reads');
Date.now = () => N23;
console.log = (...a) => { if (a.length === 1 && a[0] && typeof a[0] === 'object') return; quiet(...a); };
console.error = () => {}; console.warn = () => {};
W.applyWrites = true; W.rules = {}; W.storage = {}; W.at = {};
globalThis.__vtDigestCaches = {}; globalThis.__vtPointerCache = null; globalThis.__vtCycles = null;
const ADMIN = userRow({ username: 'boss', role: 'admin', apps: ['vas'], tabs: { vas: '*' } });
const OPSUP = userRow({ username: 'opsup', role: 'tl', apps: ['ops'], tabs: { ops: ['uploads'] } });
const NOGRANT = [['a viewer with VAS pages but no Upload Station', userRow({ username: 'view', role: 'viewer', apps: ['vas'], tabs: { vas: ['mtd', 'vt_mtd'] } })],
  ['a QA account without the Upload Station', userRow({ username: 'qa1', role: 'qa', apps: ['vas'], tabs: { vas: ['qa'] } })],
  ['an Ops tl (management role) without the uploads tab', userRow({ username: 'opstl', role: 'tl', apps: ['ops'], tabs: { ops: ['session'] } })]];
// H1
for (const [who, u] of NOGRANT) {
  r = await post(u, 'vt-digest', D, { base: 'none' });
  ok(r.status === 403 && !W.rules['kv:vt-digest'], 'H1 ' + who + ': POST kv:vt-digest refused (403)', r.status + ' ' + r.t.slice(0, 80));
  r = await W.call(u, 'DELETE', '/api/kv?key=vt-digest');
  ok(r.status === 403, 'H1 ' + who + ': DELETE kv:vt-digest refused (403)', r.status);
  ok(R.kvWriteAllowed('vt-digest-cycle-2026-11', u) === false && R.kvWriteAllowed('agent-digest', u) === true && R.kvWriteAllowed('cb-config', u) === true,
    'H1 ' + who + ': every vt-digest* key refused, the VAS keys keep their rule byte for byte');
}
for (const [who, u] of [['admin', ADMIN], ['staff with the VAS Upload Station', STAFF], ['staff with the Ops uploads tab', OPSUP]]) {
  W.rules = {}; W.at = {};
  r = await post(u, 'vt-digest', D);
  ok(r.status === 200, 'H1 ' + who + ': POST kv:vt-digest allowed', r.status + ' ' + r.t.slice(0, 120));
}
for (const role of ['agent', 'team_leader', 'campaign_manager'])
  ok(R.kvWriteAllowed('vt-digest', { role, apps: ['vas', 'ops'], tabs: { vas: '*', ops: ['uploads'] } }) === false, 'H1 a ' + role + ' holding the Upload Station is still refused');
// H2 (a) — emptiness needs an agent row
ok(R.vtDigestEmptiness({ scorecard: 'vt', agents: [], floor: { mtd: { sales: 9 } } }).error === 'empty_digest', 'H2a no agent rows but floor sales → 400 empty_digest (it could only be a forged "non-empty" payload)');
ok(R.vtDigestEmptiness(X).empty === true && R.vtDigestEmptiness(X).agents === 0, 'H2a the engine\'s emptyCyclePayload is empty with 0 agents');
const XN = ENG.emptyCyclePayload(CYCLE, { updatedAt: '2026-11-23T09:00:00Z' });
ok(/^empty_over_data/.test(F('vt-digest', XN, { period: CYCLE, empty: false, agents: 7 }).error || ''), 'H2a an empty-cycle payload over the same month with figures → 409');
ok(/^empty_over_data/.test(F('vt-digest', XN, { period: CYCLE, empty: true, agents: 7 }).error || ''), 'H2a …and over the same month that LISTS agents but has no sale yet → 409 (the cards would vanish)');
ok(/^empty_over_data/.test(F('vt-digest', XN, { period: CYCLE, empty: true }).error || ''), 'H2a …and over a same-month pointer with no agent count (the safe side)');
ok(!!F('vt-digest', XN, { period: CYCLE, empty: true, agents: 0 }).pointer && !!F('vt-digest', XN, { period: 'cycle-2026-10', empty: false, agents: 7 }).pointer, 'H2a allowed over another empty-cycle payload, or over the month just closed (rollover)');
ok(/^empty_history/.test(F('vt-digest-cycle-2026-11', XN, null).error || ''), 'H2a a history key never takes a payload with no agent rows');
// H2 (b) — the size cap at POST
W.rules = {}; W.at = {};
const BIGD = JSON.stringify({ ...D, pad: 'x'.repeat(R.VT_DIGEST_MAX + 1024) });
r = await post(STAFF, 'vt-digest', BIGD);
ok(r.status === 413 && /Vehicle Tracking digest/.test(r.t) && /2 MB/.test(r.t) && !W.rules['kv:vt-digest'], 'H2b a plain body over 2 MB → 413 in words, nothing stored', r.status + ' ' + r.t.slice(0, 160));
const GZ = new Uint8Array(zlib.gzipSync(BIGD));
r = await post(STAFF, 'vt-digest', GZ);
ok(r.status === 413 && /Vehicle Tracking digest/.test(r.t) && !W.rules['kv:vt-digest'], 'H2b a gzip body that unpacks past 2 MB → 413 (decided from the gzip trailer, nothing unpacked)', r.status + ' ' + r.t.slice(0, 160));
const LIE = new Uint8Array(GZ); LIE.set([0, 0, 1, 0], LIE.length - 4);   // the trailer claims 64 KB
r = await post(STAFF, 'vt-digest', LIE);
ok(r.status === 413 && !W.rules['kv:vt-digest'], 'H2b a gzip whose trailer lies (claims 64 KB) → 413 when the counted unpack passes 2 MB', r.status + ' ' + r.t.slice(0, 160));
// H2 (c) — the pointer carries the stored size; M1 ordering stamps
r = await post(STAFF, 'vt-digest', D);
const ptr = (W.rules['kv:vt-digest'] || {}).__raw || {};
ok(r.status === 200 && ptr.size === JSON.stringify(D).length && ptr.agents === D.agents.length && ptr.asOf === D.period.asOf && ptr.updatedAt === D.updatedAt,
  'H2c/M1 the live pointer is stamped {size, agents, asOf, updatedAt}', JSON.stringify({ ...ptr, codes: undefined }));
ok(Array.isArray(ptr.codes) && ptr.codes.length === D.agents.length && ptr.codes.includes('CB9101') && !ptr.codes.includes('CB9201'), 'H2 the live pointer carries the VT roster index (codes) a VAS agent\'s overview decides on');
// M1 — compare-and-set and ordering through the Worker
r = await post(STAFF, 'vt-digest', D, { base: null });
ok(r.status === 428 && /X-Cbx-Base/.test(r.t), 'M1 a VT digest POST without X-Cbx-Base → 428 (compare-and-set is required)', r.status + ' ' + r.t.slice(0, 120));
r = await post(STAFF, 'vt-digest', D, { base: '2026-11-10T06:30:00.000Z' });
ok(r.status === 409 && /version_conflict/.test(r.t), 'M1 a stale base → 409 version_conflict', r.status + ' ' + r.t.slice(0, 120));
const OLDER = { ...D, period: { ...D.period, asOf: '2026-11-06' }, updatedAt: '2026-11-23T11:00:00Z' };
r = await post(STAFF, 'vt-digest', OLDER);
ok(r.status === 409 && /newer_published/.test(r.t) && /Re-read the page/.test(r.t), 'M1 a stale tab\'s rebuild (older as-at day, fresh timestamp) over newer figures → 409 newer_published', r.status + ' ' + r.t.slice(0, 160));
const RETRY = { ...D, updatedAt: '2026-11-10T06:00:00Z' };
r = await post(STAFF, 'vt-digest', RETRY);
ok(r.status === 409 && /newer_published/.test(r.t), 'M1 a retry of an older build (same day, earlier updatedAt) → 409 newer_published');
r = await post(STAFF, 'vt-digest', D); ok(r.status === 200, 'M1 the same digest again (same as-at, same updatedAt) → 200 (idempotent)', r.t.slice(0, 120));
const NEWER = { ...D, updatedAt: '2026-11-23T11:30:00Z' };
r = await post(STAFF, 'vt-digest', NEWER); ok(r.status === 200, 'M1 a newer build of the same month → 200', r.t.slice(0, 120));
// M1 — the closed month's history key
const N27 = at('2026-11-27T08:00:00Z');
const NOVD = { ...D };
ok(!!F('vt-digest-cycle-2026-11', NOVD, null, N26).pointer, 'M1 on the 26th, November\'s history key takes November while the live key is still November');
ok(/^closed_cycle/.test(R.vtDigestFence('vt-digest-cycle-2026-11', NOVD, null, N27, { liveKey: 'cycle-2026-12' }).error || ''), 'M1 once December is live, November\'s history key is closed to /api/kv → 409 closed_cycle');
ok(!!R.vtDigestFence('vt-digest-cycle-2026-11', NOVD, null, N27, { liveKey: 'cycle-2026-11' }).pointer, 'M1 …but open while the live key still holds November (the rollover grace)');
ok(/^closed_cycle/.test(R.vtDigestFence('vt-digest-cycle-2026-10', OCT, null, N26, { liveKey: '' }).error || ''), 'M1 a month two back is closed to /api/kv, whatever is live');
ok(!!R.vtDigestFence('vt-digest-cycle-2026-11', NOVD, null, N27, { liveKey: 'cycle-2026-12', tool: true }).pointer, 'M1 the republish tool may refresh a closed month\'s (final)');
ok(/^newer_published/.test(R.vtDigestFence('vt-digest-cycle-2026-11', OLDER, { period: CYCLE, empty: false, agents: 7, asOf: D.period.asOf, updatedAt: D.updatedAt }, N27, { tool: true }).error || ''), 'M1 …still in order: never older figures over newer');
Date.now = () => N27;
W.rules = { 'kv:vt-digest': { __raw: { store: 'raw/kv/vt-digest', period: 'cycle-2026-12', kind: 'vt', agents: 7, asOf: '2026-11-26', updatedAt: '2026-11-27T06:00:00Z' } } }; W.at = {};
r = await post(STAFF, 'vt-digest-cycle-2026-11', D);
ok(r.status === 409 && /closed_cycle/.test(r.t), 'M1 through the Worker: November\'s history key after December is live → 409 closed_cycle', r.status + ' ' + r.t.slice(0, 120));
Date.now = () => N23;
// M2 — the VT payload guard on the VAS keys reads the parsed body
W.rules = {}; W.at = {};
const REORD = '{"agents":' + JSON.stringify(D.agents) + ',"period":' + JSON.stringify(D.period) + ',"scorecard":"vt"}';
const SPACED = '{\n  "period" : ' + JSON.stringify(D.period) + ' ,\n  "scorecard"  :\t"vt", "agents": ' + JSON.stringify(D.agents) + ' }';
for (const [what, b] of [['scorecard last', REORD], ['whitespace and another key first', SPACED]])
  for (const k of ['agent-digest', 'agent-digest-2026-11', 'agent-reports-variance']) {
    r = await post(STAFF, k, b);
    ok(r.status === 400 && /vt_payload/.test(r.t), 'M2 a VT payload (' + what + ') on kv:' + k + ' → 400 vt_payload', r.status + ' ' + r.t.slice(0, 100));
  }
// M3 — generic GET /api/kv of a VT key is staff-only
W.rules = { 'kv:vt-digest': D, 'kv:agent-digest': vasDigest() }; W.at = {};
for (const [who, u, want] of [
  ['an agent', userRow({ username: 'cb9101', role: 'agent', cb: 'CB9101' }), 403],
  ['a team leader who also holds VAS', userRow({ username: 'tl', role: 'team_leader', cb: 'CB9190', team: 'Leader One', apps: ['agent', 'vas'], tabs: { vas: ['mtd'] } }), 403],
  ['a campaign manager who also holds VAS', userRow({ username: 'dalwin', role: 'campaign_manager', apps: ['agent', 'vas'], tabs: { vas: '*' } }), 403],
  ['an Ops tl with no VAS app and no Upload Station', NOGRANT[2][1], 403],
  ['a viewer with VAS pages', NOGRANT[0][1], 200], ['staff with the Ops uploads tab (the publisher)', OPSUP, 200], ['exec', userRow({ username: 'ex', role: 'exec', apps: [] }), 200], ['admin', ADMIN, 200]]) {
  r = await W.call(u, 'GET', '/api/kv?key=vt-digest');
  const r2 = await W.call(u, 'GET', '/api/kv?key=vt-digest&meta=1');
  ok(r.status === want && r2.status === want && (want !== 200 || /Nobody On The List|nobody on the list/i.test(r.t)), 'M3 ' + who + ': GET kv:vt-digest (and ?meta=1) → ' + want, r.status + '/' + r2.status);
}
ok(R.vtDigestReadAllowed({ role: 'team_leader', apps: ['vas'], tabs: { vas: '*' } }) === false && R.vtDigestReadAllowed({ role: 'viewer', apps: ['vas'], tabs: { vas: ['vt_mtd'] }, scope: 'wimpy' }) === false, 'M3 the rule: never a portal role, never a scoped session');
r = await W.call(userRow({ username: 'tl', role: 'team_leader', cb: 'CB9190', team: 'Leader One', apps: ['agent', 'vas'], tabs: { vas: ['mtd'] } }), 'GET', '/api/kv?key=agent-digest');
ok(r.status === 200, 'M3 reads of other keys are unchanged (the same team leader still reads kv:agent-digest: ' + r.status + ')');
// LOW-3 — the republish tool's VT write is ordered and compare-and-set
const TOOL2 = fs.readFileSync(path.join(ROOT, 'tools', 'digest-republish.mjs'), 'utf8');
const vtw = TOOL2.slice(TOOL2.indexOf('const vtRowOf'), TOOL2.indexOf('if (!APPLY) {'));
ok(/vtPointerView\(/.test(TOOL2) && /\{ liveKey, tool: true \}/.test(vtw), 'LOW-3 the tool reads each pointer through the shared vtPointerView and asks the fence as the republish path ({tool:true})');
ok(/updated_at=eq\./.test(vtw) && /writing/.test(vtw) && /version_conflict|moved while this ran/.test(vtw), 'LOW-3 the tool claims the pointer by compare-and-set on its updated_at before it writes the blob, and re-checks on a lost race');
ok(!/merge-duplicates/.test(vtw.slice(vtw.indexOf('claim'))) || /resolution=ignore-duplicates|return=representation/.test(vtw), 'LOW-3 a pointer that appeared meanwhile is never overwritten blind');
console.log = quiet; console.error = err0; console.warn = warn0;

/* the publisher (vt-publish.js) in Node with a stubbed fetch: base read first, conflict re-checked, "newer" said in words */
head('D9 · the publisher sends X-Cbx-Base, re-checks on conflict, stops on newer figures');
{
  const calls = []; let meta = '2026-11-10T06:30:00.000Z', plan = [];
  const el = { style: {}, setAttribute() {}, remove() { FAKE.document._el = null; }, innerHTML: '' };
  const FAKE = { sessionStorage: { getItem: () => 'tok' }, __vtApiBase: 'https://api.test',
    document: { _el: null, getElementById() { return this._el; }, createElement() { this._el = el; return el; }, body: { appendChild() {} } },
    __vtFetch: async (u, o = {}) => { calls.push({ u, method: o.method || 'GET', base: o.headers && o.headers['X-Cbx-Base'] });
      if (/meta=1/.test(u)) return new Response(JSON.stringify({ found: true, updated_at: meta }), { status: 200 });
      const [st, err] = plan.shift() || [200, null]; if (st === 200) meta = '2026-11-23T10:00:0' + calls.length + '.000Z';
      return new Response(JSON.stringify(st === 200 ? { ok: true } : { error: err }), { status: st }); } };
  const savedSelf = globalThis.self; globalThis.self = FAKE;
  const p = path.join(ROOT, 'nicks_code', 'vt-publish.js'); delete require.cache[require.resolve(p)];
  const PUB2 = require(p); globalThis.self = savedSelf;
  PUB2._reset();
  let res = await PUB2.send(D, N23);
  const posts = calls.filter((c) => c.method === 'POST');
  ok(res.ok && posts.length === 2 && posts.every((c) => c.base === '2026-11-10T06:30:00.000Z' || /^2026-11-23/.test(c.base)), 'M1 each key is posted with X-Cbx-Base = the version just read (?meta=1)', JSON.stringify(calls.map((c) => c.method + ' ' + c.u.replace('https://api.test', '') + ' ' + (c.base || ''))));
  calls.length = 0; PUB2._reset(); plan = [[409, 'version_conflict'], [200, null], [200, null]];
  res = await PUB2.send(D, N23);
  const metas = calls.filter((c) => /meta=1/.test(c.u) && /key=vt-digest&/.test(c.u)).length;
  ok(res.ok && metas >= 2, 'M1 a version_conflict re-reads the version (and the fence re-checks) before sending again — never a blind resend', JSON.stringify(calls.map((c) => c.method + ' ' + c.u.replace('https://api.test', ''))));
  calls.length = 0; PUB2._reset(); plan = [[409, 'newer_published: newer Vehicle Tracking figures are already published for cycle-2026-11 … Re-read the page.'], [200, null]];
  let reread = 0; FAKE.dispatchEvent = (e) => { if (e && e.type === 'vt-digest-newer') reread++; };
  res = await PUB2.send(OLDER, N23);
  const st = PUB2.state();
  ok(res.newer === true && !st.pending && st.tries === 0 && !st.dirtySince, 'M1 newer figures already published: not a failed save — not dirty, no retry scheduled', JSON.stringify(st));
  ok(/newer/i.test(el.innerHTML) && /reload|re-read/i.test(el.innerHTML), 'M1 …said in words on the page ("newer figures … re-read")', el.innerHTML.slice(0, 200));
  ok(reread === 1, 'M1 …and the page is asked to re-read (event vt-digest-newer)', reread);
  calls.length = 0; PUB2._reset(); plan = [[403, 'Not permitted.'], [403, 'Not permitted.']];
  res = await PUB2.onPageReady(Object.assign(ENG.bookFromRpc(bookRpc('2026-10-26')), { rev: 99 }), ROSTER, CYCLE, [{ state: 'committed', committed_at: '2026-11-23T09:00:00Z' }]).catch((e) => ({ err: String(e) }));
  ok(!PUB2.state().dirtySince && !PUB2.state().pending, 'H1 a VT page opened by an account without the Upload Station never turns red: its 403 is not a failed save', JSON.stringify(PUB2.state()));
  PUB2._reset();
}

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
