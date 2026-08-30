/* AN EMPTY EXPORT MUST NEVER WIPE A SNAPSHOT SOURCE.
 *
 * A snapshot source (Open Cases, the Agent List) is replaced WHOLE on upload. A Salesforce
 * export that is really a frameset shell — headers, no rows — used to sail through: zero
 * rows means zero rejects, so the batch was marked "passed", the source was replaced with
 * [], and the trust bar, System Health and the slot chip all went green and called it fresh.
 * 2,815 open cases could vanish with every surface reporting success. PULSE refuses the same
 * file outright; Ops now does too.
 *
 * Run: node verify-empty-snapshot.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
const AGENTOS = 'C:/Users/aarav/OneDrive/Desktop/Chatterbox Agent OS/agentos';
const { chromium } = await import(pathToFileURL(path.join(AGENTOS, 'nicks_code', 'diagnostics', 'node_modules', 'playwright', 'index.mjs')).href);
const OPS = path.join(AGENTOS, 'Chatterbox_AgentOS_Analytics.html');
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + ' — ' + d); } };
const srv = http.createServer((q, s) => {
  const u = q.url.split('?')[0];
  const f = u === '/xlsx.full.min.js' ? path.join(AGENTOS, 'site', 'xlsx.full.min.js') : (u === '/' ? OPS : null);
  if (!f) { s.writeHead(404); s.end(); return; }
  s.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' });
  fs.createReadStream(f).pipe(s);
});
await new Promise(r => srv.listen(8213, '127.0.0.1', r));
const b = await chromium.launch();
const page = await b.newPage();
const errs = []; page.on('pageerror', e => errs.push(String(e.message).slice(0, 110)));
await page.goto('http://127.0.0.1:8213/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);

const out = await page.evaluate(() => {
  /* a populated snapshot source, as if today's real export had landed */
  const rows = [];
  for (let i = 0; i < 2815; i++) rows.push({ case_number: 'C' + i, cb: 'CB1', status: '1st attempt', _d: '2026-08-27' });
  state.facts.SF_OPEN_CASES = rows;
  state.batches = [];
  const before = state.facts.SF_OPEN_CASES.length;

  /* the frameset shell: headers parsed, not one data row */
  const parsed = { headers: ['Case Number', 'Case Owner', 'Status', 'Date/Time Opened'], data: [], textHash: 'emptyshell1' };
  let threw = '';
  try { applyLoad('SF_OPEN_CASES', { name: 'SF Open Cases (shell).xls', size: 4096 }, parsed, 'test'); }
  catch (e) { threw = String(e.message).slice(0, 80); }

  const batch = (state.batches || []).find(x => x.source_type === 'SF_OPEN_CASES') || {};
  return { before, after: (state.facts.SF_OPEN_CASES || []).length, threw,
    status: batch.validation_status, loadedCount: batch.loaded_row_count,
    // freshness() must not present a zero-row batch as a healthy source
    fresh: (typeof freshness === 'function') ? (freshness('SF_OPEN_CASES') || {}).state : '(n/a)' };
});
console.log(JSON.stringify(out));
ok('the populated snapshot survives an empty upload', out.after === out.before, out.before + ' → ' + out.after);
ok('the empty upload does not throw', !out.threw, out.threw);
ok('the batch is recorded as failed, not passed', out.status === 'failed', String(out.status));
ok('the batch reports zero rows loaded', out.loadedCount === 0, String(out.loadedCount));
ok('the trust bar does not call the source fresh', out.fresh !== 'ok' && out.fresh !== 'fresh', String(out.fresh));
ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
console.log('==== ' + pass + ' passed, ' + fail + ' failed ====');
await b.close(); srv.close();
process.exit(fail ? 1 : 0);
