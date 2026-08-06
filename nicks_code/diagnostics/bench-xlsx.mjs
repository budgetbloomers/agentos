// Split the 49 MB dialler parse into its two halves (XLSX.read vs sheet_to_json) and try
// the cheap read options, so the fix is chosen on evidence rather than instinct.
import { chromium } from 'playwright';
import fs from 'node:fs'; import path from 'node:path'; import http from 'node:http';
const REPO = path.resolve(process.cwd(), '..', '..');
const BIG = path.join(REPO,'uploads','2026-08-02','Dialler','call_records 01-06-26 - 19-07-26.xlsx');
const MID = path.join(REPO,'uploads','2026-08-02','Active','BI Active - 26.06 - 23.07.xlsx');
const SERVE={'/index.html':path.join(REPO,'Chatterbox_AgentOS_Analytics.html'),
  '/xlsx.full.min.js':path.join(REPO,'site','xlsx.full.min.js')};
const server=http.createServer((q,s)=>{const p=SERVE[q.url.split('?')[0]];
  if(!p){s.writeHead(404);s.end('nf');return}
  s.writeHead(200,{'Content-Type':p.endsWith('.js')?'text/javascript':'text/html'});fs.createReadStream(p).pipe(s)});
await new Promise(r=>server.listen(8134,'127.0.0.1',r));

const br=await chromium.launch({args:['--js-flags=--max-old-space-size=8192']});
const pg=await br.newPage();
pg.on('pageerror',e=>console.log('ERR',e.message));
await pg.goto('http://127.0.0.1:8134/index.html',{waitUntil:'domcontentloaded'});
await pg.waitForFunction(()=>typeof XLSX!=='undefined',null,{timeout:60000});
await pg.evaluate(()=>{const i=document.createElement('input');i.type='file';i.id='__one';i.style.display='none';document.body.appendChild(i)});

for(const [label,file] of [['dialler 49MB',BIG],['BI Active 1.3MB',MID]]){
  await pg.setInputFiles('#__one',file,{timeout:120000});
  console.log(`\n### ${label}`);
  const out=await pg.evaluate(async()=>{
    const f=document.getElementById('__one').files[0];
    const buf=await f.arrayBuffer();
    const res={};
    const run=(name,opts)=>{
      const t0=performance.now(); const wb=XLSX.read(buf,opts); const tRead=performance.now()-t0;
      const ws=wb.Sheets[wb.SheetNames[0]];
      const t1=performance.now(); const rows=XLSX.utils.sheet_to_json(ws,{header:1,raw:true,defval:''}); const tJson=performance.now()-t1;
      res[name]={read:Math.round(tRead), json:Math.round(tJson), total:Math.round(tRead+tJson), rows:rows.length,
                 sample:JSON.stringify(rows[1]&&rows[1].slice(0,3))};
    };
    run('current  {cellDates:true}', {type:'array',cellDates:true});
    run('no cellDates             ', {type:'array'});
    run('dense                    ', {type:'array',cellDates:true,dense:true});
    return res;
  });
  console.log('  variant                        read ms   json ms   total    rows   row1 sample');
  for(const k in out){ const r=out[k];
    console.log(`  ${k}  ${String(r.read).padStart(7)} ${String(r.json).padStart(9)} ${String(r.total).padStart(7)} ${String(r.rows).padStart(7)}   ${r.sample}`); }
}
await br.close(); server.close();