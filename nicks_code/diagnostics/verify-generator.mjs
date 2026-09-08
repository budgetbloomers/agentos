// Generate the MTD tracker from the uploaded August files and check it against the
// structure of the hand-built "VAS - August 2026 MTD Tracker 1 - 4 Aug.xlsx".
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

const REPO = process.env.AGENTOS || decodeURIComponent(new URL('../..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1').replace(/\/$/, '');   // repo-relative (2026-09-08): the laptop path failed every cloud run
const UP = path.join(REPO,'uploads','2026-08-06');
const SCRATCH = process.cwd();
const DL = path.join(SCRATCH,'dl');
fs.rmSync(DL,{recursive:true,force:true}); fs.mkdirSync(DL,{recursive:true});
const SERVE={'/':path.join(REPO,'nicks_code','index.html'),'/index.html':path.join(REPO,'nicks_code','index.html'),
  '/xlsx.full.min.js':path.join(REPO,'site','xlsx.full.min.js')};
const server=http.createServer((q,s)=>{const p=SERVE[q.url.split('?')[0]];
  if(!p||!fs.existsSync(p)){s.writeHead(404);s.end('nf');return}
  s.writeHead(200,{'Content-Type':p.endsWith('.js')?'text/javascript':'text/html'});fs.createReadStream(p).pipe(s)});
await new Promise(r=>server.listen(8126,'127.0.0.1',r));
const j=(...p)=>path.join(...p);

// the template we must match
const T = XLSX.read(fs.readFileSync(j(UP,'VAS - August 2026 MTD Tracker 1 - 4 Aug.xlsx')),{type:'buffer',cellDates:true});
const rowsOf=(bk,sn)=>XLSX.utils.sheet_to_json(bk.Sheets[sn],{header:1,raw:true,defval:''}).filter(r=>r.some(c=>String(c??'').trim()!==''));
const tplHdr = (sn,row)=>rowsOf(T,sn)[row].map(x=>String(x).trim()).filter(Boolean);

let pass=0,fail=0;const failures=[];
const ok=(n,c,d='')=>{if(c)pass++;else{fail++;failures.push(n+(d?' — '+d:''))}};

const browser=await chromium.launch({args:['--js-flags=--max-old-space-size=8192']});
const ctx=await browser.newContext({acceptDownloads:true});
const page=await ctx.newPage();
const errors=[];page.on('pageerror',e=>errors.push('PAGEERROR: '+e.message));
await page.goto('http://127.0.0.1:8126/index.html',{waitUntil:'domcontentloaded'});
await page.waitForFunction(()=>window.__mtd&&window.__mtd.state(),null,{timeout:30000});

const FILES=[j(UP,'Matrix - Agent List.xlsx'),j(UP,'attendance_2026-08-01_to_2026-08-06.csv'),
  j(UP,'BI Active - 05.08.xlsx'),j(UP,'BI Inactive - 05.08.xlsx'),
  j(UP,'Call X Call report - 3 - 5.xlsx'),j(UP,'Vici - Cuddle Agents - 3 - 5 Aug.csv'),
  j(UP,'evaluations-full-export-2026-08-06.csv')];
console.log('uploading…');
await page.setInputFiles('#fileInput',FILES,{timeout:60000});
await page.waitForFunction(()=>(window.__mtd.state().files||[]).length>=6,null,{timeout:600000});
await page.waitForTimeout(5000);
await page.evaluate(()=>window.__mtd.setPeriod('2026-08','calendar'));
await page.waitForTimeout(1500);

// multi-day Vici must now reach the period totals
const talk = await page.evaluate(()=>{ const M=window.__mtd.model();
  const agg=M.facts.reduce((t,f)=>{t.all+=f.talk; if(f.rangeAgg)t.range+=f.talk; return t;},{all:0,range:0});
  return {allH:+(agg.all/3600).toFixed(2), rangeH:+(agg.range/3600).toFixed(2),
          rangeFacts:M.facts.filter(f=>f.rangeAgg).length, dates:M.dates.length}; });
console.log('talk:',JSON.stringify(talk));
ok('multi-day ViciDial range now counts in the period totals', talk.rangeH>250, JSON.stringify(talk));
ok('range aggregates carried as their own facts', talk.rangeFacts===24, `got ${talk.rangeFacts}`);

// generate
await page.evaluate(()=>go('mtd'));
await page.waitForTimeout(600);
const dl = await Promise.all([page.waitForEvent('download',{timeout:120000}), page.click('button:has-text("Generate MTD tracker")')]).then(r=>r[0]);
const out = j(DL, dl.suggestedFilename());
await dl.saveAs(out);
console.log('generated:', dl.suggestedFilename());

const G = XLSX.read(fs.readFileSync(out),{type:'buffer',cellDates:true});
console.log('sheets:', JSON.stringify(G.SheetNames));
/* The sheet list follows MTD_RULES.reportedCampaigns — one WTD and one MTD sheet per
   reported campaign, in rule-book order. DERIVED here rather than hardcoded, because the
   list has moved twice (Nesting out on 2026-08-09, back in when it became a reported
   campaign) and a frozen copy just re-fails on every policy change without catching a bug. */
const reported = await page.evaluate(() => (window.__mtd.rules().reportedCampaigns) || ['Cuddle', 'Courtesy']);
const want=['Pivot Table','August',
  ...reported.map(c=>'WTD - '+c),
  ...reported.map(c=>'MTD - '+c),
  'Team Split','TL MTD'];
ok(`all ${want.length} sheets (2 + WTD/MTD per reported campaign), in the workbook's order`,
  JSON.stringify(G.SheetNames)===JSON.stringify(want), JSON.stringify(G.SheetNames)+' vs '+JSON.stringify(want));

// headers must match the template
// find the header row by content, not position: the template carries extra banner rows
const hdrRow=(bk,sn,marker)=>{ const rs=rowsOf(bk,sn);
  const r=rs.find(x=>x.some(c=>String(c).trim()===marker));
  return r?r.map(x=>String(x).trim()).filter(Boolean):[]; };
const cmp=(sn,marker,label)=>{
  const a=hdrRow(T,sn,marker), b=hdrRow(G,sn,marker);
  const miss=a.filter(h=>!b.includes(h));
  ok(label+' columns match the template', a.length>0&&miss.length===0, miss.length?'missing: '+miss.join(' | '):'marker not found');
};
cmp('August','Week','daily sheet');
cmp('MTD - Cuddle','Team Leader','MTD');
cmp('WTD - Cuddle','Team Leader','WTD');
cmp('Pivot Table','Sum of Employed Shifts','pivot');

// TL MTD metric rows
const tlT=XLSX.utils.sheet_to_json(T.Sheets['TL MTD'],{header:1,raw:true,defval:''}).map(r=>String(r[0]||'').trim()).filter(Boolean);
const tlG=XLSX.utils.sheet_to_json(G.Sheets['TL MTD'],{header:1,raw:true,defval:''}).map(r=>String(r[0]||'').trim()).filter(Boolean);
const missTL=[...new Set(tlT)].filter(m=>!['Courtesy','Cuddle','Team Leaders'].includes(m)).filter(m=>!tlG.includes(m));
ok('TL MTD carries every metric row from the template', missTL.length===0, 'missing: '+missTL.join(' | '));
console.log('TL MTD rows generated:', JSON.stringify([...new Set(tlG)].slice(0,26)));

// internal consistency: MTD grand total must equal the sum of its agent rows
const mt=XLSX.utils.sheet_to_json(G.Sheets['MTD - Cuddle'],{header:1,raw:true,defval:''});
const hdr=mt[1].map(x=>String(x).trim());
const ci=n=>hdr.findIndex(h=>h===n);
const body=mt.slice(2).filter(r=>String(r[0]).trim()&&String(r[0]).trim()!=='Grand Total');
const gt=mt.find(r=>String(r[0]).trim()==='Grand Total');
for(const col of ['Sales Achieved','GWP Achieved','Cancellations','Actual Shifts']){
  const i=ci(col); if(i<0){ ok('MTD has '+col,false); continue; }
  const s=body.reduce((t,r)=>t+(Number(r[i])||0),0);
  ok(`MTD Grand Total reconciles: ${col}`, Math.abs(s-(Number(gt[i])||0))<0.01, `rows ${s} vs total ${gt[i]}`);
}
// the daily sheet must not contain range aggregates
const aug=XLSX.utils.sheet_to_json(G.Sheets['August'],{raw:true,defval:''});
const dailyDates=[...new Set(aug.map(r=>r['Date']))];
console.log('daily dates:',JSON.stringify(dailyDates),'rows:',aug.length);
ok('daily sheet dated dd.mm.yyyy like the template', dailyDates.every(d=>/^\d{2}\.\d{2}\.\d{4}$/.test(String(d))), JSON.stringify(dailyDates));
ok('daily sheet has rows', aug.length>0, String(aug.length));

ok('no page errors', errors.length===0, errors.slice(0,3).join(' | '));
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
failures.forEach(f=>console.log('FAIL: '+f));
errors.slice(0,5).forEach(e=>console.log('  '+e));
await browser.close(); server.close();
process.exit(fail||errors.length?1:0);
