#!/usr/bin/env node
/**
 * verify-empty-month.mjs — spec 002-live-month-sync-coaching, contract C1 (+ the tool half of C2).
 *
 *   node nicks_code/diagnostics/verify-empty-month.mjs
 *
 * The live month is ALWAYS the current month, even before its first data lands. Runs the REAL engine
 * (nicks_code/index.html) headlessly with the clock pinned to 1 Oct 2026 SAST — no credentials, every Worker
 * request is aborted, nothing can reach production.
 *   A. an empty CURRENT month builds the C1 payload: empty:true, the whole month, daysWithData 0, no dates or
 *      weeks, working days, the current month's comm model (no commNow), the list's agents with their month target,
 *      covered:false and EVERY figure null (never a zero), tlAgg [] / campAgg {}
 *   B. it is NOT built for a past month, a billing cycle, or without an Agent List; a month with data is unchanged
 *   C. the browser push may publish it for the current month, never files an empty history key
 *   D. tools/digest-republish.mjs: no previous-month fallback for the live key, the empty current month is published
 *      live (pointer stamped empty:true), the previous month's history key is rebuilt, and an empty payload never
 *      replaces a non-empty live month (mirror of the Worker's `empty_over_data`)
 */
import fs from 'node:fs'; import path from 'node:path'; import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (d ? ' — ' + d : '')); } };
const J = JSON.stringify;

const HTML = path.join(ROOT, 'nicks_code', 'index.html');
const SRC = fs.readFileSync(HTML, 'utf8');
const TOOL = fs.readFileSync(path.join(ROOT, 'tools', 'digest-republish.mjs'), 'utf8');
const server = http.createServer((q, s) => { const p = { '/': HTML, '/index.html': HTML, '/xlsx.full.min.js': path.join(ROOT, 'site', 'xlsx.full.min.js') }[q.url.split('?')[0]];
  if (!p || !fs.existsSync(p)) { s.writeHead(404); s.end(); return; }
  s.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' }); fs.createReadStream(p).pipe(s); });
await new Promise((r) => server.listen(8302, '127.0.0.1', r));
const { chromium } = await import(pathToFileURL(path.join(HERE, 'node_modules', 'playwright', 'index.mjs')).href);

const SEPT = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-07'];
const FIGURES = ['sales', 'gwpEx', 'pctT', 'spd', 'att', 'qa', 'aveG', 'ref', 'closed', 'leads', 'calls', 'ans', 'talk', 'aveTalk', 'act', 'emp', 'composite'];

const b = await chromium.launch();
try {
  const page = await b.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
  /* the clock: 1 October 2026, 10:00 SAST — the engine's "current month" is October */
  await page.addInitScript(() => { const R = Date; const off = R.parse('2026-10-01T08:00:00Z') - R.now();
    class D extends R { constructor(...a) { if (a.length === 0) super(R.now() + off); else super(...a); } static now() { return R.now() + off; } }
    window.Date = D; });
  await page.route(/chatterbox-agentos-api\.chatterbox-agentos\.workers\.dev/, (route) => route.abort());
  await page.goto('http://127.0.0.1:8302/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__mtd && window.__mtd.state(), null, { timeout: 30000 });

  await page.evaluate(({ SEPT }) => {
    const S = window.__mtd.state();
    S.roster = []; S.att = {}; S.calls = {}; S.sales = {}; S.tracker = {}; S.orgHist = {}; S.vici = {}; S.cancRows = {}; S.viciDays = {};
    S.evals = {}; S.board = {}; S.adjust = {}; S.refs = null; S.campaignMoves = {}; S.opencasesLM = null; S.closedcases = null; S.cmTargets = { matrix: {}, stamp: '' };
    const AG = [['CB901', 'Courtesy', 'Leader Alpha', 'M1'], ['CB902', 'Cuddle', 'Leader Beta', 'EXP'], ['CB903', 'Courtesy', 'Leader Alpha', 'M2'], ['CB904', 'VT', 'Leader Vee', 'M1']];
    for (const [code, campaign, tl, tenure] of AG) S.roster.push({ code, name: 'Empty ' + code, sf: 'Empty ' + code, tl, campaign, tenure, callx: '', target: 5, start: '2026-01-01' });
    for (const d of SEPT) { S.att[d] = {}; S.calls[d] = {}; S.sales[d] = {};
      for (const [code] of AG) { S.att[d][code] = 'P'; S.calls[d][code] = { talk: 3600, calls: 30, ans: 15, opt: 0, saleD: 0, v: 1 };
        S.sales[d][code] = { n: 1, gwp: 99, x: 86.08, u: 'case', a: { ['K' + code + d]: 86.08 } }; } }
    S.files = [{ name: 'seed', type: 'attendance', dates: SEPT, rows: 1, at: '2026-09-08 08:00' }];
    S.rosterEffect = { asOf: '2026-10-01', at: '2026-10-01 08:00', file: 'synthetic', agents: AG.length };
    S.ui.team = ''; S.ui.camp = ''; S.ui.dailyFilter = {}; S.ui.asAt = '';
  }, { SEPT });
  const digestFor = (m, mode) => page.evaluate(([m, mode]) => { window.__mtd.setPeriod(m, mode || 'calendar'); const d = window.__mtd.digest(); return d ? JSON.parse(JSON.stringify(d)) : null; }, [m, mode]);

  /* ---------------------------------------------------------------- A ---- */
  console.log('A · AN EMPTY CURRENT MONTH BUILDS THE C1 PAYLOAD');
  const e = await digestFor('2026-10');
  ok('the current month with no rows is a payload, not null', !!e);
  if (e) {
    ok('empty:true', e.empty === true);
    ok('period is the whole month', J(e.period) === J({ from: '2026-10-01', to: '2026-10-31' }), J(e.period));
    ok('daysWithData 0, dates [], weeks [], diallingDays 0', e.daysWithData === 0 && J(e.dates) === '[]' && J(e.weeks) === '[]' && e.diallingDays === 0, J([e.daysWithData, e.dates, e.weeks, e.diallingDays]));
    ok('workingDays = the calendar working days of October 2026 (22)', e.workingDays === 22, String(e.workingDays));
    const comm = await page.evaluate(() => JSON.parse(JSON.stringify(COMM_RULES_BY_MONTH['2026-10'] || COMM_RULES)));
    ok('comm is the current month\'s model', J(e.comm) === J(comm));
    ok('commNow is absent (the payload IS the current month)', !('commNow' in e));
    ok('tlAgg is [] and campAgg is {}', J(e.tlAgg) === '[]' && J(e.campAgg) === '{}');
    ok('updatedAt and dataReach are present', typeof e.updatedAt === 'string' && e.updatedAt.length > 10 && e.dataReach && typeof e.dataReach === 'object');
    const codes = e.agents.map((a) => a.code).sort();
    ok('agents = the reported-campaign agents of the list (the VT agent is not reported)', J(codes) === J(['CB901', 'CB902', 'CB903']), J(codes));
    const tm = await page.evaluate(() => MTD_RULES.salesTargetMatrix);
    const want = (camp, ten, fallback) => Math.round((tm[camp + '|' + ten] ?? tm[camp + '|*'] ?? fallback) * 22 * 100) / 100;
    const byCode = Object.fromEntries(e.agents.map((a) => [a.code, a]));
    ok('every agent carries code, name, tl, campaign, tenure, plan', e.agents.every((a) => a.code && a.name && a.tl && a.campaign && a.tenure && 'plan' in a), J(e.agents[0]));
    ok('identity is the list\'s (CB901 Courtesy / Leader Alpha / M1)', byCode.CB901 && byCode.CB901.campaign === 'Courtesy' && byCode.CB901.tl === 'Leader Alpha' && byCode.CB901.tenure === 'M1');
    ok('target is the month target the engine would use (rule-book per-day x 22 working days)',
      byCode.CB901.target === want('Courtesy', 'M1', 5) && byCode.CB902.target === want('Cuddle', 'EXP', 5), J([byCode.CB901.target, want('Courtesy', 'M1', 5), byCode.CB902.target, want('Cuddle', 'EXP', 5)]));
    ok('covered:false on every agent', e.agents.every((a) => a.covered === false));
    ok('EVERY figure is null — never a zero', e.agents.every((a) => FIGURES.every((k) => k in a && a[k] === null)), J(e.agents[0]));
    ok('days and wk are empty arrays', e.agents.every((a) => J(a.days) === '[]' && J(a.wk) === '[]'));
    ok('no number anywhere in an agent row is 0 except the target\'s own value', e.agents.every((a) => Object.entries(a).every(([k, v]) => v !== 0)), J(e.agents[0]));
  }

  /* ---------------------------------------------------------------- B ---- */
  console.log('\nB · ONLY THE CURRENT MONTH, ONLY WITH A LIST, NEVER OVER DATA');
  const past = await digestFor('2026-01');
  ok('a PAST month with no rows is still null', past === null, J(past && past.period));
  const cyc = await digestFor('2026-10', 'cycle');
  ok('a billing cycle with no rows is still null (never an "empty" cycle)', cyc === null || !cyc.empty, J(cyc && cyc.period));
  const sep = await digestFor('2026-09');
  ok('September (has data) is a normal payload: no `empty`, dates and figures present', sep && !('empty' in sep) && sep.dates.length === SEPT.length && sep.agents.some((a) => a.sales > 0), J(sep && sep.dates));
  ok('September, now the month just closed, carries commNow (the current model)', sep && sep.commNow && sep.commNow.month === '2026-10');
  await page.evaluate(() => { const S = window.__mtd.state(); window.__keepRoster = S.roster; S.roster = []; });
  const noList = await digestFor('2026-10');
  ok('no Agent List: nothing to publish (null)', noList === null, J(noList && noList.agents && noList.agents.length));
  await page.evaluate(() => { window.__mtd.state().roster = window.__keepRoster; });
  const back = await digestFor('2026-10');
  ok('the list back: the empty payload returns', back && back.empty === true && back.agents.length === 3);

  console.log('\nB2 · THE REAL PERIOD PATH (no hand-set range)');
  {
    const real = await page.evaluate(() => { window.__mtd.setPeriod('2026-10', 'calendar'); const S = window.__mtd.state(); const M = window.__mtd.model();
      return { month: S.ui.month, preset: S.ui.preset, range: M && M.range, agents: M && M.agents.length, digestEmpty: !!(window.__mtd.digest() || {}).empty }; });
    ok('setPeriod(month, calendar) makes the ENGINE build the whole-month range for October (periodRangeRaw), with no agents', real.range && real.range.from === '2026-10-01' && real.range.to === '2026-10-31' && real.agents === 0, J(real));
    ok('…and emptyMonthPayload is produced from that engine-built range', real.digestEmpty === true);
    const blank = await page.evaluate(() => { const S = window.__mtd.state(); S.ui.month = ''; S.ui.preset = 'month'; window.__mtd.rebuild(); const d = window.__mtd.digest(); return { from: d && d.period && d.period.from, empty: !!(d && d.empty) }; });
    ok('with NO month pinned the engine reads the latest DATA month (September) — why the tool pins the live month itself', blank.from === '2026-09-01' && !blank.empty, J(blank));
    await page.evaluate(() => window.__mtd.setPeriod('2026-10', 'calendar'));
  }

  /* ---------------------------------------------------------------- C ---- */
  console.log('\nC · THE BROWSER PUSH');
  const sendSrc = SRC.slice(SRC.indexOf('function send(){'), SRC.indexOf('function healStaleDigest'));
  ok('send() still refuses a period that is not a whole month', /-01\$\/\.test\(\(p\.period&&p\.period\.from\)/.test(sendSrc) && /String\(p\.period\.to\|\|''\)!==__end/.test(sendSrc));
  ok('send() posts the live key only through liveDigestMonthOk (current month; never older)', /liveDigestMonthOk\(__dm,Date\.now\(\)\)\)\s*\n\s*fetch\(API\+'\/api\/kv\?key=agent-digest'/.test(sendSrc));
  ok('an EMPTY payload never files a history key', /if\(!p\.empty&&\/\^\\d\{4\}-\\d\{2\}\$\/\.test\(__dm\)\)/.test(sendSrc));
  ok('agentDigestPayload falls back to emptyMonthPayload() for an empty model', /function agentDigestPayload\(\)\{\s*if\(!M\|\|!Array\.isArray\(M\.agents\)\|\|!M\.agents\.length\) return emptyMonthPayload\(\);/.test(SRC));

  /* ---------------------------------------------------------------- D ---- */
  console.log('\nD · tools/digest-republish.mjs');
  ok('the live key has no previous-month fallback any more', !/building the month just closed/.test(TOOL) && !/payload0 = await buildFor\(prev\)/.test(TOOL));
  ok('the live payload is built for the CURRENT month', /buildFor\(liveMonth\)/.test(TOOL));
  ok('the previous month is rebuilt and its history key written when the live month is empty', /jobs\.push\(\[prev,/.test(TOOL) && /\(final\)/.test(TOOL));
  ok('the live pointer carries empty:true for an empty payload', /empty:\s*true/.test(TOOL) && /period: String\(/.test(TOOL));
  ok('the empty payload files no history key of its own', /EMPTY-FENCE/.test(TOOL));
  const fence = (TOOL.match(/\/\*EMPTY-FENCE-BEGIN\*\/([\s\S]*?)\/\*EMPTY-FENCE-END\*\//) || [])[1];
  ok('the fence block is extractable', !!fence);
  if (fence) {
    const { emptyOverData } = new Function(fence + '\nreturn { emptyOverData };')();
    ok('empty over the SAME month holding data: refused', emptyOverData(true, '2026-10-01', { from: '2026-10-01', empty: false }) === true);
    ok('empty over the same month that is itself empty: allowed (refresh)', emptyOverData(true, '2026-10-01', { from: '2026-10-01', empty: true }) === false);
    ok('empty over the previous month (the rollover): allowed', emptyOverData(true, '2026-10-01', { from: '2026-09-01', empty: false }) === false);
    ok('empty over nothing: allowed', emptyOverData(true, '2026-10-01', { from: '', empty: false }) === false);
    ok('a non-empty payload is never refused by this fence', emptyOverData(false, '2026-10-01', { from: '2026-10-01', empty: false }) === false);
  }
  ok('the tool says WHY it did not write', /live key NOT written — an empty/.test(TOOL));
  ok('billing cycles are untouched (still published by the same loop)', /cycleBuilt\.push/.test(TOOL) && /kind: 'cycle'/.test(TOOL));

  ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
} finally { await b.close(); server.close(); }
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
