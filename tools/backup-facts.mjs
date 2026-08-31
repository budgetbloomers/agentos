/* BACK UP EVERY FACT STORE — the recovery point the dedupe work needs before it starts.
 *
 * The cron already snapshots `vas-state` and `cb-config` daily (worker/src/health.mjs,
 * dailySnapshots). It has never snapshotted the nine `cb-facts-*` blobs, which is precisely
 * the set that tools/dedupe-facts.mjs rewrites — 120 MB of uploaded source data whose only
 * copy is the live object. A backfill without a way back is not a backfill, it is a bet.
 *
 * Writes raw/kv-history/<key>/<date>.json.gz, the same shape and place the cron uses, so
 * tools/restore-state.mjs's path convention keeps working and one prune rule covers both.
 *
 *   node tools/backup-facts.mjs            # back up every fact store
 *   node tools/backup-facts.mjs --list     # show what is stored and what is already backed up
 *   node tools/backup-facts.mjs --key cb-facts-SF_CLOSED_CASES
 *
 * Read-only against the live stores: it copies, it never writes to kv/.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, 'supabase.env'), 'utf8')
  .split(/\r?\n/).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const H = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY };
const LIST_ONLY = process.argv.includes('--list');
const keyFlag = process.argv.indexOf('--key');
const ONE = (process.argv.find((a) => a.startsWith('--key=')) || '').slice(6)
  || (keyFlag > 0 && process.argv[keyFlag + 1] && !process.argv[keyFlag + 1].startsWith('--')
      ? process.argv[keyFlag + 1] : '');

/* SAST, no DST — the same stamp the cron's snapshots carry. */
const today = new Date(Date.now() + 2 * 3600000).toISOString().slice(0, 10);

const listKv = async () => {
  const r = await fetch(`${env.SUPABASE_URL}/storage/v1/object/list/raw`, {
    method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix: 'kv/', limit: 200 }) });
  if (!r.ok) throw new Error('cannot list kv/: ' + r.status);
  return (await r.json()).filter((o) => /^cb-facts-/.test(o.name));
};

const objects = (await listKv()).filter((o) => !ONE || ('kv/' + o.name) === ONE || o.name === ONE || ('cb-facts-' + o.name) === ONE);
objects.sort((a, b) => a.name.localeCompare(b.name));

let totalIn = 0, totalOut = 0, done = 0, skipped = 0;
for (const o of objects) {
  const key = o.name;
  const size = (o.metadata && o.metadata.size) || 0;
  totalIn += size;
  const snapPath = `raw/kv-history/${key}/${today}.json.gz`;

  const have = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${snapPath}`, { method: 'HEAD', headers: H });
  if (LIST_ONLY) {
    console.log('  ' + key.padEnd(30) + (size / 1048576).toFixed(2).padStart(7) + ' MB   '
      + (have.ok ? 'backed up today' : 'NOT backed up today'));
    continue;
  }
  if (have.ok) { skipped++; console.log('  ' + key.padEnd(30) + 'already copied today'); continue; }

  const src = await fetch(`${env.SUPABASE_URL}/storage/v1/object/raw/kv/${key}`, { headers: H });
  if (!src.ok) { console.log('  ' + key.padEnd(30) + 'READ FAILED ' + src.status); continue; }
  const buf = Buffer.from(await src.arrayBuffer());
  const gz = zlib.gzipSync(buf);
  const put = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${snapPath}`, {
    method: 'POST', headers: { ...H, 'Content-Type': 'application/gzip', 'x-upsert': 'true' }, body: gz });
  if (!put.ok) { console.log('  ' + key.padEnd(30) + 'WRITE FAILED ' + put.status + ' ' + (await put.text()).slice(0, 120)); continue; }
  totalOut += gz.length; done++;
  console.log('  ' + key.padEnd(30) + (buf.length / 1048576).toFixed(2).padStart(7) + ' MB → '
    + (gz.length / 1048576).toFixed(2) + ' MB gz   ' + snapPath);
}

if (LIST_ONLY) {
  console.log('\n' + objects.length + ' fact store(s), ' + (totalIn / 1048576).toFixed(1) + ' MB live.');
} else {
  console.log('\n' + done + ' backed up (' + (totalOut / 1048576).toFixed(1) + ' MB compressed from '
    + (totalIn / 1048576).toFixed(1) + ' MB), ' + skipped + ' already had today\'s copy.');
  console.log('Restore path: raw/kv-history/<key>/' + today + '.json.gz — gunzip and POST back to raw/kv/<key>.');
}
