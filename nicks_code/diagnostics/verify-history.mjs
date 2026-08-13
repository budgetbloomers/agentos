/* THE THREE-MONTH HISTORICAL ATTRIBUTION SIMULATION.
 *
 * One question, asked three ways: does moving an agent to a new team leader today change
 * what last month's report says? It must not. An agent who made 100 sales under Leader
 * Alpha in June still made them under Leader Alpha when you look in July, in August, and
 * in any month after that — however many times the org chart has been redrawn since.
 *
 * The failure this guards against is silent and total. The Agent List is a live snapshot
 * with no effective-date column; read history off it and every past month re-attributes
 * itself the moment the floor reorganises, with nothing on screen to say it happened. The
 * numbers still add up. They are just paid to the wrong person.
 *
 * Synthetic data, deliberately: the shape of the scenario (exactly one move, exactly 100
 * sales, one agent who stays either side of it as a control) is the whole point, and real
 * exports cannot be made to hold still like that. Every file below is written in the real
 * export's header contract, so it goes through the same detectType/INGEST path as a live
 * drop — the fixtures are synthetic, the code path is not.
 *
 * Run: node verify-history.mjs        (or PULSE_HTML=site/pulse/index.html node verify-history.mjs)
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

const REPO = String.raw`c:\Users\aarav\OneDrive\Desktop\Chatterbox Agent OS\agentos`;
const HTML = process.env.PULSE_HTML ? path.resolve(REPO, process.env.PULSE_HTML)
                                    : path.join(REPO, 'nicks_code', 'index.html');
const FIX = path.join(process.cwd(), 'simfix');
fs.mkdirSync(FIX, { recursive: true });

const SERVE = { '/': HTML, '/index.html': HTML, '/xlsx.full.min.js': path.join(REPO,'site','xlsx.full.min.js') };
const server = http.createServer((q,s)=>{ const p=SERVE[q.url.split('?')[0]];
  if(!p||!fs.existsSync(p)){ s.writeHead(404); s.end('nf'); return; }
  s.writeHead(200,{'Content-Type':p.endsWith('.js')?'text/javascript':'text/html'});
  fs.createReadStream(p).pipe(s); });
await new Promise(r=>server.listen(8131,'127.0.0.1',r));

/* ---------- the cast ----------------------------------------------------- */
const TLA='Leader Alpha', TLB='Leader Bravo';
/* CB901-903 deliberately sit outside the rule book's excludeAgents list (CB67/205/265) and
   outside every real employee code, so a stale roster in the blob cannot collide with them. */
const MOVER  = { code:'CB901', name:'Mover Mokoena' };
const STAYA  = { code:'CB902', name:'Anchor Alphason' };   // never leaves Alpha — the control
const STAYB  = { code:'CB903', name:'Anchor Bravoson' };   // always was Bravo's
const CAST=[MOVER,STAYA,STAYB];

// Month 1 = June (mover under Alpha) · Month 2 = July (moved to Bravo) · Month 3 = August
const M1='2026-06', M2='2026-07', M3='2026-08';
const DAYS={ [M1]:['2026-06-02','2026-06-03','2026-06-04','2026-06-05'],
             [M2]:['2026-07-01','2026-07-02','2026-07-03','2026-07-06'],
             [M3]:['2026-08-03','2026-08-04','2026-08-05','2026-08-06'] };
// the mover's sales per month — 100 in month 1 is the spec's own number
const SALES={ [M1]:{CB901:100, CB902:30, CB903:20},
              [M2]:{CB901:40,  CB902:28, CB903:24},
              [M3]:{CB901:55,  CB902:26, CB903:22} };
const CHARGE=86.08;                       // x1,15 = 98,992 -> R99 per account, rounded per account
const GWP_PER_SALE=99;

/* ---------- fixture writers (real header contracts) ---------------------- */
const csv=(rows)=>rows.map(r=>r.map(v=>{
  const s=String(v??'');
  return /[",\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s;
}).join(',')).join('\n')+'\n';
const w=(f,text)=>{ const p=path.join(FIX,f); fs.writeFileSync(p,text); return p; };

/* The Agent List. Its filename carries the date the snapshot describes — that is what
   turns a live roster into a dated observation, and it is the only reason a later list can
   move an agent without dragging their history along. */
function rosterFile(fname, tlOf){
  const head=['Sales Force','Start Date','Team Leader','Campaign','Agent Name','Employee Code','Tenure','Call x','Target'];
  const rows=CAST.map(a=>[a.name,'2026-01-05',tlOf(a.code),'Courtesy',a.name,a.code,'Exp',a.name+' '+a.code,5]);
  return w(fname, csv([head,...rows]));
}

/* Power BI - Active Cases. One row per account; Contract Deactivate Date empty on every row
   is what tells detectType this is Active rather than the Inactive/cancellations export. */
function biFile(fname, month, counts, accPrefix){
  const head=['Account Number','Contract Status','Owner','Contract Create Date','Contract Deactivate Date','Charge Amount','Charge Code'];
  const rows=[]; const days=DAYS[month];
  for(const a of CAST){
    const n=counts[a.code]||0;
    for(let i=0;i<n;i++){
      const d=days[i%days.length];
      rows.push([accPrefix+a.code.slice(2)+String(i).padStart(4,'0'),'Active',a.name,d+'T00:00:00','',CHARGE,'MYP C35']);
    }
  }
  return w(fname, csv([head,...rows]));
}

// HR attendance register — Employee Type must read "Call Agent" or the row is dropped as support staff
function attFile(fname, month){
  const head=['Date','Employee Code','Employee Name','Employee Type','Status Code','Status'];
  const rows=[];
  for(const d of DAYS[month]) for(const a of CAST) rows.push([d,a.code,a.name,'Call Agent','P','Present']);
  return w(fname, csv([head,...rows]));
}

// QA export — Record ID is the evaluation's identity and the key the merge dedupes on
function qaFile(fname, month, perAgent, idPrefix){
  const head=['Record ID','Date of Call','Campaign','QA Agent','Sales Agent','Sales Agent CB','Score %','Escalation Decision','Status','Dispute Count','Dispute Status'];
  const rows=[]; const days=DAYS[month];
  for(const a of CAST) for(let i=0;i<perAgent;i++)
    rows.push([idPrefix+a.code+'-'+i, days[i%days.length],'Matrix Courtesy','QA Bot',a.name,a.code.replace('CB','CB-'),
               String(80+(i%15))+'%','Pass','Risk Mitigated','0','']);
  return w(fname, csv([head,...rows]));
}

const F={
  rosterM1: rosterFile('Matrix - Agent List 2026-06-01.csv', c=>c===STAYB.code?TLB:TLA),
  // the ONE movement in the whole simulation: the mover joins Bravo on 1 July
  rosterM2: rosterFile('Matrix - Agent List 2026-07-01.csv', c=>c===STAYA.code?TLA:TLB),
  /* A list with NO date in its name — the case the "effective from" control exists for.
     Everyone is Bravo's on it, so it moves the month-1-and-2 control agent as well. */
  rosterLate: rosterFile('Matrix - Agent List reissued.csv', ()=>TLB),
};
for(const m of [M1,M2,M3]){
  F['bi'+m]=biFile(`BI Active ${m}.csv`, m, SALES[m], m.replace('-',''));
  F['att'+m]=attFile(`attendance ${m}.csv`, m);
  F['qa'+m]=qaFile(`evaluations ${m}.csv`, m, 4, 'E'+m+'-');
}
// a re-pull of month 1's money under a different name — same accounts, same values
F.biM1copy = biFile('BI Active 2026-06 re-pull.csv', M1, SALES[M1], M1.replace('-',''));
/* An overlapping export: month 2's window PLUS two days of month 3, exactly the "upload
   27 Jul - 5 Aug, then upload 1 - 5 Aug" case. Every account it repeats is already stored. */
{
  const head=['Account Number','Contract Status','Owner','Contract Create Date','Contract Deactivate Date','Charge Amount','Charge Code'];
  const rows=[];
  const push=(month,counts,prefix,days)=>{ for(const a of CAST){ const n=counts[a.code]||0;
    for(let i=0;i<n;i++){ const d=days[i%days.length];
      rows.push([prefix+a.code.slice(2)+String(i).padStart(4,'0'),'Active',a.name,d+'T00:00:00','',CHARGE,'MYP C35']); } } };
  push(M2,SALES[M2],M2.replace('-',''),DAYS[M2]);          // already stored — must not duplicate
  push(M3,SALES[M3],M3.replace('-',''),DAYS[M3]);          // already stored — must not duplicate
  F.biOverlap = w('BI Active 2026-07 to 2026-08 overlap.csv', csv([head,...rows]));
}
/* The same export with ONE account's charge corrected upward. An update, not an addition:
   the account is already stored, so the sale count must hold and only the money may move. */
{
  const lines=fs.readFileSync(F['bi'+M3],'utf8').split('\n');
  lines[1]=lines[1].replace(','+CHARGE+',', ',173.91,');   // x1,15 -> R200, i.e. +R101
  F.biM3corrected = w('BI Active 2026-08 corrected.csv', lines.join('\n'));
}
// month 3's QA re-pulled with a different filter: only half the evaluations, same Record IDs
{
  const t=fs.readFileSync(F['qa'+M3],'utf8').split(/\r?\n/).filter(l=>l.trim());
  F.qaM3partial = w('evaluations 2026-08 partial.csv', [t[0],...t.slice(1).filter((_,i)=>i%2===0)].join('\n')+'\n');
}

/* ---------- harness ------------------------------------------------------ */
let pass=0, fail=0; const failures=[];
const ok=(n,c,d='')=>{ if(c){pass++; console.log('  ok   '+n);} else {fail++; failures.push(n+(d?' — '+d:'')); console.log('  FAIL '+n+(d?' — '+d:''));} };

const browser=await chromium.launch({args:['--js-flags=--max-old-space-size=8192']});
const page=await browser.newPage({viewport:{width:1400,height:900}});
const errors=[];
page.on('pageerror',e=>errors.push(e.message));
await page.goto('http://127.0.0.1:8131/index.html',{waitUntil:'domcontentloaded'});
await page.waitForFunction(()=>window.__mtd&&window.__mtd.state(),null,{timeout:30000});
await page.evaluate(()=>{ try{ localStorage.clear(); }catch(e){}
  const S=window.__mtd.state();
  ['calls','callsMeta','sales','att','evals','tracker','cancRows','vici','viciDays','orgHist'].forEach(k=>S[k]={});
  S.files=[]; S.roster=[]; S.ui.asAt=''; });

async function upload(files){
  await page.setInputFiles('#fileInput', files, {timeout:120000});
  let last=-1, stable=0;
  for(let i=0;i<120;i++){
    await page.waitForTimeout(400);
    const n=await page.evaluate(()=>window.__mtd.state().files.length);
    if(n===last){ if(++stable>=4) break; } else { stable=0; last=n; }
  }
}
// read the month exactly as the dashboard reports it
async function report(month){
  await page.evaluate(m=>window.__mtd.setPeriod(m,'calendar'), month);
  await page.waitForTimeout(400);
  return page.evaluate(()=>{
    const M=window.__mtd.model(), S=window.__mtd.state();
    const byTL={}, byAgentTL={};
    for(const f of M.facts){
      byTL[f.tl]=(byTL[f.tl]||0)+f.sales;
      const k=f.code+'|'+f.tl; byAgentTL[k]=(byAgentTL[k]||0)+f.sales;
    }
    let evals=0; for(const d in S.evals) for(const c in S.evals[d]) evals+=S.evals[d][c].length;
    return { byTL, byAgentTL, sales:M.grand.sales, gwp:Math.round(M.grand.gwp),
      tlAgg:Object.fromEntries(Object.entries(M.tlAgg).map(([k,v])=>[k,v.sales])),
      rowTL:Object.fromEntries(Object.entries(M.mtdCC.Courtesy||{}).map(([c,o])=>[c,o.tl])),
      tlMoved:M.tlMoved, orgHist:S.orgHist, files:S.files.length, evals,
      accounts:(()=>{let n=0;for(const d in S.sales)for(const o in S.sales[d])n+=Object.keys(S.sales[d][o].a||{}).length;return n;})() };
  });
}
const tl=(r,who)=>r.byTL[who]||0;
const agentUnder=(r,code,who)=>r.byAgentTL[code+'|'+who]||0;

/* ======================= MONTH 1 ======================================== */
console.log('\n— Month 1: the mover is Alpha\'s, and sells 100 —');
await upload([F.rosterM1, F['att'+M1], F['bi'+M1], F['qa'+M1]]);
const m1 = await report(M1);
ok('Month 1 shows Leader Alpha with the mover\'s 100 sales',
   agentUnder(m1,MOVER.code,TLA)===100, `got ${agentUnder(m1,MOVER.code,TLA)}`);
ok('Month 1 gives Leader Bravo none of them',
   agentUnder(m1,MOVER.code,TLB)===0, `got ${agentUnder(m1,MOVER.code,TLB)}`);
ok('Month 1 team totals are Alpha 130 / Bravo 20',
   tl(m1,TLA)===130 && tl(m1,TLB)===20, `Alpha ${tl(m1,TLA)} Bravo ${tl(m1,TLB)}`);
ok('the mover\'s Month 1 row names Leader Alpha', m1.rowTL[MOVER.code]===TLA, `got ${m1.rowTL[MOVER.code]}`);
ok('Month 1 GWP is 150 sales at R99', m1.gwp===150*GWP_PER_SALE, `got ${m1.gwp}`);

/* ======================= MONTH 2 — THE MOVE ============================= */
console.log('\n— Month 2: the mover joins Bravo, and Month 1 must not notice —');
await upload([F.rosterM2, F['att'+M2], F['bi'+M2], F['qa'+M2]]);
const m1after = await report(M1);
ok('MONTH 1 STILL SHOWS LEADER ALPHA — 100 SALES',
   agentUnder(m1after,MOVER.code,TLA)===100, `got ${agentUnder(m1after,MOVER.code,TLA)}`);
ok('Leader Bravo did NOT inherit the Month 1 sales',
   agentUnder(m1after,MOVER.code,TLB)===0, `got ${agentUnder(m1after,MOVER.code,TLB)}`);
ok('every Month 1 figure is byte-identical to before the move',
   JSON.stringify(m1after.byTL)===JSON.stringify(m1.byTL) && m1after.gwp===m1.gwp,
   `${JSON.stringify(m1.byTL)} -> ${JSON.stringify(m1after.byTL)}`);
ok('the mover\'s Month 1 row still names Leader Alpha', m1after.rowTL[MOVER.code]===TLA, `got ${m1after.rowTL[MOVER.code]}`);

const m2 = await report(M2);
ok('Month 2 activity is attributed to Leader Bravo',
   agentUnder(m2,MOVER.code,TLB)===40, `got ${agentUnder(m2,MOVER.code,TLB)}`);
ok('Month 2 gives Leader Alpha none of the mover\'s new sales',
   agentUnder(m2,MOVER.code,TLA)===0, `got ${agentUnder(m2,MOVER.code,TLA)}`);
ok('the control who never moved stays with Alpha in both months',
   agentUnder(m1after,STAYA.code,TLA)===30 && agentUnder(m2,STAYA.code,TLA)===28,
   `m1 ${agentUnder(m1after,STAYA.code,TLA)} m2 ${agentUnder(m2,STAYA.code,TLA)}`);
ok('the agent who was always Bravo\'s is never credited to Alpha',
   agentUnder(m1after,STAYB.code,TLA)===0 && agentUnder(m2,STAYB.code,TLA)===0);
ok('the movement is on record with its effective date',
   (m2.orgHist[MOVER.code]||[]).length===2 && m2.orgHist[MOVER.code][1].d==='2026-07-01',
   JSON.stringify(m2.orgHist[MOVER.code]));
ok('the agent changed team leader AT MOST ONCE in the period',
   (m2.orgHist[MOVER.code]||[]).filter((s,i,l)=>i>0&&s.tl!==l[i-1].tl).length===1);
ok('nobody else has a movement on record',
   (m2.orgHist[STAYA.code]||[]).length===1 && (m2.orgHist[STAYB.code]||[]).length===1,
   `${(m2.orgHist[STAYA.code]||[]).length}/${(m2.orgHist[STAYB.code]||[]).length}`);

/* ======================= MONTH 3 ======================================== */
console.log('\n— Month 3: looking back from further away —');
await upload([F['att'+M3], F['bi'+M3], F['qa'+M3]]);
const m3 = await report(M3);
ok('Month 3 activity is attributed to Leader Bravo',
   agentUnder(m3,MOVER.code,TLB)===55, `got ${agentUnder(m3,MOVER.code,TLB)}`);
const m1fromM3 = await report(M1);
ok('VIEWED FROM MONTH 3, MONTH 1 IS STILL LEADER ALPHA — 100 SALES',
   agentUnder(m1fromM3,MOVER.code,TLA)===100 && agentUnder(m1fromM3,MOVER.code,TLB)===0,
   `Alpha ${agentUnder(m1fromM3,MOVER.code,TLA)} Bravo ${agentUnder(m1fromM3,MOVER.code,TLB)}`);
ok('no historical sale has moved between team leaders at any point',
   JSON.stringify(m1fromM3.byTL)===JSON.stringify(m1.byTL),
   `${JSON.stringify(m1.byTL)} -> ${JSON.stringify(m1fromM3.byTL)}`);
ok('the mover\'s Month 1 report flags that they now report elsewhere',
   (m1fromM3.tlMoved||[]).some(x=>x.code===MOVER.code&&x.was===TLA&&x.now===TLB),
   JSON.stringify(m1fromM3.tlMoved));
ok('Month 3\'s own report does NOT flag them as moved (they are Bravo\'s now)',
   !(m3.tlMoved||[]).some(x=>x.code===MOVER.code), JSON.stringify(m3.tlMoved));

/* re-uploading TODAY'S agent list — the daily rhythm — must change nothing at all */
await upload([F.rosterM2]);
const m1again = await report(M1);
ok('re-uploading the current agent list does not touch Month 1',
   JSON.stringify(m1again.byTL)===JSON.stringify(m1.byTL), JSON.stringify(m1again.byTL));
ok('re-uploading the current agent list adds no phantom movement',
   (m1again.orgHist[MOVER.code]||[]).length===2, JSON.stringify(m1again.orgHist[MOVER.code]));

/* ======================= INCREMENTAL / DEDUPE =========================== */
console.log('\n— The uploads stay incremental —');
const before = await report(M3);
const beforeM1 = await report(M1), beforeM2 = await report(M2);

await upload([F['bi'+M1], F['bi'+M2], F['bi'+M3], F['att'+M1], F['qa'+M3]]);
const reUp1=await report(M1), reUp2=await report(M2), reUp3=await report(M3);
ok('re-uploading the same files produces zero additional records',
   reUp1.sales===beforeM1.sales && reUp2.sales===beforeM2.sales && reUp3.sales===before.sales
   && reUp3.accounts===before.accounts && reUp3.evals===before.evals,
   `sales ${beforeM1.sales}/${beforeM2.sales}/${before.sales} -> ${reUp1.sales}/${reUp2.sales}/${reUp3.sales}, accounts ${before.accounts}->${reUp3.accounts}, evals ${before.evals}->${reUp3.evals}`);

await upload([F.biM1copy]);
const renamed=await report(M1);
ok('the same export under a different name does not double anything',
   renamed.sales===beforeM1.sales && renamed.gwp===beforeM1.gwp,
   `${beforeM1.sales}/${beforeM1.gwp} -> ${renamed.sales}/${renamed.gwp}`);

await upload([F.biOverlap]);
const ov2=await report(M2), ov3=await report(M3);
ok('an overlapping date range adds only genuinely new records',
   ov2.sales===beforeM2.sales && ov3.sales===before.sales,
   `M2 ${beforeM2.sales}->${ov2.sales}, M3 ${before.sales}->${ov3.sales}`);

await upload([F.biM3corrected]);
const corrected=await report(M3);
ok('a corrected record UPDATES its own version rather than joining it',
   corrected.sales===before.sales && corrected.gwp===before.gwp+101,
   `sales ${before.sales}->${corrected.sales}, gwp ${before.gwp}->${corrected.gwp} (expected +101)`);

await upload([F.qaM3partial]);
const qaPartial=await report(M3);
ok('a narrower QA re-pull does not delete the evaluations it left out',
   qaPartial.evals===before.evals, `${before.evals} -> ${qaPartial.evals}`);

const m1final=await report(M1);
ok('after every re-upload, Month 1 is still Leader Alpha — 100 sales',
   agentUnder(m1final,MOVER.code,TLA)===100 && agentUnder(m1final,MOVER.code,TLB)===0
   && JSON.stringify(m1final.byTL)===JSON.stringify(m1.byTL),
   JSON.stringify(m1final.byTL));

/* ======================= DETERMINISM ==================================== */
console.log('\n— The same answer from a clean start, in a different order —');
const expect1=m1.byTL, expect2=(await report(M2)).byTL, expect3=(await report(M3)).byTL;
await page.evaluate(()=>{ const S=window.__mtd.state();
  ['calls','callsMeta','sales','att','evals','tracker','cancRows','vici','viciDays','orgHist'].forEach(k=>S[k]={});
  S.files=[]; S.roster=[]; window.__mtd.rebuild(); });
// month 3's data first, month 1's last, and the CURRENT agent list before any of it
await upload([F.rosterM2]);
await upload([F['att'+M3], F['bi'+M3]]);
await upload([F['att'+M2], F['bi'+M2]]);
await upload([F.rosterM1, F['att'+M1], F['bi'+M1]]);
const r1=await report(M1), r2=await report(M2), r3=await report(M3);
/* Loading the months backwards is the hard case: at the moment month 1's money arrives the
   app already believes the mover is Bravo's. Only the dated history can put those sales
   back under Alpha — and the July list, uploaded first, must not claim June either. */
ok('loading the months backwards still puts Month 1 under Leader Alpha',
   JSON.stringify(r1.byTL)===JSON.stringify(expect1), `${JSON.stringify(expect1)} -> ${JSON.stringify(r1.byTL)}`);
ok('loading the months backwards gives Month 2 the same answer',
   JSON.stringify(r2.byTL)===JSON.stringify(expect2), `${JSON.stringify(expect2)} -> ${JSON.stringify(r2.byTL)}`);
ok('loading the months backwards gives Month 3 the same answer',
   JSON.stringify(r3.byTL)===JSON.stringify(expect3), `${JSON.stringify(expect3)} -> ${JSON.stringify(r3.byTL)}`);

/* ---------- a move DURING a month, and the one-shot override ------------- */
/* The override exists for a list loaded late. It must apply to that one file and then clear:
   left armed it would back-date every list after it, so a real reorganisation weeks later
   would be filed against a date in the past — this mechanism failing through its own control.
   The move itself is dated 20 August, after all of month 3's activity, so month 3 must stay
   with the old leader entirely: a change applies FORWARD, never to the days already worked. */
console.log('\n— A move dated mid-month, and the one-shot override —');
await page.evaluate(()=>window.__mtd.setRosterAsOf('2026-08-20'));
await upload([F.rosterLate]);
const late=await report(M3);
ok('the "effective from" override clears itself after the upload it was set for',
   !(await page.evaluate(()=>window.__mtd.state().settings.rosterAsOf)),
   await page.evaluate(()=>window.__mtd.state().settings.rosterAsOf));
ok('the late move is recorded on the date it was given',
   (late.orgHist[STAYA.code]||[]).length===2 && late.orgHist[STAYA.code][1].d==='2026-08-20',
   JSON.stringify(late.orgHist[STAYA.code]));
ok('a move dated after the month\'s activity leaves that whole month with the old leader',
   agentUnder(late,STAYA.code,TLA)===26 && agentUnder(late,STAYA.code,TLB)===0,
   `Alpha ${agentUnder(late,STAYA.code,TLA)} Bravo ${agentUnder(late,STAYA.code,TLB)}`);
ok('and Month 1 is still untouched by any of it',
   agentUnder(await report(M1),MOVER.code,TLA)===100);
// an already-uploaded list is hash-skipped — it must still SPEND the armed override
await page.evaluate(()=>window.__mtd.setRosterAsOf('2026-01-01'));
await upload([F.rosterLate]);
ok('a skipped duplicate agent list still spends the override rather than leaving it armed',
   !(await page.evaluate(()=>window.__mtd.state().settings.rosterAsOf)),
   await page.evaluate(()=>window.__mtd.state().settings.rosterAsOf));

/* ---------- the acceptance test, stated as the spec states it ------------ */
console.log('\n— Final acceptance —');
ok('an agent\'s current team leader never rewrites their historical team leader',
   agentUnder(r1,MOVER.code,TLA)===100 && agentUnder(r1,MOVER.code,TLB)===0
   && agentUnder(r2,MOVER.code,TLB)===40 && agentUnder(r3,MOVER.code,TLB)===55,
   `M1 A=${agentUnder(r1,MOVER.code,TLA)} B=${agentUnder(r1,MOVER.code,TLB)} · M2 B=${agentUnder(r2,MOVER.code,TLB)} · M3 B=${agentUnder(r3,MOVER.code,TLB)}`);

ok('no page errors anywhere', errors.length===0, errors.slice(0,3).join(' | '));
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
failures.forEach(f=>console.log('FAIL: '+f));
errors.slice(0,6).forEach(e=>console.log('  '+e));
await browser.close(); server.close();
process.exit(fail||errors.length?1:0);