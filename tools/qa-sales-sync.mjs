#!/usr/bin/env node
/* QA SALES SYNC — sales per agent per day, from AgentOS into the QA tool (spec 039, 2026-10-28).
 *
 *   node tools/qa-sales-sync.mjs --dry                 # what would be sent — runs the engine, writes nothing
 *   node tools/qa-sales-sync.mjs                       # send the days that changed (last 120 days)
 *   node tools/qa-sales-sync.mjs --days 365            # a wider backfill
 *   node tools/qa-sales-sync.mjs --from 2026-09-25 --to 2026-10-26
 *
 * WHY (Nick, 28 Oct): "I need the sale volumes per person … brought into the QA tool … how many sales were made
 * vs the QA evaluations … an SLA %", for Jared only. The QA tool (budgetbloomers/qa-ops) is a SEPARATE Supabase
 * project, so sales are SENT to it: one row per agent per day in its agent_sales_daily (its 08_agent_sales_daily.sql).
 *
 * WHERE THE NUMBERS COME FROM — THE ENGINE, NOT THE LAKE. The lake's bi_active_cases is missing whole days (on 28 Oct it
 * held nothing for 20–25 Oct), and the VAS sales rule is not a COUNT(DISTINCT): an uncased row is a feature line, a
 * cancelled case leaves the count, owners resolve to agents through the roster's aliases. So the deployed VAS engine is
 * booted headless (tools/digest-republish.mjs --qa-sales) and its own books are read:
 *   sales_net   cases created that day still active — what VAS counts (25 Sep – 26 Oct: Cuddle 5,153 · Courtesy 4,472 ·
 *               Training Gr 17 62, equal to VAS to the case)
 *   sales_made  sales_net + the cases created that day that later cancelled (Nick, D1: show both)
 *   campaign    the campaign the engine counted that day under (VT: the Agent List segment in force that day)
 * VT is on the roster, so it comes through too. Owners on no roster (Panimax partners) are counted and printed.
 *
 * ONLY THE DAYS THAT MOVED are sent (the lake-load delta pattern): the QA side's (cb, day) values are compared with
 * the engine's and only differing rows are upserted; a (cb, day) the engine no longer has is zeroed, never left stale.
 *
 * CREDENTIALS: the engine boots from supabase.env as digest-republish always does; the QA tool is reached with a
 * git-ignored qa-ops.env — QA_SUPABASE_URL and QA_SUPABASE_SERVICE_KEY — on the machine that runs the tick, nowhere
 * else. Without qa-ops.env a real run FAILS (live since 29 Oct — it used to be a green SKIPPED); --dry needs only the engine.
 *
 * GUARDS (ecc silent-failure review, 29 Oct): zeroing covers only days the engine holds and agent-days it could map; a run
 * that would zero more than MAX_ZERO_SHARE of the QA tool's agent-days (an engine booted on an empty state) is refused
 * unless --force-zero; an unknown campaign holds just its own agent-days and fails the run AFTER the rest are sent; what
 * was not sent (owners on no Agent List, cancelled cases with no agent) ends the final line, which the tick keeps.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REQUEST_MS = 60e3;   // one PostgREST call; the tick's own step timeout is far above it

/** AgentOS campaign → the QA tool's campaign key (qa-ops src/lib/data/constants.ts). Unknown = loud failure. */
export const CAMPAIGN_KEY = { Cuddle: 'matrix_cuddle', Courtesy: 'matrix_courtesy', VT: 'matrix_tracker', Nesting: 'sales_lab', 'Download & Test': 'upsell' };   // the live QA tool's merged "Downloads, Test & Upsell" key
export function campaignKey(c) {
  const s = String(c || '').trim();
  if (CAMPAIGN_KEY[s]) return CAMPAIGN_KEY[s];
  if (/^training\b/i.test(s)) return 'sales_lab';   // "Training Gr 17" — the nest, Nesting's successor
  return null;
}
/** 'CB123' / 'cb 123' / 'CB-0123' → 'CB-123' (the QA tool's format); anything without digits → null */
export const qaCb = (v) => { const m = /(\d+)/.exec(String(v || '')); return m ? 'CB-' + parseInt(m[1], 10) : null; };

/**
 * The engine's rows → the QA tool's rows. Pure.
 *   engine [{code, day, net, made, campaign, name}]
 * → { rows: [{cb, sale_date, sales_made, sales_net, campaign_key, agent_name}], unmapped: Set of campaigns }
 */
export function toQaRows(engine) {
  const unmapped = new Set(); const unmappedKeys = new Set(); const cell = new Map();
  for (const r of engine) {
    const cb = qaCb(r.code); if (!cb) continue;
    const key = campaignKey(r.campaign);
    const k = cb + '|' + r.day;
    /* named, not dropped: the run still sends every mapped agent-day, holds this one where it is, and fails at the end */
    if (!key) { unmapped.add(String(r.campaign || '(blank)')); unmappedKeys.add(k); continue; }
    const c = cell.get(k) || { cb, sale_date: r.day, sales_made: 0, sales_net: 0, campaign_key: key, agent_name: r.name || null };
    c.sales_made += Number(r.made) || 0; c.sales_net += Number(r.net) || 0;
    cell.set(k, c);
  }
  const rows = [...cell.values()].sort((a, b) => (a.sale_date + a.cb).localeCompare(b.sale_date + b.cb));
  return { rows, unmapped, unmappedKeys };
}

/** Which rows to send: new or different from what the QA tool holds; a (cb, day) only the QA side has is zeroed. Pure.
 *  Zeroing only ever covers what the engine actually looked at: never a day before its first sales day (`coveredFrom` —
 *  its history can be shorter than the window) and never a (cb, day) whose campaign had no QA key (`hold`). */
export function rowsToSend(want, have, { coveredFrom = '', hold = new Set() } = {}) {
  const key = (r) => r.cb + '|' + String(r.sale_date).slice(0, 10);
  const H = new Map(have.map((r) => [key(r), r]));
  const W = new Map(want.map((r) => [key(r), r]));
  const out = [];
  /* PostgREST can hand integers back as strings — compared as numbers, or every row looks changed every tick */
  for (const [k, r] of W) { const h = H.get(k);
    if (!h || Number(h.sales_made) !== r.sales_made || Number(h.sales_net) !== r.sales_net || h.campaign_key !== r.campaign_key || (h.agent_name || null) !== (r.agent_name || null)) out.push(r); }
  for (const [k, h] of H) {
    const day = String(h.sale_date).slice(0, 10);
    if (W.has(k) || hold.has(k) || (coveredFrom && day < coveredFrom) || !(Number(h.sales_made) || Number(h.sales_net))) continue;
    out.push({ cb: h.cb, sale_date: day, sales_made: 0, sales_net: 0, campaign_key: h.campaign_key, agent_name: h.agent_name || null });
  }
  return out;
}

/* ── OWNERS ON NO AGENT LIST (Nick, 29 Oct: "include them") ─────────────────────────────────────────────────────────
   VAS leaves an owner the Agent List does not carry out of every report (his 15 Sep rule) — but the QA tool evaluates
   them: Jeremiah Govindsamy had 39 October evaluations and showed 0 sales here. So an owner the engine cannot resolve is
   matched BY NAME to the people the QA tool itself knows (its evaluations' agent name + CB, its Add People roster), and
   sent under that CB. Jared's tab is then complete; VAS is untouched, and the tab can exceed VAS by exactly these. */

/** The engine's owner key — normName in nicks_code/index.html, kept identical so the two sides key a person the same */
export const ownerKey = (s) => String(s || '').toLowerCase().replace(/-\s*panimax/g, '').replace(/panimax/g, '')
  .replace(/cb[\s-]*\d+/g, '').replace(/[^a-z]/g, '');

/** The QA tool's renamed campaign keys → the current ones (LEGACY_CAMPAIGN_KEYS in its constants.ts) */
const LEGACY_CAMPAIGN = { cuddle_calls: 'matrix_cuddle', courtesy_calls: 'matrix_courtesy', tracker: 'matrix_tracker', downloads: 'upsell', test: 'upsell' };
/** Campaigns that only win when nothing else is there: Nesting (the training phase) and the retired VAS campaign */
const LAST_RESORT = new Set(['sales_lab', 'vas']);

/** QA's people [{name, cb, campaign, day?}] (one entry per evaluation or roster row) → Map ownerKey → {cb, campaign_key,
 *  name}. The campaign is the one QA evaluates them on most SINCE `since` (a mover takes their current one), then over
 *  all time; renamed keys read as current; Nesting and the retired VAS campaign only when nothing else is there. A name
 *  two CBs share, or a person with no campaign, is left out — never guessed. Pure. */
export function qaPeople(list, { since = '' } = {}) {
  const by = new Map();
  for (const p of list) {
    const k = ownerKey(p.name); const cb = qaCb(p.cb); if (!k || !cb) continue;
    const e = by.get(k) || { cbs: new Set(), recent: {}, all: {}, name: String(p.name).trim().replace(/\s+/g, ' ') };
    e.cbs.add(cb);
    const c = LEGACY_CAMPAIGN[p.campaign] || p.campaign;
    if (c) { e.all[c] = (e.all[c] || 0) + 1; if (since && String(p.day || '') >= since) e.recent[c] = (e.recent[c] || 0) + 1; }
    by.set(k, e);
  }
  const out = new Map();
  for (const [k, e] of by) {
    if (e.cbs.size !== 1) continue;
    const ranked = Object.keys(e.all).sort((a, b) => (e.recent[b] || 0) - (e.recent[a] || 0) || e.all[b] - e.all[a]);
    const campaign_key = ranked.find((c) => !LAST_RESORT.has(c)) || ranked.find((c) => c === 'sales_lab') || ranked[0];
    if (campaign_key && campaign_key !== 'vas') out.set(k, { cb: [...e.cbs][0], campaign_key, name: e.name });
  }
  return out;
}

/** The engine's unresolved owner-days {'owner|YYYY-MM-DD': {net, made}} → QA rows for the owners QA knows. Pure.
 *  `listed` (CB → name, the Agent List's agents in this run): a QA CB the list gives to a DIFFERENT person is a stale or
 *  reused CB on one side — those sales are never put on someone else's row; the owner is counted as a clash instead. */
export function offListRows(unresolvedDays, people, listed = new Map()) {
  const rows = []; const matched = new Set(); const unknown = new Set(); const clashes = new Set();
  for (const [key, v] of Object.entries(unresolvedDays || {})) {
    const [owner, day] = key.split('|'); const p = people.get(owner);
    if (!p) { unknown.add(owner); continue; }
    const listedName = listed.get(p.cb);
    if (listedName && ownerKey(listedName) !== owner) { clashes.add(owner); continue; }
    matched.add(owner);
    rows.push({ cb: p.cb, sale_date: day, sales_made: Number(v.made) || 0, sales_net: Number(v.net) || 0, campaign_key: p.campaign_key, agent_name: p.name });
  }
  return { rows, matched, unknown, clashes };
}

/** Two row sets → one row per (cb, day), summed; the first set's campaign and name win. Pure. */
export function mergeRows(a, b) {
  const m = new Map();
  for (const r of [...a, ...b]) {
    const k = r.cb + '|' + r.sale_date; const c = m.get(k);
    if (!c) { m.set(k, { ...r }); continue; }
    c.sales_made += r.sales_made; c.sales_net += r.sales_net;
  }
  return [...m.values()].sort((x, y) => (x.sale_date + x.cb).localeCompare(y.sale_date + y.cb));
}

/** The share of the QA tool's non-zero agent-days one run may zero. Above it the run refuses: that is an engine that
 *  booted on an empty or partial state, not a corrected upload (silent-failure review, 29 Oct). */
export const MAX_ZERO_SHARE = 0.3;
/** …and only once it is more than this many agent-days — on a tiny table one corrected day is already a third */
export const MIN_ZERO_REFUSE = 20;
/** Why this send must not go, or null. Pure. `--force-zero` is the human override. */
export function zeroingRefusal(want, have, send) {
  const live = have.filter((h) => Number(h.sales_made) || Number(h.sales_net)).length;
  if (!live) return null;
  if (!want.length) return `the engine produced no sales for a window the QA tool holds ${live} agent-day(s) for — the VAS state probably did not load`;
  const zeroed = send.filter((r) => !r.sales_made && !r.sales_net).length;
  if (zeroed > MIN_ZERO_REFUSE && zeroed / live > MAX_ZERO_SHARE)
    return `this run would zero ${zeroed} of ${live} agent-day(s) (${Math.round((zeroed / live) * 100)}% > ${MAX_ZERO_SHARE * 100}%) — check the engine's state, then re-run with --force-zero if it is right`;
  return null;
}

/** The QA tool's roster queue → its campaign key (QUEUE_CAMPAIGN in the QA tool's constants.ts) */
const QUEUE_CAMPAIGN = { 'Vehicle Tracking': 'matrix_tracker', 'Courtesy Calls': 'matrix_courtesy', 'Cuddle Calls': 'matrix_cuddle',
  Nesting: 'sales_lab', 'Motor Warranty Direct': 'motor_warranty_direct' };

/** Everyone the QA tool knows as a sales agent: each evaluation's (agent name, CB, campaign) and each Add People roster
 *  row — read-only, three fields, paged. The people in its code roster (agents.ts) all have evaluations, so they come in
 *  through the first source. */
async function readQaPeople(qa) {
  const H = { apikey: qa.QA_SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + qa.QA_SUPABASE_SERVICE_KEY };
  const base = qa.QA_SUPABASE_URL.replace(/\/+$/, '') + '/rest/v1/';
  const out = [];
  const pageAll = async (q) => {
    const rows = [];
    for (;;) {
      const r = await fetch(`${base}${q}&limit=1000&offset=${rows.length}`, { headers: H, signal: AbortSignal.timeout(REQUEST_MS) });
      if (!r.ok) throw new Error(`HTTP ${r.status} on ${q.split('?')[0]}`);
      /* until an EMPTY page — a project capping max-rows below 1000 would otherwise end the read after its first page */
      const page = await r.json(); if (!page.length) return rows; rows.push(...page);
    }
  };
  for (const e of await pageAll('evaluations?select=name:data->>salesAgentName,cb:data->>salesAgentCb,campaign:data->>campaign,day:data->>dateOfCall,qa_close_decision&order=id'))
    if (e.qa_close_decision !== 'admin_deleted') out.push({ name: e.name, cb: e.cb, campaign: e.campaign, day: String(e.day || '').slice(0, 10) });
  for (const a of await pageAll('roster_agents?select=name,cb,queue&order=cb,name')) out.push({ name: a.name, cb: a.cb, campaign: QUEUE_CAMPAIGN[a.queue] || '' });
  return out;
}

const readEnv = (f) => { const p = path.join(ROOT, f); if (!fs.existsSync(p)) return {};
  return Object.fromEntries(fs.readFileSync(p, 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l.trim()))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])); };

async function main() {
  const argv = process.argv.slice(2);
  const flag = (n) => { const i = argv.indexOf(n); return i < 0 ? null : argv[i + 1]; };
  const DRY = argv.includes('--dry');
  const sast = new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10);
  const to = flag('--to') || sast;
  const from = flag('--from') || new Date(Date.parse(to) - (Number(flag('--days')) || 120) * 864e5).toISOString().slice(0, 10);
  const DAY = /^\d{4}-\d{2}-\d{2}$/;
  if (!DAY.test(from) || !DAY.test(to) || from > to) { console.error(`FAILED: --from/--to must be YYYY-MM-DD with from ≤ to (got ${from} .. ${to})`); process.exitCode = 1; return; }
  const FORCE_ZERO = argv.includes('--force-zero');
  const qa = readEnv('qa-ops.env');
  /* LIVE since 29 Oct: a tick machine without the key is a broken sync, so it fails (and alerts) rather than going green */
  if (!DRY && (!qa.QA_SUPABASE_URL || !qa.QA_SUPABASE_SERVICE_KEY)) {
    console.error('FAILED: qa-ops.env (QA_SUPABASE_URL, QA_SUPABASE_SERVICE_KEY) is not configured on this machine — nothing sent, Jared\'s Sales vs QA tab is going stale. Run with --dry to see what would go.');
    process.exitCode = 1; return;
  }

  /* the engine's own books, via the same headless boot the digests use — written into a private temp folder (names and
     sales figures) that is removed whatever happens */
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-sales-'));
  let eng;
  try {
    const tmp = path.join(dir, 'sales.json');
    const run = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'digest-republish.mjs'), `--qa-sales=${from}..${to}`, '--out', tmp],
      { cwd: ROOT, encoding: 'utf8', timeout: 15 * 60e3, maxBuffer: 32 * 1024 * 1024 });
    if (run.status !== 0 || !fs.existsSync(tmp)) {
      /* the tail of the engine's output, with anything token-shaped blanked — it lands in the tick log */
      const tail = String(run.stderr || run.stdout || '').trim().split('\n').slice(-3).join(' | ')
        .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[token]').replace(/((?:key|secret|token|password)=)[^&\s]+/gi, '$1[redacted]').slice(0, 300);
      console.error('FAILED: the engine did not produce the sales (digest-republish --qa-sales exited ' + run.status + ') — ' + tail);
      process.exitCode = 1; return;
    }
    eng = JSON.parse(fs.readFileSync(tmp, 'utf8'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  const listed = toQaRows(eng.rows || []);
  const { unmapped, unmappedKeys } = listed;

  /* owners on no Agent List that the QA tool knows by name go in under its CB (Nick, 29 Oct) — without qa-ops.env (a
     --dry on another machine) there is nobody to match against, and they stay out as before */
  let people = new Map();
  if (qa.QA_SUPABASE_URL && qa.QA_SUPABASE_SERVICE_KEY) {
    try { people = qaPeople(await readQaPeople(qa), { since: from }); }
    catch (e) { console.error('FAILED: reading the QA tool\'s people to match owners on no Agent List — ' + (e && e.message || e)); process.exitCode = 1; return; }
  }
  /* an empty answer is not "nobody": it would zero every off-list row sent before — so with owners to match it fails */
  if (!DRY && Object.keys(eng.unresolvedDays || {}).length && !people.size) {
    console.error('FAILED: the QA tool returned no people to match owners on no Agent List against — nothing sent (a key or permission change on its side?)');
    process.exitCode = 1; return;
  }
  const listedNames = new Map(listed.rows.map((r) => [r.cb, r.agent_name || '']));
  const off = offListRows(eng.unresolvedDays, people, listedNames);
  const rows = mergeRows(listed.rows, off.rows);

  const tot = (k) => rows.reduce((t, r) => t + r[k], 0);
  const unknownDays = Object.entries(eng.unresolvedDays || {}).filter(([k]) => off.unknown.has(k.split('|')[0]));
  const unNet = unknownDays.reduce((t, [, v]) => t + (Number(v.net) || 0), 0);
  const unMade = unknownDays.reduce((t, [, v]) => t + (Number(v.made) || 0), 0);
  const unTop = Object.entries(unknownDays.reduce((m, [k, v]) => { const o = k.split('|')[0]; m[o] = (m[o] || 0) + (Number(v.made) || 0); return m; }, {}))
    .sort((a, b) => b[1] - a[1]);
  /* what was NOT sent, in one phrase — it ends the final line, the only part of the output the tick keeps */
  const notSent = [off.matched.size && `${off.matched.size} owner(s) on no Agent List matched to the QA tool's people (${off.rows.reduce((t, r) => t + r.sales_net, 0)} net sales) and sent`,
    off.unknown.size && `${off.unknown.size} owner(s) nobody knows (${unNet} net · ${unMade} made) not sent`,
    off.clashes.size && `${off.clashes.size} owner(s) whose QA CB the Agent List gives to someone else not sent (${[...off.clashes].slice(0, 3).join(', ')})`,
    eng.rosterFallback && `${eng.rosterFallback} agent-day(s) took today's roster campaign`].filter(Boolean).join(' · ');
  console.log(`engine ${from} → ${to}: ${rows.length} agent-days · ${tot('sales_made')} sales made · ${tot('sales_net')} net · ${new Set(rows.map((r) => r.cb)).size} agents · first sales day ${eng.firstDay || '?'}`
    + (off.matched.size ? `\n  on no Agent List but known to the QA tool (sent): ${[...off.matched].slice(0, 8).join(', ')}` : '')
    + (unTop.length ? `\n  on no Agent List and unknown to the QA tool (not sent): ${unTop.length} owner(s) — ${unTop.slice(0, 5).map(([n, k]) => n + ' ' + k).join(', ')}` : ''));
  if (unmapped.size) console.error(`  campaign(s) with no QA campaign key: ${[...unmapped].join(', ')} — ${unmappedKeys.size} agent-day(s) held as they are; add them to CAMPAIGN_KEY`);
  const byCamp = {};
  for (const r of rows) { const b = byCamp[r.campaign_key] = byCamp[r.campaign_key] || { made: 0, net: 0, agents: new Set() }; b.made += r.sales_made; b.net += r.sales_net; b.agents.add(r.cb); }
  for (const [k, b] of Object.entries(byCamp).sort((x, y) => y[1].net - x[1].net))
    console.log(`  ${k.padEnd(22)} ${String(b.made).padStart(6)} made · ${String(b.net).padStart(6)} net · ${b.agents.size} agents`);
  if (DRY) { console.log('--dry: nothing sent' + (notSent ? ' · ' + notSent : '')); if (unmapped.size) process.exitCode = 1; return; }

  const H = { apikey: qa.QA_SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + qa.QA_SUPABASE_SERVICE_KEY, 'Content-Type': 'application/json' };
  const base = qa.QA_SUPABASE_URL.replace(/\/+$/, '') + '/rest/v1/';
  /* every request is bounded — a hung connection is a failed run with a reason, not a stalled tick */
  const req = (url, init = {}) => fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_MS) });
  /* paged until the server's own count is reached, so a project capping max-rows below a page can never end the read
     early and leave rows unzeroed */
  const have = []; let total = Infinity;
  while (have.length < total) {
    /* the offset follows what actually came back, so a server page smaller than 1000 never skips rows */
    const r = await req(`${base}agent_sales_daily?select=cb,sale_date,sales_made,sales_net,campaign_key,agent_name&sale_date=gte.${from}&sale_date=lte.${to}&order=sale_date,cb&limit=1000&offset=${have.length}`,
      { headers: { ...H, Prefer: 'count=exact' } });
    if (!r.ok) { console.error('FAILED: reading the QA tool\'s agent_sales_daily — HTTP ' + r.status + ' ' + (await r.text()).slice(0, 160)); process.exitCode = 1; return; }
    const m = /\/(\d+)$/.exec(r.headers.get('content-range') || ''); if (m) total = Number(m[1]);
    const page = await r.json(); have.push(...page);
    if (!page.length || (!m && page.length < 1000)) break;
  }
  const send = rowsToSend(rows, have, { coveredFrom: eng.firstDay || '', hold: unmappedKeys });
  const refusal = zeroingRefusal(rows, have, send);
  if (refusal && !FORCE_ZERO) { console.error('FAILED: nothing sent — ' + refusal); process.exitCode = 1; return; }
  const now = new Date().toISOString();
  for (let i = 0; i < send.length; i += 500) {
    const r = await req(`${base}agent_sales_daily?on_conflict=cb,sale_date`, { method: 'POST',
      headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(send.slice(i, i + 500).map((x) => ({ ...x, synced_at: now }))) });
    if (!r.ok) { console.error('FAILED: upsert into agent_sales_daily — HTTP ' + r.status + ' ' + (await r.text()).slice(0, 160)); process.exitCode = 1; return; }
  }
  const maxDay = rows.reduce((m, r) => (r.sales_made && r.sale_date > m ? r.sale_date : m), '') || null;
  const days = new Set(send.map((r) => r.sale_date)).size;
  const note = [notSent, unmapped.size && `unmapped campaign(s): ${[...unmapped].join(', ')}`].filter(Boolean).join(' · ') || null;
  const rec = await req(`${base}sales_sync_runs`, { method: 'POST', headers: { ...H, Prefer: 'return=minimal' },
    body: JSON.stringify({ from_day: from, to_day: to, days_sent: days, rows_upserted: send.length, max_sale_date: maxDay, note }) });
  if (!rec.ok) { console.error('FAILED: recording the run (the rows are in; re-running is safe) — HTTP ' + rec.status); process.exitCode = 1; return; }
  if (unmapped.size) {
    console.error(`FAILED: sent ${send.length} row(s), but campaign(s) ${[...unmapped].join(', ')} have no QA key — ${unmappedKeys.size} agent-day(s) held; add them to CAMPAIGN_KEY`);
    process.exitCode = 1; return;
  }
  console.log(`sent ${send.length} row(s) over ${days} day(s); sales up to ${maxDay}` + (notSent ? ' · ' + notSent : ''));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main().catch((e) => { console.error('FAILED: ' + (e && e.message || e)); process.exitCode = 1; });
