/* WHAT IS ACTUALLY IN THE UPLOADED DATA — run: node nicks_code/diagnostics/audit-uploaded-data.mjs

   ORIGINAL NOTE — a read-only coverage audit of the live vas-state.
   Answers the question the verifiers cannot: not "does the app compute correctly" but
   "is the data underneath it complete, and where are the holes". Read-only. */
import fs from 'node:fs';

/* State: a file if one is given, else pull it live from Supabase Storage (needs supabase.env),
   the same way verify-all-tabs does. Read-only throughout — this never writes to the blob. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const REPO = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
let blob = process.argv[2] ? fs.readFileSync(process.argv[2], 'utf8') : null;
if (!blob) {
  const envTxt = fs.readFileSync(path.join(REPO, 'supabase.env'), 'utf8');
  const env = Object.fromEntries(envTxt.split(/\r?\n/).filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
  const H = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY };
  const r = await fetch(env.SUPABASE_URL + '/storage/v1/object/raw/kv/vas-state', { headers: H, signal: AbortSignal.timeout(90000) });
  if (!r.ok) { console.error('cannot read live state: ' + r.status); process.exit(2); }
  blob = await r.text();
  console.log('pulled live state: ' + (blob.length / 1048576).toFixed(2) + ' MB');
}
const S = JSON.parse(blob);
const H = t => console.log('\n' + t + '\n' + '-'.repeat(t.length));
const days = o => Object.keys(o || {}).filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k)).sort();

/* ---------- 1. what has been uploaded ---------- */
H('1. UPLOAD LOG');
const byKind = {};
for (const f of S.files || []) {
  const k = f.kind || f.type || 'unknown';
  (byKind[k] = byKind[k] || []).push(f);
}
console.log(`  ${(S.files || []).length} files on record`);
for (const [k, list] of Object.entries(byKind).sort((a, b) => b[1].length - a[1].length)) {
  const ds = list.map(f => f.date || f.d || (f.range && f.range.from) || '?').filter(x => x !== '?').sort();
  console.log(`  ${String(list.length).padStart(3)}  ${k.padEnd(22)} ${ds.length ? ds[0] + ' -> ' + ds[ds.length - 1] : '(undated)'}`);
}

/* ---------- 2. per-source day coverage ---------- */
H('2. DAY COVERAGE BY SOURCE');
const SRC = {
  sales: S.sales, calls: S.calls, att: S.att, evals: S.evals,
  board: S.board, tracker: S.tracker, viciDays: S.viciDays,
};
const all = new Set();
for (const o of Object.values(SRC)) days(o).forEach(d => all.add(d));
const dl = [...all].sort();
console.log(`  the data spans ${dl[0]} -> ${dl[dl.length - 1]}  (${dl.length} distinct days)`);
for (const [n, o] of Object.entries(SRC)) {
  const d = days(o);
  console.log(`  ${n.padEnd(10)} ${String(d.length).padStart(3)} days  ${d.length ? d[0] + ' -> ' + d[d.length - 1] : '(none)'}`);
}

/* ---------- 3. the matrix: which day is missing what ---------- */
H('3. WHERE THE HOLES ARE  (S=sales C=calls A=attendance E=evals B=board  · = missing)');
const isWeekend = d => [0, 6].includes(new Date(d + 'T12:00:00').getDay());
/* ZA public holidays that fall inside the loaded span. A holiday with no register is not a
   missing upload, and calling it one sends someone hunting a file that never existed. */
const HOLIDAY = { '2026-08-10': "Women's Day observed (9 Aug fell on a Sunday)" };
const rows = [];
for (const d of dl) {
  const cell = o => (o && o[d] && Object.keys(o[d]).length) ? 1 : 0;
  const r = { d, S: cell(S.sales), C: cell(S.calls), A: cell(S.att), E: cell(S.evals), B: cell(S.board), we: isWeekend(d) || !!HOLIDAY[d], hol: HOLIDAY[d] };
  rows.push(r);
  const mark = k => r[k] ? k : '·';
  console.log(`  ${d} ${(r.hol ? 'holiday' : r.we ? 'sat/sun' : '       ')}  ${mark('S')} ${mark('C')} ${mark('A')} ${mark('E')} ${mark('B')}` + (r.hol ? '   ' + r.hol : ''));
}

/* ---------- 4. the ones that actually cost a number ---------- */
H('4. GAPS THAT CHANGE A REPORTED FIGURE');
const wd = rows.filter(r => !r.we);
const salesNoAtt = wd.filter(r => r.S && !r.A);
const callsNoAtt = wd.filter(r => r.C && !r.A);
const attNoCalls = wd.filter(r => r.A && !r.C);
const salesNoCalls = wd.filter(r => r.S && !r.C);
const line = (label, list, why) => {
  console.log(`  ${list.length ? 'FLAG' : 'ok  '} ${label}: ${list.length}` + (list.length ? `  [${list.slice(0, 12).map(r => r.d.slice(5)).join(' ')}${list.length > 12 ? ' ...' : ''}]` : ''));
  if (list.length) console.log(`        ${why}`);
};
line('weekdays with sales but NO attendance', salesNoAtt, 'Ave Talk Time and shift counts divide by employed shifts — a day with no register is a day those averages cannot see.');
line('weekdays with dialler but NO attendance', callsNoAtt, 'same denominator; talk lands with no shift to divide by.');
line('weekdays with attendance but NO dialler', attNoCalls, 'Ave Talk Time reads 0:00:00 for that day rather than unknown.');
line('weekdays with sales but NO dialler', salesNoCalls, 'DV03 flags a sale on a day with no dialling.');

/* ---------- 5. roster + identity ---------- */
H('5. ROSTER AND IDENTITY');
const roster = S.roster || [];
const codes = roster.map(a => String(a.code || '').toUpperCase().replace(/[^A-Z0-9]/g, ''));
const dupes = codes.filter((c, i) => c && codes.indexOf(c) !== i);
console.log(`  ${roster.length} agents on the Agent List`);
console.log(`  duplicate codes: ${dupes.length ? [...new Set(dupes)].join(', ') : 'none'}`);
const byCamp = {};
for (const a of roster) byCamp[a.campaign || '(blank)'] = (byCamp[a.campaign || '(blank)'] || 0) + 1;
console.log('  campaign split: ' + Object.entries(byCamp).map(([k, v]) => `${k} ${v}`).join(' · '));
const noTarget = roster.filter(a => !(a.target > 0));
console.log(`  agents with no sales target: ${noTarget.length}` + (noTarget.length ? ` (${[...new Set(noTarget.map(a => a.campaign || '(blank)'))].join(', ')})` : ''));
const noQ = roster.filter(a => !a.campaign);
console.log(`  agents with no campaign: ${noQ.length}` + (noQ.length ? ' -> ' + noQ.map(a => a.code).slice(0, 10).join(', ') : ''));

/* ---------- 6. dialler coverage by campaign (the VR16 law) ---------- */
H('6. DIALLER COVERAGE BY CAMPAIGN');
/* Identity resolution has to match the app's, or this audit invents problems. A dialler key is
   a free-text login like "Jabu Ntombele CB-138" or a bare "CB014": resolve the embedded CB code
   first (zero-padding stripped, CB016 = CB16), then fall back to the roster NAME columns
   (name / Sales Force / CallX alias), which is the join the Agent List defines. */
const normCB = v => { const m = String(v || '').match(/CB[\s._-]*0*(\d{1,4})/i); return m ? 'CB' + m[1] : String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); };
const normName = v => String(v || '').toLowerCase().replace(/\s+-\s*.*$|\s*-\s+.*$/, '').replace(/\s+/g, ' ').trim();
const campOf = {}, campByName = {};
for (const a of roster) {
  campOf[normCB(a.code)] = a.campaign || '(blank)';
  for (const nm of [a.name, a.sf, a.callx]) if (nm && nm !== '-') campByName[normName(nm)] = a.campaign || '(blank)';
}
const resolveCamp = k => campOf[normCB(k)] || campByName[normName(k)] || null;
const seen = {};
for (const d of days(S.calls)) {
  for (const k of Object.keys(S.calls[d] || {})) {
    const c = resolveCamp(k);
    if (!c) continue;
    (seen[c] = seen[c] || new Set()).add(d);
  }
}
const salesDays = new Set(days(S.sales));
for (const c of Object.keys(byCamp).sort()) {
  const covered = seen[c] ? seen[c].size : 0;
  const share = salesDays.size ? covered / salesDays.size : 0;
  const verdict = covered === 0 ? 'NO DIALLER DATA AT ALL' : share < 0.5 ? 'BELOW the 0.5 day-share law (VR16 fails)' : 'ok';
  console.log(`  ${c.padEnd(22)} dialler days ${String(covered).padStart(3)} / ${salesDays.size} sale days   ${verdict}`);
}

/* ---------- 7. unmapped dialler logins ---------- */
H('7. DIALLER LOGINS THAT MATCH NO ONE ON THE ROSTER');
const unmapped = {};
for (const d of days(S.calls)) {
  for (const [k, v] of Object.entries(S.calls[d] || {})) {
    if (resolveCamp(k)) continue;
    const o = unmapped[k] = unmapped[k] || { talk: 0, days: 0 };
    o.talk += (v.talk || 0); o.days++;
  }
}
const um = Object.entries(unmapped).sort((a, b) => b[1].talk - a[1].talk);
console.log(`  ${um.length} unmatched identities`);
for (const [k, v] of um.slice(0, 15)) console.log(`    ${k.padEnd(34)} ${(v.talk / 3600).toFixed(1)}h over ${v.days} day(s)`);
if (um.length) console.log('  Their talk time is NOT counted against any agent or campaign.');

/* ---------- 8. money sanity ---------- */
H('8. MONEY');
let n = 0, gwpEx = 0, gwpIncl = 0, canc = 0; const units = {};
for (const d of days(S.sales)) for (const v of Object.values(S.sales[d] || {})) {
  n += (v.n || 0); gwpEx += (v.x || 0); gwpIncl += (v.gwp || 0); canc += (v.canc || 0);
  units[v.u || '(unset)'] = (units[v.u || '(unset)'] || 0) + 1;
}
console.log(`  sale unit in the stored data: ` + Object.entries(units).map(([k, v]) => `${k} x${v}`).join(', '));
console.log(`  ${n.toLocaleString()} sales across ${days(S.sales).length} days`);
console.log(`  ex-VAT charge total: R${Math.round(gwpEx).toLocaleString()}  ·  stored incl: R${Math.round(gwpIncl).toLocaleString()}  ·  cancelled off those: ${canc}`);
const aug = days(S.sales).filter(d => d.startsWith('2026-08'));
let an = 0, ax = 0; for (const d of aug) for (const v of Object.values(S.sales[d])) { an += (v.n || 0); ax += (v.x || 0); }
console.log(`  August alone: ${an.toLocaleString()} sales, ex-VAT R${Math.round(ax).toLocaleString()} (GWP Achieved as the pages display it)`);
console.log(`  cancellation rows stored: ${Object.keys(S.cancRows || {}).length}`);
const cr = Object.values(S.cancRows || {});
const noCase = cr.filter(r => r.c === null).length, legacy = cr.filter(r => r.c === undefined).length;
console.log(`    of those: ${legacy} stored before Case Number was kept (fall back to account), ${noCase} genuinely caseless`);

/* ---------- 9. keys in the blob that the app does not declare ---------- */
H('9. BLOB HYGIENE');
const declared = new Set(['v', 'roster', 'gwpPerUnit', 'sales', 'calls', 'callsMeta', 'vici', 'viciDays', 'cancRows',
  'att', 'evals', 'tracker', 'board', 'orgHist', 'adjust', 'coach', 'settings', 'files', 'map',
  'opencases', 'opencasesLM', 'closedcases', 'refs', 'varRC', 'varComments', '_rev', 'ui']);
const stray = Object.keys(S).filter(k => !declared.has(k));
console.log(`  undeclared top-level keys: ${stray.length ? stray.join(', ') : 'none'}`);
for (const k of stray) console.log(`    ${k}: ${JSON.stringify(S[k]).length} bytes, ${Object.keys(S[k] || {}).length} entries`);
console.log(`  view state (ui) in the SHARED blob: ${'ui' in S ? 'YES - leaking' : 'no - correct'}`);
const big = Object.entries(S).map(([k, v]) => [k, JSON.stringify(v).length]).sort((a, b) => b[1] - a[1]).slice(0, 4);
const total = JSON.stringify(S).length;
console.log(`  blob is ${(total / 1048576).toFixed(1)} MB; biggest: ` + big.map(([k, s]) => `${k} ${(s / 1048576).toFixed(1)}MB`).join(', '));
console.log(`  the three lead stores are ${((big.filter(([k]) => /cases/.test(k)).reduce((s, [, v]) => s + v, 0)) / total * 100).toFixed(0)}% of every save`);
