#!/usr/bin/env node
/**
 * job-status.mjs — a scheduled step reports that it ran (never-stale plan, Phase 1).
 *
 *   node tools/job-status.mjs <step> <success|failure|ok|fail> [note]
 *
 * Writes kv:jobs-status {steps:{<step>:{ranAt, ok, note}}, updatedAt} — one small legacy row
 * so GET /api/kv serves it to the Settings page directly. The Worker's sentinel raises
 * runner-never-ran while the row does not exist, runner-silent when it stops moving in
 * working hours, and verification-failed when a verify* step reports ok=false.
 *
 * ONE WRITER, SHARED (Spec Kit 014, T5). tools/tick-local.mjs stamps through stampJob() below. The
 * stamp is a read-modify-write of one JSON row, so it re-reads immediately before writing and the
 * write is conditional on the row it read (compare-and-set on updated_at): a second writer landing in
 * between makes the PATCH match nothing, and the stamp re-reads and tries again instead of erasing that
 * writer's step. It never throws — a stamp that cannot be written is REPORTED ({ok:false, error}) and
 * must never stop the steps after it (it used to: one failed fetch aborted the rest of the tick).
 */
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';

const KEY = 'kv:jobs-status';
/* ONE CAP FOR THE NOTE (014 review T-R4): tick-local's failureNote() writes up to this many characters and ends with
   "@ file:line" — a smaller cap here cut exactly that off. tick-local imports it. */
export const NOTE_MAX = 300;
/* every request is bounded (014 review T-R3): undici's default would wait 300 s per call, three calls per try */
const STAMP_TIMEOUT_MS = 20000;

/** the stored value → the jobs document (two historical shapes: inline, or a JSON string in .data) */
export function parseJobsDoc(value) {
  try { const v = value || {}; const d = v.steps ? v : (v.data ? JSON.parse(v.data) : null); if (d && typeof d === 'object') return d; } catch { /* unreadable: start clean */ }
  return { steps: {} };
}

/** a NEW document with one step replaced — the input is never touched */
export function withStep(doc, step, entry, at, runner) {
  const base = doc && typeof doc === 'object' ? doc : {};
  return { ...base, steps: { ...(base.steps || {}), [step]: entry }, updatedAt: at, ...(runner ? { lastRunner: runner } : {}) };
}

/**
 * Stamp one step. Resolves {ok:true,status,tries} or {ok:false,error,tries}; never rejects.
 * rest = '<SUPABASE_URL>/rest/v1/', headers = the service-key headers.
 */
export async function stampJob({ rest, headers, step, ok, note = '', runner = '', by = 'job-status', fetchImpl = fetch, tries = 3, timeoutMs = STAMP_TIMEOUT_MS }) {
  let lastErr = '';
  for (let i = 1; i <= tries; i++) {
    if (i > 1) await new Promise((r) => setTimeout(r, 200 * (i - 1)));   // a short pause before re-reading
    try {
      const gr = await fetchImpl(rest + 'rules?key=eq.' + KEY + '&select=value,updated_at', { headers, signal: AbortSignal.timeout(timeoutMs) });
      if (!gr.ok) { lastErr = 'read ' + gr.status; continue; }
      const row = ((await gr.json()) || [])[0];
      const at = new Date().toISOString();
      const entry = { ranAt: at, ok: !!ok, note: String(note || '').slice(0, NOTE_MAX), ...(runner ? { runner } : {}) };
      const doc = withStep(parseJobsDoc(row && row.value), step, entry, at, runner);
      const body = { value: { data: JSON.stringify(doc) }, updated_by: by, updated_at: at };
      const hj = { ...headers, 'Content-Type': 'application/json' };
      if (!row) {   // first stamp ever: create it (the only unconditional write)
        const pr = await fetchImpl(rest + 'rules?on_conflict=key', { method: 'POST', signal: AbortSignal.timeout(timeoutMs),
          headers: { ...hj, Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify([{ key: KEY, ...body }]) });
        if (pr.ok) return { ok: true, status: pr.status, tries: i };
        lastErr = 'create ' + pr.status; continue;
      }
      const cond = row.updated_at == null ? 'updated_at=is.null' : 'updated_at=eq.' + encodeURIComponent(row.updated_at);
      const wr = await fetchImpl(rest + 'rules?key=eq.' + KEY + '&' + cond, { method: 'PATCH', signal: AbortSignal.timeout(timeoutMs),
        headers: { ...hj, Prefer: 'return=representation' }, body: JSON.stringify(body) });
      if (!wr.ok) { lastErr = 'write ' + wr.status; continue; }
      let got = null; try { got = await wr.json(); } catch { got = null; }
      if (Array.isArray(got) && got.length) return { ok: true, status: wr.status, tries: i };
      lastErr = 'another writer moved ' + KEY + ' between the read and the write';   // re-read and retry
    } catch (e) { lastErr = String((e && e.message) || e); }
  }
  return { ok: false, error: lastErr, tries };
}

async function main() {
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, 'supabase.env'), 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^"|"$/g, '')]));
  const H = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY };
  const [step, outcome, ...rest] = process.argv.slice(2);
  if (!step || !outcome) { console.error('usage: node tools/job-status.mjs <step> <success|failure> [note]'); process.exitCode = 1; return; }
  const ok = /^(success|ok|pass|true)$/i.test(outcome);
  const r = await stampJob({ rest: env.SUPABASE_URL + '/rest/v1/', headers: H, step, ok, note: rest.join(' ') });
  console.log('jobs-status: ' + step + ' → ' + (ok ? 'ok' : 'FAILED') + ' (' + (r.ok ? r.status : 'NOT written — ' + r.error) + ')');
  process.exitCode = r.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
