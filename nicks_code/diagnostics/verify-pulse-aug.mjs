// Pulse (VAS) verification against the August drop, incl. the new ViciDial export.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

const REPO = process.env.AGENTOS || decodeURIComponent(new URL('../..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1').replace(/\/$/, '');   // repo-relative (2026-09-08): the laptop path failed every cloud run
const UP = path.join(REPO, 'uploads', '2026-08-06');
const SCRATCH = process.cwd();
const SERVE = {
  '/': path.join(REPO, 'nicks_code', 'index.html'),
  '/index.html': path.join(REPO, 'nicks_code', 'index.html'),
  '/xlsx.full.min.js': path.join(REPO, 'site', 'xlsx.full.min.js'),
};
const server = http.createServer((req, res) => {
  const p = SERVE[req.url.split('?')[0]];
  if (!p || !fs.existsSync(p)) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' });
  fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(8124, '127.0.0.1', r));

const j = (...p) => path.join(...p);
const FILES = [
  j(UP, 'Matrix - Agent List.xlsx'),
  j(UP, 'attendance_2026-08-01_to_2026-08-06.csv'),
  j(UP, 'BI Active - 05.08.xlsx'),
  j(UP, 'BI Inactive - 05.08.xlsx'),
  j(UP, 'Call X Call report - 3 - 5.xlsx'),
  j(UP, 'Vici - Cuddle Agents - 3 - 5 Aug.csv'),
  j(UP, 'evaluations-full-export-2026-08-06.csv'),
];

let pass = 0, fail = 0; const failures = [];
const ok = (n, c, d = '') => { if (c) pass++; else { fail++; failures.push(n + (d ? ' — ' + d : '')); } };

const browser = await chromium.launch({ args: ['--js-flags=--max-old-space-size=8192'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
await page.goto('http://127.0.0.1:8124/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__mtd && window.__mtd.state(), null, { timeout: 30000 });

const snap = () => page.evaluate(() => {
  const S = window.__mtd.state();
  const sum = (o, f) => { let t = 0; for (const d in o) for (const k in o[d]) t += f(o[d][k]); return t; };
  return {
    files: (S.files || []).map(f => f.type + ' | ' + f.name),
    roster: (S.roster || []).length,
    callDays: Object.keys(S.calls || {}).length,
    talkH: +(sum(S.calls, b => b.talk) / 3600).toFixed(2),
    calls: sum(S.calls, b => b.calls),
    vici: Object.keys(S.vici || {}),
    viciRows: Object.values(S.vici || {}).reduce((t, v) => t + v.rows.length, 0),
    salesDays: Object.keys(S.sales || {}).length,
    attDays: Object.keys(S.att || {}).length,
  };
});

console.log('Round 1: dropping the August set…');
await page.setInputFiles('#fileInput', FILES, { timeout: 60000 });
await page.waitForFunction(() => (window.__mtd.state().files || []).length >= 6, null, { timeout: 600000 });
await page.waitForTimeout(4000);
const s1 = await snap();
console.log(JSON.stringify(s1, null, 1));
ok('Vici recognised (not "could not recognise")', s1.files.some(f => /vici/i.test(f)), s1.files.join(' || '));
ok('multi-day Vici stored as a range, not split', s1.vici.length === 1 && s1.vici[0] === '2026-08-03..2026-08-05', JSON.stringify(s1.vici));
ok('24 Vici agent rows kept (TOTALS + 2 ADMIN dropped)', s1.viciRows === 24, `got ${s1.viciRows}`);
ok('multi-day Vici NOT mixed into per-day calls', s1.callDays === 3, `callDays=${s1.callDays}`);
ok('Inactive still not treated as money', s1.salesDays > 0, `salesDays=${s1.salesDays}`);

// ---- single-day Vici export maps straight onto its day
const raw = fs.readFileSync(j(UP, 'Vici - Cuddle Agents - 3 - 5 Aug.csv'), 'utf8');
const oneDay = raw.replace('Time range: 2026-08-03 00:00:00 to 2026-08-05 23:59:59', 'Time range: 2026-08-04 00:00:00 to 2026-08-04 23:59:59');
fs.writeFileSync(j(SCRATCH, 'Vici single day 04.csv'), oneDay);
const before = await snap();
await page.setInputFiles('#fileInput', [j(SCRATCH, 'Vici single day 04.csv')], { timeout: 60000 });
await page.waitForTimeout(6000);
const s2 = await snap();
console.log('after single-day Vici:', JSON.stringify({ talkH: s2.talkH, calls: s2.calls, callDays: s2.callDays }));
ok('single-day Vici merged onto its day', s2.talkH > before.talkH, `${before.talkH} -> ${s2.talkH}`);
ok('merge did not wipe the day\'s CallX agents', s2.callDays === 3, `callDays=${s2.callDays}`);

// re-drop the same single-day file: content hash must skip it
await page.setInputFiles('#fileInput', [j(SCRATCH, 'Vici single day 04.csv')], { timeout: 60000 });
await page.waitForTimeout(5000);
const s3 = await snap();
ok('re-dropping the same Vici file changes nothing', s3.talkH === s2.talkH && s3.calls === s2.calls, `${s2.talkH}/${s2.calls} -> ${s3.talkH}/${s3.calls}`);

// same content, new filename -> must not double the day
fs.writeFileSync(j(SCRATCH, 'Vici renamed 04.csv'), oneDay);
await page.setInputFiles('#fileInput', [j(SCRATCH, 'Vici renamed 04.csv')], { timeout: 60000 });
await page.waitForTimeout(5000);
const s4 = await snap();
ok('renamed identical Vici export does not double the day', s4.talkH === s2.talkH, `${s2.talkH} -> ${s4.talkH}`);

await page.evaluate(() => window.__mtd.setPeriod('2026-08', 'calendar'));
await page.waitForTimeout(800);
ok('renders clean with August data', errors.length === 0, errors.slice(0, 4).join(' | '));

// ---- a hydrate that emptied S.vici must not leave the registry blocking the repair upload.
// The cancellations twin of this bug is in hot.md; this is the vici-range case: the file's
// hash is registered, the store is empty, and re-uploading the same file used to be skipped
// with "already uploaded" — 0:00:00 Cuddle talk with no way back short of DevTools.
await page.evaluate(() => { const S = window.__mtd.state(); S.vici = {}; });
await page.setInputFiles('#fileInput', [j(UP, 'Vici - Cuddle Agents - 3 - 5 Aug.csv')], { timeout: 60000 });
await page.waitForTimeout(6000);
const s5 = await snap();
ok('re-upload repairs an emptied vici store instead of "already uploaded"',
  s5.vici.length === 1 && s5.vici[0] === '2026-08-03..2026-08-05', JSON.stringify(s5.vici));
ok('and the repaired range carries its agents', s5.viciRows === 24, `got ${s5.viciRows}`);

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
failures.forEach(f => console.log('FAIL: ' + f));
errors.slice(0, 6).forEach(e => console.log('  ' + e));
await browser.close(); server.close();
process.exit(fail || errors.length ? 1 : 0);
