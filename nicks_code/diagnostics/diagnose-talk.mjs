// Why don't Ave Talk Time and SPD match the August MTD reference?
// Separates two very different causes: (a) the app CALCULATES differently, or (b) the
// SOURCE files we hold are not the ones the reference was built from.
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
await new Promise(r=>server.listen(8135,'127.0.0.1',r));
const j=(...p)=>path.join(...p);
const hms=s=>{s=Math.round(s||0);const h=Math.floor(s/3600),m=Math.floor(s%3600/60);return h+':'+String(m).padStart(2,'0')+':'+String(s%60).padStart(2,'0')};

// ---------- 1. the reference ----------
const T=XLSX.read(fs.readFileSync(j(UP,'VAS - August 2026 MTD Tracker 1 - 4 Aug.xlsx')),{type:'buffer'});  // raw: times come back as fractions
const rowsOf=(sn)=>XLSX.utils.sheet_to_json(T.Sheets[sn],{header:1,raw:true,defval:''}).filter(r=>r.some(c=>String(c??'').trim()!==''));
const secOf=v=>typeof v==='number'?Math.round(v*86400):0;
const ref={};
for(const sn of ['MTD - Cuddle','MTD - Courtesy']){
  const rs=rowsOf(sn), hdr=rs[1].map(x=>String(x).trim()), ix=n=>hdr.indexOf(n.trim());
  for(const r of rs.slice(2)){
    const nm=String(r[ix('Agent')]||'').trim(); if(!nm||nm==='Grand Total') continue;
    ref[nm.toLowerCase()]={name:nm,camp:sn.includes('Cuddle')?'Cuddle':'Courtesy',
      act:+r[ix('Actual Shifts')]||0, sales:+r[ix('Sales Achieved')]||0,
      spd:+r[ix('SPD')]||0, aveTalk:secOf(r[ix('Ave Talk Time')])};
  }
}
console.log('reference agents:',Object.keys(ref).length);

// ---------- 2. what the SOURCE files actually contain ----------
const normCB=s=>{const m=String(s||'').toUpperCase().match(/CB\s*-?\s*(\d+)/);return m?'CB'+m[1]:null};
const cwb=XLSX.read(fs.readFileSync(j(UP,'Call X Call report - 3 - 5.xlsx')),{type:'buffer'});
const callx={};                       // agentString -> {day -> seconds}
for(const r of XLSX.utils.sheet_to_json(cwb.Sheets[cwb.SheetNames[0]],{raw:false,defval:''})){
  const d=String(r['Date & Time']||'').slice(0,10); if(!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
  const a=String(r['Agent']||'').trim(); if(!a) continue;
  (callx[a]=callx[a]||{})[d]=(callx[a][d]||0)+(Number(r['Billable Seconds'])||0);
}
const vl=fs.readFileSync(j(UP,'Vici - Cuddle Agents - 3 - 5 Aug.csv'),'utf8').split(/\r?\n/);
const hi=vl.findIndex(l=>/^\s*"USER NAME"/.test(l));
const q=l=>(l.match(/"([^"]*)"/g)||[]).map(s=>s.slice(1,-1));
const vhead=q(vl[hi]); const vici={};
const dsec=t=>{const p=String(t||'').split(':').map(Number);return p.length===3?p[0]*3600+p[1]*60+p[2]:0};
for(const l of vl.slice(hi+1)){ if(!l.trim())continue; const c=q(l); if(!c.length)continue;
  const o={}; vhead.forEach((h,i)=>o[h]=c[i]);
  if(/^totals?$/i.test(o['CURRENT USER GROUP']||'')||/^admin$/i.test(o['CURRENT USER GROUP']||''))continue;
  vici[(o['USER NAME']||'').trim().toLowerCase()]={talk:dsec(o['TALK']),calls:+o['CALLS']||0}; }
console.log('CallX agent strings:',Object.keys(callx).length,' Vici agents:',Object.keys(vici).length);
console.log('CallX days present :',[...new Set(Object.values(callx).flatMap(o=>Object.keys(o)))].sort().join(', '));

// ---------- 3. what the app produces ----------
const br=await chromium.launch({args:['--js-flags=--max-old-space-size=8192']});
const pg=await br.newPage(); pg.on('pageerror',e=>console.log('ERR',e.message));
await pg.goto('http://127.0.0.1:8135/index.html',{waitUntil:'domcontentloaded'});
await pg.waitForFunction(()=>window.__mtd&&window.__mtd.state(),null,{timeout:30000});
await pg.setInputFiles('#fileInput',[j(UP,'Matrix - Agent List.xlsx'),j(UP,'attendance_2026-08-01_to_2026-08-06.csv'),
  j(UP,'BI Active - 05.08.xlsx'),j(UP,'BI Inactive - 05.08.xlsx'),j(UP,'Call X Call report - 3 - 5.xlsx'),
  j(UP,'Vici - Cuddle Agents - 3 - 5 Aug.csv'),j(UP,'evaluations-full-export-2026-08-06.csv')],{timeout:180000});
await pg.waitForFunction(()=>window.__mtd.state().files.length>=7,null,{timeout:600000});
let last=-1,st=0; for(let i=0;i<200;i++){ await pg.waitForTimeout(1500);
  const n=await pg.evaluate(()=>window.__mtd.state().files.length);
  if(n===last){ if(++st>=4)break } else {st=0;last=n} }

const grab=async(from,to)=>{ await pg.evaluate(([f,t])=>window.__mtd.setRange(f,t),[from,to]);
  await pg.waitForTimeout(1200);
  return pg.evaluate(()=>{ const M=window.__mtd.model(); const o={};
    for(const camp of ['Cuddle','Courtesy']) for(const g of Object.values(M.mtdCC[camp]||{}))
      o[String(g.agent).toLowerCase()]={act:g.act,actDial:g.actDial,sales:g.sales,spd:g.act?g.sales/g.act:0,talk:g.talk,aveTalk:g.aveTalk||0};
    return {agents:o,dates:M.dates}; }); };

const w34=await grab('2026-08-03','2026-08-04');
const w35=await grab('2026-08-03','2026-08-05');
const wAug=await grab('2026-08-01','2026-08-31');
console.log('\nwindows built:', '3-4 Aug ->',w34.dates.join(','), '| 3-5 Aug ->',w35.dates.join(','), '| Aug ->',wAug.dates.join(','));

const names=['jolene chetty','enoch pillay','madelien pillay','threza chetty','kyle kisten','mandisa cele','noxolo mbelu','ramiska binda'];
console.log('\nagent                 | ref act/sales/SPD  refAveTalk | app(3-4) act/sales/SPD aveTalk | app(Aug) aveTalk | SOURCE: CallX 3-4 / Vici 3-day');
for(const k of names){
  const r=ref[k]; if(!r) continue;
  const a34=w34.agents[k]||{}, aA=wAug.agents[k]||{};
  const cx=Object.entries(callx).find(([s])=>s.toLowerCase().includes(k.split(' ')[0])&&s.toLowerCase().includes(k.split(' ').pop()));
  const cx34=cx?((cx[1]['2026-08-03']||0)+(cx[1]['2026-08-04']||0)):0;
  const vi=vici[k];
  console.log(`${r.name.padEnd(21)} | ${String(r.act).padStart(3)}/${String(r.sales).padStart(3)}/${r.spd.toFixed(2).padStart(5)}  ${hms(r.aveTalk).padStart(9)} | `
    +`${String(a34.act??'-').padStart(3)}/${String(a34.sales??'-').padStart(3)}/${(a34.spd??0).toFixed(2).padStart(5)} ${hms(a34.aveTalk).padStart(8)} (talk ${hms(a34.talk)}, dialShifts ${a34.actDial}) | `
    +`${hms(aA.aveTalk).padStart(8)} | CallX ${hms(cx34)} / Vici ${vi?hms(vi.talk):'-'}`);
}

// totals: does the reference's implied total talk exist anywhere in our sources?
let refTotal=0; for(const k in ref) refTotal+=ref[k].aveTalk*ref[k].act;
const cxTotal34=Object.values(callx).reduce((t,o)=>t+(o['2026-08-03']||0)+(o['2026-08-04']||0),0);
const cxTotal35=Object.values(callx).reduce((t,o)=>t+Object.values(o).reduce((x,y)=>x+y,0),0);
const viTotal=Object.values(vici).reduce((t,o)=>t+o.talk,0);
console.log('\nTOTAL TALK, all agents');
console.log('  reference implies (Ave x Actual, 1-4 Aug) :',hms(refTotal));
console.log('  CallX file, 3-4 Aug only                  :',hms(cxTotal34));
console.log('  CallX file, all of 3-5 Aug                :',hms(cxTotal35));
console.log('  Vici file, its whole 3-5 Aug range        :',hms(viTotal));
console.log('  CallX(3-4) + Vici(3-day)                  :',hms(cxTotal34+viTotal));
await br.close(); server.close();