/**
 * manifest.mjs — the upload manifest cannot lose a file.
 *
 * WHY (Tuesday 2026-09-08): five files landed in the VAS Upload Station within five seconds.
 * The archive endpoint read kv:upload-manifest, pushed its entry and wrote the list back —
 * three of those overlapped and the ViciDial call report's entry lost. Its 5 MB blob sat in
 * raw/uploads/ with no manifest row, so the Ops dashboard never relayed Monday's calls, and
 * nothing said so. Two fixes, both here:
 *
 *   1. manifestAdd() — one Postgres statement under the row lock (migration-024,
 *      upload_manifest_add). Concurrent archivers serialise; nobody's entry is overwritten.
 *   2. reconcileManifest() — every cron tick lists raw/uploads/ and compares the 16-character
 *      hash prefix in each blob's name with the manifest. A blob the manifest does not know is
 *      downloaded, hashed (SHA-256, the same hash both stations compute) and re-added. Bounded
 *      to the last 7 days and two blobs per tick so a cron never spends its budget hashing.
 */
const DAY = 86400000;
export const MANIFEST_KEY = 'kv:upload-manifest';

/** Append one entry atomically. Returns 'added' | 'dupe'. */
export async function manifestAdd(DB, { name, hash, size, at, actor }) {
  const out = await DB.rpc('upload_manifest_add', { p_name: name, p_hash: hash, p_size: size || 0, p_at: at || new Date().toISOString(), p_actor: actor || 'relay' });
  return typeof out === 'string' ? out.replace(/"/g, '') : String(out && out.upload_manifest_add || out);
}

async function listUploads(env, days) {
  const r = await fetch(`${env.SUPABASE_URL}/storage/v1/object/list/raw`, {
    method: 'POST', headers: { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix: 'uploads', limit: 1000, sortBy: { column: 'created_at', order: 'desc' } }),
  });
  if (!r.ok) return [];
  const since = Date.now() - days * DAY;
  return ((await r.json()) || []).filter((o) => o && o.name && Date.parse(o.created_at || 0) >= since);
}

/** Pure: which storage objects have no manifest entry? Names are `<hash16>-<filename>`. */
export function orphans(objects, files) {
  const known = new Set((files || []).map((f) => String(f.h || '').slice(0, 16).toLowerCase()));
  return (objects || []).map((o) => { const m = /^([0-9a-f]{16})-(.+)$/i.exec(o.name); return m ? { obj: o, prefix: m[1].toLowerCase(), name: m[2] } : null; })
    .filter((x) => x && !known.has(x.prefix));
}

/* THE PENDING ARCHIVE UPLOADS ARE SWEPT (Spec Kit 031, review F3). An archive goes browser → Storage under
   raw/pending-uploads/ and is moved into raw/uploads/ by /api/upload-archive/complete. One that never completed — a
   closed tab, a failed size check — would sit there for ever. Every tick: ONE listing (oldest first) and at most ONE
   delete of up to `max` objects older than an hour — two subrequests, inside the tick's 50. Nothing reads that folder,
   so a sweep can never remove an archived file. */
export async function sweepPendingUploads(env, { olderThanMs = 3600000, max = 50 } = {}) {
  const H = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY, 'Content-Type': 'application/json' };
  const r = await fetch(`${env.SUPABASE_URL}/storage/v1/object/list/raw`, { method: 'POST', headers: H,
    body: JSON.stringify({ prefix: 'pending-uploads', limit: 100, sortBy: { column: 'created_at', order: 'asc' } }) });
  if (!r.ok) return { checked: 0, deleted: [], error: 'list ' + r.status };
  const cutoff = Date.now() - olderThanMs;
  const old = ((await r.json()) || []).filter((o) => o && o.id && o.name && Date.parse(o.created_at || 0) < cutoff).slice(0, max);
  if (!old.length) return { checked: 0, deleted: [] };
  const prefixes = old.map((o) => 'pending-uploads/' + o.name);
  const d = await fetch(`${env.SUPABASE_URL}/storage/v1/object/raw`, { method: 'DELETE', headers: H, body: JSON.stringify({ prefixes }) });
  if (!d.ok) return { checked: old.length, deleted: [], error: 'delete ' + d.status };
  return { checked: old.length, deleted: prefixes };
}

export async function reconcileManifest(env, DB, { days = 7, maxPerTick = 2 } = {}) {
  const objects = await listUploads(env, days);
  if (!objects.length) return { checked: 0, repaired: [] };
  const mr = await DB.select(`rules?key=eq.${encodeURIComponent(MANIFEST_KEY)}&select=value`).catch(() => null);
  const files = (mr && mr[0] && mr[0].value && mr[0].value.files) || [];
  const lost = orphans(objects, files).slice(0, maxPerTick);
  const repaired = [];
  for (const x of lost) {
    const r = await fetch(`${env.SUPABASE_URL}/storage/v1/object/raw/uploads/${encodeURIComponent(x.obj.name)}`, {
      headers: { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY } }).catch(() => null);
    if (!r || !r.ok) continue;
    const buf = await r.arrayBuffer();
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))].map((b) => b.toString(16).padStart(2, '0')).join('');
    if (!hash.startsWith(x.prefix)) { console.warn('[manifest] blob ' + x.obj.name + ' hashes to ' + hash.slice(0, 16) + ' — not the name it carries; left alone'); continue; }
    const res = await manifestAdd(DB, { name: x.name, hash, size: buf.byteLength, at: x.obj.created_at, actor: 'manifest-reconcile' }).catch((e) => 'error ' + (e && e.message));
    repaired.push(x.name + ' → ' + res);
  }
  if (repaired.length) console.warn('[manifest] re-added lost uploads: ' + repaired.join('; '));
  return { checked: objects.length, repaired };
}
