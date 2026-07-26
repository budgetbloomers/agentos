// PULSE golden verification via window.__mtd — synthetic fixtures, hand-computed.
// BI: Pam AC1 (30.43+33.91+21.74=86.08ex→98.992) + AC2 100→115 = 2 sales/213.992
//     Quinn AC3 60→69 (1 sale) [07-07] · Rita AC4 200→230 (1 sale) [07-08]
// grand: 4 sales · GWP 512.992 · calls 5 · talk 1600s · qaAvg (90+80+70)/3 = 80%
const http = require('http'); const fs = require('fs'); const path = require('path');
const { chromium } = require('playwright-core');
const { WORK: SP, ROOT, CHROME } = require('./common.js');
let src = fs.readFileSync(path.join(ROOT, 'nicks_code', 'index.html'), 'utf8')
  .replace(/https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/xlsx\/[^"']+/g, '/libs/xlsx.full.min.js')
  .replace(/<link[^>]*fonts[^>]*>\s*/g, '');
fs.writeFileSync(path.join(SP, 'pulse_test.html'), src);
const srv = http.createServer((req, res) => {
  const p = path.join(SP, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(SP) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript' }[path.extname(p)] || 'text/plain' });
  fs.createReadStream(p).pipe(res);
});
let fails = 0; const ok = (n, got, want, tol) => {
  const pass = (typeof want === 'number' && typeof got === 'number') ? Math.abs(got - want) <= (tol ?? 0.05) : got === want;
  if (!pass) { fails++; console.log('  FAIL', n, '· got', JSON.stringify(got), '· want', JSON.stringify(want)); } else console.log('  ok', n);
};
const csv = rows => rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n');
const ROSTER = csv([['Employee Code','Team Leader','Agent Name','Campaign','Tenure','Call x','Sales Force','Target','Start Date','Job Title'],
  ['CB1','Lead A','Pam One','Cuddle','M1','pam.dial','Pam One','2','2026-02-01','Agent'],
  ['CB2','Lead A','Quinn Two','Courtesy','M1','quinn.dial','Quinn Two','2','2026-02-01','Agent'],
  ['CB3','Lead B','Rita Three','Cuddle','M2','rita.dial','Rita Three','1','2026-02-01','Agent']]);
const BI1 = csv([['Account Number','Owner','Charge Amount','Contract Create Date'],
  ['AC1','Pam One','30.43','2026-07-07'],['AC1','Pam One','33.91','2026-07-07'],['AC1','Pam One','21.74','2026-07-07'],
  ['AC2','Pam One','100','2026-07-07'],['AC3','Quinn Two','60','2026-07-07'],['AC4','Rita Three','200','2026-07-08']]);
const BI2 = csv([['Account Number','Owner','Charge Amount','Contract Create Date'],
  ['AC5','Rita Three','50','2026-07-08']]);
const CALLS = csv([['Date & Time','Agent','Bridge','Duration','Lead Disposition'],
  ['2026-07-07 09:00','pam.dial','ANSWERED','00:10:00','Sale'],
  ['2026-07-07 09:10','pam.dial','ANSWERED','00:05:00','Insurance Opt In'],
  ['2026-07-07 09:20','pam.dial','','00:01:40','No Sale'],
  ['2026-07-07 10:00','quinn.dial','ANSWERED','00:03:20','Interested'],
  ['2026-07-08 09:00','rita.dial','ANSWERED','00:06:40','Sale']]);
const ATT = csv([['Date','Employee Code','Employee Name','Status'],
  ['2026-07-07','CB1','Pam One','Present'],['2026-07-07','CB2','Quinn Two','Present'],['2026-07-07','CB3','Rita Three','Present'],
  ['2026-07-08','CB1','Pam One','Present'],['2026-07-08','CB2','Quinn Two','Absent'],['2026-07-08','CB3','Rita Three','Present']]);
const EVALS = csv([['Date of Call','QA Agent','Sales Agent CB','Score %','Escalation Decision','Campaign'],
  ['2026-07-07','QA1','CB1','90','Pass','Cuddle'],['2026-07-07','QA1','CB1','80','Coaching','Cuddle'],
  ['2026-07-08','QA1','CB3','70','Critical Fail','Cuddle']]);
(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const b = await chromium.launch({ executablePath: CHROME });
  const pg = await b.newPage();
  const errs = []; const benign = /workers\.dev|Failed to fetch|net::|ERR_|favicon|ask-widget|auth-gate/;
  pg.on('pageerror', e => { if (!benign.test(String(e))) errs.push(String(e).slice(0, 180)); });
  await pg.goto(`http://127.0.0.1:${srv.address().port}/pulse_test.html`, { waitUntil: 'domcontentloaded' });
  await pg.waitForFunction(() => window.__mtd && typeof window.__mtd.ingest === 'function', null, { timeout: 20000, polling: 200 });
  await pg.evaluate(() => localStorage.clear());
  const ing = (n, t) => pg.evaluate(([a, b2]) => window.__mtd.ingest(a, b2), [n, t]);
  await ing('roster.csv', ROSTER); await ing('bi_g1.csv', BI1); await ing('calls.csv', CALLS);
  await ing('att.csv', ATT); await ing('evals.csv', EVALS);
  await pg.evaluate(() => window.__mtd.setPeriod('2026-07', 'calendar'));
  await pg.waitForTimeout(300);
  let m = await pg.evaluate(() => { const M = window.__mtd.model(); return { g: M.grand, qaAvg: M.qaAvg, qaN: M.qaN, cb1: (M.mtdCC.Cuddle || {}).CB1, daily: M.dailyByDate }; });
  console.log('[pulse] core model');
  ok('grand sales = 4 (unique accounts)', m.g.sales, 4);
  ok('grand GWP = 512.992 (ex × 1.15, R99 identity)', m.g.gwp, 512.992, 0.01);
  ok('grand calls = 5', m.g.calls, 5);
  ok('grand talk = 1600s', m.g.talk, 1600);
  ok('CB1 = 2 sales / R213.99', (m.cb1 || {}).sales + '|' + Math.round(((m.cb1 || {}).gwp || 0) * 100) / 100, '2|213.99');
  ok('qaAvg = 80%', m.qaAvg, 0.8, 0.001);
  ok('qaN = 3', m.qaN, 3);
  ok('daily 07-07 Cuddle/Courtesy = 2/1', (m.daily['2026-07-07'] || {}).Cuddle + '/' + (m.daily['2026-07-07'] || {}).Courtesy, '2/1');
  // idempotency: same files again → identical model
  await ing('bi_g1.csv', BI1); await ing('calls.csv', CALLS);
  await pg.evaluate(() => window.__mtd.rebuild());
  m = await pg.evaluate(() => { const M = window.__mtd.model(); return { s: M.grand.sales, g: M.grand.gwp, c: M.grand.calls }; });
  console.log('[pulse] idempotency');
  ok('re-ingest same BI → still 4 sales', m.s, 4);
  ok('re-ingest same BI → GWP unchanged', m.g, 512.992, 0.01);
  ok('re-ingest same calls → still 5', m.c, 5);
  // dashboard global filters now apply (C2): frozen agg over gFilter
  const f = await pg.evaluate(() => {
    const M = window.__mtd.model(); const S = window.__mtd.state();
    S.ui.team = 'Lead A'; const teamG = M.agg(M.facts.filter(gFilter), null).gwp;
    S.ui.team = ''; S.ui.camp = 'Cuddle'; const cuddleG = M.agg(M.facts.filter(gFilter), null).gwp;
    S.ui.camp = 'Cuddle'; S.ui.team = 'Lead A'; const rowsA = agentRows('Cuddle').map(r => r.code).join(',');
    S.ui.camp = ''; S.ui.team = ''; return { teamG, cuddleG, rowsA };
  });
  console.log('[pulse] global filters');
  ok('Team=Lead A GWP = Pam+Quinn = 282.99', f.teamG, 282.992, 0.01);
  ok('Campaign=Cuddle GWP = Pam+Rita = 443.99', f.cuddleG, 443.992, 0.01);
  ok('MTD rows honour team filter (CB1 only)', f.rowsA, 'CB1');
  // C4: overlapping second BI file, then remove the OLDER one — shared date survives
  await ing('bi_g2.csv', BI2);
  await pg.evaluate(() => window.__mtd.rebuild());
  m = await pg.evaluate(() => ({ s: window.__mtd.model().grand.sales, g: window.__mtd.model().grand.gwp }));
  ok('overlap file replaced 07-08 (4 sales, GWP 340.49)', m.s + '|' + Math.round(m.g * 100) / 100, '4|340.49');
  await pg.evaluate(() => { pg2 = 0; const S = window.__mtd.state(); const i = S.files.findIndex(x => x.name === 'bi_g1.csv'); window.confirm = () => true; removeFile(i); });
  m = await pg.evaluate(() => ({ s: window.__mtd.model().grand.sales, g: window.__mtd.model().grand.gwp }));
  console.log('[pulse] removeFile safety');
  // 07-08 survives (g2's R57.50 — the fix) and 07-07, now money-less but still holding
  // a Sale-disposition call, falls to the FROZEN provisional path: 1 sale × gwpPerUnit
  // (R89). 57.5 + 89 = 146.5. The old code deleted 07-08 too.
  ok('removing older file keeps the shared 07-08 day (57.5 survives; +1 provisional R89)', m.s + '|' + Math.round(m.g * 100) / 100, '2|146.5');
  // digest coverage
  const dig = await pg.evaluate(() => cbxVasContext());
  ok('digest states the period', /Period: 2026-07-01 to 2026-07-31/.test(dig), true);
  ok('digest has TL rollup', dig.includes('Team-leader rollup'), true);
  ok('digest has campaign totals + daily lines', dig.includes('Campaign totals') && dig.includes('Daily sales by campaign'), true);
  // tab sweep
  const tabs = await pg.evaluate(async () => {
    const out = []; const list = ['dashboard', 'mtd', 'weekly', 'daily', 'heatmap', 'workforce', 'agents', 'leaderboard', 'coaching', 'compare', 'manual', 'opencases', 'data', 'adjust', 'settings'];
    for (const t of list) { try { window.__mtd.go(t); await new Promise(r => setTimeout(r, 90)); out.push(t + ':ok'); } catch (e) { out.push(t + ':ERR ' + e.message); } }
    return out.join(' ');
  });
  ok('all tabs render without throwing', /ERR/.test(tabs), false);
  ok('no unexpected page errors', errs.length ? errs.join(' | ') : true, true);
  console.log(`PULSE GOLDEN: ${fails ? fails + ' FAILURES' : 'all passed'}`);
  await b.close(); srv.close(); process.exit(fails ? 1 : 0);
})().catch(e => { console.error('PULSE HARNESS ERROR:', String(e).slice(0, 500)); process.exit(2); });
