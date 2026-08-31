#!/usr/bin/env node
/**
 * verify-save-acks.mjs — unsaved data is a STATE, and both apps must show it.
 *
 *   node nicks_code/diagnostics/verify-save-acks.mjs
 *
 * Phase 1 of specs/save-reliability-plan.md, proven end to end in a real page:
 * fetch is stubbed to fail exactly the way the 28–31 Aug CORS refusal failed
 * (the request never returns), and the page must respond the way the incident
 * demanded and the old code did not — a persistent banner, automatic retries,
 * and an exit warning — then clear all three the moment a save is acknowledged.
 *
 * Runs PULSE from source and Ops from the GENERATED site/index.html, because
 * the Ops save path lives in the injected storage shim which exists nowhere
 * else — testing the source HTML would test an app with no save path at all.
 * No request leaves the machine: the failing fetch is a stub, and the
 * succeeding one is a stub too.
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const { chromium } = await import(pathToFileURL(path.join(HERE, 'node_modules', 'playwright', 'index.mjs')).href);

let pass = 0, fail = 0;
const ok = (c, n, extra) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (extra !== undefined ? ' — ' + extra : '')); } };
const head = (t) => console.log('\n' + t);

const FILES = {
  '/pulse': path.join(ROOT, 'nicks_code', 'index.html'),
  '/ops': path.join(ROOT, 'site', 'index.html'),
  '/xlsx.full.min.js': path.join(ROOT, 'site', 'xlsx.full.min.js'),
  '/auth-gate.js': path.join(ROOT, 'site', 'auth-gate.js'),
  '/ask-widget.js': path.join(ROOT, 'site', 'ask-widget.js'),
};
const srv = http.createServer((q, s) => {
  const u = q.url.split('?')[0];
  if (u === '/build.txt') { s.writeHead(200); s.end('test'); return; }
  const p = FILES[u];
  if (!p || !fs.existsSync(p)) { s.writeHead(404); s.end(); return; }
  s.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' });
  fs.createReadStream(p).pipe(s);
});
await new Promise((r) => srv.listen(8291, '127.0.0.1', r));

/* Stub the Worker: /api/kv POSTs fail like a CORS refusal (the promise rejects —
   no response at all, which is exactly what a blocked request looks like) until
   window.__stubOk flips; then they answer 200. Everything else 404s quietly. */
/* The token is re-set inside each test's evaluate, not only here: auth-gate's boot
   session-check fails against the stub and CLEARS sessionStorage, so a token planted
   before load is gone by the time the app is interactive. */
const STUB = `
  window.__stubOk = false; window.__stubHits = 0;
  const __realFetch = window.fetch;
  window.fetch = function (u, o) {
    const s = String(u);
    if (s.indexOf('/api/kv') >= 0 && o && o.method === 'POST') {
      window.__stubHits++;
      return window.__stubOk
        ? Promise.resolve(new Response('{"ok":true}', { status: 200 }))
        : Promise.reject(new TypeError('Failed to fetch'));
    }
    if (s.indexOf('chatterbox-agentos-api') >= 0)
      return Promise.resolve(new Response('{}', { status: 404 }));
    return __realFetch.apply(this, arguments);
  };
`;

const b = await chromium.launch();
try {
  // ============================================================ PULSE =======
  head('PULSE · the state save');
  {
    const ctx = await b.newContext();
    await ctx.addInitScript(STUB + `sessionStorage.setItem('cbx_token','test-token');`);
    const page = await ctx.newPage();
    await page.goto('http://127.0.0.1:8291/pulse', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__mtd && window.__mtd.state(), null, { timeout: 60000 });
    await page.evaluate(() => {
      sessionStorage.setItem('cbx_token', 'test-token');   // auth-gate cleared the planted one
      const S = window.__mtd.state();
      S.files = [{ name: 'probe.xlsx', type: 'bi', at: '2026-08-31 07:00' }];   // never push an empty state
      window.__vasHydrated = true;
      window.__unsavedGraceMs = 400;      // the 90s banner grace, shrunk for the test
      window.__saveRetryMs = 900;         // the 30s first retry, shrunk for the test
    });

    await page.evaluate(() => save());
    await page.waitForFunction(() => window.__stubHits > 0, null, { timeout: 15000 });
    ok(true, 'save() pushed to the cloud and the push was refused (the CORS shape: no response at all)');

    await page.waitForSelector('#cbxUnsaved', { timeout: 15000 });
    const txt = await page.textContent('#cbxUnsaved');
    ok(/NOT SAVED/.test(txt), 'the persistent banner is up past the grace period', txt.slice(0, 80));
    ok(await page.evaluate(() => !!window.__vasDirtySince), 'the state is marked dirty');
    ok(await page.evaluate(() => window.__saveFailN >= 1), 'the failure was counted for backoff');

    const blocked = await page.evaluate(() => {
      const e = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    });
    ok(blocked, 'closing the tab while dirty is challenged');

    /* the retry fires on its own — nothing re-calls save() */
    const hitsBefore = await page.evaluate(() => window.__stubHits);
    await page.waitForFunction((h) => window.__stubHits > h, hitsBefore, { timeout: 15000 });
    ok(true, 'a retry fired by itself — a failed save no longer waits for the next edit');

    /* the cloud comes back */
    await page.evaluate(() => { window.__stubOk = true; });
    await page.waitForFunction(() => !window.__vasDirtySince, null, { timeout: 20000 });
    ok(true, 'the next retry succeeded and the dirty flag cleared');
    await page.waitForFunction(() => !document.getElementById('cbxUnsaved'), null, { timeout: 20000 });
    ok(true, 'the banner cleared itself');
    ok(await page.evaluate(() => window.__vasSaveOk > 0), 'the acknowledgement stamp advanced');
    const freed = await page.evaluate(() => {
      const e = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(e);
      return !e.defaultPrevented;
    });
    ok(freed, 'closing the tab is quiet again once everything is saved');
    await ctx.close();
  }

  // ============================================================== OPS =======
  head('OPS · the storage shim (from the GENERATED site/index.html)');
  {
    if (!fs.existsSync(path.join(ROOT, 'site', 'index.html'))) {
      ok(false, 'site/index.html exists — run node tools/prepare-site.js first');
    } else {
      const ctx = await b.newContext();
      await ctx.addInitScript(STUB + `sessionStorage.setItem('cbx_token','test-token');`);
      const page = await ctx.newPage();
      await page.goto('http://127.0.0.1:8291/ops', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.storage && window.__cbxFailedSaves, null, { timeout: 30000 });
      await page.evaluate(() => {
        sessionStorage.setItem('cbx_token', 'test-token');   // auth-gate cleared the planted one
        window.__cbxRetryMs = 900;
      });

      /* a payload big enough to take the gzip path — the one the header bug killed */
      await page.evaluate(() => window.storage.set('zz-ack-probe', 'x'.repeat(70000)));
      await page.waitForFunction(() => Object.keys(window.__cbxFailedSaves).length === 1, null, { timeout: 15000 });
      ok(true, 'a failed write landed in the retry queue with its exact payload');
      await page.waitForSelector('#cbxUnsaved', { timeout: 10000 });
      const txt = await page.textContent('#cbxUnsaved');
      ok(/NOT saved/.test(txt), 'the persistent banner is up', txt.slice(0, 80));

      const blocked = await page.evaluate(() => {
        const e = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(e);
        return e.defaultPrevented;
      });
      ok(blocked, 'closing the tab while the queue is non-empty is challenged');

      await page.evaluate(() => { window.__stubOk = true; });
      await page.waitForFunction(() => Object.keys(window.__cbxFailedSaves).length === 0, null, { timeout: 20000 });
      ok(true, 'the automatic retry drained the queue when the cloud came back');
      await page.waitForFunction(() => !document.getElementById('cbxUnsaved'), null, { timeout: 10000 });
      ok(true, 'the banner cleared itself');
      ok(await page.evaluate(() => window.__cbxSaveOk > 0), 'the acknowledgement stamp advanced');
      await ctx.close();
    }
  }
} finally {
  await b.close(); srv.close();
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
