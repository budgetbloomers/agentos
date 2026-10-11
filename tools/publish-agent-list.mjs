/* PUBLISH AN AGENT LIST FROM THE COMMAND LINE — the same path as the Upload Station.
 *
 * Why this exists (2026-09-03): a list uploaded at 13:44 never replaced the roster of
 * record, and the workbook's VAS sheet carried a campaign ("Download & Test", 5 agents)
 * that the old off-campaign guard had been silently dropping on every upload. This tool
 * drives the DEPLOYED PULSE engine headlessly over the file — the real bufferToText +
 * ingestText, so sheet handling (VAS vs VT tabs, campOf, KNOWN_CAMP, rosterAsOf) is the
 * app's own — then POSTs the roster PULSE produced to /api/roster exactly as the page
 * does, so the Worker runs sync_agent_list + sync_team_leaders + sync_campaigns and
 * answers with what changed. Nothing here parses a roster of its own.
 *
 *   node tools/publish-agent-list.mjs <path-to-Agent-List.xlsx> [--as-of YYYY-MM-DD] [--apply --as <your username>]
 *
 * Without --apply it ingests and reports, and posts nothing. To publish, say WHO is publishing (--as): the list is
 * recorded under that account, exactly as an upload in the station is (spec 011, 2026-10-07 — it used to sign in as
 * "the first admin it finds", so a list Aarav published read "uploaded by nicholas").
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { responseText } from './kv-store.mjs';   // the VAS state is kept gzipped at rest (Spec Kit 031)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = await import(pathToFileURL(path.join(ROOT, 'nicks_code', 'diagnostics', 'node_modules', 'playwright', 'index.mjs')).href);
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, 'supabase.env'), 'utf8')
  .split(/\r?\n/).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const H = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY, 'Content-Type': 'application/json' };
const REST = env.SUPABASE_URL + '/rest/v1/';
const API = 'https://chatterbox-agentos-api.chatterbox-agentos.workers.dev';

const file = process.argv[2];
if (!file || !fs.existsSync(file)) { console.error('usage: node tools/publish-agent-list.mjs <Agent List.xlsx> [--as-of YYYY-MM-DD] [--apply --as <your username>]'); process.exit(1); }
const APPLY = process.argv.includes('--apply');
const asIdx = process.argv.indexOf('--as');
const AS = asIdx > 0 ? String(process.argv[asIdx + 1] || '').trim().toLowerCase() : '';
/* the roles the Worker refuses a publish from (PORTAL_ROLES) — refused here first, before any work */
const PORTAL_ROLES = new Set(['agent', 'team_leader', 'campaign_manager']);
if (APPLY && !AS) { console.error('--apply needs --as <your username>: the list is recorded under the person who publishes it. Nothing was posted.'); process.exit(1); }
const ai = process.argv.indexOf('--as-of');
const asOf = ai > 0 ? process.argv[ai + 1] : new Date(Date.now() + 2 * 3600000).toISOString().slice(0, 10);
const name = path.basename(file);
const bytes = fs.readFileSync(file);
const hash = crypto.createHash('sha256').update(bytes).digest('hex');

/* ---- the live state, so campOf/orgHist/roster behave as they do for a real upload ---- */
const st = await fetch(`${env.SUPABASE_URL}/storage/v1/object/raw/kv/vas-state`, { headers: H });
if (!st.ok) { console.error('cannot read vas-state: ' + st.status); process.exit(2); }
const blob = await responseText(st);

/* ---- the deployed build, headless ---- */
const HTML = path.join(ROOT, 'site', 'pulse', 'index.html');
const SERVE = { '/': HTML, '/index.html': HTML, '/xlsx.full.min.js': path.join(ROOT, 'site', 'xlsx.full.min.js') };
const server = http.createServer((q, s) => { const p = SERVE[q.url.split('?')[0]];
  if (!p || !fs.existsSync(p)) { s.writeHead(404); s.end(); return; }
  s.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' }); fs.createReadStream(p).pipe(s); });
await new Promise((r) => server.listen(8187, '127.0.0.1', r));
const b = await chromium.launch({ args: ['--js-flags=--max-old-space-size=8192'] });
const page = await b.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto('http://127.0.0.1:8187/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__mtd && window.__mtd.state() && typeof XLSX !== 'undefined', null, { timeout: 45000 });
await page.evaluate((x) => { const S = window.__mtd.state(); const o = JSON.parse(x); for (const k of Object.keys(o)) S[k] = o[k]; window.__mtd.rebuild(); }, blob);

const before = await page.evaluate(() => { const S = window.__mtd.state(); const c = {}; (S.roster || []).forEach((a) => { c[a.campaign] = (c[a.campaign] || 0) + 1; }); return { n: (S.roster || []).length, c }; });
console.log('roster before: ' + before.n + ' ' + JSON.stringify(before.c));

const res = await page.evaluate(async ([nm, b64, h]) => {
  const bin = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
  const text = await bufferToText(nm, bin.buffer);
  const toasts = []; const t0 = window.toast; window.toast = (m) => { toasts.push(String(m)); };
  const ok = await window.__mtd.ingest(nm, text, 'roster', h);
  window.toast = t0;
  const S = window.__mtd.state(); const c = {}; (S.roster || []).forEach((a) => { c[a.campaign] = (c[a.campaign] || 0) + 1; });
  return { ok, toasts, n: (S.roster || []).length, c, asOf: S.settings && S.settings.rosterAsOf,
    rows: (window.__rosterRaw && window.__rosterRaw.rows) || null,          // the whole file, unclassified — the server derives the roster
    roster: (S.roster || []).map((a) => ({ code: a.code, name: a.name, tl: a.tl, campaign: a.campaign, tenure: a.tenure, callx: a.callx, sf: a.sf, target: a.target, start: a.start })) };
}, [name, bytes.toString('base64'), hash]);
await b.close(); server.close();

console.log('ingested: ' + res.ok + ' · roster after: ' + res.n + ' ' + JSON.stringify(res.c));
for (const t of res.toasts) console.log('  toast: ' + t.slice(0, 220));
if (errs.length) console.log('page errors: ' + errs.slice(0, 3).join(' | '));
if (!res.ok || !res.roster.length) { console.error('the engine did not accept this file as an Agent List — nothing published'); process.exit(1); }
if (!APPLY) { console.log('\ndry run — re-run with --apply to publish as of ' + asOf); process.exit(0); }

/* ---- publish AS THE OPERATOR, exactly as the page does (spec 011: never a stand-in account) ---- */
const me = (await (await fetch(REST + 'app_users?username=eq.' + encodeURIComponent(AS) + '&select=id,username,full_name,role,active&limit=1', { headers: H })).json())[0];
if (!me || !me.active) { console.error('No active account "' + AS + '" — nothing was posted.'); process.exit(1); }
if (PORTAL_ROLES.has(me.role)) { console.error('"' + AS + '" is a ' + me.role + ' account; publishing the Agent List is a management action — nothing was posted.'); process.exit(1); }
console.log('\npublishing as ' + me.username + ' (' + (me.full_name || me.username) + ', ' + me.role + ')');
const token = crypto.randomBytes(32).toString('hex');
const th = crypto.createHash('sha256').update(token).digest('hex');
await fetch(REST + 'app_sessions', { method: 'POST', headers: { ...H, Prefer: 'return=minimal' },
  body: JSON.stringify([{ token_hash: th, user_id: me.id, expires_at: new Date(Date.now() + 300000).toISOString(), user_agent: 'publish-agent-list' }]) });
try {
  const r = await fetch(API + '/api/roster', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: 'vas', file: name, as_of: asOf, rows: res.rows || undefined, roster: res.roster }) });
  const j = await r.json();
  console.log('\nPOST /api/roster -> ' + r.status + ' accepted=' + j.accepted + (j.reason ? ' (' + j.reason + ')' : '') + (j.stage ? ' stage=' + j.stage : '') + ' as_of=' + j.as_of + ' n=' + j.n + (j.on_file ? ' of ' + j.on_file + ' rows in the file' : ''));
  if (j.detail) console.log('  ' + j.detail);
  if ((j.dropped || []).length) console.log('  dropped:   ' + j.dropped.map((d) => (d.code || d.name || 'row ' + d.row) + ' (' + d.why + ')').join(', '));
  if ((j.campaigns_on_list || []).length) console.log('  on list:   ' + j.campaigns_on_list.map((c) => c.label + ' ' + c.agents).join(' · '));
  const n = (o, k) => ((o && o[k]) || []).length;
  if (j.sync) console.log('  agents:    ' + j.sync.status + ' +' + n(j.sync, 'created') + ' created, ' + n(j.sync, 'updated') + ' updated, -' + n(j.sync, 'removed') + ' removed'
    + (n(j.sync, 'created') ? ' new: ' + j.sync.created.map((c) => c.cb).join(',') : '') + (n(j.sync, 'removed') ? ' gone: ' + j.sync.removed.map((c) => c.cb).join(',') : '') + (j.sync.detail ? ' -- ' + j.sync.detail : ''));
  if (j.leaders) console.log('  leaders:   ' + j.leaders.status + ' +' + n(j.leaders, 'created') + ' -' + n(j.leaders, 'removed') + (n(j.leaders, 'unrepresented') ? ' unrepresented: ' + j.leaders.unrepresented.join(', ') : ''));
  if (j.integrity) console.log('  in step:   ' + (j.integrity.in_step === true ? 'YES — agent logins, leader logins and campaigns match the list' : j.integrity.in_step === false ? 'NO — ' + j.integrity.failures.map((f) => f.check + ' (' + f.n + ')').join('; ') : 'could not be confirmed (' + (j.integrity.error || '') + ')'));
  if (j.campaigns) console.log('  campaigns: ' + j.campaigns.status + ' created ' + JSON.stringify((j.campaigns.created || []).map((c) => c.label + ' (' + c.agents + ')')) + ' deleted ' + JSON.stringify((j.campaigns.deleted || []).map((c) => c.label)) + (j.campaigns.detail ? ' -- ' + j.campaigns.detail : ''));
} finally {
  await fetch(REST + 'app_sessions?token_hash=eq.' + th, { method: 'DELETE', headers: H });
}
