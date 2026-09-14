// audit-ops-stores.mjs — READ-ONLY audit of the live Ops stores: health alerts, every cb-facts-* store's recency and
// day coverage, the upload manifest vs what Ops decided, the Ops roster vs PULSE's, the NBA digest. Writes a
// report under reports/ops-audit-<date>/. Born in the 2026-09-14 audit that found the fact-store lost update.
//   node nicks_code/diagnostics/audit-ops-stores.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, 'supabase.env'), 'utf8')
  .split(/\r?\n/).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const H = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY };
const OUT = process.argv.find((a) => !a.startsWith('--') && a !== process.argv[0] && a !== process.argv[1]) || path.join(ROOT, 'reports', 'ops-audit-' + new Date(Date.now() + 2 * 3600000).toISOString().slice(0, 10));
fs.mkdirSync(OUT, { recursive: true });

const rest = async (q) => { const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${q}`, { headers: H }); if (!r.ok) throw new Error(q + ' → ' + r.status + ' ' + (await r.text()).slice(0, 200)); return r.json(); };
const storage = async (p) => { const r = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${p}`, { headers: H }); if (!r.ok) return null; return r.text(); };
const kvRaw = async (key) => { const rows = await rest('rules?key=eq.' + encodeURIComponent('kv:' + key) + '&select=key,value,updated_at,updated_by'); return rows[0] || null; };
const kv = async (key) => {                                  // pointer row → inline data or Storage blob
  const rows = await rest(`rules?key=eq.${encodeURIComponent('kv:' + key)}&select=key,value,updated_at,updated_by`);
  const row = rows[0]; if (!row) return { missing: true };
  const v = row.value || {};
  let data = v.data != null ? String(v.data) : null;
  if (data == null && v.store) data = await storage(v.store);
  return { at: row.updated_at, by: row.updated_by, store: v.store || null, bytes: data ? data.length : 0, data };
};
const sast = (iso) => iso ? new Date(new Date(iso).getTime() + 2 * 3600000).toISOString().slice(0, 16).replace('T', ' ') : '—';
const today = new Date(Date.now() + 2 * 3600000).toISOString().slice(0, 10);
const days = (iso) => iso ? ((Date.now() - new Date(iso).getTime()) / 86400000).toFixed(1) : '—';
const report = [];
const say = (s) => { console.log(s); report.push(s); };

/* ── A. health alerts the Worker cron keeps ─────────────────────────────── */
say('# Ops audit — ' + today + ' (SAST)\n');
say('## A · Worker health sentinel (kv:health-alerts)');
const ha = await kv('health-alerts');
let alerts = [];
try { const j = JSON.parse(ha.data || '{}'); alerts = Array.isArray(j) ? j : (j.alerts || []); } catch { alerts = []; }
say('- last run: ' + sast(ha.at) + ' · ' + alerts.length + ' alert(s)');
for (const a of alerts) say('  - [' + a.severity + '] ' + a.id + ' — ' + String(a.message || a.detail || a.text || '').slice(0, 240));
fs.writeFileSync(path.join(OUT, 'health-alerts.json'), ha.data || 'null');

/* ── B. every Ops source store ──────────────────────────────────────────── */
say('\n## B · Ops fact stores (kv:cb-facts-*)');
const ptrs = await rest(`rules?key=like.${encodeURIComponent('kv:cb-facts-%')}&select=key,updated_at,updated_by,value`);
const stores = {};
for (const p of ptrs.sort((a, b) => a.key.localeCompare(b.key))) {
  const src = p.key.replace('kv:cb-facts-', '');
  const d = await kv('cb-facts-' + src);
  let rows = []; let parseErr = '';
  try { const j = JSON.parse(d.data || '[]'); rows = Array.isArray(j) ? j : (j.rows || j.facts || []); } catch (e) { parseErr = e.message; }
  const ds = rows.map((r) => r._d).filter(Boolean).sort();
  const batches = new Set(rows.map((r) => r._batch).filter(Boolean));
  const byDay = {}; for (const r of rows) if (r._d) byDay[r._d] = (byDay[r._d] || 0) + 1;
  stores[src] = { rows: rows.length, first: ds[0], last: ds[ds.length - 1], batches: batches.size, at: p.updated_at, by: p.updated_by, byDay, bytes: d.bytes, keys: rows[0] ? Object.keys(rows[0]) : [] };
  say(`- ${src.padEnd(20)} rows ${String(rows.length).padStart(7)} · data ${ds[0] || '—'} → ${ds[ds.length - 1] || '—'} · batches ${batches.size} · written ${sast(p.updated_at)} (${days(p.updated_at)} d ago) by ${p.updated_by || '?'} · ${(d.bytes / 1048576).toFixed(2)} MB${parseErr ? ' · PARSE ERROR ' + parseErr : ''}`);
}
fs.writeFileSync(path.join(OUT, 'stores.json'), JSON.stringify(stores, null, 2));

/* ── C. the upload manifest vs what Ops decided ─────────────────────────── */
say('\n## C · Upload manifest vs Ops intake (kv:upload-manifest vs cb-config.syncedUploads)');
const manRow = await kvRaw('upload-manifest'); const man = { at: manRow && manRow.updated_at };
let manifest = ((manRow && manRow.value && manRow.value.files) || []).map((m) => ({ name: m.n, hash: m.h, size: m.s, at: m.at }));
say('- manifest: ' + manifest.length + ' entries · written ' + sast(man.at));
const cfg = await kv('cb-config');
let config = {}; try { config = JSON.parse(cfg.data || '{}'); } catch {}
const synced = (config.state && config.state.syncedUploads) || config.syncedUploads || {};
const syncedKeys = Object.keys(synced);
say('- cb-config written ' + sast(cfg.at) + ' by ' + (cfg.by || '?') + ' · syncedUploads decided: ' + syncedKeys.length + ' · top-level keys: ' + Object.keys(config).slice(0, 20).join(', '));
const stampOf = (m) => m.at || m.ts || m.uploaded_at || m.time || '';
const recent = manifest.filter((m) => stampOf(m) >= new Date(Date.now() - 14 * 86400000).toISOString()).sort((a, b) => String(stampOf(b)).localeCompare(String(stampOf(a))));
say('- last 14 days: ' + recent.length + ' files (manifest entry keys: ' + (manifest[0] ? Object.keys(manifest[0]).join(', ') : '—') + ')');
const undecided = [];
for (const m of recent) {
  const dec = synced[m.hash] || synced[m.name] || synced[(m.hash || '').slice(0, 16)];
  const label = dec ? (typeof dec === 'object' ? (dec.src || dec.source || dec.status || JSON.stringify(dec).slice(0, 60)) : String(dec)) : 'NOT DECIDED';
  say(`  - ${sast(stampOf(m))} · ${String(m.name).slice(0, 66).padEnd(66)} · ${((m.size || 0) / 1048576).toFixed(2)} MB · Ops: ${label}`);
  if (!dec) undecided.push(m);
}
fs.writeFileSync(path.join(OUT, 'manifest-recent.json'), JSON.stringify({ recent, undecided, syncedSample: Object.entries(synced).slice(0, 5) }, null, 2));

/* ── D. roster agreement: Ops AGENT_LIST vs PULSE vas-state roster ──────── */
say('\n## D · Roster: Ops cb-facts-AGENT_LIST vs PULSE vas-state');
const vs = await kv('vas-state');
let vas = {}; try { vas = JSON.parse(vs.data || '{}'); } catch (e) { say('- vas-state parse error ' + e.message); }
const pulseRoster = (vas.roster || []).map((a) => ({ code: String(a.code || ''), name: a.name, tl: a.tl, camp: a.campaign, tenure: a.tenure }));
say('- vas-state written ' + sast(vs.at) + ' · roster ' + pulseRoster.length + ' agents · rosterEffect ' + JSON.stringify(vas.rosterEffect || null).slice(0, 160));
const opsRaw = JSON.parse((await kv('cb-facts-AGENT_LIST')).data || '[]');
const opsRows = Array.isArray(opsRaw) ? opsRaw : (opsRaw.rows || []);
const latestBatch = opsRows.map((r) => r._d || r._batch || '').sort().pop();
const opsLatest = opsRows;   // the Agent List store is REPLACED on upload — every row is the current list
say('- Ops AGENT_LIST latest _d ' + latestBatch + ' · ' + opsLatest.length + ' rows (of ' + opsRows.length + ' total) · batches ' + [...new Set(opsRows.map((r) => r._batch))].slice(-3).join(', '));
const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^CB0+/, 'CB');
const pm = new Map(pulseRoster.map((a) => [norm(a.code), a]));
const om = new Map(opsLatest.map((r) => [norm(r.cb_norm || r.cb_code), r]));
const onlyPulse = [...pm.keys()].filter((k) => !om.has(k));
const onlyOps = [...om.keys()].filter((k) => !pm.has(k));
const tlDiff = [], campDiff = [], tenDiff = [];
for (const [k, a] of pm) { const r = om.get(k); if (!r) continue;
  if (String(r.team_leader || '').trim() !== String(a.tl || '').trim()) tlDiff.push([k, a.name, a.tl, r.team_leader]);
  const oc = String(r.queue || r.campaign || '').trim(); if (oc && a.camp && oc.toLowerCase() !== String(a.camp).toLowerCase()) campDiff.push([k, a.name, a.camp, oc]);
  if (r.tenure && a.tenure && String(r.tenure).toLowerCase() !== String(a.tenure).toLowerCase()) tenDiff.push([k, a.name, a.tenure, r.tenure]); }
say(`- only in PULSE: ${onlyPulse.length} ${onlyPulse.slice(0, 12).join(', ')}`);
say(`- only in Ops:   ${onlyOps.length} ${onlyOps.slice(0, 12).join(', ')}`);
say(`- team-leader differs: ${tlDiff.length}`); for (const d of tlDiff.slice(0, 15)) say('  - ' + d.join(' | '));
say(`- campaign differs: ${campDiff.length}`); for (const d of campDiff.slice(0, 15)) say('  - ' + d.join(' | '));
say(`- tenure differs: ${tenDiff.length}`); for (const d of tenDiff.slice(0, 15)) say('  - ' + d.join(' | '));
fs.writeFileSync(path.join(OUT, 'roster-diff.json'), JSON.stringify({ onlyPulse, onlyOps, tlDiff, campDiff, tenDiff, opsKeys: opsLatest[0] ? Object.keys(opsLatest[0]) : [] }, null, 2));

/* ── E. September coverage per source, day by day ───────────────────────── */
say('\n## E · September day coverage per Ops source (rows per _d)');
const sept = []; for (let d = 1; d <= Number(today.slice(8)); d++) sept.push('2026-09-' + String(d).padStart(2, '0'));
const srcs = Object.keys(stores).filter((s) => s !== 'AGENT_LIST');
say('| day | ' + srcs.map((s) => s.replace(/_/g, ' ').slice(0, 14)).join(' | ') + ' |');
say('|' + '---|'.repeat(srcs.length + 1));
for (const d of sept) say('| ' + d.slice(5) + ' | ' + srcs.map((s) => stores[s].byDay[d] || '·').join(' | ') + ' |');

/* ── F. the NBA digest Ops publishes ────────────────────────────────────── */
say('\n## F · kv:nba-digest (what the TL / agent views read from Ops)');
const nd = await kv('nba-digest');
let nba = {}; try { nba = JSON.parse(nd.data || '{}'); } catch {}
say('- written ' + sast(nd.at) + ' by ' + (nd.by || '?') + ' · period ' + JSON.stringify(nba.period) + ' · agents ' + ((nba.agents || []).length) + ' · updatedAt ' + (nba.updatedAt || '—') + ' · rules.pen ' + JSON.stringify(nba.rules && nba.rules.pen));

/* ── G. app-opened stamps — who has Ops open, and when ──────────────────── */
say('\n## G · kv:app-opened');
const ao = await kv('app-opened');
say('- ' + String(ao.data || '').slice(0, 400));

fs.writeFileSync(path.join(OUT, 'report.md'), report.join('\n'));
console.log('\nwritten ' + OUT);
