/* ONE AGENT, ONE DAY, END TO END — the walkthrough.
 *
 * Every other suite answers "does the pipeline hold?". This one answers "show me".
 * It takes a single agent-day out of the pilot drop and prints the whole chain: the raw
 * row in each of the five source files, the key each one joins on, what the engine stored,
 * what the model computed, and what the agent and the team leader finally read — with the
 * formula written next to every number.
 *
 * Run verify-denise-pilot.mjs first. Output: scratch/denise/trace.json + a printed trace.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checksFor, withFloorEx, VAT } from '../../worker/src/rules.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, 'scratch', 'denise');
const E = JSON.parse(fs.readFileSync(path.join(FIX, 'evidence.json'), 'utf8'));

const CODE = process.argv[2] || 'CB910';
const DAY = process.argv[3] || '2026-08-04';
const agent = E.cast.find(a => a.code === CODE);
const L = [];
const say = (s = '') => { L.push(s); console.log(s); };
const head = t => { say(''); say('─'.repeat(78)); say(t); say('─'.repeat(78)); };

const readCsv = f => { const t = fs.readFileSync(path.join(FIX, f), 'utf8').trim().split(/\r?\n/);
  const cols = split(t[0]); return { cols, rows: t.slice(1).map(l => Object.fromEntries(split(l).map((v, i) => [cols[i], v]))) }; };
function split(l) { const o = []; let c = '', q = false;
  for (let i = 0; i < l.length; i++) { const ch = l[i];
    if (q) { if (ch === '"') { if (l[i + 1] === '"') { c += '"'; i++; } else q = false; } else c += ch; }
    else if (ch === '"') q = true; else if (ch === ',') { o.push(c); c = ''; } else c += ch; }
  o.push(c); return o; }
const files = fs.readdirSync(FIX);
const find = re => files.find(f => re.test(f));

say('');
say('THE WALKTHROUGH — ' + agent.name + ' (' + CODE + '), ' + DAY);
say('role in the pilot: ' + agent.role);

/* ---------- 1. THE AGENT LIST: identity, team, campaign ---------- */
head('1 · SOURCE: the Agent List  —  what makes this person an agent at all');
{ const f = find(/Agent List 2026-09/); const { rows } = readCsv(f);
  const r = rows.find(x => x['Employee Code'] === CODE);
  say('file            : ' + f);
  say('record identity : Employee Code  (a live snapshot; the filename’s date says which month it wins)');
  say('the row         : ' + JSON.stringify(r));
  say('');
  say('  Employee Code  → CB code, normalised  [^A-Z0-9] stripped     : ' + CODE);
  say('  Agent Name     → THE identity for every other source         : "' + r['Agent Name'] + '"');
  say('  Team Leader    → filed into orgHist against the list’s month : "' + r['Team Leader'] + '"');
  say('  Campaign       → campOf()                                    : "' + r['Campaign'] + '" → ' + agent.camp);
  say('  Tenure         → picks the row of salesTargetMatrix          : ' + agent.ten); }

/* ---------- 2. THE MONEY ---------- */
head('2 · SOURCE: Power BI — Active Cases  —  the sale and the money');
let biRows = [], exSum = 0;
{ const f = find(/^BI Active Cases 2026-08 to 2026-09\.csv$/); const { rows } = readCsv(f);
  biRows = rows.filter(x => x['Contract Create Date'].slice(0, 10) === DAY && x.Owner && ownerIs(x.Owner));
  say('file            : ' + f);
  say('record identity : Contract Create Date + Owner + Account Number');
  say('join key        : Owner (a NAME) → resolveKey() → the Agent List’s code');
  say('rows for this agent-day: ' + biRows.length);
  for (const r of biRows) say('  ' + JSON.stringify({ acct: r['Account Number'], case: r['Case Number'], owner: r.Owner, charge: r['Charge Amount'], deact: r['Contract Deactivate Date'] || '(empty → Active)' }));
  exSum = biRows.reduce((n, r) => n + parseFloat(r['Charge Amount']), 0);
  say('');
  say('  sales   = COUNT(DISTINCT Case Number)                     = ' + new Set(biRows.map(r => r['Case Number'])).size);
  say('  GWP ex  = Σ Charge Amount (charges are booked EX VAT)      = R' + exSum.toFixed(2));
  say('  GWP incl= Σ ROUND(per-account ex × ' + VAT + ')                  = R' +
    biRows.reduce((n, r) => n + Math.round(parseFloat(r['Charge Amount']) * VAT), 0));
  say('  └─ rounded PER ACCOUNT, then summed (money model, non-negotiable 6)'); }
function ownerIs(o) { const n = s => String(s).toLowerCase().replace(/[^a-z]/g, '');
  return n(o) === n(agent.name) || n(o).includes(n(agent.name.split(' ')[0])) && n(o).includes(n(agent.name.split(' ').pop())); }

/* ---------- 3. THE INTERACTIONS ---------- */
head('3 · SOURCE: ViciDial EXPORT_CALL_REPORT  —  the interactions');
{ const f = find(/^EXPORT_CALL_REPORT 2026/); const t = fs.readFileSync(path.join(FIX, f), 'utf8').trim().split(/\r?\n/);
  const cols = t[0].split('\t');
  const rows = t.slice(1).map(l => Object.fromEntries(l.split('\t').map((v, i) => [cols[i], v])))
    .filter(r => r.call_date.slice(0, 10) === DAY && (r.user === CODE || r.user === 'CB0' + CODE.slice(2) || ownerIs(r.full_name)));
  say('file            : ' + f + '   (TAB separated — read as CSV it is one 9-wide column and is refused)');
  say('record identity : call_date + user + lead_id + status   (repeats inside one file counted once)');
  say('join key        : full_name → the Agent List WINS; `user` (the dialler login) is the fallback');
  say('rows for this agent-day: ' + rows.length + '  · logins seen: ' + [...new Set(rows.map(r => r.user))].join(', '));
  say('  first 3: ' + JSON.stringify(rows.slice(0, 3).map(r => ({ user: r.user, name: r.full_name, status: r.status, disp: r.status_name, secs: r.length_in_sec }))));
  const talk = rows.reduce((n, r) => n + Math.max(0, parseInt(r.length_in_sec, 10) || 0), 0);
  say('');
  say('  calls   = COUNT(rows)                                     = ' + rows.length);
  say('  talk    = Σ length_in_sec  on the `user` column           = ' + talk + 's  (' + (talk / 60).toFixed(1) + ' min)');
  say('  └─ length_in_sec is dial-to-hangup, so ~38% of it is RINGING — deliberate (Nick, 2026-08-13)');
  say('  saleD   = COUNT(status_name matching isSaleDisp)          = ' + rows.filter(r => /sale/i.test(r.status_name)).length);
  say('  └─ used as the sales figure ONLY on a day the money file does not cover'); }

/* ---------- 4. QA ---------- */
head('4 · SOURCE: QA evaluations  —  the quality score');
{ const f = find(/^QA evaluations 2026/); const { rows } = readCsv(f);
  const mine = rows.filter(x => String(x['Sales Agent CB']).replace(/\D/g, '') === CODE.replace(/\D/g, ''));
  say('file            : ' + f);
  say('record identity : Record ID  (merged across files, never replaced by day)');
  say('join key        : Sales Agent CB → "CB" + the digits  — AND NOTHING ELSE');
  say('  ⚠ this is the ONE join in the system that never calls resolveKey(): no name fallback,');
  say('    no padding tolerance, no exception register. See finding F1.');
  say('rows for this agent: ' + mine.length + (mine.length ? '' : '   ← none matched'));
  for (const r of mine.slice(0, 3)) say('  ' + JSON.stringify({ id: r['Record ID'], cb: r['Sales Agent CB'], date: r['Date of Assessment'], score: r['Score %'], dec: r['Escalation Decision'] }));
  const sc = mine.map(r => parseFloat(r['Score %'])).filter(isFinite);
  say('');
  say('  QA      = MEAN(Score %) over the period, zeros KEPT      = ' + (sc.length ? (sc.reduce((a, b) => a + b, 0) / sc.length).toFixed(2) + '%' : 'no evaluations'));
  say('  └─ a 0% is an Escalation Decision of "Critical Fail" — an outcome, not missing data'); }

/* ---------- 5. ATTENDANCE ---------- */
head('5 · SOURCE: the HR attendance register  —  the shift');
{ const f = find(/^attendance register/); const { rows } = readCsv(f);
  const r = rows.find(x => x.Date === DAY && x['Employee Code'] === CODE);
  say('file            : ' + f);
  say('record identity : Date + Employee Code  (newer file wins that cell, leaves the rest)');
  say('the row         : ' + JSON.stringify(r));
  say('');
  say('  Employee Type must read "Call Agent" or the row is support staff and is dropped');
  say('  Employed Shift = 1 if started and not terminated on this date');
  say('  Actual Shift   : ' + agent.camp + ' → MTD_RULES.actualShiftsFrom = ' +
    (agent.camp === 'Cuddle' ? '"register"  → the register’s own weight' : '"dialler"   → 1 only if talk > 0')); }

/* ---------- 6. THE FACT ROW ---------- */
head('6 · THE JOIN: one fact row per agent per day');
const g = E.round1.perAgent[CODE];
say('  { date, code, tl, tlNow, campaign, tenure, emp, act, target, sales, gwp, gwpEx, talk, calls, canc, provisional }');
say('');
say('  tl        = orgAt(' + CODE + ', ' + DAY + ').tl   — the leader who owned them THAT DAY, never today’s list');
say('  campaign  = campOf(tracker row → orgHist → the live roster)');
say('  target    = salesTargetMatrix["' + agent.camp + '|' + agent.ten + '"] × emp');
say('  sales/gwp = the money file for this day, else the dialler’s sale dispositions (provisional = true)');
say('');
say('  period roll-up for ' + CODE + ' over ' + E.window.from + ' → ' + E.window.to + ':');
say('    ' + JSON.stringify({ days: g.days, emp: g.emp, act: g.act, target: g.target, sales: g.sales,
  gwpEx: Math.round(g.gwpEx), talk: g.talk, calls: g.calls, canc: g.canc, qa: g.qa, tl: JSON.stringify(g.tls) }));

/* ---------- 7. RECONCILIATION ---------- */
head('7 · RECONCILIATION: the app against the files, recomputed independently');
const S = E.source, P = E.provisional, X = E.expected;
const row = (label, app, src, prov) => say('  ' + label.padEnd(22) + String(app).padStart(10) + String(src).padStart(12) +
  String(prov == null ? '' : prov).padStart(12) + '   ' + (Math.abs(app - (src + (prov || 0))) < 1.02 ? 'agree' : 'DIFFER'));
say('  metric                       app      measured   provisional');
row('sales', g.sales, S.sales[CODE] || 0, P.sales[CODE] || 0);
row('GWP incl (R)', Math.round(g.gwp), S.gwp[CODE] || 0, P.gwp[CODE] || 0);
row('talk (s)', g.talk, S.talk[CODE] || 0, 0);
row('calls', g.calls, S.calls[CODE] || 0, 0);
row('cancellations', g.canc, S.canc[CODE] || 0, 0);
say('  QA %                  ' + String(g.qa == null ? 'null' : g.qa.toFixed(2)).padStart(10) +
  String((S.qaMean[CODE] || 0).toFixed(2)).padStart(12) + '               ' +
  (g.qa == null && S.qaMean[CODE] ? 'DIFFER ← finding F1' : 'agree'));

/* ---------- 8. EXCLUSIONS ---------- */
head('8 · EXCLUSIONS — counted and named, never silent');
say('  agents   : MTD_RULES.excludeAgents — CB67, CB205, CB265 (a maintained list, not derivable)');
say('  charges  : excludeChargeCodes (TESTRR) and excludeAccounts (622622) — internal test rows');
say('  logins   : nonAgentUsers VDAD/VDCL/VDLB/CBT00x/9027 + nonAgentPatterns (shape, not just name)');
say('  campaigns: only reportedCampaigns + any campaign the current Agent List names; VT is reported elsewhere');
say('  days     : a Saturday from 2026-09-01 carries its data and contributes NO shift');
say('');
say('  in this pilot run the exception register held:');
for (const u of E.unmatched) say('    · ' + u.key + '  [' + u.src + ']  n=' + u.n +
  (u.gwp ? '  R' + Math.round(u.gwp) : '') + (u.talk ? '  ' + Math.round(u.talk / 60) + 'min' : '') + (u.kind ? '  — ' + u.kind : ''));
say('  and QA rows stored against a code no list names: ' + (E.qaOrphans.join(', ') || 'none') + '  ← these are in NO register');

/* ---------- 9. WHAT THE AGENT READS ---------- */
head('9 · WHAT THE AGENT AND THE TEAM LEADER FINALLY READ');
const d = E.round1.digest.agents.find(a => a.code === CODE);
const th = withFloorEx(null), c = checksFor(d, null);
say('  agent card (from kv:agent-digest via /api/portal, scoped by authorise()):');
say('    sales ' + d.sales + ' / target ' + d.target + '   = ' + (d.pctT * 100).toFixed(2) + '% to target');
say('    avg GWP per sale  R' + d.aveG + ' ex VAT');
say('    QA ' + (d.qa == null ? '— not measured' : (d.qa * 100).toFixed(1) + '%') + '   attendance ' + (d.att * 100).toFixed(0) + '%');
say('');
say('  the two checks — DECIDED BY THE WORKER, painted by the page:');
say('    Check 1 value : R' + c.value.aveG + ' vs floor R' + c.value.floorEx + ' ex (= R' + c.value.floorIncl +
  ' incl, floored to the cent) → ' + (c.value.pass ? 'PASS' : 'FAIL'));
say('    Check 2 volume: ' + c.volume.pct + '% vs ' + c.volume.line + '% → ' + (c.volume.pass ? 'PASS' : 'FAIL'));
say('    basis: ' + c.basis);
const comp = E.round1.composites[CODE];
say('');
say('  the rating (last ' + comp.window + ' sessions, ' + comp.windowFrom + ' → ' + comp.windowTo + '):');
say('    score ' + comp.score + '  band "' + comp.band + '"  penalty ' + comp.penalty + ' (every penalty is 0 since 2026-09-11)');
say('    scored over ' + comp.weightScored + '% of the framework' + (comp.unmeasured.length ? '  · not measured: ' + comp.unmeasured.join(', ') : ''));
for (const p of comp.parts) say('      ' + p.k.padEnd(11) + 'w' + String(p.w).padStart(3) + '  value ' +
  String(p.value == null ? '—' : Number(p.value).toFixed(2)).padStart(9) + '  vs ' + String(p.target).padStart(7) +
  '  → ' + String(p.points).padStart(5) + ' pts' + (p.measured ? '' : '   (not measured — out of the denominator)'));
say('');
say('  NOTE: the rating row is the last five sessions; the two checks are the whole month.');
say('        Two windows, both true, never to be reconciled (non-negotiable 12).');

fs.writeFileSync(path.join(FIX, 'trace.txt'), L.join('\n'));
fs.writeFileSync(path.join(FIX, 'trace.json'), JSON.stringify({ code: CODE, day: DAY, agent, digest: d, checks: c, composite: comp, factRollup: g }, null, 2));
say('');
say('written: scratch/denise/trace.txt');
