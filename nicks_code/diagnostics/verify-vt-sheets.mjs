/* verify-vt-sheets.mjs — the VT Report's workbook tabs in a real browser (Spec Kit 073).
 *
 *   node nicks_code/diagnostics/verify-vt-sheets.mjs          over the fictional VT fixture (deterministic)
 *   node nicks_code/diagnostics/verify-vt-sheets.mjs --live   over the LIVE book (read-only: vt_book, vt_roster_at, vt_uploads)
 *
 * The figures themselves are proved cell for cell by verify-vt-workbook-oracle.mjs. This suite proves the PAGE: every
 * tab renders with no page error, each section of its sheet is there in the sheet's order, the drill-down's pickers
 * change what it lists, a figure on screen is the one VTWorkbook computed (one number, one verdict), the Dashboard tab
 * is untouched, and the layout guards hold (no VT table needs more than a screen-width of sideways scrolling).
 * It prints counts and section ids only — never a name or a case number.
 */
import fs from 'node:fs'; import path from 'node:path'; import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { vtSource, installVtRoutes, openVt } from './vt-tab-source.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url)); const ROOT = path.resolve(HERE, '..', '..');
const { chromium } = await import(pathToFileURL(path.join(HERE, 'node_modules', 'playwright', 'index.mjs')).href);
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (d ? ' — ' + String(d).slice(0, 240) : '')); } };
const LIVE = process.argv.includes('--live');
const src = await vtSource({ live: LIVE });
if (!src) { console.log('  --   skipped: the live VT tables cannot be read'); process.exit(0); }
const HTML = path.join(ROOT, 'site', 'pulse', 'index.html');
if (!fs.existsSync(HTML)) { console.log('site/pulse/index.html is not built — run tools/prepare-site.js'); process.exit(1); }
const SHOTS = path.join(HERE, 'scratch', 'vt'); fs.mkdirSync(SHOTS, { recursive: true });
const SERVE = { '/index.html': HTML, '/xlsx.full.min.js': path.join(ROOT, 'site', 'xlsx.full.min.js') };
const server = http.createServer((q, s) => { const p = SERVE[q.url.split('?')[0]]; if (!p || !fs.existsSync(p)) { s.writeHead(404); s.end(); return; }
  s.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' }); fs.createReadStream(p).pipe(s); });
await new Promise((r) => server.listen(8293, '127.0.0.1', r));
const browser = await chromium.launch();
const settle = (page) => page.waitForTimeout(1200);
const digits = (t) => String(t == null ? '' : t).replace(/[^0-9]/g, '');
try {
  for (const W of [1600, 1280]) {
    console.log('\n== ' + src.label + ' · ' + W + 'px ==');
    const page = await browser.newPage({ viewport: { width: W, height: 1000 } });
    const errs = []; page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 200)));
    await installVtRoutes(page, src);
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)(?!chatterbox-agentos-api)/, (r) => r.abort());
    await page.goto('http://127.0.0.1:8293/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__mtd && window.__mtd.state() && window.VTPages && window.VTSheets && window.VTWorkbook, null, { timeout: 60000 });
    await page.evaluate(() => { window.__cloudPush = function () {}; window.CBX_USER = { role: 'admin', username: 'probe', tabs: {} }; });
    await openVt(page, 'vt_report');
    await page.waitForTimeout(4000);
    const hasFigures = await page.evaluate(() => !document.querySelector('#view .vt-empty'));
    const tabs = await page.evaluate(() => [...document.querySelectorAll('#view .vt-tab')].map((b) => b.dataset.vtsheet));
    ok('the tab bar lists Dashboard first, then the workbook\'s sheets', tabs.join(',') === 'dashboard,exco,people,review,pivots', tabs.join(','));
    if (!hasFigures) { ok('no figures in this business month: the page says so and keeps the tab bar', tabs.length === 5); await page.close(); continue; }
    ok('the Dashboard tab is unchanged: KPI row and panel grid', await page.evaluate(() => !!document.querySelector('#view .vt-kpis') && !!document.querySelector('#view .vt-grid')));
    const open = async (k) => { await page.evaluate((x) => window.VTDash.set('sheet', x), k); await settle(page);
      await page.addStyleTag({ content: '.tablewrap{content-visibility:visible!important;contain-intrinsic-size:auto!important}' }); };
    const parts = () => page.evaluate(() => [...document.querySelectorAll('#view [data-sheet-part]')].map((e) => e.dataset.sheetPart));
    const inOrder = (P, ids) => ids.every((id, i) => P.indexOf(id) > -1 && (i === 0 || P.indexOf(id) > P.indexOf(ids[i - 1])));
    const wide = () => page.evaluate(() => [...document.querySelectorAll('#view .tablewrap')].filter((e) => e.scrollWidth - e.clientWidth > e.clientWidth)
      .map((e) => { const p = e.closest('[data-sheet-part]'); return p ? p.dataset.sheetPart : '?'; }));

    /* ---- Exco Summary ---- */
    await open('exco');
    let P = await parts();
    ok('Exco Summary: the sheet\'s sections, in its order',
      inOrder(P, ['exco-channels', 'exco-campaigns', 'exco-rollover', 'exco-weeks', 'exco-leadtime', 'exco-upcoming', 'notes']), P.join(','));
    const ex = await page.evaluate(() => {
      const view = document.querySelector('[data-vtr="view"]').value;
      const M = window.VTWorkbook.exco(window.VTDash.modelFor(view));
      const tile = document.querySelector('#view [data-sheet="exco"] .vt-sheet-tile[data-tile="sales"] .val');
      return { tile: tile ? tile.textContent : null, engine: M.strip[0].value,
        rows: document.querySelectorAll('#view [data-sheet-part="exco-channels"] tbody tr').length, chans: M.channels.length };
    });
    ok('Exco Summary: the Total sales tile is VTWorkbook\'s figure (one number, one verdict)', digits(ex.tile) === String(ex.engine), ex.tile + ' vs ' + ex.engine);
    ok('Exco Summary: Performance by Channel shows every channel and a total', ex.rows === ex.chans + 1, ex.rows);
    ok('Exco Summary: no table needs more than a screen-width of sideways scrolling', (await wide()).length === 0, (await wide()).join(','));
    if (W === 1600) await page.screenshot({ path: path.join(SHOTS, 'sheet-exco' + (LIVE ? '-live' : '') + '.png'), fullPage: true });

    /* ---- Agent & Scheduler Summary ---- */
    await open('people');
    P = await parts();
    ok('A&S Summary: filters, drill-down, then the sheet\'s tables in its order',
      inOrder(P, ['filters', 'people-drill', 'people-scheduler', 'people-lead', 'people-agent', 'people-referrer']), P.join(','));
    const d0 = await page.evaluate(() => ({ type: document.querySelector('[data-vtr="dtype"]').value, names: document.querySelectorAll('[data-vtr="dname"] option').length }));
    ok('drill-down opens on Agent, like the saved workbook, with a name list', d0.type === 'agent' && d0.names > 0, JSON.stringify(d0));
    const second = await page.evaluate(() => { const o = document.querySelectorAll('[data-vtr="dname"] option'); return o.length > 1 ? o[1].value : null; });
    if (second) {
      await page.evaluate((v) => window.VTDash.set('dname', v), second); await settle(page);
      const d1 = await page.evaluate(() => ({ name: document.querySelector('[data-vtr="dname"]').value,
        rows: document.querySelectorAll('#view [data-sheet-part="people-drill"] tbody tr').length,
        tile: (document.querySelector('#view [data-sheet-part="people-drill"] .vt-sheet-tile .val') || {}).textContent }));
      ok('picking another name lists THAT person\'s sales (rows = the Records tile)', d1.name === second && String(d1.rows) === digits(d1.tile), JSON.stringify({ rows: d1.rows, tile: d1.tile }));
    }
    /* the columns are read on the Agent drill-down, which always has rows; a book with no Schedulers Data has no
       scheduler, and that view shows its honest "nobody of this kind" line instead of a table */
    const heads = await page.evaluate(() => [...document.querySelectorAll('#view [data-sheet-part="people-drill"] thead th')].map((t) => t.textContent));
    ok('drill-down columns are the workbook\'s, and none is a customer field',
      heads.join('|') === 'Agent|Sale Date|Case Number|Cycle Tag|Referring Agent|Scheduler|Campaign|Result|GWP'
      && !heads.some((h) => /mobile|phone|customer|registration|chassis|contact/i.test(h)), heads.join('|'));
    await page.evaluate(() => window.VTDash.set('dtype', 'scheduler')); await settle(page);
    const d2 = await page.evaluate(() => ({ type: document.querySelector('[data-vtr="dtype"]').value,
      rows: document.querySelectorAll('#view [data-sheet-part="people-drill"] tbody tr').length,
      empty: !!document.querySelector('#view [data-sheet-part="people-drill"] .empty') }));
    ok('switching the type to Scheduler re-lists (or says nobody of that kind is in view)', d2.type === 'scheduler' && (d2.rows > 0 || d2.empty), JSON.stringify(d2));
    await page.evaluate(() => window.VTDash.set('dtype', 'agent')); await settle(page);
    await page.evaluate(() => window.VTDash.set('pchan', 'lead_gen')); await settle(page);
    const f1 = await page.evaluate(() => (document.querySelector('#view [data-sheet="people"] .vt-sheet-tile[data-tile="sales"] .val') || {}).textContent);
    await page.evaluate(() => window.VTDash.clearPersons()); await settle(page);
    const f0 = await page.evaluate(() => (document.querySelector('#view [data-sheet="people"] .vt-sheet-tile[data-tile="sales"] .val') || {}).textContent);
    ok('the Channel filter changes the tiles (the sheet\'s filters "apply to the tiles")', f1 !== f0 || digits(f0) === '0', f1 + ' vs ' + f0);
    if (W === 1600) await page.screenshot({ path: path.join(SHOTS, 'sheet-people' + (LIVE ? '-live' : '') + '.png'), fullPage: true });

    /* ---- Sales Review ---- */
    await open('review');
    P = await parts();
    ok('Sales Review: settings, vs budget, outcome mix, detailed table', inOrder(P, ['review-settings', 'review-vsbudget', 'review-mix', 'review-detail']), P.join(','));
    const rv = await page.evaluate(() => ({ tiles: document.querySelectorAll('#view [data-sheet="review"] .vt-sheet-tile').length,
      vs: document.querySelectorAll('#view [data-sheet-part="review-vsbudget"] tbody tr').length,
      detail: document.querySelectorAll('#view [data-sheet-part="review-detail"] tbody tr').length,
      dash: [...document.querySelectorAll('#view [data-sheet-part="review-detail"] tbody td')].filter((t) => t.textContent.trim() === '-').length,
      heads: [...document.querySelectorAll('#view [data-sheet-part="review-detail"] thead th')].map((t) => t.textContent).join('|') }));
    ok('Sales Review: seven headline tiles', rv.tiles === 7, rv.tiles);
    ok('Sales Review: vs budget has Digital, Referrals, Predictive, Other, Panimax, Total', rv.vs === 6, rv.vs);
    ok('Sales Review: the detailed table is all 14 KPIs (Dialing Days, HC, then 12 groups x 6 rows)', rv.detail === 2 + 12 * 6, rv.detail);
    ok('Sales Review: its columns are the sheet\'s, Deficit / Surplus included',
      rv.heads === 'KPI|Budget Targets|Cycle view (current + fitted rollovers)|% Tgt|Deficit / Surplus|Forecast|All data', rv.heads);
    ok('Sales Review: Missed / Cancelled / Cancelled % / Scheduled / lead-time forecasts read "-", as on the sheet', rv.dash === 9 * 6, rv.dash);
    ok('Sales Review: no table needs more than a screen-width of sideways scrolling', (await wide()).length === 0, (await wide()).join(','));
    if (W === 1600) await page.screenshot({ path: path.join(SHOTS, 'sheet-review' + (LIVE ? '-live' : '') + '.png'), fullPage: true });

    /* ---- Pivots ---- */
    await open('pivots');
    const pv = await page.evaluate(() => ({ tables: document.querySelectorAll('#view [data-sheet="pivots"] table').length, empty: !!document.querySelector('#view .empty') }));
    ok('Pivots: the four scheduler pivots, or the honest "needs the Schedulers Data sheet"', pv.tables === 4 || pv.empty, JSON.stringify(pv));

    /* ---- the export carries the three sheets ---- */
    const xs = await page.evaluate(() => { const wb = window.VTDash.workbookFor(); return wb ? wb.sheets.map((s) => s.name) : []; });
    ok('the .xlsx export carries the three workbook sheets',
      ['Workbook - Exco Summary', 'Workbook - Agent & Scheduler', 'Workbook - Sales Review'].every((n) => xs.indexOf(n) > -1), xs.slice(-3).join(','));

    await open('dashboard');
    ok('back on Dashboard the chart page paints again', await page.evaluate(() => !!document.querySelector('#view .vt-grid')));
    ok('no page errors at ' + W + 'px', errs.length === 0, [...new Set(errs)].join(' | '));
    await page.close();
  }
} finally { await browser.close(); server.close(); }
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
