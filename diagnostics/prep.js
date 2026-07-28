/* Builds .work/: hermetic test copies of the apps (local JS libs — the sandbox
   blocks cdnjs), plus the synthetic fixture CSVs for the merge and golden suites.
   Everything in .work/ is disposable and gitignored. */
const fs = require('fs');
const path = require('path');
const { ROOT, WORK } = require('./common.js');

// ---- local libraries (xlsx ships in site/; papaparse + chart.js come from npm) ----
const LIBS = path.join(WORK, 'libs');
fs.mkdirSync(LIBS, { recursive: true });
// package "exports" maps block deep require.resolve — walk from the package dir instead
const pkgDir = p => {
  const entry = require.resolve(p);                 // somewhere inside node_modules/<p>/…
  const parts = entry.split(path.sep);
  const i = parts.lastIndexOf('node_modules');
  return parts.slice(0, i + 2).join(path.sep);      // …/node_modules/<p>
};
fs.copyFileSync(path.join(ROOT, 'site', 'xlsx.full.min.js'), path.join(LIBS, 'xlsx.full.min.js'));
fs.copyFileSync(path.join(pkgDir('papaparse'), 'papaparse.min.js'), path.join(LIBS, 'papaparse.min.js'));
fs.copyFileSync(path.join(pkgDir('chart.js'), 'dist', 'chart.umd.js'), path.join(LIBS, 'chart.umd.min.js'));

// ---- localised app copies ----
function localise(srcPath, outName) {
  let h = fs.readFileSync(srcPath, 'utf8');
  h = h.replace('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js', '/libs/xlsx.full.min.js');
  h = h.replace('https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.4.1/papaparse.min.js', '/libs/papaparse.min.js');
  h = h.replace('https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js', '/libs/chart.umd.min.js');
  h = h.replace("importScripts('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js','https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.4.1/papaparse.min.js');",
    "importScripts(location.origin+'/libs/xlsx.full.min.js',location.origin+'/libs/papaparse.min.js');");
  h = h.replace('<script src="/auth-gate.js"></script>', '');
  // hanging external font links stall first paint (and rAF-based waits) offline
  h = h.replace(/<link rel="preconnect"[^>]*>\s*/g, '').replace(/<link href="https:\/\/fonts[^>]*>\s*/g, '');
  fs.writeFileSync(path.join(WORK, outName), h);
  console.log('wrote .work/' + outName, (h.length / 1024).toFixed(0) + 'KB');
}
localise(path.join(ROOT, 'Chatterbox_AgentOS_Analytics.html'), 'test_current.html');

const q = s => '"' + String(s).replace(/"/g, '""') + '"';
const w = (dir, f, H, rows) => fs.writeFileSync(path.join(dir, f), [H, ...rows].map(r => r.map(q).join(',')).join('\n'));
const pad = (n, w2) => String(n).padStart(w2, '0');

// ================= merge/perf fixtures (data/) =================
{
  const D = path.join(WORK, 'data');
  fs.mkdirSync(D, { recursive: true });
  let seed = 42;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pick = a => a[Math.floor(rnd() * a.length)];
  const N_AG = 200, TLs = Array.from({ length: 10 }, (_, i) => 'Lead ' + String.fromCharCode(65 + i));
  const agents = Array.from({ length: N_AG }, (_, i) => {
    const n = i + 1;
    return { cb: 'CB' + n, name: 'Agent' + n + ' Surname' + n, tl: TLs[i % 10],
      camp: i % 2 ? 'Matrix Cuddle' : 'Matrix Courtesy',
      tenure: ['M1', 'M2', 'EXP-Courtesy', 'EXP-Cuddle'][i % 4],
      alias: 'agent' + n + '.dial', sf: 'Agent' + n + ' Surname' + n, target: 2 + (i % 4) };
  });
  w(D, 'agent_list.csv', ['Employee Code', 'Start Date', 'Team Leader', 'Agent Name', 'Campaign', 'Tenure', 'Call x', 'Sales Force', 'Target'],
    agents.map(a => [a.cb, '01/02/2026', a.tl, a.name, a.camp, a.tenure, a.alias, a.sf, a.target]));
  const CALL_N = 40000, EXTRA_N = 2000;
  function callRow(i, day) {
    const a = agents[i % N_AG];
    const bill = Math.floor(rnd() * 500);
    const disp = bill < 25 ? pick(['No Answer', 'Voicemail', 'Busy', '']) : pick(['Interested', 'Call Back', 'Sale', 'Not Interested', '']);
    return [pad(day, 2) + '/07/2026 ' + pad(8 + (i % 9), 2) + ':' + pad(i % 60, 2) + ':' + pad((i * 7) % 60, 2), '27310000' + pad(i % 1000, 3),
      'ext' + (100 + i % 50), '2782' + pad(1000000 + i, 7), '0313000000', 'outbound', a.camp, a.alias, 'ANSWERED',
      disp, 'wrap', '00:0' + Math.min(9, Math.floor(bill / 60)) + ':' + pad(bill % 60, 2), bill, 'DBN', 'https://rec/' + i, 'ch', 'dch', 'app'];
  }
  const CALL_H = ['Date & Time', 'Caller ID', 'Source', 'Destination', 'Outbound CLI', 'Call Type', 'Campaign', 'Agent', 'Bridge', 'Lead Disposition', 'Reporting classification', 'Wrap-up', 'Duration', 'Billable Seconds', 'Branch', 'Recording link', 'Channel', 'Destination Channel', 'Application'];
  const rowsA = Array.from({ length: CALL_N }, (_, i) => callRow(i, 1 + (i % 18)));
  const csvA = [CALL_H, ...rowsA].map(r => r.map(q).join(',')).join('\n');
  fs.writeFileSync(path.join(D, 'callx_a.csv'), csvA);
  fs.writeFileSync(path.join(D, 'callx_a_renamed.csv'), csvA);
  const rowsX = Array.from({ length: EXTRA_N }, (_, i) => callRow(CALL_N + i, 21));
  fs.writeFileSync(path.join(D, 'callx_b_overlap.csv'), [CALL_H, ...rowsA, ...rowsX].map(r => r.map(q).join(',')).join('\n'));
  const QA_N = 3000, QA_UPD = 500, QA_NEW = 200;
  const QA_H = ['Record ID', 'Submitted At', 'Status', 'Offense Number', 'SLA Deadline', 'QA Close Decision', 'Date of Call', 'Week', 'Date of Assessment', 'Campaign', 'QA Agent', 'Sales Agent', 'Sales Agent CB', 'Sales Team Leader', 'Sales Agent Tenure', 'Call ID', 'Call Duration', 'Score %', 'Assessment Type', 'Escalation Decision', 'Priority', 'Coaching Category', 'Coaching Sub-Category', 'Critical Fail Category', 'Critical Fail Sub-Category', 'Evaluation Reference', 'Client Callback Required', 'Recommendation', 'QA Agent Feedback', 'TL Stage 1 Notes', 'TL Stage 2 Notes', 'SM Escalation Reason', 'GHL Opportunity ID', 'GHL Stage ID', 'GHL Stage Name'];
  function qaRow(i, status, esc2) {
    const a = agents[i % N_AG];
    const score = 60 + Math.floor(rnd() * 40);
    return ['E' + pad(i + 1, 5), pad(1 + (i % 18), 2) + '/07/2026', status, i % 7 === 0 ? 1 + (i % 3) : '', '', 'ok',
      pad(1 + (i % 18), 2) + '/07/2026', 'W' + (1 + i % 4), pad(2 + (i % 18), 2) + '/07/2026', a.camp, 'QA Person' + (i % 5),
      a.name, a.cb, a.tl, a.tenure, 'CALL' + i, '00:04:0' + (i % 10), score, i % 3 === 0 ? 'Sale' : 'Service',
      esc2 || (score < 70 ? 'Critical Fail' : score < 82 ? 'Coaching' : 'Pass'), 'P2', 'Cat', 'Sub', '', '', 'REF' + i, 'No', '', '', '', '', '', '', '', ''];
  }
  seed = 99;
  const qaA = Array.from({ length: QA_N }, (_, i) => qaRow(i, 'closed_mitigated'));
  w(D, 'qa_a.csv', QA_H, qaA);
  seed = 99;
  const upd = Array.from({ length: QA_N }, (_, i) => qaRow(i, 'closed_mitigated')).slice(0, QA_UPD)
    .map(r => { r[2] = 'closed_retracted'; r[19] = 'Pass'; return r; });
  const freshQ = Array.from({ length: QA_NEW }, (_, i) => qaRow(QA_N + i, 'closed_mitigated'));
  w(D, 'qa_b_updates.csv', QA_H, [...upd, ...freshQ]);
  const BI_H = ['Account Number', 'Contract Status', 'Account Name', 'Owner', 'Consultant', 'Contract Create Date', 'Contract Number', 'Case Number', 'Product Bundle', 'Merged Product Bundle', 'Charge Code', 'Charge Amount', 'Sales Vertical'];
  function biRow(i, mon, day) {
    const a = agents[i % N_AG];
    return ['ACC' + mon + '-' + pad(i, 5), 'Active', 'Client ' + i, a.sf, 'Cons', pad(day, 2) + '/' + pad(mon, 2) + '/2026',
      'CTR' + i, 'CASE' + i, pick(['Bundle A', 'Bundle B', 'Bundle C']), 'Merged', 'CHG' + (i % 4), (30 + rnd() * 60).toFixed(2), 'VAS'];
  }
  seed = 7;
  const jul = Array.from({ length: 3000 }, (_, i) => biRow(i, 7, 1 + (i % 25)));
  w(D, 'bi_jul.csv', BI_H, jul); w(D, 'bi_jul_renamed.csv', BI_H, jul);
  seed = 7;
  const jul2 = Array.from({ length: 3000 }, (_, i) => biRow(i, 7, 1 + (i % 25)));
  const aug = Array.from({ length: 1500 }, (_, i) => biRow(i, 8, 1 + (i % 25)));
  w(D, 'bi_julaug.csv', BI_H, [...jul2, ...aug]);
  const AT_H = ['Date', 'Employee Code', 'Employee Name', 'Title', 'Employee Type', 'Department', 'Reports To', 'Status Code', 'Status'];
  const att = [];
  agents.forEach(a => { for (let d = 1; d <= 15; d++) att.push([pad(d, 2) + '/07/2026', a.cb, a.name, 'Agent', 'Perm', 'Sales', a.tl, d % 9 === 0 ? 'AL' : 'P', d % 9 === 0 ? 'AL' : 'Present']); });
  w(D, 'att_jul.csv', AT_H, att);
  const att2 = att.map((r, i) => { if (i < 500) { const c = r.slice(); c[7] = 'UCA'; c[8] = 'UCA'; return c; } return r.slice(); });
  w(D, 'att_jul_corrected.csv', AT_H, att2);
}

// ================= Ops golden fixtures (gdata/) =================
{
  const D = path.join(WORK, 'gdata');
  fs.mkdirSync(D, { recursive: true });
  const AG = [
    ['CB1', 'Anna One', 'Lead A', 'Matrix Courtesy', 'M1', 'a1.dial', 'Anna One', 2],
    ['CB2', 'Ben Two', 'Lead A', 'Matrix Courtesy', 'M1', 'a2.dial', 'Ben Two', 2],
    ['CB3', 'Cara Three', 'Lead B', 'Matrix Courtesy', 'M1', 'a3.dial', 'Cara Three', 3],
    ['CB4', 'Dan Four', 'Lead B', 'Matrix Cuddle', 'EXP', 'a4.dial', 'Dan Four', 1],
    ['CB5', 'Eve Five', 'Lead B', 'Matrix Cuddle', 'EXP', 'a5.dial', 'Eve Five', 1],
    ['CB6', 'Fay Six', 'Lead A', 'Matrix Courtesy', 'M1', 'a6.dial', 'Fay Six', 2],
    ['CB7', 'Gil Seven', 'Lead A', 'Matrix Courtesy', 'M1', 'a7.dial', 'Gil Seven', 2],
  ];
  w(D, 'g_agent_list.csv', ['Employee Code', 'Start Date', 'Team Leader', 'Agent Name', 'Campaign', 'Tenure', 'Call x', 'Sales Force', 'Target'],
    AG.map(a => [a[0], '01/02/2026', a[2], a[1], a[3], a[4], a[5], a[6], a[7]]));
  const att = [];
  const at = (cb, name, tl, d, code) => att.push(['0' + d + '/07/2026', cb, name, 'Agent', 'Perm', 'Sales', tl, code, code]);
  ['CB1', 'CB2', 'CB3'].forEach((cb, i) => [6, 7, 8].forEach(d => at(cb, AG[i][1], AG[i][2], d, 'P')));
  at('CB4', 'Dan Four', 'Lead B', 6, 'P');
  at('CB5', 'Eve Five', 'Lead B', 6, 'P'); at('CB5', 'Eve Five', 'Lead B', 7, 'P'); at('CB5', 'Eve Five', 'Lead B', 8, 'AL');
  [6, 7, 8].forEach(d => at('CB6', 'Fay Six', 'Lead A', d, 'UCA'));
  at('CB7', 'Gil Seven', 'Lead A', 6, 'P'); at('CB7', 'Gil Seven', 'Lead A', 7, 'P'); at('CB7', 'Gil Seven', 'Lead A', 8, 'UCA');
  at('CB9', 'Zed Nine', 'Lead A', 6, 'Terminated');
  w(D, 'g_attendance.csv', ['Date', 'Employee Code', 'Employee Name', 'Title', 'Employee Type', 'Department', 'Reports To', 'Status Code', 'Status'], att);
  const CH = ['Date & Time', 'Caller ID', 'Source', 'Destination', 'Outbound CLI', 'Call Type', 'Campaign', 'Agent', 'Bridge', 'Lead Disposition', 'Reporting classification', 'Wrap-up', 'Duration', 'Billable Seconds', 'Branch', 'Recording link', 'Channel', 'Destination Channel', 'Application'];
  let cx = 0;
  const call = (alias, bill, disp, type, dest) => ['07/07/2026 ' + (9 + cx) + ':00:0' + (cx++ % 10), 'cid' + cx, 'ext' + cx, dest || ('27820000' + cx), '031', type || 'outbound', 'Matrix Courtesy', alias, 'ANSWERED', disp, '', '', '00:0' + Math.min(9, Math.floor(bill / 60)) + ':' + String(bill % 60).padStart(2, '0'), bill, 'DBN', '', '', '', ''];
  const calls = [
    call('a1.dial', 400, 'Sale'), call('a1.dial', 200, 'Interested'), call('a1.dial', 100, ''), call('a1.dial', 10, 'No Answer'),
    call('a2.dial', 400, 'Interested'), call('a2.dial', 50, 'Engaged'),
    call('a4.dial', 9000, 'Interested'), call('a5.dial', 400, 'Interested'), call('a7.dial', 30, ''),
    call('', 20, '', 'inbound', 's'),
  ];
  calls.push(['not-a-date', 'x', 'x', 'x', '031', 'outbound', 'Matrix Courtesy', 'a1.dial', '', '', '', '', '00:01:00', 60, 'DBN', '', '', '', '']);
  w(D, 'g_callx.csv', CH, calls);
  const QH = ['Record ID', 'Submitted At', 'Status', 'Offense Number', 'SLA Deadline', 'QA Close Decision', 'Date of Call', 'Week', 'Date of Assessment', 'Campaign', 'QA Agent', 'Sales Agent', 'Sales Agent CB', 'Sales Team Leader', 'Sales Agent Tenure', 'Call ID', 'Call Duration', 'Score %', 'Assessment Type', 'Escalation Decision', 'Priority', 'Coaching Category', 'Coaching Sub-Category', 'Critical Fail Category', 'Critical Fail Sub-Category', 'Evaluation Reference', 'Client Callback Required', 'Recommendation', 'QA Agent Feedback', 'TL Stage 1 Notes', 'TL Stage 2 Notes', 'SM Escalation Reason', 'GHL Opportunity ID', 'GHL Stage ID', 'GHL Stage Name'];
  let qn = 0;
  const qa = (cbIdx, score, dec, assess, status, off) => {
    const a = AG[cbIdx];
    return ['G' + (++qn), '07/07/2026', status || 'closed_mitigated', off || '', '', 'ok', '07/07/2026', 'W28', '08/07/2026', a[3], 'QA1', a[1], a[0], a[2], a[4], 'K' + qn, '00:04:00', score, assess || 'Service', dec, 'P2', '', '', '', '', 'R' + qn, 'No', '', '', '', '', '', '', '', ''];
  };
  w(D, 'g_qa.csv', QH, [
    qa(0, 90, 'Pass', 'Sale'), qa(0, 80, 'Coaching'), qa(1, 95, 'Pass'),
    qa(2, 90, 'Pass'), qa(2, 70, 'Critical Fail', 'Sale', 'qa_review', 1), qa(2, 85, 'Pass'),
    qa(3, 92, 'Pass'), qa(4, 96, 'Pass'), qa(6, 82, 'Pass'), qa(6, 88, 'Pass'),
  ]);
  const BH = ['Account Number', 'Contract Status', 'Account Name', 'Owner', 'Consultant', 'Contract Create Date', 'Contract Number', 'Case Number', 'Product Bundle', 'Merged Product Bundle', 'Charge Code', 'Charge Amount', 'Sales Vertical'];
  const bi = (acc, owner, amt) => [acc, 'Active', 'Client ' + acc, owner, 'Cons', '07/07/2026', 'CT' + acc, 'CS' + acc, 'Bundle A', 'M', 'CHG', amt, 'VAS'];
  w(D, 'g_bi.csv', BH, [
    bi('ACC1', 'Anna One', '30.43'), bi('ACC1', 'Anna One', '33.91'), bi('ACC1', 'Anna One', '21.74'),
    bi('ACC2', 'Anna One', '100'), bi('ACC3', 'Ben Two', '60'), bi('ACC4', 'Dan Four', '200'),
    bi('ACC5', 'Eve Five', '10'), bi('ACC6', 'Ghost Person', '50'), bi('ACC7', 'Cara Three', '120'),
    ['Applied filters: period = July', '', '', '', '', '', '', '', '', '', '', '', ''],
  ]);
  const OH = ['Case ID', 'Case Number', 'Subject', 'Date/Time Opened', 'Age (Hours)', 'Open', 'Account Name', 'Account Number', 'Account Mobile from Person Account', 'Person Account: Email', 'Case Record Type', 'Case Owner', 'Status'];
  w(D, 'g_open.csv', OH, [
    ['I1', 'CASE-A', 's', '06/07/2026 09:00', '10', '1', 'x', 'AN1', '', '', 'VAS', 'Anna One', '3rd Attempt'],
    ['I2', 'CASE-B', 's', '06/07/2026 09:10', '20', '1', 'x', 'AN2', '', '', 'VAS', 'Anna One', '2nd Attempt'],
    ['I3', 'CASE-C', 's', '06/07/2026 09:20', '30', '1', 'x', 'AN3', '', '', 'VAS', 'Ben Two', '1st Attempt'],
  ]);
  const CLH = ['Case ID', 'Case Number', 'Subject', 'Date/Time Opened', 'Date/Time Closed', 'Closed', 'Disposition', 'Age (Hours)', 'Account Name', 'Account Number', 'Account Mobile from Person Account', 'Person Account: Email', 'Case Record Type', 'Case Owner', 'Status'];
  w(D, 'g_closed.csv', CLH, [
    ['I2', 'CASE-B', 's', '06/07/2026 09:10', '07/07/2026 10:00', '1', 'Took product', '25', 'x', 'AN2', '', '', 'VAS', 'Anna One', 'Closed'],
    ['I4', 'CASE-D', 's', '06/07/2026 10:00', '07/07/2026 11:00', '1', 'Took product', '25', 'x', 'AN4', '', '', 'VAS', 'Anna One', 'Closed'],
    ['I5', 'CASE-E', 's', '06/07/2026 10:30', '07/07/2026 12:00', '1', 'No contact', '26', 'x', 'AN5', '', '', 'VAS', 'Ben Two', 'Closed - No feedback'],
    ['I6', 'CASE-F', 's', '06/07/2026 10:40', '07/07/2026 13:00', '1', 'Took product', '27', 'x', 'AN6', '', '', 'VAS', 'Cara Three', 'Closed'],
  ]);
  const IH = ['Account Number', 'Contract Status', 'Account Name', 'Owner', 'Consultant', 'Contract Deactivate Date', 'Contract Create Date', 'Product Bundle', 'Merged Product Bundle', 'Case Number', 'Charge Amount', 'Marketing Type'];
  w(D, 'g_inactive.csv', IH, [['ACC3', 'Inactive', 'Client ACC3', 'Ben Two', 'Cons', '20/07/2026', '07/07/2026', 'Bundle A', 'M', 'CS-X', '60', 'VAS']]);
}
console.log('prep complete →', WORK);

/* Real-format fixtures: Salesforce HTML .xls (title row + Grand Totals footer +
   comma decimals + " - Team" owner suffixes) and a genuine .xlsx BI workbook —
   the CSV fixtures never exercised these paths, and a title row used to kill
   the upload (header hunt now fixed in readUpload). */
(function () {
  const XLSX = require(path.join(WORK, 'libs', 'xlsx.full.min.js'));
  const mk = (headers, rows, foot) => '<html><body><table>'
    + '<tr><td colspan="' + headers.length + '">Report: Cases</td></tr>'
    + '<tr>' + headers.map(h => '<td>' + h + '</td>').join('') + '</tr>'
    + rows.map(r => '<tr>' + r.map(c => '<td>' + c + '</td>').join('') + '</tr>').join('')
    + (foot ? '<tr><td>Grand Totals (' + rows.length + ' records)</td></tr>' : '') + '</table></body></html>';
  const OH = ['Case ID', 'Case Number', 'Subject', 'Date/Time Opened', 'Age (Hours)', 'Open', 'Account Name', 'Account Number', 'Account Mobile from Person Account', 'Person Account: Email', 'Case Record Type', 'Case Owner', 'Status'];
  fs.writeFileSync(path.join(WORK, 'gdata', 'real_open.xls'), mk(OH, [
    ['I1', 'RCASE-1', 's', '06/07/2026 09:00', '10,5', '1', 'x', 'RA1', '', '', 'VAS', 'Anna One - Durban', '3rd Attempt'],
    ['I2', 'RCASE-2', 's', '06/07/2026 09:10', '20', '1', 'x', 'RA2', '', '', 'VAS', 'Ben Two - Durban', '2nd Attempt'],
    ['I3', 'RCASE-3', 's', '07/07/2026 08:00', '30', '1', 'x', 'RA3', '', '', 'VAS', 'Cara Three', 'New']], true));
  const CH = ['Case ID', 'Case Number', 'Subject', 'Date/Time Opened', 'Date/Time Closed', 'Closed', 'Disposition', 'Age (Hours)', 'Account Name', 'Account Number', 'Account Mobile from Person Account', 'Person Account: Email', 'Case Record Type', 'Case Owner', 'Status'];
  fs.writeFileSync(path.join(WORK, 'gdata', 'real_closed.xls'), mk(CH, [
    ['C1', 'RCASE-9', 's', '06/07/2026 09:10', '07/07/2026 10:00', '1', 'Took product', '25,0', 'x', 'RB1', '', '', 'VAS', 'Anna One - Durban', 'Closed'],
    ['C2', 'RCASE-8', 's', '06/07/2026 10:00', '07/07/2026 11:00', '1', 'Not interested', '25', 'x', 'RB2', '', '', 'VAS', 'Ben Two', 'Closed - No feedback']], true));
  const rows = [['Account Number', 'Contract Status', 'Account Name', 'Owner', 'Consultant', 'Contract Create Date', 'Contract Number', 'Case Number', 'Product Bundle', 'Merged Product Bundle', 'Charge Code', 'Charge Amount', 'Sales Vertical'],
    ['RACC1', 'Active', 'Client 1', 'Anna One', 'C', '07/07/2026', 'CT1', 'CS1', 'Bundle A', 'M', 'CHG', '30.43', 'VAS'],
    ['RACC1', 'Active', 'Client 1', 'Anna One', 'C', '07/07/2026', 'CT1', 'CS1', 'Bundle A', 'M', 'CHG', '33.91', 'VAS'],
    ['RACC2', 'Active', 'Client 2', 'Ben Two', 'C', '08/07/2026', 'CT2', 'CS2', 'Bundle B', 'M', 'CHG', '55.00', 'VAS'],
    ['RACC3', 'Active', 'Client 3', 'Zed Unknown', 'C', '08/07/2026', 'CT3', 'CS3', 'Bundle B', 'M', 'CHG', '70.00', 'VAS']];
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Export');
  fs.writeFileSync(path.join(WORK, 'gdata', 'real_bi.xlsx'), Buffer.from(XLSX.write(wb, { type: 'array', bookType: 'xlsx' })));
  console.log('real-format fixtures: real_open.xls, real_closed.xls, real_bi.xlsx');
})();
