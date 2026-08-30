// REGRESSION GUARD: a ViciDial Agent Performance export must load whatever order it arrives in.
// IDX is built lazily and is null until the first model build. Resolving identity at ingest
// without guarding that threw inside the parser, so the file failed to load ENTIRELY and the
// whole Cuddle floor disappeared from the Variance Report — a worse failure than mis-keying.
// Loads the vici file FIRST, before any Agent List, which is the order that broke it.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
const REPO = String.raw`c:\Users\aarav\OneDrive\Desktop\Chatterbox Agent OS\agentos`;
const HTML = path.join(REPO, ...(process.env.PULSE_HTML || 'nicks_code/index.html').split('/'));
const SERVE = { '/': HTML, '/index.html': HTML, '/xlsx.full.min.js': path.join(REPO, 'site', 'xlsx.full.min.js') };
const server = http.createServer((q, s) => {
  const p = SERVE[q.url.split('?')[0]];
  if (!p || !fs.existsSync(p)) { s.writeHead(404); s.end('nf'); return; }
  s.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' });
  fs.createReadStream(p).pipe(s);
});
await new Promise(r => server.listen(8143, '127.0.0.1', r));
let pass = 0, fail = 0; const failures = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  pass  ' + n); } else { fail++; failures.push(n + ' — ' + d); console.log('  FAIL  ' + n + ' — ' + d); } };

const b = await chromium.launch({ args: ['--js-flags=--max-old-space-size=8192'] });
const page = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; page.on('pageerror', e => errs.push(String(e.message)));
await page.goto('http://127.0.0.1:8143/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__mtd && window.__mtd.state(), null, { timeout: 60000 });

const UP = path.join(REPO, 'uploads', '2026-08-06');
let filesSeen = 0;                 // how many registry entries the last settled drop left
const drop = async name => {
  const buf = fs.readFileSync(path.join(UP, name));
  await page.evaluate(async ({ n, b64 }) => {
    const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const dt = new DataTransfer(); dt.items.add(new File([bin], n));
    const inp = document.querySelector('input[type=file]');
    Object.defineProperty(inp, 'files', { value: dt.files, configurable: true });
    inp.dispatchEvent(new Event('change', { bubbles: true }));
  }, { n: name, b64: buf.toString('base64') });
  /* WAIT ON THE STATE, NOT ON A STOPWATCH (audit round 6, 2026-08-28). Fixed 2.2s sleeps
     held on an idle machine and broke under CPU contention — this suite reported three
     phantom failures inside a full battery run while passing 7/7 alone. A guard that cries
     wolf is worse than no guard: the next real failure gets waved through as "just flaky".
     Wait for the registry to actually record the file, then for it to settle. */
  const before = filesSeen;
  await page.waitForFunction(n => (window.__mtd.state().files || []).length > n, before, { timeout: 120000 })
    .catch(() => {});                                  // a refused file legitimately adds none
  { let last = -1, stable = 0;
    for (let i = 0; i < 60; i++) {
      await page.waitForTimeout(250);
      const n = await page.evaluate(() => (window.__mtd.state().files || []).length);
      if (n === last) { if (++stable >= 3) break; } else { stable = 0; last = n; }
    }
    filesSeen = last; }
};

// THE ORDER THAT BROKE IT: dialler first, roster nowhere in sight.
console.log('\n— ViciDial export uploaded FIRST, before any Agent List —');
await page.evaluate(() => { IDX = null; });          // the cold state a fresh session has
await drop('Vici - Cuddle Agents - 3 - 5 Aug.csv');
const first = await page.evaluate(() => {
  const st = window.__mtd.state();
  const rows = Object.values(st.vici || {}).flatMap(v => v.rows || []);
  return { ranges: Object.keys(st.vici || {}).length, rows: rows.length, files: (st.files || []).length };
});
ok('the export still LOADS with no index built', first.rows > 0, JSON.stringify(first));
ok('it is registered as a file', first.files > 0, JSON.stringify(first));
ok('no page error was thrown during ingest', errs.length === 0, errs.join(' | '));

console.log('\n— now the Agent List arrives —');
await drop('Matrix - Agent List.xlsx');
await drop('BI Active - 05.08.xlsx');
await drop('attendance_2026-08-01_to_2026-08-06.csv');
const after = await page.evaluate(() => {
  const VR = window.__mtd.variance('2026-08-03', '2026-08-05');
  const cud = VR.rows.filter(r => r.camp === 'Cuddle');
  return { cudRows: cud.length, cudAgents: [...new Set(cud.map(r => r.code))].length,
    withTalk: cud.filter(r => (r.talk || 0) > 0 || (r.talkEst || 0) > 0).length };
});
console.log('  Cuddle: ' + after.cudRows + ' rows · ' + after.cudAgents + ' agents · ' + after.withTalk + ' with talk');
ok('Cuddle appears in the Variance Report', after.cudRows > 0, JSON.stringify(after));
ok('every Cuddle agent in the export is present', after.cudAgents >= 24, after.cudAgents + '');
ok('their talk survived the ingest', after.withTalk > 0, JSON.stringify(after));
ok('still no page errors', errs.length === 0, errs.join(' | '));

await b.close(); server.close();
console.log('\n' + pass + ' passed · ' + fail + ' failed');
if (fail) { console.log('\nFAILURES:'); failures.forEach(f => console.log(' - ' + f)); process.exit(1); }
