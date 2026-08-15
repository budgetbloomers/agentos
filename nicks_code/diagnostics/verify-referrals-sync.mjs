// Referrals must pull from the HighLevel API (via the Worker) with NO manual upload:
// ops auto-syncs on sign-in, rows land through applyLoad (batch audit + Agent-List
// mapping), and a re-sync supersedes per contact — never stacks. The endpoint is
// intercepted here with rows built from the real HighLevel pull.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const REPO = String.raw`c:\Users\aarav\OneDrive\Desktop\Chatterbox Agent OS\agentos`;
const UP = path.join(REPO, 'uploads', '2026-08-13');
const j = (...p) => path.join(...p);

// rows from the real pull (CSV written by tools/fetch-referrals.mjs)
const refCsv = fs.readdirSync(j(REPO, 'uploads')).filter(n => /^referrals-highlevel-.*\.csv$/.test(n)).sort().pop();
const lines = fs.readFileSync(j(REPO, 'uploads', refCsv), 'utf8').split(/\r?\n/).filter(l => l);
const parse = l => { const o = []; let c = '', q = false; for (let i = 0; i < l.length; i++) { const ch = l[i]; if (q) { if (ch === '"') { if (l[i + 1] === '"') { c += '"'; i++; } else q = false; } else c += ch; } else if (ch === '"') q = true; else if (ch === ',') { o.push(c); c = ''; } else c += ch; } o.push(c); return o; };
const hdr = parse(lines[0]);
const rows = lines.slice(1).map(l => { const c = parse(l); const g = n => c[hdr.indexOf(n)] || ''; return { id: g('Contact Id'), created: g('Created'), agent: g('Agent Name'), referrer: g('Referrer'), count: parseInt(g('Referral Count'), 10) || 1 }; });
console.log('endpoint fixture: ' + rows.length + ' rows from ' + refCsv);

let pass = 0, fail = 0; const failures = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  pass  ' + n); } else { fail++; failures.push(n + ' — ' + d); console.log('  FAIL  ' + n + ' — ' + d); } };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errors = []; page.on('pageerror', e => errors.push(e.message));
let apiHits = 0;
await page.route('**/api/referrals**', r => { apiHits++; r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rows, contacts: rows.length, pulled_at: new Date().toISOString() }) }); });
await page.goto('file:///' + j(REPO, 'Chatterbox_AgentOS_Analytics.html').replace(/\\/g, '/'), { waitUntil: 'domcontentloaded' });
await page.evaluate(() => { sessionStorage.setItem('cbx_token', 'harness'); document.dispatchEvent(new CustomEvent('cbx-authed', { detail: { user: 'harness' } })); });
await page.waitForFunction(() => window.state && typeof window.go === 'function', null, { timeout: 60000 });

// roster first so the Agent-List mapping has its base
await page.evaluate(() => go('uploads'));
await page.waitForSelector('input[type=file][multiple]', { state: 'attached' });
await page.setInputFiles('input[type=file][multiple]', [j(UP, 'Matrix - Agent List.xlsx')], { timeout: 60000 });
await page.waitForSelector('text=Bulk upload —', { timeout: 120000 });
await page.click('button:has-text("file(")');
await page.waitForTimeout(1500);
await page.evaluate(() => closeModal());

// the auto-sync fired at init (before the roster); sync again now the roster is in
await page.evaluate(() => syncReferralsFromAPI(true));
await page.waitForFunction(() => (window.state.facts.REFERRALS || []).length > 1000, null, { timeout: 30000 });
const s1 = await page.evaluate(() => {
  const rowsF = state.facts.REFERRALS || [];
  let mapped = 0, total = 0, agents = new Set();
  rowsF.forEach(r => { const c = refCbOf(r); const n = r.referral_count ?? 1; total += n; if (c) { mapped += n; agents.add(c); } });
  const batch = state.batches.find(b => b.source_type === 'REFERRALS');
  return { rows: rowsF.length, total, mapped, agents: agents.size, batchFile: batch?.original_file_name, apiNote: batch?.notes };
});
console.log(JSON.stringify(s1));
ok('rows landed from the API with no upload', s1.rows >= 1700, 'rows=' + s1.rows);
ok('batch audited as an API sync', s1.batchFile === 'HighLevel API' && /HighLevel API sync/.test(s1.apiNote || ''), s1.batchFile + ' / ' + s1.apiNote);
ok('Agent-List mapping live (55+ agents, 1,100+ referrals)', s1.agents >= 55 && s1.mapped >= 1100, JSON.stringify(s1));

// re-sync: same book again — supersede per contact, never stack
await page.evaluate(() => syncReferralsFromAPI(true));
await page.waitForTimeout(2500);
const s2 = await page.evaluate(() => ({ rows: (state.facts.REFERRALS || []).length, batches: state.batches.filter(b => b.source_type === 'REFERRALS').length }));
ok('re-sync supersedes per contact — row count unchanged', s2.rows === s1.rows, s1.rows + ' -> ' + s2.rows);

// the slot carries the manual sync button; Sales page shows the mapped table
await page.evaluate(() => go('uploads'));
await page.waitForTimeout(800);
const upTxt = await page.evaluate(() => document.body.innerText);
ok('Referrals slot has a "Sync from HighLevel" button', /Sync from HighLevel/.test(upTxt));
await page.evaluate(() => go('sales'));
await page.waitForTimeout(1500);
const salesTxt = await page.evaluate(() => document.body.innerText);
ok('Referrals by agent renders from the API data', /Referrals by agent/i.test(salesTxt));
ok('endpoint called (auto + manual)', apiHits >= 2, 'hits=' + apiHits);
ok('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
failures.forEach(f => console.log('FAIL: ' + f));
await browser.close();
process.exit(fail ? 1 : 0);
