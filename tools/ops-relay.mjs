#!/usr/bin/env node
/**
 * ops-relay.mjs — let the Ops dashboard ingest the archive without anyone opening it.
 *
 *   node tools/ops-relay.mjs            # boot, relay, report; exits 1 if a save was refused
 *   node tools/ops-relay.mjs --wait 300 # seconds to allow (default 240)
 *
 * WHY THIS EXISTS (never-stale plan, Phase 0, 2026-09-07). AgentOS Analytics parses every
 * export in the browser: it pulls unseen files from the upload archive (syncUploadsFromVAS)
 * about two minutes after boot, runs each through its own detect → parse → load, and saves
 * the fact stores. That only happens while somebody has an Ops tab open and their saves
 * land — from 4 to 7 September nobody's did, and Ops sat five days behind the archive.
 * Rewriting nine parsers server-side is not on; running the REAL page headlessly is. This
 * boots the deployed Ops page in Chromium under a short-lived service session, waits for
 * the relay to go quiet, and reports every fact store it wrote and every save that failed.
 *
 * Nothing local: it runs from the scheduled GitHub workflow (publish-digests.yml) on the
 * same cadence as the digests. The session it mints is deleted on the way out.
 */
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = await import(pathToFileURL(path.join(ROOT, 'nicks_code', 'diagnostics', 'node_modules', 'playwright', 'index.mjs')).href);
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, 'supabase.env'), 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#'))
  .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^"|"$/g, '')]));
const H = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY, 'Content-Type': 'application/json' };
const REST = env.SUPABASE_URL + '/rest/v1/';
const SITE = process.env.CBX_SITE || 'https://chatterbox-agentos.pages.dev/';
const wi = process.argv.indexOf('--wait'); const MAX_WAIT = (wi > 0 ? +process.argv[wi + 1] : 240) * 1000;

/* a service session: the first active admin, 15 minutes, deleted in finally */
const admin = (await (await fetch(REST + 'app_users?role=eq.admin&active=is.true&select=id,username&order=created_at.asc&limit=1', { headers: H })).json())[0];
if (!admin) { console.error('no active admin account to run as'); process.exit(2); }
const token = crypto.randomBytes(32).toString('hex'); const th = crypto.createHash('sha256').update(token).digest('hex');
await fetch(REST + 'app_sessions', { method: 'POST', headers: { ...H, Prefer: 'return=minimal' },
  body: JSON.stringify([{ token_hash: th, user_id: admin.id, expires_at: new Date(Date.now() + 900000).toISOString(), user_agent: 'ops-relay' }]) });

const before = Object.fromEntries((await (await fetch(REST + 'rules?key=like.' + encodeURIComponent('kv:cb-facts-%') + '&select=key,updated_at', { headers: H })).json()).map((r) => [r.key, r.updated_at]));
const b = await chromium.launch({ args: ['--js-flags=--max-old-space-size=8192'] });
let failed = 0;
try {
  const page = await b.newPage({ viewport: { width: 1600, height: 1000 } });
  const writes = [], pulls = []; let lastActivity = Date.now(); const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
  page.on('response', async (r) => {
    const u = r.url(); const m = r.request().method();
    if (/\/api\/upload-file\?/.test(u)) { pulls.push(r.status()); lastActivity = Date.now(); }
    if (/\/api\/kv\?key=cb-facts-/.test(u) && m === 'POST') {
      let body = ''; try { body = (await r.text()).slice(0, 160); } catch {}
      writes.push({ key: decodeURIComponent((/key=([^&]+)/.exec(u) || [])[1] || ''), status: r.status(), body }); lastActivity = Date.now();
      if (r.status() >= 400) failed++;
    }
  });
  await page.addInitScript((t) => { sessionStorage.setItem('cbx_token', t); }, token);
  await page.goto(SITE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.acStats === 'function', null, { timeout: 90000 });
  console.log('Ops booted as ' + admin.username + ' — waiting for the upload relay');
  /* the relay starts ~2 min after boot; then keep going until it has been quiet for 30 s */
  const t0 = Date.now();
  while (Date.now() - t0 < MAX_WAIT) {
    await page.waitForTimeout(5000);
    const quietFor = Date.now() - lastActivity;
    if (pulls.length && quietFor > 30000) break;
  }
  const st = await page.evaluate(() => ({ facts: Object.fromEntries(Object.entries(state.facts || {}).map(([k, v]) => [k, (v || []).length])), seen: Object.keys(state.syncedUploads || {}).length }));
  console.log('archive files pulled: ' + pulls.length + ' (' + pulls.filter((s) => s === 200).length + ' ok) · files already decided: ' + st.seen);
  if (!writes.length) console.log('fact stores written: none — nothing new in the archive for Ops');
  for (const w of writes) console.log('  ' + (w.status < 400 ? 'saved  ' : 'FAILED ') + w.key.padEnd(30) + w.status + (w.status >= 400 ? '  ' + w.body : ''));
  console.log('rows now: ' + Object.entries(st.facts).map(([k, n]) => k + ' ' + n).join(' · '));
  if (errs.length) console.log('page errors: ' + [...new Set(errs)].slice(0, 3).join(' | '));
} finally {
  await b.close();
  await fetch(REST + 'app_sessions?token_hash=eq.' + th, { method: 'DELETE', headers: H });
}
const after = Object.fromEntries((await (await fetch(REST + 'rules?key=like.' + encodeURIComponent('kv:cb-facts-%') + '&select=key,updated_at', { headers: H })).json()).map((r) => [r.key, r.updated_at]));
const moved = Object.keys(after).filter((k) => after[k] !== before[k]);
console.log(moved.length ? 'stores that moved: ' + moved.map((k) => k.replace('kv:cb-facts-', '')).join(', ') : 'no store moved (already current)');
process.exitCode = failed ? 1 : 0;
