// Golden-value verification: every rule and calculation asserted against
// hand-computed expectations, plus runtime rule-edit liveness. node golden.js
const http = require('http'); const fs = require('fs'); const path = require('path');
const { chromium } = require('playwright-core');
const { WORK: SP, ROOT, CHROME } = require('./common.js');
const srv = http.createServer((req, res) => {
  const p = path.join(SP, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(SP) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.csv': 'text/csv' }[path.extname(p)] || 'text/plain' });
  fs.createReadStream(p).pipe(res);
});
const results = []; let fails = 0;
const ok = (name, got, want, tol) => {
  let pass;
  if (typeof want === 'number' && typeof got === 'number') pass = Math.abs(got - want) <= (tol ?? 0.05);
  else pass = got === want;
  results.push({ name, got, want, pass });
  if (!pass) { fails++; console.log('  FAIL', name, '· got', JSON.stringify(got), '· want', JSON.stringify(want)); }
};

(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const b = await chromium.launch({ executablePath: CHROME });
  const page = await b.newPage({ viewport: { width: 1600, height: 1000 } });
  const errs = [];
  const benign = /workers\.dev|Failed to fetch|net::|ERR_|favicon|fonts\.g/;
  page.on('pageerror', e => { if (!benign.test(String(e))) errs.push(String(e).slice(0, 200)); });
  await page.goto(`http://127.0.0.1:${srv.address().port}/test_current.html`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => document.dispatchEvent(new Event('cbx-authed')));
  await page.waitForFunction(() => { try { return __initDone === true } catch (e) { return false } }, null, { timeout: 30000, polling: 300 });
  await page.evaluate(() => go('uploads'));
  async function upload(key, file) {
    await page.setInputFiles(`#slot_${key} input[type=file]`, path.join(SP, 'gdata', file));
    await page.waitForSelector('#confirmLoad:not([disabled])', { timeout: 60000 });
    await page.click('#confirmLoad');
    await page.waitForFunction(() => !document.querySelector('#overlay').classList.contains('open'), null, { timeout: 60000, polling: 100 });
  }
  await upload('AGENT_LIST', 'g_agent_list.csv');
  await upload('ATTENDANCE', 'g_attendance.csv');
  await upload('CALLX_CALL_RECORDS', 'g_callx.csv');
  await upload('QA_EVALUATIONS', 'g_qa.csv');
  await upload('BI_ACTIVE_CASES', 'g_bi.csv');
  await upload('SF_OPEN_CASES', 'g_open.csv');
  await upload('SF_CLOSED_CASES', 'g_closed.csv');
  await upload('SF_INACTIVE', 'g_inactive.csv');

  // ---------- fleet KPIs ----------
  const kpi = await page.evaluate(() => {
    const win = periodWindow(); const out = {};
    state.kpis.forEach(k => out[k.id] = evalKPI(k, win));
    return out;
  });
  // calls: 10 valid rows (bad-date rejected). Bands: CB1 C/P/CS/NA · CB2 C + Engaged→NA · CB4 C · CB5 C · CB7 CS · inbound 20s→NA
  ok('total_calls = 10', kpi.total_calls, 10);
  ok('outbound_calls = 9', kpi.outbound_calls, 9);
  ok('answer_rate = 7/10 = 70%', kpi.answer_rate, 70);
  ok('unique_calls = 9 (inbound "s" excluded)', kpi.unique_calls, 9);
  ok('talk_time = 10610s', kpi.talk_time, 10610);
  // money: ex 30.43+33.91+21.74+100+60+200+10+50+120 = 626.08 → ×1.15 = 719.992 · 7 accounts
  ok('activations = 7 accounts', kpi.activations, 7);
  ok('total_gwp_ex = R626.08', kpi.total_gwp_ex, 626.08, 0.01);
  ok('total_gwp incl = R719.992', kpi.total_gwp, 719.992, 0.01);
  ok('avg_gwp_sale = 719.992/7', kpi.avg_gwp_sale, 102.856, 0.01);
  // leads: unique cases {A,B,C,D,E,F} = 6 (B open+closed = ONE) · sales 7
  ok('lead_conversion = 7/6 = 116.67%', kpi.lead_conversion, 116.667, 0.05);
  ok('cancellations = 1', kpi.cancellations, 1);
  ok('gwp_lost = 60×1.15 = 69', kpi.gwp_lost, 69, 0.01);
  ok('closed_total = 4', kpi.closed_total, 4);
  ok('no_feedback_rate = 1/4 = 25%', kpi.no_feedback_rate, 25);
  ok('open_backlog = 3', kpi.open_backlog, 3);
  ok('avg_case_age = (10+20+30)/3 = 20h', kpi.avg_case_age, 20);
  // QA: scores 90,80,95,90,70,85,92,96,82,88 → avg 86.8 · 8 Pass · 1 Coaching · 1 Critical
  ok('qa_evals = 10', kpi.qa_evals, 10);
  ok('avg_qa_score = 86.8%', kpi.avg_qa_score, 86.8, 0.01);
  ok('qa_pass_rate = 80%', kpi.qa_pass_rate, 80);
  ok('critical_rate = 10%', kpi.critical_rate, 10);
  ok('coaching_rate = 10%', kpi.coaching_rate, 10);
  ok('clean_sale_rate = 1/2 = 50% (sale-assessed only)', kpi.clean_sale_rate, 50);
  ok('unverified_sales = 7 sales − 2 QA-verified = 5', kpi.unverified_sales, 5);
  // attendance: present 14 · denom 19 (Terminated row excluded) · absence 4 (CB6×3+CB7) · leave 1 (AL)
  ok('attendance_rate = 14/19 = 73.68%', kpi.attendance_rate, 73.684, 0.01);
  ok('present_days = 14', kpi.present_days, 14);
  ok('absence_days = 4', kpi.absence_days, 4);
  ok('leave_days = 1', kpi.leave_days, 1);
  ok('absenteeism = 4/19 = 21.05%', kpi.absenteeism, 21.053, 0.01);
  // discipline
  ok('agents_in_process = 1 (CB3 open offense)', kpi.agents_in_process, 1);
  ok('open_criticals = 1', kpi.open_criticals, 1);
  ok('sla_breaches = 0', kpi.sla_breaches, 0);
  ok('repeat_offenders = 0', kpi.repeat_offenders, 0);
  ok('sm_escalations = 0', kpi.sm_escalations, 0);
  // cross
  ok('calls_per_day = 9/14', kpi.calls_per_day, 0.643, 0.001);
  ok('sales_per_day = 7/14 = 0.5', kpi.sales_per_day, 0.5, 0.001);

  // ---------- NBA engine per agent ----------
  const ag = await page.evaluate(() => {
    const win = periodWindow(); const C = acCtx(win); const out = {};
    ['CB1', 'CB2', 'CB3', 'CB4', 'CB5', 'CB6', 'CB7'].forEach(cb => {
      const st = acStats(cb, win, C);
      const peers = Object.keys(state.cbInfo).filter(k => groupOf(k) === st.group).map(k => acStats(k, win, C));
      const sorted = peers.map(p => p.gwp).sort((a, b) => a - b);
      const pct = peers.length < 2 ? 100 : sorted.filter(x => x < st.gwp).length / (peers.length - 1) * 100;
      const comp = acComposite(st, pct);
      out[cb] = { code: acNBA(st).code, tier: comp.tier.tier, pen: comp.pen, adj: comp.adj, wSum: comp.wSum, group: st.group, att: st.att, qaS: st.qaS, gwpSale: st.gwpSale, ta: st.ta, conv: st.conv, talkDay: st.talkDay, pctile: pct };
    });
    return out;
  });
  // ladder: first trigger wins, one primary each
  ok('CB6 → R1 zero attendance', ag.CB6.code, 'R1');
  ok('CB3 → R2 (QA 58.33 < 80 outranks its R2A-3 tier)', ag.CB3.code, 'R2');
  ok('CB3 tier = R2A-3 (CFR 33% ≥ 30%)', ag.CB3.tier, 'R2A-3');
  ok('CB3 penalty = pen3 = 10 (capped tier value)', ag.CB3.pen, 10);
  ok('CB7 → R3 attendance risk (66.7% < 80)', ag.CB7.code, 'R3');
  ok('CB5 → R3 (AL day is not present: 2/3)', ag.CB5.code, 'R3');
  ok('CB2 → R4 value failure (R69 < R99 floor)', ag.CB2.code, 'R4');
  ok('CB1 → R4A volume failure with value clear (ta 33% < 70)', ag.CB1.code, 'R4A');
  ok('CB4 → R10 elite', ag.CB4.code, 'R10');
  ok('CB4 group = EXP - CUDDLE (tenure-relative)', ag.CB4.group, 'EXP - CUDDLE');
  ok('CB1 group = M1', ag.CB1.group, 'M1');
  // composites (hand-computed):
  // CB1: GWP/Sale 100·25 + TA 33.33·20 + QA 85·20 + %ile 100·15 + Conv 100·10 + Talk 1.90·5 + Att 100·5 → 78.76
  ok('CB1 composite ≈ 78.76', ag.CB1.adj, 78.76, 0.3);
  ok('CB1 GWP %ile = 100 within M1', ag.CB1.pctile, 100);
  // CB2: 69.7·25 + 16.67·20 + 95·20 + 50·15 + 100·10 + 1.33·5 + 100·5 → 62.32
  ok('CB2 composite ≈ 62.32', ag.CB2.adj, 62.32, 0.3);
  // CB4: 100·25+100·20+92·20+100·15+71.43·5+100·5 over wSum 90 (conv null drops) → 96.63
  ok('CB4 composite ≈ 96.63 (weights renormalised, wSum 90)', ag.CB4.adj, 96.63, 0.3);
  ok('CB4 wSum = 90 — conversion weight dropped', ag.CB4.wSum, 90);
  ok('CB6 wSum = 40 — only TargetAch+%ile+Attendance present', ag.CB6.wSum, 40);
  ok('CB6 composite = 0', ag.CB6.adj, 0);
  // cfTier boundaries (higher-of count/rate; capped tier penalty)
  const tiers = await page.evaluate(() => [
    cfTier({ crit: 0, qaN: 5 }), cfTier({ crit: 1, qaN: 20 }), cfTier({ crit: 2, qaN: 20 }),
    cfTier({ crit: 4, qaN: 100 }), cfTier({ crit: 1, qaN: 3 })].map(t => t.tier + '|' + t.pen));
  ok('cfTier none', tiers[0], '|0');
  ok('cfTier R2A-1 note pen 2 (1 fail, 5%)', tiers[1], 'R2A-1|2');
  ok('cfTier R2A-2 by rate (10%)', tiers[2], 'R2A-2|5');
  ok('cfTier R2A-3 by count (4)', tiers[3], 'R2A-3|10');
  ok('cfTier R2A-3 by rate (33%)', tiers[4], 'R2A-3|10');

  // ---------- conversion split reconciliation + unattributed ----------
  const cs = await page.evaluate(() => { const w = periodWindow(); const c = convSplit(w); const prem = accountPremiums(w); return { c, un: prem.filter(e => !e.cb).length, unGwp: prem.filter(e => !e.cb).reduce((s, e) => s + e.gwp, 0) }; });
  ok('convSplit overall sales = 7', cs.c.overall.sales, 7);
  ok('convSplit overall leads = 6', cs.c.overall.leads, 6);
  ok('convSplit Courtesy = 4 sales / 6 leads', cs.c.Courtesy.sales + '/' + cs.c.Courtesy.leads, '4/6');
  ok('convSplit Cuddle = 2 sales / 0 leads', cs.c.Cuddle.sales + '/' + cs.c.Cuddle.leads, '2/0');
  ok('convSplit unattributed sales = 1 (flagged, never spread)', cs.c.unSales, 1);
  ok('accountPremiums unattributed bucket = 1 account', cs.un, 1);
  ok('unattributed GWP = 57.50', cs.unGwp, 57.5, 0.01);

  // ---------- exceptions recorded + displayed ----------
  const exc = await page.evaluate(() => ({ n: state.exceptions.length, reasons: state.exceptions.map(e => e.reason).join(' | '), html: (state.route = 'uploads', render(), document.querySelector('#page').innerHTML) }));
  ok('2 exceptions recorded (BI footer + bad CallX date)', exc.n, 2);
  ok('BI footer rejected under its own rule', /Power BI footer/.test(exc.reasons), true);
  ok('bad date rejected with reason', /Unparseable date/.test(exc.reasons), true);
  ok('exceptions VISIBLE on Upload Station', /Power BI footer/.test(exc.html), true);

  // ---------- rule liveness (edit → recompute instantly) ----------
  const live = await page.evaluate(async () => {
    const out = {}; const win = periodWindow();
    const K = id => state.kpis.find(k => k.id === id);
    // 1. VAT → 0 (zero-safe: incl == ex)
    state.rules.vatRate.vals = ['0']; saveConfig();
    out.vat0 = evalKPI(K('total_gwp'), win);
    state.rules.vatRate.vals = ['15']; saveConfig();
    // 2. callTypes boundary edit: Closing 360 → 300
    out.band320before = callBandFor(320);
    state.rules.callTypes.vals = ['0:No Answer', '30:Customer Service', '180:Pitch', '300:Closing']; saveConfig();
    out.band320after = callBandFor(320);
    state.rules.callTypes.vals = ['0:No Answer', '30:Customer Service', '180:Pitch', '360:Closing']; saveConfig();
    // 3. add 'Interested' to no-answer dispositions → answer rate 70 → 30
    state.rules.noAnswerDispositions.vals.push('Interested'); saveConfig();
    out.ansAfter = evalKPI(K('answer_rate'), win);
    state.rules.noAnswerDispositions.vals.pop(); saveConfig();
    // 4. gwpFloor 99 → 50: CB2 leaves R4, falls to R4A
    const st0 = () => { const C = acCtx(win); return acNBA(acStats('CB2', win, C)).code };
    out.cb2before = st0();
    state.rules.nbaThresholds.vals = state.rules.nbaThresholds.vals.map(v => v === 'gwpFloor:99' ? 'gwpFloor:50' : v); saveConfig();
    out.cb2after = st0();
    state.rules.nbaThresholds.vals = state.rules.nbaThresholds.vals.map(v => v === 'gwpFloor:50' ? 'gwpFloor:99' : v); saveConfig();
    // 5. composite weights → QA only
    const w0 = state.rules.compositeWeights.vals.slice();
    state.rules.compositeWeights.vals = ['QA:100']; saveConfig();
    out.cb1qaOnly = acComposite(acStats('CB1', win, acCtx(win)), 100).adj;
    state.rules.compositeWeights.vals = w0; saveConfig();
    // 6. leadWindow snapshot vs opened on a single-day window (open cases opened 06 Jul)
    const day = { from: '2026-07-07', to: '2026-07-07' };
    out.convSnapshot = evalKPI(K('lead_conversion'), day);
    state.rules.leadWindow.vals = ['opened']; saveConfig();
    out.convOpened = evalKPI(K('lead_conversion'), day);
    state.rules.leadWindow.vals = ['snapshot']; saveConfig();
    out.ansRestored = evalKPI(K('answer_rate'), win);
    return out;
  });
  ok('vatRate→0: incl GWP == ex (626.08)', live.vat0, 626.08, 0.01);
  ok('callTypes edit: 320s was Pitch', live.band320before, 'Pitch');
  ok('callTypes edit: 320s becomes Closing instantly', live.band320after, 'Closing');
  ok('noAnswerDispositions edit: answer rate 70 → 30', live.ansAfter, 30);
  ok('gwpFloor edit: CB2 R4 → R4A instantly', live.cb2before + '→' + live.cb2after, 'R4→R4A');
  ok('compositeWeights=[QA:100]: CB1 composite = QA score 85', live.cb1qaOnly, 85, 0.01);
  ok('leadWindow snapshot: day-window conv 7/6', live.convSnapshot, 116.667, 0.05);
  ok('leadWindow opened: day-window conv 7/4 = 175', live.convOpened, 175, 0.05);
  ok('rules restored: answer rate back to 70', live.ansRestored, 70);

  // ---------- audit-fix regressions ----------
  const fx = await page.evaluate(() => {
    const out = {}; const win = periodWindow();
    const K = id => state.kpis.find(k => k.id === id);
    // Disputed counter plumbing (was reading r.status — permanently 0)
    out.disputed = (state.facts.QA_EVALUATIONS || []).filter(r => decIn('$qaDisputeStatuses', r.qa_status)).length;
    // case-insensitive agreement between KPI engine and NBA engine
    const g5 = state.facts.QA_EVALUATIONS.find(r => r.record_id === 'G5');
    const oldDec = g5.escalation_decision; g5.escalation_decision = 'CRITICAL FAIL'; bumpDataVer();
    out.critRateCased = evalKPI(K('critical_rate'), win);
    out.cb3TierCased = acComposite(acStats('CB3', win, acCtx(win)), 50).tier.tier;
    g5.escalation_decision = oldDec; bumpDataVer();
    // Manual reads live rules
    state.rules.nbaThresholds.vals = state.rules.nbaThresholds.vals.map(v => v === 'gwpFloor:99' ? 'gwpFloor:50' : v); saveConfig();
    out.manualLive = pageManual().includes('R50');
    state.rules.nbaThresholds.vals = state.rules.nbaThresholds.vals.map(v => v === 'gwpFloor:50' ? 'gwpFloor:99' : v); saveConfig();
    out.manualRestored = pageManual().includes('R99');
    // single-value rule: ruleAdd REPLACES (via the real input path on the Rules tab)
    state.route = 'dict'; state.dictTab = 'rules'; render();
    const inp = document.getElementById('rin_vatRate'); inp.value = '20'; ruleAdd('vatRate');
    out.vatVals = state.rules.vatRate.vals.join('|');
    const inp2 = document.getElementById('rin_vatRate'); inp2.value = '15'; ruleAdd('vatRate');
    out.vatRestored = state.rules.vatRate.vals.join('|');
    state.dictTab = 'kpis';
    return out;
  });
  ok('disputed counter now counts qa_review (was dead)', fx.disputed, 1);
  ok('critical_rate unmoved by decision casing', fx.critRateCased, 10);
  ok('NBA tier agrees with KPI on cased decision (R2A-3)', fx.cb3TierCased, 'R2A-3');
  ok('Manual shows live gwpFloor after rule edit (R50)', fx.manualLive, true);
  ok('Manual restored (R99)', fx.manualRestored, true);
  ok('single-value rule REPLACES on add (vatRate → 20)', fx.vatVals, '20');
  ok('single-value rule restored (15)', fx.vatRestored, '15');

  // ---------- session isolation + masking + formats ----------
  await page.evaluate(() => go('sess_uploads'));   // session slots live on the Session Uploads page
  await upload('SES_DIAL_0800', 'g_callx.csv');
  const iso = await page.evaluate(() => ({
    daily: (state.facts.CALLX_CALL_RECORDS || []).length, ses: (state.facts.SES_DIAL_0800 || []).length,
    kpiCalls: evalKPI(state.kpis.find(k => k.id === 'total_calls'), periodWindow()),
    mask: maskNameText('John Smith'), unmaskedDefault: state.unmasked,
    zar: fmtVal(719.992, 'zar'), pct: fmtVal(73.684, 'pct'), hours: fmtVal(10610, 'hours')
  }));
  ok('session upload does NOT leak into daily calls (still 10 rows)', iso.daily, 10);
  ok('session slot holds its own 10 rows', iso.ses, 10);
  ok('total_calls KPI unchanged by session upload', iso.kpiCalls, 10);
  ok('masking default ON', iso.unmaskedDefault, false);
  ok('maskNameText John Smith → J. Sm•••', iso.mask, 'J. Sm•••');
  ok('fmtVal zar', iso.zar, 'R720');
  ok('fmtVal pct 1dp', iso.pct, '73.7%');
  ok('fmtVal hours', iso.hours, '2h 57m');

  // ---------- all pages render with golden data ----------
  const pages = await page.evaluate(() => PAGES.map(p => { state.route = p.id; render(); return p.id + ':' + (document.querySelector('#page').innerHTML.includes('This page hit an error') ? 'ERR' : 'ok') }).join(' '));
  ok('all pages render clean with golden data', /ERR/.test(pages), false);
  ok('no unexpected page errors', errs.length === 0 ? true : errs.join(' | '), true);

  fs.writeFileSync(path.join(SP, 'result_golden.json'), JSON.stringify(results, null, 1));
  console.log(`GOLDEN: ${results.length - fails}/${results.length} assertions passed`);
  await b.close(); srv.close(); process.exit(fails ? 1 : 0);
})().catch(e => { console.error('GOLDEN HARNESS ERROR:', e); process.exit(2); });
