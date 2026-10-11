/* ONE-OFF: add `tl` to the published agent digest.
 *
 * PULSE now publishes the team leader on every digest row (agentDigestPayload),
 * but the copy sitting in Supabase was written before that change and Agent
 * Analytics cannot scope a team leader without it. PULSE republishes on its own
 * cadence the moment somebody opens it, so this is only needed to bridge the gap
 * — run it once after deploying the PULSE change, or any time
 * `verify-agent-portal.mjs` reports the digest is missing team leaders.
 *
 * It is a JOIN, not a recalculation: `tl` is copied from the roster in
 * kv:vas-state onto the matching digest row by CB number. No metric is touched,
 * no formula is repeated. If PULSE has already published rows carrying `tl`, this
 * exits without writing.
 *
 *   node tools/digest-backfill-tl.mjs [--apply]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { responseText } from './kv-store.mjs';   // the VAS state is kept gzipped at rest (Spec Kit 031)

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APPLY = process.argv.includes('--apply');
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, 'supabase.env'), 'utf8')
  .split(/\r?\n/).filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const H = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY, 'Content-Type': 'application/json' };

const read = async (key) => {
  const r = await (await fetch(`${env.SUPABASE_URL}/rest/v1/rules?key=eq.${encodeURIComponent(key)}&select=value`, { headers: H })).json();
  const v = r?.[0]?.value; if (!v) return null;
  let p = String(v.data || '');
  if (!p && v.store) p = await responseText(await fetch(`${env.SUPABASE_URL}/storage/v1/object/raw/${v.store.replace(/^raw\//, '')}`, { headers: H }));
  return { meta: v, json: p ? JSON.parse(p) : null };
};

const norm = (v) => { const d = String(v ?? '').toUpperCase().replace(/[^0-9]/g, ''); return d ? 'CB' + parseInt(d, 10) : ''; };

const dg = await read('kv:agent-digest');
if (!dg?.json) { console.error('No agent digest published yet.'); process.exit(2); }
const st = await read('kv:vas-state');
if (!st?.json?.roster?.length) { console.error('No roster in vas-state.'); process.exit(2); }

const tlOf = new Map(st.json.roster.map(a => [norm(a.code), String(a.tl || '').trim()]));
const d = dg.json;
let filled = 0, already = 0, unknown = 0;
for (const list of [d.agents || [], d.notCovered || []]) {
  for (const a of list) {
    if (a.tl) { already++; continue; }
    const tl = tlOf.get(norm(a.code));
    if (tl) { a.tl = tl; filled++; } else { unknown++; }
  }
}
console.log(`digest rows: ${(d.agents || []).length} agents + ${(d.notCovered || []).length} not-covered`);
console.log(`  already had tl: ${already} · filled: ${filled} · no roster match: ${unknown}`);
if (!filled) { console.log('Nothing to do.'); process.exit(0); }

if (!APPLY) { console.log('DRY RUN — pass --apply to write.'); process.exit(0); }

/* Written back the same way the Worker reads it: inline `data` if it fits, else
   the storage object the existing row already points at. */
const payload = JSON.stringify(d);
if (dg.meta.store) {
  const put = await fetch(`${env.SUPABASE_URL}/storage/v1/object/raw/${dg.meta.store.replace(/^raw\//, '')}`, {
    method: 'PUT', headers: { ...H, 'Content-Type': 'application/json', 'x-upsert': 'true' }, body: payload });
  if (!put.ok) { console.error('storage write failed: ' + put.status + ' ' + (await put.text()).slice(0, 200)); process.exit(1); }
} else {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rules?key=eq.${encodeURIComponent('kv:agent-digest')}`, {
    method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' },
    body: JSON.stringify({ value: { ...dg.meta, data: payload }, updated_by: 'digest-backfill-tl', updated_at: new Date().toISOString() }) });
  if (!r.ok) { console.error('rules write failed: ' + r.status + ' ' + (await r.text()).slice(0, 200)); process.exit(1); }
}
console.log(`APPLIED — ${filled} rows now carry their team leader.`);
