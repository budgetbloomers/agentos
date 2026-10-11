#!/usr/bin/env node
/**
 * usage-backfill.mjs — fill the usage report with what happened before it existed (Spec Kit 028, 2026-10-11).
 *
 * Nick (decision 3): "Backfill what exists: sign-ins from auth_log, every campaign-manager request, AI questions, and past
 * help asks read back (read-only) from the HighLevel Help pipeline. App opens start at release."
 *
 *   node tools/usage-backfill.mjs            DRY RUN (the default): reads every source, prints per source × event how
 *                                            many rows WOULD be added, writes nothing
 *   node tools/usage-backfill.mjs --apply    adds them (usage_events must exist: supabase/migration-061 first)
 *   --sources=auth_log,ask_log,cm,hl_help    limit to some sources
 *
 * SOURCES AND KEYS — every row carries a deterministic source_key, the SAME key the live Worker writes for the same
 * event, and goes in with ON CONFLICT (source_key) DO NOTHING. So it can be re-run any time (a second run adds 0) and
 * running it after release never double-counts what the Worker already recorded.
 *   auth_log  → the database does it: rpc usage_mirror_auth_log (migration-061), the SAME function the trigger uses,
 *               so the report reproduces auth_log exactly (SC-003). Key auth_log:<id>.
 *   ask_log   → ai_question, key ask_log:<id> (the Worker keys live questions the same way).
 *   cm        → kv:cm-areq:<card> and kv:cm-areq-arch:<card>:<stamp> mirror rows: one cm_request (cm-req:<card>:<requested_at
 *               digits>) and one cm_action per history line (cm-hist:<card>:<line time>). Never any request text.
 *   hl_help   → the HighLevel "Agent Help Center" pipeline, READ-ONLY GETs: every card's contact notes that start
 *               "Help request <card>" are the asks (topic, the agent, campaign · Team <TL>, the note) — key
 *               hl-help:<card>:<Asked: time> (older notes without the Asked: line: hl-help:<card>:note:<noteId>); each
 *               card past its first stage gives one stage reading (hl-help-stage:<card>:<lastStageChangeAt>, by:'backfill' — it
 *               shows where the card stands, never who answered) — only for cards with NO live help_stage rows, since
 *               the Worker's own stage rows carry no key and a reading would count a move twice.
 *               Needs the HELP location's key, which lives only as a Worker secret: put HL_HELP_API_KEY and
 *               HL_HELP_LOCATION_ID in help-highlevel.env (git-ignored) or the environment. Without it this source is
 *               skipped and the run says so.
 *   THE TL'S WORDS (Spec Kit 029, FR-002/FR-005): with the same key, the "Campaign Assistance" pipeline (same location,
 *               READ-ONLY GETs) is read once. Its card notes ("Assist <card>" + "Request raised · <label> · P<n>" + the
 *               words; "Duplicate request merged into this one" + the words) give each request its words:
 *               · cm     — a mirror-derived request gets the note nearest its own time (within 2 min); a row ALREADY in
 *                          usage_events without words gets them once through rpc usage_attach_cm_text (migration-062);
 *               · hl_cm  — a raise / restricted / merged note no mirror round explains is a request of its own
 *                          (hl-cm:<card>:<note id>); on a card with NO mirror row at all its action notes ("Acknowledged by
 *                          X", "Assistance started by X", ...) come back as cm_action rows too, so the report can say who
 *                          handled it. A restricted request never had words; none are invented.
 *
 * Secrets are read from supabase.env / help-highlevel.env and never printed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CM_BLOCKAGES_DEFAULTS } from '../worker/src/campaign.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HL = 'https://services.leadconnectorhq.com';
const PIPE_NAME = 'Agent Help Center';
const PAGE = 1000;
const CHUNK = 200;
const HL_MAX_PAGES = 20;
const AUTH_WINDOW = 5000;
const SOURCES = ['auth_log', 'ask_log', 'cm', 'hl_help', 'hl_cm'];
const CM_PIPE = 'Campaign Assistance';
const NOTE_WINDOW_MS = 120000;
const MISSING_TABLE = 'usage_events does not exist yet — apply supabase/migration-061-usage-events.sql first (the dry run still sized every source)';

/* ---------- pure mappers (exported: verify-usage-028 proves they reproduce the live Worker's keys) ---------- */
const normCb = (c) => { const m = /(\d+)/.exec(String(c || '')); return m ? 'CB' + parseInt(m[1], 10) : ''; };
const digits14 = (iso) => String(iso || '').replace(/[^0-9]/g, '').slice(0, 14);
const who = (u) => (u ? { user_id: u.id || null, username: u.username || null, role: u.role || null } : {});

/* a CM history line → the action the Worker recorded when it wrote that line (worker/src/assist.mjs hist() calls) */
const CM_LINES = [[/^raised\b/, 'raise'], [/^duplicate merged/, 'merged'], [/^acknowledged/, 'acknowledge'], [/^classified/, 'classify'],
  [/^priority\b/, 'priority'], [/^assigned\b/, 'assign'], [/^session booked/, 'book'], [/^assistance started/, 'start'],
  [/^evidence added/, 'evidence'], [/^session completed/, 'complete'], [/^disputed by team leader/, 'confirm_tl'],
  [/^team leader confirmed/, 'confirm_tl'], [/^agent confirmation recorded/, 'confirm_agent'], [/^follow-up read/, 'followup'],
  [/^escalated/, 'escalate'], [/^reopened/, 'reopen']];
export function cmActionOf(what) {
  const w = String(what || '').trim();
  for (const [re, a] of CM_LINES) if (re.test(w)) return a;
  return 'other';
}

/** one CM mirror row (kv:cm-areq:<card> or kv:cm-areq-arch:<card>:<stamp>) → its usage events */
export function cmMirrorToEvents(key, m, users) {
  const U = users || {}; const v = m || {};
  const arch = String(key).startsWith('kv:cm-areq-arch:');
  const opp = arch ? ((v.card && v.card.id) || String(key).slice('kv:cm-areq-arch:'.length).split(':')[0]) : String(key).slice('kv:cm-areq:'.length);
  if (!opp) return [];
  const reqAt = v.requested_at || (v.card && v.card.created) || null;
  const base = { app: 'agent', team_leader: v.tl || null, campaign: v.campaign || null, source: 'backfill' };
  const tlUser = (U.byCb || {})[normCb(v.cb)] || null;
  const out = [];
  if (reqAt) out.push({ ...base, ...who(tlUser), event: 'cm_request', at: reqAt, category: v.blockage || null,
    source_key: 'cm-req:' + opp + ':' + digits14(reqAt),
    detail: { opp_id: opp, priority: v.priority || null, restricted: !!v.restricted, affected: v.affected == null ? null : v.affected, delivered: true } });
  const hist = Array.isArray(v.history) ? v.history : [];
  let started = false;
  hist.forEach((h, i) => {
    const act = cmActionOf(h && h.what);
    if (!h || !h.at || act === 'raise') return;
    if (act === 'start') started = true;
    const last = i === hist.length - 1;
    const actor = (U.byName || {})[String(h.actor || '').trim()] || null;
    const key2 = 'cm-hist:' + opp + ':' + h.at;
    if (act === 'merged') out.push({ ...base, ...who(actor), event: 'cm_request', at: h.at, category: v.blockage || null, source_key: key2,
      detail: { opp_id: opp, priority: v.priority || null, restricted: !!v.restricted, affected: v.affected == null ? null : v.affected, merged: true } });
    else out.push({ ...base, ...who(actor), event: 'cm_action', at: h.at, category: act, source_key: key2,
      detail: { opp_id: opp, actor: h.actor || null, started: last ? !!v.assistance_started_at : started, resolved: last ? v.resolution_mins != null : false,
        disputed: /^disputed/.test(String(h.what)) || undefined } });
  });
  return out;
}

/** one HighLevel contact note → the help_ask it records, or null when it is not an ask on this card */
export function helpNoteToEvent(note, opp, users) {
  const U = users || {};
  const body = String((note && note.body) || '').replace(/\r\n/g, '\n');
  const m = /^Help request (\S+)\n/.exec(body + '\n');
  if (!m || !opp || m[1] !== opp.id) return null;
  const cut = body.indexOf('\n\n');
  const header = (cut < 0 ? body : body.slice(0, cut)).split('\n').slice(1);
  const text = cut < 0 ? '' : body.slice(cut + 2);
  let asked = null, topic = null, name = null, cb = null, campaign = null, tl = null;
  for (const line of header) {
    if (line.startsWith('Asked: ')) asked = line.slice(7).trim();
    else if (line.startsWith('Topic: ')) topic = line.slice(7).trim();
    else if (line.startsWith('From: ')) {
      const f = /^From:\s*(.*?)\s*\((CB[-\s]?\d+)\)(.*)$/i.exec(line);
      if (!f) continue;
      name = f[1] || null; cb = normCb(f[2]);
      for (const part of f[3].split('·').map((x) => x.trim()).filter(Boolean)) {
        if (/^Team\s+/i.test(part)) tl = part.replace(/^Team\s+/i, '');
        else if (!campaign) campaign = part;
      }
    }
  }
  if (asked && isNaN(Date.parse(asked))) asked = null;
  if (!topic) { const t = /^\[([^\]]+)\]/.exec(String(opp.name || '')); topic = t ? t[1] : 'Something else'; }
  const u = (U.byCb || {})[cb] || null;
  return { event: 'help_ask', app: 'agent', at: asked || note.dateAdded || null, category: topic, team_leader: tl, campaign,
    ...(u ? who(u) : { username: cb ? cb.toLowerCase() : null, role: cb ? 'agent' : null }),
    source: 'backfill', source_key: asked ? 'hl-help:' + opp.id + ':' + asked : 'hl-help:' + opp.id + ':note:' + note.id,
    detail: { note: text, delivered: true, opp_id: opp.id, cb: cb || null, agent_name: name } };
}

/** a Help card past its first stage → one reading of where it stands (HighLevel keeps no stage history) */
export function helpStageReading(opp, stages) {
  const si = stages.findIndex((s) => s.id === opp.pipelineStageId);
  if (si <= 0 && opp.status !== 'won') return null;
  const at = opp.lastStageChangeAt || opp.lastStatusChangeAt || opp.updatedAt;
  if (!at) return null;
  const closed = si === stages.length - 1 || opp.status === 'won';
  return { event: 'help_stage', app: 'agent', at, category: si >= 0 ? stages[si].name : null, source: 'backfill',
    source_key: 'hl-help-stage:' + opp.id + ':' + at, detail: { opp_id: opp.id, closed, by: 'backfill', action: 'backfill' } };
}

export function askLogToEvent(r, users) {
  const u = ((users || {}).byUsername || {})[r.asked_by] || null;
  const role = u ? u.role : null;
  return { event: 'ai_question', at: r.created_at || null, ...(u ? who(u) : { username: r.asked_by || null }),
    app: role === 'agent' || role === 'team_leader' ? 'agent' : null,     // only Agent Analytics' Nikola serves them
    source: 'backfill', source_key: 'ask_log:' + r.id, detail: { question: r.question || null, model: r.model || null, ask_id: r.id } };
}

/* ---------- the Campaign Assistance notes (Spec Kit 029) ---------- */
/* the title lines assist.mjs writes (note() / say()) → the action it recorded */
const CM_NOTE_ACTIONS = [[/^Acknowledged by (.+)$/, 'acknowledge'], [/^Classified as /, 'classify'], [/^Priority set to /, 'priority'],
  [/^Assigned to /, 'assign'], [/^Session booked/, 'book'], [/^Assistance started by (.+)$/, 'start'], [/^Evidence$/, 'evidence'],
  [/^Session completed/, 'complete'], [/^Team leader disputed/, 'confirm_tl'], [/^Team leader confirmed/, 'confirm_tl'],
  [/^Agent confirmed/, 'confirm_agent'], [/^48-hour follow-up/, 'followup'], [/^Outcome declined/, 'followup'], [/^Escalated/, 'escalate'], [/^Reopened/, 'reopen']];

/** one Campaign Assistance note on card `cardId` → what it records, or null when it is not about that card */
export function parseCmNote(note, cardId) {
  const body = String((note && note.body) || '').replace(/\r\n/g, '\n');
  const headLine = 'Assist ' + cardId + '\n';
  if (!cardId || !body.startsWith(headLine)) return null;
  const rest = body.slice(headLine.length);
  const cut = rest.indexOf('\n\n');
  const title = (cut < 0 ? rest : rest.slice(0, cut)).trim();
  const words = cut < 0 ? '' : rest.slice(cut + 2).trim();
  const base = { id: note.id || null, at: note.dateAdded || null, title };
  let m = /^Request raised · (.+?) · (P[1-4])(?: · (\d+) agents? affected)?$/.exec(title);
  if (m) {
    const i = words.indexOf('\n\nBusiness impact: ');
    return { ...base, kind: 'raise', label: m[1], priority: m[2], affected: m[3] ? Number(m[3]) : null,
      text: (i < 0 ? words : words.slice(0, i)).trim() || null, impact: i < 0 ? null : words.slice(i + 19).trim() || null };
  }
  if (/^Restricted — personal matter/.test(title)) return { ...base, kind: 'restricted' };
  if (/^Duplicate request merged into this one/.test(title)) return { ...base, kind: 'merged', text: words || null };
  for (const [re, action] of CM_NOTE_ACTIONS) {
    m = re.exec(title);
    if (m) return { ...base, kind: 'action', action, actor: action === 'acknowledge' || action === 'start' ? m[1].trim() : null };
  }
  return { ...base, kind: 'other' };
}

/* the card name assist.mjs writes: [blockage] CBnn Team Leader Name · Campaign */
const cmCardOf = (o) => {
  const m = String((o && o.name) || '').match(/^\[([^\]]+)\]\s+(CB\d+)\s+(.*?)\s+·\s+(.*)$/i);
  return m ? { blockage: m[1], cb: normCb(m[2]), tl: m[3], campaign: m[4] } : { blockage: null, cb: '', tl: null, campaign: null };
};

/** a Campaign Assistance note (raise / restricted / merged / action) → a usage event of its own, keyed hl-cm:<card>:<note> */
export function cmNoteToEvent(n, opp, ctx) {
  const c = ctx || {}; const U = c.users || {}; const card = cmCardOf(opp);
  const tlUser = (U.byCb || {})[card.cb] || null;
  const base = { app: 'agent', at: n.at, team_leader: card.tl, campaign: card.campaign, source: 'backfill', source_key: 'hl-cm:' + opp.id + ':' + n.id };
  const restrictedKey = ((c.blockages || []).find((b) => b && b.restricted) || {}).key || 'personal';
  if (n.kind === 'raise' || n.kind === 'restricted' || n.kind === 'merged') {
    const restricted = n.kind === 'restricted' || (n.kind === 'merged' && !!(c.last && c.last.restricted));
    const byLabel = n.kind === 'raise' ? (c.blockages || []).find((b) => b && b.label === n.label) : null;
    const category = n.kind === 'restricted' ? restrictedKey
      : n.kind === 'merged' ? ((c.last && (c.last.restricted ? restrictedKey : c.last.category)) || card.blockage)
      : (byLabel ? byLabel.key : card.blockage);
    return { ...base, ...who(tlUser), event: 'cm_request', category,
      detail: { opp_id: opp.id, priority: n.priority || (c.last && c.last.priority) || null, restricted, affected: n.affected == null ? null : n.affected, delivered: true,
        merged: n.kind === 'merged' || undefined, text: restricted ? undefined : (n.text || undefined), impact: restricted ? undefined : (n.impact || undefined) } };
  }
  if (n.kind === 'action') {
    const actor = n.actor ? (U.byName || {})[n.actor] || null : null;
    return { ...base, ...who(actor), event: 'cm_action', category: n.action,
      detail: { opp_id: opp.id, actor: n.actor || null, started: n.action === 'start', resolved: false } };
  }
  return null;
}

/** the note nearest `at` (within 2 minutes either side) of the given kinds, not yet used */
function nearestNote(notes, at, kinds, used) {
  const t = Date.parse(at); if (isNaN(t)) return null;
  let best = null;
  for (const n of notes) {
    if (!kinds.includes(n.kind) || used.has(n.id)) continue;
    const d = Math.abs(Date.parse(n.at) - t);
    if (d <= NOTE_WINDOW_MS && (!best || d < best.d)) best = { n, d };
  }
  return best ? best.n : null;
}

/* ---------- I/O ---------- */
function rest(url, key) {
  const H = { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };
  const call = async (method, p, body, prefer) => {
    const r = await fetch(url.replace(/\/$/, '') + '/rest/v1/' + p, { method, headers: { ...H, ...(prefer ? { Prefer: prefer } : {}) },
      body: body == null ? undefined : JSON.stringify(body) });
    const t = await r.text();
    if (!r.ok) { const e = new Error(method + ' ' + p.split('?')[0] + ' → ' + r.status + ': ' + t.slice(0, 200)); e.status = r.status; throw e; }
    return t ? JSON.parse(t) : null;
  };
  const all = async (p) => {
    const out = [];
    for (let off = 0; ; off += PAGE) { const rows = (await call('GET', p + '&limit=' + PAGE + '&offset=' + off)) || []; out.push(...rows); if (rows.length < PAGE) break; }
    return out;
  };
  return { call, all };
}

async function hlGet(hl, p) {
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(HL + p, { method: 'GET', headers: { Authorization: 'Bearer ' + hl.key, Version: '2021-07-28', Accept: 'application/json' }, signal: ctl.signal });
    const t = await r.text();
    if (!r.ok) throw new Error('HighLevel GET ' + p.split('?')[0] + ' → ' + r.status);
    return t ? JSON.parse(t) : {};
  } finally { clearTimeout(timer); }
}

function usersIndex(rows) {
  const byCb = {}, byName = {}, byUsername = {};
  for (const u of rows || []) {
    if (u.username) byUsername[u.username] = u;
    if (u.cb && !byCb[normCb(u.cb)]) byCb[normCb(u.cb)] = u;
    if (u.full_name && !byName[String(u.full_name).trim()]) byName[String(u.full_name).trim()] = u;
  }
  return { byCb, byName, byUsername };
}

async function existingKeys(db, prefixes, notes) {
  const keys = new Set();
  try {
    for (const p of prefixes)
      for (const r of await db.all('usage_events?select=source_key&source_key=like.' + encodeURIComponent(p) + '*&order=id.asc')) keys.add(r.source_key);
    return { keys, table: true };
  } catch (e) {
    if (e.status === 404) { notes.push(MISSING_TABLE); return { keys, table: false }; }
    throw e;
  }
}

const tally = (events, keys) => {
  const seen = new Set(), fresh = [], byEvent = {};
  for (const e of events) {
    if (!e || !e.source_key || !e.at || keys.has(e.source_key) || seen.has(e.source_key)) continue;   // undated: skipped, never given a made-up time
    seen.add(e.source_key); fresh.push(e); byEvent[e.event] = (byEvent[e.event] || 0) + 1;
  }
  return { fresh, byEvent };
};

const ROW_KEYS = ['at', 'user_id', 'username', 'role', 'app', 'event', 'category', 'team_leader', 'campaign', 'detail', 'source', 'source_key'];
async function insertAll(db, events) {
  let n = 0;
  for (let i = 0; i < events.length; i += CHUNK) {
    const rows = events.slice(i, i + CHUNK).map((e) => Object.fromEntries(ROW_KEYS.map((k) => [k, k === 'detail'
      ? JSON.parse(JSON.stringify(e.detail || {})) : (e[k] === undefined ? null : e[k])])));
    const got = await db.call('POST', 'usage_events?on_conflict=source_key&select=id', rows, 'resolution=ignore-duplicates,return=representation');
    n += (got || []).length;
  }
  return n;
}

async function readHelpPipeline(hl, log, name = PIPE_NAME, optional = false) {
  const pj = await hlGet(hl, '/opportunities/pipelines?locationId=' + encodeURIComponent(hl.location));
  const p = (pj.pipelines || []).find((x) => x.name === name);
  if (!p && optional) return null;
  if (!p) throw new Error('the "' + name + '" pipeline was not found in the Help location');
  const stages = (p.stages || []).slice().sort((a, b) => a.position - b.position);
  const opps = []; let total = null;
  for (let pg = 1; pg <= HL_MAX_PAGES; pg++) {
    const j = await hlGet(hl, '/opportunities/search?location_id=' + encodeURIComponent(hl.location) + '&pipeline_id=' + encodeURIComponent(p.id) + '&limit=100&page=' + pg + '&order=added_desc');
    const ops = j.opportunities || []; if (j.meta && j.meta.total != null) total = Number(j.meta.total);
    opps.push(...ops); if (ops.length < 100) break;
  }
  const truncated = total != null && opps.length < total;
  const contacts = [...new Set(opps.map((o) => String(o.contactId || (o.contact && o.contact.id) || '')).filter(Boolean))];
  const notesBy = {};
  for (const c of contacts) { notesBy[c] = ((await hlGet(hl, '/contacts/' + encodeURIComponent(c) + '/notes')).notes) || []; }
  log('  HighLevel "' + name + '": ' + opps.length + ' cards' + (truncated ? ' (TRUNCATED at ' + opps.length + ' of ' + total + ')' : '') + ', ' + contacts.length + ' contacts');
  return { stages, opps, notesBy, truncated, total };
}

/**
 * runBackfill({ supabaseUrl, serviceKey, hl: {key, location} | null, apply, sources, log })
 *   → { sources: { <name>: { read, toInsert, byEvent, inserted? } }, skipped: [..], notes: [..] }
 */
export async function runBackfill(opts) {
  const o = opts || {}; const log = o.log || ((s) => console.log(s));
  const want = new Set(o.sources && o.sources.length ? o.sources : SOURCES);
  const db = rest(o.supabaseUrl, o.serviceKey);
  const out = { sources: {}, skipped: [], notes: [] };
  const users = usersIndex(await db.all('app_users?select=id,username,role,cb,full_name&order=username.asc'));
  const ex = await existingKeys(db, ['auth_log:', 'ask_log:', 'cm-req:', 'cm-hist:', 'hl-help', 'hl-cm:'], out.notes);
  if (o.apply && !ex.table) throw new Error(MISSING_TABLE);

  if (want.has('auth_log')) {
    const rows = await db.all('auth_log?select=id,event&order=id.asc');
    const missing = rows.filter((r) => !ex.keys.has('auth_log:' + r.id));
    const byEvent = {}; for (const r of missing) byEvent[r.event] = (byEvent[r.event] || 0) + 1;
    const s = { read: rows.length, toInsert: missing.length, byEvent };
    if (o.apply) {
      const maxId = rows.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0);
      /* id windows: one bad row fails only its window's statement, and no statement scans the whole log */
      s.inserted = 0;
      for (let lo = 0; lo <= maxId; lo += AUTH_WINDOW)
        s.inserted += Number(await db.call('POST', 'rpc/usage_mirror_auth_log', { p_min_id: lo, p_max_id: Math.min(maxId, lo + AUTH_WINDOW - 1) })) || 0;
    }
    out.sources.auth_log = s;
  }
  const plain = async (name, read, toEvents) => {
    const recs = await read();
    const { fresh, byEvent } = tally(toEvents(recs), ex.keys);
    const s = { read: recs.length, toInsert: fresh.length, byEvent };
    if (o.apply) s.inserted = await insertAll(db, fresh);
    out.sources[name] = s;
  };
  if (want.has('ask_log'))
    await plain('ask_log', () => db.all('ask_log?select=id,asked_by,question,model,created_at&order=id.asc'), (rs) => rs.map((r) => askLogToEvent(r, users)));
  /* the Campaign Assistance pipeline, read ONCE for cm (the TL's words) and hl_cm (rounds no mirror explains) — 029 */
  const hasHl = !!(o.hl && o.hl.key && o.hl.location);
  let CA = null; const caNotes = {}; const usedNotes = new Set();
  if (hasHl && (want.has('cm') || want.has('hl_cm'))) {
    CA = await readHelpPipeline(o.hl, log, CM_PIPE, true);
    if (!CA) out.notes.push('the "' + CM_PIPE + '" pipeline was not found in the Help location — no CM words, no hl_cm');
    else for (const opp of CA.opps) {
      const c = String(opp.contactId || (opp.contact && opp.contact.id) || '');
      caNotes[opp.id] = (CA.notesBy[c] || []).map((n) => parseCmNote(n, opp.id)).filter(Boolean)
        .sort((a, b) => String(a.at).localeCompare(String(b.at)));
    }
  }
  let blockages = CM_BLOCKAGES_DEFAULTS;
  if (CA) {
    const br = await db.call('GET', 'rules?select=value&key=eq.' + encodeURIComponent('cm:blockages')).catch(() => null);
    if (br && br[0] && Array.isArray(br[0].value) && br[0].value.length) blockages = br[0].value;
  }
  const mirrorRecs = (await db.all('rules?select=key,value&key=like.' + encodeURIComponent('kv:cm-areq') + '*&order=key.asc')).filter((r) => /^kv:cm-areq(-arch)?:/.test(r.key));
  const mirrorEvents = mirrorRecs.flatMap((r) => cmMirrorToEvents(r.key, r.value, users));
  const mirrorCards = new Set(mirrorEvents.map((e) => String((e.detail && e.detail.opp_id) || '')).filter(Boolean));
  for (const e of mirrorEvents) {                                       // each mirror request takes the words of the note nearest it
    const opp = e.detail && e.detail.opp_id;
    if (!CA || e.event !== 'cm_request' || !opp || !caNotes[opp]) continue;
    const n = nearestNote(caNotes[opp], e.at, e.detail.merged ? ['merged'] : ['raise', 'restricted'], usedNotes);
    if (!n) continue;
    usedNotes.add(n.id);
    if (!e.detail.restricted && n.kind !== 'restricted' && n.text) { e.detail.text = n.text; if (n.impact) e.detail.impact = n.impact; }
  }
  if (want.has('cm')) {
    const { fresh, byEvent } = tally(mirrorEvents, ex.keys);
    const s = { read: mirrorRecs.length, toInsert: fresh.length, byEvent, textAttach: 0 };
    /* rows written before 029 (the live 028 backfill) have no words: attach them once */
    const attach = [];
    if (CA && ex.table) {
      const have = new Map((await db.all('usage_events?select=source_key,detail&event=eq.cm_request&order=id.asc'))
        .filter((r) => r.source_key).map((r) => [r.source_key, r.detail || {}]));
      for (const e of mirrorEvents) {
        const d = have.get(e.source_key);
        if (d && e.detail && e.detail.text && !d.text && !d.restricted) attach.push(e);
      }
    }
    s.textAttach = attach.length;
    if (o.apply) {
      s.inserted = await insertAll(db, fresh);
      s.textAttached = 0;
      for (const e of attach)
        if (await db.call('POST', 'rpc/usage_attach_cm_text', { p_source_key: e.source_key, p_text: e.detail.text, p_impact: e.detail.impact || null })) s.textAttached++;
    }
    out.sources.cm = s;
  }
  if (want.has('hl_cm')) {
    if (!hasHl) out.skipped.push('hl_cm — no HL_HELP_API_KEY / HL_HELP_LOCATION_ID (put them in help-highlevel.env to include past campaign-manager requests from the "' + CM_PIPE + '" pipeline)');
    else if (CA) {
      const events = [];
      for (const opp of CA.opps) {
        const mirrored = mirrorCards.has(String(opp.id));
        let last = null;
        for (const n of caNotes[opp.id] || []) {
          if (n.kind === 'raise' || n.kind === 'restricted') last = { restricted: n.kind === 'restricted', priority: n.priority || null,
            category: n.kind === 'restricted' ? null : (((blockages || []).find((b) => b && b.label === n.label) || {}).key || cmCardOf(opp).blockage) };
          if (usedNotes.has(n.id)) continue;
          if (mirrored && n.kind === 'action') continue;               // a mirrored card's actions come from its mirror history
          const e = cmNoteToEvent(n, opp, { users, blockages, last });
          if (e) events.push(e);
        }
      }
      const { fresh, byEvent } = tally(events, ex.keys);
      const s = { read: CA.opps.length, toInsert: fresh.length, byEvent };
      if (o.apply) s.inserted = await insertAll(db, fresh);
      out.sources.hl_cm = s;
      if (CA.truncated) out.notes.push('the "' + CM_PIPE + '" scan stopped at ' + CA.opps.length + ' of ' + CA.total + ' cards');
    } else out.skipped.push('hl_cm — the "' + CM_PIPE + '" pipeline was not found in the Help location');
  }
  if (want.has('hl_help')) {
    if (!o.hl || !o.hl.key || !o.hl.location) out.skipped.push('hl_help — no HL_HELP_API_KEY / HL_HELP_LOCATION_ID (the Help location key is a Worker secret; put it in help-highlevel.env to include past help asks)');
    else {
      let H = null;
      /* cards the Worker already tracks live: their stage rows exist (unkeyed), so no backfilled reading for them */
      const liveStaged = new Set();
      if (ex.table) for (const r of await db.all('usage_events?select=detail&event=eq.help_stage&source=eq.worker&order=id.asc'))
        if (r.detail && r.detail.opp_id) liveStaged.add(String(r.detail.opp_id));
      await plain('hl_help', async () => { H = await readHelpPipeline(o.hl, log); return H.opps; }, (opps) => {
        const evs = [];
        for (const opp of opps) {
          const c = String(opp.contactId || (opp.contact && opp.contact.id) || '');
          for (const n of H.notesBy[c] || []) { const e = helpNoteToEvent(n, opp, users); if (e) evs.push(e); }
          const st = liveStaged.has(String(opp.id)) ? null : helpStageReading(opp, H.stages); if (st) evs.push(st);
        }
        return evs;
      });
      if (H && H.truncated) out.notes.push('the Help pipeline scan stopped at ' + H.opps.length + ' of ' + H.total + ' cards (' + HL_MAX_PAGES + ' pages)');
    }
  }
  return out;
}

/* ---------- CLI ---------- */
function readEnvFile(f) {
  if (!fs.existsSync(f)) return {};
  return Object.fromEntries(fs.readFileSync(f, 'utf8').split(/\r?\n/).filter((l) => /^\s*[A-Z_][A-Z0-9_]*\s*=/.test(l))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }));
}
async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const src = (args.find((a) => a.startsWith('--sources=')) || '').slice(10).split(',').map((s) => s.trim()).filter(Boolean);
  const bad = src.filter((s) => !SOURCES.includes(s));
  if (bad.length) { console.error('unknown source(s): ' + bad.join(', ') + ' — choose from ' + SOURCES.join(', ')); process.exit(2); }
  const sb = readEnvFile(path.join(ROOT, 'supabase.env'));
  const he = { ...readEnvFile(path.join(ROOT, 'help-highlevel.env')), ...process.env };
  if (!sb.SUPABASE_URL || !sb.SUPABASE_SECRET_KEY) { console.error('supabase.env with SUPABASE_URL and SUPABASE_SECRET_KEY is required'); process.exit(2); }
  console.log((apply ? 'APPLY' : 'DRY RUN (nothing is written — add --apply to write)') + ' · usage backfill · ' + new Date().toISOString());
  const r = await runBackfill({ supabaseUrl: sb.SUPABASE_URL, serviceKey: sb.SUPABASE_SECRET_KEY, apply, sources: src,
    hl: he.HL_HELP_API_KEY && he.HL_HELP_LOCATION_ID ? { key: he.HL_HELP_API_KEY, location: he.HL_HELP_LOCATION_ID } : null });
  for (const [name, s] of Object.entries(r.sources)) {
    console.log('\n' + name + ': read ' + s.read + ' · to insert ' + s.toInsert + (apply ? ' · inserted ' + s.inserted : '')
      + (s.textAttach != null ? ' · words to attach to existing rows ' + s.textAttach + (apply ? ' · attached ' + s.textAttached : '') : ''));
    for (const [ev, n] of Object.entries(s.byEvent).sort((a, b) => b[1] - a[1])) console.log('    ' + String(n).padStart(6) + '  ' + ev);
  }
  for (const s of r.skipped) console.log('\nSKIPPED ' + s);
  for (const s of r.notes) console.log('\nNOTE ' + s);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((e) => { console.error('usage-backfill failed: ' + (e && e.message || e)); process.exit(1); });
