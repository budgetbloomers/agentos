#!/usr/bin/env node
/* Referral counts per agent, from HighLevel (LeadConnector API v2).
 *
 * The location's model: ONE contact = ONE referrer (a Matrix customer), attributed to an
 * agent via the "Agent Name" custom field. The referred people live in blocks — the base
 * block ("Full Name and Surname" / "Referral Contact Number") plus "Referral 2..5 …" —
 * so the true referral count is FILLED BLOCKS, not contacts (the S11 quirk: totals can
 * exceed rows). This tool ships counts on that basis and never invents an agent: raw
 * Agent Name strings that match nobody on the Agent List are reported UNMATCHED with
 * their counts, exactly like the dashboard's honest-remainder doctrine.
 *
 * Credentials: agentos/highlevel.env (gitignored) or env — HL_API_KEY / HL_LOCATION_ID.
 * Roster: newest "Matrix - Agent List.xlsx" under uploads/ (override: --roster <path>).
 *
 * Outputs (uploads/ is gitignored — contact PII):
 *   uploads/referrals-per-agent-<today>.csv   agent counts (the "number of referrals" ask)
 *   uploads/referrals-highlevel-<today>.csv   row-level CSV for the Upload Station slot
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const XLSX = require(path.join(HERE, '../site/xlsx.full.min.js'));

const envFile = path.join(HERE, '..', 'highlevel.env');
if (fs.existsSync(envFile)) for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const KEY = process.env.HL_API_KEY, LOC = process.env.HL_LOCATION_ID;
if (!KEY || !LOC) { console.error('Missing HL_API_KEY / HL_LOCATION_ID (highlevel.env)'); process.exit(1); }

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };

const BASE = 'https://services.leadconnectorhq.com';
const H = { Authorization: 'Bearer ' + KEY, Version: '2021-07-28', Accept: 'application/json' };
async function get(pathq) {
  const r = await fetch(BASE + pathq, { headers: H });
  if (!r.ok) throw new Error(pathq + ' → HTTP ' + r.status + ' ' + (await r.text()).slice(0, 200));
  return r.json();
}

/* ---- roster (identity spine: normName, name → CB) ---- */
const normName = v => String(v || '').toLowerCase().replace(/\s+-\s*.*$|\s*-\s+.*$/, '').replace(/\s+/g, ' ').trim();
function findRoster() {
  const explicit = flag('roster', null);
  if (explicit) return explicit;
  const updir = path.join(HERE, '..', 'uploads');
  if (!fs.existsSync(updir)) return null;   // the cloud runner has no uploads/ — the roster then comes from the record below
  let best = null, bestM = 0;
  const walk = d => { for (const n of fs.readdirSync(d)) { const p = path.join(d, n);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p);
    else if (/matrix - agent list\.xlsx$/i.test(n) && st.mtimeMs > bestM) { best = p; bestM = st.mtimeMs; } } };
  walk(updir);
  return best;
}
const nameToCB = {}, cbName = {};
const rosterPath = findRoster();
if (rosterPath) {
  const wb = XLSX.read(fs.readFileSync(rosterPath), { type: 'buffer' });
  for (const sn of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { defval: '' });
    for (const r of rows) {
      const code = String(r['Employee Code'] || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      const nm = String(r['Agent Name'] || '').trim();
      if (!code || !nm || !r['Campaign']) continue; // current-format tabs ONLY — the legacy 'Que' May tab is a stale roster (dashboard preferHeader rule)
      nameToCB[normName(nm)] = code; cbName[code] = nm;
      const sf = String(r['Sales Force'] || '').trim(); if (sf) nameToCB[normName(sf)] = code;
    }
  }
  console.log(`roster: ${Object.keys(cbName).length} agents from ${path.basename(path.dirname(rosterPath))}/${path.basename(rosterPath)}`);
} else {
  /* THE FILE IS THE RECORD (CLAUDE.md rule 13): with no local list, read the roster the Worker
     serves — kv:roster-current — through the Supabase env the scheduled runner already carries.
     Before this the cloud step crashed on scandir(uploads/) every morning (found 2026-09-08). */
  const SB_URL = process.env.SUPABASE_URL, SB_KEY = process.env.SUPABASE_SECRET_KEY;
  if (SB_URL && SB_KEY) {
    try {
      const rc = await fetch(SB_URL + '/rest/v1/rules?key=eq.kv:roster-current&select=value', { headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY } });
      let rv = rc.ok ? ((await rc.json())[0] || {}).value : null; if (typeof rv === 'string') { try { rv = JSON.parse(rv); } catch {} }
      for (const a of (rv && rv.roster) || []) {
        const code = String(a.code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, ''); const nm = String(a.name || '').trim();
        if (!code || !nm) continue;
        nameToCB[normName(nm)] = code; cbName[code] = nm; if (a.sf) nameToCB[normName(a.sf)] = code;
      }
      console.log('roster: ' + Object.keys(cbName).length + ' agents from kv:roster-current (the record)');
    } catch (e) { console.log('WARNING: roster record unreadable (' + (e && e.message) + ') — all agents will report UNMATCHED'); }
  } else console.log('WARNING: no Matrix - Agent List.xlsx found under uploads/ and no Supabase env — all agents will report UNMATCHED');
}

/* ---- custom-field map ---- */
const cf = await get(`/locations/${LOC}/customFields`);
const fieldName = {}; (cf.customFields || []).forEach(f => fieldName[f.id] = f.name);
const fid = name => Object.keys(fieldName).filter(id => fieldName[id] === name);
const AGENT_IDS = fid('Agent Name');
const BLOCKS = [
  fid('Full Name and Surname').concat(fid('Referral Contact Number')),
  fid('Referral 2 Full Name').concat(fid('Referral 2 Contact Number')),
  fid('Referral 3 Full Name').concat(fid('Referral 3 Contact Number')),
  fid('Referral 4 Full Name').concat(fid('Referral 4 Contact Number')),
  fid('Referral 5 Full Name').concat(fid('Referral 5 Contact Number')),
];

/* ---- page through every contact ---- */
const contacts = [];
let startAfterId = null, startAfter = null, guard = 0;
for (;;) {
  let q = `/contacts/?locationId=${LOC}&limit=100`;
  if (startAfterId) q += `&startAfterId=${startAfterId}&startAfter=${startAfter}`;
  const r = await get(q);
  const batch = r.contacts || [];
  contacts.push(...batch);
  if (batch.length < 100 || ++guard > 500) break;
  startAfterId = r.meta?.startAfterId || batch[batch.length - 1].id;
  startAfter = r.meta?.startAfter || new Date(batch[batch.length - 1].dateAdded || 0).getTime();
}
console.log(`contacts pulled: ${contacts.length}`);

const fval = (c, ids) => {
  for (const f of (c.customFields || [])) if (ids.includes(f.id) && String(f.value ?? '').trim() !== '') return String(f.value).trim();
  return '';
};

/* Controlled agent matching — tiered, unique-or-nothing (spec §3: never merge on a guess):
 * 1) exact normName against Agent Name / Sales Force
 * 2) token subset (e.g. "Thulani Mbonambi" ⊂ "Thulani Greatman Mbonambi") — unique hit only
 * 3) single token unique across the roster (e.g. "LYDIA" → the only Lydia)
 * Anything ambiguous ("Tessa Chetty", "Mags Pillay") stays UNMATCHED for human review. */
const clean = t => t.replace(/[^a-z]/g, '');
function lev1(a, b) { // edit distance ≤1 for typo'd tokens (len ≥4 both sides)
  if (a === b) return true;
  if (a.length < 4 || b.length < 4 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}
const tokMatch = (t, rt) => t === rt || lev1(clean(t), clean(rt));
const rosterNames = Object.keys(nameToCB).map(n => ({ n, toks: n.split(' '), cb: nameToCB[n] }));
const matchCache = {};
function matchAgent(raw) {
  const n = normName(raw);
  if (!n) return null;
  if (n in matchCache) return matchCache[n];
  let cb = nameToCB[n] || null;
  if (!cb) {
    const toks = n.split(' ');
    const subset = rosterNames.filter(r => toks.every(t => r.toks.some(rt => tokMatch(t, rt))) || r.toks.every(rt => toks.some(t => tokMatch(t, rt))));
    if (new Set(subset.map(r => r.cb)).size === 1) cb = subset[0].cb;
    else if (toks.length === 1) {
      const one = rosterNames.filter(r => r.toks.some(rt => tokMatch(toks[0], rt)));
      if (new Set(one.map(r => r.cb)).size === 1) cb = one[0].cb;
    }
  }
  return (matchCache[n] = cb);
}

/* ---- aggregate: blocks per contact → counts per agent ---- */
const perAgent = new Map(); // key: cb or RAW::name
let refRows = 0, noAgent = 0, noBlocks = 0;
// Headers the dashboard's REFERRALS transform reads directly: Agent Name + Referral Count
// + Created; Employee Code carries the pre-matched CB (exact attribution), left blank for
// unmatched rows so the dashboard's own Agent-List tiered matching (refCbOf) takes over.
const rowCsv = [['Contact Id', 'Created', 'Agent Name', 'Employee Code', 'Matched Agent', 'Referrer', 'Referral Count'].join(',')];
const esc = v => { v = String(v ?? ''); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
for (const c of contacts) {
  const agentRaw = fval(c, AGENT_IDS);
  let n = BLOCKS.filter(ids => fval(c, ids) !== '').length;
  if (!n) { noBlocks++; n = (c.tags || []).some(t => /referral/i.test(t)) ? 1 : 0; } // tagged referral with empty blocks still counts once — flagged below
  if (!n) continue;
  refRows += n;
  const cb = matchAgent(agentRaw);
  if (!agentRaw) noAgent++;
  const key = cb || ('RAW::' + (normName(agentRaw) || '(no agent)'));
  const e = perAgent.get(key) || { cb, raw: agentRaw || '(no agent)', contacts: 0, refs: 0 };
  e.contacts++; e.refs += n;
  perAgent.set(key, e);
  rowCsv.push([c.id, c.dateAdded ? String(c.dateAdded).slice(0, 10) : '', agentRaw, cb || '', cb ? cbName[cb] : '', c.contactName || '', n].map(esc).join(','));
}

const list = [...perAgent.values()].sort((a, b) => b.refs - a.refs);
const matched = list.filter(e => e.cb), unmatched = list.filter(e => !e.cb);
const outDir = path.join(HERE, '..', 'uploads'); fs.mkdirSync(outDir, { recursive: true });
const day = new Date().toISOString().slice(0, 10);
const perAgentCsv = [['cb', 'agent_name', 'agent_name_raw', 'referrer_contacts', 'referrals', 'status'].join(',')]
  .concat(list.map(e => [e.cb || '', e.cb ? cbName[e.cb] : '', e.raw, e.contacts, e.refs, e.cb ? 'MATCHED' : 'NOT IN AGENT LIST'].map(esc).join(',')));
fs.writeFileSync(path.join(outDir, `referrals-per-agent-${day}.csv`), perAgentCsv.join('\n'), 'utf8');
fs.writeFileSync(path.join(outDir, `referrals-highlevel-${day}.csv`), rowCsv.join('\n'), 'utf8');

console.log(`\nREFERRALS PER AGENT (${matched.length} matched agents, ${unmatched.length} unmatched names):`);
for (const e of list.slice(0, 40)) console.log('  ' + String(e.cb || 'UNMATCHED').padEnd(10) + String(e.cb ? cbName[e.cb] : e.raw).padEnd(32) + e.refs + ' referral(s) over ' + e.contacts + ' contact(s)');
if (list.length > 40) console.log('  … ' + (list.length - 40) + ' more (see CSV)');
console.log(`\ntotal referrals: ${refRows} across ${contacts.length} contacts · empty-block-but-tagged counted once: ${noBlocks} · contacts with no Agent Name: ${noAgent}`);
console.log(`wrote uploads/referrals-per-agent-${day}.csv and uploads/referrals-highlevel-${day}.csv`);
