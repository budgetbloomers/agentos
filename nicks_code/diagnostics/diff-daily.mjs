// Day-level diff: the workbook's "August" sheet is one row per agent per dialling day —
// the finest grain either system has. Compare the app's facts against it row by row.
import { chromium } from 'playwright';
import fs from 'node:fs'; import path from 'node:path'; import http from 'node:http';
import { createRequire } from 'node:module';
const XLSX = createRequire(import.meta.url)('xlsx');
const REPO = process.env.AGENTOS || decodeURIComponent(new URL('../..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1').replace(/\/$/, '');   // repo-relative (2026-09-08): the laptop path failed every cloud run
const UP = path.join(REPO, 'uploads', '2026-08-06');
const SERVE = { '/': path.join(REPO, 'nicks_code', 'index.html'), '/index.html': path.join(REPO, 'nicks_code', 'index.html'),
  '/xlsx.full.min.js': path.join(REPO, 'site', 'xlsx.full.min.js') };
const server = http.createServer((q, s) => { const p = SERVE[q.url.split('?')[0]];
  if (!p || !fs.existsSync(p)) { s.writeHead(404); s.end('nf'); return }
  s.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' }); fs.createReadStream(p).pipe(s) });
await new Promise(r => server.listen(8139, '127.0.0.1', r));
const j = (...p) => path.join(...p);

// ---- workbook daily rows
const T = XLSX.read(fs.readFileSync(j(UP, 'VAS - August 2026 MTD Tracker 1 - 4 Aug.xlsx')), { type: 'buffer', cellDates: true });
const secs = v => { const m = /^(\d+):(\d+):(\d+)/.exec(String(v ?? '')); return m ? +m[1]*3600 + +m[2]*60 + +m[3] : 0; };
const wbRows = new Map();
// The daily sheet's money headers are padded — " GWP Achieved " — and Talk Time is a real
// Excel time cell, so read formatted (raw:false) and trim every key. Reading it raw silently
// produced 0 for both and made the app look wrong on 90 rows it actually matches.
for (const raw of XLSX.utils.sheet_to_json(T.Sheets['August'], { raw: false, defval: '' })) {
  const r = {}; for (const k in raw) r[k.trim()] = raw[k];
  const d = String(r['Date'] || '');
  if (!/^\d{2}\.\d{2}\.\d{4}$/.test(d)) continue;
  const iso = d.slice(6) + '-' + d.slice(3, 5) + '-' + d.slice(0, 2);
  const code = String(r['Emp Code'] || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  // raw:false gives FORMATTED cells, so the money columns arrive as 'R 445.00' — strip to a
  // number rather than letting +'R 445.00' become NaN and read as a zero the app must match.
  const n = v => { const x = parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, '')); return Number.isFinite(x) ? x : 0; };
  wbRows.set(iso + '|' + code, { date: iso, code, agent: String(r['Agent'] || ''), camp: String(r['Campaign'] || ''),
    emp: n(r['Employed Shifts']), act: n(r['Actual Shifts']), target: n(r['Sales Target']),
    sales: n(r['Sales Achieved']), talk: secs(r['Talk Time']), gwpT: n(r['GWP Target']),
    gwp: n(r['GWP Achieved']), ref: n(r['Referrals']) });
}

const browser = await chromium.launch({ args: ['--js-flags=--max-old-space-size=8192'] });
const page = await browser.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.goto('http://127.0.0.1:8139/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__mtd && window.__mtd.state(), null, { timeout: 30000 });
await page.setInputFiles('#fileInput', ['Matrix - Agent List.xlsx', 'attendance_2026-08-01_to_2026-08-06.csv',
  'BI Active - 05.08.xlsx', 'BI Inactive - 05.08.xlsx', 'Call X Call report - 3 - 5.xlsx',
  'Vici - Cuddle Agents - 3 - 5 Aug.csv', 'evaluations-full-export-2026-08-06.csv'].map(f => j(UP, f)), { timeout: 60000 });
await page.waitForFunction(() => (window.__mtd.state().files || []).length >= 6, null, { timeout: 600000 });
await page.waitForTimeout(5000);
const appRows = await page.evaluate(() => {
  const S = window.__mtd.state();
  S.ui.preset = 'custom'; S.ui.from = '2026-08-03'; S.ui.to = '2026-08-04'; rebuild(); renderAll();
  return window.__mtd.model().facts.filter(f => !f.rangeAgg).map(f => ({ date: f.date, code: f.code, agent: f.agent,
    camp: f.campaign, emp: f.emp, act: f.act, target: f.target, sales: f.sales, talk: f.talk, gwpT: f.gwpT,
    gwp: f.gwp, ref: f.ref }));
});
const app = new Map(appRows.map(r => [r.date + '|' + r.code, r]));

const dur = s => { s = Math.round(s); return `${Math.floor(s/3600)}:${String(Math.floor(s/60)%60).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`; };
const COLS = [['emp','Employed Shifts'],['act','Actual Shifts'],['target','Sales Target'],['sales','Sales Achieved'],
  ['gwpT','GWP Target'],['gwp','GWP Achieved'],['talk','Talk Time'],['ref','Referrals']];
const tally = {}; const detail = {};
for (const [k, w] of wbRows) {
  const a = app.get(k);
  if (!a) { (detail.__missing = detail.__missing || []).push(`${w.date} ${w.agent} (${w.code}) [${w.camp}]`); continue; }
  for (const [f, lab] of COLS) {
    const tol = f === 'talk' ? 60 : 0.005;
    tally[lab] = tally[lab] || { n: 0, bad: 0 };
    tally[lab].n++;
    if (Math.abs(w[f] - a[f]) > tol) { tally[lab].bad++;
      (detail[lab] = detail[lab] || []).push(`${w.date} ${w.agent.padEnd(28)} wb=${f==='talk'?dur(w[f]):w[f]}  app=${f==='talk'?dur(a[f]):a[f]}`); }
  }
}
const extra = [...app.keys()].filter(k => !wbRows.has(k)).map(k => app.get(k)).filter(r => r.emp||r.act||r.sales||r.talk);
console.log(`workbook daily rows: ${wbRows.size}   app fact rows in window: ${app.size}\n`);
for (const [, lab] of COLS) { const t = tally[lab] || { n: 0, bad: 0 };
  console.log(`${lab.padEnd(18)} ${String(t.bad).padStart(3)} / ${t.n} differ`);
  (detail[lab] || []).slice(0, 12).forEach(l => console.log('     ' + l));
  if ((detail[lab] || []).length > 12) console.log(`     … +${detail[lab].length - 12} more`); }
console.log('\nIn the workbook, absent from the app:');
(detail.__missing || ['  (none)']).forEach(l => console.log('  ' + l));
console.log('\nIn the app, absent from the workbook (with activity):');
extra.slice(0, 30).forEach(r => console.log(`  ${r.date} ${r.agent.padEnd(28)} [${r.camp}] emp=${r.emp} act=${r.act} sales=${r.sales} talk=${dur(r.talk)}`));
if (!extra.length) console.log('  (none)');
console.log('\npage errors:', errors.slice(0, 3).join(' | ') || 'none');
await browser.close(); server.close();