/* LEAD ALLOCATION / LEAD MANAGEMENT — MIGRATION GUARD (Ops side).
 *
 * Both pages moved to VAS Analytics on 2026-08-18. This file used to drive them inside the
 * Ops dashboard; that job now belongs to verify-leads-vas.mjs. What is left to protect is the
 * migration itself, and it cuts both ways:
 *
 *   1. The pages and their dedicated Open Cases upload slot are GONE from Ops — no nav entry,
 *      no router branch, no orphaned helper, no dead export button.
 *   2. The SF_OPEN_CASES SOURCE stays. It is not lead-allocation's private file: the Total
 *      Open Cases and Avg Case Age KPIs read it, and so do Sales Production, the scorecard
 *      and the AI digest. Removing the source with the pages would have taken those with it.
 *
 * Run: node verify-lead-allocation.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const REPO = process.env.AGENTOS || decodeURIComponent(new URL('../..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1').replace(/\/$/, '');   // repo-relative (2026-09-08): the laptop path failed every cloud run
const OPS = path.join(REPO, 'Chatterbox_AgentOS_Analytics.html');
const src = fs.readFileSync(OPS, 'utf8');
let pass = 0, fail = 0; const failures = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; failures.push(n + (d ? ' — ' + d : '')); console.log('  FAIL ' + n + ' — ' + d); } };

/* ---------- 1. the PAGES are gone; the intake slot deliberately is not ----------
   Updated 2026-08-27. The 23-Aug external build (backported here) reintroduced some
   legacy NAMES as live plumbing: leadAllocSlot()/allocHealthChips()/allocEmpty() now
   render the SF_OPEN_CASES upload slot + trust chips in the Ops Upload Station, and
   canonLeadStatus/LEAD_STATUS_CANON canonicalise the status field for the KPIs. Those
   were wanted while they were the only intake. SUPERSEDED 2026-08-28 (Nick: "remove lead
   allocations from the upload station"): leadAllocSlot() was a hand-written SECOND slot onto
   SF_OPEN_CASES, sitting beside the Salesforce Open Cases card that SRC_KEYS already renders
   from the source contract — the same file and the same 78 235 rows, offered twice, under a
   button that opened a deleted page. It is gone; intake is NOT, because SF_OPEN_CASES is a
   registered non-session source and so gets its own slot like every other one. What must stay
   gone is the PAGES: ids, nav entries, routes, export buttons — and any live REFERENCE to
   them, which is how a dead go('leadalloc') survived on the trust chips for five days.
   pageLeadAlloc/pageLeads/exportAlloc/exportLeads may appear in comments only. */
for (const sym of ['pageLeadAlloc', 'pageLeads', 'exportAlloc', 'exportLeads', '__allocCsv', '__leadsCsv'])
  ok(`Ops defines no function ${sym}`, !new RegExp('function\\s+' + sym + '\\b').test(src));
/* The page id is checked against COMMENT-STRIPPED source. The rule this suite enforces is
   that no LIVE code reaches the deleted page; the comments recording why it went are the
   opposite of a regression, and a check that forbids them would be paid off by deleting the
   explanation. Stripping is deliberately blunt (this is one HTML file, not a parser) — it
   only has to remove the block and line notes that name the id in prose. */
const live = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
ok("no 'leadalloc' page id in live Ops code", !/['"]leadalloc['"]/.test(live),
  (live.match(/.{0,60}leadalloc.{0,60}/) || [''])[0]);
ok('no Lead Allocation / Lead Management nav entries', !/label:'Lead (Allocation|Management)'/.test(src));
ok('the duplicate Lead Allocation slot is gone from the Upload Station',
  !src.includes('slot_LEADALLOC') && !/function\s+leadAllocSlot\b/.test(src));
ok('SF_OPEN_CASES still has an intake — its own slot, from the source contract',
  /const SRC_KEYS = Object\.keys\(SOURCES\)\.filter\(k=>!SOURCES\[k\]\.session\)/.test(src)
  && /SF_OPEN_CASES:\{label:/.test(src) && !/SF_OPEN_CASES:\{[^}]*session:true/.test(src));

/* ---------- 2. the source survives, because other things need it ---------- */
ok('SF_OPEN_CASES is still a registered source', /SF_OPEN_CASES:\{label:/.test(src));
ok('the Total Open Cases KPI still reads it', /id:'open_backlog'[^}]*SF_OPEN_CASES/.test(src));
ok('the Avg Case Age KPI still reads it', /id:'avg_case_age'[^}]*SF_OPEN_CASES/.test(src));
ok('it is still in the bulk-upload order', /BULK_ORDER=\[[^\]]*SF_OPEN_CASES/.test(src));
ok('its owner still resolves through cbOfOwner', /case 'SF_OPEN_CASES':case 'SF_CLOSED_CASES':return cbOfOwner/.test(src));

/* ---------- 3. Ops still boots, with the source intact ---------- */
const browser = await chromium.launch({ args: ['--js-flags=--max-old-space-size=8192'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.goto('file:///' + OPS.replace(/\\/g, '/'), { waitUntil: 'domcontentloaded' });
await page.evaluate(() => document.dispatchEvent(new CustomEvent('cbx-authed')));
await page.waitForTimeout(2500);
const app = await page.evaluate(() => ({
  pages: (typeof PAGES !== 'undefined' ? PAGES : []).map(p => p.id),
  hasSource: typeof SOURCES !== 'undefined' && !!SOURCES.SF_OPEN_CASES,
  kpis: (typeof DEFAULT_KPIS !== 'undefined' ? DEFAULT_KPIS : []).filter(k => k.src === 'SF_OPEN_CASES').map(k => k.id),
}));
ok('Ops boots with no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
ok('neither page id is registered', !app.pages.includes('leadalloc') && !app.pages.includes('leads'), app.pages.join(','));
ok('the Open Cases source object is still there at runtime', app.hasSource === true);
ok('both Open Cases KPIs are still wired at runtime', app.kpis.includes('open_backlog') && app.kpis.includes('avg_case_age'), app.kpis.join(','));

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
failures.forEach(f => console.log('FAIL: ' + f));
await browser.close();
process.exit(fail || errors.length ? 1 : 0);
