/**
 * THE VIEW IS ONE PERSON'S, THE DATA IS EVERYONE'S.
 *
 * VAS mirrors its whole state to a SHARED cloud blob (kv:vas-state). `S.ui` — the period
 * preset, the team and campaign filters, the open tab — used to ride along in that push and
 * be adopted wholesale on hydrate. So whoever last uploaded a file stamped their way of
 * looking at the numbers onto everybody:
 *
 *     someone left the period on "yesterday", uploaded a file, and the whole floor opened
 *     the dashboard on a single day. Enoch read 4 sales against 176 for the month, every
 *     total was a twentieth of itself, and it looked exactly like the data being broken
 *     rather than the window onto it. A stuck dailyFilter {tl:'Dhamendra Budhu'} rode along
 *     with it.
 *
 * Nothing on screen says "you are looking at one day out of twenty-one", which is what makes
 * this worth a test rather than a memo.
 *
 * THAT WAS ONLY HALF OF IT. Keeping the view out of the shared blob stops it travelling
 * between DEVICES. It does nothing on a shared workstation, where localStorage belongs to the
 * browser and not to the login: sign-out drops the session token and leaves the view behind,
 * so the next person to sign in on that machine opens on the previous person's period, team
 * and campaign. Reported 26 Aug as "an admin changes the filter and it changes for everyone".
 * The second half of this file pins that down — the view is filed per user, the state cache
 * carries none of it, and the old unscoped key is gone.
 *
 *     node nicks_code/diagnostics/verify-view-is-local.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

const REPO = process.env.AGENTOS || decodeURIComponent(new URL('../..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1').replace(/\/$/, '');   // repo-relative (2026-09-08): the laptop path failed every cloud run
/* path.resolve, not join — PULSE_HTML is often an absolute path to a build under test, and
   joining that onto REPO silently yields a file that does not exist (a 404, an empty page,
   and a timeout that looks like a product failure). */
const HTML = path.resolve(REPO, process.env.PULSE_HTML || 'nicks_code/index.html');
if (!fs.existsSync(HTML)) { console.error('no such file: ' + HTML); process.exit(2); }

let pass = 0; const fails = [];
const ok = (n, c, d) => { if (c) { pass++; console.log('  ok   ' + n); }
  else { fails.push(n + (d ? ' — ' + d : '')); console.log('  FAIL ' + n + (d ? ' — ' + d : '')); } };

const SERVE = { '/': HTML, '/index.html': HTML, '/xlsx.full.min.js': path.join(REPO, 'site', 'xlsx.full.min.js') };
const server = http.createServer((q, s) => { const p = SERVE[q.url.split('?')[0]];
  if (!p || !fs.existsSync(p)) { s.writeHead(404); s.end('nf'); return; }
  s.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' });
  fs.createReadStream(p).pipe(s); });
await new Promise(r => server.listen(8181, '127.0.0.1', r));

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message));
page.on('dialog', d => d.accept());

/* Catch the push before it leaves, so we can read exactly what would have been sent. */
await page.addInitScript(() => {
  window.__sent = [];
  const f = window.fetch;
  window.fetch = function (u, o) {
    /* The body may now be a GZIPPED Blob (uploads are compressed since 2026-08-28), so keep
       the raw value and decode it in the assertion rather than String()-ing a Blob. */
    try { if (String(u).includes('key=vas-state') && o && o.method === 'POST') window.__sent.push(o.body); } catch (e) {}
    return f.apply(this, arguments);
  };
});
await page.goto('http://127.0.0.1:8181/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__mtd && window.__mtd.state(), null, { timeout: 30000 });

console.log('\n— the push —');
{
  const r = await page.evaluate(async () => {
    const S = window.__mtd.state();
    S.ui.preset = 'yesterday'; S.ui.dailyFilter = { tl: 'Someone Else' };
    S.files = [{ name: 'x', type: 'roster' }];                 // the refuse-empty-state guard
    window.__vasHydrated = true;
    try { sessionStorage.setItem('cbx_token', 'test-token'); } catch (e) {}
    window.__sent = [];
    __cloudPush(false);
    /* the push compresses first, so it lands a tick later than it used to */
    for (let i = 0; i < 60 && !window.__sent.length; i++) await new Promise(r2 => setTimeout(r2, 50));
    let body = window.__sent[0];
    if (body && typeof body !== 'string') {                    // a gzipped Blob — inflate it
      try { body = await new Response(body.stream().pipeThrough(new DecompressionStream('gzip'))).text(); }
      catch (e) { try { body = await body.text(); } catch (e2) { body = ''; } }
    }
    body = body || '';
    let parsed = null; try { parsed = JSON.parse(body); } catch (e) {}
    return { sent: !!body, parsedOk: !!parsed, hasUi: !!(parsed && parsed.ui), stillLocal: S.ui && S.ui.preset };
  });
  ok('a push actually happened (the test is not vacuous)', r.sent);
  ok('the pushed body is readable JSON (gzip round-trips intact)', r.parsedOk, JSON.stringify(r));
  ok('the shared blob carries no view state', r.sent && r.parsedOk && !r.hasUi);
  ok('the push does not damage this tab\'s own view', r.stillLocal === 'yesterday', 'preset is now ' + r.stillLocal);
}

console.log('\n— the hydrate —');
{
  /* hydrate() needs a token and a live endpoint, so the adopt step is checked at the source.
     Running a COPY of the statement here would only prove the copy works — which is exactly
     what an earlier version of this file did, and it passed against the broken build. */
  const src = fs.readFileSync(HTML, 'utf8');
  const adopt = src.slice(src.indexOf('// cloud is same-or-newer'), src.indexOf('window.__vasHydrated=true;', src.indexOf('// cloud is same-or-newer')));
  ok('the adopt path exists where expected', adopt.length > 0 && adopt.includes('Object.assign(S,cloud)'));
  ok('adopting the cloud blob preserves this device\'s view',
    /var\s+__keepUi\s*=\s*S\.ui[\s\S]*Object\.assign\(S,cloud\)[\s\S]*S\.ui\s*=\s*__keepUi/.test(adopt),
    'the adopt statement does not carry the local ui across');
}

console.log('\n— the buttons still work —');
{
  const r = await page.evaluate(() => {
    window.__mtd.setPreset('yesterday');
    const after = window.__mtd.state().ui.preset;
    window.__mtd.setPeriod('2026-08', 'calendar');
    return { after, back: window.__mtd.state().ui.preset };
  });
  /* rebuild() runs inside setPreset — if the one-day reset lived in normalizeState it would
     fight the button here and this is the check that would catch it. */
  ok('pressing Yesterday still selects yesterday', r.after === 'yesterday', 'preset became ' + r.after);
  ok('picking a month still selects the month', r.back === 'month', 'preset became ' + r.back);
}

console.log('\n— a stale one-day preset does not survive a reload —');
{
  const src = fs.readFileSync(HTML, 'utf8');
  ok('the boot path resets a saved today/yesterday preset',
    /if\(S\.ui\.preset===['"]today['"]\|\|S\.ui\.preset===['"]yesterday['"]\)\s*S\.ui\.preset=['"]month['"]/.test(src));
  ok('that reset is NOT in normalizeState (it would fight the button)',
    !/function normalizeState\(\)[\s\S]*?yesterday[\s\S]*?\n\}/.test(src.slice(src.indexOf('function normalizeState()'), src.indexOf('function normalizeState()') + 4000)));
}

console.log('\n— the view is filed per LOGIN, not per browser —');
{
  const src = fs.readFileSync(HTML, 'utf8');
  ok('saveUI writes to a per-user key', /function saveUI\(\)\{[\s\S]{0,200}setItem\(uiKey\(\)/.test(src));
  ok('the key is built from the signed-in user', /function uiKey\(\)\{\s*return STORE_KEY\+':ui:'\+uiWho\(\)/.test(src));
  ok('an anonymous session gets its own bucket, not a named one',
    /u\.id\|\|u\.username\|\|'anon'/.test(src));
  ok('the retired unscoped key is deleted, never migrated',
    /removeItem\(STORE_KEY\+':ui'\)/.test(src));
  ok('login adopts that user\'s own view', /addEventListener\('cbx-authed'[\s\S]{0,80}adoptUserView/.test(src));
}

console.log('\n— one browser, two people —');
{
  /* Drive the real thing: set a filter as one user, then become another and reload, which is
     exactly what a shared workstation does. The bug is inheritance, so the assertion is that
     user B lands on the DEFAULTS — and, separately, that user A still gets their own back. */
  const setAs = async (user, mutate) => {
    await page.evaluate(u => { window.CBX_USER = u; }, user);
    if (mutate) await page.evaluate(mutate);
    await page.evaluate(() => { if (typeof saveUI === 'function') saveUI(); });
  };

  await setAs({ id: 'u-admin', username: 'nick' }, () => {
    const S = window.__mtd.state();
    S.ui.team = 'Denise Haripersad'; S.ui.camp = 'Cuddle'; S.ui.tab = 'variance';
  });
  const adminSaved = await page.evaluate(() => window.__mtd.state().ui.team);
  ok('the admin\'s filter is set', adminSaved === 'Denise Haripersad', 'team is ' + adminSaved);

  const keys = await page.evaluate(() => Object.keys(localStorage).filter(k => k.includes(':ui')));
  ok('it was stored under the admin, not the shared key',
    keys.some(k => k.endsWith(':ui:u-admin')) && !keys.some(k => /:ui$/.test(k)),
    'keys: ' + JSON.stringify(keys));

  // a second person signs in on the SAME browser
  await page.evaluate(() => { window.CBX_USER = { id: 'u-tl', username: 'thandi' }; });
  await page.evaluate(() => {
    const S = window.__mtd.state();
    S.ui.team = ''; S.ui.camp = ''; S.ui.tab = 'dashboard';       // fresh defaults
    if (typeof loadUI === 'function') loadUI();                    // what boot + cbx-authed do
  });
  const inherited = await page.evaluate(() => {
    const u = window.__mtd.state().ui; return { team: u.team, camp: u.camp, tab: u.tab };
  });
  ok('the next person does NOT inherit the admin\'s team filter', inherited.team === '', 'got ' + inherited.team);
  ok('nor the campaign filter', inherited.camp === '', 'got ' + inherited.camp);
  ok('nor the tab they were left on', inherited.tab !== 'variance', 'got ' + inherited.tab);

  // and the admin still gets their own view back
  await page.evaluate(() => { window.CBX_USER = { id: 'u-admin', username: 'nick' }; if (typeof loadUI === 'function') loadUI(); });
  const back = await page.evaluate(() => window.__mtd.state().ui.team);
  ok('the admin gets their own view back on their next login', back === 'Denise Haripersad', 'got ' + back);
}

console.log('\n— the state cache carries no view either —');
{
  const cached = await page.evaluate(() => {
    if (typeof save === 'function') save();
    const raw = localStorage.getItem('vas_mtd_tracker_v1');
    if (!raw) return { skipped: true };
    try { return { hasUi: 'ui' in JSON.parse(raw) }; } catch (e) { return { unparsable: true }; }
  });
  /* On a device whose quota is already full the cache write is dropped by design, and there is
     then nothing to inspect — say so rather than passing vacuously. */
  ok('the cached state blob has no ui key',
    cached.skipped ? true : cached.hasUi === false,
    cached.skipped ? '(no cache written — quota)' : 'ui survived into the cache');
  if (cached.skipped) console.log('       note: cache not written on this run, so this check was vacuous');
}

ok('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close(); server.close();
console.log(`\n==== ${pass} passed, ${fails.length} failed ====`);
if (fails.length) { console.log(fails.map(f => '  · ' + f).join('\n')); process.exit(1); }
