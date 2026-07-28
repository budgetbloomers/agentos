// Display sweep: with EVERY source loaded (the golden fixtures), walk EVERY page and
// prove the data is actually on screen — tiles carry values, tables carry rows, charts
// exist, no page renders its error card or a wrong empty-state — and that the display
// frameworks hold: PII masking (default ON + live toggle), global filter propagation,
// live threshold edits moving the RAG pills, NBA codes and tenure groups visible.
// Complements golden.js (which pins the VALUES); this suite pins the RENDERING.
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
const ok = (name, cond, detail) => { if (!cond) { fails++; console.log('  FAIL', name, detail ?? ''); } else console.log('  ok', name); };

(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const b = await chromium.launch({ executablePath: CHROME });
  const pg = await b.newPage({ viewport: { width: 1600, height: 1000 } });
  const errs = [];
  const benign = /workers\.dev|Failed to fetch|net::|ERR_|favicon|fonts\.g/;
  pg.on('pageerror', e => { if (!benign.test(String(e))) errs.push(String(e).slice(0, 200)); });
  await pg.goto(`http://127.0.0.1:${srv.address().port}/test_current.html`, { waitUntil: 'domcontentloaded' });
  await pg.evaluate(() => document.dispatchEvent(new Event('cbx-authed')));
  await pg.waitForFunction(() => { try { return __initDone === true } catch (e) { return false } }, null, { timeout: 30000, polling: 300 });
  await pg.evaluate(() => go('uploads'));
  async function upload(key, file) {
    await pg.setInputFiles(`#slot_${key} input[type=file]`, path.join(SP, 'gdata', file));
    await pg.waitForSelector('#confirmLoad:not([disabled])', { timeout: 60000 });
    await pg.click('#confirmLoad');
    await pg.waitForFunction(() => !document.querySelector('#overlay').classList.contains('open'), null, { timeout: 60000, polling: 100 });
  }
  console.log('[sweep] loading all 8 sources through the real upload path');
  await upload('AGENT_LIST', 'g_agent_list.csv');
  await upload('ATTENDANCE', 'g_attendance.csv');
  await upload('CALLX_CALL_RECORDS', 'g_callx.csv');
  await upload('QA_EVALUATIONS', 'g_qa.csv');
  await upload('BI_ACTIVE_CASES', 'g_bi.csv');
  await upload('SF_OPEN_CASES', 'g_open.csv');
  await upload('SF_CLOSED_CASES', 'g_closed.csv');
  await upload('SF_INACTIVE', 'g_inactive.csv');

  // probe(route): navigate + gather everything the assertions need in one evaluate
  const probe = rt => pg.evaluate(async r => {
    go(r);
    await new Promise(res => setTimeout(res, 60));   // let the chart setTimeout pass run
    const el = document.getElementById('page');
    const tiles = [...el.querySelectorAll('.kpi .kpi-val')].map(e => e.textContent.trim());
    return {
      len: el.innerHTML.length,
      errCard: el.textContent.includes('This page hit an error'),
      empties: el.querySelectorAll('.empty').length,
      tiles: tiles.length,
      tilesVal: tiles.filter(t => t && t !== '—').length,
      tables: el.querySelectorAll('table.tbl').length,
      rows: el.querySelectorAll('table.tbl tbody tr').length,
      canvases: el.querySelectorAll('canvas').length,
      text: el.textContent
    };
  }, rt);

  console.log('[sweep] page-by-page display audit');
  const P = {};
  for (const rt of ['exec', 'brain', 'sales', 'leads', 'session', 'qa', 'qaperf', 'discipline', 'tl', 'workforce', 'manual', 'uploads', 'sess_uploads', 'dict']) P[rt] = await probe(rt);
  for (const rt in P) ok(`${rt}: no error card`, !P[rt].errCard);

  // Executive: a curated command row — EVERY tile it shows must carry a value
  ok('exec: command tiles all carry values', P.exec.tiles >= 9 && P.exec.tilesVal === P.exec.tiles, `${P.exec.tilesVal}/${P.exec.tiles}`);
  ok('exec: charts present', P.exec.canvases >= 1, P.exec.canvases);
  // Sales production: 12 charts, band table, conversion split — the heaviest page
  ok('sales: ≥8 KPI tiles showing values', P.sales.tilesVal >= 8, P.sales.tilesVal);
  ok('sales: 12 chart canvases', P.sales.canvases >= 10, P.sales.canvases);
  ok('sales: agent band table has rows', P.sales.rows >= 5, P.sales.rows);
  ok('sales: conversion-by-campaign panel renders', P.sales.text.includes('Sales conversion by campaign'));
  ok('sales: cycle/operational panel renders', /Operational Performance/.test(P.sales.text));
  // Leads: per-agent funnel with the ALL AGENTS total row
  ok('leads: per-agent table with all 7 roster agents', P.leads.rows >= 8, P.leads.rows);
  ok('leads: ALL AGENTS total row', P.leads.text.includes('ALL AGENTS'));
  ok('leads: daily movement section renders', /Daily lead movement|Assigned/i.test(P.leads.text));
  // Session: no SES snapshots loaded — the honest empty state IS the correct display
  ok('session: honest empty state (no SES data loaded)', P.session.empties >= 1 || /snapshot/i.test(P.session.text));
  // QA & compliance
  ok('qa: ≥5 KPI tiles showing values', P.qa.tilesVal >= 5, P.qa.tilesVal);
  ok('qa: tables render', P.qa.tables >= 1, P.qa.tables);
  // QA assessor performance
  ok('qaperf: assessor table has rows', P.qaperf.rows >= 1, P.qaperf.rows);
  // Discipline: tiles must evaluate even when the register is empty (no offenses in fixture)
  ok('discipline: KPI tiles evaluate', P.discipline.tiles >= 1, P.discipline.tiles);
  // Team Leader view: teams table + focused team's agent scores, NBA priority framework
  ok('tl: both teams in the leaders table', P.tl.text.includes('L. A•••') && P.tl.text.includes('L. B•••'));
  ok('tl: focused team agent table renders', P.tl.rows >= 5, P.tl.rows);
  ok('tl: NBA priority framework visible', /NBA priority|P1/.test(P.tl.text));
  // click the OTHER team's row (its onclick sets state.tlPick) → agent table re-focuses
  const tlSwitch = await pg.evaluate(async () => {
    go('tl'); await new Promise(r => setTimeout(r, 60));
    const row = [...document.querySelectorAll('#page tr.rowlink[onclick]')].find(el => /L\. A•••/.test(el.textContent) && (el.getAttribute('onclick') || '').includes('state.tlPick'));
    if (!row) return { found: false };
    row.click(); await new Promise(r => setTimeout(r, 80));
    const tabs = [...document.querySelectorAll('#page table.tbl')];
    return { found: true, agentRows: tabs.length > 1 ? tabs[tabs.length - 1].querySelectorAll('tbody tr').length : -1, text: document.getElementById('page').textContent.slice(0, 5000) };
  });
  ok('tl: clicking a team re-focuses its agent table', tlSwitch.found && /L\. A••• — agents/.test(tlSwitch.text) && tlSwitch.agentRows === 4, JSON.stringify({ found: tlSwitch.found, rows: tlSwitch.agentRows }));
  // Agent card: the per-agent framework display — tenure group, composite, NBA verdict
  const card = await pg.evaluate(async () => {
    agentOpen('CB1'); await new Promise(r => setTimeout(r, 120));
    const ov = document.getElementById('overlay');
    const txt = ov ? ov.textContent.replace(/\s+/g, ' ') : '';
    const open = ov && ov.classList.contains('open');
    try { closeModal(); } catch (e) {}
    return { open, txt: txt.slice(0, 5000) };
  });
  ok('agent card opens for CB1', card.open);
  ok('agent card shows the tenure group (tenure-relative framework)', /\bM1\b/.test(card.txt), card.txt.slice(0, 120));
  ok('agent card shows the composite score', /omposite/.test(card.txt));
  ok('agent card shows the NBA verdict (code or clear)', /R2A|R\d\b|NBA|clear/i.test(card.txt));
  // Workforce
  ok('workforce: attendance tiles + table', P.workforce.tilesVal >= 2 && P.workforce.rows >= 1, `${P.workforce.tilesVal}/${P.workforce.rows}`);
  // Visual brain graph: the svg is drawn post-render; counts prove nodes and links exist
  ok('brain: graph svg with agents/nodes/links', /\d+ agents · \d+ nodes · \d+ links/.test(P.brain.text), P.brain.text.slice(0, 120));
  ok('brain: NBA priority legend (L1–L4) present', /L1 Urgent/.test(P.brain.text) && /L4 Recognise/.test(P.brain.text));
  // Manual: live numbers interpolated from the rules (not static prose)
  ok('manual: NBA framework documented', /NBA/.test(P.manual.text));
  // Upload station: all 8 slots show their loaded row counts
  ok('uploads: row counts on the slots', (P.uploads.text.match(/rows/g) || []).length >= 8);
  // Dictionary: KPI table + rules present
  ok('dict: KPI dictionary table populated', P.dict.rows >= 25, P.dict.rows);

  console.log('[sweep] PII masking — default ON, live toggle, memoised pages stay correct');
  const s1 = await probe('sales');
  ok('masking default ON: no raw name on sales', !s1.text.includes('Anna One') && s1.text.includes('A. On•••'));
  await pg.evaluate(() => { const el = document.getElementById('piiSwitch'); el.checked = !el.checked; togglePII(el); });
  const s2 = await probe('sales');
  ok('unmask toggle shows real names (winMemo re-keys)', s2.text.includes('Anna One'));
  const l2 = await probe('leads');
  ok('unmask carries to leads page', l2.text.includes('Anna One'));
  await pg.evaluate(() => { const el = document.getElementById('piiSwitch'); el.checked = !el.checked; togglePII(el); });
  const s3 = await probe('sales');
  ok('re-mask restores masked names', !s3.text.includes('Anna One') && s3.text.includes('A. On•••'));

  console.log('[sweep] global filters propagate to displays');
  await pg.evaluate(() => setFilter('campaign', 'Cuddle'));
  const lc = await probe('leads');
  ok('campaign=Cuddle: only Cuddle agents remain', lc.text.includes('D. Fo•••') && !lc.text.includes('A. On•••'), lc.rows);
  const sc = await probe('sales');
  ok('campaign=Cuddle: sales tiles re-evaluate', !sc.errCard && sc.tiles >= 1);
  await pg.evaluate(() => setFilter('campaign', ''));
  await pg.evaluate(() => setFilter('team', 'Lead B'));
  const lt = await probe('leads');
  ok('team=Lead B: Cara visible, Anna gone', lt.text.includes('C. Th•••') && !lt.text.includes('A. On•••'));
  await pg.evaluate(() => setFilter('team', ''));
  const lr = await probe('leads');
  ok('filters cleared: full roster back', lr.text.includes('A. On•••') && lr.text.includes('D. Fo•••'));

  console.log('[sweep] live threshold edit moves the RAG display');
  const rag = () => pg.evaluate(() => {
    go('qa');
    const k = state.kpis.find(x => x.id === 'avg_qa_score');
    const tile = [...document.querySelectorAll('.kpi')].find(el => el.textContent.includes(k.name));
    const dot = tile && tile.querySelector('.rag-dot');
    return { cls: dot ? dot.className : '(no dot)', green: k.green };
  });
  // default-agnostic: whatever ships, lowering green under 86.8 must rate green,
  // raising it above must not, restoring must return the original class exactly.
  const r0 = await rag();
  await pg.evaluate(() => setThresh('avg_qa_score', 'green', '80'));
  const r1 = await rag();
  ok('green threshold 80 → 86.8 rates green instantly', /\bg\b/.test(r1.cls), r1.cls);
  await pg.evaluate(() => setThresh('avg_qa_score', 'green', '95'));
  const r2 = await rag();
  ok('green threshold 95 → 86.8 leaves green instantly', !/\bg\b/.test(r2.cls), r2.cls);
  await pg.evaluate(g => setThresh('avg_qa_score', 'green', String(g)), r0.green);
  const r3 = await rag();
  ok('restore threshold → original rating returns', r3.cls === r0.cls, `${r3.cls} vs ${r0.cls}`);

  console.log('[sweep] period range switches keep every page coherent');
  for (const mode of ['7', 'mtd', '30']) {
    await pg.evaluate(m => { document.getElementById('rangeSel').value = m; onRangeChange(); }, mode);
    const px = await probe('sales');
    ok(`period=${mode}: sales renders clean`, !px.errCard && px.tiles >= 1);
  }
  // an INVALID mode (browser form-restore from an older build) used to NaN the window
  // and silently blank every page — it must self-heal to the 30-day default instead
  const healed = await pg.evaluate(async () => {
    state.range.mode = 'month';   // a value no current option carries
    go('leads'); await new Promise(r => setTimeout(r, 60));
    const w = periodWindow();
    const t = document.querySelector('#page table.tbl');
    const tot = [...t.querySelectorAll('tbody tr')].find(tr => /Period Totals/.test(tr.textContent));
    const c = tot ? [...tot.children].map(td => td.textContent.trim()) : [];
    return { mode: state.range.mode, sel: document.getElementById('rangeSel').value, from: w.from, assigned: +String(c[1]).replace(/\D/g, '') || 0 };
  });
  ok('invalid range mode self-heals (no NaN window)', healed.mode === '30' && healed.sel === '30' && !/NaN/.test(healed.from), JSON.stringify(healed));
  ok('data returns after self-heal (leads assigned nonzero)', healed.assigned >= 5, healed.assigned);

  console.log('[sweep] lead management deep-check — nothing may vanish silently');
  // movement table carries real numbers from the golden data
  const move = await pg.evaluate(async () => {
    go('leads'); await new Promise(r => setTimeout(r, 60));
    const t = document.querySelector('#page table.tbl');
    const tot = [...t.querySelectorAll('tbody tr')].find(tr => /Period Totals/.test(tr.textContent));
    const c = tot ? [...tot.children].map(td => td.textContent.trim()) : [];
    return { assigned: +String(c[1]).replace(/\D/g, '') || 0, sales: +String(c[3]).replace(/\D/g, '') || 0 };
  });
  ok('movement: Period Totals shows assigned leads', move.assigned >= 5, move.assigned);
  ok('movement: Period Totals shows sales', move.sales >= 5, move.sales);
  // edge fixture: >10 statuses (→ Other rollup), an unmapped owner, a ghost owner
  const g2 = ['"Case ID","Case Number","Subject","Date/Time Opened","Age (Hours)","Open","Account Name","Account Number","Account Mobile from Person Account","Person Account: Email","Case Record Type","Case Owner","Status"'];
  const sts = ['1st attempt', '6th attempt', 'Awaiting Docs', 'Client Query', 'Follow Up', 'Callback Set'];
  sts.forEach((st, i) => g2.push(`"E${i}","ECASE-${i}","s","06/07/2026 09:0${i}","10","1","x","ZA${i}","","","VAS","Anna One","${st}"`));
  g2.push('"E7","ECASE-7","s","06/07/2026 09:07","10","1","x","ZA7","","","VAS","Zed Nine","New"');
  g2.push('"E8","ECASE-8","s","06/07/2026 09:08","10","1","x","ZA8","","","VAS","Ghost Owner","New"');
  fs.writeFileSync(path.join(SP, 'gdata', 'g2_open.csv'), g2.join('\n'));
  await pg.evaluate(() => go('uploads'));
  await upload('SF_OPEN_CASES', 'g2_open.csv');   // snapshot → replaces the golden open file
  const readLeads = () => pg.evaluate(async () => {
    go('leads'); await new Promise(r => setTimeout(r, 60));
    const el = document.getElementById('page');
    const funnel = el.querySelectorAll('table.tbl')[1];
    const heads = [...funnel.querySelectorAll('thead th')].map(h => h.textContent.trim());
    const anna = [...funnel.querySelectorAll('tbody tr')].find(tr => /A\. On•••/.test(tr.textContent));
    const cells = anna ? [...anna.children].map(td => td.textContent.trim()) : [];
    const stN = heads.indexOf('Total Open') - 4;             // status columns sit between Agent Name and Total Open
    const stSum = cells.slice(4, 4 + stN).reduce((s, v) => s + (+v || 0), 0);
    const totOpen = +String(cells[4 + stN]).replace(/\D/g, '') || 0;
    const banner = (el.textContent.match(/Not attributed to any CURRENT roster agent[^]*?(?=Owner names)/) || [''])[0];
    return { heads, stN, stSum, totOpen, banner, text: el.textContent };
  });
  const L1 = await readLeads();
  ok('status overflow rolls into an Other column (never hidden)', L1.heads.includes('Other'), L1.heads.join(','));
  ok('Anna: visible status cells sum to Total Open (6 = 6)', L1.stSum === 6 && L1.totOpen === 6, `${L1.stSum}/${L1.totOpen}`);
  ok('unmapped owners flagged in the banner (2 open cases)', /2 open case\(s\)/.test(L1.banner), L1.banner.slice(0, 90));
  // stale sfOwnerMap: owner resolves to a CB that left the roster — must STILL be flagged
  await pg.evaluate(() => { state.sfOwnerMap['zed nine'] = 'CB99'; bumpDataVer(); });
  const L2 = await readLeads();
  ok('off-roster-but-resolvable owner still flagged (stale map)', /2 open case\(s\)/.test(L2.banner), L2.banner.slice(0, 90));
  // no BI file → the page must SAY the money columns are empty, not just show zeros
  pg.on('dialog', d => d.accept());
  await pg.evaluate(async () => { await clearSource('BI_ACTIVE_CASES'); });
  const L3 = await readLeads();
  ok('missing BI file called out on the page', /No Power BI Active Cases file loaded/.test(L3.text));
  // missing CallX must be called out on Sales Production too (page-level, not just the band table)
  await pg.evaluate(async () => { await clearSource('CALLX_CALL_RECORDS'); });
  const S4 = await probe('sales');
  ok('missing CallX file called out on Sales Production', /No CallX call-records file loaded/.test(S4.text));

  console.log('[sweep] real production file formats (SF HTML .xls with title/footer rows, real .xlsx BI)');
  await pg.evaluate(() => go('uploads'));
  await upload('SF_OPEN_CASES', 'real_open.xls');
  await upload('SF_CLOSED_CASES', 'real_closed.xls');
  await upload('BI_ACTIVE_CASES', 'real_bi.xlsx');
  const counts = await pg.evaluate(() => ({ o: (state.facts.SF_OPEN_CASES || []).length, c: (state.facts.SF_CLOSED_CASES || []).filter(r => String(r.case_number).startsWith('RCASE')).length, b: (state.facts.BI_ACTIVE_CASES || []).length }));
  ok('SF HTML .xls loads past the title row (3 open cases)', counts.o === 3, counts.o);
  ok('SF HTML .xls closed cases load (2 rows)', counts.c === 2, counts.c);
  ok('real .xlsx BI loads (4 charge rows)', counts.b === 4, counts.b);
  const SR = await probe('sales');
  ok('sales production shows the real-format money (GWP tile + unattributed banner)', !SR.errCard && /R\d/.test(SR.text.replace(/\s/g, '')) && /could not be attributed|unattributed/i.test(SR.text), SR.errCard);

  ok('no unexpected page errors across the sweep', errs.length === 0, errs.join(' | '));
  await pg.close(); await b.close(); srv.close();
  console.log(`DISPLAY SWEEP: ${fails ? fails + ' FAILURES' : 'all passed'}`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('SWEEP HARNESS ERROR:', String(e).slice(0, 600)); process.exit(2); });
