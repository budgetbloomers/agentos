/* verify-vt-format.mjs — the LAYOUT of the Vehicle Tracking pages, over the offline fixture so it is deterministic.
 *
 * Why this file exists (25 Nov 2026, the owner: "the format in VT reporting is all off"). Two faults, both measured
 * on the live pages before anything was changed:
 *   1. #cbxHealth is position:fixed at bottom:0 and NOTHING reserved room for it, so the last ~65px of every page
 *      in every app sat underneath it. On the VT tables that hid whole rows of figures.
 *   2. The VT figure tables carry 17-25 columns and table.data forces every header onto one nowrap line at .09em
 *      letter-spacing. Month to date's Agents table was 2 739px wide inside a 1 280px wrapper - 53% of it
 *      unreachable at 1600px, 65% at 1280px. No column was dropped (they are all real figures): the headers wrap,
 *      the cells tightened, and the first label column is sticky so a row keeps its name while the figures scroll.
 *
 * These checks fail if either regresses. Run: node nicks_code/diagnostics/verify-vt-format.mjs
 */
import fs from 'node:fs'; import path from 'node:path'; import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { vtSource, installVtRoutes, openVt, VT_PAGES } from './vt-tab-source.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url)); const ROOT = path.resolve(HERE, '..', '..');
const { chromium } = await import(pathToFileURL(path.join(HERE, 'node_modules', 'playwright', 'index.mjs')).href);
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (d ? ' — ' + String(d).slice(0, 220) : '')); } };
const src = await vtSource({ live: false });
const HTML = path.join(ROOT, 'site', 'pulse', 'index.html');
if (!fs.existsSync(HTML)) { console.log('site/pulse/index.html is not built — run tools/prepare-site.js'); process.exit(1); }
const SERVE = { '/index.html': HTML, '/xlsx.full.min.js': path.join(ROOT, 'site', 'xlsx.full.min.js') };
const server = http.createServer((q, s) => { const p = SERVE[q.url.split('?')[0]]; if (!p || !fs.existsSync(p)) { s.writeHead(404); s.end(); return; }
  s.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' }); fs.createReadStream(p).pipe(s); });
await new Promise((r) => server.listen(8289, '127.0.0.1', r));
const browser = await chromium.launch();
try {
  for (const W of [1600, 1280]) {
    const page = await browser.newPage({ viewport: { width: W, height: 1000 } });
    const errs = []; page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
    await installVtRoutes(page, src);
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)(?!chatterbox-agentos-api)/, (r) => r.abort());
    await page.goto('http://127.0.0.1:8289/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__mtd && window.__mtd.state() && window.VTPages, null, { timeout: 60000 });
    await page.evaluate(() => { window.__cloudPush = function () {}; window.CBX_USER = { role: 'admin', username: 'probe', tabs: {} }; });
    /* the real health banner, at the height the missing-day alert actually reaches (three wrapped lines) */
    await page.evaluate(() => { const el = document.createElement('div'); el.id = 'cbxHealth';
      el.setAttribute('style', 'position:fixed;bottom:0;left:0;right:0;z-index:2147483000;background:#7f1d1d;color:#fecaca;padding:9px 16px;text-align:center;font:600 12.5px system-ui,sans-serif');
      el.textContent = 'x'.repeat(900); document.body.appendChild(el);
      document.body.style.paddingBottom = (el.offsetHeight + 10) + 'px'; });
    console.log('\n== viewport ' + W + 'px ==');
    for (const pg of VT_PAGES) {
      await openVt(page, pg);
      await page.waitForTimeout(3500);
      const m = await page.evaluate(() => {
        const ban = document.getElementById('cbxHealth');
        const tw = [...document.querySelectorAll('#view .tablewrap')].map((e) => {
          const h = e.closest('.card') && e.closest('.card').querySelector('h3');
          return { t: (h ? h.textContent : '?').slice(0, 24), cw: e.clientWidth, hid: e.scrollWidth - e.clientWidth }; });
        /* a FIGURE header: the label columns (th.l) are deliberately nowrap so a name never breaks mid-word */
        const th = document.querySelector('#view table.data.vt-table thead th:not(.l)');
        const lab = document.querySelector('#view table.data.vt-table tbody td.l:first-child');
        return { tw, banH: ban ? ban.getBoundingClientRect().height : 0,
          padB: parseFloat(getComputedStyle(document.body).paddingBottom) || 0,
          thWrap: th ? getComputedStyle(th).whiteSpace : null,
          labSticky: lab ? getComputedStyle(lab).position : null,
          strayNote: !!document.querySelector('#view > p.vt-cancel-note'),
          notes: document.querySelectorAll('#view .card.vt-note p.vt-cancel-note').length };
      });
      /* FAULT 1 — the fixed banner may never cover the page */
      ok(pg + ': the fixed health banner does not cover the page', m.padB >= m.banH, 'banner ' + Math.round(m.banH) + 'px vs reserved ' + m.padB + 'px');
      /* FAULT 2 — no VT table may need more than one screen-width of sideways scrolling */
      const worst = m.tw.filter((t) => t.hid > t.cw).map((t) => t.t + ' +' + t.hid + 'px of ' + t.cw);
      ok(pg + ': no table needs more than a screen-width of sideways scrolling', worst.length === 0, worst.join(' | '));
      if (m.thWrap) ok(pg + ': VT headers wrap instead of forcing one long line', m.thWrap === 'normal', m.thWrap);
      if (m.labSticky) ok(pg + ': the first label column stays put while the figures scroll', m.labSticky === 'sticky', m.labSticky);
      if (pg === 'vt_mtd') ok(pg + ': the Cancelled explanation sits in a card like every other block', !m.strayNote && m.notes === 1, 'stray=' + m.strayNote + ' carded=' + m.notes);
      /* THE PANELS PACK INSTEAD OF LEAVING HOLES. Packing cannot change a panel's own height, so a shorter grid is
         strictly less whitespace. Measured both ways on the same page: live, ragged -> packed was 3 725 -> 3 418px
         at 1800px and 4 486 -> 4 078px at 1600px. */
      if (pg === 'vt_report') {
        const pack = await page.evaluate(() => {
          const grid = document.querySelector('#view .vt-grid');
          if (!grid || !window.VTDash || !window.VTDash.masonry) return null;
          const kids = [].slice.call(grid.children);
          const cols = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
          grid.classList.remove('vt-masonry'); kids.forEach((k) => { k.style.gridRowEnd = ''; });
          const ragged = Math.round(grid.getBoundingClientRect().height);
          window.VTDash.masonry();
          return { cols, ragged, packed: Math.round(grid.getBoundingClientRect().height),
            masonry: grid.classList.contains('vt-masonry') };
        });
        if (pack && pack.cols > 1) {
          ok(pg + ': the panels pack, so the grid is shorter than a ragged one', pack.packed < pack.ragged,
            'ragged ' + pack.ragged + 'px vs packed ' + pack.packed + 'px');
          ok(pg + ': packing is opt-in — the 8px rows only exist once the code has added .vt-masonry', pack.masonry === true);
        }
        /* ONE rule, ONE label. The scope average was printed under every group and overlapped its neighbours. */
        const reps = await page.evaluate(() => {
          const svgs = [...document.querySelectorAll('#view .vt-grid svg')];
          let worst = 0;
          svgs.forEach((sv) => { const n = [...sv.querySelectorAll('text')].filter((t) => /scope average/i.test(t.textContent || '')).length;
            if (n > worst) worst = n; });
          return worst;
        });
        ok(pg + ': a shared reference rule is labelled once, not under every bar', reps <= 1, 'drawn ' + reps + ' times');
      }
    }
    ok('no page errors at ' + W + 'px', errs.length === 0, [...new Set(errs)].join(' | '));
    await page.close();
  }
} finally { await browser.close(); server.close(); }
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
