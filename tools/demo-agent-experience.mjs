#!/usr/bin/env node
/**
 * AGENTOS VIDEO 1 — THE AGENT EXPERIENCE: THE STORY SCREENS (spec 008-agent-experience-video, 2026-10-06).
 *
 *   node tools/demo-agent-experience.mjs
 *
 * Spec 005's fictional floor through the REAL engines and the REAL Worker (in-process; nothing live is contacted), then
 * Agent Analytics re-skinned for this demo only in the ThroughBalls brand (tools/demo/story.mjs), walking one agent's
 * story through the product's own buttons. Viewport PNGs at 2× density, numbered in story order, go to
 *   C:\Users\<you>\Downloads\AgentOS Agent Experience
 * A rerun replaces only files named sNN-<screen>.png there; spec 005's screenshot folder is never touched.
 *
 * Every shot is checked (tools/demo/checks.mjs): no page error, error text, spinner, unpainted table, Wimpy or
 * Chatterbox branding; every story step is asserted against the backend; and the leak check runs at the end.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildFloor } from './demo/floor.mjs';
import { shootVas } from './demo/pulse.mjs';
import { shootStory } from './demo/story.mjs';
import { inspect, leakCheck } from './demo/checks.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(os.homedir(), 'Downloads', 'AgentOS Agent Experience');
const OURS = /^s\d{2}-[a-z0-9-]+\.png$/;
const { chromium } = await import(pathToFileURL(path.join(ROOT, 'nicks_code', 'diagnostics', 'node_modules', 'playwright', 'index.mjs')).href);

fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) if (OURS.test(f)) fs.unlinkSync(path.join(OUT, f));

const problems = [];
const texts = [];
let seq = 0;

async function shot(page, name, pageErrors) {
  seq++;
  const file = 's' + String(seq).padStart(2, '0') + '-' + name + '.png';
  const { text, issues } = await inspect(page, { brand: true });
  if (pageErrors && pageErrors.length) issues.unshift('page error: ' + pageErrors.join(' | '));
  await page.screenshot({ path: path.join(OUT, file), timeout: 120000 });
  texts.push({ file, text });
  console.log((issues.length ? '  !! ' : '  ok ') + file + (issues.length ? '\n       ' + issues.join('\n       ') : ''));
  if (issues.length) problems.push({ file, issues });
}

const floor = buildFloor();
const browser = await chromium.launch();
try {
  console.log('Building the fictional month (VAS Analytics, no screenshots)…');
  let backend = null;
  await shootVas({ browser, root: ROOT, floor, shot: async () => {}, ready: async (published) => {
    const { createBackend } = await import('./demo/backend.mjs');
    backend = await createBackend({ root: ROOT, vas: published });
    return (route) => backend.route(route, { as: 'demo-admin' });
  } });
  console.log('\nThe Agent Experience');
  await shootStory({ browser, root: ROOT, backend, shot });
} catch (e) {
  problems.push({ file: '(story)', issues: [e.message] });
} finally {
  await browser.close();
}

const leak = await leakCheck(ROOT, texts);
problems.push(...leak.problems);
console.log('\nLeak check against the real Agent List: ' + leak.summary);
console.log('\n' + seq + ' screens in ' + OUT + (problems.length ? ' — ' + problems.length + ' with problems:' : ' — all clean.'));
for (const p of problems) console.log('  ' + p.file + ': ' + p.issues.join('; '));
process.exit(problems.length ? 1 : 0);
