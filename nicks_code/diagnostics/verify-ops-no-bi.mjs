/* WITH NO MONEY SOURCE, SALES METRICS ABSTAIN — THEY DO NOT SCORE ZERO.
 *
 * Sales and GWP come from the Power BI Active Cases export and nowhere else (non-negotiable
 * 6: "with no BI file loaded, money reads blank and says so"). Before this fix, no BI file
 * meant sale.n was 0 for everyone, and 0 was read as a number rather than as an absence:
 *
 *   - Target Achievement scored a hard 0 on a weight of 20,
 *   - Conversion scored a hard 0 on a weight of 10,
 *   - so every composite on the floor lost ~30 points with nothing on the page saying why,
 *   - and the NBA ladder handed every team leader "Low Sales Achievement — Volume at 0% of
 *     target (60–90% band)", a band that does not contain its own number.
 *
 * GWP/Sale and the GWP percentile already abstained. These now match them. The other
 * direction matters just as much: an agent who genuinely sold nothing WITH a BI file loaded
 * must still score 0 and must still fire the ladder — that is a real finding, not a gap.
 *
 * Run: node verify-ops-no-bi.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
const AGENTOS = 'C:/Users/aarav/OneDrive/Desktop/Chatterbox Agent OS/agentos';
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
await new Promise(r => srv.listen(8217, '127.0.0.1', r));
const b = await chromium.launch();
const page = await b.newPage();
const errs = []; page.on('pageerror', e => errs.push(String(e.message).slice(0, 120)));
await page.goto('http://127.0.0.1:8217/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);

const out = await page.evaluate(() => {
  const win = { from: '2026-08-01', to: '2026-08-31' };
  const cb = 'CB901';
  /* One agent with a full attendance and QA picture, a target, and leads to convert —
     everything EXCEPT a money source. This is the state the floor sits in on the first
     morning of a month, before the BI export arrives. */
  const setup = (withBI) => {
    state.filters = {};
    state.cbInfo = { [cb]: { name: 'Test Agent', code: cb, tl: 'TL A', queue: 'Cuddle', tenure: 'M2', target: 0.25 } };
    /* present_flag is DERIVED from the status code on the way through rowsFor(), so a row
       that only sets the flag comes back marked absent. 'P' is the register's own code. */
    state.facts.ATTENDANCE = Array.from({ length: 20 }, (_, i) =>
      ({ employee_code: cb, status_code: 'P', status: 'Present', present_flag: 1,
        _d: '2026-08-' + String(i + 1).padStart(2, '0') }));
    state.facts.QA_EVALUATIONS = [{ cb_code: cb, score_percent: 85, _d: '2026-08-05' }];
    state.facts.SF_OPEN_CASES = Array.from({ length: 10 }, (_, i) =>
      ({ case_number: 'K' + i, cb: cb, cb_code: cb, status: '1st attempt', _d: '2026-08-04' }));
    state.facts.BI_ACTIVE_CASES = withBI ? [{ case_number: 'K0', account_number: 'A0', cb: cb, cb_code: cb,
      owner: 'Test Agent', charge_amount: 0, _d: '2026-08-04', contract_create_date: '2026-08-04' }] : [];
    /* rowsFor() memoises on _dataVer. Writing straight into state.facts is not an upload, so
       nothing bumps it and the boot render's empty result would be served back to us. */
    if (typeof _dataVer !== 'undefined') _dataVer++;
  };
  const read = (withBI) => {
    setup(withBI);
    const C = acCtx(win);
    const st = acStats(cb, win, C);
    const nba = acNBA(st);
    return { biLoaded: biLoaded(), ta: st.ta, conv: st.conv, spd: st.spd, gwpSale: st.gwpSale,
      scTA: st.sc['Target Ach'], scConv: st.sc['Conversion'], rule: nba && nba.code, title: nba && nba.label,
      detail: nba && nba.detail };
  };
  const noBI = read(false);
  const withBI = read(true);
  /* And the composite: the abstention must leave the denominator, not sit in it as a 0. */
  const comps = (function () {
    const mk = (ta, conv) => ({ cb, gwp: 0, group: 'M2', crit: 0, qaN: 5, sched: 20, sales: 0, calls: 50,
      sc: { 'GWP/Sale': null, 'Target Ach': ta, 'QA': 85, 'Conversion': conv, 'Talk': 60, 'Attendance': 90 } });
    const abstain = [mk(null, null)], zeroed = [mk(0, 0)];
    applyGroupPercentiles(abstain); applyGroupPercentiles(zeroed);
    return { abstain: abstain[0].comp.adj, zeroed: zeroed[0].comp.adj };
  })();
  return { noBI, withBI, comps };
});
console.log('  no BI : ' + JSON.stringify(out.noBI));
console.log('  BI on : ' + JSON.stringify(out.withBI));

ok('with no BI file, the fixture really has no money source', out.noBI.biLoaded === false);
ok('Target Achievement abstains rather than scoring 0', out.noBI.ta === null && out.noBI.scTA === null,
  'ta=' + out.noBI.ta + ' sc=' + out.noBI.scTA);
ok('Conversion abstains rather than scoring 0', out.noBI.conv === null && out.noBI.scConv === null,
  'conv=' + out.noBI.conv + ' sc=' + out.noBI.scConv);
ok('sales per day abstains too', out.noBI.spd === null, String(out.noBI.spd));
ok('the ladder does not call it a sales failure', !['R4A', 'R6'].includes(out.noBI.rule),
  'fired ' + out.noBI.rule + ': ' + out.noBI.title);
ok('the abstention leaves the composite denominator (' + out.comps.abstain + ' vs ' + out.comps.zeroed + ' zeroed)',
  out.comps.abstain > out.comps.zeroed, JSON.stringify(out.comps));

/* THE OTHER DIRECTION — a real zero must still be a zero. */
ok('with a BI file, a genuine zero still scores 0', out.withBI.biLoaded === true && out.withBI.ta === 0 && out.withBI.scTA === 0,
  'ta=' + out.withBI.ta + ' sc=' + out.withBI.scTA);
ok('with a BI file, the ladder still raises the sales failure', ['R4A', 'R6'].includes(out.withBI.rule),
  'fired ' + out.withBI.rule + ': ' + out.withBI.title);
/* and when it is R6 below the band, it must not quote a band its own number is outside of */
const d = String(out.withBI.detail || '');
ok('R6 does not quote a band that excludes its own number',
  out.withBI.rule !== 'R6' || !/0% of target \(\d+/.test(d), d.slice(0, 120));
ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
await b.close(); srv.close();
process.exit(fail ? 1 : 0);
