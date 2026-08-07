/* Cell-level reconciliation: every agent, every column, every MTD/WTD tab.
 *
 *   node nicks_code/diagnostics/august-mtd-cells.mjs <august-tracker.xlsx>
 *
 * Feeds the workbook's daily sheet through the app and compares each agent row in
 * MTD - Cuddle / MTD - Courtesy / WTD - * against the app's model, column by column.
 *
 * Cancellations and QA are NOT checked here: neither is carried on the daily sheet
 * (cancellations are an Adjustments input, QA comes from the evaluations export), so
 * they cannot be derived from the input this harness supplies. Everything else must tie.
 */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';

const XLSX_PATH = process.argv[2];
if (!XLSX_PATH) { console.error('usage: august-mtd-cells.mjs <august-tracker.xlsx>'); process.exit(2); }

const PY = String.raw`
import openpyxl, json, sys, datetime, re
wb = openpyxl.load_workbook(sys.argv[1], data_only=True)

def dur(v):
    if v is None: return '0:00:00'
    if isinstance(v, datetime.time): return f'{v.hour}:{v.minute:02d}:{v.second:02d}'
    if isinstance(v, datetime.timedelta):
        s=int(v.total_seconds()); return f'{s//3600}:{(s%3600)//60:02d}:{s%60:02d}'
    m=re.match(r'^(\d+):(\d\d):(\d\d)', str(v))
    return f'{int(m.group(1))}:{m.group(2)}:{m.group(3)}' if m else '0:00:00'

def secs(v):
    if v is None: return 0
    if isinstance(v, datetime.time): return v.hour*3600+v.minute*60+v.second
    if isinstance(v, datetime.timedelta): return int(v.total_seconds())
    m=re.match(r'^(\d+):(\d\d):(\d\d)', str(v))
    return int(m.group(1))*3600+int(m.group(2))*60+int(m.group(3)) if m else 0

# ---- daily sheet -> CSV the app ingests, plus a name->code map
ws = wb['August']
hdr = [h for h in next(ws.iter_rows(min_row=1, max_row=1, values_only=True))]
ix = {h: i for i, h in enumerate(hdr) if h}
cols = ['Week','Date','Team Leader','Campaign','Agent','Emp Code','Tenure','Employed Shifts',
        'Actual Shifts','Sales Target','Sales Achieved','Talk Time','GWP Target','GWP Achieved','Referrals']
out=[','.join(cols)]; name2code={}
for r in ws.iter_rows(min_row=2, values_only=True):
    if not r[ix['Date']]: continue
    name2code[str(r[ix['Agent']]).strip()] = str(r[ix['Emp Code']]).strip().upper().replace('-','')
    row=[]
    for c in cols:
        v=r[ix[c]]
        v = dur(v) if c=='Talk Time' else ('' if v is None else str(v))
        row.append('"'+v.replace('"','""')+'"')
    out.append(','.join(row))

# ---- MTD/WTD agent rows. Header row is the one containing 'Team Leader'.
def grab(sheet):
    if sheet not in wb.sheetnames: return None
    w = wb[sheet]; head=None; rows=[]
    for r in w.iter_rows(values_only=True):
        cells=[('' if c is None else c) for c in r]
        labs=[str(c).strip() for c in cells]
        if head is None:
            if 'Team Leader' in labs: head={str(c).strip():i for i,c in enumerate(cells) if str(c).strip()}
            continue
        agent=str(cells[head['Agent']]).strip() if 'Agent' in head else ''
        tl=str(cells[head['Team Leader']]).strip()
        if not agent and tl!='Grand Total': continue
        g=lambda k: cells[head[k]] if k in head and head[k]<len(cells) else None
        rows.append(dict(agent=agent, grand=(tl=='Grand Total'),
            emp=g('Employed Shifts'), act=g('Actual Shifts'), att=g('Att %'),
            target=g('Sales Target'), sales=g('Sales Achieved'), pctT=g('% of Sales Target'),
            spd=g('SPD'), aveTalk=secs(g('Ave Talk Time')),
            gwpT=g('GWP Target'), gwp=g('GWP Achieved'), pctG=g('% To GWP Target'),
            aveG=g('Ave GWP'), ref=g('Referrals'), refPct=g('% Of Referrals To Sales Achieved'),
            canc=g('Cancellations'), qa=(None if str(g('QA')).strip() in ('No QA %','None','') else g('QA'))))
    return rows

sheets={}; stale={}
def grand(rows):
    for r in rows:
        if r['grand']: return r
    return None
mtd={s:grab(s) for s in ['MTD - Cuddle','MTD - Courtesy']}
for s,rows in mtd.items():
    if rows: sheets[s]=rows
# A WTD tab cannot exceed the MTD tab that contains it. When it does, that tab is a
# stale leftover from an earlier refresh and must not be reconciled against.
for s in ['WTD - Cuddle','WTD - Courtesy']:
    rows=grab(s)
    if not rows: continue
    ref=mtd.get(s.replace('WTD','MTD'))
    gw, gm = grand(rows), grand(ref) if ref else None
    if gw and gm and float(gw['sales'] or 0) > float(gm['sales'] or 0):
        stale[s]={'wtdSales':gw['sales'],'mtdSales':gm['sales'],'wtdEmp':gw['emp'],'mtdEmp':gm['emp']}
    else:
        sheets[s]=rows
json.dump({'csv':'\n'.join(out),'name2code':name2code,'sheets':sheets,'stale':stale}, sys.stdout, default=str)
`;

const { csv, name2code, sheets, stale } = JSON.parse(
  execFileSync('python3', ['-c', PY, XLSX_PATH], { maxBuffer: 64 * 1024 * 1024 }).toString());

const APP = process.env.APP_HTML
  ? 'file://' + process.env.APP_HTML
  : 'file://' + new URL('../index.html', import.meta.url).pathname;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  .catch(() => chromium.launch());
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));
await page.goto(APP);

// LIVE_DIR=<uploads dir> reconciles the REAL production pipeline (Agent List, BI
// Active, BI Inactive, CallX, Vici, attendance, evaluations) against the workbook,
// instead of feeding the workbook's own daily sheet back through the app.
const LIVE = process.env.LIVE_DIR;
if (LIVE) {
  await page.addScriptTag({ path: new URL('../../site/xlsx.full.min.js', import.meta.url).pathname });
  await page.waitForFunction(() => typeof XLSX !== 'undefined');
  const fsx = await import('node:fs'); const pth = await import('node:path');
  const pick = re => { const f = fsx.readdirSync(LIVE).find(n => re.test(n));
    if (!f) throw new Error('LIVE_DIR has no file matching ' + re); return pth.join(LIVE, f); };
  for (const [re, isCsv] of [
    [/Matrix__Agent_List.*\.xlsx$/i, false], [/BI_Active.*\.xlsx$/i, false],
    [/BI_Inactive.*\.xlsx$/i, false], [/Call_X.*\.xlsx$/i, false],
    [/attendance_\d+_to_\d+\.csv$/i, true], [/evaluationsfullexport.*\.csv$/i, true],
    [/Vici.*\.csv$/i, true],
  ]) {
    const f = pick(re); const base = pth.basename(f);
    if (isCsv) await page.evaluate(([n, t]) => window.__mtd.ingest(n, t), [base, fsx.readFileSync(f, 'utf8')]);
    else {
      const b64 = fsx.readFileSync(f).toString('base64');
      await page.evaluate(async ([n, d]) => { const bin = atob(d); const u = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
        return window.__mtd.ingest(n, await window.__mtd.bufferToText(n, u.buffer)); }, [base, b64]);
    }
  }
  await page.evaluate(([f, t]) => window.__mtd.setRange(f, t),
    [process.env.LIVE_FROM || '2026-08-01', process.env.LIVE_TO || '2026-08-04']);
} else {
  await page.evaluate(t => window.__mtd.ingest('VAS_August_Tracker.csv', t), csv);
  await page.evaluate(() => window.__mtd.setRange('2026-08-01', '2026-08-31'));
}

const model = await page.evaluate(() => {
  const m = window.__mtd.model();
  const pick = o => ({ emp:o.emp, act:o.act, att:o.att, target:o.target, sales:o.sales,
    pctT:o.pctT, spd:o.spd, aveTalk:o.aveTalk, gwpT:o.gwpT, gwp:o.gwp, pctG:o.pctG,
    aveG:o.aveG, ref:o.ref, refPct:o.refPct, canc:o.canc, qa:o.qa?o.qa.avg:null });
  const out = { mtd:{}, wtd:{}, weeks:m.weeks.map(w=>w.num) };
  for (const c of ['Cuddle','Courtesy']) {
    out.mtd[c] = Object.fromEntries(Object.entries(m.mtdCC[c]||{}).map(([k,v])=>[k,pick(v)]));
    out.wtd[c] = {};
    for (const w of m.weeks) {
      const src = (m.wtdCC[w.num]||{})[c]||{};
      for (const [k,v] of Object.entries(src)) out.wtd[c][k] = pick(v);   // single week in range
    }
  }
  return out;
});
await browser.close();

// --- compare ----------------------------------------------------------------
// Referrals are 0 by design: there is no referral source file, so the software cannot
// and should not reproduce the workbook's manually-typed figure. Reported, never failed.
let FIELDS = ['emp','act','att','target','sales','pctT','spd','aveTalk','gwpT','gwp','pctG','aveG'];
const INFO = ['ref','refPct'];
// With the real sources loaded, cancellations and QA become derivable too.
if (process.env.LIVE_DIR) FIELDS = FIELDS.concat(['canc','qa']);
const TOL = { att:5e-3, pctT:5e-3, spd:5e-3, pctG:5e-3, aveG:5e-3, refPct:5e-3, aveTalk:1.5, gwp:0.5, qa:5e-3, default:1e-6 };
const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };

let checked = 0; const fails = []; const missing = []; let refWorkbook = 0, refModel = 0;
for (const [sheetName, rows] of Object.entries(sheets)) {
  const camp = sheetName.includes('Cuddle') ? 'Cuddle' : 'Courtesy';
  const bucket = sheetName.startsWith('MTD') ? model.mtd[camp] : model.wtd[camp];
  for (const row of rows) {
    if (row.grand) continue;                       // grand totals covered by august-reconcile
    const code = name2code[row.agent];
    if (!code) { missing.push(`${sheetName}: "${row.agent}" not on the daily sheet`); continue; }
    const got = bucket[code];
    if (!got) { missing.push(`${sheetName}: ${code} ${row.agent} absent from model`); continue; }
    for (const f of FIELDS) {
      const want = num(row[f]), have = num(got[f]);
      const tol = TOL[f] ?? TOL.default;
      checked++;
      if (Math.abs(want - have) > tol)
        fails.push(`${sheetName} · ${row.agent} · ${f}: workbook ${want} vs model ${have}`);
    }
    refWorkbook += num(row.ref); refModel += num(got.ref);   // reported, not failed
  }
}

console.log(`\n  sheets reconciled: ${Object.keys(sheets).join(', ')}`);
for (const [s, d] of Object.entries(stale || {}))
  console.log(`  SKIPPED (stale in the workbook): ${s} — ${d.wtdSales} sales / ${d.wtdEmp} employed shifts ` +
              `exceeds its own ${s.replace('WTD','MTD')} (${d.mtdSales} / ${d.mtdEmp})`);
console.log(`  cells checked: ${checked} (${FIELDS.length} columns/agent; ${INFO.join('+')} reported only)`);
console.log(`  referrals: workbook ${refWorkbook}, model ${refModel} — 0 expected, no source file\n`);
if (missing.length) { console.log('  ROW MISMATCHES:'); missing.forEach(m => console.log('   ' + m)); console.log(); }
console.log(`  august-mtd-cells: ${checked - fails.length} passed, ${fails.length} failed, ${missing.length} row problems`);
for (const f of fails.slice(0, Number(process.env.MAXFAIL||40))) console.log('   FAIL  ' + f);
if (fails.length > Number(process.env.MAXFAIL||40)) console.log(`   … and ${fails.length - Number(process.env.MAXFAIL||40)} more`);
if (pageErrors.length) console.log('  PAGE ERRORS: ' + pageErrors.join(' | '));
process.exit(fails.length || missing.length || pageErrors.length ? 1 : 0);
