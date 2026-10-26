#!/usr/bin/env node
/**
 * verify-late-counts.mjs — a register LATE (L) is an attended shift from 1 Oct 2026 (Nick, 2026-10-26).
 *
 *   node nicks_code/diagnostics/verify-late-counts.mjs
 *
 * "jolene attendance is 100% on the hub is shows 94" → "late should = … so it should be 100% change the rules".
 * Jolene Chetty (CB19, Cuddle) was marked L on Wed 21 Oct, worked it (4h43 talk, 14 sales) and read 16/17 = 94%:
 * spec §4 weighed L at 0. Cuddle takes its Actual Shifts from the register, so the weight is the whole answer.
 * Runs the REAL PULSE engine headlessly over a synthetic Cuddle agent (fake CB, no cloud).
 */
import fs from 'node:fs'; import path from 'node:path'; import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const PULSE_HTML = path.join(ROOT, 'nicks_code', 'index.html');
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (d ? ' — ' + d : '')); } };
const J = JSON.stringify;

const SPEC = JSON.parse(fs.readFileSync(path.join(ROOT, 'specs', 'mtd_engine_rules.json'), 'utf8'));
const W = SPEC.reference_data.attendance_shift_weights;
ok('the rule book weighs L at 1 from 2026-10-01', W.L === 1 && W._late_counts_from === '2026-10-01', J([W.L, W._late_counts_from]));

const srv = http.createServer((q, r) => { const u = q.url.split('?')[0];
  if (u !== '/' && u !== '/index.html') { r.writeHead(404); r.end(); return; }
  r.writeHead(200, { 'Content-Type': 'text/html' }); fs.createReadStream(PULSE_HTML).pipe(r); });
await new Promise((res) => srv.listen(8316, '127.0.0.1', res));
const { chromium } = await import(pathToFileURL(path.join(HERE, 'node_modules', 'playwright', 'index.mjs')).href);
const b = await chromium.launch();
try {
  const page = await b.newPage();
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  const errs = []; page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
  await page.goto('http://127.0.0.1:8316/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__mtd && window.__mtd.state(), null, { timeout: 30000 });
  const R = await page.evaluate(() => {
    const S = window.__mtd.state(); window.__cloudPush = function () {};
    S.att = {}; S.files = []; S.sales = {}; S.calls = {}; S.callsMeta = {}; S.tracker = {}; S.orgHist = {};
    S.roster = [{ code: 'CB9901', name: 'Test Person 01', sf: 'Test Person 01', tl: 'Leader Alpha', campaign: 'Cuddle', tenure: 'Exp', target: 8, start: '2026-01-01' }];
    /* Oct: P every weekday 19–23 except L on Wed 21 (the Jolene week). Sep: P 14–18 except L on Wed 16. */
    /* the engine builds a day from data, never from the register alone — each day carries dialler activity, like Jolene's */
    const mark = (days, late) => days.forEach((d) => { S.att[d] = { CB9901: d === late ? 'L' : 'P' };
      S.calls[d] = { CB9901: { talk: 16994, calls: 154, ans: 60, opt: 0, saleD: 0, v: 1 } }; S.callsMeta[d] = { n: 600, f: 'vici-test.txt' }; });
    mark(['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23'], '2026-10-21');
    mark(['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18'], '2026-09-16');
    const read = (ym) => { window.__mtd.setPeriod(ym, 'month'); const M = window.__mtd.model();
      const rows = (M.facts || []).filter((f) => f.code === 'CB9901');
      return { emp: rows.reduce((t, f) => t + (f.emp || 0), 0), act: rows.reduce((t, f) => t + (f.act || 0), 0),
        late: (rows.find((f) => f.date === (ym === '2026-10' ? '2026-10-21' : '2026-09-16')) || {}) }; };
    window.__mtd.rebuild();
    return { oct: read('2026-10'), sep: read('2026-09'), wOct: attWeight('L', '2026-10-21'), wSep: attWeight('L', '2026-09-16'), wP: attWeight('P', '2026-09-16') };
  });
  ok('attWeight: L on 21 Oct is 1, L on 16 Sep is 0, P is 1', R.wOct === 1 && R.wSep === 0 && R.wP === 1, J([R.wOct, R.wSep, R.wP]));
  ok('October: the late Wednesday is an attended shift — 5 of 5 (100%)', R.oct.emp === 5 && R.oct.act === 5 && R.oct.late.act === 1, J(R.oct));
  ok('September keeps the rule it was reported on — 4 of 5', R.sep.emp === 5 && R.sep.act === 4 && R.sep.late.act === 0, J(R.sep));
  ok('no page errors', errs.length === 0, errs.join(' | '));
} finally { await b.close(); srv.close(); }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
