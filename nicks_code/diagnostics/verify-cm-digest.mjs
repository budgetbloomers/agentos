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

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
