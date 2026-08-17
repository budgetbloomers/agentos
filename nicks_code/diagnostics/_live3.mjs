// THE ACCEPTANCE RUN: live production URL, origin quota exhausted (Nick's device), torn local
// cache, real Supabase blob to hydrate. Must render the dashboard KPIs regardless.
import { chromium } from 'playwright';
import fs from 'node:fs'; import path from 'node:path';
const REPO = String.raw`c:\Users\aarav\OneDrive\Desktop\Chatterbox Agent OS\agentos`;
const URL = process.argv[2] || 'https://chatterbox-agentos.pages.dev/pulse/';
const blob = fs.readFileSync(path.join(REPO, 'backups', 'live-now.json'), 'utf8');
const torn = JSON.parse(blob); torn.sales = {}; torn.calls = {}; torn._rev = JSON.parse(blob)._rev + 999999;
const b = await chromium.launch({ args: ['--js-flags=--max-old-space-size=8192'] });
const page = await b.newPage({ viewport: { width: 1500, height: 950 } });
const errs = []; page.on('pageerror', e => errs.push(String(e.message).slice(0, 120)));
await page.route('**chatterbox-agentos-api.chatterbox-agentos.workers.dev/**', route => {
  const u = route.request().url(); const m = route.request().method();
  if (u.includes('/api/me')) return route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ user: { username: 'diag', role: 'admin', tabs: { vas: ['*'] }, must_change_password: false } }) });
  if (u.includes('/api/kv') && m === 'GET' && u.includes('meta=1'))
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ found: true, updated_at: new Date().toISOString() }) });
  if (u.includes('/api/kv') && m === 'GET') return route.fulfill({ status: 200, contentType: 'text/plain', body: blob });
  return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
});
await page.addInitScript(t => {
  try { sessionStorage.setItem('cbx_token', 'diag'); } catch (e) {}
  try { localStorage.setItem('vas_mtd_tracker_v1', t); } catch (e) {}
  try { const chunk = 'x'.repeat(500000);
    for (let i = 0; i < 20; i++) { try { localStorage.setItem('cbx:filler-' + i, chunk); } catch (e) { break; } } } catch (e) {}
}, JSON.stringify(torn));
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForFunction(() => window.__mtd && window.__mtd.state(), null, { timeout: 90000 });
await page.waitForFunction(() => window.__vasHydrated === true, null, { timeout: 60000 }).catch(() => {});
await page.waitForTimeout(3000);
const out = await page.evaluate(() => {
  const st = window.__mtd.state();
  const txt = (document.querySelector('#page') || document.body).innerText;
  const gwp = (txt.match(/Total GWP[\s|]*R[\s\d]+/) || [''])[0].replace(/\s+/g, ' ');
  let vr = null; try { const V = window.__mtd.variance('2026-08-13', '2026-08-13');
    const rows = V.rows.filter(r => r.d === '2026-08-13'); const c = {}; rows.forEach(r => c[r.camp] = (c[r.camp] || 0) + 1);
    vr = { rows: rows.length, camp: c }; } catch (e) { vr = { err: String(e.message) }; }
  return { files: (st.files || []).length, sales: Object.keys(st.sales || {}).length,
    hydrated: !!window.__vasHydrated, noData: /No data for/.test(txt), gwp, variance13: vr };
});
console.log(JSON.stringify(out, null, 1));
console.log('page errors: ' + (errs.join(' ; ') || 'none'));
await page.screenshot({ path: path.join(REPO, 'backups', 'acceptance-quota-full.png') });
await b.close();
console.log(out.gwp && !out.noData && out.files > 0 ? 'ACCEPTANCE: PASS' : 'ACCEPTANCE: FAIL');
