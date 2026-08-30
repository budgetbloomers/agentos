/* BI + GWP — the money model, checked against the REAL exports rather than against itself.
 *
 * Every figure below is recomputed independently from the raw workbook in Node and compared
 * with what the app stored, agent-day by agent-day. The engine and this file share no code,
 * so a defect has to appear in both, identically, to pass.
 *
 * What it proves (the four things that can go wrong with a regrain):
 *   1. SALES  = COUNT DISTINCT Case Number per agent-day (gross union with Inactive)
 *   2. GWP    = SUM ROUND(case total x 1.15) + the pooled uncased residual
 *   3. MONEY IS CONSERVED — case-grain GWP equals account-grain GWP to the rand. Regraining
 *      re-buckets charge lines; it must never create or destroy money.
 *   4. NO CASE SPANS TWO ACCOUNTS — the structural fact that makes the regrain a pure
 *      subdivision, so a sale can never be merged or moved between agents.
 *
 * Needs uploads/2026-08-13/{Active,Inactive}.xlsx (gitignored — customer data). Skips without.
 * Run: node verify-bi-gwp.mjs      (PULSE_HTML=site/pulse/index.html for the build copy)
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

const REPO = String.raw`c:\Users\aarav\OneDrive\Desktop\Chatterbox Agent OS\agentos`;
const HTML = path.join(REPO, ...(process.env.PULSE_HTML || 'nicks_code/index.html').split('/'));
const UP = path.join(REPO, 'uploads', '2026-08-13');
const ACT = path.join(UP, 'Active.xlsx'), INA = path.join(UP, 'Inactive.xlsx');
const ROSTER = path.join(UP, 'Matrix - Agent List.xlsx');
if (!fs.existsSync(ACT) || !fs.existsSync(INA)) {
  console.log(`(skipping — needs Active.xlsx + Inactive.xlsx in ${UP})`); process.exit(0);
}
let pass = 0, fail = 0; const failures = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; failures.push(n + (d ? ' — ' + d : '')); console.log('  FAIL ' + n + ' — ' + d); } };

/* ---------- independent recompute, straight from the workbook ---------- */
const RULES = JSON.parse(fs.readFileSync(path.join(REPO, 'specs', 'mtd_engine_rules.json'), 'utf8'));
const EXCL_CODES = (RULES.sources.find(s => s.id === 'bi_active').exclusions.find(e => e.field === 'Charge Code') || {}).equals;
const EXCL_ACCT = (RULES.sources.find(s => s.id === 'bi_active').exclusions.find(e => e.field === 'Account Number') || {}).equals;
const VAT = 1.15, UNCASED = '~uncased';

const iso = v => {                                   // Excel serial / string -> yyyy-mm-dd
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const t = String(v).trim(); if (!t) return '';
  if (/^\d+(\.\d+)?$/.test(t)) return new Date(Date.UTC(1899, 11, 30) + Math.floor(parseFloat(t)) * 86400000).toISOString().slice(0, 10);
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return m[0];
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
  const d = new Date(t); return isNaN(d) ? '' : d.toISOString().slice(0, 10);
};
const money = v => {                                 // ZA comma-decimal safe, as INGEST.bi
  const s = String(v ?? '').replace(/\s/g, '').replace(/^(-?\d+),(\d+)$/, '$1.$2').replace(/[^0-9.\-]/g, '');
  return parseFloat(s);
};
// normName, copied verbatim from the app (index.html) — the owner key S.sales is stored
// under. It strips the "- Panimax" suffix, any embedded CB code, and all non-letters.
const nName = s => (s || '').toLowerCase().replace(/-\s*panimax/g, '').replace(/panimax/g, '').replace(/cb[\s-]*\d+/g, '').replace(/[^a-z]/g, '');

function read(file) {
  const wb = XLSX.readFile(file, { cellDates: true });
  const raw = XLSX.utils.sheet_to_json(wb.Sheets.Export, { header: 1, defval: null, blankrows: false });
  const hm = {}; raw[0].forEach((h, i) => { const k = String(h ?? '').trim(); if (k && !(k in hm)) hm[k] = i; });  // first wins (Q4 dupes)
  const g = (r, k) => r[hm[k]];
  return raw.slice(1).map(r => ({
    acct: String(g(r, 'Account Number') ?? '').trim(),
    caseNo: String(g(r, 'Case Number') ?? '').trim(),
    contract: String(g(r, 'Contract Number') ?? '').trim(),
    owner: String(g(r, 'Owner') ?? '').trim(),
    code: String(g(r, 'Charge Code') ?? '').trim().toUpperCase(),
    chg: money(g(r, 'Charge Amount')),
    create: iso(g(r, 'Contract Create Date')),
    deact: iso(g(r, 'Contract Deactivate Date')),
  }));
}
const keep = r => r.acct && !/^applied filters/i.test(r.acct)
  && !(EXCL_CODES && r.code === String(EXCL_CODES).toUpperCase())
  && !(EXCL_ACCT && r.acct === String(EXCL_ACCT))
  && !isNaN(r.chg) && /^\d{4}-\d{2}-\d{2}$/.test(r.create);

const A = read(ACT).filter(keep);
const I = read(INA).filter(keep);

// units per agent-day: date -> owner -> unit -> ex-VAT charge  (Active, then Inactive grossed back)
const units = {};
const put = (d, ow, unit, v) => {
  const o = ((units[d] = units[d] || {})[ow] = units[d][ow] || {});
  o[unit] = (o[unit] || 0) + v;
};
for (const r of A) put(r.create, nName(r.owner), r.caseNo || UNCASED, r.chg);
/* The rule book decides whether a cancelled sale is restored. Read it from the spec rather
   than assuming, so this recompute follows the engine's rule instead of a stale copy of it. */
const NET = !!(RULES.money_model_unit && RULES.money_model_unit.net_of_cancellation);
const seen = new Set();
if (!NET) for (const r of I) {
  if (!r.deact) continue;                                   // still active, not a cancellation
  const k = r.acct + '|' + r.contract + '|' + r.deact;      // INGEST.inactive dedup key
  if (seen.has(k)) continue; seen.add(k);
  put(r.create, nName(r.owner), r.caseNo || r.acct, r.chg); // cased key, else the account (legacy grain)
}
/* GWP GROSSES ONCE off the summed charge, matching the source pivot ("Sum of Charge Amount",
   then VAT) — NOT round-per-case-then-add, which re-rounds an already-rounded number and
   drifts a rand or two per agent. `gwpEx` is the pivot's column D. */
const expect = {};                                          // date -> owner -> {n, gwpEx, gwp}
for (const d in units) for (const ow in units[d]) {
  let n = 0, x = 0;
  for (const u in units[d][ow]) { if (u !== UNCASED) n++; x += units[d][ow][u]; }
  (expect[d] = expect[d] || {})[ow] = { n, gwpEx: x, gwp: Math.round(x * VAT) };
}

/* ---------- structural invariants, from the raw rows ---------- */
const acctOfCase = {}; let spanning = 0;
for (const r of [...A, ...I]) { if (!r.caseNo) continue;
  if (acctOfCase[r.caseNo] && acctOfCase[r.caseNo] !== r.acct) spanning++;
  acctOfCase[r.caseNo] = r.acct; }
ok('no case spans two accounts — the regrain is a pure subdivision', spanning === 0, spanning + ' spanning case(s)');

// money conservation: same charge lines, bucketed by account instead of by case
let gCase = 0, gAcct = 0;
{
  const byAcct = {};
  for (const d in units) for (const ow in units[d]) for (const u in units[d][ow]) gCase += Math.round(units[d][ow][u] * VAT);
  for (const r of A) { const k = r.create + '|' + nName(r.owner) + '|' + r.acct; byAcct[k] = (byAcct[k] || 0) + r.chg; }
  const s2 = new Set();
  if (!NET) for (const r of I) { if (!r.deact) continue; const dk = r.acct + '|' + r.contract + '|' + r.deact;
    if (s2.has(dk)) continue; s2.add(dk);
    const k = r.create + '|' + nName(r.owner) + '|' + r.acct; byAcct[k] = (byAcct[k] || 0) + r.chg; }
  for (const k in byAcct) gAcct += Math.round(byAcct[k] * VAT);
}
ok('MONEY IS CONSERVED — case-grain GWP equals account-grain GWP to the rand',
  gCase === gAcct, 'case R' + gCase.toLocaleString() + ' vs account R' + gAcct.toLocaleString());

/* ---------- load the same files into the app ---------- */
const SERVE = { '/': HTML, '/index.html': HTML, '/xlsx.full.min.js': path.join(REPO, 'site', 'xlsx.full.min.js') };
const server = http.createServer((q, s) => {
  const p = SERVE[q.url.split('?')[0]];
  if (!p || !fs.existsSync(p)) { s.writeHead(404); s.end('nf'); return; }
  s.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' });
  fs.createReadStream(p).pipe(s);
});
await new Promise(r => server.listen(8149, '127.0.0.1', r));
const browser = await chromium.launch({ args: ['--js-flags=--max-old-space-size=8192'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.goto('http://127.0.0.1:8149/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__mtd && window.__mtd.state(), null, { timeout: 30000 });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__mtd && window.__mtd.state(), null, { timeout: 30000 });
const files = [ACT, INA]; if (fs.existsSync(ROSTER)) files.unshift(ROSTER);
await page.setInputFiles('#fileInput', files, { timeout: 300000 });
await page.waitForFunction(n => (window.__mtd.state().files || []).length >= n, files.length, { timeout: 600000 });
{ let last = -1, stable = 0;
  for (let i = 0; i < 150; i++) { await page.waitForTimeout(1000);
    const n = await page.evaluate(() => (window.__mtd.state().files || []).length);
    if (n === last) { if (++stable >= 4) break; } else { stable = 0; last = n; } } }

const got = await page.evaluate(() => {
  const S = window.__mtd.state(), R = window.__mtd.rules(), out = {};
  for (const d in S.sales) { out[d] = {};
    for (const ow in S.sales[d]) out[d][ow] = { n: S.sales[d][ow].n || 0, gwp: S.sales[d][ow].gwp || 0,
      gwpEx: S.sales[d][ow].x, units: Object.keys(S.sales[d][ow].a || {}).length,
      uncased: Object.keys(S.sales[d][ow].a || {}).filter(k => k === R.uncasedUnitKey).length }; }
  return { sales: out, unit: R.saleUnit, net: R.salesNetOfCancellation, stale: window.staleGrainDays().length };
});
ok('engine is on the case grain, and its cancellation rule matches the rule book',
  got.unit === 'Case Number' && got.net === NET, JSON.stringify([got.unit, got.net, 'spec net=' + NET]));
ok('every stored day is stamped case-grain (none left on the old account grain)', got.stale === 0, String(got.stale));

/* THE CURRENT RULE MUST REACH ALREADY-STORED DATA.
   n and gwp used to be frozen at upload time, so changing the cancellation rule left every
   previously-uploaded day answering under the old one until it was uploaded again — the app
   showed yesterday's rule under today's label. rebuild() now re-derives them from the stored
   inputs (`a` plus S.cancRows), which is idempotent, so the figures on screen always belong to
   the rule in force. Simulated by corrupting a stored total, exactly what an old-rule day is. */
const rederive = await page.evaluate(() => {
  const S = window.__mtd.state();
  const d = Object.keys(S.sales).sort()[0], ow = Object.keys(S.sales[d])[0];
  const truth = [S.sales[d][ow].n, S.sales[d][ow].gwp];
  S.sales[d][ow].n = 999; S.sales[d][ow].gwp = 999999;      // a day carrying the wrong rule
  window.__mtd.rebuild();
  return { truth, after: [S.sales[d][ow].n, S.sales[d][ow].gwp] };
});
ok('a stored day carrying the wrong rule is re-derived on rebuild, not left frozen',
  rederive.after[0] === rederive.truth[0] && rederive.after[1] === rederive.truth[1],
  JSON.stringify(rederive));

/* THE STALE-GRAIN WARNING. Days stored before the regrain keep ACCOUNT keys and cannot be
   recalculated in place, so the app must SAY so — otherwise a deploy lands, the numbers do not
   move, and the only available reading is that the change failed. Simulated by stripping the
   case stamp from one stored day, exactly what an old upload looks like. */
const stale = await page.evaluate(() => {
  const S = window.__mtd.state();
  const d = Object.keys(S.sales).sort()[0];
  const before = staleGrainDays().length;
  for (const ow in S.sales[d]) delete S.sales[d][ow].u;      // an old-grain day
  const after = staleGrainDays().length;
  const banner = staleGrainBanner();
  S.ui.tab = 'mtd'; renderPage();
  return new Promise(r => setTimeout(() => r({ before, after, day: d,
    banner, onPage: /count sales per ACCOUNT, not per case/i.test(document.getElementById('view')?.innerText || '') }), 1300));
});
ok('a day with no case stamp is detected as stale', stale.before === 0 && stale.after === 1, JSON.stringify([stale.before, stale.after]));
ok('the warning names the count, the rule and the fix', /1 stored day/.test(stale.banner)
  && /Case Number/.test(stale.banner) && /Re-upload the BI Active and BI Inactive/.test(stale.banner), stale.banner.slice(0, 180));
// It must NOT overstate what is outstanding: the cancellation rule is re-derived on every
// build and already applies, so only the case regrain is actually waiting on a re-upload.
ok('it says cancellations ARE already applied, so only the regrain is outstanding',
  /Cancellations <b>are<\/b> already applied/.test(stale.banner), stale.banner.slice(0, 220));
ok('it says the regrain changes a figure only for same-customer, same-day multi-case sales',
  /two or more cases for the same customer on the same day/.test(stale.banner));
ok('and it actually renders on Month to Date, where the numbers are read', stale.onPage);

/* ---------- compare, agent-day by agent-day ---------- */
let cmp = 0, badN = [], badG = [], badX = [], missing = [];
for (const d in expect) {
  for (const ow in expect[d]) {
    const e = expect[d][ow], a = (got.sales[d] || {})[ow];
    if (!a) { if (missing.length < 6) missing.push(d + ' ' + ow.slice(0, 12)); continue; }
    cmp++;
    if (a.n !== e.n && badN.length < 8) badN.push(`${d} ${ow.slice(0, 14)} app=${a.n} calc=${e.n}`);
    if (a.gwp !== e.gwp && badG.length < 8) badG.push(`${d} ${ow.slice(0, 14)} app=R${a.gwp} calc=R${e.gwp}`);
    if (Math.abs((a.gwpEx || 0) - e.gwpEx) > 0.005 && badX.length < 8) badX.push(`${d} ${ow.slice(0, 14)} app=${(a.gwpEx||0).toFixed(2)} calc=${e.gwpEx.toFixed(2)}`);
  }
}
ok('every agent-day in the workbook is present in the app', !missing.length, missing.join(' | '));
ok(`SALES match on all ${cmp} agent-days — COUNT DISTINCT Case Number`, !badN.length, badN.join(' | '));
ok(`GWP match on all ${cmp} agent-days — ROUND(SUM(charge) x 1.15), grossed once`, !badG.length, badG.join(' | '));
ok(`ex-VAT charge total matches on all ${cmp} agent-days — the pivot's "Sum of Charge Amount"`, !badX.length, badX.join(' | '));

// totals, printed so a human can eyeball the money against the export
let tn = 0, tg = 0, en = 0, eg = 0, unc = 0;
for (const d in expect) for (const ow in expect[d]) { en += expect[d][ow].n; eg += expect[d][ow].gwp; }
for (const d in got.sales) for (const ow in got.sales[d]) { tn += got.sales[d][ow].n; tg += got.sales[d][ow].gwp; unc += got.sales[d][ow].uncased; }
ok('floor totals agree', tn === en && tg === eg, `app ${tn}/R${tg.toLocaleString()} vs calc ${en}/R${eg.toLocaleString()}`);
ok('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

console.log(`\n  sales ${tn}  ·  GWP R${tg.toLocaleString()}  ·  ${cmp} agent-days  ·  ${unc} uncased residual bucket(s)`);
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
failures.forEach(f => console.log('FAIL: ' + f));
await browser.close(); server.close();
process.exit(fail ? 1 : 0);
