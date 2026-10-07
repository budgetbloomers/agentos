/* ONE ROW, ONE FACT — deduplicate the stored fact blobs against specs/source_keys.json.
 *
 * The upload stations appended for six of the nine sources, so the same export loaded twice
 * landed twice. The closed-case store is the extreme: 141 535 rows carrying 35 463 cases,
 * because one export was loaded seven times (batches B0043-B0048 and B0071, each exactly
 * 17 446 rows). This is the one-off pass that clears what is already there; the ingest-side
 * fix stops it happening again.
 *
 *   node tools/dedupe-facts.mjs                 # dry run: report per source, write nothing
 *   node tools/dedupe-facts.mjs --apply         # rewrite the stores
 *   node tools/dedupe-facts.mjs --key cb-facts-SF_CLOSED_CASES --apply
 *
 * IT WILL NOT WRITE WITHOUT A BACKUP. Every --apply checks that today's copy exists at
 * raw/kv-history/<key>/<date>.json.gz (tools/backup-facts.mjs puts it there) and refuses the
 * source otherwise. A backfill without a way back is a bet, not a backfill.
 *
 * KEEP THE LAST ROW. Where a key repeats, the later row wins: a re-export carries the
 * current status, disposition and age. Row order in the blob is upload order, so "later in
 * the array" is "more recently uploaded" — the same rule ingest applies.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { storeText } from './kv-store.mjs';   // a store may be kept gzipped at rest (spec 013)

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, 'supabase.env'), 'utf8')
  .split(/\r?\n/).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const H = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY };
const SPEC = JSON.parse(fs.readFileSync(path.join(ROOT, 'specs', 'source_keys.json'), 'utf8'));

const APPLY = process.argv.includes('--apply');
const keyFlag = process.argv.indexOf('--key');
const ONE = keyFlag > 0 && process.argv[keyFlag + 1] && !process.argv[keyFlag + 1].startsWith('--')
  ? process.argv[keyFlag + 1].replace(/^cb-facts-/, '') : '';
const today = new Date(Date.now() + 2 * 3600000).toISOString().slice(0, 10);

/* The key of a row, or null when it cannot be keyed. An unkeyable row is KEPT — it is a
   reporting problem, not a duplicate, and dropping it would lose a fact to tidy a store. */
const keyOf = (row, fields) => {
  const parts = [];
  for (const f of fields) {
    const v = row[f];
    if (v == null || v === '') return null;
    parts.push(String(v));
  }
  return parts.join('');
};

/* The session slots take the key of the source they snapshot. */
const specFor = (src) => SPEC.sources[src] || SPEC.sources[(SPEC.session_sources || {})[src]] || null;

const list = await (await fetch(`${env.SUPABASE_URL}/storage/v1/object/list/raw`, {
  method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
  body: JSON.stringify({ prefix: 'kv/', limit: 200 }) })).json();
const sources = list.filter((o) => /^cb-facts-/.test(o.name))
  .map((o) => o.name.replace(/^cb-facts-/, ''))
  .filter((s) => !ONE || s === ONE)
  .sort();

console.log((APPLY ? 'APPLYING' : 'DRY RUN — nothing will be written') + '\n');
let totalDropped = 0, totalBytes = 0, wrote = 0;

for (const src of sources) {
  const spec = specFor(src);
  const key = 'cb-facts-' + src;
  if (!spec) { console.log('  ' + src.padEnd(22) + 'no identity rule in specs/source_keys.json — skipped'); continue; }

  const r = await fetch(`${env.SUPABASE_URL}/storage/v1/object/raw/kv/${key}`, { headers: H });
  if (!r.ok) { console.log('  ' + src.padEnd(22) + 'read failed ' + r.status); continue; }
  const text = storeText(Buffer.from(await r.arrayBuffer()));   // plain or kept-compressed (spec 013)
  let rows; try { rows = JSON.parse(text); } catch { console.log('  ' + src.padEnd(22) + 'not JSON — skipped'); continue; }
  if (!Array.isArray(rows)) { console.log('  ' + src.padEnd(22) + 'not an array — skipped'); continue; }

  /* Last wins: walk forward, overwrite the slot, then emit in first-seen order so the
     blob's shape stays recognisable to anything that reads it positionally. */
  const slot = new Map(); const unkeyable = []; const order = [];
  for (const row of rows) {
    const k = keyOf(row, spec.key);
    if (k == null) { unkeyable.push(row); continue; }
    if (!slot.has(k)) order.push(k);
    slot.set(k, row);
  }
  const out = order.map((k) => slot.get(k)).concat(unkeyable);
  const dropped = rows.length - out.length;
  const bytes = text.length - JSON.stringify(out).length;

  const pct = rows.length ? ((dropped / rows.length) * 100).toFixed(1) : '0.0';
  console.log('  ' + src.padEnd(22) + String(rows.length).padStart(7) + ' → ' + String(out.length).padStart(7)
    + '   dropped ' + String(dropped).padStart(6) + ' (' + pct.padStart(4) + '%)'
    + '   ' + (bytes / 1048576).toFixed(2).padStart(6) + ' MB saved'
    + (unkeyable.length ? '   unkeyable kept: ' + unkeyable.length : '')
    + '   key=(' + spec.key.join(', ') + ')');

  totalDropped += dropped; totalBytes += bytes;
  if (!dropped || !APPLY) continue;

  /* the backup gate */
  const snap = await fetch(`${env.SUPABASE_URL}/storage/v1/object/raw/kv-history/${key}/${today}.json.gz`,
    { method: 'HEAD', headers: H });
  if (!snap.ok) { console.log('      REFUSED — no backup at raw/kv-history/' + key + '/' + today + '.json.gz. Run tools/backup-facts.mjs first.'); continue; }

  const body = JSON.stringify(out);
  const put = await fetch(`${env.SUPABASE_URL}/storage/v1/object/raw/kv/${key}`, {
    method: 'POST', headers: { ...H, 'Content-Type': 'application/json', 'x-upsert': 'true' }, body });
  if (!put.ok) { console.log('      WRITE FAILED ' + put.status + ' ' + (await put.text()).slice(0, 140)); continue; }

  /* the pointer row must say it changed, or the apps' conditional boot serves the old copy */
  const ptr = await fetch(`${env.SUPABASE_URL}/rest/v1/rules?key=eq.${encodeURIComponent('kv:' + key)}`, {
    method: 'PATCH', headers: { ...H, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ updated_at: new Date().toISOString(), updated_by: 'dedupe-facts' }) });
  console.log('      written' + (ptr.ok ? ' and pointer refreshed' : ' — POINTER PATCH FAILED ' + ptr.status));
  wrote++;
}

console.log('\n' + (APPLY ? wrote + ' store(s) rewritten. ' : '')
  + totalDropped.toLocaleString('en-ZA') + ' duplicate row(s), '
  + (totalBytes / 1048576).toFixed(1) + ' MB.');
if (!APPLY && totalDropped) console.log('Re-run with --apply to write. Every source is refused unless today\'s backup exists.');
