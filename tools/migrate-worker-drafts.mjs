#!/usr/bin/env node
/* CARRY EVERY WORKER COACHING DRAFT INTO THE COACHING HUB, AS A DRAFT (spec 035-tl-coaching-hub-locked, FR-007).
 *
 *   node tools/migrate-worker-drafts.mjs            # report only
 *   node tools/migrate-worker-drafts.mjs --apply    # write each draft to the Hub, mark its Worker row migrated
 *
 * WHY: specs 003/004 kept a team leader's coaching drafts in the Worker (one `rules` row per draft, key
 * `coach-draft:<app_users id>:<uuid>`) because the Hub had no draft state. Since spec 035 it has one (`submitted:false`),
 * and the team leader's Coaching Hub tab IS the Hub — so a draft left in the Worker is a draft its owner can no longer
 * see. Each becomes a Hub document under its owner's Hub id with `submitted:false`, through the same coachingCreate the
 * old Submit used (all of its validation; `asDraft` is the one thing added), and the Worker row is marked
 * `meta.state = 'migrated'` with the Hub id — so a re-run skips it (idempotent) and nothing is deleted. A row whose owner
 * has no Hub id is REPORTED and left where it is. Nothing is guessed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { coachingCreate, COACH_TABLES } from '../worker/src/hubs.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APPLY = process.argv.includes('--apply');
const PREFIX = 'coach-draft:';

const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, 'supabase.env'), 'utf8')
  .split(/\r?\n/).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const H = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY, 'Content-Type': 'application/json' };
const rest = async (q, init) => {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${q}`, { headers: H, ...(init || {}) });
  if (!r.ok) throw new Error(`${q} → ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.status === 204 ? null : r.json();
};

const rows = await rest(`rules?key=like.${encodeURIComponent(PREFIX)}*&select=key,value,updated_at&order=key`);
const users = await rest(`app_users?select=id,username,full_name,hub_ids&role=eq.team_leader`);
const byId = new Map(users.map((u) => [String(u.id), u]));

console.log(`${rows.length} Worker draft row(s) · ${users.length} team leader account(s)\n`);
const counts = { migrated: 0, skipped: 0, unmapped: 0, failed: 0, already: 0 };
for (const row of rows) {
  const [, userId, draftId] = String(row.key).split(':');
  const value = row.value || {};
  const meta = value.meta || {};
  const state = meta.state || 'draft';
  const who = byId.get(String(userId));
  const label = `${(who && who.full_name) || ('user ' + userId)} · ${COACH_TABLES[meta.type] || meta.type || '?'} · ${meta.agentName || '—'} ${meta.employeeNumber || ''} · ${meta.date || ''}`.replace(/\s+/g, ' ');
  if (state === 'migrated') { counts.already++; console.log(`  = already migrated → ${meta.hubId}   ${label}`); continue; }
  if (state === 'submitted') { counts.skipped++; console.log(`  - submitted earlier (in the Hub as ${meta.hubId || value.hubId || '?'}) — skipped   ${label}`); continue; }
  if (!who || !who.hub_ids || !who.hub_ids.coaching) { counts.unmapped++; console.log(`  ! owner has no Coaching Hub id — left in the Worker   ${label}`); continue; }
  if (!COACH_TABLES[meta.type]) { counts.failed++; console.log(`  ! unknown type "${meta.type}" — left   ${label}`); continue; }
  if (!APPLY) { counts.migrated++; console.log(`  + would create a Hub DRAFT under ${who.full_name}'s workspace   ${label}`); continue; }
  let r;
  try {
    r = await coachingCreate({ coaching: who.hub_ids.coaching }, { full_name: who.full_name, username: who.username },
      { ...(value.data || {}), type: meta.type }, { asDraft: true });
  } catch (e) { r = { error: String(e && e.message || e) }; }
  if (!r || r.error) { counts.failed++; console.log(`  ! Hub refused: ${(r && r.error) || 'no answer'}   ${label}`); continue; }
  /* the Hub document exists from here on — if the mark below fails, say so with the id so nobody re-runs blind
     (a re-run would create it a second time; mark the row by hand first) */
  try {
    await rest(`rules?key=eq.${encodeURIComponent(row.key)}`, { method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' },
      body: JSON.stringify({ value: { ...value, meta: { ...meta, state: 'migrated', migratedAt: new Date().toISOString(), hubId: r.id, hubTable: r.table } } }) });
  } catch (e) {
    counts.failed++;
    console.log(`  !! CREATED IN THE HUB AS ${r.id} BUT THE WORKER ROW ${row.key} COULD NOT BE MARKED (${String(e && e.message || e).slice(0, 120)}) — mark it migrated by hand before any re-run   ${label}`);
    continue;
  }
  counts.migrated++; console.log(`  + migrated → ${r.id} (draft ${draftId})   ${label}`);
}
console.log(`\n${APPLY ? 'APPLIED' : 'DRY RUN (nothing written — pass --apply)'} — ${counts.migrated} ${APPLY ? 'migrated' : 'to migrate'}, ${counts.already} already migrated, ${counts.skipped} submitted earlier, ${counts.unmapped} unmapped owner, ${counts.failed} failed.`);
process.exit(counts.failed ? 1 : 0);
