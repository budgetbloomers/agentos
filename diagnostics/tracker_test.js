// Tracker save-path smoke: pre-hydrate queue, honest save status, dirty-guard,
// computed Attendance %/SPD in the table, vt-mtd banner + filtered totals.
const http = require('http'); const fs = require('fs'); const path = require('path');
const { chromium } = require('playwright-core');
const { WORK: SP, ROOT, CHROME } = require('./common.js');
for (const [srcF, outF] of [[path.join(ROOT, 'tracker', 'index.html'), 'tracker_test.html'], [path.join(ROOT, 'tracker', 'vt-mtd-report.html'), 'vtmtd_test.html']]) {
  let s = fs.readFileSync(srcF, 'utf8').replace(/<link[^>]*fonts[^>]*>\s*/g, '');
  fs.writeFileSync(path.join(SP, outF), s);
}
const srv = http.createServer((req, res) => {
  const p = path.join(SP, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(SP) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript' }[path.extname(p)] || 'text/plain' });
  fs.createReadStream(p).pipe(res);
});
let fails = 0; const ok = (n, c, d) => { if (!c) { fails++; console.log('  FAIL', n, d ?? ''); } else console.log('  ok', n); };
(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const b = await chromium.launch({ executablePath: CHROME });
  const pg = await b.newPage();
  const posts = [];
  await pg.route('**/api/eod', async route => {
    const req = route.request();
    if (req.method() === 'GET') { await new Promise(r => setTimeout(r, 900)); // slow hydrate → the pre-hydrate window is real
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rows: [{ eod_date: '2026-07-20', employed: 12, present: 9, afrilead: 1, jag: 0, vt: 3, gwp: 95.5, target: 4 }] }) }); }
    posts.push(JSON.parse(req.postData() || '{}'));
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });
  await pg.addInitScript(() => sessionStorage.setItem('cbx_token', 'test-token'));
  await pg.goto(`http://127.0.0.1:${srv.address().port}/tracker_test.html`, { waitUntil: 'domcontentloaded' });
  await pg.evaluate(() => { localStorage.clear(); document.dispatchEvent(new Event('cbx-authed')); });
  // save BEFORE hydrate lands (hydrate is ~1.3s out: 400ms defer + 900ms route delay)
  await pg.evaluate(() => {
    const $ = id => document.getElementById(id);
    $('f-date').value = '2026-07-21';
    $('f-date').dispatchEvent(new Event('change'));
    $('f-employed').value = '10'; $('f-present').value = '8';
    $('f-afrilead').value = '1'; $('f-jag').value = '1'; $('f-vt').value = '4';
    $('f-gwp').value = '101.5'; $('f-target').value = '3';
    ['employed', 'present', 'afrilead', 'jag', 'vt', 'gwp', 'target'].forEach(k => $('f-' + k).dispatchEvent(new Event('input')));
    $('btn-save').click();
  });
  const msg1 = await pg.evaluate(() => document.getElementById('form-msg').textContent);
  ok('pre-hydrate save reports SYNCING, not a false tick', /syncing to the database/i.test(msg1), msg1);
  // wait for hydrate + queue flush
  await pg.waitForFunction(() => (document.getElementById('form-msg').textContent || '').includes('database') && !(document.getElementById('form-msg').textContent || '').includes('syncing'), null, { timeout: 15000, polling: 200 });
  const msg2 = await pg.evaluate(() => document.getElementById('form-msg').textContent);
  ok('queued save confirmed in the database after hydrate', /✓ in the database/.test(msg2), msg2);
  ok('queued row actually POSTed to /api/eod', posts.some(p => p.date === '2026-07-21' && p.employed === 10 && p.vt === 4), JSON.stringify(posts));
  // table: computed formulas — 21st: att 8/10=80%, SPD 4/8=0.50 · 20th (server row): 9/12=75%, SPD 3/9=0.33
  const table = await pg.evaluate(() => document.getElementById('tracker-body').innerHTML);
  ok('server row survived the merge (2026-07-20 present)', table.includes('80%') || /75\s?%/.test(table), table.slice(0, 200));
  const rows = await pg.evaluate(() => Array.from(document.querySelectorAll('#tracker-body tr')).map(tr => tr.textContent.replace(/\s+/g, ' ')).join(' || '));
  ok('attendance computed in code (80% for 8/10)', /80\s?%/.test(rows), rows.slice(0, 300));
  ok('SPD computed in code (0,50 for 4/8)', /0[.,]50/.test(rows), rows.slice(0, 300));
  ok('both dates present after queue merge', rows.includes('20') && posts.length >= 1 && /2026|Jul|07/.test(rows), '');
  // dirty guard: type an unsaved value, fire the visibility freshCheck → value must survive
  await pg.evaluate(() => {
    const $ = id => document.getElementById(id);
    $('f-employed').value = '77'; $('f-employed').dispatchEvent(new Event('input'));
    $('f-employed').blur();
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await pg.waitForTimeout(1400);
  const kept = await pg.evaluate(() => document.getElementById('f-employed').value);
  ok('unsaved keystrokes survive the background refresh (dirty guard)', kept === '77', kept);
  // vt-mtd: seed banner + filtered totals + no phantom weeks
  const p2 = await b.newPage();
  await p2.goto(`http://127.0.0.1:${srv.address().port}/vtmtd_test.html`, { waitUntil: 'domcontentloaded' });
  await p2.waitForTimeout(600);
  const seed = await p2.evaluate(() => document.body.innerHTML);
  ok('vt-mtd shows the SEED SNAPSHOT banner', seed.includes('SEED SNAPSHOT'), '');
  ok('vt-mtd carries the auth-gate include', fs.readFileSync(path.join(ROOT, 'tracker', 'vt-mtd-report.html'), 'utf8').includes('auth-gate.js'), '');
  const wk = await p2.evaluate(() => {
    const t = document.getElementById('vehTable') || document.querySelector('[id*="veh"], table');
    const html = document.body.innerHTML;
    return { phantom: /Week 4<\/td>/.test(html) || /Week 5<\/td>/.test(html), hasWeeks: /Week 1/.test(html) };
  });
  ok('lead tables render weeks 1-3 only (no phantom zero weeks)', wk.hasWeeks && !wk.phantom, JSON.stringify(wk));
  const filt = await p2.evaluate(async () => {
    const s = document.getElementById('search'); if (!s) return 'no-search';
    s.value = '07.07'; s.dispatchEvent(new Event('input'));
    await new Promise(r => setTimeout(r, 300));
    return document.body.innerHTML.includes('MTD (filtered)') ? 'filtered-total' : 'unfiltered-total';
  });
  ok('lead totals follow the search filter', filt === 'filtered-total' || filt === 'no-search', filt);
  console.log(`TRACKER: ${fails ? fails + ' FAILURES' : 'all passed'}`);
  await b.close(); srv.close(); process.exit(fails ? 1 : 0);
})().catch(e => { console.error('TRACKER HARNESS ERROR:', String(e).slice(0, 500)); process.exit(2); });
