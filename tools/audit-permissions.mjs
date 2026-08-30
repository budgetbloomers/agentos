/* PERMISSION AUDIT — do the pages that exist match the pages people can reach?
 *
 * Ship a new page and it is invisible to everyone whose `tabs` list is explicit: auth-gate.js
 * hides any nav item whose id is not in the list, so the page lands, the deploy succeeds, and
 * a subset of users simply never see it. That happened twice — Variance Report never reached
 * Ryan, and Lead Allocation / Lead Management reached nobody with a scoped list. It is silent
 * by construction, which is why it needs a check rather than a memory.
 *
 * Reports, per user and per app:
 *   MISSING — a page exists in the app but is not in the user's tab list
 *   DEAD    — a tab id the user still carries that no longer exists (e.g. Ops' lead pages)
 *
 * Read-only. Run after adding or removing any page:
 *     node tools/audit-permissions.mjs            (report)
 *     node tools/audit-permissions.mjs --dead     (also DELETE dead tab ids)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, 'supabase.env'), 'utf8')
  .split(/\r?\n/).filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const H = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY, 'Content-Type': 'application/json' };
const FIX_DEAD = process.argv.includes('--dead');

/* page ids straight from each app — the app is the authority, never a list kept here */
const vasSrc = fs.readFileSync(path.join(ROOT, 'nicks_code', 'index.html'), 'utf8');
const navBlk = vasSrc.slice(vasSrc.indexOf('const NAV=['), vasSrc.indexOf('];', vasSrc.indexOf('const NAV=[')));
const PAGES = {
  vas: [...navBlk.matchAll(/\['([a-z_]+)','/g)].map(m => m[1]),
  ops: [...fs.readFileSync(path.join(ROOT, 'Chatterbox_AgentOS_Analytics.html'), 'utf8')
    .matchAll(/\{id:'([a-z_]+)',label:/g)].map(m => m[1]),
};
for (const a of Object.keys(PAGES)) if (!PAGES[a].length) { console.error(`could not read ${a} page ids — aborting`); process.exit(2); }
console.log(`pages — vas: ${PAGES.vas.length} · ops: ${PAGES.ops.length}\n`);

const users = await (await fetch(env.SUPABASE_URL + '/rest/v1/app_users?select=id,username,role,apps,tabs&order=username', { headers: H })).json();
let gaps = 0, dead = 0;
for (const u of users) {
  const lines = [];
  for (const app of ['vas', 'ops']) {
    const t = (u.tabs || {})[app];
    if (u.role === 'admin' || (Array.isArray(t) && t.includes('*'))) continue;   // sees everything
    if (!Array.isArray(t) || !t.length) continue;                                 // no access to this app
    const missing = PAGES[app].filter(x => !t.includes(x));
    const stale = t.filter(x => !PAGES[app].includes(x) && x !== '*');
    if (missing.length) { gaps += missing.length; lines.push(`  ${app}: MISSING ${missing.join(', ')}`); }
    if (stale.length) { dead += stale.length; lines.push(`  ${app}: DEAD ${stale.join(', ')}`); }
    if (FIX_DEAD && stale.length) {
      const tabs = { ...(u.tabs || {}) }; tabs[app] = t.filter(x => PAGES[app].includes(x) || x === '*');
      const r = await fetch(env.SUPABASE_URL + '/rest/v1/app_users?id=eq.' + u.id, { method: 'PATCH', headers: H, body: JSON.stringify({ tabs }) });
      lines.push(`  ${app}: ${r.status === 204 ? 'removed dead ids' : 'FAILED ' + r.status}`);
    }
  }
  if (lines.length) console.log(u.username + '\n' + lines.join('\n'));
}
console.log(`\n${gaps} missing-page grant(s), ${dead} dead tab id(s) across ${users.length} users.`);
if (gaps) console.log('MISSING is not automatically granted — page access is a deliberate decision. Grant what belongs to each role.');
if (dead && !FIX_DEAD) console.log('Re-run with --dead to strip the dead ids.');
