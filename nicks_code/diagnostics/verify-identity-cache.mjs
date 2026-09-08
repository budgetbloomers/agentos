/* THE IDENTITY CACHE MUST NEVER GO STALE.
   resolveKey() is memoised (perf, 2026-08-27). A cached answer that survives an
   identity change would attribute a sale to the WRONG AGENT — the worst class of
   bug in this app. This proves the cache is dropped on every path that can change
   an identity: a new Agent List, a manual identity mapping, and a cloud hydrate. */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
const AGENTOS = process.env.AGENTOS || decodeURIComponent(new URL('../..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1').replace(/\/$/, '');   // repo-relative (2026-09-08): the laptop path failed every cloud run
const { chromium } = await import(pathToFileURL(path.join(AGENTOS, 'nicks_code', 'diagnostics', 'node_modules', 'playwright', 'index.mjs')).href);
const HTML = path.join(AGENTOS, ...(process.env.PULSE_HTML || 'nicks_code/index.html').split('/'));
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + ' — ' + d); } };
const SERVE = { '/': HTML, '/index.html': HTML, '/xlsx.full.min.js': path.join(AGENTOS, 'site', 'xlsx.full.min.js') };
const srv = http.createServer((q, s) => { const p = SERVE[q.url.split('?')[0]];
  if (!p) { s.writeHead(404); s.end(); return; }
  s.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' });
  fs.createReadStream(p).pipe(s); });
await new Promise(r => srv.listen(8191, '127.0.0.1', r));
const b = await chromium.launch();
const page = await b.newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.goto('http://127.0.0.1:8191/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__mtd && window.__mtd.state(), null, { timeout: 30000 });

const HDR = 'Team Leader,Agent Name,Employee Code,Campaign,Tenure,Call x,Sales Force,Target';
const r = await page.evaluate(async (HDR) => {
  const out = {};
  const nl = String.fromCharCode(10);
  // 1. a roster where "Sam Traveller" is CB901
  await window.__mtd.ingest('Matrix - Agent List.xlsx', [HDR,
    'Alpha L,Sam Traveller,CB901,Courtesy,M1,Sam Traveller CB-901,Sam Traveller,5',
    'Alpha L,Other Person,CB902,Courtesy,M1,Other Person CB-902,Other Person,5'].join(nl));
  window.__mtd.rebuild();
  out.before = resolveKey('Sam Traveller');                 // populates the memo

  // 2. a NEW Agent List: the same human is now CB903 (a re-issued code — the real
  //    scenario is an agent returning under a new employee number)
  await window.__mtd.ingest('Matrix - Agent List v2.xlsx', [HDR,
    'Alpha L,Sam Traveller,CB903,Courtesy,M1,Sam Traveller CB-903,Sam Traveller,5',
    'Alpha L,Other Person,CB902,Courtesy,M1,Other Person CB-902,Other Person,5'].join(nl));
  window.__mtd.rebuild();
  out.afterList = resolveKey('Sam Traveller');

  // 3. a manual identity mapping must also invalidate
  const S = window.__mtd.state();
  out.beforeMap = resolveKey('Ghost Name');                 // null, and memoised as null
  window.mapIdentity('Ghost Name', 'CB902');
  out.afterMap = resolveKey('Ghost Name');

  // 4. a cloud hydrate replacing the roster wholesale
  const blob = JSON.stringify({ ...JSON.parse(JSON.stringify(S)),
    roster: [{ code: 'CB904', name: 'Sam Traveller', sf: 'Sam Traveller', callx: 'Sam Traveller CB-904',
      campaign: 'Courtesy', tenure: 'M1', tl: 'Alpha L', target: 5 }] });
  const o = JSON.parse(blob);
  for (const k of Object.keys(o)) S[k] = o[k];
  window.__mtd.rebuild();
  out.afterHydrate = resolveKey('Sam Traveller');
  return out;
}, HDR);

console.log(JSON.stringify(r));
ok('the name resolves to its code before any change', r.before === 'CB901', String(r.before));
ok('a NEW Agent List re-points the name — the cache did not survive it', r.afterList === 'CB903', String(r.afterList));
ok('a manual identity mapping invalidates a cached MISS', r.beforeMap === null && r.afterMap === 'CB902', r.beforeMap + ' → ' + r.afterMap);
ok('a cloud hydrate invalidates the cache', r.afterHydrate === 'CB904', String(r.afterHydrate));
ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
await b.close(); srv.close();
process.exit(fail ? 1 : 0);
