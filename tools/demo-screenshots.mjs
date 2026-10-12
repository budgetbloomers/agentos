#!/usr/bin/env node
/**
 * PRODUCT DEMO SCREENSHOTS (spec 005-product-demo-screenshots, 2026-10-06).
 *
 *   node tools/demo-screenshots.mjs
 *
 * One fictional floor (tools/demo/floor.mjs) through the REAL apps: VAS Analytics first (every page and sub-tab), then
 * Agent Analytics as the team leader, the agent and the campaign manager. Every figure is computed by the product's own
 * engines; nothing is read from or written to the live system. PNGs, numbered in demo order, go to
 *   C:\Users\<you>\Downloads\Chatterbox Demo Screenshots
 * A rerun replaces the previous set (only files named NN-<app>-<screen>.png are removed).
 *
 * Every shot is checked: no page error, no error card, no spinner left on screen, and — at the end — no name or CB number
 * from the real Agent List anywhere in the text on screen (counted, never printed).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildFloor } from './demo/floor.mjs';
import { shootVas } from './demo/pulse.mjs';
import { inspect, leakCheck } from './demo/checks.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(os.homedir(), 'Downloads', 'Chatterbox Demo Screenshots');
const OURS = /^\d{2,3}-[a-z0-9-]+\.png$/;
const { chromium } = await import(pathToFileURL(path.join(ROOT, 'nicks_code', 'diagnostics', 'node_modules', 'playwright', 'index.mjs')).href);

fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) if (OURS.test(f)) fs.unlinkSync(path.join(OUT, f));

const only = process.argv.includes('--vas-only') ? 'vas' : null;
const problems = [];
const texts = [];
let seq = 0;

async function shot(page, name, pageErrors) {
  seq++;
  const file = String(seq).padStart(2, '0') + '-' + name + '.png';
  const { text, issues } = await inspect(page);
  if (pageErrors && pageErrors.length) issues.unshift('page error: ' + pageErrors.join(' | '));
  /* a FIXED sidebar stops at the viewport in a full-page capture — so make the viewport as tall as the page instead */
  const vp = page.viewportSize();
  const h = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight));
  if (h > vp.height) { await page.setViewportSize({ width: vp.width, height: Math.min(h, 6000) });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 200))))); }
  await page.screenshot({ path: path.join(OUT, file), fullPage: true, timeout: 180000 });
  if (h > vp.height) await page.setViewportSize(vp);
  texts.push({ file, text });
  console.log((issues.length ? '  !! ' : '  ok ') + file + (issues.length ? '\n       ' + issues.join('\n       ') : ''));
  if (issues.length) problems.push({ file, issues });
}

const floor = buildFloor();
const browser = await chromium.launch();
try {
  console.log('VAS Analytics');
  let backend = null;
  const vas = await shootVas({ browser, root: ROOT, floor, shot, ready: async (published) => {
    const { createBackend } = await import('./demo/backend.mjs');
    backend = await createBackend({ root: ROOT, vas: published });
    if (process.env.DEMO_DEBUG) for (const p of ['/api/coaching/summary', '/api/upload/large/status', '/api/coaching?cb=CB9101'])
      { const r = await backend.call('GET', p, { as: 'demo-admin' }); console.log('  [debug] ' + p + ' → ' + r.status + ' ' + JSON.stringify(r.json).slice(0, 220)); }
    return (route) => backend.route(route, { as: 'demo-admin' });
  } });
  if (!only) {
    const { shootAgent } = await import('./demo/agent.mjs');
    console.log('\nAgent Analytics');
    await shootAgent({ browser, root: ROOT, backend, shot });
  }
  if (backend && backend.unhandled.length) console.log('\n(backend calls with no fake answer: ' + [...new Set(backend.unhandled)].slice(0, 12).join(' · ') + ')');
} finally {
  await browser.close();
}

/* THE LEAK CHECK — the real Agent List on disk, read locally; only counts are printed */
const leak = await leakCheck(ROOT, texts);   // tools/demo/checks.mjs
problems.push(...leak.problems);
console.log('\nLeak check against the real Agent List: ' + leak.summary);

console.log('\n' + seq + ' screenshots in ' + OUT + (problems.length ? ' — ' + problems.length + ' with problems:' : ' — all clean.'));
for (const p of problems) console.log('  ' + p.file + ': ' + p.issues.join('; '));
process.exit(problems.length ? 1 : 0);
