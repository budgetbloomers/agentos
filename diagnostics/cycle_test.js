/* Cycle panel: the roster queue reads "Matrix Cuddle" but cycleTargets is written
   "Cuddle". Before the campBucket fix that mismatch zeroed the whole panel while the
   Target still rendered from the rule. Asserts money/sales/days now attribute. */
const http = require('http'); const fs = require('fs'); const path = require('path');
const { chromium } = require('playwright-core');
const { WORK: SP, CHROME } = require('./common.js');

const srv = http.createServer((req, res) => {
  const p = path.join(SP, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(SP) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.csv': 'text/csv' }[path.extname(p)] || 'text/plain' });
  fs.createReadStream(p).pipe(res);
});
let fails = 0;
const ok = (n, g, w) => { const p = JSON.stringify(g) === JSON.stringify(w); if (!p) { fails++; console.log('  FAIL', n, '· got', JSON.stringify(g), '· want', JSON.stringify(w)); } else console.log('  ok', n); };

(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const b = await chromium.launch({ executablePath: CHROME });
  const page = await b.newPage({ viewport: { width: 1600, height: 1000 } });
  const errs = []; const benign = /workers\.dev|Failed to fetch|net::|ERR_|favicon|fonts\.g/;
  page.on('pageerror', e => { if (!benign.test(String(e))) errs.push(String(e).slice(0, 200)); });
  await page.goto(`http://127.0.0.1:${srv.address().port}/test_current.html`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => document.dispatchEvent(new Event('cbx-authed')));
  await page.waitForFunction(() => { try { return __initDone === true } catch (e) { return false } }, null, { timeout: 30000, polling: 300 });

  // Roster queue uses the REAL label ("Matrix Cuddle"); targets use the short name.
  const res = await page.evaluate(() => {
    state.cbInfo = {
      CB1: { name: 'A One', cb: 'CB1', queue: 'Matrix Cuddle', tl: 'Lead A', tenure: 'M1' },
      CB2: { name: 'B Two', cb: 'CB2', queue: 'Matrix Courtesy', tl: 'Lead B', tenure: 'M1' },
    };
    state.rules.cycleStart = { single: true, vals: ['2026-07-01'] };
    state.rules.cycleDialingDays = { single: true, vals: ['21'], numeric: true };
    state.rules.cycleTargets = { vals: ['Cuddle:1000', 'Courtesy:1000'] };
    state.sfOwnerMap = state.sfOwnerMap || {};
    // Two BI accounts, one per campaign, on two distinct days.
    state.facts.BI_ACTIVE_CASES = [
      { account_number: 'A1', owner: 'A One', charge_amount: 100, contract_create_date: '2026-07-02', _d: '2026-07-02', case_number: 'C1' },
      { account_number: 'A2', owner: 'A One', charge_amount: 50, contract_create_date: '2026-07-03', _d: '2026-07-03', case_number: 'C2' },
      { account_number: 'B1', owner: 'B Two', charge_amount: 200, contract_create_date: '2026-07-02', _d: '2026-07-02', case_number: 'C3' },
    ];
    state.agentMap = state.agentMap || {};
    state.sfOwnerMap['a one'] = 'CB1'; state.sfOwnerMap['b two'] = 'CB2';
    if (typeof bumpDataVer === 'function') bumpDataVer();
    const CC = cycleCalc('cycle');
    return { targets: CC.targets, byCamp: CC.byCamp, campSales: CC.campSales,
             pastCuddle: CC.pastOf('Cuddle'), pastCourtesy: CC.pastOf('Courtesy'), unatt: CC.unatt };
  });

  console.log('  targets:', JSON.stringify(res.targets), ' byCamp:', JSON.stringify(res.byCamp));
  ok('target names canonicalised', res.targets.map(t => t[0]), ['Cuddle', 'Courtesy']);
  ok('"Matrix Cuddle" money lands on the Cuddle target', Math.round((res.byCamp.Cuddle || 0) * 100) / 100, 172.5);   // (100+50) x 1.15
  ok('"Matrix Courtesy" money lands on the Courtesy target', Math.round((res.byCamp.Courtesy || 0) * 100) / 100, 230); // 200 x 1.15
  ok('Cuddle sales counted', res.campSales.Cuddle || 0, 2);
  ok('Courtesy sales counted', res.campSales.Courtesy || 0, 1);
  ok('Days Past follows the money (2 distinct days), not the 21-day fallback', res.pastCuddle, 2);
  ok('Courtesy Days Past = 1', res.pastCourtesy, 1);
  ok('nothing fell into unattributed', res.unatt, 0);

  // ---- blank Campaign column: money must be COUNTED and REPORTED, never silently binned ----
  const blank = await page.evaluate(() => {
    state.cbInfo = {
      CB1: { name: 'A One', cb: 'CB1', queue: 'Matrix Cuddle', tl: 'Lead A', tenure: 'M1' },
      CB9: { name: 'No Queue', cb: 'CB9', queue: '', tl: 'Lead A', tenure: 'M1' },   // Campaign column blank
    };
    state.sfOwnerMap = { 'a one': 'CB1', 'no queue': 'CB9' };
    state.facts.BI_ACTIVE_CASES = [
      { account_number: 'A1', owner: 'A One',    charge_amount: 100, contract_create_date: '2026-07-02', _d: '2026-07-02', case_number: 'C1' },
      { account_number: 'Z1', owner: 'No Queue', charge_amount: 400, contract_create_date: '2026-07-02', _d: '2026-07-02', case_number: 'C9' },
      { account_number: 'Z2', owner: 'No Queue', charge_amount: 600, contract_create_date: '2026-07-03', _d: '2026-07-03', case_number: 'C10' },
    ];
    if (typeof bumpDataVer === 'function') bumpDataVer();
    const CC = cycleCalc('cycle');
    go('sales');
    return { noQ: Math.round(CC.noQ * 100) / 100, noQn: CC.noQn, agents: CC.noQagents,
             cuddle: Math.round((CC.byCamp.Cuddle || 0) * 100) / 100,
             banner: /NO campaign on the Agent List/.test(document.body.innerText || '') };
  });
  ok('blank-Campaign money is counted, not dropped', blank.noQ, 1150);       // (400+600) x 1.15
  ok('blank-Campaign sales counted', blank.noQn, 2);
  ok('affected agents counted', blank.agents, 1);
  ok('real campaign money still attributes', blank.cuddle, 115);            // 100 x 1.15
  ok('the page REPORTS it (banner rendered)', blank.banner, true);
  ok('unplaceable money is NOT spread into a campaign', blank.cuddle === 115, true);

  if (errs.length) { fails++; console.log('  FAIL page errors', errs); }
  console.log(fails ? 'CYCLE PANEL: FAILED' : 'CYCLE PANEL: all passed');
  await b.close(); srv.close(); process.exit(fails ? 1 : 0);
})().catch(e => { console.log('HARNESS ERROR:', e.message); process.exit(1); });
