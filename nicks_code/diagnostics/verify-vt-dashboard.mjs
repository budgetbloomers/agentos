#!/usr/bin/env node
/* verify-vt-dashboard.mjs — THE VT REPORT PAGE (Spec Kit 072, Phase C task C6; SC-005, SC-006).
 *
 * The BUILT PULSE page (site/pulse/index.html, rebuilt by tools/prepare-site.js first; --source serves
 * nicks_code/index.html, --no-build skips the build) in a real Chromium, in BOTH themes. The Worker is a stub inside
 * the test serving a FICTIONAL case book (CB91xx codes, invented case numbers, invented names, no customer field)
 * built in Node through the real engine. Every figure the page shows is checked against VTEngine.dashboard()
 * computed here in Node from the same book, roster and options — the page never computes one itself.
 *
 *   R1  NAV + registration: vt_report is FIRST in the Vehicle Tracking group, labelled "VT Report"; VT mode opens on
 *       it; ?app=vt&page=vt_report and the ?page=report shorthand both land there; tab grants gate it
 *   R2  the page's model IS VTEngine.dashboard() (deep equal), and the head names cycle, view, data-through, dialing day
 *   R3  every mockup panel is present, in the mockup's order: KPI cards, Performance Trend, Channel Performance,
 *       Campaign Breakdown, Cycle Performance, Sales vs budget, Forecast vs Actual, Detailed Breakdown, Key Insights
 *   R4  the five KPI cards carry the engine's values and their change; with no previous cycle every change reads "—"
 *   R5  the view selector: exactly the rule book's four views; each one repaints every panel and the page says in
 *       words which view is showing; the business-month select changes the page too (the verify-controls rule)
 *   R6  the panels paint the model's own fields: channels, campaigns + the Panimax roll-up, the five buckets and
 *       their targets, sales vs budget + the forecast marker, the breakdown totals as ratios of sums, the insights
 *   R7  the honest states, each in words: no uploads · no figures in this cycle · the Schedulers Data fields not
 *       loaded · no previous cycle · unmapped campaigns · sellers not on the Agent List · a missing day · the book
 *       unreadable with a Retry
 *   R8  the three integrity checks: OK/CHECK with an icon and the words, both sides printed, never blocking
 *   R9  the charts: role="img" with a non-empty text alternative on every one, a legend wherever two or more series
 *       are drawn, every mark hoverable (<title>), and NO literal colour anywhere in the painted SVG
 *   R10 where prev came from: the frozen kv:vt-digest-cycle-<prev> when it answers (and the page says so), the
 *       engine's own prevCycleFor() when it does not (and the page says that instead)
 *   R11 no console error, no page error, no spinner left behind, no empty card, no customer field in the DOM;
 *       screenshots (fictional data only) in diagnostics/scratch/vt/
 *
 *   R14 the .xlsx export (E3): every painted cell of every panel table equals its exported cell, folded and open,
 *       the file's sheets and name, a number format per cell type, and no customer field in the workbook (SC-007)
 *
 *   node nicks_code/diagnostics/verify-vt-dashboard.mjs [--source] [--no-build]
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { biFile, smFile, schFile, PII } from './vt-fixtures.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const require = createRequire(import.meta.url);
const { chromium } = await import(pathToFileURL(path.join(HERE, 'node_modules', 'playwright', 'index.mjs')).href);
const ENG = require(path.join(ROOT, 'nicks_code', 'vt-engine.js'));
const ST = require(path.join(ROOT, 'nicks_code', 'vt-pages.js'));
const PG = ST.Pages;
const R = ENG.VT_RULES;
let pass = 0, fail = 0; const failures = [];
const ok = (c, m, d) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; failures.push(m); console.log('  FAIL ' + m + (d !== undefined ? ' — ' + String(d).slice(0, 400) : '')); } };
const head = (t) => console.log('\n' + t);
const API = 'https://chatterbox-agentos-api.chatterbox-agentos.workers.dev';
const SOURCE = process.argv.includes('--source');
const SHOTS = path.join(HERE, 'scratch', 'vt'); fs.mkdirSync(SHOTS, { recursive: true });
const N = (s) => String(s == null ? '' : s).replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
const F = (t, v) => PG.fmtCell(t, v);
const CYCLE = 'cycle-2026-11', PREV = 'cycle-2026-10';

/* ---- the fictional floor: the VT sheet of an Agent List as vt_roster_at() returns it ---- */
const ROSTER_RPC = { as_of: '2026-11-02', rows: [
  { code: 'CB9101', name: 'Alpha Test', sf: 'Alpha Test', tl: 'Leader One', tl_code: 'CB9190', campaign_raw: 'Matrix Vehicle Tracking - Digital', tenure: 'Exp', target: 6.5, start_date: '2026-01-05' },
  { code: 'CB9105', name: 'Golf Hotel', sf: 'Golf Hotel', tl: 'Leader One', tl_code: 'CB9190', campaign_raw: 'Matrix Vehicle Tracking - Digital', tenure: 'Exp', target: 6.5, start_date: '2026-01-05' },
  { code: 'CB9102', name: 'Bravo Middle Tester', sf: null, tl: 'Leader Two', tl_code: 'CB9191', campaign_raw: 'Matrix Vehicle Tracking - Referral', tenure: 'Exp', target: 3, start_date: '2026-01-05' },
  { code: 'CB9104', name: 'Echo Foxtrot', sf: null, tl: 'Leader Two', tl_code: 'CB9191', campaign_raw: 'Matrix Vehicle Tracking - Scheduling', tenure: 'Exp', target: null, start_date: '2026-01-05' },
  { code: 'CB9106', name: 'India Juliet', sf: null, tl: 'Leader Two', tl_code: 'CB9191', campaign_raw: 'Matrix Vehicle Tracking - Scheduling', tenure: 'Exp', target: null, start_date: '2026-01-05' },
  { code: 'CB9103', name: 'Charlie Delta', sf: null, tl: 'Leader Three', tl_code: 'CB9192', campaign_raw: 'Matrix Vehicle Tracking - Predictive', tenure: 'M1', target: 1, start_date: '2026-10-01' }] };
const ROSTER = ST.rosterFromRpc(ROSTER_RPC);
const SELLERS = ['Alpha Test - Panimax', 'Golf Hotel', 'Bravo Middle Tester', 'Charlie Delta', 'Nobody On The List'];
const PARTNERS = ['RevX', 'Referral Agent', 'Predictive', 'Mystery Partner Co'];   // the fourth is deliberately NOT in the channel map
const SCHEDULERS = ['Echo Foxtrot', 'India Juliet', 'Kilo Lima'];                  // the third is deliberately not on the list
const add = (d, n) => ENG.periods.addDays(d, n);

/* ---- one extract per working day 28 Sep → 10 Nov 2026, Thursday 5 Nov missing (the gap state) ---- */
function buildFixture(withSchedulers) {
  const cases = [];
  let book = ENG.emptyBook(), counter = 0, id = 0;
  const receipts = [], days = [];
  for (let d = '2026-09-28'; d <= '2026-11-10'; d = add(d, 1)) if (ENG.periods.isWorkingDay(d) && d !== '2026-11-05') days.push(d);
  days.forEach((e, di) => {
    SELLERS.forEach((seller) => { for (let k = 0; k < 1 + (di % 2); k++) { const i = counter++;
      const outcome = i % 10 < 7 ? 'fit' : i % 10 < 9 ? 'miss' : 'open';
      cases.push({ cn: 90500000 + i, seller, partner: PARTNERS[i % 4], born: e, appt: add(e, outcome === 'open' ? 2 + (i % 24) : 1 + (i % 3)),
        outcome, charge: 100 + (i % 5) * 20, gwp: 150 + (i % 7) * 25, scheduler: SCHEDULERS[i % 3] }); } });
    const born = cases.filter((c) => c.born <= e);
    const bi = born.filter((c) => c.outcome === 'fit' && c.appt <= e).map((c) => ({ cn: c.cn, charge: c.charge, inst: c.appt, seller: c.seller, partner: c.partner, unit: c.cn % 2 ? 'MXV' : 'BEAME' }));
    const sm = born.filter((c) => !(c.outcome === 'fit' && c.appt <= e)).map((c) => ({ cn: c.cn, appt: c.appt, seller: c.seller, partner: c.partner,
      outcome: c.outcome === 'miss' && c.appt <= e ? 'Missed Fitment' : 'Scheduled Fitment' }));
    for (const [kind, aoa] of [['bi_fitted', biFile(bi)], ['sched_missed', smFile(sm)]]) {
      const parsed = kind === 'bi_fitted' ? ENG.parseBi(aoa) : ENG.parseSm(aoa);
      if (!Object.keys(parsed.cases).length) continue;
      const m = ENG.merge(book, parsed, { extractOn: e, roster: ROSTER, aliases: {} }); book = m.book; book.rev = ++id;
      receipts.push({ id, sha256: String(id).padStart(64, '0'), kind, file_name: (kind === 'bi_fitted' ? 'BI Active Fitted ' : 'Scheduled & Missed ') + e.slice(8, 10) + e.slice(5, 7) + e.slice(2, 4) + '.xlsx',
        extract_on: e, cycle_key: ENG.periods.cycleOf(e).key, state: 'committed', counts: m.counts, unmatched: m.unmatched, warnings: [], quiet_day_ack: false, committed_at: e + 'T06:15:00Z', rev_after: id });
    }
  });
  if (withSchedulers) {
    const lines = cases.map((c) => ({ cn: c.cn, sold: c.born, month: c.born >= '2026-10-26' ? 'Current' : 'Rollover', gwp: c.gwp,
      /* a referring agent on every third row, 0 (NOT blank — F0-19) on the rest, so the Referring Agent dimension
         has rows to paint and the "no referrer" case is still in the fixture */
      campaign: c.partner, ref: c.cn % 3 === 0 ? 'Bravo Middle Tester' : 0, scheduler: c.scheduler, result: 'Fitted', appt: c.appt }));
    const parsed = ENG.parseSchedulers(schFile(lines));
    const m = ENG.merge(book, parsed, { extractOn: '2026-11-10', roster: ROSTER, aliases: {} }); book = m.book; book.rev = ++id;
    receipts.push({ id, sha256: String(id).padStart(64, '0'), kind: 'schedulers_data', file_name: 'Master November 2026 - VT Report.xlsx',
      extract_on: '2026-11-10', cycle_key: CYCLE, state: 'committed', counts: m.counts, unmatched: m.unmatched, warnings: [], quiet_day_ack: false,
      committed_at: '2026-11-10T07:00:00Z', rev_after: id });
  }
  return { book, receipts };
}
const FULL = buildFixture(true);          // BI + Scheduled & Missed + Schedulers Data
const NOSCH = buildFixture(false);        // the daily two only: the "needs the Schedulers Data upload" state
/* THE LIVE STATE ON 25 Nov 2026: every case was already open when the book was opened, so not one carries a sale
   day. No daily export carries the day a sale was made, so this history cannot be dated from one - the page must
   SAY that rather than blank itself (the owner's correction: the daily exports are what build this report). */
const UNDATED = (() => { const f = structuredClone(NOSCH); Object.values(f.book.cases).forEach((c) => { c.soldOn = null; c.soldBasis = 'unknown'; }); return f; })();
let FX = FULL;
function bookRpc(from) {   // what vt_book(p_from) returns (migration-071 + 073's seven columns)
  const cs = Object.values(FX.book.cases).filter((c) => !from || c.lastSeen >= from || ['scheduled', 'missed'].includes(c.status) || (c.soldOn && c.soldOn >= from));
  const keep = new Set(cs.map((c) => String(c.caseNumber)));
  return { rev: FX.book.rev, openedOn: FX.book.openedOn, openingBookOn: FX.book.openingBookOn,
    cases: cs.map((c) => ENG.BOOK_COLS.map((k) => (c[k] === undefined ? null : c[k]))),
    events: FX.book.events.filter((e) => keep.has(String(e.caseNumber))).map((e) => [e.caseNumber, e.onDate, e.from, e.to, e.apptOn, e.reason || null]) };
}
const latestExtract = () => FX.receipts.filter((u) => u.state === 'committed' && u.kind !== 'opening_book').reduce((m, u) => (!m || u.extract_on > m ? u.extract_on : m), null);
const nodeDash = (cycleKey, view, prev) => {
  const book = ENG.bookFromRpc(bookRpc(ENG.periods.cycleByKey(cycleKey).from));
  const asOf = latestExtract();
  const p = prev === undefined ? ENG.prevCycleFor(book, ROSTER, cycleKey, { asOf }) : prev;
  return ENG.dashboard(book, ROSTER, { cycleKey, view: view || R.views.default, asOf, prev: p });
};

/* ---- the stub Worker ---- */
let W;
/* every request this stub refuses or answers non-200, for the whole run: the browser logs each one itself, and they
   are the TEST's refusals (an aborted VAS boot call, the optional frozen-digest probe), never a page defect */
let netFails = 0;
const resetWorker = (o = {}) => { W = { empty: false, bookFail: false, rosterFail: false, frozen: null, log: [], ...o }; };
resetWorker();
/* a FROZEN previous-cycle digest, exactly the shape VTEngine.digest() publishes (only the fields the page reads) */
const FROZEN_PREV = { scorecard: 'vt', version: R.version, empty: false, updatedAt: '2026-10-26T05:00:00Z',
  period: { key: PREV, from: '2026-09-26', to: '2026-10-25' }, floor: { mtd: { sales: 1234, fitted: 900, cancelled: 44, missed: 60 } } };
function answer(u) {
  const J = (b, s = 200) => ({ status: s, body: JSON.stringify(b), type: 'application/json' });
  if (u.pathname === '/api/vt/uploads') return J({ uploads: W.empty ? [] : FX.receipts.slice().reverse() });
  if (u.pathname === '/api/vt/roster') return W.rosterFail ? J({ error: 'boom' }, 502) : J(ROSTER_RPC);
  if (u.pathname === '/api/vt/book') return W.bookFail ? J({ error: 'upstream timeout' }, 502)
    : W.empty ? J({ rev: 0, openedOn: null, openingBookOn: null, cases: [], events: [] }) : J(bookRpc(u.searchParams.get('from')));
  if (u.pathname === '/api/kv') {
    const k = u.searchParams.get('key') || '';
    if (W.frozen && k === 'vt-digest-' + PREV) return { status: 200, body: JSON.stringify(W.frozen), type: 'text/plain' };
    return J({ found: false }, 404);
  }
  return J({ error: 'not found' }, 404);
}

/* ---- PULSE: the built page by default ---- */
if (!SOURCE && !process.argv.includes('--no-build')) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'prepare-site.js')], { cwd: ROOT, encoding: 'utf8' });
  ok(r.status === 0 && /Build consistency verified/.test(r.stdout), 'the site builds (tools/prepare-site.js)', (r.stderr || r.stdout).slice(-300));
}
const SERVE = SOURCE
  ? { '/index.html': 'nicks_code/index.html', '/vt-engine.js': 'nicks_code/vt-engine.js', '/vt-pages.js': 'nicks_code/vt-pages.js',
    '/vt-publish.js': 'nicks_code/vt-publish.js', '/vt-app.js': 'nicks_code/vt-app.js', '/vt-charts.js': 'nicks_code/vt-charts.js',
    '/vt-dashboard.js': 'nicks_code/vt-dashboard.js', '/xlsx.full.min.js': 'site/xlsx.full.min.js' }
  : { '/index.html': 'site/pulse/index.html', '/xlsx.full.min.js': 'site/xlsx.full.min.js' };
const server = http.createServer((q, s) => { const rel = SERVE[q.url.split('?')[0]]; const p = rel && path.join(ROOT, rel);
  if (!p || !fs.existsSync(p)) { netFails++; s.writeHead(404); s.end(); return; }
  s.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' }); fs.createReadStream(p).pipe(s); });
await new Promise((r) => server.listen(8277, '127.0.0.1', r));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
const errs = [], cons = [];
page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error') cons.push(String(m.text()).slice(0, 200)); });
await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (route) => {
  const u = new URL(route.request().url());
  if (!route.request().url().startsWith(API) || !/^\/api\/(vt\/|kv$)/.test(u.pathname)) { netFails++; return route.abort(); }
  W.log.push(u.pathname + u.search);
  const a = answer(u); if (a.status !== 200) netFails++;
  return route.fulfill({ status: a.status, contentType: a.type || 'application/json', body: a.body });
});
await page.goto('http://127.0.0.1:8277/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__mtd && window.__mtd.state() && window.VTDash && window.VTCharts, null, { timeout: 60000 });
await page.evaluate(() => { window.__cloudPush = function () {}; window.CBX_USER = { role: 'admin', username: 'tester', tabs: {} };
  try { sessionStorage.setItem('cbx_token', 'test-token'); } catch (e) { /* the frozen-digest read is then skipped */ } });

/* settle(): wait for the page's own settled state — no loading status, the page head painted, no job pending.
   The cap is TIME (30 s), never a count of polls or a sleep (the suites' settle() pattern). */
const settle = () => page.evaluate(async () => {
  const paint = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 0))));
  for (const t0 = Date.now(); Date.now() - t0 < 30000;) {
    await paint();
    const S = window.__mtd.state();
    if (S.ui.tab !== 'vt_report') break;
    const st = window.VTDash.state();
    if (st.status !== 'loading' && !document.querySelector('#view .vt-loading') && document.querySelector('#view .page-head')) break;
    await new Promise((r) => setTimeout(r, 25));
  }
  await paint();
});
const open = async (tab, u) => { await page.evaluate(([t, uu]) => { const S = window.__mtd.state(); if (uu) S.ui.vtReport = Object.assign({}, uu); S.ui.tab = t; renderPage(); }, [tab, u || null]); await settle(); };
const reset = (u) => page.evaluate((uu) => { window.VTDash._reset(); window.__mtd.state().ui.vtReport = uu || {}; }, u || {});
const viewText = () => page.evaluate(() => (document.getElementById('view') || {}).innerText || '');
const panels = () => page.evaluate(() => [...document.querySelectorAll('#view [data-panel]')].map((p) => p.dataset.panel));
const tableOf = (id) => page.evaluate((pid) => { const c = document.querySelector('#view [data-panel="' + pid + '"]');
  if (!c) return null; const t = c.querySelector('table');
  return t ? { head: [...t.querySelectorAll('thead th')].map((x) => x.textContent), rows: [...t.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((td) => td.textContent)) } : null; }, id);
const at = (t, row, h) => N(row[t.head.indexOf(h)]);
const rowBy = (t, label) => t.rows.find((r) => N(r[0]) === label || N(r[0]).indexOf(label) === 0);

try {
  head('R1 · NAV + registration');
  await reset(); await open('vt_report');
  const nav = await page.evaluate(() => { const g = [...document.querySelectorAll('#side .navgroup')].find((x) => /Vehicle Tracking/.test(x.querySelector('.lab').textContent));
    return { ids: g ? [...g.querySelectorAll('[data-page]')].map((b) => b.dataset.page) : [], labels: g ? [...g.querySelectorAll('[data-page] span')].map((s) => s.textContent) : [],
      vt: window.VTApp.on(), side: [...document.querySelectorAll('#side [data-page]')].map((b) => b.dataset.page), navAll: NAV.flatMap((x) => x.items.map((i) => i[0])) }; });
  ok(nav.ids[0] === 'vt_report', 'vt_report is the FIRST item of the Vehicle Tracking group (FR-001)', nav.ids.join());
  ok(nav.labels[0] === 'VT Report', 'labelled "VT Report"', nav.labels.join(' | '));
  ok(nav.vt && nav.side.join() === 'vt_report,vt_mtd,vt_weekly,vt_daily,data,hubs', 'opening it opens VT mode, whose sidebar now holds four VT pages + the Upload Station + Apps', nav.side.join());
  ok(nav.navAll.includes('vt_report'), 'vt_report is in NAV, so tab grants and tools/audit-permissions.mjs see it');
  ok(await page.evaluate(() => window.VTApp.intentOf('?app=vt&page=vt_report').page === 'vt_report' && window.VTApp.intentOf('?app=vt&page=report').page === 'vt_report'),
    'the address reaches it: ?app=vt&page=vt_report and the ?page=report shorthand');
  { const as = async (u) => { await page.evaluate(([uu]) => { window.CBX_USER = uu; window.__mtd.state().ui.tab = 'vt_report'; renderPage(); }, [u]); await settle();
      return page.evaluate(() => ({ tab: window.__mtd.state().ui.tab, h: (document.querySelector('#view .page-head h2') || {}).textContent || '' })); };
    const none = await as({ role: 'viewer', tabs: { vas: ['dashboard', 'mtd'] } }), one = await as({ role: 'viewer', tabs: { vas: ['vt_report'] } });
    await page.evaluate(() => { window.CBX_USER = { role: 'admin', username: 'tester', tabs: {} }; });
    ok(!/VT Report/.test(none.h) && none.tab !== 'vt_report', 'an account without the vt_report grant never renders it', JSON.stringify(none));
    ok(one.tab === 'vt_report' && /VT Report/.test(one.h), 'an account granted vt_report alone opens it', JSON.stringify(one)); }

  head('R2 · the page paints the engine');
  await reset(); await open('vt_report');
  const D = nodeDash(CYCLE);
  const pm = await page.evaluate(() => { const m = window.VTDash.state().model; const c = {}; for (const k in m) if (typeof m[k] !== 'function' && k.indexOf('prev') !== 0) c[k] = m[k]; return JSON.stringify(c); });
  const want = (() => { const c = {}; for (const k in D) if (typeof D[k] !== 'function' && k.indexOf('prev') !== 0) c[k] = D[k]; return JSON.stringify(c); })();
  ok(pm === want, 'the page\'s model equals VTEngine.dashboard() over the same book, roster, cycle and view (deep equal)', pm.slice(0, 200) + ' ||| ' + want.slice(0, 200));
  const sub = N(await page.evaluate(() => (document.querySelector('#view .vt-period') || {}).textContent || ''));
  ok(/Business month November 2026/.test(sub) && new RegExp(D.viewLabel.replace(/[()+]/g, '.')).test(sub), 'the head names the business month and the view', sub);
  ok(sub.indexOf('figures to ' + F('s', null)) < 0 && /figures to \d+ Nov 2026/.test(sub), 'the head names data-through', sub);
  ok(sub.indexOf(D.dialingDays.words) > -1, 'the head names the dialing day of the cycle', sub);

  head('R3 · every mockup panel, in the mockup\'s order');
  const WANT = ['kpis', 'trend', 'channels', 'campaigns', 'buckets', 'budget', 'forecast', 'breakdown', 'insights',
    'gwp', 'pivots', 'persons', 'upcoming', 'rollover', 'disagree', 'integrity'];
  const got = await panels();
  ok(JSON.stringify(got) === JSON.stringify(WANT), 'the panels are ' + WANT.join(' → '), got.join(' → '));
  const titles = await page.evaluate(() => [...document.querySelectorAll('#view .vt-panel h3')].map((h) => h.textContent));
  for (const t of ['Performance Trend', 'Channel Performance', 'Campaign Breakdown', 'Cycle Performance', 'Sales vs budget', 'Forecast vs Actual', 'Detailed Breakdown', 'Key Insights',
    'Fitted GWP', 'Scheduler pivots', 'Agent & Scheduler Summary', 'Upcoming Scheduled Fitments', 'Rollover follow-up', 'Where the sources disagree', 'Integrity checks'])
    ok(titles.includes(t), 'a panel titled "' + t + '"', titles.join(' | '));
  ok(!(await page.evaluate(() => [...document.querySelectorAll('#view .card')].some((c) => String(c.textContent || '').trim().length < 10))),
    'no card on the page is empty');

  head('R4 · the five KPI cards');
  const kp = await page.evaluate(() => [...document.querySelectorAll('#view [data-kpi]')].map((c) => ({ k: c.dataset.kpi,
    lab: c.querySelector('.lab').textContent, val: (c.querySelector('.val') || {}).textContent || '', dlt: (c.querySelector('.dlt') || {}).textContent || '',
    ring: !!c.querySelector('.vtc-ring'), spark: !!c.querySelector('.vtc-spark') })));
  ok(kp.length === 5 && kp.map((x) => x.k).join() === D.kpis.map((x) => x.k).join(), 'five KPI cards, in the engine\'s own order', kp.map((x) => x.k).join());
  ok(kp.map((x) => x.lab).join('|') === D.kpis.map((x) => x.label).join('|'), 'labelled Total Sales / Total Fitments / Cancellations / Missed / Target Achieved', kp.map((x) => x.lab).join('|'));
  { const bad = D.kpis.filter((k) => k.k !== 'targetAchieved').filter((k) => N((kp.find((x) => x.k === k.k) || {}).val) !== N(F('n', k.value)));
    ok(!bad.length, 'each count card prints the engine\'s value', bad.map((k) => k.k).join()); }
  ok(kp.find((x) => x.k === 'targetAchieved').ring, 'Target Achieved is a ring (one ratio against one limit)');
  ok(kp.filter((x) => x.k !== 'targetAchieved').every((x) => x.spark), 'each count card carries a week sparkline off the model\'s own weeks');
  ok(kp.every((x) => /vs previous cycle/.test(x.dlt)), 'every card states its change against the previous cycle', JSON.stringify(kp.map((x) => x.dlt)));
  const noPrev = D.prevCycle.present;
  ok(!noPrev === kp.every((x) => x.dlt.indexOf(R.reports.absent) > -1),
    'with no previous cycle on file every change reads "' + R.reports.absent + '" and never 0 (FR-019); with one it prints the change',
    'present=' + noPrev + ' ' + JSON.stringify(kp.map((x) => x.dlt)));

  head('R5 · the view selector and the business-month select');
  const opts = await page.evaluate(() => [...document.querySelectorAll('#view select[data-vtr="view"] option')].map((o) => o.value));
  ok(opts.join() === R.views.list.map((v) => v.k).join(), 'exactly the rule book\'s four views and nothing else (FR-007)', opts.join());
  ok((await page.evaluate(() => (document.querySelector('#view select[data-vtr="view"]') || {}).value)) === R.views.default,
    'the default view is "' + R.views.default + '" (FR-008)');
  ok(/Sales dated in the cycle, plus earlier sales only where they were fitted/.test(await viewText()), 'the page says in plain words which view is showing (FR-008)');
  for (const v of R.views.list.map((x) => x.k)) {
    await page.evaluate((vv) => VTDash.set('view', vv), v); await settle();
    const dv = nodeDash(CYCLE, v);
    const st = await page.evaluate(() => ({ view: window.VTDash.state().view, sales: window.VTDash.state().model.counts.sales,
      words: (document.querySelector('#view .vt-viewwords') || {}).textContent || '', panels: [...document.querySelectorAll('#view [data-panel]')].length }));
    ok(st.view === v && st.sales === dv.counts.sales, 'view "' + v + '" repaints to the engine\'s own figures (' + dv.counts.sales + ' sales)', JSON.stringify(st));
    ok(N(st.words).indexOf(dv.viewWords) > -1, 'view "' + v + '" names itself in words', N(st.words).slice(0, 120));
    ok(st.panels === WANT.length, 'view "' + v + '" still paints every panel', st.panels);
  }
  await page.evaluate((v) => VTDash.set('view', v), R.views.default); await settle();
  { const before = await page.evaluate(() => window.VTDash.state().model.counts.sales);
    await page.evaluate(() => VTDash.set('cycle', 'cycle-2026-10')); await settle();
    const after = await page.evaluate(() => ({ cycle: window.VTDash.state().cycle, sales: (window.VTDash.state().model || {}).counts ? window.VTDash.state().model.counts.sales : null,
      text: (document.getElementById('view') || {}).innerText.slice(0, 400) }));
    ok(after.cycle === PREV && (after.sales === null || after.sales !== before), 'the business-month select changes the page (every control does something)', JSON.stringify(after).slice(0, 200));
    await page.evaluate(() => VTDash.set('cycle', 'cycle-2026-11')); await settle(); }

  head('R6 · the panels paint the model\'s fields');
  const ch = await tableOf('channels');
  ok(ch && R.channels.keys.every((k) => !!rowBy(ch, R.channels.labels[k])), 'Channel Performance lists all four channels', ch && ch.rows.map((r) => N(r[0])).join());
  { const bad = D.channels.filter((t) => { const r = rowBy(ch, t.label); return !r || at(ch, r, 'Sales') !== N(F('n', t.sales)); });
    ok(!bad.length, 'each channel row prints the engine\'s sales', bad.map((t) => t.k).join()); }
  ok(!!rowBy(ch, 'Panimax'), 'the Panimax roll-up is a named, labelled row (FR-028)', ch.rows.map((r) => N(r[0])).join());
  ok(!!(await page.evaluate(() => document.querySelector('#view [data-panel="channels"] .vtc-donut'))), 'Channel Performance is a donut (the owner\'s choice for this panel)');
  const cp = await tableOf('campaigns');
  ok(cp && D.campaigns.every((c) => { const r = rowBy(cp, c.name); return r && at(cp, r, 'Sales') === N(F('n', c.sales)); }), 'Campaign Breakdown prints every campaign\'s sales');
  ok(!!(await page.evaluate(() => document.querySelector('#view [data-panel="campaigns"] .vtc-hbars'))), 'Campaign Breakdown is ranked horizontal bars, not a ring (two campaigns a ring would hide)');
  { const hb = await page.evaluate(() => [...document.querySelectorAll('#view [data-panel="campaigns"] .vtc-hbars text')].map((t) => t.textContent));
    const first = D.campaigns[0];
    ok(hb.indexOf(first.name) > -1 || hb.some((t) => t.indexOf(first.name) === 0), 'the bars are directly labelled with the campaign names', hb.slice(0, 6).join(' | ')); }
  const bk = await tableOf('buckets');
  ok(bk && D.buckets.length === 5 && D.buckets.every((b) => { const r = rowBy(bk, b.label); return r && at(bk, r, 'Open scheduled') === N(F('n', b.count)); }),
    'Cycle Performance shows the FIVE buckets with the engine\'s counts (FR-029)', bk && bk.rows.map((r) => N(r[0])).join());
  ok(D.buckets.every((b) => { const r = rowBy(bk, b.label); return at(bk, r, 'Target') === N(b.target == null ? R.reports.absent : F('d2', b.target)); }),
    'each bucket prints its own target, or the absent marker when none is on file');
  ok(/not<\/b> the share the agent rating reads|not the share the agent rating reads/.test(await page.evaluate(() => document.querySelector('#view [data-panel="buckets"]').innerHTML)),
    'the bucket panel labels WHICH target it measures against (D3 / FR-034)');
  ok(/frozen at .*the extract plus one day/.test(await viewText()), 'the bucket panel says the lead time is frozen at the extract, never a clock (FR-031)');
  const bd = await tableOf('budget');
  ok(bd && at(bd, rowBy(bd, 'Sales in view'), 'Actual') === N(F('n', D.counts.sales)) && at(bd, rowBy(bd, 'Sales in view'), 'Budget') === N(F('n', D.budget.sales.total)),
    'Sales vs budget is the sales against the cycle sales budget', bd && JSON.stringify(bd.rows[0]));
  ok(!/spend|Spend|cost|Cost/.test(await viewText()) || /no spend figure/i.test(await viewText()),
    'the page never invents a spend or a cost (FR-035) — it says there is none');
  ok(at(bd, rowBy(bd, 'Forecast at this pace'), 'Actual') === N(F('d2', D.forecast.sales)), 'the forecast is beside it, as the engine computed it');
  ok(/straight-line pace/.test(await viewText()), 'the forecast is labelled a straight-line pace, not a prediction (FR-040)');
  const br = await tableOf('breakdown');
  ok(br && at(br, rowBy(br, 'Total'), 'Sales') === N(F('n', D.breakdownTotals.sales)) && at(br, rowBy(br, 'Total'), 'Achievement') === N(F('p', D.breakdownTotals.achievement)),
    'the Detailed Breakdown totals row is the engine\'s own (ratios of sums)', br && JSON.stringify(rowBy(br, 'Total')));
  ok(/ratio of sums/.test(await viewText()), 'and says so');
  const ins = await page.evaluate(() => [...document.querySelectorAll('#view [data-panel="insights"] li')].map((l) => ({ id: l.dataset.insight, t: l.textContent })));
  ok(ins.length === D.insights.length && D.insights.every((i, n) => ins[n].id === i.id && N(ins[n].t).indexOf(i.text) === 0),
    'Key Insights are the engine\'s computed sentences, in order, each naming its cell (FR-042/043)', JSON.stringify(ins).slice(0, 240));

  head('R8 · the three integrity checks');
  const chk = await page.evaluate(() => [...document.querySelectorAll('#view [data-check]')].map((c) => ({ k: c.dataset.check, cls: c.className, t: c.textContent, icon: !!c.querySelector('svg') })));
  ok(chk.length === 3 && chk.map((c) => c.k).join() === D.integrity.map((c) => c.k).join(), 'all three checks render (K17, K18, the scheduler-name check)', chk.map((c) => c.k).join());
  ok(chk.every((c, i) => N(c.t).indexOf(D.integrity[i].verdict) === 0), 'each one leads with the word OK or CHECK', chk.map((c) => N(c.t).slice(0, 10)).join(' | '));
  ok(chk.every((c) => c.icon), 'each one carries an icon, so the verdict is never colour alone (FR-053)');
  ok(D.integrity.every((c, i) => N(chk[i].t).indexOf(F('n', c.got)) > -1 && N(chk[i].t).indexOf(F('n', c.expected)) > -1),
    'each one prints BOTH sides of its comparison with the real numbers', JSON.stringify(D.integrity.map((c) => [c.got, c.expected])));
  ok((await panels()).length === WANT.length, 'a check never blocks the page: every panel is still there (FR-054)');

  head('R9 · the charts');
  const charts = await page.evaluate(() => [...document.querySelectorAll('#view .vtchart')].map((c) => { const s = c.querySelector('svg');
    return { kind: c.dataset.chart, role: s && s.getAttribute('role'), alt: s && ((s.querySelector('title') || {}).textContent || s.getAttribute('aria-label') || ''),
      desc: s && ((s.querySelector('desc') || {}).textContent || ''), marks: s ? s.querySelectorAll('title').length : 0, legend: !!c.querySelector('.vt-legend'),
      texts: s ? s.querySelectorAll('text').length : 0 }; }));
  ok(charts.length >= 8, 'the page draws the mockup\'s charts (' + charts.length + ')', charts.map((c) => c.kind).join());
  ok(charts.every((c) => c.role === 'img' || c.kind === 'vtc-segbar' || c.kind === 'vtc-spark'), 'every chart is role="img"', charts.filter((c) => c.role !== 'img').map((c) => c.kind).join());
  ok(charts.every((c) => N(c.alt).length > 3), 'every chart carries a non-empty text alternative (SC-006)', charts.filter((c) => N(c.alt).length <= 3).map((c) => c.kind).join());
  ok(charts.filter((c) => /vtc-(line|donut|hbars|meters|meter|grouped)/.test(c.kind)).every((c) => N(c.desc).length > 10),
    'every full-size chart also carries a description naming its figures', charts.filter((c) => /vtc-(line|donut|hbars|meters|meter|grouped)/.test(c.kind) && N(c.desc).length <= 10).map((c) => c.kind).join());
  ok(charts.filter((c) => /vtc-(line|grouped)/.test(c.kind)).every((c) => c.legend), 'a legend is present on every chart drawing two or more series',
    charts.filter((c) => /vtc-(line|grouped)/.test(c.kind) && !c.legend).map((c) => c.kind).join());
  ok(charts.filter((c) => /vtc-(donut|hbars|meters|grouped)/.test(c.kind)).every((c) => c.texts > 1), 'the mark-based charts carry direct labels, so identity is never colour-alone');
  ok(charts.filter((c) => /vtc-(donut|hbars|meters|segbar)/.test(c.kind)).every((c) => c.marks >= 1), 'every mark is hoverable (an SVG <title>)');
  { const hexed = await page.evaluate(() => { const bad = [];
      document.querySelectorAll('#view .vtchart svg *').forEach((el) => { ['fill', 'stroke'].forEach((a) => { const v = el.getAttribute(a); if (v && /^#|rgb\(/.test(v)) bad.push(el.tagName + '@' + a + '=' + v); }); });
      return bad.slice(0, 6); });
    ok(!hexed.length, 'no chart names a colour: every fill and stroke is a CSS token (FR-004)', hexed.join(' ; ')); }
  { const tabled = await page.evaluate(() => ['trend', 'channels', 'campaigns', 'buckets', 'budget', 'forecast', 'breakdown']
      .filter((p) => !document.querySelector('#view [data-panel="' + p + '"] table')));
    ok(!tabled.length, 'every chart panel is paired with a table of the same figures (the required secondary encoding)', tabled.join()); }

  head('R12 · charts first, each table behind a "show the figures" fold');
  await reset(); await open('vt_report');
  const FOLDED = ['trend', 'channels', 'campaigns', 'buckets', 'budget', 'forecast', 'breakdown', 'gwp', 'pivots', 'persons', 'upcoming', 'rollover'];
  const openAll = () => page.evaluate(() => document.querySelectorAll('#view details.vt-fold').forEach((d) => { d.open = true; }));
  const heightOf = () => page.evaluate(() => document.getElementById('view').scrollHeight);
  /* one panel, with its figures open: scrolled into view and given a frame to settle FIRST, because PULSE's
     .tablewrap carries content-visibility:auto and an element shot taken before the scroll lands shows the wrong box */
  const shot = async (id, file) => {
    await page.addStyleTag({ content: '.tablewrap{content-visibility:visible!important}' });
    await page.evaluate((pid) => { const d = document.querySelector('#view [data-panel="' + pid + '"] details.vt-fold'); if (d) d.open = true; }, id);
    const el = await page.$('#view [data-panel="' + id + '"]');
    if (!el) return;
    await el.scrollIntoViewIfNeeded();
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 30)))));
    await el.screenshot({ path: path.join(SHOTS, file) });
  };
  {
    const folds = await page.evaluate((ids) => ids.map((id) => {
      const p = document.querySelector('#view [data-panel="' + id + '"]');
      const d = p && p.querySelector('details.vt-fold');
      const kids = p ? [...p.children] : [];
      const di = kids.findIndex((c) => c.tagName === 'DETAILS');
      const vi = kids.findIndex((c) => c.querySelector && (c.querySelector('.vtchart') || c.classList.contains('vtchart')
        || c.classList.contains('vtc-empty') || c.classList.contains('vt-kpis') || c.classList.contains('vt-filters')));
      return { id: id, panel: !!p, details: !!d, open: !!(d && d.open), table: !!(d && d.querySelector('table')),
        rows: d ? d.querySelectorAll('tbody tr').length : 0, summary: d ? ((d.querySelector('summary') || {}).textContent || '') : '',
        loose: !!(p && [...p.children].some((c) => c.classList && c.classList.contains('tablewrap'))),
        chartFirst: (vi > -1 || kids.some((c) => c.classList && c.classList.contains('vt-mix'))) && di > -1
          && (vi > -1 ? vi : kids.findIndex((c) => c.classList && c.classList.contains('vt-mix'))) < di };
    }), FOLDED);
    ok(folds.every((f) => f.panel && f.details), "every chart panel's table sits behind a <details> fold", folds.filter((f) => !f.details).map((f) => f.id).join());
    ok(folds.every((f) => !f.open), 'the fold is CLOSED by default, so the page opens as charts', folds.filter((f) => f.open).map((f) => f.id).join());
    ok(folds.every((f) => f.table && f.rows > 0), 'the table is IN THE DOM while folded, with all its rows — never built on click', folds.filter((f) => !f.rows).map((f) => f.id).join());
    ok(folds.every((f) => N(f.summary).indexOf('Show the figures') === 0 && / . .+/.test(N(f.summary)) && N(f.summary).length > 34),
      'the toggle says what it reveals and how much of it ("Show the figures — N campaigns")', folds.map((f) => N(f.summary)).join(' | ').slice(0, 220));
    ok(folds.every((f) => !f.loose), 'no table is left loose beside the fold, so a reader and the suite see one set of figures', folds.filter((f) => f.loose).map((f) => f.id).join());
    ok(folds.every((f) => f.chartFirst), 'the chart — or, where there is none, the panel’s own words — comes first in every folded panel', folds.filter((f) => !f.chartFirst).map((f) => f.id).join());
    const hFolded = await heightOf();
    const cols = await page.evaluate(() => { const g = document.querySelector('#view .vt-grid');
      return g ? getComputedStyle(g).gridTemplateColumns.split(' ').length : 0; });
    ok(cols === 2, 'the panels sit in two columns at 1360 px (one on a phone, by auto-fit and no media query)', cols);
    /* the mockup's own panels — the KPI row through Key Insights — are the "Overview" the owner measured */
    const over = await page.evaluate(() => { const a = document.querySelector('#view .vt-kpis').getBoundingClientRect();
      const b = document.querySelector('#view [data-panel="insights"]').getBoundingClientRect(); return Math.round(b.bottom - a.top); });
    console.log('    folded panel heights: ' + (await page.evaluate(() => [...document.querySelectorAll('#view [data-panel]')]
      .map((p) => p.dataset.panel + ' ' + Math.round(p.getBoundingClientRect().height)).join(' · '))));
    await openAll();
    const hOpen = await heightOf();
    ok(hFolded < hOpen * 0.75, 'folded, the page is far shorter than with every table open', hFolded + 'px vs ' + hOpen + 'px');
    console.log('    page height: folded ' + hFolded + 'px (' + (hFolded / 900).toFixed(1) + ' screens of 900) · every table open '
      + hOpen + 'px (' + (hOpen / 900).toFixed(1) + ' screens) · the Overview panels folded ' + over + 'px ('
      + (over / 900).toFixed(1) + ' screens) in ' + cols + ' columns');
  }
  await reset(); await open('vt_report');
  {
    const focused = await page.evaluate(() => { const s = document.querySelector('#view [data-panel="channels"] details.vt-fold > summary');
      s.focus(); return document.activeElement === s; });
    ok(focused, 'the toggle takes keyboard focus by itself (a native <summary>, no tabindex of ours)');
    await page.keyboard.press('Enter'); await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
    const after = await page.evaluate(() => ({ open: document.querySelector('#view [data-panel="channels"] details.vt-fold').open,
      saved: JSON.stringify((window.__mtd.state().ui.vtReport || {}).figures || {}) }));
    ok(after.open, 'Enter opens it, so the figures are reachable from the keyboard alone');
    ok(/"channels":\s*1/.test(after.saved), 'and the fold is remembered PER PERSON in S.ui.vtReport (the per-person view state), never a shared blob', after.saved);
    await page.evaluate(() => renderPage()); await settle();
    ok(await page.evaluate(() => document.querySelector('#view [data-panel="channels"] details.vt-fold').open), 'and it is still open after a repaint');
    await open('vt_report', { figures: { trend: 1, buckets: 1 } });
    const restored = await page.evaluate(() => ['trend', 'buckets', 'channels'].map((id) => document.querySelector('#view [data-panel="' + id + '"] details.vt-fold').open));
    ok(JSON.stringify(restored) === JSON.stringify([true, true, false]), 'a person whose saved state has figures open gets them open on the next paint', JSON.stringify(restored));
  }
  await reset(); await open('vt_report');
  ok(!(await page.evaluate(() => [...document.querySelectorAll('#view .vt-state')].some((c) => c.closest('details') || c.querySelector('details')))),
    'the honest-state notices never fold: a warning is not detail (missing day, Schedulers Data, unmapped campaigns, unmatched people)');
  ok(!(await page.evaluate(() => !!document.querySelector('#view .vt-kpis details, #view [data-panel="kpis"] details'))), 'and neither does the KPI row');

  head('R13 · the rest of the workbook: panels 14–19');
  await openAll();
  {
    const want = ['fitted', 'total', 'lost', 'open'];
    const g = await page.evaluate(() => [...document.querySelectorAll('#view [data-gwp]')].map((t) => ({ k: t.dataset.gwp, v: t.querySelector('.val').textContent })));
    ok(g.map((x) => x.k).join() === want.join(), 'Fitted GWP shows the four GWP measures (FR-044)', g.map((x) => x.k).join());
    ok(want.every((k, i) => N(g[i].v) === N(F('r', D.gwp[k]))), 'each one is the engine’s own figure, in rand',
      JSON.stringify(g.map((x) => N(x.v))) + ' vs ' + JSON.stringify(want.map((k) => N(F('r', D.gwp[k])))));
  }
  {
    const chips = await page.evaluate(() => [...document.querySelectorAll('#view [data-panel="pivots"] [data-pivot]')].map((b) => b.dataset.pivot));
    ok(chips.join() === R.reports.schedulerPivots.scopes.join(), 'the four pivot scopes are the rule book’s own (FR-045)', chips.join());
    for (const sc of R.reports.schedulerPivots.scopes) {
      await page.evaluate((x) => VTDash.set('pivot', x), sc); await settle(); await openAll();
      const t = await tableOf('pivots'), rows = D.schedulerPivot(sc);
      ok(t && rows.length > 0 && rows.every((r) => { const x = rowBy(t, r.name);
        return x && at(t, x, 'Sales') === N(F('n', r.sales)) && at(t, x, 'Fitted %') === N(F('p', r.pct.fitted))
          && at(t, x, 'Cancelled %') === N(r.pct.cancelled == null ? R.reports.absent : F('p', r.pct.cancelled)); }),
        'pivot "' + sc + '" paints the engine’s own schedulers, counts and four percentages (' + rows.length + ' schedulers)',
        t && JSON.stringify(t.rows.map((r) => r.slice(0, 5))).slice(0, 220));
      const tot = t && rowBy(t, 'All schedulers');
      ok(tot && at(t, tot, 'Sales') === N(F('n', rows.all.sales)) && at(t, tot, 'Fitted %') === N(F('p', rows.all.pct.fitted)),
        'pivot "' + sc + '" prints the scope’s grand total — the average a row is read against', tot && JSON.stringify(tot));
    }
    const txt = await viewText();
    ok(/no per-scheduler target in any source/.test(txt), 'the panel says there is NO per-scheduler target in any source, and never invents one');
    ok(/not a target/.test(txt), 'the reference rule on the bars is named as the scope average, not a target');
    ok(/all data/.test(txt), 'and the pivots say they are all data, not the view (FR-046)');
  }
  {
    const dims = R.reports.personDimensions.map((p) => p.k);
    const opt = await page.evaluate(() => [...document.querySelectorAll('#view select[data-vtr="pdim"] option')].map((o) => o.value));
    ok(opt.join() === dims.join(), 'the person dimension offers Agent / Referring Agent / Scheduler (FR-047)', opt.join());
    for (const d of dims) {
      await page.evaluate((x) => VTDash.set('pdim', x), d); await settle(); await openAll();
      const t = await tableOf('persons'), P2 = D.persons(d, {});
      ok(t && N(t.head[0]) === P2.label, 'dimension "' + d + '" names its own column', t && N(t.head[0]));
      ok(t && P2.rows.length > 0 && P2.rows.every((r) => { const x = rowBy(t, r.name); return x && at(t, x, 'Sales') === N(F('n', r.sales)); }),
        'dimension "' + d + '" paints every person the model returned (' + P2.rows.length + ' rows)', t && t.rows.map((r) => N(r[0])).join().slice(0, 200));
      ok(N(await viewText()).indexOf(P2.words) > -1, 'and says in words which dimension and which filters are active', P2.words);
    }
    await page.evaluate(() => { VTDash.set('pdim', 'scheduler'); VTDash.set('pchan', 'lead_gen'); }); await settle(); await openAll();
    const t = await tableOf('persons'), P2 = D.persons('scheduler', { channel: 'lead_gen' });
    ok(t && at(t, rowBy(t, 'All scheduler'), 'Sales') === N(F('n', P2.all.sales)) && P2.all.sales !== D.persons('scheduler', {}).all.sales,
      'a channel filter reaches the figures: the total follows the filter, not the whole view', t && JSON.stringify(rowBy(t, 'All scheduler')));
    ok(N(await viewText()).indexOf('Active filters: channel = lead_gen') > -1, 'and the active-filter line names it, as the workbook’s own message does');
    await shot('persons', 'vt-report-agents.png');
    await page.evaluate(() => VTDash.clearPersons()); await settle();
    ok(N(await viewText()).indexOf('Active filters: none') > -1, 'Clear filters puts it back to none');
  }
  await openAll();
  {
    const t = await tableOf('upcoming'), U = D.upcoming;
    ok(t && t.rows.length === U.dates.length + 2, 'Upcoming Scheduled Fitments: a row per date from the earliest booking, the folded tail and the pipeline total (FR-048)', t && t.rows.length);
    ok(t && N(t.rows[0][1]) === N(F('n', U.dates[0].count)) && N(t.rows[0][2]) === N(F('p', U.dates[0].share)),
      'the first row is the earliest booking date with the engine’s count and its share of the pipeline', t && JSON.stringify(t.rows[0]));
    ok(t && !!rowBy(t, U.tail.label) && N(rowBy(t, U.tail.label)[1]) === N(F('n', U.tail.count)),
      'the tail is "' + U.tail.label + '" and carries the rest', t && JSON.stringify(rowBy(t, U.tail.label)));
    ok(/all bookings, including rollovers, whatever the view/.test(await viewText()), 'and the panel says it covers all bookings whatever the view is set to');
  }
  {
    const t = await tableOf('rollover'), RO = D.rollover;
    ok(t && RO.rows.every((r) => { const x = rowBy(t, r.label);
      return x && at(t, x, 'Rollover sales') === N(F('n', r.sales)) && at(t, x, 'Open to action') === N(F('n', r.open)); }),
      'Rollover follow-up lists every channel’s pre-cycle position with Open to Action = scheduled + cancelled + missed (FR-049)',
      t && JSON.stringify(t.rows.map((r) => r.slice(0, 2))));
    ok(t && at(t, rowBy(t, 'Total'), 'Open GWP') === N(RO.totals.gwpOpen == null ? R.reports.absent : F('r', RO.totals.gwpOpen)),
      'and the open GWP, or the absent marker while the Schedulers Data sheet has not landed', t && JSON.stringify(rowBy(t, 'Total')));
    ok(/always the pre-cycle position/.test(await viewText()), 'and says it is always the pre-cycle position');
  }
  {
    const items = await page.evaluate(() => [...document.querySelectorAll('#view [data-panel="disagree"] [data-dis]')].map((x) => ({ k: x.dataset.dis, t: x.textContent, icon: !!x.querySelector('svg') })));
    ok(items.length === 6 && items.every((x) => x.icon), 'Where the sources disagree: six counts, each with an icon and the words (FR-014)', items.map((x) => x.k).join());
    const dg = D.disagree;
    ok(N(items[0].t).indexOf(N(F('n', dg.resultVsEngine.total))) === 0, 'the Result-against-status count is the engine’s own', N(items[0].t).slice(0, 60));
    ok(N(items[3].t).indexOf(N(F('n', dg.unmappedCampaigns))) === 0 && items[3].t.indexOf('Mystery Partner Co') > -1,
      'the unmapped campaign is counted and named', N(items[3].t).slice(0, 80));
    ok(/read, compared and counted/.test(await viewText()), 'and the panel says the Result column is counted, never applied');
    ok((await viewText()).indexOf(dg.carried.words) > -1,
      'the 071 hand credits and relabelled lead sources are carried forward in the floor guide’s own wording (FR-015)', dg.carried.words.slice(0, 60));
  }
  await shot('pivots', 'vt-report-schedulers.png');
  await reset(); await open('vt_report');

  head('R10 · where the previous cycle came from');
  ok(/engine recomputation of that cycle from the same case book/.test(await viewText()), 'with no frozen digest the page says it recomputed the previous cycle itself', N(await viewText()).slice(0, 0));
  resetWorker({ frozen: FROZEN_PREV }); await reset(); await open('vt_report');
  { const t = await viewText(), st = await page.evaluate(() => window.VTDash.state());
    ok(st.model.prevSource === 'digest', 'with a frozen kv:vt-digest-cycle-<prev> published, the page reads it', st.model.prevSource);
    ok(/frozen/.test(t) && t.indexOf('kv:vt-digest-' + PREV) > -1, 'and names the key it read', N(t).slice(0, 0) || 'not named');
    ok(/wider window/.test(t), 'and says the published figure is a wider window than this page\'s view, rather than comparing two definitions silently');
    const sales = D.kpis[0], card = await page.evaluate(() => (document.querySelector('#view [data-kpi="sales"] .dlt') || {}).textContent || '');
    ok(/vs previous cycle/.test(card) && card.indexOf(R.reports.absent) < 0, 'the count cards now print a real change', N(card));
    const ta = await page.evaluate(() => (document.querySelector('#view [data-kpi="targetAchieved"] .dlt') || {}).textContent || '');
    ok(ta.indexOf(R.reports.absent) > -1, 'Target Achieved\'s change still reads "' + R.reports.absent + '": the frozen key does not carry it, and an absence is not a nought', N(ta)); }
  resetWorker();

  head('R7 · the honest states');
  await reset(); await open('vt_report');
  const t0 = await viewText();
  ok(/A day's upload is missing|A day’s upload is missing/.test(t0), 'a missing day is named (5 Nov is absent from the fixture)', N(t0).slice(0, 0));
  ok(/Campaigns not in the channel map/.test(t0) && t0.indexOf('Mystery Partner Co') > -1, 'an unmapped campaign is named and counted under Other, never dropped (FR-026)');
  /* the engine keeps a name as the SOURCE spells it (its own normalisation), so the comparison is case-insensitive */
  const lower = t0.toLowerCase();
  ok(/Sellers not on the Agent List/.test(t0) && lower.indexOf('nobody on the list') > -1, 'a seller not on the Agent List is named for staff', lower.indexOf('nobody on the list'));
  ok(/Schedulers not on the Agent List/.test(t0) && lower.indexOf('kilo lima') > -1, 'a scheduler not on the Agent List is named, counted as typed', lower.indexOf('kilo lima'));
  FX = NOSCH; await reset(); await open('vt_report');
  { const t = await viewText();
    /* the owner's correction (25 Nov 2026): the DAILY exports build this report and the Schedulers Data sheet is an
       occasional extra, so the banner must name the panels that wait on it WITHOUT implying the page needs it. */
    ok(/Two panels wait on the Schedulers Data sheet/.test(t), 'with no Schedulers Data the page names the two panels that wait on it');
    ok(/built from the daily Upload Station exports/.test(t) && /not a monthly chore/.test(t),
      'and says the daily exports build the rest, so the sheet is not a monthly chore');
    ok(/needs the Schedulers Data upload/.test(t) && !/R 0,00/.test(t), 'and paints no zero in its place (an absence is not a nought)');
    await page.addStyleTag({ content: '.tablewrap{content-visibility:visible!important}' });
    await page.screenshot({ path: path.join(SHOTS, 'vt-report-not-loaded.png'), fullPage: false }); }
  FX = FULL;
  resetWorker({ empty: true }); await reset(); await open('vt_report');
  ok(/No Vehicle Tracking uploads yet/.test(await viewText()), 'no uploads yet: the page says so and points at the Upload Station');
  resetWorker({ bookFail: true }); await reset(); await open('vt_report');
  { const t = await viewText();
    ok(/could not be read/.test(t) && /Nothing on this page is shown from an old copy/.test(t) && !!(await page.evaluate(() => [...document.querySelectorAll('#view button')].some((b) => /Retry/.test(b.textContent)))),
      'the book unreadable: the reason, no stale copy, and a Retry', N(t).slice(0, 0)); }
  resetWorker(); await reset(); await open('vt_report', { cycle: 'cycle-2026-08' });
  ok(/No August 2026 figures yet/.test(await viewText()), 'a business month with no sale: "No <Month> figures yet", never a screen of zeros');
  FX = UNDATED; resetWorker(); await reset(); await open('vt_report');
  { const t = await viewText();
    ok(/figures yet/.test(t) && /carry no sale date/.test(t) && /already open when Vehicle Tracking reporting started/.test(t),
      'a book of undated history NAMES and explains it, never a blank screen');
    ok(/from the next daily upload onward is dated/.test(t), 'and says every new sale is dated by its own daily upload');
    ok(!/0/.test(t.replace(/\d[\d,]*/g, (m) => (m === '0' ? '0' : 'N'))), 'and still paints no zero in its place'); }
  FX = FULL; resetWorker();
  await reset(); await open('vt_report');

  /* ---------------------------------------------------------------- R14 · the .xlsx export (E3, SC-007) ----
   * The file is built from the MODEL, so the proof that matters is that every figure it carries is the one the
   * page PAINTS — cell for cell, for every panel that has a table — and that the fold changes none of them. The
   * export's own arithmetic is proved against the engine in verify-vt-export.mjs; this is the screen half. */
  head('R14 · the .xlsx export carries exactly what the screen shows');
  {
    ok(!!(await page.evaluate(() => !!document.querySelector('#view #vtrExport'))), 'the filter row carries an Export .xlsx button');
    const wbIn = await page.evaluate(() => { const w = window.VTDash.workbookFor(); return { n: w.name, sheets: w.sheets.map((s) => s.name), view: w.view, cycle: w.cycle, pre: w.preamble }; });
    ok(wbIn.sheets.length === 23, 'the workbook holds a sheet for every panel group, plus the three workbook sheets of spec 073 (' + wbIn.sheets.length + ')', wbIn.sheets.join(', '));
    ok(wbIn.cycle === CYCLE && wbIn.view === D.view && /^VT Report - /.test(wbIn.n), 'and names the cycle, the view and the report in the file name', wbIn.n + ' / ' + wbIn.cycle);
    /* every painted table against its own sheet, folded as a reader first meets the page and then fully open */
    const compare = (openFirst) => page.evaluate((openThem) => {
      document.querySelectorAll('#view details.vt-fold').forEach((d) => { d.open = !!openThem; });
      const S = window.VTDash.state(), specs = window.VTDash.sheetSpecs(S.model), PRE = window.VTDash.PREAMBLE;
      const wb = window.VTDash.workbookFor();
      /* a DRAWN cell (a change chip, an outcome-mix bar) is a shape on screen and words in the file: the figures
         behind it are the row's own other cells, so there is nothing to compare — it is counted, not skipped silently */
      const fmt = (c) => c == null ? '' : c && c.html ? null : c.t ? window.VTPages.fmtCell(c.t, c.v) : String(c);
      const norm = (s) => String(s == null ? '' : s).replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
      const out = { checked: 0, cells: 0, drawn: 0, bad: [] };
      /* the screen shows ONE pivot scope at a time and the file carries all four: compare the painted one */
      const shown = (document.querySelector('#view [data-panel="pivots"] [data-pivot].on') || {}).dataset;
      specs.forEach((sp, si) => {
        if (sp.panel === 'pivots' && (!shown || sp.scope !== shown.pivot)) return;
        const host = sp.panel && document.querySelector('#view [data-panel="' + sp.panel + '"]');
        const t = host && host.querySelector('table');
        if (!t) return;
        const body = [...t.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((td) => norm(td.textContent)));
        const aoa = wb.sheets[si].aoa.slice(PRE + 1);
        out.checked++;
        if (body.length !== sp.rows.length || aoa.length !== sp.rows.length) { out.bad.push(sp.sheet + ': ' + body.length + ' painted rows, ' + aoa.length + ' exported, ' + sp.rows.length + ' in the spec'); return; }
        sp.rows.forEach((r, ri) => sp.cols.forEach((c, ci) => {
          const want = fmt(r.cells[ci]);
          if (want === null) {                             /* a drawn shape: the file carries words, the screen a chart */
            out.drawn++;
            if (!String(r.cells[ci].v || '').length) out.bad.push(sp.sheet + ' r' + ri + ' "' + c.h + '": a drawn cell with no words for the file');
            return;
          }
          out.cells++;
          if (norm(want) !== body[ri][ci]) out.bad.push(sp.sheet + ' r' + ri + ' "' + c.h + '": screen "' + body[ri][ci] + '" vs "' + norm(want) + '"');
        }));
      });
      return out;
    }, openFirst);
    const folded = await compare(false);
    ok(folded.checked >= 12 && folded.cells > 400 && !folded.bad.length, 'folded: every painted cell of every panel table equals its exported cell ('
      + folded.checked + ' tables, ' + folded.cells + ' cells, ' + folded.drawn + ' drawn cells carrying words instead)', folded.bad.slice(0, 4).join(' | '));
    const opened = await compare(true);
    ok(opened.checked === folded.checked && opened.cells === folded.cells && opened.drawn === folded.drawn && !opened.bad.length,
      'and a folded table exports IDENTICALLY to an open one — the fold moves no figure', opened.bad.slice(0, 4).join(' | '));
    /* the written file: XLSX.writeFile stubbed so nothing is downloaded, the real utils still used */
    const wrote = await page.evaluate(() => {
      const X = window.XLSX, real = X.writeFile; let got = null;
      X.writeFile = (bk, nm) => { got = { name: nm, sheets: bk.SheetNames, z: {} };
        bk.SheetNames.forEach((s) => { const ws = bk.Sheets[s]; got.z[s] = Object.keys(ws).filter((k) => ws[k] && ws[k].z).map((k) => ws[k].z); }); };
      try { const r = window.VTDash.exportView(); return { r: r && { name: r.name, sheets: r.sheets.map((x) => x.name), pre: r.preamble }, got }; }
      finally { X.writeFile = real; }
    });
    ok(!!wrote.got && wrote.got.name === wbIn.n && wrote.got.sheets.join() === wbIn.sheets.join(),
      'Export .xlsx writes one workbook with those sheets, under that name', wrote.got && wrote.got.name);
    ok(!!wrote.r && wrote.r.sheets.join() === wbIn.sheets.join(), 'and leaves a receipt of what it wrote (window.__vtDashExport)', JSON.stringify(wrote.r && wrote.r.sheets).slice(0, 120));
    const zs = wrote.got ? [].concat(...Object.values(wrote.got.z)) : [];
    ok(zs.indexOf('0.0%') > -1 && zs.indexOf('#,##0') > -1 && zs.indexOf('"R "#,##0.00') > -1,
      'a percentage, a count and a rand figure each carry their own number format in the file', [...new Set(zs)].join(' '));
    const flat = await page.evaluate(() => { const w = window.VTDash.workbookFor();
      return w.sheets.map((s) => s.aoa.filter((r) => String(r[0]) !== 'Customer data').map((r) => r.join('|')).join('\n')).join('\n'); });
    { const found = PII.filter((p) => flat.indexOf(p) > -1);
      ok(!found.length, 'no customer field anywhere in the workbook (FR-057)', found.join()); }
  }
  await reset(); await open('vt_report');

  head('R11 · no error, no customer field, screenshots in both themes');
  ok(!(await page.evaluate(() => !!document.querySelector('#view .skel, #view .vt-loading'))), 'no spinner or skeleton is left behind');
  const dom = await page.evaluate(() => document.getElementById('view').innerHTML);
  { const found = PII.filter((p) => dom.indexOf(p) > -1);
    ok(!found.length, 'no customer field anywhere in the DOM (FR-013 / the discard list)', found.join()); }
  /* PULSE's .tablewrap carries content-visibility:auto, so a table far below the fold is NOT painted into a
     fullPage screenshot and the picture would show an empty box where the figures are. The override below is for
     the screenshot alone — the page itself keeps the optimisation. */
  /* THE NEW DEFAULT, exactly as a reader meets it: charts first, every table folded (the owner's layout decision of
     2026-11-25). This is the picture that answers "how tall is the page now". */
  await page.screenshot({ path: path.join(SHOTS, 'vt-report-folded.png'), fullPage: true });
  const showAll = () => page.addStyleTag({ content: '.tablewrap{content-visibility:visible!important}' });
  await showAll();
  await page.screenshot({ path: path.join(SHOTS, 'vt-report-light.png'), fullPage: true });
  await page.evaluate(() => { document.documentElement.setAttribute('data-theme', 'dark'); renderPage(); }); await settle(); await showAll();
  await page.screenshot({ path: path.join(SHOTS, 'vt-report-dark.png'), fullPage: true });
  ok(!!(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--vtc1').trim())
    && await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--vtc4').trim())),
    'the dark theme defines its own --vtc1…--vtc4 steps (never an automatic flip of the light four)');
  ok((await panels()).length === WANT.length, 'every panel still renders in the dark theme');
  await page.evaluate(() => { document.documentElement.setAttribute('data-theme', 'light'); renderPage(); }); await settle();
  ok(!errs.length, 'no page error', errs.join(' ; '));
  /* a 404 on GET /api/kv?key=vt-digest-cycle-<prev> is the ANSWER to an optional probe (no frozen digest is
     published for that month), and the browser logs every 404 itself. Nothing else may 404. */
  { const netErrs = cons.filter((c) => /Failed to load resource/.test(c)).length;
    ok(netErrs <= netFails, 'every failed request is one this stub refused on purpose (the aborted VAS boot calls and the optional frozen-digest probe) — the page itself asks for nothing that fails', netErrs + ' logged vs ' + netFails + ' refused');
    const real = cons.filter((c) => !/favicon|ERR_FAILED|net::|Failed to load resource/.test(c));
    ok(!real.length, 'no console error', real.join(' ; ')); }
  console.log('\n  screenshots: ' + SHOTS);
} finally {
  await browser.close(); server.close();
}
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
failures.forEach((f) => console.log('  · ' + f));
process.exit(fail ? 1 : 0);
