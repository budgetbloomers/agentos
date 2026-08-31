/**
 * PERSISTENCE HEALTH — the server notices what did NOT arrive.
 *
 * Phase 2 and 4 of specs/save-reliability-plan.md. Born from the 28–31 Aug
 * incident: a CORS preflight refusal meant every PULSE save died inside the
 * browser, so no server log could ever have shown it — the requests never
 * arrived. The one thing the server COULD have seen, and didn't look at, was
 * the shape of what it was receiving: raw files landing in the upload archive
 * every day while neither dashboard's state blob moved. That comparison is
 * what this module makes, every cron tick.
 *
 * DESIGN RULES, in order of importance:
 *   · The sentinel derives from ACTIVITY, never a schedule. The floor does not
 *     upload on Sundays; "state must move daily" would cry wolf weekly and be
 *     muted within a month. Files-arriving-while-state-freezes can never
 *     legitimately happen.
 *   · An alert must CLEAR ITSELF the tick after the condition ends. An alert
 *     that needs a human to dismiss it trains humans to dismiss alerts.
 *   · Everything here is best-effort and wrapped by the caller: the health
 *     checks must never be the thing that breaks the cron they ride on.
 *
 * evaluateFreshness() is a PURE function of timestamps so the logic is
 * testable without a database — verify-store-freshness.mjs feeds it fixtures.
 * Everything around it is plumbing.
 */

const HOUR = 3600000;
export const ALERTS_KEY = 'kv:health-alerts';

/**
 * The sentinel itself. Pure: timestamps in, alerts out.
 *
 * @param {object} t  {manifestAt, vasAt, opsAt, staffLoginRecent, now} — ISO
 *                    strings (or null) and a boolean; now is epoch ms.
 * @returns {array}   alert objects {id, severity, message, since}
 */
export function evaluateFreshness(t) {
  const ms = (iso) => (iso ? Date.parse(iso) : 0);
  const now = t.now || Date.now();
  const manifest = ms(t.manifestAt), vas = ms(t.vasAt), ops = ms(t.opsAt);
  const alerts = [];

  /* THE INCIDENT'S SIGNATURE: files archived, neither state saved within the
     hour after. This is exactly what ran unseen for four days. */
  if (manifest && manifest - vas > HOUR && manifest - ops > HOUR) {
    alerts.push({
      id: 'uploads-not-persisting', severity: 'critical',
      message: 'Uploads are being archived but NEITHER dashboard has saved its state since '
        + new Date(Math.max(vas, ops)).toISOString().slice(0, 16).replace('T', ' ')
        + ' — saves may be silently failing for everyone. Check the browser console on an open tab, and run verify-live-save.mjs --live.',
      since: new Date(manifest).toISOString(),
    });
  }

  /* ABSOLUTE BACKSTOP, gated on people actually being signed in: a store that
     has not moved in 26 hours on a working day. Catches a freeze that starts
     on a day with no uploads at all. */
  if (t.staffLoginRecent && vas && now - vas > 26 * HOUR) {
    alerts.push({
      id: 'vas-state-stale', severity: 'warning',
      message: 'PULSE has not saved its state since ' + new Date(vas).toISOString().slice(0, 16).replace('T', ' ')
        + ' despite staff signing in since — if anyone uploaded in that time, their work is not stored.',
      since: new Date(vas).toISOString(),
    });
  }
  if (t.staffLoginRecent && ops && now - ops > 26 * HOUR) {
    alerts.push({
      id: 'cb-config-stale', severity: 'warning',
      message: 'AgentOS Analytics has not saved its config since ' + new Date(ops).toISOString().slice(0, 16).replace('T', ' ')
        + ' despite staff signing in since.',
      since: new Date(ops).toISOString(),
    });
  }
  return alerts;
}

/**
 * Run the sentinel against the live timestamps and keep kv:health-alerts in
 * step: written when the alerts change, cleared the tick the condition ends.
 * The value is stored as a legacy small row ({data}) so GET /api/kv serves it
 * to the apps' pollers directly with no Storage round-trip.
 */
export async function runHealthChecks(DB) {
  const rows = await DB.select(
    `rules?key=in.(${encodeURIComponent('kv:upload-manifest,kv:vas-state,kv:cb-config')})&select=key,updated_at`);
  const at = {}; for (const r of rows || []) at[r.key] = r.updated_at;

  /* Staff = a username that is not an agent's CB number. Filtered here rather
     than in PostgREST regex syntax so the query stays simple and indexable. */
  const logins = await DB.select(
    `auth_log?event=eq.login_ok&at=gt.${new Date(Date.now() - 26 * HOUR).toISOString()}&select=username&limit=500`)
    .catch(() => []);
  const staffLoginRecent = (logins || []).some((l) => !/^cb\d{1,5}$/i.test(String(l.username || '').trim()));

  const alerts = evaluateFreshness({
    manifestAt: at['kv:upload-manifest'], vasAt: at['kv:vas-state'], opsAt: at['kv:cb-config'],
    staffLoginRecent, now: Date.now(),
  });

  const prev = await DB.select(`rules?key=eq.${encodeURIComponent(ALERTS_KEY)}&select=value`).catch(() => null);
  let prevAlerts = [];
  try { prevAlerts = JSON.parse((prev && prev[0] && prev[0].value && prev[0].value.data) || '{}').alerts || []; } catch (e) {}

  const changed = JSON.stringify(alerts.map((a) => a.id + a.since))
    !== JSON.stringify(prevAlerts.map((a) => a.id + a.since));
  if (changed) {
    await DB.insert('rules', [{ key: ALERTS_KEY,
      value: { data: JSON.stringify({ alerts, checked_at: new Date().toISOString() }) },
      updated_by: 'health-cron', updated_at: new Date().toISOString() }], true);
  }
  if (alerts.length) console.warn('[health] ' + alerts.map((a) => a.id).join(', ') + ' — ' + alerts[0].message);
  return { alerts, changed };
}

/**
 * DAILY STATE SNAPSHOTS — the recovery point this incident never had.
 *
 * The 28–31 Aug data came back only because the raw-file relay happens to
 * archive uploads; a loss in a store the relay does not cover would have been
 * permanent. One gzipped copy per store per day it changed, kept 30 days:
 * vas-state is ~0.6 MB compressed, so a month of both stores is ~20 MB.
 *
 * "First tick after the key changed today": snapshot exists for today → skip;
 * key not updated today (SAST) → nothing new to protect → skip. So the write
 * happens once, within ten minutes of the day's first successful save.
 */
export async function dailySnapshots(env, DB) {
  const sHdr = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY };
  const today = new Date(Date.now() + 2 * HOUR).toISOString().slice(0, 10);   // SAST, no DST
  const out = [];
  for (const key of ['vas-state', 'cb-config']) {
    const ptr = await DB.select(`rules?key=eq.${encodeURIComponent('kv:' + key)}&select=updated_at`).catch(() => null);
    const upd = ptr && ptr[0] && ptr[0].updated_at;
    if (!upd || new Date(Date.parse(upd) + 2 * HOUR).toISOString().slice(0, 10) !== today) continue;

    const snapPath = `raw/kv-history/${key}/${today}.json.gz`;
    const have = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${snapPath}`, { method: 'HEAD', headers: sHdr });
    if (have.ok) continue;                                   // today's copy already exists

    const src = await fetch(`${env.SUPABASE_URL}/storage/v1/object/raw/kv/${key}`, { headers: sHdr });
    if (!src.ok) continue;
    const gz = await new Response(src.body.pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
    const put = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${snapPath}`, {
      method: 'POST', headers: { ...sHdr, 'Content-Type': 'application/gzip', 'x-upsert': 'true' }, body: gz });
    if (put.ok) out.push(key + ' → ' + snapPath + ' (' + Math.round(gz.byteLength / 1024) + ' KB)');

    /* prune beyond 30 — list is newest-last by name because the name IS the date */
    const list = await fetch(`${env.SUPABASE_URL}/storage/v1/object/list/raw`, {
      method: 'POST', headers: { ...sHdr, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix: `kv-history/${key}/`, limit: 100, sortBy: { column: 'name', order: 'asc' } }) });
    if (list.ok) {
      const names = ((await list.json()) || []).map((o) => o.name).filter((n) => /\.json\.gz$/.test(n));
      for (const n of names.slice(0, Math.max(0, names.length - 30)))
        await fetch(`${env.SUPABASE_URL}/storage/v1/object/raw/kv-history/${key}/${n}`, { method: 'DELETE', headers: sHdr });
    }
  }
  return out;
}

/**
 * HYGIENE — probe keys and old write-log rows must never become the thing
 * that grows instead. Tests delete their own zz-* keys; this is the belt to
 * that braces (a test killed mid-run leaves its probe behind).
 */
export async function hygiene(env, DB) {
  const cutoff = new Date(Date.now() - 24 * HOUR).toISOString();
  const stale = await DB.select(`rules?key=like.${encodeURIComponent('kv:zz-%')}&updated_at=lt.${cutoff}&select=key`).catch(() => []);
  for (const r of stale || []) {
    const k = String(r.key).slice(3);
    await fetch(`${env.SUPABASE_URL}/storage/v1/object/raw/kv/${k}`, { method: 'DELETE',
      headers: { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY } }).catch(() => {});
    await DB.del(`rules?key=eq.${encodeURIComponent(r.key)}`).catch(() => {});
  }
  await DB.del(`kv_write_log?at=lt.${new Date(Date.now() - 90 * 24 * HOUR).toISOString()}`).catch(() => {});
  return (stale || []).length;
}

/** One row per acknowledged write — called from the /api/kv POST handler. */
export function logKvWrite(DB, key, bytes, username) {
  return DB.insert('kv_write_log', [{ key, bytes, username: username || '' }]).catch(() => {});
}
