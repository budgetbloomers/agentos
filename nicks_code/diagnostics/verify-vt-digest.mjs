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
const post = (u, key, body) => W.call(u, 'POST', '/api/kv?key=' + key, typeof body === 'string' ? body : JSON.stringify(body));
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
ok(/vtDigestFence\(key, JSON\.parse\(vb\.body\), await vtPointerOf\(key\), Date\.now\(\)\)/.test(TOOL) && /--no-vt/.test(TOOL), 'the tool asks the Worker\'s own fence per key, and can be told --no-vt');
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
const t0 = process.hrtime.bigint(); for (let i = 0; i < 20; i++) JSON.parse(BD); const parseMs = Number(process.hrtime.bigint() - t0) / 1e6 / 20;
ok(BD.length < 400 * 1024, 'a full business month (48 agents, ' + n.toLocaleString('en-ZA') + ' cases): ' + Math.round(BD.length / 1024) + ' KB raw / ' + Math.round(zlib.gzipSync(BD).length / 1024) + ' KB gzip — far under the 32 MiB the Worker unpacks (KV_INFLATE_MAX)');
ok(parseMs < 5, 'its parse costs ' + parseMs.toFixed(2) + ' ms here — paid once a minute per isolate (the 60 s cache), not per request', parseMs);

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
