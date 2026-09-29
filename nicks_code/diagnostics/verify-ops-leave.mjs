/* LEAVE IS NOT A SCHEDULED SHIFT — the Ops half of decision D1 (sprint 2026-09-29).
 *
 * Each agent-day is working | leave | absent | unavailable, from ONE code list shared by
 * PULSE and Ops (the rule book's reference_data.excused_statuses): leave AL, SL, FRL, ML, EAL
 * = the whole day; HDAL, HDSL, HDFRL = half a day (the other half worked); unavailable
 * Suspended / SUSP = the whole day. Absence: CA, CASAT, UCA, WFH and every code in no rule.
 * Ops used to call CA "Committed Absence (authorised)" and file it as leave, and it counted
 * EVERY register row as a scheduled day, so an agent on annual leave all window fired R1
 * "Zero Attendance — escalate to HR" and R3 "Attendance Risk".
 *
 * From the leaveExcusedFrom rule (2026-09-01) an excused whole day with no dialler activity and
 * no sale that day is not scheduled; a half day is half scheduled and half present; a whole day
 * WITH activity keeps its shift. August is unchanged.
 *
 * Also proves the live cb-config (which stores every rule whole, so a changed default never
 * reaches it) adopts the new list when its saved list is exactly the retired default, and
 * keeps a list someone edited by hand.
 *
 * Run: node verify-ops-leave.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
const AGENTOS = process.env.AGENTOS || decodeURIComponent(new URL('../..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1').replace(/\/$/, '');
const { chromium } = await import(pathToFileURL(path.join(AGENTOS, 'nicks_code', 'diagnostics', 'node_modules', 'playwright', 'index.mjs')).href);
const OPS = path.join(AGENTOS, 'Chatterbox_AgentOS_Analytics.html');
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + ' — ' + d); } };
const srv = http.createServer((q, s) => {
  const u = q.url.split('?')[0];
  const f = u === '/xlsx.full.min.js' ? path.join(AGENTOS, 'site', 'xlsx.full.min.js') : (u === '/' ? OPS : null);
  if (!f) { s.writeHead(404); s.end(); return; }
  s.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' });
  fs.createReadStream(f).pipe(s);
});
await new Promise(r => srv.listen(8221, '127.0.0.1', r));
const b = await chromium.launch();
const page = await b.newPage();
const errs = []; page.on('pageerror', e => errs.push(String(e.message).slice(0, 120)));
await page.goto('http://127.0.0.1:8221/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);

const out = await page.evaluate(() => {
  const SEP = { from: '2026-09-01', to: '2026-09-30' }, AUG = { from: '2026-08-01', to: '2026-08-31' };
  const day = (m, d) => '2026-' + m + '-' + String(d).padStart(2, '0');
  const att = (cb, m, d, code) => ({ employee_code: cb, status_code: code, status: code, _d: day(m, d) });
  const run = (from, n, m, cb, code) => Array.from({ length: n }, (_, i) => att(cb, m, from + i, code));
  const AG = {
    CB901: 'All Leave', CB902: 'Ca Only', CB903: 'Mixed Leave', CB904: 'Leave Worked',
    CB905: 'Half Day', CB906: 'Other Excused', CB907: 'August Leave', CB908: 'August Half',
    CB909: 'Padded Code', CB910: 'Half Sick', CB911: 'Home Worker', CB912: 'August Half Sick',
  };
  const setup = () => {
    state.filters = {};
    state.cbInfo = {}; state.sfOwnerMap = {};
    for (const cb in AG) {
      state.cbInfo[cb] = { name: AG[cb], code: cb, tl: 'TL A', queue: 'Courtesy', tenure: 'M2', target: 0.25 };
      state.sfOwnerMap[normName(AG[cb])] = cb;
    }
    state.facts.ATTENDANCE = [
      ...run(1, 10, '09', 'CB901', 'AL'),                                   // on annual leave the whole window
      ...run(1, 10, '09', 'CB902', 'CA'),                                   // committed absence is an ABSENCE
      ...run(1, 4, '09', 'CB903', 'AL'), ...run(8, 9, '09', 'CB903', 'P'), att('CB903', '09', 20, 'UCA'),
      ...run(1, 5, '09', 'CB904', 'P'), ...run(10, 3, '09', 'CB904', 'AL'), // AL on 10, 11, 12
      ...run(1, 2, '09', 'CB905', 'HDAL'), ...run(3, 8, '09', 'CB905', 'P'),
      ...run(1, 3, '09', 'CB906', 'Suspended'), ...run(4, 2, '09', 'CB906', 'FRL'), ...run(6, 2, '09', 'CB906', 'SL'),
      att('CB906', '09', 8, 'ML'), att('CB906', '09', 9, 'EAL'), att('CB906', '09', 10, 'SUSP'),
      ...run(1, 10, '08', 'CB907', 'AL'),                                   // before the effective date
      att('CB908', '08', 11, 'HDAL'), att('CB908', '08', 12, 'P'),
      att('CB909', '09', 1, ' al '), att('CB909', '09', 2, 'P'),           // a padded, lower-case code: flags and scoring agree
      att('CB910', '09', 1, 'HDSL'), att('CB910', '09', 2, 'HDFRL'), ...run(3, 4, '09', 'CB910', 'P'),
      ...run(1, 5, '09', 'CB911', 'WFH'),                                   // WFH is NOT leave — untouched
      att('CB912', '08', 11, 'HDSL'), att('CB912', '08', 12, 'P'),
    ];
    /* CB904 worked two of its three leave days: a sale on the 10th, a dialler call on the 11th. */
    state.facts.BI_ACTIVE_CASES = [{ account_number: 'A1', case_number: 'K1', owner: 'Leave Worked',
      charge_amount: 100, _d: '2026-09-10', contract_create_date: '2026-09-10' }];
    state.facts.VICI_CALL_REPORT = [{ _d: '2026-09-11', user_raw: 'CB904', user_cb: 'CB904', full_name: 'Leave Worked',
      length_in_sec: 240, lead_id: 7 }];
    state.facts.CALLX_CALL_RECORDS = []; state.facts.QA_EVALUATIONS = [];
    state.facts.SF_OPEN_CASES = []; state.facts.SF_CLOSED_CASES = [];
    bumpDataVer();
  };
  const read = (cb, win) => {
    const st = acStats(cb, win, acCtx(win)); const nba = acNBA(st);
    return { sched: st.sched, p: st.p, att: st.att, leave: st.leave, leaveWorked: st.leaveWorked, rule: nba && nba.code, label: nba && nba.label };
  };
  setup();
  const r = {};
  for (const cb of ['CB901', 'CB902', 'CB903', 'CB904', 'CB905', 'CB906', 'CB909', 'CB910', 'CB911']) r[cb] = read(cb, SEP);
  for (const cb of ['CB907', 'CB908', 'CB912']) r[cb] = read(cb, AUG);
  /* the flags every Workforce KPI reads */
  const flags = {};
  rowsFor('ATTENDANCE', SEP).concat(rowsFor('ATTENDANCE', AUG)).forEach(x => {
    flags[x.status_code] = { present: x.present_flag, leave: x.leave_flag, absence: x.absence_flag };
  });
  /* the rule is READ: move the effective date past September and the leave counts again */
  const keep = structuredClone(state.rules.leaveExcusedFrom || null);
  let moved = null;
  if (state.rules.leaveExcusedFrom) {
    state.rules.leaveExcusedFrom.vals = ['2026-10-01']; bumpDataVer();
    moved = read('CB901', SEP);
    state.rules.leaveExcusedFrom = keep; bumpDataVer();
  }
  const defaults = { leave: (DEFAULT_RULES.leaveCodes || {}).vals, label: (DEFAULT_RULES.leaveCodes || {}).label,
    help: (DEFAULT_RULES.leaveCodes || {}).help, from: (DEFAULT_RULES.leaveExcusedFrom || {}).vals };
  /* the stale live config heals; a hand-edited list is left alone */
  const saved = structuredClone(state.rules);
  const OLD = { label: 'Attendance codes that count as LEAVE (authorised)', vals: ['AL', 'SL', 'CA', 'CASAT'],
    help: 'Authorised time off: Annual, Sick, Committed Absence (+Sat). Excluded from unplanned absenteeism. Codes in NO rule count as unplanned absence (e.g. UCA).' };
  applyCfg({ rules: Object.assign(structuredClone(DEFAULT_RULES), { leaveCodes: OLD }) });
  const healed = structuredClone(state.rules.leaveCodes);
  applyCfg({ rules: Object.assign(structuredClone(DEFAULT_RULES), { leaveCodes: { label: 'mine', vals: ['AL', 'ZZ'], help: 'mine' } }) });
  const custom = structuredClone(state.rules.leaveCodes);
  state.rules = saved; __rulesHealed = false; bumpDataVer();
  return { r, flags, moved, defaults, healed, custom };
});

const { r, flags, moved, defaults, healed, custom } = out;
for (const cb in r) console.log('  ' + cb + ' ' + JSON.stringify(r[cb]));

/* the one code list — exactly the rule book's excused_statuses */
const dl = (defaults.leave || []).map(String);
const share = {}; dl.forEach(v => { const i = v.lastIndexOf(':'); share[(i > 0 ? v.slice(0, i) : v).toUpperCase()] = i > 0 ? parseFloat(v.slice(i + 1)) : 1; });
const WANT = { AL: 1, SL: 1, FRL: 1, ML: 1, EAL: 1, HDAL: 0.5, HDSL: 0.5, HDFRL: 0.5, SUSPENDED: 1, SUSP: 1 };
ok('the excused list is exactly AL SL FRL ML EAL (1), HDAL HDSL HDFRL (0.5), Suspended SUSP (1)',
  JSON.stringify(Object.keys(share).sort()) === JSON.stringify(Object.keys(WANT).sort()) && Object.keys(WANT).every(k => share[k] === WANT[k]),
  dl.join(','));
ok('CA, CASAT, UCA and WFH are not on it', ['CA', 'CASAT', 'UCA', 'WFH'].every(c => !(c in share)), dl.join(','));
ok('the rule no longer calls CA an authorised absence', !/Committed Absence/i.test(String(defaults.label) + String(defaults.help)), defaults.label);
ok('the effective date is a rule, 2026-09-01', JSON.stringify(defaults.from) === '["2026-09-01"]', JSON.stringify(defaults.from));

/* the flags */
ok('CA and CASAT-style committed absence is an absence, not leave', flags.CA && flags.CA.absence === 1 && flags.CA.leave === 0, JSON.stringify(flags.CA));
ok('UCA is an absence', flags.UCA && flags.UCA.absence === 1, JSON.stringify(flags.UCA));
ok('WFH is untouched: not leave, still an absence', flags.WFH && flags.WFH.leave === 0 && flags.WFH.absence === 1, JSON.stringify(flags.WFH));
const EXC = ['AL', 'SL', 'FRL', 'ML', 'EAL', 'Suspended', 'SUSP', 'HDSL', 'HDFRL'];
ok('AL, SL, FRL, ML, EAL, Suspended, SUSP, HDSL, HDFRL are leave, not absence',
  EXC.every(c => flags[c] && flags[c].leave === 1 && flags[c].absence === 0),
  JSON.stringify(Object.fromEntries(EXC.map(c => [c, flags[c]]))));
ok('HDAL stays present (the half the agent worked)', flags.HDAL && flags.HDAL.present === 1 && flags.HDAL.absence === 0, JSON.stringify(flags.HDAL));
ok('a padded, lower-case " al " is flagged leave, not absence', flags[' al '] && flags[' al '].leave === 1 && flags[' al '].absence === 0, JSON.stringify(flags[' al ']));

/* scoring */
ok('all-AL agent: no scheduled day, no attendance figure', r.CB901.sched === 0 && r.CB901.p === 0 && r.CB901.att === null, JSON.stringify(r.CB901));
ok('all-AL agent: neither R1 nor R3 fires from leave alone', !['R1', 'R3'].includes(r.CB901.rule), r.CB901.rule + ' ' + r.CB901.label);
ok('all-AL agent: the ten leave days are counted as leave', r.CB901.leave === 10, String(r.CB901.leave));
ok('all-AL agent: the card says "On leave", not "No data — a gap in the data"', r.CB901.label === 'On leave this period', r.CB901.label);
ok('CA-only agent still fires R1 Zero Attendance', r.CB902.rule === 'R1' && r.CB902.sched === 10, JSON.stringify(r.CB902));
ok('WFH-only agent is untouched: 5 scheduled, R1 as before', r.CB911.sched === 5 && r.CB911.leave === 0 && r.CB911.rule === 'R1', JSON.stringify(r.CB911));
ok('mixed AL + present: attendance over the non-leave days (9 of 10, not 9 of 14)',
  r.CB903.sched === 10 && r.CB903.p === 9 && Math.abs(r.CB903.att - 90) < 1e-9, JSON.stringify(r.CB903));
ok('mixed AL + present: R3 does not fire at 90%', r.CB903.rule !== 'R3', r.CB903.rule);
ok('a leave day WITH a sale or a call keeps its shift; the idle one is excused',
  r.CB904.sched === 7 && r.CB904.p === 5 && r.CB904.leave === 1 && r.CB904.leaveWorked === 2, JSON.stringify(r.CB904));
ok('HDAL counts half: 2 half days + 8 present = 9 scheduled, 9 present',
  r.CB905.sched === 9 && r.CB905.p === 9 && Math.abs(r.CB905.att - 100) < 1e-9 && r.CB905.leave === 1, JSON.stringify(r.CB905));
ok('HDSL / HDFRL count half too, and the worked half is present though neither is a present code',
  r.CB910.sched === 5 && r.CB910.p === 5 && r.CB910.leave === 1, JSON.stringify(r.CB910));
ok('Suspended, SUSP, FRL, SL, ML and EAL are excused too', r.CB906.sched === 0 && !['R1', 'R3'].includes(r.CB906.rule) && r.CB906.leave === 10, JSON.stringify(r.CB906));
ok('the scorer reads a padded code the way the flags do: excused, one scheduled day left', r.CB909.sched === 1 && r.CB909.leave === 1, JSON.stringify(r.CB909));
ok('August is unchanged: ten AL days still schedule 10 and fire R1', r.CB907.sched === 10 && r.CB907.p === 0 && r.CB907.rule === 'R1', JSON.stringify(r.CB907));
ok('August is unchanged: nothing is counted as leave', !r.CB907.leave && !r.CB908.leave && !r.CB912.leave, [r.CB907.leave, r.CB908.leave, r.CB912.leave].join(' / '));
ok('August is unchanged: an HDAL is still a whole scheduled, present day', r.CB908.sched === 2 && r.CB908.p === 2, JSON.stringify(r.CB908));
ok('August is unchanged: an HDSL is still a whole scheduled, non-present day', r.CB912.sched === 2 && r.CB912.p === 1, JSON.stringify(r.CB912));
ok('the effective date is READ: moved to October, September leave schedules again and R1 fires',
  moved && moved.sched === 10 && moved.rule === 'R1', JSON.stringify(moved));

/* the stale live config */
ok('a saved config holding the retired list adopts the new one', healed && healed.vals.includes('SUSP') && !healed.vals.includes('CA'), JSON.stringify(healed && healed.vals));
ok('...with the new label and help', healed && !/Committed Absence/i.test(healed.label + healed.help), healed && healed.label);
ok('a hand-edited list is kept', custom && JSON.stringify(custom.vals) === '["AL","ZZ"]', JSON.stringify(custom && custom.vals));
ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
await b.close(); srv.close();
process.exit(fail ? 1 : 0);
