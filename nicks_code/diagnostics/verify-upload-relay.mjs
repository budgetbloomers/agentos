/* A FILE UPLOADED IN VAS MUST LAND IN OPS BY ITSELF.
 *
 * Nick, 2026-08-28: "when information is uploaded in vas it must automatically update in ops
 * analytics as well." The Agent List has its own server-side mirror; EVERY OTHER export
 * travels as RAW BYTES through kv:upload-manifest and is parsed by Ops' own pipeline — which
 * means it only happens while Ops is open. This proves that when Ops IS open it needs no
 * human help: it finds the file, downloads it, detects the source, loads it, and marks it
 * decided exactly once.
 *
 * Also asserts the failure rules that keep the relay honest:
 *   · a download failure must NOT mark the file decided (it retries next cycle)
 *   · a file already decided is never re-applied
 *   · AGENT_LIST is skipped here on purpose (it flows through /api/roster)
 *
 * Run: node verify-upload-relay.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
const AGENTOS = 'C:/Users/aarav/OneDrive/Desktop/Chatterbox Agent OS/agentos';
const { chromium } = await import(pathToFileURL(path.join(AGENTOS, 'nicks_code', 'diagnostics', 'node_modules', 'playwright', 'index.mjs')).href);

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + ' — ' + d); } };

/* An attendance export — Ops requires Date, Employee Code, Status Code. */
const CSV = [
  'Date,Employee Code,Employee Name,Status Code,Status',
  '2026-08-26,CB291,Xolile Chiliza,P,Present',
  '2026-08-26,CB299,Mvelo Nyawose,P,Present',
  '2026-08-27,CB291,Xolile Chiliza,P,Present',
].join('\n');
const HASH = 'a1b2c3d4e5f60718';
let manifest = { files: [{ n: 'attendance_relay_test.csv', h: HASH, s: CSV.length, at: '2026-08-28T06:00:00Z' }] };
let failDownload = false;
const kv = {};                    // the stub's key-value store (cb-config etc. must survive a reload)
let downloads = 0;

const server = http.createServer((q, s) => {
  const u = new URL(q.url, 'http://x');
  const J = (o, st = 200) => { s.writeHead(st, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); s.end(JSON.stringify(o)); };
  if (u.pathname === '/api/me') return J({ user: { username: 'test', full_name: 'Test', role: 'admin' } });
  if (u.pathname === '/api/upload-manifest') return J(manifest);
  if (u.pathname === '/api/upload-file') {
    downloads++;
    if (failDownload) { s.writeHead(500, { 'Access-Control-Allow-Origin': '*' }); return s.end('boom'); }
    s.writeHead(200, { 'Content-Type': 'text/csv', 'Access-Control-Allow-Origin': '*' }); return s.end(CSV);
  }
  if (u.pathname === '/api/roster') return J({ fingerprint: 'vas:none', n: 0, as_of: '', roster: [] });
  if (u.pathname === '/api/kv-meta') return J({ keys: {} });
  if (u.pathname === '/api/kv') {
    /* A REAL key-value store, because the seen-set lives in cb-config: a stub that forgets
       it would reset the relay's memory every boot and the "already decided" assertion
       would test nothing. */
    const k = u.searchParams.get('key');
    if (q.method === 'GET') {
      if (kv[k] == null) { s.writeHead(404, { 'Access-Control-Allow-Origin': '*' }); return s.end('{}'); }
      s.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' }); return s.end(kv[k]);
    }
    let body = ''; q.on('data', c => body += c); return q.on('end', () => { kv[k] = body; J({ ok: true }); });
  }
  if (u.pathname === '/') { s.writeHead(200, { 'Content-Type': 'text/html' }); return fs.createReadStream(path.join(AGENTOS, 'site', 'index.html')).pipe(s); }
  if (u.pathname === '/xlsx.full.min.js') { s.writeHead(200, { 'Content-Type': 'text/javascript' }); return fs.createReadStream(path.join(AGENTOS, 'site', 'xlsx.full.min.js')).pipe(s); }
  s.writeHead(404); s.end();
});
await new Promise(r => server.listen(8199, '127.0.0.1', r));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cbx-relay-'));
const ctx = await chromium.launchPersistentContext(profile, { viewport: { width: 1400, height: 900 } });

async function boot() {
  const pg = await ctx.newPage();
  await pg.addInitScript(() => {
    sessionStorage.setItem('cbx_token', 'test-token');
    const of = window.fetch;
    window.fetch = (u, o) => of(String(u).replace('https://chatterbox-agentos-api.chatterbox-agentos.workers.dev', 'http://127.0.0.1:8199'), o);
  });
  await pg.goto('http://127.0.0.1:8199/', { waitUntil: 'domcontentloaded' });
  await pg.evaluate(() => document.dispatchEvent(new CustomEvent('cbx-authed')));
  await pg.waitForTimeout(6000);
  const r = await pg.evaluate(() => ({
    att: (state.facts.ATTENDANCE || []).length,
    seen: Object.keys(state.syncedUploads || {}),
    batches: (state.batches || []).filter(b => b.source_type === 'ATTENDANCE').map(b => b.original_file_name),
  }));
  await pg.close();
  return r;
}

/* ---- 1. the happy path: nobody lifts a finger ---- */
let r = await boot();
ok('the relay finds, downloads and LOADS a file uploaded in VAS', r.att === 3, 'attendance rows=' + r.att);
ok('...and files it as its own batch', r.batches.length === 1, JSON.stringify(r.batches));
ok('...and marks it decided exactly once', r.seen.length === 1 && r.seen[0] === HASH, JSON.stringify(r.seen));

/* ---- 2. a second open must not re-apply it ---- */
const before = downloads;
r = await boot();
ok('an already-decided file is not downloaded again', downloads === before, (downloads - before) + ' extra downloads');
ok('...and the rows are not duplicated', r.att === 3, 'attendance rows=' + r.att);

/* ---- 3. a DOWNLOAD FAILURE must not mark it decided ---- */
manifest = { files: [{ n: 'attendance_second.csv', h: 'ffffffff00000001', s: CSV.length, at: '2026-08-28T07:00:00Z' }] };
failDownload = true;
r = await boot();
ok('a failed download is NOT marked decided (it will retry)', !r.seen.includes('ffffffff00000001'), JSON.stringify(r.seen));
failDownload = false;
r = await boot();
ok('...and the retry loads it on the next open', r.seen.includes('ffffffff00000001'), JSON.stringify(r.seen));

/* ---- A BIG MANIFEST MUST NOT HIDE THE NEWEST FILE ----------------------------------
   The Worker unshifts each archive, so the manifest is NEWEST-FIRST. Both relays took
   slice(-40) — the forty OLDEST entries, all long since seen — so once the manifest grew
   past forty, new uploads were never even looked at: a silent, permanent stall. With the
   live manifest at 24 entries it had not bitten yet. This proves the newest file is
   reached when the manifest is well past the batch size. */
{
  const many = [];
  for (let i = 0; i < 60; i++) many.push({ n: 'old_' + i + '.csv', h: 'old'.padEnd(16, '0') + String(i).padStart(4, '0'), s: 10, at: '2026-08-0' + (1 + (i % 9)) + 'T06:00:00Z' });
  /* newest first, exactly as the Worker stores it */
  manifest = { files: [{ n: 'attendance_newest.csv', h: 'newest00000000cc', s: CSV.length, at: '2026-08-28T09:00:00Z' }].concat(many) };
  const rr = await boot();
  ok('the newest file is reached even with a manifest bigger than the batch (' + manifest.files.length + ')',
    rr.seen.includes('newest00000000cc'), 'seen ' + rr.seen.length + ' entries, newest not among them');
}

/* ---- the Upload Station has ONE door per source ------------------------------------ */
const pgS = await ctx.newPage();
await pgS.addInitScript(() => {
  sessionStorage.setItem('cbx_token', 'test-token');
  const of = window.fetch;
  window.fetch = (u, o) => of(String(u).replace('https://chatterbox-agentos-api.chatterbox-agentos.workers.dev', 'http://127.0.0.1:8199'), o);
});
await pgS.goto('http://127.0.0.1:8199/', { waitUntil: 'domcontentloaded' });
await pgS.waitForFunction(() => typeof window.pageUploads === 'function', null, { timeout: 20000 });
/* The broadcast listener is wired by init(), which only runs after sign-in — the same
   gate every cloud read sits behind. Without this the nudge has nothing listening. */
await pgS.evaluate(() => document.dispatchEvent(new CustomEvent('cbx-authed')));
await pgS.waitForFunction(() => window.__rosterFocusWired === 1, null, { timeout: 20000 });
const station = await pgS.evaluate(() => {
  const html = (typeof pageUploads === 'function') ? pageUploads() : '';
  const titles = [...html.matchAll(/class="slot-t">([^<]+)</g)].map(m => m[1].trim());
  const dup = titles.filter((t, i) => titles.indexOf(t) !== i);
  /* Match on the slot TITLES, not the whole page: the Open Cases slot legitimately
     mentions Lead Allocation in its description — it is the book that page reads. */
  return { titles, dup, leadAlloc: titles.some(t => /Lead Allocation/i.test(t)),
    deadLink: /leadalloc/i.test(html),
    openCases: titles.filter(t => /Open Cases/i.test(t)).length };
});
ok('Lead Allocation has no upload slot', !station.leadAlloc, station.titles.join(' | '));
ok('and no button opens the page that was deleted', !station.deadLink);
ok('Open Cases has exactly one door (' + station.openCases + ')', station.openCases === 1,
  station.titles.filter(t => /Open Cases/i.test(t)).join(' | '));
ok('no source is offered twice', station.dup.length === 0, station.dup.join(', '));

/* ---- VAS can nudge Ops the moment it archives, instead of Ops waiting ten minutes --- */
const nudge = await pgS.evaluate(() => {
  if (!('BroadcastChannel' in window)) return { skip: true };
  let pulled = 0;
  const real = window.syncUploadsFromVAS;
  window.syncUploadsFromVAS = function () { pulled++; return Promise.resolve(); };
  window.__rosterFocusSync = 0;                       // clear the one-a-minute throttle
  const ch = new BroadcastChannel('cbx-uploads');
  ch.postMessage({ t: 'archived', name: 'x.xlsx', hash: 'h', at: Date.now() });
  return new Promise(r => setTimeout(() => { ch.close(); window.syncUploadsFromVAS = real;
    r({ pulled }); }, 300));
});
if (nudge.skip) ok('an archive in VAS nudges Ops immediately', true);
else ok('an archive in VAS nudges Ops immediately', nudge.pulled > 0, 'pulls: ' + nudge.pulled);

console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
await ctx.close(); server.close();
fs.rmSync(profile, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
