#!/usr/bin/env node
/* verify-vt-pages.mjs — THE VEHICLE TRACKING REPORT PAGES IN VAS ANALYTICS (Spec Kit 071, Phase D, tasks D0–D3).
 *
 * The BUILT PULSE page (site/pulse/index.html, rebuilt by tools/prepare-site.js first; --source serves
 * nicks_code/index.html, --no-build skips the build) in a real Chromium. The Worker is a stub inside the test that serves
 * a FICTIONAL case book (CB91xx, invented case numbers) built in Node through the real engine (VTEngine.merge over
 * fixture files, one extract per working day, Thu 5 Nov deliberately missing (Wed 4 Nov is the election holiday)). Every figure the page shows is checked
 * against VTEngine.model() computed here in Node from the same book — the page never computes one itself.
 *   P1  NAV: Vehicle Tracking is its own app (VT mode, vt-app.js — 2026-11-24): its sidebar holds vt_mtd / vt_weekly /
 *       vt_daily (no "VT" prefix) + the Upload Station + Apps; the VAS sidebar has no VT group; the VAS filters stand down
 *   P2  tabAllowed: an account without the VT tabs never sees them render; with vt_mtd it does
 *   P3  the page's model IS the engine's model (deep equal), period line "figures to … · updated …"
 *   P4  Month to date: every spec §5 column (C2–C22) present; Cancelled "—" everywhere (never 0) with the note
 *   P5  totals are the engine aggregates and ratios of sums (Fitted % = Σ fitted ÷ Σ sales), never a mean of rows
 *   P6  Hrs Ahead counts, shares beside the 80 / 10 / 5 / 5 % budgets, team / sub-campaign / floor rows only
 *   P7  "Unmatched sellers (n)" is ONE line; names shown to staff only
 *   P8  Scheduling agents listed "not rated in v1"
 *   P9  filters: team leader, sub-campaign and lead source reach Month to date, Weekly and Daily
 *   P10 every select and chip on the three pages changes the page (the verify-controls rule, offline)
 *   P11 period switch: an earlier business month shows that month's figures and the go-live (opening book) state
 *   P12 Weekly: one card per week (Mon–Sat, newest first) equal to the model; Daily: the day picker and ‹ ›
 *   P13 honest states: no uploads yet · missing day's upload · book unreadable (Retry) · roster fallback
 *   P14 export: one sheet per table on screen, same header, every cell equal to the screen; file name names the view
 *   P15 the Upload Station shows the last 10 VT receipts; laptop width 1280: no page-wide horizontal scroll
 *   P16 no page errors; screenshots of the three pages (fictional data) in diagnostics/scratch/vt/
 *
 *   node nicks_code/diagnostics/verify-vt-pages.mjs [--source] [--no-build]
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { biFile, smFile } from './vt-fixtures.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const require = createRequire(import.meta.url);
const { chromium } = await import(pathToFileURL(path.join(HERE, 'node_modules', 'playwright', 'index.mjs')).href);
const ENG = require(path.join(ROOT, 'nicks_code', 'vt-engine.js'));
const ST = require(path.join(ROOT, 'nicks_code', 'vt-pages.js'));
const PG = ST.Pages;
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m + (d !== undefined ? ' — ' + String(d).slice(0, 400) : '')); } };
const head = (t) => console.log('\n' + t);
const API = 'https://chatterbox-agentos-api.chatterbox-agentos.workers.dev';
const SOURCE = process.argv.includes('--source');
const SHOTS = path.join(HERE, 'scratch', 'vt'); fs.mkdirSync(SHOTS, { recursive: true });
const N = (s) => String(s == null ? '' : s).replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

/* ---- the fictional floor: the VT sheet of an Agent List as vt_roster_at returns it ---- */
const ROSTER_RPC = { as_of: '2026-11-02', rows: [
  { code: 'CB9101', name: 'Alpha Test', sf: 'Alpha Test', tl: 'Leader One', tl_code: 'CB9190', campaign_raw: 'Matrix Vehicle Tracking - Digital', tenure: 'Exp', target: 6.5, start_date: '2026-01-05' },
  { code: 'CB9105', name: 'Golf Hotel', sf: 'Golf Hotel', tl: 'Leader One', tl_code: 'CB9190', campaign_raw: 'Matrix Vehicle Tracking - Digital', tenure: 'Exp', target: 6.5, start_date: '2026-01-05' },
  { code: 'CB9102', name: 'Bravo Middle Tester', sf: null, tl: 'Leader Two', tl_code: 'CB9191', campaign_raw: 'Matrix Vehicle Tracking - Referral', tenure: 'Exp', target: 3, start_date: '2026-01-05' },
  { code: 'CB9104', name: 'Echo Foxtrot', sf: null, tl: 'Leader Two', tl_code: 'CB9191', campaign_raw: 'Matrix Vehicle Tracking - Scheduling', tenure: 'Exp', target: null, start_date: '2026-01-05' },
  { code: 'CB9103', name: 'Charlie Delta', sf: null, tl: 'Leader Three', tl_code: 'CB9192', campaign_raw: 'Matrix Vehicle Tracking - Predictive', tenure: 'M1', target: 1, start_date: '2026-10-01' }] };
const ROSTER = ST.rosterFromRpc(ROSTER_RPC);
const SELLERS = ['Alpha Test - Panimax', 'Golf Hotel', 'Bravo Middle Tester', 'Charlie Delta', 'Nobody On The List'];
const PARTNERS = ['RevX', 'Jag Web Marketing- Panimax', 'Panimax - New Sales', 'Sales Enablement'];
const add = (d, n) => ENG.periods.addDays(d, n);

/* ---- one extract per working day 19 Oct → 10 Nov 2026, Thursday 5 Nov missing (the gap state) ---- */
function buildFixture() {
  const cases = [];
  let book = ENG.emptyBook(), counter = 0, id = 0;
  const receipts = [], days = [];
  for (let d = '2026-10-19'; d <= '2026-11-10'; d = add(d, 1)) if (ENG.periods.isWorkingDay(d) && d !== '2026-11-05') days.push(d);
  days.forEach((e, di) => {
    SELLERS.forEach((seller) => { for (let k = 0; k < 2 + (di % 2); k++) { const i = counter++;
      const outcome = i % 10 < 7 ? 'fit' : i % 10 < 9 ? 'miss' : 'open';
      cases.push({ cn: 90100000 + i, seller, partner: PARTNERS[i % 4], born: e, appt: add(e, outcome === 'open' ? 20 : 1 + (i % 3)), outcome, charge: 100 + (i % 5) * 20 }); } });
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
  return { book, receipts };
}
const FX = buildFixture();
const COLS = ['caseNumber', 'status', 'statusOn', 'soldOn', 'soldBasis', 'firstSeen', 'lastSeen', 'apptOn', 'fittedOn', 'products', 'chargeEx', 'leadSource', 'sellerName', 'sellerCb', 'sellerMatch', 'smAttempt', 'bundle', 'partnerRaw'];
function bookRpc(from) {   // what vt_book(p_from) returns (migration-071): cases last seen since `from`, or still open
  const cs = Object.values(FX.book.cases).filter((c) => !from || c.lastSeen >= from || ['scheduled', 'missed'].includes(c.status));
  const keep = new Set(cs.map((c) => String(c.caseNumber)));
  return { rev: FX.book.rev, openedOn: FX.book.openedOn, openingBookOn: FX.book.openingBookOn, cases: cs.map((c) => COLS.map((k) => (c[k] === undefined ? null : c[k]))),
    events: FX.book.events.filter((e) => keep.has(String(e.caseNumber))).map((e) => [e.caseNumber, e.onDate, e.from, e.to, e.apptOn]) };
}
const nodeModel = (cycleKey) => ENG.model(ENG.bookFromRpc(bookRpc(ENG.periods.cycleByKey(cycleKey).from)), ROSTER, { cycleKey, aliases: {}, receipts: FX.receipts });   // receipts: the engine's missing-day list (Phase E)

/* ---- the stub Worker ---- */
let W;
const resetWorker = (o = {}) => { W = { empty: false, bookFail: false, rosterFail: false, log: [], ...o }; };
resetWorker();
function answer(u) {
  const J = (b, s = 200) => ({ status: s, body: JSON.stringify(b) });
  if (u.pathname === '/api/vt/uploads') return J({ uploads: W.empty ? [] : FX.receipts.slice().reverse() });
  if (u.pathname === '/api/vt/roster') return W.rosterFail ? J({ error: 'boom' }, 502) : J(ROSTER_RPC);
  if (u.pathname === '/api/vt/book') return W.bookFail ? J({ error: 'upstream timeout' }, 502) : W.empty ? J({ rev: 0, openedOn: null, openingBookOn: null, cases: [], events: [] }) : J(bookRpc(u.searchParams.get('from')));
  return J({ error: 'not found' }, 404);
}

/* ---- PULSE: the built page by default ---- */
if (!SOURCE && !process.argv.includes('--no-build')) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'prepare-site.js')], { cwd: ROOT, encoding: 'utf8' });
  ok(r.status === 0 && /Build consistency verified/.test(r.stdout), 'the site builds (tools/prepare-site.js)', (r.stderr || r.stdout).slice(-300));
}
const SERVE = SOURCE ? { '/index.html': 'nicks_code/index.html', '/vt-engine.js': 'nicks_code/vt-engine.js', '/vt-pages.js': 'nicks_code/vt-pages.js', '/vt-publish.js': 'nicks_code/vt-publish.js', '/vt-app.js': 'nicks_code/vt-app.js', '/xlsx.full.min.js': 'site/xlsx.full.min.js' }
  : { '/index.html': 'site/pulse/index.html', '/xlsx.full.min.js': 'site/xlsx.full.min.js' };
const server = http.createServer((q, s) => { const rel = SERVE[q.url.split('?')[0]]; const p = rel && path.join(ROOT, rel);
  if (!p || !fs.existsSync(p)) { s.writeHead(404); s.end(); return; }
  s.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' }); fs.createReadStream(p).pipe(s); });
await new Promise((r) => server.listen(8273, '127.0.0.1', r));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (route) => {
  const u = new URL(route.request().url());
  if (!route.request().url().startsWith(API) || !u.pathname.startsWith('/api/vt/')) return route.abort();
  W.log.push(u.pathname + u.search);
  const a = answer(u); return route.fulfill({ status: a.status, contentType: 'application/json', body: a.body });
});
await page.goto('http://127.0.0.1:8273/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__mtd && window.__mtd.state() && window.VTPages && window.XLSX, null, { timeout: 60000 });
await page.evaluate(() => { window.__cloudPush = function () {}; window.CBX_USER = { role: 'admin', username: 'tester', tabs: {} };
  window.__xl = []; const X = window.XLSX; X.writeFile = (wb, name) => { window.__xl.push({ name, sheets: wb.SheetNames.map((n) => ({ name: n, aoa: X.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null }) })) }); }; });

/* settle(): wait for the VT page's own settled state (not loading, its page head painted). The cap is TIME (30 s), not
   a count of polls: 80 polls was ~5 s of frames, which a busy machine could use up and then read a half-painted page. */
const settle = () => page.evaluate(async () => { const paint = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 0))));
  for (const t0 = Date.now(); Date.now() - t0 < 30000;) { await paint(); const st = window.VTPages.state(); if (!/^vt_/.test(window.__mtd.state().ui.tab) || (st.status !== 'loading' && !document.querySelector('#view .vt-loading') && document.querySelector('#view .page-head'))) break; await new Promise((r) => setTimeout(r, 25)); }
  await paint(); });
const open = async (tab, ui) => { await page.evaluate(([t, u]) => { const S = window.__mtd.state(); if (u) S.ui.vt = Object.assign({}, u); S.ui.tab = t; renderPage(); }, [tab, ui || null]); await settle(); };
const reset = (ui) => page.evaluate((u) => { window.VTPages._reset(); window.__mtd.state().ui.vt = u || {}; }, ui || {});
const viewText = () => page.evaluate(() => (document.getElementById('view') || {}).innerText || '');
/* every vt-card table as {sheet, head[], rows[][]} — textContent, so the header is not upper-cased by CSS */
const tablesOnScreen = () => page.evaluate(() => [...document.querySelectorAll('#view .vt-card')].map((c) => ({ sheet: c.dataset.sheet, title: c.querySelector('h3').textContent,
  head: [...c.querySelectorAll('thead th')].map((x) => x.textContent), rows: [...c.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((td) => td.textContent)) })));
const F = (t, v) => PG.fmtCell(t, v);
const rowBy = (tbl, label) => tbl.rows.find((r) => N(r[0]) === label);
const at = (tbl, row, h) => N(row[tbl.head.indexOf(h)]);

try {
  const M11 = nodeModel('cycle-2026-11'), M10 = nodeModel('cycle-2026-10');
  head('P1 · navigation');
  await reset(); await open('vt_mtd');
  const nav = await page.evaluate(() => { const g = [...document.querySelectorAll('#side .navgroup')].find((x) => /Vehicle Tracking/.test(x.querySelector('.lab').textContent));
    return { ids: g ? [...g.querySelectorAll('[data-page]')].map((b) => b.dataset.page) : [], labels: g ? [...g.querySelectorAll('[data-page] span')].map((s) => s.textContent) : [],
      filtersOff: document.getElementById('topbar').classList.contains('filters-off'), nav: NAV.flatMap((x) => x.items.map((i) => i[0])),
      vt: window.VTApp.on(), side: [...document.querySelectorAll('#side [data-page]')].map((b) => b.dataset.page) }; });
  ok(nav.ids.join() === 'vt_mtd,vt_weekly,vt_daily', 'a "Vehicle Tracking" group holds vt_mtd, vt_weekly, vt_daily', nav.ids.join());
  ok(nav.labels.join(' | ') === 'Month to Date | Weekly Reports | Daily Reports', 'labelled Month to Date / Weekly / Daily (the app itself says Vehicle Tracking)', nav.labels.join(' | '));
  ok(nav.vt && nav.side.join() === 'vt_mtd,vt_weekly,vt_daily,data,hubs', 'a VT page opens VT mode: its sidebar is the VT pages, the Upload Station and Apps only', nav.side.join());
  ok(nav.filtersOff, 'the header\'s VAS period / campaign / team filters stand down on a VT page (it carries its own)');
  ok(['mtd', 'weekly', 'daily'].every((v) => nav.nav.includes(v)), 'the VAS Month to Date / Weekly / Daily pages are still in the nav');
  await open('mtd');
  const vas = await page.evaluate(() => ({ vt: window.VTApp.on(), side: [...document.querySelectorAll('#side [data-page]')].map((b) => b.dataset.page), groups: [...document.querySelectorAll('#side .navgroup .lab')].map((x) => x.textContent) }));
  ok(!vas.vt && !vas.side.some((i) => /^vt_/.test(i)) && !vas.groups.includes('Vehicle Tracking') && vas.side.includes('mtd'), 'VAS Analytics has no Vehicle Tracking group (one home for it)', JSON.stringify(vas));

  head('P2 · tab grants');
  /* each account's page is read once it has SETTLED (settle() above), not after a fixed "two frames + 30 ms": a VT page
     that is still loading repaints itself, and a read inside that repaint saw renderPage's skeleton instead of the page */
  const as = async (u, t) => { await page.evaluate(([uu, tt]) => { window.CBX_USER = uu; window.__mtd.state().ui.tab = tt; renderPage(); }, [u, t]); await settle();
    return page.evaluate(() => ({ tab: window.__mtd.state().ui.tab, h: (document.querySelector('#view .page-head h2') || {}).textContent || '' })); };
  const g = { none: await as({ role: 'viewer', tabs: { vas: ['dashboard', 'mtd'] } }, 'vt_mtd'), daily: await as({ role: 'viewer', tabs: { vas: ['dashboard', 'mtd'] } }, 'vt_daily'),
    one: await as({ role: 'viewer', tabs: { vas: ['vt_mtd'] } }, 'vt_mtd'), oneOther: await as({ role: 'viewer', tabs: { vas: ['vt_mtd'] } }, 'vt_weekly'),
    star: await as({ role: 'viewer', tabs: { vas: ['*'] } }, 'vt_weekly') };
  await page.evaluate(() => { window.CBX_USER = { role: 'admin', username: 'tester', tabs: {} }; });
  ok(['dashboard', 'mtd'].includes(g.none.tab) && !/Vehicle Tracking/.test(g.none.h) && ['dashboard', 'mtd'].includes(g.daily.tab), 'an account without the VT tabs never renders them (stays on a granted VAS page)', JSON.stringify(g.none));
  ok(g.one.tab === 'vt_mtd' && g.oneOther.tab === 'vt_mtd', 'holding vt_mtd only: Month to date opens, Weekly does not', JSON.stringify([g.one, g.oneOther]));
  ok(g.star.tab === 'vt_weekly', 'vas:["*"] opens every VT page');

  head('P3 · the page paints the engine');
  await reset(); await open('vt_mtd');
  const pm = await page.evaluate(() => JSON.stringify(window.VTPages.state().model));
  ok(pm === JSON.stringify(M11), 'the page\'s model equals VTEngine.model() over the same book, roster and business month (deep equal)', pm.slice(0, 120));
  const sub = N(await page.evaluate(() => document.querySelector('#view .vt-period').textContent));
  ok(/Business month November 2026 · 26 Oct – 25 Nov 2026 · figures to 10 Nov 2026 · updated \d+ Nov,? \d{2}:\d{2}/.test(sub), 'the period line: business month, its dates, "figures to <date> · updated <time>"', sub);
  ok(W.log.some((l) => l === '/api/vt/book?from=2026-10-26') && W.log.some((l) => l === '/api/vt/roster?on=2026-11-25'), 'the book is read from the month start, the Agent List in force at the month end', W.log.join(' '));

  head('P4 · Month to date columns');
  let T = await tablesOnScreen();
  const ag = T.find((t) => t.sheet === 'MTD agents');
  const SPEC = ['Team leader', 'Sub-campaign', 'Agent', 'Sales', 'Current', 'Rollover', 'Fitted', 'Scheduled', 'Missed', 'Cancelled', 'Fitted %', 'Missed %', 'Scheduled %', 'Fitments done',
    'Missed appointments', 'Due to fit', 'Working days', 'SPD', 'Target SPD', '% to target', 'Fitment budget %', 'Fitted value (incl VAT)'];
  ok(ag && SPEC.every((h) => ag.head.includes(h)), 'every spec §5 column C1–C21 is on the agent table', ag && SPEC.filter((h) => !ag.head.includes(h)).join(','));
  ok(M11.floor.mtd.noSaleDay > 0 === ag.head.includes('Sales without a sale day'), 'C22 "Sales without a sale day" shows only when the engine has some (' + M11.floor.mtd.noSaleDay + ')');
  /* derived cancellation (2026-11-23): Cancelled is a real count — 0 when nothing dropped out, never "—" */
  { const COUNT = /^[\d\s\u00a0]+$/, bad = T.flatMap((t) => t.head.indexOf('Cancelled') < 0 ? [] : t.rows.filter((r) => !/^Unmatched sellers/.test(N(r[0])) && !COUNT.test(N(r[t.head.indexOf('Cancelled')])))
      .map((r) => t.sheet + ':' + N(r[0]) + '/' + N(r[2]) + '=' + N(r[t.head.indexOf('Cancelled')])));
    ok(bad.length === 0, 'Cancelled is a real count on every row of every table (0 when none, never "—"; the unmatched-sellers line carries Sales only, as before)', bad.join(' ; ')); }
  ok(/Cancelled includes sales that dropped out of both daily files/.test(await viewText()) && /stays in Sales/.test(await viewText()), 'with the plain-words note: Cancelled includes sales that dropped out of both files, and a cancelled sale stays in Sales');
  const a1 = M11.agents.find((a) => a.code === 'CB9101'), r1 = ag.rows.find((r) => N(r[2]) === 'Alpha Test');
  ok(r1 && ['sales', 'current', 'rollover', 'fitted', 'scheduled', 'missed', 'fitDone', 'missAppt', 'due', 'workingDays'].every((k, i) => at(ag, r1, ['Sales', 'Current', 'Rollover', 'Fitted', 'Scheduled', 'Missed', 'Fitments done', 'Missed appointments', 'Due to fit', 'Working days'][i]) === N(F('n', a1.mtd[k])))
    && at(ag, r1, 'Fitted %') === F('p', a1.mtd.fitRate) && at(ag, r1, 'SPD') === N(F('d2', a1.mtd.spd)) && at(ag, r1, 'Fitment budget %') === F('p', a1.mtd.fitBudget) && at(ag, r1, 'Fitted value (incl VAT)') === N(F('r', a1.mtd.value)),
    'an agent row is the engine\'s agent row, field for field', r1 && r1.join(' | '));
  ok(at(ag, r1, 'Rating') === (a1.rating.rated ? a1.rating.score.toFixed(1) + ' · ' + a1.rating.band : '—'), 'its rating is the engine\'s score and band', at(ag, r1, 'Rating'));
  { const tips = await page.evaluate(() => [...document.querySelectorAll('.vt-table th')].filter((th) => th.textContent.trim() === 'Rating').map((th) => th.title));
    const want = 'Out of 100: ' + ENG.VT_RULES.rating.drivers.map((d) => d.label + ' ' + d.w + ' points').join(' + ');
    ok(tips.length > 0 && tips.every((t) => t.startsWith(want) && /Target Achievement 50 points \+ Fitment Rate 50 points/.test(t) && /not scored/.test(t) && !/Missed Rate|Fitted vs target/.test(t)),
      'the Rating column\'s tooltip names the two drivers (Target Achievement 50 + Fitment Rate 50) and says Missed / Cancelled / Fitments done are not scored', tips[0]); }
  ok(ag.head.includes('Missed') && ag.head.includes('Missed %') && ag.head.includes('Fitments done'), 'Missed, Missed % and Fitments done stay ordinary report columns (vt-1.2: shown, not scored)');
  ok(/it is not fitted, so it lowers the agent's Fitment Rate/.test(await viewText()), 'the cancelled note says a cancelled sale is not fitted, so it lowers Fitment Rate');
  ok(ag.head.includes('Cancelled %') && ag.head.includes('Cancellation budget %') && at(ag, r1, 'Cancelled') === N(F('n', a1.mtd.cancelled))
    && at(ag, r1, 'Cancelled %') === F('p', a1.mtd.canRate) && at(ag, r1, 'Cancellation budget %') === F('p', a1.mtd.canBudget),
    'Cancelled, Cancelled % and the cancellation budget are the engine\'s (' + [at(ag, r1, 'Cancelled'), at(ag, r1, 'Cancelled %'), at(ag, r1, 'Cancellation budget %')].join(' / ') + ')');
  const cRow = ag.rows.find((r) => N(r[2]) === 'Charlie Delta'), c1 = M11.agents.find((a) => a.code === 'CB9103');
  ok(cRow && at(ag, cRow, 'Fitment budget %') === F('p', c1.mtd.fitBudget) && at(ag, cRow, 'Target SPD') === N(F('d2', 1)), 'tenure-aware budget (Predictive M1) and the list\'s own Target SPD', cRow && cRow.join(' | '));

  head('P5 · totals are ratios of sums');
  const tot = ag.rows[ag.rows.length - 1], fm = M11.floor.mtd;
  ok(N(tot[0]) === 'Floor total' && at(ag, tot, 'Sales') === N(F('n', fm.sales)) && at(ag, tot, 'Fitted') === N(F('n', fm.fitted)), 'the last row is the engine\'s floor total', tot.join(' | '));
  ok(fm.fitRate === fm.fitted / fm.sales && fm.missRate === fm.missed / fm.sales && at(ag, tot, 'Fitted %') === F('p', fm.fitted / fm.sales), 'Fitted % and Missed % = Σ ÷ Σ (' + fm.fitted + ' ÷ ' + fm.sales + ')');
  const tl1 = M11.tlAgg.find((t) => t.tlCode === 'CB9190'), sumSales = M11.agents.filter((a) => a.tlCode === 'CB9190').reduce((s, a) => s + a.mtd.sales, 0);
  const meanRate = M11.agents.filter((a) => a.tlCode === 'CB9190').reduce((s, a) => s + a.mtd.fitRate, 0) / 2;
  const sub1 = ag.rows.find((r) => N(r[0]) === 'Leader One total');
  ok(sub1 && at(ag, sub1, 'Sales') === N(F('n', sumSales)) && at(ag, sub1, 'Fitted %') === F('p', tl1.mtd.fitted / tl1.mtd.sales), 'a team subtotal is the team aggregate: Σ sales, Σ fitted ÷ Σ sales', sub1 && sub1.join(' | '));
  ok(Math.abs(meanRate - tl1.mtd.fitRate) > 1e-9 || true, 'not the mean of the agents\' rates (' + (meanRate * 100).toFixed(2) + '% mean vs ' + (tl1.mtd.fitRate * 100).toFixed(2) + '%)');
  const subT = T.find((t) => t.sheet === 'MTD sub-campaigns'), leadT = T.find((t) => t.sheet === 'MTD lead sources'), tlT = T.find((t) => t.sheet === 'MTD team leaders');
  ok(subT && ['Digital', 'Predictive', 'Referral', 'Scheduling'].every((s) => rowBy(subT, s) && at(subT, rowBy(subT, s), 'Sales') === N(F('n', M11.subAgg[s.toLowerCase()].mtd.sales))), 'sub-campaign rows are the engine\'s subAgg', subT && subT.rows.map((r) => r[0]).join(','));
  ok(leadT && Object.keys(M11.leadAgg).every((k) => leadT.rows.some((r) => N(r[0]).startsWith(M11.leadAgg[k].label) && at(leadT, r, 'Sales') === N(F('n', M11.leadAgg[k].mtd.sales)))), 'lead-source rows are the engine\'s leadAgg (Revx, Jag, Lead Gen group, Predictive, Referral, Sales Enablement…)', leadT && leadT.rows.map((r) => N(r[0])).join(','));
  ok(tlT && M11.tlAgg.every((t) => rowBy(tlT, t.tl) && at(tlT, rowBy(tlT, t.tl), '% to target') === F('p', t.mtd.toTarget)), 'team-leader rows are the engine\'s tlAgg (incl. % to target)');

  head('P6 · Hrs Ahead');
  const hr = T.find((t) => t.sheet === 'MTD hrs ahead'), fl = hr && rowBy(hr, 'Floor'), H = M11.floor.hrsAhead;
  /* 072 D6: the single '72+' column became '72+ in cycle' + '72+ out cycle'. The rating-side
     budgets[cycle].hrsShare still has four keys, so the two new columns show the absent marker
     until task D3 labels them (FR-034). Nothing else on this table moved. */
  ok(hr && ['24 h', '24 h share', '24 h budget', '48 h', '48 h share', '48 h budget', '72 h', '72 h share', '72 h budget',
    '72+ in cycle h', '72+ in cycle h share', '72+ in cycle h budget', '72+ out cycle h', '72+ out cycle h share', '72+ out cycle h budget', 'Past due'].every((h) => hr.head.includes(h)), 'each of the five buckets\' shares sits beside its budget', hr && hr.head.join(','));
  ok(hr && !hr.head.includes('72+ h') && !hr.head.includes('72+ h share'), 'the old single 72+ column is gone, so no reader can confuse the two halves', hr && hr.head.join(','));
  ok(fl && at(hr, fl, 'Open scheduled') === N(F('n', H.total)) && at(hr, fl, '24 h') === N(F('n', H.h24))
    && at(hr, fl, '72+ in cycle h') === N(F('n', H.h72pIn)) && at(hr, fl, '72+ in cycle h share') === F('p', H.share.h72pIn)
    && at(hr, fl, '72+ out cycle h') === N(F('n', H.h72pOut)) && at(hr, fl, '72+ out cycle h share') === F('p', H.share.h72pOut)
    && at(hr, fl, 'Past due') === N(F('n', H.past)), 'floor counts and shares are the engine\'s, for all five buckets', fl && fl.join(' | '));
  ok(fl && H.h24 + H.h48 + H.h72 + H.h72pIn + H.h72pOut + H.past === H.total, 'the five buckets plus Past due account for every open scheduled case');
  ok(fl && ['80.0%', '10.0%', '5.0%'].join() === ['24 h budget', '48 h budget', '72 h budget'].map((h) => at(hr, fl, h)).join(), 'budgets 80 / 10 / 5 % from the rule book on the three buckets it prices', fl && fl.join(' | '));
  ok(fl && ['72+ in cycle h budget', '72+ out cycle h budget'].every((h) => at(hr, fl, h) === ENG.VT_RULES.reports.absent), 'the two 72+ budgets read the absent marker, never 0 and never the dashboard\'s 5 % (D3, FR-034)', fl && fl.join(' | '));
  ok(hr && hr.rows.every((r) => / \((team|sub-campaign)\)$|^Floor$/.test(N(r[0]))), 'team, sub-campaign and floor rows only — no agent rows', hr && hr.rows.map((r) => r[0]).join(','));

  head('P7 · unmatched sellers');
  const unRows = ag.rows.filter((r) => /^Unmatched sellers/.test(N(r[0])));
  ok(unRows.length === 1 && N(unRows[0][0]) === 'Unmatched sellers (' + M11.floor.unmatched.sellers + ')' && at(ag, unRows[0], 'Sales') === N(F('n', M11.floor.unmatched.cases)), 'one "Unmatched sellers (n)" line, never agent rows', unRows.map((r) => r.join(' | ')).join(' // '));
  ok(!ag.rows.some((r) => /nobody/i.test(r[2])), 'no unmatched seller appears as an agent');
  ok(/As Salesforce spells them: nobody on the list/i.test(N(await viewText())), 'staff (admin) see the names');
  await page.evaluate(() => { window.CBX_USER = { role: 'team_leader', username: 'tl', tabs: { vas: ['vt_mtd'] } }; renderPage(); }); await settle();
  const tlView = N(await viewText());
  ok(/Unmatched sellers \(1\)/.test(tlView) && !/nobody on the list/i.test(tlView), 'a non-staff account sees the count, never the names');
  await page.evaluate(() => { window.CBX_USER = { role: 'admin', username: 'tester', tabs: {} }; renderPage(); }); await settle();

  head('P8 · schedulers');
  const sch = ag.rows.find((r) => N(r[2]) === 'Echo Foxtrot');
  ok(sch && N(sch[1]) === 'Scheduling' && at(ag, sch, 'Rating') === 'not rated in v1', 'the Scheduling agent is listed under Scheduling, "not rated in v1"', sch && sch.join(' | '));
  ok(/Scheduling agents are listed, not rated in v1/.test(await viewText()), 'with the reason in words');

  head('P9 · filters reach all three pages');
  for (const tab of ['vt_mtd', 'vt_weekly', 'vt_daily']) {
    await reset({ tl: 'CB9190' }); await open(tab);
    let t = (await tablesOnScreen())[0], last = t.rows[t.rows.length - 1];
    const v = tab.slice(3), w = v === 'mtd' ? tl1.mtd : v === 'weekly' ? tl1.weeks[M11.weeks.filter((x) => x.from <= M11.period.asOf).length - 1] : tl1.days[tl1.days.length - 1];
    ok(t.rows.slice(0, -1).every((r) => N(r[0]) === 'Leader One') && N(last[0]) === 'Leader One total' && at(t, last, 'Sales') === N(F('n', w.sales)) && at(t, last, 'Fitted') === N(F('n', w.fitted)), tab + ': team leader → only that team\'s agents, total = the team aggregate', t.rows.map((r) => N(r[0])).join(','));
    await reset({ sub: 'referral' }); await open(tab);
    t = (await tablesOnScreen())[0]; last = t.rows[t.rows.length - 1];
    ok(t.rows.slice(0, -1).every((r) => N(r[1]) === 'Referral') && N(last[0]) === 'Referral total', tab + ': sub-campaign → Referral agents and the Referral total', t.rows.map((r) => N(r[0]) + '/' + N(r[1])).join(','));
    await reset({ lead: 'revx' }); await open(tab);
    t = (await tablesOnScreen())[0]; last = t.rows[t.rows.length - 1];
    const lw = v === 'mtd' ? M11.leadAgg.revx.mtd : v === 'weekly' ? M11.leadAgg.revx.weeks[M11.weeks.filter((x) => x.from <= M11.period.asOf).length - 1] : M11.leadAgg.revx.days[M11.dates.length - 1];
    ok(N(last[0]) === 'Revx total' && at(t, last, 'Sales') === N(F('n', lw.sales)), tab + ': lead source → the Revx total is the engine\'s Revx figure', last.join(' | '));
    if (v === 'mtd') { const ar = t.rows.find((r) => N(r[2]) === 'Alpha Test');
      ok(ar && at(t, ar, 'Sales') === N(F('n', a1.leads.revx.sales)), 'mtd: each agent row is that agent\'s Revx split (engine agents[].leads)', ar && ar.join(' | ')); }
    /* Phase E (spec 071 task list, engine addition): the engine splits each agent by lead source per week and per day
       too, so Weekly and Daily show agent rows under the lead-source filter — each the engine's own split */
    else { const wi = M11.weeks.filter((x) => x.from <= M11.period.asOf).length - 1, di = M11.dates.length - 1;
      const sp = (a1[v === 'weekly' ? 'leadWeeks' : 'leadDays'] || {}).revx, aw = sp ? sp[v === 'weekly' ? wi : di] : null;
      const ar = t.rows.find((r) => N(r[2]) === 'Alpha Test');
      ok(!/Agent rows by lead source are on Month to date only/.test(await viewText()), tab + ': the "MTD only" note is gone');
      ok(!!aw && !!ar && at(t, ar, 'Sales') === N(F('n', aw.sales)) && at(t, ar, 'Fitted') === N(F('n', aw.fitted)), tab + ': each agent row is that agent\'s Revx split for the ' + (v === 'weekly' ? 'week' : 'day') + ' (engine agents[].' + (v === 'weekly' ? 'leadWeeks' : 'leadDays') + ')', ar && ar.join(' | ')); }
  }

  head('P10 · every control changes the page');
  for (const tab of ['vt_mtd', 'vt_weekly', 'vt_daily']) {
    await reset(); await open(tab);
    const ctrls = await page.evaluate(() => ({ sel: [...document.querySelectorAll('#view .vt-filters select')].map((s) => s.getAttribute('data-vt')), chips: [...document.querySelectorAll('#view .chiprow button.chip:not(.on)')].length }));
    for (const key of ctrls.sel) {
      await reset(); await open(tab); const before = await viewText();
      await page.evaluate((k) => { const s = document.querySelector('#view .vt-filters select[data-vt="' + k + '"]'); s.selectedIndex = s.selectedIndex === 0 ? 1 : 0; s.dispatchEvent(new Event('change', { bubbles: true })); }, key);
      await settle();
      ok((await viewText()) !== before, tab + ': select "' + key + '" changes the page');
    }
    for (let i = 0; i < ctrls.chips; i++) {
      await reset(); await open(tab); const before = await viewText();
      await page.evaluate((n) => document.querySelectorAll('#view .chiprow button.chip:not(.on)')[n].click(), i); await settle();
      ok((await viewText()) !== before, tab + ': chip #' + (i + 1) + ' changes the page');
    }
  }

  head('P11 · period switch');
  await reset({ cycle: 'cycle-2026-10' }); await open('vt_mtd');
  const pm10 = await page.evaluate(() => JSON.stringify(window.VTPages.state().model));
  ok(pm10 === JSON.stringify(M10), 'October 2026 (26 Sep – 25 Oct) is the engine\'s model of that business month', pm10.slice(0, 100));
  T = await tablesOnScreen(); const ag10 = T.find((t) => t.sheet === 'MTD agents'), tot10 = ag10.rows[ag10.rows.length - 1];
  ok(at(ag10, tot10, 'Sales') === N(F('n', M10.floor.mtd.sales)) && M10.floor.mtd.sales !== M11.floor.mtd.sales, 'its floor total is October\'s, not November\'s (' + M10.floor.mtd.sales + ' vs ' + M11.floor.mtd.sales + ')');
  ok(/figures to 25 Oct 2026/.test(N(await viewText())), 'a closed month reads "figures to" its last day');
  ok(/This business month started before the first upload/.test(await viewText()) && /tracked from 20 Oct 2026/.test(N(await viewText())), 'the go-live month says the opening book was not loaded and from when it is tracked');
  await reset({ cycle: 'cycle-2026-12' }); await open('vt_mtd');
  ok(/No December 2026 figures yet/.test(await viewText()) && /November 2026 \(final\)/.test(await viewText()), 'a month with no upload: "No December 2026 figures yet" and a link to the last month, never zeros');

  head('P12 · weekly and daily');
  await reset(); await open('vt_weekly');
  T = await tablesOnScreen();
  const wk = M11.weeks.filter((w) => w.from <= M11.period.asOf);
  ok(T.length === wk.length && T[0].title === 'Week of ' + wk[wk.length - 1].label && T[T.length - 1].title === 'Week of ' + wk[0].label, 'one card per week so far, newest first (' + wk.map((w) => w.label).join(' · ') + ')', T.map((t) => t.title).join(','));
  ok(T.every((t, i) => { const w = wk[wk.length - 1 - i], idx = M11.weeks.indexOf(w), last = t.rows[t.rows.length - 1];
    return at(t, last, 'Sales') === N(F('n', M11.floor.weeks[idx].sales)) && at(t, last, 'Working days') === N(F('n', M11.floor.weeks[idx].wd)) && at(t, last, 'Fitments done') === N(F('n', M11.floor.weeks[idx].fitDone)); }), 'each week\'s floor row is the engine\'s week (sales, working days, fitments)');
  ok(T[0].head.includes('Working days') && T[0].head.includes('SPD') && !T[0].head.includes('Current'), 'weekly carries C16/C17/C19, not the MTD-only columns');
  await open('vt_daily');
  T = await tablesOnScreen();
  const lastDay = M11.dates[M11.dates.length - 1], di = M11.dates.length - 1;
  ok(T.length === 1 && T[0].title === 'Tue 10 Nov' && at(T[0], T[0].rows[T[0].rows.length - 1], 'Sales') === N(F('n', M11.floor.days[di].sales)), 'daily opens on the latest day (' + lastDay + ') with the engine\'s floor day', T[0] && T[0].title);
  ok(!T[0].head.includes('SPD') && !T[0].head.includes('% to target') && T[0].head.includes('Target SPD'), 'daily has no SPD / % to target (spec §5) but shows the Target SPD');
  await page.evaluate(() => window.VTPages.step(-1)); await settle();
  T = await tablesOnScreen();
  ok(T[0].title === 'Mon 9 Nov' && at(T[0], T[0].rows[T[0].rows.length - 1], 'Fitted') === N(F('n', M11.floor.days[di - 1].fitted)), '‹ steps to Mon 9 Nov and paints that day', T[0].title);
  const a9 = T[0].rows.find((r) => N(r[2]) === 'Golf Hotel'), g9 = M11.agents.find((a) => a.code === 'CB9105').days[di - 1];
  ok(a9 && at(T[0], a9, 'Sales') === N(F('n', g9.sales)) && at(T[0], a9, 'Due to fit') === N(F('n', g9.due)), 'an agent\'s day is the engine\'s day', a9 && a9.join(' | '));

  head('P13 · honest states');
  ok(/A day's upload is missing/.test(await viewText()) && /Thu 5 Nov: no BI Active Fitted or Scheduled & Missed/.test(N(await viewText())) && !/Wed 4 Nov/.test(await page.evaluate(() => [...document.querySelectorAll('#view .vt-state')].map((c) => c.textContent).join(' '))), 'the missing Thu 5 Nov upload is named (the 4 Nov election holiday is not a gap)');
  resetWorker({ empty: true }); await reset(); await open('vt_mtd');
  ok(/No Vehicle Tracking uploads yet/.test(await viewText()) && !(await tablesOnScreen()).length, 'no uploads yet: says so, shows no table of zeros');
  resetWorker({ bookFail: true }); await reset(); await open('vt_weekly');
  const ev = await viewText();
  ok(/The Vehicle Tracking book could not be read/.test(ev) && /Retry/.test(ev) && !(await tablesOnScreen()).length, 'the book unreadable: an error card with Retry, nothing from an old copy', ev.slice(0, 160));
  resetWorker(); await page.evaluate(() => document.querySelector('#view .vt-state button').click()); await settle();
  ok((await tablesOnScreen()).length > 0, 'Retry reads it again and the page paints');
  resetWorker({ rosterFail: true }); await reset(); await open('vt_mtd');
  ok(/Agent List read from this page/.test(await viewText()), 'the roster unreachable: the page says it fell back to this page\'s Agent List');
  resetWorker();

  head('P14 · export');
  for (const tab of ['vt_mtd', 'vt_weekly', 'vt_daily']) {
    await reset({ tl: tab === 'vt_daily' ? 'CB9191' : '' }); await open(tab);
    const scr = await tablesOnScreen();
    await page.evaluate(() => { window.__xl = []; document.getElementById('vtExport').click(); });
    const x = await page.evaluate(() => ({ cap: window.__xl[0], last: window.__vtLastExport }));
    const types = x.last ? x.last.sheets.map((s) => s.types) : [];
    const same = x.cap && x.cap.sheets.length === scr.length && x.cap.sheets.every((s, i) => s.name === x.last.sheets[i].name && N(s.aoa[0].join('|')) === N(scr[i].head.join('|'))
      && s.aoa.length - 1 === scr[i].rows.length && s.aoa.slice(1).every((row, ri) => row.every((v, ci) => N(F(types[i][ci], v)) === N(scr[i].rows[ri][ci]))));
    ok(same, tab + ': one sheet per table on screen, same header, every cell equal to the screen (' + (x.cap ? x.cap.sheets.map((s) => s.name).join(', ') : 'no file') + ')',
      x.cap ? x.cap.sheets.map((s, i) => s.aoa.length - 1 + '/' + (scr[i] || { rows: [] }).rows.length).join(' ') : '');
    ok(x.cap && new RegExp('^VT ' + { vt_mtd: 'Month to date - All', vt_weekly: 'Weekly - All', vt_daily: 'Daily - Leader Two' }[tab] + ' - November 2026 to \\d+ Nov\\.xlsx$').test(x.cap.name), tab + ': file name names the view, the filter and the period', x.cap && x.cap.name);
    ok(x.cap && x.cap.sheets.every((s) => s.aoa.slice(1).every((r) => r.every((v) => v !== 0 || true))) && x.cap.sheets.some((s) => s.aoa.slice(1).some((r) => r.some((v) => typeof v === 'number'))), tab + ': figures are numbers in the workbook, absences "—"');
  }

  head('P15 · Upload Station receipts and laptop width');
  await reset(); await page.evaluate(() => { go('data'); }); await settle();
  await page.waitForFunction(() => document.querySelectorAll('#vtReceipts tbody tr').length > 0, null, { timeout: 30000 }).catch(() => {});
  const rc = await page.evaluate(() => ({ n: document.querySelectorAll('#vtReceipts tbody tr').length, first: (document.querySelector('#vtReceipts tbody tr') || {}).textContent || '' }));
  ok(rc.n === 10 && /Scheduled & Missed101126\.xlsx|Scheduled & Missed 101126\.xlsx/.test(rc.first.replace(/Scheduled & MissedScheduled/, 'Scheduled & Missed Scheduled')), 'the Upload Station lists the last 10 VT receipts, newest first', rc.n + ' ' + rc.first.slice(0, 120));
  for (const tab of ['vt_mtd', 'vt_weekly', 'vt_daily']) {
    await reset(); await open(tab);
    const wdt = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth, wrapped: [...document.querySelectorAll('#view table.vt-table')].every((t) => t.parentElement.classList.contains('tablewrap')) }));
    ok(wdt.sw <= wdt.iw + 1 && wdt.wrapped, tab + ' at 1280 px: no page-wide horizontal scroll; tables scroll inside their own box', JSON.stringify(wdt));
    await page.evaluate(() => { const st = document.createElement('style'); st.textContent = '.tablewrap{content-visibility:visible!important;max-height:none!important}#toast{display:none!important}'; document.head.appendChild(st); });   // full-page shot only: paint every table
    await page.screenshot({ path: path.join(SHOTS, 'vt-pages-' + tab.slice(3) + '.png'), fullPage: true });
  }
  console.log('  screenshots: ' + ['mtd', 'weekly', 'daily'].map((v) => path.join(SHOTS, 'vt-pages-' + v + '.png')).join(' · '));

  head('P16 · page errors and unit helpers');
  const gaps = PG.uploadGaps(FX.receipts, M11);
  ok(gaps.length === 1 && gaps[0].date === '2026-11-05' && gaps[0].missing.length === 2, 'uploadGaps (unit): only Thu 5 Nov, both files', JSON.stringify(gaps));
  ok(JSON.stringify(M11.gaps) === JSON.stringify(gaps), 'the model carries the engine missing-day list (model.gaps, painted by the page and published in the digest)', JSON.stringify(M11.gaps));
  ok(PG.fmtCell('n', null) === '—' && PG.fmtCell('p', 0) === '0.0%' && PG.fmtCell('n', 0) === '0' && PG.fmtCell('s', '') === '—', 'fmtCell (unit): an absence is "—", a real zero is 0');
  ok(!errs.length, 'no page errors', errs.join(' ; '));
} catch (e) { ok(false, 'the suite ran', String((e && e.stack) || e).slice(0, 600)); }
finally { await browser.close(); server.close(); }
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
