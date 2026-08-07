/* End-to-end reconciliation: feed the REAL August tracker workbook's daily sheet
 * into the app and assert the model reproduces the workbook's own MTD tabs.
 *
 *   node nicks_code/diagnostics/august-reconcile.mjs <august-tracker.xlsx>
 *
 * The daily sheet is the workbook's base of truth (it ties to MTD - Cuddle and
 * MTD - Courtesy to the cent); TL MTD and Team Split in that same file are stale.
 */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const XLSX_PATH = process.argv[2];
if (!XLSX_PATH) { console.error('usage: august-reconcile.mjs <august-tracker.xlsx>'); process.exit(2); }

// --- pull the daily sheet + the MTD grand totals out of the workbook ---------
const PY = `
import openpyxl, json, sys, datetime, re
wb = openpyxl.load_workbook(sys.argv[1], data_only=True)
def dur(v):
    if v is None: return '0:00:00'
    if isinstance(v, datetime.time): return f'{v.hour}:{v.minute:02d}:{v.second:02d}'
    if isinstance(v, datetime.timedelta):
        s=int(v.total_seconds()); return f'{s//3600}:{(s%3600)//60:02d}:{s%60:02d}'
    m=re.match(r'^(\\d+):(\\d\\d):(\\d\\d)', str(v))
    return f'{int(m.group(1))}:{m.group(2)}:{m.group(3)}' if m else '0:00:00'
ws = wb['August']
hdr = [h for h in next(ws.iter_rows(min_row=1, max_row=1, values_only=True))]
ix = {h: i for i, h in enumerate(hdr) if h}
cols = ['Week','Date','Team Leader','Campaign','Agent','Emp Code','Tenure','Employed Shifts',
        'Actual Shifts','Sales Target','Sales Achieved','Talk Time','GWP Target','GWP Achieved','Referrals']
out = [','.join(cols)]
for r in ws.iter_rows(min_row=2, values_only=True):
    if not r[ix['Date']]: continue
    row=[]
    for c in cols:
        v = r[ix[c]]
        v = dur(v) if c == 'Talk Time' else ('' if v is None else str(v))
        row.append('"' + v.replace('"','""') + '"')
    out.append(','.join(row))
tot = {}
for sh, key in [('MTD - Cuddle','Cuddle'), ('MTD - Courtesy','Courtesy')]:
    for row in wb[sh].iter_rows(values_only=True):
        if row and str(row[1]).strip() == 'Grand Total':
            tot[key] = dict(emp=row[4], act=row[5], target=row[7], sales=row[8],
                            gwpT=row[14], gwp=row[15], ref=row[18])
json.dump({'csv': '\\n'.join(out), 'totals': tot}, sys.stdout)
`;
const { csv, totals } = JSON.parse(execFileSync('python3', ['-c', PY, XLSX_PATH], {
  maxBuffer: 64 * 1024 * 1024,
}).toString());

// --- drive the app ----------------------------------------------------------
const APP = process.env.APP_HTML
  ? 'file://' + process.env.APP_HTML
  : 'file://' + new URL('../index.html', import.meta.url).pathname;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  .catch(() => chromium.launch());
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));
await page.goto(APP);
await page.evaluate(t => window.__mtd.ingest('VAS_August_Tracker.csv', t), csv);
await page.evaluate(() => window.__mtd.setRange('2026-08-01', '2026-08-31'));

const got = await page.evaluate(() => {
  const m = window.__mtd.model();
  const roll = c => {
    const rows = Object.values(m.mtdCC[c] || {});
    const s = (k) => rows.reduce((a, r) => a + (r[k] || 0), 0);
    return { n: rows.length, emp: s('emp'), act: s('act'), target: s('target'),
             sales: s('sales'), gwpT: s('gwpT'), gwp: s('gwp'), ref: s('ref') };
  };
  return { dates: m.dates, dropped: m.droppedDates,
           Cuddle: roll('Cuddle'), Courtesy: roll('Courtesy'), Nesting: roll('Nesting'),
           grand: { sales: m.grand.sales, gwp: m.grand.gwp, emp: m.grand.emp, act: m.grand.act } };
});
await browser.close();

// --- compare ----------------------------------------------------------------
let pass = 0; const fails = [];
const near = (a, b) => Math.abs((a || 0) - (b || 0)) < 0.005;
const check = (n, c, d) => c ? pass++ : fails.push(`${n} — ${d}`);

console.log(`\n  dialing days: ${got.dates.join(', ')}`);
console.log(`  dropped     : ${(got.dropped || []).join(', ') || '(none)'}\n`);

for (const camp of ['Cuddle', 'Courtesy']) {
  const want = totals[camp], have = got[camp];
  for (const k of ['emp', 'act', 'target', 'sales', 'gwpT', 'gwp', 'ref'])
    check(`${camp}.${k}`, near(have[k], want[k]), `workbook ${want[k]} vs model ${have[k]}`);
}
// Nesting must exist separately and stay out of the VAS grand total.
check('Nesting is broken out', got.Nesting.n > 0, `no Nesting agents in the model`);
check('grand = Cuddle + Courtesy only',
  near(got.grand.sales, (totals.Cuddle.sales || 0) + (totals.Courtesy.sales || 0)),
  `grand ${got.grand.sales} vs ${(totals.Cuddle.sales || 0) + (totals.Courtesy.sales || 0)} ` +
  `(Nesting ${got.Nesting.sales} must be excluded)`);
check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));

console.log(`  august-reconcile: ${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log('   FAIL  ' + f);
process.exit(fails.length ? 1 : 0);
