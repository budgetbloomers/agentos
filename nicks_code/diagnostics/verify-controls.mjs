#!/usr/bin/env node
/**
 * verify-controls.mjs — no control may do nothing.
 *
 *   node nicks_code/diagnostics/verify-controls.mjs
 *
 * Nick, 2026-09-07, after the Month-to-Date page ignored the header Team and Campaign
 * filters: "for example the filter wasn't working — pick things like this please." This
 * suite is that request made permanent. Over the LIVE stores it boots both dashboards,
 * visits every page, and for each one flips the global filters and every in-page
 * <select>, search box and handler-bearing chip, asserting that what is on screen changes.
 * A control that changes nothing is exactly the bug class that hid for weeks.
 *
 * Deliberately not asserted: pages with nothing to filter (PULSE Apps, Ops Manual and the
 * upload/session/admin pages), and chips that are legend swatches (no handler). Every
 * assertion waits long enough for the double-rAF re-render (900 ms), because a shorter wait
 * flagged the Agent Performance risk chips that work.
 */
import fs from 'node:fs'; import path from 'node:path'; import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const { chromium } = await import(pathToFileURL(path.join(HERE, 'node_modules', 'playwright', 'index.mjs')).href);
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (d ? ' — ' + d : '')); } };
const env = Object.fromEntries(fs.readFileSync(path.join(REPO, 'supabase.env'), 'utf8').split(/\r?\n/).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const H = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY };
const get = async (key) => { const r = await fetch(`${env.SUPABASE_URL}/storage/v1/object/raw/kv/${key}`, { headers: H, signal: AbortSignal.timeout(120000) }); return r.ok ? r.text() : null; };
const serve = (map, port) => new Promise((res) => { const s = http.createServer((q, r) => { const p = map[q.url.split('?')[0]];
  if (!p || !fs.existsSync(p)) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' }); fs.createReadStream(p).pipe(r); });
  s.listen(port, '127.0.0.1', () => res(s)); });
const WAIT = 900;
/* generic in-page probe: every select / text input / chip WITH a handler must change the container */
/* `reset` restores the page to its unfiltered state before EACH control — a search box typed
   into earlier must not leave the chips that follow with nothing to change (seen on Agent
   Performance: the search probe emptied the table, then every risk chip "did nothing"). */
const probeControls = async (page, containerId, label, reset) => {
  const ctrls = await page.evaluate((cid) => { const v = document.getElementById(cid); if (!v) return []; const out = [];
    [...v.querySelectorAll('select')].slice(0, 8).forEach((el, i) => out.push({ kind: 'select', i, label: ((el.closest('.ctl,label,.field') || {}).innerText || el.id || el.name || 'select#' + i).replace(/\s+/g, ' ').slice(0, 40), n: el.options.length, saves: /setCoach|save\(/.test(el.getAttribute('onchange') || '') }));
    [...v.querySelectorAll('input[type=search],input[type=text]:not([readonly])')].slice(0, 5).forEach((el, i) => out.push({ kind: 'text', i, label: (el.placeholder || el.id || 'text#' + i).slice(0, 40) }));
    [...v.querySelectorAll('button.chip[onclick]:not([disabled]):not(.on):not(.active)')].slice(0, 6).forEach((el, i) => out.push({ kind: 'chip', i, label: el.innerText.trim().slice(0, 30) }));
    return out; }, containerId);
  for (const c of ctrls) {
    if (c.kind === 'select' && (c.n < 2 || c.saves)) continue;              // a per-row status select persists a value; the select itself shows it
    if (reset) await reset();
    const r = await page.evaluate(async ([cid, c, wait]) => { const v = document.getElementById(cid); const before = v.innerText.replace(/\s+/g, ' ').trim();
      if (c.kind === 'select') { const el = v.querySelectorAll('select')[c.i]; if (!el) return { skip: true }; el.selectedIndex = el.selectedIndex === 0 ? 1 : 0; el.dispatchEvent(new Event('change', { bubbles: true })); }
      else if (c.kind === 'text') { const el = v.querySelectorAll('input[type=search],input[type=text]:not([readonly])')[c.i]; if (!el) return { skip: true }; el.value = 'zzqx'; for (const ev of ['input', 'keyup', 'change']) el.dispatchEvent(new Event(ev, { bubbles: true })); }
      else { const el = v.querySelectorAll('button.chip[onclick]:not([disabled]):not(.on):not(.active)')[c.i]; if (!el) return { skip: true }; el.click(); }
      await new Promise((r) => setTimeout(r, wait)); return { changed: document.getElementById(cid).innerText.replace(/\s+/g, ' ').trim() !== before }; }, [containerId, c, WAIT]);
    if (!r.skip) ok(label + ': ' + c.kind + ' "' + c.label + '" changes the page', r.changed);
  }
};

/* ============================ PULSE ============================ */
console.log('\nPULSE · header filters and in-page controls, every page');
{
  const blob = await get('vas-state'); if (!blob) { console.log('  (skipping PULSE — cannot read live state)'); }
  else {
    const HTML = path.join(REPO, 'site', 'pulse', 'index.html');
    const srv = await serve({ '/': HTML, '/index.html': HTML, '/xlsx.full.min.js': path.join(REPO, 'site', 'xlsx.full.min.js') }, 8271);
    const b = await chromium.launch({ args: ['--js-flags=--max-old-space-size=8192'] });
    const page = await b.newPage({ viewport: { width: 1600, height: 1000 } });
    const errs = []; page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160))); page.on('dialog', (d) => d.dismiss().catch(() => {}));
    await page.goto('http://127.0.0.1:8271/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__mtd && window.__mtd.state(), null, { timeout: 30000 });
    await page.evaluate((x) => { const S = window.__mtd.state(); const o = JSON.parse(x); for (const k of Object.keys(o)) S[k] = o[k]; window.__mtd.rebuild();
      const days = [...Object.keys(S.sales || {}), ...Object.keys(S.calls || {})].sort(); if (days.length) window.__mtd.setPeriod(days[days.length - 1].slice(0, 7), 'month'); }, blob);
    const pick = await page.evaluate(() => { const M = window.__mtd.model(); const byTl = {}; (M.facts || []).forEach((f) => { byTl[f.tl] = (byTl[f.tl] || 0) + 1; });
      const camps = {}; (M.facts || []).forEach((f) => { camps[f.campaign] = (camps[f.campaign] || 0) + 1; });
      return { tl: Object.entries(byTl).filter(([k]) => k).sort((a, b) => b[1] - a[1])[0][0], camp: Object.entries(camps).sort((a, b) => b[1] - a[1])[0][0] }; });
    const render = (tab) => page.evaluate(async ([t, w]) => { const S = window.__mtd.state(); S.ui.tab = t; renderPage(); await new Promise((r) => setTimeout(r, w)); const v = document.getElementById('view'); return v ? v.innerText.replace(/\s+/g, ' ').trim() : ''; }, [tab, WAIT]);
    const setF = (team, camp) => page.evaluate(([t, c]) => { const S = window.__mtd.state(); S.ui.team = t; S.ui.camp = c; }, [team, camp]);
    for (const tab of ['dashboard', 'agents', 'leaderboard', 'coaching', 'mtd', 'weekly', 'daily', 'attend', 'leads', 'variance', 'adjust']) {
      await setF('', ''); const base = await render(tab);
      ok(tab + ': renders', !!base);
      await setF(pick.tl, ''); const t1 = await render(tab);
      await setF('', pick.camp); const t2 = await render(tab);
      await setF('', '');
      ok(tab + ': header Team filter changes the page', t1 !== base);
      ok(tab + ': header Campaign filter changes the page', t2 !== base);
      await render(tab);
      await probeControls(page, 'view', tab, async () => { await page.evaluate(() => { const S = window.__mtd.state(); S.ui.agentQ = ''; S.ui.risk = ''; S.ui.dailyFilter = {}; S.ui.lbQ = ''; S.ui.varOnly = false; }); await render(tab); });
    }
    ok('PULSE: no page errors', errs.length === 0, [...new Set(errs)].join(' | '));
    await b.close(); srv.close();
  }
}

/* ============================ OPS ============================ */
console.log('\nOPS · global filters and in-page controls, every data route');
{
  const config = JSON.parse(await get('cb-config') || '{}');
  const SRCS = ['AGENT_LIST', 'ATTENDANCE', 'QA_EVALUATIONS', 'BI_ACTIVE_CASES', 'VICI_CALL_REPORT', 'SF_OPEN_CASES', 'SF_CLOSED_CASES', 'SF_INACTIVE', 'REFERRALS'];
  const facts = {}; for (const s of SRCS) { const t = await get('cb-facts-' + s); if (t) facts[s] = t; }
  const HTML = path.join(REPO, 'site', 'index.html');
  const srv = await serve({ '/': HTML, '/index.html': HTML, '/xlsx.full.min.js': path.join(REPO, 'site', 'xlsx.full.min.js'), '/auth-gate.js': path.join(REPO, 'site', 'auth-gate.js'), '/ask-widget.js': path.join(REPO, 'site', 'ask-widget.js') }, 8272);
  const b = await chromium.launch({ args: ['--js-flags=--max-old-space-size=8192'] });
  const page = await b.newPage({ viewport: { width: 1600, height: 1000 } });
  const errs = []; page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160))); page.on('dialog', (d) => d.dismiss().catch(() => {}));
  await page.goto('http://127.0.0.1:8272/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.acStats === 'function' && typeof window.render === 'function', null, { timeout: 60000 });
  await page.evaluate((cfg) => { const o = JSON.parse(cfg); for (const k of ['kpis', 'rules', 'agentMap', 'sfOwnerMap', 'cbInfo', 'user']) if (o[k]) state[k] = o[k]; state.facts = state.facts || {}; }, JSON.stringify(config));
  for (const [src, text] of Object.entries(facts)) await page.evaluate(([s, t]) => { state.facts[s] = JSON.parse(t); }, [src, text]);
  await page.evaluate(() => { if (typeof _dataVer !== 'undefined') _dataVer++; if (typeof buildIdentity === 'function') try { buildIdentity(); } catch (e) {} render(); });
  await page.waitForTimeout(WAIT);
  const routes = await page.evaluate(() => [...new Set([...document.querySelectorAll('[onclick]')].map((el) => (/go\('([a-z_\-]+)'\)/.exec(el.getAttribute('onclick')) || [])[1]).filter(Boolean))]);
  const fx = await page.evaluate(() => { const L = state.facts.AGENT_LIST || []; const pick = (k) => { const c = {}; L.forEach((r) => { const v = String(r[k] || '').trim(); if (v) c[v] = (c[v] || 0) + 1; }); return Object.entries(c).sort((a, b) => b[1] - a[1]).map((x) => x[0])[0] || ''; };
    return { campaign: pick('queue'), team: pick('team_leader'), tenure: pick('tenure') }; });
  const SKIP = /upload|data|session|sess|admin|users|dict|settings|danger|manage|manual/i;
  const renderRoute = (route) => page.evaluate(async ([r, w]) => { state.route = r; render(); await new Promise((x) => setTimeout(x, w)); const p = document.getElementById('page'); return p ? p.innerText.replace(/\s+/g, ' ').trim() : ''; }, [route, WAIT]);
  const reset = () => page.evaluate(() => { state.filters = { campaign: '', team: '', agent: '', dept: '', tenure: '' }; });
  for (const route of routes) {
    if (SKIP.test(route)) continue;
    await reset(); const base = await renderRoute(route);
    ok(route + ': renders', !!base);
    for (const k of ['campaign', 'team', 'tenure']) {
      if (!fx[k]) continue;
      await page.evaluate(([k, v]) => { state.filters[k] = v; }, [k, fx[k]]); const t = await renderRoute(route); await reset();
      ok(route + ': global ' + k + ' filter changes the page', t !== base);
    }
    await renderRoute(route);
    await probeControls(page, 'page', route, async () => { await reset(); await renderRoute(route); });
  }
  ok('OPS: no page errors', errs.length === 0, [...new Set(errs)].join(' | '));
  await b.close(); srv.close();
}
console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
process.exitCode = fail ? 1 : 0;
