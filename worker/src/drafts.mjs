/**
 * COACHING DRAFTS AND THE SUBMIT LOCK (spec 004-coaching-drafts-submit-lock, 2026-10-05).
 *
 * UAT: "Allow TL to create coaching doc, save the draft and edit, but when click submit, he must not be able view".
 *
 * WHY THE DRAFT LIVES HERE AND NOT IN THE HUB: the Convex Coaching Hub only creates, reads, changes and deletes records
 * — there is no status field, its create validates arguments strictly so one cannot be added, and its own app shows
 * every record to anyone with the address. A draft written there is not a draft. So a draft is one row of the Worker's
 * `rules` table, and the document reaches the Hub only on Submit (through hubs.mjs coachingCreate, with all of its
 * validation).
 *
 * OWNERSHIP: the key is `coach-draft:<app_users id>:<uuid>`, the id taken from the SESSION — there is no request shape
 * in which a leader names another leader's draft (the rule hubs.mjs follows for Hub ids). The prefix is outside `kv:`,
 * so no generic store route (/api/kv, /api/kv-meta) can reach a draft.
 *
 * VERSIONS: a draft's version is its row's `updated_at`, read back from the database (Postgres renders it in its own
 * format, so the value the page holds is always one this module READ). Every change is a compare-and-set on it — the
 * /api/kv pattern — so two tabs never silently overwrite each other, and Submit claims the row (`submitting`) the same
 * way, which is what makes a double click reach the Hub once.
 *
 * SIGNATURES (decided with the user): they may be drawn on a draft and are kept with it, but a signature attests to the
 * wording beside it — when the content changes, a signature that arrives byte-identical to the stored one was drawn
 * before the change and is dropped (staleSigs). The page clears them as the leader types; this is the server's half.
 */
import { COACH_TABLES, coachingCreate, sigState, signatureProblem } from './hubs.mjs';

export const DRAFT_MAX = 50;
export const DRAFT_MAX_BYTES = 1500000;
export const REOPEN_AFTER_MS = 2 * 60 * 1000;

const PREFIX = 'coach-draft:';
const ID_RE = /^[a-f0-9-]{8,64}$/i;
const enc = encodeURIComponent;
const str = (v) => (v == null ? '' : String(v));
const own = (user) => PREFIX + str(user.user_id) + ':';
const res = (status, error, extra) => ({ status, body: { error, ...(extra || {}) } });
const done = (body) => ({ status: 200, body });
const stateOf = (row) => (row && row.value && row.value.meta && row.value.meta.state) || 'draft';
/* the next version: now, but always after the one it replaces (two isolates' clocks are not one clock) */
const nextAt = (nowMs, prev) => new Date(Math.max(nowMs, (Date.parse(prev || '') || 0) + 1)).toISOString();

const metaOf = (type, data, state, createdAt) => ({
  type, state,
  agentName: str(data.agentName).slice(0, 120),
  employeeNumber: str(data.employeeNumber).slice(0, 20),
  date: str(data.date || data.dateOfCoaching).slice(0, 10),
  sigs: sigState(type, data),
  createdAt,
});

/* The document without its SIGNING — in a canonical order — is what a signature attests to. Signing is the images, the
   sign dates and the group attendee rows (each attendee writes their own name and date beside their signature); none
   of those counts as a change to the document, or the next attendee's name would void the signatures already drawn.
   The page applies the same rule (agent/index.html inSigning). */
const isSigKey = (k) => /[Ss]ignature$/.test(k);
const inSigning = (k) => isSigKey(k) || /SignDate$/.test(k) || k === 'signDate' || k === 'employeeSignoffs';
function contentOf(data) {
  const walk = (v) => (Array.isArray(v) ? v.map(walk)
    : v && typeof v === 'object' ? Object.keys(v).sort().reduce((o, k) => { o[k] = walk(v[k]); return o; }, {})
      : v);
  const top = {};
  for (const k of Object.keys(data || {}).sort()) if (!inSigning(k)) top[k] = walk(data[k]);
  return JSON.stringify(top);
}

/** A signature drawn before the content last changed is dropped. Pure: returns a copy and the paths it cleared. */
export function staleSigs(table, stored, incoming) {
  const data = JSON.parse(JSON.stringify(incoming || {}));
  const cleared = [];
  if (!stored || contentOf(stored) === contentOf(data)) return { data, cleared };
  for (const k of Object.keys(data))
    if (isSigKey(k) && data[k] && data[k] === stored[k]) { data[k] = ''; cleared.push(k); }
  const old = new Set((Array.isArray(stored.employeeSignoffs) ? stored.employeeSignoffs : []).map((r) => r && r.signature).filter(Boolean));
  (Array.isArray(data.employeeSignoffs) ? data.employeeSignoffs : []).forEach((r, i) => {
    if (r && r.signature && old.has(r.signature)) { r.signature = ''; cleared.push('employeeSignoffs.' + i + '.signature'); }
  });
  return { data, cleared };
}

async function one(DB, key) {
  const rows = await DB.select(`rules?key=eq.${enc(key)}&select=key,value,updated_at`);
  return (rows && rows[0]) || null;
}
const tooBig = (data) => JSON.stringify(data).length > DRAFT_MAX_BYTES;
const TOO_BIG = 'This draft is too large to save (over 1.5 MB) — remove a signature or shorten the notes.';
const GONE = 'That draft does not exist — it may have been submitted or deleted.';
const CHANGED = 'This draft was changed somewhere else (another tab or device) — reopen it from Drafts to carry on.';

/** GET: the caller's drafts (meta only — no content, no image), or one draft in full (?id=) for its owner. */
export async function draftsGet(DB, user, q = {}) {
  if (!user || !user.user_id) return res(403, 'This session has no account to keep drafts under.');
  const id = str(q.id);
  if (id) {
    if (!ID_RE.test(id)) return res(404, GONE);
    const row = await one(DB, own(user) + id);
    if (!row || stateOf(row) === 'submitted') return res(404, GONE);
    const m = row.value.meta || {};
    return done({ draft: { id, type: m.type, label: COACH_TABLES[m.type] || m.type, state: stateOf(row), updatedAt: row.updated_at, data: row.value.data || {} } });
  }
  const rows = await DB.select(`rules?key=like.${enc(own(user))}*&select=key,updated_at,meta:value->meta&order=updated_at.desc&limit=${DRAFT_MAX + 10}`);
  const drafts = (rows || [])
    .filter((r) => String(r.key).startsWith(own(user)) && r.meta && r.meta.state !== 'submitted')
    .map((r) => ({ id: String(r.key).slice(own(user).length), type: r.meta.type, label: COACH_TABLES[r.meta.type] || r.meta.type,
      state: r.meta.state || 'draft', agentName: r.meta.agentName || '', employeeNumber: r.meta.employeeNumber || '', date: r.meta.date || '',
      createdAt: r.meta.createdAt || null, updatedAt: r.updated_at, sigs: Array.isArray(r.meta.sigs) ? r.meta.sigs : [] }));
  return done({ drafts, max: DRAFT_MAX });
}

/** POST {action: save | delete | submit | reopen}. `ids` are the session's Hub ids (hubIdsOf), used by submit only. */
export async function draftsPost(DB, user, ids, body = {}, nowMs = Date.now()) {
  if (!user || !user.user_id) return res(403, 'This session has no account to keep drafts under.');
  const act = str(body.action);
  const id = str(body.id);
  if (id && !ID_RE.test(id)) return res(404, GONE);
  const key = own(user) + id;
  const by = str(user.username);

  if (act === 'save') {
    const type = str(body.type);
    if (!COACH_TABLES[type]) return res(400, 'Unknown coaching type.');
    const data = body.data && typeof body.data === 'object' && !Array.isArray(body.data) ? body.data : null;
    if (!data) return res(400, 'There is nothing to save.');
    const sigErr = signatureProblem(type, data);
    if (sigErr) return res(400, sigErr);

    if (!id) {                                                     // a new draft
      if (tooBig(data)) return res(413, TOO_BIG);
      const mine = await DB.select(`rules?key=like.${enc(own(user))}*&select=key`);
      if ((mine || []).filter((r) => String(r.key).startsWith(own(user))).length >= DRAFT_MAX)
        return res(409, `You have ${DRAFT_MAX} drafts already — submit or delete one before starting another.`);
      const newId = crypto.randomUUID();
      const at = new Date(nowMs).toISOString();
      const out = await DB.insert('rules', [{ key: own(user) + newId, value: { v: 1, meta: metaOf(type, data, 'draft', at), data },
        updated_by: by, updated_at: at }], false, true);
      return done({ ok: true, id: newId, updatedAt: (out && out[0] && out[0].updated_at) || at, cleared: [] });
    }

    const base = str(body.base);
    if (!base) return res(400, 'This draft has no version — reopen it from Drafts.');
    const row = await one(DB, key);
    if (!row || stateOf(row) === 'submitted') return res(404, GONE);
    if (stateOf(row) !== 'draft') return res(409, 'This draft is being submitted — check your sessions.', { conflict: true });
    if ((row.value.meta || {}).type !== type) return res(400, 'A draft cannot change its coaching type.');
    const { data: clean, cleared } = staleSigs(type, row.value.data, data);
    if (tooBig(clean)) return res(413, TOO_BIG);
    const value = { ...row.value, meta: metaOf(type, clean, 'draft', (row.value.meta || {}).createdAt || null), data: clean };
    const won = await DB.updateReturning(`rules?key=eq.${enc(key)}&updated_at=eq.${enc(base)}`,
      { value, updated_by: by, updated_at: nextAt(nowMs, row.updated_at) });
    if (!won || !won.length) return res(409, CHANGED, { conflict: true });
    return done({ ok: true, id, updatedAt: won[0].updated_at, cleared });
  }

  if (!id) return res(400, 'No draft specified.');
  const row = await one(DB, key);
  if (!row || stateOf(row) === 'submitted') return res(404, GONE);

  if (act === 'delete') {
    if (stateOf(row) !== 'draft') return res(409, 'This draft is being submitted — it cannot be deleted now.', { conflict: true });
    /* filtered on the version just read, so a draft claimed for submit in between is never deleted from under it — and
       then checked: a delete that matched nothing is not a success (review, 2026-10-05) */
    await DB.del(`rules?key=eq.${enc(key)}&updated_at=eq.${enc(row.updated_at)}`);
    if (await one(DB, key)) return res(409, 'This draft changed while it was being deleted (it may be being submitted) — check your drafts.', { conflict: true });
    return done({ ok: true });
  }

  if (act === 'reopen') {
    if (stateOf(row) !== 'submitting') return res(409, 'Only a submit that did not finish can be reopened.');
    if (nowMs - (Date.parse(row.value.submittingAt || '') || 0) < REOPEN_AFTER_MS)
      return res(409, 'This draft is still being submitted — wait a minute, then check your sessions before reopening it.');
    const value = { ...row.value, meta: { ...row.value.meta, state: 'draft' } };
    delete value.submittingAt;
    const won = await DB.updateReturning(`rules?key=eq.${enc(key)}&updated_at=eq.${enc(row.updated_at)}`,
      { value, updated_by: by, updated_at: nextAt(nowMs, row.updated_at) });
    if (!won || !won.length) return res(409, CHANGED, { conflict: true });
    return done({ ok: true, updatedAt: won[0].updated_at });
  }

  if (act === 'submit') {
    const base = str(body.base);
    if (!base) return res(400, 'This draft has no version — reopen it from Drafts.');
    if (stateOf(row) !== 'draft') return res(409, 'This draft is already being submitted — check your sessions.', { conflict: true });
    const type = (row.value.meta || {}).type;
    let data = row.value.data || {}, cleared = [];
    if (body.data && typeof body.data === 'object' && !Array.isArray(body.data)) ({ data, cleared } = staleSigs(type, row.value.data, body.data));
    const sigErr = signatureProblem(type, data);
    if (sigErr) return res(400, sigErr);
    if (tooBig(data)) return res(413, TOO_BIG);

    /* 1 — claim it. A second click, a second tab or a stale version loses here and never reaches the Hub. */
    const claimed = { ...row.value, meta: metaOf(type, data, 'submitting', (row.value.meta || {}).createdAt || null), data,
      submittingAt: new Date(nowMs).toISOString() };
    const won = await DB.updateReturning(`rules?key=eq.${enc(key)}&updated_at=eq.${enc(base)}`,
      { value: claimed, updated_by: by, updated_at: nextAt(nowMs, row.updated_at) });
    if (!won || !won.length) return res(409, 'This draft changed or is already being submitted — reopen it from Drafts.', { conflict: true });

    /* 2 — the Hub, through the one create every coaching document goes through */
    let r;
    try { r = await coachingCreate(ids, user, { ...data, type }); }   // the draft's own type wins over any `type` in its data
    /* a failure on the wire may still have created the document — the leader is told to look before submitting again */
    catch (e) { r = { error: 'The Coaching Hub did not answer (' + String((e && e.message) || e).slice(0, 160) + '). It may still have received the document — check "Your sessions" before submitting again.', status: 502 }; }

    if (r.error) {                                                   // 3a — refused: the draft goes back, untouched in content
      const back = { ...claimed, meta: { ...claimed.meta, state: 'draft' } };
      delete back.submittingAt;
      const restored = await DB.updateReturning(`rules?key=eq.${enc(key)}`,
        { value: back, updated_by: by, updated_at: nextAt(nowMs, won[0].updated_at) }).catch(() => null);
      return res(r.status || 502, r.error, { updatedAt: restored && restored[0] ? restored[0].updated_at : null, cleared });
    }
    /* 3b — in the Hub: the draft goes. If the delete fails, mark it submitted so no list or open ever shows it again. */
    try { await DB.del(`rules?key=eq.${enc(key)}`); }
    catch (e) {
      await DB.update(`rules?key=eq.${enc(key)}`, { value: { ...claimed, meta: { ...claimed.meta, state: 'submitted' }, hubId: r.id },
        updated_by: by, updated_at: nextAt(nowMs, won[0].updated_at) }).catch(() => {});
    }
    return done({ ok: true, hubId: r.id, table: r.table, label: r.label, cleared });
  }

  return res(400, 'Unknown action.');
}
