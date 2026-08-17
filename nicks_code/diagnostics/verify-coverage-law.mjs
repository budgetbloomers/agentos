// Ops dashboard — THE COVERAGE LAW (specs/dialler-attribution-framework.md §5).
// A whole campaign at zero dials while its people are marked present is a FILTERED EXPORT, and
// nothing else in the app catches it: the file parses, every row it carries attributes correctly,
// and the trust bar goes green. Drives the real 13 Aug package, where the ViciDial pull was
// filtered to Courtesy/VT/Nesting user groups and the entire Cuddle floor is absent.
import { chromium } from 'playwright';
import path from 'node:path';
const REPO = String.raw`c:\Users\aarav\OneDrive\Desktop\Chatterbox Agent OS\agentos`;
const UP = path.join(REPO, 'uploads', '2026-08-13');
const j = (...p) => path.join(...p);
const FILES = ['Matrix - Agent List.xlsx', 'attendance_2026-08-06_to_2026-08-13.csv',
  'call_records.csv', 'EXPORT_CALL_REPORT_20260813-152302.txt', 'Active.xlsx'].map(f => j(UP, f));

let pass = 0, fail = 0; const failures = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  pass  ' + n); } else { fail++; failures.push(n + (d ? ' — ' + d : '')); console.log('  FAIL  ' + n + ' — ' + d); } };

const browser = await chromium.launch({ args: ['--js-flags=--max-old-space-size=8192'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.goto('file:///' + j(REPO, 'Chatterbox_AgentOS_Analytics.html').replace(/\\/g, '/'), { waitUntil: 'domcontentloaded' });
await page.evaluate(() => document.dispatchEvent(new CustomEvent('cbx-authed', { detail: { user: 'harness' } })));
await page.waitForFunction(() => window.state && typeof window.go === 'function', null, { timeout: 60000 });
await page.waitForTimeout(1200);
await page.evaluate(() => go('uploads'));
await page.waitForSelector('input[type=file][multiple]', { state: 'attached', timeout: 30000 });
await page.setInputFiles('input[type=file][multiple]', FILES, { timeout: 300000 });
await page.waitForSelector('text=Bulk upload —', { timeout: 900000 });
const n = await page.evaluate(() => (pendingBulk || []).filter(i => i.src).length);
await page.click('button:has-text("Load ' + n + ' file(")');
await page.waitForSelector('text=Bulk upload — done', { timeout: 900000 });
await page.evaluate(() => closeModal());
await page.waitForTimeout(1500);

// widen the window so the whole package is in scope
const cv = await page.evaluate(() => {
  state.range = { mode: 'custom', from: '2026-08-01', to: '2026-08-31' };
  go('uploads');
  const c = dialCoverage(periodWindow());
  return { c, census: viciGroupCensus(periodWindow()), txt: document.querySelector('#page').innerText };
});
console.log('\ncoverage: ' + JSON.stringify(cv.c.groups.map(g => g.g + ' r' + g.roster + '/p' + g.present + '/d' + g.dialled + ' ' + g.v)));
console.log('user_group census: ' + JSON.stringify(cv.census.map(x => x.g + ':' + x.n)));

const byG = {}; cv.c.groups.forEach(g => byG[g.g] = g);
ok('the coverage check runs and returns a row per campaign', cv.c.groups.length >= 3, JSON.stringify(Object.keys(byG)));
ok('Cuddle is on the roster with present agents', byG.Cuddle && byG.Cuddle.roster > 0 && byG.Cuddle.present > 0,
  JSON.stringify(byG.Cuddle));
ok('Cuddle has ZERO dialler agents in this package', byG.Cuddle && byG.Cuddle.dialled === 0, JSON.stringify(byG.Cuddle));
ok('…and that is reported as a FAIL, not a low number', byG.Cuddle && byG.Cuddle.v === 'fail', byG.Cuddle && byG.Cuddle.v);
ok('Courtesy passes — CallX covers it', byG.Courtesy && byG.Courtesy.v === 'ok', JSON.stringify(byG.Courtesy));
ok('the run reports at least one failing campaign', cv.c.failed.length >= 1, cv.c.failed.length + '');

ok('the Upload Station renders the coverage card', /Dialler coverage by campaign/.test(cv.txt));
ok('it names the fix rather than just the symptom', /ALL user groups/i.test(cv.txt));
ok('it says the numbers are absent, not low', /not low, they are absent/i.test(cv.txt));

/* the evidence trail: user_group must be stored and must show the pull was filtered */
ok('user_group is captured from the export', cv.census.length > 0, JSON.stringify(cv.census));
const groups = cv.census.map(x => x.g.toLowerCase()).join(' ');
ok('the census shows the groups the pull DID carry', /courtesy|ryan_digital/.test(groups), groups);
ok('no Cuddle user group is present (Renolan_/Sharoma_) — the proof it was filtered',
  !/renolan|sharoma/.test(groups), groups);
ok('the card prints the census as evidence beside the failure', /user_group/.test(cv.txt));

/* a campaign that legitimately has nobody present must NOT fail */
const none = cv.c.groups.filter(g => g.present === 0 && g.dialled === 0);
ok('campaigns with nobody present are not failed', none.every(g => g.v === 'none'), JSON.stringify(none));

ok('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
console.log('\n' + pass + ' passed · ' + fail + ' failed');
if (fail) { console.log('\nFAILURES:'); failures.forEach(f => console.log(' - ' + f)); process.exit(1); }
