/* The AS-AT cut-off. Without it "this month" means "every date any file happens to carry",
   the sources end on different days, and the dashboard can never be squared with a tracker
   that was cut earlier. These checks prove: it caps the window, it does NOT reshape the
   month (targets stay month-shaped, the label stays the month), clearing it restores
   everything, and with it set to the day the workbook was cut the dashboard reproduces the
   workbook's Cohen Govender row exactly — the row that started this. */
import { chromium } from 'playwright';
import fs from 'node:fs'; import path from 'node:path'; import http from 'node:http';
const REPO = String.raw`c:\Users\aarav\OneDrive\Desktop\Chatterbox Agent OS\agentos`;
const UP = path.join(REPO, 'uploads', '2026-08-06');
const SERVE = { '/': path.join(REPO, 'nicks_code', 'index.html'), '/index.html': path.join(REPO, 'nicks_code', 'index.html'),
  '/xlsx.full.min.js': path.join(REPO, 'site', 'xlsx.full.min.js') };
const server = http.createServer((q, s) => { const p = SERVE[q.url.split('?')[0]];
  if (!p || !fs.existsSync(p)) { s.writeHead(404); s.end('nf'); return }
  s.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' }); fs.createReadStream(p).pipe(s) });
await new Promise(r => server.listen(8141, '127.0.0.1', r));
const j = (...p) => path.join(...p);
let pass = 0, fail = 0; const failures = [];
const ok = (n, c, d = '') => { if (c) pass++; else { fail++; failures.push(n + (d ? ' — ' + d : '')); } };

const browser = await chromium.launch({ args: ['--js-flags=--max-old-space-size=8192'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.goto('http://127.0.0.1:8141/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__mtd && window.__mtd.state(), null, { timeout: 30000 });
await page.setInputFiles('#fileInput', ['Matrix - Agent List.xlsx', 'attendance_2026-08-01_to_2026-08-06.csv',
  'BI Active - 05.08.xlsx', 'BI Inactive - 05.08.xlsx', 'Call X Call report - 3 - 5.xlsx',
  'Vici - Cuddle Agents - 3 - 5 Aug.csv', 'evaluations-full-export-2026-08-06.csv'].map(f => j(UP, f)), { timeout: 60000 });
await page.waitForFunction(() => (window.__mtd.state().files || []).length >= 6, null, { timeout: 600000 });
await page.waitForTimeout(5000);

const cohen = () => page.evaluate(() => {
  const M = window.__mtd.model(), S = window.__mtd.state();
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
  const code = (S.roster.find(a => norm(a.name) === 'cohengovender') || {}).code;
  const o = M.mtdCC.Courtesy[code] || M.mtdCC.Cuddle[code];
  return { range: M.range, days: M.dates.length,
    emp: o && o.emp, act: o && o.act, target: o && o.target, sales: o && o.sales,
    spd: o && o.spd, canc: o && o.canc, gwpT: o && o.gwpT, gwp: o && o.gwp };
});

await page.evaluate(() => window.__mtd.setPeriod('2026-08', 'calendar'));
await page.waitForTimeout(1200);
const wide = await cohen();
console.log('calendar August:', JSON.stringify(wide));
ok('without a cut-off the period runs to the furthest date any source carries',
  wide.range.to === '2026-08-31' && wide.days === 4, JSON.stringify(wide.range) + ' days=' + wide.days);

const ends = await page.evaluate(() => window.__mtd.sourceEnds());
console.log('source ends:', JSON.stringify(ends));
ok('sources genuinely end on different days (that is the trap being closed)',
  new Set(Object.values(ends).filter(Boolean)).size > 1, JSON.stringify(ends));
await page.evaluate(() => go('mtd'));
await page.waitForTimeout(700);
ok('the ragged-coverage note is shown when they disagree',
  await page.locator('text=Your sources end on different days').count() > 0);

// ---- cut to the day the workbook was built
await page.evaluate(() => window.__mtd.setAsAt('2026-08-04'));
await page.waitForTimeout(1200);
const cut = await cohen();
console.log('as at 2026-08-04:', JSON.stringify(cut));
ok('as-at caps where the period ends', cut.range.to === '2026-08-04', JSON.stringify(cut.range));
ok('as-at does NOT move where it starts', cut.range.from === '2026-08-01', JSON.stringify(cut.range));
ok('as-at drops the days after it', cut.days === 3, `dialling days ${cut.days}`);

/* The row from the screenshot, against the hand-built workbook. The workbook's money columns
   are VAT-INCLUSIVE; the app displays GWP EX-VAT since 2026-08-18 (the agent comms basis), so
   the two money figures are compared after grossing the app's back up. ±1 covers the
   re-rounding; every other column stays exact. */
const WB = { emp: 2, act: 2, target: 8, sales: 4, spd: 2, canc: 0, gwpT: 712, gwp: 416 };
const MONEY = new Set(['gwpT', 'gwp']);
for (const [k, want] of Object.entries(WB)) {
  const got = cut[k] ?? NaN;
  const cmp = MONEY.has(k) ? Math.round(got * 1.15) : got;
  ok(`Cohen Govender ${k} matches the workbook`, Math.abs(cmp - want) <= (MONEY.has(k) ? 1 : 0.005),
    `wb=${want} app=${got}${MONEY.has(k) ? ' ex → ' + cmp + ' incl' : ''}`);
}

await page.evaluate(() => go('mtd'));
await page.waitForTimeout(700);
ok('the note goes quiet once a cut-off is set',
  await page.locator('text=Your sources end on different days').count() === 0);
ok('the header says which day it is cut to', (await page.locator('.page-head .sub').first().innerText()).includes('as at 2026-08-04'));

// ---- clearing it restores everything
await page.evaluate(() => window.__mtd.setAsAt(''));
await page.waitForTimeout(1200);
const back = await cohen();
ok('clearing the cut-off restores the full period', JSON.stringify(back) === JSON.stringify(wide),
  JSON.stringify(back) + ' vs ' + JSON.stringify(wide));

// ---- a cut-off outside the period must be ignored, never blank the page
for (const [d, why] of [['2026-07-15', 'before the period'], ['2026-09-30', 'after the period']]) {
  await page.evaluate(x => window.__mtd.setAsAt(x), d);
  await page.waitForTimeout(900);
  const r = await cohen();
  ok(`a cut-off ${why} is ignored, not obeyed into an empty page`, r.days === wide.days, `${d} -> days=${r.days}`);
}
await page.evaluate(() => window.__mtd.setAsAt(''));
await page.waitForTimeout(600);

ok('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
failures.forEach(f => console.log('FAIL: ' + f));
await browser.close(); server.close();
process.exit(fail || errors.length ? 1 : 0);