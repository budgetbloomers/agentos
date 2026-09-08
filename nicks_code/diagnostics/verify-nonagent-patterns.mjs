/* THE NON-AGENT PATTERNS MUST ACTUALLY COMPILE.
 *
 * `nonAgentPatterns` are STRING literals, not regex literals, so '\d' is not a JS string
 * escape — the backslash was silently dropped at parse time and three of the five compiled
 * to ^CBTd+$ / ^TRAINING ?d*$ / ^d{3,5}$, which match nothing. Test and system logins the
 * rule was written to exclude ("Training 1", a bare supervisor id) were therefore ingested
 * as real dialler users and reported as "missing from the Agent List", with their talk
 * seconds counted. The drift check never saw it: it compares nonAgentUsers only, and the
 * spec JSON carries the same de-escaped text.
 *
 * Run: node verify-nonagent-patterns.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
const AGENTOS = process.env.AGENTOS || decodeURIComponent(new URL('../..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1').replace(/\/$/, '');   // repo-relative (2026-09-08): the laptop path failed every cloud run
const { chromium } = await import(pathToFileURL(path.join(AGENTOS, 'nicks_code', 'diagnostics', 'node_modules', 'playwright', 'index.mjs')).href);
const HTML = path.join(AGENTOS, ...(process.env.PULSE_HTML || 'nicks_code/index.html').split('/'));
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + ' — ' + d); } };
const srv = http.createServer((q, s) => {
  const p = q.url.split('?')[0] === '/xlsx.full.min.js' ? path.join(AGENTOS, 'site', 'xlsx.full.min.js') : HTML;
  s.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' });
  fs.createReadStream(p).pipe(s);
});
await new Promise(r => srv.listen(8215, '127.0.0.1', r));
const b = await chromium.launch();
const page = await b.newPage();
await page.goto('http://127.0.0.1:8215/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__mtd && window.__mtd.rules(), null, { timeout: 30000 });

const r = await page.evaluate(() => {
  const pats = (window.__mtd.rules().viciCallReport || {}).nonAgentPatterns || [];
  const test = (v) => pats.some((p) => { try { return new RegExp(p, 'i').test(v); } catch (e) { return false; } });
  const compiles = pats.every((p) => { try { new RegExp(p, 'i'); return true; } catch (e) { return false; } });
  return {
    pats, compiles,
    excluded: ['CBT005', 'CBT009', 'Training 1', 'Training 4', 'Agent Test', '9027', '9031', 'VDAD', 'VDCL'].filter(test),
    kept: ['CB93', 'Nothando Mntungwa', 'Enoch Pillay - Panimax', 'CB204'].filter((v) => !test(v)),
    wronglyKept: ['CBT009', 'Training 4', '9031'].filter((v) => !test(v)),
    wronglyExcluded: ['CB93', 'Nothando Mntungwa', 'CB204'].filter(test),
  };
});
console.log('  patterns: ' + JSON.stringify(r.pats));
ok('every pattern compiles', r.compiles);
ok('a test login shape is excluded (CBT009, Training 4, supervisor id 9031)',
  r.wronglyKept.length === 0, 'still treated as real agents: ' + r.wronglyKept.join(', '));
ok('the dialler system users are excluded', r.excluded.includes('VDAD') && r.excluded.includes('VDCL'), r.excluded.join(', '));
ok('a REAL agent is never excluded', r.wronglyExcluded.length === 0, 'wrongly excluded: ' + r.wronglyExcluded.join(', '));
console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
await b.close(); srv.close();
process.exit(fail ? 1 : 0);
