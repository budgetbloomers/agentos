/* SYNC THE OPS (AgentOS Analytics) AGENT LIST FROM PULSE'S LIVE ROSTER.
 *
 * The newest Agent List (effective 2026-08-19) was uploaded to PULSE from another
 * machine and the file is not on disk here — but PULSE's kv:vas-state roster IS that
 * list. Ops still holds the 13 Aug list. This tool replays what the Ops app itself
 * does on an Agent List upload (TRANSFORM.AGENT_LIST -> applyLoad snapshot replace ->
 * buildIdentity -> saveFacts + saveAudit + saveConfig), writing the same three blobs
 * the app writes. Nothing here invents data: every row comes from PULSE's roster,
 * with per-agent extras (callx alias, SF name, start date) carried over from the
 * old Ops facts where PULSE lacks them.
 *
 *   node sync-ops-agent-list.mjs           # dry run: build + report, write nothing
 *   node sync-ops-agent-list.mjs --apply   # build + backup + publish
 */
import fs from 'node:fs';
import path from 'node:path';
import { responseText } from './kv-store.mjs';   // the VAS state is kept gzipped at rest (Spec Kit 031)

const APPLY = process.argv.includes('--apply');
const AGENTOS = 'C:/Users/aarav/OneDrive/Desktop/Chatterbox Agent OS/agentos';
const env = Object.fromEntries(fs.readFileSync(path.join(AGENTOS, 'supabase.env'), 'utf8')
  .split(/\r?\n/).filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const H = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY };
const get = async (store) => {
  const r = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${store}`, { headers: H });
  if (!r.ok) throw new Error(store + ': ' + r.status);
  return responseText(r);   // a store may be kept gzipped at rest (specs 013, 031)
};

/* ---- the app's own helpers, replicated verbatim ---- */
const normCB = v => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');                    // Ops :761
const normName = v => String(v || '').toLowerCase().replace(/\s+-\s*.*$|\s*-\s+.*$/, '').replace(/\s+/g, ' ').trim(); // Ops :770
const IDENT_PLACEHOLDER = /^(-+|n\/?a|none|null|nil|tbc|tbd|\.|#n\/a)$/i;                       // Ops :1546
const identBlank = v => { const s = String(v == null ? '' : v).trim(); return !s || IDENT_PLACEHOLDER.test(s); };
const campOf = c => /nest/i.test(c || '') ? 'Nesting' : (/cuddle/i.test(c || '') ? 'Cuddle' : (/track|vehicle|vision|^vt$/i.test(c || '') ? 'VT' : 'Courtesy')); // PULSE :780

/* ---- current cloud state ---- */
const [oldFacts, cfg, audit, vas] = await Promise.all([
  get('raw/kv/cb-facts-AGENT_LIST').then(JSON.parse),
  get('raw/kv/cb-config').then(JSON.parse),
  get('raw/kv/cb-audit').then(JSON.parse),
  get('raw/kv/vas-state').then(JSON.parse),
]);
const roster = vas.roster || [];
console.log(`old Ops facts: ${oldFacts.length} agents · PULSE roster: ${roster.length} agents`);
console.log(`config keys: ${Object.keys(cfg).join(', ')} · batches: ${(audit.batches || []).length} · exceptions: ${(audit.exceptions || []).length}`);

const oldBy = new Map(oldFacts.map(r => [r.cb_norm, r]));
/* per-class raw-queue vocabulary from the old facts, so the display grouping keeps
   one consistent label per campaign (e.g. if VT was stored as "Vehicle Tracking") */
const vocab = {};
{ const tally = {};
  for (const r of oldFacts) { const c = campOf(r.queue); (tally[c] = tally[c] || {})[r.queue] = (tally[c][r.queue] || 0) + 1; }
  for (const c in tally) vocab[c] = Object.entries(tally[c]).sort((a, b) => b[1] - a[1])[0][0];
  console.log('queue vocabulary per class:', JSON.stringify(vocab)); }

/* ---- build the new facts, exactly the TRANSFORM.AGENT_LIST shape ---- */
const nums = (audit.batches || []).map(b => parseInt(String(b.batch_id || '').replace(/^B/, ''), 10)).filter(n => !isNaN(n));
const batch_id = 'B' + String((nums.length ? Math.max(...nums) : 0) + 1).padStart(4, '0');
const newFacts = [];
for (const a of roster) {
  const cb_norm = normCB(a.code); if (!cb_norm) continue;
  const old = oldBy.get(cb_norm);
  const cls = campOf(a.campaign);
  const queue = (old && campOf(old.queue) === cls) ? old.queue : (vocab[cls] || cls);
  newFacts.push({
    cb_code: old?.cb_code || a.code,
    cb_norm,
    agent_name: old?.agent_name || a.name || '',
    team_leader: a.tl || '',
    queue,
    tenure: a.tenure || old?.tenure || '',
    callx_alias: String(a.callx || old?.callx_alias || '').trim(),
    sf_name: String(a.sf || old?.sf_name || '').trim(),
    target: (a.target > 0 ? a.target : (old?.target ?? (a.target || null))),
    start_date: old?.start_date || (/^\d{4}-\d{2}-\d{2}/.test(a.start || '') ? String(a.start).slice(0, 10) : null),
    _d: null, _batch: batch_id,
  });
}
/* one roster row per agent (applyLoad's AGENT_LIST dedup) */
const seen = new Map(); newFacts.forEach(r => seen.set(r.cb_norm, r));
const facts = [...seen.values()];
console.log(`\nnew facts: ${facts.length} agents · batch ${batch_id}`);
const count = (it, f) => { const t = {}; for (const v of it) { const c = f(v); t[c] = (t[c] || 0) + 1; } return t; };
console.log('new queue tally:', JSON.stringify(count(facts, r => r.queue)));
console.log('TLs:', JSON.stringify(count(facts, r => r.team_leader || '(blank)')));

/* what changes, in words */
const gone = oldFacts.filter(r => !seen.has(r.cb_norm));
const added = facts.filter(r => !oldBy.has(r.cb_norm));
const moved = facts.filter(r => oldBy.has(r.cb_norm) && campOf(oldBy.get(r.cb_norm).queue) !== campOf(r.queue));
const retld = facts.filter(r => oldBy.has(r.cb_norm) && String(oldBy.get(r.cb_norm).team_leader || '') !== String(r.team_leader || ''));
console.log(`\nleavers dropped: ${gone.length} · joiners added: ${added.length} · campaign moves: ${moved.length} · TL changes: ${retld.length}`);
for (const r of moved) console.log(`  move  ${r.cb_norm} ${r.agent_name}: ${oldBy.get(r.cb_norm).queue} -> ${r.queue}`);
const nikita = oldFacts.filter(r => /nikita/i.test(r.team_leader || ''));
const nikitaAfter = facts.filter(r => /nikita/i.test(r.team_leader || ''));
console.log(`Nikita Baijnath: ${nikita.length} agents before -> ${nikitaAfter.length} after`);

/* ---- batch record, as applyLoad writes it ---- */
const now = new Date().toISOString();
const oldALBatches = (audit.batches || []).filter(b => b.source_type === 'AGENT_LIST');
const batches = (audit.batches || []).filter(b => b.source_type !== 'AGENT_LIST');
batches.push({
  batch_id, source_type: 'AGENT_LIST', source_system: 'Roster', uploaded_by: 'PULSE sync',
  uploaded_at: now, period_start: null, period_end: null,
  original_file_name: 'Matrix - Agent List.xlsx (synced from PULSE live roster, list effective 2026-08-19)',
  file_hash: 'pulse-sync-' + now.slice(0, 10), raw_row_count: roster.length,
  loaded_row_count: facts.length, rejected_row_count: 0, validation_status: 'passed',
  parser_version: 'v1.0', notes: 'Roster synced from PULSE kv:vas-state (the 19 Aug Agent List was uploaded to PULSE only; the xlsx is not on this machine). Re-uploading the real file supersedes this.',
});
console.log(`retiring ${oldALBatches.length} old AGENT_LIST batch(es): ${oldALBatches.map(b => b.batch_id + ' ' + (b.original_file_name || '')).join(' · ')}`);

/* ---- identity maps, as buildIdentity writes them (agentMap reset like a real upload) ---- */
const cbInfo = {}, agentMap = {}, claims = {};
for (const a of facts) {
  cbInfo[a.cb_norm] = { code: a.cb_code, name: a.agent_name, tl: a.team_leader, target: a.target, queue: a.queue, tenure: a.tenure };
  if (!identBlank(a.callx_alias)) agentMap[a.callx_alias] = a.cb_norm;
  if (!identBlank(a.agent_name)) agentMap[a.agent_name] = a.cb_norm;
  for (const v of [a.sf_name, a.agent_name]) {
    if (identBlank(v)) continue;
    const k = normName(v);
    if (!k || IDENT_PLACEHOLDER.test(k)) continue;
    (claims[k] = claims[k] || new Set()).add(a.cb_norm);
  }
}
const sfOwnerMap = {}; let ambig = 0;
for (const k in claims) { const s = claims[k]; if (s.size === 1) sfOwnerMap[k] = [...s][0]; else ambig++; }
console.log(`identity: ${Object.keys(cbInfo).length} cbInfo · ${Object.keys(agentMap).length} agentMap · ${Object.keys(sfOwnerMap).length} sfOwnerMap · ${ambig} ambiguous name(s)`);
const droppedManual = Object.keys(cfg.agentMap || {}).filter(k => !(k in agentMap) && (cfg.agentMap[k]));
console.log(`manual agentMap entries not re-derived (reset like a real upload): ${droppedManual.length}${droppedManual.length ? ' — ' + droppedManual.slice(0, 10).join(', ') : ''}`);

const newCfg = { ...cfg, agentMap, sfOwnerMap, cbInfo };   // kpis, rules, user preserved
const newAudit = { batches, exceptions: (audit.exceptions || []).slice(0, 600) };

if (!APPLY) { console.log('\ndry run — nothing written. Re-run with --apply to publish.'); process.exit(0); }

/* ---- backup, then publish exactly where the app reads ---- */
const bdir = path.join(AGENTOS, 'backups', now.slice(0, 10) + '-ops-agent-list-sync');
fs.mkdirSync(bdir, { recursive: true });
fs.writeFileSync(path.join(bdir, 'cb-facts-AGENT_LIST.json'), JSON.stringify(oldFacts));
fs.writeFileSync(path.join(bdir, 'cb-config.json'), JSON.stringify(cfg));
fs.writeFileSync(path.join(bdir, 'cb-audit.json'), JSON.stringify(audit));
console.log('\nbackups written to ' + bdir);

for (const [key, body] of [['cb-facts-AGENT_LIST', JSON.stringify(facts)], ['cb-config', JSON.stringify(newCfg)], ['cb-audit', JSON.stringify(newAudit)]]) {
  const store = 'raw/kv/' + key;
  const put = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${store}`, {
    method: 'PUT', headers: { ...H, 'Content-Type': 'application/json', 'x-upsert': 'true' }, body });
  if (!put.ok) { console.error(key + ' storage write failed: ' + put.status + ' ' + (await put.text()).slice(0, 200)); process.exit(1); }
  /* the rules row's own updated_at column is the freshness beacon open tabs poll (worker index.mjs:554) */
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rules?on_conflict=key`, {
    method: 'POST', headers: { ...H, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([{ key: 'kv:' + key, value: { store }, updated_by: 'pulse-sync', updated_at: now }]) });
  if (!r.ok) { console.error(key + ' rules write failed: ' + r.status + ' ' + (await r.text()).slice(0, 200)); process.exit(1); }
  console.log('published ' + key + ' (' + Math.round(body.length / 1024) + ' KB)');
}
console.log('done. Open dashboard tabs re-pull when their meta poll sees cb-audit move.');
