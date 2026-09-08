/* EVERY TABLE'S BODY MUST HAVE AS MANY CELLS AS ITS HEADER HAS COLUMNS.
 *
 * Found 2026-08-28: the Agent Performance table carried 17 cells against 16 headers — an
 * opt-in cell left behind when opt-ins were retired and its header removed. Everything from
 * "Calls" rightwards therefore displayed the WRONG metric: a team leader read "Calls 43%"
 * for an agent with 512 calls, "Score" showed a sparkline, "Risk" showed the score. The CSV
 * export is built from a separate column list, so screen and export disagreed — which is
 * exactly why it went unnoticed.
 *
 * This renders every tab over the live state and compares, for each table, the header count
 * against each body row's cell count (colspan-aware).
 *
 * Run: node verify-table-columns.mjs   (PULSE_HTML=nicks_code/index.html for the source)
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
const AGENTOS = process.env.AGENTOS || decodeURIComponent(new URL('../..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1').replace(/\/$/, '');   // repo-relative (2026-09-08): the laptop path failed every cloud run
const { chromium } = await import(pathToFileURL(path.join(AGENTOS, 'nicks_code', 'diagnostics', 'node_modules', 'playwright', 'index.mjs')).href);
const HTML = path.join(AGENTOS, ...(process.env.PULSE_HTML || 'nicks_code/index.html').split('/'));

const env = Object.fromEntries(fs.readFileSync(path.join(AGENTOS, 'supabase.env'), 'utf8')
  .split(/\r?\n/).filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const H = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY };
const blob = await (await fetch(`${env.SUPABASE_URL}/storage/v1/object/raw/kv/vas-state`, { headers: H, signal: AbortSignal.timeout(90000) })).text();

const SERVE = { '/': HTML, '/xlsx.full.min.js': path.join(AGENTOS, 'site', 'xlsx.full.min.js') };
const srv = http.createServer((q, s) => { const p = SERVE[q.url.split('?')[0]];
  if (!p) { s.writeHead(404); s.end(); return; }
  s.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' });
  fs.createReadStream(p).pipe(s); });
await new Promise(r => srv.listen(8201, '127.0.0.1', r));
const b = await chromium.launch({ args: ['--js-flags=--max-old-space-size=8192'] });
const page = await b.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto('http://127.0.0.1:8201/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__mtd && window.__mtd.state(), null, { timeout: 30000 });
await page.evaluate(x => { const S = window.__mtd.state(); const o = JSON.parse(x);
  for (const k of Object.keys(o)) S[k] = o[k]; window.__mtd.rebuild(); }, blob);

const tabs = await page.evaluate(() => (typeof NAV !== 'undefined' ? NAV : []).flatMap(g => g.items.map(i => i[0])));
let pass = 0, fail = 0;
for (const tab of tabs) {
  const bad = await page.evaluate(async (t) => {
    const S = window.__mtd.state(); S.ui.tab = t; renderPage();
    await new Promise(r => setTimeout(r, 900));
    const out = [];
    document.querySelectorAll('#view table').forEach((tbl, ti) => {
      const head = tbl.querySelector('thead tr');
      if (!head) return;
      const cols = [...head.children].reduce((n, th) => n + (parseInt(th.getAttribute('colspan') || '1', 10) || 1), 0);
      const rows = [...tbl.querySelectorAll('tbody tr')];
      const counts = {};
      rows.forEach(tr => {
        const c = [...tr.children].reduce((n, td) => n + (parseInt(td.getAttribute('colspan') || '1', 10) || 1), 0);
        counts[c] = (counts[c] || 0) + 1;
      });
      for (const c of Object.keys(counts))
        if (+c !== cols) out.push('table#' + ti + ' header=' + cols + ' body=' + c + ' (' + counts[c] + ' row(s))');
    });
    return out;
  }, tab);
  if (bad.length) { fail++; console.log('  FAIL ' + tab + ' — ' + bad.slice(0, 3).join(' | ')); }
  else { pass++; console.log('  ok   ' + tab); }
}
console.log('\n==== ' + pass + ' tab(s) aligned, ' + fail + ' with mismatched columns ====');
await b.close(); srv.close();
process.exit(fail ? 1 : 0);
