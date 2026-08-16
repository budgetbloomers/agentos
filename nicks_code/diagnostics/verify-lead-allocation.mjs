// Ops dashboard — Lead Allocation page + the Open Cases upload that feeds it.
// Drives the real app at file:// with the real 2026-08-13 exports (cbx-authed dispatched
// manually — the auth gate isn't in the raw dev file), and proves the one thing that matters:
// Lead Allocation is a VIEW. Every agent's Total Allocated must equal that agent's Total Open
// on Lead Management, or the two pages have started telling the floor different stories.
// Also guards the header-detection hazard: an Open Cases file must still auto-detect after the
// slot was reworked — a tie in detectSource returns null and the daily bulk drop goes quiet.
import { chromium } from 'playwright';
import path from 'node:path';

const REPO = String.raw`c:\Users\aarav\OneDrive\Desktop\Chatterbox Agent OS\agentos`;
const UP = path.join(REPO, 'uploads', '2026-08-13');
const j = (...p) => path.join(...p);
const FILES = [
  j(UP, 'Matrix - Agent List.xlsx'),
  j(UP, 'SF Open Cases 5 - 13.xls'),
  j(UP, 'SF Closed 5 - 13.xls'),
];

let pass = 0, fail = 0; const failures = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  pass  ' + n); } else { fail++; failures.push(n + (d ? ' — ' + d : '')); console.log('  FAIL  ' + n + ' — ' + d); } };

const browser = await chromium.launch({ args: ['--js-flags=--max-old-space-size=8192'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
await page.goto('file:///' + j(REPO, 'Chatterbox_AgentOS_Analytics.html').replace(/\\/g, '/'), { waitUntil: 'domcontentloaded' });
await page.evaluate(() => document.dispatchEvent(new CustomEvent('cbx-authed', { detail: { user: 'harness' } })));
await page.waitForFunction(() => window.state && typeof window.go === 'function', null, { timeout: 60000 });
await page.waitForTimeout(1200);

/* ---- 1. nav placement + the empty state, before any data ---- */
console.log('\n— nav + empty state —');
const nav = await page.evaluate(() => PAGES.map(p => p.id));
ok('Lead Allocation is registered', nav.includes('leadalloc'));
ok('it sits ABOVE Lead Management', nav.indexOf('leadalloc') === nav.indexOf('leads') - 1,
  'leadalloc@' + nav.indexOf('leadalloc') + ' leads@' + nav.indexOf('leads'));
ok('it inherits the Sales Ops section', await page.evaluate(() => !PAGES.find(p => p.id === 'leadalloc').sect));

await page.evaluate(() => go('leadalloc'));
await page.waitForTimeout(400);
const empty = await page.evaluate(() => ({
  txt: document.querySelector('#page').innerText,
  files: document.querySelectorAll('#page input[type=file]').length,
  drop: !!document.querySelector('#slot_alloc_drop'),
}));
ok('empty state explains the CB-number join', /matched to an agent on the CB number/i.test(empty.txt));
ok('empty state carries its own uploader', empty.files === 1 && empty.drop, JSON.stringify({ f: empty.files, d: empty.drop }));
ok('empty state does not throw', !/hit an error/i.test(empty.txt));

/* ---- 2. load the roster + open cases through the real bulk path ---- */
console.log('\n— bulk intake (detection guard) —');
await page.evaluate(() => go('uploads'));
await page.waitForSelector('input[type=file][multiple]', { state: 'attached', timeout: 30000 });
await page.setInputFiles('input[type=file][multiple]', FILES, { timeout: 120000 });
await page.waitForSelector('text=Bulk upload —', { timeout: 600000 });
await page.waitForTimeout(400);
const detected = await page.evaluate(() => (pendingBulk || []).map(i => ({ f: i.file.name, src: i.src || null, rows: i.parsed ? i.parsed.data.length : 0 })));
console.log(JSON.stringify(detected, null, 1));
const openDet = detected.find(d => /Open Cases/i.test(d.f)) || {};
ok('Open Cases still auto-detects as SF_OPEN_CASES', openDet.src === 'SF_OPEN_CASES', JSON.stringify(openDet));
ok('detectSource did not go ambiguous (no null on the open-cases file)', openDet.src != null);
ok('Agent List detected', (detected.find(d => /Agent List/i.test(d.f)) || {}).src === 'AGENT_LIST');

const loadable = detected.filter(d => d.src).length;
await page.click('button:has-text("Load ' + loadable + ' file(")');
await page.waitForSelector('text=Bulk upload — done', { timeout: 600000 });
await page.waitForTimeout(600);
await page.evaluate(() => closeModal());
await page.waitForTimeout(800);

/* the Upload Station's join-health chips */
await page.evaluate(() => go('uploads'));
await page.waitForTimeout(500);
const slotTxt = await page.evaluate(() => document.querySelector('#slot_SF_OPEN_CASES')?.innerText || '');
ok('Open Cases slot reports agents holding leads', /agents? holding leads/i.test(slotTxt), slotTxt.replace(/\n/g, ' | ').slice(0, 200));
ok('Open Cases slot names Lead Allocation as its consumer', /Lead Allocation/i.test(slotTxt));

/* ---- 3. the pivot itself ---- */
console.log('\n— the pivot —');
const scrape = await page.evaluate(async () => {
  const grab = (route, totalHeader) => {
    go(route);
    const tbl = [...document.querySelectorAll('#page table.tbl')]
      .find(t => [...t.querySelectorAll('thead th')].some(h => h.textContent.trim().replace(/ [▲▼]$/, '') === totalHeader));
    if (!tbl) return null;
    const heads = [...tbl.querySelectorAll('thead th')].map(h => h.textContent.trim().replace(/ [▲▼]$/, ''));
    const ti = heads.indexOf(totalHeader);
    const rows = [...tbl.querySelectorAll('tbody tr')].map(tr => {
      const tds = [...tr.querySelectorAll('td')];
      const td = tds.map(c => c.textContent.trim());
      // Key on the CB code, never the displayed name: masking collapses distinct agents onto the
      // same label (Threza and Theo Chetty both read "T. Ch•••"), which would silently merge rows.
      const cb = (tds[3]?.querySelector('.alink')?.getAttribute('onclick') || '').match(/agentOpen\('([^']+)'\)/)?.[1] || null;
      return { cb, name: td[3], total: +String(td[ti]).replace(/[^\d.-]/g, '') || 0, cells: td };
    });
    return { heads, ti, rows };
  };
  const alloc = grab('leadalloc', 'Total Allocated');
  const leads = grab('leads', 'Total Open');
  return { alloc, leads, allocCsv: window.__allocCsv ? window.__allocCsv.csv.split('\n') : null,
           snapRows: (state.facts.SF_OPEN_CASES || []).length };
});

const A = scrape.alloc, L = scrape.leads;
ok('Lead Allocation renders its table', !!A && A.rows.length > 0, A ? A.rows.length + ' rows' : 'no table');
ok('Lead Management still renders its funnel', !!L && L.rows.length > 0);

if (A && L) {
  const statusCols = A.heads.slice(4, A.ti);
  console.log('  status columns: ' + JSON.stringify(statusCols));
  ok('status columns come from the canonical list', statusCols.includes('1st attempt') && statusCols.includes('Escalated'), JSON.stringify(statusCols));
  ok('Lead Allocation is uncapped (>= the funnel\'s 10-column cap when the data has that many)',
    statusCols.length >= Math.min(10, L.heads.slice(4, L.ti).length), statusCols.length + ' vs funnel ' + L.heads.slice(4, L.ti).length);

  const gt = A.rows[A.rows.length - 1];
  ok('ALL AGENTS row is last', /ALL AGENTS/.test(gt.cells[0]), gt.cells[0]);
  const colSum = statusCols.map((_, i) => A.rows.slice(0, -1).reduce((s, r) => s + (+String(r.cells[4 + i]).replace(/[^\d]/g, '') || 0), 0));
  const sumOfStatuses = colSum.reduce((a, b) => a + b, 0);
  ok('ALL AGENTS total == sum of every status column', gt.total === sumOfStatuses, gt.total + ' vs ' + sumOfStatuses);
  const sumOfAgents = A.rows.slice(0, -1).reduce((s, r) => s + r.total, 0);
  ok('ALL AGENTS total == sum of the agent rows', gt.total === sumOfAgents, gt.total + ' vs ' + sumOfAgents);

  // the reconciliation that matters
  const aBy = {}; A.rows.slice(0, -1).forEach(r => aBy[r.cb] = r.total);
  const lBy = {}; L.rows.slice(0, -1).forEach(r => lBy[r.cb] = r.total);
  ok('every agent row carries a CB code', A.rows.slice(0, -1).every(r => r.cb), 'missing on ' + A.rows.slice(0, -1).filter(r => !r.cb).length);
  ok('the two pages cover the same agents', Object.keys(aBy).length === Object.keys(lBy).length,
    'alloc=' + Object.keys(aBy).length + ' leads=' + Object.keys(lBy).length);
  const cbs = [...new Set([...Object.keys(aBy), ...Object.keys(lBy)])];
  const diffs = cbs.filter(n => (aBy[n] || 0) !== (lBy[n] || 0)).map(n => n + ': alloc=' + (aBy[n] ?? '–') + ' open=' + (lBy[n] ?? '–'));
  ok('every agent\'s Total Allocated == that agent\'s Total Open on Lead Management',
    diffs.length === 0, diffs.slice(0, 6).join(' · '));
  const gtL = L.rows[L.rows.length - 1];
  ok('grand totals agree across the two pages', gt.total === gtL.total, gt.total + ' vs ' + gtL.total);

  const idle = A.rows.slice(0, -1).filter(r => r.total === 0).length;
  ok('agents holding nothing stay in the table', idle >= 0 && A.rows.length - 1 >= Object.keys(lBy).length,
    idle + ' idle of ' + (A.rows.length - 1));

  ok('CSV exports the same row count as the screen',
    scrape.allocCsv && scrape.allocCsv.length === A.rows.length + 1,
    scrape.allocCsv ? scrape.allocCsv.length + ' lines vs ' + (A.rows.length + 1) : 'no csv');
  ok('CSV header carries every status column', scrape.allocCsv && statusCols.every(c => scrape.allocCsv[0].includes(c)));
}

/* ---- 4. nothing is invented, nothing silently dropped ---- */
console.log('\n— attribution honesty —');
const honesty = await page.evaluate(() => {
  go('leadalloc');
  const txt = document.querySelector('#page').innerText;
  const queues = new Set((state.rules.leadQueueOwners?.vals || []).map(v => String(v).toLowerCase().trim()));
  const holders = new Set(); let un = 0, pooled = 0;
  const cases = new Set();
  (state.facts.SF_OPEN_CASES || []).forEach(r => {
    const cb = cbOfOwner(r.case_owner);
    if (cb) holders.add(cb);
    else if (queues.has(String(r.case_owner || '').toLowerCase().trim())) pooled++;
    else un++;
    const k = String(r.case_number || '').trim(); if (k) cases.add(k);
  });
  return { txt, un, pooled, holders: holders.size, uniqCases: cases.size, rows: (state.facts.SF_OPEN_CASES || []).length };
});
const allocTotal = A ? A.rows[A.rows.length - 1].total : 0;
console.log('  snapshot: ' + honesty.rows + ' rows · ' + honesty.uniqCases + ' unique cases');
console.log('  allocated to ' + honesty.holders + ' agents: ' + allocTotal + ' · queued (unallocated): ' + honesty.pooled + ' · unmatched owner: ' + honesty.un);
ok('a queue owner is reported as UNALLOCATED, not as a mapping fault',
  honesty.pooled === 0 || /Unallocated — sitting in a queue/.test(honesty.txt), 'pooled=' + honesty.pooled);
ok('queue cases are NOT counted as an unmatched owner',
  honesty.pooled === 0 || !/on an unmatched owner/.test(honesty.txt) || honesty.un > 0);
if (honesty.un > 0) ok('genuinely unplaceable owners get their own card', /Owners the roster cannot place/.test(honesty.txt));
else ok('no unplaceable owners, so no defect card', !/Owners the roster cannot place/.test(honesty.txt));
ok('allocated + queued + unmatched == every case in the snapshot',
  allocTotal + honesty.pooled + honesty.un === honesty.uniqCases,
  allocTotal + ' + ' + honesty.pooled + ' + ' + honesty.un + ' = ' + (allocTotal + honesty.pooled + honesty.un) + ' vs ' + honesty.uniqCases);

/* ---- 4a. the join: the Agent List is the spine ---- */
// Every Case Owner resolves through the roster, or it resolves to nobody. The rules that matter:
// a placeholder is not an identity, a name two agents share is not a match, a bare surname is not
// a match, and a queue keeps its meaning even with the business unit stuck on the end.
console.log('\n— the join —');
const join = await page.evaluate(() => {
  const roster = state.facts.AGENT_LIST || [];
  const first = roster.find(a => a.cb_norm && a.agent_name && a.agent_name.trim().split(/\s+/).length >= 2);
  const nm = first.agent_name.trim().split(/\s+/);
  const variantName = nm[0] + ' Zzqx ' + nm.slice(1).join(' ');   // same person, extra middle name
  const surname = nm[nm.length - 1];
  const surnameOwners = new Set();
  for (const k in state.sfOwnerMap) if (k.split(' ').includes(surname.toLowerCase())) surnameOwners.add(state.sfOwnerMap[k]);
  return {
    placeholderKey: state.sfOwnerMap['-'] || null,
    placeholderResolves: cbOfOwner('-'),
    blankResolves: cbOfOwner('   '),
    ambigNames: Object.keys(state.ownerAmbig || {}),
    exact: ownerMatch(first.agent_name),
    withSuffix: ownerMatch(first.agent_name + ' - Panimax'),
    variant: ownerMatch(variantName), variantName, targetCb: first.cb_norm,
    surname, surnameShared: surnameOwners.size, surnameMatch: ownerMatch(surname),
    queuePlain: normName('Cuddle Call'), queueSuffixed: normName('Courtesy call- Panimax'),
    queueRule: (state.rules.leadQueueOwners?.vals || []).map(v => normName(v)),
  };
});
ok('a "-" placeholder is not an identity', join.placeholderKey === null && join.placeholderResolves === null,
  'key=' + join.placeholderKey + ' resolves=' + join.placeholderResolves);
ok('a blank owner resolves to nobody', join.blankResolves === null);
ok('an exact roster name matches', join.exact.cb === join.targetCb && join.exact.via === 'exact', JSON.stringify(join.exact));
ok('the business-unit suffix is ignored', join.withSuffix.cb === join.targetCb, JSON.stringify(join.withSuffix));
ok('an extra middle name still resolves, flagged as a variant',
  join.variant.cb === join.targetCb && join.variant.via === 'variant', join.variantName + ' -> ' + JSON.stringify(join.variant));
ok('a bare surname shared by several agents matches NOBODY',
  join.surnameShared < 2 || (join.surnameMatch.cb === null && join.surnameMatch.via === 'ambiguous'),
  join.surname + ' shared by ' + join.surnameShared + ' -> ' + JSON.stringify(join.surnameMatch));
ok('a queue name normalises the same way an agent name does',
  join.queueSuffixed === 'courtesy call' && join.queueRule.includes(join.queueSuffixed),
  join.queueSuffixed + ' · rule=' + JSON.stringify(join.queueRule));

// a name two roster rows both claim must resolve to nobody, and be named as the roster's problem
const ambig = await page.evaluate(() => {
  const roster = state.facts.AGENT_LIST || [];
  const a = roster.find(x => x.cb_norm), b2 = roster.find(x => x.cb_norm && x.cb_norm !== a.cb_norm);
  const keepA = a.sf_name, keepB = b2.sf_name;
  a.sf_name = 'Duplicated Testname'; b2.sf_name = 'Duplicated Testname';
  buildIdentity(); bumpDataVer();
  const res = { m: ownerMatch('Duplicated Testname'), listed: !!(state.ownerAmbig || {})['duplicated testname'] };
  a.sf_name = keepA; b2.sf_name = keepB; buildIdentity(); bumpDataVer();
  return res;
});
ok('a name two agents both claim resolves to NOBODY', ambig.m.cb === null && ambig.m.via === 'ambiguous', JSON.stringify(ambig.m));
ok('and the roster contradiction is recorded for display', ambig.listed);

/* ---- 4a-ii. re-match when the Agent List lands AFTER the cases ---- */
// The roster is the source of truth, so uploading it must re-resolve everything already loaded —
// not just whatever happens to be uploaded after it.
console.log('\n— re-match on Agent List upload —');
const rematch = await page.evaluate(() => {
  const keep = state.facts.AGENT_LIST, cbi = state.cbInfo, sf = state.sfOwnerMap, amb = state.ownerAmbig;
  const count = () => { let n = 0; const h = new Set();
    (state.facts.SF_OPEN_CASES || []).forEach(r => { const cb = cbOfOwner(r.case_owner); if (cb) { n++; h.add(cb); } });
    return { rows: n, agents: h.size }; };
  state.facts.AGENT_LIST = []; state.cbInfo = {}; state.sfOwnerMap = {}; state.ownerAmbig = {}; bumpDataVer();
  const without = count();
  state.facts.AGENT_LIST = keep; state.cbInfo = cbi; state.sfOwnerMap = sf; state.ownerAmbig = amb; bumpDataVer();
  const with_ = count();
  go('leadalloc');
  return { without, with_ };
});
ok('with no roster nothing is attributed', rematch.without.rows === 0, JSON.stringify(rematch.without));
ok('restoring the roster re-attributes every case, no re-upload of the cases needed',
  rematch.with_.rows > 0 && rematch.with_.agents > 0, JSON.stringify(rematch.with_));

/* ---- 4b. hostile upload data ---- */
// Status values and Case Owners are UPLOAD data that end up in table headers, title attributes,
// onclick handlers and the CSV. A Salesforce stage containing a quote must not be able to break
// out of the markup — the status sort key is an index for exactly this reason.
console.log('\n— hostile input —');
const hostile = await page.evaluate(() => {
  const rows = state.facts.SF_OPEN_CASES || [];
  const before = rows.length;
  rows.slice(0, 5).forEach((r, i) => { r.status = i % 2 ? 'Bad" onmouseover="window.__pwned=1' : "X'),window.__pwned=2,('"; });
  rows.slice(5, 8).forEach(r => { r.case_owner = '<img src=x onerror="window.__pwned=3">'; });
  bumpDataVer(); state.unmasked = true; go('leadalloc');
  const page$ = document.querySelector('#page');
  return {
    before,
    pwned: window.__pwned || null,
    injectedHandlers: page$.querySelectorAll('[onmouseover],[onerror],img').length,
    headerText: [...page$.querySelectorAll('thead th')].map(h => h.textContent).join(' | '),
    txt: page$.innerText.slice(0, 400),
    csvOk: !!window.__allocCsv,
  };
});
ok('no injected event handler or element survives into the DOM', hostile.injectedHandlers === 0, 'found ' + hostile.injectedHandlers);
ok('nothing executed from upload data', hostile.pwned === null, 'window.__pwned=' + hostile.pwned);
ok('the hostile status renders as visible TEXT in a header', /Bad" onmouseover=/.test(hostile.headerText), hostile.headerText.slice(0, 200));
ok('the page still renders with hostile data', !/hit an error/i.test(hostile.txt) && hostile.csvOk);

/* ---- 4c. the inline uploader must not become a way around the Upload Station lock ---- */
// SF_OPEN_CASES is snapshot:true — a re-upload replaces the WHOLE company's lead book. A scoped
// team leader is deliberately locked out of the Upload Station (TL_BLOCK), so a file picker on a
// page they CAN reach must be gated by the same rule, or the lock is decorative.
console.log('\n— upload permission —');
const perms = await page.evaluate(() => {
  const before = window.CBX_USER;
  const count = () => { render(); const p = document.querySelector('#page'); return {
    inputs: p.querySelectorAll('input[type=file]').length,
    drop: p.querySelectorAll('[ondrop]').length,
  }; };
  window.CBX_USER = { role: 'admin' }; state.unmasked = true; go('leadalloc');
  const admin = count();
  window.CBX_USER = { role: 'tl', team: null };  go('leadalloc');
  const tlWithData = count();
  const facts = state.facts.SF_OPEN_CASES; state.facts.SF_OPEN_CASES = []; bumpDataVer();
  go('leadalloc'); const tlEmpty = count(); const tlEmptyTxt = document.querySelector('#page').innerText;
  window.CBX_USER = { role: 'admin' }; go('leadalloc'); const adminEmpty = count();
  state.facts.SF_OPEN_CASES = facts; bumpDataVer(); window.CBX_USER = before; go('leadalloc');
  return { admin, tlWithData, tlEmpty, adminEmpty, tlEmptyTxt };
});
ok('an admin gets the inline uploader', perms.admin.inputs === 1, JSON.stringify(perms.admin));
ok('a scoped TL gets NO file input on the populated page', perms.tlWithData.inputs === 0, JSON.stringify(perms.tlWithData));
ok('a scoped TL gets NO uploader or drop zone on the empty state',
  perms.tlEmpty.inputs === 0 && perms.tlEmpty.drop === 0, JSON.stringify(perms.tlEmpty));
ok('the TL empty state says who to ask instead', /Ask Ryan or Nick/.test(perms.tlEmptyTxt));
ok('an admin still gets the uploader on the empty state', perms.adminEmpty.inputs === 1, JSON.stringify(perms.adminEmpty));

/* ---- 4d. no Agent List: the pool/defect cards must still render ---- */
console.log('\n— no roster —');
const noRoster = await page.evaluate(() => {
  const keep = state.facts.AGENT_LIST, cbi = state.cbInfo, sf = state.sfOwnerMap;
  state.facts.AGENT_LIST = []; state.cbInfo = {}; state.sfOwnerMap = {}; bumpDataVer();
  go('leadalloc'); const txt = document.querySelector('#page').innerText;
  const csv = window.__allocCsv;
  state.facts.AGENT_LIST = keep; state.cbInfo = cbi; state.sfOwnerMap = sf; bumpDataVer(); go('leadalloc');
  return { txt, csv };
});
ok('it names the missing Agent List rather than blaming the filters', /needs the Agent List/.test(noRoster.txt));
ok('the unattributed leads are STILL shown, not buried',
  /Owners the roster cannot place|Unallocated — sitting in a queue/.test(noRoster.txt), noRoster.txt.slice(0, 200).replace(/\n/g, ' | '));
ok('no stale CSV survives the early return', noRoster.csv === null);

/* ---- 5. masking + no runtime errors ---- */
console.log('\n— safety —');
const masked = await page.evaluate(() => { state.unmasked = false; render(); return document.querySelector('#page').innerText; });
ok('names are masked by default', /•••/.test(masked), masked.slice(0, 160).replace(/\n/g, ' | '));
await page.evaluate(() => { state.unmasked = true; render(); });
await page.waitForTimeout(300);

const errTxt = await page.evaluate(() => document.querySelector('#page').innerText);
ok('page never falls into the error card', !/hit an error/i.test(errTxt));
ok('no uncaught page errors', errors.length === 0, errors.join(' | '));

await browser.close();
console.log('\n' + pass + ' passed · ' + fail + ' failed');
if (fail) { console.log('\nFAILURES:'); failures.forEach(f => console.log(' - ' + f)); process.exit(1); }
