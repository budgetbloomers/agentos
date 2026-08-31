#!/usr/bin/env node
/**
 * verify-live-save.mjs — a real browser, the real origin, the real save.
 *
 *   node nicks_code/diagnostics/verify-live-save.mjs --live
 *
 * Phase 3b of specs/save-reliability-plan.md, and the post-deploy smoke test:
 * the ONE check that would have caught the 28 Aug CORS refusal on the day it
 * shipped. Node fetch proves nothing here — Node does not enforce CORS, so the
 * exact request a browser refuses returns 200 from a script. This drives real
 * Chromium at the deployed Pages origin and makes the page itself perform the
 * write the apps perform: a gzipped POST to /api/kv, read back, deleted.
 *
 * It also proves the write LOG (P2a): the acknowledged save must appear as a
 * row in kv_write_log, because that row is what the freshness sentinel and any
 * future "when did saves stop" question stand on.
 *
 * Writes only to a zz- probe key. Mints a 5-minute session and deletes it in a
 * finally, the verify-cm-live pattern.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

if (!process.argv.includes('--live')) {
  console.log('Drives a real browser against PRODUCTION (writes only a zz- probe key).\nRe-run with --live to confirm.');
  process.exit(0);
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const API = 'https://chatterbox-agentos-api.chatterbox-agentos.workers.dev';
const ORIGIN = 'https://chatterbox-agentos.pages.dev';
const KEY = 'zz-live-save';

let pass = 0, fail = 0;
const ok = (c, n, extra) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (extra !== undefined ? ' — ' + extra : '')); } };

const env = {};
for (const line of fs.readFileSync(path.join(ROOT, 'supabase.env'), 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z_]+)=(.*)$/.exec(line.trim()); if (m) env[m[1]] = m[2];
}
const H = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY, 'Content-Type': 'application/json' };
const REST = env.SUPABASE_URL + '/rest/v1/';

const u = (await (await fetch(REST + 'app_users?username=eq.aarav&select=id', { headers: H })).json())[0];
const token = crypto.randomBytes(32).toString('hex');
const th = crypto.createHash('sha256').update(token).digest('hex');
await fetch(REST + 'app_sessions', { method: 'POST', headers: { ...H, Prefer: 'return=minimal' },
  body: JSON.stringify([{ token_hash: th, user_id: u.id, expires_at: new Date(Date.now() + 300000).toISOString(), user_agent: 'verify-live-save' }]) });

const { chromium } = await import(pathToFileURL(path.join(HERE, 'node_modules', 'playwright', 'index.mjs')).href);
const b = await chromium.launch();
try {
  const page = await b.newPage();
  await page.goto(ORIGIN + '/pulse/', { waitUntil: 'domcontentloaded' });

  const stamp = 'live-save-' + Date.now();
  const res = await page.evaluate(async ({ api, tok, key, stamp }) => {
    const out = {};
    const payload = JSON.stringify({ probe: stamp, pad: 'x'.repeat(500000) });
    try {
      /* the exact shape both apps now send: gzipped bytes, NO Content-Encoding */
      const gz = await new Response(new Blob([payload]).stream().pipeThrough(new CompressionStream('gzip'))).blob();
      const w = await fetch(api + '/api/kv?key=' + key, { method: 'POST',
        headers: { 'Content-Type': 'text/plain', Authorization: 'Bearer ' + tok, 'X-Cbx-Client': 'v5' }, body: gz });
      out.write = w.status;
      const r = await fetch(api + '/api/kv?key=' + key, { headers: { Authorization: 'Bearer ' + tok, 'X-Cbx-Client': 'v5' } });
      out.read = r.status;
      const body = await r.text();
      out.roundTrip = body === payload;
      out.bytes = body.length;
      const d = await fetch(api + '/api/kv?key=' + key, { method: 'DELETE',
        headers: { Authorization: 'Bearer ' + tok, 'X-Cbx-Client': 'v5' } });
      out.del = d.status;
    } catch (e) { out.blocked = String(e && e.message || e).slice(0, 120); }
    return out;
  }, { api: API, tok: token, key: KEY, stamp });

  ok(!res.blocked, 'the browser was allowed to SEND the save at all — the thing CORS silently forbade for four days', res.blocked);
  ok(res.write === 200, 'the gzipped write is accepted (' + res.write + ')');
  ok(res.read === 200 && res.roundTrip, 'reading it back returns the EXACT bytes that were saved (' + res.bytes + ' plain)');
  ok(res.del === 200, 'the probe cleaned itself up (' + res.del + ')');

  /* the acknowledged write must be on the ledger */
  await new Promise((r) => setTimeout(r, 1500));            // waitUntil'd insert
  const log = await (await fetch(REST + 'kv_write_log?key=eq.' + KEY + '&order=at.desc&limit=1&select=key,bytes,username,at', { headers: H })).json();
  ok(log.length === 1 && log[0].username === 'aarav' && log[0].bytes > 400000,
    'the save is on the write ledger (kv_write_log) with who and how much',
    JSON.stringify(log));
} finally {
  await b.close();
  await fetch(REST + 'app_sessions?token_hash=eq.' + th, { method: 'DELETE', headers: H });
  console.log('\n(temporary session deleted)');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
