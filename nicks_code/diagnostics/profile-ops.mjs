// Where does the Ops dashboard actually spend its time? Loads the real export set, then
// times every page render cold (first paint, caches empty) and warm (repeat).
// Run: node profile-ops.mjs
import { chromium } from 'playwright';
import fs from 'node:fs'; import path from 'node:path'; import http from 'node:http';
const REPO = path.resolve(process.cwd(), '..', '..');
const UP = path.join(REPO,'uploads','2026-08-02');
const SERVE={'/index.html':path.join(REPO,'Chatterbox_AgentOS_Analytics.html'),
  '/xlsx.full.min.js':path.join(REPO,'site','xlsx.full.min.js')};
const server=http.createServer((q,s)=>{const p=SERVE[q.url.split('?')[0]];
  if(!p){s.writeHead(404);s.end('nf');return}
  s.writeHead(200,{'Content-Type':p.endsWith('.js')?'text/javascript':'text/html'});fs.createReadStream(p).pipe(s)});
await new Promise(r=>server.listen(8132,'127.0.0.1',r));
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
const pg=await br.newPage({viewport:{width:1440,height:950}});
const errors=[]; pg.on('pageerror',e=>errors.push(e.message));
const t0=Date.now();
await pg.goto('http://127.0.0.1:8132/index.html',{waitUntil:'domcontentloaded'});
await pg.evaluate(()=>document.dispatchEvent(new Event('cbx-authed')));
await pg.waitForFunction(()=>window.state&&document.querySelector('#page')?.innerHTML.length>100,null,{timeout:60000});
console.log(`boot (empty): ${Date.now()-t0} ms`);

await pg.evaluate(()=>{state.route='uploads';render()});
console.log('loading '+FILES.length+' files…');
const tl=Date.now();
await pg.setInputFiles('input[type=file][multiple]',FILES,{timeout:180000});
await pg.waitForFunction(()=>document.querySelector('#modalBox .t')?.textContent.startsWith('Bulk upload'),null,{timeout:900000});
console.log(`  parse+detect: ${Date.now()-tl} ms`);
const ti=Date.now();
await pg.click('#modalBox .modal-foot .btn.primary');
await pg.waitForFunction(()=>document.querySelector('#modalBox .t')?.textContent.includes('done'),null,{timeout:900000});
await pg.evaluate(()=>closeModal());
console.log(`  ingest into state: ${Date.now()-ti} ms`);
const rows=await pg.evaluate(()=>Object.entries(state.facts).filter(([k,v])=>v.length).map(([k,v])=>k+'='+v.length).join(' '));
console.log('  rows: '+rows);

const pages=await pg.evaluate(()=>PAGES.map(p=>({id:p.id,label:p.label})));
const time=async(id)=>pg.evaluate(pid=>{const t=performance.now();state.route=pid;render();return Math.round(performance.now()-t)},id);

console.log('\npage                       cold ms   warm ms');
const results=[];
for(const p of pages){
  await pg.evaluate(()=>{ if(window._rfCache&&_rfCache.clear)_rfCache.clear(); });
  let cold=0,warm=0;
  try{ cold=await time(p.id); await pg.waitForTimeout(60); warm=await time(p.id); }
  catch(e){ cold=-1; }
  results.push({id:p.id,label:p.label,cold,warm});
  console.log(`  ${String(p.label).padEnd(24)} ${String(cold).padStart(7)} ${String(warm).padStart(9)}`);
}
results.sort((a,b)=>b.cold-a.cold);
console.log('\nslowest pages (cold):');
results.slice(0,5).forEach(r=>console.log(`  ${r.label.padEnd(24)} ${r.cold} ms`));

// how much of the slowest page is the shared agent-context build?
const ctxMs=await pg.evaluate(()=>{ if(window._rfCache&&_rfCache.clear)_rfCache.clear();
  const w=periodWindow(); const t=performance.now(); acCtx(w); return Math.round(performance.now()-t); });
console.log(`\nacCtx(win) alone, cold: ${ctxMs} ms  (shared by Executive, Brain, Scorecard, TL views)`);

// does the Visual Brain leave its animation running after you navigate away?
await pg.evaluate(()=>{state.route='brain';render()});
await pg.waitForTimeout(1200);
const during=await pg.evaluate(()=>new Promise(r=>{let n=0;const t=performance.now();
  const f=()=>{n++;if(performance.now()-t<1000)requestAnimationFrame(f);else r(n)};requestAnimationFrame(f)}));
await pg.evaluate(()=>{state.route='exec';render()});
await pg.waitForTimeout(1200);
const after=await pg.evaluate(()=>new Promise(r=>{let n=0;const t=performance.now();
  const f=()=>{n++;if(performance.now()-t<1000)requestAnimationFrame(f);else r(n)};requestAnimationFrame(f)}));
const canvasGone=await pg.evaluate(()=>!document.getElementById('brainCanvas'));
console.log(`\nframes/sec while ON the Brain: ${during}   after navigating away: ${after}   canvas removed: ${canvasGone}`);

if(errors.length) console.log('\npage errors: '+errors.slice(0,3).join(' | '));
await br.close(); server.close();