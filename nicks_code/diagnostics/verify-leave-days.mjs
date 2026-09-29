#!/usr/bin/env node
/**
 * verify-leave-days.mjs — an excused day is data, not a shift, PER AGENT (D1, sprint 2026-09-29).
 *
 *   node nicks_code/diagnostics/verify-leave-days.mjs
 *
 * Ryan's UAT finding (specs/sprint-2026-09-29.md item 1): annual leave was weighted exactly like an
 * unplanned absence. The fact builder kept emp = 1 on a leave day, so the agent's TARGET grew by a day
 * they were never meant to work and their ATTENDANCE fell. Decision D1: each agent-day is
 * working | leave | absent | unavailable.
 *   · Leave (excused): AL, SL, FRL → the whole day; HDAL → half a day.
 *   · Unavailable (excused): Suspended (the register's own code is SUSP) → the whole day.
 *   · Absence: CA, UCA and every other code — unchanged.
 * An excused day with NO talk and NO sales leaves the Employed count exactly like a Saturday or a public
 * holiday, but per agent: emp reduced by the excused share, act never above emp, target = perDay × emp,
 * Attendance (act ÷ emp) and SPD (sales ÷ act) untouched by the leave. An excused day WITH activity keeps
 * its shift and raises rule check V26 (warn). Effective from 2026-09-01 (rule excusedStatusFrom) so
 * August never moves. An agent on leave for the WHOLE period stays in the head count and the digest.
 *
 * Runs the REAL engine (nicks_code/index.html) headlessly over a synthetic floor — no credentials.
 *   A. the rule book: both copies agree, the helper sits beside dataOnlyDay (floor-wide callers untouched)
 *   B. the engine: every code, both shift sources, conflicts, August, a Saturday, the rule is READ
 *   C. head count + the published digest (leave, lv — the exact shape the agent page reads)
 */
import fs from 'node:fs'; import path from 'node:path'; import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (d ? ' — ' + d : '')); } };

/* ------------------------------------------------------------------ A. the rule book ---- */
console.log('\nA · THE RULE BOOK: TWO COPIES, ONE RULE');
const HTML = path.join(ROOT, 'nicks_code', 'index.html');
const PULSE = fs.readFileSync(HTML, 'utf8');
const SPEC = JSON.parse(fs.readFileSync(path.join(ROOT, 'specs', 'mtd_engine_rules.json'), 'utf8'));
const inlined = (() => { const i = PULSE.indexOf('const MTD_RULES = {'); const end = PULSE.indexOf('\n};', i);
  return eval('(' + PULSE.slice(i + 'const MTD_RULES = '.length, end + 2) + ')'); })();
const ex = (SPEC.reference_data || {}).excused_statuses || null;
ok('the spec carries reference_data.excused_statuses', !!ex);
ok('the inline MTD_RULES carries excusedStatusFrom + excusedStatuses', !!inlined.excusedStatusFrom && !!inlined.excusedStatuses);
ok('effective date matches (spec data_only_from = MTD_RULES.excusedStatusFrom = 2026-09-01)',
  ex && ex.data_only_from === inlined.excusedStatusFrom && inlined.excusedStatusFrom === '2026-09-01',
  JSON.stringify([ex && ex.data_only_from, inlined.excusedStatusFrom]));
/* D1 extended the same day to the register's other leave types (ML maternity, EAL, and the half-day
   HDSL/HDFRL) — each a dated _changes[] entry in the spec */
ok('the leave codes and shares match (AL/SL/FRL/ML/EAL 1, HDAL/HDSL/HDFRL 0.5)',
  ex && JSON.stringify(ex.leave) === JSON.stringify((inlined.excusedStatuses || {}).leave)
    && JSON.stringify((inlined.excusedStatuses || {}).leave) === JSON.stringify({ AL: 1, SL: 1, FRL: 1, HDAL: 0.5, ML: 1, EAL: 1, HDSL: 0.5, HDFRL: 0.5 }),
  JSON.stringify([ex && ex.leave, (inlined.excusedStatuses || {}).leave]));
ok('the unavailable codes match (Suspended 1, and the register\'s own spelling SUSP 1)',
  ex && JSON.stringify(ex.unavailable) === JSON.stringify((inlined.excusedStatuses || {}).unavailable)
    && JSON.stringify((inlined.excusedStatuses || {}).unavailable) === JSON.stringify({ Suspended: 1, SUSP: 1 }),
  JSON.stringify([ex && ex.unavailable, (inlined.excusedStatuses || {}).unavailable]));
ok('CA and UCA are named absences, never excused', ex && Array.isArray(ex.absence) && ex.absence.includes('CA') && ex.absence.includes('UCA')
  && !['CA', 'UCA'].some((c) => c in ((inlined.excusedStatuses || {}).leave || {}) || c in ((inlined.excusedStatuses || {}).unavailable || {})));
ok('the attendance shift weights are untouched (still no HDAL weight — the leave rule owns it)', !('HDAL' in inlined.attWeights) && inlined.attWeights.AL === 0);
ok('the rule book records the change in _changes[] with a date',
  (SPEC._changes || []).some((c) => c.key === 'reference_data.excused_statuses' && /^\d{4}-\d{2}-\d{2}$/.test(c.date)));
ok('dataOnlyDay() is still the ONE floor-wide decision (code-free)', /function dataOnlyDay\(d\)\{ return saturdayDataOnly\(d\)\|\|publicHolidayDataOnly\(d\); \}/.test(PULSE));
ok('the per-agent helper excusedShare(d,status) sits beside it', /function excusedShare\(d,st\)\{/.test(PULSE)
  && PULSE.indexOf('function excusedShare(d,st){') > PULSE.indexOf('function dataOnlyDay(d)') && PULSE.indexOf('function excusedShare(d,st){') - PULSE.indexOf('function dataOnlyDay(d)') < 4000);
ok('the helper READS the rule (no copied date or code list in the engine)', /MTD_RULES\.excusedStatusFrom/.test(PULSE) && /MTD_RULES\.excusedStatuses/.test(PULSE)
  && !/['"]HDAL['"]\s*:\s*0\.5/.test(PULSE.slice(PULSE.indexOf('function excusedShare(d,st){'))));

/* ------------------------------------------------------------------ B. the engine ---- */
console.log('\nB · THE ENGINE: AN EXCUSED DAY IS DATA, NOT A SHIFT — PER AGENT');
const SERVE = { '/': HTML, '/index.html': HTML, '/xlsx.full.min.js': path.join(ROOT, 'site', 'xlsx.full.min.js') };
const server = http.createServer((q, s) => { const p = SERVE[q.url.split('?')[0]];
  if (!p || !fs.existsSync(p)) { s.writeHead(404); s.end(); return; }
  s.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' }); fs.createReadStream(p).pipe(s); });
await new Promise((r) => server.listen(8263, '127.0.0.1', r));
const { chromium } = await import(pathToFileURL(path.join(HERE, 'node_modules', 'playwright', 'index.mjs')).href);
const b = await chromium.launch();
try {
  const page = await b.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
  await page.goto('http://127.0.0.1:8263/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__mtd && window.__mtd.state(), null, { timeout: 30000 });

  /* THE FLOOR. Three September weekdays — Tue 8, Wed 9, Thu 10 — plus Sat 12 (a register row, some sales);
     two August weekdays — Tue 11, Wed 12 — before the rule. Everyone Present and dialling unless the case
     says otherwise; the case's status sits on the MIDDLE day (Wed 9 Sep / Wed 12 Aug).
       Courtesy = dialler-derived shifts (act = talk>0), Cuddle = HR-register shifts. */
  const CASES = {
    // code        campaign     Wed status   talk   sales   (other days: P, talk, no sales)
    C_AL:       ['Courtesy', 'AL',        0,    0],
    C_SL:       ['Courtesy', 'SL',        0,    0],
    C_FRL:      ['Courtesy', 'FRL',       0,    0],
    C_SUSPW:    ['Courtesy', 'Suspended', 0,    0],
    C_SUSP:     ['Courtesy', 'SUSP',      0,    0],
    C_HDALT:    ['Courtesy', 'HDAL',   3600,    0],
    C_HDAL0:    ['Courtesy', 'HDAL',      0,    0],
    C_CA:       ['Courtesy', 'CA',        0,    0],
    C_UCA:      ['Courtesy', 'UCA',       0,    0],
    C_ALTALK:   ['Courtesy', 'AL',     3600,    0],
    C_ALSALE:   ['Courtesy', 'AL',        0,    1],
    C_CTRL:     ['Courtesy', 'P',      3600,    0],
    C_ALLLEAVE: ['Courtesy', 'AL*',       0,    0],   // AL on every day of the period, no activity at all
    K_AL:       ['Cuddle',   'AL',        0,    0],
    K_HDAL:     ['Cuddle',   'HDAL',      0,    0],
    K_ALSALE:   ['Cuddle',   'AL',        0,    1],
    K_CTRL:     ['Cuddle',   'P',         0,    0],
    K_SLALL:    ['Cuddle',   'SL*',       0,    0],   // CB143-style: sick leave all period, zero talk, zero sales
  };
  const out = await page.evaluate(({ CASES }) => {
    const S = window.__mtd.state();
    const code = (k) => 'CB' + (910000 + Object.keys(CASES).indexOf(k) + 1);
    const SEP = ['2026-09-08', '2026-09-09', '2026-09-10'], SAT = '2026-09-12', AUG = ['2026-08-11', '2026-08-12'];
    const MID = { '2026-09-09': 1, '2026-08-12': 1 };
    const load = (opts) => {
      opts = opts || {};
      S.roster = []; S.att = {}; S.calls = {}; S.sales = {}; S.tracker = {}; S.orgHist = {}; S.vici = {}; S.cancRows = {}; S.viciDays = {};
      for (const k of Object.keys(CASES)) {
        const [camp] = CASES[k];
        S.roster.push({ code: code(k), name: 'Leave ' + k, sf: 'Leave ' + k, tl: camp === 'Cuddle' ? 'Leader Kappa' : 'Leader Gamma',
          campaign: camp, tenure: 'Exp', callx: '', target: camp === 'Cuddle' ? 8 : 5, start: '2026-01-01' });
      }
      for (const d of [...SEP, SAT, ...AUG]) {
        if (opts.dropDay && d === opts.dropDay) continue;
        S.att[d] = {}; S.calls[d] = {}; S.sales[d] = {};
        for (const k of Object.keys(CASES)) {
          const [camp, st, talk, sales] = CASES[k], c = code(k);
          const allPeriod = /\*$/.test(st);
          let status = 'P', t = 3600, n = 0;
          if (allPeriod) { status = st.slice(0, -1); t = 0; }
          else if (MID[d]) { status = st; t = talk; n = sales; }
          if (d === SAT) { status = k === 'C_AL' ? 'AL' : status; t = 0; n = k === 'C_CTRL' ? 2 : 0; }   // a Saturday: C_AL marked AL, the control sells
          if (camp === 'Cuddle' && d !== SAT) t = allPeriod ? 0 : 1800;
          if (camp === 'Cuddle' && MID[d] && !allPeriod) t = talk;   // Cuddle's Wednesday talk follows the case
          S.att[d][c] = status;
          S.calls[d][c] = { talk: t, calls: t ? 30 : 0, ans: t ? 15 : 0, opt: 0, saleD: 0, v: 1 };
          if (n) S.sales[d][c] = { n, gwp: 99 * n, x: 86.09 * n };
        }
      }
      S.ui.team = ''; S.ui.camp = ''; S.ui.dailyFilter = {};
    };
    const snapAgents = (m) => {
      const o = {};
      for (const k of Object.keys(CASES)) {
        const c = code(k), camp = CASES[k][0];
        const rows = (m.facts || []).filter((f) => f.code === c && !f.rangeAgg);
        const day = {}; for (const f of rows) day[f.date] = { emp: f.emp, act: f.act, target: f.target, sales: f.sales, leave: f.leave, flag: f.leaveActive || '' };
        const g = ((m.mtdCC || {})[camp] || {})[c] || null;
        o[k] = { day, inAgents: (m.agents || []).some((a) => a.code === c),
          g: g ? { emp: g.emp, act: g.act, target: g.target, sales: g.sales, att: g.att, spd: g.spd, pctT: g.pctT, leave: g.leave } : null };
      }
      return o;
    };
    const chk = (id) => ((typeof VCHK !== 'undefined' && VCHK) || []).find((c) => c.id === id) || null;

    load(); window.__mtd.setPeriod('2026-09', 'month');
    const m = window.__mtd.model();
    const sep = snapAgents(m);
    const hc = { Courtesy: (m.campAgg.Courtesy || {}).hc, Cuddle: (m.campAgg.Cuddle || {}).hc,
      tl: Object.fromEntries(Object.entries(m.tlAgg || {}).map(([k, v]) => [k, v.hc])) };
    const grand = { emp: m.grand.emp, act: m.grand.act, sales: m.grand.sales, target: m.grand.target, leave: m.grand.leave };
    const v26 = chk('V26'), v25 = chk('V25'), v25a = chk('V25a'), v02 = chk('V02');
    const digest = agentDigestPayload();
    const dg = {};
    for (const k of Object.keys(CASES)) { const r = (digest.agents || []).find((a) => a.code === code(k)); dg[k] = r ? { hasLeave: 'leave' in r, leave: r.leave, target: r.target, emp: r.emp, act: r.act, pctT: r.pctT, days: r.days } : null; }
    const notCovered = (digest.notCovered || []).map((x) => x.code);

    /* the rule switched off (a date nobody has reached) — what the engine did before D1 */
    const keepFrom = MTD_RULES.excusedStatusFrom;
    MTD_RULES.excusedStatusFrom = '2099-01-01'; window.__mtd.setPeriod('2026-09', 'month'); const sepOff = snapAgents(window.__mtd.model());
    MTD_RULES.excusedStatusFrom = keepFrom;
    /* the code list is READ: with AL taken out of it, annual leave is an absence again */
    const ES = MTD_RULES.excusedStatuses || { leave: {} }, keepLeave = ES.leave || {};   // guarded so a build without the rule reports FAILs, not a crash
    ES.leave = Object.fromEntries(Object.entries(keepLeave).filter(([c]) => c !== 'AL'));
    window.__mtd.setPeriod('2026-09', 'month'); const sepNoAL = snapAgents(window.__mtd.model());
    ES.leave = keepLeave;
    /* the same month WITHOUT the leave day at all, to prove Attendance / SPD are untouched by it */
    load({ dropDay: '2026-09-09' }); window.__mtd.setPeriod('2026-09', 'month'); const sepNoWed = snapAgents(window.__mtd.model());
    /* August, before the rule: rule on vs rule off must be identical */
    load(); window.__mtd.setPeriod('2026-08', 'month'); const aug = snapAgents(window.__mtd.model());
    const augV26 = chk('V26');
    MTD_RULES.excusedStatusFrom = '2099-01-01'; window.__mtd.setPeriod('2026-08', 'month'); const augOff = snapAgents(window.__mtd.model());
    MTD_RULES.excusedStatusFrom = keepFrom; window.__mtd.setPeriod('2026-09', 'month');
    return { codes: Object.fromEntries(Object.keys(CASES).map((k) => [k, code(k)])), sep, sepOff, sepNoAL, sepNoWed, aug, augOff, augV26,
      hc, grand, v26, v25, v25a, v02, dg, notCovered, perDay: { Courtesy: 5, Cuddle: 8 } };
  }, { CASES });

  const W = '2026-09-09', AW = '2026-08-12';
  const d = (k, date) => ((out.sep[k] || {}).day || {})[date || W] || null;
  const dOff = (k, date) => ((out.sepOff[k] || {}).day || {})[date || W] || null;
  const J = JSON.stringify;

  console.log('\n   full-day leave, no activity → out of Employed; target shrinks by one day; Attendance unmoved');
  for (const k of ['C_AL', 'C_SL', 'C_FRL', 'C_SUSPW', 'C_SUSP', 'K_AL']) {
    const x = d(k), a = out.sep[k].g, off = out.sepOff[k].g, nw = out.sepNoWed[k].g, pd = out.perDay[k.startsWith('K_') ? 'Cuddle' : 'Courtesy'];
    ok(k + ': the leave day keeps its row with emp 0, act 0, target 0, leave 1', x && x.emp === 0 && x.act === 0 && x.target === 0 && x.leave === 1, J(x));
    ok(k + ': the month\'s target is one day\'s target (' + pd + ') smaller than before the rule', a && off && Math.abs((off.target - a.target) - pd) < 1e-9, J([a && a.target, off && off.target]));
    ok(k + ': Employed Shifts 2 (not 3), Actual 2, leave 1 on the month', a && a.emp === 2 && a.act === 2 && a.leave === 1, J(a));
    ok(k + ': Attendance, SPD and target equal the same month without that day', a && nw && a.att === nw.att && a.spd === nw.spd && a.target === nw.target && a.emp === nw.emp && a.act === nw.act, J([a, nw]));
    ok(k + ': Attendance is 100% — the leave day is not an absence (before the rule it read ' + (off && off.att != null ? Math.round(off.att * 1000) / 10 + '%' : '?') + ')', a && a.att === 1 && off && off.att < 1, J([a && a.att, off && off.att]));
  }

  console.log('\n   half-day annual leave (HDAL) → half a shift');
  { const x = d('C_HDALT'), a = out.sep.C_HDALT.g;
    ok('Courtesy HDAL with talk: emp 0.5, act 0.5 (dialler act 1 clamped to emp), leave 0.5, target half a day', x && x.emp === 0.5 && x.act === 0.5 && x.leave === 0.5 && x.target === 2.5, J(x));
    ok('…a half day worked is no conflict (V26 does not name it)', x && !x.flag && !(out.v26 && out.v26.msg.includes(out.codes.C_HDALT)), J(x));
    ok('…month: emp 2.5, act 2.5, attendance 100%', a && a.emp === 2.5 && a.act === 2.5 && a.att === 1, J(a)); }
  { const x = d('C_HDAL0');
    ok('Courtesy HDAL with no talk: emp 0.5, act 0 (did not work the other half), leave 0.5', x && x.emp === 0.5 && x.act === 0 && x.leave === 0.5, J(x)); }
  { const x = d('K_HDAL');
    ok('Cuddle HDAL (register-based): emp 0.5, act 0.5 — the register says half a day worked', x && x.emp === 0.5 && x.act === 0.5 && x.leave === 0.5 && x.target === 4, J(x)); }

  console.log('\n   absence stays absence');
  for (const k of ['C_CA', 'C_UCA']) {
    const x = d(k), y = dOff(k);
    ok(k + ': still an Employed Shift with no Actual (emp 1, act 0, leave 0) — identical to before the rule', x && x.emp === 1 && x.act === 0 && !x.leave && J(x) === J(y), J([x, y]));
    ok(k + ': month target unchanged (15)', out.sep[k].g && out.sep[k].g.target === 15, J(out.sep[k].g)); }

  console.log('\n   a leave-marked day WITH activity keeps its shift and is flagged (V26)');
  { const x = d('C_ALTALK'), y = dOff('C_ALTALK');
    ok('Courtesy AL with talk: emp 1, act 1, no leave — unchanged from before the rule', x && x.emp === 1 && x.act === 1 && !x.leave && x.emp === y.emp && x.act === y.act && x.target === y.target, J([x, y]));
    ok('…and the row is flagged with its code', x && x.flag === 'AL', J(x)); }
  { const x = d('C_ALSALE'), y = dOff('C_ALSALE');
    ok('Courtesy AL with a sale (no talk): keeps emp 1 / act 0 exactly as before, no leave, flagged', x && x.emp === y.emp && x.act === y.act && x.emp === 1 && !x.leave && x.flag === 'AL' && x.sales === 1, J([x, y])); }
  { const x = d('K_ALSALE'), y = dOff('K_ALSALE');
    ok('Cuddle AL with a sale: keeps emp 1 / act 0 exactly as before, no leave, flagged', x && x.emp === y.emp && x.act === y.act && x.emp === 1 && !x.leave && x.flag === 'AL', J([x, y])); }
  ok('V26 exists, is a WARNING and fails on this floor', out.v26 && out.v26.sev === 'warn' && out.v26.ok === false, J(out.v26));
  ok('V26 names the three conflicting agent-days (and only those)', out.v26 && /^3 /.test(out.v26.msg)
    && [out.codes.C_ALTALK, out.codes.C_ALSALE, out.codes.K_ALSALE].every((c) => out.v26.msg.includes(c))
    && ![out.codes.C_AL, out.codes.C_HDALT, out.codes.C_CTRL].some((c) => out.v26.msg.includes(c + ' ')), J(out.v26));
  ok('no error-severity rule breaks on the leave floor (V02 one-or-zero, V25 no Saturday shift)', out.v02 && out.v02.ok && out.v25 && out.v25.ok, J([out.v02, out.v25]));
  ok('act never exceeds emp on any agent-day', Object.values(out.sep).every((a) => Object.values(a.day).every((x) => x.act <= x.emp + 1e-9)));

  console.log('\n   the rule is READ, not decorative');
  { const x = out.sepNoAL.C_AL.day[W], y = out.sepNoAL.C_SL.day[W];
    ok('with AL taken out of MTD_RULES.excusedStatuses, AL is an absence again (emp 1) while SL stays excused', x && x.emp === 1 && !x.leave && y && y.emp === 0 && y.leave === 1, J([x, y])); }
  ok('with excusedStatusFrom moved past the period, every leave day is an Employed Shift again', dOff('C_AL').emp === 1 && dOff('K_AL').emp === 1 && dOff('C_HDALT').emp === 1, J([dOff('C_AL'), dOff('K_AL')]));

  console.log('\n   a Saturday is still the floor\'s rule, not leave');
  { const s = d('C_AL', '2026-09-12');
    ok('C_AL marked AL on Saturday 12 Sep: no row or a row with no leave — a Saturday is never a leave day', !s || (!s.leave && s.emp === 0), J(s));
    ok('…so C_AL\'s month counts ONE leave day, not two', out.sep.C_AL.g && out.sep.C_AL.g.leave === 1, J(out.sep.C_AL.g)); }

  console.log('\n   on leave for the WHOLE period');
  for (const k of ['C_ALLLEAVE', 'K_SLALL']) {
    const a = out.sep[k];
    ok(k + ': still in the model\'s agents (not dropped with their fact rows)', a.inAgents, J(a));
    ok(k + ': 3 leave days, 0 Employed, 0 Actual, no target', a.g && a.g.leave === 3 && a.g.emp === 0 && a.g.act === 0 && a.g.target === 0 && a.g.pctT == null, J(a.g)); }
  ok('head count keeps them: Courtesy HC = every Courtesy agent (13)', out.hc.Courtesy === 13, J(out.hc));
  ok('head count keeps them: Cuddle HC = every Cuddle agent (5 — CB143-style sick leave all period IS counted)', out.hc.Cuddle === 5, J(out.hc));
  ok('the team-leader rollups keep them too', out.hc.tl['Courtesy|Leader Gamma'] === 13 && out.hc.tl['Cuddle|Leader Kappa'] === 5, J(out.hc.tl));

  console.log('\n   August, before the rule: unchanged');
  ok('every August agent-day is identical with the rule on and off', J(out.aug) === J(out.augOff));
  { const x = out.aug.C_AL.day[AW], h = out.aug.C_HDALT.day[AW];
    ok('August AL is still an Employed Shift with no Actual (emp 1, act 0, no leave)', x && x.emp === 1 && x.act === 0 && !x.leave, J(x));
    ok('August HDAL is still an ordinary day (emp 1)', h && h.emp === 1 && !h.leave, J(h)); }
  ok('August raises no V26 (the rule does not reach it)', !out.augV26 || out.augV26.ok, J(out.augV26));

  /* ------------------------------------------------------------------ C. the digest ---- */
  console.log('\nC · THE PUBLISHED DIGEST (the shape Agent Analytics reads)');
  const dg = out.dg;
  ok('C_AL carries leave: 1', dg.C_AL && dg.C_AL.leave === 1, J(dg.C_AL && dg.C_AL.leave));
  { const days = (dg.C_AL && dg.C_AL.days) || [];
    const wed = days.find((x) => x.d === W), others = days.filter((x) => x.d !== W);
    ok('…its Wednesday entry carries lv: 1 and the day stays in days[]', wed && wed.lv === 1 && wed.emp === 0 && wed.t === 0, J(wed));
    ok('…no other day carries an lv key', others.length > 0 && others.every((x) => !('lv' in x)), J(others)); }
  { const wed = ((dg.C_HDALT && dg.C_HDALT.days) || []).find((x) => x.d === W);
    ok('HDAL: leave 0.5 and lv 0.5', dg.C_HDALT && dg.C_HDALT.leave === 0.5 && wed && wed.lv === 0.5, J([dg.C_HDALT && dg.C_HDALT.leave, wed])); }
  ok('an agent with no excused day carries NO leave key (payload stays small)', dg.C_CTRL && !dg.C_CTRL.hasLeave && dg.C_CA && !dg.C_CA.hasLeave && dg.K_CTRL && !dg.K_CTRL.hasLeave, J([dg.C_CTRL, dg.C_CA].map((x) => x && x.hasLeave)));
  ok('…and none of their days carries lv', [dg.C_CTRL, dg.C_CA, dg.C_UCA].every((r) => r && r.days.every((x) => !('lv' in x))));
  ok('a flagged (worked) leave day carries no leave and no lv', dg.C_ALTALK && !dg.C_ALTALK.hasLeave && dg.C_ALTALK.days.every((x) => !('lv' in x)), J(dg.C_ALTALK));
  for (const k of ['C_ALLLEAVE', 'K_SLALL']) {
    const r = dg[k];
    ok(k + ': in the digest with leave 3, target 0, emp 0, no % to target', r && r.leave === 3 && r.target === 0 && r.emp === 0 && r.pctT == null, J(r && { leave: r.leave, target: r.target, emp: r.emp, pctT: r.pctT }));
    ok(k + ': every one of their days carries lv 1', r && r.days.length === 3 && r.days.every((x) => x.lv === 1), J(r && r.days));
    ok(k + ': not pushed into notCovered', !out.notCovered.includes(out.codes[k])); }
  ok('no page errors', errs.length === 0, errs.join(' | '));
} finally {
  await b.close(); server.close();
}

console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
process.exitCode = fail ? 1 : 0;
