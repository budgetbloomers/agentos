#!/usr/bin/env node
/**
 * verify-tab-guard.mjs — a VAS page an account is not granted never renders (2026-10-26).
 *
 *   node nicks_code/diagnostics/verify-tab-guard.mjs
 *
 * Nick: "remove the access to adjustments for ashton". app_users.tabs.vas went from ['*'] to every page but
 * 'adjust'. auth-gate hides the nav item, but the page itself still opened from a saved per-person view (S.ui.tab)
 * or a go() call. Runs the REAL PULSE page headlessly with synthetic users (no cloud, no real account).
 */
import fs from 'node:fs'; import path from 'node:path'; import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const PULSE_HTML = path.join(ROOT, 'nicks_code', 'index.html');
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (d ? ' — ' + d : '')); } };
const J = JSON.stringify;

const srv = http.createServer((q, r) => { const u = q.url.split('?')[0];
  if (u === '/vt-engine.js' || u === '/vt-pages.js' || u === '/vt-publish.js' || u === '/vt-app.js') { r.writeHead(200, { 'Content-Type': 'text/javascript' }); fs.createReadStream(path.join(ROOT, 'nicks_code', u.slice(1))).pipe(r); return; }   // the source page's companions (spec 071)
  if (u !== '/' && u !== '/index.html') { r.writeHead(404); r.end(); return; }
  r.writeHead(200, { 'Content-Type': 'text/html' }); fs.createReadStream(PULSE_HTML).pipe(r); });
await new Promise((res) => srv.listen(8306, '127.0.0.1', res));
const { chromium } = await import(pathToFileURL(path.join(HERE, 'node_modules', 'playwright', 'index.mjs')).href);
const b = await chromium.launch();
try {
  const page = await b.newPage();
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  const errs = []; page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
  await page.goto('http://127.0.0.1:8306/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__mtd && window.__mtd.state(), null, { timeout: 30000 });
  const R = await page.evaluate(async () => {
    const S = window.__mtd.state(); window.__cloudPush = function () {};
    const paint = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 0))));
    const NO_ADJ = ['dashboard', 'mtd', 'weekly', 'daily', 'attend', 'variance', 'leads', 'agents', 'leaderboard', 'coaching', 'manual', 'data', 'hubs', 'settings'];
    const as = async (user, tab, how) => {
      window.CBX_USER = user; S.ui.tab = tab;
      if (how === 'go') go(tab); else if (how === 'authed') document.dispatchEvent(new CustomEvent('cbx-authed', { detail: user })); else renderPage();
      await paint(); await new Promise((r) => setTimeout(r, 50)); await paint();
      return { tab: S.ui.tab, vt: !!(window.VTApp && window.VTApp.on()), head: (document.querySelector('#view .page-head h2') || {}).textContent || '' };
    };
    const out = {};
    out.viewerSaved = await as({ role: 'viewer', tabs: { vas: NO_ADJ } }, 'adjust', 'render');
    out.viewerGo = await as({ role: 'viewer', tabs: { vas: NO_ADJ } }, 'adjust', 'go');
    out.viewerAuthed = await as({ role: 'viewer', tabs: { vas: NO_ADJ } }, 'adjust', 'authed');
    out.viewerOther = await as({ role: 'viewer', tabs: { vas: NO_ADJ } }, 'mtd', 'go');
    out.star = await as({ role: 'viewer', tabs: { vas: ['*'] } }, 'adjust', 'go');
    out.admin = await as({ role: 'admin', tabs: {} }, 'adjust', 'go');
    out.dataOnly = await as({ role: 'viewer', tabs: { vas: ['data'] } }, 'dashboard', 'render');
    /* spec 071 Phase D: the Vehicle Tracking pages are VAS tabs like any other — vt_mtd, vt_weekly, vt_daily. Since 2026-11-24
       they open Vehicle Tracking, its own app in the switcher (VT mode, vt-app.js); the Upload Station belongs to both apps. */
    out.vtNone = await as({ role: 'viewer', tabs: { vas: NO_ADJ } }, 'vt_mtd', 'go');
    out.vtNoneNoStation = await as({ role: 'viewer', tabs: { vas: ['dashboard', 'mtd'] } }, 'vt_mtd', 'go');
    out.vtWeekly = await as({ role: 'viewer', tabs: { vas: ['vt_mtd', 'vt_daily'] } }, 'vt_weekly', 'render');
    out.vtOwn = await as({ role: 'viewer', tabs: { vas: ['vt_mtd', 'vt_weekly', 'vt_daily'] } }, 'vt_daily', 'go');
    window.CBX_USER = undefined; out.anon = await as(undefined, 'adjust', 'render');
    return out;
  });
  ok('a saved view on a page not granted opens the first granted page instead', R.viewerSaved.tab === 'dashboard' && !/Adjustments/.test(R.viewerSaved.head), J(R.viewerSaved));
  ok('go() to a page not granted does not open it', R.viewerGo.tab === 'dashboard' && !/Adjustments/.test(R.viewerGo.head), J(R.viewerGo));
  ok('sign-in resolving onto a page not granted moves off it', R.viewerAuthed.tab === 'dashboard', J(R.viewerAuthed));
  ok('a granted page still opens', R.viewerOther.tab === 'mtd', J(R.viewerOther));
  ok('vas:["*"] still opens Adjustments', R.star.tab === 'adjust' && /Adjustments/.test(R.star.head), J(R.star));
  ok('an admin still opens Adjustments', R.admin.tab === 'adjust', J(R.admin));
  ok('an Upload-Station-only account lands on the Upload Station, not the dashboard', R.dataOnly.tab === 'data', J(R.dataOnly));
  ok('before sign-in resolves nothing is decided (the gate overlay covers the page)', R.anon.tab === 'adjust', J(R.anon));
  ok('VT: an account without the VT tabs does not open vt_mtd (an uploader lands on the Upload Station, inside Vehicle Tracking)', R.vtNone.tab === 'data' && R.vtNone.vt && !/Vehicle Tracking —/.test(R.vtNone.head), J(R.vtNone));
  ok('VT: without the VT tabs or the Upload Station it stays in VAS, on its first granted page', R.vtNoneNoStation.tab === 'dashboard' && !R.vtNoneNoStation.vt && !/Vehicle Tracking/.test(R.vtNoneNoStation.head), J(R.vtNoneNoStation));
  ok('VT: holding vt_mtd + vt_daily, a saved vt_weekly view moves to the first granted page', R.vtWeekly.tab === 'vt_mtd', J(R.vtWeekly));
  ok('VT: holding the three VT tabs opens VT Daily, in VT mode', R.vtOwn.tab === 'vt_daily' && R.vtOwn.vt && /Vehicle Tracking/.test(R.vtOwn.head), J(R.vtOwn));
  ok('VT: a VAS page again leaves VT mode', !R.anon.vt, J(R.anon));
  ok('no page errors', errs.length === 0, errs.join(' | '));
} finally { await b.close(); srv.close(); }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
