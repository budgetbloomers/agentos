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
    insert: (table, rows, upsert = false) =>
      q('POST', table, rows, upsert
        ? { Prefer: 'resolution=merge-duplicates,return=minimal' }
        : { Prefer: 'return=minimal' }),
    update: (path, patch) => q('PATCH', path, patch, { Prefer: 'return=minimal' }),
    del: (path) => q('DELETE', path),
    storageGet: async (bucket, key) => {
      const r = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${bucket}/${key}`, {
        headers: { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY },
      });
      if (!r.ok) return null;
      return await r.text();
    },
  };
}
