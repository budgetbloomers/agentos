import { chromium } from 'playwright';
import fs from 'fs';
const UP = '/root/.claude/uploads/bb74fb1d-2bec-5cbb-9a06-3c8a2bee5fc3';
const E = JSON.parse(fs.readFileSync('expected.json', 'utf8'));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
await page.goto('file:///home/user/nicks_code/index.html');
const ing = (n, p) => page.evaluate(([a, b]) => window.__mtd.ingest(a, b), [n, fs.readFileSync(p, 'utf8')]);
await ing('SF_Activated_Services__01_07_2026__1_.csv', UP + '/ff35bccd-SF_Activated_Services__01_07_2026__1_.csv');
await ing('call_records__29_.csv', UP + '/eb032abb-call_records__29_.csv');
await ing('attendance_20251001_to_20260703.csv', UP + '/ed3c7470-attendance_20251001_to_20260703.csv');
await ing('evaluationsfullexport20260707_1.csv', UP + '/22341ec6-evaluationsfullexport20260707_1.csv');
await ing('Matrix__Agent_List__1_.csv', UP + '/eac898bc-Matrix__Agent_List__1_.csv');
await ing('VAS__June_Monthtodate_Tracker.csv', UP + '/1150391f-VAS__June_Monthtodate_Tracker.csv');
await ing('SF_Activated_Services__May_2026.csv', UP + '/c68f1b7b-SF_Activated_Services__May_2026.csv');
await ing('SF_Open_Cases_Report.csv', UP + '/1c3564a2-SF_Open_Cases_Report.csv');

let pass = 0, fail = 0; const failures = [];
const ok = (name, got, want, tol = 0.51) => {
  const good = (got == null && want == null) || (got != null && want != null && Math.abs(got - want) <= tol);
  if (good) pass++; else { fail++; failures.push(`${name}: got ${got} want ${want}`); }
};

// ============ SECTION 1: July 1 vs independent recompute ============
await page.evaluate(() => window.__mtd.setPeriod('2026-07', 'calendar'));
await page.waitForTimeout(250);
let m = await page.evaluate(() => {
  const M = window.__mtd.model();
  const vas = {}; // per-agent from model, keyed by normalised name
  for (const camp of ['Cuddle', 'Courtesy']) for (const c in M.mtdCC[camp]) {
    const g = M.mtdCC[camp][c];
    vas[g.agent.toLowerCase().replace(/[^a-z]/g, '')] = { sales: g.sales, gwp: g.gwp };
  }
  return { grand: M.grand, vt: M.campAgg.VT, qaAvg: M.qaAvg, qaN: M.qaN, vas };
});
ok('JUL sales total', m.grand.sales, E['july.sales']);
ok('JUL GWP total', m.grand.gwp, E['july.gwp']);
ok('JUL VAS talk secs', m.grand.talk, E['july.vas.talk']);
ok('JUL VAS calls', m.grand.calls, E['july.vas.calls']);
ok('JUL VAS answered', m.grand.ans, E['july.vas.ans']);
ok('JUL opt-ins', m.grand.opt, E['july.vas.opt']);
ok('JUL QA evaluations n', m.qaN, E['july.qa.n']);
ok('JUL QA average', m.qaAvg * 100, E['july.qa.avg'], 0.01);
ok('JUL VT calls', m.vt?.calls, E['july.vt.calls']);
ok('JUL VT talk', m.vt?.talk, E['july.vt.talk']);
ok('JUL VT answered', m.vt?.ans, E['july.vt.ans']);
ok('JUL VT sales(disp)', m.vt?.sales, E['july.vt.saleD']);
for (const [name, s, g] of E['july.top']) {
  const a = m.vas[name] || {};
  ok(`JUL agent ${name} sales`, a.sales, s);
  ok(`JUL agent ${name} GWP`, a.gwp, g);
}

// ============ SECTION 2: formula identities (every ratio recomputed) ============
const iden = await page.evaluate(() => {
  const M = window.__mtd.model();
  const out = [];
  const checkAgg = (label, o) => {
    if (!o) return;
    const add = (k, got, want) => out.push([label + '.' + k, got, want]);
    if (o.emp) add('att', o.att, o.act / o.emp);
    if (o.target) add('pctT', o.pctT, o.sales / o.target);
    if (o.act) add('spd', o.spd, o.sales / o.act);
    if (o.gwpT) add('pctG', o.pctG, o.gwp / o.gwpT);
    if (o.sales) add('aveG', o.aveG, o.gwp / o.sales);
    if (o.sales) add('optPct', o.optPct, o.opt / o.sales);
    if (o.ans) add('aht', o.aht, o.talk / o.ans);
    if (o.act) add('aveTalk', o.aveTalk, o.talk / o.act);
  };
  checkAgg('grand', M.grand);
  for (const c in M.campAgg) checkAgg('camp.' + c, M.campAgg[c]);
  for (const k in M.tlAgg) checkAgg('tl.' + k, M.tlAgg[k]);
  let i = 0;
  for (const camp of ['Cuddle', 'Courtesy']) for (const c in M.mtdCC[camp]) { if (i++ % 7 === 0) checkAgg('agent.' + c, M.mtdCC[camp][c]); }
  // cross-sums: campaign agg equals sum of its agent rows; grand equals Cuddle+Courtesy
  for (const camp of ['Cuddle', 'Courtesy', 'VT']) {
    const rows = Object.values(M.mtdCC[camp] || {});
    if (!rows.length) continue;
    const sum = k => rows.reduce((s, r) => s + (r[k] || 0), 0);
    for (const k of ['sales', 'gwp', 'emp', 'act', 'opt', 'talk', 'calls'])
      out.push(['sum.' + camp + '.' + k, M.campAgg[camp][k], sum(k)]);
  }
  for (const k of ['sales', 'gwp', 'talk', 'opt', 'emp', 'act'])
    out.push(['grand=Cu+Co.' + k, M.grand[k], (M.campAgg.Cuddle?.[k] || 0) + (M.campAgg.Courtesy?.[k] || 0)]);
  // weeks partition month: per-campaign weekly sums equal MTD
  for (const camp of ['Cuddle', 'Courtesy']) {
    let wsum = 0;
    for (const w of M.weeks) for (const c in ((M.wtdCC[w.num] || {})[camp] || {})) wsum += M.wtdCC[w.num][camp][c].sales;
    out.push(['weeks=mtd.' + camp + '.sales', M.campAgg[camp]?.sales || 0, wsum]);
  }
  return out;
});
for (const [name, got, want] of iden) ok('ID(jul) ' + name, got, want, 1e-9 + Math.abs(want) * 1e-9);

// ============ SECTION 3: June vs the workbook's own published numbers ============
await page.evaluate(() => window.__mtd.setPeriod('2026-06', 'calendar'));
await page.waitForTimeout(250);
m = await page.evaluate(() => {
  const M = window.__mtd.model();
  const per = {};
  for (const camp of ['Cuddle', 'Courtesy']) for (const c in M.mtdCC[camp]) {
    const g = M.mtdCC[camp][c];
    per[camp + '|' + g.agent.toLowerCase().replace(/[^a-z]/g, '')] = g;
  }
  return { per, byDate: M.dailyByDate, qaAvg: M.qaAvg, qaN: M.qaN, grand: M.grand,
    cu: M.campAgg.Cuddle, co: M.campAgg.Courtesy, snap: M.prevSnapshot };
});
// per-date totals equal the workbook daily sheet
for (const [d, v] of Object.entries(E['june.byDate'])) {
  const got = (m.byDate[d]?.Cuddle || 0) + (m.byDate[d]?.Courtesy || 0);
  ok(`JUN day ${d} sales`, got, v);
}
// every agent row vs the workbook's published MTD sheets.
// The workbook's "MTD - Courtesy" pivot was last refreshed 29 June (proven: all 64 rows
// equal the daily sheet through 29/06), so Courtesy compares against a 1-29 June range —
// which also exercises the custom date-range engine. Cuddle's tab is fresh: full month.
let agentChecks = 0;
const perAt = async (from, to) => {
  await page.evaluate(([f, tt]) => window.__mtd.setRange(f, tt), [from, to]);
  await page.waitForTimeout(250);
  return page.evaluate(() => {
    const M = window.__mtd.model(); const per = {};
    for (const camp of ['Cuddle', 'Courtesy']) for (const c in M.mtdCC[camp]) {
      const g = M.mtdCC[camp][c];
      per[camp + '|' + g.agent.toLowerCase().replace(/[^a-z]/g, '')] = g;
    }
    return per;
  });
};
const per29 = await perAt('2026-06-01', '2026-06-29');
// the workbook pivot uses her Salesforce name; the daily sheet uses her dialer name (CB156)
const ALIAS = { ashneekasavanisankarparsad: 'kasavanisnakarparsad' };
for (const w of E['june.mtd']) {
  let nk = w.agent.toLowerCase().replace(/[^a-z]/g, '');
  nk = ALIAS[nk] || nk;
  const key = w.camp + '|' + nk;
  const g = (w.camp === 'Courtesy' ? per29 : m.per)[key];
  if (!g) { fail++; failures.push(`JUN missing agent ${w.camp}/${w.agent}`); continue; }
  for (const k of ['emp', 'act', 'target', 'sales', 'gwpT', 'gwp', 'opt']) {
    if (w[k] == null) continue;
    ok(`JUN ${w.agent} (${w.camp}) ${k}`, g[k], w[k]); agentChecks++;
  }
}
await page.evaluate(() => window.__mtd.setPeriod('2026-06', 'calendar'));
await page.waitForTimeout(250);
ok('JUN QA evaluations n', m.qaN, E['june.qa.n']);
ok('JUN QA average', m.qaAvg * 100, E['june.qa.avg'], 0.01);
ok('JUN grand sales', m.grand.sales, 7540);
ok('JUN grand GWP', m.grand.gwp, 763313);
ok('JUN cuddle sales', m.cu.sales, 4701);
ok('JUN courtesy sales', m.co.sales, 2839);
ok('JUN prev-snapshot(May) sales', m.snap?.sales, E['may.sales']);
ok('JUN prev-snapshot(May) gwp', m.snap?.gwp, E['may.gwp']);

// June identities too
const idenJ = await page.evaluate(() => {
  const M = window.__mtd.model(); const out = [];
  const o = M.grand;
  out.push(['att', o.att, o.act / o.emp], ['pctT', o.pctT, o.sales / o.target],
    ['spd', o.spd, o.sales / o.act], ['pctG', o.pctG, o.gwp / o.gwpT], ['aveG', o.aveG, o.gwp / o.sales]);
  return out;
});
for (const [name, got, want] of idenJ) ok('ID(jun) grand.' + name, got, want, 1e-9);

// ============ SECTION 4: May snapshot + KPI card DOM spot-check ============
const snap = await page.evaluate(() => window.__mtd.state().snapshots['2026-05']);
ok('MAY snapshot sales', snap?.sales, E['may.sales']);
ok('MAY snapshot GWP', snap?.gwp, E['may.gwp']);
await page.evaluate(() => window.__mtd.go('dashboard'));
await page.waitForTimeout(600);
const dom = await page.evaluate(() => {
  const M = window.__mtd.model();
  const cards = [...document.querySelectorAll('.kpi2')].map(c => ({
    lab: c.querySelector('.lab2')?.textContent, val: c.querySelector('.val')?.textContent }));
  return { cards: cards.slice(0, 6), gwp: M.grand.gwp, sales: M.grand.sales };
});
const gwpCard = dom.cards.find(c => c.lab === 'Total GWP');
const salesCard = dom.cards.find(c => c.lab === 'Policies Sold');
ok('DOM Total GWP card', parseFloat(gwpCard.val.replace(/[^\d.]/g, '')), dom.gwp);
ok('DOM Policies card', parseFloat(salesCard.val.replace(/[^\d]/g, '')), dom.sales);
// VT gated: coming soon shows, VT absent from campaign filter
await page.evaluate(() => { const S = window.__mtd.state(); S.ui.mtdSub = 'VT'; window.__mtd.go('mtd'); });
await page.waitForTimeout(300);
const vtGate = await page.evaluate(() => ({
  soon: document.getElementById('view').innerHTML.includes('coming soon'),
  filterHasVT: document.getElementById('fCampG').innerHTML.includes('Vehicle') }));
ok('VT tab shows coming soon', vtGate.soon ? 1 : 0, 1);
ok('VT hidden from campaign filter', vtGate.filterHasVT ? 1 : 0, 0);
await page.screenshot({ path: 'vt_coming_soon.png' });

console.log(`\n===== DIAGNOSTIC RESULT =====`);
console.log(`PASS: ${pass}  FAIL: ${fail}  (agent-level workbook checks: ${agentChecks})`);
if (failures.length) { console.log('FAILURES:'); failures.slice(0, 40).forEach(f => console.log('  ✗ ' + f)); }
console.log('JS ERRORS:', errors.length ? errors : 'none');
await browser.close();
