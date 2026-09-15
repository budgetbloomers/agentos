// VAS analytics: August MTD build from the real August drop.
// Checks cancellations from the Inactive upload, no duplication on daily re-uploads,
// leavers dropping out when a new Agent List lands, and the removed slots.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

const REPO = process.env.AGENTOS || decodeURIComponent(new URL('../..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1').replace(/\/$/, '');   // repo-relative (2026-09-08): the laptop path failed every cloud run
const UP = path.join(REPO, 'uploads', '2026-08-06');
const SCRATCH = process.cwd();
const SERVE = { '/': path.join(REPO,'nicks_code','index.html'), '/index.html': path.join(REPO,'nicks_code','index.html'),
  '/xlsx.full.min.js': path.join(REPO,'site','xlsx.full.min.js') };
const server = http.createServer((req,res)=>{ const p=SERVE[req.url.split('?')[0]];
  if(!p||!fs.existsSync(p)){res.writeHead(404);res.end('nf');return}
  res.writeHead(200,{'Content-Type':p.endsWith('.js')?'text/javascript':'text/html'}); fs.createReadStream(p).pipe(res); });
await new Promise(r=>server.listen(8125,'127.0.0.1',r));
const j=(...p)=>path.join(...p);

// ---- independent recompute of cancellations straight from the file
const iwb = XLSX.read(fs.readFileSync(j(UP,'BI Inactive - 05.08.xlsx')), {type:'buffer'});
const irows = XLSX.utils.sheet_to_json(iwb.Sheets[iwb.SheetNames[0]], {raw:true, cellDates:true, defval:''});
const seen = new Set(); const perDay = {};
for (const r of irows) {
  const acc=String(r['Account Number']||'').trim(); if(!acc||/^applied filters/i.test(acc)) continue;
  const v=r['Contract Deactivate Date']; let dd=null;
  if(v instanceof Date) dd=v.toISOString().slice(0,10);
  else if(typeof v==='number'&&v>20000) dd=XLSX.SSF.format('yyyy-mm-dd',v);
  else if(/^\d{4}-\d{2}-\d{2}/.test(String(v||''))) dd=String(v).slice(0,10);
  if(!dd) continue;
  const k=acc+'|'+String(r['Contract Number']||'').trim()+'|'+dd; if(seen.has(k)) continue; seen.add(k);
  perDay[dd]=(perDay[dd]||0)+1;
}
const EXP_CANC = Object.values(perDay).reduce((a,b)=>a+b,0);
console.log('independent: distinct cancelled contracts =', EXP_CANC, 'over', Object.keys(perDay).length, 'days', JSON.stringify(perDay));


// roster, resolved the way the app does (alias / exact name / unique token subset)
const rwb = XLSX.read(fs.readFileSync(j(UP,'Matrix - Agent List.xlsx')),{type:'buffer',cellDates:true});
const rosterNames=new Map(), rosterTok=[];
for(const sn of ['VAS','VT']){
  for(const r of XLSX.utils.sheet_to_json(rwb.Sheets[sn],{raw:true,defval:''})){
    const code=String(r['Employee Code']||'').trim().toUpperCase().replace(/[^A-Z0-9]/g,'');
    const nm=String(r['Agent Name']||'').trim(); if(!/^CB\d+$/.test(code)||!nm) continue;
    const camp=String(r['Campaign']||r['Que']||'').trim();
    if(camp&&!/cuddle|courtesy|track|vehicle|vision/i.test(camp)) continue;
    const key=nm.toLowerCase().replace(/[^a-z]/g,'');
    rosterNames.set(key,code);
    const tok=nm.toLowerCase().replace(/[^a-z ]/g,' ').split(/\s+/).filter(Boolean);
    if(tok.length>=2) rosterTok.push({code,tok});
  }
}
const resolveOwner=o=>{
  const clean=String(o||'').toLowerCase().replace(/-\s*panimax/g,'').replace(/panimax/g,'').replace(/cb[\s-]*\d+/g,'');
  const flat=clean.replace(/[^a-z]/g,'');
  if(rosterNames.has(flat)) return rosterNames.get(flat);
  const tok=clean.replace(/[^a-z ]/g,' ').split(/\s+/).filter(Boolean);
  if(tok.length>=2){ const h=rosterTok.filter(e=>tok.every(x=>e.tok.includes(x))); if(h.length===1) return h[0].code; }
  return null;
};
let EXP_ATTRIB=0, EXP_UNMAPPED=0;
{ const seen2=new Set();
  for(const r of irows){
    const acc=String(r['Account Number']||'').trim(); if(!acc||/^applied filters/i.test(acc)) continue;
    const v=r['Contract Deactivate Date']; let dd=null;
    if(v instanceof Date) dd=v.toISOString().slice(0,10);
    else if(typeof v==='number'&&v>20000) dd=XLSX.SSF.format('yyyy-mm-dd',v);
    else if(/^\d{4}-\d{2}-\d{2}/.test(String(v||''))) dd=String(v).slice(0,10);
    if(!dd) continue;
    const k=acc+'|'+String(r['Contract Number']||'').trim()+'|'+dd; if(seen2.has(k)) continue; seen2.add(k);
    if(resolveOwner(r['Owner'])) EXP_ATTRIB++; else EXP_UNMAPPED++;
  } }
console.log('independent: attributable to a rostered agent =', EXP_ATTRIB, '| owner not on the Agent List =', EXP_UNMAPPED);

let pass=0, fail=0; const failures=[];
const ok=(n,c,d='')=>{ if(c) pass++; else { fail++; failures.push(n+(d?' — '+d:'')); } };

const browser = await chromium.launch({ args:['--js-flags=--max-old-space-size=8192'] });
const page = await browser.newPage({ viewport:{width:1440,height:950} });
const errors=[]; page.on('pageerror',e=>errors.push('PAGEERROR: '+e.message));
await page.goto('http://127.0.0.1:8125/index.html',{waitUntil:'domcontentloaded'});
await page.waitForFunction(()=>window.__mtd&&window.__mtd.state(),null,{timeout:30000});

// slots
await page.evaluate(()=>go('data'));
await page.waitForFunction(()=>document.querySelectorAll('.slot[data-slot]').length>0,null,{timeout:15000});
const slots = await page.evaluate(()=>[...document.querySelectorAll('.slot[data-slot]')].map(e=>e.dataset.slot));
console.log('slots:', JSON.stringify(slots));
/* Lead Allocation was REMOVED 2026-08-27 (Nick): its Open Cases slot must be gone, while
   Lead Management keeps its own Open + Closed Cases slots. */
ok('Lead Allocation — Open Cases slot removed; Lead Management keeps its own Open + Closed',
   !slots.includes('opencases') && slots.includes('opencasesLM') && slots.includes('closedcases'), slots.join(','));
ok('Tracker Workbook slot removed', !slots.includes('trackerDaily'), slots.join(','));
ok('Cancellations slot added', slots.includes('inactive'), slots.join(','));
ok('ViciDial slot added', slots.includes('vici'), slots.join(','));

const FILES=[ j(UP,'Matrix - Agent List.xlsx'), j(UP,'attendance_2026-08-01_to_2026-08-06.csv'),
  j(UP,'BI Active - 05.08.xlsx'), j(UP,'BI Inactive - 05.08.xlsx'),
  j(UP,'Call X Call report - 3 - 5.xlsx'), j(UP,'evaluations-full-export-2026-08-06.csv') ];

// Cancellations live in S.cancRows, keyed account|contract|deactivate-date — one entry per
// cancelled CONTRACT. (They used to live in a per-day S.canc bucket; this suite still read
// that name long after it stopped being written, so the assertion below was reading 0.)
const snap=()=>page.evaluate(()=>{ const S=window.__mtd.state();
  const rows=S.cancRows||{};
  return { files:(S.files||[]).map(f=>f.type), roster:(S.roster||[]).length,
    cancDays:new Set(Object.values(rows).map(r=>r.d)).size, cancTotal:Object.keys(rows).length,
    salesDays:Object.keys(S.sales||{}).length, callDays:Object.keys(S.calls||{}).length }; });

console.log('\nRound 1: August drop…');
await page.setInputFiles('#fileInput', FILES, {timeout:60000});
await page.waitForFunction(()=>(window.__mtd.state().files||[]).length>=5,null,{timeout:600000});
await page.waitForTimeout(4000);
const s1=await snap(); console.log(JSON.stringify(s1));
ok('cancellations file recognised', s1.files.some(t=>/cancellations/.test(t)), s1.files.join(','));
ok('cancellations stored raw and complete (every dated contract kept)', s1.cancTotal===EXP_CANC, `app ${s1.cancTotal} vs file ${EXP_CANC}`);


// MTD model
const mtd = await page.evaluate(()=>{ window.__mtd.setPeriod('2026-08','calendar');
  const M=window.__mtd.model();
  return { canc:M.grand.canc, sales:M.grand.sales, gwp:Math.round(M.grand.gwp), agents:M.agents?M.agents.length:null,
           dates:M.dates.length }; });
const attributed = await page.evaluate(()=>{ const M=window.__mtd.model();
   return (M.agents||[]).reduce((t,a)=>t+(a.canc||0),0); });
console.log('August MTD:', JSON.stringify(mtd), '| attributed canc across all agents (all dates):', attributed);
ok('MTD carries the cancellations', mtd.canc>0, JSON.stringify(mtd));
ok('MTD cancellations never exceed what the file holds', mtd.canc<=EXP_CANC, `${mtd.canc} vs ${EXP_CANC}`);

// ---- Round 2: re-upload the SAME daily files (the real daily rhythm)
console.log('Round 2: re-uploading the same files (daily rhythm)…');
await page.setInputFiles('#fileInput', FILES, {timeout:60000});
await page.waitForTimeout(9000);
const s2=await snap();
ok('no duplication on re-upload (cancellations)', s2.cancTotal===s1.cancTotal, `${s1.cancTotal} -> ${s2.cancTotal}`);
ok('no duplication on re-upload (sales days)', s2.salesDays===s1.salesDays, `${s1.salesDays} -> ${s2.salesDays}`);
const mtd2 = await page.evaluate(()=>{ const M=window.__mtd.model(); return {canc:M.grand.canc,sales:M.grand.sales}; });
ok('MTD figures unchanged after re-upload', mtd2.canc===mtd.canc && mtd2.sales===mtd.sales, JSON.stringify(mtd2)+' vs '+JSON.stringify(mtd));

// ---- Round 3: renamed copy of the Inactive file must not double the cancellations
fs.copyFileSync(j(UP,'BI Inactive - 05.08.xlsx'), j(SCRATCH,'BI Inactive - re-pull.xlsx'));
await page.setInputFiles('#fileInput',[j(SCRATCH,'BI Inactive - re-pull.xlsx')],{timeout:60000});
await page.waitForTimeout(6000);
const s3=await snap();
ok('renamed re-pull does not double cancellations', s3.cancTotal===s1.cancTotal, `${s1.cancTotal} -> ${s3.cancTotal}`);

// ---- Round 4: a NEW agent list without some agents -> they leave the MTD report
const wb = XLSX.read(fs.readFileSync(j(UP,'Matrix - Agent List.xlsx')),{type:'buffer',cellDates:true});
const vas = XLSX.utils.sheet_to_json(wb.Sheets['VAS'],{raw:true,defval:''});
const dropped = vas.slice(0,3).map(r=>String(r['Employee Code']||'').trim().toUpperCase());
const kept = vas.slice(3);
const nwb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(nwb, XLSX.utils.json_to_sheet(kept), 'VAS');
XLSX.utils.book_append_sheet(nwb, XLSX.utils.sheet_to_json(wb.Sheets['VT'],{raw:true,defval:''}).length
  ? XLSX.utils.json_to_sheet(XLSX.utils.sheet_to_json(wb.Sheets['VT'],{raw:true,defval:''})) : XLSX.utils.aoa_to_sheet([[]]), 'VT');
XLSX.writeFile(nwb, j(SCRATCH,'Matrix - Agent List LEAVERS.xlsx'));
console.log('simulating leavers:', dropped.join(','));
const beforeAgents = await page.evaluate(()=>{ const M=window.__mtd.model(); return (M.agents||[]).map(r=>r.code); });
await page.setInputFiles('#fileInput',[j(SCRATCH,'Matrix - Agent List LEAVERS.xlsx')],{timeout:60000});
await page.waitForTimeout(6000);
const after = await page.evaluate(()=>{ const S=window.__mtd.state(); const M=window.__mtd.model();
  return { roster:S.roster.map(a=>a.code), rows:(M.agents||[]).map(r=>r.code), leavers:S.leavers||{},
    marked:(M.agents||[]).filter(r=>r.left).map(r=>r.code) }; });
ok('leavers removed from the roster', dropped.every(c=>!after.roster.includes(c)), dropped.filter(c=>after.roster.includes(c)).join(','));
/* RULE DEPARTURES (2026-09-15): a leaver KEEPS their days up to the list that dropped them, so anyone
   who had facts in the period stays in the report, marked left; before this they vanished whole. */
const hadRows=dropped.filter(c=>beforeAgents.includes(c));
ok('leavers KEEP their days in the MTD report (rule departures) — '+hadRows.join(','), hadRows.every(c=>after.rows.includes(c)), hadRows.filter(c=>!after.rows.includes(c)).join(','));
ok('…marked left, on every row', hadRows.every(c=>after.marked.includes(c)), hadRows.filter(c=>!after.marked.includes(c)).join(','));
ok('…recorded as leavers with the list\'s date', dropped.every(c=>after.leavers[c]&&/^\d{4}-\d{2}-\d{2}$/.test(after.leavers[c].left)), JSON.stringify(dropped.map(c=>after.leavers[c]&&after.leavers[c].left)));
ok('everyone else still in the report', after.rows.length>0, `rows=${after.rows.length}`);
console.log(`report rows: ${beforeAgents.length} -> ${after.rows.length}`);

await page.waitForTimeout(500);
ok('no page errors', errors.length===0, errors.slice(0,4).join(' | '));
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
failures.forEach(f=>console.log('FAIL: '+f));
errors.slice(0,6).forEach(e=>console.log('  '+e));
await browser.close(); server.close();
process.exit(fail||errors.length?1:0);
