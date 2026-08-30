#!/usr/bin/env node
/* COACHING HUB → SUPABASE. Take a snapshot of every coaching session and store it
 * as `kv:coaching`, which is what the Worker serves to both dashboards and to
 * Agent Analytics.
 *
 *   node tools/sync-coaching-hub.mjs           # pull, report, write
 *   node tools/sync-coaching-hub.mjs --dry     # pull and report, write nothing
 *
 * WHY THIS IS A TOOL AND NOT THE WORKER DOING IT LIVE. A full pull is 6
 * collections × 14 team leaders = 84 requests, because every Convex `:list` query
 * REQUIRES a teamLeaderId (calling it with {} is a server error). Cloudflare caps
 * a single Worker invocation at 50 subrequests, and the failure mode is the
 * dangerous kind: it does not error, it PARTIALLY succeeds. Doing it inline
 * returned 45 of 84 collections and showed a team leader with 139 coaching
 * sessions a total of 23 — a silent undercount on a coaching record, which nobody
 * would ever go looking for. Node has no such cap, so the fan-out happens here
 * and the Worker reads one object.
 *
 * Run it on the daily upload cadence, next to fetch-referrals.mjs. The Worker
 * marks the data stale after 26 hours, so a missed run shows as stale on the page
 * rather than passing off yesterday's picture as today's.
 *
 * READ-ONLY against the Hub. `teamLeaders:create` and `:remove` mutations exist on
 * that Convex deployment; nothing here may ever call them.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DRY = process.argv.includes('--dry');

const SRC = 'file:///' + path.join(ROOT, 'worker', 'src', 'coaching.mjs').replace(/\\/g, '/').replace(/ /g, '%20');
/* The SAME normaliser the Worker uses — imported, never re-implemented, so the
   snapshot can never drift from what the Worker expects to read. */
const { fetchCoaching, rollUp } = await import(SRC);

const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, 'supabase.env'), 'utf8')
  .split(/\r?\n/).filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const H = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY, 'Content-Type': 'application/json' };

console.log('Pulling the Coaching Hub …');
const t0 = Date.now();
let hub;
try {
  hub = await fetchCoaching({ COACHING_HUB_URL: process.env.COACHING_HUB_URL });
} catch (e) {
  console.error('FAILED: ' + e.message);
  console.error('Nothing was written — the previous snapshot is left alone, and the Worker will report it stale.');
  process.exit(1);
}
console.log(`  ${hub.sessions.length} sessions from ${hub.leaders.length} team leaders in ${Date.now() - t0} ms`);

/* A PARTIAL PULL MUST NOT OVERWRITE A GOOD ONE. Some collections failing means
   the snapshot understates coaching, and an understated coaching record is worse
   than yesterday's complete one. */
if (hub.errors.length) {
  console.error(`\n  ${hub.errors.length} of ${hub.leaders.length * 6} collection pulls FAILED:`);
  hub.errors.slice(0, 8).forEach(e => console.error('    ' + e));
  console.error('\n  REFUSING to write a partial snapshot over a complete one. Fix the errors and re-run.');
  process.exit(1);
}

const byType = {};
for (const s of hub.sessions) byType[s.typeLabel] = (byType[s.typeLabel] || 0) + 1;
for (const [k, v] of Object.entries(byType)) console.log(`    ${k.padEnd(28)} ${v}`);
const withCb = hub.sessions.filter(s => s.cb).length;
console.log(`  identity: ${withCb} carry a CB number, ${hub.sessions.length - withCb} do not`);
const themes = rollUp(hub.sessions);
console.log(`  themes: ${themes.length} · coach-chosen: ${themes.reduce((n, t) => n + t.scored, 0)}` +
  ` (0 is expected — every classified session on the Hub is 'inferred')`);
const dates = hub.sessions.map(s => s.date).sort();
console.log(`  dates: ${dates[0]} → ${dates[dates.length - 1]}`);

const payload = JSON.stringify(hub);
console.log(`  snapshot: ${(payload.length / 1024).toFixed(0)} KB`);
if (payload.includes('data:image')) { console.error('  ABORT: a signature blob survived normalisation.'); process.exit(1); }

if (DRY) { console.log('\nDRY RUN — nothing written.'); process.exit(0); }

/* Stored the way the Worker reads it: the blob in the `raw` bucket, a pointer in
   `rules` — the same shape PULSE uses for the agent digest. */
const KEY = 'kv/coaching';
const put = await fetch(`${env.SUPABASE_URL}/storage/v1/object/raw/${KEY}`, {
  method: 'PUT',
  headers: { apikey: H.apikey, Authorization: H.Authorization, 'Content-Type': 'application/json', 'x-upsert': 'true' },
  body: payload,
});
if (!put.ok) { console.error('storage write failed: ' + put.status + ' ' + (await put.text()).slice(0, 300)); process.exit(1); }

const row = await fetch(`${env.SUPABASE_URL}/rest/v1/rules`, {
  method: 'POST',
  headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' },
  body: JSON.stringify([{
    key: 'kv:coaching',
    value: { store: 'raw/' + KEY, bytes: payload.length, sessions: hub.sessions.length, fetchedAt: hub.fetchedAt },
    updated_by: 'sync-coaching-hub', updated_at: new Date().toISOString(),
  }]),
});
if (!row.ok) { console.error('rules write failed: ' + row.status + ' ' + (await row.text()).slice(0, 300)); process.exit(1); }

console.log(`\nWROTE kv:coaching — ${hub.sessions.length} sessions, fetched ${hub.fetchedAt}`);
console.log('The Worker picks it up within 10 minutes (its per-isolate cache), immediately on a cold start.');
