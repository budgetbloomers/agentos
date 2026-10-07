#!/usr/bin/env node
/**
 * verify-cm-digest.mjs — the engine + publisher half of spec 001-cm-view-signoff (contract C1).
 *
 *   node nicks_code/diagnostics/verify-cm-digest.mjs
 *
 * Runs the REAL engine (nicks_code/index.html) headlessly over a synthetic floor — no credentials, every
 * request to the Worker is aborted, nothing can reach production.
 *   A. `closed` per agent = the lead book's tc (any status, "no feedback" included); null without a closed
 *      case book — never 0 for "unknown"; `leads` untouched
 *   B. a month payload is unchanged (no period.kind)
 *   C. a BILLING-CYCLE payload (26 Aug – 25 Sep) is whole: period.kind 'cycle', dates/weeks inside the range,
 *      working days, the comm model keyed on the cycle's END month, a mover's segments across both months
 *   D. MTD_RULES.leadReportExcludeCampaigns = the spec's value (and a dated _changes[] entry)
 *   E. Courtesy is out of the Lead management REPORT (PULSE page + agent-reports-leads) — and only there
 *   F. tools/digest-republish.mjs publishes the cycle keys, only under --apply, never the live key
 *   C2. (spec 006) a CUSTOM-RANGE payload (setRange) carries exactly the range's days; so do its reports
 *   G. (spec 006) the tool's RANGE-JOBS block: kv:cm-range-requests → waiting + filling jobs → setRange → digest + both
 *      reports + pointer kind 'range' → {status:'built'|'refused'} back by compare-and-set; islands, --apply only
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
const TOOL = fs.readFileSync(path.join(ROOT, 'tools', 'digest-republish.mjs'), 'utf8');
const SERVE = { '/': HTML, '/index.html': HTML, '/xlsx.full.min.js': path.join(ROOT, 'site', 'xlsx.full.min.js') };
const server = http.createServer((q, s) => { const p = SERVE[q.url.split('?')[0]];
  if (!p || !fs.existsSync(p)) { s.writeHead(404); s.end(); return; }
  s.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' }); fs.createReadStream(p).pipe(s); });
await new Promise((r) => server.listen(8293, '127.0.0.1', r));
const { chromium } = await import(pathToFileURL(path.join(HERE, 'node_modules', 'playwright', 'index.mjs')).href);

const DT = 'Download & Test';
const DAYS = ['2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28', '2026-08-31', '2026-09-01', '2026-09-02', '2026-09-14', '2026-09-28', '2026-10-01'];
const IN_CYCLE = DAYS.filter((d) => d >= '2026-08-26' && d <= '2026-09-25');

const b = await chromium.launch();
try {
  const page = await b.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
  await page.route(/chatterbox-agentos-api\.chatterbox-agentos\.workers\.dev/, (route) => route.abort());
  await page.goto('http://127.0.0.1:8293/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__mtd && window.__mtd.state(), null, { timeout: 30000 });

  /* THE FLOOR. CB121 moved Download & Test -> Courtesy on 28 Aug (August feed); CB233 Cuddle -> Courtesy on
     14 Sep (September feed); CB400/402 Courtesy, CB500/501 Cuddle, CB502 Cuddle under a MIXED leader. */
  await page.evaluate(({ DAYS, DT }) => {
    const S = window.__mtd.state();
    S.roster = []; S.att = {}; S.calls = {}; S.sales = {}; S.tracker = {}; S.orgHist = {}; S.vici = {}; S.cancRows = {}; S.viciDays = {};
    S.evals = {}; S.board = {}; S.adjust = {}; S.refs = null; S.campaignMoves = {}; S.opencasesLM = null; S.closedcases = null;
    S.cmTargets = { matrix: { 'Download & Test|*': 4 }, stamp: 'verify-cm-digest' };
    const AG = [
      ['CB121', ['Courtesy', 'Leader Gamma', 'Exp'], ['Download & Test', 'Leader Denise', 'Exp']],
      ['CB233', ['Courtesy', 'Leader Gamma', 'Exp'], ['Cuddle', 'Leader Kappa', 'Exp']],
      ['CB400', ['Courtesy', 'Leader Gamma', 'Exp'], null],
      ['CB402', ['Courtesy', 'Leader Mix', 'Exp'], null],
      ['CB500', ['Cuddle', 'Leader Kappa', 'Exp'], null],
      ['CB501', ['Cuddle', 'Leader Kappa', 'Exp'], null],
      ['CB502', ['Cuddle', 'Leader Mix', 'Exp'], null],
    ];
    for (const [code, now] of AG) S.roster.push({ code, name: 'Split ' + code, sf: 'Split ' + code, tl: now[1], campaign: now[0], tenure: now[2], callx: '', target: 5, start: '2026-01-01' });
    for (const [code, now, early] of AG) {
      const e = early || now;
      recordOrgList(code, '2026-08-01', { campaign: e[0], tl: e[1], tenure: e[2] });
      recordOrgList(code, '2026-09-01', { campaign: e[0], tl: early && code === 'CB121' ? now[1] : e[1], tenure: e[2] });
      if (code === 'CB121') recordOrgList(code, '2026-09-01', { campaign: now[0], tl: now[1], tenure: now[2] });
      if (code === 'CB233') recordOrgList(code, '2026-09-14', { campaign: now[0], tl: now[1], tenure: now[2] });
    }
    for (const d of DAYS) {
      S.att[d] = {}; S.calls[d] = {}; S.sales[d] = {};
      for (const [code] of AG) {
        S.att[d][code] = 'P';
        S.calls[d][code] = { talk: 3600, calls: 30, ans: 15, opt: 0, saleD: 0, v: 1 };
        S.sales[d][code] = { n: 1, gwp: 99, x: 86.08, u: 'case', a: { ['K' + code + d]: 86.08 } };
      }
    }
    S.rosterEffect = { asOf: '2026-09-14', at: '2026-09-14 08:00', file: 'synthetic', agents: AG.length };
    S.campaignMoves = {
      '2026-08': { agents: { CB121: [{ from: '2026-08-01', campaign: DT, source: 'list' }, { from: '2026-08-28', campaign: 'Courtesy', source: 'list' }] }, at: '2026-09-29T08:00:00.000Z' },
      '2026-09': { agents: { CB233: [{ from: '2026-09-01', campaign: 'Cuddle', source: 'list' }, { from: '2026-09-14', campaign: 'Courtesy', source: 'list' }] }, at: '2026-09-29T08:00:00.000Z' },
    };
    S.ui.team = ''; S.ui.camp = ''; S.ui.dailyFilter = {};
  }, { DAYS, DT });

  /* the case books (a case book is loaded or it is not — setBooks(false) takes both away) */
  const setBooks = (mode) => page.evaluate((mode) => {
    const S = window.__mtd.state();
    const open = (k, owner, status) => ({ k, owner, status });
    S.opencasesLM = (mode === 'open' || mode === 'both') ? { rows: [
      open('O1', 'CB400', '1st attempt'), open('O2', 'CB400', 'New'), open('O3', 'CB402', '2nd attempt'),
      open('O4', 'CB500', '3rd attempt'), open('O5', 'CB121', 'New'), open('O6', 'CB502', 'New')],
      snapshot: 'verify', at: '', total: 6, queues: 0 } : null;
    const cl = (d, owner, status) => ({ d, owner, status });
    const rows = { C1: cl('2026-09-02', 'CB400', 'Closed - Sale'), C2: cl('2026-09-03', 'CB400', 'Closed - No feedback'), C3: cl('2026-09-14', 'CB400', 'Closed'),
      C4: cl('2026-08-28', 'CB400', 'Closed'), C5: cl('2026-08-20', 'CB400', 'Closed'),
      C6: cl('2026-09-02', 'CB500', 'Closed'), C7: cl('2026-09-05', 'CB500', 'Closed - No feedback'), C8: cl('2026-09-02', 'CB121', 'Closed'),
      C9: cl('2026-09-02', 'CB502', 'Closed') };
    S.closedcases = (mode === 'closed' || mode === 'both') ? { rows, f: 'verify', at: '', n: Object.keys(rows).length } : null;
    window.__mtd.rebuild();
  }, mode);
  const digestOf = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__mtd.digest())));
  const rowOf = (dg, c) => ((dg && dg.agents) || []).find((a) => a.code === c) || null;

  /* ---------------------------------------------------------------- A. closed ---- */
  console.log('\nA · `closed` PER AGENT = THE LEAD BOOK\'S tc; NULL WITHOUT A CASE BOOK');
  await page.evaluate(() => window.__mtd.setPeriod('2026-09', 'month'));
  await setBooks('both');
  const tc = await page.evaluate(() => { const A = window.__mtd.leads().A; return Object.fromEntries(Object.keys(A).map((k) => [k, { tc: A[k].tc, leads: A[k].leads.size }])); });
  const dg = await digestOf();
  ok('every digest row carries a `closed` field', dg.agents.length === 7 && dg.agents.every((a) => 'closed' in a), J(dg.agents.map((a) => a.closed)));
  ok('closed equals the lead book\'s tc for every agent', dg.agents.every((a) => a.closed === tc[a.code].tc), J(dg.agents.map((a) => [a.code, a.closed, tc[a.code].tc])));
  ok('CB400: 3 closed in September — the "no feedback" one counts, the August ones do not', rowOf(dg, 'CB400').closed === 3, String(rowOf(dg, 'CB400').closed));
  ok('CB402 has open cases only: closed is 0 (the book IS loaded), not null', rowOf(dg, 'CB402').closed === 0, String(rowOf(dg, 'CB402').closed));
  ok('`leads` is unchanged: CB400 = 2 open + 3 closed unique cases', rowOf(dg, 'CB400').leads === tc.CB400.leads && rowOf(dg, 'CB400').leads === 5, String(rowOf(dg, 'CB400').leads));
  ok('a Courtesy mover still counts closed and leads (the report rule never reaches the digest)', rowOf(dg, 'CB121').closed === 1 && rowOf(dg, 'CB121').leads === 2, J([rowOf(dg, 'CB121').closed, rowOf(dg, 'CB121').leads]));
  await setBooks('none');
  { const d0 = await digestOf();
    ok('no case book: closed is null for every agent (never 0)', d0.agents.every((a) => a.closed === null), J(d0.agents.map((a) => a.closed)));
    ok('no case book: leads is still null (unchanged)', d0.agents.every((a) => a.leads === null)); }
  await setBooks('open');
  { const d1 = await digestOf();
    ok('open book only: closed is null — an unloaded closed book is not "closed none"', d1.agents.every((a) => a.closed === null), J(d1.agents.map((a) => a.closed)));
    ok('open book only: leads still counts', rowOf(d1, 'CB400').leads === 2, String(rowOf(d1, 'CB400').leads)); }

  /* ---------------------------------------------------------------- B. month unchanged ---- */
  console.log('\nB · A MONTH PAYLOAD IS UNCHANGED');
  await setBooks('both');
  ok('month payload: period is {from, to} only — no kind', J(Object.keys(dg.period).sort()) === J(['from', 'to']) && dg.period.from === '2026-09-01' && dg.period.to === '2026-09-30', J(dg.period));
  ok('month payload: CB233 carries its two September segments', (rowOf(dg, 'CB233').segments || []).length === 2, J(rowOf(dg, 'CB233').segments));

  /* ---------------------------------------------------------------- C. the billing cycle ---- */
  console.log('\nC · A BILLING-CYCLE PAYLOAD (26 AUG – 25 SEP) IS WHOLE');
  await page.evaluate(() => window.__mtd.setPeriod('2026-09', 'cycle'));
  const cy = await digestOf();
  ok('cycle: period is {from:2026-08-26, to:2026-09-25, kind:cycle}', J(cy.period) === J({ from: '2026-08-26', to: '2026-09-25', kind: 'cycle' }), J(cy.period));
  ok('cycle: dates are exactly the data days inside the range (25 Aug and 28 Sep stay out)', J(cy.dates) === J(IN_CYCLE), J(cy.dates));
  ok('cycle: 22 working days (Aug 26–31 = 4, Sep 1–25 = 19 less Heritage Day)', cy.workingDays === 22, String(cy.workingDays));
  ok('cycle: 7 dialling days and 14 days-with-data (working days from 26 Aug to the last data day, 14 Sep)', cy.diallingDays === 7 && cy.daysWithData === 14, J([cy.diallingDays, cy.daysWithData]));
  ok('cycle: weeks exist and sit inside the range', cy.weeks.length >= 3 && cy.weeks.every((w) => w.from >= '2026-08-26' && w.to <= '2026-09-25'), J(cy.weeks));
  { const wd = new Set(); cy.weeks.forEach((w) => IN_CYCLE.forEach((d) => { if (d >= w.from && d <= w.to) wd.add(d); }));
    ok('cycle: every data day falls in a week', IN_CYCLE.every((d) => wd.has(d)), J([...wd])); }
  ok('cycle: 49 sales — 7 agents × 7 in-range days', cy.agents.reduce((t, a) => t + a.sales, 0) === 49, String(cy.agents.reduce((t, a) => t + a.sales, 0)));
  ok('cycle: the campaign blocks carry every sale once (no mover day dropped)', Object.values(cy.campAgg).reduce((t, c) => t + c.sales, 0) === 49, J(Object.fromEntries(Object.entries(cy.campAgg).map(([k, v]) => [k, v.sales]))));
  ok('cycle: the comm model is the cycle\'s END month (September), not the starting August', cy.comm.version !== '2026-08' && J(cy.comm) === J(dg.comm), String(cy.comm && cy.comm.version));
  { const cur = new Date(Date.now() + 2 * 3600000).toISOString().slice(0, 7);
    ok('cycle: commNow follows the same month (names the current month when it is not the cycle\'s)', cur === '2026-09' ? cy.commNow === undefined : (cy.commNow && cy.commNow.month === cur), J(cy.commNow && cy.commNow.month)); }
  { const s121 = rowOf(cy, 'CB121').segments || [], s233 = rowOf(cy, 'CB233').segments || [];
    ok('cycle: CB121 (August mover) — Download & Test 26–27 Aug, then Courtesy from 28 Aug', s121.length === 2 && s121[0].campaign === DT && s121[0].from === '2026-08-26' && s121[0].to === '2026-08-27'
      && s121[1].campaign === 'Courtesy' && s121[1].from === '2026-08-28' && s121[1].to === '2026-09-14', J(s121));
    ok('cycle: CB121 segments sum to the row (2 + 5 = 7)', s121.length === 2 && s121[0].sales === 2 && s121[1].sales === 5 && rowOf(cy, 'CB121').sales === 7, J(s121.map((s) => s.sales)));
    ok('cycle: CB233 (September mover) — Cuddle from the cycle\'s first day (the August days are no gap), Courtesy from 14 Sep', s233.length === 2 && s233[0].campaign === 'Cuddle' && s233[0].from === '2026-08-26' && s233[0].to === '2026-09-13'
      && s233[1].campaign === 'Courtesy' && s233[1].from === '2026-09-14', J(s233));
    ok('cycle: CB233 segments sum to the row (6 + 1 = 7)', s233.length === 2 && s233[0].sales === 6 && s233[1].sales === 1 && rowOf(cy, 'CB233').sales === 7, J(s233.map((s) => s.sales)));
    ok('cycle: a non-mover carries no segments', !('segments' in rowOf(cy, 'CB400'))); }
  ok('cycle: `closed` counts the cycle\'s closed cases (CB400: 3 September + the 28 Aug one = 4)', rowOf(cy, 'CB400').closed === 4, String(rowOf(cy, 'CB400').closed));
  ok('the browser push guards are untouched (still calendar-month: liveDigestMonthOk in send())', /function send\(\)[\s\S]{0,3000}liveDigestMonthOk\(/.test(fs.readFileSync(HTML, 'utf8')));
  /* the gap-fill is for a billing cycle ONLY: every other multi-month range reads exactly what it always read */
  { const sg = await page.evaluate(() => ({
      thirty: moverSegments('CB233', { from: '2026-08-20', to: '2026-09-18' }),
      week: moverSegments('CB233', { from: '2026-08-31', to: '2026-09-06' }),
      none: moverSegments('CB400', { from: '2026-08-20', to: '2026-09-18' }),
      cycle: moverSegments('CB233', { from: '2026-08-26', to: '2026-09-25' }) }));
    ok('30 days across a month boundary: CB233 keeps only the September feed\'s two segments (no August gap-fill)',
      sg.thirty && sg.thirty.length === 2 && sg.thirty[0].from === '2026-09-01' && sg.thirty[0].campaign === 'Cuddle' && sg.thirty[1].from === '2026-09-14', J(sg.thirty));
    ok('a week across the boundary: unchanged too', sg.week && sg.week.length === 2 && sg.week[0].from === '2026-09-01', J(sg.week));
    ok('a non-mover is still null on a cross-month range', sg.none === null, J(sg.none));
    ok('the same agent over the billing cycle IS gap-filled (Cuddle from 1 Aug, one merged stretch)', sg.cycle && sg.cycle.length === 2 && sg.cycle[0].from === '2026-08-01' && sg.cycle[0].to === '2026-09-13', J(sg.cycle)); }

  /* ---------------------------------------------------------------- C2. a custom range (spec 006) ---- */
  console.log('\nC2 · A CUSTOM-RANGE PAYLOAD (setRange 1 – 14 SEP) CARRIES EXACTLY THE RANGE\'S DAYS');
  await page.evaluate(() => window.__mtd.setRange('2026-09-01', '2026-09-14'));
  { const rg = await digestOf();
    const IN_RANGE = DAYS.filter((d) => d >= '2026-09-01' && d <= '2026-09-14');
    ok('range: period is the range (from 2026-09-01, to 2026-09-14) — never a cycle', rg && rg.period.from === '2026-09-01' && rg.period.to === '2026-09-14' && rg.period.kind !== 'cycle', J(rg && rg.period));
    ok('range: dates are exactly the data days inside it (31 Aug and 28 Sep stay out)', J(rg.dates) === J(IN_RANGE), J(rg.dates));
    ok('range: 21 sales — 7 agents × 3 in-range days', rg.agents.reduce((t, a) => t + a.sales, 0) === 21, String(rg.agents.reduce((t, a) => t + a.sales, 0)));
    ok('range: every agent\'s day rows sit inside the range', rg.agents.every((a) => (a.days || []).every((d) => d.d >= '2026-09-01' && d.d <= '2026-09-14')), '');
    ok('range: the campaign blocks carry every sale once', Object.values(rg.campAgg).reduce((t, c) => t + c.sales, 0) === 21, J(Object.fromEntries(Object.entries(rg.campAgg).map(([k, v]) => [k, v.sales]))));
    ok('range: weeks sit inside the range', rg.weeks.length >= 1 && rg.weeks.every((w) => w.from >= '2026-09-01' && w.to <= '2026-09-14'), J(rg.weeks));
    ok('range: `closed` follows the range (CB400: 2 Sep + 3 Sep + 14 Sep = 3)', rowOf(rg, 'CB400').closed === 3, String(rowOf(rg, 'CB400').closed)); }
  { const rl = await page.evaluate(() => JSON.parse(JSON.stringify(window.__mtd.reports('leads'))));
    ok('range: the Lead management report is built for the same days', rl && rl.period && rl.period.from === '2026-09-01' && rl.period.to === '2026-09-14', J(rl && rl.period));
    const rv = await page.evaluate(() => { const r = window.__mtd.reports('variance'); return r ? JSON.parse(JSON.stringify(r)) : null; });
    ok('range: the Variance report (when there is one) is built for the same days', rv === null || (rv.period.from === '2026-09-01' && rv.period.to === '2026-09-14'), J(rv && rv.period)); }
  await page.evaluate(() => window.__mtd.setRange('2026-08-26', '2026-09-25'));
  { const rc = await digestOf();
    ok('a range that is exactly a billing month comes out of the engine marked cycle — the tool must stamp kind "range" over it', rc.period.kind === 'cycle' && /kind:\s*'range'/.test(TOOL), J(rc.period)); }
  await page.evaluate(() => window.__mtd.setPeriod('2026-09', 'month'));

  /* ---------------------------------------------------------------- D. the rule + the spec ---- */
  console.log('\nD · MTD_RULES.leadReportExcludeCampaigns IS THE SPEC\'S VALUE');
  const rule = await page.evaluate(() => window.__mtd.rules().leadReportExcludeCampaigns);
  const specVal = (SPEC.reference_data.lead_report_exclude_campaigns || {}).value;
  ok('the inline rule is [\'Courtesy\']', J(rule) === J(['Courtesy']), J(rule));
  ok('the spec file carries the same value (reference_data.lead_report_exclude_campaigns.value)', Array.isArray(specVal) && J(specVal) === J(rule), J(specVal));
  ok('a dated _changes[] entry records it (2026-10-01, Lead management no longer for Courtesy)',
    (SPEC._changes || []).some((c) => c.date === '2026-10-01' && /leadReportExcludeCampaigns|lead_report_exclude/i.test(c.key || '') && /Courtesy/.test(J(c))), '');

  /* ---------------------------------------------------------------- E. the report layer ---- */
  console.log('\nE · COURTESY IS OUT OF THE LEAD MANAGEMENT REPORT — FROM 1 OCTOBER 2026, AND ONLY THERE');
  const repOf = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__mtd.reports('leads'))));
  const pageOf = () => page.evaluate(() => { const h = PAGES.leads(); const ex = (window.__exp && window.__exp.rows) || [];
    return { h, names: ex.filter((r) => !r.gt).map((r) => r.cb).sort(), closed: (ex.find((r) => r.gt) || {}).tc }; });
  const ALL7 = ['CB121', 'CB233', 'CB400', 'CB402', 'CB500', 'CB501', 'CB502'];
  /* BEFORE the effective date: September and the cycle ending 25 Sep keep Courtesy, and say nothing about it */
  for (const [label, mo, mode] of [['September (month)', '2026-09', 'month'], ['the cycle ending 25 Sep', '2026-09', 'cycle']]) {
    await page.evaluate(([m, md]) => window.__mtd.setPeriod(m, md), [mo, mode]);
    const r0 = await repOf(), p0 = await pageOf();
    ok(label + ': agent-reports-leads keeps every Courtesy agent', ['CB121', 'CB233', 'CB400', 'CB402'].every((c) => c in r0.agents), J(Object.keys(r0.agents)));
    ok(label + ': …has a Courtesy block and Courtesy-only leader Gamma', 'Courtesy' in r0.campaigns && 'Leader Gamma' in r0.teams && Object.keys(r0.teamsByCamp).some((k) => /^Courtesy\|/.test(k)));
    ok(label + ': …and carries NEITHER excludedCampaigns NOR excludedFrom', !('excludedCampaigns' in r0) && !('excludedFrom' in r0), J([r0.excludedCampaigns, r0.excludedFrom]));
    ok(label + ': PULSE Lead management lists all seven agents', J(p0.names) === J(ALL7), J(p0.names));
    ok(label + ': …and shows no "not covered" line', !/not covered by Lead management/i.test(p0.h)); }
  /* ON/AFTER it: October and cycle-2026-10 exclude Courtesy */
  for (const [label, mode] of [['October (month)', 'month'], ['cycle-2026-10', 'cycle']]) {
    await page.evaluate((md) => window.__mtd.setPeriod('2026-10', md), mode);
    const rep = await repOf(), pg = await pageOf();
    ok(label + ': agent-reports-leads is built', !!rep && !!rep.agents);
    ok(label + ': excludedCampaigns = [\'Courtesy\'] and excludedFrom = \'2026-10-01\'', J(rep.excludedCampaigns) === J(['Courtesy']) && rep.excludedFrom === '2026-10-01', J([rep.excludedCampaigns, rep.excludedFrom]));
    ok(label + ': no Courtesy agent has a row (CB121, CB233, CB400, CB402 omitted)', ['CB121', 'CB233', 'CB400', 'CB402'].every((c) => !(c in rep.agents)), J(Object.keys(rep.agents)));
    ok(label + ': the Cuddle agents keep theirs', ['CB500', 'CB501', 'CB502'].every((c) => c in rep.agents), J(Object.keys(rep.agents)));
    ok(label + ': a Courtesy-only leader (Gamma) has no team block', !('Leader Gamma' in rep.teams), J(Object.keys(rep.teams)));
    ok(label + ': a MIXED leader\'s block counts only the Cuddle agent', rep.teams['Leader Mix'] && rep.teams['Leader Mix'].agents === 1, J(rep.teams['Leader Mix'] && rep.teams['Leader Mix'].agents));
    ok(label + ': teamsByCamp and campaigns have no Courtesy block', Object.values(rep.teamsByCamp).every((t) => t.camp !== 'Courtesy') && Object.keys(rep.teamsByCamp).every((k) => !/Courtesy/.test(k)) && !('Courtesy' in rep.campaigns) && 'Cuddle' in rep.campaigns, J(Object.keys(rep.campaigns)));
    ok(label + ': PULSE Lead management lists no Courtesy agent', !/Split CB(121|233|400|402)/.test(pg.h) && J(pg.names) === J(['CB500', 'CB501', 'CB502']), J(pg.names));
    ok(label + ': …and says, quietly, that Courtesy is not covered', /Courtesy[^<]{0,80}not covered/i.test(pg.h)); }
  await page.evaluate(() => window.__mtd.setPeriod('2026-09', 'month'));
  { const pg = await pageOf();
    ok('September: the ALL AGENTS total counts every agent\'s closed cases (CB400 3 + CB500 2 + CB121 1 + CB502 1 = 7)', pg.closed === 7, String(pg.closed)); }
  { const d2 = await digestOf();
    ok('the digest still counts Courtesy leads/closed (CB400 closed 3, leads 5)', rowOf(d2, 'CB400').closed === 3 && rowOf(d2, 'CB400').leads === 5, J([rowOf(d2, 'CB400').closed, rowOf(d2, 'CB400').leads]));
    await page.evaluate(() => window.__mtd.setPeriod('2026-10', 'month'));
    const d3 = await digestOf();
    ok('…and in October (rule in force) the digest STILL carries a Courtesy agent\'s closed/leads fields', 'closed' in rowOf(d3, 'CB400') && 'leads' in rowOf(d3, 'CB400'));
    const lb = await page.evaluate(() => { const A = window.__mtd.leads().A; return Object.keys(A).sort(); });
    ok('leadBook(true) still has every agent — the rule is applied at the report layer only', J(lb) === J(ALL7), J(lb)); }
  { const html = fs.readFileSync(HTML, 'utf8');
    const inl = (html.match(/leadReportExcludeFrom:\s*'(\d{4}-\d{2}-\d{2})'/) || [])[1];
    ok('the inline effective date equals the spec\'s (reference_data.lead_report_exclude_campaigns.effective)', inl === (SPEC.reference_data.lead_report_exclude_campaigns || {}).effective && inl === '2026-10-01', String(inl)); }
  ok('no page errors in the engine run', !errs.length, errs.join(' | '));
} finally { await b.close(); server.close(); }

/* -------------------------------------------------------------------- F. the publisher ---- */
console.log('\nF · tools/digest-republish.mjs PUBLISHES THE CYCLE KEYS — ONLY UNDER --apply, NEVER THE LIVE KEY');
{
  const cyc = await import(pathToFileURL(path.join(ROOT, 'worker', 'src', 'cycle.mjs')).href);
  ok('the tool imports cyclesNow from worker/src/cycle.mjs (one definition)', /worker['"],\s*['"]src['"],\s*['"]cycle\.mjs|worker\/src\/cycle\.mjs/.test(TOOL) && /cyclesNow/.test(TOOL));
  const m = TOOL.match(/\/\*CYCLE-JOBS-BEGIN\*\/([\s\S]*?)\/\*CYCLE-JOBS-END\*\//);
  ok('the cycle-key planning is a delimited, testable block', !!m);
  if (m) {
    const cycleJobsFor = new Function('cyclesNow', m[1] + '\nreturn cycleJobsFor;')(cyc.cyclesNow);
    const now1 = Date.parse('2026-10-01T09:00:00Z');
    const j1 = cycleJobsFor(now1);
    ok('on 1 Oct 2026: the last complete cycle is 2026-09 and the one in progress is 2026-10', J(j1.map((x) => x.key)) === J(['cycle-2026-09', 'cycle-2026-10']), J(j1.map((x) => x.key)));
    ok('…with their ranges (26 Aug–25 Sep, 26 Sep–25 Oct) and the Storage names agent-digest-cycle-YYYY-MM',
      j1[0].from === '2026-08-26' && j1[0].to === '2026-09-25' && j1[1].from === '2026-09-26' && j1[1].to === '2026-10-25'
      && j1[0].name === 'agent-digest-cycle-2026-09' && j1[1].name === 'agent-digest-cycle-2026-10', J(j1));
    ok('…and the campaign-move months each cycle touches (Aug+Sep, Sep+Oct)', J(j1[0].months) === J(['2026-08', '2026-09']) && J(j1[1].months) === J(['2026-09', '2026-10']), J(j1.map((x) => x.months)));
    const j2 = cycleJobsFor(Date.parse('2026-01-10T09:00:00Z'));
    ok('across a year boundary (10 Jan 2026): cycle-2025-12 complete + cycle-2026-01 in progress', J(j2.map((x) => x.key)) === J(['cycle-2025-12', 'cycle-2026-01']) && J(j2[0].months) === J(['2025-11', '2025-12']), J(j2)); }
  /* review fixes: a cycle that cannot be published whole is refused, and a cycle can never stop the live digest */
  if (m) {
    const refuse = new Function('cyclesNow', 'movesFailed', m[1] + '\nreturn cycleRefusal;');
    const job = { key: 'cycle-2026-09', from: '2026-08-26', to: '2026-09-25', months: ['2026-08', '2026-09'] };
    const R = (dates, failed) => refuse(cyc.cyclesNow, new Set(failed))(job, { dates, period: { from: job.from, to: job.to, kind: 'cycle' } });
    ok('a cycle whose data starts on its first day is accepted', R(['2026-08-26', '2026-09-01'], []) === '');
    ok('…and one starting 3 days late is still accepted', R(['2026-08-29'], []) === '');
    ok('a cycle whose first covered date is 4+ days after its start is refused, with a reason', R(['2026-08-30', '2026-09-01'], []) !== '');
    ok('a cycle with no dates at all is refused', R([], []) !== '');
    ok('a cycle is refused when the campaign-moves read failed for EITHER of its months', R(['2026-08-26'], ['2026-08']) !== '' && R(['2026-08-26'], ['2026-09']) !== '');
    ok('a failed read of an unrelated month does not refuse it', R(['2026-08-26'], ['2026-10']) === ''); }
  ok('the moves-read failure path records the month (movesFailed.add)', /movesFailed\.add\(m\)/.test(TOOL));
  { const cyc2 = TOOL.slice(TOOL.indexOf('BILLING CYCLES'));
    ok('each cycle build is in its own try/catch that logs and continues', /for \(const job of cycleJobsFor[\s\S]*?try \{[\s\S]*?\} catch \(e\) \{[^}]*console\.(log|warn)[^}]*continue/.test(cyc2));
    const wi = cyc2.lastIndexOf('for (const c of cycleBuilt) {'), wr = cyc2.slice(wi, cyc2.indexOf("console.log('done."));
    ok('each cycle WRITE is in its own try/catch', /for \(const c of cycleBuilt\) \{\s*try \{[\s\S]*\} catch \(e\) \{/.test(wr));
    ok('…and the cycle write block never process.exit()s (a failed cycle write cannot fail the run)', wi > 0 && !/process\.exit/.test(wr)); }
  const sec = (TOOL.match(/BILLING CYCLES[\s\S]*$/) || [''])[0];
  ok('the cycle build uses setPeriod(<month>, \'cycle\')', /setPeriod\([^)]*'cycle'\)/.test(TOOL));
  ok('a cycle payload is only kept if it is a whole cycle (period.kind cycle, the cycle\'s own dates, agents present)', /kind\s*!==\s*'cycle'|kind\s*===\s*'cycle'/.test(sec));
  ok('a null/empty cycle is skipped with a reason, not published', /skipp?ed?/i.test(sec) && /agents/.test(sec));
  ok('the cycle write targets raw/kv/agent-digest-cycle-… with x-upsert and a pointer {store, period, kind:\'cycle\', updated_at}',
    /raw\/kv\//.test(sec) && /x-upsert/.test(sec) && /kind:\s*'cycle'/.test(sec) && /period:\s*/.test(sec) && /updated_at/.test(sec));
  ok('the cycle write is behind --apply (the dry run prints "would write")', /APPLY/.test(sec) && /would write/i.test(sec));
  ok('a cycle build never joins the live/history jobs (no jobs.push in the cycle section)', !/jobs\.push/.test(sec) && !/keyName\s*=\s*'agent-digest'\s*[;,]/.test(sec));
  ok('the live-key logic is untouched (liveDigestAllowed + rollover grace still there)', /liveDigestAllowed\(from, liveFrom, Date\.now\(\)\)/.test(TOOL) && /ROLLOVER GRACE/.test(TOOL));
  ok('the campaign-move months are extended with the cycles\' months', /want\s*=/.test(TOOL) && /cycleJobsFor|cyclesNow/.test(TOOL.slice(TOOL.indexOf('const want'), TOOL.indexOf('const want') + 900)));
}

/* -------------------------------------------------------------------- G. the custom ranges (spec 006, C5) ---- */
console.log('\nG · tools/digest-republish.mjs BUILDS THE QUEUED CUSTOM RANGES — kv:cm-range-requests → setRange → digest + reports + pointer → status');
{
  let RG = {};
  try { RG = await import(pathToFileURL(path.join(ROOT, 'worker', 'src', 'range.mjs')).href); } catch (e) { ok('worker/src/range.mjs exists', false, String(e.message).slice(0, 100)); }
  ok('the tool imports the range definition from worker/src/range.mjs (one definition, never re-derived)', /['"]range\.mjs['"]|worker\/src\/range\.mjs/.test(TOOL) && /rangeOf/.test(TOOL));
  ok('the tool reads the queue kv:cm-range-requests (through range.mjs RANGE_QUEUE_KEY)', /RANGE_QUEUE_KEY/.test(TOOL) && RG.RANGE_QUEUE_KEY === 'kv:cm-range-requests');
  const m = TOOL.match(/\/\*RANGE-JOBS-BEGIN\*\/([\s\S]*?)\/\*RANGE-JOBS-END\*\//);
  ok('the range planning is a delimited, testable block (RANGE-JOBS)', !!m);
  if (m && RG.rangeOf) {
    const B = new Function('rangeOf', 'rangeFilling', 'movesFailed', m[1] + '\nreturn { rangeJobsFor, rangeRefusal, rangeHeld, RANGE_BUILDS_MAX, rangeOutcome: typeof rangeOutcome === "function" ? rangeOutcome : null };');
    const mk = (failed) => B(RG.rangeOf, RG.rangeFilling, new Set(failed || []));
    const { rangeJobsFor, rangeRefusal, rangeHeld, RANGE_BUILDS_MAX, rangeOutcome } = mk();
    const NOW = Date.parse('2026-10-01T08:00:00Z');
    const q = (key, at, status, o) => Object.assign({ key, from: key.slice(6, 16), to: key.slice(17), by: 'ryan', at, status }, o || {});
    const REQ = [
      q('range-2026-09-01-2026-09-15', '2026-09-30T10:00:00.000Z', 'waiting'),
      q('range-2026-09-20-2026-09-30', '2026-09-29T10:00:00.000Z', 'built'),          // ends 30 Sep: within the last 2 days → still filling → rebuilt
      q('range-2026-08-01-2026-08-15', '2026-09-28T10:00:00.000Z', 'built'),          // closed and built: left alone
      q('range-2026-09-28-2026-10-01', '2026-09-30T11:00:00.000Z', 'refused', { reason: 'no rows yet' }),   // refused but still filling: tried again
      q('range-2026-08-16-2026-08-20', '2026-09-28T10:00:00.000Z', 'refused', { reason: 'x' }),   // refused and closed: left alone
      q('range-2026-09-15-2026-09-01', '2026-09-29T10:00:00.000Z', 'waiting'),        // invalid (backwards): never built
      { key: '../vas-state', at: '2026-09-29T10:00:00.000Z', status: 'waiting' },        // not a range key at all
      q('range-2026-09-01-2026-09-15', '2026-09-30T12:00:00.000Z', 'waiting'),        // a duplicate
      q('range-2026-09-02-2026-09-03', '2026-09-29T09:00:00.000Z'),                   // no status = waiting; the oldest ask
    ];
    const jobs = rangeJobsFor(REQ, NOW);
    ok('jobs: every WAITING range (oldest ask first), then every range still FILLING (its end within the last 2 days)',
      J(jobs.map((j) => j.key)) === J(['range-2026-09-02-2026-09-03', 'range-2026-09-01-2026-09-15', 'range-2026-09-20-2026-09-30', 'range-2026-09-28-2026-10-01']), J(jobs.map((j) => j.key)));
    ok('…a closed range already built, or refused, is not rebuilt; an invalid key and a duplicate are never built', !jobs.some((j) => /08-01-2026-08-15|08-16|09-15-2026-09-01|vas-state/.test(j.key)) && jobs.filter((j) => j.key === 'range-2026-09-01-2026-09-15').length === 1);
    const j1 = jobs.find((j) => j.key === 'range-2026-09-01-2026-09-15');
    ok('a job carries {key, name agent-digest-range-…, from, to, label, months, why}', j1 && j1.name === 'agent-digest-range-2026-09-01-2026-09-15' && j1.from === '2026-09-01' && j1.to === '2026-09-15'
      && j1.label === '1 – 15 Sep 2026' && J(j1.months) === J(['2026-09']) && j1.why === 'waiting' && jobs.find((j) => j.key === 'range-2026-09-20-2026-09-30').why === 'filling', J(j1));
    ok('a 93-day range touches every month it spans (Jun, Jul, Aug, Sep)', J((rangeJobsFor([q('range-2026-06-30-2026-09-30', '2026-09-30T10:00:00.000Z', 'waiting')], NOW)[0] || {}).months) === J(['2026-06', '2026-07', '2026-08', '2026-09']));
    const many = Array.from({ length: 12 }, (_, i) => q('range-2026-08-' + String(i + 1).padStart(2, '0') + '-2026-08-20', '2026-09-30T10:' + String(i).padStart(2, '0') + ':00.000Z', 'waiting'));
    ok('at most RANGE_BUILDS_MAX per run (the rest wait for the next tick, oldest first)', RANGE_BUILDS_MAX >= 1 && RANGE_BUILDS_MAX <= 10 && rangeJobsFor(many, NOW).length === RANGE_BUILDS_MAX && rangeJobsFor(many, NOW)[0].key === many[0].key, String(RANGE_BUILDS_MAX));
    ok('an empty or missing queue is no jobs', J(rangeJobsFor([], NOW)) === '[]' && J(rangeJobsFor(undefined, NOW)) === '[]');
    const job = { key: 'range-2026-09-01-2026-09-15', from: '2026-09-01', to: '2026-09-15', label: '1 – 15 Sep 2026', months: ['2026-09'] };
    ok('refused (in words) when the engine has no rows for the range', /no figures/i.test(rangeRefusal(job, null)) && /no figures/i.test(rangeRefusal(job, { agents: [], dates: [] })) && /1 – 15 Sep 2026/.test(rangeRefusal(job, null)));
    ok('refused when the engine answers an EMPTY payload', /no figures/i.test(rangeRefusal(job, { empty: true, agents: [{ code: 'CB1' }], dates: [] })));
    const W = { from: '2026-09-01', to: '2026-09-15' };   // the engine's window for the job
    ok('refused when its first data day is more than 3 days after `from` (the start is missing), naming that day', /2026-09-05/.test(rangeRefusal(job, { agents: [{ code: 'CB1' }], dates: ['2026-09-05', '2026-09-08'], period: W })));
    ok('accepted when the data starts on the first day, or up to 3 days late', rangeRefusal(job, { agents: [{ code: 'CB1' }], dates: ['2026-09-01'], period: W }) === '' && rangeRefusal(job, { agents: [{ code: 'CB1' }], dates: ['2026-09-04'], period: W }) === '');
    ok('a campaign-moves read failure HOLDS the range for the next run (not refused — it is not the range\'s fault)', mk(['2026-09']).rangeHeld(job) !== '' && mk(['2026-08']).rangeHeld(job) === '' && rangeHeld(job) === '');
    /* review finding 2: the engine building a DIFFERENT window is a refusal with a reason — never a silent skip that keeps the
       range "being built" for 7 days and takes a build slot every run */
    ok('refused when the engine built a different window, naming that window', /different window \(2026-09-02–2026-09-15\)/.test(rangeRefusal(job, { agents: [{ code: 'CB1' }], dates: ['2026-09-02'], period: { from: '2026-09-02', to: '2026-09-15' } })),
      rangeRefusal(job, { agents: [{ code: 'CB1' }], dates: ['2026-09-02'], period: { from: '2026-09-02', to: '2026-09-15' } }));
    ok('…and a payload with no period at all is a different window too', /different window/.test(rangeRefusal(job, { agents: [{ code: 'CB1' }], dates: ['2026-09-01'] })));
    /* review finding 4: a REBUILD of a range already published that now comes back refused keeps "built" (its digest is still
       served); a waiting or refused range is recorded as refused with the reason */
    ok('jobs carry the status they were queued with (`was`)', jobs.find((j) => j.key === 'range-2026-09-20-2026-09-30').was === 'built' && jobs.find((j) => j.key === 'range-2026-09-28-2026-10-01').was === 'refused' && j1.was === 'waiting'
      && jobs.find((j) => j.key === 'range-2026-09-02-2026-09-03').was === 'waiting', J(jobs.map((j) => j.was)));
    ok('rangeOutcome: a refused rebuild of a PUBLISHED range keeps it built (no result written)', typeof rangeOutcome === 'function' && rangeOutcome({ ...job, was: 'built' }, 'why') === null);
    ok('rangeOutcome: a waiting range is recorded refused with its reason', typeof rangeOutcome === 'function' && J(rangeOutcome({ ...job, was: 'waiting' }, 'why')) === J({ key: job.key, status: 'refused', reason: 'why' }));
    ok('rangeOutcome: a refused range tried again stays refused with the new reason', typeof rangeOutcome === 'function' && J(rangeOutcome({ ...job, was: 'refused' }, 'new')) === J({ key: job.key, status: 'refused', reason: 'new' }));
  }
  const RS = (TOOL.match(/CUSTOM RANGES \(spec 006\)[\s\S]*?\nawait b\.close\(\)/) || [''])[0];
  ok('the build calls __mtd.setRange(from, to) and agentDigestPayload()', /setRange\(/.test(RS) && /agentDigestPayload\(\)/.test(RS));
  ok('…builds BOTH reports for the range (__mtd.reports variance + leads) and keeps one only for the range\'s own dates', /reports\(/.test(RS) && /'variance',\s*'leads'/.test(RS) && /period[\s\S]{0,80}from[\s\S]{0,200}job\.from|job\.from[\s\S]{0,200}period/.test(RS));
  ok('…stamps period {kind:"range", key, label} on the digest', /kind:\s*'range'/.test(RS) && /key:\s*job\.key/.test(RS) && /label:\s*job\.label/.test(RS));
  ok('…each range build is its own island (try/catch that logs and continues)', /for \(const job of rangeJobs\)[\s\S]*?try \{[\s\S]*?\} catch \(e\) \{[^}]*console\.(log|warn)[^}]*(continue|\})/.test(RS));
  ok('…a moves-read failure holds (skips) the range; an engine refusal is recorded with its reason', /rangeHeld\(job\)/.test(RS) && /rangeRefusal\(job,/.test(RS) && /status:\s*'refused'/.test(TOOL));
  ok('…every refusal goes through rangeOutcome (a published range keeps "built"), and no window mismatch is skipped without a result', /rangeOutcome\(job, why\)/.test(RS) && !/skipped — the engine built/.test(RS), '');
  ok('…and a time budget stops new builds in a long run', /RANGE_BUDGET_MS|budget/i.test(RS));
  const PS = (TOOL.match(/THE CUSTOM-RANGE KEYS[\s\S]*?console\.log\('done\./) || [''])[0];
  ok('publish: digest at raw/kv/agent-digest-range-… + pointer {store, period, kind:"range", updated_at}', /raw\/kv\//.test(PS) && /x-upsert/.test(PS) && /kind:\s*'range'/.test(PS) && /period:/.test(PS) && /updated_at/.test(PS));
  ok('publish: the report keys agent-reports-<kind>-range-…', /'agent-reports-'\s*\+\s*kind\s*\+\s*'-'\s*\+\s*\w+\.job\.key|'agent-reports-'\s*\+\s*kind\s*\+\s*'-'\s*\+\s*job\.key/.test(PS));
  ok('publish: each range in its own try/catch, and the block never process.exit()s', /try \{[\s\S]*\} catch \(e\) \{/.test(PS) && !/process\.exit/.test(PS));
  ok('the status goes back to the request ({status:"built"|"refused", reason?, statusAt}) by compare-and-set on updated_at', /status:\s*'built'/.test(TOOL) && /settleQueue\(/.test(TOOL) && /updated_at=eq\./.test(TOOL));
  { const gate = TOOL.indexOf("if (!APPLY) {"), exit0 = TOOL.indexOf('process.exit(0)', gate), pub = TOOL.indexOf('THE CUSTOM-RANGE KEYS'), cas = TOOL.indexOf('settleQueue(queueList');
    ok('ranges are written only under --apply: the range publish AND the status write come after the dry run\'s exit', gate > 0 && exit0 > gate && pub > exit0 && cas > exit0, J([gate, exit0, pub, cas]));
    ok('…and the dry run says what it would write and mark', /'would write '\)\s*\+\s*'kv:'\s*\+\s*rb\.job\.name/.test(TOOL) && /would mark/.test(TOOL)); }
  ok('the campaign-move months are extended with the ranges\' months', /rangeJobs/.test(TOOL.slice(TOOL.indexOf('const want'), TOOL.indexOf('const want') + 900)));
  ok('a range is never written to the live key (the range section never names keyName = \'agent-digest\')', !/keyName\s*=\s*'agent-digest'\s*[;,]/.test(PS + RS) && !/jobs\.push/.test(PS + RS));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
