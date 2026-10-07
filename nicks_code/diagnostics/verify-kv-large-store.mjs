#!/usr/bin/env node
/* verify-kv-large-store.mjs — A STORE BIGGER THAN THE SERVER'S MEMORY STILL SAVES (Spec Kit 013, 2026-10-07).
 *
 * Ops' ViciDial store (one row per call) reached 132.7 MB. Every save is sent gzipped and the Worker decompressed the
 * WHOLE body before storing it — past its memory ("could not decompress the upload: Memory limit exceeded before EOF"),
 * so nothing ViciDial has saved since 28 Sep and every relay cycle failed the same save again. This drives the REAL
 * Worker module against a stubbed store and proves: a large gzip is kept compressed (never inflated whole), read back
 * byte-for-byte with Content-Encoding: gzip; small saves are unchanged; and every direct reader copes.
 *
 *   node nicks_code/diagnostics/verify-kv-large-store.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const worker = (await import(pathToFileURL(path.join(ROOT, 'worker', 'src', 'index.mjs')).href)).default;
const health = await import(pathToFileURL(path.join(ROOT, 'worker', 'src', 'health.mjs')).href);
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m + (d ? ' — ' + d : '')); } };
const head = (t) => console.log('\n' + t);

/* ── a stubbed Supabase: rules rows, storage objects (bytes), the write log, one admin session ── */
const rules = {}, store = {}, writeLog = [];
const ENV = { SUPABASE_URL: 'http://stub.local', SUPABASE_SECRET_KEY: 'k' };
const J = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
globalThis.fetch = async (u, o = {}) => {
  const url = String(u), method = (o.method || 'GET').toUpperCase();
  if (url.includes('/rest/v1/app_sessions')) return J([{ user_id: 'u1', expires_at: '2099-01-01T00:00:00Z', scope: 'full',
    app_users: { username: 'nick', full_name: 'Nick', role: 'admin', apps: null, tabs: null, pii_unmask: true, active: true, cb: null, team: null, hub_ids: null, must_change_password: false } }]);
  if (url.includes('/rest/v1/kv_write_log')) { if (method === 'POST') writeLog.push(...JSON.parse(o.body)); return J([]); }
  if (url.includes('/rest/v1/rules')) {
    const m = /key=eq\.([^&]+)/.exec(url); const k = m ? decodeURIComponent(m[1]) : '';
    if (method === 'GET') return J(rules[k] ? [{ key: k, value: rules[k].value, updated_at: rules[k].updated_at }] : []);
    if (method === 'POST') { for (const row of JSON.parse(o.body)) rules[row.key] = { value: row.value, updated_at: row.updated_at }; return J([]); }
    return J([]);
  }
  if (url.startsWith('http://stub.local/storage/v1/object/list/')) return J([]);   // the snapshot's prune listing
  if (url.startsWith('http://stub.local/storage/v1/object/')) {
    const p = decodeURIComponent(url.replace('http://stub.local/storage/v1/object/', ''));
    if (method === 'GET') return store[p] ? new Response(store[p].bytes, { status: 200 }) : new Response('', { status: 404 });
    if (method === 'HEAD') return store[p] ? new Response(null, { status: 200, headers: { 'content-length': String(store[p].bytes.length) } }) : new Response(null, { status: 404 });
    if (method === 'POST' || method === 'PUT') {
      const b = o.body instanceof Uint8Array || Buffer.isBuffer(o.body) ? Buffer.from(o.body) : typeof o.body === 'string' ? Buffer.from(o.body, 'utf8')
        : Buffer.from(await new Response(o.body).arrayBuffer());
      store[p] = { bytes: b, type: (o.headers || {})['Content-Type'] || '' }; return J({ Key: p });
    }
    if (method === 'DELETE') { delete store[p]; return J({}); }
  }
  return new Response('', { status: 404 });
};
const pending = [];
const ctx = { waitUntil: (p) => { pending.push(p); } };
const call = async (method, q, body, extra = {}) => {
  const req = new Request('https://api.local/api/kv?' + q, { method, headers: { Authorization: 'Bearer t', 'X-Cbx-Client': 'v5', ...extra }, body });
  const r = await worker.fetch(req, ENV, ctx); await Promise.all(pending.splice(0)); return r;
};
const isGz = (b) => b && b.length > 1 && b[0] === 0x1f && b[1] === 0x8b;

/* fixtures: a small store, and a call store past the 32 MiB line (repetitive, so its gzip is small) */
const row = '{"call_date":"2026-10-07 09:00:00","user":"CB1","length_in_sec":"60","status":"SALE"},';
const small = '[' + row.repeat(1000).slice(0, -1) + ']';
const bigText = '[' + row.repeat(Math.ceil((33 * 1048576) / row.length)).slice(0, -1) + ']';
const bigGz = zlib.gzipSync(Buffer.from(bigText, 'utf8'));
console.log('  fixtures: small ' + small.length + ' B · large ' + (bigText.length / 1048576).toFixed(1) + ' MiB → ' + (bigGz.length / 1024).toFixed(0) + ' KiB gzip');

head('A · a store under the line is saved exactly as before (plain JSON)');
{
  const r = await call('POST', 'key=cb-facts-ATTENDANCE', zlib.gzipSync(Buffer.from(small)));
  ok(r.status === 200, 'a small gzipped save is accepted', r.status + ' ' + (await r.clone().text()).slice(0, 120));
  const s = store['raw/kv/cb-facts-ATTENDANCE'];
  ok(s && !isGz(s.bytes) && s.bytes.toString('utf8') === small, '…and stored as the same plain JSON every reader expects');
}

head('B · a store past the line is kept compressed — never inflated whole');
{
  const r = await call('POST', 'key=cb-facts-VICI_CALL_REPORT', bigGz);
  const t = await r.clone().text();
  ok(r.status === 200 && /"ok":true/.test(t), 'a 33 MiB call store saves (it used to die "Memory limit exceeded")', r.status + ' ' + t.slice(0, 140));
  const s = store['raw/kv/cb-facts-VICI_CALL_REPORT'];
  ok(s && isGz(s.bytes) && Buffer.compare(s.bytes, bigGz) === 0, '…stored as the very gzip bytes that were sent', s ? (isGz(s.bytes) ? 'gzip, ' + s.bytes.length + ' B' : 'PLAIN ' + s.bytes.length + ' B') : 'nothing stored');
  ok(rules['kv:cb-facts-VICI_CALL_REPORT'] && rules['kv:cb-facts-VICI_CALL_REPORT'].value.store === 'raw/kv/cb-facts-VICI_CALL_REPORT', '…behind the usual pointer');
  const wl = writeLog.find((w) => w.key === 'cb-facts-VICI_CALL_REPORT');
  ok(wl && +wl.bytes === bigText.length, 'the write log records the UNPACKED size', JSON.stringify(wl));
}

head('C · a load hands the compressed store back so the browser unpacks it');
{
  const r = await call('GET', 'key=cb-facts-VICI_CALL_REPORT');
  const b = Buffer.from(await r.arrayBuffer());
  ok(r.status === 200 && /gzip/i.test(r.headers.get('content-encoding') || ''), 'Content-Encoding: gzip', r.status + ' ' + r.headers.get('content-encoding'));
  ok(Buffer.compare(b, bigGz) === 0, '…and the bytes are exactly what was stored', b.length + ' B');
  let unpacked = ''; try { unpacked = zlib.gunzipSync(b).toString('utf8'); } catch (e) { unpacked = 'not gzip: ' + e.message; }
  ok(unpacked === bigText, 'which unpack to the same call store', unpacked.slice(0, 60));
  const p = await call('GET', 'key=cb-facts-ATTENDANCE');
  ok(!p.headers.get('content-encoding') && (await p.text()) === small, 'a plain store loads exactly as before (no Content-Encoding)');
}

head('D · what is not JSON, or not gzip, is refused — never stored');
{
  const before = store['raw/kv/cb-facts-SF_INACTIVE'];
  const notJson = zlib.gzipSync(Buffer.from('x'.repeat(33 * 1048576)));
  const r1 = await call('POST', 'key=cb-facts-SF_INACTIVE', notJson);
  ok(r1.status === 400 && /JSON/i.test(await r1.text()), 'a large gzip that is not JSON → 400');
  const broken = Buffer.concat([bigGz.subarray(0, 10), Buffer.alloc(2000, 7), bigGz.subarray(bigGz.length - 8)]);
  const r2 = await call('POST', 'key=cb-facts-SF_INACTIVE', broken);
  ok(r2.status === 400, 'a corrupt gzip → 400', String(r2.status));
  ok(store['raw/kv/cb-facts-SF_INACTIVE'] === before, 'nothing was stored for either');
}

head('E · the keys the server reads are never stored compressed');
{
  const r = await call('POST', 'key=vas-state', bigGz);
  ok(r.status === 413, 'a server-read key (vas-state) past the line → 413, not a compressed blob', String(r.status));
}

head('F · the daily snapshot copies a compressed store as it is (a restore unpacks once)');
{
  const today = new Date(Date.now() + 2 * 3600000).toISOString().slice(0, 10);
  rules['kv:cb-facts-VICI_CALL_REPORT'].updated_at = new Date().toISOString();
  const DBs = {
    select: async (q) => {
      if (/like\./.test(q)) return [{ key: 'kv:cb-facts-VICI_CALL_REPORT' }];
      const m = /key=eq\.([^&]+)/.exec(q); const k = m ? decodeURIComponent(m[1]) : '';
      return rules[k] ? [{ updated_at: rules[k].updated_at }] : [];
    },
  };
  await health.dailySnapshots(ENV, DBs);
  const snap = store['raw/kv-history/cb-facts-VICI_CALL_REPORT/' + today + '.json.gz'];
  let inner = null; try { inner = snap ? zlib.gunzipSync(snap.bytes) : null; } catch (e) { inner = null; }
  ok(snap && isGz(snap.bytes) && inner && !isGz(inner), 'the snapshot is gzip ONCE (never gzip of gzip)', snap ? 'inner gzip: ' + (inner ? isGz(inner) : 'unreadable') : 'no snapshot');
}

head('G · every tool that reads a store directly copes with a compressed one');
{
  const helper = path.join(ROOT, 'tools', 'kv-store.mjs');
  ok(fs.existsSync(helper), 'tools/kv-store.mjs exists');
  if (fs.existsSync(helper)) {
    const kv = await import(pathToFileURL(helper).href);
    ok(kv.storeText(bigGz) === bigText && kv.storeText(Buffer.from(small)) === small, 'storeText() unpacks gzip and passes plain through');
  }
  for (const t of ['lake-load.mjs', 'nba-republish.mjs', 'dedupe-facts.mjs']) {
    const src = fs.readFileSync(path.join(ROOT, 'tools', t), 'utf8');
    ok(/storeText\(/.test(src) && /kv-store\.mjs/.test(src), t + ' reads stores through storeText()');
  }
  const bk = fs.readFileSync(path.join(ROOT, 'tools', 'backup-facts.mjs'), 'utf8');
  ok(/isGzip\(/.test(bk), 'backup-facts copies a gzip store as it is (isGzip)');
}

console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
process.exit(fail ? 1 : 0);
