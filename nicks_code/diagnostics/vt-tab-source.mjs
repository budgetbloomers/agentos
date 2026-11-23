/* vt-tab-source.mjs — what the whole-app health checks (verify-all-tabs, verify-controls) need to drive the three
 * Vehicle Tracking pages (spec 071, Phase F item 5).
 *
 * The VT pages read the case book, the VT roster and the receipts from the Worker (/api/vt/book, /roster, /uploads), and a
 * page served from 127.0.0.1 cannot reach the deployed Worker (CORS). So the suites answer those three routes themselves:
 *   · FIXTURE (default, offline): the fictional VT floor of vt-digest-fixture.mjs (CB91xx, invented case numbers)
 *   · LIVE (after deploy, the nightly run; needs supabase.env and migrations 071/072 applied): the SAME three reads the
 *     Worker makes — vt_book(p_from), vt_roster_at(p_on), vt_uploads — with the service key, READ-ONLY (no write is ever made)
 * and then check the page against the engine: every VT page renders with no error card, and the page's model is
 * VTEngine.model() computed here in Node over the same book, roster and receipts (the engine decides, the page paints).
 *
 *   import { vtSource, installVtRoutes, checkVtTabs, probeVtControls } from './vt-tab-source.mjs';
 */
import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const HERE = path.dirname(fileURLToPath(import.meta.url)); const ROOT = path.resolve(HERE, '..', '..');
const require = createRequire(import.meta.url);
export const ENG = require(path.join(ROOT, 'nicks_code', 'vt-engine.js'));
export const ST = require(path.join(ROOT, 'nicks_code', 'vt-pages.js'));
export const API = 'https://chatterbox-agentos-api.chatterbox-agentos.workers.dev';
export const VT_PAGES = ['vt_mtd', 'vt_weekly', 'vt_daily'];

/** {label, live, cycle|null, book(from), roster(on), uploads()} — fixture by default; live only when asked AND readable */
export async function vtSource({ live = false } = {}) {
  if (!live) {
    const F = await import('./vt-digest-fixture.mjs');
    return { label: 'fixture (fictional VT floor)', live: false, cycle: F.CYCLE,
      book: async (from) => F.bookRpc(from), roster: async () => F.ROSTER_RPC, uploads: async () => F.FX.receipts.slice().reverse() };
  }
  let env;
  try { env = Object.fromEntries(fs.readFileSync(path.join(ROOT, 'supabase.env'), 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^"|"$/g, '')])); } catch { return null; }
  const H = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY, 'Content-Type': 'application/json' };
  const rpc = async (fn, body) => { const r = await fetch(env.SUPABASE_URL + '/rest/v1/rpc/' + fn, { method: 'POST', headers: H, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
    if (!r.ok) throw new Error(fn + ' → ' + r.status); return r.json(); };
  const cols = 'id,sha256,kind,file_name,extract_on,cycle_key,state,counts,unmatched,warnings,quiet_day_ack,uploaded_by,started_at,committed_at,rev_after';
  try {
    const probe = await fetch(env.SUPABASE_URL + '/rest/v1/vt_uploads?select=id&limit=1', { headers: H, signal: AbortSignal.timeout(30000) });
    if (!probe.ok) return null;                                    // migration 071 not applied: the VT pages have nothing live to show
  } catch { return null; }
  return { label: 'live (read-only: vt_book, vt_roster_at, vt_uploads)', live: true, cycle: null,
    book: (from) => rpc('vt_book', { p_from: from || null }), roster: (on) => rpc('vt_roster_at', { p_on: on }),
    uploads: async () => (await fetch(env.SUPABASE_URL + '/rest/v1/vt_uploads?select=' + cols + '&order=id.desc&limit=20', { headers: H })).json() };
}

/** answer the page's /api/vt/* calls from `src`; nothing else leaves the machine through this route */
export async function installVtRoutes(page, src) {
  await page.route((u) => String(u).startsWith(API + '/api/vt/'), async (route) => {
    const u = new URL(route.request().url());
    try {
      const body = u.pathname === '/api/vt/book' ? await src.book(u.searchParams.get('from'))
        : u.pathname === '/api/vt/roster' ? await src.roster(u.searchParams.get('on'))
        : u.pathname === '/api/vt/uploads' ? { uploads: await src.uploads() } : null;
      if (body == null) return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not found"}' });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    } catch (e) { return route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: String(e.message || e) }) }); }
  });
}

const settle = (page) => page.evaluate(async () => {
  const paint = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 0))));
  for (let i = 0; i < 120; i++) { await paint(); const st = window.VTPages.state();
    if (!/^vt_/.test(window.__mtd.state().ui.tab) || (st.status !== 'loading' && !document.querySelector('#view .vt-loading') && document.querySelector('#view .page-head'))) break; }
  await paint(); });

/** open one VT page (optionally pinned to a business month) and wait for it */
export async function openVt(page, tab, cycle) {
  await page.evaluate(([t, c]) => { const S = window.__mtd.state(); if (window.VTPages._reset) window.VTPages._reset(); S.ui.vt = c ? { cycle: c } : {}; S.ui.tab = t; renderPage(); }, [tab, cycle || null]);
  await settle(page);
}

/** every VT page renders, and the page's model IS the engine's model over the same inputs */
export async function checkVtTabs(page, ok, src) {
  for (const tab of VT_PAGES) {
    await openVt(page, tab, src.cycle);
    const r = await page.evaluate(() => { const v = document.getElementById('view'); const t = (v && v.innerText) || '';
      const st = window.VTPages.state();
      return { len: t.length, head: t.slice(0, 80).replace(/\n/g, ' '), err: /Something went wrong|is not defined|undefined is not|Cannot read|could not be read/i.test(t), status: st.status, cycle: st.cycle, ready: st.ready }; });
    ok(`VT ${tab} renders (${src.label})`, r.len > 40 && !r.err && r.status !== 'error', JSON.stringify(r));
    if (tab !== 'vt_mtd') continue;
    if (!r.ready) { ok('VT: the page has a model to compare (' + src.label + ')', false, JSON.stringify(r)); continue; }
    const pm = await page.evaluate(() => JSON.stringify(window.VTPages.state().model));
    const cyc = ENG.periods.cycleByKey(r.cycle);
    const [book, roster, uploads] = await Promise.all([src.book(cyc.from), src.roster(cyc.to), src.uploads()]);
    const M = ENG.model(ENG.bookFromRpc(book), ST.rosterFromRpc(roster), { cycleKey: r.cycle, aliases: {}, receipts: uploads });
    ok(`VT Month to date: the page's model equals VTEngine.model() over the same book, roster and receipts (${r.cycle})`, pm === JSON.stringify(M), pm.slice(0, 160));
  }
}

/** verify-controls' rule on the VT pages: every in-page select and chip changes what is on screen */
export async function probeVtControls(page, ok, src, wait = 900) {
  for (const tab of VT_PAGES) {
    await openVt(page, tab, src.cycle);
    const ctrls = await page.evaluate(() => { const v = document.getElementById('view'); if (!v) return [];
      return [...v.querySelectorAll('select')].slice(0, 8).map((el, i) => ({ kind: 'select', i, n: el.options.length, label: (el.getAttribute('aria-label') || el.name || el.id || 'select#' + i).slice(0, 40) }))
        .concat([...v.querySelectorAll('button.chip[onclick]:not([disabled]):not(.on):not(.active)')].slice(0, 6).map((el, i) => ({ kind: 'chip', i, label: el.innerText.trim().slice(0, 30) }))); });
    let probed = 0;
    for (const c of ctrls) {
      if (c.kind === 'select' && c.n < 2) continue;
      await openVt(page, tab, src.cycle);
      const r = await page.evaluate(async ([c, w]) => { const v = document.getElementById('view'); const before = v.innerText.replace(/\s+/g, ' ').trim();
        if (c.kind === 'select') { const el = v.querySelectorAll('select')[c.i]; if (!el) return { skip: true }; el.selectedIndex = el.selectedIndex === 0 ? 1 : 0; el.dispatchEvent(new Event('change', { bubbles: true })); }
        else { const el = v.querySelectorAll('button.chip[onclick]:not([disabled]):not(.on):not(.active)')[c.i]; if (!el) return { skip: true }; el.click(); }
        await new Promise((x) => setTimeout(x, w)); return { changed: document.getElementById('view').innerText.replace(/\s+/g, ' ').trim() !== before }; }, [c, wait]);
      if (!r.skip) { probed++; ok(`${tab}: ${c.kind} "${c.label}" changes the page (${src.label})`, r.changed); }
    }
    ok(`${tab}: has controls to probe (${src.label})`, probed > 0, JSON.stringify(ctrls));
  }
}
