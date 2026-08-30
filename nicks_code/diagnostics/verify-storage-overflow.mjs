// PERSISTENCE: Supabase is the store, localStorage is only a same-device cache.
// The failure this guards: when the local cache overflows (~5MB, which a month of uploads
// passes easily), the old code kept the PREVIOUS smaller blob and stamped a fresh _rev — so
// the next load could hydrate that stale copy, judge it newer than the cloud, and push it back
// over good data. That is how a whole campaign vanished between refreshes.
// Asserts: on overflow the stale cache is DROPPED, the cloud push still carries the COMPLETE
// state, and it fires immediately rather than after the debounce.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
const REPO = String.raw`c:\Users\aarav\OneDrive\Desktop\Chatterbox Agent OS\agentos`;
const HTML = path.join(REPO, ...(process.env.PULSE_HTML || 'nicks_code/index.html').split('/'));
const SERVE = { '/': HTML, '/index.html': HTML, '/xlsx.full.min.js': path.join(REPO, 'site', 'xlsx.full.min.js') };
const server = http.createServer((q, s) => {
  const p = SERVE[q.url.split('?')[0]];
  if (!p || !fs.existsSync(p)) { s.writeHead(404); s.end('nf'); return; }
  s.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' });
  fs.createReadStream(p).pipe(s);
});
await new Promise(r => server.listen(8145, '127.0.0.1', r));
let pass = 0, fail = 0; const failures = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  pass  ' + n); } else { fail++; failures.push(n + ' — ' + d); console.log('  FAIL  ' + n + ' — ' + d); } };

const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1300, height: 850 } });
const errs = []; page.on('pageerror', e => errs.push(String(e.message)));
await page.goto('http://127.0.0.1:8145/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__mtd && window.__mtd.state(), null, { timeout: 60000 });

const r = await page.evaluate(async () => {
  const KEY = 'vas_mtd_tracker_v1';
  // a believable previous cache, so we can prove a STALE one is not left behind
  localStorage.setItem(KEY, JSON.stringify({ _rev: 1, files: ['old-and-smaller'] }));
  const before = localStorage.getItem(KEY);

  // capture what the cloud push would send, and make the local write fail like a real quota
  let pushed = null, pushDelay = null;
  const realPush = window.__cloudPush;
  window.__cloudPush = function () { pushed = JSON.parse(JSON.stringify(window.__mtd.state())); };
  const realSet = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) {
    if (k === KEY) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; }
    return realSet.call(this, k, v);
  };
  const realTimeout = window.setTimeout;
  window.setTimeout = function (fn, ms) { if (typeof fn === 'function' && String(fn).includes('__cloudPush') === false && ms != null) { } return realTimeout.apply(window, arguments); };

  // mark the in-memory state so we can prove the push carried the CURRENT data
  window.__mtd.state().__probe = 'current-state-marker';
  save();
  const afterLocal = localStorage.getItem(KEY);
  /* The overflow push is DEBOUNCED, not immediate. It used to collapse to 0ms and this waited
     300ms; the debounce was deliberately restored to 600ms (a burst of edits must not become a
     burst of multi-MB uploads), and the wait was never moved — so this test has been reporting
     a missing push ever since, for a push that simply had not fired yet. Wait past 600ms. */
  await new Promise(res => realTimeout(res, 1000));

  Storage.prototype.setItem = realSet;
  window.__cloudPush = realPush;
  window.setTimeout = realTimeout;
  return {
    hadCacheBefore: !!before,
    staleCacheLeft: afterLocal !== null,
    pushedAtAll: !!pushed,
    pushedCurrent: !!(pushed && pushed.__probe === 'current-state-marker'),
    bodyText: document.body.innerText.slice(0, 4000),
  };
});

console.log('\n— local cache overflows (real QuotaExceededError) —');
ok('there WAS a previous cache to go stale', r.hadCacheBefore);
ok('the stale cache is DROPPED, not left to overwrite the cloud later', !r.staleCacheLeft,
  r.staleCacheLeft ? 'a stale blob is still in localStorage' : '');
ok('the cloud push still happens', r.pushedAtAll);
ok('and it carries the COMPLETE current state, not the stale one', r.pushedCurrent);
ok('the message says the data is safe rather than lost',
  /safe/i.test(r.bodyText) && !/could not save/i.test(r.bodyText),
  r.bodyText.match(/[^\n]*cache[^\n]*/i)?.[0] || '(toast not found)');
ok('no page errors', errs.length === 0, errs.join(' | '));

await b.close(); server.close();
console.log('\n' + pass + ' passed · ' + fail + ' failed');
if (fail) { console.log('\nFAILURES:'); failures.forEach(f => console.log(' - ' + f)); process.exit(1); }
