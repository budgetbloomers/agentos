// Chat-widget rendering test: stub /api/ask, send a question in BOTH widgets,
// assert the answer renders as structured HTML (bold/lists/table), no raw tags.
const http = require('http'); const fs = require('fs'); const path = require('path');
const { chromium } = require('playwright-core');
const { WORK: SP, ROOT, CHROME } = require('./common.js');
const ANSWER = '**July GWP:** R719,992 (incl VAT)\n\n### Top agents\n- CB1 — R213,992\n- CB4 — R230\n\n| Metric | Value | Target |\n|---|---|---|\n| QA | 86.8% | 90% |\n\nEdit `gwpFloor` in the Dictionary. <img src=x onerror=alert(1)>';
// companion test page: minimal host app for ask-widget.js
fs.writeFileSync(path.join(SP, 'widget_host.html'),
  '<!DOCTYPE html><html><body><script>window.CBX_ASK={ctx:function(){return "ctx"},placeholder:"Ask...",blurb:"b",sugg:["s1"],digestKey:null};<' + '/script>'
  + '<script src="/aw/ask-widget.js"><' + '/script></body></html>');
fs.mkdirSync(path.join(SP, 'aw'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'site', 'ask-widget.js'), path.join(SP, 'aw', 'ask-widget.js'));
const srv = http.createServer((req, res) => {
  const p = path.join(SP, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(SP) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript' }[path.extname(p)] || 'text/plain' });
  fs.createReadStream(p).pipe(res);
});
let fails = 0;
const ok = (n, c, d) => { if (!c) { fails++; console.log('  FAIL', n, d || ''); } else console.log('  ok', n); };
(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const PORT = srv.address().port;
  const b = await chromium.launch({ executablePath: CHROME });

  for (const [label, url, open, logSel] of [
    ['ops-inline', `http://127.0.0.1:${PORT}/test_current.html`, async pg => { await pg.evaluate(() => { document.dispatchEvent(new Event('cbx-authed')); }); await pg.waitForFunction(() => { try { return __initDone === true } catch (e) { return false } }, null, { timeout: 30000, polling: 300 }); await pg.evaluate(() => askToggle()); }, '#askLogBox'],
    ['companion', `http://127.0.0.1:${PORT}/widget_host.html`, async pg => { await pg.evaluate(() => askToggle()); }, '#askLog'],
  ]) {
    const pg = await b.newPage();
    await pg.route('**/api/ask', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ answer: ANSWER }) }));
    pg.on('dialog', d => { fails++; console.log('  FAIL', label, 'XSS dialog fired!'); d.dismiss(); });
    await pg.goto(url, { waitUntil: 'domcontentloaded' });
    await open(pg);
    await pg.evaluate(() => { const i = document.getElementById('askIn'); i.value = 'How is July?'; return askSend(); });
    await pg.waitForFunction(sel => { const l = document.querySelector(sel); return l && /Top agents/.test(l.innerHTML) }, logSel, { timeout: 10000, polling: 100 });
    const html = await pg.evaluate(sel => document.querySelector(sel).innerHTML, logSel);
    ok(label + ': bold figures', html.includes('<b>July GWP:</b>'));
    ok(label + ': bullet list', /<ul[^>]*>[\s\S]*<li/.test(html));
    ok(label + ': table with header', /<table[\s\S]*<th[\s\S]*86\.8%/.test(html));
    ok(label + ': heading styled', html.includes('font-weight:800'));
    ok(label + ': inline code', html.includes('<code'));
    const injected = await pg.evaluate(sel => !!document.querySelector(sel + ' img, ' + sel + ' script'), logSel);
    ok(label + ': injection escaped (no real img/script element)', !injected && html.includes('&lt;img'));
    await pg.close();
  }
  await b.close(); srv.close();
  console.log(fails ? `WIDGET: ${fails} FAILURES` : 'WIDGET: all rendering checks passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('WIDGET HARNESS ERROR:', String(e).slice(0, 400)); process.exit(2); });
