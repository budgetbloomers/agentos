// Is the Visual Brain making ops analytics slow? Measure: page-render times with the full
// 2026-08-13 package loaded, FPS + main-thread busy while the Brain is open, and whether
// any cost lingers after navigating away.
import { chromium } from 'playwright';
import path from 'node:path';

const REPO = String.raw`c:\Users\aarav\OneDrive\Desktop\Chatterbox Agent OS\agentos`;
const UP = path.join(REPO, 'uploads', '2026-08-13');
const j = (...p) => path.join(...p);
const FILES = ['Matrix - Agent List.xlsx', 'attendance_2026-08-06_to_2026-08-13.csv', 'Active.xlsx', 'Inactive.xlsx',
  'call_records.csv', 'Call Report 01 to 13 Aug.xlsx', 'evaluations-full-export-2026-08-13.csv', 'SF Open Cases 5 - 13.xls'].map(f => j(UP, f));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
await page.goto('file:///' + j(REPO, 'Chatterbox_AgentOS_Analytics.html').replace(/\\/g, '/'), { waitUntil: 'domcontentloaded' });
await page.evaluate(() => document.dispatchEvent(new CustomEvent('cbx-authed', { detail: { user: 'perf' } })));
await page.waitForFunction(() => window.state && typeof window.go === 'function', null, { timeout: 60000 });
await page.evaluate(() => go('uploads'));
await page.waitForSelector('input[type=file][multiple]', { state: 'attached' });
await page.setInputFiles('input[type=file][multiple]', FILES, { timeout: 120000 });
await page.waitForSelector('text=Bulk upload —', { timeout: 600000 });
await page.click('button:has-text("Load 8 file(")');
await page.waitForSelector('text=Bulk upload — done', { timeout: 600000 });
await page.evaluate(() => closeModal());
await page.waitForTimeout(800);

const timePage = async (id) => await page.evaluate(async (id) => {
  const t0 = performance.now(); go(id); await new Promise(r => setTimeout(r, 0));
  return Math.round(performance.now() - t0);
}, id);

console.log('--- page render times (full dataset, ms) ---');
for (const id of ['dashboard', 'sales', 'workforce', 'quality', 'scorecard', 'brain']) {
  console.log(String(id).padEnd(12), await timePage(id));
}

// FPS + main-thread busy while Brain is open (5s sample)
const onBrain = await page.evaluate(() => new Promise(res => {
  let frames = 0, busy = 0, last = performance.now();
  const obs = new PerformanceObserver(l => l.getEntries().forEach(e => busy += e.duration));
  try { obs.observe({ entryTypes: ['longtask'] }); } catch (e) {}
  const t0 = performance.now();
  (function f() { frames++; if (performance.now() - t0 < 5000) requestAnimationFrame(f); else { obs.disconnect(); res({ fps: Math.round(frames / 5), longtaskMs: Math.round(busy) }); } })();
}));
console.log('while Brain open: ', JSON.stringify(onBrain));

// navigate away — does anything keep burning?
await timePage('dashboard');
await page.waitForTimeout(500);
const after = await page.evaluate(() => new Promise(res => {
  let frames = 0, busy = 0;
  const obs = new PerformanceObserver(l => l.getEntries().forEach(e => busy += e.duration));
  try { obs.observe({ entryTypes: ['longtask'] }); } catch (e) {}
  const t0 = performance.now();
  (function f() { frames++; if (performance.now() - t0 < 3000) requestAnimationFrame(f); else { obs.disconnect(); res({ rafPerSec: Math.round(frames / 3), longtaskMs: Math.round(busy), brainLoopAlive: !!document.getElementById('brainCanvas') }); } })();
}));
console.log('after leaving Brain:', JSON.stringify(after));
console.log('re-render dashboard:', await timePage('dashboard'), 'ms · sales:', await timePage('sales'), 'ms');
await browser.close();
