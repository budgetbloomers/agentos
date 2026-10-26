/**
 * rules.mjs — the rule-book constants and derivations the Worker and the tools share.
 *
 * ONE NUMBER, ONE VERDICT (specs/agent-view-consistency-plan.md, 2026-09-07). The R99 floor's
 * ex-VAT twin had drifted in three copies (PULSE, Ops, the agent page: 86,08 vs 86,0869), so an
 * agent exactly at the floor read "At target" in one row and "to go" in the next. Every
 * comparison an agent sees is now DECIDED here or in the PULSE engine and travels as a verdict;
 * the pages paint it. Nothing in agent/index.html or portal.mjs divides by VAT any more —
 * verify-rule-constants fails on the literal.
 */
export const VAT = 1.15;                                   // mirror of specs/mtd_engine_rules.json vat_multiplier
export const DEFAULT_THRESHOLDS = { gwpFloor: 99, targetAch: 100 };   // NBA_THRESHOLDS: Check 1 floor (R incl), Check 2 line (%)

/** R99 incl → the cent Salesforce books ex VAT (86,08), never the raw quotient (86,0869). */
export function gwpFloorEx(floorIncl) {
  const f = floorIncl != null ? +floorIncl : DEFAULT_THRESHOLDS.gwpFloor;
  return Math.floor(f / VAT * 100) / 100;
}

/** thresholds as the pages receive them: the incl floor AND its floored ex-VAT twin. */
export function withFloorEx(th) {
  const t = Object.assign({}, DEFAULT_THRESHOLDS, th || {});
  t.gwpFloorEx = gwpFloorEx(t.gwpFloor);
  return t;
}

/** The two checks on every sale, decided once. row = a digest agent row (aveG ex VAT, pctT ratio). */
export function checksFor(row, th) {
  const t = withFloorEx(th);
  const aveG = row && row.aveG != null ? +row.aveG : null;
  const pct = row && row.pctT != null ? Math.round(+row.pctT * 10000) / 100 : null;
  const line = +t.targetAch;
  return {
    value: { aveG, floorEx: t.gwpFloorEx, floorIncl: +t.gwpFloor, pass: aveG != null ? aveG >= t.gwpFloorEx : null },
    volume: { pct, line, pass: pct != null ? pct >= line : null },
    basis: 'ex VAT vs ex VAT; floor floored to the cent Salesforce books',
  };
}

/* THE LIVE DIGEST AT MONTH ROLLOVER (2026-10-01). The live key is the current SAST month (3 Sep: an
   August browser overwrote September) — but on the 1st the new month has no data, and the fence froze
   agents on the last copy of the closed month ("1–29 September" on 1 October, the final day never shown).
   So the PREVIOUS month may write the live key while the key does not already hold the current month;
   nothing older ever; the current month always wins. periodFrom / liveFrom: 'YYYY-MM-DD' (liveFrom '' when
   nothing is live). Used by the Worker's 409, the republish tool, and mirrored in PULSE (liveDigestMonthOk). */
export function liveDigestAllowed(periodFrom, liveFrom, nowMs) {
  const m = String(periodFrom || '').slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(m)) return false;
  const cur = new Date(nowMs + 2 * 3600000).toISOString().slice(0, 7);
  if (m === cur) return true;
  const d = new Date(cur + '-01T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() - 1);
  const prev = d.toISOString().slice(0, 7);
  return m === prev && String(liveFrom || '').slice(0, 7) !== cur;
}

/* AN EMPTY MONTH NEVER REPLACES A NON-EMPTY ONE (spec 002-live-month-sync-coaching, contract C2, 2026-10-01).
   The live key now takes the CURRENT month even before its first data (an honest `empty:true` payload). The
   one thing that must never happen is that payload landing over the same month's real figures (a stale tab,
   the tool on an old state). payloadEmpty: the incoming payload says `empty:true`; liveFrom / liveEmpty: the
   period and the `empty` stamp the live pointer row carries ('' / undefined when nothing is live or the row
   predates the stamp — an unstamped row is treated as NOT empty, the safe side). true = refuse (409
   empty_over_data). Used by the Worker's POST /api/kv; the republish tool mirrors it. */
export function emptyOverData(payloadEmpty, periodFrom, liveFrom, liveEmpty) {
  if (payloadEmpty !== true) return false;
  const m = String(periodFrom || '').slice(0, 7), l = String(liveFrom || '').slice(0, 7);
  if (!m || m !== l) return false;
  return liveEmpty !== true;
}

/* THE REFERRALS SNAPSHOT IS STAFF MATERIAL (spec 002, contract C3). GET /api/kv?key=referrals-latest carries
   every agent's referral counts; PULSE (staff) adopts it. Agents, team leaders and campaign managers must
   never read it — whatever management app a portal login also holds — and a wimpy-scoped session reaches
   nothing. Pure so the suite can pin it. */
/* An ALLOW-list (review L4): the staff roles app_users carries (migration-003: admin / exec / tl / qa / viewer — `tl` is the
   management Ops role, NOT the portal's team_leader). A role added later is closed here until somebody opens it on purpose. */
export const STAFF_ROLES = new Set(['admin', 'exec', 'tl', 'qa', 'viewer']);
const PORTAL_ONLY_ROLES = new Set(['agent', 'team_leader', 'campaign_manager']);
/** A normal password session. Any other scope (wimpy, referrals) is a narrow one and reaches nothing staff-only. */
export const isFullScope = (user) => !!user && (!user.scope || user.scope === 'full');

/* A /api/kv KEY IS A PLAIN NAME (Spec Kit 014, W1, 2026-10-07). The key becomes a Storage path (`raw/kv/<key>`) and the
   runtime normalises that URL: `zzz/../agent-digest` slipped past the digest guards (the guard pattern never matched it)
   and wrote the LIVE digest blob; a DELETE could remove objects outside raw/kv. So GET, POST and DELETE refuse anything
   but letters, digits and . _ : - (starting with a letter or digit, ≤ 200 long) and any '..' — before the key is used.
   Every key the apps, tools and probes use passes (agent-digest-range-…, cb-facts-*, help-contact:CB12 …). */
const KV_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
export const kvKeyValid = (key) => typeof key === 'string' && KV_KEY.test(key) && !key.includes('..');
export function referralsReadAllowed(user) {
  return isFullScope(user) && STAFF_ROLES.has(user.role);
}

/* WHO MAY WRITE THE DIGEST AND REFERRAL KEYS (review M1, 2026-10-01). POST/DELETE /api/kv was open to any session that
   gets past the portal lockdown — which a team leader or campaign manager who also holds a management app does. The
   live digest is every agent's page; referrals are every agent's counts. Portal roles and scoped sessions are refused
   for these keys whatever apps they hold; the staff roles keep writing exactly as before. Other keys are untouched.
   SPEC 006 (custom ranges): a range's digest (agent-digest-range-…, already covered) AND its two report keys
   (agent-reports-variance|leads-range-YYYY-MM-DD-YYYY-MM-DD) and the request queue (cm-range-requests) are staff-written
   only too — only the engine's publisher writes figures, and the Worker writes the queue itself, never through /api/kv. */
const GUARDED_KV = /^(agent-digest(-[a-z0-9-]+)?|agent-reports-(variance|leads)(-range-[0-9-]+)?|cm-range-requests|referrals-latest|referrals-sync-log)$/;
export const isGuardedKvKey = (key) => GUARDED_KV.test(String(key || ''));
/* KEYS ONLY THE WORKER WRITES (stability plan, 2026-10-26). health-alerts is the banner every admin reads; the cron writes
   it straight to the database. Through /api/kv any staff session could overwrite or clear it — fake or hide an outage. */
const SYSTEM_KV = /^(health-alerts|db-size-history)$/;
export const isSystemKvKey = (key) => SYSTEM_KV.test(String(key || ''));
export function kvWriteAllowed(key, user) {
  if (!user) return false;
  if (isSystemKvKey(key)) return false;
  if (!isGuardedKvKey(key)) return true;
  return isFullScope(user) && !PORTAL_ONLY_ROLES.has(user.role);
}

/* THE UPLOAD STATION IS A GRANT THE SERVER CHECKS (stability plan, 2026-10-26: "check app permissions on the server").
   Until now the routes that load, replace or delete data only refused the portal roles, so EVERY other session — a viewer
   with three VAS tabs, HR with Ops' Workforce — could wipe every BI row, delete any stored file (the whole VAS state
   included) or publish an Agent List. The tab grants lived only in the browser (auth-gate.js allowedTabs).
   The rule is the browser's, read the same way: admin sees every tab; anyone else needs the app AND, in that app's tab
   list, '*' or one of its Upload Station pages — VAS 'data' (Upload Station), Ops 'uploads' / 'sess_uploads'. The people
   who upload today (nicholas, nick, the exec accounts with '*', ashton with vas:*) keep doing so unchanged. */
const UPLOAD_TABS = { vas: ['data'], ops: ['uploads', 'sess_uploads'] };
export function canUpload(user) {
  if (!isFullScope(user) || PORTAL_ONLY_ROLES.has(user.role)) return false;
  if (user.role === 'admin') return true;
  const apps = Array.isArray(user.apps) ? user.apps : [];
  const tabs = user.tabs && typeof user.tabs === 'object' ? user.tabs : {};
  return Object.entries(UPLOAD_TABS).some(([app, ids]) => {
    const t = Array.isArray(tabs[app]) ? tabs[app] : [];
    return apps.includes(app) && (t.includes('*') || ids.some((i) => t.includes(i)));
  });
}

/* EMPTINESS IS DERIVED, NEVER TRUSTED (review M1). The `empty:true` flag decides whether a payload may be refused by the
   empty_over_data fence and what the pointer is stamped, so it cannot be the client's say-so. An agent-digest body:
   no agents → 'empty_digest'; flagged empty but an agent carries a figure (sales / gwpEx / pctT / act not null) →
   'bad_empty'; otherwise empty = every agent's four figures are null, whatever the flag says. A real 0 is a figure. */
const EMPTY_FIGURES = ['sales', 'gwpEx', 'pctT', 'act'];
export function digestEmptiness(body) {
  const agents = body && Array.isArray(body.agents) ? body.agents : [];
  if (!agents.length) return { error: 'empty_digest' };
  const hasFigures = agents.some((a) => a && EMPTY_FIGURES.some((k) => a[k] != null));
  if (body.empty === true && hasFigures) return { error: 'bad_empty' };
  return { empty: !hasFigures };
}

const HOUR = 3600000;
/** The day each source should reach right now (SAST): yesterday after 13:00, no Sunday; Saturday only for sources that dial. Mirror of expectedReach() in PULSE. */
export function expectedReachFor(nowMs, saturday = true) {
  const sast = new Date(nowMs + 2 * HOUR);
  const d = new Date(Date.UTC(sast.getUTCFullYear(), sast.getUTCMonth(), sast.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - (sast.getUTCHours() >= 13 ? 1 : 2));
  while (d.getUTCDay() === 0 || (!saturday && d.getUTCDay() === 6)) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
