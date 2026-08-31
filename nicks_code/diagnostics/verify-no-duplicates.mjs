/* ONE ROW, ONE FACT — the live stores must hold no duplicate keys, and every key must
 * actually key its data.
 *
 * Born 2026-08-31, from a store that held the same closed-cases export seven times: 141 535
 * rows carrying 35 463 cases. Ingest now supersedes by key, but nothing watched, and this is
 * the kind of thing that returns quietly the first time a source is added.
 *
 * THREE CHECKS, AND THE SECOND ONE IS THE ONE THAT EARNS ITS KEEP:
 *
 *   1. No key repeats in any store.
 *
 *   2. Every key MATCHES ITS DATA. A key naming a field the rows do not carry silently keys
 *      nothing at all and protects nothing: AGENT_LIST was keyed (_d, cb_norm) while every
 *      roster row carries _d as null, and SES_DIAL_* was keyed as ViciDial while it actually
 *      holds CallX-shaped rows. Both reported a tidy "0 duplicates" while checking nothing.
 *      A store where nearly every row is unkeyable fails here.
 *
 *   3. The spec's recorded row counts are in the right order of magnitude. specs/source_keys
 *      .json carries what each store measured when its key was written; an order-of-magnitude
 *      departure means the store has been rewritten by something nobody described.
 *
 * Run: node verify-no-duplicates.mjs            (add --json for machine output)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, 'supabase.env'), 'utf8')
  .split(/\r?\n/).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const H = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY };
const SPEC = JSON.parse(fs.readFileSync(path.join(ROOT, 'specs', 'source_keys.json'), 'utf8'));
const JSON_OUT = process.argv.includes('--json');

let pass = 0, fail = 0; const failures = [];
const ok = (n, c, d = '') => {
  if (c) { pass++; if (!JSON_OUT) console.log('  ok   ' + n); }
  else { fail++; failures.push(n + (d ? ' — ' + d : '')); if (!JSON_OUT) console.log('  FAIL ' + n + ' — ' + d); }
};

const specFor = (src) => SPEC.sources[src] || SPEC.sources[(SPEC.session_sources || {})[src]] || null;
const keyOf = (row, fields) => {
  const parts = [];
  for (const f of fields) { const v = row[f]; if (v == null || v === '') return null; parts.push(String(v)); }
  return parts.join('');
};

const list = await (await fetch(`${env.SUPABASE_URL}/storage/v1/object/list/raw`, {
  method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
  body: JSON.stringify({ prefix: 'kv/', limit: 200 }) })).json();
const sources = list.filter((o) => /^cb-facts-/.test(o.name)).map((o) => o.name.replace(/^cb-facts-/, '')).sort();

const report = [];
for (const src of sources) {
  const spec = specFor(src);
  if (!spec) { ok(src + ' has an identity rule in specs/source_keys.json', false, 'no entry — a source nothing can dedupe'); continue; }

  const r = await fetch(`${env.SUPABASE_URL}/storage/v1/object/raw/kv/cb-facts-${src}`, { headers: H });
  if (!r.ok) { ok(src + ' store is readable', false, 'HTTP ' + r.status); continue; }
  let rows; try { rows = JSON.parse(await r.text()); } catch { ok(src + ' store parses', false, 'not JSON'); continue; }
  if (!Array.isArray(rows)) { ok(src + ' store is an array', false, typeof rows); continue; }

  const seen = new Map(); let unkeyable = 0, dupRows = 0;
  for (const row of rows) {
    const k = keyOf(row, spec.key);
    if (k == null) { unkeyable++; continue; }
    const n = (seen.get(k) || 0) + 1; seen.set(k, n);
    if (n > 1) dupRows++;
  }
  const keyed = rows.length - unkeyable;
  report.push({ src, rows: rows.length, distinct: seen.size, dupRows, unkeyable });

  ok(src + ' holds no duplicate keys (' + rows.length + ' rows)', dupRows === 0,
    dupRows + ' duplicate row(s) on (' + spec.key.join(', ') + ')');

  /* the check that catches a key naming fields the rows do not have */
  ok(src + ' key matches its data', rows.length === 0 || keyed / rows.length >= 0.5,
    unkeyable + ' of ' + rows.length + ' rows cannot be keyed by (' + spec.key.join(', ') + ') — the key names fields these rows do not carry');

  const claimed = (spec.measured && spec.measured.rows) || null;
  if (claimed) ok(src + ' row count is the order the spec recorded', rows.length >= claimed / 10 && rows.length <= claimed * 10,
    rows.length + ' now vs ' + claimed + ' when the key was written');
}

/* ---- AND THE LAKE, where the constraints actually live -----------------------------
   The blobs are what the apps read; the tables are what Postgres enforces. A blob can be
   clean while the table it feeds is not (or the reverse, if something wrote past the
   station), so both are checked here rather than in two places that can disagree.
   lake_duplicates (migration-017) states rows against distinct keys per source — the whole
   contract in one query. */
try {
  const r = await fetch(env.SUPABASE_URL + '/rest/v1/lake_duplicates?select=*&order=source',
    { headers: { ...H, Accept: 'application/json' } });
  if (!r.ok) ok('the lake audit view is readable', false, 'HTTP ' + r.status);
  else {
    const lake = await r.json();
    ok('the lake reports every source', Array.isArray(lake) && lake.length >= 8, JSON.stringify(lake).slice(0, 120));
    for (const t of (lake || [])) {
      const rows = Number(t.rows), keys = Number(t.distinct_keys);
      ok('lake: ' + t.source + ' is one row per key (' + rows + ')', rows === keys,
        (rows - keys) + ' more row(s) than keys — something wrote past the constraint');
    }
    const empty = (lake || []).filter((t) => Number(t.rows) === 0).map((t) => t.source);
    ok('every lake table has been loaded at least once', empty.length === 0,
      'never written: ' + empty.join(', ') + ' — a table nothing writes cannot enforce anything');
  }
} catch (e) { ok('the lake audit view is reachable', false, String(e.message).slice(0, 120)); }

if (JSON_OUT) console.log(JSON.stringify({ pass, fail, failures, report }, null, 2));
else {
  console.log('\n' + report.map((r) => '  ' + r.src.padEnd(22) + String(r.rows).padStart(7) + ' rows, '
    + String(r.distinct).padStart(7) + ' distinct'
    + (r.unkeyable ? ', ' + r.unkeyable + ' unkeyable' : '')).join('\n'));
  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  if (fail) console.log(failures.map((f) => '  · ' + f).join('\n'));
}
process.exit(fail ? 1 : 0);
