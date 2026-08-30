#!/usr/bin/env node
/* verify-theme-render.mjs — renders the three management apps in BOTH themes and
   reads the computed colours back, so "dark works" is measured, not assumed.
   Needs a built site/ (node tools/prepare-site.js) and playwright.
   Run: node nicks_code/diagnostics/verify-theme-render.mjs */
/* Render each management app in BOTH themes and read the computed colours back,
   so "dark works" is measured rather than assumed. Runs against the built site/
   over file://, with no network — auth-gate will fail to reach the Worker and
   show its overlay, which is fine: we are testing the STYLESHEET, so we remove
   the overlay and read the page underneath. */
import { chromium } from 'playwright';
import path from 'node:path';

const ROOT = 'c:/Users/aarav/OneDrive/Desktop/Chatterbox Agent OS/agentos/site';
const APPS = [
  ['Ops', ROOT + '/index.html'],
  ['VAS (PULSE)', ROOT + '/pulse/index.html'],
  ['Tracker', ROOT + '/tracker/index.html'],
];

const lum = (rgb) => {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(rgb || '');
  if (!m) return null;
  return (0.2126 * +m[1] + 0.7152 * +m[2] + 0.0722 * +m[3]) / 255;
};

const browser = await chromium.launch();
let fail = 0;
for (const [name, file] of APPS) {
  for (const theme of ['light', 'dark']) {
    const ctx = await browser.newContext();
    // seed the cache exactly the way auth-gate would after a save
    await ctx.addInitScript((t) => { try { localStorage.setItem('cbx_theme', t); } catch (e) {} }, theme);
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 90)));
    await page.goto('file:///' + file.replace(/\\/g, '/'), { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(700);
    const r = await page.evaluate(() => {
      const o = document.getElementById('cbxAuth'); if (o) o.remove();
      const cs = getComputedStyle(document.body);
      const root = getComputedStyle(document.documentElement);
      return {
        attr: document.documentElement.dataset.theme,
        bg: cs.backgroundColor, fg: cs.color,
        card: root.getPropertyValue('--card').trim() || root.getPropertyValue('--panel').trim() || root.getPropertyValue('--glass').trim(),
        ink: root.getPropertyValue('--ink').trim() || root.getPropertyValue('--text').trim(),
      };
    });
    const bgL = lum(r.bg), fgL = lum(r.fg);
    const want = theme === 'dark';
    const bgOk = bgL == null ? false : (want ? bgL < 0.30 : bgL > 0.70);
    const contrastOk = bgL != null && fgL != null && Math.abs(bgL - fgL) > 0.45;
    const attrOk = r.attr === theme;
    const good = bgOk && contrastOk && attrOk && !errs.length;
    if (!good) fail++;
    console.log(`  ${good ? 'ok  ' : 'FAIL'} ${name.padEnd(12)} ${theme.padEnd(5)} attr=${r.attr} bg=${r.bg} (lum ${bgL == null ? '?' : bgL.toFixed(2)}) ink=${r.ink || '-'} contrast=${bgL != null && fgL != null ? Math.abs(bgL - fgL).toFixed(2) : '?'}${errs.length ? ' JSERR: ' + errs[0] : ''}`);
    await ctx.close();
  }
}
await browser.close();
console.log(fail ? `\n${fail} render check(s) FAILED` : '\nAll render checks passed');
process.exit(fail ? 1 : 0);
