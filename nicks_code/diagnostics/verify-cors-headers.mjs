#!/usr/bin/env node
/**
 * verify-cors-headers.mjs — a header the browser will not send is a silent data loss.
 *
 *   node nicks_code/diagnostics/verify-cors-headers.mjs          (static + live preflight)
 *   node nicks_code/diagnostics/verify-cors-headers.mjs --live   (also: a REAL browser POST)
 *
 * WHY THIS EXISTS. On 28 August PULSE started gzipping the state save and added
 * `Content-Encoding: gzip` to the request. Content-Encoding is not a CORS-safelisted
 * request header, and the Worker's preflight named only Content-Type, Authorization and
 * X-Cbx-Client — so for four days the browser REFUSED TO SEND the request. It never
 * reached the Worker, so no server log showed it; the state simply stopped saving and
 * every refresh reverted the floor to 27 August. The only symptom was one toast.
 *
 * Nothing caught it because every test that mattered ran in Node, and **Node does not
 * enforce CORS**. A 9 MB gzipped POST from a script returned 200 while the identical
 * request from a browser was blocked before it left. So this file does the one thing a
 * Node fetch cannot: with --live it drives a real Chromium at the real deployed origin
 * and makes it perform the real cross-origin write.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const API = 'https://chatterbox-agentos-api.chatterbox-agentos.workers.dev';
const ORIGIN = 'https://chatterbox-agentos.pages.dev';

let pass = 0, fail = 0;
const ok = (c, n, extra) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (extra !== undefined ? ' — ' + extra : '')); } };
const head = (t) => console.log('\n' + t);

/* The CORS-safelisted request headers — these never need naming in a preflight.
   Content-Type is safelisted ONLY for three media types; ours is text/plain, which is
   one of them, so it passes either way and is also named explicitly. */
const SAFELISTED = new Set(['accept', 'accept-language', 'content-language', 'content-type', 'range']);

head('A · WHAT THE CLIENTS ACTUALLY SEND');
/* Scan every file that talks to the Worker for header names set on a request. Deliberately
   crude and over-inclusive: a false positive here costs one line in the allow-list, a false
   negative costs the floor its uploads. */
const CLIENTS = ['nicks_code/index.html', 'Chatterbox_AgentOS_Analytics.html', 'agent/index.html',
  'site/auth-gate.js', 'site/ask-widget.js'];
const sent = new Map();          // header -> which files set it
for (const rel of CLIENTS) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) continue;
  const src = fs.readFileSync(p, 'utf8');
  /* only look at files that speak to the Worker at all */
  if (!src.includes('chatterbox-agentos-api')) continue;
  for (const m of src.matchAll(/['"]([A-Za-z][A-Za-z0-9-]{2,30})['"]\s*:\s*['"`]/g)) {
    const h = m[1].toLowerCase();
    if (!/^(content-|x-|authorization$|accept)/.test(h)) continue;
    if (!sent.has(h)) sent.set(h, new Set());
    sent.get(h).add(rel);
  }
  for (const m of src.matchAll(/hdr\[['"]([A-Za-z][A-Za-z0-9-]+)['"]\]\s*=/g)) {
    const h = m[1].toLowerCase();
    if (!sent.has(h)) sent.set(h, new Set());
    sent.get(h).add(rel);
  }
}
console.log('  headers the clients set: ' + [...sent.keys()].sort().join(', '));

head('B · THE LIVE PREFLIGHT NAMES EVERY ONE OF THEM');
const pre = await fetch(API + '/api/kv?key=vas-state', { method: 'OPTIONS', headers: {
  Origin: ORIGIN, 'Access-Control-Request-Method': 'POST',
  'Access-Control-Request-Headers': [...sent.keys()].join(','),
} });
const allowRaw = pre.headers.get('access-control-allow-headers') || '';
const allow = new Set(allowRaw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
ok(pre.status === 204 || pre.status === 200, 'the preflight answers', pre.status);
ok(allow.size > 0, 'it returns an allow-list: ' + allowRaw);
for (const [h, files] of [...sent].sort()) {
  if (SAFELISTED.has(h)) { pass++; console.log('  ok   ' + h + ' is CORS-safelisted — no preflight entry needed'); continue; }
  ok(allow.has(h), h + ' is allowed by the preflight (set in ' + [...files].join(', ') + ')',
    'THE BROWSER WILL REFUSE TO SEND THIS REQUEST. Add ' + h + ' to Access-Control-Allow-Headers in worker/src/index.mjs, and stop the client sending it — a preflight is cached for 24h.');
}
ok(allow.has('content-encoding'),
  'content-encoding is allowed — the header that broke the state save on 28 Aug');

head('C · THE STATE SAVE NO LONGER SETS Content-Encoding AT ALL');
/* Belt and braces to the allow-list: a cached preflight keeps a browser on the OLD answer
   for 24 hours, so the client must not need the new entry to work. The Worker decides gzip
   by the magic bytes, so the header is not needed for anything. */
const pulse = fs.readFileSync(path.join(ROOT, 'nicks_code', 'index.html'), 'utf8');
ok(!/hdr\[['"]Content-Encoding['"]\]\s*=/i.test(pulse),
  'PULSE does not set Content-Encoding on the save');
ok(/CompressionStream/.test(pulse), '...but it still gzips — the saving is in the bytes, not the header');
const worker = fs.readFileSync(path.join(ROOT, 'worker', 'src', 'index.mjs'), 'utf8');
ok(/u8\[0\] === 0x1f && u8\[1\] === 0x8b/.test(worker),
  'the Worker still detects gzip by the magic bytes, so no header is required');

if (process.argv.includes('--live')) {
  head('D · A REAL BROWSER, THE REAL ORIGIN, A REAL CROSS-ORIGIN WRITE');
  /* The only check that would have caught this. Node ignores CORS; Chromium does not. */
  const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, 'supabase.env'), 'utf8')
    .split(/\r?\n/).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
  const H = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY, 'Content-Type': 'application/json' };
  const REST = env.SUPABASE_URL + '/rest/v1/';
  const u = (await (await fetch(REST + 'app_users?username=eq.aarav&select=id', { headers: H })).json())[0];
  const token = crypto.randomBytes(32).toString('hex');
  const th = crypto.createHash('sha256').update(token).digest('hex');
  await fetch(REST + 'app_sessions', { method: 'POST', headers: { ...H, Prefer: 'return=minimal' },
    body: JSON.stringify([{ token_hash: th, user_id: u.id, expires_at: new Date(Date.now() + 300000).toISOString(), user_agent: 'verify-cors' }]) });
  const { chromium } = await import(pathToFileURL(path.join(HERE, 'node_modules', 'playwright', 'index.mjs')).href);
  const b = await chromium.launch();
  try {
    const page = await b.newPage();
    await page.goto(ORIGIN + '/pulse/', { waitUntil: 'domcontentloaded' });
    /* Writes to a throwaway key, never vas-state. */
    const res = await page.evaluate(async ({ api, tok }) => {
      const payload = JSON.stringify({ probe: 'cors', pad: 'x'.repeat(400000) });
      const gz = await new Response(new Blob([payload]).stream().pipeThrough(new CompressionStream('gzip'))).blob();
      const out = {};
      for (const [label, body, extra] of [
        ['plain', payload, {}],
        ['gzip, no Content-Encoding', gz, {}],
        ['gzip + Content-Encoding', gz, { 'Content-Encoding': 'gzip' }],
      ]) {
        try {
          const r = await fetch(api + '/api/kv?key=zz-cors-probe', { method: 'POST',
            headers: { 'Content-Type': 'text/plain', Authorization: 'Bearer ' + tok, 'X-Cbx-Client': 'v5', ...extra },
            body });
          out[label] = 'HTTP ' + r.status;
        } catch (e) { out[label] = 'BLOCKED: ' + String(e.message || e).slice(0, 90); }
      }
      return out;
    }, { api: API, tok: token });
    for (const [k, v] of Object.entries(res)) console.log('    ' + k.padEnd(28) + v);
    ok(res['plain'] === 'HTTP 200', 'a plain body is accepted from the browser');
    ok(res['gzip, no Content-Encoding'] === 'HTTP 200',
      'a GZIPPED body with no Content-Encoding is accepted — this is the path PULSE now uses',
      res['gzip, no Content-Encoding']);
    ok(res['gzip + Content-Encoding'] === 'HTTP 200',
      'and the header is legal too, now that the preflight names it', res['gzip + Content-Encoding']);
  } finally {
    await b.close();
    await fetch(REST + 'app_sessions?token_hash=eq.' + th, { method: 'DELETE', headers: H });
    console.log('\n  (temporary session deleted)');
  }
} else {
  console.log('\n(run with --live to make a real browser perform the cross-origin write)');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
/* exitCode, not exit(): a hard exit while Playwright's handles are still closing prints a
   libuv assertion on Windows that reads like a test failure and is not one. */
process.exitCode = fail ? 1 : 0;
