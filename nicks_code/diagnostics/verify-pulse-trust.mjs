// PULSE (VAS) — full 2026-08-13 package through the real UI: every slot loads,
// Data Trust reads 7/7, refused Ops files stay refused, no page errors.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

const REPO = String.raw`c:\Users\aarav\OneDrive\Desktop\Chatterbox Agent OS\agentos`;
const UP = path.join(REPO, 'uploads', '2026-08-13');
// PULSE_HTML=site/pulse/index.html runs this against the BUILD copy (same as verify-engine-rules)
const HTML = path.join(REPO, ...(process.env.PULSE_HTML || 'nicks_code/index.html').split('/'));
const SERVE = {
  '/': HTML,
  '/index.html': HTML,
  '/xlsx.full.min.js': path.join(REPO, 'site', 'xlsx.full.min.js'),
};
const server = http.createServer((req, res) => {
  const p = SERVE[req.url.split('?')[0]];
  if (!p || !fs.existsSync(p)) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' });
  fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(8129, '127.0.0.1', r));

const j = (...p) => path.join(...p);
const FILES = [
  j(UP, 'Matrix - Agent List.xlsx'),
  j(UP, 'attendance_2026-08-06_to_2026-08-13.csv'),
  j(UP, 'Active.xlsx'),
  j(UP, 'Inactive.xlsx'),
  j(UP, 'call_records.csv'),
  j(UP, 'Call Report 01 to 13 Aug.xlsx'),
  j(UP, 'evaluations-full-export-2026-08-13.csv'),
  j(UP, 'SF Open Cases 5 - 13.xls'),
  j(UP, 'SF Closed 5 - 13.xls'),
];

let pass = 0, fail = 0; const failures = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  pass  ' + n); } else { fail++; failures.push(n + (d ? ' — ' + d : '')); console.log('  FAIL  ' + n + ' — ' + d); } };

const browser = await chromium.launch({ args: ['--js-flags=--max-old-space-size=8192'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
await page.goto('http://127.0.0.1:8129/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__mtd && window.__mtd.state(), null, { timeout: 30000 });

console.log('Dropping the full 2026-08-13 package (9 files)…');
await page.setInputFiles('#fileInput', FILES, { timeout: 120000 });
await page.waitForFunction(() => (window.__mtd.state().files || []).length >= 7, null, { timeout: 600000 });
await page.waitForTimeout(6000);

const snap = await page.evaluate(() => {
  const S = window.__mtd.state();
  return {
    files: (S.files || []).map(f => f.type + ' | ' + f.name),
    roster: (S.roster || []).length,
    callDays: Object.keys(S.calls || {}).length,
    attDays: Object.keys(S.att || {}).length,
    salesDays: Object.keys(S.sales || {}).length,
    cancRows: Object.keys(S.cancRows || {}).length,
    evals: Object.keys(S.evals || {}).length,
    opencases: !!S.opencases,
  };
});
console.log(JSON.stringify(snap, null, 1));
const has = re => snap.files.some(f => re.test(f));

ok('roster loaded', snap.roster > 0, 'roster=' + snap.roster);
ok('BI Active loaded (bi)', has(/^bi \|/), snap.files.join(' || '));
ok('Cancellations loaded', has(/^cancellations \|/));
ok('CallX call records loaded (calls, not ViciDial)', has(/^calls \|/) || has(/^calls \((?!ViciDial)/));
ok('ViciDial call report loaded per-call', has(/^calls \(ViciDial\)/));
ok('attendance loaded', has(/^attendance/) && snap.attDays > 0, 'attDays=' + snap.attDays);
ok('evaluations loaded', has(/^evals/));
ok('Open Cases refused as Ops file (ignored, NOT stored)', !snap.opencases, 'S.opencases=' + snap.opencases);
ok('sales days present from BI', snap.salesDays > 0, 'salesDays=' + snap.salesDays);

// force the trust bar to rebuild now (it ticks every 10s)
await page.evaluate(() => { window.__vasTrustToggle(); window.__vasTrustToggle(); });
await page.waitForTimeout(400);
const trust = await page.evaluate(() => (document.getElementById('vasTrust') || {}).innerText || '');
console.log('TRUST BAR: ' + trust.replace(/\n/g, ' · '));
ok('trust bar counts 7/7 sources', /7\/7 sources/.test(trust), trust);
ok('trust bar reads All sources fresh', /All sources fresh/.test(trust), trust);

// open the chips and confirm every one of the seven names is present and fresh
await page.evaluate(() => window.__vasTrustToggle());
await page.waitForTimeout(400);
const chips = await page.evaluate(() => (document.getElementById('vasTrust') || {}).innerText || '');
for (const name of ['Power BI - Active Cases', 'Call Records', 'ViciDial', 'Attendance', 'QA Evaluations', 'Agent List', 'Cancellations (BI Inactive)'])
  ok('chip present: ' + name, chips.includes(name), chips);
ok('no chip reads "none"', !/· none/.test(chips), chips);

ok('no page errors', errors.length === 0, errors.slice(0, 4).join(' | '));

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
failures.forEach(f => console.log('FAIL: ' + f));
await browser.close(); server.close();
process.exit(fail || errors.length ? 1 : 0);
