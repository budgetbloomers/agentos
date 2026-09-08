/* Two boots of Ops against a stubbed cloud: boot 1 must download every source,
   boot 2 (nothing changed) must serve facts from the IndexedDB mirror and skip
   the downloads. Third boot with ONE source's stamp moved must re-download
   exactly that source. */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
const AGENTOS = process.env.AGENTOS || decodeURIComponent(new URL('../..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1').replace(/\/$/, '');   // repo-relative (2026-09-08): the laptop path failed every cloud run
const { chromium } = await import(pathToFileURL(path.join(AGENTOS, 'nicks_code', 'diagnostics', 'node_modules', 'playwright', 'index.mjs')).href);

let kvGets = [];            // every /api/kv?key= data GET the app makes
let metaCalls = 0;
let FAIL_KEY = null;
const STAMPS = { 'cb-facts-AGENT_LIST': '2026-08-27T10:00:00Z', 'cb-facts-ATTENDANCE': '2026-08-27T10:00:00Z' };
const FACTS = {
  'cb-facts-AGENT_LIST': JSON.stringify([{ agent_name: 'Test Agent', employee_code: 'CB1', team_leader: 'TL A', campaign: 'Cuddle', _d: '2026-08-01' }]),
  'cb-facts-ATTENDANCE': JSON.stringify([{ employee_code: 'CB1', status: 'P', _d: '2026-08-01' }]),
};
const server = http.createServer((q, s) => {
  const u = new URL(q.url, 'http://x');
  if (u.pathname.startsWith('/api')) console.log('   [req] ' + q.method + ' ' + q.url.slice(0, 90));
  if (u.pathname === '/api/me') {
    s.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    s.end(JSON.stringify({ user: { username: 'test', full_name: 'Test User', role: 'admin' } })); return; }
  if (u.pathname === '/api/kv-meta') { metaCalls++;
    s.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    s.end(JSON.stringify({ keys: STAMPS })); return; }
  if (u.pathname === '/api/kv' && q.method === 'GET') {
    const k = u.searchParams.get('key'); kvGets.push(k);
    if (FAIL_KEY && k === FAIL_KEY) { s.writeHead(500, { 'Access-Control-Allow-Origin': '*' }); s.end('boom'); return; }
    if (FACTS[k]) { s.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' }); s.end(FACTS[k]); return; }
    s.writeHead(404, { 'Access-Control-Allow-Origin': '*' }); s.end('{}'); return; }
  if (u.pathname === '/') {
    s.writeHead(200, { 'Content-Type': 'text/html' });
    fs.createReadStream(path.join(AGENTOS, 'site', 'index.html')).pipe(s); return;
  }
  const f = path.join(AGENTOS, 'site', u.pathname.replace(/^\//, ''));
  if (fs.existsSync(f) && fs.statSync(f).isFile()) { s.writeHead(200); fs.createReadStream(f).pipe(s); return; }
  s.writeHead(404); s.end();
});
await new Promise(r => server.listen(8181, '127.0.0.1', r));

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cbx-boot-'));
const ctx = await chromium.launchPersistentContext(profile, { viewport: { width: 1400, height: 900 } });

async function boot(label) {
  kvGets = [];
  const pg = await ctx.newPage();
  await pg.addInitScript(() => {
    sessionStorage.setItem('cbx_token', 'test-token');
    // point the shim + the meta call at the stub server
    const of = window.fetch;
    window.fetch = (u, o) => of(String(u).replace('https://chatterbox-agentos-api.chatterbox-agentos.workers.dev', 'http://127.0.0.1:8181'), o);
  });
  const logs = [];
  pg.on('console', m => { if (/AgentOS/.test(m.text())) logs.push(m.text()); });
  pg.on('pageerror', e => console.log('   [pageerror] ' + String(e.message).slice(0, 140)));
  await pg.goto('http://127.0.0.1:8181/', { waitUntil: 'domcontentloaded' });
  const probe0 = await pg.evaluate(() => ({ init: typeof init, gen: (typeof __initGen !== 'undefined') ? __initGen : 'n/a',
    auth: !!document.getElementById('cbxAuth'), url: location.href, storage: !!window.storage }));
  console.log('   [probe-pre] ' + JSON.stringify(probe0));
  await pg.evaluate(() => document.dispatchEvent(new CustomEvent('cbx-authed')));
  await pg.waitForTimeout(800);
  const probe1 = await pg.evaluate(() => ({ gen: (typeof __initGen !== 'undefined') ? __initGen : 'n/a' }));
  console.log('   [probe-post] ' + JSON.stringify(probe1));
  await pg.waitForTimeout(4000);
  const facts = await pg.evaluate(() => ({ al: (state.facts.AGENT_LIST || []).length, att: (state.facts.ATTENDANCE || []).length }));
  await pg.close();
  const factGets = kvGets.filter(k => /^cb-facts-/.test(k));
  console.log(label + ': fact downloads = [' + factGets.join(', ') + '] · facts in state AL=' + facts.al + ' ATT=' + facts.att
    + (logs.length ? ' · ' + logs.join(' | ') : ''));
  return factGets;
}

const b1 = await boot('boot 1 (cold)');
const b2 = await boot('boot 2 (unchanged)');
STAMPS['cb-facts-ATTENDANCE'] = '2026-08-27T11:00:00Z';
const b3 = await boot('boot 3 (attendance changed)');

/* A DOWNLOAD THAT FAILS MUST NOT BE STAMPED AS HELD. Otherwise the next boot serves the
   older mirror copy believing it is current — stale data presented as fresh. */
STAMPS['cb-facts-AGENT_LIST'] = '2026-08-27T12:00:00Z';   // roster changed...
FAIL_KEY = 'cb-facts-AGENT_LIST';                          // ...and its download fails
const b4 = await boot('boot 4 (roster changed, download FAILS)');
FAIL_KEY = null;
const b5 = await boot('boot 5 (must retry the failed source)');

const ok1 = b1.includes('cb-facts-AGENT_LIST') && b1.includes('cb-facts-ATTENDANCE');
const ok2 = !b2.includes('cb-facts-AGENT_LIST') && !b2.includes('cb-facts-ATTENDANCE');
const ok3 = b3.includes('cb-facts-ATTENDANCE') && !b3.includes('cb-facts-AGENT_LIST');
console.log((ok1 ? 'ok  ' : 'FAIL') + ' cold boot downloads everything');
console.log((ok2 ? 'ok  ' : 'FAIL') + ' unchanged boot downloads nothing (served from the mirror)');
console.log((ok3 ? 'ok  ' : 'FAIL') + ' changed source re-downloads, unchanged one does not');
const ok4 = b4.includes('cb-facts-AGENT_LIST');
const ok5 = b5.includes('cb-facts-AGENT_LIST');
console.log((ok4 ? 'ok  ' : 'FAIL') + ' a changed source is attempted even when it will fail');
console.log((ok5 ? 'ok  ' : 'FAIL') + ' a FAILED download is retried next boot, never served stale from the mirror');
await ctx.close(); server.close();
fs.rmSync(profile, { recursive: true, force: true });
process.exit(ok1 && ok2 && ok3 && ok4 && ok5 ? 0 : 1);
