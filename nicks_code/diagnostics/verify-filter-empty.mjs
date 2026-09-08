/* A FILTER THAT EMPTIES A PAGE MUST SAY SO.
 *
 * The real failure: the global team filter was left on "TBC" — 8 Nesting agents carry that
 * leader on the Agent List, but ZERO fact rows do, because facts are attributed to the leader
 * the day was worked under (orgAt), not the roster's current label. Every row on Daily Reports
 * vanished, and the page's own team dropdown does not offer "TBC", so the filter could not be
 * cleared from the screen showing nothing. It read as lost data.
 *
 * Run: node verify-filter-empty.mjs   (PULSE_HTML=site/pulse/index.html for the build copy)
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
const REPO = process.env.AGENTOS || decodeURIComponent(new URL('../..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1').replace(/\/$/, '');   // repo-relative (2026-09-08): the laptop path failed every cloud run
const HTML = path.join(REPO, ...(process.env.PULSE_HTML || 'nicks_code/index.html').split('/'));
const UP = path.join(REPO, 'uploads', '2026-08-13');
const NEED = ['Matrix - Agent List.xlsx', 'Active.xlsx', 'attendance_2026-08-06_to_2026-08-13.csv'];
if (!NEED.every(f => fs.existsSync(path.join(UP, f)))) { console.log('(skipping — needs the 13-Aug drop)'); process.exit(0); }
let pass = 0, fail = 0; const failures = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; failures.push(n + (d ? ' — ' + d : '')); console.log('  FAIL ' + n + ' — ' + d); } };
const SERVE = { '/': HTML, '/index.html': HTML, '/xlsx.full.min.js': path.join(REPO, 'site', 'xlsx.full.min.js') };
const server = http.createServer((q, s) => { const p = SERVE[q.url.split('?')[0]];
  if (!p || !fs.existsSync(p)) { s.writeHead(404); s.end('nf'); return; }
  s.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' });
  fs.createReadStream(p).pipe(s); });
await new Promise(r => server.listen(8157, '127.0.0.1', r));
const browser = await chromium.launch({ args: ['--js-flags=--max-old-space-size=8192'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.goto('http://127.0.0.1:8157/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__mtd && window.__mtd.state(), null, { timeout: 30000 });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__mtd && window.__mtd.state(), null, { timeout: 30000 });
await page.setInputFiles('#fileInput', NEED.map(f => path.join(UP, f)), { timeout: 300000 });
await page.waitForFunction(() => (window.__mtd.state().files || []).length >= 3, null, { timeout: 600000 });
{ let last = -1, stable = 0;
  for (let i = 0; i < 120; i++) { await page.waitForTimeout(1500);
    const n = await page.evaluate(() => (window.__mtd.state().files || []).length);
    if (n === last) { if (++stable >= 4) break; } else { stable = 0; last = n; } } }

const base = await page.evaluate(() => {
  const S = window.__mtd.state();
  S.ui.preset = 'custom'; S.ui.from = '2026-08-01'; S.ui.to = '2026-08-18'; S.ui.team = ''; S.ui.camp = '';
  window.__mtd.rebuild();
  const M = window.__mtd.model();
  const rosterTBC = S.roster.filter(a => a.tl === 'TBC').length;
  const factTBC = (M.facts || []).filter(f => f.tl === 'TBC').length;
  S.ui.tab = 'daily'; renderPage();
  return { facts: (M.facts || []).length, rosterTBC, factTBC };
});
await page.waitForTimeout(1200);
const unfiltered = await page.evaluate(() => (document.getElementById('view')?.innerText || ''));
ok('the period holds fact rows and Daily renders them unfiltered', base.facts > 0 && /agent-day rows/.test(unfiltered), JSON.stringify(base));
/* EVOLVED 2026-08-27 (verified identical on the pre-recordOrgList build, so this is data
   maturity, not a regression): the 8 TBC agents' start dates now fall INSIDE the covered
   period, so they carry emp facts attributed to the only assignment ever observed — the
   placeholder itself. Filtering team=TBC therefore shows THEIR rows instead of an empty
   page, which is honest (and self-heals: a first real leader backdates over the whole
   placeholder history — verify-tbc-backdate pins that). The empty-filter UX below is
   exercised with a leader who genuinely has no rows. */
ok('TBC agents carry facts attributed to the placeholder (their only observed assignment)',
  base.rosterTBC > 0 && base.factTBC > 0, `roster ${base.rosterTBC} / facts ${base.factTBC}`);
const tbcView = await page.evaluate(() => {
  const S = window.__mtd.state(); S.ui.team = 'TBC'; renderPage();
  return new Promise(r => setTimeout(() => r(document.getElementById('view')?.innerText || ''), 1200));
});
ok('filtering on TBC shows those rows rather than a false empty page',
  /agent-day rows/.test(tbcView) && !/Nothing matches/.test(tbcView), tbcView.slice(0, 160));

// now a filter that DOES empty the page: a leader on no fact row in the period
const filtered = await page.evaluate(() => {
  const S = window.__mtd.state(); S.ui.team = 'A Leader With No Rows'; renderPage();
  return new Promise(r => setTimeout(() => r(document.getElementById('view')?.innerText || ''), 1200));
});
ok('the empty page NAMES the filter that removed every row', /Nothing matches the current filters/i.test(filtered) && /A Leader With No Rows/.test(filtered), filtered.slice(0, 200));
ok('it states how many rows the period actually holds (not "no data")',
  new RegExp(String(base.facts).replace(/\B(?=(\d{3})+(?!\d))/g, '[\\s,]?') + '\\s*agent-day').test(filtered.replace(/\u00a0/g, ' ')), filtered.slice(0, 260));
ok('it explains WHY a rostered leader can have no rows (history attribution)', /worked under/i.test(filtered), filtered.slice(0, 260));
ok('it offers a way out — a Clear filters control', /Clear filters/i.test(filtered));

// and the way out works
const cleared = await page.evaluate(() => {
  window.__clearFilters();
  return new Promise(r => setTimeout(() => r({ team: window.__mtd.state().ui.team, txt: document.getElementById('view')?.innerText || '' }), 1400));
});
ok('Clear filters restores the rows', cleared.team === '' && /agent-day rows/.test(cleared.txt) && !/Nothing matches/.test(cleared.txt), cleared.txt.slice(0, 140));
ok('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
failures.forEach(f => console.log('FAIL: ' + f));
await browser.close(); server.close();
process.exit(fail || errors.length ? 1 : 0);
