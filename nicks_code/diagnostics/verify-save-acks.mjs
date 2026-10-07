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

  // ================================================= PULSE · two tabs =======
  /* SPEC 014 (2026-10-07): save_failures held 6 × "vas vas-state → replay 425" in a day. Two tabs saving at once: the
     reload during the other tab's write gets 425 (write in progress) — and the old code reported it as a failure; after
     four conflicts the tab stopped reloading altogether and re-pushed a stale base for ever. This stub behaves like the
     compare-and-set Worker: a push is accepted only on the CURRENT version; another tab moves the version on. */
  head('PULSE · two tabs saving at once (spec 014): wait out a write in progress, never wedge');
  const CAS_STUB = `
    window.__cloudVer = 'v1'; window.__movesLeft = 0; window.__busyReloads = 0; window.__failReports = []; window.__pushes = 0; window.__reloads = 0; window.__ops = []; window.__wipOnce = false;
    const __rf = window.fetch;
    window.fetch = function (u, o) {
      const s = String(u), m = (o && o.method) || 'GET';
      if (s.indexOf('/api/me') >= 0) return Promise.resolve(new Response('{"user":{"username":"probe","role":"admin"}}', { status: 200 }));   // signed in: the gate must not clear the token mid-test
      if (s.indexOf('/api/save-fail') >= 0) { try { window.__failReports.push(JSON.parse(o.body).status); } catch (e) {} window.__ops.push('FAIL'); return Promise.resolve(new Response('{"ok":true}', { status: 200 })); }
      if (s.indexOf('/api/kv?key=vas-state') >= 0 && m === 'POST') {
        window.__pushes++;
        const base = (o.headers || {})['X-Cbx-Base'];
        if (window.__wipAlways) { window.__ops.push('P409w');   // a write lock that never clears, while every reload reads fine
          return Promise.resolve(new Response(JSON.stringify({ error: 'version_conflict', current: window.__cloudVer, reason: 'write_in_progress' }), { status: 409 })); }
        if (window.__wipOnce) { window.__wipOnce = false; window.__busyReloads = 2; window.__ops.push('P409w');   // another tab is MID-WRITE: the next reloads meet 425
          return Promise.resolve(new Response(JSON.stringify({ error: 'version_conflict', current: window.__cloudVer, reason: 'write_in_progress' }), { status: 409 })); }
        if (base !== window.__cloudVer) window.__ops.push('P409');
        if (base !== window.__cloudVer) return Promise.resolve(new Response(JSON.stringify({ error: 'version_conflict', current: window.__cloudVer }), { status: 409 }));
        window.__cloudVer = 'v' + (Number(window.__cloudVer.slice(1)) + 1); window.__ops.push('P200');
        return Promise.resolve(new Response('{"ok":true}', { status: 200, headers: { 'X-Cbx-Version': window.__cloudVer } }));
      }
      if (s.indexOf('/api/kv?key=vas-state') >= 0) {
        window.__reloads++;
        if (window.__busyReloads > 0) { window.__busyReloads--; window.__ops.push('R425');
          return Promise.resolve(new Response('{"error":"write_in_progress","retry_in_ms":50}', { status: 425, headers: { 'Retry-After': '1' } })); }
        const ver = window.__cloudVer; window.__ops.push('R200');
        if (window.__movesLeft > 0) { window.__movesLeft--; window.__cloudVer = 'v' + (Number(ver.slice(1)) + 1); }   // another tab saves right after our read
        return Promise.resolve(new Response(JSON.stringify({ files: [{ name: 'theirs.xlsx', type: 'bi', at: '2026-10-07 07:00', hash: 'h-theirs' }], _rev: 1 }), { status: 200, headers: { 'X-Cbx-Version': ver } }));
      }
      if (s.indexOf('chatterbox-agentos-api') >= 0) return Promise.resolve(new Response('{}', { status: 404 }));
      return __rf.apply(this, arguments);
    };
  `;
  const casPage = async () => {
    const ctx = await b.newContext();
    await ctx.addInitScript(CAS_STUB + `sessionStorage.setItem('cbx_token','test-token');`);
    const page = await ctx.newPage();
    await page.goto('http://127.0.0.1:8291/pulse', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__mtd && window.__mtd.state(), null, { timeout: 60000 });
    await page.evaluate(() => {
      sessionStorage.setItem('cbx_token', 'test-token');
      const S = window.__mtd.state();
      S.files = [{ name: 'mine.xlsx', type: 'bi', at: '2026-10-07 08:00', hash: 'h-mine' }];   // hashed: rebuild() prunes undated, unhashed entries
      window.__vasHydrated = true; window.__unsavedGraceMs = 60000; window.__saveRetryMs = 300;
    });
    return { ctx, page };
  };
  {
    const { ctx, page } = await casPage();
    await page.evaluate(() => { window.__vasBase = window.__cloudVer; window.__ops = []; window.__failReports = []; window.__wipOnce = true; save(); });   // the save meets another tab mid-write; its reloads meet 425 twice
    const saved = await page.waitForFunction(() => !window.__vasDirtySince, null, { timeout: 20000 }).then(() => true, () => false);
    const st = await page.evaluate(() => ({ reports: window.__failReports, ops: window.__ops }));
    ok(saved, 'a reload that meets another tab\'s write in progress (425) waits and tries again — the save lands', JSON.stringify(st));
    ok(st.ops.indexOf('R425') >= 0 && !st.reports.length, '…its reload met the 425 and NO failure was reported (the false "saves failing" alarm)', JSON.stringify(st));
    await ctx.close();
  }
  {
    const { ctx, page } = await casPage();
    await page.evaluate(() => { window.__vasBase = 'v0'; window.__ops = []; window.__movesLeft = 5; save(); });   // the other tab keeps saving five more times
    const saved = await page.waitForFunction(() => !window.__vasDirtySince, null, { timeout: 25000 }).then(() => true, () => false);
    const st = await page.evaluate(() => ({ ops: window.__ops }));
    let run = 0, maxRun = 0; for (const o of st.ops) { if (o === 'P409') { run++; maxRun = Math.max(maxRun, run); } else if (o[0] === 'R' || o === 'P200') run = 0; }
    ok(saved && maxRun <= 2, 'after four conflicts in a row the tab goes back to reloading — never a run of stale pushes waiting on the background poll', 'longest run of refused pushes with no reload: ' + maxRun + ' ' + JSON.stringify(st.ops));
    await ctx.close();
  }
  {
    /* review 014: the 409 write_in_progress wait shared its counter with the 425 replay wait, and every good reload reset
       it — push → 409 wip → wait → reload 200 → push → 409 wip … never capped and never reported. */
    const { ctx, page } = await casPage();
    await page.evaluate(() => { window.__wipWaitMs = 40; window.__vasBase = window.__cloudVer; window.__ops = []; window.__failReports = []; window.__wipAlways = true; save(); });
    const told = await page.waitForFunction(() => window.__failReports.length > 0, null, { timeout: 15000 }).then(() => true, () => false);
    const st = await page.evaluate(() => ({ reports: window.__failReports, ops: window.__ops }));
    const upTo = st.ops.indexOf('FAIL') >= 0 ? st.ops.slice(0, st.ops.indexOf('FAIL')) : st.ops, wipsBefore = upTo.filter((o) => o === 'P409w').length;
    ok(told, 'a write lock that never clears is waited out a bounded number of times, then REPORTED (not looped on in silence)', 'pushes met: ' + wipsBefore + ' ' + JSON.stringify(st.ops.slice(0, 40)));
    ok(told && wipsBefore <= 9, '…after eight waits (the ninth refusal is reported)', 'P409w seen: ' + wipsBefore + ' ' + JSON.stringify(upTo));
    await page.evaluate(() => { window.__wipAlways = false; });
    const saved = await page.waitForFunction(() => !window.__vasDirtySince, null, { timeout: 20000 }).then(() => true, () => false);
    ok(saved, '…and once the lock clears, the backoff retry lands the save');
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
