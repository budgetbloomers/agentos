// CACHE COHERENCE: a torn local copy must be discarded at boot; a good one must be kept.
//
// The state this guards against is the one that ate a day of debugging: a device whose cache
// overflowed mid-write kept the FILE REGISTRY (25 entries) plus one small store, while sales
// and calls were gone. The trust bar — which reads the registry — said "8/8 sources fresh"
// while every page said "No data for 2026-08 yet", and no refresh could fix it because
// Ctrl+Shift+R keeps localStorage. The boot check now drops a copy whose registry claims a
// core file kind (bi / calls / attendance) whose store is empty — impossible in an atomic
// save — and lets hydrate() pull the real state from Supabase.
//
// Runs against the DEPLOYED artifact (site/pulse/index.html) with the user's real state shape:
// the fixture is derived from an actual cloud blob when one is present in backups/, else a
// synthetic one with the same registry/store structure.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

const REPO = process.env.AGENTOS || decodeURIComponent(new URL('../..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1').replace(/\/$/, '');   // repo-relative (2026-09-08): the laptop path failed every cloud run
const SITE = path.join(REPO, 'site');
const srv = http.createServer((q, s) => {
  let u = q.url.split('?')[0]; if (u === '/pulse/' || u === '/pulse') u = '/pulse/index.html';
  const p = path.join(SITE, u.replace(/^\//, ''));
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { s.writeHead(404); s.end('nf'); return; }
  s.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' });
  fs.createReadStream(p).pipe(s);
});
await new Promise(r => srv.listen(8155, '127.0.0.1', r));

let pass = 0, fail = 0; const failures = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  pass  ' + n); } else { fail++; failures.push(n + ' — ' + d); console.log('  FAIL  ' + n + ' — ' + d); } };

/* ---- fixture: a real blob when available, else synthetic with the same shape ---- */
let good;
const real = path.join(REPO, 'backups', 'now.json');
if (fs.existsSync(real)) good = JSON.parse(fs.readFileSync(real, 'utf8'));
else good = { v: 1, _rev: Date.now(),
  files: [{ name: 'BI.xlsx', type: 'bi', dates: ['2026-08-13'], rows: 10, at: 'x' },
          { name: 'calls.csv', type: 'calls', dates: ['2026-08-13'], rows: 10, at: 'x' },
          { name: 'att.csv', type: 'attendance', dates: ['2026-08-13'], rows: 10, at: 'x' },
          { name: 'board.xlsx', type: 'board (13.08)', dates: ['2026-08-13'], rows: 10, at: 'x' }],
  roster: [{ code: 'CB1', name: 'A A', campaign: 'Courtesy', tl: 'T', sf: 'A A', callx: 'A A CB-1' }],
  sales: { '2026-08-13': { aa: { n: 1, gwp: 99, a: { X1: 86 } } } },
  calls: { '2026-08-13': { 'A A CB-1': { talk: 100, calls: 5, ans: 3, opt: 1, saleD: 1 } } },
  att: { '2026-08-13': { CB1: 'P' } }, board: { '2026-08-13': { CB1: { sales: 1, gwp: 99 } } },
  evals: {}, cancRows: {}, vici: {}, viciDays: {}, callsMeta: {}, settings: {}, ui: { month: '2026-08', tab: 'dash' } };
const torn = JSON.parse(JSON.stringify(good));
torn.sales = {}; torn.calls = {};              // the observed tear: registry intact, core stores gone

const boot = async state => {
  const b = await chromium.launch({ args: ['--js-flags=--max-old-space-size=8192'] });
  const page = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = []; page.on('pageerror', e => errs.push(String(e.message).slice(0, 160)));
  await page.addInitScript(s => { try { localStorage.setItem('vas_mtd_tracker_v1', s); } catch (e) {} }, JSON.stringify(state));
  await page.goto('http://127.0.0.1:8155/pulse/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('cbx-authed', { detail: { user: { username: 'diag', role: 'admin', tabs: { vas: ['*'] } } } })));
  await page.waitForFunction(() => window.__mtd && window.__mtd.state(), null, { timeout: 60000 });
  await page.waitForTimeout(1800);
  const out = await page.evaluate(() => {
    const st = window.__mtd.state();
    try { go('dash'); } catch (e) {}
    return new Promise(res => setTimeout(() => {
      const txt = (document.querySelector('#page') || document.body).innerText;
      res({ kept: localStorage.getItem('vas_mtd_tracker_v1') !== null,
        files: (st.files || []).length, sales: Object.keys(st.sales || {}).length,
        noData: /No data for/.test(txt), loading: /Loading your data|not signed in/i.test(txt),
        hasKpis: /Total GWP|Policies Sold/i.test(txt) });
    }, 1000));
  });
  await b.close();
  return { ...out, errs };
};

console.log('\n— TORN copy (registry intact, sales+calls stores empty) —');
const t = await boot(torn);
// the app may legitimately re-save a FRESH empty state after discarding (boot-time save()),
// so the assertion is "the torn registry is gone", not "the localStorage key is absent"
ok('the torn cache is DISCARDED at boot', t.files === 0 && t.sales === 0, JSON.stringify(t));
ok('the page does NOT claim "No data" over a lying registry', !t.noData, JSON.stringify(t));
ok('it says the data is loading / needs sign-in instead', t.loading, JSON.stringify(t));
ok('no page errors', t.errs.length === 0, t.errs.join(' | '));

console.log('\n— GOOD copy (same registry, stores present) —');
const g = await boot(good);
ok('the good cache is KEPT', g.kept && g.files > 0, JSON.stringify({ kept: g.kept, files: g.files }));
ok('sales survive', g.sales > 0, g.sales + '');
ok('the dashboard actually renders KPIs', g.hasKpis, JSON.stringify(g));
ok('no page errors', g.errs.length === 0, g.errs.join(' | '));

srv.close();
console.log('\n' + pass + ' passed · ' + fail + ' failed');
if (fail) { console.log('\nFAILURES:'); failures.forEach(f => console.log(' - ' + f)); process.exit(1); }
