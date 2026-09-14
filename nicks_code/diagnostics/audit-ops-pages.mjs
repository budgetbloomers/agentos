// audit-ops-pages.mjs — READ-ONLY drive of every Ops page on the DEPLOYED build under a temporary admin session:
// page errors, placeholder text, every KPI tile, a screenshot per page. Every POST /api/kv is answered locally,
// so nothing this session does can write a store.  node nicks_code/diagnostics/audit-ops-pages.mjs [--mtd]
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { chromium } = await import(pathToFileURL(path.join(ROOT, 'nicks_code', 'diagnostics', 'node_modules', 'playwright', 'index.mjs')).href);
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, 'supabase.env'), 'utf8').split(/\r?\n/).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const H = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY, 'Content-Type': 'application/json' };
const REST = env.SUPABASE_URL + '/rest/v1/'; const SITE = 'https://chatterbox-agentos.pages.dev/';
const OUT = path.join(ROOT, 'reports', 'ops-audit-2026-09-14', process.argv.includes('--mtd') ? 'shots-mtd' : 'shots'); fs.mkdirSync(OUT, { recursive: true });
const admin = (await (await fetch(REST + 'app_users?role=eq.admin&active=is.true&select=id,username&order=created_at.asc&limit=1', { headers: H })).json())[0];
const token = crypto.randomBytes(32).toString('hex'); const th = crypto.createHash('sha256').update(token).digest('hex');
await fetch(REST + 'app_sessions', { method: 'POST', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify([{ token_hash: th, user_id: admin.id, expires_at: new Date(Date.now() + 900000).toISOString(), user_agent: 'ops-drive' }]) });
const b = await chromium.launch({ args: ['--js-flags=--max-old-space-size=8192'] });
const report = { pages: [] };
try {
  const page = await b.newPage({ viewport: { width: 1600, height: 1000 } });
  const errs = []; page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 200)));
  const blocked = [];
  await page.route('**/api/kv?key=*', (route) => { if (route.request().method() === 'POST') { blocked.push(route.request().url()); return route.fulfill({ status: 200, body: '{"ok":true,"blocked":true}' }); } return route.continue(); });
  await page.addInitScript((t) => { sessionStorage.setItem('cbx_token', t); }, token);
  await page.goto(SITE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.acStats === 'function' && window.__initDone === true, null, { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(3000);
  const ids = await page.evaluate(() => (typeof PAGES !== 'undefined' && PAGES.map ? PAGES.map((p) => p.id) : (typeof NAV !== 'undefined' ? NAV.map((p) => p.id) : [])));
  if (process.argv.includes('--mtd')) { await page.evaluate(() => { state.range.mode='mtd'; state.range.from=null; state.range.to=null; render(); }); await page.waitForTimeout(2000); }
  const list = ids.length ? ids : ['exec', 'brain', 'sales', 'session', 'qa', 'qaperf', 'discipline', 'tl', 'workforce', 'manual', 'uploads', 'sess_uploads', 'dict'];
  console.log('pages:', list.join(', '));
  for (const id of list) {
    const before = errs.length;
    await page.evaluate((i) => go(i), id);
    await page.waitForTimeout(id === 'session' || id === 'sess_uploads' ? 8000 : 2500);
    const info = await page.evaluate(() => {
      const main = document.querySelector('main') || document.body;
      const text = main.innerText || '';
      const tiles = [...document.querySelectorAll('.kpi')].map((t) => ({ name: (t.querySelector('.kpi-name') || {}).innerText || '', val: (t.querySelector('.kpi-val') || {}).innerText || '', foot: (t.querySelector('.kpi-foot') || {}).innerText || '' }));
      const bad = (text.match(/\bNaN\b|undefined|\[object Object\]|Infinity/g) || []);
      return { route: (window.state || {}).route, len: text.length, tiles, bad, head: text.slice(0, 300).replace(/\n+/g, ' · '), range: (window.state || {}).range };
    });
    const shot = path.join(OUT, id + '.png'); await page.screenshot({ path: shot, fullPage: true });
    const pe = errs.slice(before);
    report.pages.push({ id, ...info, pageErrors: pe });
    console.log(`\n== ${id}  (${info.len} chars, ${info.tiles.length} tiles${pe.length ? ', ' + pe.length + ' PAGE ERROR(S)' : ''}${info.bad.length ? ', placeholders: ' + info.bad.join(',') : ''})`);
    for (const t of info.tiles.slice(0, 14)) console.log('   ' + t.name.padEnd(34) + ' ' + t.val.replace(/\n/g, ' ').padEnd(22) + ' ' + t.foot.replace(/\n/g, ' ').slice(0, 70));
    if (pe.length) console.log('   ERRORS: ' + pe.join(' | '));
  }
  console.log('\nblocked writes from this session: ' + blocked.length);
  fs.writeFileSync(path.join(OUT, '..', process.argv.includes('--mtd') ? 'pages-mtd.json' : 'pages.json'), JSON.stringify(report, null, 1));
} finally {
  await b.close();
  await fetch(REST + 'app_sessions?token_hash=eq.' + th, { method: 'DELETE', headers: H });
}
