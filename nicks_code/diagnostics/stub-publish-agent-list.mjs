/**
 * stub-publish-agent-list.mjs — an in-memory stand-in for publish_agent_list() (migration-020),
 * for the Worker unit suites that run /api/roster against a stubbed Supabase
 * (verify-roster-changes, verify-roster-of-record).
 *
 * It mirrors the SQL's DERIVATION — code spelling, Sales Force as the name, the VT-sheet
 * fold and campOf's vocabulary, the dropped-row reasons — so those suites exercise the
 * Worker's plumbing (fingerprint, as_of gate, record, mirror, portal map) against the same
 * roster the database would return. It does NOT apply the roster floor or run the three
 * syncs: the floor, the all-or-nothing transaction and the syncs themselves are proven by
 * verify-publish-agent-list.mjs against the REAL function, and these suites' fixtures are
 * four agents deep by design.
 */
export function publishAgentListStub(p = {}) {
  const rows = Array.isArray(p.p_rows) ? p.p_rows : [];
  const label = (raw, sheet) => {
    if (/^\s*vt\s*$|vehicle|tracker/i.test(String(sheet || ''))) return 'VT';
    const s = String(raw || '').trim().replace(/\s+/g, ' ');
    if (!s) return 'Courtesy';
    if (/nest/i.test(s)) return 'Nesting';
    if (/cuddle/i.test(s)) return 'Cuddle';
    if (/track|vehicle|vision|^vt$/i.test(s)) return 'VT';
    if (/courtesy/i.test(s)) return 'Courtesy';
    return s;
  };
  const roster = [], dropped = [], blank = [], seen = new Set();
  rows.forEach((r, i) => {
    const codeRaw = String(r.code || '').trim(), nameRaw = String(r.name || '').trim();
    const sf0 = String(r.sf || '').trim(), sf = sf0 === '-' ? '' : sf0;
    if (!codeRaw && !nameRaw && !sf) return;                               // an empty line is not a row
    const code = codeRaw.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const name = sf || nameRaw;
    let why = null;
    if (!/^CB\d+$/.test(code)) why = 'no CB number';
    else if (!name) why = 'no name';
    else if (seen.has(code + '|' + name)) why = 'duplicate row';
    if (why) { dropped.push({ sheet: String(r.sheet || ''), row: i + 1, code: codeRaw, name: name || nameRaw, why }); return; }
    seen.add(code + '|' + name);
    const campRaw = String(r.campaign || '').trim();
    if (!campRaw) blank.push(code);
    const t = String(r.target ?? '');
    roster.push({ code, name, tl: String(r.tl || '').trim(), campaign: label(campRaw, r.sheet),
      tenure: String(r.tenure || '').trim(), callx: String(r.callx || '').trim(), sf,
      target: /^[0-9]+(\.[0-9]+)?$/.test(t) ? +t : null,
      start: /^\d{4}-\d{2}-\d{2}$/.test(String(r.start || '')) ? String(r.start) : '' });
  });
  const camps = {};
  roster.forEach((a) => { camps[a.campaign] = (camps[a.campaign] || 0) + 1; });
  const ok = { status: 'SUCCESS' };
  return {
    status: p.p_apply ? 'SUCCESS' : 'PLAN', as_of: p.p_as_of || null, batch: 'stub',
    on_file: rows.length, on_roster: roster.length, roster, dropped, blank_campaign: blank,
    campaigns_on_list: Object.entries(camps).map(([label, agents]) => ({ label, agents })),
    needs_hashes: [],
    agents: { ...ok, on_list: roster.length, created: [], updated: [], removed: [], leaders: { repaired: [], orphaned: [], unrepresented: [] } },
    leaders: { ...ok, created: [], removed: [], unrepresented: [] },
    campaigns: { ...ok, created: [], deleted: [] },
    applied: !!p.p_apply,
  };
}
