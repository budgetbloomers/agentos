// Browser harness: functional merge assertions + before/after timings.
// Usage: node harness.js current|baseline
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const { WORK: SP, ROOT, CHROME } = require('./common.js');
const WHICH = process.argv[2] || 'current';
const PAGE_FILE = WHICH === 'current' ? 'test_current.html' : 'test_baseline.html';
const EXE = CHROME;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.csv': 'text/csv' };

const srv = http.createServer((req, res) => {
  const p = path.join(SP, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(SP) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});

const R = { which: WHICH, uploads: {}, asserts: [], pages: {}, notes: [] };
const ok = (name, cond, detail) => { R.asserts.push({ name, pass: !!cond, detail: detail === undefined ? '' : String(detail) }); if (!cond) console.log('  FAIL:', name, detail); };
const ms = x => Math.round(x);

(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const PORT = srv.address().port;
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errs = [];
  const benign = /workers\.dev|Failed to fetch|net::|ERR_|favicon|fonts\.g/;
  page.on('pageerror', e => { if (!benign.test(String(e))) errs.push('pageerror: ' + e.message); });
  page.on('console', m => { if (m.type() === 'error' && !benign.test(m.text())) errs.push('console: ' + m.text()); });

  await page.goto(`http://127.0.0.1:${PORT}/${PAGE_FILE}`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => document.dispatchEvent(new Event('cbx-authed')));
  await page.waitForFunction(() => { try { return __initDone === true } catch (e) { return false } }, null, { timeout: 30000, polling: 300 });
  await page.evaluate(() => go('uploads'));

  async function upload(key, file, label) {
    const t0 = Date.now();
    await page.setInputFiles(`#slot_${key} input[type=file]`, path.join(SP, 'data', file));
    await page.waitForSelector('#confirmLoad:not([disabled])', { timeout: 180000 });
    const tModal = Date.now() - t0;
    const t1 = Date.now();
    await page.click('#confirmLoad');
    await page.waitForFunction(() => !document.querySelector('#overlay').classList.contains('open'), null, { timeout: 180000, polling: 100 });
    const tConfirm = Date.now() - t1;
    const count = await page.evaluate(k => (state.facts[k] || []).length, key);
    const batch = await page.evaluate(() => state.batches[0] && { id: state.batches[0].batch_id, loaded: state.batches[0].loaded_row_count, dup: state.batches[0].duplicate_row_count || 0, sup: state.batches[0].superseded_prev_rows || 0 });
    R.uploads[label] = { file, tModal, tConfirm, count, batch };
    console.log(`  ${label}: modal ${tModal}ms · confirm ${tConfirm}ms · rows now ${count} · batch ${JSON.stringify(batch)}`);
    return { count, batch };
  }

  console.log(`[${WHICH}] uploads`);
  await upload('AGENT_LIST', 'agent_list.csv', 'agent_list');
  const c1 = await upload('CALLX_CALL_RECORDS', 'callx_a.csv', 'callx_first');
  const FAIR = process.env.FAIR === '1';   // fair-timing mode: identical data volume in both builds
  const c2 = FAIR ? c1 : await upload('CALLX_CALL_RECORDS', 'callx_a_renamed.csv', 'callx_renamed_same_bytes');
  const c3 = FAIR ? c1 : await upload('CALLX_CALL_RECORDS', 'callx_b_overlap.csv', 'callx_overlap');
  const q1 = await upload('QA_EVALUATIONS', 'qa_a.csv', 'qa_first');
  const q2 = process.env.FAIR === '1' ? q1 : await upload('QA_EVALUATIONS', 'qa_b_updates.csv', 'qa_updates');
  const b1 = await upload('BI_ACTIVE_CASES', 'bi_jul.csv', 'bi_july');
  const gwpJul1 = await page.evaluate(() => accountPremiums({ from: '2026-07-01', to: '2026-07-31' }).reduce((s, e) => s + e.gwp, 0));
  const b2 = await upload('BI_ACTIVE_CASES', 'bi_julaug.csv', 'bi_julaug');
  const gwpJul2 = await page.evaluate(() => accountPremiums({ from: '2026-07-01', to: '2026-07-31' }).reduce((s, e) => s + e.gwp, 0));
  const b3 = await upload('BI_ACTIVE_CASES', 'bi_jul_renamed.csv', 'bi_july_again');
  const gwpJul3 = await page.evaluate(() => accountPremiums({ from: '2026-07-01', to: '2026-07-31' }).reduce((s, e) => s + e.gwp, 0));
  const a1 = await upload('ATTENDANCE', 'att_jul.csv', 'att_first');
  const a2 = await upload('ATTENDANCE', 'att_jul_corrected.csv', 'att_corrected');

  if (WHICH === 'current') {
    console.log(`[${WHICH}] merge assertions`);
    ok('callx first load = 40000', c1.count === 40000, c1.count);
    ok('same bytes renamed → no duplication', c2.count === 40000, c2.count);
    ok('overlap file adds only the 2000 new rows', c3.count === 42000, c3.count);
    ok('overlap batch skipped 40000 duplicates', c3.batch.dup === 40000, JSON.stringify(c3.batch));
    ok('qa first load = 3000', q1.count === 3000, q1.count);
    ok('qa updates: 500 updated + 200 new, no dupes', q2.count === 3200, q2.count);
    ok('qa updates batch superseded 500 records', q2.batch.sup === 500, JSON.stringify(q2.batch));
    const rec = await page.evaluate(() => (state.facts.QA_EVALUATIONS || []).filter(r => r.record_id === 'E00007').map(r => r.qa_status));
    ok('record E00007 updated in place (single copy, new status)', rec.length === 1 && rec[0] === 'closed_retracted', JSON.stringify(rec));
    ok('bi july = 3000', b1.count === 3000, b1.count);
    ok('bi jul+aug replaces july span, no dupes', b2.count === 4500, b2.count);
    ok('bi july GWP identical after span replace', Math.abs(gwpJul1 - gwpJul2) < 0.01, gwpJul1 + ' vs ' + gwpJul2);
    ok('re-upload july again → still 4500 (idempotent)', b3.count === 4500, b3.count);
    ok('july GWP unchanged after re-upload', Math.abs(gwpJul1 - gwpJul3) < 0.01, gwpJul1 + ' vs ' + gwpJul3);
    ok('attendance = 3000', a1.count === 3000, a1.count);
    ok('attendance corrected → still 3000 (employee-day wins)', a2.count === 3000, a2.count);
    const att = await page.evaluate(() => (state.facts.ATTENDANCE || []).filter(r => r.employee_code === 'CB1' && r._d === '2026-07-01').map(r => r.status_code));
    ok('CB1 2026-07-01 updated to UCA, single row', att.length === 1 && att[0] === 'UCA', JSON.stringify(att));
    const wk = await page.evaluate(() => [typeof _xSeq !== 'undefined' ? _xSeq : -1, typeof _xWorkerDead !== 'undefined' ? _xWorkerDead : 'n/a']);
    ok('parse worker was used (off main thread)', wk[0] > 0 && wk[1] === false, JSON.stringify(wk));
    R.notes.push('worker: ' + JSON.stringify(wk));
  }

  console.log(`[${WHICH}] page renders + timings`);
  const ids = await page.evaluate(() => PAGES.map(p => p.id));
  for (const id of ids) {
    const t = await page.evaluate(id => {
      state.route = id;
      const t0 = performance.now(); render(); const cold = performance.now() - t0;
      const t1 = performance.now(); render(); const warm = performance.now() - t1;
      return { cold, warm, err: document.querySelector('#page').innerHTML.includes('This page hit an error') };
    }, id);
    R.pages[id] = { cold: ms(t.cold), warm: ms(t.warm) };
    ok(`page ${id} renders clean`, !t.err);
    console.log(`  ${id}: cold ${ms(t.cold)}ms · warm ${ms(t.warm)}ms${t.err ? ' · ERROR CARD' : ''}`);
    await page.waitForTimeout(60);
  }
  const ft = await page.evaluate(() => {
    state.route = 'sales';
    state.filters.campaign = 'Cuddle';
    const t0 = performance.now(); render(); const a = performance.now() - t0;
    state.filters.campaign = ''; state.filters.team = '';
    const t1 = performance.now(); render(); const b = performance.now() - t1;
    return { filterOn: a, filterOff: b };
  });
  R.filter = { on: ms(ft.filterOn), off: ms(ft.filterOff) };
  console.log(`  filter change on sales: apply ${ms(ft.filterOn)}ms · clear ${ms(ft.filterOff)}ms`);
  const ao = await page.evaluate(() => { try { state.route = 'tl'; render(); agentOpen('CB1'); return 'ok' } catch (e) { return 'ERR: ' + e.message } });
  ok('agentOpen(CB1) works', ao === 'ok', ao);

  ok('no unexpected console/page errors', errs.length === 0, errs.slice(0, 5).join(' | '));
  R.errors = errs;
  fs.writeFileSync(path.join(SP, `result_${WHICH}${process.env.FAIR==='1'?'_fair':''}.json`), JSON.stringify(R, null, 1));
  const fails = R.asserts.filter(a => !a.pass).length;
  console.log(`[${WHICH}] DONE — ${R.asserts.length - fails}/${R.asserts.length} assertions passed`);
  await browser.close();
  srv.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
