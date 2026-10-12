/**
 * VAS ANALYTICS (PULSE) FOR THE DEMO (spec 005, user story 1).
 *
 * Serves the SOURCE page (nicks_code/index.html — the built site/pulse copy adds a stale-version banner), pins the clock
 * to the fictional Tuesday, loads the fictional floor into the real engine (window.__mtd) and captures every page and
 * sub-tab in navigation order. No token is set, so every sync with the Worker is skipped; the few calls the page makes
 * regardless (Coaching Hub summary, an agent's coaching history, Nikola, large uploads) go to `api` — the in-process
 * demo backend — and anything else off this machine is refused (Google Fonts excepted).
 *
 * Returns what Agent Analytics is built from — the agent digest and the two team-leader report payloads, exactly as
 * PULSE would publish them — so both apps show the same figures (FR-005).
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { CLOCK } from './floor.mjs';

/* .tablewrap/.cqcard carry content-visibility:auto (the page skips painting off-screen tables); a capture taken before the
   browser marks a table on-screen shows it BLANK (spec 007: 02-vas-month-to-date-courtesy came out empty) — paint them all */
const PAGE_CSS = `*{animation:none!important;transition:none!important;caret-color:transparent!important}
#toast,#cbxUnsaved,#cbxHealth,#cbxStale{display:none!important}
.tablewrap,.cqcard{content-visibility:visible!important}`;

/* the walk, in navigation order (research R1). Each step: [file name, what to do before the shot] */
const STEPS = [
  ['dashboard', (m) => m.go('dashboard')],
  ['month-to-date-courtesy', (m, S) => { S.ui.mtdSub = 'Courtesy'; m.go('mtd'); }],
  ['month-to-date-cuddle', (m, S) => { S.ui.mtdSub = 'Cuddle'; m.go('mtd'); }],
  ['month-to-date-nesting', (m, S) => { S.ui.mtdSub = 'Nesting'; m.go('mtd'); }],
  ['month-to-date-team-leaders', (m, S) => { S.ui.mtdSub = 'Team Leaders'; m.go('mtd'); }],
  ['weekly-courtesy', (m, S) => { S.ui.wtdCamp = 'Courtesy'; m.go('weekly'); }],
  ['weekly-cuddle', (m, S) => { S.ui.wtdCamp = 'Cuddle'; m.go('weekly'); }],
  ['weekly-nesting', (m, S) => { S.ui.wtdCamp = 'Nesting'; m.go('weekly'); }],
  ['daily', (m, S) => { S.ui.dailyFilter = { date: '2026-09-28', tl: '', q: '' }; m.go('daily'); }],
  ['workforce-attendance', (m) => m.go('attend')],
  ['variance-summary', (m, S) => { S.ui.varSub = 'summary'; m.go('variance'); }],
  ['variance-daily', (m, S) => { S.ui.varSub = 'daily'; m.go('variance'); }],
  ['variance-unmapped', (m, S) => { S.ui.varSub = 'unmapped'; m.go('variance'); }],
  ['variance-rules', (m, S) => { S.ui.varSub = 'rules'; m.go('variance'); }],
  ['lead-management', (m) => m.go('leads')],
  ['agent-performance', (m, S) => { S.ui.risk = ''; S.ui.agentQ = ''; m.go('agents'); }],
  ['agent-profile-drawer', (m) => { m.go('agents'); m.openDrawer('CB9101'); }],
  ['leaderboard-gwp', (m, S) => { if (window.closeDrawer) window.closeDrawer(); const dr = document.getElementById('drawer'); if (dr) dr.innerHTML = '';
    S.ui.lbMetric = 'gwp'; m.go('leaderboard'); }],
  ['leaderboard-qa', (m, S) => { S.ui.lbMetric = 'qa'; m.go('leaderboard'); }],
  ['coaching', (m) => m.go('coaching')],
  ['manual', (m) => m.go('manual')],
  ['upload-station', (m) => m.go('data')],
  ['adjustments', (m) => m.go('adjust')],
  /* spec 007: this demo page's own copy of HUBS loses the Wimpy card (FR-001) and the KPI/Coaching Hub previews — they
     are pictures of the real hubs with real team-leader names (FR-003). The product's Apps page is unchanged (FR-002). */
  ['apps', (m) => {
    for (let i = HUBS.length - 1; i >= 0; i--) {
      if (/wimpy/i.test(HUBS[i].name)) HUBS.splice(i, 1);
      else if (/hub$/i.test(HUBS[i].name)) HUBS[i] = Object.assign({}, HUBS[i], { shot: '' });
    }
    m.go('hubs');
  }],
  ['settings', (m) => m.go('settings')],
];

function serve(root) {
  const SERVE = { '/': path.join(root, 'nicks_code', 'index.html'), '/index.html': path.join(root, 'nicks_code', 'index.html'),
    '/xlsx.full.min.js': path.join(root, 'site', 'xlsx.full.min.js') };
  const server = http.createServer((q, s) => {
    const p = SERVE[q.url.split('?')[0]];
    if (!p || !fs.existsSync(p)) { s.writeHead(404); s.end(); return; }
    s.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' });
    fs.createReadStream(p).pipe(s);
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}
const settle = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 250)))));

/**
 * @param {object} o  browser (Playwright), root (repo), floor ({state, boardRows}), shot(page, name) → saves + checks, api(route) → answers the Worker host
 */
export async function shootVas({ browser, root, floor, shot, ready }) {
  let api = null;           // set once the floor is loaded: the backend needs the digest this page builds
  const server = await serve(root);
  const base = 'http://127.0.0.1:' + server.address().port;
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.clock.setFixedTime(new Date(CLOCK));
  await page.addInitScript(() => { try { localStorage.setItem('cbx_theme', 'light'); } catch (e) {} });
  await page.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith(base) || /^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(u)) return route.continue();
    if (/chatterbox-agentos-api\.chatterbox-agentos\.workers\.dev/.test(u) && api) return api(route);
    return route.abort();
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  try {
    await page.goto(base + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__mtd && window.__mtd.state(), null, { timeout: 60000 });
    await page.addStyleTag({ content: PAGE_CSS });
    await page.evaluate(({ state, boardRows }) => {
      const S = window.__mtd.state();
      window.__cloudPush = function () {};
      if (window.Chart && window.Chart.defaults) window.Chart.defaults.animation = false;
      for (const k of Object.keys(state)) S[k] = state[k];
      S.board = {};
      for (const d of Object.keys(boardRows)) { const day = {}; for (const r of boardRows[d]) day[normName(r.name)] = r; S.board[d] = day; }
      S.orgHist = {};
      for (const a of S.roster) recordOrgList(a.code, '2026-08-01', { campaign: a.campaign, tl: a.tl, tenure: a.tenure });
      S.ui.team = ''; S.ui.camp = ''; S.ui.dailyFilter = {};
      window.__mtd.rebuild();
      window.__mtd.setPeriod('2026-09', 'month');
    }, floor);
    await page.evaluate(() => document.fonts && document.fonts.ready);
    /* the Data Trust bar redraws itself every 10 s; it also learns the coaching copy's age only when signed in — give it
       the copy's time and redraw now (toggle open and shut) so the first shot is not taken on the pre-floor bar */
    await page.evaluate(() => { window.__coachMetaAt = '2026-09-29T05:40:00Z'; if (window.__vasTrustToggle) { window.__vasTrustToggle(); window.__vasTrustToggle(); } });
    const published = await page.evaluate(() => ({
      digest: JSON.parse(JSON.stringify(window.__mtd.digest())),
      variance: JSON.parse(JSON.stringify(window.__mtd.reports('variance'))),
      leads: JSON.parse(JSON.stringify(window.__mtd.reports('leads'))),
    }));
    if (ready) api = await ready(published);
    for (const [name, act] of STEPS) {
      const before = errors.length;
      await page.evaluate((src) => { const m = window.__mtd, S = m.state(); (0, eval)('(' + src + ')')(m, S); }, act.toString());
      await settle(page);
      await shot(page, 'vas-' + name, errors.slice(before));
    }
    return published;
  } finally {
    await ctx.close();
    server.close();
  }
}
