/* THE LEAD MANAGEMENT CACHE MUST NEVER OUTLIVE ITS DATA.
 *
 * The tab used to re-walk both case books on every paint — 26,086 open + 37,623 closed rows,
 * 67,498 resolveKey calls — for a table of about 95 agents, which was most of the delay when
 * switching to it. The walk is now cached, and a cache on a page that reports case counts is
 * exactly the kind of speed fix that quietly starts showing yesterday's numbers.
 *
 * The invalidation rests on one fact: rebuild() assigns a NEW model object (M = buildModel(…)),
 * so any upload, period change or roster change replaces M and the cache cannot match. This
 * suite holds that fact still true, and checks the filter keys that do NOT go through rebuild.
 *
 * Run: node verify-leads-cache.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { responseText } from '../../tools/kv-store.mjs';   // the VAS state may be kept gzipped at rest (Spec Kit 031)
const AGENTOS = process.env.AGENTOS || decodeURIComponent(new URL('../..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1').replace(/\/$/, '');   // repo-relative (2026-09-08): the laptop path failed every cloud run
const { chromium } = await import(pathToFileURL(path.join(AGENTOS, 'nicks_code', 'diagnostics', 'node_modules', 'playwright', 'index.mjs')).href);
const HTML = path.join(AGENTOS, ...(process.env.PULSE_HTML || 'nicks_code/index.html').split('/'));
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + ' — ' + d); } };
const SIDE = { '/xlsx.full.min.js': path.join(AGENTOS, 'site', 'xlsx.full.min.js'),
  '/auth-gate.js': path.join(AGENTOS, 'site', 'auth-gate.js'),
  '/ask-widget.js': path.join(AGENTOS, 'site', 'ask-widget.js') };
const srv = http.createServer((q, s) => {
  const u = q.url.split('?')[0];
  const p = SIDE[u] || (u === '/' ? HTML : null);
  if (!p || !fs.existsSync(p)) { s.writeHead(404); s.end(); return; }
  s.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' });
  fs.createReadStream(p).pipe(s);
});

let blob = null;
try {
  const envTxt = fs.readFileSync(path.join(AGENTOS, 'supabase.env'), 'utf8');
  const env = Object.fromEntries(envTxt.split(/\r?\n/).filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
  const r = await fetch(env.SUPABASE_URL + '/storage/v1/object/raw/kv/vas-state',
    { headers: { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY } , signal: AbortSignal.timeout(90000) });
  if (r.ok) blob = await responseText(r);
} catch (e) { /* offline */ }
if (!blob) { console.log('(skipping — cannot read live state)'); process.exit(0); }

await new Promise(r => srv.listen(8219, '127.0.0.1', r));
const b = await chromium.launch();
const page = await b.newPage();
const errs = []; page.on('pageerror', e => errs.push(String(e.message).slice(0, 120)));
await page.goto('http://127.0.0.1:8219/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__mtd && window.__mtd.state(), null, { timeout: 30000 });
await page.evaluate(x => { const S = window.__mtd.state(); const o = JSON.parse(x);
  for (const k of Object.keys(o)) S[k] = o[k]; window.__mtd.rebuild(); }, blob);

const out = await page.evaluate(() => {
  const S = window.__mtd.state();
  /* one number off the page that can only come from the cached walk */
  const total = () => {
    const h = PAGES.leads();
    const m = h.match(/<tbody>([\s\S]*)<\/tbody>/);
    return (m ? m[1] : h).replace(/<[^>]+>/g, '|').replace(/\|+/g, '|');
  };
  const t0 = performance.now(); const first = total(); const cold = performance.now() - t0;
  const t1 = performance.now(); const second = total(); const warm = performance.now() - t1;

  /* THE MODEL IS REPLACED ON REBUILD — the whole invalidation rests on this */
  const before = window.__mtd.model();
  window.__mtd.rebuild();
  const newObject = window.__mtd.model() !== before;

  /* a real data change: drop the open book, rebuild, and the page must notice */
  const keptOpen = S.opencasesLM;
  S.opencasesLM = keptOpen ? { ...keptOpen, rows: (keptOpen.rows || []).slice(0, 5) } : null;
  window.__mtd.rebuild();
  const afterChange = total();
  S.opencasesLM = keptOpen; window.__mtd.rebuild();
  const restored = total();

  /* a filter change does NOT rebuild — it must be in the cache key */
  const camp0 = S.ui.camp;
  const all = total();
  S.ui.camp = 'Cuddle';
  const cuddle = total();
  S.ui.camp = camp0;
  const back = total();

  return { cold: Math.round(cold), warm: Math.round(warm), newObject,
    stableAcrossRenders: first === second,
    noticedChange: afterChange !== first, restored: restored === first,
    filterHonoured: cuddle !== all, filterRestored: back === all,
    len: first.length };
});
console.log('  cold build ' + out.cold + 'ms, warm ' + out.warm + 'ms');

ok('two renders of unchanged state agree', out.stableAcrossRenders);
ok('the warm render is genuinely cheaper', out.warm <= out.cold, out.cold + 'ms then ' + out.warm + 'ms');
ok('rebuild() assigns a NEW model object (the whole invalidation rests on this)', out.newObject);
ok('changing the case book changes the page', out.noticedChange, 'the cache served stale case counts');
ok('putting the book back restores the original numbers', out.restored);
ok('a campaign filter is honoured, not served from cache', out.filterHonoured);
ok('clearing the filter returns the original numbers', out.filterRestored);
ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
await b.close(); srv.close();
process.exit(fail ? 1 : 0);
