/* Drive the app with the REAL August sources and print the MTD it produces.
 *
 *   node nicks_code/diagnostics/august-live.mjs <dir-with-uploads> [from] [to]
 *
 * Loads BI Active (money), BI Inactive (cancellations), CallX (Courtesy calls),
 * Vici (Cuddle calls) and the tracker workbook's roster, then reports the model.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const DIR = process.argv[2];
const FROM = process.argv[3] || '2026-08-01';
const TO   = process.argv[4] || '2026-08-05';
if (!DIR) { console.error('usage: august-live.mjs <dir> [from] [to]'); process.exit(2); }

const find = re => {
  const f = fs.readdirSync(DIR).find(n => re.test(n));
  if (!f) throw new Error('no file matching ' + re);
  return path.join(DIR, f);
};

const APP = process.env.APP_HTML
  ? 'file://' + process.env.APP_HTML
  : 'file://' + new URL('../index.html', import.meta.url).pathname;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  .catch(() => chromium.launch());
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));
await page.goto(APP);
// The page pulls SheetJS from cdnjs; inject the vendored copy so this runs offline.
await page.addScriptTag({ path: new URL('../../site/xlsx.full.min.js', import.meta.url).pathname });
await page.waitForFunction(() => typeof XLSX !== 'undefined');

// xlsx go in as base64 through the app's own reader; csv as text.
const sendXlsx = async (p) => {
  const b64 = fs.readFileSync(p).toString('base64');
  return page.evaluate(async ([name, b64]) => {
    const bin = atob(b64); const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const text = await window.__mtd.bufferToText(name, u8.buffer);
    return window.__mtd.ingest(name, text);
  }, [path.basename(p), b64]);
};
const sendText = async (p) =>
  page.evaluate(([n, t]) => window.__mtd.ingest(n, t),
    [path.basename(p), fs.readFileSync(p, 'utf8')]);

const loaded = {};
const SKIP_TRACKER = !!process.env.SKIP_TRACKER;
for (const [label, re, isCsv] of [
  ['agent list',     /Matrix__Agent_List.*\.xlsx$/i,   false],
  ['roster/tracker', /VAS__August.*Tracker.*\.xlsx$/i, false],
  ['BI active',      /BI_Active.*\.xlsx$/i,            false],
  ['BI inactive',    /BI_Inactive.*\.xlsx$/i,          false],
  ['CallX',          /Call_X.*\.xlsx$/i,               false],
  ['Vici',           /Vici.*\.csv$/i,                  true ],
]) {
  if (SKIP_TRACKER && label === 'roster/tracker') { console.log('  skipped  roster/tracker (SKIP_TRACKER)'); continue; }
  const p = find(re);
  loaded[label] = isCsv ? await sendText(p) : await sendXlsx(p);
  console.log(`  ${loaded[label] ? 'loaded ' : 'FAILED '} ${label.padEnd(15)} ${path.basename(p)}`);
}

await page.evaluate(([f, t]) => window.__mtd.setRange(f, t), [FROM, TO]);

const out = await page.evaluate(() => {
  const m = window.__mtd.model();
  const S = window.__mtd.state();
  const roll = c => {
    const rows = Object.values(m.mtdCC[c] || {});
    const s = k => rows.reduce((a, r) => a + (r[k] || 0), 0);
    return { n: rows.length, emp: s('emp'), act: s('act'), sales: s('sales'),
             gwp: Math.round(s('gwp') * 100) / 100, talk: s('talk'), canc: s('canc') };
  };
  return {
    files: S.files.map(f => `${f.type} · ${f.rows} rows`),
    dates: m.dates, dropped: m.droppedDates, viciPartial: m.viciPartial,
    camps: Object.fromEntries(['Cuddle','Courtesy','Nesting','VT'].map(c => [c, roll(c)])),
    grand: { sales: m.grand.sales, gwp: Math.round(m.grand.gwp * 100) / 100, canc: m.grand.canc },
    unmatched: Object.entries(m.unmatched || {}).slice(0, 12).map(([k, v]) => `${k} (${v.src})`),
  };
});
await browser.close();

console.log('\n  registry:'); out.files.forEach(f => console.log('    ' + f));
console.log(`\n  dialing days : ${out.dates.join(', ')}`);
console.log(`  dropped      : ${(out.dropped || []).join(', ') || '(none)'}`);
console.log(`  vici partial : ${out.viciPartial}`);
console.log('\n  campaign                n    emp    act   sales        gwp      talk(h)  canc');
for (const [c, v] of Object.entries(out.camps))
  console.log(`    ${c.padEnd(20)} ${String(v.n).padStart(3)} ${String(v.emp).padStart(6)} ` +
    `${String(v.act).padStart(6)} ${String(v.sales).padStart(7)} ${String(v.gwp).padStart(10)} ` +
    `${(v.talk/3600).toFixed(1).padStart(10)} ${String(v.canc).padStart(5)}`);
console.log(`\n  VAS grand: sales ${out.grand.sales}  gwp ${out.grand.gwp}  cancellations ${out.grand.canc}`);
if (out.unmatched.length) { console.log('\n  unmatched identities:'); out.unmatched.forEach(u => console.log('    ' + u)); }
if (pageErrors.length) console.log('\n  PAGE ERRORS: ' + pageErrors.join(' | '));
