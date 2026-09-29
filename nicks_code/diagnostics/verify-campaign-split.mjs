#!/usr/bin/env node
/**
 * verify-campaign-split.mjs — a mover's month is split by the date of the move (D4, sprint 2026-09-29).
 *
 *   node nicks_code/diagnostics/verify-campaign-split.mjs
 *
 * UAT 28 Sep: CB121, CB150, CB162 and CB245 worked "Download & Test" from 1 Sep and "Courtesy" from
 * 14 Sep; CB233 moved Cuddle → Courtesy on 14 Sep. PULSE blended each mover's month under ONE campaign,
 * because an Agent List rewrites the agent's whole current month (recordOrgList) and the digest published
 * one row from one campaign (primaryAgg). Decision D4: the latest Agent List still decides the campaign
 * NOW and the TEAM LEADER (whole month, unchanged); only CAMPAIGN is split, and only for the agents the
 * Worker's /api/campaign-moves names as movers.
 *
 * Runs the REAL engine (nicks_code/index.html) headlessly over a synthetic floor — no credentials, and
 * every request to the Worker is intercepted: /api/campaign-moves is STUBBED, everything else aborted.
 *   A. the move feed: fetched with the session, stored per month, a failed fetch keeps the last copy
 *   B. the facts: each mover-day under the campaign in force that day; the team leader whole-month
 *   C. targets per campaign, per-campaign aggregates, CAMPS carries a campaign only movers worked
 *   D. the digest: one row per agent = the SUM, campaign/plan = now, segments[] for movers only
 *   E. the report blocks: each segment under its campaign, campaign blocks sum to the floor
 *   F. PULSE's own screens: one summed row with no filter, the campaign's days under the filter
 *   G. the composite group is the CURRENT campaign's; V10 and the list check do not cry wolf
 *   H. the rule book records the change
 */
import fs from 'node:fs'; import path from 'node:path'; import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (d ? ' — ' + d : '')); } };
const J = JSON.stringify;

const HTML = path.join(ROOT, 'nicks_code', 'index.html');
const SPEC = JSON.parse(fs.readFileSync(path.join(ROOT, 'specs', 'mtd_engine_rules.json'), 'utf8'));
const SERVE = { '/': HTML, '/index.html': HTML, '/xlsx.full.min.js': path.join(ROOT, 'site', 'xlsx.full.min.js') };
const server = http.createServer((q, s) => { const p = SERVE[q.url.split('?')[0]];
  if (!p || !fs.existsSync(p)) { s.writeHead(404); s.end(); return; }
  s.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' }); fs.createReadStream(p).pipe(s); });
await new Promise((r) => server.listen(8281, '127.0.0.1', r));
const { chromium } = await import(pathToFileURL(path.join(HERE, 'node_modules', 'playwright', 'index.mjs')).href);

/* THE MOVE FEED, as the Worker serves it (worker/src/moves.mjs) — only movers are listed. CB245's
   Courtesy arrives in the list's house spelling to prove it is read through campOf like every campaign. */
const DT = 'Download & Test';
const FEED = {
  '2026-09': {
    CB121: [{ from: '2026-09-01', campaign: DT, source: 'list' }, { from: '2026-09-14', campaign: 'Courtesy', source: 'list' }],
    CB150: [{ from: '2026-09-01', campaign: DT, source: 'list' }, { from: '2026-09-14', campaign: 'Courtesy', source: 'list' }],
    CB162: [{ from: '2026-09-01', campaign: DT, source: 'list' }, { from: '2026-09-14', campaign: 'Courtesy', source: 'list' }],
    CB245: [{ from: '2026-09-01', campaign: DT, source: 'list' }, { from: '2026-09-14', campaign: 'Matrix VAS - Courtesy', source: 'list' }],
    CB233: [{ from: '2026-09-01', campaign: 'Cuddle', source: 'list' }, { from: '2026-09-14', campaign: 'Courtesy', source: 'list' }],
  },
  /* CB700 moved in AUGUST — a September view must never split them */
  '2026-08': { CB700: [{ from: '2026-08-01', campaign: DT, source: 'list' }, { from: '2026-08-20', campaign: 'Courtesy', source: 'list' }] },
};
const MOVERS_DT = ['CB121', 'CB150', 'CB162', 'CB245'];
const MOVERS = [...MOVERS_DT, 'CB233'];
const PRE = ['2026-09-01', '2026-09-02', '2026-09-11'], POST = ['2026-09-14', '2026-09-15', '2026-09-16'];
const SEGKEYS = ['campaign', 'from', 'to', 'sales', 'gwpEx', 'target', 'pctT', 'act', 'emp', 'spd', 'aveG', 'plan'];

const b = await chromium.launch();
try {
  const page = await b.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
  /* THE WORKER, STUBBED. mode: 'ok' serves FEED, '500' an error, 'abort' a network failure, 'empty' a
     month with no movers. Every other Worker path is aborted, so nothing here can reach production. */
  let mode = 'ok'; const asked = [];
  await page.route(/chatterbox-agentos-api\.chatterbox-agentos\.workers\.dev/, (route) => {
    const u = new URL(route.request().url());
    if (u.pathname !== '/api/campaign-moves') return route.abort();
    asked.push({ month: u.searchParams.get('month'), auth: route.request().headers()['authorization'] || '' });
    if (mode === 'abort') return route.abort();
    if (mode === '500') return route.fulfill({ status: 502, contentType: 'application/json', body: J({ error: 'campaign moves unavailable' }) });
    const month = u.searchParams.get('month') || '';
    const agents = mode === 'empty' ? {} : (FEED[month] || {});
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: J({ month, from: month + '-01', to: month + '-30', agents, lists: [month + '-01', month + '-14'], updatedAt: '2026-09-29T08:00:00.000Z' }) });
  });
  await page.goto('http://127.0.0.1:8281/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__mtd && window.__mtd.state(), null, { timeout: 30000 });

  /* THE FLOOR. Two lists: 1 Sep (movers on Download & Test under Leader Denise, CB233 on Cuddle under
     Leader Kappa, CB600 in Nesting) and 14 Sep (all of them Courtesy under Leader Gamma). recordOrgList
     rewrites the month to the 14 Sep list, exactly as a real upload does. */
  await page.evaluate(({ PRE, POST }) => {
    const S = window.__mtd.state();
    S.roster = []; S.att = {}; S.calls = {}; S.sales = {}; S.tracker = {}; S.orgHist = {}; S.vici = {}; S.cancRows = {}; S.viciDays = {};
    S.evals = {}; S.board = {}; S.adjust = {}; S.refs = null; S.campaignMoves = {};
    S.cmTargets = { matrix: { 'Download & Test|*': 4 }, stamp: 'verify-campaign-split' };   // D&T's own per-day target
    const AG = [
      // code    latest (14 Sep)                         early (1 Sep)                           sales/day pre, post   talk post
      ['CB121', ['Courtesy', 'Leader Gamma', 'Exp'],   ['Download & Test', 'Leader Denise', 'Exp'], 1, 2, 3600],
      ['CB150', ['Courtesy', 'Leader Gamma', 'Exp'],   ['Download & Test', 'Leader Denise', 'Exp'], 2, 1, 3600],
      ['CB162', ['Courtesy', 'Leader Gamma', 'Exp'],   ['Download & Test', 'Leader Denise', 'Exp'], 1, 1, 3600],
      ['CB245', ['Courtesy', 'Leader Gamma', 'Exp'],   ['Download & Test', 'Leader Denise', 'Exp'], 3, 2, 3600],
      ['CB233', ['Courtesy', 'Leader Gamma', 'Exp'],   ['Cuddle', 'Leader Kappa', 'Exp'],           3, 0, 0],    // stops working after the move
      ['CB400', ['Courtesy', 'Leader Gamma', 'Exp'],   null, 2, 2, 3600],
      ['CB401', ['Courtesy', 'Leader Gamma', 'Exp'],   null, 1, 1, 3600],
      ['CB402', ['Courtesy', 'Leader Delta', 'Exp'],   null, 3, 3, 3600],
      ['CB500', ['Cuddle', 'Leader Kappa', 'Exp'],     null, 4, 4, 3600],
      ['CB501', ['Cuddle', 'Leader Kappa', 'Exp'],     null, 5, 5, 3600],
      ['CB600', ['Courtesy', 'Leader Gamma', 'M1'],    ['Nesting', 'Leader Nest', 'M1'],            1, 1, 3600], // a graduate: the Worker never names it
      ['CB700', ['Courtesy', 'Leader Gamma', 'Exp'],   null, 1, 2, 3600],                                        // moved in AUGUST only
    ];
    for (const [code, now] of AG) S.roster.push({ code, name: 'Split ' + code, sf: 'Split ' + code, tl: now[1], campaign: now[0], tenure: now[2], callx: '', target: 5, start: '2026-01-01' });
    for (const [code, now, early] of AG) {
      recordOrgList(code, '2026-09-01', early ? { campaign: early[0], tl: early[1], tenure: early[2] } : { campaign: now[0], tl: now[1], tenure: now[2] });
      recordOrgList(code, '2026-09-14', { campaign: now[0], tl: now[1], tenure: now[2] });
    }
    const exOf = (code, d) => (/^CB(121|150|162|245)$/.test(code) && d < '2026-09-14') ? 34.78 : 86.08;   // D&T sells the R40 product
    for (const d of [...PRE, ...POST]) {
      S.att[d] = {}; S.calls[d] = {}; S.sales[d] = {};
      for (const [code, , , pre, post, talkPost] of AG) {
        const isPre = d < '2026-09-14', n = isPre ? pre : post, talk = isPre ? 3600 : talkPost;
        S.att[d][code] = 'P';
        S.calls[d][code] = { talk, calls: talk ? 30 : 0, ans: talk ? 15 : 0, opt: 0, saleD: 0, v: 1 };
        /* case-grain, like a real BI ingest: one unit per sale, so the Variance Report (which reads the units) sees them too */
        if (n) { const x = Math.round(exOf(code, d) * n * 100) / 100;
          S.sales[d][code] = { n, gwp: Math.round(x * 1.15), x, u: 'case', a: Object.fromEntries(Array.from({ length: n }, (_, i) => ['K' + code + d + i, exOf(code, d)])) }; }
      }
    }
    S.rosterEffect = { asOf: '2026-09-14', at: '2026-09-14 08:00', file: 'synthetic', agents: AG.length };
    S.ui.team = ''; S.ui.camp = ''; S.ui.dailyFilter = {};
    window.__mtd.setPeriod('2026-09', 'month');
  }, { PRE, POST });

  /* snapshot helpers, in the page */
  const SNAP = `(function(){
    const M = window.__mtd.model(); const S = window.__mtd.state();
    const facts = {}; for (const f of M.facts) { if (f.rangeAgg) continue; (facts[f.code] = facts[f.code] || {})[f.date] = { camp: f.campaign, tl: f.tl, target: f.target, sales: f.sales, emp: f.emp, act: f.act, gwpEx: f.gwpEx }; }
    const mtd = {}; for (const c of Object.keys(M.mtdCC)) for (const code of Object.keys(M.mtdCC[c])) { const g = M.mtdCC[c][code];
      (mtd[code] = mtd[code] || {})[c] = { sales: g.sales, target: g.target, gwpEx: g.gwpEx, emp: g.emp, act: g.act, pctT: g.pctT }; }
    const d = window.__mtd.digest();
    return { camps: CAMPS.slice(), facts, mtd, digest: d,
      campAgg: Object.fromEntries(Object.entries(M.campAgg).map(([k, o]) => [k, { sales: o.sales, gwpEx: o.gwpEx, target: o.target, emp: o.emp, act: o.act, hc: o.hc }])),
      tlAgg: Object.fromEntries(Object.entries(M.tlAgg).map(([k, o]) => [k, { sales: o.sales, gwpEx: o.gwpEx, target: o.target, hc: o.hc }])),
      grand: { sales: M.grand.sales, gwpEx: M.grand.gwpEx, target: M.grand.target, emp: M.grand.emp, act: M.grand.act },
      checks: (window.__mtd.checks() || []).filter((c) => /^V(09|10)$/.test(c.id)).map((c) => ({ id: c.id, ok: c.ok, msg: c.msg })),
      listBad: ((window.__listCheck || {}).bad || []).map((x) => x.code) };
  })()`;

  /* ------------------------------------------------------------------ A. the move feed ---- */
  console.log('\nA · THE MOVE FEED: FETCHED, STORED, NEVER DROPPED ON A FAILURE');
  const hasSync = await page.evaluate(() => !!(window.__mtd && typeof window.__mtd.syncMoves === 'function'));
  ok('PULSE exposes the move sync to the harness (window.__mtd.syncMoves)', hasSync);
  const noMoves = await page.evaluate(SNAP);                      // the engine before any feed: today's behaviour
  await page.evaluate(() => { sessionStorage.setItem('cbx_token', 'verify-campaign-split'); window.__vasHydrated = true; });
  const sync = async () => page.evaluate(async () => { try { if (window.__mtd.syncMoves) await window.__mtd.syncMoves(); } catch (e) { return String(e && e.message || e); } return ''; });
  mode = 'ok'; const syncErr = await sync();
  const stored = await page.evaluate(() => JSON.parse(JSON.stringify((window.__mtd.state().campaignMoves) || null)));
  const sepStore = stored && stored['2026-09'];
  ok('the sync ran without throwing', !syncErr, syncErr);
  ok('it asked the Worker for the period\'s month (2026-09) with the management session', asked.some((q) => q.month === '2026-09' && q.auth === 'Bearer verify-campaign-split'), J(asked));
  ok('S.campaignMoves["2026-09"] holds exactly the five movers', sepStore && sepStore.agents && J(Object.keys(sepStore.agents).sort()) === J(MOVERS.slice().sort()), J(sepStore));
  ok('…each with its dated segments in order', sepStore && sepStore.agents && sepStore.agents.CB121 && sepStore.agents.CB121.length === 2
    && sepStore.agents.CB121[0].from === '2026-09-01' && sepStore.agents.CB121[1].from === '2026-09-14', J(sepStore && sepStore.agents && sepStore.agents.CB121));
  const withMoves = await page.evaluate(SNAP);
  for (const m of ['500', 'abort']) {
    mode = m; await sync();
    const after = await page.evaluate(() => JSON.stringify(((window.__mtd.state().campaignMoves) || {})['2026-09'] || null));
    ok('a ' + (m === '500' ? 'Worker error (502)' : 'network failure') + ' keeps the last copy — never "no moves"', J(sepStore) === after, after.slice(0, 160));
  }
  { const again = await page.evaluate(SNAP);
    ok('…and the model still splits after the failed fetches', J(again.facts.CB121) === J(withMoves.facts.CB121), J(again.facts.CB121)); }
  mode = 'ok';

  /* ------------------------------------------------------------------ B. the facts ---- */
  console.log('\nB · THE FACTS: EACH MOVER-DAY UNDER THE CAMPAIGN IN FORCE THAT DAY');
  const F = withMoves.facts;
  for (const c of MOVERS) {
    const early = c === 'CB233' ? 'Cuddle' : DT;
    ok(c + ': every day before 14 Sep lands in ' + early, PRE.every((d) => F[c] && F[c][d] && F[c][d].camp === early), J(F[c]));
    ok(c + ': every day from 14 Sep lands in Courtesy', POST.every((d) => F[c] && F[c][d] && F[c][d].camp === 'Courtesy'), J(F[c]));
    ok(c + ': the team leader is the latest list\'s (Leader Gamma) for the WHOLE month', F[c] && Object.values(F[c]).every((x) => x.tl === 'Leader Gamma'), J(F[c] && Object.values(F[c]).map((x) => x.tl)));
  }
  ok('without the feed every mover-day read Courtesy (the blend this change fixes)', MOVERS.every((c) => Object.values(noMoves.facts[c] || {}).every((x) => x.camp === 'Courtesy')), J(noMoves.facts.CB121));
  ok('CB600 (a Nesting graduate the Worker never names) is NOT split — the whole month is Courtesy', Object.values(F.CB600 || {}).every((x) => x.camp === 'Courtesy') && Object.keys(F.CB600 || {}).length === 6, J(F.CB600));
  ok('CB700 (a move in AUGUST) is NOT split in September', Object.values(F.CB700 || {}).every((x) => x.camp === 'Courtesy') && Object.keys(F.CB700 || {}).length === 6, J(F.CB700));
  for (const c of ['CB400', 'CB401', 'CB402', 'CB500', 'CB501', 'CB600', 'CB700'])
    ok(c + ' (non-mover): every fact byte-identical to the no-feed run', J(F[c]) === J(noMoves.facts[c]));

  /* ------------------------------------------------------------------ C. targets + aggregates ---- */
  console.log('\nC · TARGETS PER CAMPAIGN, PER-CAMPAIGN AGGREGATES, CAMPS');
  ok('a Download & Test day carries D&T\'s per-day target (4, the campaign override)', PRE.every((d) => F.CB121[d].target === 4), J(PRE.map((d) => F.CB121[d].target)));
  ok('a Courtesy day carries Courtesy|Exp (5)', POST.every((d) => F.CB121[d].target === 5), J(POST.map((d) => F.CB121[d].target)));
  ok('CB233\'s Cuddle days carry Cuddle|Exp (8)', PRE.every((d) => F.CB233[d].target === 8), J(PRE.map((d) => F.CB233[d].target)));
  ok('CAMPS carries Download & Test for September though no agent on the current list is on it', withMoves.camps.includes(DT), J(withMoves.camps));
  ok('…and did not without the feed (the list alone no longer carries it)', !noMoves.camps.includes(DT), J(noMoves.camps));
  { const m = withMoves.mtd.CB121 || {};
    ok('mtdCC[Download & Test][CB121] = the D&T days: 3 sales, target 12', m[DT] && m[DT].sales === 3 && m[DT].target === 12 && m[DT].emp === 3, J(m[DT]));
    ok('mtdCC[Courtesy][CB121] = the Courtesy days: 6 sales, target 15', m.Courtesy && m.Courtesy.sales === 6 && m.Courtesy.target === 15, J(m.Courtesy)); }
  { const m = withMoves.mtd.CB233 || {};
    ok('mtdCC[Cuddle][CB233] = 9 sales over target 24; mtdCC[Courtesy][CB233] = 0 over 15', m.Cuddle && m.Cuddle.sales === 9 && m.Cuddle.target === 24 && m.Courtesy && m.Courtesy.sales === 0 && m.Courtesy.target === 15, J(m)); }

  /* ------------------------------------------------------------------ D. the digest ---- */
  console.log('\nD · THE DIGEST: ONE ROW PER AGENT, THE SUM; SEGMENTS FOR MOVERS ONLY');
  const rowOf = (dg, c) => ((dg && dg.agents) || []).find((a) => a.code === c) || null;
  const near = (a, b, t = 0.011) => a != null && b != null && Math.abs(a - b) <= t;
  for (const c of MOVERS) {
    const r = rowOf(withMoves.digest, c), n0 = rowOf(noMoves.digest, c);
    const early = c === 'CB233' ? 'Cuddle' : DT;
    const cc = withMoves.mtd[c] || {};
    ok(c + ': one digest row', (withMoves.digest.agents || []).filter((a) => a.code === c).length === 1);
    ok(c + ': campaign = the campaign the latest list names now (Courtesy)', r && r.campaign === 'Courtesy', r && r.campaign);
    ok(c + ': plan = commPlanOf(Courtesy, Exp) = EXP_COURTESY', r && r.plan === 'EXP_COURTESY', r && r.plan);
    ok(c + ': the row is the SUM over both campaigns (sales, target, emp, act)', r && cc[early] && cc.Courtesy
      && r.sales === cc[early].sales + cc.Courtesy.sales && near(r.target, cc[early].target + cc.Courtesy.target) && near(r.emp, cc[early].emp + cc.Courtesy.emp) && near(r.act, cc[early].act + cc.Courtesy.act),
      J([r && { s: r.sales, t: r.target, e: r.emp, a: r.act }, cc]));
    ok(c + ': gwpEx = the sum, and equals the whole month the blended row carried', r && n0 && cc[early] && cc.Courtesy && near(r.gwpEx, cc[early].gwpEx + cc.Courtesy.gwpEx) && near(r.gwpEx, n0.gwpEx) && r.sales === n0.sales, J([r && r.gwpEx, n0 && n0.gwpEx]));
    const sg = r && r.segments;
    ok(c + ': segments[] has two entries ordered by from', Array.isArray(sg) && sg.length === 2 && sg[0].from < sg[1].from, J(sg));
    ok(c + ': each segment has exactly {' + SEGKEYS.join(', ') + '}', Array.isArray(sg) && sg.every((s) => J(Object.keys(s)) === J(SEGKEYS)), J(sg && sg.map((s) => Object.keys(s))));
    if (Array.isArray(sg) && sg.length === 2 && cc[early] && cc.Courtesy) {
      const [a, z] = sg;
      ok(c + ': segment 1 = ' + early + ' 2026-09-01 → 2026-09-13', a.campaign === early && a.from === '2026-09-01' && a.to === '2026-09-13', J(a));
      ok(c + ': segment 2 = Courtesy 2026-09-14 → 2026-09-16 (clipped to the last data day)', z.campaign === 'Courtesy' && z.from === '2026-09-14' && z.to === '2026-09-16', J(z));
      ok(c + ': segment figures are that campaign\'s days (sales/target/emp/act/gwpEx/pctT)', a.sales === cc[early].sales && near(a.target, cc[early].target) && near(a.emp, cc[early].emp) && near(a.act, cc[early].act) && near(a.gwpEx, cc[early].gwpEx)
        && z.sales === cc.Courtesy.sales && near(z.target, cc.Courtesy.target) && near(z.gwpEx, cc.Courtesy.gwpEx)
        && (cc[early].pctT == null ? a.pctT == null : near(a.pctT, cc[early].pctT, 1e-4)), J([a, cc[early]]));
      ok(c + ': segments sum to the row (sales, target, emp, act, gwpEx)', a.sales + z.sales === r.sales && near(a.target + z.target, r.target) && near(a.emp + z.emp, r.emp) && near(a.act + z.act, r.act) && near(a.gwpEx + z.gwpEx, r.gwpEx, 0.02), J([a, z, r.sales]));
      ok(c + ': each segment carries its own plan', a.plan === (c === 'CB233' ? 'EXP_CUDDLE' : 'EXP_DOWNUP') && z.plan === 'EXP_COURTESY', J([a.plan, z.plan]));
      ok(c + ': spd and aveG are the segment\'s own (sales ÷ act, gwpEx ÷ sales)', near(a.spd, a.act ? a.sales / a.act : 0, 1e-4) && (a.sales ? near(a.aveG, a.gwpEx / a.sales, 0.011) : a.aveG == null), J(a));
    }
  }
  ok('the team leader on every mover row is the latest list\'s (whole month)', MOVERS.every((c) => (rowOf(withMoves.digest, c) || {}).tl === 'Leader Gamma'), J(MOVERS.map((c) => (rowOf(withMoves.digest, c) || {}).tl)));
  for (const c of ['CB400', 'CB401', 'CB402', 'CB500', 'CB501', 'CB600', 'CB700']) {
    const r = rowOf(withMoves.digest, c), r0 = rowOf(noMoves.digest, c);
    ok(c + ' (non-mover): no segments key', r && !('segments' in r), r && Object.keys(r).join(','));
    ok(c + ' (non-mover): the digest row is byte-identical to the no-feed run', r && r0 && J(r) === J(r0), J(r).slice(0, 200) + ' vs ' + J(r0).slice(0, 200));
  }

  /* ------------------------------------------------------------------ E. the report blocks ---- */
  console.log('\nE · THE REPORT BLOCKS: EACH SEGMENT UNDER ITS CAMPAIGN, NO DOUBLE COUNT');
  { const t = withMoves.digest.tlAgg || [];
    const dtg = t.find((x) => x.camp === DT && x.tl === 'Leader Gamma');
    ok('tlAgg carries a Download & Test | Leader Gamma block of the movers\' D&T days (4 agents, 21 sales)', dtg && dtg.hc === 4 && dtg.sales === 21, J(dtg));
    const cug = t.find((x) => x.camp === 'Cuddle' && x.tl === 'Leader Gamma');
    ok('CB233\'s Cuddle days sit under Cuddle | Leader Gamma (the list\'s leader, whole month)', cug && cug.hc === 1 && cug.sales === 9, J(cug));
    const sumT = t.reduce((s, x) => s + x.sales, 0);
    ok('Σ tlAgg sales = the floor total (' + withMoves.grand.sales + ')', sumT === withMoves.grand.sales, sumT + ' vs ' + withMoves.grand.sales);
    const ca = withMoves.digest.campAgg || {};
    const sumC = Object.values(ca).reduce((s, x) => s + x.sales, 0), sumCT = Object.values(ca).reduce((s, x) => s + x.target, 0);
    ok('Σ campAgg sales and targets = the floor total (no double count)', sumC === withMoves.grand.sales && near(sumCT, withMoves.grand.target), J([sumC, sumCT, withMoves.grand]));
    ok('campAgg[Download & Test] = 21 sales, target 48 (4 agents × 3 days × 4)', ca[DT] && ca[DT].sales === 21 && ca[DT].target === 48 && ca[DT].hc === 4, J(ca[DT])); }
  { /* the per-campaign reading of the digest ROWS, the way a consumer must do it: segment figures where
       a row has them, the whole row where it does not — every campaign equals the engine's own block */
    const rows = withMoves.digest.agents || [];
    const byCamp = {}; let total = 0;
    for (const r of rows) { total += r.sales;
      if (Array.isArray(r.segments)) for (const s of r.segments) byCamp[s.campaign] = (byCamp[s.campaign] || 0) + s.sales;
      else byCamp[r.campaign] = (byCamp[r.campaign] || 0) + r.sales; }
    const ca = withMoves.digest.campAgg || {};
    ok('digest rows read per campaign (segments where present) equal every campaign block', Object.keys(ca).every((c) => (byCamp[c] || 0) === ca[c].sales) && Object.keys(byCamp).every((c) => ca[c]), J([byCamp, Object.fromEntries(Object.entries(ca).map(([k, v]) => [k, v.sales]))]));
    ok('…and Σ over campaigns = Σ rows = the floor (a mover counted once per campaign, never twice)', Object.values(byCamp).reduce((s, v) => s + v, 0) === total && total === withMoves.grand.sales, J([byCamp, total, withMoves.grand.sales])); }
  { const vr = await page.evaluate(() => { const VR = window.__mtd.variance(); const P = window.__mtd.reports('variance');
      const pick = (c, d) => { const r = (VR.rows || []).find((x) => x.code === c && x.d === d); return r ? { camp: r.camp, tl: r.tl } : null; };
      return { a: pick('CB121', '2026-09-01'), z: pick('CB121', '2026-09-14'), k: pick('CB233', '2026-09-02'), n: (VR.rows || []).filter((r) => r.camp !== 'VT').length,
        camps: P ? Object.fromEntries(Object.entries(P.campaigns || {}).map(([k, v]) => [k, v.rows])) : null }; });
    ok('the Variance Report files CB121\'s 1 Sep under Download & Test and 14 Sep under Courtesy', vr.a && vr.a.camp === DT && vr.z && vr.z.camp === 'Courtesy', J(vr));
    ok('…and CB233\'s 2 Sep under Cuddle, the team leader whole-month', vr.k && vr.k.camp === 'Cuddle' && vr.k.tl === 'Leader Gamma' && vr.a.tl === 'Leader Gamma', J(vr));
    ok('the team-leader variance payload\'s campaign blocks sum to every row once', vr.camps && Object.values(vr.camps).reduce((s, v) => s + v, 0) === vr.n && vr.camps[DT] > 0, J(vr)); }

  /* ------------------------------------------------------------------ F. PULSE's screens ---- */
  console.log('\nF · PULSE\'S OWN SCREENS: ONE SUMMED ROW, OR THE CAMPAIGN\'S DAYS UNDER THE FILTER');
  const view = await page.evaluate(async ({ DT }) => {
    const S = window.__mtd.state();
    const pa = (c) => { const g = primaryAgg(c); return g ? { sales: g.sales, target: g.target, gwpEx: Math.round(g.gwpEx * 100) / 100 } : null; };
    const agentsRow = async (camp, code) => { S.ui.tab = 'agents'; S.ui.camp = camp; S.ui.team = ''; S.ui.agentQ = ''; S.ui.risk = '';
      renderPage(); await new Promise((r) => setTimeout(r, 350));
      const trs = [...document.querySelectorAll('#view tbody tr')].filter((tr) => tr.innerText.includes(code));
      return trs.map((tr) => { const td = tr.querySelectorAll('td'); return { sales: td[3] ? td[3].innerText.trim() : '', label: td[0] ? td[0].innerText.replace(/\s+/g, ' ') : '' }; }); };
    S.ui.camp = ''; const all = { CB121: pa('CB121'), CB233: pa('CB233'), CB400: pa('CB400') };
    S.ui.camp = DT; const dt = { CB121: pa('CB121'), CB400: pa('CB400') };
    S.ui.camp = 'Courtesy'; const co = { CB121: pa('CB121'), CB400: pa('CB400') };
    S.ui.camp = 'Cuddle'; const cu = { CB233: pa('CB233') };
    const rAll = await agentsRow('', 'CB121'), rDT = await agentsRow(DT, 'CB121'), rCo = await agentsRow('Courtesy', 'CB121'), rCu = await agentsRow('Cuddle', 'CB121');
    const r400 = await agentsRow('', 'CB400');
    S.ui.camp = ''; S.ui.tab = 'dashboard';
    return { all, dt, co, cu, rAll, rDT, rCo, rCu, r400 };
  }, { DT });
  ok('no filter: primaryAgg(CB121) is the SUM (9 sales, target 27)', view.all.CB121 && view.all.CB121.sales === 9 && view.all.CB121.target === 27, J(view.all.CB121));
  ok('Campaign = Download & Test: primaryAgg(CB121) is its D&T days (3 sales, target 12)', view.dt.CB121 && view.dt.CB121.sales === 3 && view.dt.CB121.target === 12, J(view.dt.CB121));
  ok('Campaign = Courtesy: primaryAgg(CB121) is its Courtesy days (6 sales, target 15)', view.co.CB121 && view.co.CB121.sales === 6 && view.co.CB121.target === 15, J(view.co.CB121));
  ok('Campaign = Cuddle: primaryAgg(CB233) is its Cuddle days (9 sales, target 24)', view.cu.CB233 && view.cu.CB233.sales === 9 && view.cu.CB233.target === 24, J(view.cu.CB233));
  ok('a non-mover\'s primaryAgg is the same under every filter (unchanged behaviour)', J(view.all.CB400) === J(view.dt.CB400) && J(view.all.CB400) === J(view.co.CB400), J([view.all.CB400, view.dt.CB400]));
  ok('Agent performance, no filter: CB121 is ONE row with 9 sales', view.rAll.length === 1 && view.rAll[0].sales === '9', J(view.rAll));
  ok('…and it is labelled with the campaign the list names now (Courtesy)', view.rAll.length === 1 && /CB121 · Courtesy/.test(view.rAll[0].label), J(view.rAll));
  ok('Agent performance, Campaign = Download & Test: CB121 shows 3 sales, labelled Download & Test', view.rDT.length === 1 && view.rDT[0].sales === '3' && /CB121 · Download & Test/.test(view.rDT[0].label), J(view.rDT));
  ok('Agent performance, Campaign = Courtesy: CB121 shows 6 sales', view.rCo.length === 1 && view.rCo[0].sales === '6', J(view.rCo));
  ok('Agent performance, Campaign = Cuddle: CB121 is not there (never worked Cuddle)', view.rCu.length === 0, J(view.rCu));

  /* ------------------------------------------------------------------ G. composite, V10, list check ---- */
  console.log('\nG · THE COMPOSITE GROUP IS THE CURRENT CAMPAIGN\'S; THE RULE CHECKS STAY QUIET');
  const g = await page.evaluate(() => { const c = window.__mtd.composite('CB233'); const exp = tenureGroupOf('Exp', 'Courtesy');
    return { group: c && c.group, want: exp && exp.label, windowTo: c && c.windowTo, dCamp: ((window.__mtd.digest().agents || []).find((a) => a.code === 'CB233') || {}).composite }; });
  ok('CB233\'s last worked session is a CUDDLE day (11 Sep) — the case that used to pick the old group', g.windowTo === '2026-09-11', J(g.windowTo));
  ok('…yet its composite is rated in the CURRENT group (' + g.want + ')', g.group && g.group === g.want, J([g.group, g.want]));
  ok('…and the digest publishes that same group', g.dCamp && g.dCamp.group === g.want, J(g.dCamp && g.dCamp.group));
  { const v09 = withMoves.checks.find((c) => c.id === 'V09'), v10 = withMoves.checks.find((c) => c.id === 'V10');
    ok('V09 passes: no agent-day is in two campaigns', v09 && v09.ok, J(v09));
    ok('V10 passes: a Worker-named Cuddle → Courtesy mover is not an overlap error', v10 && v10.ok, J(v10)); }
  ok('the "list took effect" check does not name any mover', withMoves.listBad.every((c) => !MOVERS.includes(c)), J(withMoves.listBad));

  /* ------------------------------------------------------------------ A2. an empty month replaces ---- */
  mode = 'empty'; await sync();
  { const after = await page.evaluate(() => { const m = ((window.__mtd.state().campaignMoves) || {})['2026-09']; return m && m.agents ? Object.keys(m.agents).length : -1; });
    ok('a SUCCESSFUL answer with no movers does replace the copy (only a failure keeps it)', after === 0, String(after));
    const f = await page.evaluate(SNAP);
    ok('…and the month reads whole again, exactly as before the feed', J(f.facts.CB121) === J(noMoves.facts.CB121), J(f.facts.CB121)); }
  mode = 'ok';

  /* ------------------------------------------------------------------ H. the rule book ---- */
  console.log('\nH · THE RULE BOOK RECORDS THE CHANGE');
  const ch = (SPEC._changes || []).find((c) => c.date === '2026-09-29' && /campaign/i.test(J(c)) && /mover|move/i.test(J(c)) && /D4/.test(J(c)));
  ok('specs/mtd_engine_rules.json carries a dated 2026-09-29 _changes[] entry for D4', !!ch, '');
  ok('…by "Aarav for Nick (D4, Nick to confirm)"', ch && ch.by === 'Aarav for Nick (D4, Nick to confirm)', J(ch && ch.by));
  ok('…saying the team leader is unchanged and the overall row is the sum', ch && /team leader/i.test(J(ch)) && /sum/i.test(J(ch)), String(J(ch)).slice(0, 200));
  ok('no page errors', errs.length === 0, errs.join(' | '));
} finally {
  await b.close(); server.close();
}

console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
process.exitCode = fail ? 1 : 0;
