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
 *
 * Secrets are read from supabase.env / help-highlevel.env and never printed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HL = 'https://services.leadconnectorhq.com';
const PIPE_NAME = 'Agent Help Center';
const PAGE = 1000;
const CHUNK = 200;
const HL_MAX_PAGES = 20;
const AUTH_WINDOW = 5000;
const SOURCES = ['auth_log', 'ask_log', 'cm', 'hl_help'];
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

async function readHelpPipeline(hl, log) {
  const pj = await hlGet(hl, '/opportunities/pipelines?locationId=' + encodeURIComponent(hl.location));
  const p = (pj.pipelines || []).find((x) => x.name === PIPE_NAME);
  if (!p) throw new Error('the "' + PIPE_NAME + '" pipeline was not found in the Help location');
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
  log('  HighLevel: ' + opps.length + ' Help cards' + (truncated ? ' (TRUNCATED at ' + opps.length + ' of ' + total + ')' : '') + ', ' + contacts.length + ' contacts');
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
  const ex = await existingKeys(db, ['auth_log:', 'ask_log:', 'cm-req:', 'cm-hist:', 'hl-help'], out.notes);
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
  if (want.has('cm'))
    await plain('cm', async () => (await db.all('rules?select=key,value&key=like.' + encodeURIComponent('kv:cm-areq') + '*&order=key.asc'))
      .filter((r) => /^kv:cm-areq(-arch)?:/.test(r.key)), (rs) => rs.flatMap((r) => cmMirrorToEvents(r.key, r.value, users)));
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
    console.log('\n' + name + ': read ' + s.read + ' · to insert ' + s.toInsert + (apply ? ' · inserted ' + s.inserted : ''));
    for (const [ev, n] of Object.entries(s.byEvent).sort((a, b) => b[1] - a[1])) console.log('    ' + String(n).padStart(6) + '  ' + ev);
  }
  for (const s of r.skipped) console.log('\nSKIPPED ' + s);
  for (const s of r.notes) console.log('\nNOTE ' + s);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((e) => { console.error('usage-backfill failed: ' + (e && e.message || e)); process.exit(1); });
