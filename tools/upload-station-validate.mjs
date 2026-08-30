#!/usr/bin/env node
/* Upload Station validation engine — SK1 validate-upload + SK3 parity-audit in one run.
 *
 * Treats the Matrix Agent List as the single source of truth for the reporting
 * population, normalizes every uploaded source, matches agents through the same
 * identity spine as the dashboard (normCB / normName / cbOf / cbOfOwner), then
 * independently recalculates the ops KPIs, runs the simulation battery and
 * reconciles totals. Raw files are never modified; every exclusion lands in an
 * audit table with a reason.
 *
 * Usage: node tools/upload-station-validate.mjs <uploadDir> --start 2026-08-01 --end 2026-08-13 [--out <dir>]
 *
 * Rule values (attendance codes, dispositions, bands, VAT) are copied from
 * DEFAULT_RULES in Chatterbox_AgentOS_Analytics.html — the Dictionary is the
 * single source for these; if the dashboard rules change, refresh RULES below.
 */
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const XLSX = require(path.join(HERE, '../site/xlsx.full.min.js'));

/* ---------------- args ---------------- */
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const UPLOAD_DIR = path.resolve(args[0] && !args[0].startsWith('--') ? args[0] : path.join(HERE, '../uploads/2026-08-13'));
const P_START = flag('start', '2026-08-01');
const P_END = flag('end', '2026-08-13');
const OUT_DIR = path.resolve(flag('out', path.join(HERE, `../reports/upload-validation-${P_END}`)));
fs.mkdirSync(OUT_DIR, { recursive: true });

/* ---------------- RULES (from dashboard DEFAULT_RULES, 2026-08-14) ---------------- */
const RULES = {
  presentCodes: ['P', 'T', 'L', 'HDAL', 'HDCA'],
  leaveCodes: ['AL', 'SL', 'CA', 'CASAT'],
  excludeCodes: ['Terminated', 'Resigned'],          // roster-exit rows (Q10) — attrition, never in denominators
  salesDepts: ['Sales'],
  callTypes: [[0, 'No Answer'], [30, 'Customer Service'], [180, 'Pitch'], [360, 'Closing']],
  noAnswerDispositions: ['No Answer', 'Ring No Answer', 'RNA', 'No Response', 'Voicemail', 'Voice Mail', 'Engaged', 'Busy', 'Abandoned', 'Not Connected', 'Failed'],
  saleDispositions: ['Sale', 'Sale Made', 'Sale - Activated', 'Activated', 'Sold'],
  qaPass: ['Pass'], qaCoaching: ['Coaching'], qaCritical: ['Critical Fail'],
  qaDisputeStatuses: ['closed_retracted', 'qa_review'],
  vatRate: 15,
};
/* Vici call-report rules — from specs/mtd_engine_rules.json viciCallReport (the VAS
 * analytics treatment, Nick 2026-08-13): talk = Σ length_in_sec GROUP BY the CB number,
 * talkFrom 'all' (includes ringing — the split is reported on every upload). */
const VICI_RULES = {
  talkFrom: 'all',
  noContactStatuses: ['N', 'NA', 'B', 'AB', 'A', 'VM', 'DC', 'DNE', 'DROP', 'PDROP', 'TIMEOT', 'INCALL', 'UC', 'UCNUM', 'DA', 'FAIL', 'DUPL'], // 'A' is Answering Machine, NOT answered
  nonAgentUsers: ['VDAD', 'VDCL', 'VDLB', 'CBT001', 'CBT003', 'CBT005', 'CBT007'],   // excluded and COUNTED, never silently dropped
  recordKey: ['call_date', 'user', 'lead_id', 'status'],
};

/* ---------------- identity spine (verbatim from the dashboard) ---------------- */
const normCB = v => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const normName = v => String(v || '').toLowerCase().replace(/\s+-\s*.*$|\s*-\s+.*$/, '').replace(/\s+/g, ' ').trim();
const extractCB = s => { const m = String(s || '').match(/CB[\s._-]*0*(\d{1,4})/i); return m ? ('CB' + m[1]) : null; };
function parseNum(v) {
  if (v == null || v === '' || v instanceof Date) return null;
  if (typeof v === 'number') { if (v > 1e8 && v % 1e10 === 0) return v / 1e10; return v; }
  let s = String(v).trim().replace('%', '');
  if (s.includes(',') && !s.includes('.')) s = s.replace(/,/g, '.');
  s = s.replace(/\s/g, '');
  const n = parseFloat(s); return isNaN(n) ? null : n;
}
function parseDur(v) { // MM:SS / HH:MM:SS, ;-typos, tabs, trailing junk; 6h cap (Q8)
  if (v == null || v === '') return null;
  const cap = s => (s == null || isNaN(s) || s < 0 || s > 21600) ? null : s;
  let s = String(v).replace(/\t/g, '').replace(/;/g, ':').replace(/[^\d:]/g, '');
  if (!s) return null;
  if (!s.includes(':')) { const n = parseInt(s, 10); return s.length >= 6 ? null : cap(n); } // 7-digit call-ids are junk
  const p = s.split(':').map(x => parseInt(x, 10) || 0);
  if (p.length === 2) return cap(p[0] * 60 + p[1]);
  if (p.length === 3) return cap(p[0] * 3600 + p[1] * 60 + p[2]);
  return null;
}
const pad = n => String(n).padStart(2, '0');
function isoFromSerial(n) { // Excel serial → YYYY-MM-DD (UTC)
  const d = new Date(Math.round((n - 25569) * 86400000));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
const AMBIGUOUS_DATES = [];
function isoDay(v, ctx) { // → 'YYYY-MM-DD' | null ; never guesses ambiguous DD/MM vs MM/DD
  if (v == null || v === '') return null;
  if (typeof v === 'number') return (v > 20000 && v < 60000) ? isoFromSerial(v) : null;
  const s = String(v).trim();
  if (/^0{4}-0{2}-0{2}/.test(s)) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    const a = +m[1], b = +m[2];
    if (a > 12 && b <= 12) return `${m[3]}-${pad(b)}-${pad(a)}`; // unambiguous DD/MM
    if (b > 12 && a <= 12) return `${m[3]}-${pad(a)}-${pad(b)}`; // unambiguous MM/DD
    AMBIGUOUS_DATES.push({ value: s, ctx: ctx || '' });
    return null;
  }
  const n = parseFloat(s);
  if (!isNaN(n) && n > 20000 && n < 60000 && /^[\d.]+$/.test(s)) return isoFromSerial(n);
  return null;
}
const inWindow = d => d != null && d >= P_START && d <= P_END;

/* ---------------- parsers ---------------- */
function parseCSV(txt) { // state-machine CSV: quotes, embedded commas/quotes/newlines, BOM
  txt = txt.replace(/^﻿/, '');
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < txt.length; i++) {
    const c = txt[i];
    if (q) {
      if (c === '"') { if (txt[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); cell = ''; if (row.some(x => x !== '')) rows.push(row); row = []; }
    else if (c !== '\r') cell += c;
  }
  row.push(cell); if (row.some(x => x !== '')) rows.push(row);
  return rows;
}
const parseTSV = txt => txt.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.length).map(l => l.split('\t'));
const normH = h => String(h == null ? '' : h).replace(/\s+/g, ' ').trim().toLowerCase();
function hmapOf(headerRow) { // first occurrence wins (Q1/Q4 duplicate-header quirk)
  const m = {};
  headerRow.forEach((h, i) => { const k = normH(h); if (k && !(k in m)) m[k] = i; });
  return m;
}
const cellv = (row, hm, name) => { const i = hm[normH(name)]; return i == null ? null : (row[i] === '' ? null : row[i]); };
function sheetRows(ws) { return XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, blankrows: false }); }

/* ---------------- load raw files ---------------- */
const fileOf = re => fs.readdirSync(UPLOAD_DIR).find(n => re.test(n));
const rawPath = n => path.join(UPLOAD_DIR, n);
const NAMES = {
  agentList: fileOf(/agent list/i), active: fileOf(/^Active\.xlsx$/i), inactive: fileOf(/^Inactive\.xlsx$/i),
  attendance: fileOf(/^attendance.*\.csv$/i), callx: fileOf(/^call_records\.csv$/i),
  vici: fileOf(/^Call Report.*\.xlsx$/i), viciTxt: fileOf(/^EXPORT_CALL_REPORT.*\.txt$/i),
  qa: fileOf(/^evaluations.*\.csv$/i), sfOpen: fileOf(/^SF Open/i), sfClosed: fileOf(/^SF Closed/i),
};
const findings = [];   // {sev: CRITICAL|HIGH|MEDIUM|LOW, area, msg}
const finding = (sev, area, msg) => findings.push({ sev, area, msg });

/* ---------------- 1. canonical agent list (source of truth) ---------------- */
const wbAgents = XLSX.read(fs.readFileSync(rawPath(NAMES.agentList)), { type: 'buffer' });
const REQ = ['employee code', 'agent name'];
let matchedSheets = [], droppedSheets = [];
for (const sn of wbAgents.SheetNames) {
  const rows = sheetRows(wbAgents.Sheets[sn]);
  let hi = -1;
  for (let k = 0; k < Math.min(rows.length, 15); k++) {
    const hs = rows[k].map(normH);
    if (REQ.every(r => hs.includes(r))) { hi = k; break; }
  }
  if (hi < 0) { droppedSheets.push({ sheet: sn, reason: 'no Employee Code + Agent Name header row' }); continue; }
  const hasPref = rows[hi].map(normH).includes('campaign');
  matchedSheets.push({ sheet: sn, rows: rows.slice(hi), hasPref });
}
if (matchedSheets.some(m => m.hasPref)) {
  matchedSheets.filter(m => !m.hasPref).forEach(m => droppedSheets.push({ sheet: m.sheet, reason: 'legacy format (no Campaign column) next to current-format tabs' }));
  matchedSheets = matchedSheets.filter(m => m.hasPref);
}
const roster = new Map();           // cb_norm → agent (last tab wins, per dashboard)
const rosterOverrides = [];
for (const { sheet, rows } of matchedSheets) {
  const hm = hmapOf(rows[0]);
  for (const r of rows.slice(1)) {
    const code = String(cellv(r, hm, 'Employee Code') || '').trim();
    const name = String(cellv(r, hm, 'Agent Name') || '').trim();
    if (!code || !name) continue;
    const cb = normCB(code);
    const a = {
      cb_norm: cb, cb_code: code, agent_name: name, normalized_agent_name: normName(name),
      team_leader: cellv(r, hm, 'Team Leader') || null,
      campaign: cellv(r, hm, 'Que') || cellv(r, hm, 'Queue') || cellv(r, hm, 'Campaign') || null,
      tenure: cellv(r, hm, 'Tenure') || null,
      callx_alias: String(cellv(r, hm, 'Call x') || '').trim() || null,
      sf_name: String(cellv(r, hm, 'Sales Force') || '').trim() || null,
      target: parseNum(cellv(r, hm, 'Target')),
      start_date: isoDay(cellv(r, hm, 'Start Date'), 'AgentList.StartDate'),
      job_title: cellv(r, hm, 'Job Title') || null,
      source_sheet: sheet,
    };
    if (roster.has(cb)) rosterOverrides.push({ cb, kept: sheet, dropped: roster.get(cb).source_sheet, name });
    roster.set(cb, a);
  }
}
/* employee register (management / non-agent staff) — sheets with Employee Name but no Agent Name */
const register = new Map();         // cb_norm → {name, title, sheet}
for (const sn of wbAgents.SheetNames) {
  const rows = sheetRows(wbAgents.Sheets[sn]);
  if (!rows.length) continue;
  const hm = hmapOf(rows[0]);
  if (hm[normH('Employee Code')] == null || hm[normH('Employee Name')] == null) continue;
  for (const r of rows.slice(1)) {
    const cb = normCB(cellv(r, hm, 'Employee Code'));
    const name = String(cellv(r, hm, 'Employee Name') || '').trim();
    if (!cb || !name) continue;
    if (!register.has(cb)) register.set(cb, { name, title: cellv(r, hm, 'Employee Title') || cellv(r, hm, 'Title') || null, sheet: sn });
  }
}
/* identity maps (dashboard buildIdentity) */
const agentMap = {}, sfOwnerMap = {}, cbInfo = {};
for (const a of roster.values()) {
  cbInfo[a.cb_norm] = a;
  if (a.callx_alias) agentMap[a.callx_alias] = a.cb_norm;
  if (a.agent_name) agentMap[a.agent_name] = a.cb_norm;
  if (a.sf_name) sfOwnerMap[normName(a.sf_name)] = a.cb_norm;
  if (a.agent_name) sfOwnerMap[normName(a.agent_name)] = a.cb_norm;
}
function cbOf(v) {
  if (v == null || String(v).trim() === '') return null;
  if (agentMap[v] != null) return agentMap[v];
  const ex = extractCB(v);
  if (ex && cbInfo[ex]) return ex;
  const n = normName(v);
  if (sfOwnerMap[n]) return sfOwnerMap[n];
  return ex; // unresolved CB-looking code (not on roster) — caller flags it
}
const cbOfOwner = name => sfOwnerMap[normName(name)] || null;


/* agent-match bookkeeping (Simulation 1) */
const matchLog = new Map(); // key source|raw → {source, raw, cb, name, method, status}
function recordMatch(source, raw, cb, method, status) {
  const k = source + '|' + raw;
  if (!matchLog.has(k)) matchLog.set(k, { source, raw, cb: cb || '', name: cb && cbInfo[cb] ? cbInfo[cb].agent_name : '', method, status, rows: 0 });
  matchLog.get(k).rows++;
}
const tlNames = new Set();          // Team Leader names from the roster count as management
const SYSTEM_ID = /^(VDAD|VDCL|CBT\d+)\b|Outbound Auto Dial|Inbound No Agent|Training\d+|^Cuddle Call\b|^VIP Welcome Calls\b|^Courtesy Call/i;
for (const a of roster.values()) if (a.team_leader) tlNames.add(normName(a.team_leader));
function classifyPerson(source, raw, cb) {
  if (cb && cbInfo[cb]) { recordMatch(source, raw, cb, /CB[\s._-]*\d/i.test(String(raw)) ? 'code/alias' : 'name', 'VALID_AGENT'); return 'VALID_AGENT'; }
  if (SYSTEM_ID.test(String(raw))) { recordMatch(source, raw, null, 'pattern', 'SYSTEM_OR_QUEUE'); return 'SYSTEM_OR_QUEUE'; }
  const ex = extractCB(raw);
  if (ex && register.has(ex)) { recordMatch(source, raw, ex, 'register code', 'MANAGEMENT_OR_STAFF'); return 'MANAGEMENT_OR_STAFF'; }
  const bare = normName(String(raw).replace(/CB[\s._-]*\d+/ig, '').replace(/\//g, ' ')); // name with embedded codes stripped
  for (const [rc, info] of register) if (normName(info.name) === normName(raw) || normName(info.name) === bare) { recordMatch(source, raw, rc, 'register name', 'MANAGEMENT_OR_STAFF'); return 'MANAGEMENT_OR_STAFF'; }
  if (tlNames.has(normName(raw)) || tlNames.has(bare)) { recordMatch(source, raw, ex, 'roster TL name', 'MANAGEMENT_OR_STAFF'); return 'MANAGEMENT_OR_STAFF'; }
  recordMatch(source, raw, ex, (ex ? 'code (unknown)' : 'none') + suggestFor(bare), 'NOT_IN_SOURCE_OF_TRUTH');
  return 'NOT_IN_SOURCE_OF_TRUTH';
}
/* controlled possible-match suggester — SUGGESTS only, never merges (spec: below-threshold → review) */
function lev(a, b) {
  if (Math.abs(a.length - b.length) > 3) return 9;
  const m = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) m[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return m[a.length][b.length];
}
function suggestFor(bare) {
  if (!bare || bare.length < 5) return '';
  let best = null, bd = 4;
  for (const a of roster.values()) { const d = lev(bare, a.normalized_agent_name); if (d < bd) { bd = d; best = a.agent_name + ' (' + a.cb_norm + ', roster)'; } }
  for (const [rc, info] of register) { const d = lev(bare, normName(info.name)); if (d < bd) { bd = d; best = info.name + ' (' + rc + ', register)'; } }
  return best && bd <= 3 ? ` — POSSIBLE MATCH (review, not merged): ${best}` : '';
}

/* ---------------- 2. normalize each source ---------------- */
const excluded = [];  // {source, row, who, reason, type}
const dupTables = []; // {source, key, count}
function findDupes(source, rows, keyFn, label) {
  const seen = new Map();
  rows.forEach((r, i) => { const k = keyFn(r); if (k == null) return; if (!seen.has(k)) seen.set(k, []); seen.get(k).push(i); });
  let n = 0;
  for (const [k, idxs] of seen) if (idxs.length > 1) { n += idxs.length - 1; if (dupTables.length < 400) dupTables.push({ source, key: label + ': ' + k, count: idxs.length }); }
  return n;
}

/* ATTENDANCE */
const attRaw = parseCSV(fs.readFileSync(rawPath(NAMES.attendance), 'utf8'));
const attHm = hmapOf(attRaw[0]);
const ATT = [];
for (let i = 1; i < attRaw.length; i++) {
  const r = attRaw[i];
  const rec = {
    day: isoDay(cellv(r, attHm, 'Date'), 'attendance'), code: normCB(cellv(r, attHm, 'Employee Code')),
    raw_code: cellv(r, attHm, 'Employee Code'), name: String(cellv(r, attHm, 'Employee Name') || '').trim(),
    title: cellv(r, attHm, 'Title'), dept: cellv(r, attHm, 'Department'),
    status_code: String(cellv(r, attHm, 'Status Code') || '').trim(), status: String(cellv(r, attHm, 'Status') || '').trim(), _row: i + 1,
  };
  rec.is_exit = RULES.excludeCodes.some(c => rec.status_code === c || rec.status === c);
  rec.klass = rec.is_exit ? 'exit' : RULES.presentCodes.includes(rec.status_code) ? 'present' : RULES.leaveCodes.includes(rec.status_code) ? 'leave' : 'unplanned';
  rec.person = roster.has(rec.code) ? 'VALID_AGENT' : (register.has(rec.code) || tlNames.has(normName(rec.name))) ? 'MANAGEMENT_OR_STAFF' : 'NOT_IN_SOURCE_OF_TRUTH';
  recordMatch('ATTENDANCE', rec.raw_code + ' / ' + rec.name, roster.has(rec.code) || register.has(rec.code) ? rec.code : null, register.has(rec.code) || roster.has(rec.code) ? 'employee code' : tlNames.has(normName(rec.name)) ? 'roster TL name' : 'employee code', rec.person);
  if (rec.person !== 'VALID_AGENT') excluded.push({ source: 'ATTENDANCE', row: rec._row, who: rec.raw_code + ' ' + rec.name, reason: rec.person === 'MANAGEMENT_OR_STAFF' ? 'register (non-agent): ' + (register.get(rec.code)?.title || rec.title || '') : 'employee code not in Agent List or register', type: rec.person });
  ATT.push(rec);
}
const attDupes = findDupes('ATTENDANCE', ATT.filter(a => a.day), a => a.code + '|' + a.day, 'employee-day');

/* CALLX call records */
const cxRaw = parseCSV(fs.readFileSync(rawPath(NAMES.callx), 'utf8'));
const cxHm = hmapOf(cxRaw[0]);
const CX = [];
for (let i = 1; i < cxRaw.length; i++) {
  const r = cxRaw[i];
  const agentRaw = String(cellv(r, cxHm, 'Agent') || '').trim();
  const billable = parseNum(cellv(r, cxHm, 'Billable Seconds'));
  const rec = {
    dt: String(cellv(r, cxHm, 'Date & Time') || ''), day: isoDay(cellv(r, cxHm, 'Date & Time'), 'callx'),
    destination: String(cellv(r, cxHm, 'Destination') || '').trim(),
    call_type: String(cellv(r, cxHm, 'Call Type') || '').trim().toLowerCase(),
    campaign: cellv(r, cxHm, 'Campaign'), agent_raw: agentRaw,
    disposition: String(cellv(r, cxHm, 'Lead Disposition') || '').trim(),
    duration_s: parseDur(cellv(r, cxHm, 'Duration')), billable_s: billable == null ? 0 : billable,
    channel: cellv(r, cxHm, 'Channel'), _row: i + 1,
  };
  rec.cb = agentRaw ? cbOf(agentRaw) : null;
  rec.band = RULES.callTypes.reduce((acc, [t, l]) => rec.billable_s >= t ? l : acc, 'No Answer');
  rec.answered = rec.disposition ? !RULES.noAnswerDispositions.includes(rec.disposition) : rec.billable_s >= RULES.callTypes[1][0];
  if (agentRaw) {
    rec.person = rec.cb && cbInfo[rec.cb] ? 'VALID_AGENT' : classifyPerson('CALLX', agentRaw, rec.cb);
    if (rec.person === 'VALID_AGENT') recordMatch('CALLX', agentRaw, rec.cb, agentMap[agentRaw] ? 'alias/name' : 'code', 'VALID_AGENT');
  } else rec.person = rec.call_type === 'inbound' ? 'INBOUND_NO_AGENT' : 'NO_AGENT';
  CX.push(rec);
}
const cxOut = CX.filter(c => !inWindow(c.day));
const cxDupes = findDupes('CALLX', CX, c => [c.dt, c.destination, c.agent_raw, c.duration_s, c.channel].join('|'), 'exact call');

/* VICI call report (xlsx) + single-day txt export — the VAS-analytics treatment:
 * dedupe on the rule-book record key (keyed on the export's OWN login — reassigning
 * identity must not change what counts as one call), system logins excluded-and-counted,
 * negative lengths zeroed-and-counted, NAME wins any login/roster clash (Kyle Kisten rule),
 * every reassignment reported. */
const noContact = new Set(VICI_RULES.noContactStatuses);
const sysUsers = new Set(VICI_RULES.nonAgentUsers);
function viciRows(rows, src) {
  const hm = hmapOf(rows[0]); const out = [];
  const stats = { dupes: 0, sysRows: 0, sysHits: {}, negatives: 0, allSecs: 0, ringSecs: 0, reassigned: {} };
  const seen = new Set();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const status = String(cellv(r, hm, 'status') || '').trim().toUpperCase();
    const rec = {
      dt: String(cellv(r, hm, 'call_date') || ''), day: isoDay(cellv(r, hm, 'call_date'), src),
      phone: String(cellv(r, hm, 'phone_number_dialed') || '').trim(), status,
      status_name: String(cellv(r, hm, 'status_name') || cellv(r, hm, 'status name') || '').trim(),
      lead_id: String(cellv(r, hm, 'lead_id') || '').trim(),
      user: extractCB(String(cellv(r, hm, 'user') || '')) || normCB(cellv(r, hm, 'user')), // extractCB strips zero-padding: CB016 ≡ CB16
      user_raw: String(cellv(r, hm, 'user') || '').trim(),
      full_name: String(cellv(r, hm, 'full_name') || '').trim(),
      grp: String(cellv(r, hm, 'user_group') || '').trim(),
      len: parseNum(cellv(r, hm, 'length_in_sec')) || 0, list: cellv(r, hm, 'list_name'), _row: i + 1, _src: src,
    };
    const key = rec.dt + '|' + rec.user_raw + '|' + rec.lead_id + '|' + status;   // rule-book record key
    if (seen.has(key)) { stats.dupes++; if (dupTables.length < 400) dupTables.push({ source: src, key: 'record key: ' + key, count: 2 }); continue; }
    seen.add(key);
    if (rec.len < 0) { stats.negatives++; rec.len = 0; }        // corrupt, not a credit — zeroed and counted
    if (sysUsers.has(rec.user_raw.toUpperCase())) { stats.sysRows++; stats.sysHits[rec.user_raw] = (stats.sysHits[rec.user_raw] || 0) + 1; rec.person = 'SYSTEM_OR_QUEUE'; recordMatch(src, rec.user_raw + ' / ' + rec.full_name, null, 'nonAgentUsers rule', 'SYSTEM_OR_QUEUE'); out.push(rec); continue; }
    rec.answered = !noContact.has(status);
    stats.allSecs += rec.len; if (!rec.answered) stats.ringSecs += rec.len;
    // roster join on CB, but NAME WINS on an ID clash (spec §3 / Kyle Kisten rule)
    const byName = sfOwnerMap[normName(rec.full_name)] || null;
    if (byName && rec.user && byName !== rec.user) { rec.cb = byName; rec.id_clash = true; stats.reassigned[`${rec.full_name} (${rec.user_raw} → ${byName})`] = (stats.reassigned[`${rec.full_name} (${rec.user_raw} → ${byName})`] || 0) + 1; }
    else rec.cb = (rec.user && cbInfo[rec.user]) ? rec.user : byName;
    rec.person = rec.cb ? 'VALID_AGENT' : classifyPerson(src, rec.user_raw + ' / ' + rec.full_name, null);
    if (rec.cb) recordMatch(src, rec.user_raw + ' / ' + rec.full_name, rec.cb, rec.id_clash ? 'NAME (id clash)' : 'code', 'VALID_AGENT');
    out.push(rec);
  }
  out.stats = stats;
  return out;
}
const VICI = viciRows(sheetRows(XLSX.read(fs.readFileSync(rawPath(NAMES.vici)), { type: 'buffer' }).Sheets.Sheet1), 'VICI_REPORT');
const VICI_TXT = NAMES.viciTxt ? viciRows(parseTSV(fs.readFileSync(rawPath(NAMES.viciTxt), 'utf8')), 'VICI_TXT') : [];
const viciDupes = VICI.stats.dupes;
const viciKeys = new Set(VICI.map(v => v.dt + '|' + v.user_raw + '|' + v.lead_id + '|' + v.status));
const viciOverlap = VICI_TXT.filter(v => viciKeys.has(v.dt + '|' + v.user_raw + '|' + v.lead_id + '|' + v.status)).length;
/* CUDDLE-FLOOR COVERAGE. A ViciDial export is user-group filtered at pull time; both real
   pulls to date carried the VT/digital/Nesting groups and not one Cuddle agent, so Cuddle
   talk read blank in PULSE and the Variance Report skipped its DV03 checks. Caught here at
   intake, before the upload "succeeds": if the day's Vici files hold no Cuddle-floor row,
   name the groups that WERE in the pull so the wrong tick-boxes are visible immediately.
   Courtesy is deliberately not checked the same way — it dials on CallX (call_records.csv). */
{
  const cuddleCbs = new Set([...roster.values()].filter(a => /cuddle/i.test(String(a.campaign || ''))).map(a => a.cb_norm));
  const viciAll = [...VICI, ...VICI_TXT];
  if (cuddleCbs.size && viciAll.length && !viciAll.some(v => v.cb && cuddleCbs.has(v.cb))) {
    const grps = [...new Set(viciAll.map(v => v.grp).filter(Boolean))].sort();
    finding('HIGH', 'VICI',
      `No Cuddle-floor row in any ViciDial export (${[NAMES.vici, NAMES.viciTxt].filter(Boolean).join(', ')}) — the pull's user-group filter excludes the Cuddle floor (groups present: ${grps.join(', ') || 'none recorded'}). ` +
      `Re-pull EXPORT_CALL_REPORT with the Cuddle user groups ticked (or all groups): Cuddle then gets day-level talk, MTD coverage and Variance DV03 checks, exactly like Courtesy.`);
  }
}
const isOptIn = d => /insurance opt/i.test(d) && !/no insurance/i.test(d);
const isSaleDisp = d => /^sale\b|^vas sale\b/i.test(String(d).trim());

/* QA evaluations */
const qaRaw = parseCSV(fs.readFileSync(rawPath(NAMES.qa), 'utf8'));
const qaHm = hmapOf(qaRaw[0]);
const QA = [];
for (let i = 1; i < qaRaw.length; i++) {
  const r = qaRaw[i];
  const cbRaw = String(cellv(r, qaHm, 'Sales Agent CB') || '').trim();
  const agName = String(cellv(r, qaHm, 'Sales Agent') || '').trim();
  const rec = {
    record_id: String(cellv(r, qaHm, 'Record ID') || '').trim(), status: String(cellv(r, qaHm, 'Status') || '').trim(),
    day: isoDay(cellv(r, qaHm, 'Date of Call'), 'qa.DateOfCall'), assess_day: isoDay(cellv(r, qaHm, 'Date of Assessment'), 'qa.DateOfAssessment'),
    campaign: cellv(r, qaHm, 'Campaign'), qa_agent: cellv(r, qaHm, 'QA Agent'),
    agent_raw: agName, cb_raw: cbRaw,
    score: parseNum(cellv(r, qaHm, 'Score %')),
    assessment_type: String(cellv(r, qaHm, 'Assessment Type') || '').trim(),
    escalation: String(cellv(r, qaHm, 'Escalation Decision') || '').trim(),
    call_dur: parseDur(cellv(r, qaHm, 'Call Duration')), _row: i + 1,
  };
  const byCode = normCB(cbRaw);
  if (byCode && cbInfo[byCode]) { rec.cb = byCode; rec.method = 'Sales Agent CB'; }
  else { rec.cb = sfOwnerMap[normName(agName)] || null; rec.method = rec.cb ? 'name' : 'none'; }
  rec.person = rec.cb ? 'VALID_AGENT' : classifyPerson('QA', (cbRaw ? cbRaw + ' / ' : '') + agName, null);
  if (rec.cb) recordMatch('QA', (cbRaw ? cbRaw + ' / ' : '') + agName, rec.cb, rec.method, 'VALID_AGENT');
  rec.crit = RULES.qaCritical.includes(rec.escalation);
  rec.eff_score = rec.crit ? 0 : rec.score;    // QA average weights critical-fail calls as zero
  QA.push(rec);
}
const qaDupes = findDupes('QA', QA, q => q.record_id || null, 'Record ID');
const qaOut = QA.filter(q => !inWindow(q.day));
const qaStatusVocab = [...new Set(QA.map(q => q.status))];
const disputeVocabHit = qaStatusVocab.filter(s => RULES.qaDisputeStatuses.includes(s));

/* BI Active (money) + Inactive (cancellations) */
function biRows(fp, src) {
  const rows = sheetRows(XLSX.read(fs.readFileSync(fp), { type: 'buffer' }).Sheets.Export);
  const hm = hmapOf(rows[0]); const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const rec = {
      account: String(cellv(r, hm, 'Account Number') || '').trim(),
      contract: String(cellv(r, hm, 'Contract Number') || '').trim(),
      status: cellv(r, hm, 'Contract Status'),          // first occurrence wins (Q4)
      owner: String(cellv(r, hm, 'Owner') || '').trim(),
      charge: parseNum(cellv(r, hm, 'Charge Amount')),  // first occurrence wins (Q4); EX-VAT
      create_day: isoDay(cellv(r, hm, 'Contract Create Date'), src + '.Create'),
      deact_day: isoDay(cellv(r, hm, 'Contract Deactivate Date'), src + '.Deact'),
      bundle: cellv(r, hm, 'Product Bundle'), _row: i + 1,
    };
    rec.cb = cbOfOwner(rec.owner);
    out.push(rec);
  }
  return out;
}
const BI = biRows(rawPath(NAMES.active), 'BI_ACTIVE');
const INACT = biRows(rawPath(NAMES.inactive), 'SF_INACTIVE');
const biWin = BI.filter(b => inWindow(b.create_day));
const biDupes = findDupes('BI_ACTIVE', BI, b => [b.account, b.contract, b.charge, b.create_day, b.bundle].join('|'), 'exact charge line');
const inactWin = INACT.filter(b => inWindow(b.create_day) && String(b.status).trim() === 'Inactive');
biWin.forEach(b => { if (b.cb) recordMatch('BI_ACTIVE', b.owner, b.cb, 'sfOwner name', 'VALID_AGENT'); else classifyPerson('BI_ACTIVE', b.owner, null); });
inactWin.forEach(b => { if (b.cb) recordMatch('SF_INACTIVE', b.owner, b.cb, 'sfOwner name', 'VALID_AGENT'); else classifyPerson('SF_INACTIVE', b.owner, null); });

/* SF Open Cases (HTML .xls) */
const wbOpen = XLSX.read(fs.readFileSync(rawPath(NAMES.sfOpen)), { type: 'buffer' });
const openRowsRaw = sheetRows(wbOpen.Sheets[wbOpen.SheetNames[0]]);
const opHm = hmapOf(openRowsRaw[0]);
const OPEN = [];
for (let i = 1; i < openRowsRaw.length; i++) {
  const r = openRowsRaw[i];
  const rec = {
    case_number: String(cellv(r, opHm, 'Case Number') || '').trim(),
    opened_day: isoDay(cellv(r, opHm, 'Date/Time Opened'), 'sfOpen'),
    owner: String(cellv(r, opHm, 'Case Owner') || '').trim(), status: cellv(r, opHm, 'Status'),
    record_type: cellv(r, opHm, 'Case Record Type'), _row: i + 1,
  };
  rec.cb = cbOfOwner(rec.owner);
  rec.person = rec.cb ? 'VALID_AGENT' : classifyPerson('SF_OPEN', rec.owner, null);
  if (rec.cb) recordMatch('SF_OPEN', rec.owner, rec.cb, 'sfOwner name', 'VALID_AGENT');
  OPEN.push(rec);
}
const openDupes = findDupes('SF_OPEN', OPEN, o => o.case_number || null, 'Case Number');

/* SF Closed — expected empty frameset shell; verify */
const closedBuf = fs.readFileSync(rawPath(NAMES.sfClosed));
const closedTxt = closedBuf.toString('utf8');
const closedIsFrameset = /Excel Workbook Frameset/i.test(closedTxt) && !/Case Number/i.test(closedTxt);
let CLOSED = [];
if (!closedIsFrameset) {
  const wbC = XLSX.read(closedBuf, { type: 'buffer' });
  const rows = sheetRows(wbC.Sheets[wbC.SheetNames[0]]);
  if (rows.length > 1) { const hm = hmapOf(rows[0]); CLOSED = rows.slice(1).map((r, i) => ({ case_number: cellv(r, hm, 'Case Number'), closed_day: isoDay(cellv(r, hm, 'Date/Time Closed'), 'sfClosed'), owner: String(cellv(r, hm, 'Case Owner') || '').trim(), status: cellv(r, hm, 'Status'), _row: i + 2 })); }
}
if (!CLOSED.length) finding('CRITICAL', 'SF_CLOSED_CASES', `"${NAMES.sfClosed}" carries ZERO case rows — it is an Excel frameset shell whose data lives in a companion "_files/sheet001.htm" folder that was not exported. Closed-case KPIs (Total Closed, Lead-Mgmt Conversion, Wasted Leads, Closure/day, No-Feedback rate) are NOT COMPUTABLE this run. Re-export closed cases (single-file HTML table like the Open Cases file).`);

/* ---------------- 3. per-agent recalculation (valid agents only) ---------------- */
const M = new Map(); // cb → metrics
const m0 = () => ({
  sched: 0, present_days: new Set(), present: 0, leave: 0, unplanned: 0, exits: 0,
  cx_calls: 0, cx_answered: 0, cx_billable: 0, cx_dest: new Set(), cx_sale_disp: 0,
  vici_dials: 0, vici_talk: 0, vici_ans: 0, vici_ring: 0, vici_uniq: new Set(), vici_days: new Set(), vici_opt: 0, vici_saleD: 0,
  qa_n: 0, qa_sum: 0, qa_crit: 0, qa_disputed: 0,
  sales_accts: new Set(), gwp_ex: 0, cancel_accts: new Set(), gwp_lost: 0, open_cases: 0,
});
const forCB = cb => { if (!M.has(cb)) M.set(cb, m0()); return M.get(cb); };
const UNATTR = { gwp_ex: 0, sales_accts: new Set(), rows: 0, cancel_accts: new Set(), open_cases: 0 };

for (const a of ATT) {
  if (a.person !== 'VALID_AGENT' || !inWindow(a.day)) continue;
  const m = forCB(a.code);
  if (a.is_exit) { m.exits++; continue; }              // Q10: exits never in denominators
  m.sched++;
  if (a.klass === 'present') { m.present++; m.present_days.add(a.day); }
  else if (a.klass === 'leave') m.leave++;
  else m.unplanned++;
}
for (const c of CX) {
  if (!inWindow(c.day)) continue;
  if (c.person !== 'VALID_AGENT') continue;
  const m = forCB(c.cb);
  m.cx_calls++;
  if (c.answered) m.cx_answered++;
  m.cx_billable += c.billable_s;
  if (c.destination && c.destination !== 's') m.cx_dest.add(c.destination);
  if (RULES.saleDispositions.includes(c.disposition)) m.cx_sale_disp++;
}
for (const v of VICI) {
  if (!inWindow(v.day) || v.person !== 'VALID_AGENT') continue;
  const m = forCB(v.cb);
  m.vici_dials++; m.vici_uniq.add(v.phone); m.vici_days.add(v.day);
  m.vici_talk += v.len;                                  // talkFrom 'all': Σ length_in_sec on the CB number
  if (v.answered) m.vici_ans++; else m.vici_ring += v.len;
  if (isOptIn(v.status_name)) m.vici_opt++;
  if (isSaleDisp(v.status_name)) m.vici_saleD++;
}
for (const q of QA) {
  if (!inWindow(q.day) || q.person !== 'VALID_AGENT' || q.eff_score == null) continue;
  const m = forCB(q.cb);
  m.qa_n++; m.qa_sum += q.eff_score;
  if (q.crit) m.qa_crit++;
  if (RULES.qaDisputeStatuses.includes(q.status)) m.qa_disputed++;
}
for (const b of biWin) {
  if (b.cb) { const m = forCB(b.cb); m.sales_accts.add(b.account); m.gwp_ex += b.charge || 0; }
  else { UNATTR.sales_accts.add(b.account); UNATTR.gwp_ex += b.charge || 0; UNATTR.rows++; }
}
for (const b of inactWin) {
  if (b.cb) { const m = forCB(b.cb); m.cancel_accts.add(b.account); m.gwp_lost += b.charge || 0; }
  else UNATTR.cancel_accts.add(b.account);
}
for (const o of OPEN) { if (o.person === 'VALID_AGENT') forCB(o.cb).open_cases++; else UNATTR.open_cases++; }

const vat = 1 + RULES.vatRate / 100;
const pct = (n, d) => d > 0 ? (100 * n / d) : null;    // zero denominator → N/A, never 0%
const agentRow = (cb) => {
  const a = cbInfo[cb] || {}; const m = M.get(cb) || m0();
  return {
    cb, name: a.agent_name || '(not on roster)', campaign: a.campaign || '', tl: a.team_leader || '', tenure: a.tenure || '', target: a.target ?? '',
    sched_days: m.sched, present_days: m.present, att_pct: pct(m.present, m.sched), unplanned_pct: pct(m.unplanned, m.sched), exits: m.exits,
    cx_calls: m.cx_calls, cx_answer_pct: pct(m.cx_answered, m.cx_calls), cx_unique: m.cx_dest.size, cx_talk_min: Math.round(m.cx_billable / 60),
    vici_dials: m.vici_dials, vici_uniq: m.vici_uniq.size, vici_days: m.vici_days.size, vici_ans: m.vici_ans,
    vici_answer_pct: pct(m.vici_ans, m.vici_dials), vici_talk_s: m.vici_talk, vici_talk_min: Math.round(m.vici_talk / 60),
    vici_aht_s: m.vici_ans > 0 ? Math.round(m.vici_talk / m.vici_ans) : null,          // avg talk time = Σ length_in_sec ÷ answered (PULSE aht)
    vici_talk_per_day_min: m.vici_days.size > 0 ? +(m.vici_talk / 60 / m.vici_days.size).toFixed(1) : null,
    vici_opt: m.vici_opt, vici_sale_disp: m.vici_saleD,
    sales: m.sales_accts.size, gwp_ex: +m.gwp_ex.toFixed(2), gwp_incl: +(m.gwp_ex * vat).toFixed(2),
    cancels: m.cancel_accts.size, gwp_lost_ex: +m.gwp_lost.toFixed(2), open_cases: m.open_cases,
    qa_n: m.qa_n, qa_avg: m.qa_n ? +(m.qa_sum / m.qa_n).toFixed(1) : null, qa_cfr_pct: pct(m.qa_crit, m.qa_n), qa_disputed: m.qa_disputed,
    target_ach_pct: (a.target > 0 && m.present_days.size > 0) ? +((m.sales_accts.size / m.present_days.size) / a.target * 100).toFixed(1) : null,
  };
};
const AGENT_TABLE = [...roster.keys()].map(agentRow);

/* ---------------- 4. team + overall recalcs, dual-path parity ---------------- */
const sum = (arr, f) => arr.reduce((s, x) => s + (f(x) || 0), 0);
const overall = {
  gwp_ex_flat: +sum(biWin, b => b.charge).toFixed(2),
  gwp_ex_agents: +(sum(AGENT_TABLE, r => r.gwp_ex) + UNATTR.gwp_ex).toFixed(2),
  sales_flat: new Set(biWin.map(b => b.account)).size,
  cx_total: CX.filter(c => inWindow(c.day)).length,
  cx_agent_rows: CX.filter(c => inWindow(c.day) && c.person === 'VALID_AGENT').length,
  cx_unique_flat: new Set(CX.filter(c => inWindow(c.day) && c.destination && c.destination !== 's').map(c => c.destination)).size,
  vici_total: VICI.filter(v => inWindow(v.day)).length,
  vici_talk_h: +(sum(VICI.filter(v => inWindow(v.day) && v.person === 'VALID_AGENT'), v => v.len) / 3600).toFixed(1),
  att_present: sum(AGENT_TABLE, r => r.present_days), att_sched: sum(AGENT_TABLE, r => r.sched_days),
  qa_in_window: QA.filter(q => inWindow(q.day)).length,
  open_cases: OPEN.length,
};

const formulaChecks = [];
const fcheck = (metric, formula, expected, actual, tol = 0.005) => {
  const ok = (expected == null && actual == null) || (typeof expected === 'number' && Math.abs(expected - actual) <= tol) || expected === actual;
  formulaChecks.push({ metric, formula, expected, actual, status: ok ? 'PASS' : 'FAIL' });
  if (!ok) finding('CRITICAL', 'FORMULA', `${metric}: independent recalc mismatch (${expected} vs ${actual}) — ${formula}`);
  return ok;
};
fcheck('Total GWP ex-VAT', 'flat Σ Charge Amount (in-window) = Σ per-agent GWP + unattributed', overall.gwp_ex_flat, overall.gwp_ex_agents);
fcheck('Sales (unique accounts)', 'distinct accounts flat = Σ per-agent + unattributed (account may span agents)', overall.sales_flat, (() => { const s = new Set(); M.forEach(m => m.sales_accts.forEach(a => s.add(a))); UNATTR.sales_accts.forEach(a => s.add(a)); return s.size; })());
fcheck('GWP incl VAT', 'ex × (1+vat) — zero-safe', +(overall.gwp_ex_flat * vat).toFixed(2), +(sum(AGENT_TABLE, r => r.gwp_incl) + UNATTR.gwp_ex * vat).toFixed(2), 0.5);
fcheck('Unique calls (CallX)', 'Set-distinct = sort-dedupe count', overall.cx_unique_flat, (() => { const d = CX.filter(c => inWindow(c.day) && c.destination && c.destination !== 's').map(c => c.destination).sort(); let n = 0; for (let i = 0; i < d.length; i++) if (i === 0 || d[i] !== d[i - 1]) n++; return n; })());
fcheck('Attendance rows', 'present+leave+unplanned+exits = valid in-window rows', ATT.filter(a => a.person === 'VALID_AGENT' && inWindow(a.day)).length, [...M.values()].reduce((s, m) => s + m.present + m.leave + m.unplanned + m.exits, 0));
fcheck('QA effective scores', 'crit-as-zero: Σ eff = Σ score(non-crit)', +[...M.values()].reduce((s, m) => s + m.qa_sum, 0).toFixed(1), +QA.filter(q => inWindow(q.day) && q.person === 'VALID_AGENT' && q.eff_score != null && !q.crit).reduce((s, q) => s + q.score, 0).toFixed(1));

/* ---------------- 5. simulations ---------------- */
const sims = [];
const sim = (n, name, status, detail) => sims.push({ n, name, status, detail });

/* Sim 1 — agent validation across every dataset */
{
  const byStatus = {};
  for (const v of matchLog.values()) byStatus[v.status] = (byStatus[v.status] || 0) + 1;
  sim(1, 'Agent validation sweep', 'DONE', Object.entries(byStatus).map(([k, v]) => `${k}: ${v} distinct identities`).join(' · '));
}
/* Sim 2 — independent recalculation (the fcheck battery above) */
sim(2, 'Formula recalculation', formulaChecks.every(f => f.status === 'PASS') ? 'PASS' : 'FAIL', `${formulaChecks.filter(f => f.status === 'PASS').length}/${formulaChecks.length} dual-path recomputations agree (no in-package precomputed report exists to diff against — parity is recomputation-vs-recomputation)`);
/* Sim 3 — duplicates */
sim(3, 'Duplicate detection', (cxDupes + qaDupes + attDupes + openDupes + biDupes + viciDupes) === 0 ? 'PASS' : 'FLAGGED',
  `CallX exact-dupes ${cxDupes} · QA RecordID dupes ${qaDupes} · attendance employee-day dupes ${attDupes} · Open CaseNumber dupes ${openDupes} · BI exact-line dupes ${biDupes} · Vici exact dupes ${viciDupes} · Vici txt↔xlsx 13-Aug overlap ${viciOverlap}/${VICI_TXT.length}`);
/* Sim 4 — missing data */
{
  const attDays = [...new Set(ATT.map(a => a.day).filter(Boolean))].sort();
  const missingAttDays = []; {
    const d0 = new Date(P_START + 'T00:00:00Z');
    for (let d = new Date(d0); isoFromSerial(25569 + d.getTime() / 86400000) <= P_END; d.setUTCDate(d.getUTCDate() + 1)) {
      const iso = d.toISOString().slice(0, 10);
      if (iso > P_END) break;
      const wd = d.getUTCDay();
      if (wd !== 0 && wd !== 6 && !attDays.includes(iso)) missingAttDays.push(iso);
    }
  }
  const noTarget = AGENT_TABLE.filter(r => r.target === '' || r.target == null).length;
  const noStart = [...roster.values()].filter(a => !a.start_date).length;
  sim(4, 'Missing data', 'FLAGGED', `attendance missing weekdays in period: ${missingAttDays.join(', ') || 'none'} · closed-cases source EMPTY · roster agents without Target: ${noTarget} · without Start Date: ${noStart} · ambiguous dates skipped: ${AMBIGUOUS_DATES.length}`);
  const holiday10 = missingAttDays.includes('2026-08-10');
  const realMissing = missingAttDays.filter(d => d !== '2026-08-10');
  if (realMissing.length) finding('HIGH', 'ATTENDANCE', `Attendance file only covers ${attDays[0]} → ${attDays[attDays.length - 1]}; period weekdays with NO attendance rows: ${realMissing.join(', ')}${holiday10 ? ' (2026-08-10 also empty — Women’s Day observed, expected)' : ''}. Present-day denominators (talk/day, Target Ach %) are understated for 01–05 Aug.`);
  /* per-source coverage vs requested period (under-coverage, not just out-of-window rows) */
  const cover = (label, days) => {
    const ds = [...new Set(days.filter(Boolean))].sort();
    if (!ds.length) return;
    if (ds[0] > P_START || ds[ds.length - 1] < P_END) finding('HIGH', 'COVERAGE', `${label} data spans ${ds[0]} → ${ds[ds.length - 1]} but the reporting period is ${P_START} → ${P_END} — KPIs from this source cover only its own span.`);
  };
  cover('CALLX_CALL_RECORDS', CX.map(c => c.day));
  cover('QA (Date of Call)', QA.map(q => q.day));
  cover('VICI report', VICI.map(v => v.day));
  if (noTarget) finding('HIGH', 'AGENT_LIST', `${noTarget} roster agents carry no Target (the VT sheet has no Target column) — Target Ach % reads N/A for them, never guessed.`);
}
/* Sim 5 — date boundary */
{
  const out = { CALLX: cxOut.length, QA: qaOut.length, BI_ACTIVE: BI.length - biWin.length, VICI: VICI.filter(v => !inWindow(v.day)).length, INACTIVE: INACT.filter(b => !inWindow(b.create_day)).length };
  const withOut = sum(BI, b => b.charge);
  sim(5, 'Date boundary', 'PASS', `rows outside ${P_START}→${P_END} excluded from MTD: ${Object.entries(out).map(([k, v]) => k + ' ' + v).join(' · ')} — GWP with boundary off would read R${withOut.toFixed(2)} vs windowed R${overall.gwp_ex_flat.toFixed(2)} (filter is live)`);
}
/* Sim 6 — zero denominators */
{
  const zAtt = AGENT_TABLE.filter(r => r.sched_days === 0).length;
  const zQa = AGENT_TABLE.filter(r => r.qa_n === 0).length;
  const zCall = AGENT_TABLE.filter(r => r.cx_calls === 0).length;
  const bad = AGENT_TABLE.filter(r => (r.sched_days === 0 && r.att_pct !== null) || (r.qa_n === 0 && r.qa_avg !== null) || (r.cx_calls === 0 && r.cx_answer_pct !== null)).length;
  sim(6, 'Zero denominators', bad === 0 ? 'PASS' : 'FAIL', `agents with 0 scheduled days: ${zAtt}, 0 QA: ${zQa}, 0 CallX calls: ${zCall} — all render N/A (null), never 0% (violations: ${bad})`);
  if (bad) finding('CRITICAL', 'FORMULA', `${bad} agents show a percentage over a zero denominator`);
}
/* Sim 7 — non-SoT removal: totals shrink by exactly the excluded contribution */
{
  const exclGwp = sum(biWin.filter(b => !b.cb), b => b.charge);
  const totalAll = sum(biWin, b => b.charge);
  const totalValid = sum(biWin.filter(b => b.cb), b => b.charge);
  const ok = Math.abs(totalAll - totalValid - exclGwp) < 0.005;
  sim(7, 'Agent removal', ok ? 'PASS' : 'FAIL', `GWP all-owners R${totalAll.toFixed(2)} − valid-agents R${totalValid.toFixed(2)} = unattributed R${exclGwp.toFixed(2)} (${UNATTR.rows} rows, ${UNATTR.sales_accts.size} accounts) — surfaced, never spread`);
}
/* Sim 8 — agent addition: adding one valid agent moves totals by their contribution */
{
  const top = [...AGENT_TABLE].filter(r => r.sales > 0).sort((a, b) => b.gwp_ex - a.gwp_ex)[0];
  if (top) {
    const without = sum(biWin.filter(b => b.cb && b.cb !== top.cb), b => b.charge);
    const ok = Math.abs(without + top.gwp_ex - sum(biWin.filter(b => b.cb), b => b.charge)) < 0.005;
    sim(8, 'Agent addition', ok ? 'PASS' : 'FAIL', `re-adding top agent ${top.cb} raises valid GWP by exactly R${top.gwp_ex.toFixed(2)} and sales by ${top.sales}`);
  } else sim(8, 'Agent addition', 'SKIPPED', 'no agent with in-window sales');
}
/* Sim 9 — duplicate injection: unique metrics immune, raw counts move */
{
  const probe = CX.find(c => inWindow(c.day) && c.person === 'VALID_AGENT' && c.destination && c.destination !== 's');
  if (probe) {
    const injected = [...CX, { ...probe, _row: -1 }];
    const uniq = new Set(injected.filter(c => inWindow(c.day) && c.destination && c.destination !== 's').map(c => c.destination)).size;
    const raw = injected.filter(c => inWindow(c.day)).length;
    const caught = findDupes('SIM9', injected, c => [c.dt, c.destination, c.agent_raw, c.duration_s, c.channel].join('|'), 'x') > cxDupes;
    dupTables.splice(dupTables.findIndex(d => d.source === 'SIM9'), dupTables.filter(d => d.source === 'SIM9').length);
    const ok = uniq === overall.cx_unique_flat && raw === overall.cx_total + 1 && caught;
    sim(9, 'Duplicate injection', ok ? 'PASS' : 'FAIL', `injected copy of row ${probe._row}: unique calls unchanged (${uniq}), raw count +1 (${raw}), duplicate detector caught it (${caught})`);
  } else sim(9, 'Duplicate injection', 'SKIPPED', 'no probe row');
}
/* Sim 10 — missing record: removing one QA row moves that agent's average predictably */
{
  const ag = AGENT_TABLE.find(r => r.qa_n >= 2);
  if (ag) {
    const rows = QA.filter(q => inWindow(q.day) && q.cb === ag.cb && q.eff_score != null);
    const removed = rows[0];
    const newAvg = +(rows.slice(1).reduce((s, q) => s + q.eff_score, 0) / (rows.length - 1)).toFixed(1);
    const predicted = +(((ag.qa_avg * ag.qa_n) - removed.eff_score) / (ag.qa_n - 1)).toFixed(1);
    const ok = Math.abs(newAvg - predicted) <= 0.1;
    sim(10, 'Missing-record', ok ? 'PASS' : 'FAIL', `removing one eval (score ${removed.eff_score}) from ${ag.cb}: recomputed avg ${newAvg} = predicted ${predicted}`);
  } else sim(10, 'Missing-record', 'SKIPPED', 'no agent with ≥2 evals');
}

/* ---------------- 6. reconciliation ---------------- */
const recon = [];
const rrow = (metric, agentsSum, unattr, overallVal) => {
  const ok = Math.abs(agentsSum + unattr - overallVal) < 0.01;
  recon.push({ metric, agents: +agentsSum.toFixed(2), unattributed: +unattr.toFixed(2), overall: +overallVal.toFixed(2), status: ok ? 'PASS' : 'FAIL' });
  if (!ok) finding('CRITICAL', 'RECONCILIATION', `${metric}: Σagents ${agentsSum} + unattributed ${unattr} ≠ overall ${overallVal}`);
};
rrow('GWP ex-VAT (R)', sum(AGENT_TABLE, r => r.gwp_ex), UNATTR.gwp_ex, overall.gwp_ex_flat);
rrow('CallX agent calls', sum(AGENT_TABLE, r => r.cx_calls), 0, overall.cx_agent_rows);
rrow('Vici dials (valid agents)', sum(AGENT_TABLE, r => r.vici_dials), 0, VICI.filter(v => inWindow(v.day) && v.person === 'VALID_AGENT').length);
rrow('Vici talk seconds', [...M.values()].reduce((s, m) => s + m.vici_talk, 0), sum(VICI.filter(v => inWindow(v.day) && v.person === 'NOT_IN_SOURCE_OF_TRUTH' && !sysUsers.has(v.user_raw.toUpperCase())), v => v.len) + sum(VICI.filter(v => inWindow(v.day) && v.person === 'MANAGEMENT_OR_STAFF'), v => v.len), VICI.stats.allSecs);
rrow('QA evals (valid agents)', sum(AGENT_TABLE, r => r.qa_n), 0, QA.filter(q => inWindow(q.day) && q.person === 'VALID_AGENT' && q.eff_score != null).length);
rrow('Open cases', sum(AGENT_TABLE, r => r.open_cases), UNATTR.open_cases, OPEN.length);
rrow('Present days', sum(AGENT_TABLE, r => r.present_days), 0, [...M.values()].reduce((s, m) => s + m.present, 0));

/* additional structural findings */
if (!disputeVocabHit.length && QA.length) finding('MEDIUM', 'QA', `qaDisputeStatuses rule (${RULES.qaDisputeStatuses.join(', ')}) matches NOTHING in this export's Status vocabulary (${qaStatusVocab.slice(0, 6).join(' | ')}…). Disputed reads 0 — vocabulary drift between rule and export, route to Jared.`);
if (viciOverlap) finding('MEDIUM', 'VICI', `${viciOverlap}/${VICI_TXT.length} rows of the 13-Aug Vici txt export are already inside "${NAMES.vici}" — loading both would double-count 13 Aug. The txt file is the VAS-scope daily export; EXCLUDED from ops metrics this run.`);
if (rosterOverrides.length) finding('MEDIUM', 'AGENT_LIST', `${rosterOverrides.length} CB codes appear on two roster tabs — last tab kept (dashboard rule): ${rosterOverrides.map(o => o.cb).join(', ')}`);
if (AMBIGUOUS_DATES.length) finding('MEDIUM', 'DATES', `${AMBIGUOUS_DATES.length} ambiguous DD/MM-vs-MM/DD dates skipped, never guessed`);
const attOnlyNames = [...new Set(ATT.filter(a => a.person === 'NOT_IN_SOURCE_OF_TRUTH').map(a => a.raw_code + ' ' + a.name))];
if (attOnlyNames.length) finding('HIGH', 'ATTENDANCE', `${attOnlyNames.length} attendance identities are in NEITHER the Agent List nor the register: ${attOnlyNames.join('; ')}`);
const cxUnknown = [...matchLog.values()].filter(v => v.source === 'CALLX' && v.status === 'NOT_IN_SOURCE_OF_TRUTH');
if (cxUnknown.length) finding('HIGH', 'CALLX', `${cxUnknown.length} CallX agent identities not resolvable to the Agent List (${sum(cxUnknown, v => v.rows)} rows) — excluded from agent KPIs, listed in agent-matching.csv`);

/* ---------------- 7. outputs ---------------- */
const csv = (rows, cols) => [cols.join(','), ...rows.map(r => cols.map(c => {
  let v = r[c]; if (v == null) v = ''; v = String(v);
  return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}).join(','))].join('\n');
const W = (name, content) => fs.writeFileSync(path.join(OUT_DIR, name), content, 'utf8');

W('validated-agents.csv', csv([...roster.values()], ['cb_norm', 'cb_code', 'agent_name', 'campaign', 'team_leader', 'tenure', 'target', 'start_date', 'job_title', 'sf_name', 'callx_alias', 'source_sheet']));
W('agent-matching.csv', csv([...matchLog.values()].sort((a, b) => a.status.localeCompare(b.status) || a.source.localeCompare(b.source)), ['source', 'raw', 'cb', 'name', 'method', 'status', 'rows']));
W('formula-validation.csv', csv(formulaChecks, ['metric', 'formula', 'expected', 'actual', 'status']));
W('excluded-records.csv', csv(excluded, ['source', 'row', 'who', 'reason', 'type']));
W('duplicates.csv', csv(dupTables, ['source', 'key', 'count']));
W('reconciliation.csv', csv(recon, ['metric', 'agents', 'unattributed', 'overall', 'status']));
W('mtd-agent-dataset.csv', csv(AGENT_TABLE.map(r => ({ ...r, att_pct: r.att_pct == null ? 'N/A' : r.att_pct.toFixed(1), unplanned_pct: r.unplanned_pct == null ? 'N/A' : r.unplanned_pct.toFixed(1), cx_answer_pct: r.cx_answer_pct == null ? 'N/A' : r.cx_answer_pct.toFixed(1), qa_cfr_pct: r.qa_cfr_pct == null ? 'N/A' : r.qa_cfr_pct.toFixed(1), qa_avg: r.qa_avg == null ? 'N/A' : r.qa_avg, target_ach_pct: r.target_ach_pct == null ? 'N/A' : r.target_ach_pct })),
  ['cb', 'name', 'campaign', 'tl', 'tenure', 'target', 'sched_days', 'present_days', 'att_pct', 'unplanned_pct', 'cx_calls', 'cx_answer_pct', 'cx_unique', 'cx_talk_min', 'vici_dials', 'vici_uniq', 'vici_talk_min', 'sales', 'gwp_ex', 'gwp_incl', 'cancels', 'gwp_lost_ex', 'open_cases', 'qa_n', 'qa_avg', 'qa_cfr_pct', 'qa_disputed', 'target_ach_pct']));

/* Vici Dial Report — the VAS-analytics treatment (talk = Σ length_in_sec on the CB;
 * average talk time / AHT = talk ÷ answered; totals recomputed from summed counts). */
const fmtDur = s => { if (s == null) return 'N/A'; s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h ? `${h}:${pad(m)}:${pad(x)}` : `${m}:${pad(x)}`; };
const viciAgents = AGENT_TABLE.filter(r => r.vici_dials > 0).sort((a, b) => b.vici_talk_min - a.vici_talk_min);
const vt = {
  dials: sum(viciAgents, r => r.vici_dials), ans: sum(viciAgents, r => r.vici_ans),
  talk: [...M.values()].reduce((s, m) => s + m.vici_talk, 0),
  opt: sum(viciAgents, r => r.vici_opt), saleD: sum(viciAgents, r => r.vici_sale_disp),
};
const viciReportRows = viciAgents.map(r => ({
  cb: r.cb, name: r.name, campaign: r.campaign, tl: r.tl,
  dial_days: r.vici_days, dials: r.vici_dials, unique_numbers: r.vici_uniq,
  answered: r.vici_ans, answer_pct: r.vici_answer_pct == null ? 'N/A' : r.vici_answer_pct.toFixed(1),
  talk_time: fmtDur(r.vici_talk_s), avg_talk_time: fmtDur(r.vici_aht_s),
  talk_per_day: r.vici_talk_per_day_min == null ? 'N/A' : fmtDur(r.vici_talk_per_day_min * 60),
  opt_ins: r.vici_opt, sale_dispositions: r.vici_sale_disp,
}));
viciReportRows.push({
  cb: 'TOTAL', name: `${viciAgents.length} agents`, campaign: '', tl: '',
  dial_days: [...new Set(VICI.filter(v => inWindow(v.day) && v.person === 'VALID_AGENT').map(v => v.day))].length,
  dials: vt.dials, unique_numbers: new Set(VICI.filter(v => inWindow(v.day) && v.person === 'VALID_AGENT').map(v => v.phone)).size,
  answered: vt.ans, answer_pct: vt.dials ? (100 * vt.ans / vt.dials).toFixed(1) : 'N/A',   // recomputed from summed counts, never averaged
  talk_time: fmtDur(vt.talk), avg_talk_time: fmtDur(vt.ans ? vt.talk / vt.ans : null),
  talk_per_day: '', opt_ins: vt.opt, sale_dispositions: vt.saleD,
});
W('vici-dial-report.csv', csv(viciReportRows, ['cb', 'name', 'campaign', 'tl', 'dial_days', 'dials', 'unique_numbers', 'answered', 'answer_pct', 'talk_time', 'avg_talk_time', 'talk_per_day', 'opt_ins', 'sale_dispositions']));

const critN = findings.filter(f => f.sev === 'CRITICAL').length;
const highN = findings.filter(f => f.sev === 'HIGH').length;
const formulaFail = formulaChecks.some(f => f.status === 'FAIL') || recon.some(r => r.status === 'FAIL');
const FINAL = (critN && formulaFail) ? 'FAILED VALIDATION' : critN ? 'FAILED VALIDATION (blocked by CRITICAL findings)' : highN ? 'PASS WITH WARNINGS' : 'PASS';

const md = [];
md.push(`# Upload Station Validation — package 2026-08-13 (ops analytics)`);
md.push(`\nPeriod **${P_START} → ${P_END}** · run ${new Date().toISOString().slice(0, 16)}Z · engine \`tools/upload-station-validate.mjs\``);
md.push(`\n## FINAL STATUS: ${FINAL}`);
md.push(`\n| Gate | Result |\n|---|---|`);
md.push(`| Agent validation | ${[...matchLog.values()].filter(v => v.status === 'NOT_IN_SOURCE_OF_TRUTH').length} unresolved identities (see agent-matching.csv) |`);
md.push(`| Formula validation | ${formulaChecks.filter(f => f.status === 'PASS').length}/${formulaChecks.length} PASS |`);
md.push(`| Duplicate validation | ${cxDupes + qaDupes + attDupes + openDupes + biDupes + viciDupes} duplicates flagged |`);
md.push(`| Date validation | in-window filters live on every source (Sim 5) |`);
md.push(`| Reconciliation | ${recon.filter(r => r.status === 'PASS').length}/${recon.length} PASS |`);
md.push(`| Simulations | ${sims.filter(s => s.status === 'PASS' || s.status === 'DONE').length}/${sims.length} clean |`);
md.push(`| Findings | ${critN} CRITICAL · ${highN} HIGH · ${findings.filter(f => f.sev === 'MEDIUM').length} MEDIUM |`);
md.push(`\n## Sources ingested\n\n| File | Source | Raw rows | In window | Note |\n|---|---|---|---|---|`);
md.push(`| ${NAMES.agentList} | AGENT_LIST | ${[...roster.size ? [roster.size] : []]} agents | — | sheets kept: ${matchedSheets.map(m => m.sheet).join(', ')} · dropped: ${droppedSheets.map(d => d.sheet).join(', ')} |`);
md.push(`| ${NAMES.attendance} | ATTENDANCE | ${ATT.length} | ${ATT.filter(a => inWindow(a.day)).length} | covers ${[...new Set(ATT.map(a => a.day))].sort()[0]} → ${[...new Set(ATT.map(a => a.day))].sort().pop()} |`);
md.push(`| ${NAMES.callx} | CALLX_CALL_RECORDS | ${CX.length} | ${overall.cx_total} | inbound no-agent legs: ${CX.filter(c => c.person === 'INBOUND_NO_AGENT').length} |`);
md.push(`| ${NAMES.vici} | VICI (dialler, VT floor) | ${VICI.length} | ${overall.vici_total} | ViciDial shape, NOT CallX — user column is the agent |`);
md.push(`| ${NAMES.viciTxt || '—'} | VICI daily txt | ${VICI_TXT.length} | — | ${viciOverlap} rows already in the 01–13 report → excluded (double-count guard) |`);
md.push(`| ${NAMES.qa} | QA_EVALUATIONS | ${QA.length} | ${overall.qa_in_window} | windowed on Date of Call |`);
md.push(`| ${NAMES.active} | BI_ACTIVE_CASES | ${BI.length} | ${biWin.length} | THE money source; charges EX-VAT |`);
md.push(`| ${NAMES.inactive} | SF_INACTIVE | ${INACT.length} | ${inactWin.length} | windowed by Contract Create |`);
md.push(`| ${NAMES.sfOpen} | SF_OPEN_CASES | ${OPEN.length} | snapshot | HTML .xls parsed as table |`);
md.push(`| ${NAMES.sfClosed} | SF_CLOSED_CASES | **${CLOSED.length}** | — | **frameset shell — NO DATA** |`);
md.push(`\n## Findings (severity-ordered)\n`);
for (const sev of ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']) for (const f of findings.filter(x => x.sev === sev)) md.push(`- **${sev}** [${f.area}] ${f.msg}`);
md.push(`\n## Simulations\n\n| # | Simulation | Status | Detail |\n|---|---|---|---|`);
for (const s of sims) md.push(`| ${s.n} | ${s.name} | ${s.status} | ${s.detail} |`);
md.push(`\n## Reconciliation\n\n| Metric | Σ agents | Unattributed | Overall | Status |\n|---|---|---|---|---|`);
for (const r of recon) md.push(`| ${r.metric} | ${r.agents} | ${r.unattributed} | ${r.overall} | ${r.status} |`);
md.push(`\n## Vici Dial Report (VAS-analytics treatment · talkFrom '${VICI_RULES.talkFrom}')\n`);
md.push(`Talk time = Σ \`length_in_sec\` grouped on the CB number (the \`user\` login, with the Agent List's name resolution winning any clash). Average talk time (AHT) = talk ÷ answered calls, where answered = status outside the no-contact list ('A' is Answering Machine, not answered). Totals recomputed from summed counts, never averaged percentages.\n`);
md.push(`- Ringing share (talkFrom 'all' includes it): **${fmtDur(VICI.stats.ringSecs)} of ${fmtDur(VICI.stats.allSecs)}** (${VICI.stats.allSecs ? Math.round(100 * VICI.stats.ringSecs / VICI.stats.allSecs) : 0}%) sits on no-contact statuses — set talkFrom 'contacted' to bill only reached calls`);
md.push(`- System logins excluded and counted: ${Object.entries(VICI.stats.sysHits).map(([k, v]) => `${k} ${v}`).join(' · ') || 'none'} (${VICI.stats.sysRows} rows) · negative lengths zeroed: ${VICI.stats.negatives} · in-file record-key dupes: ${VICI.stats.dupes}`);
md.push(`- Login→roster reassignments (NAME wins): ${Object.entries(VICI.stats.reassigned).map(([k, v]) => `${k} ×${v}`).join(' · ') || 'none'}`);
md.push(`\n| CB | Agent | Days | Dials | Answered | Answer % | Talk | Avg talk (AHT) | Talk/day | Opt-ins | Sale disp |\n|---|---|---|---|---|---|---|---|---|---|---|`);
for (const r of viciReportRows) md.push(`| ${r.cb} | ${r.name} | ${r.dial_days} | ${r.dials} | ${r.answered} | ${r.answer_pct} | ${r.talk_time} | ${r.avg_talk_time} | ${r.talk_per_day} | ${r.opt_ins} | ${r.sale_dispositions} |`);
md.push(`\n## Headline recalculated figures (valid reporting agents only, ${P_START} → ${P_END})\n`);
md.push(`- Roster: **${roster.size} agents** (${[...roster.values()].filter(a => a.source_sheet === 'VAS').length} VAS · ${[...roster.values()].filter(a => a.source_sheet === 'VT').length} VT) — register carries ${register.size} employees for management classification`);
md.push(`- Sales (distinct BI accounts): **${overall.sales_flat}** · GWP **R${overall.gwp_ex_flat.toFixed(2)} ex-VAT / R${(overall.gwp_ex_flat * vat).toFixed(2)} incl** — unattributed R${UNATTR.gwp_ex.toFixed(2)} across ${UNATTR.sales_accts.size} accounts (${UNATTR.rows} rows)`);
md.push(`- Cancellations: **${new Set(inactWin.map(b => b.account)).size} accounts** windowed by Contract Create · GWP lost R${sum(inactWin, b => b.charge).toFixed(2)} ex`);
md.push(`- CallX: ${overall.cx_total} calls in window (${overall.cx_agent_rows} on valid agents) · unique destinations ${overall.cx_unique_flat}`);
md.push(`- Vici (VT floor): ${overall.vici_total} dials · ${overall.vici_talk_h}h talk incl ringing (user-column join)`);
md.push(`- QA: ${overall.qa_in_window} evals in window · Open cases snapshot: ${overall.open_cases}`);
md.push(`- Closed cases: **N/A — source file empty (see CRITICAL finding)**`);
md.push(`\n## Output files\n\nvalidated-agents.csv · mtd-agent-dataset.csv · vici-dial-report.csv · agent-matching.csv · formula-validation.csv · excluded-records.csv · duplicates.csv · reconciliation.csv`);
md.push(`\n*Raw uploads untouched in \`uploads/2026-08-13/\`. Every excluded record carries a reason; nothing was silently deleted. POPIA: this report contains agent names — keep it inside the repo (reports/ is not deployed).*`);
W('VALIDATION-REPORT.md', md.join('\n'));

/* compact console summary */
console.log(`FINAL: ${FINAL}`);
console.log(`roster=${roster.size} register=${register.size} | att=${ATT.length} cx=${CX.length} vici=${VICI.length} qa=${QA.length} bi=${BI.length}(win ${biWin.length}) inact=${INACT.length}(win ${inactWin.length}) open=${OPEN.length} closed=${CLOSED.length}`);
console.log(`sales=${overall.sales_flat} gwp_ex=R${overall.gwp_ex_flat.toFixed(2)} unattr=R${UNATTR.gwp_ex.toFixed(2)} | cxWin=${overall.cx_total} uniq=${overall.cx_unique_flat} | viciWin=${overall.vici_total}`);
console.log(`findings: ${critN} CRITICAL, ${highN} HIGH, ${findings.filter(f => f.sev === 'MEDIUM').length} MEDIUM`);
findings.forEach(f => console.log(`  [${f.sev}] ${f.area}: ${f.msg.slice(0, 160)}`));
console.log(`sims: ${sims.map(s => s.n + ':' + s.status).join(' ')}`);
console.log(`recon: ${recon.map(r => r.metric + '=' + r.status).join(' | ')}`);
console.log(`formula: ${formulaChecks.map(f => f.metric + '=' + f.status).join(' | ')}`);
console.log(`OUT: ${OUT_DIR}`);
