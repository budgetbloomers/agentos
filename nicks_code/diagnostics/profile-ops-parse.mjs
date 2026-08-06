// Where do the 74 seconds of "parse+detect" go? Times readUpload() per file in the Ops app,
// and separately times the second read that sheetScan/headerScan sources trigger.
import { chromium } from 'playwright';
import fs from 'node:fs'; import path from 'node:path'; import http from 'node:http';
const REPO = path.resolve(process.cwd(), '..', '..');
const UP = path.join(REPO,'uploads','2026-08-02');
const SERVE={'/index.html':path.join(REPO,'Chatterbox_AgentOS_Analytics.html'),
  '/xlsx.full.min.js':path.join(REPO,'site','xlsx.full.min.js')};
const server=http.createServer((q,s)=>{const p=SERVE[q.url.split('?')[0]];
  if(!p){s.writeHead(404);s.end('nf');return}
  s.writeHead(200,{'Content-Type':p.endsWith('.js')?'text/javascript':'text/html'});fs.createReadStream(p).pipe(s)});
await new Promise(r=>server.listen(8133,'127.0.0.1',r));
const j=(...p)=>path.join(...p);
const FILES=[ j(UP,'Agent List','Matrix - Agent List.xlsx'),
  j(UP,'Attendance','attendance_2026-07-01_to_2027-07-24.csv'),
  j(UP,'Active','BI Active - 26.06 - 23.07.xlsx'),
  j(UP,'Inactive','BI Inactive - 26.06 - 23.07.xlsx'),
  j(UP,'Open Cases','SF Open Cases - Current.xls'),
  j(UP,'Closed Cases','SF Closed - 01.07.2026 - 16.07.2026.xls'),
  j(UP,'Dialler','call_records 01-06-26 - 19-07-26.xlsx'),
  j(UP,'QA','evaluations-full-export-2026-08-02.csv') ];

const br=await chromium.launch({args:['--js-flags=--max-old-space-size=8192']});
const pg=await br.newPage();
pg.on('pageerror',e=>console.log('ERR',e.message));
await pg.goto('http://127.0.0.1:8133/index.html',{waitUntil:'domcontentloaded'});
await pg.evaluate(()=>document.dispatchEvent(new Event('cbx-authed')));
await pg.waitForFunction(()=>window.state,null,{timeout:60000});

// a hidden single-file input we can drive per file
await pg.evaluate(()=>{const i=document.createElement('input');i.type='file';i.id='__one';i.style.display='none';document.body.appendChild(i)});
console.log('file                                    MB   read1 ms  detect ms  read2 ms   rows   source');
let total=0;
for(const f of FILES){
  await pg.setInputFiles('#__one',f,{timeout:120000});
  const r=await pg.evaluate(async()=>{
    const file=document.getElementById('__one').files[0];
    const t1=performance.now(); const p=await readUpload(file,null); const read1=performance.now()-t1;
    const t2=performance.now(); const src=detectSource(p); const det=performance.now()-t2;
    let read2=0;
    if(src&&(SOURCES[src].sheetScan||SOURCES[src].headerScan)){
      const t3=performance.now(); await readUpload(file,src); read2=performance.now()-t3;
    }
    return {mb:+(file.size/1048576).toFixed(1), read1:Math.round(read1), det:Math.round(det),
            read2:Math.round(read2), rows:p.data.length, src:src||'(none)'};
  });
  total+=r.read1+r.det+r.read2;
  console.log(`  ${path.basename(f).slice(0,36).padEnd(36)} ${String(r.mb).padStart(5)} ${String(r.read1).padStart(9)} ${String(r.det).padStart(10)} ${String(r.read2).padStart(9)} ${String(r.rows).padStart(7)}   ${r.src}`);
}
console.log(`\ntotal parse+detect: ${Math.round(total)} ms`);
await br.close(); server.close();