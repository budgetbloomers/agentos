#!/usr/bin/env node
/* A FAKE UPLOAD, END TO END, AGAINST PRODUCTION — does the Upload Station actually reach
 * Supabase, or only look like it did?
 *
 *   node tools/test-upload-live.mjs --live
 *
 * WHY THIS EXISTS. On 28 August PULSE started sending Content-Encoding: gzip, the header
 * was not in the Worker's CORS allow-list, and every browser silently refused to SEND the
 * save. Nothing reached Supabase, nothing appeared in any log (the requests never arrived),
 * and the dashboard showed a success toast for four days. Node proves nothing about that
 * failure: Node does not enforce CORS, so the exact request a browser refuses returns 200
 * from a script. Only a real browser at the real origin can answer the question.
 *
 * TWO PHASES, AND NEITHER TOUCHES REAL DATA:
 *
 *   1. THE NETWORK PATH — the page gzips an upload-sized payload and POSTs it to /api/kv
 *      exactly as the app does, reads it back byte for byte, and confirms the write landed
 *      in kv_write_log. It writes ONLY to a zz- probe key, which the hygiene job also
 *      cleans, and deletes it afterwards.
 *
 *   2. THE PARSE PATH — a synthetic ViciDial export is fed to the deployed app's OWN
 *      parser (window.__mtd.ingest). Every write is intercepted before it leaves the page:
 *      any POST to a real key is blocked and RECORDED, which is both the assertion (the
 *      upload tried to save) and the guarantee (it could not). Nothing fake ever enters a
 *      fact store, the manifest or a digest.
 *
 * A temporary five-minute session is minted for the probe and deleted in a finally.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

if (!process.argv.includes('--live')) {
  console.log('Drives a real browser against PRODUCTION.\nWrites only a zz- probe key; the parse phase writes nothing at all.\nRe-run with --live to confirm.');
  process.exit(0);
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const API = 'https://chatterbox-agentos-api.chatterbox-agentos.workers.dev';
const ORIGIN = 'https://chatterbox-agentos.pages.dev';
const PULSE = ORIGIN + '/pulse/';
const KEY = 'zz-upload-test';

const env = {};
for (const l of fs.readFileSync(path.join(ROOT, 'supabase.env'), 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z_]+)=(.*)$/.exec(l.trim()); if (m) env[m[1]] = m[2];
}
const REST = env.SUPABASE_URL + '/rest/v1/';
const H = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY, 'Content-Type': 'application/json' };

let pass = 0, fail = 0;
const ok = (c, n, extra) => { if (c) { pass++; console.log('  ok   ' + n); }
  else { fail++; console.log('  FAIL ' + n + (extra !== undefined ? ' — ' + extra : '')); } };

/* ---- a five-minute session for a real staff user, deleted in the finally ---- */
const users = await (await fetch(REST + 'app_users?select=id,username&role=in.(admin,exec)&limit=1', { headers: H })).json();
if (!users.length) { console.error('no staff user to mint a session for'); process.exit(1); }
const u = users[0];
const token = crypto.randomBytes(32).toString('hex');
const th = crypto.createHash('sha256').update(token).digest('hex');
await fetch(REST + 'app_sessions', { method: 'POST', headers: { ...H, Prefer: 'return=minimal' },
  body: JSON.stringify([{ token_hash: th, user_id: u.id, expires_at: new Date(Date.now() + 300000).toISOString(), user_agent: 'test-upload-live' }]) });
console.log(`session minted for ${u.username} (5 min)\n`);

const { chromium } = await import(pathToFileURL(path.join(ROOT, 'nicks_code', 'diagnostics', 'node_modules', 'playwright', 'index.mjs')).href);
const browser = await chromium.launch();

try {
  /* ================= PHASE 1 — the network path ================= */
  console.log('PHASE 1 — a real browser sends an upload-sized gzipped save to the real Worker');
  const page = await browser.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 120)));
  await page.goto(PULSE, { waitUntil: 'domcontentloaded' });

  /* An upload's state delta is megabytes, not bytes — send something that size, because
     the failure being tested was about what a browser will agree to SEND. */
  const stamp = new Date().toISOString();
  const net = await page.evaluate(async ({ api, tok, key, stamp }) => {
    const rows = [];
    for (let i = 0; i < 20000; i++) rows.push({ cb: 'CB' + (i % 300), d: '2026-08-31', calls: i % 37, sec: i % 900, probe: true });
    const body = JSON.stringify({ probe: 'upload-test', stamp, rows });
    const gz = await new Response(new Blob([body]).stream().pipeThrough(new CompressionStream('gzip'))).blob();
    const t0 = performance.now();
    const put = await fetch(api + '/api/kv?key=' + key, { method: 'POST',
      headers: { 'Content-Type': 'text/plain', Authorization: 'Bearer ' + tok, 'X-Cbx-Client': 'v5' }, body: gz });
    const ms = Math.round(performance.now() - t0);
    const back = await fetch(api + '/api/kv?key=' + key, { headers: { Authorization: 'Bearer ' + tok, 'X-Cbx-Client': 'v5' } });
    const got = back.ok ? await back.text() : '';
    return { putStatus: put.status, plain: body.length, sent: gz.size, ms,
      readBack: got.length, identical: got === body,
      parsedRows: (() => { try { return JSON.parse(got).rows.length; } catch { return -1; } })() };
  }, { api: API, tok: token, key: KEY, stamp });

  console.log(`    ${(net.plain / 1048576).toFixed(1)} MB payload → ${(net.sent / 1048576).toFixed(2)} MB gzipped, POST ${net.putStatus} in ${net.ms} ms`);
  ok(net.putStatus === 200, 'the browser was ALLOWED to send the upload-sized save', 'HTTP ' + net.putStatus);
  ok(net.identical, 'what came back is byte-for-byte what went up', net.readBack + ' bytes back vs ' + net.plain);
  ok(net.parsedRows === 20000, 'all 20 000 rows survived the round trip', net.parsedRows);

  await new Promise((r) => setTimeout(r, 1800));            // the ledger insert is waitUntil'd
  const led = await (await fetch(REST + 'kv_write_log?key=eq.' + KEY + '&select=key,bytes,username,at&order=at.desc&limit=1', { headers: H })).json();
  ok(led.length === 1, 'the write is on the server-side ledger, not just acknowledged in the tab',
    JSON.stringify(led));
  if (led.length) console.log(`    ledger: ${led[0].at.slice(0, 19)}  ${Math.round(led[0].bytes / 1024)} KB  by ${led[0].username}`);

  /* ================= PHASE 2 — the parse path, writing nothing ================= */
  console.log('\nPHASE 2 — a synthetic export through the deployed app\'s own parser (no writes)');
  const page2 = await browser.newPage();
  const errs2 = []; page2.on('pageerror', (e) => errs2.push(String(e.message).slice(0, 120)));
  await page2.goto(PULSE, { waitUntil: 'domcontentloaded' });
  await page2.waitForFunction(() => window.__mtd && window.__mtd.ingest, null, { timeout: 30000 });

  /* A ViciDial EXPORT_CALL_REPORT: tab separated, one row per call, `user` is the CB
     number and `length_in_sec` is what talk time is summed from. Dates deliberately in a
     month nobody reports on, so even a leak could not touch a live figure. */
  const synth = (() => {
    const head = ['call_date', 'user', 'full_name', 'status', 'lead_id', 'length_in_sec', 'campaign_id'].join('\t');
    const rows = [head];
    for (let i = 0; i < 500; i++)
      rows.push(['2019-01-0' + (1 + (i % 5)) + ' 09:' + String(i % 60).padStart(2, '0') + ':00',
        'CB' + (900 + (i % 5)), 'Probe Agent ' + (i % 5), 'SALE', 'L' + i, 30 + (i % 400), 'PROBE'].join('\t'));
    return rows.join('\n');
  })();

  const parse = await page2.evaluate(async (text) => {
    /* THE SAFETY NET IS ALSO THE ASSERTION. Every route out of the page is blocked and
       recorded: if the upload tries to persist, we see the attempt and it does not land. */
    const attempts = [];
    const realFetch = window.fetch;
    window.fetch = (input, init) => {
      const url = String((input && input.url) || input || '');
      const method = ((init && init.method) || 'GET').toUpperCase();
      if (method === 'POST' && /\/api\/(kv|upload-archive|roster)/.test(url)) {
        attempts.push({ url: url.split('?')[0], key: (url.match(/key=([^&]+)/) || [])[1] || null,
          bytes: (init && init.body && (init.body.size || init.body.length)) || 0 });
        return Promise.resolve(new Response('{"ok":true}', { status: 200 }));   // never leaves the tab
      }
      return realFetch(input, init);
    };
    if (window.storage) { window.storage.set = async () => { attempts.push({ url: 'storage.set' }); return true; }; }

    const before = (window.__mtd.state().files || []).length;
    let result = null, error = null;
    try { result = await window.__mtd.ingest('EXPORT_CALL_REPORT_probe.txt', text, null, 'probe-hash'); }
    catch (e) { error = String(e && e.message || e); }
    /* the save is debounced behind the render — give it room to fire */
    await new Promise((r) => setTimeout(r, 4000));
    const S = window.__mtd.state();
    const after = (S.files || []).length;
    const vici = S.vici || {};
    const rangeKeys = Object.keys(vici);
    window.fetch = realFetch;
    return { result, error, before, after, attempts,
      dirtySince: window.__vasDirtySince || null, saveOk: window.__vasSaveOk || null,
      rangeKeys: rangeKeys.slice(0, 3), rangeCount: rangeKeys.length,
      newestFile: (S.files || []).slice(-1)[0] || null };
  }, synth);

  ok(!parse.error, 'the deployed parser accepted a ViciDial export without throwing', parse.error);
  ok(parse.result !== false, 'the file was recognised as a source, not rejected', 'ingest returned ' + JSON.stringify(parse.result));
  ok(parse.after > parse.before, 'the upload registered as a file on the session',
    parse.before + ' → ' + parse.after);
  ok(parse.attempts.length > 0 || parse.dirtySince, 'the upload TRIED to persist — the save path fires on an upload',
    'attempts ' + JSON.stringify(parse.attempts).slice(0, 120) + ' dirtySince ' + parse.dirtySince);
  const keysTouched = [...new Set(parse.attempts.map((a) => a.key).filter(Boolean))];
  console.log('    save attempts intercepted: ' + parse.attempts.length
    + (keysTouched.length ? ' (keys: ' + keysTouched.join(', ') + ')' : ''));
  if (parse.newestFile) console.log('    session file entry: ' + JSON.stringify(parse.newestFile).slice(0, 140));

  ok(errs.length === 0 && errs2.length === 0, 'no page errors in either phase',
    errs.concat(errs2).slice(0, 2).join(' | '));

  /* ---- confirm phase 2 really wrote nothing ---- */
  const after = await (await fetch(REST + 'kv_write_log?select=key,at&order=at.desc&limit=6', { headers: H })).json();
  const leaked = after.filter((r) => r.key !== KEY && Date.parse(r.at) > Date.parse(stamp));
  ok(leaked.length === 0, 'phase 2 left nothing in the live store', JSON.stringify(leaked));

} finally {
  await browser.close();
  await fetch(API + '/api/kv?key=' + KEY, { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } }).catch(() => {});
  await fetch(REST + 'kv_write_log?key=eq.' + KEY, { method: 'DELETE', headers: H }).catch(() => {});
  await fetch(REST + 'app_sessions?token_hash=eq.' + th, { method: 'DELETE', headers: H }).catch(() => {});
  console.log('\n  (probe key, ledger row and temporary session removed)');
}

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
