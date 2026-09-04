/* THE RULE BOOK MUST BE READ, NOT COPIED — and the peer average must be weighted.
 *
 * Two findings from the 2026-08-28 sweep, both of the same shape: a number that LOOKS
 * governed and isn't.
 *
 *  1. MTD_RULES.vat existed, was drift-checked against the spec JSON by
 *     verify-engine-rules.mjs, and was read by nothing. Every gross-up carried its own
 *     literal 1.15, so changing the VAT rate in the rule book (and the spec beside it)
 *     would have passed every guard and moved not one rand on screen. The engine now
 *     grosses up with MTD_VAT, derived from the rule.
 *
 *  2. The anonymous peer group published mean gwpEx and mean sales — totals divided by
 *     headcount — but published % to target as the MEAN OF EACH AGENT'S OWN PERCENTAGE.
 *     A two-day joiner on a target of 2 weighed the same as a full-month agent on 8, and
 *     the figure contradicted the mean sales and mean target sitting next to it. agg()
 *     defines it as Σsales ÷ Σtarget everywhere else; so does this now. It is the peer
 *     figure an agent is shown on their own card, so it has to be the same number.
 *
 * Run: node verify-rule-constants.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
const AGENTOS = 'C:/Users/aarav/OneDrive/Desktop/Chatterbox Agent OS/agentos';
const { chromium } = await import(pathToFileURL(path.join(AGENTOS, 'nicks_code', 'diagnostics', 'node_modules', 'playwright', 'index.mjs')).href);
const HTML = path.join(AGENTOS, ...(process.env.PULSE_HTML || 'nicks_code/index.html').split('/'));
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + ' — ' + d); } };

/* ---- the source scan: no gross-up may carry its own literal ---------------------- */
const src = fs.readFileSync(HTML, 'utf8').split('\n');
/* Track block comments across lines — this file explains its own maths at length, and a
   continuation line of prose looks nothing like a comment when read on its own. */
let inBlock = false;
const strays = [];
src.forEach((line, i) => {
  const opened = inBlock;
  const o = line.lastIndexOf('/*'), c = line.lastIndexOf('*/');
  if (!inBlock && o > -1 && c < o) inBlock = true;
  else if (inBlock && c > -1) inBlock = false;
  if (opened || inBlock) return;                                          // prose
  if (!/1\.15/.test(line)) return;
  if (/^\s*\/\//.test(line)) return;                                      // line comment
  if (/line-height|font-/.test(line)) return;                             // CSS
  if (/^\s*vat\s*:/.test(line)) return;                                   // the rules themselves
  if (/MTD_VAT\s*=/.test(line)) return;                                   // the zero-safe fallback IS the rule reader
  if (/saleValues?\s*:/.test(line)) return;                               // ported comms constants (index.tsx:143 + SALE_VALUES)
  if (/formulaA\s*:|ROUND\(SUM/.test(line)) return;                       // spec text quoted for display
  if (/<li>|<code>|<p>/.test(line)) return;                               // help copy
  strays.push((i + 1) + ': ' + line.trim().slice(0, 90));
});
ok('no calculation carries its own VAT literal', strays.length === 0, strays.join('  |  '));

/* Serve the real sidecar scripts. Answering every request with the HTML makes the browser
   parse a page as JavaScript and report a phantom syntax error, which the page-error check
   below would then blame on the app. */
const SIDE = { '/xlsx.full.min.js': path.join(AGENTOS, 'site', 'xlsx.full.min.js'),
  '/auth-gate.js': path.join(AGENTOS, 'site', 'auth-gate.js'),
  '/ask-widget.js': path.join(AGENTOS, 'site', 'ask-widget.js') };
const srv = http.createServer((q, s) => {
  const u = q.url.split('?')[0];
  const p = SIDE[u] || (u === '/' ? HTML : null);
  if (!p || !fs.existsSync(p)) { s.writeHead(404); s.end(); return; }
  s.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' });
  fs.createReadStream(p).pipe(s);
});
/* The peer groups only exist once there are agents in them, so pull the live state the way
   verify-all-tabs.mjs does. Without it the digest is empty and the peer check is vacuous. */
let blob = null;
try {
  const envTxt = fs.readFileSync(path.join(AGENTOS, 'supabase.env'), 'utf8');
  const env = Object.fromEntries(envTxt.split(/\r?\n/).filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
  const r = await fetch(env.SUPABASE_URL + '/storage/v1/object/raw/kv/vas-state',
    { headers: { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY } , signal: AbortSignal.timeout(90000) });
  if (r.ok) { blob = await r.text(); console.log('  live state: ' + (blob.length / 1048576).toFixed(2) + ' MB'); }
} catch (e) { /* offline: the source checks still run and the peer check reports it skipped */ }

await new Promise(r => srv.listen(8216, '127.0.0.1', r));
const b = await chromium.launch();
const page = await b.newPage();
const errs = []; page.on('pageerror', e => errs.push(String(e.message).slice(0, 110)));
await page.goto('http://127.0.0.1:8216/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__mtd && window.__mtd.rules(), null, { timeout: 30000 });
if (blob) await page.evaluate(x => { const S = window.__mtd.state(); const o = JSON.parse(x);
  for (const k of Object.keys(o)) S[k] = o[k]; window.__mtd.rebuild(); }, blob);
/* PIN THE PERIOD TO THE LATEST MONTH THAT HOLDS DATA. On the 1st of a month the live
   state's current month is empty, the digest builds null, and this guard failed on the
   calendar rather than on the arithmetic it exists to check (first seen 2026-09-01). */
await page.evaluate(() => { const S = window.__mtd.state();
  const days = [...Object.keys(S.sales || {}), ...Object.keys(S.calls || {})].sort();
  if (days.length) window.__mtd.setPeriod(days[days.length - 1].slice(0, 7), 'month'); });

/* ---- the engine grosses up with the rule ---------------------------------------- */
const v = await page.evaluate(() => ({ rule: window.__mtd.rules().vat, used: window.__mtd.vat() }));
ok('the engine grosses up with MTD_RULES.vat', v.used === v.rule, 'rule ' + v.rule + ' vs used ' + v.used);

/* Every gross-up site must name the rule. A grep-level check, because the alternative —
   re-deriving GWP here — is verify-bi-gwp.mjs's job and would only duplicate it. */
const sites = src.filter(l => /gwpEx\s*\*|gwp\s*\|\|\s*0\)\s*\/|gwpT\s*\/|tr\.gwp\s*\/|gwp\s*\/\s*MTD_VAT|uncasedVal\s*\*/.test(l))
  .filter(l => /MTD_VAT|1\.15/.test(l));
ok('every gross-up site names MTD_VAT (' + sites.length + ' sites)',
  sites.length >= 6 && sites.every(l => /MTD_VAT/.test(l)),
  sites.filter(l => !/MTD_VAT/.test(l)).join(' | '));

/* ---- the peer group is weighted -------------------------------------------------- */
const peer = await page.evaluate(() => {
  const d = window.__mtd.digest();
  if (!d || !d.agents || !d.agents.length || !d.groups) return { skip: true };
  d.rows = d.agents;
  const bad = [];
  for (const k in d.groups) {
    const mine = d.rows.filter(r => r.campaign + '|' + r.tenure === k);
    const tS = mine.reduce((a, r) => a + (r.sales || 0), 0);
    const tT = mine.reduce((a, r) => a + (r.target || 0), 0);
    const want = tT ? Math.round(tS / tT * 10000) / 10000 : null;
    const got = d.groups[k].pctT;
    if (want == null ? got != null : Math.abs((got || 0) - want) > 0.0002)
      bad.push(k + ': published ' + got + ', Σsales/Σtarget ' + want);
    /* the unweighted mean this replaced — proves the two genuinely differ on live data,
       so the check has something to catch */
    const each = mine.filter(r => r.pctT != null);
    if (each.length && want != null) {
      const mean = Math.round(each.reduce((a, r) => a + r.pctT, 0) / each.length * 10000) / 10000;
      if (Math.abs(mean - want) > 0.0002) window.__peerDiffers = true;
    }
  }
  return { bad, groups: Object.keys(d.groups).length, differs: !!window.__peerDiffers };
});
if (peer.skip) { ok('peer % to target is Σsales ÷ Σtarget', !blob, 'live state loaded but the digest was empty'); }
else {
  ok('peer % to target is Σsales ÷ Σtarget in every group (' + peer.groups + ')', peer.bad.length === 0, peer.bad.join('  |  '));
  /* The weighted and unweighted figures only agree when every agent in a group carries the
     same target, so this confirms the check has something real to catch on live data rather
     than passing by coincidence. */
  ok('the weighted figure differs from the mean-of-rates it replaced', peer.differs,
    'every agent has the same target this period — the check cannot discriminate');
}
ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
await b.close(); srv.close();
process.exit(fail ? 1 : 0);
