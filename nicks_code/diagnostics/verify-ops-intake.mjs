// Ops dashboard — full 2026-08-13 package through the real bulk-upload UI:
// 7 sources must load, the empty SF Closed shell and the two ViciDial files must be
// refused honestly, and the trust bar must render. Drives the real app at file://
// (cbx-authed dispatched manually — the auth gate isn't in the raw dev file).
import { chromium } from 'playwright';
import path from 'node:path';

const REPO = String.raw`c:\Users\aarav\OneDrive\Desktop\Chatterbox Agent OS\agentos`;
const UP = path.join(REPO, 'uploads', '2026-08-13');
const j = (...p) => path.join(...p);
const FILES = [
  j(UP, 'Matrix - Agent List.xlsx'),
  j(UP, 'attendance_2026-08-06_to_2026-08-13.csv'),
  j(UP, 'Active.xlsx'),
  j(UP, 'Inactive.xlsx'),
  j(UP, 'call_records.csv'),
  j(UP, 'Call Report 01 to 13 Aug.xlsx'),
  j(UP, 'EXPORT_CALL_REPORT_20260813-152302.txt'),
  j(UP, 'evaluations-full-export-2026-08-13.csv'),
  j(UP, 'SF Open Cases 5 - 13.xls'),
  j(UP, 'SF Closed 5 - 13.xls'),
];

let pass = 0, fail = 0; const failures = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  pass  ' + n); } else { fail++; failures.push(n + (d ? ' — ' + d : '')); console.log('  FAIL  ' + n + ' — ' + d); } };

const browser = await chromium.launch({ args: ['--js-flags=--max-old-space-size=8192'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
await page.goto('file:///' + j(REPO, 'Chatterbox_AgentOS_Analytics.html').replace(/\\/g, '/'), { waitUntil: 'domcontentloaded' });
await page.evaluate(() => document.dispatchEvent(new CustomEvent('cbx-authed', { detail: { user: 'harness' } })));
await page.waitForFunction(() => window.state && typeof window.go === 'function', null, { timeout: 60000 });
await page.waitForTimeout(1500);
await page.evaluate(() => go('uploads'));
await page.waitForSelector('input[type=file][multiple]', { state: 'attached', timeout: 30000 });

console.log('Bulk-dropping the full 2026-08-13 package (10 files)…');
await page.setInputFiles('input[type=file][multiple]', FILES, { timeout: 120000 });

// detection modal
await page.waitForSelector('text=Bulk upload —', { timeout: 600000 });
await page.waitForTimeout(500);
const modalTxt = await page.evaluate(() => document.querySelector('.modal, .modal-h')?.closest('div')?.parentElement?.innerText || document.body.innerText);
const detected = await page.evaluate(() => (pendingBulk || []).map(i => ({ f: i.file.name, src: i.src || null, rows: i.parsed ? i.parsed.data.length : 0, err: i.error || null })));
console.log(JSON.stringify(detected, null, 1));

const srcOf = n => detected.find(d => d.f === n) || {};
ok('Agent List detected', srcOf('Matrix - Agent List.xlsx').src === 'AGENT_LIST');
ok('attendance detected', srcOf('attendance_2026-08-06_to_2026-08-13.csv').src === 'ATTENDANCE');
ok('Active detected as BI money', srcOf('Active.xlsx').src === 'BI_ACTIVE_CASES');
ok('Inactive detected as cancellations', srcOf('Inactive.xlsx').src === 'SF_INACTIVE');
ok('call_records.csv detected as CallX', srcOf('call_records.csv').src === 'CALLX_CALL_RECORDS');
ok('QA export detected', srcOf('evaluations-full-export-2026-08-13.csv').src === 'QA_EVALUATIONS');
ok('Open Cases detected', srcOf('SF Open Cases 5 - 13.xls').src === 'SF_OPEN_CASES');
ok('Vici xlsx detected as VICI_CALL_REPORT', srcOf('Call Report 01 to 13 Aug.xlsx').src === 'VICI_CALL_REPORT', JSON.stringify(srcOf('Call Report 01 to 13 Aug.xlsx')));
ok('Vici txt detected as VICI_CALL_REPORT', srcOf('EXPORT_CALL_REPORT_20260813-152302.txt').src === 'VICI_CALL_REPORT', JSON.stringify(srcOf('EXPORT_CALL_REPORT_20260813-152302.txt')));
ok('SF Closed shell NOT loaded as data', srcOf('SF Closed 5 - 13.xls').src == null || srcOf('SF Closed 5 - 13.xls').rows === 0, JSON.stringify(srcOf('SF Closed 5 - 13.xls')));

const loadable = detected.filter(d => d.src).length;
ok('exactly 9 files load (8 ops sources; two Vici files, one source)', loadable === 9, 'loadable=' + loadable);

// load them
await page.click('button:has-text("Load ' + loadable + ' file(")');
await page.waitForSelector('text=Bulk upload — done', { timeout: 600000 });
await page.waitForTimeout(1000);
const results = await page.evaluate(() => document.body.innerText.match(/Bulk upload — done[\s\S]{0,1500}/)?.[0] || '');
console.log(results.slice(0, 1200));
await page.evaluate(() => closeModal());
await page.waitForTimeout(1000);

const snap = await page.evaluate(() => {
  const facts = {}; for (const k in state.facts) facts[k] = (state.facts[k] || []).length;
  return {
    facts,
    batches: state.batches.map(b => ({ src: b.source_type, rows: b.rows_loaded, rejects: b.rows_rejected, status: b.validation_status })),
    trust: (document.getElementById('trustbar') || {}).innerText || '',
    roster: (state.facts.AGENT_LIST || []).length,
  };
});
console.log(JSON.stringify(snap, null, 1));

const F = snap.facts;
ok('AGENT_LIST rows (95 agents)', F.AGENT_LIST === 95, 'got ' + F.AGENT_LIST);
ok('ATTENDANCE rows loaded', F.ATTENDANCE >= 630, 'got ' + F.ATTENDANCE);
ok('CALLX rows loaded (~39,851)', F.CALLX_CALL_RECORDS >= 39000, 'got ' + F.CALLX_CALL_RECORDS);
ok('QA rows loaded', F.QA_EVALUATIONS >= 600, 'got ' + F.QA_EVALUATIONS);
ok('BI Active rows loaded (~11,905)', F.BI_ACTIVE_CASES >= 11000, 'got ' + F.BI_ACTIVE_CASES);
ok('Inactive rows loaded', F.SF_INACTIVE >= 340, 'got ' + F.SF_INACTIVE);
ok('Open Cases rows loaded (~2,815)', F.SF_OPEN_CASES >= 2700, 'got ' + F.SF_OPEN_CASES);
// 13,466 xlsx rows + the txt's 7 record-keys the xlsx does not carry — the 2,310
// overlapping 13-Aug keys supersede, never stack (record identity: date|user|lead|status)
ok('Vici rows loaded, overlap superseded (~13,473)', F.VICI_CALL_REPORT >= 13400 && F.VICI_CALL_REPORT <= 13500, 'got ' + F.VICI_CALL_REPORT);
ok('SF Closed has NO rows (empty shell honestly absent)', !F.SF_CLOSED_CASES, 'got ' + F.SF_CLOSED_CASES);
const loadedSources = Object.keys(F).filter(k => F[k] > 0 && !k.startsWith('SES_'));
ok('exactly 8 sources hold data', loadedSources.length === 8, loadedSources.join(','));
// the Sales Production page must render the new ViciDial dial table without throwing
await page.evaluate(() => go('sales'));
await page.waitForTimeout(1500);
const salesTxt = await page.evaluate(() => document.body.innerText);
ok('Sales page renders the ViciDial dial report', /ViciDial dial report by agent/i.test(salesTxt), salesTxt.slice(0, 120));
ok('ViciDial ringing split stated', /no-contact statuses/i.test(salesTxt));
// a global campaign filter must NOT silently drop Vici rows (resolveCB knows the source)
const filtered = await page.evaluate(() => {
  state.filters.campaign = 'VT'; bumpDataVer();
  const n = rowsFor('VICI_CALL_REPORT', { from: '2026-08-01', to: '2026-08-13' }).length;
  state.filters.campaign = ''; bumpDataVer();
  return n;
});
ok('campaign filter keeps Vici rows (identity resolved via viciCbOf)', filtered > 5000, 'VT-filtered rows=' + filtered);

// ---- referrals: upload the HighLevel pull through its slot, mapping runs through the Agent List
const fs = await import('node:fs');
const refCsv = fs.readdirSync(UP + '\\..').filter(n => /^referrals-highlevel-.*\.csv$/.test(n)).sort().pop();
if (refCsv) {
  await page.evaluate(() => go('uploads'));
  await page.waitForSelector('input[onchange*="REFERRALS"]', { state: 'attached', timeout: 30000 });
  await page.setInputFiles('input[onchange*="REFERRALS"]', j(UP, '..', refCsv), { timeout: 60000 });
  await page.waitForSelector('#confirmLoad', { timeout: 60000 });
  await page.click('#confirmLoad');
  await page.waitForTimeout(2500);
  const ref = await page.evaluate(() => {
    const rows = state.facts.REFERRALS || [];
    let mapped = 0, unm = 0, total = 0, agents = new Set();
    rows.forEach(r => { const c = refCbOf(r); const n = r.referral_count ?? 1; total += n; if (c) { mapped += n; agents.add(c); } else if (String(r.agent || '').trim()) unm += n; });
    return { rows: rows.length, total, mapped, unm, agents: agents.size };
  });
  console.log('referrals:', JSON.stringify(ref));
  ok('referral rows loaded (~1,794)', ref.rows >= 1700, 'rows=' + ref.rows);
  ok('referral counts sum to blocks (~1,800)', ref.total >= 1750, 'total=' + ref.total);
  ok('Agent-List mapping attributes 55+ current-roster agents / 1,100+ referrals', ref.agents >= 55 && ref.mapped >= 1100, JSON.stringify(ref));
  ok('ambiguous names stay unmatched, never merged', ref.unm > 0 && ref.unm < 250, 'unmatched-with-name=' + ref.unm);
  await page.evaluate(() => go('sales'));
  await page.waitForTimeout(1500);
  const s2 = await page.evaluate(() => document.body.innerText);
  ok('Sales page renders Referrals by agent', /Referrals by agent/i.test(s2));
  ok('no-agent form gap surfaced', /NO agent name at all/i.test(s2));
} else console.log('no referrals-highlevel CSV found — skipping referral checks');
ok('trust bar rendered with per-source freshness', /Data trust/i.test(snap.trust), snap.trust.slice(0, 120));
ok('trust bar honest: attention flagged (closed + referrals missing)', /need attention|Stale/i.test(snap.trust), snap.trust.slice(0, 160));
ok('no page errors', errors.length === 0, errors.slice(0, 4).join(' | '));

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
failures.forEach(f => console.log('FAIL: ' + f));
await browser.close();
process.exit(fail ? 1 : 0);
