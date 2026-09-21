/* THE WEEKLY REVIEW MUST BE PUBLISHED, AND OVER THE PERIOD ON SCREEN.
 *
 * Found 2026-08-28: kv:nba-digest was last written on 24 August over a window of
 * 2022-08-27 to 2026-08-22 — 1 040 working days — and NOTHING in the codebase wrote it.
 * Only readers. So every next best action a team leader and an agent saw was frozen four
 * days old and computed over four years. CB287 read QA 27,2% against a real 55,5% and was
 * handed a P1 "Critical QA Failure" — a 48-hour compliance action — on that average.
 *
 * Ops already computed every field for its own screens and simply never published them.
 * This holds the publisher to the contract worker/src/portal.mjs reads, and holds the
 * window to the period on screen so a four-year review can never be published again.
 *
 * Run: node verify-nba-publish.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
const AGENTOS = process.env.AGENTOS || decodeURIComponent(new URL('../..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1').replace(/\/$/, '');   // repo-relative (2026-09-08): the laptop path failed every cloud run
const { chromium } = await import(pathToFileURL(path.join(AGENTOS, 'nicks_code', 'diagnostics', 'node_modules', 'playwright', 'index.mjs')).href);
const OPS = path.join(AGENTOS, 'Chatterbox_AgentOS_Analytics.html');
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + ' — ' + d); } };
const srv = http.createServer((q, s) => {
  const u = q.url.split('?')[0];
  const f = u === '/xlsx.full.min.js' ? path.join(AGENTOS, 'site', 'xlsx.full.min.js') : (u === '/' ? OPS : null);
  if (!f) { s.writeHead(404); s.end(); return; }
  s.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' });
  fs.createReadStream(f).pipe(s);
});
await new Promise(r => srv.listen(8234, '127.0.0.1', r));
const b = await chromium.launch();
const page = await b.newPage();
const errs = []; page.on('pageerror', e => errs.push(String(e.message).slice(0, 140)));
await page.goto('http://127.0.0.1:8234/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);

const out = await page.evaluate(() => {
  /* A small floor with everything the engine reads: attendance, QA (including a critical
     fail), calls, leads and a money source, over one month. */
  const days = Array.from({ length: 20 }, (_, i) => '2026-08-' + String(i + 1).padStart(2, '0'));
  state.cbInfo = {};
  ['CB901', 'CB902'].forEach((cb, n) => {
    state.cbInfo[cb] = { name: 'Agent ' + n, code: cb, tl: 'TL A', queue: 'Cuddle', tenure: 'M2', target: 0.25 };
  });
  state.facts.ATTENDANCE = [];
  state.facts.QA_EVALUATIONS = [];
  state.facts.CALLX_CALL_RECORDS = [];
  state.facts.SF_OPEN_CASES = [];
  state.facts.BI_ACTIVE_CASES = [];
  for (const cb of ['CB901', 'CB902']) {
    days.forEach(d => state.facts.ATTENDANCE.push({ employee_code: cb, status_code: 'P', status: 'Present', present_flag: 1, _d: d }));
    state.facts.QA_EVALUATIONS.push({ sales_agent_code: cb, cb_code: cb, score_percent: 88,
      escalation_decision: 'Pass', _d: '2026-08-05' });
    state.facts.SF_OPEN_CASES.push({ case_number: cb + '-1', case_owner: 'Agent', cb: cb, cb_code: cb, status: '1st attempt', _d: '2026-08-04' });
  }
  /* the field and the vocabulary the engine actually reads: escalation_decision against
     the $qaCritical rule, whose only value is "Critical Fail" */
  state.facts.QA_EVALUATIONS.push({ sales_agent_code: 'CB902', cb_code: 'CB902', score_percent: 0,
    escalation_decision: 'Critical Fail', _d: '2026-08-06' });
  if (typeof _dataVer !== 'undefined') _dataVer++;
  /* the publisher builds from the period on screen */
  const before = window.storage && window.storage.set;
  let written = null;
  window.storage = Object.assign({}, window.storage, { set: (k, v) => { if (k === 'nba-digest') written = v; } });
  sessionStorage.setItem('cbx_token', 'test');
  window.__nbaPush();
  const payload = written ? JSON.parse(written) : null;
  const win = periodWindow();
  return { payload, win: { from: winFrom(win), to: win.to }, rawWin: win, days: days.length };
});

ok('the publisher exists and produced a payload', !!out.payload);
if (!out.payload) { console.log('\n==== ' + pass + ' passed, ' + (fail + 1) + ' failed ===='); await b.close(); srv.close(); process.exit(1); }
const p = out.payload;
console.log('  period ' + p.period.from + ' → ' + p.period.to + ' · ' + p.workDays + ' working days · ' + p.agents.length + ' agents');

/* the contract worker/src/portal.mjs reads */
ok('it carries the keys the portal reads',
  ['v', 'updatedAt', 'period', 'workDays', 'thresholds', 'agents'].every(k => k in p),
  Object.keys(p).join(', '));
const a = p.agents[0];
ok('each agent carries the keys the page reads',
  ['cb', 'name', 'tl', 'nba', 'composite', 'r2a', 'twoCheck', 'stats', 'driver'].every(k => k in a),
  Object.keys(a).join(', '));
ok('nbaBy() can find an agent by cb', /^CB\d+$/.test(String(a.cb)), String(a.cb));
ok('the ladder row is complete', a.nba && a.nba.code && a.nba.label && a.nba.reason,
  JSON.stringify(a.nba));

/* THE WINDOW — the whole point */
const day = 86400000;
const len = (f, t) => Math.round((Date.parse(t + 'T00:00:00Z') - Date.parse(f + 'T00:00:00Z')) / day) + 1;
/* THE WINDOW IS THE REPORTING MONTH, AND THE SCREEN CANNOT REACH IT (audit, 2026-08-31).
   This used to assert the published window equalled the period ON SCREEN, which is exactly
   how the live payload came to run 2025-10-01 to 2026-08-28 — 238 working days — while
   passing every check: state.range is shared UI state, somebody had "all data" selected,
   and the contract said that was correct. A Cuddle agent at 128% of target for August read
   17.7% on it and was handed "start a PIP". The ladder is defined over a reporting period,
   so the publisher decides the period. */
ok('the window starts on the first of the month it reports',
  /^\d{4}-\d{2}-01$/.test(p.period.from), p.period.from);
ok('the window ends inside its own month',
  p.period.to.slice(0, 7) === p.period.from.slice(0, 7), JSON.stringify(p.period));
ok('the window is a month, not four years (' + len(p.period.from, p.period.to) + ' days)',
  len(p.period.from, p.period.to) <= 62, JSON.stringify(p.period));
ok('working days are plausible for one period (' + p.workDays + ')', p.workDays > 0 && p.workDays <= 45,
  String(p.workDays));

/* the figures must be this period's, not a four-year average */
ok('QA reads this period for a clean agent', a.stats.qa == null || (a.stats.qa >= 80 && a.stats.qa <= 100),
  String(a.stats.qa));
const crit = p.agents.find(x => x.cb === 'CB902');
/* 2026-09-11 (Nick): the tier still classifies, but deducts nothing — penalty is 0 by rule. */
ok('a critical fail is carried and tiered (and deducts nothing)', crit && crit.r2a && crit.r2a.fails >= 1 && crit.r2a.tier && crit.r2a.tier !== 'Tier 0' && crit.r2a.penalty === 0,
  JSON.stringify(crit && crit.r2a));
ok('the "all data" sentinel never reaches the published window',
  p.period.from >= '2000-01-01', p.period.from + ' (raw window was ' + out.rawWin.from + ')');

/* the screen's range is set to the whole data set — the published window must not move */
const wide = await page.evaluate(() => {
  state.range = { mode: 'all', from: null, to: null };
  let written = null;
  window.storage = Object.assign({}, window.storage, { set: (k, v) => { if (k === 'nba-digest') written = v; } });
  window.__nbaPush();
  return { payload: written ? JSON.parse(written) : null, screen: periodWindow() };
});
ok('"all data" on screen does not widen the published review',
  !wide.payload || (wide.payload.period.from === p.period.from && wide.payload.period.to === p.period.to),
  JSON.stringify(wide.payload && wide.payload.period) + ' while the screen showed ' + JSON.stringify(wide.screen));

/* the contract the agent page and the team leader page read, field by field */
ok('the two-check status is one of the four the readers know',
  ['Both Pass', 'Value Issue', 'Volume Issue', 'Both Issues'].indexOf(a.twoCheck.status) >= 0,
  String(a.twoCheck.status));
ok('check 2 passes at the published target line, not at the R4A trigger',
  p.thresholds.targetAch === 100 && p.agents.every(x => x.twoCheck.ta == null
    || x.twoCheck.volume === (x.twoCheck.ta >= p.thresholds.targetAch)),
  'targetAch ' + p.thresholds.targetAch);
ok('the weakest driver carries the key the reader looks it up by',
  p.agents.filter(x => x.driver).every(x => ['gwpSale', 'targetAch', 'qa', 'conv', 'talk', 'attendance'].indexOf(x.driver.key) >= 0),
  JSON.stringify((p.agents.find(x => x.driver) || {}).driver));
ok("the compliance tier carries its level and the rule book's words",
  p.agents.every(x => x.r2a && x.r2a.tier && x.r2a.lvl != null
    && ['Eligible', 'Retained'].indexOf(x.r2a.elite) >= 0),   // Blocked retired 2026-09-21 — a tier coaches, it never blocks
  JSON.stringify(p.agents[0].r2a));
ok('the composite is on the 0-100 scale', a.composite.adj == null || (a.composite.adj >= 0 && a.composite.adj <= 100),
  String(a.composite.adj));
ok('an unchanged payload is not re-posted', await page.evaluate(() => {
  let again = null;
  window.storage = Object.assign({}, window.storage, { set: (k, v) => { if (k === 'nba-digest') again = v; } });
  window.__nbaPush();
  return again === null;
}));
/* ---- THE FLEET CONTEXT IS CACHED, AND AN UPLOAD STILL CLEARS IT -------------------
   acCtxBuild walks every fact row to bucket them per agent, and seven call sites used to
   rebuild it from scratch. Caching it is only safe while a data change still invalidates
   it — a stale context would serve yesterday's numbers to every Ops page at once, which
   is far worse than the lag it fixes. */
const ctx = await page.evaluate(() => {
  const win = periodWindow();
  const t = () => { const t0 = performance.now(); acCtx(win); return performance.now() - t0; };
  const cold = t(), warm = t();
  const a = acCtx(win), b = acCtx(win);
  /* an upload bumps _dataVer — the same stamp rowsFor memoises on */
  _dataVer++;
  const afterUpload = acCtx(win);
  /* and a roster change must not be served the old context either */
  const before = Object.keys(state.cbInfo).length;
  state.cbInfo['CB999'] = { name: 'New', code: 'CB999', tl: 'TL A', queue: 'Cuddle', tenure: 'M2', target: 0.25 };
  const afterRoster = acCtx(win);
  delete state.cbInfo['CB999'];
  return { cold: Math.round(cold), warm: Math.round(warm), sameObject: a === b,
    rebuiltOnUpload: afterUpload !== a, rebuiltOnRoster: afterRoster !== afterUpload };
});
console.log('  fleet context: ' + ctx.cold + 'ms cold, ' + ctx.warm + 'ms warm');
ok('the fleet context is built once and shared', ctx.sameObject);
ok('the warm call is materially cheaper', ctx.warm <= Math.max(2, ctx.cold / 4),
  ctx.cold + 'ms then ' + ctx.warm + 'ms');
ok('an upload rebuilds it — no stale context survives new data', ctx.rebuiltOnUpload);
ok('a roster change rebuilds it too', ctx.rebuiltOnRoster);
/* ---- A MANUAL MAPPING MUST ACTUALLY TAKE EFFECT ------------------------------------
   The Mappings tab exists to point a dialler name at a CB code when the automatic join
   misses. mapAgent() wrote the alias and saved it, but never bumped the data version —
   so rowsFor's cache, ownerMatch's cache and cbOf's cache all kept serving the previous
   attribution and the figures the mapping was meant to correct did not move. */
const mapping = await page.evaluate(() => {
  const name = 'Some Dialler Alias';
  const before = { cb: cbOf(name), ver: _dataVer };
  const target = Object.keys(state.cbInfo)[0];
  mapAgent(name, target);
  const after = { cb: cbOf(name), ver: _dataVer };
  mapAgent(name, '');                       // put it back
  return { before, after, target, cleared: cbOf(name) };
});
ok('a manual mapping resolves the name to the chosen agent',
  mapping.after.cb === mapping.target, JSON.stringify(mapping));
ok('and it bumps the data version, so every cached read is re-taken',
  mapping.after.ver > mapping.before.ver, mapping.before.ver + ' -> ' + mapping.after.ver);
ok('clearing the mapping releases the name again', mapping.cleared !== mapping.target,
  String(mapping.cleared));
ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
await b.close(); srv.close();
process.exit(fail ? 1 : 0);
