#!/usr/bin/env node
/**
 * audit-hub-signatures.mjs — which coaching documents saved from Agent Analytics are missing a signature
 * (spec 003-coaching-comments-signature, FR-010).
 *
 *   node tools/audit-hub-signatures.mjs [--since YYYY-MM-DD]
 *
 * WHY: until 2026-10-05 the coaching form in Agent Analytics threw away every drawn signature before the save (the pad
 * was wired with the form's reader as its setter). Those documents are in the Coaching Hub unsigned; the drawings were
 * never sent, so the fix cannot restore them — the team leader re-signs each one in the Hub app. This lists them.
 *
 * HOW A NEW-VIEW DOCUMENT IS RECOGNISED: the Hub's own form saves the CB number hyphenated ("CB-123"); Agent Analytics
 * saves the roster code ("CB123"). Exact for Formal and Informal Coaching (the Hub form always hyphenates); for QA the
 * Hub accepts a typed CB, so a QA row in "CB123" shape MAY be Hub-written — the shape judged by is printed per row.
 *
 * READ-ONLY. Convex `query` only — this file never calls a mutation. Prints dates, products, team leaders and CB codes;
 * never an agent's name, never a signature.
 */
import { signatureFields, COACH_TABLES } from '../worker/src/hubs.mjs';

const HUB = 'https://acrobatic-setter-212.eu-west-1.convex.cloud';
const arg = (name, dflt) => { const i = process.argv.indexOf('--' + name); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt; };
const since = arg('since', '2026-08-20');
if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) { console.error('--since must be YYYY-MM-DD'); process.exit(2); }

async function query(path, args) {
  const r = await fetch(HUB + '/api/query', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, args }) });
  if (!r.ok) throw new Error(`${path} → HTTP ${r.status}`);
  const j = await r.json();
  if (j.status !== 'success') throw new Error(`${path} → ${j.errorMessage || 'failed'}`);
  return j.value;
}

const leaders = await query('teamLeaders:list', {});
const found = [];
let scanned = 0;
for (const table of Object.keys(COACH_TABLES)) {
  const sigs = signatureFields(table);
  for (const tl of leaders) {
    let rows;
    try { rows = await query(`${table}:list`, { teamLeaderId: tl._id }); }
    catch (e) { console.error(`  could not read ${table} for ${tl.name}: ${e.message}`); continue; }
    for (const r of rows || []) {
      const day = String(r.date || r.dateOfCoaching || '');
      if (day < since) continue;
      scanned++;
      const shape = /^CB\d+$/.test(String(r.employeeNumber || '')) ? 'CB123 (Agent Analytics)' : null;
      if (!shape) continue;
      const missing = sigs.filter((f) => !(typeof r[f] === 'string' && r[f]));
      const attendeesUnsigned = Array.isArray(r.employeeSignoffs) ? r.employeeSignoffs.filter((s) => s && !s.signature).length : 0;
      if (missing.length || attendeesUnsigned)
        found.push({ day, table: COACH_TABLES[table], tl: tl.name, cb: r.employeeCode || r.employeeNumber || '', missing, attendeesUnsigned, shape });
    }
  }
}
found.sort((a, b) => a.day.localeCompare(b.day));
console.log(`Scanned ${scanned} coaching documents dated ${since} or later.`);
console.log(`${found.length} saved from Agent Analytics with a signature missing — re-sign each in the Coaching Hub app:\n`);
for (const f of found)
  console.log(`  ${f.day}  ${f.table.padEnd(27)} ${f.tl.padEnd(20)} ${String(f.cb).padEnd(7)} missing: ${[...f.missing.map((m) => m.replace(/Signature$/, '')), f.attendeesUnsigned ? f.attendeesUnsigned + ' attendee(s)' : ''].filter(Boolean).join(', ')}   [${f.shape}]`);
