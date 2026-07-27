// Large-file test: a ~50MB / 250k-row CallX CSV must upload without breaking the
// app, persist through the gzip+columnar path well under the edge request cap,
// and reload cleanly on the next login. Stubs /api/kv with an in-memory store so
// the FULL shim transport (gzip out, sniff+inflate in) is exercised end to end.
const http = require('http'); const fs = require('fs'); const path = require('path');
const { chromium } = require('playwright-core');
const { ROOT, WORK, CHROME } = require('./common.js');

// ---- build the shimmed (site) copy — the shim IS what we're testing ----
const { execFileSync } = require('child_process');
execFileSync(process.execPath, [path.join(ROOT, 'tools', 'prepare-site.js')], { stdio: 'ignore' });
let src = fs.readFileSync(path.join(ROOT, 'site', 'index.html'), 'utf8')
  .replace('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js', '/libs/xlsx.full.min.js')
  .replace('https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.4.1/papaparse.min.js', '/libs/papaparse.min.js')
  .replace('https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js', '/libs/chart.umd.min.js')
  .replace("importScripts('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js','https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.4.1/papaparse.min.js');",
    "importScripts(location.origin+'/libs/xlsx.full.min.js',location.origin+'/libs/papaparse.min.js');")
  .replace('<script src="/auth-gate.js"></script>', '')
  .replace(/<link rel="preconnect"[^>]*>\s*/g, '').replace(/<link href="https:\/\/fonts[^>]*>\s*/g, '');
fs.writeFileSync(path.join(WORK, 'bigfile_app.html'), src);

// ---- ~250k-row CallX CSV (~50MB) ----
const BIG = path.join(WORK, 'callx_big.csv');
if (!fs.existsSync(BIG) || fs.statSync(BIG).size < 45e6) {
  const H = 'Date & Time,Caller ID,Source,Destination,Outbound CLI,Call Type,Campaign,Agent,Bridge,Lead Disposition,Reporting classification,Wrap-up,Duration,Billable Seconds,Branch,Recording link,Channel,Destination Channel,Application';
  const pad = (n, w) => String(n).padStart(w, '0');
  const DISP = ['Interested', 'Call Back', 'Sale', 'No Answer', 'Not Interested', ''];
  const N = 250000, parts = [H];
  for (let i = 0; i < N; i++) {
    const day = 1 + (i % 22), bill = i % 500;
    parts.push(`${pad(day, 2)}/07/2026 ${pad(8 + (i % 9), 2)}:${pad(i % 60, 2)}:${pad((i * 7) % 60, 2)},27310${pad(i % 100000, 5)},ext${100 + i % 60},2782${pad(1000000 + i, 7)},0313000000,outbound,Matrix Courtesy,agent${1 + (i % 180)}.dial,ANSWERED,${DISP[i % 6]},class-${i % 4},wrapnote ${i % 9},00:0${Math.min(9, (bill / 60) | 0)}:${pad(bill % 60, 2)},${bill},DBN,https://recordings.example/${i},SIP/${i % 30},SIP/out${i % 30},dialer`);
  }
  fs.writeFileSync(BIG, parts.join('\n'));
}
console.log('fixture:', (fs.statSync(BIG).size / 1e6).toFixed(1) + 'MB');

// ---- server: static files + stubbed /api/kv (byte-faithful in-memory store) ----
const kv = {};
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api/kv') {
    const key = u.searchParams.get('key') || '';
    if (req.method === 'POST') {
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => { kv[key] = Buffer.concat(chunks); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); });
      return;
    }
    if (req.method === 'GET') {
      if (!(key in kv)) { res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end('{"found":false}'); }
      if (u.searchParams.get('meta')) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ found: true, updated_at: 'x' })); }
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end(kv[key]);
    }
    if (req.method === 'DELETE') { delete kv[key]; res.writeHead(200); return res.end('{}'); }
  }
  const p = path.join(WORK, decodeURIComponent(u.pathname));
  if (!p.startsWith(WORK) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.csv': 'text/csv' }[path.extname(p)] || 'text/plain' });
  fs.createReadStream(p).pipe(res);
});

let fails = 0; const ok = (n, c, d) => { if (!c) { fails++; console.log('  FAIL', n, d ?? ''); } else console.log('  ok', n); };
(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const PORT = srv.address().port;
  const b = await chromium.launch({ executablePath: CHROME, headless: true });

  // Patch the shim's Worker URL to our stub via routing (the shim uses an absolute URL).
  async function newAppPage() {
    const pg = await b.newPage();
    await pg.route(/chatterbox-agentos-api\.chatterbox-agentos\.workers\.dev/, async route => {
      const req = route.request();
      const u = new URL(req.url());
      if (u.pathname === '/api/kv') {
        const key = u.searchParams.get('key') || '';
        if (req.method() === 'POST') { kv[key] = req.postDataBuffer() || Buffer.alloc(0); return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); }
        if (req.method() === 'GET') {
          if (!(key in kv)) return route.fulfill({ status: 404, contentType: 'application/json', body: '{"found":false}' });
          if (u.searchParams.get('meta')) return route.fulfill({ status: 200, contentType: 'application/json', body: '{"found":true,"updated_at":"x"}' });
          return route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: kv[key] });
        }
        if (req.method() === 'DELETE') { delete kv[key]; return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); }
      }
      return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
    });
    await pg.addInitScript(() => sessionStorage.setItem('cbx_token', 'test-token'));
    const errs = [];
    pg.on('pageerror', e => { if (!/Failed to fetch|net::|ERR_/.test(String(e))) errs.push(String(e).slice(0, 200)); });
    pg.errs = errs;
    await pg.goto(`http://127.0.0.1:${PORT}/bigfile_app.html`, { waitUntil: 'domcontentloaded' });
    await pg.evaluate(() => { try { localStorage.clear(); } catch (e) {} document.dispatchEvent(new Event('cbx-authed')); });
    await pg.waitForFunction(() => { try { return __initDone === true } catch (e) { return false } }, null, { timeout: 40000, polling: 300 });
    return pg;
  }

  console.log('[bigfile] session 1 — upload 250k rows');
  const pg = await newAppPage();
  await pg.evaluate(() => go('uploads'));
  const t0 = Date.now();
  await pg.setInputFiles('#slot_CALLX_CALL_RECORDS input[type=file]', BIG);
  // the progress modal must be LIVE while parsing — sample the phase label
  const labels = new Set();
  const sampler = setInterval(async () => { try { const l = await pg.evaluate(() => (document.getElementById('upPhase') || {}).textContent || ''); if (l) labels.add(l.split('…')[0]); } catch (e) {} }, 400);
  await pg.waitForSelector('#confirmLoad:not([disabled])', { timeout: 300000 });
  clearInterval(sampler);
  const tModal = Date.now() - t0;
  console.log('  parse+plan:', (tModal / 1000).toFixed(1) + 's · progress phases seen:', [...labels].slice(0, 5).join(' | '));
  ok('progress UI stayed live through the parse (multiple phases)', labels.size >= 2, [...labels].join('|'));
  const t1 = Date.now();
  await pg.click('#confirmLoad');
  await pg.waitForFunction(() => !document.querySelector('#overlay').classList.contains('open'), null, { timeout: 120000, polling: 200 });
  console.log('  confirm:', ((Date.now() - t1) / 1000).toFixed(1) + 's');
  const n1 = await pg.evaluate(() => (state.facts.CALLX_CALL_RECORDS || []).length);
  ok('all 250,000 rows loaded', n1 === 250000, n1);
  // wait for the background cloud save to land in the kv stub
  await pg.waitForFunction(() => true, null, { timeout: 1000 }).catch(() => {});
  const tSave = Date.now();
  while (!kv['cb-facts-CALLX_CALL_RECORDS'] && Date.now() - tSave < 120000) await new Promise(r => setTimeout(r, 500));
  const blob = kv['cb-facts-CALLX_CALL_RECORDS'];
  ok('fact blob persisted to the cloud stub', !!blob);
  if (blob) {
    const gz = blob[0] === 0x1f && blob[1] === 0x8b;
    console.log('  stored blob:', (blob.length / 1e6).toFixed(1) + 'MB', gz ? '(gzip)' : '(plain)');
    ok('blob is gzip-compressed', gz);
    ok('blob is far under the 100MB edge cap (<30MB)', blob.length < 30e6, blob.length);
  }
  const nav = await pg.evaluate(() => { const t = performance.now(); state.route = 'sales'; render(); return Math.round(performance.now() - t); });
  console.log('  sales page render with 250k rows:', nav + 'ms');
  ok('sales page renders under 3s with 250k rows', nav < 3000, nav + 'ms');
  ok('no unexpected page errors in session 1', pg.errs.length === 0, pg.errs.join(' | '));
  await pg.close();

  console.log('[bigfile] session 2 — fresh login reloads the big source');
  const t2 = Date.now();
  const pg2 = await newAppPage();
  await pg2.waitForFunction(() => (state.facts.CALLX_CALL_RECORDS || []).length > 0, null, { timeout: 90000, polling: 500 });
  const n2 = await pg2.evaluate(() => (state.facts.CALLX_CALL_RECORDS || []).length);
  console.log('  boot+hydrate:', ((Date.now() - t2) / 1000).toFixed(1) + 's');
  ok('reload restored all 250,000 rows (gzip → inflate → decode)', n2 === 250000, n2);
  const sample = await pg2.evaluate(() => { const r = state.facts.CALLX_CALL_RECORDS[123456]; return [r.agent, r.billable_seconds, r._d, r._batch, r.lead_disposition].join('|'); });
  ok('round-tripped row content intact (spot row 123456)', /^agent\d+\.dial\|\d+\|2026-07-\d\d\|B\d+\|/.test(sample), sample);
  const kpi = await pg2.evaluate(() => evalKPI(state.kpis.find(k => k.id === 'total_calls'), periodWindow()));
  ok('total_calls KPI = 250,000 after reload', kpi === 250000, kpi);
  ok('no unexpected page errors in session 2', pg2.errs.length === 0, pg2.errs.join(' | '));
  await pg2.close();

  await b.close(); srv.close();
  console.log(`BIGFILE: ${fails ? fails + ' FAILURES' : 'all passed'}`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('BIGFILE HARNESS ERROR:', String(e).slice(0, 600)); process.exit(2); });
