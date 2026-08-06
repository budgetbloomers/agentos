// Hydrate audit: adopting an OLD cloud blob (saved before today's stores existed) must not
// kill the app. hydrate() deletes every key on S and Object.assigns the blob wholesale, so
// any store added since must be re-seeded by normalizeState().
import { chromium } from 'playwright';
import fs from 'node:fs'; import path from 'node:path'; import http from 'node:http';
const REPO = String.raw`c:\Users\aarav\OneDrive\Desktop\Chatterbox Agent OS\agentos`;
const UP = path.join(REPO,'uploads','2026-08-06');
const SERVE={'/index.html':path.join(REPO,'nicks_code','index.html'),'/xlsx.full.min.js':path.join(REPO,'site','xlsx.full.min.js')};
const server=http.createServer((q,s)=>{const p=SERVE[q.url.split('?')[0]];
  if(!p){s.writeHead(404);s.end('nf');return} s.writeHead(200,{'Content-Type':p.endsWith('.js')?'text/javascript':'text/html'});fs.createReadStream(p).pipe(s)});
await new Promise(r=>server.listen(8130,'127.0.0.1',r));
const j=(...p)=>path.join(...p);
let pass=0,fail=0;const failures=[];
const ok=(n,c,d='')=>{if(c)pass++;else{fail++;failures.push(n+(d?' — '+d:''))}};
const br=await chromium.launch({args:['--js-flags=--max-old-space-size=8192']});
const pg=await br.newPage(); const errors=[]; pg.on('pageerror',e=>errors.push(e.message));
await pg.goto('http://127.0.0.1:8130/index.html',{waitUntil:'domcontentloaded'});
await pg.waitForFunction(()=>window.__mtd&&window.__mtd.state(),null,{timeout:30000});

// load real data so the model has dates to walk
await pg.setInputFiles('#fileInput',[j(UP,'Matrix - Agent List.xlsx'),j(UP,'attendance_2026-08-01_to_2026-08-06.csv'),
  j(UP,'BI Active - 05.08.xlsx'),j(UP,'BI Inactive - 05.08.xlsx')],{timeout:120000});
await pg.waitForFunction(()=>window.__mtd.state().files.length>=5,null,{timeout:300000});
let last=-1,st=0; for(let i=0;i<120;i++){ await pg.waitForTimeout(1500);
  const n=await pg.evaluate(()=>window.__mtd.state().files.length);
  if(n===last){ if(++st>=4)break } else {st=0;last=n} }
await pg.evaluate(()=>window.__mtd.setPeriod('2026-08','calendar'));
await pg.waitForTimeout(1200);
const before=await pg.evaluate(()=>({canc:Object.keys(window.__mtd.state().canc||{}).length,
  sales:Object.keys(window.__mtd.state().sales||{}).length}));
console.log('loaded:',JSON.stringify(before));
ok('data loaded', before.sales>0&&before.canc>0, JSON.stringify(before));

// Simulate hydrate(): take the CURRENT state, strip the stores added today (as an older
// cloud blob would be), then adopt it wholesale exactly as hydrate() does.
const res = await pg.evaluate(()=>{
  const S=window.__mtd.state();
  const blob=JSON.parse(JSON.stringify(S));
  delete blob.canc; delete blob.vici; delete blob.viciDays;   // an older cloud blob
  const missing=['canc','vici','viciDays'].filter(k=>!(k in blob));
  try{
    Object.keys(S).forEach(k=>delete S[k]);
    Object.assign(S,blob);
    rebuild(); renderAll();
    const M=window.__mtd.model();
    return {ok:true, missing, seeded:['canc','vici','viciDays'].filter(k=>S[k]&&typeof S[k]==='object'),
            dates:M.dates.length, sales:M.grand.sales};
  }catch(e){ return {ok:false, missing, err:String(e&&e.message||e)}; }
});
console.log('after adopting the old blob:',JSON.stringify(res));
ok('the blob genuinely lacked the new stores', res.missing.length===3, JSON.stringify(res.missing));
ok('adopting an older cloud blob does not throw', res.ok===true, res.err||'');
ok('normalizeState re-seeds every store added since', res.ok&&res.seeded.length===3, JSON.stringify(res.seeded||[]));
ok('the app still builds its model afterwards', res.ok&&res.dates>0, JSON.stringify(res.dates));

// and an upload must still work after the hydrate
await pg.setInputFiles('#fileInput',[j(UP,'BI Inactive - 05.08.xlsx')],{timeout:120000});
await pg.waitForTimeout(8000);
const after=await pg.evaluate(()=>{const S=window.__mtd.state();
  let t=0; for(const d in S.canc) for(const k in S.canc[d]) t+=S.canc[d][k]; return t;});
ok('cancellations can be uploaded again after a hydrate', after>0, `got ${after}`);

ok('no page errors', errors.length===0, errors.slice(0,3).join(' | '));
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
failures.forEach(f=>console.log('FAIL: '+f));
errors.slice(0,5).forEach(e=>console.log('  '+e));
await br.close(); server.close();
process.exit(fail||errors.length?1:0);
