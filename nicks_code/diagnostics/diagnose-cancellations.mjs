// Cancellations do not match the tracker. VAS currently dates a cancellation by its
// Contract DEACTIVATE date. The other candidate is the Contract CREATE date (i.e. the
// cancellation counts against the period the SALE was made in, which is how Ops does it).
// Compute both straight from the file and see which one reproduces the tracker.
import fs from 'node:fs'; import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const XLSX = require('xlsx');
const UP = path.join(path.resolve(process.cwd(),'..','..'),'uploads','2026-08-06');
const j=(...p)=>path.join(...p);

// ---- the tracker's cancellation column, per agent
const T=XLSX.read(fs.readFileSync(j(UP,'VAS - August 2026 MTD Tracker 1 - 4 Aug.xlsx')),{type:'buffer'});
const rowsOf=sn=>XLSX.utils.sheet_to_json(T.Sheets[sn],{header:1,raw:true,defval:''}).filter(r=>r.some(c=>String(c??'').trim()!==''));
const ref={};
for(const sn of ['MTD - Cuddle','MTD - Courtesy']){
  const rs=rowsOf(sn), hdr=rs[1].map(x=>String(x).trim()), ix=n=>hdr.indexOf(n);
  for(const r of rs.slice(2)){ const nm=String(r[ix('Agent')]||'').trim();
    if(!nm||nm==='Grand Total') continue; ref[nm.toLowerCase()]=+r[ix('Cancellations')]||0; }
}
const refTotal=Object.values(ref).reduce((a,b)=>a+b,0);
console.log('tracker agents:',Object.keys(ref).length,' tracker cancellations total:',refTotal);

// ---- roster, to resolve Owner -> agent name the same way the app does
const rwb=XLSX.read(fs.readFileSync(j(UP,'Matrix - Agent List.xlsx')),{type:'buffer',cellDates:true});
const byName=new Map(), tok=[];
const nn=s=>String(s||'').toLowerCase().replace(/-\s*panimax/g,'').replace(/panimax/g,'').replace(/cb[\s-]*\d+/g,'').replace(/[^a-z ]/g,' ').replace(/\s+/g,' ').trim();
for(const sn of ['VAS','VT']) for(const r of XLSX.utils.sheet_to_json(rwb.Sheets[sn],{raw:true,defval:''})){
  const code=String(r['Employee Code']||'').trim().toUpperCase().replace(/[^A-Z0-9]/g,'');
  const nm=String(r['Agent Name']||'').trim(); if(!/^CB\d+$/.test(code)||!nm) continue;
  byName.set(nn(nm),nm); const t=nn(nm).split(' ').filter(Boolean); if(t.length>=2) tok.push({nm,t});
}
const resolve=o=>{ const k=nn(o); if(byName.has(k)) return byName.get(k);
  const t=k.split(' ').filter(Boolean);
  if(t.length>=2){ const h=tok.filter(e=>t.every(x=>e.t.includes(x))); if(h.length===1) return h[0].nm; }
  return null; };

// ---- the Inactive export, counted both ways
const iwb=XLSX.read(fs.readFileSync(j(UP,'BI Inactive - 05.08.xlsx')),{type:'buffer'});
const rows=XLSX.utils.sheet_to_json(iwb.Sheets[iwb.SheetNames[0]],{raw:true,defval:''});
const iso=v=>{ if(v instanceof Date) return v.toISOString().slice(0,10);
  if(typeof v==='number'&&v>20000) return XLSX.SSF.format('yyyy-mm-dd',v);
  const s=String(v||'').slice(0,10); return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:null; };

const count=(basis,from,to)=>{
  const seen=new Set(), per={};
  for(const r of rows){
    const acc=String(r['Account Number']||'').trim(); if(!acc||/^applied filters/i.test(acc)) continue;
    const dd=iso(r['Contract Deactivate Date']), cd=iso(r['Contract Create Date']);
    if(!dd) continue;                              // not actually cancelled
    const d=basis==='deactivate'?dd:cd;
    if(!d||d<from||d>to) continue;
    const k=acc+'|'+String(r['Contract Number']||'').trim()+'|'+dd;
    if(seen.has(k)) continue; seen.add(k);
    const nm=resolve(r['Owner']); if(!nm) continue;
    per[nm.toLowerCase()]=(per[nm.toLowerCase()]||0)+1;
  }
  return per;
};

const windows=[['2026-08-03','2026-08-04'],['2026-08-01','2026-08-04'],['2026-07-27','2026-08-05']];
for(const basis of ['deactivate','create']){
  for(const [f,t] of windows){
    const per=count(basis,f,t);
    let exact=0,over=0,under=0,tot=0;
    for(const k in ref){ const a=ref[k]||0, b=per[k]||0; tot+=b; if(a===b)exact++; else if(b>a)over++; else under++; }
    console.log(`${basis.padEnd(10)} ${f}..${t}  total=${String(tot).padStart(3)} (tracker ${refTotal})  agents matching ${exact}/${Object.keys(ref).length}  app-higher ${over}  app-lower ${under}`);
  }
}
console.log('\nnamed agents from the screenshot (tracker vs each basis, 3-4 Aug):');
const d34=count('deactivate','2026-08-03','2026-08-04'), c34=count('create','2026-08-03','2026-08-04');
const dAll=count('deactivate','2026-08-01','2026-08-05');
for(const k of ['cohen govender','makhosi mavuso','sinethemba ndlovu','surprise lucky cwele','delano rajagopal','jamie lee chetty']){
  console.log(`  ${k.padEnd(22)} tracker ${String(ref[k]??'-').padStart(2)} | deactivate 3-4: ${String(d34[k]||0).padStart(2)} | create 3-4: ${String(c34[k]||0).padStart(2)} | deactivate 1-5: ${String(dAll[k]||0).padStart(2)}`);
}