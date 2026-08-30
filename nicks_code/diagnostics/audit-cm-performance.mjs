#!/usr/bin/env node
/**
 * audit-cm-performance.mjs — how fast is the campaign manager view, and where
 * does the time actually go?
 *
 *   node nicks_code/diagnostics/audit-cm-performance.mjs --live
 *
 * Measures the deployed Worker, not a stub, because every interesting cost in
 * this view is a network cost: Supabase for the digest, HighLevel for the
 * register, and a rules-table scan for the SLA mirror rows.
 *
 * COLD vs WARM matters more here than in most of the suite. The Worker caches
 * the campaign context for 5 minutes, the mirror rows for 30 seconds and the HL
 * pipeline for 5 minutes, all on globalThis — so the FIRST request into a fresh
 * isolate pays for everything and the next ones pay for almost nothing. A single
 * timing would flatter or damn the page depending on which one it landed on.
 *
 * Signs in with a short-lived session (no password is in the repo) and deletes it
 * in a finally block.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

if (!process.argv.includes('--live')) { console.log('Measures PRODUCTION. Re-run with --live.'); process.exit(0); }

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, 'supabase.env'), 'utf8')
  .split(/\r?\n/).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const H = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY, 'Content-Type': 'application/json' };
const REST = env.SUPABASE_URL + '/rest/v1/';
const API = 'https://chatterbox-agentos-api.chatterbox-agentos.workers.dev';

const token = crypto.randomBytes(32).toString('hex');
const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
const findings = [];
const add = (sev, what, detail) => findings.push({ sev, what, detail });

async function timed(p) {
  const t0 = performance.now();
  const r = await fetch(API + p, { headers: { Authorization: 'Bearer ' + token, 'X-Cbx-Client': 'v5' } });
  const body = await r.text();
  return { ms: Math.round(performance.now() - t0), status: r.status, bytes: body.length, body };
}
const stat = (xs) => { const s = xs.slice().sort((a, b) => a - b); return { min: s[0], med: s[Math.floor(s.length / 2)], max: s[s.length - 1] }; };
const kb = (n) => (n / 1024).toFixed(0) + ' KB';

try {
  const u = (await (await fetch(REST + 'app_users?username=eq.dalwin&select=id,username', { headers: H })).json())[0];
  await fetch(REST + 'app_sessions', { method: 'POST', headers: { ...H, Prefer: 'return=minimal' },
    body: JSON.stringify([{ token_hash: tokenHash, user_id: u.id, expires_at: new Date(Date.now() + 10 * 60000).toISOString(), user_agent: 'audit-cm-perf' }]) });

  console.log('\n\x1b[1m1 · ROUTE LATENCY — cold isolate vs warm\x1b[0m');
  console.log('  (the first call of each is whatever isolate answered; the rest are warm)\n');
  const routes = ['/api/portal/me', '/api/portal/overview', '/api/portal/cm/assist', '/api/portal/cm/eod'];
  const results = {};
  for (const p of routes) {
    const runs = [];
    for (let i = 0; i < 6; i++) runs.push(await timed(p));
    const bad = runs.find((r) => r.status !== 200);
    const ms = runs.map((r) => r.ms);
    const s = stat(ms.slice(1));                       // drop the first — that is the cold one
    results[p] = { first: ms[0], ...s, bytes: runs[runs.length - 1].bytes, status: runs[0].status, body: runs[runs.length - 1].body };
    console.log(`  ${p.padEnd(28)} first ${String(ms[0]).padStart(5)}ms   warm min/med/max ${String(s.min).padStart(4)}/${String(s.med).padStart(4)}/${String(s.max).padStart(4)}ms   ${kb(runs[0].bytes).padStart(8)}${bad ? '   STATUS ' + bad.status : ''}`);
  }
  const ov = results['/api/portal/overview'];
  if (ov.med > 1500) add('WARN', 'the campaign page takes ' + ov.med + 'ms warm', 'That is the whole page — a manager waits this long on every open.');
  if (ov.bytes > 600 * 1024) add('WARN', 'the overview payload is ' + kb(ov.bytes), 'It travels on every open, including on a phone.');

  console.log('\n\x1b[1m2 · WHERE THE TIME GOES\x1b[0m');
  const me = results['/api/portal/me'].med;
  console.log(`  session + routing floor (/api/portal/me)      ~${me}ms`);
  console.log(`  + digest read, 14 measures, ladder, brief     ~${Math.max(0, results['/api/portal/overview'].med - me)}ms  (overview − floor)`);
  console.log(`  + HighLevel register on its own              ~${Math.max(0, results['/api/portal/cm/assist'].med - me)}ms  (assist − floor)`);
  console.log(`  the EOD pack rebuilds both                    ~${results['/api/portal/cm/eod'].med}ms`);

  console.log('\n\x1b[1m3 · PAYLOAD — what actually crosses the wire\x1b[0m');
  const body = JSON.parse(results['/api/portal/overview'].body || '{}');
  const size = (o) => JSON.stringify(o == null ? null : o).length;
  const parts = [['cm (sales half)', size(body.cm)], ['assist (register)', size(body.assist)],
    ['agents/other', size(body) - size(body.cm) - size(body.assist)]];
  for (const [n, b] of parts) console.log(`  ${n.padEnd(24)} ${kb(b).padStart(9)}`);
  if (body.cm && body.cm.campaigns) {
    for (const c of body.cm.campaigns)
      console.log(`    ${c.label.padEnd(12)} ${String(c.agents).padStart(3)} agents · agentIndex ${kb(size(c.agentIndex)).padStart(8)} · teams ${kb(size(c.teams)).padStart(8)}`);
  }

  console.log('\n\x1b[1m4 · THE MIRROR-ROW SCAN — does it scale?\x1b[0m');
  /* assistList does ONE `rules?key=like.kv:cm-areq:*` select. That is a prefix
     LIKE over the whole rules table, which today holds ~35 rows — but it grows by
     one row per assistance request, for ever. Measure it directly against
     Supabase so the cost is attributable, not buried in the route. */
  const scan = [];
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    const rows = await (await fetch(REST + 'rules?key=like.' + encodeURIComponent('kv:cm-areq:*') + '&select=key,value', { headers: H })).json();
    scan.push({ ms: Math.round(performance.now() - t0), n: Array.isArray(rows) ? rows.length : -1 });
  }
  const all = await (await fetch(REST + 'rules?select=key', { headers: H })).json();
  const s4 = stat(scan.map((x) => x.ms));
  console.log(`  rules table today: ${all.length} rows · assistance mirrors: ${scan[0].n}`);
  console.log(`  prefix scan min/med/max: ${s4.min}/${s4.med}/${s4.max}ms`);
  const idx = await (await fetch(REST + 'rpc/', { headers: H })).text().catch(() => '');
  if (scan[0].n === 0) add('INFO', 'the mirror scan is measured empty (0 requests raised yet)',
    'It is a prefix LIKE over the whole rules table and grows by one row per request for ever. Re-measure once a few hundred exist; if it degrades, the fix is a dedicated table or a key index.');

  console.log('\n\x1b[1m5 · CACHE BEHAVIOUR — does an action show up immediately?\x1b[0m');
  /* The Worker holds the mirror rows for 30s and the campaign context for 5min on
     globalThis. Cloudflare may answer two requests from DIFFERENT isolates, each
     with its own cache — so the question is not "is there a cache" but "can a
     manager act and then see a stale page". */
  const a1 = await timed('/api/portal/cm/assist');
  const j1 = JSON.parse(a1.body || '{}');
  console.log(`  register: ${(j1.requests || []).length} request(s) · stages ${(j1.stages || []).length} · truncated ${!!j1.truncated}`);
  const spread = [];
  for (let i = 0; i < 8; i++) { const x = await timed('/api/portal/cm/assist'); spread.push(x.ms); }
  const s5 = stat(spread);
  console.log(`  8 consecutive register reads: ${s5.min}/${s5.med}/${s5.max}ms`);
  if (s5.max > s5.med * 3 && s5.max > 900)
    add('WARN', 'register latency is spiky (' + s5.min + '→' + s5.max + 'ms)',
      'Consistent with landing on a cold isolate that must re-read HighLevel. A manager sees an occasional slow tab, not a steady one.');

  console.log('\n\x1b[1m6 · THE OTHER TWO VIEWS still answer normally\x1b[0m');
  for (const p of ['/api/portal/me', '/api/portal/overview']) {
    const x = await timed(p);
    console.log(`  ${p.padEnd(28)} ${x.status} ${String(x.ms).padStart(5)}ms`);
  }
} finally {
  const del = await fetch(REST + 'app_sessions?token_hash=eq.' + tokenHash, { method: 'DELETE', headers: H });
  console.log('\n(temporary session ' + (del.ok ? 'deleted' : 'DELETE FAILED: ' + tokenHash) + ')');
}

console.log('\n\x1b[1mFINDINGS\x1b[0m');
if (!findings.length) console.log('  none — nothing measured above the thresholds.');
for (const f of findings) console.log(`  ${f.sev === 'WARN' ? '\x1b[33m' : '\x1b[36m'}${f.sev}\x1b[0m ${f.what}\n        ${f.detail}`);
