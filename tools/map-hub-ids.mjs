#!/usr/bin/env node
/* RESOLVE EACH TEAM LEADER TO THEIR COACHING HUB AND KPI HUB IDENTITY, ONCE.
 *
 *   node tools/map-hub-ids.mjs            # report only
 *   node tools/map-hub-ids.mjs --apply    # write app_users.hub_ids
 *
 * Both hubs keep their own team-leader table with their own ids and their own
 * spellings — our "Dhamendra Budhu" is their "Dharmendra", "Shane Methalal" is
 * "Shane". A leader's records can only be fetched by those ids.
 *
 * The matching happens HERE and only here. At request time the Worker uses the
 * stored id verbatim, so a rename in either hub produces an empty tab that a
 * person notices and fixes — never one team leader quietly reading another's
 * coaching records, which is what a runtime name match risks the moment two
 * people share a first name.
 *
 * Nothing is guessed: a leader who does not match is REPORTED and left unmapped.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APPLY = process.argv.includes('--apply');
const HUBS = {
  coaching: { url: 'https://acrobatic-setter-212.eu-west-1.convex.cloud', fn: 'teamLeaders:list' },
  kpi: { url: 'https://cautious-bass-675.eu-west-1.convex.cloud', fn: 'users:list' },
};

const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, 'supabase.env'), 'utf8')
  .split(/\r?\n/).filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const H = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY, 'Content-Type': 'application/json' };

const cq = async (url, path_, args = {}) => {
  const r = await fetch(url + '/api/query', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: path_, args }) });
  const j = await r.json();
  if (j.status !== 'success') throw new Error(path_ + ': ' + j.errorMessage);
  return j.value;
};

/* Match on the FIRST name, normalised, and require it to be unambiguous. Both
   hubs list people as "Sharoma" or "Fabian Chetty"; our roster is always the
   full name. A first name that matches two hub entries is left unmapped rather
   than guessed — that is the case this file exists to make safe. */
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
const first = (s) => norm(String(s || '').trim().split(/\s+/)[0]);
/* Known spelling differences between our Agent List and the hubs. Kept as data
   so adding one is not a code change. */
/* the hubs' own spellings — the Agent List says Dhamendra and Renolin, both hubs say
   Dharmendra and Renolan (the dialler does too, see the Vici user groups) */
const ALIAS = { dhamendra: 'dharmendra', renolin: 'renolan' };

const leaders = await (await fetch(`${env.SUPABASE_URL}/rest/v1/app_users?select=id,username,full_name,team,hub_ids&role=eq.team_leader&order=full_name`, { headers: H })).json();
if (!leaders.length) { console.error('No team_leader accounts — run tools/provision-agent-logins.mjs first.'); process.exit(2); }

const hub = {};
for (const [k, cfg] of Object.entries(HUBS)) {
  try { hub[k] = await cq(cfg.url, cfg.fn); }
  catch (e) { console.error(`  ! ${k} hub unreachable: ${e.message}`); hub[k] = null; }
}

console.log(`${leaders.length} team leaders · coaching hub ${hub.coaching ? hub.coaching.length + ' leaders' : 'UNREACHABLE'} · kpi hub ${hub.kpi ? hub.kpi.length + ' leaders' : 'UNREACHABLE'}\n`);

let mapped = 0; const gaps = [];
for (const u of leaders) {
  const ids = {};
  const notes = [];
  for (const k of ['coaching', 'kpi']) {
    if (!hub[k]) continue;
    const want = ALIAS[first(u.full_name)] || first(u.full_name);
    const hits = hub[k].filter((x) => first(x.name) === want);
    if (hits.length === 1) ids[k] = hits[0]._id;
    else if (hits.length > 1) notes.push(`${k}: AMBIGUOUS — ${hits.length} match "${want}", left unmapped`);
    else notes.push(`${k}: no match for "${want}"`);
  }
  const line = `  ${String(u.full_name).padEnd(22)} coaching:${ids.coaching ? 'ok' : '—'}  kpi:${ids.kpi ? 'ok' : '—'}`;
  console.log(line + (notes.length ? '\n' + notes.map((n) => '        ' + n).join('\n') : ''));
  if (notes.length) gaps.push(u.full_name + ' — ' + notes.join('; '));
  if (Object.keys(ids).length) {
    mapped++;
    if (APPLY) {
      const r = await fetch(`${env.SUPABASE_URL}/rest/v1/app_users?id=eq.${u.id}`, {
        method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify({ hub_ids: ids }) });
      if (!r.ok) console.error(`        write failed: ${r.status} ${(await r.text()).slice(0, 160)}`);
    }
  }
}

console.log(`\n${APPLY ? 'APPLIED' : 'DRY RUN (nothing written — pass --apply)'} — ${mapped} of ${leaders.length} leaders have at least one hub id.`);
if (gaps.length) {
  console.log('\nUNMAPPED, and their tab will say so rather than show somebody else:');
  gaps.forEach((g) => console.log('  ' + g));
  console.log('\nFix by adding the person in the hub, or by adding a spelling to ALIAS in this file.');
}
