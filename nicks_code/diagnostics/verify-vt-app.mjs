#!/usr/bin/env node
/* verify-vt-app.mjs — VEHICLE TRACKING IS ITS OWN ENTRY IN THE APP SWITCHER (Spec Kit 071, 2026-11-24).
 *
 * The owner: "where is the drop down for me to access the vehicles tracking". Vehicle Tracking now sits in the switcher
 * beside Ops Analytics and VAS Analytics, and opens PULSE in VT mode (/pulse/?app=vt, nicks_code/vt-app.js). This runs the
 * BUILT site (site/index.html Ops, site/pulse/index.html PULSE, site/auth-gate.js — the real sign-in gate) in a real
 * Chromium. The Worker is a stub inside the test: synthetic accounts, the fictional VT floor of vt-digest-fixture.mjs.
 *   A1  pure helpers: the address ⇄ mode, the sidebar of each mode from the one NAV, who sees the entry
 *   A2  auth-gate's vtEntryOk (the Ops switcher) agrees with PULSE's rule for every synthetic account
 *   A3  the entry is in BOTH switchers for a granted account, and in neither for an ungranted one
 *   A4  VAS mode has no VT group (the VT ids stay in NAV for the audit); VT mode shows only VT nav + Upload Station + Apps
 *   A5  picking it: ?app=vt, "Vehicle Tracking" selected, the title, Month to Date first, VAS chrome stood down
 *   A6  reload keeps the mode and the page; Back returns to VAS, Forward to VT
 *   A7  deep links: ?app=vt&page=weekly, and a VAS address naming a VT page (?page=vt_daily) lands in VT mode
 *   A8  the Upload Station: in the VT sidebar for an uploader (and it stays VT mode), absent for a reader
 *   A9  no access: an account without VT typing ?app=vt lands on its first VAS page, told why — never a blank screen
 *   A10 the sign-in form on a VT address lands in VT mode on that page
 *   A11 file:// still opens VT mode and switches in place
 *   A12 screenshots (fictional data): vt-switcher-open.png, vt-app-mtd.png, vas-sidebar-after.png in scratch/vt/
 *
 *   node nicks_code/diagnostics/verify-vt-app.mjs [--no-build]
 */
import fs from 'node:fs'; import path from 'node:path'; import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { vtSource, installVtRoutes } from './vt-tab-source.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url)); const ROOT = path.resolve(HERE, '..', '..');
const require = createRequire(import.meta.url);
const { chromium } = await import(pathToFileURL(path.join(HERE, 'node_modules', 'playwright', 'index.mjs')).href);
const APP = require(path.join(ROOT, 'nicks_code', 'vt-app.js'));
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m + (d !== undefined ? ' — ' + String(d).slice(0, 400) : '')); } };
const head = (t) => console.log('\n' + t);
const J = JSON.stringify;
const API = 'https://chatterbox-agentos-api.chatterbox-agentos.workers.dev';
const SHOTS = path.join(HERE, 'scratch', 'vt'); fs.mkdirSync(SHOTS, { recursive: true });
const PORT = 8291, BASE = 'http://127.0.0.1:' + PORT;

/* ---- synthetic accounts (no real account) ---- */
const VT3 = ['vt_mtd', 'vt_weekly', 'vt_daily'];
const USERS = {
  admin: { role: 'admin', username: 'test.admin', apps: ['vas', 'ops'], tabs: {} },
  reader: { role: 'viewer', username: 'test.reader', apps: ['vas', 'ops'], tabs: { vas: ['dashboard', 'mtd'].concat(VT3), ops: ['*'] } },
  uploader: { role: 'viewer', username: 'test.uploader', apps: ['vas', 'ops'], tabs: { vas: ['dashboard', 'data'].concat(VT3), ops: ['*'] } },
  vasOnly: { role: 'viewer', username: 'test.vasonly', apps: ['vas', 'ops'], tabs: { vas: ['dashboard', 'mtd', 'weekly'], ops: ['*'] } },
  star: { role: 'exec', username: 'test.exec', apps: ['vas', 'ops'], tabs: { vas: ['*'], ops: ['*'] } },
  stationOnly: { role: 'viewer', username: 'test.station', apps: ['vas'], tabs: { vas: ['data'] } },
  opsOnly: { role: 'viewer', username: 'test.opsonly', apps: ['ops'], tabs: { ops: ['*'] } },
};
const byToken = Object.fromEntries(Object.values(USERS).map((u) => ['tok-' + u.username, u]));
/* PULSE's own rule, in Node: tabAllowed (nicks_code/index.html) over the VT-mode entry ids */
const tabAllowedFor = (u) => (id) => { if (!u || u.role === 'admin') return true; const t = (u.tabs || {}).vas || []; return t.includes('*') || t.includes(id); };

head('A1 · pure helpers (vt-app.js)');
ok(J(APP.intentOf('?app=vt')) === J({ vt: true, page: null }), '?app=vt is VT mode, no page named');
ok(J(APP.intentOf('?app=vt&page=weekly')) === J({ vt: true, page: 'vt_weekly' }), '?app=vt&page=weekly names vt_weekly');
ok(J(APP.intentOf('?page=vt_daily')) === J({ vt: true, page: 'vt_daily' }), 'a VAS address naming a VT page is VT mode');
ok(J(APP.intentOf('')) === J({ vt: false, page: null }) && J(APP.intentOf('?page=mtd')) === J({ vt: false, page: 'mtd' }), 'no app=vt and a VAS page: VAS mode');
ok(APP.intentOf('?page=<script>').page === null, 'a page parameter that is not an id is ignored');
/* spec 072 Phase C: the VT Report page and its address shorthand */
ok(APP.VT_PAGES[0] === 'vt_report' && APP.VT_PAGES.length === 4, 'vt_report is a VT page and comes first (spec 072 FR-001)', APP.VT_PAGES.join());
ok(APP.intentOf('?app=vt&page=vt_report').page === 'vt_report' && APP.intentOf('?app=vt&page=report').page === 'vt_report',
  'the VT Report is reachable at ?app=vt&page=vt_report and at the ?page=report shorthand');
ok(APP.intentOf('?page=vt_report').vt === true, 'a bare VAS deep link to vt_report still opens Vehicle Tracking');
ok(APP.ENTRY_IDS.indexOf('vt_report') > -1, 'an account granted only vt_report sees the Vehicle Tracking entry');
ok(APP.LANDING === 'vt_mtd', '/pulse/?app=vt still lands on Month to Date — the address keeps the meaning it has had since 071');
ok(APP.searchFor(true, 'vt_mtd', '') === '?app=vt' && APP.searchFor(true, 'vt_weekly', '?x=1') === '?app=vt&page=vt_weekly&x=1', 'the VT address: ?app=vt (the landing page needs no page=), other parameters kept');
ok(APP.searchFor(false, 'mtd', '?app=vt&page=vt_mtd') === '' && APP.searchFor(false, null, '?app=vt&x=1') === '?x=1', 'the VAS address carries no app / page');
ok(APP.modeFor('vt_daily', false) === true && APP.modeFor('mtd', true) === false && APP.modeFor('data', true) === true && APP.modeFor('data', false) === false && APP.modeFor('hubs', true) === true,
  'a VT page is VT, a VAS page is VAS, the Upload Station and Apps stay in the app they were opened in');
const NAVX = [{ lab: 'Analytics', items: [['dashboard'], ['mtd']] }, { lab: 'Vehicle Tracking', app: 'vt', items: [['vt_mtd'], ['vt_weekly'], ['vt_daily']] },
  { lab: 'Operations', items: [['data'], ['adjust']] }, { lab: 'Apps', items: [['hubs']] }, { lab: 'System', items: [['settings']] }];
const ids = (g) => g.map((x) => x.lab + ':' + x.items.map((i) => i[0]).join('+')).join(' | ');
ok(ids(APP.navFor(NAVX, true)) === 'Vehicle Tracking:vt_mtd+vt_weekly+vt_daily | Operations:data | Apps:hubs', 'VT sidebar: the three VT pages, the Upload Station, Apps — nothing else', ids(APP.navFor(NAVX, true)));
ok(ids(APP.navFor(NAVX, false)) === 'Analytics:dashboard+mtd | Operations:data+adjust | Apps:hubs | System:settings', 'VAS sidebar: everything but the VT group', ids(APP.navFor(NAVX, false)));
ok(NAVX[1].items.length === 3, 'navFor never mutates NAV');
const expectEntry = { admin: true, reader: true, uploader: true, vasOnly: false, star: true, stationOnly: true, opsOnly: false };
for (const [k, u] of Object.entries(USERS)) ok(APP.entryAllowed(tabAllowedFor(u)) === expectEntry[k], `entry for ${k}: ${expectEntry[k] ? 'shown' : 'hidden'}`);
ok(APP.entryAllowed(null) === true, 'no user resolved yet (file://, before sign-in): shown, like every other item');

head('A2 · auth-gate mirrors the rule for the Ops switcher');
const GATE = fs.readFileSync(path.join(ROOT, 'site', 'auth-gate.js'), 'utf8');
const fnSrc = (GATE.match(/function vtEntryOk\(u\) \{[\s\S]*?\n  \}/) || [])[0];
ok(!!fnSrc, 'auth-gate.js defines vtEntryOk(u)');
if (fnSrc) {
  const vtEntryOk = new Function(fnSrc + '\nreturn vtEntryOk;')();
  for (const [k, u] of Object.entries(USERS)) ok(vtEntryOk(u) === APP.entryAllowed(tabAllowedFor(u)), `auth-gate and PULSE agree for ${k}`);
}
ok(/option\[data-vt-entry\]/.test(GATE), 'auth-gate removes option[data-vt-entry] for an account without it');
const OPS_SRC = fs.readFileSync(path.join(ROOT, 'Chatterbox_AgentOS_Analytics.html'), 'utf8');
ok(/<option value="pulse\/index\.html\?app=vt" data-vt-entry>Vehicle Tracking<\/option>/.test(OPS_SRC), 'the Ops switcher carries the entry, opening pulse/index.html?app=vt');
const WK = fs.readFileSync(path.join(ROOT, 'worker', 'src', 'rules.mjs'), 'utf8');
ok(/VT_PAGE_TABS/.test(WK) && /export function vtReadAllowed/.test(WK), 'the Worker read rule (vtReadAllowed) is unchanged in shape');

/* ---- the built site ---- */
if (!process.argv.includes('--no-build')) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'prepare-site.js')], { cwd: ROOT, encoding: 'utf8' });
  ok(r.status === 0 && /Build consistency verified/.test(r.stdout), 'the site builds (tools/prepare-site.js)', (r.stderr || r.stdout).slice(-300));
}
const SITE = path.join(ROOT, 'site');
const server = http.createServer((q, s) => {
  let u = decodeURIComponent(q.url.split('?')[0]); if (u.endsWith('/')) u += 'index.html';
  const p = path.join(SITE, u); if (!p.startsWith(SITE) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { s.writeHead(404); s.end(); return; }
  s.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : p.endsWith('.css') ? 'text/css' : 'text/html' }); fs.createReadStream(p).pipe(s);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const src = await vtSource({ live: false });
const browser = await chromium.launch();
const errs = [], kvPosts = [];
const stub = async (page) => {
  page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160))); page.on('dialog', (d) => d.dismiss().catch(() => {}));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());                  // nothing leaves the machine
  await page.route((u) => String(u).startsWith(API + '/'), async (route) => {           // the Worker: sign-in + everything else empty
    const r = route.request(), u = new URL(r.url()), tok = (r.headers().authorization || '').replace(/^Bearer /, '');
    const J2 = (b, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });
    if (u.pathname === '/api/me') return byToken[tok] ? J2({ user: byToken[tok] }) : J2({ error: 'no session' }, 401);
    if (u.pathname === '/api/login-config') return J2({});
    if (u.pathname === '/api/login') { const b = JSON.parse(r.postData() || '{}'); const usr = Object.values(USERS).find((x) => x.username === b.username);
      return usr ? J2({ token: 'tok-' + usr.username, user: usr }) : J2({ error: 'Sign in failed.' }, 401); }
    if (u.pathname === '/api/kv' && r.method() === 'POST') { kvPosts.push(u.searchParams.get('key')); return J2({ ok: true }); }
    return J2({ error: 'not found' }, 404);
  });
  await installVtRoutes(page, src);                                                      // the fictional VT floor (later route wins)
};
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const open = async (who, url) => {
  const page = await ctx.newPage(); await stub(page);
  if (who) await page.addInitScript((t) => { try { if (!sessionStorage.getItem('cbx_token')) sessionStorage.setItem('cbx_token', t); } catch (e) { /* */ } }, 'tok-' + USERS[who].username);
  await page.goto(BASE + url, { waitUntil: 'domcontentloaded' });
  return page;
};
const authed = (page) => page.waitForFunction(() => !!window.CBX_AUTH && !document.getElementById('cbxAuth'), null, { timeout: 60000 });
/* settled: PULSE booted, signed in, and (on a VT page) the VT page painted — the existing settle() pattern, no fixed waits */
const settle = (page) => page.evaluate(async () => {
  const paint = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 0))));
  for (const t0 = Date.now(); Date.now() - t0 < 30000;) { await paint();
    const S = window.__mtd && window.__mtd.state(); if (!S || !window.VTPages) { await new Promise((r) => setTimeout(r, 25)); continue; }
    const st = window.VTPages.state();
    if (!/^vt_/.test(S.ui.tab) || (st.status !== 'loading' && !document.querySelector('#view .vt-loading') && document.querySelector('#view .page-head'))) break;
    await new Promise((r) => setTimeout(r, 25)); }
  await paint(); });
const pulse = async (page) => { await authed(page); await page.waitForFunction(() => window.__mtd && window.__mtd.state() && window.VTApp, null, { timeout: 60000 }); await settle(page); };
const look = (page) => page.evaluate(() => {
  const vis = (el) => !!el && el.offsetParent !== null && getComputedStyle(el).display !== 'none';
  const sel = document.querySelector('aside select[aria-label="Switch app"]');
  const trust = document.getElementById('vasTrust');
  return { tab: window.__mtd.state().ui.tab, vt: window.VTApp.on(), search: location.search, title: document.title,
    options: sel ? [...sel.options].map((o) => o.textContent.trim()) : [], selected: sel ? sel.options[sel.selectedIndex].textContent.trim() : '',
    items: [...document.querySelectorAll('#side [data-page]')].filter(vis).map((b) => b.dataset.page),
    labels: [...document.querySelectorAll('#side [data-page]')].filter(vis).map((b) => b.textContent.trim()),
    groups: [...document.querySelectorAll('#side .navgroup')].filter((g) => [...g.querySelectorAll('[data-page]')].some(vis)).map((g) => g.querySelector('.lab').textContent.trim()),
    h2: (document.querySelector('#view .page-head h2') || {}).textContent || '', viewLen: ((document.getElementById('view') || {}).innerText || '').trim().length,
    filtersOff: document.getElementById('topbar').classList.contains('filters-off'), trustShown: vis(trust),
    navIds: NAV.flatMap((g) => g.items.map((i) => i[0])) };
});
const pick = async (page, label) => { await page.selectOption('aside select[aria-label="Switch app"]', { label }); await settle(page); };

try {
  head('A3 · the entry in both switchers');
  const opsA = await open('admin', '/index.html'); await authed(opsA);
  const opsOpts = async (p) => p.evaluate(() => [...document.querySelectorAll('select[aria-label="Switch app"] option')].map((o) => o.textContent.trim() + '=' + o.value));
  const oa = await opsOpts(opsA);
  ok(oa.join(' | ') === 'Ops Analytics= | VAS Analytics=pulse/index.html | Vehicle Tracking=pulse/index.html?app=vt', 'Ops switcher (admin): Ops / VAS / Vehicle Tracking', oa.join(' | '));
  await opsA.close();
  const opsN = await open('vasOnly', '/index.html'); await authed(opsN);
  const on = await opsOpts(opsN);
  ok(on.length === 2 && !on.some((t) => /Vehicle Tracking/.test(t)), 'Ops switcher (no VT access): no Vehicle Tracking entry', on.join(' | '));
  await opsN.close();

  const pa = await open('admin', '/pulse/'); await pulse(pa);
  let L = await look(pa);
  ok(L.options.join(' | ') === 'Ops Analytics | VAS Analytics | Vehicle Tracking' && L.selected === 'VAS Analytics', 'PULSE switcher (admin): three entries, VAS Analytics selected', J([L.options, L.selected]));
  const pn = await open('vasOnly', '/pulse/'); await pulse(pn);
  const Ln = await look(pn);
  ok(Ln.options.join(' | ') === 'Ops Analytics | VAS Analytics', 'PULSE switcher (no VT access): no Vehicle Tracking entry', Ln.options.join(' | '));
  await pn.close();

  head('A4 · VAS mode has no VT group');
  ok(!L.vt && !L.items.some((i) => /^vt_/.test(i)) && !L.groups.includes('Vehicle Tracking'), 'the VAS sidebar carries no Vehicle Tracking group and no VT page', J(L.groups));
  ok(['dashboard', 'mtd', 'weekly', 'daily', 'data', 'settings'].every((i) => L.items.includes(i)), 'the VAS sidebar keeps its own pages', L.items.join(','));
  ok(VT3.every((i) => L.navIds.includes(i)), 'NAV still lists vt_mtd / vt_weekly / vt_daily (tools/audit-permissions.mjs reads it)');
  await pa.setViewportSize({ width: 1440, height: 1180 });   // the whole VAS sidebar in frame
  await pa.evaluate(() => { const s = document.querySelector('aside select[aria-label="Switch app"]'); s.size = s.options.length; s.style.height = 'auto'; });
  await pa.locator('aside').screenshot({ path: path.join(SHOTS, 'vt-switcher-open.png') });
  await pa.evaluate(() => { const s = document.querySelector('aside select[aria-label="Switch app"]'); s.removeAttribute('size'); s.style.height = ''; });
  await pa.locator('aside').screenshot({ path: path.join(SHOTS, 'vas-sidebar-after.png') });
  await pa.setViewportSize({ width: 1440, height: 900 });

  head('A5 · picking Vehicle Tracking');
  await pick(pa, 'Vehicle Tracking');
  L = await look(pa);
  ok(L.vt && L.search === '?app=vt' && L.tab === 'vt_mtd', 'the address is /pulse/?app=vt and Month to Date opens first', J([L.search, L.tab]));
  ok(L.selected === 'Vehicle Tracking' && /Vehicle Tracking/.test(L.title) && !/VAS/.test(L.title), 'the switcher shows Vehicle Tracking selected; the title reads Vehicle Tracking', J([L.selected, L.title]));
  /* spec 072 Phase C: vt_report (the VT Report dashboard) joined the group as its FIRST item (FR-001) */
  ok(L.items.join(',') === 'vt_report,vt_mtd,vt_weekly,vt_daily,data,hubs', 'the VT sidebar: the four VT pages, the Upload Station, Apps — nothing VAS', L.items.join(','));
  ok(L.items[0] === 'vt_report', 'VT Report is the first item of the group (spec 072 FR-001)', L.items.join(','));
  ok(L.labels.slice(0, 4).join(' | ') === 'VT Report | Month to Date | Weekly Reports | Daily Reports', 'labelled without the "VT" prefix, except the VT Report page the owner names that way', L.labels.join(' | '));
  ok(/^Vehicle Tracking — Month to date/.test(L.h2) && L.viewLen > 40, 'the page is Vehicle Tracking — Month to date, painted', L.h2);
  ok(L.filtersOff && !L.trustShown, 'the VAS header filters and the VAS Data Trust strip stand down', J([L.filtersOff, L.trustShown]));
  await pa.screenshot({ path: path.join(SHOTS, 'vt-app-mtd.png'), fullPage: false });
  await pa.click('#side [data-page="hubs"]'); await settle(pa); L = await look(pa);
  ok(L.vt && L.tab === 'hubs' && L.search === '?app=vt&page=hubs' && L.filtersOff, 'the Apps page opens inside Vehicle Tracking (the VAS filters stay down)', J([L.vt, L.search, L.filtersOff]));

  head('A6 · reload, back and forward');
  await pa.click('#side [data-page="vt_weekly"]'); await settle(pa); L = await look(pa);
  ok(L.search === '?app=vt&page=vt_weekly' && L.tab === 'vt_weekly', 'opening Weekly keeps the address in step', L.search);
  await pa.reload({ waitUntil: 'domcontentloaded' }); await pulse(pa); L = await look(pa);
  ok(L.vt && L.tab === 'vt_weekly' && L.selected === 'Vehicle Tracking' && L.items[0] === 'vt_report', 'a reload keeps VT mode and the page', J([L.vt, L.tab, L.selected]));
  await pick(pa, 'VAS Analytics'); L = await look(pa);
  ok(!L.vt && L.search === '' && L.selected === 'VAS Analytics' && !L.items.some((i) => /^vt_/.test(i)) && !/^vt_/.test(L.tab), 'picking VAS Analytics returns to VAS (its own page, no VT group)', J([L.search, L.tab]));
  await pa.evaluate(() => history.back());
  await pa.waitForFunction(() => window.VTApp.on(), null, { timeout: 15000 }).catch(() => {}); await settle(pa); L = await look(pa);
  ok(L.vt && L.selected === 'Vehicle Tracking' && /^vt_/.test(L.tab), 'Back returns to Vehicle Tracking', J([L.vt, L.tab, L.search]));
  await pa.evaluate(() => history.forward());
  await pa.waitForFunction(() => !window.VTApp.on(), null, { timeout: 15000 }).catch(() => {}); await settle(pa); L = await look(pa);
  ok(!L.vt && L.selected === 'VAS Analytics', 'Forward returns to VAS Analytics', J([L.vt, L.tab]));

  head('A7 · deep links');
  await pa.evaluate(() => go('vt_daily')); await settle(pa); L = await look(pa);
  ok(L.vt && L.tab === 'vt_daily' && L.search === '?app=vt&page=vt_daily', 'in VAS, opening a VT page moves into VT mode (the address follows)', J([L.vt, L.search]));
  await pa.close();
  const pw = await open('admin', '/pulse/?app=vt&page=weekly'); await pulse(pw); L = await look(pw);
  ok(L.vt && L.tab === 'vt_weekly' && L.search === '?app=vt&page=vt_weekly', '/pulse/?app=vt&page=weekly opens VT Weekly', J([L.tab, L.search]));
  await pw.close();
  const pd = await open('admin', '/pulse/?page=vt_daily'); await pulse(pd); L = await look(pd);
  ok(L.vt && L.tab === 'vt_daily' && L.search === '?app=vt&page=vt_daily' && L.selected === 'Vehicle Tracking', 'a VAS deep link to vt_daily redirects into VT mode', J([L.tab, L.search]));
  await pd.close();

  head('A8 · the Upload Station in VT mode');
  const pu = await open('uploader', '/pulse/?app=vt'); await pulse(pu); L = await look(pu);
  ok(L.items.join(',') === 'vt_mtd,vt_weekly,vt_daily,data' && L.options.includes('Vehicle Tracking'), 'an uploader: the VT pages and the Upload Station (Apps is not granted)', L.items.join(','));
  await pu.click('#side [data-page="data"]');
  const slots = await (await pu.waitForFunction(() => { const v = [...document.querySelectorAll('#view .slot[data-vtslot]')]; return v.length ? v.map((c) => c.dataset.vtslot) : false; }, null, { timeout: 30000 })).jsonValue();
  L = await look(pu);
  ok(L.vt && L.tab === 'data' && L.search === '?app=vt&page=data' && slots.join(',') === 'vtBiFitted,vtSchedMissed,vtSchedulers', 'the Upload Station opens inside Vehicle Tracking, with the three VT slots', J([L.vt, L.search, slots]));
  /* 25 Nov 2026: the ten VAS slots used to render FIRST here, with the VT slots below them and the large-file card.
     In the Vehicle Tracking tab the obvious place to drop "BI Active Fitted" was then the VAS "Power BI - Active
     Cases" slot, which refuses it and says "load it in Vehicle Tracking -> Upload Station" - where the owner was.
     VT mode must therefore show NOTHING but its own slots: no VAS slot can take a Vehicle Tracking file. */
  const vtStation = await pu.evaluate(() => ({
    vasSlots: [...document.querySelectorAll('#view .slot[data-slot]')].map((e) => e.dataset.slot),
    vtSlots: [...document.querySelectorAll('#view .slot[data-vtslot]')].map((e) => e.dataset.vtslot),
    heading: (document.querySelector('#view .page-head h2') || {}).textContent || '',
    text: (document.getElementById('view') || document.body).innerText }));
  ok(vtStation.vasSlots.length === 0, 'VT mode shows NO VAS slot at all — nothing that would refuse a VT file', vtStation.vasSlots.join(','));
  ok(/Vehicle Tracking/.test(vtStation.heading), 'and the heading says which station this is', vtStation.heading);
  ok(!/Power BI - Active Cases|ViciDial|QA Evaluations|Lead Management/.test(vtStation.text),
    'and not one VAS slot name is on the page', vtStation.text.slice(0, 120));
  ok(vtStation.vtSlots.length === 3, 'while all three VT slots are there', vtStation.vtSlots.join(','));
  ok(await pu.evaluate(() => typeof window.VTStation.afterCommit === 'function' && !!window.VTPublish), 'the publish hook is wired in VT mode (VTStation.afterCommit → VTPublish)');
  await pu.close();
  const pr = await open('reader', '/pulse/?app=vt'); await pulse(pr); L = await look(pr);
  ok(L.items.join(',') === 'vt_mtd,vt_weekly,vt_daily' && !L.items.includes('data'), 'a reader: the three VT pages, no Upload Station', L.items.join(','));
  await pr.evaluate(() => go('data')); await settle(pr); L = await look(pr);
  ok(L.tab !== 'data', 'a reader cannot open the Upload Station from VT mode either', L.tab);
  await pr.close();

  head('A9 · no access');
  const px = await open('vasOnly', '/pulse/?app=vt'); await pulse(px);
  await px.waitForFunction(() => !window.VTApp.on(), null, { timeout: 15000 }).catch(() => {}); await settle(px);
  await px.waitForFunction(() => ((document.getElementById('view') || {}).innerText || '').trim().length > 20, null, { timeout: 15000 }).catch(() => {}); L = await look(px);
  const toastTxt = await px.evaluate(() => (document.querySelector('.toast, #toast, .toasts') || {}).innerText || '');
  ok(!L.vt && L.tab === 'dashboard' && L.search === '' && L.viewLen > 20, 'an account without VT typing ?app=vt lands on its first VAS page, not a blank screen', J([L.vt, L.tab, L.search, L.viewLen]));
  ok(/no Vehicle Tracking pages/.test(toastTxt), 'and is told why', toastTxt);
  await px.close();

  head('A10 · signing in on a VT address');
  const ps = await open(null, '/pulse/?app=vt&page=vt_daily');
  await ps.waitForSelector('#cbxU', { timeout: 30000 });
  await ps.fill('#cbxU', USERS.reader.username); await ps.fill('#cbxP', 'synthetic-pass'); await ps.click('#cbxGo');
  await pulse(ps); L = await look(ps);
  ok(L.vt && L.tab === 'vt_daily' && L.search === '?app=vt&page=vt_daily' && L.selected === 'Vehicle Tracking', 'after the sign-in form, Vehicle Tracking Daily is open', J([L.vt, L.tab, L.search]));
  await ps.close();

  head('A11 · file://');
  const pf = await ctx.newPage(); await stub(pf);
  await pf.goto(pathToFileURL(path.join(SITE, 'pulse', 'index.html')).href + '?app=vt', { waitUntil: 'domcontentloaded' });
  await pf.waitForFunction(() => window.__mtd && window.__mtd.state() && window.VTApp, null, { timeout: 60000 }); await settle(pf); L = await look(pf);
  ok(L.vt && L.tab === 'vt_mtd' && L.options.includes('Vehicle Tracking'), 'the single-file page from file:// opens in VT mode', J([L.vt, L.tab, L.search]));
  await pick(pf, 'VAS Analytics'); L = await look(pf);
  ok(!L.vt && !L.items.some((i) => /^vt_/.test(i)), 'and switches back to VAS from file://', J([L.vt, L.search]));
  await pf.close();

  ok(fs.existsSync(path.join(SHOTS, 'vt-switcher-open.png')) && fs.existsSync(path.join(SHOTS, 'vt-app-mtd.png')) && fs.existsSync(path.join(SHOTS, 'vas-sidebar-after.png')), 'A12 · the three screenshots are saved in scratch/vt/');
  ok(!kvPosts.some((k) => /^agent-|vas-state/.test(k)), 'nothing VAS was published', kvPosts.join(','));
  ok(!errs.length, 'no page errors', [...new Set(errs)].join(' | '));
} catch (e) { ok(false, 'the suite ran', String((e && e.stack) || e).slice(0, 500)); }
finally { await browser.close(); server.close(); }
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
