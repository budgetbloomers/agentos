/* EVERY PAGE ACTUALLY RENDERS, with real data loaded.
 *
 * The other suites drive the model and read numbers out of it; none of them ever look at a
 * page. That gap is not theoretical — it hid a crash on the Adjustments tab for as long as
 * the cancellations store was called `S.canc`, because the only place still reading the old
 * name was a template string that nothing exercised. The model was perfect. The page was
 * blank.
 *
 * So: load a real drop, walk all fourteen tabs, open the agent drawer, and fail on the first
 * uncaught error. Also asserts that the historical-attribution UI is on screen — the team
 * leader movement register and the "effective from" control — because a rule the operator
 * cannot see is a rule they will contradict.
 *
 * Run: node verify-render.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

const REPO = String.raw`c:\Users\aarav\OneDrive\Desktop\Chatterbox Agent OS\agentos`;
const HTML = process.env.PULSE_HTML ? path.resolve(REPO, process.env.PULSE_HTML)
                                    : path.join(REPO, 'nicks_code', 'index.html');
const UP = path.join(REPO,'uploads','2026-08-06');
const SERVE={'/':HTML,'/index.html':HTML,'/xlsx.full.min.js':path.join(REPO,'site','xlsx.full.min.js')};
const server=http.createServer((q,s)=>{ const p=SERVE[q.url.split('?')[0]];
  if(!p||!fs.existsSync(p)){s.writeHead(404);s.end('nf');return}
  s.writeHead(200,{'Content-Type':p.endsWith('.js')?'text/javascript':'text/html'});
  fs.createReadStream(p).pipe(s)});
await new Promise(r=>server.listen(8139,'127.0.0.1',r));

let pass=0, fail=0; const failures=[];
const ok=(n,c,d='')=>{ if(c){pass++; console.log('  ok   '+n);} else {fail++; failures.push(n+(d?' — '+d:'')); console.log('  FAIL '+n+(d?' — '+d:''));} };

const browser=await chromium.launch({args:['--js-flags=--max-old-space-size=8192']});
const page=await browser.newPage({viewport:{width:1400,height:900}});
const errors=[]; let stage='boot';
page.on('pageerror',e=>errors.push(stage+': '+e.message));
await page.goto('http://127.0.0.1:8139/index.html',{waitUntil:'domcontentloaded'});
await page.waitForFunction(()=>window.__mtd&&window.__mtd.state(),null,{timeout:30000});
await page.evaluate(()=>{ try{localStorage.clear()}catch(e){}
  const S=window.__mtd.state();
  ['calls','callsMeta','sales','att','evals','tracker','cancRows','vici','viciDays','orgHist'].forEach(k=>S[k]={});
  S.files=[]; S.roster=[]; S.ui.asAt=''; });

const j=f=>path.join(UP,f);
stage='upload';
await page.setInputFiles('#fileInput',[j('Matrix - Agent List.xlsx'),j('attendance_2026-08-01_to_2026-08-06.csv'),
  j('BI Active - 05.08.xlsx'),j('BI Inactive - 05.08.xlsx'),j('evaluations-full-export-2026-08-06.csv')],{timeout:180000});
/* 1,5s x 5 — the settle window audit-dupes uses. A tighter one reads as stable during the
   pause while the 4,6 MB QA export parses, the model is then built from half a drop, and the
   failure lands somewhere else entirely: an agent with no facts is absent from M.agents, so
   the drawer renders empty and the history checks fail for a reason that is not real. */
let last=-1,stable=0;
for(let i=0;i<200;i++){ await page.waitForTimeout(1500);
  const n=await page.evaluate(()=>window.__mtd.state().files.length);
  if(n===last){ if(++stable>=5) break; } else { stable=0; last=n; } }

/* Move somebody, through the real recording path, so the movement UI has something to draw.
   A second agent list is the honest way to do it — same code path a reorganisation takes. */
let moved=null;
try{
  moved=await page.evaluate(()=>{
    /* Pick an agent the MODEL actually holds, not merely one on the roster: drawerHTML looks
       the code up in M.agents and returns an empty string when it is not there, which is a
       blank drawer rather than an error and reads as a content failure. */
    const S=window.__mtd.state(), M=window.__mtd.model();
    const a=(M.agents||[]).find(x=>x.tl&&M.primaryCamp[x.code]==='Courtesy')||(M.agents||[])[0];
    if(!a) throw new Error('the model holds no agents — the drop did not load');
    const r=S.roster.find(x=>x.code===a.code)||a;
    window.recordOrg(a.code,'2026-08-04',{tl:'Someone Else',campaign:r.campaign||'Courtesy',tenure:r.tenure||''},'agent-list');
    window.__mtd.rebuild();
    return a.code;
  });
}catch(e){ ok('the build records organisational movements at all', false, e.message.split('\n')[0]); }
if(!moved) moved=await page.evaluate(()=>window.__mtd.state().roster[0].code);

const TABS=['dashboard','mtd','weekly','daily','pivot','attend','variance','agents','leaderboard','coaching','compare','manual','data','adjust','settings'];
const text={};
for(const t of TABS){
  stage='tab:'+t;
  const before=errors.length;
  await page.evaluate(x=>window.__mtd.go(x),t);
  await page.waitForTimeout(350);
  text[t]=await page.evaluate(()=>document.body.innerText);
  ok('the '+t+' page renders without error', errors.length===before, errors.slice(before).join(' | '));
  ok('the '+t+' page is not blank', (text[t]||'').length>200, (text[t]||'').length+' chars');
}

const anywhere=s=>Object.values(text).some(v=>v.includes(s));
ok('the team leader movement register is on screen', anywhere('Team leader movements'));
ok('the agent list carries an "effective from" control', anywhere('Snapshot effective from'));
ok('the register explains that a move never rewrites a reported month',
   anywhere('on the day the work happened'));

stage='drawer';
const before=errors.length;
await page.evaluate(c=>window.openDrawer(c), moved);
await page.waitForTimeout(700);
const dr=await page.evaluate(()=>{const d=document.getElementById('drawer');return d?d.innerText:''});
ok('the agent drawer opens without error', errors.length===before, errors.slice(before).join(' | '));
ok('the drawer shows the agent\'s team history', dr.includes('Team history'), dr.slice(0,140));
ok('the drawer separates who they worked under from who they report to now',
   /\(now /.test(dr), dr.split('\n').slice(0,4).join(' / '));

ok('no page errors anywhere', errors.length===0, errors.slice(0,3).join(' | '));
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
failures.forEach(f=>console.log('FAIL: '+f));
await browser.close(); server.close();
process.exit(fail?1:0);