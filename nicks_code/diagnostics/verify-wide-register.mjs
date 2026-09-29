#!/usr/bin/env node
/**
 * verify-wide-register.mjs — a one-column-per-day attendance register loads in BOTH apps, and the
 * codes and advance entries it carries are read the way the rule book says.
 *
 *   node nicks_code/diagnostics/verify-wide-register.mjs
 *
 * 2026-09-29: the real September 2026 register (one row per person, "Tue 1 … Wed 30" day columns,
 * the code in the cell, no Date / Status Code column) loaded NOTHING — PULSE toasted "Could not
 * recognise", Ops matched no source. It also carried codes the rules did not know (ML maternity
 * leave, HDSL / HDAL half-day sick / annual leave) and ADVANCE entries after its full reach (leave
 * written out to 30 Sep), which under the old "any entry covers the day" rule made the whole floor
 * employed-and-absent on every later day with sales.
 *
 * The fixture below has the real file's layout with FICTIONAL people — no register data from the
 * floor is ever committed (POPIA: leave types are health information).
 *
 * A · unpivotRegister: the same function text in both apps; month from the name, from the calendar,
 *     and a name the headers contradict refused whole.
 * B · PULSE: the file loads through handleFiles; ML is leave, HDSL / HDAL / L are half days, UCA is an
 *     absence; a day carrying only advance entries is not a report of the floor (no phantom shifts,
 *     not a dialling day, not the register's reach); planned leave after the figures' reach is
 *     published as leaveAhead.
 * C · Ops: the file is detected as ATTENDANCE through readUpload; leave (incl. FRL / ML) leaves the
 *     attendance denominator; the saved-rules migration adds the new codes once and never re-adds one
 *     removed on purpose, and drops the retired penalty keys.
 */
import fs from 'node:fs'; import path from 'node:path'; import http from 'node:http'; import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const { chromium } = await import(pathToFileURL(path.join(HERE, 'node_modules', 'playwright', 'index.mjs')).href);
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (d ? ' — ' + d : '')); } };

const PULSE = path.join(ROOT, 'nicks_code', 'index.html'), OPS = path.join(ROOT, 'Chatterbox_AgentOS_Analytics.html');
/* the CDN libraries, served from node_modules so the suite runs where cdnjs is unreachable */
const LIB = { 'papaparse.min.js': path.join(HERE, 'node_modules', 'papaparse', 'papaparse.min.js'),
  'xlsx.full.min.js': path.join(HERE, 'node_modules', 'xlsx', 'dist', 'xlsx.full.min.js') };

/* ── the fixture: September 2026, the real layout, fictional people ── */
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYS = []; for (let d = 1; d <= 30; d++) { const w = new Date(Date.UTC(2026, 8, d)).getUTCDay(); if (w) DAYS.push({ d, h: WD[w] + ' ' + d, w }); }
const iso = (d) => '2026-09-' + String(d).padStart(2, '0');
const HEAD = ['Department', 'Division', 'Employee Title', 'Employee Name', 'Employee Code', 'Reports To', 'Start Date', 'Employee Status', 'Email Address', ...DAYS.map((x) => x.h)];
const COURTESY = 'Matrix VAS Courtesy - Sales Agent', CUDDLE = 'Matrix VAS Cuddles - Sales Agent';
/* code per day: through Fri 18 every weekday is filled (the register's full reach); after it, only
   advance entries. `special` overrides a day. */
const person = (code, name, title, special = {}, after = {}) => ({ code, name, title, cell: (x) => {
  if (special[x.d] !== undefined) return special[x.d];
  if (x.d > 18) return after[x.d] !== undefined ? after[x.d] : (after['*'] && x.w !== 6 ? after['*'] : (after['*sat'] && x.w === 6 ? after['*sat'] : ''));
  return x.w === 6 ? '' : 'P'; } });
const ML = {}; for (let d = 10; d <= 30; d++) ML[d] = 'ML';                      // maternity leave written to month end, Saturdays included
const PEOPLE = [
  person('CB901', 'Test Agent One', COURTESY),
  person('CB902', 'Test Agent Two', COURTESY, ML, ML),
  person('CB903', 'Test Agent Three', CUDDLE, { 7: 'HDSL', 8: 'L', 9: 'UCA', 10: 'AL' }),
  person('CB904', 'Test Agent Four', CUDDLE, { 14: 'HDAL', 15: 'FRL' }, { 21: 'SL' }),
  ...[5, 6, 7, 8, 9].map((i) => person('CB90' + i, 'Test Agent ' + i, i % 2 ? COURTESY : CUDDLE)),
  person('CB950', 'Test Support Person', 'QA Agent'),
];
const csvCell = (v) => '"' + String(v).replace(/"/g, '""') + '"';
const CSV = [HEAD.map(csvCell).join(','), ...PEOPLE.map((p) => [p.title === 'QA Agent' ? 'QA' : 'Sales', p.title === 'QA Agent' ? 'QA' : 'Matrix VAS', p.title, p.name, p.code,
  'Test Leader', '1-Jan-2026', 'Active', '', ...DAYS.map((x) => p.cell(x))].map(csvCell).join(','))].join('\n');
const FILE = 'Attendance_Register_September_2026.csv';
const nonBlank = PEOPLE.reduce((n, p) => n + DAYS.filter((x) => p.cell(x)).length, 0);

/* ═══ A · the function itself ═══ */
console.log('\nA · unpivotRegister — one function, two copies');
const grab = (file) => { const s = fs.readFileSync(file, 'utf8'); const a = s.indexOf('// ── WIDE-REGISTER:BEGIN ──'), b = s.indexOf('// ── WIDE-REGISTER:END ──');
  return a >= 0 && b > a ? s.slice(a, b) : null; };
const fP = grab(PULSE), fO = grab(OPS);
ok('PULSE carries the function between its markers', !!fP);
ok('Ops carries the function between its markers', !!fO);
ok('the two copies are the same text, character for character', fP && fO && fP === fO, fP && fO ? 'lengths ' + fP.length + ' vs ' + fO.length : '');
const ctx = vm.createContext({}); vm.runInContext(fP + '\nthis.unpivotRegister=unpivotRegister;', ctx);
const U = ctx.unpivotRegister;
const recs = PEOPLE.map((p) => Object.fromEntries(HEAD.map((h, i) => [h, i < 9 ? [p.title === 'QA Agent' ? 'QA' : 'Sales', '', p.title, p.name, p.code, 'Test Leader', '1-Jan-2026', 'Active', ''][i] : p.cell(DAYS[i - 9])])));
const r1 = U(HEAD, recs, FILE, '');
ok('reads the month from the file name (2026-09, basis name)', r1 && r1.ok && r1.month === '2026-09' && r1.basis === 'name', JSON.stringify(r1 && { ok: r1.ok, m: r1.month, b: r1.basis, why: r1.why }));
ok('one long row per non-blank cell (' + nonBlank + '), none for a blank one', r1 && r1.recs.length === nonBlank, String(r1 && r1.recs.length));
ok('"Tue 1" is 2026-09-01 and "Wed 30" is 2026-09-30', r1 && r1.recs.some((x) => x.Date === '2026-09-01') && r1.recs.some((x) => x.Date === '2026-09-30' && x['Status Code'] === 'ML'));
ok('the long header both parsers read', r1 && JSON.stringify(r1.header) === JSON.stringify(['Date', 'Employee Code', 'Employee Name', 'Title', 'Department', 'Reports To', 'Status Code', 'Status']), JSON.stringify(r1 && r1.header));
ok('the code in the cell is the Status Code, untouched', r1 && r1.recs.find((x) => x['Employee Code'] === 'CB903' && x.Date === '2026-09-07')['Status Code'] === 'HDSL');
const r2 = U(HEAD, recs, 'attendance register.csv', '', Date.UTC(2026, 8, 29));
ok('no month in the name: the most recent fitting month up to now (2026-09, basis calendar)', r2 && r2.ok && r2.month === '2026-09' && r2.basis === 'calendar', JSON.stringify(r2 && { m: r2.month, b: r2.basis }));
const r3 = U(HEAD, recs, 'Attendance_Register_August_2026.csv', '');
ok('a name the day headers contradict is refused whole, with the reason', r3 && r3.ok === false && /2026-08/.test(r3.why), JSON.stringify(r3));
ok('"Sep 2026" and "2026-09" in a name both read as September', ['Register Sep 2026.csv', 'register_2026-09.csv'].every((n) => { const r = U(HEAD, recs, n, ''); return r && r.ok && r.month === '2026-09' && r.basis === 'name'; }));
{ /* an OCTOBER register (1 Oct 2026 is a Thursday) with no month in its name, exported early on 30 Sep:
     January 2026 also starts on a Thursday with 31 days — the nearest month must win, never January */
  const OH = ['Employee Code']; for (let d = 1; d <= 31; d++) { const w = new Date(Date.UTC(2026, 9, d)).getUTCDay(); if (w) OH.push(WD[w] + ' ' + d); }
  const oct = U(OH, [{ 'Employee Code': 'CB1', 'Thu 1': 'AL' }], 'attendance register.csv', '', Date.UTC(2026, 8, 30));
  ok('an October register exported on 30 Sep with no month in its name is October — not the January that also fits', oct && oct.ok && oct.month === '2026-10', JSON.stringify(oct && { m: oct.month, b: oct.basis }));
  const mk = U(OH, [{ 'Employee Code': 'CB1', 'Thu 1': 'AL' }], 'Marketing_2026.csv', '', Date.UTC(2026, 9, 15));
  ok('a word that merely starts like a month ("Marketing_2026") is not read as March', mk && mk.ok && mk.month === '2026-10' && mk.basis === 'calendar', JSON.stringify(mk && { m: mk.month, b: mk.basis })); }
ok('a long register is not touched (null)', U(['Date', 'Employee Code', 'Status Code', 'Status'], [{ Date: '2026-09-01', 'Employee Code': 'CB1', 'Status Code': 'P', Status: 'P' }], FILE, '') === null);
ok('fewer than seven day columns is not a register (null)', U(['Employee Code', 'Mon 7', 'Tue 8', 'Wed 9'], [{ 'Employee Code': 'CB1', 'Mon 7': 'P' }], FILE, '') === null);

/* ═══ the pages ═══ */
const SERVE = { '/pulse.html': PULSE, '/ops.html': OPS, '/xlsx.full.min.js': path.join(ROOT, 'site', 'xlsx.full.min.js') };
const server = http.createServer((q, s) => { const p = SERVE[q.url.split('?')[0]];
  if (!p || !fs.existsSync(p)) { s.writeHead(404); s.end(); return; }
  s.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' }); fs.createReadStream(p).pipe(s); });
await new Promise((r) => server.listen(8293, '127.0.0.1', r));
const b = await chromium.launch();
try {
  const mkCtx = async () => { const c = await b.newContext();
    await c.route('https://cdnjs.cloudflare.com/**', (r) => { const f = LIB[path.basename(new URL(r.request().url()).pathname)];
      return f && fs.existsSync(f) ? r.fulfill({ path: f, contentType: 'text/javascript' }) : r.abort(); });
    return c; };

  /* ═══ B · PULSE ═══ */
  console.log('\nB · PULSE — the register loads, and every code and advance entry reads right');
  const pc = await mkCtx(); const page = await pc.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
  await page.goto('http://127.0.0.1:8293/pulse.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__mtd && window.__mtd.state(), null, { timeout: 30000 });
  const roster = PEOPLE.filter((p) => p.title !== 'QA Agent').map((p) => ({ code: p.code, name: p.name, sf: p.name, tl: 'Test Leader',
    campaign: p.title === CUDDLE ? 'Cuddle' : 'Courtesy', tenure: 'Exp', callx: '', target: 0, start: '2026-01-01' }));
  const talks = Object.fromEntries(PEOPLE.map((p) => [p.code, Object.fromEntries(DAYS.map((x) => [x.d, ['P', 'L', 'HDSL', 'HDAL'].includes(p.cell(x))]))]));
  const out = await page.evaluate(async ([csv, name, roster, talks]) => {
    const msgs = []; const t0 = window.toast; window.toast = function (m) { msgs.push(String(m)); try { return t0.apply(this, arguments); } catch (e) {} };
    const S = window.__mtd.state();
    S.roster = roster; S.att = {}; S.calls = {}; S.sales = {}; S.tracker = {}; S.orgHist = {}; S.vici = {}; S.cancRows = {}; S.files = []; S.viciDays = {};
    await handleFiles([new File([csv], name, { type: 'text/csv' })]);
    /* the dialler for every register weekday to the 18th — talk where the register says worked —
       plus Mon 21 (a sales/dialler day after the register's full reach) where only CB901 dialled */
    const FULL = []; for (let d = 1; d <= 18; d++) { const w = new Date(Date.UTC(2026, 8, d)).getUTCDay(); if (w > 0 && w < 6) FULL.push(d); }
    for (const d of [...FULL, 21]) { const k = '2026-09-' + String(d).padStart(2, '0'); S.calls[k] = {};
      for (const a of roster) if (d === 21 ? a.code === 'CB901' : talks[a.code][d]) S.calls[k][a.code] = { talk: 3600, calls: 30, ans: 15, opt: 0, saleD: 0, v: 1 }; }
    const snap = () => { window.__mtd.rebuild(); window.__mtd.setPeriod('2026-09', 'month'); const m = window.__mtd.model(); const o = {};
      for (const a of roster) { const f = (m.facts || []).filter((x) => x.code === a.code); const sum = (k) => f.reduce((n, x) => n + (x[k] || 0), 0);
        o[a.code] = { emp: sum('emp'), act: sum('act'), leave: ((m.offBy || {})[a.code] || []).length, on21: (f.find((x) => x.date === '2026-09-21') || { emp: 0 }).emp }; }
      return { per: o, dialling: m.diallingDays, reach: dataReach().attendance }; };
    const NEW = snap(); const dg = agentDigestPayload(); const d = (c) => (dg.agents || []).find((x) => x.code === c) || {};
    const cov = MTD_RULES.registerCoverage.from; MTD_RULES.registerCoverage.from = '2099-01-01'; const OLDCOV = snap(); MTD_RULES.registerCoverage.from = cov;
    return { msgs, files: (S.files || []).map((x) => x.type), attDays: Object.keys(S.att).length, supportInAtt: !!(S.att['2026-09-01'] || {}).CB950,
      NEW, OLDCOV, dg: { CB902: { leave: d('CB902').leave, leaveAhead: d('CB902').leaveAhead, att: d('CB902').att }, CB903: { absent: d('CB903').absent, leave: d('CB903').leave },
        CB904: { leave: d('CB904').leave, leaveAhead: d('CB904').leaveAhead } } };
  }, [CSV, FILE, roster, talks]);
  const P = out.NEW.per;
  ok('the file loads through handleFiles and is filed as attendance', out.files.includes('attendance') && out.attDays === DAYS.filter((x) => PEOPLE.some((p) => p.cell(x))).length, JSON.stringify({ files: out.files, days: out.attDays }));
  ok('…and says which month it was read as', out.msgs.some((m) => /read as the 2026-09 register/.test(m)), out.msgs.join(' | '));
  ok('a support-staff row is stored but never becomes a VAS fact', out.supportInAtt && !P.CB950);
  ok('baseline: 14 employed, 14 worked to the 18th, plus Mon 21 where the dialler saw them (15 / 15)', P.CB901.emp === 15 && P.CB901.act === 15, JSON.stringify(P.CB901));
  ok('ML is leave: 7 employed and worked (1–9 Sep), 8 leave days (10–18 and the named advance entry on the 21st)', P.CB902.emp === 7 && P.CB902.act === 7 && P.CB902.leave === 8, JSON.stringify(P.CB902));
  ok('HDSL and L are half days, UCA an absence, AL leave: 13 employed, 10 + 0,5 + 0,5 = 11 worked', P.CB903.emp === 13 && P.CB903.act === 11 && P.CB903.leave === 1, JSON.stringify(P.CB903));
  ok('HDAL is a half day, FRL leave, and the advance SL on the 21st is leave: 13 employed, 12,5 worked, 2 leave', P.CB904.emp === 13 && P.CB904.act === 12.5 && P.CB904.leave === 2, JSON.stringify(P.CB904));
  ok('a day carrying only advance entries is NOT a report of the floor: nobody unnamed is employed on the 21st', ['CB905', 'CB906', 'CB907', 'CB908', 'CB909'].every((c) => P[c].on21 === 0 && P[c].emp === 14),
    JSON.stringify(['CB905', 'CB906'].map((c) => P[c])));
  ok('…under the old rule every unnamed agent WOULD have been employed-and-absent that day', ['CB905', 'CB906', 'CB907', 'CB908', 'CB909'].every((c) => out.OLDCOV.per[c].on21 === 1), JSON.stringify(out.OLDCOV.per.CB906));
  ok('dialling days are the 14 reported days, not 15', out.NEW.dialling === 14 && out.OLDCOV.dialling === 15, out.NEW.dialling + ' vs old ' + out.OLDCOV.dialling);
  ok('the register reaches Fri 18 Sep — not its last advance entry on the 30th', out.NEW.reach === '2026-09-18' && out.OLDCOV.reach === '2026-09-30', out.NEW.reach + ' vs old ' + out.OLDCOV.reach);
  ok('the digest carries the leave as a class count, and 100% attendance for the agent on leave', out.dg.CB902.leave === 8 && out.dg.CB902.att === 1, JSON.stringify(out.dg.CB902));
  ok('planned leave after the figures\' reach (Mon 21) is published: 6 working days (22, 23, 25, 28, 29, 30 — not the holiday, not the Saturday)', out.dg.CB902.leaveAhead === 6 && out.dg.CB904.leaveAhead === 0,
    JSON.stringify({ a: out.dg.CB902, b: out.dg.CB904 }));
  ok('the UCA day is published as 1 absent day', out.dg.CB903.absent === 1, JSON.stringify(out.dg.CB903));
  /* a refused register says WHY — the generic "Could not recognise" must not overwrite it */
  const refused = await page.evaluate(async ([csv]) => { const msgs = []; window.toast = function (m) { msgs.push(String(m)); };
    await handleFiles([new File([csv.replace(/Tue 1/, 'Tue 1 ')], 'Attendance_Register_August_2026.csv', { type: 'text/csv' })]);
    return msgs; }, [CSV]);
  ok('a register whose name contradicts its days is refused, and the message says why', refused.some((m) => /one column per day, but it was not loaded — its name says 2026-08/.test(m)) && !refused.some((m) => /Could not recognise/.test(m)),
    refused.join(' | '));
  /* a month whose register holds NOTHING but advance entries (October exported on the 1st) must not
     vouch for its own sparse days: measured against the roster, one entry of nine is not a report */
  const adv = await page.evaluate(() => { const S = window.__mtd.state();
    S.att['2026-10-01'] = { CB902: 'ML' }; S.calls['2026-10-01'] = { CB901: { talk: 3600, calls: 30, ans: 15, opt: 0, saleD: 0, v: 1 } };
    window.__mtd.rebuild(); window.__mtd.setPeriod('2026-10', 'month'); const m = window.__mtd.model();
    const f = (c) => (m.facts || []).filter((x) => x.code === c && x.date === '2026-10-01').reduce((n, x) => n + x.emp, 0);
    const r = { unnamed: ['CB903', 'CB905', 'CB906'].map(f), dialled: f('CB901'), leave: ((m.offBy || {}).CB902 || []).length };
    delete S.att['2026-10-01']; delete S.calls['2026-10-01']; window.__mtd.setPeriod('2026-09', 'month'); return r; });
  ok('an advance-only month cannot make its own sparse day a report of the floor: unnamed agents 0, the one who dialled 1, the named leave kept',
    adv.unnamed.every((x) => x === 0) && adv.dialled === 1 && adv.leave === 1, JSON.stringify(adv));
  ok('no page errors (PULSE)', errs.length === 0, errs.join(' | '));
  await pc.close();

  /* ═══ C · Ops ═══ */
  console.log('\nC · Ops — the register is detected, leave is not missed attendance, the saved rules migrate');
  const oc = await mkCtx(); const ops = await oc.newPage();
  const oerrs = []; ops.on('pageerror', (e) => oerrs.push(String(e.message).slice(0, 160)));
  await ops.goto('http://127.0.0.1:8293/ops.html', { waitUntil: 'domcontentloaded' });
  await ops.waitForTimeout(2500);
  const o = await ops.evaluate(async ([csv, name, nonBlank]) => {
    const f = new File([csv], name, { type: 'text/csv' });
    const parsed = await readUpload(f, null); const src = detectSource(parsed);
    /* score two agents over the month from the converted rows, exactly as the relay would file them */
    state.filters = {};
    state.cbInfo = { CB902: { name: 'Two', code: 'CB902', tl: 'T', queue: 'Courtesy', tenure: 'M1', target: 3 }, CB903: { name: 'Three', code: 'CB903', tl: 'T', queue: 'Cuddle', tenure: 'M1', target: 3 } };
    state.facts.ATTENDANCE = parsed.data.map((r) => TRANSFORM.ATTENDANCE(r)).filter((r) => r.employee_code === 'CB902' || r.employee_code === 'CB903');
    state.facts.QA_EVALUATIONS = []; state.facts.SF_OPEN_CASES = []; state.facts.BI_ACTIVE_CASES = [];
    if (typeof _dataVer !== 'undefined') _dataVer++;
    const win = { from: '2026-09-01', to: '2026-09-30' }; const C = acCtx(win);
    const s2 = acStats('CB902', win, C), s3 = acStats('CB903', win, C);
    /* the saved-rules migration: a config saved before 2026-09-29 */
    const saved = { rules: { leaveCodes: { vals: ['AL', 'SL', 'CA', 'CASAT'] }, presentCodes: { vals: ['P', 'T', 'L', 'HDAL', 'HDCA'] },
      nbaThresholds: { vals: ['qaCritical:80', 'attRisk:80', 'pen1:0', 'pen2:0', 'pen3:0'] } } };
    applyCfg(saved);
    const m1 = { leave: state.rules.leaveCodes.vals.slice(), present: state.rules.presentCodes.vals.slice(), nba: state.rules.nbaThresholds.vals.slice(), done: (state.rulesMigrated || []).slice() };
    /* a later save in which someone removed ML on purpose: the migration must not put it back */
    applyCfg({ rules: { leaveCodes: { vals: ['AL', 'SL', 'CA', 'CASAT', 'FRL'] } }, rulesMigrated: m1.done });
    const m2 = { leave: state.rules.leaveCodes.vals.slice() };
    return { src, rows: parsed.data.length, headerOk: validateHeaders('ATTENDANCE', parsed.headers).ok,
      s2: { att: s2.att, sched: s2.sched, leave: s2.leaveDays }, s3: { att: s3.att, sched: s3.sched, p: s3.p, leave: s3.leaveDays },
      nba2: acNBA(s2).code, m1, m2, payloadHas: 'rulesMigrated' in cfgPayload(), nonBlank };
  }, [CSV, FILE, nonBlank]);
  ok('readUpload converts the register and detectSource files it as ATTENDANCE', o.src === 'ATTENDANCE' && o.headerOk && o.rows === nonBlank, JSON.stringify({ src: o.src, rows: o.rows, ok: o.headerOk }));
  ok('ML is leave in Ops: 7 scheduled days, 100% attendance, the maternity leave counted apart', o.s2.att === 100 && o.s2.sched === 7 && o.s2.leave === 18, JSON.stringify(o.s2));
  ok('…and it never fires R1 Zero Attendance', o.nba2 !== 'R1', o.nba2);
  ok('HDSL and L are present, UCA an absence, AL leave: 12 of 13 scheduled days', o.s3.sched === 13 && o.s3.p === 12 && o.s3.leave === 1, JSON.stringify(o.s3));
  ok('a saved pre-migration config gains FRL and ML as leave and HDSL as present', ['FRL', 'ML'].every((c) => o.m1.leave.includes(c)) && o.m1.present.includes('HDSL'), JSON.stringify(o.m1));
  ok('…the retired penalty keys are dropped from the saved thresholds', !o.m1.nba.some((v) => /^pen[123]:/.test(v)) && o.m1.nba.includes('qaCritical:80'), JSON.stringify(o.m1.nba));
  ok('…the migration is recorded, and saved with the settings', o.m1.done.includes('2026-09-29-leave-codes') && o.payloadHas, JSON.stringify(o.m1.done));
  ok('a code removed on purpose after the migration stays removed', !o.m2.leave.includes('ML') && o.m2.leave.includes('FRL'), JSON.stringify(o.m2));
  ok('no page errors (Ops)', oerrs.length === 0, oerrs.join(' | '));
} finally {
  await b.close(); server.close();
}
console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
process.exitCode = fail ? 1 : 0;
