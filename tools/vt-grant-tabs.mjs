/* VT GRANT TABS — give the people who used the retired Tracker Analytics app the new Vehicle Tracking pages (spec 071, A5).
 *
 * Tracker Analytics (/tracker/, app grant 'tracker') is removed in spec 071 Phase A, and 'tracker' leaves the Worker's
 * MANAGEMENT_APPS. An account whose only management app was 'tracker' would then silently become portal-only. This tool
 * runs BEFORE that deploy: it lists every app_users row that holds 'tracker' (in apps or tabs), every VT team leader
 * (by CB) and every campaign manager whose cm:assignments row names VT, and proposes
 *     apps += 'vas'      tabs.vas += ['vt_mtd', 'vt_weekly', 'vt_daily']
 * It NEVER removes anything: stale 'tracker' entries stay in the data, inert (plan §R (c)).
 *
 *   node tools/vt-grant-tabs.mjs                         dry run against the live database (read-only GETs)
 *   node tools/vt-grant-tabs.mjs --fixture <file.json>   dry run against a fixture { app_users:[…], assignments:{…} }
 *   VT_GRANT_APPLY=owner node tools/vt-grant-tabs.mjs --apply    the OWNER, at deploy time, writes the plan
 *
 * --apply refuses unless VT_GRANT_APPLY=owner, and never runs against a fixture. People are printed by username and CB
 * only. A team leader gaining 'vas' becomes a manager in the Worker's eyes (MANAGEMENT_APPS) — the plan says so per row,
 * so the owner decides with that in view.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const VT_TABS = ['vt_mtd', 'vt_weekly', 'vt_daily'];
export const VT_TL_CBS = ['CB194', 'CB104', 'CB360', 'CB358'];
const VT_CAMP_KEYS = new Set(['vt', 'matrix tracker', 'vehicle tracking', 'tracker']);
const MANAGEMENT_AFTER = new Set(['ops', 'vas']);          // the Worker's set once 'tracker' is dropped
const PORTAL_ROLES = new Set(['agent', 'tl', 'campaign_manager']);
export const normCB = (v) => { const m = String(v == null ? '' : v).toUpperCase().replace(/[^A-Z0-9]/g, '').match(/^CB0*(\d+)$/); return m ? 'CB' + m[1] : ''; };

/** Who needs the VT grant, and why. Pure: the inputs are never mutated; each change is a NEW apps/tabs value. */
export function planGrants(users, assignments = {}) {
  const vtCms = new Set(Object.entries(assignments || {})
    .filter(([, a]) => a && Array.isArray(a.campaigns) && a.campaigns.some((c) => VT_CAMP_KEYS.has(String(c).trim().toLowerCase())))
    .map(([u]) => u.toLowerCase()));
  const tlSet = new Set(VT_TL_CBS);
  const plan = [];
  for (const u of users || []) {
    const apps = Array.isArray(u.apps) ? u.apps : [];
    const tabs = u.tabs && typeof u.tabs === 'object' ? u.tabs : {};
    const why = [];
    if (apps.includes('tracker') || Object.prototype.hasOwnProperty.call(tabs, 'tracker')) why.push('tracker holder');
    if (tlSet.has(normCB(u.cb))) why.push('VT team leader');
    if (vtCms.has(String(u.username || '').toLowerCase())) why.push('VT campaign manager');
    if (!why.length) continue;
    const vas = Array.isArray(tabs.vas) ? tabs.vas : [];
    const seesAll = u.role === 'admin' || vas.includes('*');
    const addApps = apps.includes('vas') ? [] : ['vas'];
    const addTabs = seesAll ? [] : VT_TABS.filter((t) => !vas.includes(t));
    const nextApps = apps.concat(addApps);
    const nextTabs = { ...tabs, vas: vas.concat(addTabs) };
    const wasManager = !PORTAL_ROLES.has(u.role) || apps.some((a) => MANAGEMENT_AFTER.has(a));
    plan.push({ id: u.id, username: u.username, cb: normCB(u.cb) || null, role: u.role, why,
      addApps, addTabs, nextApps, nextTabs, noop: !addApps.length && !addTabs.length,
      becomesManager: PORTAL_ROLES.has(u.role) && !wasManager && addApps.includes('vas') });
  }
  return plan;
}

function printPlan(plan) {
  if (!plan.length) { console.log('Nobody holds tracker, and no VT team leader or VT campaign manager was found. Nothing to do.'); return; }
  for (const p of plan) {
    const who = p.username + (p.cb ? ' (' + p.cb + ')' : '') + ' · ' + p.role + ' · ' + p.why.join(' + ');
    if (p.noop) { console.log('  = ' + who + ' — already has vas and every VT tab'); continue; }
    console.log('  + ' + who);
    if (p.addApps.length) console.log('      apps += ' + p.addApps.join(', '));
    if (p.addTabs.length) console.log('      tabs.vas += ' + p.addTabs.join(', '));
    if (p.becomesManager) console.log('      NOTE: a ' + p.role + " gaining 'vas' becomes a manager (MANAGEMENT_APPS) — no longer portal-only");
  }
  const todo = plan.filter((p) => !p.noop).length;
  console.log(`\n${todo} account(s) to change, ${plan.length - todo} already granted. Nothing is ever removed.`);
}

async function main(argv) {
  const APPLY = argv.includes('--apply');
  const fi = argv.indexOf('--fixture');
  if (APPLY && fi !== -1) { console.error('--apply never runs against a fixture.'); return 2; }
  if (APPLY && process.env.VT_GRANT_APPLY !== 'owner') { console.error('--apply refused: set VT_GRANT_APPLY=owner (the owner applies this at deploy, before the deploy that drops tracker).'); return 2; }
  let users, assignments, write = null;
  if (fi !== -1) {
    const fx = JSON.parse(fs.readFileSync(path.resolve(argv[fi + 1] || ''), 'utf8'));
    users = fx.app_users || []; assignments = fx.assignments || {};
    console.log('DRY RUN against fixture ' + argv[fi + 1] + '\n');
  } else {
    const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, 'supabase.env'), 'utf8')
      .split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^"|"$/g, '')]));
    const H = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY, 'Content-Type': 'application/json' };
    const get = async (q) => { const r = await fetch(env.SUPABASE_URL + '/rest/v1/' + q, { headers: H }); if (!r.ok) throw new Error(q + ' → ' + r.status); return r.json(); };
    users = await get('app_users?select=id,username,role,apps,tabs,cb&order=username');
    const rows = await get('rules?key=eq.' + encodeURIComponent('cm:assignments') + '&select=value');
    assignments = (rows[0] && rows[0].value) || {};
    write = async (p) => { const r = await fetch(env.SUPABASE_URL + '/rest/v1/app_users?id=eq.' + encodeURIComponent(p.id),
      { method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify({ apps: p.nextApps, tabs: p.nextTabs }) }); return r.status; };
    console.log((APPLY ? 'APPLY' : 'DRY RUN') + ' against the live database\n');
  }
  const plan = planGrants(users, assignments);
  printPlan(plan);
  if (!APPLY) { console.log('\nDry run — nothing written. The owner applies with VT_GRANT_APPLY=owner … --apply, BEFORE the deploy.'); return 0; }
  let bad = 0;
  for (const p of plan.filter((x) => !x.noop)) { const s = await write(p); console.log('  ' + p.username + ': ' + (s === 204 ? 'granted' : 'FAILED ' + s)); if (s !== 204) bad++; }
  return bad ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error(e.message); process.exit(1); });
}
