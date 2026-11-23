#!/usr/bin/env node
/**
 * verify-vt-tabs.mjs — the daily health checks' VT half on its own (spec 071, Phase F item 5).
 *
 *   node nicks_code/diagnostics/verify-vt-tabs.mjs            the BUILT PULSE page over the fictional VT floor (offline)
 *   node nicks_code/diagnostics/verify-vt-tabs.mjs --live     the same over the LIVE VT book (read-only; after deploy, once
 *                                                             migrations 071/072 are applied — skips cleanly before that)
 *
 * It drives exactly what verify-all-tabs (section 3c) and verify-controls (PULSE) now run on the three VT pages, through
 * vt-tab-source.mjs: every VT page renders, the page's model equals VTEngine.model() over the same inputs, and every
 * in-page select / chip changes the page. No VAS state is needed. Run tools/prepare-site.js first (or pass --build).
 */
import fs from 'node:fs'; import path from 'node:path'; import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { vtSource, installVtRoutes, checkVtTabs, probeVtControls } from './vt-tab-source.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url)); const ROOT = path.resolve(HERE, '..', '..');
const { chromium } = await import(pathToFileURL(path.join(HERE, 'node_modules', 'playwright', 'index.mjs')).href);
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (d ? ' — ' + String(d).slice(0, 300) : '')); } };
if (process.argv.includes('--build')) { const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'prepare-site.js')], { cwd: ROOT, encoding: 'utf8' }); ok('the site builds', r.status === 0, (r.stderr || r.stdout).slice(-300)); }
const LIVE = process.argv.includes('--live');
const src = await vtSource({ live: LIVE });
if (!src) { console.log('  --   skipped: the live VT tables cannot be read (migration 071 not applied, or no supabase.env)'); process.exit(0); }
const HTML = path.join(ROOT, 'site', 'pulse', 'index.html');
ok('site/pulse/index.html is built', fs.existsSync(HTML));
const SERVE = { '/index.html': HTML, '/xlsx.full.min.js': path.join(ROOT, 'site', 'xlsx.full.min.js') };
const server = http.createServer((q, s) => { const p = SERVE[q.url.split('?')[0]]; if (!p || !fs.existsSync(p)) { s.writeHead(404); s.end(); return; }
  s.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' }); fs.createReadStream(p).pipe(s); });
await new Promise((r) => server.listen(8276, '127.0.0.1', r));
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errs = []; page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160))); page.on('dialog', (d) => d.dismiss().catch(() => {}));
  await installVtRoutes(page, src);
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)(?!chatterbox-agentos-api)/, (r) => r.abort());   // nothing else leaves the machine
  await page.goto('http://127.0.0.1:8276/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__mtd && window.__mtd.state() && window.VTPages, null, { timeout: 60000 });
  await page.evaluate(() => { window.__cloudPush = function () {}; window.CBX_USER = { role: 'admin', username: 'tester', tabs: {} }; });
  console.log('\nVT pages render and paint the engine — ' + src.label);
  await checkVtTabs(page, ok, src);
  console.log('\nVT pages: every control changes the page — ' + src.label);
  await probeVtControls(page, ok, src);
  ok('no page errors', errs.length === 0, [...new Set(errs)].join(' | '));
} finally { await browser.close(); server.close(); }
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
