/* THE PLACEHOLDER-TL BACKDATE RULE — a first REAL assignment replaces an all-"TBC"
 * history; a real→real change still opens a dated segment.
 *
 * Why this exists (Nick, 2026-08-26): four agents joined under TL "TBC" on the 13 Aug
 * list and were assigned Courtesy/Denise on the 19 Aug list. The forward-only history
 * rule filed their first week under Nesting/"TBC" — a campaign section attributed to
 * nobody — and they showed in the MTD Nesting tab after they had "moved". "TBC" is the
 * absence of an assignment, so the first real one must apply to the whole history.
 * Genuine leader→leader moves must still split at the list date (non-negotiable 11).
 *
 * Drives the real app over two synthetic Agent Lists:
 *   list 1 (as of 01 Aug): CB901 Nesting/"TBC" M0 · CB902 Courtesy/Alpha · CB903 Courtesy/Alpha
 *   list 2 (as of 15 Aug): CB901 Courtesy/Denise M1 · CB902 Courtesy/Beta  · CB903 unchanged
 * and asserts through window.__mtd:
 *   1. CB901's history carries NO placeholder segment; 05 Aug already reads Courtesy/Denise
 *   2. CB902 splits: 05 Aug reads Alpha, 20 Aug reads Beta (the rule never touches real moves)
 *   3. CB903 stays a single segment (idempotence)
 *
 *   node nicks_code/diagnostics/verify-tbc-backdate.mjs          (from the repo root)
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';

const require_ = createRequire(import.meta.url);
const REPO = process.env.AGENTOS || decodeURIComponent(new URL('../..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1').replace(/\/$/, '');   // repo-relative (2026-09-08): the laptop path failed every cloud run
const HTML = path.join(REPO, ...(process.env.PULSE_HTML || 'nicks_code/index.html').split('/'));
const XLSX = require_(path.join(REPO, 'site', 'xlsx.full.min.js'));

let pass = 0, fail = 0; const failures = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; failures.push(n); console.log('  FAIL ' + n + (d ? ' — ' + d : '')); } };

/* ---------- serve and drive the real dashboard ---------- */
const SERVE = { '/': HTML, '/index.html': HTML, '/xlsx.full.min.js': path.join(REPO, 'site', 'xlsx.full.min.js') };
const server = http.createServer((q, s) => {
  const p = SERVE[q.url.split('?')[0]];
  if (!p || !fs.existsSync(p)) { s.writeHead(404); s.end('nf'); return; }
  s.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' });
  fs.createReadStream(p).pipe(s);
});
await new Promise(r => server.listen(8141, '127.0.0.1', r));
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto('http://127.0.0.1:8141/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__mtd && window.__mtd.state(), null, { timeout: 30000 });
await page.evaluate(() => {
  try { localStorage.clear(); } catch (e) {}
  const S = window.__mtd.state();
  ['calls', 'callsMeta', 'sales', 'att', 'evals', 'tracker', 'cancRows', 'vici', 'viciDays', 'orgHist'].forEach(k => S[k] = {});
  S.files = []; S.roster = []; S.ui.asAt = '';
});

const HEAD = ['Employee Code', 'Agent Name', 'Team Leader', 'Campaign', 'Tenure', 'Call x', 'Sales Force', 'Target', 'Start Date'];
const mkList = (name, rows) => {
  const nb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(nb, XLSX.utils.aoa_to_sheet([HEAD, ...rows]), 'VAS');
  const tmp = path.join(process.cwd(), 'simfix'); fs.mkdirSync(tmp, { recursive: true });
  const f = path.join(tmp, name);
  fs.writeFileSync(f, Buffer.from(XLSX.write(nb, { type: 'array', bookType: 'xlsx' })));
  return f;
};
async function upload(file) {
  await page.setInputFiles('#fileInput', [file], { timeout: 120000 });
  let last = -1, stable = 0;
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(400);
    const n = await page.evaluate(() => window.__mtd.state().files.length);
    if (n === last) { if (++stable >= 4) break; } else { stable = 0; last = n; }
  }
}

const f1 = mkList('Matrix - Agent List 2026-08-01.xlsx', [
  ['CB901', 'Test Nester', 'TBC', 'Nesting', 'M0', 'Test Nester CB-901', 'Test Nester', 5, '2026-08-01'],
  ['CB902', 'Test Mover', 'Alpha Leader', 'Courtesy', 'M1', 'Test Mover CB-902', 'Test Mover', 5, '2026-07-01'],
  ['CB903', 'Test Stayer', 'Alpha Leader', 'Courtesy', 'M1', 'Test Stayer CB-903', 'Test Stayer', 5, '2026-07-01'],
  ['CB904', 'Test Waiter', 'TBC', 'Nesting', 'M0', 'Test Waiter CB-904', 'Test Waiter', 5, '2026-08-01'],
]);
const f2 = mkList('Matrix - Agent List 2026-08-15.xlsx', [
  ['CB901', 'Test Nester', 'Denise Test', 'Courtesy', 'M1', 'Test Nester CB-901', 'Test Nester', 5, '2026-08-01'],
  ['CB902', 'Test Mover', 'Beta Leader', 'Courtesy', 'M1', 'Test Mover CB-902', 'Test Mover', 5, '2026-07-01'],
  ['CB903', 'Test Stayer', 'Alpha Leader', 'Courtesy', 'M1', 'Test Stayer CB-903', 'Test Stayer', 5, '2026-07-01'],
  ['CB904', 'Test Waiter', 'TBC', 'Courtesy', 'M0', 'Test Waiter CB-904', 'Test Waiter', 5, '2026-08-01'],
]);
/* the same DAY's list re-uploaded with the placeholder finally filled in — the
   in-place-correction path must back-date exactly like the new-date path */
const f3 = mkList('Matrix - Agent List 2026-08-15 v2.xlsx', [
  ['CB904', 'Test Waiter', 'Gamma Leader', 'Courtesy', 'M0', 'Test Waiter CB-904', 'Test Waiter', 5, '2026-08-01'],
]);
/* the rule cuts BOTH ways: a later list parking a real-led agent under "TBC" must
   never erase the real leader from history (review, 2026-08-26) */
const f4 = mkList('Matrix - Agent List 2026-08-20.xlsx', [
  ['CB902', 'Test Mover', 'TBC', 'Courtesy', 'M1', 'Test Mover CB-902', 'Test Mover', 5, '2026-07-01'],
]);
await upload(f1);
await upload(f2);
await upload(f3);
await upload(f4);

const r = await page.evaluate(() => {
  const S = window.__mtd.state();
  const at = (c, d) => { const l = S.orgHist[c] || []; let cur = l[0] || null; for (const s of l) { if (s.d <= d) cur = s; else break; } return cur; };
  return {
    h901: S.orgHist['CB901'] || [], h902: S.orgHist['CB902'] || [], h903: S.orgHist['CB903'] || [],
    h904: S.orgHist['CB904'] || [],
    early901: at('CB901', '2026-08-05'), early902: at('CB902', '2026-08-05'), late902: at('CB902', '2026-08-22'),
    early904: at('CB904', '2026-08-05'),
  };
});

console.log('CB901 history: ' + JSON.stringify(r.h901));
ok('no placeholder segment survives a first real assignment',
  r.h901.length > 0 && r.h901.every(s => !/^tbc$/i.test(String(s.tl || '').trim())), JSON.stringify(r.h901));
ok('the first real assignment is BACK-DATED — early days read the real TL',
  r.early901 && r.early901.tl === 'Denise Test', JSON.stringify(r.early901));
ok('...and the real campaign', r.early901 && r.early901.campaign === 'Courtesy', JSON.stringify(r.early901));
/* THE LIST WINS ITS WHOLE MONTH (Nick, 2026-08-27, recordOrgList): a real→real move from
   the Agent List no longer splits inside the month — the new leader owns every day of it.
   Cross-month attribution is verify-history's job; here the move and the activity share
   one month, so both early and late days must read the NEW leader. */
ok('a same-month real→real move gives the WHOLE month to the new leader — early days too',
  r.early902 && r.early902.tl === 'Beta Leader', JSON.stringify(r.early902));
ok('...and later days carry the new one', r.late902 && r.late902.tl === 'Beta Leader', JSON.stringify(r.late902));
ok('a LATER "TBC" list never erases a real leader from history',
  (r.h902 || []).every(s => !/^tbc$/i.test(String(s.tl || '').trim())), JSON.stringify(r.h902));
ok('an unchanged agent stays one segment', r.h903.length === 1, JSON.stringify(r.h903));
ok('a SAME-DAY list correction also back-dates a placeholder history',
  r.h904.length > 0 && r.h904.every(s => s.tl === 'Gamma Leader') && r.early904 && r.early904.tl === 'Gamma Leader',
  JSON.stringify(r.h904));
ok('no page errors', !errors.length, errors.slice(0, 3).join(' | '));

fs.rmSync(f1, { force: true }); fs.rmSync(f2, { force: true });
await browser.close(); server.close();
console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
process.exit(fail ? 1 : 0);
