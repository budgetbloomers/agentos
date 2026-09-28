/* VERIFY — the three data-correctness fixes from the 28 Sep VAS fact-check.
 *
 *   1. A REGISTER DAY RECORDS WORK. HR files leave ahead of time (CB180's maternity leave), so
 *      days after the real register ends carried one or two leave rows each and read as
 *      "covered": the reach said attendance reached the 25th when it ended on the 18th.
 *   2. A FULL QA EXPORT IS THE WHOLE RECORD FOR ITS SPAN. An evaluation deleted at source lived
 *      on for good (CB369's 0% "Pending TL Action"). A full export retires it; a partial,
 *      windowed or per-campaign export never does, and nothing outside the export's span moves.
 *   3. QA CODE CORRECTION CB233 → CB413. Delano Rajagopal was re-issued CB413; QA files him as
 *      CB-233, so he read no QA at all.
 *
 *   node verify-register-and-qa.mjs          (AGENTOS=<checkout> to run another tree)
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.AGENTOS || path.resolve(HERE, '..', '..');
let pass = 0, fail = 0; const failures = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; failures.push(n + (d ? ' — ' + d : '')); console.log('  FAIL ' + n + (d ? ' — ' + d : '')); } };
const section = (s) => console.log('\n— ' + s + ' —');

const HTML = path.join(ROOT, 'nicks_code', 'index.html');
const SERVE = { '/': HTML, '/index.html': HTML, '/xlsx.full.min.js': path.join(ROOT, 'site', 'xlsx.full.min.js') };
const server = http.createServer((q, s) => { const p = SERVE[q.url.split('?')[0]];
  if (!p || !fs.existsSync(p)) { s.writeHead(404); s.end(); return; }
  s.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' }); fs.createReadStream(p).pipe(s); });
await new Promise((r) => server.listen(8273, '127.0.0.1', r));

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));
await page.goto('http://127.0.0.1:8273/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__mtd && window.__mtd.state(), null, { timeout: 30000 });
const ingest = (name, text, kind) => page.evaluate(([n, t, k]) => window.__mtd.ingest(n, t, k, n), [name, text, kind]);
await page.evaluate(() => { const S = window.__mtd.state();
  ['calls', 'callsMeta', 'sales', 'att', 'evals', 'tracker', 'cancRows', 'vici', 'viciDays', 'orgHist'].forEach((k) => S[k] = {});
  S.files = []; S.roster = []; });

/* a small floor (above any minimum-roster guard) so the register and QA rows have agents to land on */
const NUM = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
const AGENTS = NUM.map((w, i) => ({ code: 'CB' + (900 + i), name: 'Cuddle ' + w }));
AGENTS.push({ code: 'CB413', name: 'Delano Rajagopal' }, { code: 'CB369', name: 'Cuddle Qa' });
await page.evaluate(() => window.__mtd.setRosterAsOf('2026-09-14'));
await ingest('Matrix - Agent List.csv', '### Sheet: VAS ###\nEmployee Code,Agent Name,Team Leader,Campaign,Tenure,Sales Force,Target,Start Date\n'
  + AGENTS.map((a) => [a.code, a.name, 'Leader Cuddle', 'Matrix VAS - Cuddle', 'Exp', a.name, 5, '2026-01-05'].join(',')).join('\n') + '\n', 'roster');

section('1 · a register day records work — forward-dated leave alone is not one');
{
  const rows = ['Employee Code,Date,Status Code'];
  for (const d of ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18'])
    for (const a of AGENTS) rows.push([a.code, d, 'P'].join(','));
  // HR files maternity leave ahead of time: one row a day for the following week, nobody present
  for (const d of ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-25']) rows.push(['CB900', d, 'Maternity Leave'].join(','));
  await ingest('attendance_2026-09-14_to_2026-09-25.csv', rows.join('\n') + '\n', 'attendance');
  const r = await page.evaluate(() => ({ ends: window.__mtd.sourceEnds(), reach: (window.__mtd.digest && window.__mtd.digest() || {}).dataReach || null,
    /* an older build has no attDayCovered: judge it by what it did then — any row covers the day */
    covered: ['2026-09-18', '2026-09-21', '2026-09-25'].map((d) => (typeof attDayCovered === 'function')
      ? attDayCovered(d) : !!Object.keys((window.__mtd.state().att || {})[d] || {}).length) }));
  ok('the register\'s last day is the 18th, not the 25th', r.ends && r.ends.attendance === '2026-09-18', JSON.stringify(r.ends));
  ok('a day with only a forward-dated leave row is not a register day', r.covered[0] === true && r.covered[1] === false && r.covered[2] === false, JSON.stringify(r.covered));
  if (r.reach) ok('…and the digest\'s data reach says the same', r.reach.attendance === '2026-09-18', JSON.stringify(r.reach));
}

section('2 · a FULL QA export retires what it no longer carries — inside its span only');
const HDR = '"Record ID","Submitted At","Status","Date of Call","Week","Date of Assessment","Campaign","QA Agent","Sales Agent","Sales Agent CB","Score %","Escalation Decision"';
const qa = (rid, cb, name, d, score) => ['"' + rid + '"', '"' + d + ' 10:00"', '"Closed"', '"' + d + '"', '"W"', '"' + d + '"', '"Cuddle"', '"QA One"', '"' + name + '"', '"' + cb + '"', '"' + score + '%"', '""'].join(',');
{
  const first = [HDR,
    qa('R-1', 'CB-369', 'Cuddle Qa', '2026-09-08', 0),     // deleted at source later
    qa('R-2', 'CB-369', 'Cuddle Qa', '2026-09-09', 80),
    qa('R-3', 'CB-369', 'Cuddle Qa', '2026-08-20', 50),    // outside the later export's span
    qa('R-4', 'CB-901', 'Cuddle Two', '2026-09-10', 90)].join('\n') + '\n';
  await ingest('evaluations-full-export-2026-09-09.csv', first, 'evals');
  /* a PARTIAL export (not "full-export") that lacks R-2 must retire nothing */
  await ingest('evaluations-cuddle-2026-09-10.csv', [HDR, qa('R-4', 'CB-901', 'Cuddle Two', '2026-09-10', 91)].join('\n') + '\n', 'evals');
  const mid = await page.evaluate(() => { const E = window.__mtd.state().evals; const ids = []; for (const d in E) for (const c in E[d]) for (const e of E[d][c]) ids.push(e.rid); return ids.sort(); });
  ok('a partial export retires nothing', mid.join() === 'R-1,R-2,R-3,R-4', JSON.stringify(mid));
  /* the later FULL export spans 1–25 Sep and no longer carries R-1 */
  const later = [HDR, qa('R-2', 'CB-369', 'Cuddle Qa', '2026-09-09', 80), qa('R-4', 'CB-901', 'Cuddle Two', '2026-09-10', 91),
    qa('R-5', 'CB-902', 'Cuddle Three', '2026-09-01', 70), qa('R-6', 'CB-903', 'Cuddle Four', '2026-09-25', 75)].join('\n') + '\n';
  await ingest('evaluations-full-export-2026-09-25.csv', later, 'evals');
  const after = await page.evaluate(() => { const E = window.__mtd.state().evals; const ids = []; for (const d in E) for (const c in E[d]) for (const e of E[d][c]) ids.push(e.rid); return ids.sort(); });
  ok('the full export retired the evaluation deleted at source (R-1)', !after.includes('R-1'), JSON.stringify(after));
  ok('…kept every evaluation it carries', ['R-2', 'R-4', 'R-5', 'R-6'].every((r) => after.includes(r)), JSON.stringify(after));
  ok('…and never touched a day outside its span (R-3, 20 Aug)', after.includes('R-3'), JSON.stringify(after));
}

section('3 · QA filed under CB-233 lands on CB413 (Delano Rajagopal)');
{
  await ingest('evaluations-full-export-2026-09-26.csv', [HDR, qa('R-9', 'CB-233', 'Delano Rajgopaul', '2026-09-26', 88)].join('\n') + '\n', 'evals');
  const r = await page.evaluate(() => { const E = window.__mtd.state().evals['2026-09-26'] || {}; return { to413: (E.CB413 || []).map((e) => e.rid), to233: (E.CB233 || []).length }; });
  ok('the CB-233 evaluation is filed under CB413', r.to413.includes('R-9') && r.to233 === 0, JSON.stringify(r));
}

ok('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close(); server.close();
console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
if (fail) { failures.forEach((f) => console.log('  · ' + f)); process.exit(1); }
