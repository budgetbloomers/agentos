#!/usr/bin/env node
/**
 * verify-upload-station-layout.mjs — the Upload Station keeps its tidy shape (2026-10-01).
 *
 *   node nicks_code/diagnostics/verify-upload-station-layout.mjs
 *
 * Nick's screenshot of the live page: the sticky report filter bar (search, period, as-at, campaign,
 * team, Export report) sat over the first lines of every slot card; cards were uneven with long help
 * paragraphs; "Choose file" wrapped onto two lines; every footer was in a different order. None of the
 * header filters applies to an upload, so the bar stands down on this one page.
 *
 * Runs PULSE from source, headless, over a SYNTHETIC state (fake CBs, no cloud — every request off
 * 127.0.0.1 is aborted), at 1024 / 1280 / 1440 px and in both themes:
 *   A. the filter bar is off the Upload Station and never overlaps a card; every other page keeps it;
 *      a phone keeps the menu button alone (it is the only way to open the off-canvas sidebar)
 *   B. every slot card has the one shape: header (title + Choose file on one line), clamped help text,
 *      ONE footer at the bottom — facts, last upload, any warning, the status chip on the bottom line
 *   C. each grid row is one height; nothing overflows a card or the page
 *   D. the help text toggles — click and keyboard — without opening the file picker, and "More" is
 *      shown only where the clamp hides text; Enter on the card still picks a file
 */
import fs from 'node:fs'; import path from 'node:path'; import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const PULSE_HTML = process.env.PULSE_HTML ? path.resolve(process.env.PULSE_HTML) : path.join(ROOT, 'nicks_code', 'index.html');
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (d ? ' — ' + d : '')); } };
const J = JSON.stringify;

const SIDE = { '/xlsx.full.min.js': path.join(ROOT, 'site', 'xlsx.full.min.js') };
const srv = await new Promise((res) => { const s = http.createServer((q, r) => { const u = q.url.split('?')[0];
  const p = SIDE[u] || ((u === '/' || u === '/index.html') ? PULSE_HTML : null);
  if (!p || !fs.existsSync(p)) { r.writeHead(404); r.end(); return; }
  r.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' }); fs.createReadStream(p).pipe(r); });
  s.listen(8293, '127.0.0.1', () => res(s)); });
const { chromium } = await import(pathToFileURL(path.join(HERE, 'node_modules', 'playwright', 'index.mjs')).href);

/* a filled station: every slot has files, the Agent List has an effect, referrals are synced, and the
   newest attendance upload carries the warning attUploadReport writes */
const fill = () => {
  const S = window.__mtd.state(); window.__cloudPush = function () {};
  const days = (from, to) => { const o = []; for (let d = new Date(from + 'T00:00:00Z'); d <= new Date(to + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) if (d.getUTCDay() !== 0) o.push(d.toISOString().slice(0, 10)); return o; };
  const AG = Array.from({ length: 30 }, (_, i) => 'CB99' + String(i + 1).padStart(2, '0'));
  S.roster = AG.map((c, i) => ({ code: c, name: 'Test Person ' + c.slice(2), sf: 'Test Person ' + c.slice(2), tl: ['Leader Alpha', 'Leader Beta'][i % 2], campaign: i % 2 ? 'Cuddle' : 'Courtesy', tenure: 'Exp', target: 5, start: '2026-01-01' }));
  S.leavers = { CB9990: { left: new Date().toISOString().slice(0, 8) + '01' } };
  S.rosterEffect = { asOf: '2026-09-29', file: 'Agent List test.xlsx', moved: 1, fresh: 2, left: 1, at: '2026-09-29 08:14' };
  const sep = days('2026-09-01', '2026-09-29');
  S.sales = {}; S.calls = {}; S.att = {}; S.evals = {};
  for (const d of sep) { S.sales[d] = {}; S.calls[d] = {}; S.evals[d] = {}; }
  for (const d of days('2026-09-01', '2026-09-18')) { S.att[d] = {}; for (const c of AG) S.att[d][c] = 'P'; }
  const f = (name, type, ds, rows, at, extra) => Object.assign({ name, type, dates: ds, rows, at, hash: 'h-' + name }, extra || {});
  S.files = [
    f('bi test.xlsx', 'bi', sep, 900, '2026-09-30 06:12:00'),
    f('attendance_test_to_2026-09-30.csv', 'attendance', days('2026-08-01', '2026-09-18'), 9000, '2026-09-30 06:20:00',
      { warn: '"attendance_test_to_2026-09-30.csv": it runs to 2026-09-30 but the register stops at 2026-09-18: the 7 working days after it carry only 12 rows filed ahead. HR has not captured 2026-09-21 → 2026-09-30 yet — ask for the register to be completed and re-export.', warnSev: 'warn' }),
    f('evals test.csv', 'evals', sep.slice(-20), 300, '2026-09-29 15:02:00'),
    f('inactive test.xlsx', 'cancellations', sep, 90, '2026-09-29 09:40:00'),
    f('vici test.txt', 'calls (ViciDial)', sep, 40000, '2026-09-30 07:55:00'),
    f('board test.xlsx', 'board', sep.slice(-12), 400, '2026-09-29 18:05:00'),
    f('open lm test.csv', 'open cases (lead mgmt)', ['2026-09-29'], 2800, '2026-09-29 10:11:00'),
    f('closed test.xls', 'closed cases', sep.slice(-15), 6000, '2026-09-29 10:13:00'),
  ];
  S.refs = { by: Object.fromEntries(AG.slice(0, 20).map((c) => [c, 2])), total: 40, f: 'HighLevel API', un: { 'Nobody Known': 1 } };
  S.ui.tab = 'data'; renderAll();
};
const paint = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 60)))));
async function open(b, width, theme) {
  const page = await b.newPage({ viewport: { width, height: 900 } });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());   // never the Worker, never the cloud
  await page.addInitScript((t) => { try { localStorage.setItem('cbx_theme', t); } catch (e) {} }, theme);
  page.__errs = []; page.on('pageerror', (e) => page.__errs.push(String(e.message).slice(0, 160)));
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  await page.goto('http://127.0.0.1:8293/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__mtd && window.__mtd.state(), null, { timeout: 30000 });
  await page.evaluate(fill); await paint(page);
  await page.evaluate(() => document.fonts && document.fonts.ready); await paint(page);
  return page;
}
/* everything the layout checks need, measured in one pass */
const measure = (page) => page.evaluate(() => {
  const r = (el) => { const x = el.getBoundingClientRect(); return { t: Math.round(x.top), b: Math.round(x.bottom), l: Math.round(x.left), h: Math.round(x.height), w: Math.round(x.width) }; };
  const bar = document.getElementById('topbar'); const bcs = getComputedStyle(bar);
  const cards = [...document.querySelectorAll('.slot[data-slot]')].map((c) => {
    const head = c.querySelector('.shead'), pick = c.querySelector('.shead .spick'), desc = c.querySelector('.sdesc'), more = c.querySelector('.sdesc-more'), foot = c.querySelector('.sfoot');
    const rows = foot ? [...foot.children].map((x) => x.className) : [];
    const status = c.querySelector('.sfoot > .sf-status');
    const cs = getComputedStyle(c);
    return { t: c.dataset.slot, box: r(c), padB: parseFloat(cs.paddingBottom), bg: cs.backgroundColor,
      over: c.scrollWidth > c.clientWidth + 1,
      head: !!head, pickText: pick ? pick.innerText.trim() : null, pickBox: pick ? r(pick) : null, pickNowrap: pick ? getComputedStyle(pick).whiteSpace === 'nowrap' : false,
      headBox: head ? r(head) : null,
      desc: !!desc, descH: desc ? desc.clientHeight : 0, descFull: desc ? desc.scrollHeight : 0, descLine: desc ? parseFloat(getComputedStyle(desc).lineHeight) : 0, descOpen: desc ? desc.classList.contains('open') : false,
      more: !!more, moreHidden: more ? more.hidden : null, moreExpanded: more ? more.getAttribute('aria-expanded') : null, moreControls: more ? more.getAttribute('aria-controls') === (desc && desc.id) : false,
      foot: !!foot, footLast: foot ? c.lastElementChild === foot : false, footBox: foot ? r(foot) : null, rows,
      facts: (c.querySelector('.sfoot > .sf-facts') || {}).innerText || '',
      last: (c.querySelector('.sfoot > .sf-last') || {}).innerText || '',
      statusText: status ? status.innerText : '', statusLast: status ? foot.lastElementChild === status : null,
      statusBox: status ? r(status) : null,
      warn: !!c.querySelector('.sfoot .att-upload-warn'), sync: !!c.querySelector('.sfoot > .sf-status .sf-sync') };
  });
  return { bar: { display: bcs.display, position: bcs.position, box: r(bar), cls: bar.className }, cards,
    pageOver: document.documentElement.scrollWidth > window.innerWidth + 1,
    cols: getComputedStyle(document.querySelector('.slots')).gridTemplateColumns.split(' ').length,
    theme: document.documentElement.dataset.theme };
});
const rowsOf = (cards) => { const g = {}; for (const c of cards) (g[c.box.t] = g[c.box.t] || []).push(c); return Object.values(g); };

const b = await chromium.launch();
try {
  /* ------------------------------------------------------------------ A ---- */
  console.log('\nA · THE FILTER BAR STANDS DOWN ON THE UPLOAD STATION — AND ONLY THERE');
  {
    const page = await open(b, 1280, 'light');
    const m = await measure(page);
    ok('Upload Station: the filter bar is hidden (display none)', m.bar.display === 'none', J(m.bar));
    await page.evaluate(() => window.scrollTo(0, 320)); await paint(page);
    const cover = await page.evaluate(() => {   // whatever sits at the top-centre of each card in view is that card, never the bar
      const out = []; for (const c of document.querySelectorAll('.slot[data-slot]')) { const x = c.getBoundingClientRect();
        if (x.top < 4 || x.top > innerHeight - 30) continue; const el = document.elementFromPoint(x.left + x.width / 2, x.top + 18);
        out.push({ t: c.dataset.slot, mine: !!(el && c.contains(el)), by: el ? (el.closest('header') ? 'header' : el.className || el.tagName) : null }); }
      const bar = document.getElementById('topbar').getBoundingClientRect();
      const hit = [...document.querySelectorAll('.slot[data-slot]')].some((c) => { const x = c.getBoundingClientRect(); return bar.height > 0 && x.top < bar.bottom && x.bottom > bar.top; });
      return { out, hit }; });
    ok('scrolled: no card is covered by the bar (top of every card in view is the card itself)', cover.out.length > 0 && cover.out.every((x) => x.mine) && !cover.hit, J(cover));
    const ctl = await page.evaluate(() => ['gsearch', 'pPreset', 'fCampG', 'fTeamG', 'btnExportAll'].map((id) => { const el = document.getElementById(id); return { id, there: !!el, shown: !!(el && el.offsetParent) }; }));
    ok('the filter controls still exist (nothing removed) but none is shown on the Upload Station', ctl.every((c) => c.there && !c.shown), J(ctl));
    for (const tab of ['dashboard', 'mtd', 'daily', 'adjust']) {
      const t = await page.evaluate(async (tab) => { go(tab); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 60))));
        const bar = document.getElementById('topbar'); const cs = getComputedStyle(bar);
        return { display: cs.display, position: cs.position, off: bar.classList.contains('filters-off'),
          shown: ['pPreset', 'fCampG', 'fTeamG', 'btnExportAll'].every((id) => { const el = document.getElementById(id); return !!(el && el.offsetParent); }) }; }, tab);
      ok(tab + ': keeps the sticky filter bar exactly as before', t.display === 'flex' && t.position === 'sticky' && !t.off && t.shown, J(t));
    }
    const back = await page.evaluate(async () => { go('data'); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 60)))); return getComputedStyle(document.getElementById('topbar')).display; });
    ok('back on the Upload Station (via the nav) the bar is hidden again', back === 'none', back);
    ok('no page errors (desktop)', page.__errs.length === 0, page.__errs.join(' | '));
    await page.close();
  }
  {
    const page = await open(b, 800, 'light');
    const p = await page.evaluate(() => { const bar = document.getElementById('topbar'); const cs = getComputedStyle(bar); const burger = document.getElementById('burger');
      return { display: cs.display, position: cs.position, burger: !!(burger && burger.offsetParent),
        others: [...bar.children].filter((x) => x.id !== 'burger' && x.offsetParent).map((x) => x.id || x.className) }; });
    ok('phone width: the bar shows the menu button ALONE, unstuck — the sidebar can still be opened', p.display === 'flex' && p.position === 'static' && p.burger && p.others.length === 0, J(p));
    await page.close();
  }

  /* ------------------------------------------------------------------ B + C ---- */
  for (const theme of ['light', 'dark']) for (const width of [1024, 1280, 1440]) {
    console.log(`\nB/C · ${width} px, ${theme} — ONE CARD SHAPE, EQUAL ROWS, NOTHING SPILLS`);
    const page = await open(b, width, theme);
    const m = await measure(page);
    const C = m.cards;
    ok('theme applied: ' + theme, m.theme === theme);
    ok('ten slot cards, in the order they always had', C.map((c) => c.t).join(',') === 'bi,attendance,evals,roster,inactive,vici,board,opencasesLM,closedcases,referrals', C.map((c) => c.t).join(','));
    ok('grid columns: ' + (width === 1024 ? 2 : 3), m.cols === (width === 1024 ? 2 : 3), String(m.cols));
    ok('every card: header with a one-line "Choose file" button', C.every((c) => c.head && c.pickText === 'Choose file' && c.pickNowrap && c.pickBox.h <= 32), J(C.filter((c) => !(c.pickText === 'Choose file' && c.pickNowrap && c.pickBox.h <= 32)).map((c) => [c.t, c.pickBox])));
    ok('every card: the Choose file buttons of a row sit at the same height', rowsOf(C).every((row) => new Set(row.map((c) => c.pickBox.t - c.box.t)).size === 1), J(rowsOf(C).map((row) => row.map((c) => c.pickBox.t - c.box.t))));
    ok('every card: help text clamped to two lines, with a More/Less button wired to it', C.every((c) => c.desc && c.more && c.moreControls && !c.descOpen && c.descH <= Math.ceil(2 * c.descLine) + 1), J(C.map((c) => [c.t, c.descH, c.descLine])));
    ok('"More" is shown exactly where the clamp hides text', C.every((c) => c.moreHidden === !(c.descFull > c.descH + 1)), J(C.map((c) => [c.t, c.moreHidden, c.descH, c.descFull])));
    ok('every card ends in ONE footer, the last thing in the card, sitting on its bottom edge', C.every((c) => c.foot && c.footLast && Math.abs(c.footBox.b - (c.box.b - c.padB - 1.5)) <= 2), J(C.map((c) => [c.t, c.footLast, c.footBox && c.footBox.b, c.box.b, c.padB])));
    ok('footer order is fixed: facts → last upload → warning → status', C.every((c) => { const order = ['sf-facts', 'sf-last', 'sf-note', 'sf-status']; const idx = c.rows.map((k) => order.indexOf(k)); return idx[0] === 0 && idx.every((v, i) => v >= 0 && (i === 0 || v > idx[i - 1])); }), J(C.map((c) => [c.t, c.rows])));
    ok('file slots: count chip + "covers A → B (N days of data)" + "last upload"', C.filter((c) => !['roster', 'referrals'].includes(c.t)).every((c) => /^\d+ files?\b/.test(c.facts) && /covers \d\d-\d\d → \d\d-\d\d \(\d+ days? of data\)/.test(c.facts) && /^last upload /.test(c.last)), J(C.map((c) => [c.t, c.facts, c.last])));
    const reach = { bi: 1, attendance: 1, evals: 1, vici: 1 };
    ok('the four dated sources carry their status chip on the footer\'s bottom line', C.filter((c) => reach[c.t]).every((c) => c.statusLast === true && /^(up to date — covers|behind — covers)/.test(c.statusText)), J(C.filter((c) => reach[c.t]).map((c) => [c.t, c.statusText])));
    ok('in each row, the status chips line up (same distance from the card bottom)', rowsOf(C).every((row) => new Set(row.filter((c) => c.statusBox).map((c) => c.box.b - c.statusBox.b)).size <= 1), J(rowsOf(C).map((row) => row.filter((c) => c.statusBox).map((c) => [c.t, c.box.b - c.statusBox.b]))));
    const att = C.find((c) => c.t === 'attendance'), ros = C.find((c) => c.t === 'roster'), ref = C.find((c) => c.t === 'referrals');
    ok('Attendance: the upload warning (att-upload-warn) is kept, inside the footer, above the status chip', att.warn && att.rows.indexOf('sf-note') >= 0 && att.rows.indexOf('sf-note') < att.rows.indexOf('sf-status'), J(att.rows));
    ok('Agent List follows the pattern: agents · left this month · as of …, then moved/new/left · last upload', /\d+ agents/.test(ros.facts) && /left this month/.test(ros.facts) && /as of 2026-09-29/.test(ros.facts) && /last upload/.test(ros.last), J([ros.facts, ros.last]));
    ok('Referrals follows the pattern: referrals · agents, and Sync now in the status place', /\d+ referrals/.test(ref.facts) && /\d+ agents/.test(ref.facts) && ref.sync && ref.statusLast === true, J([ref.facts, ref.statusText]));
    ok('each grid row is one height', rowsOf(C).every((row) => new Set(row.map((c) => c.box.h)).size === 1), J(rowsOf(C).map((row) => row.map((c) => c.box.h))));
    ok('nothing spills out of a card, and the page never scrolls sideways', C.every((c) => !c.over) && !m.pageOver, J([C.filter((c) => c.over).map((c) => c.t), m.pageOver]));
    const lg = await page.evaluate(() => { const c = document.getElementById('largeCard'), s = document.querySelector('.slots'); const a = c.getBoundingClientRect(), g = s.getBoundingClientRect();
      const p = document.getElementById('largePick').getBoundingClientRect(); return { full: Math.abs(a.width - g.width) <= 2, pickH: Math.round(p.height) }; });
    ok('the Large files card stays full width, its button on one line', lg.full && lg.pickH <= 40, J(lg));
    if (theme === 'dark') ok('dark: the cards wear the dark glass, not the light white', C.every((c) => c.bg !== 'rgb(255, 255, 255)'), C[0].bg);
    else ok('light: the cards are the light skin\'s white', C.every((c) => c.bg === 'rgb(255, 255, 255)'), C[0].bg);
    ok('no page errors', page.__errs.length === 0, page.__errs.join(' | '));
    await page.close();
  }

  /* ------------------------------------------------------------------ D ---- */
  console.log('\nD · THE HELP TEXT TOGGLES — CLICK AND KEYBOARD — AND NEVER OPENS THE PICKER');
  {
    const page = await open(b, 1280, 'light');
    await page.evaluate(() => { window.__picks = []; const fi = document.getElementById('fileInput'); fi.click = () => { window.__picks.push(window.__slotExpected); }; });
    const st = () => page.evaluate(() => { const c = document.querySelector('.slot[data-slot="vici"]'); const d = c.querySelector('.sdesc'), m = c.querySelector('.sdesc-more');
      return { h: d.clientHeight, full: d.scrollHeight, open: d.classList.contains('open'), aria: m.getAttribute('aria-expanded'), label: m.innerText.trim(), picks: window.__picks.slice(), focus: document.activeElement === m }; });
    const s0 = await st();
    ok('ViciDial starts clamped: "More", aria-expanded=false', !s0.open && s0.aria === 'false' && s0.label === 'More' && s0.full > s0.h + 1, J(s0));
    await page.click('.slot[data-slot="vici"] .sdesc-more');
    const s1 = await st();
    ok('click "More": the whole text shows, "Less", aria-expanded=true', s1.open && s1.aria === 'true' && s1.label === 'Less' && s1.h >= s0.full - 1, J(s1));
    ok('…and the click did not open the file picker', s1.picks.length === 0, J(s1.picks));
    await page.evaluate(async () => { renderPage(); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 60)))); });
    const s2 = await st();
    ok('a re-render (data refresh) keeps it open', s2.open && s2.aria === 'true' && s2.label === 'Less', J(s2));
    await page.focus('.slot[data-slot="vici"] .sdesc-more'); await page.keyboard.press('Enter');
    const s3 = await st();
    ok('keyboard: Enter on "Less" collapses it, focus stays on the button', !s3.open && s3.aria === 'false' && s3.label === 'More' && s3.focus, J(s3));
    await page.keyboard.press(' ');
    const s4 = await st();
    ok('keyboard: Space on "More" expands it', s4.open && s4.aria === 'true', J(s4));
    ok('…and neither key opened the file picker', s4.picks.length === 0, J(s4.picks));
    await page.focus('.slot[data-slot="vici"]'); await page.keyboard.press('Enter');
    const p1 = await page.evaluate(() => window.__picks.slice());
    ok('Enter on the card itself still picks a file for that slot', J(p1) === J(['vici']), J(p1));
    await page.focus('.slot[data-slot="bi"] .spick'); await page.keyboard.press('Enter');
    const p2 = await page.evaluate(() => window.__picks.slice());
    ok('Enter on a card\'s Choose file still picks a file for that slot', J(p2) === J(['vici', 'bi']), J(p2));
    await page.click('.slot[data-slot="evals"] .spick');
    const p3 = await page.evaluate(() => window.__picks.slice());
    ok('clicking Choose file still picks a file for that slot', p3[p3.length - 1] === 'evals', J(p3));
    const sync = await page.evaluate(() => { let n = 0; const keep = window.__hlSyncVAS; window.__hlSyncVAS = () => { n++; }; const before = window.__picks.length;
      document.querySelector('.slot[data-slot="referrals"] .sf-sync').click(); const r = { n, picked: window.__picks.length !== before }; window.__hlSyncVAS = keep; return r; });
    ok('Sync now runs the HighLevel sync and does not open the picker', sync.n === 1 && !sync.picked, J(sync));
    ok('no page errors (toggle)', page.__errs.length === 0, page.__errs.join(' | '));
    await page.close();
  }
} finally { await b.close(); srv.close(); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
