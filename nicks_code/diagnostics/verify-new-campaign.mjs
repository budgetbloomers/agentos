#!/usr/bin/env node
/**
 * verify-new-campaign.mjs — RED PHASE, no app code touched.
 *
 * "When an Agent List upload names a campaign PULSE has never seen, it automatically
 * appears in VAS Month to date, Weekly, Daily (and Dashboard/pivot/export where readable)
 * with the correct data." Plus (Nick, added mid-task): THE CAMPAIGN IS TAKEN FROM THE
 * AGENT LIST ONLY — never Salesforce, ViciDial user groups/queue names, or any fallback —
 * and the label shown strips the workbook's "Matrix VAS - " prefix.
 *
 *   node nicks_code/diagnostics/verify-new-campaign.mjs
 *
 * The engine already supports an unrecognised campaign landing on the roster under its own
 * name (2026-09-03, "new campaigns are created") — campOf() returns any unmatched Campaign
 * cell VERBATIM, refreshCamps() appends it to CAMPS, and V23 flags it as reported under the
 * Courtesy rules. What it does NOT do (as of this run) is present that raw cell as a clean
 * label: "Matrix VAS - Rewarded" reaches CAMPS, the header filter dropdown, the MTD/WTD
 * chips and the digest's campAgg key EXACTLY as the workbook wrote it — nobody strips the
 * "Matrix VAS - " prefix. That gap is what this suite is written to catch; the failures
 * below are the RED signal, not a harness bug.
 *
 * Fixture: a real-shaped Agent List (VAS sheet + VT sheet, the "### Sheet: X ###" convention
 * ingestText itself produces from a multi-sheet workbook) naming three campaigns —
 * "Matrix VAS - Courtesy" (existing), "Matrix VAS - Cuddle" (existing) and
 * "Matrix VAS - Rewarded" (brand new, 3 agents, its own team leader) — over two September
 * 2026 weekdays (Mon 14th / Tue 15th; Heritage Day and Saturdays avoided), fed BI Active
 * Cases (money), ViciDial EXPORT_CALL_REPORT (talk) and an attendance register (shifts).
 * The ViciDial rows for the Rewarded agents deliberately carry a `user_group`/`campaign_id`
 * that LIES and says "Courtesy" — proving attribution reads the Agent List, never the
 * dialler's own campaign hint.
 */
import fs from 'node:fs'; import path from 'node:path'; import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.AGENTOS || path.resolve(HERE, '..', '..');   // AGENTOS: run against another checkout, as the sibling suites do
const { chromium } = await import(pathToFileURL(path.join(HERE, 'node_modules', 'playwright', 'index.mjs')).href);

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (d ? ' — ' + d : '')); } };
const section = (s) => console.log('\n— ' + s + ' —');

const HTML = path.join(ROOT, 'nicks_code', 'index.html');
const SERVE = { '/': HTML, '/index.html': HTML, '/xlsx.full.min.js': path.join(ROOT, 'site', 'xlsx.full.min.js') };
const server = http.createServer((q, s) => { const p = SERVE[q.url.split('?')[0]];
  if (!p || !fs.existsSync(p)) { s.writeHead(404); s.end(); return; }
  s.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' }); fs.createReadStream(p).pipe(s); });
await new Promise((r) => server.listen(8271, '127.0.0.1', r));
const scratch = path.join(HERE, 'scratch'); fs.mkdirSync(scratch, { recursive: true });

/* ================= THE FIXTURE ================= */
/* Two ordinary September 2026 weekdays. 2026-09-01 is a Tuesday, so the 14th is a Monday
   and the 15th a Tuesday — both clear of the Saturday-is-data rule and clear of Heritage
   Day (Thu 24 Sep). */
const DAYS = ['2026-09-14', '2026-09-15'];

/* Names use WORD numbers ("One".."Five"), never digits: normName() strips every non-letter
   character (including digits) before matching an Owner/full_name to a roster row, so
   "Courtesy 1".."Courtesy 5" would all collapse to the same key "courtesy" and silently
   merge onto one agent — a fixture bug that was caught by a first run of this suite (every
   Courtesy sale landed on a single code, hc=1 instead of 5) and is not what is being tested
   here. */
const NUM = ['One', 'Two', 'Three', 'Four', 'Five'];
const COURTESY = [0, 1, 2, 3, 4].map(i => ({ code: 'CB80' + (i + 1), name: 'Courtesy ' + NUM[i], tl: 'Leader Courtesy', camp: 'Matrix VAS - Courtesy' }));
const CUDDLE   = [0, 1, 2, 3, 4].map(i => ({ code: 'CB81' + (i + 1), name: 'Cuddle ' + NUM[i], tl: 'Leader Cuddle', camp: 'Matrix VAS - Cuddle' }));
const REWARDED = [0, 1, 2].map(i => ({ code: 'CB82' + (i + 1), name: 'Rewarded ' + NUM[i], tl: 'Leader Rewarded', camp: 'Matrix VAS - Rewarded' }));
const VT       = [0, 1].map(i => ({ code: 'CB83' + (i + 1), name: 'Tracker ' + NUM[i], tl: 'Leader VT', camp: 'VT' }));
const VAS_AGENTS = [...COURTESY, ...CUDDLE, ...REWARDED];
const NEW_LABEL_RAW = 'Matrix VAS - Rewarded';
const NEW_LABEL_CLEAN = 'Rewarded'; // the label the requirement wants; not produced by the app today

const rosterCSV = (agents, moved) => {
  const rows = agents.map(a => {
    const camp = (moved && moved[a.code]) ? moved[a.code] : a.camp;
    return ['CB' + a.code.slice(2), a.name, a.tl, camp, 'Exp', a.name, 5, '2026-01-05'].join(',');
  });
  return 'Employee Code,Agent Name,Team Leader,Campaign,Tenure,Sales Force,Target,Start Date\n' + rows.join('\n') + '\n';
};
const buildRosterText = (moved) =>
  '### Sheet: VAS ###\n' + rosterCSV(VAS_AGENTS, moved) +
  '### Sheet: VT ###\n' + rosterCSV(VT, null);

/* Power BI - Active Cases (the money source). One case per agent per day, ex-VAT charge
   R100. Owner is the Agent Name, matched by normName(). GWP is read back on whichever
   basis MTD_RULES.gwpDisplayBasis actually uses (ex-VAT, per the rule book) — fetched from
   the live rule book below rather than assumed, so this suite tracks the rule instead of a
   frozen copy of it. */
const CHARGE_EX = 100;
function buildBiCSV() {
  const header = 'Account Number,Owner,Charge Amount,Contract Create Date,Case Number,Charge Code';
  const rows = [];
  let seq = 1;
  for (const d of DAYS) for (const a of VAS_AGENTS) {
    rows.push(['ACC' + (seq), a.name, String(CHARGE_EX), d, 'CASE' + (seq), 'SUB1'].join(','));
    seq++;
  }
  return header + '\n' + rows.join('\n') + '\n';
}

/* ViciDial EXPORT_CALL_REPORT — tab-separated, one row per call, `user` = CB code. Every
   Rewarded row carries user_group/campaign_id claiming "Courtesy" — a lie the engine must
   ignore, because the Agent List (never the dialler) decides the campaign. */
const TALK_SECS_PER_DAY = 3600;
function buildViciText() {
  const header = ['call_date', 'user', 'length_in_sec', 'status', 'full_name', 'user_group', 'campaign_id', 'status_name'];
  const rows = [header.join('\t')];
  for (const d of DAYS) for (const a of VAS_AGENTS) {
    const lie = REWARDED.some(r => r.code === a.code);
    rows.push([d, a.code, String(TALK_SECS_PER_DAY), 'XFER', '', lie ? 'Courtesy' : (COURTESY.includes(a) ? 'Courtesy' : 'Cuddle'), lie ? 'COURTESY_Q' : 'Q1', ''].join('\t'));
  }
  return rows.join('\n') + '\n';
}

/* HR attendance register — everyone Present on both days. */
function buildAttendanceCSV() {
  const header = 'Employee Code,Date,Status Code';
  const rows = [];
  for (const d of DAYS) for (const a of VAS_AGENTS) rows.push([a.code, d, 'P'].join(','));
  return header + '\n' + rows.join('\n') + '\n';
}

/* ---------- independently-computed expectations (never shared code with the engine) ---------- */
const SALES_PER_AGENT = DAYS.length;                 // 1 case/day, over the fixture's whole period
const TALK_PER_AGENT = TALK_SECS_PER_DAY * DAYS.length;
const SHIFTS_PER_AGENT = DAYS.length;                 // present + talked every day -> emp=act=1/day
const expectFor = (group, gwpPerAgent) => ({
  sales: SALES_PER_AGENT * group.length,
  gwp: gwpPerAgent * group.length,
  talk: TALK_PER_AGENT * group.length,
  emp: SHIFTS_PER_AGENT * group.length,
  act: SHIFTS_PER_AGENT * group.length,
});

/* ================= drive the real engine ================= */
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));
await page.goto('http://127.0.0.1:8271/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__mtd && window.__mtd.state(), null, { timeout: 30000 });

/* the rule book decides the GWP display basis (ex-VAT vs inclusive) — read it live rather
   than assume, exactly like verify-bi-gwp.mjs's approach to the cancellation rule */
const { basis, vat } = await page.evaluate(() => ({ basis: window.__mtd.rules().gwpDisplayBasis, vat: window.__mtd.vat() }));
const GWP_PER_AGENT = (basis === 'ex') ? CHARGE_EX * DAYS.length : Math.round(CHARGE_EX * DAYS.length * vat);
const EXP_COURTESY = expectFor(COURTESY, GWP_PER_AGENT), EXP_CUDDLE = expectFor(CUDDLE, GWP_PER_AGENT), EXP_REWARDED = expectFor(REWARDED, GWP_PER_AGENT);

async function reset() {
  await page.evaluate(() => {
    try { localStorage.clear(); } catch (e) {}
    const S = window.__mtd.state();
    ['calls', 'callsMeta', 'sales', 'att', 'evals', 'tracker', 'cancRows', 'vici', 'viciDays', 'orgHist'].forEach(k => S[k] = {});
    S.files = []; S.roster = []; S.ui.asAt = ''; S.ui.camp = ''; S.ui.team = ''; S.ui.mtdSub = ''; S.ui.wtdCamp = ''; S.ui.dailyFilter = {};
  });
}
await reset();

async function ingest(name, text, kind) {
  return page.evaluate(([name, text, kind]) => window.__mtd.ingest(name, text, kind, name), [name, text, kind]);
}

section('load the fixture: Agent List (VAS + VT), BI, ViciDial, attendance');
await page.evaluate(() => window.__mtd.setRosterAsOf('2026-09-14'));
const rosterRes = await ingest('Matrix - Agent List.csv', buildRosterText(null), 'roster');
ok('the Agent List ingests', !!rosterRes, JSON.stringify(rosterRes));
await ingest('Power BI - Active Cases.csv', buildBiCSV(), 'bi');
await ingest('EXPORT_CALL_REPORT.txt', buildViciText(), 'vici');
await ingest('Attendance.csv', buildAttendanceCSV(), 'attendance');
await page.evaluate(() => window.__mtd.rebuild());
await page.evaluate(() => window.__mtd.setPeriod('2026-09', 'month'));

const snap1 = await page.evaluate(([NEW_LABEL_CLEAN]) => {
  const M = window.__mtd.model(), S = window.__mtd.state();
  const campOfAgent = (code) => (S.roster.find(a => a.code === code) || {}).campaign;
  return {
    camps: (typeof CAMPS !== 'undefined') ? CAMPS.slice() : null,
    camplab: (typeof CAMPLAB !== 'undefined') ? CAMPLAB[NEW_LABEL_CLEAN] : undefined,
    newCampaigns: M.newCampaigns || [],
    campAggKeys: Object.keys(M.campAgg || {}),
    campAgg: M.campAgg,
    facts: M.facts,
    weeks: (M.weeks || []).map(w => ({ num: w.num, dates: w.dates })),
    wtdCC: M.wtdCC,
    checks: window.__mtd.checks() || [],
    digest: window.__mtd.digest(),
    rewardedAgentCampaign: campOfAgent('CB821'),
    courtesyAgentCampaign: campOfAgent('CB801'),
  };
}, [NEW_LABEL_CLEAN]);

/* ============ 1. LABEL: prefix stripped, existing campaigns unaffected ============ */
section('1 · the new campaign\'s label is "Rewarded", not "Matrix VAS - Rewarded"');
ok('an existing "Matrix VAS - Courtesy" row still resolves to Courtesy',
  snap1.courtesyAgentCampaign === 'Courtesy' && (snap1.facts || []).some(f => f.code === 'CB801' && f.campaign === 'Courtesy'),
  'roster campaign=' + snap1.courtesyAgentCampaign);
const factRewardedCamp = (snap1.facts || []).find(f => f.code === 'CB821');
ok('the new campaign\'s label as it reaches the facts/CAMPS is "Rewarded" (prefix stripped)',
  factRewardedCamp && factRewardedCamp.campaign === NEW_LABEL_CLEAN,
  'fact campaign=' + (factRewardedCamp && factRewardedCamp.campaign));
ok('CAMPLAB (or its c||c fallback) prints "Rewarded", never the raw workbook cell',
  (snap1.camplab === NEW_LABEL_CLEAN || snap1.camplab === undefined) && Array.isArray(snap1.camps) && snap1.camps.includes(NEW_LABEL_CLEAN),
  'CAMPLAB[clean]=' + JSON.stringify(snap1.camplab) + ' camps=' + JSON.stringify(snap1.camps));

/* ============ 2. CAMPS + the header dropdown ============ */
section('2 · CAMPS and the header Campaign filter offer it');
ok('CAMPS includes the new campaign (some token for it)',
  Array.isArray(snap1.camps) && snap1.camps.some(c => c === NEW_LABEL_CLEAN || c === NEW_LABEL_RAW),
  JSON.stringify(snap1.camps));
ok('…and the token is the CLEAN label "Rewarded", not the raw workbook cell',
  Array.isArray(snap1.camps) && snap1.camps.includes(NEW_LABEL_CLEAN) && !snap1.camps.includes(NEW_LABEL_RAW),
  JSON.stringify(snap1.camps));
const dropdown = await page.evaluate(() => [...document.querySelectorAll('#fCampG option')].map(o => ({ value: o.value, text: o.textContent })));
ok('the header Campaign filter dropdown lists it',
  dropdown.some(o => o.value === NEW_LABEL_CLEAN || o.value === NEW_LABEL_RAW), JSON.stringify(dropdown));
ok('…showing the clean label "Rewarded" as its text, not the raw workbook cell',
  dropdown.some(o => o.text === NEW_LABEL_CLEAN), JSON.stringify(dropdown));

/* ============ 3. Month to date ============ */
section('3 · Month to date: a Rewarded row exists with the right sales/GWP/talk/shifts; Courtesy/Cuddle unaffected');
const mtdRewarded = snap1.campAgg && (snap1.campAgg[NEW_LABEL_CLEAN] || snap1.campAgg[NEW_LABEL_RAW]);
ok('a Month to date Rewarded campaign total exists', !!mtdRewarded, JSON.stringify(snap1.campAggKeys));
if (mtdRewarded) {
  ok('MTD Rewarded sales = ' + EXP_REWARDED.sales, mtdRewarded.sales === EXP_REWARDED.sales, 'got ' + mtdRewarded.sales);
  ok('MTD Rewarded GWP = R' + EXP_REWARDED.gwp, mtdRewarded.gwp === EXP_REWARDED.gwp, 'got ' + mtdRewarded.gwp);
  ok('MTD Rewarded talk = ' + EXP_REWARDED.talk + 's', mtdRewarded.talk === EXP_REWARDED.talk, 'got ' + mtdRewarded.talk);
  ok('MTD Rewarded shifts (emp/act) = ' + EXP_REWARDED.emp, mtdRewarded.emp === EXP_REWARDED.emp && mtdRewarded.act === EXP_REWARDED.act,
    'got emp=' + mtdRewarded.emp + ' act=' + mtdRewarded.act);
}
const mtdCourtesy = snap1.campAgg && snap1.campAgg.Courtesy, mtdCuddle = snap1.campAgg && snap1.campAgg.Cuddle;
ok('Courtesy MTD totals are exactly the Courtesy-only fixture sum (unaffected by Rewarded)',
  mtdCourtesy && mtdCourtesy.sales === EXP_COURTESY.sales && mtdCourtesy.gwp === EXP_COURTESY.gwp && mtdCourtesy.talk === EXP_COURTESY.talk,
  JSON.stringify(mtdCourtesy));
ok('Cuddle MTD totals are exactly the Cuddle-only fixture sum (unaffected by Rewarded)',
  mtdCuddle && mtdCuddle.sales === EXP_CUDDLE.sales && mtdCuddle.gwp === EXP_CUDDLE.gwp && mtdCuddle.talk === EXP_CUDDLE.talk,
  JSON.stringify(mtdCuddle));

/* ============ 4. Weekly and Daily ============ */
section('4 · Weekly and Daily carry the new campaign with correct figures');
const week = (snap1.weeks || []).find(w => (w.dates || []).includes(DAYS[0]) && (w.dates || []).includes(DAYS[1]));
ok('both fixture days fall in one Monday-anchored week', !!week, JSON.stringify(snap1.weeks));
if (week) {
  const wk = (snap1.wtdCC || {})[week.num] || {};
  const wkRewarded = wk[NEW_LABEL_CLEAN] || wk[NEW_LABEL_RAW];
  const sumField = (campBucket, field) => Object.values(campBucket || {}).reduce((t, o) => t + (o[field] || 0), 0);
  ok('Weekly: a Rewarded bucket exists for that week', !!wkRewarded, JSON.stringify(Object.keys(wk)));
  if (wkRewarded) {
    ok('Weekly Rewarded sales = ' + EXP_REWARDED.sales, sumField(wkRewarded, 'sales') === EXP_REWARDED.sales, 'got ' + sumField(wkRewarded, 'sales'));
    ok('Weekly Rewarded GWP = R' + EXP_REWARDED.gwp, sumField(wkRewarded, 'gwp') === EXP_REWARDED.gwp, 'got ' + sumField(wkRewarded, 'gwp'));
  }
}
for (const d of DAYS) {
  const dayFacts = (snap1.facts || []).filter(f => f.date === d);
  const rewardedDay = dayFacts.filter(f => f.campaign === NEW_LABEL_CLEAN || f.campaign === NEW_LABEL_RAW);
  const daySales = rewardedDay.reduce((t, f) => t + (f.sales || 0), 0);
  ok('Daily ' + d + ': Rewarded sales = ' + REWARDED.length, daySales === REWARDED.length, 'got ' + daySales + ' rows=' + rewardedDay.length);
}

/* ============ 5. header filter to Rewarded shows only its agents/totals ============ */
section('5 · filtering the header Campaign filter to Rewarded isolates its agents');
const filtered = await page.evaluate(([tok]) => {
  const S = window.__mtd.state(); S.ui.tab = 'mtd'; S.ui.camp = tok; S.ui.team = '';
  if (typeof renderPage === 'function') renderPage();
  return new Promise(r => setTimeout(() => {
    const v = document.getElementById('view'); const tb = v ? [...v.querySelectorAll('tbody')].map(t => t.innerText).join(' ') : '';
    r({ hasRewardedTL: /Leader Rewarded/.test(tb), hasCourtesyTL: /Leader Courtesy/.test(tb), hasCuddleTL: /Leader Cuddle/.test(tb),
      rows: v ? v.querySelectorAll('tbody tr').length : 0 });
  }, 400));
}, [NEW_LABEL_CLEAN]);
ok('with the filter set to the CLEAN "Rewarded" token, only Rewarded\'s leader/agents show',
  filtered.hasRewardedTL && !filtered.hasCourtesyTL && !filtered.hasCuddleTL, JSON.stringify(filtered));
/* the raw, un-stripped workbook cell must NOT be a live filter value any more — if the label
   is genuinely clean end-to-end, filtering on the raw cell matches nobody */
const filteredRaw = await page.evaluate(([tok]) => {
  const S = window.__mtd.state(); S.ui.tab = 'mtd'; S.ui.camp = tok; S.ui.team = '';
  if (typeof renderPage === 'function') renderPage();
  return new Promise(r => setTimeout(() => {
    const v = document.getElementById('view'); const tb = v ? [...v.querySelectorAll('tbody')].map(t => t.innerText).join(' ') : '';
    r({ hasRewardedTL: /Leader Rewarded/.test(tb), rows: v ? v.querySelectorAll('tbody tr').length : 0 });
  }, 400));
}, [NEW_LABEL_RAW]);
ok('…and the raw un-stripped workbook cell is not itself a usable filter value any more',
  !filteredRaw.hasRewardedTL, JSON.stringify(filteredRaw));
await page.evaluate(() => { const S = window.__mtd.state(); S.ui.camp = ''; });

/* ============ 6. V23 + no page errors ============ */
section('6 · V23 flags it, reported under the Courtesy rules');
const v23 = (snap1.checks || []).find(c => c.id === 'V23');
ok('V23 fires as a warning naming the new campaign, reported under the Courtesy rules',
  v23 && v23.ok === false && v23.sev === 'warn' && /Courtesy rules/.test(v23.msg) && v23.msg.includes(NEW_LABEL_CLEAN),
  JSON.stringify(v23));
ok('…and V23\'s message names the CLEAN label "Rewarded", not the raw workbook cell',
  v23 && v23.msg.includes(NEW_LABEL_CLEAN) && !v23.msg.includes(NEW_LABEL_RAW), JSON.stringify(v23 && v23.msg));

/* ============ 7. the published digest ============ */
section('7 · the published digest (campAgg) includes Rewarded with the same sales total');
const digestRewarded = snap1.digest && snap1.digest.campAgg && (snap1.digest.campAgg[NEW_LABEL_CLEAN] || snap1.digest.campAgg[NEW_LABEL_RAW]);
ok('agentDigestPayload().campAgg carries a Rewarded entry', !!digestRewarded, JSON.stringify(snap1.digest && Object.keys(snap1.digest.campAgg || {})));
if (digestRewarded) ok('…with the same sales total as Month to date (' + EXP_REWARDED.sales + ')',
  digestRewarded.sales === EXP_REWARDED.sales, 'got ' + digestRewarded.sales);
ok('the digest\'s campAgg KEY is the clean label "Rewarded"',
  !!(snap1.digest && snap1.digest.campAgg && snap1.digest.campAgg[NEW_LABEL_CLEAN]),
  JSON.stringify(snap1.digest && Object.keys(snap1.digest.campAgg || {})));

/* ============ (a) the campaign comes from the Agent List ONLY — never Vici's own hint ============ */
section('(a) · the campaign is taken from the Agent List, never a ViciDial/SF hint');
ok('the ViciDial rows for Rewarded agents lied (user_group/campaign_id said "Courtesy") and were ignored',
  mtdRewarded && mtdRewarded.talk === EXP_REWARDED.talk, 'Rewarded talk=' + (mtdRewarded && mtdRewarded.talk) + ' expected ' + EXP_REWARDED.talk);
ok('…and none of that talk leaked into Courtesy\'s total',
  mtdCourtesy && mtdCourtesy.talk === EXP_COURTESY.talk, 'Courtesy talk=' + (mtdCourtesy && mtdCourtesy.talk) + ' expected ' + EXP_COURTESY.talk);

/* ============ (c) whole-period move: Courtesy -> Rewarded reattributes the WHOLE month ============ */
section('(c) · a second Agent List moving CB801 Courtesy -> Rewarded moves their whole current-month figures');
await page.evaluate(() => window.__mtd.setRosterAsOf('2026-09-16'));
await ingest('Matrix - Agent List (move).csv', buildRosterText({ CB801: NEW_LABEL_RAW }), 'roster');
await page.evaluate(() => window.__mtd.rebuild());
const snap2 = await page.evaluate(([raw, clean]) => {
  const M = window.__mtd.model();
  const cb801 = (M.facts || []).filter(f => f.code === 'CB801');
  return { cb801, campAgg: M.campAgg, courtesySales: (M.campAgg.Courtesy || {}).sales, rewardedSales: ((M.campAgg[clean] || M.campAgg[raw]) || {}).sales };
}, [NEW_LABEL_RAW, NEW_LABEL_CLEAN]);
ok('CB801\'s facts on BOTH fixture days (before the move landed) now read Rewarded, not Courtesy',
  snap2.cb801.length === DAYS.length && snap2.cb801.every(f => f.campaign === NEW_LABEL_CLEAN || f.campaign === NEW_LABEL_RAW),
  JSON.stringify(snap2.cb801.map(f => [f.date, f.campaign])));
ok('Courtesy\'s MTD sales dropped by exactly CB801\'s ' + SALES_PER_AGENT + ' sales',
  snap2.courtesySales === EXP_COURTESY.sales - SALES_PER_AGENT, 'got ' + snap2.courtesySales + ' expected ' + (EXP_COURTESY.sales - SALES_PER_AGENT));
ok('Rewarded\'s MTD sales grew by exactly CB801\'s sales',
  snap2.rewardedSales === EXP_REWARDED.sales + SALES_PER_AGENT, 'got ' + snap2.rewardedSales + ' expected ' + (EXP_REWARDED.sales + SALES_PER_AGENT));

/* ============ 8. a campaign dropped from the NEXT list disappears everywhere, movers reattribute ============ */
section('8 · a list that drops Rewarded entirely removes it from CAMPS/MTD/Weekly/Daily/digest; its agents move to Courtesy for the whole month');
await reset();
await page.evaluate(() => window.__mtd.setRosterAsOf('2026-09-14'));
await ingest('Matrix - Agent List.csv', buildRosterText(null), 'roster');
await ingest('Power BI - Active Cases.csv', buildBiCSV(), 'bi');
await ingest('EXPORT_CALL_REPORT.txt', buildViciText(), 'vici');
await ingest('Attendance.csv', buildAttendanceCSV(), 'attendance');
await page.evaluate(() => window.__mtd.rebuild());
await page.evaluate(() => window.__mtd.setPeriod('2026-09', 'month'));
/* the next list: the Rewarded label never appears again — every ex-Rewarded agent is now
   filed under Courtesy, exactly as Nick's rule reads ("the old ones are not in the new one
   … place the agents in the correct campaigns") */
const droppedMap = Object.fromEntries(REWARDED.map(r => [r.code, 'Matrix VAS - Courtesy']));
await page.evaluate(() => window.__mtd.setRosterAsOf('2026-09-18'));
await ingest('Matrix - Agent List (drop Rewarded).csv', buildRosterText(droppedMap), 'roster');
await page.evaluate(() => window.__mtd.rebuild());
const snap8 = await page.evaluate(([clean]) => {
  const M = window.__mtd.model();
  return {
    camps: (typeof CAMPS !== 'undefined') ? CAMPS.slice() : null,
    campAggKeys: Object.keys(M.campAgg || {}),
    courtesySales: (M.campAgg.Courtesy || {}).sales,
    rewardedFacts: (M.facts || []).filter(f => f.campaign === clean),
    digestKeys: Object.keys((window.__mtd.digest() || {}).campAgg || {}),
  };
}, [NEW_LABEL_CLEAN]);
const dropdown8 = await page.evaluate(() => [...document.querySelectorAll('#fCampG option')].map(o => o.value));
ok('CAMPS no longer carries "Rewarded" once no list names it',
  Array.isArray(snap8.camps) && !snap8.camps.includes(NEW_LABEL_CLEAN), JSON.stringify(snap8.camps));
ok('…nor does the header Campaign filter dropdown', !dropdown8.includes(NEW_LABEL_CLEAN), JSON.stringify(dropdown8));
ok('…nor Month to date\'s campAgg', !snap8.campAggKeys.includes(NEW_LABEL_CLEAN), JSON.stringify(snap8.campAggKeys));
ok('…nor Weekly/Daily: no fact row is attributed to Rewarded any more', snap8.rewardedFacts.length === 0, JSON.stringify(snap8.rewardedFacts));
ok('…nor the published digest\'s campAgg', !snap8.digestKeys.includes(NEW_LABEL_CLEAN), JSON.stringify(snap8.digestKeys));
ok('Courtesy\'s MTD sales absorbed the WHOLE month for all 3 ex-Rewarded agents (' + (EXP_COURTESY.sales + EXP_REWARDED.sales) + ')',
  snap8.courtesySales === EXP_COURTESY.sales + EXP_REWARDED.sales, 'got ' + snap8.courtesySales);

/* ============ 9. a rule-book campaign the list does not carry is not reported ============ */
section('9 · Nesting (a rule-book campaign) with no agents on the list is not reported — no empty section');
ok('CAMPS does not carry "Nesting" — nobody on this Agent List is Nesting',
  Array.isArray(snap8.camps) && !snap8.camps.includes('Nesting'), JSON.stringify(snap8.camps));
ok('…nor does Month to date\'s campAgg carry an empty Nesting bucket',
  !snap8.campAggKeys.includes('Nesting'), JSON.stringify(snap8.campAggKeys));
ok('…nor the header Campaign filter dropdown', !dropdown8.includes('Nesting'), JSON.stringify(dropdown8));

/* ============ 10. the list's campaign/TL wins over a conflicting tracker-daily row ============ */
section('10 · a tracker daily sheet naming a different Campaign/Team Leader for a Rewarded agent never outvotes the Agent List');
await reset();
await page.evaluate(() => window.__mtd.setRosterAsOf('2026-09-14'));
await ingest('Matrix - Agent List.csv', buildRosterText(null), 'roster');
await ingest('Power BI - Active Cases.csv', buildBiCSV(), 'bi');
await ingest('EXPORT_CALL_REPORT.txt', buildViciText(), 'vici');
await ingest('Attendance.csv', buildAttendanceCSV(), 'attendance');
/* a tracker daily row for CB821 (a Rewarded agent) that LIES: Team Leader "Rogue Leader",
   Campaign "Matrix VAS - Courtesy" — this file states the org PER DAY, which is exactly why
   the Agent List has to win it, not merely arrive after it */
const trackerHeader = 'Date,Emp Code,Team Leader,Campaign,Agent,Tenure,Employed Shifts,Actual Shifts,Sales Target,Sales Achieved,Talk Time,GWP Target,GWP Achieved,Insurance Opt In,Referrals';
const trackerRow = ['2026-09-14', 'CB821', 'Rogue Leader', 'Matrix VAS - Courtesy', 'Rewarded One', 'Exp', '1', '1', '5', '0', '0:00:00', '0', '0', '0', '0'].join(',');
await ingest('Tracker Daily.csv', trackerHeader + '\n' + trackerRow + '\n', 'trackerDaily');
await page.evaluate(() => window.__mtd.rebuild());
await page.evaluate(() => window.__mtd.setPeriod('2026-09', 'month'));
const snap10 = await page.evaluate(() => {
  const M = window.__mtd.model();
  const row = (M.facts || []).find(f => f.code === 'CB821' && f.date === '2026-09-14');
  return { row, tlAgg: M.tlAgg };
});
ok('CB821\'s 14 Sep fact still carries the Agent List\'s campaign ("Rewarded"), not the tracker\'s "Courtesy"',
  snap10.row && snap10.row.campaign === NEW_LABEL_CLEAN, JSON.stringify(snap10.row));
ok('…and the Agent List\'s team leader ("Leader Rewarded"), not the tracker\'s "Rogue Leader"',
  snap10.row && snap10.row.tl === 'Leader Rewarded', JSON.stringify(snap10.row));
ok('tlAgg has no "Rogue Leader" row at all — the tracker\'s team leader never enters the model',
  !Object.keys(snap10.tlAgg || {}).some(k => k.endsWith('|Rogue Leader')), JSON.stringify(Object.keys(snap10.tlAgg || {})));

/* ============ (b) verbatim label preservation (case/spaces), a different campaign name ============ */
/* ============ 11. review round (ecc:code-reviewer + silent-failure-hunter, 2026-09-27) ============ */
section('11 · a list with no Cuddle still opens MTD/Weekly on a campaign with rows; last month keeps its own campaigns');
{
  /* (i) a floor with no Cuddle agent: MTD and Weekly used to default their tab to the literal
     'Cuddle', which is no longer in CAMPS once the list stops carrying it — a blank page */
  await reset();
  await page.evaluate(() => window.__mtd.setRosterAsOf('2026-09-14'));
  const noCuddle = '### Sheet: VAS ###\n' + rosterCSV([...COURTESY, ...REWARDED], null);
  await ingest('Matrix - Agent List.csv', noCuddle, 'roster');
  await ingest('Power BI - Active Cases.csv', buildBiCSV(), 'bi');
  await ingest('EXPORT_CALL_REPORT.txt', buildViciText(), 'vici');
  await ingest('Attendance.csv', buildAttendanceCSV(), 'attendance');
  await page.evaluate(() => { window.__mtd.rebuild(); window.__mtd.setPeriod('2026-09', 'month'); });
  /* a browser whose saved sub-tabs still say Cuddle (the realistic stale state), rendered the way
     §5 renders: set the tab, renderPage, read #view once the deferred render has landed */
  const rowsOn = (tab) => page.evaluate((tab) => {
    const S = window.__mtd.state(); S.ui.tab = tab; S.ui.camp = ''; S.ui.team = ''; S.ui.mtdSub = 'Cuddle'; S.ui.wtdCamp = 'Cuddle';
    if (typeof renderPage === 'function') renderPage();
    return new Promise(r => setTimeout(() => { const v = document.getElementById('view');
      r(v ? v.querySelectorAll('tbody tr').length : 0); }, 400));
  }, tab);
  const nc = { camps: await page.evaluate(() => CAMPS.slice()), mtd: await rowsOn('mtd'), weekly: await rowsOn('weekly') };
  ok('CAMPS carries no Cuddle when the list has no Cuddle agent', !nc.camps.includes('Cuddle'), JSON.stringify(nc.camps));
  ok('…and Month to date opens on a campaign that has rows (never a blank Cuddle tab)', nc.mtd > 0, JSON.stringify(nc));
  ok('…and so does Weekly', nc.weekly > 0, JSON.stringify(nc));

  /* (ii) the comparison period keeps ITS campaigns: an agent who was Nesting in August and is
     Courtesy in September — August's Nesting sale must still count in August's (MP) totals */
  await reset();
  const NEST = { code: 'CB841', name: 'Nesting One', tl: 'Leader Nesting', camp: 'Nesting' };
  await page.evaluate(() => window.__mtd.setRosterAsOf('2026-08-10'));
  await ingest('Matrix - Agent List aug.csv', '### Sheet: VAS ###\n' + rosterCSV([...COURTESY, NEST], null), 'roster');
  await page.evaluate(() => window.__mtd.setRosterAsOf('2026-09-14'));
  await ingest('Matrix - Agent List sep.csv', '### Sheet: VAS ###\n' + rosterCSV([...COURTESY, NEST], { CB841: 'Matrix VAS - Courtesy' }), 'roster');
  await ingest('Power BI - Active Cases aug.csv',
    'Account Number,Owner,Charge Amount,Contract Create Date,Case Number,Charge Code\nACCN1,Nesting One,100,2026-08-10,CASEN1,SUB1\n', 'bi');
  await ingest('Power BI - Active Cases.csv', buildBiCSV(), 'bi');
  await page.evaluate(() => { window.__mtd.rebuild(); window.__mtd.setPeriod('2026-09', 'month'); window.__mtd.rebuild(); });
  const cmp = await page.evaluate(() => {
    const M = window.__mtd.model(), P = window.__mtd.prevModel();
    return { camps: CAMPS.slice(), prevDates: P ? [P.dates[0], P.dates[P.dates.length - 1]] : null,
      prevNest: P && P.campAgg && P.campAgg.Nesting ? P.campAgg.Nesting.sales : null,
      prevGrand: P && P.grand ? P.grand.sales : null, prevOff: P ? P.offCampaign : null,
      nestNowFacts: (M.facts || []).filter(f => f.campaign === 'Nesting').length };
  });
  ok('September (on screen) does not report Nesting — the list moved its one agent to Courtesy',
    !cmp.camps.includes('Nesting') && cmp.nestNowFacts === 0, JSON.stringify(cmp));
  ok('…while August (the comparison period) still counts that agent\'s Nesting sale',
    cmp.prevNest === 1 && cmp.prevGrand >= 1 && !(cmp.prevOff && cmp.prevOff.Nesting), JSON.stringify(cmp));
}

section('(b) · the label is the list\'s cell verbatim minus the prefix, case and spaces kept');
await reset();
await page.evaluate(() => window.__mtd.setRosterAsOf('2026-09-14'));
const dtAgents = [{ code: 'CB841', name: 'DT One', tl: 'Leader DT', camp: 'Matrix VAS - Download & Test' },
                  { code: 'CB842', name: 'DT Two', tl: 'Leader DT', camp: 'Matrix VAS - Download & Test' },
                  { code: 'CB843', name: 'DT Three', tl: 'Leader DT', camp: 'Matrix VAS - Download & Test' }];
await ingest('Matrix - Agent List DT.csv', rosterCSVWrap(dtAgents), 'roster');
function rosterCSVWrap(agents) {
  const rows = agents.map(a => ['CB' + a.code.slice(2), a.name, a.tl, a.camp, 'Exp', a.name, 5, '2026-01-05'].join(','));
  return '### Sheet: VAS ###\nEmployee Code,Agent Name,Team Leader,Campaign,Tenure,Sales Force,Target,Start Date\n' + rows.join('\n') + '\n';
}
await page.evaluate(() => window.__mtd.rebuild());
const dtSnap = await page.evaluate(() => ({ camps: (typeof CAMPS !== 'undefined') ? CAMPS.slice() : null }));
ok('"Matrix VAS - Download & Test" -> "Download & Test" (verbatim, case and "&" kept, prefix stripped)',
  Array.isArray(dtSnap.camps) && dtSnap.camps.includes('Download & Test'), JSON.stringify(dtSnap.camps));

ok('no page errors', errors.length === 0, errors.slice(0, 5).join(' | '));

await browser.close();
server.close();
console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
process.exitCode = fail ? 1 : 0;
