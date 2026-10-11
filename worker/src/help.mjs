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

/* ONE CARD PER AGENT, WHEN THE LOCATION SAYS SO (Nick, 2026-09-28: "the ask for help was not
   working … if you ask for the second time"). With "Allow Duplicate Opportunity" off, HighLevel
   answers a second card for the same contact in the same pipeline with 400 OPPORTUNITY_NO_DUPLICATE
   — whatever the first card's status — so every agent who had EVER asked got a 502 on every later
   ask. The fresh card is still tried first (duplicates on = every ask its own card, the design
   above); on that refusal the agent's own card is reused: an OPEN card takes the new ask (renamed
   to the new topic, back to the first stage, both notes readable); a CLOSED card is ARCHIVED first
   (kv:help-arch:<id>:<stamp>, so the team leader's record and close-time average keep counting it)
   and then reopened for the new ask. kv:help-card:<id> dates the card by its latest ask (so it
   sorts to the top of the queue) and marks where a reopened card's own round of notes begins. */
const CARD = 'kv:help-card:';
const ARCH = 'kv:help-arch:';
const isNoDup = (e) => !!e && e.status === 400
  && /NO_DUPLICATE|duplicate opportunity/i.test(String((e.body && (e.body.code + ' ' + e.body.message)) || e.message || ''));
/* an archived request's id is <cardId>:<stamp>; HighLevel ids never carry a colon */
const isArchivedId = (id) => String(id).includes(':');

/* ONE RECORD SHAPE for Nick's six steps (sprint 2026-09-29, items 4 + 5):
   {cb, asked_at, round_from, asks, reopens, acknowledged_at, acknowledged_by, completed_at,
    agent_confirmed_at, closed_at}. EVERY ask writes it — a brand-new card too, or the team leader's
   icon never sees a first ask — and every ask RESETS the workflow stamps, or a repeat ask on a card the
   leader has already seen would hide behind the old "seen" (architect review, 2026-09-29). */
const RESET = { acknowledged_at: null, acknowledged_by: null, completed_at: null, agent_confirmed_at: null, closed_at: null };
/* "Waiting on agent" is the stage BEFORE the last (Closed), whatever HighLevel names it — and only when
   there is a stage between New and it. ONE helper for parseRow, helpStage and helpConfirm: a pipeline
   of 2–3 stages must never put "Not yet" on the waiting stage, or close it (review, 2026-09-29). */
const awaitIdx = (stages) => (stages.length >= 3 ? stages.length - 2 : -1);
async function stampCard(DB, id, cb, patch) {
  const cur = (await cardOne(DB, id)) || {};
  const next = { ...cur, cb: cur.cb || cb, ...(typeof patch === 'function' ? patch(cur) : patch) };
  await cardWrite(DB, id, next);
  return next;
}

async function cardOne(DB, id) {
  const rows = await DB.select('rules?key=eq.' + encodeURIComponent(CARD + id) + '&select=value');
  return (rows && rows[0] && rows[0].value) || null;
}
async function cardWrite(DB, id, v) {
  if (v) await DB.insert('rules', [{ key: CARD + id, value: v, updated_by: 'help-center', updated_at: new Date().toISOString() }], true);
  else await DB.del('rules?key=eq.' + encodeURIComponent(CARD + id));
}
/* every card record + every archived request, two selects. FAILS CLOSED like assist.mjs's
   mirrors(): a missing archive would quietly shrink a team leader's record. */
async function helpMeta(DB) {
  const [cards, arch] = await Promise.all([
    DB.select('rules?key=like.' + encodeURIComponent(CARD + '*') + '&select=key,value'),
    DB.select('rules?key=like.' + encodeURIComponent(ARCH + '*') + '&select=key,value')]);
  const byId = {};
  for (const r of cards || []) byId[r.key.slice(CARD.length)] = r.value || {};
  const archived = (arch || []).map((r) => ({ ...(r.value || {}), id: r.key.slice(ARCH.length) })).filter((a) => a.cb);
  return { cards: byId, archived };
}
function archivedRow(a, stages, byCb) {
  const last = stages.length ? stages[stages.length - 1] : { id: '', name: 'Closed' };
  return { id: a.id, cb: a.cb, agent: (byCb[a.cb] && byCb[a.cb].name) || a.agent || a.cb,
    category: a.category || 'Something else', contactId: a.contactId || '',
    stageId: last.id, stage: last.name, stageIdx: stages.length - 1, closed: true, archived: true,
    created: a.created || '', updated: a.closed_at || '' };
}

async function reuseCard(env, DB, p, contactId, cb, oppName, now) {
  const sr = await searchAll(env, p.id);
  const mine = sr.ops.filter((o) => String(o.contactId || (o.contact && o.contact.id) || '') === String(contactId))
    .map((o) => ({ o, r: parseRow(o, p.stages, {}) }))
    .sort((x, y) => String(y.o.updatedAt || '').localeCompare(String(x.o.updatedAt || '')));
  /* HighLevel refused because a card exists, but its search has not caught up with it yet */
  if (!mine.length) return sr.truncated
    ? { status: 503, body: { error: 'The Help Center has too many records to find your earlier request — ask your team leader to archive old ones in HighLevel.' } }
    : { status: 409, body: { error: 'Your earlier request is still being filed — wait a few seconds and send this again.' } };
  const hit = mine.find((x) => !x.r.closed) || mine[0];
  const id = hit.o.id;
  const old = await cardOne(DB, id);
  let archKey = null, next;
  if (!hit.r.closed) next = { ...(old || {}), ...RESET, cb: hit.r.cb || cb, asked_at: now, asks: ((old && old.asks) || 1) + 1 };
  else {
    archKey = ARCH + id + ':' + now.replace(/[^0-9]/g, '').slice(0, 14);
    await DB.insert('rules', [{ key: archKey, value: { cb: hit.r.cb || cb, agent: hit.r.agent, category: hit.r.category,
      contactId, created: (old && old.asked_at) || hit.r.created, closed_at: hit.o.lastStatusChangeAt || hit.o.updatedAt || '',
      archived_at: now }, updated_by: 'help-center', updated_at: now }], true);
    next = { ...RESET, cb: hit.r.cb || cb, asked_at: now, round_from: now, asks: 1, reopens: 0 };
  }
  /* the records first, the card last — a failed move puts both records back exactly as they were */
  try {
    await cardWrite(DB, id, next);
    await hl(env, '/opportunities/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify({
      name: oppName, pipelineStageId: p.stages[0].id, status: 'open' }) });
  } catch (e) {
    await cardWrite(DB, id, old).catch(() => {});
    if (archKey) await DB.del('rules?key=eq.' + encodeURIComponent(archKey)).catch(() => {});
    throw e;
  }
  return archKey ? { id, reopened: true } : { id, merged: true };
}

/* THE USAGE REPORT (Spec Kit 028): `track` (optional, from index.mjs) records every ask that got past validation —
   its topic, the agent's note, their team leader and campaign as the published digest names them, and whether it
   reached the Help Center. A failed ask (HighLevel down, the note refused) is recorded delivered:false, never lost.
   Its key, hl-help:<card>:<Asked: time>, is exactly what tools/usage-backfill.mjs reads back from the note. */
export async function helpRequest(env, DB, user, digest, body, track) {
  if (user.role !== 'agent') return { status: 403, body: { error: 'Requests come from agents.' } };
  const auth = authorise(user, digest);
  if (auth.error) return { status: auth.status, body: { error: auth.error } };
  const cb = normCb(user.cb);
  const cat = HELP_CATEGORIES.includes(String(body.category)) ? String(body.category) : 'Something else';
  const note = String(body.note || '').trim().slice(0, 2000);
  if (!note) return { status: 400, body: { error: 'Say a little about what you need — the note is what your team leader reads.' } };
  const me = (auth.rows && auth.rows[0]) || {};
  const name = user.full_name || user.username || cb;
  const now = new Date().toISOString();
  const said = (delivered, extra, key) => {
    if (typeof track !== 'function') return;
    try { track({ event: 'help_ask', app: 'agent', at: now, category: cat, team_leader: me.tl || null, campaign: me.campaign || null,
      source_key: key || null, detail: { note, cb, agent_name: name, delivered, ...extra } }); } catch (e) { /* never in the way */ }
  };
  let r;
  try { r = await sendAsk(env, DB, cb, cat, note, me, name, now); }
  catch (e) { said(false, { error: String(e && e.message || e).slice(0, 300) }); throw e; }
  const b = r.body || {}, ok = r.status === 200;
  said(ok, { opp_id: b.id || null, merged: b.merged || undefined, reopened: b.reopened || undefined, note_failed: b.note_failed || undefined,
    notify_failed: b.notify_failed || undefined, error: ok ? undefined : b.error }, ok && b.id ? 'hl-help:' + b.id + ':' + now : null);
  return r;
}

async function sendAsk(env, DB, cb, cat, note, me, name, now) {
  const p = await pipeline(env);
  if (!p || !p.stages.length) return { status: 503, body: { error: 'The Help Center pipeline is missing in HighLevel — ask an admin to create "' + PIPE_NAME + '".' } };
  const contactId = await contactFor(env, DB, cb, name);
  const oppName = '[' + cat + '] ' + cb + ' ' + name;
  let oppId = '', merged = false, reopened = false, notifyFailed = false;
  try {
    const opp = await hl(env, '/opportunities/', { method: 'POST', body: JSON.stringify({
      locationId: env.HL_HELP_LOCATION_ID, pipelineId: p.id, pipelineStageId: p.stages[0].id,
      name: oppName, status: 'open', contactId }) });
    oppId = (opp.opportunity && opp.opportunity.id) || '';
    /* the record the team leader's icon reads — a failed write must not undo a request that
       landed (it still shows in the Help Center); it is reported in the answer instead */
    try { await cardWrite(DB, oppId, { ...RESET, cb, asked_at: now, round_from: now, asks: 1, reopens: 0 }); }
    catch (e) { notifyFailed = true; }
  } catch (e) {
    if (!isNoDup(e)) throw e;
    const r = await reuseCard(env, DB, p, contactId, cb, oppName, now);
    if (r.status) return r;
    oppId = r.id; merged = !!r.merged; reopened = !!r.reopened;
  }
  /* line 2 "Asked: <iso>" dates this ask — helpDetail uses it to show a reopened card's own round */
  try {
    await hl(env, '/contacts/' + contactId + '/notes', { method: 'POST', body: JSON.stringify({
      body: 'Help request ' + oppId + '\nAsked: ' + now + '\nTopic: ' + cat + '\nFrom: ' + name + ' (' + cb + ')'
        + (me.campaign ? ' · ' + me.campaign : '') + (me.tl ? ' · Team ' + me.tl : '') + '\n\n' + note }) });
  } catch (e) {
    /* THE CARD IS ALREADY ON THE BOARD, THE NOTE IS NOT (review, 2026-09-28). The note IS the request
       — answering ok would lose the agent's words silently (assist.mjs can flag note_failed because its
       record holds the text; this one has nowhere else to keep it). So say exactly what happened: the
       modal keeps the text, and Send again joins the same card and lands the note. */
    return { status: 502, body: { error: 'Your request reached your team leader\'s Help Center, but your note did not save — press Send again; it joins the same request.',
      id: oppId, note_failed: true } };
  }
  return { status: 200, body: { ok: true, id: oppId, merged, reopened, ...(notifyFailed ? { notify_failed: true } : {}) } };
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
  const [__sr, meta] = await Promise.all([searchAll(env, p.id), helpMeta(DB)]);
  const ops = await withUnindexed(env, p, __sr.ops, meta.cards, (c) => c === cb);
  const rows = ops.map((o) => parseRow(o, p.stages, {}, meta.cards[o.id]))
    .concat(meta.archived.map((a) => archivedRow(a, p.stages, {})))
    .filter((r) => r.cb === cb)
    .sort((a, b) => String(b.created).localeCompare(String(a.created)));
  return { status: 200, body: { stages: p.stages.map((s) => ({ id: s.id, name: s.name })), requests: rows, truncated: __sr.truncated, total: __sr.total } };
}
export async function helpCloseOwn(env, DB, user, digest, body, track) {
  if (user.role !== 'agent') return { status: 403, body: { error: 'Only the agent who asked can close their own request here.' } };
  const auth = authorise(user, digest);
  if (auth.error) return { status: auth.status, body: { error: auth.error } };
  const cb = normCb(user.cb);
  const id = String(body.id || '');
  if (!id) return { status: 400, body: { error: 'id required.' } };
  if (isArchivedId(id)) return { status: 404, body: { error: 'That request is already closed.' } };
  const p = await pipeline(env);
  if (!p || !p.stages.length) return { status: 503, body: { error: 'Pipeline missing.' } };
  const cur = await hl(env, '/opportunities/' + encodeURIComponent(id));
  const __opp = cur.opportunity || cur;
  if (String(__opp.pipelineId || '') !== p.id) return { status: 404, body: { error: 'That is not a request in this pipeline.' } };
  const row = parseRow(__opp, p.stages, {});
  if (row.cb !== cb) return { status: 403, body: { error: 'That request is not yours.' } };
  await hl(env, '/opportunities/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify({
    pipelineStageId: p.stages[p.stages.length - 1].id, status: 'won' }) });
  let stampFailed = false;
  try { await stampCard(DB, id, cb, { closed_at: new Date().toISOString() }); } catch (e) { stampFailed = true; }
  stageSaid(track, { category: p.stages[p.stages.length - 1].name, team_leader: auth.team || null,
    campaign: (auth.rows && auth.rows[0] && auth.rows[0].campaign) || null, detail: { opp_id: id, closed: true, by: 'agent', action: 'close' } });
  return { status: 200, body: { ok: true, ...(stampFailed ? { stamp_failed: true } : {}) } };
}

/* THE AGENT CONFIRMS (Nick's step 6, 2026-09-29): "Yes, I was helped" closes the request and records
   it; "Not yet" hands it back to the team leader — back to the second stage, the icon lit again, one
   more reopen on the record. Only the agent who asked; never on a closed or archived request. */
export async function helpConfirm(env, DB, user, digest, body, track) {
  if (user.role !== 'agent') return { status: 403, body: { error: 'Only the agent who asked confirms whether it was sorted.' } };
  const auth = authorise(user, digest);
  if (auth.error) return { status: auth.status, body: { error: auth.error } };
  const cb = normCb(user.cb);
  const id = String((body && body.id) || '');
  if (!id) return { status: 400, body: { error: 'id required.' } };
  if (isArchivedId(id)) return { status: 404, body: { error: 'That request is already closed.' } };
  const p = await pipeline(env);
  if (!p || !p.stages.length) return { status: 503, body: { error: 'Pipeline missing.' } };
  const cur = await hl(env, '/opportunities/' + encodeURIComponent(id));
  const opp = cur.opportunity || cur;
  if (String(opp.pipelineId || '') !== p.id) return { status: 404, body: { error: 'That is not a request in this pipeline.' } };
  const row = parseRow(opp, p.stages, {});
  if (row.cb !== cb) return { status: 403, body: { error: 'That request is not yours.' } };
  if (row.closed || String(opp.status || '') === 'lost') return { status: 409, body: { error: 'That request is already closed.' } };
  const now = new Date().toISOString();
  const helped = !!(body && body.helped === true);
  /* "Not yet" answers the leader's "done" — before that it would only relight the icon and inflate the
     reopen count (security review, 2026-09-29) */
  if (!helped && !row.awaitingAgent) return { status: 409, body: { error: 'Your team leader has not marked this done yet — it is still with them.' } };
  const to = helped ? p.stages[p.stages.length - 1] : p.stages[Math.max(0, awaitIdx(p.stages) - 1)];
  await hl(env, '/opportunities/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify({
    pipelineStageId: to.id, status: helped ? 'won' : 'open' }) });
  let stampFailed = false;
  try {
    await stampCard(DB, id, cb, helped ? { agent_confirmed_at: now, closed_at: now }
      : (c) => ({ completed_at: null, acknowledged_at: null, acknowledged_by: null, reopens: (c.reopens || 0) + 1 }));
  } catch (e) { stampFailed = true; }
  stageSaid(track, { category: to.name, team_leader: auth.team || null, campaign: (auth.rows && auth.rows[0] && auth.rows[0].campaign) || null,
    detail: { opp_id: id, closed: helped, by: 'agent', action: helped ? 'confirm' : 'not_yet' } });
  return { status: 200, body: { ok: true, closed: helped, stage: to.name, ...(stampFailed ? { stamp_failed: true } : {}) } };
}

/* THE TEAM LEADER'S ICON (D5, 2026-09-29): how many requests from their own team nobody has opened
   yet. One prefix read of the card records, scoped by the same authorise() as the list — never a
   HighLevel call (free-plan budget), never a stored team name (goes stale for movers). */
export async function helpPulse(env, DB, user, digest) {
  const auth = authorise(user, digest);
  if (auth.error) return { status: auth.status, body: { error: auth.error } };
  const deny = tlOnly(auth); if (deny) return deny;
  /* only records still open — the closed ones never count and are the ones that pile up */
  const rows = await DB.select('rules?key=like.' + encodeURIComponent(CARD + '*') + '&value->>closed_at=is.null&select=key,value');
  const open = [];
  for (const r of rows || []) {
    const v = r.value || {}, c = normCb(v.cb || '');
    if (!c || (auth.scope !== 'all' && !auth.codes.has(c))) continue;
    if (!v.asked_at || v.acknowledged_at || v.closed_at) continue;
    open.push({ id: r.key.slice(CARD.length), v, cb: c });
  }
  /* SELF-HEALING (review, 2026-09-29): a request closed or deleted straight in HighLevel would light
     the icon for ever if the leader never opened the list. Each pulse checks the OLDEST unread card not
     checked in the last 5 minutes — at most one HighLevel call per pulse — and drops it if it is gone. */
  const now = new Date().toISOString(), stale = new Date(Date.now() - 5 * 60000).toISOString();
  const due = open.filter((x) => !x.v.checked_at || String(x.v.checked_at) < stale)
    .sort((a, b) => String(a.v.asked_at).localeCompare(String(b.v.asked_at)))[0];
  if (due) {
    try {
      let gone = false;
      try {
        const j = await hl(env, '/opportunities/' + encodeURIComponent(due.id));
        const o = j.opportunity || j, p = await pipeline(env);
        const si = p ? p.stages.findIndex((s) => s.id === o.pipelineStageId) : -1;
        gone = o.status === 'won' || o.status === 'lost' || (p && si === p.stages.length - 1);
      } catch (e) { if (e && e.status === 404) gone = true; else throw e; }
      await stampCard(DB, due.id, due.cb, (cur) => (cur.closed_at || cur.acknowledged_at || cur.asked_at !== due.v.asked_at ? {}
        : gone ? { closed_at: now } : { checked_at: now }));
      if (gone) open.splice(open.indexOf(due), 1);
    } catch (e) { /* HighLevel unreachable — count what the records say; the next pulse checks again */ }
  }
  const latest = open.reduce((m, x) => (String(x.v.asked_at) > m ? String(x.v.asked_at) : m), '');
  return { status: 200, body: { unread: open.length, latest } };
}

/* A request asked seconds ago may not be in HighLevel's search index yet (it lags writes) — the icon
   would light and the list would not show it. Cards asked in the last 15 minutes that the search did
   not return are fetched by id, at most 5; one still unreachable simply shows on the next load. */
async function withUnindexed(env, p, ops, cards, inScope) {
  const seen = new Set(ops.map((o) => o.id));
  const recent = Object.entries(cards || {}).filter(([id, c]) => !seen.has(id) && c && c.cb && !c.closed_at && c.asked_at
    && Date.now() - Date.parse(c.asked_at) < 15 * 60000 && inScope(normCb(c.cb))).slice(0, 5);
  const extra = [];
  for (const [id] of recent) {
    try {
      const j = await hl(env, '/opportunities/' + encodeURIComponent(id));
      const o = j.opportunity || j;
      if (String(o.pipelineId || '') === p.id) extra.push(o);
    } catch (e) { /* not reachable yet — the next load asks again */ }
  }
  return ops.concat(extra);
}

/* `card` (optional) is the kv:help-card record: a reused card is dated by its latest ask, and carries
   the workflow stamps the agent and the team leader see (seen by, done, confirmed) */
function parseRow(o, stages, byCb, card) {
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
  const closed = (stages.length && si === stages.length - 1) || o.status === 'won';
  const c = card || {};
  return { id: o.id, cb,
    agent: (byCb[cb] && byCb[cb].name) || (m && m[3] ? m[3] : '') || cb,
    category: m ? m[1] : 'Something else',
    contactId: o.contactId || (o.contact && o.contact.id) || '',
    stageId: o.pipelineStageId, stage: si >= 0 ? stages[si].name : '?', stageIdx: si,
    closed,
    created: c.asked_at || o.createdAt || o.dateAdded || '', updated: o.updatedAt || '',
    /* the workflow as the two people see it: who opened it, and whether it now waits on the agent
       (the second-to-last stage — "Waiting on agent" — whatever HighLevel names it) */
    seenAt: c.acknowledged_at || null, seenBy: c.acknowledged_by || null,
    awaitingAgent: !closed && si >= 0 && si === awaitIdx(stages),
    confirmedAt: c.agent_confirmed_at || null, reopens: c.reopens || 0 };
}

/* a card moved (Spec Kit 028): the usage report's help_stage — which stage, by whom; help_answer_times reads ask → first
   move by anyone but the agent */
const stageSaid = (track, ev) => {
  if (typeof track !== 'function') return;
  try { track({ event: 'help_stage', app: 'agent', ...ev }); } catch (e) { /* never in the way */ }
};

const tlOnly = (auth) => (auth.scope !== 'team' && auth.scope !== 'all')
  ? { status: 403, body: { error: 'The Help Center is for team leaders.' } } : null;

export async function helpList(env, DB, user, digest) {
  const auth = authorise(user, digest);
  if (auth.error) return { status: auth.status, body: { error: auth.error } };
  const deny = tlOnly(auth); if (deny) return deny;
  const p = await pipeline(env);
  if (!p) return { status: 200, body: { setup: 'Create a pipeline named "' + PIPE_NAME + '" in HighLevel and requests will land here.', stages: [], requests: [] } };
  const [__sr, meta] = await Promise.all([searchAll(env, p.id), helpMeta(DB)]);
  const byCb = {}; for (const a of auth.rows || []) byCb[a.code] = a;
  const inScope = (c) => auth.scope === 'all' || auth.codes.has(c);
  const ops = await withUnindexed(env, p, __sr.ops, meta.cards, inScope);
  /* A card closed straight in HighLevel (the leader used the CRM, not this page) must stop lighting the
     icon: opening the list is when we see it, so the record is closed here — at most 10 per load. */
  let fixes = 0;
  for (const o of ops) {
    const c = meta.cards[o.id];
    if (!c || c.closed_at || fixes >= 5) continue;
    const r = parseRow(o, p.stages, {}, c);
    if (!r.closed || !inScope(r.cb)) continue;
    /* HighLevel's search lags writes: a row that still shows a card closed BEFORE the latest ask is a
       stale copy, not a close — writing it would hide a fresh ask from the icon (review, 2026-09-29) */
    const closedAt = o.lastStatusChangeAt || o.updatedAt || '';
    if (c.asked_at && (!closedAt || String(closedAt) < String(c.asked_at))) continue;
    fixes++;
    await stampCard(DB, o.id, r.cb, (cur) => (cur.closed_at || cur.asked_at !== c.asked_at ? {} : { closed_at: closedAt }))
      .catch(() => { /* the pulse's own HighLevel check closes it next */ });
  }
  const rows = ops.map((o) => parseRow(o, p.stages, byCb, meta.cards[o.id]))
    .concat(meta.archived.map((a) => archivedRow(a, p.stages, byCb)))
    .filter((r) => auth.scope === 'all' || auth.codes.has(r.cb))
    .sort((a, b) => String(b.created).localeCompare(String(a.created)));
  return { status: 200, body: { stages: p.stages.map((s) => ({ id: s.id, name: s.name })), requests: rows, truncated: __sr.truncated, total: __sr.total } };
}

export async function helpDetail(env, DB, user, digest, id) {
  const auth = authorise(user, digest);
  if (auth.error) return { status: auth.status, body: { error: auth.error } };
  const deny = tlOnly(auth); if (deny) return deny;
  if (!id) return { status: 400, body: { error: 'id required.' } };
  if (isArchivedId(id)) return { status: 404, body: { error: 'That request was closed and its card has since been reused — its note stays on the contact in HighLevel.' } };
  const p = await pipeline(env);
  /* No known pipeline → refuse. The old `p && …` guard SKIPPED the pipeline check when
     the lookup returned null, letting a TL fetch any opportunity in the location whose
     parsed CB landed on their team (audit, 2026-08-27). */
  if (!p) return { status: 503, body: { error: 'The Help Center pipeline is not reachable right now — try again shortly.' } };
  const j = await hl(env, '/opportunities/' + encodeURIComponent(id));
  const __oppD = j.opportunity || j;
  if (String(__oppD.pipelineId || '') !== p.id) return { status: 404, body: { error: 'That is not a request in this pipeline.' } };
  let card = await cardOne(DB, id);
  const row = parseRow(__oppD, (p && p.stages) || [], {}, card);
  if (auth.scope !== 'all' && !auth.codes.has(row.cb)) return { status: 403, body: { error: 'That request is not from your team.' } };
  /* NICK'S STEP 4 — THE TEAM LEADER ACKNOWLEDGES by opening the request: "seen" is stamped with who and
     when, the agent sees it, and the icon clears. Only the agent's OWN leader (scope 'team'); an admin or
     exec previewing the queue must not mark it seen for them. */
  let ackFailed = false;
  if (auth.scope === 'team' && !row.closed && !(card && card.acknowledged_at)) {
    try {
      /* stamp only the ask this leader is looking at — if the agent asked again in the meantime, that
         newer ask stays unread (review, 2026-09-29) */
      const opened = (card && card.asked_at) || null;
      card = await stampCard(DB, id, row.cb, (cur) => ((cur.asked_at || null) !== opened ? {}
        : { acknowledged_at: new Date().toISOString(), acknowledged_by: user.full_name || user.username || '' }));
      row.seenAt = card.acknowledged_at || null; row.seenBy = card.acknowledged_by || null;
    } catch (e) { ackFailed = true; }
  }
  let note = '';
  try {
    const n = await hl(env, '/contacts/' + row.contactId + '/notes');
    /* the EXACT prefix helpRequest writes — never a substring match (a later note's
       free text could contain this id) and never a blind fallback to the newest
       note, which belongs to a different request (review, 2026-08-26).
       A REUSED card carries every ask made on it (2026-09-28): all of this round's notes,
       newest first. A reopened card's round starts at card.round_from — the closed request's
       notes before it (including pre-2026-09-28 ones with no "Asked:" line) stay out. */
    const askedOf = (b) => { const l = String(b).split(String.fromCharCode(10))[1] || ''; return l.startsWith('Asked: ') ? l.slice(7) : ''; };
    const from = (card && card.round_from) || '';
    note = (n.notes || [])
      .filter((x) => String(x.body || '').startsWith('Help request ' + id + String.fromCharCode(10)))
      .filter((x) => !from || askedOf(x.body) >= from)
      .sort((a, b) => String(askedOf(b.body) || b.dateAdded || '').localeCompare(String(askedOf(a.body) || a.dateAdded || '')))
      .map((x) => String(x.body || '')).join('\n\n— — —\n\n');
  } catch {}
  return { status: 200, body: { ...row, note, ...(ackFailed ? { ack_failed: true } : {}) } };
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
   QA score, and what the coach wrote), plus the agent's current standing. The written
   note is withheld from a TEAM LEADER (spec 004: a submitted coaching document is
   never shown to one), so for them each session is its date, product and QA score. */
export async function failDetail(env, DB, user, digest, q) {
  const auth = authorise(user, digest);
  if (auth.error) return { status: auth.status, body: { error: auth.error } };
  const deny = tlOnly(auth); if (deny) return deny;
  const cb = normCb(q.cb), theme = String(q.theme || '');
  if (!cb || !theme) return { status: 400, body: { error: 'cb and theme are required.' } };
  if (auth.scope !== 'all' && !auth.codes.has(cb)) return { status: 403, body: { error: 'That agent is not on your team.' } };
  const row = (auth.rows || []).find((a) => a.code === cb) || { code: cb, name: cb };
  /* A team leader is listed the sessions but never reads a submitted coaching document (spec 004, 2026-10-05):
     coachingFor withholds the written content for them, so every `note` below is empty for a team leader. */
  const co = await coachingFor(env, DB, [row], { withSessions: true, leader: user.role === 'team_leader' });
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

export async function helpStage(env, DB, user, digest, body, track) {
  const auth = authorise(user, digest);
  if (auth.error) return { status: auth.status, body: { error: auth.error } };
  const deny = tlOnly(auth); if (deny) return deny;
  const p = await pipeline(env);
  if (!p) return { status: 503, body: { error: 'Pipeline missing.' } };
  const id = String(body.id || ''), stage = p.stages.find((s) => s.id === String(body.stageId || ''));
  if (!id || !stage) return { status: 400, body: { error: 'id and a valid stageId are required.' } };
  if (isArchivedId(id)) return { status: 404, body: { error: 'That request is already closed.' } };
  const cur = await hl(env, '/opportunities/' + encodeURIComponent(id));
  const __opp = cur.opportunity || cur;
  if (String(__opp.pipelineId || '') !== p.id) return { status: 404, body: { error: 'That is not a request in this pipeline.' } };
  const row = parseRow(__opp, p.stages, {});
  if (auth.scope !== 'all' && !auth.codes.has(row.cb)) return { status: 403, body: { error: 'That request is not from your team.' } };
  const last = stage.id === p.stages[p.stages.length - 1].id;
  await hl(env, '/opportunities/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify({
    pipelineStageId: stage.id, status: last ? 'won' : 'open' }) });
  /* NICK'S STEP 5 — ACTION COMPLETED: the second-to-last stage ("Waiting on agent") stamps completed_at
     and puts the confirm buttons in front of the agent; moving back clears it; the last stage closes.
     A move by the agent's own leader also counts as having seen it (step 4). */
  const si = p.stages.findIndex((s) => s.id === stage.id), now = new Date().toISOString();
  let stampFailed = false;
  try {
    await stampCard(DB, id, row.cb, (c) => ({
      closed_at: last ? now : null,
      completed_at: last ? (c.completed_at || null) : (si === awaitIdx(p.stages) ? now : null),
      ...(auth.scope === 'team' && !c.acknowledged_at ? { acknowledged_at: now, acknowledged_by: user.full_name || user.username || '' } : {}),
    }));
  } catch (e) { stampFailed = true; }
  stageSaid(track, { category: stage.name, team_leader: auth.scope === 'team' ? (auth.team || null) : null,
    detail: { opp_id: id, closed: last, by: auth.scope === 'team' ? 'team_leader' : user.role, action: 'move' } });
  return { status: 200, body: { ok: true, stage: stage.name, closed: last, ...(stampFailed ? { stamp_failed: true } : {}) } };
}
