#!/usr/bin/env node
/**
 * verify-departures.mjs — a leaver keeps their days (rule departures, 2026-09-15).
 *
 *   node nicks_code/diagnostics/verify-departures.mjs
 *
 * Nick, 2026-09-15: "I will always be changing the list … I agree with your plan." The list
 * wins its whole month for MOVERS (27 Aug); an agent a later list stops naming has LEFT, and
 * under the month rule their month was credited to nobody (the 14 Sep list: 17 agents, 49
 * sales, 205.8 h of talk). Now S.leavers — served from the archive as /api/roster leavers[]
 * (agent_list_leavers, migration-041) and recorded by a hand upload from the rows it dropped —
 * keeps each leaver's identity and the date of the first list that did not name them; the
 * engine indexes them softly, employs them until that date, counts any later fact as a fact,
 * and every table marks them "left".
 *
 * Runs the REAL engine (nicks_code/index.html) headlessly over a synthetic floor: thirty
 * agents on the list, three who left on 14 Sep, one who left in August, facts before, on and
 * after the leaving date. Also proves the two recording paths (hand upload, record adoption)
 * and the compare-and-set merge (mergeStates) the same round introduced.
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
    /* three left on 14 Sep (Courtesy, Leader Alpha); one left on 15 Aug — before the period */
    const gone = [
      { code: 'CB920001', name: 'Gone Agent One',   sf: 'Gone Agent One',   tl: 'Leader Alpha', campaign: 'Courtesy', tenure: 'Exp', callx: '', target: 5, start: '2026-01-01', left: '2026-09-14' },
      { code: 'CB920002', name: 'Gone Agent Two',   sf: 'Gone Agent Two',   tl: 'Leader Alpha', campaign: 'Courtesy', tenure: 'Exp', callx: '', target: 5, start: '2026-01-01', left: '2026-09-14' },
      { code: 'CB920003', name: 'Gone Agent Three', sf: 'Gone Agent Three', tl: 'Leader Alpha', campaign: 'Courtesy', tenure: 'Exp', callx: '', target: 5, start: '2026-01-01', left: '2026-09-14' },
      { code: 'CB920004', name: 'Gone Agent August', sf: 'Gone Agent August', tl: 'Leader Beta', campaign: 'Cuddle', tenure: 'Exp', callx: '', target: 5, start: '2026-01-01', left: '2026-08-15' },
    ];
    for (const g of gone) S.leavers[g.code] = g;
    /* the org history a list would have written for them (the month rule, unchanged) */
    for (const g of gone) S.orgHist[g.code] = [{ d: '2026-09-01', tl: g.tl, campaign: g.campaign, tenure: g.tenure, src: 'agent-list' }];
    const DAYS = ['2026-09-07', '2026-09-08', '2026-09-14', '2026-09-16'];   // Mon, Tue, Mon (left), Wed (after)
    for (const d of DAYS) {
      S.att[d] = {}; S.calls[d] = {}; S.sales[d] = {};
      for (const a of S.roster) { S.att[d][a.code] = 'P'; S.calls[d][a.code] = { talk: 3600, calls: 30, ans: 15, opt: 0, saleD: 0, v: 1 }; }
      /* leavers: register + dialler on 7 and 8 Sep only; a sale by NAME (the Salesforce key) on 8 Sep; ONE sale after leaving on 16 Sep */
      if (d <= '2026-09-08') for (const g of gone.slice(0, 3)) { S.att[d][g.code] = 'P'; S.calls[d][g.code] = { talk: 1800, calls: 20, ans: 10, opt: 0, saleD: 0, v: 1 }; }
      if (d === '2026-09-08') for (const g of gone.slice(0, 3)) S.sales[d][g.name] = { n: 2, gwp: 198, x: 172.17 };
      if (d === '2026-09-16') S.sales[d]['Gone Agent One'] = { n: 1, gwp: 99, x: 86.09 };
      /* the August leaver never appears in September's data */
    }
    S.ui.team = ''; S.ui.camp = ''; S.ui.mtdSub = 'Courtesy'; S.ui.dailyFilter = {};
    window.__mtd.setPeriod('2026-09', 'month');
    const M = window.__mtd.model();
    const facts = (code) => (M.facts || []).filter((f) => f.code === code && !f.rangeAgg).map((f) => ({ d: f.date, emp: f.emp, act: f.act, sales: f.sales, talk: f.talk }));
    const agent = (code) => (M.agents || []).find((a) => a.code === code) || null;
    const un = Object.entries(M.unmatched || {}).map(([k, u]) => k + ':' + u.src);
    const alphaCourtesy = (M.facts || []).filter((f) => f.tl === 'Leader Alpha' && f.campaign === 'Courtesy' && !f.rangeAgg);
    const sumSales = alphaCourtesy.reduce((n, f) => n + (f.sales || 0), 0);
    const staySales = alphaCourtesy.filter((f) => /^CB91/.test(f.code)).reduce((n, f) => n + (f.sales || 0), 0);
    /* the two recording paths */
    const before = JSON.parse(JSON.stringify(S.leavers));
    noteDepartures([S.roster[0]], '2026-09-15', [gone[0]]);          // a hand upload drops Stay Agent 1 and names Gone Agent One again
    const afterNote = { stay1: S.leavers[S.roster[0].code] && S.leavers[S.roster[0].code].left, gone1: S.leavers['CB920001'] || null };
    S.leavers = before;
    const adopted = adoptLeavers([{ code: 'cb920001', name: 'Gone Agent One', left: '2026-09-14', tl: 'Leader Alpha', campaign: 'Courtesy' },
      { code: S.roster[1].code, name: 'Stay Agent 2', left: '2026-09-14' },     // on the roster: never a leaver
      { code: 'CB920009', name: 'No Date', left: '' }]);                          // no date: never a leaver
    const afterAdopt = Object.keys(S.leavers).sort();
    S.leavers = before;
    /* the merge: the cloud copy is the base, this tab's NEWER day wins, nothing uploaded is dropped */
    const mine = { files: [{ name: 'a.csv', at: '2026-09-15 10:00', dates: ['2026-09-10'] }], sales: { '2026-09-10': { x: { n: 5 } } }, calls: {}, att: {}, evals: {}, tracker: {}, map: { k1: 'CB1' },
      roster: [{ code: 'CB1' }], rosterEffect: { at: '2026-09-15 10:00' }, leavers: { CB9: { code: 'CB9', left: '2026-09-14' } }, orgHist: {}, settings: { a: 1 }, _rev: 5 };
    const theirs = { files: [{ name: 'b.csv', at: '2026-09-15 09:00', dates: ['2026-09-10', '2026-09-11'] }], sales: { '2026-09-10': { x: { n: 1 } }, '2026-09-11': { y: { n: 7 } } }, calls: { '2026-09-01': { z: 1 } }, att: {}, evals: {}, tracker: {}, map: { k2: 'CB2' },
      roster: [{ code: 'CB2' }], rosterEffect: { at: '2026-09-15 09:30' }, leavers: {}, orgHist: {}, settings: { b: 2 }, _rev: 9 };
    const merged = mergeStates(mine, theirs);
    window.__mtd.rebuild();
    return { rule: (typeof MTD_RULES !== 'undefined') ? MTD_RULES.departures : null,
      one: { agent: agent('CB920001'), facts: facts('CB920001') }, two: { agent: agent('CB920002'), facts: facts('CB920002') },
      aug: agent('CB920004'), stay1: agent(S.roster[0].code), un, sumSales, staySales,
      pill: leftPill('CB920001'), pillStay: leftPill(S.roster[0].code),
      afterNote, adopted, afterAdopt,
      merged: { files: merged.files.map((f) => f.name).sort(), s10: merged.sales['2026-09-10'], s11: merged.sales['2026-09-11'], c01: merged.calls['2026-09-01'], map: merged.map, roster: merged.roster, leavers: merged.leavers, settings: merged.settings, rev: merged._rev } };
  });

  console.log('\nA · THE RULE');
  ok('MTD_RULES.departures.keepDaysUntilLeft is on, since 2026-09-15', out.rule && out.rule.keepDaysUntilLeft === true && out.rule.since === '2026-09-15', JSON.stringify(out.rule));

  console.log('\nB · A LEAVER KEEPS THEIR DAYS');
  const one = out.one, two = out.two;
  ok('Gone Agent One is in the month\'s agents, marked left 2026-09-14', !!one.agent && one.agent.left === '2026-09-14', JSON.stringify(one.agent));
  ok('…under Leader Alpha / Courtesy, as the list last had them', one.agent && one.agent.tl === 'Leader Alpha' && one.agent.campaign === 'Courtesy');
  const f7 = one.facts.find((f) => f.d === '2026-09-07'), f8 = one.facts.find((f) => f.d === '2026-09-08'), f14 = one.facts.find((f) => f.d === '2026-09-14'), f16 = one.facts.find((f) => f.d === '2026-09-16');
  ok('7 Sep: an employed, actual shift with talk', f7 && f7.emp === 1 && f7.act === 1 && f7.talk === 1800, JSON.stringify(f7));
  ok('8 Sep: the sale keyed by NAME resolved to them (2 sales)', f8 && f8.sales === 2, JSON.stringify(f8));
  ok('14 Sep (the day they left): NO shift — employed 0, actual 0', !f14 || (f14.emp === 0 && f14.act === 0), JSON.stringify(f14));
  ok('16 Sep: a sale dated after leaving is still a fact — counted, with the shift it implies', f16 && f16.sales === 1 && f16.emp === 1, JSON.stringify(f16));
  ok('Gone Agent Two (no fact after leaving) has rows on 7 and 8 Sep only', two.facts.length === 2 && two.facts.every((f) => f.d <= '2026-09-08'), JSON.stringify(two.facts));
  ok('the August leaver is NOT in September (left before the period, no facts)', out.aug === null, JSON.stringify(out.aug));
  ok('a live agent carries no left marker', out.stay1 && !out.stay1.left);

  console.log('\nC · THE MONEY GOES WHERE IT BELONGS');
  ok('nothing of theirs is unmatched (' + out.un.length + ' unmatched keys)', !out.un.some((k) => /Gone Agent/.test(k)), out.un.join(', '));
  ok('Leader Alpha / Courtesy sales include the leavers\' (' + out.sumSales + ' = stayers ' + out.staySales + ' + 7)', out.sumSales === out.staySales + 7, out.sumSales + ' vs ' + out.staySales);
  ok('the table marker reads "left 09-14"', /left 09-14/.test(out.pill), out.pill);
  ok('…and a live agent gets none', out.pillStay === '');

  console.log('\nD · TWO WAYS OF RECORDING WHO LEFT, ONE ANSWER');
  ok('a hand upload records the rows it dropped with the list\'s date', out.afterNote.stay1 === '2026-09-15', JSON.stringify(out.afterNote));
  ok('…and forgets a leaver the list names again', out.afterNote.gone1 === null);
  ok('adopting the record keeps leavers with a date and skips anyone on the roster or undated', out.adopted === true && out.afterAdopt.join(',') === 'CB920001', out.afterAdopt.join(','));

  console.log('\nE · COMPARE-AND-SET MERGE (mergeStates)');
  const m = out.merged;
  ok('files are the union', m.files.join(',') === 'a.csv,b.csv', m.files.join(','));
  ok('a day both sides hold goes to the side whose file is NEWER (this tab\'s 10 Sep)', m.s10 && m.s10.x && m.s10.x.n === 5, JSON.stringify(m.s10));
  ok('a day only the cloud holds survives (11 Sep)', m.s11 && m.s11.y && m.s11.y.n === 7, JSON.stringify(m.s11));
  ok('a store only the cloud has survives (calls 1 Sep)', m.c01 && m.c01.z === 1);
  ok('row-keyed stores union', m.map.k1 === 'CB1' && m.map.k2 === 'CB2');
  ok('the list follows the later receipt (this tab\'s 10:00 over the cloud\'s 09:30), leavers with it', m.roster[0].code === 'CB1' && m.leavers.CB9, JSON.stringify(m.leavers));
  ok('settings union', m.settings.a === 1 && m.settings.b === 2);
  ok('the revision moves past both', m.rev === 10, String(m.rev));

  ok('no page errors', errs.length === 0, errs.join(' | '));
} finally { await b.close(); server.close(); }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
