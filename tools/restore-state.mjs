#!/usr/bin/env node
/**
 * restore-state.mjs — put a state blob back the way it was on a given day.
 *
 *   node tools/restore-state.mjs                                   list snapshots
 *   node tools/restore-state.mjs --key vas-state --date 2026-08-27 show what would be restored
 *   node tools/restore-state.mjs --key vas-state --date 2026-08-27 --apply
 *
 * Phase 4b of specs/save-reliability-plan.md. The Worker cron writes one
 * gzipped copy of vas-state and cb-config per day the key changed, to
 * raw/kv-history/<key>/<date>.json.gz, kept 30 days. This is the other half:
 * the way back. Without --apply it prints the plan and touches NOTHING.
 *
 * --apply is deliberately belt-and-braces:
 *   1. the CURRENT live blob is stashed to kv-history/<key>/pre-restore-<ts>
 *      first, so a restore is itself reversible;
 *   2. the snapshot is written over raw/kv/<key> and the rules pointer is
 *      touched, so every open tab's freshness poll re-hydrates within minutes.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = {};
for (const line of fs.readFileSync(path.join(ROOT, 'supabase.env'), 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z_]+)=(.*)$/.exec(line.trim()); if (m) env[m[1]] = m[2];
}
const H = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY };
const STORE = env.SUPABASE_URL + '/storage/v1/object';

const arg = (n) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : null; };
const KEY = arg('key'), DATE = arg('date'), APPLY = process.argv.includes('--apply');

const listSnaps = async (key) => {
  const r = await fetch(STORE + '/list/raw', { method: 'POST',
    headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix: 'kv-history/' + key + '/', limit: 100, sortBy: { column: 'name', order: 'desc' } }) });
  if (!r.ok) return [];
  return ((await r.json()) || []).filter((o) => /\.json\.gz$/.test(o.name));
};

if (!KEY) {
  console.log('Snapshots on hand (the cron writes one per day the key changed, keeps 30):\n');
  for (const key of ['vas-state', 'cb-config']) {
    const snaps = await listSnaps(key);
    console.log('  ' + key + '  —  ' + (snaps.length ? snaps.length + ' snapshots' : 'none yet'));
    for (const s of snaps.slice(0, 10))
      console.log('    ' + s.name.replace('.json.gz', '').padEnd(28)
        + ((s.metadata && s.metadata.size) ? Math.round(s.metadata.size / 1024) + ' KB gz' : ''));
    if (snaps.length > 10) console.log('    … and ' + (snaps.length - 10) + ' more');
  }
  console.log('\nusage: node tools/restore-state.mjs --key vas-state --date YYYY-MM-DD [--apply]');
  process.exit(0);
}

if (!/^(vas-state|cb-config)$/.test(KEY)) { console.error('key must be vas-state or cb-config'); process.exit(1); }
if (!/^\d{4}-\d{2}-\d{2}$/.test(DATE || '')) { console.error('--date YYYY-MM-DD required'); process.exit(1); }

const snapPath = `raw/kv-history/${KEY}/${DATE}.json.gz`;
const r = await fetch(STORE + '/' + snapPath, { headers: H });
if (!r.ok) {
  console.error('No snapshot at ' + snapPath + ' (HTTP ' + r.status + '). Run with no arguments to list what exists.');
  process.exit(1);
}
const gz = Buffer.from(await r.arrayBuffer());
const plain = zlib.gunzipSync(gz);
let parsed = null; try { parsed = JSON.parse(plain.toString('utf8')); } catch (e) {}

console.log('SNAPSHOT ' + snapPath);
console.log('  ' + (gz.length / 1024).toFixed(0) + ' KB gzipped → ' + (plain.length / 1048576).toFixed(2) + ' MB plain'
  + (parsed ? '  ·  parses as JSON' : '  ·  DOES NOT PARSE — refusing to restore a corrupt copy'));
if (!parsed) process.exit(1);
if (parsed.files) console.log('  ' + parsed.files.length + ' files in its registry, newest: '
  + (parsed.files.map((f) => f.at).sort().slice(-1)[0] || '?'));
if (parsed._rev) console.log('  state revision: ' + new Date(parsed._rev).toISOString());

const cur = await fetch(STORE + '/raw/kv/' + KEY, { method: 'HEAD', headers: H });
console.log('\nLIVE ' + KEY + ': ' + (cur.ok
  ? (parseInt(cur.headers.get('content-length') || '0', 10) / 1048576).toFixed(2) + ' MB, last modified ' + cur.headers.get('last-modified')
  : 'missing (HTTP ' + cur.status + ')'));

if (!APPLY) {
  console.log('\n(plan only — nothing was changed. Add --apply to restore this snapshot over the live blob;'
    + '\n the live blob is stashed to kv-history first, so the restore is itself reversible.)');
  process.exit(0);
}

/* ---- apply ---- */
if (cur.ok) {
  const liveBody = await (await fetch(STORE + '/raw/kv/' + KEY, { headers: H })).arrayBuffer();
  const stash = `raw/kv-history/${KEY}/pre-restore-${new Date().toISOString().replace(/[:.]/g, '-')}.json.gz`;
  const put = await fetch(STORE + '/' + stash, { method: 'POST',
    headers: { ...H, 'Content-Type': 'application/gzip', 'x-upsert': 'true' },
    body: zlib.gzipSync(Buffer.from(liveBody)) });
  if (!put.ok) { console.error('Could not stash the live blob (' + put.status + ') — NOT restoring over an unbacked copy.'); process.exit(1); }
  console.log('\nstashed the live blob → ' + stash);
}

const w = await fetch(STORE + '/raw/kv/' + KEY, { method: 'POST',
  headers: { ...H, 'Content-Type': 'text/plain', 'x-upsert': 'true' }, body: plain });
if (!w.ok) { console.error('restore write failed: ' + w.status + ' ' + (await w.text()).slice(0, 200)); process.exit(1); }

/* touch the pointer so every open tab's freshness poll re-hydrates */
const now = new Date().toISOString();
const p = await fetch(env.SUPABASE_URL + '/rest/v1/rules', { method: 'POST',
  headers: { ...H, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
  body: JSON.stringify([{ key: 'kv:' + KEY, value: { store: 'raw/kv/' + KEY },
    updated_by: 'restore-state:' + DATE, updated_at: now }]) });
console.log('restored ' + KEY + ' to its ' + DATE + ' snapshot'
  + (p.ok ? '; the pointer was touched, so open tabs re-hydrate within minutes.' : ' — POINTER TOUCH FAILED (' + p.status + '), tabs may serve the old copy until their next boot.'));
