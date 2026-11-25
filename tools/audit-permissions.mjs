/* PERMISSION AUDIT — do the pages that exist match the pages people can reach?
 *
 * Ship a new page and it is invisible to everyone whose `tabs` list is explicit: auth-gate.js
 * hides any nav item whose id is not in the list, so the page lands, the deploy succeeds, and
 * a subset of users simply never see it. That happened twice — Variance Report never reached
 * Ryan, and Lead Allocation / Lead Management reached nobody with a scoped list. It is silent
 * by construction, which is why it needs a check rather than a memory.
 *
 * Reports, per user and per app:
 *   MISSING    — a page exists in the app but is not in the user's tab list
 *   DEAD       — a tab id the user still carries that no longer exists (e.g. Ops' lead pages)
 *   DEAD-INERT — a grant for an app that no longer exists at all: `tracker` (Tracker Analytics, removed by spec 071
 *                Phase A). It opens nothing and the Worker ignores it. It is REPORTED, never stripped: --dead leaves it
 *                (plan §R (c) keeps the data; tools/vt-grant-tabs.mjs never removes anything either)
 *   VT         — specs 071/072: vt_report / vt_mtd / vt_weekly / vt_daily are ordinary VAS tabs, read from PULSE's NAV like every other
 *                page (MISSING / DEAD apply to them as to any page). An account that still carries a `tracker` grant but
 *                lacks the VT tabs is named on its own line — the person most likely to be looking for them.
 *
 * Read-only. Run after adding or removing any page:
 *     node tools/audit-permissions.mjs            (report)
 *     node tools/audit-permissions.mjs --dead     (also DELETE dead tab ids — never the DEAD-INERT tracker grants)
 * readPages() / auditUser() / linesFor() are pure and exported (verify-audit-permissions-071.mjs); importing runs nothing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const APPS = ['vas', 'ops'];                 // the apps whose tab lists mean something
export const RETIRED_APPS = ['tracker'];            // spec 071 Phase A: granted once, opens nothing now
/* spec 072 E4: vt_report joins them. The page ids themselves are read from PULSE's own NAV (readPages), so a new
   VT page is MISSING for an account that lacks it and is never DEAD — this list is only what a VT grant should hold. */
export const VT_TABS = ['vt_report', 'vt_mtd', 'vt_weekly', 'vt_daily'];

/** page ids straight from each app's source — the app is the authority, never a list kept here */
export function readPages(vasSrc, opsSrc) {
  const at = String(vasSrc).indexOf('const NAV=[');
  const navBlk = at < 0 ? '' : vasSrc.slice(at, vasSrc.indexOf('];', at));
  return {
    vas: [...navBlk.matchAll(/\['([a-z_]+)','/g)].map((m) => m[1]),
    ops: [...String(opsSrc).matchAll(/\{id:'([a-z_]+)',label:/g)].map((m) => m[1]),
  };
}

/** One account → {missing:{app:[…]}, dead:{app:[…]}, inert:[…], vtMissing:[…]|null, nextTabs|null}. Pure; nothing is mutated. */
export function auditUser(u, PAGES, { fixDead = false } = {}) {
  const tabs = (u && u.tabs && typeof u.tabs === 'object') ? u.tabs : {};
  const apps = Array.isArray(u && u.apps) ? u.apps : [];
  const out = { missing: {}, dead: {}, inert: [], vtMissing: null, nextTabs: null };
  for (const app of APPS) {
    const t = tabs[app];
    if (u.role === 'admin' || (Array.isArray(t) && t.includes('*'))) continue;   // sees everything
    if (!Array.isArray(t) || !t.length) continue;                                 // no access to this app
    const missing = PAGES[app].filter((x) => !t.includes(x));
    const stale = t.filter((x) => !PAGES[app].includes(x) && x !== '*');
    if (missing.length) out.missing[app] = missing;
    if (stale.length) out.dead[app] = stale;
  }
  for (const r of RETIRED_APPS) {
    if (apps.includes(r)) out.inert.push('apps:' + r);
    if (Object.prototype.hasOwnProperty.call(tabs, r)) out.inert.push('tabs.' + r);
  }
  const vas = Array.isArray(tabs.vas) ? tabs.vas : [];
  if (out.inert.length && !(u.role === 'admin' || vas.includes('*'))) {
    const lack = VT_TABS.filter((x) => PAGES.vas.includes(x) && !vas.includes(x));
    if (lack.length) out.vtMissing = lack;
  }
  if (fixDead && Object.keys(out.dead).length) {
    const next = { ...tabs };
    for (const app of Object.keys(out.dead)) next[app] = tabs[app].filter((x) => PAGES[app].includes(x) || x === '*');
    out.nextTabs = next;                                            // the tracker key stays exactly as it was
  }
  return out;
}

/** the printed lines for one account ([] = nothing to say) */
export function linesFor(r) {
  const lines = [];
  for (const [app, ids] of Object.entries(r.missing)) lines.push(`  ${app}: MISSING ${ids.join(', ')}`);
  for (const [app, ids] of Object.entries(r.dead)) lines.push(`  ${app}: DEAD ${ids.join(', ')}`);
  if (r.inert.length) lines.push(`  DEAD-INERT ${r.inert.join(', ')} — Tracker Analytics is gone (spec 071); this grant opens nothing and is left in place`);
  if (r.vtMissing) lines.push(`  VT: a former Tracker user without ${r.vtMissing.join(', ')} — run node tools/vt-grant-tabs.mjs (dry run) and decide`);
  return lines;
}

async function main(argv) {
  const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, 'supabase.env'), 'utf8')
    .split(/\r?\n/).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
  const H = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY, 'Content-Type': 'application/json' };
  const FIX_DEAD = argv.includes('--dead');
  const PAGES = readPages(fs.readFileSync(path.join(ROOT, 'nicks_code', 'index.html'), 'utf8'),
    fs.readFileSync(path.join(ROOT, 'Chatterbox_AgentOS_Analytics.html'), 'utf8'));
  for (const a of APPS) if (!PAGES[a].length) { console.error(`could not read ${a} page ids — aborting`); return 2; }
  console.log(`pages — vas: ${PAGES.vas.length} (VT: ${VT_TABS.filter((x) => PAGES.vas.includes(x)).join(', ') || 'none'}) · ops: ${PAGES.ops.length}\n`);
  const users = await (await fetch(env.SUPABASE_URL + '/rest/v1/app_users?select=id,username,role,apps,tabs&order=username', { headers: H })).json();
  let gaps = 0, dead = 0, inert = 0, vt = 0;
  for (const u of users) {
    const r = auditUser(u, PAGES, { fixDead: FIX_DEAD });
    const lines = linesFor(r);
    gaps += Object.values(r.missing).reduce((s, x) => s + x.length, 0);
    dead += Object.values(r.dead).reduce((s, x) => s + x.length, 0);
    inert += r.inert.length ? 1 : 0; vt += r.vtMissing ? 1 : 0;
    if (r.nextTabs) {
      const res = await fetch(env.SUPABASE_URL + '/rest/v1/app_users?id=eq.' + u.id, { method: 'PATCH', headers: H, body: JSON.stringify({ tabs: r.nextTabs }) });
      lines.push(`  ${res.status === 204 ? 'removed dead ids' : 'FAILED ' + res.status}`);
    }
    if (lines.length) console.log(u.username + '\n' + lines.join('\n'));
  }
  console.log(`\n${gaps} missing-page grant(s), ${dead} dead tab id(s), ${inert} account(s) with an inert tracker grant, ${vt} former Tracker user(s) without the VT tabs — across ${users.length} users.`);
  if (gaps) console.log('MISSING is not automatically granted — page access is a deliberate decision. Grant what belongs to each role.');
  if (dead && !FIX_DEAD) console.log('Re-run with --dead to strip the dead ids (the inert tracker grants are never stripped).');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then((c) => { process.exitCode = c; }, (e) => { console.error(e.message); process.exitCode = 1; });
}
