/**
 * WIMPY ORDERS IN HIGHLEVEL, AND EACH PERSON'S OWN HISTORY (Spec Kit 015-wimpy-order-history, 2026-10-07).
 *
 * Nick: "I gave you the private intergration key and location ID to shpw the users their order history, it must only
 * show their order history and no one elses".
 *
 * THE KEY AND THE LOCATION ARE WORKER SECRETS (WIMPY_HL_API_KEY, WIMPY_HL_LOCATION_ID — `wrangler secret put` at
 * release). They are never in this file, never in a reply and never in a log: every HighLevel error passes through
 * redact() before it is stored or printed. Missing either one = "not configured": ordering is untouched, rows wait as
 * `pending`, and the history says the kitchen stages are not available.
 *
 * THE CLIENT. HighLevel API v2: Bearer <private-integration key>, Version 2021-07-28, JSON both ways, and an abort on
 * every call (8 s; the history's stage read 5 s) — a slow HighLevel never holds a request open. A call ANSWERS
 * {ok, status, json, error}; it never throws. The pipeline and its "New Order" stage are found by NAME at run time and
 * kept for the isolate — no HighLevel id is written into the code.
 */

export const HL_BASE = 'https://services.leadconnectorhq.com';
export const HL_VERSION = '2021-07-28';
export const HL_TIMEOUT_MS = 8000;                 // every write
export const PIPELINE_NAME = 'Wimpy Pipeline';
export const STAGE_NEW = 'New Order';
const PIPE_TTL_MS = 60 * 60000;                    // the pipeline/stage map is re-read hourly, or at once on a stage the cache does not know
const ERR_MAX = 300;                               // wimpy_orders.hl_error is held to 300 characters by the table too

/** Both secrets present. One without the other is as good as none. */
export function hlConfigured(env) {
  return !!(env && env.WIMPY_HL_API_KEY && env.WIMPY_HL_LOCATION_ID);
}

/* A STORED OR LOGGED ERROR NEVER CARRIES A SECRET OR A PHONE NUMBER. HighLevel's messages can echo what was sent (a
   validation error quotes the body; a 401 can quote the token), so the key, the location id, any bearer token and any
   run of digits long enough to be a phone number are replaced before the text goes anywhere. */
export function redact(env, s) {
  let t = String(s == null ? '' : s);
  for (const secret of [env && env.WIMPY_HL_API_KEY, env && env.WIMPY_HL_LOCATION_ID]) {
    if (secret) t = t.split(String(secret)).join('[redacted]');
  }
  t = t.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\+?\d[\d\s()-]{6,}\d/g, '[number]');
  return t.replace(/\s+/g, ' ').trim().slice(0, ERR_MAX);
}

/** One HighLevel call. Answers {ok, status, json, error}; never throws; `error` is already redacted. */
export async function hlRequest(env, method, path, { query, body, timeoutMs = HL_TIMEOUT_MS } = {}) {
  if (!hlConfigured(env)) return { ok: false, status: 0, json: null, error: 'HighLevel is not configured (WIMPY_HL_API_KEY / WIMPY_HL_LOCATION_ID are not set)' };
  const qs = query ? '?' + new URLSearchParams(query).toString() : '';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(HL_BASE + path + qs, {
      method,
      headers: { Authorization: 'Bearer ' + env.WIMPY_HL_API_KEY, Version: HL_VERSION, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body == null ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await r.text().catch(() => '');
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (e) { json = null; }
    if (!r.ok) {
      const msg = (json && (json.message || json.msg || json.error)) || text;
      return { ok: false, status: r.status, json, error: redact(env, 'HighLevel answered ' + r.status + ': ' + (Array.isArray(msg) ? msg.join('; ') : String(msg || ''))) };
    }
    return { ok: true, status: r.status, json, error: null };
  } catch (e) {
    const why = ctrl.signal.aborted ? 'HighLevel did not answer within ' + Math.round(timeoutMs / 1000) + ' seconds'
      : 'HighLevel could not be reached: ' + String((e && e.message) || e);
    return { ok: false, status: 0, json: null, error: redact(env, why) };
  } finally { clearTimeout(timer); }
}

/**
 * "Wimpy Pipeline" and its stages, by NAME (case and spacing forgiven). {ok, pipelineId, newStageId, stages:{id→name},
 * cached} or {ok:false, error}. Kept per isolate for an hour; force:true re-reads it (a card on a stage the cache does
 * not know). A location with no pipeline of that name is an error, never a guess at another pipeline's "New Order".
 */
export async function resolvePipeline(env, { force = false } = {}) {
  const loc = String((env && env.WIMPY_HL_LOCATION_ID) || '');
  const c = globalThis.__wimpyHlPipe;
  if (!force && c && c.loc === loc && Date.now() - c.at < PIPE_TTL_MS) return { ...c.v, cached: true };
  const r = await hlRequest(env, 'GET', '/opportunities/pipelines', { query: { locationId: loc } });
  if (!r.ok) return { ok: false, error: r.error };
  const same = (a, b) => String(a || '').replace(/\s+/g, ' ').trim().toLowerCase() === b.toLowerCase();
  const p = ((r.json && r.json.pipelines) || []).find((x) => x && same(x.name, PIPELINE_NAME));
  if (!p) return { ok: false, error: 'No pipeline named "' + PIPELINE_NAME + '" in the Wimpy sub-account' };
  const stages = {};
  let newStageId = null;
  for (const s of p.stages || []) {
    if (!s || !s.id) continue;
    stages[s.id] = String(s.name || '').trim();
    if (!newStageId && same(s.name, STAGE_NEW)) newStageId = s.id;
  }
  if (!newStageId) return { ok: false, error: 'The "' + PIPELINE_NAME + '" pipeline has no "' + STAGE_NEW + '" stage' };
  const v = { ok: true, pipelineId: p.id, newStageId, stages };
  globalThis.__wimpyHlPipe = { loc, at: Date.now(), v };
  return { ...v, cached: false };
}

/* ================================================================ THE CARD FOR ONE ORDER
   Every accepted order becomes ONE card in "Wimpy Pipeline" at "New Order", on the person's ONE contact (created on
   their first order, linked to their account in wimpy_hl_contacts, reused for ever after). Order of work:
     contact (only if the person has none) → [a retry: look for this order's card first] → card →
     the row marked written WITH the card id (at once — review M2) → note on the contact (the order's items).
   ONE ORDER, ONE CARD (review M2, 2026-10-07). A card can exist while the row does not know it: HighLevel made it but
   the 8 s abort fired first, the "written" patch failed, or the invocation was cut. So (a) the card id is recorded the
   moment the card exists, before anything else, and (b) a CLAIMED row (any retry) whose person already has a contact
   first searches that contact's cards and takes the one named for this very order — its name carries the order's own
   tag — unless another ledger row already records that card. A failed search on a retry fails the try: a card is never
   created blind on a retry.
   The card goes BEFORE the note: with "Allow duplicate opportunities" still off the card is refused, and a note first
   would add a copy of the order to the contact on every try. A failed note is logged, never retried.
   Any failure → `failed` (the reason redacted — secrets, phone numbers AND the typed name; review L4 — due again after the
   backoff) or `stuck` on the 8th try → health raises wimpy-hl-stuck. A claimed row's try was counted by its claim
   (review L1), the order path's own first attempt is counted here.
   THE TYPED NAME AND PHONE (hl_contact_seed) exist only to create the person's contact: cleared when the row is written,
   when it goes stuck, and on any attempt once the person has a contact link (review M4).
   Subrequests per row, worst case: claim 1 (retries) + link read 1 (unless the caller knows it) + contact 1 + link insert
   1 + link re-read 1 + pipelines 1 (cold isolate) + card 1 + written patch 1 + note 1 — a retry with a contact swaps
   contact/insert/re-read for search 1 + (on a name match) the other-row check 1. */
export const MAX_TRIES = 8;
export const BACKOFF_MIN = [2, 5, 10, 20, 40, 80, 160];      // after try 1, 2 … 7; the 8th failure is `stuck`
export const FIRST_TRY_GRACE_MIN = 2;                         // a new row is the order path's own for 2 minutes before the cron may take it
/* rows per Wimpy cron run — cron-log 1 + due select 1 + links 1 + row 1 (8: claim, contact, insert, re-read, pipelines,
   card, patch, note) + rows 2–5 (7 each) + counts 1 + status 1 = 41 ≤ 42 */
export const CRON_ROWS = 5;
const LEASE_MIN = 5;                                          // a claimed row is left alone this long, so two runners never write one card twice
const MIN_MS = 60000;
const iso = (ms) => new Date(ms).toISOString();
const enc = encodeURIComponent;
const money = (v) => 'R' + Number(v || 0).toFixed(2);

/* A FAILED DATABASE WRITE, IN WORDS THAT CARRY NO PERSONAL DATA. PostgREST's errors can quote the whole row ("Failing row
   contains (…, Thandi, 082…)"), so only the status, the error code and the message are kept — then redacted. */
export function dbWhy(env, e) {
  const msg = String((e && e.message) || e || '');
  const m = /→ (\d+): ([\s\S]*)$/.exec(msg);
  if (!m) return redact(env, msg.replace(/Failing row contains[\s\S]*/i, ''));
  let j = null; try { j = JSON.parse(m[2]); } catch (x) { j = null; }
  const what = j ? [j.code, j.message].filter(Boolean).join(' ') : m[2].replace(/Failing row contains[\s\S]*/i, '');
  return redact(env, m[1] + ' ' + what);
}
/* …and never the name the person typed (review L4): HighLevel's validation errors quote firstName/lastName back */
function redactPerson(text, seed) {
  let t = String(text || '');
  for (const w of [seed && seed.first, seed && seed.last]) {
    const s = String(w || '').trim();
    if (s.length >= 2) t = t.replace(new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '[name]');
  }
  return t;
}

/** SAST "2026-10-08 12:31" for a timestamp (UTC+2, no daylight saving). */
function sastLabel(t) {
  const ms = Date.parse(t);
  return Number.isFinite(ms) ? new Date(ms + 2 * 3600000).toISOString().slice(0, 16).replace('T', ' ') : '';
}
function personName(row) {
  const s = row.hl_contact_seed || {};
  return [s.first, s.last].filter(Boolean).join(' ');
}
/** The card's name — CB, total, SA time and THIS order's own tag. It never depends on the typed name (cleared after the
    contact exists), so a retry can recognise the card an earlier attempt made (review M2). The contact carries the name. */
export function cardNameFor(row) {
  return [row.cb, money(row.total), sastLabel(row.placed_at), '#' + String(row.id || '').replace(/-/g, '').slice(0, 8)].filter(Boolean).join(' · ');
}
/** The note on the contact: the order itself, item by item. */
function noteFor(row) {
  const L = ['WIMPY ORDER · ' + sastLabel(row.placed_at) + ' SAST', 'CB Number: ' + row.cb];
  if (personName(row)) L.push('Name: ' + personName(row));
  L.push('');
  for (const it of Array.isArray(row.items) ? row.items : []) L.push(it.quantity + ' × ' + String(it.item || it.id || '').toUpperCase() + ' — ' + money(it.item_total));
  L.push('', 'TOTAL: ' + money(row.total));
  if (row.notes) L.push('', 'Additional Notes:', String(row.notes));
  return L.join('\n');
}

/** The person's linked contact id, or null. */
async function linkedContact(DB, ownerId) {
  const l = await DB.select('wimpy_hl_contacts?owner_user_id=eq.' + enc(ownerId) + '&select=contact_id&limit=1');
  return (l && l[0] && l[0].contact_id) || null;
}
const cardContact = (c) => (c && (c.contactId || (c.contact && c.contact.id))) || null;

/**
 * Write one ledger row to HighLevel. Never throws; answers {id, state, error?, contactId}. Only rows the caller owns may
 * be passed — the order path's own new row, or a row the caller CLAIMED (claimOne; opts.claimed = true).
 * opts.linkKnown + opts.contactId: the caller already read the person's link (contactId null = they have none).
 */
export async function writeOrderToHighLevel(env, DB, row, opts = {}) {
  if (!row || !row.id) return { id: null, state: 'skipped', error: 'no row', contactId: null };
  if (!hlConfigured(env)) return { id: row.id, state: 'pending', error: 'not configured', contactId: null };
  const claimed = !!opts.claimed;
  const seed = row.hl_contact_seed || {};
  const patchRow = (patch) => DB.update('wimpy_orders?id=eq.' + enc(row.id), patch);
  let contactId = null;
  const failWith = async (why) => {
    const tries = (Number(row.hl_tries) || 0) + (claimed ? 0 : 1);           // a claim already counted its try (L1)
    const stuck = tries >= MAX_TRIES;
    const patch = { hl_state: stuck ? 'stuck' : 'failed', hl_tries: tries, hl_error: redactPerson(redact(env, why), seed),
      hl_next_at: iso(Date.now() + BACKOFF_MIN[Math.min(Math.max(tries, 1), BACKOFF_MIN.length) - 1] * MIN_MS) };
    if (stuck || contactId) patch.hl_contact_seed = null;                    // M4: not needed once stuck or once she has a contact
    try { await patchRow(patch); }
    catch (e) { console.warn('[wimpy-hl] could not record a failed card write: ' + dbWhy(env, e)); }
    return { id: row.id, state: patch.hl_state, error: patch.hl_error, contactId };
  };
  try {
    /* 1 · the person's ONE contact */
    contactId = opts.linkKnown ? (opts.contactId || null) : await linkedContact(DB, row.owner_user_id);
    /* a card for THIS order can only exist on a contact that was already linked when this attempt began: every card is
       made on a linked contact, and links are never removed (but by the account's own deletion) */
    const hadContact = !!contactId;
    if (!contactId) {
      if (!seed.first || !seed.phone) return failWith('contact: no typed name and phone kept to create the contact from — their next order creates it, and this row then links to it');
      const tags = ['wimpy', String(row.cb || '').trim().toLowerCase()].filter(Boolean);   // the CB number travels as a tag (review L6)
      const c = await hlRequest(env, 'POST', '/contacts/', { body: { locationId: env.WIMPY_HL_LOCATION_ID,
        firstName: seed.first, lastName: seed.last || '', phone: seed.phone, tags, source: 'Wimpy app' } });
      if (!c.ok) return failWith('contact: ' + c.error);
      const created = c.json && c.json.contact && c.json.contact.id;
      if (!created) return failWith('contact: HighLevel answered without a contact id');
      try {
        await DB.insert('wimpy_hl_contacts', [{ owner_user_id: row.owner_user_id, cb: row.cb, contact_id: created }]);
        contactId = created;
      } catch (e) {
        /* another request linked a contact for this person first: THAT one is theirs — ours is left orphaned in
           HighLevel, never linked, so one person never ends up with two contacts on our side */
        contactId = await linkedContact(DB, row.owner_user_id).catch(() => null);
        if (!contactId) return failWith('contact link not saved: ' + dbWhy(env, e));
      }
    }
    /* 2 · the pipeline; then, on a retry, this order's card if an earlier attempt made it */
    const P = await resolvePipeline(env);
    if (!P.ok) return failWith(P.error);
    const name = cardNameFor(row);
    let cardId = row.hl_opportunity_id ? String(row.hl_opportunity_id) : null;
    if (!cardId && claimed && hadContact) {
      const s = await hlRequest(env, 'GET', '/opportunities/search', { timeoutMs: HL_READ_TIMEOUT_MS,
        query: { location_id: env.WIMPY_HL_LOCATION_ID, contact_id: contactId, pipeline_id: P.pipelineId, limit: 100 } });
      if (!s.ok) return failWith('card check: ' + s.error);
      const match = ((s.json && s.json.opportunities) || []).find((c) => c && c.id && c.name === name && cardContact(c) === contactId);
      if (match) {
        const other = await DB.select('wimpy_orders?hl_opportunity_id=eq.' + enc(match.id) + '&id=neq.' + enc(row.id) + '&select=id&limit=1');
        if (!(other && other.length)) cardId = String(match.id);
      }
    }
    /* 3 · the card, at "New Order" — only when there is none for this order */
    if (!cardId) {
      const o = await hlRequest(env, 'POST', '/opportunities/', { body: { pipelineId: P.pipelineId, locationId: env.WIMPY_HL_LOCATION_ID,
        name, pipelineStageId: P.newStageId, status: 'open', contactId, monetaryValue: Number(row.total) } });
      if (!o.ok) return failWith('card: ' + o.error);
      cardId = o.json && o.json.opportunity && o.json.opportunity.id;
      if (!cardId) return failWith('card: HighLevel answered without an opportunity id');
    }
    /* 4 · recorded AT ONCE: written, with its card; the typed name/phone are no longer needed */
    await patchRow({ hl_state: 'written', hl_contact_id: contactId, hl_opportunity_id: cardId, hl_error: null, hl_contact_seed: null });
    /* 5 · the order's items as a note on the contact (a failure is logged, not retried — the card is the deliverable) */
    const n = await hlRequest(env, 'POST', '/contacts/' + enc(contactId) + '/notes', { body: { body: noteFor(row) } });
    if (!n.ok) console.warn('[wimpy-hl] card written; the note could not be added — ' + redactPerson(n.error, seed));
    return { id: row.id, state: 'written', contactId };
  } catch (e) {
    return failWith(dbWhy(env, e));
  }
}

/* ================================================================ RETRIES
   A row is DUE when it is pending or failed and its hl_next_at has passed (a new row's is placed + 2 min, so the order
   path's own write is never raced). claimOne() is a compare-and-set on the row's CURRENT hl_tries: it counts the try
   (tries + 1) and pushes hl_next_at out by a lease, in one PATCH whose filter re-checks state, hl_next_at and hl_tries —
   so of two runners only one gets the row, and a row whose processing kills its runner still counts every attempt
   (review L1). A due row that has already used its 8 tries is marked stuck by that same PATCH instead of claimed. */
const ROW_COLS = 'id,owner_user_id,cb,placed_at,items,total,notes,hl_state,hl_tries,hl_next_at,hl_error,hl_opportunity_id,hl_contact_seed';
const isDue = (r, now) => (r.hl_state === 'pending' || r.hl_state === 'failed') && Date.parse(r.hl_next_at) <= now;
export async function claimOne(DB, row, now, ownerId) {
  const cur = Number(row.hl_tries) || 0;
  const q = 'wimpy_orders?id=eq.' + enc(row.id) + (ownerId ? '&owner_user_id=eq.' + enc(ownerId) : '')
    + '&hl_tries=eq.' + cur + '&hl_state=in.(pending,failed)&hl_next_at=lte.' + enc(iso(now));
  const patch = cur >= MAX_TRIES
    ? { hl_state: 'stuck', hl_contact_seed: null, hl_error: 'stopped after ' + MAX_TRIES + ' tries — the last attempt never finished' }
    : { hl_tries: cur + 1, hl_next_at: iso(now + LEASE_MIN * MIN_MS) };
  const got = (await DB.updateReturning(q, patch)) || [];
  return got[0] || null;
}

export const STATUS_KEY = 'kv:wimpy-hl-status';
/**
 * THE WIMPY CRON (index.mjs WIMPY_CRON, "7,27,47 * * * *"): the ≤ 5 due rows, selected DIRECTLY by state and hl_next_at
 * (review M3 — stuck rows can never fill the page and hide them), each claimed then written; then kv:wimpy-hl-status —
 * counts and the last error only, no person in it — from one light select. Not configured: no row is touched.
 * Subrequests: due select 1 + links 1 + rows (≤ 8, then ≤ 7: the pipeline is cached) + counts 1 + status 1.
 */
export async function retryDueOrders(env, DB) {
  const now = Date.now();
  const configured = hlConfigured(env);
  const results = [];
  let due = 0;
  if (configured) {
    const rows = (await DB.select('wimpy_orders?hl_state=in.(pending,failed)&hl_next_at=lte.' + enc(iso(now))
      + '&select=' + ROW_COLS + '&order=hl_next_at.asc&limit=' + CRON_ROWS)) || [];
    due = rows.length;
    const links = new Map();
    if (rows.length) {
      const owners = [...new Set(rows.map((r) => String(r.owner_user_id)))];
      for (const l of (await DB.select('wimpy_hl_contacts?owner_user_id=in.(' + owners.map(enc).join(',') + ')&select=owner_user_id,contact_id')) || [])
        links.set(String(l.owner_user_id), l.contact_id);
    }
    for (const r of rows) {
      const c = await claimOne(DB, r, now);
      if (!c) continue;                                                       // another runner has it
      if (c.hl_state === 'stuck') { results.push({ id: c.id, state: 'stuck', error: c.hl_error }); continue; }
      const owner = String(c.owner_user_id);
      const x = await writeOrderToHighLevel(env, DB, c, { claimed: true, linkKnown: true, contactId: links.get(owner) || null });
      if (x.contactId) links.set(owner, x.contactId);
      results.push(x);
    }
  }
  const all = (await DB.select('wimpy_orders?hl_state=in.(pending,failed,stuck)&select=hl_state,placed_at,hl_error&order=placed_at.asc&limit=1000')) || [];
  const counts = { pending: 0, failed: 0, stuck: 0 };
  for (const r of all) if (r.hl_state in counts) counts[r.hl_state]++;
  const lastErr = (results.filter((x) => x.error).pop() || {}).error || (all.filter((r) => r.hl_error).pop() || {}).hl_error || null;
  const status = { at: iso(now), configured, counts, due, capped: all.length >= 1000, oldest_unwritten_at: (all[0] && all[0].placed_at) || null,
    processed: { written: results.filter((x) => x.state === 'written').length, failed: results.filter((x) => x.state === 'failed').length,
      stuck: results.filter((x) => x.state === 'stuck').length },
    last_error: lastErr ? redact(env, lastErr).slice(0, 160) : null };
  await DB.insert('rules', [{ key: STATUS_KEY, value: { data: JSON.stringify(status) }, updated_by: 'wimpy-cron', updated_at: iso(now) }], true);
  return { configured, due, counts, processed: status.processed };
}

/* ================================================================ MY ORDERS — GET /api/wimpy/orders
   "it must only show their order history and no one elses". WHOSE orders is decided by ONE value: the session's
   user_id, handed in by the route. This function is never given the request — no query string, no body, no header can
   reach it — so nothing a page sends can widen or change the answer. On top of the database filter:
     · every row the ledger answers is checked again here against that owner (a broken filter cannot leak a row);
     · a HighLevel card contributes a stage ONLY if it is on the contact linked to THIS account AND its id is the one
       recorded on that very row — a card naming her CB on another contact, or a card of hers not on any of her rows,
       is never used;
     · the reply carries no id of any kind (ours or HighLevel's), no phone and no name.
   HighLevel slow or down (5 s) → the orders still come back, each with a plain note instead of a stage. A search that
   comes back full (100) without an order's card says "could not be reached", never "gone" (review L2).
   ONE HIGHLEVEL READ PER PERSON PER 10 s (review L3): the stages read is kept in this isolate, keyed by the session's
   user_id ALONE, for 10 s; inside that window her own copy answers and a card it has not seen says "updated a moment
   ago". Nobody's copy is ever another's.
   Her own due rows (≤ 2) are claimed and retried after the reply, so a late card catches up when she looks.
   Subrequests: session 1 + ledger 1 + link 1 + pipelines ≤ 1 + search 1 + (own retry: 2 × claim + ≤ 7) ≤ 21. */
export const HISTORY_LIMIT = 50;
export const OWN_RETRY_ROWS = 2;
export const HL_READ_TIMEOUT_MS = 5000;
const SEARCH_LIMIT = 100;
const STAGE_TTL_MS = 10000;
const STAGE_CACHE_MAX = 500;
export const STAGE_NOTES = {
  notYet: 'Not on the kitchen board yet',
  unreachable: 'The kitchen board could not be reached — try again shortly',
  gone: 'No longer on the kitchen board',
  recent: 'Updated a moment ago — refresh in a few seconds for the latest stage',
};
const sastIso = (t) => { const ms = Date.parse(t); return Number.isFinite(ms) ? new Date(ms + 2 * 3600000).toISOString().slice(0, 19) + '+02:00' : null; };
const two = (v) => Number(v || 0).toFixed(2);
const stageCache = () => (globalThis.__wimpyStageCache = globalThis.__wimpyStageCache || new Map());

/* The stage of each of HER cards: {ok, byCard: {cardId → stage name | null}, contactId, linkKnown, truncated}. ok:false =
   HighLevel could not be asked (or answered with an error) — the caller says "could not be reached", never "gone". */
async function readStages(env, DB, owner, carded) {
  let contactId = null;
  try { contactId = await linkedContact(DB, owner); } catch (e) { return { ok: false, byCard: null, contactId: null, linkKnown: false }; }
  if (!contactId) return { ok: true, byCard: {}, contactId: null, linkKnown: true };      // no contact of hers: no card can be proved hers
  let P = await resolvePipeline(env);
  if (!P.ok) return { ok: false, byCard: null, contactId, linkKnown: true };
  const s = await hlRequest(env, 'GET', '/opportunities/search', { timeoutMs: HL_READ_TIMEOUT_MS,
    query: { location_id: env.WIMPY_HL_LOCATION_ID, contact_id: contactId, pipeline_id: P.pipelineId, limit: SEARCH_LIMIT } });
  if (!s.ok) return { ok: false, byCard: null, contactId, linkKnown: true };
  const answered = (s.json && s.json.opportunities) || [];
  const recorded = new Set(carded.map((r) => String(r.hl_opportunity_id)));
  const cards = answered.filter((c) => c && c.id
    && cardContact(c) === contactId                                           // on HER contact…
    && recorded.has(String(c.id))                                             // …and recorded on one of HER rows
    && (!c.pipelineId || c.pipelineId === P.pipelineId));                     // still in the Wimpy Pipeline
  /* a stage the cached map does not know (the kitchen added one): re-read the pipeline once */
  if (P.cached && cards.some((c) => !Object.prototype.hasOwnProperty.call(P.stages, c.pipelineStageId))) {
    const fresh = await resolvePipeline(env, { force: true });
    if (fresh.ok) P = fresh;
  }
  const byCard = {};
  for (const c of cards) byCard[String(c.id)] = Object.prototype.hasOwnProperty.call(P.stages, c.pipelineStageId) ? P.stages[c.pipelineStageId] : null;
  return { ok: true, byCard, contactId, linkKnown: true, truncated: answered.length >= SEARCH_LIMIT };
}

/** One order as the page sees it — a whitelist: nothing else of the row ever leaves. */
function shapeOrder(r, stages) {
  let stage = null, note = null;
  const card = r.hl_opportunity_id ? String(r.hl_opportunity_id) : '';
  if (!card) note = STAGE_NOTES.notYet;
  else if (!stages.ok) note = STAGE_NOTES.unreachable;
  else if (stages.byCard && stages.byCard[card]) stage = stages.byCard[card];
  else if (stages.cached && !(stages.byCard && Object.prototype.hasOwnProperty.call(stages.byCard, card))) note = STAGE_NOTES.recent;
  else if (stages.truncated) note = STAGE_NOTES.unreachable;
  else note = STAGE_NOTES.gone;
  return {
    placed_at: sastIso(r.placed_at),
    total: two(r.total),
    notes: r.notes ? String(r.notes) : null,
    items: (Array.isArray(r.items) ? r.items : []).map((i) => ({ item: String((i && i.item) || ''), quantity: Number(i && i.quantity) || 0, item_total: two(i && i.item_total) })),
    stage,
    stage_note: note,
  };
}

/**
 * GET /api/wimpy/orders. `user` is the SESSION (index.mjs); `since` is WIMPY_HISTORY_SINCE. Answers {status, body}.
 */
export async function listMyOrders(env, DB, user, ctx, { since = null } = {}) {
  const owner = user && user.user_id ? String(user.user_id) : '';
  if (!owner) return { status: 401, body: { error: 'Sign in required.' } };
  const now = Date.now();
  let rows;
  try {
    rows = (await DB.select('wimpy_orders?owner_user_id=eq.' + enc(owner) + '&select=' + ROW_COLS + '&order=placed_at.desc&limit=' + HISTORY_LIMIT)) || [];
  } catch (e) {
    console.error('[wimpy] My orders: the ledger could not be read — ' + dbWhy(env, e));
    return { status: 500, body: { error: 'Your orders could not be loaded just now — try again in a minute.' } };
  }
  rows = rows.filter((r) => r && String(r.owner_user_id) === owner)              // only the session's own, whatever the query answered
    .sort((a, b) => Date.parse(b.placed_at) - Date.parse(a.placed_at)).slice(0, HISTORY_LIMIT);

  const configured = hlConfigured(env);
  const carded = rows.filter((r) => r.hl_opportunity_id);
  let stages = { ok: configured, byCard: {}, contactId: null, linkKnown: false };
  if (configured && carded.length) {
    const cache = stageCache();
    const hit = cache.get(owner);                                              // keyed by the SESSION's user_id — nothing else
    if (hit && now >= hit.at && now - hit.at < STAGE_TTL_MS) stages = { ...hit.stages, cached: true };
    else {
      stages = await readStages(env, DB, owner, carded);
      cache.delete(owner); cache.set(owner, { at: now, stages });
      while (cache.size > STAGE_CACHE_MAX) cache.delete(cache.keys().next().value);
    }
  }
  const orders = rows.map((r) => shapeOrder(r, stages));

  /* her own late cards catch up when she looks — after the reply, ≤ 2, each claimed with HER id in the filter */
  const due = configured ? rows.filter((r) => isDue(r, now)).slice(0, OWN_RETRY_ROWS) : [];
  if (due.length && ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil((async () => {
      let contactId = stages.contactId, linkKnown = !!stages.linkKnown;
      try {
        for (const r of due) {
          const c = await claimOne(DB, r, now, owner);
          if (!c || String(c.owner_user_id) !== owner || c.hl_state === 'stuck') continue;
          const x = await writeOrderToHighLevel(env, DB, c, { claimed: true, linkKnown, contactId });
          if (x.contactId) { contactId = x.contactId; linkKnown = true; }
        }
      } catch (e) { console.warn('[wimpy] My orders: own retry failed — ' + dbWhy(env, e)); }
    })());
  }
  return { status: 200, body: { since, stages_available: configured && stages.ok, orders } };
}

/** Tests only: forget the isolate's pipeline map and every person's stage copy. */
export function _resetHlCache() { globalThis.__wimpyHlPipe = null; globalThis.__wimpyStageCache = null; }
/** Tests only: forget every person's stage copy (the 10 s throttle). */
export function _resetStageCache() { globalThis.__wimpyStageCache = null; }
