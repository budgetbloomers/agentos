/* THE DENISE PILOT — a six-week join-integrity and reconciliation run.
 *
 * WHY THIS EXISTS. Before the agent and team-leader views go live, somebody has to be able
 * to answer six questions with a number rather than a feeling:
 *
 *   1. Does a row find its agent?        (identity join: code, name, alias, near spelling)
 *   2. Does the agent find their team?   (orgAt — the effective-dated org, not today's list)
 *   3. Does the team find its campaign?  (campOf + reportedCampaigns + the new-campaign path)
 *   4. Does an interaction find its day? (ViciDial per-call → agent-day talk/calls/dispositions)
 *   5. Does a sale find its money?       (Power BI Active ∪ Inactive → GWP, ex-VAT, grossed up)
 *   6. Does a QA evaluation find its agent? (S.evals[date][code] → qaFor)
 *
 * and then: what did NOT join, and what joined TWICE.
 *
 * SYNTHETIC FIXTURES, REAL CODE PATH. This repo holds no data drop and no credentials, so
 * every file below is written in the real export's header contract and dropped through the
 * real #fileInput → detectType → INGEST → buildModel path. The fixtures are synthetic; the
 * pipeline under test is not. Every expected figure is recomputed HERE, independently, from
 * the fixture rows — the app is never asked to check itself.
 *
 * THE DEFECTS ARE DELIBERATE. A join test that only feeds clean rows proves nothing. This
 * drop carries, on purpose: a near spelling, a transposition, a middle name, a zero-padded
 * QA code, a dialler login belonging to someone else, a team leader dialling, a system
 * login, an agent renamed between lists, a stranger owning real money, an ambiguous
 * surname, a duplicated money file, a doubled call export and a repeated Record ID.
 *
 * Run: node verify-denise-pilot.mjs
 *      PULSE_HTML=site/pulse/index.html node verify-denise-pilot.mjs   (against the build)
 * Writes evidence to scratch/denise/evidence.json for the pilot report.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = process.env.AGENTOS || decodeURIComponent(new URL('../..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1').replace(/\/$/, '');
const HTML = process.env.PULSE_HTML ? path.resolve(REPO, process.env.PULSE_HTML)
                                    : path.join(REPO, 'nicks_code', 'index.html');
const FIX = path.join(HERE, 'scratch', 'denise');
fs.mkdirSync(FIX, { recursive: true });

/* ================= the pilot window ================= */
/* Six weeks, 3 Aug – 12 Sep 2026. Deliberately straddles MTD_RULES.saturdayShiftsFrom
   (2026-09-01): August Saturdays are ordinary shifts, September Saturdays are data only.
   That boundary is a formula check, not a nuisance. */
const FROM = '2026-08-03', TO = '2026-09-12';
const dayList = (from, to) => { const out = []; const d = new Date(from + 'T00:00:00Z'), e = new Date(to + 'T00:00:00Z');
  while (d <= e) { const wd = d.getUTCDay(); if (wd !== 0) out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); } return out; };
const ALLDAYS = dayList(FROM, TO);                       // Mon–Sat, no Sundays
const AUG = ALLDAYS.filter(d => d < '2026-09-01');
const SEP = ALLDAYS.filter(d => d >= '2026-09-01');
const isSat = d => new Date(d + 'T00:00:00Z').getUTCDay() === 6;

/* Coverage is RAGGED on purpose — the sources never end on the same day in production.
   HR register runs furthest, then the dialler, then the money file. */
const ATT_DAYS  = ALLDAYS;                                        // … 2026-09-12
const CALL_DAYS = ALLDAYS.filter(d => d <= '2026-09-10');
const BI_DAYS   = ALLDAYS.filter(d => d <= '2026-09-05');
const QA_DAYS   = ALLDAYS.filter(d => d <= '2026-09-09');

/* ================= the cast ================= */
/* CB9xx: outside MTD_RULES.excludeAgents (CB67/205/265) and outside every real employee
   code, so a stale roster in a cloud blob cannot collide. CB95 is the padding probe. */
const TL = 'Denise Haripersad';
const TL_OTHER = 'Sharoma Pillay';          // the mover's previous leader — the attribution control
const CAST = [
  { code:'CB910', name:'Thandiwe Ngcobo',       camp:'Courtesy',        ten:'Exp', role:'clean control — every source agrees' },
  { code:'CB911', name:'Roshel Naidoo',         camp:'Courtesy',        ten:'Exp', role:'NEAR SPELLING — money is owned by "Roshel Dinika Naidoo"' },
  { code:'CB912', name:'Lindokuhle Mahlangu',   camp:'Nesting',         ten:'M0',  role:'TRANSPOSITION — dialler prints "Lindokhule Mahlangu"' },
  { code:'CB913', name:'Meelindree Melanie Crowie', camp:'Cuddle',      ten:'Exp', role:'MIDDLE NAME — dialler prints "Meelindree Crowie"' },
  { code:'CB95',  name:'Sipho Dlamini',         camp:'Courtesy',        ten:'M1',  role:'ZERO PADDING — QA and dialler write CB095, the list says CB95' },
  { code:'CB915', name:'Precious Khumalo',      camp:'Courtesy',        ten:'M2',  role:'WRONG LOGIN — dials as CB916, which belongs to someone else' },
  { code:'CB916', name:'Jabu Ntombela',         camp:'Nesting',         ten:'M0',  role:'owns the code the wrong login claims' },
  { code:'CB917', name:'Surprise Cwele',        camp:'Download & Test', ten:'Exp', role:'RENAMED ("Surprise Lucky Cwele") + a campaign new to the rule book' },
  { code:'CB918', name:'Enoch Mabaso',          camp:'Courtesy',        ten:'Exp', role:'MOVER — Sharoma’s in August, Denise’s from 1 September' },
];
const byCode = Object.fromEntries(CAST.map(a => [a.code, a]));
/* August spelling of the renamed agent — the alias the September list must not orphan. */
const AUG_NAME = { CB917: 'Surprise Lucky Cwele' };
const augName = c => AUG_NAME[c] || byCode[c].name;

/* Per-agent daily sale counts. Flat and boring on purpose: a join test wants arithmetic
   that can be checked by hand, not a plausible-looking curve. */
const SPD = { CB910:3, CB911:2, CB912:2, CB913:4, CB95:1, CB915:2, CB916:1, CB917:2, CB918:3 };
const CHARGE = 86.08;                       // x1,15 = 98.992 -> R99 per case, rounded per account
const TALK_PER_CALL = 180, CALLS_PER_DAY = 12;

/* ================= fixture writers (real header contracts) ================= */
const csv = rows => rows.map(r => r.map(v => { const s = String(v ?? '');
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(',')).join('\n') + '\n';
const tsv = rows => rows.map(r => r.join('\t')).join('\n') + '\n';
const w = (f, text) => { const p = path.join(FIX, f); fs.writeFileSync(p, text); return p; };

/* --- the Agent List. Filename carries the date the snapshot describes. --- */
function rosterFile(fname, asOfMonth) {
  const head = ['Sales Force','Start Date','Team Leader','Campaign','Agent Name','Employee Code','Tenure','Call x','Target'];
  const CAMPLAB = { Courtesy:'Matrix Courtesy', Cuddle:'Matrix Cuddle', Nesting:'Nesting', 'Download & Test':'Download & Test' };
  const rows = CAST.map(a => {
    const nm = asOfMonth === '08' ? augName(a.code) : a.name;
    // CB918 is Sharoma's in August and Denise's in September — the one movement in the pilot
    const tl = (a.code === 'CB918' && asOfMonth === '08') ? TL_OTHER : TL;
    return [nm, '2026-06-01', tl, CAMPLAB[a.camp] || a.camp, nm, a.code, a.ten, nm + ' ' + a.code, ''];
  });
  return w(fname, csv([head, ...rows]));
}

/* --- Power BI - Active Cases. Deactivate date empty on every row => detectType 'bi'. --- */
function biFile(fname, days, opts = {}) {
  const head = ['Account Number','Case Number','Contract Status','Owner','Contract Create Date','Contract Deactivate Date','Charge Amount','Charge Code'];
  const rows = [];
  for (const d of days) for (const a of CAST) {
    const n = SPD[a.code] || 0;
    for (let i = 0; i < n; i++) {
      /* THE MONEY FILE SPELLS THE OWNER ITS OWN WAY. Salesforce is not the Agent List, and
         that disagreement is the single most common reason a real sale goes unattributed. */
      let owner = a.name;
      if (a.code === 'CB911') owner = 'Roshel Dinika Naidoo';        // near spelling
      if (a.code === 'CB917') owner = augName('CB917');              // the old spelling, on every row
      rows.push([acct(a.code, d, i), caseNo(a.code, d, i), 'Active', owner, d + 'T00:00:00', '', CHARGE, 'MYP C35']);
    }
  }
  if (opts.strangers) {
    /* Real money owned by somebody no list names. Must land in M.unmatched, never be
       invented onto the roster and never be quietly dropped. */
    for (const d of days.slice(0, 4)) {
      rows.push([acct('X1', d, 0), caseNo('X1', d, 0), 'Active', 'Nomsa Zikalala', d + 'T00:00:00', '', CHARGE, 'MYP C35']);
      rows.push([acct('X2', d, 0), caseNo('X2', d, 0), 'Active', 'Naidoo',          d + 'T00:00:00', '', CHARGE, 'MYP C35']);   // ambiguous: unique-or-nothing
    }
  }
  return w(fname, csv([head, ...rows]));
}
const acct  = (c, d, i) => 'A' + c.replace(/\D/g, '') + d.replace(/-/g, '') + i;
const caseNo = (c, d, i) => 'C' + c.replace(/\D/g, '') + d.replace(/-/g, '') + i;

/* --- BI Inactive (cancellations). Deactivate date filled on every row. --- */
function cancFile(fname) {
  const head = ['Account Number','Case Number','Contract Number','Contract Status','Owner','Contract Create Date','Contract Deactivate Date','Charge Amount','Charge Code'];
  const rows = [];
  // one cancellation each for CB910 and CB911, on the pilot's first two BI days
  const picks = [['CB910', BI_DAYS[0]], ['CB911', BI_DAYS[1]]];
  for (const [c, d] of picks) {
    const a = byCode[c];
    const owner = c === 'CB911' ? 'Roshel Dinika Naidoo' : a.name;
    rows.push([acct(c, d, 0), caseNo(c, d, 0), 'CT' + c, 'Inactive', owner, d + 'T00:00:00', '2026-09-15T00:00:00', CHARGE, 'MYP C35']);
  }
  return w(fname, csv([head, ...rows]));
}

/* --- HR attendance register. Employee Type must read "Call Agent". --- */
function attFile(fname, days) {
  const head = ['Date','Employee Code','Employee Name','Employee Type','Status Code','Status'];
  const rows = [];
  for (const d of days) for (const a of CAST) rows.push([d, a.code, a.name, 'Call Agent', 'P', 'Present']);
  return w(fname, csv([head, ...rows]));
}

/* --- ViciDial EXPORT_CALL_REPORT: tab-separated, one row per CALL. --- */
function viciFile(fname, days, opts = {}) {
  const head = ['call_date','lead_id','user','full_name','user_group','campaign_id','status','status_name','length_in_sec'];
  const rows = [];
  let lead = 100000;
  const emit = (d, login, full, status, statusName, secs) =>
    rows.push([d + ' 09:00:00', ++lead, login, full, 'VAS', 'MATRIX', status, statusName, secs]);
  for (const d of days) for (const a of CAST) {
    /* THE DIALLER'S IDEA OF WHO YOU ARE. Three disagreements with the Agent List, all real
       shapes: a padded code, a one-edit misspelling, a login issued to someone else. */
    let login = a.code, full = a.name;
    if (a.code === 'CB95')  login = 'CB095';                              // zero padded
    if (a.code === 'CB912') full  = 'Lindokhule Mahlangu';                // transposition
    if (a.code === 'CB913') full  = 'Meelindree Crowie';                  // middle name dropped
    if (a.code === 'CB915') login = 'CB916';                              // WRONG: the list must win on full_name
    if (a.code === 'CB917') full  = augName('CB917');                     // the old spelling
    for (let i = 0; i < CALLS_PER_DAY; i++) {
      const sale = i < (SPD[a.code] || 0);
      emit(d, login, full, sale ? 'SALE' : (i % 3 === 0 ? 'N' : 'HU'),
           sale ? 'Sale Insurance Opt-In' : (i % 3 === 0 ? 'No Answer' : 'Hung Up'), TALK_PER_CALL);
    }
  }
  if (opts.noise) {
    for (const d of days.slice(0, 5)) {
      emit(d, 'VDAD', '', 'DROP', 'Dropped', 45);                          // system login — excluded by rule
      emit(d, 'CB902TL', TL, 'HU', 'Hung Up', 600);                        // the TL dialling under a CODE-shaped login
      emit(d, TL, TL, 'HU', 'Hung Up', 600);                               // …and under their NAME
      emit(d, 'CB999', 'Ghost Agent', 'HU', 'Hung Up', 900);               // nobody — the only one worth chasing
      emit(d, 'CB910', byCode.CB910.name, 'N', 'No Answer', -30);          // corrupt negative length
    }
  }
  return w(fname, tsv([head, ...rows]));
}

/* --- QA export. Record ID is the evaluation's identity and the dedupe key. --- */
function qaFile(fname, days, opts = {}) {
  const head = ['Record ID','Date of Call','Date of Assessment','Submitted At','Campaign','QA Agent','Sales Agent','Sales Agent CB','Score %','Coaching Category','Escalation Decision','Status','Dispute Count','Dispute Status'];
  const rows = [];
  const every = opts.every || 5;                       // one evaluation per agent per 5 dialling days
  for (let i = 0; i < days.length; i += every) {
    const d = days[i];
    for (const a of CAST) {
      /* The QA system writes the CB its own way too — and for CB95 it pads. */
      const cb = a.code === 'CB95' ? 'CB-095' : a.code.replace('CB', 'CB-');
      const score = a.code === 'CB916' ? 0 : (78 + ((i / every + CAST.indexOf(a)) % 18));   // a real 0% is an outcome, not missing
      rows.push(['E-' + a.code + '-' + d, d, d, d + ' 17:00:00', 'Matrix ' + a.camp, 'QA Bot', a.name, cb,
                 String(score) + '%', 'Objection Handling', score === 0 ? 'Critical Fail' : 'Pass', 'Closed', '0', '']);
    }
  }
  if (opts.noise) {
    const d = days[0];
    rows.push(['E-BLANK-1', d, d, d + ' 17:00:00', 'Matrix Courtesy', 'QA Bot', 'Nobody At All', '', '85%', '', 'Pass', 'Closed', '0', '']);   // no CB -> skipped
    rows.push(['E-GHOST-1', d, d, d + ' 17:00:00', 'Matrix Courtesy', 'QA Bot', 'Ghost Agent', 'CB-999', '91%', '', 'Pass', 'Closed', '0', '']);  // CB on no list
  }
  return w(fname, csv([head, ...rows]));
}

/* ================= build the drop ================= */
const F = {
  rosterAug : rosterFile('Matrix - Agent List 2026-08-03.csv', '08'),
  rosterSep : rosterFile('Matrix - Agent List 2026-09-01.csv', '09'),
  att       : attFile('attendance register 2026-08-03 to 2026-09-12.csv', ATT_DAYS),
  bi        : biFile('BI Active Cases 2026-08 to 2026-09.csv', BI_DAYS, { strangers:true }),
  canc      : cancFile('BI Inactive Cases 2026-09.csv'),
  vici      : viciFile('EXPORT_CALL_REPORT 2026-08-03 2026-09-10.txt', CALL_DAYS, { noise:true }),
  qa        : qaFile('QA evaluations 2026-08 to 2026-09.csv', QA_DAYS, { noise:true }),
};
/* THE DUPLICATE SET — uploaded in round 2, after the clean totals are recorded. */
F.biCopy   = biFile('BI Active Cases 2026-08 to 2026-09 (re-pull).csv', BI_DAYS, { strangers:true });
F.qaCopy   = qaFile('QA evaluations re-pull.csv', QA_DAYS, { noise:true });
{ // the call export appended to itself — every row exactly twice
  const t = fs.readFileSync(F.vici, 'utf8').split(/\r?\n/).filter(Boolean);
  F.viciDoubled = w('EXPORT_CALL_REPORT doubled.txt', [t[0], ...t.slice(1), ...t.slice(1)].join('\n') + '\n');
}

/* ================= SECTION 1 — the source report, computed here ================= */
/* An independent implementation of the six rules under test, run over the fixture ROWS.
   If this and the app agree, the app read the file. If they disagree, one of us is wrong
   and the run says which figure. */
const parseCsv = txt => { const [h, ...ls] = txt.trim().split(/\r?\n/);
  const cols = splitCsvLine(h); return ls.map(l => { const v = splitCsvLine(l);
    return Object.fromEntries(cols.map((c, i) => [c, v[i] ?? ''])); }); };
function splitCsvLine(l) { const out = []; let cur = '', q = false;
  for (let i = 0; i < l.length; i++) { const ch = l[i];
    if (q) { if (ch === '"') { if (l[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch; }
  out.push(cur); return out; }

const VAT = 1.15;
const SRC = { sales:{}, gwp:{}, gwpEx:{}, canc:{}, talk:{}, calls:{}, saleDisp:{}, qaScores:{} };
const bump = (o, c, v) => { o[c] = (o[c] || 0) + v; };

{ // --- sales & GWP from the Power BI rows, per agent, case grain, rounded per ACCOUNT ---
  const rows = parseCsv(fs.readFileSync(F.bi, 'utf8'));
  const perAgent = {};                    // code -> account -> ex-VAT charge
  for (const r of rows) {
    const code = ownerToCode(r.Owner); if (!code) continue;
    const acc = r['Account Number'];
    ((perAgent[code] = perAgent[code] || {})[acc] = (perAgent[code][acc] || 0) + parseFloat(r['Charge Amount']));
    bump(SRC.sales, code, 1);             // one case per row in this fixture
  }
  for (const code in perAgent) { let ex = 0, inc = 0;
    for (const acc in perAgent[code]) { ex += perAgent[code][acc]; inc += Math.round(perAgent[code][acc] * VAT); }
    SRC.gwpEx[code] = ex; SRC.gwp[code] = inc; }
}
{ // --- cancellations, counted per CASE, filed on the day the SALE was made ---
  for (const r of parseCsv(fs.readFileSync(F.canc, 'utf8'))) {
    const code = ownerToCode(r.Owner); if (code) bump(SRC.canc, code, 1);
  }
}
{ // --- talk, calls and sale dispositions from the per-call export ---
  const lines = fs.readFileSync(F.vici, 'utf8').trim().split(/\r?\n/);
  const cols = lines[0].split('\t');
  const seen = new Set();
  const SYS = new Set(['VDAD','VDCL','VDLB','CBT001','CBT003','CBT005','CBT007','9027']);
  for (const l of lines.slice(1)) {
    const r = Object.fromEntries(cols.map((c, i) => [c, l.split('\t')[i] ?? '']));
    const key = r.call_date + '|' + r.user + '|' + r.lead_id + '|' + r.status.toUpperCase();
    if (seen.has(key)) continue; seen.add(key);
    if (SYS.has(r.user.toUpperCase())) continue;
    /* THE AGENT LIST DECIDES, NOT THE EXPORT — full_name first, login second. */
    const code = nameToCode(r.full_name) || loginToCode(r.user);
    if (!code) continue;
    let secs = parseInt(r.length_in_sec, 10); if (!isFinite(secs) || secs < 0) secs = 0;
    bump(SRC.talk, code, secs); bump(SRC.calls, code, 1);
    if (/sale/i.test(r.status_name) && !/^no sale/i.test(r.status_name)) bump(SRC.saleDisp, code, 1);
  }
}
{ // --- QA: mean of the agent's own evaluations; a 0% is kept ---
  const ids = new Set();
  for (const r of parseCsv(fs.readFileSync(F.qa, 'utf8'))) {
    if (ids.has(r['Record ID'])) continue; ids.add(r['Record ID']);
    const m = String(r['Sales Agent CB']).match(/(\d+)/); if (!m) continue;
    const code = 'CB' + parseInt(m[1], 10);                 // padding-insensitive, as identity resolution is everywhere else
    const sc = parseFloat(r['Score %']); if (!isFinite(sc)) continue;
    (SRC.qaScores[code] = SRC.qaScores[code] || []).push(sc);
  }
}
const SRC_QA = Object.fromEntries(Object.entries(SRC.qaScores).map(([c, a]) => [c, a.reduce((x, y) => x + y, 0) / a.length]));

/* ---- THE PROVISIONAL FALLBACK, modelled here because the app applies it ----------------
   On a day the money file does not cover, the engine falls back to the dialler's SALE
   dispositions and prices them at a FLAT S.gwpPerUnit (R89), marking the row provisional.
   The pilot window is ragged on purpose, so four dialling days (6–10 Sep) are priced this
   way. Modelled explicitly rather than tolerated, because the size of it is a finding:
   a team leader looking at the month sees measured money and assumed money added together. */
const GWP_PER_UNIT = 89;
const PROV_DAYS = CALL_DAYS.filter(d => !BI_DAYS.includes(d));
const PROV = { sales:{}, gwp:{} };
for (const d of PROV_DAYS) for (const a of CAST) { const n = SPD[a.code] || 0; if (!n) continue;
  bump(PROV.sales, a.code, n); bump(PROV.gwp, a.code, n * GWP_PER_UNIT); }
/* what the app should report = measured (BI) + provisional (dialler-priced) */
const EXP = { sales:{}, gwp:{} };
for (const a of CAST) { EXP.sales[a.code] = (SRC.sales[a.code] || 0) + (PROV.sales[a.code] || 0);
  EXP.gwp[a.code] = (SRC.gwp[a.code] || 0) + (PROV.gwp[a.code] || 0); }

/* the resolver this harness uses — deliberately the DOCTRINE, not the app's implementation */
function normName(s) { return String(s || '').toLowerCase().replace(/cb[\s-]*\d+/g, '').replace(/[^a-z]/g, ''); }
function nameToCode(n) { if (!n) return null; const k = normName(n);
  for (const a of CAST) if (normName(a.name) === k) return a.code;
  for (const c in AUG_NAME) if (normName(AUG_NAME[c]) === k) return c;              // a spelling this code used to carry
  // near spelling / middle name, unique-or-nothing
  /* EITHER DIRECTION (the app's rule): every token of one name must find a token of the
     other, so a middle name on either side is tolerated. Unique-or-nothing. */
  const t = String(n).toLowerCase().split(/\s+/).filter(Boolean);
  if (t.length < 2) return null;
  const fits = (x, y) => x.every(a => y.some(b => tokNear(a, b)));
  const hits = CAST.filter(a => { const at = a.name.toLowerCase().split(/\s+/);
    return fits(t, at) || fits(at, t); });
  return hits.length === 1 ? hits[0].code : null; }
function tokNear(a, b) { if (a === b) return true;
  if (a.length < 4 || b.length < 4 || Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) { const d = []; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { d.push(i); if (d.length > 2) return false; }
    if (d.length <= 1) return true;
    return d.length === 2 && d[1] === d[0] + 1 && a[d[0]] === b[d[1]] && a[d[1]] === b[d[0]]; }   // adjacent transposition
  const [s, L] = a.length < b.length ? [a, b] : [b, a];
  for (let i = 0; i <= s.length; i++) if (L.slice(0, i) + L.slice(i + 1) === s) return true;
  return false; }
function loginToCode(u) { const m = String(u).match(/^CB[\s-]*(\d+)$/i); if (!m) return null;
  const c = 'CB' + parseInt(m[1], 10); return byCode[c] ? c : null; }
function ownerToCode(o) { return nameToCode(o); }

/* ================= harness ================= */
let pass = 0, fail = 0; const failures = [], notes = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ' + n); }
  else { fail++; failures.push(n + (d ? ' — ' + d : '')); console.log('  FAIL ' + n + (d ? ' — ' + d : '')); } };
const near = (a, b, tol = 0.51) => Math.abs((a || 0) - (b || 0)) <= tol;

const SERVE = { '/': HTML, '/index.html': HTML, '/xlsx.full.min.js': path.join(REPO, 'site', 'xlsx.full.min.js') };
const server = http.createServer((q, s) => { const p = SERVE[q.url.split('?')[0]];
  if (!p || !fs.existsSync(p)) { s.writeHead(404); s.end('nf'); return; }
  s.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' });
  fs.createReadStream(p).pipe(s); });
await new Promise(r => server.listen(8191, '127.0.0.1', r));

/* The container ships Chromium at a fixed path that may not match the playwright build
   number npm resolved; point at it when the bundled one is absent rather than downloading. */
const PW_ARGS = { args: ['--js-flags=--max-old-space-size=8192', '--no-sandbox'] };
for (const p of ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome']) if (fs.existsSync(p)) PW_ARGS.executablePath = p;
const browser = await chromium.launch(PW_ARGS);
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = []; page.on('pageerror', e => errors.push(e.message));
page.on('dialog', d => d.accept());
await page.goto('http://127.0.0.1:8191/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__mtd && window.__mtd.state(), null, { timeout: 30000 });
await page.evaluate(() => { try { localStorage.clear(); } catch (e) {}
  const S = window.__mtd.state();
  ['calls','callsMeta','sales','att','evals','tracker','cancRows','vici','viciDays','orgHist','aliases','map','refs','leavers'].forEach(k => S[k] = {});
  S.files = []; S.roster = []; S.ui.asAt = ''; });

async function upload(files) {
  await page.setInputFiles('#fileInput', files, { timeout: 180000 });
  let last = -1, stable = 0;
  for (let i = 0; i < 200; i++) { await page.waitForTimeout(400);
    const n = await page.evaluate(() => window.__mtd.state().files.length);
    if (n === last) { if (++stable >= 5) break; } else { stable = 0; last = n; } }
}
async function readModel(period) {
  await page.evaluate(p => window.__mtd.setRange(p.from, p.to), { from: FROM, to: TO });
  await page.waitForTimeout(800);
  return page.evaluate(() => {
    const M = window.__mtd.model(), S = window.__mtd.state();
    const perAgent = {};
    for (const f of M.facts) {
      const o = perAgent[f.code] = perAgent[f.code] || { code:f.code, agent:f.agent, tl:f.tl, tlNow:f.tlNow, campaign:f.campaign,
        tenure:f.tenure, emp:0, act:0, target:0, sales:0, gwp:0, gwpEx:0, talk:0, calls:0, ans:0, opt:0, canc:0, days:0, tls:{}, camps:{} };
      o.emp += f.emp; o.act += f.act; o.target += f.target; o.sales += f.sales; o.gwp += f.gwp;
      o.gwpEx += (f.gwpEx || 0); o.talk += f.talk; o.calls += (f.calls || 0); o.ans += (f.ans || 0);
      o.opt += (f.opt || 0); o.canc += f.canc; o.days++;
      o.tls[f.tl] = (o.tls[f.tl] || 0) + f.sales; o.camps[f.campaign] = (o.camps[f.campaign] || 0) + 1;
    }
    for (const c in perAgent) { const q = M.qaFor(c, M.range.from, M.range.to); perAgent[c].qa = q ? q.avg * 100 : null; perAgent[c].qaN = q ? q.n : 0; }
    let evalRows = 0; const evalCodes = {};
    for (const d in S.evals) for (const c in S.evals[d]) { evalRows += S.evals[d][c].length; evalCodes[c] = (evalCodes[c] || 0) + S.evals[d][c].length; }
    return { perAgent, unmatched: M.unmatched || {}, near: M.near || {}, tlAgg: M.tlAgg, campAgg: M.campAgg,
      grand: M.grand, range: M.range, dates: M.dates.length, newCampaigns: M.newCampaigns || [],
      roster: S.roster.map(a => ({ code:a.code, name:a.name, tl:a.tl, campaign:a.campaign })),
      orgHist: S.orgHist, evalRows, evalCodes, files: S.files.map(f => ({ name:f.name, type:f.type, rows:f.rows })),
      factRows: M.facts.length, tlMoved: M.tlMoved || [],
      sourceEnds: { att: Object.keys(S.att).sort().pop() || null, sales: Object.keys(S.sales).sort().pop() || null, calls: Object.keys(S.calls).sort().pop() || null },
      vat: window.__mtd.vat(), checks: (window.__mtd.checks() || []).map(c => ({ id:c.id, sev:c.sev, ok:c.ok, name:c.name, detail:c.detail })),
      digest: (() => { try { return window.__mtd.digest(); } catch (e) { return { error: String(e && e.message || e) }; } })(),
      composites: Object.fromEntries((M.agents || []).map(a => { let c = null; try { c = window.__mtd.composite(a.code); } catch (e) {} return [a.code, c]; })) };
  });
}

/* ================= ROUND 1 — the clean drop ================= */
console.log('\n================ THE DENISE PILOT — ' + FROM + ' to ' + TO + ' ================');
console.log('cast: ' + CAST.length + ' agents · dialling days: ' + ALLDAYS.length +
  ' (Aug ' + AUG.length + ' / Sep ' + SEP.length + ') · Saturdays: ' + ALLDAYS.filter(isSat).length);
console.log('\n-- uploading the pilot drop (roster Aug, roster Sep, attendance, BI active, BI inactive, ViciDial, QA)');
await upload([F.rosterAug, F.att, F.bi, F.canc, F.vici, F.qa, F.rosterSep]);
const R1 = await readModel();
console.log('   files loaded: ' + R1.files.length + ' · fact rows: ' + R1.factRows + ' · dates in period: ' + R1.dates);
console.log('   ' + R1.files.map(f => f.type + '(' + f.rows + ')').join(' · '));

/* ---------- JOIN 1: agent identity ---------- */
console.log('\n-- JOIN 1 · agent identity (does a row find its agent?)');
for (const a of CAST) {
  const got = R1.perAgent[a.code];
  ok('[' + a.code + '] ' + a.name + ' has a fact row', !!got, a.role);
}
ok('the zero-padded dialler login CB095 lands on CB95',
  (R1.perAgent.CB95?.talk || 0) > 0, 'talk=' + (R1.perAgent.CB95?.talk || 0));
ok('the near spelling "Roshel Dinika Naidoo" lands CB911’s money',
  (R1.perAgent.CB911?.sales || 0) === EXP.sales.CB911, 'app=' + (R1.perAgent.CB911?.sales || 0) + ' expected=' + EXP.sales.CB911);
ok('the transposition "Lindokhule" lands CB912’s talk',
  (R1.perAgent.CB912?.talk || 0) === SRC.talk.CB912, 'app=' + (R1.perAgent.CB912?.talk || 0) + ' source=' + SRC.talk.CB912);
ok('the dropped middle name lands CB913’s talk',
  (R1.perAgent.CB913?.talk || 0) === SRC.talk.CB913, 'app=' + (R1.perAgent.CB913?.talk || 0) + ' source=' + SRC.talk.CB913);
ok('the WRONG LOGIN is corrected by name — CB915 keeps her own talk',
  (R1.perAgent.CB915?.talk || 0) === SRC.talk.CB915, 'app=' + (R1.perAgent.CB915?.talk || 0) + ' source=' + SRC.talk.CB915);
ok('…and CB916 is not paid CB915’s calls',
  (R1.perAgent.CB916?.talk || 0) === SRC.talk.CB916, 'app=' + (R1.perAgent.CB916?.talk || 0) + ' source=' + SRC.talk.CB916);
ok('the renamed agent CB917 keeps the money sold under the old spelling',
  (R1.perAgent.CB917?.sales || 0) === EXP.sales.CB917, 'app=' + (R1.perAgent.CB917?.sales || 0) + ' expected=' + EXP.sales.CB917);

/* ---------- JOIN 2: team ---------- */
console.log('\n-- JOIN 2 · team (does the agent find the leader who owned them THAT DAY?)');
for (const a of CAST) { const g = R1.perAgent[a.code]; if (!g) continue;
  const expect = a.code === 'CB918' ? TL_OTHER : TL;          // the mover is Sharoma's for August
  ok('[' + a.code + '] August work is attributed to ' + expect,
    Object.keys(g.tls).includes(expect) || (a.code !== 'CB918' && Object.keys(g.tls).every(t => t === TL)),
    'leaders seen: ' + JSON.stringify(g.tls)); }
const moverTLs = Object.keys(R1.perAgent.CB918?.tls || {});
ok('the MOVER is split across two leaders, not re-attributed wholesale',
  moverTLs.includes(TL_OTHER) && moverTLs.includes(TL), 'saw ' + JSON.stringify(R1.perAgent.CB918?.tls));
ok('the September list did NOT drag August’s sales to Denise',
  (R1.perAgent.CB918?.tls?.[TL_OTHER] || 0) > 0, JSON.stringify(R1.perAgent.CB918?.tls));

/* ---------- JOIN 3: campaign ---------- */
console.log('\n-- JOIN 3 · campaign');
for (const a of CAST) { const g = R1.perAgent[a.code]; if (!g) continue;
  ok('[' + a.code + '] campaign reads ' + a.camp, Object.keys(g.camps).length === 1 && g.camps[a.camp] != null,
    'saw ' + JSON.stringify(g.camps)); }
ok('the campaign new to the rule book is REPORTED, not swallowed into Courtesy',
  !!R1.perAgent.CB917 && Object.keys(R1.perAgent.CB917.camps)[0] === 'Download & Test',
  'newCampaigns=' + JSON.stringify(R1.newCampaigns) + ' saw=' + JSON.stringify(R1.perAgent.CB917?.camps));

/* ---------- JOIN 4: interaction ---------- */
console.log('\n-- JOIN 4 · interaction (per-call export -> agent-day)');
for (const a of CAST) { const g = R1.perAgent[a.code]; if (!g) continue;
  ok('[' + a.code + '] talk time reconciles with the file', g.talk === (SRC.talk[a.code] || 0),
    'app=' + g.talk + ' source=' + (SRC.talk[a.code] || 0));
  ok('[' + a.code + '] call count reconciles with the file', g.calls === (SRC.calls[a.code] || 0),
    'app=' + g.calls + ' source=' + (SRC.calls[a.code] || 0)); }
ok('the corrupt negative length is zeroed, not subtracted',
  (R1.perAgent.CB910?.talk || 0) === SRC.talk.CB910, 'app=' + (R1.perAgent.CB910?.talk || 0) + ' source=' + SRC.talk.CB910);

/* ---------- JOIN 5: sale / money ---------- */
console.log('\n-- JOIN 5 · sale and money (Power BI Active ∪ Inactive)');
console.log('   measured days (Power BI): ' + BI_DAYS.length + ' · dialler-priced days: ' + PROV_DAYS.length +
  ' (' + (PROV_DAYS[0] || '-') + '\u2026' + (PROV_DAYS[PROV_DAYS.length - 1] || '-') + ') @ R' + GWP_PER_UNIT + '/sale');
for (const a of CAST) { const g = R1.perAgent[a.code]; if (!g) continue;
  ok('[' + a.code + '] sales reconcile (measured ' + (SRC.sales[a.code] || 0) + ' + provisional ' + (PROV.sales[a.code] || 0) + ')',
    g.sales === EXP.sales[a.code], 'app=' + g.sales + ' expected=' + EXP.sales[a.code]);
  ok('[' + a.code + '] GWP reconciles (measured R' + (SRC.gwp[a.code] || 0) + ' + assumed R' + (PROV.gwp[a.code] || 0) + ')',
    near(g.gwp, EXP.gwp[a.code], 1.01), 'app=' + Math.round(g.gwp) + ' expected=' + EXP.gwp[a.code]); }
/* THE SIZE OF THE ASSUMPTION, stated as a number rather than left in a footnote. */
{ const mg = Object.values(SRC.gwp).reduce((a, b) => a + b, 0), pg = Object.values(PROV.gwp).reduce((a, b) => a + b, 0);
  console.log('   team GWP on screen R' + (mg + pg) + ' = R' + mg + ' measured + R' + pg + ' assumed (' +
    (100 * pg / (mg + pg)).toFixed(1) + '% of the figure)');
  notes.push('PROVISIONAL MONEY: ' + (100 * pg / (mg + pg)).toFixed(1) + '% of the pilot team\u2019s GWP (R' + pg +
    ' of R' + (mg + pg) + ') is dialler-priced at a flat R' + GWP_PER_UNIT + ', not read from the money source, because the Power BI file stops ' +
    PROV_DAYS.length + ' dialling days short of the dialler.'); }
for (const c of ['CB910', 'CB911']) ok('[' + c + '] the cancellation is counted once',
  (R1.perAgent[c]?.canc || 0) === (SRC.canc[c] || 0), 'app=' + (R1.perAgent[c]?.canc || 0) + ' source=' + (SRC.canc[c] || 0));

/* ---------- JOIN 6: QA ---------- */
console.log('\n-- JOIN 6 · QA evaluation -> agent');
for (const a of CAST) { const g = R1.perAgent[a.code]; if (!g) continue;
  const exp = SRC_QA[a.code];
  ok('[' + a.code + '] QA average reconciles', exp == null ? g.qa == null : near(g.qa, exp, 0.05),
    'app=' + (g.qa == null ? 'null' : g.qa.toFixed(2)) + ' source=' + (exp == null ? 'null' : exp.toFixed(2)) + ' n=' + g.qaN); }
ok('a real 0% QA score is kept, not dropped as missing data',
  (R1.perAgent.CB916?.qaN || 0) > 0 && R1.perAgent.CB916.qa < 50,
  'CB916 qa=' + R1.perAgent.CB916?.qa + ' n=' + R1.perAgent.CB916?.qaN);

/* ---------- SECTION 5: unmatched census ---------- */
console.log('\n-- UNMATCHED ROWS (the exception register)');
const un = Object.entries(R1.unmatched).map(([k, v]) => ({ key:k, ...v }));
un.sort((a, b) => (b.n || 0) - (a.n || 0));
for (const u of un) console.log('   · ' + u.key + '  [' + u.src + ']  n=' + u.n +
  (u.gwp ? ' gwp=R' + Math.round(u.gwp) : '') + (u.talk ? ' talk=' + u.talk + 's' : '') + (u.kind ? ' — ' + u.kind : ''));
const unKey = k => un.find(u => u.key === k || normName(u.key) === normName(k));
ok('the stranger owning real money is reported, not invented onto the roster',
  !!unKey('Nomsa Zikalala') && unKey('Nomsa Zikalala').src === 'sales', JSON.stringify(un.map(u => u.key)));
ok('the ambiguous surname resolves to NOBODY and is reported', !!unKey('Naidoo'),
  'unique-or-nothing: a bare surname must not be guessed');
ok('the unknown dialler login is named as "missing from the Agent List"',
  !!un.find(u => u.src === 'calls' && u.kind === 'missing from the Agent List'),
  JSON.stringify(un.filter(u => u.src === 'calls').map(u => u.key + ':' + u.kind)));
ok('a team leader dialling under their NAME is classified as a leader',
  !!un.find(u => u.src === 'calls' && u.kind === 'team leader'),
  JSON.stringify(un.filter(u => u.src === 'calls').map(u => u.key + ':' + u.kind)));
{ const codeShaped = un.find(u => u.src === 'calls' && /^CB\d+[A-Z]+$/i.test(u.key));
  ok('a team leader dialling under a CODE-shaped login is also classified as a leader',
    !codeShaped || codeShaped.kind === 'team leader',
    (codeShaped ? codeShaped.key + ' reads "' + codeShaped.kind + '"' : 'n/a') +
    ' \u2014 the code path needs S.tlCbs from the Worker\u2019s /api/roster, which a file-only run has not got');
  if (codeShaped && codeShaped.kind !== 'team leader')
    notes.push('TL LOGIN CLASSIFICATION: a leader dialling under a code-shaped login (' + codeShaped.key +
      ') reads as "missing from the Agent List" until S.tlCbs arrives from /api/roster \u2014 ' +
      Math.round(codeShaped.talk / 60) + ' minutes shown as a roster defect that is not one.'); }
ok('the system login (VDAD) never reaches the unmatched register',
  !un.find(u => /VDAD/i.test(u.key) && u.kind !== 'system login'), 'excluded by rule at ingest');
/* THE QA HALF OF THE REGISTER — the question this pilot exists to ask. */
const qaGhost = Object.keys(R1.evalCodes).filter(c => !byCode[c]);
console.log('   QA rows stored against a code no list names: ' + (qaGhost.length ? qaGhost.join(', ') : 'none'));
ok('a QA evaluation for an unknown agent appears in the exception register',
  !!un.find(u => u.src === 'qa' || u.src === 'evals'),
  'QA codes with no roster row: ' + JSON.stringify(qaGhost) + ' · M.unmatched has no QA source');

/* ---------- near-spelling register ---------- */
console.log('\n-- MATCHED BY SPELLING (every inference is reported)');
for (const [k, v] of Object.entries(R1.near)) console.log('   · ' + k + ' -> ' + JSON.stringify(v));
ok('the near-spelling match is REPORTED, not applied silently', Object.keys(R1.near).length > 0,
  'M.near = ' + JSON.stringify(R1.near));

/* ---------- SECTION 6: formulas ---------- */
console.log('\n-- FORMULAS');
const satAug = AUG.filter(isSat).length, satSep = SEP.filter(isSat).length;
/* A DAY ONLY EXISTS IF SALES, CALLS OR A TRACKER ROW CARRY IT (allDataDates). The HR
   register alone does not create one — so the period's shift denominator follows the
   DIALLER's reach, not the register's. Modelled here so the gap is a number. */
const MODEL_DAYS = [...new Set([...BI_DAYS, ...CALL_DAYS])].sort();
const expEmpClean = MODEL_DAYS.filter(d => !(isSat(d) && d >= '2026-09-01')).length;
const registerOnly = ATT_DAYS.filter(d => !MODEL_DAYS.includes(d));
for (const a of CAST) { const g = R1.perAgent[a.code]; if (!g) continue;
  ok('[' + a.code + '] Employed Shifts = model days − September Saturdays', near(g.emp, expEmpClean, 0.01),
    'app=' + g.emp + ' expected=' + expEmpClean); }
console.log('   register days the model never sees: ' + (registerOnly.join(', ') || 'none'));
ok('the register-only tail is EXCLUDED from Employed Shifts (documented, and a reconciliation gap)',
  registerOnly.length > 0 && near(R1.perAgent.CB910.emp, expEmpClean, 0.01),
  'HR says employed on ' + registerOnly.join(', ') + '; the dashboard has no row for those days');
if (registerOnly.length) notes.push('SHIFT DENOMINATOR: ' + registerOnly.length + ' day(s) (' + registerOnly.join(', ') +
  ') sit in the HR register but in no fact row, because the model\u2019s calendar is built from sales/calls/tracker only. ' +
  'Employed Shifts — and every target multiplied out of it — therefore grows as the dialler catches up.');
const TM = { 'Cuddle|Exp':8, 'Courtesy|Exp':5, 'Courtesy|M2':4, 'Courtesy|M1':3, 'Nesting|M0':2 };
for (const a of CAST) { const g = R1.perAgent[a.code]; if (!g) continue;
  const per = TM[a.camp + '|' + a.ten]; if (per == null) continue;
  ok('[' + a.code + '] Sales Target = ' + per + '/day × Employed Shifts', near(g.target, per * g.emp, 0.02),
    'app=' + g.target + ' expected=' + (per * g.emp)); }
ok('GWP grosses up EX-VAT charges by the rule-book VAT, rounded per account',
  near(R1.perAgent.CB910.gwp - (PROV.gwp.CB910 || 0), SRC.gwp.CB910, 1.01),
  'measured part app=' + Math.round(R1.perAgent.CB910.gwp - (PROV.gwp.CB910 || 0)) + ' source=' + SRC.gwp.CB910 +
  ' (' + SRC.sales.CB910 + ' × ROUND(' + CHARGE + '×' + R1.vat + ') = R99)');
ok('the engine grosses up with the rule-book VAT, not a scattered literal', R1.vat === 1.15, 'MTD_VAT=' + R1.vat);
ok('a September Saturday carries its data but no shift',
  MODEL_DAYS.filter(d => isSat(d) && d >= '2026-09-01').length > 0,
  'excluded: ' + MODEL_DAYS.filter(d => isSat(d) && d >= '2026-09-01').join(', ') +
  ' · kept: ' + MODEL_DAYS.filter(d => isSat(d) && d < '2026-09-01').join(', '));
ok('Attendance % = Actual ÷ Employed, both over the same days',
  R1.perAgent.CB910.act <= R1.perAgent.CB910.emp && R1.perAgent.CB910.emp > 0,
  'emp=' + R1.perAgent.CB910.emp + ' act=' + R1.perAgent.CB910.act + ' = ' +
  (100 * R1.perAgent.CB910.act / R1.perAgent.CB910.emp).toFixed(1) + '%');

/* ---------- SECTION 7: coverage & staleness ---------- */
console.log('\n-- COVERAGE (the sources do not end on the same day, and must say so)');
console.log('   attendance reaches ' + R1.sourceEnds.att + ' · dialler ' + R1.sourceEnds.calls + ' · money ' + R1.sourceEnds.sales);
ok('the register reaches further than the dialler', R1.sourceEnds.att > R1.sourceEnds.calls,
  R1.sourceEnds.att + ' vs ' + R1.sourceEnds.calls);
ok('the dialler reaches further than the money file', R1.sourceEnds.calls > R1.sourceEnds.sales,
  R1.sourceEnds.calls + ' vs ' + R1.sourceEnds.sales);
ok('the money source stops on the day the file stops — no phantom days',
  R1.sourceEnds.sales === BI_DAYS[BI_DAYS.length - 1], 'app=' + R1.sourceEnds.sales + ' file=' + BI_DAYS[BI_DAYS.length - 1]);

/* ================= ROUND 2 — the duplicate set ================= */
console.log('\n================ ROUND 2 — every file uploaded AGAIN ================');
await upload([F.biCopy, F.qaCopy, F.viciDoubled]);
const R2 = await readModel();
for (const a of CAST) { const g1 = R1.perAgent[a.code], g2 = R2.perAgent[a.code]; if (!g1 || !g2) continue;
  ok('[' + a.code + '] sales did not double', g1.sales === g2.sales, g1.sales + ' -> ' + g2.sales);
  ok('[' + a.code + '] GWP did not double', near(g1.gwp, g2.gwp, 1.01), Math.round(g1.gwp) + ' -> ' + Math.round(g2.gwp));
  ok('[' + a.code + '] talk did not double', g1.talk === g2.talk, g1.talk + ' -> ' + g2.talk);
  ok('[' + a.code + '] QA n did not double', g1.qaN === g2.qaN, g1.qaN + ' -> ' + g2.qaN); }
ok('the evaluation store holds each Record ID once', R1.evalRows === R2.evalRows, R1.evalRows + ' -> ' + R2.evalRows);
ok('no agent appears twice on the roster',
  new Set(R2.roster.map(r => r.code)).size === R2.roster.length, JSON.stringify(R2.roster.map(r => r.code)));

/* ================= ROUND 3 — what the defects COST, in points and rands =================
   A finding without a number is an opinion. Round 3 re-uploads two corrected files and
   measures the difference the correction makes to the figures an agent and a team leader
   actually read. */
console.log('\n================ ROUND 3 — the cost of the findings ================');
const before95 = R2.perAgent.CB95 ? JSON.parse(JSON.stringify(R1.digest.agents.find(a => a.code === 'CB95'))) : null;
const beforeComp95 = R1.composites.CB95;
/* (a) the SAME evaluations, with the CB written unpadded. Nothing else changes. */
{
  const txt = fs.readFileSync(F.qa, 'utf8').replace(/CB-095/g, 'CB-95');
  F.qaUnpadded = w('QA evaluations (CB written unpadded).csv', txt);
}
await upload([F.qaUnpadded]);
const R3 = await readModel();
const after95 = R3.digest.agents.find(a => a.code === 'CB95');
const afterComp95 = R3.composites.CB95;
console.log('   CB95 QA   : ' + (before95?.qa ?? 'null') + '  ->  ' + (after95?.qa ?? 'null'));
console.log('   CB95 score: ' + (before95?.score ?? '?') + '  ->  ' + (after95?.score ?? '?'));
console.log('   CB95 composite: ' + (beforeComp95?.score ?? '?') + ' (' + (beforeComp95?.band ?? '?') + ', ' +
  beforeComp95?.weightScored + '% of the framework scored)  ->  ' + (afterComp95?.score ?? '?') + ' (' +
  (afterComp95?.band ?? '?') + ', ' + afterComp95?.weightScored + '%)');
ok('the SAME evaluations reach the agent once the CB is written unpadded',
  (after95?.qa != null) && (before95?.qa == null),
  'before=' + (before95?.qa ?? 'null') + ' after=' + (after95?.qa ?? 'null'));
ok('the padded-CB defect is worth measuring, not theoretical',
  Math.abs((afterComp95?.score || 0) - (beforeComp95?.score || 0)) > 1,
  'composite moved ' + ((afterComp95?.score || 0) - (beforeComp95?.score || 0)).toFixed(1) + ' points');
if (after95?.qa != null && before95?.qa == null)
  notes.push('QA IDENTITY: the QA ingest is the only join in the system that does not go through resolveKey. ' +
    'It builds the code from the digits of "Sales Agent CB" alone \u2014 so CB-095 is stored as CB095 and never meets the ' +
    'Agent List\u2019s CB95. The agent\u2019s own card read "QA \u2014 not measured" for the whole pilot; correcting the ' +
    'spelling of the code alone moved the composite ' + ((afterComp95?.score || 0) - (beforeComp95?.score || 0)).toFixed(1) +
    ' points (' + beforeComp95?.band + ' \u2192 ' + afterComp95?.band + ') and the framework scored from ' +
    beforeComp95?.weightScored + '% to ' + afterComp95?.weightScored + '%.');

/* (b) the new campaign with no rule-book target row and no Target cell on the list. */
{ const dt = R3.digest.tlAgg.find(r => r.camp === 'Download & Test');
  console.log('   Download & Test: ' + (dt ? dt.sales + ' sales against target ' + dt.target + ', %-to-target ' + dt.pctT : 'absent'));
  ok('a campaign new to the rule book still gets a sales target',
    !!dt && dt.target > 0, dt ? 'target=' + dt.target + ' pctT=' + dt.pctT +
      ' \u2014 no salesTargetMatrix row for "Download & Test|Exp" and the Agent List Target cell is blank' : 'no row');
  if (dt && !(dt.target > 0)) notes.push('NEW-CAMPAIGN TARGET: "Download & Test" is reported (correctly) but has no row in ' +
    'MTD_RULES.salesTargetMatrix and no Target cell on the Agent List, so its sales target is 0 and every %-to-target on ' +
    'that team section is blank \u2014 ' + dt.sales + ' sales measured against nothing.'); }

/* (c) the mover counted in two teams over a window that spans the move. */
{ const den = R3.digest.tlAgg.filter(r => r.tl === TL).reduce((n, r) => n + r.hc, 0);
  const sha = R3.digest.tlAgg.filter(r => r.tl === TL_OTHER).reduce((n, r) => n + r.hc, 0);
  console.log('   headcount over the window: ' + TL + ' ' + den + ' + ' + TL_OTHER + ' ' + sha + ' = ' + (den + sha) +
    ' for ' + CAST.length + ' people');
  ok('a leader\u2019s headcount over a window spanning a move counts the mover in BOTH teams',
    den + sha === CAST.length + 1, den + ' + ' + sha + ' vs ' + CAST.length + ' agents');
  notes.push('TL HEADCOUNT: over a window that spans a movement, headcount is "agents who worked for me at any point" (' +
    (den + sha) + ' rows for ' + CAST.length + ' people), not "my team today". The sales split is correct; the head count is a ' +
    'different question and the team-leader view should say which one it is answering.'); }

/* ================= evidence ================= */
console.log('\n-- page errors: ' + (errors.length ? errors.slice(0, 5).join(' | ') : 'none'));
ok('no uncaught page error during the run', errors.length === 0, errors.slice(0, 3).join(' | '));

const evidence = {
  generated: new Date().toISOString(), window: { from: FROM, to: TO },
  days: { all: ALLDAYS.length, aug: AUG.length, sep: SEP.length, saturdays: ALLDAYS.filter(isSat).length,
          satAug, satSep, attendance: ATT_DAYS.length, calls: CALL_DAYS.length, bi: BI_DAYS.length, qa: QA_DAYS.length },
  cast: CAST, files: R1.files, source: { ...SRC, qaMean: SRC_QA },
  round1: R1, round2: { perAgent: R2.perAgent, evalRows: R2.evalRows },
  round3: { perAgent: R3.perAgent, digestAgents: R3.digest.agents, tlAgg: R3.digest.tlAgg, composites: R3.composites },
  impact: { cb95: { before: { qa: before95?.qa ?? null, score: before95?.score ?? null, composite: beforeComp95 },
                    after:  { qa: after95?.qa ?? null,  score: after95?.score ?? null,  composite: afterComp95 } } },
  expected: EXP, provisional: PROV, modelDays: MODEL_DAYS, registerOnly, notes,
  unmatched: un, nearSpelling: R1.near, qaOrphans: qaGhost,
  result: { pass, fail, failures }, pageErrors: errors,
};
fs.writeFileSync(path.join(FIX, 'evidence.json'), JSON.stringify(evidence, null, 2));

console.log('\n================================================================');
console.log('  ' + pass + ' passed · ' + fail + ' failed');
if (failures.length) { console.log('\n  FAILURES:'); failures.forEach(f => console.log('   · ' + f)); }
if (notes.length) { console.log('\n  FINDINGS:'); notes.forEach(n => console.log('   \u00b7 ' + n)); }
console.log('\n  evidence -> ' + path.relative(REPO, path.join(FIX, 'evidence.json')));
await browser.close(); server.close();
process.exit(fail ? 1 : 0);
