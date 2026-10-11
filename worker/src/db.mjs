/** Minimal Supabase PostgREST client for Workers (service key, RLS bypass). */
export function db(env) {
  const base = env.SUPABASE_URL + '/rest/v1/';
  const H = {
    apikey: env.SUPABASE_SECRET_KEY,
    Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY,
    'Content-Type': 'application/json',
  };
  const q = async (method, path, body, extra = {}) => {
    const r = await fetch(base + path, {
      method,
      headers: { ...H, ...extra },
      body: body == null ? undefined : JSON.stringify(body),
    });
    const t = await r.text();
    if (!r.ok) throw new Error(`supabase ${method} ${path.split('?')[0]} → ${r.status}: ${t.slice(0, 300)}`);
    return t ? JSON.parse(t) : null;
  };
  return {
    select: (path) => q('GET', path),
    /* upsert: false = plain insert · true = merge on conflict · 'ignore' = keep the existing row (ON CONFLICT DO
       NOTHING — the usage report's idempotency, Spec Kit 028; name the column with ?on_conflict=<col>) */
    insert: (table, rows, upsert = false, returning = false) =>
      q('POST', table, rows, returning && upsert === 'ignore' ? { Prefer: 'resolution=ignore-duplicates,return=representation' }   // 029: the ask's row id, for its topic
        : returning ? { Prefer: 'return=representation' } : upsert === 'ignore'
        ? { Prefer: 'resolution=ignore-duplicates,return=minimal' }
        : upsert
        ? { Prefer: 'resolution=merge-duplicates,return=minimal' }
        : { Prefer: 'return=minimal' }),
    update: (path, patch) => q('PATCH', path, patch, { Prefer: 'return=minimal' }),
    /* A PATCH that says whether it matched. PostgREST applies the filter and the update in ONE
       statement, so a filter on the current version (`updated_at=eq.<base>`) is an atomic
       compare-and-set: an empty array back means somebody else got there first. */
    updateReturning: (path, patch) => q('PATCH', path, patch, { Prefer: 'return=representation' }),
    del: (path) => q('DELETE', path),
    /* Call a Postgres function. THE ONLY WAY TO GET A TRANSACTION from here: a
       sequence of the calls above cannot be atomic, so anything that must apply
       whole or not at all (sync_agent_list) is written as a function and invoked
       through this. Args are named, matching the function's parameter names. */
    rpc: (fn, args) => q('POST', 'rpc/' + fn, args || {}),
    storageGet: async (bucket, key) => {
      const r = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${bucket}/${key}`, {
        headers: { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY },
      });
      if (!r.ok) return null;
      return await r.text();
    },
  };
}
