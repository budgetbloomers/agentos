// The "switch to VAS and back" scenario: after data is loaded once, a RELOAD of the ops
// app must paint from the IndexedDB snapshot instantly — no blank screen while cloud
// blobs download. Drives the real app, reloads, measures time-to-first-data.
import { chromium } from 'playwright';
import path from 'node:path';

const REPO = process.env.AGENTOS || decodeURIComponent(new URL('../..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1').replace(/\/$/, '');   // repo-relative (2026-09-08): the laptop path failed every cloud run
const UP = path.join(REPO, 'uploads', '2026-08-13');
const j = (...p) => path.join(...p);
const FILES = ['Matrix - Agent List.xlsx', 'attendance_2026-08-06_to_2026-08-13.csv', 'evaluations-full-export-2026-08-13.csv', 'SF Open Cases 5 - 13.xls', 'Inactive.xlsx'].map(f => j(UP, f));

let pass = 0, fail = 0; const failures = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  pass  ' + n); } else { fail++; failures.push(n + ' — ' + d); console.log('  FAIL  ' + n + ' — ' + d); } };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } }); // one context — IndexedDB persists across reloads
const page = await ctx.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message));
const URL = 'file:///' + j(REPO, 'Chatterbox_AgentOS_Analytics.html').replace(/\\/g, '/');
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => document.dispatchEvent(new CustomEvent('cbx-authed', { detail: { user: 'perf' } })));
await page.waitForFunction(() => window.state && typeof window.go === 'function', null, { timeout: 60000 });
await page.evaluate(() => go('uploads'));
await page.waitForSelector('input[type=file][multiple]', { state: 'attached' });
await page.setInputFiles('input[type=file][multiple]', FILES, { timeout: 120000 });
await page.waitForSelector('text=Bulk upload —', { timeout: 300000 });
await page.click('button:has-text("file(")');
await page.waitForSelector('text=Bulk upload — done', { timeout: 300000 });
await page.evaluate(() => closeModal());
await page.waitForTimeout(1500); // let the fire-and-forget idb mirrors land

// ---- the complaint: come back to ops. Reload WITHOUT auth — data must appear anyway.
const t0 = Date.now();
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.state && (window.state.facts.AGENT_LIST || []).length > 0, null, { timeout: 15000 });
const tData = Date.now() - t0;
await page.waitForFunction(() => (document.getElementById('page') || {}).innerText?.length > 200, null, { timeout: 15000 });
const tPaint = Date.now() - t0;
const snap = await page.evaluate(() => ({
  painted: /refreshing from the cloud/.test((document.getElementById('footAsof') || {}).textContent || ''), // top-level `let` flags aren't window properties — the footer suffix is the observable
  roster: (state.facts.AGENT_LIST || []).length,
  att: (state.facts.ATTENDANCE || []).length,
  qa: (state.facts.QA_EVALUATIONS || []).length,
  foot: (document.getElementById('footAsof') || {}).textContent || '',
}));
console.log(JSON.stringify({ tData, tPaint, ...snap }));
ok('data restored from local snapshot without any cloud/auth', snap.roster === 95 && snap.att >= 600 && snap.qa >= 600, JSON.stringify(snap));
ok('paints in under 2s (was: blank until full cloud download)', tPaint < 2000, tPaint + 'ms');
ok('local-paint flag set', snap.painted);
ok('footer says a cloud refresh is coming', /refreshing from the cloud/.test(snap.foot), snap.foot);

// auth arrives late — cloud init must run and keep the screen alive (no cloud at file://)
await page.evaluate(() => document.dispatchEvent(new CustomEvent('cbx-authed', { detail: { user: 'perf' } })));
await page.waitForTimeout(1500);
const after = await page.evaluate(() => ({ roster: (state.facts.AGENT_LIST || []).length, initDone: window.__initDone === undefined ? 'n/a' : !!__initDone, page: (document.getElementById('page') || {}).innerText?.length || 0 }));
ok('cloud init after late auth keeps the data on screen', after.roster === 95 && after.page > 200, JSON.stringify(after));
ok('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
failures.forEach(f => console.log('FAIL: ' + f));
await browser.close();
process.exit(fail ? 1 : 0);
