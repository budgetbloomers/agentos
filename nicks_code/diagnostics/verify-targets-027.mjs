/* verify-targets-027.mjs — DAILY SALES TARGETS FOLLOW THE AGENT LIST (Spec Kit 027, 2026-10-11).
 *
 * Nick, UAT 11 Oct: "The targets are not updated for the agents based on their tenure below — Month 1 - 4,
 * Month 2 - 5, Exp - 6". The 9 Oct list carried 4/5/6 in its Target column; the engine put the rule-book table
 * (salesTargetMatrix: Courtesy M1 3, M2 4, Exp 5) FIRST, so the cells were never read. Decided with Nick:
 *   1. precedence everywhere = CM override exact → CM override campaign-wide → the Agent List row's Target IN FORCE
 *      THAT DAY → rule book exact → rule book campaign-wide;
 *   2. a list's targets apply to the month it is uploaded in (the whole-month rule) — September keeps 3/4/5.
 *
 *   A  Worker: listTargetOf, effPerDay's new chain, rosterTargets (/api/roster fields), the CM settings list column
 *   B  drift: the precedence in the rule book = PULSE = Worker; matrix values unchanged; listTargetOf parity
 *   C  PULSE engine (real browser): September unchanged to the cent, October = the list cells, override wins,
 *      blank / TBC → rule book, a mover's days each take the right row, the digest + empty-month payload carry it
 *   D  a November list changes November only
 *   E  the Upload Station names mixed targets within a campaign|tenure group (a warning, never a refusal)
 *   F  a list ingested BEFORE this build gets its targets from the record on the next unchanged-fingerprint poll
 *   G  Ops: a window before the list's month reads the rule target, from it the list's
 *
 * Run:  node nicks_code/diagnostics/verify-targets-027.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const J = JSON.stringify;
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (d ? ' — ' + d : '')); } };
const head = (s) => console.log('\n== ' + s + ' ==');

const C = await import(pathToFileURL(path.join(ROOT, 'worker', 'src', 'campaign.mjs')).href);
const SPEC = JSON.parse(fs.readFileSync(path.join(ROOT, 'specs', 'mtd_engine_rules.json'), 'utf8'));
const specTm = SPEC.reference_data.sales_target_matrix;
const has = (f) => typeof f === 'function';

/* ═══════════════════════════ A · Worker ═══════════════════════════ */
head('A · Worker — the chain, /api/roster fields, the settings list column');
{
  const ctx = (m) => ({ targets: { matrix: m || {} } });
  ok('listTargetOf is exported', has(C.listTargetOf));
  ok('rosterTargets is exported', has(C.rosterTargets));
  if (has(C.listTargetOf)) {
    ok('listTargetOf: numbers and numeric strings', C.listTargetOf(4) === 4 && C.listTargetOf('4') === 4 && C.listTargetOf(' 2.5 ') === 2.5 && C.listTargetOf('1,5') === 1.5);
    ok('listTargetOf: blank / TBC / 0 / negative / junk → null (no list target)',
      [null, undefined, '', '  ', 'TBC', 0, '0', -1, '4abc', NaN, Infinity].every((v) => C.listTargetOf(v) === null));
  }
  ok('effPerDay: the LIST beats the rule book (Courtesy M1 4, not 3)', C.effPerDay(ctx(), 'Courtesy', 'M1', 4, 4) === 4, String(C.effPerDay(ctx(), 'Courtesy', 'M1', 4, 4)));
  ok('effPerDay: no list target in force → rule book exact (3)', C.effPerDay(ctx(), 'Courtesy', 'M1', 4, null) === 3);
  ok('effPerDay: no list target, no exact row → rule book campaign-wide (Nesting 2)', C.effPerDay(ctx(), 'Nesting', 'M9', 5, null) === 2);
  ok('effPerDay: an exact override beats the list', C.effPerDay(ctx({ 'Courtesy|M1': 9 }), 'Courtesy', 'M1', 4, 4) === 9);
  ok('effPerDay: a campaign-wide override beats the list', C.effPerDay(ctx({ 'Courtesy|*': 7 }), 'Courtesy', 'M1', 4, 4) === 7);
  ok('effPerDay: VT takes its list cell (1.5)', C.effPerDay(ctx(), 'VT', 'M2', 1.5, 1.5) === 1.5);
  ok('effPerDay: legacy last resort — no book row, no list target → the cell (4-arg call unchanged)', C.effPerDay(ctx(), 'VT', 'Exp', 6) === 6);

  if (has(C.rosterTargets)) {
    const rows = [
      { code: 'CB1', campaign: 'Courtesy', tenure: 'M1', target: 4 },
      { code: 'CB2', campaign: 'Courtesy', tenure: 'M2', target: 5 },
      { code: 'CB3', campaign: 'Courtesy', tenure: 'Exp', target: 6 },
      { code: 'CB4', campaign: 'Courtesy', tenure: 'M1', target: null },
      { code: 'CB5', campaign: 'Courtesy', tenure: 'M2', target: 'TBC' },
      { code: 'CB6', campaign: 'VT', tenure: 'M2', target: 2.5 },
    ];
    const out = C.rosterTargets(ctx(), rows);
    const by = Object.fromEntries(out.map((r) => [r.code, r]));
    ok('/api/roster serves the LIST target for the list\'s month (Courtesy M1/M2/Exp → 4/5/6)',
      by.CB1.target === 4 && by.CB2.target === 5 && by.CB3.target === 6, J(out.slice(0, 3)));
    ok('…with the raw cell as list_target and the old chain as rule_target (3/4/5) for earlier months',
      by.CB1.list_target === 4 && by.CB1.rule_target === 3 && by.CB2.rule_target === 4 && by.CB3.rule_target === 5, J(by.CB1));
    ok('…a blank cell serves the rule book and list_target null', by.CB4.target === 3 && by.CB4.list_target === null, J(by.CB4));
    ok('…a "TBC" cell serves the rule book and list_target null', by.CB5.target === 4 && by.CB5.list_target === null, J(by.CB5));
    ok('…VT keeps its own cell', by.CB6.target === 2.5 && by.CB6.list_target === 2.5);
    const ov = C.rosterTargets(ctx({ 'Courtesy|M1': 9 }), rows);
    ok('…a CM override still wins in what /api/roster serves (9), the list cell travels beside it',
      ov[0].target === 9 && ov[0].list_target === 4 && ov[0].rule_target === 9, J(ov[0]));
    ok('…the input rows are not mutated', rows[0].list_target === undefined && rows[0].target === 4);
  }

  const sctx = { assign: { dalwin: { campaigns: ['courtesy'] } }, sla: C.CM_SLA_DEFAULTS,
    targets: { matrix: {}, gwpMonth: {}, sla: {}, stamp: '', log: [] } };
  const listGroups = { 'Courtesy|M1': { 4: 16 }, 'Courtesy|M2': { 5: 6 }, 'Courtesy|Exp': { 6: 13 }, 'Courtesy|M0': { 3: 13 } };
  const b = C.cmSettingsBody({ cmTargetsStamp: '' }, { role: 'campaign_manager', username: 'dalwin' }, sctx, listGroups).body;
  const cr = (b.campaigns[0] || { rows: [] }).rows;
  const m1 = cr.find((r) => r.k === 'Courtesy|M1');
  ok('CM settings: the Courtesy|M1 row shows the Agent List value beside the rule book, and eff is the list\'s 4',
    m1 && J(m1.list) === J([{ v: 4, n: 16 }]) && m1.base === 3 && m1.eff === 4, J(m1));
  ok('CM settings: a list-only group of a shown campaign gets a row (Courtesy|M0 3)',
    cr.some((r) => r.k === 'Courtesy|M0' && r.eff === 3), J(cr.map((r) => r.k)));
  const b2 = C.cmSettingsBody({ cmTargetsStamp: '' }, { role: 'campaign_manager', username: 'dalwin' },
    { ...sctx, targets: { ...sctx.targets, matrix: { 'Courtesy|M1': 9 } } }, listGroups).body;
  const m1b = b2.campaigns[0].rows.find((r) => r.k === 'Courtesy|M1');
  ok('CM settings: an override set here is still the effective value', m1b && m1b.eff === 9 && m1b.set === 9, J(m1b));
}

/* ═══════════════════════════ B · drift ═══════════════════════════ */
head('B · drift — one precedence, one matrix, one cell parser');
const WANT_PREC = ['override', 'override*', 'list', 'book', 'book*'];
ok('the rule book states the precedence (sales_target_matrix._precedence)', J(specTm._precedence) === J(WANT_PREC), J(specTm._precedence));
ok('the Worker states the same precedence (TARGET_PRECEDENCE)', J(C.TARGET_PRECEDENCE) === J(WANT_PREC), J(C.TARGET_PRECEDENCE));
ok('the rule-book VALUES are unchanged (Courtesy M1 3 / M2 4 / Exp 5, Cuddle Exp 8, Nesting 2)',
  specTm['Courtesy|M1'] === 3 && specTm['Courtesy|M2'] === 4 && specTm['Courtesy|Exp'] === 5 && specTm['Cuddle|Exp'] === 8 && specTm['Nesting|*'] === 2);
ok('the rule book records the change (_changes[] 2026-10-11)', (SPEC._changes || []).some((c) => c.date === '2026-10-11' && /sales_target_matrix/.test(c.key || '')));

/* ═══════════════════════════ PULSE harness ═══════════════════════════ */
const HTML = path.join(ROOT, 'nicks_code', 'index.html');
const SIDE = { '/xlsx.full.min.js': path.join(ROOT, 'site', 'xlsx.full.min.js') };
const srv = http.createServer((q, s) => {
  const u = q.url.split('?')[0];
  const p = SIDE[u] || ((u === '/' || u === '/index.html') ? HTML : null);
  if (!p || !fs.existsSync(p)) { s.writeHead(404); s.end(); return; }
  s.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' }); fs.createReadStream(p).pipe(s);
});
await new Promise((r) => srv.listen(8327, '127.0.0.1', r));
const { chromium } = await import(pathToFileURL(path.join(HERE, 'node_modules', 'playwright', 'index.mjs')).href);
const browser = await chromium.launch();

/* A page whose clock can be moved: window.__off is added to the real time (starts at 9 Oct 2026, 10:00 SAST). */
async function freshPage() {
  const page = await browser.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
  await page.addInitScript(() => { const R = Date; window.__off = R.parse('2026-10-09T08:00:00Z') - R.now();
    class D extends R { constructor(...a) { if (a.length === 0) super(R.now() + window.__off); else super(...a); } static now() { return R.now() + window.__off; } }
    window.Date = D; });
  await page.route(/chatterbox-agentos-api\.chatterbox-agentos\.workers\.dev/, (route) => route.abort());
  await page.goto('http://127.0.0.1:8327/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__mtd && window.__mtd.state(), null, { timeout: 30000 });
  await page.evaluate(() => {
    window.__toasts = [];
    if (typeof window.toast === 'function' && !window.__tw) { window.__tw = window.toast;
      window.toast = function (m) { try { window.__toasts.push(String(m)); } catch (e) {} return window.__tw.apply(this, arguments); }; }
  });
  return { page, errs };
}

const SEPT = ['2026-09-01', '2026-09-02', '2026-09-03'];
const OCT = ['2026-10-06', '2026-10-07', '2026-10-08'];
const NOV = ['2026-11-03', '2026-11-04'];
/* code, campaign, tl, tenure, September list cell (recorded pre-build: NO target in history), October list cell */
const AG = [
  ['CB911', 'Courtesy', 'Leader Alpha', 'M1', 3, '4'],
  ['CB912', 'Courtesy', 'Leader Alpha', 'M2', 4, '5'],
  ['CB913', 'Courtesy', 'Leader Alpha', 'Exp', 5, '6'],
  ['CB914', 'Courtesy', 'Leader Alpha', 'M1', 3, ''],       // blank → rule book
  ['CB915', 'Courtesy', 'Leader Alpha', 'M2', 4, 'TBC'],    // text → rule book, named in the warning
  ['CB916', 'Courtesy', 'Leader Alpha', 'Exp', 8, '6'],     // a mover: Cuddle until 6 Oct, Courtesy from 7 Oct
  ['CB917', 'Cuddle', 'Leader Kappa', 'Exp', 8, '8'],
];
const VT = [['CB921', '1.5'], ['CB922', '1.5'], ['CB923', '2.5'], ['CB924', '7'], ['CB925', '']];
const listCsv = (cells) => 'Employee Code,Agent Name,Team Leader,Campaign,Tenure,Sales Force,Target,Start Date\n'
  + AG.map(([c, camp, tl, ten]) => [c, 'Agent ' + c, tl, camp, ten, 'Agent ' + c, cells[c] != null ? cells[c] : '', '2026-01-05'].join(',')).join('\n') + '\n'
  + VT.map(([c, t]) => [c, 'Agent ' + c, 'Leader Vee', 'VT', 'M2', 'Agent ' + c, t, '2026-01-05'].join(',')).join('\n') + '\n';
const OCT_CELLS = Object.fromEntries(AG.map((a) => [a[0], a[5]]));

const seedDays = (page, days) => page.evaluate(({ days, codes }) => {
  const S = window.__mtd.state();
  for (const d of days) { S.att[d] = {}; S.calls[d] = {}; S.sales[d] = {};
    for (const code of codes) { S.att[d][code] = 'P'; S.calls[d][code] = { talk: 3600, calls: 30, ans: 15, opt: 0, saleD: 0, v: 1 };
      S.sales[d][code] = { n: 2, gwp: 198, x: 172.16, u: 'case', a: { ['K' + code + d + 'a']: 86.08, ['K' + code + d + 'b']: 86.08 } }; } }
  S.files = (S.files || []).concat([{ name: 'seed-' + days[0], type: 'attendance', dates: days, rows: 1, at: days[days.length - 1] + ' 18:00' }]);
}, { days, codes: AG.map((a) => a[0]) });

const perDay = (page, m) => page.evaluate((m) => { window.__mtd.setPeriod(m, 'month');
  const out = {}; for (const f of (window.__mtd.model().facts || [])) { if (f.rangeAgg) continue; (out[f.code] = out[f.code] || {})[f.date] = f.target; } return out; }, m);
const digestRows = (page, m) => page.evaluate((m) => { window.__mtd.setPeriod(m, 'month'); const d = window.__mtd.digest();
  return d ? JSON.parse(JSON.stringify({ empty: !!d.empty, wd: d.workingDays, agents: d.agents })) : null; }, m);
const KEYS = ['code', 'campaign', 'tenure', 'target', 'gwpT', 'sales', 'pctT', 'emp', 'act', 'composite', 'score', 'scoreParts', 'rankCo', 'rankTeam'];
const pick = (rows) => Object.fromEntries((rows || []).filter((r) => r.code !== 'CB916').map((r) => [r.code, Object.fromEntries(KEYS.map((k) => [k, r[k]]))]));

/* ═══════════════════════════ C · the engine ═══════════════════════════ */
head('C · PULSE — September unchanged, October follows the list');
const P = await freshPage();
try {
  const page = P.page;
  /* drift, PULSE side: the same precedence and the same cell parser as the Worker */
  const INPUTS = [4, '4', ' 2.5 ', '1,5', null, '', '  ', 'TBC', 0, '0', -1, '4abc', '7', 1.5, '10'];
  const pd = await page.evaluate((INPUTS) => ({ prec: (window.__mtd.rules() || {}).salesTargetPrecedence || null,
    parse: typeof listTargetOf === 'function' ? INPUTS.map((v) => listTargetOf(v)) : null }), INPUTS);
  ok('PULSE states the same precedence (MTD_RULES.salesTargetPrecedence)', J(pd.prec) === J(WANT_PREC), J(pd.prec));
  ok('PULSE and the Worker read a Target cell identically (listTargetOf parity)',
    has(C.listTargetOf) && J(pd.parse) === J(INPUTS.map((v) => C.listTargetOf(v))), J(pd.parse));
  /* SEPTEMBER AS IT STANDS LIVE: the September list was ingested before this build, so its history segments
     carry NO target. Written through recordOrgList without a target, exactly what the old build stored. */
  await page.evaluate(({ AG, VT }) => {
    const S = window.__mtd.state();
    S.roster = []; S.att = {}; S.calls = {}; S.sales = {}; S.tracker = {}; S.orgHist = {}; S.vici = {}; S.cancRows = {}; S.viciDays = {};
    S.evals = {}; S.board = {}; S.adjust = {}; S.refs = null; S.campaignMoves = {}; S.opencasesLM = null; S.closedcases = null;
    S.cmTargets = { matrix: {}, stamp: '' }; S.files = []; S.leavers = {};
    for (const [code, camp, tl, ten, sept] of AG) {
      const sc = code === 'CB916' ? 'Cuddle' : camp, stl = code === 'CB916' ? 'Leader Kappa' : tl;
      S.roster.push({ code, name: 'Agent ' + code, sf: 'Agent ' + code, tl: stl, campaign: sc, tenure: ten, callx: '', target: sept, start: '2026-01-05' });
      recordOrgList(code, '2026-09-01', { campaign: sc, tl: stl, tenure: ten });
    }
    for (const [code] of VT) { S.roster.push({ code, name: 'Agent ' + code, sf: 'Agent ' + code, tl: 'Leader Vee', campaign: 'VT', tenure: 'M2', callx: '', target: 0, start: '2026-01-05' });
      recordOrgList(code, '2026-09-01', { campaign: 'VT', tl: 'Leader Vee', tenure: 'M2' }); }
    S.rosterEffect = { asOf: '2026-09-01', at: '2026-09-01 08:00', file: 'synthetic-sept', agents: AG.length };
    S.ui.team = ''; S.ui.camp = ''; S.ui.dailyFilter = {}; S.ui.asAt = '';
  }, { AG, VT });
  await seedDays(page, SEPT);
  const septBefore = await perDay(page, '2026-09');
  const septDigestBefore = await digestRows(page, '2026-09');
  ok('fixture: September per-day targets are the rule book (CB911 3, CB912 4, CB913 5)',
    septBefore.CB911 && septBefore.CB911['2026-09-02'] === 3 && septBefore.CB912['2026-09-02'] === 4 && septBefore.CB913['2026-09-02'] === 5, J(septBefore.CB911));

  /* THE 9 OCTOBER LIST, through the real ingest (a hand upload at the Upload Station) */
  await page.evaluate(() => { window.__toasts = []; window.__mtd.setRosterAsOf('2026-10-09'); });
  await page.evaluate((t) => window.__mtd.ingest('Matrix - Agent List 09.10.csv', t, 'roster', 'h027-oct'), listCsv(OCT_CELLS));

  /* E1 — empty current month BEFORE any October fact: the C1 payload already prices the list's target */
  const empty = await digestRows(page, '2026-10');
  const e911 = empty && (empty.agents || []).find((a) => a.code === 'CB911');
  ok('the empty current-month payload prices CB911 at the list\'s 4/day (4 × working days)',
    !!(empty && empty.empty && e911 && e911.target === Math.round(4 * empty.wd * 100) / 100), J(e911 && { t: e911.target, wd: empty.wd }));

  await page.evaluate(() => { window.__mtd.state().campaignMoves = { '2026-10': { at: '2026-10-09T08:00:00Z',
    agents: { CB916: [{ campaign: 'Cuddle', from: '2026-10-01' }, { campaign: 'Courtesy', from: '2026-10-07' }] } } }; });
  await seedDays(page, OCT);
  const oct = await perDay(page, '2026-10');
  ok('October: Courtesy M1 with list target 4 → 4/day (was 3)', oct.CB911 && oct.CB911['2026-10-07'] === 4, J(oct.CB911));
  ok('October: Courtesy M2 with list target 5 → 5/day (was 4)', oct.CB912 && oct.CB912['2026-10-07'] === 5, J(oct.CB912));
  ok('October: Courtesy Exp with list target 6 → 6/day (was 5)', oct.CB913 && oct.CB913['2026-10-07'] === 6, J(oct.CB913));
  ok('October: a blank Target cell → the rule book (Courtesy M1 3)', oct.CB914 && oct.CB914['2026-10-07'] === 3, J(oct.CB914));
  ok('October: a "TBC" Target cell → the rule book (Courtesy M2 4)', oct.CB915 && oct.CB915['2026-10-07'] === 4, J(oct.CB915));
  ok('October: Cuddle Exp keeps 8 (list and book agree)', oct.CB917 && oct.CB917['2026-10-07'] === 8, J(oct.CB917));
  ok('a mover\'s Cuddle day (6 Oct) takes Cuddle\'s target (8), never the Courtesy row\'s 6',
    oct.CB916 && oct.CB916['2026-10-06'] === 8, J(oct.CB916));
  ok('…and the same mover\'s Courtesy days (7, 8 Oct) take the list row\'s 6',
    oct.CB916 && oct.CB916['2026-10-07'] === 6 && oct.CB916['2026-10-08'] === 6, J(oct.CB916));

  const octD = await digestRows(page, '2026-10');
  const d911 = (octD.agents || []).find((a) => a.code === 'CB911');
  ok('the October digest (Agent Analytics) carries CB911\'s MTD target 4 × 3 shifts = 12 and % of target from it',
    d911 && d911.target === 12 && Math.abs(d911.pctT - 6 / 12) < 1e-9, J(d911 && { t: d911.target, p: d911.pctT, s: d911.sales }));
  ok('…the Worker serves the SAME current-month daily target for that row (CM view / Ops = PULSE)',
    has(C.rosterTargets) && C.rosterTargets({ targets: { matrix: {} } }, [{ code: 'CB911', campaign: 'Courtesy', tenure: 'M1', target: 4 }])[0].target === oct.CB911['2026-10-07']);

  const septAfter = await perDay(page, '2026-09');
  ok('September per-day targets are unchanged after the October list (every agent, every day)', J(septAfter) === J(septBefore),
    J({ before: septBefore.CB911, after: septAfter.CB911 }));
  const septDigestAfter = await digestRows(page, '2026-09');
  ok('September MTD target, % of target, composite and ranks are unchanged to the cent', J(pick(septDigestAfter.agents)) === J(pick(septDigestBefore.agents)),
    J({ before: pick(septDigestBefore.agents).CB911, after: pick(septDigestAfter.agents).CB911 }));

  /* overrides still sit over the list */
  const ov = await page.evaluate(() => { const S = window.__mtd.state(); const tOf = (c) => { window.__mtd.setPeriod('2026-10', 'month');
      const f = window.__mtd.model().facts.find((x) => x.code === c && x.date === '2026-10-07'); return f ? f.target : null; };
    S.cmTargets = { matrix: { 'Courtesy|M1': 9 }, stamp: 'o1' }; window.__mtd.rebuild(); const exact = tOf('CB911');
    S.cmTargets = { matrix: { 'Courtesy|*': 7 }, stamp: 'o2' }; window.__mtd.rebuild(); const star = tOf('CB911');
    S.cmTargets = { matrix: {}, stamp: '' }; window.__mtd.rebuild(); const back = tOf('CB911');
    return { exact, star, back }; });
  ok('a CM override (Courtesy|M1 9) still wins over the list', ov.exact === 9, J(ov));
  ok('a campaign-wide override (Courtesy|* 7) still wins over the list', ov.star === 7, J(ov));
  ok('clearing the override restores the list\'s 4', ov.back === 4, J(ov));

  /* E — the Upload Station warning */
  head('E · the Upload Station names mixed targets (a warning, the list still loads)');
  await page.waitForTimeout(3200);                         // the toast is deferred past the upload's own messages
  const warn = await page.evaluate(() => { const S = window.__mtd.state();
    return { eff: JSON.parse(JSON.stringify((S.rosterEffect || {}).targets || null)), toasts: window.__toasts.slice(), onRoster: (S.roster || []).length,
      fn: typeof listTargetWarnings === 'function' }; });
  ok('the list loaded anyway (all 12 rows on the roster)', warn.onRoster === 12, String(warn.onRoster));
  const g = warn.eff && (warn.eff.mixed || []).find((m) => m.group === 'VT|M2');
  ok('the receipt names the mixed group VT|M2 with its values and counts', !!g && J(g.values) === J([{ v: 1.5, n: 2 }, { v: 2.5, n: 1 }, { v: 7, n: 1 }]) && g.blank === 1, J(warn.eff));
  ok('…and the non-numeric cell by agent (CB915 "TBC")', !!warn.eff && (warn.eff.text || []).some((t) => t.code === 'CB915' && t.raw === 'TBC'), J(warn.eff && warn.eff.text));
  ok('…a group whose agents agree is not flagged (Courtesy|Exp 6, 6)', !!warn.eff && !(warn.eff.mixed || []).some((m) => m.group === 'Courtesy|Exp'), J(warn.eff && warn.eff.mixed));
  const tt = warn.toasts.find((t) => /VT\|M2/.test(t));
  ok('the hand upload says so in neutral words (no "error", names values with counts)',
    !!tt && /1\.5 ×2/.test(tt) && /7 ×1/.test(tt) && !/error|wrong|invalid/i.test(tt), J(warn.toasts));
  if (warn.fn) {
    const live = await page.evaluate(() => JSON.parse(JSON.stringify(listTargetWarnings(
      [7, 7, 7, 7, 7, null, null, 2.5, 2.5].concat(Array(9).fill(1.5)).map((t, i) => ({ code: 'CB' + (800 + i), campaign: 'VT', tenure: 'M2', raw: t }))))));
    ok('the live 9 Oct VT|M2 shape (1.5 ×9, 2.5 ×2, 7 ×5, 2 blank) is reported exactly',
      J((live.mixed || [])[0]) === J({ group: 'VT|M2', values: [{ v: 1.5, n: 9 }, { v: 2.5, n: 2 }, { v: 7, n: 5 }], blank: 2 }), J(live));
  } else ok('listTargetWarnings exists', false);

  /* D — November */
  head('D · a November list changes November only');
  await page.evaluate(() => { window.__off += 28 * 86400000; window.__mtd.setRosterAsOf('2026-11-04'); });   // the clock moves to 6 Nov
  await page.evaluate((t) => window.__mtd.ingest('Matrix - Agent List 04.11.csv', t, 'roster', 'h027-nov'), listCsv({ ...OCT_CELLS, CB911: '5' }));
  await seedDays(page, NOV);
  const nov = await perDay(page, '2026-11');
  const oct2 = await perDay(page, '2026-10');
  const sept3 = await perDay(page, '2026-09');
  ok('November uses the November list\'s 5 for CB911', nov.CB911 && nov.CB911['2026-11-04'] === 5, J(nov.CB911));
  ok('…October keeps 4', oct2.CB911 && oct2.CB911['2026-10-07'] === 4, J(oct2.CB911));
  ok('…September keeps 3', sept3.CB911 && sept3.CB911['2026-09-02'] === 3, J(sept3.CB911));
  ok('…an unchanged cell carries on (CB912 5 in November)', nov.CB912 && nov.CB912['2026-11-04'] === 5, J(nov.CB912));
  ok('PULSE: no page errors (engine run)', !P.errs.length, P.errs.join(' | '));
} finally { await P.page.close(); }

/* ═══════════════════════════ F · backfill ═══════════════════════════ */
head('F · a list ingested before this build takes its targets from the record');
const F = await freshPage();
try {
  const page = F.page;
  const res = await page.evaluate(async ({ AG }) => {
    const S = window.__mtd.state();
    S.roster = []; S.att = {}; S.calls = {}; S.sales = {}; S.orgHist = {}; S.campaignMoves = {}; S.cmTargets = { matrix: {}, stamp: '' }; S.files = []; S.leavers = {};
    const rec = [];
    for (const [code, camp, tl, ten, , oct] of AG) { if (code === 'CB916') continue;
      S.roster.push({ code, name: 'Agent ' + code, sf: 'Agent ' + code, tl, campaign: camp, tenure: ten, callx: '', target: 3, start: '2026-01-05' });
      recordOrgList(code, '2026-09-01', { campaign: camp, tl, tenure: ten });
      recordOrgList(code, '2026-10-09', { campaign: camp, tl, tenure: ten });          // the old build: no target recorded
      rec.push({ code, name: 'Agent ' + code, sf: 'Agent ' + code, tl, campaign: camp, tenure: ten, callx: '', start: '2026-01-05',
        target: 3, list_target: oct === '' || oct === 'TBC' ? null : +oct, rule_target: 3 }); }
    S.rosterFp = 'fp-027';
    window.__vasHydrated = true; sessionStorage.setItem('cbx_token', 'probe');
    const before = typeof listTargetAt === 'function' ? listTargetAt('CB911', '2026-10-07') : 'no listTargetAt';
    await adoptRosterFromRecord({ fingerprint: 'fp-027', as_of: '2026-10-09', roster: rec, targets_from: '2026-10' });
    const after = typeof listTargetAt === 'function' ? listTargetAt('CB911', '2026-10-07') : null;
    const sept = typeof listTargetAt === 'function' ? listTargetAt('CB911', '2026-09-02') : null;
    const blank = typeof listTargetAt === 'function' ? listTargetAt('CB914', '2026-10-07') : null;
    /* review fix: a November row with a placeholder leader and a BLANK cell must not inherit October's 4 */
    recordOrgList('CB911', '2026-11-04', { campaign: 'Courtesy', tl: 'TBC', tenure: 'M1', target: '' });
    const tbcNov = typeof listTargetAt === 'function' ? listTargetAt('CB911', '2026-11-05') : 'x';
    const tbcOct = typeof listTargetAt === 'function' ? listTargetAt('CB911', '2026-10-07') : null;
    const tbcTl = (orgAt('CB911', '2026-11-05') || {}).tl;
    return { before: JSON.parse(JSON.stringify(before)), after: JSON.parse(JSON.stringify(after)), sept: JSON.parse(JSON.stringify(sept)), blank: JSON.parse(JSON.stringify(blank)),
      roster: S.roster.length, tbcNov: JSON.parse(JSON.stringify(tbcNov)), tbcOct: JSON.parse(JSON.stringify(tbcOct)), tbcTl };
  }, { AG });
  ok('before the poll, the old build\'s October segment carries no target', res.before === null, J(res.before));
  ok('an unchanged-fingerprint poll records the record\'s list_target for October (CB911 → 4)', res.after && res.after.target === 4, J(res.after));
  ok('…September stays without a list target', res.sept === null, J(res.sept));
  ok('…a blank cell records nothing (rule book)', res.blank === null, J(res.blank));
  ok('a TBC-led November row with a blank cell falls to the rule book (no inherited 4), keeps the real leader, October keeps 4',
    res.tbcNov === null && res.tbcOct && res.tbcOct.target === 4 && res.tbcTl === 'Leader Alpha', J({ n: res.tbcNov, o: res.tbcOct, tl: res.tbcTl }));
  ok('…the roster is untouched by the backfill', res.roster === AG.length - 1, String(res.roster));
  ok('PULSE: no page errors (backfill)', !F.errs.length, F.errs.join(' | '));
} finally { await F.page.close(); }
/* ═══════════════════════════ H · the headless publisher ═══════════════════════════ */
/* LIVE 11 Oct: tools/digest-republish.mjs --apply published agent-digest-2026-10 with Courtesy still on 3/4/5. The tool
   boots the held vas-state (history recorded before 027: no targets) and adopts kv:roster-current with ITS OWN copy of
   the adoption — raw rows (the cell is `target`, there is no list_target) and, on an unchanged fingerprint, it returned
   before anything was recorded. Here the tool's own in-page function runs against that exact situation. */
head('H · the headless publisher (digest-republish) records the list targets of a list it already holds');
const H = await freshPage();
try {
  const page = H.page;
  const TOOL = fs.readFileSync(path.join(ROOT, 'tools', 'digest-republish.mjs'), 'utf8');
  const m = TOOL.match(/const adopted = await page\.evaluate\((\(j\) => \{[\s\S]*?\n    \}), rv\);/);
  ok('the tool\'s adoption function is found', !!m);
  const OCT_ALL = Array.from({ length: 31 }, (_, i) => '2026-10-' + String(i + 1).padStart(2, '0'));
  const res = await page.evaluate(async ({ AG, fnSrc, OCT_ALL }) => {
    const S = window.__mtd.state();
    S.roster = []; S.att = {}; S.calls = {}; S.sales = {}; S.tracker = {}; S.orgHist = {}; S.vici = {}; S.cancRows = {}; S.viciDays = {};
    S.evals = {}; S.board = {}; S.adjust = {}; S.refs = null; S.campaignMoves = {}; S.cmTargets = { matrix: {}, stamp: '' }; S.files = []; S.leavers = {};
    const rec = [];
    for (const [code, camp, tl, ten, , oct] of AG) { if (code === 'CB916') continue;
      S.roster.push({ code, name: 'Agent ' + code, sf: 'Agent ' + code, tl, campaign: camp, tenure: ten, callx: '', target: 3, start: '2026-01-05' });
      recordOrgList(code, '2026-09-01', { campaign: camp, tl, tenure: ten });
      recordOrgList(code, '2026-10-09', { campaign: camp, tl, tenure: ten });           // held history: no targets
      rec.push({ code, name: 'Agent ' + code, sf: 'Agent ' + code, tl, campaign: camp, tenure: ten, callx: '', start: '2026-01-05', target: oct === '' ? null : oct }); }
    /* every October weekday worked, so the model prices every day of the month */
    for (const d of OCT_ALL) { const w = new Date(d + 'T00:00:00Z').getUTCDay(); if (w === 0 || w === 6) continue;
      S.att[d] = {}; S.calls[d] = {}; S.sales[d] = {};
      for (const [code] of AG) { if (code === 'CB916') continue; S.att[d][code] = 'P'; S.calls[d][code] = { talk: 3600, calls: 30, ans: 15, opt: 0, saleD: 0, v: 1 };
        S.sales[d][code] = { n: 1, gwp: 99, x: 86.08, u: 'case', a: { ['K' + code + d]: 86.08 } }; } }
    S.files = [{ name: 'seed-oct', type: 'attendance', dates: OCT_ALL, rows: 1, at: '2026-10-31 18:00' }];
    S.rosterFp = 'fp-live';
    const adopt = (0, eval)('(' + fnSrc + ')');
    const out = adopt({ fingerprint: 'fp-live', as_of: '2026-10-09', roster: rec });
    window.__mtd.setPeriod('2026-10', 'month');
    const by = {}; for (const f of window.__mtd.model().facts) { if (f.rangeAgg || !f.emp) continue; (by[f.code] = by[f.code] || {})[f.date] = f.target / f.emp; }
    return { out, by };
  }, { AG, fnSrc: m ? m[1] : '() => ({})', OCT_ALL });
  const days = (c) => Object.keys(res.by[c] || {});
  const all = (c, v) => days(c).length > 0 && days(c).every((d) => res.by[c][d] === v);
  ok('the publisher\'s October run prices CB911 (M1) at the list\'s 4 on EVERY worked day, 1–31 (not only from the 9th)',
    all('CB911', 4) && days('CB911').length >= 20 && days('CB911')[0] === '2026-10-01', J({ n: days('CB911').length, first: days('CB911')[0], v: [...new Set(Object.values(res.by.CB911 || {}))] }));
  ok('…CB912 (M2) 5 and CB913 (Exp) 6 on every worked day', all('CB912', 5) && all('CB913', 6),
    J({ m2: [...new Set(Object.values(res.by.CB912 || {}))], exp: [...new Set(Object.values(res.by.CB913 || {}))] }));
  ok('…a blank cell stays on the rule book (CB914 3) and TBC (CB915 4)', all('CB914', 3) && all('CB915', 4));
  ok('PULSE: no page errors (headless publisher)', !H.errs.length, H.errs.join(' | '));
} finally { await H.page.close(); }

await browser.close(); srv.close();

/* ═══════════════════════════ G · Ops ═══════════════════════════ */
head('G · Ops — rule target before the list\'s month, the list\'s from it');
{
  const OPS = fs.readFileSync(path.join(ROOT, 'Chatterbox_AgentOS_Analytics.html'), 'utf8');
  const m = OPS.match(/function opsTargetFor\(i,win\)\{[\s\S]*?\n\}/);
  ok('Ops has one target chooser (opsTargetFor)', !!m);
  if (m) {
    const f = new Function(m[0] + '; return opsTargetFor;')();
    const i = { target: 4, ruleTarget: 3, targetFrom: '2026-10' };
    ok('a September window reads the rule target (3)', f(i, { from: '2026-09-01', to: '2026-09-30' }) === 3);
    ok('an October window reads the list\'s target (4)', f(i, { from: '2026-10-01', to: '2026-10-31' }) === 4);
    ok('no record month (an older Worker) → the served target', f({ target: 4 }, { from: '2026-09-01', to: '2026-09-30' }) === 4);
    ok('no target at all → null', f({}, { from: '2026-10-01', to: '2026-10-31' }) === null);
  }
  ok('Ops maps the served rule target and month from /api/roster', /'Rule Target':a\.rule_target/.test(OPS) && /'Target From':/.test(OPS));
  ok('Ops re-syncs when the served targets move without a new list (targets_rev)', /targets_rev/.test(OPS));
  ok('acStats reads the target through opsTargetFor', /const target=opsTargetFor\(i,win\)/.test(OPS));
}

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
