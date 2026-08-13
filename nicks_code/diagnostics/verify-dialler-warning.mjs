// The failure Nick hit: sales and attendance loaded, dialler NOT loaded, so Ave Talk Time
// printed 0:00:00 and looked like real data. The screen must now say the days are missing.
import { chromium } from 'playwright';
import fs from 'node:fs'; import path from 'node:path'; import http from 'node:http';
const REPO = path.resolve(process.cwd(), '..', '..');
const UP = path.join(REPO,'uploads','2026-08-06');
const SERVE={'/index.html':path.join(REPO,'nicks_code','index.html'),'/xlsx.full.min.js':path.join(REPO,'site','xlsx.full.min.js')};
const server=http.createServer((q,s)=>{const p=SERVE[q.url.split('?')[0]];
  if(!p){s.writeHead(404);s.end('nf');return} s.writeHead(200,{'Content-Type':p.endsWith('.js')?'text/javascript':'text/html'});fs.createReadStream(p).pipe(s)});
await new Promise(r=>server.listen(8136,'127.0.0.1',r));
const j=(...p)=>path.join(...p);
let pass=0,fail=0;const failures=[];
const ok=(n,c,d='')=>{if(c)pass++;else{fail++;failures.push(n+(d?' — '+d:''))}};
const br=await chromium.launch({args:['--js-flags=--max-old-space-size=8192']});
const pg=await br.newPage(); const errors=[]; pg.on('pageerror',e=>errors.push(e.message));
await pg.goto('http://127.0.0.1:8136/index.html',{waitUntil:'domcontentloaded'});
await pg.waitForFunction(()=>window.__mtd&&window.__mtd.state(),null,{timeout:30000});
const settle=async n=>{ await pg.waitForFunction(c=>window.__mtd.state().files.length>=c,n,{timeout:600000});
  let l=-1,s=0; for(let i=0;i<200;i++){ await pg.waitForTimeout(1200);
    const x=await pg.evaluate(()=>window.__mtd.state().files.length); if(x===l){if(++s>=4)break}else{s=0;l=x} } };

// --- 1. Nick's situation: everything EXCEPT the dialler files
await pg.setInputFiles('#fileInput',[j(UP,'Matrix - Agent List.xlsx'),j(UP,'attendance_2026-08-01_to_2026-08-06.csv'),
  j(UP,'BI Active - 05.08.xlsx'),j(UP,'BI Inactive - 05.08.xlsx'),j(UP,'evaluations-full-export-2026-08-06.csv')],{timeout:180000});
await settle(5);
await pg.evaluate(()=>{window.__mtd.setPeriod('2026-08','calendar'); go('mtd')});
await pg.waitForTimeout(1500);
const noDial=await pg.evaluate(()=>{const M=window.__mtd.model();
  return {days:(M.noDialler||[]).length, banner:[...document.querySelectorAll('h3')].some(h=>/Talk time is incomplete/i.test(h.textContent)),
          text:([...document.querySelectorAll('.card')].map(c=>c.innerText).join(' ').match(/No dialler data for[^.]*\./)||[''])[0]}});
console.log('no dialler loaded ->',JSON.stringify(noDial));
ok('model flags the working days with no dialler data', noDial.days>0, String(noDial.days));
ok('the screen warns instead of silently showing 0:00:00', noDial.banner, 'no banner rendered');

// --- 2. load the dialler: the warning must clear for the covered days
await pg.setInputFiles('#fileInput',[j(UP,'Call X Call report - 3 - 5.xlsx')],{timeout:180000});
await settle(6);
await pg.evaluate(()=>{go('mtd')}); await pg.waitForTimeout(1200);
const withDial=await pg.evaluate(()=>{const M=window.__mtd.model();
  return {days:(M.noDialler||[]).length, talkDays:(M.talkDays?[...M.talkDays]:[]).sort(),
          banner:[...document.querySelectorAll('h3')].some(h=>/Talk time is incomplete/i.test(h.textContent))}});
console.log('after CallX ->',JSON.stringify(withDial));
ok('loading the dialler reduces the missing days', withDial.days<noDial.days, `${noDial.days} -> ${withDial.days}`);
ok('the days the file covers now carry talk', withDial.talkDays.length>=3, JSON.stringify(withDial.talkDays));

// --- 3. a multi-day ViciDial range only PARTLY inside the period is apportioned — and the
//        screen says so. (This used to assert the old behaviour, dropping the range whole
//        and banner-ing it as uncountable; apportioning replaced that and the suite was
//        never updated, so these two checks were failing against every commit since.)
await pg.setInputFiles('#fileInput',[j(UP,'Vici - Cuddle Agents - 3 - 5 Aug.csv')],{timeout:180000});
await settle(7);
await pg.evaluate(()=>{window.__mtd.setRange('2026-08-03','2026-08-04'); go('mtd')});
await pg.waitForTimeout(1200);
const part=await pg.evaluate(()=>{const M=window.__mtd.model();
  return {n:(M.viciPartial||[]).length, skippedN:(M.viciSkipped||[]).length,
          talk:M.facts.filter(f=>f.rangeAgg).reduce((t,f)=>t+f.talk,0),
          // share is 0<s<=1: an agent whose shifts all fell inside the window keeps the whole total (s=1)
          prov:M.facts.filter(f=>f.rangeAgg).every(f=>f.provisional&&f.apportioned>0&&f.apportioned<=1),
          banner:[...document.querySelectorAll('.card')].some(c=>/ViciDial export reaches beyond the period/i.test(c.innerText)&&/apportioned/i.test(c.innerText))}});
console.log('vici range vs narrow period ->',JSON.stringify(part));
ok('a partly-covered range is apportioned, not dropped', part.n===1&&part.talk>0, `partial=${part.n} talk=${part.talk}`);
ok('every apportioned row is marked provisional with its share', part.prov);
ok('and the screen says the talk is apportioned, not measured', part.banner, 'no apportioned banner');

// --- 4. a range wholly OUTSIDE the period is skipped — and the screen says why.
//        01–02 Aug: sales and attendance exist (so the MTD page renders), the Vici range 03–05
//        does not overlap at all. A window with NO data (say 06–06) renders the empty state
//        instead of the warning card, which is its own correct answer — not this test.
await pg.evaluate(()=>{window.__mtd.setRange('2026-08-01','2026-08-02'); go('mtd')});
await pg.waitForTimeout(1200);
const skipped=await pg.evaluate(()=>{const M=window.__mtd.model();
  return {n:(M.viciSkipped||[]).length,
          banner:[...document.querySelectorAll('.card')].some(c=>/ViciDial export could not be counted/i.test(c.innerText))}});
console.log('vici range wholly outside ->',JSON.stringify(skipped));
ok('a range the period covers none of is reported as skipped', skipped.n===1, String(skipped.n));
ok('and the screen explains why its talk is missing', skipped.banner, 'no vici banner');

ok('no page errors', errors.length===0, errors.slice(0,3).join(' | '));
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
failures.forEach(f=>console.log('FAIL: '+f));
errors.slice(0,4).forEach(e=>console.log('  '+e));
await br.close(); server.close();
process.exit(fail||errors.length?1:0);