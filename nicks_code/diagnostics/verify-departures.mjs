#!/usr/bin/env node
/**
 * verify-departures.mjs — the current Agent List is the whole roster; a leaver is off every report.
 *
 *   node nicks_code/diagnostics/verify-departures.mjs
 *
 * Nick, 2026-09-15 (morning): "I agree with your plan" — a leaver keeps their days up to the list
 * that dropped them. Nick, the same afternoon: "redo the leavers must be removed from the reports,
 * only focus on the new agent list." So MTD_RULES.departures.keepDaysUntilLeft is FALSE: anyone
 * the latest list does not name is in no table, no total and no card, whatever they did earlier
 * in the month; their facts fall to "unmatched" like any unknown identity. The machinery that
 * knows WHO left and WHEN (S.leavers from /api/roster leavers[] = agent_list_leavers, migration-041;
 * a hand upload's dropped rows) stays, so the Upload Station can say how many left — and so the
 * rule can be turned back on by one flag if the decision moves again.
 *
 * Runs the REAL engine (nicks_code/index.html) headlessly over a synthetic floor: thirty agents
 * on the list, three who left on 14 Sep with facts before and after, one who left in August.
 * Also proves the two recording paths and the compare-and-set merge (mergeStates).
 */
import fs from 'node:fs'; import path from 'node:path'; import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const { chromium } = await import(pathToFileURL(path.join(HERE, 'node_modules', 'playwright', 'index.mjs')).href);
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (d ? ' — ' + d : '')); } };

const HTML = path.join(ROOT, 'nicks_code', 'index.html');
const SERVE = { '/': HTML, '/index.html': HTML, '/xlsx.full.min.js': path.join(ROOT, 'site', 'xlsx.full.min.js') };
const server = http.createServer((q, s) => { const p = SERVE[q.url.split('?')[0]];
  if (!p || !fs.existsSync(p)) { s.writeHead(404); s.end(); return; }
  s.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' }); fs.createReadStream(p).pipe(s); });
await new Promise((r) => server.listen(8257, '127.0.0.1', r));
const b = await chromium.launch();
try {
  const page = await b.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
  await page.goto('http://127.0.0.1:8257/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__mtd && window.__mtd.state(), null, { timeout: 30000 });

  const out = await page.evaluate(() => {
    const S = window.__mtd.state();
    const TL = ['Leader Alpha', 'Leader Beta'];
    S.roster = []; S.att = {}; S.calls = {}; S.sales = {}; S.tracker = {}; S.orgHist = {}; S.vici = {}; S.cancRows = {}; S.viciDays = {}; S.leavers = {}; S.map = {};
    for (let i = 1; i <= 30; i++) {
      const code = 'CB' + (910000 + i), camp = i <= 15 ? 'Courtesy' : 'Cuddle';
      S.roster.push({ code, name: 'Stay Agent ' + i, sf: 'Stay Agent ' + i, tl: TL[i % 2], campaign: camp, tenure: 'Exp', callx: '', target: 5, start: '2026-01-01' });
    }
    const gone = [
      { code: 'CB920001', name: 'Gone Agent One',   sf: 'Gone Agent One',   tl: 'Leader Alpha', campaign: 'Courtesy', tenure: 'Exp', callx: '', target: 5, start: '2026-01-01', left: '2026-09-14' },
      { code: 'CB920002', name: 'Gone Agent Two',   sf: 'Gone Agent Two',   tl: 'Leader Alpha', campaign: 'Courtesy', tenure: 'Exp', callx: '', target: 5, start: '2026-01-01', left: '2026-09-14' },
      { code: 'CB920003', name: 'Gone Agent Three', sf: 'Gone Agent Three', tl: 'Leader Alpha', campaign: 'Courtesy', tenure: 'Exp', callx: '', target: 5, start: '2026-01-01', left: '2026-09-14' },
      { code: 'CB920004', name: 'Gone Agent August', sf: 'Gone Agent August', tl: 'Leader Beta', campaign: 'Cuddle', tenure: 'Exp', callx: '', target: 5, start: '2026-01-01', left: '2026-08-15' },
    ];
    for (const g of gone) S.leavers[g.code] = g;
    for (const g of gone) S.orgHist[g.code] = [{ d: '2026-09-01', tl: g.tl, campaign: g.campaign, tenure: g.tenure, src: 'agent-list' }];
    const DAYS = ['2026-09-07', '2026-09-08', '2026-09-14', '2026-09-16'];
    for (const d of DAYS) {
      S.att[d] = {}; S.calls[d] = {}; S.sales[d] = {};
      for (const a of S.roster) { S.att[d][a.code] = 'P'; S.calls[d][a.code] = { talk: 3600, calls: 30, ans: 15, opt: 0, saleD: 0, v: 1 }; }
      if (d <= '2026-09-08') for (const g of gone.slice(0, 3)) { S.att[d][g.code] = 'P'; S.calls[d][g.code] = { talk: 1800, calls: 20, ans: 10, opt: 0, saleD: 0, v: 1 }; }
      if (d === '2026-09-08') for (const g of gone.slice(0, 3)) S.sales[d][g.name] = { n: 2, gwp: 198, x: 172.17 };
      if (d === '2026-09-16') S.sales[d]['Gone Agent One'] = { n: 1, gwp: 99, x: 86.09 };
    }
    S.ui.team = ''; S.ui.camp = ''; S.ui.mtdSub = 'Courtesy'; S.ui.dailyFilter = {};
    window.__mtd.setPeriod('2026-09', 'month');
    const M = window.__mtd.model();
    const codesIn = (M.agents || []).map((a) => a.code);
    const factsOf = (code) => (M.facts || []).filter((f) => f.code === code).length;
    const un = Object.entries(M.unmatched || {}).map(([k, u]) => k + ':' + u.src);
    const alphaCourtesy = (M.facts || []).filter((f) => f.tl === 'Leader Alpha' && f.campaign === 'Courtesy' && !f.rangeAgg);
    const sumSales = alphaCourtesy.reduce((n, f) => n + (f.sales || 0), 0);
    const marked = (M.agents || []).filter((a) => a.left).length;
    /* the two recording paths */
    const before = JSON.parse(JSON.stringify(S.leavers));
    noteDepartures([S.roster[0]], '2026-09-15', [gone[0]]);
    const afterNote = { stay1: S.leavers[S.roster[0].code] && S.leavers[S.roster[0].code].left, gone1: S.leavers['CB920001'] || null };
    S.leavers = before;
    const adopted = adoptLeavers([{ code: 'cb920001', name: 'Gone Agent One', left: '2026-09-14', tl: 'Leader Alpha', campaign: 'Courtesy' },
      { code: S.roster[1].code, name: 'Stay Agent 2', left: '2026-09-14' }, { code: 'CB920009', name: 'No Date', left: '' }]);
    const afterAdopt = Object.keys(S.leavers).sort();
    S.leavers = before;
    /* the merge */
    const mine = { files: [{ name: 'a.csv', at: '2026-09-15 10:00', dates: ['2026-09-10'] }], sales: { '2026-09-10': { x: { n: 5 } } }, calls: {}, att: {}, evals: {}, tracker: {}, map: { k1: 'CB1' },
      roster: [{ code: 'CB1' }], rosterEffect: { at: '2026-09-15 10:00' }, leavers: { CB9: { code: 'CB9', left: '2026-09-14' } }, orgHist: {}, settings: { a: 1 }, _rev: 5 };
    const theirs = { files: [{ name: 'b.csv', at: '2026-09-15 09:00', dates: ['2026-09-10', '2026-09-11'] }], sales: { '2026-09-10': { x: { n: 1 } }, '2026-09-11': { y: { n: 7 } } }, calls: { '2026-09-01': { z: 1 } }, att: {}, evals: {}, tracker: {}, map: { k2: 'CB2' },
      roster: [{ code: 'CB2' }], rosterEffect: { at: '2026-09-15 09:30' }, leavers: {}, orgHist: {}, settings: { b: 2 }, _rev: 9 };
    const merged = mergeStates(mine, theirs);
    window.__mtd.rebuild();
    return { rule: (typeof MTD_RULES !== 'undefined') ? MTD_RULES.departures : null,
      codesIn, gone: gone.map((g) => ({ code: g.code, facts: factsOf(g.code) })), un, sumSales, marked, pill: leftPill('CB920001'),
      afterNote, adopted, afterAdopt,
      merged: { files: merged.files.map((f) => f.name).sort(), s10: merged.sales['2026-09-10'], s11: merged.sales['2026-09-11'], c01: merged.calls['2026-09-01'], map: merged.map, roster: merged.roster, leavers: merged.leavers, settings: merged.settings, rev: merged._rev } };
  });

  console.log('\nA · THE RULE');
  ok('MTD_RULES.departures.keepDaysUntilLeft is OFF (reversed 2026-09-15)', out.rule && out.rule.keepDaysUntilLeft === false && out.rule.reversed === '2026-09-15', JSON.stringify(out.rule));

  console.log('\nB · THE LIST IS THE WHOLE ROSTER');
  ok('all 30 listed agents are in the month\'s report', out.codesIn.filter((c) => /^CB91/.test(c)).length === 30, String(out.codesIn.length));
  ok('no leaver is in the report — not the three from 14 Sep, not the August one', !out.codesIn.some((c) => /^CB92/.test(c)), out.codesIn.filter((c) => /^CB92/.test(c)).join(','));
  ok('no leaver has a fact row, before or after the date they left', out.gone.every((g) => g.facts === 0), JSON.stringify(out.gone));
  ok('nobody in the report is marked left', out.marked === 0, String(out.marked));
  ok('the left pill renders nothing', out.pill === '', out.pill);
  ok('Leader Alpha / Courtesy sales carry none of theirs (0 — the stayers had no sales)', out.sumSales === 0, String(out.sumSales));
  ok('their sales sit in Unmatched, like any identity the list does not know (three names)', out.un.filter((k) => /Gone Agent/.test(k) && /sales/.test(k)).length === 3, out.un.join(', '));

  console.log('\nC · WHO LEFT IS STILL RECORDED (for the Upload Station count, and for the flag)');
  ok('a hand upload records the rows it dropped with the list\'s date', out.afterNote.stay1 === '2026-09-15', JSON.stringify(out.afterNote));
  ok('…and forgets a leaver the list names again', out.afterNote.gone1 === null);
  ok('adopting the record keeps leavers with a date and skips anyone on the roster or undated', out.adopted === true && out.afterAdopt.join(',') === 'CB920001', out.afterAdopt.join(','));

  console.log('\nD · COMPARE-AND-SET MERGE (mergeStates)');
  const m = out.merged;
  ok('files are the union', m.files.join(',') === 'a.csv,b.csv', m.files.join(','));
  ok('a day both sides hold goes to the side whose file is NEWER (this tab\'s 10 Sep)', m.s10 && m.s10.x && m.s10.x.n === 5, JSON.stringify(m.s10));
  ok('a day only the cloud holds survives (11 Sep)', m.s11 && m.s11.y && m.s11.y.n === 7, JSON.stringify(m.s11));
  ok('a store only the cloud has survives (calls 1 Sep)', m.c01 && m.c01.z === 1);
  ok('row-keyed stores union', m.map.k1 === 'CB1' && m.map.k2 === 'CB2');
  ok('the list follows the later receipt, leavers with it', m.roster[0].code === 'CB1' && m.leavers.CB9, JSON.stringify(m.leavers));
  ok('settings union', m.settings.a === 1 && m.settings.b === 2);
  ok('the revision moves past both', m.rev === 10, String(m.rev));

  ok('no page errors', errs.length === 0, errs.join(' | '));
} finally { await b.close(); server.close(); }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
