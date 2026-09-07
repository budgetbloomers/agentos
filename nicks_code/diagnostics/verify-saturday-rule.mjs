#!/usr/bin/env node
/**
 * verify-saturday-rule.mjs — Saturday is data, not a shift; and the header filters reach
 * Month to date, Weekly and Daily.
 *
 *   node nicks_code/diagnostics/verify-saturday-rule.mjs
 *
 * Nick, 2026-09-07: "for the month to date add the data but do not add to the numerator for
 * Saturday only" — Attendance's numerator and SPD's denominator are both Actual Shifts, so a
 * Saturday keeps its sales, GWP and talk in every total and contributes no shift and no
 * dialling day (rule saturdayShiftsFrom, effective 2026-09-01 so August is untouched).
 * Same day: "the filters is not working on the month to date … it must be fixed for weekly
 * and daily" — the header Campaign and Team filters used to be ignored by pages that carry
 * their own campaign chips.
 *
 * Runs the REAL engine (nicks_code/index.html) headlessly over a synthetic floor: two
 * leaders, Courtesy and Cuddle, a Friday and a Saturday in September with a register for
 * both and sales on the Saturday, plus an August Saturday to prove the effective date.
 */
import fs from 'node:fs'; import path from 'node:path'; import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const { chromium } = await import(pathToFileURL(path.join(HERE, 'node_modules', 'playwright', 'index.mjs')).href);
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (d ? ' — ' + d : '')); } };

const HTML = path.join(ROOT, 'nicks_code', 'index.html');
const SERVE = { '/': HTML, '/index.html': HTML, '/xlsx.full.min.js': path.join(ROOT, 'site', 'xlsx.full.min.js') };
const server = http.createServer((q, s) => { const p = SERVE[q.url.split('?')[0]];
  if (!p || !fs.existsSync(p)) { s.writeHead(404); s.end(); return; }
  s.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' }); fs.createReadStream(p).pipe(s); });
await new Promise((r) => server.listen(8253, '127.0.0.1', r));
const b = await chromium.launch();
try {
  const page = await b.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
  await page.goto('http://127.0.0.1:8253/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__mtd && window.__mtd.state(), null, { timeout: 30000 });

  /* THE FLOOR. Fri 2026-09-04 and Sat 2026-09-05 (September: rule in force); Fri 2026-08-07 and
     Sat 2026-08-08 (August: before the rule). Everyone present on every day; everyone dials;
     sales only on the Saturdays, two each for the first ten agents. */
  const out = await page.evaluate(() => {
    const S = window.__mtd.state();
    const TL = ['Leader Alpha', 'Leader Beta'];
    S.roster = []; S.att = {}; S.calls = {}; S.sales = {}; S.tracker = {}; S.orgHist = {}; S.vici = {}; S.cancRows = {}; S.viciDays = {};
    for (let i = 1; i <= 30; i++) {
      const code = 'CB' + (900000 + i), camp = i <= 15 ? 'Courtesy' : 'Cuddle';
      S.roster.push({ code, name: 'Test Agent ' + i, sf: 'Test Agent ' + i, tl: TL[i % 2], campaign: camp, tenure: 'Exp', callx: '', target: 5, start: '2026-01-01' });
    }
    const DAYS = { '2026-09-04': 'fri', '2026-09-05': 'sat', '2026-08-07': 'fri', '2026-08-08': 'sat' };
    for (const d of Object.keys(DAYS)) {
      S.att[d] = {}; S.calls[d] = {};
      for (const a of S.roster) { S.att[d][a.code] = 'P'; S.calls[d][a.code] = { talk: 3600, calls: 30, ans: 15, opt: 0, saleD: 0, v: 1 }; }
      if (DAYS[d] === 'sat') { S.sales[d] = {}; for (const a of S.roster.slice(0, 10)) S.sales[d][a.code] = { n: 2, gwp: 198, x: 172.17 }; }
    }
    S.ui.team = ''; S.ui.camp = ''; S.ui.mtdSub = 'Courtesy'; S.ui.wtdCamp = 'Courtesy'; S.ui.dailyFilter = {};
    window.__mtd.rebuild();
    const snap = (m) => {
      const f = (d) => (m.facts || []).filter((x) => x.date === d);
      const sum = (rows, k) => rows.reduce((n, x) => n + (x[k] || 0), 0);
      const day = (d) => { const r = f(d); return { rows: r.length, emp: sum(r, 'emp'), act: sum(r, 'act'), sales: sum(r, 'sales'), gwp: sum(r, 'gwp'), talk: sum(r, 'talk'), target: sum(r, 'target') }; };
      return { diallingDays: m.diallingDays, dates: m.dates, days: Object.fromEntries(Object.keys(DAYS).filter((d) => m.dates.includes(d)).map((d) => [d, day(d)])),
        grand: { sales: m.grand && m.grand.sales, act: m.grand && m.grand.act, emp: m.grand && m.grand.emp } };
    };
    window.__mtd.setPeriod('2026-09', 'month'); const sep = snap(window.__mtd.model());
    window.__mtd.setPeriod('2026-08', 'month'); const aug = snap(window.__mtd.model());
    window.__mtd.setPeriod('2026-09', 'month');
    return { sep, aug, rule: (typeof MTD_RULES !== 'undefined') ? MTD_RULES.saturdayShiftsFrom : null };
  });

  console.log('\nA · SEPTEMBER: A SATURDAY IS DATA, NOT A SHIFT');
  const fri = out.sep.days['2026-09-04'], sat = out.sep.days['2026-09-05'];
  ok('the rule is effective from 2026-09-01', out.rule === '2026-09-01', String(out.rule));
  ok('the Saturday is in the period and carries its rows (' + (sat && sat.rows) + ')', !!sat && sat.rows > 0);
  ok('its sales are counted (20 sales, ten agents × 2)', sat && sat.sales === 20, JSON.stringify(sat));
  ok('its GWP is counted', sat && sat.gwp > 0, JSON.stringify(sat));
  ok('its talk time is counted', sat && sat.talk > 0);
  ok('but it contributes NO employed shifts and NO actual shifts', sat && sat.emp === 0 && sat.act === 0, JSON.stringify(sat));
  ok('…and no target grows out of it', sat && sat.target === 0, String(sat && sat.target));
  ok('the Friday is an ordinary day: 30 employed, 30 actual', fri && fri.emp === 30 && fri.act === 30, JSON.stringify(fri));
  ok('dialling days = 1 (the Friday), not 2', out.sep.diallingDays === 1, String(out.sep.diallingDays));
  ok('the grand total keeps the Saturday sales (20) over the Friday shifts (30)', out.sep.grand.sales === 20 && out.sep.grand.act === 30, JSON.stringify(out.sep.grand));

  console.log('\nB · AUGUST, BEFORE THE RULE: UNCHANGED');
  const asat = out.aug.days['2026-08-08'];
  ok('an August Saturday with a register still counts its shifts (30/30)', asat && asat.emp === 30 && asat.act === 30, JSON.stringify(asat));
  ok('…and its sales', asat && asat.sales === 20);
  ok('August dialling days = 2', out.aug.diallingDays === 2, String(out.aug.diallingDays));

  console.log('\nC · THE HEADER FILTERS REACH MONTH TO DATE, WEEKLY AND DAILY');
  const render = async (tab, team, camp) => page.evaluate(async ([tab, team, camp]) => {
    const S = window.__mtd.state(); S.ui.tab = tab; S.ui.team = team || ''; S.ui.camp = camp || '';
    if (typeof renderPage === 'function') renderPage();
    await new Promise((r) => setTimeout(r, 400));
    const v = document.getElementById('view'); const txt = v ? v.innerText : '';
    /* leaders are read from the TABLE BODIES: the Daily page's own team dropdown lists every leader */
    const tb = v ? [...v.querySelectorAll('tbody')].map((t) => t.innerText).join(' ') : '';
    return { alpha: /Leader Alpha/.test(tb), beta: /Leader Beta/.test(tb), note: /filtered by/.test(txt), rows: v ? v.querySelectorAll('tbody tr').length : 0,
      chipsOff: v ? v.querySelectorAll('button.chip[disabled]').length : 0, empty: /Nothing matches the current filters/.test(txt) };
  }, [tab, team, camp]);
  for (const tab of ['mtd', 'weekly', 'daily']) {
    const all = await render(tab, '', '');
    ok(tab + ': with no filter both leaders appear', all.alpha && all.beta, JSON.stringify(all));
    const one = await render(tab, 'Leader Alpha', '');
    ok(tab + ': Team = Leader Alpha shows only that leader', one.alpha && !one.beta && one.rows > 0, JSON.stringify(one));
    if (tab !== 'daily') ok(tab + ': …and says which filter is on', one.note, JSON.stringify(one));
    const cud = await render(tab, '', 'Cuddle');
    ok(tab + ': Campaign = Cuddle renders the Cuddle view with rows', cud.rows > 0, JSON.stringify(cud));
    if (tab !== 'daily') ok(tab + ': …and the other campaign chips are disabled', cud.chipsOff > 0, JSON.stringify(cud));
    const none = await render(tab, 'Nobody Real', '');
    ok(tab + ': a leader with no rows names the filter that emptied the page', none.empty || none.rows === 0, JSON.stringify(none));
  }
  {
    /* the Dashboard — the first page anyone sees — must follow the header filters too */
    const all = await render('dashboard', '', ''), one = await render('dashboard', 'Leader Alpha', ''), cud = await render('dashboard', '', 'Cuddle');
    const txt = async () => page.evaluate(() => document.getElementById('view').innerText.replace(/s+/g, ' '));
    await render('dashboard', '', ''); const tAll = await txt(); await render('dashboard', 'Leader Alpha', ''); const tOne = await txt(); await render('dashboard', '', 'Cuddle'); const tCud = await txt();
    ok('dashboard: Team = Leader Alpha changes the figures', tOne !== tAll && one.note, JSON.stringify(one));
    ok('dashboard: Campaign = Cuddle changes the figures', tCud !== tAll && cud.note, JSON.stringify(cud));
    ok('dashboard: no filter shows the floor', !all.note);
  }
  ok('no page errors', errs.length === 0, errs.join(' | '));
} finally {
  await b.close(); server.close();
}
console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
process.exitCode = fail ? 1 : 0;
