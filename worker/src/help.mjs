/* AGENT HELP CENTER — HighLevel opportunities as the queue, its pipeline stages as
 * the status bar (Nick, 2026-08-26).
 *
 * WHY HIGHLEVEL. Two reasons Nick named: it keeps this data OUT of the app's own
 * storage (the blob model is at its ceiling), and it keeps a durable record of how
 * often each team leader helped each agent — the coaching story behind the numbers.
 * The pipeline "Agent Help Center" (created 2026-08-26 in location HL_HELP_LOCATION_ID,
 * stages New → In progress → Waiting on agent → Closed) IS the status bar: the page
 * renders whatever stages the pipeline actually has, so renaming or adding stages in
 * HighLevel changes the app with no deploy.
 *
 * DUPLICATES ARE THE POINT. Every request creates a NEW opportunity — the same agent
 * asking twice with different reasons is two real requests, never an upsert.
 *
 * The key lives ONLY here (HL_HELP_API_KEY/HL_HELP_LOCATION_ID Worker secrets — a
 * DIFFERENT location from the referrals feed's HL_API_KEY; never mix them). One HL
 * contact per agent (id remembered in kv:help-contacts) so per-agent history rolls up
 * in the CRM; the agent's note is stored as a contact note tagged with the
 * opportunity id.
 *
 * Scoping mirrors the portal: an agent may only CREATE (their own request); a team
 * leader may only READ/MOVE requests whose CB is on their team — same authorise()
 * as every other portal route.
 */
import { authorise, normCb, coachingFor } from './portal.mjs';

const HL = 'https://services.leadconnectorhq.com';
const PIPE_NAME = 'Agent Help Center';
export const HELP_CATEGORIES = ['Review my call', 'Explain what to say', 'Explain the product',
  'Explain my quality result', 'Help with the system', 'Something else'];

const hdrs = (env) => ({ Authorization: 'Bearer ' + env.HL_HELP_API_KEY, Version: '2021-07-28', 'Content-Type': 'application/json' });
export async function hl(env, path, opts) {
  /* 10s abort (audit, 2026-08-27): helpList/actionsList chain up to six of these
     sequentially — without a timeout a hanging HL endpoint hangs the TL's page until
     Cloudflare kills the whole invocation, indistinguishable from the Worker being down. */
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort('HighLevel timeout'), 10000);
  let r, t;
  try {
    r = await fetch(HL + path, { ...(opts || {}), headers: hdrs(env), signal: ctl.signal });
    t = await r.text();
  } catch (e) {
    /* only an ABORT is a timeout — a DNS/TLS/reset failure keeps its own story,
       or the timeout message misdirects the debugging (adversarial review, 2026-08-27) */
    if (ctl.signal.aborted) throw new Error('HighLevel ' + path.split('?')[0] + ' did not answer within 10s');
    throw new Error('HighLevel ' + path.split('?')[0] + ' unreachable: ' + String(e && e.message || e).slice(0, 120));
  } finally { clearTimeout(timer); }
  let j = null; try { j = t ? JSON.parse(t) : null; } catch {}
  if (!r.ok) {
    /* the status and body ride on the error so a caller can recover from a specific
       refusal — HL's "duplicated contacts" 400 names the existing contact (2026-09-21) */
    const err = new Error('HighLevel ' + path.split('?')[0] + ' → ' + r.status + ': ' + t.slice(0, 160));
    err.status = r.status; err.body = j; throw err;
  }
  return j;
}

async function pipeline(env) {
  const c = globalThis.__helpPipe;
  if (c && Date.now() - c.t < 300000 && c.p) return c.p;   // never cache "missing" — it 503'd for 5 min after creation
  const j = await hl(env, '/opportunities/pipelines?locationId=' + env.HL_HELP_LOCATION_ID);
  const p = (j.pipelines || []).find((x) => x.name === PIPE_NAME) || null;
  if (p) p.stages = (p.stages || []).slice().sort((a, b) => a.position - b.position);
  globalThis.__helpPipe = { t: Date.now(), p };
  return p;
}

/* EVERY pipeline read paginates. These pipelines only grow (closed records stay,
   duplicates are a feature in one of them) — a single limit=100 page silently
   truncated the queue and, worse, made the find-or-create paths MISS an existing
   record and mint a duplicate. Found by review 2026-08-26. */
export async function searchAll(env, pipelineId, maxPages) {
  const out = [];
  let total = null;
  for (let pg = 1; pg <= (maxPages || 5); pg++) {
    /* order PINNED newest-first (verified accepted, 2026-08-26): the find-or-create
       paths and the first-match maps both assume live records come before dead
       history if the cap is ever hit. meta.total makes truncation DETECTED, never
       assumed away. */
    const j = await hl(env, '/opportunities/search?location_id=' + env.HL_HELP_LOCATION_ID + '&pipeline_id=' + pipelineId + '&limit=100&page=' + pg + '&order=added_desc');
    const ops = j.opportunities || [];
    if (j.meta && j.meta.total != null) total = Number(j.meta.total);
    out.push(...ops);
    if (ops.length < 100) break;
  }
  /* FAIL CLOSED WITHOUT meta.total (audit, 2026-08-27). If HighLevel ever stops sending
     the total (API drift, error-shaped 200), the old return said truncated:false even
     when the scan exited by page cap with the last page full — turning every 409
     dedupe guard fail-OPEN, minting duplicates forever. A full final page with an
     unknown total is now treated as truncated: the guards refuse instead of guessing. */
  /* cappedFull counts as truncated even when meta.total is PRESENT — a total that lies
     low must not re-open the fail-open hole (adversarial review, 2026-08-27). The one
     false positive — a pipeline holding exactly maxPages×100 records — refuses safely. */
  const cappedFull = out.length >= (maxPages || 5) * 100;
  return { ops: out, total: total == null ? out.length : total,
    truncated: (total != null && out.length < total) || cappedFull };
}

/* one HL contact per agent — ONE ROW PER AGENT (kv:help-contact:CBnn). The old
   shared-map blob had an unfixable read-modify-write race (review, 2026-08-26):
   concurrent creates for DIFFERENT agents clobbered each other's entries. A row
   per agent has no shared state to lose; merge-duplicates makes the write
   idempotent. Legacy kv:help-contacts entries are honoured read-only.
   `memo` (optional) is a per-invocation cache so a sync batch does not re-read
   per session — pass {} once per Worker invocation. */
export async function contactFor(env, DB, cb, name, memo, stats) {
  /* `stats.n` counts the ACTUAL subrequests this call spends (adversarial review,
     2026-08-27: the flat-cost guesses in syncCoaching both over- and under-counted —
     a fresh contact really costs 4, a DB hit costs 1). */
  const bump = () => { if (stats) stats.n++; };
  if (memo && memo[cb]) return memo[cb];
  bump(); const row = await DB.select(`rules?key=eq.${encodeURIComponent('kv:help-contact:' + cb)}&select=value`).catch(() => null);
  let id = row && row[0] && row[0].value && row[0].value.id;
  if (!id) {
    /* legacy map fallback — contacts created before the per-agent rows */
    bump(); const r = await DB.select(`rules?key=eq.${encodeURIComponent('kv:help-contacts')}&select=value`).catch(() => null);
    id = (((r && r[0] && r[0].value) || {}).map || {})[cb] || null;
    if (id) { bump(); await DB.insert('rules', [{ key: 'kv:help-contact:' + cb, value: { id },
      updated_by: 'help-center', updated_at: new Date().toISOString() }], true); }
  }
  if (!id) {
    /* HL requires first+last (or email/phone). The CB code rides as a tag — the
       opportunity NAME is what carries identity for the app's own parsing. */
    const parts = String(name || cb).trim().split(/\s+/);
    const body = { locationId: env.HL_HELP_LOCATION_ID, firstName: parts[0] || cb,
      lastName: parts.slice(1).join(' ') || cb, tags: ['agentos-help', cb.toLowerCase()] };
    try {
      bump(); const j = await hl(env, '/contacts/', { method: 'POST', body: JSON.stringify(body) });
      id = j.contact && j.contact.id;
    } catch (e) {
      /* THE PERSON ALREADY EXISTS — ADOPT THEM (Nick, 2026-09-21: "asking my team leader for help
         is giving 400 … something for duplications — this must not happen"). The location refuses
         a second contact with the same name and answers 400 with the existing contact's id in
         meta. When our per-agent pointer is missing (a cleared row, a re-keyed CB, a contact made
         by hand in HighLevel) every request minted the same person again and every request
         failed. The refusal IS the lookup: take the id it names; failing that, search the
         location by name for a contact tagged with this CB. Only then is it an error. */
      const dup = e && e.status === 400 && /duplicat/i.test(String((e.body && e.body.message) || e.message || ''));
      if (!dup) throw e;
      id = e.body && e.body.meta && (e.body.meta.contactId || (e.body.meta.contact && e.body.meta.contact.id)) || null;
      if (!id) {
        bump(); const s = await hl(env, '/contacts/?locationId=' + env.HL_HELP_LOCATION_ID + '&query=' + encodeURIComponent(String(name || cb).trim()) + '&limit=20').catch(() => null);
        const cs = (s && s.contacts) || [];
        const tagged = cs.find((c) => (c.tags || []).map((x) => String(x).toLowerCase()).includes(cb.toLowerCase()));
        const named = cs.find((c) => String(c.firstName || '').toLowerCase() === String(body.firstName).toLowerCase() && String(c.lastName || '').toLowerCase() === String(body.lastName).toLowerCase());
        id = (tagged || named || {}).id || null;
      }
      if (!id) throw e;
    }
    if (!id) throw new Error('contact create returned no id');
    bump(); await DB.insert('rules', [{ key: 'kv:help-contact:' + cb, value: { id },
      updated_by: 'help-center', updated_at: new Date().toISOString() }], true);
  }
  if (memo) memo[cb] = id;
  return id;
}

export async function helpRequest(env, DB, user, digest, body) {
  if (user.role !== 'agent') return { status: 403, body: { error: 'Requests come from agents.' } };
  const auth = authorise(user, digest);
  if (auth.error) return { status: auth.status, body: { error: auth.error } };
  const cb = normCb(user.cb);
  const cat = HELP_CATEGORIES.includes(String(body.category)) ? String(body.category) : 'Something else';
  const note = String(body.note || '').trim().slice(0, 2000);
  if (!note) return { status: 400, body: { error: 'Say a little about what you need — the note is what your team leader reads.' } };
  const p = await pipeline(env);
  if (!p || !p.stages.length) return { status: 503, body: { error: 'The Help Center pipeline is missing in HighLevel — ask an admin to create "' + PIPE_NAME + '".' } };
  const me = (auth.rows && auth.rows[0]) || {};
  const name = user.full_name || user.username || cb;
  const contactId = await contactFor(env, DB, cb, name);
  const opp = await hl(env, '/opportunities/', { method: 'POST', body: JSON.stringify({
    locationId: env.HL_HELP_LOCATION_ID, pipelineId: p.id, pipelineStageId: p.stages[0].id,
    name: '[' + cat + '] ' + cb + ' ' + name, status: 'open', contactId }) });
  const oppId = (opp.opportunity && opp.opportunity.id) || '';
  await hl(env, '/contacts/' + contactId + '/notes', { method: 'POST', body: JSON.stringify({
    body: 'Help request ' + oppId + '\nTopic: ' + cat + '\nFrom: ' + name + ' (' + cb + ')'
      + (me.campaign ? ' · ' + me.campaign : '') + (me.tl ? ' · Team ' + me.tl : '') + '\n\n' + note }) });
  return { status: 200, body: { ok: true, id: oppId } };
}

/* The agent's own requests — so they can see where each one stands and close one
   off themselves ("sorted it, thanks"). Closing removes it from their page and the
   team leader's queue alike; the record stays in the pipeline (Nick, 2026-08-26). */
export async function helpMine(env, DB, user, digest) {
  if (user.role !== 'agent') return { status: 403, body: { error: 'This list is an agent\'s own.' } };
  const auth = authorise(user, digest);
  if (auth.error) return { status: auth.status, body: { error: auth.error } };
  const cb = normCb(user.cb);
  const p = await pipeline(env);
  if (!p) return { status: 200, body: { stages: [], requests: [] } };
  const __sr = await searchAll(env, p.id);
  const j = { opportunities: __sr.ops };
  const rows = (j.opportunities || []).map((o) => parseRow(o, p.stages, {}))
    .filter((r) => r.cb === cb)
    .sort((a, b) => String(b.created).localeCompare(String(a.created)));
  return { status: 200, body: { stages: p.stages.map((s) => ({ id: s.id, name: s.name })), requests: rows, truncated: __sr.truncated, total: __sr.total } };
}
export async function helpCloseOwn(env, DB, user, digest, body) {
  if (user.role !== 'agent') return { status: 403, body: { error: 'Only the agent who asked can close their own request here.' } };
  const auth = authorise(user, digest);
  if (auth.error) return { status: auth.status, body: { error: auth.error } };
  const cb = normCb(user.cb);
  const id = String(body.id || '');
  if (!id) return { status: 400, body: { error: 'id required.' } };
  const p = await pipeline(env);
  if (!p || !p.stages.length) return { status: 503, body: { error: 'Pipeline missing.' } };
  const cur = await hl(env, '/opportunities/' + encodeURIComponent(id));
  const __opp = cur.opportunity || cur;
  if (String(__opp.pipelineId || '') !== p.id) return { status: 404, body: { error: 'That is not a request in this pipeline.' } };
  const row = parseRow(__opp, p.stages, {});
  if (row.cb !== cb) return { status: 403, body: { error: 'That request is not yours.' } };
  await hl(env, '/opportunities/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify({
    pipelineStageId: p.stages[p.stages.length - 1].id, status: 'won' }) });
  return { status: 200, body: { ok: true } };
}

function parseRow(o, stages, byCb) {
  const m = String(o.name || '').match(/^\[([^\]]+)\]\s+(CB\d+)\s*(.*)$/i);
  /* Identity comes from the [cat] CBnn name; the fallback for a hand-made/renamed record
     accepts ONLY an explicit CB token in the contact name — never digit-stripping, which
     minted a CB out of any digits ("Anathi 2nd" → CB2) and attributed the record to the
     wrong agent, who could then read and close it (audit, 2026-08-27). No token → cb ''
     → visible to scope 'all' only, never mis-scoped. */
  let cb = '';
  if (m) cb = normCb(m[2]);
  else { const cm = String((o.contact && o.contact.name) || '').match(/\bCB[-\s]?(\d+)\b/i); if (cm) cb = normCb('cb' + cm[1]); }
  const si = stages.findIndex((s) => s.id === o.pipelineStageId);
  return { id: o.id, cb,
    agent: (byCb[cb] && byCb[cb].name) || (m && m[3] ? m[3] : '') || cb,
    category: m ? m[1] : 'Something else',
    contactId: o.contactId || (o.contact && o.contact.id) || '',
    stageId: o.pipelineStageId, stage: si >= 0 ? stages[si].name : '?', stageIdx: si,
    closed: (stages.length && si === stages.length - 1) || o.status === 'won',
    created: o.createdAt || o.dateAdded || '', updated: o.updatedAt || '' };
}

const tlOnly = (auth) => (auth.scope !== 'team' && auth.scope !== 'all')
  ? { status: 403, body: { error: 'The Help Center is for team leaders.' } } : null;

export async function helpList(env, DB, user, digest) {
  const auth = authorise(user, digest);
  if (auth.error) return { status: auth.status, body: { error: auth.error } };
  const deny = tlOnly(auth); if (deny) return deny;
  const p = await pipeline(env);
  if (!p) return { status: 200, body: { setup: 'Create a pipeline named "' + PIPE_NAME + '" in HighLevel and requests will land here.', stages: [], requests: [] } };
  const __sr = await searchAll(env, p.id);
  const j = { opportunities: __sr.ops };
  const byCb = {}; for (const a of auth.rows || []) byCb[a.code] = a;
  const rows = (j.opportunities || []).map((o) => parseRow(o, p.stages, byCb))
    .filter((r) => auth.scope === 'all' || auth.codes.has(r.cb))
    .sort((a, b) => String(b.created).localeCompare(String(a.created)));
  return { status: 200, body: { stages: p.stages.map((s) => ({ id: s.id, name: s.name })), requests: rows, truncated: __sr.truncated, total: __sr.total } };
}

export async function helpDetail(env, DB, user, digest, id) {
  const auth = authorise(user, digest);
  if (auth.error) return { status: auth.status, body: { error: auth.error } };
  const deny = tlOnly(auth); if (deny) return deny;
  if (!id) return { status: 400, body: { error: 'id required.' } };
  const p = await pipeline(env);
  /* No known pipeline → refuse. The old `p && …` guard SKIPPED the pipeline check when
     the lookup returned null, letting a TL fetch any opportunity in the location whose
     parsed CB landed on their team (audit, 2026-08-27). */
  if (!p) return { status: 503, body: { error: 'The Help Center pipeline is not reachable right now — try again shortly.' } };
  const j = await hl(env, '/opportunities/' + encodeURIComponent(id));
  const __oppD = j.opportunity || j;
  if (String(__oppD.pipelineId || '') !== p.id) return { status: 404, body: { error: 'That is not a request in this pipeline.' } };
  const row = parseRow(__oppD, (p && p.stages) || [], {});
  if (auth.scope !== 'all' && !auth.codes.has(row.cb)) return { status: 403, body: { error: 'That request is not from your team.' } };
  let note = '';
  try {
    const n = await hl(env, '/contacts/' + row.contactId + '/notes');
    /* the EXACT prefix helpRequest writes — never a substring match (a later note's
       free text could contain this id) and never a blind fallback to the newest
       note, which belongs to a different request (review, 2026-08-26) */
    const hit = (n.notes || []).find((x) => String(x.body || '').startsWith('Help request ' + id + String.fromCharCode(10)));
    note = hit ? String(hit.body || '') : '';
  } catch {}
  return { status: 200, body: { ...row, note } };
}

/* ---- COACHING ACTIONS (Nick, 2026-08-26: "for the coaching like this I need a way
   to close this off like a status as well"). The My Team ladder's action items get
   the same HighLevel status bar, in a SECOND pipeline — "Coaching Actions" — which
   this code CREATES if it is missing (pipeline creation works when stages carry
   positions). One opportunity per agent + rule + weekly review — deduped, unlike
   the Help Center, because "coach Noluthando on R2" is one piece of work however
   many times the tab is opened. The record accumulates in the CRM: how many ladder
   items each leader closed, and how fast. */
const ACT_PIPE = 'Coaching Actions';

async function actPipeline(env) {
  const c = globalThis.__actPipe;
  if (c && Date.now() - c.t < 300000 && c.p) return c.p;
  const j = await hl(env, '/opportunities/pipelines?locationId=' + env.HL_HELP_LOCATION_ID);
  let p = (j.pipelines || []).find((x) => x.name === ACT_PIPE) || null;
  if (!p) {
    const made = await hl(env, '/opportunities/pipelines', { method: 'POST', body: JSON.stringify({
      locationId: env.HL_HELP_LOCATION_ID, name: ACT_PIPE,
      stages: [{ name: 'To do', position: 0 }, { name: 'Coaching booked', position: 1 },
               { name: 'In progress', position: 2 }, { name: 'Done', position: 3 }] }) });
    p = made.pipeline || null;
  }
  if (p) p.stages = (p.stages || []).slice().sort((a, b) => a.position - b.position);
  globalThis.__actPipe = { t: Date.now(), p };
  return p;
}

/* Name component capped (audit, 2026-08-27): HighLevel truncating a long opportunity name
   breaks parseAct's $-anchored regex — the record vanishes from the list AND from the
   dedupe .find(), so every later click mints an invisible twin. The cap keeps the trailing
   review date intact; identity matching never reads the name component anyway. */
const actName = (code, cb, name, review) => '[' + code + '] ' + cb + ' ' + String(name).slice(0, 80) + ' · ' + review;
function parseAct(o, stages) {
  const m = String(o.name || '').match(/^\[([^\]]+)\]\s+(CB\d+)\s+(.*?)\s+·\s+(\d{4}-\d{2}-\d{2})$/i);
  if (!m) return null;
  const si = stages.findIndex((s) => s.id === o.pipelineStageId);
  return { id: o.id, code: m[1], cb: normCb(m[2]), review: m[4],
    stageId: o.pipelineStageId, stageIdx: si, stage: si >= 0 ? stages[si].name : '?',
    closed: (stages.length && si === stages.length - 1) || o.status === 'won' };
}

export async function actionsList(env, DB, user, digest) {
  const auth = authorise(user, digest);
  if (auth.error) return { status: auth.status, body: { error: auth.error } };
  const deny = tlOnly(auth); if (deny) return deny;
  const p = await actPipeline(env);
  if (!p) return { status: 200, body: { stages: [], actions: {} } };
  const __sr = await searchAll(env, p.id);
  const j = { opportunities: __sr.ops };
  const actions = {};
  for (const o of (j.opportunities || [])) {
    const a = parseAct(o, p.stages);
    if (!a) continue;
    if (auth.scope !== 'all' && !auth.codes.has(a.cb)) continue;
    /* keep the FIRST match — the write path's .find() picks the first too, so if a
       race ever minted twins, reads and writes land on the SAME record */
    const k = a.cb + '|' + a.code + '|' + a.review;
    if (!(k in actions)) actions[k] = a;
  }
  return { status: 200, body: { stages: p.stages.map((s) => ({ id: s.id, name: s.name })), actions, truncated: __sr.truncated, total: __sr.total } };
}

export async function actionSet(env, DB, user, digest, body) {
  const auth = authorise(user, digest);
  if (auth.error) return { status: auth.status, body: { error: auth.error } };
  const deny = tlOnly(auth); if (deny) return deny;
  const cb = normCb(body.cb), code = String(body.code || '').slice(0, 24).replace(/[\[\]·]/g, '');
  let review = /^\d{4}-\d{2}-\d{2}$/.test(String(body.review || '')) ? String(body.review) : '';
  if (!cb || !code || !review) return { status: 400, body: { error: 'cb, code and review are required.' } };
  /* SNAP TO THE UTC MONDAY server-side (audit, 2026-08-27). The one-record-per-week
     dedupe key must not depend on every client computing the same Monday — a client
     with local-time week math would mint a parallel record for the same week, and the
     first-match maps would hide one of them permanently. Snapping a Monday is a no-op. */
  { const d = new Date(review + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    review = d.toISOString().slice(0, 10); }
  if (auth.scope !== 'all' && !auth.codes.has(cb)) return { status: 403, body: { error: 'That agent is not on your team.' } };
  const p = await actPipeline(env);
  if (!p || !p.stages.length) return { status: 503, body: { error: 'The Coaching Actions pipeline could not be reached.' } };
  const stage = p.stages.find((s) => s.id === String(body.stageId || ''));
  if (!stage) return { status: 400, body: { error: 'A valid stageId is required.' } };
  const row = (auth.rows || []).find((a) => a.code === cb) || {};
  const name = row.name || cb;
  const wantName = actName(code, cb, name, review);
  /* find-or-create: the search index can lag a couple of seconds, so a double-click
     right after creation could duplicate — the ladder de-dupes on render by key, and
     a stray twin is harmless history, so no lock is worth the complexity */
  const __sr = await searchAll(env, p.id);
  if (__sr.truncated) return { status: 409, body: { error: 'Too many records to check safely (' + __sr.total + ') — archive old records in HighLevel first.' } };
  const j = { opportunities: __sr.ops };
  const hit = (j.opportunities || []).map((o) => parseAct(o, p.stages)).filter(Boolean)
    .find((a) => a.cb === cb && a.code === code && a.review === review);
  const last = stage.id === p.stages[p.stages.length - 1].id;
  let id;
  if (hit) {
    id = hit.id;
    await hl(env, '/opportunities/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify({
      pipelineStageId: stage.id, status: last ? 'won' : 'open' }) });
  } else {
    const contactId = await contactFor(env, DB, cb, name);
    /* ONE OPPORTUNITY PER AGENT IN THIS PIPELINE (2026-09-17: "HighLevel /opportunities/ → 400
       OPPORTUNITY_NO_DUPLICATE — Can not create duplicate opportunity for the contact"). The location
       refuses a second opportunity for a contact in the same pipeline, so an agent who already had a
       record from an earlier week or rule could never get this week's. The contact's existing record
       is REUSED — renamed to this rule and review week and moved to the stage; HighLevel keeps the
       stage history on the record, so nothing is lost. The create is only for a first-ever agent. */
    const mine = (j.opportunities || []).filter((o) => String(o.contactId || '') === String(contactId));
    const reuse = mine.find((o) => o.status !== 'won' && o.status !== 'lost')
      || mine.slice().sort((x, y) => String(y.updatedAt || '').localeCompare(String(x.updatedAt || '')))[0] || null;
    if (reuse) {
      id = reuse.id;
      await hl(env, '/opportunities/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify({
        name: wantName, pipelineStageId: stage.id, status: last ? 'won' : 'open' }) });
    } else {
      const made = await hl(env, '/opportunities/', { method: 'POST', body: JSON.stringify({
        locationId: env.HL_HELP_LOCATION_ID, pipelineId: p.id, pipelineStageId: stage.id,
        name: wantName, status: last ? 'won' : 'open', contactId }) });
      id = (made.opportunity && made.opportunity.id) || '';
    }
  }
  const si = p.stages.findIndex((s) => s.id === stage.id);
  return { status: 200, body: { ok: true, id, stageId: stage.id, stageIdx: si, stage: stage.name, closed: last } };
}

/* ---- COACHING FAILS (Nick, 2026-08-26: "record all the coaching fails from the
   coaching hub... in a highlevel pipeline with stages... so i can record and flag
   it"). A coaching FAIL is coaching that did not stick: a Hub theme raised 3+
   times in the 90-day window — 2+ when it is a compliance theme — is a CANDIDATE.
   The team leader flags it; that creates ONE opportunity per agent+theme in the
   "Coaching Fails" pipeline (Flagged → Under review → Escalated → Resolved), with
   the evidence (times raised, last raised, compliance) written into the contact's
   notes so the CRM record explains itself. It stays until Resolved; if the theme
   recurs after that, the pills pull the SAME record back to an open stage — the
   history of the re-open lives in HighLevel's own timeline. */
const FAIL_PIPE = 'Coaching Fails';

async function failPipeline(env) {
  const c = globalThis.__failPipe;
  if (c && Date.now() - c.t < 300000 && c.p) return c.p;
  const j = await hl(env, '/opportunities/pipelines?locationId=' + env.HL_HELP_LOCATION_ID);
  let p = (j.pipelines || []).find((x) => x.name === FAIL_PIPE) || null;
  if (!p) {
    const made = await hl(env, '/opportunities/pipelines', { method: 'POST', body: JSON.stringify({
      locationId: env.HL_HELP_LOCATION_ID, name: FAIL_PIPE,
      stages: [{ name: 'Flagged', position: 0 }, { name: 'Under review', position: 1 },
               { name: 'Escalated', position: 2 }, { name: 'Resolved', position: 3 }] }) });
    p = made.pipeline || null;
  }
  if (p) p.stages = (p.stages || []).slice().sort((a, b) => a.position - b.position);
  globalThis.__failPipe = { t: Date.now(), p };
  return p;
}

const isComplianceTheme = (key) => /compliance|verification/i.test(String(key || ''));
function parseFail(o, stages) {
  const m = String(o.name || '').match(/^\[FAIL:([^\]]+)\]\s+(CB\d+)\s+(.*)$/i);
  if (!m) return null;
  const si = stages.findIndex((s) => s.id === o.pipelineStageId);
  return { id: o.id, theme: m[1], cb: normCb(m[2]),
    stageId: o.pipelineStageId, stageIdx: si, stage: si >= 0 ? stages[si].name : '?',
    closed: (stages.length && si === stages.length - 1) || o.status === 'won' };
}

export async function failsList(env, DB, user, digest) {
  const auth = authorise(user, digest);
  if (auth.error) return { status: auth.status, body: { error: auth.error } };
  const deny = tlOnly(auth); if (deny) return deny;
  /* candidates from the Hub feed — the SAME coachingFor the coaching pages read,
     so this list can never disagree with what the drawer shows */
  const co = await coachingFor(env, DB, auth.rows || []);
  const byCb = {}; for (const a of auth.rows || []) byCb[a.code] = a;
  const fails = [];
  for (const m of (co && co.agents) || []) {
    for (const t of m.themes || []) {
      const comp = isComplianceTheme(t.key);
      if (!(t.shown >= 3 || (comp && t.shown >= 2))) continue;
      fails.push({ cb: m.code, agent: m.name || (byCb[m.code] && byCb[m.code].name) || m.code,
        theme: t.key, family: t.family || '', shown: t.shown, last: t.last || '', compliance: comp, rec: null });
    }
  }
  const p = await failPipeline(env);
  if (p) {
    const __sr = await searchAll(env, p.id);
  const j = { opportunities: __sr.ops };
    const recs = {};
    /* first match kept — mirrors failSet's .find(), so twins read/write the same record */
    for (const o of (j.opportunities || [])) { const f = parseFail(o, p.stages); if (f && !((f.cb + '|' + f.theme) in recs)) recs[f.cb + '|' + f.theme] = f; }
    for (const f of fails) f.rec = recs[f.cb + '|' + f.theme] || null;
    /* flagged records whose theme has gone QUIET still show — a fail being worked
       does not vanish because the Hub window rolled past it */
    const have = new Set(fails.map((f) => f.cb + '|' + f.theme));
    for (const k of Object.keys(recs)) {
      if (have.has(k)) continue;
      const r = recs[k];
      if (auth.scope !== 'all' && !auth.codes.has(r.cb)) continue;
      fails.push({ cb: r.cb, agent: (byCb[r.cb] && byCb[r.cb].name) || r.cb, theme: r.theme,
        family: '', shown: 0, last: '', compliance: isComplianceTheme(r.theme), rec: r, quiet: true });
    }
    return { status: 200, body: { stages: p.stages.map((s) => ({ id: s.id, name: s.name })),
      stale: !!(co && co.stale), fails, truncated: __sr.truncated, total: __sr.total } };
  }
  return { status: 200, body: { stages: [], stale: !!(co && co.stale), fails } };
}

/* The story behind one fail — every session where the theme came up (date, product,
   QA score, and what the coach wrote), plus the agent's current standing. Free-text
   here is what a TEAM LEADER wrote on the coaching form, shown back to a team
   leader — the same fields the coaching pages already print. */
export async function failDetail(env, DB, user, digest, q) {
  const auth = authorise(user, digest);
  if (auth.error) return { status: auth.status, body: { error: auth.error } };
  const deny = tlOnly(auth); if (deny) return deny;
  const cb = normCb(q.cb), theme = String(q.theme || '');
  if (!cb || !theme) return { status: 400, body: { error: 'cb and theme are required.' } };
  if (auth.scope !== 'all' && !auth.codes.has(cb)) return { status: 403, body: { error: 'That agent is not on your team.' } };
  const row = (auth.rows || []).find((a) => a.code === cb) || { code: cb, name: cb };
  const co = await coachingFor(env, DB, [row], { withSessions: true });
  const m = ((co && co.agents) || [])[0] || {};
  const sessions = (m.sessions || [])
    .filter((s) => (s.clusters || []).some((c) => c.clusterKey === theme))
    .map((s) => {
      const said = ['developmentAreas', 'teamLeaderComments', 'coachingDetails', 'wayForward', 'supportProvided']
        .map((k) => s[k]).find((v) => v && String(v).trim());
      return { date: s.date, type: s.type, qa: s.qaScore || null,
        note: said ? String(said).trim().slice(0, 280) : '' };
    });
  return { status: 200, body: { cb, theme, agent: row.name,
    rating: row.score != null ? Math.round(row.score * 100) : null,
    qa: row.qa != null ? Math.round(row.qa * 1000) / 10 : null,
    pctT: row.pctT != null ? Math.round(row.pctT * 1000) / 10 : null,
    sessions } };
}

export async function failSet(env, DB, user, digest, body) {
  const auth = authorise(user, digest);
  if (auth.error) return { status: auth.status, body: { error: auth.error } };
  const deny = tlOnly(auth); if (deny) return deny;
  const cb = normCb(body.cb), theme = String(body.theme || '').slice(0, 80).replace(/[\[\]]/g, '');
  if (!cb || !theme) return { status: 400, body: { error: 'cb and theme are required.' } };
  if (auth.scope !== 'all' && !auth.codes.has(cb)) return { status: 403, body: { error: 'That agent is not on your team.' } };
  const p = await failPipeline(env);
  if (!p || !p.stages.length) return { status: 503, body: { error: 'The Coaching Fails pipeline could not be reached.' } };
  /* a PROVIDED stage id must be valid — a stale page clicking a dead id used to
     fall back to stage 0, silently REOPENING a resolved fail. No id = flag-it,
     which genuinely means the first stage. */
  let stage;
  if (String(body.stageId || '')) {
    stage = p.stages.find((s) => s.id === String(body.stageId));
    if (!stage) return { status: 400, body: { error: 'That stage no longer exists — refresh the page and try again.' } };
  } else stage = p.stages[0];
  const row = (auth.rows || []).find((a) => a.code === cb) || {};
  const name = row.name || cb;
  const __sr = await searchAll(env, p.id);
  if (__sr.truncated) return { status: 409, body: { error: 'Too many records to check safely (' + __sr.total + ') — archive old records in HighLevel first.' } };
  const j = { opportunities: __sr.ops };
  const hit = (j.opportunities || []).map((o) => parseFail(o, p.stages)).filter(Boolean)
    .find((f) => f.cb === cb && f.theme === theme);
  const last = stage.id === p.stages[p.stages.length - 1].id;
  let id;
  if (hit) {
    id = hit.id;
    await hl(env, '/opportunities/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify({
      pipelineStageId: stage.id, status: last ? 'won' : 'open' }) });
  } else {
    const contactId = await contactFor(env, DB, cb, name);
    const made = await hl(env, '/opportunities/', { method: 'POST', body: JSON.stringify({
      locationId: env.HL_HELP_LOCATION_ID, pipelineId: p.id, pipelineStageId: stage.id,
      name: '[FAIL:' + theme + '] ' + cb + ' ' + name, status: last ? 'won' : 'open', contactId }) });
    id = (made.opportunity && made.opportunity.id) || '';
    /* the evidence, on the record — why this was flagged, at the moment it was */
    const ev = { shown: Number(body.shown) || null, lastRaised: String(body.last || '').slice(0, 10) };
    await hl(env, '/contacts/' + contactId + '/notes', { method: 'POST', body: JSON.stringify({
      body: 'Coaching fail ' + id + '\nTheme: ' + theme + (isComplianceTheme(theme) ? ' (COMPLIANCE)' : '')
        + '\nAgent: ' + name + ' (' + cb + ')'
        + (ev.shown ? '\nRaised ' + ev.shown + ' time(s) in the last 90 days' + (ev.lastRaised ? ', last on ' + ev.lastRaised : '') : '')
        + '\nFlagged by ' + (user.full_name || user.username || 'team leader') }) });
  }
  const si = p.stages.findIndex((s) => s.id === stage.id);
  return { status: 200, body: { ok: true, id, stageId: stage.id, stageIdx: si, stage: stage.name, closed: last } };
}

/* ---- COACHING HUB BACKUP (Nick, 2026-08-26: "the coaching hub cases can we store
   them in highlevel as well in a pipeline, just so we can have their data as well").
   Every Hub session in the 90-day window is mirrored as ONE opportunity per session
   (deduped on the Hub's own id in the name) in the "Coaching Sessions" pipeline,
   status won — it is a record, not an open deal — with the session's substance
   (product, date, QA, what was written) in the contact's note. Batched 25 a call so
   a first backlog never trips HighLevel's rate limits; the button says what remains. */
const SESS_PIPE = 'Coaching Sessions';

async function sessPipeline(env) {
  const c = globalThis.__sessPipe;
  if (c && Date.now() - c.t < 300000 && c.p) return c.p;
  const j = await hl(env, '/opportunities/pipelines?locationId=' + env.HL_HELP_LOCATION_ID);
  let p = (j.pipelines || []).find((x) => x.name === SESS_PIPE) || null;
  if (!p) {
    const made = await hl(env, '/opportunities/pipelines', { method: 'POST', body: JSON.stringify({
      locationId: env.HL_HELP_LOCATION_ID, name: SESS_PIPE,
      stages: [{ name: 'Recorded', position: 0 }, { name: 'Reviewed', position: 1 }] }) });
    p = made.pipeline || null;
  }
  if (p) p.stages = (p.stages || []).slice().sort((a, b) => a.position - b.position);
  globalThis.__sessPipe = { t: Date.now(), p };
  return p;
}

export async function syncCoaching(env, DB, user, digest, body) {
  const auth = authorise(user, digest);
  if (auth.error) return { status: auth.status, body: { error: auth.error } };
  const deny = tlOnly(auth); if (deny) return deny;
  const p = await sessPipeline(env);
  if (!p || !p.stages.length) return { status: 503, body: { error: 'The Coaching Sessions pipeline could not be reached.' } };
  const co = await coachingFor(env, DB, auth.rows || [], { withSessions: true });
  const sessions = [];
  for (const m of (co && co.agents) || []) for (const s of m.sessions || []) if (s.id) sessions.push({ m, s });
  /* what is already backed up — paginate DEEP (10 pages): this pipeline holds every
     team's sessions and only grows; a short scan would re-create old records forever */
  const scan = await searchAll(env, p.id, 10);
  /* a TRUNCATED dedupe scan must never drive creation — it would re-create
     records beyond the horizon forever. Say so instead. */
  if (scan.truncated && body && body.apply)
    return { status: 409, body: { error: 'The Coaching Sessions pipeline has more records than one scan can check ('
      + scan.total + ') — backup is paused to avoid duplicates. Archive old records in HighLevel to resume.' } };
  const have = new Set();
  for (const o of scan.ops) {
    const mm = String(o.name || '').match(/^\[HUB:([^\]]+)\]/); if (mm) have.add(mm[1]);
  }
  const missing = sessions.filter((x) => !have.has(String(x.s.id)));
  let created = 0;
  if (body && body.apply) {
    /* batch of TEN, with a shared contact memo. This Worker has hit Cloudflare's
       50-subrequest cap before (coaching.mjs documents it); 25 sessions × 2-5
       calls each blew straight through it and every backup click 502'd after
       partial progress (review, 2026-08-26). Ten fits the budget with headroom. */
    /* SUBREQUEST BUDGET, COUNTED — not assumed (audit, 2026-08-27; recounted by the
       adversarial review). contactFor now reports its ACTUAL calls through `stats`
       (memo hit 0 · DB hit 1 · legacy 3 · fresh create 4), and each loop item adds its
       own two writes. The scan + pipeline + digest reads spend ~15 before this loop, so
       stopping at 30 in-loop keeps the whole invocation under Cloudflare's 50 with
       headroom — a full batch of ten runs when contacts exist (10×3=30), and a fresh
       team stops earlier instead of 502ing mid-batch. Progress stays partial-but-real:
       the [HUB:id] dedupe makes the next click resume where this one stopped. */
    const memo = {};
    const stats = { n: 0 };
    let spent = 0;
    for (const x of missing.slice(0, 10)) {
      if (spent >= 30) break;
      const cb = x.m.code, name = x.m.name || cb;
      const before = stats.n;
      const contactId = await contactFor(env, DB, cb, name, memo, stats);
      spent += (stats.n - before) + 2;   // contactFor's real calls + opportunity create + note create below
      const made = await hl(env, '/opportunities/', { method: 'POST', body: JSON.stringify({
        locationId: env.HL_HELP_LOCATION_ID, pipelineId: p.id, pipelineStageId: p.stages[0].id,
        name: ('[HUB:' + x.s.id + '] ' + cb + ' ' + (x.s.type || 'Coaching') + ' · ' + (x.s.date || '')).slice(0, 140),
        status: 'won', contactId }) });
      if (!made || !made.opportunity) break;   // HL refused — stop, and do NOT count it as created
      const said = ['developmentAreas', 'teamLeaderComments', 'coachingDetails', 'wayForward', 'supportProvided', 'agentFeedback']
        .map((k) => x.s[k]).filter((v) => v && String(v).trim());
      await hl(env, '/contacts/' + contactId + '/notes', { method: 'POST', body: JSON.stringify({
        body: 'Coaching session ' + x.s.id + '\n' + (x.s.type || '') + ' · ' + (x.s.date || '')
          + (x.s.qaScore ? ' · QA ' + x.s.qaScore + '%' : '')
          + '\nAgent: ' + name + ' (' + cb + ')'
          + (x.s.hubTeamLeader ? '\nCoach: ' + x.s.hubTeamLeader : '')
          + (said.length ? '\n\n' + said.map((t) => String(t).trim().slice(0, 600)).join('\n---\n').slice(0, 2400) : '') }) });
      created++;
    }
  }
  /* backed is THIS CALLER'S scope: their sessions minus their still-missing ones —
     have.size spans every team and once rendered "100 of 80 backed up" */
  return { status: 200, body: { ok: true, total: sessions.length,
    backed: Math.max(0, sessions.length - missing.length + created),
    remaining: Math.max(0, missing.length - created), created, stale: !!(co && co.stale),
    truncated: !!scan.truncated } };
}

export async function helpStage(env, DB, user, digest, body) {
  const auth = authorise(user, digest);
  if (auth.error) return { status: auth.status, body: { error: auth.error } };
  const deny = tlOnly(auth); if (deny) return deny;
  const p = await pipeline(env);
  if (!p) return { status: 503, body: { error: 'Pipeline missing.' } };
  const id = String(body.id || ''), stage = p.stages.find((s) => s.id === String(body.stageId || ''));
  if (!id || !stage) return { status: 400, body: { error: 'id and a valid stageId are required.' } };
  const cur = await hl(env, '/opportunities/' + encodeURIComponent(id));
  const __opp = cur.opportunity || cur;
  if (String(__opp.pipelineId || '') !== p.id) return { status: 404, body: { error: 'That is not a request in this pipeline.' } };
  const row = parseRow(__opp, p.stages, {});
  if (auth.scope !== 'all' && !auth.codes.has(row.cb)) return { status: 403, body: { error: 'That request is not from your team.' } };
  const last = stage.id === p.stages[p.stages.length - 1].id;
  await hl(env, '/opportunities/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify({
    pipelineStageId: stage.id, status: last ? 'won' : 'open' }) });
  return { status: 200, body: { ok: true, stage: stage.name, closed: last } };
}
