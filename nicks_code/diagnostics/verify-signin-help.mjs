// "20+ agents cannot log in with their CB number and agentos123" (10 Nov 2026). The stored passwords were right and the
// server compared what arrived: between 15:00 and 15:53 twelve people sent something that was not agentos123, 39 times,
// on new Linux PCs (Firefox 136 / Chrome 112) — and from 15:51 six people got in first time. A password box shows only
// dots, so nobody could see what was wrong, and the server kept no trace of which browser or page a refusal came from.
//
// This guards the fix, in three parts:
//   A. worker/src/signin-client.mjs — the short, fixed-vocabulary label (browser | system | page | typing facts) the
//      Worker stamps on every sign-in audit row. It never carries the password or anything derived from its content.
//   B. worker/src/db.mjs — db(env, extra) sends extra headers, which is how the label reaches the auth_log row
//      (migration-070's column default reads it) without touching the SHARED-AUTH blocks Wimpy copies verbatim.
//   C. Agent Analytics' sign-in screen, driven in a real browser with every server call stubbed: a Show button, a Caps
//      Lock warning, a Number Lock warning the moment a keypad digit goes missing, the typing facts sent as `hints`, and a
//      refusal that says what to check.
// Run: node verify-signin-help.mjs     (nothing leaves this machine; no real account is touched)
import { chromium } from 'playwright';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO = process.env.AGENTOS || decodeURIComponent(new URL('../..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1').replace(/\/$/, '');
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  pass  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d ? ' — ' + d : '')); } };

/* ---------------- A · the label ---------------- */
console.log('\nA · the sign-in label (worker/src/signin-client.mjs)');
let signinClient = null;
try { ({ signinClient } = await import(pathToFileURL(path.join(REPO, 'worker/src/signin-client.mjs')).href)); } catch (e) { ok('module loads', false, e.message); }
if (signinClient) {
  const UA = {
    ff: 'Mozilla/5.0 (X11; Linux x86_64; rv:136.0) Gecko/20100101 Firefox/136.0',
    chLinux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Safari/537.36',
    edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0',
    android: 'Mozilla/5.0 (Linux; Android 14; SM-A146P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
    iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
    crios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0 Mobile/15E148 Safari/604.1',
  };
  ok('Firefox on Linux, Agent Analytics, no typing problems',
    signinClient(UA.ff, { page: '/agent/' }) === 'Firefox 136 | Linux | /agent/', signinClient(UA.ff, { page: '/agent/' }));
  ok('old Chrome on Linux is told apart from Firefox', signinClient(UA.chLinux, { page: '/agent/' }) === 'Chrome 112 | Linux | /agent/', signinClient(UA.chLinux, { page: '/agent/' }));
  ok('Edge is not reported as Chrome', signinClient(UA.edge, {}).startsWith('Edge 142 | Windows'), signinClient(UA.edge, {}));
  ok('an Android phone is Android, not Linux', signinClient(UA.android, {}).startsWith('Chrome 141 | Android'), signinClient(UA.android, {}));
  ok('an iPhone is iOS Safari', signinClient(UA.iphone, {}).startsWith('Safari 18 | iOS'), signinClient(UA.iphone, {}));
  ok('Chrome on iPhone is Chrome on iOS', signinClient(UA.crios, {}).startsWith('Chrome 141 | iOS'), signinClient(UA.crios, {}));
  const h = signinClient(UA.ff, { page: '/agent/', hints: ['numpad_off', 'caps', 'caps', 'filled', 'space'] });
  ok('typing facts are listed once each, in a fixed order', h === 'Firefox 136 | Linux | /agent/ | caps,numpad_off,filled,space', h);
  const junk = signinClient(UA.ff, { page: '/agent/', hints: ['agentos123', 'caps', '<script>', { x: 1 }, 'x'.repeat(500)] });
  ok('anything outside the four facts is dropped (a password in hints never lands)', junk === 'Firefox 136 | Linux | /agent/ | caps', junk);
  ok('hints that are not a list are ignored', signinClient(UA.ff, { page: '/agent/', hints: 'caps' }) === 'Firefox 136 | Linux | /agent/');
  ok('the password itself never appears', !signinClient(UA.ff, { page: '/agent/', password: 'agentos123', hints: ['caps'] }).includes('agentos'));
  ok('a page path that is not a plain path is reported as "other page"',
    signinClient(UA.ff, { page: '/agent/?x=<b>' }) === 'Firefox 136 | Linux | other page', signinClient(UA.ff, { page: '/agent/?x=<b>' }));
  ok('no page at all is simply left out', signinClient(UA.ff, {}) === 'Firefox 136 | Linux');
  ok('a missing user agent is "unknown browser"', signinClient('', { page: '/' }) === 'unknown browser | /', signinClient('', { page: '/' }));
  ok('a missing body does not throw', typeof signinClient(UA.ff, null) === 'string');
  const long = signinClient('Mozilla/5.0 ' + 'Z'.repeat(5000), { page: '/' + 'a'.repeat(39), hints: ['caps', 'numpad_off', 'filled', 'space'] });
  ok('the label is at most 120 characters, whatever is sent', long.length <= 120, String(long.length));
  ok('the label carries only safe characters (it goes into an HTTP header)', /^[ -~]*$/.test(signinClient(UA.ff, { page: '/agent/', hints: ['caps'] })));
}

/* ---------------- B · extra headers ---------------- */
console.log('\nB · db(env, extra) sends the extra headers (worker/src/db.mjs)');
{
  const { db } = await import(pathToFileURL(path.join(REPO, 'worker/src/db.mjs')).href);
  const seen = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => { seen.push(init.headers); return new Response('', { status: 201 }); };
  try {
    await db({ SUPABASE_URL: 'https://x.test', SUPABASE_SECRET_KEY: 'k' }, { 'x-cbx-signin': 'Firefox 136 | Linux' }).insert('auth_log', [{}]);
    await db({ SUPABASE_URL: 'https://x.test', SUPABASE_SECRET_KEY: 'k' }).insert('auth_log', [{}]);
  } finally { globalThis.fetch = real; }
  ok('a client built with extra headers sends them', seen[0] && seen[0]['x-cbx-signin'] === 'Firefox 136 | Linux', JSON.stringify(seen[0]));
  ok('…and still sends the service key and Prefer', seen[0] && seen[0].apikey === 'k' && /return=minimal/.test(seen[0].Prefer || ''));
  ok('a client built without them is unchanged', seen[1] && !('x-cbx-signin' in seen[1]));
  const idx = fs.readFileSync(path.join(REPO, 'worker/src/index.mjs'), 'utf8');
  ok('the /api/login route signs in through a client that carries the label',
    /db\(env,\s*\{\s*'x-cbx-signin':\s*signinClient\(/.test(idx), 'expected db(env, { \'x-cbx-signin\': signinClient(...) }) in index.mjs');
  const auth = fs.readFileSync(path.join(REPO, 'worker/src/auth.mjs'), 'utf8');
  ok('the SHARED-AUTH blocks Wimpy copies are not where the label is added', !/x-cbx-signin|signinClient/.test(auth));
}

/* ---------------- C · the sign-in screen ---------------- */
console.log('\nC · Agent Analytics sign-in screen');
const PORT = 8198;
const server = http.createServer((q, s) => {
  const u = q.url.split('?')[0];
  if (u === '/agent/') { s.writeHead(200, { 'Content-Type': 'text/html' }); fs.createReadStream(path.join(REPO, 'agent/index.html')).pipe(s); return; }
  s.writeHead(404); s.end();
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const browser = await chromium.launch();
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const open = async (answer = { status: 401, body: { error: 'Invalid username or password.' } }) => {
  const page = await browser.newPage({ viewport: { width: 420, height: 860 } });
  const posts = [], errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/*', async (route) => {
    const req = route.request(), u = new URL(req.url());
    if (u.hostname === '127.0.0.1') return route.continue();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    if (u.pathname === '/api/login') { posts.push(req.postDataJSON()); return route.fulfill({ status: answer.status, headers: CORS, contentType: 'application/json', body: JSON.stringify(answer.body) }); }
    return route.fulfill({ status: 401, headers: CORS, contentType: 'application/json', body: JSON.stringify({ error: 'not signed in' }) });
  });
  await page.goto('http://127.0.0.1:' + PORT + '/agent/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#pw');
  return { page, posts, errors };
};
const key = (page, init) => page.evaluate((i) => { const el = document.getElementById('pw'); el.focus();
  el.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ bubbles: true, cancelable: true }, i))); }, init);
const warn = (page) => page.evaluate(() => { const w = document.getElementById('pwWarn'); return w && getComputedStyle(w).display !== 'none' ? w.textContent : ''; });

try {
  {
    const { page, errors } = await open();
    ok('a Show button sits with the password box', await page.$('#pwShow') !== null);
    await page.fill('#pw', 'agentos123');
    await page.click('#pwShow');
    ok('Show turns the dots into the letters typed', await page.getAttribute('#pw', 'type') === 'text');
    ok('…the button then says Hide and is marked pressed', /hide/i.test(await page.textContent('#pwShow')) && await page.getAttribute('#pwShow', 'aria-pressed') === 'true');
    await page.click('#pwShow');
    ok('Hide puts the dots back', await page.getAttribute('#pw', 'type') === 'password');
    ok('the Show button is a button, so pressing it never submits', await page.getAttribute('#pwShow', 'type') === 'button');
    ok('no warning before anything is typed', (await warn(page)) === '');
    await key(page, { key: 'A', code: 'KeyA', modifierCapsLock: true });
    ok('Caps Lock on → a warning says so', /caps lock is on/i.test(await warn(page)), await warn(page));
    await key(page, { key: 'a', code: 'KeyA' });
    ok('Caps Lock off again → the warning goes', (await warn(page)) === '', await warn(page));
    await key(page, { key: 'End', code: 'Numpad1' });
    ok('a keypad digit with Number Lock off → a warning names Num Lock', /num lock/i.test(await warn(page)), await warn(page));
    await key(page, { key: '1', code: 'Numpad1' });
    ok('Number Lock back on (the keypad types digits) → the warning goes', (await warn(page)) === '', await warn(page));
    await key(page, { key: 'ArrowDown', code: 'ArrowDown' });
    ok('a real arrow key is not mistaken for a keypad key', (await warn(page)) === '');
    await key(page, { key: 'End', code: 'Numpad1', shiftKey: true });
    ok('Shift + a keypad key with Num Lock ON (also sends End) is not mistaken for Num Lock off', (await warn(page)) === '', await warn(page));
    await key(page, { key: 'End', code: 'Numpad1' });
    await key(page, { key: 'NumLock', code: 'NumLock' });
    ok('pressing Num Lock clears the warning straight away', (await warn(page)) === '', await warn(page));
    await key(page, { key: 'End', code: 'Numpad1' });
    await key(page, { key: 'a', code: 'KeyA', modifierNumLock: true });
    ok('any key that reports Num Lock on clears the warning', (await warn(page)) === '', await warn(page));
    ok('no page errors', errors.length === 0, errors.join(' | '));
    await page.close();
  }
  {
    const { page, posts } = await open();
    await page.fill('#cb', 'CB95');
    await page.click('#pw'); await page.keyboard.type('agentos123');
    await page.click('#go'); await page.waitForTimeout(300);
    ok('a normal typed sign-in sends no typing facts', posts.length === 1 && Array.isArray(posts[0].hints) && posts[0].hints.length === 0, JSON.stringify(posts[0] && posts[0].hints));
    ok('…and the password exactly as typed', posts[0] && posts[0].password === 'agentos123');
    const msg = await page.textContent('#lerr');
    ok('a refusal still shows the server\'s words', /invalid username or password/i.test(msg), msg);
    ok('…and says what to check: Caps Lock, the number keys, Show', /caps lock/i.test(msg) && /number/i.test(msg) && /show/i.test(msg), msg);
    ok('the Sign in button is usable again after a refusal', !(await page.isDisabled('#go')));
    await page.close();
  }
  {
    const { page, posts } = await open();
    await page.fill('#cb', 'CB15');
    await key(page, { key: 'End', code: 'Numpad1' });
    await key(page, { key: 'A', code: 'KeyA', modifierCapsLock: true });
    // A browser's saved password lands as a value change with an input event that is not typing (no inputType, or
    // insertReplacementText) — set it the same way rather than with fill(), which Chromium delivers as insertText.
    await page.evaluate(() => { const el = document.getElementById('pw'); el.value = 'agentos ';
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText' })); });
    await page.click('#go'); await page.waitForTimeout(300);
    const h = (posts[0] && posts[0].hints) || [];
    ok('the typing facts go with the sign-in', ['caps', 'numpad_off', 'filled', 'space'].every((x) => h.includes(x)), JSON.stringify(h));
    ok('…and nothing else is in them', h.every((x) => ['caps', 'numpad_off', 'filled', 'space'].includes(x)), JSON.stringify(h));
    ok('the password is still sent exactly as it is in the box (never trimmed or changed)', posts[0] && posts[0].password === 'agentos ');
    const msg = await page.textContent('#lerr');
    ok('a refusal names the space at the end', /space/i.test(msg), msg);
    await page.close();
  }
  {
    // A phone keyboard (Gboard) and IMEs send keydown key 'Unidentified'/'Process'; the typing shows up only as input
    // events. AltGr characters arrive with ctrlKey set. None of that is a saved password: no 'filled'.
    const { page, posts } = await open();
    await page.fill('#cb', 'CB95');
    await page.evaluate(() => { const el = document.getElementById('pw'); el.focus();
      for (const ch of 'agentos12@') {
        el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: ch === '@' ? '@' : 'Unidentified', ctrlKey: ch === '@', altKey: ch === '@' }));
        el.value += ch; el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ch }));
      } });
    await page.click('#go'); await page.waitForTimeout(300);
    ok('phone / IME / AltGr typing is not reported as a saved password', posts[0] && Array.isArray(posts[0].hints) && !posts[0].hints.includes('filled'), JSON.stringify(posts[0] && posts[0].hints));
    await page.evaluate(() => { const el = document.getElementById('pw'); el.value = '';
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
      el.value = 'agentos123'; el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste', data: null })); });
    await page.click('#go'); await page.waitForTimeout(300);
    ok('a paste is reported as filled (not typed)', posts[1] && posts[1].hints.includes('filled'), JSON.stringify(posts[1] && posts[1].hints));
    await page.close();
  }
  {
    const { page } = await open({ status: 423, body: { error: 'Account locked after repeated failures. Try again in a few minutes.' } });
    await page.fill('#cb', 'CB178'); await page.fill('#pw', 'x'); await page.click('#go'); await page.waitForTimeout(300);
    const msg = await page.textContent('#lerr');
    ok('a locked account shows the lock message, not typing tips', /locked/i.test(msg) && !/caps lock/i.test(msg), msg);
    await page.close();
  }
  {
    const { page, posts } = await open({ status: 200, body: { token: 't', user: { username: 'cb95', role: 'agent' } } });
    await page.fill('#cb', 'CB95'); await page.fill('#pw', 'agentos123'); await page.click('#go'); await page.waitForTimeout(300);
    ok('a correct sign-in still goes straight through', posts.length === 1 && posts[0].password === 'agentos123');
    await page.close();
  }
} finally {
  await browser.close(); server.close();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
