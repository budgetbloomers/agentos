// Trace one agent day by day through the model, in both the calendar-month window and the
// window the hand-built workbook actually covers.  node probe-agent.mjs "Cohen Govender"
import { chromium } from 'playwright';
import fs from 'node:fs'; import path from 'node:path'; import http from 'node:http';
const WHO = process.argv[2] || 'Cohen Govender';
const REPO = String.raw`c:\Users\aarav\OneDrive\Desktop\Chatterbox Agent OS\agentos`;
const UP = path.join(REPO, 'uploads', '2026-08-06');
const SERVE = { '/': path.join(REPO, 'nicks_code', 'index.html'), '/index.html': path.join(REPO, 'nicks_code', 'index.html'),
  '/xlsx.full.min.js': path.join(REPO, 'site', 'xlsx.full.min.js') };
const server = http.createServer((q, s) => { const p = SERVE[q.url.split('?')[0]];
  if (!p || !fs.existsSync(p)) { s.writeHead(404); s.end('nf'); return }
  s.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' }); fs.createReadStream(p).pipe(s) });
await new Promise(r => server.listen(8137, '127.0.0.1', r));
const j = (...p) => path.join(...p);
const browser = await chromium.launch({ args: ['--js-flags=--max-old-space-size=8192'] });
const page = await browser.newPage();
await page.goto('http://127.0.0.1:8137/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__mtd && window.__mtd.state(), null, { timeout: 30000 });
await page.setInputFiles('#fileInput', ['Matrix - Agent List.xlsx', 'attendance_2026-08-01_to_2026-08-06.csv',
  'BI Active - 05.08.xlsx', 'BI Inactive - 05.08.xlsx', 'Call X Call report - 3 - 5.xlsx',
  'Vici - Cuddle Agents - 3 - 5 Aug.csv', 'evaluations-full-export-2026-08-06.csv'].map(f => j(UP, f)), { timeout: 60000 });
await page.waitForFunction(() => (window.__mtd.state().files || []).length >= 6, null, { timeout: 600000 });
await page.waitForTimeout(5000);

const dur = s => { s = Math.round(s); return `${Math.floor(s/3600)}:${String(Math.floor(s/60)%60).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`; };
async function look(label, from, to) {
  const r = await page.evaluate(([w, f, t]) => {
    const S = window.__mtd.state();
    if (f) { S.ui.preset = 'custom'; S.ui.from = f; S.ui.to = t; } else { S.ui.preset = 'month'; S.ui.month = '2026-08'; }
    rebuild(); renderAll();
    const M = window.__mtd.model();
    const norm = s => String(s||'').toLowerCase().replace(/[^a-z]/g,'');
    const code = (S.roster.find(a => norm(a.name) === norm(w)) || {}).code;
    const facts = M.facts.filter(x => x.code === code)
      .map(x => ({ date: x.date, emp: x.emp, act: x.act, target: x.target, sales: x.sales,
                   gwp: x.gwp, talk: x.talk, dCov: x.dCov, canc: x.canc, range: !!x.rangeAgg }));
    let mtd = null;
    for (const c of ['Courtesy','Cuddle','VT']) if (M.mtdCC[c] && M.mtdCC[c][code]) mtd = M.mtdCC[c][code];
    return { code, dates: M.dates, facts, att: Object.fromEntries(Object.keys(S.att).map(d => [d, (S.att[d]||{})[code]])),
      mtd: mtd && { emp: mtd.emp, act: mtd.act, target: mtd.target, sales: mtd.sales, spd: mtd.spd,
        canc: mtd.canc, talk: mtd.talk, actDial: mtd.actDial, aveTalk: mtd.aveTalk, gwpT: mtd.gwpT, gwp: mtd.gwp } };
  }, [WHO, from, to]);
  console.log('\n' + '='.repeat(100) + `\n${label}   dates=${JSON.stringify(r.dates)}`);
  console.log('attendance register:', JSON.stringify(r.att));
  console.log('per-day facts:');
  for (const f of r.facts) console.log(`  ${f.date}  emp=${f.emp} act=${f.act} target=${f.target} sales=${f.sales} gwp=${f.gwp} talk=${dur(f.talk)} diallerCovered=${f.dCov} canc=${f.canc}${f.range?'  <- ViciDial RANGE aggregate':''}`);
  const m = r.mtd;
  if (m) console.log(`MTD: emp=${m.emp} act=${m.act} target=${m.target} sales=${m.sales} spd=${m.spd} canc=${m.canc}` +
    `\n     talk=${dur(m.talk)} over actDial=${m.actDial} shifts -> AveTalk=${dur(m.aveTalk)}   gwpT=${m.gwpT} gwp=${m.gwp}`);
  return r;
}
await look('CALENDAR AUGUST (what the app shows by default)', null, null);
await look('WORKBOOK WINDOW 1-4 Aug', '2026-08-01', '2026-08-04');
await browser.close(); server.close();