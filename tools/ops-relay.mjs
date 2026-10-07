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
 *
 * SPEC KIT 014, T4 (2026-10-07). (1) THE CAUSE IS THE LAST LINE. The run failed on every tick for
 * days and the tick showed only "rows now: …": the refused save ("FAILED cb-facts-VICI_CALL_REPORT
 * 400 could not decompress the upload: Memory limit exceeded before EOF.") was printed above the
 * row counts and cut off. relayVerdict() names every cause and it is printed last. (2) A QUIET DAY
 * NO LONGER COSTS THE WHOLE --wait. The loop only left after a file was pulled, so with nothing new
 * in the archive it sat out all 600 s every tick. The page's relay reads the upload manifest and,
 * finding nothing unseen, returns at once; relayDone() leaves when the manifest has been read, the
 * page's relay flag is down, no save is in flight, and the wire has been quiet a short while.
 */
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const QUIET_AFTER_PULLS_MS = 30000;   // after files were pulled: a parse can be silent on the wire for a while
const QUIET_NOTHING_MS = 10000;       // nothing pulled: just long enough for a boot-time save to start
const swallow = () => null;

/** may the run leave now? Only once the page's relay has read the manifest and finished. */
export function relayDone({ manifestSeen, busy, pulls, quietMs, inflight = 0 }) {
  if (!manifestSeen || busy || inflight > 0) return false;
  return quietMs > (pulls > 0 ? QUIET_AFTER_PULLS_MS : QUIET_NOTHING_MS);
}

/** every reason this run failed, as one line ('ops-relay ok' when there is none) */
export function relayVerdict({ writes = [], busyAtDeadline = false, manifestSeen = false, manifestStatus = 0, maxWaitS = 0 }) {
  const causes = [];
  for (const w of writes) if (w.status >= 400) causes.push('save refused: ' + w.key + ' ' + w.status + (w.body ? ' ' + w.body : ''));
  if (busyAtDeadline) causes.push('DEADLINE: the relay was still loading at ' + maxWaitS + ' s — files left undecided for the next run (raise --wait)');
  if (manifestSeen && manifestStatus >= 400) causes.push('the upload manifest could not be read (HTTP ' + manifestStatus + ')');
  if (!manifestSeen) causes.push('the page never asked for the upload manifest — the relay did not run (boot or sign-in failed?)');
  return { failed: causes.length > 0, causes, line: causes.length ? 'ops-relay FAILED — ' + causes.join(' · ') : 'ops-relay ok' };
}

async function main() {
  const { chromium } = await import(pathToFileURL(path.join(ROOT, 'nicks_code', 'diagnostics', 'node_modules', 'playwright', 'index.mjs')).href);
  const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, 'supabase.env'), 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^"|"$/g, '')]));
  const H = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY, 'Content-Type': 'application/json' };
  const REST = env.SUPABASE_URL + '/rest/v1/';
  const SITE = process.env.CBX_SITE || 'https://chatterbox-agentos.pages.dev/';
  const wi = process.argv.indexOf('--wait'); const MAX_WAIT = (wi > 0 ? +process.argv[wi + 1] : 240) * 1000;

  /* a service session: the first active admin, 15 minutes, deleted in finally */
  const admin = (await (await fetch(REST + 'app_users?role=eq.admin&active=is.true&select=id,username&order=created_at.asc&limit=1', { headers: H })).json())[0];
  if (!admin) { console.error('FAILED: no active admin account to run as'); process.exitCode = 2; return; }
  const token = crypto.randomBytes(32).toString('hex'); const th = crypto.createHash('sha256').update(token).digest('hex');
  await fetch(REST + 'app_sessions', { method: 'POST', headers: { ...H, Prefer: 'return=minimal' },
    body: JSON.stringify([{ token_hash: th, user_id: admin.id, expires_at: new Date(Date.now() + 900000).toISOString(), user_agent: 'ops-relay' }]) });

  const before = Object.fromEntries((await (await fetch(REST + 'rules?key=like.' + encodeURIComponent('kv:cb-facts-%') + '&select=key,updated_at', { headers: H })).json()).map((r) => [r.key, r.updated_at]));
  let b = null;
  let verdict = relayVerdict({});
  try {
    b = await chromium.launch({ args: ['--js-flags=--max-old-space-size=8192'] });
    const page = await b.newPage({ viewport: { width: 1600, height: 1000 } });
    const writes = [], pulls = []; let lastActivity = Date.now(); const errs = [];
    let manifestSeen = false, manifestStatus = 0, inflight = 0;
    page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
    const isSave = (q) => q.method() === 'POST' && /\/api\//.test(q.url());
    page.on('request', (q) => { if (isSave(q)) { inflight++; lastActivity = Date.now(); } });
    const settle = (q) => { if (isSave(q)) inflight = Math.max(0, inflight - 1); };
    page.on('requestfinished', settle); page.on('requestfailed', settle);
    page.on('response', async (r) => {
      const u = r.url(); const m = r.request().method();
      if (/\/api\/upload-manifest/.test(u)) { manifestSeen = true; manifestStatus = r.status(); lastActivity = Date.now(); }
      if (/\/api\/upload-file\?/.test(u)) { pulls.push(r.status()); lastActivity = Date.now(); }
      if (/\/api\/kv\?key=/.test(u) && m === 'POST') lastActivity = Date.now();
      if (/\/api\/kv\?key=cb-facts-/.test(u) && m === 'POST') {
        let body = ''; try { body = (await r.text()).slice(0, 160); } catch {}
        writes.push({ key: decodeURIComponent((/key=([^&]+)/.exec(u) || [])[1] || ''), status: r.status(), body }); lastActivity = Date.now();
      }
    });
    await page.addInitScript((t) => { sessionStorage.setItem('cbx_token', t); }, token);
    await page.goto(SITE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.acStats === 'function', null, { timeout: 90000 });
    console.log('Ops booted as ' + admin.username + ' — waiting for the upload relay');
    /* the relay starts once the page has loaded its stores; then keep going until it is done.
       THE PAGE SAYS WHEN IT IS DONE (2026-09-21). Wire silence is not idleness: a 1.7 MB BI workbook
       parses and pushes to the database for well over 30 s with no download and no store POST, so
       this loop closed the browser mid-relay — before saveFacts and saveConfig — and every file
       behind the slow one was pulled again next run and never decided (seven files queued from
       20 Sep; Ops sat on a 17 Sep attendance of one row while VAS had 179). Leave only when the
       page's own relay flag is down as well — and (T4) leave as soon as a relay that found nothing
       new has finished, instead of waiting out the whole --wait. */
    const t0 = Date.now(); let busy = false, done = false;
    while (Date.now() - t0 < MAX_WAIT) {
      await page.waitForTimeout(5000);
      busy = await page.evaluate(() => typeof __uploadSyncBusy !== 'undefined' && !!__uploadSyncBusy).catch(() => false);
      if (relayDone({ manifestSeen, busy, pulls: pulls.length, quietMs: Date.now() - lastActivity, inflight })) { done = true; break; }
    }
    if (!done && busy) console.log('DEADLINE: the relay was still loading at ' + Math.round(MAX_WAIT / 1000) + ' s — files left undecided for the next run (raise --wait)');   // a cut-off run is a FAILED run: the tick stamps it red, not green
    verdict = relayVerdict({ writes, busyAtDeadline: !done && busy, manifestSeen, manifestStatus, maxWaitS: Math.round(MAX_WAIT / 1000) });
    const st = await page.evaluate(() => ({ facts: Object.fromEntries(Object.entries(state.facts || {}).map(([k, v]) => [k, (v || []).length])), seen: Object.keys(state.syncedUploads || {}).length }));
    console.log('archive files pulled: ' + pulls.length + ' (' + pulls.filter((s) => s === 200).length + ' ok) · files already decided: ' + st.seen
      + (done ? ' · relay finished after ' + Math.round((Date.now() - t0) / 1000) + ' s' : ''));
    if (!writes.length) console.log('fact stores written: none — nothing new in the archive for Ops');
    for (const w of writes) console.log('  ' + (w.status < 400 ? 'saved  ' : 'FAILED ') + w.key.padEnd(30) + w.status + (w.status >= 400 ? '  ' + w.body : ''));
    console.log('rows now: ' + Object.entries(st.facts).map(([k, n]) => k + ' ' + n).join(' · '));
    if (errs.length) console.log('page errors: ' + [...new Set(errs)].slice(0, 3).join(' | '));
  } finally {
    if (b) await b.close().catch(swallow);
    await fetch(REST + 'app_sessions?token_hash=eq.' + th, { method: 'DELETE', headers: H }).catch(swallow);
  }
  const after = Object.fromEntries((await (await fetch(REST + 'rules?key=like.' + encodeURIComponent('kv:cb-facts-%') + '&select=key,updated_at', { headers: H })).json()).map((r) => [r.key, r.updated_at]));
  const moved = Object.keys(after).filter((k) => after[k] !== before[k]);
  console.log(moved.length ? 'stores that moved: ' + moved.map((k) => k.replace('kv:cb-facts-', '')).join(', ') : 'no store moved (already current)');
  console.log(verdict.line);   // LAST, so any tail of this output names the cause
  process.exitCode = verdict.failed ? 1 : 0;
}

/* main only as the entry point — verify-tick-014 imports the decisions without minting a session */
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main().catch((e) => { console.error('FAILED: ' + ((e && e.message) || e)); process.exitCode = 1; });
}
