// End-to-end verification of Pulse (VAS) intake with today's real exports.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

// Serve over HTTP — Pulse loads /xlsx.full.min.js from the site root (present in
// production; unreachable at file://), so a tiny local server mirrors the real layout.
import http from 'node:http';
const REPO = String.raw`c:\Users\aarav\OneDrive\Desktop\Chatterbox Agent OS\agentos`;
const SERVE = {
  '/': path.join(REPO, 'nicks_code', 'index.html'),
  '/index.html': path.join(REPO, 'nicks_code', 'index.html'),
  '/xlsx.full.min.js': path.join(REPO, 'site', 'xlsx.full.min.js'),
};
const server = http.createServer((req, res) => {
  const p = SERVE[req.url.split('?')[0]];
  if (!p || !fs.existsSync(p)) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' });
  fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(8123, '127.0.0.1', r));
const APP = 'http://127.0.0.1:8123/index.html';
const UP = String.raw`c:\Users\aarav\OneDrive\Desktop\Chatterbox Agent OS\agentos\uploads\2026-08-02`;
const SCRATCH = process.cwd();
const E = JSON.parse(fs.readFileSync('pulse-expected.json', 'utf8'));
const j = (...p) => path.join(...p);

const FILES = [
  j(UP, 'Agent List', 'Matrix - Agent List.xlsx'),
  j(UP, 'Attendance', 'attendance_2026-04-01_to_2027-04-30.csv'),
  j(UP, 'Attendance', 'attendance_2026-05-01_to_2027-05-30.csv'),
  j(UP, 'Attendance', 'attendance_2026-06-01_to_2027-06-30.csv'),
  j(UP, 'Attendance', 'attendance_2026-07-01_to_2027-07-24.csv'),
  j(UP, 'Active', 'BI Active April 2026 - 26.03 - 25.04.xlsx'),
  j(UP, 'Active', 'BI Active May 2026 - 26.04 - 25.05.xlsx'),
  j(UP, 'Active', 'BI Active June 2026 - 26.05 - 25.06.xlsx'),
  j(UP, 'Active', 'BI Active - 26.06 - 23.07.xlsx'),
  j(UP, 'Open Cases', 'SF Open Cases - Current.xls'),
  j(UP, 'Closed Cases', 'SF Closed - 01.07.2026 - 16.07.2026.xls'),
  j(UP, 'Inactive', 'BI Inactive April 2026 - 26.03 - 25.04.xlsx'),
  j(UP, 'Inactive', 'BI Inactive May 2026 - 26.04 - 25.05.xlsx'),
  j(UP, 'Inactive', 'BI Inactive - 26.06 - 23.07.xlsx'),
  j(UP, '_SKIP - superseded', 'BI Inactive July 2026 - 26.06 - 13.07.xlsx'),
  j(UP, 'Dialler', 'call_records (3).xlsx'),
  j(UP, 'Dialler', 'call_records (5).xlsx'),
  j(UP, 'Dialler', 'call_records (6).xlsx'),
  j(UP, 'Dialler', 'call_records (7).xlsx'),
  j(UP, 'Dialler', 'call_records 01-06-26 - 19-07-26.xlsx'),
  j(UP, 'QA', 'evaluations-full-export-2026-08-02.csv'),
];

// Round-3 fixture: a PARTIAL re-export of 2026-04-01 (half that day's rows) — the stored
// fuller day must win and totals must not move.
{
  const wb = XLSX.read(fs.readFileSync(j(UP, 'Dialler', 'call_records (3).xlsx')), {type:'buffer'});
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {raw:false, defval:''});
  const day = rows.filter(r => String(r['Date & Time']||'').startsWith('2026-04-01') || String(r['Date & Time']||'').startsWith('01/04/2026'));
  const subset = day.slice(0, Math.floor(day.length/2));
  const wb2 = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb2, XLSX.utils.json_to_sheet(subset.length?subset:rows.slice(0,50)), 'Sheet1');
  XLSX.writeFile(wb2, j(SCRATCH, 'call_records partial 01-04.xlsx'));
  console.log('partial fixture rows:', (subset.length?subset:rows.slice(0,50)).length, 'of day', day.length);
}

let pass = 0, fail = 0; const failures = [];
const ok = (name, cond, detail = '') => { if (cond) pass++; else { fail++; failures.push(name + (detail ? ' — ' + detail : '')); } };

const browser = await chromium.launch({ args: ['--js-flags=--max-old-space-size=8192'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
await page.goto(APP, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__mtd && window.__mtd.state(), null, { timeout: 30000 });

const snap = () => page.evaluate(() => {
  const S = window.__mtd.state();
  const sum = (obj, f) => { let t = 0; for (const d in obj) for (const k in obj[d]) t += f(obj[d][k]); return t; };
  const campCount = {}; (S.roster||[]).forEach(a => campCount[a.campaign] = (campCount[a.campaign]||0)+1);
  let evalN = 0; for (const d in S.evals) for (const c in S.evals[d]) evalN += S.evals[d][c].length;
  return {
    files: (S.files||[]).map(f => f.type + ' | ' + f.name),
    roster: (S.roster||[]).length, campCount,
    open: S.opencases ? { name: S.opencases.name, total: S.opencases.total } : null,
    salesDays: Object.keys(S.sales||{}).length,
    gwp: Math.round(sum(S.sales, o => o.gwp) * 100) / 100,
    salesN: sum(S.sales, o => o.n),
    callDays: Object.keys(S.calls||{}).length,
    calls: sum(S.calls, b => b.calls),
    attDays: Object.keys(S.att||{}).length,
    evalDays: Object.keys(S.evals||{}).length, evalN,
  };
});

console.log('Round 1: dropping all ' + FILES.length + ' files into Pulse…');
await page.setInputFiles('#fileInput', FILES, { timeout: 60000 });
await page.waitForFunction(() => (window.__mtd.state().files||[]).length >= 20, null, { timeout: 900000 });
await page.waitForTimeout(3000); // settle: last renders/saves
const s1 = await snap();
console.log(JSON.stringify(s1, null, 1));

ok('roster 95', s1.roster === 95, `got ${s1.roster}`);
ok('campaigns Courtesy 50 / Cuddle 27 / VT 18', s1.campCount.Courtesy === 50 && s1.campCount.Cuddle === 27 && s1.campCount.VT === 18, JSON.stringify(s1.campCount));
ok('an Open Cases export is recognised and NOT stored as VAS data', s1.open === null && !s1.files.some(f=>/open/i.test(f)), JSON.stringify(s1.open)+' | '+s1.files.filter(f=>/open/i.test(f)).join(';'));
ok('GWP = independent recompute', Math.abs(s1.gwp - E.gwpIncl) < 1, `got ${s1.gwp} want ${E.gwpIncl}`);
ok('sales days = ' + E.biDays, s1.salesDays === E.biDays, `got ${s1.salesDays}`);
ok('calls = agent-attributed rows ' + E.callsWithAgent, s1.calls === E.callsWithAgent, `got ${s1.calls}`);
ok('call days = ' + E.callDays, s1.callDays === E.callDays, `got ${s1.callDays}`);
ok('evals loaded (3900-3968)', s1.evalN >= 3900 && s1.evalN <= 3968, `got ${s1.evalN}`);
ok('attendance days > 80', s1.attDays > 80, `got ${s1.attDays}`);
ok('Inactive files load as cancellations, never as money', s1.files.filter(f=>/Inactive/i.test(f)).every(f=>/^cancellations/.test(f)), s1.files.filter(f=>/Inactive/i.test(f)).join('; '));
ok('no Closed file in registry', !s1.files.some(f => /SF Closed/i.test(f)), s1.files.filter(f=>/Closed/i.test(f)).join('; '));
ok('registry = 20 entries (Open Cases is no longer a VAS source)', s1.files.length === 20, `got ${s1.files.length}: ${s1.files.join(' || ')}`);

console.log('Round 2: dropping the same 21 files again (hash-skip)…');
await page.setInputFiles('#fileInput', FILES, { timeout: 60000 });
await page.waitForTimeout(8000);
const s2 = await snap();
ok('round2 identical state', JSON.stringify(s2) === JSON.stringify(s1), 'state changed on re-drop');

console.log('Round 3: partial re-export of 2026-04-01 (fullest-day-wins)…');
await page.setInputFiles('#fileInput', [j(SCRATCH, 'call_records partial 01-04.xlsx')], { timeout: 60000 });
await page.waitForTimeout(6000);
const s3 = await snap();
ok('round3 calls unchanged (fuller day kept)', s3.calls === s1.calls, `was ${s1.calls}, now ${s3.calls}`);
ok('round3 GWP unchanged', s3.gwp === s1.gwp, `now ${s3.gwp}`);

// page renders clean with full data
await page.evaluate(() => { window.__mtd.setPeriod('2026-07', 'month'); });
await page.waitForTimeout(500);
ok('render sweep zero errors', errors.length === 0, errors.slice(0,5).join(' | '));

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
failures.forEach(f => console.log('FAIL: ' + f));
if (errors.length) errors.slice(0,10).forEach(e => console.log('  ' + e));
await browser.close();
server.close();
process.exit(fail || errors.length ? 1 : 0);
