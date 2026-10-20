/* page-sweep.test.mjs — the Wimpy page in a real Chromium: A3 (a cart line whose item left the menu is dropped and said),
 * A4 (sign-out hands nothing of the previous person to the next), A5 (the window-flip re-render keeps what is being
 * typed) and the ES5 rule — the Wimpy section of the suite's verify-agent-sweep-014.mjs (Spec Kit 014), ported to the
 * Wimpy service (Spec Kit 018). The page's clock is driven so its 30-second window check really flips.
 *
 *   node test/page-sweep.test.mjs   (or npm test)
 */
process.env.TZ = 'UTC';   // a machine in SAST would hide a UTC-day slip — run the page as a browser in UTC sees it

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const WIMPY_PAGE = path.join(ROOT, 'public', 'index.html');

let fails = 0, checks = 0;
const ok = (m) => { checks++; console.log('  ok   ' + m); };
const bad = (m, d) => { checks++; fails++; console.log('  FAIL ' + m + (d ? '\n      ' + d : '')); };
const head = (m) => console.log('\n' + m);
const check = (label, fn) => { try { const r = fn(); r === false ? bad(label) : ok(label); } catch (e) { bad(label, e.message); } };
const nonEs5 = (code) => {
  code = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1').replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g, '""');
  const hits = [];
  if (/=>/.test(code)) hits.push('=>'); if (/\b(let|const)\s+[A-Za-z_$]/.test(code)) hits.push('let/const'); if (/`/.test(code)) hits.push('template literal'); if (/\.\.\.[A-Za-z_$[]/.test(code)) hits.push('spread');
  return hits;
};

{
  const html = fs.readFileSync(WIMPY_PAGE, 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((x) => x[1]).join('\n');
  check('public/index.html: the whole script uses no arrow functions, let/const, template literals or spread', () => { const h = nonEs5(scripts); if (h.length) throw new Error(h.join(', ')); });
}

/* ═════════════════════════ Wimpy (A3 · A4 · A5) — a real Chromium ═════════════════════════ */
head('A3 · A4 · A5 — the Wimpy page, in a real browser against a stubbed service');
{
  const W = pathToFileURL(path.resolve(ROOT, 'src', 'wimpy.mjs')).href;
  const { wimpyMenu } = await import(W);
  const { chromium } = await (await import('./_harness.mjs')).playwright();
  const pageSrc = fs.readFileSync(WIMPY_PAGE, 'utf8');
  const srv = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html' }); r.end(pageSrc); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));   // any free port: other suites may hold the fixed ones
  const port = srv.address().port;
  /* SAST wall-clock → UTC ms. Wednesday 2 September 2026 → Thursday 3 September 2026. */
  const sast = (iso) => Date.parse(iso + '+02:00');
  const WED_OPEN = sast('2026-09-02T08:00:00'), WED_SHUT = sast('2026-09-02T10:30:05'), THU_OPEN = sast('2026-09-03T07:00:05');   // 07:00–10:30 since 2026-10-20
  const PEOPLE = {
    'ann-pass-1': { token: 'tokAnn', user: { username: 'cb999', full_name: 'Ann Smith', cb: 'CB999', scope: 'wimpy' } },
    'bob-pass-1': { token: 'tokBob', user: { username: 'cb111', full_name: 'Bob Jones', cb: 'CB111', scope: 'wimpy' } },
  };
  const b = await chromium.launch();
  let menuAt = WED_OPEN;   // which instant the stub's menu is built for — the Worker decides the window, never the page
  let menuN = 0;
  const menuCalls = () => menuN;
  const errs = [];
  async function fresh() {
    const pg = await b.newPage();
    pg.on('pageerror', (e) => errs.push(String(e)));
    await pg.clock.install({ time: WED_OPEN });
    await pg.route('**/api/**', async (route) => {   // same origin: the page calls /api/… on itself
      const u = route.request().url(), auth = route.request().headers().authorization || '';
      const J = (o, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) });
      if (u.includes('/api/wimpy/signin')) { const p = PEOPLE[(JSON.parse(route.request().postData() || '{}')).password]; return p ? J(p) : J({ error: 'That CB number and password do not match.' }, 401); }
      if (u.endsWith('/api/wimpy/me')) { const p = Object.values(PEOPLE).filter((x) => 'Bearer ' + x.token === auth)[0]; return p ? J({ user: p.user }) : J({ error: 'no session' }, 401); }
      if (u.includes('/api/wimpy/menu')) { menuN++; return J(wimpyMenu(menuAt)); }
      if (u.includes('/api/wimpy/order')) return J({ ok: true, total_price: 54.9, order_formatted: 'WIMPY ORDER' });
      return J({ ok: true });
    });
    await pg.goto('http://127.0.0.1:' + port + '/', { waitUntil: 'domcontentloaded' });
    await pg.waitForSelector('#cb', { timeout: 20000 });
    return pg;
  }
  async function signIn(pg, cb, pw) {
    await pg.fill('#cb', cb); await pg.fill('#pw', pw); await pg.click('#go');
    await pg.waitForSelector('.wp-grid', { timeout: 20000 });
  }
  /* the page's own 30-second check, run on the page's clock: one beat to learn the state, one after the jump to flip */
  async function flipTo(pg, at) {
    await pg.clock.runFor(30000);
    menuAt = at; await pg.clock.setSystemTime(at); await pg.clock.runFor(30000);
    await pg.waitForTimeout(400);
  }
  const formVals = (pg) => pg.evaluate(() => ['fcb', 'ffn', 'fln', 'fph', 'fnt'].map((id) => (document.getElementById(id) || {}).value));
  try {
    /* A3 — yesterday's Big One in the cart after the day flips */
    {
      menuAt = WED_OPEN;
      const pg = await fresh();
      await signIn(pg, 'CB999', 'ann-pass-1');
      const big = wimpyMenu(WED_OPEN).bigOne;
      await pg.click('[data-wadd="' + big.id + '"]'); await pg.click('[data-wcat="burgers"]'); await pg.click('[data-wadd="cheese_burger"]');
      await pg.waitForSelector('#wpReview');
      await flipTo(pg, WED_SHUT); await flipTo(pg, THU_OPEN);
      await pg.waitForSelector('#wpReview', { timeout: 10000 });
      const cart = await pg.evaluate(() => (document.querySelector('#wpPull') || {}).textContent || '');   // the count lives on the pull bar (hidden on a wide screen, so textContent)
      const page = await pg.evaluate(() => document.body.innerText);
      check('A3 (setup) the window flipped twice and Thursday\'s menu no longer carries Wednesday\'s ' + big.name, () => {
        if (wimpyMenu(THU_OPEN).items.some((i) => i.id === big.id)) throw new Error('fixture: still on the menu');
        if (!/Ordering is open/.test(page)) throw new Error('the reopened menu is not on screen: ' + page.slice(0, 200));
      });
      check('A3 the cart no longer holds the line nobody can see: it counts 1 item, not 2', () => { if (!/· 1 item(?!s)/.test(cart)) throw new Error(cart.replace(/\s+/g, ' ')); });
      check('A3 the page says ' + big.name + ' left the menu and was taken out of the order', () => {
        if (page.indexOf(big.name) < 0 || !/no longer on the menu/i.test(page)) throw new Error(page.replace(/\s+/g, ' ').slice(0, 400));
      });
      await pg.click('#wpReview'); await pg.waitForSelector('#fcb');
      await pg.fill('#fph', '082 123 4567'); await pg.click('#of button[type=submit]');
      await pg.waitForTimeout(400);
      const err = await pg.evaluate(() => (document.querySelector('.msg.bad') || {}).innerText || '');
      const confirmed = !!(await pg.$('#wpSend'));
      check('A3 the order is no longer blocked: no "remove it and add it again" refusal for a line nobody can remove', () => {
        if (/no longer on the menu/i.test(err)) throw new Error(err);
      });
      check('A3 …the remaining line goes on to the confirm step (#wpSend)', () => { if (!confirmed) throw new Error('still on the form: ' + err); });
      await pg.close();
    }
    /* A3 · R1 — EVERY cart line leaves the menu while the person is on the confirm (or the form) step */
    for (const step of ['confirm', 'form']) {
      menuAt = WED_OPEN;
      const pg = await fresh();
      await signIn(pg, 'CB999', 'ann-pass-1');
      const big = wimpyMenu(WED_OPEN).bigOne;
      await pg.click('[data-wadd="' + big.id + '"]'); await pg.waitForSelector('#wpReview');
      await pg.click('#wpReview'); await pg.waitForSelector('#fcb'); await pg.fill('#fph', '082 123 4567');
      if (step === 'confirm') { await pg.click('#of button[type=submit]'); await pg.waitForSelector('#wpSend'); }
      await flipTo(pg, WED_SHUT); await flipTo(pg, THU_OPEN);
      const st = await pg.evaluate(() => ({ send: !!document.getElementById('wpSend'), form: !!document.getElementById('of'), grid: !!document.querySelector('.wp-grid'), text: document.body.innerText }));
      check('A3·R1 on the ' + step + ' step, a cart the menu change emptied goes back to the order screen', () => {
        if (!st.grid || st.form || st.send) throw new Error('still on the ' + (st.send ? 'confirm' : st.form ? 'form' : '?') + ' step: ' + st.text.replace(/\s+/g, ' ').slice(0, 240));
      });
      check('A3·R1 …says ' + big.name + ' left the menu, and offers no "Confirm & send" of an empty R0.00 order', () => {
        if (st.text.indexOf(big.name) < 0 || !/no longer on the menu/i.test(st.text)) throw new Error(st.text.replace(/\s+/g, ' ').slice(0, 300));
        if (/Confirm & send/i.test(st.text) || /Total\s*R0\.00/.test(st.text)) throw new Error('an empty order is offered for sending');
      });
      if (step === 'form' && st.grid) {                  // only from the order screen (else the checks above already failed)
        await pg.click('[data-wcat="burgers"]'); await pg.click('[data-wadd="cheese_burger"]'); await pg.click('#wpReview'); await pg.waitForSelector('#fcb');
        const ph = await pg.evaluate(() => document.getElementById('fph').value);
        check('A3·R1 …and what was typed on the form is still there when the person comes back to it', () => { if (ph !== '082 123 4567') throw new Error(JSON.stringify(ph)); });
      }
      await pg.close();
    }
    /* A5 — the window flips while the person is typing the order form */
    {
      menuAt = WED_OPEN; menuN = 0;
      const pg = await fresh();
      await signIn(pg, 'CB999', 'ann-pass-1');
      await pg.click('[data-wcat="burgers"]'); await pg.click('[data-wadd="cheese_burger"]'); await pg.click('#wpReview'); await pg.waitForSelector('#fcb');
      await pg.fill('#ffn', 'Annie'); await pg.fill('#fph', '082 555 1234'); await pg.fill('#fnt', 'collect at reception');
      await pg.focus('#fnt');
      await flipTo(pg, WED_SHUT);
      const v = await formVals(pg);
      const page = await pg.evaluate(() => document.body.innerText);
      check('A5 (setup) the 10:30 flip re-asked for the menu (' + menuCalls() + ' menu requests) and the form is still the page', () => {
        if (menuCalls() < 2) throw new Error('the flip never re-asked'); if (v[0] == null) throw new Error('the form is gone: ' + page.slice(0, 200));
      });
      check('A5 the form still holds what was typed (name, phone, notes) after the flip re-render', () => {
        if (v[1] !== 'Annie' || v[3] !== '082 555 1234' || v[4] !== 'collect at reception') throw new Error(JSON.stringify(v));
      });
      const focused = await pg.evaluate(() => (document.activeElement || {}).id || '');
      check('A5 …and the cursor is still in the field being typed in (#fnt)', () => { if (focused !== 'fnt') throw new Error('focus on ' + JSON.stringify(focused)); });
      await pg.close();
    }
    /* A4 — Ann signs out, Bob signs in on the same tab */
    {
      menuAt = WED_OPEN;
      const pg = await fresh();
      await signIn(pg, 'CB999', 'ann-pass-1');
      await pg.click('[data-wcat="burgers"]'); await pg.click('[data-wadd="cheese_burger"]'); await pg.click('#wpReview'); await pg.waitForSelector('#fcb');
      await pg.fill('#fph', '082 555 1234'); await pg.fill('#fnt', 'Ann collects at reception'); await pg.click('#of button[type=submit]');
      await pg.waitForSelector('#wpSend'); await pg.click('#wpSend'); await pg.waitForSelector('.wp-ok');
      await pg.click('#out'); await pg.waitForSelector('#cb');
      const signedOut = await pg.evaluate(() => document.body.innerText);
      await signIn(pg, 'CB111', 'bob-pass-1');
      await pg.click('[data-wcat="burgers"]'); await pg.click('[data-wadd="cheese_burger"]'); await pg.click('#wpReview'); await pg.waitForSelector('#fcb');
      const v = await formVals(pg);
      check('A4 sign-out says so ("Signed out")', () => { if (!/Signed out/.test(signedOut)) throw new Error(signedOut.slice(0, 200)); });
      check('A4 the next person\'s form carries THEIR CB number, name and surname — not Ann\'s', () => { if (v[0] !== 'CB111' || v[1] !== 'Bob' || v[2] !== 'Jones') throw new Error(JSON.stringify(v)); });
      check('A4 …and none of Ann\'s phone number or kitchen notes', () => { if (v[3] !== '' || v[4] !== '') throw new Error(JSON.stringify(v)); });
      const left = await pg.evaluate(() => JSON.stringify({ done: typeof WDONE === 'undefined' ? null : WDONE }));
      check('A4 …and Ann\'s order slip is gone from memory', () => { if (/Ann|WIMPY ORDER/.test(left)) throw new Error(left); });
      await pg.close();
    }
    check('Wimpy: the page ran with no errors', () => { if (errs.length) throw new Error(errs[0]); });
  } catch (e) {
    bad('the Wimpy flow ran to its end', e.message);
  } finally { await b.close(); srv.close(); }
}

console.log('\n' + (checks - fails) + '/' + checks + ' checks passed' + (fails ? ' — ' + fails + ' FAILED' : ''));
process.exitCode = fails ? 1 : 0;
