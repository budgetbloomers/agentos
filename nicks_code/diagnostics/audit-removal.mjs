// Removal / cleanup audit: every uploaded source must be fully removable, and removing
// one file must never take another file's data with it.
import { chromium } from 'playwright';
import fs from 'node:fs'; import path from 'node:path'; import http from 'node:http';
const REPO = String.raw`c:\Users\aarav\OneDrive\Desktop\Chatterbox Agent OS\agentos`;
const UP = path.join(REPO,'uploads','2026-08-06'); const S=process.cwd();
const SERVE={'/index.html':path.join(REPO,'nicks_code','index.html'),'/xlsx.full.min.js':path.join(REPO,'site','xlsx.full.min.js')};
const server=http.createServer((q,s)=>{const p=SERVE[q.url.split('?')[0]];
  if(!p){s.writeHead(404);s.end('nf');return} s.writeHead(200,{'Content-Type':p.endsWith('.js')?'text/javascript':'text/html'});fs.createReadStream(p).pipe(s)});
await new Promise(r=>server.listen(8129,'127.0.0.1',r));
const j=(...p)=>path.join(...p);
let pass=0,fail=0;const failures=[];
const ok=(n,c,d='')=>{if(c)pass++;else{fail++;failures.push(n+(d?' — '+d:''))}};
const br=await chromium.launch({args:['--js-flags=--max-old-space-size=8192']});
const pg=await br.newPage(); const errors=[]; pg.on('pageerror',e=>errors.push(e.message));
pg.on('dialog',d=>d.accept());
await pg.goto('http://127.0.0.1:8129/index.html',{waitUntil:'domcontentloaded'});
await pg.waitForFunction(()=>window.__mtd&&window.__mtd.state(),null,{timeout:30000});
await pg.evaluate(()=>{try{localStorage.clear()}catch(e){};const S=window.__mtd.state();
  ['calls','sales','att','evals','tracker','cancRows','vici','viciDays','callsMeta'].forEach(k=>S[k]={});S.files=[];S.roster=[];});

const snap=()=>pg.evaluate(()=>{const St=window.__mtd.state();
  const sum=(o,f)=>{let t=0;for(const d in o)for(const k in o[d])t+=f(o[d][k]);return t};
  let ev=0; for(const d in St.evals) for(const c in St.evals[d]) ev+=St.evals[d][c].length;
  return {files:St.files.map(f=>f.type), talkH:+(sum(St.calls,b=>b.talk)/3600).toFixed(2),
    // cancellations are one entry per cancelled CONTRACT in S.cancRows (this suite read
    // S.canc, a store nothing has written for a long time, so it was counting 0)
    canc:Object.keys(St.cancRows||{}).length, evals:ev, gwp:Math.round(sum(St.sales,o=>o.gwp)),
    viciRanges:Object.keys(St.vici||{}).length, viciDays:Object.keys(St.viciDays||{}).length,
    // CallX agents on the day the ViciDial export also covers — the thing that must survive
    // when the Vici day is removed. Counting them beats an hours threshold, which drifts
    // every time the talk metric is redefined.
    callxOn03:Object.values((St.calls||{})['2026-08-03']||{}).filter(b=>b&&!b.v).length,
    attDays:Object.keys(St.att||{}).length};});
const load=async b=>{ await pg.setInputFiles('#fileInput',b,{timeout:120000});
  let last=-1,st=0; for(let i=0;i<200;i++){ await pg.waitForTimeout(1500);
    const n=await pg.evaluate(()=>window.__mtd.state().files.length);
    if(n===last){ if(++st>=5)break } else {st=0;last=n} } };
const removeByType=async pref=>{ await pg.evaluate(p=>{ const S=window.__mtd.state();
  const i=S.files.findIndex(f=>f.type.startsWith(p)); if(i>=0) removeFile(i); },pref);
  await pg.waitForTimeout(2500); };

const viciRaw=fs.readFileSync(j(UP,'Vici - Cuddle Agents - 3 - 5 Aug.csv'),'utf8');
fs.writeFileSync(j(S,'v03.csv'),viciRaw.replace('Time range: 2026-08-03 00:00:00 to 2026-08-05 23:59:59','Time range: 2026-08-03 00:00:00 to 2026-08-03 23:59:59'));

await load([j(UP,'Matrix - Agent List.xlsx'), j(UP,'attendance_2026-08-01_to_2026-08-06.csv'),
  j(UP,'BI Active - 05.08.xlsx'), j(UP,'BI Inactive - 05.08.xlsx'),
  j(UP,'Call X Call report - 3 - 5.xlsx'), j(UP,'evaluations-full-export-2026-08-06.csv'),
  j(S,'v03.csv')]);
const full=await snap(); console.log('loaded:',JSON.stringify(full));
ok('everything loaded', full.canc>0&&full.evals>0&&full.gwp>0&&full.talkH>0&&full.viciDays===1, JSON.stringify(full));

// remove the ViciDial day: CallX for that day must survive, the day must be released
await removeByType('calls (ViciDial)');
const noVici=await snap(); console.log('after removing vici day:',JSON.stringify(noVici));
ok('removing the ViciDial day drops its hours', noVici.talkH<full.talkH, `${full.talkH} -> ${noVici.talkH}`);
ok('removing the ViciDial day keeps the CallX day', noVici.callxOn03>0&&noVici.callxOn03===full.callxOn03,
   `CallX agents on 03 Aug: ${full.callxOn03} -> ${noVici.callxOn03}`);
ok('removing the ViciDial day releases it for a range', noVici.viciDays===0, `${noVici.viciDays}`);
ok('removing the ViciDial day touches nothing else', noVici.canc===full.canc&&noVici.evals===full.evals&&noVici.gwp===full.gwp,
   `canc ${noVici.canc} evals ${noVici.evals} gwp ${noVici.gwp}`);

// remove the cancellations file
await removeByType('cancellations');
const noCanc=await snap(); console.log('after removing cancellations:',JSON.stringify(noCanc));
ok('cancellations are fully removable', noCanc.canc===0, `${noCanc.canc} left behind`);
/* Sales and GWP are GROSS of cancellation, so the Inactive file is part of the money: taking
   it away must take its gross-up with it — cleanly, and only that. GWP falls back to the
   Active-only figure; nothing else moves. (Before the gross-up this asserted GWP unchanged.) */
ok('removing cancellations leaves calls and QA alone', noCanc.evals===full.evals&&noCanc.talkH===noVici.talkH,
   `evals ${noCanc.evals} talk ${noCanc.talkH}`);
ok('removing cancellations releases the gross-up it contributed', noCanc.gwp>0&&noCanc.gwp<full.gwp,
   `${full.gwp} -> ${noCanc.gwp}`);
await load([j(UP,'BI Inactive - 05.08.xlsx')]);
const reCanc=await snap();
ok('re-adding the cancellations file restores exactly the same gross GWP', reCanc.gwp===full.gwp&&reCanc.canc===full.canc,
   `${full.gwp}/${full.canc} -> ${reCanc.gwp}/${reCanc.canc}`);

// a multi-day range, then remove it
await load([j(UP,'Vici - Cuddle Agents - 3 - 5 Aug.csv')]);
const withRange=await snap();
ok('multi-day range stored', withRange.viciRanges===1, `${withRange.viciRanges}`);
await removeByType('vici range');
const noRange=await snap(); console.log('after removing the range:',JSON.stringify(noRange));
ok('a ViciDial range is fully removable', noRange.viciRanges===0, `${noRange.viciRanges} left behind`);

// clear-all must leave nothing behind
await pg.evaluate(()=>{const St=window.__mtd.state();
  ['sales','calls','att','evals','tracker','cancRows','vici','viciDays','callsMeta'].forEach(k=>St[k]={});St.files=[];St.opencases=null;
  save();rebuild();});
await pg.waitForTimeout(1500);
const cleared=await snap();
ok('clear-all leaves no cancellations or ViciDial data', cleared.canc===0&&cleared.viciRanges===0&&cleared.viciDays===0&&cleared.talkH===0,
   JSON.stringify(cleared));

// an Open Cases file is recognised and refused, not silently stored
await load([j(UP,'Matrix - Agent List.xlsx')]);
const before=await snap();
const oc=path.join(REPO,'uploads','2026-08-02','Open Cases','SF Open Cases - Current.xls');
if(fs.existsSync(oc)){ await load([oc]);
  const after=await snap();
  ok('an Open Cases export is not stored as VAS data', JSON.stringify(after.files)===JSON.stringify(before.files),
     JSON.stringify(after.files)); }
else ok('open-cases fixture present', false, 'fixture missing');

ok('no page errors', errors.length===0, errors.slice(0,3).join(' | '));
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
failures.forEach(f=>console.log('FAIL: '+f));
errors.slice(0,5).forEach(e=>console.log('  '+e));
await br.close(); server.close();
process.exit(fail||errors.length?1:0);
