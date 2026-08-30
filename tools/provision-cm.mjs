#!/usr/bin/env node
/* CAMPAIGN MANAGER PROVISIONING.
 *
 *   node tools/provision-cm.mjs            # dry run — prints every change, writes nothing
 *   node tools/provision-cm.mjs --apply    # writes the rule rows and flips the two roles
 *
 * What it does, in order:
 *   1. Seeds the three rule-book rows (cm:sla, cm:blockages, cm:assignments)
 *      from the SAME defaults the Worker carries — imported, never retyped, so
 *      the seed can never drift from what the code reads. An existing row is
 *      shown as a diff and left alone unless --force-rules.
 *   2. Flips dalwin and ryan from role 'viewer' to 'campaign_manager'.
 *      Their logins, passwords and sessions are untouched — the next sign-in
 *      simply lands on the campaign view instead of being refused.
 *
 * The Campaign Assistance pipeline itself needs NO provisioning: the Worker
 * creates it on first use, the way Coaching Actions already does.
 *
 * D1 NOTE: until Nick assigns campaigns, both managers hold all three VAS
 * campaigns (the Worker's default). Narrowing later = edit cm:assignments.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const APPLY = process.argv.includes('--apply');
const FORCE_RULES = process.argv.includes('--force-rules');

const SRC = 'file:///' + path.join(ROOT, 'worker', 'src', 'campaign.mjs').replace(/\\/g, '/').replace(/ /g, '%20');
const { CM_SLA_DEFAULTS, CM_BLOCKAGES_DEFAULTS, CM_ASSIGN_DEFAULTS } = await import(SRC);

const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, 'supabase.env'), 'utf8')
  .split(/\r?\n/).filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const H = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY, 'Content-Type': 'application/json' };
const REST = env.SUPABASE_URL + '/rest/v1/';

const get = async (p) => { const r = await fetch(REST + p, { headers: H }); if (!r.ok) throw new Error(p + ' → ' + r.status); return r.json(); };

console.log((APPLY ? 'APPLYING' : 'DRY RUN — nothing will be written (pass --apply)') + '\n');

/* ---- 1. the rule book ---- */
const want = {
  'cm:sla': CM_SLA_DEFAULTS,
  'cm:blockages': CM_BLOCKAGES_DEFAULTS,
  'cm:assignments': CM_ASSIGN_DEFAULTS,
};
const keys = Object.keys(want).map(encodeURIComponent).join(',');
const have = await get(`rules?key=in.(${keys})&select=key,value`);
const haveBy = {}; for (const r of have) haveBy[r.key] = r.value;

for (const [key, val] of Object.entries(want)) {
  if (haveBy[key] && !FORCE_RULES) {
    const same = JSON.stringify(haveBy[key]) === JSON.stringify(val);
    console.log(`rule ${key.padEnd(18)} EXISTS${same ? ' (identical to defaults)' : ' (differs — kept; --force-rules to overwrite)'}`);
    continue;
  }
  console.log(`rule ${key.padEnd(18)} ${haveBy[key] ? 'OVERWRITE' : 'SEED'} ← ${JSON.stringify(val).slice(0, 90)}…`);
  if (APPLY) {
    const r = await fetch(REST + 'rules', { method: 'POST',
      headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify([{ key, value: val, updated_by: 'provision-cm', updated_at: new Date().toISOString() }]) });
    if (!r.ok) throw new Error('write ' + key + ' → ' + r.status + ' ' + (await r.text()).slice(0, 200));
  }
}

/* ---- 2. the two accounts ---- */
console.log('');
for (const username of Object.keys(CM_ASSIGN_DEFAULTS)) {
  const rows = await get(`app_users?username=eq.${encodeURIComponent(username)}&select=username,full_name,role,active`);
  const u = rows[0];
  if (!u) { console.log(`user ${username.padEnd(8)} NOT FOUND — create the account first`); continue; }
  if (u.role === 'campaign_manager') { console.log(`user ${username.padEnd(8)} already campaign_manager`); continue; }
  console.log(`user ${username.padEnd(8)} role ${u.role} → campaign_manager  (${u.full_name}, campaigns: ${CM_ASSIGN_DEFAULTS[username].campaigns.join(', ')})`);
  if (APPLY) {
    const r = await fetch(REST + `app_users?username=eq.${encodeURIComponent(username)}`, {
      method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' },
      body: JSON.stringify({ role: 'campaign_manager' }) });
    if (!r.ok) throw new Error('patch ' + username + ' → ' + r.status + ' ' + (await r.text()).slice(0, 200));
  }
}

console.log('\n' + (APPLY
  ? 'Done. Deploy the Worker, then Dalwin and Ryan sign in as usual and land on the campaign view.'
  : 'Dry run complete. Re-run with --apply to write.'));
