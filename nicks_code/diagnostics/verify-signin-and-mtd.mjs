// The human check must not fail people for pressing a button, and Month to date must reach a past month (6 Nov 2026).
// Drives the REAL auth-gate.js, Agent Analytics and PULSE pages in a browser. HighLevel, Cloudflare and the Worker are
// all stubbed here: nothing leaves this machine and no real account is touched. Run: node verify-signin-and-mtd.mjs
import { chromium } from 'playwright';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const REPO = process.env.AGENTOS || decodeURIComponent(new URL('../..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1').replace(/\/$/, '');
const PORT = 8197;
const PAGES = {
  '/gate': '<!doctype html><html><head><meta charset="utf-8"></head><body><script src="/auth-gate.js"></script></body></html>',
};
const FILES = { '/auth-gate.js': 'site/auth-gate.js', '/agent/': 'agent/index.html', '/pulse/': 'nicks_code/index.html' };
const server = http.createServer((q, s) => {
  const u = q.url.split('?')[0];
  if (PAGES[u]) { s.writeHead(200, { 'Content-Type': 'text/html' }); s.end(PAGES[u]); return; }
  if (FILES[u]) { s.writeHead(200, { 'Content-Type': u.endsWith('.js') ? 'text/javascript' : 'text/html' }); fs.createReadStream(path.join(REPO, FILES[u])).pipe(s); return; }
  s.writeHead(404); s.end();
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  pass  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d ? ' — ' + d : '')); } };

const FAKE_TS = `window.turnstile={n:0,resets:0,render:function(sel,o){this.n++;var t='tok-'+this.n,me=this;
  if(window.__tsFail){setTimeout(function(){o['error-callback']&&o['error-callback']('110200')},30);return 'w'+this.n}
  this.cb=o.callback;setTimeout(function(){o.callback(t)},window.__tsDelay||0);return 'w'+this.n},
  reset:function(){this.resets++;var me=this;setTimeout(function(){me.cb&&me.cb('tok-r'+me.resets)},0)}};`;

const browser = await chromium.launch();
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const open = async (url, { sitekey = 'SITEKEY', blockTs = false, tsDelay = 0, tsFail = false, login = null } = {}) => {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const posts = [], configs = [];
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(`window.__tsDelay=${tsDelay};window.__tsFail=${tsFail};`);
  await page.route('**/*', async (route) => {
    const req = route.request(), u = new URL(req.url());
    if (u.hostname === '127.0.0.1') return route.continue();
    if (u.hostname === 'challenges.cloudflare.com') return blockTs ? route.abort() : route.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE_TS });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    if (u.pathname === '/api/login-config') { configs.push(1); return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify({ turnstile_sitekey: sitekey }) }); }
    if (u.pathname === '/api/login') {
      const b = req.postDataJSON(); posts.push(b);
      const a = login ? await login(b, posts.length) : { status: 401, body: { error: 'Wrong username or password.' } };
      await new Promise((r) => setTimeout(r, 250));   // a real login takes seconds; give a double-click time to land
      return route.fulfill({ status: a.status, headers: CORS, contentType: 'application/json', body: JSON.stringify(a.body) });
    }
    return route.fulfill({ status: 401, headers: CORS, contentType: 'application/json', body: JSON.stringify({ error: 'not signed in' }) });
  });
  await page.goto('http://127.0.0.1:' + PORT + url, { waitUntil: 'domcontentloaded' });
  return { page, posts, configs, errors };
};

console.log('\n1 · the management sign-in (auth-gate.js)');
{
  const { page, posts } = await open('/gate');
  await page.waitForSelector('#cbxGo'); await page.fill('#cbxU', 'nick'); await page.fill('#cbxP', 'pw');
  await page.waitForFunction(() => !!window.__cbxTsToken);
  await page.evaluate(() => { const g = document.getElementById('cbxGo'); g.click(); g.click(); g.click(); });
  await page.press('#cbxP', 'Enter').catch(() => {});
  await page.waitForTimeout(900);
  ok('a triple click plus Enter sends ONE sign-in, so the single-use token is not spent twice', posts.length === 1, 'posts=' + posts.length);
  await page.close();
}
{
  const { page, posts } = await open('/gate', { tsDelay: 700 });
  await page.waitForSelector('#cbxGo'); await page.fill('#cbxU', 'nick'); await page.fill('#cbxP', 'pw');
  await page.click('#cbxGo');
  await page.waitForFunction(() => /Finishing/i.test(document.getElementById('cbxAuth').textContent), null, { timeout: 500 }).then(() => ok('pressing Sign in early says the check is finishing', true), () => ok('pressing Sign in early says the check is finishing', false));
  await page.waitForTimeout(1300);
  ok('pressing Sign in before the widget is ready waits and then sends the token', posts.length === 1 && String(posts[0].turnstile).startsWith('tok-'), JSON.stringify(posts));
  await page.close();
}
{
  const { page, posts } = await open('/gate', { blockTs: true, login: () => ({ status: 200, body: { token: 't', user: { username: 'dalwin', role: 'campaign_manager' } } }) });
  await page.waitForSelector('#cbxGo');
  await page.waitForFunction(() => /could not load/i.test(document.getElementById('cbxAuth').textContent), null, { timeout: 3000 }).then(() => ok('a blocked widget says so instead of leaving a blank gap', true), () => ok('a blocked widget says so instead of leaving a blank gap', false));
  await page.fill('#cbxU', 'dalwin'); await page.fill('#cbxP', 'pw'); await page.click('#cbxGo');
  await page.waitForTimeout(1200);
  ok('a blocked widget does not lock out a role that needs no check: the sign-in still goes', posts.length === 1, 'posts=' + posts.length);
  await page.close();
}
{
  const { page } = await open('/gate', { tsFail: true });
  await page.waitForSelector('#cbxGo');
  await page.waitForFunction(() => /110200/.test(document.getElementById('cbxAuth').textContent), null, { timeout: 2000 }).then(() => ok('a widget error shows its code', true), () => ok('a widget error shows its code', false));
  await page.close();
}
{
  let n = 0;
  const { page, posts } = await open('/gate', { login: () => (++n === 1 ? { status: 403, body: { error: 'That human check has expired.', human_check: true } } : { status: 401, body: { error: 'Wrong username or password.' } }) });
  await page.waitForSelector('#cbxGo'); await page.fill('#cbxU', 'nick'); await page.fill('#cbxP', 'pw');
  await page.waitForFunction(() => !!window.__cbxTsToken); await page.click('#cbxGo');
  await page.waitForFunction(() => /human check has expired/i.test(document.getElementById('cbxAuth').textContent));
  await page.waitForFunction(() => !!window.__cbxTsToken);
  await page.fill('#cbxU', 'nick'); await page.fill('#cbxP', 'pw'); await page.click('#cbxGo');
  await page.waitForTimeout(600);
  ok('after a refused check the next try carries a NEW token', posts.length === 2 && posts[0].turnstile !== posts[1].turnstile, JSON.stringify(posts.map((p) => p.turnstile)));
  await page.close();
}

console.log('\n2 · Agent Analytics sign-in');
{
  const { page, posts, configs, errors } = await open('/agent/', { login: () => ({ status: 401, body: { error: 'Wrong CB number or password.' } }) });
  await page.waitForSelector('#go'); await page.fill('#cb', 'CB93'); await page.fill('#pw', 'pw'); await page.click('#go');
  await page.waitForTimeout(600);
  ok('an agent never sees the check: no widget, no config call', configs.length === 0 && !(await page.isVisible('#hc').catch(() => false)), 'configs=' + configs.length);
  ok('the agent sign-in carries no token', posts[0] && !posts[0].turnstile, JSON.stringify(posts[0]));
  ok('no page errors', errors.length === 0, errors.join(' | ').slice(0, 200));
  await page.close();
}
{
  const { page, posts } = await open('/agent/', { login: (b, i) => (i === 1 ? { status: 403, body: { error: 'Finish the human check, then press Sign in.', human_check: true } } : (b.turnstile ? { status: 401, body: { error: 'Wrong CB number or password.' } } : { status: 403, body: { error: 'still no token', human_check: true } })) });
  await page.waitForSelector('#go'); await page.fill('#cb', 'nick'); await page.fill('#pw', 'pw'); await page.click('#go');
  await page.waitForFunction(() => { const h = document.getElementById('hc'); return h && h.style.display !== 'none'; }, null, { timeout: 2500 }).then(() => ok('an admin on Agent Analytics is shown the check', true), () => ok('an admin on Agent Analytics is shown the check', false));
  await page.waitForFunction(() => window.turnstile && window.turnstile.n >= 1, null, { timeout: 2000 }).catch(() => {});
  await page.waitForTimeout(200);
  await page.click('#go'); await page.waitForTimeout(600);
  ok('the second try carries the token', posts.length === 2 && String(posts[1].turnstile).startsWith('tok-'), JSON.stringify(posts.map((p) => p.turnstile)));
  await page.waitForTimeout(100);
  await page.click('#go'); await page.waitForTimeout(600);
  ok('a spent token is replaced after a wrong password', posts.length === 3 && posts[2].turnstile && posts[2].turnstile !== posts[1].turnstile, JSON.stringify(posts.map((p) => p.turnstile)));
  await page.close();
}

console.log('\n3 · Month to date reaches a past month (PULSE)');
{
  const { page, errors } = await open('/pulse/');
  await page.waitForFunction(() => window.__mtd && window.__mtd.state(), null, { timeout: 30000 });
  const R = (fn, arg) => page.evaluate(fn, arg);
  await R(() => { const S = window.__mtd.state(); S.sales = { '2026-09-02': {}, '2026-11-03': {} }; S.calls = { '2026-09-02': {} }; S.att = { '2026-01-05': { CB1: 'P' } }; window.__mtd.setPreset('mtd'); });
  await page.waitForSelector('#pMtdMonth', { state: 'attached', timeout: 5000 }).then(() => ok('Month to date shows a month picker', true), () => ok('Month to date shows a month picker', false));
  const thisMonth = await R(() => sastToday().slice(0, 7));
  const r0 = await R(() => periodRange());
  ok('with nothing picked it is still this month to today', r0.from === thisMonth + '-01', JSON.stringify(r0));
  await page.fill('#pMtdMonth', '2026-09').catch(() => {}); await page.dispatchEvent('#pMtdMonth', 'change').catch(() => {});
  await page.waitForTimeout(200);
  const r1 = await R(() => periodRange());
  ok('picking September gives all of September', r1.from === '2026-09-01' && r1.to === '2026-09-30', JSON.stringify(r1));
  ok('the bar still reads Month to date', await R(() => document.getElementById('pPreset').value === 'mtd'));
  const saved = await R(() => Object.keys(localStorage).map((x) => localStorage.getItem(x)).join(''));
  ok('a past month is never saved, so a reload cannot quietly show an old month as "to date"', !/mtdMonth/.test(saved), saved.slice(0, 200));
  await page.fill('#pMtdMonth', '2026-01').catch(() => {}); await page.dispatchEvent('#pMtdMonth', 'change').catch(() => {});
  await page.waitForTimeout(200);
  const msg = await R(() => emptyState());
  ok('January says what is held, not "no data yet"', /January 2026/.test(msg) && /attendance/i.test(msg) && /sales start in September 2026/i.test(msg) && !/>No data for/.test(msg), msg.replace(/<[^>]+>/g, ' ').slice(0, 240));
  await R(() => window.__mtd.setPreset('month'));
  await page.waitForTimeout(150);
  await R(() => window.__mtd.setPreset('mtd'));
  await page.waitForTimeout(150);
  const r2 = await R(() => periodRange());
  ok('leaving and coming back returns to this month', r2.from === thisMonth + '-01', JSON.stringify(r2));
  ok('no page errors', errors.length === 0, errors.join(' | ').slice(0, 240));
  await page.close();
}

await browser.close(); server.close();
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
