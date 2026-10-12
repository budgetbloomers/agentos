/**
 * THE CHECKS EVERY DEMO CAPTURE RUNS (specs 005, 007, 008).
 *
 * inspect(page)  — what is on screen right now: an error message, a spinner, Wimpy (not part of any demo), a picture of a
 *                  third-party hub, a block the browser may paint blank (content-visibility:auto), and — for a branded
 *                  capture — any trace of the Chatterbox name.
 * leakCheck()    — every captured page's text against the REAL Agent List on disk: names and CB numbers, counted and
 *                  never printed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const BAD_TEXT = /something went wrong|could not (reach|load|be reached)|unavailable right now|not published yet|no data loaded|failed to load/i;

/** @returns {Promise<{text: string, issues: string[]}>} */
export async function inspect(page, { brand = false } = {}) {
  const text = await page.evaluate(() => document.body.innerText || '');
  const issues = [];
  const spinner = await page.evaluate(() => [...document.querySelectorAll('.spin,.spinner')].some((e) => e.offsetParent !== null));
  if (spinner) issues.push('a spinner is still on screen');
  const bad = BAD_TEXT.exec(text);
  if (bad) issues.push('message on screen: "' + text.slice(Math.max(0, bad.index - 60), bad.index + 80).replace(/\s+/g, ' ') + '"');
  /* spec 007: Wimpy is not part of the demo (FR-001), and no picture of a third-party hub may show (FR-003) */
  if (/wimpy/i.test(text)) issues.push('Wimpy on screen');
  const hubPics = await page.evaluate(() => [...document.querySelectorAll('img[alt$=" preview"]')].filter((i) => /hub|wimpy/i.test(i.alt) && i.offsetParent !== null).length);
  if (hubPics) issues.push(hubPics + ' third-party hub preview image(s) on screen');
  /* a block left at content-visibility:auto may be captured unpainted — a table that reads as empty (spec 007) */
  const lazy = await page.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => getComputedStyle(e).contentVisibility === 'auto').length);
  if (lazy) issues.push(lazy + ' block(s) with content-visibility:auto may be captured blank');
  /* spec 008 FR-002: a ThroughBalls-branded capture shows no Chatterbox name — on screen, in an image's alt, or the title */
  if (brand) {
    const trace = await page.evaluate(() => [document.title, ...[...document.querySelectorAll('img')].map((i) => i.alt),
      ...[...document.querySelectorAll('[title],[aria-label],[placeholder]')].map((e) => [e.title, e.getAttribute('aria-label'), e.getAttribute('placeholder')].join(' '))].join(' '));
    if (/chatterbox/i.test(text + ' ' + trace)) issues.push('Chatterbox branding on screen');
    const off = await offPalette(page);
    if (off.length) issues.push(off.length + ' off-palette (blue/violet) colour(s) on screen, e.g. ' + off.slice(0, 4).join(' · '));
  }
  return { text, issues };
}

/**
 * spec 009 FR-001 / SC-003: on a ThroughBalls-branded screen no visible element may be painted blue, navy, violet or
 * sky (hue 180–300, saturation > 0.25). Reds and ambers carry meaning and greys are neutral, so both pass.
 * @returns {Promise<string[]>} up to 12 examples, "tag.class color:#hex"
 */
export async function offPalette(page) {
  return page.evaluate(() => {
    const hsl = (r, g, b) => {
      r /= 255; g /= 255; b /= 255;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
      if (!d) return [0, 0, l];
      const s = d / (1 - Math.abs(2 * l - 1));
      const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      return [(h * 60 + 360) % 360, s, l];
    };
    const W = innerWidth, H = innerHeight, out = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || r.bottom < 0 || r.right < 0 || r.top > H || r.left > W) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) continue;
      for (const prop of ['color', 'backgroundColor', 'borderTopColor', 'borderLeftColor', 'fill', 'stroke']) {
        const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(cs[prop] || '');
        if (!m || (m[4] !== undefined && +m[4] < 0.12)) continue;
        if (prop.startsWith('border') && parseFloat(cs[prop.replace('Color', 'Width')]) === 0) continue;
        if (prop === 'color' && !(el.childNodes.length && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()))) continue;
        const [h, s] = hsl(+m[1], +m[2], +m[3]);
        if (h >= 180 && h <= 300 && s > 0.25) {
          out.push(el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(/\s+/)[0] : '') + ' ' + prop + ':#' + [m[1], m[2], m[3]].map((v) => (+v).toString(16).padStart(2, '0')).join(''));
          if (out.length >= 12) return out;
        }
      }
    }
    return out;
  });
}

/**
 * @param {string} root   the agentos folder
 * @param {{file: string, text: string}[]} texts
 * @returns {Promise<{problems: {file: string, issues: string[]}[], summary: string}>}
 */
export async function leakCheck(root, texts) {
  const problems = [];
  try {
    const xlsx = await import(pathToFileURL(path.join(root, 'nicks_code', 'diagnostics', 'node_modules', 'xlsx', 'xlsx.mjs')).href);
    const read = xlsx.readFile || (xlsx.default && xlsx.default.readFile);
    xlsx.set_fs && xlsx.set_fs(fs);
    const wb = read(path.join(root, '..', 'Matrix - Agent List.xlsx'));
    const names = new Set(), cbs = new Set();
    const utils = xlsx.utils || xlsx.default.utils;
    /* only the PEOPLE columns — campaign/queue labels ("Matrix Cuddle") are not names */
    const PERSON = /^(agent name|team leader( name)?|sales force|sales manager|employee name|reports to)$/i;
    for (const n of wb.SheetNames) {
      const rows = utils.sheet_to_json(wb.Sheets[n], { header: 1 });
      const head = (rows[0] || []).map((h) => String(h == null ? '' : h).trim());
      const cols = head.map((h, i) => (PERSON.test(h) ? i : -1)).filter((i) => i >= 0);
      for (const row of rows.slice(1)) for (let i = 0; i < (row || []).length; i++) {
        const s = String(row[i] == null ? '' : row[i]).trim(); if (!s) continue;
        const m = /^CB[-\s]?(\d+)$/i.exec(s); if (m) { cbs.add('CB' + (+m[1])); continue; }
        if (cols.includes(i) && s.split(/\s+/).length >= 2 && !/^(grand total|total|\(blank\)|row labels|column labels)$/i.test(s)) names.add(s.toLowerCase());   // pivot labels are not people
      }
    }
    let hits = 0;
    const SOURCES = ['nicks_code/index.html', 'agent/index.html'].map((f) => fs.readFileSync(path.join(root, f), 'utf8').toLowerCase());
    for (const t of texts) {
      const low = t.text.toLowerCase();
      const found = [...names].filter((n) => low.includes(n));
      const cHit = (t.text.match(/\bCB\d{1,3}\b/g) || []).filter((c) => cbs.has(c)).length;
      /* never the name itself: its initials, and whether the PRODUCT carries it (text written into a page) or the data does */
      const where = found.map((n) => n.split(/\s+/).map((w) => w[0].toUpperCase()).join('') + (SOURCES.some((s) => s.includes(n)) ? ' (in the page source)' : ' (from the data)'));
      if (found.length || cHit) { hits++; problems.push({ file: t.file, issues: [found.length + ' real name(s) [' + where.join(', ') + '] and ' + cHit + ' real CB number(s) on screen'] }); }
    }
    return { problems, summary: hits ? hits + ' screenshot(s) carry real data — see above' : 'no real name or CB number on any screenshot' };
  } catch (e) {
    return { problems: [{ file: '(leak check)', issues: ['could not run: ' + e.message] }], summary: 'could not run' };
  }
}
