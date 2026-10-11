/**
 * vas-summary.mjs — the Worker's small copy of the VAS state (Spec Kit 031, 2026-10-11).
 *
 * Nick: "I get a lot of notification didnt reach the server, is something wrong with supabase or agent os".
 * The Worker parsed the whole ~20 MB VAS state for three reads of its own (the roster before any list is published,
 * /api/campaign-stats, the AI's VAS block) — ~430 ms of CPU against the free plan's 10 ms. PULSE (the engine) writes
 * kv:vas-summary after each acknowledged save. This module says what a summary may hold. It is checked when it is
 * WRITTEN (refused otherwise) and again when it is READ (a copy planted by any other route is ignored), because its
 * strings reach the AI's prompt and its numbers reach a campaign manager's screen.
 */
export const SUMMARY_MAX = 4 * 1048576;        // unpacked bytes; the live state's summary is ~0.4 MB
const MONTH = /^\d{4}-\d{2}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const CONTROL = /[\u0000-\u001f\u007f\u2028\u2029]/;   // a line break is how a string would start a new prompt section
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v, max) => v == null || (typeof v === 'string' && v.length <= max && !CONTROL.test(v));
const num = (v) => v == null || (typeof v === 'number' && Number.isFinite(v));
const ROSTER_TEXT = ['code', 'name', 'tl', 'campaign', 'tenure', 'callx', 'sf', 'start'];

/** null when the summary may be used; otherwise what is wrong with it (one short phrase) */
export function summaryProblem(s) {
  if (!isObj(s) || s.v !== 1) return 'not a v1 summary';
  if (!text(s.state_version, 40) || !s.state_version) return 'state_version';
  if (!Array.isArray(s.roster) || s.roster.length > 5000) return 'roster';
  for (const a of s.roster) {
    if (!isObj(a)) return 'roster row';
    for (const k of ROSTER_TEXT) if (!text(a[k], 120)) return 'roster field ' + k;
    if (!(num(a.target) || (typeof a.target === 'string' && /^\d{1,3}(\.\d+)?$/.test(a.target)))) return 'roster target';
  }
  if (!Array.isArray(s.files) || s.files.length > 5000) return 'files';
  for (const f of s.files) if (!isObj(f) || !text(f.type, 80) || !text(f.name, 200) || !text(f.asOf, 40)) return 'file entry';
  if (!isObj(s.map)) return 'map';
  for (const k in s.map) if (!text(k, 120) || !text(s.map[k], 60)) return 'map entry';
  if (!isObj(s.calls)) return 'calls';
  for (const d in s.calls) {
    if (!DAY.test(d) || !isObj(s.calls[d])) return 'calls day';
    for (const k in s.calls[d]) {
      const b = s.calls[d][k];
      if (!text(k, 120) || !isObj(b)) return 'calls bucket';
      for (const f in b) if (!num(b[f])) return 'calls figure';
    }
  }
  if (!isObj(s.months)) return 'months';
  for (const m in s.months) {
    const o = s.months[m];
    if (!MONTH.test(m) || !isObj(o) || typeof o.sales !== 'number' || !Number.isFinite(o.sales) || typeof o.gwp !== 'number' || !Number.isFinite(o.gwp)) return 'months entry';
  }
  return null;
}

/** sales and GWP per month from a WHOLE state — the fallback when no valid summary exists. The ENGINE's copy is
    vasSummary() in nicks_code/index.html; verify-overload-031 holds the two to the same answer. Month keys that are not
    YYYY-MM (a malformed day key) are dropped, so nothing but a month reaches the AI's prompt. */
export function vasMonths(V) {
  const perM = {};
  const addM = (d, s, g) => { const m = String(d).slice(0, 7); if (!MONTH.test(m)) return; const o = perM[m] = perM[m] || { sales: 0, gwp: 0 }; o.sales += (Number(s) || 0); o.gwp += (Number(g) || 0); };
  for (const d in (V.sales || {})) for (const k in V.sales[d]) { const x = V.sales[d][k] || {}; addM(d, x.n, x.gwp); }
  for (const d in (V.tracker || {})) { if (V.sales && V.sales[d]) continue; for (const k in V.tracker[d]) { const x = V.tracker[d][k] || {}; addM(d, x.sales, x.gwp); } }
  return perM;
}

/** a string safe to put in the AI's prompt: no control characters, bounded */
export const promptSafe = (v, max = 60) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').slice(0, max);

/** who may write the VAS state and its summary (review F1.3/F2): a full-scope session that is admin or holds the VAS
    app. Matches every real writer of the last 30 days (2026-10-11: ashton, sylvannas, sharoma, renolan — viewers;
    avesh, aarav — exec; dalwin — campaign manager holding VAS). An upload-tab rule would have locked out sylvannas and
    dalwin: PULSE saves on roster adoption, target polls and relay syncs, not only on uploads. */
export function vasWriteAllowed(user) {
  if (!user || (user.scope && user.scope !== 'full')) return false;
  if (user.role === 'admin') return true;
  return Array.isArray(user.apps) && user.apps.includes('vas');
}
