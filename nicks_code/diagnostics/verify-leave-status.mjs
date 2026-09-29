#!/usr/bin/env node
/**
 * verify-leave-status.mjs — working, on leave, absent or unavailable: decided BEFORE anything is scored.
 *
 *   node nicks_code/diagnostics/verify-leave-status.mjs
 *
 * POC feedback, 2026-09-29: "Ryan to investigate why agents who were on annual leave were not
 * reflected correctly. AgentOS must understand whether an agent was working, on leave, absent or
 * otherwise unavailable before calculating performance or recommending actions."
 *
 * Why they were not: every register code weighing 0 (AL, SL, FRL, CA, UCA, Suspended …) stayed an
 * EMPLOYED shift with no ACTUAL shift. A week of annual leave therefore read exactly like a week of
 * no-shows — attendance fell, the target grew by the leave days, Agent Analytics counted them as
 * days still to come, and in Ops the NBA ladder could fire R1 "Zero Attendance — escalate to HR"
 * for someone on approved leave.
 *
 * A · PULSE (nicks_code/index.html), the REAL engine over a synthetic September floor (rule
 *     leaveNotShiftFrom = 2026-09-01): leave / unavailable days with no activity are not shifts and
 *     carry no target; UCA stays an absence; a leave code on a day with talk is a working day; an
 *     agent on leave all period is "leave" in the digest, not "no data". August is untouched.
 * B · Ops (Chatterbox_AgentOS_Analytics.html) acStats / acNBA: $leaveCodes days leave the attendance
 *     denominator; an unplanned absence still counts; a whole window of leave reads "On leave this
 *     period", never R1.
 */
import fs from 'node:fs'; import path from 'node:path'; import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const { chromium } = await import(pathToFileURL(path.join(HERE, 'node_modules', 'playwright', 'index.mjs')).href);
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (d ? ' — ' + d : '')); } };

const PULSE = path.join(ROOT, 'nicks_code', 'index.html'), OPS = path.join(ROOT, 'Chatterbox_AgentOS_Analytics.html');
const SERVE = { '/pulse.html': PULSE, '/ops.html': OPS, '/xlsx.full.min.js': path.join(ROOT, 'site', 'xlsx.full.min.js') };
const server = http.createServer((q, s) => { const p = SERVE[q.url.split('?')[0]];
  if (!p || !fs.existsSync(p)) { s.writeHead(404); s.end(); return; }
  s.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' }); fs.createReadStream(p).pipe(s); });
await new Promise((r) => server.listen(8261, '127.0.0.1', r));
const b = await chromium.launch();
try {
  /* ═══ A · PULSE ═══ */
  const page = await b.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
  await page.goto('http://127.0.0.1:8261/pulse.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__mtd && window.__mtd.state(), null, { timeout: 30000 });

  const out = await page.evaluate(() => {
    const S = window.__mtd.state();
    S.roster = []; S.att = {}; S.calls = {}; S.sales = {}; S.tracker = {}; S.orgHist = {}; S.vici = {}; S.cancRows = {}; S.viciDays = {};
    const add = (code, camp) => S.roster.push({ code, name: 'Agent ' + code, sf: 'Agent ' + code, tl: 'Leader Alpha', campaign: camp, tenure: camp === 'Cuddle' ? 'Exp' : 'M1', callx: '', target: 0, start: '2026-01-01' });
    /* five extra present agents so the floor looks like a floor */
    ['CB801', 'CB802', 'CB803', 'CB804'].forEach((c) => add(c, 'Courtesy')); ['CB805', 'CB806', 'CB807'].forEach((c) => add(c, 'Cuddle')); add('CB808', 'Courtesy');
    for (let i = 1; i <= 5; i++) add('CB81' + i, 'Courtesy');
    const SEP = ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11'];
    const AUG = ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07'];
    /* who is what, per day index 0..4 */
    const plan = {
      CB801: ['P', 'P', 'P', 'P', 'P'],                // baseline: works every day
      CB802: ['AL', 'AL', 'AL', 'P', 'P'],             // three days annual leave
      CB803: ['UCA', 'P', 'P', 'P', 'P'],              // one unplanned absence — still an absence
      CB804: ['AL', 'P', 'P', 'P', 'P'],               // on leave by the register, but dialled Monday
      CB805: ['SL', 'SL', 'SL', 'SL', 'SL'],           // sick the whole week — nothing to score
      CB806: ['Suspended', 'Suspended', 'P', 'P', 'P'],// unavailable two days
      CB807: ['L', 'L', 'P', 'P', 'P'],                // Cuddle (register rule): two half days
      CB808: ['L', 'P', 'P', 'P', 'P'],                // Courtesy (dialler rule): one half day, dialled
    };
    for (const days of [SEP, AUG]) days.forEach((d, i) => {
      S.att[d] = {}; S.calls[d] = {}; S.sales[d] = {};
      for (const a of S.roster) {
        const st = (plan[a.code] || ['P', 'P', 'P', 'P', 'P'])[i];
        S.att[d][a.code] = st;
        const talks = st === 'P' || st === 'L' || (a.code === 'CB804' && i === 0);
        if (talks) S.calls[d][a.code] = { talk: 3600, calls: 30, ans: 15, opt: 0, saleD: 0, v: 1 };
        if (talks) S.sales[d][a.code] = { n: 1, gwp: 89, gwpEx: 77.39 };
      }
    });
    S.ui.team = ''; S.ui.camp = '';
    window.__mtd.rebuild();
    const snap = () => {
      const m = window.__mtd.model();
      const per = {};
      for (const c of Object.keys(plan)) {
        const rows = (m.facts || []).filter((f) => f.code === c);
        const sum = (k) => rows.reduce((n, f) => n + (f[k] || 0), 0);
        per[c] = { emp: sum('emp'), act: sum('act'), target: sum('target'), sales: sum('sales'), rows: rows.length,
          off: (m.offBy && m.offBy[c] || []).map((o) => o.k) };
      }
      const dg = agentDigestPayload();
      const row = (c) => (dg.agents || []).find((a) => a.code === c) || null;
      const nc = (c) => (dg.notCovered || []).find((a) => a.code === c) || null;
      return { per, d802: row('CB802'), d803: row('CB803'), d806: row('CB806'), nc805: nc('CB805'), row805: row('CB805') };
    };
    window.__mtd.setPeriod('2026-09', 'month'); const sep = snap();
    window.__mtd.setPeriod('2026-08', 'month'); const aug = snap();
    window.__mtd.setPeriod('2026-09', 'month');
    return { sep, aug, from: MTD_RULES.leaveNotShiftFrom, cls: ['AL', 'SL', 'FRL', 'CA', 'UCA', 'Suspended', 'Annual Leave', 'P', 'HDCA', 'L'].map((x) => [x, attClass(x)]) };
  });

  console.log('\nA · PULSE — SEPTEMBER (rule in force from ' + out.from + ')');
  const P = out.sep.per;
  ok('the rule is effective from 2026-09-01', out.from === '2026-09-01', String(out.from));
  const cls = Object.fromEntries(out.cls);
  ok('classes: AL/SL/FRL/CA and "Annual Leave" are leave, Suspended unavailable; UCA, P, HDCA and L are not off-shift codes',
    cls.AL === 'leave' && cls.SL === 'leave' && cls.FRL === 'leave' && cls.CA === 'leave' && cls['Annual Leave'] === 'leave'
      && cls.Suspended === 'unavailable' && cls.UCA === '' && cls.P === '' && cls.HDCA === '' && cls.L === '', JSON.stringify(cls));
  ok('baseline agent: 5 employed, 5 worked', P.CB801.emp === 5 && P.CB801.act === 5, JSON.stringify(P.CB801));
  ok('three days of annual leave are NOT employed shifts: 2 employed, 2 worked', P.CB802.emp === 2 && P.CB802.act === 2, JSON.stringify(P.CB802));
  ok('…carry no target (target is 2 days × 3, not 5 × 3)', P.CB802.target === 2 * (P.CB801.target / 5), JSON.stringify(P.CB802) + ' vs ' + P.CB801.target);
  ok('…and are recorded as leave', JSON.stringify(P.CB802.off) === '["leave","leave","leave"]', JSON.stringify(P.CB802.off));
  ok('the digest publishes attendance 100%, 3 leave days, 0 absent', out.sep.d802 && out.sep.d802.att === 1 && out.sep.d802.leave === 3 && out.sep.d802.absent === 0,
    JSON.stringify(out.sep.d802 && { att: out.sep.d802.att, leave: out.sep.d802.leave, absent: out.sep.d802.absent }));
  ok('the register CODE never travels — only the class', out.sep.d802 && (out.sep.d802.off || []).every((o) => o.k === 'leave' && Object.keys(o).join() === 'd,k'),
    JSON.stringify(out.sep.d802 && out.sep.d802.off));
  ok('an unplanned absence (UCA) is still an absence: 5 employed, 4 worked', P.CB803.emp === 5 && P.CB803.act === 4 && !P.CB803.off.length, JSON.stringify(P.CB803));
  ok('…published as 80% attendance with 1 absent day', out.sep.d803 && out.sep.d803.att === 0.8 && out.sep.d803.absent === 1 && out.sep.d803.leave === 0,
    JSON.stringify(out.sep.d803 && { att: out.sep.d803.att, absent: out.sep.d803.absent }));
  ok('activity wins: a leave code on a day the agent dialled is a working day (5/5)', P.CB804.emp === 5 && P.CB804.act === 5 && !P.CB804.off.length, JSON.stringify(P.CB804));
  ok('suspended days are unavailable, not shifts: 3 employed, 3 worked', P.CB806.emp === 3 && P.CB806.act === 3 && P.CB806.off.length === 2, JSON.stringify(P.CB806));
  ok('…published as unavailable, not leave', out.sep.d806 && out.sep.d806.unavail === 2 && out.sep.d806.leave === 0, JSON.stringify(out.sep.d806 && { u: out.sep.d806.unavail, l: out.sep.d806.leave }));
  ok('sick all week: no shifts, no target, no fact rows', P.CB805.emp === 0 && P.CB805.target === 0 && P.CB805.rows === 0 && P.CB805.off.length === 5, JSON.stringify(P.CB805));
  ok('…and the digest says "leave", not "no activity yet"', !out.sep.row805 && out.sep.nc805 && out.sep.nc805.why === 'leave', JSON.stringify(out.sep.nc805));

  ok('L is a half day (Cuddle, register rule): 5 employed, 3 + 0,5 + 0,5 = 4 worked', P.CB807.emp === 5 && P.CB807.act === 4 && !P.CB807.off.length, JSON.stringify(P.CB807));
  ok('L is a half day (Courtesy, dialler rule) even though they dialled: 5 employed, 4,5 worked', P.CB808.emp === 5 && P.CB808.act === 4.5, JSON.stringify(P.CB808));

  console.log('\nB · PULSE — AUGUST, BEFORE THE RULE: UNCHANGED');
  const A = out.aug.per;
  ok('August leave is still an employed, unworked shift (5 employed, 2 worked) — the workbook-verified month does not move',
    A.CB802.emp === 5 && A.CB802.act === 2 && !A.CB802.off.length, JSON.stringify(A.CB802));
  ok('August sick week still carries its shifts (5 employed, 0 worked)', A.CB805.emp === 5 && A.CB805.act === 0, JSON.stringify(A.CB805));
  ok('August L keeps its old weight: Cuddle 5 employed, 3 worked; Courtesy (dialled) 5 worked', A.CB807.emp === 5 && A.CB807.act === 3 && A.CB808.act === 5,
    JSON.stringify({ c: A.CB807, k: A.CB808 }));
  ok('no page errors (PULSE)', errs.length === 0, errs.join(' | '));
  await page.close();

  /* ═══ B · OPS ═══ */
  console.log('\nC · OPS — THE NBA ENGINE');
  const ops = await b.newPage();
  const oerrs = []; ops.on('pageerror', (e) => oerrs.push(String(e.message).slice(0, 160)));
  await ops.goto('http://127.0.0.1:8261/ops.html', { waitUntil: 'domcontentloaded' });
  await ops.waitForTimeout(2500);
  const o = await ops.evaluate(() => {
    const win = { from: '2026-09-01', to: '2026-09-30' };
    const day = (i) => '2026-09-' + String(i + 1).padStart(2, '0');
    const run = (cb, codes) => {
      state.filters = {};
      state.cbInfo = { [cb]: { name: 'Test Agent', code: cb, tl: 'TL A', queue: 'Courtesy', tenure: 'M1', target: 3 } };
      state.facts.ATTENDANCE = codes.map((c, i) => ({ employee_code: cb, status_code: c, status: c, _d: day(i) }));
      state.facts.QA_EVALUATIONS = []; state.facts.SF_OPEN_CASES = []; state.facts.BI_ACTIVE_CASES = [];
      if (typeof _dataVer !== 'undefined') _dataVer++;
      const st = acStats(cb, win, acCtx(win)); const nba = acNBA(st);
      return { att: st.att, sched: st.sched, p: st.p, leave: st.leaveDays, code: nba && nba.code, label: nba && nba.label };
    };
    return {
      leave: run('CB901', [...Array(15).fill('P'), ...Array(5).fill('AL')]),
      absent: run('CB902', [...Array(15).fill('P'), ...Array(5).fill('UCA')]),
      allLeave: run('CB903', Array(10).fill('AL')),
      allAbsent: run('CB904', Array(10).fill('UCA')),
    };
  });
  ok('15 present + 5 annual leave: attendance 100%, 15 scheduled, 5 leave days', o.leave.att === 100 && o.leave.sched === 15 && o.leave.leave === 5, JSON.stringify(o.leave));
  ok('15 present + 5 unplanned absences: attendance 75% — absence still counts', o.absent.att === 75 && o.absent.sched === 20, JSON.stringify(o.absent));
  ok('a whole window of annual leave is "On leave this period", never R1 Zero Attendance',
    o.allLeave.label === 'On leave this period' && o.allLeave.code !== 'R1', JSON.stringify(o.allLeave));
  ok('a whole window of unplanned absence still fires R1 Zero Attendance', o.allAbsent.code === 'R1', JSON.stringify(o.allAbsent));
  ok('no page errors (Ops)', oerrs.length === 0, oerrs.join(' | '));
} finally {
  await b.close(); server.close();
}
console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
process.exitCode = fail ? 1 : 0;
