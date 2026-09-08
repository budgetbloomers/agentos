// ADVERSARIAL DUPLICATION AUDIT for VAS analytics.
// Deliberately tries to make the app count something twice: re-uploads, renamed copies,
// reversed upload order, overlapping ranges, a 5-day Vici pull against its own single days,
// duplicated rows inside a file, and a repeated agent on the roster.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

const REPO = process.env.AGENTOS || decodeURIComponent(new URL('../..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1').replace(/\/$/, '');   // repo-relative (2026-09-08): the laptop path failed every cloud run
const UP = path.join(REPO,'uploads','2026-08-06');
const S = process.cwd();
const SERVE={'/':path.join(REPO,'nicks_code','index.html'),'/index.html':path.join(REPO,'nicks_code','index.html'),
  '/xlsx.full.min.js':path.join(REPO,'site','xlsx.full.min.js')};
const server=http.createServer((q,s)=>{const p=SERVE[q.url.split('?')[0]];
  if(!p||!fs.existsSync(p)){s.writeHead(404);s.end('nf');return}
  s.writeHead(200,{'Content-Type':p.endsWith('.js')?'text/javascript':'text/html'});fs.createReadStream(p).pipe(s)});
await new Promise(r=>server.listen(8127,'127.0.0.1',r));
const j=(...p)=>path.join(...p);

// ---- fixtures -------------------------------------------------------------
const viciRaw = fs.readFileSync(j(UP,'Vici - Cuddle Agents - 3 - 5 Aug.csv'),'utf8');
const oneDay = d => viciRaw.replace('Time range: 2026-08-03 00:00:00 to 2026-08-05 23:59:59',
                                    `Time range: 2026-08-0${d} 00:00:00 to 2026-08-0${d} 23:59:59`);
fs.writeFileSync(j(S,'vici-03.csv'),oneDay(3));
fs.writeFileSync(j(S,'vici-04.csv'),oneDay(4));
fs.writeFileSync(j(S,'vici-05.csv'),oneDay(5));
fs.writeFileSync(j(S,'vici-range-copy.csv'),viciRaw);
// QA export with every row duplicated
{ const t=fs.readFileSync(j(UP,'evaluations-full-export-2026-08-06.csv'),'utf8').split(/\r?\n/);
  const head=t[0], body=t.slice(1).filter(l=>l.trim());
  fs.writeFileSync(j(S,'qa-doubled.csv'),[head,...body,...body].join('\n')); }
// Agent list with the first 4 VAS agents listed twice
{ const wb=XLSX.read(fs.readFileSync(j(UP,'Matrix - Agent List.xlsx')),{type:'buffer',cellDates:true});
  const vas=XLSX.utils.sheet_to_json(wb.Sheets['VAS'],{raw:true,defval:''});
  const dup=[...vas,...vas.slice(0,4)];
  const nb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(nb,XLSX.utils.json_to_sheet(dup),'VAS');
  XLSX.utils.book_append_sheet(nb,XLSX.utils.json_to_sheet(XLSX.utils.sheet_to_json(wb.Sheets['VT'],{raw:true,defval:''})),'VT');
  XLSX.writeFile(nb,j(S,'agents-dup.xlsx')); }
// Inactive file copied under a new name
fs.copyFileSync(j(UP,'BI Inactive - 05.08.xlsx'), j(S,'inactive-copy.xlsx'));
fs.copyFileSync(j(UP,'BI Active - 05.08.xlsx'),   j(S,'active-copy.xlsx'));
fs.copyFileSync(j(UP,'Call X Call report - 3 - 5.xlsx'), j(S,'callx-copy.xlsx'));

let pass=0,fail=0;const failures=[];
const ok=(n,c,d='')=>{if(c)pass++;else{fail++;failures.push(n+(d?' — '+d:''))}};

const browser=await chromium.launch({args:['--js-flags=--max-old-space-size=8192']});
const errors=[];
async function session(label, files){
  const page=await browser.newPage({viewport:{width:1400,height:900}});
  page.on('pageerror',e=>errors.push(label+': '+e.message));
  await page.goto('http://127.0.0.1:8127/index.html',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__mtd&&window.__mtd.state(),null,{timeout:30000});
  await page.evaluate(()=>{ try{ localStorage.clear(); }catch(e){}
    const S=window.__mtd.state();
    ['calls','sales','att','evals','tracker','canc','vici','viciDays'].forEach(k=>S[k]={});
    S.files=[]; S.roster=[]; });
  for(const batch of files){
    await page.setInputFiles('#fileInput', batch, {timeout:120000});
    let last=-1, stable=0;
    for(let i=0;i<200;i++){
      await page.waitForTimeout(1500);
      const n=await page.evaluate(()=>window.__mtd.state().files.length);
      if(n===last){ if(++stable>=5) break; } else { stable=0; last=n; }
    }
  }
  await page.evaluate(()=>window.__mtd.setPeriod('2026-08','calendar'));
  await page.waitForTimeout(1200);
  const out=await page.evaluate(()=>{
    const St=window.__mtd.state(), M=window.__mtd.model();
    const sum=(o,f)=>{let t=0;for(const d in o)for(const k in o[d])t+=f(o[d][k]);return t};
    let ev=0; for(const d in St.evals) for(const c in St.evals[d]) ev+=St.evals[d][c].length;
    return { roster:St.roster.length, rosterUniq:new Set(St.roster.map(a=>a.code)).size,
      talkH:+(sum(St.calls,b=>b.talk)/3600).toFixed(2), calls:sum(St.calls,b=>b.calls),
      cancRaw:sum(St.canc,v=>v), evals:ev,
      gwp:Math.round(sum(St.sales,o=>o.gwp)), sales:sum(St.sales,o=>o.n),
      mTalkH:+(M.facts.reduce((t,f)=>t+f.talk,0)/3600).toFixed(2),
      mSales:M.grand.sales, mGwp:Math.round(M.grand.gwp), mCanc:M.grand.canc,
      files:St.files.length };
  });
  await page.close();
  console.log(label.padEnd(34), JSON.stringify(out));
  return out;
}

const BASE=[j(UP,'Matrix - Agent List.xlsx'), j(UP,'attendance_2026-08-01_to_2026-08-06.csv'),
  j(UP,'BI Active - 05.08.xlsx'), j(UP,'BI Inactive - 05.08.xlsx'),
  j(UP,'Call X Call report - 3 - 5.xlsx'), j(UP,'evaluations-full-export-2026-08-06.csv')];

// 1. baseline
const base = await session('1 baseline', [BASE]);
// 2. same files again (the daily rhythm)
const twice = await session('2 same files twice', [BASE, BASE]);
ok('re-uploading the whole set changes nothing', JSON.stringify(twice)===JSON.stringify(base), 'differs');
// 3. renamed copies of every overlapping source
const renamed = await session('3 renamed copies', [BASE, [j(S,'inactive-copy.xlsx'), j(S,'active-copy.xlsx'), j(S,'callx-copy.xlsx')]]);
ok('renamed copies do not double GWP', renamed.gwp===base.gwp, `${base.gwp} -> ${renamed.gwp}`);
ok('renamed copies do not double cancellations', renamed.cancRaw===base.cancRaw, `${base.cancRaw} -> ${renamed.cancRaw}`);
ok('renamed copies do not double talk time', renamed.talkH===base.talkH, `${base.talkH} -> ${renamed.talkH}`);
// 4. reversed upload order
const rev = await session('4 reversed order', [[...BASE].reverse()]);
ok('upload order does not change the figures', rev.gwp===base.gwp && rev.cancRaw===base.cancRaw && rev.talkH===base.talkH,
   `gwp ${base.gwp}/${rev.gwp} canc ${base.cancRaw}/${rev.cancRaw} talk ${base.talkH}/${rev.talkH}`);
// 5. Vici: 5-day range only
const vRange = await session('5 vici range only', [[...BASE, j(UP,'Vici - Cuddle Agents - 3 - 5 Aug.csv')]]);
ok('vici range adds talk to the model', vRange.mTalkH>base.mTalkH, `${base.mTalkH} -> ${vRange.mTalkH}`);
// 6. Vici: range THEN its three single days
const vBoth = await session('6 range then single days', [[...BASE, j(UP,'Vici - Cuddle Agents - 3 - 5 Aug.csv')],
                                                         [j(S,'vici-03.csv'),j(S,'vici-04.csv'),j(S,'vici-05.csv')]]);
// 7. Vici: single days THEN the range
const vRev = await session('7 single days then range', [[...BASE, j(S,'vici-03.csv'),j(S,'vici-04.csv'),j(S,'vici-05.csv')],
                                                        [j(UP,'Vici - Cuddle Agents - 3 - 5 Aug.csv')]]);
ok('range + its own single days give the same answer either way', Math.abs(vBoth.mTalkH-vRev.mTalkH)<0.02,
   `range-first ${vBoth.mTalkH} vs days-first ${vRev.mTalkH}`);
const vDaysOnly = await session('7b single days only', [[...BASE, j(S,'vici-03.csv'),j(S,'vici-04.csv'),j(S,'vici-05.csv')]]);
ok('with day-level exports present the range contributes exactly nothing',
   Math.abs(vBoth.mTalkH-vDaysOnly.mTalkH)<0.02, `days-only ${vDaysOnly.mTalkH} vs days+range ${vBoth.mTalkH}`);
// 8. the same range uploaded twice under different names
const vDup = await session('8 range twice, renamed', [[...BASE, j(UP,'Vici - Cuddle Agents - 3 - 5 Aug.csv')],[j(S,'vici-range-copy.csv')]]);
ok('the same range twice does not double talk', Math.abs(vDup.mTalkH-vRange.mTalkH)<0.02, `${vRange.mTalkH} -> ${vDup.mTalkH}`);
// 9. a file whose rows are all duplicated
const qaDup = await session('9 QA with every row doubled', [[...BASE.slice(0,5), j(S,'qa-doubled.csv')]]);
ok('a QA export with every row duplicated scores each evaluation once', qaDup.evals===base.evals, `${base.evals} -> ${qaDup.evals}`);
// 10. an agent list that repeats agents
const rDup = await session('10 agent list with repeats', [[j(S,'agents-dup.xlsx'), ...BASE.slice(1)]]);
ok('a repeated agent appears on the roster once', rDup.roster===rDup.rosterUniq, `${rDup.roster} rows vs ${rDup.rosterUniq} codes`);
ok('repeated agents do not change the roster size', rDup.roster===base.roster, `${base.roster} -> ${rDup.roster}`);

// 11. ORDER: ViciDial day loaded BEFORE CallX for the same day - CallX must not wipe it
const vFirst = await session('11 vici day then CallX', [[j(UP,'Matrix - Agent List.xlsx'), j(S,'vici-03.csv')],
  [j(UP,'Call X Call report - 3 - 5.xlsx')]]);
const cFirst = await session('12 CallX then vici day', [[j(UP,'Matrix - Agent List.xlsx'), j(UP,'Call X Call report - 3 - 5.xlsx')],
  [j(S,'vici-03.csv')]]);
ok('loading CallX after ViciDial does not wipe the Cuddle floor', Math.abs(vFirst.talkH-cFirst.talkH)<0.02,
   `vici-first ${vFirst.talkH} vs callx-first ${cFirst.talkH}`);
ok('both diallers coexist on the same day', vFirst.talkH>349, `got ${vFirst.talkH}`);

ok('no page errors anywhere', errors.length===0, errors.slice(0,3).join(' | '));
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
failures.forEach(f=>console.log('FAIL: '+f));
errors.slice(0,6).forEach(e=>console.log('  '+e));
await browser.close(); server.close();
process.exit(fail||errors.length?1:0);
