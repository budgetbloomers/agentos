#!/usr/bin/env node
/* verify-vt-portal.mjs — VEHICLE TRACKING IN AGENT ANALYTICS, end to end (Spec Kit 071, Phase E, E0/E5–E9; US2–US4).
 *
 * WORKER HALF — the REAL Worker in-process (vt-worker-harness.mjs) over a fictional VAS digest and a fictional VT digest
 * (vt-digest-fixture.mjs, CB91xx / CB92xx, invented names):
 *   S1  which card: a CB on the published VT digest → scorecard:'vt' (its own row, no VAS checks / drill / commission);
 *       a VAS agent → the VAS answer; with NO VT digest a VT agent gets the "different scheme" notice (the notReported fix:
 *       before = vt-notreported-before.json, captured from the pre-Phase-E Worker)
 *   S2  scopes from the SESSION: an agent reads only their own row (a ?cb= is ignored); a team leader only their team (by
 *       the list's leader CB or name); a manager only with VT in scope (vtInScope); staff everything; a viewer, a wimpy-
 *       and a referrals-scoped session are refused
 *   S3  floor.unmatched.names (Salesforce spellings) travel to staff only
 *   S4  /api/portal/vt/agent?cb=: a leader opens their own agent, never another team's (403, nothing said); an agent never
 *   S5  /api/portal/tl/reports?kind=vt-mtd|vt-weekly|vt-daily, ?cycle= history, bad input → 400
 *   S6  cost: one subrequest per key per isolate-minute; the warm answer is sliced, never recomputed (CPU measured)
 * PAGE HALF — the BUILT Agent Analytics page (site/agent/index.html, rebuilt first) in Chromium, every /api/** call
 * answered by the same in-process Worker (the HighLevel help list is the one canned answer):
 *   B1  the VT agent card: score, band, "n of m drivers", every driver row (value of target, two-shade bar, points / max,
 *       pill), the lower-is-better row, the tip boxes, the composite line, the three buttons, "Your help requests"
 *   B2  honest states: not rated yet (no score), scheduler (message + team scheduling speed), driver not measured
 *       (renormalised, said in words), the missing day's upload, the month that began before the first upload (opening
 *       book), the empty month with "<Month> (final)" and back
 *   B3  the VT agent's nav: Today + My month; no Projected Commission, no Links; My month = weeks and days
 *   B4  the VT team leader: Team Results rows paint VT figures (not "Not reported"), the VT card opens, the three VT
 *       report tabs equal the digest, export = the screen (file name TL VT <report> - <team> - <period>.xlsx)
 *   B5  the campaign manager: the Vehicle Tracking tab (floor, sub-campaigns, lead sources, agents), no unmatched names
 *   B6  a VAS agent's page is the same with and without a VT digest
 *   B7  no page errors; screenshots (fictional data) in diagnostics/scratch/vt/
 *
 *   node nicks_code/diagnostics/verify-vt-portal.mjs [--no-build] [--worker-only]
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { workerHarness, userRow } from './vt-worker-harness.mjs';
import { vtDigest, vasDigest, ENG, ROSTER, CYCLE } from './vt-digest-fixture.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const SHOTS = path.join(HERE, 'scratch', 'vt'); fs.mkdirSync(SHOTS, { recursive: true });
let pass = 0, fail = 0;
const out0 = console.log, err0 = console.error, warn0 = console.warn;
const say = (...a) => out0(...a);
const ok = (c, m, d) => { if (c) { pass++; say('  ok   ' + m); } else { fail++; say('  FAIL ' + m + (d !== undefined ? ' — ' + String(d).slice(0, 300) : '')); } };
const head = (t) => say('\n' + t);
console.log = (...a) => { if (a.length === 1 && a[0] && typeof a[0] === 'object') return; out0(...a); };
console.error = () => {}; console.warn = () => {};
const NOW = Date.parse('2026-11-10T08:00:00Z'); const realNow = Date.now.bind(Date);
Date.now = () => NOW;

const W = await workerHarness();
const VT = vtDigest(), VTOCT = (() => { const d = vtDigest('cycle-2026-10'); return d; })();
const U = {
  vtAgent: userRow({ username: 'cb9101', role: 'agent', cb: 'CB9101', full_name: 'Alpha Test' }),
  vtSched: userRow({ username: 'cb9104', role: 'agent', cb: 'CB9104', full_name: 'Echo Foxtrot' }),
  vtNone: userRow({ username: 'cb9106', role: 'agent', cb: 'CB9106', full_name: 'India Juliet' }),
  vtNew: userRow({ username: 'cb9107', role: 'agent', cb: 'CB9107', full_name: 'Lima Two' }),
  vasAgent: userRow({ username: 'cb9201', role: 'agent', cb: 'CB9201', full_name: 'Kilo Lima' }),
  tlOne: userRow({ username: 'leaderone', role: 'team_leader', cb: 'CB9190', team: 'Leader One', full_name: 'Leader One' }),
  tlTwoByName: userRow({ username: 'leadertwo', role: 'team_leader', cb: null, team: 'Leader Two', full_name: 'Leader Two' }),
  tlVas: userRow({ username: 'leadervas', role: 'team_leader', cb: 'CB9290', team: 'Leader Vas', full_name: 'Leader Vas' }),
  cm: userRow({ username: 'dalwin', role: 'campaign_manager', full_name: 'Fictional Manager' }),
  cmOut: userRow({ username: 'ryan', role: 'campaign_manager', full_name: 'Other Manager' }),
  admin: userRow({ username: 'boss', role: 'admin', apps: ['vas', 'agent'], tabs: { vas: '*' }, full_name: 'Boss' }),
  viewer: userRow({ username: 'view', role: 'viewer', apps: ['vas'], tabs: { vas: ['mtd'] }, full_name: 'Viewer' }),
  wimpy: userRow({ username: 'cb9101', role: 'agent', cb: 'CB9101', scope: 'wimpy' }),
  refs: userRow({ username: 'boss', role: 'admin', scope: 'referrals' }),
};
const ASSIGN_VT = { dalwin: { name: 'Fictional Manager', campaigns: ['courtesy', 'cuddle', 'nesting'] }, ryan: { name: 'Other Manager', campaigns: ['courtesy'] }, preshen: { name: 'Third', campaigns: ['vt'] } };
function publish(o = {}) {
  W.rules = { 'kv:agent-digest': vasDigest() };
  if (o.vt !== false) { W.rules['kv:vt-digest'] = o.live || VT; W.rules['kv:vt-digest-cycle-2026-11'] = VT; W.rules['kv:vt-digest-cycle-2026-10'] = VTOCT; }
  if (o.assign) W.rules['cm:assignments'] = o.assign;
  W.tables = { active_campaigns: [{ key: 'courtesy', label: 'Courtesy' }, { key: 'VT', label: 'VT' }] };
  globalThis.__digestCaches = {}; globalThis.__vtDigestCaches = {}; globalThis.__vtCycles = null; globalThis.__cmCtx = null;
}
const get = async (u, p) => { globalThis.__cmCtx = null; return W.call(u, 'GET', p); };
const codesIn = (t) => [...new Set((String(t).match(/CB9\d{3}/g) || []))].sort();

head('S1 · which card');
publish();
let r = await get(U.vtAgent, '/api/portal/overview');
ok(r.status === 200 && r.j.scorecard === 'vt' && r.j.me && r.j.me.code === 'CB9101', 'a VT agent (CB on the published VT digest) → scorecard:\'vt\', their own row', r.t.slice(0, 160));
ok(r.j.me && !r.j.me.checks && !r.j.me.drill && !('comm' in r.j) && !('nba' in r.j) && !('top' in r.j), 'no VAS checks, drill-down, commission, NBA or top performers on a VT answer');
ok(JSON.stringify(codesIn(r.t)) === '["CB9101","CB9190"]', 'the answer names nobody else (only their own CB and their leader\'s)', JSON.stringify(codesIn(r.t)));
ok(!r.j.floor && !r.j.tlAgg && !r.j.agents && !/nobody on the list/i.test(r.t), 'no floor, team blocks, other rows or unmatched names');
ok(r.j.drivers.length === 4 && r.j.dayCols && r.j.minima && Array.isArray(r.j.cycles), 'the dictionary travels: drivers, dayCols, minima, the published months');
r = await get(U.vtSched, '/api/portal/overview');
ok(r.j.scorecard === 'vt' && r.j.me.rating.why === 'scheduling' && r.j.teamHrs && r.j.teamHrs.hrsAhead, 'a scheduler: the VT answer, not rated (why scheduling), the team\'s scheduling speed as context');
r = await get(U.vasAgent, '/api/portal/overview');
ok(r.status === 200 && !r.j.scorecard && r.j.me && r.j.me.code === 'CB9201' && r.j.me.checks, 'a VAS agent → the VAS answer (checks and all)');
const before = JSON.parse(fs.readFileSync(path.join(HERE, 'vt-notreported-before.json'), 'utf8'));
publish({ vt: false });
r = await get(U.vtAgent, '/api/portal/overview');
ok(before.status === 200 && before.notReported === null && before.me && before.me.covered === false && before.me.why === 'campaign', 'BEFORE (pre-Phase-E Worker): a VT agent got notReported:null and an empty VAS row → an empty VAS card', JSON.stringify(before.notReported));
ok(r.status === 200 && !r.j.scorecard && r.j.notReported && r.j.notReported.why === 'campaign' && r.j.notReported.campaign === 'VT', 'NOW, with no VT digest: the "different scheme" notice (notReported.why campaign)', JSON.stringify(r.j.notReported));
r = await get(userRow({ username: 'cb9203', role: 'agent', cb: 'CB9203' }), '/api/portal/overview');
ok(r.j.notReported === null, 'a VAS agent with no data (why:\'nodata\') is unchanged: notReported stays null', JSON.stringify(r.j.notReported));

head('S2 · scopes come from the session');
publish({ assign: ASSIGN_VT });
r = await get(U.vtAgent, '/api/portal/vt/overview?cb=CB9102');
ok(r.status === 200 && r.j.scope === 'agent' && r.j.me.code === 'CB9101' && JSON.stringify(codesIn(r.t)) === '["CB9101","CB9190"]', 'an agent: their own row, whatever ?cb= says');
r = await get(U.tlOne, '/api/portal/vt/overview');
ok(r.status === 200 && r.j.scope === 'team' && JSON.stringify(r.j.agents.map((a) => a.code).sort()) === '["CB9101","CB9105","CB9106","CB9107"]', 'a team leader (list leader CB9190): exactly their four agents', r.j.agents && r.j.agents.map((a) => a.code).join(','));
ok(r.j.tlAgg.length === 1 && r.j.tlAgg[0].tlCode === 'CB9190' && r.j.subAgg === null && r.j.leadAgg === null && r.j.floor === null, 'their own team block only — no floor, sub-campaign or lead-source blocks');
ok(!codesIn(r.t).some((c) => ['CB9102', 'CB9103', 'CB9104', 'CB9191', 'CB9192'].includes(c)), 'no other team\'s CB anywhere in the answer', codesIn(r.t).join(','));
r = await get(U.tlTwoByName, '/api/portal/vt/overview');
ok(r.status === 200 && JSON.stringify(r.j.agents.map((a) => a.code).sort()) === '["CB9102","CB9104"]', 'a team leader matched by the list\'s leader NAME (no CB on the account): their team only');
r = await get(U.tlVas, '/api/portal/vt/overview');
ok(r.status === 200 && r.j.none === true && !r.j.agents, 'a VAS team leader: none (nothing VT, nothing named)');
r = await get(U.cm, '/api/portal/vt/overview');
ok(r.status === 200 && r.j.none === true, 'a manager not assigned VT while another manager is: none (vtInScope)');
r = await get(userRow({ username: 'preshen', role: 'campaign_manager' }), '/api/portal/vt/overview');
ok(r.status === 200 && r.j.scope === 'campaign' && r.j.agents.length === VT.agents.length && r.j.floor && r.j.subAgg && r.j.leadAgg, 'the manager assigned VT: the whole VT floor');
publish();   // the default assignments: nobody holds VT, the list carries it → every manager (the new-campaign rule)
r = await get(U.cm, '/api/portal/vt/overview');
ok(r.status === 200 && r.j.scope === 'campaign', 'nobody assigned VT and the list carries it → every campaign manager has it (effectiveCamps\' rule, without the drop)');
r = await get(U.viewer, '/api/portal/vt/overview');
ok(r.status === 403, 'a viewer (staff role, not a portal or admin/exec role) → 403', r.status);
r = await get(U.wimpy, '/api/portal/vt/overview'); ok(r.status === 403, 'a wimpy-scoped session → 403', r.status);
r = await get(U.wimpy, '/api/portal/overview'); ok(r.status === 403, '…and on the overview too', r.status);
r = await get(U.refs, '/api/portal/vt/overview'); ok(r.status === 403, 'a referrals-scoped session → 403', r.status);
r = await get(U.admin, '/api/portal/vt/overview');
ok(r.status === 200 && r.j.scope === 'all' && r.j.staff === true && r.j.agents.length === VT.agents.length, 'admin: everything');

head('S3 · unmatched sellers\' names are staff material');
ok(r.j.floor.unmatched.names && r.j.floor.unmatched.names.length === 1, 'admin sees the Salesforce spelling');
r = await get(U.cm, '/api/portal/vt/overview');
ok(r.j.floor.unmatched.sellers === 1 && !('names' in r.j.floor.unmatched) && !/nobody on the list/i.test(r.t), 'a campaign manager gets the count, never the names');

head('S4 · one VT agent, opened by a leader');
r = await get(U.tlOne, '/api/portal/vt/agent?cb=CB9105');
ok(r.status === 200 && r.j.scope === 'agent-detail' && r.j.me.code === 'CB9105' && r.j.scorecard === 'vt', 'Leader One opens their own agent CB9105');
r = await get(U.tlOne, '/api/portal/vt/agent?cb=CB9102');
ok(r.status === 403 && !/Bravo/.test(r.t), 'Leader One asking for another team\'s CB9102 → 403, nothing about the agent', r.t);
r = await get(U.tlOne, '/api/portal/vt/agent?cb=CB9999'); ok(r.status === 403, 'a CB on no list → the same 403 (existence not revealed)');
r = await get(U.vtAgent, '/api/portal/vt/agent?cb=CB9101'); ok(r.status === 403, 'an agent never drills (even into themselves)');
r = await get(U.cm, '/api/portal/vt/agent?cb=CB9103'); ok(r.status === 200 && r.j.me.code === 'CB9103', 'a manager with VT in scope opens any VT agent');
r = await get(U.tlOne, '/api/portal/vt/agent'); ok(r.status === 400, 'no cb → 400');

head('S5 · the reports route and the history months');
for (const k of ['vt-mtd', 'vt-weekly', 'vt-daily']) {
  r = await get(U.tlOne, '/api/portal/tl/reports?kind=' + k);
  ok(r.status === 200 && r.j.kind === k && r.j.scope === 'team' && r.j.agents.length === 4, 'tl/reports?kind=' + k + ': the leader\'s team slice');
}
r = await get(U.vtAgent, '/api/portal/tl/reports?kind=vt-mtd'); ok(r.status === 403, 'an agent → 403 on the VT reports');
r = await get(U.tlOne, '/api/portal/tl/reports?kind=vt-nope'); ok(r.status === 400, 'an unknown VT kind → 400');
r = await get(U.tlVas, '/api/portal/tl/reports?kind=variance'); ok(r.status === 404 || r.status === 200, 'the VAS kinds still go to the VAS handler (variance: ' + r.status + ')');
r = await get(U.vtAgent, '/api/portal/vt/overview?cycle=cycle-2026-10');
ok(r.status === 200 && r.j.period.key === 'cycle-2026-10' && r.j.me.code === 'CB9101', 'a past business month: its history key is served (cycle-2026-10)');
r = await get(U.vtAgent, '/api/portal/vt/overview?cycle=2026-10'); ok(r.status === 400, 'a malformed cycle → 400');
r = await get(U.vtAgent, '/api/portal/vt/overview?cycle=cycle-2026-08');
ok(r.status === 200 && r.j.none === true && r.j.published === false, 'an unpublished month: none, published:false — never another month\'s figures');

head('S6 · cost');
publish();
globalThis.__vtDigestCaches = {};
r = await get(U.vtAgent, '/api/portal/vt/overview');
const coldSubs = r.subs;
const c0 = process.cpuUsage(); r = await get(U.vtAgent, '/api/portal/vt/overview'); const cpu = process.cpuUsage(c0); const cpuMs = (cpu.user + cpu.system) / 1000;
ok(r.subs <= coldSubs && r.subs <= 4, 'a warm VT overview: ' + r.subs + ' subrequests (cold ' + coldSubs + ') — the digest is read once a minute per isolate', r.subs);
ok(cpuMs < 10, 'a warm VT overview costs ' + cpuMs.toFixed(2) + ' ms of CPU here (harness included) — under the FREE plan\'s 10 ms', cpuMs);
const VTSRC = fs.readFileSync(path.join(ROOT, 'worker', 'src', 'vt.mjs'), 'utf8');
ok(!/vt_book|VTEngine|model\(/.test(VTSRC.slice(VTSRC.indexOf('portal half (Phase E) below this line'))), 'the portal half never reads the case book or calls the engine (no recomputation)');
const PORTAL = await import(pathToFileURL(path.join(ROOT, 'worker', 'src', 'portal.mjs')).href);
ok(PORTAL.PORTAL_ALLOWED.has('/api/portal/vt/overview') && PORTAL.PORTAL_ALLOWED.has('/api/portal/vt/agent') && !PORTAL.PORTAL_ALLOWED.has('/api/vt/book'), 'PORTAL_ALLOWED: the two VT portal reads, never an intake route');

if (process.argv.includes('--worker-only')) { say(`\n==== ${pass} passed, ${fail} failed ====`); process.exit(fail ? 1 : 0); }

/* ============================== PAGE HALF ============================== */
if (!process.argv.includes('--no-build')) {
  const b = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'prepare-site.js')], { cwd: ROOT, encoding: 'utf8' });
  ok(b.status === 0 && /Build consistency verified/.test(b.stdout), 'the site builds (tools/prepare-site.js)', (b.stderr || b.stdout).slice(-300));
}
const BUILT = fs.readFileSync(path.join(ROOT, 'site', 'agent', 'index.html'), 'utf8');
ok(/\/\* inlined vt-view\.js/.test(BUILT) && !/<script\b[^>]*\bdata-inline\b/i.test(BUILT), 'the built Agent Analytics carries vt-view.js inlined, no data-inline tag left');
Date.now = realNow;   // the browser has its own clock; the Worker's fence is not on this path
const { chromium } = await import(pathToFileURL(path.join(HERE, 'node_modules', 'playwright', 'index.mjs')).href);
const SERVE = { '/agent/': 'site/agent/index.html', '/agent/index.html': 'site/agent/index.html', '/xlsx.full.min.js': 'site/xlsx.full.min.js' };
const server = http.createServer((q, s) => { const rel = SERVE[q.url.split('?')[0]]; const p = rel && path.join(ROOT, rel);
  if (!p || !fs.existsSync(p)) { s.writeHead(404); s.end(); return; }
  s.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' }); fs.createReadStream(p).pipe(s); });
await new Promise((res) => server.listen(8291, '127.0.0.1', res));
const browser = await chromium.launch();
const TOKENS = {}; Object.entries(U).forEach(([k, v]) => { TOKENS['tok-' + k] = v; });
const HELP_MINE = { requests: [{ id: 'h1', category: 'Explain my result', created: '2026-11-09T09:00:00Z', stage: 'New', closed: false }] };
async function pageAs(who, viewport = { width: 1400, height: 1000 }) {
  const page = await browser.newPage({ viewport });
  const errs = []; page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 200)));
  await page.route('**/api/**', async (route) => {
    const q = route.request(), u = new URL(q.url());
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
    if (q.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (u.pathname === '/api/portal/help/mine') return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(HELP_MINE) });
    const tok = String(q.headers()['authorization'] || '').replace(/^Bearer\s+/, '');
    const user = TOKENS[tok] || null; globalThis.__cmCtx = null;
    const res = await W.call(user, q.method(), u.pathname + u.search, q.postData() || undefined);
    await route.fulfill({ status: res.status, headers: cors, contentType: 'application/json', body: res.t });
  });
  await page.addInitScript((t) => { sessionStorage.setItem('cbx_agent_token', t); }, 'tok-' + who);
  await page.goto('http://127.0.0.1:8291/agent/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.D && document.querySelector('.main'), null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(600);
  return { page, errs };
}
const txt = (page, sel = '#root') => page.evaluate((s) => (document.querySelector(s) || {}).innerText || '', sel).then((t) => t.replace(/\s+/g, ' '));
const nf = (v, d) => new Intl.NumberFormat('en-ZA', { minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
const allErrs = [];

head('B1 · the VT agent card (CB9101)');
publish();
{ const { page, errs } = await pageAs('vtAgent');
  const me = VT.agents.find((a) => a.code === 'CB9101'), rt = me.rating;
  const card = await page.evaluate(() => { const c = document.querySelector('[data-vt="card"]'); if (!c) return null;
    return { score: (c.querySelector('.pg-score b') || {}).textContent, verdict: (c.querySelector('.pg-verdict') || {}).textContent, why: (c.querySelector('.why') || {}).textContent,
      rows: [...c.querySelectorAll('.pg-row')].map((r) => ({ k: r.dataset.k, t: r.innerText.replace(/\s+/g, ' '), solid: !!r.querySelector('i.solid'), pale: !!r.querySelector('i.pale'), ok: r.querySelector('.pg-bar2') && r.querySelector('.pg-bar2').className })),
      tips: [...c.querySelectorAll('.vt-tip .t')].map((x) => x.textContent), tally: (c.querySelector('.pg-tally') || {}).textContent, btns: [...c.querySelectorAll('.pg-btns button')].map((b) => b.textContent),
      tiny: [...c.querySelectorAll('.tiny2')].map((x) => x.textContent).join(' ') }; });
  ok(!!card, 'the card renders');
  ok(card && card.score === nf(rt.adj, 1), 'score = the engine\'s (' + nf(rt.adj, 1) + ' out of 100)', card && card.score);
  ok(card && card.verdict.startsWith(rt.band) && (!rt.nextBand || card.verdict.includes(nf(rt.nextBand.gap, 1) + ' points from ' + rt.nextBand.label)), 'tier and the gap to the next tier are the engine\'s', card && card.verdict);
  ok(card && card.why.includes(rt.onTarget + ' of your ' + rt.measuredCount + ' drivers are at target'), '"n of your m drivers are at target" from the engine', card && card.why);
  const wk = rt.parts.find((p) => p.k === rt.weakest);
  ok(card && card.why.includes('The most points sitting unclaimed are in ' + VT.drivers.find((d) => d.k === rt.weakest).label + ' — ' + nf(wk.available, 1)), 'the weakest driver and its points, from the engine', card && card.why);
  ok(card && /business month to date \(26 Oct – 10 Nov\)/.test(card.tiny) && /never a ranking against your colleagues/.test(card.tiny), 'the window sentence: your business month to date (26 Oct – 10 Nov), never a ranking', card && card.tiny.slice(0, 200));
  ok(card && JSON.stringify(card.rows.map((x) => x.k)) === '["targetAch","fitRate","missRate","fitted"]', 'one row per VT driver, no VAS driver', card && card.rows.map((x) => x.k).join(','));
  for (const p of rt.parts) {
    const row = card && card.rows.find((x) => x.k === p.k); const lab = VT.drivers.find((d) => d.k === p.k).label;
    const pill = p.onTarget ? 'At target' : (p.dir === 'lower' ? 'Too high' : 'To go');
    ok(row && row.t.startsWith(lab) && row.t.includes(nf(p.pointsEff, 1) + ' / ' + nf(p.weff, p.weff % 1 ? 1 : 0) + ' pts') && row.t.includes(pill), p.k + ': label, points / max and the pill (' + pill + ') are the engine\'s verdict', row && row.t);
    ok(row && row.ok.includes(p.onTarget ? 'ok' : 'short') && row.pale === (p.att > 0) && row.solid === (p.att * 100 > 50), p.k + ': the two-shade bar changes shade at half of target', row && JSON.stringify(row));
  }
  const mr = card && card.rows.find((x) => x.k === 'missRate');
  ok(mr && /lower is better/.test(mr.t) && /max /.test(mr.t), 'Missed Rate reads lower-is-better ("lower is better", "max <target>")', mr && mr.t);
  ok(card && /On Missed Rate lower is better/.test(card.tiny) && /changes shade at half of your target/.test(card.tiny), 'the footnote: shade at half of target + how the lower-is-better bar fills');
  const tipsWant = rt.parts.filter((p) => p.measured && p.available > 0.2).sort((a, b) => b.available - a.available).slice(0, 3).map((p) => VT.drivers.find((d) => d.k === p.k).label + ' · ' + nf(p.available, 1) + ' points available');
  ok(card && JSON.stringify(card.tips) === JSON.stringify(tipsWant), 'the "points available" tip boxes are the engine\'s biggest unclaimed', card && card.tips.join(' | '));
  ok(card && card.tally.includes('Composite ' + nf(rt.score, 1)) && card.tally.includes(nf(rt.adj, 1) + ' out of 100'), 'the composite line: Composite … = … out of 100', card && card.tally);
  ok(card && card.btns.join('|') === '★ How the score works|Open my session brief|Ask Leader to help with ' + VT.drivers.find((d) => d.k === rt.weakest).label.toLowerCase(), 'the three buttons, the help one naming the leader and the weakest driver', card && card.btns.join('|'));
  ok(/Your help requests/.test(await txt(page)) && /Explain my result/.test(await txt(page)), '"Your help requests" shows below the card');
  await page.screenshot({ path: path.join(SHOTS, 'vt-agent-card.png'), fullPage: true });
  await page.click('[data-vthow]'); await page.waitForTimeout(150);
  const how = await txt(page, '#vtOv');
  ok(VT.drivers.every((d) => how.includes(d.label + ' — ' + d.w + ' points')) && /half of the target/.test(how) && /never ranked/.test(how) && how.includes('at least ' + VT.minima.cases + ' sales'), '"How the score works" explains the VT score in words, from the payload', how.slice(0, 200));
  await page.evaluate(() => document.getElementById('vtOv').remove());
  await page.click('[data-vthelp]'); await page.waitForTimeout(150);
  ok(await page.evaluate(() => !!document.getElementById('helpOv') && /Send to Leader/.test(document.getElementById('helpOv').textContent)), 'Ask the team leader opens the Help Center form addressed to their leader');
  await page.evaluate(() => document.getElementById('helpOv').remove());

  head('B3 · the VT agent\'s nav and My month');
  const nav = await page.evaluate(() => [...document.querySelectorAll('.nav-item')].map((n) => n.textContent.trim()));
  ok(nav.some((x) => /Today/.test(x)) && nav.some((x) => /My month/.test(x)) && !nav.some((x) => /Projected Commission|Links|My Progress/.test(x)), 'nav: Today + My month; Projected Commission, Links and My Progress are hidden', nav.join(','));
  await page.click('[data-vtview="brief"]'); await page.waitForTimeout(150);
  const wk1 = await page.evaluate(() => [...document.querySelectorAll('.vt-weeks tbody tr')].map((r) => r.innerText.replace(/\s+/g, ' ')));
  const weeksWant = me.weeks.filter((w) => w.from <= VT.period.asOf);
  ok(wk1.length === weeksWant.length && wk1[0].includes(nf(weeksWant[weeksWant.length - 1].sales, 0)), 'My month: one row per week so far, newest first, the engine\'s weekly figures', wk1.join(' / '));
  const dy = await page.evaluate(() => document.querySelectorAll('.vt-days tbody tr').length);
  ok(dy === me.days.length, 'My month: one row per day of the business month so far', dy + ' vs ' + me.days.length);
  allErrs.push(...errs); await page.close(); }

head('B2 · honest states');
{ const { page, errs } = await pageAs('vtSched');
  const t = await txt(page);
  ok(/Scheduling agents are not rated yet: the uploads do not say which scheduler handled a sale/.test(t) && !(await page.$('.pg-score')), 'a scheduler: the reason in words, no score');
  ok(await page.$('.vt-hrs') !== null && /Leader Two — open Scheduled/i.test(t), '…and the team\'s scheduling speed (Hrs Ahead) as context');
  allErrs.push(...errs); await page.close(); }
{ const { page, errs } = await pageAs('vtNone');
  const t = await txt(page);
  ok(/Not rated yet/.test(t) && !(await page.$('.pg-score')) && !/0,0 out of 100|\b0 out of 100/.test(t), 'no in-play sales: "Not rated yet" — never a 0 score');
  allErrs.push(...errs); await page.close(); }
{ const { page, errs } = await pageAs('vtNew');
  const a = VT.agents.find((x) => x.code === 'CB9107');
  const t = await txt(page);
  ok(a.rating.unmeasured.length === 2 && /Target Achievement is not measured yet \(fewer than 5 tracked working days\)/.test(t) && /the other drivers share its weight/.test(t), 'a driver not measured: said in words, renormalised', t.slice(0, 300));
  const rows = await page.evaluate(() => [...document.querySelectorAll('.pg-row')].map((r) => r.innerText.replace(/\s+/g, ' ')));
  ok(rows.filter((x) => /not measured/.test(x)).length === 2 && rows.some((x) => { const w = a.rating.parts.find((p) => p.k === 'fitRate').weff; return x.includes('/ ' + nf(w, w % 1 ? 1 : 0) + ' pts'); }), 'unmeasured rows say "not measured"; the measured ones carry their effective weight', rows.join(' / '));
  ok(/Thu 5 Nov: no BI Active Fitted or Scheduled & Missed upload/.test(t), 'the missing day\'s upload is said (Thu 5 Nov), from the engine\'s list');
  allErrs.push(...errs); await page.close(); }
{ publish({ live: { ...VT, trackFrom: '2026-11-02' } });
  const { page, errs } = await pageAs('vtAgent');
  ok(/This business month's figures start on Mon 2 Nov, the day after the first upload/.test(await txt(page)), 'the month began before the first upload (no opening book): the note says what it means');
  allErrs.push(...errs); await page.close(); }
{ const DEC = ENG.digest(ENG.model(ENG.emptyBook(), ROSTER, { cycleKey: 'cycle-2026-12', asOf: '2026-11-27' }), { updatedAt: '2026-11-26T06:00:00Z' });
  publish({ live: DEC });
  const { page, errs } = await pageAs('vtAgent');
  const t = await txt(page);
  ok(DEC.empty === true && /No December 2026 figures yet/.test(t) && !(await page.$('.pg-score')), 'the empty month: "No December 2026 figures yet", no score', t.slice(0, 200));
  const fin = await page.$('[data-vtcycle="cycle-2026-11"]');
  ok(!!fin && /November 2026 \(final\)/.test(await fin.innerText()), '…with a "November 2026 (final)" link');
  if (fin) { await fin.click(); await page.waitForTimeout(400); }
  ok(!!(await page.$('.pg-score')) && /Back to December 2026/.test(await txt(page)), 'the link opens November\'s card, with "Back to December 2026"');
  await page.click('[data-vtcycle=""]').catch(() => {}); await page.waitForTimeout(200);
  ok(/No December 2026 figures yet/.test(await txt(page)), '…and back');
  allErrs.push(...errs); await page.close(); }

head('B4 · the VT team leader (Leader One)');
publish();
{ const { page, errs } = await pageAs('tlOne');
  await page.waitForFunction(() => window.VTView && window.VTView.state().team, null, { timeout: 8000 }).catch(() => {});
  await page.evaluate(() => { VIEW = 'results'; render(); }); await page.waitForTimeout(200);
  const vrows = await page.evaluate(() => [...document.querySelectorAll('tr.vt-teamrow')].map((r) => r.dataset.vtrow));
  ok(JSON.stringify(vrows.sort()) === '["CB9101","CB9106"]' && !/Not reported on this page/.test(await txt(page)), 'Team Results: the VT agents on the VAS list paint their VT figures, never "Not reported"', vrows.join(','));
  await page.click('button[data-vtcb="CB9101"]'); await page.waitForTimeout(400);
  const ov = await txt(page, '#vtOv');
  ok(/Agent rating/.test(ov) && ov.includes(nf(VT.agents.find((a) => a.code === 'CB9101').rating.adj, 1)) && !/Ask Leader/.test(ov), 'Open VT card: the agent\'s VT card (no "Ask" button on a leader\'s view)', ov.slice(0, 120));
  await page.evaluate(() => document.getElementById('vtOv').remove());
  const navs = await page.evaluate(() => { VIEW = 'mtd_team'; render(); return [...document.querySelectorAll('[data-report]')].map((b) => b.textContent); });
  ok(['VT Month to date', 'VT Weekly', 'VT Daily'].every((x) => navs.includes(x)) && navs.includes('Month to date'), 'Reports: the VAS tabs AND VT Month to date / VT Weekly / VT Daily', navs.join(','));
  for (const [view, v] of [['vt_mtd_team', 'mtd'], ['vt_weekly_team', 'weekly'], ['vt_daily_team', 'daily']]) {
    await page.evaluate((x) => { VIEW = x; render(); }, view); await page.waitForTimeout(150);
    const tb = await page.evaluate(() => { const t = document.querySelector('table.vt-rep'); if (!t) return null;
      const h = [...t.querySelectorAll('thead th')].map((x) => x.textContent); return { h, rows: [...t.querySelectorAll('tbody tr')].map((r) => [...r.children].map((c) => c.innerText.replace(/\s+/g, ' ').trim())) }; });
    const team = VT.agents.filter((a) => a.tlCode === 'CB9190');
    ok(tb && tb.rows.length === team.length + 1 && tb.rows[tb.rows.length - 1][0] === 'Leader One total', view + ': the team\'s ' + team.length + ' agents + the team total', tb && tb.rows.map((r) => r[0]).join(','));
    const si = tb ? tb.h.indexOf('Sales') : -1, a1 = team.find((a) => a.code === 'CB9101');
    const w = v === 'mtd' ? a1.mtd : v === 'weekly' ? a1.weeks.filter((x) => x.from <= VT.period.asOf).slice(-1)[0] : (() => { const c = a1.days[a1.days.length - 1]; return Object.fromEntries(VT.dayCols.map((k, i) => [k, c[i]])); })();
    const ar = tb && tb.rows.find((r) => r[0] === 'Alpha Test');
    ok(ar && ar[si] === nf(w.sales, 0) && ar[tb.h.indexOf('Fitted')] === nf(w.fitted, 0), view + ': Alpha Test\'s sales and fitted are the digest\'s', ar && ar.join(' | '));
    if (v === 'mtd') ok(ar && ar[tb.h.indexOf('Cancelled')] === '—' && ar[tb.h.indexOf('Rating')] === nf(a1.rating.adj, 1) + ' · ' + a1.rating.band, 'mtd: Cancelled "—" (never 0), the rating column', ar && ar.join(' | '));
    await page.evaluate(() => { window.XLSX.writeFile = () => {}; });
    await page.click('[data-vtexport]'); await page.waitForTimeout(150);
    const ex = await page.evaluate(() => window.__vtLastExport);
    const label = { mtd: 'Month to date', weekly: 'Weekly', daily: 'Daily' }[v];
    ok(ex && ex.name.startsWith('TL VT ' + label + ' - Leader One - ') && ex.name.endsWith('.xlsx') && ex.sheets.length === 1, view + ': export "' + (ex && ex.name) + '" (TL VT <report> - <team> - <period>.xlsx), one sheet');
    ok(ex && tb && ex.sheets[0].aoa.length === tb.rows.length + 1 && ex.sheets[0].aoa.slice(1).every((row, i) => row[0] === tb.rows[i][0] && (typeof row[4] === 'number' ? nf(row[4], 0) : row[4]) === tb.rows[i][3]), view + ': the workbook rows are the screen\'s rows (agent, sales)');
    if (v === 'mtd') await page.screenshot({ path: path.join(SHOTS, 'vt-tl-view.png'), fullPage: true });
  }
  allErrs.push(...errs); await page.close(); }

head('B5 · the campaign manager');
{ const { page, errs } = await pageAs('cm');
  await page.waitForFunction(() => window.VTView && window.VTView.state().team, null, { timeout: 8000 }).catch(() => {});
  await page.evaluate(() => { render(); }); await page.waitForTimeout(150);
  const nav = await page.evaluate(() => [...document.querySelectorAll('.nav-item')].map((n) => n.textContent.trim()));
  ok(nav.some((x) => /Vehicle Tracking/.test(x)) && nav.some((x) => /Campaign$/.test(x)), 'the manager\'s nav: Vehicle Tracking beside the VAS campaign tabs', nav.join(','));
  await page.evaluate(() => { VIEW = 'cm_vt'; render(); }); await page.waitForTimeout(200);
  const t = await txt(page);
  ok(/In-play sales/.test(t) && t.includes(nf(VT.floor.mtd.sales, 0)) && /Sub-campaigns/.test(t) && /Digital/.test(t) && /Predictive/.test(t) && /Referral/.test(t) && /Lead sources/.test(t) && /Lead Gen \(group\)/.test(t), 'the VT campaign view: floor tiles, sub-campaigns, lead sources (Lead Gen group)', t.slice(0, 200));
  ok(/Unmatched sellers \(1\)/.test(t) && !/nobody on the list/i.test(t), 'unmatched sellers: the count, never the names');
  const rows = await page.evaluate(() => document.querySelectorAll('table.vt-rep tbody tr').length);
  ok(rows === VT.agents.length + VT.tlAgg.length + 2, 'every VT agent, each team total, unmatched and the floor total', rows);
  await page.screenshot({ path: path.join(SHOTS, 'vt-cm-view.png'), fullPage: true });
  await page.evaluate(() => { VIEW = 'cm_vt_weekly'; render(); }); await page.waitForTimeout(150);
  ok(await page.$('table.vt-rep[data-vtrep="weekly"]') !== null, 'the Weekly sub-tab renders');
  await page.evaluate(() => { VIEW = 'cm'; render(); }); await page.waitForTimeout(150);
  ok(!(await page.$('table.vt-rep')) && /Sales this month so far/.test(await txt(page)), 'the VAS Campaign tab is the VAS one (its own tiles, no VT table)');
  allErrs.push(...errs); await page.close(); }

head('B6 · a VAS agent\'s page is unchanged by a VT digest');
async function vasHtml(vt) { publish({ vt }); const { page, errs } = await pageAs('vasAgent'); allErrs.push(...errs);
  const h = await page.evaluate(() => { VIEW = 'progress'; render(); const p = document.getElementById('root').innerHTML; VIEW = 'month'; render(); return p + '|' + document.getElementById('root').innerHTML; }); await page.close(); return h; }
const v0 = await vasHtml(false), v1 = await vasHtml(true);
ok(v0.length > 1000 && v0 === v1, 'Today and My Progress are identical with and without a VT digest (' + v0.length + ' chars)');
ok(/class="pg-score/.test(v0) && !/data-vt="card"/.test(v1), 'the VAS card is the VAS card (no VT card)');

head('B7 · page errors and screenshots');
ok(allErrs.length === 0, 'no page errors', [...new Set(allErrs)].slice(0, 3).join(' | '));
say('  screenshots: ' + ['vt-agent-card', 'vt-tl-view', 'vt-cm-view'].map((x) => path.join(SHOTS, x + '.png')).join(' · '));
await browser.close(); server.close();
console.error = err0; console.warn = warn0;
say(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
