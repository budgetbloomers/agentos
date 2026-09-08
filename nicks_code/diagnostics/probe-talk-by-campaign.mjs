// Why is talk time zero? Load the 2026-08-13 package into the BUILD copy and report
// talk seconds per roster campaign, plus whether the dialler-coverage warning shows.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

const REPO = process.env.AGENTOS || decodeURIComponent(new URL('../..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1').replace(/\/$/, '');   // repo-relative (2026-09-08): the laptop path failed every cloud run
const UP = path.join(REPO, 'uploads', '2026-08-13');
const HTML = path.join(REPO, ...(process.env.PULSE_HTML || 'site/pulse/index.html').split('/'));
const SERVE = { '/': HTML, '/index.html': HTML, '/xlsx.full.min.js': path.join(REPO, 'site', 'xlsx.full.min.js') };
const server = http.createServer((req, res) => {
  const p = SERVE[req.url.split('?')[0]];
  if (!p || !fs.existsSync(p)) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' });
  fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(8131, '127.0.0.1', r));
const j = (...p) => path.join(...p);
const FILES = ['Matrix - Agent List.xlsx', 'attendance_2026-08-06_to_2026-08-13.csv', 'Active.xlsx', 'Inactive.xlsx',
  'call_records.csv', 'Call Report 01 to 13 Aug.xlsx', 'evaluations-full-export-2026-08-13.csv'].map(f => j(UP, f));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.goto('http://127.0.0.1:8131/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__mtd && window.__mtd.state(), null, { timeout: 30000 });
await page.setInputFiles('#fileInput', FILES, { timeout: 120000 });
await page.waitForFunction(() => (window.__mtd.state().files || []).length >= 6, null, { timeout: 600000 });
await page.waitForTimeout(5000);
await page.evaluate(() => window.__mtd.setPeriod('2026-08', 'calendar'));
await page.waitForTimeout(1000);

const out = await page.evaluate(() => {
  const S = window.__mtd.state();
  // resolve each S.calls bucket user to a roster campaign
  const roster = S.roster || [];
  const byKey = {};
  roster.forEach(a => {
    if (a.code) byKey[String(a.code).toUpperCase().replace(/[^A-Z0-9]/g, '')] = a;
    if (a.name) byKey[a.name.toLowerCase().trim()] = a;
    if (a.callx) byKey[String(a.callx).toLowerCase().trim()] = a;
  });
  const campTalk = {}, campCalls = {}, unresolved = {};
  for (const d in S.calls) for (const u in S.calls[d]) {
    const b = S.calls[d][u];
    const key = String(u).toUpperCase().replace(/[^A-Z0-9]/g, '');
    const a = byKey[key] || byKey[String(u).toLowerCase().trim()];
    const camp = a ? (a.team || a.campaign || a.camp || '?') : 'UNRESOLVED:' + u;
    if (a) { campTalk[camp] = (campTalk[camp] || 0) + (b.talk || 0); campCalls[camp] = (campCalls[camp] || 0) + (b.calls || 0); }
    else { unresolved[u] = (unresolved[u] || 0) + (b.talk || 0); }
  }
  const rosterSample = roster.slice(0, 2);
  return { campTalk, campCalls, unresolvedN: Object.keys(unresolved).length, unresolvedTalkH: +(Object.values(unresolved).reduce((s, v) => s + v, 0) / 3600).toFixed(1), rosterSample, files: (S.files || []).map(f => f.type) };
});
console.log(JSON.stringify(out, null, 1));

// MTD page: does the dialler-coverage warning render, and what does Cuddle read?
await page.evaluate(() => window.go && go('mtd'));
await page.waitForTimeout(1200);
const mtdTxt = await page.evaluate(() => document.getElementById('view')?.innerText?.slice(0, 3000) || '');
console.log('--- MTD page head ---');
console.log(mtdTxt.slice(0, 1500).replace(/\n{2,}/g, '\n'));
console.log('has dialler/coverage warning:', /dialler|coverage|no .*record/i.test(mtdTxt));
console.log('pageerrors:', errors.slice(0, 3));
await browser.close(); server.close();
