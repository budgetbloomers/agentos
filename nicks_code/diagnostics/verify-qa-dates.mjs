/* QA FILES ON DATE OF ASSESSMENT — and a re-dated evaluation MOVES, never copies.
 *
 * Owner decision, Nick 2026-08-26 (supersedes the v6.0 Date-of-Call rule; both copies of the
 * rule book — specs/mtd_engine_rules.json and the inline MTD_RULES — changed together):
 * an evaluation is credited to the day the QA team DID the work. Assessments lag calls by
 * 1-4 days, so filing on call date made every fresh upload look like it had not landed
 * ("there is data until the 25th, but it's not showing").
 *
 * The dangerous half of that change is not the date column — it is that every already-stored
 * evaluation sits under its CALL date, and the merge used to be per-day: a re-upload filing
 * the same Record ID under its assessment day would have left the call-day copy behind and
 * counted the evaluation twice. The ingest now sweeps incoming Record IDs out of every other
 * day first, so a re-dated evaluation moves. This proves all of it, then runs the REAL
 * 6,121-row 26 Aug export over the healed live-shaped state and shows the span reach 25 Aug.
 *
 * Run: node nicks_code/diagnostics/verify-qa-dates.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const HTML = path.join(REPO, ...(process.env.PULSE_HTML || 'site/pulse/index.html').split('/'));
let pass = 0; const fails = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ' + n); }
  else { fails.push(n + (d ? ' — ' + d : '')); console.log('  FAIL ' + n + (d ? ' — ' + d : '')); } };

const SERVE = { '/': HTML, '/index.html': HTML, '/xlsx.full.min.js': path.join(REPO, 'site', 'xlsx.full.min.js') };
const server = http.createServer((q, s) => { const p = SERVE[q.url.split('?')[0]];
  if (!p || !fs.existsSync(p)) { s.writeHead(404); s.end('nf'); return; }
  s.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' });
  fs.createReadStream(p).pipe(s); });
await new Promise(r => server.listen(8187, '127.0.0.1', r));

const browser = await chromium.launch({ args: ['--js-flags=--max-old-space-size=8192'] });
const page = await browser.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.goto('http://127.0.0.1:8187/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__mtd && window.__mtd.state(), null, { timeout: 30000 });

/* The real export's own header, so detectType classifies exactly as production does. */
const HDR = '"Record ID","Submitted At","Status","Offense Number","SLA Deadline","QA Close Decision","Date of Call","Week","Date of Assessment","Campaign","QA Agent","Sales Agent","Sales Agent CB","Sales Team Leader","Sales Agent Tenure","Call ID","Call Duration","Score %","Assessment Type","Escalation Decision","Priority","Coaching Category","Coaching Sub-Category","Critical Fail Category","Critical Fail Sub-Category","Evaluation Reference","Client Callback Required","Recommendation","QA Agent Feedback","TL Stage 1 Notes","TL Stage 2 Notes","SM Escalation Reason","GHL Opportunity ID","GHL Stage ID","GHL Stage Name"';
const row = (rid, call, assess, submitted, score, agent = 'CB901') =>
  `"${rid}","${submitted || ''}","Closed — Risk Mitigated","","","","${call || ''}","Week 3","${assess || ''}","Matrix Cuddle","QA One","Test Agent","${agent}","TL One","M2","","","${score}","Standard","Pass","","","","","","","","","","","","","",""`;

const evalMap = () => page.evaluate(() => {
  const S = window.__mtd.state(); const out = {};
  for (const d in S.evals) for (const [c, l] of Object.entries(S.evals[d])) for (const e of l)
    (out[e.rid || 'bare'] = out[e.rid || 'bare'] || []).push(d + '|' + c + '|' + e.s);
  return out;
});
const reset = () => page.evaluate(() => { const S = window.__mtd.state(); S.evals = {}; S.files = S.files.filter(f => f.type !== 'evals'); });
const ingest = (name, csv) => page.evaluate(([n, t]) => window.__mtd.ingest(n, t, null, 'h-' + n), [name, csv]);

console.log('\n— filing day —');
{
  await reset();
  await ingest('qa-a.csv', HDR + '\n' + row('R1', '2026-08-20', '2026-08-24', '2026-08-24 09:00', '90%'));
  let m = await evalMap();
  ok('an evaluation files on its Date of Assessment, not its Date of Call',
    m.R1 && m.R1.length === 1 && m.R1[0].startsWith('2026-08-24|'), JSON.stringify(m.R1));

  await reset();
  await ingest('qa-b.csv', HDR + '\n' + row('R2', '2026-08-20', '', '2026-08-25 10:00', '80%'));
  m = await evalMap();
  ok('a blank assessment date falls back to Submitted At',
    m.R2 && m.R2[0].startsWith('2026-08-25|'), JSON.stringify(m.R2));

  await reset();
  await ingest('qa-c.csv', HDR + '\n' + row('R3', '2026-08-20', '', '', '70%'));
  m = await evalMap();
  ok('and an old-format row still loads, on Date of Call as the last resort',
    m.R3 && m.R3[0].startsWith('2026-08-20|'), JSON.stringify(m.R3));
}

console.log('\n— a re-dated evaluation MOVES, never copies —');
{
  await reset();
  /* the legacy world: the same evaluation already stored under its CALL date */
  await page.evaluate(() => { const S = window.__mtd.state();
    S.evals['2026-08-20'] = { CB901: [{ s: 90, rid: 'R4', f: 'old.csv', dec: 'Pass', cat: '', pri: '', camp: 'Matrix Cuddle', dsp: 0, dspSt: '', st: '' }] }; });
  await ingest('qa-d.csv', HDR + '\n' + row('R4', '2026-08-20', '2026-08-24', '2026-08-24 09:00', '92%'));
  const m = await evalMap();
  ok('one copy survives, on the new day, with the newer score',
    m.R4 && m.R4.length === 1 && m.R4[0] === '2026-08-24|CB901|92',
    JSON.stringify(m.R4) + ' — a copy left on the call-date day would double-count the evaluation');
}

console.log('\n— duplicates inside one file count once —');
{
  await reset();
  await ingest('qa-e.csv', HDR + '\n' + row('R5', '2026-08-20', '2026-08-24', '', '88%') + '\n' + row('R5', '2026-08-20', '2026-08-24', '', '88%'));
  const m = await evalMap();
  ok('a repeated Record ID in the file is stored once', m.R5 && m.R5.length === 1, JSON.stringify(m.R5));
}

console.log('\n— the hash-skip knows the filing rule changed —');
{
  await reset();
  const csv = HDR + '\n' + row('R6', '2026-08-20', '2026-08-24', '2026-08-24 09:00', '85%');
  const drop = () => page.setInputFiles('#fileInput', [{ name: 'qa-f.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) }]);
  await drop(); await page.waitForTimeout(2500);
  const st = await page.evaluate(() => { const S = window.__mtd.state();
    const f = S.files.find(x => x.type === 'evals'); return { n: S.files.filter(x => x.type === 'evals').length, basis: f && f.basis }; });
  ok('an uploaded QA file records the basis it was filed under', st.basis === 'Date of Assessment', JSON.stringify(st));

  await drop(); await page.waitForTimeout(2500);
  const st2 = await page.evaluate(() => { const S = window.__mtd.state();
    let t = 0; for (const d in S.evals) for (const l of Object.values(S.evals[d])) t += l.length;
    return { entries: S.files.filter(x => x.type === 'evals').length, rows: t }; });
  ok('the identical file uploaded again is skipped (nothing changed)', st2.entries === 1 && st2.rows === 1, JSON.stringify(st2));

  /* the world as it stands on every device today: same bytes stored, but filed by the
     RETIRED call-date rule — the entry carries no basis and the row sits on the call day */
  await page.evaluate(() => { const S = window.__mtd.state();
    const f = S.files.find(x => x.type === 'evals'); delete f.basis;
    const e = S.evals['2026-08-24'].CB901[0]; delete S.evals['2026-08-24'];
    S.evals['2026-08-20'] = { CB901: [e] }; });
  await drop(); await page.waitForTimeout(2500);
  const st3 = await page.evaluate(() => { const S = window.__mtd.state();
    const f = S.files.find(x => x.type === 'evals');
    const days = Object.keys(S.evals); let t = 0; for (const d of days) for (const l of Object.values(S.evals[d])) t += l.length;
    return { days, rows: t, basis: f && f.basis }; });
  ok('the SAME file after a basis change is NOT skipped — it re-files the evaluation',
    st3.days.length === 1 && st3.days[0] === '2026-08-24' && st3.rows === 1 && st3.basis === 'Date of Assessment',
    JSON.stringify(st3) + ' — this is the re-upload the user was told to do; the old hash check swallowed it');
}

console.log('\n— the real 26 Aug export over the healed live state —');
{
  const SP = 'C:/Users/aarav/AppData/Local/Temp/claude/c--Users-aarav-OneDrive-Desktop-Chatterbox-Agent-OS/2fe66b0a-bbad-40a8-abdf-0a8591c1915d/scratchpad';
  const stateP = path.join(SP, 'vas-state-healed.json');
  const fileP = 'C:/Users/aarav/Downloads/evaluations-full-export-2026-08-26 (1).csv';
  if (!fs.existsSync(stateP) || !fs.existsSync(fileP)) {
    console.log('  (skipped — healed state or the real export not on this machine; the synthetic checks above still hold)');
  } else {
    await page.evaluate(x => { const S = window.__mtd.state(); const o = JSON.parse(x);
      for (const k of Object.keys(o)) S[k] = o[k]; window.__mtd.rebuild(); }, fs.readFileSync(stateP, 'utf8'));
    const before = await page.evaluate(() => { let t = 0, mx = ''; const S = window.__mtd.state();
      for (const d in S.evals) { if (d > mx) mx = d; for (const l of Object.values(S.evals[d])) t += l.length; } return { t, mx }; });
    await ingest('evaluations-full-export-2026-08-26 (1).csv', fs.readFileSync(fileP, 'utf8'));
    const after = await page.evaluate(() => { let t = 0, mx = ''; const seen = new Set(); let dup = 0; const S = window.__mtd.state();
      for (const d in S.evals) { if (d > mx) mx = d; for (const l of Object.values(S.evals[d])) for (const e of l) { t++; if (e.rid) { if (seen.has(e.rid)) dup++; seen.add(e.rid); } } }
      return { t, mx, dup }; });
    console.log(`  before: ${before.t} evaluations, span ends ${before.mx} · after: ${after.t}, span ends ${after.mx}`);
    ok('the span now reaches the 25th — what the upload station shows moves with the QA team\'s work',
      after.mx >= '2026-08-25', 'span still ends ' + after.mx);
    ok('re-dating the whole history duplicated nothing (no Record ID twice)', after.dup === 0, after.dup + ' duplicated');
    ok('the store did not balloon — evaluations moved days, they were not re-added',
      Math.abs(after.t - before.t) <= 60, `${before.t} -> ${after.t}`);
  }
}

ok('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close(); server.close();
console.log(`\n==== ${pass} passed, ${fails.length} failed ====`);
if (fails.length) { console.log(fails.map(f => '  · ' + f).join('\n')); process.exit(1); }
