#!/usr/bin/env node
/**
 * verify-public-holidays.mjs — a public holiday is data, not a shift; and the calendar can never run out.
 *
 *   node nicks_code/diagnostics/verify-public-holidays.mjs            # calendar + engine, no credentials
 *   node nicks_code/diagnostics/verify-public-holidays.mjs --live     # …and the PUBLISHED digest (needs supabase.env)
 *
 * Nick, 2026-09-25: "the employee shifts says 18 it should be 17". Heritage Day (Thu 24 Sep 2026) had an
 * HR register row for all 67 agents and nobody on the phones, and the engine handed the whole floor a
 * phantom Employed Shift — 18 not 17, an 18th dialling day, one more day of target, a lower Attendance —
 * because only Saturday had a guard (rule saturdayShiftsFrom). The holiday table existed but was read
 * only by the working-day counts, and it was a hand-typed list that had to be extended every December.
 *
 * Three things this proves, so that class of fault cannot come back quietly:
 *   A. THE CALENDAR is computed (saHolidaysFor), reproduces the tables it replaced, keeps answering for
 *      years nobody typed, and is byte-identical in PULSE and Agent Analytics (the @mirror markers).
 *   B. THE ENGINE treats a public holiday exactly as a Saturday: sales counted, no Employed or Actual
 *      Shift, no target, not a dialling day; the effective date leaves August alone; the one-off list
 *      (extraHolidays) is READ, not decorative; rule checks V25/V25a exist and fire.
 *   C. THE PUBLISHED DIGEST (--live) carries no shift on any Saturday or public holiday under the rule.
 *      With --live and no credentials this FAILS rather than passing on nothing.
 */
import fs from 'node:fs'; import path from 'node:path'; import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const LIVE = process.argv.includes('--live');
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (d ? ' — ' + d : '')); } };

const PULSE = fs.readFileSync(path.join(ROOT, 'nicks_code', 'index.html'), 'utf8');
const AGENT = fs.readFileSync(path.join(ROOT, 'agent', 'index.html'), 'utf8');
const START = '/* @mirror:sa-holidays start', END = '/* @mirror:sa-holidays end */';
const block = (src) => { const a = src.indexOf(START), b = src.indexOf(END); return (a > -1 && b > a) ? src.slice(a, b + END.length) : null; };

/* ------------------------------------------------------------------ A. the calendar ---- */
console.log('\nA · THE CALENDAR IS COMPUTED, CORRECT AND MIRRORED');
const pb = block(PULSE), ab = block(AGENT);
ok('PULSE carries the marked calendar block', !!pb);
ok('Agent Analytics carries the marked calendar block', !!ab);
ok('the two blocks are byte-identical (no second copy to drift)', pb && pb === ab);
ok('neither page carries the old hand-typed SA_HOLIDAYS table any more', !/SA_HOLIDAYS\s*=\s*(new Set|\{)/.test(PULSE) && !/SA_HOLIDAYS\s*=\s*(new Set|\{)/.test(AGENT));
const saHolidaysFor = pb ? new Function(pb + ';return saHolidaysFor;')() : () => [];
/* the tables the function replaced — observed dates, as they stood in both pages on 2026-09-25 */
const OLD = {
  2026: ['2026-01-01', '2026-03-21', '2026-04-03', '2026-04-06', '2026-04-27', '2026-05-01', '2026-06-16', '2026-08-10', '2026-09-24', '2026-12-16', '2026-12-25', '2026-12-26'],
  2027: ['2027-01-01', '2027-03-22', '2027-03-26', '2027-03-29', '2027-04-27', '2027-05-01', '2027-06-16', '2027-08-09', '2027-09-24', '2027-12-16', '2027-12-25', '2027-12-27'],
};
for (const y of [2026, 2027]) ok(y + ' reproduces the table it replaced', JSON.stringify(saHolidaysFor(y).slice().sort()) === JSON.stringify(OLD[y]), saHolidaysFor(y).join(' '));
ok('Heritage Day 2026 is a public holiday', saHolidaysFor(2026).includes('2026-09-24'));
{ const h28 = saHolidaysFor(2028);
  ok('2028 — a year nobody typed — has its 12 holidays', h28.length === 12, h28.join(' '));
  ok('2028 Good Friday is 14 April and Family Day 17 April (Easter 16 Apr 2028)', h28.includes('2028-04-14') && h28.includes('2028-04-17'));
  ok('2028 Heritage Day (a Sunday) is observed on Monday 25 September', h28.includes('2028-09-25') && !h28.includes('2028-09-24')); }
{ const h25 = saHolidaysFor(2025);
  ok('2025 Good Friday 18 April, Family Day 21 April, Freedom Day (a Sunday) observed 28 April', h25.includes('2025-04-18') && h25.includes('2025-04-21') && h25.includes('2025-04-28')); }
{ let bad = [];
  for (let y = 2024; y <= 2045; y++) for (const d of saHolidaysFor(y)) { if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || new Date(d + 'T00:00:00Z').getUTCDay() === 0 || saHolidaysFor(y).length !== 12) bad.push(d); }
  ok('2024–2045: every year has 12 well-formed observed dates and none falls on a Sunday', !bad.length, bad.slice(0, 5).join(' ')); }
ok('the engine has ONE decision point, dataOnlyDay(), and the shift guard reads it', /function dataOnlyDay\(d\)\{ return saturdayDataOnly\(d\)\|\|publicHolidayDataOnly\(d\); \}/.test(PULSE) && /if\(dataOnlyDay\(d\)\)\{ emp=0; act=0; \}/.test(PULSE));
ok('no shift-side guard still asks only about Saturday', !/if\(saturdayDataOnly\(d\)\)\{ emp=0/.test(PULSE) && !/!saturdayDataOnly\(d\)\)\.sort\(/.test(PULSE));

/* ------------------------------------------------------------------ B. the engine ---- */
console.log('\nB · THE ENGINE: A PUBLIC HOLIDAY IS DATA, NOT A SHIFT');
const HTML = path.join(ROOT, 'nicks_code', 'index.html');
const SERVE = { '/': HTML, '/index.html': HTML, '/xlsx.full.min.js': path.join(ROOT, 'site', 'xlsx.full.min.js') };
const server = http.createServer((q, s) => { const p = SERVE[q.url.split('?')[0]];
  if (!p || !fs.existsSync(p)) { s.writeHead(404); s.end(); return; }
  s.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' }); fs.createReadStream(p).pipe(s); });
await new Promise((r) => server.listen(8257, '127.0.0.1', r));
const { chromium } = await import(pathToFileURL(path.join(HERE, 'node_modules', 'playwright', 'index.mjs')).href);
const b = await chromium.launch();
try {
  const page = await b.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
  await page.goto('http://127.0.0.1:8257/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__mtd && window.__mtd.state(), null, { timeout: 30000 });

  /* THE FLOOR. 30 agents, Courtesy and Cuddle, present on the register every day.
       Tue 2026-09-22  register with a zero-weight status (PH — what Heritage Day looked like) + a dialler file in which nobody talked
                       (the "files landed, floor idle" day → V25a; Cuddle's actual shifts come from the register, so P would count)
       Wed 2026-09-23  ordinary: register + talk
       Thu 2026-09-24  HERITAGE DAY: register P for everyone, no dialler file, two sales each for ten agents
       Mon 2026-08-10  Women's Day observed, BEFORE the rule: register + talk → still a shift, as August was verified */
  const out = await page.evaluate(() => {
    const S = window.__mtd.state();
    const TL = ['Leader Alpha', 'Leader Beta'];
    S.roster = []; S.att = {}; S.calls = {}; S.sales = {}; S.tracker = {}; S.orgHist = {}; S.vici = {}; S.cancRows = {}; S.viciDays = {};
    for (let i = 1; i <= 30; i++) {
      const code = 'CB' + (900000 + i), camp = i <= 15 ? 'Courtesy' : 'Cuddle';
      S.roster.push({ code, name: 'Test Agent ' + i, sf: 'Test Agent ' + i, tl: TL[i % 2], campaign: camp, tenure: 'Exp', callx: '', target: 5, start: '2026-01-01' });
    }
    const talkDay = (d, talk, status) => { S.att[d] = {}; S.calls[d] = {}; for (const a of S.roster) { S.att[d][a.code] = status || 'P'; S.calls[d][a.code] = { talk, calls: talk ? 30 : 0, ans: talk ? 15 : 0, opt: 0, saleD: 0, v: 1 }; } };
    talkDay('2026-09-22', 0, 'PH'); talkDay('2026-09-23', 3600); talkDay('2026-08-10', 3600);
    S.att['2026-09-24'] = {}; S.sales['2026-09-24'] = {};
    for (const a of S.roster) S.att['2026-09-24'][a.code] = 'P';
    for (const a of S.roster.slice(0, 10)) S.sales['2026-09-24'][a.code] = { n: 2, gwp: 198, x: 172.17 };
    S.ui.team = ''; S.ui.camp = ''; S.ui.dailyFilter = {};
    const snap = (m) => {
      const f = (d) => (m.facts || []).filter((x) => x.date === d);
      const sum = (rows, k) => rows.reduce((n, x) => n + (x[k] || 0), 0);
      const day = (d) => { const r = f(d); return { rows: r.length, emp: sum(r, 'emp'), act: sum(r, 'act'), sales: sum(r, 'sales'), gwp: sum(r, 'gwp'), target: sum(r, 'target') }; };
      const chk = (id) => (typeof VCHK !== 'undefined' && VCHK || []).find((c) => c.id === id) || null;
      return { diallingDays: m.diallingDays, dates: m.dates, days: Object.fromEntries(m.dates.map((d) => [d, day(d)])),
        grand: { sales: m.grand && m.grand.sales, act: m.grand && m.grand.act, emp: m.grand && m.grand.emp }, v25: chk('V25'), v25a: chk('V25a') };
    };
    window.__mtd.setPeriod('2026-09', 'month'); const sep = snap(window.__mtd.model());
    const digest = (typeof agentDigestPayload === 'function') ? agentDigestPayload() : null;
    const dg = digest ? { workingDays: digest.workingDays, daysWithData: digest.daysWithData, diallingDays: digest.diallingDays, extraHolidays: digest.extraHolidays } : null;
    window.__mtd.setPeriod('2026-08', 'month'); const aug = snap(window.__mtd.model());
    /* the one-off list must be READ: declare the ordinary Wednesday a holiday and rebuild */
    MTD_RULES.extraHolidays = ['2026-09-23'];
    window.__mtd.setPeriod('2026-09', 'month'); const sepExtra = snap(window.__mtd.model());
    MTD_RULES.extraHolidays = [];
    window.__mtd.setPeriod('2026-09', 'month');
    return { sep, aug, sepExtra, dg, rule: MTD_RULES.publicHolidaysFrom, satRule: MTD_RULES.saturdayShiftsFrom,
      isHol: typeof isPublicHoliday === 'function' ? [isPublicHoliday('2026-09-24'), isPublicHoliday('2026-09-23'), isPublicHoliday('2027-12-27'), isPublicHoliday('garbage')] : null };
  });

  ok('the rule is effective from 2026-09-01 (the same day as the Saturday rule)', out.rule === '2026-09-01' && out.rule === out.satRule, String(out.rule));
  ok('isPublicHoliday(): 24 Sep 2026 yes, 23 Sep no, 27 Dec 2027 (Boxing Day observed) yes, garbage no', JSON.stringify(out.isHol) === '[true,false,true,false]', JSON.stringify(out.isHol));
  const hol = out.sep.days['2026-09-24'], wed = out.sep.days['2026-09-23'], tue = out.sep.days['2026-09-22'];
  ok('Heritage Day is in the period and carries its rows (' + (hol && hol.rows) + ')', !!hol && hol.rows > 0);
  ok('its sales are counted (20 sales, ten agents × 2)', hol && hol.sales === 20, JSON.stringify(hol));
  ok('its GWP is counted', hol && hol.gwp > 0, JSON.stringify(hol));
  ok('but it contributes NO employed shifts and NO actual shifts — the 18th shift is gone', hol && hol.emp === 0 && hol.act === 0, JSON.stringify(hol));
  ok('…and no target grows out of it', hol && hol.target === 0, String(hol && hol.target));
  ok('the Wednesday is an ordinary day: 30 employed, 30 actual', wed && wed.emp === 30 && wed.act === 30, JSON.stringify(wed));
  ok('dialling days = 2 (Tue, Wed) — the holiday is not one', out.sep.diallingDays === 2, String(out.sep.diallingDays) + ' over ' + JSON.stringify(out.sep.dates));
  ok('the grand total keeps the holiday sales (20) over the two working days\' shifts (60)', out.sep.grand.sales === 20 && out.sep.grand.emp === 60, JSON.stringify(out.sep.grand));
  ok('V25 exists and passes: no Saturday or public holiday carries a shift', out.sep.v25 && out.sep.v25.ok === true && out.sep.v25.sev === 'error', JSON.stringify(out.sep.v25));
  ok('V25a exists and WARNS about the idle Tuesday (employed, nobody worked) — naming the date', out.sep.v25a && out.sep.v25a.ok === false && /2026-09-22/.test(out.sep.v25a.msg) && !/2026-09-24/.test(out.sep.v25a.msg), JSON.stringify(out.sep.v25a));
  ok('the idle Tuesday itself: 30 employed, 0 actual (that is what V25a is for)', tue && tue.emp === 30 && tue.act === 0, JSON.stringify(tue));

  console.log('\n   the digest the agent page reads');
  ok('September 2026 has 21 working days (22 weekdays less Heritage Day)', out.dg && out.dg.workingDays === 21, JSON.stringify(out.dg));
  ok('days with data run to the last fact date and skip the holiday (22nd, 23rd → 17)', out.dg && out.dg.daysWithData === 17, JSON.stringify(out.dg));
  ok('the digest carries extraHolidays for the agent page\'s own fallback', out.dg && Array.isArray(out.dg.extraHolidays), JSON.stringify(out.dg));

  console.log('\n   August, before the rule: unchanged');
  const wd = out.aug.days['2026-08-10'];
  ok('Women\'s Day observed (10 Aug) with a register still counts its shifts (30/30) — August is verified row-for-row and must not move', wd && wd.emp === 30 && wd.act === 30, JSON.stringify(wd));
  ok('August dialling days = 1', out.aug.diallingDays === 1, String(out.aug.diallingDays));

  console.log('\n   the one-off list is read, not decorative');
  const wedX = out.sepExtra.days['2026-09-23'];
  ok('with 2026-09-23 in extraHolidays the Wednesday loses its shifts (0/0)…', wedX && wedX.emp === 0 && wedX.act === 0, JSON.stringify(wedX));
  ok('…and dialling days drop to 1', out.sepExtra.diallingDays === 1, String(out.sepExtra.diallingDays));
  ok('no page errors', errs.length === 0, errs.join(' | '));
} finally {
  await b.close(); server.close();
}

/* ------------------------------------------------------------------ C. the published digest ---- */
if (LIVE) {
  console.log('\nC · THE PUBLISHED DIGEST (live)');
  const envPath = path.join(ROOT, 'supabase.env');
  if (!fs.existsSync(envPath)) ok('supabase.env is present for a --live run', false, envPath + ' missing — a live run that reads nothing must not pass');
  else {
    const env = Object.fromEntries(fs.readFileSync(envPath, 'utf8').split(/\r?\n/).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
    const H = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY };
    const r = await fetch(`${env.SUPABASE_URL}/storage/v1/object/raw/kv/agent-digest`, { headers: H });
    ok('the digest can be read (' + r.status + ')', r.ok);
    if (r.ok) {
      const D = JSON.parse(await r.text());
      const from = '2026-09-01';
      const dataOnly = (d) => d >= from && (new Date(d + 'T00:00:00Z').getUTCDay() === 6 || saHolidaysFor(+d.slice(0, 4)).includes(d));
      const agents = D.agents || [];
      ok('the digest carries agents with per-day rows (' + agents.length + ')', agents.length > 0 && Array.isArray(agents[0].days));
      const bad = [];
      for (const a of agents) for (const row of a.days || []) { const d = row.d || row.date; if (dataOnly(d) && ((row.emp || 0) > 0 || (row.act || 0) > 0)) bad.push(a.code + '@' + d); }
      ok('no agent carries a shift on a Saturday or public holiday under the rule', !bad.length, bad.length + ' row(s), e.g. ' + bad.slice(0, 5).join(', '));
      const dates = (D.dates || []).filter((d) => d >= (D.period && D.period.from) && d <= (D.period && D.period.to));
      const workable = dates.filter((d) => !dataOnly(d)).length;
      ok('dialling days (' + D.diallingDays + ') never exceed the period\'s non-holiday weekdays with data (' + workable + ')', Number(D.diallingDays) <= workable);
      ok('days with data (' + D.daysWithData + ') never exceed working days (' + D.workingDays + ')', Number(D.daysWithData) <= Number(D.workingDays));
      const holsIn = dates.filter((d) => d >= from && saHolidaysFor(+d.slice(0, 4)).includes(d));
      if (holsIn.length) {
        const emp = agents.reduce((n, a) => n + (a.days || []).filter((x) => holsIn.includes(x.d || x.date)).reduce((m, x) => m + (x.emp || 0), 0), 0);
        ok('the period\'s public holiday(s) ' + holsIn.join(', ') + ' carry 0 employed shifts across the floor', emp === 0, String(emp));
      } else console.log('  note the period carries no public holiday with data yet');
    }
  }
}

console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
process.exitCode = fail ? 1 : 0;
