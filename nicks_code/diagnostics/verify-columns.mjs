// The on-screen MTD table must carry the same column headings as the hand-built tracker,
// so the two can be read side by side without translating "EMP" -> "Employed Shifts".
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
await new Promise(r=>server.listen(8140,'127.0.0.1',r));
const j=(...p)=>path.join(...p);

const T=XLSX.read(fs.readFileSync(j(UP,'VAS - August 2026 MTD Tracker 1 - 4 Aug.xlsx')),{type:'buffer'});
const rs=XLSX.utils.sheet_to_json(T.Sheets['MTD - Courtesy'],{header:1,raw:true,defval:''}).filter(r=>r.some(c=>String(c??'').trim()!==''));
const want=rs[1].map(x=>String(x).trim()).filter(Boolean);
console.log('workbook columns:', JSON.stringify(want));

let pass=0,fail=0;const failures=[];
const ok=(n,c,d='')=>{if(c)pass++;else{fail++;failures.push(n+(d?' — '+d:''))}};
const br=await chromium.launch({args:['--js-flags=--max-old-space-size=8192']});
const pg=await br.newPage(); const errors=[]; pg.on('pageerror',e=>errors.push(e.message));
await pg.goto('http://127.0.0.1:8140/index.html',{waitUntil:'domcontentloaded'});
await pg.waitForFunction(()=>window.__mtd&&window.__mtd.state(),null,{timeout:30000});
await pg.setInputFiles('#fileInput',[j(UP,'Matrix - Agent List.xlsx'),j(UP,'attendance_2026-08-01_to_2026-08-06.csv'),
  j(UP,'BI Active - 05.08.xlsx'),j(UP,'BI Inactive - 05.08.xlsx'),j(UP,'Call X Call report - 3 - 5.xlsx'),
  j(UP,'evaluations-full-export-2026-08-06.csv')],{timeout:180000});
await pg.waitForFunction(()=>window.__mtd.state().files.length>=7,null,{timeout:600000});
let l=-1,st=0; for(let i=0;i<200;i++){ await pg.waitForTimeout(1200);
  const n=await pg.evaluate(()=>window.__mtd.state().files.length); if(n===l){if(++st>=4)break}else{st=0;l=n} }
await pg.evaluate(()=>{window.__mtd.setPeriod('2026-08','calendar'); S.ui.mtdSub='Courtesy'; go('mtd')});
await pg.waitForTimeout(1800);

const got=await pg.evaluate(()=>{
  const t=[...document.querySelectorAll('table')].find(x=>x.querySelector('th'));
  return t?[...t.querySelectorAll('thead th')].map(h=>h.textContent.trim()).filter(Boolean):[];
});
console.log('on screen       :', JSON.stringify(got));
const missing=want.filter(h=>!got.includes(h));
console.log('missing from screen:', JSON.stringify(missing));
ok('every workbook column heading appears on screen', missing.length===0, missing.join(' | '));
// and in the same order
const idx=want.map(h=>got.indexOf(h));
const ordered=idx.every((v,i)=>i===0||v>idx[i-1]);
ok('and in the same left-to-right order', ordered, JSON.stringify(idx));
ok('no page errors', errors.length===0, errors.slice(0,3).join(' | '));
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
failures.forEach(f=>console.log('FAIL: '+f));
await br.close(); server.close();
process.exit(fail||errors.length?1:0);