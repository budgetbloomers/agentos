/* LEAD MANAGEMENT in VAS Analytics — and the REMOVAL of Lead Allocation (2026-08-27).
 *
 * Nick: "remove lead allocation from vas and from the upload station remove lead
 * allocation open cases". The suite asserts the new contract:
 *   · a plain Salesforce Open Cases file (no LM slot, no LM filename) is REFUSED, loudly
 *   · declared for Lead Management (slot or filename), the same file loads into ITS book
 *   · the Lead Allocation page, nav entry, Upload Station slot and book are GONE
 *   · Lead Management still renders from its own stores with the Ops-ported maths intact
 *     (ALL AGENTS row equals both the sum of its status columns and the sum of agents)
 *   · its export IS the on-screen table, not the raw case rows
 *   · lead AGE is derived from Date/Time Opened, never taken from "Age (Hours)" on trust
 *
 * Needs uploads/2026-08-13/{Matrix - Agent List.xlsx, SF Open Cases 5 - 13.xls}. Skips without.
 * Run: node verify-leads-vas.mjs      (PULSE_HTML=site/pulse/index.html for the build copy)
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

const REPO = process.env.AGENTOS || decodeURIComponent(new URL('../..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1').replace(/\/$/, '');   // repo-relative (2026-09-08): the laptop path failed every cloud run
const HTML = path.join(REPO, ...(process.env.PULSE_HTML || 'nicks_code/index.html').split('/'));
const UP = path.join(REPO, 'uploads', '2026-08-13');
const ROSTER = path.join(UP, 'Matrix - Agent List.xlsx');
const OPEN = fs.existsSync(UP) ? (fs.readdirSync(UP).find(f => /^SF Open/i.test(f)) || null) : null;
const CLOSED = fs.existsSync(UP) ? (fs.readdirSync(UP).find(f => /^SF Closed/i.test(f)) || null) : null;
if (!OPEN || !fs.existsSync(ROSTER)) { console.log(`(skipping — needs an "SF Open*" export + Agent List in ${UP})`); process.exit(0); }

let pass = 0, fail = 0; const failures = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; failures.push(n + (d ? ' — ' + d : '')); console.log('  FAIL ' + n + ' — ' + d); } };

const SERVE = { '/': HTML, '/index.html': HTML, '/xlsx.full.min.js': path.join(REPO, 'site', 'xlsx.full.min.js') };
const server = http.createServer((q, s) => {
  const p = SERVE[q.url.split('?')[0]];
  if (!p || !fs.existsSync(p)) { s.writeHead(404); s.end('nf'); return; }
  s.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' });
  fs.createReadStream(p).pipe(s);
});
await new Promise(r => server.listen(8151, '127.0.0.1', r));
const browser = await chromium.launch({ args: ['--js-flags=--max-old-space-size=8192'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.goto('http://127.0.0.1:8151/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__mtd && window.__mtd.state(), null, { timeout: 30000 });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__mtd && window.__mtd.state(), null, { timeout: 30000 });

const settle = async () => { let last = -1, stable = 0;
  for (let i = 0; i < 120; i++) { await page.waitForTimeout(1000);
    const n = await page.evaluate(() => (window.__mtd.state().files || []).length);
    if (n === last) { if (++stable >= 4) break; } else { stable = 0; last = n; } } };

/* ---------- 1. a plain Open Cases drop (no slot, no LM filename) is REFUSED ---------- */
const plain = [ROSTER, path.join(UP, OPEN)]; if (CLOSED) plain.push(path.join(UP, CLOSED));
await page.setInputFiles('#fileInput', plain, { timeout: 300000 });
await page.waitForFunction(() => (window.__mtd.state().files || []).length >= 1, null, { timeout: 600000 });
await settle();
const intake1 = await page.evaluate(() => {
  const S = window.__mtd.state();
  return { types: S.files.map(f => f.type), roster: S.roster.length,
    alloc: S.opencases ? S.opencases.rows.length : null,
    lm: S.opencasesLM ? S.opencasesLM.rows.length : null,
    closed: S.closedcases ? Object.keys(S.closedcases.rows).length : 0 };
});
ok('roster loads from the bulk drop', intake1.roster > 0, 'roster=' + intake1.roster);
ok('the plain SF Open Cases file is REFUSED (Lead Allocation removed) — nothing registered as "open cases"',
  !intake1.types.some(t => t === 'open cases') && intake1.alloc === null, JSON.stringify(intake1.types));
ok('…and it did not sneak into the Lead Management book either', intake1.lm === null, 'lm=' + intake1.lm);

/* ---------- 2. the SAME file declared for Lead Management loads into ITS book ---------- */
await page.evaluate(() => { window.__slotExpected = 'opencasesLM'; });
await page.setInputFiles('#fileInput', [path.join(UP, OPEN)], { timeout: 300000 });
await settle();
const intake2 = await page.evaluate(() => {
  const S = window.__mtd.state();
  return { types: S.files.map(f => f.type),
    lm: S.opencasesLM ? S.opencasesLM.rows.length : null,
    total: S.opencasesLM ? S.opencasesLM.total : null,
    alloc: S.opencases ? S.opencases.rows.length : null };
});
ok('dropped on the Lead Management — Open Cases slot, the same file is ingested',
  intake2.lm > 0 && intake2.types.some(t => t === 'open cases (lead mgmt)'), JSON.stringify(intake2));
ok('one stored row per Case Number (the export repeats a case per contract line)',
  intake2.lm === intake2.total, intake2.lm + ' vs ' + intake2.total);
ok('the retired Lead Allocation book stays empty throughout', intake2.alloc === null, 'alloc=' + intake2.alloc);

/* ---------- 3. Lead Management renders from its own book, maths intact ---------- */
await page.evaluate(() => go('leads'));
await page.waitForTimeout(1400);
const leads = await page.evaluate(() => {
  const tbl = document.querySelectorAll('#view table.data')[0];
  if (!tbl) return { noTable: true };
  const head = [...tbl.querySelectorAll('thead th')].map(h => h.textContent.trim());
  const iOpen = head.indexOf('Total open');
  const rows = [...tbl.querySelectorAll('tbody tr')];
  const num = s => { const v = parseFloat(String(s).replace(/[^0-9.\-]/g, '')); return isFinite(v) ? v : 0; };
  const cells = tr => [...tr.querySelectorAll('td')].map(td => td.textContent.trim());
  // status columns sit between Emp Code and Total open
  const stIdx = []; for (let i = head.indexOf('Emp Code') + 1; i < iOpen; i++) stIdx.push(i);
  const gtc = cells(rows[rows.length - 1]);
  const per = {}; rows.slice(0, -1).forEach(tr => { const c = cells(tr); per[c[1]] = num(c[iOpen]); });
  return { noTable: false, gtOpen: num(gtc[iOpen]),
    stSum: stIdx.reduce((s, i) => s + num(gtc[i]), 0),
    agentSum: Object.values(per).reduce((s, v) => s + v, 0),
    nAgents: rows.length - 1, zeroHolders: Object.values(per).filter(v => v === 0).length,
    statusCols: head.filter(h => /attempt|^Currently on:/i.test(h)).length,
    book: window.__mtd.state().opencasesLM.rows.length };
});
ok('Lead Management renders with an ALL AGENTS total row', !leads.noTable && leads.gtOpen > 0, JSON.stringify(leads).slice(0, 160));
ok('ALL AGENTS Total open equals the sum of its status columns (each lead counted once)',
  leads.gtOpen === leads.stSum, `total ${leads.gtOpen} vs statuses ${leads.stSum}`);
ok('ALL AGENTS Total open equals the sum of the agent rows', leads.gtOpen === leads.agentSum,
  `total ${leads.gtOpen} vs agents ${leads.agentSum}`);
ok('zero-holders stay on the table (a roster-seeded view, not a filtered one)', leads.zeroHolders > 0, String(leads.zeroHolders));
ok('the status pivot is capped at 10 columns', leads.statusCols <= 10, String(leads.statusCols));

/* ---------- 4. the export must BE the table, not the raw case rows ---------- */
const cmp = await page.evaluate(async () => {
  const S = window.__mtd.state(); S.ui.tab = 'leads'; renderPage();
  await new Promise(r => setTimeout(r, 1200));
  const e = window.__exp;
  if (!e || !e.cols) return { noExp: true };
  const tbl = document.querySelectorAll('#view table.data')[0];
  const domHead = [...tbl.querySelectorAll('thead th')].map(h => h.textContent.trim());
  const expHead = e.cols.map(c => c.h);
  const domRows = [...tbl.querySelectorAll('tbody tr')];
  const strip = v => {
    let t = String(v == null ? '' : v).replace(/<[^>]*>/g, '').replace(/\u00a0/g, ' ').trim();
    if (t === '' || t === '-' || t === '\u2013') return '';
    const num = t.replace(/%/g, '').replace(/[\s\u202f]/g, '').replace(/,(\d{1,2})$/, '.$1').replace(/,/g, '');
    if (/^-?\d+(\.\d+)?$/.test(num)) return String(Math.round(parseFloat(num) * 10) / 10);
    return t.replace(/\s+/g, ' ');
  };
  const stripName = v => strip(v).replace(/^[A-Z]{2,3}(?=[A-Z][a-z])/, '');
  const norm = (arr) => arr.map((v, i) => i === 1 ? stripName(v) : strip(v));
  const domLast = norm([...domRows[domRows.length - 1].querySelectorAll('td')].map(td => td.textContent));
  const expLast = norm(e.cols.map(c => c.csv ? c.csv(e.rows[e.rows.length - 1]) : c.f(e.rows[e.rows.length - 1])));
  const domFirst = norm([...domRows[0].querySelectorAll('td')].map(td => td.textContent));
  const expFirst = norm(e.cols.map(c => c.csv ? c.csv(e.rows[0]) : c.f(e.rows[0])));
  const csv = e.cols.map(c => c.h).join(',');
  return { noExp: false, name: e.name, domHead, expHead, domRows: domRows.length, expRows: e.rows.length,
    headMatch: domHead.join('|') === expHead.join('|'),
    lastMatch: domLast.join('|') === expLast.join('|'), domLast, expLast,
    firstMatch: domFirst.join('|') === expFirst.join('|'), domFirst, expFirst,
    rawish: /Case Number|case_number|Contract Number/i.test(csv) };
});
ok('Lead Management publishes an export', !cmp.noExp && cmp.name === 'lead_management', JSON.stringify(cmp).slice(0, 120));
if (!cmp.noExp) {
  ok('export headers are exactly the on-screen headers', cmp.headMatch,
    'dom=' + (cmp.domHead || []).join(',') + ' vs exp=' + (cmp.expHead || []).join(','));
  ok('export has one row per screen row (ALL AGENTS included)', cmp.expRows === cmp.domRows,
    cmp.expRows + ' vs ' + cmp.domRows);
  ok('every value in the first agent row equals the screen', cmp.firstMatch,
    'dom=' + (cmp.domFirst || []).join('|') + '  exp=' + (cmp.expFirst || []).join('|'));
  ok('every value in the ALL AGENTS row equals the screen', cmp.lastMatch,
    'dom=' + (cmp.domLast || []).join('|') + '  exp=' + (cmp.expLast || []).join('|'));
  ok('exports the dashboard view, not raw case rows', !cmp.rawish, (cmp.expHead || []).join(','));
}

/* ---------- 5. lead AGE is derived, never taken on trust (LM book) ----------
   Salesforce's "Age (Hours)" is unreliable (3.93e12 on every row in the 18-Aug pull; 9e10 on
   386 rows of a mixed one). Age derives from Date/Time Opened; the column speaks only when
   there is no open date, and only when physically possible. Ingested via the LM filename
   route, which also proves the bulk-drop routing still works. */
const age = await page.evaluate(async () => {
  const HDR = 'Case Number,Case Owner,Status,Date/Time Opened,Age (Hours)';
  const now = Date.now();
  const serial = ms => (ms - Date.UTC(1899, 11, 30)) / 86400000;
  const dayAgo = serial(now - 24 * 36e5);
  const rows = [HDR,
    `C1,Enoch Pillay - Panimax,New,${dayAgo},3930000000000`,
    `C2,Enoch Pillay - Panimax,New,${dayAgo},90000000000`,
    'C3,Enoch Pillay - Panimax,New,,3930000000000',
    'C4,Enoch Pillay - Panimax,New,,12.5',
  ].join('\n');
  await window.__mtd.ingest('Lead Management Open Cases test.xls', rows);
  const oc = window.__mtd.state().opencasesLM;
  const by = {}; oc.rows.forEach(r => by[r.k] = r.age);
  const worst = Math.max(...oc.rows.map(r => r.age == null ? -1 : r.age));
  return { by, worst, n: oc.rows.length };
});
ok('a "Lead Management Open Cases" filename routes to the LM book (bulk-drop routing)', age.n === 4, 'n=' + age.n);
ok('a nonsense "Age (Hours)" is ignored — age comes from Date/Time Opened (~24h)',
  age.by.C1 != null && Math.abs(age.by.C1 - 24) < 2, JSON.stringify(age.by));
ok('the 9e10 shape from the real pull is ignored the same way',
  age.by.C2 != null && Math.abs(age.by.C2 - 24) < 2, JSON.stringify(age.by));
ok('no open date AND an impossible age reads as UNKNOWN, never as a number',
  age.by.C3 === null, JSON.stringify(age.by));
ok('no open date but a plausible age still uses the file column', age.by.C4 === 12.5, JSON.stringify(age.by));
ok('no age anywhere in the book is physically impossible', age.worst < 5 * 365 * 24, 'worst=' + age.worst);

/* ---------- 6. a plain synthetic Open Cases ingest is refused too ---------- */
const refuse = await page.evaluate(async () => {
  const HDR = 'Case Number,Case Owner,Status,Date/Time Opened,Age (Hours)';
  const S = window.__mtd.state();
  const lmBefore = S.opencasesLM ? S.opencasesLM.rows.length : 0;
  await window.__mtd.ingest('Lead Allocation Open Cases 20260827.xls',
    [HDR, 'X1,Enoch Pillay - Panimax,New,2026-08-18,1'].join(String.fromCharCode(10)));
  return { lmBefore, lmAfter: S.opencasesLM ? S.opencasesLM.rows.length : 0,
    alloc: S.opencases ? S.opencases.rows.length : null,
    types: S.files.map(f => f.type) };
});
ok('a "Lead Allocation Open Cases" file is refused: no book anywhere takes it',
  refuse.alloc === null && refuse.lmAfter === refuse.lmBefore, JSON.stringify(refuse));
ok('the registry never carries an "open cases" (Lead Allocation) entry',
  !refuse.types.some(t => t === 'open cases'), refuse.types.join(', '));

/* ---------- 7. page, nav and Upload Station carry no trace of Lead Allocation ---------- */
const gone = await page.evaluate(async () => {
  const S = window.__mtd.state();
  const noPage = typeof PAGES !== 'undefined' && !PAGES.leadalloc;
  go('leadalloc');                       // must not crash; renderPage falls back
  await new Promise(r => setTimeout(r, 900));
  const view = document.getElementById('view').innerText;
  const nav = [...document.querySelectorAll('.nav a,.nav button,aside a,aside button,aside .navitem')].map(e => e.textContent.trim());
  go('data');
  await new Promise(r => setTimeout(r, 1200));
  const t = document.getElementById('view').innerText;
  const D = String.fromCharCode(8212);
  return { noPage,
    fallbackClean: view.indexOf('Lead Allocation') < 0,
    navAlloc: nav.some(x => /Lead Allocation/i.test(x)), navLM: nav.some(x => /Lead Management/i.test(x)),
    allocSlot: document.querySelectorAll('.slot[data-slot="opencases"]').length,
    lmOpenSlot: document.querySelectorAll('.slot[data-slot="opencasesLM"]').length,
    lmClosedSlot: document.querySelectorAll('.slot[data-slot="closedcases"]').length,
    stationAlloc: t.indexOf('Lead Allocation ' + D + ' Open Cases') >= 0 };
});
ok('PAGES.leadalloc no longer exists', gone.noPage);
ok('navigating to the removed id falls back cleanly (no Lead Allocation screen)', gone.fallbackClean);
ok('the nav has no Lead Allocation entry', !gone.navAlloc);
ok('Lead Management is still in the nav', gone.navLM);
ok('the Upload Station has NO Lead Allocation — Open Cases slot', gone.allocSlot === 0 && !gone.stationAlloc,
  'slots=' + gone.allocSlot);
ok('Lead Management keeps its own Open + Closed Cases slots', gone.lmOpenSlot === 1 && gone.lmClosedSlot === 1,
  'open=' + gone.lmOpenSlot + ' closed=' + gone.lmClosedSlot);

ok('no page errors across the whole run', errors.length === 0, errors.slice(0, 3).join(' | '));

console.log(`\n  ${intake2.lm} unique cases in the LM book · ${leads.nAgents} roster agents on the funnel`);
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
failures.forEach(f => console.log('FAIL: ' + f));
await browser.close(); server.close();
process.exit(fail || errors.length ? 1 : 0);
