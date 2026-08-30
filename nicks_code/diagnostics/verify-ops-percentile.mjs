/* A COMPOSITE MUST NOT CHANGE WHEN YOU TOUCH THE FILTER BAR.
   The GWP percentile is 15% of the composite and is tenure-relative (non-negotiable 5).
   It used to be computed inside the FILTERED set, so selecting one agent ranked them
   against themselves (100th percentile, +15 points). */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
const AGENTOS = 'C:/Users/aarav/OneDrive/Desktop/Chatterbox Agent OS/agentos';
const { chromium } = await import(pathToFileURL(path.join(AGENTOS, 'nicks_code', 'diagnostics', 'node_modules', 'playwright', 'index.mjs')).href);
const OPS = path.join(AGENTOS, 'Chatterbox_AgentOS_Analytics.html');
const srv = http.createServer((q, s) => {
  const u = q.url.split('?')[0];
  const f = u === '/xlsx.full.min.js' ? path.join(AGENTOS, 'site', 'xlsx.full.min.js') : (u === '/' ? OPS : null);
  if (!f) { s.writeHead(404); s.end(); return; }
  s.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' });
  fs.createReadStream(f).pipe(s);
});
await new Promise(r => srv.listen(8195, '127.0.0.1', r));
const b = await chromium.launch();
const page = await b.newPage();
const errs = []; page.on('pageerror', e => errs.push(String(e.message).slice(0, 120)));
await page.goto('http://127.0.0.1:8195/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);

const out = await page.evaluate(() => {
  // three agents, one tenure group, clearly different GWP
  // biLoaded() must be true or the percentile correctly drops out (the other round-3 fix)
  state.facts.BI_ACTIVE_CASES = [{ _d: '2026-08-01' }];
  state.cbInfo = {}; ['CB801', 'CB802', 'CB803'].forEach((cb, i) => {
    state.cbInfo[cb] = { name: 'Agent ' + i, code: cb, tl: 'TL A', queue: 'Cuddle', tenure: 'M2' };
  });
  const base = { group: 'M2', sc: { 'GWP/Sale': 50, 'Target Ach': 50, 'QA': 50, 'Conversion': 50, 'Talk': 50, 'Attendance': 50 },
    crit: 0, qaN: 5, sched: 20, sales: 5, calls: 50 };
  const mkStat = (cb, gwp) => Object.assign({}, base, { cb, gwp, sc: Object.assign({}, base.sc) });

  // the LOW earner of the group — the one a filter would flatter
  const all = [mkStat('CB801', 100), mkStat('CB802', 500), mkStat('CB803', 900)];
  applyGroupPercentiles(all);
  const unfiltered = all[0].comp.adj;

  // now the same agent ALONE, exactly what a filter used to hand the function
  const alone = [mkStat('CB801', 100)];
  applyGroupPercentiles(alone);
  const aloneScore = alone[0].comp.adj;

  // and the fixed shape: the filtered agent ranked against the full roster
  const withPeers = [mkStat('CB801', 100)];
  applyGroupPercentiles(withPeers.concat([mkStat('CB802', 500), mkStat('CB803', 900)]));
  const withPeersScore = withPeers[0].comp.adj;
  return { unfiltered, aloneScore, withPeersScore };
});
console.log(JSON.stringify(out));
const ok1 = out.aloneScore > out.unfiltered;                 // the old bug, reproduced
const ok2 = Math.abs(out.withPeersScore - out.unfiltered) < 0.01;   // the fix
console.log((ok1 ? 'ok  ' : 'FAIL') + ' ranking an agent alone DOES inflate the composite (' + out.unfiltered + ' → ' + out.aloneScore + ')');
console.log((ok2 ? 'ok  ' : 'FAIL') + ' ranking against the full roster gives the unfiltered score (' + out.withPeersScore + ')');
console.log('page errors: ' + (errs.length ? errs.join(' | ') : 'none'));
await b.close(); srv.close();
process.exit(ok1 && ok2 && !errs.length ? 0 : 1);
