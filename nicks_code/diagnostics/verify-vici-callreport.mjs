/* VICIDIAL "EXPORT_CALL_REPORT" — the per-call export, checked against the real file.
 *
 * Talk time is the sum of length_in_sec on the agent's CB number (Nick, 2026-08-13). Every
 * figure below is recomputed independently from the raw tab-separated text and compared with
 * what the app stored, so the parser is checked against the file rather than against itself.
 *
 * The format is the first plain-text TAB-separated source the app has taken. Read as CSV it
 * collapses to one 39-wide column and is rejected as unrecognised, so the delimiter sniff is
 * load-bearing and is asserted here first.
 *
 * Needs uploads/2026-08-13/EXPORT_CALL_REPORT_*.txt (gitignored — it carries lead names,
 * phone numbers and email addresses). Skips cleanly without it.
 *
 * Run: node verify-vici-callreport.mjs   (or PULSE_HTML=site/pulse/index.html node …)
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

const REPO = String.raw`c:\Users\aarav\OneDrive\Desktop\Chatterbox Agent OS\agentos`;
const HTML = process.env.PULSE_HTML ? path.resolve(REPO, process.env.PULSE_HTML)
                                    : path.join(REPO, 'nicks_code', 'index.html');
const UPDIR = path.join(REPO, 'uploads', '2026-08-13');
const AUG   = path.join(REPO, 'uploads', '2026-08-06');
const SRC = fs.existsSync(UPDIR)
  ? (fs.readdirSync(UPDIR).find(f => /^EXPORT_CALL_REPORT.*\.txt$/i.test(f)) || null) : null;
if (!SRC) {
  console.log(`(skipping — put an EXPORT_CALL_REPORT*.txt in ${UPDIR})`);
  process.exit(0);
}
const SRCPATH = path.join(UPDIR, SRC);
const FIX = path.join(process.cwd(), 'simfix');
fs.mkdirSync(FIX, { recursive: true });

/* ---------- independent recompute, straight from the raw text ------------ */
const RULES = JSON.parse(fs.readFileSync(path.join(REPO,'specs','mtd_engine_rules.json'),'utf8'))
  .sources.find(s => s.id === 'vici_call_report');
const NO_CONTACT = new Set(RULES.no_contact_statuses);
const SYS = new Set((RULES.exclusions.find(e => e.field === 'user') || {}).in || []);

const raw = fs.readFileSync(SRCPATH, 'utf8');
const lines = raw.split(/\r?\n/).filter(l => l.length);
const head = lines[0].split('\t').map(h => h.trim());
const ROWS = lines.slice(1).map(l => { const c = l.split('\t'); const o = {};
  head.forEach((h, i) => o[h] = (c[i] ?? '').trim()); return o; });

const isOptIn  = d => { const s=(d||'').toLowerCase(); return s.includes('insurance opt') && !s.includes('no insurance'); };
const isSaleD  = d => { const s=(d||'').toLowerCase(); return (s.includes('sale')&&!s.startsWith('no sale')&&!s.includes('after sales'))||s==='saleinsoptin'; };

const EXPECT = {};      // date -> user -> {talk,calls,ans,opt,saleD}
let expSys = 0, expNeg = 0, expAll = 0, expRing = 0;
const seen = new Set();
for (const r of ROWS) {
  const d = (r.call_date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !r.user) continue;
  const key = r.call_date + '|' + r.user + '|' + r.lead_id + '|' + r.status.toUpperCase();
  if (seen.has(key)) continue;
  seen.add(key);
  if (SYS.has(r.user)) { expSys++; continue; }
  let secs = parseInt(r.length_in_sec, 10); if (!isFinite(secs)) secs = 0;
  if (secs < 0) { expNeg++; secs = 0; }
  const reached = !NO_CONTACT.has(r.status.toUpperCase());
  expAll += secs; if (!reached) expRing += secs;
  const b = ((EXPECT[d] = EXPECT[d] || {})[r.user] = EXPECT[d][r.user] || {talk:0,calls:0,ans:0,opt:0,saleD:0});
  b.talk += secs; b.calls++; if (reached) b.ans++;
  if (isOptIn(r.status_name)) b.opt++;
  if (isSaleD(r.status_name)) b.saleD++;
}
const DATES = Object.keys(EXPECT).sort();
const expTotalTalk = Object.values(EXPECT).reduce((t,d)=>t+Object.values(d).reduce((u,b)=>u+b.talk,0),0);

/* ---------- fixtures ----------------------------------------------------- */
// every data row twice — the record key must count each call once
fs.writeFileSync(path.join(FIX,'callreport-doubled.txt'), [lines[0], ...lines.slice(1), ...lines.slice(1)].join('\n')+'\n');
// a renamed copy, to prove the hash guard and the merge agree
fs.copyFileSync(SRCPATH, path.join(FIX,'callreport-copy.txt'));
// the first half only — a midday pull that must not destroy a fuller one
fs.writeFileSync(path.join(FIX,'callreport-partial.txt'),
  [lines[0], ...lines.slice(1, 1 + Math.floor((lines.length-1)/2))].join('\n')+'\n');

/* ---------- harness ------------------------------------------------------ */
const SERVE={'/':HTML,'/index.html':HTML,'/xlsx.full.min.js':path.join(REPO,'site','xlsx.full.min.js')};
const server=http.createServer((q,s)=>{ const p=SERVE[q.url.split('?')[0]];
  if(!p||!fs.existsSync(p)){s.writeHead(404);s.end('nf');return}
  s.writeHead(200,{'Content-Type':p.endsWith('.js')?'text/javascript':'text/html'});
  fs.createReadStream(p).pipe(s)});
await new Promise(r=>server.listen(8141,'127.0.0.1',r));

let pass=0, fail=0; const failures=[];
const ok=(n,c,d='')=>{ if(c){pass++; console.log('  ok   '+n);} else {fail++; failures.push(n+(d?' — '+d:'')); console.log('  FAIL '+n+(d?' — '+d:''));} };
const hms=s=>[Math.floor(s/3600),Math.floor(s/60)%60,s%60].map(x=>String(x).padStart(2,'0')).join(':');

const browser=await chromium.launch({args:['--js-flags=--max-old-space-size=8192']});
const errors=[];
async function session(label, batches){
  const page=await browser.newPage({viewport:{width:1400,height:900}});
  page.on('pageerror',e=>errors.push(label+': '+e.message));
  await page.goto('http://127.0.0.1:8141/index.html',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__mtd&&window.__mtd.state(),null,{timeout:30000});
  await page.evaluate(()=>{ try{localStorage.clear()}catch(e){}
    const S=window.__mtd.state();
    ['calls','callsMeta','sales','att','evals','tracker','cancRows','vici','viciDays','orgHist'].forEach(k=>S[k]={});
    S.files=[]; S.roster=[]; S.ui.asAt=''; });
  for(const b of batches){
    await page.setInputFiles('#fileInput', b, {timeout:180000});
    /* 1,5s x 5, the same settle window audit-dupes uses. A tighter one looks stable during
       the pause while a 2 MB workbook parses off-thread, and the batch is read as finished
       with half its files still to land. */
    let last=-1, stable=0;
    for(let i=0;i<200;i++){ await page.waitForTimeout(1500);
      const n=await page.evaluate(()=>window.__mtd.state().files.length);
      if(n===last){ if(++stable>=5) break; } else { stable=0; last=n; } }
  }
  const out=await page.evaluate(()=>{
    const S=window.__mtd.state();
    const calls={}; for(const d in S.calls){ calls[d]={};
      for(const k in S.calls[d]) calls[d][k]={...S.calls[d][k]}; }
    return { calls, viciDays:{...S.viciDays},
      files:S.files.map(f=>({name:f.name,type:f.type,dates:f.dates,rows:f.rows,dupes:f.dupes,sysRows:f.sysRows,
        negative:f.negative,talkSecs:f.talkSecs,noContactSecs:f.noContactSecs,landed:f.landed})) };
  });
  await page.close();
  return out;
}
const talkOf=o=>{ let t=0; for(const d in o.calls) for(const k in o.calls[d]) t+=o.calls[d][k].talk||0; return t; };

/* 1 — it parses at all */
console.log('\n— the tab-separated .txt is recognised —');
const base=await session('base',[[SRCPATH]]);
const reg=base.files.find(f=>f.type==='calls (ViciDial)');
ok('the .txt loads instead of being rejected as unrecognised', !!reg, JSON.stringify(base.files));
ok('it registers as a ViciDial call source', reg && reg.type==='calls (ViciDial)', reg&&reg.type);
ok('it claims exactly the days its calls fall on',
   reg && JSON.stringify(reg.dates)===JSON.stringify(DATES), `${reg&&reg.dates} vs ${DATES}`);
ok('every data row was read', reg && reg.rows===ROWS.length, `${reg&&reg.rows} vs ${ROWS.length}`);

/* 2 — the numbers, against an independent recompute of the raw file */
console.log('\n— talk time is length_in_sec summed on the CB number —');
ok('total talk time matches the file exactly',
   talkOf(base)===expTotalTalk, `app ${hms(talkOf(base))} vs file ${hms(expTotalTalk)}`);
{
  const bad=[];
  for(const d of DATES) for(const u in EXPECT[d]){
    const got=(base.calls[d]||{})[u], want=EXPECT[d][u];
    if(!got){ bad.push(u+' missing'); continue; }
    for(const f of ['talk','calls','ans','opt','saleD'])
      if((got[f]||0)!==want[f]) bad.push(`${u}.${f} ${got[f]} vs ${want[f]}`);
  }
  ok('every agent-day matches on talk, calls, answered, opt-ins and sales', !bad.length, bad.slice(0,5).join(' | '));
}
ok('every stored row is tagged as ViciDial-sourced',
   Object.values(base.calls).every(d=>Object.values(d).every(b=>b.v===1)));
ok('the day is marked as having call-level detail', !!base.viciDays[DATES[0]]);

/* 3 — what was excluded, and whether it was counted rather than dropped in silence */
console.log('\n— exclusions are counted, never silent —');
ok('ViciDial system and test logins are excluded', reg && reg.sysRows===expSys, `${reg&&reg.sysRows} vs ${expSys}`);
ok('none of them reached the stored data',
   !Object.values(base.calls).some(d=>Object.keys(d).some(u=>SYS.has(u))),
   Object.keys(base.calls[DATES[0]]||{}).filter(u=>SYS.has(u)).join(','));
ok('negative call lengths are zeroed and counted', reg && reg.negative===expNeg, `${reg&&reg.negative} vs ${expNeg}`);
ok('the ring-time share is measured and reported',
   reg && reg.talkSecs===expAll && reg.noContactSecs===expRing,
   `talk ${reg&&reg.talkSecs}/${expAll} noContact ${reg&&reg.noContactSecs}/${expRing}`);
ok('a third of the seconds really are on calls that reached no one',
   expRing/expAll>0.25 && expRing/expAll<0.40, `${(expRing/expAll*100).toFixed(1)}%`);

/* 4 — incremental */
console.log('\n— the upload stays incremental —');
const twice=await session('twice',[[SRCPATH],[SRCPATH]]);
ok('re-uploading the same file changes nothing',
   talkOf(twice)===talkOf(base), `${hms(talkOf(base))} -> ${hms(talkOf(twice))}`);
const renamed=await session('renamed',[[SRCPATH],[path.join(FIX,'callreport-copy.txt')]]);
ok('the same export under a different name does not double talk time',
   talkOf(renamed)===talkOf(base), `${hms(talkOf(base))} -> ${hms(talkOf(renamed))}`);
const doubled=await session('doubled',[[path.join(FIX,'callreport-doubled.txt')]]);
ok('a file with every row repeated counts each call once',
   talkOf(doubled)===talkOf(base), `${hms(talkOf(base))} -> ${hms(talkOf(doubled))}`);
{
  const r=doubled.files.find(f=>f.type==='calls (ViciDial)');
  ok('and says how many repeats it dropped', r && r.dupes===ROWS.length, `${r&&r.dupes} vs ${ROWS.length}`);
}
const partialThenFull=await session('partial then full',[[path.join(FIX,'callreport-partial.txt')],[SRCPATH]]);
const fullThenPartial=await session('full then partial',[[SRCPATH],[path.join(FIX,'callreport-partial.txt')]]);
ok('a fuller pull replaces a partial one', talkOf(partialThenFull)===talkOf(base),
   `${hms(talkOf(base))} vs ${hms(talkOf(partialThenFull))}`);
ok('a partial pull never destroys a fuller one already loaded',
   talkOf(fullThenPartial)===talkOf(base), `${hms(talkOf(base))} vs ${hms(talkOf(fullThenPartial))}`);

/* 5 — alongside the rest of the drop */
console.log('\n— it coexists with the other sources —');
const withRoster=await session('with roster',[[path.join(AUG,'Matrix - Agent List.xlsx'), SRCPATH]]);
ok('loading it beside the agent list keeps every second',
   talkOf(withRoster)===expTotalTalk, `${hms(talkOf(withRoster))} vs ${hms(expTotalTalk)}`);
/* THE FLOOR THIS FILE IS ACTUALLY FROM. The 13 Aug pull is Vehicle Tracking and digital —
   not one Cuddle agent in it — so most of its hours land on a campaign the dashboard does
   not report on, or on codes the Agent List has never seen. That is not a parsing failure,
   it is the file, and the upload has to say so rather than report "loaded" and go quiet. */
{
  const r=withRoster.files.find(f=>f.type==='calls (ViciDial)');
  const landed=(r&&r.landed)||{};
  const inReport=Object.entries(landed).filter(([c])=>c==='Cuddle'||c==='Courtesy')
    .reduce((t,[,v])=>t+v.secs,0);
  const outside=Object.entries(landed).filter(([c])=>c!=='Cuddle'&&c!=='Courtesy')
    .reduce((t,[,v])=>t+v.secs,0);
  ok('the upload reports which campaigns its talk landed on', Object.keys(landed).length>0, JSON.stringify(landed));
  ok('every second is accounted for across those campaigns', inReport+outside===expTotalTalk,
     `${hms(inReport)}+${hms(outside)} vs ${hms(expTotalTalk)}`);
  ok('this export carries no Cuddle agent at all — Cuddle talk comes from the other ViciDial file',
     !landed.Cuddle, JSON.stringify(landed.Cuddle||null));
  console.log('   landed:', Object.entries(landed).map(([c,v])=>`${c} ${v.agents}a ${hms(v.secs)}`).join(' · '));
}
const withCallX=await session('with CallX',[[path.join(AUG,'Matrix - Agent List.xlsx'),
  path.join(AUG,'Call X Call report - 3 - 5.xlsx'), SRCPATH]]);
ok('CallX days and the call-report day both survive',
   Object.keys(withCallX.calls).length>Object.keys(base.calls).length,
   Object.keys(withCallX.calls).join(','));
ok('the call report still holds its own day in full',
   Object.entries(withCallX.calls[DATES[0]]||{}).reduce((t,[,b])=>t+(b.talk||0),0)===expTotalTalk);

ok('no page errors anywhere', errors.length===0, errors.slice(0,3).join(' | '));
console.log(`\ntalk time: ${hms(expTotalTalk)} across ${Object.keys(EXPECT[DATES[0]]||{}).length} agents on ${DATES.join(', ')}`);
console.log(`of which ${hms(expRing)} (${(expRing/expAll*100).toFixed(1)}%) reached no one`);
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
failures.forEach(f=>console.log('FAIL: '+f));
errors.slice(0,6).forEach(e=>console.log('  '+e));
await browser.close(); server.close();
process.exit(fail||errors.length?1:0);