// Does the generated workbook REPRODUCE the hand-built August tracker's numbers?
// The reference covers 1-4 Aug; 1-2 Aug were a weekend, so its daily sheet holds exactly
// two dialing days (03.08 and 04.08). We therefore build the same window from the uploaded
// files and compare per-agent MTD rows column by column.
import { chromium } from 'playwright';
import fs from 'node:fs'; import path from 'node:path'; import http from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const XLSX = require('xlsx');
const REPO = path.resolve(process.cwd(), '..', '..');
const UP = path.join(REPO,'uploads','2026-08-06');
const SERVE={'/index.html':path.join(REPO,'nicks_code','index.html'),'/xlsx.full.min.js':path.join(REPO,'site','xlsx.full.min.js')};
const server=http.createServer((q,s)=>{const p=SERVE[q.url.split('?')[0]];
  if(!p){s.writeHead(404);s.end('nf');return} s.writeHead(200,{'Content-Type':p.endsWith('.js')?'text/javascript':'text/html'});fs.createReadStream(p).pipe(s)});
await new Promise(r=>server.listen(8131,'127.0.0.1',r));
const j=(...p)=>path.join(...p);

// ---- the reference
const T=XLSX.read(fs.readFileSync(j(UP,'VAS - August 2026 MTD Tracker 1 - 4 Aug.xlsx')),{type:'buffer',cellDates:true});
const rowsOf=(bk,sn)=>XLSX.utils.sheet_to_json(bk.Sheets[sn],{header:1,raw:true,defval:''}).filter(r=>r.some(c=>String(c??'').trim()!==''));
const refAgents={};
for(const sn of ['MTD - Cuddle','MTD - Courtesy']){
  const rs=rowsOf(T,sn); const hdr=rs[1].map(x=>String(x).trim());
  const ix=n=>hdr.findIndex(h=>h===n.trim());   // the reference's headers carry trailing spaces
  for(const r of rs.slice(2)){
    const nm=String(r[ix('Agent')]||'').trim();
    if(!nm||nm==='Grand Total') continue;
    refAgents[nm.toLowerCase()]={name:nm, camp:sn.includes('Cuddle')?'Cuddle':'Courtesy',
      emp:+r[ix('Employed Shifts ')]||0, act:+r[ix('Actual Shifts ')]||0,
      target:+r[ix('Sales Target ')]||0, sales:+r[ix('Sales Achieved ')]||0,
      canc:+r[ix('Cancellations')]||0, gwpT:+r[ix('GWP Target ')]||0,
      gwp:+r[ix('GWP Achieved ')]||0, ref:+r[ix('Referrals ')]||0};
  }
}
console.log('reference agents:',Object.keys(refAgents).length);

let pass=0,fail=0;const failures=[];
const ok=(n,c,d='')=>{if(c)pass++;else{fail++;failures.push(n+(d?' — '+d:''))}};
const br=await chromium.launch({args:['--js-flags=--max-old-space-size=8192']});
const ctx=await br.newContext({acceptDownloads:true}); const pg=await ctx.newPage();
const errors=[]; pg.on('pageerror',e=>errors.push(e.message));
await pg.goto('http://127.0.0.1:8131/index.html',{waitUntil:'domcontentloaded'});
await pg.waitForFunction(()=>window.__mtd&&window.__mtd.state(),null,{timeout:30000});
await pg.setInputFiles('#fileInput',[j(UP,'Matrix - Agent List.xlsx'),j(UP,'attendance_2026-08-01_to_2026-08-06.csv'),
  j(UP,'BI Active - 05.08.xlsx'),j(UP,'BI Inactive - 05.08.xlsx'),
  j(UP,'Call X Call report - 3 - 5.xlsx'),j(UP,'evaluations-full-export-2026-08-06.csv')],{timeout:180000});
await pg.waitForFunction(()=>window.__mtd.state().files.length>=7,null,{timeout:600000});
let last=-1,st=0; for(let i=0;i<200;i++){ await pg.waitForTimeout(1500);
  const n=await pg.evaluate(()=>window.__mtd.state().files.length);
  if(n===last){ if(++st>=4)break } else {st=0;last=n} }

// same window as the reference: the two dialing days it actually contains
await pg.evaluate(()=>window.__mtd.setRange('2026-08-03','2026-08-04'));
await pg.waitForTimeout(1500);
const mine = await pg.evaluate(()=>{
  const M=window.__mtd.model(); const out={};
  for(const camp of ['Cuddle','Courtesy'])
    for(const g of Object.values(M.mtdCC[camp]||{}))
      out[String(g.agent).toLowerCase()]={name:g.agent,camp,emp:g.emp,act:g.act,target:g.target,
        sales:g.sales,canc:g.canc||0,gwpT:g.gwpT,gwp:Math.round(g.gwp),ref:g.ref||0};
  return {agents:out, dates:M.dates};
});
console.log('generated window:',JSON.stringify(mine.dates),'agents:',Object.keys(mine.agents).length);

const cols=['emp','act','target','sales','canc','gwpT','gwp','ref'];
const tally={}; cols.forEach(c=>tally[c]={match:0,diff:0,samples:[]});
let matched=0, missing=[];
for(const key in refAgents){
  const r=refAgents[key], m=mine.agents[key];
  if(!m){ missing.push(r.name); continue; }
  matched++;
  for(const c of cols){
    const a=Math.round((r[c]||0)*100)/100, b=Math.round((m[c]||0)*100)/100;
    const near = c==='gwp' ? Math.abs(a-b)<=1 : a===b;
    if(near) tally[c].match++;
    else { tally[c].diff++; if(tally[c].samples.length<4) tally[c].samples.push(`${r.name}: ref ${a} vs app ${b}`); }
  }
}
console.log(`\nagents matched by name: ${matched} of ${Object.keys(refAgents).length}` + (missing.length?`  (missing: ${missing.slice(0,6).join(', ')})`:''));
console.log('\ncolumn                 match   differ   examples');
for(const c of cols){
  const t=tally[c];
  console.log(`  ${c.padEnd(8)} ${String(t.match).padStart(10)} ${String(t.diff).padStart(8)}   ${t.samples.slice(0,2).join(' | ')}`);
}
ok('most reference agents are present in the generated report', matched>=Object.keys(refAgents).length*0.9, `${matched}/${Object.keys(refAgents).length}`);
ok('Sales Achieved reproduces the reference', tally.sales.diff===0, `${tally.sales.diff} agents differ`);
ok('GWP Achieved reproduces the reference', tally.gwp.diff===0, `${tally.gwp.diff} agents differ`);
ok('Employed Shifts reproduce the reference', tally.emp.diff===0, `${tally.emp.diff} agents differ`);
ok('Actual Shifts reproduce the reference', tally.act.diff===0, `${tally.act.diff} agents differ`);
ok('Sales Target reproduces the reference', tally.target.diff===0, `${tally.target.diff} agents differ`);
ok('Cancellations reproduce the reference', tally.canc.diff===0, `${tally.canc.diff} agents differ`);
ok('Referrals reproduce the reference', tally.ref.diff===0, `${tally.ref.diff} agents differ`);
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
failures.forEach(f=>console.log('FAIL: '+f));
errors.slice(0,4).forEach(e=>console.log('  PAGEERROR '+e));
await br.close(); server.close();
process.exit(0);   // reporting tool: always exit 0, the table is the output