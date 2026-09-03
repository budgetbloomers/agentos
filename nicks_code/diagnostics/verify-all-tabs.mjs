/* EVERY TAB, EVERY DAY — the whole-app health check.
 *
 * New data lands every morning and changes every number, so the risk is not "does this page
 * work once" but "does it still hold when the data moves". This drives the DEPLOYED build
 * over the REAL live state and checks, for every page in the nav:
 *   · it renders, with no page error and no error card
 *   · it is not accidentally empty (an empty page with data loaded is a defect)
 * and then the cross-page invariants that daily uploads are most likely to break:
 *   · the AGENT LIST is the single identity source — every fact resolves through it, and
 *     campaign (Cuddle / Courtesy / Nesting / VT) comes from the roster, never from a file
 *   · sales and GWP agree between the model, the campaign rollups and the headline
 *   · GWP = the ex-VAT charge (the comms basis), grossed once, at every level
 *   · Lead Allocation's Total Allocated == Lead Management's Total Open, per agent
 *   · nobody is counted twice across campaigns, and no agent-day is orphaned
 *
 * Run: node verify-all-tabs.mjs [path-to-state.json]
 *   with no argument it pulls the live state from Supabase (needs supabase.env).
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

const REPO = String.raw`c:\Users\aarav\OneDrive\Desktop\Chatterbox Agent OS\agentos`;
const HTML = path.join(REPO, ...(process.env.PULSE_HTML || 'site/pulse/index.html').split('/'));
let pass = 0, fail = 0; const failures = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; failures.push(n + (d ? ' — ' + d : '')); console.log('  FAIL ' + n + ' — ' + d); } };

/* ---------- state: a file if given, else pull it live ---------- */
let blob = process.argv[2] ? fs.readFileSync(process.argv[2], 'utf8') : null;
if (!blob) {
  const envTxt = fs.readFileSync(path.join(REPO, 'supabase.env'), 'utf8');
  const env = Object.fromEntries(envTxt.split(/\r?\n/).filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
  const H = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY };
  const r = await fetch(env.SUPABASE_URL + '/storage/v1/object/raw/kv/vas-state', { headers: H, signal: AbortSignal.timeout(90000) });
  if (!r.ok) { console.log('(skipping — cannot read live state: ' + r.status + ')'); process.exit(0); }
  blob = await r.text();
  console.log('pulled live state: ' + (blob.length / 1048576).toFixed(2) + ' MB');
}

const SERVE = { '/': HTML, '/index.html': HTML, '/xlsx.full.min.js': path.join(REPO, 'site', 'xlsx.full.min.js') };
const server = http.createServer((q, s) => { const p = SERVE[q.url.split('?')[0]];
  if (!p || !fs.existsSync(p)) { s.writeHead(404); s.end('nf'); return; }
  s.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' });
  fs.createReadStream(p).pipe(s); });
await new Promise(r => server.listen(8175, '127.0.0.1', r));
const browser = await chromium.launch({ args: ['--js-flags=--max-old-space-size=8192'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = []; page.on('pageerror', e => errors.push(e.message));
page.on('dialog', d => d.accept());
await page.goto('http://127.0.0.1:8175/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__mtd && window.__mtd.state(), null, { timeout: 30000 });
await page.evaluate(b => { const S = window.__mtd.state(); const blob = JSON.parse(b);
  for (const k of Object.keys(blob)) S[k] = blob[k]; window.__mtd.rebuild(); }, blob);
/* PIN THE PERIOD TO THE LATEST MONTH THAT HOLDS DATA. On the 1st of a month the current
   month is empty: the workbook export builds no sheets, the guard-agreement check reads
   null, and this suite failed on the calendar, not the app (first seen 2026-09-01). */
await page.evaluate(() => { const S = window.__mtd.state();
  const days = [...Object.keys(S.sales || {}), ...Object.keys(S.calls || {})].sort();
  if (days.length) window.__mtd.setPeriod(days[days.length - 1].slice(0, 7), 'month'); });

/* ---------- 1. the Agent List is the identity source ---------- */
const ident = await page.evaluate(() => {
  const S = window.__mtd.state(), M = window.__mtd.model();
  const roster = {}; S.roster.forEach(a => roster[a.code] = a.campaign);
  const bad = [], noRoster = [];
  const camps = {};
  for (const f of (M.facts || [])) {
    camps[f.campaign] = (camps[f.campaign] || 0) + 1;
    if (!(f.code in roster)) { if (noRoster.length < 5) noRoster.push(f.code); continue; }
    // campaign on a fact must be the roster's campaign for that agent (via orgAt history)
    const hist = window.__mtd.orgAt(f.code, f.date);
    const want = (hist && hist.campaign) || roster[f.code];
    const norm = c => /nest/i.test(c) ? 'Nesting' : /cuddle/i.test(c) ? 'Cuddle' : /track|vehicle|vision|^vt$/i.test(c) ? 'VT' : 'Courtesy';
    if (norm(want) !== f.campaign && bad.length < 5) bad.push(`${f.code} ${f.date}: fact=${f.campaign} roster=${norm(want)}`);
  }
  return { bad, noRoster, camps, rosterN: S.roster.length, factN: (M.facts || []).length, extra: M.newCampaigns || [] };
});
ok('every fact resolves to an agent on the Agent List', ident.noRoster.length === 0, ident.noRoster.join(', '));
ok('every fact carries the campaign the Agent List gives that agent (via effective-dated history)',
  ident.bad.length === 0, ident.bad.join(' | '));
/* since 2026-09-03 a campaign the list names and the rule book does not is reported under
   its own label (M.newCampaigns) — anything else in the fact table is still a leak */
ok('campaigns present are the four the rule book defines plus any the list has created',
  Object.keys(ident.camps).every(c => ['Cuddle', 'Courtesy', 'Nesting', 'VT'].concat(ident.extra).includes(c)),
  JSON.stringify(ident.camps) + ' new: ' + JSON.stringify(ident.extra));

/* ---------- 1b. the Agent List owns the current month (Nick, 2026-08-27) ----------
   "everytime the agent list is uploaded data must change": recordOrgList gives the latest
   list the WHOLE current month, so every reported agent must read the roster's campaign
   and team leader — and the in-app guard (window.__listCheck / listAppliedBanner) must
   agree that it holds. Only asserted when the modelled period IS the current month;
   past months are supposed to differ from today's list. */
const listFx = await page.evaluate(() => {
  const S = window.__mtd.state(), M = window.__mtd.model();
  if (!M || !M.range || String(M.range.from).slice(0, 7) !== new Date().toISOString().slice(0, 7)) return { skip: true };
  const by = {}; (M.agents || []).forEach(a => by[a.code] = a);
  const prov = t => { const s = String(t || '').trim(); return !s || /^(-+|n\/?a|none|null|nil|tbc|tbd|\.|#n\/a)$/i.test(s); };
  const bad = [];
  for (const a of S.roster) {
    if (a.campaign === 'VT') continue;
    const m = by[a.code]; if (!m) continue;
    const tlOk = (m.tl || '') === (a.tl || '') || (prov(m.tl) && prov(a.tl));
    if (m.campaign !== a.campaign || !tlOk) bad.push(`${a.code}: model=${m.campaign}/${m.tl} list=${a.campaign}/${a.tl}`);
  }
  return { skip: false, n: bad.length, bad: bad.slice(0, 5),
    guard: window.__listCheck ? window.__listCheck.bad.length : null };
});
if (listFx.skip) console.log('  --   list-owns-the-month skipped (modelled period is not the current month)');
else {
  ok('every reported agent reads the CURRENT list\'s campaign + team leader for this month',
    listFx.n === 0, listFx.bad.join(' | '));
  ok('the in-app guard agrees (listAppliedBanner is empty)', listFx.guard === 0,
    'guard mismatches=' + listFx.guard);
}

/* ---------- 2. money: one basis, one answer, at every level ---------- */
const money = await page.evaluate(() => {
  const M = window.__mtd.model(), R = window.__mtd.rules();
  const perAgent = {};
  for (const camp in (M.mtdCC || {})) for (const code in M.mtdCC[camp]) {
    const a = M.mtdCC[camp][code];
    (perAgent[code] = perAgent[code] || { ex: 0, gwp: 0, sales: 0, camps: [] });
    perAgent[code].ex += a.gwpEx || 0; perAgent[code].gwp += a.gwp || 0;
    perAgent[code].sales += a.sales || 0; perAgent[code].camps.push(camp);
  }
  /* GROSS-ONCE holds PER CAMPAIGN AGGREGATE — an agent who moved campaigns mid-period
     (orgAt history) legitimately has two aggregates, each rounding its own charge, and
     round(a)+round(b) may differ from round(a+b) by design. The per-day invariant below
     covers the rest: one campaign per agent per DAY, never two. */
  const badGross = [], dupDay = [];
  for (const camp in (M.mtdCC || {})) for (const code in M.mtdCC[camp]) {
    const a = M.mtdCC[camp][code];
    if ((a.gwp || 0) !== Math.round(R.gwpDisplayBasis === 'ex' ? (a.gwpEx || 0) : (a.gwpEx || 0) * 1.15))
      badGross.push(camp + '/' + code + ':' + a.gwp);
  }
  { const seen = {};
    for (const f of (M.facts || [])) { const k = f.code + '|' + f.date;
      if (seen[k] && seen[k] !== f.campaign) dupDay.push(k + ': ' + seen[k] + '+' + f.campaign);
      seen[k] = f.campaign; } }
  let agentEx = 0, agentSales = 0;
  for (const c in perAgent) { agentEx += perAgent[c].ex; agentSales += perAgent[c].sales; }
  return { badGross, dupDay, agentEx: +agentEx.toFixed(2), agentSales,
    grandEx: +((M.grand || {}).gwpEx || 0).toFixed(2), grandSales: (M.grand || {}).sales,
    grandGwp: (M.grand || {}).gwp, basis: R.gwpDisplayBasis, agents: Object.keys(perAgent).length };
});
ok('GWP is the ex-VAT charge (agent comms basis) for every agent', money.badGross.length === 0, money.badGross.join(', '));
ok('no agent is in two campaigns on the SAME DAY (mid-period moves split by history are fine)', money.dupDay.length === 0, money.dupDay.join(' | '));
ok('agent-level sales sum to the headline', money.agentSales === money.grandSales, `${money.agentSales} vs ${money.grandSales}`);
ok('agent-level charge sums to the headline, to the cent', Math.abs(money.agentEx - money.grandEx) < 0.005,
  `${money.agentEx} vs ${money.grandEx}`);
ok('the headline GWP is that same charge on the display basis', money.grandGwp === Math.round(money.basis === 'ex' ? money.grandEx : money.grandEx * 1.15),
  `R${money.grandGwp} vs ${money.grandEx.toFixed(2)} (${money.basis})`);

/* ---------- 3. every tab renders ---------- */
const NAV = await page.evaluate(() => (typeof NAV !== 'undefined' ? NAV : []).flatMap(g => g.items.map(i => i[0])));
for (const tab of NAV) {
  const before = errors.length;
  const r = await page.evaluate(async t => {
    const S = window.__mtd.state(); S.ui.tab = t; renderPage();
    return new Promise(res => setTimeout(() => {
      const el = document.getElementById('view');
      const txt = (el && el.innerText) || '';
      res({ len: txt.length, err: /Something went wrong|is not defined|undefined is not|Cannot read/i.test(txt), head: txt.slice(0, 60).replace(/\n/g, ' ') });
    }, 1100));
  }, tab);
  ok(`tab "${tab}" renders`, r.len > 40 && !r.err && errors.length === before, `${r.len} chars | ${r.head}`);
}

/* ---------- 4. Lead Management renders from its own book; Lead Allocation is GONE ---------- */
/* Lead Allocation was removed 2026-08-27 (page, slot and book). The check here is the
   removal itself: the page id must not render, its book must be cleared by rebuild, and
   Lead Management must still build from its own stores. */
const leads = await page.evaluate(async () => {
  const S = window.__mtd.state();
  const allocGone = (typeof PAGES !== 'undefined') && !PAGES.leadalloc && !S.opencases;
  if (!S.opencasesLM || !S.opencasesLM.rows.length) return { allocGone, skip: true };
  S.ui.tab = 'leads'; renderPage();
  await new Promise(r => setTimeout(r, 1200));
  const tbl = document.querySelectorAll('#view table.data')[0];
  const head = tbl ? [...tbl.querySelectorAll('thead th')].map(h => h.textContent.trim()) : [];
  return { allocGone, skip: false, hasOpen: head.includes('Total open'), rows: tbl ? tbl.querySelectorAll('tbody tr').length : 0 };
});
ok('Lead Allocation removed: no page function, no S.opencases book', leads.allocGone);
if (leads.skip) console.log('  --   Lead Management render skipped (no LM Open Cases snapshot loaded)');
else ok(`Lead Management renders its funnel from its own book (${leads.rows} row(s))`, leads.hasOpen && leads.rows > 0);

/* ---------- 5. the daily grain still adds up to the period ---------- */
const grain = await page.evaluate(() => {
  const M = window.__mtd.model();
  let fSales = 0, fEx = 0;
  for (const f of (M.facts || [])) { if (f.rangeAgg) continue; if (f.campaign === 'VT') continue;
    fSales += f.sales || 0; fEx += f.gwpEx || 0; }
  return { fSales, fEx: +fEx.toFixed(2), gSales: (M.grand || {}).sales, gEx: +((M.grand || {}).gwpEx || 0).toFixed(2) };
});
ok('daily fact rows sum to the period headline (sales)', grain.fSales === grain.gSales, `${grain.fSales} vs ${grain.gSales}`);
ok('daily fact rows sum to the period headline (charge)', Math.abs(grain.fEx - grain.gEx) < 0.005, `${grain.fEx} vs ${grain.gEx}`);

/* ---------- the agent card shows CANCELLATIONS, not opt-ins ------------------------------
   Opt-ins are no longer sold (Nick, 2026-08-18), so the tile carries cancellations instead.
   Two things must hold: the count matches the model, and the delta is INVERTED — a RISE in
   cancellations has to read red, never as a win for churn. */
const card = await page.evaluate(async () => {
  const M = window.__mtd.model();
  const code = (M.agents || []).map(a => a.code)[0];
  if (!code) return { skip: true };
  openDrawer(code);
  await new Promise(r => setTimeout(r, 1300));
  const tiles = [...document.querySelectorAll('.minikpi')].map(e => ({
    lab: (e.querySelector('.lab') || {}).textContent,
    val: (e.querySelector('.val') || {}).textContent,
    tip: e.getAttribute('title') || '',
    cls: (e.querySelector('.delta') || {}).className || ''
  }));
  let canc = 0, sales = 0;
  for (const c in (M.mtdCC || {})) { const x = M.mtdCC[c][code]; if (x) { canc += x.canc || 0; sales += x.sales || 0; } }
  const t = tiles.find(x => /cancellation/i.test(x.lab || ''));
  if (typeof closeDrawer === 'function') closeDrawer();
  return { skip: false, code, canc, sales, tile: t, hasOptIn: tiles.some(x => /opt.?in/i.test(x.lab || '')) };
});
if (card.skip) console.log('  --   agent card skipped (no agents)');
else {
  ok('the agent card carries a Cancellations tile', !!card.tile, JSON.stringify(card.tile));
  ok('it no longer carries Opt-In', !card.hasOptIn);
  ok('the count on the card equals the model',
    card.tile && parseInt(String(card.tile.val).replace(/[^0-9]/g, ''), 10) === card.canc,
    (card.tile || {}).val + ' vs ' + card.canc);
  /* A 'flat' chip has no direction to invert (no comparable previous period). The rule is:
     whenever the chip points up or down it MUST carry the inv class — that is what makes a
     rise in cancellations render red instead of congratulating the agent for churn. */
  const dcls = (card.tile && card.tile.cls) || '';
  ok('the delta is INVERTED, so more cancellations reads as worse',
    !/(up|down)/.test(dcls) || /inv/.test(dcls), dcls || '(no delta chip)');
  ok('the tile explains the rate it represents',
    !!(card.tile && (/of .* sales cancelled/.test(card.tile.tip) || /No sales/.test(card.tile.tip))), (card.tile || {}).tip);
}

/* ---------- the workbook carries the TABS, not the raw rows ------------------------------
   "Export report" used to write its own bespoke column list, so the file did not match any
   screen — the same complaint the lead pages drew. Every page that renders a table publishes
   its column definition to window.__exp; the export now calls the pages and writes those, so
   a sheet is the tab. Checked by comparing a sheet's headers with the rendered table's. */
const wbook = await page.evaluate(async () => {
  if (typeof XLSX === 'undefined' || !XLSX.utils) return { skip: true };
  const S = window.__mtd.state();
  /* start from a clean view: an earlier check may have left a campaign or day filter on,
     and a filtered Daily tab renders a different (or empty) table than the export writes. */
  S.ui.camp = ''; S.ui.team = ''; S.ui.dailyFilter = {}; S.ui.tab = 'daily'; renderPage();
  // renderPage paints a skeleton first and swaps the real table in on a double rAF, so wait
  // for the table itself rather than guessing at a delay
  let t = null;
  for (let i = 0; i < 120 && !t; i++) { await new Promise(r => setTimeout(r, 150)); const c = document.querySelector('#view table.data'); if (c && [...c.querySelectorAll('thead th')].some(h => h.textContent.indexOf('Worked') >= 0)) t = c; }
  const screen = t ? [...t.querySelectorAll('thead th')].map(x => x.textContent.trim()) : [];
  // build the workbook in memory instead of downloading it
  const real = XLSX.writeFile; const captured = {};
  XLSX.writeFile = (wb) => { captured.wb = wb; };
  try { exportReport(); } finally { XLSX.writeFile = real; }
  if (!captured.wb) return { skip: true };
  const names = captured.wb.SheetNames;
  const hdr = n => { const a = XLSX.utils.sheet_to_json(captured.wb.Sheets[n], { header: 1 }); return (a[0] || []).map(String); };
  return { skip: false, names, dailyHdr: names.includes('Daily Reports') ? hdr('Daily Reports') : null, screen };
});
if (wbook.skip) console.log('  --   workbook export skipped (XLSX not available)');
else {
  ok('the workbook has one sheet per dashboard tab',
    ['Daily Reports', 'Agent Performance', 'Workforce'].every(n => wbook.names.includes(n)),
    wbook.names.join(', '));
  ok('the Daily Reports sheet has EXACTLY the columns the Daily tab shows',
    JSON.stringify(wbook.dailyHdr) === JSON.stringify(wbook.screen),
    'sheet=' + (wbook.dailyHdr || []).join(',') + ' | screen=' + wbook.screen.join(','));
  ok('the MTD and TL views are still in the workbook',
    wbook.names.some(n => n.startsWith('MTD - ')) && wbook.names.includes('TL MTD'), wbook.names.join(', '));
}

/* ---------- the KPI / Coaching Hub launcher ----------------------------------------------
   Two external apps, opened in a new tab. The checks that matter are that the URLs are the
   right ones (a typo here sends the floor to a dead link) and that every outward link carries
   rel=noopener — without it the opened page can reach back through window.opener and drive
   the tab it came from. */
const hubs = await page.evaluate(async () => {
  const S = window.__mtd.state(); S.ui.tab = 'hubs'; renderPage();
  await new Promise(r => setTimeout(r, 1100));
  const a = [...document.querySelectorAll('#view a[href^="http"]')];
  return { urls: a.map(x => x.getAttribute('href')),
    targets: a.map(x => x.getAttribute('target')),
    rels: a.map(x => (x.getAttribute('rel') || '')),
    text: (document.getElementById('view').innerText || '').slice(0, 400) };
});
/* Agent Analytics joined the Apps tab 2026-08-27 — it left the app switcher, and this card
   is where its share-with-agents link lives now, so its absence here would orphan the app. */
ok('the Apps page links all three apps, with the exact URLs',
  hubs.urls.includes('https://kpi-hub-rho.vercel.app/') && hubs.urls.includes('https://coaching-hub-psi.vercel.app/')
  && hubs.urls.includes('https://chatterbox-agentos.pages.dev/agent/'),
  hubs.urls.join(' | '));
ok('every outward link opens in a new tab', hubs.targets.every(t => t === '_blank'), hubs.targets.join(','));
/* …and the app SWITCHER no longer offers Agent Analytics — agents get the link, staff get
   the card; the dropdown is internal dashboards only (Ops / VAS / Tracker). */
const switcher = await page.evaluate(() =>
  [...document.querySelectorAll('aside select option')].map(o => o.textContent.trim()));
ok('the app switcher is internal-only: Ops / VAS / Tracker, no Agent Analytics',
  switcher.length === 3 && !switcher.some(t => /Agent Analytics/i.test(t)), switcher.join(' | '));
ok('every outward link carries rel=noopener (window.opener cannot be abused)',
  hubs.rels.every(r => /noopener/.test(r)), hubs.rels.join(' | '));
ok('the page says these are separate apps, not VAS views',
  /separate apps/i.test(hubs.text) || /own sign-in/i.test(hubs.text), hubs.text.slice(0, 120));

/* ---------- opt-ins are gone, referrals are honest ---------------------------------------
   Opt-ins are no longer sold (Nick, 2026-08-20), so no page may offer them as a metric — the
   coaching that pointed agents at them is removed too. Referrals arrive from HighLevel as a
   period TOTAL per agent with no date, so a daily or weekly row cannot claim a number: it
   shows "-" rather than 0, which would read as "referred nobody today". */
const optRef = await page.evaluate(async () => {
  const S = window.__mtd.state(); const hits = {};
  for (const t of ['dashboard','mtd','weekly','daily','agents','leaderboard','coaching']) {
    S.ui.tab = t; renderPage();
    await new Promise(r => setTimeout(r, 800));
    const txt = document.getElementById('view').innerText || '';
    if (/opt.?in/i.test(txt)) hits[t] = txt.split(String.fromCharCode(10)).filter(l=>/opt.?in/i.test(l))[0];
  }
  S.ui.tab = 'daily'; S.ui.dailyFilter = {}; renderPage();
  let tb = null; for (let i = 0; i < 40 && !tb; i++) { await new Promise(r => setTimeout(r, 150)); tb = document.querySelector('#view table.data'); }
  const head = [...tb.querySelectorAll('thead th')].map(x => x.textContent.trim());
  const iR = head.indexOf('Referrals');
  const refs = [...tb.querySelectorAll('tbody tr')].slice(0, 8).map(tr => [...tr.querySelectorAll('td')][iR]?.textContent.trim());
  return { hits, head, refs, totals: window.__mtd.model().refsAreTotals };
});
ok('no page offers opt-ins as a metric any more', Object.keys(optRef.hits).length === 0, JSON.stringify(optRef.hits));
ok('the Daily table has no Opt-Ins column', !optRef.head.some(h => /opt/i.test(h)), optRef.head.join(','));
/* Referrals have TWO honest modes. The HighLevel API rows carry a created date, so once a
   sync has stored them per day (S.refs.byDay), Daily and Weekly show real counts and MTD is
   period-scoped. An undated per-agent CSV keeps the old totals mode, where daily rows show
   a dash rather than a fake zero. Assert whichever mode the store is in, coherently. */
const refMode = await page.evaluate(() => { const S = window.__mtd.state(), M = window.__mtd.model();
  let factRefs = 0; for (const f of (M.facts || [])) factRefs += f.ref || 0;
  return { byDay: !!(S.refs && S.refs.byDay), totalsFlag: M.refsAreTotals, factRefs }; });
if (refMode.byDay) {
  ok('dated referrals: per-day mode active and facts carry real counts',
    refMode.totalsFlag === false && refMode.factRefs > 0, JSON.stringify(refMode));
} else {
  ok('undated referrals: totals mode flagged so daily rows show a dash, never a fake zero',
    refMode.totalsFlag === true, JSON.stringify(refMode));
  ok('daily referrals read "-" not 0, since the source cannot answer for one day',
    optRef.refs.every(v => v === '–' || v === '-' || /^[1-9]/.test(String(v))), JSON.stringify(optRef.refs));
}

ok('no page errors across the entire run', errors.length === 0, errors.slice(0, 3).join(' | '));

/* ---- PERSISTENCE FRESHNESS (save-reliability-plan P5b) ----
   The daily habit must cover saving as well as calculating: the 28-31 Aug loss
   would have shown here as a red row days before any client email. Skipped when
   running from a local state file (no supabase.env in play). */
try {
  const envTxt2 = fs.readFileSync(path.join(REPO, 'supabase.env'), 'utf8');
  const env2 = Object.fromEntries(envTxt2.split(/\r?\n/).filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
  const fr = await fetch(env2.SUPABASE_URL + '/rest/v1/store_freshness', {
    headers: { apikey: env2.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env2.SUPABASE_SECRET_KEY } });
  if (fr.ok) for (const row of await fr.json())
    ok('freshness: ' + row.check_name, +row.failures === 0,
      row.failures + ' failing — saves may be silently lost; run verify-live-save.mjs --live');
} catch (e) { /* offline run — the dedicated verify-store-freshness suite covers this */ }
console.log(`\n  ${ident.rosterN} agents on the Agent List · ${ident.factN} fact rows · ${money.agents} agents with figures · GWP basis: ${money.basis}-VAT`);
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
failures.forEach(f => console.log('FAIL: ' + f));
await browser.close(); server.close();
process.exit(fail ? 1 : 0);
