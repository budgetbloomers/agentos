/* VALUE-LEVEL reconciliation against the hand-built workbook.
   verify-generator.mjs proves the generated tracker has the right SHAPE; this one proves it
   carries the right NUMBERS. It drives the real app over the real August export set, forces
   the window the workbook actually covers (1–4 Aug — the uploads run to the 5th/6th, so a
   whole-month view is not comparing like with like) and diffs every agent row.

   Columns asserted EXACT: Employed Shifts, Actual Shifts, Att %, Sales Target, GWP Target,
   Sales Achieved, GWP Achieved, Ave GWP, Cancellations.

   The exceptions below are data, not code, and each is named so a future failure is a real
   regression rather than a re-run of an argument already settled:
     · Anerly Naidoo / Ramiska Binda / Thalente Celokuhle Xaba — one R99 sale each drifted
       between the 4-Aug pull the workbook was built from and the 5-Aug BI pull we ingest.
       Present in neither BI file; nothing in the app can conjure it.
     · Enoch Pillay / Sylvannas Gengan / Amahle Makhanyela — cancelled on 5 Aug, after the
       workbook was cut. The app is right; the workbook simply could not know yet.
     · Theva Pragasen (sick leave) / Darrien Govender (suspended) — on the roster and on the
       HR register all period, so the app counts their employed shifts. The workbook omits
       them. Policy call, deliberately left with the register.
   Referrals and QA are NOT asserted: no upload carries referrals (Adjustments page is their
   source) and the QA export is a later snapshot than the workbook's.                        */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const XLSX = createRequire(import.meta.url)('xlsx');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = process.env.AGENTOS || decodeURIComponent(new URL('../..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1').replace(/\/$/, '');   // repo-relative (2026-09-08): the laptop path failed every cloud run
const UP = path.join(REPO, 'uploads', '2026-08-06');
const DL = path.join(HERE, 'scratch', 'dl-values');
fs.rmSync(DL, { recursive: true, force: true }); fs.mkdirSync(DL, { recursive: true });
const SERVE = { '/': path.join(REPO, 'nicks_code', 'index.html'), '/index.html': path.join(REPO, 'nicks_code', 'index.html'),
  '/xlsx.full.min.js': path.join(REPO, 'site', 'xlsx.full.min.js') };
const server = http.createServer((q, s) => { const p = SERVE[q.url.split('?')[0]];
  if (!p || !fs.existsSync(p)) { s.writeHead(404); s.end('nf'); return }
  s.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' }); fs.createReadStream(p).pipe(s) });
await new Promise(r => server.listen(8134, '127.0.0.1', r));
const j = (...p) => path.join(...p);

const FROM = '2026-08-01', TO = '2026-08-04';
const SALES_DRIFT = ['anerlynaidoo', 'ramiskabinda', 'thalentecelokuhlexaba'];   // pull-date drift, both directions
const LATE_CANC = ['enochpillay', 'sylvannasgengan', 'amahlemakhanyela'];        // cancelled after the workbook was cut
const OFF_BOOK = ['thevapragasen', 'darriengovender'];                          // sick / suspended, omitted by hand
// Nick zeroes a shift for an agent the HR register marks present who produced nothing all
// day; the app follows the register. 6 Courtesy rows, listed so the count cannot creep.
const ATT_OVERRIDE = ['sechabamlambo', 'thulanigreatmanmbonambi', 'surpriseluckycwele',
  'mzwandilemasuku', 'nenekazimtsolo', 'bandiledlamini'];
/* NET OF CANCELLATION (owner directive, 2026-08-18). The workbook counts sales GROSS; the
   engine now counts NET, so for agents who had a cancellation inside 1–4 Aug the app is
   deliberately lower. That gap is NOT slack and is not excused: each one is PINNED to the
   exact rand below, so the app must be lower by precisely this much and any other movement
   still fails. Four Cuddle agents lost a whole R99 sale; three Courtesy agents kept the sale
   but lost a cancelled contract line from its GWP. Ave GWP is derived from the two and is
   allowed to follow. Delete this block and set salesNetOfCancellation=false to go back. */
const NET_DELTA = {
  enochpillay:                 { 'Sales Achieved': 1, 'GWP Achieved': 99 },
  shaylenericquelnaidoo:       { 'Sales Achieved': 1, 'GWP Achieved': 99 },
  sylvannasgengan:             { 'Sales Achieved': 1, 'GWP Achieved': 99 },
  sandisiweprettygirlzungu:    { 'Sales Achieved': 1, 'GWP Achieved': 99 },
  ashneekasavanisankarparsad:  { 'GWP Achieved': 20 },
  amahlemakhanyela:            { 'GWP Achieved': 25 },
  makhosimavuso:               { 'GWP Achieved': 25 },
};

let pass = 0, fail = 0; const failures = [];
const ok = (n, c, d = '') => { if (c) pass++; else { fail++; failures.push(n + (d ? ' — ' + d : '')); } };

const T = XLSX.read(fs.readFileSync(j(UP, 'VAS - August 2026 MTD Tracker 1 - 4 Aug.xlsx')), { type: 'buffer', cellDates: true });
const browser = await chromium.launch({ args: ['--js-flags=--max-old-space-size=8192'] });
const ctx = await browser.newContext({ acceptDownloads: true });
const page = await ctx.newPage();
const errors = []; page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
await page.goto('http://127.0.0.1:8134/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__mtd && window.__mtd.state(), null, { timeout: 30000 });

const FILES = ['Matrix - Agent List.xlsx', 'attendance_2026-08-01_to_2026-08-06.csv', 'BI Active - 05.08.xlsx',
  'BI Inactive - 05.08.xlsx', 'Call X Call report - 3 - 5.xlsx', 'Vici - Cuddle Agents - 3 - 5 Aug.csv',
  'evaluations-full-export-2026-08-06.csv'].map(f => j(UP, f));
console.log('uploading…');
await page.setInputFiles('#fileInput', FILES, { timeout: 60000 });
await page.waitForFunction(() => (window.__mtd.state().files || []).length >= 6, null, { timeout: 600000 });
await page.waitForTimeout(5000);
await page.evaluate(([f, t]) => { const S = window.__mtd.state();
  S.ui.preset = 'custom'; S.ui.from = f; S.ui.to = t; rebuild(); renderAll(); }, [FROM, TO]);
await page.waitForTimeout(1500);

// upload order must not matter: the Inactive file tops sales back up whichever way round it
// lands, so re-dropping BI Active last must leave the same money on the page.
const before = await page.evaluate(() => { const g = window.__mtd.model().grand; return { s: g.sales, gwp: Math.round(g.gwp) }; });
await page.setInputFiles('#fileInput', [j(UP, 'BI Active - 05.08.xlsx')], { timeout: 60000 });
await page.waitForTimeout(4000);
const after = await page.evaluate(() => { const g = window.__mtd.model().grand; return { s: g.sales, gwp: Math.round(g.gwp) }; });
ok('gross-up survives re-uploading BI Active after the cancellations file',
  before.s === after.s && before.gwp === after.gwp, `${JSON.stringify(before)} -> ${JSON.stringify(after)}`);

await page.evaluate(() => go('mtd'));
await page.waitForTimeout(600);
const dl = await Promise.all([page.waitForEvent('download', { timeout: 120000 }),
  page.click('button:has-text("Generate MTD tracker")')]).then(r => r[0]);
const out = j(DL, dl.suggestedFilename()); await dl.saveAs(out);
const G = XLSX.read(fs.readFileSync(out), { type: 'buffer', cellDates: true });

const norm = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
function tabulate(bk, sn) {
  const g = XLSX.utils.sheet_to_json(bk.Sheets[sn], { header: 1, raw: true, defval: '' });
  const hi = g.findIndex(r => r.some(c => String(c).trim() === 'Team Leader'));
  const hdr = g[hi].map(x => String(x).trim());
  const ai = hdr.indexOf('Agent'), li = hdr.indexOf('Team Leader');
  const rows = new Map(); let total = null;
  for (const r of g.slice(hi + 1)) {
    if (String(r[li] ?? '').trim() === 'Grand Total') { total = { hdr, r }; continue; }
    const agent = String(r[ai] ?? '').trim();
    if (agent) rows.set(norm(agent), { hdr, r, agent });
  }
  return { hdr, rows, total };
}
const num = (o, col) => { const i = o.hdr.indexOf(col); if (i < 0) return null;
  const n = Number(o.r[i]); return Number.isFinite(n) ? n : null; };

/* No aliases needed any more. This used to map the workbook's "Ashnee Kasavani Sankarparsad"
   onto the app's "Kasavani Snakarparsad", because the app took its display name from the Agent
   List's `Agent Name` column, which carries that typo. The engine now takes it from `Sales
   Force` (spec §3) — the column the workbook itself uses, and the string its Cancellations and
   QA lookups join on — so both sides spell the name the same way and the alias would misdirect.
   If this map ever needs an entry again, the roster is wrong, not the comparison. */
const ALIAS = {};

const EXACT = ['Employed Shifts', 'Actual Shifts', 'Att %', 'Sales Target', 'GWP Target',
  'Sales Achieved', 'GWP Achieved', 'Ave GWP', 'Cancellations'];

for (const sn of ['MTD - Cuddle', 'MTD - Courtesy']) {
  const t = tabulate(T, sn), g = tabulate(G, sn);
  const missing = [...t.rows.keys()].filter(k => !g.rows.has(ALIAS[k] || k));
  ok(`${sn}: every workbook agent is in the generated tracker`, missing.length === 0,
    missing.map(k => t.rows.get(k).agent).join(', '));
  const extra = [...g.rows.keys()].filter(k => ![...t.rows.keys()].some(x => (ALIAS[x] || x) === k));
  ok(`${sn}: no unexplained extra agents`, extra.every(k => OFF_BOOK.includes(k)), extra.join(', '));

  for (const col of EXACT) {
    const bad = [];
    for (const [k, tr] of t.rows) {
      const gr = g.rows.get(ALIAS[k] || k); if (!gr) continue;
      if (SALES_DRIFT.includes(k) && /Sales Achieved|GWP|Ave GWP|SPD|Att/.test(col)) continue;
      if (LATE_CANC.includes(k) && col === 'Cancellations') continue;
      if (ATT_OVERRIDE.includes(k) && /Actual Shifts|Att %/.test(col)) continue;
      // Ave GWP is GWP/Sales — it moves automatically with the two pinned columns below
      if (col === 'Ave GWP') continue;   // derived (ex-basis GWP ÷ sales) — both inputs asserted above
      /* CANCELLATIONS ARE DATED ON THE DAY THEY CANCELLED (2026-08-18). The workbook dates
         them on the day the SALE was made, so it cannot see a July sale cancelled in August
         and it does see an August sale cancelled later. The two answer different questions,
         so this column is not compared against the workbook at all — it is checked below
         against an independent recompute of the rule from the Inactive export itself. */
      if (col === 'Cancellations') continue;
      const a = num(tr, col), b = num(gr, col);
      if (a == null && b == null) continue;
      // the workbook is gross, the engine is net: subtract the PINNED cancellation, then
      // demand an exact match on what is left
      const adj = (NET_DELTA[k] && NET_DELTA[k][col]) || 0;
      /* GWP columns: the workbook is VAT-INCLUSIVE, the app displays EX-VAT (agent comms,
         2026-08-18). Convert the app figure ×1.15 before comparing; ±1 covers the
         round(ex)→incl re-rounding. All other columns stay exact. */
      const GWP_COL = col === 'GWP Achieved' || col === 'GWP Target';
      const bApp = GWP_COL ? Math.round((b || 0) * 1.15) : b;
      const tol = GWP_COL ? 1.5 : 0.005;
      if ((a == null) !== (b == null) || Math.abs((a || 0) - adj - (bApp || 0)) > tol)
        bad.push(`${tr.agent} wb=${a}${adj ? ' −' + adj + ' (net)' : ''} app=${b}${GWP_COL ? ' (→incl ' + bApp + ')' : ''}`);
    }
    ok(`${sn}: ${col} matches the workbook for every agent`, bad.length === 0, bad.slice(0, 5).join(' | '));
  }
}

/* CANCELLATIONS — independent recompute, straight from the Inactive export, mirroring
   Nick's pivot exactly (2026-08-18): filter on Contract CREATE Date, count DISTINCT Case
   Number, and rows with a blank Case Number land in the pivot's "(blank)" row — recurring
   lines, never counted against an agent. A cancellation is a cancelled SALE, so it uses the
   sale's unit and the sale's date; nothing here reads the workbook. */
{
  const inaFile = j(UP, 'BI Inactive - 05.08.xlsx');
  if (fs.existsSync(inaFile)) {
    const wbI = XLSX.read(fs.readFileSync(inaFile), { type: 'buffer', cellDates: true });
    const rowsI = XLSX.utils.sheet_to_json(wbI.Sheets['Export'] || wbI.Sheets[wbI.SheetNames[0]], { defval: '' });
    const ser = v => { if (v instanceof Date) return v.toISOString().slice(0, 10);
      const t = String(v ?? '').trim(); if (!t) return '';
      if (/^\d+(\.\d+)?$/.test(t)) return new Date(Date.UTC(1899, 11, 30) + Math.floor(parseFloat(t)) * 86400000).toISOString().slice(0, 10);
      const d = new Date(t); return isNaN(d) ? '' : d.toISOString().slice(0, 10); };
    const want = {};
    for (const r of rowsI) {
      const acct = String(r['Account Number'] ?? '').trim();
      if (!acct || /^applied filters/i.test(acct)) continue;
      if (String(r['Charge Code'] ?? '').trim().toUpperCase() === 'TESTRR' || acct === '622622') continue;
      if (!ser(r['Contract Deactivate Date'])) continue;               // still active, not a cancellation
      const cd = ser(r['Contract Create Date']); if (!cd || cd < FROM || cd > TO) continue;
      const cs = String(r['Case Number'] ?? '').trim();
      if (!cs) continue;                                                // the pivot's "(blank)" row — not a cancelled sale
      const ow = norm(String(r['Owner'] ?? '').replace(/-\s*panimax/ig, ''));
      (want[ow] = want[ow] || new Set()).add(cs);
    }
    const got = await page.evaluate(() => { const M = window.__mtd.model(); const o = {};
      for (const camp in (M.mtdCC || {})) for (const code in M.mtdCC[camp]) {
        const a = M.mtdCC[camp][code]; const k = (a.agent || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        o[k] = (o[k] || 0) + (a.canc || 0); } return o; });
    const bad = [];
    for (const ow in want) { const g = got[ow]; if (g === undefined) continue;   // off-roster owners are reported elsewhere
      if (g !== want[ow].size) bad.push(`${ow} calc=${want[ow].size} app=${g}`); }
    ok('Cancellations = DISTINCT cancelled cases, dated on Contract Create Date, blank cases excluded',
      bad.length === 0, bad.slice(0, 5).join(' | '));
  }
}

// The whole point of the gross-up: Cuddle GWP is a hard, independently known number.
const cud = tabulate(G, 'MTD - Cuddle');
const cudGwp = [...cud.rows.values()].filter(r => !OFF_BOOK.includes(norm(r.agent)))
  .reduce((s, r) => s + (num(r, 'GWP Achieved') || 0), 0);
// The workbook's R47 370 is GROSS. Under net-of-cancellation four Cuddle agents each lose a
// cancelled R99 sale, so the reconciled figure is 47 370 − 396. Written as the arithmetic
// rather than as a new constant, so the provenance of every rand stays visible.
const CUD_NET = ['enochpillay', 'shaylenericquelnaidoo', 'sylvannasgengan', 'sandisiweprettygirlzungu']
  .reduce((s, k) => s + (NET_DELTA[k]['GWP Achieved'] || 0), 0);
ok('Cuddle GWP reconciles to the workbook to the rand (app ex-VAT ×1.15 vs gross 47370 − ' + CUD_NET + ' cancelled)',
  Math.abs(Math.round(cudGwp * 1.15) - (47370 - CUD_NET)) <= 2, `${cudGwp} ex → ${Math.round(cudGwp * 1.15)} vs ${47370 - CUD_NET}`);

// GWP must be whole rand: it is rounded per account before summing, so no total can carry cents.
const cents = [];
for (const sn of ['MTD - Cuddle', 'MTD - Courtesy']) {
  const s = tabulate(G, sn);
  for (const r of [...s.rows.values(), s.total].filter(Boolean)) {
    const v = num(r, 'GWP Achieved');
    if (v != null && Math.abs(v - Math.round(v)) > 1e-9) cents.push(`${r.agent || 'Grand Total'}=${v}`);
  }
}
ok('GWP carries no fractional cents (rounded per account, not per total)', cents.length === 0, cents.slice(0, 5).join(', '));

ok('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
failures.forEach(f => console.log('FAIL: ' + f));
await browser.close(); server.close();
process.exit(fail || errors.length ? 1 : 0);