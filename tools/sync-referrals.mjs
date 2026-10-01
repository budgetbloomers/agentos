#!/usr/bin/env node
/**
 * sync-referrals.mjs — the SCHEDULED HighLevel referrals pull (spec 002-live-month-sync-coaching, contract C3).
 *
 *   node tools/sync-referrals.mjs --slot=08:00            dry run: says what it would do, touches nothing
 *   node tools/sync-referrals.mjs --slot=14:00 --apply    pull + publish
 *   node tools/sync-referrals.mjs --slot=manual --apply   an unscheduled pull (never counts as a slot)
 *
 * WHY: referrals only moved when someone had VAS open and pressed "Sync now" (or the watchdog fired on an empty
 * store). The local tick (tools/tick-local.mjs) runs this at the 08:00 and 14:00 SAST slots, every day, so the
 * digest and every open VAS tab follow HighLevel without anyone being signed in.
 *
 * HOW: the counting lives in ONE place — the Worker's GET /api/referrals (the HighLevel secrets never leave it).
 * This tool mints a SHORT-LIVED admin session (<= 10 minutes, the verify suites' pattern: an app_sessions row whose
 * token_hash = sha256(token), service key), asks the Worker for a FRESH pull, DELETES the session in a finally block
 * (success or failure), then writes
 *   Storage  raw/kv/referrals-latest      {rows:[{id,created,agent,referrer,count}], contacts, pulled_at, slot, by:'tick'}
 *   rules    kv:referrals-latest          the pointer {store, pulled_at, updated_at}
 *   rules    kv:referrals-sync-log        {data: JSON({entries:[{at, slot, ok, rows, contacts, total, error|null}]})} (last 30)
 * A failure is logged (ok:false + the error text) and exits non-zero; the last good referrals-latest stands. Nothing
 * secret is ever printed. The mapping to agents (the Agent List, fuzzy names) is PULSE's _refStore — here and in
 * tools/digest-republish.mjs the rows are handed to it untouched.
 *
 * referralsSlotDue(nowMs, entries) is the tick's gate: which slot (if any) is due right now and still unserved.
 * Test hooks CBX_ENV_FILE / CBX_API_BASE / CBX_TIMEOUT_MS are honoured ONLY when CBX_TEST=1; otherwise the fixed Worker URL and
 * supabase.env are used. Every network call times out (60 s); SIGINT/SIGTERM delete the session; stale sessions are swept at start.
 */
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SLOTS = ['08:00', '14:00'];            // SAST wall-clock starts
const SLOT_WINDOW_MS = 4 * 3600000;          // a slot is served until start + 4 h (health flags it > 2 h late)
const MAX_FAILED_TRIES = 6;                  // a slot that keeps failing stops being hammered (health says so)
const LOG_KEEP = 30;
const SESSION_TTL_MS = 10 * 60000;
const NET_TIMEOUT_MS = process.env.CBX_TEST === '1' && +process.env.CBX_TIMEOUT_MS > 0 ? +process.env.CBX_TIMEOUT_MS : 60000;   // 60000 in production
/* the ONE network call: nothing can hang the tick's 20-minute child timeout, so the finally below always runs */
const tf = (url, opts) => fetch(url, { ...(opts || {}), signal: AbortSignal.timeout(NET_TIMEOUT_MS) });

/* The tick's question: at nowMs (epoch), is a slot due and not yet served TODAY (SAST)? Returns '08:00' | '14:00' | null.
   Served = an entry with ok:true for that slot whose `at` falls on today's SAST date. Failed attempts retry on the next
   tick, up to MAX_FAILED_TRIES per slot per day. Every day of the week — there is no weekend gate here. */
export function referralsSlotDue(nowMs, entries) {
  const sast = new Date(nowMs + 2 * 3600000);
  const today = sast.toISOString().slice(0, 10);
  const minutes = sast.getUTCHours() * 60 + sast.getUTCMinutes();
  const list = Array.isArray(entries) ? entries.filter((e) => e && typeof e === 'object') : [];
  const todayOf = (e) => { const t = Date.parse(e.at); return Number.isFinite(t) ? new Date(t + 2 * 3600000).toISOString().slice(0, 10) : ''; };
  for (const slot of SLOTS) {
    const start = +slot.slice(0, 2) * 60 + +slot.slice(3, 5);
    if (minutes < start || minutes >= start + SLOT_WINDOW_MS / 60000) continue;
    const mine = list.filter((e) => e.slot === slot && todayOf(e) === today);
    if (mine.some((e) => e.ok === true)) return null;
    if (mine.filter((e) => e.ok === false).length >= MAX_FAILED_TRIES) return null;
    return slot;
  }
  return null;
}

async function main() {
  const argv = process.argv.slice(2);
  const APPLY = argv.includes('--apply');
  const slotArg = (argv.find((a) => a.startsWith('--slot=')) || '--slot=manual').slice(7);
  if (!['08:00', '14:00', 'manual'].includes(slotArg)) { console.error('--slot must be 08:00, 14:00 or manual'); process.exitCode = 2; return; }
  if (!APPLY) {
    console.log('dry run (slot ' + slotArg + ') — would mint a short-lived admin session, GET /api/referrals?fresh=1, delete the session,');
    console.log('then write raw/kv/referrals-latest + kv:referrals-latest + kv:referrals-sync-log. Nothing was touched. Re-run with --apply.');
    return;
  }
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const envFile = process.env.CBX_TEST === '1' && process.env.CBX_ENV_FILE || path.join(ROOT, 'supabase.env');
  const env = Object.fromEntries(fs.readFileSync(envFile, 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^"|"$/g, '')]));
  const API = process.env.CBX_TEST === '1' && process.env.CBX_API_BASE || 'https://chatterbox-agentos-api.chatterbox-agentos.workers.dev';
  const H = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY, 'Content-Type': 'application/json' };
  const REST = env.SUPABASE_URL + '/rest/v1/';
  const upsertRule = async (key, value) => {
    const r = await tf(REST + 'rules?on_conflict=key', { method: 'POST', headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify([{ key, value, updated_by: 'sync-referrals', updated_at: new Date().toISOString() }]) });
    if (!r.ok) throw new Error(key + ' write failed: HTTP ' + r.status);
  };
  /* an ABSENT row is an empty log; a FAILED read throws — appendLog must never overwrite a log it could not read */
  const readLog = async () => {
    const r = await tf(REST + 'rules?key=eq.kv:referrals-sync-log&select=value', { headers: H });
    if (!r.ok) throw new Error('sync log not read: HTTP ' + r.status);
    const row = (await r.json())[0];
    if (!row) return [];
    const d = JSON.parse(String((row.value || {}).data || '{}'));
    return Array.isArray(d.entries) ? d.entries : [];
  };
  const appendLog = async (entry) => {
    const entries = [...(await readLog()), entry].slice(-LOG_KEEP);
    await upsertRule('kv:referrals-sync-log', { data: JSON.stringify({ entries }) });
  };

  let tokenHash = null, entry = null, failed = null;
  /* the minted session must die on EVERY path: finally, SIGINT, SIGTERM; a failed DELETE is said out loud */
  const dropSession = async () => {
    if (!tokenHash) return;
    const th = tokenHash; tokenHash = null;
    try {
      const d = await tf(REST + 'app_sessions?token_hash=eq.' + th, { method: 'DELETE', headers: H });
      if (!d.ok) console.error('the minted session could not be deleted (HTTP ' + d.status + ') — it expires on its own within 10 minutes');
    } catch { console.error('the minted session could not be deleted — it expires on its own within 10 minutes'); }
  };
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { dropSession().finally(() => process.exit(130)); });
  /* sweep any session an earlier killed run left behind (this tool's own, already expired) */
  try { await tf(REST + 'app_sessions?user_agent=eq.sync-referrals&expires_at=lt.' + encodeURIComponent(new Date().toISOString()), { method: 'DELETE', headers: H }); } catch {}
  try {
    /* a short-lived admin session — deleted in finally, whatever happens */
    const admin = ((await (await tf(REST + 'app_users?role=eq.admin&active=is.true&select=id,username&order=created_at.asc&limit=1', { headers: H })).json()) || [])[0];
    if (!admin) throw new Error('no active admin account to mint a session for');
    const token = crypto.randomBytes(32).toString('hex');
    tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const mint = await tf(REST + 'app_sessions', { method: 'POST', headers: { ...H, Prefer: 'return=minimal' },
      body: JSON.stringify([{ token_hash: tokenHash, user_id: admin.id, expires_at: new Date(Date.now() + SESSION_TTL_MS).toISOString(), user_agent: 'sync-referrals', scope: 'referrals' }]) });
    if (!mint.ok) { tokenHash = null; throw new Error('could not mint a session: HTTP ' + mint.status); }
    const res = await tf(API + '/api/referrals?fresh=1', { headers: { Authorization: 'Bearer ' + token, 'x-cbx-client': 'v5' } });
    if (!res.ok) throw new Error('/api/referrals answered HTTP ' + res.status);
    const d = await res.json();
    if (!d || !Array.isArray(d.rows) || !d.rows.length) throw new Error('HighLevel returned no referral rows');
    const rows = d.rows.map((x) => ({ id: x.id, created: x.created, agent: x.agent, referrer: x.referrer, count: x.count }));
    const latest = { rows, contacts: d.contacts || 0, pulled_at: d.pulled_at || new Date().toISOString(), slot: slotArg, by: 'tick' };
    const put = await tf(env.SUPABASE_URL + '/storage/v1/object/raw/kv/referrals-latest', { method: 'PUT',
      headers: { ...H, 'Content-Type': 'application/json', 'x-upsert': 'true' }, body: JSON.stringify(latest) });
    if (!put.ok) throw new Error('referrals-latest storage write failed: HTTP ' + put.status);
    await upsertRule('kv:referrals-latest', { store: 'raw/kv/referrals-latest', pulled_at: latest.pulled_at, updated_at: new Date().toISOString() });
    entry = { at: new Date().toISOString(), slot: slotArg, ok: true, rows: rows.length, contacts: latest.contacts, total: rows.reduce((t, r) => t + (+r.count || 0), 0), error: null };
    console.log('referrals ' + slotArg + ': ' + entry.rows + ' rows · ' + entry.total + ' referrals · ' + entry.contacts + ' contacts');
  } catch (e) {
    failed = String((e && e.message) || e).slice(0, 200);
    entry = { at: new Date().toISOString(), slot: slotArg, ok: false, rows: 0, contacts: 0, total: 0, error: failed };
    console.error('referrals ' + slotArg + ' FAILED: ' + failed);
  } finally {
    await dropSession();
  }
  try { await appendLog(entry); } catch (e) { console.error('the sync log was not written (sync log error): ' + String((e && e.message) || e).slice(0, 120)); process.exitCode = 1; }
  if (failed) process.exitCode = 1;
}

/* run only as a program — the tick imports referralsSlotDue without running anything */
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
