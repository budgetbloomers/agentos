// FULL AUDIT of the 2026-08-13 upload package against the Agent List.
// The Agent List is the source of truth: every source row is resolved to a CB number, and the
// campaign (Cuddle / Courtesy / Nesting / VT) is read off the roster, never off the file.
// Reports, per source: what attributes, what does not, and which roster agents have no data.
import XLSX from 'xlsx';
import fs from 'node:fs';

// usage: node audit-upload-day.mjs [uploadFolder] [YYYY-MM-DD]
// defaults to the 2026-08-13 package. The day defaults to the folder name when it is a date.
const ROOT = 'c:/Users/aarav/OneDrive/Desktop/Chatterbox Agent OS/agentos/uploads/';
const FOLDER = process.argv[2] || '2026-08-13';
const UP = (FOLDER.includes('/') ? FOLDER : ROOT + FOLDER).replace(/\/?$/, '/');
const DAY = process.argv[3] || (/^\d{4}-\d{2}-\d{2}$/.test(FOLDER) ? FOLDER : '2026-08-13');
const pick = re => { const f = fs.readdirSync(UP).filter(x => re.test(x)); return f.length ? UP + f[0] : null; };
const normCB = s => { const t = String(s == null ? '' : s).trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const m = /^CB0*(\d+)$/.exec(t); return m ? 'CB' + m[1] : ''; };
const embCB = s => { const m = /CB[\s._-]*0*(\d{1,4})/i.exec(String(s || '')); return m ? 'CB' + m[1] : ''; };
// same shape as the apps' normName: drop the " - BusinessUnit" suffix Salesforce/BI append
// ("Jolene Chetty - Panimax"), then any embedded CB token ("Thulani Mbonambi CB-142").
const normNm = s => String(s == null ? '' : s).toLowerCase().replace(/\s+-\s*.*$|\s*-\s+.*$/, '')
  .replace(/cb[\s._-]*\d+/g, ' ').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
const debom = s => String(s || '').replace(/^﻿/, '');

/* ---------- THE SPINE: the Agent List ---------- */
const wbA = XLSX.readFile(pick(/Agent List.*.xlsx$/i));
const roster = [];
for (const sn of wbA.SheetNames) {
  const rows = XLSX.utils.sheet_to_json(wbA.Sheets[sn], { defval: '' });
  if (!rows.length) continue;
  const k = Object.keys(rows[0]);
  if (!k.some(x => /employee code/i.test(x)) || !k.some(x => /campaign/i.test(x))) continue;
  const kc = k.find(x => /employee code/i.test(x)), kn = k.find(x => /agent name/i.test(x)),
    kg = k.find(x => /campaign/i.test(x)), kx = k.find(x => /call ?x/i.test(x)),
    ks = k.find(x => /sales ?force/i.test(x)), kt = k.find(x => /team leader/i.test(x));
  rows.forEach(r => { const cb = normCB(r[kc]); if (!cb) return;
    roster.push({ cb, name: String(r[kn] || '').trim(), camp: String(r[kg] || '').trim(),
      callx: String(r[kx] || '').trim(), sf: String(r[ks] || '').trim(), tl: String(r[kt] || '').trim() }); });
}
const byCb = {}; roster.forEach(a => byCb[a.cb] = a);
const nameIx = {}; roster.forEach(a => { (nameIx[normNm(a.name)] = nameIx[normNm(a.name)] || []).push(a.cb);
  if (a.sf) (nameIx[normNm(a.sf)] = nameIx[normNm(a.sf)] || []).push(a.cb);
  if (a.callx) (nameIx[normNm(a.callx)] = nameIx[normNm(a.callx)] || []).push(a.cb); });
const group = c => /cuddle/i.test(c) ? 'Cuddle' : /courtesy/i.test(c) ? 'Courtesy'
  : /nest/i.test(c) ? 'Nesting' : /track|vehicle/i.test(c) ? 'VT' : (c || '(blank)');
const campOf = cb => byCb[cb] ? group(byCb[cb].camp) : null;

// resolve: CB first (Nick: identify off the CB number), then unambiguous name, then embedded CB
const resolve = (id, nm) => {
  const d = normCB(id); if (d && byCb[d]) return { cb: d, via: 'cb' };
  const e = embCB(id) || embCB(nm);
  const c = nameIx[normNm(nm)] || []; const uniq = [...new Set(c)];
  if (uniq.length === 1) return { cb: uniq[0], via: 'name' };
  if (e && byCb[e]) return { cb: e, via: 'embedded-cb' };
  return { cb: null, via: null };
};

const GROUPS = ['Cuddle', 'Courtesy', 'Nesting', 'VT'];
const rosterCount = {}; roster.forEach(a => { const g = group(a.camp); rosterCount[g] = (rosterCount[g] || 0) + 1; });
console.log('AGENT LIST (the spine): ' + roster.length + ' agents — ' +
  Object.keys(rosterCount).sort().map(g => g + ' ' + rosterCount[g]).join(' · '));

const report = (label, recs, unit) => {
  // recs: {id, nm, val, cb, via}
  const seen = {}, orph = {}; let attributed = 0, orphaned = 0, aval = 0, oval = 0;
  recs.forEach(r => {
    if (r.cb) { attributed++; aval += r.val || 0; const g = campOf(r.cb) || '(off-roster)';
      (seen[g] = seen[g] || { n: 0, val: 0, ag: new Set() }); seen[g].n++; seen[g].val += r.val || 0; seen[g].ag.add(r.cb); }
    else { orphaned++; oval += r.val || 0; const k = (r.nm || r.id || '(blank)').trim();
      (orph[k] = orph[k] || { n: 0, val: 0 }); orph[k].n++; orph[k].val += r.val || 0; }
  });
  console.log('\n=== ' + label + ' ===');
  console.log('  rows ' + recs.length + '  ->  attributed ' + attributed + '  ·  NOT attributed ' + orphaned
    + (orphaned ? '  (' + (orphaned / recs.length * 100).toFixed(1) + '%)' : ''));
  GROUPS.forEach(g => { if (seen[g]) console.log('    ' + g.padEnd(9) + String(seen[g].n).padStart(6) + ' rows · '
    + String(seen[g].ag.size).padStart(3) + ' agents' + (unit ? ' · ' + unit(seen[g].val) : '')); });
  Object.keys(seen).filter(g => !GROUPS.includes(g)).forEach(g =>
    console.log('    ' + g.padEnd(9) + String(seen[g].n).padStart(6) + ' rows · ' + seen[g].ag.size + ' agents'));
  const ok = Object.keys(orph).sort((a, b) => orph[b].n - orph[a].n);
  if (ok.length) {
    console.log('  --- NOT on the Agent List (' + ok.length + ' identities' + (unit ? ', ' + unit(oval) : '') + ') ---');
    ok.slice(0, 25).forEach(k => console.log('      ' + String(orph[k].n).padStart(6) + '  ' + k + (unit ? '  ' + unit(orph[k].val) : '')));
    if (ok.length > 25) console.log('      …and ' + (ok.length - 25) + ' more');
  }
  return { seen, orph };
};
const hrs = v => (v / 3600).toFixed(1) + 'h';
const zar = v => 'R' + Math.round(v).toLocaleString();

/* ---------- 1. ViciDial day-level ---------- */
const txt = fs.readFileSync(pick(/EXPORT_CALL_REPORT.*.txt$/i), 'utf8').split(/\r?\n/).filter(Boolean);
const th = txt[0].split('\t'); const ix = n => th.indexOf(n);
const SYS = new Set(['VDAD', 'VDCL', 'VDLB', 'CBT001', 'CBT003', 'CBT005', 'CBT007']);
const vici = [];
let sysRows = 0;
const ug = {};                       // user_group census — says what the pull actually covered
txt.slice(1).forEach(l => { const c = l.split('\t');
  const login = String(c[ix('user')] || '').trim();
  if (ix('user_group') >= 0) { const g = String(c[ix('user_group')] || '').trim(); ug[g] = (ug[g] || 0) + 1; }
  if (SYS.has(login.toUpperCase())) { sysRows++; return; }
  const r = resolve(login, c[ix('full_name')]);
  vici.push({ id: login, nm: c[ix('full_name')], val: Math.max(0, +c[ix('length_in_sec')] || 0), ...r }); });
report('ViciDial EXPORT_CALL_REPORT (13 Aug, per-call) — talk', vici, hrs);
console.log('  (' + sysRows + ' system/training rows excluded: VDAD/VDCL/CBT…)');

/* ---------- 2. CallX ---------- */
const splitCsv = l => { const o = []; let c = '', q = false;
  for (let i = 0; i < l.length; i++) { const ch = l[i];
    if (ch === '"') { q = !q; continue; } if (ch === ',' && !q) { o.push(c); c = ''; continue; } c += ch; }
  o.push(c); return o; };
const cl = fs.readFileSync(pick(/call_records.*.csv$/i), 'utf8').split(/\r?\n/).filter(Boolean);
const ch2 = splitCsv(cl[0]).map(debom);
const ai = ch2.indexOf('Agent'), di = ch2.indexOf('Date & Time'), bi = ch2.indexOf('Billable Seconds');
const callx = [];
cl.slice(1).forEach(l => { const c = splitCsv(l);
  if (String(c[di] || '').slice(0, 10) !== DAY) return;
  const ag = String(c[ai] || '').trim();
  if (!ag) return;                       // inbound queue legs with no agent
  callx.push({ id: ag, nm: ag, val: +c[bi] || 0, ...resolve(ag, ag) }); });
report('CallX call_records.csv (13 Aug, agent-handled) — billable', callx, hrs);

/* ---------- 3. Power BI money ---------- */
const biRows = XLSX.utils.sheet_to_json(XLSX.readFile(pick(/^Active.*.xlsx$/i)).Sheets[XLSX.readFile(pick(/^Active.*.xlsx$/i)).SheetNames[0]], { defval: '' });
const bk = Object.keys(biRows[0] || {});
const kOwn = bk.find(x => /^owner$/i.test(x)), kAmt = bk.find(x => /charge amount/i.test(x)), kDate = bk.find(x => /contract create date/i.test(x));
const xd = v => { if (typeof v === 'number') { const t = XLSX.SSF.parse_date_code(v); return t ? t.y + '-' + String(t.m).padStart(2, '0') + '-' + String(t.d).padStart(2, '0') : ''; } return String(v).slice(0, 10); };
const bi13 = biRows.filter(r => xd(r[kDate]) === DAY)
  .map(r => ({ id: r[kOwn], nm: r[kOwn], val: +String(r[kAmt]).replace(/[^\d.-]/g, '') || 0, ...resolve(r[kOwn], r[kOwn]) }));
report('Power BI Active (13 Aug contract-create) — charge ex-VAT', bi13, zar);
console.log('  (whole file: ' + biRows.length + ' rows across all dates)');

/* ---------- 4. QA ---------- */
const qa = fs.readFileSync(pick(/evaluations.*.csv$/i), 'utf8').split(/\r?\n/).filter(Boolean);
const qh = splitCsv(qa[0]).map(debom);
const qAg = qh.indexOf('Sales Agent'), qCb = qh.indexOf('Sales Agent CB'), qDc = qh.indexOf('Date of Call');
const qa13 = [];
qa.slice(1).forEach(l => { const c = splitCsv(l);
  const d = String(c[qDc] || '').slice(0, 10); if (d !== DAY) return;
  qa13.push({ id: c[qCb], nm: c[qAg], val: 1, ...resolve(c[qCb], c[qAg]) }); });
report('QA evaluations (13 Aug date-of-call)', qa13);

/* ---------- 5. Attendance ---------- */
const at = fs.readFileSync(pick(/^attendance.*.csv$/i), 'utf8').split(/\r?\n/).filter(Boolean);
const ah = splitCsv(at[0]).map(debom);
const aC = ah.findIndex(x => /employee code/i.test(x)), aN = ah.findIndex(x => /employee name/i.test(x)),
  aD = ah.findIndex(x => /^date$/i.test(x)), aS = ah.findIndex(x => /^status$/i.test(x));
const att13 = [];
at.slice(1).forEach(l => { const c = splitCsv(l);
  let d = String(c[aD] || '').slice(0, 10);
  if (d !== DAY) return;
  att13.push({ id: c[aC], nm: c[aN], val: 1, st: c[aS], ...resolve(c[aC], c[aN]) }); });
report('Attendance register (13 Aug)', att13);

/* ---------- 6. Coverage: which roster agents have NOTHING on the 13th ---------- */
const has = src => { const s = new Set(); src.forEach(r => { if (r.cb) s.add(r.cb); }); return s; };
const hv = has(vici), hc = has(callx), hq = has(qa13), ha = has(att13), hb = has(bi13);
console.log('\n=== COVERAGE ON 13 AUG, per roster group ===');
console.log('  group      agents   dialler(any)   attendance   QA   BI-sale');
GROUPS.forEach(g => {
  const ag = roster.filter(a => group(a.camp) === g).map(a => a.cb);
  const dial = ag.filter(c => hv.has(c) || hc.has(c)).length;
  console.log('  ' + g.padEnd(10) + String(ag.length).padStart(6) + String(dial).padStart(15)
    + String(ag.filter(c => ha.has(c)).length).padStart(13) + String(ag.filter(c => hq.has(c)).length).padStart(5)
    + String(ag.filter(c => hb.has(c)).length).padStart(9));
});
/* ---------- THE COVERAGE LAW (specs/dialler-attribution-framework.md §5) ----------
   One agent at zero is ordinary — leave, training, an admin day. A WHOLE campaign group at zero
   while its people are marked present and booking sales is a filtered export, not an idle floor.
   That asymmetry is the whole signal, so it is the thing that fails the run. */
console.log('\n=== COVERAGE VERDICT ===');
let failed = 0, warned = 0;
const groupsPresent = {};
att13.forEach(r => { if (r.cb && !/absent|off|leave|resign|terminat/i.test(r.st || '')) {
  const g = campOf(r.cb); if (g) (groupsPresent[g] = groupsPresent[g] || new Set()).add(r.cb); } });
GROUPS.forEach(g => {
  const ag = roster.filter(a => group(a.camp) === g).map(a => a.cb);
  const present = groupsPresent[g] ? groupsPresent[g].size : 0;
  const dialled = ag.filter(c => hv.has(c) || hc.has(c)).length;
  const sold = ag.filter(c => hb.has(c)).length;
  let verdict, note = '';
  if (!present && !dialled) { verdict = 'skip'; note = 'nobody marked present — no attendance rows for this group'; }
  else if (present >= 1 && dialled === 0) { verdict = 'FAIL'; failed++;
    note = present + ' present' + (sold ? ' and ' + sold + ' booked sales' : '') + ' but ZERO dialler rows — the export is filtered or missing'; }
  else if (present && dialled / present < 0.5) { verdict = 'WARN'; warned++;
    note = 'only ' + dialled + ' of ' + present + ' present agents have dialler rows'; }
  else { verdict = 'pass'; note = dialled + ' dialling of ' + present + ' present'; }
  console.log('  ' + (verdict === 'FAIL' ? 'FAIL  ' : verdict === 'WARN' ? 'WARN  ' : verdict === 'skip' ? '  --  ' : '  ok  ')
    + g.padEnd(9) + note);
});
console.log(failed ? '\n  ' + failed + ' group(s) FAILED — re-pull the dialler export with ALL user groups selected'
  : warned ? '\n  ' + warned + ' group(s) on WARN — check partial coverage before trusting the day'
  : '\n  every group with present agents has dialler coverage');
if (ug && Object.keys(ug).length) {
  console.log('\n  ViciDial user_group values in this pull (the evidence of what it covered):');
  Object.keys(ug).sort((a, b) => ug[b] - ug[a]).forEach(k => console.log('    ' + String(ug[k]).padStart(6) + '  ' + (k || '(blank)')));
}

const noDial = roster.filter(a => !hv.has(a.cb) && !hc.has(a.cb));
const presentCodes = new Set(att13.filter(r => r.cb && !/absent|off|leave|resign|terminat/i.test(r.st || '')).map(r => r.cb));
const workedNoDial = noDial.filter(a => presentCodes.has(a.cb));
console.log('\n  Roster agents with NO dialler row on 13 Aug: ' + noDial.length + ' of ' + roster.length);
console.log('  …of whom the attendance register marks PRESENT: ' + workedNoDial.length);
const byG = {}; workedNoDial.forEach(a => { const g = group(a.camp); (byG[g] = byG[g] || []).push(a.cb + ' ' + a.name); });
Object.keys(byG).sort().forEach(g => {
  console.log('    ' + g + ' (' + byG[g].length + '): ' + byG[g].slice(0, 8).join(', ') + (byG[g].length > 8 ? ' …' : ''));
});
